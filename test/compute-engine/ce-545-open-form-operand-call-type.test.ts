/**
 * CE-545: a call of a function literal over an operand typed with the open
 * form `R | tuple | list<R | tuple | list<any>>` (the type of a call over an
 * operand of type `unknown`, ROADMAP CE-502) is typed as a call over an
 * operand of type `unknown` (user decision 2026-11-06). It was typed `any`
 * when the body does not compute a point component by component: the call
 * was typed arm by arm, and its bare `tuple` arm answered `any`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { BoxedType } from '../../src/common/type/boxed-type';

const OPEN = 'number | tuple | list<number | tuple | list<any>>';
const OPEN_NUMBER = 'list<list<any> | number | tuple> | number | tuple';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('y', OPEN);
  ce.declare('g', '(number) -> unknown');
  ce.assign('T', ce.parse('a \\mapsto a + 1'));
  ce.assign('D', ce.parse('a \\mapsto 2a'));
  ce.assign('N', ce.parse('a \\mapsto |a|'));
  ce.assign('B', ce.parse('a \\mapsto a > 0'));
  ce.assign('U', ce.parse('(a, b) \\mapsto a + b'));
  ce.assign('S', ce.parse('(a, b) \\mapsto \\max(a, b)'));
  ce.assign('P', ce.parse('a \\mapsto (a, a)'));
  return ce;
}

const typeOf = (ce: ComputeEngine, expr: unknown): string =>
  ce.box(expr as never).type.toString();

describe('CE-545: a call over the open form is typed as a call over unknown', () => {
  test.each([
    ['T(y)', ['T', 'Y'], OPEN_NUMBER],
    ['D(y)', ['D', 'Y'], OPEN_NUMBER],
    [
      'N(y)',
      ['N', 'Y'],
      'list<list<any> | real<0..> | signed_infinity | tuple> | real<0..> | signed_infinity | tuple',
    ],
    ['U(1, y)', ['U', 1, 'Y'], OPEN_NUMBER],
    ['U(y, y)', ['U', 'Y', 'Y'], OPEN_NUMBER],
    ['T(2y)', ['T', ['Multiply', 2, 'Y']], OPEN_NUMBER],
  ])('%s', (_label, shape, expected) => {
    const ce = engine();
    const at = (y: unknown): unknown =>
      JSON.parse(JSON.stringify(shape).replaceAll('"Y"', JSON.stringify(y)));
    expect(typeOf(ce, at('y'))).toBe(expected);
    // The same type as over an operand of type `unknown`.
    expect(typeOf(ce, at(['g', 2]))).toBe(expected);
  });

  test('the type holds the value for a number, a point and a ragged list', () => {
    const ce = engine();
    const declared = ce.box(['D', 'y']).type.type;
    for (const v of [
      3,
      ['Tuple', 1, 2],
      ['List', 1, ['Tuple', 1, 2], ['List', 2, 3]],
    ]) {
      const value = ce.box(['D', v] as never).evaluate();
      expect(isSubtype(value.type.type, declared)).toBe(true);
    }
    expect(ce.box(['D', ['Tuple', 1, 2]]).evaluate().toString()).toBe(
      '(2, 4)'
    );
  });

  test('the descriptor route gives the same type', () => {
    const ce = engine();
    const t = deriveApplicationType(ce as never, 'T', [
      describeType(ce.type(OPEN).type),
    ]);
    expect(`${new BoxedType(t!, ce._typeResolver)}`).toBe(OPEN_NUMBER);
    // A function whose body makes the call.
    ce.assign('F', ce.parse('x \\mapsto T(y)'));
    expect(ce.parse('F(1)').type.toString()).toBe(OPEN_NUMBER);
  });

  test('unchanged: a Max body keeps the narrower type of its tuple arm', () => {
    // `Max` reads a number from a point (`componentwiseTupleCallType`), so
    // the call is typed arm by arm (CE-543).
    const ce = engine();
    expect(typeOf(ce, ['S', 1, 'y'])).toBe(
      'list<list<any> | number | tuple> | number'
    );
  });

  test('unchanged: a list beside the operand keeps the answer any', () => {
    // Over an operand of type `unknown`, the call is typed with the shape of
    // the list, which does not hold the value when the operand is a list of
    // lists: `U([[1, 2], [3, 4]], [1, 2])` is `[[2, 3], [5, 6]]`.
    const ce = engine();
    expect(typeOf(ce, ['U', 'y', ['List', 1, 2]])).toBe('any');
    expect(
      ce
        .box(['U', ['List', ['List', 1, 2], ['List', 3, 4]], ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[[2,3],[5,6]]');
  });

  test('unchanged: a result whose cells can be lists keeps the answer any', () => {
    // Over an operand of type `unknown`, `P` is typed
    // `broadcastable<tuple<unknown, unknown>>`, which does not hold the value
    // over a ragged list.
    const ce = engine();
    expect(typeOf(ce, ['P', 'y'])).toBe('any');
  });

  test('unchanged: a collection result keeps the answer any', () => {
    // Over a point, a body with a tuple or a list result gives a tuple or a
    // list of points: `Q((1, 2))` is `((2, 4), (3, 6))`, which
    // `R | list<R | list<any>>` with `R = tuple<number, number>` does not hold.
    const ce = engine();
    ce.assign('Q', ce.parse('a \\mapsto (2a, 3a)'));
    ce.assign('V2', ce.parse('a \\mapsto [2a, 3a]'));
    for (const [f, value] of [
      ['Q', '((2, 4), (3, 6))'],
      ['V2', '[(2, 4),(3, 6)]'],
    ]) {
      const call = ce.box([f, 'y']);
      expect(call.type.toString()).toBe('any');
      const v = ce.box([f, ['Tuple', 1, 2]]).evaluate();
      expect(v.toString()).toBe(value);
      expect(isSubtype(v.type.type, call.type.type)).toBe(true);
    }
  });

  test('unchanged: a result that is not a number keeps the answer any', () => {
    // The rule for an operand of type `unknown` keeps a `tuple` arm only for
    // a number result, and over a point such a body can give a point:
    // `F((1, 2))` is `(2, 4)` when `c` is true.
    const ce = engine();
    ce.declare('c', 'boolean');
    ce.assign(
      'F',
      ce.box(['Function', ['If', 'c', ['Multiply', 2, 'a'], 'False'], 'a'])
    );
    const call = ce.box(['F', 'y']);
    expect(call.type.toString()).toBe('any');
    ce.assign('c', true);
    const v = ce.box(['F', ['Tuple', 1, 2]]).evaluate();
    expect(v.toString()).toBe('(2, 4)');
    expect(isSubtype(v.type.type, call.type.type)).toBe(true);
    // A boolean result.
    expect(typeOf(ce, ['B', 'y'])).toBe('any');
  });

  test('unchanged: the open form of a non-numeric R', () => {
    // The rule reads only the numeric open form
    // `number | tuple | list<number | tuple | list<any>>`.
    const ce = engine();
    ce.declare('b', 'boolean | tuple | list<boolean | tuple | list<any>>');
    expect(typeOf(ce, ['T', 'b'])).toBe('error');
  });
});
