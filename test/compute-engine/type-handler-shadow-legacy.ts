/**
 * @fixme TEMPORARY MIGRATION FIXTURE — this whole file MUST be deleted
 * when the expressions-shape `type` handler is retired; the shadow
 * registry's doc comment (`_legacyTypeHandlerShadow`,
 * `boxed-expression/operand-descriptor.ts`) lists every piece that goes
 * with it. Individual `LEGACY_TYPE_HANDLERS` entries retire earlier, once
 * their batch has shipped in a release.
 *
 * The LEGACY expressions-shape `type` handlers of operators that have been
 * converted to the `'types'` shape — moved here verbatim when each operator
 * converts, so the shadow-parity mechanism
 * (`checkShadowTypeParity`, `boxed-expression/operand-descriptor.ts`) can
 * run both shapes and throw on divergence. This file is a fixture, not a
 * test suite (jest only matches `*.test.ts`).
 *
 * Conversion protocol: when converting an operator in `library/*.ts`, copy
 * its old handler here unchanged — same reads, same branches — keyed by the
 * operator name, and let the parity suite (and any full run with the shadow
 * installed) prove the equivalence. Once a batch has been proven and
 * shipped for a release, its entries can be deleted.
 */

import type { Type } from '../../src/common/type/types';
import type { BoxedType } from '../../src/common/type/boxed-type';
import type {
  Expression,
  OperatorTypeHandlerOnExpressions,
  Sign,
} from '../../src/compute-engine/global-types';
import { _legacyTypeHandlerShadow } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import {
  collectionElementType,
  functionResult,
  signOfType,
  stripMissingFromType,
  widen,
} from '../../src/common/type/utils';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import {
  negativeSign,
  nonNegativeSign,
  nonPositiveSign,
  positiveSign,
} from '../../src/compute-engine/boxed-expression/sgn';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

/* ------------------------------------------------------------------------ *
 * FROZEN HELPERS
 *
 * The shared helpers of `library/type-handlers.ts` that the entries below
 * reach, copied here verbatim rather than imported. The differential this
 * fixture drives compares a converted operator's new `'types'` handler
 * against the expressions-shape handler it replaced, so the legacy side must
 * be a fixed reference point: if these entries called the LIVE helpers, any
 * later edit to `library/type-handlers.ts` would move both sides of the
 * comparison at once and the shadow would keep reporting parity while the
 * behavior it was meant to preserve drifted away underneath it. Copies here
 * cannot drift — an edit to a live helper that changes an answer shows up as
 * a divergence, which is exactly the signal this apparatus exists to give.
 * The copies are pinned to the pre-conversion sources at commit 045c2655.
 *
 * Two helpers outside `library/type-handlers.ts` are copied for the same
 * reason: `provablyNonFiniteNumber` (`boxed-expression/numerics.ts`), a
 * three-line predicate that several of these handlers gate on, and
 * `negateNumericType` (`common/type/utils.ts`), which is the whole of
 * `Negate`'s legacy handler. Both are small and self-contained, so freezing
 * them costs nothing.
 *
 * NOT frozen, and deliberately imported live above: the general engine
 * utilities `signOfType`, `collectionElementType`, `widen`, `positiveSign`,
 * `negativeSign` and `isNumber`. These are not migration helpers — they are
 * shared vocabulary that BOTH shapes call, so a change to one of them is
 * meant to move both sides together, and freezing them would manufacture
 * divergences that report nothing about the conversion.
 * ------------------------------------------------------------------------ */

/** Frozen copy of `provablyNonFiniteNumber` (boxed-expression/numerics.ts). */
function frozenProvablyNonFiniteNumber(x: Expression): boolean {
  if (x.isNaN === true || x.isInfinity === true) return true;
  return x.isFinite === false && x.type.matches('number');
}

