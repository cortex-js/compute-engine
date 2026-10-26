// Test kinds for the value-kinds tests
// (`docs/plans/2026-10-26-value-kinds.md`, sections 4.3, 4.4 and 4.10).
//
// - `GF8: (integer) -> gf8`, the field with 8 elements: an element is a
//   polynomial of degree < 3 over GF(2), held as its 3-bit representative.
//   Addition is the XOR of the representatives, multiplication is the
//   product of the polynomials modulo x³ + x + 1, `negate` is the identity,
//   `divide` multiplies by the inverse and declines a zero divisor, `power`
//   multiplies repeatedly and declines an exponent that is not a
//   non-negative integer (`Sqrt` reaches it with `1/2`). No `compare`, no
//   `apply`: `admittedAs` is `'none'`.
// - `MyMod: (integer, integer) -> residue` (the head of issue #477): a
//   class of ℤ/nℤ. `add` and `multiply` fold the `MyMod` operands of one
//   modulus, one fold per modulus, and the exact integer and rational
//   literals when there is one modulus only. They read `exact(i)`, so that
//   under `.N()` a rational operand is read exactly.
// - `UserMeasurement: (number, real) -> umeasurement`, a measurement with a
//   nominal value and a standard uncertainty, `admittedAs: 'number'`. The
//   arithmetic is the first-order propagation of `measurement-arithmetic.ts`
//   (independent errors in quadrature); `power` also takes a positive real
//   base with a measurement exponent (`Exp(U)` is `Power(e, U)`);
//   `compare` orders by the nominal;
//   `apply` propagates through a unary operator whose derivative the engine
//   knows, `Factorial` as `Gamma(a + 1)`, `Floor`/`Ceil`/`Round` on the exact
//   nominal, and `Mean` over the elements of a list. Every hook returns a
//   `UserMeasurement`, also with a zero uncertainty.

import { ComputeEngine } from '../../src/compute-engine';
import type {
  ArithmeticDefinition,
  Expression,
  KindFold,
  KindOperands,
} from '../../src/compute-engine';
import { residueOfLiteral } from '../../src/compute-engine/boxed-expression/residue-class';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { unaryDerivativeFormula } from '../../src/compute-engine/symbolic/derivative';

//
// GF(8)
//

/** The product of two elements of GF(8), as 3-bit representatives. */
export function gfMul(a: number, b: number): number {
  let r = 0;
  for (let i = 0; i < 3; i++) if (b & (1 << i)) r ^= a << i;
  // Reduce modulo x³ + x + 1 (0b1011).
  for (let i = 4; i >= 3; i--) if (r & (1 << i)) r ^= 0b1011 << (i - 3);
  return r;
}

function gfOf(x: Expression): number | undefined {
  if (!isFunction(x, 'GF8') || x.nops !== 1) return undefined;
  const k = x.op1.re;
  return Number.isInteger(k) ? k & 7 : undefined;
}

function gfFold(
  ops: KindOperands,
  engine: ComputeEngine,
  step: (a: number, b: number) => number,
  unit: number
): KindFold[] | undefined {
  const idx = ops.evaluated
    .map((x, i) => (gfOf(x) !== undefined ? i : -1))
    .filter((i) => i >= 0);
  if (idx.length < 2) return undefined;
  const v = idx.reduce((acc, i) => step(acc, gfOf(ops.evaluated[i])!), unit);
  return [{ value: engine.function('GF8', [engine.number(v)]), operands: idx }];
}

export const GF8_ARITHMETIC: ArithmeticDefinition = {
  add: (ops, { engine }) =>
    gfFold(ops, engine as ComputeEngine, (a, b) => a ^ b, 0),
  multiply: (ops, { engine }) => gfFold(ops, engine as ComputeEngine, gfMul, 1),
  negate: (x) => (gfOf(x.evaluated) !== undefined ? x.evaluated : undefined),
  divide: (a, b, { engine }) => {
    const x = gfOf(a.evaluated);
    const y = gfOf(b.evaluated);
    if (x === undefined || y === undefined || y === 0) return undefined;
    let inverse = 0;
    for (let k = 1; k < 8; k++) if (gfMul(y, k) === 1) inverse = k;
    return engine.function('GF8', [engine.number(gfMul(x, inverse))]);
  },
  power: (base, exponent, { engine }) => {
    const x = gfOf(base.evaluated);
    const e = exponent.exact();
    if (x === undefined || e.isInteger !== true || e.isNonNegative !== true)
      return undefined;
    let r = 1;
    for (let k = 0; k < e.re; k++) r = gfMul(r, x);
    return engine.function('GF8', [engine.number(r)]);
  },
};

