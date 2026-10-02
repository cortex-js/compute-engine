import type { TypeString } from '../../common/type/types.js';
import type {
  BindingSite,
  BindingSiteSelector,
  Expression,
  Scope,
} from '../global-types.js';

import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { isValueDef } from './definition-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterNames,
} from './function-literal.js';

/**
 * The prebuilt binding-site selectors — the vocabulary an operator definition
 * uses to say **"this operand is my bound variable, bind it in my scope"**
 * (`docs/SCOPING-MODEL.md`).
 *
 * Before this existed, every binder answered that question its own way — by
 * name (`rubi`), by string (`RubiDriver.int`), by position inside a `Limits`
 * operand (`nDSolveFunction`), by a fixed operand index (`Series`), or by
 * relying on canonicalization order (pipe desugaring) — and each improvisation
 * bound the variable in a slightly different scope. Five wrong-scope defects
 * came out of that (see §The recurring defect in
 * `docs/SCOPING-MODEL.md`).
 *
 * This module is a LEAF, in the same tier as `binders.ts`: it may import
 * `type-guards.js`, `function-literal.js` and `binders.js`, and nothing from
 * `utils.ts`, `box.ts` or `library/`. The declaration is consumed once, at
 * canonicalization, and materialized as a `localScope`, which is the channel
 * `boundVariableNames` (and therefore `same()`, `rebindEscaping`,
 * `bindingKeyedSubs`, …) already reads — so the equality hot path never
 * evaluates a selector.
 */

const NO_SITES: readonly BindingSite[] = [];

/** `Nothing` in an index position means "no index", not a bound variable. */
function siteFor(
  op: Expression | undefined,
  path: number[],
  type: TypeString | undefined
): BindingSite | undefined {
  // A binding site held by a lazy operator may arrive wrapped in `Hold`.
  if (isFunction(op, 'Hold') && op.nops === 1)
    return siteFor(op.op1, [...path, 0], type);
  if (!isSymbol(op) || op.symbol === 'Nothing') return undefined;
  return type === undefined ? { path } : { path, type };
}

/**
 * The operands at `indices` are this operator's bound variables.
 *
 * `Series: { scoped: operandSites(1) }` — the expansion variable is operand 1.
 */
export function operandSites(...indices: number[]): BindingSiteSelector {
  return (ops) => {
    const sites: BindingSite[] = [];
    for (const i of indices) {
      const site = siteFor(ops[i], [i], undefined);
      if (site) sites.push(site);
    }
    return sites.length === 0 ? NO_SITES : sites;
  };
}

/**
 * Every operand from `first` onward is a bound variable — the VARIADIC
 * counterpart of {@link operandSites}, for an operator whose bound variables
 * are a trailing list of arbitrary length.
 *
 * `D: { scoped: operandsFrom(1) }` — `D(f, x, y)` binds both `x` and `y`.
 * Operands that are not bare symbols (a `Set` higher-order spec the handler
 * has yet to expand) yield no site: the 'post' phase sees the expanded form.
 */
export function operandsFrom(
  first: number,
  type?: TypeString
): BindingSiteSelector {
  return (ops) => {
    const sites: BindingSite[] = [];
    for (let i = first; i < ops.length; i++) {
      const site = siteFor(ops[i], [i], type);
      if (site) sites.push(site);
    }
    return sites.length === 0 ? NO_SITES : sites;
  };
}

/** The RANGE-shaped operand shapes `canonicalIndexingSet`/`canonicalLimits`
 * recognize as carrying an index in their first position. An `Element`
 * clause is handled before this set is consulted (see `indexingSetSite`). */
const INDEXING_SET_OPERATORS = new Set([
  'Limits',
  'Tuple',
  'Triple',
  'Pair',
  'Single',
  'Set',
]);

