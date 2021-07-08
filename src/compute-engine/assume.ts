import {
  applyRecursively,
  getArg,
  getDictionary,
  getFunctionName,
  getSymbolName,
  getTail,
  isAtomic,
  MISSING,
  UNDEFINED,
} from '../common/utils';
import { Expression } from '../math-json/math-json-format';
import {
  asNumber,
  compareNumericDomainInfo,
  inferNumericDomainInfo,
  NumericDomainInfo,
  NUMERIC_DOMAIN_INFO,
} from './dictionary/domains';
import {
  AssumeResult,
  ComputeEngine,
  Numeric,
} from '../math-json/compute-engine-interface';
import { CortexError } from './utils';
import { match } from './patterns';

/**
 * `lhs` is a symbol or a number.
 * `rhs` is what we're comparing it with.
 *
 */
export function checkCachedInfo(
  ce: ComputeEngine,
  lhs: null | Expression,
  op: string, // 'Equal' | 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual' | 'Element',
  rhs: null | Expression
): boolean | undefined | null {
  if (lhs === null || rhs === null) return null;

  // If we couldn't get or calculate a NumericDomainInfo,
  // bail.
  const lhsInfo = getCachedNumericDomainInfo(ce, lhs);
  if (lhsInfo === null) return null;

  const rhsInfo = getCachedNumericDomainInfo(ce, rhs);
  if (rhsInfo === null) return null;

  return compareNumericDomainInfo(lhsInfo, op, rhsInfo);
}

/** Assume proposition is in normalizeProposition form already */
export function checkAssumption(
  ce: ComputeEngine,
  proposition: Expression
): boolean | undefined {
  // During constructions of the context, no assumptions to check
  if (!ce.context || !ce.context.assumptions) return false;
  console.assert(
    assertNormalProposition(proposition),
    'Expected a proposition in normal form',
    proposition
  );

  return ce.assumptions.get(proposition);
}

function getCachedNumericDomainInfo(
  ce: ComputeEngine,
  expr: Expression
): NumericDomainInfo | null {
  //  During construction, no context and no assumptions.
  if (!ce.context) return inferNumericDomainInfo(expr);

  const symbol = getSymbolName(expr);
  if (symbol === null) {
    // It's not a symbol, it's not going to be cached
    return inferNumericDomainInfo(expr);
  }
  const cache = getNumericDomainInfoCache(ce);

  let result = cache.get(symbol) ?? null;
  if (result === null) {
    // It wasn't in the cache: add it.
    result = inferNumericDomainInfo(expr);
    if (result !== null) cache.set(symbol, result);
  }

  return result;
}

/**
 * Return the cache of `NumericDomainInfo` indexed by symbol
 */
function getNumericDomainInfoCache(
  ce: ComputeEngine
): Map<string, NumericDomainInfo> {
  return ce.cache<Map<string, NumericDomainInfo>>('numeric-domain-info', () => {
    const result = new Map<string, NumericDomainInfo>();
    for (const [assumption, val] of ce.assumptions) {
      if (val) cacheProposition(result, assumption);
    }
    return result;
  });
}

function resetNumericDomainInfoCache(ce: ComputeEngine): void {
  ce.cache<Map<string, NumericDomainInfo>>('numeric-domain-info', null);
}

/**
 * Convert a proposition to a `NumericDomainInfo`, if possible.
 * The proposition can have a shape of:
 * [`Equal`, x, c]
 * [`Less`, x, c]
 * [`LessEqual`, x, c]
 * [`Greater`, x, c]
 * [`GreaterEqual`, x, c]
 * [`Element`, x, ["Interval"...]]
 * [`Element`, x, ["Range"...]]
 * [`Element`, x, ["Set"...]]
 * [`Element`, x, ["Multiple"...]]
 * [`Element`, x, _numeric_domain_]
 */

