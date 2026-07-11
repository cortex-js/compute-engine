/**
 * Tests for the compilation fallback path (interpretation when a target can't
 * compile an expression).
 *
 * Regression for a bug where the fallback always used the `'expression'`
 * calling convention (`run({ vars })`). Lambda (`Function`) expressions
 * compile to the `'lambda'` convention (`run(a, b, ...)` with positional
 * arguments); when such an expression fell back to interpretation, the
 * positional arguments were silently dropped and `run` returned nothing.
 */

import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Using an unregistered target deterministically forces the fallback path,
// independent of which built-ins happen to lack a compiler handler.
const FORCE = { to: 'no-such-target' };

describe('Compilation fallback — lambda calling convention', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    // The fallback intentionally warns; silence it for clean test output.
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test('0-arg lambda', () => {
    const r = compile(ce.expr(['Function', 42]), FORCE);
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    expect(r.run!()).toBe(42);
  });

  test('1-arg lambda binds its argument', () => {
    const r = compile(ce.expr(['Function', ['Multiply', 'x', 'x'], 'x']), FORCE);
    expect(r.calling).toBe('lambda');
    expect(r.run!(4)).toBe(16);
  });

  test('2-arg lambda binds both arguments', () => {
    const r = compile(
      ce.expr(['Function', ['Add', 'x', ['Multiply', 2, 'y']], 'x', 'y']),
      FORCE
    );
    expect(r.calling).toBe('lambda');
    expect(r.run!(3, 5)).toBe(13);
  });

  test('3-arg lambda binds all arguments', () => {
    const r = compile(
      ce.expr(['Function', ['Add', 'x', 'y', 'z'], 'x', 'y', 'z']),
      FORCE
    );
    expect(r.calling).toBe('lambda');
    expect(r.run!(1, 2, 3)).toBe(6);
  });

  test('realistic fallback: lambda body uses an uncompilable built-in', () => {
    // `Totient` has no JavaScript compiler handler (compilation throws) but
    // the interpreter evaluates it — so this genuinely exercises the fallback
    // without relying on an unregistered target. Totient(9) = 6.
    const r = compile(
      ce.expr(['Function', ['Add', ['Totient', 'x'], 'y'], 'x', 'y'])
    );
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    expect(r.run!(9, 100)).toBe(106);
  });

  test('non-lambda expression keeps the expression calling convention', () => {
    const r = compile(ce.expr(['Add', ['Multiply', 'x', 'x'], 1]), FORCE);
    expect(r.calling).toBe('expression');
    expect(r.run!({ x: 5 })).toBe(26);
  });

  test('fallback:false still throws instead of falling back', () => {
    expect(() =>
      compile(ce.expr(['Function', ['Add', 'x', 'y'], 'x', 'y']), {
        to: 'no-such-target',
        fallback: false,
      })
    ).toThrow();
  });

  test('successful lambda compilation is unaffected', () => {
    const r = compile(
      ce.expr(['Function', ['Add', 'x', ['Multiply', 2, 'y']], 'x', 'y'])
    );
    expect(r.success).toBe(true);
    expect(r.calling).toBe('lambda');
    expect(r.run!(3, 5)).toBe(13);
  });
});

// Scalar arithmetic over a list-valued operand has no committed compile-target
// coverage. Codegen used to lower `[1,2,3] + x` to element-wise-impossible
// scalar JS, silently returning the *string* "1,2,31" behind a `success: true`.
// It must instead fail closed (D6): report `success: false` with a diagnostic
// and fall back to the interpreter (which broadcasts correctly).
describe('Compilation fallback — list-valued operand to scalar arithmetic (D6)', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test('Add(list, scalar) fails closed; run() broadcasts via the interpreter', () => {
    const r = compile(ce.box(['Add', ['List', 1, 2, 3], 'x']));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/list-valued operand/);
    expect(r.calling).toBe('expression');
    // The fallback still returns the correct interpreted (broadcast) result —
    // a JS array, not the garbage string "1,2,31".
    expect(r.run!({ x: 1 })).toEqual([2, 3, 4]);
  });

  test('Multiply(scalar, list) fails closed and falls back correctly', () => {
    const r = compile(ce.box(['Multiply', 2, ['List', 1, 2, 3]]));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/list-valued operand/);
    expect(r.run!({})).toEqual([2, 4, 6]);
  });

  test('fallback:false surfaces the diagnostic as a throw', () => {
    expect(() =>
      compile(ce.box(['Add', ['List', 1, 2, 3], 'x']), { fallback: false })
    ).toThrow(/list-valued operand/);
  });

  test('unary broadcast over a list still compiles (Sin)', () => {
    const r = compile(ce.box(['Sin', ['List', 't', 1]]));
    expect(r.success).toBe(true);
    const out = r.run!({ t: 0 }) as unknown as number[];
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(Math.sin(1));
  });
});
