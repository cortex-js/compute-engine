import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// An integral whose integrand is a LIST is one integral per element, as an
// integral with a list bound is (see
// `tycho-325-integrate-list-limit-broadcast.test.ts`). When a bound is also a
// list, the elements are paired, and the lengths must agree.
//
// Reference values: ∫_0^1 ∫_0^g x·y dx dy = g²/4, and
// ∫_0^h ∫_0^g x·y dx dy = g²·h²/4.

function values(expr: Expression): number[] {
  const result: number[] = [];
  for (const el of expr.each()) result.push(el.re);
  return result;
}

function expectClose(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++)
    expect(Math.abs(actual[i] - expected[i])).toBeLessThan(1e-9);
}

const QUARTERS = ['List', ['Rational', 1, 4], 1, ['Rational', 9, 4]];

describe('An inner integral with a list bound', () => {
  test('parse route: evaluate() and N()', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('[1, 2, 3]'));
    const expr = ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy');
    expect(expr.type.toString()).toBe('list<number>');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    const n = expr.N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.25, 1, 2.25]);
  });

  test('box route', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      [
        'Integrate',
        ['Multiply', 'x', 'y'],
        ['Limits', 'x', 0, ['List', 1, 2, 3]],
      ],
      ['Limits', 'y', 0, 1],
    ]);
    expect(expr.type.toString()).toBe('list<number>');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.N()), [0.25, 1, 2.25]);
  });

  test('ce.function route with pre-boxed operands', () => {
    const ce = new ComputeEngine();
    const [x, y] = [ce.symbol('x'), ce.symbol('y')];
    const inner = ce.function('Integrate', [
      ce.function('Multiply', [x, y]),
      ce.function('Limits', [x, ce.number(0), ce.parse('[1, 2, 3]')]),
    ]);
    const expr = ce.function('Integrate', [
      inner,
      ce.function('Limits', [y, ce.number(0), ce.number(1)]),
    ]);
    expect(expr.type.toString()).toBe('list<number>');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.N()), [0.25, 1, 2.25]);
  });

  test('a list bound substituted into a declared list<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'list<number>');
    const expr = ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy');
    expect(expr.type.toString()).toBe('list<number>');
    const G = ce.parse('[1, 2, 3]');
    expect(expr.subs({ G }).evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.subs({ G }).N()), [0.25, 1, 2.25]);
  });

  test('an assigned integration variable does not substitute', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('y', 7);
    ce.assign('G', ce.parse('[1, 2, 3]'));
    const expr = ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.N()), [0.25, 1, 2.25]);
  });

  test('the compiled javascript route agrees', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'list<number>');
    const r = compile(ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy'), {
      to: 'javascript',
    } as never) as any;
    expect(r.success).toBe(true);
    expectClose(r.run({ G: [1, 2, 3] }) as number[], [0.25, 1, 2.25]);
  });
});

describe('Two list bounds in one multiple integral', () => {
  test('equal lengths: paired element by element under evaluate()', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, ['List', 1, 2]],
      ['Limits', 'y', 0, ['List', 2, 1]],
    ]);
    // Before, the inner limit gave a list integrand and the outer integral
    // stayed unevaluated.
    expect(expr.evaluate().json).toEqual(['List', 1, 1]);
    expectClose(values(expr.N()), [1, 1]);
  });

  test('different lengths: incompatible-dimensions under evaluate()', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, ['List', 1, 2]],
      ['Limits', 'y', 0, ['List', 1, 2, 3]],
    ]);
    const v = expr.evaluate();
    expect(v.operator).toBe('Error');
    expect(JSON.stringify(v.json)).toContain('incompatible-dimensions');
    // Under N(), a mismatch of list bounds keeps the integral unevaluated.
    expect(expr.N().operator).toBe('Integrate');
  });
});

