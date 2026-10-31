// Hoisting of folded values and constant list literals, seeded draws, and the
// fold-size checks.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { javascriptStatements } from './javascript-statements.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { rewriteAngularUnit } from './angular-unit.js';
import type { CompileTarget, TargetSource } from './types.js';
import { isCallerMapped, isCseAdmissible } from './cse.js';
import { hasDeclaredEffectLabel } from '../../common/type/effects.js';
import { effectsOf } from '../boxed-expression/effects-of.js';
import {
  foldCapturedName,
  foldValueImpure,
  inlineFoldTarget,
} from './compile-folding.js';
import { core } from './compiler-core-hooks.js';
import {
  FOLD_CHARS_PER_NODE,
  FOLD_OPERAND_PREC,
  MAX_FOLD_EXPANDED_NODES,
  memoFor,
} from './compiler-tables.js';
import {
  cseAdmission,
  registryLocalName,
  withNestedCseHarvest,
} from './compile-cse.js';
import {
  promotedDefinitions,
  withPromotionUnsuppressed,
} from './compiler-mode.js';
import { CompilerState } from './compiler-state.js';
import { hoistedListLiteralText } from './compile-linear-algebra.js';
import { removeDefinitionsAddedSince } from './compile-definitions.js';
import { reachesExcludedName } from './compiler-names.js';

/**
 * If `id` names a symbol that is *known* to the engine — it has an assigned
 * value (`ce.assign("a", 1.5)`) or is a declared constant — return the
 * compiled target code for that value, i.e. **fold** the value into the
 * generated code the way `evaluate()` does. Returns `undefined` for a
 * genuinely free symbol (no value), so the caller falls back to its
 * free-symbol plumbing (a `vars` mapping, a `_.id` argument lookup, or a
 * declarable identifier).
 *
 * This keeps the compiled output consistent with `expr.unknowns` and
 * `evaluate()`: a symbol they treat as known (folded / dropped) is also
 * folded by `compile()`, instead of being emitted as a bare, dangling
 * reference (an undeclared GLSL identifier, or a bare JS global that throws
 * `ReferenceError` at run time).
 *
 * Callers MUST resolve any `vars` mapping for `id` **before** calling this,
 * so an explicitly `vars`-mapped symbol is never folded — the GPU/JS live
 * path relies on a mapped symbol staying a per-frame uniform / argument.
 *
 * `target` is the in-flight target: nested symbols inside the value resolve
 * through the same `vars`/constant/fold rules as the top-level expression.
 *
 * The value is compiled at a high precedence so a compound (operator) value
 * self-parenthesizes: folding `b = c + 1` into `b * x` must yield
 * `(c + 1) * x`, not `c + 1 * x`, and must stay safe when a handler splices
 * the folded string into its own expression (e.g. `Power`'s `(code * code)`).
 * An atomic value (number, symbol, function call) ignores the precedence, so
 * no redundant parentheses are added in the common assigned-number case.
 */
export function tryFoldKnownSymbol(
  engine: ComputeEngine,
  id: string,
  target: CompileTarget<Expression>
): string | undefined {
  const stored = engine._getSymbolValue(id);
  if (stored === undefined) return undefined;
  assertFoldableSize(engine, id, stored, target);
  // The compiled expression is in the radian convention: the compile entry
  // rewrote it for the engine's angular unit (`rewriteAngularUnit()`). The
  // stored value was not rewritten, so it is rewritten here, alone: in
  // degree mode `c := sin(x)` compiles to the sine of `x` degrees, as
  // `evaluate()` computes it, and the code around `c` is not converted a
  // second time.
  const value = foldedValueInRadians(stored, target);
  // The generated code bakes this symbol's current value: record it in the
  // capture set (see `CompileTarget.symbolDeps`). Nested symbols inside the
  // value are recorded by the recursive compile below.
  target.symbolDeps?.add(id);
  const binds = bindsFoldedValue(target, value);
  // A name the value mentions that is bound where the value would be
  // written denotes the binder there, not what it denoted when the value
  // was stored. No lowering on this target can move the value out of that
  // binder, so the compile fails closed rather than answering the binder's
  // value (see `foldCapturedName`).
  const captured = foldCapturedName(target, value, binds);
  if (captured !== undefined) throw new Error(foldCaptureRefusal(id, captured));
  if (binds) return ensureFoldedValueEmitted(id, value, target);
  // The inline fold of a value that mentions its own symbol (`a := a + 1`,
  // storable in raw form) would recurse without end. Refuse it the same way
  // the bound route does.
  const inProgress = _inlineFoldInProgress;
  if (inProgress.has(id)) throw new Error(selfReferenceRefusal(id));
  inProgress.add(id);
  try {
    // The value compiles with the promotion in force where the symbol is
    // read: inside the value of a real ascription (`p: (real) -> real`
    // reading `a := √(c − 1)`), promotion is off for the value too, as for
    // the rest of the body, and the radical is `NaN` outside its real
    // domain. `isComplexValued` reads the value of a symbol the same way.
    // (ROADMAP CE-230.2.)
    return core.compile(
      value,
      inlineFoldTarget(target, value),
      FOLD_OPERAND_PREC
    );
  } finally {
    inProgress.delete(id);
  }
}

