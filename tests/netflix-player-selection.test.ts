import { describe, expect, it } from 'vitest';
import { selectNetflixPlayerSession } from '../src/netflix/player-selection';

describe('selectNetflixPlayerSession', () => {
  it('selects a player only when getMovieId matches the URL media id', () => {
    const selected = selectNetflixPlayerSession([
      { mediaId: 'old', player: 'preloaded', sessionId: 'watch-old' },
      { mediaId: 'current', player: 'active', sessionId: 'watch-current' },
    ], 'current');

    expect(selected).toEqual({ mediaId: 'current', player: 'active', sessionId: 'watch-current' });
  });

  it('does not fall back to a stale or preloaded watch session', () => {
    expect(selectNetflixPlayerSession([
      { mediaId: 'old', player: 'stale', sessionId: 'watch-old' },
    ], 'current')).toBeUndefined();
    expect(selectNetflixPlayerSession([
      { mediaId: undefined, player: 'unknown', sessionId: 'watch-unknown' },
      { mediaId: 'old', player: 'stale', sessionId: 'watch-old' },
    ], 'current')).toBeUndefined();
  });

  it('cautiously binds one unreadable watch session to the URL media id', () => {
    const selected = selectNetflixPlayerSession([
      { mediaId: undefined, player: 'active', sessionId: 'watch-current' },
      { mediaId: 'browse', player: 'preview', sessionId: 'preview-1' },
    ], 'current');

    expect(selected).toEqual({ mediaId: 'current', player: 'active', sessionId: 'watch-current' });
  });
});
