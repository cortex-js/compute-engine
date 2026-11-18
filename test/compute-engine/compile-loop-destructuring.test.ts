import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';

import type { MathJsonExpression } from '../../src/math-json/types';

/** `compile()` to `interval-js`, called as a target's `compile()` is. */
const intervalCompile = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { ...options, to: 'interval-js' } as any) as any;

//
// The compilation tails of `docs/epsil/ROADMAP.md` ("Compilation tails"):
//
// - a DESTRUCTURING loop binder, `for (p, q) in pairs { … }`, on the
//   JavaScript target. The interpreter binds the pattern only to
//   a TUPLE of the pattern's arity and answers a shape-mismatch error value
//   for anything else (a list of the right length included); compiled code
//   cannot tell a tuple from a list, so the pattern compiles only when the
//   source's static element type proves tuples of the matching arity at
//   every nesting (`BaseCompiler.elementClauseBinders`).
// - a `Range` whose bound is provably not a number (the chained `1..10..2`
//   spelling, `Range(Range(1, 10), 2)`) declines on the JavaScript target
//   instead of emitting an empty range.
//

const ce = new ComputeEngine();

/** The MathJSON of an Epsil program, source offsets stripped. */
function epsil(source: string): MathJsonExpression {
  const [ast, diagnostics] = parseEpsil(source);
  expect(diagnostics).toEqual([]);
  return JSON.parse(
    JSON.stringify(ast, (k, v) => (k === 'sourceOffsets' ? undefined : v))
  );
}

/** Compile to JavaScript with no fallback and no constant folding, so the
 * lowering itself is what runs. */
function js(expr: MathJsonExpression) {
  return compile(ce.box(expr), { fallback: false, constantFold: false });
}

/** The interpreter's answer for the same program, with each of `params`
 * assigned the matching value of `args` before the program is boxed. */
function interpreted(
  expr: MathJsonExpression,
  params: string[] = [],
  args: number[] = []
): string {
  if (params.length !== args.length)
    throw new Error(
      `interpreted(): ${params.length} params but ${args.length} args`
    );
  const engine = new ComputeEngine();
  params.forEach((p, i) => engine.assign(p, args[i] as number));
  return engine.box(expr).evaluate().toString();
}

describe('COMPILE Loop — destructuring binder (JavaScript)', () => {

  it('fails closed unless the elements are provably tuples of the arity', () => {
    // Lists of the right length: the interpreter refuses them, compiled code
    // could not.
    expect(() =>
      js(
        epsil('let s = 0\nfor (i, j) in [[1, 4], [2, 5]] { s = s + i * j }\ns')
      )
    ).toThrow(/Could not compile/);
    // Arity mismatch: refused at canonicalization (`canonicalLoopLike`
    // binds the pattern's leaves from the element tuple type and reports a
    // pattern the tuple does not fit), so the compiler never sees a valid
    // expression.
    expect(() =>
      js(epsil('let s = 0\nfor (i, j) in [(1, 2, 3)] { s = s + i }\ns'))
    ).toThrow(/Could not compile/);
    // Unknown element type.
    expect(() =>
      js(epsil('let s = 0\nfor (i, j) in xs { s = s + i }\ns'))
    ).toThrow(/Could not compile/);
    // A nested pattern over a component that is not itself a tuple.
    expect(() =>
      js(epsil('let s = 0\nfor ((a, b), c) in [(1, 2)] { s = s + a }\ns'))
    ).toThrow(/Could not compile/);
  });
});

describe('COMPILE Range — a bound that is provably not a number fails closed', () => {
  it('the chained `1..10..2` spelling declines instead of emitting an empty range', () => {
    // `1..10..2` parses as `Range(Range(1, 10), 2)`, which the interpreter
    // leaves inert; the arithmetic lowering coerced the inner array to NaN
    // and emitted `[]` behind `success: true`.
    expect(() => js(epsil('Sum(1..10..2)'))).toThrow(
      /Could not compile/
    );
    // The three-operand form is the stepped range, and still compiles.
    const r = js(epsil('Sum(Range(1, 10, 2))'));
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(25);
  });
});