/** Frozen copy of `negateNumericType` (common/type/utils.ts). */
function frozenNegateNumericType(t: Type): Type {
  if (typeof t === 'string') return t;
  switch (t.kind) {
    case 'numeric': {
      const lo = t.lower ?? undefined;
      const hi = t.upper ?? undefined;
      if (lo === undefined && hi === undefined) return t;
      // `-0` normalizes to `0` so a reflected closed-at-zero bound stays
      // the canonical spelling.
      return {
        kind: 'numeric',
        type: t.type,
        ...(hi !== undefined ? { lower: hi === 0 ? 0 : -hi } : {}),
        ...(lo !== undefined ? { upper: lo === 0 ? 0 : -lo } : {}),
      };
    }
    case 'value': {
      const v = t.value;
      if (typeof v !== 'number' || Number.isNaN(v)) return t;
      return v === 0 ? t : { kind: 'value', value: -v };
    }
    case 'negation': {
      const inner = frozenNegateNumericType(t.type);
      return inner === t.type ? t : { ...t, type: inner };
    }
    case 'union':
    case 'intersection': {
      const types = t.types.map((x) => frozenNegateNumericType(x));
      if (types.every((x, i) => x === t.types[i])) return t;
      return { ...t, types };
    }
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const elements = frozenNegateNumericType(t.elements);
      return elements === t.elements ? t : { ...t, elements };
    }
    case 'tuple': {
      const elements = t.elements.map((el) => {
        const type = frozenNegateNumericType(el.type);
        return type === el.type ? el : { ...el, type };
      });
      if (elements.every((el, i) => el === t.elements[i])) return t;
      return { ...t, elements };
    }
    default:
      return t;
  }
}

/** Frozen copy of `handlerTypeOf` (library/type-handlers.ts). */
function frozenHandlerTypeOf(x: Expression): Type {
  return x._literalType ?? x.type.type;
}

/** Frozen copy of `operandSgn` (library/type-handlers.ts). */
function frozenOperandSgn(x: Expression): Sign | undefined {
  return x.sgn ?? signOfType(frozenHandlerTypeOf(x));
}

/** Frozen copy of `operandLiteralValue` (library/type-handlers.ts). */
function frozenOperandLiteralValue(x: Expression): number | undefined {
  const t = x._literalType;
  if (t === undefined || typeof t === 'string') return undefined;
  if (t.kind === 'value' && typeof t.value === 'number') return t.value;
  if (
    t.kind === 'numeric' &&
    typeof t.lower === 'number' &&
    t.lower === t.upper
  )
    return t.lower;
  return undefined;
}

/** Frozen copy of `numericTypeHandler` (library/type-handlers.ts). */
function frozenNumericTypeHandler(ops: ReadonlyArray<Expression>): Type {
  if (ops.some((x) => frozenProvablyNonFiniteNumber(x))) return 'number';
  if (ops.every((x) => x.type.matches('real'))) return 'finite_real';
  return 'finite_number';
}

/** Frozen copy of `binomialType` (library/combinatorics.ts). */
function frozenBinomialType(
  n: Expression | undefined,
  k: Expression | undefined
): Type {
  if (!n || !k || n.isNaN || k.isNaN) return 'number';
  if (frozenProvablyNonFiniteNumber(n) || frozenProvablyNonFiniteNumber(k))
    return 'number';
  if (n.isInteger === true && k.isInteger === true) return 'finite_integer';
  if (n.isReal === true && k.isReal === true) {
    if (n.isInteger === true && n.isNegative === true) return 'number';
    return 'finite_real';
  }
  return 'number';
}

/** Frozen copy of `logType` (library/type-handlers.ts). */
function frozenLogType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  const base = ops[1];
  if (!x || x.isNaN) return 'number';
  if (frozenProvablyNonFiniteNumber(x)) return 'number';
  const xSgn = frozenOperandSgn(x);
  const usableBase = (b: Expression): boolean =>
    positiveSign(frozenOperandSgn(b)) === true &&
    b.isFinite === true &&
    !b.isSame(1);
  if (x.isSame(0)) {
    if (base === undefined || usableBase(base)) return 'non_finite_number';
    return 'number';
  }
  if (positiveSign(xSgn) === false && negativeSign(xSgn) !== true)
    return 'number';
  if (base && !usableBase(base)) return 'number';
  if (negativeSign(xSgn) === true) return 'finite_complex';
  if (positiveSign(xSgn) === true) return 'finite_real';
  return x.type.matches('complex') ? 'complex' : 'number';
}

/** Frozen copy of `gammaPoleType` (library/type-handlers.ts). */
function frozenGammaPoleType(x: Expression | undefined): Type {
  if (!x || x.isNaN) return 'number';
  if (x.isInteger === true && nonPositiveSign(frozenOperandSgn(x)) === true)
    return 'number';
  return frozenNumericTypeHandler([x]);
}