/**
 * The type of the index of a `Limits` clause whose bounds are integer
 * literals: the ranged type `integer<lo..hi>` (or `integer<lo..>` when the
 * upper bound is `+∞`). A ranged index lets the body type more precisely:
 * `√(1 − ((k − 0.5)/40)²)` over `Limits(k, 1, 40)` is `real`, not `complex`.
 * Any other clause, or a `type` other than `integer`, keeps `type` unchanged.
 *
 * `ops` are all the operands of the binder. When one of them ASSIGNS the
 * index (`Sum(Block(Assign(k, k + 1), k), Limits(k, 1, 2))`), the index can
 * hold a value outside the range, and the ranged type would reject that
 * write. The index then keeps `type`.
 */
function rangeIndexType(
  op: Expression,
  type: TypeString | undefined,
  ops: ReadonlyArray<Expression>,
  flatIndexes: ReadonlySet<number>
): TypeString | undefined {
  if (type !== 'integer' || !isFunction(op, 'Limits')) return type;
  return rangeIndexTypeOf(
    op.ops[0],
    op.ops[1],
    op.ops[2],
    type,
    ops,
    flatIndexes
  );
}

/**
 * The ranged type of the index `index` with bounds `loOp` and `hiOp`, as
 * {@link rangeIndexType} describes. It applies to a `Limits` clause and to
 * the flat spelling of the same clause (`Sum(body, k, 1, 10)`).
 */
function rangeIndexTypeOf(
  index: Expression | undefined,
  loOp: Expression | undefined,
  hiOp: Expression | undefined,
  type: TypeString | undefined,
  ops: ReadonlyArray<Expression>,
  flatIndexes: ReadonlySet<number>
): TypeString | undefined {
  if (type !== 'integer') return type;
  if (!isSymbol(index)) return type;
  if (ops.some((x) => assignsSymbol(x, index.symbol))) return type;
  // Two clauses that bind the same name (`Sum(k, Limits(k, 1, 3),
  // Limits(k, 5, 7))`, or the flat `Sum(k, k, 1, 3, k, 5, 7)`) assign the
  // values of both ranges to one symbol, so neither range is its type.
  const bindsIndex = (x: Expression, i: number): boolean =>
    isFunction(x)
      ? INDEXING_SET_OPERATORS.has(x.operator) &&
        isSymbol(x.ops[0]) &&
        x.ops[0].symbol === index.symbol
      : flatIndexes.has(i) && isSymbol(x) && x.symbol === index.symbol;
  if (ops.filter(bindsIndex).length > 1) return type;
  // Only number LITERALS: a symbol bound (`Limits(k, 1, n)` with `n := 10`)
  // can be reassigned after this binding, which would leave the index type
  // wrong.
  if (!isNumber(loOp) || !isNumber(hiOp)) return type;
  // Safe integers only: the machine value of a larger literal is rounded,
  // and the range would then miss index values.
  const lo = loOp.re;
  const hi = hiOp.re;
  if (!Number.isSafeInteger(lo) || lo > hi) return type;
  if (hi === Infinity) return `integer<${lo}..>` as TypeString;
  if (!Number.isSafeInteger(hi)) return type;
  return `integer<${lo}..${hi}>` as TypeString;
}

/** Does `expr` contain an `Assign` whose target is the symbol `name`, or a
 * tuple pattern with `name` as a leaf (`Assign(Tuple(k, _), …)`)? */
function assignsSymbol(expr: Expression, name: string): boolean {
  if (!isFunction(expr)) return false;
  if (expr.operator === 'Assign' && patternNames(expr.ops[0], name))
    return true;
  return expr.ops.some((x) => assignsSymbol(x, name));
}

/** Is `name` the symbol `target`, or a leaf of the tuple pattern `target`? */
function patternNames(target: Expression | undefined, name: string): boolean {
  if (isSymbol(target)) return target.symbol === name;
  if (isFunction(target, 'Tuple'))
    return target.ops.some((x) => patternNames(x, name));
  return false;
}

