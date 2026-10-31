// Whether a value is complex: element complexness, complex memo layers,
// unrolled index binders, local complexness and the complex-valued-function
// test.

import { shadowsLibraryName } from '../library-shadowing.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { finitePartOfType, isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { parseType } from '../../common/type/parse.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { functionLiteralBoundNames } from '../boxed-expression/function-literal.js';
import { tuplePatternNames } from '../boxed-expression/tuple-pattern.js';
import {
  jetDerivativeTarget,
  multiIndexDerivativeTooLarge,
} from './jet-derivative.js';
import { derivativeClosedForm } from './derivative-closed-form.js';
import {
  COMPLEX_CONTINUATION_HEADS,
  complexContinuation,
} from './complex-continuation.js';
import {
  LOCAL_SCALAR,
  _popComplexMemoLayer,
  collectionFoldsReal,
  complexDiscipline,
  foldsCollectionElements,
  promotionActive,
  unwrappedFunctionBody,
  userCallMask,
  withBinderMask,
} from './compile-declarations.js';
import {
  _broadcastRadicalVerdict,
  assumedRealNonNegative,
  knownExponentPower,
  realPowerExponent,
} from './compile-real-analysis.js';
import {
  _pushComplexMemoLayer,
  isRealOnlyLoweringHead,
  mode,
  notePromoted,
  wideIsComplex,
} from './compiler-mode.js';
import { CompilerState } from './compiler-state.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { core } from './compiler-core-hooks.js';
import {
  compilationType,
  isBoundPossiblyCollectionTyped,
} from './compiler-type-facts.js';
import {
  hasAnyComplexElement,
  laneMismatch,
  linearAlgebraLane,
  linearAlgebraLaneOperands,
  takesComplexResultLowering,
  typeHasComplexLeaf,
  unrolledBigOpLaneHook,
  userCallLane,
} from './compile-lanes.js';
import {
  BUILTIN_FOLD_HEADS,
  COMPLEX_PROPAGATING_HEADS,
  NO_NAMES,
  REAL_BY_DEFINITION_HEADS,
} from './compiler-tables.js';
import {
  _popLocalComplex,
  _pushLocalComplex,
  elementBinderLane,
} from './compile-loops.js';
import { liveSelectionArms } from './compile-conditions.js';
import { isGatherIndex } from './compiler-names.js';
import {
  combinerPlan,
  foldLaneIsComplex,
  uniformElementComplexness,
  withDerivativeArgument,
} from './compile-callbacks.js';

/**
 * Whether `head(...args)` takes the complex lane on account of its VALUE:
 * the operands are real but the interpreter's kernel continues the head
 * into the complex plane (`LerchPhi(z, s, a)` for `z > 1`), and the facts
 * on the operands do not prove the value real
 * (`complexContinuation`). `auto` and `complex` promote, as for `Sqrt` and
 * `Ln` of an operand of unknown sign; `strict` keeps the real lane and its
 * `NaN`. A complex operand is not decided here: the head's complex kernel
 * takes it in every mode.
 *
 * `isComplexValued` and the emitters of these heads both read this, so a
 * parent and its child agree on the shape of the value.
 */
export function continuesToComplex(
  head: MathJsonSymbol,
  args: ReadonlyArray<Expression>
): boolean {
  if (!COMPLEX_CONTINUATION_HEADS.has(head)) return false;
  if (!promotionActive()) return false;
  // A broadcast closure re-asks with element temps that carry no facts;
  // the verdict of the node-level operands stands (see
  // `promotesRadicalToComplex`).
  for (let i = _broadcastRadicalVerdict.length - 1; i >= 0; i--) {
    const frame = _broadcastRadicalVerdict[i];
    if (
      frame.head === head &&
      args.length > 0 &&
      args.every(
        (a) => a !== undefined && isSymbol(a) && frame.params.has(a.symbol)
      )
    )
      return frame.promotes;
  }
  const lane = complexContinuation(head, args);
  if (lane === 'real') return false;
  if (lane === 'unknown') notePromoted();
  return true;
}

/** Does the target in progress lower the continuation heads on the
 * complex lane (the JavaScript target)? */
export function hasComplexContinuationLowering(): boolean {
  return CompilerState._callSiteTarget?.language === 'javascript';
}

/**
 * A user function's body reduced to the literal collection CONSTRUCTOR it
 * builds, so that operand k of the result is component k of the value the
 * call produces. Returns `undefined` when the body is anything else, and the
 * caller then declines to answer for an individual element.
 *
 * Used by {@link withCollectionElements}, whose whole premise is that the
 * emitter lowers component k from operand k — so only constructors with that
 * one-to-one correspondence may be returned here.
 */
export function collectionConstructorBody(
  body: Expression | undefined
): (Expression & { ops: ReadonlyArray<Expression> }) | undefined {
  let e = unwrappedFunctionBody(body);
  if (e === undefined) return undefined;
  // A `Matrix` wrapper (what `\begin{pmatrix}…\end{pmatrix}` parses to)
  // compiles to its first operand, the nested `List` of rows, so row k of
  // the value is operand k of that `List`. Its other operands are
  // delimiter strings and do not reach the compiled code.
  if (isFunction(e, 'Matrix') && e.ops.length >= 1) e = e.ops[0];
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e;
  // An ALL-SCALAR `PointList` is a single point whose component k is operand
  // k — the same equivalence the JavaScript target already relies on, where
  // the `PointList` definition handler lowers that shape itself "byte-
  // identically to `Tuple`" and only the other shapes reach
  // `compileJSPointList`. Requiring every operand to be provably numeric is
  // what excludes those other shapes: a component that is (or may be) an
  // indexed collection is a SOURCE, zipped across points, so operand k is
  // then not component k and the identification would be wrong.
  if (
    isFunction(e, 'PointList') &&
    e.ops.length > 0 &&
    e.ops.every((op) => op.type.matches('number'))
  )
    return e;
  return undefined;
}

/**
 * Resolve `collection` to the element expressions the emitter will lower one
 * by one, and run `fn` over them in the context those elements are analyzed
 * in. Returns `undefined` — and the caller then keeps its previous answer —
 * when the elements cannot be identified.
 *
 * Two routes: the collection is itself a literal constructor, or it is a call
 * to a user function whose body is one. The second route runs `fn` with the
 * function's PARAMETERS shielded (`userCallMask`) — the elements mention
 * those parameters, and reading a same-named engine symbol's value through
 * one would analyze the wrong definition. It also declines a head already being looked through, so
 * a self- or mutually-recursive definition terminates instead of looping.
 */