function getNumericDomainInfoFromProposition(
  prop: Expression
): [symbol: null | string, info: NumericDomainInfo | null] {
  console.assert(
    assertNormalProposition(prop),
    'Expected a proposition in normal form',
    prop
  );

  const head = getFunctionName(prop);
  const symbol = getSymbolName(getArg(prop, 1));
  if (symbol === null) return [null, null];
  const rhs = getArg(prop, 2);

  if (head === 'Element') {
    const rhsName = getFunctionName(rhs);
    if (rhsName === 'Interval') {
      let min: number | null = null;
      const arg1 = getArg(rhs, 1);
      let open: 'left' | 'right' | 'both' | undefined = undefined;
      if (getFunctionName(arg1) === 'Open') {
        min = asNumber(getArg(arg1, 1));
        open = 'left';
      } else {
        min = asNumber(arg1);
      }
      if (min === null) return [null, null];

      const arg2 = getArg(rhs, 2);
      let max: number | null = null;
      if (getFunctionName(arg2) === 'Open') {
        max = asNumber(getArg(arg2, 1));
        open = open === 'left' ? 'both' : 'right';
      } else {
        max = asNumber(arg2);
      }

      if (max === null) return [null, null];
      return [symbol, { domain: 'Integer', min, max, open }];
    }

    if (rhsName === 'Range') {
      const min = asNumber(getArg(rhs, 1));
      if (min === null) return [null, null];
      const max = asNumber(getArg(rhs, 2));
      if (max === null) return [null, null];
      return [symbol, { domain: 'Integer', min, max }];
    }

    if (rhsName === 'Set') {
      // @todo
      return [null, null];
    }

    if (rhsName === 'Multiple') {
      // @todo
      return [null, null];
    }

    const info = NUMERIC_DOMAIN_INFO[getSymbolName(rhs) ?? MISSING];
    if (info === null) return [null, null];
    return [symbol, info];
  }

  if (head === 'Equal') {
    const c = asNumber(rhs);
    if (c === null) return [null, null];
    return [symbol, { domain: 'RealNumber', min: c, max: c }];
  }

  if (head === 'Less') {
    const c = asNumber(rhs);
    if (c === null) return [null, null];
    return [
      symbol,
      { domain: 'RealNumber', min: -Infinity, max: c, open: 'right' },
    ];
  }

  if (head === 'LessEqual') {
    const c = asNumber(rhs);
    if (c === null) return [null, null];
    return [symbol, { domain: 'RealNumber', min: -Infinity, max: c }];
  }

  if (head === 'Greater') {
    const c = asNumber(rhs);
    if (c === null) return [null, null];
    return [
      symbol,
      { domain: 'RealNumber', min: c, max: +Infinity, open: 'right' },
    ];
  }

  if (head === 'GreaterEqual') {
    const c = asNumber(rhs);
    if (c === null) return [null, null];
    return [symbol, { domain: 'RealNumber', min: c, max: +Infinity }];
  }

  return [null, null];
}

/**
 * Add an assumption to a cache of `NumericDomainInfo`.
 *
 * Note that this cache only contains "positive" assertions, i.e.
 * "x = 0", not the negative ones ("x ≠ 0") which are only stored in the
 * knowledge base.
 *
 * `proposition` is normalized and can have the shape:
 * [`Equal`, x, c]
 * [`Less`, x, c]
 * [`LessEqual`, x, c]
 * [`Greater`, x, c]
 * [`GreaterEqual`, x, c]
 * [`Element`, x, ["Interval"...]]
 * [`Element`, x, ["Range"...]]
 * [`Element`, x, ["Set"...]]
 * [`Element`, x, ["Multiple"...]]
 * [`Element`, x, _numeric_domain_]
 */
function cacheProposition(
  cache: Map<string, NumericDomainInfo>,
  proposition: Expression
): void {
  console.assert(
    assertNormalProposition(proposition),
    'Expected a proposition in normal form',
    proposition
  );
  const [symbol, info] = getNumericDomainInfoFromProposition(proposition);
  if (symbol === null || info === null) return;
  cache.set(symbol, info);
}

