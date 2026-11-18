/**
 * CE-712.2, phase A: an input or a parameter DECLARED with a union of
 * shapes (`U: real | list<real>`,
 * `P: tuple<real, real> | list<tuple<real, real>>`,
 * `k: (number | list<number>) -> unknown`) is compiled once per member,
 * and the code tests the shape of the value once, at the input or at the
 * entry of the function, to select the body for that member.
 *
 * Before, one body read both shapes, and two values were wrong:
 * - `f(U)` with `f := t ↦ 2t + 1`, `U = [1, 2]`: interval-js gave the empty
 *   interval, the interpreter gives `[3, 5]`.
 * - `w(P)` with `w := (p: tuple<number, number>) ↦ p[1] + p[2]`,
 *   `P = [(1, 2), (3, 4)]`: javascript threw ("the element read is a list
 *   at run time") and interval-js gave the whole real line, the interpreter
 *   gives `[3, 7]`. With a parameter that only the body reads by index
 *   (`w := p ↦ p[1] + p[2]`), the list is taken whole and the value is
 *   `(4, 6)` (user decision 2026-11-14); interval-js declines it.
 *
 * The compilation declines, with the names of the inputs in `unsupported`,
 * when no run-time test tells the members apart (a point of two reals and
 * a list of two reals are both `[a, b]`), or when the inputs need more than
 * four bodies.
 *
 * Design: rules R2 and R4 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type Value = number | Value[];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('L', 'list<real>');
  ce.declare('Q', 'list<tuple<real, real>>');
  ce.declare('pt', 'tuple<real, real>');
  ce.declare('U', 'real | list<real>');
  ce.declare('V', 'real | list<real>');
  ce.declare('W', 'real | list<real>');
  ce.declare('P', 'tuple<real, real> | list<tuple<real, real>>');
  ce.declare('T', 'tuple<real, real> | list<real>');
  ce.parse('f(t) := 2t + 1').evaluate();
  ce.declare('w', 'function');
  ce.assign('w', ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p']));
  return ce;
}

/** The MathJSON of a value: a nested array is a list, a point a tuple. */
function boxed(v: Value, point: boolean): unknown {
  if (!Array.isArray(v)) return v;
  if (point && v.length > 0 && v.every((e) => !Array.isArray(e)))
    return ['Tuple', ...v];
  return ['List', ...v.map((e) => boxed(e, point))];
}

/** The JavaScript value of a number, a list or a tuple of the engine. */
function plain(e: Expression): Value {
  if (e.operator === 'List' || e.operator === 'Tuple')
    return e.ops!.map(plain);
  return e.re;
}

/**
 * The value that the interpreter gives for `expr` with the inputs `vars`.
 * An input in `points` holds points: its innermost arrays are tuples.
 */
function interpreted(
  ce: ComputeEngine,
  expr: Expression,
  vars: Record<string, Value>,
  points: ReadonlyArray<string> = []
): Value {
  const subs: Record<string, Expression> = {};
  for (const [name, v] of Object.entries(vars))
    subs[name] = ce.box(boxed(v, points.includes(name)) as any);
  return plain(expr.subs(subs).evaluate());
}

/**
 * The diagnostic code of the decline of `expr` on `to`, with no fallback:
 * a target throws the decline or returns it. `undefined` when the
 * compilation succeeds.
 */
function declineCode(
  expr: Expression,
  to: 'javascript' | 'interval-js'
): string | undefined {
  try {
    const r = compile(expr, { to, fallback: false });
    return r.success ? undefined : (r.diagnostic?.code ?? '');
  } catch (e) {
    return (e as { diagnostic?: { code?: string } }).diagnostic?.code ?? '';
  }
}

describe('CE-712.2: an input declared with a union of shapes', () => {

  test('a list of points read by index declines on interval-js', () => {
    // The parameter of `w` takes a list of points whole (user decision
    // 2026-11-14), so the call is `P[1] + P[2]`, a point. The interval
    // value is a number, and `_IA.at` of a list of points answers `entire`:
    // the call and the direct reads decline.
    const ce = engine();
    for (const e of [
      ['w', 'P'],
      ['w', 'Q'],
      ['Add', ['At', 'P', 1], ['At', 'P', 2]],
      ['Add', ['At', 'Q', 1], ['At', 'Q', 2]],
    ])
      expect(declineCode(ce.box(e as never), 'interval-js')).toBeDefined();
  });

  test('a list of points at a parameter that the body reads by index', () => {
    // The same call with an input declared `list<tuple<real, real>>`: the
    // parameter takes the list whole, and both routes add the two points.
    const ce = engine();
    const expr = ce.box(['w', 'Q']);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ Q: [[1, 2], [3, 4]] } as any)).toEqual([4, 6]);
    expect(interpreted(ce, expr, { Q: [[1, 2], [3, 4]] }, ['Q'])).toEqual([
      4, 6,
    ]);
  });
});

