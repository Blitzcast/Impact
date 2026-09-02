import { getMarket, type MarketRow } from '../src/db/queries'
import { formatMicros } from '../src/lib/curve'

// Prices change whenever anyone trades, so this page is never cached.
export const dynamic = 'force-dynamic'

function compactFollowers(n: bigint | null): string {
  if (n === null) return '--'
  const v = Number(n)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

function Delta({ bps }: { bps: number | null }) {
  if (bps === null) {
    // Honest about it: one snapshot is not a trend. This fills in on its own
    // once the daily job has run more than once.
    return <span className="delta num" data-dir="flat">--</span>
  }
  const pct = bps / 100
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  return (
    <span className="delta num" data-dir={dir}>
      {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

function MarketTable({ rows }: { rows: MarketRow[] }) {
  return (
    <table className="market">
      <thead>
        <tr>
          <th>#</th>
          <th>Artist</th>
          <th>Price</th>
          <th>Followers 7d</th>
          <th>Followers</th>
          <th>Market cap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id}>
            <td className="rank">{String(i + 1).padStart(2, '0')}</td>
            <td>
              <a href={`/artist/${r.id}`} className="artist-cell">
                {r.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="avatar" src={r.imageUrl} alt="" />
                  // An empty <img> renders as a broken box. A monogram reads as
                  // deliberate, and most micro-artists have no image at all.
                  : <span className="avatar avatar-fallback" aria-hidden="true">{r.name.trim().charAt(0).toUpperCase()}</span>}
                <span className="artist-name">{r.name}</span>
                {r.status === 'unverified' && <span className="tag">unverified</span>}
              </a>
            </td>
            <td className="price num">{formatMicros(r.priceMicros)}</td>
            <td><Delta bps={r.followerChangeBps} /></td>
            <td className="secondary num">{compactFollowers(r.followers)}</td>
            <td className="secondary num">{formatMicros(r.capMicros, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SetupPanel() {
  return (
    <div className="panel">
      <h2>No database connected</h2>
      <p>
        The app is running, but <code>DATABASE_URL</code> isn&apos;t set, so there&apos;s
        nothing to read. Three steps and this page fills in.
      </p>
      <ol className="steps">
        <li>Create a free Postgres project at <code>neon.tech</code> and copy the connection string.</li>
        <li>Paste it into <code>.env</code> as <code>DATABASE_URL</code>, along with your Spotify client ID and secret.</li>
        <li>Run <code>npm run db:push</code> to create the tables, then <code>npm run add -- &quot;artist name&quot;</code>.</li>
      </ol>
    </div>
  )
}

function EmptyPanel() {
  return (
    <div className="panel">
      <h2>No artists listed</h2>
      <p>
        The database is connected and the tables exist — nothing has been listed yet.
        List the first one and it appears here.
      </p>
      <ol className="steps">
        <li><code>npm run search -- &quot;artist name&quot;</code> to preview what they&apos;d open at.</li>
        <li><code>npm run add -- &lt;spotify-id&gt;</code> to list them.</li>
        <li><code>npm run snapshot</code> to capture today&apos;s stats. Run it daily — the history can&apos;t be backfilled.</li>
      </ol>
    </div>
  )
}

export default async function MarketPage() {
  const rows = await getMarket()

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Market</span>
        {rows && rows.length > 0 && (
          <span className="eyebrow">{rows.length} listed</span>
        )}
      </div>

      {rows === null ? <SetupPanel />
        : rows.length === 0 ? <EmptyPanel />
        : <MarketTable rows={rows} />}
    </>
  )
}
