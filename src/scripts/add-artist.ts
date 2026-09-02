import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index'
import { artists } from '../db/schema'
import { getArtists, searchArtists, type SpotifyArtist } from '../lib/spotify'
import { seedSupplyFor, spotPriceMicros, marketCapMicros, formatMicros } from '../lib/curve'
import { UNVERIFIED_FOLLOWER_THRESHOLD } from '../lib/config'

/**
 * List an artist. This is the CLI stand-in for what will become the in-app
 * "list an artist" flow - same logic, no auth and no listing fee charged yet.
 *
 *   npm run add -- 3TVXtAsR1Inumwj472S9r4     (spotify id)
 *   npm run add -- "some artist name"          (takes the top search result)
 */

/** Spotify IDs are 22-character base62. Anything else is treated as a search. */
const looksLikeSpotifyId = (s: string) => /^[A-Za-z0-9]{22}$/.test(s)

async function resolve(input: string): Promise<SpotifyArtist | null> {
  if (looksLikeSpotifyId(input)) {
    const [found] = await getArtists([input])
    return found ?? null
  }
  const [top] = await searchArtists(input, 1)
  if (top) console.log(`Matched "${input}" -> ${top.name}`)
  return top ?? null
}

async function main() {
  const input = process.argv.slice(2).join(' ').trim()
  if (!input) {
    console.error('Usage: npm run add -- <spotify-id | artist name>')
    process.exitCode = 1
    return
  }

  const artist = await resolve(input)
  if (!artist) {
    console.log(`No artist found for "${input}".`)
    return
  }

  const db = getDb()
  const existing = await db
    .select({ id: artists.id, supply: artists.supply })
    .from(artists)
    .where(eq(artists.spotifyId, artist.id))
    .limit(1)

  if (existing[0]) {
    console.log(`${artist.name} is already listed at ${formatMicros(spotPriceMicros(existing[0].supply))}/share.`)
    return
  }

  // Seed supply is pre-minted from real followers so the opening price already
  // reflects who this is. Without it, a global superstar would list at the same
  // price as an unknown and be free money.
  const seed = seedSupplyFor(artist.followers)
  const unverified = artist.followers < UNVERIFIED_FOLLOWER_THRESHOLD

  await db.insert(artists).values({
    spotifyId: artist.id,
    name: artist.name,
    imageUrl: artist.imageUrl,
    spotifyUrl: artist.spotifyUrl,
    status: unverified ? 'unverified' : 'active',
    supply: seed,
    seedSupply: seed,
    latestFollowers: BigInt(artist.followers),
    latestPopularity: artist.popularity,
    followersAtListing: BigInt(artist.followers),
  })

  console.log(`\nListed ${artist.name}${unverified ? '  [unverified]' : ''}`)
  console.log(`  ${artist.followers.toLocaleString()} followers, popularity ${artist.popularity}`)
  console.log(`  opening price  ${formatMicros(spotPriceMicros(seed))}/share`)
  console.log(`  market cap     ${formatMicros(marketCapMicros(seed), 0)}`)
  console.log(`  seed supply    ${seed.toLocaleString()} shares\n`)
}

main()
  .catch((err) => {
    console.error(err.message ?? err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
