import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ContentScriptManifest {
  js?: string[];
  matches?: string[];
  world?: string;
}

interface ExtensionManifest {
  content_scripts?: ContentScriptManifest[];
  name?: string;
}

function readManifest(relativePath: string): ExtensionManifest {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as ExtensionManifest;
}

function readText(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('independent extension packaging', () => {
  const hbo = readManifest('../public/manifest.json');
  const netflix = readManifest('../netflix-public/manifest.json');

  it('keeps HBO and Netflix hosts in separate manifests', () => {
    const hboMatches = hbo.content_scripts?.flatMap((script) => script.matches ?? []) ?? [];
    const netflixMatches = netflix.content_scripts?.flatMap((script) => script.matches ?? []) ?? [];

    expect(hbo.name).toContain('HBO Max');
    expect(hboMatches).toEqual(['https://play.hbomax.com/*']);
    expect(hboMatches.some((match) => match.includes('netflix.com'))).toBe(false);

    expect(netflix.name).toContain('Netflix');
    expect(new Set(netflixMatches)).toEqual(new Set(['https://www.netflix.com/*']));
    expect(netflixMatches.some((match) => match.includes('hbomax.com'))).toBe(false);
  });

  it('runs only the Netflix page hook in the MAIN world', () => {
    expect(netflix.content_scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ js: ['page-hook.js'], world: 'MAIN' }),
        expect.objectContaining({ js: ['content.js'], world: 'ISOLATED' }),
      ]),
    );
  });

  it('offers the same font-family choices in both popups', () => {
    for (const popup of [readText('../public/popup.html'), readText('../netflix-public/popup.html')]) {
      expect(popup).toContain('data-font-family="sans-serif"');
      expect(popup).toContain('data-font-family="serif"');
    }
  });
});
