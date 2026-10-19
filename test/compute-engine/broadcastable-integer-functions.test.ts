import type { Expression } from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';

// The integer functions of number theory and combinatorics (`NthPrime`,
// `Totient`, `Fibonacci`, `Binomial`, the figurate predicates, …), the
// regularized incomplete gamma and beta functions, the fractal escape-time
// functions, `Rationalize` and `PreIncrement`/`PreDecrement` are
// element-wise: they carry the `broadcastable` definition flag. A collection
// operand is mapped element by element (two collection operands are zipped),
// the un-evaluated application reports the element count, and its type is
// the collection of the per-element results.
//
// Before the flag, `NthPrime([1, 2, 3])` was an `incompatible-type` error
// (an `integer` parameter does not admit a list), and its `count` was
// `undefined`.
//
// User decision of 2026-10-17 (ROADMAP.md, "`elementCount` adoption —
// residues of the `_broadcastCount` fix").

const ce = new ComputeEngine();

function listOf(xs: unknown[]): unknown {
  return ['List', ...xs];
}

/** `op` applied to a list evaluates to the list of `op` applied to each
 * element (the scalar results are computed independently). */
function expectElementWise(op: string, columns: unknown[][]): void {
  const n = columns[0].length;
  const listed = ce.box([op, ...columns.map(listOf)] as any);
  expect(listed.isValid).toBe(true);
  expect(listed.count).toBe(n);
  const value = listed.evaluate();
  const expected: Expression[] = [];
  for (let i = 0; i < n; i++)
    expected.push(ce.box([op, ...columns.map((c) => c[i])] as any).evaluate());
  expect(value.operator).toBe('List');
  expect(value.count).toBe(n);
  expect(value.ops!.map((x) => x.toString())).toEqual(
    expected.map((x) => x.toString())
  );
}