function assertNormalProposition(prop: Expression): boolean {
  const name = getFunctionName(prop);

  if (
    name === 'Not' ||
    name === 'And' ||
    name === 'Or' ||
    name === 'Element' ||
    name === 'Subset' ||
    name === 'SubsetEqual'
  ) {
    return true;
  }

  if (
    name === 'Equal' ||
    name === 'NotEqual' ||
    name === 'Less' ||
    name === 'LessEqual' ||
    name === 'Greater' ||
    name === 'GreaterEqual'
  ) {
    // The first argument should be a symbol.
    if (getSymbolName(getArg(prop, 1)) !== null) return true;
    return false;
  }
  return false;
}

export function internalAssume<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  proposition: Expression<T>
): AssumeResult {
  const head = getFunctionName(proposition);

  if (!head) throw new CortexError({ message: 'expected-predicate' });

  let val = true;

  let prop: Expression<T> | null = proposition;

  if (head === 'And') {
    const v = ce.is(proposition);
    if (v === true) return 'tautology';
    if (v === false) return 'contradiction';
    for (const prop of getTail(proposition)) {
      const result = internalAssume(ce, prop);
      if (result !== 'ok') return result;
    }
    return 'ok';
  } else {
    prop = evaluateBoolean(ce, prop);
    if (prop !== null && getFunctionName(prop) === 'Not') {
      prop = getArg(prop, 1);
      val = false;
    }
  }

  if (prop === null) return 'not-a-predicate';

  const v = ce.is(prop);

  // Is the proposition a contradiction or tautology?
  if (v !== undefined) {
    if (v === val) return 'tautology';
    if (v !== val) return 'contradiction';
  }

  // Add a new assumption to the `assumptions` knowledge base
  ce.assumptions.set(prop, val);

  // And invalidate the symbols cache
  // (other cache entries may have become out of date because of this
  // new assumption. We'll repopulate the cache on demand later)
  resetNumericDomainInfoCache(ce);

  // @todo: could check any assumptions that have become tautologies
  // (i.e. if `proposition` was more general than an existing assumption)
  // and remove them.

  return 'ok';
}

export function getAssumptionsAbout<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  symbol: string
): Expression<T>[] {
  const result: Expression<T>[] = [];
  for (const [assumption, val] of ce.assumptions) {
    const vars = ce.getVars(assumption);
    if (vars.has(symbol)) {
      result.push(val ? assumption : ['Not', assumption]);
    }
  }

  return [];
}

export function forgetAll(ce: ComputeEngine): void {
  ce.assumptions.clear();
  resetNumericDomainInfoCache(ce);
}

export function forget<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  symbol: string
): void {
  for (const [assumption, _val] of ce.assumptions) {
    const vars = ce.getVars(assumption);
    if (vars.has(symbol)) ce.assumptions.delete(assumption);
  }
  resetNumericDomainInfoCache(ce);
}

/**
 * Return a simplified expression of a canonical boolean expression
 *
 * - Not(Not(x)) = x
 * - Not(True) = False
 * - Not(False) = True
 * - Not(Maybe) = Maybe
 * - And(x, True) = x
 * - Or(x, False) = x
 * - And(And(x, y), z) = And(x, y, z)
 * - Or(Or(x, y), z) = Or(x, y, z)
 *
 * Call evaluatePredicate() to attempt to resolve
 *
 */
