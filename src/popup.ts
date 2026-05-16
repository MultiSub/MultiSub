import {
  DEFAULT_SUBTITLE_SETTINGS,
  SETTINGS_STORAGE_KEY,
  sanitizeSubtitleSettings,
  type PrimarySubtitleMode,
  type SecondarySubtitlePlacement,
  type SubtitleSettings,
} from './settings';

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

document.addEventListener('DOMContentLoaded', () => {
  void initializePopup();
});

async function initializePopup(): Promise<void> {
  settings = await loadSettings();
  bindControls();
  renderSettings();
}

function bindControls(): void {
  for (const key of numericSettingKeys) {
    const input = settingInput(key);
    input.addEventListener('input', () => {
      settings = sanitizeSubtitleSettings({ ...settings, [key]: Number(input.value) });
      renderSettings();
      void saveSettings();
    });
  }

  colorInput().addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    settings = sanitizeSubtitleSettings({ ...settings, secondaryTextColor: input.value });
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

async function loadSettings(): Promise<SubtitleSettings> {
  const items = await chrome.storage.local.get([SETTINGS_STORAGE_KEY]);
  return sanitizeSubtitleSettings(items[SETTINGS_STORAGE_KEY]);
}

async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}

function settingInput(key: NumericSettingKey): HTMLInputElement {
  const input = document.getElementById(key);
  if (input instanceof HTMLInputElement) {
    return input;
  }
  throw new Error(`Missing popup input: ${key}`);
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
      return `${Math.round(value * 100)}%`;
    case 'secondaryTextOpacity':
      return `${Math.round(value * 100)}%`;
    case 'secondaryBottomVh':
      return positionLabel(value);
    case 'secondaryTextStroke':
      return outlineLabel(value);
  }
}

function positionLabel(value: number): string {
  if (value <= 9) {
    return 'Lower';
  }
  if (value >= 18) {
    return 'Higher';
  }
  return 'Comfortable';
}

function outlineLabel(value: number): string {
  if (value <= 0.5) {
    return 'Soft';
  }
  if (value >= 3) {
    return 'Bold';
  }
  return 'Balanced';
}
