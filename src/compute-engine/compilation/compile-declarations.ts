// Declarations and destructuring: typed temporaries, declared type sources,
// enforced assignment targets, parameter restrictions, callback annotations
// and pattern desugaring.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isValueDef } from '../boxed-expression/utils.js';
import {
  collectionElementType,
  functionResult,
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
  widen,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isString,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
  isDestructuringParameter,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import type { CompileTarget } from './types.js';
import { mayBeCollectionType } from './in-place-update.js';
import { CompilerState } from './compiler-state.js';
import {
  compilationType,
  possiblyCollectionTypedForCompile,
} from './compiler-type-facts.js';
import { tempVar } from './compiler-naming.js';
import { core } from './compiler-core-hooks.js';
import { NON_PROMOTING_ELEMENTWISE_HEADS } from './compiler-tables.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import type {
  ElementLane,
  UnrolledIndexBinderEntry,
  UnrolledIndexFrame,
} from './compiler-types.js';

/**
 * Whether the compilation in progress PROMOTES: an unknown-sign
 * `Sqrt`/`Ln`/`Log` (and the real-typed operand of an inverse-trig head of
 * unknown magnitude) lowers through the complex kernels — the `auto` and
 * `complex` disciplines. `strict` never promotes (the shader targets'
 * model).
 *
 * Promotion is off, in every mode, inside the value of a `Typed` node whose
 * ascribed type is real when that value is complex only because of
 * promotion (`withPromotionSuppressed`): there the author declared that
 * the value is real, and the value compiles on the real lane as `strict`
 * compiles it.
 */
export function promotionActive(): boolean {
  if (CompilerState._promotionSuppressed > 0) return false;
  return modePromotes();
}

/**
 * Whether the compile mode promotes (`auto` or `complex`), also inside the
 * value of a real ascription
 * (`withPromotionSuppressed`). A module-level definition (a user function)
 * is always compiled with the promotion of the mode
 * (`withPromotionUnsuppressed`), so the choice of the definition to emit
 * for a call must read this value, not `promotionActive`. Otherwise a call
 * inside a real-ascribed value selects a definition that is not
 * specialized for the promoting mode, and that definition is then
 * compiled with promotion on and reused by every later call.
 */
export function modePromotes(): boolean {
  return CompilerState._mode === 'auto' || CompilerState._mode === 'complex';
}

/**
 * Whether the compilation in progress uses complex-value promotion. A numeric
 * binding whose static type is wide (`unknown`, `number`, an
 * unannotated parameter, a block local not declared real) is
 * complex-shaped, and every wide value is lifted at its use through the
 * target's idempotent `complexLift` (`_SYS.cplx`) — a number becomes `{re,
 * im: 0}`, an object passes through, and a non-number (a string, a
 * boolean, a collection held by a wide binding) passes through untouched.
 * Sound because over-approximating complex is only slower. Typed-real
 * values keep the real kernel; the type-based realness proofs survive as an
 * optimization.
 *
 * In force for `mode: 'complex'` — as requested, or as the discipline of
 * `auto`'s escalated retry after a `LaneMismatch` (the engine-level
 * `compile()` redoes the compilation with `mode: 'complex'`).
 */
export function complexDiscipline(): boolean {
  return CompilerState._mode === 'complex';
}

/**
 * The binder mask under which a user function's body is ANALYZED: every
 * parameter shielded (a parameter is not a
 * free engine symbol, so the engine-value fallback must not read through
 * it — but its declared type stays in play, since a typed parameter can
 * legitimately be complex). No parameter is bound complex or real here: the
 * `real` and `complex` lists are always empty, so a parameter is complex
 * only when its declared type says so. Every target uses this mask, the
 * JavaScript target included.
 */
export function userCallMask(literal: Expression & FunctionInterface): {
  real: string[];
  shielded: string[];
  complex: string[];
} {
  const shielded: string[] = [];
  for (const p of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(p);
    if (name) shielded.push(name);
  }
  return { real: [], shielded, complex: [] };
}

/**
 * The VALUE expression of a user function's stored body, with the wrappers
 * canonicalization adds around it removed: a `Block` holding a single
 * statement, and the `Typed` ascription a declared result type adds.
 *
 * Only a SINGLE-statement block is unwrapped. A multi-statement body binds
 * locals whose complex-ness `isBlockValueComplexValued` infers with a frame
 * the analyses that call this do not build, so guessing at the value of such
 * a body could disagree with what the emitter produces.
 */
export function unwrappedFunctionBody(
  body: Expression | undefined
): Expression | undefined {
  let e = body;
  while (
    e !== undefined &&
    ((isFunction(e, 'Block') && e.ops.length === 1) ||
      (isFunction(e, 'Typed') && e.ops.length >= 1))
  )
    e = e.ops[0];
  return e;
}

/**
 * Extract the initial-value operand of a `Declare` expression, if any.
 *
 * Handles the positional forms `Declare(sym, type, value)` and a `value`
 * key in an optional trailing attributes `Dictionary`. A positional value
 * takes precedence over the dictionary's `value`. Returns `undefined` when
 * the declaration has no value (`Declare(sym)` / `Declare(sym, type)`).
 */
export function declareValueOperand(
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  let rest = ops.slice(1);
  let attrsValue: Expression | undefined;
  const last = rest[rest.length - 1];
  if (last !== undefined && isDictionary(last)) {
    attrsValue = last.get('value');
    rest = rest.slice(0, -1);
  }
  // rest is now the positional operands after the symbol: [type?, value?]
  return rest[1] ?? attrsValue;
}

/**
 * The type SPEC of a `Declare`, as the source string the interpreter parses
 * — the positional `Declare(sym, type, …)` operand, else the attributes
 * `type` key, following the same precedence as `declareValueOperand`.
 * `undefined` when the declaration states no type at all.
 *
 * The spec reaches the handler RAW (a `{ str }` in the positional slot, a
 * type-name symbol in the attributes form), so both spellings are read.
 */
export function declareTypeOperand(
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  let rest = ops.slice(1);
  let attrsType: Expression | undefined;
  const last = rest[rest.length - 1];
  if (last !== undefined && isDictionary(last)) {
    attrsType = last.get('type');
    rest = rest.slice(0, -1);
  }
  return rest[0] ?? attrsType;
}

/** The declared-type spelling of a raw `Declare` type operand, or `undefined`
 * when it is neither a string nor a symbol. */
export function declaredTypeSource(t: Expression): string | undefined {
  if (isString(t)) return t.string;
  if (isSymbol(t)) return t.symbol;
  return undefined;
}

