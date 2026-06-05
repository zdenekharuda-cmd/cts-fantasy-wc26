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
    [name, nickname, email ? email.toLowerCase() : null, passwordHash]
  );
  return rows[0];
}

// --- Matches ---

const MATCH_COLUMNS = `
  id, source_num AS "sourceNum", round, "group", date, source_time AS "sourceTime",
  kickoff_utc AS "kickoffUtc", team_home AS "teamHome", team_away AS "teamAway",
  home_flag AS "homeFlag", away_flag AS "awayFlag", venue,
  home_score AS "homeScore", away_score AS "awayScore", status,
  result_updated_at AS "resultUpdatedAt", imported_at AS "importedAt", source,
  czech_scorers AS "czechScorers"`;

export async function getAllMatches() {
  const { rows } = await pool.query(`SELECT ${MATCH_COLUMNS} FROM matches ORDER BY kickoff_utc`);
  return rows;
}

export async function getMatchById(id) {
  const { rows } = await pool.query(`SELECT ${MATCH_COLUMNS} FROM matches WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function setCzechScorers(matchId, scorers) {
  await pool.query(
    `UPDATE matches SET czech_scorers = $2 WHERE id = $1`,
    [matchId, scorers]
  );
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
            is_captain AS "isCaptain", bonus_player AS "bonusPlayer",
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
            is_captain AS "isCaptain", bonus_player AS "bonusPlayer",
            submitted_at AS "submittedAt", updated_at AS "updatedAt"
     FROM tips`
  );
  return rows;
}

export async function getGroupTeams() {
  const { rows } = await pool.query(`
    SELECT DISTINCT team_home AS team, home_flag AS flag FROM matches WHERE "group" IS NOT NULL
    UNION
    SELECT DISTINCT team_away, away_flag FROM matches WHERE "group" IS NOT NULL
    ORDER BY team
  `);
  return rows;
}

export async function getTournamentPicks(userId) {
  const { rows } = await pool.query(
    `SELECT first_team AS "firstTeam", second_team AS "secondTeam", third_team AS "thirdTeam",
            scorer_team AS "scorerTeam", scorer_player AS "scorerPlayer",
            assister_team AS "assisterTeam", assister_player AS "assisterPlayer",
            updated_at AS "updatedAt"
     FROM tournament_picks WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function getAllTournamentPicks() {
  const { rows } = await pool.query(
    `SELECT u.id AS "userId", u.nickname, u.name,
            tp.first_team AS "firstTeam", tp.second_team AS "secondTeam", tp.third_team AS "thirdTeam",
            tp.scorer_team AS "scorerTeam", tp.scorer_player AS "scorerPlayer",
            tp.assister_team AS "assisterTeam", tp.assister_player AS "assisterPlayer"
     FROM users u LEFT JOIN tournament_picks tp ON tp.user_id = u.id
     ORDER BY u.nickname`
  );
  return rows;
}

export async function saveTournamentPicks(userId, { firstTeam, secondTeam, thirdTeam }) {
  await pool.query(
    `INSERT INTO tournament_picks (user_id, first_team, second_team, third_team)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       first_team = EXCLUDED.first_team,
       second_team = EXCLUDED.second_team,
       third_team = EXCLUDED.third_team,
       updated_at = NOW()`,
    [userId, firstTeam || null, secondTeam || null, thirdTeam || null]
  );
}

export async function saveAssisterPick(userId, { assisterTeam, assisterPlayer }) {
  await pool.query(
    `INSERT INTO tournament_picks (user_id, assister_team, assister_player)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       assister_team = EXCLUDED.assister_team,
       assister_player = EXCLUDED.assister_player,
       updated_at = NOW()`,
    [userId, assisterTeam || null, assisterPlayer || null]
  );
}

export async function saveScorerPick(userId, { scorerTeam, scorerPlayer }) {
  await pool.query(
    `INSERT INTO tournament_picks (user_id, scorer_team, scorer_player)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       scorer_team = EXCLUDED.scorer_team,
       scorer_player = EXCLUDED.scorer_player,
       updated_at = NOW()`,
    [userId, scorerTeam || null, scorerPlayer || null]
  );
}

export async function saveBonusTip(userId, matchId, bonusPlayer) {
  await pool.query(
    `UPDATE tips SET bonus_player = $3 WHERE user_id = $1 AND match_id = $2`,
    [userId, matchId, bonusPlayer || null]
  );
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

export async function ensureTipRow(userId, matchId) {
  await pool.query(
    `INSERT INTO tips (user_id, match_id) VALUES ($1, $2) ON CONFLICT (user_id, match_id) DO NOTHING`,
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
