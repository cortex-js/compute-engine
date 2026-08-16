import type { Expression } from '../global-types.js';

import type {
  CompileMode,
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types.js';
import { compileDiagnosticOf } from './diagnostics.js';
import {
  BaseCompiler,
  couldBeCollectionParticipant,
  isFlatAllStringComparisonParticipant,
  isMixedStringOrderingParticipants,
  isNumericTupleParticipant,
  isProvablyCharacterOperand,
  isProvablyStringComparisonParticipant,
  isProvablyStringOperand,
  isProvablyTupleParticipant,
  statementBodyHead,
  unfaithfulComparisonAggregate,
} from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { tryGetConstant } from './constant-folding.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { isPointListValue } from '../collection-utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  collectionElementType,
  resolveTypeForCompilation,
} from '../../common/type/utils.js';
import type { Type, TypeReference } from '../../common/type/types.js';
import { declarationOf } from '../../common/type/reference.js';
import {
  isNonFiniteBound,
  requirePrimitiveElements,
} from './javascript-target.js';

/**
 * Python mathematical constants, keyed by MathJSON symbol.
 *
 * Referenced both by the target's `var` resolver and — so an assigned value is
 * folded, matching the JavaScript target and `evaluate()` — by `compile()`.
 */
const PYTHON_CONSTANTS: Record<string, string> = {
  Pi: 'np.pi',
  ExponentialE: 'np.e',
  ImaginaryUnit: '1j',
  Infinity: 'np.inf',
  NaN: 'np.nan',
  GoldenRatio: '((1 + np.sqrt(5)) / 2)',
  CatalanConstant: '0.915965594177219015054603514932384110774',
  EulerGamma: '0.5772156649015328606065120900824024310421',
};

/**
 * A `Take`/`Drop` slice bound or a `Tabulate`/`Fill` dimension: non-negative
 * and ROUNDED, the interpreter's `toInteger` count contract
 * (`Take([…], 2.5)` keeps 3 elements — `Math.round` semantics, i.e.
 * `floor(x + 0.5)`). The previous emissions diverged from the interpreter on
 * fractional runtime counts: `Take`/`Drop` truncated (`int(x)`, dropping an
 * element the interpreter keeps) and `Tabulate`/`Fill` used Python's
 * `round()`, which rounds half to EVEN. A compile-time-constant count is
 * normalized now and emitted as a bare literal (`xs[:10]`, `range(3)`); only
 * a runtime count pays the emitted guard.
 */
function pyClampedCount(
  count: Expression,
  compile: (expr: Expression) => string
): string {
  const n = tryGetConstant(count);
  if (n !== undefined) return `${Math.max(0, Math.round(n))}`;
  return `max(0, int(np.floor((${compile(count)}) + 0.5)))`;
}

/**
 * Fail closed (D6) when any participant is — or is a collection of — a
 * CHARACTER.
 *
 * A character is one UAX #29 grapheme cluster. Python's stdlib cannot segment
 * a string into them, order two of them by code-point sequence with any
 * guarantee of matching the interpreter's `compare.ts` rule, or re-assemble
 * them, so the whole `character` row of the compile matrix is closed on this
 * target for v1. Python's SCALAR string support is untouched: this asks about
 * `character` evidence only, and `character` and `string` are disjoint types.
 * (`docs/plans/2026-08-16-string-phase1-character-type.md`, decision D13.)
 */
function assertPyNoCharacterOperand(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  const isCharacterish = (a: Expression): boolean => {
    if (isProvablyCharacterOperand(a)) return true;
    // A STRING's own element type IS `character` (it is an indexed collection
    // of its grapheme clusters), so the element walk below would report every
    // string as characterish and close the SCALAR string support this target
    // already ships — string equality and all-string orderings. A string
    // operand is answered by the string gates instead
    // (`assertPyNoStringOperand`, `pyCollArg`), never here.
    if (isProvablyStringOperand(a)) return false;
    const elt = collectionElementType(resolveTypeForCompilation(a.type.type));
    return (
      elt !== undefined &&
      elt !== 'never' &&
      isSubtype(resolveTypeForCompilation(elt), 'character')
    );
  };
  if (args.some(isCharacterish))
    throw new Error(
      `${kind}: cannot compile — a character participant. A character is one ` +
        `UAX #29 grapheme cluster, and this target has no stdlib grapheme ` +
        `segmentation or code-point-sequence ordering to reproduce the ` +
        `interpreter's character semantics. Fail closed (D6) — the ` +
        `interpreter evaluates it.`
    );
}

/**
 * Fail closed (D6) when a COMPARISON participant is an aggregate whose
 * whole-value comparison none of this target's kernels reproduces — a
 * `dictionary`, a `record`, or a `tuple` at participant level
 * (`unfaithfulComparisonAggregate`). Mirrors `assertComparableAggregate` on the
 * JavaScript target; the hazards are the same, with NumPy in place of the JS
 * coercion rules:
 *
 *  - a `dictionary`/`record` has no positional lowering at all, so the scalar
 *    equality form (`abs(a - b) <= tol`) is a `TypeError` and the infix `<` of
 *    an ordering compares Python dicts (a `TypeError` too, or worse a
 *    lexicographic answer for another mapping type);
 *  - a `tuple` lowers to a Python tuple, which `np.less` maps over ELEMENT-WISE
 *    (`Less(Tuple(1,2), Tuple(3,4))` → `[True, True]`) and the infix `<`
 *    compares lexicographically, where the interpreter leaves the ordering
 *    symbolic — a point binds atomically.
 *
 * ONE carve-out, applied by the caller and not here: a BINARY `Equal`/
 * `NotEqual` whose EVERY participant is provably tuple-typed skips this gate —
 * see `compilePythonEquality`. The orderings never take it.
 */
function assertPyComparableAggregate(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  for (const a of args) {
    const aggregate = unfaithfulComparisonAggregate(a);
    if (aggregate === null) continue;
    throw new Error(
      `${kind}: cannot compile — a ${aggregate} participant. The interpreter ` +
        `compares it as ONE value, whereas the emitted Python looks inside it: ` +
        `a dictionary or record has no positional lowering (the tolerance test ` +
        `\`abs(a - b)\` raises), and a tuple is mapped over element-wise by ` +
        `\`np.less\` (\`Equal(Tuple(1, 2), List(1, 2))\` answered \`True\`) ` +
        `where a point binds atomically. Fail closed (D6) — the interpreter ` +
        `evaluates it.`
    );
  }
}

/**
 * True when a comparison participant carries `tuple` evidence BELOW its own
 * level — a point LIST (`list<tuple<number, number>>`), or a union/nesting
 * reaching one.
 *
 * This is exactly the case `unfaithfulComparisonAggregate` deliberately does
 * NOT report (its tuple search stops at participant level), because the
 * point-list lowering must keep compiling for the EQUALITY family, whose
 * `_ce_eqcoll` compares each point as one value. The ORDERINGS have no such
 * kernel: `np.less([(1,2)], [(3,4)])` looks INSIDE each point and answers
 * `[[True, True]]`, whereas the interpreter broadcasts to an INERT point
 * comparison (`[(1, 2) < (3, 4)]`). So this predicate gates the orderings only
 * — see `compilePythonRelation`.
 *
 * The walk mirrors `unfaithfulComparisonAggregate`'s structure: a union stays at
 * the SAME level (each member is an alternative value of the participant, not an
 * element of it), a collection peels one level, and a `reference` unfolds to its
 * definition behind the repo's standard per-path cycle guard so a recursive
 * alias (`type pts = list<pts> | tuple<number, number>`) terminates.
 */
function hasNestedTupleEvidence(x: Expression): boolean {
  const walk = (
    t: Type,
    top: boolean,
    visited?: ReadonlySet<TypeReference>
  ): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (typeof r === 'string') return !top && r === 'tuple';
    if (r.kind === 'tuple') return !top;
    if (r.kind === 'union') return r.types.some((m) => walk(m, top, visited));
    const elt = collectionElementType(r);
    if (elt === undefined) return false;
    return walk(elt, false, visited);
  };
  return walk(x.type.type, true);
}

/**
 * Fail closed (D6) when an ORDERING participant is a point list (nested tuple
 * evidence) — see `hasNestedTupleEvidence`. EQUALITY does not take this gate.
 */
function assertPyNoNestedTupleOrdering(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.some(hasNestedTupleEvidence))
    throw new Error(
      `${kind}: cannot compile — a participant whose ELEMENTS are tuples (a ` +
        `point list). \`np.less([(1, 2)], [(3, 4)])\` looks inside each point ` +
        `and answers \`[[True, True]]\`, whereas the interpreter broadcasts to ` +
        `an inert point comparison (\`[(1, 2) < (3, 4)]\`). Only the EQUALITY ` +
        `family admits point lists (whole-value \`_ce_eqcoll\`). ` +
        `Fail closed (D6) — the interpreter evaluates it.`
    );
}

/**
 * Fail closed (D6) when EQUALITY has a provably string-valued participant.
 *
 * The scalar lowering is NUMERIC — `abs((a) - (b)) <= tol` — which for strings
 * raises `TypeError` at run time (pure Python, no NumPy coercion), so
 * `Equal("a", "a")` never answered the interpreter's `True`. Evidence is tested
 * per PARTICIPANT, not per operand, exactly as on the JavaScript target.
 *
 * The ORDERINGS are governed by the narrower `assertPyNoMixedStringOrdering`:
 * all-string orderings agree with interpretation and keep compiling.
 */
function assertPyNoStringOperand(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.some(isProvablyStringComparisonParticipant))
    throw new Error(
      `${kind}: cannot compile — string-valued operands are not supported by ` +
        `this target (the lowering is numeric: a tolerance test on the ` +
        `difference, which raises \`TypeError\` for strings). ` +
        `Fail closed (D6) — the interpreter evaluates it.`
    );
}

/**
 * The ADMISSION side of the SCALAR string-equality rule (tier 2, 2026-08-08) —
 * the mirror of the JavaScript target's `isStringScalarEquality`, clause for
 * clause; see there for the full rationale and the probe evidence.
 *
 * Python's `==` on `str` is exact structural comparison, which IS the
 * interpreter's string semantics (`compare.ts`: `a.string === b.string`, no
 * tolerance) — including the numeric-string trap (`"1" == 1.0` is `False` in
 * Python, matching the interpreter, where the numeric `abs(a - b)` form raised
 * `TypeError`). Cross-sort equality is total in the interpreter (`Equal("a", 1)`
 * → `False`) and Python's `==` agrees, so a participant of unknown type opposite
 * a provable string is admitted; a provably NUMERIC one is not (the tier-0 mixed
 * ruling), nor is anything that may be a collection or an unfaithful aggregate.
 *
 * The same NFC residual applies as on JavaScript: the interpreter normalizes at
 * boxing time, the emitted `==` compares the raw string the caller passed in.
 *
 * The collection disqualifier pairs `isPyCollectionOperand` (the SUBTYPE test,
 * which also decides the `_ce_eqcoll` routing below) with the union-aware
 * `couldBeCollectionParticipant`: a general union such as `string |
 * list<string>` is not a subtype of `list`, so the subtype test alone admitted
 * it and emitted a scalar `==` where the interpreter broadcasts element-wise —
 * the JavaScript target had the identical hole. Such a participant now declines
 * on `assertPyNoStringOperand` (fail closed, D6).
 */
function isPyStringScalarEquality(args: ReadonlyArray<Expression>): boolean {
  if (args.length !== 2) return false;
  if (!args.some(isProvablyStringOperand)) return false;
  if (
    args.some((a) => {
      const t = resolveTypeForCompilation(a.type.type);
      return t !== 'never' && isSubtype(t, 'number');
    })
  )
    return false;
  if (args.some((a) => unfaithfulComparisonAggregate(a) !== null)) return false;
  return !args.some(
    (a) => isPyCollectionOperand(a) || couldBeCollectionParticipant(a)
  );
}

/**
 * Fail closed (D6) when an ORDERING (`Less`/`LessEqual`/`Greater`/
 * `GreaterEqual`) MIXES string evidence with a participant that is not provably
 * a FLAT string (`isMixedStringOrderingParticipants`, shared with the base
 * compiler's infix diverts).
 *
 * All-string is SOUND and keeps compiling, probe-verified against
 * interpretation: the scalar infix `"a" < "b"` and `np.less(["a","c"],
 * ["b","b"])` / `np.less(["a","c"], "b")` all agree with the interpreter's
 * code-unit string comparison (`compare.ts`), chains included.
 *
 * The MIXED case is the wrong one, and wrong in two different ways depending on
 * the shape and the NumPy version: `np.less(["a",10], ["b",9])` coerces `10` to
 * `"10"` and string-compares (a silent `[True, True]` where the interpreter
 * answers `10 < 9` → `False`), while `np.less("a", [1,2])` raises on NumPy 2.x
 * but historically returned a scalar `False` with a `FutureWarning`. Emitted
 * code runs against an arbitrary NumPy, so the shape is gated at COMPILE time
 * on static type evidence rather than trusted to be loud at run time.
 *
 * ACCEPTED RESIDUAL (ruled 2026-08-08): the all-string admission is faithful
 * per UTF-16 code UNIT, the interpreter's ordering (`compare.ts` uses raw JS
 * `<`), while Python's `<` compares code POINTS. The two disagree only when an
 * astral-plane character (≥ U+10000) is ordered against a BMP character in
 * U+E000–U+FFFF: the interpreter sees the leading surrogate (U+D800–U+DBFF)
 * and answers `Less("\u{10000}", "")` → True, Python answers False.
 * Deliberately NOT gated — the divergence needs an astral character on one
 * side, and closing it would mean declining every string ordering or emitting
 * a code-unit comparator. Revisit only if a real corpus hits it.
 */
function assertPyNoMixedStringOrdering(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (isMixedStringOrderingParticipants(args))
    throw new Error(
      `${kind}: cannot compile — an ordering that mixes a string operand with ` +
        `an operand that is not provably a string. The interpreter leaves such ` +
        `a comparison symbolic (\`Less("a", 1)\` stays inert), whereas NumPy ` +
        `coerces the number to a string and answers a plausible-looking ` +
        `boolean (\`np.less(["a", 10], ["b", 9])\` → \`[True, True]\`). An ` +
        `ordering whose operands are ALL provably strings does compile — the ` +
        `interpreter compares strings the same way. ` +
        `Fail closed (D6) — the interpreter evaluates it.`
    );
}

/**
 * Emit a Python equality test with the engine's numeric tolerance baked in at
 * compile time. The interpreter compares numbers within `engine.tolerance`
 * (default 1e-10) — so `0.1 + 0.2 == 0.3` is *true* — while a raw `==` on
 * floats is exact and would disagree. `kind` selects Equal (`<=`) vs NotEqual
 * (`>`). Chained (N-ary) forms are conjoined pairwise with `and`.
 *
 * Collection operands follow the interpreter's gate (see the `Equal`/`NotEqual`
 * evaluate handlers in `library/relational-operator.ts`), which switches on how
 * many operands are collections:
 *
 * - **two or more** collection operands: whole-collection equality, a SCALAR
 *   boolean (`Equal([1,2],[3,4],[5,6])` → `False`). Lowered to the
 *   `_ce_eqcoll` runtime helper, which compares within tolerance element-wise
 *   but folds to one `bool` — a length/shape mismatch is `False`, not an
 *   error. (The old `abs(a - b) <= tol` form was wrong for this shape: it
 *   raises `TypeError` on a plain Python list, and an n-ary chain over
 *   ndarrays conjoins arrays with the scalar `and` — a `ValueError`.)
 * - **exactly one** collection operand: the interpreter BROADCASTS, returning a
 *   *list* of booleans (`Equal([1,2],5)` → `["False","False"]`), a different
 *   result kind than the scalar the 2026-07-31 ruling covers. Declined (D6)
 *   rather than guessed at.
 *
 * An operand whose type does not statically pin it as a collection is treated
 * as scalar (today's emission), as everywhere else on this target.
 */
function compilePythonEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  if (args.length < 2)
    throw new Error(`${kind}: expected at least two arguments`);
  const tol = args[0]?.engine?.tolerance ?? 1e-10;
  const collCount = args.filter(isPyCollectionOperand).length;
  // Ahead of every lowering below (the scalar `abs` form, `_ce_eqcoll`, and
  // both chain forms) — see `assertPyComparableAggregate` /
  // `assertPyNoStringOperand`.
  //
  // The one carve-out in the aggregate gate: a BINARY equality whose EVERY
  // participant is provably tuple-typed with provably NUMERIC components keeps
  // the `_ce_eqcoll` lowering it had before the gate existed. That helper's
  // list-vs-list branch is whole-value equality — exactly the interpreter's
  // atomic point comparison, at equal and at unequal arity (a length mismatch
  // is `False`, and so is the interpreter's answer). Only the MIXED shapes were
  // wrong (`Equal(Tuple(1, 2), List(1, 2))` answered `True` against the
  // interpreter's `False`), and those still decline: one non-tuple participant
  // and `every` fails. The numeric-component requirement
  // (`isNumericTupleParticipant`) closes Python's own `==` coercion: a boolean
  // component made `Equal(Tuple(True), Tuple(1))` answer `True` (`True == 1`)
  // where the interpreter answers `False`.
  //
  // Gate ORDER is load-bearing, as on the JavaScript target: the string gate
  // runs AFTER the tuple carve-out, so a tuple with a string component
  // (`Equal(Tuple(1, "a"), Tuple(1, "a"))`) still declines on string evidence.
  //
  // DELIBERATE DIVERGENCE from the JavaScript target, which fails closed on ANY
  // string evidence: ONE class of string equality is admitted here, because on
  // this target it is FAITHFUL rather than wrong. Where every participant is a
  // provably FLAT all-string collection and the emission is therefore
  // `_ce_eqcoll` (not the numeric `abs` form), the helper compares strings with
  // Python's own structural `==` — including the numeric-string trap it was
  // written for (`Equal(["1"], ["1.0"])` → `False`, matching the interpreter,
  // where `np.asarray(..., dtype=float)` would have parsed both to 1.0). That
  // class is pinned by EXECUTED parity in `compile-python-parity.test.ts`
  // (`eq_coll_strings_equal`, `eq_coll_strings_unequal`,
  // `eq_coll_numeric_strings`, `eq_coll_numeric_strings_same`). Everything else
  // with string evidence declines: the scalar form raises `TypeError`, and the
  // admission side is the narrow `isFlatAllStringComparisonParticipant` so a
  // mixed (`list<string | number>`) or NESTED all-string participant fails
  // closed even though `_ce_eqcoll` was probed faithful on it.
  const tupleEquality =
    args.length === 2 &&
    args.every(isProvablyTupleParticipant) &&
    args.every(isNumericTupleParticipant);
  if (!tupleEquality) assertPyComparableAggregate(kind, args);
  assertPyNoCharacterOperand(kind, args);
  const stringScalarEquality = isPyStringScalarEquality(args);
  const stringCollectionEquality =
    collCount >= 2 && args.every(isFlatAllStringComparisonParticipant);
  if (!stringScalarEquality && !stringCollectionEquality)
    assertPyNoStringOperand(kind, args);
  if (stringScalarEquality) {
    // Structural, NOT the tolerance test — see `isPyStringScalarEquality`.
    const op = kind === 'Equal' ? '==' : '!=';
    return `((${compile(args[0])}) ${op} (${compile(args[1])}))`;
  }
  if (collCount === 1)
    throw new Error(
      `${kind}: a single collection operand broadcasts element-wise in the ` +
        `interpreter (a list of booleans, not a boolean); that shape is not ` +
        `yet implemented on the Python target. Fail closed (D6).`
    );
  if (collCount >= 2) {
    // Whole-collection equality per adjacent pair, folded with the scalar
    // `and` — every pair is a Python `bool` here, so the chain is well-formed.
    const collPair = (a: Expression, b: Expression): string => {
      const eq = `_ce_eqcoll(${compile(a)}, ${compile(b)}, ${tol})`;
      return kind === 'Equal' ? eq : `(not ${eq})`;
    };
    if (args.length === 2) return collPair(args[0], args[1]);
    const collParts: string[] = [];
    // NOTE: a shared middle operand is compiled TWICE (as pair i's `b` and pair
    // i+1's `a`); that is only safe while this target has no impure lowering
    // (`Random` and friends decline today) — emit a temporary if that changes.
    for (let i = 0; i < args.length - 1; i++)
      collParts.push(collPair(args[i], args[i + 1]));
    return `(${collParts.join(' and ')})`;
  }
  const cmp = kind === 'Equal' ? '<=' : '>';
  const pair = (a: Expression, b: Expression): string =>
    `(abs((${compile(a)}) - (${compile(b)})) ${cmp} ${tol})`;
  if (args.length === 2) return pair(args[0], args[1]);
  const parts: string[] = [];
  // Same double-compile-of-the-middle-operand caveat as the collection chain.
  for (let i = 0; i < args.length - 1; i++)
    parts.push(pair(args[i], args[i + 1]));
  return `(${parts.join(' and ')})`;
}

/**
 * Compile a Sum/Product bound. An integer constant is emitted as the literal;
 * anything else is compiled as an expression (symbolic bounds resolve at
 * runtime — a Python `range` needs the value to be an `int`).
 */
function compilePythonBound(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isNumber(expr) && expr.im === 0 && Number.isFinite(expr.re))
    return String(Math.floor(expr.re));
  return BaseCompiler.compile(expr, target);
}

/**
 * Compile a Sum/Product upper bound *plus one* — the engine's upper bound is
 * inclusive, Python `range(a, b)` is exclusive. A literal integer folds the
 * `+ 1` into the number (`range(1, 11)`); a symbolic bound stays `<b> + 1`.
 */
function compilePythonUpperBound(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isNumber(expr) && expr.im === 0 && Number.isFinite(expr.re))
    return String(Math.floor(expr.re) + 1);
  return `${BaseCompiler.compile(expr, target)} + 1`;
}

/**
 * Compile a `Sum`/`Product` to a single Python generator expression:
 *   `sum(<body> for i in range(<lo>, <hi> + 1))`
 *   `math.prod(<body> for i in range(<lo>, <hi> + 1))`
 *
 * Being a single expression (not a statement block), it composes everywhere —
 * lambda body, operand position, or a `compileFunction` single-line return.
 * The engine's inclusive upper bound maps to Python's exclusive `range` upper
 * (`<hi> + 1`); an empty/reversed range yields an empty `range`, so builtin
 * `sum` returns 0 and `math.prod` returns 1 — matching the interpreter.
 *
 * Multi-index forms (`Sum(body, Limits(i,…), Limits(j,…), …)`) are emitted as
 * nested generator clauses (`… for i in … for j in …`) — the natural, trivial
 * Python idiom — so every indexing set is honored (cf. the JS target, which
 * nests single-index loops; GPU targets fail closed instead).
 */
function compilePythonSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): `sum(generator)`/`math.prod(...)`
  // over arrays would silently produce a wrong value. Reached only for the
  // indexed form (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  const body = args[0];
  const clauses = args.slice(1);
  const forClauses: string[] = [];

  // `idxTarget` binds every index seen so far, so an inner clause's bounds and
  // the body resolve the outer indices as bare identifiers.
  let idxTarget = target;
  for (const clause of clauses) {
    if (!isFunction(clause, 'Limits'))
      throw new Error(`${kind}: expected a Limits indexing set`);
    const ops = clause.ops;
    const indexExpr = ops[0];
    if (!isSymbol(indexExpr))
      throw new Error(`${kind}: index must be a symbol`);
    const index = indexExpr.symbol;

    const lowerExpr = ops[1];
    const upperExpr = ops[2];
    // A Python `range` needs finite bounds — reject an unbounded Sum/Product
    // (fail closed) rather than emit `range(1, inf + 1)`.
    if (
      lowerExpr === undefined ||
      upperExpr === undefined ||
      isSymbol(upperExpr, 'Nothing') ||
      upperExpr.isInfinity ||
      lowerExpr.isInfinity
    )
      throw new Error(`${kind}: an unbounded range is not supported`);

    const lowerCode = compilePythonBound(lowerExpr, idxTarget);
    const upperCode = compilePythonUpperBound(upperExpr, idxTarget);
    forClauses.push(`for ${index} in range(${lowerCode}, ${upperCode})`);

    const prev = idxTarget;
    idxTarget = {
      ...prev,
      var: (id) => (id === index ? index : prev.var(id)),
      boundVars: BaseCompiler.withBoundNames(prev, [index]),
    };
  }

  const bodyCode = BaseCompiler.compile(body, idxTarget);
  const gen = `${bodyCode} ${forClauses.join(' ')}`;
  return kind === 'Sum' ? `sum(${gen})` : `math.prod(${gen})`;
}

/**
 * Indent every line of a (possibly multi-line) statement block by one Python
 * level (4 spaces). An empty block becomes `pass` (a valid non-empty suite).
 */
function indentPythonStatements(code: string): string {
  const body = code.trim() === '' ? 'pass' : code;
  return body
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

/**
 * Compile an expression as Python *statements* — evaluated for effect, no value
 * collected. Mirrors `BaseCompiler.compileLoopBody` (the statement dispatch the
 * JS target uses inside loop bodies) but emits Python:
 *
 * - `Nothing` → '' (a no-op; filtered out by the `Block` join).
 * - `Break` → `break`, `Continue` → `continue`, `Return(v)` → `return <v>`.
 * - `If(cond, then[, else])` → a Python `if`/`else` *statement* (not the
 *   expression-If's `(then) if (cond) else (else)`), recursing into each branch
 *   so nested control flow composes. An empty branch becomes `pass`.
 * - `Block` → its statements newline-joined (no trailing `return` — a loop /
 *   branch body is for effect).
 * - `Loop` → a nested statement loop (via `compilePythonLoop`).
 * - anything else → `BaseCompiler.compile` (an expression evaluated for effect,
 *   or an `Assign`).
 *
 * NOTE: statement-form `If` is reached ONLY here — inside a loop body — exactly
 * as the JS target statement-forms `If` only inside `compileLoopBody`. An `If`
 * anywhere else (e.g. a plain function-body `Block`) stays the expression
 * conditional emitted by the `If` function handler.
 */
function compilePythonStatements(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isSymbol(expr, 'Nothing')) return '';
  if (!isFunction(expr)) return BaseCompiler.compile(expr, target);

  const h = expr.operator;

  if (h === 'Break') return 'break';
  if (h === 'Continue') return 'continue';
  if (h === 'Return')
    return `return ${BaseCompiler.compileOp(expr, 0, target, 0, expr.ops[0])}`;

  if (h === 'If') {
    // The Python target's comparisons already emit real Python booleans, so —
    // unlike the JS `compileLoopBody`, whose interval-JS targets need a
    // `scalarConditionTarget` to avoid comparison *objects* — the condition is
    // compiled directly. The condition is a value expression (its own bindable
    // region); each branch is a statement list again (design §5.1(c)).
    const cond = BaseCompiler.compileOp(expr, 0, target, 0, expr.ops[0]);
    let code = `if ${cond}:\n${indentPythonStatements(
      BaseCompiler.withCseScope(expr, 1, target, () =>
        compilePythonStatements(expr.ops[1], target)
      )
    )}`;
    if (expr.ops.length > 2)
      code += `\nelse:\n${indentPythonStatements(
        BaseCompiler.withCseScope(expr, 2, target, () =>
          compilePythonStatements(expr.ops[2], target)
        )
      )}`;
    return code;
  }

  if (h === 'Block') {
    // As in `BaseCompiler.compileLoopBody`: a statement list is where a
    // destructuring assign (`(a, b) := (b, a + b)`) lowers to temporaries +
    // writes. Its value is discarded here, which is what makes the rewrite
    // safe (see `desugarPatternAssign`).
    const stmts = expr.ops.flatMap(
      (s) => BaseCompiler.desugarPatternAssign(s, target) ?? [s]
    );
    const bodyTarget = BaseCompiler.loopBodyTempTarget(stmts, target);
    return BaseCompiler.withCseScope(expr, -1, bodyTarget, () =>
      stmts
        .map((s) => compilePythonStatements(s, bodyTarget))
        .filter((s) => s !== '')
        .join('\n')
    );
  }

  // …and the same statement as a bare (unwrapped) loop body.
  if (h === 'Assign' && isFunction(expr.ops[0], 'Tuple')) {
    const stmts = BaseCompiler.desugarPatternAssign(expr, target);
    if (stmts !== null) {
      const bodyTarget = BaseCompiler.loopBodyTempTarget(stmts, target);
      return stmts
        .map((s) => compilePythonStatements(s, bodyTarget))
        .filter((s) => s !== '')
        .join('\n');
    }
  }

  if (h === 'Loop') return compilePythonLoop(expr.ops, target, expr);

  // A bare expression statement is its own bindable region (keyed
  // `(statement, -1)`); every other statement head reaches its value edges
  // from `compileExpr` (an `Assign` RHS, …).
  return BaseCompiler.compileOp(expr, -1, target, 0, expr);
}

/**
 * Compile a `Loop` — imperative control flow, for effect (evaluates to
 * `Nothing`). Emits a Python statement loop (not a JS IIFE):
 *
 * - `Loop(body)` → `while True:` with the body indented beneath it.
 * - `Loop(body, Element(i, Range(lo, hi)))` (single ascending step-1 Range) →
 *   `for i in range(<lo>, <hi> + 1):` with the body indented beneath it.
 *
 * Other shapes the generic loop compiler accepts (multiple Element clauses, a
 * non-`Range` collection, a stepped/descending Range) fail closed here.
 *
 * The body is compiled as *statements* — a `Block` body is joined by newlines
 * WITHOUT the block hook's trailing `return` (a loop body has no return value),
 * then indented one level under the loop header.
 */
function compilePythonLoop(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The `Loop` node, when the caller has it: its body is a statement-list
   * region (design §5.1(c)). */
  node?: Expression
): string {
  if (!args[0]) throw new Error('Loop: no body');
  const body = args[0];
  const elements = args.slice(1);

  let header: string;
  let bodyTarget = target;

  if (elements.length === 0) {
    header = 'while True:';
  } else {
    if (elements.length > 1)
      throw new Error(
        'Loop: multiple Element clauses are not supported by the Python target'
      );
    const indexing = elements[0];
    if (!isFunction(indexing, 'Element'))
      throw new Error('Loop: expected Element(index, Range(lo, hi))');
    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];
    if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
    if (!isFunction(rangeExpr, 'Range') || rangeExpr.ops.length > 2)
      throw new Error(
        'Loop: only a single ascending step-1 Range(lo, hi) is supported by the Python target'
      );
    const index = indexExpr.symbol;
    const lowerCode = compilePythonBound(rangeExpr.ops[0], target);
    const upperCode = compilePythonUpperBound(rangeExpr.ops[1], target);
    header = `for ${index} in range(${lowerCode}, ${upperCode}):`;
    const prev = target;
    bodyTarget = {
      ...prev,
      var: (id) => (id === index ? index : prev.var(id)),
      boundVars: BaseCompiler.withBoundNames(prev, [index]),
    };
  }

  // Compile the body as statements — statement-form control flow
  // (`If`/`Break`/`Continue`/`Return`), a flattened `Block`, and nested `Loop`s
  // all compose, for effect (no trailing `return`).
  const indented = indentPythonStatements(
    BaseCompiler.withCseScope(node, 0, bodyTarget, () =>
      compilePythonStatements(body, bodyTarget)
    )
  );
  return `${header}\n${indented}`;
}

/**
 * Python operator mappings
 *
 * Python uses similar operators to JavaScript, but with ** for exponentiation.
 * NumPy arrays support element-wise operations with these operators.
 */
const PYTHON_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['*', 12],
  Divide: ['/', 13],
  // Python exponentiation. A literal `0^0` is folded to NaN at canonicalization
  // (matching the interpreter) before it reaches here, and `x^0` folds to 1
  // (as the interpreter simplifies). The residual divergence is a *runtime*
  // dynamic `0**0` (both operands 0 only at run time): Python yields 1, the
  // interpreter NaN. Aligning that would require routing every power through a
  // helper — disproportionate churn (breaks `**` right-associativity) for a
  // rare edge — so it is left as a documented divergence. The JS target aligns
  // it via `_SYS.pow`. See finding CO-P2-24.
  Power: ['**', 15],
  // Equal / NotEqual are NOT operators: a raw `==` on floats is exact, but the
  // interpreter compares within `engine.tolerance`. They are handled as
  // function forms (see `compilePythonEquality`) so the tolerance is honored.
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['and', 4],
  Or: ['or', 3],
  Not: ['not', 14], // Unary operator
};

/** Whether an operand compiles to a NumPy array at run time — a concrete
 * collection or a statically list/collection-typed value. Mirrors the JS
 * target's `isIndexedCollectionOperand`. */
function isPyCollectionOperand(e: Expression): boolean {
  const t = e.type;
  // A STRING matches `indexed_collection` in the type lattice (its elements
  // are its grapheme clusters) but is not a NumPy array, and Python has no
  // stdlib grapheme segmentation — `len()` counts code points — so string
  // collection operations do not compile to Python at all and must FAIL
  // CLOSED here rather than lower as if the string were an array.
  if (t.matches('string')) return false;
  return t.matches('list') || t.matches('indexed_collection');
}

/**
 * The statically-known tensor RANK of an operand, or `undefined` when its type
 * does not pin one down.
 *
 * `.rank` is the engine's static rank — the length of the `dimensions` read off
 * the type (`matrix` → 2, `vector<3>` → 1) — but it answers `0` both for a
 * scalar and for a dimension-less list. A dimension-less `list<T>` whose
 * element type is a NUMBER is still provably rank 1 (the `vector` spelling
 * parses to `list<number>`), so that case is recovered here; everything else
 * with no dimensions is reported as not statically known.
 */
