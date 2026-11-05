/**
 * A call of a user function whose body contradicts its declared result
 * declines on JavaScript.
 *
 * The compiler types a call from the declared result. When the body
 * computes a value of another type, the compiled code used to run with that
 * value and give a wrong result:
 *
 * - `g: (x: number) -> number` and `g := t ↦ t > 0`: `g(b) + 1` gave `2`
 *   (`true + 1`). The interpreter gives an `incompatible-type` error.
 * - `g: (x: T) -> T where T: broadcastable<number>`, `g := t ↦ (t, t^2)` and
 *   `x: list<real>`: `Sum(Rest(g(x)))` gave the string `"02,43,9"`. The
 *   interpreter does not check the result of a generic function against its
 *   declaration, and gives `(5, 13)`.
 *
 * The body contradicts the result when the type of the value it computes
 * has no value in common with the declared result, or when the result is a
 * scalar and the body constructs a collection. A generic result that is the
 * type of a parameter is read for one application to a scalar. A call that
 * maps the function over the elements of a list argument applies it to
 * scalars, so it declines too.
 *
 * Witness: Tycho ledger row 491 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`), with
 * the instrument
 * `~/dev/tycho/scripts/repros/2026-11-04-ce491-generic-result-type-unchecked-repro.mts`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const GENERIC = '(x: T) -> T where T: broadcastable<number>';
const BOOLEAN_BODY = ['Greater', 't', 0];
const POINT_BODY = ['Tuple', 't', ['Power', 't', 2]];

/** `g` declared with `signature` (or as a bare `function` when `null`),
 * then assigned `t ↦ body`; `x: list<real>` and `b: real`. */
function engineWith(signature: string | null, body: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  if (signature === null) ce.declare('g', 'function');
  else ce.declare('g', { signature });
  ce.declare('x', 'list<real>');
  ce.declare('b', 'real');
  ce.assign('g', ce.box(['Function', body, 't'] as any));
  return ce;
}

function compiled(ce: ComputeEngine, expr: unknown): any {
  return compile(ce.box(expr as any), {
    to: 'javascript',
    fallback: true,
  } as any);
}

const SUM_REST = ['Sum', ['Rest', ['g', 'x']]];
const SCALAR_CALL = ['Add', ['g', 'b'], 1];

describe('a body that contradicts the declared result declines', () => {
  test.each([
    ['(x: number) -> number', BOOLEAN_BODY],
    ['(x: real) -> real', BOOLEAN_BODY],
    ['(x: broadcastable<number>) -> broadcastable<number>', BOOLEAN_BODY],
    ['(x: T) -> T where T: number', BOOLEAN_BODY],
    [GENERIC, BOOLEAN_BODY],
  ] as [string, unknown][])(
    '`g(b) + 1` with `g: %s` and a boolean body',
    (signature, body) => {
      const ce = engineWith(signature, body);
      // The interpreter refuses the value of the call.
      expect(ce.box(['Add', ['g', 3], 1] as any).evaluate().operator).toBe(
        'Error'
      );
      const r = compiled(ce, SCALAR_CALL);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /but its body computes a value of type 'boolean'/
      );
    }
  );

  test.each([
    ['(x: number) -> number', POINT_BODY],
    ['(x: number) -> number', BOOLEAN_BODY],
    ['(x: T) -> T where T: number', POINT_BODY],
    [GENERIC, POINT_BODY],
    [GENERIC, BOOLEAN_BODY],
  ] as [string, unknown][])(
    '`Sum(Rest(g(x)))` with `g: %s` maps the body over a list',
    (signature, body) => {
      const ce = engineWith(signature, body);
      const r = compiled(ce, SUM_REST);
      expect(r.success).toBe(false);
    }
  );

  test('the generic point body: the interpreter value that the compiled code missed', () => {
    const ce = engineWith(GENERIC, POINT_BODY);
    const value = ce
      .box(['Sum', ['Rest', ['g', ['List', 1, 2, 3]]]] as any)
      .evaluate();
    expect(value.json).toEqual(['Tuple', 5, 13]);
    expect(compiled(ce, ['g', 'x']).success).toBe(false);
  });

  test.each(['glsl', 'wgsl', 'interval-js'])(
    'a boolean body under `-> number` declines on %s',
    (to) => {
      const ce = engineWith('(x: number) -> number', BOOLEAN_BODY);
      const r: any = compile(ce.box(SCALAR_CALL as any), {
        to,
        fallback: true,
      } as any);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /Could not compile `g`: .* but its body computes a value of type 'boolean'/
      );
    }
  );

  test('a list bound whole: a boolean body under `-> number` declines', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(xs: list<real>) -> number' });
    ce.declare('x', 'list<real>');
    ce.assign(
      'g',
      ce.box(['Function', ['Greater', ['Length', 'xs'], 0], 'xs'] as any)
    );
    const r = compiled(ce, ['Add', ['g', 'x'], 1]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/but its body computes a value of type 'boolean'/);
  });

  test('a call with no argument: a boolean body under `-> number` declines', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '() -> number' });
    ce.declare('c', 'real');
    ce.assign('g', ce.box(['Function', ['Greater', 'c', 0]] as any));
    const r = compiled(ce, ['Add', ['g'], 1]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/but its body computes a value of type 'boolean'/);
  });

  test('a function value: `Map(x, g)` with a boolean body declines', () => {
    const ce = engineWith('(x: number) -> number', BOOLEAN_BODY);
    const r = compiled(ce, ['Sum', ['Map', 'g', 'x']]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(
      /Could not compile the function value `g`: .* but its body computes a value of type 'boolean'/
    );
  });
});

describe('controls: a body that meets the declared result still compiles', () => {
  test('a generic scalar body maps over a list', () => {
    const ce = engineWith(GENERIC, ['Multiply', 2, 't']);
    const r = compiled(ce, SUM_REST);
    expect(r.success).toBe(true);
    expect(r.run({ x: [1, 2, 3] })).toBe(10);
  });

  test('a ground scalar body in a scalar call', () => {
    const ce = engineWith('(x: number) -> number', ['Multiply', 2, 't']);
    const r = compiled(ce, SCALAR_CALL);
    expect(r.success).toBe(true);
    expect(r.run({ b: 3 })).toBe(7);
  });

  test('a ground boolean result with a boolean body', () => {
    const ce = engineWith('(x: number) -> boolean', BOOLEAN_BODY);
    const r = compiled(ce, ['g', 'b']);
    expect(r.success).toBe(true);
    expect(r.run({ b: 3 })).toBe(true);
  });

  test('a bare `function` declaration types the call from the body', () => {
    const ce = engineWith(null, POINT_BODY);
    const r = compiled(ce, SUM_REST);
    expect(r.success).toBe(true);
    expect(r.run({ x: [1, 2, 3] })).toEqual([5, 13]);
  });

  test('a `Return` before the last statement: the last statement is not read', () => {
    const ce = engineWith('(x: number) -> number', [
      'Block',
      ['Return', 0],
      ['Greater', 't', 0],
    ]);
    const r = compiled(ce, SCALAR_CALL);
    expect(r.success).toBe(true);
    expect(r.run({ b: 3 })).toBe(1);
  });
});