export function simplifyBoolean<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  expr: Expression<T>
): Expression<T> {
  const originalExpr = expr;
  //
  // Constants, numbers...
  //
  if (isAtomic(expr)) return expr;

  //
  // Dictionaries
  //
  if (getDictionary(expr) !== null) {
    return applyRecursively(expr, (x) => simplifyBoolean(ce, x));
  }

  const name = getFunctionName(expr);

  if (name === 'NotEqual') return ['Not', ['Equal', ...getTail(expr)]];
  if (name === 'NotElement') return ['Not', ['Element', ...getTail(expr)]];

  //
  // `And`: conjunction, all must be true
  //
  if (name === 'And') {
    const args: Expression<T>[] = [];
    for (const p of getTail(expr)) {
      let v: null | Expression<T> = simplifyBoolean(ce, p);
      if (v === 'False') return 'False';
      if (v !== 'True') {
        // Check  if `v` matches one of the existing args
        for (const arg of args) {
          if (match(arg, v)) {
            v = null;
            break;
          } else if (match(['Not', arg], v) || match(arg, ['Not', v])) {
            // And(a, Not(a))
            return 'False';
          }
        }
      }
      if (v !== null) args.push(v);
    }
    if (args.length === 0) return 'True';
    if (args.length === 1) return args[0];
    return ['And', ...args];
  }

  //
  // `Or`: disjunction, any must be true
  //
  if (name === 'Or') {
    const args: Expression<T>[] = [];
    for (const p of getTail(expr)) {
      let v: null | Expression<T> = simplifyBoolean(ce, p);
      if (v === 'True') return 'True';
      if (v !== 'False') {
        // Check  if `v` matches one of the existing args
        for (const arg of args) {
          if (match(arg, v)) {
            v = null;
            break;
          } else if (match(['Not', arg], v) || match(arg, ['Not', v])) {
            // Or(a, Not(a))
            return 'True';
          }
        }
      }
    }

    if (args.length === 0) return 'False';
    if (args.length === 1) return args[0];
    return ['Or', ...args];
  }

  if (name === 'Implies') {
    // p => q := (not p) or q
    // if           Q=F & P= T      F
    // otherwise                    T

    const lhs = simplifyBoolean(ce, getArg(expr, 1) ?? MISSING);
    const rhs = simplifyBoolean(ce, getArg(expr, 2) ?? MISSING);
    if (rhs === 'True') return 'True';
    if (
      (lhs === 'True' || lhs === 'False' || lhs === 'Maybe') &&
      (rhs === 'True' || rhs === 'False' || rhs === 'Maybe')
    ) {
      if (lhs === 'True' && rhs === 'False') return 'False';
      return 'True';
    }

    return ['Implies', lhs, rhs];
  }

  if (name === 'Equivalent') {
    // p <=> q := (p and q) or (not p and not q)
    // (aka \iff)
    // if (q = p), T. Otherwise, F

    const lhs = simplifyBoolean(ce, getArg(expr, 1) ?? MISSING);
    const rhs = simplifyBoolean(ce, getArg(expr, 2) ?? MISSING);
    if (
      (lhs === 'True' || lhs === 'False' || lhs === 'Maybe') &&
      (rhs === 'True' || rhs === 'False' || rhs === 'Maybe')
    ) {
      return lhs === rhs ? 'True' : 'False';
    }
    return ['Equivalent', lhs, rhs];
  }

  // if (name === 'Xor') {
  // p XOR q := T
  // if (p != q) (true if an odd number of e are True) \veebar or \oplus

  // @todo
  // }

  let sub = match(expr, ['Not', 'True']);
  if (sub) return 'False';
  sub = match(expr, ['Not', 'False']);
  if (sub) return 'True';
  sub = match(expr, ['Not', 'Maybe']);
  if (sub) return 'Maybe';

  // DeMorgan's Laws
  sub = match(expr, ['Not', ['And', ['Not', '_a'], ['Not', '_b']]]);
  if (sub) return simplifyBoolean(ce, ['Or', sub.a, sub.b]);

  sub = match(expr, ['And', ['Not', '_a'], ['Not', '_b']]);
  if (sub) return simplifyBoolean(ce, ['Not', ['Or', sub.a, sub.b]]);

  sub = match(expr, ['Not', ['Or', ['Not', '_a'], ['Not', '_b']]]);
  if (sub) return simplifyBoolean(ce, ['And', sub.a, sub.b]);

  sub = match(expr, ['Or', ['Not', '_a'], ['Not', '_b']]);
  if (sub) return simplifyBoolean(ce, ['Not', ['And', sub.a, sub.b]]);

  sub = match(expr, ['Not', ['Not', '_a']]);
  if (sub) return simplifyBoolean(ce, sub.a);

  if (ce.cost(expr) > ce.cost(originalExpr)) return originalExpr;
  return expr;
}

