import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_SWITCHES, cacheOff } from '../../src/common/cache-switches';

// The environment variable `CE_CACHE_OFF` turns off the caches it names
// (`src/common/cache-switches.ts`). A switch name that no cache reads would
// make a timing run measure nothing for that name without any message, so
// each name in `CACHE_SWITCHES` must be read by at least one `cacheOff()`
// call in the source, and each `cacheOff()` call must name a listed switch.

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function switchReads(): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  const root = join(__dirname, '../../src');
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bcacheOff\(\s*'([^']*)'\s*\)/g)) {
      const files = reads.get(m[1]) ?? [];
      files.push(file.slice(root.length + 1));
      reads.set(m[1], files);
    }
  }
  return reads;
}

describe('CACHE OFF SWITCHES', () => {
  const reads = switchReads();

  test.each([...CACHE_SWITCHES])('the switch %s is read by a cache', (name) => {
    expect(reads.get(name)?.length ?? 0).toBeGreaterThan(0);
  });

  test('every cacheOff() call names a listed switch', () => {
    const listed = new Set<string>(CACHE_SWITCHES);
    expect([...reads.keys()].filter((name) => !listed.has(name))).toEqual([]);
  });

  test('every cache is on when CE_CACHE_OFF is not set', () => {
    // The test runner does not set the variable.
    expect(process.env.CE_CACHE_OFF ?? '').toBe('');
    for (const name of CACHE_SWITCHES) expect(cacheOff(name)).toBe(false);
  });

  test('CE_CACHE_OFF is read when the module loads', () => {
    const saved = process.env.CE_CACHE_OFF;
    try {
      process.env.CE_CACHE_OFF = 'type, sgn';
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('../../src/common/cache-switches');
        expect(m.cacheOff('type')).toBe(true);
        expect(m.cacheOff('sgn')).toBe(true);
        expect(m.cacheOff('shared')).toBe(false);
      });
      process.env.CE_CACHE_OFF = 'all';
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('../../src/common/cache-switches');
        for (const name of CACHE_SWITCHES) expect(m.cacheOff(name)).toBe(true);
      });
    } finally {
      if (saved === undefined) delete process.env.CE_CACHE_OFF;
      else process.env.CE_CACHE_OFF = saved;
    }
  });
});
