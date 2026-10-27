/**
 * The head `Enclosure`, the constructor of the values of the VALUE KIND
 * `enclosure` (`docs/plans/2026-10-26-value-kinds.md`, section 4.9.2). The
 * arithmetic of the kind (`ENCLOSURE_ARITHMETIC`) is in
 * `enclosure-arithmetic.ts`.
 *
 * `Enclosure(lo, hi)` is a closed, connected enclosure of one real number:
 * the real is somewhere in `[lo, hi]`. It is not the SET `Interval(lo, hi)`,
 * whose `Abs` is its cardinality: the enclosure stands for one number, and
 * `Abs(Enclosure(-1, 2))` is `Enclosure(0, 2)`.
 *
 * The canonical form:
 * - orders the endpoints when the order is decided: `Enclosure(2, 1)` is
 *   `Enclosure(1, 2)`; a pair whose order is not decided
 *   (`Enclosure(Sin(10^600), 0)`) stays as written;
 * - reads one operand as a point: `Enclosure(3)` is `Enclosure(3, 3)`;
 * - converts a set `Interval(a, b)` (open bounds taken as closed) when its
 *   bounds are decided: `Enclosure(Interval(0, 1))` is `Enclosure(0, 1)`,
 *   and an empty set (`Interval(2, 1)`, `Interval(Open(1), Open(1))`) is
 *   the indeterminate value;
 * - refuses with `incompatible-type` an endpoint that is not an extended
 *   real (`i`, `~oo`, a string), an endpoint that is a value of a kind (a
 *   measurement, a quantity, an enclosure: the admission of the kinds is not
 *   subtyping, and would admit them), and a set beside a second operand.
 *
 * The evaluation evaluates the endpoints, checks them again (a symbol whose
 * value is a measurement is refused then), orders them again, and gives the
 * indeterminate value for a `NaN` endpoint, for the same infinity twice
 * (`Enclosure(+oo, +oo)` holds no real) and for an empty set. Under `.N()`
 * the endpoints are converted to doubles OUTWARD:
 * `Enclosure(0, Pi).N()` is `Enclosure(0, 3.1415926535897936)`.
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
} from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { isKindValue } from '../boxed-expression/kind-compare.js';
import { provablyDisjoint } from '../../common/type/subtype.js';
import {
  ENCLOSURE_ARITHMETIC,
  enclosureEndpointClass,
  enclosureEndpointOrder,
  enclosureEq,
  numericEnclosure,
} from './enclosure-arithmetic.js';
import { ENCLOSURE_COMPILE } from './enclosure-compile.js';

/** The types an endpoint may have: an extended real, or `NaN`. */
const ENDPOINT_TYPE = 'real | signed_infinity | nan';

/**
 * The `incompatible-type` error for the endpoint `x` when it is refused: a
 * value of a kind, a set, or a value whose type is provably not an
 * extended real (`i`, `~oo`, a string, a list). `undefined` when `x` is
 * accepted (a real, an infinity, `NaN`, or a value not known yet: a symbol
 * typed `number` is checked again at evaluation).
 */
function refusedEndpoint(
  ce: ComputeEngine,
  x: Expression
): Expression | undefined {
  if (isFunction(x, 'Error')) return undefined;
  const type = ce.type(ENDPOINT_TYPE);
  if (isKindValue(x) || isFunction(x, 'Interval'))
    return ce.typeError(ce.type(ENDPOINT_TYPE).type, x.type, x);
  if (isNumber(x)) {
    // A complex number, and the complex infinity, are not on the real line.
    if (x.isComplex && x.isNaN !== true)
      return ce.typeError(ce.type(ENDPOINT_TYPE).type, x.type, x);
    return undefined;
  }
  if (provablyDisjoint(x.type.type, type.type))
    return ce.typeError(ce.type(ENDPOINT_TYPE).type, x.type, x);
  return undefined;
}

/** The bound `x` of a set `Interval` and whether it is open. */
function setBound(x: Expression): [Expression, boolean] {
  if (isFunction(x, 'Open')) return [x.op1, true];
  if (isFunction(x, 'Closed')) return [x.op1, false];
  return [x, false];
}

