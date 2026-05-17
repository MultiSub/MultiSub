import { MESSAGE_SOURCE, type ContentToPageMessage, type PageToContentMessage, type SubtitleCue, type SubtitleTrack } from './messages';
import {
  DEFAULT_SUBTITLE_SETTINGS,
  SETTINGS_STORAGE_KEY,
  sanitizeSubtitleSettings,
  type SubtitleSettings,
} from './settings';

interface StoredSelection {
  secondaryTrackId?: string | null;
  secondaryLanguage?: string | null;
}

const STORAGE_KEYS: (keyof StoredSelection)[] = ['secondaryTrackId', 'secondaryLanguage'];
const DEBUG_SNAPSHOT_ID = 'hbo-dual-sub-debug';
const DEBUG_SNAPSHOT_INTERVAL_MS = 250;
const PRIMARY_SUBTITLE_SCALE_MULTIPLIER = 1.16;

let tracks: SubtitleTrack[] = [];
let selectedTrackId: string | null = null;
let cues: SubtitleCue[] = [];
let primaryTrackId: string | null = null;
let primaryCues: SubtitleCue[] = [];
let overlay: HTMLDivElement | undefined;
let primaryOverlay: HTMLDivElement | undefined;
let bottomStack: HTMLDivElement | undefined;
let storedSelectionPromise: Promise<StoredSelection> | undefined;
let storedSettingsPromise: Promise<SubtitleSettings> | undefined;
let subtitleSettings: SubtitleSettings = DEFAULT_SUBTITLE_SETTINGS;
let restoredStoredSelection = false;
let animationStarted = false;
let currentCueText = '';
let currentPrimaryCueText = '';
let menuRenderQueued = false;
let debugSnapshotElement: HTMLScriptElement | undefined;
let lastDebugSnapshotAt = 0;

injectPageHook();
void loadStoredSettings();
loadStoredSelection();
installMessageListener();
installStorageListener();
onDocumentReady(() => {
  ensureOverlay();
  ensurePrimaryOverlay();
  installFullscreenObserver();
  installMenuObserver();
  startSubtitleLoop();
});

function injectPageHook(): void {
  const script = document.createElement('script');
  script.src = `${chrome.runtime.getURL('page-hook.js')}?v=${Date.now().toString(36)}`;
  script.async = false;
  script.onload = () => script.remove();
  (document.documentElement || document.head).append(script);
}

function loadStoredSelection(): Promise<StoredSelection> {
  storedSelectionPromise ??= new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS, (items) => resolve(items as StoredSelection));
  });
  return storedSelectionPromise;
}

function loadStoredSettings(): Promise<SubtitleSettings> {
  storedSettingsPromise ??= new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_STORAGE_KEY], (items) => {
      const settings = sanitizeSubtitleSettings((items as Record<string, unknown>)[SETTINGS_STORAGE_KEY]);
      subtitleSettings = settings;
      applyOverlaySettings();
      updatePrimaryModeState();
      resolve(settings);
    });
  });
  return storedSettingsPromise;
}

function installStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || changes[SETTINGS_STORAGE_KEY] === undefined) {
      return;
    }

    subtitleSettings = sanitizeSubtitleSettings(changes[SETTINGS_STORAGE_KEY].newValue);
    storedSettingsPromise = Promise.resolve(subtitleSettings);
    applyOverlaySettings();
    updatePrimaryModeState();
  });
}

function installMessageListener(): void {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isPageToContentMessage(event.data)) {
      return;
    }

    switch (event.data.type) {
      case 'tracks':
        tracks = event.data.tracks;
        void restoreSelectionFromStorage();
        syncPrimaryTrackFromNative();
        if (selectedTrackId !== null && !tracks.some((track) => track.id === selectedTrackId)) {
          selectSecondaryTrack(null, { persist: false });
        }
        queueMenuRender();
        publishDebugSnapshot();
        break;
      case 'cues':
        if (event.data.slot === 'primary' && event.data.trackId === primaryTrackId) {
          primaryCues = event.data.cues;
          clearPrimaryOverlay();
          syncSubtitleToVideo();
          publishDebugSnapshot();
        } else if ((event.data.slot ?? 'secondary') === 'secondary' && event.data.trackId === selectedTrackId) {
          cues = event.data.cues;
          clearOverlay();
          syncSubtitleToVideo();
          publishDebugSnapshot();
        }
        break;
      case 'error':
        console.warn(`[HBO Dual Sub] ${event.data.message}`);
        break;
    }
  });
}

