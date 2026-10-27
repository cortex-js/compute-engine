import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { loadGroupTheory } from '../../src/compute-engine/library/group-theory';
import type { MathJsonExpression } from '../../src/math-json/types';

function engine(maxDegree?: number) {
  const ce = new ComputeEngine();
  loadGroupTheory(ce, { maxDegree });
  return ce;
}
function run(ce: ComputeEngine, source: string) {
  const result = executeEpsil(ce, source);
  expect(result.diagnostics).toEqual([]);
  return result.value;
}
const swap: MathJsonExpression = ['Permutation', ['List', 2, 1]];
const identity: MathJsonExpression = ['Permutation', ['List']];

describe('checked CE permutation entry routes', () => {
  const ce = engine();
  test('Epsil, host calls, and MathJSON agree on canonical values and equality', () => {
    const a = run(ce, 'Permutation([2, 1, 3])');
    const b = ce.function('Permutation', [ce.box(['List', 2, 1])]);
    expect(a.json).toEqual(swap);
    expect(a.type.toString()).toBe('Permutation');
    expect(a.isSame(b)).toBe(true);
    expect(a.hash).toBe(b.hash);
    expect(a.isEqual(ce.box(['Permutation', ['List', 1, 3, 2]]))).toBe(false);
    expect(run(ce, 'PermutationAction(2) == PermutationAction(3)').json).toBe(
      'False'
    );
  });
  test.each(
    (
      [
        ['Permutation', ['List', 1, 1]],
        ['Permutation', ['List', 2]],
        ['Permutation', ['List', 1.5]],
        ['Permutation', ['List', 0]],
        ['Permutation', ['List', { num: '9007199254740993' }]],
        ['Permutation', ['List', "'a'"]],

        ['Permutation', 3],
        ['Permutation'],
        ['Permutation', ['List'], ['List']],
      ] as MathJsonExpression[]
    ).map((json) => ({ json }))
  )('rejects malformed boxed and raw input $json', ({ json }) => {
    expect(ce.box(json).operator).toBe('Error');
    expect(ce.box(json, { form: 'raw' }).evaluate().operator).toBe('Error');
  });
  test('structural forms and concrete noninteger values cannot bypass validation', () => {
    expect(
      ce.box(['Permutation', ['List', 1, 1]], { form: 'structural' }).evaluate()
        .operator
    ).toBe('Error');
    for (const json of [
      ['Permutation', ['List', 'True']],
      ['Permutation', 'True'],
      ['PermutationAction', 'True'],
    ] as MathJsonExpression[])
      expect(ce.box(json).evaluate().operator).toBe('Error');
  });
  test('operations revalidate forged operands, even without canonical boxing', () => {
    const forged = ce.box(['Permutation', ['List', 1, 1]], {
      form: 'raw',
    });
    const call = ce.function('PermutationCompose', [forged, ce.box(swap)], {
      form: 'raw',
    });
    const result = call.evaluate();
    expect(result.operator).toBe('Error');
    expect(JSON.stringify(result.json)).toContain(
      'duplicate-permutation-image'
    );
    expect(
      ce.box(['PermutationInverse', ['Tuple', ['List', 2, 1]]]).evaluate()
        .operator
    ).toBe('Error');
  });
  test('symbolic inputs remain candidates until values can be checked', () => {
    const input = ce.box(['Permutation', 'pending_images']);
    expect(input.operator).toBe('Permutation');
    expect(input.evaluate().operator).toBe('Permutation');
    ce.assign('pending_images', ['List', 2, 1, 3]);
    expect(input.evaluate().json).toEqual(swap);
    ce.assign('pending_images', ['List', 1, 1]);
    expect(input.evaluate().operator).toBe('Error');
  });
  test('Epsil functions use checked types and ordered composition', () => {
    expect(
      run(
        ce,
        'function checked_square(x: Permutation) -> Permutation { PermutationCompose(x, x) }\nchecked_square(Permutation([2, 1]))'
      ).json
    ).toEqual(identity);
    expect(
      run(ce, 'PermutationCompose(Permutation([2,1]), Permutation([1,3,2]))')
        .json
    ).toEqual(['Permutation', ['List', 3, 1, 2]]);
    expect(
      run(ce, 'PermutationCompose(Permutation([1,3,2]), Permutation([2,1]))')
        .json
    ).toEqual(['Permutation', ['List', 2, 3, 1]]);
    expect(run(ce, 'PermutationInverse(Permutation([2,3,1]))').json).toEqual([
      'Permutation',
      ['List', 3, 1, 2],
    ]);
  });
  test('explicit materialization permits finite views; constructors do not enumerate them', () => {
    expect(run(ce, 'Permutation(listFrom(1..3))').json).toEqual(identity);
    expect(run(ce, 'Permutation(1..3)').operator).toBe('Error');
  });
  test('action checks keep fixed points and reject incompatible support', () => {
    expect(
      run(ce, 'PermutationApply(Permutation([2,1]), 3, PermutationAction(3))')
        .json
    ).toBe(3);
    expect(
      run(ce, 'PermutationInAction(Permutation([2,1]), PermutationAction(3))')
        .json
    ).toEqual(swap);
    expect(
      run(ce, 'PermutationInAction(Permutation([1,3,2]), PermutationAction(2))')
        .operator
    ).toBe('Error');
    expect(
      run(ce, 'PermutationApply(Permutation([]), 1, PermutationAction(0))')
        .operator
    ).toBe('Error');
    expect(
      run(ce, 'PermutationInAction(Permutation([]), PermutationAction(0))').json
    ).toEqual(identity);
  });
  test('fresh-engine reload validates values and action descriptors', () => {
    const fresh = engine();
    for (const json of [swap, ['PermutationAction', 3] as MathJsonExpression]) {
      const encoded = JSON.stringify(ce.box(json).json);
      expect(fresh.box(JSON.parse(encoded)).json).toEqual(json);
    }
    expect(fresh.box(JSON.parse('["Permutation",["List",1,1]]')).operator).toBe(
      'Error'
    );
  });
  test('caller cancellation is not converted into an Error value', () => {
    const fresh = engine();
    expect(() =>
      fresh.withStepBudget({ steps: 0, label: 'permutation-input' }, () =>
        fresh.box(['Permutation', ['List', 2, 1]])
      )
    ).toThrow(CancellationError);
    expect(fresh.box(swap).evaluate().json).toEqual(swap);
  });
  test('strict:false does not bypass mathematical validation', () => {
    const loose = engine();
    loose.strict = false;
    expect(
      loose.box(['PermutationCompose', 'True', 'True']).evaluate().operator
    ).toBe('Error');
    expect(
      loose.box(['PermutationInAction', swap, 'True']).evaluate().operator
    ).toBe('Error');
    expect(loose.box(['Permutation', ['List', 1, 1]]).evaluate().operator).toBe(
      'Error'
    );
  });
});

