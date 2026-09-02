import { desc, gte, ne, inArray } from 'drizzle-orm'
import { getDb, isDbConfigured } from './index'
import { artists, artistSnapshots } from './schema'
import { spotPriceMicros, marketCapMicros } from '../lib/curve'

/**
 * Read queries for the web app. Every one returns `null` rather than throwing
 * when the database isn't configured, so pages can render a setup state.
 */

export interface MarketRow {
  id: string
  name: string
  imageUrl: string | null
  status: 'active' | 'unverified' | 'frozen' | 'dead'
  priceMicros: bigint
  capMicros: bigint
  followers: bigint | null
  /** Follower change over the trailing week, in basis points. Null until there are two snapshots. */
  followerChangeBps: number | null
}

const DAY_MS = 86_400_000

export async function getMarket(limit = 100): Promise<MarketRow[] | null> {
  if (!isDbConfigured()) return null
  const db = getDb()

  const rows = await db
    .select({
      id: artists.id,
      name: artists.name,
      imageUrl: artists.imageUrl,
      status: artists.status,
      supply: artists.supply,
      followers: artists.latestFollowers,
    })
    .from(artists)
    .where(ne(artists.status, 'dead'))
    .orderBy(desc(artists.supply))
    .limit(limit)

  if (rows.length === 0) return []

  // Pull the trailing window in one query and reduce in memory. Simpler to read
  // than a lateral join, and the row count here is small by construction.
  const since = new Date(Date.now() - 8 * DAY_MS).toISOString().slice(0, 10)
  const history = await db
    .select({
      artistId: artistSnapshots.artistId,
      capturedOn: artistSnapshots.capturedOn,
      followers: artistSnapshots.followers,
    })
    .from(artistSnapshots)
    .where(gte(artistSnapshots.capturedOn, since))

  // Oldest snapshot in the window per artist, to compare today against.
  const oldest = new Map<string, { day: string; followers: bigint | null }>()
  for (const h of history) {
    const seen = oldest.get(h.artistId)
    if (!seen || h.capturedOn < seen.day) {
      oldest.set(h.artistId, { day: h.capturedOn, followers: h.followers })
    }
  }

  return rows.map((r) => {
    const base = oldest.get(r.id)?.followers ?? null
    let followerChangeBps: number | null = null
    if (base !== null && base > 0n && r.followers !== null) {
      followerChangeBps = Number(((r.followers - base) * 10_000n) / base)
    }
    return {
      id: r.id,
      name: r.name,
      imageUrl: r.imageUrl,
      status: r.status,
      priceMicros: spotPriceMicros(r.supply),
      capMicros: marketCapMicros(r.supply),
      followers: r.followers,
      followerChangeBps,
    }
  })
}
