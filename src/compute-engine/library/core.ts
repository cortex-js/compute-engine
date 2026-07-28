import { joinLatex } from '../latex-syntax/tokenizer.js';
import {
  parse as parseLatex,
  serialize as serializeLatex,
} from '../latex-syntax/latex-syntax.js';

import { checkType, checkArity } from '../boxed-expression/validate.js';
import { canonicalForm } from '../boxed-expression/canonical.js';
import { asSmallInteger, toInteger } from '../boxed-expression/numerics.js';
import {
  addSequenceBaseCase,
  addSequenceRecurrence,
  addMultiIndexBaseCase,
  addMultiIndexRecurrence,
  containsSelfReference,
  extractIndexVariable,
} from '../sequence.js';

import {
  apply,
  canonicalFunctionLiteral,
  canonicalFunctionLiteralArguments,
  canonicalWithFreshPlaceholders,
} from '../function-utils.js';

import { flatten, flattenSequence } from '../boxed-expression/flatten.js';

import { fromDigits } from '../numerics/strings.js';
import { MAX_RANDOM_ELEMENT_COUNT } from '../numerics/random.js';
import { randomCount } from './random-utils.js';
import { interval } from '../numerics/interval.js';
import { range, rangeLast } from './collections.js';
import { typeToString } from '../../common/type/serialize.js';
import { checkDeadline } from '../../common/interruptible.js';

import { randomExpression } from './random-expression.js';
import { canonicalInvisibleOperator } from '../boxed-expression/invisible-operator.js';
import {
  collectionElementType,
  functionResult,
  isValidType,
  stripMissingFromType,
  widen,
} from '../../common/type/utils.js';
import { parseType } from '../../common/type/parse.js';
import { canonicalMultiply } from '../boxed-expression/arithmetic-mul-div.js';
import {
  canonicalSolve,
  evaluateSolve,
} from '../boxed-expression/solve-domain.js';
import { findRoot } from '../nonlinear-fit.js';
// BoxedDictionary will be dynamically imported to avoid circular dependency
import type {
  IComputeEngine as ComputeEngine,
  Expression,
  SymbolDefinition,
  SymbolDefinitions,
  DictionaryInterface,
  CanonicalForm,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import type { Rule } from '../types-evaluation.js';
import { canonical } from '../boxed-expression/canonical-utils.js';
import {
  isDictionary,
  isValueDef,
  assignedVariableNames,
  withValueShield,
  withRandomSeedFrame,
  withDrawRollback,
} from '../boxed-expression/utils.js';
import {
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isAbsentValue,
  sym,
} from '../boxed-expression/type-guards.js';

//   // := assign 80 // @todo
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))

// Symbols() -> return list of all known symbols

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1

/** A `Pipe` right operand that is statically refutable as a function: a bare
 * number, string, or boolean (`True`/`False`) literal. Such an operand can
 * never become applicable, so `Pipe` rejects it early. A general symbol is NOT
 * refutable — its definition may arrive later (deferral). */
function isRefutablePipeTarget(f: Expression): boolean {
  return (
    isNumber(f) || isString(f) || isSymbol(f, 'True') || isSymbol(f, 'False')
  );
}

/** The symbol names named by a `HoldValues` subset spec: a single symbol,
 * or the symbol members of a `List`/`Set`/`Tuple`. Non-symbol members are
 * ignored. */
function holdValuesShieldNames(spec: Expression): string[] {
  if (isSymbol(spec)) return [spec.symbol];
  if (
    isFunction(spec, 'List') ||
    isFunction(spec, 'Set') ||
    isFunction(spec, 'Tuple')
  ) {
    const names: string[] = [];
    for (const op of spec.ops) if (isSymbol(op)) names.push(op.symbol);
    return names;
  }
  return [];
}

// Split a string into grapheme clusters (UAX #29, via `Intl.Segmenter`).
// Shared by `Characters` and its synonym `GraphemeClusters`.
function splitGraphemeClusters(s: string): string[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(s), (seg) => seg.segment);
}

// The Unicode White_Space property, spelled out code point by code point so
// the definition of "whitespace" used by `StringSplit` does not depend on
// the host's interpretation of `\s`:
// U+0009..U+000D (tab, LF, VT, FF, CR), U+0020 (space), U+0085 (NEL),
// U+00A0 (no-break space), U+1680 (Ogham space mark), U+2000..U+200A
// (en quad..hair space), U+2028 (line sep), U+2029 (para sep), U+202F
// (narrow no-break space), U+205F (medium mathematical space),
// U+3000 (ideographic space).
const UNICODE_WHITESPACE =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

//
// ─── Random domains ─────────────────────────────────────────────────────────
//
// `Random` and `RandomChoice` share one domain analysis. See
// `docs/plans/2026-07-25-random-signature-redesign.md` §4: domain validity is
// decided by KIND, never by `count` — a bounded `Interval` reports
// `count: Infinity` (and `Interval(1,0)`/`Interval(1,1)` do too, though they
// are empty), so a count test would silently draw from a degenerate interval.
//
// Validation completes BEFORE the first draw, so an invalid domain consumes
// zero draws (the §4 draw-consumption contract).
//

/** How `Random`/`RandomChoice` draw from a domain, once its kind is known. */
type RandomDomainPlan =
  /** An invalid domain: a structured error, ready to return. */
  | { kind: 'error'; error: Expression }
  /** The domain is not resolved (an unassigned symbol…): stay symbolic. */
  | { kind: 'symbolic' }
  /** A bounded, non-empty `Interval`: draws are `lo + u·(hi − lo)`, `[lo, hi)`.
   * Endpoint open/closed markers are ignored — a float draw cannot respect an
   * open endpoint. */
  | { kind: 'continuous'; lo: number; hi: number }
  /** A finite, non-empty `Range`: draws are `first + step·⌊u·n⌋` over the
   * range's NORMALIZED parameters (`range()` in `collections.ts`). */
  | { kind: 'arithmetic'; first: number; step: number; n: number }
  /** A finite, non-empty indexed collection: draws are `xs.at(1 + ⌊u·n⌋)`.
   * NEVER materialized. */
  | { kind: 'indexed'; xs: Expression; n: number }
  /** A finite, non-empty non-indexed collection (a `Set`…): the count is
   * obtained first (consuming no draws), then the drawn positions are picked
   * out by a single `each()` pass. */
  | { kind: 'sequential'; xs: Expression; n: number };

/** An `out-of-range` error naming the offending domain kind. */
function randomDomainError(
  ce: ComputeEngine,
  expected: string,
  domain: Expression
): RandomDomainPlan {
  return {
    kind: 'error',
    error: ce.error(['out-of-range', expected, domain.toString()]),
  };
}

/**
 * Count a collection whose `count` is not directly available, by ONE pass over
 * `each()`. Counting consumes no random draws (CE collections are re-iterable
 * views), which is what lets `Random`/`RandomChoice` promise a fixed number of
 * draws on a non-indexed domain instead of reservoir-sampling.
 *
 * Returns `undefined` past `MAX_RANDOM_ELEMENT_COUNT` — an unbounded pass is
 * an uncatchable hang, so refuse rather than walk it.
 */
