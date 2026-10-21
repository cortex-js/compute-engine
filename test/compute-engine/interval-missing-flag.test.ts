import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Where the `missing` flag of an `empty` interval result is kept, and where
 * it is not.
 *
 * On `interval-js`, an `empty` with the `missing` flag stands for a value
 * whose interpreter value is `Missing` (a `Which` with no default arm that
 * selects no clause, an `If` with no else arm that selects no arm, a written
 * `Missing`). A comparison with it is `'maybe'`, the Kleene reading of
 * `Missing`. A comparison with an `empty` without the flag, a value that is
 * undefined over the whole cell, is `'false'` (user decision of 2026-10-20,
 * `docs/ERROR-MODEL.md`).
 *
 * The flag is not kept by an integral of a flagged integrand: an integral is
 * an accumulation, and an accumulation of absent values is `NaN` in the
 * interpreter (`NIntegrate`, `Sum`, `Missing + 1`), so a comparison with it
 * is `False` on every route. The interpreter fallback of the target gives a
 * plain `empty` for an interpreter `Missing`, as the runner of compiled code
 * gives every absent value.
 */

const X = { x: { lo: 0, hi: 1 } };
const WHICH_T = ['Which', ['Greater', 't', 5], 1];
const INTEGRAL = [
  'Integrate',
  ['Function', WHICH_T, 't'],
  ['Limits', 't', 0, 1],
];

function intervalRun(expr: any, vars: object = X): unknown {
  const ce = new ComputeEngine();
  const c = compile(ce.box(expr), { to: 'interval-js' } as never);
  expect(c.success).toBe(true);
  return c.run!(vars as never);
}

describe('interval-js: an integral of an integrand with no value', () => {
  test('a comparison with it is false, as for a Sum and on javascript', () => {
    // The integrand alone keeps the flag: `'maybe'`.
    expect(intervalRun(['Greater', ['Which', ['Greater', 'x', 5], 1], 0])).toBe(
      'maybe'
    );
    // The integral is a plain `empty`: `'false'`.
    expect(intervalRun(INTEGRAL)).toEqual({ kind: 'empty' });
    expect(intervalRun(['Greater', INTEGRAL, 0])).toBe('false');
    expect(intervalRun(['Less', INTEGRAL, 1])).toBe('false');
    expect(intervalRun(['If', ['Greater', INTEGRAL, 0], 1, 0])).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
    // A `Sum` of the same integrand on this target.
    const sum = [
      'Sum',
      ['Which', ['Greater', 'n', 5], 1],
      ['Limits', 'n', 1, 3],
    ];
    expect(intervalRun(['Greater', sum, 0])).toBe('false');
    // The `javascript` target: the integral is `NaN`, the comparison false.
    const ce = new ComputeEngine();
    const js = compile(ce.box(['If', ['Greater', INTEGRAL, 0], 1, 0]), {
      fallback: false,
    });
    expect(js?.success).toBe(true);
    expect(js!.run!({ x: 0.5 } as never)).toBe(0);
  });

  test('the interpreter: an accumulation of absent values is NaN', () => {
    const ce = new ComputeEngine();
    const nintegrate = ['NIntegrate', ['Function', WHICH_T, 't'], 0, 1];
    expect(ce.box(nintegrate).evaluate().isNaN).toBe(true);
    expect(ce.box(['Greater', nintegrate, 0]).evaluate().symbol).toBe('False');
    const sum = [
      'Sum',
      ['Which', ['Greater', 'n', 5], 1],
      ['Limits', 'n', 1, 3],
    ];
    expect(ce.box(sum).evaluate().isNaN).toBe(true);
    expect(ce.box(['Greater', sum, 0]).evaluate().symbol).toBe('False');
    // Arithmetic over the absent value.
    ce.assign('x', 0.5);
    expect(
      ce
        .box(['Greater', ['Add', ['Which', ['Greater', 'x', 5], 1], 1], 0])
        .evaluate().symbol
    ).toBe('False');
    expect(
      intervalRun([
        'Greater',
        ['Add', ['Which', ['Greater', 'x', 5], 1], 1],
        0,
      ])
    ).toBe('false');
  });
});

describe('interval-js: the absent values that have no flag', () => {
  test('an At that selects nothing is a numeric undefined value', () => {
    const at = ['At', ['List', 1, 2], 5];
    expect(intervalRun(['Greater', at, 0])).toBe('false');
    const ce = new ComputeEngine();
    expect(ce.box(['Greater', at, 0]).evaluate().symbol).toBe('False');
  });
});

describe('interval-js: the interpreter fallback of an absent value', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    // A declined compilation writes a warning.
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  test('an interpreter Missing is a plain empty, as the compiled runner gives', () => {
    const ce = new ComputeEngine();
    const P = { x: { lo: 0.5, hi: 0.5 } };
    // `Fibonacci` has no interval kernel: the target declines and the
    // interpreter computes the value.
    const declined = ['Which', ['Greater', 'x', 5], ['Fibonacci', 'x']];
    const fb = compile(ce.box(declined), {
      to: 'interval-js',
      fallback: true,
    } as never);
    expect(fb.success).toBe(false);
    expect(fb.run!(P as never)).toEqual({ kind: 'empty' });
    // The compiled form of the same shape gives the same value.
    expect(intervalRun(['Which', ['Greater', 'x', 5], 'x'], P)).toEqual({
      kind: 'empty',
    });
    // An absent cell of a list.
    const list = compile(ce.box(['List', declined, 1]), {
      to: 'interval-js',
      fallback: true,
    } as never);
    expect(list.success).toBe(false);
    expect(list.run!(P as never)).toEqual([
      { kind: 'empty' },
      { kind: 'interval', value: { lo: 1, hi: 1 } },
    ]);
    // The interpreter value.
    const f = new ComputeEngine();
    f.assign('x', 0.5);
    expect(f.box(declined).evaluate().symbol).toBe('Missing');
  });
});
