import { AssumeResult, BoxedExpression, IComputeEngine } from './public';

import { isDomain } from './boxed-expression/boxed-domain';
import { findUnivariateRoots } from './solve';

/**
 * Add an assumption, in the form of a predicate, for example:
 *
 * - `x = 5`
 * - `x ∈ ℕ`
 * - `x > 3`
 * - `x + y = 5`
 *
 * Some assumptions are handled separately, specifically, those that can
 * be represented as a symbol definition (equality to an expression,
 * membership to Integer, RealNumber, etc..., >0, <=0, etc...). The result
 * of these are stored directly in the current scope's symbols dictionary
 * (and an entry for the symbol is created if necessary).
 *
 * New assumptions can 'refine' previous assumptions, that is they are valid
 * if they don't contradict previous assumptions. To set new assumptions
 * that contradict previous ones, you must first `forget` about any symbols
 * in the new assumption.
 *
 * Predicates that involve multiple symbols are simplified (for example
 * `x + y = 5` becomes `x + y - 5 = 0`, then stored in the `assumptions` of the
 * current context).
 *
 */

export function assume(proposition: BoxedExpression): AssumeResult {
  if (proposition.head === 'Element') return assumeElement(proposition);
  if (proposition.head === 'Equal') return assumeEquality(proposition);
  if (isInequality(proposition)) return assumeInequality(proposition);

  return 'not-a-predicate';
}

function assumeEquality(proposition: BoxedExpression): AssumeResult {
  console.assert(proposition.head === 'Equal');
  // Four cases:
  // 1/ proposition contains no free variable without value
  //    e.g. `2 + 1 = 3`, `\pi + 1 = \pi`
  //    => evaluate and return
  // 2/ lhs is a single free variable with no value and `rhs` does not
  //     contain `lhs`
  //    e.g. `x = 2`, `x = 2\pi`
  //    => if `lhs` has a definition, set its value to `rhs`, otherwise
  //          define a new symbol with a value of `rhs`
  // 3/ proposition contains a single free variable without value
  //    => solve for the free variable, create new def or set value of the
  //      free variable with the root(s) as value
  // 4/ proposition contains multiple free variables with no value
  //    => add (lhs - rhs = 0) to assumptions DB

  // Case 1
  const unvals = unvaluedIdentifiers(proposition);
  if (unvals.length === 0) {
    const val = proposition.evaluate();
    if (val.symbol === 'True') return 'tautology';
    if (val.symbol === 'False') return 'contradiction';
    return 'not-a-predicate';
  }

  const ce = proposition.engine;

  // Case 2
  const lhs = proposition.op1.symbol;
  if (lhs && !hasValue(ce, lhs!) && !proposition.op2.has(lhs)) {
    const val = proposition.op2.evaluate();
    if (!val.isValid) return 'not-a-predicate';
    const def = ce.lookupSymbol(lhs);
    if (!def) {
      ce.defineSymbol({ name: lhs, value: val });
      return 'ok';
    }
    if (def.domain && !val.domain.isCompatible(def.domain))
      return 'contradiction';
    def.value = val;
    return 'ok';
  }

  // Case 3
  if (unvals.length === 1) {
    const lhs = unvals[0];
    const sols = findUnivariateRoots(proposition, lhs);
    if (sols.length === 0) {
      ce.assumptions.set(
        ce.box([
          'Equal',
          ce
            .add([
              proposition.op1.canonical,
              ce.negate(proposition.op2.canonical),
            ])
            .simplify(),
          0,
        ]),
        true
      );
    }

    const val = sols.length === 1 ? sols[0] : ce.box(['List', ...sols]);
    const def = ce.lookupSymbol(lhs);
    if (!def) {
      ce.defineSymbol({ name: lhs, value: val });
      return 'ok';
    }
    if (def.domain && !sols.every((sol) => val.domain.isCompatible(sol.domain)))
      return 'contradiction';
    def.value = val;
    return 'ok';
  }

  ce.assumptions.set(proposition, true);
  return 'ok';
}

