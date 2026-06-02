import { readJson, writeJson } from './store.js';
import { flagCodeFor } from './teamFlags.js';

export const DEFAULT_OPENFOOTBALL_URL =
  process.env.OPENFOOTBALL_URL || 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

function parseUtcOffset(offsetText) {
  if (!offsetText) return 0;
  const match = offsetText.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

export function parseKickoffToUtcIso(dateText, timeText) {
  const dateMatch = String(dateText).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeText || '').match(/^(\d{1,2}):(\d{2})(?:\s*UTC([+-]\d{1,2}(?::?\d{2})?))?$/i);

  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const monthIndex = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const offsetMinutes = parseUtcOffset(timeMatch[3]);

// Source times are local-to-offset.
// UTC = local time - offset.
const utcMillis = Date.UTC(year, monthIndex, day, hour, minute) - offsetMinutes * 60_000;
  return new Date(utcMillis).toISOString();
}

function normalizeMatch(sourceMatch, index, existingById) {
  const id = Number(sourceMatch.num || index + 1);
  const existing = existingById.get(id) || {};
  const score = sourceMatch.score?.ft;
  const hasScore = Array.isArray(score) && score.length === 2;

  return {
    id,
    sourceNum: sourceMatch.num || null,
    round: sourceMatch.round || '',
    group: sourceMatch.group || null,
    date: sourceMatch.date,
    sourceTime: sourceMatch.time || '',
    kickoffUtc: parseKickoffToUtcIso(sourceMatch.date, sourceMatch.time),
    teamHome: sourceMatch.team1,
    teamAway: sourceMatch.team2,
    homeFlag: flagCodeFor(sourceMatch.team1),
    awayFlag: flagCodeFor(sourceMatch.team2),
    venue: sourceMatch.ground || '',
    homeScore: hasScore ? Number(score[0]) : existing.homeScore ?? null,
    awayScore: hasScore ? Number(score[1]) : existing.awayScore ?? null,
    status: hasScore ? 'FINISHED' : existing.status || 'SCHEDULED',
    importedAt: new Date().toISOString(),
    source: 'openfootball/worldcup.json'
  };
}

export async function syncOpenFootball(url = DEFAULT_OPENFOOTBALL_URL) {
  const response = await fetch(url, {
    headers: { accept: 'application/json,text/plain,*/*' }
  });

  if (!response.ok) {
    throw new Error(`Fixture source returned ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.matches)) {
    throw new Error('Fixture source did not return a matches array.');
  }

  const existingMatches = await readJson('matches.json', []);
  const existingById = new Map(existingMatches.map((match) => [Number(match.id), match]));
  const normalized = data.matches.map((match, index) => normalizeMatch(match, index, existingById));

  normalized.sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
  await writeJson('matches.json', normalized);

  return {
    tournament: data.name || 'World Cup 2026',
    count: normalized.length,
    finished: normalized.filter((match) => match.status === 'FINISHED').length,
    source: url
  };
}