function countByTraversal(
  ce: ComputeEngine,
  xs: Expression
): number | undefined {
  let n = 0;
  for (const _x of xs.each()) {
    if ((n & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
    n += 1;
    if (n > MAX_RANDOM_ELEMENT_COUNT) return undefined;
  }
  return n;
}

/** Classify a `Random`/`RandomChoice` domain operand. */
function analyzeRandomDomain(
  ce: ComputeEngine,
  domain: Expression
): RandomDomainPlan {
  // 1. `Interval` — a closed form, short-circuited before any collection
  //    machinery. Endpoints must be finite reals; emptiness is decided by
  //    `isEmptyCollection`, never by `count`.
  if (isFunction(domain, 'Interval')) {
    const int = interval(domain);
    // Symbolic endpoints: stay symbolic rather than claim an error.
    if (!int) return { kind: 'symbolic' };
    if (!Number.isFinite(int.start) || !Number.isFinite(int.end))
      return randomDomainError(ce, 'a bounded Interval', domain);
    if (domain.isEmptyCollection !== false)
      return randomDomainError(ce, 'a non-empty Interval', domain);
    return { kind: 'continuous', lo: int.start, hi: int.end };
  }

  // 2. `Range` — closed form over the normalized `(first, step, count)`.
  //    `range()` already infers a descending step for `Range(7, 2)` and
  //    reports an empty range for a zero or sign-mismatched step.
  if (isFunction(domain, 'Range')) {
    const n = domain.count;
    // Symbolic bounds (e.g. `Range(1, n)`): the count is indeterminate.
    if (n === undefined) return { kind: 'symbolic' };
    if (!Number.isFinite(n))
      return randomDomainError(ce, 'a finite Range', domain);
    if (n === 0) return randomDomainError(ce, 'a non-empty Range', domain);
    const [first, , step] = range(domain);
    return { kind: 'arithmetic', first, step, n };
  }

  // A domain that is not (yet) a resolved collection — an unassigned symbol
  // of collection type, an error operand — stays symbolic.
  if (!domain.isCollection) return { kind: 'symbolic' };

  if (domain.isFiniteCollection === false)
    return randomDomainError(ce, 'a finite collection', domain);

  if (domain.isIndexedCollection) {
    const n = domain.count;
    if (n === undefined) return { kind: 'symbolic' };
    if (!Number.isFinite(n))
      return randomDomainError(ce, 'a finite collection', domain);
    if (n === 0) return randomDomainError(ce, 'a non-empty collection', domain);
    return { kind: 'indexed', xs: domain, n };
  }

  // Non-indexed: the count when it is known, otherwise ONE counting pass.
  let n = domain.count;
  if (n === undefined || !Number.isFinite(n)) n = countByTraversal(ce, domain);
  if (n === undefined)
    return randomDomainError(
      ce,
      `a collection of at most ${MAX_RANDOM_ELEMENT_COUNT} elements`,
      domain
    );
  if (n === 0) return randomDomainError(ce, 'a non-empty collection', domain);
  return { kind: 'sequential', xs: domain, n };
}

/** The element of `plan` selected by the uniform `u` ∈ [0, 1), for every plan
 * kind that can be indexed in O(1). `sequential` is handled by its callers,
 * which batch their positions into a single traversal. */
function selectRandomElement(
  ce: ComputeEngine,
  plan: RandomDomainPlan,
  u: number
): Expression | undefined {
  if (plan.kind === 'continuous')
    return ce.number(plan.lo + u * (plan.hi - plan.lo));
  if (plan.kind === 'arithmetic')
    return ce.number(plan.first + plan.step * Math.floor(u * plan.n));
  if (plan.kind === 'indexed') return plan.xs.at(1 + Math.floor(u * plan.n));
  return undefined;
}

/**
 * Pick the elements at the given 0-based `positions` (with multiplicity, in
 * output order) out of a non-indexed collection, by a SINGLE `each()` pass.
 */
function pickPositions(
  ce: ComputeEngine,
  xs: Expression,
  positions: number[]
): Expression[] {
  const slots = new Map<number, number[]>();
  positions.forEach((p, i) => {
    const bucket = slots.get(p);
    if (bucket === undefined) slots.set(p, [i]);
    else bucket.push(i);
  });
  const out: Expression[] = new Array(positions.length);
  let i = 0;
  for (const x of xs.each()) {
    if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
    const bucket = slots.get(i);
    if (bucket !== undefined) for (const slot of bucket) out[slot] = x;
    i += 1;
  }
  return out;
}

/** The finite counterpart of a numeric primitive, for `randomElementType`. */
const FINITE_NUMERIC_TYPE: Record<string, Type> = {
  number: 'finite_number',
  complex: 'finite_complex',
  real: 'finite_real',
  rational: 'finite_rational',
  integer: 'finite_integer',
};

/**
 * The element type of a `Random` DOMAIN, narrowed to its finite counterpart
 * for the closed-form domains (`Interval`, `Range`).
 *
 * `Interval`'s element type is `real` and `Range`'s is `integer`, and both of
 * those admit ±∞ — correctly, since a SET of reals may contain them. A DRAW
 * cannot: `Random` only ever draws from a bounded `Interval` or a finite
 * `Range` (an unbounded one is an evaluation error, never an infinite result),
 * so the drawn value is finite by construction. The narrower type is not just
 * tidiness — an imprecise `real` pushes comparisons over a framed draw off the
 * compile path.
 */
function randomElementType(domain: Expression): Type {
  const elt = collectionElementType(domain.type.type) ?? 'any';
  if (!isFunction(domain, 'Interval') && !isFunction(domain, 'Range'))
    return elt;
  return typeof elt === 'string' ? (FINITE_NUMERIC_TYPE[elt] ?? elt) : elt;
}

/** `list<T^k>` from a domain's element type, or the unshaped `list<T>`.
 * A zero count stays unshaped: a `^0` dimension reduces to the unit type,
 * which would misdispatch the (valid) empty-list result.
 *
 * The element type is the SAME narrowing `Random` applies to a single draw
 * (`randomElementType`) — a `RandomChoice` cell is a `Random` draw, so
 * `RandomChoice(Interval(0,1), 3)` is `list<finite_real^3>`, not the wider
 * `list<real^3>` the raw collection element type would give. */
function randomListType(
  domain: Expression | undefined,
  kOp: Expression | undefined
): Type {
  const elt = domain ? typeToString(randomElementType(domain)) : 'any';
  const count = kOp ? asSmallInteger(kOp) : null;
  if (count !== null && count > 0 && count <= MAX_RANDOM_ELEMENT_COUNT)
    return parseType(`list<${elt}^${count}>`);
  return parseType(`list<${elt}>`);
}

export const CORE_LIBRARY: SymbolDefinitions[] = [
  {
    // The sole member of the unit type, `nothing`
    Nothing: {
      description: 'The absence of a value; the sole member of the unit type.',
      type: 'nothing',
    },

    // The sole member of the unit type, `missing`.
    //
    // `Nothing` and `Missing` are complementary absence markers:
    // - `Nothing` is an ERASURE marker (an empty-sequence splice): it is
    //   elided from operator argument lists (`Nothing + 1` → `1`) and from
    //   collection literals (`[12, Nothing, 34]` → `[12, 34]`).
    // - `Missing` is a POSITION-PRESERVING marker: "a position exists, its
    //   value is absent" (Julia `missing`, R `NA`). It is never elided, and
    //   it propagates through numeric operations (`Missing + 1` → `NaN`)
    //   and through data-consuming aggregates.
    Missing: {
      description:
        'A value that is absent but whose position is preserved (Julia `missing`, R `NA`); the sole member of the `missing` type.',
      type: 'missing',
    },
  },

  //
  // Inert functions
  //
  {
    /**
     * ### THEORY OF OPERATIONS: SEQUENCES
     *
     * There are three similar functions used to represent sequences of
     * expressions:
     *
     * - `InvisibleOperator` represent a sequence of expressions
     *  that are syntactically juxtaposed without any separator or
     *  operators combining them.
     *
     *  For example, `2x` is represented as `["InvisibleOperator", 2, "x"]`.
     *  `InvisibleOperator` gets transformed into `Multiply` (or some other
     *  semantic operation) during canonicalization.
     *
     * - `Sequence` is used to represent a sequence of expressions
     *   at a semantic level. It is a collection, but it is handled
     *   specially when canonicalizing expressions, for example it
     *   is automatically flattened and hoisted to the top level of the
     *   argument list.
     *
     *   For example:
     *
     *     `["Add", "a", ["Sequence", "b", "c"]]`
     *
     *   is canonicalized to
     *
     *     `["Add", "a", "b", "c"]`.
     *
     *   The empty `Sequence` expression (i.e. `["Sequence"]`) is ignored
     *   but it can be used to represent an "empty" expression. It is a
     *   synonym for `Nothing`.
     *
     * - `Delimiter` is used to represent a group of expressions
     *   with an open and close delimiter and a separator.
     *
     *   They capture the input syntax, and can get transformed into other
     *   expressions during boxing and canonicalization.
     *
     *   The first argument is a function expression, such as `List`
     *   or `Sequence`. The arguments of that expression are represented
     *   with a separator between them and delimiters around the whole
     *   group.
     *
     *   If the first argument is a `Sequence` with a single element,
     *   the `Sequence` can be omitted.
     *
     *   The second argument specify the separator and delimiters. If not
     *   specified, the default is the string `"(,)"`
     *
     * Examples:
     * - `f(x)` ->
     *    `["InvisibleOperator",
     *        "f",
     *        ["Delimiter", "x"]
     *     ]`
     *
     * - `1, 2; 3, 4` ->
     *    `["Delimiter",
     *      ["Sequence",
     *        ["Delimiter", ["Sequence", 1, 2], "','"],
     *        ["Delimiter", ["Sequence", 3, 4], "','"],
     *      ],
     *     "';'"
     *    ]`
     *
     * - `2x` -> `["InvisibleOperator", 2, "x"]`
     *
     * - `2+` -> `["InvisibleOperator", 2,
     *              ["Error", "'unexpected-operator'", "+"]]`
     *
     *
     *
     *
     */
    InvisibleOperator: {
      description:
        'Implicit operator used for juxtapositions such as function application or multiplication.',
      complexity: 9000,
      lazy: true,
      signature: 'function',
      // Note: since the canonical form will be a different operator,
      // no need to calculate the result type
      canonical: (x, { engine }) => {
        // The `canonicalInvisibleOperator` function will return only
        // canonicalization for the invisible operator, not for any operators
        // it may turn into.
        // This is necessary for `1(2+3)` to be correctly canonicalized to `2+3`.
        const y = canonicalInvisibleOperator(x, { engine });
        if (!y) return engine.Nothing;
        if (isFunction(y, 'Multiply')) return canonicalMultiply(engine, y.ops);
        return y;
      },
    },

    /** See above for a theory of operations */
    Sequence: {
      description: 'Ordered sequence of expressions.',
      lazy: true,
      signature: 'function',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        if (args.length === 1) return args[0].type;
        return parseType(`tuple<${args.map((a) => a.type).join(', ')}>`);
      },
      canonical: (args, { engine: ce }) => {
        const xs = flatten(args);
        if (xs.length === 0) return ce.Nothing;
        if (xs.length === 1) return xs[0];
        return ce._fn('Sequence', xs);
      },
    },

    /** See above for a theory of operations */
    Delimiter: {
      description: 'Group expressions with explicit delimiters.',
      // Use to represent groups of expressions.
      // Named after https://en.wikipedia.org/wiki/Delimiter
      complexity: 9000,
      lazy: true,
      signature: '(any, string?) -> any',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        return args[0].type;
      },

      canonical: (args, { engine: ce }) => {
        // During parsing, no interpretation is made of the delimiters.
        // This gives more option to this handler, or handler of
        // other functions that use `Delimiter` as a parameter.

        // An empty delimiter, i.e. `()` is an empty tuple.
        // Note: this codepath is not hit by `f()`, which is
        // handled in `InvisibleOperator`.
        if (args.length === 0) return ce._fn('Tuple', []);

        // The Delimiter function can have:
        // - a single argument, which is a sequence of expressions
        // - two arguments, the first is a sequence of expressions
        //   and the second is a delimiter string
        if (args.length > 2)
          return ce._fn('Delimiter', checkArity(ce, args, 2));

        let body = args[0];

        // If the body is a sequence, turn it into a Tuple
        // We'll have a sequence when there is a delimiter inside
        // the sequence, like `(a, b, c)`. The sequence is used to group
        // the arguments, so it needs to be preserved.
        // If there is a single element, unpack it.
        if (isFunction(body, 'Sequence'))
          return ce._fn(
            'Tuple',
            // `Nothing` is an ERASURE marker: it is spliced out of a tuple
            // literal, so `(1, Nothing, 3)` is the 2-tuple `(1, 3)`. This
            // mirrors the filter in the `Tuple` canonical handler — the
            // `Delimiter` route builds the `Tuple` directly and would
            // otherwise bypass it.
            canonical(ce, body.ops).filter((x) => !isSymbol(x, 'Nothing'))
          );

        body = body.canonical;

        const delim = isString(args[1]) ? args[1].string : undefined;

        // If we have a single argument and parentheses, i.e. `(2)`, return
        // the argument
        if (!delim || (delim.startsWith('(') && delim.endsWith(')')))
          return body;

        if ((delim?.length ?? 0) > 3) {
          return ce._fn('Delimiter', [
            body,
            ce.error('invalid-delimiter', args[1].toString()),
          ]);
        }

        return ce._fn('Delimiter', [args[0], checkType(ce, args[1], 'string')]);
      },
      evaluate: (ops, options) => {
        const ce = options.engine;
        if (ops.length === 0) return ce.Nothing;

        const op1 = ops[0];

        if (
          (op1.operator === 'Sequence' || op1.operator === 'Delimiter') &&
          isFunction(ops[0])
        )
          ops = flattenSequence(ops[0].ops);

        if (ops.length === 1) return ops[0].evaluate(options);

        return ce._fn(
          'Tuple',
          ops.map((x) => x.evaluate(options))
        );
      },
    },

    Error: {
      description: 'Represent an error expression.',
      /**
       * - The first argument is either a string or an `["ErrorCode"]`
       * expression indicating the nature of the error.
       * - The second argument, if present, indicates the context/location
       * of the error. If the error occur while parsing a LaTeX string,
       * for example, the argument will be a `Latex` expression.
       */
      lazy: true,
      complexity: 500,
      signature: '((string|expression<ErrorCode>), expression?) -> nothing',
      // To make a canonical expression, don't canonicalize the args
      canonical: (args, { engine: ce }) => ce._fn('Error', args),
    },

    ErrorCode: {
      description: 'Structured error code with optional arguments.',
      complexity: 500,
      lazy: true,
      signature: '(string, any*) -> error',
      canonical: (args, { engine: ce }) => {
        const checked = checkType(ce, args[0], 'string');
        const code = isString(checked) ? checked.string : undefined;
        if (code === 'incompatible-type') {
          return ce._fn('ErrorCode', [ce.string(code), args[1], args[2]]);
        }
        return ce._fn('ErrorCode', args);
      },
    },

    Unevaluated: {
      description: 'Prevent an expression from being evaluated',
      // Unlike Hold, the argument is canonicalized
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x]) => x.type,
      canonical: (args, { engine: ce, scope }) =>
        ce._fn('Unevaluated', canonical(ce, args, scope)),
      evaluate: ([x], options) => x.evaluate(options),
    },

    IsMissing: {
      description:
        'True if the value is ABSENT — the `Missing` symbol, or a `NaN` ' +
        'number (regardless of provenance). R’s `is.na` (`TRUE` for both `NA` ' +
        'and `NaN`); `IsNaN` remains a NaN-specific test (R’s `is.nan`).',
      complexity: 500,
      signature: '(any) -> boolean',
      evaluate: ([x], { engine: ce }) =>
        x !== undefined && isAbsentValue(x) ? ce.True : ce.False,
    },

    Coalesce: {
      description:
        'Return the first operand that is not ABSENT (`Missing` or `NaN`), ' +
        'evaluated left-to-right. If every operand is absent, the last ' +
        'operand’s value is returned verbatim (still absent).',
      complexity: 500,
      // Lazy so operands are evaluated on demand (short-circuit) rather than
      // all up front. Per the documented lazy-operator trap, a lazy operator
      // with NO `canonical` handler is inert on the box/parse routes (held
      // operands arrive UNBOUND) — the `canonical` handler below canonicalizes
      // each held operand (value-safe: `.canonical` binds structure without
      // substituting assigned symbol values).
      lazy: true,
      // Accept absence into any operand position (a `Missing` operand is the
      // whole point) — declared `handle`, stripping every position (§3.A).
      missingBehavior: 'handle',
      signature: '(any+) -> unknown',
      // Result type `T₁° | … | Tₙ₋₁° | Tₙ` (§3.D): every operand but the last
      // contributes its stripped type (its `| missing` arm removed), the last
      // its full type. An arm-free final operand yields an arm-free result
      // type — but that never promises presence (`NaN ∈ number`, I6).
      type: (ops) => {
        if (ops.length === 0) return 'nothing';
        const arms = ops.map((op, i) =>
          i < ops.length - 1 ? stripMissingFromType(op.type.type) : op.type.type
        );
        return widen(...arms) as Type;
      },
      canonical: (args, { engine: ce, scope }) => {
        if (args.length === 0) return ce.error('missing');
        return ce._fn('Coalesce', canonical(ce, args, scope));
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (ops.length === 0) return ce.error('missing');
        let last: Expression | undefined = undefined;
        for (let i = 0; i < ops.length; i++) {
          const v = ops[i].evaluate({ numericApproximation });
          last = v;
          // Skip an absent operand (`Missing` or `NaN`).
          if (isAbsentValue(v)) continue;
          // An operand whose absence cannot be decided (it still carries free
          // variables) leaves the expression partially unevaluated from here
          // on: return `Coalesce` of this operand and the remaining tail.
          if (v.freeVariables.length > 0) {
            const tail = [
              v,
              ...ops
                .slice(i + 1)
                .map((o) => o.evaluate({ numericApproximation })),
            ];
            return tail.length === 1 ? tail[0] : ce._fn('Coalesce', tail);
          }
          // A decided, non-absent value: this is the result.
          return v;
        }
        // Every operand was absent: return the last operand's value verbatim
        // (still absent).
        return last!;
      },
    },

    Hold: {
      description:
        'Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it',
      lazy: true,
      signature: '(any) -> unknown',
      // Note: the operator is lazy and doesn't have a canonical handler:
      // the argument is not canonicalized.
      type: ([x]) => {
        if (isSymbol(x)) return 'symbol';
        if (isString(x)) return 'string';
        if (isNumber(x)) return x.type;
        if (isFunction(x)) return functionResult(x.type.type) ?? 'unknown';
        return 'unknown';
      },
      // When comparing hold expressions, consider them equal if their
      // arguments are structurally equal.
      eq: (a, b) => {
        if (isFunction(b, 'Hold')) b = b.ops[0];
        if (!isFunction(a)) return false;
        return a.ops[0].isSame(b);
      },
      evaluate: ([x], { engine }) => engine.hold(x),
    },

    ReleaseHold: {
      description: 'Release an expression held by `Hold`',
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x]) => (isFunction(x, 'Hold') ? x.op1.type : x.type),
      // Note: the operator is lazy and doesn't have a canonical handler:
      // the argument is not canonicalized.
      evaluate: ([x], options) => {
        if (isFunction(x, 'Hold')) return x.op1.canonical.evaluate(options);
        // The operand is not a literal `Hold`: evaluate it, and if the RESULT
        // is a held expression (e.g. a symbol whose value is a `Hold`),
        // release that — one layer, like Mathematica's `ReleaseHold`.
        const v = x.canonical.evaluate(options);
        if (isFunction(v, 'Hold')) return v.op1.canonical.evaluate(options);
        return v;
      },
    },

    HorizontalSpacing: {
      description: 'Horizontal spacing annotation.',
      signature: '(number) -> nothing',
      canonical: (args, { engine: ce }) => {
        if (args.length === 2) return args[0].canonical;
        // Returning `Nothing` will make the expression be ignored
        return ce.Nothing;
      },
    },

    Annotated: {
      description: 'Attach metadata or style annotations to an expression.',
      signature: '(expression, dictionary) -> expression',
      type: ([x]) => x.type,
      complexity: 9000,
      lazy: true,
      canonical: ([x, style], { engine: ce }) => {
        x = x.canonical;
        style = style.canonical;

        // Is the style dictionary empty?
        if (!isDictionary(style) || style.keys.length === 0) return x;

        return ce._fn('Annotated', [x, style]);
      },
      evaluate: ([x, _style], options) => x.evaluate(options),
      // Annotated is transparent at run time; a custom compile handler could
      // lower it to its value: `compile: (args, compile) => compile(args[0])`.
    },

    Typed: {
      description:
        'Ascribe a type to an expression. The type is asserted for the type ' +
        'system (ascription, not a check); evaluation is transparent. Used to ' +
        'annotate `Function` literal parameters and return types.',
      complexity: 9000,
      // `lazy` so the type operand stays raw (a type-name symbol such as `real`
      // is not auto-declared as a variable).
      lazy: true,
      signature: '(any, string | symbol) -> unknown',
      type: ([x, t], { engine: ce }) => {
        if (!t) return x?.type ?? 'unknown';
        const s = isString(t) ? t.string : sym(t);
        let parsed: Type | undefined;
        try {
          parsed = parseType(s, ce._typeResolver);
        } catch {
          parsed = undefined;
        }
        return parsed ?? x?.type ?? 'unknown';
      },
      canonical: ([x, t], { engine: ce }) => {
        if (t === undefined) return x?.canonical ?? ce.Nothing;
        // Normalize the type operand to a string WITHOUT canonicalizing it
        // (so a type-name symbol such as `real` is not auto-declared as a
        // variable), mirroring how `Declare` keeps its type operand raw.
        const s = isString(t) ? t.string : sym(t);
        const typeOp = s !== undefined ? ce.string(s) : t;
        return ce._fn('Typed', [x.canonical, typeOp]);
      },
      // Ascription is transparent at evaluation.
      evaluate: ([x], options) => x?.evaluate(options),
    },

    Text: {
      description:
        'A sequence of strings, annotated expressions and other Text expressions',
      signature: '(any*) -> string',
      evaluate: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce.string('');
        const parts: string[] = [];
        for (const op of ops) {
          // Unwrap Annotated (strip style annotations)
          const unwrapped = isFunction(op, 'Annotated') ? op.op1 : op;
          if (isString(unwrapped)) parts.push(unwrapped.string);
          else {
            const evaluated = unwrapped;
            if (isString(evaluated)) parts.push(evaluated.string);
            else parts.push(evaluated.toString());
          }
        }
        return ce.string(parts.join(''));
      },
    },
  },
  {
    //
    // Structural operations that can be applied to non-canonical expressions
    //
    About: {
      description: 'Return information about an expression',
      lazy: true,
      signature: '(any) -> string',
      evaluate: ([x], { engine: ce }) => {
        const s = [x.toString()];
        s.push(''); // Add a newline

        if (isString(x)) s.push('string');
        else if (isSymbol(x)) {
          if (x.valueDefinition) {
            const def = x.valueDefinition;

            if (def.isConstant) s.push('constant');

            if (typeof def.description === 'string') s.push(def.description);
            else if (Array.isArray(def.description))
              s.push(def.description.join('\n'));
            if (def.wikidata) s.push(`WikiData: ${def.wikidata}`);
            if (def.url) s.push(`Read More: ${def.url}`);
          } else {
            s.push('symbol');
            s.push(`value: ${x.evaluate().toString()}`);
          }
        } else if (isNumber(x)) s.push(x.type.toString());
        else if (isFunction(x)) {
          s.push(x.type.toString());
          s.push(x.isCanonical ? 'canonical' : 'non-canonical');
        } else s.push("Unknown expression's type");
        return ce.string(s.join('\n'));
      },
    },

    Head: {
      description: 'Return the head of an expression, the name of the operator',
      lazy: true,
      signature: '(any) -> symbol',
      canonical: (args, { engine: ce }) => {
        // **IMPORTANT** Head should work on non-canonical expressions
        if (args.length !== 1) return null;
        const op1 = args[0];
        return ce.expr(op1.operator);
      },
      evaluate: (ops, { engine: ce }) =>
        ce.symbol(ops[0]?.operator ?? 'Undefined'),
    },

    Tail: {
      description:
        'Return the tail of an expression, the operands of the expression',
      lazy: true,
      signature: '(any) -> collection',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return null;
        const op1 = args[0];
        if (isFunction(op1)) return ce._fn('Sequence', op1.ops);
        return ce._fn('Tail', canonical(ce, args));
      },
      // **IMPORTANT** Tail should work on non-canonical expressions
      evaluate: ([x], { engine: ce }) =>
        isFunction(x) ? ce._fn('Sequence', x.ops) : ce.Nothing,
    },

    Spread: {
      description: [
        'Spread(t): splice the elements of the tuple `t` into the enclosing',
        'argument list (Cortex surface syntax: `f(...t)`).',
        'A literal tuple splices at canonicalization; a symbolic argument is',
        'spliced by the enclosing call at evaluation (step 0 of the evaluate',
        'path), which re-validates the resulting arity.',
      ],
      lazy: true,
      signature: '(any) -> unknown',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return null;
        // `op.canonical` is value-safe: it binds structure but does not
        // substitute assigned symbol values, so `f(...p)` keeps `p` intact
        // until evaluation.
        const op1 = args[0].canonical;
        if (isFunction(op1, 'Tuple')) return ce._fn('Sequence', [...op1.ops]);
        return ce._fn('Spread', [op1]);
      },
      // Normally consumed by the enclosing call before its own evaluation; a
      // bare `Spread(t)` evaluated directly resolves to a `Sequence`, which
      // splices if it lands in an argument list.
      evaluate: ([x], { engine: ce }) => {
        const v = x.canonical.evaluate();
        if (isFunction(v, 'Tuple')) return ce._fn('Sequence', [...v.ops]);
        return undefined;
      },
    },

    Identity: {
      description: 'Return the argument unchanged',
      signature: '(any) -> unknown',
      type: ([x]) => x.type,
      evaluate: ([x]) => x,
    },
  },
  {
    Apply: {
      description: 'Apply a function to a list of arguments',
      signature: '(name:symbol, arguments:expression*) -> unknown',
      type: ([fn]) => functionResult(fn.type.type) ?? 'unknown',
      canonical: (args, { engine: ce }) => {
        const s = sym(args[0]);
        if (s) return ce.function(s, args.slice(1));
        return ce._fn('Apply', args);
      },
      evaluate: (ops, { numericApproximation }) => {
        const result = apply(ops[0], ops.slice(1));
        if (!numericApproximation) return result;
        // N(f(x)) = N of the applied result: without this, e.g.
        // `Apply(Derivative(LambertW), 0.5).N()` returned the symbolic
        // derivative with `LambertW(0.5)` unevaluated. Guard: when the
        // application stayed symbolic (unresolved symbolic derivative,
        // returned as an `Apply` expression), re-entering N() here would
        // recurse forever.
        if (isFunction(result, 'Apply')) return result;
        return result.N();
      },
    },

    // Pipeline application: `Pipe(x, f)` evaluates to `f(x)`. The right
    // operand may be a function symbol (`Pipe(5, Sin)` → `Sin(5)`), a
    // `Function` literal, or anything else applicable. Chains produced by the
    // Cortex `|>`/`~>` operators arrive left-associated
    // (`Pipe(Pipe(a, f), g)`) and reduce naturally, inner stage first.
    Pipe: {
      description:
        'Apply a function to a value: `Pipe(x, f)` evaluates to `f(x)`.',
      // Hold the operands. `x |> f` must behave exactly like `f(x)`, so it is
      // `f` that decides whether `x` is evaluated: a lazy `f` (`Solve`,
      // `Simplify`, `JacobianMatrix`, …) needs `x` unevaluated. Evaluating `x`
      // eagerly here broke `F |> JacobianMatrix` — a bare function `F` came
      // through stripped of its definition.
      lazy: true,
      signature: '(value, function) -> unknown',
      type: ([_x, f]) =>
        f ? (functionResult(f.type.type) ?? 'unknown') : undefined,
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return ce._fn('Pipe', checkArity(ce, ops, 2));
        // Reject early only a statically-refutable rhs: a bare number, string,
        // or boolean literal can never become applicable, so wrap it in an
        // `incompatible-type` error (mirroring non-lazy signature validation).
        // Deferral is correct for everything else: definitions may arrive
        // between canonicalization and evaluation, held operands are
        // deliberately unbound per the lazy contract, and a non-refutable type
        // is accepted under overlap-deferred validation (§D6.2). We do not
        // bind/canonicalize the non-literal operands here.
        if (ce.strict && isRefutablePipeTarget(ops[1]))
          return ce._fn('Pipe', [
            ops[0],
            ce.typeError('function', ops[1].type, ops[1].toString()),
          ]);
        return ce._fn('Pipe', ops);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        // The held operands arrive UNBOUND; `.canonical` binds their operator
        // definitions (without substituting values). Canonicalizing keeps a
        // bare function reference intact — it is *evaluation*, not binding,
        // that strips it.
        //
        // The right operand is the pipe STAGE, and a shorthand-lambda
        // placeholder in it (`Map(_1, f)`) is that stage's parameter, not a
        // reference to whatever `_1` happens to name in the caller's scope:
        // canonicalize it with the placeholders freshly bound, so a global
        // `_1` — a valued one in particular — cannot capture them.
        let x = ops[0]?.canonical;
        const f =
          ops[1] === undefined
            ? undefined
            : canonicalWithFreshPlaceholders(ops[1]);
        if (x === undefined || f === undefined) return undefined;

        // A chained topic (`a |> g |> f` parses to `Pipe(Pipe(a, g), f)`) is
        // plumbing: the inner pipe is `g(a)`, whose VALUE flows on. Evaluate it
        // before handing it to `f`, so a lazy `f` (e.g. a trailing `Simplify`)
        // receives that value rather than an unreduced `Pipe`. A non-`Pipe`
        // topic — a bare function `F`, or `x^2 - 1` — is passed as-is, letting
        // `f` decide whether to evaluate it.
        if (isFunction(x, 'Pipe')) x = x.evaluate({ numericApproximation });

        // The right operand must be applicable. A statically-refutable rhs — a
        // literal number, string, or boolean — can never be a function, so
        // return an `incompatible-type` error (covering the non-strict route
        // and an rhs that evaluated to a bare literal at runtime). This check
        // stays here rather than in the type system, which cannot validate the
        // held (lazy) operands, and rather than in `apply()`, whose
        // constant-nullary shorthand (`Apply(3, 5)` → `3`, relied on by
        // `Map([1, 2], 3)` → `[3, 3]`) must be preserved: `Pipe` is
        // deliberately stricter than `Apply`. Anything else non-applicable
        // stays inert (returns `undefined`).
        if (isRefutablePipeTarget(f))
          return ce.typeError('function', f.type, f.toString());
        const result = apply(f, [x]);

        if (!numericApproximation) return result;
        // Mirror `Apply`: under N(), numericize the applied result unless it
        // stayed symbolic as an `Apply` expression (re-entering N() there
        // would recurse forever).
        if (isFunction(result, 'Apply')) return result;
        return result.N();
      },
    },

    Assign: {
      description:
        'Assign a value to a symbol or define a sequence. The RHS is evaluated ' +
        'immediately and `ce.assign(name, val)` mutates the binding in the ' +
        'current scope chain. When used inside a `Block`, the assignment is ' +
        'visible to subsequent statements in the block (sequential semantics).',
      lazy: true,
      pure: false,
      signature: '(symbol | expression, any) -> any',
      type: ([_symbol, value]) => value.type,
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2) return null;

        // Check if LHS is a Subscript expression (for sequence definitions)
        // e.g., ['Subscript', 'L', 0] or ['Subscript', 'a', 'n']
        // Preserve both LHS and RHS as non-canonical to avoid single-letter
        // symbols being canonicalized to known constants (e.g., "G" →
        // "CatalanConstant", "i" → "ImaginaryUnit"). The evaluate handler
        // needs the raw symbol names for sequence registration and
        // self-reference detection.
        const lhs = args[0];
        if (isFunction(lhs, 'Subscript')) {
          return ce._fn('Assign', [lhs, args[1]]);
        }

        // Note: we can't use checkType() because it canonicalized/bind the argument.
        let symbol = lhs;
        if (!isSymbol(symbol)) {
          // If the argument was not a symbol literal, see if we can evaluate it to a symbol
          symbol = checkType(ce, lhs, 'symbol');
        }

        // If the RHS is a Function definition, pre-declare the target symbol
        // as a function-typed symbol BEFORE canonicalizing the body. This ties
        // the recursion knot: a self-reference in the body (e.g. `f(n) = n *
        // f(n-1)`) then resolves to this symbol rather than to an unbound /
        // stale binding. It also lets subsequent parsing recognize it as a
        // function (e.g., `2f(x)` parses as `2 * f(x)`). Mirrors what an
        // explicit `Declare`/`let f` does.
        const symbolName = sym(symbol);
        if (symbolName && isFunction(args[1], 'Function')) {
          // Trigger auto-declaration if the symbol isn't declared yet
          if (!ce.lookupDefinition(symbolName)) ce.symbol(symbolName);
          const def = ce.lookupDefinition(symbolName);
          if (def && isValueDef(def) && def.value.inferredType)
            def.value.type = ce.type('function');
        }

        const canonRhs = args[1].canonical;
        const result = ce._fn('Assign', [symbol, canonRhs]);

        return result;
      },
      evaluate: ([op1, op2], { engine: ce }) => {
        //
        // Check for Subscript LHS (sequence definition)
        // e.g., Subscript(L, 0) := 1  OR  Subscript(a, n) := a_{n-1} + 1
        // Also handles multi-index: Subscript(P, Sequence(n, k)) := ...
        //
        if (isFunction(op1, 'Subscript') && sym(op1.op1)) {
          const seqName = sym(op1.op1)!;
          const subscript = op1.op2;

          //
          // Check for multi-index subscript: P_{n,k}
          // Parser produces: Subscript(P, Sequence(n, k))
          // When non-canonical, it may be wrapped in Delimiter:
          //   Subscript(P, Delimiter(Sequence(n, k), ","))
          //
          let multiSub = subscript;
          if (isFunction(multiSub, 'Delimiter')) multiSub = multiSub.op1;
          if (isFunction(multiSub, 'Sequence')) {
            const subscript = multiSub;
            const indices = subscript.ops;

            // Case M1: All numeric → multi-index base case
            // e.g., P_{0,0} := 1
            if (
              indices.every((op) => isNumber(op) && Number.isInteger(op.re))
            ) {
              const key = indices.map((op) => op.re).join(',');
              addMultiIndexBaseCase(ce, seqName, key, op2.evaluate());
              return ce.Nothing;
            }

            // Extract variable names from indices
            // For symbols: use the symbol name
            // For numbers: use the number as string
            // For expressions: try to extract the variable
            const indexVars: string[] = [];
            let hasSymbols = false;
            let allValid = true;

            for (const idx of indices) {
              if (isSymbol(idx)) {
                indexVars.push(idx.symbol);
                hasSymbols = true;
              } else if (isNumber(idx) && Number.isInteger(idx.re)) {
                indexVars.push(String(idx.re));
              } else {
                // Complex expression - try to extract variable
                const v = extractIndexVariable(idx);
                if (v) {
                  indexVars.push(v);
                  hasSymbols = true;
                } else {
                  allValid = false;
                  break;
                }
              }
            }

            if (allValid && indexVars.length === indices.length) {
              if (containsSelfReference(op2, seqName)) {
                // Case M2: Recurrence with self-reference
                // e.g., P_{n,k} := P_{n-1,k-1} + P_{n-1,k}
                // Only use symbol variables for the recurrence
                const recurrenceVars = indices
                  .map((idx) => sym(idx))
                  .filter((s): s is string => s !== undefined);

                if (recurrenceVars.length > 0) {
                  addMultiIndexRecurrence(ce, seqName, recurrenceVars, op2);
                  return ce.Nothing;
                }
              } else if (hasSymbols) {
                // Case M3: Pattern base case (no self-reference)
                // e.g., P_{n,0} := 1 or P_{n,n} := 1
                const key = indexVars.join(',');
                addMultiIndexBaseCase(ce, seqName, key, op2.evaluate());
                return ce.Nothing;
              }
            }

            // Fallback for multi-index: if we couldn't handle it, continue
          }

          // Case 1: Numeric subscript → base case
          // e.g., L_0 := 1, F_1 := 1
          if (isNumber(subscript) && Number.isInteger(subscript.re)) {
            const index = subscript.re;
            const value = op2.evaluate();
            addSequenceBaseCase(ce, seqName, index, value);
            return ce.Nothing;
          }

          // Case 2: Symbol subscript → check for self-reference
          // e.g., a_n := a_{n-1} + 1  vs  f_n := 2*n + 1
          if (isSymbol(subscript)) {
            const indexVar = subscript.symbol;

            if (containsSelfReference(op2, seqName)) {
              // Sequence recurrence definition
              addSequenceRecurrence(ce, seqName, indexVar, op2);
              return ce.Nothing;
            } else {
              // Function definition (no self-reference)
              // Convert to: f(n) := expr
              const fnDef = ce.function('Function', [op2, ce.symbol(indexVar)]);
              ce.assign(seqName, fnDef);
              return ce.Nothing;
            }
          }

          // Case 3: Complex subscript → check for self-reference
          // e.g., a_{n+1} := a_n + 1
          if (containsSelfReference(op2, seqName)) {
            const indexVar = extractIndexVariable(subscript!);
            if (indexVar) {
              addSequenceRecurrence(ce, seqName, indexVar, op2);
              return ce.Nothing;
            }
          }

          // Fallback: treat as regular assignment to compound symbol
          // This shouldn't normally happen with well-formed input
        }

        // Regular symbol assignment
        const symbol = op1.evaluate();
        const symbolName = sym(symbol);
        if (!symbolName) return undefined;
        const val = op2.evaluate();
        ce.assign(symbolName, val);
        return val;
      },
    },

    Assume: {
      description: 'Assume a type for a symbol',
      lazy: true,
      pure: false,
      signature: '(any) -> symbol',
      evaluate: (ops, { engine: ce }) => ce.symbol(ce.assume(ops[0])),
    },

    Declare: {
      description:
        'Declare a symbol in the current scope, optionally assigning a type ' +
        'and an initial value. An optional trailing attributes dictionary ' +
        '(with keys `type`, `value`, `constant` and `holdUntil`) can further ' +
        'describe the definition, e.g. to declare a constant. With a value, ' +
        'evaluates to that value; otherwise evaluates to `Nothing`.',
      lazy: true,
      pure: false,
      signature:
        '(symbol, type: (string | symbol)?, value: any?, attributes: dictionary?) -> any',
      // With a positional value operand, `Declare` evaluates to the value;
      // otherwise to `Nothing`. (A trailing dictionary operand is the
      // attributes bag, not a value.)
      type: (ops) =>
        ops[2] && !isDictionary(ops[2]) ? ops[2].type : 'nothing',
      canonical: (args, { engine: ce }) => {
        // Note: we can't use checkType() because it canonicalized/bind the argument.
        // A `Tuple` first operand is a destructuring pattern (`let (x, y) = v`):
        // kept raw — canonicalizing it would bind the about-to-be-declared
        // names to any existing outer definitions.
        let symbolExpr = args[0];
        if (!isSymbol(symbolExpr) && !isFunction(symbolExpr, 'Tuple')) {
          // If the argument was not a symbol literal, see if we can evaluate it to a symbol
          symbolExpr = checkType(ce, args[0], 'symbol');
        }

        if (args.length === 1) return ce._fn('Declare', [symbolExpr]);

        if (args.length === 2) {
          // The second operand is either a type (kept raw, so that a
          // type-name symbol such as `real` is not auto-declared as a
          // variable) or a trailing attributes dictionary (canonicalized so
          // that its `.get(...)` accessor works during evaluation).
          const op =
            args[1].operator === 'Dictionary' ? args[1].canonical : args[1];
          return ce._fn('Declare', [symbolExpr, op]);
        }

        if (args.length === 3)
          return ce._fn('Declare', [symbolExpr, args[1], args[2].canonical]);

        if (args.length === 4)
          return ce._fn('Declare', [
            symbolExpr,
            args[1],
            args[2].canonical,
            args[3].canonical,
          ]);

        return null;
      },
      evaluate: (ops, { engine: ce }) => {
        // Separate an optional trailing attributes dictionary. When the last
        // operand (with arity ≥ 2) is a `Dictionary`, it carries definition
        // attributes (`type`, `value`, `constant`, `holdUntil`); the
        // remaining operands after the symbol are the positional
        // `[type?, value?]`.
        const rest = ops.slice(1);
        let attrs: DictionaryInterface | undefined;
        const last = rest[rest.length - 1];
        if (last !== undefined && isDictionary(last)) {
          attrs = last;
          rest.pop();
        }
        const typeOp = rest[0];
        const valueOp = rest[1];

        // Resolve the effective type spec: a positional type wins over the
        // attributes `type`.
        const typeSource = typeOp ?? attrs?.get('type');
        const hasType = typeSource !== undefined;
        let type: Type | undefined;
        if (hasType) {
          const t = typeSource!.canonical.evaluate();
          const parsed = parseType(
            (isString(t) ? t.string : undefined) ?? sym(t) ?? undefined
          );
          if (!isValidType(parsed)) return undefined;
          type = parsed;
        }

        // Resolve the effective value: a positional value wins over the
        // attributes `value`.
        const valueSource = valueOp ?? attrs?.get('value');
        const hasValue = valueSource !== undefined;
        const value = hasValue ? valueSource!.evaluate() : undefined;

        // Resolve the remaining attributes.
        const isConstant = sym(attrs?.get('constant')) === 'True';
        const holdOp = attrs?.get('holdUntil')?.evaluate();
        const holdUntil = (
          holdOp && isString(holdOp) ? holdOp.string : undefined
        ) as 'never' | 'evaluate' | 'N' | undefined;

        // Declare ONE name with the resolved type/constant/holdUntil.
        //
        // A symbol may already exist in the current scope as an *inferred*
        // binding with no value — typically because the block's canonical
        // pass hoisted it (see `canonicalBlock`), or an earlier statement in
        // this Block (e.g. `Assign(x, ...)`) auto-declared it during the
        // canonical pass. In that case, `ce.declare(...)` would throw
        // "already declared in this scope." Treat that case as an upgrade
        // instead: keep the binding, clear the inferred flag, and (if a
        // type is provided) tighten the type.
        //
        // Bindings that carry a value — e.g. function-argument bindings,
        // or an outer explicit declaration — are NOT upgraded; the
        // original "already declared" error is preserved for them.
        //
        // Exception: a binding this handler itself created or upgraded on a
        // *previous* evaluation (marked `_declaredByStatement`). A scope is
        // re-entered whenever the same Block expression is re-evaluated — a
        // Loop body on its second iteration, or a warmed engine re-running a
        // program — and re-executing the Declare must reset the local, not
        // conflict with its own earlier run.
        const declareOne = (
          symbolName: string,
          boundValue: Expression | undefined
        ): void => {
          const boundHasValue = boundValue !== undefined;
          const currentScope = ce.context.lexicalScope;
          let existing = currentScope.bindings.get(symbolName);
          if (
            existing &&
            (existing as { _declaredByStatement?: boolean })
              ._declaredByStatement === true
          ) {
            currentScope.bindings.delete(symbolName);
            existing = undefined;
          }
          const existingValueDef =
            existing && isValueDef(existing) ? existing : undefined;
          const isAutoDeclareHere =
            !!existingValueDef &&
            existingValueDef.value.inferredType &&
            existingValueDef.value.value === undefined;

          if (isAutoDeclareHere && existingValueDef) {
            // Upgrade the existing auto-declared binding in place.
            (
              existingValueDef as { _declaredByStatement?: boolean }
            )._declaredByStatement = true;
            if (hasType) {
              existingValueDef.value.type = ce.type(type!);
              existingValueDef.value.inferredType = false;
            }
            if (holdUntil) existingValueDef.value.holdUntil = holdUntil;
            if (boundHasValue) ce.assign(symbolName, boundValue!); // assign while mutable
            if (isConstant)
              // Freeze AFTER assigning the value. There is no public setter to
              // turn an existing definition into a constant, so set the backing
              // flag directly. This is safe here: the value was just assigned
              // (so the binding holds a concrete `_value`), and the config-change
              // listener / `_defValue` recomputation that the constructor sets up
              // is only needed for precision-dependent constants (`Pi`), which
              // cannot be expressed through `Declare`.
              (
                existingValueDef.value as unknown as {
                  _isConstant: boolean;
                }
              )._isConstant = true;
          } else {
            // Fresh declaration.
            const def: Partial<SymbolDefinition> = {};
            if (hasType) def.type = type;
            else if (!boundHasValue) {
              // Preserve the bare-declare default (inferred `unknown`). When a
              // value is present without a type, leave the type unset so
              // `ce.declare` infers it from the value.
              def.inferred = true;
              def.type = 'unknown';
            }
            if (boundHasValue) def.value = boundValue;
            if (holdUntil) def.holdUntil = holdUntil;
            if (isConstant) (def as { isConstant?: boolean }).isConstant = true;
            ce.declare(symbolName, def);
            const created = ce.context.lexicalScope.bindings.get(symbolName);
            if (created)
              (
                created as { _declaredByStatement?: boolean }
              )._declaredByStatement = true;
          }
        };

        //
        // `Declare((x, y), {value -> t})` — a destructuring declaration
        // (`let (x, y) = t`). The pattern is a raw Tuple of symbols (`_`
        // skips a position) or nested tuple patterns — irrefutable in FORM;
        // a runtime shape mismatch is an Error value. Requires a value; a
        // type annotation is not supported. Each name declares in the
        // current scope (constant for `const`); evaluates to the tuple
        // value.
        //
        if (isFunction(ops[0], 'Tuple')) {
          if (hasType || !hasValue) return undefined;
          const bindPattern = (
            pattern: Expression,
            v: Expression
          ): Expression | null => {
            if (!isFunction(pattern, 'Tuple'))
              return ce.typeError('tuple', pattern.type, pattern.toString());
            if (!isFunction(v, 'Tuple'))
              return ce.typeError('tuple', v.type, v.toString());
            if (v.nops !== pattern.nops)
              return ce.typeError(
                parseType(
                  `tuple<${Array(pattern.nops).fill('unknown').join(', ')}>`
                )!,
                v.type,
                v.toString()
              );
            for (let i = 0; i < pattern.nops; i++) {
              const p = pattern.ops[i];
              const el = v.ops[i];
              if (isFunction(p, 'Tuple')) {
                const err = bindPattern(p, el.evaluate());
                if (err) return err;
                continue;
              }
              const name = sym(p);
              if (!name) return ce.typeError('symbol', p.type, p.toString());
              if (name === '_') continue;
              declareOne(name, el);
            }
            return null;
          };
          return bindPattern(ops[0], value!) ?? value!;
        }

        const symbolName = sym(ops[0].evaluate());
        if (!symbolName) return undefined;

        declareOne(symbolName, hasValue ? value : undefined);
        return hasValue ? value : ce.Nothing;
      },
    },

    /** Return the type of an expression */
    Type: {
      description: 'Return the type of an expression as a string.',
      lazy: true,
      signature: '(any) -> string',
      // The operand is lazy (Type reports the static type, without
      // evaluating), but a *non-canonical* expression has no type — a lazy
      // operand is not canonicalized, so `Type(y)` reported "unknown" even
      // for a symbol bound to an integer. Canonicalize, don't evaluate.
      evaluate: ([x], { engine: ce }) =>
        ce.string(x.canonical.type.toString() ?? 'unknown'),
    },

    Evaluate: {
      description: 'Evaluate an expression.',
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x]) => x.type,
      canonical: (ops, { engine: ce }) => {
        const xs = checkArity(ce, ops, 1);
        // Redundant nesting: evaluating an `Evaluate` or `N` node is exactly
        // that node's own evaluation, so keep the INNER node (the mirror of
        // `N`'s collapse, where the outer `N` carries the numericization).
        if (xs.length === 1) {
          const h = xs[0].operator;
          if (h === 'Evaluate' || h === 'N') return xs[0];
        }
        return ce._fn('Evaluate', xs);
      },
      evaluate: ([x], options) => x.evaluate(options),
    },

    // Evaluate an expression at a specific point, potentially symbolically
    // i.e. it's the `f|_{a}` notation
    EvaluateAt: {
      description: 'Evaluate a function at one point or between two bounds.',
      lazy: true,
      signature: '(function, lower:expression, upper:expression) -> unknown',
      type: ([x]) => functionResult(x.type.type) ?? 'number',
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return null;
        const fn = canonicalFunctionLiteral(ops[0]);
        if (!fn) return null;
        return ce._fn('EvaluateAt', [
          fn,
          ...ops.slice(1).map((x) => x.canonical),
        ]);
      },
      // EvaluateAt(F, a, b) = F(b) - F(a); it is how a definite integral applies
      // its limits. See ../latex-syntax/dictionary/README.md (integral subsystem).
      evaluate: ([f, lower, upper], { engine: ce }) => {
        // Defense in depth (see CORRECTNESS_FINDINGS P0-1): never beta-reduce
        // a function whose body still contains an inert `Integrate` (an
        // unresolved antiderivative). Substituting a bound for the parameter
        // would capture the integration variable and collapse the integral to
        // a wrong finite value. Keep the `EvaluateAt` form symbolic instead.
        // The definite-integral evaluator no longer produces such a form, but
        // any other caller is protected here too.
        if (f.has('Integrate'))
          return upper === undefined
            ? ce._fn('EvaluateAt', [f, lower])
            : ce._fn('EvaluateAt', [f, lower, upper]);

        if (upper === undefined) {
          //
          // f|_a
          //
          // Let's try to evaluate the function
          const result = apply(f, [lower]);

          // Return the reduced value, including symbolic results (e.g. with
          // free variables). Only keep the symbolic `EvaluateAt` form when the
          // application stalled on an unresolved antiderivative (its body still
          // contains an inert `Integrate`).
          if (result && !result.has('Integrate')) return result;

          // Fallback: return unevaluated symbolic form
          return ce._fn('EvaluateAt', [f, lower]);
        }

        //
        // f|_a^b = f(b) - f(a)
        //
        // Let's try to evaluate the function
        const fLower = apply(f, [lower]);
        const fUpper = apply(f, [upper]);
        // Reduce to `f(b) - f(a)` whenever both applications succeed and
        // neither stalled on an unresolved antiderivative. The result may be
        // symbolic — e.g. `7/2·k` when integrating `k·x`, or the outer
        // variable of a nested integral (`∫∫ x·y dx dy`) — which is exactly
        // what definite integration of a parametric integrand should yield.
        if (
          fLower &&
          fUpper &&
          !fLower.has('Integrate') &&
          !fUpper.has('Integrate')
        ) {
          return fUpper.sub(fLower);
        }
        // Fallback: return unevaluated symbolic form
        return ce._fn('EvaluateAt', [f, lower, upper]);
      },
    },

    BuiltinFunction: {
      description: 'Return a built-in function symbol by name.',
      complexity: 9876,
      lazy: true,
      signature: '(symbol | string) -> symbol',
      canonical: ([symbolArg], { engine: ce }) =>
        ce.symbol(
          sym(symbolArg) ??
            (isString(symbolArg) ? symbolArg.string : undefined) ??
            'Undefined'
        ),
    },

    Function: {
      description: 'A function literal',
      complexity: 9876,
      lazy: true,
      // A parameter is a bare symbol or an annotated `["Typed", symbol, type]`
      // expression, so parameters are `symbol | function`.
      signature: '(expression, (symbol | function)*) -> function',
      // NOTE: for a `Function` *expression* the type is actually computed by the
      // special case in `boxed-function.ts` (`type()`), which bypasses this
      // handler; the finite-numeric widening for unknown params lives there.
      type: ([body, ...args]) =>
        `(${args.map((x) => x.type.type)}) -> ${body.type.type}`,

      canonical: (args, { engine }) =>
        canonicalFunctionLiteralArguments(engine, args) ?? null,

      evaluate: (_args) => {
        // "evaluating" a function literal is not the same as applying
        // arguments to it.
        // See `function apply()` for that.

        return undefined;
      },
    },

    Rule: {
      description: 'Pattern replacement rule.',
      lazy: true,
      signature:
        '(match: expression, replace: expression, predicate: function?) -> expression',
      evaluate: ([_match, _replace, _predicate], { engine: _ce }) => {
        return undefined;
      },
    },

    Simplify: {
      description: [
        'Simplify(expr): simplify an expression.',
        'Simplify(expr, assumptions): simplify under one or more boolean',
        'assumptions (e.g. `x > 0`), or a `List`/`And` of them. The assumptions',
        'hold only for the duration of the simplification.',
      ],
      lazy: true,
      signature: '(any, any?) -> expression',
      type: ([x]) => x?.type ?? undefined,
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce._fn('Simplify', checkArity(ce, ops, 1));
        if (ops.length > 2) return ce._fn('Simplify', checkArity(ce, ops, 2));
        // Keep the assumption held (lazy): `x > 0` must not collapse to a
        // boolean before it is asserted in the simplification scope.
        return ce._fn('Simplify', ops);
      },
      evaluate: (ops, { engine: ce }) => {
        const raw = ops[0];
        if (raw === undefined) return undefined;
        // The `Simplify` operator evaluates its argument first, then applies
        // the simplification rules to the result — the operator counterpart of
        // the `evaluate().simplify()` recipe. Evaluation substitutes assigned
        // symbol values (`let x = 5; Simplify(x^2 + x)` → `30`) and subsumes the
        // producer-head/lambda/index/value reductions `reduceTransformerOperand`
        // performs for the other, reduce-not-evaluate transformers. The held
        // operand arrives UNBOUND, so `.canonical` first — `.evaluate()` on an
        // unbound expression does not resolve its operator definition.
        const x = raw.canonical.evaluate();
        const assumptions = ops[1];
        if (assumptions === undefined) return x.simplify() ?? undefined;
        // A `List`/`And`/`Set` bundles several assumptions; a bare predicate is
        // one. Each is asserted in a temporary scope so the assumptions do not
        // leak past this call.
        const conjuncts =
          isFunction(assumptions, 'List') ||
          isFunction(assumptions, 'And') ||
          isFunction(assumptions, 'Set')
            ? [...assumptions.ops]
            : [assumptions];
        ce.pushScope();
        try {
          for (const a of conjuncts) ce.assume(a);
          return x.simplify() ?? undefined;
        } finally {
          ce.popScope();
        }
      },
    },

    HoldValues: {
      description: [
        'HoldValues(body): evaluate `body` with its assigned free symbols',
        'shielded — each such symbol becomes a pure symbol (its declared type',
        'and in-scope assumptions apply, its assigned value does NOT) for the',
        'duration. The value-blind counterpart of evaluating `body` directly;',
        "analogous to Mathematica's `Block[{x}, …]`.",
        'HoldValues(body, [x, y]): shield only the listed symbols (a List,',
        'Set, Tuple, or a single symbol); every other symbol resolves normally.',
        'Constants (`Pi`, `ExponentialE`, …) are never shielded, assumptions',
        'survive the shield, and the global values are intact afterwards.',
      ],
      // Hold the body: it must NOT evaluate before the shield exists, or a
      // same-named assigned value would substitute first.
      lazy: true,
      signature: '(any, any?) -> expression',
      type: ([x]) => x?.type ?? undefined,
      canonical: (rawOps, { engine: ce }) => {
        // The held operands arrive UNBOUND on the box/parse routes, so a
        // `type` handler reading `body.type` would see `unknown`. `.canonical`
        // binds their structure; it is value-safe (it does NOT substitute
        // assigned symbol values), so the shield still sees the symbols.
        const ops = rawOps.map((op) => op.canonical);
        if (ops.length === 0)
          return ce._fn('HoldValues', checkArity(ce, ops, 1));
        if (ops.length > 2) return ce._fn('HoldValues', checkArity(ce, ops, 2));
        return ce._fn('HoldValues', ops);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const raw = ops[0];
        if (raw === undefined) return undefined;
        // The held operand arrives UNBOUND on the box/parse routes; `.canonical`
        // binds its structure. `.canonical` is value-safe — it does NOT
        // substitute assigned symbol values, so the shield names computed below
        // still see the symbols.
        const body = raw.canonical;
        // Compute the shield names from the (canonical) body, THEN evaluate
        // inside the shield: an explicit list/set/tuple/symbol restricts the
        // shield to those names; otherwise every assigned, non-constant free
        // symbol of the body is shielded.
        const spec = ops[1];
        const names =
          spec === undefined
            ? assignedVariableNames(body)
            : holdValuesShieldNames(spec.canonical);
        return withValueShield(ce, names, () =>
          body.evaluate({ numericApproximation })
        );
      },
    },

    // Block-scoped seeding. See
    // `docs/plans/2026-07-25-random-signature-redesign.md`: the n-th draw of a
    // frame is `hash(seed, n)`, a pure function of the seed and the draw
    // index, so a frame replays exactly while repeated draws inside it still
    // differ.
    WithRandomSeed: {
      description: [
        'WithRandomSeed(seed, body): evaluate `body` with a random seed frame',
        'seeded by `seed` (a finite real or a string). The block replays',
        'identically, while repeated draws WITHIN the frame differ (the n-th',
        'draw is hash(seed, n)).',
        'Scoping is dynamic: the frame is active through user-function calls,',
        'not just lexically inside `body`. Frames nest and the innermost wins.',
        'Counters are per-frame, so a nested frame does not perturb its',
        "parent's subsequent draws.",
        'Outside any frame, draws are live (non-deterministic).',
      ],
      // Consumes draws from the frame's counter: not a pure expression.
      pure: false,
      // Hold the body: it must NOT evaluate before the frame exists.
      lazy: true,
      signature: '(finite_real | string, any) -> expression',
      // Carry the body's type through. Load-bearing, not cosmetic: a bare
      // `expression` makes a framed draw opaque, and a comparison over an
      // operand that might be a collection is declined by the compiler
      // (fail-closed), so `WithRandomSeed(s, Random()) < y` would silently
      // leave the compile path.
      type: ([, body]) => body?.type ?? undefined,
      canonical: (rawOps, { engine: ce }) => {
        // The held operands arrive UNBOUND on the box/parse routes; without
        // this the `type` handler above would read `unknown`. `.canonical`
        // binds their structure and is value-safe (it substitutes no values).
        const ops = rawOps.map((op) => op.canonical);
        if (ops.length !== 2)
          return ce._fn('WithRandomSeed', checkArity(ce, ops, 2));
        return ce._fn('WithRandomSeed', ops);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const [rawSeed, rawBody] = ops;
        if (rawSeed === undefined || rawBody === undefined) return undefined;

        // The seed is evaluated ONCE per frame entry, never per draw.
        const seedValue = rawSeed.canonical.evaluate();
        let seed: number | string;
        if (isString(seedValue)) seed = seedValue.string;
        else if (isNumber(seedValue)) {
          // A non-finite or non-real seed is a structured error, never a
          // shared zero-seed stream.
          if (seedValue.im !== 0 || !Number.isFinite(seedValue.re))
            return ce.error([
              'out-of-range',
              'a finite real number or a string',
              seedValue.toString(),
            ]);
          seed = seedValue.re;
        } else {
          // A seed that does not reduce to a literal (a symbol, an error…)
          // leaves the whole expression unevaluated.
          return undefined;
        }

        return withRandomSeedFrame(ce, seed, () =>
          rawBody.canonical.evaluate({ numericApproximation })
        );
      },
    },

    Solve: {
      description: [
        'Solve(equation, unknown): the list of solutions of an equation for the',
        'unknown. The equation may be an `Equal` expression or a bare expression',
        '(read as `= 0`), e.g. `Solve(x^2 - 1 == 0, x)` or `Solve(x^2 - 1, x)`.',
        "The unknown may be omitted: it defaults to the equation's single free",
        'variable, or to `x` when there are several and one of them is `x`.',
        'Solve([eq1, eq2, …], [x, y, …]): solve a system of equations; each',
        'solution is a tuple of values in the order of the variable list, e.g.',
        'Solve([x + y == 3, x - y == 1], [x, y]) → [(2, 1)].',
      ],
      keywords: ['roots', 'zeros'],
      // Hold the arguments: the equation must NOT be pre-evaluated, or an
      // `Equal` collapses to a boolean (`x^2 = 1` → `False`) before solving.
      lazy: true,
      // Variadic: `Solve(equation, spec₁, spec₂, …)` where each spec is a
      // symbol or `Element(symbol, collection[, condition])` (a domain). The
      // specs may be omitted entirely (the unknown is then inferred from the
      // equation). See `boxed-expression/solve-domain.ts`.
      signature: '(any, any*) -> list',
      canonical: (ops, { engine: ce }) => canonicalSolve(ce, ops),
      evaluate: (ops, { engine: ce }) => evaluateSolve(ce, ops),
    },

    FindRoot: {
      description: [
        'FindRoot(equations, params): numerically find parameter values that',
        'zero the residuals. `equations` is an equation (`lhs == rhs`), a bare',
        'residual expression (read as `= 0`), or a list of either. `params` is',
        'a list of specs (a bare symbol, `(a, a0)`, or `(a, a0, lo, hi)` with',
        'box constraints), matching `FindFit`. Returns a record',
        '{parameters, converged, residualNorm, iterations}.',
      ],
      keywords: ['roots', 'zeros'],
      // Hold the arguments: an `Equal` must not collapse to a boolean, and a
      // parameter symbol may carry a seeded value that must not be substituted
      // before solving.
      lazy: true,
      signature: '(any, any) -> dictionary',
      evaluate: (ops, { engine: ce }) => findRoot(ce, ops),
    },

    ReplaceAll: {
      description: [
        'ReplaceAll(expr, rules): apply one or more replacement rules to `expr`,',
        'then evaluate the result (Mathematica `expr /. rules`).',
        'A rule is `lhs -> rhs` (parsed as `To`) or `Rule(lhs, rhs)`. Several',
        'rules may be given as extra arguments or as a `List`/`Set` of rules;',
        'they are applied simultaneously in a single pass.',
      ],
      // Hold the arguments: the target must not evaluate before substitution,
      // and the rules carry raw `To`/`Rule` forms.
      lazy: true,
      signature: '(any, any+) -> any',
      canonical: (ops, { engine: ce }) => {
        if (ops.length < 2) return ce._fn('ReplaceAll', checkArity(ce, ops, 2));
        return ce._fn('ReplaceAll', ops);
      },
      evaluate: (ops, { engine: _ce }) => {
        const target = ops[0]?.canonical;
        if (target === undefined) return undefined;

        // Gather the rule operands: the 2nd and any further arguments, plus the
        // members of a `List`/`Set` of rules.
        const ruleOps: Expression[] = [];
        for (const op of ops.slice(1)) {
          if (
            isFunction(op, 'List') ||
            isFunction(op, 'Set') ||
            isFunction(op, 'Sequence')
          )
            ruleOps.push(...op.ops);
          else ruleOps.push(op);
        }

        // Split into simple symbol substitutions (applied simultaneously with a
        // single `.subs`, so rule order does not matter) and pattern rules
        // (applied with the rule machinery).
        const substitution: Record<string, Expression> = {};
        const patternRules: Rule[] = [];
        for (const r of ruleOps) {
          if (!isFunction(r, 'To') && !isFunction(r, 'Rule')) return undefined;
          const lhs = r.op1;
          const rhs = r.op2;
          const s = sym(lhs);
          if (s !== undefined) substitution[s] = rhs.canonical;
          else
            patternRules.push({ match: lhs.canonical, replace: rhs.canonical });
        }

        let result = target;
        if (Object.keys(substitution).length > 0)
          result = result.subs(substitution);
        if (patternRules.length > 0)
          result = result.replace(patternRules) ?? result;

        return result.evaluate();
      },
    },

    CanonicalForm: {
      description: [
        'Return the canonical form of an expression',
        'Can be used to sort arguments of an expression.',
        'Sorting arguments of commutative functions is a weak form of canonicalization that can be useful in some cases, for example to accept "x+1" and "1+x" while rejecting "x+1" and "2x-x+1"',
      ],
      complexity: 8200,
      lazy: true,
      signature: '(any, symbol*) -> any',
      // Do not canonicalize the arguments, we want to preserve
      // the original form before modifying it
      canonical: (ops) => {
        if (ops.length === 1) return ops[0].canonical;

        const forms = ops
          .slice(1)
          .map((x) => sym(x) ?? (isString(x) ? x.string : undefined))
          .filter((x) => x !== undefined) as CanonicalForm[];
        return canonicalForm(ops[0], forms);
      },
    },

    N: {
      description: [
        'N(expr): numerically evaluate an expression',
        'N(expr, precision): evaluate to `precision` significant digits',
      ],
      lazy: true,
      signature: '(any, integer?) -> unknown',
      type: ([x]) => x.type,
      canonical: (ops, { engine: ce }) => {
        // Accept one or two arguments: N(expr) or N(expr, precision).
        if (ops.length === 0) return ce._fn('N', checkArity(ce, ops, 1));
        if (ops.length > 2) return ce._fn('N', checkArity(ce, ops, 2));

        // `lazy` keeps the operand from being EVALUATED before the handler
        // runs, but the held operand must still be canonicalized (bound) here:
        // `op.canonical` is value-safe, and an unbound operand breaks
        // consumers that read the node structurally — the map-fusion lowering
        // reads the body of an `N`-wrapped broadcast `Map` mapping function
        // (`lazyBroadcastMap`, `lazyMapNumericApproximation`), and binding is
        // what makes it canonicalize inside the function literal's parameter
        // scope rather than at first evaluation.
        const xs = ops.map((op) => op.canonical);

        // An inner `Evaluate` is subsumed by `N` (`x.N()` already evaluates),
        // for either arity: keep the OUTER `N` — collapsing to the `Evaluate`
        // node would drop the numericization.
        if (isFunction(xs[0], 'Evaluate') && xs[0].nops === 1)
          xs[0] = xs[0].op1;

        // Collapse nested `N(N(x))` for the single-arg form. (Not for
        // `N(N(x), p)`: the inner `N` computes at the engine's precision, the
        // outer rounds to `p` — a different result from `N(x, p)`.)
        if (xs.length === 1 && xs[0].operator === 'N') return xs[0];

        return ce._fn('N', xs);
      },
      evaluate: (ops, { engine: ce }) => {
        // `N` is lazy, so its operand is held unbound. Calling `.N()` on an
        // unbound expression is a no-op (e.g. an unbound `Pi` symbol returns
        // itself), so canonicalize (bind) the operand first. This makes
        // `["N", expr]` equivalent to `expr.N()`.
        const x = ops[0];

        // Single-argument form: evaluate at the engine's current precision.
        if (ops.length < 2) return x.canonical.N();

        // Optional precision argument: the requested number of significant
        // digits. Resolve it numerically (it may be `2 + 3` or a bound symbol).
        let p = ops[1].canonical.N().re;
        if (!Number.isFinite(p) || p < 1) return x.canonical.N();
        p = Math.min(Math.trunc(p), 1000); // cap to avoid runaway precision

        const global = ce.precision;
        if (p > global) {
          // Display precision is global, so to *show* more than `global`
          // digits the engine's working precision must be raised — and left
          // raised. Recompute the (still raw) operand at the new precision so
          // constants like `Pi` materialize to `p` digits.
          ce.precision = p;
          return x.canonical.N();
        }

        // `p <= global`: leave the global precision untouched and round the
        // result down to `p` significant digits (precision has a machine-digit
        // floor, so lowering the global precision can't reach small `p`).
        return roundToSignificantDigits(x.canonical.N(), p);
      },
    },

    // One draw from a DOMAIN. There is no seed argument anywhere in the
    // random family: seeding is `WithRandomSeed`. See
    // `docs/plans/2026-07-25-random-signature-redesign.md` §4.
    Random: {
      description: [
        'Random(): non-deterministic real in [0, 1)',
        'Random(Interval(a, b)): a real in [a, b) (endpoint markers ignored)',
        'Random(Range(...)): an element of the range',
        'Random(xs): an element of the finite collection `xs`',
      ],
      pure: false,
      // One plain signature: it accepts `Random()` and `Random(xs)`, and
      // rejects `Random(5)` and `Random(5, 7)`.
      signature: '((collection | set<real>)?) -> any',
      type: ([domain]) => {
        if (domain === undefined) return 'finite_real';
        return randomElementType(domain);
      },
      // Derived from the DOMAIN's endpoints. (The old handler read
      // `ops.every(x => x.isNonNegative)` against numeric bounds that no
      // longer exist — `Range(1, 10).isNonNegative` is `undefined`.)
      sgn: ([domain]) => {
        // No-arg `Random()` ∈ [0, 1).
        if (domain === undefined) return 'non-negative';
        if (isFunction(domain, 'Interval')) {
          const int = interval(domain);
          if (!int) return undefined;
          // Draws lie in [start, end): non-negative when the low endpoint is,
          // negative when the (excluded) high endpoint is at or below zero.
          if (int.start >= 0) return 'non-negative';
          if (int.end <= 0) return 'negative';
          return undefined;
        }
        if (isFunction(domain, 'Range')) {
          if (domain.count === undefined) return undefined;
          const [first, upper, step] = range(domain);
          const last = rangeLast([first, upper, step]);
          if (!Number.isFinite(first) || !Number.isFinite(last))
            return undefined;
          if (first >= 0 && last >= 0) return 'non-negative';
          if (first <= 0 && last <= 0) return 'non-positive';
        }
        return undefined;
      },
      evaluate: (ops, { engine: ce }) => {
        // 1. No operand: one draw from the ambient frame (live if unframed).
        if (ops.length === 0) return ce.number(ce._random());

        // 2–6. Domain-directed. Validation completes before the draw, so an
        // invalid domain consumes NO draw.
        const plan = analyzeRandomDomain(ce, ops[0]);
        if (plan.kind === 'error') return plan.error;
        if (plan.kind === 'symbolic') return undefined;

        // Exactly ONE draw, for every domain kind — and zero if the selection
        // bails. Branches 4/5 read the domain AFTER drawing (`at()`, a
        // position pick), so a lazy view that shrank between the count and the
        // access yields `undefined` with the counter already advanced;
        // `withDrawRollback` puts it back (§5: symbolic/error consumes 0).
        return withDrawRollback(ce, () => {
          const u = ce._random();

          if (plan.kind === 'sequential')
            return pickPositions(ce, plan.xs, [Math.floor(u * plan.n)])[0];

          return selectRandomElement(ce, plan, u);
        });
      },
    },

    // `k` independent draws from a domain, WITH replacement — the twin of
    // `RandomSample` (without replacement). The source domain is never
    // materialized; only the `k` drawn elements are.
    RandomChoice: {
      description: [
        'RandomChoice(domain, k): a list of k independent draws from ' +
          '`domain`, with replacement. `k` may exceed the size of the ' +
          'domain — that is what replacement means.',
      ],
      pure: false,
      // `k` is typed `number`, not `integer`: a caller who computes a count
      // (`Count(xs)/2`, a fitted value, `4N` for a slider `N`) should not have
      // to round it first. It is rounded on evaluation.
      signature: '(collection | set<real>, number) -> list<any>',
      type: ([domain, k]) => randomListType(domain, k),
      evaluate: ([domain, kOp], { engine: ce }) => {
        // Domain validity is checked FIRST, by KIND, before any `k` test.
        const plan = analyzeRandomDomain(ce, domain);
        if (plan.kind === 'error') return plan.error;
        if (plan.kind === 'symbolic') return undefined;

        const k = randomCount(ce, kOp);
        if (k === null) return undefined;
        if (typeof k !== 'number') return k;
        if (k === 0) return ce.function('List', []);

        // EXACTLY `k` draws, in output order — and zero if the selection bails
        // after drawing (a lazy view that shrank makes `at()` return
        // `undefined`); `withDrawRollback` restores the counter so a symbolic
        // result still consumes nothing (§5).
        return withDrawRollback(ce, () => {
          if (plan.kind === 'sequential') {
            const positions: number[] = [];
            for (let i = 0; i < k; i++) {
              if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
              positions.push(Math.floor(ce._random() * plan.n));
            }
            return ce.function('List', pickPositions(ce, plan.xs, positions));
          }

          const elements: Expression[] = [];
          for (let i = 0; i < k; i++) {
            if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
            const x = selectRandomElement(ce, plan, ce._random());
            if (x === undefined) return undefined;
            elements.push(x);
          }
          return ce.function('List', elements);
        });
      },
    },

    // The Random-redesign tombstones (`RandomInteger`, `RandomList`,
    // `RandomSeed`, `Sample`, `Shuffle`) lived here for the one release
    // promised by the redesign's §9 (0.95.0) and were deleted afterwards.
    // Those heads are now ordinary unrecognized operators — valid, inert
    // expressions — like any other unknown head.

    // @todo: need review
    Signature: {
      description: 'Return the signature string of an operator.',
      lazy: true,
      signature: '(symbol) -> string | nothing',
      evaluate: ([x], { engine: ce }) => {
        if (!x.operatorDefinition) return ce.Nothing;

        return ce.string(x.operatorDefinition.signature.toString());
      },
    },

    Subscript: {
      description: 'Subscript notation for indexing or compound symbols.',
      /**
       * The `Subscript` function can take several forms:
       *
       * If `op1` is a string, the string is interpreted as a number in
       * base `op2` (2 to 36).
       *
       * If `op1` is an indexable collection, `x`:
       * - `x_*` -> `At(x, *)`
       *
       * Otherwise:
       * - `x_0` -> Symbol "x_0"
       * - `x_n` -> Symbol "x_n"
       * - `x_{\text{max}}` -> Symbol `x_max`
       * - `x_{(n+1)}` -> `At(x, n+1)`
       * - `x_{n+1}` ->  `Subscript(x, n+1)`
       */

      // The last (subscript) argument can include a delimiter that
      // needs to be interpreted. Without the hold, it would get
      // removed during canonicalization.
      lazy: true,

      signature: '(collection, any) -> any',
      type: ([op1, op2], { engine: ce }) => {
        if (isString(op1) && asSmallInteger(op2) !== null) return 'integer';
        if (op1.isIndexedCollection)
          return collectionElementType(op1.type.type) ?? 'any';

        // Check if the symbol is declared as a collection type
        const op1Name = sym(op1);
        if (op1Name) {
          const eltType = collectionElementType(op1.type.type);
          if (eltType) return eltType;
        }

        // For symbol bases with complex subscripts (like a_{n+1}), return 'unknown'
        // to allow type inference in arithmetic contexts. Simple subscripts
        // (like a_n) are converted to compound symbols during canonicalization
        // and won't reach this type function.
        if (op1Name) {
          // If the base symbol has subscriptEvaluate, the result will be a number
          // (or undefined, which keeps it as Subscript)
          const symbolDef = ce.lookupDefinition(op1Name);
          if (isValueDef(symbolDef) && symbolDef.value.subscriptEvaluate) {
            return 'number';
          }
          // Check if this would become a compound symbol (simple subscript)
          const sub =
            (isString(op2) ? op2.string : undefined) ??
            sym(op2) ??
            asSmallInteger(op2)?.toString();
          if (sub) return 'symbol';
          // Check for InvisibleOperator of symbols/numbers (also becomes compound symbol)
          if (isFunction(op2, 'InvisibleOperator')) {
            const parts = op2.ops.map(
              (x) => sym(x) ?? asSmallInteger(x)?.toString()
            );
            if (parts.every((p) => p !== undefined && p !== null))
              return 'symbol';
          }
          // Complex subscript - return 'unknown' to allow numeric inference
          return 'unknown';
        }
        return 'expression';
      },

      canonical: ([op1, op2], { engine: ce }) => {
        // Save the raw symbol name BEFORE canonicalization, so that
        // `i` stays `i` (not `ImaginaryUnit`) and `e` stays `e`
        // (not `ExponentialE`) when creating compound symbols.
        const rawName = sym(op1);

        op1 = op1.canonical;
        // Is it a string in a base form:
        // `"deadbeef"_{16}` `"0101010"_2?
        if (isString(op1)) {
          const base = asSmallInteger(op2.canonical);
          if (base !== null && base > 1 && base <= 36) {
            const [value, rest] = fromDigits(op1.string, base);
            if (rest) {
              return ce.error(['unexpected-digit', rest[0]], op1.toString());
            }
            return ce.number(value);
          }
          return ce._fn('Baseform', [
            op1,
            ce.error(['invalid-base', op2.toString()]),
          ]);
        }

        // Is it a collection expression (like a list literal)?
        if (op1.isIndexedCollection) return ce._fn('At', [op1, op2.canonical]);

        // Is it a symbol declared as a collection type?
        // If so, convert to At() for indexing
        const op1Name = sym(op1);
        if (op1Name && collectionElementType(op1.type.type)) {
          // For multi-index subscripts (Sequence/Tuple), pass each index as separate arg
          if (
            (op2.operator === 'Sequence' || op2.operator === 'Tuple') &&
            isFunction(op2)
          )
            return ce._fn('At', [op1, ...op2.ops.map((x) => x.canonical)]);
          return ce._fn('At', [op1, op2.canonical]);
        }

        // If the base symbol has a subscriptEvaluate handler, keep as Subscript
        // so the evaluate handler can call it (don't create compound symbol)
        if (op1Name) {
          const symbolDef = ce.lookupDefinition(op1Name);
          if (isValueDef(symbolDef) && symbolDef.value.subscriptEvaluate) {
            return ce._fn('Subscript', [op1, op2.canonical]);
          }
        }

        // Is it a compound symbol `x_\operatorname{max}`, `\mu_0`
        // Use rawName (pre-canonical) so `i_A` doesn't become `ImaginaryUnit_A`
        if (rawName) {
          const subStr =
            (isString(op2) ? op2.string : undefined) ??
            sym(op2) ??
            asSmallInteger(op2)?.toString();

          if (subStr) return ce.symbol(rawName + '_' + subStr);

          // If subscript is an InvisibleOperator of symbols/numbers (not wrapped
          // in a Delimiter), concatenate them to form a compound symbol name.
          // e.g., `A_{CD}` -> `A_CD`, `x_{ij}` -> `x_ij`, `T_{max}` -> `T_max`
          // Use parentheses for expressions: `A_{(CD)}` remains as subscript expression.
          if (isFunction(op2, 'InvisibleOperator')) {
            const parts = op2.ops.map(
              (x) => sym(x) ?? asSmallInteger(x)?.toString()
            );
            if (parts.every((p) => p !== undefined && p !== null)) {
              return ce.symbol(rawName + '_' + parts.join(''));
            }
          }
        }

        if (isFunction(op2, 'Sequence'))
          ce._fn('Subscript', [op1, ce._fn('List', op2.ops)]);

        // Unwrap Delimiter (parentheses) from the subscript expression
        // e.g., `A_{(n+1)}` -> `["Subscript", "A", ["Add", "n", 1]]`
        let sub = op2;
        if (isFunction(op2, 'Delimiter')) sub = op2.op1.canonical;

        return ce._fn('Subscript', [op1, sub]);
      },

      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const [base, subscript] = ops;

        // Check if base is a symbol with a subscriptEvaluate handler
        if (isSymbol(base)) {
          const def = base.valueDefinition;
          if (def?.subscriptEvaluate) {
            // Evaluate the subscript first
            const evalSubscript = subscript.evaluate({ numericApproximation });

            // Call the custom handler
            const result = def.subscriptEvaluate(evalSubscript, {
              engine: ce,
              numericApproximation,
            });

            // If handler returned a result, use it
            if (result !== undefined) return result;
          }
        }

        // Fallback: return undefined to keep expression symbolic
        return undefined;
      },
    },

    Symbol: {
      complexity: 500,
      description:
        'Construct a new symbol with a name formed by concatenating the arguments',
      broadcastable: true,
      lazy: true,
      signature: 'function',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        return 'symbol';
      },
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce.Nothing;

        // Do not canonicalized any symbol, i.e.
        // ["Symbol", "x"] should not cause the symbol "x" to be
        // declared in the current context.
        return ce._fn(
          'Symbol',
          ops.map((x) => (isSymbol(x) ? x : x.canonical))
        );
      },
      evaluate: (ops, { engine: ce }) => {
        console.assert(ops.length > 0);
        const arg = ops
          .map(
            (x) =>
              sym(x) ??
              (isString(x) ? x.string : undefined) ??
              asSmallInteger(x)?.toString() ??
              ''
          )
          .join('');

        // We canonicalize the symbol in the current
        // context. This allows the symbol to be interpreted as if dynamically scoped, not lexically scoped (lexical vs dynamic scoping)
        // let x = 5;
        // f := () |-> x
        // {
        //  x := 10;
        //  f()
        // }
        // This will return 5. But:
        // let x = 5;
        // f := () |-> Symbol(x)
        // {
        //  x := 10;
        //  f()
        // }
        // will return 10;
        return ce.symbol(arg);
      },
    },

    Timing: {
      description:
        '`Timing(expr)` evaluates `expr` and return a `Pair` of the number of second elapsed for the evaluation, and the value of the evaluation',
      signature:
        '(value, repeat: integer?) -> tuple<result:value, time:number>',
      // `lazy` so the handler receives the RAW operand: `Timing` must time
      // the evaluation itself. As a non-lazy operator the driver evaluated
      // the operand *before* the handler, so the handler was timing a
      // redundant re-walk of an already-evaluated result.
      lazy: true,
      evaluate: (ops, { engine: ce }) => {
        // `lazy` operands arrive RAW: canonicalize explicitly, outside the
        // timed region, so the timer measures pure evaluation.
        const expr = ops[0].canonical;
        const repeat = ops[1]?.canonical.evaluate();
        if (repeat === undefined || sym(repeat) === 'Nothing') {
          // Evaluate once
          const start = globalThis.performance.now();
          const result = expr.evaluate();
          const timing = 1000 * (globalThis.performance.now() - start);

          return ce.tuple(ce.number(timing), result);
        }

        // Evaluate multiple times
        let n = Math.max(3, toInteger(repeat) ?? 3);

        let timings: number[] = [];
        let result: Expression;
        while (n > 0) {
          const start = globalThis.performance.now();
          result = expr.evaluate();
          timings.push(1000 * (globalThis.performance.now() - start));
          n -= 1;
        }

        const max = Math.max(...timings);
        const min = Math.min(...timings);
        timings = timings.filter((x) => x > min && x < max);
        const sum = timings.reduce((acc, v) => acc + v, 0);

        if (sum === 0) return ce.tuple(ce.number(max), result!);
        return ce.tuple(ce.number(sum / timings.length), result!);
      },
    },
  },

  //
  // Wildcards
  //
  {
    Wildcard: {
      description: 'Single-expression pattern wildcard.',
      signature: '(symbol) -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('_');
        return ce.symbol('_' + (sym(args[0]) ?? ''));
      },
    },
    WildcardSequence: {
      description: 'Pattern wildcard matching one or more expressions.',
      signature: '(symbol) -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('__');
        return ce.symbol('__' + (sym(args[0]) ?? ''));
      },
    },
    WildcardOptionalSequence: {
      description: 'Pattern wildcard matching zero or more expressions.',
      signature: '(symbol) -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('___');
        return ce.symbol('___' + (sym(args[0]) ?? ''));
      },
    },
  },

  //
  // LaTeX-related
  //
  {
    LatexString: {
      description:
        'Value preserving type conversion/tag indicating the string is a LaTeX string',
      signature: '(string) -> string',
      evaluate: ([s]) => s,
    },

    Latex: {
      description: 'Serialize an expression to LaTeX',
      signature: '(any+) -> string',
      evaluate: (ops, { engine: ce }) =>
        ce.expr([
          'LatexString',
          ce.string(joinLatex(ops.map((x) => serializeLatex(x.json)))),
        ]),
    },

    Parse: {
      description:
        'Parse a LaTeX string and evaluate to a corresponding expression',
      signature: '(string) -> any',
      evaluate: ([s], { engine: ce }) =>
        ce.expr(parseLatex(isString(s) ? s.string : '') ?? 'Nothing'),
    },
  },

  //
  // String
  //
  {
    // This is a string interpolation function
    String: {
      description:
        'A string created by joining its arguments. The arguments are converted to their default string representation.',
      broadcastable: true,
      signature: '(any*) -> string',
      evaluate: (ops, { engine }) => {
        if (ops.length === 0) return engine.string('');
        // Join the *values*: a string operand contributes its content —
        // `.toString()` on a string is its serialized form, with quotes,
        // which used to leak into the result (`String("x = ", 3)` produced
        // the content `"x = "3`).
        return engine.string(
          ops.map((x) => (isString(x) ? x.string : x.toString())).join('')
        );
      },
    },

    // N-ary string concatenation. Unlike `String` (which coerces any operand
    // to its default string representation), `StringJoin` requires every
    // argument to already be a string — a non-string operand leaves the
    // expression unevaluated. This mirrors Mathematica's `StringJoin`, which
    // stays symbolic on non-string arguments. As a convenience, a single
    // finite collection of strings may be passed instead of the strings as
    // separate arguments (e.g. `StringJoin(Reverse(Characters(s)))`).
    StringJoin: {
      description: [
        'Concatenate strings. Pass the strings as separate arguments, or a ' +
          'single finite collection of strings. A non-string argument (or ' +
          'collection element) leaves the expression unevaluated.',
      ],
      signature: '((string | collection<string>)*) -> string',
      evaluate: (ops, { engine }) => {
        // A single collection argument (e.g. `StringJoin(Reverse(Characters(s)))`):
        // join its elements. A lazy collection (e.g. a `Map` result) is
        // materialized via `.each()`; a non-finite collection stays symbolic.
        let items = ops;
        if (ops.length === 1 && !isString(ops[0]) && ops[0].isCollection) {
          if (ops[0].isFiniteCollection !== true) return undefined;
          items = [...ops[0].each()];
        }
        const parts: string[] = [];
        for (const op of items) {
          if (!isString(op)) return undefined;
          parts.push(op.string);
        }
        return engine.string(parts.join(''));
      },
    },

    // Split a string into a list of user-perceived characters — grapheme
    // clusters (UAX #29) — so a combining-mark sequence or a ZWJ emoji is a
    // single element. For stable, Unicode-version-independent decompositions
    // use `UnicodeScalars` (code points as integers) or `Utf8`/`Utf16` (code
    // units). A non-string argument leaves the expression unevaluated,
    // mirroring `StringJoin`.
    Characters: {
      description: [
        'Characters(s): split a string into a list of user-perceived ' +
          'characters (grapheme clusters). Synonym: GraphemeClusters. For ' +
          'stable integer decompositions see UnicodeScalars, Utf8 and Utf16. ' +
          'A non-string argument leaves the expression unevaluated.',
      ],
      signature: '(string) -> list<string>',
      evaluate: ([s], { engine }) => {
        if (!isString(s)) return undefined;
        return engine.function(
          'List',
          splitGraphemeClusters(s.string).map((c) => engine.string(c))
        );
      },
    },

    // Split a string into a list of substrings. With no separator, split on
    // runs of whitespace — the Unicode White_Space set spelled out in
    // `UNICODE_WHITESPACE`, not `\s`, so the behavior does not depend on the
    // host regex engine — dropping empty parts. With a separator string, use
    // JS `String.split` semantics (empty parts are kept). A non-string
    // argument leaves the expression unevaluated.
    StringSplit: {
      description: [
        'StringSplit(s): split a string on runs of whitespace (the Unicode ' +
          'White_Space code points), dropping empty parts.',
        'StringSplit(s, sep): split a string on the separator string `sep` ' +
          '(empty parts are kept). A non-string argument leaves the ' +
          'expression unevaluated.',
      ],
      signature: '(string, string?) -> list<string>',
      evaluate: ([s, sep], { engine }) => {
        if (!isString(s)) return undefined;
        let parts: string[];
        if (sep === undefined) {
          parts = s.string
            .split(UNICODE_WHITESPACE)
            .filter((p) => p.length > 0);
        } else {
          if (!isString(sep)) return undefined;
          parts = s.string.split(sep.string);
        }
        return engine.function(
          'List',
          parts.map((p) => engine.string(p))
        );
      },
    },

    // Converts arguments interpreted in a specified format to a string.
    StringFrom: {
      description:
        'Create a string by converting its arguments to a string and joining them.',
      signature: '(any, format:string?) -> string',
      evaluate: ([value, format], { engine }) => {
        if (value === undefined) return engine.string('');
        const fmt = (isString(format) ? format.string : undefined) ?? 'default';

        if (fmt === 'default') return engine.string(value.toString());

        if (fmt === 'utf-8') {
          if (!value.isIndexedCollection) {
            return engine.typeError(
              parseType('indexed_collection<integer>'),
              value.type
            );
          }
          return engine.string(
            new TextDecoder('utf-8').decode(
              new Uint8Array(
                [...value.each()].map((x) => toInteger(x) ?? 0xfffd)
              )
            )
          );
        }

        if (fmt === 'utf-16') {
          if (!value.isIndexedCollection) {
            return engine.typeError(
              parseType('indexed_collection<integer>'),
              value.type
            );
          }
          return engine.string(
            new TextDecoder('utf-16').decode(
              new Uint16Array(
                [...value.each()].map((x) => toInteger(x) ?? 0xfffd)
              )
            )
          );
        }

        if (fmt === 'unicode-scalars') {
          const cp = toInteger(value);
          if (cp !== null) return engine.string(String.fromCodePoint(cp));

          if (!value.isIndexedCollection) {
            return engine.typeError(
              parseType('indexed_collection<integer>|integer'),
              value.type
            );
          }
          return engine.string(
            String.fromCodePoint(
              ...[...value.each()].map((x) => toInteger(x) ?? 0xfffd)
            )
          );
        }

        return engine.string(value.toString());
      },
    },

    Utf8: {
      description: 'A collection of UTF-8 code units from a string.',
      signature: '(string) -> list<integer>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        const utf8Buffer = str.buffer;
        // Convert the Uint8Array to a list of integers
        return engine.function(
          'List',
          Array.from(utf8Buffer, (code) => engine.number(code))
        );
      },
    },

    Utf16: {
      description: 'A collection of UTF-16 code units from a string.',
      signature: '(string) -> list<integer>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        const utf16Values: number[] = [];
        // Convert the string to a list of Unicode scalars
        for (let i = 0; i < str.string.length; i++) {
          const codePoint = str.string.charCodeAt(i)!;
          utf16Values.push(codePoint);
        }
        return engine.function(
          'List',
          utf16Values.map((cp) => engine.number(cp!))
        );
      },
    },

    UnicodeScalars: {
      description:
        'A collection of Unicode scalars from a string, same as UTF-32',
      signature: '(string) -> list<integer>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        const codePoints = str.unicodeScalars;
        return engine.function(
          'List',
          codePoints.map((cp) => engine.number(cp))
        );
      },
    },

    // Synonym of `Characters` (which is the preferred name); kept for
    // compatibility (shipped since v0.30).
    GraphemeClusters: {
      description:
        'A collection of grapheme clusters from a string. Synonym of Characters.',
      signature: '(string) -> list<string>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        return engine.function(
          'List',
          splitGraphemeClusters(str.string).map((c) => engine.string(c))
        );
      },
    },

    BaseForm: {
      description: '`BaseForm(expr, base=10)`',
      complexity: 9000,
      signature: '(number, (string|number)?) -> string | nothing',
      type: ([x]) => (x === undefined ? 'nothing' : x.type),
      evaluate: ([x]) => x,
    },

    DigitsFrom: {
      description: `Return an integer representation of the string \`s\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output

      signature: '(string, (string|integer)?) -> integer',

      evaluate: (ops, { engine }) => {
        let op1str = isString(ops[0]) ? ops[0].string : undefined;
        const ce = engine;
        if (!op1str) return ce.typeError('string', ops[0]?.type, ops[0]);

        op1str = op1str.trim();

        if (op1str.startsWith('0x'))
          return ce.number(parseInt(op1str.slice(2), 16));

        if (op1str.startsWith('0b'))
          return ce.number(parseInt(op1str.slice(2), 2));

        const op2 = ops[1] ?? ce.Nothing;
        if (sym(op2) === 'Nothing')
          return ce.number(Number.parseInt(op1str, 10));

        const base = op2.re;
        if (!op2.isInteger || !Number.isFinite(base) || base < 2 || base > 36)
          return ce.error(['unexpected-base', base.toString()], op2.toString());

        const [value, rest] = fromDigits(
          op1str,
          (isString(op2) ? op2.string : undefined) ?? sym(op2) ?? 10
        );

        if (rest) return ce.error(['unexpected-digit', rest[0]], rest);

        return ce.number(value);
      },
    },

    IntegerString: {
      description: `\`IntegerString(n, base=10)\` \
      return a string representation of the integer \`n\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output
      broadcastable: true,
      signature: '(integer, integer?) -> string',
      evaluate: (ops, { engine }) => {
        const ce = engine;
        const op1 = ops[0];
        if (!op1.isInteger) return ce.typeError('integer', op1.type, op1);

        const val = op1.re;
        if (!Number.isFinite(val))
          return ce.typeError('integer', op1.type, op1);

        const op2 = ops[1] ?? ce.Nothing;
        if (sym(op2) === 'Nothing') {
          if (op1.bignumRe !== undefined)
            return ce.string(op1.bignumRe.abs().toString());
          return ce.string(Math.abs(val).toString());
        }

        const base = asSmallInteger(op2);
        if (base === null) return ce.typeError('integer', op2.type, op2);

        if (base < 2 || base > 36)
          return ce.error(
            ['out-of-range', '2', '36', base.toString()],
            op2.toString()
          );

        return ce.string(Math.abs(val).toString(base));
      },
    },
  },
  {
    RandomExpression: {
      description: 'Generate a random expression.',
      signature: '() -> expression',
      evaluate: (_ops, { engine }) => engine.expr(randomExpression()),
    },
  },

  // ---------------------------------------------------------------------------
  // Opaque typed heads — registered so the names are in the standard set
  // (consumers can branch on the operator name); CE itself does not evaluate
  // them. Geometric primitives `Triangle`/`Sphere`/`Segment` and the action
  // arrow `To` (`a \to b`).
  // ---------------------------------------------------------------------------
  {
    Triangle: {
      description: 'Triangle primitive — opaque typed head.',
      signature: '(any+) -> expression',
    },
    GeometricVector: {
      description:
        'Geometric vector (directed segment between two points) — opaque typed head. Distinct from the column-vector `Vector` operator.',
      signature: '(any, any) -> expression',
    },
    Sphere: {
      description: 'Sphere primitive — opaque typed head.',
      signature: '(any+) -> expression',
    },
    Segment: {
      description: 'Segment primitive — opaque typed head.',
      signature: '(any+) -> expression',
    },
    Polygon: {
      description: 'Polygon primitive — opaque typed head.',
      signature: '(any+) -> expression',
    },

    // Euclidean-geometry notation, transcribed as inert heads (no evaluator);
    // consumers use the structural parse to render figures. See
    // `latex-syntax/dictionary/definitions-other.ts`.
    Angle: {
      // Return type `number`: an angle is a measure, so it composes in
      // arithmetic and comparisons (`\angle ABC + \angle APC = 180^\circ`).
      description:
        'Angle mark / measure (`\\angle ABC`, `\\varangle XYZ`, `∠ABC`) — opaque typed head; not evaluated.',
      signature: '(any+) -> number',
    },
    IndexedSequence: {
      // Scripted-brace sequence notation `\{a_n\}_{n=1}^{\infty}`:
      // `IndexedSequence(term, index, lower, upper?)`. Inert for now: it is
      // held (not evaluated) and stays symbolic — the `term` operand carries
      // the index in call form (`["a_", "n"]`) so the binding survives symbol
      // fusion. Typed `-> expression` rather than `collection`: it has no
      // collection handlers yet, so claiming `collection` would be dishonest.
      // `lazy` keeps the held term from being evaluated/canonicalized.
      description:
        'Indexed sequence `\\{a_n\\}_{n=1}^{\\infty}` — inert head `IndexedSequence(term, index, lower, upper?)`; not evaluated.',
      lazy: true,
      signature: '(any, symbol, any, any?) -> expression',
    },
    Quadrilateral: {
      description:
        'Quadrilateral mark (`\\square ABCD`) — opaque typed head; not evaluated.',
      signature: '(any+) -> expression',
    },
    Perpendicular: {
      description:
        'Perpendicularity relation (`AB \\perp CD`) — opaque typed head; not evaluated.',
      signature: '(any, any) -> expression',
    },
    Parallel: {
      description:
        'Parallelism relation (`AB \\parallel CD`) — opaque typed head; not evaluated.',
      signature: '(any, any) -> expression',
    },
    Arc: {
      // Return type `number`: an arc measure composes in arithmetic
      // (`\widehat{ABC} - \widehat{ATD} = \widehat{DAC}`).
      description:
        'Arc / wide-hat accent measure (`\\widehat{ABC}`) — opaque typed head; not evaluated.',
      signature: '(any+) -> number',
    },
    OverParen: {
      description:
        'Over-paren accent (`\\overparen{BC}`) — opaque typed head; not evaluated.',
      signature: '(any+) -> expression',
    },
    To: {
      description: 'Action arrow / mapping (`a \\to b`) — opaque typed head.',
      signature: '(any, any) -> nothing',
    },
    Colon: {
      description: 'Type annotation (`a : b`) — opaque typed head.',
      signature: '(any, any) -> expression',
    },
    Prime: {
      description:
        "Derivative or prime notation (`f'`, `f^{(n)}`) — opaque typed head until a derivative library handler runs.",
      signature: '(any, integer?) -> unknown',
      // A primed entity denotes something of the same kind as its base:
      // `a'` on a number-valued symbol is another value (so `\sin a'`
      // type-checks), `f'` on a function is a function. Mirror the type.
      type: ([x]) => x?.type ?? 'unknown',
    },
  },
];

