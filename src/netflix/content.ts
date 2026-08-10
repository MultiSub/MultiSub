import { shouldUsePluginPrimary } from '../subtitle-state';
import {
  NETFLIX_MESSAGE_SOURCE,
  type NetflixContentToPageMessage,
  type NetflixPageToContentMessage,
  type NetflixSubtitleCue,
  type NetflixSubtitleTrack,
} from './messages';
import {
  DEFAULT_SUBTITLE_SETTINGS,
  NETFLIX_SELECTION_STORAGE_KEY,
  NETFLIX_SETTINGS_STORAGE_KEY,
  sanitizeSubtitleSettings,
  subtitleFontFamilyCss,
  type SubtitleSettings,
} from './settings';
import {
  findNetflixTrackForSelection,
  type NetflixAvailabilityState,
  type StoredNetflixSelection,
} from './track-model';
import {
  isNetflixAudioSubtitlePanelCandidate,
  isNetflixMenuPopoverAnchorCandidate,
} from './menu-model';

const DEBUG_SNAPSHOT_ID = 'netflix-dual-sub-debug';
const DEBUG_SNAPSHOT_INTERVAL_MS = 250;
const PRIMARY_SUBTITLE_SCALE_MULTIPLIER = 1.16;

let activeMediaId: string | null = null;
let currentNativeTrackId: string | null = null;
let tracks: NetflixSubtitleTrack[] = [];
let selectedTrackId: string | null = null;
let cues: NetflixSubtitleCue[] = [];
let primaryTrackId: string | null = null;
let primaryCues: NetflixSubtitleCue[] = [];
let overlay: HTMLDivElement | undefined;
let primaryOverlay: HTMLDivElement | undefined;
let bottomStack: HTMLDivElement | undefined;
let subtitleSettings: SubtitleSettings = DEFAULT_SUBTITLE_SETTINGS;
let storedSelection: StoredNetflixSelection = { trackId: null, language: null, kind: null };
let selectionLoaded = false;
let selectionRestoredForMedia: string | null = null;
let animationStarted = false;
let currentCueText = '';
let currentPrimaryCueText = '';
let menuRenderQueued = false;
let menuPopoverAnchor: HTMLElement | undefined;
let menuPopoverAnchorObserver: MutationObserver | undefined;
let debugSnapshotElement: HTMLScriptElement | undefined;
let lastDebugSnapshotAt = 0;

installMessageListener();
installRuntimeMessageListener();
announcePageBridgeReady();
installStorageListener();
void loadStoredState();
onDocumentReady(() => {
  ensureOverlay();
  ensurePrimaryOverlay();
  installFullscreenObserver();
  installMenuObserver();
  startSubtitleLoop();
});

async function loadStoredState(): Promise<void> {
  const items = await chrome.storage.local.get([
    NETFLIX_SETTINGS_STORAGE_KEY,
    NETFLIX_SELECTION_STORAGE_KEY,
  ]);
  subtitleSettings = sanitizeSubtitleSettings(items[NETFLIX_SETTINGS_STORAGE_KEY]);
  storedSelection = sanitizeStoredSelection(items[NETFLIX_SELECTION_STORAGE_KEY]);
  selectionLoaded = true;
  applyOverlaySettings();
  syncPrimarySelection();
  restoreSelectionForCurrentMedia();
}

function installStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    const settingsChange = changes[NETFLIX_SETTINGS_STORAGE_KEY];
    if (settingsChange !== undefined) {
      subtitleSettings = sanitizeSubtitleSettings(settingsChange.newValue);
      applyOverlaySettings();
      syncPrimarySelection();
    }

    const selectionChange = changes[NETFLIX_SELECTION_STORAGE_KEY];
    if (selectionChange !== undefined) {
      storedSelection = sanitizeStoredSelection(selectionChange.newValue);
      selectionLoaded = true;
    }
  });
}

