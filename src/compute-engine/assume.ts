import { AssumeResult, BoxedExpression } from './public';

import { isDomain } from './boxed-expression/boxed-domain';
import { findUnivariateRoots } from './solve';

function normalPredicate(
  prop: BoxedExpression
):
  | [
      sym: string,
      val: BoxedExpression,
      rel: '=' | '<' | '<=' | '>' | '>=' | 'in'
    ]
  | null {
  let rel: '=' | '<' | '<=' | '>' | '>=' | 'in' | '' = '';
  if (prop.head === 'Element') {
    if (!prop.op1.symbol) return null;
    let dom = prop.op2;
    if (!isDomain(dom)) dom = prop.engine.domain(prop.op2);
    if (!isDomain(dom)) return null;
    return [prop.op1.symbol, prop.op2, 'in'];
  } else if (prop.head === 'Less') rel = '<';
  else if (prop.head === 'LessEqual') rel = '<=';
  else if (prop.head === 'Equal') rel = '=';
  else if (prop.head === 'GreaterEqual') rel = '>=';
  else if (prop.head === 'Greater') rel = '>';

  if (!rel) return null;

  const ce = prop.engine;
  const p = ce.add([prop.op1, ce.negate(prop.op2)]).simplify();
  const syms = p.symbols.filter((x) => !x.isConstant);
  if (syms.length !== 1) return ['', p, rel];
  const sym = syms[0].symbol!;
  const sols = findUnivariateRoots(p, sym);
  if (sols.length === 1) return [sym, sols[0], rel];

  return ['', p, rel];
}

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
 * Predicates that involve multiple symbols are simplified (for example
 * `x + y = 5` becomes `x + y - 5 = 0`, then stored in the `assumptions` of the
 * current context).
 *
 */

export function assume(proposition: BoxedExpression): AssumeResult {
  const ce = proposition.engine;

  const v = proposition.evaluate();
  if (v.symbol === 'True') return 'tautology';
  if (v.symbol === 'False') return 'contradiction';

  const p = normalPredicate(proposition);
  if (p === null) return 'not-a-predicate';

  const [sym, val, rel] = p;
  let def = ce.lookupSymbol(sym);

  if (rel === 'in') {
    const dom = val.head !== 'Domain' ? ce.domain(val.json) : ce.domain(val);
    if (def) ce.forget(sym);
    if (dom.isCompatible('Function')) {
      ce.defineFunction({ name: sym });
      return 'ok';
    }
    if (!def) {
      ce.defineSymbol({ name: sym, domain: dom });
      return 'ok';
    }
    if (def.domain && !dom.isCompatible(def.domain)) return 'contradiction';
    def.domain = dom;
    return 'ok';
  }

  if (rel === '=') {
    if (sym) {
      // Note: forget() assumptions about symbol and change the value.
      // Alternatively, only change the definition value with:
      //      def.value = proposition.op2.evaluate();
      ce.symbol(sym).value = val;
    } else ce.assumptions.set(proposition, true);
    return 'ok';
  }

  if (rel === '<') {
    if (sym && !def)
      def = ce.defineSymbol({ name: sym, domain: ce.domain('RealNumber') });
    if (!def) return 'internal-error';
    if (def.value) {
      if (def.value.isLess(val)) return 'tautology';
      return 'contradiction';
    }

    if (val.isZero) {
      def.domain = ce.domain(
        def.integer ? 'NegativeInteger' : 'NegativeNumber'
      );
      return 'ok';
    }
    // Add a new assumption to the `assumptions` knowledge base
    ce.assumptions.set(ce.box(['Less', ce.symbol(sym), val]), true);
    return 'ok';
  }

  if (rel === '<=') {
    if (!def)
      def = ce.defineSymbol({ name: sym, domain: ce.domain('RealNumber') });
    if (def.value) {
      if (def.value.isLessEqual(val)) return 'tautology';
      return 'contradiction';
    }

    if (val.isZero) {
      def.domain = ce.domain(
        def.integer ? 'NonPositiveInteger' : 'NonPositiveNumber'
      );
      return 'ok';
    }
    // Add a new assumption to the `assumptions` knowledge base
    ce.assumptions.set(ce.box(['LessEqual', ce.symbol(sym), val]), true);
    return 'ok';
  }

  if (rel === '>') {
    if (!def)
      def = ce.defineSymbol({ name: sym, domain: ce.domain('RealNumber') });
    if (def.value) {
      if (def.value.isGreater(val)) return 'tautology';
      return 'contradiction';
    }

    if (val.isZero) {
      def.domain = ce.domain(
        def.integer ? 'PositiveInteger' : 'PositiveNumber'
      );
      return 'ok';
    }
    // Add a new assumption to the `assumptions` knowledge base
    ce.assumptions.set(ce.box(['Greater', ce.symbol(sym), val]), true);
    return 'ok';
  }

  if (rel === '>=') {
    if (!def)
      def = ce.defineSymbol({ name: sym, domain: ce.domain('RealNumber') });
    if (def.value) {
      if (def.value.isGreaterEqual(val)) return 'tautology';
      return 'contradiction';
    }

    if (val.isZero) {
      def.domain = ce.domain(
        def.integer ? 'NonNegativeInteger' : 'NonNegativeNumber'
      );
      return 'ok';
    }
    // Add a new assumption to the `assumptions` knowledge base
    ce.assumptions.set(ce.box(['GreaterEqual', ce.symbol(sym), val]), true);
    return 'ok';
  }

  return 'not-a-predicate';
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