/**
 * The stored value `value` of a symbol, rewritten for the engine's angular
 * unit (`rewriteAngularUnit()`), with the exact factors on the
 * `interval-javascript` target, as at the compile entry of that target.
 * `value` itself in radian mode. The rewrite of each value is kept for its
 * unit and factor kind, so a value read at many places is rewritten once.
 */
export function foldedValueInRadians(
  value: Expression,
  target: CompileTarget<Expression>
): Expression {
  const unit = value.engine.angularUnit;
  if (unit === 'rad') return value;
  const exactFactors = target.language === 'interval-javascript';
  const key = `${unit}:${exactFactors}`;
  let byKey = _radianValues.get(value);
  if (byKey === undefined) _radianValues.set(value, (byKey = new Map()));
  let rewritten = byKey.get(key);
  if (rewritten === undefined) {
    rewritten = rewriteAngularUnit(value, { exactFactors });
    byKey.set(key, rewritten);
  }
  return rewritten;
}

/** The rewrites of `foldedValueInRadians`, by stored value. */
export const _radianValues = new WeakMap<Expression, Map<string, Expression>>();

/** Symbols whose value `tryFoldKnownSymbol` is currently folding INLINE. */
export const _inlineFoldInProgress = new Set<string>();

/**
 * The fail-closed message for a value whose name `name` would be captured
 * by a binder of the position the value is emitted into.
 */
export function foldCaptureRefusal(id: string, name: string): string {
  return (
    `Could not compile \`${id}\`: the value assigned to this symbol mentions \`${name}\`, which ` +
    `a parameter or index binds where the value would be emitted, and ` +
    `this target cannot place the value outside that binder. The value ` +
    `would read the binder instead of the \`${name}\` it was written ` +
    `against.`
  );
}

/** The fail-closed message for a value that refers to its own symbol. */
export function selfReferenceRefusal(id: string): string {
  return (
    `Could not compile \`${id}\`: the value assigned to this symbol refers to itself, so it ` +
    `cannot be compiled.`
  );
}

/**
 * Would the emitter bind `value` (a symbol's assigned value) once as a
 * shared preamble local when it is requested from a position whose bound
 * names are `bound`, on `target`? When not, the value is folded inline at
 * that position.
 *
 * Three conditions. The target must own the default (JavaScript arrow)
 * user-function registry: the emitted definitions land in the same
 * preamble as `_fn_*`, inside the wrapper that receives the vars object, so
 * a value that reads `_.x` resolves there. A registry with its own
 * `lowering` (the shader targets) declares statically typed functions and
 * has no place for an untyped value binding, so it keeps the inline fold.
 *
 * The value must be worth sharing and safe to share: an application — a
 * leaf (number, symbol, string) is no shorter as a name than as itself —
 * that is pure THROUGH every assigned value it reaches
 * (`foldValueImpure`): a preamble local is evaluated once per call of the
 * compiled function, so `a := r + r` with `r := Random()` bound once would
 * draw two samples where the interpreter draws two at EVERY reference. And
 * a collection-shaped value stays inline when the compile carries
 * caller-supplied functions, which may keep or mutate an array they are
 * handed (see the gate below).
 *
 * The names the requesting position binds do NOT hold the value back.
 * Ruled 2026-09-21: a stored symbol value keeps the binding it was written
 * against, so no parameter of an emitted function and no binder index the
 * value sits under may rebind one of its names. The value is emitted once
 * in the scope of the target that owns the preamble
 * (`userFunctions.valueRoot`, else `root`), which is exactly the
 * environment the interpreter reads it in. With `a := 3t + 1` and
 * `g := t ↦ t + a`, `g(2)` answers `3t + 3` for the global `t`; folding
 * the value inline in the body of the emitted `_fn_g` let the parameter
 * `t` capture it and answered `9`. The same decision makes
 * `Sum(a, n, 1, 3)` with `a := n + 1` read the global `n` in both routes.
 */
