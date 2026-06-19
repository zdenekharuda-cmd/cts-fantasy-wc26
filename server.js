import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';

import { initDb } from './db.js';
import {
  getAllUsers, getUserById, getUserByNickname, getUserByEmail, createUser,
  getAllMatches, getMatchById, setMatchResult, resetMatchResult,
  getTipsByUser, getAllTips, upsertTip, setCaptain, removeCaptain, getTipByUserAndMatch, saveBonusTip, setCzechScorers, ensureTipRow,
  getGroupTeams, getTournamentPicks, getAllTournamentPicks, saveTournamentPicks, saveScorerPick, saveAssisterPick,
  getTipsByMatch, getTopScorer, getTopAssister
} from './store.js';
import { calculateTipPoints, isMatchFinished } from './scoring.js';
import { syncOpenFootball } from './syncOpenFootball.js';
import { syncResults } from './syncResults.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const FIVE_MINUTES_MS = 5 * 60 * 1000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })
);
app.use(express.static(__dirname));

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, nickname: user.nickname, email: user.email };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'You need to log in first.' });
  }
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'You need to log in first.' });
  const adminNickname = process.env.ADMIN_NICKNAME;
  if (!adminNickname) return res.status(403).json({ error: 'ADMIN_NICKNAME is not configured on the server.' });
  const user = await getUserById(req.session.userId);
  if (!user || user.nickname !== adminNickname) return res.status(403).json({ error: 'Přístup odepřen.' });
  next();
}

function normalizeScore(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 99) return null;
  return number;
}

function matchSectionKey(round) {
  const num = parseInt((round || '').replace('Matchday ', ''), 10);
  if (!isNaN(num)) {
    if (num <= 7) return '1';
    if (num <= 13) return '2';
    return '3';
  }
  return 'knockout';
}

function matchIsTipLocked(match, now = Date.now()) {
  const kickoff = new Date(match.kickoffUtc).getTime();
  return Number.isFinite(kickoff) && kickoff - now <= FIVE_MINUTES_MS;
}

function enrichMatchForUser(match, tip = null) {
  const locked = matchIsTipLocked(match);
  const finished = isMatchFinished(match);
  const basePoints = finished && tip ? calculateTipPoints(tip, match) : null;
  const bonusHit = finished && tip?.bonusPlayer && Array.isArray(match.czechScorers) && match.czechScorers.includes(tip.bonusPlayer);
  return {
    ...match,
    locked,
    finished,
    tip: tip
      ? {
          homeScore: tip.homeScore,
          awayScore: tip.awayScore,
          isCaptain: tip.isCaptain ?? false,
          bonusPlayer: tip.bonusPlayer ?? null,
          bonusHit: bonusHit ?? false,
          submittedAt: tip.submittedAt,
          updatedAt: tip.updatedAt,
          points: basePoints !== null ? (tip.isCaptain ? basePoints * 2 : basePoints) : null
        }
      : null
  };
}

app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/tips.html' : '/login.html');
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await getUserById(req.session.userId);
  res.json({ user: publicUser(user) });
});

app.post('/api/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const nickname = String(req.body.nickname || '').trim();
  const inviteCode = String(req.body.inviteCode || '');
  const password = String(req.body.password || '');

  if (!name || !nickname || !inviteCode || !password) {
    return res.status(400).json({ error: 'Všechna pole jsou povinná.' });
  }
  if (inviteCode !== (process.env.INVITE_CODE || 'Hardy007')) {
    return res.status(403).json({ error: 'Registrace pouze pro zvané.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Heslo musí mít alespoň 8 znaků.' });
  }

  const nicknameTaken = await getUserByNickname(nickname);
  if (nicknameTaken) return res.status(409).json({ error: 'Tato přezdívka je již obsazena.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser({ name, nickname, email: null, passwordHash });
  req.session.userId = user.id;

  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const nickname = String(req.body.nickname || '').trim();
  const password = String(req.body.password || '');
  const user = await getUserByNickname(nickname);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid nickname or password.' });
  }

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/matches', requireAuth, async (req, res) => {
  const [matches, tips] = await Promise.all([
    getAllMatches(),
    getTipsByUser(req.session.userId)
  ]);
  const userTipsByMatch = new Map(tips.map((tip) => [Number(tip.matchId), tip]));

  res.json({
    matches: matches.map((match) => enrichMatchForUser(match, userTipsByMatch.get(Number(match.id))))
  });
});

