// The library runs the precompiled MathJSON; it is the parse of the Epsil text
// in the source tables, which the runtime never imports.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { compileEpsil } from '../../../scripts/combinatorics/epsil';
import { COMPILED } from '../../../src/compute-engine/combinatorics/compiled';
import { KERNELS } from '../../../src/compute-engine/combinatorics/kernels';
import { PARTITION_SOURCES } from '../../../src/compute-engine/combinatorics/sources/partitions';
import { PERMUTATION_SOURCES } from '../../../src/compute-engine/combinatorics/sources/permutations';

const SOURCES = {
  permutations: PERMUTATION_SOURCES,
  partitions: PARTITION_SOURCES,
};

for (const [area, sources] of Object.entries(SOURCES)) {
  describe(area, () => {
    test('every row is compiled, in order, with its FindStat identifier', () => {
      expect(
        COMPILED[area as keyof typeof COMPILED].map(([h, f]) => [h, f])
      ).toEqual(sources.map((s) => [s.head, s.findstat ?? null]));
    });

    test.each(sources.map((s, i) => [s.head, s.epsil, i] as const))(
      '%s: the compiled definition is its Epsil text',
      (_head, epsil, i) => {
        expect(COMPILED[area as keyof typeof COMPILED][i][2]).toEqual(
          compileEpsil(epsil)
        );
      }
    );
  });
}

test('a head is in one area, and every kernel has a row', () => {
  const heads = Object.values(COMPILED).flatMap((rows) =>
    rows.map(([head]) => head)
  );
  expect(new Set(heads).size).toBe(heads.length);
  expect(Object.keys(KERNELS).filter((h) => !heads.includes(h))).toEqual([]);
});

test('the runtime does not import the Epsil source tables', () => {
  const dir = resolve(__dirname, '../../../src');
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]
    );
  const importers = files(dir)
    .filter((f) => f.endsWith('.ts') && !f.includes('/combinatorics/sources/'))
    .filter((f) =>
      /from '[^']*combinatorics\/sources\/|from '\.\/sources\//.test(
        readFileSync(f, 'utf8')
      )
    );
  expect(importers).toEqual([]);
});
