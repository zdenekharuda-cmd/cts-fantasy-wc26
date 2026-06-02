import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';

import { readJson, writeJson } from './store.js';
import { calculateTipPoints, isMatchFinished } from './scoring.js';
import { syncOpenFootball } from './syncOpenFootball.js';

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
  return {
    id: user.id,
    name: user.name,
    nickname: user.nickname,
    email: user.email
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'You need to log in first.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  const configuredToken = process.env.ADMIN_TOKEN;
  const providedToken = req.headers['x-admin-token'];

  if (!configuredToken) {
    return res.status(403).json({ error: 'ADMIN_TOKEN is not configured on the server.' });
  }
  if (providedToken !== configuredToken) {
    return res.status(403).json({ error: 'Invalid admin token.' });
  }
  next();
}

function normalizeScore(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 99) return null;
  return number;
}

function matchIsTipLocked(match, now = Date.now()) {
  const kickoff = new Date(match.kickoffUtc).getTime();
  return Number.isFinite(kickoff) && kickoff - now <= FIVE_MINUTES_MS;
}

function enrichMatchForUser(match, tip = null) {
  const locked = matchIsTipLocked(match);
  const finished = isMatchFinished(match);
  return {
    ...match,
    locked,
    finished,
    tip: tip
      ? {
          homeScore: tip.homeScore,
          awayScore: tip.awayScore,
          submittedAt: tip.submittedAt,
          updatedAt: tip.updatedAt,
          points: finished ? calculateTipPoints(tip, match) : null
        }
      : null
  };
}

app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/tips.html' : '/login.html');
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const users = await readJson('users.json', []);
  const user = users.find((item) => item.id === req.session.userId);
  res.json({ user: publicUser(user) });
});

app.post('/api/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const nickname = String(req.body.nickname || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !nickname || !email || !password) {
    return res.status(400).json({ error: 'Name, nickname, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const users = await readJson('users.json', []);
  const nicknameTaken = users.some((user) => user.nickname.toLowerCase() === nickname.toLowerCase());
  const emailTaken = users.some((user) => user.email.toLowerCase() === email);

  if (nicknameTaken) return res.status(409).json({ error: 'This nickname is already taken.' });
  if (emailTaken) return res.status(409).json({ error: 'This email is already registered.' });

  const user = {
    id: users.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    name,
    nickname,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: new Date().toISOString()
  };

  users.push(user);
  await writeJson('users.json', users);
  req.session.userId = user.id;

  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const nickname = String(req.body.nickname || '').trim();
  const password = String(req.body.password || '');
  const users = await readJson('users.json', []);
  const user = users.find((item) => item.nickname.toLowerCase() === nickname.toLowerCase());

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
  const matches = await readJson('matches.json', []);
  const tips = await readJson('tips.json', []);
  const userTipsByMatch = new Map(
    tips.filter((tip) => tip.userId === req.session.userId).map((tip) => [Number(tip.matchId), tip])
  );

  res.json({
    matches: matches.map((match) => enrichMatchForUser(match, userTipsByMatch.get(Number(match.id))))
  });
});

app.post('/api/tips/:matchId', requireAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  const homeScore = normalizeScore(req.body.homeScore);
  const awayScore = normalizeScore(req.body.awayScore);

  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });
  if (homeScore === null || awayScore === null) {
    return res.status(400).json({ error: 'Scores must be whole numbers between 0 and 99.' });
  }

  const matches = await readJson('matches.json', []);
  const match = matches.find((item) => Number(item.id) === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (matchIsTipLocked(match)) {
    return res.status(423).json({ error: 'Tips are locked 5 minutes before kick-off.' });
  }

  const tips = await readJson('tips.json', []);
  const existing = tips.find((tip) => tip.userId === req.session.userId && Number(tip.matchId) === matchId);
  const now = new Date().toISOString();

  if (existing) {
    existing.homeScore = homeScore;
    existing.awayScore = awayScore;
    existing.updatedAt = now;
  } else {
    tips.push({
      id: tips.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
      userId: req.session.userId,
      matchId,
      homeScore,
      awayScore,
      submittedAt: now,
      updatedAt: now
    });
  }

  await writeJson('tips.json', tips);
  res.json({ ok: true });
});

app.get('/api/scoreboard', async (req, res) => {
  const [users, matches, tips] = await Promise.all([
    readJson('users.json', []),
    readJson('matches.json', []),
    readJson('tips.json', [])
  ]);

  const finishedMatches = matches.filter(isMatchFinished);
  const matchById = new Map(matches.map((match) => [Number(match.id), match]));
  const rows = users.map((user) => {
    const userTips = tips.filter((tip) => tip.userId === user.id);
    let totalPoints = 0;
    let exactScores = 0;
    let scoredTips = 0;

    for (const tip of userTips) {
      const match = matchById.get(Number(tip.matchId));
      if (!match || !isMatchFinished(match)) continue;
      const points = calculateTipPoints(tip, match) ?? 0;
      totalPoints += points;
      scoredTips += 1;
      if (points === 3) exactScores += 1;
    }

    return {
      userId: user.id,
      name: user.name,
      nickname: user.nickname,
      totalPoints,
      exactScores,
      scoredTips
    };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactScores !== a.exactScores) return b.exactScores - a.exactScores;
    return a.nickname.localeCompare(b.nickname);
  });

  res.json({
    finishedMatches: finishedMatches.length,
    users: rows
  });
});

app.post('/api/admin/sync', requireAdmin, async (req, res) => {
  try {
    const result = await syncOpenFootball();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/admin/matches/:matchId/result', requireAdmin, async (req, res) => {
  const matchId = Number(req.params.matchId);
  const homeScore = normalizeScore(req.body.homeScore);
  const awayScore = normalizeScore(req.body.awayScore);

  if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'Invalid match id.' });
  if (homeScore === null || awayScore === null) {
    return res.status(400).json({ error: 'Final scores must be whole numbers between 0 and 99.' });
  }

  const matches = await readJson('matches.json', []);
  const match = matches.find((item) => Number(item.id) === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });

  match.homeScore = homeScore;
  match.awayScore = awayScore;
  match.status = 'FINISHED';
  match.resultUpdatedAt = new Date().toISOString();

  await writeJson('matches.json', matches);
  res.json({ ok: true, match });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`CTS fantasy WC '26 running on http://localhost:${PORT}`);
});
