/**
 * ROADMAP CE-546: a call of a function literal over an operand of a type
 * such as `number | tuple<real, real>` was typed with the result of the
 * signature, `number`.
 *
 * The call binds a tuple whole to a scalar parameter, and the body then
 * decides the shape of the value: with `T := a ↦ 2a`, `T(y)` is `(6, 8)` for
 * `y := (3, 4)`. The typing by arms of a union operand applied only to a
 * union with an arm that the broadcast maps (a list), so the tuple arm of
 * this union was not read. The call is now typed arm by arm: the number arm
 * gives the signature result and the tuple arm is typed from the body
 * (`componentwiseTupleCallType`), else `any`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

type MathJson = Parameters<ComputeEngine['box']>[0];

const DOUBLE: MathJson = ['Function', ['Multiply', 2, 'a'], 'a'];

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

/** The type of `expr` before `y` has a value, and the value and type of
 * `expr` after `y := value`. */
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

describe('CE-546: a call over a number or a tuple', () => {
  test('a component-wise body over `number | tuple<real, real>`', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>'),
        ['T', 'y'],
        ['Tuple', 3, 4]
      )
    ).toMatchInlineSnapshot(`
      {
        "fits": true,
        "type": "number | tuple<number, number>",
        "value": "(6, 8)",
      }
    `);
  });

  test('the number arm keeps the signature result', () => {
    expect(typeAndValue(engine('number | tuple<real, real>'), ['T', 'y'], 3))
      .toMatchInlineSnapshot(`
      {
        "fits": true,
        "type": "number | tuple<number, number>",
        "value": "6",
      }
    `);
  });

  test('an operator definition (no declaration of `T`)', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>', DOUBLE, false),
        ['T', 'y'],
        ['Tuple', 3, 4]
      )
    ).toMatchInlineSnapshot(`
      {
        "fits": true,
        "type": "number | tuple<number, number>",
        "value": "(6, 8)",
      }
    `);
  });

  test('a bare `tuple` arm, of any length, is typed `any`', () => {
    expect(
      typeAndValue(engine('number | tuple'), ['T', 'y'], ['Tuple', 3, 4, 5])
    ).toMatchInlineSnapshot(`
      {
        "fits": true,
        "type": "any",
        "value": "(6, 8, 10)",
      }
    `);
  });

  test('a body that is not component-wise is typed `any`', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>', ['Function', ['Abs', 'a'], 'a']),
        ['T', 'y'],
        ['Tuple', 3, 4]
      )
    ).toMatchInlineSnapshot(`
      {
        "fits": true,
        "type": "any",
        "value": "5",
      }
    `);
  });

  test('a second operand that is a number', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>', [
          'Function',
          ['Multiply', 'a', 'b'],
          'a',
          'b',
        ]),
        ['T', 'y', 3],
        ['Tuple', 1, 2]
      )
    ).toMatchInlineSnapshot(`
      {
        "fits": true,
        "type": "number | tuple<number, number>",
        "value": "(3, 6)",
      }
    `);
  });

  test('a second operand that the call maps is typed `any`', () => {
    const ce = engine('number | tuple<real, real>', [
      'Function',
      ['Multiply', 'a', 'b'],
      'a',
      'b',
    ]);
    ce.declare('L', 'list<real>');
    expect(ce.box(['T', 'y', 'L']).type.toString()).toBe('any');
  });

  test('the call inside a list', () => {
    expect(
      typeAndValue(
        engine('number | tuple<real, real>'),
        ['List', ['T', 'y']],
        ['Tuple', 3, 4]
      )
    ).toMatchInlineSnapshot(`
      {
        "fits": true,
        "type": "list<number | tuple<number, number>>",
        "value": "[(6, 8)]",
      }
    `);
  });

  test('a union of two tuple types is typed arm by arm', () => {
    const ce = engine('tuple<real, real> | tuple<real, real, real>');
    expect(ce.box(['T', 'y']).type.toString()).toBe(
      'tuple<number, number, number> | tuple<number, number>'
    );
  });

  test.each([
    'string | tuple<real, real>',
    'boolean | tuple<real, real>',
  ])('a tuple arm beside another kind of arm: `%s` is typed `any`', (t) => {
    expect(typeAndValue(engine(t), ['T', 'y'], ['Tuple', 3, 4])).toEqual({
      type: 'any',
      value: '(6, 8)',
      fits: true,
    });
  });

  test.each([
    ['number | tuple<real, real>', 'pt', 'number | tuple<number, number>'],
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
      expect(typeAndValue(ce, ['T', 'y'], ['Tuple', 3, 4])).toEqual({
        type: expected,
        value: '(6, 8)',
        fits: true,
      });
    }
  );

  test('a function with no value keeps the signature result', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'string | tuple<real, real>');
    ce.declare('T', '(number) -> number');
    expect(ce.box(['T', 'y']).type.toString()).toBe('number');
  });

  test('control: a number operand', () => {
    const ce = engine('number');
    expect(ce.box(['T', 'y']).type.toString()).toBe('number');
  });
});