/** Declare the type `gf8` and its head `GF8` in `ce`. */
export function declareGF8(ce: ComputeEngine): void {
  ce.declareType('gf8', 'value', { mint: false });
  ce.declare('GF8', {
    signature: '(integer) -> gf8',
    arithmetic: GF8_ARITHMETIC,
  });
}

//
// MyMod
//

function myModOf(x: Expression): { k: bigint; n: bigint } | undefined {
  if (!isFunction(x, 'MyMod') || x.nops !== 2) return undefined;
  const k = x.op1.re;
  const n = x.op2.re;
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1) return undefined;
  return { k: BigInt(k), n: BigInt(n) };
}

function myMod(engine: ComputeEngine, k: bigint, n: bigint): Expression {
  return engine.function('MyMod', [
    engine.number(((k % n) + n) % n),
    engine.number(n),
  ]);
}

function myModFolds(
  ops: KindOperands,
  engine: ComputeEngine,
  operation: 'add' | 'multiply'
): KindFold[] {
  const groups = new Map<bigint, number[]>();
  ops.evaluated.forEach((_, i) => {
    const r = myModOf(ops.exact(i));
    if (r !== undefined) groups.set(r.n, [...(groups.get(r.n) ?? []), i]);
  });
  // A literal is read in the ring of the classes only when there is one.
  const literals: number[] = [];
  if (groups.size === 1) {
    const n = [...groups.keys()][0];
    ops.evaluated.forEach((_, i) => {
      const x = ops.exact(i);
      if (myModOf(x) === undefined && residueOfLiteral(x, n) !== undefined)
        literals.push(i);
    });
  }
  const folds: KindFold[] = [];
  for (const [n, idx] of groups) {
    const all = groups.size === 1 ? [...idx, ...literals] : idx;
    if (all.length < 2) continue;
    let acc = operation === 'add' ? 0n : 1n;
    for (const i of all) {
      const x = ops.exact(i);
      const k = myModOf(x)?.k ?? residueOfLiteral(x, n)!.k;
      acc = operation === 'add' ? acc + k : acc * k;
    }
    folds.push({ value: myMod(engine, acc, n), operands: all });
  }
  return folds;
}

export const MYMOD_ARITHMETIC: ArithmeticDefinition = {
  add: (ops, { engine }) => myModFolds(ops, engine as ComputeEngine, 'add'),
  multiply: (ops, { engine }) =>
    myModFolds(ops, engine as ComputeEngine, 'multiply'),
  negate: (x, { engine }) => {
    const r = myModOf(x.exact());
    return r === undefined
      ? undefined
      : myMod(engine as ComputeEngine, -r.k, r.n);
  },
};

/** Declare the head `MyMod: (integer, integer) -> residue` in `ce`. */
export function declareMyMod(ce: ComputeEngine): void {
  ce.declare('MyMod', {
    signature: '(integer, integer) -> residue',
    arithmetic: MYMOD_ARITHMETIC,
  });
}

//
// UserMeasurement
//

type Pair = { value: Expression; sigma: Expression };

/** The nominal and the uncertainty of `x`: a `UserMeasurement` call, or a
 * number literal (an exact value, uncertainty 0). `undefined` otherwise. */
function pairOf(ce: ComputeEngine, x: Expression): Pair | undefined {
  if (isFunction(x, 'UserMeasurement') && x.nops === 2)
    return { value: x.op1, sigma: x.op2 };
  if (isNumber(x)) return { value: x, sigma: ce.Zero };
  return undefined;
}

/** A `UserMeasurement` with the nominal `value` and the uncertainty `sigma`,
 * both evaluated (numericized under `.N()`). No collapse to the bare nominal
 * when the uncertainty is zero. */
function measurement(
  ce: ComputeEngine,
  value: Expression,
  sigma: Expression,
  numericApproximation: boolean
): Expression {
  const opts = { numericApproximation };
  return ce.function('UserMeasurement', [
    value.evaluate(opts),
    sigma.evaluate(opts),
  ]);
}

