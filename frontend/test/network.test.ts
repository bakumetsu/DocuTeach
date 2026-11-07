import { test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const INDEX_HTML = resolve(process.cwd(), 'index.html');
const SRC_DIR = resolve(process.cwd(), 'src');

const ALLOWED_PREFIXES = [
  'http://localhost',
  'http://127.0.0.1',
  'ws://localhost',
  'http://www.w3.org/',
];

const ALLOWED_EXT = new Set(['.ts', '.tsx', '.css', '.html']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (stat.isFile()) {
      out.push(full);
    }
  }
  return out;
}

test('index.html has a CSP meta tag with required directives', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');

  const metaTag =
    html.match(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0];
  expect(metaTag).toBeDefined();

  const content =
    metaTag!.match(/content="([^"]*)"/i)?.[1] ??
    metaTag!.match(/content='([^']*)'/i)?.[1] ??
    '';

  expect(content).toContain("default-src 'self'");
  expect(content).toContain("connect-src 'self' http://localhost:*");
  expect(content).toContain("font-src 'self'");
});

test('no disallowed network URLs in source files or index.html', () => {
  const files = walk(SRC_DIR).filter((f) => ALLOWED_EXT.has(extname(f)));
  files.push(INDEX_HTML);

  const URL_RE = /https?:\/\/[^\s'"`)>]+/g;
  const disallowed: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(URL_RE) ?? [];
    for (const url of matches) {
      if (!ALLOWED_PREFIXES.some((p) => url.startsWith(p))) {
        disallowed.push(url);
      }
    }
  }

  expect(disallowed).toEqual([]);
});
