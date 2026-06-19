import { pool } from './db.js';
import { setTopScorer } from './store.js';

const API_URL = 'https://api.football-data.org/v4/competitions/2000/matches?status=FINISHED';
const SCORERS_URL = 'https://api.football-data.org/v4/competitions/2000/scorers?limit=20';

export async function syncResults(apiKey) {
  const response = await fetch(API_URL, {
    headers: { 'X-Auth-Token': apiKey }
  });

  if (response.status === 429) throw new Error('Rate limit překročen — zkus to za chvíli.');
  if (!response.ok) throw new Error(`football-data.org API error: ${response.status} ${response.statusText}`);

  const data = await response.json();
  const finished = (data.matches || []).filter(
    (m) => m.status === 'FINISHED' && m.score?.fullTime?.home !== null && m.score?.fullTime?.away !== null
  );

  let updated = 0;
  let skipped = 0;

  for (const apiMatch of finished) {
    const { rows } = await pool.query(
      `SELECT id, status FROM matches
       WHERE ABS(EXTRACT(EPOCH FROM (kickoff_utc - $1::timestamptz))) < 120`,
      [apiMatch.utcDate]
    );

    if (rows.length === 0 || rows[0].status === 'FINISHED') {
      skipped++;
      continue;
    }

    await pool.query(
      `UPDATE matches SET home_score = $2, away_score = $3, status = 'FINISHED', result_updated_at = NOW()
       WHERE id = $1`,
      [rows[0].id, apiMatch.score.fullTime.home, apiMatch.score.fullTime.away]
    );
    updated++;
  }

  let topScorer = null;
  try {
    const scorersRes = await fetch(SCORERS_URL, { headers: { 'X-Auth-Token': apiKey } });
    if (scorersRes.ok) {
      const scorersData = await scorersRes.json();
      const scorers = scorersData.scorers || [];
      if (scorers.length) {
        const maxGoals = scorers[0].goals;
        const leaders = scorers.filter((s) => s.goals === maxGoals && s.player?.name);
        topScorer = { players: leaders.map((s) => s.player.name), goals: maxGoals };
        await setTopScorer(topScorer);
      }
    }
  } catch {}

  return { updated, skipped, total: finished.length, topScorer };
}
