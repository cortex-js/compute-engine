import { ComputeEngine } from '../../src/compute-engine.ts';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Linear Congruential Generator for deterministic pseudo-random numbers.
 * Constants from the classic C rand() implementation.
 */
function generateNumbers(n: number, seed = 0): number[] {
  const results: number[] = [];
  let current = seed;

  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;

  for (let i = 0; i < n; i++) {
    current = (a * current + c) % m;
    results.push(current);
  }

  return results;
}

/** Establish a baseline for computation performance in JS.
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
      .expr(['Tan', n])
      .add(ce.expr(['Log', ['Abs', n]]).add(ce.expr(['Exp', n])));
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
      return n.mul(4).pow(2).div(3).add(n.mul(3).div(2)).add(2).N();

    // Trigonometry, log, exp
    return ce.expr(['Add', ['Tan', n], ['Log', ['Abs', n]], ['Exp', n]]).N();
  });

  return globalThis.performance.now() - start;
}

function slowEval() {
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c')!; // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  ce.precision = 'auto';
  ce.strict = true;

  let y = 0;
  const startTime = performance.now();
  for (let x = 0; x <= Math.PI; x += 0.01) {
    y += Number(expr.subs(vars).subs({ x }).N().re);
  }

  return performance.now() - startTime;
}

function fastEval() {
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c')!; // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  // Factor out substitution of constants
  const expr3 = expr.subs(vars).N();

  ce.precision = 'machine';
  ce.strict = false;

  let y = 0;
  const startTime = performance.now();
  for (let x = 0; x <= Math.PI; x += 0.01) {
    ce.assign('x', x);
    y += Number(expr3.re);
  }

  return performance.now() - startTime;
}

function compiledEval() {
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c')!; // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  // Factor out substitution of constants
  const expr3 = expr.subs(vars).N();

  try {
    const result = compile(expr3);
    if (!result.run) throw new Error('fn is not a function');
    const fn = result.run;
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

describe.skip('Compute Engine modes', () => {
  it('precise strict vs compiled', () => {
    const slow = slowEval();
    const turbo = compiledEval();
    expect(slow / turbo).toBeLessThan(1600);
  });
  it('machine non-strict vs compiled', () => {
    const fast = fastEval();
    const turbo = compiledEval();
    expect(fast / turbo).toBeLessThan(360);
  });
});

describe.skip('Relative performance', () => {
  let jsb: number;
  let ceb: number;
  let cebN: number;

  beforeAll(() => {
    const randos = generateNumbers(1000).map((n) => n / 1000);
    jsb = jsBaseline(randos);
    if (jsb === 0) jsb = 0.00001;
    ceb = ceBaseline(randos);
    cebN = ceBaselineN(randos);
  });

  it('evaluate() relative to JS', () => {
    expect(ceb / jsb).toBeLessThan(1100);
  });
  it('N() relative to JS', () => {
    expect(cebN / jsb).toBeLessThan(2500);
  });
});
