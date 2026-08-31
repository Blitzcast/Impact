import {
  seedSupplyFor, spotPriceMicros, marketCapMicros,
  buyCostMicros, sellProceedsMicros, sharesForBudget, feeOn, formatMicros,
} from '../lib/curve.js'
import { STARTING_BALANCE_MICROS } from '../lib/config.js'

/**
 * Sanity check on the economy. No database, no network - pure math.
 *   npm run curve
 */

let failures = 0
function assert(label: string, cond: boolean, detail = '') {
  if (!cond) { failures++; console.log(`  FAIL  ${label} ${detail}`) }
  else console.log(`  ok    ${label}`)
}

console.log('\nOpening prices by follower count:\n')
const tiers = [0, 100, 1_000, 25_000, 500_000, 10_000_000, 100_000_000]
for (const f of tiers) {
  const s = seedSupplyFor(f)
  console.log(
    `  ${f.toLocaleString().padStart(13)} followers  ->  ` +
    `${formatMicros(spotPriceMicros(s)).padStart(10)}/share   ` +
    `cap ${formatMicros(marketCapMicros(s), 0).padStart(15)}`,
  )
}

console.log('\nWhat a full 10,000 bankroll does to each tier:\n')
for (const f of [100, 25_000, 10_000_000]) {
  const s = seedSupplyFor(f)
  const k = sharesForBudget(s, STARTING_BALANCE_MICROS)
  const before = spotPriceMicros(s)
  const after = spotPriceMicros(s + k)
  const move = Number((after - before) * 10000n / before) / 100
  console.log(
    `  ${f.toLocaleString().padStart(11)} followers: buys ${k.toLocaleString().padStart(9)} shares, ` +
    `price ${formatMicros(before)} -> ${formatMicros(after)}  (+${move.toFixed(1)}%)`,
  )
}

console.log('\nInvariants:\n')

// The curve must never create or destroy value on a round trip. If buy and
// sell were not exact inverses, someone would find the gap and farm it.
const s0 = seedSupplyFor(50_000)
const k = 12_345n
const bought = buyCostMicros(s0, k)
const sold = sellProceedsMicros(s0 + k, k)
assert('round trip is value-neutral before fees', bought === sold, `${bought} vs ${sold}`)

// Fees are the only leak, and they always leave the system.
const roundTripCost = feeOn(bought) + feeOn(sold)
assert('round trip costs the trader (fees)', bought - sold - roundTripCost < 0n)

// Price must rise monotonically with supply, or ordering breaks everywhere.
assert('price rises with supply', spotPriceMicros(s0 + 1n) > spotPriceMicros(s0))

// Budget sizing must never overspend - this is what stands between a user and
// a negative balance.
const budget = STARTING_BALANCE_MICROS
const affordable = sharesForBudget(s0, budget)
const cost = buyCostMicros(s0, affordable)
assert('sharesForBudget never overspends', cost + feeOn(cost) <= budget)
const oneMore = buyCostMicros(s0, affordable + 1n)
assert('sharesForBudget is maximal', oneMore + feeOn(oneMore) > budget)

// Buying in two steps must cost exactly what buying in one step costs,
// otherwise order splitting is an arbitrage.
const a = buyCostMicros(s0, 500n)
const b = buyCostMicros(s0 + 500n, 500n)
assert('splitting an order changes nothing', a + b === buyCostMicros(s0, 1000n))

console.log(failures === 0 ? '\nAll invariants hold.\n' : `\n${failures} FAILED\n`)
process.exitCode = failures === 0 ? 0 : 1