describe('installation, limits, and checkpoints', () => {
  test('installation is opt-in and can be restored away and replayed', () => {
    const ce = new ComputeEngine();
    expect(ce.lookupDefinition('Permutation')).toBeUndefined();
    const cp = ce.checkpoint();
    loadGroupTheory(ce);
    expect(ce.box(swap).type.toString()).toBe('Permutation');
    ce.restore(cp);
    expect(ce.lookupDefinition('Permutation')).toBeUndefined();
    loadGroupTheory(ce);
    expect(ce.box(swap).evaluate().json).toEqual(swap);
    ce.discard(cp);
  });
  test('failed installation does not leave a partial library', () => {
    const ce = new ComputeEngine();
    ce.declareType('PermutationAction', 'integer', { mint: false });
    expect(() => loadGroupTheory(ce)).toThrow();
    expect(ce.lookupDefinition('Permutation')).toBeUndefined();
    expect(ce.lookupDefinition('PermutationCompose')).toBeUndefined();
    ce.declareType('Permutation', 'integer', { mint: false });
  });
  test('saved values restore, and configured limits are enforced on reload', () => {
    const ce = engine(3);
    run(ce, 'let saved_permutation = Permutation([2,1])');
    const cp = ce.checkpoint();
    run(ce, 'saved_permutation = Permutation([1,3,2])');
    ce.restore(cp);
    expect(run(ce, 'saved_permutation').json).toEqual(swap);
    expect(run(ce, 'PermutationAction(4)').operator).toBe('Error');
    expect(run(ce, 'Permutation([1,2,3,4])').operator).toBe('Error');
    const strict = engine(1);
    expect(strict.box(swap).operator).toBe('Error');
    ce.discard(cp);
  });
});
