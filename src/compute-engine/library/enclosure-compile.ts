/**
 * The compiled form of the value kind `enclosure` (`ENCLOSURE_COMPILE`, the
 * `compile` field of `ENCLOSURE_ARITHMETIC`), on the `interval-js` target
 * only. Every other target has no representation of an enclosure, and the
 * compilation declines there with the message of the kind
 * (`docs/plans/2026-10-26-value-kinds.md`, section 4.9.2, "Compilation").
 *
 * THE REPRESENTATION. An enclosure is the `{ lo, hi }` interval of the
 * `interval-js` runtime (`_IA`), so `lowered()` answers `'interval'`. A
 * number is a point interval on this target, so the code of a hook is valid
 * for an operand that MAY be an enclosure (`number | enclosure`) too.
 *
 * ONE KERNEL FOR EACH FORM. The hooks emit, operation by operation, the
 * `_IA` call that the `.N()` route of the interpreter makes for the same
 * form (`enclosure-arithmetic.ts`): the same exponent table for a power, the
 * same composition `1 / x^|n|` for a negative integer power, the same step
 * scaling for the rounding functions (`intervalRoundToStep()`), the same
 * outward conversion of a number operand to doubles (`outwardDoubles()`).
 * So the compiled code and `.N()` give the same doubles. A hook answers
 * `undefined` (the compilation declines) exactly where the interpreter leaves
 * the call unevaluated: an operator that is not in the table, a second
 * operand that is an enclosure where a point is expected, a power with a
 * base that is not provably positive and an exponent that is not a point.
 *
 * THE RESULTS. The library answers an `IntervalResult` with metadata
 * (`partial`, `singular`). The interpreter maps it to an enclosure, so the
 * code of every arithmetic operation is wrapped in `_IA.enclose()`, which
 * applies the same mapping at run time and answers `empty` (the
 * indeterminate value) for an infinite singleton or a `NaN` endpoint. The
 * comparisons read their operands through `_IA.stripEnclosure()`, and the
 * extrema wrap their result in it: it removes the metadata and keeps an
 * infinite point, which a comparison and an extremum read as a number.
 */

import type {
  ArithmeticCompile,
  Expression,
  OperatorCompileContext,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isKindArm, type KindTypeNames } from '../../common/type/utils.js';
import { provablyDisjoint } from '../../common/type/subtype.js';
import { SIGNED_INFINITY_TYPE } from '../../common/type/primitive.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { realPowerBranchTerms } from '../numerics/real-power.js';
import { isRecord } from '../interval/run-support.js';
import {
  enclosureEndpointClass,
  enclosureEndpointOrder,
  enclosureRange,
  exponentForm,
  isPointRange,
  isSafe,
  outwardDoubles,
  type ExponentForm,
} from './enclosure-arithmetic.js';
import { intervalRoundToStep } from './interval-round-to-step.js';

/** The `language` of the only target with a representation of an
 * enclosure, `interval-js`. */
const TARGET = 'interval-javascript';

const ENCLOSURE_KIND: KindTypeNames = { has: (name) => name === 'enclosure' };

/**
 * True when a value of the type `t` may be ONE enclosure: `t` is the kind
 * type `enclosure`, or a union with an `enclosure` arm (`real | enclosure`,
 * `enclosure | nan`). A collection of enclosures (`list<enclosure>`) is not
 * one enclosure.
 */
export function hasEnclosureArm(t: Readonly<Type>): boolean {
  if (isKindArm(t, ENCLOSURE_KIND)) return true;
  return (
    typeof t !== 'string' &&
    t.kind === 'union' &&
    t.types.some((arm) => isKindArm(arm, ENCLOSURE_KIND))
  );
}

/** True when a value of the type `t` may be `+oo` or `-oo`. */
function admitsInfinity(t: Readonly<Type>): boolean {
  return !provablyDisjoint(t as Type, SIGNED_INFINITY_TYPE);
}

