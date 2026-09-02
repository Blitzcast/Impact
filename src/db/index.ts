import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

/**
 * The connection is created LAZILY, on first use rather than on import.
 *
 * That matters for the web app: a page that imports this must still be able to
 * render when DATABASE_URL isn't set, so it can show setup instructions instead
 * of crashing with a stack trace. Throwing at import time would take the whole
 * app down before any component ran.
 */

let _sql: ReturnType<typeof postgres> | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export const isDbConfigured = (): boolean => Boolean(process.env.DATABASE_URL)

export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
    }
    // max:1 keeps connection count low enough for serverless Postgres free
    // tiers when the cron and a dev server run at the same time.
    _sql = postgres(url, { max: 1 })
  }
  return _sql
}

export function getDb() {
  if (!_db) _db = drizzle(getSql(), { schema })
  return _db
}

/** Close the pool. Scripts should call this; the web app should not. */
export async function closeDb() {
  if (_sql) {
    await _sql.end()
    _sql = null
    _db = null
  }
}

export { schema }