/** Frozen copy of `poleReciprocalType` (library/type-handlers.ts). */
function frozenPoleReciprocalType(
  operator: string,
  ops: ReadonlyArray<Expression>
): Type {
  const x = ops[0];
  if (!x || x.isNaN) return 'number';
  const hyperbolic = operator === 'Coth' || operator === 'Csch';
  if (frozenProvablyNonFiniteNumber(x))
    return hyperbolic && x.isReal === true ? 'finite_real' : 'number';
  if (x.isReal !== true) return 'number';
  const poleAtZero = operator !== 'Tan' && operator !== 'Sec';
  if (isNumber(x) || x._literalType !== undefined) {
    const v = frozenOperandLiteralValue(x);
    return poleAtZero && (v !== undefined ? v === 0 : x.isSame(0))
      ? 'number'
      : 'finite_real';
  }
  if (!hyperbolic && x.isConstant) return 'number';
  if (!poleAtZero) return 'finite_real';
  const s = frozenOperandSgn(x);
  if (positiveSign(s) === true || negativeSign(s) === true)
    return 'finite_real';
  return 'number';
}

/** Frozen copy of `arctanType` (library/type-handlers.ts). */
function frozenArctanType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  if (!x || x.isNaN) return 'number';
  if (x.isReal === true) return 'finite_real';
  return 'number';
}

/** Frozen copy of `roundingFunctionType` (library/type-handlers.ts). */
function frozenRoundingFunctionType(x: Expression | undefined): Type {
  if (!x || x.isNaN) return 'number';
  if (frozenProvablyNonFiniteNumber(x))
    return x.isReal === true ? 'non_finite_number' : 'number';
  const provablyNonReal = isNumber(x)
    ? x.isReal === false
    : x.type.matches('imaginary');
  if (provablyNonReal)
    return x.isFinite === true || x.type.matches('finite_number')
      ? 'finite_complex'
      : 'number';
  return 'finite_integer';
}

/** Frozen copy of `extremumType` (library/type-handlers.ts). */
function frozenExtremumType(ops: ReadonlyArray<Expression>): Type {
  if (ops.length === 0) return 'number';
  if (!ops.every((x) => x.type.matches('number'))) return 'number';
  for (const t of [
    'finite_integer',
    'finite_rational',
    'finite_real',
    'integer',
    'rational',
    'real',
  ] as const)
    if (ops.every((x) => x.type.matches(t))) return t;
  return 'number';
}

/** Frozen copy of `measurementType` (library/type-handlers.ts). */
function frozenMeasurementType(
  ops: ReadonlyArray<Expression>
): Type | BoxedType {
  return ops[0]?.type ?? 'real';
}

/** Frozen copy of `bigOpResultType` (library/type-handlers.ts). */
function frozenBigOpResultType(
  ops: ReadonlyArray<Expression>
): Type | BoxedType {
  const body = ops[0];
  if (ops.length > 1 && body?.type.matches('indexed_collection<any>'))
    return body.type;
  const bodyType = body?.type.type;
  if (
    ops.length > 1 &&
    bodyType !== undefined &&
    typeof bodyType !== 'string' &&
    bodyType.kind === 'broadcastable'
  )
    return body!.type;
  return 'number';
}

/** Frozen copy of `adjoinType` (library/type-handlers.ts). */
function frozenAdjoinType(ops: ReadonlyArray<Expression>): Type {
  const base = ops[0];
  const baseElements =
    (base ? collectionElementType(base.type.type) : undefined) ?? 'unknown';
  const adjoined = ops.slice(1).map((x) => x.type.type);
  if (baseElements === 'unknown' || adjoined.some((t) => t === 'unknown'))
    return { kind: 'set', elements: 'unknown' };
  return { kind: 'set', elements: widen(baseElements, ...adjoined) };
}

/** Frozen copy of `quotientRingType` (library/type-handlers.ts). */
function frozenQuotientRingType(ops: ReadonlyArray<Expression>): Type {
  const base = ops[0];
  const elements =
    (base ? collectionElementType(base.type.type) : undefined) ?? 'unknown';
  return { kind: 'set', elements };
}