/** The source of the double `d`, `±Infinity` included. */
function doubleSource(d: number): string {
  if (d === Infinity) return 'Infinity';
  if (d === -Infinity) return '-Infinity';
  return Object.is(d, -0) ? '-0' : String(d);
}

/** The source of the interval `[lo, hi]`: a point when `lo === hi`. */
function intervalSource(lo: number, hi: number): string {
  if (lo === hi) return `_IA.point(${doubleSource(lo)})`;
  return `{ lo: ${doubleSource(lo)}, hi: ${doubleSource(hi)} }`;
}

/** The source of the indeterminate value of an enclosure operation. */
const EMPTY = '({ kind: "empty" })';

/** `code` wrapped in the run-time mapping of an arithmetic result. */
function enclose(code: string): string {
  return `_IA.enclose(${code})`;
}

/**
 * The source of the operand `x` of a hook, or `undefined` when the hook
 * declines it:
 * - a finite real number literal, or an exact constant of class 2 (`Pi`,
 *   `Sin(1)`), is the interval of its OUTWARD conversion to doubles: a point
 *   when the value is a double, else the record `{ lo, hi }` (`0.1` is
 *   `{ lo: 0.09999999999999999, hi: 0.1 }`), as the interpreter converts it
 *   under `.N()`;
 * - an infinite literal is the point `_IA.point(±Infinity)`;
 * - a complex literal and `NaN` decline (the interpreter leaves the call
 *   unevaluated);
 * - any other operand is compiled as the target compiles it.
 *
 * With `finite`, an operand that may be infinite (an infinite literal, a
 * symbol typed `number`, an extremum) goes through `_IA.finiteOperand()`,
 * which answers `empty` for an infinite point BEFORE the kernel reads it:
 * an arithmetic operation with an infinite number is the indeterminate
 * value, where the kernels answer a finite interval.
 */
function operandSource(
  x: Expression,
  compile: (e: Expression) => string,
  finite: boolean
): string | undefined {
  if (isNumber(x)) {
    if (x.isNaN === true || x.isComplex) return undefined;
    if (x.isFinite === false) {
      const code = `_IA.point(${x.re > 0 ? 'Infinity' : '-Infinity'})`;
      return finite ? `_IA.finiteOperand(${code})` : code;
    }
    const [lo, hi] = outwardDoubles(x);
    return intervalSource(lo, hi);
  }
  if (!hasEnclosureArm(x.type.type) && enclosureEndpointClass(x) === 2) {
    const [lo, hi] = outwardDoubles(x);
    return intervalSource(lo, hi);
  }
  const code = compile(x);
  return finite && admitsInfinity(x.type.type)
    ? `_IA.finiteOperand(${code})`
    : code;
}

/** The sources of the operands `xs` (`operandSource()`), or `undefined` when
 * one of them is declined. */
function operandSources(
  xs: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  finite: boolean
): string[] | undefined {
  const codes: string[] = [];
  for (const x of xs) {
    const code = operandSource(x, compile, finite);
    if (code === undefined) return undefined;
    codes.push(code);
  }
  return codes;
}

/** The fold of `codes` by the binary `_IA` function `fn`. */
function fold(fn: string, codes: ReadonlyArray<string>): string {
  return codes.slice(1).reduce((acc, c) => `_IA.${fn}(${acc}, ${c})`, codes[0]);
}

//
// `Power`
//

/**
 * The code of the power of the interval `x` to a point exponent of the form
 * `form`: the table of the `.N()` route (`numericPower()` in
 * `enclosure-arithmetic.ts`), which is the selection of the `interval-js`
 * target. `2` → `square`; `1/2` → `sqrt`; a negative integer `n` → the
 * reciprocal of the positive power by the `divide` rule (`square` for
 * `n = -2`); another integer → `pow`; `p/q` with `q` odd → `powRational`; a
 * float that is the double nearest to such a `p/q` → `powRational`, a float
 * near one but not equal to its double → `powRealBranch` with the float, any
 * other float → `pow`. `undefined` for an integer beyond the safe integers:
 * the kernels take a double, which loses its parity.
 */
