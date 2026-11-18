/**
 * The value kind `enclosure` in the interval mode (README, "The interval
 * mode", "Enclosures"; `docs/plans/2026-10-26-value-kinds.md`, section
 * 4.9.2, "Compilation").
 *
 * An enclosure is an interval of the mode: an input of a type with an
 * `enclosure` arm (`enclosure`, `real | enclosure`, `enclosure | nan`) is a
 * `real` input (`enclosureInput()`), and a value that may be an enclosure
 * is a `real` value. A node of the walk with such an operand or result is
 * lowered here (`enclosureLowering()`), with the operations of its own
 * rows (`ENCLOSURE_ROWS`, `enc.*`), which no pass of the mode reads and
 * which the mode's real rules (the exact-zero fold, `narrow`,
 * `subtractions()`, the power and constant tables of `lower.ts`) never
 * produce. Each node is the `_IA` call that the `.N()` route of the
 * interpreter makes for the same form (`enclosure-arithmetic.ts`): the same
 * outward conversion of a number operand (`outwardDoubles()`), the same
 * exponent table for a power, the same composition `1 / x^|n|` for a
 * negative integer power, the same step scaling for a rounding function, so
 * that the compiled code and `.N()` give the same doubles.
 *
 * The heads are an allow-list that fails closed: a node with an operand or a
 * result that may be an enclosure, whose head is not in the list or whose
 * operands the interpreter leaves unevaluated (`Factorial(x)`, `Log(x, c)`
 * with `c: enclosure`, `Mod(5, c)`), declines with the message of the kind.
 * The control-flow and structural heads (`If`, `Which`, `Block`, `Sum`, …)
 * are lowered by the walk, which treats an enclosure as an interval.
 *
 * The results: an arithmetic result is wrapped in `_IA.enclose()`, which
 * removes the metadata of the library (`partial`, `singular`) and answers
 * `empty` (the indeterminate value) for an infinite singleton or a `NaN`
 * end, as the interpreter maps a library result. An operand that may be
 * infinite goes through `_IA.finiteOperand()` before an arithmetic kernel.
 * A comparison reads its operands through `_IA.stripEnclosure()`, and an
 * extremum wraps its result in it.
 */

import type { Type } from '../../../common/type/types.js';
import { isSubtype, provablyDisjoint } from '../../../common/type/subtype.js';
import { SIGNED_INFINITY_TYPE } from '../../../common/type/primitive.js';
import {
  hasKindArm,
  withoutKindArms,
  type KindTypeNames,
} from '../../../common/type/utils.js';
import type { Expression } from '../../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import { asRational } from '../../boxed-expression/numerics.js';
import { halfTurnAngle } from '../../boxed-expression/trigonometry.js';
import {
  realPowerBranchTerms,
  realPowerReconstructionDigits,
} from '../../numerics/real-power.js';
import {
  enclosureEndpointClass,
  enclosureEndpointOrder,
  enclosureRange,
  exponentForm,
  isPointRange,
  isSafe,
  outwardDoubles,
  UNARY_RULES,
  type ExponentForm,
} from '../../library/enclosure-arithmetic.js';
import {
  ENCLOSURE_UNARY_KERNELS,
  hasEnclosureArm,
} from '../../library/enclosure-compile.js';
import { CONTROL_FLOW_HEADS } from '../compiler-tables.js';
import { R, row, rowOfOp, type OperatorRow } from './operators.js';
import type { Lane, V } from './ir.js';
import { decline, type Fn, type Lowering } from './lower-context.js';

const ENCLOSURE: KindTypeNames = { has: (name) => name === 'enclosure' };

/** The kind, as the messages of a decline name it. */
const KIND = "the kind type 'enclosure'";

/** The IR type of an input of the engine type `t` that may be an enclosure:
 *  a scalar `real` when `t` has an `enclosure` arm and its other arms are
 *  numbers (`real | enclosure`, `number | enclosure`, `enclosure | nan`);
 *  else `undefined`. */