describe('COMPILE Loop — shapes that fail closed on JavaScript (review pins)', () => {
  const loopOver = (
    binder: MathJsonExpression,
    source: MathJsonExpression,
    body: MathJsonExpression = ['Assign', 's', ['Add', 's', 1]]
  ): MathJsonExpression => [
    'Block',
    ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
    ['Loop', ['Block', body], ['Element', binder, source]],
    's',
  ];

  it('a `break` under several Element clauses stops the whole loop', () => {
    const program: MathJsonExpression = [
      'Block',
      ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', 1]], ['Break']],
        ['Element', 'i', ['Range', 1, 3]],
        ['Element', 'j', ['Range', 1, 3]],
      ],
      's',
    ];
    const r = js(program);
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(1);
    // The interpreter stops the whole traversal: one turn, not three.
    expect(interpreted(program)).toBe('1');
  });

  // The check searches the whole body for an escaping `Break`, not only the
  // first control instruction: a `Continue` before the `Break` let the loop
  // compile, and the emitted `break` left only the inner loop, so the
  // compiled program gave 3 where the interpreter gives 1 (CE-688).
  const twoClauseLoop = (body: MathJsonExpression): MathJsonExpression => [
    'Block',
    ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
    [
      'Loop',
      body,
      ['Element', 'i', ['Range', 1, 3]],
      ['Element', 'j', ['Range', 1, 3]],
    ],
    's',
  ];
  // JavaScript and the interval mode compile the loop and give the
  // interpreter's value, `value`.
  const stopsTheWholeLoop = (
    program: MathJsonExpression,
    value: number
  ): void => {
    const r = js(program);
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(value);
    const interval = intervalCompile(ce.box(program), { fallback: false });
    expect(interval.success).toBe(true);
    expect(interval.run({})).toEqual({
      kind: 'interval',
      value: { lo: value, hi: value },
    });
  };

  it('a `Break` after a `Continue` under several Element clauses stops the whole loop', () => {
    const program = twoClauseLoop([
      'Block',
      ['If', ['Less', 's', 0], ['Continue']],
      ['Assign', 's', ['Add', 's', 1]],
      ['Break'],
    ]);
    stopsTheWholeLoop(program, 1);
    expect(interpreted(program)).toBe('1');
  });

  it('a `Break` before a `Continue` under several Element clauses stops the whole loop', () => {
    const program = twoClauseLoop([
      'Block',
      ['Assign', 's', ['Add', 's', 1]],
      ['If', ['GreaterEqual', 's', 2], ['Break']],
      ['If', ['Less', 's', 0], ['Continue']],
    ]);
    stopsTheWholeLoop(program, 2);
    // The first turn adds 1, the second adds 1 and stops the whole loop.
    expect(interpreted(program)).toBe('2');
  });

  it('a `Break` that belongs to a nested Loop does not decline', () => {
    // The nested `Loop` owns its `Break`, so the outer two-clause loop runs
    // all nine turns, and each inner loop adds 1 before it stops.
    const program = twoClauseLoop([
      'Block',
      ['If', ['Less', 's', 0], ['Continue']],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', 1]], ['Break']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
    ]);
    const r = js(program);
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(9);
    expect(interpreted(program)).toBe('9');
  });

  it('a name bound twice in one pattern declines', () => {
    // Refused at canonicalization (a duplicate name in a destructuring
    // pattern is an error there), so both targets see an invalid expression.
    const program = loopOver(['Tuple', 'a', 'a'], ['List', ['Tuple', 1, 2]]);
    expect(() => js(program)).toThrow(/Could not compile/);
  });

  it('a non-numeric Range bound declines on every operand count', () => {
    // A bound canonicalization lets through but whose static type is a
    // collection (a boolean or string bound is already an invalid
    // expression before the compiler sees it).
    // A range as a bound is provably not a number, so boxing already wraps
    // it in an `incompatible-type` error and the compiler refuses the
    // invalid expression; a bound the types cannot refute still reaches
    // the compiler's own bound check.
    expect(() => js(['Range', ['Range', 1, 10]])).toThrow(
      /Could not compile/
    );
    expect(() => js(['Range', ['Range', 1, 10], 2])).toThrow(
      /Could not compile/
    );
  });

  it('a destructuring binder declines on the interval target', () => {
    const r = intervalCompile(
      ce.box(
        loopOver(
          ['Tuple', 'a', 'b'],
          ['List', ['Tuple', 1, 2]],
          ['Assign', 's', ['Add', 's', 'a']]
        )
      )
    );
    expect(r.success).toBe(false);
  });
});