export function withCollectionElements<T>(
  collection: Expression,
  fn: (elements: ReadonlyArray<Expression>) => T | undefined
): T | undefined {
  if (isFunction(collection, 'List') || isFunction(collection, 'Tuple'))
    return fn(collection.ops);
  // A `Matrix` literal compiles to its first operand, the nested `List` of
  // rows (the JavaScript `Matrix` handler emits only that operand), so its
  // elements are the rows of that `List`.
  if (isFunction(collection, 'Matrix') && collection.ops.length >= 1)
    return withCollectionElements(collection.ops[0], fn);
  if (!isFunction(collection)) return undefined;
  const op = collection.operator;
  if (typeof op !== 'string' || CompilerState._userCallVisited.has(op))
    return undefined;
  const literal = userFunctionLiteral(collection.engine, op);
  if (literal === undefined) return undefined;
  const body = collectionConstructorBody(literal.ops[0]);
  if (body === undefined) return undefined;
  // The elements mention the parameters, which are shielded (typed as
  // declared, never read through the engine).
  const mask = userCallMask(literal);
  const nextVisited = new Set(CompilerState._userCallVisited);
  nextVisited.add(op);
  const prevVisited = CompilerState._userCallVisited;
  CompilerState._userCallVisited = nextVisited;
  try {
    // The body is analyzed as the emitted module-level definition reads
    // it, without the call site's bindings (see `withCallerBindingsHidden`).
    return core.withCallerBindingsHidden(() =>
      withBinderMask(mask, () => fn(body.ops))
    );
  } finally {
    CompilerState._userCallVisited = prevVisited;
  }
}

/**
 * Whether ELEMENT `index` (1-based) of the indexed collection `collection` is
 * complex-valued, when that element can be identified statically. Returns
 * `undefined` when it cannot be — a collection whose elements
 * {@link withCollectionElements} cannot see, or an index past their end — and
 * the caller then keeps its previous, whole-collection answer.
 *
 * Needed because a list is emitted ELEMENT BY ELEMENT and each element picks
 * its own real-vs-complex lowering, so the run-time array is heterogeneous:
 * `[i·t, 1]` lowers to `[{re, im}, 1]`. The whole-list verdict
 * (`ops.some(isComplexValued)`, the generic recursion the caller falls back
 * to) therefore describes NO single element, and reading one through it is
 * wrong in both directions. Measured at `t = 0.3` before this, on the DEFAULT
 * path with no compile option set:
 *
 * | shape                | compiled              | interpreter |
 * | -------------------- | --------------------- | ----------- |
 * | `[i·t, 1][2] + 1`    | `{re: NaN}`           | `2`         |
 * | `h(t)[1] + 1`        | the STRING `"…1"`     | `1 + 0.3i`  |
 *
 * — the first over-claims (the whole list is complex, so the plain number `1`
 * pulled out of it is read as `{re, im}` and `.re` is `undefined`), the second
 * under-claims (a call to `h(t) := [i·t, 1]` is classified real, so the
 * `{re, im}` pulled out of it is added to a number and JavaScript
 * concatenates the object instead). Both are silently wrong values behind
 * `success: true`.
 *
 * Reading the element the emitter will actually produce answers both.
 */
export function isComplexValuedElementAt(
  collection: Expression,
  index: number
): boolean | undefined {
  const elements = core.elementComplexness(collection);
  if (elements === undefined) return undefined;
  // A NEGATIVE index counts back from the end — `At([10, 20, 30], -1)`
  // compiles to `30`, so `-1` is the last element, not an invalid one.
  // Treating it as invalid left it on the whole-collection verdict and
  // reintroduced the exact over-claim this method exists to remove:
  // `[i·t, 1][-1] + 1` ran to `{re: NaN}` where the interpreter answers `2`,
  // because `-1` selects the REAL element.
  const i = index < 0 ? elements.length + index : index - 1;
  // Any index that selects nothing — zero, fractional, or past either end —
  // lowers to the plain number `NaN`, not a complex object. That is a real
  // value, so answer `false` rather than declining: declining would hand the
  // node back to the whole-collection verdict, which reports complex for any
  // collection holding one complex element and would read that `NaN` as
  // `{re, im}`.
  if (!Number.isInteger(index) || i < 0 || i >= elements.length) return false;
  return elements[i];
}

/**
 * The complex-ness of ONE element of a collection, as the broadcast closure
 * will see it — or `undefined` when it has no single answer.
 *
 * A scalar element is what the closure's parameter holds, so its own verdict
 * is the answer. A NESTED element is not: `_SYS.bcast` descends through every
 * array it is handed and applies the closure at the LEAVES, so a nested
 * element's convention is the one all of its leaves share, and it has none
 * when they disagree.
 *
 * Answering a nested element with `isComplexValued` — the whole-collection
 * verdict — is the same category error this analysis exists to remove, one
 * level down. Measured on the DEFAULT path before this guard:
 * `2·[[1+i, 2], [3+i, 4]]` reported both outer elements complex, installed a
 * complex closure, and ran to
 * `[[{re: 2, im: 2}, {re: NaN, im: NaN}], [{re: 6, im: 2}, {re: NaN, im: NaN}]]`
 * where the interpreter answers `[[2+2i, 4], [6+2i, 8]]` — the real leaves
 * `2` and `4` had `.re` read off them.
 */
export function broadcastLeafComplexness(
  element: Expression
): boolean | undefined {
  // Not a collection: the closure receives this value itself. The
  // possibly-collection arm is the BOUND predicate, matching
  // `elementComplexness`'s own operand test and `tryCompileBroadcast`'s
  // `isArrayOperand` — the three decide the same question (does this node
  // reach the closure as an array?) and must not drift apart.
  // (`isComplexValued` itself answers fold-first for a closed real-valued
  // constant — see `_withFoldedRealOverride` — so an exact
  // `√(5−√5)`-class element reads as the plain number its emission
  // inlines.)
  if (!(
    element.isCollection ||
    element.type.matches('list<any>') ||
    element.type.matches('indexed_collection<any>') ||
    isBoundPossiblyCollectionTyped(element)
  ))
    return core.isComplexValued(element);
  // A collection whose own elements cannot be identified has no leaf
  // verdict to report, and its whole-collection one describes none of them.
  const nested = core.elementComplexness(element);
  if (nested === undefined || nested.length === 0) return undefined;
  return nested.every((e) => e === nested[0]) ? nested[0] : undefined;
}

/**
 * Whether the collection operand `a` may hold a `{re, im}` object at some
 * position at run time: its type has a complex leaf (`list<complex>`,
 * `matrix<complex>`), an element that can be identified is complex-valued
 * (`[x, i]`, a user function whose body is `[s, i]`), or the operand as a
 * whole reads complex. A target helper that does real arithmetic on the
 * entries (`_SYS.matmul`, `_SYS.det`) must not receive such an operand:
 * it would answer NaN behind `success: true`.
 */