describe('CE-712.2: the declines of a declared union', () => {
  test.each(['javascript', 'interval-js'] as const)(
    '%s: no run-time test tells the members apart',
    (to) => {
      // A point of two reals and a list of two reals are both `[a, b]`.
      const ce = engine();
      const expr = ce.box(['Add', ['At', 'T', 1], 1]);
      // A union of shapes at an input declines as outside the profile, and
      // the input is named in `value`.
      expect(declineCode(expr, to)).toBe('outside-profile');
      expect(compile(expr, { to }).diagnostic?.value).toBe('T');
    }
  );

  test.each(['javascript', 'interval-js'] as const)(
    '%s: more than four bodies',
    (to) => {
      // Three inputs of two members each need eight bodies.
      const ce = engine();
      const expr = ce.box(['Add', 'U', 'V', 'W']);
      // The compilation declines at the first input of a union of shapes,
      // as outside the profile.
      expect(declineCode(expr, to)).toBe('outside-profile');
      expect(compile(expr, { to }).diagnostic?.value).toBe('U');
    }
  );
});

describe('CE-712.2: a parameter declared with a union of shapes', () => {
  function withFunctions(): ComputeEngine {
    const ce = engine();
    const def = (name: string, signature: string, body: unknown) => {
      ce.declare(name, signature);
      ce.assign(name, ce.box(['Function', body as any, 'z']));
    };
    def('kk', '(number | list<number>) -> unknown', [
      'Add',
      ['Multiply', 2, 'z'],
      1,
    ]);
    def('kp', '(tuple<real, real> | list<tuple<real, real>>) -> unknown', [
      'Add',
      ['At', 'z', 1],
      ['At', 'z', 2],
    ]);
    def('k', '(number | list<number>) -> number', ['Length', 'z']);
    def('kn', '(tuple<real, real> | list<real>) -> unknown', [
      'Multiply',
      2,
      'z',
    ]);
    return ce;
  }

  test('a variant that the target cannot compile: the fallback value', () => {
    // `Length` of a number is an error in the interpreter, and its variant
    // for the member `number` does not compile, so the definition of `k`
    // declines. The fallback gives the interpreter value.
    const ce = withFunctions();
    const expr = ce.box(['k', 'L']);
    expect(compile(expr).run!({ L: [1, 2, 5] } as any)).toBe(3);
  });
});

describe('CE-712.2: absent values and deeper lists at a declared union', () => {
  // `f: (real) -> real`, so the interpreter maps the call over a list.
  function absentEngine(type: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(real) -> real' });
    ce.assign('f', ce.parse('t \\mapsto 2t+1'));
    ce.declare('L', type);
    return ce;
  }

  /** The interpreter value of `f(L)` for the MathJSON value `value` of `L`. */
  function interpretedWith(type: string, value: unknown): unknown {
    const ce = absentEngine(type);
    ce.assign('L', ce.box(value as any));
    const r = ce.parse('f(L)').evaluate();
    return r.isNaN ? NaN : plain(r);
  }

  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
  // is a result only"), so a declared union has no absent member.
  test('a union with a `missing` member cannot be declared', () => {
    expect(() => absentEngine('list<real> | list<list<real>> | missing')).toThrow(
      /cannot be declared/
    );
  });

  test.each(['javascript', 'interval-js'] as const)(
    '%s: a list of lists with an empty first row and a list of depth 3 decline',
    (to) => {
      // `[[], [1, 2]]` is a value of `list<list<real>>`, and the test of
      // the first element reads its empty first row as a value of depth 3:
      // the rank-3 map read 1 and 2 as lists.
      const type = 'list<list<real>> | list<list<list<real>>>';
      const ce = absentEngine(type);
      expect(declineCode(ce.parse('f(L)'), to)).toBe('outside-profile');
      if (to !== 'javascript') return;
      const r = compile(ce.parse('f(L)'));
      const v: Value = [[], [1, 2]];
      expect(interpretedWith(type, boxed(v, false))).toEqual([[], [3, 5]]);
      // The fallback evaluates with the interpreter, and can return an
      // expression.
      const out: any = r.run!({ L: v } as any);
      expect(out?.operator ? plain(out) : out).toEqual([[], [3, 5]]);
    }
  );
});

describe('CE-712.2: `nothing` in a declared union of a list and a number', () => {

  test.each(['javascript', 'interval-js'] as const)(
    '%s: the decline names the members that are the same array',
    (to) => {
      const ce = engine();
      const r = compile(ce.box(['Add', ['At', 'T', 1], 1]), { to });
      expect(r.success).toBe(false);
      // The input is declined as outside the profile.
      expect(r.diagnostic?.code).toBe('outside-profile');
      expect(r.diagnostic?.value).toBe('T');
    }
  );
});
