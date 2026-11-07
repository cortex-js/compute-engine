/**
 * CE-651. On `interval-js`, the condition of an `If` statement in a `Loop`
 * body was compiled with plain JavaScript comparisons. An input (`_.x`) and a
 * constant such as `Pi` are enclosures (`{ lo, hi }` objects) on this target,
 * and a JavaScript comparison with such an object is always false, so a
 * `Break` under `i > x` never ran: at `x = 2` the loop below gave the point
 * interval 6, where the interpreter gives 4.
 *
 * The condition is now the interval verdict, converted to a JavaScript
 * boolean by `_IA.decided()`. One pass of a loop cannot run both branches,
 * so a verdict that is not decided (`'maybe'`, for an input interval on
 * which the condition is true at some points and false at others) throws,
 * and the result is `{ kind: 'entire' }`
 * (`intervalStatementCondition()` in `compiler-core.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic } from '../../src/compute-engine/interval';

/** `s ≔ 0; Loop(body, k ∈ 1..5); s` */
function loopOf(body: unknown) {
  return [
    'Block',
    ['Assign', 's', 0],
    ['Loop', body, ['Element', 'k', ['Range', 1, 5]]],
    's',
  ];
}

/** `n ≔ 0; Loop(Block(n ≔ i; If(i > x, Break)), i ∈ 1..5); n + 1` */
const BREAK_PAST_INPUT = [
  'Block',
  ['Assign', 'n', 0],
  [
    'Loop',
    ['Block', ['Assign', 'n', 'i'], ['If', ['Greater', 'i', 'x'], ['Break']]],
    ['Element', 'i', ['Range', 1, 5]],
  ],
  ['Add', 'n', 1],
];

const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

/** The interpreter's value at `x`, and the compiled value at `x`. */
function check(json: unknown, x: number, expected: number) {
  const interpreter = new ComputeEngine();
  interpreter.declare('x', { type: 'real', value: x });
  expect(interpreter.box(json as any).evaluate().re).toBe(expected);

  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  const result = compile(ce.box(json as any), { to: 'interval-js' });
  expect(result.success).toBe(true);
  expect(result.code).toContain('_IA.decided(');
  expect(result.run!({ x })).toEqual(point(expected));
}

