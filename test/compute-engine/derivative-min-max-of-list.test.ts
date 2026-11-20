/**
 * The derivative of `Min` or `Max` of one list of numbers is the derivative
 * of the element that is the smallest or the largest:
 *
 *     d/dx Min(L) = At(L′, ArgMin(L))
 *     d/dx Max(L) = At(L′, ArgMax(L))
 *
 * The position is constant between the points where two elements cross. The
 * evaluation of `D` writes out the two lists, so the rule declines when
 * that value is large: for a list written with a function (`Apply`, `Map`),
 * with no evaluation, and for a value of more nodes than the size limit of
 * a derivative.
 *
 * Corpus: the Desmos document `neyret/lwuwgb9ic5` (Tycho) differentiates the
 * smallest and the second smallest of the squared distances to N points.
 * The second is `Min` of an `Apply`, whose value repeats the N-term `Min` in
 * each element.
 */

import { ComputeEngine, compile } from '../../src/compute-engine';

const x2 = ['Power', 'x', 2];
const shifted = ['Power', ['Add', 'x', -1], 2];
const wave = ['Sin', ['Multiply', 3, 'x']];
const list = ['List', x2, shifted, wave];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  return ce;
}

/** A central difference of `f` at `x`, from the interpreter. */
function slope(ce: ComputeEngine, f: unknown, x: number): number {
  const h = 1e-6;
  const at = (v: number) =>
    ce
      .expr(f as never)
      .subs({ x: v })
      .N().re;
  return (at(x + h) - at(x - h)) / (2 * h);
}

// Away from the points where two elements of `list` cross.
const samples = [-1.7, -0.9, -0.3, 0.2, 0.8, 1.3, 1.9];