/**
 * The index of a single indexing-set operand at `[i]`, if it has one.
 *
 * Marked `clauseLocal`: an indexing set is a *clause*, and the contract
 * (`Comprehension`'s own description: "Later clauses see earlier bindings") is
 * that an EARLIER clause's collection resolves the name in the enclosing
 * scope, not in this node. See {@link BindingSite.clauseLocal}.
 */
function indexingSetSite(
  op: Expression | undefined,
  i: number,
  type: TypeString | undefined,
  ops: ReadonlyArray<Expression>,
  flatIndexes: ReadonlySet<number> = NO_FLAT_INDEXES
): BindingSite[] {
  // A DESTRUCTURING loop variable — `for (p, q) in pairs { … }`, lowered to
  // `Element(Tuple(p, q), pairs)` — binds one name per pattern leaf, so the
  // clause yields one site per leaf instead of one for the whole operand.
  // Restricted to `Element`: a `Tuple` indexing set is `Sum(f, Tuple(n, 1,
  // 10))`, whose first operand is the index itself, not a pattern.
  if (isFunction(op, 'Element') && isFunction(op.ops[0], 'Tuple')) {
    const sites: BindingSite[] = [];
    const walk = (node: Expression, path: number[]): void => {
      if (isFunction(node, 'Tuple')) {
        node.ops.forEach((el, k) => walk(el, [...path, k]));
        return;
      }
      // `_` is the pipe placeholder (`xs |> Map(f, _)`), not a name: a
      // pattern slot spelled `_` discards its component. Binding it here
      // would shadow the placeholder inside the loop body. The lambda-
      // parameter walker (`lambdaParamSites`) and `tuplePatternNames`
      // (`boxed-expression/tuple-pattern.ts`) drop it for the same reason.
      if (isSymbol(node) && node.symbol === '_') return;
      const site = siteFor(node, path, type);
      if (site) sites.push({ ...site, clauseLocal: true });
    };
    walk(op.ops[0], [i, 0]);
    return sites;
  }
  // The `type` pin is for RANGE-shaped clauses only (`Limits`, a bounds
  // `Tuple`, a bare symbol): their index walks integers between two bounds.
  // An `Element` clause iterates a collection, and its index takes that
  // collection's ELEMENT type instead — `Sum(chi(n), Element(chi, G))` over
  // `G: set<function>` binds `chi` as a function, and `Sum(2x, Element(x,
  // [0.5, 1.5]))` binds `x` as a real. The site is left untyped here (an
  // inferred `unknown` binding), and the binder's canonical handler narrows
  // it from the collection once that is canonical (`canonicalIndexingSet`,
  // `library/utils.ts`). Pinning `integer` on that shape made the body
  // `chi(n)` an `expected-function` error and the float element an
  // `incompatible-type` throw at the per-iteration assignment.
  if (isFunction(op, 'Element')) {
    const site = siteFor(op.ops[0], [i, 0], undefined);
    return site === undefined ? [] : [{ ...site, clauseLocal: true }];
  }
  // A bare symbol that is followed by its bounds (`Sum(body, n, 1, 10)`)
  // takes the ranged type its `Limits` spelling would take.
  const flatType =
    isSymbol(op) && flatLimitsSpan(ops, i) === 3
      ? rangeIndexTypeOf(op, ops[i + 1], ops[i + 2], type, ops, flatIndexes)
      : type;
  const site =
    isFunction(op) && INDEXING_SET_OPERATORS.has(op.operator)
      ? siteFor(op.ops[0], [i, 0], rangeIndexType(op, type, ops, flatIndexes))
      : // A bare symbol (`Sum(body, n, 1, 10)`) or `Hold(n)`.
        siteFor(op, [i], flatType);
  return site === undefined ? [] : [{ ...site, clauseLocal: true }];
}

/**
 * The index of each indexing-set operand from `first` onward — the shapes
 * `canonicalIndexingSet` and `canonicalLimits` already recognize
 * (`Limits`/`Element`/`Tuple`/`Triple`/`Pair`/`Single`/`Set`, a bare symbol,
 * or any of those held).
 *
 * `Sum`/`Product`: `{ scoped: indexingSetSites(1, 'integer') }` — the
 * `integer` applies to the range-shaped clauses; an `Element` clause's index
 * is typed from its collection (see `indexingSetSite`).
 */