/**
 * Lower a destructuring pattern whose value is tuple-VALUED but not a
 * literal `Tuple` — the state-threading idiom `(n, j) := parseDigits(cs, j)`
 * — into ONE temporary holding the whole tuple plus a positional read per
 * leaf. Returns `null` when the shape is not admitted; the caller then fails
 * closed and the interpreter evaluates the statement.
 *
 *     let (v, j) = step(k)
 *       ⟶  let _tv1; _tv1 = step(k); let v = _tv1[1]; let j = _tv1[2]
 *
 * The value is evaluated EXACTLY ONCE (into the temporary) and only then
 * read, which is the interpreter's order — including for a `_` position,
 * which contributes no read at all.
 *
 * Admitted only when all of:
 * - the target is JavaScript. Every other target keeps the existing D6 —
 *   the positional-read lowering has only been established there (the
 *   Python target cannot compile a user-function call at all, so the shape
 *   this exists for is unreachable on it) and a widened gate needs its own
 *   per-target verification, not an assumption.
 * - the pattern is FLAT at this level (every position a symbol or `_`). A
 *   nested position would need a temporary of its own; it stays D6.
 * - the value's static type is a tuple whose arity is statically known and
 *   equals the pattern's. An unknown arity cannot be checked against the
 *   pattern, and a mismatch is an interpreter error.
 *
 * The temporary is declared in a THROWAWAY scope carrying the value's own
 * type, so the emitted `At(_tv1, i)` reads as a tuple index: the JS `At`
 * admission gate is type-based, and a bare `unknown`-typed temporary is
 * (deliberately) not admitted by it. The scope is popped immediately — the
 * boxed symbol keeps its definition, and nothing is left in the ambient
 * scope.
 *
 * Note for whoever widens the target gate: the temporary's declaration and
 * its initializer are emitted as SEPARATE statements because a target with a
 * `declare` hook (Python, GPU) emits only the declaration from a combined
 * `Declare(sym, type, value)` and drops the initializer (see
 * `desugarPatternAssign`). The per-leaf DECLARES below are combined, which
 * is sound on JavaScript only — splitting those too is the first step of
 * widening this gate.
 */
export function destructureViaTemp(
  pattern: Expression & FunctionInterface,
  v: Expression | undefined,
  target: CompileTarget<Expression>,
  kind: 'declaration' | 'assignment',
  enforcedLocals?: ReadonlySet<string>
): { binds: Expression[]; writes: Expression[] } | null {
  if (v === undefined) return null;
  if (target.language !== 'javascript') return null;
  if (pattern.nops === 0) return null;
  if (!pattern.ops.every((p) => isSymbol(p))) return null;
  const t = compilationType(v);
  if (typeof t === 'string' || t.kind !== 'tuple') return null;
  if (t.elements.length !== pattern.nops) return null;

  // Every target is checked BEFORE anything is emitted — and before a
  // temporary is minted — so a rejection on a later leaf leaves nothing
  // behind: the same all-or-nothing discipline the interpreter's pre-pass
  // has.
  if (kind === 'assignment')
    for (const p of pattern.ops) assertLeafAssignable(p, enforcedLocals);

  const ce = pattern.engine;
  const temp = typedTemp(ce, tempVar(target), v.type.type);
  const binds = [
    ce._fn('Declare', [temp, ce.string('unknown')]),
    ce._fn('Assign', [temp, v]),
  ];
  const writes: Expression[] = [];
  for (let i = 0; i < pattern.nops; i++) {
    const p = pattern.ops[i];
    if (!isSymbol(p) || p.symbol === '_') continue;
    // `At` is 1-BASED.
    const read = ce._fn('At', [temp, ce.number(i + 1)]);
    writes.push(
      kind === 'declaration'
        ? ce._fn('Declare', [p, ce.string('unknown'), read])
        : ce._fn('Assign', [p, read])
    );
  }
  return { binds, writes };
}

export function assertLeafAssignable(
  p: Expression,
  enforcedLocals: ReadonlySet<string> | undefined
): void {
  if (!isSymbol(p) || p.symbol === '_') return;
  const name = p.symbol;
  // A BLOCK-LOCAL target: its `Declare` is held, so nothing is installed and
  // the lookup below finds no definition (or an unrelated ambient one). The
  // enclosing statement list is the only place its declaration is visible;
  // `compileBlock` harvests it (`enforcedLocalTargets`) and either passes it
  // in (a statement at its own level) or pushes it (a nested loop body).
  if (
    enforcedLocals?.has(name) ||
    CompilerState._enforcedTargets.some((f) => f.has(name))
  )
    throw new Error(
      `Could not compile a destructuring assignment: the target '${name}' is ` +
        `declared as a constant or with a declared type (a block-local ` +
        `declaration, or an annotated parameter), and ` +
        `the compiled per-leaf write can enforce neither. The interpreter ` +
        `validates every leaf before writing any, and rejects the whole ` +
        `assignment when one does not fit. The interpreter evaluates it instead.`
    );
  // A target declared in an ENCLOSING, already-installed scope (a typed
  // function parameter, an `ce.declare`d symbol). The pattern leaves are
  // boxed structurally — the canonical `Assign` deliberately leaves them
  // unresolved — so the definition is read from the engine rather than off
  // the symbol, with a lookup that declares nothing.
  const def = p.engine.lookupDefinition(name);
  if (def === undefined || !isValueDef(def)) return;
  const value = def.value;
  if (value.isConstant)
    throw new Error(
      `Could not compile a destructuring assignment: cannot assign to the ` +
        `constant '${name}'. The interpreter rejects the whole ` +
        `assignment; the compiled per-leaf writes have no such check. The interpreter evaluates it instead.`
    );
  if (!value.inferredType && !value.type.isUnknown)
    throw new Error(
      `Could not compile a destructuring assignment: the compiled write cannot ` +
        `enforce the declared type of '${name}' ` +
        `('${value.type.toString()}'). The interpreter validates every leaf ` +
        `before writing any, and rejects the whole assignment when one does ` +
        `not fit. The interpreter evaluates it instead.`
    );
}

/**
 * The names a statement list declares with an enforcement the compiled
 * per-leaf destructuring write cannot reproduce: `const`, or a declared type
 * other than the `"unknown"` filler.
 *
 * Read straight off the `Declare` statements, because a block-local
 * declaration is HELD — nothing is installed at compile time, so
 * `assertLeafAssignable`'s definition lookup cannot see it. Mirrors the
 * interpreter's own operand reading (`Declare`'s evaluate handler): the
 * positional type is `ops[1]` once a trailing attributes dictionary is set
 * aside, and it wins over the dictionary's `type`; `constant` is a dictionary
 * key.
 */
export function enforcedLocalTargets(
  args: ReadonlyArray<Expression>
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const arg of args) {
    if (!isFunction(arg, 'Declare')) continue;
    const sym = arg.ops[0];
    if (!isSymbol(sym)) continue;
    const rest = arg.ops.slice(1);
    let attrType: Expression | undefined;
    let attrConstant: Expression | undefined;
    const last = rest[rest.length - 1];
    if (last !== undefined && isDictionary(last)) {
      attrType = last.get('type');
      attrConstant = last.get('constant');
      rest.pop();
    }
    const typeSource = rest[0] ?? attrType;
    // An unrecognized type spelling counts as enforced: declining is the
    // safe direction.
    if (
      typeSource !== undefined &&
      declaredTypeSource(typeSource) !== 'unknown'
    )
      out.add(sym.symbol);
    if (
      attrConstant !== undefined &&
      !(isSymbol(attrConstant) && attrConstant.symbol === 'False')
    )
      out.add(sym.symbol);
  }
  return out;
}

/**
 * The PARAMETERS of a function literal that carry a type annotation — the
 * third source of enforced destructuring targets, alongside the installed
 * definitions `assertLeafAssignable` looks up and the block-local `Declare`s
 * `enforcedLocalTargets` harvests.
 *
 * A parameter's declared type lives on the literal's parameter operands
 * (`Typed(x, "integer")`), in a scope that is NOT installed while the body
 * is compiled: the lookup finds no definition and the body has no `Declare`
 * for it, so `(x, y) := (7, 4.5)` over `f(x: integer, y: integer)` wrote
 * both leaves compiled where the interpreter — validating every leaf first —
 * refuses the whole assignment and leaves the parameters at their argument
 * values.
 *
 * An UNANNOTATED parameter (a bare symbol operand) is not enforced: nothing
 * constrains it, so the sequence of per-leaf writes IS the interpreter's
 * outcome, and the state-threading idiom `(v, j) := step(j)` keeps compiling.
 */