describe('the witness: NthPrime over a list', () => {
  test('box route', () => {
    const expr = ce.box(['NthPrime', ['List', 1, 2, 3]]);
    expect(expr.isValid).toBe(true);
    expect(expr.count).toBe(3);
    expect(expr.type.toString()).toBe('vector<integer^3>');
    const value = expr.evaluate();
    expect(value.toString()).toBe('[2,3,5]');
    expect(value.count).toBe(3);
  });

  test('function route', () => {
    const expr = ce.function('NthPrime', [
      ce.function('List', [ce.number(1), ce.number(2), ce.number(3)]),
    ]);
    expect(expr.count).toBe(3);
    expect(expr.evaluate().toString()).toBe('[2,3,5]');
  });

  test('parse route', () => {
    const expr = ce.parse('\\operatorname{NthPrime}([1, 2, 3])');
    expect(expr.json).toEqual(['NthPrime', ['List', 1, 2, 3]]);
    expect(expr.count).toBe(3);
    expect(expr.evaluate().toString()).toBe('[2,3,5]');
  });

  test('the alias PrimeNumber maps too', () => {
    expect(ce.box(['PrimeNumber', ['List', 1, 2, 3]]).evaluate().toString()).toBe(
      '[2,3,5]'
    );
  });

  test('a Range operand', () => {
    const expr = ce.box(['NthPrime', ['Range', 1, 5]]);
    expect(expr.count).toBe(5);
    expect(expr.evaluate().toString()).toBe('[2,3,5,7,11]');
  });

  test('a matrix operand is mapped to its leaves', () => {
    expect(
      ce
        .box(['NthPrime', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[2,3],[5,7]]');
  });

  test('a list-typed symbol types the application as a list', () => {
    const local = new ComputeEngine();
    local.declare('v', 'list<integer>');
    expect(local.box(['NthPrime', 'v']).type.toString()).toBe('list<integer>');
    local.assign('v', local.box(['List', 4, 5]));
    expect(local.box(['NthPrime', 'v']).evaluate().toString()).toBe('[7,11]');
  });

  test('an undecided condition moves out of the application', () => {
    expect(ce.box(['NthPrime', ['When', 5, 'c']]).evaluate().json).toEqual([
      'When',
      11,
      'c',
    ]);
  });

  test('a scalar operand is unchanged', () => {
    expect(ce.box(['NthPrime', 10]).evaluate().toString()).toBe('29');
    expect(ce.box(['NthPrime', 'n']).type.toString()).toBe('integer');
  });

  test('an element outside the domain is an error for that element only', () => {
    // The same as for `Factorial`, which was already broadcastable.
    expect(
      ce.box(['NthPrime', ['List', 1, { str: 'a' }]]).evaluate().toString()
    ).toBe('[2,Error(ErrorCode("incompatible-type", "integer", "string"), "a")]');
  });
});

describe('every flagged operator is element-wise over a list', () => {
  const unary: [string, number[]][] = [
    ['NthPrime', [4, 5]],
    ['PrimeNumber', [4, 5]],
    ['NextPrime', [10, 20]],
    ['PrimeNu', [12, 30]],
    ['PrimeOmega', [12, 30]],
    ['MoebiusMu', [6, 7]],
    ['Radical', [12, 18]],
    ['IntegerSqrt', [17, 26]],
    ['CarmichaelLambda', [15, 16]],
    ['LucasL', [6, 7]],
    ['Lucas', [6, 7]],
    ['CatalanNumber', [5, 6]],
    ['PrimePi', [20, 30]],
    ['BernoulliB', [4, 6]],
    ['DigitSum', [1234, 99]],
    ['PrimitiveRoot', [7, 11]],
    ['Totient', [12, 13]],
    ['EulerPhi', [12, 13]],
    ['Sigma0', [12, 13]],
    ['Sigma1', [12, 13]],
    ['SigmaMinus1', [12, 13]],
    ['NPartition', [7, 8]],
    ['PartitionsP', [7, 8]],
    ['IsSquareFree', [6, 12]],
    ['IsPerfectPower', [8, 10]],
    ['IsPerfect', [6, 8]],
    ['IsTriangular', [6, 7]],
    ['IsSquare', [9, 10]],
    ['IsOctahedral', [6, 7]],
    ['IsCenteredSquare', [5, 6]],
    ['IsHappy', [7, 4]],
    ['IsAbundant', [12, 13]],
    ['Fibonacci', [7, 8]],
    ['Subfactorial', [4, 5]],
    ['BellNumber', [4, 5]],
    ['PreIncrement', [5, 6]],
    ['PreDecrement', [5, 6]],
    ['Rationalize', [1.75, 0.5]],
  ];
  for (const [op, xs] of unary)
    test(`${op}(${JSON.stringify(xs)})`, () => expectElementWise(op, [xs]));

  const binary: [string, number[], number[]][] = [
    ['NextPrime', [10, 20], [1, 2]],
    ['DigitSum', [1234, 255], [10, 2]],
    ['DivisorSigma', [1, 2], [12, 13]],
    ['JacobiSymbol', [2, 3], [7, 11]],
    ['LegendreSymbol', [2, 3], [7, 11]],
    ['ModularInverse', [3, 2], [7, 9]],
    ['Eulerian', [5, 6], [2, 3]],
    ['Stirling', [5, 6], [2, 3]],
    ['StirlingS1', [5, 6], [2, 3]],
    ['StirlingS2', [5, 6], [2, 3]],
    ['Divides', [2, 3], [6, 7]],
    ['NotDivides', [2, 3], [6, 7]],
    ['Binomial', [5, 6], [2, 3]],
    ['Choose', [5, 6], [2, 3]],
    ['Pochhammer', [3, 4], [2, 3]],
    ['GammaRegularized', [2, 3], [1, 2]],
    ['Mandelbrot', [0.25, -1], [50, 50]],
  ];
  for (const [op, xs, ys] of binary)
    test(`${op}(${JSON.stringify(xs)}, ${JSON.stringify(ys)})`, () =>
      expectElementWise(op, [xs, ys]));

  test('a scalar operand is lifted beside a list operand', () => {
    expect(ce.box(['Binomial', ['List', 5, 6], 2]).evaluate().toString()).toBe(
      '[10,15]'
    );
    expect(ce.box(['Divides', 3, ['List', 6, 7, 9]]).evaluate().json).toEqual(
      ['List', 'True', 'False', 'True']
    );
  });

  test('ternary operators zip their operands', () => {
    expectElementWise('BetaRegularized', [
      [0.5, 0.25],
      [2, 3],
      [3, 2],
    ]);
    expectElementWise('Julia', [
      [0.25, 0.5],
      [0.3, 0.3],
      [50, 50],
    ]);
  });
});

describe('the type of a broadcast keeps the per-element claim', () => {
  test('Binomial and Pochhammer of integer lists type integer elements', () => {
    expect(ce.box(['Binomial', ['List', 5, 6], 2]).type.toString()).toBe(
      'vector<integer^2>'
    );
    expect(ce.box(['Choose', ['List', 5, 6], 2]).type.toString()).toBe(
      'vector<integer^2>'
    );
    expect(ce.box(['Pochhammer', ['List', 3, 4], 2]).type.toString()).toBe(
      'vector<integer^2>'
    );
  });

  test('a predicate types a list of booleans', () => {
    expect(ce.box(['IsSquare', ['List', 9, 10]]).type.toString()).toBe(
      'list<boolean^2>'
    );
  });
});

describe('the figurate predicates stay symbolic on a symbol', () => {
  // These predicates answered `False` for any operand that is not a number
  // literal, because `toBigint()` answers `null` for it. A valueless symbol
  // has no known value, so the application stays as it is, as `IsSquareFree`
  // and `IsPerfect` already did. With the `broadcastable` flag this also
  // matters for a valueless LIST symbol: `IsSquare(v)` typed
  // `list<boolean>` and evaluated to the scalar `False`.
  const local = new ComputeEngine();
  local.declare('k', 'integer');
  local.declare('v', 'list<integer>');
  for (const op of [
    'IsTriangular',
    'IsSquare',
    'IsOctahedral',
    'IsCenteredSquare',
    'IsHappy',
    'IsAbundant',
  ]) {
    test(op, () => {
      expect(local.box([op, 'k']).evaluate().json).toEqual([op, 'k']);
      expect(local.box([op, 'v']).evaluate().json).toEqual([op, 'v']);
      // A non-positive literal is still `False`.
      expect(local.box([op, -4]).evaluate().json).toBe('False');
    });
  }
});

describe('compilation of a flagged operator', () => {
  const js = (expr: Expression) =>
    ce._getCompilationTarget('javascript')!.compile(expr);

  test('a scalar operand compiles as before', () => {
    const local = new ComputeEngine();
    local.declare('k', 'integer');
    const result = local
      ._getCompilationTarget('javascript')!
      .compile(local.box(['Fibonacci', 'k']));
    expect(result.success).toBe(true);
    expect(result.code).toBe('_SYS.fibonacci(_.k)');
    expect(result.run!({ k: 10 })).toBe(55);
  });

  test('a list operand is mapped', () => {
    const result = js(ce.box(['Fibonacci', ['List', 5, 6, 7]]));
    expect(result.success).toBe(true);
    expect(result.run!({})).toEqual([5, 8, 13]);
  });

  test('a list-typed symbol is mapped at run time', () => {
    const local = new ComputeEngine();
    local.declare('v', 'list<integer>');
    const result = local
      ._getCompilationTarget('javascript')!
      .compile(local.box(['Binomial', 'v', 2]));
    expect(result.success).toBe(true);
    expect(result.run!({ v: [4, 5, 6] })).toEqual([6, 10, 15]);
  });
});

describe('operators that are deliberately not flagged', () => {
  test('Prime is the prime mark of a derivative, not the nth prime', () => {
    // `Prime(f)` is `f'`. Its signature `(T, integer?) -> T` passes a list
    // operand through as the same kind of value, so `Prime([1, 2, 3])` is
    // the prime mark applied to a list and stays as it is. The nth prime is
    // `NthPrime`.
    const expr = ce.box(['Prime', ['List', 1, 2, 3]]);
    expect(expr.operatorDefinition?.broadcastable).toBe(false);
    expect(expr.evaluate().json).toEqual(['Prime', ['List', 1, 2, 3]]);
  });

  test('Multinomial reads its operands as one multiset', () => {
    // `Multinomial(2, 3, 1)` is 6!/(2!·3!·1!). A lone list operand would read
    // naturally as the list of these operands, as for `GCD` or `Max`, so
    // mapping over it (each element alone gives 1) would be a silent wrong
    // answer. The operator is not broadcastable.
    expect(ce.lookupDefinition('Multinomial')).toBeDefined();
    expect(ce.box(['Multinomial', 2, 3, 1]).evaluate().toString()).toBe('60');
    expect(ce.box(['Multinomial', ['List', 2, 3, 1]]).isValid).toBe(false);
  });
});