export function indexingSetSites(
  first: number,
  type?: TypeString
): BindingSiteSelector {
  return (ops) => {
    // In the flat spelling (`Sum(body, n, 1, 10)`, `Integrate(f, x, 0, b)`)
    // the operands after an index are its bounds, not indexes: they are
    // skipped, so a symbol bound (`b`) stays free.
    const flatIndexes = new Set<number>();
    for (let i = first; i < ops.length; i++) {
      if (!isSymbol(ops[i])) continue;
      flatIndexes.add(i);
      i += flatLimitsSpan(ops, i) - 1;
    }
    const sites: BindingSite[] = [];
    for (let i = first; i < ops.length; i++) {
      sites.push(...indexingSetSite(ops[i], i, type, ops, flatIndexes));
      if (isSymbol(ops[i])) i += flatLimitsSpan(ops, i) - 1;
    }
    return sites.length === 0 ? NO_SITES : sites;
  };
}

const NO_FLAT_INDEXES: ReadonlySet<number> = new Set();

/**
 * Whether `op` is a symbol that can name an index or an integration variable
 * in the flat spelling of an indexing set (`["Integrate", f, "x", "y"]`,
 * `["Sum", body, "k", 1, "n"]`): a symbol that is not a constant (`Pi`,
 * `ExponentialE`) and not the placeholder `Nothing`.
 */
function isVariableName(op: Expression | undefined): boolean {
  if (!isSymbol(op) || op.symbol === 'Nothing') return false;
  const def = op.engine.lookupDefinition(op.symbol);
  return !(isValueDef(def) && def.value.isConstant === true);
}

/**
 * The number of operands, from 1 to 3, of the flat indexing-set clause that
 * starts with the symbol `ops[i]`: the index alone (1), the index and its
 * upper bound (2), or the index and its lower and upper bounds (3).
 *
 * An operand after the index that is not a variable name (a number, a
 * constant such as `Pi`, or an expression) starts the bounds: with one more
 * operand, they are the lower and upper bounds, whatever expression the upper
 * bound is (`"x", 0, "Pi"`, `"x", 0, "b"`); alone, it is the upper bound
 * (`"x", 10`). A variable name after the index is the next index: `"x", "y",
 * "z"` are three indexes with no bounds, and `"x", "y", 0, 1` is `x` with no
 * bounds, then `y` from 0 to 1. A variable name in the upper-bound position
 * that is followed by more operands is the next index too: `"x", 1, "y", 0,
 * 2` is `x` up to 1, then `y` from 0 to 2.
 *
 * A variable name is NOT read as the next index when that reading would make
 * it an index twice: in `"x", 0, "y", "y", 0, 1` the first `y` is the upper
 * bound of `x` (`x` from 0 to `y`, then `y` from 0 to 1), not an index with
 * no bounds followed by a second index `y`. The same applies to the operand
 * just after the index: in `"x", "y", "y", 0, 1`, `y` is the upper bound of
 * `x`.
 *
 * `Integrate` (`canonicalLimitsSequence`), `Sum` and `Product`
 * (`canonicalFlatIndexingSets`), both in `library/utils.ts`, and the binder
 * hook above all read the flat spelling with this function, so that the
 * symbols they bind are the same.
 */
export function flatLimitsSpan(
  ops: ReadonlyArray<Expression>,
  i: number
): 1 | 2 | 3 {
  const next = ops[i + 1];
  const after = ops[i + 2];
  if (next === undefined || isNextIndex(ops, i + 1)) return 1;
  if (after !== undefined && !(isNextIndex(ops, i + 2) && i + 3 < ops.length))
    return 3;
  return 2;
}