async function restoreSelectionFromStorage(): Promise<void> {
  if (restoredStoredSelection || tracks.length === 0) {
    return;
  }

  const storedSelection = await loadStoredSelection();
  await loadStoredSettings();
  restoredStoredSelection = true;

  if (!Object.hasOwn(storedSelection, 'secondaryTrackId')) {
    return;
  }

  if (storedSelection.secondaryTrackId === null) {
    selectSecondaryTrack(null, { persist: false });
    return;
  }

  const matchingTrack =
    tracks.find((track) => track.id === storedSelection.secondaryTrackId) ??
    tracks.find((track) => track.language === storedSelection.secondaryLanguage);

  if (matchingTrack !== undefined) {
    selectSecondaryTrack(matchingTrack.id, { persist: false });
  }
}

function installMenuObserver(): void {
  const observer = new MutationObserver(queueMenuRender);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['aria-checked', 'aria-label'],
    childList: true,
    subtree: true,
  });
  queueMenuRender();
}

function installFullscreenObserver(): void {
  document.addEventListener('fullscreenchange', syncOverlayHost);
  document.addEventListener('webkitfullscreenchange', syncOverlayHost);
  syncOverlayHost();
}

function queueMenuRender(): void {
  if (menuRenderQueued) {
    return;
  }

  menuRenderQueued = true;
  window.setTimeout(() => {
    menuRenderQueued = false;
    renderMenuIfPresent();
  }, 50);
}

function renderMenuIfPresent(): void {
  const subtitlesGroup = findNativeSubtitlesGroup();
  if (subtitlesGroup === undefined) {
    return;
  }

  let menu = document.querySelector<HTMLElement>('[data-hbo-dual-sub-menu]');
  if (menu === null || !menu.isConnected) {
    menu = document.createElement('section');
    menu.dataset.hboDualSubMenu = 'true';
    menu.className = 'hbo-dual-sub-menu';
  }

  if (menu.parentElement !== subtitlesGroup.parentElement || menu.previousElementSibling !== subtitlesGroup) {
    subtitlesGroup.insertAdjacentElement('afterend', menu);
  }

  syncPrimaryTrackFromNative();
  renderSecondaryMenu(menu);
}

function renderSecondaryMenu(menu: HTMLElement): void {
  const nativeSubtitleOptions = nativeSubtitleLabels();
  const displayTracks = tracksWithNativeLabels(tracks, nativeSubtitleOptions);
  const heading = document.createElement('span');
  heading.className = 'hbo-dual-sub-menu__heading';
  heading.setAttribute('role', 'heading');
  heading.textContent = 'Secondary Subtitles';

  const list = document.createElement('div');
  list.className = 'hbo-dual-sub-menu__list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Secondary Subtitles');

  list.append(createOptionButton('Off', selectedTrackId === null, () => selectSecondaryTrack(null)));

  for (const track of displayTracks) {
    const option = createOptionButton(track.displayLabel, selectedTrackId === track.id, () => selectSecondaryTrack(track.id));
    option.dataset.hboDualSubTrackId = track.id;
    option.dataset.hboDualSubLanguage = track.language;
    list.append(option);
  }

  menu.replaceChildren(heading, list);
}

function nativeSubtitleLabels(): string[] {
  const subtitlesGroup = findNativeSubtitlesGroup();
  if (subtitlesGroup === undefined) {
    return [];
  }

  return Array.from(subtitlesGroup.querySelectorAll<HTMLElement>('[role="radio"]'))
    .map((radio) => (radio.getAttribute('aria-label') ?? radio.textContent ?? '').trim())
    .filter((label) => label !== '' && !/^off$/i.test(label));
}