/**
 * Evaluate this expression as a predicate:
 * - equality: `Equal`, `NotEqual`
 * - inequality: `Less`, `LessEqual`, `Greater`, `GreaterEqual`
 * - set membership: `Element`, `NotElement`
 *
 * Attempts to put equalities and inequalities in normal form with
 * the lhs a symbol.
 *
 * Call `checkCachedInfo()` and `checkAssumption()` to attempt
 * to evaluate.
 *
 * @todo evaluate other operations: NotSubsetEqual, Superset, etc...
 * @todo: call evaluate on function that have a dictionary def and are
 * a predicate.
 */
function evaluateBooleanRecursive<T extends number = Numeric>(
  ce: ComputeEngine,
  expr: null | Expression<T>
): Expression<T> {
  if (expr === null) return UNDEFINED;
  if (isAtomic(expr)) return expr;

  if (getDictionary(expr) !== null) {
    return applyRecursively(expr, (x) => evaluateBooleanRecursive(ce, x));
  }

  const head = getFunctionName(expr);

  //
  // `Equal`, `Less`, `LessEqual`, `Greater`, `GreaterEqual`
  //
  // Solve for univariate
  //
  if (
    head === 'Equal' ||
    head === 'Less' ||
    head === 'LessEqual' ||
    head === 'Greater' ||
    head === 'GreaterEqual'
  ) {
    const vars = ce.getVars(expr);
    if (vars !== null && vars.size === 1) {
      const solutions = ce.solve(expr, vars);
      if (solutions !== null) {
        if (solutions.length === 1) return solutions[0];

        return ['Or', ...solutions];
      }
    }
  }

  // Note: we don't need to check NotEqual and NotElement: they have been
  // handled above
  if (
    [
      'Equal',
      'Element',
      'Subset',
      'SubsetEqual',
      'Greater',
      'GreaterEqual',
      'Less',
      'LessEqual',
    ].includes(head)
  ) {
    //
    // Check cached `NumericDomainInfo` or exact assumption
    //
    const arg1 = evaluateBooleanRecursive(ce, getArg(expr, 1));
    const arg2 = evaluateBooleanRecursive(ce, getArg(expr, 2));
    if (head === 'Element') {
      // @todo check if arg1 matches the set definition (extension or condition)
      // by calling def[head].elementOf(arg1, arg2)
    }
    if (head === 'SubsetEqual' || head === 'Subset') {
      // @todo check if arg1 matches the set definition (extension or condition)
      // by calling def[head].elementOf(arg1, arg2)
    }
    let result = checkCachedInfo(ce, arg1, head, arg2);
    if (result === null && getSymbolName(arg1) !== null) {
      result = checkAssumption(ce, [head, arg1, arg2]);
    }

    if (result === true) return 'True';
    if (result === false) return 'False';
    return [head, arg1, arg2];
  }

  return applyRecursively(expr, (x) => evaluateBooleanRecursive(ce, x));
}

export function evaluateBoolean<T extends number = Numeric>(
  ce: ComputeEngine,
  expr: null | Expression<T>
): Expression<T> | null {
  if (expr === null) return null;
  expr = evaluateBooleanRecursive(ce, expr);
  expr = ce.format(expr, 'canonical-boolean');
  return simplifyBoolean(ce, expr);
}