function pointPowerSource(x: string, form: ExponentForm): string | undefined {
  switch (form.kind) {
    case 'integer': {
      if (!isSafe(form.n)) return undefined;
      const n = Number(form.n);
      if (n === 2) return `_IA.square(${x})`;
      if (n < 0) {
        const positive = n === -2 ? `_IA.square(${x})` : `_IA.pow(${x}, ${-n})`;
        return `_IA.div(_IA.point(1), ${positive})`;
      }
      return `_IA.pow(${x}, ${n})`;
    }
    case 'rational': {
      if (form.p === 1n && form.q === 2n) return `_IA.sqrt(${x})`;
      if (form.q % 2n === 1n && isSafe(form.p) && isSafe(form.q))
        return `_IA.powRational(${x}, ${form.p}, ${form.q})`;
      return `_IA.pow(${x}, ${doubleSource(Number(form.p) / Number(form.q))})`;
    }
    case 'float': {
      const value = form.value;
      if (value === 0.5) return `_IA.sqrt(${x})`;
      const terms = realPowerBranchTerms(undefined, value);
      if (terms !== undefined && terms[1] % 2 !== 0) {
        const [p, q] = terms;
        return p / q === value
          ? `_IA.powRational(${x}, ${p}, ${q})`
          : `_IA.powRealBranch(${x}, ${doubleSource(value)}, ${p % 2 !== 0})`;
      }
      return `_IA.pow(${x}, ${doubleSource(value)})`;
    }
    case 'constant':
      return `_IA.pow(${x}, ${doubleSource(form.value.N().re)})`;
  }
}

/** The point of a literal `Enclosure(a, a)`, or `undefined`. */
function literalPoint(x: Expression): Expression | undefined {
  if (!isFunction(x, 'Enclosure') || x.nops !== 2) return undefined;
  const r = enclosureRange(x);
  return r !== undefined && isPointRange(r) ? r.lo : undefined;
}

/**
 * True when the base `b` of a power with an exponent that is not a point is
 * provably positive, from its literal (a positive number, a literal
 * enclosure whose lower endpoint is positive) or from its type.
 */
function provablyPositiveBase(b: Expression): boolean {
  if (isFunction(b, 'Enclosure')) {
    const r = enclosureRange(b);
    return r !== undefined && outwardDoubles(r.lo)[0] > 0;
  }
  if (hasEnclosureArm(b.type.type)) return false;
  return b.isPositive === true && b.isFinite !== false;
}

/** The code of `base^e` for a point exponent `e` (a number, a class 2
 * constant, or a free symbol typed by a number type, which is a point at
 * run time). */
function powerByPointSource(
  base: Expression,
  e: Expression,
  compile: (x: Expression) => string
): string | undefined {
  if (isSymbol(base, 'ExponentialE')) {
    const y = operandSource(e, compile, true);
    return y === undefined ? undefined : enclose(`_IA.exp(${y})`);
  }
  const x = operandSource(base, compile, true);
  if (x === undefined) return undefined;
  if (isNumber(e) || enclosureEndpointClass(e) === 2) {
    if (isNumber(e) && (e.isNaN === true || e.isComplex)) return undefined;
    // An infinite exponent gives the indeterminate value, as in the
    // interpreter.
    if (isNumber(e) && e.isFinite === false) return EMPTY;
    const form = exponentForm(e);
    if (form === undefined) return undefined;
    const code = pointPowerSource(x, form);
    return code === undefined ? undefined : enclose(code);
  }
  // An exponent read at run time (`x^n` with `n: integer`): `powInterval`
  // takes a point exponent as a point.
  const y = operandSource(e, compile, true);
  return y === undefined ? undefined : enclose(`_IA.powInterval(${x}, ${y})`);
}

