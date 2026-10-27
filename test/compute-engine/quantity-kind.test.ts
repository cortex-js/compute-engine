// Value kinds, phase 2: `Quantity` is a value kind
// (`docs/plans/2026-10-26-value-kinds.md`, sections 4.7, 6 and 13).
//
// A quantity is a value of the kind type `quantity`, admitted only by the
// arithmetic operators (through the hooks of `QUANTITY_ARITHMETIC`,
// `src/compute-engine/library/quantity-kind.ts`), by the operators that name
// `quantity` (the 24 trigonometric functions, `Abs`), by the comparisons
// (`compare`) and by the operators with a `value` parameter. Every other
// operator refuses it at boxing.

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { engineHasKindValues } from '../../src/compute-engine/boxed-expression/value-kinds';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

type Json = MathJsonExpression;

const ce = new ComputeEngine();

const Q = (magnitude: Json, unit: Json): Json => ['Quantity', magnitude, unit];
const M = (value: Json, error: Json): Json => ['Measurement', value, error];

const box = (x: Json): Expression => ce.box(x);
const value = (x: Json): Expression => ce.box(x).evaluate();
const str = (x: Expression): string => x.toString();
const evalStr = (x: Json): string => str(value(x));
const typeOf = (x: Json): string => ce.box(x).type.toString();
const evalType = (x: Json): string => value(x).type.toString();
/** The symbol (`True`, `False`) that `x` evaluates to, or its operator. */
const verdict = (x: Json): string => {
  const r = value(x);
  return r.symbol ?? r.operator;
};

/** The error code of the first `Error` operand of `x`, or `undefined`. */
function errorCode(x: Expression): string | undefined {
  if (x.operator === 'Error') {
    const code = x.ops?.[0];
    if (code?.operator === 'ErrorCode') return code.ops?.[0]?.string;
    return code?.string;
  }
  for (const op of x.ops ?? []) {
    const c = errorCode(op);
    if (c !== undefined) return c;
  }
  return undefined;
}

describe('THE KIND TYPE `quantity`', () => {
  test('a quantity is typed `quantity`', () => {
    expect(typeOf(Q(2, 'm'))).toBe('quantity');
    expect(evalType(Q(2, 'm'))).toBe('quantity');
  });

  test('a symbol declared `value` accepts a quantity', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'value');
    ce2.assign('v', ce2.box(Q(2, 'm')));
    expect(ce2.box('v').evaluate().toString()).toBe('2 m');
  });

  test('a symbol declared `real` refuses a quantity', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('r', 'real');
    expect(() => ce2.assign('r', ce2.box(Q(2, 'm')))).toThrow();
  });

  test('`quantity` is not a number type', () => {
    expect(ce.type('quantity').matches('number')).toBe(false);
    expect(ce.type('quantity').matches('value')).toBe(true);
  });
});

describe('THE `add` HOOK: ONE FOLD PER DIMENSION', () => {
  // CE-508.1
  test('2 m - 2 m is 0 m, also under simplify()', () => {
    const x: Json = ['Subtract', Q(2, 'm'), Q(2, 'm')];
    expect(evalStr(x)).toBe('0 m');
    expect(str(box(x).simplify())).toBe('0 m');
    expect(box(x).simplify().type.toString()).toBe('quantity');
  });

  // CE-508.2
  test('2 m + 30 cm is 2.3 m, also under simplify()', () => {
    const x: Json = ['Add', Q(2, 'm'), Q(30, 'cm')];
    expect(evalStr(x)).toBe('2.3 m');
    expect(str(box(x).simplify())).toBe('2.3 m');
  });

  // CE-508.3
  test('the other operands are not folded with the quantities', () => {
    expect(evalStr(['Add', 'x', Q(2, 'm'), Q(3, 'm')])).toBe('x + 5 m');
    expect(evalType(['Add', 'x', Q(2, 'm'), Q(3, 'm')])).toBe('quantity');
  });

  test('two dimensions give two folds', () => {
    expect(evalStr(['Add', Q(2, 'm'), Q(3, 'm'), Q(4, 's'), Q(5, 's')])).toBe(
      '5 m + 9 s'
    );
  });

  test('a quantity and a number are not added', () => {
    expect(evalStr(['Add', Q(2, 'm'), 1, 2])).toBe('2 m + 3');
  });

  // CE-508.6
  test('a residue class and a quantity stay a sum typed `quantity | residue`', () => {
    const x: Json = ['Add', ['ResidueClass', 2, 5], Q(3, 'm')];
    expect(typeOf(x)).toBe('quantity | residue');
    expect(evalStr(x)).toBe('3 m + ResidueClass(2, 5)');
  });

  test('a quantity and a measurement stay a sum typed `measurement | quantity`', () => {
    const x: Json = ['Add', Q(2, 'm'), M(3, 0.2)];
    expect(typeOf(x)).toBe('measurement | quantity');
    expect(evalStr(x)).toBe('2 m + 3.00 ± 0.20');
    expect(evalType(x)).toBe('measurement | quantity');
  });
});