function tracksWithNativeLabels(
  sourceTracks: SubtitleTrack[],
  nativeLabels: string[],
): Array<SubtitleTrack & { displayLabel: string; nativeOrder: number }> {
  const nativeByLanguage = new Map<string, { label: string; order: number }>();

  nativeLabels.forEach((label, order) => {
    const key = labelLanguageKey(label);
    if (key !== undefined && !nativeByLanguage.has(key)) {
      nativeByLanguage.set(key, { label, order });
    }
  });

  const mappedTracks = sourceTracks
    .map((track, fallbackOrder) => {
      const native = nativeByLanguage.get(trackLanguageKey(track.language));
      const fallbackLabel = simplifiedTrackLabel(track);
      return {
        ...track,
        displayLabel:
          native !== undefined && shouldUseNativeDisplayLabel(track, native.label) ? native.label : fallbackLabel,
        nativeOrder: native?.order ?? nativeLabels.length + fallbackOrder,
      };
    })
    .sort((left, right) => left.nativeOrder - right.nativeOrder || left.displayLabel.localeCompare(right.displayLabel));

  return dedupeDisplayLabels(mappedTracks);
}

function shouldUseNativeDisplayLabel(track: SubtitleTrack, nativeLabel: string): boolean {
  const languageKey = trackLanguageKey(track.language);
  if (languageKey !== 'en') {
    return true;
  }

  const nativeIsClosedCaption = /\b(?:cc|sdh)\b/i.test(nativeLabel);
  if (!nativeIsClosedCaption) {
    return true;
  }

  return /\b(?:cc|sdh)\b/i.test(track.label);
}

function dedupeDisplayLabels<T extends SubtitleTrack & { displayLabel: string; nativeOrder: number }>(tracksToDedupe: T[]): T[] {
  const labelCounts = new Map<string, number>();
  return tracksToDedupe.map((track) => {
    const count = labelCounts.get(track.displayLabel) ?? 0;
    labelCounts.set(track.displayLabel, count + 1);
    return count === 0 ? track : { ...track, displayLabel: `${track.displayLabel} ${count + 1}` };
  });
}

function simplifiedTrackLabel(track: SubtitleTrack): string {
  const key = trackLanguageKey(track.language);
  if (key === 'zh-Hans') {
    return 'Chinese (Simplified)';
  }
  if (key === 'zh-Hant') {
    return 'Chinese (Traditional)';
  }
  if (key === 'en') {
    return /^american english$/i.test(track.label) ? 'English' : track.label;
  }
  return track.label.replace(/\s+\((?:Malaysia|Singapore|Taiwan|United States)\)$/i, '');
}

function labelLanguageKey(label: string): string | undefined {
  if (/chinese.*simplified/i.test(label)) {
    return 'zh-Hans';
  }
  if (/chinese.*traditional/i.test(label)) {
    return 'zh-Hant';
  }
  if (/english/i.test(label)) {
    return 'en';
  }
  if (/indonesian/i.test(label)) {
    return 'id';
  }
  if (/malay/i.test(label)) {
    return 'ms';
  }
  if (/thai/i.test(label)) {
    return 'th';
  }

  return undefined;
}

function trackLanguageKey(language: string): string {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('zh-hans') || normalized === 'zh-cn' || normalized === 'zh-sg') {
    return 'zh-Hans';
  }
  if (normalized.startsWith('zh-hant') || normalized === 'zh-tw' || normalized === 'zh-hk') {
    return 'zh-Hant';
  }
  return normalized.split('-')[0];
}