/** The code of `Power(base, exponent)`. */
function powerSource(
  base: Expression,
  exponent: Expression,
  compile: (x: Expression) => string
): string | undefined {
  if (!hasEnclosureArm(exponent.type.type))
    return powerByPointSource(base, exponent, compile);
  // A point enclosure exponent is read as its point:
  // `(-2)^Enclosure(2, 2)` is `Enclosure(4, 4)`.
  const point = literalPoint(exponent);
  if (point !== undefined) return powerByPointSource(base, point, compile);
  const y = compile(exponent);
  if (isSymbol(base, 'ExponentialE')) return enclose(`_IA.exp(${y})`);
  // An exponent that is not a point: the base must be provably positive,
  // else the interpreter leaves the call unevaluated.
  if (!provablyPositiveBase(base)) return undefined;
  const x = operandSource(base, compile, true);
  return x === undefined ? undefined : enclose(`_IA.powInterval(${x}, ${y})`);
}

/** The code of `Root(x, k)`: the power `x^(1/k)`. */
function rootSource(
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string
): string | undefined {
  const [x, k] = args;
  if (args.length === 1) return powerFormSource(x, half(), compile);
  if (args.length !== 2 || hasEnclosureArm(k.type.type)) return undefined;
  if (isNumber(k)) {
    if (k.isNaN === true || k.isComplex || k.isFinite === false)
      return undefined;
    const ce = k.engine;
    const e = k.isExact
      ? ce.function('Divide', [ce.One, k]).evaluate()
      : ce.number(1 / k.re);
    return powerByPointSource(x, e, compile);
  }
  const base = operandSource(x, compile, true);
  const degree = operandSource(k, compile, true);
  if (base === undefined || degree === undefined) return undefined;
  return enclose(`_IA.powInterval(${base}, _IA.div(_IA.point(1), ${degree}))`);
}

function half(): ExponentForm {
  return { kind: 'rational', p: 1n, q: 2n };
}

/** The code of `x` to the exponent of the form `form` (`Sqrt`, `Square`). */
function powerFormSource(
  x: Expression,
  form: ExponentForm,
  compile: (e: Expression) => string
): string | undefined {
  const code = operandSource(x, compile, true);
  if (code === undefined) return undefined;
  const power = pointPowerSource(code, form);
  return power === undefined ? undefined : enclose(power);
}

//
// The functions of the `apply` table
//

/** The `_IA` function of each operator of one operand of the `apply` table
 * (`UNARY_RULES` in `enclosure-arithmetic.ts`). */
export const ENCLOSURE_UNARY_KERNELS: Readonly<Record<string, string>> = {
  Ln: 'ln',
  Sinh: 'sinh',
  Tanh: 'tanh',
  Arsinh: 'asinh',
  Arctan: 'atan',
  Artanh: 'atanh',
  Arcosh: 'acosh',
  Arcsin: 'asin',
  Arccos: 'acos',
  Erf: 'erf',
  Erfc: 'erfc',
  Sin: 'sin',
  Cos: 'cos',
  Tan: 'tan',
  Cot: 'cot',
  Sec: 'sec',
  Csc: 'csc',
  Cosh: 'cosh',
  Abs: 'abs',
  Sign: 'sign',
  Heaviside: 'heaviside',
  Gamma: 'gamma',
  Fract: 'fract',
};

const ROUNDING: Readonly<Record<string, 'floor' | 'ceil' | 'trunc' | 'round'>> =
  { Floor: 'floor', Ceil: 'ceil', Truncate: 'trunc', Round: 'round' };

const COMPARISONS: Readonly<Record<string, string>> = {
  Less: 'less',
  Greater: 'greater',
  LessEqual: 'lessEqual',
  GreaterEqual: 'greaterEqual',
  Equal: 'equal',
  NotEqual: 'notEqual',
};

/** True when the operand `x` may be an enclosure (the first operand of a
 * function of the `apply` table must be). */
function mayBeEnclosure(x: Expression | undefined): x is Expression {
  return x !== undefined && hasEnclosureArm(x.type.type);
}

