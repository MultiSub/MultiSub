import { parseWebVtt } from '../vtt';
import {
  NETFLIX_MESSAGE_SOURCE,
  type NetflixContentToPageMessage,
  type NetflixPageToContentMessage,
  type NetflixSubtitleCue,
  type NetflixSubtitleSlot,
  type NetflixSubtitleTrack,
} from './messages';
import { parseNetflixTtml } from './ttml';
import {
  isRestorableNetflixPlayerTrack,
  isSelectedNetflixPlayerTrack,
  SerialTaskQueue,
} from './hydration';
import {
  extractNetflixTrackResource,
  extractNetflixManifestResources,
  netflixTrackId,
  netflixTrackIds,
  normalizeNetflixPlayerTracks,
  type NetflixTrackResource,
} from './track-model';
import { selectNetflixPlayerSession } from './player-selection';

interface NetflixPlayer {
  getMovieId?: () => unknown;
  getTimedTextTrack?: () => unknown;
  getTimedTextTrackList?: () => unknown;
  getTextTrack?: () => unknown;
  getTextTrackList?: () => unknown;
  setTimedTextTrack?: (track: unknown) => void;
  setTextTrack?: (track: unknown) => void;
}

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds?: () => unknown;
  getVideoPlayerBySessionId?: (sessionId: string) => unknown;
}

interface NetflixGlobal {
  appContext?: {
    state?: {
      playerApp?: {
        getAPI?: () => { videoPlayer?: NetflixVideoPlayerApi };
      };
    };
  };
  player?: { MediaSession?: unknown };
}

interface ActivePlayerContext {
  mediaId: string;
  player: NetflixPlayer;
  sessionId: string;
}

interface ResolvedSubtitleResource {
  profile: string;
  urls: string[];
}

interface SlotLoadState {
  loadVersion: number;
  selectedTrackId: string | null;
}

declare global {
  interface Window {
    __netflixDualSubHookInstalled?: boolean;
    netflix?: NetflixGlobal;
  }
}

const PLAYER_POLL_INTERVAL_MS = 750;
const URL_RESOLUTION_ATTEMPTS = 12;
const URL_RESOLUTION_INTERVAL_MS = 250;
const MAX_SCAN_DEPTH = 9;
const MAX_SCAN_NODES = 12_000;
const MAX_SCAN_MILLISECONDS = 35;

if (!window.__netflixDualSubHookInstalled) {
  window.__netflixDualSubHookInstalled = true;
  installNetflixPageHook();
}

