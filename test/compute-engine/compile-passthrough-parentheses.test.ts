import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * An IDENTITY ("passthrough") lowering — a compile handler whose emission is
 * its operand's own code, with nothing wrapped around it — must parenthesize
 * an operand that lowers to an infix expression.
 *
 * The shared compiler splices the emission of a function head into its parent
 * without parentheses, because a head normally emits a CALL and a call binds
 * tighter than every infix operator. An identity lowering breaks that
 * assumption, so the parent's operator captures only the last term of the
 * operand: `3·⌊n + 1⌋` over an integer `n` emitted `3.0 * n + 1.0`, which is
 * `3n + 1` — a wrong value behind a reported success.
 *
 * Each case puts the passthrough inside a TIGHTER parent (`3 · …`, or a
 * Python `… ** 2`), so a missing pair of parentheses changes the value. The
 * negative controls pin that an ATOMIC operand — a symbol — still emits bare,
 * which is what keeps the existing emissions unchanged.
 */

/** Compile-time folding off: a folded subtree would erase the codegen here. */
const NO_FOLD = { constantFold: false } as const;

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();
const python = new PythonTarget();

function makeEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('u', 'real');
  // `Abs` passes its operand through only when the operand is provably
  // non-negative, which is what this assumption establishes.
  ce.assume(ce.box(['GreaterEqual', 'u', 0]));
  ce.declare('x', 'real');
  ce.declare('z', 'complex');
  ce.declare('w', 'complex');
  return ce;
}

const ce = makeEngine();

/** `k · head(sym + 1)` — the passthrough inside a tighter parent. */
function scaled(k: number, head: string, sym: string, extra: unknown[] = []) {
  return ce.box([
    'Multiply',
    k,
    [head, ['Add', sym, 1], ...extra] as never,
  ] as never);
}

/** `k · head(sym)` — the same parent over an ATOMIC operand. */
function scaledAtom(k: number, head: string, sym: string) {
  return ce.box(['Multiply', k, [head, sym] as never] as never);
}

describe('IDENTITY PASSTHROUGH PARENTHESES — GPU (GLSL and WGSL)', () => {
  // `Floor`/`Ceil`/`Round`/`Truncate` of an INTEGER-valued operand, `Abs` of a
  // NON-NEGATIVE one, `Real`/`Conjugate` of a REAL one: each returns the
  // operand's code unchanged.
  const cases: Array<
    [label: string, head: string, sym: string, extra?: unknown[]]
  > = [
    ['Floor of an integer', 'Floor', 'n'],
    ['Ceil of an integer', 'Ceil', 'n'],
    ['Truncate of an integer', 'Truncate', 'n'],
    ['Round of an integer', 'Round', 'n'],
    ['Round of an integer to n places', 'Round', 'n', [2]],
    ['Abs of a non-negative real', 'Abs', 'u'],
    ['Real of a real', 'Real', 'x'],
    ['Conjugate of a real', 'Conjugate', 'x'],
    ['Max of one operand', 'Max', 'x'],
    ['Min of one operand', 'Min', 'x'],
  ];

  for (const [label, head, sym, extra] of cases) {
    test(`${label}: the infix operand is parenthesized`, () => {
      const expr = scaled(3, head, sym, extra ?? []);
      expect(glsl.compile(expr, NO_FOLD).code).toBe(`3.0 * (${sym} + 1.0)`);
      expect(wgsl.compile(expr, NO_FOLD).code).toBe(`3.0 * (${sym} + 1.0)`);
    });
  }

  test('WithRandomSeed: the body is parenthesized', () => {
    const expr = ce.box([
      'Multiply',
      3,
      ['WithRandomSeed', 1, ['Add', 'x', 1]],
    ]);
    expect(glsl.compile(expr, NO_FOLD).code).toBe('3.0 * (x + 1.0)');
    expect(wgsl.compile(expr, NO_FOLD).code).toBe('3.0 * (x + 1.0)');
  });

  // A postfix swizzle binds tighter than every infix operator, so a complex
  // operand that lowered to the promote-and-add form (` + `-joined `vec2`
  // terms) took the suffix on its LAST term alone.
  test('Argument of a complex sum: the swizzled operand is parenthesized', () => {
    const expr = ce.box(['Argument', ['Add', 'z', 'w']]);
    expect(glsl.compile(expr, NO_FOLD).code).toBe('atan((w + z).y, (w + z).x)');
  });

  test('Conjugate of a complex sum: the swizzled operand is parenthesized', () => {
    const expr = ce.box(['Conjugate', ['Add', 'z', 'w']]);
    expect(glsl.compile(expr, NO_FOLD).code).toBe(
      'vec2((w + z).x, -(w + z).y)'
    );
  });

  describe('negative control — an atomic operand stays bare', () => {
    for (const [head, sym] of [
      ['Floor', 'n'],
      ['Ceil', 'n'],
      ['Truncate', 'n'],
      ['Round', 'n'],
      ['Abs', 'u'],
      ['Real', 'x'],
      ['Conjugate', 'x'],
      ['Max', 'x'],
      ['Min', 'x'],
    ] as const) {
      test(`${head} of a symbol`, () => {
        const expr = scaledAtom(3, head, sym);
        expect(glsl.compile(expr, NO_FOLD).code).toBe(`3.0 * ${sym}`);
        expect(wgsl.compile(expr, NO_FOLD).code).toBe(`3.0 * ${sym}`);
      });
    }
  });
});

