import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
}

// max:1 keeps the connection count low enough for serverless Postgres free
// tiers (Neon, Supabase) when the cron and a dev server run at the same time.
export const sql = postgres(url, { max: 1 })
export const db = drizzle(sql, { schema })
export { schema }
