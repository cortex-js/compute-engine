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
      evaluate(
        [String.raw`g(x) := 2x`, String.raw`f(x) := g(x)+1`],
        'f(3x)'
      ).toString()
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
    expect(evaluate([String.raw`f(x) := \cos(x)`], 'f(3x)').toString()).toBe(
      'cos(3x)'
    );
    expect(
      evaluate([String.raw`f(x) := \cos(x)`], 'f(3x)')
        .N()
        .toString()
    ).toBe('cos(3x)');
  });

  test('an argument containing an application of the same operator terminates', () => {
    // Each of these overflowed the call stack under by-name resolution.
    expect(
      evaluate([String.raw`f(x) := \cos(x)`], 'f(\\sin(x))').toString()
    ).toBe('cos(sin(x))');
    expect(evaluate([String.raw`f(x) := \cos(x)`], 'f(f(x))').toString()).toBe(
      'cos(cos(x))'
    );
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
 * unit. With `x`, `y` FREE, depth 3 used to overflow the stack (the capture
 * above); with the capture fixed, the closed form was correct but grew ~10×
 * per level (depth 4: 12 000 characters; depth 5 never finished), so a
 * recursive definition is now NOT UNROLLED symbolically (ruled 2026-08-22):
 * a re-entrant application with an argument containing a free symbol declines
 * the outermost application, which stays as written (`SymbolicRecursion`,
 * `function-utils.ts`).
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

describe('Symbolic evaluation of a recursive user function is not unrolled', () => {
  test('R(3,x,y) and R(8,x,y) with free x, y stay as written, instantly', () => {
    const ce = recursiveSetup();
    for (const n of [1, 3, 8]) {
      const t0 = performance.now();
      const r = ce.parse(`R(${n},x,y)`).evaluate();
      expect(r.isValid).toBe(true);
      expect(r.json).toEqual(['R', n, 'x', 'y']);
      // Depth 8 would be a ~10⁷-character closed form; the decline is
      // immediate. Generous bound so a loaded machine cannot fail it.
      expect(performance.now() - t0).toBeLessThan(2000);
    }
    // The base case needs no self-call and still answers.
    expect(ce.parse('R(0,x,y)').evaluate().json).toEqual(0);
    // A single symbolic argument is enough to decline.
    expect(ce.parse('R(3,x,0.7)').evaluate().json).toEqual(['R', 3, 'x', 0.7]);
  });

  test('the numeric route is untouched and the inert form numericizes later', () => {
    const ce = recursiveSetup();
    const direct = ce.parse('R(3,0.3,0.7)').N().re;
    expect(direct).toBeCloseTo(2.844001147222, 9);
    const inert = ce.parse('R(3,x,y)').evaluate();
    ce.assign('x', 0.3);
    ce.assign('y', 0.7);
    expect(inert.N().re).toBeCloseTo(direct, 9);
  });

  test('a conditional that cannot decide stops the recursion by itself', () => {
    // No re-entry happens: `If` keeps its undecided branch unevaluated, so
    // the body shows once with the inner self-call inert — the same answer
    // as before the ruling.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'fact',
      [
        'Function',
        [
          'If',
          ['LessEqual', 'n', 1],
          1,
          ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
        ],
        'n',
      ],
    ]).evaluate();
    expect(ce.box(['fact', 5]).evaluate().json).toEqual(120);
    expect(ce.box(['fact', 'k']).evaluate().json).toEqual([
      'If',
      ['LessEqual', 'k', 1],
      1,
      ['Multiply', 'k', ['fact', ['Add', 'k', -1]]],
    ]);
  });

  test('the declined form keeps the evaluated operands', () => {
    const ce = recursiveSetup();
    expect(ce.box(['R', 3, ['Sin', 0], 'y']).evaluate().json).toEqual([
      'R',
      3,
      0,
      'y',
    ]);
  });

  test('ground arguments of every kind still recurse; a free symbol anywhere declines', () => {
    const ce = new ComputeEngine();
    // A recursive higher-order function: the callback literal is a closed
    // value (its own parameter is bound inside it), so the numeric call
    // recurses, while a free `x` in the accumulator declines — through the
    // guard's structural key, since a literal with a function-typed
    // parameter is rebuilt at every application.
    ce.box([
      'Assign',
      'iter',
      [
        'Function',
        [
          'If',
          ['LessEqual', 'n', 0],
          'v',
          ['iter', ['Subtract', 'n', 1], ['Apply', 'f', 'v'], 'f'],
        ],
        'n',
        'v',
        'f',
      ],
    ]).evaluate();
    const inc = ['Function', ['Add', 'z', 1], 'z'];
    expect(ce.box(['iter', 3, 1, inc]).evaluate().json).toEqual(4);
    const declined = ce.box(['iter', 3, 'x', inc]).evaluate();
    expect(declined.operator).toBe('iter');
    expect(declined.ops!.slice(0, 2).map((op) => op.json)).toEqual([3, 'x']);
    expect(declined.ops![2].operator).toBe('Function');
    // A dictionary argument is walked like a collection.
    ce.box([
      'Assign',
      'dd',
      [
        'Function',
        ['If', ['LessEqual', 'n', 0], 'd', ['dd', ['Subtract', 'n', 1], 'd']],
        'n',
        'd',
      ],
    ]).evaluate();
    const dict = (v: unknown) => ['Dictionary', ['KeyValuePair', "'a'", v]];
    expect(
      ce
        .box(['dd', 3, dict(1)])
        .evaluate()
        .toString()
    ).toBe('{"a" -> 1}');
    expect(ce.box(['dd', 3, dict('x')]).evaluate().operator).toBe('dd');
  });

  test('a constant without a stored value is a ground argument', () => {
    // `True` stores no value yet is a constant: a recursion driven by a
    // boolean flag recurses; the same call with a free flag declines.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'flip',
      [
        'Function',
        [
          'If',
          ['Less', 'k', 0],
          ['flip', ['Negate', 'k'], 'flag'],
          ['If', 'flag', 'k', ['Negate', 'k']],
        ],
        'k',
        'flag',
      ],
    ]).evaluate();
    expect(ce.box(['flip', -3, 'True']).evaluate().json).toEqual(3);
    expect(ce.box(['flip', -3, 'b']).evaluate().operator).toBe('flip');
  });

  test('an operator-definition-backed recursive function keeps its name on decline', () => {
    const ce = new ComputeEngine();
    ce.parse('p(n, x) := x + p(n - 1, x)').evaluate();
    expect(ce.parse('p(3, x)').evaluate().json).toEqual(['p', 3, 'x']);
  });

  test('mutual recursion through a deciding dispatch declines the same way', () => {
    // `Which` DECIDES on the literal depth, so each level re-enters; the
    // outermost application of each literal is the one that declines.
    const ce = new ComputeEngine();
    const dispatch = (callee: string): ReturnType<typeof ce.box> =>
      ce.box([
        'Function',
        [
          'Which',
          ['Equal', 'n', 0],
          0,
          'True',
          ['Add', 'x', [callee, ['Subtract', 'n', 1], 'x']],
        ],
        'n',
        'x',
      ]);
    ce.declare('g', '(number, number) -> number');
    ce.declare('h', '(number, number) -> number');
    ce.assign('g', dispatch('h'));
    ce.assign('h', dispatch('g'));
    expect(ce.box(['g', 4, 2]).evaluate().json).toEqual(8);
    expect(ce.box(['g', 4, 'x']).evaluate().json).toEqual(['g', 4, 'x']);
  });
});