function createOptionButton(label: string, checked: boolean, onSelect: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hbo-dual-sub-menu__option';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-checked', String(checked));
  button.textContent = label;
  let selectedFromPointer = false;

  const stopNativeMenuHandling = (event: Event): void => {
    event.stopPropagation();
  };

  const selectFromPointer = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    selectedFromPointer = true;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  };

  button.addEventListener('pointerdown', selectFromPointer, { capture: true });
  button.addEventListener('pointerup', stopNativeMenuHandling, { capture: true });
  button.addEventListener('mousedown', stopNativeMenuHandling);
  button.addEventListener('mouseup', stopNativeMenuHandling);
  button.addEventListener('touchstart', stopNativeMenuHandling, { passive: true });
  button.addEventListener('touchend', stopNativeMenuHandling);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedFromPointer) {
      selectedFromPointer = false;
      return;
    }
    onSelect();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelect();
  });

  return button;
}

function selectSecondaryTrack(trackId: string | null, options: { persist?: boolean } = {}): void {
  selectedTrackId = trackId;
  cues = [];
  clearOverlay();
  sendToPage({ source: MESSAGE_SOURCE, direction: 'content-to-page', type: 'select', slot: 'secondary', trackId });
  queueMenuRender();

  if (options.persist !== false) {
    const track = tracks.find((candidate) => candidate.id === trackId);
    persistSelection({
      secondaryTrackId: track?.id ?? null,
      secondaryLanguage: track?.language ?? null,
    });
  }
}

function syncPrimaryTrackFromNative(): void {
  if (!primaryPluginModeEnabled()) {
    selectPrimaryTrack(null);
    return;
  }

  const nativeLabel = nativeSelectedSubtitleLabel();
  if (nativeLabel === undefined) {
    updateNativeCaptionVisibility();
    return;
  }

  const track = nativeLabel === null ? undefined : trackForNativeSubtitleLabel(nativeLabel);
  selectPrimaryTrack(track?.id ?? null);
}

function selectPrimaryTrack(trackId: string | null): void {
  if (primaryTrackId === trackId) {
    updateNativeCaptionVisibility();
    return;
  }

  primaryTrackId = trackId;
  primaryCues = [];
  clearPrimaryOverlay();
  updateNativeCaptionVisibility();
  sendToPage({ source: MESSAGE_SOURCE, direction: 'content-to-page', type: 'select', slot: 'primary', trackId });
}

function nativeSelectedSubtitleLabel(): string | null | undefined {
  const subtitlesGroup = findNativeSubtitlesGroup();
  if (subtitlesGroup === undefined) {
    return undefined;
  }

  const checked = Array.from(subtitlesGroup.querySelectorAll<HTMLElement>('[role="radio"]')).find(
    (radio) => radio.getAttribute('aria-checked') === 'true',
  );
  const label = (checked?.getAttribute('aria-label') ?? checked?.textContent ?? '').trim();
  return label === '' || /^off$/i.test(label) ? null : label;
}

function trackForNativeSubtitleLabel(nativeLabel: string): SubtitleTrack | undefined {
  const nativeOptions = nativeSubtitleLabels();
  const displayTracks = tracksWithNativeLabels(tracks, nativeOptions);
  const exactMatch = displayTracks.find((track) => track.displayLabel === nativeLabel);
  if (exactMatch !== undefined) {
    return exactMatch;
  }

  const languageKey = labelLanguageKey(nativeLabel);
  if (languageKey === undefined) {
    return undefined;
  }

  const sameLanguageTracks = tracks.filter((track) => trackLanguageKey(track.language) === languageKey);
  const nativeWantsClosedCaptions = /\b(?:cc|sdh)\b/i.test(nativeLabel);
  return (
    sameLanguageTracks.find((track) => nativeWantsClosedCaptions && /\b(?:cc|sdh)\b/i.test(track.label)) ??
    sameLanguageTracks[0]
  );
}

function updatePrimaryModeState(): void {
  if (primaryPluginModeEnabled()) {
    syncPrimaryTrackFromNative();
  } else {
    selectPrimaryTrack(null);
  }
  updateNativeCaptionVisibility();
}

function primaryPluginModeEnabled(): boolean {
  return subtitleSettings.primarySubtitleMode === 'plugin';
}