export function mayHoldComplexElement(a: Expression): boolean {
  return (
    typeHasComplexLeaf(compilationType(a)) ||
    hasAnyComplexElement(a) ||
    core.isComplexValued(a)
  );
}

/**
 * The heads whose broadcast closure can be built from a RUN-TIME
 * DISPATCHING scalar helper (`_SYS.sadd`, `_SYS.smul`: each accepts a plain
 * number or a `{re, im}` object in either position and answers in kind).
 * Over an operand whose element lane is `'mixed'` (see
 * {@link operandElementLane}) this is the only sound closure: a lane-
 * specific body is emitted once for every position, so it needs one shape
 * per operand. `Subtract` and `Negate` are spelled through `_SYS.smul` by
 * `−1`. `Divide` has no dispatching helper and stays declined.
 */
export const DISPATCHING_BROADCAST_HEADS = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Negate',
]);

/**
 * The closure body for a {@link DISPATCHING_BROADCAST_HEADS} head over the
 * element temps `params`, as a call chain of the run-time helpers.
 */
export function dispatchingScalarBody(
  h: string,
  params: ReadonlyArray<string>
): string {
  const fold = (helper: string): string =>
    params.slice(1).reduce((acc, p) => `${helper}(${acc}, ${p})`, params[0]);
  if (h === 'Add') return fold('_SYS.sadd');
  if (h === 'Multiply') return fold('_SYS.smul');
  if (h === 'Negate') return `_SYS.smul(-1, ${params[0]})`;
  if (h === 'Subtract')
    return `_SYS.sadd(${params[0]}, _SYS.smul(-1, ${params[1]}))`;
  throw new Error(
    `Could not compile \`${h}\`: no dispatching broadcast lowering`
  );
}

/**
 * Emit one unrolled `Sum`/`Product` term with its indices bound to the
 * integer values that term computes, so the shape analysis and the
 * emitters read the same closed constants the emitted code does.
 *
 * The complexness memo is layered around the frame: an answer that depends
 * on these values cannot escape the term it was computed for.
 *
 * A caller must push this frame ONLY when every term of the unrolled clause
 * gets the same complexness verdict under its own values. A clause whose
 * terms disagree would emit a plain number for one term and a `{re, im}`
 * object for the next, and the accumulator can hold only one of the two
 * shapes.
 */
export function withUnrolledIndexValues<T>(
  values: ReadonlyMap<string, number>,
  f: () => T
): T {
  CompilerState._unrolledIndexValues.push({
    values,
    masked: NO_NAMES,
    pending: new Set(values.keys()),
    memo: new WeakMap(),
  });
  _pushComplexMemoLayer();
  try {
    return f();
  } finally {
    _popComplexMemoLayer();
    CompilerState._unrolledIndexValues.pop();
  }
}

/**
 * Analyze or emit a loop body with its index's lower bound. The same scope
 * tracking as constant indices hides this fact from a nested binder that
 * reuses the name. Callers must first establish that the body cannot write
 * the index and that its result representation agrees with its consumers.
 */
export function withLoopIndexLowerBound<T>(
  index: string,
  lower: number,
  f: () => T
): T {
  CompilerState._unrolledIndexValues.push({
    values: new Map(),
    lowerBounds: new Map([[index, lower]]),
    masked: NO_NAMES,
    pending: new Set([index]),
    memo: new WeakMap(),
  });
  _pushComplexMemoLayer();
  try {
    return f();
  } finally {
    _popComplexMemoLayer();
    CompilerState._unrolledIndexValues.pop();
  }
}

/**
 * The CURRENT frame changed in place (`compileBlock` fills its frame
 * incrementally): answers cached under it are stale, enclosing layers are
 * not consulted until their context is restored — drop only the top.
 */
export function _resetComplexMemoTop(): void {
  CompilerState._complexMemoStack[CompilerState._complexMemoStack.length - 1] =
    new WeakMap();
  CompilerState._elementLaneMemoStack[
    CompilerState._elementLaneMemoStack.length - 1
  ] = new WeakMap();
}

/**
 * Record a local's inferred complex-ness in a `_localComplex` frame.
 * Routed through here (rather than a bare `frame.set`) because
 * `compileBlock` fills its frame INCREMENTALLY, while the frame is already
 * pushed and visible to the analysis.
 */
export function _setLocalComplex(
  frame: Map<string, boolean>,
  name: string,
  value: boolean
): void {
  frame.set(name, value);
  _resetComplexMemoTop();
}

/**
 * The complex-frame DEFAULT for a block local at its declaration: `true`
 * under the complex discipline (a local not declared real is wide, hence
 * complex-shaped, and every reference to it is lifted at use), `false`
 * otherwise (real until a complex first binding, the strict default).
 */
export function localComplexDefault(): boolean {
  return complexDiscipline();
}

/** Does the `Declare` type operand `t` name a real-only number type? */
export function declaredTypeIsReal(t: Expression | undefined): boolean {
  if (t === undefined) return false;
  const text = isString(t) ? t.string : isSymbol(t) ? t.symbol : undefined;
  if (text === undefined) return false;
  try {
    return isSubtype(parseType(text), 'real');
  } catch {
    return false;
  }
}

/**
 * The locals of a block frame that have received a first binding (a
 * `Declare` with a value, or an `Assign`), keyed by frame — the "bound
 * real" half of the strict-mode block-local rule (`noteLocalComplex`): a
 * local with `frame.get(name) === false` and no first binding is merely
 * DECLARED real by default and may still be shaped by its first `Assign`.
 */
export const _boundLocals = new WeakMap<Map<string, boolean>, Set<string>>();

export function markLocalBound(frame: Map<string, boolean>, name: string) {
  let bound = _boundLocals.get(frame);
  if (bound === undefined) {
    bound = new Set();
    _boundLocals.set(frame, bound);
  }
  bound.add(name);
}

export function localIsBound(
  frame: Map<string, boolean>,
  name: string
): boolean {
  return _boundLocals.get(frame)?.has(name) === true;
}

/**
 * Walk the statement forms nested in `stmt` (`If`/`Which` arms, `Loop`
 * bodies, nested statement lists) for an `Assign` of a real-bound local of
 * `frame` to a complex-shaped value, and raise the strict-mode block-local
 * `LaneMismatch` for the first one. Never enters a `Function` literal (a
 * scope of its own whose body runs elsewhere).
 *
 * A nested `Block` IS entered: every braced body of an Epsil `if`/`for`/
 * `while` is one, and an assignment there to an OUTER local writes that
 * local. The nested block's own locals (and a loop's indices) shadow the
 * outer names, which `shadow` accumulates; their complex-ness is inferred
 * the way `compileLoopBody` infers it, so an assignment such as
 * `r = r + t` with a nested local `t = 1 / k` is analyzed with `t` complex
 * when it is. A `Loop` is walked with its binders masked (`binderParts`),
 * so a loop index over complex elements reads complex here as it does in
 * the emitted body. Before this, an accumulator `r = 0` updated by
 * `r = r + 1 / k` inside a `for k in [a + √d, a − √d]` body was not
 * checked: the loop body assigned a `{re, im}` object to a local every
 * other statement reads as a number, and the second iteration
 * concatenated the object into a string.
 */
