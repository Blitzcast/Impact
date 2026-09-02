import { like, eq } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index'
import { artists, artistSnapshots } from '../db/schema'
import { seedSupplyFor, spotPriceMicros, formatMicros } from '../lib/curve'
import { UNVERIFIED_FOLLOWER_THRESHOLD } from '../lib/config'

/**
 * Development seed.
 *
 *   npm run seed            insert demo artists + 45 days of history
 *   npm run seed -- --clear remove them again
 *
 * Real rows in the real database, read by the real queries - not mock data in
 * components. That's the distinction that matters: nothing here is a special
 * case the app has to know about, it's just data that happens to be synthetic.
 *
 * Seeded artists carry a `seed:` spotifyId prefix so the snapshot job skips
 * them. Without that, the daily job would try to fetch a nonexistent Spotify
 * artist, get nothing back, and mark every one of them dead.
 */

const SEED_PREFIX = 'seed:'
const DAYS = 45
const DAY_MS = 86_400_000

interface Demo {
  name: string
  followers: number
  /** Daily follower growth rate. The spread is the point - some rip, some rot. */
  drift: number
  /** Random day-to-day noise, as a fraction of the daily move. */
  volatility: number
}

// Weighted toward the bottom, because the long tail is the product.
const DEMO: Demo[] = [
  { name: 'Nocturne Bloom', followers: 84, drift: 0.075, volatility: 0.5 },
  { name: 'sable/void', followers: 137, drift: 0.052, volatility: 0.6 },
  { name: 'Kite Season', followers: 219, drift: 0.031, volatility: 0.4 },
  { name: 'MARLOWE GREY', followers: 402, drift: 0.018, volatility: 0.3 },
  { name: 'Pale Arcade', followers: 640, drift: 0.094, volatility: 0.7 },
  { name: 'juno static', followers: 1_180, drift: 0.012, volatility: 0.3 },
  { name: 'Hollow Transit', followers: 2_450, drift: -0.004, volatility: 0.2 },
  { name: 'ODESSA WAVE', followers: 4_900, drift: 0.026, volatility: 0.4 },
  { name: 'Ferrous Youth', followers: 8_300, drift: 0.008, volatility: 0.2 },
  { name: 'Cassette Ruin', followers: 15_600, drift: 0.041, volatility: 0.5 },
  { name: 'Verona Lights', followers: 27_400, drift: 0.003, volatility: 0.2 },
  { name: 'THIRD MOON', followers: 61_000, drift: 0.016, volatility: 0.3 },
  { name: 'Aurelia Fell', followers: 128_000, drift: -0.002, volatility: 0.15 },
  { name: 'Glass Cathedral', followers: 340_000, drift: 0.006, volatility: 0.2 },
  { name: 'RIOT SUMMER', followers: 890_000, drift: 0.002, volatility: 0.1 },
  { name: 'Neon Pastoral', followers: 2_100_000, drift: 0.001, volatility: 0.1 },
]

/** Deterministic RNG, so a seeded database is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dayString = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10)

async function clear() {
  const db = getDb()
  const rows = await db.select({ id: artists.id }).from(artists).where(like(artists.spotifyId, `${SEED_PREFIX}%`))
  for (const r of rows) {
    await db.delete(artistSnapshots).where(eq(artistSnapshots.artistId, r.id))
  }
  await db.delete(artists).where(like(artists.spotifyId, `${SEED_PREFIX}%`))
  console.log(`Removed ${rows.length} seeded artists and their history.`)
}

async function seed() {
  const db = getDb()
  const rand = rng(7)

  const existing = await db.select({ id: artists.id }).from(artists).where(like(artists.spotifyId, `${SEED_PREFIX}%`))
  if (existing.length > 0) {
    console.log(`${existing.length} seeded artists already present. Run "npm run seed -- --clear" first.`)
    return
  }

  console.log(`\nSeeding ${DEMO.length} artists with ${DAYS} days of history...\n`)

  for (const [i, d] of DEMO.entries()) {
    const supply = seedSupplyFor(d.followers)
    const unverified = d.followers < UNVERIFIED_FOLLOWER_THRESHOLD

    // Walk backwards from today's follower count to reconstruct a plausible past.
    const history: { day: string; followers: number }[] = []
    let f = d.followers
    for (let back = 0; back < DAYS; back++) {
      history.push({ day: dayString(back), followers: Math.max(1, Math.round(f)) })
      const noise = 1 + (rand() - 0.5) * 2 * d.volatility
      f = f / (1 + d.drift * noise)
    }

    const [inserted] = await db.insert(artists).values({
      spotifyId: `${SEED_PREFIX}${String(i).padStart(4, '0')}`,
      name: d.name,
      imageUrl: null,
      spotifyUrl: null,
      status: unverified ? 'unverified' : 'active',
      supply,
      seedSupply: supply,
      latestFollowers: BigInt(d.followers),
      latestPopularity: Math.min(100, Math.round(Math.log10(d.followers + 1) * 14)),
      followersAtListing: BigInt(history[history.length - 1]!.followers),
    }).returning({ id: artists.id })

    await db.insert(artistSnapshots).values(
      history.map((h) => ({
        artistId: inserted!.id,
        capturedOn: h.day,
        source: 'spotify',
        followers: BigInt(h.followers),
        popularity: Math.min(100, Math.round(Math.log10(h.followers + 1) * 14)),
        // No trades yet, so supply sits at seed and price is the opening price.
        supply,
        priceMicros: spotPriceMicros(supply),
      })),
    )

    const weekAgo = history[7]!.followers
    const change = ((d.followers - weekAgo) / weekAgo) * 100
    console.log(
      `  ${d.name.padEnd(18)}${d.followers.toLocaleString().padStart(11)} followers  ` +
      `${formatMicros(spotPriceMicros(supply)).padStart(9)}/share  ` +
      `7d ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
    )
  }

  console.log(`\nDone. Run "npm run dev" and open http://localhost:3000\n`)
}

const main = process.argv.includes('--clear') ? clear : seed

main()
  .catch((err) => {
    console.error(err.message ?? err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
