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
import {
  compileDiagnosticOf,
  isCompileDeclineError,
} from '../../src/compute-engine/compilation/diagnostics';
import { executeEpsil } from '../../src/epsil/execute-epsil';

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
    const r = compile(
      ce.expr(['Function', ['Multiply', 'x', 'x'], 'x']),
      FORCE
    );
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
    // `PartitionsP` has no JavaScript compiler handler (compilation throws)
    // but the interpreter evaluates it — so this genuinely exercises the
    // fallback without relying on an unregistered target. PartitionsP(9) = 30.
    const r = compile(
      ce.expr(['Function', ['Add', ['PartitionsP', 'x'], 'y'], 'x', 'y'])
    );
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    expect(r.run!(9, 100)).toBe(130);
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

// Scalar↔list arithmetic broadcasts element-wise on the JavaScript target (via
// the `_SYS.bcast` runtime helper), matching the interpreter. The broadcast
// wraps ONE scalar closure and maps it over every position, so it needs a
// single complex-vs-real convention for each operand: an all-real or an
// all-complex list has one (each element parameter is declared accordingly and
// the head's own scalar codegen picks the matching lowering), while a list
// whose elements DISAGREE, or one whose elements the analysis cannot see at
// all, has none and fails closed — `success: false`, and the interpreter
// (which broadcasts correctly) answers instead of the compiled code returning
// garbage.
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

  test('a list whose elements are UNIFORMLY complex broadcasts', () => {
    // The closure carries one complex-vs-real convention, so a list all of
    // whose elements are complex has one that fits: each element parameter is
    // declared complex and the head's own scalar codegen emits the complex
    // lowering. Verified against interpretation — `2·[1+i, 3+i]` is
    // `[2+2i, 6+2i]`. Before the element parameters could carry complexness
    // this declined with the same "list-valued operand" diagnostic as the
    // mixed case above, which is what made a promoting mode lose
    // whole-collection arithmetic over a radical body (ROADMAP 2026-08-15).
    const r = compile(
      ce.box(['Multiply', 2, ['List', ['Complex', 1, 1], ['Complex', 3, 1]]]),
      { constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual([
      { re: 2, im: 2 },
      { re: 6, im: 2 },
    ]);
  });

  test('unary broadcast over a list still compiles (Sin)', () => {
    const r = compile(ce.box(['Sin', ['List', 't', 1]]));
    expect(r.success).toBe(true);
    const out = r.run!({ t: 0 }) as unknown as number[];
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(Math.sin(1));
  });
});

describe('Compilation fallback — numeric value of a symbolic evaluation', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  // `evaluate()` correctly stays symbolic for an exact argument (the
  // exactness contract), and `.re` of a symbolic expression is NaN. The
  // fallback runner must numericize (`.N()`) so a decline still returns the
  // interpreter's value — that is the entire point of declining instead of
  // emitting wrong code.
  test('declined infinite Sum runs to its numeric value, not NaN', () => {
    const e = ce.parse('\\sum_{i=1}^{\\infty} 2^{-i}');
    // `constantFold: false`: the sum has no free variables, so compile-time
    // constant folding would emit `1` as a literal and report success — the
    // decline whose fallback runner is under test would never happen.
    const r = compile(e, { constantFold: false });
    expect(r.success).toBe(false);
    expect(r.run!({})).toBe(1);
  });

  test('scalar fallback whose evaluation stays symbolic numericizes', () => {
    // Forced fallback: evaluate() → Ln(2) (symbolic); run must give the float
    const r = compile(ce.parse('\\ln(2)'), FORCE);
    expect(r.success).toBe(false);
    expect(r.run!({})).toBeCloseTo(Math.LN2, 12);
  });

  test('collection fallback numericizes symbolic elements', () => {
    const r = compile(ce.box(['List', ['Ln', 2], ['Sqrt', 2]]), FORCE);
    expect(r.success).toBe(false);
    const out = r.run!({}) as unknown as number[];
    expect(out[0]).toBeCloseTo(Math.LN2, 12);
    expect(out[1]).toBeCloseTo(Math.SQRT2, 12);
  });

  test('lambda fallback numericizes a symbolic application', () => {
    // Apply(Function(Ln(x)), 2).evaluate() → Ln(2), symbolic
    const r = compile(ce.expr(['Function', ['Ln', 'x'], 'x']), FORCE);
    expect(r.calling).toBe('lambda');
    expect(r.run!(2)).toBeCloseTo(Math.LN2, 12);
  });
});

describe('Compilation fallback — interval-js declines still provide `run`', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  // The interval target's primary failure class returns `success: false`
  // WITHOUT throwing, so the free function must pass `fallback` through for
  // the target to normalize it — otherwise the result had no `run` at all.
  test('declined infinite Sum yields an interval-shaped interpreter run', () => {
    const e = ce.parse('\\sum_{i=1}^{\\infty} 2^{-i}');
    const r = compile(e, { to: 'interval-js' });
    expect(r.success).toBe(false);
    expect(typeof r.run).toBe('function');
    expect(r.run!({})).toEqual({ kind: 'interval', value: { lo: 1, hi: 1 } });
  });

  test('fallback: false surfaces the raw decline (no interpreter run)', () => {
    // Opting out of the fallback throws the decline of the interval mode.
    const e = ce.parse('\\sum_{i=1}^{\\infty} 2^{-i}');
    let error: unknown;
    try {
      compile(e, { to: 'interval-js', fallback: false });
    } catch (err) {
      error = err;
    }
    expect(isCompileDeclineError(error)).toBe(true);
    expect(compileDiagnosticOf(error).code).toBe('outside-profile');
    expect(compileDiagnosticOf(error).value).toBe('+oo');
  });
});

describe('Compilation fallback — the inputs are the definitions the expression reads', () => {
  test('an expression boxed in a popped scope reads its own x', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('x', 'real');
    const e = ce.box(['Add', ['Gamma', 'x'], 0]);
    const r = compile(e, FORCE as any);
    ce.popScope();
    expect(r.success).toBe(false);
    expect(r.run!({ x: 5 })).toBe(24);
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  test('a run in a scope that declares another x gives the value to the x of the expression', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.box(['Gamma', 'x']);
    const r = compile(e, FORCE as any);
    ce.pushScope();
    ce.declare('x', 'real');
    try {
      expect(r.run!({ x: 5 })).toBe(24);
    } finally {
      ce.popScope();
    }
  });
});

describe('Compilation fallback — an input read in a held operand', () => {
  function engineWithHolds(): ComputeEngine {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'hold ev(e) = e + 1\nhold mySum(body, bind i, n) = Sum(body, (i, 1, n))'
    );
    ce.declare('x', 'real');
    ce.declare('Tw', {
      signature: '(any) -> real',
      lazy: true,
      evaluate: (ops, { engine }) =>
        engine.box(['Multiply', 2, ops[0]]).evaluate(),
    });
    return ce;
  }
  test.each([
    [['ev', ['Multiply', 'x', 'x']], 5, 10],
    [['mySum', ['Multiply', 'k', 'x'], 'k', 3], 12, 18],
    [['Tw', ['Multiply', 'x', 'x']], 8, 18],
    [['Add', ['ReleaseHold', ['Hold', ['Totient', 'x']]], 0], 1, 2],
  ])('%j', (input, at2, at3) => {
    const ce = engineWithHolds();
    const r = compile(ce.box(input as any), FORCE as any);
    expect(r.success).toBe(false);
    expect(r.run!({ x: 2 })).toBe(at2);
    expect(r.run!({ x: 3 })).toBe(at3);
  });
});