export function bindsFoldedValue(
  target: CompileTarget<Expression>,
  value: Expression
): boolean {
  const registry = target.userFunctions;
  if (!registry || registry.lowering !== undefined) return false;
  if (!isFunction(value) || foldValueImpure(value)) return false;
  // A caller-supplied function (`functions` option; its names are
  // `foldExcludedOps`) receives an array itself and may keep or mutate it,
  // and the compiler never optimizes around such a call: every reference
  // must hand it a fresh array, as the inline fold does. A scalar has no
  // identity, so only a collection-shaped value is held back.
  if (
    target.foldExcludedOps !== undefined &&
    target.foldExcludedOps.size > 0 &&
    isSubtype(value.type.type, COLLECTION_SHAPE_TYPE)
  )
    return false;
  return true;
}

/** The preamble local that holds the folded value of symbol `id`. */
export function foldedValueName(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  id: string
): string {
  return registryLocalName(registry, '_val_', id);
}

/**
 * Emit the folded value of `id` ONCE as a preamble local and return that
 * name. Shares the user-function registry's `defs` map, in insertion order:
 * the entry is written AFTER the value compiled, so every value or user
 * function it references (which the compile below emitted) precedes it in
 * the preamble. This is what makes a value that references another symbol
 * value from several places — a tower `f_{k} := f_{k-1} + 2 f_{k-1}` — emit
 * linear source: each level is written once and read by name.
 *
 * The value compiles against the target that owns the preamble
 * (`userFunctions.valueRoot` — the lambda's own target on the
 * `Function`-literal route, whose definitions sit inside the lambda body —
 * else `root`) with an isolated shape frame, like a user-function
 * definition: a requester's parameter shadowing, loop-index substitution or
 * complex-lane frame must not reach it.
 *
 * A value whose compile re-enters its own binding (`a := a + 1`) would emit
 * `const _val_a = _val_a + 1`, a temporal-dead-zone throw at run time.
 * Neither the interpreter nor the inline fold can evaluate such a value, so
 * this fails closed at compile time.
 */
export function ensureFoldedValueEmitted(
  id: string,
  value: Expression,
  target: CompileTarget<Expression>
): string {
  const registry = target.userFunctions!;
  // Inside the value of a real ascription (promotion off), a value that is
  // complex only by the promotion of the mode gets its own local, compiled
  // with promotion off, as the rest of the body is: `p: (real) -> real`
  // reading `a := √(c − 1)` reads `Math.sqrt(c - 1)`, `NaN` for `c < 1`.
  // The shared local keeps the promotion of the mode for every other
  // reader. (ROADMAP CE-230.2.)
  const realVariant =
    CompilerState._promotionSuppressed > 0 &&
    !core.isComplexValued(value) &&
    withPromotionUnsuppressed(() => core.isComplexValued(value));
  const name = foldedValueName(registry, id) + (realVariant ? '$r' : '');
  if (registry.defs.has(name)) return name;
  if (registry.compiling.has(name)) throw new Error(selfReferenceRefusal(id));
  // The definitions stored while this one compiles may call it by name
  // (a re-entrant reference, see below); when its emission fails they
  // are removed, so that no definition keeps a call of a name that is
  // never emitted.
  const definedBefore = new Set(registry.defs.keys());
  registry.compiling.add(name);
  // A promotion recorded while the value compiles belongs to the preamble
  // local, not to the definition or the code that emits it first: the
  // local is shared by every reference, and it stays in the emitted code
  // when that first definition is removed as unreferenced
  // (`pruneUnreferencedVariantBases`). So it is recorded under the name of
  // the local (`promotedDefinitions`), and the report counts it while the
  // local is in `defs`. The code that emits the local also reads its
  // promoted value, so the promotion is added to the record of that code
  // too.
  const outerPromoted = CompilerState._promoted;
  CompilerState._promoted = false;
  let valuePromoted = false;
  try {
    const root = registry.valueRoot ?? registry.root ?? target;
    // The shared preamble local is read by every reference: it compiles
    // with the promotion of the compile mode, also when the reference is
    // in the value of a real ascription (see `withPromotionUnsuppressed`).
    // The real variant (above) keeps promotion off.
    const emit = () =>
      withNestedCseHarvest(value, root, [], () => core.compile(value, root));
    const compiled = core.withLocalShapeFrame(
      new Map(),
      new Map(),
      () => (realVariant ? emit() : withPromotionUnsuppressed(emit)),
      true
    );
    // A value that is a constant list literal — written as one, or a
    // constant collection the fold materialized as one — compiles to the
    // name of a hoisted local (`hoistConstantListLiteral`). This local
    // holds the literal itself rather than an alias of that one; the
    // hoisted local is then unread and removed
    // (`pruneUnreferencedVariantBases`), unless another site reads it.
    const code = hoistedListLiteralText(root, compiled);
    registry.defs.set(
      name,
      javascriptStatements(root)?.initialize(name, code) ??
        `const ${name} = ${code};`
    );
    valuePromoted = CompilerState._promoted;
    if (valuePromoted) memoFor(promotedDefinitions, registry).set(name, true);
    // A value emitted from the compiler's own lowerings only — no
    // caller-supplied source, no string-valued `vars` mapping, both of
    // which splice live source — is the same on every call unless it reads
    // a per-call binding, and the runner may evaluate it once per artifact
    // (`userFunctions.hoistable`). The admissibility walk is the one CSE
    // uses to decide whether a subtree may be emitted once and read by
    // name; `undefined` options (no compilation opened a session) fail
    // closed.
    const admission = cseAdmission(root, new Set());
    if (admission !== undefined && isCseAdmissible(value, admission))
      (registry.hoistable ??= new Set()).add(name);
  } catch (e) {
    removeDefinitionsAddedSince(registry, definedBefore);
    throw e;
  } finally {
    registry.compiling.delete(name);
    CompilerState._promoted = outerPromoted || valuePromoted;
  }
  return name;
}