/**
 * Whether the operand `ops[k]` of a flat indexing-set spelling starts the
 * next clause: it is a variable name, and reading it as an index does not
 * make the same name an index twice in the clauses from `k` on (see
 * {@link flatLimitsSpan}).
 */
function isNextIndex(ops: ReadonlyArray<Expression>, k: number): boolean {
  // `isNextIndex` and `flatLimitsSpan` call each other on later operands, so
  // without a cache the cost grows exponentially with the number of
  // operands. The result for `k` depends only on the operands from `k` on,
  // and on whether each of these symbols is a constant (`isVariableName`
  // reads its definition). The cache assumes that this does not change while
  // the array `ops` is alive: a symbol declared a constant (or no longer a
  // constant) after a first call still gets the cached result for the same
  // array.
  let cache = NEXT_INDEX_CACHE.get(ops);
  if (cache === undefined) {
    cache = new Map();
    NEXT_INDEX_CACHE.set(ops, cache);
  }
  let result = cache.get(k);
  if (result === undefined) {
    result = computeIsNextIndex(ops, k);
    cache.set(k, result);
  }
  return result;
}

const NEXT_INDEX_CACHE = new WeakMap<
  ReadonlyArray<Expression>,
  Map<number, boolean>
>();

function computeIsNextIndex(
  ops: ReadonlyArray<Expression>,
  k: number
): boolean {
  const op = ops[k];
  if (!isVariableName(op) || !isSymbol(op)) return false;
  let count = 0;
  let j = k;
  while (j < ops.length) {
    const x = ops[j];
    if (!isVariableName(x)) {
      j += 1;
      continue;
    }
    if (isSymbol(x) && x.symbol === op.symbol) count += 1;
    j += flatLimitsSpan(ops, j);
  }
  return count < 2;
}

/**
 * The index of the indexing-set operand at `index` only — for an operator
 * whose remaining operands are not indexing sets (`NDSolveFunction`, whose
 * `Limits` operand carries the ODE's independent variable).
 */
export function limitsIndexSites(
  index: number,
  type?: TypeString
): BindingSiteSelector {
  return (ops) => {
    const sites = indexingSetSite(ops[index], index, type, ops);
    return sites.length === 0 ? NO_SITES : sites;
  };
}

/**
 * The parameter list of the `Function` literal at operand `op` (unwrapping a
 * `Typed` ascription on each parameter).
 */
export function lambdaParamSites(op: number): BindingSiteSelector {
  return (ops) => {
    const literal = ops[op];
    if (!isFunction(literal, 'Function')) return NO_SITES;
    const sites: BindingSite[] = [];
    for (let i = 1; i < literal.nops; i++) {
      const param = literal.ops[i];
      // A DESTRUCTURING parameter (`((p, q)) => …`) binds one name per pattern
      // leaf, each at its own path inside the pattern.
      if (isFunction(param, 'Tuple')) {
        const walk = (node: Expression, path: number[]): void => {
          if (isFunction(node, 'Tuple')) {
            node.ops.forEach((el, k) => walk(el, [...path, k]));
            return;
          }
          if (isSymbol(node) && node.symbol !== '_') sites.push({ path });
        };
        walk(param, [op, i]);
        continue;
      }
      if (functionLiteralParameterName(param) === '') continue;
      sites.push({
        // A REST parameter (`(a, ...rest) => …`) is the node
        // `["Spread", symbol]`, and the name it binds is the symbol INSIDE
        // that wrapper — the same one-level unwrap a `Typed` annotation
        // needs, so both report the path of the inner operand.
        path:
          isFunction(param, 'Typed') || isFunction(param, 'Spread')
            ? [op, i, 0]
            : [op, i],
      });
    }
    return sites.length === 0 ? NO_SITES : sites;
  };
}