/**
 * Frozen copy of `elementaryFunctionType` (library/type-handlers.ts),
 * restricted to the arms the converted heads can reach.
 *
 * The heads registered in this fixture are `Arctan`, `Ln`, `Log`, and the
 * fourteen converted `trigFunction` factory heads (Sin, Cos, Tan, Arsinh,
 * Cosh, Sec, Sinh, Sech, Tanh, Arccot, Cot, Csc, Coth, Csch). Between them
 * they reach five arms: the pole-reciprocal arm (Tan, Sec, Csc, Cot, Coth,
 * Csch), the logarithm arm (Ln, Log → `frozenLogType`), the arctan arm
 * (Arctan, Arccot), the inline hyperbolic arms (Sinh, Cosh, Tanh, Sech),
 * and the `numericTypeHandler` default (Sin, Cos, Arsinh). Only the
 * bounded-inverse-trig arm is unreachable, and it throws rather than being
 * copied: those nine heads converted under a RULED divergence (their
 * declared-range claims deliberately differ from the legacy shape — see the
 * `elementaryFunctionType` blocks of `type-handler-twins.test.ts`), so they
 * must never be registered for parity. A call reaching the stub means an
 * entry was added for a head whose two shapes differ by design, and failing
 * loudly is the right answer.
 */
function frozenElementaryFunctionType(
  operator: string,
  ops: ReadonlyArray<Expression>
): Type {
  switch (operator) {
    case 'Ln':
    case 'Log':
    case 'Lb':
    case 'Lg':
    case 'Log2':
    case 'Log10':
      return frozenLogType(ops);

    case 'Tan':
    case 'Sec':
    case 'Csc':
    case 'Cot':
    case 'Coth':
    case 'Csch':
      return frozenPoleReciprocalType(operator, ops);

    case 'Sinh':
    case 'Cosh':
      if (ops[0]?.isFinite === false && ops[0].type.matches('real'))
        return 'non_finite_number';
      return frozenNumericTypeHandler(ops);
    case 'Tanh':
    case 'Sech':
      if (ops[0]?.isFinite === false && ops[0].type.matches('real'))
        return 'finite_real';
      return frozenNumericTypeHandler(ops);

    case 'Arctan':
    case 'Arccot':
      return frozenArctanType(ops);

    case 'Arcsin':
    case 'Arccos':
    case 'Arcsec':
    case 'Arccsc':
    case 'Artanh':
    case 'Arcoth':
    case 'Arsech':
    case 'Arcsch':
    case 'Arcosh':
      throw new Error(
        `unreachable in shadow: the bounded inverse head '${operator}' has not converted`
      );

    default:
      return frozenNumericTypeHandler(ops);
  }
}

export const LEGACY_TYPE_HANDLERS: Record<
  string,
  OperatorTypeHandlerOnExpressions