describe('THE `multiply`, `divide`, `power` AND `negate` HOOKS', () => {
  // CE-508.2
  test('2 m · 3 s is 6 m·s, also under simplify()', () => {
    const x: Json = ['Multiply', Q(2, 'm'), Q(3, 's')];
    expect(value(x).json).toEqual(['Quantity', 6, ['Multiply', 'm', 's']]);
    expect(box(x).simplify().json).toEqual([
      'Quantity',
      6,
      ['Multiply', 'm', 's'],
    ]);
  });

  test('a dimensionless product is a plain number', () => {
    const x: Json = ['Multiply', Q(6, 'm'), Q(1, ['Divide', 1, 'm']), 2];
    expect(evalStr(x)).toBe('12');
    expect(typeOf(x)).toBe('number | quantity');
  });

  test('a measurement is absorbed as the magnitude, in both orders', () => {
    const expected = ['Quantity', ['Measurement', 6, 0.2], 'm'];
    expect(value(['Multiply', Q(2, 'm'), M(3, 0.1)]).json).toEqual(expected);
    expect(value(['Multiply', M(3, 0.1), Q(2, 'm')]).json).toEqual(expected);
    expect(evalType(['Multiply', M(3, 0.1), Q(2, 'm')])).toBe('quantity');
  });

  test('a scalar and a symbol are factors of the magnitude', () => {
    expect(evalStr(['Multiply', 2, Q(3, 'm')])).toBe('6 m');
    expect(evalStr(['Multiply', 'x', Q(3, 'm')])).toBe('3x m');
  });

  test('a quotient of one dimension is a number', () => {
    const x: Json = ['Divide', Q(6, 'm'), Q(3, 'm')];
    expect(evalStr(x)).toBe('2');
    expect(typeOf(x)).toBe('number | quantity');
    expect(evalStr(['Divide', Q(6, 'm'), 2])).toBe('3 m');
  });

  test('a power and a root', () => {
    expect(evalStr(['Power', Q(2, 'm'), 2])).toBe('4 m^2');
    expect(evalStr(['Sqrt', Q(4, ['Power', 'm', 2])])).toBe('2 m');
    expect(str(box(['Root', Q(8, ['Power', 'm', 3]), 3]).N())).toBe('2 m');
  });

  test('a negation', () => {
    expect(evalStr(['Negate', Q(2, 'm')])).toBe('-2 m');
  });
});