export function checkNestedComplexRebinding(
  stmt: Expression,
  frame: Map<string, boolean>,
  shadow: ReadonlySet<string> = new Set()
): void {
  if (!isFunction(stmt)) return;
  const h = stmt.operator;
  if (h === 'Function') return;
  if (h === 'Assign' && isSymbol(stmt.ops[0])) {
    const name = stmt.ops[0].symbol;
    if (
      !shadow.has(name) &&
      frame.get(name) === false &&
      localIsBound(frame, name) &&
      stmt.ops[1] !== undefined &&
      core.isComplexValued(stmt.ops[1])
    )
      laneMismatch('Block local', `the local \`${name}\``, stmt.ops[1]);
    return;
  }
  if (h === 'Block') {
    const args = stmt.ops;
    const inner = new Map<string, boolean>();
    for (const arg of args)
      if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0]))
        inner.set(arg.ops[0].symbol, localComplexDefault());
    const scope = stmt.localScope;
    if (scope)
      for (const arg of args)
        if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
          const name = arg.ops[0].symbol;
          if (
            !inner.has(name) &&
            scope.bindings.has(name) &&
            !CompilerState._boundVarsCtx?.has(name)
          )
            inner.set(name, localComplexDefault());
        }
    const innerShadow =
      inner.size === 0 ? shadow : new Set([...shadow, ...inner.keys()]);
    _pushLocalComplex(inner);
    try {
      for (const arg of args) {
        // The nested block's own locals, statement by statement (this also
        // runs the same check for THEIR rebindings).
        core.noteLocalComplex(arg, inner);
        checkNestedComplexRebinding(arg, frame, innerShadow);
      }
    } finally {
      _popLocalComplex();
    }
    return;
  }
  if (h === 'Loop') {
    const binder = binderParts(stmt);
    if (binder === null) return;
    const loopShadow =
      binder.shielded.length === 0
        ? shadow
        : new Set([...shadow, ...binder.shielded]);
    withBinderMask(binder, () => {
      for (const op of stmt.ops)
        checkNestedComplexRebinding(op, frame, loopShadow);
    });
    return;
  }
  if (h !== 'If' && h !== 'Which') return;
  for (const op of stmt.ops) checkNestedComplexRebinding(op, frame, shadow);
}

/**
 * The binding structure of `expr` if it is a binder form, else `null`.
 *
 * A binder's operands are not all values: `Sum`/`Product`/`Loop`/
 * `Comprehension` carry `Limits`/`Element` clauses and `Function` carries
 * its parameter names. Those operands introduce a NAME, not a value, so the
 * generic `ops.some(isComplexValued)` fallback must not walk them — doing so
 * reaches the bound name as if it were free and resolves it against the
 * engine, where an index named `i` is the imaginary unit. That made
 * `\sum_{i=0}^{2}\cos(it)` report complex and complex-lowered the SIBLING
 * operand of any enclosing arithmetic (`… + 2.5` → NaN, and a term silently
 * vanishing inside `\sin(…)`; Tycho item 65).
 *
 * `bodies` are the operands that carry a value; `real` names are integer
 * counters (a `Limits` clause, or an `Element` clause over a `Range`), which
 * are masked real in the body analysis; `shielded` names are every bound
 * name, masked only against the engine-value fallback.
 */
export function binderParts(
  expr: Expression & { ops: ReadonlyArray<Expression> }
): {
  bodies: ReadonlyArray<Expression>;
  real: string[];
  shielded: string[];
  loopComplex: string[];
} | null {
  const h = expr.operator;
  if (h === 'Function') {
    // ["Function", body, ...params]: a parameter may legitimately be
    // complex (a parameter declared `complex` receives a `{re, im}` value
    // at every call), so shield only — never force it real (Tycho item
    // 60). A
    // destructuring parameter contributes its LEAF names, which is what the
    // body actually references.
    const params = functionLiteralBoundNames(expr.ops.slice(1));
    return {
      bodies: expr.ops.slice(0, 1),
      real: [],
      shielded: params,
      loopComplex: [],
    };
  }
  if (h !== 'Sum' && h !== 'Product' && h !== 'Loop' && h !== 'Comprehension')
    return null;

  const real: string[] = [];
  const shielded: string[] = [];
  const loopComplex: string[] = [];
  for (const clause of expr.ops.slice(1)) {
    const isLimits = isFunction(clause, 'Limits');
    if (!isLimits && !isFunction(clause, 'Element')) continue;
    const ops = (clause as Expression & { ops: ReadonlyArray<Expression> }).ops;
    const name = ops[0];
    if (!isSymbol(name)) {
      // An `Element` clause may DESTRUCTURE its index (`for (p, q) in
      // pairs`): the clause binds the pattern's leaf names, and those are
      // what the body references, so shield them. They are never `real` —
      // a tuple component is not a numeric loop counter.
      if (!isLimits && isFunction(name, 'Tuple'))
        shielded.push(...tuplePatternNames(name));
      continue;
    }
    shielded.push(name.symbol);
    // A `Limits` index, or an `Element` index over a `Range`/`Linspace`, is
    // a numeric loop counter: real by construction. An `Element` index over
    // an arbitrary collection is left to type analysis.
    if (
      isLimits ||
      isFunction(ops[1], 'Range') ||
      isFunction(ops[1], 'Linspace')
    )
      real.push(name.symbol);
    // An `Element` index whose source emits complex-valued elements while
    // the index's type reads real: the loop body binds it complex (the
    // same verdict `compileElementLoops` acts on).
    else if (!isLimits && elementBinderLane(name, ops[1]) === 'complex')
      loopComplex.push(name.symbol);
  }
  return { bodies: expr.ops.slice(0, 1), real, shielded, loopComplex };
}

/**
 * Determine at compile time whether an expression produces a complex value.
 *
 * Uses the expression's declared type (from operator signatures) when
 * available. Falls back to operand inspection for functions whose
 * return type is unknown.
 *
 * A symbol bound in the compile context (`_boundVarsCtx`, synced from
 * `target.boundVars` by `compile()` — a loop index, lambda parameter,
 * broadcast element) shadows any same-named engine symbol, so the
 * engine-value fallback below must not read through it (a loop counter
 * named `i` must not pick up the imaginary unit's value).
 */
/** Symbols whose assigned VALUE `isComplexValued` is currently analyzing
 * (see the symbol arm): a value that mentions its own symbol is answered
 * from the declared type on re-entry. */
