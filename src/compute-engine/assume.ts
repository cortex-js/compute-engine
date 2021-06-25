import {
  getArg,
  getComplexValue,
  getDecimalValue,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getSymbolName,
  getTail,
  MISSING,
  NOTHING,
  UNDEFINED,
} from '../common/utils';
import { Expression } from '../public';
import { inferNumericDomain, NumericDomain } from './domains';
import { match, Substitution } from './patterns';
import { ComputeEngine, Numeric } from './public';
import { CortexError } from './utils';

/**
 * Simple assumptions about symbols or numbers (their domain, min value, max value and'
 * the values they are **not**) are kept in a `AtomicInfo` cache.
 */
export type AtomicInfo = {
  domain?: NumericDomain;
  min: number;
  max: number;
  open?: 'left' | 'right' | 'both';
  excludedValues?: number[];
};

/**
 * Provide an answer to questions about
 * - equality
 * - inequality
 * - set/domain membership
 * - subset of
 *
 * Consider assumptions and evaluate boolean expressions.
 *
 * The proposition can be a boolean expression including:
 * - `And`
 * - `Or`
 * - `Not`
 *
 */
export function internalIs(
  ce: ComputeEngine,
  proposition: Expression
): boolean | undefined {
  //
  // Constants
  //
  if (
    proposition === null ||
    proposition === UNDEFINED ||
    proposition === MISSING ||
    proposition === NOTHING
  ) {
    return undefined;
  }
  if (proposition === 'True') return true;
  if (proposition === 'False') return false;
  if (proposition === 'Maybe') return undefined;

  //
  // `And`: conjunction, all must be true
  //
  let name = getFunctionName(proposition);
  if (name === 'And') {
    for (const p of getTail(proposition)) {
      const v = internalIs(ce, p);
      if (v !== true) return v;
    }
    return true;
  }

  //
  // `Or`: disjunction, any must be true
  //
  if (name === 'Or') {
    for (const p of getTail(proposition)) {
      const v = internalIs(ce, p);
      if (v !== false) return v;
    }
    return true;
  }

  const prop = normalizeProposition(ce, proposition);
  if (prop === null) return undefined;

  name = getFunctionName(prop);

  // @todo: we could:
  // 1/ check the list of variables in the proposition
  // 2/ if a single variable, solve() for this var
  // 3/ if multiple vars, solve for each var, then `["And"...]` the solutions

  //
  // `Not`: negation
  //
  if (name === 'Not') {
    const v = internalIs(ce, getArg(prop, 1) ?? MISSING);
    if (v === undefined) return undefined;
    return !v;
  }

  //
  // Check symbol info
  //
  let sub = match(['Equal', ['Subtract', '_x', '_a'], 0], prop);
  if (sub) return checkAtomic(ce, sub.x, '=', sub.a) ?? undefined;
  sub = match(['Equal', ['Add', '_x', '_a'], 0], prop);
  if (sub) return checkAtomic(ce, sub.x, '=', ['Negate', sub.a]) ?? undefined;
  sub = match(['Equal', '_x', 0], prop);
  if (sub) return checkAtomic(ce, sub.x, '=', 0) ?? undefined;
  sub = match(['Less', ['Add', '_x', '_a'], 0], prop);
  if (sub) return checkAtomic(ce, sub.x, '<', ['Negate', sub.a]) ?? undefined;
  sub = match(['Less', '_x', 0], prop);
  if (sub) return checkAtomic(ce, sub.x, '<', 0) ?? undefined;
  sub = match(['LessEqual', ['Add', '_x', '_a'], 0], prop);
  if (sub) return checkAtomic(ce, sub.x, '<=', ['Negate', sub.a]) ?? undefined;
  sub = match(['LessEqual', '_x', 0], prop);
  if (sub) return checkAtomic(ce, sub.x, '<=', 0) ?? undefined;
  sub = match(['Element', '_x', '_a'], prop);
  if (sub) return checkAtomic(ce, sub.x, 'in', sub.a) ?? undefined;

  //
  // Check exact assumptions...
  //
  const v = checkAssumption(ce, prop);
  if (v !== undefined) return v;

  // Consider evaluating, and checking more general assumptions
  // e.g. match('Element', lhs, x)

  // const vars = ce.getVars(prop);
  // if (vars.size === 1) {
  //   const x = vars.entries[0];
  //   let sub: Substitution<Numeric> | null = null;
  //   if (name === 'Equal') {
  //     let lhsSub = match(['Equal', ['Add', x, '_a']], prop);
  //     let a: number | null = null;
  //     if (lhsSub) {
  //       a = getNumberValue(lhsSub.a);
  //     } else {
  //       lhsSub = match(['Equal', ['Subtract', x, '_a']], prop);
  //       if (lhsSub) {
  //         a = -(getNumberValue(lhsSub.a) ?? NaN);
  //       }
  //     }

  //     if (a !== null) {
  //       sub = ce.ask(['Equal', ['Add', x, '_a']]);
  //       if (sub) {
  //         if (a !== getNumberValue(x)) return false;
  //       }
  //     }
  //   } else if (name === 'Less') {
  //   } else if (name === 'Element') {
  //   } else if (name === 'Subset') {
  //   }
  // }
  return undefined;
}