/**
 * What a node binds, as each name plus the operand range it is visible in.
 *
 * `visibleFrom` maps a name to the operand index it becomes visible at (`0`
 * meaning the whole node), and `firstClause` is the index of the earliest
 * CLAUSE-LOCAL site. Together they encode the clause ordering `bindBindingSites`
 * enforces after canonicalization (`box.ts`, step 6): a clause-local name is
 * bound in its own clause and the ones after it, plus every operand BEFORE the
 * first clause — the body, which sits inside all of them. An earlier clause may
 * therefore mention a later clause's name as an ordinary ambient symbol, and
 * `Comprehension(…, Element(i, [j, j+1]), Element(j, …))` relies on it: that
 * `j` is the enclosing one, not the comprehension's.
 */
export interface DeclaredBinders {
  readonly visibleFrom: ReadonlyMap<string, number>;
  readonly firstClause: number;
  /** The names bound by CLAUSE-LOCAL sites — the indexing-set clauses of
   * `Sum`, `Product`, `Comprehension`, … — as opposed to a plain operand
   * site (`D`'s variable, `Series`' expansion variable) or a function
   * literal's parameters. The free-variable walk eliminates only these
   * (`bindingSiteNames`, `abstract-boxed-expression.ts`). */
  readonly clauseLocal: ReadonlySet<string>;
}

/**
 * What `expr` binds, read from its operator DEFINITION rather than from a
 * `localScope`.
 *
 * `boundVariableNames` (`binders.ts`) answers the same question off the
 * `localScope` a canonicalized binder carries, and is the right source
 * everywhere a bound tree is walked. A RAW tree has no such scope yet, so a
 * pass running before (or instead of) canonicalization — the partial
 * `CanonicalForm[]` pipeline in `canonical.ts` — has only the definition to go
 * on. Without it, such a pass rewrites a binder's own index: `Sum`'s `i` came
 * back as the imaginary unit, at the binding site and in the body alike.
 *
 * A `Function` literal is definition-less and is handled by its parameter list,
 * matching `boundVariableNames`; its parameters have no clause ordering, so
 * they are visible throughout. Returns `undefined` for a node that binds
 * nothing, which is the overwhelming majority.
 *
 * `phase` selects the sites read: `'pre'` (the default) is the only phase a
 * RAW tree can answer for — the sites knowable before the canonical handler
 * reshapes the operands; `'post'` is authoritative on a canonical (or
 * structural) tree, and is what the free-variable walk and the rewrite walks
 * ask for a bound tree (`boundVariableNamesInOperand`, `binders.ts`).
 */
export function declaredBinders(
  expr: Expression,
  phase: 'pre' | 'post' = 'pre'
): DeclaredBinders | undefined {
  if (!isFunction(expr)) return undefined;

  const visibleFrom = new Map<string, number>();
  const clauseLocal = new Set<string>();

  if (expr.operator === 'Function') {
    // The PLURAL helper: a destructuring parameter (`((p, q)) => …`) binds one
    // name per pattern leaf, and a walk that missed them would treat a body
    // occurrence of `p` as free.
    for (let i = 1; i < expr.nops; i++)
      for (const n of functionLiteralParameterNames(expr.ops[i]))
        visibleFrom.set(n, 0);
    return visibleFrom.size === 0
      ? undefined
      : { visibleFrom, firstClause: Number.POSITIVE_INFINITY, clauseLocal };
  }

  const sites = bindingSiteSelectorOf(expr);
  if (sites === undefined) return undefined;

  let firstClause = Number.POSITIVE_INFINITY;
  for (const site of sites(expr.ops, phase)) {
    const sym = symbolAtSite(expr.ops, site.path);
    if (sym === undefined) continue;
    const from = site.clauseLocal ? site.path[0] : 0;
    if (site.clauseLocal) {
      firstClause = Math.min(firstClause, site.path[0]);
      clauseLocal.add(sym.symbol);
    }
    visibleFrom.set(
      sym.symbol,
      Math.min(visibleFrom.get(sym.symbol) ?? from, from)
    );
  }
  return visibleFrom.size === 0
    ? undefined
    : { visibleFrom, firstClause, clauseLocal };
}

