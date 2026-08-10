import {
  DEFAULT_SUBTITLE_SETTINGS,
  NETFLIX_SELECTION_STORAGE_KEY,
  NETFLIX_SETTINGS_STORAGE_KEY,
  sanitizeSubtitleSettings,
  type PrimarySubtitleMode,
  type SecondarySubtitlePlacement,
  type SubtitleSettings,
} from './settings';
import {
  NETFLIX_MESSAGE_SOURCE,
  type NetflixSubtitleKind,
  type NetflixSubtitleTrack,
} from './messages';
import type { NetflixAvailabilityState, StoredNetflixSelection } from './track-model';

type NumericSettingKey =
  | 'secondaryTextScale'
  | 'secondaryTextStroke'
  | 'secondaryTextOpacity'
  | 'secondaryBottomVh';

const numericSettingKeys: NumericSettingKey[] = [
  'secondaryTextScale',
  'secondaryTextStroke',
  'secondaryTextOpacity',
  'secondaryBottomVh',
];

let settings: SubtitleSettings = DEFAULT_SUBTITLE_SETTINGS;
let availability: NetflixAvailabilityState = {
  mediaId: null,
  currentTrackId: null,
  selectedTrackId: null,
  tracks: [],
};
let selection: StoredNetflixSelection = { trackId: null, language: null, kind: null };
let availabilityRefreshVersion = 0;

document.addEventListener('DOMContentLoaded', () => {
  void initializePopup();
});

async function initializePopup(): Promise<void> {
  const items = await chrome.storage.local.get([
    NETFLIX_SETTINGS_STORAGE_KEY,
    NETFLIX_SELECTION_STORAGE_KEY,
  ]);
  settings = sanitizeSubtitleSettings(items[NETFLIX_SETTINGS_STORAGE_KEY]);
  selection = sanitizeSelection(items[NETFLIX_SELECTION_STORAGE_KEY]);
  bindControls();
  installStorageListener();
  renderSettings();
  renderTrackSelector();
  await refreshAvailability();
  window.setInterval(() => void refreshAvailability(), 1_000);
}

function bindControls(): void {
  trackSelect().addEventListener('change', () => {
    const track = availability.tracks.find((candidate) => candidate.id === trackSelect().value);
    selection = {
      trackId: track?.id ?? null,
      language: track?.language ?? null,
      kind: track?.kind ?? null,
    };
    availability = { ...availability, selectedTrackId: selection.trackId };
    renderTrackSelector();
    void selectTrackInActiveTab(selection.trackId);
    void chrome.storage.local.set({ [NETFLIX_SELECTION_STORAGE_KEY]: selection });
  });

  for (const key of numericSettingKeys) {
    const input = settingInput(key);
    input.addEventListener('input', () => {
      settings = sanitizeSubtitleSettings({ ...settings, [key]: Number(input.value) });
      renderSettings();
      void saveSettings();
    });
  }

  colorInput().addEventListener('input', (event) => {
    settings = sanitizeSubtitleSettings({
      ...settings,
      secondaryTextColor: (event.currentTarget as HTMLInputElement).value,
    });
    renderSettings();
    void saveSettings();
  });

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-color]'))) {
    button.addEventListener('click', () => {
      settings = sanitizeSubtitleSettings({ ...settings, secondaryTextColor: button.dataset.color });
      renderSettings();
      void saveSettings();
    });
  }

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-primary-mode]'))) {
    button.addEventListener('click', () => {
      settings = sanitizeSubtitleSettings({
        ...settings,
        primarySubtitleMode: button.dataset.primaryMode as PrimarySubtitleMode,
      });
      renderSettings();
      void saveSettings();
    });
  }

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-secondary-placement]'))) {
    button.addEventListener('click', () => {
      settings = sanitizeSubtitleSettings({
        ...settings,
        secondarySubtitlePlacement: button.dataset.secondaryPlacement as SecondarySubtitlePlacement,
      });
      renderSettings();
      void saveSettings();
    });
  }

  resetButton().addEventListener('click', () => {
    settings = DEFAULT_SUBTITLE_SETTINGS;
    renderSettings();
    void saveSettings();
  });
}

function installStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (changes[NETFLIX_SETTINGS_STORAGE_KEY] !== undefined) {
      settings = sanitizeSubtitleSettings(changes[NETFLIX_SETTINGS_STORAGE_KEY].newValue);
      renderSettings();
    }
    if (changes[NETFLIX_SELECTION_STORAGE_KEY] !== undefined) {
      selection = sanitizeSelection(changes[NETFLIX_SELECTION_STORAGE_KEY].newValue);
      renderTrackSelector();
    }
  });
}

async function refreshAvailability(): Promise<void> {
  const version = ++availabilityRefreshVersion;
  let nextAvailability: NetflixAvailabilityState = {
    mediaId: null,
    currentTrackId: null,
    selectedTrackId: null,
    tracks: [],
  };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      const response: unknown = await chrome.tabs.sendMessage(tab.id, {
        source: NETFLIX_MESSAGE_SOURCE,
        direction: 'extension-to-content',
        type: 'get-availability',
      });
      const record = asRecord(response);
      if (
        record?.source === NETFLIX_MESSAGE_SOURCE &&
        record.direction === 'content-to-extension' &&
        record.type === 'availability'
      ) {
        nextAvailability = sanitizeAvailability(record.availability);
      }
    }
  } catch {
    // The active tab is not a Netflix playback page or its content script has not started yet.
  }

  if (version !== availabilityRefreshVersion) {
    return;
  }
  availability = nextAvailability;
  renderTrackSelector();
}