function assumeInequality(proposition: BoxedExpression): AssumeResult {
  //
  // 1/ lhs is a single free var with no def
  //    e.g. x < 0
  //    => define a new var, if the domain can be inferred set it, otherwise
  // RealNumber and add to assumptions (e.g. x < 5)
  // 2/ (lhs - rhs) is an expression with no free var with no value
  //  e.g. \pi < 5
  //  => evaluate
  // 3/ (lhs - rhs) is an expression with a single free var with no value
  //    e.g. x + 1 < \pi
  //    => add def as RealNumber, add to assumptions
  // 4/ (lhs - rhs) is an expression with multiple free vars with no value
  //    e.g. x + y < 0
  //    => add to assumptions

  const ce = proposition.engine;
  // Case 1
  if (proposition.op1!.symbol && !hasDef(ce, proposition.op1!.symbol)) {
    if (proposition.op2.evaluate().isZero) {
      if (proposition.head === 'Less') {
        ce.defineSymbol({
          name: proposition.op1.symbol,
          domain: ce.domain('NegativeNumber'),
        });
      } else if (proposition.head === 'LessEqual') {
        ce.defineSymbol({
          name: proposition.op1.symbol,
          domain: ce.domain('NonPositiveNumber'),
        });
      } else if (proposition.head === 'Greater') {
        ce.defineSymbol({
          name: proposition.op1.symbol,
          domain: ce.domain('PositiveNumber'),
        });
      } else if (proposition.head === 'GreaterEqual') {
        ce.defineSymbol({
          name: proposition.op1.symbol,
          domain: ce.domain('NonNegativeNumber'),
        });
      }
    } else {
      ce.defineSymbol({
        name: proposition.op1.symbol,
        domain: ce.domain('ExtendedRealNumber'),
      });
      ce.assumptions.set(proposition, true);
    }
    return 'ok';
  }

  // Normalize to Less, LessEqual
  let op = '';
  let lhs: BoxedExpression;
  let rhs: BoxedExpression;
  if (proposition.head === 'Less') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<';
  } else if (proposition.head === 'LessEqual') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<=';
  } else if (proposition.head === 'Greater') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<';
  } else if (proposition.head === 'GreaterEqual') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<=';
  }
  if (!op) return 'internal-error';
  const p = ce.add([lhs!.canonical, ce.negate(rhs!.canonical)]).simplify();
  const unvals = unvaluedIdentifiers(p);

  // Case 2
  const result = ce.box([op === '<' ? 'Less' : 'LessEqual', p, 0]).evaluate();

  if (unvals.length === 0) {
    if (result.symbol === 'True') return 'tautology';
    if (result.symbol === 'False') return 'contradiction';
    return 'not-a-predicate';
  }

  // Case 3
  if (unvals.length === 1) {
    ce.defineSymbol({ name: unvals[0], domain: 'ExtendedRealNumber' });
  }

  // Case 3, 4
  console.assert(result.head === 'Less' || result.head === 'LessEqual');
  ce.assumptions.set(result, true);
  return 'ok';
}

function assumeElement(proposition: BoxedExpression): AssumeResult {
  console.assert(proposition.head === 'Element');

  // Four cases:
  // 1/ lhs is a single free variable with no definition
  //    e.g. `x \in \R`
  //    => define a new var with the specified domain
  // 2/ lhs is a symbol with a definition
  //    => update domain, if compatible
  // 3/ lhs is an expression with some free variables with no definition
  //    => add to assumptions DB
  // 4/ otherwise  (expression)
  //    e.g. `x+2 \in \R`
  //    => evaluate and return result (contradiction or tautology)

  const ce = proposition.engine;
  const undefs = undefinedIdentifiers(proposition.op1);
  // Case 1
  if (undefs.length === 1) {
    const dom = ce.domain(proposition.op2.evaluate().json);
    if (!dom.isValid) return 'not-a-predicate';
    if (dom.isCompatible('Function')) ce.defineFunction({ name: undefs[0] });
    else ce.defineSymbol({ name: undefs[0], domain: dom });
    return 'ok';
  }

  // Case 2
  if (proposition.op1.symbol && hasDef(ce, proposition.op1.symbol)) {
    const dom = ce.domain(proposition.op2.evaluate().json);
    if (!dom.isValid) return 'not-a-predicate';
    const def = ce.lookupSymbol(proposition.op1.symbol);
    if (def) {
      if (def.domain && !dom.isCompatible(def.domain)) return 'contradiction';
      def.domain = dom;
      return 'ok';
    }
    const fdef = ce.lookupFunction(proposition.op1.symbol);
    if (fdef?.signature?.domain) {
      if (!dom.isCompatible(fdef.signature.domain)) return 'contradiction';
      if (dom.isCompatible(fdef.signature.domain, 'bivariant'))
        return 'tautology';
      return 'not-a-predicate';
    }
    return 'ok';
  }

  // Case 3
  if (undefs.length > 0) {
    ce.assumptions.set(proposition, true);
    return 'ok';
  }

  // Case 4
  const val = proposition.evaluate();
  if (val.symbol === 'True') return 'tautology';
  if (val.symbol === 'False') return 'contradiction';
  return 'not-a-predicate';
}

function hasDef(ce: IComputeEngine, s: string): boolean {
  return (ce.lookupSymbol(s) ?? ce.lookupFunction(s)) !== undefined;
}

function undefinedIdentifiers(expr: BoxedExpression): string[] {
  const syms = expr.symbols;
  if (syms.length === 0) return [];
  return syms
    .filter((x) => !hasDef(expr.engine, x.symbol!))
    .map((x) => x.symbol!);
}

function unvaluedIdentifiers(expr: BoxedExpression): string[] {
  const syms = expr.symbols;
  if (syms.length === 0) return [];
  return syms
    .filter((x) => !hasValue(expr.engine, x.symbol!))
    .map((x) => x.symbol!);
}

function hasValue(ce: IComputeEngine, s: string): boolean {
  if (ce.lookupFunction(s)) return false;
  return ce.lookupSymbol(s)?.value !== undefined;
}

function isInequality(expr: BoxedExpression): boolean {
  const h = expr.head;
  if (typeof h !== 'string') return false;
  return ['Less', 'Greater', 'LessEqual', 'GreaterEqual'].includes(h);
}

// export function getAssumptionsAbout(
//   ce: ComputeEngineInterface,
//   symbol: string
// ): BoxedExpression[] {
//   const result: BoxedExpression[] = [];
//   for (const [assumption, val] of ce.assumptions) {
//     const vars = getVars(assumption);
//     if (vars.includes(symbol)) {
//       result.push(val ? assumption : ce.boxFunction('Not', [assumption]));
//     }
//   }

//   return [];
// }
