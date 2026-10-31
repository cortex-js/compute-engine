/**
 * `Linspace` on `interval-js`. The target had no lowering for it, so a
 * `Linspace` at the root, in `Sum` or as a loop source refused to compile.
 * Now a `Linspace` whose count is known at compile time (omitted, or a
 * number literal) is spelled as the array of the enclosures of its samples
 * (`compileIntervalLinspace` in `interval-javascript-target.ts`). Each
 * enclosure must contain the sample that the interpreter computes.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine() {
  const ce = new ComputeEngine();
  ce.declare('a', 'real');
  ce.declare('m', 'integer');
  return ce;
}

/** The samples of the interpreter, with the inputs `args`. */
function interpret(json: unknown, args: Record<string, number> = {}): number[] {
  const ce = engine();
  for (const [k, v] of Object.entries(args)) ce.assign(k, ce.number(v));
  const value = ce.box(json as any).evaluate();
  return [...value.each()].map((x) => x.re);
}

function compiled(json: unknown) {
  const result = compile(engine().box(json as any), {
    to: 'interval-js',
    fallback: false,
  });
  expect(result.success).toBe(true);
  return result;
}

/** The `[lo, hi]` bounds of each element of an interval-js array result. */
function bounds(value: unknown): [number, number][] {
  expect(Array.isArray(value)).toBe(true);
  return (value as any[]).map((v) => {
    expect(v.kind).toBe('interval');
    return [v.value.lo, v.value.hi];
  });
}

describe('interval-js: Linspace', () => {
  test.each([
    ['three samples', ['Linspace', 0, 1, 3], {}],
    ['inexact samples', ['Linspace', 0.1, 0.7, 4], {}],
    ['the default count, one operand', ['Linspace', 4], {}],
    ['a count of 1', ['Linspace', 2, 9, 1], {}],
    ['a count that is not an integer', ['Linspace', 0, 1, 2.7], {}],
    ['an input endpoint', ['Linspace', 0, 'a', 5], { a: 2 }],
    ['a negative span', ['Linspace', 3, -1.5, 4], {}],
  ])('%s: each enclosure holds the sample', (_name, json, args) => {
    const expected = interpret(json, args);
    const got = bounds(compiled(json).run!(args));
    expect(got.length).toBe(expected.length);
    got.forEach(([lo, hi], i) => {
      expect(lo).toBeLessThanOrEqual(expected[i]);
      expect(hi).toBeGreaterThanOrEqual(expected[i]);
    });
  });

  test('a count of 0 is the empty list', () => {
    expect(interpret(['Linspace', 2, 9, 0])).toEqual([]);
    expect(compiled(['Linspace', 2, 9, 0]).run!({})).toEqual([]);
  });

  test('an infinite or NaN endpoint gives no value', () => {
    // The interpreter has no samples there, and its other reads disagree
    // (`Count` is 3, `Max` is the infinity), so the compiled code gives no
    // value rather than one of them.
    const empty = { kind: 'empty' };
    expect(compiled(['Linspace', 0, 'PositiveInfinity', 3]).run!({})).toEqual(
      empty
    );
    const fn = compiled(['Linspace', 0, 'a', 3]);
    expect(fn.run!({ a: Infinity })).toEqual(empty);
    expect(fn.run!({ a: NaN })).toEqual(empty);
    expect(compiled(['Sum', ['Linspace', 0, 'a', 3]]).run!({ a: NaN })).toEqual(
      empty
    );
  });

  test('a span that overflows: the samples are the weighted means', () => {
    // `end − start` is past the largest float, so the interpreter computes
    // `start·(1 − t) + end·t`.
    const json = ['Linspace', -1e308, 1e308, 3];
    const expected = interpret(json);
    expect(expected).toEqual([-1e308, 0, 1e308]);
    const check = (got: [number, number][]) =>
      got.forEach(([lo, hi], i) => {
        expect(lo).toBeLessThanOrEqual(expected[i]);
        expect(hi).toBeGreaterThanOrEqual(expected[i]);
        expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
      });
    check(bounds(compiled(json).run!({})));
    const ce = engine();
    ce.declare('b', 'real');
    const inputs = compile(ce.box(['Linspace', 'a', 'b', 3]), {
      to: 'interval-js',
    });
    check(bounds(inputs.run!({ a: -1e308, b: 1e308 })));
  });

  test('a count of 0 still evaluates the endpoints', () => {
    const json = [
      'Block',
      ['Assign', 'c', 0],
      ['Loop', 0, ['Element', 'k', ['Linspace', ['Assign', 'c', 1], 9, 0]]],
      'c',
    ];
    expect(
      engine()
        .box(json as any)
        .evaluate().re
    ).toBe(1);
    expect(compiled(json).run!({})).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
  });

  test('a count of 0 with an infinite endpoint is the empty list; with a NaN endpoint, no value', () => {
    const sum = ['Sum', ['Linspace', 0, 'PositiveInfinity', 0]];
    expect(
      engine()
        .box(sum as any)
        .evaluate().re
    ).toBe(0);
    expect(compiled(sum).run!({})).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
    const fn = compiled(['Linspace', 0, 'a', 0]);
    expect(fn.run!({ a: Infinity })).toEqual([]);
    expect(fn.run!({ a: NaN })).toEqual({ kind: 'empty' });
  });

  test('a NaN count declines: it has no value in the interpreter', () => {
    const result = compile(engine().box(['Linspace', 0, 1, 'NaN']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(result.success).toBe(false);
  });

  test('a wide endpoint gives wide samples; one with an infinite bound gives entire', () => {
    const fn = compiled(['Linspace', 0, 'a', 3]);
    expect(bounds(fn.run!({ a: { lo: 2, hi: 4 } as any }))).toEqual([
      [0, 0],
      [1, 2],
      [2, 4],
    ]);
    expect(fn.run!({ a: { lo: 1, hi: Infinity } as any })).toEqual({
      kind: 'entire',
    });
  });

  test('in a Sum and as a loop source', () => {
    expect(compiled(['Sum', ['Linspace', 0, 1, 5]]).run!({})).toEqual({
      kind: 'interval',
      value: { lo: 2.5, hi: 2.5 },
    });
    const loop = [
      'Block',
      ['Assign', 'c', 0],
      [
        'Loop',
        ['Assign', 'c', ['Add', 'c', 'k']],
        ['Element', 'k', ['Linspace', 0, 'a', 3]],
      ],
      'c',
    ];
    expect(compiled(loop).run!({ a: 4 })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  test('a count that is an input declines', () => {
    // The length of the list would depend on an interval: the interpreter
    // evaluates it.
    const result = compile(engine().box(['Linspace', 0, 1, 'm']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(result.success).toBe(false);
  });
});
