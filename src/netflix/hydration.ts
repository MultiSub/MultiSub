import { netflixTrackIds } from './track-model';

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function isRestorableNetflixPlayerTrack(track: unknown): boolean {
  return track !== undefined;
}

export function isSelectedNetflixPlayerTrack(
  currentTrack: unknown,
  selectedTrack: unknown,
  selectedTrackId: string,
): boolean {
  return currentTrack === selectedTrack || netflixTrackIds(currentTrack).includes(selectedTrackId);
}