export function enforcedParamTargets(
  literal: Expression & FunctionInterface
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const p of literal.ops.slice(1)) {
    if (!isFunction(p, 'Typed')) continue;
    const sym = p.ops[0];
    const typeSource = p.ops[1];
    if (!isSymbol(sym) || typeSource === undefined) continue;
    // An unrecognized type spelling counts as enforced: declining is the
    // safe direction (as in `enforcedLocalTargets`).
    if (declaredTypeSource(typeSource) !== 'unknown') out.add(sym.symbol);
  }
  return out;
}

/**
 * Fail closed on a DESTRUCTURING parameter (`((p, q)) => p + q`).
 *
 * Every target lowers a lambda to `(name₁, …, nameₙ) => body`, one emitted
 * name per parameter operand, and reads a parameter operand that yields no
 * name as the throwaway `_`. A pattern parameter yields no name, so the
 * body's references to its leaves would compile as references to whatever
 * `p` and `q` mean OUTSIDE the lambda — silently wrong code, not an error
 * (measured: `Map(((p, q)) => p + q, xs)` emitted
 * `(_p) => _.p + _.q`, reading two unrelated globals).
 *
 * Refusing is the D6 fail-closed rule. Destructuring in the emitted code is
 * a real option for some targets (a JS tuple is an array), but it has to be
 * decided per target and per tuple REPRESENTATION, so no target claims it
 * today.
 */
export function assertNoDestructuringParams(
  params: ReadonlyArray<Expression>
): void {
  for (const p of params)
    if (isDestructuringParameter(p))
      throw new Error(
        `Could not compile a function literal with a destructuring parameter ` +
          `"${p.toString()}": no compile target lowers the tuple match. ` +
          `Take the tuple as one named parameter and read its components ` +
          `in the body.`
      );
}

/**
 * Fail closed on a REST parameter (`(a, ...rest) => …`).
 *
 * The same fail-closed rule as {@link assertNoDestructuringParams}, for the
 * same reason: every target lowers a lambda to one emitted name per
 * parameter operand, so a rest parameter would emit an ORDINARY positional
 * name and the compiled function would bind only the first trailing
 * argument, instead of a tuple of all of them. No target lowers the
 * argument collection today, so compilation refuses rather than emitting
 * code that quietly disagrees with the interpreter.
 */
export function assertNoRestParams(params: ReadonlyArray<Expression>): void {
  for (const p of params)
    if (isRestParameter(p))
      throw new Error(
        `Could not compile a function literal with a rest parameter ` +
          `"${p.toString()}": no compile target collects the trailing ` +
          `arguments. Take the trailing arguments as one tuple parameter ` +
          `and read its components in the body.`
      );
}

/**
 * Run `fn` — the compilation of `literal`'s BODY as an emitted definition —
 * with that literal's annotated parameters as the enforced-target frames.
 *
 * The enclosing frames are REPLACED, not stacked on (the `isolate` case of
 * `withLocalShapeFrame`): an emitted definition is a module-level function,
 * not a block lexically nested in the requesting one, so a same-named typed
 * local at the call site must not make this body decline.
 *
 * Public for the DIRECT lambda-compile route (`compileToTarget`'s
 * `Function`-literal branch in javascript-target.ts, the `calling: 'lambda'`
 * convention), which compiles a literal's body without going through
 * `emitFunctionLiteralDefinition` and must wrap it the same way — otherwise
 * a destructuring assign onto a typed parameter miscompiles there while the
 * emitted-definition route declines.
 */
export function withEnforcedParams<T>(
  literal: Expression & FunctionInterface,
  fn: () => T
): T {
  const saved = CompilerState._enforcedTargets;
  CompilerState._enforcedTargets = [enforcedParamTargets(literal)];
  try {
    return fn();
  } finally {
    CompilerState._enforcedTargets = saved;
  }
}

/**
 * The PROVABLE element type of a collection operand, or `undefined` when
 * there is no positive evidence (`unknown`/`any`/not a collection type).
 *
 * Mirrors `sourceElementType` in `library/map-broadcast-shape.ts`: only the
 * COLLECTION layer is resolved (a collection spelled as a type reference has
 * to be unfolded before its element type can be read), and the element type
 * itself is returned unresolved so a NOMINAL element keeps its identity for
 * the subtype question in {@link assertCallbackAnnotations}.
 */
/**
 * Do the elements of `coll` fold with the RAW real operator — every
 * element provably a real number — or must a `Sum`/`Product` over it take
 * the shape-agnostic combiner (`_SYS.sadd`/`_SYS.smul`, wrapped in the
 * complex lift) because an element may be a `{re, im}`?
 *
 * The element TYPE alone is not enough under a PROMOTING discipline:
 * `Map(Ln, xs)` types `list<real>` from `Ln`'s signature while the
 * eta-expanded callback promotes each element. So under promotion only a
 * collection whose elements are real BY CONSTRUCTION — a real-typed symbol,
 * a range, a literal list of real-analyzed elements — folds raw; any
 * producer that applies a callback takes the agnostic fold. Both the
 * analysis (`isComplexValued` of the fold: complex iff NOT real here) and
 * the JavaScript emitter (`emitCollectionReduce`) read this one predicate,
 * so parent and child agree on the fold's SHAPE.
 */
export function collectionFoldsReal(coll: Expression): boolean {
  // An element the analysis calls complex (a complex cell, a callback body
  // that promotes) — never a raw fold.
  if (core.isComplexValued(coll)) return false;
  // Elements TYPED non-real (`list<complex>`) are complex-shaped in every
  // mode — shape follows the static type.
  const elt = collectionElementTypeOf(coll);
  if (elt !== undefined && isNonRealNumber(elt)) return false;
  // Elements that are themselves collections (the rows of a list of lists)
  // are added element by element, never with the scalar `+`: a raw fold
  // over two JavaScript arrays concatenates them as strings
  // (`[1, 2] + [3, 4]` is `"1,23,4"`). Only an element type that is
  // definitely a collection is refused here; a wide or unknown element type
  // keeps the rules below.
  // `never`, the element type of an empty list, has no value and is not a
  // row.
  if (elt !== undefined && elt !== 'never' && isSubtype(elt, 'collection<any>'))
    return false;
  // An element that may be a number or a collection (`number | vector<2>`)
  // is not folded raw either.
  if (mayBeCollectionType(elt)) return false;
  // COMPLEX discipline: a wide element (`list<number>`) may hold a
  // `{re, im}` at run time; only a real-only element type folds raw.
  if (complexDiscipline()) return elt !== undefined && isSubtype(elt, 'real');
  // Strict shapes (strict, and `auto`'s first attempt): a wide element is
  // real, as everywhere else — but under promotion the element TYPE can
  // hide a promoting callback the analysis cannot see into.
  if (!promotionActive()) return true;
  return elementsRealByConstruction(coll);
}

/**
 * Under a promoting discipline, are the elements of `coll` real by
 * CONSTRUCTION — i.e. is the element type trustworthy? A `Map` whose
 * callback is a `Function` LITERAL is covered by the analysis (its body
 * is looked through with the parameter bound), so it counts as real when
 * `isComplexValued` said so; a `Map` over a bare callback SYMBOL (`Map(Ln,
 * xs)`: an eta the analysis cannot see into) does not. Element-preserving
 * producers defer to their source.
 */