/**
 * Number count from which a constant list literal is emitted once as a
 * preamble local (`hoistConstantListLiteral`) instead of inline, counted
 * over every nesting level (a matrix of two rows of three numbers holds
 * six). A one- or two-number literal is cheaper to build than a name is to
 * read in the code that reads it, and keeps the emitted code readable;
 * above this the per-call allocation is the measurable cost.
 */
export const HOISTED_LIST_LITERAL_MIN_LENGTH = 3;

/**
 * Emit a constant list literal ONCE as a preamble local and return the
 * local's name, or `undefined` when the literal must stay inline.
 *
 * A `List` whose elements are all finite real number literals, or such
 * lists nested to any depth, is the same array on every call. Emitted
 * inline, it is allocated again on every call of the compiled function: a
 * plot row that read one cell of a 9 801-number literal per sample spent
 * the whole of its paint building the literal, where the same list
 * assigned to a symbol was read from a local the runner evaluates once
 * (`ensureFoldedValueEmitted`). This gives the literal the same treatment.
 *
 * The conditions are those of `bindsFoldedValue`. The target must own the
 * default user-function registry, with no `lowering` of its own: the local
 * lands in the preamble next to `_fn_*` and `_val_*`. The compile must
 * carry no caller-supplied functions (`foldExcludedOps`): such a function
 * receives the array itself and may keep or mutate it, so every reference
 * must hand it a fresh array, which the inline literal does. A literal
 * with fewer than `HOISTED_LIST_LITERAL_MIN_LENGTH` numbers stays inline.
 *
 * A lowering a host supplies through an operator definition's `compile`
 * hook is not covered by that guard: it receives the local's name as its
 * operand text, as it receives the name of a bound symbol value
 * (`_val_*`), and the code it emits must treat an array operand as
 * read-only. Every lowering of this compiler does (`Reverse` and `Sort`
 * copy first; a fold that updates its accumulator in place works on
 * `_SYS.ownedCopy`). The runner hands the array itself to the caller
 * (`normalizeRunResult` makes no copy): a result of compiled code is
 * read-only by contract, and a caller that writes to it changes what the
 * next call answers.
 *
 * The local is built from the compiler's own emission of number literals
 * only, so it reads no per-call binding and no caller-supplied source: it
 * is recorded on `userFunctions.hoistable` unconditionally, and the runner
 * evaluates it once per artifact. Two occurrences of the same literal, by
 * emitted text, read one local (`userFunctions.listLiterals`); the local's
 * id comes from a counter that never goes back, so a literal removed by an
 * abandoned compilation (`removeDefinitionsAddedSince`) is never confused
 * with a later one. A number literal is emitted the same way on the real
 * and on the complex lane (the parent lifts a real operand where it needs
 * `{re, im}`), so the local is correct for every reference.
 */
