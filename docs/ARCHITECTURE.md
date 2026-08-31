# Architecture

Why things are the way they are. If you're contributing, read this first — most
of the surprising choices here are load-bearing.

---

## The bet

A market for artists where the interesting trade is a nobody with 200 monthly
listeners who might blow up — not Drake, whose price everyone already knows.

The product is **scouting**. Everything below either serves that or protects it.

Two numbers on every artist page:

- **Market price** — set by demand via the bonding curve. Moves because people buy.
- **Fundamentals score** — computed from real streaming stats. Moves because the artist grew.

**The gap between them is the game.** "Up 300% in listeners and the market
hasn't noticed" is the whole pitch. Either number alone is a dead spreadsheet or
a pure popularity contest.

---

## Product

**The long tail is the product.** If an artist has anything on a streaming
platform, they're listable. Trading superstars is boring; being early is the
thrill. This single requirement drives most of what follows.

**Lazy listing.** ~13M artists exist on Spotify and you can't pre-seed them. An
artist enters the DB when the first person lists them — and that person keeps a
permanent "first to list" badge. A technical constraint turned into a status
mechanic.

**Artists list themselves.** Every artist with a distributor wants a reason to
post about themselves, and "I'm on here, go buy my stock" drags their fans in
with them. Claimed artists earn a cut of fees on their own volume.

**No shorting.** "Stock" implies it, but a mechanic where users profit from a
real person failing is exactly the screenshot that ends you. For two-sided
action later: **milestone markets** — "hits 100k listeners by March?" — same
yes/no drama, nobody rooting for a human to flop.

---

## Economy

**Bonding curve, not an order book.** With a few hundred users and a long tail of
micro-artists, orders never match, nothing trades, and every chart is a flat
line. A curve is always liquid, needs no counterparty, and has no cold-start
problem. This isn't a preference — an order book cannot work at this scale.

**Linear curve** (`price = SLOPE × supply`) rather than the `supply^1.5` most
creator-token apps use. The integral of a line over integers is the triangular
number, so every cost is exact bigint arithmetic — no fractional powers, no
floats anywhere near money. Worth more than a marginally nicer curve shape.

**Seed supply is pre-minted from real follower counts.** Without it Drake and an
unknown both open at the same price, and Drake is free money. Calibrated so
market cap ≈ 20 currency per follower — the one sentence that makes the curve
intuitive.

What that produces:

| Followers | Opening price | A full 10k bankroll moves price |
|---|---|---|
| 100 | 0.63 | **+143%** |
| 25,000 | 9.99 | +1.0% |
| 10,000,000 | 199.85 | +0.0% |

Micro-artists are volatile enough that being early pays. Superstars are
effectively immovable — somewhere to park, not somewhere to win. The scouting
game falls out of the curve itself rather than being special-cased.

Run `npm run curve` to see this and verify the invariants.

**Money sinks, because inflation kills the scoreboard.** Every new user pours in
10,000. If nothing drains, total currency only grows, every price drifts up
regardless of any artist doing anything, and "up 300%" means everyone got rich
rather than that you were right. The scoreboard *is* the product.

Sinks, all of which **delete** currency rather than move it:

- Trade fees, burned — a fee paid to someone else is not a sink
- Listing an artist costs currency
- Cosmetics, later

And **no daily top-ups**, ever.

The listing fee does three jobs at once: it's a sink, it stops anyone
spam-listing 500 artists, and it puts a price tag on listing an impersonator
profile like "Drakè."

**Double-entry ledger; balances derived, never updated.** The single most
miserable thing here to retrofit, and it makes "why is my portfolio wrong"
answerable instead of a mystery.

---

## Anti-manipulation

This can't be immune. The goal is **cost of attack > expected payout**. Attack
effort scales with stakes, so defenses tighten as stakes rise rather than being
fixed at launch.

**Gaming the market price:**

- **Phone-verified accounts** — the root fix. Everything else is downstream;
  without it one person is many people and no other defense means anything.
- Per-account position caps as a % of an artist's supply
- Trade fees plus a sell cooldown, so wash trading bleeds money
- **Time-weighted holdings** for scoring, not end-of-period snapshots — a
  buzzer-beater pump scores zero

**Gaming the underlying stats.** "Objective scoring" doesn't remove manipulation,
it relocates it to buying fake streams, which is an existing industry with a
price list.

- **Require agreement across independent sources.** Farming one platform is
  cheap; farming three in sync is not. This is why `artist_snapshots` is keyed
  by source.
- **Percentile rank within a size cohort**, not raw growth. +4000% in the micro
  tier is an anomaly flag, not a jackpot.
- **Winsorize** — cap any single window's contribution to score.
- **Lag the scoring window.** The strongest single defense. Platforms strip
  fraudulent streams retroactively, so a bought spike evaporates before it ever
  scores while real growth survives the wait. Free fraud detection, borrowed
  from Spotify's own anti-fraud team.

The mechanisms are public on purpose — scoring nobody can inspect reads as
rigged, and you can't win that argument back once users believe it. Exact
thresholds move to environment variables once there's anything worth attacking.

---

## Precedents

**Football Index** (UK, collapsed 2021, ~£90M of user money gone). A football
"stockmarket" paying dividends on player performance, funded out of new user
deposits rather than external revenue. A ponzi with a good UI. **This is the
default shape you drift into if you aren't deliberate** — hence: payouts come
from fees or outside revenue, never from money entering.

**Bitclout / DeSo.** Pre-listed ~15,000 Twitter accounts without asking; the
backlash from the people being traded nearly ended it at launch. Not a legal
problem — a business one. Hence claim-your-page, fee share, and a delisting
valve.

**C.B.C. Distribution v. MLB Advanced Media** (8th Cir. 2007) and **Daniels v.
FanDuel** (Ind. 2018). Fantasy operators may use real people's names and public
statistics without a license. Names + public stats + a scoring game is
well-trodden ground; no artist's permission is required to list them.
Photographs are separate, and come through the Spotify API under Spotify's
terms rather than scraped.

---

## Rejected

| Rejected | Why |
|---|---|
| Order book | No liquidity at this scale. Dead market. |
| MusicBrainz as canonical key | Coverage of distributor-uploaded micro-artists is too thin, and the long tail is the product. Spotify ID instead. |
| Shorting | Users profiting from a real person failing. Milestone markets instead. |
| Dead-page redemption | Shares go to zero, same as any stock. The `dead` flag exists so the cron stops 404-ing, not to make holders whole. |
| Daily currency top-ups | Kills the economy fastest. |
| Redistributing fees | Not a sink. Money never leaves, inflation continues. |
| Mobile app first | Web first. Mobile-first is the classic six-months-to-nothing move. |

---

## Layout

```
src/
  db/schema.ts        every table, reasoning in comments
  lib/config.ts       every tunable number in the economy
  lib/curve.ts        bonding curve math, exact bigint
  lib/spotify.ts      API client, token caching, 429 backoff
  jobs/snapshot.ts    the daily job. the one with a clock on it.
  scripts/            search, add, curve-check
```

## Open questions

- Fundamentals score formula — which signals, what weights. Deltas matter more
  than absolutes, since a micro-artist's absolute numbers are near zero.
- Second and third data sources (Last.fm is free and generous; YouTube is
  available) — needed before cross-source agreement works at all.
- Where the seed calibration breaks once real users trade against it.
