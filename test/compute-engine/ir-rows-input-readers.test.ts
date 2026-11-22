import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// An input or a parameter of type `list<list<integer>>` or `list<list<real>>`
// (the lane `rows`, whose rows can have different lengths) is read row by
// row by the readers of a list on JavaScript (#638, `chunks()` of
// `lower-lists.ts`): `Map`, `Length`, `Count`, `IsEmpty`, `Reduce`, `Fold`,
// `IndexWhere`. Each compiled result must equal `evaluate()`.

const ce = new ComputeEngine();
ce.declare('L', 'list<list<integer>>');
ce.declare('R', 'list<list<real>>');
ce.declare('n', 'integer');
ce.declare('f', '(list<list<integer>>) -> list<integer>');
ce.assign(
  'f',
  ce.box(['Function', ['Map', ['Function', ['Length', 'r'], 'r'], 'g'], 'g'])
);

const row = (body: MathJsonExpression): MathJsonExpression => [
  'Function',
  body,
  'r',
];
const map = (body: MathJsonExpression, l = 'L'): MathJsonExpression => [
  'Map',
  row(body),
  l,
];

const GRAPHS: number[][][] = [[[1, 2], [3], [4, 5, 6]], [], [[], [7]]];

/** The interpreter's value, a number, a Boolean or a list of numbers. */
function expected(expr: MathJsonExpression, name: string, g: number[][]) {
  const r = ce
    .box(expr)
    .subs({ [name]: ce.box(['List', ...g.map((x) => ['List', ...x])]) })
    .evaluate();
  if (r.symbol === 'True') return true;
  if (r.symbol === 'False') return false;
  return r.isCollection ? [...(r as any).each()].map((x) => x.re) : r.re;
}

const plain = (x: unknown) =>
  x !== null && typeof x === 'object' ? Array.from(x as number[]) : x;

describe('the rows of a list<list<…>> input, read one by one', () => {
  it.each([
    ['Map of Length', map(['Length', 'r'])],
    ['Map of Reduce by Add', map(['Reduce', 'r', 'Add', 0])],
    [
      'Map of Reduce by a function',
      map([
        'Reduce',
        'r',
        ['Function', ['Add', 'a', ['Multiply', 'b', 'b']], 'a', 'b'],
        0,
      ]),
    ],
    ['Map of Sum', map(['Sum', 'r'])],
    [
      'Map of Count by a predicate',
      map(['Count', 'r', ['Function', ['Greater', 'x', 1], 'x']]),
    ],
    ['Count', ['Count', 'L']],
    ['Length', ['Length', 'L']],
    ['IsEmpty', ['IsEmpty', 'L']],
    ['Sum of a Map', ['Sum', map(['Length', 'r'])]],
    [
      'Fold of the lengths',
      ['Fold', ['Function', ['Add', 'a', ['Length', 'b']], 'a', 'b'], 0, 'L'],
    ],
    ['IndexWhere', ['IndexWhere', 'L', row(['Greater', ['Length', 'r'], 1])]],
    [
      'Map of two lists',
      [
        'Map',
        ['Function', ['Add', ['Length', 'r'], ['Length', 's']], 'r', 's'],
        'L',
        'L',
      ],
    ],
    ['a user function of that parameter type', ['f', 'L']],
  ] as [string, MathJsonExpression][])(
    '%s agrees with evaluate()',
    (_, expr) => {
      const c = compile(ce.box(expr), { fallback: false }) as any;
      for (const L of GRAPHS)
        expect(plain(c.run({ L }))).toEqual(expected(expr, 'L', L));
    }
  );

  it('rows of reals', () => {
    const expr = map(['Sum', 'r'], 'R');
    const c = compile(ce.box(expr), { fallback: false }) as any;
    const R = [[1.5, 2], [3], []];
    expect(plain(c.run({ R }))).toEqual(expected(expr, 'R', R));
  });

  it('a row read past its end is NaN, where the interpreter has no value', () => {
    const expr = map(['At', 'r', 2]);
    const c = compile(ce.box(expr), { fallback: false }) as any;
    expect(plain(c.run({ L: GRAPHS[0] }))).toEqual([2, NaN, 5]);
  });

  it('reads the host rows in place', () => {
    const c = compile(ce.box(map(['Length', 'r'])), { fallback: false });
    expect(c.code).toContain('_.L[');
    expect(c.code).toContain('.length');
  });
});

describe('what still declines', () => {
  it.each([
    ['a row at a run-time index', ['Length', ['At', 'L', 'n']]],
    ['a Map whose value is a row', map('r')],
    [
      'a Filter of the rows',
      ['Filter', 'L', row(['Greater', ['Length', 'r'], 1])],
    ],
    ['the rows as a value', ['Add', 'L', 1]],
  ] as [string, MathJsonExpression][])('%s', (_, expr) => {
    expect(() => compile(ce.box(expr), { fallback: false })).toThrow();
  });

  it.each([{ to: 'glsl' }, { to: 'interval-js' }, { mode: 'bigint' }])(
    'on %o',
    (options) =>
      expect(() =>
        compile(ce.box(['Count', 'L']), { fallback: false, ...options } as any)
      ).toThrow(/the input L of type list<list<integer>>/)
  );
});
