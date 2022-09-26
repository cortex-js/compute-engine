import { isDomain } from './boxed-expression/boxed-domain';
import { AssumeResult, BoxedExpression } from './public';

// function assertNormalProposition(prop: BoxedExpression): boolean {
//   const head = prop.head;

//   if (
//     head === 'Not' ||
//     head === 'And' ||
//     head === 'Or' ||
//     head === 'Element' ||
//     head === 'Subset' ||
//     head === 'SubsetEqual'
//   ) {
//     return true;
//   }

//   if (
//     head === 'Equal' ||
//     head === 'NotEqual' ||
//     head === 'Less' ||
//     head === 'LessEqual' ||
//     head === 'Greater' ||
//     head === 'GreaterEqual'
//   ) {
//     // The first argument should be a symbol.
//     if (!prop.op1.symbol) return true;
//     return false;
//   }
//   return false;
// }

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
  const head = proposition.head;
  if (head && proposition.op1.symbol) {
    const name = proposition.op1.symbol;
    let def = ce.lookupSymbol(name);

    // We are making an assumption about a previously unknown symbol...
    // @todo: handle defining a function (defineFunction) when the
    // domain of the second argument of proposition is compatible with 'Function'
    if (!def) def = ce.defineSymbol({ name });

    if (head === 'Equal') {
      proposition.op1.value = proposition.op2.evaluate();

      // Note: Above will forget() assumptions about symbol.
      // Alternatively, only change the definition value with:
      //      def.value = proposition.op2.evaluate();
      return 'ok';
    } else if (head === 'Element') {
      let dom = proposition.op2;
      if (dom.head !== 'Domain') {
        dom = ce.domain(dom.json);
      }
      if (isDomain(dom)) {
        proposition.op1.domain = ce.domain(dom);
        return 'ok';
      }
    } else if (head === 'Greater') {
      const val = proposition.op2.evaluate();
      if (def.value) {
        if (def.value.isGreater(val)) return 'tautology';
        // clear the value?
        return 'contradiction';
      }
      if (val.isZero) {
        def.positive = true;
        return 'ok';
      }
    } else if (head === 'GreaterEqual') {
      // @todo
    } else if (head === 'Less') {
      // @todo
    } else if (head === 'LessEqual') {
      // @todo
    }
  }

  //       ce.context.dictionary?.symbols.delete(symbol);
  //       for (const [assumption, _val] of ce.assumptions) {

  // @todo: decode some predicates:  [Element, ], [Equal, x, y], [LessThan, x, y]...
  return 'not-a-predicate';
  // if (!proposition.tail) throw new Error('assume(): expected predicate');

  // const ce = proposition.engine;

  // let val = true;

  // let prop: BoxedExpression | null = proposition;

  // if (proposition.head === 'And') {
  //   const v = ce.is(proposition);
  //   if (v === true) return 'tautology';
  //   if (v === false) return 'contradiction';
  //   for (const prop of proposition.tail) {
  //     const result = assume(prop);
  //     if (result !== 'ok') return result;
  //   }
  //   return 'ok';
  // } else {
  //   // prop = evaluateBoolean(prop);
  //   if (prop !== null && prop.head === 'Not') {
  //     prop = prop.op1.isMissing ? null : prop.op1;
  //     val = false;
  //   }
  // }

  // if (prop === null) return 'not-a-predicate';

  // const v = ce.is(prop);

  // // Is the proposition a contradiction or tautology?
  // if (v !== undefined) {
  //   if (v === val) return 'tautology';
  //   if (v !== val) return 'contradiction';
  // }

  // // Add a new assumption to the `assumptions` knowledge base
  // ce.assumptions.set(prop, val);

  // // And invalidate the symbols cache
  // // (other cache entries may have become out of date because of this
  // // new assumption. We'll repopulate the cache on demand later)
  // // resetNumericDomainInfoCache(ce);

  // // @todo: could check any assumptions that have become tautologies
  // // (i.e. if `proposition` was more general than an existing assumption)
  // // and remove them.

  // return 'ok';
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
