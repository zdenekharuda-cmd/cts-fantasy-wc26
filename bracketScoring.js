const R32_TEAMS = {
  74: ['Germany',          'Paraguay'              ],
  77: ['France',           'Sweden'                ],
  73: ['South Africa',     'Canada'                ],
  75: ['Netherlands',      'Morocco'               ],
  83: ['Portugal',         'Croatia'               ],
  84: ['Spain',            'Austria'               ],
  81: ['USA',              'Bosnia and Herzegovina'],
  82: ['Belgium',          'Senegal'               ],
  76: ['Brazil',           'Japan'                 ],
  78: ["Côte d'Ivoire",    'Norway'                ],
  79: ['Mexico',           'Ecuador'               ],
  80: ['England',          'Congo DR'              ],
  86: ['Argentina',        'Cabo Verde'            ],
  88: ['Australia',        'Egypt'                 ],
  85: ['Switzerland',      'Algeria'               ],
  87: ['Colombia',         'Ghana'                 ],
};

// topFrom / bottomFrom: which match feeds each slot (null = R32 fixed team)
const MATCHES = {
  73: { topFrom: null, bottomFrom: null },
  74: { topFrom: null, bottomFrom: null },
  75: { topFrom: null, bottomFrom: null },
  76: { topFrom: null, bottomFrom: null },
  77: { topFrom: null, bottomFrom: null },
  78: { topFrom: null, bottomFrom: null },
  79: { topFrom: null, bottomFrom: null },
  80: { topFrom: null, bottomFrom: null },
  81: { topFrom: null, bottomFrom: null },
  82: { topFrom: null, bottomFrom: null },
  83: { topFrom: null, bottomFrom: null },
  84: { topFrom: null, bottomFrom: null },
  85: { topFrom: null, bottomFrom: null },
  86: { topFrom: null, bottomFrom: null },
  87: { topFrom: null, bottomFrom: null },
  88: { topFrom: null, bottomFrom: null },
  89:  { topFrom: 74,  bottomFrom: 77  },
  90:  { topFrom: 73,  bottomFrom: 75  },
  91:  { topFrom: 76,  bottomFrom: 78  },
  92:  { topFrom: 79,  bottomFrom: 80  },
  93:  { topFrom: 83,  bottomFrom: 84  },
  94:  { topFrom: 81,  bottomFrom: 82  },
  95:  { topFrom: 86,  bottomFrom: 88  },
  96:  { topFrom: 85,  bottomFrom: 87  },
  97:  { topFrom: 89,  bottomFrom: 90  },
  98:  { topFrom: 93,  bottomFrom: 94  },
  99:  { topFrom: 91,  bottomFrom: 92  },
  100: { topFrom: 95,  bottomFrom: 96  },
  101: { topFrom: 97,  bottomFrom: 98  },
  102: { topFrom: 99,  bottomFrom: 100 },
  103: { topFrom: null, bottomFrom: null }, // losers of SF 101/102
  104: { topFrom: 101, bottomFrom: 102 },
};

// Resolve which team occupies a given slot in a match, according to a picks state.
// Returns team name string or null if not determined.
function resolveTeam(matchId, slot, picks) {
  const m = MATCHES[matchId];
  if (!m) return null;

  // 3rd place special case: teams are losers of the two SFs
  if (matchId === 103) {
    const sfId = slot === 'top' ? 101 : 102;
    const sfPick = picks[sfId];
    if (!sfPick?.winner) return null;
    const loserSlot = sfPick.winner === 'top' ? 'bottom' : 'top';
    return resolveTeam(sfId, loserSlot, picks);
  }

  const fromId = m[slot + 'From'];

  // R32: fixed teams
  if (fromId === null) {
    return (R32_TEAMS[matchId] || [])[slot === 'top' ? 0 : 1] ?? null;
  }

  // Follow winner from feeder match
  const feederPick = picks[fromId];
  if (!feederPick?.winner) return null;
  return resolveTeam(fromId, feederPick.winner, picks);
}

// Returns the team name that the given picks state predicts as winner of matchId,
// or null if the match has no pick.
function resolveWinner(matchId, picks) {
  const pick = picks[String(matchId)] ?? picks[Number(matchId)];
  if (!pick?.winner) return null;
  return resolveTeam(matchId, pick.winner, picks);
}

// Normalise picks keys to numbers so both string and number keys work.
function normalisePicks(picks) {
  const out = {};
  for (const [k, v] of Object.entries(picks || {})) out[Number(k)] = v;
  return out;
}

/**
 * Compute how many bracket picks the user got right.
 * A pick is correct when the user's predicted winner of a match equals the
 * official winner — regardless of who the opponent was.
 *
 * @param {object} userPicks     - bracket_picks row (keyed by match id)
 * @param {object} officialPicks - bracket_official row (keyed by match id)
 * @returns {{ points: number, correct: number[], total: number }}
 */
export function computeBracketScore(userPicks, officialPicks) {
  const user     = normalisePicks(userPicks);
  const official = normalisePicks(officialPicks);

  let points = 0;
  const correct = [];

  for (const matchId of Object.keys(official).map(Number)) {
    const officialWinner = resolveWinner(matchId, official);
    const userWinner     = resolveWinner(matchId, user);
    if (officialWinner && userWinner && officialWinner === userWinner) {
      points++;
      correct.push(matchId);
    }
  }

  return { points, correct, total: Object.keys(official).length };
}
