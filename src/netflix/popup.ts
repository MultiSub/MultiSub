import {
  DEFAULT_SUBTITLE_SETTINGS,
  NETFLIX_SETTINGS_STORAGE_KEY,
  isSubtitleFontFamily,
  sanitizeSubtitleSettings,
  subtitleFontFamilyCss,
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
  const items = await chrome.storage.local.get([NETFLIX_SETTINGS_STORAGE_KEY]);
  settings = sanitizeSubtitleSettings(items[NETFLIX_SETTINGS_STORAGE_KEY]);
  bindControls();
  installStorageListener();
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

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-font-family]'))) {
    button.addEventListener('click', () => {
      const fontFamily = button.dataset.fontFamily;
      if (!isSubtitleFontFamily(fontFamily)) {
        return;
      }
      settings = sanitizeSubtitleSettings({
        ...settings,
        subtitleFontFamily: fontFamily,
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

  bindSegmentedRadioKeyboard();
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
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-font-family]'))) {
    button.setAttribute('aria-checked', String(button.dataset.fontFamily === settings.subtitleFontFamily));
  }
  syncRadioTabStops();
}

function renderPreview(): void {
  const preview = document.querySelector<HTMLElement>('[data-preview]');
  if (preview === null) {
    return;
  }
  preview.style.color = settings.secondaryTextColor;
  preview.style.opacity = settings.secondaryTextOpacity.toFixed(2);
  preview.style.fontSize = `${Math.round(18 * settings.secondaryTextScale)}px`;
  preview.style.fontFamily = subtitleFontFamilyCss(settings.subtitleFontFamily);
  preview.style.webkitTextStrokeWidth = `${settings.secondaryTextStroke.toFixed(2)}px`;
}

function bindSegmentedRadioKeyboard(): void {
  for (const group of document.querySelectorAll<HTMLElement>('[role="radiogroup"]')) {
    group.addEventListener('keydown', (event) => {
      if (!(event.target instanceof HTMLButtonElement) || event.target.getAttribute('role') !== 'radio') {
        return;
      }

      const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
      const currentIndex = buttons.indexOf(event.target);
      if (currentIndex < 0 || buttons.length === 0) {
        return;
      }

      let nextIndex: number | undefined;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = buttons.length - 1;
      }

      if (nextIndex === undefined) {
        return;
      }
      event.preventDefault();
      const nextButton = buttons[nextIndex];
      nextButton.click();
      nextButton.focus();
    });
  }
}

function syncRadioTabStops(): void {
  for (const group of document.querySelectorAll<HTMLElement>('[role="radiogroup"]')) {
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
    const checkedButton = buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0];
    for (const button of buttons) {
      button.tabIndex = button === checkedButton ? 0 : -1;
    }
  }
}

async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ [NETFLIX_SETTINGS_STORAGE_KEY]: settings });
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
    case 'secondaryTextOpacity':
      return `${Math.round(value * 100)}%`;
    case 'secondaryBottomVh':
      return value <= 9 ? 'Lower' : value >= 18 ? 'Higher' : 'Comfortable';
    case 'secondaryTextStroke':
      return value <= 0.5 ? 'Soft' : value >= 3 ? 'Bold' : 'Balanced';
  }
}
