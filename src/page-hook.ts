import { MESSAGE_SOURCE, type ContentToPageMessage, type PageToContentMessage, type SubtitleCue, type SubtitleTrack } from './messages';
import { summarizeMpdTextAdaptations } from './mpd-debug';
import { extractSubtitleTracksFromMpd } from './mpd';
import { extractMpdMediaPresentationDuration, subtitleTimelineOffset } from './timeline';
import { parseSegmentedWebVttWithTiming, type SegmentedWebVttTiming, type VttSegmentInput } from './vtt';

const MANIFEST_DEBUG_ID = 'hbo-dual-sub-manifest-debug';
const TRACK_DEBUG_ID = 'hbo-dual-sub-track-debug';

declare global {
  interface Window {
    __hboDualSubHookInstalled?: boolean;
  }
}

interface TrackedXMLHttpRequest extends XMLHttpRequest {
  __hboDualSubUrl?: string;
}

type SubtitleSlot = 'primary' | 'secondary';

interface SlotLoadState {
  selectedTrackId: string | null;
  loadVersion: number;
}

if (!window.__hboDualSubHookInstalled) {
  window.__hboDualSubHookInstalled = true;
  installPageHook();
}

function installPageHook(): void {
  const originalFetch = window.fetch.bind(window);
  const originalXhrOpen = window.XMLHttpRequest.prototype.open;
  const originalXhrSend = window.XMLHttpRequest.prototype.send;
  let tracksById = new Map<string, SubtitleTrack>();
  let manifestDurationSeconds: number | undefined;
  const timingByTrackKey = new Map<string, SegmentedWebVttTiming>();
  const slots: Record<SubtitleSlot, SlotLoadState> = {
    primary: { selectedTrackId: null, loadVersion: 0 },
    secondary: { selectedTrackId: null, loadVersion: 0 },
  };

  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    const url = requestUrl(args[0]);

    if (url !== undefined && isMpdUrl(url)) {
      void response
        .clone()
        .text()
        .then((manifest) => handleManifest(url, manifest))
        .catch((error: unknown) => postError(`Unable to read HBO manifest: ${messageFromError(error)}`));
    }

    return response;
  }) as typeof fetch;

  window.XMLHttpRequest.prototype.open = function openWithTracking(
    this: TrackedXMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    this.__hboDualSubUrl = requestUrl(url);
    originalXhrOpen.call(this, method, url, async ?? true, username, password);
  };

  window.XMLHttpRequest.prototype.send = function sendWithTracking(
    this: TrackedXMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const manifestUrl = this.__hboDualSubUrl;

    if (manifestUrl !== undefined && isMpdUrl(manifestUrl)) {
      this.addEventListener('load', () => {
        const manifest = xhrResponseText(this);
        if (manifest !== undefined) {
          handleManifest(manifestUrl, manifest);
        }
      });
    }

    originalXhrSend.call(this, body);
  };

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isContentToPageMessage(event.data)) {
      return;
    }

    if (event.data.type === 'select') {
      const slot = event.data.slot ?? 'secondary';
      slots[slot].selectedTrackId = event.data.trackId;
      void loadSelectedTrack(slot, event.data.trackId);
    }
  });

  function handleManifest(manifestUrl: string, manifestText: string): void {
    try {
      publishManifestDebug(manifestUrl, manifestText);
      manifestDurationSeconds = extractMpdMediaPresentationDuration(manifestText) ?? manifestDurationSeconds;
      const tracks = extractSubtitleTracksFromMpd(manifestText, manifestUrl);
      tracksById = new Map(tracks.map((track) => [track.id, track]));
      publishTrackDebug(tracks);
      updateTimelineDebugData(0);
      postToContent({ source: MESSAGE_SOURCE, direction: 'page-to-content', type: 'tracks', tracks });

      for (const [slot, state] of Object.entries(slots) as Array<[SubtitleSlot, SlotLoadState]>) {
        if (state.selectedTrackId !== null && tracksById.has(state.selectedTrackId)) {
          void loadSelectedTrack(slot, state.selectedTrackId);
        }
      }
    } catch (error) {
      postError(`Unable to parse HBO subtitle manifest: ${messageFromError(error)}`);
    }
  }

  async function loadSelectedTrack(slot: SubtitleSlot, trackId: string | null): Promise<void> {
    const state = slots[slot];
    state.loadVersion += 1;
    const version = state.loadVersion;

    if (trackId === null) {
      postCues('', [], slot);
      return;
    }

    const track = tracksById.get(trackId);
    if (track === undefined) {
      postCues(trackId, [], slot);
      return;
    }

    try {
      const trackSegments = segmentsForTrack(track);
      const segments = await mapWithConcurrency(trackSegments, 8, async (segment): Promise<VttSegmentInput> => {
        const response = await originalFetch(segment.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${segment.url}`);
        }
        return {
          text: await response.text(),
          duration: segment.duration,
          presentationTime: segment.presentationTime,
          mediaTime: segment.mediaTime,
        };
      });

      if (version !== state.loadVersion || state.selectedTrackId !== trackId) {
        return;
      }

      const key = timingKey(trackId);
      const parsedSubtitles = parseSegmentedWebVttWithTiming(segments, timingByTrackKey.get(key));
      timingByTrackKey.set(key, parsedSubtitles.timing);
      const offset = currentSubtitleTimelineOffset();
      updateTimelineDebugData(offset);
      postCues(trackId, offsetCues(parsedSubtitles.cues, offset), slot);
    } catch (error) {
      if (version === state.loadVersion) {
        postError(`Unable to load secondary subtitles: ${messageFromError(error)}`);
        postCues(trackId, [], slot);
      }
    }
  }

  function segmentsForTrack(track: SubtitleTrack) {
    const variants = track.variants ?? [{ segments: track.segments }];
    return sortSegments(dedupeSegments(variants.flatMap((variant) => variant.segments)));
  }

  function timingKey(trackId: string): string {
    return `${window.location.pathname}\n${trackId}`;
  }

  function currentSubtitleTimelineOffset(): number {
    const video = document.querySelector('video');
    const videoDuration = video instanceof HTMLVideoElement ? video.duration : undefined;
    return subtitleTimelineOffset(videoDuration, manifestDurationSeconds);
  }

  function updateTimelineDebugData(offset: number): void {
    document.documentElement.dataset.hboDualSubManifestDuration =
      manifestDurationSeconds === undefined ? '' : manifestDurationSeconds.toFixed(3);
    document.documentElement.dataset.hboDualSubVideoDuration = currentVideoDurationLabel();
    document.documentElement.dataset.hboDualSubTimelineOffset = offset.toFixed(3);
  }
}

function publishTrackDebug(tracks: SubtitleTrack[]): void {
  try {
    let element = document.getElementById(TRACK_DEBUG_ID);
    let scriptElement: HTMLScriptElement;
    if (element instanceof HTMLScriptElement) {
      scriptElement = element;
    } else {
      scriptElement = document.createElement('script');
      scriptElement.id = TRACK_DEBUG_ID;
      scriptElement.type = 'application/json';
      document.documentElement.append(scriptElement);
    }
    scriptElement.textContent = JSON.stringify({
      version: 1,
      capturedAt: new Date().toISOString(),
      tracks: tracks.map((track) => ({
        id: track.id,
        label: track.label,
        language: track.language,
        segmentCount: track.segments.length,
        variantCount: track.variants?.length ?? 1,
        segments: segmentsForDebug(track),
      })),
    });
  } catch {
    // Debug data must never affect subtitle loading.
  }
}

function segmentsForDebug(track: SubtitleTrack) {
  const variants = track.variants ?? [{ segments: track.segments }];
  return variants.flatMap((variant) =>
    variant.segments.map((segment) => ({
      duration: segment.duration ?? null,
      presentationTime: segment.presentationTime ?? null,
      mediaTime: segment.mediaTime ?? null,
      url: segment.url,
      urlTail: urlTail(segment.url),
    })),
  );
}

function urlTail(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).slice(-4).join('/');
  } catch {
    return url.split('/').filter(Boolean).slice(-4).join('/');
  }
}

function publishManifestDebug(manifestUrl: string, manifestText: string): void {
  try {
    let element = document.getElementById(MANIFEST_DEBUG_ID);
    let scriptElement: HTMLScriptElement;
    if (element instanceof HTMLScriptElement) {
      scriptElement = element;
    } else {
      scriptElement = document.createElement('script');
      scriptElement.id = MANIFEST_DEBUG_ID;
      scriptElement.type = 'application/json';
      document.documentElement.append(scriptElement);
    }
    scriptElement.textContent = JSON.stringify(summarizeMpdTextAdaptations(manifestText, manifestUrl));
  } catch {
    // Debug data must never affect subtitle loading.
  }
}

function postCues(trackId: string, cues: SubtitleCue[], slot: SubtitleSlot): void {
  postToContent({ source: MESSAGE_SOURCE, direction: 'page-to-content', type: 'cues', slot, trackId, cues });
}

function offsetCues(cues: SubtitleCue[], offset: number): SubtitleCue[] {
  if (offset === 0) {
    return cues;
  }

  return cues.map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
}

function currentVideoDurationLabel(): string {
  const video = document.querySelector('video');
  if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration)) {
    return '';
  }

  return video.duration.toFixed(3);
}

function postError(message: string): void {
  postToContent({ source: MESSAGE_SOURCE, direction: 'page-to-content', type: 'error', message });
}

function postToContent(message: PageToContentMessage): void {
  window.postMessage(message, '*');
}

function isContentToPageMessage(value: unknown): value is ContentToPageMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ContentToPageMessage).source === MESSAGE_SOURCE &&
    (value as ContentToPageMessage).direction === 'content-to-page'
  );
}

function requestUrl(input: RequestInfo | URL): string | undefined {
  if (typeof input === 'string') {
    return absoluteUrl(input);
  }

  if (input instanceof URL) {
    return input.href;
  }

  if (input instanceof Request) {
    return input.url;
  }

  return undefined;
}

function absoluteUrl(url: string | URL): string {
  return new URL(url, window.location.href).href;
}

function isMpdUrl(url: string): boolean {
  return /\.mpd(?:[?#]|$)/i.test(url);
}

function xhrResponseText(xhr: XMLHttpRequest): string | undefined {
  try {
    if (xhr.responseType === '' || xhr.responseType === 'text') {
      return xhr.responseText;
    }

    if (typeof xhr.response === 'string') {
      return xhr.response;
    }

    if (xhr.response instanceof ArrayBuffer) {
      return new TextDecoder().decode(xhr.response);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function dedupeSegments<T extends { url: string }>(segments: T[]): T[] {
  const seenUrls = new Set<string>();
  return segments.filter((segment) => {
    if (seenUrls.has(segment.url)) {
      return false;
    }
    seenUrls.add(segment.url);
    return true;
  });
}

function sortSegments<T extends { presentationTime?: number; url: string }>(segments: T[]): T[] {
  if (!segments.every((segment) => segment.presentationTime !== undefined)) {
    return segments;
  }

  return [...segments].sort(
    (left, right) =>
      (left.presentationTime ?? 0) - (right.presentationTime ?? 0) ||
      left.url.localeCompare(right.url),
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