describe('TEMPERATURES WITH AN OFFSET (A16)', () => {
  test('20 degC - 5 degC is 15 K', () => {
    const x: Json = ['Subtract', Q(20, 'degC'), Q(5, 'degC')];
    expect(evalStr(x)).toBe('15 K');
    expect(str(box(x).N())).toBe('15 K');
  });

  test('20 degC + 5 degC is 571.3 K', () => {
    const x: Json = ['Add', Q(20, 'degC'), Q(5, 'degC')];
    expect(evalStr(x)).toBe('5713/10 K');
    expect(str(box(x).N())).toBe('571.3 K');
  });

  test('a difference with a third term', () => {
    expect(
      evalStr(['Add', ['Subtract', Q(20, 'degC'), Q(5, 'degC')], Q(1, 'K')])
    ).toBe('16 K');
  });

  test('a mix of degC and K', () => {
    expect(evalStr(['Add', Q(20, 'degC'), Q(5, 'K')])).toBe('5963/20 K');
    expect(evalStr(['Subtract', Q(20, 'degC'), Q(5, 'K')])).toBe('5763/20 K');
  });

  test('a measured magnitude', () => {
    expect(evalStr(['Subtract', Q(M(20, 0.1), 'degC'), Q(5, 'degC')])).toBe(
      '(15.00 ± 0.10) K'
    );
  });

  test('the negation of a temperature with an offset', () => {
    // `Negate(20 degC)` evaluates to `-20 degC`. A sum of temperatures still
    // reads the sign of each term as written (`.neg()`, which
    // canonicalization calls for `a - b`, keeps `Negate(b)`).
    const x: Json = ['Negate', Q(20, 'degC')];
    expect(box(x).json).toEqual(['Negate', ['Quantity', 20, 'degC']]);
    expect(value(x).json).toEqual(['Quantity', -20, 'degC']);
    expect(value(['Multiply', 2, x]).json).toEqual(['Quantity', -40, 'degC']);
    expect(str(box(['Multiply', 2, x]).N())).toBe('-40 degC');
    expect(evalStr(['Add', ['Negate', Q(20, 'degC')], Q(30, 'degC')])).toBe(
      '10 K'
    );
  });

  test('a subtracted quotient or product', () => {
    expect(
      evalStr(['Subtract', Q(20, 'degC'), ['Divide', Q(10, 'degC'), 2]])
    ).toBe('15 K');
    expect(
      evalStr(['Add', Q(20, 'degC'), ['Divide', ['Negate', Q(10, 'degC')], 2]])
    ).toBe('15 K');
    expect(
      evalStr([
        'Add',
        Q(30, 'degC'),
        ['Multiply', 2, ['Negate', Q(10, 'degC')]],
      ])
    ).toBe('10 K');
    expect(
      evalStr(['Subtract', Q(20, 'degC'), ['Multiply', 2, Q(10, 'degC')]])
    ).toBe('0 K');
  });
});

