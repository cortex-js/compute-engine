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
import { ComputeEngine } from '../../src/compute-engine';

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
    expect(ce2.parse('P / 2').evaluate().toString()).toBe('[(1/2, 1),(3/2, 2)]');
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
    expect(ce.box(['Multiply', ['Range', -2, 2], ['Tuple', 2, 3]]).type.toString()).toBe(
      'list<tuple<integer, integer>>'
    );
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

  test('a tuple-or-number-list union is not a point union and still wraps', () => {
    // The bypass is scoped to unions whose collection arms hold points, so a
    // union with a list of NUMBERS beside a tuple takes the ordinary wrap:
    // the result is not the operand's own union echoed back. (What the wrap
    // produces for this shape is a nested union, a known gap recorded in
    // ROADMAP.md under "A tuple-or-number-list union nests through the
    // broadcast type wrapper"; this pin does not lock that output in.)
    const ce = engine(TWO);
    ce.declare('V', 'tuple<number, number> | list<number>');
    const t = typeOf(ce, '2V');
    expect(t).not.toBe('list<number> | tuple<number, number>');
    expect(t).toContain('list<number>');
    expect(t).toContain('tuple<number, number>');
  });
});
