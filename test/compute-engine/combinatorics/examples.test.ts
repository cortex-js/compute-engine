// Runs every row of data/combinatorics/examples through evaluate(). Each call
// runs the Epsil definition, so the standard run takes the other routes (.N(),
// the Epsil route) on the first row of each head, and
// leaves out the rows of a slow statistic (`slow.ts`) beyond size 3; the
// nightly (CE_NIGHTLY=1) takes every row on every route. The compiled route
// is tested once per area: a statistic compiles as a call to its interpreted
// definition.
const NIGHTLY = process.env.CE_NIGHTLY === '1';

import { ComputeEngine } from '../../../src/compute-engine';
import { compile } from '../../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../../src/epsil/execute-epsil';
import { loadCombinatorics } from '../../../src/combinatorics';
import { type ExampleRow, readData } from './data';
import { SLOW, SLOW_SIZE } from './slow';

const ce = new ComputeEngine();
loadCombinatorics(ce);

for (const area of ['permutations', 'partitions']) {
  const { entries } = readData<{ entries: ExampleRow[] }>(
    `examples/${area}.json`
  );
  describe(`${area} examples`, () => {
    const heads = new Set<string>();
    let compileTested = false;
    for (const row of entries) {
      const elements = (row.input as [string, ...unknown[][]])[1].slice(
        1
      ) as number[];
      const size =
        area === 'permutations'
          ? elements.length
          : elements.reduce((a, b) => a + b, 0);
      if (!NIGHTLY && SLOW.has(row.head) && size > SLOW_SIZE) continue;
      const allRoutes = NIGHTLY || !heads.has(row.head);
      heads.add(row.head);
      const shown = JSON.stringify(row.input);
      if (row.unevaluated) {
        test(`${shown} stays unevaluated (${row.id})`, () => {
          expect(ce.box(row.input).evaluate().json).toEqual(row.input);
          if (allRoutes) expect(ce.box(row.input).N().json).toEqual(row.input);
        });
        continue;
      }
      test(`${shown} = ${row.expected} (${row.id})`, () => {
        expect(ce.box(row.input).evaluate().json).toEqual(row.expected);
        if (allRoutes) expect(ce.box(row.input).N().json).toEqual(row.expected);
      });
      if (!allRoutes) continue;
      test(`${shown} = ${row.expected} by the Epsil route (${row.id})`, () => {
        const [head, list] = row.input as [string, unknown[]];
        const source = `${head}([${list.slice(1).join(', ')}])`;
        const result = executeEpsil(ce, source);
        expect(result.diagnostics).toEqual([]);
        expect(result.value.json).toEqual(row.expected);
      });
      // A statistic has no compiled body: the compiled code calls the
      // interpreted definition with the list.
      if (compileTested && !NIGHTLY) continue;
      compileTested = true;
      test(`${shown} = ${row.expected} compiled (${row.id})`, () => {
        const result = compile(ce.box(row.input), { fallback: false });
        expect(result.success).toBe(true);
        expect(result.run!()).toEqual(row.expected);
      });
    }
  });
}