app.post('/api/tips/batch', requireAuth, async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [];
  const results = { saved: 0 };

  for (const entry of entries) {
    const matchId = Number(entry.matchId);
    const homeScore = normalizeScore(entry.homeScore);
    const awayScore = normalizeScore(entry.awayScore);

    if (!Number.isInteger(matchId) || homeScore === null || awayScore === null) continue;

    const match = await getMatchById(matchId);
    if (!match || matchIsTipLocked(match)) continue;

    await upsertTip({ userId: req.session.userId, matchId, homeScore, awayScore });
    results.saved++;
  }

  res.json(results);
});

app.post('/api/tips/:matchId', requireAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  const homeScore = normalizeScore(req.body.homeScore);
  const awayScore = normalizeScore(req.body.awayScore);

  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });
  if (homeScore === null || awayScore === null) {
    return res.status(400).json({ error: 'Scores must be whole numbers between 0 and 99.' });
  }

  const match = await getMatchById(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (matchIsTipLocked(match)) {
    return res.status(423).json({ error: 'Tips are locked 5 minutes before kick-off.' });
  }

  await upsertTip({ userId: req.session.userId, matchId, homeScore, awayScore });
  res.json({ ok: true });
});

app.post('/api/tips/:matchId/captain', requireAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });

  const match = await getMatchById(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (matchIsTipLocked(match)) return res.status(423).json({ error: 'Tips are locked 5 minutes before kick-off.' });

  await ensureTipRow(req.session.userId, matchId);
  const [allMatches, userTips] = await Promise.all([getAllMatches(), getTipsByUser(req.session.userId)]);
  const section = matchSectionKey(match.round);
  const sectionMatches = allMatches.filter((m) => matchSectionKey(m.round) === section);

  const captainTip = userTips.find((t) => t.isCaptain && sectionMatches.some((m) => m.id === Number(t.matchId)));
  const captainMatch = captainTip ? sectionMatches.find((m) => m.id === Number(captainTip.matchId)) : null;
  if (captainMatch && (matchIsTipLocked(captainMatch) || isMatchFinished(captainMatch))) {
    return res.status(423).json({ error: 'Captain is locked — your captain\'s match has already started or been played.' });
  }

  await setCaptain(req.session.userId, matchId, sectionMatches.map((m) => m.id));
  res.json({ ok: true });
});

app.delete('/api/tips/:matchId/captain', requireAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });

  const match = await getMatchById(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });

  const [allMatches, userTips] = await Promise.all([getAllMatches(), getTipsByUser(req.session.userId)]);
  const section = matchSectionKey(match.round);
  const sectionMatches = allMatches.filter((m) => matchSectionKey(m.round) === section);

  const captainTip = userTips.find((t) => t.isCaptain && sectionMatches.some((m) => m.id === Number(t.matchId)));
  const captainMatch = captainTip ? sectionMatches.find((m) => m.id === Number(captainTip.matchId)) : null;
  if (captainMatch && (matchIsTipLocked(captainMatch) || isMatchFinished(captainMatch))) {
    return res.status(423).json({ error: 'Captain is locked — your captain\'s match has already started or been played.' });
  }

  await removeCaptain(req.session.userId, matchId);
  res.json({ ok: true });
});


const SCORER_BONUS_POINTS = 5;
const ASSISTER_BONUS_POINTS = 5;