async function selectTrackInActiveTab(trackId: string | null): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      return;
    }
    await chrome.tabs.sendMessage(tab.id, {
      source: NETFLIX_MESSAGE_SOURCE,
      direction: 'extension-to-content',
      type: 'select-secondary',
      trackId,
    });
  } catch {
    // The active tab changed or is not running the Netflix content script.
  }
}

function renderTrackSelector(): void {
  const select = trackSelect();
  const off = document.createElement('option');
  off.value = '';
  off.textContent = 'Off';
  const options = availability.tracks.map((track) => {
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = track.label;
    return option;
  });
  select.replaceChildren(off, ...options);
  const selectedId = availability.selectedTrackId ?? selection.trackId;
  select.value = selectedId !== null && availability.tracks.some((track) => track.id === selectedId)
    ? selectedId
    : '';
  select.disabled = availability.tracks.length === 0;

  const hint = document.querySelector<HTMLElement>('.track-hint');
  if (hint !== null) {
    hint.textContent = availability.tracks.length === 0
      ? 'Open a Netflix video to discover the tracks available for that title.'
      : `${availability.tracks.length} official text tracks are available for this title.`;
  }
}

function renderSettings(): void {
  for (const key of numericSettingKeys) {
    const input = settingInput(key);
    input.value = String(settings[key]);
    const output = document.querySelector<HTMLOutputElement>(`[data-value-for="${key}"]`);
    if (output !== null) {
      output.value = formatSettingValue(key, settings[key]);
    }
  }
  colorInput().value = settings.secondaryTextColor;
  renderPreview();

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-primary-mode]'))) {
    button.setAttribute('aria-checked', String(button.dataset.primaryMode === settings.primarySubtitleMode));
  }
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-secondary-placement]'))) {
    button.setAttribute(
      'aria-checked',
      String(button.dataset.secondaryPlacement === settings.secondarySubtitlePlacement),
    );
  }
}

function renderPreview(): void {
  const preview = document.querySelector<HTMLElement>('[data-preview]');
  if (preview === null) {
    return;
  }
  preview.style.color = settings.secondaryTextColor;
  preview.style.opacity = settings.secondaryTextOpacity.toFixed(2);
  preview.style.fontSize = `${Math.round(18 * settings.secondaryTextScale)}px`;
  preview.style.webkitTextStrokeWidth = `${settings.secondaryTextStroke.toFixed(2)}px`;
}

async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ [NETFLIX_SETTINGS_STORAGE_KEY]: settings });
}

function sanitizeSelection(value: unknown): StoredNetflixSelection {
  const record = asRecord(value);
  return {
    trackId: typeof record?.trackId === 'string' ? record.trackId : null,
    language: typeof record?.language === 'string' ? record.language : null,
    kind: subtitleKind(record?.kind),
  };
}

function sanitizeAvailability(value: unknown): NetflixAvailabilityState {
  const record = asRecord(value);
  const rawTracks = Array.isArray(record?.tracks) ? record.tracks : [];
  return {
    mediaId: typeof record?.mediaId === 'string' ? record.mediaId : null,
    currentTrackId: typeof record?.currentTrackId === 'string' ? record.currentTrackId : null,
    selectedTrackId: typeof record?.selectedTrackId === 'string' ? record.selectedTrackId : null,
    tracks: rawTracks.map(sanitizeTrack).filter((track): track is NetflixSubtitleTrack => track !== undefined),
  };
}

function sanitizeTrack(value: unknown): NetflixSubtitleTrack | undefined {
  const record = asRecord(value);
  const kind = subtitleKind(record?.kind);
  if (
    record === undefined ||
    typeof record.id !== 'string' ||
    typeof record.label !== 'string' ||
    typeof record.language !== 'string' ||
    kind === null
  ) {
    return undefined;
  }
  return { id: record.id, label: record.label, language: record.language, kind };
}

function subtitleKind(value: unknown): NetflixSubtitleKind | null {
  return value === 'subtitles' || value === 'captions' || value === 'forced' ? value : null;
}

function settingInput(key: NumericSettingKey): HTMLInputElement {
  const input = document.getElementById(key);
  if (input instanceof HTMLInputElement) {
    return input;
  }
  throw new Error(`Missing popup input: ${key}`);
}

function trackSelect(): HTMLSelectElement {
  const select = document.getElementById('secondaryTrack');
  if (select instanceof HTMLSelectElement) {
    return select;
  }
  throw new Error('Missing secondary track selector');
}

function colorInput(): HTMLInputElement {
  const input = document.getElementById('secondaryTextColor');
  if (input instanceof HTMLInputElement) {
    return input;
  }
  throw new Error('Missing popup color input');
}

function resetButton(): HTMLButtonElement {
  const button = document.getElementById('resetSettings');
  if (button instanceof HTMLButtonElement) {
    return button;
  }
  throw new Error('Missing popup reset button');
}

function formatSettingValue(key: NumericSettingKey, value: number): string {
  switch (key) {
    case 'secondaryTextScale':
    case 'secondaryTextOpacity':
      return `${Math.round(value * 100)}%`;
    case 'secondaryBottomVh':
      return value <= 9 ? 'Lower' : value >= 18 ? 'Higher' : 'Comfortable';
    case 'secondaryTextStroke':
      return value <= 0.5 ? 'Soft' : value >= 3 ? 'Bold' : 'Balanced';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}