function installMessageListener(): void {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isPageToContentMessage(event.data)) {
      return;
    }

    switch (event.data.type) {
      case 'tracks':
        handleTracksMessage(event.data.mediaId, event.data.currentTrackId, event.data.tracks);
        break;
      case 'cues':
        if (event.data.mediaId !== activeMediaId) {
          return;
        }
        if (event.data.slot === 'primary' && event.data.trackId === primaryTrackId) {
          primaryCues = event.data.cues;
          clearPrimaryOverlay();
          updateNativeCaptionVisibility();
          applyOverlaySettings();
          syncSubtitleToVideo();
        } else if (event.data.slot === 'secondary' && event.data.trackId === selectedTrackId) {
          cues = event.data.cues;
          clearOverlay();
          syncSubtitleToVideo();
        }
        publishDebugSnapshot();
        break;
      case 'error':
        console.warn(`[Netflix Dual Sub] ${event.data.message}`);
        break;
    }
  });
}

function installRuntimeMessageListener(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isSecondarySelectionRequest(message)) {
      selectSecondaryTrack(message.trackId, { persist: false });
      return;
    }
    if (!isAvailabilityRequest(message)) {
      return;
    }
    sendResponse({
      source: NETFLIX_MESSAGE_SOURCE,
      direction: 'content-to-extension',
      type: 'availability',
      availability: currentAvailability(),
    });
  });
}

function announcePageBridgeReady(): void {
  sendToPage({
    source: NETFLIX_MESSAGE_SOURCE,
    direction: 'content-to-page',
    type: 'ready',
  });
}

function handleTracksMessage(
  mediaId: string | null,
  nativeTrackId: string | null,
  nextTracks: NetflixSubtitleTrack[],
): void {
  const mediaChanged = mediaId !== activeMediaId;
  if (mediaChanged) {
    activeMediaId = mediaId;
    selectedTrackId = null;
    primaryTrackId = null;
    currentNativeTrackId = null;
    cues = [];
    primaryCues = [];
    selectionRestoredForMedia = null;
    clearOverlay();
    clearPrimaryOverlay();
  }

  tracks = nextTracks;
  currentNativeTrackId = nativeTrackId;

  if (selectedTrackId !== null && !tracks.some((track) => track.id === selectedTrackId)) {
    selectedTrackId = null;
    cues = [];
    clearOverlay();
  }

  syncPrimarySelection();
  restoreSelectionForCurrentMedia();
  queueMenuRender();
  publishDebugSnapshot();
}

function restoreSelectionForCurrentMedia(): void {
  if (!selectionLoaded || activeMediaId === null || tracks.length === 0) {
    return;
  }
  if (selectionRestoredForMedia === activeMediaId && selectedTrackId !== null) {
    return;
  }
  selectionRestoredForMedia = activeMediaId;
  applyStoredSelection(true);
}

function applyStoredSelection(force = false): void {
  if (activeMediaId === null || tracks.length === 0) {
    return;
  }
  const track = findNetflixTrackForSelection(tracks, storedSelection);
  selectSecondaryTrack(track?.id ?? null, { force, persist: false });
}

function selectSecondaryTrack(
  trackId: string | null,
  options: { force?: boolean; persist?: boolean } = {},
): void {
  const validTrackId = trackId !== null && tracks.some((track) => track.id === trackId) ? trackId : null;
  if (!options.force && selectedTrackId === validTrackId) {
    return;
  }

  selectedTrackId = validTrackId;
  cues = [];
  clearOverlay();
  sendToPage({
    source: NETFLIX_MESSAGE_SOURCE,
    direction: 'content-to-page',
    type: 'select',
    mediaId: activeMediaId,
    slot: 'secondary',
    trackId: validTrackId,
  });
  queueMenuRender();

  if (options.persist !== false) {
    const track = tracks.find((candidate) => candidate.id === validTrackId);
    storedSelection = {
      trackId: track?.id ?? null,
      language: track?.language ?? null,
      kind: track?.kind ?? null,
    };
    selectionLoaded = true;
    void chrome.storage.local.set({ [NETFLIX_SELECTION_STORAGE_KEY]: storedSelection });
  }
}

function syncPrimarySelection(): void {
  const nextTrackId =
    subtitleSettings.primarySubtitleMode === 'plugin' &&
    currentNativeTrackId !== null &&
    tracks.some((track) => track.id === currentNativeTrackId)
      ? currentNativeTrackId
      : null;
  selectPrimaryTrack(nextTrackId);
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
  sendToPage({
    source: NETFLIX_MESSAGE_SOURCE,
    direction: 'content-to-page',
    type: 'select',
    mediaId: activeMediaId,
    slot: 'primary',
    trackId,
  });
}

