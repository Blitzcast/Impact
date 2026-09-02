import { and, eq, ne, notLike, inArray, sql } from 'drizzle-orm'
import { getDb, closeDb } from '../db/index'
import { artists, artistSnapshots } from '../db/schema'
import { getArtists } from '../lib/spotify'
import { spotPriceMicros } from '../lib/curve'

/**
 * THE JOB WITH A CLOCK ON IT.
 *
 * Spotify returns today's follower count and nothing else - there is no
 * historical endpoint anywhere in the API. Every day this does not run is a day
 * of price history that can never be recovered, for any amount of money.
 *
 * Run it daily. Safe to run more often: the unique index on
 * (artist, day, source) means repeat runs update today's row instead of
 * stacking duplicates, so a retry after a crash is free.
 */

/** UTC so the day boundary does not move when the host timezone does. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  const started = Date.now()
  const capturedOn = todayUtc()

  // Dead artists are skipped forever - their Spotify page 404s and would
  // otherwise fail this job every night for the rest of time.
  const db = getDb()
  const tracked = await db
    .select({ id: artists.id, spotifyId: artists.spotifyId, name: artists.name, supply: artists.supply })
    .from(artists)
    // Seeded demo artists have no real Spotify page. Fetching them would
    // return nothing and mark every one of them dead on the first run.
    .where(and(ne(artists.status, 'dead'), notLike(artists.spotifyId, 'seed:%')))

  if (tracked.length === 0) {
    console.log('No artists tracked yet. Add some first:  npm run add -- "artist name"')
    return
  }

  console.log(`Snapshotting ${tracked.length} artists for ${capturedOn}...`)

  const bySpotifyId = new Map(tracked.map((a) => [a.spotifyId, a]))
  const fetched = await getArtists(tracked.map((a) => a.spotifyId))
  const fetchedIds = new Set(fetched.map((a) => a.id))

  if (fetched.length > 0) {
    await db
      .insert(artistSnapshots)
      .values(
        fetched.map((a) => {
          const tracked = bySpotifyId.get(a.id)!
          return {
            artistId: tracked.id,
            capturedOn,
            source: 'spotify',
            followers: BigInt(a.followers),
            popularity: a.popularity,
            // Closing price for the day, so charts don't have to replay trades.
            supply: tracked.supply,
            priceMicros: spotPriceMicros(tracked.supply),
          }
        }),
      )
      // Re-running the job the same day corrects the row rather than duplicating it.
      .onConflictDoUpdate({
        target: [artistSnapshots.artistId, artistSnapshots.capturedOn, artistSnapshots.source],
        set: {
          followers: sql`excluded.followers`,
          popularity: sql`excluded.popularity`,
          supply: sql`excluded.supply`,
          priceMicros: sql`excluded.price_micros`,
        },
      })

    // Refresh the denormalized columns that list views read.
    for (const a of fetched) {
      await db
        .update(artists)
        .set({
          latestFollowers: BigInt(a.followers),
          latestPopularity: a.popularity,
          name: a.name,
          imageUrl: a.imageUrl,
          spotifyUrl: a.spotifyUrl,
        })
        .where(eq(artists.spotifyId, a.id))
    }
  }

  // Spotify returns null in place of an artist whose page is gone. Mark them
  // dead: trading halts, shares are worth zero, and this job stops retrying
  // them tomorrow. No redemption - a page going to zero is the same as any
  // other stock going to zero.
  const missing = tracked.filter((a) => !fetchedIds.has(a.spotifyId))
  if (missing.length > 0) {
    await db
      .update(artists)
      .set({ status: 'dead' })
      .where(inArray(artists.id, missing.map((a) => a.id)))
    console.log(`Marked ${missing.length} artist(s) dead: ${missing.map((a) => a.name).join(', ')}`)
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`Captured ${fetched.length} snapshots in ${elapsed}s.`)
}

main()
  .catch((err) => {
    console.error('Snapshot failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