function installNetflixPageHook(): void {
  const originalFetch = window.fetch.bind(window);
  const originalJsonParse = JSON.parse;
  const manifestResources = new Map<string, Map<string, ResolvedSubtitleResource>>();
  const resolvedResources = new Map<string, ResolvedSubtitleResource>();
  const cuePromises = new Map<string, Promise<NetflixSubtitleCue[]>>();
  const hydrationQueue = new SerialTaskQueue();
  const slots: Record<NetflixSubtitleSlot, SlotLoadState> = {
    primary: { selectedTrackId: null, loadVersion: 0 },
    secondary: { selectedTrackId: null, loadVersion: 0 },
  };
  let activeContext: ActivePlayerContext | undefined;
  let activeTracks: NetflixSubtitleTrack[] = [];
  let rawTracksById = new Map<string, unknown>();
  let lastPublishedSignature = '';
  let temporaryTrackSelection = false;
  let refreshQueued = false;

  JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
    const result = originalJsonParse(...args);
    try {
      captureManifestResources(result);
    } catch {
      // Netflix parsing must remain completely transparent.
    }
    return result;
  }) as typeof JSON.parse;

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');
  window.addEventListener('popstate', queueRefresh);

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isContentToPageMessage(event.data)) {
      return;
    }

    const message = event.data;
    if (message.type === 'ready') {
      queueRefresh();
      return;
    }
    if (message.mediaId !== activeContext?.mediaId) {
      return;
    }

    const state = slots[message.slot];
    state.selectedTrackId = message.trackId;
    state.loadVersion += 1;
    if (message.trackId !== null) {
      void loadSelectedTrack(message.slot, message.trackId, state.loadVersion);
    }
  });

  window.setInterval(() => refreshPlayerState(), PLAYER_POLL_INTERVAL_MS);
  queueRefresh();

  function captureManifestResources(value: unknown): void {
    const captured = extractNetflixManifestResources(value);
    if (captured === undefined || captured.resources.length === 0) {
      return;
    }

    let byTrackId = manifestResources.get(captured.mediaId);
    if (byTrackId === undefined) {
      byTrackId = new Map<string, ResolvedSubtitleResource>();
      manifestResources.set(captured.mediaId, byTrackId);
    }

    for (const resource of captured.resources) {
      const resolved = toResolvedResource(resource);
      for (const trackId of resource.trackIds) {
        const cacheKey = resourceCacheKey(captured.mediaId, trackId);
        const previous = byTrackId.get(trackId);
        const cached = resolvedResources.get(cacheKey);
        byTrackId.set(trackId, resolved);
        if (
          (previous !== undefined && !sameResolvedResource(previous, resolved)) ||
          (cached !== undefined && !sameResolvedResource(cached, resolved))
        ) {
          resolvedResources.delete(cacheKey);
        }
      }
    }

    trimOldManifestEntries(captured.mediaId);
    if (captured.mediaId === currentMediaIdFromUrl()) {
      queueRefresh();
    }
  }

  function wrapHistoryMethod(method: 'pushState' | 'replaceState'): void {
    const original = window.history[method];
    window.history[method] = function historyWithNetflixRefresh(
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      original.call(this, data, unused, url);
      queueRefresh();
    };
  }

  function queueRefresh(): void {
    if (refreshQueued) {
      return;
    }
    refreshQueued = true;
    window.setTimeout(() => {
      refreshQueued = false;
      refreshPlayerState(true);
    }, 0);
  }

  function refreshPlayerState(force = false): void {
    if (temporaryTrackSelection) {
      return;
    }

    const nextContext = findActivePlayer();
    const nextMediaId = nextContext?.mediaId ?? currentMediaIdFromUrl();
    const previousMediaId = activeContext?.mediaId ?? null;
    if (nextMediaId !== previousMediaId) {
      invalidateSlots();
      resolvedResources.clear();
      cuePromises.clear();
      activeTracks = [];
      rawTracksById = new Map<string, unknown>();
    }

    activeContext = nextContext;
    if (nextContext === undefined) {
      publishTracks(nextMediaId, null, [], force);
      return;
    }

    const rawTracks = playerTrackList(nextContext.player);
    activeTracks = normalizeNetflixPlayerTracks(rawTracks);
    rawTracksById = new Map(
      rawTracks
        .map((track) => [netflixTrackId(track), track] as const)
        .filter((entry): entry is readonly [string, unknown] => entry[0] !== undefined),
    );
    const currentTrackId = netflixTrackId(currentPlayerTrack(nextContext.player)) ?? null;
    publishTracks(nextContext.mediaId, currentTrackId, activeTracks, force);
  }

  function publishTracks(
    mediaId: string | null,
    currentTrackId: string | null,
    tracks: NetflixSubtitleTrack[],
    force: boolean,
  ): void {
    const signature = JSON.stringify([mediaId, currentTrackId, tracks]);
    if (!force && signature === lastPublishedSignature) {
      return;
    }
    lastPublishedSignature = signature;
    postToContent({
      source: NETFLIX_MESSAGE_SOURCE,
      direction: 'page-to-content',
      type: 'tracks',
      mediaId,
      currentTrackId,
      tracks,
    });
  }

  async function loadSelectedTrack(slot: NetflixSubtitleSlot, trackId: string, version: number): Promise<void> {
    const context = activeContext;
    if (context === undefined || !activeTracks.some((track) => track.id === trackId)) {
      return;
    }

    const mediaId = context.mediaId;
    const cacheKey = `${mediaId}\n${trackId}`;
    let cuePromise = cuePromises.get(cacheKey);
    if (cuePromise === undefined) {
      cuePromise = loadTrackCues(context, trackId);
      cuePromises.set(cacheKey, cuePromise);
      cuePromise.catch(() => cuePromises.delete(cacheKey));
    }

    try {
      const cues = await cuePromise;
      const state = slots[slot];
      if (
        version !== state.loadVersion ||
        state.selectedTrackId !== trackId ||
        activeContext?.mediaId !== mediaId
      ) {
        return;
      }
      postToContent({
        source: NETFLIX_MESSAGE_SOURCE,
        direction: 'page-to-content',
        type: 'cues',
        mediaId,
        slot,
        trackId,
        cues,
      });
    } catch (error) {
      if (version === slots[slot].loadVersion && activeContext?.mediaId === mediaId) {
        postError(mediaId, `Unable to load Netflix subtitle track: ${messageFromError(error)}`);
      }
    }
  }

  async function loadTrackCues(context: ActivePlayerContext, trackId: string): Promise<NetflixSubtitleCue[]> {
    const resource = await resolveTrackResource(context, trackId);
    let lastError: unknown;
    for (const url of resource.urls) {
      try {
        const response = await originalFetch(url);
        if (!response.ok) {
          throw new Error(`Netflix subtitle CDN returned HTTP ${response.status}`);
        }
        const text = await response.text();
        const cues = /^\s*WEBVTT/i.test(text) || /webvtt/i.test(resource.profile)
          ? parseWebVtt(text)
          : parseNetflixTtml(text);
        if (cues.length === 0) {
          throw new Error(`Netflix subtitle profile ${resource.profile || 'unknown'} contained no text cues`);
        }
        return cues;
      } catch (error) {
        lastError = error;
      }
    }
    invalidateResolvedResource(context.mediaId, trackId, resource);
    throw lastError ?? new Error('Netflix did not provide a usable text subtitle URL');
  }

  function invalidateResolvedResource(
    mediaId: string,
    trackId: string,
    resource: ResolvedSubtitleResource,
  ): void {
    const prefix = `${mediaId}\n`;
    for (const [key, candidate] of resolvedResources) {
      if (key.startsWith(prefix) && sameResolvedResource(candidate, resource)) {
        resolvedResources.delete(key);
      }
    }

    const byTrackId = manifestResources.get(mediaId);
    if (byTrackId === undefined) {
      return;
    }
    for (const [candidateTrackId, candidate] of byTrackId) {
      if (candidateTrackId === trackId || sameResolvedResource(candidate, resource)) {
        byTrackId.delete(candidateTrackId);
      }
    }
  }

  async function resolveTrackResource(
    context: ActivePlayerContext,
    trackId: string,
  ): Promise<ResolvedSubtitleResource> {
    const key = resourceCacheKey(context.mediaId, trackId);
    const cached = resolvedResources.get(key) ?? manifestResources.get(context.mediaId)?.get(trackId);
    if (cached !== undefined) {
      resolvedResources.set(key, cached);
      return cached;
    }

    let resource = scanMediaSessionForTrack(trackId);
    if (resource !== undefined) {
      resolvedResources.set(key, resource);
      return resource;
    }

    const target = rawTracksById.get(trackId);
    if (target === undefined) {
      throw new Error('The selected Netflix subtitle track is no longer available');
    }

    return hydrationQueue.run(async () => {
      const queuedCached = resolvedResources.get(key) ?? manifestResources.get(context.mediaId)?.get(trackId);
      if (queuedCached !== undefined) {
        resolvedResources.set(key, queuedCached);
        return queuedCached;
      }

      resource = scanMediaSessionForTrack(trackId);
      if (resource !== undefined) {
        resolvedResources.set(key, resource);
        return resource;
      }

      if (!isActivePlayerContext(context)) {
        throw new Error('The active Netflix playback changed before subtitle loading started');
      }

      const originalTrack = currentPlayerTrack(context.player);
      temporaryTrackSelection = true;
      try {
        setPlayerTrack(context.player, target);
        for (let attempt = 0; attempt < URL_RESOLUTION_ATTEMPTS && resource === undefined; attempt += 1) {
          if (!isActivePlayerContext(context)) {
            throw new Error('The active Netflix playback changed while resolving subtitle data');
          }
          resource = scanMediaSessionForTrack(trackId);
          if (resource === undefined && attempt + 1 < URL_RESOLUTION_ATTEMPTS) {
            await delay(URL_RESOLUTION_INTERVAL_MS);
          }
        }
        if (resource === undefined) {
          throw new Error('Netflix did not resolve a downloadable text subtitle URL');
        }
        resolvedResources.set(key, resource);
        return resource;
      } finally {
        try {
          const currentTrack = currentPlayerTrack(context.player);
          if (
            isRestorableNetflixPlayerTrack(originalTrack) &&
            isSelectedNetflixPlayerTrack(currentTrack, target, trackId)
          ) {
            setPlayerTrack(context.player, originalTrack);
          }
        } finally {
          temporaryTrackSelection = false;
          queueRefresh();
        }
      }
    });
  }

  function scanMediaSessionForTrack(trackId: string): ResolvedSubtitleResource | undefined {
    const root = window.netflix?.player?.MediaSession;
    const queue: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: root }];
    const seen = new WeakSet<object>();
    let readIndex = 0;
    let visited = 0;
    const startedAt = window.performance.now();

    while (
      readIndex < queue.length &&
      visited < MAX_SCAN_NODES &&
      window.performance.now() - startedAt < MAX_SCAN_MILLISECONDS
    ) {
      const current = queue[readIndex];
      readIndex += 1;
      const value = current.value;
      if (!isObjectLike(value) || seen.has(value)) {
        continue;
      }
      seen.add(value);
      visited += 1;

      let descriptors: PropertyDescriptorMap;
      try {
        descriptors = Object.getOwnPropertyDescriptors(value);
      } catch {
        continue;
      }

      const matchingResource = resourceFromDescriptors(descriptors, trackId);
      if (matchingResource !== undefined) {
        return matchingResource;
      }

      if (current.depth >= MAX_SCAN_DEPTH) {
        continue;
      }

      for (const descriptor of Object.values(descriptors)) {
        if ('value' in descriptor && isObjectLike(descriptor.value)) {
          queue.push({ depth: current.depth + 1, value: descriptor.value });
        }
      }
      if (value instanceof Map) {
        for (const child of value.values()) {
          queue.push({ depth: current.depth + 1, value: child });
        }
      } else if (value instanceof Set) {
        for (const child of value.values()) {
          queue.push({ depth: current.depth + 1, value: child });
        }
      }
    }
    return undefined;
  }

  function isActivePlayerContext(context: ActivePlayerContext): boolean {
    return (
      activeContext?.mediaId === context.mediaId &&
      activeContext.sessionId === context.sessionId &&
      currentMediaIdFromUrl() === context.mediaId
    );
  }

  function findActivePlayer(): ActivePlayerContext | undefined {
    const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    const sessionValue = videoPlayer?.getAllPlayerSessionIds?.();
    const sessionIds = Array.isArray(sessionValue)
      ? sessionValue.filter((value): value is string => typeof value === 'string')
      : [];
    const urlMediaId = currentMediaIdFromUrl();
    if (urlMediaId === null) {
      return undefined;
    }
    const candidates = sessionIds
      .map((sessionId) => {
        const player = asNetflixPlayer(videoPlayer?.getVideoPlayerBySessionId?.(sessionId));
        return player === undefined
          ? undefined
          : { mediaId: stringId(player.getMovieId?.()), player, sessionId };
      })
      .filter(
        (candidate): candidate is { mediaId: string | undefined; player: NetflixPlayer; sessionId: string } =>
          candidate !== undefined,
      );
    return selectNetflixPlayerSession(candidates, urlMediaId);
  }

  function invalidateSlots(): void {
    for (const state of Object.values(slots)) {
      state.loadVersion += 1;
      state.selectedTrackId = null;
    }
  }

  function trimOldManifestEntries(currentMediaId: string): void {
    if (manifestResources.size <= 10) {
      return;
    }
    for (const mediaId of manifestResources.keys()) {
      if (mediaId !== currentMediaId) {
        manifestResources.delete(mediaId);
        if (manifestResources.size <= 8) {
          break;
        }
      }
    }
  }
}