function currentAvailability(): NetflixAvailabilityState {
  return {
    mediaId: activeMediaId,
    currentTrackId: currentNativeTrackId,
    selectedTrackId,
    tracks,
  };
}

function installMenuObserver(): void {
  const observer = new MutationObserver((mutations) => {
    const onlyPluginMenuChanged = mutations.every((mutation) => {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      return target?.closest('[data-netflix-dual-sub-menu]') !== null;
    });
    if (!onlyPluginMenuChanged) {
      queueMenuRender();
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['aria-checked', 'aria-label', 'data-uia'],
    childList: true,
    subtree: true,
  });
  queueMenuRender();
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
  const nativePanel = findNativeAudioSubtitlePanel();
  if (nativePanel === undefined || tracks.length === 0 || activeMediaId === null) {
    document.querySelector<HTMLElement>('[data-netflix-dual-sub-menu]')?.remove();
    clearMenuPopoverAnchor();
    return;
  }

  const nativeSubtitleColumn = findNativeSubtitleColumn(nativePanel);
  if (nativeSubtitleColumn === undefined) {
    document.querySelector<HTMLElement>('[data-netflix-dual-sub-menu]')?.remove();
    clearMenuPopoverAnchor();
    return;
  }

  let menu = document.querySelector<HTMLElement>('[data-netflix-dual-sub-menu]');
  if (menu === null || !menu.isConnected) {
    menu = document.createElement('div');
    menu.dataset.netflixDualSubMenu = 'true';
  }
  syncNativeMenuColumn(menu, nativeSubtitleColumn);
  if (menu.parentElement !== nativePanel) {
    nativePanel.append(menu);
  }
  syncMenuPopoverAnchor(nativePanel);
  syncNativeMenuMetrics(menu, nativeSubtitleColumn);

  const nativeHeading = findNativeColumnHeading(nativeSubtitleColumn);
  const renderKey = JSON.stringify([
    selectedTrackId,
    tracks,
    nativeSubtitleColumn.className,
    nativeHeading?.tagName,
    nativeHeading?.className,
  ]);
  if (menu.dataset.netflixDualSubRenderKey === renderKey) {
    syncMenuSelection(menu);
    return;
  }

  const heading = document.createElement(nativeHeading?.tagName.toLowerCase() ?? 'h3');
  if (nativeHeading?.className !== undefined) {
    heading.className = nativeHeading.className;
  }
  heading.classList.add('netflix-dual-sub-menu__heading');
  for (const attribute of ['role', 'aria-level'] as const) {
    const value = nativeHeading?.getAttribute(attribute);
    if (value !== null && value !== undefined) {
      heading.setAttribute(attribute, value);
    }
  }
  heading.textContent = 'Secondary Subtitles';

  const list = document.createElement('div');
  list.className = 'netflix-dual-sub-menu__list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Secondary subtitles');
  list.append(createMenuOption('Off', null));
  for (const track of tracks) {
    list.append(createMenuOption(track.label, track));
  }

  menu.replaceChildren(heading, list);
  menu.dataset.netflixDualSubRenderKey = renderKey;
}

function syncMenuPopoverAnchor(nativePanel: HTMLElement): void {
  const nextAnchor = findMenuPopoverAnchor(nativePanel);
  if (nextAnchor === menuPopoverAnchor) {
    if (nextAnchor !== undefined) {
      ensureMenuPopoverAnchorMarkers(nextAnchor);
    }
    return;
  }

  clearMenuPopoverAnchor();
  if (nextAnchor === undefined) {
    return;
  }
  menuPopoverAnchor = nextAnchor;
  ensureMenuPopoverAnchorMarkers(nextAnchor);
  menuPopoverAnchorObserver = new MutationObserver(() => {
    if (menuPopoverAnchor === nextAnchor && nextAnchor.isConnected) {
      ensureMenuPopoverAnchorMarkers(nextAnchor);
    }
  });
  menuPopoverAnchorObserver.observe(nextAnchor, {
    attributes: true,
    attributeFilter: ['class', 'data-netflix-dual-sub-menu-popover-anchor'],
  });
}

