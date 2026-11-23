import { ComputeEngine } from '../../../src/compute-engine';
import { loadCombinatorics } from '../../../src/combinatorics';
import { COMBINATORICS_AREAS } from '../../../src/compute-engine/combinatorics/loader';
import { loadGroupTheory } from '../../../src/group-theory';

const partitionHeads = COMBINATORICS_AREAS.find(
  (a) => a.name === 'partitions'
)!.statistics.map((s) => s.head);

const evaluated = (ce: ComputeEngine, json: unknown) =>
  ce.box(json as never).evaluate().json;

describe('loadCombinatorics', () => {
  test('importing declares nothing', () => {
    const ce = new ComputeEngine();
    expect(ce.lookupDefinition('MajorIndex')).toBeUndefined();
    expect(ce.lookupDefinition('LargestPart')).toBeUndefined();
  });

  test('the report lists heads, types and no skips', () => {
    const ce = new ComputeEngine();
    const report = loadCombinatorics(ce);
    expect(report).toMatchObject({
      areas: ['permutations', 'partitions'],
      types: ['permutation', 'integer_partition'],
      skipped: [],
    });
    expect(report.heads).toEqual(
      expect.arrayContaining(['MajorIndex', ...partitionHeads])
    );
  });

  test('loading boxes no definition: that waits for the first call', () => {
    const ce = new ComputeEngine();
    const box = jest.spyOn(ce, 'box');
    loadCombinatorics(ce);
    const literals = () =>
      box.mock.calls.filter(
        ([x]) => Array.isArray(x) && (x as unknown[])[0] === 'Function'
      ).length;
    expect(literals()).toBe(0);
    expect(evaluated(ce, ['Inversions', ['List', 2, 1]])).toBe(1);
    expect(evaluated(ce, ['Inversions', ['List', 3, 1, 2]])).toBe(2);
    expect(literals()).toBeLessThanOrEqual(1);
  });

  test('areas selects what is declared', () => {
    const ce = new ComputeEngine();
    const report = loadCombinatorics(ce, { areas: ['partitions'] });
    expect(report.heads).toEqual(partitionHeads);
    expect(ce.lookupDefinition('MajorIndex')).toBeUndefined();
    // A later call adds the other area and keeps the first.
    expect(loadCombinatorics(ce).heads).toEqual(
      expect.arrayContaining(['MajorIndex', ...partitionHeads])
    );
  });

  test('is idempotent per engine and engines are independent', () => {
    const ce = new ComputeEngine();
    const first = loadCombinatorics(ce);
    const definition = ce.lookupDefinition('MajorIndex');
    expect(loadCombinatorics(ce)).toEqual(first);
    expect(ce.lookupDefinition('MajorIndex')).toBe(definition);
    expect(new ComputeEngine().lookupDefinition('MajorIndex')).toBeUndefined();
  });

  test('loads again after its definitions were removed', () => {
    const ce = new ComputeEngine();
    loadCombinatorics(ce);
    ce.undeclare(['MajorIndex']);
    expect(ce.lookupDefinition('MajorIndex')).toBeUndefined();
    expect(loadCombinatorics(ce).heads).toContain('MajorIndex');
    expect(evaluated(ce, ['MajorIndex', ['List', 2, 1]])).toBe(1);
  });

  test('a head the engine already defines is skipped and reported', () => {
    const ce = new ComputeEngine();
    ce.declare('MajorIndex', {
      signature: '(any) -> integer',
      evaluate: () => ce.number(42),
    });
    const report = loadCombinatorics(ce);
    expect(report.skipped).toEqual([
      { head: 'MajorIndex', reason: 'already-defined' },
    ]);
    expect(report.heads).toEqual(expect.arrayContaining(partitionHeads));
    expect(report.heads).not.toContain('MajorIndex');
    expect(evaluated(ce, ['MajorIndex', ['List', 2, 1]])).toBe(42);
  });

  test('an unknown area throws before declaring anything', () => {
    const ce = new ComputeEngine();
    expect(() => loadCombinatorics(ce, { areas: ['trees' as never] })).toThrow(
      /unknown area/
    );
    expect(ce.lookupDefinition('MajorIndex')).toBeUndefined();
  });
});

describe('domains', () => {
  const ce = new ComputeEngine();
  loadCombinatorics(ce);

  test('the domain types are aliases of list<integer>', () => {
    expect(ce.type('permutation').matches('list<integer>')).toBe(true);
    expect(ce.type('list<integer>').matches('permutation')).toBe(true);
  });

  test('an element outside the domain stays unevaluated', () => {
    for (const x of [
      ['MajorIndex', ['List', 1, 1]],
      ['MajorIndex', ['List', 2, 3]],
      ['MajorIndex', ['List', 0, 1]],
      ['LargestPart', ['List', 1, 2]],
      ['LargestPart', ['List', 3, 0]],
    ])
      expect(evaluated(ce, x)).toEqual(x);
  });

  test('an operand that is not known yet stays unevaluated, then evaluates', () => {
    const e = ce.box(['MajorIndex', 'p']);
    expect(e.evaluate().json).toEqual(['MajorIndex', 'p']);
    ce.assign('p', ce.box(['List', 3, 1, 2]));
    expect(e.evaluate().json).toBe(1);
  });

  test('a list that is not integers is a type error', () => {
    expect(ce.box(['MajorIndex', ['List', 1.5]]).isValid).toBe(false);
  });

  test('the empty list is the empty permutation and the empty partition', () => {
    expect(evaluated(ce, ['MajorIndex', ['List']])).toBe(0);
    expect(evaluated(ce, ['LargestPart', ['List']])).toBe(0);
  });

  test('elements of CE collections feed the statistics', () => {
    expect(
      evaluated(ce, [
        'ListFrom',
        ['Map', 'MajorIndex', ['Permutations', ['Range', 1, 3]]],
      ])
    ).toEqual(['List', 0, 2, 1, 2, 1, 3]);
    expect(
      evaluated(ce, [
        'ListFrom',
        ['Map', 'LargestPart', ['IntegerPartitions', 5]],
      ])
    ).toEqual(['List', 5, 4, 3, 3, 2, 2, 1]);
  });
});

describe('group-theory Permutation values', () => {
  test('are read by their images when group theory is loaded first', () => {
    const ce = new ComputeEngine();
    loadGroupTheory(ce);
    loadCombinatorics(ce);
    expect(
      evaluated(ce, ['MajorIndex', ['Permutation', ['List', 3, 1, 2]]])
    ).toBe(1);
    // Trailing fixed points are normalized away by group theory; none of them is a descent.
    expect(
      evaluated(ce, ['MajorIndex', ['Permutation', ['List', 2, 1, 3]]])
    ).toBe(1);
  });

  test('are a type error when group theory is not loaded (no such head)', () => {
    const ce = new ComputeEngine();
    loadCombinatorics(ce);
    expect(
      ce.box(['MajorIndex', ['Permutation', ['List', 3, 1, 2]]]).isValid
    ).toBe(false);
  });
});