function playerTrackList(player: NetflixPlayer): unknown[] {
  const value = player.getTimedTextTrackList?.() ?? player.getTextTrackList?.();
  return Array.isArray(value) ? value : [];
}

function currentPlayerTrack(player: NetflixPlayer): unknown {
  return player.getTimedTextTrack?.() ?? player.getTextTrack?.();
}

function setPlayerTrack(player: NetflixPlayer, track: unknown): void {
  if (typeof player.setTimedTextTrack === 'function') {
    player.setTimedTextTrack(track);
    return;
  }
  if (typeof player.setTextTrack === 'function') {
    player.setTextTrack(track);
    return;
  }
  throw new Error('Netflix player does not expose a text-track selector');
}

function currentMediaIdFromUrl(): string | null {
  return /^\/watch\/(\d+)/.exec(window.location.pathname)?.[1] ?? null;
}

function resourceFromDescriptors(
  descriptors: PropertyDescriptorMap,
  trackId: string,
): ResolvedSubtitleResource | undefined {
  const descriptorTrackIds = netflixTrackIds({
    id: descriptors.id?.value,
    new_track_id: descriptors.new_track_id?.value,
    trackId: descriptors.trackId?.value,
  });
  if (!descriptorTrackIds.includes(trackId)) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if ('value' in descriptor) {
      record[name] = descriptor.value;
    }
  }

  const manifestStyleResource = extractNetflixTrackResource(record);
  if (manifestStyleResource !== undefined) {
    return toResolvedResource(manifestStyleResource);
  }

  const urls = extractResolvedUrls([record.urls, record.downloadUrls]);
  const profile = [record.profile, record.contentProfile, record.timedtextprofile]
    .find((value): value is string => typeof value === 'string') ?? 'ttml';
  return urls.length === 0 || /image|nflx-cmisc/i.test(profile) ? undefined : { profile, urls };
}