export const _complexValueInProgress = new Set<string>();

/**
 * `isComplexValued` of a binder BODY with the binder's integer indices
 * bound — the analysis a `Sum`/`Product` emitter must run before it
 * chooses its accumulator's shape. Each index is masked real (a loop
 * counter) and shielded from the engine-value fallback and from the
 * constant fold, exactly as `binderParts` masks it when the whole binder
 * is analyzed; the two analyses therefore agree, and an index named `i`
 * is never resolved to the engine's imaginary unit (Tycho item 252).
 */
export function isComplexValuedUnderIndices(
  body: Expression,
  indices: ReadonlyArray<string>
): boolean {
  if (indices.length === 0) return core.isComplexValued(body);
  return withBinderMask({ real: [...indices], shielded: [...indices] }, () =>
    core.isComplexValued(body)
  );
}

/**
 * Run `fn`, which EMITS the body of a `Sum`/`Product`, with each of
 * `indices` read as a real scalar: an integer loop counter.
 *
 * The emitter chooses its accumulator with
 * {@link isComplexValuedUnderIndices}, but the emission of each term asks
 * `isComplexValued` again, and that analysis reads a `Block` local before
 * the compile target's bound names. Without this frame, an index `n` inside
 * a `Block` with a complex local `n` is complex while the term is emitted:
 * the term `n²` is then emitted as complex arithmetic on an integer, and
 * its value does not match the accumulator (the JavaScript target computes
 * `undefined` parts, a shader calls a complex helper on a `float`).
 */
export function withRealLoopIndices<T>(
  indices: ReadonlyArray<string>,
  fn: () => T
): T {
  if (indices.length === 0) return fn();
  return core.withLocalShapeFrame(
    new Map(indices.map((n) => [n, false])),
    new Map(indices.map((n) => [n, LOCAL_SCALAR])),
    fn
  );
}

/**
 * `true` when a user definition shadows the library operator `head`
 * (`shadowsLibraryName()`) and that definition has its own `compile`
 * handler. The compiler consults that handler before the built-in
 * lowering of the head, so the built-in lowering does not apply.
 */
export function hasShadowingCompileHandler(
  engine: ComputeEngine,
  head: string
): boolean {
  if (!shadowsLibraryName(engine, head, { customLibrary: false })) return false;
  const shadow = engine.lookupDefinition(head);
  return isOperatorDef(shadow) && shadow.operator.compile !== undefined;
}

/**
 * The FUNCTION arm of `isComplexValued`, split out so the public entry can
 * memoize it (Tycho item 148). Never call directly — the memo lives above.
 */
