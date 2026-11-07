import { ComputeEngine } from '../../src/compute-engine';
import { typeHandlerContext } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';

// The `Multiply` type handler gives the type of a product of scalar factors
// before its branches for points, collections and NaN arms
// (`scalarProductType()` in src/compute-engine/library/arithmetic.ts). These
// types are the ones that the full handler gives. The last group holds
// products that the shortcut must leave to the full handler: a possibly
// infinite, an imaginary or a collection factor.

const ce = new ComputeEngine();
ce.declare('x', 'real<1..2>');
ce.declare('n', 'integer<1..3>');
ce.declare('r', 'rational');
ce.declare('w', 'number');
ce.declare('h', 'real | +oo | -oo');

const typeOf = (json: unknown): string => String(ce.expr(json as any).type);

describe('CE-351: the type of a product of scalar factors', () => {
  test('a factor typed number makes the product number', () => {
    expect(typeOf(['Multiply', 2, 'y'])).toBe('number');
    expect(typeOf(['Multiply', 'w', 'x'])).toBe('number');
  });

  test('finite real factors keep the tier and the interval product', () => {
    expect(typeOf(['Multiply', ['Sqrt', 6], 'x'])).toBe('real<2.4..5>');
    expect(typeOf(['Multiply', 2, 'n'])).toBe('integer<2..6>');
    expect(typeOf(['Multiply', 'n', 'n', 'x'])).toBe('real<1..18>');
    expect(typeOf(['Multiply', 'r', ['Rational', 1, 3]])).toBe('rational');
  });

  test('a float literal factor makes a rational product real', () => {
    expect(typeOf(['Multiply', 'r', { num: '4.0' }])).toBe('real');
    expect(typeOf(['Multiply', ['Rational', 1, 3], { num: '4.0' }])).toBe(
      'real<1.32..1.36>'
    );
  });

  test('a factor of the empty type is typed by the full handler', () => {
    // No boxed expression has a factor typed `never` here: the derivation
    // of an application returns `never` before it calls the handler. A
    // cell of a collection can reach the handler, so it is called directly.
    const handler = (ce.lookupDefinition('Multiply') as any).operator.type;
    const context = typeHandlerContext(ce);
    const typeOfFactors = (a: string, b: string): string =>
      String(handler([describeType(a), describeType(b)], context));
    expect(typeOfFactors('never', 'real')).toBe('number');
    expect(typeOfFactors('never', 'integer<1..3>')).toBe('number');
  });

  test('other factors are typed by the full handler', () => {
    expect(typeOf(['Multiply', 2, ['Ln', 0]])).toBe('signed_infinity');
    expect(typeOf(['Multiply', 2, 'h'])).toBe('real | signed_infinity');
    expect(typeOf(['Multiply', 'x', 'ImaginaryUnit'])).toBe('imaginary');
    expect(typeOf(['Multiply', 'y', ['List', 1, 2]])).toBe('vector<2>');
  });
});