/** `Floor`, `Ceil`, `Round`, `Truncate` with an optional point step. */
function roundingSource(
  operator: string,
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string
): string | undefined {
  const round = ROUNDING[operator];
  if (args.length > 2 || !mayBeEnclosure(args[0])) return undefined;
  if (args.length === 2 && hasEnclosureArm(args[1].type.type)) return undefined;
  let declined = false;
  const source = (x: Expression): string => {
    const code = operandSource(x, compile, true);
    if (code === undefined) {
      declined = true;
      return '';
    }
    return code;
  };
  const ties = args[0].engine.roundingTies;
  const extra =
    round === 'round' && ties !== 'away-from-zero'
      ? `, ${JSON.stringify(ties)}`
      : '';
  const code = intervalRoundToStep(round, args, source, extra);
  return declined ? undefined : enclose(code);
}

/** `Mod(x, m)` with a point divisor `m`. A zero divisor is the
 * indeterminate value, checked before the kernel, which answers the whole
 * line for it. */
function modSource(
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string
): string | undefined {
  if (args.length !== 2 || !mayBeEnclosure(args[0])) return undefined;
  const [x, m] = args;
  if (hasEnclosureArm(m.type.type)) return undefined;
  const xs = operandSource(x, compile, true);
  if (xs === undefined) return undefined;
  if (isNumber(m)) {
    if (m.isNaN === true || m.isComplex || m.isFinite === false)
      return undefined;
    if (m.re === 0) return EMPTY;
    const ms = operandSource(m, compile, true);
    return ms === undefined ? undefined : enclose(`_IA.mod(${xs}, ${ms})`);
  }
  const ms = operandSource(m, compile, true);
  if (ms === undefined) return undefined;
  return (
    `((_x, _m) => { const _v = _IA.unwrap(_m); ` +
    `return _v !== undefined && _v.lo === 0 && _v.hi === 0 ` +
    `? { kind: "empty" } : _IA.enclose(_IA.mod(_x, _m)); })(${xs}, ${ms})`
  );
}

/** `Log(x)` (base 10) and `Log(x, b)` with a point base `b`. */
function logSource(
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string
): string | undefined {
  if (args.length > 2 || !mayBeEnclosure(args[0])) return undefined;
  const xs = operandSource(args[0], compile, true);
  if (xs === undefined) return undefined;
  if (args.length === 1) return enclose(`_IA.log10(${xs})`);
  const b = args[1];
  if (hasEnclosureArm(b.type.type)) return undefined;
  if (isNumber(b) || enclosureEndpointClass(b) === 2) {
    if (isNumber(b) && (b.isNaN === true || b.isComplex)) return undefined;
    // `Log(x, +oo)` is the limit `0`, as for a number; `Log(x, -oo)` stays
    // unevaluated.
    if (isNumber(b) && b.isFinite === false) {
      if (b.re < 0) return undefined;
      return enclose(`_IA.div(_IA.ln(${xs}), _IA.ln(_IA.point(Infinity)))`);
    }
    // A base that is not positive, or that is `1`, leaves the call
    // unevaluated.
    const ce = b.engine;
    const sign = enclosureEndpointOrder(b, ce.Zero);
    const unit = enclosureEndpointOrder(b, ce.One);
    if (sign === undefined || sign <= 0 || unit === undefined || unit === 0)
      return undefined;
    const [lo, hi] = outwardDoubles(b);
    if (lo === 2 && hi === 2) return enclose(`_IA.log2(${xs})`);
    if (lo === 10 && hi === 10) return enclose(`_IA.log10(${xs})`);
    return enclose(`_IA.div(_IA.ln(${xs}), _IA.ln(${intervalSource(lo, hi)}))`);
  }
  // A base read at run time (`Log(x, b)` with `b: real`).
  const bs = operandSource(b, compile, false);
  if (bs === undefined) return undefined;
  return enclose(`_IA.div(_IA.ln(${xs}), _IA.ln(${bs}))`);
}