const sq = (ce: ComputeEngine, x: Expression): Expression =>
  ce.function('Power', [x, 2]);

/** The folds of `add` (`multiply`): every `UserMeasurement` and number
 * literal of the operands, in one fold, when there is at least one
 * measurement and at least two such operands. */
function measurementFold(
  ops: KindOperands,
  ce: ComputeEngine,
  operation: 'add' | 'multiply',
  numericApproximation: boolean
): KindFold[] | undefined {
  const idx: number[] = [];
  let measurements = 0;
  ops.evaluated.forEach((x, i) => {
    if (isFunction(x, 'UserMeasurement')) measurements += 1;
    if (pairOf(ce, x) !== undefined) idx.push(i);
  });
  if (measurements === 0 || idx.length < 2) return undefined;
  let acc = pairOf(ce, ops.evaluated[idx[0]])!;
  for (const i of idx.slice(1)) {
    const b = pairOf(ce, ops.evaluated[i])!;
    if (operation === 'add')
      acc = {
        value: ce.function('Add', [acc.value, b.value]).evaluate(),
        sigma: ce.function('Sqrt', [
          ce.function('Add', [sq(ce, acc.sigma), sq(ce, b.sigma)]),
        ]),
      };
    else
      acc = {
        value: ce.function('Multiply', [acc.value, b.value]).evaluate(),
        sigma: ce.function('Sqrt', [
          ce.function('Add', [
            ce.function('Multiply', [sq(ce, b.value), sq(ce, acc.sigma)]),
            ce.function('Multiply', [sq(ce, acc.value), sq(ce, b.sigma)]),
          ]),
        ]),
      };
  }
  return [
    {
      value: measurement(ce, acc.value, acc.sigma, numericApproximation),
      operands: idx,
    },
  ];
}

/** The operators whose result jumps: they read the exact nominal, keep the
 * uncertainty, and refuse a complex nominal. */
const STEP_OPERATORS = new Set(['Floor', 'Ceil', 'Round']);

/** The hooks that `apply` was called with, in order, for the tests that
 * count them. */
export const APPLY_CALLS: string[] = [];

/** The `Mean` of the elements `xs`: the mean of the nominals, and the
 * uncertainties in quadrature over `n`. `undefined` when an element is not
 * a measurement or a number literal. */