function pyStaticRank(e: Expression): number | undefined {
  const rank = e.rank;
  if (rank > 0) return rank;
  // A type reference answers layout questions as its definition (§4.6 step 1).
  const t = resolveTypeForCompilation(e.type.type);
  if (
    typeof t === 'object' &&
    t.kind === 'list' &&
    isSubtype(t.elements, 'number')
  )
    return 1;
  return undefined;
}

/**
 * Module-level runtime helper injected (once, only when referenced) so
 * `ElementMax`/`ElementMin`/`Clamp` broadcast exactly like the interpreter's
 * `broadcastOverIndexedCollections` — instead of NumPy's own broadcasting,
 * which raises `ValueError` on a length mismatch that is not 1-vs-N.
 *
 * Semantics reproduced (verified empirically against `.evaluate()`):
 * - array operands **zip to the shortest** participating length (each array is
 *   trimmed to `n = min(len)` before the vectorized NumPy op is applied — so
 *   the fast NumPy path is kept, no per-element Python loop);
 * - scalar operands broadcast over the arrays;
 * - a **length-1** result stays a length-1 array (`ElementMax([1,2],[3]) → [3]`,
 *   zipping to the shortest operand), matching the interpreter — which returns a
 *   one-element `List`, never a bare scalar, whenever any operand is a
 *   collection;
 * - all-scalar operands give a scalar (handled on the direct fast path, not
 *   here — this helper is only reached when some operand is a collection).
 *
 * Divergence: an **empty** participating array yields an empty NumPy array
 * here, whereas the interpreter returns `Nothing` (no numeric analogue).
 * `_op` selects the op: `'max'`→`np.maximum`, `'min'`→`np.minimum`,
 * `'clip'`→`np.clip(x, lo, hi)`.
 *
 * A length mismatch (and an empty operand alongside a non-empty one) yields
 * `nan`, matching the interpreter's `incompatible-dimensions` error projected
 * onto a numeric target, and the JavaScript `_SYS.bcast`. The helper used to
 * zip-to-shortest, mirroring the interpreter of the time; the 2026-07-24 ruling
 * replaced truncation with an error everywhere, so trimming here would now
 * reproduce a behavior the interpreter no longer has.
 *
 * The check recurses PER POSITION rather than testing the outer dimension only.
 * NumPy would otherwise recycle a mismatched inner dimension — `(2,2)` against
 * `(2,1)` broadcasts silently — where the interpreter reports each row's
 * mismatch, giving `[nan, nan]` and not a whole-result `nan`. The vectorized
 * NumPy call is kept as a fast path for the common case where every
 * participating array has exactly the same shape (scalars still lift), since no
 * recycling is possible there.
 *
 * This helper is **op-name-keyed** (a fixed set of NumPy routines), not a
 * generic scalar-closure broadcaster like the JavaScript target's `_SYS.bcast`.
 * So it does NOT cover arithmetic (`+`/`*`/…) over a possibly-collection-typed
 * operand (`2·h(x)` with an unknown-return `h`, or a `broadcastable<T>` symbol).
 * Such arithmetic cannot be compiled soundly on Python: the `+`/`*` operators
 * repeat/concatenate a plain `list` (`2 * [1, 2] → [1, 2, 1, 2]`) rather than
 * broadcasting element-wise like the interpreter, and while a NumPy-array
 * binding would broadcast, the artifact cannot constrain what the caller binds.
 * `base-compiler` therefore FAILS CLOSED (D6) on that shape — the engine falls
 * back to the interpreter — rather than emitting binding-dependent output.
 */
const PYTHON_BCAST_HELPER = `def _ce_bcast_apply(_op, _arrs):
    if _op == 'clip':
        return np.clip(_arrs[0], _arrs[1], _arrs[2])
    _pair = np.maximum if _op == 'max' else np.minimum
    _r = _arrs[0]
    for _a in _arrs[1:]:
        _r = _pair(_r, _a)
    return _r

def _ce_bcast(_op, *args):
    _arrs = [np.asarray(a) for a in args]
    _cols = [a for a in _arrs if a.ndim > 0]
    if not _cols:
        return np.asarray(_ce_bcast_apply(_op, _arrs))
    _n = _cols[0].shape[0]
    if any(a.shape[0] != _n for a in _cols) or _n == 0:
        return np.asarray(float('nan'))
    if all(a.shape == _cols[0].shape for a in _cols):
        return np.asarray(_ce_bcast_apply(_op, _arrs))
    return np.asarray([
        _ce_bcast(_op, *[(a[_i] if a.ndim > 0 else a) for a in _arrs])
        for _i in range(_n)
    ])
`;

/**
 * Reduced row echelon form (Gauss–Jordan with partial pivoting), the runtime
 * side of the `RowReduce` lowering — NumPy has no built-in RREF. Mirrors the JS
 * target's `_SYS.rref`; matches the interpreter's `RowReduce` on well-scaled
 * inputs (float pivots, exact-zero test — the same convention as `np.linalg`).
 */
const PYTHON_RREF_HELPER = `def _ce_rref(_m):
    _a = np.asarray(_m, dtype=float).copy()
    _rows, _cols = _a.shape
    _r = 0
    for _c in range(_cols):
        if _r >= _rows:
            break
        _piv = _r + int(np.argmax(np.abs(_a[_r:, _c])))
        if _a[_piv, _c] == 0:
            continue
        _a[[_piv, _r]] = _a[[_r, _piv]]
        _a[_r] = _a[_r] / _a[_r, _c]
        for _k in range(_rows):
            if _k != _r:
                _a[_k] = _a[_k] - _a[_k, _c] * _a[_r]
        _r += 1
    return _a
`;

/**
 * Whole-collection equality within tolerance — the runtime side of the
 * `Equal`/`NotEqual` lowering when two or more operands are collections. The
 * interpreter returns a SCALAR boolean there (see `compilePythonEquality`), so
 * this folds to one Python `bool`.
 *
 * Semantics reproduced (each verified against `.evaluate()`):
 * - a collection compared to a scalar (at any nesting depth) is `False` —
 *   never an exception;
 * - a length or shape mismatch is `False` (`Equal([1,2],[1,2,3])` → `False`),
 *   including ragged inner rows;
 * - numbers compare within the baked engine tolerance, element-wise and
 *   recursively (`Equal([[1,2]],[[1,2+1e-13]])` → `True`);
 * - two empty collections are `True`;
 * - a NON-numeric element (a `list<string>` operand also routes here) compares
 *   with `==`, since tolerance is meaningless there — and, crucially, must not
 *   raise;
 * - two MATCHING infinities are equal (`Equal([Infinity],[Infinity])` → `True`,
 *   opposite signs → `False`) while `NaN` is equal to nothing, itself included
 *   (`Equal([NaN],[NaN])` → `False`).
 *
 * The vectorized `np.asarray` path is a fast path for the common rectangular
 * numeric case, and is taken ONLY when BOTH operands coerce to a genuinely
 * numeric dtype (`kind` in `iuf`). It must not coerce with `dtype=float`:
 * numpy happily parses numeric-looking STRINGS, so `Equal(["1"],["1.0"])` would
 * answer `True` where the interpreter compares the strings and answers `False`.
 * Anything else — strings, mixed or `object` dtype (ragged input), complex —
 * falls through to the recursive element-wise comparison.
 *
 * On both the vectorized and the scalar path, exact `==` is tried BEFORE the
 * tolerance test: `abs(inf - inf)` is `NaN`, so the tolerance test alone would
 * report matching infinities unequal. `NaN` fails both tests, which is the
 * interpreter's answer.
 */
const PYTHON_EQCOLL_HELPER = `def _ce_eqcoll(_a, _b, _tol):
    _al = isinstance(_a, (list, tuple, np.ndarray))
    _bl = isinstance(_b, (list, tuple, np.ndarray))
    if _al != _bl:
        return False
    if not _al:
        try:
            return bool(_a == _b or abs(_a - _b) <= _tol)
        except TypeError:
            return bool(_a == _b)
    try:
        _x = np.asarray(_a)
        _y = np.asarray(_b)
        if _x.dtype.kind in 'iuf' and _y.dtype.kind in 'iuf':
            if _x.shape != _y.shape:
                return False
            with np.errstate(invalid='ignore'):
                return bool(np.all((_x == _y) | (np.abs(_x - _y) <= _tol)))
    except (ValueError, TypeError):
        pass
    if len(_a) != len(_b):
        return False
    return all(_ce_eqcoll(_x, _y, _tol) for _x, _y in zip(_a, _b))
`;

/**
 * `_ce_indexof` — the runtime element test for `IndexOf`, plus its `_ce_same`
 * leaf comparison. This is NOT `_ce_eqcoll`: `IndexOf` compares like the
 * interpreter's `.isSame()`, which is STRUCTURAL and **EXACT** — type-sensitive
 * about bool-ness, container kind and NaN, with NO tolerance on numbers
 * (`IndexOf([0], 5e-11)` answers 0, and
 * `IndexOf([0.30000000000000004], 0.3)` answers 0 — both probe-verified).
 *
 * An earlier version of this helper compared numbers within the engine
 * tolerance, on the belief that the interpreter tolerated float noise. That
 * belief was a PROBE ARTIFACT: the probe was `IndexOf([0.3], 0.1 + 0.2)`, and
 * `Add(0.1, 0.2)` EVALUATES to exactly `0.3` by the engine's exact decimal
 * folding, so the comparison leaf never saw a near-miss float at all. Beware
 * this trap when probing: a needle written as a computed sum tells you nothing
 * about the element test.
 *
 * Python's `in`/`.index` would be close, except for one crack: `True == 1`
 * and `False == 0` are True in Python, so a boolean needle was found in a
 * numeric haystack (and a numeric needle in a boolean one), where the
 * interpreter answers 0. `_ce_same` therefore compares BOOL-ness first and
 * reports unequal when it differs.
 *
 * The rest, on purpose:
 *  - numeric pairs compare with the plain `==` leaf, which is exact but still
 *    crosses int/float (`1 == 1.0` is True — the interpreter agrees);
 *  - a tuple and a list of the same values are NOT the same (mixed container
 *    kinds fall through to `_a == _b`, which is False in Python), which keeps
 *    the `Equal`-family tuple/list distinction and finds a TUPLE needle in a
 *    point list. That distinction applies to NATIVE containers only: an
 *    `np.ndarray` on either side is normalized with `np.asarray(x).tolist()`
 *    and recursed on, so a caller-supplied `(n, 2)` point matrix works (each
 *    row is a 1-D array, which `_a == _b` would have turned into an array and
 *    an ambiguous-truth-value error). An ndarray row is therefore LIST-like,
 *    and a compiled tuple needle matches it — a deliberate choice, matching how
 *    the engine lowers `Matrix` rows (as nested lists / an ndarray);
 *  - strings, and a missing needle → 0, are unchanged.
 *
 * The one other departure from Python equality is NaN: `nan == nan` is False,
 * so a NaN needle was never found, where the interpreter's structural
 * `.isSame()` answers 1. The both-NaN case is guarded to float scalars so an
 * ndarray element cannot reach it (`_a != _a` on an array is an array, and
 * `and` would raise an ambiguous-truth-value error); `np.float64` subclasses
 * `float`, and `np.floating` covers the narrower numpy float scalars.
 *
 * ACCEPTED RESIDUAL (exactness loss, unclosable): a needle COMPUTED at runtime
 * to a near-miss f64 — Python's `0.1 + 0.2` → `0.30000000000000004` — is not
 * found in a `[0.3]` haystack, where the interpreter folds `Add(0.1, 0.2)`
 * exactly to `0.3` and finds it. That is the ordinary exactness loss of
 * compiling to f64 arithmetic, not a defect of the element test: no element
 * test can recover the exact sum, and a tolerance leaf would only trade this
 * residual for wrong answers on genuinely distinct nearby numbers.
 */
const PYTHON_INDEXOF_HELPER = `def _ce_same(_a, _b):
    if isinstance(_a, np.ndarray) or isinstance(_b, np.ndarray):
        return _ce_same(np.asarray(_a).tolist(), np.asarray(_b).tolist())
    if isinstance(_a, (bool, np.bool_)) != isinstance(_b, (bool, np.bool_)):
        return False
    if isinstance(_a, tuple) and isinstance(_b, tuple):
        return len(_a) == len(_b) and all(_ce_same(_x, _y) for _x, _y in zip(_a, _b))
    if isinstance(_a, list) and isinstance(_b, list):
        return len(_a) == len(_b) and all(_ce_same(_x, _y) for _x, _y in zip(_a, _b))
    if isinstance(_a, (float, np.floating)) and isinstance(_b, (float, np.floating)) and _a != _a and _b != _b:
        return True
    return bool(_a == _b)

def _ce_indexof(_l, _v):
    for _i, _x in enumerate(_l):
        if _ce_same(_x, _v):
            return _i + 1
    return 0
`;

/**
 * `_ce_ord` — the shape guard the ORDERING ufuncs (`np.less`, `np.less_equal`,
 * `np.greater`, `np.greater_equal`) are emitted through by
 * `compilePythonRelation`.
 *
 * The interpreter refuses an element-wise ordering of two collections of
 * DIFFERENT lengths: `Less([1,2,3], [1,2])` and `Less([1], [1,2])` both
 * evaluate to `Error("incompatible-dimensions", …)`. NumPy only half agrees —
 * it raises loudly on 3-vs-2, but SILENTLY BROADCASTS 1-vs-n
 * (`np.less([1], [1, 2])` → `[False, True]`), a wrong answer behind a
 * `success: true`. The guard raises on any list-like-vs-list-like length
 * mismatch, the 1-vs-n case included, before applying the ufunc.
 *
 * Scalar-vs-collection broadcasting stays ALLOWED: the interpreter broadcasts a
 * scalar over a collection (`Less(["a","c"], "b")` → `["True","False"]`, pinned
 * in `compile-python-string-fail-closed.test.ts`). A `str` is not list-like in
 * Python's `isinstance` sense, so a string scalar takes the broadcast path as
 * intended. A 0-dimensional ndarray is treated as a scalar too (`len()` on one
 * raises `TypeError`).
 */
const PYTHON_ORD_HELPER = `def _ce_ord(_f, _a, _b):
    def _ce_ord_len(_x):
        if isinstance(_x, np.ndarray):
            return len(_x) if _x.ndim > 0 else None
        if isinstance(_x, (list, tuple)):
            return len(_x)
        return None
    _la = _ce_ord_len(_a)
    _lb = _ce_ord_len(_b)
    if _la is not None and _lb is not None and _la != _lb:
        raise ValueError('incompatible dimensions')
    return _f(_a, _b)
`;

/** Prepend any referenced runtime helper definitions to the compiled `code`.
 * Idempotent per emission unit; a redefinition (if two units are concatenated)
 * is harmless in Python. */
function withPythonHelpers(code: string): string {
  let out = code;
  if (out.includes('_ce_rref(')) out = `${PYTHON_RREF_HELPER}\n${out}`;
  if (out.includes('_ce_bcast(')) out = `${PYTHON_BCAST_HELPER}\n${out}`;
  if (out.includes('_ce_eqcoll(')) out = `${PYTHON_EQCOLL_HELPER}\n${out}`;
  if (out.includes('_ce_indexof(')) out = `${PYTHON_INDEXOF_HELPER}\n${out}`;
  if (out.includes('_ce_ord(')) out = `${PYTHON_ORD_HELPER}\n${out}`;
  return out;
}

/**
 * Fail closed (D6) when `code`, produced by the **expression-only**
 * `compileToSource()` route, is not a single Python expression.
 *
 * `compileToSource()` answers with a bare expression string, and every consumer
 * splices it into an expression position (`_value = (<code>)` in the pyexec
 * harness, a `lambda` body, an f-string). Python `return`, `for` and `while`
 * are STATEMENTS with no expression form, and Python has no expression-level
 * block to wrap a statement sequence in — so a body that lowers to statements
 * (a multi-statement `Block`, a statement-form `Loop`) has no honest emission
 * here. Before this gate the route handed the statements back verbatim behind
 * the string contract: `Block(s ≔ x; s)` returned `"s = x\nreturn s"`, and
 * `Block(Declare s; s ≔ x; Return s)` returned `"s = x\nreturn return s"` —
 * neither of which Python parses.
 *
 * Python does have expression-level binding forms — the immediately-applied
 * `lambda` and the flat comprehension this target already uses for chained
 * relations and CSE — so a general statement→expression lowering is
 * conceivable. That is a FEATURE, not a gate: this declines and points at
 * `compileFunction()`, the statement-capable route (it emits a `def`, and
 * already special-cases a multi-line block body).
 *
 * Run on the code BEFORE `withPythonHelpers`/`withImports`: both legitimately
 * prepend module-level `def`/`import` lines, which are this route's own
 * documented preamble, not the body's shape.
 *
 * A token scan on the source about to be emitted, deliberately — the same
 * technique (and the same two signals) as the GPU targets'
 * `gpuAssertExpressionOnly` and `BaseCompiler.compileValueOperand`'s
 * `bareStatementBlocks` gate. One Python-specific step: unlike the shader
 * languages this target emits STRING literals (`string: JSON.stringify`), and
 * a string whose content is `return` is an expression, so the `return` scan
 * runs with the literals blanked out. The multi-line signal needs no such step
 * — `JSON.stringify` escapes newlines.
 */
