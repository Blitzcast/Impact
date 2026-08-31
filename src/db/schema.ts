import {
  pgTable, pgEnum, uuid, text, integer, bigint, boolean,
  timestamp, date, numeric, uniqueIndex, index, primaryKey,
} from 'drizzle-orm/pg-core'

/**
 * UNITS - read this before touching any number in this file.
 *
 *   Money  : bigint, in MICROS. 1_000_000 micros = 1 unit of in-game currency.
 *   Shares : bigint, whole shares only. No fractional shares.
 *
 * There are no floats anywhere in the money path. Every price is derived by
 * exact integer arithmetic from `artists.supply` (see src/lib/curve.ts).
 */

export const artistStatus = pgEnum('artist_status', [
  'active',     // normal trading
  'unverified', // below the follower threshold - shown with a warning
  'frozen',     // trading halted (impersonation report, dispute)
  'dead',       // catalog gone. trading halts, shares are worth zero, no redemption.
])

export const tradeSide = pgEnum('trade_side', ['buy', 'sell'])

/**
 * Double-entry accounts. Every transaction writes rows that sum to exactly zero.
 *
 * `user_cash`     - a user's spendable balance
 * `user_holdings` - value a user has locked into shares
 * `mint`          - counterparty for curve-minted shares
 * `burn`          - THE SINK. Currency that entered here has left the game
 *                   permanently and is never paid to anyone. Fees and listing
 *                   costs land here. Without this the money supply only grows
 *                   and every price inflates regardless of artist performance.
 */
export const ledgerAccount = pgEnum('ledger_account', [
  'user_cash', 'user_holdings', 'mint', 'burn',
])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  handle: text('handle').notNull(),
  // Sybil resistance is the root defense against market manipulation.
  // Every other protection in this schema is downstream of this column.
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_email_idx').on(t.email),
  uniqueIndex('users_handle_idx').on(t.handle),
])

export const artists = pgTable('artists', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Spotify ID is the canonical key, NOT MusicBrainz. MusicBrainz coverage of
  // distributor-uploaded micro-artists is too thin, and the long tail is the product.
  spotifyId: text('spotify_id').notNull(),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  spotifyUrl: text('spotify_url'),
  status: artistStatus('status').notNull().default('active'),

  /**
   * supply = seedSupply + every share minted by a buy, minus every share burned
   * by a sell. Price is a pure function of this single number. seedSupply is
   * pre-minted from real follower counts at listing time so a huge artist does
   * not open at the same price as an unknown one.
   */
  supply: bigint('supply', { mode: 'bigint' }).notNull(),
  seedSupply: bigint('seed_supply', { mode: 'bigint' }).notNull(),

  // Denormalized latest stats, refreshed by the snapshot job. Charts read from
  // artist_snapshots; list views read these.
  latestFollowers: bigint('latest_followers', { mode: 'bigint' }),
  latestPopularity: integer('latest_popularity'),
  // Follower count at listing time, so "growth since listed" survives even if
  // the snapshot history is ever rebuilt.
  followersAtListing: bigint('followers_at_listing', { mode: 'bigint' }),

  // "First to list this artist" - permanent, and the best badge in the game.
  listedByUserId: uuid('listed_by_user_id').references(() => users.id),
  listedAt: timestamp('listed_at', { withTimezone: true }).notNull().defaultNow(),
  // What the lister paid to list. A sink, a spam brake, and a price tag on
  // listing impersonator profiles - one column doing three jobs.
  listingFeeMicros: bigint('listing_fee_micros', { mode: 'bigint' }).notNull().default(0n),

  // Artist claimed their own page. Claimed artists earn a cut of fees on their
  // own volume, which turns them from hostile into a distribution channel.
  claimedByUserId: uuid('claimed_by_user_id').references(() => users.id),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  // Set when an artist asks to be delisted. Cheap insurance, rarely used.
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('artists_spotify_id_idx').on(t.spotifyId),
  index('artists_status_idx').on(t.status),
])

/**
 * The table with a clock on it. Spotify returns today's number and nothing
 * else - there is no historical endpoint - so every day this job does not run
 * is a day of price history that can never be recovered.
 *
 * One row per artist per source per day. Multiple sources on purpose: farming
 * one platform's numbers is cheap, farming three in agreement is not.
 */
export const artistSnapshots = pgTable('artist_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  artistId: uuid('artist_id').notNull().references(() => artists.id, { onDelete: 'cascade' }),
  capturedOn: date('captured_on').notNull(),
  source: text('source').notNull().default('spotify'),
  followers: bigint('followers', { mode: 'bigint' }),
  popularity: integer('popularity'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Makes the job safely re-runnable - run it five times in a day, still one row.
  uniqueIndex('snapshots_artist_day_source_idx').on(t.artistId, t.capturedOn, t.source),
  index('snapshots_artist_time_idx').on(t.artistId, t.capturedOn),
])

