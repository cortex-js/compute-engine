/**
 * Arithmetic over a POINT-OR-POINT-LIST operand — a symbol declared
 * `tuple<number, number> | list<tuple<number, number>>` and left valueless,
 * the parameter type a Desmos document's point-consuming helper carries —
 * keeps that union: a point or a point list scaled, negated, summed or
 * divided by a scalar is still a point or a point list.
 *
 * Before the fix the broadcast type wrapper re-wrapped the arithmetic
 * handler's answer (which already carried the operand's list arm) around
 * the list arm once more, so `P / 2` typed
 * `list<list<tuple<…>> | tuple<…>> | tuple<…>`, a type no evaluated value
 * has, and every further operator added a rank (`P - Q` nested twice). A
 * consumer that declares a point parameter at the two-arm union then
 * rejected such a derived argument as `incompatible-type`.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

const TWO = 'tuple<number, number> | list<tuple<number, number>>';
const THREE =
  'tuple<number, number> | list<tuple<number, number>> | indexed_collection<number | tuple<number, number>>';

function engine(pointType: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', pointType);
  ce.declare('Q', pointType);
  ce.declare('k', 'number');
  ce.declare('n', 'integer');
  ce.declare('u', 'number | list<number>');
  ce.declare('L', 'list<number>');
  ce.declare('l', { signature: `(${pointType}) -> number` });
  return ce;
}

const typeOf = (ce: ComputeEngine, latex: string) =>
  ce.parse(latex).type.toString();

describe('point-or-point-list union arithmetic keeps the union', () => {
  const ce = engine(TWO);
  const FLAT = 'list<tuple<number, number>> | tuple<number, number>';

  test.each([
    ['-P', FLAT],
    ['P - Q', FLAT],
    ['P + Q', FLAT],
    ['P + (1,2)', FLAT],
    ['P / l(P)', FLAT],
    ['P / 2', FLAT],
    ['P \\cdot k', FLAT],
    ['k \\cdot P', FLAT],
    ['2P', FLAT],
    ['P \\cdot n', FLAT],
    ['l(P) \\cdot P', FLAT],
    // A number-or-list factor: point × number is a point, every other arm
    // combination is a list of points.
    ['P \\cdot u', FLAT],
  ])('%s types %s', (latex, expected) => {
    expect(typeOf(ce, latex)).toBe(expected);
  });

  test('a definite list factor or sibling gives a definite list of points', () => {
    expect(typeOf(ce, 'P \\cdot L')).toBe('list<tuple<number, number>>');
    expect(typeOf(ce, 'L \\cdot P')).toBe('list<tuple<number, number>>');
    expect(typeOf(ce, '[(1,2),(3,4)] + P')).toBe('list<tuple<number, number>>');
    expect(typeOf(ce, 'P + [(1,2),(3,4)]')).toBe('list<tuple<number, number>>');
  });

  test('the derived type fits a parameter declared at the same union', () => {
    ce.declare('f', { signature: `(${TWO}) -> number` });
    for (const arg of ['P / l(P)', '2P', 'P - Q', '-P'])
      expect(ce.parse(`f(${arg})`).isValid).toBe(true);
  });

  test('the value agrees with the type on both arms', () => {
    const ce2 = engine(TWO);
    ce2.assign('P', ce2.parse('[(1,2),(3,4)]'));
    expect(ce2.parse('2P').evaluate().toString()).toBe('[(2, 4),(6, 8)]');
    expect(ce2.parse('P / 2').evaluate().toString()).toBe(
      '[(1/2, 1),(3/2, 2)]'
    );
    expect(ce2.parse('-P').evaluate().toString()).toBe('[(-1, -2),(-3, -4)]');
    const ce3 = engine(TWO);
    ce3.assign('P', ce3.parse('(1,2)'));
    expect(ce3.parse('2P').evaluate().toString()).toBe('(2, 4)');
    expect(ce3.parse('P / 2').evaluate().toString()).toBe('(1/2, 1)');
  });
});

describe('component tiers still widen through the union', () => {
  const ce = engine('tuple<integer, integer> | list<tuple<integer, integer>>');
  test('integer components scaled by a declared number widen', () => {
    expect(typeOf(ce, 'P \\cdot k')).toBe(
      'list<tuple<number, number>> | tuple<number, number>'
    );
  });
  test('integer components scaled by an integer stay integer', () => {
    expect(typeOf(ce, '2P')).toBe(
      'list<tuple<integer, integer>> | tuple<integer, integer>'
    );
  });
  test('a quotient by an integer has rational components', () => {
    expect(typeOf(ce, 'P / 2')).toBe(
      'list<tuple<rational, rational>> | tuple<rational, rational>'
    );
  });
});

describe('a three-arm union keeps its arms as declared', () => {
  const ce = engine(THREE);
  const ARMS =
    'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>';
  test.each([['-P'], ['P - Q'], ['P + Q'], ['2P'], ['P / 2'], ['P / l(P)']])(
    '%s keeps the three arms',
    (latex) => {
      expect(typeOf(ce, latex)).toBe(ARMS);
    }
  );
});

describe('neighbouring typings are unchanged', () => {
  const ce = engine(TWO);
  test('a scalar-or-list union still carries through', () => {
    expect(typeOf(ce, '2u')).toBe('list<number> | number');
    expect(typeOf(ce, 'u + 1')).toBe('list<number> | number');
  });
  test('a list factor beside a literal point is a list of points', () => {
    expect(
      ce.box(['Multiply', ['Range', -2, 2], ['Tuple', 2, 3]]).type.toString()
    ).toBe('list<tuple<integer, integer>>');
  });
  test('a declared tuple result keeps its tuple cell under a list operand', () => {
    expect(ce.box(['AbsArg', ['List', 1, 2]]).type.toString()).toBe(
      'list<tuple<+oo | real, real>^2>'
    );
  });
});

describe('component types from every arm reach the cell (dual review)', () => {
  test('a three-arm union with integer components widens in every arm', () => {
    const ce = engine(
      'tuple<integer, integer> | list<tuple<integer, integer>> | indexed_collection<number | tuple<integer, integer>>'
    );
    const WIDENED =
      'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>';
    expect(typeOf(ce, 'P \\cdot k')).toBe(WIDENED);
    expect(typeOf(ce, 'k \\cdot P')).toBe(WIDENED);
    expect(typeOf(ce, 'P / k')).toBe(WIDENED);
  });

  test('the list arm contributes its component types beside a list factor', () => {
    const ce = engine('tuple<integer, integer> | list<tuple<real, real>>');
    ce.declare('I', 'list<integer>');
    expect(typeOf(ce, 'P \\cdot I')).toBe('list<tuple<real, real>>');
    expect(typeOf(ce, 'I \\cdot P')).toBe('list<tuple<real, real>>');
    expect(typeOf(ce, 'P + [(1,2),(3,4)]')).toBe('list<tuple<real, real>>');
  });

  test('a three-arm union beside a definite point list lands in its cells', () => {
    const ce = engine(THREE);
    expect(typeOf(ce, 'P + [(1,2),(3,4)]')).toBe('list<tuple<number, number>>');
  });

  test('a number-or-point symbol scaled by a number widens both arms', () => {
    const ce = engine(TWO);
    ce.declare('W', 'number | tuple<integer, integer>');
    expect(typeOf(ce, 'W \\cdot k')).toBe('number | tuple<number, number>');
  });

  test('a tuple-or-number-list union is not a point union and is typed arm by arm', () => {
    // The bypass is scoped to unions whose collection arms hold points. A
    // union with a list of NUMBERS beside a tuple is typed arm by arm
    // instead (`armwiseUnionBroadcastResultType`): `2V` is a scaled point
    // when `V` holds a point and a scaled list when it holds a list.
    const ce = engine(TWO);
    ce.declare('V', 'tuple<number, number> | list<number>');
    expect(typeOf(ce, '2V')).toBe('list<number> | tuple<number, number>');
  });
});

describe('a union with a tuple arm beside a list of numbers is typed arm by arm', () => {
  // The shape of a Desmos parameter that may hold a number, a point or a
  // list of numbers. Before the fix the broadcast type wrapper wrapped the
  // handler's union answer around the list arm once more, so `2V` typed
  // `list<list<number> | tuple<…>> | list<number> | tuple<…>`, and every
  // further operator added a list level (`b - c` nested three deep). No
  // value has more than one list level.
  const DESMOS =
    'number | list<number> | tuple<number, number> | tuple<number, number, number>';
  const FLAT =
    'list<number> | number | tuple<number, number, number> | tuple<number, number>';
  const ce = new ComputeEngine();
  ce.declare('b', DESMOS);
  ce.declare('c', DESMOS);
  ce.declare('V', 'tuple<number, number> | list<number>');
  ce.declare('u', 'number | list<number>');

  test.each([
    ['b - c', FLAT],
    ['b + c', FLAT],
    ['2b', FLAT],
    ['-b', FLAT],
    ['b / 2', FLAT],
    ['(b - c) / 3', FLAT],
    ['2b - c', FLAT],
    // A power or a transcendental broadcasts over a point component-wise,
    // so the tuple arms stay tuples: `(1, 2)^2` is `(1, 4)`.
    ['b^2', FLAT],
    ['\\sin b', FLAT],
    ['\\sqrt{b}', FLAT],
  ])('%s types %s, one list level', (latex, expected) => {
    const t = typeOf(ce, latex);
    expect(t).toBe(expected);
    expect(t).not.toContain('list<list');
  });

  test('an arm the sum rejects contributes nothing', () => {
    // `(1, 2) + 1` is rejected at boxing (`canonicalAdd`), so the point arm
    // of `V + 1` has no value: the sum is a list of numbers or nothing. The
    // same for `2b + 1`, whose point arms are a point plus a number.
    expect(typeOf(ce, 'V + 1')).toBe('list<number>');
    expect(typeOf(ce, '2b + 1')).toBe('list<number> | number');
  });

  test('a norm head is not typed arm by arm: the tuple is one value', () => {
    // `|b|` of a point is its norm, not a component-wise broadcast, so the
    // one-cell typing stands and keeps its precision.
    expect(typeOf(ce, '|b|')).toBe(
      'list<real<0..> | signed_infinity> | real<0..> | signed_infinity'
    );
  });

  test('a point-or-list factor beside a number-or-list factor', () => {
    expect(typeOf(ce, 'V \\cdot u')).toBe(
      'list<number> | list<tuple<number, number>> | tuple<number, number>'
    );
  });

  test('the value of each arm is admitted by the type', () => {
    // The type is derived with `b` and `c` valueless; each case gives them
    // values in a fresh engine.
    const t = ce.parse('b - c').type;
    const cases: [any, any, string][] = [
      [5, 2, '3'],
      [['Tuple', 1, 2], ['Tuple', 3, 4], '(-2, -2)'],
      [['Tuple', 1, 2, 3], ['Tuple', 3, 4, 5], '(-2, -2, -2)'],
      [['List', 1, 2], 1, '[0,1]'],
      [['List', 1, 2], ['List', 3, 5], '[-2,-3]'],
    ];
    for (const [bv, cv, expected] of cases) {
      const ce2 = new ComputeEngine();
      ce2.declare('b', DESMOS);
      ce2.declare('c', DESMOS);
      ce2.assign('b', ce2.box(bv));
      ce2.assign('c', ce2.box(cv));
      const v = ce2.parse('b - c').evaluate();
      expect(v.toString()).toBe(expected);
      expect(isSubtype(v.type.type, t.type)).toBe(true);
    }
    // The tuple arm of a component-wise head.
    const tSquare = ce.parse('b^2').type;
    const ce3 = new ComputeEngine();
    ce3.declare('b', DESMOS);
    ce3.assign('b', ce3.box(['Tuple', 1, 2]));
    const square = ce3.parse('b^2').evaluate();
    expect(square.toString()).toBe('(1, 4)');
    expect(isSubtype(square.type.type, tSquare.type)).toBe(true);
  });

  test('a tuple beside an inferred scalar is not rejected by the handler', () => {
    // `q` is a bare lambda parameter: its number type is inferred from the
    // sum and may be retracted by a tuple argument, so the sum binds and the
    // literal types the tuple arm (Tycho item 241).
    const ce2 = new ComputeEngine();
    const lit = ce2.box(['Function', ['Add', 'q', ['Tuple', 1, 2]], 'q']);
    expect(lit.isValid).toBe(true);
    expect(String(lit.type)).toBe(
      '(unknown) -> number | tuple<integer, integer>'
    );
  });

  test('the Add type handler rejects a tuple beside a number on types alone', () => {
    // The route that types a declared signature from argument types, and
    // the arm-by-arm typing above, ask the handler about a pair boxing
    // never builds. The handler answers what boxing answers.
    const ce2 = new ComputeEngine();
    ce2.declare('t2', 'tuple<number, number>');
    ce2.declare('k', 'number');
    ce2.declare('L', 'list<number>');
    const structural = (...names: string[]) =>
      ce2
        .function(
          'Add',
          names.map((n) => ce2.symbol(n)),
          { form: 'structural' }
        )
        .type.toString();
    expect(structural('t2', 'k')).toBe('error');
    expect(structural('t2', 'L')).toBe('error');
    expect(structural('t2', 't2')).toBe('tuple<number, number>');
  });
});

describe('a point times a scalar-or-list factor is typed arm by arm', () => {
  // `u: number | list<number>` is a number or a list. A point times a number
  // is a point, and a point times a list is a list of points, so the product
  // is the union of the two. Before the fix it was typed `list<tuple<…>>`
  // alone, which the value `(2cos(a), 2sin(a))` for `u := 2` contradicts.
  const POINT_OR_LIST = 'list<tuple<number, number>> | tuple<number, number>';

  test.each([
    ['(\\cos a, \\sin a) \\cdot u'],
    ['u \\cdot (\\cos a, \\sin a)'],
    ['(1, 2) \\cdot u'],
  ])('%s types the point and the list of points', (latex) => {
    const ce = engine(TWO);
    ce.declare('a', 'real');
    expect(typeOf(ce, latex)).toBe(POINT_OR_LIST);
  });

  test('the value of each arm is admitted by the type', () => {
    for (const value of ['2', '[1, 2]']) {
      const ce = engine(TWO);
      ce.declare('a', 'real');
      ce.assign('u', ce.parse(value));
      const e = ce.parse('(\\cos a, \\sin a) \\cdot u');
      const v = e.evaluate();
      expect(v.type.toString()).toBe(
        value === '2' ? 'tuple<real, real>' : 'list<tuple<real, real>^2>'
      );
      expect(isSubtype(v.type.type, e.type.type)).toBe(true);
    }
  });

  test('a definite list factor beside the union still gives a list of points', () => {
    const ce = engine(TWO);
    ce.declare('a', 'real');
    expect(typeOf(ce, '(\\cos a, \\sin a) \\cdot u \\cdot L')).toBe(
      'list<tuple<number, number>>'
    );
  });
});

describe('a point divided by a list of numbers is a list of points', () => {
  // `(1, 2) / [1, 2]` is the point divided by each element, the same list of
  // points that `(1, 2) · [1, 1/2]` gives. Before the fix the quotient stayed
  // an inert `Divide` typed `tuple<number, number>`.
  test.each([
    [
      ['Divide', ['Tuple', 1, 2], ['List', 1, 2]],
      '[(1, 2),(1/2, 1)]',
      '[(1, 2),(0.5, 1)]',
    ],
    [
      ['Divide', ['Tuple', 1, 2], ['Range', 1, 3]],
      '[(1, 2),(1/2, 1),(1/3, 2/3)]',
      '[(1, 2),(0.5, 1),(0.333333333333333333333, 0.666666666666666666667)]',
    ],
  ])('%j evaluates to a list of points', (json, exact, approx) => {
    const ce = new ComputeEngine();
    const e = ce.box(json as any);
    expect(e.evaluate().toString()).toBe(exact);
    expect(e.N().toString()).toBe(approx);
    expect(isSubtype(e.evaluate().type.type, e.type.type)).toBe(true);
    expect(e.type.toString()).toMatch(/^list<tuple<rational, rational>/);
  });

  test('the compiled JavaScript agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Divide', ['Tuple', 'x', 2], ['List', 1, 'x']]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(
      (r.run as (v: Record<string, unknown>) => unknown)({ x: 4 })
    ).toEqual([
      [4, 2],
      [1, 0.5],
    ]);
    ce.assign('x', 4);
    expect(
      ce
        .box(['Divide', ['Tuple', 'x', 2], ['List', 1, 'x']])
        .evaluate()
        .toString()
    ).toBe('[(4, 2),(1, 1/2)]');
  });

  test('a divisor that may be a number or a list gives both arms', () => {
    const ce = engine(TWO);
    ce.declare('a', 'real');
    const POINT_OR_LIST = 'list<tuple<number, number>> | tuple<number, number>';
    expect(typeOf(ce, '\\frac{(\\cos a, \\sin a)}{u}')).toBe(POINT_OR_LIST);
    for (const value of ['2', '[1, 2]']) {
      const ce2 = engine(TWO);
      ce2.declare('a', 'real');
      ce2.assign('u', ce2.parse(value));
      const e = ce2.parse('\\frac{(\\cos a, \\sin a)}{u}');
      const v = e.evaluate();
      expect(v.type.toString()).toBe(
        value === '2' ? 'tuple<real, real>' : 'list<tuple<real, real>^2>'
      );
      expect(isSubtype(v.type.type, e.type.type)).toBe(true);
    }
  });

  test('a point list divided by a list keeps its element-wise reading', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Divide',
          ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]],
          ['List', 1, 2],
        ])
        .evaluate()
        .toString()
    ).toBe('[(3, 4),(3, 4)]');
  });
});

describe('a point plus a number-or-list operand is rejected at boxing', () => {
  // `(1, 2) + 3` and `(1, 2) + [1, 2]` are rejected at boxing, so a point
  // plus an operand declared `number | list<number>` is too: it is one of
  // those two errors whichever arm the value holds. Before the fix it was
  // accepted and typed `list<number> | number | tuple<real, real>`.
  const ce = engine(TWO);
  ce.declare('a', 'real');
  ce.declare('PL', 'list<tuple<real, real>>');
  test.each([
    ['(\\cos a, \\sin a) + u'],
    ['u + (\\cos a, \\sin a)'],
    ['(\\cos a, \\sin a) - u'],
    ['u - (\\cos a, \\sin a)'],
  ])('%s is an incompatible-type error', (latex) => {
    const e = ce.parse(latex);
    expect(JSON.stringify(e.json)).toBe(
      `["Error",["ErrorCode","'incompatible-type'","'tuple'","'list<number> | number'"]]`
    );
    expect(e.type.toString()).toBe('error');
  });

  test('a list of points plus such an operand is rejected too', () => {
    for (const json of [
      ['Add', 'PL', 'u'],
      ['Subtract', 'PL', 'u'],
      ['Subtract', 'u', 'PL'],
    ])
      expect(JSON.stringify(ce.box(json as any).json)).toBe(
        `["Error",["ErrorCode","'incompatible-type'","'list<tuple>'","'list<number> | number'"]]`
      );
  });

  test('a point minus a list of numbers is rejected like the sum', () => {
    for (const json of [
      ['Add', ['Tuple', 1, 2], ['List', 1, 2]],
      ['Subtract', ['Tuple', 1, 2], ['List', 1, 2]],
    ])
      expect(JSON.stringify(ce.box(json as any).json)).toBe(
        `["Error",["ErrorCode","'incompatible-type'","'tuple'","'list<number>'"]]`
      );
  });

  test('a scalar-or-list operand beside a number is still a sum', () => {
    expect(typeOf(ce, 'u + 1')).toBe('list<number> | number');
  });
});