function updateNativeCaptionVisibility(): void {
  document.documentElement.dataset.hboDualSubPrimaryMode =
    primaryPluginModeEnabled() && primaryTrackId !== null ? 'plugin' : 'native';
}

function persistSelection(selection: StoredSelection): void {
  try {
    void chrome.storage.local.set(selection);
  } catch (error) {
    console.warn(`[HBO Dual Sub] Unable to persist selection: ${messageFromError(error)}`);
  }
}

function startSubtitleLoop(): void {
  if (animationStarted) {
    return;
  }

  animationStarted = true;

  const tick = () => {
    syncSubtitleToVideo();
    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
}

function syncSubtitleToVideo(): void {
  const video = document.querySelector('video');
  if (video === null) {
    updateOverlay('');
    updatePrimaryOverlay('');
    publishDebugSnapshotThrottled();
    return;
  }

  const activeSecondaryCues = selectedTrackId === null || cues.length === 0 ? [] : findCuesAt(video.currentTime, cues);
  const activePrimaryCues =
    primaryTrackId === null || primaryCues.length === 0 ? [] : findCuesAt(video.currentTime, primaryCues);

  updateOverlay(activeSubtitleText(activeSecondaryCues));
  updatePrimaryOverlay(activeSubtitleText(activePrimaryCues));
  publishDebugSnapshotThrottled();
}

function activeSubtitleText(activeCues: SubtitleCue[]): string {
  if (activeCues.length === 0) {
    return '';
  }

  return Array.from(new Set(activeCues.map((cue) => cue.text))).join('\n');
}

function findCuesAt(time: number, sourceCues: SubtitleCue[] = cues): SubtitleCue[] {
  const lastStartedIndex = lastStartedCueIndex(time, sourceCues);

  if (lastStartedIndex === -1) {
    return [];
  }

  const activeCues: SubtitleCue[] = [];
  for (let index = 0; index <= lastStartedIndex; index += 1) {
    const cue = sourceCues[index];
    if (time <= cue.end) {
      activeCues.push(cue);
    }
  }

  return activeCues;
}

function lastStartedCueIndex(time: number, sourceCues: SubtitleCue[] = cues): number {
  let low = 0;
  let high = sourceCues.length - 1;
  let lastStartedIndex = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cue = sourceCues[mid];

    if (cue.start <= time) {
      lastStartedIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return lastStartedIndex;
}

function updateOverlay(text: string): void {
  ensureOverlay();
  if (text === currentCueText && overlay?.textContent === text) {
    return;
  }

  currentCueText = text;
  if (overlay !== undefined) {
    overlay.textContent = text;
  }
}

function clearOverlay(): void {
  ensureOverlay();
  currentCueText = '';
  if (overlay !== undefined) {
    overlay.textContent = '';
  }
}

function updatePrimaryOverlay(text: string): void {
  ensurePrimaryOverlay();
  if (text === currentPrimaryCueText && primaryOverlay?.textContent === text) {
    return;
  }

  currentPrimaryCueText = text;
  if (primaryOverlay !== undefined) {
    primaryOverlay.textContent = text;
  }
}

function clearPrimaryOverlay(): void {
  ensurePrimaryOverlay();
  currentPrimaryCueText = '';
  if (primaryOverlay !== undefined) {
    primaryOverlay.textContent = '';
  }
}

function publishDebugSnapshotThrottled(): void {
  const now = window.performance.now();
  if (now - lastDebugSnapshotAt < DEBUG_SNAPSHOT_INTERVAL_MS) {
    return;
  }

  lastDebugSnapshotAt = now;
  publishDebugSnapshot();
}

function publishDebugSnapshot(): void {
  const debugElement = ensureDebugSnapshotElement();
  if (debugElement === undefined) {
    return;
  }

  const video = document.querySelector('video');
  const videoTime = video instanceof HTMLVideoElement ? video.currentTime : null;
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
  const primaryTrack = tracks.find((track) => track.id === primaryTrackId);
  const activeCues = videoTime === null ? [] : findCuesAt(videoTime, cues);
  const activePrimaryCues = videoTime === null ? [] : findCuesAt(videoTime, primaryCues);

  debugElement.textContent = JSON.stringify({
    version: 1,
    href: window.location.href,
    updatedAt: new Date().toISOString(),
    video: video instanceof HTMLVideoElement
      ? {
          currentTime: roundTime(video.currentTime),
          duration: Number.isFinite(video.duration) ? roundTime(video.duration) : null,
          paused: video.paused,
          readyState: video.readyState,
        }
      : null,
    nativeSubtitleText: nativeSubtitleText(),
    primarySubtitleMode: subtitleSettings.primarySubtitleMode,
    secondarySubtitlePlacement: subtitleSettings.secondarySubtitlePlacement,
    primaryOverlayText: primaryOverlay?.textContent ?? '',
    primaryTrack: primaryTrack === undefined ? null : debugTrack(primaryTrack),
    primaryTrackId,
    primaryCueCount: primaryCues.length,
    activePrimaryCues: activePrimaryCues.map(debugCue),
    secondaryOverlayText: overlay?.textContent ?? '',
    selectedTrack: selectedTrack === undefined ? null : debugTrack(selectedTrack),
    selectedTrackId,
    cueCount: cues.length,
    activeCues: activeCues.map(debugCue),
    nearbyCues: videoTime === null ? [] : nearbyCues(videoTime),
    tracks: tracks.map(debugTrack),
    menu: debugMenuOptions(),
    timeline: {
      manifestDuration: document.documentElement.dataset.hboDualSubManifestDuration ?? null,
      videoDuration: document.documentElement.dataset.hboDualSubVideoDuration ?? null,
      offset: document.documentElement.dataset.hboDualSubTimelineOffset ?? null,
    },
  });
}

function ensureDebugSnapshotElement(): HTMLScriptElement | undefined {
  if (debugSnapshotElement !== undefined && debugSnapshotElement.isConnected) {
    return debugSnapshotElement;
  }

  const existing = document.getElementById(DEBUG_SNAPSHOT_ID);
  if (existing instanceof HTMLScriptElement) {
    debugSnapshotElement = existing;
    return debugSnapshotElement;
  }

  if (document.documentElement === null) {
    return undefined;
  }

  debugSnapshotElement = document.createElement('script');
  debugSnapshotElement.id = DEBUG_SNAPSHOT_ID;
  debugSnapshotElement.type = 'application/json';
  document.documentElement.append(debugSnapshotElement);
  return debugSnapshotElement;
}

function nearbyCues(time: number): Array<SubtitleCue & { index: number }> {
  const lastStartedIndex = lastStartedCueIndex(time);
  const centerIndex = lastStartedIndex === -1 ? 0 : lastStartedIndex;
  const start = Math.max(0, centerIndex - 3);
  const end = Math.min(cues.length, centerIndex + 4);
  return cues.slice(start, end).map((cue, index) => ({ ...cue, index: start + index }));
}

function nativeSubtitleText(): string {
  const textCueElements = visibleNativeCaptionElements('[class*="TextCue"]');
  const sourceElements = textCueElements.length > 0
    ? textCueElements
    : visibleNativeCaptionElements('[class*="CaptionWindow"]');
  return Array.from(new Set(sourceElements.map((element) => normalizedElementText(element)).filter(Boolean))).join('\n');
}

function visibleNativeCaptionElements(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.closest('[data-hbo-dual-sub-menu]') === null &&
      element.closest('[data-hbo-dual-sub-overlay]') === null &&
      element.closest('[data-hbo-dual-sub-primary-overlay]') === null &&
      isElementVisible(element),
  );
}

function normalizedElementText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function debugCue(cue: SubtitleCue): SubtitleCue {
  return {
    start: roundTime(cue.start),
    end: roundTime(cue.end),
    text: cue.text,
  };
}

function debugTrack(track: SubtitleTrack) {
  const segments = segmentsForDebug(track);
  return {
    id: track.id,
    label: track.label,
    language: track.language,
    segmentCount: segments.length,
    variantCount: track.variants?.length ?? 1,
    firstSegment: debugSegment(segments[0]),
    lastSegment: debugSegment(segments.at(-1)),
    segments: segments.map(debugSegment),
  };
}

function segmentsForDebug(track: SubtitleTrack) {
  return track.variants === undefined
    ? track.segments
    : track.variants.flatMap((variant) => variant.segments);
}

function debugSegment(segment: ReturnType<typeof segmentsForDebug>[number] | undefined) {
  if (segment === undefined) {
    return null;
  }

  return {
    duration: segment.duration === undefined ? null : roundTime(segment.duration),
    presentationTime: segment.presentationTime === undefined ? null : roundTime(segment.presentationTime),
    mediaTime: segment.mediaTime === undefined ? null : roundTime(segment.mediaTime),
    url: segment.url,
    urlTail: urlTail(segment.url),
  };
}

function debugMenuOptions() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-hbo-dual-sub-menu] [role="radio"]')).map((option) => ({
    label: option.getAttribute('aria-label') ?? normalizedElementText(option),
    checked: option.getAttribute('aria-checked') === 'true',
    trackId: option.dataset.hboDualSubTrackId ?? null,
    language: option.dataset.hboDualSubLanguage ?? null,
  }));
}

