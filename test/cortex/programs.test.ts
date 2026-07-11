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
// - Collection literals (lists, tuples, sets, dictionaries) evaluate their
//   elements; lazy operators (`Range`/`Map`/`Filter`) are generators that
//   enumerate on demand and read program state at materialization time.
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

  test('trailing zeros of 100! by Legendre’s formula', () => {
    const { text, diagnostics } = run(`
let n = 100
let p = 5
let z = 0
while p <= n { z = z + Floor(n / p); p = p * 5 }
z`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('24');
  });

  test('trailing zeros of 100! by stripping the exact factorial', () => {
    // 100! is the exact 158-digit integer, so factors of 10 can be divided off.
    const { text, diagnostics } = run(`
let f = 100!
let count = 0
while f % 10 == 0 { f = f / 10; count = count + 1 }
count`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('24');
  });

  test('the five 5th-roots of unity sum to exactly zero', () => {
    const { text, diagnostics } = run(`
Sum(Exp(2*Pi*ImaginaryUnit*k/5), (k, 0, 4))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('0');
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

  test('a formatted table with StringJoin, interpolation and escapes', () => {
    // The header is a plain string literal whose `\t`/`\n` escapes are real
    // control characters; each body row splices computed numbers with `\(…)`.
    const { value, diagnostics } = run(`
let header = "n\\tn^2\\tn^3\\n"
let lines = Map(Range(1, 5), n |-> "\\(n)\\t\\(n^2)\\t\\(n^3)\\n")
StringJoin(header, Fold((acc, line) |-> StringJoin(acc, line), "", lines))`);
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe(
      'n\tn^2\tn^3\n1\t1\t1\n2\t4\t8\n3\t9\t27\n4\t16\t64\n5\t25\t125\n'
    );
  });
});

describe('CORTEX PROGRAMS — collections', () => {
  test('matrix determinant, transpose and indexing', () => {
    // A final tuple evaluates its elements (as does a list literal)
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

  test('solve a 2x2 linear system exactly with LinearSolve', () => {
    // 2x + y = 5, x + 3y = 10  ->  (x, y) = (1, 3), exact for exact input.
    const { text, diagnostics } = run(`
let A = [[2, 1], [1, 3]]
let b = [5, 10]
LinearSolve(A, b)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('[1,3]');
  });

  test('errors are values: a bad element becomes NaN, the aggregate survives', () => {
    // "banana" is out of Sqrt's domain, so its slot materializes as NaN while
    // the valid inputs still compute — the Map never throws.
    const { text, diagnostics } = run(`
let inputs = [16, -4, "banana", 81]
Map(inputs, x |-> Sqrt(x))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('[4,2i,NaN,9]');
  });
});

describe('CORTEX PROGRAMS — collection literals evaluate their elements', () => {
  // Collection LITERALS evaluate their elements (lazy operators keep late
  // binding). Accumulating single-element list literals through a loop no
  // longer captures the dead block-scoped loop variable.
  test('accumulating list literals through a loop yields evaluated elements', () => {
    const { text, diagnostics } = run(`
let xs = []
for k in Range(1, 3) { xs = Join(xs, [k]) }
xs`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('[1,2,3]');
  });

  test('a list literal as final statement evaluates its elements', () => {
    const { text, diagnostics } = run(`
let d = 5
[d, d + 1]`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('[5,6]');
  });
});

describe('CORTEX PROGRAMS — higher-order functions', () => {
  test('a numeric-derivative factory (a lambda closing over f and h)', () => {
    // Central difference of x^3 at 2 with h = 1/1000 is exact: 3·2² + h².
    const { text, diagnostics } = run(`
deriv(f, h) = x |-> (f(x + h) - f(x - h)) / (2h)
g(x) = x^3
let dg = deriv(g, 1/1000)
dg(2)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('12000001/1000000');
  });

  test('N numericizes a user-function/closure call in one step', () => {
    const { text, diagnostics } = run(`
deriv(f, h) = x |-> (f(x + h) - f(x - h)) / (2h)
g(x) = x^3
let dg = deriv(g, 1/1000)
N(dg(2))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('12.000001');
  });

  test('function composition captures the right bindings', () => {
    const { text, diagnostics } = run(`
compose(f, g) = x |-> f(g(x))
inc(x) = x + 1
sq(x) = x^2
let h = compose(sq, inc)
(h(4), compose(inc, sq)(4))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('(25, 17)');
  });
});

describe('CORTEX PROGRAMS — calculus', () => {
  test('symbolic Integrate keeps parameters (work to stretch a spring)', () => {
    const { text, diagnostics } = run(`Integrate(k*x, (x, 0, d))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('1/2 * k * d^2');
  });

  test('a definite integral evaluates exactly', () => {
    const { text, diagnostics } = run(`Integrate(Sin(x), (x, 0, Pi))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('2');
  });

  test('Limit — leading error of the small-angle approximation', () => {
    const { text, diagnostics } = run(`Limit((Sin(x) - x)/x^3, x, 0)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('-1/6');
  });

  test('Series — Taylor expansion of sine', () => {
    const { text, diagnostics } = run(`Series(Sin(x), x, 0)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('1/120 * x^5 - 1/6 * x^3 + x + BigO(x^7)');
  });
});

describe('CORTEX PROGRAMS — units and measurements', () => {
  test('unit conversion through a $…$ LaTeX island (km/h → m/s)', () => {
    const { text, diagnostics } = run(
      `N(UnitConvert($30\\,\\mathrm{km/h}$, $\\mathrm{m/s}$))`
    );
    expect(diagnostics).toEqual([]);
    expect(text).toBe('8.333333333333334 m/s');
  });

  test('uncertainty propagates in quadrature through a product', () => {
    // σ = √(20²·0.1² + 10²·0.2²) = √8 ≈ 2.83
    const { text, diagnostics } = run(`
let L = Measurement(10, 0.1)
let W = Measurement(20, 0.2)
N(L * W)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('200.0 ± 2.8');
  });
});

describe('CORTEX PROGRAMS — dictionaries', () => {
  test('a dictionary as a lookup table (Roman numeral decoder)', () => {
    const { text, diagnostics } = run(`
let value = {"I" -> 1, "V" -> 5, "X" -> 10, "L" -> 50, "C" -> 100, "D" -> 500, "M" -> 1000}
let s = ["M","C","M","X","C","I","V"]
let n = Length(s)
let total = 0
for i in Range(1, n) {
  let cur = value[s[i]]
  if i < n && cur < value[s[i + 1]] { total = total - cur } else { total = total + cur }
}
total`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('1994');
  });

  test('build a frequency dictionary from a stream and read it back', () => {
    const { text, diagnostics } = run(`
let words = ["red","blue","red","green","blue","red","blue"]
let t = Tally(words)
let freq = DictionaryFrom(Zip(t[1], t[2]))
(freq["red"], freq["blue"], freq["green"])`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('(3, 3, 1)');
  });

  test('Keys and Values enumerate a dictionary', () => {
    const { text, diagnostics } = run(`
let scores = {"alice" -> 90, "bob" -> 85, "carol" -> 95}
(Keys(scores), Max(Values(scores)))`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('(["alice","bob","carol"], 95)');
  });
});

describe('CORTEX PROGRAMS — sets', () => {
  test('common divisors as the intersection of two divisor lists', () => {
    // Intersection over lists deduplicates and returns a Set.
    const { text, diagnostics } = run(`
let d48 = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]
let d36 = [1, 2, 3, 4, 6, 9, 12, 18, 36]
Intersection(d48, d36)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('Set(1, 2, 3, 4, 6, 12)');
  });

  test('set equality compares by membership, not representation', () => {
    // A computed set (here an Intersection result) equals a set literal with
    // the same elements. Regression: the collection `eq` handlers used to
    // return a definitive False on operator mismatch, so this compared False.
    const { text, diagnostics } = run(`
let d48 = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]
let d36 = [1, 2, 3, 4, 6, 9, 12, 18, 36]
Intersection(d48, d36) == {1, 2, 3, 4, 6, 12}`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('"True"');
  });
});
