import { planBuy, planSell, ledgerRowsFor, type MarketState, type TraderState, type TradeError } from '../lib/trade'
import { seedSupplyFor, marketCapMicros, spotPriceMicros, formatMicros } from '../lib/curve'
import { STARTING_BALANCE_MICROS, MAX_POSITION_BPS, SELL_COOLDOWN_MS } from '../lib/config'

/**
 * Property-based simulation of the economy.
 *
 *   npm run simulate            -- default seed
 *   npm run simulate -- 12345   -- specific seed, for reproducing a failure
 *
 * Runs a large number of randomized trades across many users and artists and
 * asserts the invariants after EVERY SINGLE ONE. Unit tests check the cases you
 * thought of; this checks the sequences you didn't.
 *
 * The RNG is seeded and deterministic on purpose - a failing run is worthless
 * if you can't reproduce it.
 */

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) - same seed, same run, every time.
// ---------------------------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SimArtist extends MarketState {
  id: number
  name: string
  /** Currency actually deposited by real buyers. Never includes seeded shares. */
  reserveMicros: bigint
}

interface SimUser {
  id: number
  cashMicros: bigint
  positions: Map<number, bigint>
  lastBuyAt: Map<number, Date>
}

const SEED = Number(process.argv[2] ?? 20260901)
const N_USERS = 40
const N_ARTISTS = 25
const N_TRADES = 200_000

const rand = rng(SEED)
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!

// A realistic spread: mostly micro-artists, a few big ones. The long tail is
// the product, so the simulation should look like the product.
const followerTiers = [50, 200, 900, 4_000, 30_000, 250_000, 3_000_000]

const artists: SimArtist[] = Array.from({ length: N_ARTISTS }, (_, i) => {
  const followers = pick(followerTiers)
  const seed = seedSupplyFor(followers)
  return {
    id: i,
    name: `artist_${i}(${followers})`,
    status: followers < 500 ? 'unverified' : 'active',
    supply: seed,
    seedSupply: seed,
    reserveMicros: 0n,
  }
})

const users: SimUser[] = Array.from({ length: N_USERS }, (_, i) => ({
  id: i,
  cashMicros: STARTING_BALANCE_MICROS,
  positions: new Map(),
  lastBuyAt: new Map(),
}))

/** Total currency that existed at the start. This number must never change. */
const INITIAL_SUPPLY_MICROS = STARTING_BALANCE_MICROS * BigInt(N_USERS)
let burnedMicros = 0n

// Virtual clock, so the sell cooldown is actually exercised rather than
// accidentally blocking every sell in the run.
let now = new Date('2026-01-01T00:00:00Z')

// ---------------------------------------------------------------------------
// Invariants - checked after every trade
// ---------------------------------------------------------------------------

let failures = 0
/** Highest share-of-supply any holder reached, in basis points. */
let maxObservedBps = 0
function fail(msg: string, tradeIndex: number): never {
  failures++
  console.error(`\nINVARIANT VIOLATED at trade ${tradeIndex} (seed ${SEED})`)
  console.error(`  ${msg}\n`)
  throw new Error(msg)
}