export function hoistConstantListLiteral(
  target: CompileTarget<Expression>,
  elements: ReadonlyArray<Expression>
): string | undefined {
  const registry = target.userFunctions;
  if (!registry || registry.lowering !== undefined) return undefined;
  if (target.foldExcludedOps !== undefined && target.foldExcludedOps.size > 0)
    return undefined;
  const root = registry.valueRoot ?? registry.root ?? target;
  const literal = constantListLiteral(elements, root);
  if (
    literal === undefined ||
    literal.numbers < HOISTED_LIST_LITERAL_MIN_LENGTH
  )
    return undefined;
  const text = literal.text;
  const literals = (registry.listLiterals ??= new Map());
  const known = literals.get(text);
  if (known !== undefined) return known;
  registry.listLiteralCount = (registry.listLiteralCount ?? 0) + 1;
  const name = registryLocalName(
    registry,
    '_lit_',
    String(registry.listLiteralCount)
  );
  registry.defs.set(
    name,
    javascriptStatements(root)?.initialize(name, text) ??
      `const ${name} = ${text};`
  );
  (registry.hoistable ??= new Set()).add(name);
  literals.set(text, name);
  return name;
}

/**
 * Emit a seeded random draw (`WithRandomSeed(seed, body)`) that reads no
 * per-call value as a preamble local computed at most ONCE per compiled
 * artifact, and return the code that reads it; `undefined` when the draw
 * must stay inline.
 *
 * Inside a `WithRandomSeed` frame every draw is the counter-based hash of
 * the seed and the draw's position in the frame, and a nested frame does
 * not change the counter of its parent (`withRandomSeedFrame`). So when
 * the seed and the body read no input, no binder index and no
 * caller-supplied source, the value is a pure function of the seed: the
 * same on every call. Emitted inline, it was drawn again on every call: a
 * plot that indexed one cell of `RandomChoice([0, 1], 6561)` per sample
 * drew the 6 561 numbers on every sample, over 100 times the cost of a
 * `sin` call. An unseeded draw never reaches this function and stays per
 * call.
 *
 * The local holds a function that computes the value on its first call
 * and returns the stored value after that. The draw is computed only when
 * the code reaches it, as the inline form does: a draw in a branch that is
 * not taken costs nothing, and an error it raises is raised at that
 * point, not when the runner is built. The local is recorded on
 * `userFunctions.hoistable`, so the runner builds it once per artifact
 * (`splitPreambleDefs`); if its text still reads a per-call binding, the
 * split keeps it per call, where it computes the draw on each call as the
 * inline form does.
 *
 * The draw stays inline when:
 * - the target does not own the default user-function registry, or the
 *   compile carries caller-supplied functions (`foldExcludedOps`), as for
 *   `hoistConstantListLiteral`;
 * - an operand has a free symbol (`unknowns`), names a symbol that an
 *   enclosing binder binds (`boundVars`) or a `vars` key, or reaches one
 *   of those through an assigned value or a user function
 *   (`reachesExcludedName`);
 * - an operand holds a caller-mapped operator or a string-valued `vars`
 *   symbol, which splice live source, or the compilation recorded no
 *   provenance predicates to check this against (`cseAdmission`);
 * - the seed has the `random` effect (`WithRandomSeed(Random(), body)`):
 *   it takes a fresh ambient draw on each call;
 * - the emitted text reads the vars object, calls a definition that runs
 *   per call (a user function), or calls a compiled integral, whose
 *   Monte-Carlo samples are live inside a seeded frame too.
 *
 * Each operand compiles under its own nested CSE harvest
 * (`withNestedCseHarvest`), so the text never reads a temporary that an
 * enclosing region binds in the per-call code.
 *
 * Provenance: Tycho ledger row 399 (2026-10-19).
 */