> = {
  // From library/core.ts, pre-conversion (commit bca1105e).
  Coalesce: (ops) => {
    if (ops.length === 0) return 'nothing';
    const arms = ops.map((op, i) =>
      i < ops.length - 1 ? stripMissingFromType(op.type.type) : op.type.type
    );
    return widen(...arms) as Type;
  },

  Hold: ([x]) => {
    if (isSymbol(x)) return 'symbol';
    if (isString(x)) return 'string';
    if (isNumber(x)) return x.type;
    if (isFunction(x)) return functionResult(x.type.type) ?? 'unknown';
    return 'unknown';
  },

  ReleaseHold: ([x]) => (isFunction(x, 'Hold') ? x.op1.type : x.type),

  // From library/number-theory.ts, pre-conversion (commit a1587fbe).
  DigitCount: ([, , digit]) =>
    digit !== undefined ? 'finite_integer' : 'list',

  // From library/combinatorics.ts, pre-conversion (commit 68238141) — the
  // once-O7-held trio, converted after the sign channel reached function
  // applications (open item O7 of the plan doc). `frozenBinomialType` below
  // is the verbatim legacy `binomialType`.
  Binomial: ([n, k]) => frozenBinomialType(n, k),
  Choose: ([n, k]) => frozenBinomialType(n, k),
  Pochhammer: ([a, k]) => {
    if (!a || !k || a.isNaN || k.isNaN) return 'number';
    if (frozenProvablyNonFiniteNumber(a) || frozenProvablyNonFiniteNumber(k))
      return 'number';
    if (k.isInteger === true && k.isNonNegative === true) {
      if (a.isInteger === true) return 'finite_integer';
      if (a.isRational === true) return 'finite_rational';
      if (a.isReal === true) return 'finite_real';
    }
    return 'number';
  },

  // From library/arithmetic.ts, pre-conversion (commit 68238141) — the
  // once-O7-held Γ family, factorials and log heads.
  Gamma: (ops) =>
    ops.length === 1
      ? frozenGammaPoleType(ops[0])
      : frozenNumericTypeHandler(ops),
  GammaLn: (ops) => frozenGammaPoleType(ops[0]),
  Digamma: (ops) => frozenGammaPoleType(ops[0]),
  Trigamma: (ops) => frozenGammaPoleType(ops[0]),
  PolyGamma: ([n, x]) =>
    x?.isInteger === true && nonPositiveSign(frozenOperandSgn(x)) === true
      ? 'number'
      : frozenNumericTypeHandler([n, x]),
  Factorial: ([x]) => {
    const s = x ? frozenOperandSgn(x) : undefined;
    if (x?.isInteger === true && nonNegativeSign(s) === true)
      return 'finite_integer';
    if (x?.isInteger === true && negativeSign(s) === true) return 'number';
    return frozenNumericTypeHandler([x]);
  },
  Factorial2: ([x]) => {
    const s = x ? frozenOperandSgn(x) : undefined;
    if (x?.isInteger === true && nonNegativeSign(s) === true)
      return 'finite_integer';
    if (x?.isInteger === true && negativeSign(s) === true) return 'number';
    return frozenNumericTypeHandler([x]);
  },
  Ln: (ops) => frozenElementaryFunctionType('Ln', ops),
  Log: (ops) => frozenElementaryFunctionType('Log', ops),

  // From library/trigonometry.ts, pre-conversion (commit 68238141) — the
  // four zero-pole reciprocal heads, whose pole disproof rides the sign.
  Cot: (ops) => frozenElementaryFunctionType('Cot', ops),
  Csc: (ops) => frozenElementaryFunctionType('Csc', ops),
  Coth: (ops) => frozenElementaryFunctionType('Coth', ops),
  Csch: (ops) => frozenElementaryFunctionType('Csch', ops),

  // From library/control-structures.ts, pre-conversion (commit a1587fbe).
  Block: (args) => {
    if (args.length === 0) return 'nothing';
    return args[args.length - 1].type;
  },
  When: ([expr, cond]) => {
    if (cond?.type.matches(parseType('list<boolean>')!))
      return `list<${typeToString(expr.type.type)}>`;
    return expr.type;
  },

  // From library/arithmetic.ts, pre-conversion (commit 045c2655).
  Ceil: ([x]) => frozenRoundingFunctionType(x),
  Floor: ([x]) => frozenRoundingFunctionType(x),
  Truncate: ([x]) => frozenRoundingFunctionType(x),
  // `Round` is the only member of the rounding family that reads a second
  // operand: with a precision argument the result is generally not an
  // integer (`Round(3.14159, 2)` is `3.14`), so the integer claim — and only
  // that claim — is replaced by `finite_real`.
  Round: ([x, n]) => {
    const t = frozenRoundingFunctionType(x);
    return n !== undefined && t === 'finite_integer' ? 'finite_real' : t;
  },
  Fract: ([x]) => frozenNumericTypeHandler([x]),
  LambertW: (ops) => frozenNumericTypeHandler(ops),
  BesselJ: (ops) => frozenNumericTypeHandler(ops),
  BesselY: (ops) => frozenNumericTypeHandler(ops),
  BesselI: (ops) => frozenNumericTypeHandler(ops),
  BesselK: (ops) => frozenNumericTypeHandler(ops),
  AiryAi: (ops) => frozenNumericTypeHandler(ops),
  AiryBi: (ops) => frozenNumericTypeHandler(ops),
  AiryAiPrime: (ops) => frozenNumericTypeHandler(ops),
  AiryBiPrime: (ops) => frozenNumericTypeHandler(ops),
  ElementMax: (ops) => frozenNumericTypeHandler(ops),
  ElementMin: (ops) => frozenNumericTypeHandler(ops),
  Clamp: (ops) => frozenNumericTypeHandler(ops),
  // ζ(1) is the pole of the Riemann zeta function (the harmonic series
  // diverges), so the argument literal 1 takes the claim to `number`.
  Zeta: ([x]) => (x?.isSame(1) ? 'number' : frozenNumericTypeHandler([x])),
  Negate: ([x]) => frozenNegateNumericType(x.type.type),
  Measurement: frozenMeasurementType,
  Max: (ops) => frozenExtremumType(ops),
  Min: (ops) => frozenExtremumType(ops),
  Supremum: (ops) => frozenExtremumType(ops),
  Infimum: (ops) => frozenExtremumType(ops),
  Sum: frozenBigOpResultType,
  Product: frozenBigOpResultType,

  // From library/trigonometry.ts, pre-conversion (commit 045c2655).
  Degrees: (ops) => frozenNumericTypeHandler(ops),
  DMS: (ops) => frozenNumericTypeHandler(ops),
  Arctan2: (ops) => frozenNumericTypeHandler(ops),
  Haversine: (ops) => frozenNumericTypeHandler(ops),
  Arctan: (ops) => frozenElementaryFunctionType('Arctan', ops),
  // The converted heads built by the `trigFunction` factory, whose shared
  // handler is `elementaryFunctionType(operator, ops)` with the factory's
  // own operator name closed over. `Cot`/`Csc`/`Coth`/`Csch` converted with
  // the once-O7-held batch, after the descriptor's sign fact began carrying
  // an application's operator-`sgn` proof (open item O7 of the plan doc) —
  // their `poleReciprocalType` arm disproves the pole at 0 through that
  // sign. The nine bounded inverse heads are absent DELIBERATELY and
  // permanently: they converted under a ruled divergence (declared-range
  // claims differ from the legacy shape by design — see the stub arm
  // above), so a parity entry for them would report the ruling as a defect.
  Sin: (ops) => frozenElementaryFunctionType('Sin', ops),
  Cos: (ops) => frozenElementaryFunctionType('Cos', ops),
  Tan: (ops) => frozenElementaryFunctionType('Tan', ops),
  Arsinh: (ops) => frozenElementaryFunctionType('Arsinh', ops),
  Cosh: (ops) => frozenElementaryFunctionType('Cosh', ops),
  Sec: (ops) => frozenElementaryFunctionType('Sec', ops),
  Sinh: (ops) => frozenElementaryFunctionType('Sinh', ops),
  Sech: (ops) => frozenElementaryFunctionType('Sech', ops),
  Tanh: (ops) => frozenElementaryFunctionType('Tanh', ops),
  Arccot: (ops) => frozenElementaryFunctionType('Arccot', ops),

  // From library/special-functions.ts, pre-conversion (commit 045c2655).
  // `EllipticF` is NOT `numericTypeHandler`: the incomplete integral
  // F(φ|m) is complex whenever m·sin²φ > 1, a condition on both operands, so
  // it never makes the `finite_real` claim that `numericTypeHandler` makes
  // for real operands — only the finite generic-point hedge.
  EllipticF: (ops) =>
    ops.some((x) => frozenProvablyNonFiniteNumber(x))
      ? 'number'
      : 'finite_number',
  Hypergeometric2F1: (ops) => frozenNumericTypeHandler(ops),
  AppellF1: (ops) => frozenNumericTypeHandler(ops),
  Hypergeometric1F1: (ops) => frozenNumericTypeHandler(ops),
  JacobiTheta: () => 'finite_number',
  DedekindEta: () => 'finite_number',
  EisensteinE: () => 'finite_number',

  // From library/sets.ts, pre-conversion (commit 045c2655).
  Adjoin: frozenAdjoinType,
  QuotientRing: frozenQuotientRingType,

  // From library/statistics.ts, pre-conversion (commit 045c2655).
  Mean: () => 'number',
  Median: () => 'number',
  Variance: () => 'number',
  PopulationVariance: () => 'number',
  StandardDeviation: () => 'number',
  PopulationStandardDeviation: () => 'number',
  Kurtosis: () => 'number',
  Skewness: () => 'number',
  Mode: () => 'number',
  InterquartileRange: () => 'number',
};