export function elementsRealByConstruction(coll: Expression): boolean {
  // A symbol has no callback for the analysis to miss, so its elements are
  // exactly what its TYPE says. An element type that is not a real one is
  // rejected by the caller before this point; what is left is a real
  // element type (`list<real>`) or a WIDE one (`list<number>`). A list whose
  // element type is `unknown` is not admitted, since `unknown` is not a
  // subtype of `number`. A wide element is REAL under every
  // discipline but `complex` — the same rule every other wide binding
  // follows (`wideIsComplex`), and the same answer the indexed form of the
  // very same fold gets: `Σ_{k=a}^{b} P[k]` over a `list<number>` reads
  // each element as a plain number and accumulates with `+`. Reading the
  // symbol arm more strictly than that put a REAL list reduction in the
  // complex lane — `total(P[a...b])` over a `list<number>` was emitted as
  // `_SYS.cplx((…).reduce(_SYS.sadd, 0))`.
  if (isSymbol(coll)) {
    const elt = collectionElementTypeOf(coll);
    return (
      elt !== undefined && isSubtype(elt, 'number') && !isNonRealNumber(elt)
    );
  }
  if (!isFunction(coll)) return false;
  const h = coll.operator;
  if (h === 'Range' || h === 'Linspace') return true;
  if (h === 'List' || h === 'Tuple')
    return coll.ops.every((e) => !core.isComplexValued(e));
  if (h === 'Map') return isFunction(coll.ops[0], 'Function');
  if (
    h === 'Filter' ||
    h === 'Take' ||
    h === 'Drop' ||
    h === 'TakeWhile' ||
    h === 'DropWhile' ||
    h === 'Reverse' ||
    h === 'Sort' ||
    h === 'Unique' ||
    h === 'Slice'
  )
    return coll.ops[0] !== undefined && elementsRealByConstruction(coll.ops[0]);
  // A GATHER — `At` with a collection of indices, the `P_{a..b}` spelling —
  // takes its elements from the source collection, exactly as `Take` and
  // `Slice` do; an out-of-range index contributes `NaN`, which is real. The
  // index has to be a COLLECTION for that to hold: `At` with a scalar index
  // over a nested list answers a ROW, whose elements are one level deeper
  // than the ones this question is about. Without this arm a sum over a
  // slice of a real list took the shape-agnostic fold, so `|Sum(P_{a..b})|`
  // was emitted as `_SYS.cabs(_SYS.cplx(…))` for a real list (measured by
  // the Tycho code-generation audit of 2026-09-08).
  if (h === 'At' && coll.ops.length === 2) {
    const index = coll.ops[1];
    return (
      (index.isCollection || index.type.matches('collection<any>')) &&
      elementsRealByConstruction(coll.ops[0])
    );
  }
  // ELEMENT-WISE ARITHMETIC builds element k of its result from element k of
  // each operand and applies no callback of its own, so its elements are
  // real exactly when every operand contributes real ones. A collection
  // operand is asked this same question; every other operand contributes one
  // scalar to every element, and for a scalar the analysis's own
  // `isComplexValued` verdict is exact — it is the verdict the emitter picks
  // its lowering from. Only heads that NEVER promote are listed: `Sqrt`,
  // `Ln` and the inverse-trig family lower through the complex kernels for
  // an operand of unknown sign or magnitude under a promoting discipline, so
  // for those the operands' realness says nothing about the result's.
  if (NON_PROMOTING_ELEMENTWISE_HEADS.has(h))
    return coll.ops.every((op) =>
      op.type.matches('collection<any>') ||
      possiblyCollectionTypedForCompile(op)
        ? elementsRealByConstruction(op)
        : !core.isComplexValued(op)
    );
  // A call to a USER FUNCTION whose body BUILDS the collection: the elements
  // are the ones that body builds, so the question passes through to it. The
  // parameters are shielded — bound as declared, never read through a
  // same-named engine symbol — which is the binding the emitted definition
  // is compiled under, and a head already being looked through declines so
  // that a self- or mutually-recursive definition terminates instead of
  // looping. Both rules are the ones `withCollectionElements` follows for
  // the element-level analysis; this arm differs only in asking about the
  // body as a whole, because a body such as `[-y, x] / (x² + y²)` computes
  // its collection rather than writing one out.
  if (typeof h === 'string' && !CompilerState._userCallVisited.has(h)) {
    const literal = userFunctionLiteral(coll.engine, h);
    const body =
      literal === undefined ? undefined : unwrappedFunctionBody(literal.ops[0]);
    if (literal !== undefined && body !== undefined) {
      const nextVisited = new Set(CompilerState._userCallVisited);
      nextVisited.add(h);
      const prevVisited = CompilerState._userCallVisited;
      CompilerState._userCallVisited = nextVisited;
      try {
        // The body is read as the emitted module-level definition reads
        // it, without the call site's bindings (see
        // `withCallerBindingsHidden`).
        return core.withCallerBindingsHidden(() =>
          withBinderMask(userCallMask(literal), () =>
            elementsRealByConstruction(body)
          )
        );
      } finally {
        CompilerState._userCallVisited = prevVisited;
      }
    }
  }
  return false;
}

/**
 * Fail closed when a LOCKSTEP walk over several sources — the zip
 * form of `Map`, and `Zip` itself — would run a source's effects more often
 * than the interpreter does.
 *
 * The interpreter advances every source together and stops as soon as the
 * shortest one ends, so a longer source is never walked past that point.
 * The emitted code has no lockstep walk: it materializes every source in
 * full and only then reads the minimum length. For a pure source the two
 * are indistinguishable; for a source that draws `Random` or calls a
 * stateful function, the extra elements are extra draws and calls. A
 * single source is never refused here (`Map(f, xs)` walks all of `xs` on
 * both routes). `firstPosition` is the 1-based operand position of
 * `sources[0]` in the enclosing call, for the diagnostic.
 */
export function assertLockstepSourcesPure(
  kind: string,
  sources: ReadonlyArray<Expression | undefined>,
  firstPosition: number
): void {
  if (sources.length < 2) return;
  sources.forEach((source, i) => {
    if (source === undefined || source.isPure) return;
    throw new Error(
      `Could not compile \`${kind}\`: operand ${i + firstPosition} has observable effects, and ` +
        `a walk over several collections stops at the shortest one, so ` +
        `the compiled code — which materializes every collection in ` +
        `full — would run those effects more often than the interpreter ` +
        `does. The interpreter evaluates it instead.`
    );
  });
}

/**
 * The element type each source of the zip form of `Map` feeds its
 * callback at that position, or a fail-closed throw.
 *
 * A callback over several sources is compiled with BARE parameters: the
 * zip form stamps none of them (its contextual callback slot is unary), so
 * the emitted body treats every parameter as a real scalar. That is
 * faithful only when every source provably supplies real scalars. A
 * `list<complex>` source would reach `+` as an object and a
 * `list<list<number>>` source as an array — both emit a string where the
 * interpreter answers a complex number or a broadcast sum. The unary form
 * has no such gap because its one parameter IS stamped with the source's
 * element type and the body compiles under it. So an element type that is
 * unprovable, not numeric, or provably non-real declines here. `number`
 * itself is admitted: the compiled real lane is what a `number`-typed
 * parameter gets everywhere else in this compiler. `firstPosition` is as
 * for `assertLockstepSourcesPure`.
 */