describe('The derivative of Min or Max of a list', () => {
  test.each([
    ['Min', 'ArgMin'],
    ['Max', 'ArgMax'],
  ])('%s is the derivative of the selected element', (op, position) => {
    const ce = engine();
    const result = ce.expr(['D', [op, list], 'x'] as never).evaluate();
    expect(result.operator).toBe('At');
    expect(result.type.matches('number')).toBe(true);
    expect(JSON.stringify(result.json)).toContain(
      JSON.stringify([position, list])
    );
    for (const x of samples)
      expect(result.subs({ x }).N().re).toBeCloseTo(
        slope(ce, [op, list], x),
        6
      );
  });

  test('a second derivative selects in the second derivative of the list', () => {
    const ce = engine();
    const result = ce
      .expr(['D', ['D', ['Min', ['List', x2, shifted]], 'x'], 'x'] as never)
      .evaluate();
    expect(result.json).toEqual([
      'At',
      ['List', 2, 2],
      ['ArgMin', ['List', x2, shifted]],
    ]);
  });

  test('the position of the smallest element has the derivative 0', () => {
    const ce = engine();
    expect(ce.expr(['D', ['ArgMin', list], 'x'] as never).evaluate().json).toBe(
      0
    );
    expect(ce.expr(['D', ['ArgMax', list], 'x'] as never).evaluate().json).toBe(
      0
    );
  });

  test('a list that does not depend on the variable gives 0', () => {
    const ce = engine();
    expect(
      ce.expr(['D', ['Min', ['List', 'y', 2]], 'x'] as never).evaluate().json
    ).toBe(0);
  });

  test('a list computed from a list of points', () => {
    const ce = engine();
    const points = [
      'List',
      ['Tuple', 0.1, 0.4],
      ['Tuple', 0.3, 0.5],
      ['Tuple', 0.7, 0.2],
    ];
    const distances = [
      'Add',
      ['Power', ['Add', 'x', ['Negate', ['PointX', points]]], 2],
      ['Power', ['Add', 'y', ['Negate', ['PointY', points]]], 2],
    ];
    const result = ce.expr(['D', ['Min', distances], 'x'] as never).evaluate();
    expect(result.operator).toBe('At');
    // At (0.6, 0.3) the nearest point is (0.7, 0.2): 2·(0.6 - 0.7).
    expect(result.subs({ x: 0.6, y: 0.3 }).N().re).toBeCloseTo(-0.2, 10);
    // At (0.1, 0.5) the nearest point is (0.1, 0.4): 2·(0.1 - 0.1).
    expect(result.subs({ x: 0.1, y: 0.5 }).N().re).toBeCloseTo(0, 10);
  });

  test('a list written with a function declines', () => {
    const ce = engine();
    const mapped = [
      'Apply',
      ['Function', ['Multiply', 2, 'k'], 'k'],
      ['List', x2, shifted],
    ];
    const result = ce.expr(['D', ['Min', mapped], 'x'] as never).evaluate();
    expect(result.operator).toBe('D');
    expect(result.type.matches('number')).toBe(true);
  });

  test('a value over the size limit of a derivative declines', () => {
    const ce = engine();
    // 1,200 elements `(x - k)^2`: the two lists of the form have more than
    // 10,000 nodes.
    const elements = Array.from({ length: 1200 }, (_, k) => [
      'Power',
      ['Add', 'x', -k],
      2,
    ]);
    const large = ce
      .expr(['D', ['Min', ['List', ...elements]], 'x'] as never)
      .evaluate();
    expect(large.operator).toBe('D');
    const small = ce
      .expr(['D', ['Min', ['List', ...elements.slice(0, 100)]], 'x'] as never)
      .evaluate();
    expect(small.operator).toBe('At');
    // The compiler declines a closed form of that size, and compiles a `D`
    // with no closed form to a numeric derivative on JavaScript.
    const compiled = compile(
      ce.expr(['D', ['Min', ['List', ...elements]], 'x'] as never),
      { to: 'javascript', inputs: { x: 'real' } } as never
    );
    expect(compiled.success).toBe(true);
    expect(compiled.run!({ x: 3.25 } as never)).toBeCloseTo(0.5, 5);
  });

  test('a user definition of the selector declines', () => {
    // The form is built by name: with a user `ArgMin`, it would call that
    // function. For x > 0 the derivative of `Min([x, -x])` is -1.
    const ce = engine();
    ce.assign('ArgMin', ce.expr(['Function', 1, 'xs']));
    const result = ce
      .expr(['D', ['Min', ['List', 'x', ['Negate', 'x']]], 'x'] as never)
      .evaluate();
    expect(result.operator).toBe('D');
  });

  test('the explanation of a declined rule has no step of the rule', () => {
    const ce = engine();
    const mapped = [
      'Apply',
      ['Function', ['Multiply', 2, 'k'], 'k'],
      ['List', x2, shifted],
    ];
    const elements = Array.from({ length: 1200 }, (_, k) => [
      'Power',
      ['Add', 'x', -k],
      2,
    ]);
    for (const body of [
      ['Min', mapped],
      ['Min', ['List', ...elements]],
    ]) {
      const explanation = ce
        .expr(body as never)
        .explain('D', { variable: 'x', verbosity: 'verbose' });
      expect(explanation.result.operator).toBe('D');
      expect(explanation.steps.some((step) => step.value.has('ArgMin'))).toBe(
        false
      );
    }
  });

  test('several arguments and other reductions stay unevaluated', () => {
    const ce = engine();
    for (const body of [
      ['Min', x2, list],
      ['Mean', list],
    ])
      expect(ce.expr(['D', body, 'x'] as never).evaluate().operator).toBe('D');
  });

  test('compiled to JavaScript, the derivative is exact', () => {
    const ce = engine();
    const result = compile(ce.expr(['D', ['Min', list], 'x'] as never), {
      to: 'javascript',
      inputs: { x: 'real' },
    } as never);
    expect(result.success).toBe(true);
    // The numeric derivative of the runtime is not used.
    expect(String(result.code)).not.toContain('_SYS.nd');
    for (const x of samples)
      expect(result.run!({ x } as never)).toBeCloseTo(
        slope(ce, ['Min', list], x),
        6
      );
  });

  test('compiled to GLSL, the derivative has a closed form', () => {
    const ce = engine();
    const result = compile(ce.expr(['D', ['Max', list], 'x'] as never), {
      to: 'glsl',
      inputs: { x: 'real' },
    } as never);
    expect(result.success).toBe(true);
  });
});