function urlTail(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).slice(-3).join('/');
  } catch {
    return url.split('/').filter(Boolean).slice(-3).join('/');
  }
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ensureOverlay(): void {
  if (overlay !== undefined && overlay.isConnected) {
    syncOverlayHost();
    return;
  }

  if (overlayHost() === null) {
    return;
  }

  overlay = document.createElement('div');
  overlay.className = 'hbo-dual-sub-overlay';
  overlay.dataset.hboDualSubOverlay = 'true';
  applyOverlaySettings();
  syncOverlayHost();
}

function ensurePrimaryOverlay(): void {
  if (primaryOverlay !== undefined && primaryOverlay.isConnected) {
    syncOverlayHost();
    return;
  }

  if (overlayHost() === null) {
    return;
  }

  primaryOverlay = document.createElement('div');
  primaryOverlay.className = 'hbo-dual-sub-overlay hbo-dual-sub-primary-overlay';
  primaryOverlay.dataset.hboDualSubPrimaryOverlay = 'true';
  applyOverlaySettings();
  syncOverlayHost();
}

function applyOverlaySettings(): void {
  syncOverlayHost();

  const baseBottom = subtitleSettings.secondaryBottomVh;
  const stackLowerSubtitles = shouldStackLowerSubtitles();
  const primaryBottom = baseBottom;
  const secondaryPosition =
    subtitleSettings.secondarySubtitlePlacement === 'top'
      ? { edge: 'top' as const, vh: baseBottom }
      : {
          edge: 'bottom' as const,
          vh: baseBottom,
        };

  if (overlay !== undefined) {
    applyTextOverlaySettings(overlay, secondaryPosition, subtitleSettings.secondaryTextScale);
  }

  if (primaryOverlay !== undefined) {
    applyTextOverlaySettings(primaryOverlay, { edge: 'bottom', vh: primaryBottom }, primarySubtitleTextScale());
  }

  if (bottomStack !== undefined) {
    bottomStack.style.bottom = `clamp(72px, ${baseBottom.toFixed(1)}vh, 260px)`;
    bottomStack.hidden = !stackLowerSubtitles;
  }
}