function ensureMenuPopoverAnchorMarkers(anchor: HTMLElement): void {
  if (!anchor.classList.contains('netflix-dual-sub-menu-popover-anchor')) {
    anchor.classList.add('netflix-dual-sub-menu-popover-anchor');
  }
  if (anchor.dataset.netflixDualSubMenuPopoverAnchor !== 'true') {
    anchor.dataset.netflixDualSubMenuPopoverAnchor = 'true';
  }
}

function findMenuPopoverAnchor(nativePanel: HTMLElement): HTMLElement | undefined {
  let candidate = nativePanel.parentElement;
  for (let depth = 0; candidate !== null && depth < 5; depth += 1) {
    if (candidate === document.body || candidate === document.documentElement) {
      return undefined;
    }

    const containsVideo = candidate.querySelector('video') !== null;
    if (isNetflixMenuPopoverAnchorCandidate(window.getComputedStyle(candidate).position, containsVideo)) {
      return candidate;
    }
    if (containsVideo) {
      return undefined;
    }
    candidate = candidate.parentElement;
  }
  return undefined;
}

function clearMenuPopoverAnchor(): void {
  menuPopoverAnchorObserver?.disconnect();
  menuPopoverAnchorObserver = undefined;
  if (menuPopoverAnchor === undefined) {
    return;
  }
  menuPopoverAnchor.classList.remove('netflix-dual-sub-menu-popover-anchor');
  delete menuPopoverAnchor.dataset.netflixDualSubMenuPopoverAnchor;
  menuPopoverAnchor = undefined;
}

const NATIVE_COLUMN_STYLE_PROPERTIES = [
  'box-sizing',
  'display',
  'flex',
  'flex-direction',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'margin',
  'padding',
] as const;

function syncNativeMenuColumn(menu: HTMLElement, nativeColumn: HTMLElement): void {
  menu.className = nativeColumn.className;
  menu.classList.add('netflix-dual-sub-menu', 'netflix-dual-sub-menu-column');

  const nativeStyle = window.getComputedStyle(nativeColumn);
  for (const property of NATIVE_COLUMN_STYLE_PROPERTIES) {
    menu.style.setProperty(property, nativeStyle.getPropertyValue(property));
  }
}

function syncNativeMenuMetrics(menu: HTMLElement, nativeColumn: HTMLElement): void {
  const nativeOption = nativeMenuOptions(nativeColumn)[0];
  if (nativeOption !== undefined) {
    const optionStyle = window.getComputedStyle(nativeOption);
    const optionHeight = nativeOption.getBoundingClientRect().height;
    menu.style.setProperty('--netflix-dual-sub-option-font-size', optionStyle.fontSize);
    menu.style.setProperty('--netflix-dual-sub-option-line-height', optionStyle.lineHeight);
    if (optionHeight > 0) {
      menu.style.setProperty('--netflix-dual-sub-option-height', `${optionHeight.toFixed(2)}px`);
    }
  }

  const nativeHeading = findNativeColumnHeading(nativeColumn);
  if (nativeHeading !== undefined) {
    const headingStyle = window.getComputedStyle(nativeHeading);
    menu.style.setProperty('--netflix-dual-sub-heading-font-size', headingStyle.fontSize);
    menu.style.setProperty('--netflix-dual-sub-heading-line-height', headingStyle.lineHeight);
  }
}

function syncMenuSelection(menu: HTMLElement): void {
  for (const option of menu.querySelectorAll<HTMLElement>('[role="radio"]')) {
    const trackId = option.dataset.netflixDualSubTrackId;
    option.setAttribute('aria-checked', String(trackId === undefined ? selectedTrackId === null : trackId === selectedTrackId));
  }
}

function createMenuOption(label: string, track: NetflixSubtitleTrack | null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'netflix-dual-sub-menu__option';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-checked', String((track?.id ?? null) === selectedTrackId));
  button.textContent = label;
  if (track !== null) {
    button.dataset.netflixDualSubTrackId = track.id;
    button.dataset.netflixDualSubLanguage = track.language;
  }
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
    selectSecondaryTrack(track?.id ?? null);
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
    selectSecondaryTrack(track?.id ?? null);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectSecondaryTrack(track?.id ?? null);
  });
  return button;
}