describe('COMPARISONS', () => {
  // CE-508.10 and A7: the tolerance applies in the finer of the two units
  test('the finer-unit tolerance policy', () => {
    expect(verdict(['Equal', Q(1, 'm'), Q(100.0000000001, 'cm')])).toBe(
      'False'
    );
    expect(verdict(['Less', Q(1, 'm'), Q(100.0000000001, 'cm')])).toBe('True');
    expect(verdict(['Equal', Q(1, 'm'), Q(1.000000000001, 'm')])).toBe('True');
  });

  test('two quantities of one dimension are ordered after conversion', () => {
    expect(verdict(['Less', Q(2, 'm'), Q(300, 'cm')])).toBe('True');
    expect(verdict(['Equal', Q(2, 'm'), Q(200, 'cm')])).toBe('True');
  });

  test('two quantities of two dimensions are not equal and have no order', () => {
    expect(verdict(['Equal', Q(2, 'm'), Q(2, 's')])).toBe('False');
    expect(verdict(['NotEqual', Q(2, 'm'), Q(2, 's')])).toBe('True');
    expect(value(['Less', Q(2, 'm'), Q(2, 's')]).operator).toBe('Less');
    expect(value(Q(2, 'm')).isLess(value(Q(2, 's')))).toBeUndefined();
  });

  // A6: a quantity with a non-real magnitude has no order, as a complex
  // number has none: the order operators answer `False`
  test('a non-real magnitude is unordered', () => {
    const c: Json = ['Add', 1, 'ImaginaryUnit'];
    for (const op of ['Less', 'LessEqual', 'Greater', 'GreaterEqual'])
      expect(verdict([op, Q(c, 'm'), Q(1, 'm')])).toBe('False');
    expect(verdict(['Less', Q(M(c, 0.1), 'm'), Q(1, 'km')])).toBe('False');
    expect(verdict(['Equal', Q(c, 'm'), Q(c, 'm')])).toBe('True');
    // Two dimensions: no order and no answer, as for real magnitudes
    expect(value(['Less', Q(c, 'm'), Q(1, 's')]).operator).toBe('Less');
    // A dimensionless quantity and a number, as for real magnitudes
    expect(verdict(['Less', Q(c, 'percent'), 0.07])).toBe('False');
  });

  // `quantityEq()` compares two non-real magnitudes after the conversion,
  // as two complex numbers are compared
  test('the equality of non-real magnitudes', () => {
    const c: Json = ['Add', 1, 'ImaginaryUnit'];
    const c100: Json = ['Add', 100, ['Multiply', 100, 'ImaginaryUnit']];
    expect(verdict(['Equal', Q(c, 'm'), Q(1, 'm')])).toBe('False');
    expect(verdict(['NotEqual', Q(c, 'm'), Q(1, 'm')])).toBe('True');
    expect(verdict(['Equal', Q(c, 'm'), Q(c100, 'cm')])).toBe('True');
    expect(verdict(['Equal', Q(c100, 'cm'), Q(c, 'm')])).toBe('True');
    expect(verdict(['NotEqual', Q(c, 'm'), Q(c100, 'cm')])).toBe('False');
    expect(verdict(['Equal', Q(M(c, 0.1), 'm'), Q(c100, 'cm')])).toBe('True');
    expect(verdict(['Equal', Q(c, 'm'), Q(c, 's')])).toBe('False');
    expect(verdict(['Equal', Q(c, 'percent'), 0.07])).toBe('False');
    expect(verdict(['Equal', Q(c100, 'percent'), c])).toBe('True');
  });

  test('`Max` and `Min` of quantities are typed `quantity`', () => {
    expect(evalStr(['Max', Q(2, 'm'), Q(3, 'm')])).toBe('3 m');
    expect(typeOf(['Max', Q(2, 'm'), Q(3, 'm')])).toBe('quantity');
    expect(evalStr(['Min', Q(1, 'km'), Q(999, 'm')])).toBe('999 m');
    expect(value(['Max', Q(2, 'm'), Q(2, 's')]).operator).toBe('Max');
  });

  // Section 6: the extrema use the engine tolerance, as the other quantity
  // comparisons do; a tie keeps the first operand
  test('the extrema use the engine tolerance', () => {
    expect(evalStr(['Max', Q(1, 'm'), Q(1.000000000001, 'm')])).toBe('1 m');
  });

  // Decision 10: `Clamp` returns `x` when it equals a bound
  test('`Clamp`', () => {
    expect(evalStr(['Clamp', Q(5, 'm'), Q(0, 'm'), Q(3, 'm')])).toBe('3 m');
    expect(evalStr(['Clamp', Q(3, 'm'), Q(0, 'm'), Q(300, 'cm')])).toBe('3 m');
    expect(evalStr(['Clamp', Q(2, 'm'), Q(0, 'm'), Q(300, 'cm')])).toBe('2 m');
  });

  // Decision 8: `ElementMax` and `ElementMin` order through `compare`
  test('`ElementMax` and `ElementMin`', () => {
    expect(evalStr(['ElementMin', Q(2, 'deg'), 3])).toBe('2 deg');
    expect(evalStr(['ElementMax', Q(2, 'm'), Q(300, 'cm')])).toBe('300 cm');
  });

  // Decision 13: a quantity is as exact as its magnitude
  test('the `isExact` hook', () => {
    expect(value(['Max', Q(1.5, 'm'), 'Indeterminate']).isIndeterminate).toBe(
      false
    );
    expect(value(['Max', Q(1.5, 'm'), 'Indeterminate']).isNaN).toBe(true);
    expect(
      value(['Max', Q(['Rational', 3, 2], 'm'), 'Indeterminate'])
        .isIndeterminate
    ).toBe(true);
  });
});

