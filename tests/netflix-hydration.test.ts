import { describe, expect, it } from 'vitest';
import {
  isRestorableNetflixPlayerTrack,
  isSelectedNetflixPlayerTrack,
  SerialTaskQueue,
} from '../src/netflix/hydration';

describe('Netflix subtitle hydration', () => {
  it('serializes temporary player mutations', async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const second = queue.run(async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('treats Netflix Off/null as a restorable original selection', () => {
    expect(isRestorableNetflixPlayerTrack(null)).toBe(true);
    expect(isRestorableNetflixPlayerTrack(undefined)).toBe(false);
  });

  it('recognizes the selected temporary track through legacy id aliases', () => {
    const selectedTrack = { trackId: 'current-id' };
    expect(isSelectedNetflixPlayerTrack(selectedTrack, selectedTrack, 'current-id')).toBe(true);
    expect(isSelectedNetflixPlayerTrack({ new_track_id: 'legacy-id' }, selectedTrack, 'legacy-id')).toBe(true);
    expect(isSelectedNetflixPlayerTrack({ id: 'user-changed' }, selectedTrack, 'legacy-id')).toBe(false);
  });
});
