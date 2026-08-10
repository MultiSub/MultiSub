export interface NetflixPlayerSessionCandidate<TPlayer> {
  mediaId: string | undefined;
  player: TPlayer;
  sessionId: string;
}

export interface SelectedNetflixPlayerSession<TPlayer> {
  mediaId: string;
  player: TPlayer;
  sessionId: string;
}

export function selectNetflixPlayerSession<TPlayer>(
  candidates: NetflixPlayerSessionCandidate<TPlayer>[],
  urlMediaId: string,
): SelectedNetflixPlayerSession<TPlayer> | undefined {
  const matching = candidates.find((candidate) => candidate.mediaId === urlMediaId);
  if (matching !== undefined) {
    return { mediaId: urlMediaId, player: matching.player, sessionId: matching.sessionId };
  }

  const watchSessions = candidates.filter((candidate) => candidate.sessionId.startsWith('watch-'));
  if (watchSessions.length !== 1 || watchSessions[0].mediaId !== undefined) {
    return undefined;
  }

  const selected = watchSessions[0];
  return { mediaId: urlMediaId, player: selected.player, sessionId: selected.sessionId };
}
