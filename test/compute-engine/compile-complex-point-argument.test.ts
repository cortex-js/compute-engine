/**
 * A point (or a list) that holds a complex number, given to an
 * engine-level function whose parameter is a point with no complex type.
 *
 * The parameter type of `h = (p) => p[1] + 1` is inferred from the body as
 * `tuple<number>`, and the emitted body reads the coordinates of `p` as
 * real numbers. With `P: list<tuple<complex, real>>`, the compiled
 * `h(P[1])` added `1` to a `{re, im}` object and gave the string
 * "[object Object]1", where the interpreter gives `2 + i`. Such a call is
 * now a lane mismatch: `mode: 'complex'` compiles it, and in
 * `mode: 'strict'` (the default) it declines.
 * The same test applies to the callback of `Map` and to the combiner of
 * `Reduce`, `Fold` and `Scan`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.assign('h', ce.box(['Function', ['Add', ['At', 'p', 1], 1], 'p'] as any));
ce.assign(
  'h2',
  ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'] as any)
);
ce.assign(
  'k2',
  ce.box([
    'Function',
    ['Add', 'a', ['At', 'v', 1], ['At', 'v', 2]],
    'a',
    'v',
  ] as any)
);
ce.assign('first', ce.box(['Function', ['At', 'L', 1], 'L'] as any));
ce.assign('add2', ce.box(['Function', ['Add', 'a', 'x'], 'a', 'x'] as any));
// A point parameter with a complex first coordinate and a real second one.
ce.assign(
  'h3',
  ce.box([
    'Function',
    ['Add', ['At', 'p', 2], 1],
    ['Typed', 'p', "'tuple<complex, number>'"],
  ] as any)
);
// Parameters with no type (`unknown`).
ce.assign('g9', ce.box(['Function', ['Multiply', 2, 'p'], 'p'] as any));
ce.assign('g8', ce.box(['Function', ['Abs', 'p'], 'p'] as any));
ce.assign('g3', ce.box(['Function', ['Norm', 'p'], 'p'] as any));
// A parameter with `any` elements (`collection`, `indexed_collection<any>`).
ce.assign('len', ce.box(['Function', ['Length', 'L'], 'L'] as any));
ce.assign(
  'gl',
  ce.box(['Function', ['Add', ['Last', ['Reverse', 'p']], 1], 'p'] as any)
);
ce.assign(
  'gl2',
  ce.box([
    'Function',
    ['Multiply', 2, ['First', ['Reverse', ['Reverse', 'p']]]],
    'p',
  ] as any)
);
ce.assign(
  'ha',
  ce.box([
    'Function',
    ['Add', ['At', 'p', 1], 1],
    ['Typed', 'p', "'tuple<any, real>'"],
  ] as any)
);
// A parameter of a union type that admits a number and a collection
// (`collection<any> | value`).
ce.assign('gm', ce.box(['Function', ['Add', ['Max', 'p'], 1], 'p'] as any));
// A parameter whose type is a transparent alias of `any`.
ce.declareType('U', 'any', { alias: true });
ce.assign(
  'gu',
  ce.box(['Function', ['Multiply', 2, 'p'], ['Typed', 'p', "'U'"]] as any)
);
// An engine-level function that a block-local function of the same name
// hides in one test.
ce.assign('gs', ce.box(['Function', ['Add', 'a', 'x'], 'a', 'x'] as any));
// A parameter type nested deeper than the comparison follows.
const DEEP = 'list<'.repeat(10) + 'real' + '>'.repeat(10);
ce.assign(
  'deep',
  ce.box(['Function', ['Length', 'q'], ['Typed', 'q', `'${DEEP}'`]] as any)
);
ce.declare('z', 'complex');
ce.assign('z', ce.box(['Complex', 1, 1]));

describe('A written complex point at a parameter declared with a real position', () => {
  // A call with a written point that has a complex coordinate is compiled
  // with the body of the function at the call site, which reads each
  // coordinate in its own lane. The interpreter refuses a coordinate with
  // an imaginary part at a position declared `real` (CE-1088): the call is
  // an `incompatible-type` error. The static type of `x + i·x`, with `x`
  // untyped, is `number`, so it does not show that error, and the value of
  // the compiled call is unspecified (`docs/COMPILATION-MODEL.md`, "Caveats
  // of compiled code"). These tests check that the call compiles in each
  // mode, and the value that the inlined body computes.
  ce.assign(
    'hr',
    ce.box([
      'Function',
      ['Add', ['At', 'p', 1], ['At', 'p', 2]],
      ['Typed', 'p', "'tuple<real, real>'"],
    ] as any)
  );
  const json = [
    'Function',
    ['hr', ['Tuple', ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'x']], 'x']],
    'x',
  ];
  test('the interpreter: hr((x + i·x, x))', () => {
    const v = ce.box(['Apply', json, 2] as any).evaluate();
    expect(v.operator).toBe('Error');
    expect(v.op1.op1.string).toBe('incompatible-type');
  });
});
