import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

// CE-1540: the row `At(P, i)` of an input `P: list<list<real^2>>` declined
// ("an index that can be out of range … of lists"). On JavaScript the row
// compiles where the `At` is the whole program: it is the host's row, or
// `undefined` out of range, where the interpreter gives `Missing`. Every
// other read of such a row still declines: `Length` of the row is a
// constant and a discharge reads a list as present, so either would give a
// value where the interpreter gives `Missing` or `True`.

const P = [
  [1, 2],
  [3, 4],
];

function engine(decl = 'list<list<real^2>>'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', decl);
  ce.declare('i', 'integer');
  ce.declare('j', 'integer');
  return ce;
}

/** The interpreter's value of `expr` at `P` and `i`, as nested arrays, or
 *  the string `Missing`. */
function interpreted(expr: MathJsonExpression, i: number): unknown {
  const ce = engine();
  const e = ce.box(expr);
  const rows: MathJsonExpression[] = P.map((row) => ['List', ...row]);
  ce.assign('P', ce.box(['List', ...rows]));
  ce.assign('i', i);
  const value = e.evaluate();
  if (value.json === 'Missing') return 'Missing';
  return [...value.each()].map((x) => x.re);
}

describe('CE-1540: a row of a list of lists of stated lengths', () => {
  const at: MathJsonExpression = ['At', 'P', 'i'];

  test.each([1, 2, -1, -2])('At(P, i) at i = %d is the row', (i) => {
    const result = compile(engine().box(at), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.success).toBe(true);
    expect(result.run!({ P, i })).toEqual(interpreted(at, i));
  });

  test.each([0, 3, -3])(
    'At(P, i) at i = %d is undefined, the interpreter Missing',
    (i) => {
      const result = compile(engine().box(at), {
        to: 'javascript',
        fallback: false,
      });
      expect(result.run!({ P, i })).toBeUndefined();
      expect(interpreted(at, i)).toBe('Missing');
    }
  );

  test('the witness: At(P, 1) compiles', () => {
    const result = compile(engine().box(['At', 'P', 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.code).toContain('return _atu(_.P, 1);');
    expect(result.run!({ P })).toEqual([1, 2]);
    expect(result.run!({ P: [] })).toBeUndefined();
  });

  test.each<[string, MathJsonExpression, number[]]>([
    ['First(P)', ['First', 'P'], [1, 2]],
    ['Last(P)', ['Last', 'P'], [3, 4]],
  ])('%s, the whole program: the row, or undefined of no row', (_, expr, row) => {
    const result = compile(engine().box(expr), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.run!({ P })).toEqual(row);
    expect(result.run!({ P: [] })).toBeUndefined();
  });

  test('a row of integers of length 3', () => {
    const result = compile(engine('list<list<integer^3>>').box(at), {
      to: 'javascript',
      fallback: false,
    });
    expect(
      result.run!({
        P: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        i: 2,
      })
    ).toEqual([4, 5, 6]);
  });

  test('the body of a root function literal', () => {
    const ce = engine();
    const f = ce.box([
      'Function',
      ['At', 'Q', 'k'],
      ['Typed', 'Q', "'list<list<real^2>>'"],
      ['Typed', 'k', "'integer'"],
    ]);
    const result = compile(f, { to: 'javascript', fallback: false });
    expect(result.run!(P, 2)).toEqual([3, 4]);
    expect(result.run!(P, 5)).toBeUndefined();
  });

  test.each<[string, MathJsonExpression]>([
    ['an element of the row', ['At', ['At', 'P', 'i'], 1]],
    ['Length of the row', ['Length', ['At', 'P', 'i']]],
    ['IsMissing of the row', ['IsMissing', ['At', 'P', 'i']]],
    ['Coalesce of two rows', ['Coalesce', ['At', 'P', 'i'], ['At', 'P', 'j']]],
    ['Norm of the row', ['Norm', ['At', 'P', 'i']]],
    ['the sum of two rows', ['Add', ['At', 'P', 'i'], ['At', 'P', 'j']]],
    [
      'a row in an arm',
      ['If', ['Greater', 'i', 0], ['At', 'P', 'i'], ['At', 'P', 'j']],
    ],
    ['a row in a tuple', ['Tuple', ['At', 'P', 'i'], 1]],
  ])('%s declines', (_name, expr) => {
    expect(() =>
      compile(engine().box(expr), { to: 'javascript', fallback: false })
    ).toThrow(/an index that can be out of range/);
  });

  test.each(['glsl', 'interval-js'] as const)('%s declines', (to) => {
    expect(() =>
      compile(engine().box(at), { to, fallback: false })
    ).toThrow(/an index that can be out of range/);
  });
});