/**
 * Is `name`, bound by `binders`, in scope in operand `operandIndex`? A name
 * `binders` does not list is not bound by this node at all (`false`); a
 * clause-local name is in scope from its own clause onward and in every
 * operand before the first clause (the body); any other bound name is in
 * scope throughout.
 */
export function binderBoundAt(
  binders: DeclaredBinders | undefined,
  name: string,
  operandIndex: number
): boolean {
  const from = binders?.visibleFrom.get(name);
  if (from === undefined) return false;
  return operandIndex < binders!.firstClause || from <= operandIndex;
}

/**
 * `outer` extended with the names `binders` makes visible at operand
 * `operandIndex` — the shadow set a walk descending into that operand must
 * carry.
 *
 * Returns `outer` itself when the operand sees no new name, so an untouched
 * subtree keeps walking with the caller's set rather than a fresh copy.
 */
export function binderShadowAt(
  binders: DeclaredBinders | undefined,
  operandIndex: number,
  outer: ReadonlySet<string> | undefined
): ReadonlySet<string> | undefined {
  if (binders === undefined) return outer;
  // An operand before the first clause is the body: it is inside every clause,
  // so it sees every binding.
  const limit =
    operandIndex < binders.firstClause
      ? Number.POSITIVE_INFINITY
      : operandIndex;
  let visible: Set<string> | undefined;
  for (const [name, from] of binders.visibleFrom) {
    if (from > limit || outer?.has(name)) continue;
    visible ??= new Set(outer);
    visible.add(name);
  }
  return visible ?? outer;
}

/**
 * The names an operand list would bind under `operator`, ignoring clause
 * visibility — the flat question "which symbols does rebuilding this node
 * declare?", asked by a rewrite that must decide whether reusing the receiver's
 * scope is safe (`scopeForRebuild`, `boxed-function.ts`).
 */
export function declaredBinderNamesOf(
  engine: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>
): readonly string[] {
  if (operator === 'Function') {
    const names: string[] = [];
    for (let i = 1; i < ops.length; i++)
      names.push(...functionLiteralParameterNames(ops[i]));
    return names.length === 0 ? NO_NAMES : names;
  }

  // Inline operator-def check: importing `isOperatorDef` from `utils.ts` would
  // break this module's leaf tier (see the header note).
  const def = engine.lookupDefinition(operator);
  const sites =
    def !== undefined && 'operator' in def
      ? def.operator.bindingSites
      : undefined;
  if (sites === undefined) return NO_NAMES;

  const names: string[] = [];
  for (const site of sites(ops, 'pre')) {
    const sym = symbolAtSite(ops, site.path);
    if (sym !== undefined) names.push(sym.symbol);
  }
  return names.length === 0 ? NO_NAMES : names;
}

/**
 * The scope a rewrite should rebuild `operator(ops)` onto, given the scope the
 * node being rewritten owned.
 *
 * Normally that is the SAME scope object, and it has to be: minting a fresh
 * one parents it at the rewriting site, so a binder nested inside keeps a
 * `parent` pointing at the original outer scope while the rebuilt node
 * advertises a different one — the chain from the inner body then no longer
 * reaches the outer binder's index (`docs/SCOPING-MODEL.md`, "Rebuilding a
 * scoped node").
 *
 * The exception is a rewrite that RENAMES the binding site itself. Reuse is
 * safe only because the scope already binds every name the rebuilt node
 * declares, so canonicalization adds nothing to it; a rename breaks that.
 * `.subs()`, `.map()` and `.replace()` are general-purpose and rewrite the
 * binding site like any other operand (`sum.subs({ i: 'k' })` is a rename), and
 * `canonicalizeBinder` declares an unknown site name INTO the scope it is
 * handed — which would be the original expression's own scope, still live and
 * still reachable by its holder. So a rename gets a fresh scope: the rebuilt
 * node is self-consistent and the original is left untouched.
 *
 * This is the one guarantee the `rewriteWithBinders` precedent gets for free —
 * its visitor contract returns a shadowed occurrence unchanged, so its rebuilt
 * operands can never rename a site.
 */