/** Assume proposition is in normalizeProposition form already */
export function checkAssumption(
  ce: ComputeEngine,
  proposition: Expression
): boolean | undefined {
  console.assert(assertNormalProposition(proposition));

  return ce.assumptions.get(proposition);
}

/** Check a simple proposition about a number or symbol
 * - lhs is a symbol or number
 * - rhs is a number or a Range/Interval or a NumericDomain
 *
 */
export function checkAtomic(
  ce: ComputeEngine,
  lhs: Expression,
  op: '=' | '<' | '<=' | '>' | '>=' | 'in',
  rhs: Expression
): boolean | undefined | null {
  // If lhs is a symbol, `getAtomicInfo()` returns cached info about the symbol
  // If lhs is a number, it returns a synthetic info
  const lhsInfo = getAtomicInfo(ce, lhs);
  if (lhsInfo === null) return null;

  //
  // Is it a domain check?
  //
  if (op === 'in') {
    if (lhsInfo.domain === undefined) return null;

    const name = getFunctionName(rhs);

    // Check if lhs is element of a rhs range/interval
    if (name === 'Range' || name === 'Interval') {
      if (name === 'Range' && lhsInfo.domain !== 'Integer') return false;

      // Could be Open left or Open right
      const rhsInfo = getAtomicInfo(ce, rhs);
      if (rhsInfo === null) return null;

      let cmp = compare(lhsInfo.min, rhsInfo);
      if (cmp !== 'in') return false;

      cmp = compare(lhsInfo.max, rhsInfo);
      if (cmp !== 'in') return false;

      return true;
    } else if (name === 'Multiple') {
      // @todo
    } else if (name === null) {
      // Check if element of a domain
      if (rhs === lhsInfo.domain) return true;
      const dom = getSymbolName(rhs);
      if (dom !== null) return isSubdomain(dom, lhsInfo.domain);
    }
    return null;
  }

  if (op === '=' && lhsInfo.excludedValues) {
    const rhsVal = asNumber(rhs);
    if (rhsVal !== null && lhsInfo.excludedValues.includes(rhsVal))
      return false;
  }

  const rhsInfo = getAtomicInfo(ce, rhs);
  if (rhsInfo === null) return null;

  const cmp = compare(lhs, rhsInfo);

  if (cmp === 'in') return undefined;

  if (op === '=') {
    return cmp === '=';
  } else if (op === '<') {
    return cmp === '<';
  } else if (op === '>') {
    return cmp === '>';
  } else if (op === '<=') {
    return cmp === '<' || cmp === '=';
  } else if (op === '>=') {
    return cmp === '>' || cmp === '=';
  }
  return null;
}

/** Get some basic info about
 * - a symbol
 * - a numeric
 * - a range/interval
 */
export function getAtomicInfo(
  ce: ComputeEngine,
  expr: Expression
): AtomicInfo | null {
  const symbol = getSymbolName(expr);
  if (symbol !== null) return getSymbols(ce).get(symbol) ?? null;
  const head = getFunctionName(expr);
  if (head === 'Range' || head == 'Interval') {
    let open: 'both' | 'left' | 'right' | undefined = undefined;
    const arg1 = getArg(expr, 1);
    const arg2 = getArg(expr, 2);
    let min: number | null = null;
    let max: number | null = null;
    if (getFunctionName(getFunctionName(arg1)) === 'Open') {
      open = 'left';
      min = asNumber(getArg(arg1, 1));
    } else {
      min = asNumber(arg1);
    }
    if (getFunctionName(getFunctionName(getArg(expr, 2))) === 'Open') {
      open = open === undefined ? 'right' : 'both';
      max = asNumber(getArg(arg2, 1));
    } else {
      max = asNumber(arg2);
    }
    if (min === null || max === null) return null;
    return {
      min,
      max,
      open,
      domain: head === 'Range' ? 'Number' : 'RealNumber',
    };
  }
  const val = asNumber(expr);
  if (val !== null) {
    return { min: val, max: val, domain: inferNumericDomain(val) ?? 'Number' };
  }
  return null;
}

