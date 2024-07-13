import { BoxedExpression, ComputeEngine } from '../../src/compute-engine';
import { add, mul } from '../../src/compute-engine/boxed-expression/numerics';
import { primeFactors as bigPrimeFactors } from '../../src/compute-engine/numerics/numeric-bigint';
import { primeFactors } from '../../src/compute-engine/numerics/primes';
import {
  Rational,
  reducedRational,
} from '../../src/compute-engine/numerics/rationals';

function randNumbers(n: number): number[] {
  let randos: number[] = [];
  for (let i = 0; i < n; i++) {
    const n = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    randos.push(n);
  }
  return randos;
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
    if (i % 2 === 0)
      return ce.add(
        ce.evalMul(ce.number([4, 3]), ce.pow(n, 2)),
        ce.evalMul(n, ce.number([3, 2])),
        ce.number(2)
      );
    // Trigonometry, log, exp
    return ce.add(
      ce.box(['Tan', n]),
      ce.box(['Log', ['Abs', n]]),
      ce.box(['Exp', n])
    );
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
      return ce
        .box([
          'Add',
          [
            'Multiply',
            ['Rational', 4, 3],
            ['Square', n],
            ['Multiply', ['Rational', 3, 2], n],
            2,
          ],
        ])
        .N();

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

  randos = [];
  bigrandos = [];

  const N = 1000000;
  for (let i = 0; i < N * 4; i++) {
    const n = Math.floor(Math.random() * 20000) - 10000;
    randos.push(n);
    bigrandos.push(BigInt(n));
  }

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

  ce.numericMode = 'machine';
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

  ce.numericMode = 'machine';
  ce.strict = false;

  let y = 0;
  const startTime = performance.now();
  for (let x = 0; x <= Math.PI; x += 0.01) {
    ce.assign('x', x);
    y += Number(expr3.value);
  }

  return performance.now() - startTime;
}

function turboEval() {
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
    console.error(e);
  }
  return 0;
}

describe('Rationals', () => {
  it('bigint vs number', () => expect(perfTestRationals()).toBeLessThan(1.7));
});

describe('Compute Engine modes', () => {
  const slow = slowEval();
  const fast = fastEval();
  const turbo = turboEval();

  console.log(`Slow = ${(slow / turbo).toFixed(2)} x compiled`);
  console.log(`Fast = ${(fast / turbo).toFixed(2)} x compiled`);

  it('slow vs turbo', () => expect(slow / turbo).toBeLessThan(180));
  it('fast vs turbo', () => expect(fast / turbo).toBeLessThan(70));
});

describe('Relative performance', () => {
  it('is relative to JS', () => {
    const randos = randNumbers(1000);
    let jsb = jsBaseline(randos);
    if (jsb === 0) jsb = 0.00001;

    // console.profile();
    const ceb = ceBaseline(randos);
    // console.profileEnd();

    console.log(`Compute Engine = ${(ceb / jsb).toFixed(2)} x native JS`);

    // console.profile();
    const cebN = ceBaselineN(randos);
    // console.profileEnd();

    console.log(`Compute Engine 2 = ${(cebN / jsb).toFixed(2)} x native JS`);
    expect(ceb / jsb).toBeLessThan(500);
    expect(cebN / jsb).toBeLessThan(11000);
  });
});