function findNativeAudioSubtitlePanel(): HTMLElement | undefined {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('div[data-uia="selector-audio-subtitle"]'),
  ).filter((candidate) => isNetflixAudioSubtitlePanelCandidate(
    candidate.tagName,
    candidate.getAttribute('data-uia'),
    nativeMenuOptions(candidate).length,
  ));
  return candidates.find(isElementVisible) ?? candidates[0];
}

function findNativeSubtitleColumn(panel: HTMLElement): HTMLElement | undefined {
  const directChildren = Array.from(panel.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement);
  const preferred = directChildren[1];
  if (preferred !== undefined && isNativeNetflixMenuColumn(preferred)) {
    return preferred;
  }
  return directChildren
    .slice(0, 2)
    .reverse()
    .find(isNativeNetflixMenuColumn);
}

function isNativeNetflixMenuColumn(candidate: HTMLElement): boolean {
  return !candidate.matches('[data-netflix-dual-sub-menu], .nflxmultisubs-subtitle-list') &&
    nativeMenuOptions(candidate).length > 0;
}

function findNativeColumnHeading(nativeColumn: HTMLElement): HTMLElement | undefined {
  return Array.from(nativeColumn.querySelectorAll<HTMLElement>('h2, h3, [role="heading"]'))[0];
}

function nativeMenuOptions(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>('li, [role="radio"], [role="menuitemradio"]'))
    .filter((option) => option.closest('[data-netflix-dual-sub-menu]') === null);
}

function startSubtitleLoop(): void {
  if (animationStarted) {
    return;
  }
  animationStarted = true;
  const tick = () => {
    syncSubtitleToVideo();
    if (activeMediaId === null) {
      window.setTimeout(() => window.requestAnimationFrame(tick), 500);
    } else {
      window.requestAnimationFrame(tick);
    }
  };
  window.requestAnimationFrame(tick);
}

function syncSubtitleToVideo(): void {
  const video = activeVideo();
  if (video === null || activeMediaId === null) {
    updateOverlay('');
    updatePrimaryOverlay('');
    publishDebugSnapshotThrottled();
    return;
  }

  const secondary = selectedTrackId === null ? [] : findCuesAt(video.currentTime, cues);
  const primary = primaryTrackId === null ? [] : findCuesAt(video.currentTime, primaryCues);
  updateOverlay(activeSubtitleText(secondary));
  updatePrimaryOverlay(activeSubtitleText(primary));
  publishDebugSnapshotThrottled();
}

function activeSubtitleText(activeCues: NetflixSubtitleCue[]): string {
  return Array.from(new Set(activeCues.map((cue) => cue.text).filter(Boolean))).join('\n');
}

function findCuesAt(time: number, sourceCues: NetflixSubtitleCue[]): NetflixSubtitleCue[] {
  const lastStartedIndex = lastStartedCueIndex(time, sourceCues);
  if (lastStartedIndex === -1) {
    return [];
  }

  const active: NetflixSubtitleCue[] = [];
  for (let index = 0; index <= lastStartedIndex; index += 1) {
    const cue = sourceCues[index];
    if (time <= cue.end) {
      active.push(cue);
    }
  }
  return active;
}

function lastStartedCueIndex(time: number, sourceCues: NetflixSubtitleCue[]): number {
  let low = 0;
  let high = sourceCues.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (sourceCues[middle].start <= time) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
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
  currentPrimaryCueText = '';
  if (primaryOverlay !== undefined) {
    primaryOverlay.textContent = '';
  }
}

function ensureOverlay(): void {
  if (overlay !== undefined && overlay.isConnected) {
    syncOverlayHost();
    return;
  }
  const host = overlayHost();
  if (host === null) {
    return;
  }
  overlay = document.createElement('div');
  overlay.className = 'netflix-dual-sub-overlay';
  overlay.dataset.netflixDualSubOverlay = 'true';
  applyOverlaySettings();
  syncOverlayHost();
}

function ensurePrimaryOverlay(): void {
  if (primaryOverlay !== undefined && primaryOverlay.isConnected) {
    syncOverlayHost();
    return;
  }
  const host = overlayHost();
  if (host === null) {
    return;
  }
  primaryOverlay = document.createElement('div');
  primaryOverlay.className = 'netflix-dual-sub-overlay netflix-dual-sub-primary-overlay';
  primaryOverlay.dataset.netflixDualSubPrimaryOverlay = 'true';
  applyOverlaySettings();
  syncOverlayHost();
}