app.get('/api/scoreboard', async (req, res) => {
  const [users, matches, tips, topScorer, topAssister, tournamentPicks] = await Promise.all([
    getAllUsers(),
    getAllMatches(),
    getAllTips(),
    getTopScorer(),
    getTopAssister(),
    getAllTournamentPicks()
  ]);

  const finishedMatches = matches.filter(isMatchFinished);
  const matchById = new Map(matches.map((match) => [Number(match.id), match]));
  const pickByUser = new Map(tournamentPicks.map((p) => [p.userId, p]));

  const rows = users.map((user) => {
    const userTips = tips.filter((tip) => tip.userId === user.id);
    let totalPoints = 0;
    let exactScores = 0;
    let scoredTips = 0;

    for (const tip of userTips) {
      const match = matchById.get(Number(tip.matchId));
      if (!match || !isMatchFinished(match)) continue;
      const base = calculateTipPoints(tip, match) ?? 0;
      const points = tip.isCaptain ? base * 2 : base;
      totalPoints += points;
      scoredTips += 1;
      if (base === 3) exactScores += 1;
      if (tip.bonusPlayer && Array.isArray(match.czechScorers) && match.czechScorers.includes(tip.bonusPlayer)) {
        totalPoints += 2;
      }
    }

    const pick = pickByUser.get(user.id);
    const scorerHit = !!(topScorer && pick?.scorerPlayer && topScorer.players.includes(pick.scorerPlayer));
    const assisterHit = !!(topAssister && pick?.assisterPlayer && topAssister.players.includes(pick.assisterPlayer));
    const potentialPoints = (scorerHit ? SCORER_BONUS_POINTS : 0) + (assisterHit ? ASSISTER_BONUS_POINTS : 0);

    return { userId: user.id, name: user.name, nickname: user.nickname, totalPoints, exactScores, scoredTips, potentialPoints, scorerHit, assisterHit };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactScores !== a.exactScores) return b.exactScores - a.exactScores;
    return a.nickname.localeCompare(b.nickname);
  });

  res.json({ finishedMatches: finishedMatches.length, users: rows, topScorer, topAssister });
});

app.post('/api/tips/:matchId/bonus', requireAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });

  const match = await getMatchById(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (matchIsTipLocked(match)) return res.status(423).json({ error: 'Tips are locked 5 minutes before kick-off.' });

  await ensureTipRow(req.session.userId, matchId);
  const bonusPlayer = String(req.body.bonusPlayer || '').trim() || null;
  await saveBonusTip(req.session.userId, matchId, bonusPlayer);
  res.json({ ok: true });
});

app.get('/api/matches/:matchId/tips', requireAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });

  const match = await getMatchById(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!matchIsTipLocked(match) && !isMatchFinished(match)) {
    return res.status(403).json({ error: 'Tips are not yet visible.' });
  }

  const tips = await getTipsByMatch(matchId);
  const finished = isMatchFinished(match);

  const result = tips.map((tip) => {
    const base = finished ? calculateTipPoints(tip, match) : null;
    const points = base !== null ? (tip.isCaptain ? base * 2 : base) : null;
    return { nickname: tip.nickname, homeScore: tip.homeScore, awayScore: tip.awayScore, isCaptain: tip.isCaptain ?? false, points };
  });

  if (finished) {
    result.sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || a.nickname.localeCompare(b.nickname));
  }

  res.json({ tips: result, finished });
});

app.get('/api/scoreboard/:userId/tips', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id.' });

  const [matches, tips] = await Promise.all([getAllMatches(), getTipsByUser(userId)]);
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const scored = tips
    .map((tip) => {
      const match = matchById.get(Number(tip.matchId));
      if (!match || !isMatchFinished(match)) return null;
      const base = calculateTipPoints(tip, match) ?? 0;
      const points = tip.isCaptain ? base * 2 : base;
      const bonusHit = tip.bonusPlayer && Array.isArray(match.czechScorers) && match.czechScorers.includes(tip.bonusPlayer);
      return {
        matchId: match.id,
        round: match.round,
        kickoffUtc: match.kickoffUtc,
        teamHome: match.teamHome,
        teamAway: match.teamAway,
        homeFlag: match.homeFlag,
        awayFlag: match.awayFlag,
        actualHome: match.homeScore,
        actualAway: match.awayScore,
        tipHome: tip.homeScore,
        tipAway: tip.awayScore,
        isCaptain: tip.isCaptain ?? false,
        bonusPlayer: tip.bonusPlayer ?? null,
        bonusHit: bonusHit ?? false,
        basePoints: base,
        points,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));

  res.json({ tips: scored });
});

app.get('/api/tournament/teams', async (req, res) => {
  const teams = await getGroupTeams();
  res.json({ teams });
});

