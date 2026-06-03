import { pool } from './db.js';

// --- Users ---

export async function getAllUsers() {
  const { rows } = await pool.query(
    'SELECT id, name, nickname, email, password_hash AS "passwordHash", created_at AS "createdAt" FROM users ORDER BY id'
  );
  return rows;
}

export async function getUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, name, nickname, email, password_hash AS "passwordHash", created_at AS "createdAt" FROM users WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function getUserByNickname(nickname) {
  const { rows } = await pool.query(
    'SELECT id, name, nickname, email, password_hash AS "passwordHash", created_at AS "createdAt" FROM users WHERE LOWER(nickname) = LOWER($1)',
    [nickname]
  );
  return rows[0] ?? null;
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  return rows[0] ?? null;
}

export async function createUser({ name, nickname, email, passwordHash }) {
  const { rows } = await pool.query(
    'INSERT INTO users (name, nickname, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, nickname, email, created_at AS "createdAt"',
    [name, nickname, email.toLowerCase(), passwordHash]
  );
  return rows[0];
}

// --- Matches ---

export async function getAllMatches() {
  const { rows } = await pool.query(
    `SELECT id, source_num AS "sourceNum", round, "group", date, source_time AS "sourceTime",
            kickoff_utc AS "kickoffUtc", team_home AS "teamHome", team_away AS "teamAway",
            home_flag AS "homeFlag", away_flag AS "awayFlag", venue,
            home_score AS "homeScore", away_score AS "awayScore", status,
            result_updated_at AS "resultUpdatedAt", imported_at AS "importedAt", source
     FROM matches ORDER BY kickoff_utc`
  );
  return rows;
}

export async function getMatchById(id) {
  const { rows } = await pool.query(
    `SELECT id, source_num AS "sourceNum", round, "group", date, source_time AS "sourceTime",
            kickoff_utc AS "kickoffUtc", team_home AS "teamHome", team_away AS "teamAway",
            home_flag AS "homeFlag", away_flag AS "awayFlag", venue,
            home_score AS "homeScore", away_score AS "awayScore", status,
            result_updated_at AS "resultUpdatedAt", imported_at AS "importedAt", source
     FROM matches WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function upsertMatch(match) {
  await pool.query(
    `INSERT INTO matches (id, source_num, round, "group", date, source_time, kickoff_utc,
       team_home, team_away, home_flag, away_flag, venue,
       home_score, away_score, status, imported_at, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       source_num = EXCLUDED.source_num, round = EXCLUDED.round, "group" = EXCLUDED."group",
       date = EXCLUDED.date, source_time = EXCLUDED.source_time, kickoff_utc = EXCLUDED.kickoff_utc,
       team_home = EXCLUDED.team_home, team_away = EXCLUDED.team_away,
       home_flag = EXCLUDED.home_flag, away_flag = EXCLUDED.away_flag,
       venue = EXCLUDED.venue,
       home_score = COALESCE(EXCLUDED.home_score, matches.home_score),
       away_score = COALESCE(EXCLUDED.away_score, matches.away_score),
       status = EXCLUDED.status,
       imported_at = EXCLUDED.imported_at, source = EXCLUDED.source`,
    [
      match.id, match.sourceNum, match.round, match.group, match.date, match.sourceTime,
      match.kickoffUtc, match.teamHome, match.teamAway, match.homeFlag, match.awayFlag,
      match.venue, match.homeScore ?? null, match.awayScore ?? null, match.status,
      match.importedAt, match.source
    ]
  );
}

export async function resetMatchResult(id) {
  const { rows } = await pool.query(
    `UPDATE matches SET home_score = NULL, away_score = NULL, status = 'SCHEDULED', result_updated_at = NOW()
     WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows[0] ?? null;
}

export async function setMatchResult(id, homeScore, awayScore) {
  const { rows } = await pool.query(
    `UPDATE matches SET home_score = $2, away_score = $3, status = 'FINISHED', result_updated_at = NOW()
     WHERE id = $1
     RETURNING id, team_home AS "teamHome", team_away AS "teamAway",
               home_score AS "homeScore", away_score AS "awayScore", status,
               result_updated_at AS "resultUpdatedAt"`,
    [id, homeScore, awayScore]
  );
  return rows[0] ?? null;
}

// --- Tips ---

export async function getTipsByUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", match_id AS "matchId",
            home_score AS "homeScore", away_score AS "awayScore",
            is_captain AS "isCaptain",
            submitted_at AS "submittedAt", updated_at AS "updatedAt"
     FROM tips WHERE user_id = $1`,
    [userId]
  );
  return rows;
}

export async function getAllTips() {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", match_id AS "matchId",
            home_score AS "homeScore", away_score AS "awayScore",
            is_captain AS "isCaptain",
            submitted_at AS "submittedAt", updated_at AS "updatedAt"
     FROM tips`
  );
  return rows;
}

export async function upsertTip({ userId, matchId, homeScore, awayScore }) {
  await pool.query(
    `INSERT INTO tips (user_id, match_id, home_score, away_score)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, match_id) DO UPDATE SET
       home_score = EXCLUDED.home_score,
       away_score = EXCLUDED.away_score,
       updated_at = NOW()`,
    [userId, matchId, homeScore, awayScore]
  );
}

export async function setCaptain(userId, matchId, sectionMatchIds) {
  await pool.query(
    `UPDATE tips SET is_captain = FALSE
     WHERE user_id = $1 AND match_id = ANY($2::int[])`,
    [userId, sectionMatchIds]
  );
  await pool.query(
    `UPDATE tips SET is_captain = TRUE
     WHERE user_id = $1 AND match_id = $2`,
    [userId, matchId]
  );
}

export async function removeCaptain(userId, matchId) {
  await pool.query(
    `UPDATE tips SET is_captain = FALSE WHERE user_id = $1 AND match_id = $2`,
    [userId, matchId]
  );
}

export async function getTipByUserAndMatch(userId, matchId) {
  const { rows } = await pool.query(
    `SELECT id FROM tips WHERE user_id = $1 AND match_id = $2`,
    [userId, matchId]
  );
  return rows[0] ?? null;
}
