import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// index.css removes Tailwind's default palette (`--color-*: initial`), so a class such as
// `bg-black/55` compiles to nothing and fails silently: the dialog scrim did.
const DEFAULT_COLOR =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|placeholder)-(?:black|white|gray|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b/;

describe('design tokens', () => {
  it('no screen uses a Tailwind default color, which the theme removes', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => DEFAULT_COLOR.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('lime is the money color in both themes, and only money buttons use it', () => {
    const css = readFileSync(join(SRC, 'styles', 'index.css'), 'utf8');
    expect(css.match(/--color-money: #c6f03a;/g)).toHaveLength(3);
    // Nothing else in the theme is lime: the accent scale is grey-to-ink.
    expect(css.match(/#c6f03a/g)).toHaveLength(3);
    const users = sourceFiles(SRC)
      .filter((file) => /bg-money\b|variant="money"/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1).replaceAll('\\', '/'))
      .sort();
    expect(users).toEqual([
      'components/ui/button.tsx',
      'features/drawer/CountDrawerPage.tsx',
      'features/drawer/OpenDrawerForm.tsx',
      'features/sales/PaymentSheet.tsx',
      'features/sales/SellPage.tsx',
    ]);
  });

  it('the scrim and the dialog edge are tokens, and dark mode draws the edge', () => {
    const css = readFileSync(join(SRC, 'styles', 'index.css'), 'utf8');
    expect(css).toMatch(/--color-scrim: rgb\(0 0 0 \/ 0\.55\);/);
    expect(css.match(/--color-overlay-edge: rgba\(/g)).toHaveLength(2);
  });
});
