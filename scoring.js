function outcome(home, away) {
  if (home > away) return 'HOME';
  if (home < away) return 'AWAY';
  return 'DRAW';
}

export function calculateTipPoints(tip, match) {
  if (tip.homeScore === null || tip.homeScore === undefined ||
      tip.awayScore === null || tip.awayScore === undefined) {
    return null;
  }

  const actualHome = Number(match.homeScore);
  const actualAway = Number(match.awayScore);
  const predictedHome = Number(tip.homeScore);
  const predictedAway = Number(tip.awayScore);

  if (![actualHome, actualAway, predictedHome, predictedAway].every(Number.isFinite)) {
    return null;
  }

  if (predictedHome === actualHome && predictedAway === actualAway) {
    return 3;
  }

  const actualOutcome = outcome(actualHome, actualAway);
  const predictedOutcome = outcome(predictedHome, predictedAway);
  const actualDiff = actualHome - actualAway;
  const predictedDiff = predictedHome - predictedAway;

  if (actualOutcome === predictedOutcome && actualDiff === predictedDiff) {
    return 2;
  }

  if (actualOutcome === predictedOutcome) {
    return 1;
  }

  return 0;
}

export function isMatchFinished(match) {
  return match.status === 'FINISHED' && Number.isFinite(Number(match.homeScore)) && Number.isFinite(Number(match.awayScore));
}