export function setAtomicInfo(
  ce: ComputeEngine,
  symbol: Expression,
  value: AtomicInfo
): void {
  const name = getSymbolName(symbol);
  console.assert(name !== null);
  getSymbols(ce).set(name!, value);
}

/** Compare the value of `expr` with the min/max value of the info.
 * Ignore the domain.
 */
function compare(
  expr: Expression,
  info: AtomicInfo
): '=' | '!=' | '<' | '>' | 'in' | undefined {
  const val = asNumber(expr);
  if (val === null) return undefined;
  if (info.max === info.min && val === info.min) return '=';
  if (info.max === info.min && val !== info.min) return '!=';
  if (info.open === 'both') {
    if (val < info.min) return '<';
    if (val > info.max) return '>';
    return 'in';
  } else if (info.open === 'left') {
    if (val <= info.min) return '<';
    if (val > info.max) return '>';
    return 'in';
  } else if (info.open === 'right') {
    if (val < info.min) return '<';
    if (val >= info.max) return '>';
    return 'in';
  }
  if (val <= info.min) return '<';
  if (val >= info.max) return '>';
  return 'in';
}

function getSymbols(ce: ComputeEngine): Map<string, AtomicInfo> {
  return ce.cache<Map<string, AtomicInfo>>('symbols', () => {
    const result = new Map<string, AtomicInfo>();
    for (const [assumption, val] of ce.assumptions) {
      cacheSymbolInfo(result, assumption, val);
    }
    return result;
  });
}

function cacheSymbolInfo(
  cache: Map<string, AtomicInfo>,
  assumption: Expression,
  positive: boolean
): void {
  let op: null | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'in' = null;
  let val: null | Expression = null;

  let sub = match(['Equal', '_x', 0], assumption);
  if (sub !== null) {
    val = 0;
    op = positive ? '=' : '!=';
  }
  if (sub === null) {
    sub = match(['Equal', ['Add', '_x', '_c'], 0], assumption);
    if (sub !== null) {
      val = ['Negate', sub.c];
      op = positive ? '=' : '!=';
    }
  }
  // @todo! other kind of assumptions: Less, LessEqual, Element, Multiple

  // @todo: deal with negative assertions ("x is not in [1, 5]")

  if (sub !== null && op !== null && val !== null) {
    const symbol = getSymbolName(sub.x);
    if (symbol !== null) setSymbolValue(cache, symbol, op, val);
  }
}

/**
 *
 * @todo: we could handle '!in'
 */
function setSymbolValue(
  symbols: Map<string, AtomicInfo>,
  symbol: string,
  op: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'in',
  value: Expression
) {
  if (op === 'in') {
    // Range
    // Interval
    // Numeric Domain
    // @todo!
  }

  //
  // It's a numeric assertion (equality or inequality)
  //
  const domain = inferNumericDomain(value);
  if (domain === null) return;

  const val = asNumber(value) ?? getComplexValue(value);
  if (val === null) return;

  const info = symbols.get(symbol) ?? { min: -Infinity, max: +Infinity };

  if (op === '!=') {
    if (info.excludedValues === undefined) {
      info.excludedValues = [val];
    } else {
      info.excludedValues.push(val);
    }
  } else if (op === '=') {
    symbols.set(symbol, { ...info, domain, min: val, max: val });
  } else if (op === '<') {
    // @todo!
  } else if (op === '<=') {
    // @todo!
  } else if (op === '>') {
    // @todo!
  } else if (op === '>=') {
    // @todo!
  }
}

function assertNormalProposition(prop: Expression): boolean {
  const name = getFunctionName(prop);
  if (name === 'Equal' || name === 'Less' || name === 'LessEqual') {
    if (getNumberValue(getArg(prop, 2)) === 0) return true;
    return false;
  }
  if (
    name === 'Not' ||
    name === 'And' ||
    name === 'Or' ||
    name === 'Element' ||
    name === 'Subset'
  ) {
    return true;
  }
  return false;
}