export function _isComplexValuedFunction(
  expr: Expression & { ops: ReadonlyArray<Expression> }
): boolean {
  // A head that is real-shaped by definition answers `false` BEFORE any
  // type-based branch (Tycho item 147): `Imaginary` types bare `number`
  // (so the conservative operand recursion would report complex) and
  // `Real(±∞)` can type `+oo | -oo` (so the `isNonRealNumber`
  // branch would too) — yet every target emits a real scalar for both.
  if (REAL_BY_DEFINITION_HEADS.has(expr.operator)) return false;
  // A `Power` whose exponent the compiler replaces by its value is analyzed
  // as the node that is emitted (`knownExponentPower`).
  if (expr.operator === 'Power') {
    const powered = knownExponentPower(expr);
    if (powered !== undefined) return core.isComplexValued(powered);
  }
  // A continuation head on a target that lowers its complex kernel is
  // complex when an operand is, or when its value can be (see
  // `continuesToComplex`). A user definition that shadows the library
  // operator and has its own `compile` handler is exempt: the compiler
  // runs that handler before the built-in lowering (`compileExpr`), so
  // the emitted value is whatever the handler returns, not the result of
  // the complex continuation helper. For such a head, the type-based
  // branches below decide.
  if (
    COMPLEX_CONTINUATION_HEADS.has(expr.operator) &&
    hasComplexContinuationLowering() &&
    !hasShadowingCompileHandler(expr.engine, expr.operator)
  )
    return (
      expr.ops.some((a) => core.isComplexValued(a)) ||
      continuesToComplex(expr.operator, expr.ops)
    );
  // A head the CURRENT compilation's target lowers with a REAL-ONLY
  // lowering (`Floor`, `Mod`, `Max`, the statistics family, a real-only
  // helper such as JavaScript's `_SYS.erf`) yields a real value by
  // construction: under the complex discipline each maybe-complex operand
  // takes the run-time realness rule — the real lowering runs on the real
  // part when the imaginary part is exactly zero, and the value is NaN
  // otherwise (the D2/D6 rule of `realOperandGuard`) — and in strict mode a complex operand fails closed — either way
  // the emitted value is never a `{re, im}` object, so a wide RESULT type
  // (`Max(a, b)` over wide `a`, `b`) must not report complex. See
  // `_realOnlyLowering` for the measured disagreement.
  // The exception is a head that the target also lowers for complex
  // operands (`complexLowering`): when an operand may be complex, that
  // lowering is emitted, and its value is complex when the lowering says so
  // (the mean of complex data).
  if (isRealOnlyLoweringHead(expr.operator))
    return takesComplexResultLowering(expr);
  // A linear-algebra head answers from the lane of its collection
  // operands, the same answer that selects its target helper: a complex
  // lane emits the helper that returns complex values, and a real lane the
  // real-only one. The node's type cannot answer: `Dot(v, v)` over a
  // `vector<complex>` symbol types `number`. A `'wide'` lane is read as
  // real (`linearAlgebraOperandLane`), and the target emits the real-only
  // helper for it.
  {
    const laneOperands = linearAlgebraLaneOperands(expr.operator, expr.ops);
    if (laneOperands !== undefined)
      return linearAlgebraLane(laneOperands) === 'complex';
  }
  // A `Sum`/`Product` whose clause the target UNROLLS answers from the
  // terms the target will actually emit: each term binds the index to a
  // literal integer, which can prove a radicand non-negative that has an
  // unknown sign while the index is free. The hook and the emitter read one
  // set of unroll conditions, so parent and emission agree on the value
  // shape — the invariant compiled correctness rests on.
  if (
    (expr.operator === 'Sum' || expr.operator === 'Product') &&
    unrolledBigOpLaneHook !== undefined &&
    CompilerState._oracleFoldTarget !== undefined
  ) {
    const lane = unrolledBigOpLaneHook(expr);
    if (lane !== undefined) return lane;
  }
  // A `Sum`/`Product` over a COLLECTION (no indexing set) folds either with
  // the raw real operator or with the shape-agnostic combiner wrapped in
  // the complex lift (`collectionFoldsReal`); its value is complex-shaped
  // exactly when the latter is emitted.
  // When the elements are themselves collections (points, rows,
  // matrices), the fold is element-wise and its value is an array whose
  // entries are `{re, im}` exactly when the lane is complex
  // (`foldsCollectionElements`). Reading such a fold with the scalar test
  // put a sum of REAL points in the complex lane, and a parent read each
  // coordinate as `{re, im}`: `Sum(P) + (1, 1)` gave `NaN` coordinates.
  // An operand typed `broadcastable<T>` is a `T` or a list of `T`, and
  // its type matches no collection type. The fold (the guarded fold of
  // `emitCollectionReduce` in `javascript-target.ts`) answers the operand
  // itself or the sum of its elements, so its value is complex-shaped
  // when `T` is complex. Read from the node's type `number`, `Sum(c) + 1`
  // with `c: broadcastable<complex>` holding `[i]` added `1` to a
  // `{re, im}` object with the real `+` and answered `"[object Object]1"`.
  if (
    (expr.operator === 'Sum' || expr.operator === 'Product') &&
    expr.ops.length === 1
  ) {
    const t = compilationType(expr.ops[0]);
    if (typeof t !== 'string' && t.kind === 'broadcastable')
      return isNonRealNumber(t.elements) || wideIsComplex(t.elements);
  }
  if (
    (expr.operator === 'Sum' || expr.operator === 'Product') &&
    expr.ops.length === 1 &&
    (expr.ops[0].isCollection || expr.ops[0].type.matches('collection<any>'))
  )
    return foldsCollectionElements(expr.ops[0])
      ? linearAlgebraLane([expr.ops[0]]) === 'complex'
      : !collectionFoldsReal(expr.ops[0]);
  // A SELECTION answers from its value ARMS, never from the node's type:
  // the emitters coerce every arm to `{re, im}` as soon as one arm is
  // complex-valued (`branchComplexCoercion`, Tycho item 60), so the value
  // the parent receives is complex-shaped whenever an arm is — even when
  // the type system joined the arms to a real type (`Which(c, a, True, 5)`
  // over a wide `a` types `integer`; under the complex discipline
  // `a` is complex-shaped and both arms are lifted, and a parent reading
  // the node's type would consume the object as a number).
  if (expr.operator === 'If' || expr.operator === 'Which')
    return liveSelectionArms(expr).some((a) => core.isComplexValued(a));
  // A `Block`'s value is its LAST statement, not any of them: an interior
  // statement that binds a complex LOCAL says nothing about the value the
  // block produces. Under the conservative recursion it did — a body such as
  // `{ s ⩴ 0; z ⩴ t + i; s ⩴ s + |z|; s }` reported complex even though it
  // yields the real `s`, and the GPU user-function emission (whose return
  // type is `gpuTypeOfValue` of the body) declared `vec2 _fn_a(float t)`
  // around a `return s;` — source no driver accepts, behind
  // `success: true`.
  //
  // Answered HERE, with the selections, and never from the block's type:
  // the type joins the last statement's arms with `widen`, where an
  // `unknown` arm is a placeholder that the other arm absorbs
  // (`If(0 < x, x, 3)` over an unannotated parameter `x` types `integer`),
  // so the type-based branches below would call the block real while the
  // emitter lifts the wide arm to a `{re, im}` object. A user function
  // `b(x) := If(x > 0, x, 3)` called on a complex `z` then compiled
  // `(_.z).re + _fn_b(_.z)` around that object — `"1[object Object]"`
  // at run time — because its call site read the body's type. The block's
  // own arm reads the last statement's VALUE under the block's locals, the
  // same analysis `compileBlock` emits from.
  if (expr.operator === 'Block') return isBlockValueComplexValued(expr);
  // An indexed read answers for the ELEMENT it selects, not for the whole
  // collection: a list is emitted element by element, so its run-time array is
  // heterogeneous and the generic `ops.some(…)` recursion at the bottom of
  // this function describes none of its elements. See
  // `isComplexValuedElementAt`, which answers `undefined` — and so leaves the
  // previous behavior in place — whenever the selected element cannot be
  // identified statically (a computed index, a non-literal collection).
  if (expr.operator === 'At' && expr.ops.length === 2) {
    const index = expr.ops[1];
    // A COMPLEX index selects no element — it is not a position at all — so
    // this arm has nothing to say about such a node and must leave it to the
    // generic operand recursion below, which reports it complex from the
    // index. Answering from the elements instead reported a list of real
    // elements as real, and `At(List(10, 20, 30), Complex(1, 2))` then folded
    // to `10` instead of staying `_SYS.at([10, 20, 30], {re: 1, im: 2})`
    // (pinned in `compile-subtree-folding.test.ts`).
    if (!core.isComplexValued(index) && !isGatherIndex(index)) {
      // A literal index names one element; a run-time index names none, but
      // when every element agrees the answer is the same either way.
      const viaElement = isNumber(index)
        ? isComplexValuedElementAt(expr.ops[0], index.re)
        : uniformElementComplexness(expr.ops[0]);
      if (viaElement !== undefined) return viaElement;
    }
  }
  // Promotion is answered BEFORE the type branches
  // below, because the types it has to override are the WIDE ones: an
  // unknown-sign `√(t−1)` types `number`, which is neither non-real
  // (so the `isNonRealNumber` arm never fires) nor `real`. See
  // `promotesRadicalToComplex`.
  // A fold's value is its ACCUMULATOR lane (`combinerPlan`): the parent
  // must agree with what the emitted `reduce` hands back, or `Reduce(L, h,
  // 0) + 1` adds a number to the `{re, im}` the fold produced (`"[object
  // Object]1"`). A `Scan`'s elements are all in that lane, so the
  // whole-list verdict is the same answer. A builtin combiner (`Add`, …)
  // folds in the elements' lane, widened by a complex seed.
  if (
    (expr.operator === 'Reduce' || expr.operator === 'Scan') &&
    expr.ops.length >= 2
  ) {
    const [coll, op, init] = expr.ops;
    const plan = combinerPlan(coll, op, init);
    if (plan !== undefined) return plan.accComplex;
    if (isSymbol(op) && BUILTIN_FOLD_HEADS.has(op.symbol))
      return foldLaneIsComplex(coll, init);
  }
  if (promotionActive()) {
    // The predicate records a promotion for the `promoted` report
    // (`notePromoted`), but this analysis emits nothing: the node can be
    // folded to a literal, or be part of a subtree that is never emitted.
    // The emitter of the head calls the same predicate when it lowers the
    // node, and that call records the promotion of the emitted code. So
    // the record of the analysis is removed here. With `x` real,
    // `x + Sum(√(2 + sin k), k, 1, 16)` folds the sum to `22.85…`, and the
    // report stays `promoted: false`.
    // The record is restored in a `finally`, so a throw from the predicate
    // (a type read, a cancellation at the deadline) that a caller catches
    // does not leave the promotion in the report.
    const recorded = CompilerState._promoted;
    let promotes: boolean;
    try {
      promotes = core.promotesRadicalToComplex(expr.operator, expr.ops);
    } finally {
      CompilerState._promoted = recorded;
    }
    if (promotes) return true;
  }
  // `Apply(Derivative(f, n), …)` — the compiled `f''(x)` — takes the value
  // shape of the EXPRESSION THE EMITTER WILL PRODUCE, not the one this
  // node's type reports: `Derivative`'s type handler reports `number` for a
  // function with no declared codomain, so reading the type here put a
  // real-lane multiplication around the `{re, im}` object the emitted code
  // returns, and `(x − ε)·f′(ε)` answered NaN at every point.
  //
  // Which expression that is depends on the lowering, and the two do not
  // agree. The forward-mode lowering (`jet-derivative.ts`) walks the body
  // and picks its jet family from the body's own lane, so for it the body
  // is the right answer. The symbolic closed form (`compileDerivative`,
  // library/calculus.ts) is the DIFFERENTIATED body, which the body does
  // not describe in either direction: differentiation can drop what made
  // the body complex (`f(x) = x² + i` has the real derivative `2x`) and it
  // can introduce a complex node the body has none of (`f(x) = ∛x` has the
  // second derivative `−2/(9·x^(5/3))`, whose fractional power of an
  // unknown-sign base lowers through the complex `_SYS.cpow`).
  if (expr.operator === 'Apply' && isFunction(expr.ops[0], 'Derivative')) {
    const callee = expr.ops[0];
    const head = callee.ops[0];
    const literal = isFunction(head, 'Function')
      ? head
      : isSymbol(head)
        ? userFunctionLiteral(expr.engine, head.symbol)
        : undefined;
    const body =
      literal !== undefined && isFunction(literal) ? literal.ops[0] : undefined;
    // A body that reaches back to a derivative of the same function would
    // recurse without end; the shared visited set of the user-call
    // look-through below stops it, keyed on the differentiated head.
    const guard =
      head !== undefined && isSymbol(head) ? head.symbol : undefined;
    const recursing =
      guard !== undefined && CompilerState._userCallVisited.has(guard);
    if (!recursing) {
      if (guard !== undefined) CompilerState._userCallVisited.add(guard);
      try {
        // The jet lowering is asked the same way the emitter asks it, so
        // the two cannot disagree about which one claims the node.
        const jet = jetDerivativeTarget(
          expr.ops,
          (id) => userFunctionLiteral(expr.engine, id),
          mode() === 'complex'
        );
        if (jet !== undefined && body !== undefined) {
          // The jet family is picked from the body AND from the point the
          // derivative is taken at: the real family reads a coefficient
          // with `asReal`, so a `{re, im}` argument forces the complex
          // one. The two predicates must gain that disjunct together, or
          // the enclosing expression puts real arithmetic around the
          // `{re, im}` object `_SYS.jcread` hands back
          // (`compileJetDerivative`, jet-derivative.ts).
          const arg = expr.ops[1];
          return (
            core.isComplexValued(body) ||
            (arg !== undefined && core.isComplexValued(arg))
          );
        }
        // The closed form. Asking for it here costs nothing the
        // compilation was not going to pay anyway: it is memoised per
        // (function literal, order) (`derivative`, symbolic/derivative.ts),
        // and the emission that follows reads the same entry.
        // A multi-index derivative of a large body is declined, and its
        // closed form is not computed (`appliedDerivativeTooLarge`).
        const closedForm = multiIndexDerivativeTooLarge(callee, (id) =>
          userFunctionLiteral(expr.engine, id)
        )
          ? undefined
          : derivativeClosedForm('Derivative', callee.ops);
        if (isFunction(closedForm, 'Function') && expr.ops.length === 2)
          return withDerivativeArgument(closedForm, expr.ops[1], () =>
            core.isComplexValued(closedForm.ops[0])
          );
        if (closedForm !== undefined || body !== undefined)
          return core.isComplexValued((closedForm ?? body)!);
      } finally {
        if (guard !== undefined) CompilerState._userCallVisited.delete(guard);
      }
    }
  }

  // A call to a user function returns the lane that its emitted definition
  // records, whatever the call's type says (`userCallLane`): with
  // `h(s) := s + i`, the call `h(t)` types `number`, and `_fn_h` returns a
  // complex value. Under a promoting discipline the same record carries
  // the promotion of a radical inside the body (`z(t) := √(t−1)`). A head
  // that is not a user function costs a definition lookup here.
  {
    const viaDefinition = userCallLane(expr);
    if (viaDefinition !== undefined) return viaDefinition;
  }
  // A loop-bound proof can settle a radical whose declared result remains
  // number (including poles and NaN). The real emitter then returns a plain
  // number even in complex mode, so its parent must use that representation.
  if (
    CompilerState._unrolledIndexValues.some(
      (frame) => frame.lowerBounds?.size
    ) &&
    ['Sqrt', 'Ln', 'Log'].includes(expr.operator) &&
    expr.ops.every(
      (op) => !core.isComplexValued(op) && assumedRealNonNegative(op)
    )
  )
    return false;
  if (
    expr.operator === 'Power' &&
    realPowerExponent(expr.ops) !== undefined &&
    !expr.ops.some((a) => core.isComplexValued(a))
  )
    return false;
  // A head whose emitter picks its real or complex lowering from the
  // OPERANDS (`COMPLEX_PROPAGATING_HEADS`: every target writes
  // `args.some(isComplexValued)`, never a test of the node's type) is
  // complex exactly when an operand is, WHATEVER its type says. Answering
  // from the type first would disagree with the emitter when the type is
  // real and an operand is complex-shaped: `Negate` typed `real` over an
  // operand the compiler put on the complex lane reported "real" to its
  // parent while its emitter wrote `_SYS.cneg(…)`, so the parent added a
  // number to a `{re, im}` object (`_SYS.cneg({…}) + 1`) and the result was
  // NaN. Such an operand is complex-shaped with a real value (an imaginary
  // part of 0), so the complex lane gives the right number. The same rule
  // covers a non-real type: `Multiply(1e5, Sqrt(u))` is typed `complex`,
  // but the `Sqrt` carve-out below keeps `Sqrt(u)` real, so the product is
  // real (Tycho item 144). And a wide type: `9.81 / k[i]` is typed `number`
  // (the element read has a `nan` arm) and is emitted as the real
  // `9.81 / _SYS.at(k, i)`, so `√(9.81 / k[i])` must not hand that number
  // to `_SYS.csqrt` (Tycho item 252). Heads whose emitter reads the node
  // TYPE instead (`Power`, `Root`, the inverse trigonometric functions, see
  // `resultIsComplexValued`) must NOT be in that set.
  if (COMPLEX_PROPAGATING_HEADS.has(expr.operator))
    return expr.ops.some((a) => core.isComplexValued(a));
  // Check the function's return type from its operator definition.
  //
  // The infinite and NaN branches are dropped first: a head whose value can
  // blow up at a pole claims a union such as `complex | +oo | -oo`
  // (`Artanh`, `Arcoth`, `Arsech`, `Ln`, `Log`), and only its FINITE part
  // decides the lane. FOUR SITES MUST STAY IN AGREEMENT, because they
  // answer the same question for the same node and a disagreement is a
  // silent value-shape mismatch (a `{re, im}`/`vec2` consumer reading a
  // scalar, or the reverse): this predicate, which a PARENT expression
  // consults; `resultIsComplexValued` in `javascript-target.ts`, the
  // JavaScript emitters' copy; `gpuResultIsComplexValued` in
  // `gpu-shapes.ts`, the GPU emitters' copy; and
  // `resultIsWideUnderComplexDiscipline` in `javascript-target.ts`, the
  // copy of the wide-type rule at the end of this function, which the
  // `Power` emitter reads. Change one, change all four.
  const t = expr.type;
  if (isNonRealNumber(finitePartOfType(t.type))) {
    // Sqrt/Ln/Log carve-out (2026-07-31): their type handlers now widen
    // to `complex` for a real operand of UNKNOWN sign
    // (type soundness: `√−2 = 1.414…i`), but the pinned compile contract
    // keeps the real kernel for that case — these are the hottest plotted
    // heads, and `Math.sqrt(-2)`/`sqrt(r)` yield a real-shaped `NaN` at
    // run time. Only a provably negative or provably complex operand
    // routes complex. The heads' own emitters use the same predicate
    // (`resultIsComplexValued(head, args) && a provably negative
    // operand`), so parent and child always agree on the value SHAPE —
    // the invariant that matters for compiled correctness.
    if (
      expr.operator === 'Sqrt' ||
      expr.operator === 'Ln' ||
      expr.operator === 'Log'
    ) {
      // Promotion is NOT re-checked here: the gate at
      // the top of this function already answered `true` for every promoted
      // case, so reaching this line in a promoting mode means
      // `promotesRadicalToComplex` declined — every operand is provably
      // non-negative — and the emitters' `promotesToComplexLane` will
      // decline identically. Returning `true` here would therefore report
      // complex over an emitter still producing `Math.sqrt`, which is the
      // shape disagreement this whole predicate exists to prevent.
      return expr.ops.some(
        (a) => a.isNegative === true || core.isComplexValued(a)
      );
    }
    return true;
  }
  // The REAL verdict reads the same finite part the non-real verdict above
  // does. Asking `t.matches('real')` of the whole union answers false for a
  // head that can blow up — `Abs` of a complex operand of unproven
  // finiteness claims `real<0..> | +oo | -oo` — and such a node then
  // fell through to the conservative operand recursion below, which reported
  // it complex from its complex operand. The parent then read `.re`/`.im`
  // off the plain number `_SYS.cabs` returns, so `|z| − 4` compiled to
  // `NaN`. A `±∞` is real-SHAPED at run time, so dropping the non-finite
  // part before the test is right for the value shape this predicate
  // decides.
  if (isSubtype(finitePartOfType(t.type), 'real')) return false;
  // A boolean or string value is never complex-valued, whatever its
  // operands are. Without this, a predicate over a complex-typed operand
  // (`Less(Sin(1e5·√u), 0)`) fell through to the conservative operand
  // recursion below and reported complex — poisoning every enclosing form
  // (a `Which` condition is not even a value position). Wide types
  // (`number`, `unknown`) still take the recursion.
  if (t.matches('boolean') || t.matches('string')) return false;

  // Return type is unknown — fall back to checking whether any
  // operand is complex (conservative: assumes function propagates
  // complex-ness from its inputs). A binder form contributes only its
  // body, analyzed with its bound names masked (see `binderParts`).
  const binder = binderParts(expr);
  if (binder)
    return withBinderMask(binder, () =>
      binder.bodies.some((b) => core.isComplexValued(b))
    );

  if (expr.ops.some((arg) => core.isComplexValued(arg))) return true;
  // COMPLEX discipline: a wide-typed result whose operands are all real can
  // still be a complex value at run time (a user function returning its
  // parameter, an element read of a `list<number>`), and the value it
  // yields is lifted at the parent's use (`complexDiscipline`).
  //
  // `resultIsWideUnderComplexDiscipline` in `javascript-target.ts` copies
  // this rule for the `Power` emitter, so that the emitter produces a
  // `{re, im}` object exactly when this predicate reports complex. A
  // change to this rule must be made there too.
  return wideIsComplex(t.type);
}