function checkInvariants(i: number) {
  let totalCash = 0n
  for (const u of users) {
    // A user can never go negative. This is what stands between the economy
    // and someone printing money.
    if (u.cashMicros < 0n) fail(`user ${u.id} cash is negative: ${u.cashMicros}`, i)
    totalCash += u.cashMicros
    for (const [artistId, shares] of u.positions) {
      if (shares < 0n) fail(`user ${u.id} holds negative shares of ${artistId}`, i)
    }
  }

  let totalReserve = 0n
  for (const a of artists) {
    if (a.supply < a.seedSupply) fail(`artist ${a.id} supply fell below seed`, i)
    if (a.reserveMicros < 0n) fail(`artist ${a.id} reserve is negative`, i)

    // RESERVE SOLVENCY - the important one.
    //
    // Seeded shares were never paid for, so market cap is NOT a liability.
    // What must hold is that the reserve exactly covers every real share being
    // sold back at once. Because buy and sell are inverse triangular-number
    // differences, this is exact equality, not an inequality.
    const owed = marketCapMicros(a.supply) - marketCapMicros(a.seedSupply)
    if (a.reserveMicros !== owed) {
      fail(`artist ${a.id} reserve ${a.reserveMicros} != owed ${owed} (drift ${a.reserveMicros - owed})`, i)
    }

    // The position cap is deliberately NOT asserted globally here.
    //
    // It is an acquisition constraint, not a continuously held property: when
    // other users sell, supply shrinks and an already-compliant holder can drift
    // over the cap without trading at all. The system's actual promise is that
    // nobody can BUY past it - asserted at the point of every buy below.
    //
    // We measure the drift instead, because how far it drifts is worth knowing.
    for (const u of users) {
      const held = u.positions.get(a.id) ?? 0n
      if (held === 0n) continue
      const bps = Number(held * 10_000n / a.supply)
      if (bps > maxObservedBps) maxObservedBps = bps
    }
    totalReserve += a.reserveMicros
  }

  // CONSERVATION. Every micro is in exactly one of three places: someone's
  // cash, an artist's reserve, or burned. Nothing is created, nothing vanishes.
  const accounted = totalCash + totalReserve + burnedMicros
  if (accounted !== INITIAL_SUPPLY_MICROS) {
    fail(`money supply drifted: ${accounted} != ${INITIAL_SUPPLY_MICROS} (delta ${accounted - INITIAL_SUPPLY_MICROS})`, i)
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const rejections = new Map<TradeError, number>()
let buys = 0
let sells = 0

console.log(`\nSimulating ${N_TRADES.toLocaleString()} trades / ${N_USERS} users / ${N_ARTISTS} artists  (seed ${SEED})\n`)
const started = Date.now()

for (let i = 0; i < N_TRADES; i++) {
  // Advance the clock a random 0-30 minutes so cooldowns sometimes bite and
  // sometimes don't.
  now = new Date(now.getTime() + Math.floor(rand() * 30 * 60 * 1000))

  const user = pick(users)
  const artist = pick(artists)
  const held = user.positions.get(artist.id) ?? 0n

  const trader: TraderState = {
    cashMicros: user.cashMicros,
    positionShares: held,
    lastBuyAt: user.lastBuyAt.get(artist.id) ?? null,
  }

  // Sell more often when holding something, so positions actually unwind
  // rather than everyone just accumulating forever.
  const wantsSell = held > 0n && rand() < 0.45

  const qty = BigInt(1 + Math.floor(rand() ** 3 * 5000))
  const result = wantsSell
    ? planSell(artist, trader, qty > held ? held : qty, now)
    : planBuy(artist, trader, qty)

  if (!result.ok) {
    rejections.set(result.error, (rejections.get(result.error) ?? 0) + 1)
    continue
  }

  const { plan } = result

  // Throws if the rows don't sum to zero.
  ledgerRowsFor(plan)

  // Apply. This mirrors exactly what the database layer will do inside one
  // transaction, so a divergence here is a real bug there.
  if (plan.side === 'buy') {
    user.cashMicros -= plan.netMicros
    const after = held + plan.shares
    // THE GUARANTEE: a buy can never leave you over the cap.
    if (after * 10_000n > plan.supplyAfter * MAX_POSITION_BPS) {
      fail(`buy left user ${user.id} at ${after}/${plan.supplyAfter}, over the ${MAX_POSITION_BPS}bps cap`, i)
    }
    user.positions.set(artist.id, after)
    user.lastBuyAt.set(artist.id, now)
    buys++
  } else {
    user.cashMicros += plan.netMicros
    user.positions.set(artist.id, held - plan.shares)
    sells++
  }
  artist.supply = plan.supplyAfter
  artist.reserveMicros += plan.reserveDeltaMicros
  burnedMicros += plan.feeMicros

  checkInvariants(i)
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1)

console.log(`Executed: ${buys.toLocaleString()} buys, ${sells.toLocaleString()} sells in ${elapsed}s`)
console.log(`\nRejected (all expected - these are the guards doing their job):`)
for (const [reason, count] of [...rejections].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(8)}  ${reason}`)
}

let totalCash = 0n
for (const u of users) totalCash += u.cashMicros
let totalReserve = 0n
for (const a of artists) totalReserve += a.reserveMicros

console.log(`\nMoney supply:`)
console.log(`  user cash        ${formatMicros(totalCash, 0).padStart(16)}`)
console.log(`  artist reserves  ${formatMicros(totalReserve, 0).padStart(16)}`)
console.log(`  burned (sink)    ${formatMicros(burnedMicros, 0).padStart(16)}`)
console.log(`  ${'-'.repeat(35)}`)
console.log(`  total            ${formatMicros(totalCash + totalReserve + burnedMicros, 0).padStart(16)}`)
console.log(`  started with     ${formatMicros(INITIAL_SUPPLY_MICROS, 0).padStart(16)}`)

const burnPct = Number(burnedMicros * 10000n / INITIAL_SUPPLY_MICROS) / 100
console.log(`\n  ${burnPct.toFixed(2)}% of the starting money supply has been burned.`)

console.log(`\nPrice movement:`)
for (const a of [...artists].sort((x, y) => Number(y.supply - y.seedSupply) - Number(x.supply - x.seedSupply)).slice(0, 5)) {
  const open = spotPriceMicros(a.seedSupply)
  const nowPrice = spotPriceMicros(a.supply)
  const move = Number((nowPrice - open) * 10000n / open) / 100
  console.log(`  ${a.name.padEnd(22)} ${formatMicros(open).padStart(10)} -> ${formatMicros(nowPrice).padStart(10)}  (${move >= 0 ? '+' : ''}${move.toFixed(1)}%)`)
}

console.log(failures === 0 ? `\nAll invariants held across ${N_TRADES.toLocaleString()} trades.\n` : `\n${failures} FAILED\n`)
process.exitCode = failures === 0 ? 0 : 1