function pythonAssertExpressionOnly(subject: string, code: string): void {
  const multiStatement = code.includes('\n');
  if (
    !multiStatement &&
    !/\breturn\b/.test(code.replace(/"(?:[^"\\]|\\.)*"/g, '""'))
  )
    return;
  const excerpt = (multiStatement ? code.split('\n')[0] : code).trim();
  throw new Error(
    `${subject}: this route emits a single Python EXPRESSION, but the body ` +
      `lowers to ${
        multiStatement ? 'a statement sequence' : 'a bare `return` statement'
      } (\`${excerpt}${multiStatement ? '…' : ''}\`). Python has no ` +
      `expression-level block, and \`return\`/\`for\`/\`while\` are ` +
      `statements, so there is no valid emission for this position. Compile a ` +
      `statement body with compileFunction() instead — that route emits a ` +
      `\`def\`. Fail closed (D6).`
  );
}

/**
 * Fail closed (D6) on a Python **expression-only** route (`compileToSource()`,
 * `compileLambda()`) whose body is STRUCTURALLY a statement.
 *
 * The companion to `pythonAssertExpressionOnly`, which scans the EMITTED source
 * for a newline or a `return` token. Two body shapes leave neither signal, so
 * they went out behind the expression contract:
 *
 * - `Assign(s, x)` (and `Block(s ≔ x)`, which unwraps to it) emits the single
 *   line `s = x`. Python assignment is a STATEMENT: `compileToSource()`
 *   returned `"s = x"` and `compileLambda()` returned `"lambda x: s = x"`,
 *   neither of which parses. This target does not emit the walrus operator,
 *   the only expression-level binding form that could carry an assignment here
 *   — and `:=` is not a drop-in for `=` (different precedence, and it is
 *   rejected at statement level and for attribute/subscript targets).
 * - A root `Declare(s, 'number', x)` emits the EMPTY string — Python has no
 *   declaration statement, so the target emits nothing for it, silently
 *   dropping the declared name AND its initializer. `compileToSource()`
 *   returned `""` and `compileLambda()` returned `"lambda x: "`.
 *
 * Structural, on the body BEFORE it is compiled — see `statementBodyHead` for
 * why a textual `=` scan cannot do this job.
 */
function pythonAssertExpressionBody(subject: string, expr: Expression): void {
  const head = statementBodyHead(expr);
  if (head === undefined) return;
  throw new Error(
    `${subject}: this route emits a single Python EXPRESSION, but the body ` +
      (head === 'Assign'
        ? 'is an assignment. Python assignment is a STATEMENT (this target ' +
          'does not emit the walrus operator), so the emitted `s = x` is not ' +
          'valid in an expression position.'
        : 'is a declaration. Python has no declaration statement, so this ' +
          'target emits the EMPTY string for it — the declared name and its ' +
          'initializer would be silently DROPPED.') +
      ` Give the block a VALUE statement (\`Block(s ≔ x; s)\`) and compile it ` +
      `with compileFunction() instead — that route emits a \`def\`. Fail ` +
      `closed (D6).`
  );
}

/**
 * Fail closed (D6) when `compileFunction()`'s body is STRUCTURALLY a statement.
 *
 * `compileFunction()` is the statement-capable route the rest of this class
 * points at, but neither of its two branches can carry a body whose VALUE
 * statement is an assignment or a declaration:
 *
 * - The single-line branch wraps the body in `return`, so `Block(s ≔ x)` came
 *   out as `def f(x):\n    return s = x\n` — invalid Python. So did the
 *   `Declare` shapes (`return `, dropping the initializer; `return return s =
 *   x` when block-wrapped).
 * - The multi-line branch cannot take over: it emits the body verbatim under
 *   the `def` and adds no `return` of its own — it relies on the block hook
 *   having placed one on a VALUE statement. Routing `s = x` through it would
 *   emit `def f(x):\n    s = x\n`, a `def` returning `None`, where the
 *   interpreter gives the block the assigned value. And the branch has the
 *   same hole at its own last line: `Block(s ≔ x; t ≔ s)` emitted
 *   `    return t = s`.
 *
 * The fix is on the caller's side and the message says so: a block whose value
 * statement is an EXPRESSION already compiles correctly through the multi-line
 * branch (`Block(s ≔ x; s)` → `def f(x):\n    s = x\n    return s\n`).
 */
function pythonAssertReturnableBody(subject: string, expr: Expression): void {
  const head = statementBodyHead(expr);
  if (head === undefined) return;
  throw new Error(
    `${subject}: the body's value statement is ` +
      (head === 'Assign'
        ? 'an assignment'
        : 'a declaration (which this target emits as nothing at all)') +
      `, and a Python statement cannot be returned — this route would emit ` +
      `\`return ${head === 'Assign' ? 's = x' : ''}\`, which does not parse. ` +
      `Give the block a VALUE statement (\`Block(s ≔ x; s)\`), which compiles ` +
      `to \`def f(x):\\n    s = x\\n    return s\`. Fail closed (D6).`
  );
}

/**
 * Compile `Max`/`Min`, which **reduce** (fold every operand — including a
 * collection's elements — to a single extremum). A collection operand is
 * reduced with `np.max`/`np.min`; the per-operand results are then combined
 * with the element-wise `np.maximum`/`np.minimum`, which keeps scalar/array
 * operands (the plot variable) vectorized. `np.maximum`/`np.minimum` are
 * strictly binary, so an n-ary fold is emitted. (`np.maximum([…])` — a single
 * list to the element-wise function — is a runtime error and element-wise
 * anyway, which is why the old bare `'np.maximum'`/`'np.minimum'` string
 * mapping was wrong for the reduction.)
 */
function compilePythonExtremum(
  reduce: 'np.max' | 'np.min',
  pairwise: 'np.maximum' | 'np.minimum',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  const parts = args.map((a) =>
    isPyCollectionOperand(a) ? `${reduce}(${compile(a)})` : compile(a)
  );
  if (parts.length === 0) return reduce === 'np.max' ? '-np.inf' : 'np.inf';
  let result = parts[0];
  for (let i = 1; i < parts.length; i++)
    result = `${pairwise}(${result}, ${parts[i]})`;
  return result;
}

/**
 * Compile `Transpose`/`ConjugateTranspose`, optionally wrapping the operand in
 * `wrap` (`np.conjugate`).
 *
 * The interpreter honors the explicit axes ONLY in the three-operand form
 * (`ops.length === 3`); with one or two operands it swaps the last two axes and
 * IGNORES a lone `axis1` — so dropping that operand here matches the
 * interpreter rather than diverging from it. The three-operand form used to
 * emit `np.transpose(m, i, j)`, whose second parameter is a whole permutation
 * (`axes`), not an axis index: a runtime TypeError for `Transpose`, and for
 * `ConjugateTranspose` a silently un-swapped result. `np.swapaxes` is the exact
 * analog of the 1-based axis pair.
 */
function compilePythonTranspose(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  wrap?: string
): string {
  if (args[0] == null) throw new Error('Transpose: missing argument');
  const x = wrap ? `${wrap}(${compile(args[0])})` : compile(args[0]);
  if (args.length < 3) return `np.transpose(${x})`;
  if (args.length > 3 || args[1] == null || args[2] == null)
    throw new Error(
      `Transpose: only the (value) and (value, axis1, axis2) forms compile. ` +
        `Fail closed (D6).`
    );
  return `np.swapaxes(${x}, int(${compile(args[1])}) - 1, int(${compile(
    args[2]
  )}) - 1)`;
}

/**
 * Compile a statistic over the interpreter's flattened SAMPLE. `Mean`, `Median`,
 * `Variance` and `StandardDeviation` are variadic
 * (`((collection|number|distribution)+) -> number`) and the interpreter
 * flattens EVERY operand into a single sample (`Mean([2,3],[5,7])` is 4.25,
 * `Mean(2,3,7)` is 4). The bare `'np.mean'`/… string mappings emitted
 * `np.mean(a, b, …)`, whose second and third positional parameters are numpy's
 * `axis` and `dtype` — a runtime TypeError, or a silently different reduction.
 * More than one operand is therefore spliced into one list.
 */
function compilePythonSample(
  fn: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  kwargs = ''
): string {
  if (args.length === 0 || args[0] == null)
    throw new Error(`${fn}: no argument`);
  if (args.length === 1) return `${fn}(${compile(args[0])}${kwargs})`;
  const parts = args.map((a) =>
    isPyCollectionOperand(a) ? `*${compile(a)}` : compile(a)
  );
  return `${fn}([${parts.join(', ')}]${kwargs})`;
}

/**
 * Compile the FUNCTION form of a chained relation (`Less(a, b, c)`) — reached
 * when an operand is a collection; the scalar case goes through the infix
 * operator route and its `chainOp`.
 *
 * `np.less`/`np.greater_equal`/… are strictly BINARY ufuncs whose third
 * positional parameter is `out`, so the bare string mappings turned
 * `Less(a, b, c)` into `np.less(a, b, c)`: a TypeError on lists and, on
 * ndarrays, `a < b` written INTO `c` — the chain's third operand silently
 * dropped AND clobbered. Chain pairwise with `np.logical_and` instead, matching
 * the interpreter's element-wise `Less([1,9],[3,4],[5,6]) → [True, False]`. The
 * shared middle operands are bound once in an immediately-applied lambda, so
 * each is evaluated exactly once (as the infix route does through `bindExpr`).
 *
 * Every ufunc application — the binary form and each pair of a chain — is
 * emitted through the `_ce_ord` shape guard, because NumPy silently BROADCASTS
 * a 1-element operand over an n-element one where the interpreter reports
 * `incompatible-dimensions`. See `PYTHON_ORD_HELPER`.
 */
function compilePythonRelation(
  fn: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  kind: string
): string {
  if (args.length < 2) throw new Error(`${fn}: expected at least two operands`);
  // The comparison gates. All are reached HERE for every ordering the infix
  // route declines as well: the base compiler diverts a mixed-string,
  // aggregate, or collection-TYPED ordering off the infix `<` so the head falls
  // through to this codegen, which fails closed. No tuple carve-out — the
  // orderings never take one (the interpreter leaves `Less(Tuple, Tuple)`
  // symbolic), and the point-list shape the aggregate gate admits for equality
  // is closed here by `assertPyNoNestedTupleOrdering`.
  assertPyComparableAggregate(kind, args);
  assertPyNoCharacterOperand(kind, args);
  assertPyNoNestedTupleOrdering(kind, args);
  assertPyNoMixedStringOrdering(kind, args);
  if (args.length === 2)
    return `_ce_ord(${fn}, ${compile(args[0])}, ${compile(args[1])})`;
  const names = args.map((_, i) => `_r${i}`);
  let body = `_ce_ord(${fn}, ${names[0]}, ${names[1]})`;
  for (let i = 1; i < args.length - 1; i++)
    body = `np.logical_and(${body}, _ce_ord(${fn}, ${names[i]}, ${names[i + 1]}))`;
  return `(lambda ${names.join(', ')}: ${body})(${args
    .map((a) => compile(a))
    .join(', ')})`;
}

/**
 * Compile the FUNCTION form of `And`/`Or` (reached for a collection operand).
 * `np.logical_and`/`np.logical_or` are binary ufuncs whose third positional
 * parameter is `out` — see `compilePythonRelation`. These are associative, so a
 * plain pairwise fold suffices (no operand is shared between pairs).
 */
function compilePythonLogical(
  fn: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  if (args.length === 0 || args[0] == null)
    throw new Error(`${fn}: no operand`);
  let result = compile(args[0]);
  for (let i = 1; i < args.length; i++)
    result = `${fn}(${result}, ${compile(args[i])})`;
  return result;
}

/**
 * Python/NumPy function implementations
 *
 * Maps mathematical functions to their NumPy equivalents.
 * Most functions are available in the numpy module with np. prefix.
 */
/**
 * Compile a collection operand, failing closed (D6) if it is not an indexed
 * collection (list/vector/range) — the Python analog of the JavaScript
 * target's `collArg`. (Local copy of `isIndexedCollectionOperand` to avoid
 * a cross-target import of a 2-line predicate.)
 */
function pyCollArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number
): string {
  // A STRING is an indexed collection of its GRAPHEME CLUSTERS, and this
  // target cannot produce them: Python's stdlib has no UAX #29 segmentation,
  // so `len(s)` counts code points and `s[i]` selects one — both diverging from
  // the interpreter on a combining sequence, a ZWJ emoji family or a
  // regional-indicator flag. Named separately from the generic diagnostic
  // below, so the reason is the target capability rather than a shape
  // mismatch (the shape now MATCHES).
  // (`docs/plans/2026-08-16-string-phase1-character-type.md`, decision D13.)
  if (arg && arg.type.matches('string'))
    throw new Error(
      `${kind}: cannot compile a string collection to this target — a ` +
        `string's elements are UAX #29 grapheme clusters and Python has no ` +
        `stdlib grapheme segmentation, so the emitted code would walk code ` +
        `points instead. Fail closed (D6) — the interpreter evaluates it.`
    );
  // A collection of CHARACTERS is closed for the same capability reason: an
  // element is one grapheme cluster this target cannot order or re-segment.
  if (arg) assertPyNoCharacterOperand(kind, [arg]);
  if (
    !arg ||
    !(arg.type.matches('list') || arg.type.matches('indexed_collection'))
  )
    throw new Error(
      `${kind}: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is not an indexed collection (list/vector/range). Fail closed (D6).`
    );
  return compile(arg);
}

/**
 * The Python analogs of the JavaScript target's `couldBeIndexedCollectionOperand`
 * / `isNumericIndexOperand` (kept local, like `pyCollArg`, to avoid a
 * cross-target import): a base whose static type merely ADMITS an indexed
 * collection — a union with an indexed arm, the shape a lambda parameter
 * indexed in its body carries (`dictionary | indexed_collection`) — is admitted
 * on the RUNTIME-projection rule, but only with a provably numeric index, since
 * the other arm is a dictionary and a keyed lookup has no compiled equivalent.
 * A top type is not admitted: that is "nothing is known", not "a collection is
 * possible".
 */
function pyCouldBeIndexedCollectionOperand(e: Expression): boolean {
  const t = resolveTypeForCompilation(e.type.type);
  if (t === 'unknown' || t === 'any' || t === 'value') return false;
  // A string is not an array-shaped operand — see `isPyCollectionOperand`.
  if (t === 'string') return false;
  if (typeof t === 'object' && t.kind === 'union')
    return t.types.some((m) => isSubtype(m, 'indexed_collection'));
  return isSubtype(t, 'indexed_collection');
}

function pyIsNumericIndexOperand(e: Expression): boolean {
  return isSubtype(resolveTypeForCompilation(e.type.type), 'number');
}

/**
 * Compile a mapping/predicate operand for the Python target. A `Function`
 * literal compiles through the target's lambda handler; a bare binary
 * arithmetic operator symbol lowers to a Python lambda. Anything else —
 * notably a user-defined function symbol, which the shared user-function
 * registry would emit as *JavaScript* source — fails closed (D6): without
 * this guard the base compiler emits a JS arrow function inside otherwise
 * valid Python.
 */
function pyFnArg(
  kind: string,
  op: Expression | undefined,
  compile: (expr: Expression) => string,
  argTypes: ReadonlyArray<Type | undefined> = []
): string {
  // A parameter ANNOTATION the emitted lambda cannot enforce fails closed
  // (D6), exactly as on the JavaScript target — see
  // `BaseCompiler.assertCallbackAnnotations`. Callers pass the provable type
  // of the value each parameter position receives; an empty list means
  // nothing is provable, so any annotation declines.
  BaseCompiler.assertCallbackAnnotations(kind, op, argTypes);
  if (op && isFunction(op, 'Function')) return compile(op);
  if (op && isSymbol(op)) {
    const glyph = { Add: '+', Subtract: '-', Multiply: '*', Divide: '/' }[
      op.symbol
    ];
    if (glyph !== undefined) return `(lambda _a, _b: _a ${glyph} _b)`;
  }
  throw new Error(
    `${kind}: the function operand does not compile on the Python target ` +
      `(only function literals and binary arithmetic operator symbols ` +
      `lower to a Python lambda). Fail closed (D6).`
  );
}

