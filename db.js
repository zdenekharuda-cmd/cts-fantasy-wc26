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
      email       TEXT,
      password_hash TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

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
      home_score  INTEGER,
      away_score  INTEGER,
      is_captain  BOOLEAN NOT NULL DEFAULT FALSE,
      bonus_player TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, match_id)
    );

    ALTER TABLE tips ADD COLUMN IF NOT EXISTS is_captain BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE tips ADD COLUMN IF NOT EXISTS bonus_player TEXT;
    ALTER TABLE tips ALTER COLUMN home_score DROP NOT NULL;
    ALTER TABLE tips ALTER COLUMN away_score DROP NOT NULL;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS czech_scorers TEXT[] NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS tournament_picks (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id),
      first_team   TEXT,
      second_team  TEXT,
      third_team   TEXT,
      scorer_team  TEXT,
      scorer_player TEXT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE tournament_picks ADD COLUMN IF NOT EXISTS scorer_team TEXT;
    ALTER TABLE tournament_picks ADD COLUMN IF NOT EXISTS scorer_player TEXT;
    ALTER TABLE tournament_picks ADD COLUMN IF NOT EXISTS assister_team TEXT;
    ALTER TABLE tournament_picks ADD COLUMN IF NOT EXISTS assister_player TEXT;

    CREATE TABLE IF NOT EXISTS tournament_stats (
      singleton INTEGER PRIMARY KEY DEFAULT 1,
      top_scorer_player TEXT,
      top_scorer_team TEXT,
      top_scorer_goals INTEGER,
      top_assister_player TEXT,
      top_assister_team TEXT,
      top_assister_assists INTEGER,
      updated_at TIMESTAMPTZ
    );
    INSERT INTO tournament_stats (singleton) VALUES (1) ON CONFLICT DO NOTHING;
    ALTER TABLE tournament_stats ADD COLUMN IF NOT EXISTS top_assister_player TEXT;
    ALTER TABLE tournament_stats ADD COLUMN IF NOT EXISTS top_assister_team TEXT;
    ALTER TABLE tournament_stats ADD COLUMN IF NOT EXISTS top_assister_assists INTEGER;
    ALTER TABLE tournament_stats ADD COLUMN IF NOT EXISTS top_assister_players TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE tournament_stats ADD COLUMN IF NOT EXISTS top_scorer_players TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE tournament_stats ADD COLUMN IF NOT EXISTS bracket_official JSONB NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS bracket_picks (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id),
      picks      JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
