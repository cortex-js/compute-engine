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
import { ComputeEngine } from '../../src/compute-engine';
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

// Real-valued scalar↔list arithmetic now broadcasts element-wise on the
// JavaScript target (via the `_SYS.bcast` runtime helper), matching the
// interpreter. A *complex*-valued list still has no committed coverage and
// fails closed (D6): the scalar closure the broadcast wraps cannot carry the
// complex codegen, so it reports `success: false` and falls back to the
// interpreter (which broadcasts correctly) rather than returning garbage.
describe('Compilation of scalar↔list arithmetic (broadcast + complex fail-closed)', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test('Add(list, scalar) broadcasts element-wise', () => {
    const r = compile(ce.box(['Add', ['List', 1, 2, 3], 'x']));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 1 })).toEqual([2, 3, 4]);
  });

  test('Multiply(scalar, list) broadcasts element-wise', () => {
    const r = compile(ce.box(['Multiply', 2, ['List', 1, 2, 3]]));
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual([2, 4, 6]);
  });

  test('a complex-valued list fails closed (no scalar-garbage success)', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('Z', 'list<complex>');
    const r = compile(ce2.box(['Multiply', 2, 'Z']));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/list-valued operand/);
    expect(r.calling).toBe('expression');
  });

  test('fallback:false surfaces the diagnostic as a throw (complex list)', () => {
    expect(() =>
      compile(ce.box(['Multiply', 2, ['List', ['Complex', 1, 1]]]), {
        fallback: false,
      })
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