export function zipCallbackArgTypes(
  kind: string,
  sources: ReadonlyArray<Expression | undefined>,
  firstPosition: number
): Type[] {
  return sources.map((source, i) => {
    const elt = collectionElementTypeOf(source);
    if (elt !== undefined && isSubtype(elt, 'number') && !isNonRealNumber(elt))
      return elt;
    throw new Error(
      `Could not compile \`${kind}\`: operand ${i + firstPosition} ` +
        (elt === undefined
          ? `has no provable element type`
          : `has elements of type '${typeToString(elt)}'`) +
        `, and the mapping over several collections is compiled with ` +
        `untyped parameters that the emitted code treats as real numbers. The interpreter evaluates it instead.`
    );
  });
}

/**
 * Whether the collection form of `Sum`/`Product` over `coll` combines
 * ELEMENTS THAT ARE COLLECTIONS (points, rows, matrices): its element type
 * is an indexed collection that is not text. The JavaScript emitter then
 * folds with the element-wise helpers (`_SYS.add`/`_SYS.mul`, or their
 * complex forms), and the value is an array, complex-shaped exactly when
 * the lane of `coll` is complex. `isComplexValued` and the emitter
 * (`compileSumProduct`, `javascript-target.ts`) both read this test, so
 * they agree on the shape of the value.
 */
export function foldsCollectionElements(coll: Expression): boolean {
  // A tensor of unknown rank (`tensor<U>`, whose `dimensions` is `null`)
  // may be a matrix, whose elements are rows: its elements are typed
  // `U | tensor<U>`, which is not an indexed collection, so the test
  // below would choose the scalar fold and read a row as one number. The
  // guarded element-wise fold dispatches on each element, so it is the
  // fold for such an operand.
  const source = coll.isCanonical ? coll : coll.canonical;
  const t = resolveTypeForCompilation(source.type.type);
  if (typeof t !== 'string' && t.kind === 'list' && t.dimensions === null)
    return true;
  const elt = collectionElementTypeOf(coll);
  if (elt === undefined) return false;
  const element = resolveTypeForCompilation(elt);
  // Elements that may be numbers or collections (`number | vector<2>`,
  // the elements of `Rest(g(x))` for `g(t) = [t, 2t]` and `x: any`) are,
  // like the elements of a tensor of unknown rank, folded by the guarded
  // element-wise fold, which dispatches on each element. The scalar fold
  // read a row as one number (`+` of two arrays concatenated them). A
  // `broadcastable<T>` operand, whose elements are `T | tensor<T>`, keeps
  // the dispatching fold of its own (`foldLane` reads it as `wide`).
  if (
    !(typeof t !== 'string' && t.kind === 'broadcastable') &&
    typeof element !== 'string' &&
    element.kind === 'union' &&
    element.types.some((arm) => {
      const r = resolveTypeForCompilation(arm);
      return (
        r !== 'never' &&
        !isSubtype(r, 'string') &&
        isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)
      );
    })
  )
    return true;
  return (
    element !== 'never' &&
    !isSubtype(element, 'string') &&
    isSubtype(element, INDEXED_COLLECTION_SHAPE_TYPE)
  );
}

export function collectionElementTypeOf(
  source: Expression | undefined
): Type | undefined {
  if (source === undefined) return undefined;
  const src = source.isCanonical ? source : source.canonical;
  const elt = collectionElementType(resolveTypeForCompilation(src.type.type));
  if (elt === undefined || elt === 'unknown' || elt === 'any') return undefined;
  return elt;
}

/**
 * The `["Function", body, …params]` literal a callback operand stands for:
 * the operand itself when it is a literal, or, for a SYMBOL, the block-local
 * function the enclosing compiled block binds under that name
 * (`CompileTarget.localFunctions`: `function step(acc, i) { … }` or
 * `const step = (acc, i) => …` earlier in the same block), or else the
 * engine definition the name resolves to (`userFunctionLiteral`).
 * `undefined` when the operand names neither.
 *
 * The block-local registry is read FIRST, because a block local shadows an
 * engine definition of the same name, and because the engine's own lookup
 * cannot see it at all: the block's scope is not active while the block is
 * compiled, so `Fold(step, 0, xs)` with a block-local `step` was refused as
 * "no compiled function form" while `Map(step, xs)` compiled (the callback
 * route compiles the symbol as a plain bare-name read and never asks for
 * the literal). A name BOUND by an enclosing form (`target.boundVars`: a
 * block local, a lambda parameter, a loop index) that has no function
 * entry answers `undefined` rather than the engine definition it shadows:
 * `let step = 5` in a block removes the registry entry of a same-named
 * function, and the emitted code reads the local, not the function.
 * Without a target only the engine definition is consulted.
 */
export function callbackLiteral(
  op: Expression,
  target?: CompileTarget<Expression>
): (Expression & FunctionInterface) | undefined {
  if (isFunction(op, 'Function')) return op;
  if (!isSymbol(op)) return undefined;
  const local = target?.localFunctions?.get(op.symbol);
  if (local !== undefined)
    return isFunction(local, 'Function') ? local : undefined;
  if (target?.boundVars?.has(op.symbol)) return undefined;
  return userFunctionLiteral(op.engine, op.symbol);
}

/**
 * The provable type of the value a fold (`Reduce`, `Scan`) passes to its
 * combiner's ACCUMULATOR parameter, or `undefined` when nothing is
 * provable there.
 *
 * The accumulator receives the seed on the first step (the first element,
 * for a seedless fold) and the combiner's own result on every later step,
 * so its type is the join of the seed's type and the combiner's result
 * type. The result type is the literal's own, computed with the
 * accumulator bound to its annotation when it carries one. So for an
 * accumulator annotated `X` the join is a subtype of `X` exactly when the
 * seed satisfies `X` and a body that receives an `X` provably returns an
 * `X`: the induction under which the interpreter's annotation check can
 * never fire, which is what `assertCallbackAnnotations` needs.
 *
 * Before this the accumulator position was passed as "not provable", so
 * every annotated accumulator declined, including the list-building fold
 * `Fold((acc: list<integer | nan>, i) => Join(acc, [2 p[i]]), [], 1..n)`
 * (issue #369). A `unknown`/`any` seed or result still answers
 * `undefined`: nothing is provable from a top type.
 */
export function foldAccumulatorArgType(
  coll: Expression,
  op: Expression,
  init: Expression | undefined | null,
  target?: CompileTarget<Expression>
): Type | undefined {
  const literal = callbackLiteral(op, target);
  if (literal === undefined) return undefined;
  const result = functionResult(literal.type.type);
  if (result === undefined || result === 'unknown' || result === 'any')
    return undefined;
  let seed: Type | undefined;
  if (init === undefined || init === null) {
    seed = collectionElementTypeOf(coll);
  } else {
    const seedExpr = init.isCanonical ? init : init.canonical;
    seed = seedExpr.type.type;
  }
  if (seed === undefined || seed === 'unknown' || seed === 'any')
    return undefined;
  return widen(seed, result);
}