function syncOverlayHost(): void {
  const host = overlayHost();
  if (host === null) {
    return;
  }

  if (shouldStackLowerSubtitles()) {
    const stack = ensureBottomStack(host);
    if (primaryOverlay !== undefined && overlay !== undefined) {
      stack.append(primaryOverlay, overlay);
    } else if (primaryOverlay !== undefined) {
      stack.append(primaryOverlay);
    } else if (overlay !== undefined) {
      stack.append(overlay);
    }
    return;
  }

  if (primaryOverlay !== undefined && primaryOverlay.parentElement !== host) {
    host.append(primaryOverlay);
  }

  if (overlay !== undefined && overlay.parentElement !== host) {
    host.append(overlay);
  }

  if (bottomStack !== undefined) {
    bottomStack.hidden = true;
  }
}

function overlayHost(): HTMLElement | null {
  const fullscreenElement = document.fullscreenElement;
  if (fullscreenElement instanceof HTMLElement && !(fullscreenElement instanceof HTMLVideoElement)) {
    return fullscreenElement;
  }

  return document.body;
}

function primarySubtitleTextScale(): number {
  return subtitleSettings.secondaryTextScale * PRIMARY_SUBTITLE_SCALE_MULTIPLIER;
}

function shouldStackLowerSubtitles(): boolean {
  return (
    primaryPluginModeEnabled() &&
    primaryTrackId !== null &&
    selectedTrackId !== null &&
    subtitleSettings.secondarySubtitlePlacement === 'bottom'
  );
}

