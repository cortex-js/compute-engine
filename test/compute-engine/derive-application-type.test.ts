import { BoxedType } from '../../src/common/type/boxed-type';
/**
 * `deriveApplicationType` — the recursive entry point a `'types'`-shape
 * `type` handler reaches as `context.derive`: the type of applying an
 * operator to operands held only as descriptors.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
  describe as describeOperand,
  describeBoundSymbol,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('r', 'real');
ce.declare('z', 'complex');

const derive = (op: string, ...types: string[]) => {
  const t = deriveApplicationType(
    ce,
    op,
    types.map((s) => describeType(ce.type(s).type))
  );
  return t === undefined ? undefined : typeToString(t);
};

describe('deriveApplicationType', () => {
  test('an operator with a descriptor-shape handler answers through it', () => {
    // `Sin` derives its result from the operand's type alone, so the
    // descriptor route and the expression route must agree.
    expect(derive('Sin', 'integer')).toBe(ce.box(['Sin', 'n']).type.toString());
    expect(derive('Sin', 'real')).toBe(ce.box(['Sin', 'r']).type.toString());
    expect(derive('Sin', 'complex')).toBe(ce.box(['Sin', 'z']).type.toString());
  });

  test('a real operand described from an expression agrees too', () => {
    const t = deriveApplicationType(ce, 'Cosh', [describeOperand(ce.box('r'))]);
    expect(typeToString(t!)).toBe(ce.box(['Cosh', 'r']).type.toString());
  });

  test('an operand typed never makes the application never', () => {
    expect(derive('Sin', 'never')).toBe('never');
  });

  test('an unknown operator answers undefined', () => {
    expect(derive('NoSuchOperator_', 'integer')).toBeUndefined();
  });

  test('a declared function symbol answers its declared result type', () => {
    ce.declare('f', '(integer) -> real');
    expect(derive('f', 'integer')).toBe('real');
  });

  test('a polytype function symbol is instantiated against the operands', () => {
    ce.declare('idf', '(T) -> T where T');
    expect(derive('idf', 'integer')).toBe('integer');
    expect(derive('idf', 'string')).toBe('string');
  });

  test('an overload set with no type handler is resolved from the operand types', () => {
    // `Take` has one signature for a string and one for a collection, and no
    // type handler. The arm is selected from the operand types, and the
    // result agrees with the expression route.
    ce.declare('takeList', 'list<integer>');
    ce.declare('takeString', 'string');
    ce.declare('takeOpen', 'unknown');
    expect(derive('Take', 'list<integer>', 'integer')).toBe('list<integer>');
    expect(derive('Take', 'list<integer>', 'integer')).toBe(
      ce.box(['Take', 'takeList', 2]).type.toString()
    );
    expect(derive('Take', 'string', 'integer')).toBe('string');
    expect(derive('Take', 'string', 'integer')).toBe(
      ce.box(['Take', 'takeString', 2]).type.toString()
    );
    // An operand that does not decide the arm: the join of the results of
    // the arms that can take it.
    expect(derive('Take', 'unknown', 'integer')).toBe(
      ce.box(['Take', 'takeOpen', 2]).type.toString()
    );
    // No arm takes a boolean.
    expect(derive('Take', 'boolean', 'integer')).toBe('unknown');
  });

  test('a generic arm is ranked by its instance, as on the expression route', () => {
    // The generic arm solves to `(integer) -> integer` for an `integer`
    // operand, which is more specific than `(number) -> number`, so the call
    // is `integer` on both routes, whatever the order of the arms. When the
    // two instances have the same parameters, the ground arm wins.
    ce.declare('ovlGenericFirst', {
      signature: '((T) -> T where T) & ((number) -> number)',
    });
    ce.declare('ovlGroundFirst', {
      signature: '((number) -> number) & ((T) -> T where T)',
    });
    ce.declare('ovlSameInstance', {
      signature: '((T) -> T where T) & ((integer) -> integer)',
    });
    for (const op of ['ovlGenericFirst', 'ovlGroundFirst', 'ovlSameInstance']) {
      expect(derive(op, 'integer')).toBe('integer');
      expect(derive(op, 'integer')).toBe(ce.box([op, 'n']).type.toString());
    }
  });

  test('a propagate operator absorbs an absent operand as the call site does', () => {
    // `Add` propagates absence: an `integer | missing` operand is handed to
    // the handler stripped, and the result admits the `NaN` an absent
    // numeric operand contributes — never the bare `integer` the handler
    // would claim for the present arm alone.
    const t = deriveApplicationType(ce, 'Add', [
      describeType(ce.type('integer | missing').type),
      describeType(ce.type('1').type),
    ]);
    expect(typeToString(t!)).toBe('number');
    expect(
      deriveApplicationType(ce, 'Add', [
        describeType('integer'),
        describeType(ce.type('1').type),
      ])
    ).toBe('integer');
  });

  test('an Undefined operand of a propagate operator is absorbed like Missing', () => {
    // `Undefined` is typed `unknown`, which a join drops: the result claimed
    // `integer` for `Undefined + 1`, whose value is `NaN`.
    const t = deriveApplicationType(ce, 'Add', [
      describeOperand(ce.box('Undefined')),
      describeType(ce.type('1').type),
    ]);
    expect(typeToString(t!)).toBe('number');
    expect(typeToString(t!)).toBe(
      ce.box(['Add', 'Undefined', 1]).type.toString()
    );
  });

  test('closedness unknown is conservative at a circular pole; a bound variable is not closed', () => {
    // A type-only descriptor may stand for `π/2`, so `Tan` keeps `number`;
    // a bound variable's stand-in is a free symbol and keeps `real`.
    expect(derive('Tan', 'real')).toBe('number');
    expect(
      typeToString(
        deriveApplicationType(ce, 'Tan', [describeBoundSymbol('real')])!
      )
    ).toBe('real');
  });

  test('a purity violation in a nested derivation names the nested operator', () => {
    const e = new ComputeEngine();
    let n = 0;
    e.declare('LeakInner', {
      signature: '(any) -> unknown',
      type: (_ops, { engine }) => {
        (engine as unknown as ComputeEngine).declare(`leak${n++}`, 'number');
        return BoxedType.forResult('unknown', engine._typeResolver);
      },
    });
    e.declare('Outer', {
      signature: '(any) -> unknown',
      type: (ops, { derive }) =>
        BoxedType.forResult(derive('LeakInner', ops) ?? 'unknown'),
    });
    expect(() => e.box(['Outer', 1]).type).toThrow(
      /"LeakInner" modified engine state/
    );
  });
});
