/**
 * Every tunable number in the economy. Nothing else should hardcode these.
 *
 * All money is bigint MICROS. 1 unit of currency = 1_000_000 micros.
 */

export const MICROS = 1_000_000n

/** Convenience: currency units -> micros. */
export const units = (n: number): bigint => BigInt(Math.round(n * 1_000_000))

// ---------------------------------------------------------------------------
// Bonding curve
// ---------------------------------------------------------------------------

/**
 * Linear curve: spot price = SLOPE_MICROS * supply.
 *
 * Linear (rather than the s^1.5 you see in a lot of creator-token apps) is a
 * deliberate choice: the integral of a line over integers is the triangular
 * number, so every cost is EXACT bigint arithmetic with no fractional powers
 * and no floats anywhere near the money path.
 */
export const SLOPE_MICROS = 100n // 0.0001 currency per unit of supply

/**
 * Seed supply is pre-minted at listing from real follower counts, so a huge
 * artist does not open at the same price as an unknown one.
 *
 *   seed  = SEED_K * sqrt(followers)
 *   price = SLOPE * seed        ~= 0.063 * sqrt(followers)
 *   cap   = SLOPE * seed^2 / 2  ~= 20 * followers
 *
 * Market cap ends up linear in followers - "this artist is worth ~20 per
 * follower" - which is the one sentence that makes the whole curve intuitive.
 *
 *   100 followers  -> price   0.63,  cap      2,000
 *   10k followers  -> price   6.32,  cap    200,000
 *   1M followers   -> price  63.20,  cap 20,000,000
 */
export const SEED_K = 632
/** Floor so a zero-follower artist still opens at 0.1 instead of 0. */
export const MIN_SEED_SUPPLY = 1000n

// ---------------------------------------------------------------------------
// Money sinks - currency that leaves the game permanently
// ---------------------------------------------------------------------------

/**
 * Trade fee, in basis points. 50 = 0.5%.
 *
 * Swept in simulation across 200/100/50/25 bps: at 200 the economy burns ~91%
 * of its money supply and trading grinds down, at 50 it burns ~45% under
 * absurdly heavy churn. The fee is not what deters manipulation anyway - price
 * impact on a thin artist dwarfs it - so it can afford to be light.
 *
 * This is BURNED, not redistributed. If it were paid to anyone it would not be
 * a sink and the money supply would still only grow.
 *
 * Overridable by env so it can be swept in simulation, and so the production
 * value need not be committed once there is anything worth attacking.
 */
export const FEE_BPS = BigInt(process.env.FEE_BPS ?? 50)

/**
 * Cost to list a new artist. Does three jobs at once: it is a sink, it stops
 * anyone spam-listing 500 artists, and it puts a real price tag on listing an
 * impersonator profile like "Drake" with a diacritic.
 */
export const LISTING_FEE_MICROS = units(500)

/** One-time starting balance. There are deliberately NO daily top-ups. */
export const STARTING_BALANCE_MICROS = units(10_000)

// ---------------------------------------------------------------------------
// Anti-manipulation
// ---------------------------------------------------------------------------

/**
 * Growth is scored on a LAG. Platforms strip fraudulent streams retroactively,
 * so a bought spike evaporates before it ever scores while real growth survives
 * the wait. Free fraud detection, borrowed from Spotify's own anti-fraud team.
 */
export const CONFIRM_LAG_DAYS = 14

/** No single account may hold more than this share of one artist's supply. */
export const MAX_POSITION_BPS = 1500n // 15%

/** Minimum hold time before a position can be sold. Kills same-block pumps. */
export const SELL_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

/**
 * Artists below this follower count list as 'unverified' and render with a
 * warning. Most impersonator profiles are tiny; most real micro-artists are
 * too, so this warns rather than blocks.
 */
export const UNVERIFIED_FOLLOWER_THRESHOLD = 500

/** Size buckets for percentile ranking. Growth is only compared within a tier. */
export const COHORTS = [
  { name: 'micro', maxFollowers: 1_000 },
  { name: 'small', maxFollowers: 25_000 },
  { name: 'mid', maxFollowers: 500_000 },
  { name: 'large', maxFollowers: Number.MAX_SAFE_INTEGER },
] as const