export function hoistSeededDraw(
  target: CompileTarget<Expression>,
  operands: ReadonlyArray<Expression>,
  compile: (expr: Expression) => TargetSource,
  emit: (codes: ReadonlyArray<TargetSource>) => TargetSource
): TargetSource | undefined {
  const registry = target.userFunctions;
  if (!registry || registry.lowering !== undefined) return undefined;
  if (target.foldExcludedOps !== undefined && target.foldExcludedOps.size > 0)
    return undefined;
  const root = registry.valueRoot ?? registry.root ?? target;
  const options = cseAdmission(root, new Set());
  if (options === undefined) return undefined;
  const bound = target.boundVars;
  const vars = target.varsKeys;
  const closed = (e: Expression): boolean => {
    if (isSymbol(e))
      return (
        bound?.has(e.symbol) !== true &&
        vars?.has(e.symbol) !== true &&
        options.isStringVar?.(e.symbol) !== true
      );
    if (isDictionary(e)) return e.values.every(closed);
    if (isFunction(e))
      return !isCallerMapped(e, options) && e.ops.every(closed);
    return true;
  };
  if (
    operands.some(
      (e) =>
        e.unknowns.length > 0 || !closed(e) || reachesExcludedName(e, target)
    )
  )
    return undefined;
  // The seed is evaluated in the enclosing frame, before the seeded frame
  // starts. A seed that draws (`WithRandomSeed(Random(), body)`) takes a
  // fresh ambient draw on each evaluation, so the value of the frame is
  // different on each call and must not be computed only once.
  if (
    operands.length > 0 &&
    hasDeclaredEffectLabel(effectsOf(operands[0]), 'random')
  )
    return undefined;
  // The operands are compiled once here, to test the emitted text. When the
  // test refuses the hoist, the caller compiles them again, so the
  // definitions that this compilation added to the registry (a nested
  // seeded draw, a user function) are removed first: kept, they would be
  // dead code in the preamble, next to the ones the second compilation
  // adds.
  const definedBefore = new Set(registry.defs.keys());
  const seededDrawCountBefore = registry.seededDrawCount;
  const refuse = (): undefined => {
    removeDefinitionsAddedSince(registry, definedBefore);
    registry.seededDrawCount = seededDrawCountBefore;
    return undefined;
  };
  const text = emit(
    operands.map((e) => withNestedCseHarvest(e, target, [], () => compile(e)))
  );
  if (/_SYS\.integrate/.test(text)) return refuse();
  const varsObject = root.varsObjectName;
  if (
    varsObject !== undefined &&
    new RegExp(
      `(?<![\\w$.])${varsObject.replace(/[$]/g, '\\$&')}\\.(?=[\\p{L}_$])`,
      'u'
    ).test(text)
  )
    return refuse();
  for (const name of registry.defs.keys())
    if (
      registry.hoistable?.has(name) !== true &&
      identifierPattern(name).test(text)
    )
      return refuse();
  registry.seededDrawCount = (registry.seededDrawCount ?? 0) + 1;
  const name = registryLocalName(
    registry,
    '_rnd_',
    String(registry.seededDrawCount)
  );
  const value = `${name}$v`;
  const done = `${name}$done`;
  const thunk =
    `(() => { let ${value}, ${done} = false; ` +
    `return () => ${done} ? ${value} : (${value} = ${text}, ${done} = true, ${value}); })()`;
  registry.defs.set(
    name,
    javascriptStatements(root)?.initialize(name, thunk) ??
      `const ${name} = ${thunk};`
  );
  (registry.hoistable ??= new Set()).add(name);
  return `${name}()`;
}

/**
 * The emitted text of a list literal whose elements are all finite real
 * number literals or such lists, compiled against `root`, with the count
 * of numbers over every nesting level; `undefined` when an element is
 * anything else (a symbol, an application, a complex or non-finite
 * number).
 */
export function constantListLiteral(
  elements: ReadonlyArray<Expression>,
  root: CompileTarget<Expression>
): { text: string; numbers: number } | undefined {
  const parts: string[] = [];
  let numbers = 0;
  for (const x of elements) {
    if (isNumber(x)) {
      if (x.im !== 0 || !Number.isFinite(x.re)) return undefined;
      parts.push(core.compile(x, root));
      numbers += 1;
    } else if (isFunction(x, 'List')) {
      const inner = constantListLiteral(x.ops, root);
      if (inner === undefined) return undefined;
      parts.push(inner.text);
      numbers += inner.numbers;
    } else return undefined;
  }
  return { text: `[${parts.join(', ')}]`, numbers };
}