/**
 * Operators whose constant `type` handler (`type: () => 'finite_integer'`-
 * style, reading nothing from its operands) was RETIRED outright: the
 * constant result moved into the declared signature
 * (`(integer) -> finite_integer`) and the handler was deleted. This is
 * the strongest form of the migration — no handler at all cannot touch
 * engine state — and it is behavior-preserving because the no-handler
 * fallback narrowing at the type-derivation call site activates only for
 * a declared result of bare `number` or `finite_number`, never for these
 * spellings. Each entry records the declared result the signature must
 * keep claiming; a suite pin asserts the definition has NO `type` handler
 * and its signature result matches.
 *
 * Deliberately NOT in this ledger — every operator below claimed an
 * unconditional type that its own values contradict off its real domain, so
 * instead of retiring the claim into the signature each got a domain-gated
 * `'types'` handler. That is a deliberate behavior CORRECTION rather than a
 * behavior-preserving move, so none of them has a differential shadow; they
 * are pinned directly in `type-handler-parity.test.ts`:
 *
 * - `GammaRegularized`/`BetaRegularized` (library/special-functions.ts):
 *   the old constant `finite_real` claim was unsound off the proven domain
 *   (`GammaRegularized(-1, 2)` is NaN).
 * - `LogIntegral` (library/special-functions.ts): it never had a `type`
 *   handler — its declared result was a flat `real` — but that claim was
 *   wrong off the non-negative real axis: li(x) = Ei(ln x) is complex for
 *   x < 0, and `LogIntegral(NaN)` numericizes to NaN. Its declared result
 *   was widened to `number` and the handler now re-narrows to `real` (not
 *   `finite_real`: li(1) = −∞) on a proven non-negative real.
 * - `Sinc`/`FresnelS`/`FresnelC` (library/trigonometry.ts),
 *   `Covariance`/`PopulationCovariance`/`Correlation` (library/statistics.ts)
 *   and `Heaviside`/`Sign` (library/arithmetic.ts): `Sinc(NaN)` and
 *   `Covariance([1, NaN], [2, 3])` both numericize to `NaN`, and
 *   `sinc`/`FresnelS`/`FresnelC` of a non-real argument are complex.
 */
