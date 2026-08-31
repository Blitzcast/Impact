import {
  SLOPE_MICROS, SEED_K, MIN_SEED_SUPPLY, FEE_BPS,
} from './config.js'

/**
 * Bonding curve math. Every function here is exact bigint arithmetic - there
 * is not a single float in the money path.
 *
 * Why a curve instead of an order book: with a few hundred users and a long
 * tail of micro-artists, orders never match, nothing ever trades, and every
 * chart is a flat line. A curve is always liquid, needs no counterparty, and
 * has no cold-start problem.
 *
 * Model: the Nth share ever minted costs exactly SLOPE * N micros.
 * So the cost of a range of shares is the difference of two triangular numbers.
 */

/** T(n) = n(n+1)/2. n*(n+1) is always even, so the division is exact. */
const triangular = (n: bigint): bigint => (n * (n + 1n)) / 2n

/** Current price of ONE share at a given supply. */
export function spotPriceMicros(supply: bigint): bigint {
  return SLOPE_MICROS * supply
}

/** Total value locked in the curve - the "market cap" of an artist. */
export function marketCapMicros(supply: bigint): bigint {
  return SLOPE_MICROS * triangular(supply)
}

/**
 * Cost to buy `shares` when supply is `supply`, before fees.
 * Mints shares numbered supply+1 .. supply+shares.
 */
export function buyCostMicros(supply: bigint, shares: bigint): bigint {
  if (shares <= 0n) throw new Error('shares must be positive')
  return SLOPE_MICROS * (triangular(supply + shares) - triangular(supply))
}

/**
 * Proceeds from selling `shares` when supply is `supply`, before fees.
 * Burns shares numbered supply-shares+1 .. supply.
 *
 * Deliberately the exact inverse of buyCostMicros: buying then immediately
 * selling returns the identical gross amount, so the curve itself never leaks
 * or creates value. Only fees do, and they go to the burn account.
 */
export function sellProceedsMicros(supply: bigint, shares: bigint): bigint {
  if (shares <= 0n) throw new Error('shares must be positive')
  if (shares > supply) throw new Error('cannot sell more than total supply')
  return SLOPE_MICROS * (triangular(supply) - triangular(supply - shares))
}

/** Fee on a gross amount. Always rounds in the house's favour, so it can never round to a loss. */
export function feeOn(grossMicros: bigint): bigint {
  return (grossMicros * FEE_BPS + 9_999n) / 10_000n
}

/**
 * Largest whole number of shares buyable with `budgetMicros` INCLUDING fee.
 * Binary search rather than solving the quadratic - exact in bigint, and
 * immune to the rounding drift a closed form would introduce.
 */
export function sharesForBudget(supply: bigint, budgetMicros: bigint): bigint {
  if (budgetMicros <= 0n) return 0n
  const affordable = (k: bigint): boolean => {
    const gross = buyCostMicros(supply, k)
    return gross + feeOn(gross) <= budgetMicros
  }
  if (!affordable(1n)) return 0n

  // Grow an upper bound until it fails, then bisect.
  let lo = 1n
  let hi = 2n
  while (affordable(hi)) {
    lo = hi
    hi *= 2n
  }
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n
    if (affordable(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Seed supply pre-minted when an artist is first listed, so their opening
 * price already reflects who they are. See config.ts for the calibration.
 *
 * Float math is fine here and only here: this runs once per artist at listing
 * time, is never part of a trade, and follower counts stay far below 2^53.
 */
export function seedSupplyFor(followers: number): bigint {
  const safe = Number.isFinite(followers) && followers > 0 ? followers : 0
  const seed = BigInt(Math.floor(SEED_K * Math.sqrt(safe)))
  return seed > MIN_SEED_SUPPLY ? seed : MIN_SEED_SUPPLY
}

/** Format micros for display. Presentation only - never feed this back into math. */
export function formatMicros(micros: bigint, decimals = 2): string {
  const neg = micros < 0n
  const abs = neg ? -micros : micros
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').slice(0, decimals)
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}${decimals > 0 ? '.' + frac : ''}`
}