const PYTHON_FUNCTIONS: CompiledFunctions<Expression> = {
  // Basic arithmetic (for when they're called as functions)
  Add: (args, compile) => {
    if (args.length === 0) return '0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' + ');
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' * ');
  },
  // `Negate` lowers through the prefix `-` operator for a scalar operand; this
  // handler covers the paths the operator mapping declines — chiefly an
  // element-wise broadcast over a collection (`Negate([1,2,3])`), where it
  // supplies the SCALAR ELEMENT lowering that `broadcastUnary` fans out into a
  // comprehension. Without it the head has no function codegen and the fan-out
  // is unreachable. The operand is parenthesized unconditionally: Python's
  // unary `-` binds tighter than `+`, and the function-codegen path these
  // operands come back through is precedence-blind (`Add` joins with ' + '),
  // so `Negate(z + 1)` would otherwise emit `-z + 1`.
  Negate: (args, compile) => `(-(${compile(args[0])}))`,
  // No Subtract handler — canonicalizes to Add+Negate before compilation.
  Divide: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    // `compile()` emits sub-expressions without outer parentheses — wrap
    // before splicing next to `/`.
    if (args.length === 2)
      return `(${compile(args[0])}) / (${compile(args[1])})`;
    // For more than 2 args, fold left
    let result = `(${compile(args[0])})`;
    for (let i = 1; i < args.length; i++) {
      result = `${result} / (${compile(args[i])})`;
    }
    return result;
  },

  // Trigonometric functions (with complex dispatch via cmath)
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sin(${compile(args[0])})`;
    return `np.sin(${compile(args[0])})`;
  },
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.cos(${compile(args[0])})`;
    return `np.cos(${compile(args[0])})`;
  },
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.tan(${compile(args[0])})`;
    return `np.tan(${compile(args[0])})`;
  },
  Arcsin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.asin(${compile(args[0])})`;
    return `np.arcsin(${compile(args[0])})`;
  },
  Arccos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.acos(${compile(args[0])})`;
    return `np.arccos(${compile(args[0])})`;
  },
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.atan(${compile(args[0])})`;
    return `np.arctan(${compile(args[0])})`;
  },
  Arctan2: 'np.arctan2',
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sinh(${compile(args[0])})`;
    return `np.sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.cosh(${compile(args[0])})`;
    return `np.cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.tanh(${compile(args[0])})`;
    return `np.tanh(${compile(args[0])})`;
  },
  Arsinh: 'np.arcsinh',
  Arcosh: 'np.arccosh',
  Artanh: 'np.arctanh',

  // Reciprocal trigonometric functions
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    return `(np.cos(${compile(x)}) / np.sin(${compile(x)}))`;
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    return `(1 / np.sin(${compile(x)}))`;
  },
  Sec: ([x], compile) => {
    if (x === null) throw new Error('Sec: no argument');
    return `(1 / np.cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    // `np.arctan(1/x)` returns the wrong branch for x < 0. `π/2 - arctan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(np.pi / 2 - np.arctan(${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `np.arcsin(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `np.arccos(1 / (${compile(x)}))`;
  },

  // Reciprocal hyperbolic functions
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    return `(np.cosh(${compile(x)}) / np.sinh(${compile(x)}))`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    return `(1 / np.sinh(${compile(x)}))`;
  },
  Sech: ([x], compile) => {
    if (x === null) throw new Error('Sech: no argument');
    return `(1 / np.cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    return `np.arctanh(1 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `np.arcsinh(1 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    return `np.arccosh(1 / (${compile(x)}))`;
  },

  // Elementary
  Lb: 'np.log2',
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    return `np.square(${compile(x)})`;
  },
  Fract: ([x], compile) => {
    if (x === null) throw new Error('Fract: no argument');
    return `np.modf(${compile(x)})[0]`;
  },

  // Exponential and logarithmic
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.exp(${compile(args[0])})`;
    return `np.exp(${compile(args[0])})`;
  },
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.log(${compile(args[0])})`;
    // The caller's `complexPromotion` opt-in: an operand of unknown sign takes
    // the complex lane so the compiled value matches the interpreter's
    // promotion. Uses the SAME predicate `BaseCompiler.isComplexValued`
    // reports to the enclosing node, or the parent reads a real where a
    // complex is returned.
    //
    // `np.emath.log`, not `cmath.log`: the operand here is a REAL of unknown
    // sign, so zero is in range, and `cmath.log(0)` raises `ValueError` where
    // the interpreter answers `-∞` (and the unpromoted `np.log(0)` yields
    // `-inf`). `np.emath` is numpy's domain-relaxed variant — complex for a
    // negative input, `-inf` at zero — which is exactly this option's
    // semantics, and it accepts arrays as the rest of this target does.
    if (BaseCompiler.promotesRadicalToComplex('Ln', args))
      return `np.emath.log(${compile(args[0])})`;
    return `np.log(${compile(args[0])})`;
  },
  Log: (args, compile) => {
    // Log with base: log(x, base). Under the caller's `complexPromotion`
    // opt-in an operand of unknown sign — value OR base, since a negative base
    // makes the quotient complex too — routes through `np.emath`, numpy's
    // domain-relaxed variant (complex for a negative input, `-inf` at zero).
    // See `Ln` above for why `cmath` is the wrong helper for a REAL operand:
    // `cmath.log(0)` raises where the interpreter answers `-∞`.
    const promoted = BaseCompiler.promotesRadicalToComplex('Log', args);
    if (args.length === 1)
      return promoted
        ? `np.emath.log10(${compile(args[0])})`
        : `np.log10(${compile(args[0])})`;
    if (args.length === 2) {
      const fn = promoted ? 'np.emath.log' : 'np.log';
      return `(${fn}(${compile(args[0])}) / ${fn}(${compile(args[1])}))`;
    }
    return 'np.log10';
  },
  Log10: 'np.log10',
  Log2: 'np.log2',
  Exp2: 'np.exp2',

  // Power and roots
  Power: (args, compile) => {
    if (args.length !== 2) return 'np.power';
    if (
      BaseCompiler.isComplexValued(args[0]) ||
      BaseCompiler.isComplexValued(args[1])
    )
      return `(${compile(args[0])} ** ${compile(args[1])})`;
    return `np.power(${compile(args[0])}, ${compile(args[1])})`;
  },
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sqrt(${compile(args[0])})`;
    // The `complexPromotion` opt-in — see `Ln` above. `np.emath.sqrt` rather
    // than `cmath.sqrt` for the same two reasons that matter across all three
    // promoted heads: the operand is a REAL of unknown sign (so the whole real
    // line, zero included, is in range) and `cmath` accepts only Python
    // scalars, raising `TypeError` on the numpy arrays this target otherwise
    // supports throughout.
    if (BaseCompiler.promotesRadicalToComplex('Sqrt', args))
      return `np.emath.sqrt(${compile(args[0])})`;
    return `np.sqrt(${compile(args[0])})`;
  },
  Root: (args, compile) => {
    // Root(x, n) = x^(1/n)
    if (args.length !== 2) return 'np.power';
    const [x, n] = args;
    const nConst = tryGetConstant(n);
    // Odd integer degree: `np.power` is NaN for a negative base, but the real
    // root exists (interpreter convention, e.g. Root(-8, 3) = -2). Emit the
    // sign-corrected form `sign(x)·|x|^(1/n)`.
    if (nConst !== undefined && Number.isInteger(nConst) && nConst % 2 !== 0) {
      const c = compile(x);
      return `(np.sign(${c}) * np.power(np.abs(${c}), 1.0 / ${compile(n)}))`;
    }
    return `np.power(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Rounding and absolute value
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `abs(${compile(args[0])})`;
    return `np.abs(${compile(args[0])})`;
  },
  Sign: 'np.sign',
  Floor: 'np.floor',
  Ceil: 'np.ceil',
  // The interpreter rounds half away from zero (Round(-2.5) = -3, Round(2.5) =
  // 3); `np.round` uses banker's rounding (Round(2.5) = 2). Reconstruct
  // half-away as `sign(x)·floor(|x| + 0.5)`.
  Round: (args, compile) => {
    const x = args[0];
    if (x == null) throw new Error('Round: no argument');
    const halfAway = (c: string): string =>
      `(np.sign(${c}) * np.floor(np.abs(${c}) + 0.5))`;
    if (args.length < 2) return halfAway(compile(x));
    // The SECOND operand is a PRECISION: `Round(x, n)` rounds to `n` decimal
    // places (the signature is `(number, integer?)`), i.e. `Round(x·10ⁿ)/10ⁿ`
    // — what the interpreter, the JavaScript target and the interval target
    // all compute — and a negative `n` rounds to tens/hundreds/…
    // (`Round(1234.5678, -2)` is 1200). This lowering used to consume only
    // `args[0]`, so `Round(3.14159, 2)` reported success on code computing 3
    // where the interpreter answers 157/50.
    //
    // Unlike the GPU targets, Python needs neither a compile-time-constant
    // guard nor a |n| range guard: `10 ** n` is an exact arbitrary-precision
    // integer for n ≥ 0 and a correctly-rounded float for n < 0 — never the
    // shader's `exp2(n·log2(10))` approximation, which moves the very tie
    // boundary the rounding depends on. A RUNTIME `n` therefore lowers
    // soundly.
    const n = tryGetConstant(args[1]);
    if (n !== undefined && Number.isInteger(n)) {
      const factor = `10 ** ${n}`;
      const scaled = `((${compile(x)}) * ${factor})`;
      return `(${halfAway(scaled)} / ${factor})`;
    }
    // A runtime precision: bind the factor and the scaled value once each, so
    // neither operand's code is evaluated twice.
    return (
      `(lambda _p: (lambda _t: ${halfAway('_t')} / _p)` +
      `((${compile(x)}) * _p))(10 ** (${compile(args[1])}))`
    );
  },
  Truncate: 'np.trunc',

  // Min/Max — REDUCTIONS: fold every operand (a collection to its own extremum)
  // to a single value. `np.maximum`/`np.minimum` are element-wise and strictly
  // binary, so a bare mapping mis-handled a collection operand (element-wise
  // instead of reduced) and errored on 1 or 3+ arguments.
  Min: (args, compile) =>
    compilePythonExtremum('np.min', 'np.minimum', args, compile),
  Max: (args, compile) =>
    compilePythonExtremum('np.max', 'np.maximum', args, compile),
  // Element-wise max/min and clamp, matching the interpreter's broadcasting.
  //
  // When every operand is a scalar (statically), a length mismatch is
  // impossible, so we keep the direct `np.maximum`/`np.minimum`/`np.clip` fast
  // path (element-wise and broadcasting) — the common plotting shape and
  // unchanged output. When any operand is a collection, we route through the
  // injected `_ce_bcast` runtime helper (see PYTHON_BCAST_HELPER), which
  // zip-to-shortest trims the arrays before applying the vectorized NumPy op —
  // reproducing `broadcastOverIndexedCollections` (`ElementMax([1,2,3],[4,5]) →
  // [4,5]`; a length-1 result stays a one-element array, `[3]`, matching the
  // interpreter) instead of NumPy's own broadcasting, which raises `ValueError`
  // on a non-(1-vs-N) length mismatch.
  ElementMax: (args, compile) => {
    if (!args.some(isPyCollectionOperand)) {
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `np.maximum(${result}, ${compile(args[i])})`;
      return result;
    }
    return `_ce_bcast('max', ${args.map((a) => compile(a)).join(', ')})`;
  },
  ElementMin: (args, compile) => {
    if (!args.some(isPyCollectionOperand)) {
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `np.minimum(${result}, ${compile(args[i])})`;
      return result;
    }
    return `_ce_bcast('min', ${args.map((a) => compile(a)).join(', ')})`;
  },
  Clamp: (args, compile) => {
    if (!args.some(isPyCollectionOperand))
      return `np.clip(${compile(args[0])}, ${compile(args[1])}, ${compile(
        args[2]
      )})`;
    return `_ce_bcast('clip', ${compile(args[0])}, ${compile(
      args[1]
    )}, ${compile(args[2])})`;
  },

  // Modulo. `np.mod` is floored (matches the interpreter and D1). `Remainder`
  // uses the interpreter's truncated/round-to-nearest-quotient semantics, NOT
  // `np.remainder` (which is a floored modulo): mirror the JS target's
  // `a - b·round(a/b)`.
  Mod: 'np.mod',
  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    // `compile()` emits sub-expressions without outer parentheses, and
    // `*`/`/` bind tighter than `+` — wrap before splicing.
    const ca = `(${compile(a)})`;
    const cb = `(${compile(b)})`;
    return `(${ca} - ${cb} * np.round(${ca} / ${cb}))`;
  },

  // Complex numbers
  Real: 'np.real',
  Imaginary: 'np.imag',
  Argument: 'np.angle',
  Conjugate: 'np.conj',

  // Array/Vector operations
  // Indexed Sum/Product compile to Python generator expressions (single
  // expressions, so they compose everywhere). The `Limits` clause carried by an
  // indexed Sum/Product would throw under a plain `np.sum(...)` string mapping.
  Sum: (args, _compile, target) => compilePythonSumProduct('Sum', args, target),
  Product: (args, _compile, target) =>
    compilePythonSumProduct('Product', args, target),
  // Mean/Median/Variance/StandardDeviation are VARIADIC and reduce over the
  // flattened sample — see `compilePythonSample`.
  Mean: (args, compile) => compilePythonSample('np.mean', args, compile),
  Median: (args, compile) => compilePythonSample('np.median', args, compile),
  // CE `Variance`/`StandardDeviation` are the SAMPLE statistics (there are
  // separate `PopulationVariance`/`PopulationStandardDeviation` heads), so the
  // numpy calls need `ddof=1`: the default `ddof=0` is the population form and
  // was a silent wrong value (`Variance([2,3,7])` is 7, `np.var` gives 14/3).
  Variance: (args, compile) =>
    compilePythonSample('np.var', args, compile, ', ddof=1'),
  StandardDeviation: (args, compile) =>
    compilePythonSample('np.std', args, compile, ', ddof=1'),
  // Covariance/Correlation: two-collection form only. numpy `np.cov` defaults
  // to ddof=1 (sample) and returns the 2×2 covariance matrix — the off-diagonal
  // entry [0][1] is Cov(x, y). `np.corrcoef` returns the correlation matrix.
  // `== null`, not `=== null`: the SECOND operand is optional in the signature,
  // so a one-operand `Covariance([1,2])` arrives as `undefined` — which slipped
  // past a `=== null` guard and emitted `np.cov([1, 2], )`, a Python
  // SyntaxError reported as a successful compilation.
  Covariance: ([x, y], compile) => {
    if (x == null || y == null)
      throw new Error('Covariance: expected two collection arguments');
    return `np.cov(${compile(x)}, ${compile(y)})[0][1]`;
  },
  PopulationCovariance: ([x, y], compile) => {
    if (x == null || y == null)
      throw new Error(
        'PopulationCovariance: expected two collection arguments'
      );
    return `np.cov(${compile(x)}, ${compile(y)}, ddof=0)[0][1]`;
  },
  Correlation: ([x, y], compile) => {
    if (x == null || y == null)
      throw new Error('Correlation: expected two collection arguments');
    return `np.corrcoef(${compile(x)}, ${compile(y)})[0][1]`;
  },

  // Linear algebra
  Dot: 'np.dot',
  Cross: 'np.cross',
  // A STRING norm type (`Norm(v, "Infinity")`, `Norm(m, "Frobenius")`) is
  // spelled differently by numpy — `np.linalg.norm(v, "Infinity")` is a
  // ValueError. Map the two spellings the interpreter recognizes; anything else
  // fails closed (D6). (The `Infinity` SYMBOL already folds to `np.inf`.)
  Norm: (args, compile) => {
    if (args[0] == null) throw new Error('Norm: missing argument');
    // A LIST of points is one norm PER POINT in the interpreter (a point binds
    // atomically — Tycho item 138), which `np.linalg.norm` does not spell
    // without an explicit `axis`. Fail closed rather than emit the flattened
    // scalar behind `success: true`.
    if (isPointListValue(args[0]))
      throw new Error(
        'Norm: a list of points has no numpy spelling — `np.linalg.norm` ' +
          'flattens it into one scalar, but the interpreter answers one norm ' +
          'per point. Fail closed (D6).'
      );
    if (args.length < 2) return `np.linalg.norm(${compile(args[0])})`;
    const p = args[1];
    const rank = pyStaticRank(args[0]);
    if (isString(p)) {
      const ord: string | undefined = {
        Infinity: 'np.inf',
        Frobenius: "'fro'",
      }[p.string];
      if (ord === undefined)
        throw new Error(
          `Norm: the norm type "${p.string}" has no numpy spelling. ` +
            `Fail closed (D6).`
        );
      // `'fro'` is a MATRIX-only order: `np.linalg.norm(v, 'fro')` raises a
      // ValueError on a 1-D input, so it may only be emitted for a statically
      // rank-2 operand. A rank-1 or statically-unknown operand fails closed
      // rather than compile "successfully" to code that raises at run time.
      if (p.string === 'Frobenius' && rank !== 2)
        throw new Error(
          `Norm: the "Frobenius" norm type is matrix-only — ` +
            `\`np.linalg.norm(v, 'fro')\` raises a ValueError unless the ` +
            `operand is statically rank 2. Fail closed (D6).`
        );
      return `np.linalg.norm(${compile(args[0])}, ${ord})`;
    }
    // Order 2 names a DIFFERENT norm on a matrix in each system: the
    // interpreter's rank-2 branch treats `2` as the FROBENIUS norm
    // (`library/linear-algebra.ts`), while `np.linalg.norm(m, 2)` is the
    // SPECTRAL norm (largest singular value) — on `[[3,4],[5,12]]` that is
    // 13.9283… vs 13.8806…, a silent wrong value. The two agree on a vector,
    // so only a statically rank-2 operand is respelled `'fro'`. When the rank
    // is not statically 1 or 2 there is no single numpy order that matches the
    // interpreter for both ranks, so this fails closed (D6).
    if (p.isSame(2)) {
      if (rank === 2) return `np.linalg.norm(${compile(args[0])}, 'fro')`;
      if (rank !== 1)
        throw new Error(
          `Norm: the order-2 norm of an operand whose rank is not statically ` +
            `known has no numpy spelling — the interpreter's \`Norm(m, 2)\` is ` +
            `the Frobenius norm ("fro"), but \`np.linalg.norm(m, 2)\` is the ` +
            `spectral norm. Fail closed (D6).`
        );
    } else if (!isNumber(p) && !p.isInfinity) {
      // The order is only known at RUN time, so the respelling above cannot be
      // decided statically. On a matrix, substitute at run time so order 2
      // still selects the Frobenius norm; when the rank is not statically known
      // there is no faithful emission (a numeric order is fine on a vector, but
      // that cannot be established here), so fail closed (D6).
      if (rank === 2) {
        const m = compile(args[0]);
        const ord = compile(p);
        // NOTE: the run-time order is spliced TWICE (as the test and as the
        // fallback value), so it is evaluated twice; that is only safe while
        // this target has no impure lowering (`Random` and friends decline
        // today) — bind it to a temporary if that changes. Same caveat as the
        // `Equal`/`NotEqual` chains.
        return `np.linalg.norm(${m}, ('fro' if (${ord}) == 2 else (${ord})))`;
      }
      if (rank !== 1)
        throw new Error(
          `Norm: a run-time norm order over an operand whose rank is not ` +
            `statically known has no numpy spelling — order 2 is the ` +
            `Frobenius norm ("fro") in the interpreter but the spectral norm ` +
            `in \`np.linalg.norm\`. Fail closed (D6).`
        );
    }
    // A literal numeric order on a statically rank-2 operand: the
    // interpreter's matrix branch (`library/linear-algebra.ts`) defines only
    // orders 1 (max column sum), 2/Frobenius (respelled above) and
    // +Infinity (max row sum) — 1 and +Infinity verified against numpy's
    // matrix semantics (probed 2026-07-31: both agree). Any OTHER literal
    // order stays SYMBOLIC in the interpreter, while numpy either raises
    // (`ord=3` on a matrix is a ValueError) or computes a norm the
    // interpreter does not define (`-inf`), so fail closed (D6).
    if (
      rank === 2 &&
      isNumber(p) &&
      !p.isSame(1) &&
      !(p.isInfinity && p.isPositive === true)
    )
      throw new Error(
        `Norm: the interpreter defines matrix norms only for orders 1, ` +
          `2/Frobenius and +Infinity — \`np.linalg.norm\` would raise or ` +
          `diverge for this order. Fail closed (D6).`
      );
    return `np.linalg.norm(${compile(args[0])}, ${compile(p)})`;
  },
  Determinant: 'np.linalg.det',
  Inverse: 'np.linalg.inv',
  Transpose: (args, compile) => compilePythonTranspose(args, compile),
  MatrixMultiply: 'np.matmul',
  // Conjugate transpose: conjugate then transpose (a vector conjugates in
  // place, matching the interpreter and `np.transpose`).
  ConjugateTranspose: (args, compile) =>
    compilePythonTranspose(args, compile, 'np.conjugate'),
  // `np.diag` is rank-dispatched exactly like the interpreter's `Diagonal`: a
  // matrix → its main-diagonal vector; a vector → the diagonal matrix.
  Diagonal: 'np.diag',
  // Integer matrix power (`M^0` identity, negative → inverse), like the
  // interpreter's `MatrixPower`.
  MatrixPower: 'np.linalg.matrix_power',
  // CE `Rank` is the TENSOR rank (number of axes), NOT the linear-algebra rank
  // — `np.ndim` matches (scalar 0, vector 1, matrix 2, …).
  Rank: 'np.ndim',
  // Reduced row echelon form — NumPy has no built-in, so route through the
  // injected `_ce_rref` runtime helper (Gauss–Jordan with partial pivoting).
  RowReduce: (args, compile) => `_ce_rref(${compile(args[0])})`,

  // Comparison — tolerance-aware equality (see compilePythonEquality). The
  // `abs(a - b) <= tol` form is SCALAR-ONLY: it raises `TypeError` on a plain
  // Python list, and while it would be element-wise on ndarrays, the
  // interpreter's collection equality is a whole-collection *scalar* boolean,
  // not an element-wise one — so a collection operand routes to the
  // `_ce_eqcoll` helper instead. Less/Greater stay as the infix relational
  // operators from PYTHON_OPERATORS; their function forms below serve the
  // collection path.
  Equal: (args, compile) => compilePythonEquality('Equal', args, compile),
  NotEqual: (args, compile) => compilePythonEquality('NotEqual', args, compile),
  // Chained (3+ operand) forms fold pairwise — a bare `np.less(a, b, c)` would
  // consume the third operand as numpy's `out`. See `compilePythonRelation`.
  Less: (args, compile) =>
    compilePythonRelation('np.less', args, compile, 'Less'),
  LessEqual: (args, compile) =>
    compilePythonRelation('np.less_equal', args, compile, 'LessEqual'),
  Greater: (args, compile) =>
    compilePythonRelation('np.greater', args, compile, 'Greater'),
  GreaterEqual: (args, compile) =>
    compilePythonRelation('np.greater_equal', args, compile, 'GreaterEqual'),
  And: (args, compile) => compilePythonLogical('np.logical_and', args, compile),
  Or: (args, compile) => compilePythonLogical('np.logical_or', args, compile),
  Not: 'np.logical_not',

  // Control flow — the base compiler's default emits JS ternaries and a bare
  // `NaN`, both of which are Python SyntaxErrors. Emit Python conditional
  // expressions (`a if cond else b`) and `float('nan')`.
  If: (args, compile) => {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    // Both arms are conditionally evaluated: their operand indices go to the
    // compile callback, which opens the matching CSE region (`OperandCompiler`).
    return `((${compile(args[1], 1)}) if (${compile(args[0])}) else (${compile(
      args[2],
      2
    )}))`;
  },
  // DIVERGENCE (documented, CO-P2-24): a *non-boolean* condition (e.g. one that
  // evaluates to NaN) makes the interpreter throw ("Condition must evaluate to
  // True or False"), whereas this Python conditional expression treats it by
  // truthiness and takes the else branch. Aligning would require an inline
  // Python raise (no clean expression-position form) — left documented. The JS
  // target aligns via `_SYS.cond`; conditions built from relational/logical
  // operators (the common case) are already boolean, so no divergence arises.
  When: (args, compile) => {
    if (args.length !== 2)
      throw new Error('When: expected exactly 2 arguments (expr, cond)');
    // A provably collection-valued condition must fail closed: a non-empty
    // Python list is TRUTHY, so the conditional expression below would
    // silently take the value branch for every element instead of selecting.
    BaseCompiler.assertScalarCondition(args[1]);
    // The VALUE is the conditional position (operand 0); the condition is
    // eager — see the `When` entry of the lazy-operand inventory.
    if (isSymbol(args[1], 'True')) return `(${compile(args[0], 0)})`;
    if (isSymbol(args[1], 'False')) return "float('nan')";
    return `((${compile(args[0], 0)}) if (${compile(
      args[1]
    )}) else float('nan'))`;
  },
  // See the divergence note on `When` above (non-boolean condition → else
  // branch here vs interpreter throw).
  Which: (args, compile) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error('Which: expected condition/value pairs');
    // Same guard as `When`: this handler bypasses the base compiler's
    // per-condition `guardCondition` assert, and Python truthiness would turn
    // a collection condition into a silent whole-expression pick.
    for (let i = 0; i < args.length; i += 2)
      BaseCompiler.assertScalarCondition(args[i]);
    // Every value arm, and every condition after the first, is conditionally
    // evaluated — pass its operand index so the CSE pass opens its region.
    const build = (i: number): string => {
      if (i >= args.length) return "float('nan')";
      const cond = args[i];
      const val = args[i + 1];
      // `True` marks the default (else) branch.
      if (isSymbol(cond, 'True')) return `(${compile(val, i + 1)})`;
      return `((${compile(val, i + 1)}) if (${
        i === 0 ? compile(cond) : compile(cond, i)
      }) else ${build(i + 2)})`;
    };
    return build(0);
  },

  // Epsil `Match`: structural pattern matching. Not supported by the Python
  // target in v1 (a chained conditional lowering is a possible future bonus, not
  // required — design §5). Fail closed (D6).
  Match: () => {
    throw new Error(
      'Match: pattern matching is not supported by the Python compile target in v1. Fail closed (D6).'
    );
  },

  // Loop — a Python statement loop (`while True:` / `for … in range(…):`), not
  // the base compiler's JS `for`-IIFE (a Python SyntaxError). See
  // compilePythonLoop for the supported shapes.
  Loop: (args, _compile, target) =>
    compilePythonLoop(args, target, BaseCompiler.cseParentNode()),

  // Special functions
  Erf: 'scipy.special.erf',
  Erfc: 'scipy.special.erfc',
  // `Gamma(z)` is the complete Γ; the TWO-operand `Gamma(s, z)` is the UPPER
  // INCOMPLETE gamma `∫_z^∞ tˢ⁻¹e⁻ᵗ dt` — a different function, not a variant
  // (Γ(5, 2) = 22.736…, Γ(5) = 24). The bare `'scipy.special.gamma'` mapping
  // passed the second operand to a one-argument routine, a runtime TypeError
  // reported as a successful compilation. scipy has no direct upper incomplete
  // gamma, but `gammaincc` is the REGULARIZED one, Q(s, z) = Γ(s, z)/Γ(s), so
  // `gammaincc(s, z)·gamma(s)` recovers it (verified against the interpreter:
  // Γ(5, 2) → 22.736327583750935).
  Gamma: (args, compile) => {
    const s = args[0];
    if (s == null) throw new Error('Gamma: no argument');
    if (args.length < 2) return `scipy.special.gamma(${compile(s)})`;
    // scipy's incomplete-gamma family is defined for `s >= 0` only, and the
    // Γ(s) factor is a pole at the non-positive integers — the product is
    // `nan` there, where the interpreter still has a finite value
    // (Γ(-1, 2) = 0.01876…). A statically non-positive `s` therefore fails
    // closed (D6) rather than compiling to a guaranteed `nan`.
    const sConst = tryGetConstant(s);
    if (sConst !== undefined && sConst <= 0)
      throw new Error(
        `Gamma: the upper incomplete gamma Γ(s, z) lowers through the ` +
          `REGULARIZED \`scipy.special.gammaincc\`, which is defined for ` +
          `s > 0 only (s = ${sConst}). Fail closed (D6).`
      );
    const cs = compile(s);
    return `(scipy.special.gammaincc(${cs}, ${compile(
      args[1]
    )}) * scipy.special.gamma(${cs}))`;
  },
  GammaLn: 'scipy.special.loggamma',
  // `x! = Γ(x+1)`, matching the interpreter and the JavaScript target.
  // `scipy.special.factorial` is integer-only — it returns 0 for a negative or
  // non-integer argument — so `(-1/2)!` came out 0 instead of Γ(1/2) = √π
  // (Tycho item 99). `scipy.special.gamma` agrees with `factorial` on the
  // non-negative integers (both go through Γ for `exact=False`).
  Factorial: ([x], compile) => {
    if (x === null) throw new Error('Factorial: no argument');
    return `scipy.special.gamma((${compile(x)}) + 1)`;
  },
  // Regularized upper incomplete gamma Q(a, z); scipy's argument order matches
  // ours directly.
  GammaRegularized: 'scipy.special.gammaincc',
  // Regularized incomplete beta I_x(a, b); scipy.special.betainc(a, b, x)
  // takes a DIFFERENT argument order than ours (x, a, b) — reorder here.
  BetaRegularized: ([x, a, b], compile) => {
    if (x === null || a === null || b === null)
      throw new Error('BetaRegularized: missing argument');
    return `scipy.special.betainc(${compile(a)}, ${compile(b)}, ${compile(x)})`;
  },

  // Common patterns
  List: (args, compile) => {
    // Python list notation
    return `[${args.map((x) => compile(x)).join(', ')}]`;
  },
  // Matrix wraps List(List(...), ...) — compile as np.array for proper matrix ops
  Matrix: (args, compile) => `np.array(${compile(args[0])})`,
  // Tuple compiles to a Python tuple. The ARITY-1 form needs the trailing
  // comma: `(True)` is a parenthesized SCALAR, not a 1-tuple, so `len(...)`
  // raises and `_ce_eqcoll` would see a scalar where the interpreter has a
  // point. `()` is already the empty tuple.
  Tuple: (args, compile) => {
    const parts = args.map((x) => compile(x));
    if (parts.length === 1) return `(${parts[0]},)`;
    return `(${parts.join(', ')})`;
  },
  Sequence: (args, compile) => {
    // NumPy array
    return `np.array([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Range: (args, compile) => {
    // CE `Range` is INCLUSIVE of both endpoints, `Range(n)` is 1..n, and a
    // range with no explicit step auto-descends when stop < start
    // (`Range(5, 1)` → [5,4,3,2,1]). (Previously emitted a bare `np.arange`,
    // which excludes the stop, is 0-based in the one-argument form, and
    // never descends — silently diverging from the interpreter.) The count
    // is `⌊(stop − start)/step⌋ + 1`, computed explicitly so a fractional
    // step never overshoots the endpoint; a zero step yields [].
    if (args.length === 0) return '[]';
    // A non-finite bound never materializes: `int(np.floor(inf))` raises an
    // OverflowError at run time. Fail closed at compile time instead (the JS
    // target's `Range` guard; the Python target has no lazy-stream lowering,
    // so even a `Take`-bounded infinite range fails closed here — a
    // documented divergence from the JS target).
    if (args.some((a) => a != null && isNonFiniteBound(a)))
      throw new Error(
        `Range: a non-finite bound does not materialize. Fail closed (D6).`
      );
    const start = args.length === 1 ? '1' : compile(args[0]);
    const stop = args.length === 1 ? compile(args[0]) : compile(args[1]);
    if (args.length <= 2)
      return `(lambda _a, _b: [float(_a + (1 if _b >= _a else -1) * _i) for _i in range(int(np.floor(abs(_b - _a))) + 1)])(${start}, ${stop})`;
    return `(lambda _a, _b, _s: [] if _s == 0 else [float(_a + _s * _i) for _i in range(max(0, int(np.floor((_b - _a) / _s)) + 1))])(${start}, ${stop}, ${compile(args[2])})`;
  },

  // --- Function literals ---------------------------------------------------
  // A `Function` literal compiles to a Python lambda. Without this handler
  // the base compiler emits a JavaScript arrow function — invalid Python.
  // A lambda body must be a single expression, so a statement-shaped body
  // (`Block`) fails closed.
  Function: (args, compile, target) => {
    if (args[0] == null) throw new Error('Function: missing body');
    // Function-literal bodies canonicalize wrapped in a `Block`; a
    // single-expression Block unwraps into the lambda body. A genuine
    // multi-statement body fails closed — a Python lambda is
    // expression-only.
    let body = args[0];
    while (isFunction(body, 'Block') && body.nops === 1) body = body.ops[0];
    if (isFunction(body, 'Block'))
      throw new Error(
        `Function: a multi-statement (Block) body cannot compile to a ` +
          `Python lambda. Fail closed (D6).`
      );
    BaseCompiler.assertNoDestructuringParams(args.slice(1));
    const params = args
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    const bodyCode = BaseCompiler.compile(body.canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
      boundVars: BaseCompiler.withBoundNames(target, params),
    });
    return `(lambda ${params.join(', ')}: ${bodyCode})`;
  },

  // --- List-shaped collection operators -------------------------------------
  // Same fail-closed (D6) discipline and interpreter-verified semantics as
  // the JavaScript target: 1-based indexes, `Nothing` → nan, counts clamped.
  Length: (args, compile) => `len(${pyCollArg('Length', args[0], compile)})`,
  Count: (args, compile) => `len(${pyCollArg('Count', args[0], compile)})`,
  IsEmpty: (args, compile) =>
    `(len(${pyCollArg('IsEmpty', args[0], compile)}) == 0)`,
  At: (args, compile) => {
    const base = args[0];
    const index = args[1];
    if (base == null || index == null || args.length !== 2)
      throw new Error(
        `At: only the single-index form compiles. Fail closed (D6).`
      );
    // Admission mirrors the JavaScript target: provably an indexed collection,
    // or a union that merely ADMITS one (the `dictionary | indexed_collection`
    // an indexed lambda parameter carries) — the latter only with a provably
    // numeric index, since the other arm is a dictionary and a keyed lookup has
    // no compiled equivalent.
    const provablyIndexed =
      !base.type.matches('string') &&
      (base.type.matches('list') || base.type.matches('indexed_collection'));
    if (!provablyIndexed) {
      if (!pyCouldBeIndexedCollectionOperand(base))
        throw new Error(
          `At: operand is not an indexed collection (list/vector/range). ` +
            `Fail closed (D6).`
        );
      if (!pyIsNumericIndexOperand(index))
        throw new Error(
          `At: the first operand is not provably an indexed collection (type ` +
            `\`${base.type.toString()}\`) and the index is not provably ` +
            `numeric, so a keyed (dictionary) access cannot be ruled out. ` +
            `Fail closed (D6).`
        );
    }
    // 1-based; negative counts from the end; 0/out-of-range → nan. A base that
    // is not a sequence at run time (the dictionary arm of an admitted union)
    // projects to nan, mirroring the JavaScript `_SYS.at` runtime dispatch.
    return `(lambda _l, _i: float('nan') if not isinstance(_l, (list, tuple, np.ndarray)) else (_l[int(_i) - 1] if 1 <= _i <= len(_l) else (_l[int(_i)] if -len(_l) <= _i <= -1 else float('nan'))))(${compile(base)}, ${compile(index)})`;
  },
  First: (args, compile) =>
    `(lambda _l: _l[0] if len(_l) > 0 else float('nan'))(${pyCollArg('First', args[0], compile)})`,
  Second: (args, compile) =>
    `(lambda _l: _l[1] if len(_l) > 1 else float('nan'))(${pyCollArg('Second', args[0], compile)})`,
  Third: (args, compile) =>
    `(lambda _l: _l[2] if len(_l) > 2 else float('nan'))(${pyCollArg('Third', args[0], compile)})`,
  Last: (args, compile) =>
    `(lambda _l: _l[-1] if len(_l) > 0 else float('nan'))(${pyCollArg('Last', args[0], compile)})`,
  Rest: (args, compile) => `${pyCollArg('Rest', args[0], compile)}[1:]`,
  Most: (args, compile) => `${pyCollArg('Most', args[0], compile)}[:-1]`,
  Take: (args, compile) => {
    const coll = pyCollArg('Take', args[0], compile);
    if (args[1] == null) throw new Error('Take: missing count');
    return `${coll}[:${pyClampedCount(args[1], compile)}]`;
  },
  Drop: (args, compile) => {
    const coll = pyCollArg('Drop', args[0], compile);
    if (args[1] == null) throw new Error('Drop: missing count');
    return `${coll}[${pyClampedCount(args[1], compile)}:]`;
  },
  Reverse: (args, compile) => `${pyCollArg('Reverse', args[0], compile)}[::-1]`,
  Sort: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Sort: a custom comparator does not compile; only the default ` +
          `ascending numeric sort is supported. Fail closed (D6).`
      );
    return `sorted(${pyCollArg('Sort', args[0], compile)})`;
  },
  // 1-based indexes that sort ascending; `sorted` is stable, like the
  // interpreter.
  Ordering: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Ordering: a custom ordering function does not compile. ` +
          `Fail closed (D6).`
      );
    return `(lambda _l: [_i + 1 for _i in sorted(range(len(_l)), key=lambda _j: _l[_j])])(${pyCollArg('Ordering', args[0], compile)})`;
  },
  Join: (args, compile) => {
    if (args.length === 0) return '[]';
    return `[${args
      .map((a, i) => `*${pyCollArg('Join', a, compile, i + 1)}`)
      .join(', ')}]`;
  },
  // Variadic, like the interpreter and the JavaScript target
  // (`docs/plans/2026-08-09-lazy-collection-evaluate-design.md`, Change 2).
  Append: (args, compile) => {
    const coll = pyCollArg('Append', args[0], compile);
    // No trailing values: the 1-ary identity form (valid in non-strict mode).
    const values = args.slice(1).map((a) => compile(a));
    return `[*${coll}${values.map((v) => `, ${v}`).join('')}]`;
  },
  // DELIBERATE DIVERGENCE from the JavaScript target, which fails closed on a
  // string (or tuple) needle because its element test is the numeric tolerance
  // test. This lowering is not numeric: the `_ce_indexof` adapter is Python's
  // own structural equality, so a string needle, a string haystack and a TUPLE
  // needle in a point list are all faithful — probe-verified against the
  // interpreter (`IndexOf([(1,2),(3,4)], Tuple(3,4))` → 2, a missing value → 0).
  // Nothing to GATE here (ruled 2026-08-08: adapter over gate) — but the
  // faithfulness now holds BECAUSE of the adapter: bare `in`/`.index` had one
  // crack, Python's `True == 1`, which found a boolean needle in a numeric
  // haystack where the interpreter answers 0. `_ce_same` compares bool-ness
  // first, and its number leaf is EXACT (no tolerance — see
  // PYTHON_INDEXOF_HELPER). Pinned in
  // `compile-python-string-fail-closed.test.ts`.
  IndexOf: (args, compile) => {
    const coll = pyCollArg('IndexOf', args[0], compile);
    if (args[1] == null) throw new Error('IndexOf: missing value');
    return `_ce_indexof(${coll}, ${compile(args[1])})`;
  },
  Contains: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Contains', args[0]);
    const coll = pyCollArg('Contains', args[0], compile);
    if (args[1] == null) throw new Error('Contains: missing value');
    return `(${compile(args[1])} in ${coll})`;
  },
  // First-occurrence order (`dict.fromkeys` preserves insertion order).
  Unique: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Unique', args[0]);
    return `list(dict.fromkeys(${pyCollArg('Unique', args[0], compile)}))`;
  },
  Zip: (args, compile) => {
    if (args.length === 0) return '[]';
    const colls = args.map((a, i) => pyCollArg('Zip', a, compile, i + 1));
    return `[list(_t) for _t in zip(${colls.join(', ')})]`;
  },
  // Both endpoints included (native np.linspace); count truncated and
  // clamped ≥ 0; defaults mirror the interpreter (start 1, count 50).
  Linspace: (args, compile) => {
    if (args[0] == null) throw new Error('Linspace: missing argument');
    const start = args[1] == null ? '1' : compile(args[0]);
    const end = args[1] == null ? compile(args[0]) : compile(args[1]);
    const count = args[2] == null ? '50' : compile(args[2]);
    return `[float(_v) for _v in np.linspace(${start}, ${end}, max(0, int(${count})))]`;
  },
  // --- Higher-order collection operators ------------------------------------
  Map: (args, compile) => {
    if (args.length > 2)
      throw new Error('Map: multi-collection form is not compiled');
    if (args[1] == null) throw new Error('Map: missing source collection');
    const coll = pyCollArg('Map', args[1], compile);
    const fn = pyFnArg('Map', args[0], compile, [
      BaseCompiler.collectionElementTypeOf(args[1]),
    ]);
    return `(lambda _f: [_f(_x) for _x in ${coll}])(${fn})`;
  },
  Filter: (args, compile) => {
    const coll = pyCollArg('Filter', args[0], compile);
    if (args[1] == null) throw new Error('Filter: missing predicate');
    const fn = pyFnArg('Filter', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: [_x for _x in ${coll} if _f(_x)])(${fn})`;
  },
  CountIf: (args, compile) => {
    const coll = pyCollArg('CountIf', args[0], compile);
    if (args[1] == null) throw new Error('CountIf: missing predicate');
    const fn = pyFnArg('CountIf', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: sum(1 for _x in ${coll} if _f(_x)))(${fn})`;
  },
  Find: (args, compile) => {
    const coll = pyCollArg('Find', args[0], compile);
    if (args[1] == null) throw new Error('Find: missing predicate');
    const fn = pyFnArg('Find', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: next((_x for _x in ${coll} if _f(_x)), float('nan')))(${fn})`;
  },
  IndexWhere: (args, compile) => {
    const coll = pyCollArg('IndexWhere', args[0], compile);
    if (args[1] == null) throw new Error('IndexWhere: missing predicate');
    const fn = pyFnArg('IndexWhere', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: next((_i + 1 for _i, _x in enumerate(${coll}) if _f(_x)), 0))(${fn})`;
  },
  Position: (args, compile) => {
    const coll = pyCollArg('Position', args[0], compile);
    if (args[1] == null) throw new Error('Position: missing predicate');
    const fn = pyFnArg('Position', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: [_i + 1 for _i, _x in enumerate(${coll}) if _f(_x)])(${fn})`;
  },
  Any: (args, compile) => {
    const coll = pyCollArg('Any', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Any: only the predicate form compiles. Fail closed (D6).`
      );
    const fn = pyFnArg('Any', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: any(_f(_x) for _x in ${coll}))(${fn})`;
  },
  All: (args, compile) => {
    const coll = pyCollArg('All', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `All: only the predicate form compiles. Fail closed (D6).`
      );
    const fn = pyFnArg('All', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: all(_f(_x) for _x in ${coll}))(${fn})`;
  },
  TakeWhile: (args, compile) => {
    const coll = pyCollArg('TakeWhile', args[0], compile);
    if (args[1] == null) throw new Error('TakeWhile: missing predicate');
    const fn = pyFnArg('TakeWhile', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f, _l: _l[:next((_i for _i, _x in enumerate(_l) if not _f(_x)), len(_l))])(${fn}, ${coll})`;
  },
  DropWhile: (args, compile) => {
    const coll = pyCollArg('DropWhile', args[0], compile);
    if (args[1] == null) throw new Error('DropWhile: missing predicate');
    const fn = pyFnArg('DropWhile', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f, _l: _l[next((_i for _i, _x in enumerate(_l) if not _f(_x)), len(_l)):])(${fn}, ${coll})`;
  },
  // A collection-valued mapping is spliced; a scalar result is kept as-is.
  FlatMap: (args, compile) => {
    const coll = pyCollArg('FlatMap', args[0], compile);
    if (args[1] == null) throw new Error('FlatMap: missing mapping function');
    const fn = pyFnArg('FlatMap', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f, _l: [_y for _x in _l for _y in (lambda _r: _r if isinstance(_r, list) else [_r])(_f(_x))])(${fn}, ${coll})`;
  },
  // Fold. Built-in combiners use the native reductions; an empty collection
  // with no initial value yields nan (the interpreter's `Nothing`). A custom
  // combiner must be a binary `Function` literal and requires an explicit
  // initial value (same rule as the JavaScript target).
  Reduce: (args, compile) => {
    const coll = pyCollArg('Reduce', args[0], compile);
    const op = args[1];
    const init = args[2];
    if (op == null) throw new Error('Reduce: missing combiner');
    const builtin = isSymbol(op)
      ? {
          Add: 'sum(_l)',
          Multiply: '__import__("math").prod(_l)',
          Min: 'min(_l)',
          Max: 'max(_l)',
        }[op.symbol]
      : undefined;
    if (builtin !== undefined) {
      if (init !== undefined && init !== null) {
        const seeded = {
          'sum(_l)': `sum(_l, ${compile(init)})`,
          '__import__("math").prod(_l)': `__import__("math").prod(_l, start=${compile(init)})`,
          'min(_l)': `min([${compile(init)}, *_l])`,
          'max(_l)': `max([${compile(init)}, *_l])`,
        }[builtin]!;
        return `(lambda _l: ${seeded})(${coll})`;
      }
      return `(lambda _l: float('nan') if len(_l) == 0 else ${builtin})(${coll})`;
    }
    if ((isFunction(op, 'Function') && op.nops - 1 === 2) || isSymbol(op)) {
      if (init === undefined || init === null)
        throw new Error(
          `Reduce: a custom combiner compiles only with an explicit ` +
            `initial value. Fail closed (D6).`
        );
      // The combiner is `(accumulator, element)`: only the element's type is
      // provable, so an annotated accumulator declines.
      const fn = pyFnArg('Reduce', op, compile, [
        undefined,
        BaseCompiler.collectionElementTypeOf(args[0]),
      ]);
      return `__import__('functools').reduce(${fn}, ${coll}, ${compile(init)})`;
    }
    throw new Error(
      `Reduce: the combiner does not compile to a function on the Python ` +
        `target. Fail closed (D6).`
    );
  },
  // Running fold: `itertools.accumulate`. With an initial value the
  // accumulated seed is not emitted (slice it off, matching the
  // interpreter); without one the first element seeds and is emitted as-is.
  Scan: (args, compile) => {
    const coll = pyCollArg('Scan', args[0], compile);
    const op = args[1];
    const init = args[2];
    if (op == null) throw new Error('Scan: missing combiner');
    const builtin = isSymbol(op)
      ? {
          Add: '(lambda _a, _b: _a + _b)',
          Multiply: '(lambda _a, _b: _a * _b)',
          Min: '(lambda _a, _b: min(_a, _b))',
          Max: '(lambda _a, _b: max(_a, _b))',
        }[op.symbol]
      : undefined;
    const fn =
      builtin ??
      ((isFunction(op, 'Function') && op.nops - 1 === 2) || isSymbol(op)
        ? pyFnArg('Scan', op, compile, [
            undefined,
            BaseCompiler.collectionElementTypeOf(args[0]),
          ])
        : undefined);
    if (fn === undefined)
      throw new Error(
        `Scan: the combiner does not compile to a function on the Python ` +
          `target. Fail closed (D6).`
      );
    if (init !== undefined && init !== null)
      return `list(__import__('itertools').accumulate(${coll}, ${fn}, initial=${compile(init)}))[1:]`;
    return `list(__import__('itertools').accumulate(${coll}, ${fn}))`;
  },
  // Apply the function to 1-based indexes; a statically non-positive
  // dimension is inert in the interpreter and fails closed.
  Tabulate: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Tabulate: missing argument');
    if (args.length > 3)
      throw new Error(
        `Tabulate: only the 1-D and 2-D forms compile. Fail closed (D6).`
      );
    for (let i = 1; i < args.length; i++) {
      const dim = tryGetConstant(args[i]!);
      if (dim !== undefined && Math.round(dim) <= 0)
        throw new Error(
          `Tabulate: a statically non-positive dimension (${dim}) is inert ` +
            `in the interpreter. Fail closed (D6).`
        );
    }
    const f = pyFnArg('Tabulate', args[0], compile, ['integer', 'integer']);
    const n = pyClampedCount(args[1]!, compile);
    if (args.length === 2)
      return `(lambda _f: [_f(_i + 1) for _i in range(${n})])(${f})`;
    const m = pyClampedCount(args[2]!, compile);
    return `(lambda _f: [[_f(_i + 1, _j + 1) for _j in range(${m})] for _i in range(${n})])(${f})`;
  },
  Fill: (args, compile) => {
    const dims = args[1];
    if (args[0] == null || dims == null)
      throw new Error('Fill: missing argument');
    if (!isFunction(dims) || dims.ops.length !== 2)
      throw new Error(
        `Fill: only the (function, (rows, cols)) form compiles. ` +
          `Fail closed (D6).`
      );
    const f = pyFnArg('Fill', args[0], compile, ['integer', 'integer']);
    const rows = pyClampedCount(dims.ops[0], compile);
    const cols = pyClampedCount(dims.ops[1], compile);
    return `(lambda _f: [[_f(_i + 1, _j + 1) for _j in range(${cols})] for _i in range(${rows})])(${f})`;
  },
  // --- Core scalar operators -------------------------------------------------
  Boole: (args, compile) => {
    if (args[0] == null) throw new Error('Boole: missing argument');
    if (!BaseCompiler.isBooleanValued(args[0]))
      throw new Error(
        `Boole: the argument is not provably boolean. Fail closed (D6).`
      );
    return `(1 if ${compile(args[0])} else 0)`;
  },
  KroneckerDelta: (args, compile) => {
    if (args.length === 0 || args[0] == null)
      throw new Error('KroneckerDelta: missing argument');
    const tol = args[0].engine.tolerance ?? 1e-10;
    if (args.length === 1)
      return `(1 if abs(${compile(args[0])}) <= ${tol} else 0)`;
    return `(lambda *_v: 1 if all(abs(_x - _v[0]) <= ${tol} for _x in _v) else 0)(${args.map((a) => compile(a)).join(', ')})`;
  },
  Element: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Element: missing argument');
    requirePrimitiveElements('Element', args[1]);
    return `(${compile(args[0])} in ${pyCollArg('Element', args[1], compile)})`;
  },
  Identity: (args, compile) => {
    if (args[0] == null) throw new Error('Identity: missing argument');
    return compile(args[0]);
  },
  Apply: (args, compile) => {
    if (args[0] == null) throw new Error('Apply: missing function');
    return `(${compile(args[0])})(${args
      .slice(1)
      .map((a) => compile(a))
      .join(', ')})`;
  },
  // --- Linear algebra (numpy; regular arrays only) ---------------------------
  Flatten: (args, compile) => {
    if (args[1] != null)
      throw new Error(
        `Flatten: an explicit depth does not compile on the Python target. ` +
          `Fail closed (D6).`
      );
    // Recursive self-passing lambda: flattens ragged (non-rectangular)
    // nested lists, which np.asarray(...).ravel() rejects.
    return `(lambda _l: (lambda _f: _f(_f, _l))(lambda _f, _x: [_y for _e in _x for _y in (_f(_f, _e) if isinstance(_e, list) else [_e])]))(${pyCollArg('Flatten', args[0], compile)})`;
  },
  Shape: (args, compile) => {
    if (args[0] == null) throw new Error('Shape: missing argument');
    return `list(np.shape(${compile(args[0])}))`;
  },
  // Cyclic padding (np.resize repeats the source), like the interpreter.
  Reshape: (args, compile) => {
    const coll = pyCollArg('Reshape', args[0], compile);
    const dims = args[1];
    if (dims == null) throw new Error('Reshape: missing shape');
    if (!isFunction(dims) || dims.ops.length === 0 || dims.ops.length > 2)
      throw new Error(
        `Reshape: only a 1-D or 2-D target shape compiles. Fail closed (D6).`
      );
    return `np.resize(np.asarray(${coll}), (${dims.ops.map((d) => compile(d)).join(', ')},)).tolist()`;
  },
  Trace: (args, compile) => {
    if (args.length > 1)
      throw new Error(`Trace: explicit axes do not compile. Fail closed (D6).`);
    return `float(np.trace(np.asarray(${pyCollArg('Trace', args[0], compile)})))`;
  },
};

/**
 * Python/NumPy language target implementation
 *
 * Generates Python code that uses NumPy for mathematical operations.
 * The generated code is compatible with NumPy arrays and supports
 * vectorized operations.
 */
/**
 * The compile modes the Python target offers (`CompileMode`): all three. Its
 * emitters implement the complex lowering (native `complex`, `cmath`), so
 * `'complex'` and `'auto'` are deliverable; the effective default is `'auto'`.
 */
const PYTHON_SUPPORTED_MODES: readonly CompileMode[] = [
  'strict',
  'complex',
  'auto',
];

export class PythonTarget implements LanguageTarget<Expression> {
  /** Whether to include 'import numpy as np' in generated code */
  private includeImports: boolean;

  /** Whether to use scipy.special for advanced functions */
  private useScipy: boolean;

  constructor(options: { includeImports?: boolean; useScipy?: boolean } = {}) {
    this.includeImports = options.includeImports ?? false;
    this.useScipy = options.useScipy ?? false;
  }

  getOperators(): CompiledOperators {
    return PYTHON_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return PYTHON_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'python',
      // The compile modes this target offers (`CompileMode`) and the two
      // lowering hooks the complex discipline is emitted through: Python's
      // own `complex()` is the idempotent lift, and `.imag == 0` the exact
      // realness test. See `CompileTarget.supportedModes`.
      supportedModes: PYTHON_SUPPORTED_MODES,
      complexLift: (code) => `complex(${code})`,
      complexIsReal: (code) => `(complex(${code}).imag == 0)`,
      // Chained relations join with Python's `and`, not `&&`.
      chainOp: 'and',
      // Evaluate a shared middle operand of a chained relation exactly once
      // (matching the interpreter) by binding it in an immediately-applied
      // `lambda` — Python's expression-position value binding.
      bindExpr: (bindings, body) =>
        `(lambda ${bindings.map((b) => b[0]).join(', ')}: ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      // Dependency-ordered CSE temporaries: a FLAT sequential binding
      // comprehension, `[body for _cse1 in [rhs1] for _cse2 in [rhs2]][0]`.
      // Later `for` clauses see earlier names, each right-hand side evaluates
      // exactly once, and the nesting depth is CONSTANT — nested lambdas would
      // grow with the candidate count and could break a previously-compilable
      // expression (design §6.2, §7.5).
      cseBind: (bindings, body) =>
        `[${body} ${bindings
          .map(([name, code]) => `for ${name} in [${code}]`)
          .join(' ')}][0]`,
      // A `broadcastable` unary head over a collection (`Sin([1,2,3])`) fans
      // out as a LIST COMPREHENSION — always valid Python, and it preserves
      // the element-wise semantics exactly, without assuming the caller bound
      // a NumPy array (`np.sin` of a plain list happens to work, but `-L`
      // negates only an ndarray; the comprehension is uniform for both, and
      // for a head with no NumPy vectorization at all).
      broadcastUnary: (_head, _operand, lowering, bcTarget) => {
        const v = BaseCompiler.tempVar(bcTarget);
        return `[${lowering.element(v)} for ${v} in ${lowering.collection()}]`;
      },
      operators: (op) => PYTHON_OPERATORS[op],
      functions: (id) => PYTHON_FUNCTIONS[id],
      // Resolve a mathematical constant; otherwise return `undefined` so
      // BaseCompiler folds an assigned value / declared constant into the code
      // (matching `evaluate()` and the JavaScript target) and falls back to the
      // bare identifier — a Python parameter name — only for a genuinely free
      // symbol.
      var: (id) => PYTHON_CONSTANTS[id],
      complex: (re, im) => `complex(${re}, ${im})`,
      string: (str) => JSON.stringify(str),
      number: (n) => {
        // Python number literals
        if (!isFinite(n)) {
          if (n === Infinity) return 'np.inf';
          if (n === -Infinity) return '-np.inf';
          return 'np.nan';
        }
        return n.toString();
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      // Absence capability (§3.F): numeric absence is `math.nan`; the object
      // axis is `None`. Consumed by `IsMissing`/`Coalesce`/Kleene `Equal` (P3).
      absence: {
        numeric: {
          make: () => 'math.nan',
          isAbsent: (x) => `math.isnan(${x})`,
          coalesce: (x, d) =>
            `(lambda _c: ${d} if math.isnan(_c) else _c)(${x})`,
        },
        object: {
          nullLiteral: 'None',
          isAbsent: (x) => `(${x} is None)`,
          coalesce: (x, d) => `(${d} if ${x} is None else ${x})`,
        },
      },
      // A Python Block is a bare statement sequence (like GLSL/WGSL), never a
      // JS IIFE. Fail closed (D6) if such a block is spliced as a sub-operand.
      bareStatementBlocks: true,
      // Python has no declaration keyword; a `Declare`'s value rides on the
      // separate `name = value` assignment compileBlock emits. Ignore the GPU
      // type-hint argument (`vec2` etc. is meaningless here).
      declare: (_name) => '',
      // Return-prefix the last statement and newline-join. No semicolons.
      block: (stmts) => {
        if (stmts.length === 0) return '';
        const last = stmts.length - 1;
        // A `Loop` (or any for-effect statement) as the block's last element
        // compiles to a `for`/`while` statement — return-prefixing it would
        // produce `return for …:` (a SyntaxError). Emit it as-is and make the
        // block evaluate to `None` (the Loop's `Nothing` value).
        if (/^(for|while)\b/.test(stmts[last])) stmts.push('return None');
        else stmts[last] = `return ${stmts[last]}`;
        return stmts.join('\n');
      },
      // Per-compilation naming state for generated temporaries (see the
      // JavaScript target).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
  }

  /**
   * Build a `var` resolver honoring, in order: shadowed parameters (kept bare),
   * an explicit `vars` mapping (which always wins over folding — a per-call
   * substitution), mathematical constants, then `undefined` so BaseCompiler
   * folds an assigned value / emits the bare identifier for a free symbol.
   */
  private makeVarResolver(
    vars?: Record<string, string>,
    shadowed?: ReadonlyArray<string>
  ): (id: string) => string | undefined {
    return (id: string) => {
      if (shadowed?.includes(id)) return id;
      // A string `vars` value is source spliced in as-is (the live-path
      // contract); a non-string value is a constant to bake.
      if (vars && id in vars) {
        const v = vars[id];
        return typeof v === 'string' ? v : JSON.stringify(v);
      }
      return PYTHON_CONSTANTS[id];
    };
  }

  /**
   * Compile to Python source code (not executable in JavaScript)
   *
   * Returns Python code as a string. To execute it, use Python runtime.
   */
  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'python'> {
    try {
      return this.compileOrThrow(expr, options);
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      if (options.fallback !== true) throw e;
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: python): ${error}`
      );
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        'python',
        this.createTarget(),
        options.vars ? new Set(Object.keys(options.vars)) : undefined,
        compileDiagnosticOf(e, error)
      );
    }
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'python'> {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    const vars = options.vars as Record<string, string> | undefined;
    // Root compilation boundary: fresh, deterministic numbering for the
    // generated temporaries, seeded with the names this compilation must not
    // reuse (see `NamingContext`).
    const target = this.createTarget({
      var: this.makeVarResolver(vars),
      // A `vars`-mapped symbol is a live runtime input: the constant folder
      // must never fold a subtree that mentions one, even when the symbol
      // has an engine value (`CompileTarget.varsKeys`).
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      constantFold: options.constantFold,
      complexPromotion: options.complexPromotion,
      // The caller's requested compile mode; validated against
      // `supportedModes` and latched by `BaseCompiler.compile` at depth 0.
      mode: options.mode,
      naming: BaseCompiler.newNamingContext(expr, [
        options.preamble,
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // Common-subexpression elimination (design §4.2). This target has no
    // `functions`/`operators` override channel, so the only G1b provenance to
    // record is the string-valued `vars` keys.
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });
    let code = withPythonHelpers(BaseCompiler.compileCseRoot(expr, target));
    if (this.includeImports) code = this.withImports(code);

    const result: CompilationResult<'python'> = {
      target: 'python',
      success: true,
      code,
    };
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }

  /** Prepend the numpy / cmath / scipy imports when `includeImports` is set. */
  private withImports(code: string): string {
    let imports = 'import numpy as np\n';
    imports += 'import cmath\n';
    if (this.useScipy) imports += 'import scipy.special\n';
    // `math.prod` (from a compiled Product) needs `import math`. The `\b`
    // anchor avoids a false match on `cmath.` (no word boundary before `math`).
    if (/\bmath\./.test(code)) imports += 'import math\n';
    return `${imports}\n${code}`;
  }

  /**
   * Compile an expression to Python source code
   *
   * Returns the Python code as a string. Honors `options.vars` (per-call
   * substitution) and folds assigned symbols.
   */
  compileToSource(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): string {
    // The single-line statements the emitted-source scan below cannot see: an
    // assignment body emits `s = x` and a root `Declare` emits the empty
    // string. Checked structurally, before the body is compiled (D6).
    pythonAssertExpressionBody('compileToSource()', expr);
    const vars = options.vars as Record<string, string> | undefined;
    // Root compilation boundary (see `compile`). `varsKeys`/`constantFold`:
    // same constant-folder contract as `compileOrThrow` above.
    const target = this.createTarget({
      var: this.makeVarResolver(vars),
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      constantFold: options.constantFold,
      complexPromotion: options.complexPromotion,
      // The caller's requested compile mode; validated against
      // `supportedModes` and latched by `BaseCompiler.compile` at depth 0.
      mode: options.mode,
      naming: BaseCompiler.newNamingContext(expr, [
        options.preamble,
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });
    const body = BaseCompiler.compileCseRoot(expr, target);
    // The contract of this route is an EXPRESSION. A body that lowers to
    // statements has no emission here (D6). Checked on the BODY, before the
    // helper/import preamble — those lines are the route's own, not the
    // body's.
    pythonAssertExpressionOnly('compileToSource()', body);
    const code = withPythonHelpers(body);
    return this.includeImports ? this.withImports(code) : code;
  }

  /**
   * Create a complete Python function from an expression
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names (e.g., ['x', 'y', 'z'])
   * @param docstring - Optional docstring for the function
   * @param options - `cse: false` disables common-subexpression elimination
   */
  compileFunction(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string,
    options?: { cse?: boolean; constantFold?: boolean }
  ): string {
    // Both branches below put the body in a position that requires a VALUE: the
    // single-line one wraps it in `return`, the multi-line one relies on the
    // block hook having done so. A body whose value statement is an assignment
    // or a declaration has neither emission (D6).
    pythonAssertReturnableBody('compileFunction()', expr);
    // Shadow the declared parameters so they stay bare identifiers (never
    // folded to an assigned engine value).
    // Root compilation boundary (see `compile`). The declared parameters are
    // emitted bare, so they join the collision inventory.
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
      constantFold: options?.constantFold,
      naming: BaseCompiler.newNamingContext(expr, undefined, parameters),
    });
    // CSE is default-enabled; `options.cse` is the opt-out.
    BaseCompiler.openCseSession(expr, target, { enabled: options?.cse });
    const body = BaseCompiler.compileCseRoot(expr, target);

    const params = parameters.join(', ');
    let code = '';

    if (this.includeImports) {
      code += 'import numpy as np\n';
      code += 'import cmath\n';
      if (this.useScipy) {
        code += 'import scipy.special\n';
      }
      // `math.prod` (from a compiled Product) needs `import math`.
      if (/\bmath\./.test(body)) code += 'import math\n';
      code += '\n';
    }

    // Emit the runtime helpers (once, at module level) when the body routed
    // through them.
    if (body.includes('_ce_rref(')) code += `${PYTHON_RREF_HELPER}\n`;
    if (body.includes('_ce_bcast(')) code += `${PYTHON_BCAST_HELPER}\n`;
    if (body.includes('_ce_eqcoll(')) code += `${PYTHON_EQCOLL_HELPER}\n`;
    if (body.includes('_ce_indexof(')) code += `${PYTHON_INDEXOF_HELPER}\n`;
    if (body.includes('_ce_ord(')) code += `${PYTHON_ORD_HELPER}\n`;

    code += `def ${functionName}(${params}):\n`;

    if (docstring) {
      code += `    r"""${docstring}"""\n`;
    }

    if (body.includes('\n')) {
      // Block body — the block hook already put `return` on the last line.
      // Indent each statement under the `def`; do not wrap in `return`.
      const indented = body
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n');
      code += `${indented}\n`;
    } else {
      code += `    return ${body}\n`;
    }

    return code;
  }

  /**
   * Create a vectorized NumPy function from an expression
   *
   * The generated function will work with both scalar values and NumPy arrays.
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names
   * @param docstring - Optional docstring
   * @param options - `cse: false` disables common-subexpression elimination
   */
  compileVectorized(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string,
    options?: { cse?: boolean; constantFold?: boolean }
  ): string {
    const baseFunction = this.compileFunction(
      expr,
      `_${functionName}_scalar`,
      parameters,
      docstring,
      options
    );

    let code = baseFunction + '\n';

    code += `# Vectorized version\n`;
    code += `${functionName} = np.vectorize(_${functionName}_scalar)\n`;

    return code;
  }

  /**
   * Create a lambda function from an expression
   *
   * @param expr - The expression to compile
   * @param parameters - Parameter names
   * @param options - `cse: false` disables common-subexpression elimination
   */
  compileLambda(
    expr: Expression,
    parameters: string[],
    options?: { cse?: boolean; constantFold?: boolean }
  ): string {
    // A lambda body is an EXPRESSION position, so the same two single-line
    // statement shapes `compileToSource()` declines have no emission here
    // either — the `\n` check below is blind to both (D6).
    pythonAssertExpressionBody('compileLambda()', expr);
    // Root compilation boundary (see `compile` and `compileFunction`).
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
      constantFold: options?.constantFold,
      naming: BaseCompiler.newNamingContext(expr, undefined, parameters),
    });
    // Default-enabled, like `compileFunction`; `options.cse` is the opt-out.
    BaseCompiler.openCseSession(expr, target, { enabled: options?.cse });
    const body = BaseCompiler.compileCseRoot(expr, target);
    // A multi-statement construct (loop-form Sum/Product, Loop, Block) can
    // never be a Python lambda body. This path bypasses the D6 value-operand
    // guard, so check explicitly.
    if (body.includes('\n'))
      throw new Error(
        'compileLambda: a multi-statement construct (loop-form Sum/Product, ' +
          'Loop, or Block) cannot be a Python lambda body — use ' +
          'compileFunction instead.'
      );
    // Any lowering that routes through a module-level `_ce_*` runtime helper
    // cannot ride along a bare lambda, which has no place to define it. Fail
    // closed rather than emit a reference to an undefined name. (`_ce_bcast` is
    // the collection-operand ElementMax/ElementMin/Clamp lowering; `_ce_indexof`
    // is IndexOf's element test; `_ce_eqcoll` is collection/tuple equality;
    // `_ce_ord` is the ordering shape guard.)
    for (const [helper, what] of [
      ['_ce_bcast(', 'ElementMax/ElementMin/Clamp over a collection operand'],
      ['_ce_indexof(', 'IndexOf'],
      ['_ce_eqcoll(', 'equality over a collection or tuple operand'],
      ['_ce_ord(', 'an ordering over a collection operand'],
    ] as const)
      if (body.includes(helper))
        throw new Error(
          `compileLambda: ${what} needs the module-level ` +
            `${helper.slice(0, -1)} helper, which cannot ride along a bare ` +
            `lambda — use compileFunction instead.`
        );

    const params = parameters.join(', ');
    return `lambda ${params}: ${body}`;
  }
}