export function scopeForRebuild(
  scope: Scope | undefined,
  engine: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>
): Scope | undefined {
  if (scope === undefined) return undefined;
  for (const name of declaredBinderNamesOf(engine, operator, ops))
    if (!scope.bindings.has(name)) return undefined;
  return scope;
}

/** The binding-site selector `expr`'s operator declares, if any. */
function bindingSiteSelectorOf(
  expr: Expression & { operator: string }
): BindingSiteSelector | undefined {
  // Inline operator-def check: importing `isOperatorDef` from `utils.ts` would
  // break this module's leaf tier (see the header note).
  const def = expr.engine.lookupDefinition(expr.operator);
  return def !== undefined && 'operator' in def
    ? def.operator.bindingSites
    : undefined;
}

const NO_NAMES: readonly string[] = [];

/**
 * The symbol a {@link BindingSite}'s `path` points at, or `undefined` if the
 * path does not lead to one. `path` is relative to an operand ARRAY: `[1]` is
 * `ops[1]`, `[2, 0]` the first operand of `ops[2]`.
 */
export function symbolAtSite(
  ops: ReadonlyArray<Expression>,
  path: readonly number[]
): (Expression & { symbol: string }) | undefined {
  let node: Expression | undefined = ops[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (!isFunction(node)) return undefined;
    node = node.ops[path[i]];
  }
  return isSymbol(node) ? node : undefined;
}

/**
 * A copy of `ops` with the node at `path` replaced by `replacement`, rebuilding
 * only the nodes on the path and preserving every other subtree by identity.
 */
export function replaceAtSite(
  ops: ReadonlyArray<Expression>,
  path: readonly number[],
  replacement: Expression
): ReadonlyArray<Expression> {
  if (ops[path[0]] === undefined) return ops;
  const next = [...ops];
  next[path[0]] = replaceAtPath(next[path[0]], path.slice(1), replacement);
  return next;
}

/**
 * Replace the node at `path` (relative to the operands of `expr`; the empty
 * path is `expr` itself) with `replacement`.
 *
 * Intermediate nodes are rebuilt with `_fn` rather than `ce.function()`: this
 * is a surgical replacement of one symbol by an equal-but-differently-bound
 * one, and re-running a canonical handler could reshape the node.
 *
 * An intermediate on a live binding-site path is either RAW (the parse route
 * — a lazy operator's held operands) or a CANONICAL wrapper the operator's
 * own canonical handler just built (raw `Tuple` → `Limits`). It is never
 * STRUCTURAL: structural means bound, and binding an indexing set outside
 * its binder captures the site symbol in the ambient scope (`i` resolves to
 * the imaginary unit), so `symbolAtSite` finds no live symbol and the
 * operator errors out before this function runs. The `_fn` rebuild below
 * therefore only ever re-marks nodes that were already canonical; the assert
 * is the tripwire if that invariant is ever violated (a structural node
 * rebuilt with `_fn` would falsely claim `isCanonical` while keeping its
 * non-canonical shape).
 */
function replaceAtPath(
  expr: Expression,
  path: readonly number[],
  replacement: Expression
): Expression {
  if (path.length === 0) return replacement;
  if (!isFunction(expr)) return expr;
  const ops = expr.ops;
  const i = path[0];
  const op = ops[i];
  if (op === undefined) return expr;
  const next = replaceAtPath(op, path.slice(1), replacement);
  if (next === op) return expr;
  const newOps = [...ops];
  newOps[i] = next;
  const ce = expr.engine;
  if (!expr.isCanonical && !expr.isStructural)
    return ce.function(expr.operator, newOps, { form: 'raw' });
  console.assert(
    expr.isCanonical,
    'replaceAtPath: a STRUCTURAL intermediate on a binding-site path — rebuilding it with `_fn` would falsely mark it canonical. See the invariant in the JSDoc.'
  );
  return ce._fn(expr.operator, newOps, { scope: expr.localScope });
}