/**
 * Attempts to put the proposition in normal form:
 * - ['Not', f] -> [f, false]
 * - ['NotEqual', f] -> [['Equal', f], false]
 * - ['Greater', lhs, rhs] -> ['Less', rhs, lhs]
 * - ['GreaterEqual', lhs, rhs] -> ['LessEqual', rhs, lhs]
 * - lhs = rhs => lhs - rhs = 0 (or lhs/rhs = 1 & rhs !== 0)
 * - ['Equal', [Square, f], g] => ...
 *
 *
 * Note: this function is not recursive, it only normalizes the first level:
 * since it might not be necessary to consider all the elements (first 'Or'
 * that returns true succeeds), save time by only doing the minimum necessary.
 *
 * Returns `null` if this is not in fact a proposition
 *
 * @todo
 */
export function normalizeProposition<T extends number = Numeric>(
  ce: ComputeEngine,
  proposition: Expression<T>
): null | Expression<T> {
  const symbol = getSymbolName(proposition);
  if (symbol === 'True' || symbol === 'False' || symbol === 'Maybe') {
    return symbol;
  }

  const head = getFunctionName(proposition);

  if (head === 'And' || head == 'Or') return proposition;

  if (head === 'Not') {
    const arg = ce.canonical(ce.simplify(getArg(proposition, 1))) ?? MISSING;
    if (getFunctionName(arg) === 'Not') return getArg(arg, 1);
    return ['Not', arg];
  }

  if (head === 'NotEqual') {
    const arg = ce.canonical(
      ce.simplify([
        'Subtract',
        getArg(proposition, 1) ?? MISSING,
        getArg(proposition, 2) ?? MISSING,
      ])
    );
    return ['Not', ['Equal', arg, 0]];
  }

  if (head === 'NotElement') {
    const arg1 = ce.simplify(getArg(proposition, 1)) ?? MISSING;
    const arg2 = ce.simplify(getArg(proposition, 2)) ?? MISSING;
    return ['Not', ['Element', ce.canonical(arg1), ce.canonical(arg2)]];
  }

  if (head === 'Greater' || head === 'GreaterEqual') {
    const arg =
      ce.canonical(
        ce.simplify([
          'Subtract',
          getArg(proposition, 2),
          getArg(proposition, 1),
        ])
      ) ?? MISSING;
    return [head === 'Greater' ? 'Less' : 'LessEqual', arg, 0];
  }

  if (head === 'Equal' || head === 'Less' || head === 'LessEqual') {
    const arg =
      ce.canonical(
        ce.simplify([
          'Subtract',
          getArg(proposition, 1),
          getArg(proposition, 2),
        ])
      ) ?? MISSING;
    return [head, arg, 0];
  }

  if (head === 'Element') return proposition;

  return null;
}

