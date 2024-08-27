import { ComputeEngine } from '../../src/compute-engine.ts';
import {
  add,
  mul,
  Rational,
  reducedRational,
} from '../../src/compute-engine/numerics/rationals';

/**
 * 
The constants `a`, `c`, and `m` in the Linear Congruential Generator (LCG) are chosen based on research and practical use in generating pseudo-random numbers. Here’s why those specific values were picked:

1. **Multiplier (`a = 1664525`)**: 
   - This value is a common choice in LCG implementations and was used in the implementation of the `rand()` function in early versions of the C standard library. 
   - It is chosen to maximize the period (the length before the sequence of numbers repeats) and to ensure good statistical properties, such as uniform distribution.

2. **Increment (`c = 1013904223`)**: 
   - This value was also used in many implementations, including the aforementioned `rand()` function. 
   - The choice of `c` as an odd number ensures that the generator has a full period (i.e., it can generate all possible values before repeating) when combined with certain values of `a` and `m`.

3. **Modulus (`m = 2 ** 32`)**: 
   - The modulus is typically chosen as a power of 2 because it makes the modulo operation very efficient on binary computers.
   - `2^32` is often used because it matches the word size of 32-bit computers, which was a common architecture when these constants were popularized.
   - The choice of `m` influences the range of generated numbers, and using `2^32` allows the generator to produce 32-bit integers.

### Historical Context
These constants have been used in practical implementations of random number generators for decades. The combination of these values is known to produce sequences with a long period and good randomness properties for many applications, though more modern generators may use different algorithms and constants for improved performance or randomness in certain contexts.

### Limitations
While these constants work well for many purposes, they aren’t perfect for all situations. For example:
- The sequences generated can have patterns if you generate a lot of numbers.
- The quality of randomness is not suitable for cryptographic purposes.

However, for simple applications, these constants are a solid choice and provide a good balance between performance and randomness.
*/

function generateNumbers(n: number, seed = 0): number[] {
  const results: number[] = [];
  let current = seed;

  // Constants for the LCG
  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;

  for (let i = 0; i < n; i++) {
    current = (a * current + c) % m;
    results.push(current);
  }

  return results;
}

/** Estable a baseline for computation performance in JS.
 * Compute Engine calculations will be measured against this.
 */
function jsBaseline(randos: number[]): number {
  let start = globalThis.performance.now();
  for (let i = 0; i < 20; i++) {
    randos = randos.map((n, i) => {
      // Do some arithmetic calculations
      if (i % 2 === 0) return (4 * n ** 2) / 3 + (3 * n) / 2 + 2;
      // Trigonometry, log, exp
      return Math.tan(n) + Math.log(Math.abs(n)) + Math.exp(n);
    });
  }
  return (globalThis.performance.now() - start) / 20;
}

function ceBaseline(numRandos: number[]): number {
  const ce = new ComputeEngine();

  let randos = numRandos.map((n) => ce.number(n));

  let start = globalThis.performance.now();

  randos = randos.map((n, i) => {
    // Do some arithmetic calculations
    if (i % 2 === 0) return n.mul(4).pow(2).div(3).add(n.mul(3).div(2)).add(2);
    // Trigonometry, log, exp
    return ce
      .box(['Tan', n])
      .add(ce.box(['Log', ['Abs', n]]).add(ce.box(['Exp', n])));
  });

  return globalThis.performance.now() - start;
}

function ceBaselineN(numRandos: number[]): number {
  const ce = new ComputeEngine();

  let randos = numRandos.map((n) => ce.number(n));

  let start = globalThis.performance.now();

  randos = randos.map((n, i) => {
    // Do some arithmetic calculations
    if (i % 2 === 0)
      if (i % 2 === 0)
        return n.mul(4).pow(2).div(3).add(n.mul(3).div(2)).add(2).N();

    // Trigonometry, log, exp
    return ce.box(['Add', ['Tan', n], ['Log', ['Abs', n], ['Exp', n]]]).N();
  });

  return globalThis.performance.now() - start;
}