export const RETIRED_CONSTANT_TYPE_HANDLERS: ReadonlyArray<
  [operator: string, declaredResult: string]
> = [
  // library/number-theory.ts
  ['NthPrime', 'finite_integer'],
  ['NextPrime', 'finite_integer'],
  ['PrimeNu', 'finite_integer'],
  ['PrimeOmega', 'finite_integer'],
  ['MoebiusMu', 'finite_integer'],
  ['Radical', 'finite_integer'],
  ['PowerMod', 'finite_integer'],
  ['ModularInverse', 'finite_integer'],
  ['IntegerSqrt', 'finite_integer'],
  ['CarmichaelLambda', 'finite_integer'],
  ['LucasL', 'finite_integer'],
  ['CatalanNumber', 'finite_integer'],
  ['RandomPrime', 'finite_integer'],
  ['PrimePi', 'finite_integer'],
  ['BernoulliB', 'finite_rational'],
  ['FromDigits', 'finite_integer'],
  ['DigitSum', 'finite_integer'],
  ['DivisorSigma', 'finite_integer'],
  ['JacobiSymbol', 'finite_integer'],
  ['LegendreSymbol', 'finite_integer'],
  ['MultiplicativeOrder', 'finite_integer'],
  ['PrimitiveRoot', 'finite_integer'],
  ['Totient', 'finite_integer'],
  ['Sigma0', 'finite_integer'],
  ['Sigma1', 'finite_integer'],
  ['SigmaMinus1', 'finite_rational'],
  ['Eulerian', 'finite_integer'],
  ['Stirling', 'finite_integer'],
  ['StirlingS1', 'finite_integer'],
  ['NPartition', 'finite_integer'],
  // library/combinatorics.ts
  ['Fibonacci', 'finite_integer'],
  ['Multinomial', 'finite_integer'],
  ['Subfactorial', 'finite_integer'],
  ['BellNumber', 'finite_integer'],
  // library/collections.ts
  ['Length', 'integer'],
  ['Keys', 'list<string>'],
  ['Any', 'boolean'],
  ['All', 'boolean'],
  ['Position', 'list<integer>'],
  ['ArgMax', 'integer'],
  ['ArgMin', 'integer'],
  // library/core.ts
  ['TypeFrom', 'type'],
  // library/regexp.ts
  ['RegExp', 'regexp'],
  // library/linear-algebra.ts
  ['Rank', 'finite_integer'],
];

export function installLegacyTypeHandlerShadow(): void {
  for (const [operator, handler] of Object.entries(LEGACY_TYPE_HANDLERS))
    _legacyTypeHandlerShadow.set(operator, handler);
}

export function uninstallLegacyTypeHandlerShadow(): void {
  for (const operator of Object.keys(LEGACY_TYPE_HANDLERS))
    _legacyTypeHandlerShadow.delete(operator);
}