describe('COLLECTIONS OF QUANTITIES', () => {
  test('`Sum` is a quantity', () => {
    const x: Json = ['Sum', ['List', Q(2, 'm'), Q(4, 'm')]];
    expect(evalStr(x)).toBe('6 m');
    expect(typeOf(x)).toBe('quantity');
  });

  test('`Product` is a quantity, statically `number | quantity`', () => {
    const x: Json = ['Product', ['List', Q(2, 'm'), Q(4, 's')]];
    expect(value(x).json).toEqual(['Quantity', 8, ['Multiply', 'm', 's']]);
    // The static type of a product of quantities says that it can be a
    // number: its unit can be dimensionless.
    expect(typeOf(x)).toBe('number | quantity');
  });

  test('`Max` of a list is a quantity', () => {
    const x: Json = ['Max', ['List', Q(2, 'm'), Q(4, 'm')]];
    expect(evalStr(x)).toBe('4 m');
    expect(typeOf(x)).toBe('quantity');
  });

  test('`Sort` orders the quantities', () => {
    expect(evalStr(['Sort', ['List', Q(3, 'm'), Q(2, 'm')]])).toBe('[2 m,3 m]');
  });

  test('`Mean` does not name `quantity`: it refuses a list of quantities', () => {
    expect(errorCode(box(['Mean', ['List', Q(2, 'm'), Q(4, 'm')]]))).toBe(
      'incompatible-type'
    );
  });
});

describe('THE OPERATORS THAT NAME `quantity`', () => {
  test('a parameter `complex | quantity` is still a numeric slot for a collection operand', () => {
    // `validateThreadableOperand()` (`validate.ts`) and
    // `signatureRefusesOperandType()` (`derive-application-type.ts`) read
    // the parameter without its kind arm: `Sin(list<string>)` is refused as
    // `Sin("a")` is, and the kind the parameter names is a cell like a
    // number.
    const local = new ComputeEngine();
    local.declare('L', 'list<string>');
    local.declare('Q', 'list<quantity>');
    for (const op of ['Sin', 'Cos', 'Abs']) {
      expect(local.box([op, 'L']).isValid).toBe(false);
      expect(local.box([op, 'Q']).isValid).toBe(true);
    }
  });

  test('a collection at a parameter that names `quantity` keeps its shape', () => {
    // The `resultType` hook answers the CELL type
    // (`namedKindResultTypeOverTypes()`, `derive-application-type.ts`).
    const local = new ComputeEngine();
    local.declare('Q', 'list<quantity>');
    local.declare('R', 'list<quantity | integer>');
    local.declare('M', 'matrix<quantity^(2x2)>');
    expect(local.box(['Sin', 'Q']).type.toString()).toBe('list<number>');
    expect(local.box(['Abs', 'Q']).type.toString()).toBe('list<quantity>');
    expect(local.box(['Sin', 'R']).type.toString()).toBe('list<number>');
    expect(local.box(['Abs', 'R']).type.toString()).toBe(
      'list<number | quantity>'
    );
    expect(local.box(['Abs', 'M']).type.toString()).toBe(
      'matrix<quantity^(2x2)>'
    );
    const l = local.box(['List', local.parse('2\\,\\mathrm{m}'), 1]);
    expect(local.box(['Abs', l]).type.toString()).toBe(
      'list<number | quantity^2>'
    );
    expect(local.box(['Abs', l]).evaluate().toString()).toBe('[2 m,1]');
  });

  // The magnitude of an angle can be a measurement: the trigonometric
  // function of `(x ± σ) unit` is a measurement whose uncertainty is
  // propagated (`angularQuantityToRadians()`, `trigonometry.ts`).
  const expectMeasurement = (
    r: Expression,
    nominal: number,
    sigma: number
  ): void => {
    expect(isFunction(r, 'Measurement')).toBe(true);
    if (!isFunction(r, 'Measurement')) return;
    expect(r.op1.re).toBeCloseTo(nominal, 3);
    expect(r.op2.re).toBeCloseTo(sigma, 4);
  };

  test('Sin of an angle whose magnitude is a measurement, literal operand', () => {
    // sin(0.5) = 0.479426, σ = |cos(0.5)|·0.01 = 0.008776
    const x = box(['Sin', Q(M(0.5, 0.01), 'rad')]);
    expectMeasurement(x.evaluate(), 0.4794, 0.00878);
    expectMeasurement(x.N(), 0.4794, 0.00878);
  });

  test('Sin of an angle whose magnitude is a measurement, assigned symbol', () => {
    // sin(30°) = 0.5, σ = cos(π/6)·(0.1·π/180) = 0.0015115
    const local = new ComputeEngine();
    local.assign('q', local.box(Q(M(30, 0.1), 'deg')));
    const x = local.box(['Sin', 'q']);
    expectMeasurement(x.evaluate(), 0.5, 0.0015115);
    expectMeasurement(x.N(), 0.5, 0.0015115);
  });

  const TRIG = [
    'Sin',
    'Cos',
    'Tan',
    'Cot',
    'Sec',
    'Csc',
    'Sinh',
    'Cosh',
    'Tanh',
    'Coth',
    'Sech',
    'Csch',
    'Arcsin',
    'Arccos',
    'Arctan',
    'Arccot',
    'Arcsec',
    'Arccsc',
    'Arsinh',
    'Arcosh',
    'Artanh',
    'Arcoth',
    'Arsech',
    'Arcsch',
  ];

  test.each(TRIG)(
    '%s admits a quantity that is not an angle, unevaluated',
    (op) => {
      const x = box([op, Q(2, 'm')]);
      expect(x.isValid).toBe(true);
      expect(x.type.toString()).toBe('number');
      expect(x.evaluate().json).toEqual([op, ['Quantity', 2, 'm']]);
    }
  );

  // Decision 15: `Arctan` folds an angle as the other heads do
  test.each(TRIG)('%s of an angle is folded to radians', (op) => {
    expect(box([op, Q(2, 'deg')]).json).toEqual([
      op,
      ['Multiply', ['Rational', 1, 90], 'Pi'],
    ]);
  });

  test('an angle that only the evaluation reveals', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('a', ce2.box(Q(30, 'deg')));
    expect(ce2.box(['Sin', 'a']).evaluate().toString()).toBe('1/2');
  });

  test('`Abs` of a quantity is a quantity', () => {
    expect(evalStr(['Abs', Q(-2, 'm')])).toBe('2 m');
    expect(typeOf(['Abs', Q(-2, 'm')])).toBe('quantity');
    expect(evalType(['Abs', Q(-2, 'm')])).toBe('quantity');
  });

  test('a use at `Abs` or `Arctan` does not infer `quantity` for a symbol', () => {
    const ce2 = new ComputeEngine();
    ce2.box(['Abs', 'x']).evaluate();
    ce2.box(['Arctan', 'y']).evaluate();
    expect(ce2.box('x').type.toString()).toBe('complex | infinity');
    expect(ce2.box('y').type.toString()).toBe('complex | signed_infinity');
  });
});