function perfTestRationals() {
  let randos: number[] = [];
  let bigrandos: bigint[] = [];
  let timing: number;
  // const N1 = 200;
  // for (let i = 0; i < N1; i++) {
  //   const n = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  //   randos.push(n);
  //   bigrandos.push(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(n));
  // }

  // let start = globalThis.performance.now();

  // for (let i = 0; i < N1; i++) {
  //   primeFactors(randos[i]);
  // }

  // let timing = Math.floor((globalThis.performance.now() - start) / 10);

  // const primeNumber = timing;

  // start = globalThis.performance.now();

  // for (let i = 0; i < N1; i++) {
  //   bigPrimeFactors(bigrandos[i]);
  // }

  // timing = Math.floor((globalThis.performance.now() - start) / 10);

  // const primeBigint = timing;

  const N = 1000000;
  randos = generateNumbers(N * 4);
  bigrandos = randos.map((n) => BigInt(n));

  let start = globalThis.performance.now();
  let r: Rational = [1, 1];
  for (let i = 0; i < N; i++) {
    const a: Rational = reducedRational([randos[i], randos[i + 1]]);
    const b: Rational = reducedRational([randos[i + 2], randos[i + 3]]);
    r = reducedRational(mul(add(r, a), b));
  }

  timing = Math.floor((globalThis.performance.now() - start) / 10);

  const reduceNumber = timing;

  start = globalThis.performance.now();
  let r2: Rational = [1n, 1n];
  for (let i = 0; i < N; i++) {
    const a: Rational = reducedRational([bigrandos[i], bigrandos[i + 1]]);
    const b: Rational = reducedRational([bigrandos[i + 2], bigrandos[i + 3]]);
    r2 = reducedRational(mul(add(r, a), b));
  }

  timing = Math.floor((globalThis.performance.now() - start) / 10);

  const reduceBigint = timing;

  // return (primeBigint / primeNumber + reduceBigint / reduceNumber) / 2;
  return reduceBigint / reduceNumber;
}

function slowEval() {
  ///
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c'); // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  // Factor out substitution of constants

  ce.precision = 'auto';
  ce.strict = true;

  let y = 0;
  const startTime = performance.now();
  for (let x = 0; x <= Math.PI; x += 0.01) {
    y += Number(expr.subs(vars).subs({ x }).N().numericValue?.valueOf());
  }

  return performance.now() - startTime;
}

function fastEval() {
  ///
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c'); // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  // Factor out substitution of constants
  const expr3 = expr.subs(vars).N();

  ce.precision = 'machine';
  ce.strict = false;

  let y = 0;
  const startTime = performance.now();
  for (let x = 0; x <= Math.PI; x += 0.01) {
    ce.assign('x', x);
    y += Number(expr3.value);
  }

  return performance.now() - startTime;
}

function compiledEval() {
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c'); // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  // Factor out substitution of constants
  const expr3 = expr.subs(vars).N();

  try {
    const fn = expr3.compile()!;
    let y = 0;
    const startTime = performance.now();
    for (let x = 0; x <= Math.PI; x += 0.01) {
      y += fn({ x });
    }

    return performance.now() - startTime;
  } catch (e) {
    console.error(e.message);
  }
  return 0;
}

describe.skip('Rationals', () => {
  it('bigint vs number', () => expect(perfTestRationals()).toBeLessThan(1.8));
});

describe.skip('Compute Engine modes', () => {
  const slow = slowEval();
  const fast = fastEval();
  const turbo = compiledEval();

  // console.info(`Slow = ${Math.round(slow / turbo)} x compiled`);
  // console.info(`Fast = ${Math.round(fast / turbo)} x compiled`);

  it('precise strict vs compiled', () =>
    expect(slow / turbo).toBeLessThan(1600));
  it('machine non-strict vs compiled', () =>
    expect(fast / turbo).toBeLessThan(360));
});

describe.skip('Relative performance', () => {
  const randos = generateNumbers(1000).map((n) => n / 1000);
  let jsb = jsBaseline(randos);
  if (jsb === 0) jsb = 0.00001;

  // console.profile();
  const ceb = ceBaseline(randos);
  // console.profileEnd();

  // console.profile();
  const cebN = ceBaselineN(randos);
  // console.profileEnd();

  // console.info(
  //   `Compute Engine evaluate() = ${Math.round(ceb / jsb)} x native JS`
  // );
  // console.info(`Compute Engine N() = ${Math.round(cebN / jsb)} x native JS`);

  it('evaluate() relative to JS', () => {
    expect(ceb / jsb).toBeLessThan(1100);
  });
  it('N() relative to JS', () => {
    expect(cebN / jsb).toBeLessThan(2500);
  });
});
