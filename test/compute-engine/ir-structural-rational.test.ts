/**
 * `Rational(p, q)` of two integer literals in an expression boxed without the
 * canonical form (CE-1499; README of `src/compute-engine/compilation/ir/`,
 * "Layers"): the compiler lowers it as the number `p/q` that the canonical
 * form makes of it. Each case checks the value of the code against the
 * interpreter's value of the same (structural) expression.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('n', 'integer');

const structural = (json: unknown): Expression =>
  ce.expr(json as never, { form: 'structural' });

const interpreter = (e: Expression, at: Record<string, number>): number =>
  e
    .subs(
      Object.fromEntries(Object.entries(at).map(([k, v]) => [k, ce.number(v)]))
    )
    .N().re;

const failure = (f: () => unknown): string => {
  try {
    f();
  } catch (err) {
    return (err as Error).message;
  }
  return '';
};

/** The witness of CE-1499. */
const WITNESS = ['Add', 'x', ['Rational', 1, 256]];

describe('IR: Rational of two integer literals in the structural form', () => {
  test('the witness is not canonical', () => {
    const e = structural(WITNESS);
    expect(e.isCanonical).toBe(false);
    expect(e.ops[1].operator).toBe('Rational');
  });

  test.each([
    [WITNESS],
    [['Multiply', ['Rational', 3, 4], 'x']],
    [['Add', 'x', ['Rational', -1, 3]]],
    [['Add', 'x', ['Rational', 4, 2]]],
    [['Power', 'x', ['Rational', 1, 2]]],
  ])('%j on JavaScript gives the interpreter value', (json) => {
    const e = structural(json);
    const run = compile(e, { fallback: false }).run as (a: object) => number;
    for (const x of [1, 2.5, 7]) {
      const want = interpreter(e, { x });
      expect(Number.isFinite(want)).toBe(true);
      expect(run({ x })).toBeCloseTo(want, 12);
    }
  });

  test('the witness on GLSL', () => {
    const r = compile(structural(WITNESS), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe('(x + 0.00390625)');
  });

  test('the interval mode encloses the interpreter value', () => {
    for (const json of [WITNESS, ['Add', 'x', ['Rational', -1, 3]]]) {
      const e = structural(json);
      const run = compile(e, { to: 'interval-js', fallback: false })
        .run as unknown as (a: object) => {
        kind: string;
        value: { lo: number; hi: number };
      };
      const want = interpreter(e, { x: 1 });
      const r = run({ x: { lo: 1, hi: 1 } });
      expect(r.kind).toBe('interval');
      expect(r.value.lo).toBeLessThanOrEqual(want);
      expect(r.value.hi).toBeGreaterThanOrEqual(want);
    }
  });

  test('the bigint mode: an integer quotient compiles, another declines', () => {
    const BIG = { profile: 'ir', mode: 'bigint', fallback: false } as never;
    const e = structural(['Add', 'n', ['Rational', 4, 2]]);
    const run = compile(e, BIG).run as (a: object) => bigint;
    expect(run({ n: 5n })).toBe(7n);
    expect(
      failure(() => compile(structural(['Add', 'n', ['Rational', 1, 3]]), BIG))
    ).toMatch(/not an integer/);
  });

  test('Rational of other operands still declines', () => {
    for (const json of [
      ['Add', 'x', ['Rational', 1, 0]],
      ['Add', 'x', ['Rational', 'x', 2]],
    ])
      expect(
        failure(() => compile(structural(json), { fallback: false }))
      ).toMatch(/Rational/);
  });

  // The single quotient of a product (docs/COMPILATION-MODEL.md): the
  // product by the double of 1/49 at 49 is 0.9999999999999999.
  test.each([
    [['Floor', ['Multiply', ['Rational', 1, 49], 'x']]],
    [['Floor', ['Multiply', 'x', ['Rational', 1, 49]]]],
    [['Floor', ['Divide', 'x', 49]]],
  ])('%j at 49 is the interpreter value 1', (json) => {
    for (const e of [structural(json), ce.expr(json as never)]) {
      const run = compile(e, { fallback: false }).run as (a: object) => number;
      expect(interpreter(e, { x: 49 })).toBe(1);
      expect(run({ x: 49 })).toBe(1);
    }
  });

  // A local that holds the rational is one too (CE-1191).
  test('a local that holds a structural Rational, at 49', () => {
    const e = structural([
      'Block',
      ['Declare', 'q', "'real'", ['Rational', 1, 49]],
      ['Floor', ['Multiply', 'q', 'x']],
    ]);
    const run = compile(e, { fallback: false, inputs: { x: 'real' } }).run as (
      a: object
    ) => number;
    expect(run({ x: 49 })).toBe(1);
    expect(run({ x: 48 })).toBe(0);
  });

  // A float operand is not exact: the canonical form makes
  // `Rational(1.0, 49)` a `Divide`, and the structural form declines.
  test('Rational of a float literal declines; its canonical form compiles', () => {
    const json = ['Floor', ['Multiply', ['Rational', { num: '1.0' }, 49], 'x']];
    expect(
      failure(() => compile(structural(json), { fallback: false }))
    ).toMatch(/Rational/);
    // The canonical form compiles: a float literal is its double (the
    // precision of the target), so at 49 the code gives 0 where the
    // interpreter, which computes with the decimal, gives 1.
    expect(compile(ce.expr(json as never), { fallback: false }).success).toBe(
      true
    );
  });

  // No node is rebuilt: each call keeps the definition it was boxed with.
  // (The interpreter of the structural tree reads both calls in the current
  // scope; the value is the canonical form's.)
  test('a call of a name that two scopes define, around a Rational', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.assign('g', engine.box(['Function', ['Add', 't', 1], 't']));
    engine.pushScope();
    engine.declare('g', '(real) -> real');
    engine.assign('g', engine.box(['Function', ['Multiply', 't', 10], 't']));
    const json = ['g', ['Add', 'x', ['Rational', 1, 2]]];
    const inner = engine.expr(json as never, { form: 'structural' });
    const innerC = engine.expr(json as never);
    engine.popScope();
    const outer = engine.expr(json as never, { form: 'structural' });
    const outerC = engine.expr(json as never);
    const root = engine.function('Add', [outer, inner], {
      form: 'structural',
    });
    const run = compile(root, { fallback: false }).run as (a: object) => number;
    const want = engine
      .function('Add', [outerC, innerC])
      .subs({ x: engine.number(1) })
      .N().re;
    expect(want).toBe(17.5);
    expect(run({ x: 1 })).toBe(want);
  });

  test('a Rational that a user defines is not the number p/q', () => {
    ce.pushScope();
    try {
      ce.declare('Rational', {
        signature: '(integer, integer) -> real',
        evaluate: ([a, b]) => ce.number(a.re * 10 + b.re),
      });
      const e = structural(WITNESS);
      expect(interpreter(e, { x: 1 })).toBe(267);
      expect(failure(() => compile(e, { fallback: false }))).toMatch(
        /Rational is not the library operator here/
      );
    } finally {
      ce.popScope();
    }
  });
});