describe('THE OTHER OPERATORS REFUSE A QUANTITY AT BOXING', () => {
  // CE-508.9 and section 6
  test.each([
    ['Round', Q(2.7, 'm')],
    ['Floor', Q(2, 'm')],
    ['Sign', Q(2, 'm')],
    ['InverseHaversine', Q(2, 'm')],
    ['Exp', Q(2, 'm')],
    ['Hypot', Q(2, 'm'), 3],
  ] as [string, ...Json[]][])('%s', (op, ...args) => {
    const x = box([op, ...args]);
    expect(x.isValid).toBe(false);
    expect(errorCode(x)).toBe('incompatible-type');
  });
});

describe('THE PUBLIC METHODS (A15)', () => {
  const q = () => value(Q(2, 'm'));

  test('`add()` converts within a dimension', () => {
    expect(str(q().add(value(Q(30, 'cm'))))).toBe('2.3 m');
    // The same value on the other routes
    expect(str(ce.function('Add', [q(), value(Q(30, 'cm'))]).evaluate())).toBe(
      '2.3 m'
    );
    expect(str(ce.parse('2\\,\\mathrm{m}+30\\,\\mathrm{cm}').evaluate())).toBe(
      '2.3 m'
    );
  });

  test('`mul()`, `neg()`, `div()`, `pow()`', () => {
    expect(q().mul(value(Q(3, 's'))).json).toEqual([
      'Quantity',
      6,
      ['Multiply', 'm', 's'],
    ]);
    expect(str(q().mul(ce.box(2)))).toBe('4 m');
    // `.neg()` does not run the `negate` hook (see `BoxedFunction.neg()`);
    // the evaluation does.
    expect(q().neg().json).toEqual(['Negate', ['Quantity', 2, 'm']]);
    expect(q().neg().evaluate().json).toEqual(['Quantity', -2, 'm']);
    expect(str(q().div(value(Q(4, 'm'))))).toBe('1/2');
    expect(str(q().pow(2))).toBe('4 m^2');
    expect(str(q().sub(q()))).toBe('0 m');
  });
});

