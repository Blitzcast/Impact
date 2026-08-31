# Contributing

Early days — the data layer works, the app doesn't exist yet. That means most of
what's here is greenfield, which is a good time to show up.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. Most of the surprising
choices are load-bearing and the reasoning is written down.

## Setup

You need a Postgres URL ([neon.tech](https://neon.tech) free tier is fine) and
Spotify API credentials
([developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) →
Create app; the Client Credentials flow needs no user login).

```bash
npm install
cp .env.example .env    # then fill in the three values
npm run db:push
```

```bash
npm run curve           # verifies the economy's math, needs no db or network
```

That last one is the fastest way to confirm your checkout is sane.

## Ground rules

**No floats in the money path.** Money is `bigint` micros, shares are whole
integers. If you find yourself reaching for `Number` on anything involving a
balance or a price, something has gone wrong. The one sanctioned exception is
seed-supply calculation at listing time, and it's commented as such.

**Never update a balance.** Balances are derived by summing `ledger_entries`.
Every transaction writes rows that sum to zero.

**Every tunable number lives in `src/lib/config.ts`.** Don't hardcode an
economic constant anywhere else.

**Trades must be idempotent.** A double-tapped buy button is one trade.

## Where help is wanted

- **Trade endpoint** — curve + fee + ledger write in one transaction, with
  `SELECT ... FOR UPDATE` on the artist row so concurrent buys can't price off
  stale supply. The trickiest correctness work left.
- **Score job** — compute `artist_scores` from snapshots on the confirmation
  lag, with cohort percentile ranking.
- **Second data source** — Last.fm is free and generous. `artist_snapshots` is
  already keyed by source; cross-source agreement is a core anti-fraud
  mechanism and currently has nothing to agree with.
- **Next.js frontend** — artist page showing market price and fundamentals score
  side by side, portfolio, leaderboard.
- **Tests** — `src/scripts/curve-check.ts` is the current pattern. The ledger
  needs the same treatment.

## Pull requests

Run `npm run check` and `npm run curve` before opening one. Explain *why* in the
description — this codebase's comments are mostly about why, and PRs should
match. Small and focused beats large and comprehensive.

If you want to change something in the Rejected table in ARCHITECTURE.md, that's
fair game — but make the argument in an issue first, since those were deliberate.
