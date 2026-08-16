import type { TypeString } from '../../common/type/types.js';
import type {
  BindingSite,
  BindingSiteSelector,
  Expression,
} from '../global-types.js';

import { isFunction, isSymbol } from './type-guards.js';
import { functionLiteralParameterName } from './function-literal.js';

/**
 * The prebuilt binding-site selectors — the vocabulary an operator definition
 * uses to say **"this operand is my bound variable, bind it in my scope"**
 * (`docs/plans/2026-07-26-binder-mechanism-design.md` §1.2).
 *
 * Before this existed, every binder answered that question its own way — by
 * name (`rubi`), by string (`RubiDriver.int`), by position inside a `Limits`
 * operand (`nDSolveFunction`), by a fixed operand index (`Series`), or by
 * relying on canonicalization order (pipe desugaring) — and each improvisation
 * bound the variable in a slightly different scope. Five wrong-scope defects
 * came out of that (see §The recurring defect in
 * `docs/plans/2026-07-24-defining-scope-dereference-design.md`).
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

/** The operand shapes `canonicalIndexingSet`/`canonicalLimits` recognize as
 * carrying an index in their first position. */
const INDEXING_SET_OPERATORS = new Set([
  'Limits',
  'Element',
  'Tuple',
  'Triple',
  'Pair',
  'Single',
  'Set',
]);

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
  type: TypeString | undefined
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
  const site =
    isFunction(op) && INDEXING_SET_OPERATORS.has(op.operator)
      ? siteFor(op.ops[0], [i, 0], type)
      : // A bare symbol (`Sum(body, n, 1, 10)`) or `Hold(n)`.
        siteFor(op, [i], type);
  return site === undefined ? [] : [{ ...site, clauseLocal: true }];
}

/**
 * The index of each indexing-set operand from `first` onward — the shapes
 * `canonicalIndexingSet` and `canonicalLimits` already recognize
 * (`Limits`/`Element`/`Tuple`/`Triple`/`Pair`/`Single`/`Set`, a bare symbol,
 * or any of those held).
 *
 * `Sum`/`Product`: `{ scoped: indexingSetSites(1, 'integer') }`.
 */
export function indexingSetSites(
  first: number,
  type?: TypeString
): BindingSiteSelector {
  return (ops) => {
    const sites: BindingSite[] = [];
    for (let i = first; i < ops.length; i++)
      sites.push(...indexingSetSite(ops[i], i, type));
    return sites.length === 0 ? NO_SITES : sites;
  };
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
    const sites = indexingSetSite(ops[index], index, type);
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
        path: isFunction(param, 'Typed') ? [op, i, 0] : [op, i],
      });
    }
    return sites.length === 0 ? NO_SITES : sites;
  };
}

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