export function enclosureInput(
  t: Type
): { lane: Lane; shape: (number | 'run-time')[] } | undefined {
  if (!hasEnclosureArm(t)) return undefined;
  const rest = withoutKindArms(t, ENCLOSURE);
  if (rest !== 'never' && !isSubtype(rest, 'number')) return undefined;
  return { lane: 'real', shape: [] };
}

/** True when a value of the type `t` may be a collection of enclosures
 *  (`list<enclosure>`), which the compiled form does not describe (the
 *  representation of a value kind is one value), as
 *  `holdsKindCollection()` of `kind-lowering.ts` reads it. */
export function isEnclosureCollection(t: Type): boolean {
  if (!hasKindArm(t, ENCLOSURE)) return false;
  const rest = withoutKindArms(t, ENCLOSURE);
  const arms =
    typeof rest !== 'string' && rest.kind === 'union' ? rest.types : [rest];
  return arms.some(
    (arm) =>
      typeof arm !== 'string' &&
      arm.kind !== 'signature' &&
      hasKindArm(arm, ENCLOSURE)
  );
}

/** The message of a decline of a collection of enclosures. */
export const COLLECTION = `a collection of values of ${KIND}: the compiled representation of a value kind describes one value`;

/** The heads that the walk lowers with an enclosure operand as it lowers
 *  an interval: they hold, pass or choose a value, and compute nothing with
 *  it (`compileKindOperation()` of `compile-kinds.ts` reads the same). */
const STRUCTURAL = new Set([
  ...CONTROL_FLOW_HEADS,
  'List',
  'Tuple',
  'Hold',
  'Apply',
]);

/** True when the walk lowers `e` here: an `Enclosure` literal, or a node of
 *  a head that is not structural with an operand or a result that may be
 *  an enclosure. */
export function isEnclosureNode(e: Fn): boolean {
  if (e.operator === 'Enclosure') return true;
  if (STRUCTURAL.has(e.operator)) return false;
  return (
    hasEnclosureArm(e.type.type) ||
    e.ops.some((x) => hasEnclosureArm(x.type.type))
  );
}

/** The heads whose operands the walk lowers as a loop or a quadrature of
 *  the mode's real rules (the terms of a sum added with `_IA.add`, with no
 *  `_IA.enclose()`): the interpreter's value of such a node over an
 *  enclosure is not that, and the library has no kernel for it. */
const AGGREGATES = new Set(['Sum', 'Product', 'Integrate', 'NIntegrate']);

/** True when `e` reads or makes a value that may be an enclosure, at any
 *  depth. */
function readsEnclosure(e: Expression): boolean {
  const seen = new Set<Expression>();
  const visit = (x: Expression): boolean => {
    if (seen.has(x)) return false;
    seen.add(x);
    if (isSymbol(x)) return hasEnclosureArm(x.type.type);
    if (!isFunction(x)) return false;
    return (
      x.operator === 'Enclosure' ||
      hasEnclosureArm(x.type.type) ||
      x.ops.some(visit)
    );
  };
  return visit(e);
}

/**
 * The cause of the decline of the node `e` by the kind, or `undefined`:
 * - `call`, a call of a user function or of a host's `compile` handler,
 *   with an operand that may be an enclosure: the body (or the handler's
 *   expression) would be lowered by the rules of a real, where the
 *   interpreter applies the kind's (`f(t) = t^{-2}` at `[-1, 1]`);
 * - `Sum`, `Product`, `Integrate` and `NIntegrate` whose operands read an
 *   enclosure.
 */
export function enclosureRefusal(e: Fn, call: boolean): string | undefined {
  if (call && e.ops.some((x) => hasEnclosureArm(x.type.type)))
    return `a call of ${e.operator} with an operand of ${KIND}: its body would be lowered by the rules of a real number`;
  if (AGGREGATES.has(e.operator) && readsEnclosure(e))
    return `${e.operator} of a value of ${KIND}: the library has no kernel for it`;
  return undefined;
}

//
// The rows and the spellings
//

const COMPARISONS: Readonly<Record<string, string>> = {
  Less: 'less',
  Greater: 'greater',
  LessEqual: 'lessEqual',
  GreaterEqual: 'greaterEqual',
  Equal: 'equal',
  NotEqual: 'notEqual',
};

