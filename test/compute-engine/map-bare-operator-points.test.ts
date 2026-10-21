/**
 * `Map` with a bare operator name over lists of points.
 *
 * `Add`, `Subtract`, `Negate`, `Multiply` and `Divide` combine points in
 * their type handlers (the `'tuples'` broadcast exemption), while their
 * declared signatures are scalar (`Subtract` is `(number+) -> number`). The
 * callback check of `Map` read the declared signature only, so
 * `Map(Subtract, Ps, Ps)` was an `incompatible-type` error while
 * `Map((a, b) ↦ a − b, Ps, Ps)` subtracted the points. The callback check of
 * such an operator now asks its type handler, and the type of the `Map` comes
 * from the same handler.
 *
 * `Map` is lazy: each case runs on the box route and on the parse route.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const Ps = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
const PsLatex = '[(1, 2), (3, 4)]';

function both(json: unknown, latex: string): { value: string; type: string } {
  const boxed = ce.box(json as any);
  const parsed = ce.parse(latex);
  const value = boxed.evaluate().toString();
  const type = boxed.type.toString();
  expect(parsed.evaluate().toString()).toBe(value);
  expect(parsed.type.toString()).toBe(type);
  return { value, type };
}

const op = (name: string) => `\\operatorname{${name}}`;

describe('A BARE OPERATOR NAME OVER POINTS', () => {
  test('Add', () => {
    expect(
      both(
        ['Map', 'Add', Ps, Ps],
        `\\operatorname{Map}(${op('Add')}, ${PsLatex}, ${PsLatex})`
      )
    ).toEqual({
      value: '[(2, 4),(6, 8)]',
      type: 'list<tuple<integer, integer>^2>',
    });
  });

  test('Subtract', () => {
    expect(
      both(
        ['Map', 'Subtract', Ps, Ps],
        `\\operatorname{Map}(${op('Subtract')}, ${PsLatex}, ${PsLatex})`
      )
    ).toEqual({
      value: '[(0, 0),(0, 0)]',
      type: 'list<tuple<integer, integer>^2>',
    });
  });

  test('Negate', () => {
    expect(
      both(
        ['Map', 'Negate', Ps],
        `\\operatorname{Map}(${op('Negate')}, ${PsLatex})`
      )
    ).toEqual({
      value: '[(-1, -2),(-3, -4)]',
      type: 'list<tuple<integer, integer>^2>',
    });
  });

  test('Multiply', () => {
    expect(
      both(
        ['Map', 'Multiply', Ps, ['List', 2, 4]],
        `\\operatorname{Map}(${op('Multiply')}, ${PsLatex}, [2, 4])`
      )
    ).toEqual({
      value: '[(2, 4),(12, 16)]',
      type: 'list<tuple<integer, integer>^2>',
    });
  });

  test('Divide', () => {
    expect(
      both(
        ['Map', 'Divide', Ps, ['List', 2, 4]],
        `\\operatorname{Map}(${op('Divide')}, ${PsLatex}, [2, 4])`
      )
    ).toEqual({
      value: '[(1/2, 1),(3/4, 1)]',
      // The callback is typed from the element type `integer` of `[2, 4]`,
      // not from its values, and an integer divisor may be zero (`1/0` is
      // `~oo`, `0/0` is `NaN`).
      type: 'list<tuple<infinity | nan | real, infinity | nan | real>^2>',
    });
  });

  test('a declared list of points', () => {
    const engine = new ComputeEngine();
    engine.declare('Q', 'list<tuple<real, real>>');
    expect(engine.box(['Map', 'Subtract', 'Q', 'Q']).type.toString()).toBe(
      'list<tuple<real, real>>'
    );
    expect(engine.box(['Map', 'Negate', 'Q']).type.toString()).toBe(
      'list<tuple<real, real>>'
    );
  });
});

describe('A BARE OPERATOR NAME OVER NUMBERS IS UNCHANGED', () => {
  test.each([
    [
      'Subtract',
      [
        ['List', 1, 2],
        ['List', 3, 4],
      ],
      '[1, 2], [3, 4]',
      '[-2,-2]',
    ],
    ['Negate', [['List', 1, 2]], '[1, 2]', '[-1,-2]'],
    [
      'Multiply',
      [
        ['List', 1, 2],
        ['List', 3, 4],
      ],
      '[1, 2], [3, 4]',
      '[3,8]',
    ],
    [
      'Divide',
      [
        ['List', 1, 2],
        ['List', 3, 4],
      ],
      '[1, 2], [3, 4]',
      '[1/3,1/2]',
    ],
  ])('%s', (name, sources, latex, value) => {
    expect(
      both(
        ['Map', name, ...(sources as unknown[])],
        `\\operatorname{Map}(${op(name)}, ${latex})`
      )
    ).toEqual({ value, type: 'vector<2>' });
  });
});

describe('A COMBINATION WITHOUT A VALUE STAYS REFUSED', () => {
  const refused = (json: unknown) => JSON.stringify(ce.box(json as any).json);

  test('a point beside a number under Subtract', () => {
    expect(refused(['Map', 'Subtract', Ps, ['List', 1, 2]])).toMatch(
      /incompatible-type/
    );
  });

  test('two points under Multiply', () => {
    expect(refused(['Map', 'Multiply', Ps, Ps])).toMatch(/incompatible-type/);
  });

  test('strings and points of strings', () => {
    expect(
      refused([
        'Map',
        'Subtract',
        ['List', { str: 'a' }],
        ['List', { str: 'b' }],
      ])
    ).toMatch(/incompatible-type/);
    const S = ['List', ['Tuple', { str: 'a' }, { str: 'b' }]];
    expect(refused(['Map', 'Subtract', S, S])).toMatch(/incompatible-type/);
  });

  test('the arity is checked first', () => {
    expect(refused(['Map', 'Divide', Ps])).toMatch(/callback-arity/);
    expect(refused(['Map', 'Negate', Ps, Ps])).toMatch(/callback-arity/);
  });
});

describe('A MAPPING LITERAL WITH A NESTED BODY', () => {
  test('(a, b) ↦ a − b over points is typed as a list of points', () => {
    // `a − b` canonicalizes to `a + Negate(b)`, a nested application.
    expect(
      both(
        ['Map', ['Function', ['Subtract', 'a', 'b'], 'a', 'b'], Ps, Ps],
        `\\operatorname{Map}((a, b) \\mapsto a - b, ${PsLatex}, ${PsLatex})`
      )
    ).toEqual({
      value: '[(0, 0),(0, 0)]',
      type: 'list<tuple<integer, integer>^2>',
    });
  });
});