/**
 * Fundamentals score, computed from snapshots on a LAG.
 *
 * `confirmedGrowth` deliberately trails by CONFIRM_LAG_DAYS. Platforms strip
 * fraudulent streams retroactively, so a bought spike evaporates before it ever
 * scores while real growth survives the wait. This borrows Spotify's anti-fraud
 * team for free and is the strongest single defense in the system.
 *
 * Every column here is meant to be rendered on the artist page. Black-box
 * scoring in anything money-adjacent reads as rigged, and you cannot win that
 * argument back once users believe it.
 */
export const artistScores = pgTable('artist_scores', {
  artistId: uuid('artist_id').notNull().references(() => artists.id, { onDelete: 'cascade' }),
  computedOn: date('computed_on').notNull(),
  growth7d: numeric('growth_7d', { precision: 12, scale: 6 }),
  growth30d: numeric('growth_30d', { precision: 12, scale: 6 }),
  confirmedGrowth: numeric('confirmed_growth', { precision: 12, scale: 6 }),
  // Rank within a size cohort, not raw growth. +4000% in the micro tier is an
  // anomaly flag, not a jackpot.
  cohort: text('cohort'),
  cohortPercentile: numeric('cohort_percentile', { precision: 6, scale: 4 }),
  score: numeric('score', { precision: 12, scale: 4 }),
  anomalyFlag: boolean('anomaly_flag').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.artistId, t.computedOn] })])

export const trades = pgTable('trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  side: tradeSide('side').notNull(),
  shares: bigint('shares', { mode: 'bigint' }).notNull(),
  grossMicros: bigint('gross_micros', { mode: 'bigint' }).notNull(),
  feeMicros: bigint('fee_micros', { mode: 'bigint' }).notNull(),
  netMicros: bigint('net_micros', { mode: 'bigint' }).notNull(),
  supplyBefore: bigint('supply_before', { mode: 'bigint' }).notNull(),
  supplyAfter: bigint('supply_after', { mode: 'bigint' }).notNull(),
  // Double-tapping the buy button must not buy twice.
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('trades_idempotency_idx').on(t.idempotencyKey),
  index('trades_user_time_idx').on(t.userId, t.createdAt),
  index('trades_artist_time_idx').on(t.artistId, t.createdAt),
])

/**
 * Immutable double-entry ledger. Balances are DERIVED by summing these rows.
 * Never UPDATE a balance - it is the one decision here that is genuinely
 * miserable to retrofit, and it makes "why is my portfolio wrong" answerable.
 */
export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Groups the rows of one transaction. Rows sharing a txId sum to zero.
  txId: uuid('tx_id').notNull(),
  tradeId: uuid('trade_id').references(() => trades.id),
  userId: uuid('user_id').references(() => users.id),
  account: ledgerAccount('account').notNull(),
  deltaMicros: bigint('delta_micros', { mode: 'bigint' }).notNull(),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ledger_tx_idx').on(t.txId),
  index('ledger_user_account_idx').on(t.userId, t.account),
])

/**
 * Cache of current holdings. Rebuildable from `trades` at any time - if this
 * ever disagrees with the trade log, the trade log is right.
 */
export const positions = pgTable('positions', {
  userId: uuid('user_id').notNull().references(() => users.id),
  artistId: uuid('artist_id').notNull().references(() => artists.id),
  shares: bigint('shares', { mode: 'bigint' }).notNull().default(0n),
  costBasisMicros: bigint('cost_basis_micros', { mode: 'bigint' }).notNull().default(0n),
  // Sell cooldown: makes wash trading bleed fees instead of being free.
  lastBuyAt: timestamp('last_buy_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.artistId] })])

/**
 * Contest wrapper, stubbed until prizes turn on. Real cash prizes are legal as
 * a sweepstakes: free entry, fixed prize announced in advance. That is why
 * entryFee defaults to 0 and the prize is set at creation rather than scaled by
 * entrant count. Scoring is time-weighted so a buzzer-beater pump scores zero.
 */
export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  entryFeeMicros: bigint('entry_fee_micros', { mode: 'bigint' }).notNull().default(0n),
  prizeDescription: text('prize_description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const seasonEntries = pgTable('season_entries', {
  seasonId: uuid('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  // Time-weighted, not a snapshot of final value.
  scoreMicros: bigint('score_micros', { mode: 'bigint' }).notNull().default(0n),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.seasonId, t.userId] })])