const ROUNDING: Readonly<Record<string, string>> = {
  Floor: 'floor',
  Ceil: 'ceil',
  Truncate: 'trunc',
  Round: 'round',
};

/** The tie rules of `Round` other than the default (`roundingTies`). */
const TIES = [
  'to-even',
  'toward-zero',
  'toward-positive-infinity',
  'toward-negative-infinity',
];

const kernel = (k: string, arity: number) =>
  `_IA.${k}(${Array.from({ length: arity }, (_, i) => `$${i}`).join(', ')})`;

/** The spelling of each operation of the kind (`print-interval.ts`). */
// prettier-ignore
export const ENCLOSURE_SPELLINGS: Readonly<Record<string, string>> =
  Object.freeze({
    'enc.enclose': '_IA.enclose($0)',
    'enc.strip': '_IA.stripEnclosure($0)',
    'enc.finite': '_IA.finiteOperand($0)',
    // The interval `[lo, hi]` of two point constants.
    'enc.range': '{ lo: $0.lo, hi: $1.hi }',
    ...Object.fromEntries(
      [...new Set([...Object.values(ENCLOSURE_UNARY_KERNELS), 'negate', 'exp',
        'sqrt', 'square', 'log10', 'log2', 'ln', 'abs',
        ...Object.values(ROUNDING)])].map((k) => [`enc.${k}`, kernel(k, 1)])
    ),
    ...Object.fromEntries(TIES.map((t) => [`enc.round.${t}`, `_IA.round($0, "${t}")`])),
    ...Object.fromEntries(['add', 'sub', 'mul', 'div', 'hypot', 'atan2', 'max',
      'min', 'powInterval'].map((k) => [`enc.${k}`, kernel(k, 2)])),
    'enc.clamp': kernel('clamp', 3),
    // A point exponent, a constant: its double.
    'enc.pow': '_IA.pow($0, $1.lo)',
    'enc.powRational': '_IA.powRational($0, $1.lo, $2.lo)',
    'enc.powBranch.odd': '_IA.powRealBranch($0, $1.lo, true)',
    'enc.powBranch.even': '_IA.powRealBranch($0, $1.lo, false)',
    // A zero divisor is the indeterminate value, tested before the kernel,
    // which answers the whole line for it.
    'enc.mod':
      '((_x, _m) => { const _v = _IA.unwrap(_m); return _v !== undefined && _v.lo === 0 && _v.hi === 0 ? { kind: "empty" } : _IA.enclose(_IA.mod(_x, _m)); })($0, $1)',
    ...Object.fromEntries(Object.values(COMPARISONS).map((k) => [`enc.${k}`, kernel(k, 2)])),
    'enc.and': '_IA.and($0, $1)',
  });

/** The rows of the operations of the kind: no head, so that only this
 *  module makes them. */
export const ENCLOSURE_ROWS: readonly OperatorRow[] = Object.entries(
  ENCLOSURE_SPELLINGS
).map(([op, spelling]) => {
  const arity = (spelling.match(/\$(\d)/g) ?? []).reduce<number>(
    (n, s) => Math.max(n, Number(s[1]) + 1),
    0
  ) as 1 | 2 | 3;
  const verdict = Object.values(COMPARISONS).some((k) => op === `enc.${k}`);
  const lanes: Lane[] = Array.from({ length: arity }, () =>
    op === 'enc.and' ? 'boolean' : R
  );
  return row(
    undefined,
    arity,
    [[lanes, verdict || op === 'enc.and' ? 'boolean' : R, op]],
    {}
  );
});

//
// The lowering
//

/** True when a value of the type `t` may be `+oo` or `-oo`. */
function admitsInfinity(t: Readonly<Type>): boolean {
  return !provablyDisjoint(t as Type, SIGNED_INFINITY_TYPE);
}

/** True when the operand `x` may be an enclosure (the first operand of a
 *  function of the `apply` table must be). */
function mayBeEnclosure(x: Expression | undefined): x is Expression {
  return x !== undefined && hasEnclosureArm(x.type.type);
}