function installFullscreenObserver(): void {
  document.addEventListener('fullscreenchange', syncOverlayHost);
  document.addEventListener('webkitfullscreenchange', syncOverlayHost);
  syncOverlayHost();
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
  if (document.fullscreenElement instanceof HTMLElement && !(document.fullscreenElement instanceof HTMLVideoElement)) {
    return document.fullscreenElement;
  }
  const videoCanvas = document.querySelector<HTMLElement>('[data-uia="video-canvas"]');
  return videoCanvas ?? document.body;
}

function ensureBottomStack(host: HTMLElement): HTMLDivElement {
  if (bottomStack === undefined) {
    bottomStack = document.createElement('div');
    bottomStack.className = 'netflix-dual-sub-stack';
    bottomStack.dataset.netflixDualSubStack = 'true';
  }
  if (bottomStack.parentElement !== host) {
    host.append(bottomStack);
  }
  bottomStack.hidden = false;
  return bottomStack;
}

function applyOverlaySettings(): void {
  syncOverlayHost();
  const base = subtitleSettings.secondaryBottomVh;
  if (overlay !== undefined) {
    applyTextOverlaySettings(
      overlay,
      subtitleSettings.secondarySubtitlePlacement === 'top'
        ? { edge: 'top', vh: base }
        : { edge: 'bottom', vh: base },
      subtitleSettings.secondaryTextScale,
    );
  }
  if (primaryOverlay !== undefined) {
    applyTextOverlaySettings(
      primaryOverlay,
      { edge: 'bottom', vh: base },
      subtitleSettings.secondaryTextScale * PRIMARY_SUBTITLE_SCALE_MULTIPLIER,
    );
  }
  if (bottomStack !== undefined) {
    bottomStack.style.bottom = `clamp(72px, ${base.toFixed(1)}vh, 260px)`;
    bottomStack.hidden = !shouldStackLowerSubtitles();
  }
}

function applyTextOverlaySettings(
  element: HTMLElement,
  position: { edge: 'top' | 'bottom'; vh: number },
  textScale: number,
): void {
  element.style.color = subtitleSettings.secondaryTextColor;
  element.style.opacity = subtitleSettings.secondaryTextOpacity.toFixed(2);
  element.style.fontFamily = subtitleFontFamilyCss(subtitleSettings.subtitleFontFamily);
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

function shouldStackLowerSubtitles(): boolean {
  return (
    shouldUsePluginPrimary(subtitleSettings.primarySubtitleMode, primaryTrackId, primaryCues) &&
    selectedTrackId !== null &&
    subtitleSettings.secondarySubtitlePlacement === 'bottom'
  );
}

function updateNativeCaptionVisibility(): void {
  document.documentElement.dataset.netflixDualSubPrimaryMode =
    shouldUsePluginPrimary(subtitleSettings.primarySubtitleMode, primaryTrackId, primaryCues)
      ? 'plugin'
      : 'native';
}

function activeVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  const scored = videos.map((video) => {
    const rect = video.getBoundingClientRect();
    const visibleArea = Math.max(0, rect.width) * Math.max(0, rect.height);
    return { video, score: visibleArea * 10 + (video.paused ? 0 : 1) };
  });
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.video ?? null;
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
  const element = ensureDebugSnapshotElement();
  if (element === undefined) {
    return;
  }
  const video = activeVideo();
  const time = video?.currentTime ?? null;
  element.textContent = JSON.stringify({
    version: 1,
    href: window.location.href,
    updatedAt: new Date().toISOString(),
    mediaId: activeMediaId,
    video: video === null
      ? null
      : {
          currentTime: roundTime(video.currentTime),
          duration: Number.isFinite(video.duration) ? roundTime(video.duration) : null,
          muted: video.muted,
          paused: video.paused,
          readyState: video.readyState,
        },
    nativeSubtitleText: nativeSubtitleText(),
    primarySubtitleMode: subtitleSettings.primarySubtitleMode,
    secondarySubtitlePlacement: subtitleSettings.secondarySubtitlePlacement,
    subtitleFontFamily: subtitleSettings.subtitleFontFamily,
    currentNativeTrackId,
    primaryTrackId,
    primaryCueCount: primaryCues.length,
    activePrimaryCues: time === null ? [] : findCuesAt(time, primaryCues).map(debugCue),
    primaryOverlayText: primaryOverlay?.textContent ?? '',
    selectedTrackId,
    cueCount: cues.length,
    activeCues: time === null ? [] : findCuesAt(time, cues).map(debugCue),
    secondaryOverlayText: overlay?.textContent ?? '',
    tracks,
  });
}

