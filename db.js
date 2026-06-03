import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      nickname    TEXT NOT NULL UNIQUE,
      email       TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS matches (
      id              INTEGER PRIMARY KEY,
      source_num      INTEGER,
      round           TEXT,
      "group"         TEXT,
      date            TEXT,
      source_time     TEXT,
      kickoff_utc     TIMESTAMPTZ,
      team_home       TEXT,
      team_away       TEXT,
      home_flag       TEXT,
      away_flag       TEXT,
      venue           TEXT,
      home_score      INTEGER,
      away_score      INTEGER,
      status          TEXT NOT NULL DEFAULT 'SCHEDULED',
      result_updated_at TIMESTAMPTZ,
      imported_at     TIMESTAMPTZ,
      source          TEXT
    );

    CREATE TABLE IF NOT EXISTS tips (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      match_id    INTEGER NOT NULL REFERENCES matches(id),
      home_score  INTEGER NOT NULL,
      away_score  INTEGER NOT NULL,
      is_captain  BOOLEAN NOT NULL DEFAULT FALSE,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, match_id)
    );

    ALTER TABLE tips ADD COLUMN IF NOT EXISTS is_captain BOOLEAN NOT NULL DEFAULT FALSE;
  `);
}