/** The comparisons, with their operands read through
 * `_IA.stripEnclosure()`. A chain of three or more operands is the
 * conjunction of the comparisons of each pair of neighbours, for the four
 * orders and for `Equal` and `NotEqual`, as the interpreter decides it
 * (`orderAnswer()`, `boxed-expression/kind-compare.ts`).
 *
 * A middle operand of a chain is in two comparisons. When a middle operand
 * is not a symbol or a number literal, its code can have an effect (a
 * function with a side effect, a random draw), so the code of each operand
 * that is not a symbol or a number literal is evaluated once: it is the
 * argument of an arrow function whose body holds the comparisons. The
 * arguments are evaluated from left to right, as the interpreter evaluates
 * the operands. The hook context gives no binder of temporary variables, so
 * the arrow function does that work. */
function comparisonSource(
  operator: string,
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string
): string | undefined {
  const fn = COMPARISONS[operator];
  if (args.length < 2) return undefined;
  const codes = operandSources(args, compile, false);
  if (codes === undefined) return undefined;
  const params: string[] = [];
  const values: string[] = [];
  const bindsMiddle = args.some(
    (x, i) => i > 0 && i < args.length - 1 && !isSymbol(x) && !isNumber(x)
  );
  const names = bindsMiddle
    ? codes.map((c, i) => {
        if (isSymbol(args[i]) || isNumber(args[i])) return c;
        const name = `_encCmp${i}`;
        params.push(name);
        values.push(c);
        return name;
      })
    : codes;
  const strip = (c: string): string => `_IA.stripEnclosure(${c})`;
  const pairs: string[] = [];
  for (let i = 0; i + 1 < names.length; i++)
    pairs.push(`_IA.${fn}(${strip(names[i])}, ${strip(names[i + 1])})`);
  const body = fold('and', pairs);
  if (params.length === 0) return body;
  return `((${params.join(', ')}) => ${body})(${values.join(', ')})`;
}

/** `Max`, `Min`, `ElementMax`, `ElementMin` and `Clamp`, with the result
 * read through `_IA.stripEnclosure()`: an infinite number that wins is the
 * result, as in the interpreter. */
function extremumSource(
  operator: string,
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string
): string | undefined {
  if (args.length === 0) return undefined;
  const codes = operandSources(args, compile, false);
  if (codes === undefined) return undefined;
  if (operator === 'Clamp') {
    if (codes.length !== 3) return undefined;
    return `_IA.stripEnclosure(_IA.clamp(${codes.join(', ')}))`;
  }
  const fn = operator === 'Max' || operator === 'ElementMax' ? 'max' : 'min';
  return `_IA.stripEnclosure(${fold(fn, codes)})`;
}

/** An arithmetic operation of `fn` over `args`, wrapped in `_IA.enclose`. */
function arithmeticSource(
  fn: string,
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string,
  arity?: number
): string | undefined {
  if (args.length === 0 || (arity !== undefined && args.length !== arity))
    return undefined;
  const codes = operandSources(args, compile, true);
  if (codes === undefined) return undefined;
  return enclose(
    codes.length === 1 ? `_IA.${fn}(${codes[0]})` : fold(fn, codes)
  );
}

/** The `apply` hook of the compiled form: the operators of the `apply`
 * table except `Mean`, the arithmetic operators of the hooks, the six
 * comparisons and the five extrema. Every other operator declines. */