/** The indeterminate value: `Indeterminate` when every operand is exact,
 * `NaN` when one is a float or `NaN` (the exact-twin rule of `NaN`). */
function indeterminateOf(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>
): Expression {
  return xs.some(
    (x) =>
      isNumber(x) && (x.isNaN === true || (x.isFinite === true && !x.isExact))
  )
    ? ce.NaN
    : ce.Indeterminate;
}

/** True when `a` and `b` are the same infinity. */
function sameInfinity(a: Expression, b: Expression): boolean {
  return (
    isNumber(a) &&
    isNumber(b) &&
    a.isFinite === false &&
    b.isFinite === false &&
    !a.isComplex &&
    !b.isComplex &&
    a.isNaN !== true &&
    b.isNaN !== true &&
    Math.sign(a.re) === Math.sign(b.re)
  );
}

/**
 * The enclosure of the endpoints `a` and `b`: ordered when their order is
 * decided, the indeterminate value for a `NaN` endpoint or the same infinity
 * twice, converted outward to doubles under `.N()`.
 */
function enclosureOf(
  ce: ComputeEngine,
  a: Expression,
  b: Expression,
  numericApproximation: boolean
): Expression {
  if (a.isNaN === true || b.isNaN === true || sameInfinity(a, b))
    return numericApproximation ? ce.NaN : indeterminateOf(ce, [a, b]);
  const o = enclosureEndpointOrder(a, b);
  const [lo, hi] = o !== undefined && o > 0 ? [b, a] : [a, b];
  if (numericApproximation) {
    const numeric = numericEnclosure(ce, lo, hi);
    if (numeric !== undefined) return numeric;
  }
  return ce._fn('Enclosure', [lo, hi]);
}

/**
 * The enclosure of the set `Interval(lo, hi)`, when both bounds are of class
 * 1 or 2 and their order is decided; open bounds are taken as closed. An
 * empty set (`lo > hi`, or `lo = hi` with an open side) is the
 * indeterminate value. `undefined` when the conversion is not decided yet.
 */
function enclosureOfSet(
  ce: ComputeEngine,
  set: Expression,
  numericApproximation: boolean
): Expression | undefined {
  if (!isFunction(set, 'Interval') || set.nops !== 2) return undefined;
  const [lo, loOpen] = setBound(set.op1);
  const [hi, hiOpen] = setBound(set.op2);
  if (enclosureEndpointClass(lo) === 3 || enclosureEndpointClass(hi) === 3)
    return undefined;
  const o = enclosureEndpointOrder(lo, hi);
  if (o === undefined) return undefined;
  if (o > 0 || (o === 0 && (loOpen || hiOpen)))
    return numericApproximation ? ce.NaN : indeterminateOf(ce, [lo, hi]);
  return enclosureOf(ce, lo, hi, numericApproximation);
}

/**
 * The value of `Enclosure(...ops)` after its operands are evaluated: the
 * checks of the canonical form again (an endpoint whose value is a value of
 * a kind or not a real is `incompatible-type`), then the order, the
 * indeterminate value, and the conversion of a set.
 */