app.get('/api/tournament/picks/me', requireAuth, async (req, res) => {
  const picks = await getTournamentPicks(req.session.userId);
  const allMatches = await getAllMatches();
  const firstMatch = allMatches.reduce((min, m) => !min || new Date(m.kickoffUtc) < new Date(min.kickoffUtc) ? m : min, null);
  const locked = firstMatch ? matchIsTipLocked(firstMatch) : false;
  res.json({ picks, locked });
});

app.get('/api/tournament/picks', async (req, res) => {
  const picks = await getAllTournamentPicks();
  res.json({ picks });
});

app.post('/api/tournament/assister', requireAuth, async (req, res) => {
  const allMatches = await getAllMatches();
  const firstMatch = allMatches.reduce((min, m) => !min || new Date(m.kickoffUtc) < new Date(min.kickoffUtc) ? m : min, null);
  if (firstMatch && matchIsTipLocked(firstMatch)) {
    return res.status(423).json({ error: 'Turnajové tipy jsou uzamčeny — první zápas již začal.' });
  }
  const { assisterTeam, assisterPlayer } = req.body;
  await saveAssisterPick(req.session.userId, { assisterTeam, assisterPlayer });
  res.json({ ok: true });
});

app.post('/api/tournament/scorer', requireAuth, async (req, res) => {
  const allMatches = await getAllMatches();
  const firstMatch = allMatches.reduce((min, m) => !min || new Date(m.kickoffUtc) < new Date(min.kickoffUtc) ? m : min, null);
  if (firstMatch && matchIsTipLocked(firstMatch)) {
    return res.status(423).json({ error: 'Turnajové tipy jsou uzamčeny — první zápas již začal.' });
  }
  const { scorerTeam, scorerPlayer } = req.body;
  await saveScorerPick(req.session.userId, { scorerTeam, scorerPlayer });
  res.json({ ok: true });
});

app.post('/api/tournament/picks', requireAuth, async (req, res) => {
  const allMatches = await getAllMatches();
  const firstMatch = allMatches.reduce((min, m) => !min || new Date(m.kickoffUtc) < new Date(min.kickoffUtc) ? m : min, null);
  if (firstMatch && matchIsTipLocked(firstMatch)) {
    return res.status(423).json({ error: 'Turnajové tipy jsou uzamčeny — první zápas již začal.' });
  }

  const { firstTeam, secondTeam, thirdTeam } = req.body;
  const teams = new Set([firstTeam, secondTeam, thirdTeam].filter(Boolean));
  if (teams.size !== [firstTeam, secondTeam, thirdTeam].filter(Boolean).length) {
    return res.status(400).json({ error: 'Každý tým lze vybrat pouze jednou.' });
  }

  await saveTournamentPicks(req.session.userId, { firstTeam, secondTeam, thirdTeam });
  res.json({ ok: true });
});

app.post('/api/admin/matches/:matchId/scorers', requireAdmin, async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });

  const scorers = Array.isArray(req.body.scorers)
    ? req.body.scorers.map((s) => String(s).trim()).filter(Boolean)
    : [];

  await setCzechScorers(matchId, scorers);
  res.json({ ok: true, scorers });
});

app.get('/api/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

app.post('/api/admin/sync-results', requireAdmin, async (req, res) => {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'FOOTBALL_DATA_API_KEY není nastavený na serveru.' });
  try {
    const result = await syncResults(apiKey);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/admin/sync', requireAdmin, async (req, res) => {
  try {
    const result = await syncOpenFootball();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.delete('/api/admin/matches/:matchId/result', requireAdmin, async (req, res) => {
  const matchId = Number(req.params.matchId);
  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });

  const match = await resetMatchResult(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  res.json({ ok: true });
});

app.post('/api/admin/matches/:matchId/result', requireAdmin, async (req, res) => {
  const matchId = Number(req.params.matchId);
  const homeScore = normalizeScore(req.body.homeScore);
  const awayScore = normalizeScore(req.body.awayScore);

  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });
  if (homeScore === null || awayScore === null) {
    return res.status(400).json({ error: 'Final scores must be whole numbers between 0 and 99.' });
  }

  const match = await setMatchResult(matchId, homeScore, awayScore);
  if (!match) return res.status(404).json({ error: 'Match not found.' });

  res.json({ ok: true, match });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

await initDb();
app.listen(PORT, () => {
  console.log(`CTS fantasy WC '26 running on http://localhost:${PORT}`);
});
