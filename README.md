# art_stock

A market for artists. Buy into someone before they blow up.

Play money, real data. Prices move because people trade; a separate fundamentals
score moves because the artist actually grew. The gap between those two numbers
is the game.

---

## Setup (about 10 minutes)

**1. Postgres.** Easiest is [neon.tech](https://neon.tech) — free tier, no card.
Create a project, copy the connection string.

**2. Spotify credentials.** [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
→ Create app. Redirect URI can be `http://localhost:3000` (unused — this only
uses the Client Credentials flow, which needs no user login). Copy the client ID
and secret.

**3. Wire it up.**

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, then:

```bash
npm run db:push
```

## Use it

```bash
npm run search -- "artist name"     # preview what an artist would list at
npm run add -- <spotify-id>         # list an artist
npm run snapshot                    # capture today's stats  <- run this daily
npm run curve                       # verify the economy's math (no db needed)
npm run db:studio                   # browse the database
```

**Set up the daily cron today**, before building anything else. Spotify returns
today's follower count and nothing else — there is no historical endpoint — so
every day the job doesn't run is a day of price history that can never be
recovered at any price. On Windows, Task Scheduler running `npm run snapshot`
daily is fine to start. Move it to a hosted cron when you deploy.

---

## Decisions already baked in

A bonding curve instead of an order book, Spotify IDs as the canonical key, seed
supply pre-minted from real follower counts, burned fees, a double-entry ledger,
and growth scored on a confirmation lag — each of those is load-bearing, and the
reasoning is in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

Contributions welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup and
where help is most useful.

## Layout

```
src/
  db/schema.ts        every table, with the reasoning in comments
  lib/config.ts       every tunable number in the economy
  lib/curve.ts        bonding curve math, exact bigint
  lib/spotify.ts      API client, token caching, 429 backoff
  jobs/snapshot.ts    the daily job. the one with a clock on it.
  scripts/            search, add, curve-check
```

## Next

- Trade endpoint — curve + fee + ledger write, in one transaction with
  `SELECT ... FOR UPDATE` on the artist row so concurrent buys can't price off
  stale supply
- Score job — computes `artist_scores` from snapshots on the lag window
- Next.js app on top: artist page showing market price and fundamentals score
  side by side, portfolio, leaderboard
- Claim-your-page flow — an artist listing themselves and posting the link is
  the cheapest distribution available
