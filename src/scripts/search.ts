import { searchArtists } from '../lib/spotify'
import { seedSupplyFor, spotPriceMicros, marketCapMicros, formatMicros } from '../lib/curve'
import { UNVERIFIED_FOLLOWER_THRESHOLD } from '../lib/config'

/**
 * Preview what an artist would look like if listed, without listing them.
 *   npm run search -- "artist name"
 */
async function main() {
  const query = process.argv.slice(2).join(' ').trim()
  if (!query) {
    console.error('Usage: npm run search -- "artist name"')
    process.exitCode = 1
    return
  }

  const results = await searchArtists(query, 10)
  if (results.length === 0) {
    console.log(`No artists found for "${query}".`)
    return
  }

  console.log(`\nResults for "${query}":\n`)
  for (const a of results) {
    const supply = seedSupplyFor(a.followers)
    const price = formatMicros(spotPriceMicros(supply))
    const cap = formatMicros(marketCapMicros(supply), 0)
    // Most impersonator profiles are tiny. So are most real micro-artists,
    // which is why this warns instead of blocking.
    const flag = a.followers < UNVERIFIED_FOLLOWER_THRESHOLD ? '  [unverified]' : ''
    console.log(`  ${a.name}${flag}`)
    console.log(`    ${a.id}   ${a.followers.toLocaleString()} followers   pop ${a.popularity}`)
    console.log(`    would open at ${price}/share   cap ${cap}`)
    if (a.genres.length) console.log(`    ${a.genres.slice(0, 3).join(', ')}`)
    console.log()
  }
  console.log(`List one with:  npm run add -- <spotify-id>\n`)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exitCode = 1
})