export function internalAssume<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  proposition: Expression<T>
): 'not-a-predicate' | 'contradiction' | 'tautology' | 'ok' {
  const head = getFunctionName(proposition);

  if (!head) throw new CortexError({ message: 'expected-predicate' });

  let val = true;

  let prop: Expression<T> | null = proposition;

  if (head === 'And') {
    const v = ce.is(proposition);
    if (v === true) return 'tautology';
    if (v === false) return 'contradiction';
    for (const prop of getTail(proposition)) {
      // @todo: could use an internalRecursive that assumes a normalized prop
      const result = internalAssume(ce, prop);
      if (result !== 'ok') return result;
    }
    return 'ok';
  } else {
    prop = normalizeProposition(ce, prop);
    if (prop !== null && head === 'Not') {
      prop = normalizeProposition(ce, getArg(prop, 1) ?? MISSING);
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

  // Add a new assumption
  ce.assumptions.set(prop, val);

  // And cache it
  cacheSymbolInfo(getSymbols(ce), prop, val);

  // @todo: could check any assumptions that have become tautologies
  // (i.e. if `proposition` was more general than an existing assumption)
  // and remove them.

  return 'ok';
}

function getAssumptionsAbout<T extends number = Numeric>(
  engine: ComputeEngine<T>,
  arg: Expression<T>
): Expression<T>[] {
  const symbols: string[] = [...engine.getVars(arg)]
    .map((x) => getSymbolName(x))
    .filter((x) => x !== null) as string[];

  if (symbols.length === 0) return [];

  const result: Expression<T>[] = [];
  for (const [assumption, val] of engine.assumptions) {
    const vars = engine.getVars(assumption);
    for (const symbol of symbols) {
      if (vars.has(symbol)) {
        if (val) {
          result.push(assumption);
        } else if (getFunctionName(assumption) === 'Equal') {
          result.push(['NotEqual', assumption]);
        } else if (getFunctionName(assumption) === 'Element') {
          result.push(['NotElement', assumption]);
        } else if (getFunctionName(assumption) === 'Less') {
          result.push(['GreaterEqual', assumption]);
        } else if (getFunctionName(assumption) === 'LessEqual') {
          result.push(['Greater', assumption]);
        } else {
          result.push(['Not', assumption]);
        }
        break;
      }
    }
  }

  return [];
}

export function forget<T extends number = Numeric>(
  engine: ComputeEngine<T>,
  arg: Expression<T>
): void {
  for (const assumption of getAssumptionsAbout(engine, arg)) {
    engine.assumptions.delete(assumption);
  }
}

function asNumber(x: Expression<Numeric>): number | null {
  const val = getNumberValue(x);
  if (val !== null) return val;

  const [numer, denom] = getRationalValue(x);
  if (numer !== null && denom !== null) {
    return numer / denom;
  }
  const d = getDecimalValue(x);
  if (d !== null) return d.toNumber();

  return null;
}

function expressionToSymbolInfo(
  symbols: Map<string, AtomicInfo>,
  expr: Expression
): [symbol: string | null, info: AtomicInfo | null] {
  const name = getFunctionName(expr);
  let sub: Substitution | null = null;
  let val: Expression | null = null;
  if (
    name === 'Less' ||
    name === 'LessEqual' ||
    name === 'Greater' ||
    name === 'GreaterEqual'
  ) {
    sub = match([name, ['Add', '_x', '_a'], 0], expr);
    if (sub !== null) {
      val = -(asNumber(sub.a) ?? NaN);
    } else {
      sub = match([name, '_x', '_a'], expr);
      if (sub) {
        console.assert(sub.a === 0);
        val = 0;
      }
    }
  }
  if (sub === null) return [null, null];
  const symbol = getSymbolName(sub.x);
  if (symbol === null) return [null, null];

  const info = symbols.get(symbol) ?? { min: -Infinity, max: Infinity };

  if (name === 'Less') {
    if (val === null) return [null, null];
    info.max = val;
    if (info.open === 'left') info.open = 'both';
    else if (info.open !== 'both') info.open = 'right';
  } else if (name === 'LessEqual') {
    if (val === null) return [null, null];
    info.max = val;
    if (info.open === 'both') info.open = 'left';
    else if (info.open === 'right') info.open = undefined;
  } else if (name === 'Greater') {
    if (val === null) return [null, null];
    info.min = val;
    if (info.open === 'right') info.open = 'both';
    else if (info.open !== 'both') info.open = 'left';
  } else if (name === 'GreaterEqual') {
    if (val === null) return [null, null];
    info.min = val;
    if (info.open === 'both') info.open = 'right';
    else if (info.open === 'left') info.open = undefined;
  } else if (name === 'Element') {
    const dom = getSymbolName(val);
    if (dom !== null) {
      if (info.domain && isSubdomain(dom, info.domain)) return [symbol, info];
    } else {
      // Check for 'Range' and 'Interval'`
    }

    info.domain = dom as NumericDomain; // @todo: check that it's actually a NumericDomain
  }

  return [symbol, info];
}

function isSubdomain(lhs: string, rhs: NumericDomain): boolean | undefined {
  return (
    {
      Number: [
        'ExtendedComplexNumber',
        'ExtendedRealNumber',
        'ComplexNumber',
        'ImaginaryNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
      ],
      ExtendedComplexNumber: [
        'Number',
        'ExtendedRealNumber',
        'ComplexNumber',
        'ImaginaryNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
      ],
      ExtendedRealNumber: [
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
      ],
      ComplexNumber: ['ImaginaryNumber'],
      ImaginaryNumber: ['ImaginaryNumber'],
      RealNumber: [
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
      ],
      TranscendentalNumber: ['TranscendentalNumber'],
      AlgebraicNumber: ['RationalNumber', 'Integer'],
      RationalNumber: ['RationalNumber', 'Integer'],
      Integer: ['Integer'],
    }[lhs]?.includes(rhs) ?? undefined
  );
}
