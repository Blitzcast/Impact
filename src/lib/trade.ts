import { buyCostMicros, sellProceedsMicros, feeOn } from './curve'
import { MAX_POSITION_BPS, SELL_COOLDOWN_MS } from './config'

/**
 * Trade planning - PURE FUNCTIONS ONLY.
 *
 * Nothing here touches the database, the network, or the clock. It takes the
 * current state as arguments and returns what should happen. The database layer
 * is responsible for reading that state under a lock and writing the result.
 *
 * The split is deliberate: it means the entire economy can be simulated over
 * hundreds of thousands of randomized trades with no database at all, which is
 * what makes the invariants provable rather than merely spot-checked.
 * See src/scripts/simulate.ts.
 */

export type TradeError =
  | 'invalid_quantity'
  | 'artist_not_tradeable'
  | 'insufficient_funds'
  | 'insufficient_shares'
  | 'position_cap_exceeded'
  | 'cooldown_active'

export interface TradePlan {
  side: 'buy' | 'sell'
  shares: bigint
  /** Value moving through the curve, before fees. */
  grossMicros: bigint
  /** Fee, always burned - it leaves the money supply permanently. */
  feeMicros: bigint
  /** What actually leaves (buy) or enters (sell) the user's cash. */
  netMicros: bigint
  supplyBefore: bigint
  supplyAfter: bigint
  /** Change to the artist's reserve. Positive on buy, negative on sell. */
  reserveDeltaMicros: bigint
}

export type PlanResult =
  | { ok: true; plan: TradePlan }
  | { ok: false; error: TradeError }

/** Everything the planner needs to know. Read under a row lock by the caller. */
export interface MarketState {
  status: 'active' | 'unverified' | 'frozen' | 'dead'
  supply: bigint
  seedSupply: bigint
}

export interface TraderState {
  cashMicros: bigint
  positionShares: bigint
  lastBuyAt: Date | null
}

const TRADEABLE = new Set(['active', 'unverified'])

/**
 * Position cap, checked against supply AFTER the trade.
 *
 * Comparing cross-multiplied keeps this exact - dividing first would round and
 * let someone creep a fraction over the cap on every trade.
 *
 * IMPORTANT - what this does and does not guarantee. This is an ACQUISITION
 * constraint: nobody can *buy* their way past the cap. It is not a continuously
 * maintained property, because supply shrinks when other people sell, which can
 * push an already-compliant holder over the line through no action of their
 * own. Enforcing it continuously would mean force-liquidating someone because a
 * stranger sold, which is absurd.
 *
 * A holder who drifts over the cap simply cannot buy more until they are back
 * under it - which this check already handles, since positionAfter is compared
 * against the cap regardless of how it got there.
 *
 * Found by src/scripts/simulate.ts, not by reasoning about it beforehand.
 */
function exceedsPositionCap(positionAfter: bigint, supplyAfter: bigint): boolean {
  return positionAfter * 10_000n > supplyAfter * MAX_POSITION_BPS
}

export function planBuy(
  market: MarketState,
  trader: TraderState,
  shares: bigint,
): PlanResult {
  if (shares <= 0n) return { ok: false, error: 'invalid_quantity' }
  if (!TRADEABLE.has(market.status)) return { ok: false, error: 'artist_not_tradeable' }

  const grossMicros = buyCostMicros(market.supply, shares)
  const feeMicros = feeOn(grossMicros)
  const netMicros = grossMicros + feeMicros

  if (trader.cashMicros < netMicros) return { ok: false, error: 'insufficient_funds' }

  const supplyAfter = market.supply + shares
  if (exceedsPositionCap(trader.positionShares + shares, supplyAfter)) {
    return { ok: false, error: 'position_cap_exceeded' }
  }

  return {
    ok: true,
    plan: {
      side: 'buy',
      shares,
      grossMicros,
      feeMicros,
      netMicros,
      supplyBefore: market.supply,
      supplyAfter,
      // Every micro the buyer pays through the curve goes into the reserve.
      // The fee does not - it is burned.
      reserveDeltaMicros: grossMicros,
    },
  }
}

export function planSell(
  market: MarketState,
  trader: TraderState,
  shares: bigint,
  now: Date,
): PlanResult {
  if (shares <= 0n) return { ok: false, error: 'invalid_quantity' }
  if (!TRADEABLE.has(market.status)) return { ok: false, error: 'artist_not_tradeable' }
  if (trader.positionShares < shares) return { ok: false, error: 'insufficient_shares' }

  // Cooldown makes a buy-pump-sell round trip take real time, during which the
  // price can move against the manipulator. Combined with the fee, it is what
  // makes wash trading cost money instead of being free.
  if (trader.lastBuyAt && now.getTime() - trader.lastBuyAt.getTime() < SELL_COOLDOWN_MS) {
    return { ok: false, error: 'cooldown_active' }
  }

  // Seeded shares were never bought by anyone and must never be sellable.
  // Selling into them would drain reserve that nobody ever deposited.
  const realFloat = market.supply - market.seedSupply
  if (shares > realFloat) return { ok: false, error: 'insufficient_shares' }

  const grossMicros = sellProceedsMicros(market.supply, shares)
  const feeMicros = feeOn(grossMicros)
  const netMicros = grossMicros - feeMicros

  return {
    ok: true,
    plan: {
      side: 'sell',
      shares,
      grossMicros,
      feeMicros,
      netMicros,
      supplyBefore: market.supply,
      supplyAfter: market.supply - shares,
      reserveDeltaMicros: -grossMicros,
    },
  }
}

/**
 * The ledger rows a plan produces. They MUST sum to zero - that is what makes
 * it double-entry, and it is asserted on every single trade in the simulation.
 */
export interface LedgerRow {
  account: 'user_cash' | 'user_holdings' | 'mint' | 'burn'
  deltaMicros: bigint
}

export function ledgerRowsFor(plan: TradePlan): LedgerRow[] {
  const rows: LedgerRow[] =
    plan.side === 'buy'
      ? [
          { account: 'user_cash', deltaMicros: -plan.netMicros },
          { account: 'user_holdings', deltaMicros: plan.grossMicros },
          { account: 'burn', deltaMicros: plan.feeMicros },
        ]
      : [
          { account: 'user_cash', deltaMicros: plan.netMicros },
          { account: 'user_holdings', deltaMicros: -plan.grossMicros },
          { account: 'burn', deltaMicros: plan.feeMicros },
        ]

  const sum = rows.reduce((acc, r) => acc + r.deltaMicros, 0n)
  if (sum !== 0n) {
    // Unreachable by construction. If it ever fires, the bug is here and not
    // in the caller, and no trade should be allowed to proceed.
    throw new Error(`ledger rows do not balance: ${sum}`)
  }
  return rows
}
