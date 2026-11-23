import { ComputeEngine } from '../../../src/compute-engine';
import { statisticHandler } from '../../../src/compute-engine/combinatorics/definition';
import { COMBINATORICS_AREAS } from '../../../src/compute-engine/combinatorics/loader';
import { partitionsOf, permutationsOf } from '../combinatorics/data';

/**
 * NIGHTLY — combinatorics statistics, beyond the unit tests.
 *
 *   1. The Epsil definition equals the kernel on every permutation of 1..7 and
 *      every partition of n <= 25.
 *   2. MajorIndex is Mahonian: its distribution over S_n has the generating
 *      function [1]_q [2]_q ... [n]_q (an independent check of the value, not of
 *      the agreement of two implementations).
 */

const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;

describeNightly('combinatorics sweeps', () => {
  const ce = new ComputeEngine();

  for (const area of COMBINATORICS_AREAS)
    for (const statistic of area.statistics.filter((s) => s.fast))
      test(`${statistic.head}: definition equals kernel`, () => {
        const byDefinition = statisticHandler(
          ce,
          area.domain,
          statistic,
          false
        );
        const elements: number[][] =
          area.name === 'permutations'
            ? permutationsOf(7)
            : Array.from({ length: 26 }, (_, n) => partitionsOf(n)).flat();
        const wrong: string[] = [];
        for (const element of elements) {
          const list = ce.function(
            'List',
            element.map((v) => ce.number(v))
          );
          if (byDefinition([list])?.json !== statistic.fast!(element))
            wrong.push(`${element}`);
        }
        expect(wrong).toEqual([]);
      });

  test('MajorIndex is Mahonian on S_1 .. S_8', () => {
    const maj = COMBINATORICS_AREAS[0].statistics.find(
      (s) => s.head === 'MajorIndex'
    )!.fast!;
    for (let n = 1; n <= 8; n++) {
      let product = [1];
      for (let k = 1; k <= n; k++) {
        const next = new Array(product.length + k - 1).fill(0);
        product.forEach((c, i) => {
          for (let j = 0; j < k; j++) next[i + j] += c;
        });
        product = next;
      }
      const counts = new Array(product.length).fill(0);
      for (const p of permutationsOf(n)) counts[maj(p)]++;
      expect(counts).toEqual(product);
    }
  });
});