/**
 * Round a numeric result to `p` significant digits at the *value* level, so
 * the returned number genuinely carries `p` digits (independent of whatever
 * precision a downstream consumer serializes at). Used by `N(expr, p)` when
 * the requested precision is at or below the engine's working precision.
 *
 * Non-numeric results (symbolic expressions, collections) are returned
 * unchanged.
 */
function roundToSignificantDigits(value: Expression, p: number): Expression {
  const ce = value.engine;
  const re = value.re;
  const im = value.im;
  // Only round concrete finite numbers; leave symbolic results / non-numbers
  // (where `re`/`im` are `NaN`) and infinities unchanged.
  if (!Number.isFinite(re) || !Number.isFinite(im)) return value;

  // Complex: round each component (machine precision is enough here; JS
  // `toPrecision` caps at 100 significant digits).
  if (im !== 0) {
    const clamp = Math.min(p, 100);
    return ce.number(
      ce.complex(Number(re.toPrecision(clamp)), Number(im.toPrecision(clamp)))
    );
  }

  // Real: round the bignum to `p` significant digits (preserving large `p`).
  // `ce.bignum(re)` covers the machine-float case where there is no `bignumRe`.
  const bd = value.bignumRe ?? ce.bignum(re);
  return ce.number(bd.toPrecision(p));
}