function ensureBottomStack(host: HTMLElement): HTMLDivElement {
  if (bottomStack === undefined) {
    bottomStack = document.createElement('div');
    bottomStack.className = 'hbo-dual-sub-stack';
    bottomStack.dataset.hboDualSubStack = 'true';
  }

  if (bottomStack.parentElement !== host) {
    host.append(bottomStack);
  }

  bottomStack.hidden = false;
  return bottomStack;
}

function applyTextOverlaySettings(
  element: HTMLElement,
  position: { edge: 'top' | 'bottom'; vh: number },
  textScale: number,
): void {
  element.style.color = subtitleSettings.secondaryTextColor;
  element.style.opacity = subtitleSettings.secondaryTextOpacity.toFixed(2);
  element.style.fontSize = `clamp(${Math.round(20 * textScale)}px, ${(2.1 * textScale).toFixed(2)}vw, ${Math.round(36 * textScale)}px)`;
  if (position.edge === 'top') {
    element.style.top = `clamp(56px, ${position.vh.toFixed(1)}vh, 220px)`;
    element.style.bottom = 'auto';
  } else {
    element.style.top = 'auto';
    element.style.bottom = `clamp(72px, ${position.vh.toFixed(1)}vh, 260px)`;
  }
  element.style.webkitTextStrokeWidth = `${subtitleSettings.secondaryTextStroke.toFixed(2)}px`;
}

function findNativeSubtitlesGroup(): HTMLElement | undefined {
  const groups = Array.from(document.querySelectorAll<HTMLElement>('[role="radiogroup"]'));
  const candidates = groups.filter((group) => {
    if (group.closest('[data-hbo-dual-sub-menu]') !== null) {
      return false;
    }

    const label = group.getAttribute('aria-label') ?? '';
    if (/subtitles/i.test(label)) {
      return true;
    }

    const radioLabels = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).map((radio) =>
      (radio.getAttribute('aria-label') ?? radio.textContent ?? '').trim(),
    );

    return radioLabels.includes('Off') && radioLabels.some((radioLabel) => /English|Chinese|Thai|Malay|Indonesian/i.test(radioLabel));
  });

  return candidates.find(isElementVisible) ?? candidates[0];
}

function isElementVisible(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) {
    return false;
  }

  let current: HTMLElement | null = element;
  while (current !== null) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    current = current.parentElement;
  }

  return true;
}

function sendToPage(message: ContentToPageMessage): void {
  window.postMessage(message, '*');
}

function isPageToContentMessage(value: unknown): value is PageToContentMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PageToContentMessage).source === MESSAGE_SOURCE &&
    (value as PageToContentMessage).direction === 'page-to-content'
  );
}

function onDocumentReady(callback: () => void): void {
  if (document.body !== null) {
    callback();
    return;
  }

  document.addEventListener('DOMContentLoaded', callback, { once: true });
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