function extractResolvedUrls(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value.flatMap((item) => (Array.isArray(item) ? item : [item]))
    : isRecord(value)
      ? Object.values(value)
      : [value];
  return values
    .flatMap((item) => (isRecord(item) && !('url' in item) ? Object.values(item) : [item]))
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (isRecord(value) && typeof value.url === 'string') {
        return value.url;
      }
      return undefined;
    })
    .filter((value): value is string => value !== undefined && /^https:\/\//i.test(value))
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function toResolvedResource(resource: NetflixTrackResource): ResolvedSubtitleResource {
  return { profile: resource.profile, urls: resource.urls };
}

function resourceCacheKey(mediaId: string, trackId: string): string {
  return `${mediaId}\n${trackId}`;
}

function sameResolvedResource(
  left: ResolvedSubtitleResource,
  right: ResolvedSubtitleResource,
): boolean {
  return left.profile === right.profile &&
    left.urls.length === right.urls.length &&
    left.urls.every((url, index) => url === right.urls[index]);
}

function postError(mediaId: string | null, message: string): void {
  postToContent({
    source: NETFLIX_MESSAGE_SOURCE,
    direction: 'page-to-content',
    type: 'error',
    mediaId,
    message,
  });
}

function postToContent(message: NetflixPageToContentMessage): void {
  window.postMessage(message, '*');
}

function isContentToPageMessage(value: unknown): value is NetflixContentToPageMessage {
  if (
    !isRecord(value) ||
    value.source !== NETFLIX_MESSAGE_SOURCE ||
    value.direction !== 'content-to-page'
  ) {
    return false;
  }
  if (value.type === 'ready') {
    return true;
  }
  return value.type === 'select' &&
    (value.slot === 'primary' || value.slot === 'secondary') &&
    (value.trackId === null || typeof value.trackId === 'string') &&
    (value.mediaId === null || typeof value.mediaId === 'string');
}

function asNetflixPlayer(value: unknown): NetflixPlayer | undefined {
  return isRecord(value) ? (value as NetflixPlayer) : undefined;
}

function stringId(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
