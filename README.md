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

**Spotify ID is the canonical key, not MusicBrainz.** MusicBrainz coverage of
distributor-uploaded micro-artists is too thin, and the long tail *is* the
product.

**A bonding curve, not an order book.** With a few hundred users and a long tail
of tiny artists, orders never match and every chart is a flat line. The curve is
always liquid and has no cold-start problem.

**Seed supply is pre-minted from real follower counts.** Otherwise a superstar
would open at the same price as an unknown and be free money. Market cap works
out to roughly 20 currency per follower, which is the one sentence that makes
the curve intuitive.

**Money is bigint micros. Shares are whole integers.** No floats anywhere in the
money path. The curve is linear specifically so every cost is a difference of
triangular numbers and therefore exact.

**Double-entry ledger. Balances are derived, never updated.** The one decision
here that's genuinely miserable to retrofit.

**Fees are burned, not redistributed.** A fee paid to someone else isn't a sink.
Without a real sink the money supply only grows, every price inflates regardless
of artist performance, and the scoreboard — which is the product — stops meaning
anything. Listing an artist also costs currency: a sink, a spam brake, and a
price tag on listing impersonator profiles, all in one.

**Growth scores on a 14-day lag.** Platforms strip fraudulent streams
retroactively, so bought spikes evaporate before they ever score while real
growth survives the wait. Free fraud detection, borrowed from Spotify.

**Growth ranks within a size cohort.** +4000% in the micro tier is an anomaly
flag, not a jackpot.

**Dead artists halt, no redemption.** Shares go to zero, same as any stock going
to zero. The status flag exists so the cron stops 404-ing forever, not to make
anyone whole.

**No shorting.** A mechanic where users profit from a real person failing is the
thing that gets screenshotted. Milestone markets ("hits 100k listeners by
March?") give the same two-sided action without pointing it at a human.

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