/**
 * Fail closed when a compiled CALLBACK carries a parameter annotation
 * whose enforcement the emitted code would silently drop.
 *
 * Under the annotation-as-contract ruling
 * (`docs/TYPE-SYSTEM.md`, ruling 2) an
 * annotated parameter must error LOUDLY on an argument that does not fit:
 * the interpreter applies the literal through `Apply`, which validates each
 * argument against its `Typed` annotation and yields an `Error` VALUE in the
 * element's place (`test/compute-engine/filter-predicate-errors.test.ts`).
 * A compiled callback is a plain arrow/lambda — the annotation is not
 * emitted at all — so `Filter(ds, (n: integer) ↦ n > 0)` over `[1.5, 2.5]`
 * ran to `[1.5, 2.5]` where the interpreter answers two `Error`s. A compiled
 * target has no Error VALUE to produce, so exact parity is out of reach; the
 * invariant is the weaker one — never a silently wrong value.
 *
 * The gate is therefore the same one `lowerLevel` uses for the fused
 * per-element bypass (`annotationSatisfiedBySource`): an annotation is
 * admitted only when the argument type the lowering will feed that position
 * PROVABLY satisfies it, so the enforcement cannot fire and the bypass is
 * unobservable. Positive evidence only — an unprovable argument type
 * (`undefined` here) declines, and so does an annotation NARROWER than the
 * argument type. Declining throws, so `compile()` reports `success: false`
 * and the interpreter — which does enforce — evaluates the expression.
 *
 * `argTypes[i]` is the provable type of the value the emitted lowering
 * passes to parameter `i` (an element type, an index type, …), or
 * `undefined` when nothing is provable there. A bare (unannotated) parameter
 * is unconstrained and always passes.
 */
export function assertCallbackAnnotations(
  kind: string,
  callback: Expression | undefined,
  argTypes: ReadonlyArray<Type | undefined>,
  target?: CompileTarget<Expression>
): void {
  // A SYMBOL naming a user-defined function is checked on its literal: the
  // emitted definition (`emitFunctionLiteralDefinition`) drops the
  // annotation exactly as an inline arrow does, so `Filter(ds, p)` over
  // `p = (n: integer) ↦ n > 0` had the same silent divergence. The literal
  // is the one the emitted code calls (`callbackLiteral`): with the
  // `target`, a function local to the enclosing block comes first. Read
  // from the engine only, the local `const step = (a: integer, x) => a + 1`
  // in `Fold(step, 0.5, p)` was not checked, and the compiled fold
  // answered a number where the interpreter reports the annotation error.
  const literal = isSymbol(callback)
    ? callbackLiteral(callback, target)
    : callback;
  if (literal === undefined || !isFunction(literal, 'Function')) return;
  const params = literal.ops.slice(1);
  for (let i = 0; i < params.length; i++) {
    const declared = functionLiteralParameterType(params[i]);
    if (declared === undefined) continue;
    const actual = argTypes[i];
    // The subtype question is asked on the UNRESOLVED types: nominal opacity
    // is a property of `isSubtype`, and resolving either side would erase it
    // and admit a callback whose enforcement DOES fire — silently, since the
    // compiled lowering has no enforcement at all.
    if (actual !== undefined && isSubtype(actual, declared)) continue;
    // An absent value at a NUMERIC parameter is no error: the interpreter
    // reads it as `NaN` (`makeLambda`, `function-utils.ts`), and so does
    // the compiled arrow of a function literal, through the default value
    // of the parameter (the `Function` branch of `compileOp`). So an
    // argument type `missing | T` is admitted when `T` satisfies the
    // annotation. The emitted callee carries that default when it is the
    // arrow of the literal: an inline literal, or a function local to the
    // enclosing block (`CompileTarget.localFunctions`), whose value is the
    // literal compiled in place. A function defined on the engine is
    // emitted as a definition with no such default, so it is not admitted
    // this way.
    const arrowCallee =
      !isSymbol(callback) ||
      target?.localFunctions?.get(callback.symbol) !== undefined;
    if (
      actual !== undefined &&
      arrowCallee &&
      isSubtype(declared, 'number') &&
      typeContainsMissing(actual) &&
      isSubtype(stripMissingFromType(actual), declared)
    )
      continue;
    throw new Error(
      `Could not compile \`${kind}\`: the callback parameter ` +
        `'${functionLiteralParameterName(params[i]) || `#${i + 1}`}' is ` +
        `annotated '${typeToString(declared)}'` +
        (actual === undefined
          ? `, and the type of the value it receives is not provable`
          : `, which the argument type '${typeToString(actual)}' does not ` +
            `provably satisfy`) +
        `. The compiled callback cannot enforce the annotation, and the ` +
        `interpreter reports a per-element error when it does not hold. The interpreter evaluates it instead.`
    );
  }
}

/**
 * A temporary SYMBOL carrying a static type, without touching the ambient
 * scope: declared in a scope pushed for the boxing and popped right after.
 * The returned expression keeps the definition it was bound to.
 */
export function typedTemp(
  ce: ComputeEngine,
  name: string,
  type: Type
): Expression {
  ce.pushScope();
  try {
    ce.declare(name, type);
    return ce.symbol(name);
  } finally {
    ce.popScope();
  }
}

/**
 * Desugar a destructuring `Declare` statement (`let (x, y) = (…, …)`) into
 * per-leaf declares, so locals collection, complex/vector inference and
 * every target's statement emitter see only plain scalar declares. Returns
 * `null` when the statement is not a destructuring declare.
 *
 * A LITERAL tuple value lowers element-wise: each element expression is
 * bound exactly once, in pattern order, so the rewrite is observationally
 * identical to the interpreter's evaluate-once semantics. A `_` leaf keeps
 * its element as a bare statement (its evaluation still happens).
 *
 * A tuple-VALUED value that is not a literal tuple (a call such as
 * `step(k)`, a tuple-typed symbol) lowers through ONE temporary holding the
 * whole tuple, plus a positional read per leaf — see `destructureViaTemp`,
 * which owns the gating. Everything else (an untyped or unknown-arity
 * value, a shape mismatch) fails closed so the engine falls back to the
 * interpreter. (Without any of this, the pattern compiled as a single
 * `let _ = …` and every pattern name silently read as NaN.)
 */
export function desugarPatternDeclare(
  arg: Expression,
  target: CompileTarget<Expression>
): ReadonlyArray<Expression> | null {
  if (!isFunction(arg, 'Declare') || !isFunction(arg.ops[0], 'Tuple'))
    return null;
  // A STATED type applies to every leaf: the interpreter validates each leaf
  // value against it in a read-only pre-pass and rejects the whole pattern
  // atomically when one does not fit. Both lowerings below rewrite each leaf
  // as `Declare(name, "unknown", value)`, dropping the type entirely — so
  // `Declare((x, y), "integer", (3, 4.5))` bound BOTH names where the
  // interpreter binds neither. Nothing to enforce it with here, so fail
  // closed. `"unknown"` is the no-annotation filler the positional-value
  // form must put in the type slot, and the Epsil surface emits nothing else
  // (a `:` annotation on a destructuring `let` is a parse diagnostic), so the
  // idiomatic path is untouched.
  const declaredType = declareTypeOperand(arg.ops);
  if (
    declaredType !== undefined &&
    declaredTypeSource(declaredType) !== 'unknown'
  )
    throw new Error(
      `Could not compile a destructuring declaration that states a type ` +
        `('${declaredType.toString()}'): the per-leaf lowering cannot ` +
        `enforce it, and the interpreter rejects the whole pattern when a ` +
        `leaf value does not fit. The interpreter evaluates it instead.`
    );
  const ce = arg.engine;
  const out: Expression[] = [];
  const walk = (pattern: Expression, v: Expression | undefined): void => {
    if (!isFunction(pattern, 'Tuple'))
      throw new Error(
        `Could not compile a destructuring declaration: the pattern is not a ` +
          `tuple.`
      );
    if (v === undefined || !isFunction(v, 'Tuple')) {
      // A tuple-VALUED (but not literal) value: one temporary + positional
      // reads, when `destructureViaTemp` admits the shape.
      const viaTemp = destructureViaTemp(pattern, v, target, 'declaration');
      if (viaTemp !== null) {
        out.push(...viaTemp.binds, ...viaTemp.writes);
        return;
      }
      throw new Error(
        `Could not compile a destructuring declaration whose value is not a ` +
          `literal tuple, nor an expression of statically-known tuple ` +
          `arity` +
          (v === undefined ? '' : ` (got '${v.type.toString()}')`) +
          `. The interpreter evaluates it instead.`
      );
    }
    if (pattern.nops !== v.nops)
      throw new Error(
        `Could not compile a destructuring declaration: the pattern has ` +
          `${pattern.nops} positions but the value tuple has ${v.nops}.`
      );
    for (let i = 0; i < pattern.nops; i++) {
      const p = pattern.ops[i];
      const el = v.ops[i];
      if (isFunction(p, 'Tuple')) {
        walk(p, el);
        continue;
      }
      if (!isSymbol(p))
        throw new Error(
          `Could not compile a destructuring declaration: a pattern position ` +
            `is not a symbol.`
        );
      if (p.symbol === '_') {
        out.push(el);
        continue;
      }
      out.push(ce._fn('Declare', [p, ce.string('unknown'), el]));
    }
  };
  walk(arg.ops[0], declareValueOperand(arg.ops));
  return out;
}

