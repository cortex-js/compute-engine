import { ComputeEngine, isFunction } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { loadGroupTheory } from '../../src/compute-engine/library/group-theory';
import { CancellationError } from '../../src/common/interruptible';
import type { MathJsonExpression } from '../../src/math-json/types';

function engine(options: Parameters<typeof loadGroupTheory>[1] = {}) {
  const ce = new ComputeEngine();
  loadGroupTheory(ce, options);
  return ce;
}
function run(ce: ComputeEngine, source: string) {
  const result = executeEpsil(ce, source);
  expect(result.diagnostics).toEqual([]);
  return result.value;
}
const p: MathJsonExpression = ['Permutation', ['List', 2, 1]];
const q: MathJsonExpression = ['Permutation', ['List', 1, 3, 2]];
const G: MathJsonExpression = [
  'PermutationGroup',
  ['List', p, q],
  ['PermutationAction', 3],
];
function close(ce: ComputeEngine, group = G, elements = 6, products = 12) {
  return ce
    .box([
      'PermutationGroupElements',
      group,
      [
        'Dictionary',
        ['Tuple', { str: 'maxElements' }, elements],
        ['Tuple', { str: 'maxProducts' }, products],
      ],
    ])
    .evaluate();
}

describe('CE generator descriptors and bounded closure', () => {
  const ce = engine();
  test('Epsil supports a typed group function and complete S3 closure', () => {
    const result = run(
      ce,
      'function enumerateSmall(g: PermutationGroup) -> list<Permutation> { PermutationGroupElements(g, options: {maxElements -> 6, maxProducts -> 12}) }\nlet G = PermutationGroup([Permutation([2,1]),Permutation([1,3,2])],PermutationAction(3))\nenumerateSmall(G)'
    );
    expect(isFunction(result, 'List')).toBe(true);
    if (isFunction(result)) expect(result.ops).toHaveLength(6);
    expect(
      run(
        ce,
        'count(PermutationGroupElements(G, options: {maxElements -> 6, maxProducts -> 12}))'
      ).json
    ).toBe(6);
  });
  test('construction retains fixed points and never runs closure', () => {
    const limited = engine({ maxClosureImageWork: 0 });
    const group = limited.box(G);
    expect(group.operator).toBe('PermutationGroup');
    expect(group.json).toEqual(G);
    expect(group.type.toString()).toBe('PermutationGroup');
    expect(group.hash).toEqual(limited.box(G).hash);
    expect(group.toString()).toContain('PermutationGroup');
    expect(close(limited).operator).toBe('Error');
  });
  test.each(
    (
      [
        ['PermutationGroup', ['List', q], ['PermutationAction', 2]],
        [
          'PermutationGroup',
          ['List', ['Permutation', ['List', 1, 1]]],
          ['PermutationAction', 3],
        ],
        [
          'PermutationGroup',
          ['List', ['Tuple', 1, 2]],
          ['PermutationAction', 3],
        ],
        ['PermutationGroup', ['List'], 3],
        ['PermutationGroup', ['List']],
        ['PermutationGroup', 3, ['PermutationAction', 3]],
        ['PermutationGroup', ['List'], ['PermutationAction', 3], 0],
      ] satisfies MathJsonExpression[]
    ).map((json) => ({ json }))
  )('rejects invalid descriptor $json through all boxing modes', ({ json }) => {
    for (const form of ['canonical', 'raw', 'structural'] as const)
      expect(ce.box(json, { form }).evaluate().operator).toBe('Error');
  });
  test('raw and strict:false consumers cannot trust a forged group tag', () => {
    const loose = engine();
    loose.strict = false;
    const forged = [
      'PermutationGroup',
      ['List', q],
      ['PermutationAction', 2],
    ] as MathJsonExpression;
    expect(
      loose
        .box(
          [
            'PermutationGroupElements',
            forged,
            [
              'Dictionary',
              ['Tuple', { str: 'maxElements' }, 6],
              ['Tuple', { str: 'maxProducts' }, 12],
            ],
          ],
          { form: 'raw' }
        )
        .evaluate().operator
    ).toBe('Error');
    expect(
      loose
        .box([
          'PermutationGroupElements',
          'True',
          [
            'Dictionary',
            ['Tuple', { str: 'maxElements' }, 6],
            ['Tuple', { str: 'maxProducts' }, 12],
          ],
        ])
        .evaluate().operator
    ).toBe('Error');
  });
  test('an explicit empty generator list defines a trivial group on its action', () => {
    const result = run(
      ce,
      'PermutationGroupElements(PermutationGroup([],PermutationAction(5)), options: {maxElements -> 1, maxProducts -> 0})'
    );
    expect(result.json).toEqual(['List', ['Permutation', ['List']]]);
  });
  test('explicitly materialized and symbolic generator inputs are checked on evaluation', () => {
    expect(
      run(
        ce,
        'PermutationGroupElements(PermutationGroup(listFrom([Permutation([2,1])]),PermutationAction(3)), options: {maxElements -> 2, maxProducts -> 2})'
      ).operator
    ).toBe('List');
    const symbolic = ce.box([
      'PermutationGroup',
      'pending_generators',
      ['PermutationAction', 3],
    ]);
    expect(symbolic.operator).toBe('PermutationGroup');
    ce.assign('pending_generators', ['List', p, q]);
    expect(symbolic.evaluate().json).toEqual(G);
    ce.assign('pending_generators', ['List', ['Permutation', ['List', 1, 1]]]);
    expect(symbolic.evaluate().operator).toBe('Error');
  });
  test('different generating lists are not treated as unequal subgroups', () => {
    const other = ce.box([
      'PermutationGroup',
      ['List', q, p],
      ['PermutationAction', 3],
    ]);
    expect(ce.box(G).isSame(other)).toBe(false);
    expect(ce.box(G).isEqual(other)).toBeUndefined();
    const keys = (x: ReturnType<typeof close>) => {
      expect(isFunction(x, 'List')).toBe(true);
      return isFunction(x)
        ? x.ops.map((y) => JSON.stringify(y.json)).sort()
        : [];
    };
    expect(keys(close(ce, other.json))).toEqual(keys(close(ce)));
  });
  test('exhaustion is an error and a larger retry completes', () => {
    expect(JSON.stringify(close(ce, G, 5, 12).json)).toContain(
      'permutation-closure-element-limit'
    );
    expect(JSON.stringify(close(ce, G, 6, 11).json)).toContain(
      'permutation-closure-product-limit'
    );
    expect(close(ce).operator).toBe('List');
    expect(close(ce, G, 0, 12).operator).toBe('Error');
  });
  test('receiver limits apply to descriptors and complete-list storage', () => {
    expect(engine({ maxGenerators: 1 }).box(G).evaluate().operator).toBe(
      'Error'
    );
    expect(engine({ maxGeneratorImages: 4 }).box(G).evaluate().operator).toBe(
      'Error'
    );
    expect(
      JSON.stringify(close(engine({ maxClosureStoredImages: 1 })).json)
    ).toContain('permutation-closure-storage-limit');
  });
  test('JSON reload and checkpoint restore preserve generators and action', () => {
    const fresh = engine();
    const loaded = fresh.box(JSON.parse(JSON.stringify(ce.box(G).json)));
    expect(close(fresh, loaded.json).operator).toBe('List');
    fresh.assign('saved_group', loaded);
    const cp = fresh.checkpoint();
    fresh.assign('saved_group', [
      'PermutationGroup',
      ['List'],
      ['PermutationAction', 0],
    ]);
    fresh.restore(cp);
    expect(fresh.symbol('saved_group').evaluate().json).toEqual(G);
    expect(
      run(
        fresh,
        'count(PermutationGroupElements(saved_group, options: {maxElements -> 6, maxProducts -> 12}))'
      ).json
    ).toBe(6);
    fresh.discard(cp);
  });
  test('registration of the third nominal type is atomic and restores away', () => {
    const failed = new ComputeEngine();
    failed.declareType('PermutationGroup', 'integer', { mint: false });
    expect(() => loadGroupTheory(failed)).toThrow();
    expect(failed.lookupDefinition('Permutation')).toBeUndefined();
    expect(failed.lookupDefinition('PermutationGroupElements')).toBeUndefined();
    const fresh = new ComputeEngine(),
      cp = fresh.checkpoint();
    loadGroupTheory(fresh);
    fresh.restore(cp);
    expect(fresh.lookupDefinition('PermutationGroup')).toBeUndefined();
    loadGroupTheory(fresh);
    expect(close(fresh).operator).toBe('List');
    fresh.discard(cp);
  });
  test('caller cancellation remains distinct from resource errors', () => {
    const fresh = engine();
    const query = fresh.box([
      'PermutationGroupElements',
      G,
      [
        'Dictionary',
        ['Tuple', { str: 'maxElements' }, 6],
        ['Tuple', { str: 'maxProducts' }, 12],
      ],
    ]);
    expect(() =>
      fresh.withStepBudget({ steps: 0, label: 'closure' }, () =>
        query.evaluate()
      )
    ).toThrow(CancellationError);
    expect(close(fresh).operator).toBe('List');
  });
});
