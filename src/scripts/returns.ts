import { seedSupplyFor, buyCostMicros, sellProceedsMicros, spotPriceMicros, feeOn, formatMicros } from '../lib/curve'

/**
 * What does being early actually pay?
 *
 *   npm run returns
 *
 * Answers the only question a trader actually has: I got in first, other people
 * followed, what did I make? Re-run it after tuning anything in config.ts.
 */

/** You buy `yourShares`, then `followers` other people each buy `theirShares`. */
function scenario(followerCount: number, yourShares: bigint, others: number, theirShares: bigint) {
  const seed = seedSupplyFor(followerCount)

  const cost = buyCostMicros(seed, yourShares)
  const costWithFee = cost + feeOn(cost)
  const entryPrice = cost / yourShares

  // Everyone else piles in after you, pushing supply (and price) up.
  const supplyAfterCrowd = seed + yourShares + BigInt(others) * theirShares

  // You exit into that. Your shares are the last ones in, so you sell off the top.
  const proceeds = sellProceedsMicros(supplyAfterCrowd, yourShares)
  const proceedsAfterFee = proceeds - feeOn(proceeds)

  const multiple = Number((proceedsAfterFee * 1000n) / costWithFee) / 1000

  return {
    seed,
    openPrice: spotPriceMicros(seed),
    entryPrice,
    costWithFee,
    peakPrice: spotPriceMicros(supplyAfterCrowd),
    proceedsAfterFee,
    multiple,
  }
}

const tiers = [
  { label: 'nobody', followers: 100 },
  { label: 'tiny', followers: 1_000 },
  { label: 'small', followers: 25_000 },
  { label: 'mid', followers: 500_000 },
  { label: 'star', followers: 10_000_000 },
]

console.log('\nYou buy 1,000 shares. Then 20 other people each buy 1,000.\n')
console.log('  tier      followers      open      your entry       cost      peak     out      return')
console.log('  ' + '-'.repeat(88))

for (const t of tiers) {
  const r = scenario(t.followers, 1000n, 20, 1000n)
  console.log(
    '  ' + t.label.padEnd(9) +
    t.followers.toLocaleString().padStart(11) +
    formatMicros(r.openPrice).padStart(10) +
    formatMicros(r.entryPrice).padStart(13) +
    formatMicros(r.costWithFee, 0).padStart(11) +
    formatMicros(r.peakPrice).padStart(10) +
    formatMicros(r.proceedsAfterFee, 0).padStart(9) +
    `${r.multiple.toFixed(2)}x`.padStart(11),
  )
}

console.log('\n\nSame artist (1,000 followers), varying how big the crowd behind you is:\n')
console.log('  buyers after you        peak price       your return')
console.log('  ' + '-'.repeat(52))
for (const others of [1, 5, 20, 50, 200]) {
  const r = scenario(1_000, 1000n, others, 1000n)
  console.log(
    '  ' + String(others).padStart(10) +
    formatMicros(r.peakPrice).padStart(22) +
    `${r.multiple.toFixed(2)}x`.padStart(18),
  )
}

console.log('\n\nBeing EARLIER on the same artist (1,000 followers, 20 buyers total):\n')
console.log('  your position          entry price      your return')
console.log('  ' + '-'.repeat(52))
for (const rank of [0, 4, 9, 14, 19]) {
  const seed = seedSupplyFor(1_000)
  // Everyone ahead of you has already pushed the price up before you buy.
  const entrySupply = seed + BigInt(rank) * 1000n
  const cost = buyCostMicros(entrySupply, 1000n)
  const costWithFee = cost + feeOn(cost)
  const finalSupply = seed + 20n * 1000n
  const proceeds = sellProceedsMicros(finalSupply, 1000n)
  const net = proceeds - feeOn(proceeds)
  const multiple = Number((net * 1000n) / costWithFee) / 1000
  console.log(
    '  ' + `#${rank + 1} in`.padStart(10) +
    formatMicros(cost / 1000n).padStart(22) +
    `${multiple.toFixed(2)}x`.padStart(18),
  )
}

console.log('\nNote: this is price movement from TRADING only. Popularity growth')
console.log('currently moves none of these numbers - that is the open design question.\n')