/**
 * Desugar a destructuring `Assign` statement (`(a, b) := (…, …)`) into
 * per-leaf temporaries followed by per-leaf writes, so the locals
 * collection, the inference below and every target's statement emitter see
 * only plain scalar declares and assigns. Returns `null` when the statement
 * is not a destructuring assign.
 *
 * Unlike the declaration form, the targets ALREADY EXIST, so the writes
 * cannot be interleaved with the reads: `(a, b) := (b, a)` lowered per-leaf
 * would emit `a = b; b = a` and read the `a` it just clobbered. Every
 * element is therefore bound to a temporary FIRST, and only then written to
 * its target — which is exactly the interpreter's "evaluate the whole
 * right-hand side, then write" order:
 *
 *     (a, b) := (b, a + b)
 *       ⟶  let _tv1 = b; let _tv2 = a + b; a = _tv1; b = _tv2
 *
 * A `_` position still gets a temporary (its element is evaluated for
 * effect) but no write. As with the declare form, a LITERAL tuple value
 * lowers element-wise, a tuple-VALUED one through a single whole-tuple
 * temporary (`destructureViaTemp`), and anything else — an unknown arity, a
 * shape mismatch — fails closed so the interpreter takes over.
 *
 * The rewrite is for EFFECT only: it ends on a write, whose value is one
 * leaf's, not the tuple's. Callers must therefore only apply it in statement
 * position — never where the statement's value is the enclosing block's
 * (see the caller in `compileBlock`, which leaves a trailing destructuring
 * assign to fail closed).
 */
export function desugarPatternAssign(
  arg: Expression,
  target: CompileTarget<Expression>,
  enforcedLocals?: ReadonlySet<string>
): ReadonlyArray<Expression> | null {
  if (!isFunction(arg, 'Assign') || !isFunction(arg.ops[0], 'Tuple'))
    return null;
  const ce = arg.engine;
  const binds: Expression[] = [];
  const writes: Expression[] = [];
  const walk = (pattern: Expression, v: Expression | undefined): void => {
    if (!isFunction(pattern, 'Tuple'))
      throw new Error(
        `Could not compile a destructuring assignment: the pattern is not a ` +
          `tuple.`
      );
    if (v === undefined || !isFunction(v, 'Tuple')) {
      // A tuple-VALUED (but not literal) value: one temporary + positional
      // reads, when `destructureViaTemp` admits the shape. Its binds still
      // precede EVERY write (they are collected in the same two lists), so
      // the evaluate-then-write order is preserved even in a mixed pattern.
      const viaTemp = destructureViaTemp(
        pattern,
        v,
        target,
        'assignment',
        enforcedLocals
      );
      if (viaTemp !== null) {
        binds.push(...viaTemp.binds);
        writes.push(...viaTemp.writes);
        return;
      }
      throw new Error(
        `Could not compile a destructuring assignment whose value is not a ` +
          `literal tuple, nor an expression of statically-known tuple ` +
          `arity` +
          (v === undefined ? '' : ` (got '${v.type.toString()}')`) +
          `. The interpreter evaluates it instead.`
      );
    }
    if (pattern.nops !== v.nops)
      throw new Error(
        `Could not compile a destructuring assignment: the pattern has ` +
          `${pattern.nops} positions but the value tuple has ${v.nops}.`
      );
    for (let i = 0; i < pattern.nops; i++) {
      const p = pattern.ops[i];
      const el = v.ops[i];
      if (isFunction(p, 'Tuple')) {
        walk(p, el);
        continue;
      }
      if (!isSymbol(p))
        throw new Error(
          `Could not compile a destructuring assignment: a pattern position ` +
            `is not a symbol.`
        );
      // A target the compiled write cannot hold to its declaration (a
      // constant, a declared non-inferred type) fails closed. The throw
      // discards the whole desugar, so no partially-lowered pattern escapes.
      assertLeafAssignable(p, enforcedLocals);
      // Every leaf is read into a temporary before ANY target is written —
      // including a `_` leaf, whose element is still evaluated for effect.
      //
      // The declaration and its initializer are emitted as SEPARATE
      // statements, not as one value-carrying `Declare`: a target with a
      // `declare` hook (Python, GPU) emits only the declaration from a
      // `Declare` and relies on `compileBlock` to hoist the initializer out
      // as its own assignment — which the statement paths here do not do,
      // so a combined form silently dropped the initializer and left every
      // temporary unbound (`a = _tv1` with no `_tv1 = …`).
      const temp = ce.symbol(tempVar(target));
      binds.push(ce._fn('Declare', [temp, ce.string('unknown')]));
      binds.push(ce._fn('Assign', [temp, el]));
      if (p.symbol !== '_') writes.push(ce._fn('Assign', [p, temp]));
    }
  };
  walk(arg.ops[0], arg.ops[1]);
  return [...binds, ...writes];
}

/**
 * Enter a scope that binds `names`, so the unrolled-index frames stop
 * answering for a name this scope REBINDS.
 *
 * A frame is keyed by index name. Without this, the compiler descending into
 * `Σ_{i=3}^{4} Σ_{i=0}^{1} s·√(i−2)` read the outer term's `i = 3` inside the
 * inner clause, folded the radicand to the non-negative `1` and emitted the
 * real `Math.sqrt` — which answers NaN at the inner `i = 0`, where the
 * interpreter answers a complex value.
 *
 * The FIRST scope that binds a name is the binder the frame was pushed for
 * (the `Sum` clause whose terms are being unrolled: its analysis masks the
 * index, and its emission binds the index in the compile target), so that
 * one consumes the name's `pending` mark and leaves the value readable.
 * Every later scope that binds the same name is a different binder and is
 * masked.
 *
 * The caller MUST pass the returned entry to `_exitUnrolledIndexBinder` on
 * every path out of the scope, exceptions included.
 */
