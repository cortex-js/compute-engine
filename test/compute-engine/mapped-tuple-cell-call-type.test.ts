/**
 * A call of a function literal that maps a list whose cells may be tuples
 * was typed with the result of the signature for each cell.
 *
 * The broadcast does not descend into a tuple: it binds a tuple cell whole
 * to a scalar parameter, and the body then decides the shape of the value.
 * With `T := a ↦ 2a` and `y: number | tuple<real, real>`, `T([y, y])` is
 * `[(6, 8), (6, 8)]` for `y := (3, 4)`, and it was typed `list<number>`.
 * The cell type is now typed arm by arm, as a direct operand of the same
 * type is (`ce-546-number-or-tuple-call-type.test.ts`): the number arm gives
 * the signature result, and a tuple arm is typed from the body
 * (`componentwiseTupleCallType`), else the call is typed `any`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

type MathJson = Parameters<ComputeEngine['box']>[0];

const DOUBLE: MathJson = ['Function', ['Multiply', 2, 'a'], 'a'];

const PAIR: MathJson = ['List', 'y', 'y'];

/** An engine with `y` declared `yType` and `T` holding `literal`. With
 * `declareT`, `T` is declared `function` first (a value definition);
 * otherwise the assignment makes an operator definition. */
function engine(
  yType: string,
  literal: MathJson = DOUBLE,
  declareT = true
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('y', yType);
  if (declareT) ce.declare('T', 'function');
  ce.assign('T', ce.box(literal));
  return ce;
}

/** The type of `expr` before `y` has a value, and the value of `expr`
 * after `y := value`, with whether the type holds the value. */
function typeAndValue(
  ce: ComputeEngine,
  expr: MathJson,
  value: MathJson
): { type: string; value: string; fits: boolean } {
  const staticType = ce.box(expr).type;
  ce.assign('y', value);
  const v = ce.box(expr).evaluate();
  return {
    type: staticType.toString(),
    value: v.toString(),
    fits: isSubtype(v.type.type, staticType.type),
  };
}

describe('a call that maps a list whose cells may be tuples', () => {
  test('cells of type `number | tuple<real, real>`, a tuple value', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>'),
        ['T', PAIR],
        ['Tuple', 3, 4]
      )
    ).toEqual({
      type: 'list<number | tuple<number, number>>',
      value: '[(6, 8),(6, 8)]',
      fits: true,
    });
  });

  test('cells of type `number | tuple<real, real>`, a number value', () => {
    expect(
      typeAndValue(engine('number | tuple<real, real>'), ['T', PAIR], 3)
    ).toEqual({
      type: 'list<number | tuple<number, number>>',
      value: '[6,6]',
      fits: true,
    });
  });

  test('an operator definition (no declaration of `T`)', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>', DOUBLE, false),
        ['T', PAIR],
        ['Tuple', 3, 4]
      )
    ).toEqual({
      type: 'list<number | tuple<number, number>>',
      value: '[(6, 8),(6, 8)]',
      fits: true,
    });
  });

  test('a declared list of `number | tuple<real, real>`', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number | tuple<real, real>>');
    ce.declare('T', 'function');
    ce.assign('T', ce.box(DOUBLE));
    expect(ce.box(['T', 'L']).type.toString()).toBe(
      'list<number | tuple<number, number>>'
    );
    ce.assign('L', ['List', ['Tuple', 3, 4], 5]);
    expect(ce.box(['T', 'L']).evaluate().toString()).toBe('[(6, 8),10]');
  });

  test('cells that are tuples', () => {
    expect(
      typeAndValue(engine('tuple<real, real>'), ['T', PAIR], ['Tuple', 3, 4])
    ).toEqual({
      type: 'list<tuple<number, number>>',
      value: '[(6, 8),(6, 8)]',
      fits: true,
    });
  });

  // Only the element type changes: the result is a plain list, without the
  // dimensions of the operand (`list<tuple<integer, integer>^2>`), as for
  // any call whose element result is a tuple (`x ↦ (x, x)` over `[1, 2]`
  // is typed `list<tuple<integer, integer>>`).
  test('a list literal of tuples', () => {
    const ce = engine('real');
    const expr = ce.box(['T', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]]);
    expect(expr.type.toString()).toBe('list<tuple<number, number>>');
    expect(expr.evaluate().toString()).toBe('[(2, 4),(6, 8)]');
  });

  test('a body that passes its parameter through', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>', ['Function', 'a', 'a']),
        ['T', PAIR],
        3
      )
    ).toEqual({
      type: 'list<number | tuple<number, number>>',
      value: '[3,3]',
      fits: true,
    });
  });

  test('a list literal of tuples and numbers', () => {
    const ce = engine('real');
    const expr = ce.box(['T', ['List', ['Tuple', 1, 2], 5]]);
    expect(expr.type.toString()).toBe('list<number | tuple<number, number>>');
    expect(expr.evaluate().toString()).toBe('[(2, 4),10]');
  });

  test('a body that is not component-wise gives `list<any>`', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>', ['Function', ['Abs', 'a'], 'a']),
        ['T', PAIR],
        ['Tuple', 3, 4]
      )
    ).toEqual({ type: 'list<any>', value: '[5,5]', fits: true });
  });

  test('a second operand that the call binds whole', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>', [
          'Function',
          ['Multiply', 'a', 'b'],
          'a',
          'b',
        ]),
        ['T', PAIR, 3],
        ['Tuple', 1, 2]
      )
    ).toEqual({
      type: 'list<number | tuple<number, number>>',
      value: '[(3, 6),(3, 6)]',
      fits: true,
    });
  });

  test.each([
    'string | tuple<real, real>',
    'boolean | tuple<real, real>',
  ])('a tuple arm beside another kind of arm: `%s` is typed `any`', (t) => {
    expect(typeAndValue(engine(t), ['T', PAIR], ['Tuple', 3, 4])).toEqual({
      type: 'any',
      value: '[(6, 8),(6, 8)]',
      fits: true,
    });
  });

  test.each([
    [
      'number | tuple<real, real>',
      'pt',
      'list<number | tuple<number, number>>',
    ],
    ['string | tuple<real, real>', 'pt', 'any'],
    ['number | tuple<real, real>', 'boolean | pt', 'any'],
  ])(
    'a transparent alias `pt = %s`, operand `%s`, is unfolded',
    (definition, operand, expected) => {
      const ce = new ComputeEngine();
      ce.declareType('pt', definition, { alias: true });
      ce.declare('y', operand);
      ce.declare('T', 'function');
      ce.assign('T', ce.box(DOUBLE));
      expect(typeAndValue(ce, ['T', PAIR], ['Tuple', 3, 4])).toEqual({
        type: expected,
        value: '[(6, 8),(6, 8)]',
        fits: true,
      });
    }
  );

  test('a parameter that the body does not read keeps the result', () => {
    const ce = engine(
      'number | tuple<real, real>',
      ['Function', 1, 'a'],
      false
    );
    expect(ce.box(['T', PAIR]).type.toString()).toBe('list<integer>');
  });

  test('a function with no value keeps the signature result', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'string | tuple<real, real>');
    ce.declare('T', '(number) -> number');
    expect(ce.box(['T', PAIR]).type.toString()).toBe('list<number>');
  });

  test('control: cells that are numbers', () => {
    const ce = engine('real');
    expect(ce.box(['T', PAIR]).type.toString()).toBe('vector<2>');
  });
});
