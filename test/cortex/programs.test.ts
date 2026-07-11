import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeCortex } from '../../src/cortex/execute-cortex';

//
// Complete example programs, exercising Cortex end-to-end: control flow,
// functions, collections, and the engine's exact/symbolic arithmetic working
// together. Each program here is mirrored in `src/cortex/docs/examples.md` —
// keep the two in sync so the documented examples can never rot.
//
// Idioms these programs rely on (current v0 semantics):
// - Loops are for-effect; value-producing iteration uses `Map`/`Filter`.
// - A recursive function can be defined in one step (`f(n) = …`, whose
//   self-reference now resolves) or declared first (`let f`) then assigned a
//   mapsto lambda.
// - Multi-value results end in a tuple `( … )`: tuples evaluate their
//   elements; list literals are inert (lazy) as a final statement.
// - `a % b` is `Mod(a, b)`; a postfix `!` is `Factorial` and must abut its
//   operand (`n!`, but `x != y` stays NotEqual).
//

function run(
  source: string
): ReturnType<typeof executeCortex> & { text: string } {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  const result = executeCortex(ce, source, { parseLatex });
  return { ...result, text: result.value.toString() };
}

describe('CORTEX PROGRAMS — iteration and accumulation', () => {
  test('sum of the multiples of 3 or 5 below 100', () => {
    const { text, diagnostics } = run(`
let total = 0
for k in Range(1, 99) {
  if k % 3 == 0 || k % 5 == 0 { total = total + k }
}
total`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('2318');
  });

  test('FizzBuzz as a value (Map over a Range)', () => {
    const { value, diagnostics } = run(`
Map(Range(1, 15), k |->
  if k % 15 == 0 { "FizzBuzz" }
  else if k % 3 == 0 { "Fizz" }
  else if k % 5 == 0 { "Buzz" }
  else { k })`);
    expect(diagnostics).toEqual([]);
    // The result of Map is a lazy collection: materialize it with each()
    const items = [...value.each()].map((x) => x.string ?? x.re);
    expect(items).toEqual([
      1,
      2,
      'Fizz',
      4,
      'Buzz',
      'Fizz',
      7,
      8,
      'Fizz',
      'Buzz',
      11,
      'Fizz',
      13,
      14,
      'FizzBuzz',
    ]);
  });

  test('Collatz stopping time of 27', () => {
    const { text, diagnostics } = run(`
let n = 27
let steps = 0
while n != 1 {
  n = if n % 2 == 0 { n / 2 } else { 3n + 1 }
  steps = steps + 1
}
steps`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('111');
  });

  test('greatest common divisor by the Euclidean algorithm', () => {
    const { text, diagnostics } = run(`
let a = 1071
let b = 462
while b != 0 {
  let t = a % b
  a = b
  b = t
}
a`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('21');
  });

  test('iterative Fibonacci (20th term)', () => {
    const { text, diagnostics } = run(`
let a = 0
let b = 1
for k in Range(1, 20) {
  let t = a + b
  a = b
  b = t
}
a`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('6765');
  });

  test('trial-division primality test, then count the primes below 100', () => {
    const { text, diagnostics } = run(`
isPrime(n) = if n < 2 { False } else {
  let d = 2
  let prime = True
  while d * d <= n {
    if n % d == 0 { prime = False; d = n } else { d = d + 1 }
  }
  prime
}
let count = 0
for k in Range(2, 99) { if isPrime(k) { count = count + 1 } }
count`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('25');
  });
});

describe('CORTEX PROGRAMS — recursion', () => {
  test('recursive factorial (one-step `f(n) = …` definition)', () => {
    // The Assign canonicalization pre-declares the function symbol before
    // canonicalizing the body, so a self-reference inside `fact(n) = …`
    // resolves and the recursion unfolds fully.
    const { text, diagnostics } = run(`
fact(n) = if n <= 1 { 1 } else { n * fact(n - 1) }
fact(10)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('3628800');
  });

  test('recursive factorial (declare first, then assign the lambda)', () => {
    // The `let f` idiom still works: the symbol exists before the lambda
    // that captures it is created.
    const { text, diagnostics } = run(`
let fact
fact = n |-> if n <= 1 { 1 } else { n * fact(n - 1) }
fact(10)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('3628800');
  });
});

describe('CORTEX PROGRAMS — numeric methods', () => {
  test("Newton's method for sqrt(2)", () => {
    // Starting from x = 1 is also a regression test: the loop body is
    // canonicalized while x holds 1, which used to fold `2/x` to `2`
    // (the canonical-fold value-leak fixed 2026-07-10).
    const { value, diagnostics } = run(`
let x = 1
for k in Range(1, 6) { x = (x + 2/x) / 2 }
N(x)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBeCloseTo(Math.SQRT2, 14);
  });

  test('trapezoidal integration of x^2 over [0, 1]', () => {
    const { value, diagnostics } = run(`
g(x) = x^2
let n = 100
let h = 1/n
let area = (g(0) + g(1)) / 2
for k in Range(1, n - 1) { area = area + g(k * h) }
N(area * h)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBeCloseTo(1 / 3, 3);
  });

  test('Monte Carlo estimate of pi', () => {
    const { value, diagnostics } = run(`
let inside = 0
let total = 500
for k in Range(1, total) {
  let px = Random()
  let py = Random()
  if px^2 + py^2 < 1 { inside = inside + 1 }
}
N(4 * inside / total)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBeGreaterThan(2.7);
    expect(value.re).toBeLessThan(3.6);
  });
});

describe('CORTEX PROGRAMS — exact and symbolic computation', () => {
  test('the 20th harmonic number stays an exact rational', () => {
    const { text, diagnostics } = run(`
let h = 0
for k in Range(1, 20) { h = h + 1/k }
h`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('55835135/15519504');
  });

  test('Basel problem: exact partial sum against pi^2/6', () => {
    const { value, diagnostics } = run(`
let s = Sum(1/k^2, (k, 1, 100))
N(Pi^2 / 6 - s)`);
    expect(diagnostics).toEqual([]);
    // The tail of the series is ~1/100
    expect(value.re).toBeCloseTo(0.00995016666333, 10);
  });

  test('derivative of a user-defined function', () => {
    const { text, diagnostics } = run(`
f(x) = (x^2 + 1) / x
D(f(t), t)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('(t^2 - 1) / t^2');
  });

  test('solve a quadratic, then verify the roots by substitution', () => {
    const { text, diagnostics } = run(`
let roots = Solve(x^2 - 5x + 6 == 0, x)
Map(roots, r |-> r^2 - 5r + 6)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('[0,0]');
  });

  test('binomial coefficient with postfix factorials', () => {
    const { text, diagnostics } = run(`10! / (3! * 7!)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('120');
  });

  test('golden ratio: continued fraction against a $…$ LaTeX island', () => {
    const { value, diagnostics } = run(`
let x = 2
for k in Range(1, 40) { x = 1 + 1/x }
let phi = $\\frac{1 + \\sqrt{5}}{2}$
N(Abs(x - phi))`);
    expect(diagnostics).toEqual([]);
    expect(Math.abs(value.re)).toBeLessThan(1e-12);
  });
});

describe('CORTEX PROGRAMS — strings', () => {
  test('string interpolation splices expression values', () => {
    const { value, diagnostics } = run(`
let x = 2^11 - 1
"\\(x) has type \\(Type(x))"`);
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('2047 has type integer');
  });
});

describe('CORTEX PROGRAMS — collections', () => {
  test('matrix determinant, transpose and indexing', () => {
    // A final tuple evaluates its elements (a bare list literal would not)
    const { text, diagnostics } = run(`
let m = [[2, 1], [1, 3]]
let d = Determinant(m)
let t = Transpose(m)
(d, t[1, 2], t[2, 1])`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('(5, 1, 1)');
  });

  test('descriptive statistics of a sample, exact', () => {
    const { text, diagnostics } = run(`
let xs = [4, 8, 15, 16, 23, 42]
(Mean(xs), Median(xs), Max(xs), Variance(xs))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('(18, 31/2, 42, 182)');
  });

  test('filter and reduce with anonymous functions', () => {
    const { text, diagnostics } = run(`
let evens = Filter(Range(1, 10), n |-> n % 2 == 0)
Reduce(evens, (acc, n) |-> acc + n)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('30');
  });

  test('chained indexing into a matrix', () => {
    const { text, diagnostics } = run(`
let m = [[1, 2], [3, 4]]
(m[2][1], m[2, 1])`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('(3, 3)');
  });

  test('pipe a collection into a function', () => {
    const { text, diagnostics } = run(`
[4, 8, 15, 16, 23, 42] |> Mean`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('18');
  });

  test('fold with an explicit initial value', () => {
    const { text, diagnostics } = run(`
Fold((acc, n) |-> acc + n^2, 0, Range(1, 5))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('55');
  });
});