function applySource(
  operator: string,
  args: ReadonlyArray<Expression>,
  compile: (x: Expression) => string,
  context: OperatorCompileContext
): string | undefined {
  if (context.language !== TARGET) return undefined;
  switch (operator) {
    case 'Negate':
      return arithmeticSource('negate', args, compile, 1);
    case 'Subtract':
      return arithmeticSource('sub', args, compile, 2);
    case 'Divide':
      return arithmeticSource('div', args, compile, 2);
    case 'Power':
      return args.length === 2
        ? powerSource(args[0], args[1], compile)
        : undefined;
    case 'Sqrt':
      return args.length === 1
        ? powerFormSource(args[0], half(), compile)
        : undefined;
    case 'Square':
      return args.length === 1
        ? powerFormSource(
            args[0],
            { kind: 'integer', n: 2n, exact: true },
            compile
          )
        : undefined;
    case 'Root':
      return rootSource(args, compile);
    case 'Exp':
      return args.length === 1 && mayBeEnclosure(args[0])
        ? arithmeticSource('exp', args, compile, 1)
        : undefined;
    case 'Floor':
    case 'Ceil':
    case 'Round':
    case 'Truncate':
      return roundingSource(operator, args, compile);
    case 'Mod':
      return modSource(args, compile);
    case 'Log':
      return logSource(args, compile);
    case 'Hypot':
      return arithmeticSource('hypot', args, compile, 2);
    case 'Arctan2': {
      // An infinite operand takes the limit value, as for a number: no
      // `_IA.finiteOperand()` here.
      if (args.length !== 2) return undefined;
      const codes = operandSources(args, compile, false);
      return codes === undefined
        ? undefined
        : enclose(`_IA.atan2(${codes[0]}, ${codes[1]})`);
    }
    case 'Max':
    case 'Min':
    case 'ElementMax':
    case 'ElementMin':
    case 'Clamp':
      return extremumSource(operator, args, compile);
  }
  if (operator in COMPARISONS) return comparisonSource(operator, args, compile);
  const kernel = ENCLOSURE_UNARY_KERNELS[operator];
  if (kernel === undefined || args.length !== 1 || !mayBeEnclosure(args[0]))
    return undefined;
  return arithmeticSource(kernel, args, compile, 1);
}

/**
 * The run-time check of a host value given for a free symbol of type
 * `enclosure`: a record `{ lo, hi }` of two numbers with `lo <= hi`, where
 * `±Infinity` is allowed but not the same infinity twice (it holds no real)
 * and `NaN` is refused; or a finite number (a point).
 */
export function isEnclosureEntry(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!isRecord(value)) return false;
  const { lo, hi } = value as { lo?: unknown; hi?: unknown };
  if (typeof lo !== 'number' || typeof hi !== 'number') return false;
  if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) return false;
  return !(lo === hi && !Number.isFinite(lo));
}

/**
 * The source of a literal `Enclosure(a, b)` whose endpoints are of class 1
 * or 2: the record of the outward conversion of the endpoints, ordered as
 * `[min(down), max(up)]`, so that a pair whose order was not decided
 * (`Enclosure(Sin(10^600), 0)`) is never reversed. The same infinity twice
 * is the indeterminate value. A class 3 endpoint (`Enclosure(a, 2)`), a
 * `NaN` endpoint and a set operand decline.
 */
function valueSource(
  value: Expression,
  _compile: (x: Expression) => string,
  context: OperatorCompileContext
): string | undefined {
  if (context.language !== TARGET) return undefined;
  if (!isFunction(value, 'Enclosure') || value.nops !== 2) return undefined;
  const [a, b] = value.ops;
  if (enclosureEndpointClass(a) === 3 || enclosureEndpointClass(b) === 3)
    return undefined;
  const da = outwardDoubles(a);
  const db = outwardDoubles(b);
  const lo = Math.min(da[0], db[0]);
  const hi = Math.max(da[1], db[1]);
  if (lo === hi && !Number.isFinite(lo)) return EMPTY;
  return intervalSource(lo, hi);
}

/**
 * The compiled form of the value kind `enclosure`, the `compile` field of
 * `ENCLOSURE_ARITHMETIC` (`docs/plans/2026-10-26-value-kinds.md`, section
 * 4.9.2, "Compilation"). The code reads host values, whose `entry` check is
 * a function of the host, so it is not shippable.
 */
export const ENCLOSURE_COMPILE: ArithmeticCompile = {
  type: {
    lowered: ({ language }) => (language === TARGET ? 'interval' : undefined),
    add: (args, compile, { language }) =>
      language === TARGET ? arithmeticSource('add', args, compile) : undefined,
    multiply: (args, compile, { language }) =>
      language === TARGET ? arithmeticSource('mul', args, compile) : undefined,
    apply: (operator, args, compile, context) =>
      applySource(operator, args, compile, context),
    entry: (value) => isEnclosureEntry(value),
    shippable: false,
  },
  value: (value, compile, context) => valueSource(value, compile, context),
};