function ensureDebugSnapshotElement(): HTMLScriptElement | undefined {
  if (debugSnapshotElement?.isConnected) {
    return debugSnapshotElement;
  }
  const existing = document.getElementById(DEBUG_SNAPSHOT_ID);
  if (existing instanceof HTMLScriptElement) {
    debugSnapshotElement = existing;
    return existing;
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

function nativeSubtitleText(): string {
  return Array.from(document.querySelectorAll<HTMLElement>('.player-timedtext-text-container'))
    .filter((element) => element.closest('[data-netflix-dual-sub-overlay]') === null && isElementVisible(element))
    .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((text, index, texts) => texts.indexOf(text) === index)
    .join('\n');
}

function debugCue(cue: NetflixSubtitleCue): NetflixSubtitleCue {
  return { start: roundTime(cue.start), end: roundTime(cue.end), text: cue.text };
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
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

function sendToPage(message: NetflixContentToPageMessage): void {
  window.postMessage(message, '*');
}

function isPageToContentMessage(value: unknown): value is NetflixPageToContentMessage {
  if (!isRecord(value) || value.source !== NETFLIX_MESSAGE_SOURCE || value.direction !== 'page-to-content') {
    return false;
  }
  if (value.type === 'tracks') {
    return (
      (value.mediaId === null || typeof value.mediaId === 'string') &&
      (value.currentTrackId === null || typeof value.currentTrackId === 'string') &&
      Array.isArray(value.tracks) &&
      value.tracks.every(isNetflixSubtitleTrack)
    );
  }
  if (value.type === 'cues') {
    return (
      typeof value.mediaId === 'string' &&
      typeof value.trackId === 'string' &&
      (value.slot === 'primary' || value.slot === 'secondary') &&
      Array.isArray(value.cues) &&
      value.cues.every(isNetflixSubtitleCue)
    );
  }
  return (
    value.type === 'error' &&
    (value.mediaId === null || typeof value.mediaId === 'string') &&
    typeof value.message === 'string'
  );
}

function isNetflixSubtitleTrack(value: unknown): value is NetflixSubtitleTrack {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.language === 'string' &&
    (value.kind === 'subtitles' || value.kind === 'captions' || value.kind === 'forced')
  );
}

function isNetflixSubtitleCue(value: unknown): value is NetflixSubtitleCue {
  return (
    isRecord(value) &&
    typeof value.start === 'number' &&
    Number.isFinite(value.start) &&
    typeof value.end === 'number' &&
    Number.isFinite(value.end) &&
    value.end > value.start &&
    typeof value.text === 'string'
  );
}

function sanitizeStoredSelection(value: unknown): StoredNetflixSelection {
  if (!isRecord(value)) {
    return { trackId: null, language: null, kind: null };
  }
  const kind = value.kind === 'subtitles' || value.kind === 'captions' || value.kind === 'forced'
    ? value.kind
    : null;
  return {
    trackId: typeof value.trackId === 'string' ? value.trackId : null,
    language: typeof value.language === 'string' ? value.language : null,
    kind,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAvailabilityRequest(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.source === NETFLIX_MESSAGE_SOURCE &&
    value.direction === 'extension-to-content' &&
    value.type === 'get-availability'
  );
}

function isSecondarySelectionRequest(value: unknown): value is { trackId: string | null } {
  return (
    isRecord(value) &&
    value.source === NETFLIX_MESSAGE_SOURCE &&
    value.direction === 'extension-to-content' &&
    value.type === 'select-secondary' &&
    (value.trackId === null || typeof value.trackId === 'string')
  );
}

function onDocumentReady(callback: () => void): void {
  if (document.body !== null) {
    callback();
  } else {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  }
}
