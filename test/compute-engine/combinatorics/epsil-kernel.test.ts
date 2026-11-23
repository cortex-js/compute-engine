// The Epsil definition is the meaning; a TypeScript kernel is a fast path. They
// agree on every element up to n = 5 (6 nightly; the nightly sweep goes further).

import { ComputeEngine } from '../../../src/compute-engine';
import { statisticHandler } from '../../../src/compute-engine/combinatorics/definition';
import { COMBINATORICS_AREAS } from '../../../src/compute-engine/combinatorics/loader';
import { partitionsOf, permutationsOf } from './data';

const ce = new ComputeEngine();
const N = process.env.CE_NIGHTLY === '1' ? 6 : 5;

const elements = (area: string, n: number) =>
  area === 'permutations' ? permutationsOf(n) : partitionsOf(n);

// Only the statistics that carry a kernel; the others are the definition alone.
for (const area of COMBINATORICS_AREAS)
  for (const statistic of area.statistics.filter((s) => s.fast)) {
    describe(`${statistic.head}`, () => {
      test(`the Epsil definition and the kernel agree on every element up to n = ${N}`, () => {
        const byDefinition = statisticHandler(
          ce,
          area.domain,
          statistic,
          false
        );
        let count = 0;
        const wrong: string[] = [];
        for (let n = 0; n <= N; n++)
          for (const element of elements(area.name, n)) {
            count++;
            const list = ce.function(
              'List',
              element.map((v) => ce.number(v))
            );
            const definition = byDefinition([list])?.json;
            if (definition !== statistic.fast!(element))
              wrong.push(`${element}: ${definition}`);
          }
        expect(wrong).toEqual([]);
        expect(count).toBeGreaterThan(0);
      });

      test('the declared head returns the kernel value', () => {
        const byKernel = statisticHandler(ce, area.domain, statistic);
        const element = elements(area.name, 4)[3];
        const list = ce.function(
          'List',
          element.map((v) => ce.number(v))
        );
        expect(byKernel([list])?.json).toBe(statistic.fast!(element));
      });
    });
  }