describe('IDENTITY PASSTHROUGH PARENTHESES — Python', () => {
  test('Identity: the infix operand is parenthesized', () => {
    const expr = ce.box(['Multiply', 3, ['Identity', ['Add', 'x', 1]]]);
    expect(python.compile(expr, NO_FOLD).code).toBe('3 * (x + 1)');
  });

  // Python's `**` binds TIGHTER than the unary minus, so a bare `-x ** 2` is
  // `-(x²)` — the wrong value, not just a redundant grouping.
  test('Identity of a negation under a power', () => {
    const expr = ce.box(['Power', ['Identity', ['Negate', 'x']], 2]);
    expect(python.compile(expr, NO_FOLD).code).toBe('(-x) ** 2');
  });

  // A NEGATIVE number literal is not a Python primary either: the same
  // precedence puts `-2 ** 2` at −4. A one-operand `Max` over a negative
  // literal is reachable when a `Sum` unroll substitutes a negative index.
  test('a negative literal under a power is parenthesized', () => {
    for (const head of ['Identity', 'Max']) {
      const expr = ce.box(['Power', [head, -2] as never, 2]);
      expect(python.compile(expr, NO_FOLD).code).toBe('(-2) ** 2');
    }
  });

  test('Max of one operand: the infix operand is parenthesized', () => {
    const expr = ce.box(['Multiply', 3, ['Max', ['Add', 'x', 1]]]);
    expect(python.compile(expr, NO_FOLD).code).toBe('3 * (x + 1)');
  });

  test('Min of one operand: the infix operand is parenthesized', () => {
    const expr = ce.box(['Multiply', 3, ['Min', ['Add', 'x', 1]]]);
    expect(python.compile(expr, NO_FOLD).code).toBe('3 * (x + 1)');
  });

  describe('negative control — an atomic operand stays bare', () => {
    test('Identity of a symbol', () => {
      const expr = ce.box(['Multiply', 3, ['Identity', 'x']]);
      expect(python.compile(expr, NO_FOLD).code).toBe('3 * x');
    });

    test('Max of a symbol', () => {
      const expr = ce.box(['Multiply', 3, ['Max', 'x']]);
      expect(python.compile(expr, NO_FOLD).code).toBe('3 * x');
    });

    // A COLLECTION operand of a one-operand `Max` is a REDUCTION, not a
    // passthrough: it already carries its own `np.max(…)` call.
    test('Max of a list reduces and needs no parentheses', () => {
      const expr = ce.box(['Multiply', 3, ['Max', ['List', 1, 2, 3]]]);
      expect(python.compile(expr, NO_FOLD).code).toBe('3 * np.max([1, 2, 3])');
    });
  });
});

describe('IDENTITY PASSTHROUGH PARENTHESES — interval-js has no infix', () => {
  // The interval target maps every operator to an `_IA.*` CALL (its
  // `operators` hook always answers `undefined`), so no emission of that
  // target can be captured by a surrounding operator and the defect class
  // does not arise there. These pin that the arithmetic really is calls.
  test('a scaled Floor stays a nest of calls', () => {
    const expr = ce.box(['Multiply', 3, ['Floor', ['Add', 'n', 1]]]);
    const r = compile(expr, { to: 'interval-js', constantFold: false });
    expect(r.code).toBe(
      '_IA.scale(_IA.point(3), _IA.floor(_IA.add(_.n, _IA.point(1))))'
    );
  });

  test('a scaled one-operand Max stays a nest of calls', () => {
    const expr = ce.box(['Multiply', 3, ['Max', ['Add', 'x', 1]]]);
    const r = compile(expr, { to: 'interval-js', constantFold: false });
    expect(r.code).toBe('_IA.scale(_IA.point(3), _IA.add(_.x, _IA.point(1)))');
  });
});