function evaluateEnclosure(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression | undefined {
  // The set `Interval` is lazy: its evaluation does not replace a symbol
  // by its value, so its bounds are evaluated here, keeping `Open` and
  // `Closed` (`Enclosure(Interval(a, 2))` with `a := 3` is the empty set).
  const xs = ops.map((x) =>
    isFunction(x, 'Interval')
      ? ce._fn(
          'Interval',
          x.ops.map((b) =>
            isFunction(b, 'Open') || isFunction(b, 'Closed')
              ? ce._fn(b.operator, [b.op1.evaluate()])
              : b.evaluate()
          )
        )
      : x.evaluate()
  );
  if (xs.length === 1) {
    const [x] = xs;
    if (isFunction(x, 'Interval'))
      return (
        enclosureOfSet(ce, x, numericApproximation) ?? ce._fn('Enclosure', [x])
      );
    const refused = refusedEndpoint(ce, x);
    if (refused !== undefined) return refused;
    return enclosureOf(ce, x, x, numericApproximation);
  }
  if (xs.length !== 2) return undefined;
  for (const x of xs) {
    const refused = refusedEndpoint(ce, x);
    if (refused !== undefined) return refused;
  }
  return enclosureOf(ce, xs[0], xs[1], numericApproximation);
}

export const ENCLOSURE_LIBRARY: SymbolDefinitions = {
  Enclosure: {
    description:
      'A closed interval [lo, hi] that encloses one real number, with interval arithmetic.',
    complexity: 1200,
    lazy: true,
    // An enclosure is a value of the VALUE KIND `enclosure`
    // (`ENCLOSURE_ARITHMETIC`): an opaque type, admitted where a real is
    // admitted, with its own arithmetic, order and image of a function.
    // The result can be `NaN` for an empty set or a `NaN` endpoint.
    signature:
      '(real | signed_infinity | nan | set<real>, (real | signed_infinity | nan)?) -> enclosure | nan',
    // An enclosure with two endpoints that are not `NaN` is a value; a set
    // operand or an endpoint that may be `NaN` can give the indeterminate
    // value.
    type: (ops, { engine }) => {
      const nan = engine.type('nan').type;
      if (
        ops.length === 2 &&
        ops.every((op) => provablyDisjoint(op.type, nan)) &&
        !ops.every(
          (op) =>
            !provablyDisjoint(op.type, engine.type('signed_infinity').type)
        )
      )
        return engine.type('enclosure');
      return engine.type('enclosure | nan');
    },
    // Its compiled form (`ENCLOSURE_COMPILE`) is the interval of the
    // `interval-js` target; every other target declines it.
    arithmetic: { ...ENCLOSURE_ARITHMETIC, compile: ENCLOSURE_COMPILE },
    // The same point, or two disjoint enclosures, decide `Equal`; two
    // enclosures that overlap may hold the same real, and `Equal` stays
    // unevaluated (`enclosureEq()`).
    eq: (a, b) => enclosureEq(a, b),
    examples: [
      'Enclosure(0, 1) + Enclosure(1/3, 2)',
      'Sin(Enclosure(0, Pi))',
      'N(Enclosure(0, Pi))',
    ],
    canonical: (args, { engine: ce }) => {
      if (args.length < 1 || args.length > 2)
        return ce.error('incompatible-type');
      const ops = args.map((x) => x.canonical);
      if (ops.length === 1) {
        const [x] = ops;
        if (isFunction(x, 'Interval'))
          return enclosureOfSet(ce, x, false) ?? ce._fn('Enclosure', [x]);
        // Another set (a `Set` literal) is not an enclosure of a real. A
        // symbol typed as a set is kept and read at evaluation, when its
        // value may be an `Interval`.
        if (x.type.matches('set') && !x.type.isUnknown)
          return ce._fn('Enclosure', [
            isFunction(x)
              ? ce.typeError(ce.type(ENDPOINT_TYPE).type, x.type, x)
              : x,
          ]);
        const refused = refusedEndpoint(ce, x);
        if (refused !== undefined) return ce._fn('Enclosure', [refused]);
        return ce._fn('Enclosure', [x, x]);
      }
      const checked = ops.map((x) => refusedEndpoint(ce, x) ?? x);
      if (checked.some((x, i) => x !== ops[i]))
        return ce._fn('Enclosure', checked);
      const [a, b] = ops;
      const o = enclosureEndpointOrder(a, b);
      return ce._fn('Enclosure', o !== undefined && o > 0 ? [b, a] : [a, b]);
    },
    // Every operand is evaluated, and nothing else is read of it: the bounds
    // of a set operand are evaluated again, which gives the same value when
    // the asynchronous route has evaluated the set first.
    evaluatesOperands: true,
    evaluate: (ops, { numericApproximation, engine: ce }) =>
      evaluateEnclosure(ce, ops, numericApproximation === true),
  },
};