/**
 * Number of nodes the generated source would contain if `value` were folded
 * in — the EXPANDED count, which charges a shared sub-value once per path
 * that reaches it, because that is how many times the emitter writes it out.
 *
 * The walk itself stays linear in the number of DISTINCT nodes: each node
 * object's expanded size is computed once and memoized under its own
 * identity, so the tower whose emission quadruples per level is sized in a
 * few dozen steps rather than by enumerating billions of paths. A symbol is
 * charged the size of the value the emitter would fold in its place, which
 * is where the per-path multiplication comes from; a name the target has
 * already bound (a parameter, a loop index) or that the caller supplied
 * through `vars` is a run-time variable, not a fold, and counts as one node.
 *
 * A value that refers to itself (`a := a + 1`, which the emitter cannot
 * compile either) would make the walk non-terminating, so a node currently
 * being sized counts as one node when it is re-entered.
 *
 * Children not reachable through `ops` (a dictionary's values) are followed
 * explicitly. An application's operator HEAD is deliberately not charged: a
 * head is either a target primitive or a user function the emitter declares
 * ONCE as a shared local, so it does not multiply along paths. Anything else
 * counts as a leaf, which can only make the count an underestimate — never
 * an overestimate that would refuse a legitimate fold.
 *
 * On a target that binds folded values (`bindsFoldedValue`), the walk
 * charges what that emitter writes instead: a symbol whose value binds at
 * the position where it is met counts as one node — the name read — and
 * its value is charged ONCE per symbol, the first time, since the preamble
 * holds a single copy per symbol (two symbols assigned the same value
 * object are two locals). The walk still carries the bound names down
 * through binder nodes and memoizes per (bound-name set, node), because a
 * BOUND name is a run-time variable rather than a fold and costs one node
 * wherever it is met; since 2026-09-21 the bind decision itself no longer
 * depends on them (`bindsFoldedValue`).
 */
export function expandedFoldSize(
  engine: ComputeEngine,
  value: Expression,
  target: CompileTarget<Expression>
): number {
  type Bound = ReadonlySet<string> | undefined;
  // Memoized per bound-name ENVIRONMENT, keyed by the names it binds rather
  // than by the set object: every binder node builds its own set
  // (`binderBoundNames`), so two `Sum` nodes binding the same index would
  // otherwise size the sub-value beneath them twice, and a tower of binders
  // once per path. The preamble owner's own environment keeps a key of its
  // own: `bindsFoldedValue` answers differently there (it recognizes that
  // set by identity), so a nested frame binding the same names must not
  // share its memo.
  const ownerBound = (
    target.userFunctions?.valueRoot ?? target.userFunctions?.root
  )?.boundVars;
  const memos = new Map<string, Map<Expression, number>>();
  const boundKeys = new Map<Bound, string>();
  const keyOf = (bound: Bound): string => {
    let key = boundKeys.get(bound);
    if (key === undefined) {
      const names = bound === undefined ? [] : [...bound].sort();
      key = `${bound === ownerBound ? 'owner' : 'inner'}:${JSON.stringify(names)}`;
      boundKeys.set(bound, key);
    }
    return key;
  };
  const inProgress = new Set<Expression>();
  // Values the preamble would hold once, by symbol; their sizes accumulate
  // here.
  const boundOnce = new Set<string>();
  let boundTotal = 0;

  const walk = (node: Expression, bound: Bound): number => {
    const key = keyOf(bound);
    let memo = memos.get(key);
    if (memo === undefined) memos.set(key, (memo = new Map()));
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    if (inProgress.has(node)) return 1;
    inProgress.add(node);
    let size = 1;
    if (isSymbol(node)) {
      const s = node.symbol;
      if (bound?.has(s) !== true && target.varsKeys?.has(s) !== true) {
        const v = engine._getSymbolValue(s);
        if (v !== undefined) {
          if (bindsFoldedValue(target, v)) {
            if (!boundOnce.has(s)) {
              boundOnce.add(s);
              // The bound value compiles in the preamble owner's scope.
              boundTotal += walk(
                v,
                (target.userFunctions?.valueRoot ?? target.userFunctions?.root)
                  ?.boundVars
              );
            }
          } else size = walk(v, bound);
        }
      }
    } else if (isDictionary(node)) {
      for (const v of node.values) size += walk(v, bound);
    } else if (isFunction(node)) {
      const inner = binderBoundNames(node, bound);
      for (const op of node.ops) size += walk(op, inner);
    }
    inProgress.delete(node);
    memo.set(node, size);
    return size;
  };

  return walk(value, target.boundVars) + boundTotal;
}