/** The point of a literal `Enclosure(a, a)`, or `undefined`. */
function literalPoint(x: Expression): Expression | undefined {
  if (!isFunction(x, 'Enclosure') || x.nops !== 2) return undefined;
  const r = enclosureRange(x);
  return r !== undefined && isPointRange(r) ? r.lo : undefined;
}

/** True when the base `b` of a power with an exponent that is not a point
 *  is provably positive, from its literal (a positive number, a literal
 *  enclosure whose lower endpoint is positive) or from its type. */
function provablyPositiveBase(b: Expression): boolean {
  if (isFunction(b, 'Enclosure')) {
    const r = enclosureRange(b);
    return r !== undefined && outwardDoubles(r.lo)[0] > 0;
  }
  if (hasEnclosureArm(b.type.type)) return false;
  return b.isPositive === true && b.isFinite !== false;
}

/**
 * The lowering of the nodes that `isEnclosureNode()` selects, on the walk
 * `cx`. `use` is called for each such node: the program then reads or makes
 * an enclosure (`Program.valueKinds`). A node that the kind does not define
 * declines with the message of the kind.
 */
export function enclosureLowering(
  cx: Lowering,
  use: () => void
): (e: Fn) => V {
  const { b } = cx;
  let node: Fn;

  const no = (why = 'an operation that the interpreter leaves unevaluated'): never =>
    decline(node, `${node.operator} with an operand or a result of ${KIND}: ${why}`);

  const op = (name: string, args: V[]): V =>
    cx.apply(node, rowOfOp(cx.rows, name)!.row, args);
  const real = (x: number): V => b.constant(x, 'real');
  /** The indeterminate value, `{ kind: 'empty' }`. */
  const empty = (): V => real(NaN);
  /** The interval `[lo, hi]`: a point when `lo === hi`. */
  const interval = (lo: number, hi: number): V =>
    lo === hi ? real(lo) : op('enc.range', [real(lo), real(hi)]);
  const enclose = (v: V): V => op('enc.enclose', [v]);
  const strip = (v: V): V => op('enc.strip', [v]);
  /** The left fold of `vs` by the operation `name`. */
  const fold = (name: string, vs: V[]): V =>
    vs.slice(1).reduce((a, v) => op(name, [a, v]), vs[0]);

  /**
   * The operand `x`, or `undefined` when the operation declines it:
   * - a finite real number literal, or an exact constant of class 2 (`Pi`,
   *   `Sin(1)`), is the interval of its OUTWARD conversion to doubles: a
   *   point when the value is a double (`0.1` is
   *   `[0.09999999999999999, 0.1]`), as the interpreter converts it under
   *   `.N()`;
   * - an infinite literal is the point `±Infinity`;
   * - a complex literal and `NaN` decline (the interpreter leaves the call
   *   unevaluated);
   * - any other operand is lowered by the walk, a scalar number.
   *
   * With `finite`, an operand that may be infinite goes through
   * `_IA.finiteOperand()`, which answers `empty` for an infinite point
   * before the kernel reads it.
   */
  const operand = (x: Expression, finite: boolean): V | undefined => {
    if (isNumber(x)) {
      if (x.isNaN === true || x.isComplex) return undefined;
      if (x.isFinite === false) {
        const v = real(x.re > 0 ? Infinity : -Infinity);
        return finite ? op('enc.finite', [v]) : v;
      }
      return interval(...outwardDoubles(x));
    }
    if (!hasEnclosureArm(x.type.type) && enclosureEndpointClass(x) === 2)
      return interval(...outwardDoubles(x));
    const v = cx.value(x)!;
    const t = cx.type(v);
    if (t.shape.length > 0 || (t.lane !== 'real' && t.lane !== 'integer'))
      return undefined;
    return finite && admitsInfinity(x.type.type) ? op('enc.finite', [v]) : v;
  };

  const operands = (
    xs: ReadonlyArray<Expression>,
    finite: boolean
  ): V[] | undefined => {
    const vs: V[] = [];
    for (const x of xs) {
      const v = operand(x, finite);
      if (v === undefined) return undefined;
      vs.push(v);
    }
    return vs;
  };

  /** An arithmetic operation `name` over `args` (a fold of a binary one),
   *  enclosed. */
  const arithmetic = (
    name: string,
    args: ReadonlyArray<Expression>,
    arity?: number
  ): V | undefined => {
    if (args.length === 0 || (arity !== undefined && args.length !== arity))
      return undefined;
    const vs = operands(args, true);
    if (vs === undefined) return undefined;
    if (vs.length === 1) return enclose(op(`enc.${name}`, vs));
    return enclose(fold(`enc.${name}`, vs));
  };

  /** The factor of the angular unit, `undefined` in radians: the
   *  radians of the unit (`in`, an operand), or the units of a radian
   *  (`out`, a result), the outward interval of the exact factor, as the
   *  `.N()` route converts a result (`angleFromRadians()`). */
  const angle = (direction: 'in' | 'out'): V | undefined => {
    const ce = node.engine;
    if (ce.angularUnit === 'rad') return undefined;
    const [pi, half] = [ce.Pi, halfTurnAngle(ce)];
    const factor = ce
      .function('Divide', direction === 'in' ? [pi, half] : [half, pi])
      .evaluate();
    return interval(...outwardDoubles(factor));
  };

  // `Power`

  /** The power of the interval `x` to a point exponent of the form `form`:
   *  the table of the `.N()` route (`numericPower()` of
   *  `enclosure-arithmetic.ts`). `undefined` for an integer beyond the safe
   *  integers: the kernels take a double, which loses its parity. */
  const pointPower = (
    x: V,
    form: ExponentForm,
    precision: number
  ): V | undefined => {
    switch (form.kind) {
      case 'integer': {
        if (!isSafe(form.n)) return undefined;
        const n = Number(form.n);
        if (n === 2) return op('enc.square', [x]);
        if (n < 0) {
          const positive =
            n === -2 ? op('enc.square', [x]) : op('enc.pow', [x, real(-n)]);
          return op('enc.div', [real(1), positive]);
        }
        return op('enc.pow', [x, real(n)]);
      }
      case 'rational': {
        if (form.p === 1n && form.q === 2n) return op('enc.sqrt', [x]);
        if (form.q % 2n === 1n && isSafe(form.p) && isSafe(form.q))
          return op('enc.powRational', [
            x,
            real(Number(form.p)),
            real(Number(form.q)),
          ]);
        return op('enc.pow', [x, real(Number(form.p) / Number(form.q))]);
      }
      case 'float': {
        const value = form.value;
        if (value === 0.5) return op('enc.sqrt', [x]);
        const terms = realPowerBranchTerms(
          undefined,
          value,
          realPowerReconstructionDigits(precision)
        );
        if (terms !== undefined && terms[1] % 2 !== 0) {
          const [p, q] = terms;
          return p / q === value
            ? op('enc.powRational', [x, real(p), real(q)])
            : op(p % 2 !== 0 ? 'enc.powBranch.odd' : 'enc.powBranch.even', [
                x,
                real(value),
              ]);
        }
        return op('enc.pow', [x, real(value)]);
      }
      case 'constant':
        return op('enc.pow', [x, real(form.value.N().re)]);
    }
  };

  /** `base^e` for a point exponent `e` (a number, a class 2 constant, or a
   *  free symbol typed by a number type, a point at run time). */
  const powerByPoint = (base: Expression, e: Expression): V | undefined => {
    if (isSymbol(base, 'ExponentialE')) {
      const y = operand(e, true);
      return y === undefined ? undefined : enclose(op('enc.exp', [y]));
    }
    const x = operand(base, true);
    if (x === undefined) return undefined;
    if (isNumber(e) || enclosureEndpointClass(e) === 2) {
      if (isNumber(e) && (e.isNaN === true || e.isComplex)) return undefined;
      // An infinite exponent gives the indeterminate value, as in the
      // interpreter.
      if (isNumber(e) && e.isFinite === false) return empty();
      const form = exponentForm(e);
      if (form === undefined) return undefined;
      const v = pointPower(x, form, e.engine.precision);
      return v === undefined ? undefined : enclose(v);
    }
    // An exponent read at run time (`x^n` with `n: integer`): `powInterval`
    // takes a point exponent as a point.
    const y = operand(e, true);
    return y === undefined
      ? undefined
      : enclose(op('enc.powInterval', [x, y]));
  };

  const power = (base: Expression, exponent: Expression): V | undefined => {
    if (!hasEnclosureArm(exponent.type.type))
      return powerByPoint(base, exponent);
    // A point enclosure exponent is read as its point:
    // `(-2)^Enclosure(2, 2)` is `Enclosure(4, 4)`.
    const point = literalPoint(exponent);
    if (point !== undefined) return powerByPoint(base, point);
    const y = operand(exponent, false);
    if (y === undefined) return undefined;
    if (isSymbol(base, 'ExponentialE')) return enclose(op('enc.exp', [y]));
    // An exponent that is not a point: the base must be provably positive,
    // else the interpreter leaves the call unevaluated.
    if (!provablyPositiveBase(base)) return undefined;
    const x = operand(base, true);
    return x === undefined
      ? undefined
      : enclose(op('enc.powInterval', [x, y]));
  };

  /** `x` to the exponent of the form `form` (`Sqrt`, `Square`). */
  const powerForm = (x: Expression, form: ExponentForm): V | undefined => {
    const v = operand(x, true);
    if (v === undefined) return undefined;
    const p = pointPower(v, form, x.engine.precision);
    return p === undefined ? undefined : enclose(p);
  };

  const half: ExponentForm = { kind: 'rational', p: 1n, q: 2n };

  /** `Root(x, k)`: the power `x^(1/k)`. */
  const root = (args: ReadonlyArray<Expression>): V | undefined => {
    const [x, k] = args;
    if (args.length === 1) return powerForm(x, half);
    if (args.length !== 2 || hasEnclosureArm(k.type.type)) return undefined;
    if (isNumber(k)) {
      if (k.isNaN === true || k.isComplex || k.isFinite === false)
        return undefined;
      const ce = k.engine;
      const e = k.isExact
        ? ce.function('Divide', [ce.One, k]).evaluate()
        : ce.number(1 / k.re);
      return powerByPoint(x, e);
    }
    const base = operand(x, true);
    const degree = operand(k, true);
    if (base === undefined || degree === undefined) return undefined;
    return enclose(
      op('enc.powInterval', [base, op('enc.div', [real(1), degree])])
    );
  };

  // The functions of the `apply` table

  /** `Floor`, `Ceil`, `Round`, `Truncate`, with an optional point step: the
   *  step form is `round(x / k) · k` with `k = |step|`, the division and the
   *  product outward, so that an enclosure that the division widens across
   *  a jump answers as the one-operand form does. An exact step `1/m` or
   *  `m` (`m` a safe integer) scales through the exact point `m`: `1/100`
   *  has no double, and dividing by an enclosure of it would widen a tie
   *  (`Round(0.125, 1/100)`) across its jump. */
  const rounding = (args: ReadonlyArray<Expression>): V | undefined => {
    if (args.length > 2 || !mayBeEnclosure(args[0])) return undefined;
    const [x, step] = args;
    if (step !== undefined && hasEnclosureArm(step.type.type)) return undefined;
    const ties = node.engine.roundingTies;
    const name =
      node.operator === 'Round' && ties !== 'away-from-zero'
        ? `enc.round.${ties}`
        : `enc.${ROUNDING[node.operator]}`;
    const v = operand(x, true);
    if (v === undefined) return undefined;
    if (step === undefined) return enclose(op(name, [v]));
    // The step is read twice: an impure step (a draw) fails closed.
    if (step.isPure === false) return undefined;
    const r = asRational(step);
    if (r !== undefined) {
      const [p, q] = [Math.abs(Number(r[0])), Number(r[1])];
      if (p === 1 && Number.isSafeInteger(q) && q > 0)
        return enclose(
          op('enc.div', [op(name, [op('enc.mul', [v, real(q)])]), real(q)])
        );
      if (q === 1 && Number.isSafeInteger(p) && p > 0)
        return enclose(
          op('enc.mul', [op(name, [op('enc.div', [v, real(p)])]), real(p)])
        );
    }
    const s = operand(step, true);
    if (s === undefined) return undefined;
    const k = op('enc.abs', [s]);
    return enclose(op('enc.mul', [op(name, [op('enc.div', [v, k])]), k]));
  };

  /** `Mod(x, m)` with a point divisor `m`. A zero divisor is the
   *  indeterminate value (`enc.mod`). */
  const mod = (args: ReadonlyArray<Expression>): V | undefined => {
    if (args.length !== 2 || !mayBeEnclosure(args[0])) return undefined;
    const [x, m] = args;
    if (hasEnclosureArm(m.type.type)) return undefined;
    const xs = operand(x, true);
    if (xs === undefined) return undefined;
    if (isNumber(m)) {
      if (m.isNaN === true || m.isComplex || m.isFinite === false)
        return undefined;
      if (m.re === 0) return empty();
    }
    const ms = operand(m, true);
    return ms === undefined ? undefined : op('enc.mod', [xs, ms]);
  };

  /** `Log(x)` (base 10) and `Log(x, b)` with a point base `b`. */
  const log = (args: ReadonlyArray<Expression>): V | undefined => {
    if (args.length > 2 || !mayBeEnclosure(args[0])) return undefined;
    const xs = operand(args[0], true);
    if (xs === undefined) return undefined;
    if (args.length === 1) return enclose(op('enc.log10', [xs]));
    const base = args[1];
    if (hasEnclosureArm(base.type.type)) return undefined;
    const quotient = (bs: V) =>
      enclose(op('enc.div', [op('enc.ln', [xs]), op('enc.ln', [bs])]));
    if (isNumber(base) || enclosureEndpointClass(base) === 2) {
      if (isNumber(base) && (base.isNaN === true || base.isComplex))
        return undefined;
      // `Log(x, +oo)` is the limit `0`, as for a number; `Log(x, -oo)`
      // stays unevaluated.
      if (isNumber(base) && base.isFinite === false)
        return base.re < 0 ? undefined : quotient(real(Infinity));
      // A base that is not positive, or that is `1`, leaves the call
      // unevaluated.
      const ce = base.engine;
      const sign = enclosureEndpointOrder(base, ce.Zero);
      const unit = enclosureEndpointOrder(base, ce.One);
      if (sign === undefined || sign <= 0 || unit === undefined || unit === 0)
        return undefined;
      const [lo, hi] = outwardDoubles(base);
      if (lo === 2 && hi === 2) return enclose(op('enc.log2', [xs]));
      if (lo === 10 && hi === 10) return enclose(op('enc.log10', [xs]));
      return quotient(interval(lo, hi));
    }
    // A base read at run time (`Log(x, b)` with `b: real`).
    const bs = operand(base, false);
    return bs === undefined ? undefined : quotient(bs);
  };

  /** The comparisons, with their operands read through
   *  `_IA.stripEnclosure()`. A chain of three or more operands is the
   *  conjunction of the comparisons of each pair of neighbours, for the
   *  four orders and for `Equal` and `NotEqual`, as the interpreter decides
   *  it (`orderAnswer()`, `boxed-expression/kind-compare.ts`); each operand
   *  is computed once. */
  const comparison = (args: ReadonlyArray<Expression>): V | undefined => {
    if (args.length < 2) return undefined;
    const vs = operands(args, false);
    if (vs === undefined) return undefined;
    const s = vs.map(strip);
    const name = `enc.${COMPARISONS[node.operator]}`;
    const pairs = s.slice(1).map((v, i) => op(name, [s[i], v]));
    return fold('enc.and', pairs);
  };

  /** `Max`, `Min`, `ElementMax`, `ElementMin` and `Clamp`, with the result
   *  read through `_IA.stripEnclosure()`: an infinite number that wins is
   *  the result, as in the interpreter. */
  const extremum = (args: ReadonlyArray<Expression>): V | undefined => {
    if (args.length === 0) return undefined;
    const vs = operands(args, false);
    if (vs === undefined) return undefined;
    if (node.operator === 'Clamp')
      return vs.length === 3 ? strip(op('enc.clamp', vs)) : undefined;
    const name =
      node.operator === 'Max' || node.operator === 'ElementMax'
        ? 'enc.max'
        : 'enc.min';
    return strip(fold(name, vs));
  };

  /** A function of one operand of the `apply` table, with the angle
   *  conversion of its rule (`UNARY_RULES`): the operand of a direct
   *  trigonometric function in radians, the result of an inverse one in the
   *  engine's unit. */
  const unary = (args: ReadonlyArray<Expression>): V | undefined => {
    const k = ENCLOSURE_UNARY_KERNELS[node.operator];
    if (k === undefined || args.length !== 1 || !mayBeEnclosure(args[0]))
      return undefined;
    let v = operand(args[0], true);
    if (v === undefined) return undefined;
    const direction = UNARY_RULES[node.operator]?.angle;
    const factor = direction === undefined ? undefined : angle(direction);
    if (direction === 'in' && factor !== undefined)
      v = op('enc.mul', [v, factor]);
    let y = op(`enc.${k}`, [v]);
    if (direction === 'out' && factor !== undefined)
      y = op('enc.mul', [y, factor]);
    return enclose(y);
  };

  /** A literal `Enclosure(a, b)` whose endpoints are of class 1 or 2: the
   *  interval of the outward conversion of the endpoints, ordered as
   *  `[min(down), max(up)]`, so that a pair whose order was not decided
   *  (`Enclosure(Sin(10^600), 0)`) is never reversed. The same infinity
   *  twice is the indeterminate value. */
  const literal = (e: Fn): V => {
    const [a, c] = e.ops;
    if (
      e.nops !== 2 ||
      enclosureEndpointClass(a) === 3 ||
      enclosureEndpointClass(c) === 3
    )
      decline(
        e,
        `Could not compile a value of \`Enclosure\` with an endpoint that is not a number or a constant: ${KIND} has no compiled form for it`
      );
    const da = outwardDoubles(a);
    const dc = outwardDoubles(c);
    const lo = Math.min(da[0], dc[0]);
    const hi = Math.max(da[1], dc[1]);
    if (lo === hi && !Number.isFinite(lo)) return empty();
    return interval(lo, hi);
  };

  const apply = (e: Fn): V | undefined => {
    const args = e.ops;
    switch (e.operator) {
      case 'Add':
        return arithmetic('add', args);
      case 'Multiply':
        return arithmetic('mul', args);
      case 'Negate':
        return arithmetic('negate', args, 1);
      case 'Subtract':
        return arithmetic('sub', args, 2);
      case 'Divide':
        return arithmetic('div', args, 2);
      case 'Power':
        return args.length === 2 ? power(args[0], args[1]) : undefined;
      case 'Sqrt':
        return args.length === 1 ? powerForm(args[0], half) : undefined;
      case 'Square':
        return args.length === 1
          ? powerForm(args[0], { kind: 'integer', n: 2n, exact: true })
          : undefined;
      case 'Root':
        return root(args);
      case 'Exp':
        return args.length === 1 && mayBeEnclosure(args[0])
          ? arithmetic('exp', args, 1)
          : undefined;
      case 'Floor':
      case 'Ceil':
      case 'Round':
      case 'Truncate':
        return rounding(args);
      case 'Mod':
        return mod(args);
      case 'Log':
        return log(args);
      case 'Hypot':
        return arithmetic('hypot', args, 2);
      case 'Arctan2': {
        // An infinite operand takes the limit value, as for a number: no
        // `_IA.finiteOperand()` here.
        if (args.length !== 2) return undefined;
        const vs = operands(args, false);
        if (vs === undefined) return undefined;
        const factor = angle('out');
        const y = op('enc.atan2', vs);
        return enclose(
          factor === undefined ? y : op('enc.mul', [y, factor])
        );
      }
      case 'Max':
      case 'Min':
      case 'ElementMax':
      case 'ElementMin':
      case 'Clamp':
        return extremum(args);
    }
    if (e.operator in COMPARISONS) return comparison(args);
    return unary(args);
  };

  return (e: Fn): V => {
    use();
    const outer = node;
    node = e;
    try {
      if (e.operator === 'Enclosure') return literal(e);
      return apply(e) ?? no();
    } finally {
      node = outer;
    }
  };
}
