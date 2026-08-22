import { ComputeEngine } from '../../src/compute-engine';

/**
 * A symbol occurrence evaluated inside a user-function call frame never reads
 * a same-named PARAMETER of that frame unless the parameter is its own
 * binding: the value walk skips a call frame's parameter activation of any
 * other binding (`valueDefinitionInContext`, `boxed-expression/binders.ts`;
 * `docs/SCOPING-MODEL.md` §"Symbol identity").
 *
 * The failure this pins: applying `f(x) := cos(x)` as `f(3x)` binds the
 * frame's parameter `x` to `3x`, whose `x` is the CALLER's. Dereferencing the
 * parameter answers `3x` correctly, but the `Cos` handler evaluates that
 * `3x` once more inside the frame, and by-name resolution read the caller's
 * `x` as the parameter again: `9x`. Handlers that discard the re-evaluation
 * hid the capture; handlers that use it answered wrong (`24x` for a sum
 * worth `12x`); and a parameter value that itself contains an application
 * re-evaluating its operand — `f(f(x))`, or a twice-recursive definition at
 * depth 3 — recursed until the stack overflowed.
 */

/** Evaluate `expr` under `defs`, each definition evaluated in order. */
function evaluate(defs: string[], expr: string) {
  const ce = new ComputeEngine();
  for (const d of defs) ce.parse(d).evaluate();
  return ce.parse(expr).evaluate();
}

describe('A parameter value mentioning the parameter’s own name', () => {
  test('a big-op body reads the argument once, not per re-evaluation', () => {
    // 2x · (1 + 2 + 3). By-name resolution answered `24x`.
    expect(
      evaluate([String.raw`f(x) := \sum_{k=1}^{3} x k`], 'f(2x)').toString()
    ).toBe('12x');
  });

  test('a nested user-function call receives the argument once', () => {
    // 2 · 3x + 1. By-name resolution answered `18x + 1`.
    expect(
      evaluate([String.raw`g(x) := 2x`, String.raw`f(x) := g(x)+1`], 'f(3x)')
        .toString()
    ).toBe('6x + 1');
    // cos(3 · 2x). By-name resolution answered `cos(12x)`.
    expect(
      evaluate(
        [String.raw`g(x) := \cos(x)`, String.raw`f(x) := g(3x)`],
        'f(2x)'
      ).toString()
    ).toBe('cos(6x)');
    // By-name resolution answered `cos(2(x + 2)) + cos(x + 2)`.
    expect(
      evaluate(
        [String.raw`g(x) := \cos(x)`, String.raw`f(x) := g(x)+g(2x)`],
        'f(x+1)'
      ).toString()
    ).toBe('cos(2(x + 1)) + cos(x + 1)');
  });

  test('a handler that re-evaluates its operand still answers the argument', () => {
    expect(
      evaluate([String.raw`f(x) := \cos(x)`], 'f(3x)').toString()
    ).toBe('cos(3x)');
    expect(
      evaluate([String.raw`f(x) := \cos(x)`], 'f(3x)').N().toString()
    ).toBe('cos(3x)');
  });

  test('an argument containing an application of the same operator terminates', () => {
    // Each of these overflowed the call stack under by-name resolution.
    expect(
      evaluate([String.raw`f(x) := \cos(x)`], 'f(\\sin(x))').toString()
    ).toBe('cos(sin(x))');
    expect(
      evaluate([String.raw`f(x) := \cos(x)`], 'f(f(x))').toString()
    ).toBe('cos(cos(x))');
    expect(
      evaluate([String.raw`f(x) := \cos(x)+1`], 'f(f(f(2x)))').toString()
    ).toBe('cos(cos(cos(2x) + 1) + 1) + 1');
    expect(
      evaluate(
        [String.raw`f(x) := \operatorname{abs}(\sin(x))`],
        'f(f(x))'
      ).toString()
    ).toBe('|sin(|sin(x)|)|');
  });

  test('a caller-scope value of the same name is still read', () => {
    expect(
      evaluate([String.raw`f(x) := \cos(x)`, 'x := 2'], 'f(3x)').toString()
    ).toBe('cos(6)');
  });
});

/**
 * Tycho's twice-recursive document function: `R(i,x,y) = R(i-1,x,y) +
 * 0.5·S(x,y,R(i-1,x,y))` with a literal base case, declared then assigned a
 * clause-dispatch literal, the parameter renamed away from the imaginary
 * unit. With `x`, `y` FREE, depth 3 overflowed the stack: the value bound
 * to `G`'s parameter `x` contained `cos(3x)`, whose re-evaluation inside
 * `G`'s frame substituted the parameter into itself without end.
 */
function recursiveSetup(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const d of [
    String.raw`G(x,y,z) := \operatorname{abs}(\sin(x)\cos(y)+\sin(y)\cos(z)+\sin(z)\cos(x))`,
    String.raw`C(x,y,z) := \max(\operatorname{abs}(x),\operatorname{abs}(y),\operatorname{abs}(z-6))-3`,
    String.raw`S(x,y,l) := \max(G(2lx,2ly,2l),C(lx,ly,l))`,
  ])
    ce.parse(d).evaluate();
  ce.declare('R', '(number, number, number) -> number');
  const P = 'i_recparam0';
  ce.pushScope();
  ce.declare(P, { type: 'unknown' });
  ce.declare('x', { type: 'unknown' });
  ce.declare('y', { type: 'unknown' });
  const general = ce.box(
    [
      'Add',
      ['R', ['Subtract', P, 1], 'x', 'y'],
      ['Multiply', 0.5, ['S', 'x', 'y', ['R', ['Subtract', P, 1], 'x', 'y']]],
    ],
    { form: 'structural' }
  ).canonical.json;
  ce.popScope();
  ce.assign(
    'R',
    ce.box([
      'Function',
      ['Which', ['Equal', P, 0], 0, 'True', general],
      P,
      'x',
      'y',
    ])
  );
  return ce;
}

describe('Symbolic evaluation of a twice-recursive user function', () => {
  test('R(3,x,y) with free x, y evaluates to a closed form', () => {
    const ce = recursiveSetup();
    const closed = ce.parse('R(3,x,y)').evaluate();
    expect(closed.isValid).toBe(true);
    expect(closed.operator).toBe('Add');
    expect(closed.unknowns.sort()).toEqual(['x', 'y']);
    // The closed form agrees with the numeric route at a sample point.
    const direct = ce.parse('R(3,0.3,0.7)').N().re;
    expect(closed.subs({ x: 0.3, y: 0.7 }).N().re).toBeCloseTo(direct, 9);
    // Depth 2 is the 42-node form that always evaluated; depth 3 nests it.
    expect(ce.parse('R(2,x,y)').evaluate().toString()).toBe(
      '0.5 * max(|sin(3) * cos(3x) + sin(3y) * cos(3) + sin(3x) * cos(3y)|, max(4.5, |1.5 * x|, |1.5 * y|) - 3) + 1.5'
    );
  });
});