/**
 * The bound-name set in effect INSIDE `node`, given the set `bound` in
 * effect around it: unchanged for an ordinary application; for a `Function`
 * literal, extended with its parameter names; for an operator whose
 * definition binds names (`scoped` — `Sum`, `Product`, `Integrate`, …),
 * extended with every symbol spelled in its operands after the body, which
 * is where the index and its bounds live. Over-collecting there (an upper
 * bound that is itself a symbol) only makes `expandedFoldSize` treat a
 * nested reference as inline, never as cheaper than it is.
 */
export function binderBoundNames(
  node: Expression & FunctionInterface,
  bound: ReadonlySet<string> | undefined
): ReadonlySet<string> | undefined {
  const isLiteral = node.operator === 'Function';
  if (!isLiteral && !node.operatorDefinition?.scoped) return bound;
  // The operands are walked once per DISTINCT node. A boxed expression is a
  // DAG — a value built from one sub-expression referenced twice holds the
  // same object twice — and walking it as a tree visits a shared node once
  // per path. A bound such as `Range(1, Length(T))` over a 30-level tower of
  // shared tuples has a billion paths; the unguarded walk pushed every
  // symbol occurrence onto an array until `Array.push` threw
  // `Invalid array length` past 2^32 entries, minutes and gigabytes later
  // (Tycho item 225). A set of names, and a set of visited nodes, keep the
  // walk linear.
  const names = new Set<string>();
  const seen = new Set<Expression>();
  const collect = (e: Expression): void => {
    if (isSymbol(e)) names.add(e.symbol);
    else if (isFunction(e)) {
      if (seen.has(e)) return;
      seen.add(e);
      for (const op of e.ops) collect(op);
    }
  };
  for (const op of node.ops.slice(1)) collect(op);
  if (names.size === 0) return bound;
  // A binder that names anything is a NEW lexical frame, even when every
  // name it binds is already bound outside — exactly as the emitter builds
  // its frames (`withBoundNames`). `bindsFoldedValue` recognizes the
  // preamble owner's environment by the identity of its set, so returning
  // the inherited set for a shadowing binder would let the size walk count
  // a value as bound once where the emitter, seeing a fresh frame, inlines
  // it per path.
  const out = new Set(bound);
  for (const n of names) out.add(n);
  return out;
}

/**
 * Refuse to fold `id`'s assigned value when baking it would emit more than
 * `MAX_FOLD_EXPANDED_NODES` nodes of source.
 *
 * This fails CLOSED rather than declining, because a decline is not safe
 * here: when `tryFoldKnownSymbol` returns `undefined` the caller emits a
 * bare identifier for a symbol the engine knows, and the JavaScript target
 * deliberately leaves such a name unresolved — the artifact would carry a
 * dangling global that throws (or silently reads `undefined`) at run time.
 * Refusing at compile time is the honest answer: on the public `compile()`
 * route the default `fallback: true` turns it into interpreter-backed
 * evaluation, which is correct though slower, and a caller that asked for
 * `fallback: false` (or drove a registered target directly) sees the error.
 */
export function assertFoldableSize(
  engine: ComputeEngine,
  id: string,
  value: Expression,
  target: CompileTarget<Expression>
): void {
  const size = expandedFoldSize(engine, value, target);
  if (size <= MAX_FOLD_EXPANDED_NODES) return;
  const kb = (size * FOLD_CHARS_PER_NODE) / 1024;
  const emitted =
    kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  // On a target that binds each folded value once, the count IS the
  // program's size; on the others a shared sub-value is written out once
  // per reference path, which is what inflates it.
  const why = bindsFoldedValue(target, value)
    ? `even with every shared sub-value bound once as a preamble local`
    : `Generated source is text on this target, so a sub-value shared by ` +
      `several references is written out once per reference path`;
  throw new Error(
    `Could not compile \`${id}\`: the value assigned to this symbol expands to ` +
      `${size} nodes of generated source (an estimated ${emitted}) ` +
      `once baked in, above the fold-size limit of ` +
      `${MAX_FOLD_EXPANDED_NODES} nodes, ${why}; folding ` +
      `this value is refused rather than emitting a program that size. A ` +
      `caller using the default \`fallback: true\` falls back to ` +
      `interpreted evaluation.`
  );
}

/**
 * A pattern matching the identifier `name` as a whole word in emitted
 * source: not preceded by an identifier character or a `.` (a property of
 * the same name is not a reference), not followed by one.
 */
export function identifierPattern(name: string, flags = 'u'): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`, flags);
}