/**
 * Is the VALUE of the `Block` `expr` complex-valued?
 *
 * A block's value is its last statement, evaluated under its own locals —
 * so the locals' complex-ness has to be inferred first, exactly as
 * `compileBlock` infers it before compiling the statements (`{ z ⩴ t + i;
 * z² }` is complex through the local `z`, whose declared type is real). The
 * set of locals mirrors `withImplicitLocalDeclares`: the explicit `Declare`s
 * plus the bare assignments `canonicalBlock` hoisted into the block's OWN
 * scope. A name the enclosing compilation already binds is NOT a local of
 * this block, so it keeps whatever the enclosing analysis says.
 */
export function isBlockValueComplexValued(
  expr: Expression & { ops: ReadonlyArray<Expression> }
): boolean {
  const args = expr.ops;
  if (args.length === 0) return false;

  const frame = new Map<string, boolean>();
  for (const arg of args)
    if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0]))
      frame.set(arg.ops[0].symbol, localComplexDefault());
  const scope = expr.localScope;
  if (scope)
    for (const arg of args)
      if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
        const name = arg.ops[0].symbol;
        if (
          !frame.has(name) &&
          scope.bindings.has(name) &&
          !CompilerState._boundVarsCtx?.has(name)
        )
          frame.set(name, localComplexDefault());
      }

  _pushLocalComplex(frame);
  try {
    for (const arg of args) core.noteLocalComplex(arg, frame);
    // The value statement, skipping the `Nothing` no-ops `compileBlock`
    // filters out. A trailing `Assign` yields the value it wrote; a trailing
    // `Declare` yields no value at all.
    let i = args.length - 1;
    while (i >= 0 && isSymbol(args[i], 'Nothing')) i -= 1;
    if (i < 0) return false;
    const last = args[i];
    if (isFunction(last, 'Declare')) return false;
    const value = isFunction(last, 'Assign') ? last.ops[1] : last;
    return value !== undefined && core.isComplexValued(value);
  } finally {
    _popLocalComplex();
  }
}
