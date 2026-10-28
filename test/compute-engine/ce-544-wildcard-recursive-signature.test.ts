/**
 * ROADMAP CE-544 (Tycho ledger row 469): a recursive function literal held by
 * a binding declared with the bare `function` type was typed by the
 * literal's own type, and that type read the recursive call of the body as
 * the type the literal had before it was assigned. With
 * `G(a,b,c) = |sin a| − 0.1`, `S(a,b,c) = max(G(a,b,c), c − 3)` and
 * `R(i) = {i = 0: 0, R(i−1) + S(1, 2, R(i−1))}`, all three declared
 * `function` and then assigned (as Tycho's document manager stores a
 * document function), `R(3)` and `R(x)` were typed `any`. Assigned without
 * the declarations, they were typed `number`.
 *
 * The binding now derives the signature of such a literal as a binding
 * declared `(unknown) -> unknown` does, with the recursion check
 * (`_wildcardRecursiveSignature`, `boxed-value-definition.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

type MathJson = Parameters<ComputeEngine['box']>[0];

const G: MathJson = [
  'Function',
  ['Subtract', ['Abs', ['Sin', 'a']], 0.1],
  'a',
  'b',
  'c',
];
const S_NESTED: MathJson = [
  'Function',
  ['Max', ['G', 'a', 'b', 'c'], ['Subtract', 'c', 3]],
  'a',
  'b',
  'c',
];
const S_FLAT: MathJson = ['Function', ['Max', 'a', 'b', 'c'], 'a', 'b', 'c'];
const R_PREV: MathJson = ['R', ['Subtract', 'i', 1]];
const R: MathJson = [
  'Function',
  [
    'Which',
    ['Equal', 'i', 0],
    0,
    'True',
    ['Add', R_PREV, ['S', 1, 2, R_PREV]],
  ],
  'i',
];

function engine(s: MathJson, declared: boolean): ComputeEngine {
  const ce = new ComputeEngine();
  const defs: [string, MathJson][] = [
    ['G', G],
    ['S', s],
    ['R', R],
  ];
  if (declared) for (const [name] of defs) ce.declare(name, 'function');
  for (const [name, fn] of defs) ce.assign(name, ce.box(fn));
  ce.declare('x', 'real');
  return ce;
}

/** The types of `R(3)` and `R(x)`, the value of `R(3)`, and whether the
 * type of `R(3)` holds the type of its value. */
function typesAndValue(ce: ComputeEngine): [string, string, string, boolean] {
  const r3 = ce.box(['R', 3]);
  const value = r3.evaluate();
  return [
    r3.type.toString(),
    ce.box(['R', 'x']).type.toString(),
    value.toString(),
    isSubtype(value.type.type, r3.type.type),
  ];
}

describe('CE-544: a recursive literal under a bare function declaration', () => {
  test('Tycho row 469: S calls another user function', () => {
    const declared = typesAndValue(engine(S_NESTED, true));
    expect(declared.slice(0, 2)).toEqual(['number', 'number']);
    expect(declared[3]).toBe(true);
    // The same answer as without the declarations.
    expect(declared).toEqual(typesAndValue(engine(S_NESTED, false)));
  });

  test('S calls no user function', () => {
    const declared = typesAndValue(engine(S_FLAT, true));
    expect(declared).toEqual(['number', 'number', '8', true]);
    expect(declared).toEqual(typesAndValue(engine(S_FLAT, false)));
  });

  test('the same as a declaration with an unknown signature', () => {
    const ce = new ComputeEngine();
    ce.declare('G', '(unknown, unknown, unknown) -> unknown');
    ce.declare('S', '(unknown, unknown, unknown) -> unknown');
    ce.declare('R', '(unknown) -> unknown');
    ce.assign('G', ce.box(G));
    ce.assign('S', ce.box(S_NESTED));
    ce.assign('R', ce.box(R));
    ce.declare('x', 'real');
    expect(typesAndValue(ce)).toEqual(typesAndValue(engine(S_NESTED, true)));
  });

  test('a recursive list builder keeps its list result', () => {
    // `L(n) = {n = 0: [], Append(L(n − 1), n)}`: the recursion check keeps
    // the list hypothesis, as on the operator-definition route.
    const literal: MathJson = [
      'Function',
      [
        'Which',
        ['Equal', 'n', 0],
        ['List'],
        'True',
        ['Append', ['L', ['Subtract', 'n', 1]], 'n'],
      ],
      'n',
    ];
    const declared = new ComputeEngine();
    declared.declare('L', 'function');
    declared.assign('L', declared.box(literal));
    const plain = new ComputeEngine();
    plain.assign('L', plain.box(literal));
    const call = declared.box(['L', 3]);
    expect(call.type.toString()).toBe(plain.box(['L', 3]).type.toString());
    expect(call.evaluate().toString()).toBe('[1,2,3]');
    expect(isSubtype(call.evaluate().type.type, call.type.type)).toBe(true);
  });

  test('a new value that is not recursive is typed by its own type', () => {
    const ce = engine(S_NESTED, true);
    expect(ce.box(['R', 3]).type.toString()).toBe('number');
    ce.assign('R', ce.box(['Function', ['Tuple', 'i', 'i'], 'i']));
    const call = ce.box(['R', 3]);
    expect(call.type.toString()).toBe('tuple<integer, integer>');
    expect(call.evaluate().toString()).toBe('(3, 3)');
  });

  // Review of 2026-10-27.
  test('a string argument is still checked as for an inferred signature', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'function');
    ce.assign(
      'r',
      ce.box([
        'Function',
        ['If', ['Equal', 'x', 0], 0, ['Add', ['r', ['Subtract', 'x', 1]], 1]],
        'x',
      ])
    );
    const call = ce.box(['r', { str: 's' }]);
    expect(call.evaluate().operator).toBe('Error');
    expect(call.type.toString()).not.toBe('number');
  });

  test('a generic recursive literal keeps its own signature', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Typed',
            ['If', ['Equal', 'n', 0], 'x', ['g', 'x', ['Subtract', 'n', 1]]],
            "'(x: T, n: integer) -> T where T'",
          ],
        ],
        'x',
        ['Typed', 'n', "'integer'"],
      ])
    );
    const call = ce.box(['g', 2, 3]);
    expect(call.type.toString()).toBe('integer');
    expect(call.evaluate().toString()).toBe('2');
  });

  test('the effects of the literal are kept', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], ['Random'], ['h', ['Subtract', 'n', 1], 'k']],
        'n',
        'k',
      ])
    );
    // A partial application: its type is the function of the remaining
    // parameter, which draws a random number.
    expect(ce.box(['h', 1]).type.toString()).toBe('(unknown) random -> number');
  });

  test('a function that is not recursive is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', ['List', 'x', 'x'], 'x']));
    expect(ce.box(['f', 2]).type.toString()).toBe('vector<integer^2>');
  });
});
