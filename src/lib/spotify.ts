import 'dotenv/config'

/**
 * Minimal Spotify client using the Client Credentials flow - app-level auth,
 * no user login. That matters: the 25-user cap on apps in development mode
 * applies to user-authorized endpoints, and none of this needs one.
 *
 * Rate limits are a rolling window and Spotify does not publish the exact
 * number, so treat 429 as normal operating condition, not an error. Every
 * request here honours Retry-After and backs off.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const API = 'https://api.spotify.com/v1'

export interface SpotifyArtist {
  id: string
  name: string
  followers: number
  popularity: number
  imageUrl: string | null
  spotifyUrl: string | null
  genres: string[]
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value

  const id = process.env.SPOTIFY_CLIENT_ID
  const secret = process.env.SPOTIFY_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set. See .env.example.')
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    throw new Error(`Spotify token request failed (${res.status}): ${await res.text()}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    value: json.access_token,
    // Refresh a minute early so a long job never trips over an expiry mid-run.
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  }
  return cachedToken.value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function apiGet<T>(path: string, attempt = 0): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 429) {
    // Spotify tells you exactly how long to wait. Believe it.
    const retryAfter = Number(res.headers.get('retry-after') ?? '2')
    if (attempt >= 5) throw new Error(`Rate limited by Spotify after ${attempt} retries on ${path}`)
    console.warn(`  rate limited, waiting ${retryAfter}s...`)
    await sleep((retryAfter + 1) * 1000)
    return apiGet<T>(path, attempt + 1)
  }

  if (res.status === 401) {
    // Token expired early. Drop it and retry once.
    cachedToken = null
    if (attempt >= 2) throw new Error(`Spotify auth kept failing on ${path}`)
    return apiGet<T>(path, attempt + 1)
  }

  if (res.status >= 500) {
    if (attempt >= 4) throw new Error(`Spotify ${res.status} on ${path}`)
    await sleep(2 ** attempt * 1000)
    return apiGet<T>(path, attempt + 1)
  }

  if (!res.ok) {
    throw new Error(`Spotify ${res.status} on ${path}: ${await res.text()}`)
  }

  return (await res.json()) as T
}

interface RawArtist {
  id: string
  name: string
  followers: { total: number }
  popularity: number
  images: { url: string; width: number; height: number }[]
  external_urls: { spotify?: string }
  genres: string[]
}

const normalize = (a: RawArtist): SpotifyArtist => ({
  id: a.id,
  name: a.name,
  followers: a.followers?.total ?? 0,
  popularity: a.popularity ?? 0,
  imageUrl: a.images?.[0]?.url ?? null,
  spotifyUrl: a.external_urls?.spotify ?? null,
  genres: a.genres ?? [],
})

/**
 * Fetch many artists by Spotify ID. Batches of 50 - the API maximum - which is
 * the difference between 1 request and 50 when the snapshot job runs.
 */
export async function getArtists(spotifyIds: string[]): Promise<SpotifyArtist[]> {
  const out: SpotifyArtist[] = []
  for (let i = 0; i < spotifyIds.length; i += 50) {
    const batch = spotifyIds.slice(i, i + 50)
    const json = await apiGet<{ artists: (RawArtist | null)[] }>(
      `/artists?ids=${batch.join(',')}`,
    )
    // Deleted artists come back as null in-place rather than as an error.
    for (const a of json.artists) if (a) out.push(normalize(a))
    // Gentle self-pacing so we mostly never see a 429 in the first place.
    if (i + 50 < spotifyIds.length) await sleep(120)
  }
  return out
}

export async function searchArtists(query: string, limit = 20): Promise<SpotifyArtist[]> {
  const json = await apiGet<{ artists: { items: RawArtist[] } }>(
    `/search?q=${encodeURIComponent(query)}&type=artist&limit=${limit}`,
  )
  return json.artists.items.map(normalize)
}
