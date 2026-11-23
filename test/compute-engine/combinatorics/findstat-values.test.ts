// Our value equals FindStat's, on every object of the fixture.

import { ComputeEngine } from '../../../src/compute-engine';
import {
  loadCombinatorics,
  COMBINATORICS_AREAS,
} from '../../../src/compute-engine/combinatorics/loader';
import { partitionsOf, permutationsOf, readData } from './data';
import { SLOW, SLOW_SIZE } from './slow';

const ce = new ComputeEngine();
loadCombinatorics(ce);

// Each call runs the Epsil definition (milliseconds, seconds for a few), so the
// standard run takes the small objects; `generate.ts --values` and the nightly
// (CE_NIGHTLY=1) take every one of the fixture.
const NIGHTLY = process.env.CE_NIGHTLY === '1';
const SIZE = { permutations: 4, partitions: 5 };
const N_SIZE = { permutations: 2, partitions: 3 };

const parseObject = (key: string): number[] =>
  key === '[]' ? [] : key.slice(1, -1).split(',').map(Number);

type Fixture = {
  collection: string;
  through: number;
  values: Record<string, number>;
};

test('the slow list names declared statistics', () => {
  const heads = COMBINATORICS_AREAS.flatMap((a) =>
    a.statistics.filter((s) => s.findstat).map((s) => s.head)
  );
  expect([...SLOW].filter((h) => !heads.includes(h))).toEqual([]);
});

for (const area of COMBINATORICS_AREAS)
  for (const statistic of area.statistics.filter((s) => s.findstat)) {
    describe(`${statistic.head} is FindStat ${statistic.findstat}`, () => {
      const fixture = readData<Fixture>(
        `findstat/values/${statistic.findstat}.json`
      );

      test(`FindStat's collection is ${area.domain.collection}`, () => {
        expect(fixture.collection).toBe(area.domain.collection);
      });

      test(`the fixture holds objects of the area up to size ${fixture.through}, once each`, () => {
        // FindStat's table can leave a few objects out; every key is a member.
        const members = new Set<string>();
        for (let n = 0; n <= fixture.through; n++)
          for (const element of area.name === 'permutations'
            ? permutationsOf(n)
            : partitionsOf(n))
            members.add(`[${element.join(',')}]`);
        const keys = Object.keys(fixture.values);
        expect(keys.filter((key) => !members.has(key))).toEqual([]);
        expect(keys.length).toBeGreaterThan(members.size * 0.8);
        // A permutation statistic holds every permutation of two or more points.
        if (area.name === 'permutations')
          expect(
            [...members].filter(
              (m) => m.includes(',') && !(m in fixture.values)
            )
          ).toEqual([]);
      });

      test(`equal on every object of the standard sizes (all of the fixture nightly), by evaluate() and .N()`, () => {
        const limit = SLOW.has(statistic.head) ? SLOW_SIZE : undefined;
        const wrong: string[] = [];
        for (const [key, value] of Object.entries(fixture.values)) {
          const object = parseObject(key);
          // The size of a permutation is its length, of a partition its sum.
          const size =
            area.name === 'permutations'
              ? object.length
              : object.reduce((a, b) => a + b, 0);
          const call = ce.box([statistic.head, ['List', ...object]]);
          if (
            ((NIGHTLY || size <= (limit ?? SIZE[area.name])) &&
              call.evaluate().json !== value) ||
            ((NIGHTLY || size <= N_SIZE[area.name]) && call.N().json !== value)
          )
            wrong.push(key);
        }
        expect(wrong).toEqual([]);
      });
    });
  }
