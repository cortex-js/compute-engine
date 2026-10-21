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
import { isSubtype } from '../../src/common/type/subtype';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('r', 'real');
ce.declare('z', 'complex');
ce.declare('x01', 'real<0..1>');

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

  test('a tuple times a scalar widens the components, as on the expression route', () => {
    // A scalar known only by its type is a computed type, not an inferred
    // guess, so it widens the components of the tuple as a declared scalar
    // does. Before the fix this route kept `tuple<integer, integer>`.
    ce.declare('Tii', 'tuple<integer, integer>');
    expect(derive('Multiply', 'tuple<integer, integer>', 'real')).toBe(
      'tuple<real, real>'
    );
    expect(derive('Multiply', 'real', 'tuple<integer, integer>')).toBe(
      'tuple<real, real>'
    );
    expect(derive('Multiply', 'tuple<integer, integer>', 'real')).toBe(
      ce.box(['Multiply', 'Tii', 'r']).type.toString()
    );
    // An integer factor keeps integer components.
    expect(derive('Multiply', 'tuple<integer, integer>', 'integer')).toBe(
      'tuple<integer, integer>'
    );
  });

  test('a tuple times a scalar-or-list factor is the union of both arms', () => {
    expect(
      derive('Multiply', 'tuple<real, real>', 'number | list<number>')
    ).toBe('list<tuple<number, number>> | tuple<number, number>');
  });

  test('a call that derives a point product is typed like the product', () => {
    // `g(1)` is `f((1, 1))`, whose value is `(√2, √2)`: the type comes from
    // the body `P·Norm(P)` derived with `P: tuple<integer, integer>`, and
    // must admit real components.
    const e = new ComputeEngine();
    e.assign('f', e.parse('P \\mapsto P \\cdot \\operatorname{Norm}(P)'));
    e.assign('g', e.parse('a \\mapsto f((a,a))'));
    e.declare('T', 'tuple<integer, integer>');
    const call = e.parse('g(1)');
    expect(call.type.toString()).toBe(
      e.box(['Multiply', 'T', ['Norm', 'T']]).type.toString()
    );
    expect(call.type.toString()).not.toBe('tuple<integer, integer>');
    const value = call.evaluate();
    expect(value.toString()).toBe('(sqrt(2), sqrt(2))');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
  });

  test('point arithmetic that canonicalization rejects is typed error', () => {
    // `(1, 2) + 3` and `3 / (1, 2)` are rejected at boxing; this route never
    // canonicalizes, so it gives the same refusal from the operand types.
    for (const op of ['Add', 'Subtract']) {
      expect(derive(op, 'tuple<integer, integer>', 'real')).toBe('error');
      expect(derive(op, 'real', 'tuple<integer, integer>')).toBe('error');
      expect(derive(op, 'list<tuple<integer, integer>>', 'real')).toBe('error');
    }
    expect(derive('Divide', 'real', 'tuple<integer, integer>')).toBe('error');
    expect(
      derive('Divide', 'tuple<integer, integer>', 'tuple<integer, integer>')
    ).toBe('error');
    expect(derive('Divide', 'real', 'list<tuple<integer, integer>>')).toBe(
      'error'
    );
    // The same shapes on the expression route.
    ce.declare('Tpt', 'tuple<integer, integer>');
    expect(ce.box(['Add', 'Tpt', 'r']).type.toString()).toBe('error');
    expect(ce.box(['Divide', 'r', 'Tpt']).type.toString()).toBe('error');
    // A point divided by a scalar, and a point beside an operand that is not
    // known to be a number, are not errors. A `real` divisor may be zero, so
    // each coordinate may be `~oo` (`1/0`) or `NaN` (`0/0`).
    expect(derive('Divide', 'tuple<integer, integer>', 'real')).toBe(
      'tuple<infinity | nan | real, infinity | nan | real>'
    );
    expect(derive('Add', 'tuple<integer, integer>', 'unknown')).toBe(
      'tuple<integer, integer>'
    );
  });

  test('point arithmetic over a user definition of the operator is not refused', () => {
    // The refusal is part of the library canonical forms. A user definition
    // that replaces `Divide` or `Add` is called with the point, on the
    // expression route and on this route.
    for (const op of ['Divide', 'Add']) {
      const e = new ComputeEngine();
      e.declare(op, {
        signature: '(any, any) -> integer',
        evaluate: () => e.number(7),
      });
      e.declare('T', 'tuple<integer, integer>');
      e.declare('r', 'real');
      const ops = op === 'Divide' ? ['r', 'T'] : ['T', 'r'];
      const types = ops.map((s) =>
        describeType(
          e.type(s === 'T' ? 'tuple<integer, integer>' : 'real').type
        )
      );
      const t = deriveApplicationType(e, op, types);
      expect(t === undefined ? undefined : typeToString(t)).toBe('integer');
      const expr = e.box([op, ...ops]);
      expect(expr.type.toString()).toBe('integer');
      expect(expr.evaluate().re).toBe(7);
    }
  });

  test('a point beside a list of numbers under a user definition is not refused', () => {
    // The library `Add` and `Subtract` give an error for each element of
    // `L + (1, 1)` with `L` a list of numbers, so such an application is
    // typed `error`. A user definition that replaces the operator is called
    // instead, and its declared result type stands, on the expression route
    // and on this route.
    const types = ['tuple<integer, integer>', 'list<integer>'];
    for (const op of ['Add', 'Subtract']) {
      expect(derive(op, ...types)).toBe('error');
      const e = new ComputeEngine();
      e.declare(op, {
        signature: '(any, any) -> integer',
        evaluate: () => e.number(7),
      });
      e.declare('T', types[0]);
      e.declare('L', types[1]);
      const t = deriveApplicationType(
        e,
        op,
        types.map((s) => describeType(e.type(s).type))
      );
      expect(t === undefined ? undefined : typeToString(t)).toBe('integer');
      const expr = e.box([op, 'T', 'L']);
      expect(expr.type.toString()).toBe('integer');
      expect(expr.evaluate().re).toBe(7);
    }
  });

  test('a difference of points is typed like the sum of points', () => {
    expect(
      derive('Subtract', 'tuple<integer, integer>', 'tuple<integer, integer>')
    ).toBe('tuple<integer, integer>');
    expect(
      derive(
        'Subtract',
        'list<tuple<integer, integer>>',
        'list<tuple<integer, integer>>'
      )
    ).toBe('list<tuple<integer, integer>>');
    expect(derive('Subtract', 'list<integer>', 'integer')).toBe(
      'list<integer>'
    );
    // The subtrahend is negated: its range is flipped.
    expect(derive('Subtract', '5', 'real<0..1>')).toBe(
      ce.box(['Subtract', 5, 'x01']).type.toString()
    );
    // A structural `Subtract` is typed by the same handler.
    ce.declare('Spt', 'tuple<integer, integer>');
    expect(
      ce
        .function('Subtract', [ce.symbol('Spt'), ce.symbol('Spt')], {
          form: 'structural',
        })
        .type.toString()
    ).toBe('tuple<integer, integer>');
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