function measurementMean(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression | undefined {
  if (xs.length === 0) return undefined;
  const pairs = xs.map((x) => pairOf(ce, x));
  if (pairs.some((p) => p === undefined)) return undefined;
  const n = ce.number(xs.length);
  const value = ce.function('Divide', [
    ce.function(
      'Add',
      pairs.map((p) => p!.value)
    ),
    n,
  ]);
  const sigma = ce.function('Divide', [
    ce.function('Sqrt', [
      ce.function(
        'Add',
        pairs.map((p) => sq(ce, p!.sigma))
      ),
    ]),
    n,
  ]);
  return measurement(ce, value, sigma, numericApproximation);
}

export const USER_MEASUREMENT_ARITHMETIC: ArithmeticDefinition = {
  admittedAs: 'number',
  add: (ops, { engine, numericApproximation }) =>
    measurementFold(ops, engine as ComputeEngine, 'add', numericApproximation),
  multiply: (ops, { engine, numericApproximation }) =>
    measurementFold(
      ops,
      engine as ComputeEngine,
      'multiply',
      numericApproximation
    ),
  negate: (x, { engine, numericApproximation }) => {
    const ce = engine as ComputeEngine;
    const a = pairOf(ce, x.evaluated);
    if (a === undefined) return undefined;
    return measurement(ce, a.value.neg(), a.sigma, numericApproximation);
  },
  divide: (num, den, { engine, numericApproximation }) => {
    const ce = engine as ComputeEngine;
    const A = pairOf(ce, num.evaluated);
    const B = pairOf(ce, den.evaluated);
    if (A === undefined || B === undefined) return undefined;
    const value = ce.function('Divide', [A.value, B.value]);
    // σ = √(σ_a²/b² + a²σ_b²/b⁴)
    const sigma = ce.function('Sqrt', [
      ce.function('Add', [
        ce.function('Divide', [sq(ce, A.sigma), sq(ce, B.value)]),
        ce.function('Divide', [
          ce.function('Multiply', [sq(ce, A.value), sq(ce, B.sigma)]),
          ce.function('Power', [B.value, 4]),
        ]),
      ]),
    ]);
    return measurement(ce, value, sigma, numericApproximation);
  },
  power: (base, exponent, { engine, numericApproximation }) => {
    const ce = engine as ComputeEngine;
    const A = pairOf(ce, base.evaluated);
    const e = exponent.evaluated;
    // A positive real number literal, or `e`, raised to a measurement
    // (`Exp(U)` is `Power(e, U)`): b^a, with σ = |b^a·ln b|·σ_a.
    if (
      (isNumber(base.evaluated) || isSymbol(base.evaluated, 'ExponentialE')) &&
      isFunction(e, 'UserMeasurement') &&
      e.nops === 2
    ) {
      const b = base.evaluated;
      if (b.im !== 0 || b.isPositive !== true) return undefined;
      const value = ce.function('Power', [b, e.op1]);
      const sigma = ce.function('Multiply', [
        ce.function('Abs', [
          ce.function('Multiply', [value, ce.function('Ln', [b])]),
        ]),
        e.op2,
      ]);
      return measurement(ce, value, sigma, numericApproximation);
    }
    // Otherwise, only a measurement raised to a number literal.
    if (A === undefined || !isFunction(base.evaluated, 'UserMeasurement'))
      return undefined;
    if (!isNumber(e)) return undefined;
    const value = ce.function('Power', [A.value, e]);
    // σ = |b·a^(b−1)|·σ_a
    const sigma = ce.function('Multiply', [
      ce.function('Abs', [
        ce.function('Multiply', [
          e,
          ce.function('Power', [A.value, ce.function('Subtract', [e, 1])]),
        ]),
      ]),
      A.sigma,
    ]);
    return measurement(ce, value, sigma, numericApproximation);
  },
  compare: (a, b, { engine }) => {
    const ce = engine as ComputeEngine;
    const x = pairOf(ce, a.exact())?.value;
    const y = pairOf(ce, b.exact())?.value;
    if (x === undefined || y === undefined) return undefined;
    if (!isNumber(x) || !isNumber(y)) return undefined;
    if (x.isNaN || y.isNaN || x.im !== 0 || y.im !== 0) return undefined;
    // Two exact nominals are compared exactly, two floats within the engine
    // tolerance (`isEqual()` of two number literals).
    if (x.isEqual(y) === true) return 0;
    const less = x.isLess(y);
    if (less === undefined) return undefined;
    return less ? -1 : 1;
  },
  apply: (operator, ops, { engine, numericApproximation }) => {
    APPLY_CALLS.push(operator);
    const ce = engine as ComputeEngine;
    if (operator === 'Mean') {
      const xs = ops.elements(0);
      return xs === undefined
        ? undefined
        : measurementMean(ce, xs, numericApproximation);
    }
    if (ops.evaluated.length !== 1) return undefined;
    const x = ops.exact(0);
    if (!isFunction(x, 'UserMeasurement')) return undefined;
    const a = x.op1;
    const sigma = x.op2;
    if (STEP_OPERATORS.has(operator)) {
      if (!isNumber(a) || a.im !== 0) return ce.typeError('real', a.type, x);
      return measurement(
        ce,
        ce.function(operator, [a]),
        sigma,
        numericApproximation
      );
    }
    if (operator === 'Factorial') {
      // n! = Γ(n + 1)
      const shifted = ce.function('Add', [a, 1]).evaluate();
      const d = unaryDerivativeFormula(ce, 'Gamma', shifted);
      if (d === undefined) return undefined;
      return measurement(
        ce,
        ce.function('Gamma', [shifted]),
        ce.function('Multiply', [ce.function('Abs', [d]), sigma]),
        numericApproximation
      );
    }
    const d = unaryDerivativeFormula(ce, operator, a);
    if (d === undefined) return undefined;
    return measurement(
      ce,
      ce.function(operator, [a]),
      ce.function('Multiply', [ce.function('Abs', [d]), sigma]),
      numericApproximation
    );
  },
};

/** Declare the type `umeasurement` and its head `UserMeasurement` in `ce`. */
export function declareUserMeasurement(ce: ComputeEngine): void {
  ce.declareType('umeasurement', 'value', { mint: false });
  ce.declare('UserMeasurement', {
    signature: '(number, real) -> umeasurement',
    arithmetic: USER_MEASUREMENT_ARITHMETIC,
  });
}