describe('A list integrand', () => {
  test('parse route', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 [x, 2x]\\,dx');
    expect(expr.type.toString()).toBe('vector<2>');
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 1]);
    const n = expr.N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.5, 1]);
  });

  test('box route', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['List', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, 1],
    ]);
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 1]);
    expectClose(values(expr.N()), [0.5, 1]);
  });

  test('ce.function route with pre-boxed operands', () => {
    const ce = new ComputeEngine();
    const x = ce.symbol('x');
    const expr = ce.function('Integrate', [
      ce.function('List', [x, ce.function('Multiply', [ce.number(2), x])]),
      ce.function('Limits', [x, ce.number(0), ce.number(1)]),
    ]);
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 1]);
    expectClose(values(expr.N()), [0.5, 1]);
  });

  test('a nested list keeps its shape', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 [[x],[2x]]\\,dx');
    expect(expr.type.toString()).toBe('matrix<2x1>');
    expect(expr.evaluate().json).toEqual([
      'List',
      ['List', ['Rational', 1, 2]],
      ['List', 1],
    ]);
  });

  test('an indefinite integral of a list', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int [x, 2x]\\,dx').evaluate().json).toEqual([
      'List',
      ['Multiply', ['Rational', 1, 2], ['Power', 'x', 2]],
      ['Power', 'x', 2],
    ]);
  });

  test('a list bound of the same length is paired', () => {
    const ce = new ComputeEngine();
    // [∫_0^1 x dx, ∫_0^2 2x dx] = [1/2, 4]
    const expr = ce.box([
      'Integrate',
      ['List', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, ['List', 1, 2]],
    ]);
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 4]);
    expectClose(values(expr.N()), [0.5, 4]);
  });

  test('a list bound of another length', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['List', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, ['List', 1, 2, 3]],
    ]);
    const v = expr.evaluate();
    expect(v.operator).toBe('Error');
    expect(JSON.stringify(v.json)).toContain('incompatible-dimensions');
    expect(expr.N().operator).toBe('Integrate');
  });

  test('the compiled javascript route agrees', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\int_0^1 [x, 2x]\\,dx'), {
      to: 'javascript',
    } as never) as any;
    expect(r.success).toBe(true);
    expectClose(r.run({}) as number[], [0.5, 1]);
  });
});

describe('A tuple integrand is not distributed', () => {
  test('box route: the integral stays whole', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Tuple', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, 1],
    ]);
    expect(expr.type.toString()).toBe('number');
    expect(expr.evaluate().operator).toBe('Integrate');
    expect(expr.N().operator).toBe('Integrate');
  });

  // `(x, 2x)` is a tuple outside an integral. Inside one it was read as a
  // `Block` of two statements: `evaluate()` integrated `x` and answered 1/2,
  // while `N()` integrated `2x` and answered 1.
  test.each([
    ['\\int_0^1 (x, 2x)\\,dx', 2],
    ['\\int_0^1 (x, 2x, 3x)\\,dx', 3],
    ['\\int (x, 2x)\\,dx', 2],
    ['\\int_0^1 (x; 2x)\\,dx', 2],
  ])('parse route: %s has a tuple integrand', (latex, n) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    const body = expr.op1.op1;
    expect(body.operator).toBe('Block');
    expect(body.op1.operator).toBe('Tuple');
    expect(body.op1.nops).toBe(n);
    expect(expr.type.toString()).toBe('number');
    const v = expr.evaluate();
    const w = expr.N();
    expect(v.operator).toBe('Integrate');
    expect(w.operator).toBe('Integrate');
    expect(v.isSame(expr)).toBe(true);
    expect(w.isSame(expr)).toBe(true);
    // The LaTeX round trip keeps the tuple.
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });

  test('a parenthesized single expression is still the integrand', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^1 (x+1)\\,dx').evaluate().json).toEqual([
      'Rational',
      3,
      2,
    ]);
  });

  test('a scalar integrand still types as a number', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^1 x\\,\\mathrm{d}x').type.toString()).toBe(
      'number'
    );
  });
});