describe('CE-651: an interval loop condition over an input', () => {
  test.each([
    [0, 2],
    [2, 4],
    [2.5, 4],
    [4, 6],
    [9, 6],
  ])('a Break when the index passes x = %p', (x, expected) =>
    check(BREAK_PAST_INPUT, x, expected)
  );

  test('an If with an else branch over an input', () => {
    const body = [
      'If',
      ['Greater', 'k', 'x'],
      ['Assign', 's', ['Add', 's', 1]],
      ['Assign', 's', ['Add', 's', 10]],
    ];
    check(loopOf(body), 2, 23);
    check(loopOf(body), 4, 41);
  });

  test('a Continue under a connective over an input', () => {
    const body = [
      'Block',
      ['If', ['And', ['Greater', 'k', 1], ['Less', 'k', 'x']], ['Continue']],
      ['Assign', 's', ['Add', 's', 'k']],
    ];
    check(loopOf(body), 2.5, 13);
    check(loopOf(body), 4, 10);
  });

  test.each([
    ['Pi', 6],
    ['ExponentialE', 3],
  ])('a Break when the index passes %s', (constant, expected) => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      loopOf([
        'Block',
        ['If', ['Greater', 'k', constant], ['Break']],
        ['Assign', 's', ['Add', 's', 'k']],
      ]) as any
    );
    expect(expr.evaluate().re).toBe(expected);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.run!({})).toEqual(point(expected));
  });

  // An input interval on which the condition is decided gives a point; one
  // on which it is not decided gives `entire`, since the pass where the loop
  // stops is not known.
  test('an input interval', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const result = compile(ce.box(BREAK_PAST_INPUT as any), {
      to: 'interval-js',
    });
    expect(result.success).toBe(true);
    expect(result.run!({ x: { lo: 2.2, hi: 2.8 } })).toEqual(point(4));
    expect(result.run!({ x: { lo: 1.5, hi: 2.5 } })).toEqual({
      kind: 'entire',
    });
  });

  // The batch evaluator gives the answer of `run()` for each cell: the kind
  // code 2 (`entire`) for the cell where the condition is not decided, and
  // the cell does not count as a failure.
  test('broadcast gives entire for a cell where the condition is not decided', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const result = compile(ce.box(BREAK_PAST_INPUT as any), {
      to: 'interval-js',
    });
    const out = result.broadcast!({ x: new Float64Array([2, 2, 1.5, 2.5]) });
    expect(Array.from(out)).toEqual([4, 4, 0, NaN, NaN, 2]);
  });

  // The interpreter stops `And` at its first `False` operand, so a host
  // function in a later operand does not run. With `x = 0`, `k < x` is false
  // on each pass, and `f` must not be called.
  test('a later operand of And runs only when the first does not decide', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('f', '(real) -> real');
    const g = globalThis as { ce651Calls?: number };
    g.ce651Calls = 0;
    const result = compile(
      ce.box(
        loopOf([
          'Block',
          ['If', ['And', ['Less', 'k', 'x'], ['Greater', ['f', 'k'], 0]], ['Break']],
          ['Assign', 's', ['Add', 's', 'k']],
        ]) as any
      ),
      {
        to: 'interval-js',
        functions: {
          // The function is emitted from its source, so it counts its calls
          // in a global.
          f: (a: unknown) => {
            (globalThis as { ce651Calls?: number }).ce651Calls! += 1;
            return a;
          },
        },
      }
    );
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0 })).toEqual(point(15));
    expect(g.ce651Calls).toBe(0);
    // With `x = 9`, `k < x` is true on each pass: `f(1) > 0` runs and breaks.
    expect(result.run!({ x: 9 })).toEqual(point(0));
    expect(g.ce651Calls).toBe(1);
    delete g.ce651Calls;
  });

  // A `Not` around the connective keeps the order of evaluation: with
  // `x = 0`, `Not(And(k < x, f(k) > 0))` is true on the first pass, and `f`
  // is not called.
  test('a connective under Not keeps the order of evaluation', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('f', '(real) -> real');
    const g = globalThis as { ce651Calls?: number };
    g.ce651Calls = 0;
    const result = compile(
      ce.box(
        loopOf([
          'Block',
          [
            'If',
            ['Not', ['And', ['Less', 'k', 'x'], ['Greater', ['f', 'k'], 0]]],
            ['Break'],
          ],
          ['Assign', 's', ['Add', 's', 'k']],
        ]) as any
      ),
      {
        to: 'interval-js',
        functions: {
          f: (a: unknown) => {
            (globalThis as { ce651Calls?: number }).ce651Calls! += 1;
            return a;
          },
        },
      }
    );
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0 })).toEqual(point(0));
    expect(g.ce651Calls).toBe(0);
    delete g.ce651Calls;
  });

  // An operand that is a list is not a condition of a loop pass: the
  // compilation declines, and the interpreter evaluates the loop.
  test('a list operand of And declines', () => {
    const ce = new ComputeEngine();
    ce.declare('flags', 'list<boolean>');
    const result = compile(
      ce.box(
        loopOf([
          'Block',
          ['If', ['And', 'flags', ['Greater', 'k', 2]], ['Break']],
          ['Assign', 's', ['Add', 's', 'k']],
        ]) as any
      ),
      { to: 'interval-js' }
    );
    expect(result.success).toBe(false);
  });

  // `Or(maybe, true)` is `true`: an undecided first operand does not stop the
  // evaluation, and a later operand can still decide the result.
  test('an undecided first operand of Or is decided by a later one', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const result = compile(
      ce.box(
        loopOf([
          'Block',
          ['If', ['Or', ['Greater', 'k', 'x'], ['Greater', 'k', 2]], ['Break']],
          ['Assign', 's', ['Add', 's', 'k']],
        ]) as any
      ),
      { to: 'interval-js' }
    );
    expect(result.success).toBe(true);
    // For x in [2.5, 3.5], at k = 3 `3 > x` is not decided and `3 > 2` is
    // true, so the loop breaks: 1 + 2 = 3. For x in [1.5, 2.5], at k = 2
    // `2 > x` is not decided and `2 > 2` is false: the verdict is not
    // decided, and the result is entire.
    expect(result.run!({ x: { lo: 2.5, hi: 3.5 } })).toEqual(point(3));
    expect(result.run!({ x: { lo: 1.5, hi: 2.5 } })).toEqual({
      kind: 'entire',
    });
  });

  // A boolean input is a verdict on this target; before, the JavaScript `&&`
  // read the string `'false'` as true.
  test('a boolean input in the condition', () => {
    const ce = new ComputeEngine();
    ce.declare('flag', 'boolean');
    const result = compile(
      ce.box(
        loopOf([
          'Block',
          ['If', ['And', 'flag', ['Greater', 'k', 2]], ['Break']],
          ['Assign', 's', ['Add', 's', 'k']],
        ]) as any
      ),
      { to: 'interval-js' }
    );
    expect(result.success).toBe(true);
    expect(result.run!({ flag: true } as any)).toEqual(point(3));
    expect(result.run!({ flag: false } as any)).toEqual(point(15));
    expect(result.run!({ flag: 'maybe' } as any)).toEqual({ kind: 'entire' });
  });

  test('_IA.decided converts a verdict and throws for maybe', () => {
    expect(IntervalArithmetic.decided('true')).toBe(true);
    expect(IntervalArithmetic.decided('false')).toBe(false);
    expect(() => IntervalArithmetic.decided('maybe')).toThrow();
  });
});