describe('A NaN MAGNITUDE', () => {
  // A quantity with a `NaN` magnitude stands for no value (the `isNaN` hook
  // of the kind): it follows the rule of the number `NaN`.
  test('the extrema are NaN', () => {
    expect(value(['Max', Q(NaN, 'm'), Q(2, 'm')]).isNaN).toBe(true);
    expect(value(['Min', Q(2, 'm'), Q(NaN, 'm')]).isNaN).toBe(true);
    expect(value(['Max', ['List', Q(NaN, 'm'), Q(2, 'm')]]).isNaN).toBe(true);
    expect(value(['Max', Q(M(NaN, 0.1), 'm'), Q(2, 'm')]).isNaN).toBe(true);
    expect(ce.box(['Max', Q(NaN, 'm'), Q(2, 'm')]).N().isNaN).toBe(true);
  });

  test('the comparisons answer as for NaN', () => {
    expect(verdict(['Less', Q(NaN, 'm'), Q(2, 'm')])).toBe('False');
    expect(verdict(['Equal', Q(NaN, 'm'), Q(2, 'm')])).toBe('False');
    expect(verdict(['Equal', Q(NaN, 'm'), Q(NaN, 'm')])).toBe('False');
    expect(verdict(['NotEqual', Q(NaN, 'm'), Q(2, 'm')])).toBe('True');
  });
});

describe('`.is()` AND ITS TOLERANCE', () => {
  // `.is()` gives its tolerance to the `compare` hook
  // (`ArithmeticContext.tolerance`): the explicit one, else the engine
  // tolerance, also for two exact magnitudes. `isEqual()` and `Equal`
  // compare two exact magnitudes exactly.
  test('an explicit tolerance', () => {
    expect(value(Q(1, 'm')).is(value(Q(1.1, 'm')), 0.2)).toBe(true);
    expect(value(Q(1, 'm')).is(value(Q(1.1, 'm')))).toBe(false);
    expect(value(Q(6, 'percent')).is(0.0600000001, 1e-6)).toBe(true);
  });

  test('the engine tolerance', () => {
    const a = value(Q(1, 'm'));
    const b = value(Q(['Add', 1, ['Power', 10, -16]], 'm'));
    expect(a.is(b)).toBe(true);
    expect(a.isEqual(b)).toBe(false);
  });
});

describe('THE ENGINE GATE', () => {
  test('a fresh engine has made no quantity', () => {
    // The physical constants are quantities, made while the libraries load:
    // they do not open the gate of the kind type.
    const ce2 = new ComputeEngine();
    expect(engineHasKindValues(ce2, 'quantity')).toBe(false);
    expect(ce2.box(['Multiply', 'SpeedOfLight', 2]).evaluate().toString()).toBe(
      '599584916 m/s'
    );
    expect(engineHasKindValues(ce2, 'quantity')).toBe(true);
  });

  test('the physical constants are declared `quantity`', () => {
    const ce2 = new ComputeEngine();
    for (const name of [
      'SpeedOfLight',
      'PlanckConstant',
      'Mu0',
      'StandardGravity',
      'ElementaryCharge',
      'BoltzmannConstant',
      'AvogadroConstant',
      'VacuumPermittivity',
      'GravitationalConstant',
      'StefanBoltzmannConstant',
      'GasConstant',
    ])
      expect(ce2.box(name).type.toString()).toBe('quantity');
    // Reading the declared types does not open the gate of the kind type.
    expect(engineHasKindValues(ce2, 'quantity')).toBe(false);
  });

  test('a physical constant minus itself', () => {
    const ce2 = new ComputeEngine();
    expect(
      ce2
        .box(['Subtract', 'SpeedOfLight', 'SpeedOfLight'])
        .evaluate()
        .toString()
    ).toBe('0 m/s');
  });
});