export function _enterUnrolledIndexBinder(
  names: ReadonlyArray<string>
): UnrolledIndexBinderEntry | undefined {
  const frames = CompilerState._unrolledIndexValues;
  if (frames.length === 0 || names.length === 0) return undefined;
  const owned: Array<[UnrolledIndexFrame, string]> = [];
  const masked = new Set<string>();
  // Deduplicated: a binder lists the same name twice (`withBinderMask`
  // passes an index as both `real` and `shielded`), and a second visit would
  // find the `pending` mark the first one consumed already gone and mask the
  // binder against its own frame.
  for (const name of new Set(names)) {
    // The innermost frame that decides the name: a mask already hides it,
    // and there is then nothing left to hide.
    let holder: UnrolledIndexFrame | undefined;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].masked.has(name)) break;
      if (frames[i].values.has(name) || frames[i].lowerBounds?.has(name)) {
        holder = frames[i];
        break;
      }
    }
    if (holder === undefined) continue;
    if (holder.pending.delete(name)) owned.push([holder, name]);
    else masked.add(name);
  }
  if (owned.length === 0 && masked.size === 0) return undefined;
  if (masked.size > 0)
    frames.push({
      values: new Map(),
      masked,
      pending: new Set(),
      memo: new WeakMap(),
    });
  return { pushed: masked.size > 0, owned };
}

/** Leave the scope `_enterUnrolledIndexBinder` opened. */
export function _exitUnrolledIndexBinder(
  entry: UnrolledIndexBinderEntry | undefined
): void {
  if (entry === undefined) return;
  if (entry.pushed) CompilerState._unrolledIndexValues.pop();
  for (const [frame, name] of entry.owned) frame.pending.add(name);
}

/**
 * The layers that `_pushKeyedComplexMemoLayer` made, by the enclosing
 * complexness layer and then by the key of the context entered.
 */
export const _keyedMemoLayers = new WeakMap<
  WeakMap<object, boolean>,
  Map<
    string,
    {
      complex: WeakMap<object, boolean>;
      lane: WeakMap<object, ElementLane>;
      laneParent: WeakMap<object, ElementLane>;
    }
  >
>();

/**
 * Enter a lexical context that is fully described by `key` and by the
 * enclosing context. When the same context was entered before from the
 * same enclosing layer, push the layers of that entry again, with their
 * answers, instead of new empty layers. Returns the layer that was pushed,
 * which the caller gives to `_popKeyedComplexMemoLayer`.
 *
 * This is sound because an enclosing layer object stands for one context:
 * a change of that context replaces the layer object
 * (`_resetComplexMemoTop`, `_invalidateComplexMemo`). Without it, the body
 * of a `Sum` or `Product` was analyzed again, with an empty memo, each time
 * its binder mask was entered, and a subtree shared by several binders was
 * analyzed once for each path to it: exponential time in the depth of the
 * sharing (ROADMAP CE-458).
 */
export function _pushKeyedComplexMemoLayer(
  key: string
): WeakMap<object, boolean> {
  const cStack = CompilerState._complexMemoStack;
  const lStack = CompilerState._elementLaneMemoStack;
  const parent = cStack[cStack.length - 1];
  const laneParent = lStack[lStack.length - 1];
  let byKey = _keyedMemoLayers.get(parent);
  if (byKey === undefined) {
    byKey = new Map();
    _keyedMemoLayers.set(parent, byKey);
  }
  let entry = byKey.get(key);
  if (entry === undefined || entry.laneParent !== laneParent) {
    entry = { complex: new WeakMap(), lane: new WeakMap(), laneParent };
    byKey.set(key, entry);
  }
  cStack.push(entry.complex);
  lStack.push(entry.lane);
  return entry.complex;
}

/**
 * Leave a context entered with `_pushKeyedComplexMemoLayer`. When the
 * layer was replaced while the context was live (`_resetComplexMemoTop`),
 * its answers no longer describe the context: forget it, so that the next
 * entry starts with an empty layer.
 */
export function _popKeyedComplexMemoLayer(
  key: string,
  pushed: WeakMap<object, boolean>
): void {
  const cStack = CompilerState._complexMemoStack;
  if (cStack[cStack.length - 1] !== pushed && cStack.length > 1)
    _keyedMemoLayers.get(cStack[cStack.length - 2])?.delete(key);
  _popComplexMemoLayer();
}

/**
 * Leave a lexical context, restoring the enclosing layer. The guard resets
 * rather than underflows if an unbalanced pop ever slips through — stale
 * reuse is the failure mode that matters, an empty memo is merely slow.
 */
export function _popComplexMemoLayer(): void {
  CompilerState._complexMemoStack.pop();
  if (CompilerState._complexMemoStack.length === 0)
    CompilerState._complexMemoStack = [new WeakMap()];
  CompilerState._elementLaneMemoStack.pop();
  if (CompilerState._elementLaneMemoStack.length === 0)
    CompilerState._elementLaneMemoStack = [new WeakMap()];
}

/**
 * Run `fn` with a binder's bound names masked, so that a body analysis
 * inside it agrees with the analysis the binder's own callers see. Used both
 * by `isComplexValued` and by the `Sum`/`Product` emitter — if the emitter
 * decided a body was complex while a caller decided the binder was real, the
 * caller would consume a `{re, im}` object as a number (NaN everywhere).
 */
export function withBinderMask<T>(
  binder: {
    real: ReadonlyArray<string>;
    shielded: ReadonlyArray<string>;
    /** Names bound COMPLEX for the duration (a complex-lane parameter). */
    complex?: ReadonlyArray<string>;
    /** Loop indices bound COMPLEX for the duration: their elements are
     * complex-valued, and may be collections, so no scalar fact is
     * recorded for them. */
    loopComplex?: ReadonlyArray<string>;
  },
  fn: () => T
): T {
  const frame = new Map<string, boolean>();
  for (const n of binder.real) frame.set(n, false);
  for (const n of binder.loopComplex ?? []) frame.set(n, true);
  // A complex-lane name is a scalar complex object (the lane is granted
  // only for a provably scalar argument): record the SCALAR fact in the
  // vector frame as well, so a nested user call inside the analyzed body
  // grants the same lane the emitter will (`provablyScalarOrFramedScalar`).
  // The vector frame is pushed only when there is something to enter, so
  // every pre-existing mask leaves `_localVector` untouched.
  const vector = new Map<string, number>();
  for (const n of binder.complex ?? []) {
    frame.set(n, true);
    vector.set(n, LOCAL_SCALAR);
  }
  CompilerState._localComplex.push(frame);
  if (vector.size > 0) CompilerState._localVector.push(vector);
  CompilerState._binderShield.push(new Set(binder.shielded));
  // The mask is the whole context this function adds, so its names are
  // the key of the memo layer.
  const memoKey = JSON.stringify([
    binder.real,
    binder.shielded,
    binder.complex ?? [],
    binder.loopComplex ?? [],
  ]);
  const memoLayer = _pushKeyedComplexMemoLayer(memoKey);
  // A binder analyzed INSIDE an unrolled term must not read that term's
  // index value for a name it binds itself — the analysis and the emission
  // would then describe different values. See
  // `_enterUnrolledIndexBinder`, which lets the unrolled clause's own
  // index through and masks every deeper binder of the same name.
  const rebound = _enterUnrolledIndexBinder([
    ...binder.real,
    ...binder.shielded,
    ...(binder.complex ?? []),
  ]);
  try {
    return fn();
  } finally {
    _exitUnrolledIndexBinder(rebound);
    CompilerState._binderShield.pop();
    if (vector.size > 0) CompilerState._localVector.pop();
    CompilerState._localComplex.pop();
    _popKeyedComplexMemoLayer(memoKey, memoLayer);
  }
}

/** `_localVector`: every binding seen so far was a scalar. */
export const LOCAL_SCALAR = -1;
