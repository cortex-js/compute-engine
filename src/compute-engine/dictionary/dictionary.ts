import { ARITHMETIC_DICTIONARY } from './arithmetic';
import { CORE_DICTIONARY } from './core';
import { LOGIC_DICTIONARY } from './logic';
import { TRIGONOMETRY_DICTIONARY } from './trigonometry';
import { SETS_DICTIONARY } from './sets';
import { DictionaryCategory } from '../latex-syntax/public';

import {
  IComputeEngine,
  Dictionary,
  BoxedSymbolDefinition,
  BoxedFunctionDefinition,
  BaseDefinition,
} from '../public';
import { COLLECTIONS_DICTIONARY } from './collections';
import { BoxedSymbolDefinitionImpl } from '../boxed-expression/boxed-symbol-definition';
import { makeFunctionDefinition } from '../boxed-expression/boxed-function-definition';
import { RELOP_DICTIONARY } from './relational-operator';
import { POLYNOMIALS_DICTIONARY } from './polynomials';

export function getDefaultDictionaries(
  categories: DictionaryCategory[] | 'all' = 'all'
): Readonly<Dictionary>[] {
  if (categories === 'all') {
    // Note that the order of the dictionaries matter:
    //  earlier dictionaries cannot reference definitions in later
    //  dictionaries.
    return getDefaultDictionaries([
      'domains',
      'core',
      'collections', // Dictionary, List, Sets
      'algebra',
      'arithmetic',
      'calculus',
      'combinatorics',
      'dimensions',
      'linear-algebra',
      'logic',
      'numeric',
      'other',
      'physics',
      'polynomials',
      'relop',
      'statistics',
      'trigonometry',
      'units',
    ]);
  }
  const result: Readonly<Dictionary>[] = [];
  for (const category of categories) {
    const dict = DICTIONARIES[category];
    if (dict && Array.isArray(dict)) result.push(...dict);
    else if (dict) result.push(dict as Readonly<Dictionary>);
  }
  return result;
}

export const DICTIONARIES: {
  [category in DictionaryCategory]?:
    | Readonly<Dictionary>
    | Readonly<Dictionary>[];
} = {
  arithmetic: ARITHMETIC_DICTIONARY,
  // @todo more dictionaries
  // 'algebra': [
  //   // polynomial([0, 2, 0, 4]:list, x:symbol) -> 2x + 4x^3
  //   // polynomial(2x + 4x^3, x) -> {0, 2, 0, 4}
  //   // rational(2x + 4x^3, {3, 1}, x) -> (2x + 4x^3)/(3+x)
  //   // https://reference.wolfram.com/language/tutorial/AlgebraicCalculations.html
  //   // simplify-trig (macsyma)
  //   //  - trigReduce, trigExpand, trigFactor, trigToExp (mathematica)
  //   // Mathematica:
  //   // - distribute -> (a+b)(c+d) -> ac+ ad+ bc+ bd (doesn't have to be multiply,
  //   // f(a+b, c+d) -> f(a, c) + f(a, d) + f(b, c) + f(b, d)
  //   // -- distribute(expr, over=add, with=multiply)
  //   // https://reference.wolfram.com/language/ref/Distribute.html
  //   // - expand, expand-all
  //   // - factor
  //   // - simplify
  // ],

  // 'calculus': [
  //   // D
  //   // Derivative (mathematica)
  //   // diff (macsyma)
  //   // nth-diff
  //   // int
  //   // - integrate(expression, symbol)  -- indefinite integral
  //   // - integrate(expression, range) <range> = {symbol, min, max} -- definite integral
  //   // - integrate(expression, range1, range2) -- multiple integral
  //   // def-int
  // ],
  // 'combinatorics': [], // fibonacci, binomial, etc...
  core: CORE_DICTIONARY,
  collections: [SETS_DICTIONARY, COLLECTIONS_DICTIONARY],
  // 'domains': getDomainsDictionary(),
  // 'dimensions': [
  //   // volume, speed, area
  // ],
  logic: LOGIC_DICTIONARY,
  relop: RELOP_DICTIONARY,
  // 'linear-algebra': [
  //   // matrix
  //   // transpose
  //   // cross-product
  //   // outer-product
  //   // determinant
  //   // vector
  //   // matrix
  //   // rank
  //   // scalar-matrix
  //   // constant-matrix
  //   // identity-matrix
  // ],
  // 'numeric': [
  //   // Gamma function
  //   // Zeta function
  //   // erf function
  //   // numerator(fraction)
  //   // denominator(fraction)
  //   // exactFloatToRational
  //   // N -> eval as a number
  //   // random
  //   // hash
  // ],
  // 'other': [],
  polynomials: POLYNOMIALS_DICTIONARY,
  physics: {
    symbols: [
      {
        name: 'Mu-0',
        description: 'Vaccum permeability',
        constant: true,
        wikidata: 'Q1515261',
        domain: 'RealNumber',
        value: 1.25663706212e-6,
        // unit: ['Divide', 'N', ['Square', 'A']],
      },
    ],
  },
  // statistics: [
  //   // average
  //   // mean
  //   // variance = size(l) * stddev(l)^2 / (size(l) - 1)
  //   // stddev
  //   // median
  //   // quantile
  // ],
  trigonometry: TRIGONOMETRY_DICTIONARY,
  // units: [],
};

function validateDefinitionName(
  _engine: IComputeEngine,
  def: BaseDefinition
): void {
  if (typeof def !== 'object' || !('name' in def) || !def.name)
    throw new Error(`Missing name for definition ${JSON.stringify(def)}`);

  if (!/[A-Za-z][A-Za-z0-9-]*/.test(def.name) && def.name.length !== 1)
    throw new Error(`Invalid definition name ${def.name}`);
}

/**
 * Set the dictionary of the current context (`engine.context`) to `dicts`
 *
 * `dicts` can be an array of dictionaries, in order to deal with circular
 * dependencies: it is possible to partition a dictionary into multiple
 * sub-dictionary, to control the order in which they are processe and
 * avoid having expressions in the definition of an entry reference a symbol
 * or function name that has not yet been added to the dictionary.
 *
 * Specifically:
 * - Expressions (for values, evaluate, domain, isElementOf, etc..) are boxed
 * - The domain of entries is inferred and validated:
 *  - check that domains are in canonical form
 *  - check that domains are consistent with declarations
 *
 */
export function setCurrentContextDictionary(
  engine: IComputeEngine,
  dicts: Dictionary | Dictionary[] | undefined
): void {
  if (dicts === undefined) return;

  // If we are passed multiple dictionaries, add them in order, one by one
  // This is important to do to avoid definitions with circular dependencies.
  if (Array.isArray(dicts)) {
    for (const dict of dicts) setCurrentContextDictionary(engine, dict);
    return;
  }

  // If this is the first dictionary, setup the context.dictionary
  if (!engine.context.dictionary)
    engine.context.dictionary = {
      symbols: new Map<string, BoxedSymbolDefinition>(),
      functions: new Map<string, BoxedFunctionDefinition[]>(),
      symbolWikidata: new Map<string, BoxedSymbolDefinition>(),
      functionWikidata: new Map<string, BoxedFunctionDefinition>(),
    };

  const dictionary = engine.context.dictionary!;

  if (dicts.symbols)
    for (const entry of dicts.symbols) {
      validateDefinitionName(engine, entry);

      const def = new BoxedSymbolDefinitionImpl(engine, entry);

      if (entry.wikidata) {
        if (dictionary.symbolWikidata.has(entry.wikidata))
          throw new Error(
            `Duplicate symbol with wikidata ${entry.wikidata}, ${
              entry.name
            } and ${dictionary.symbolWikidata.get(entry.wikidata)!.name}`
          );
        dictionary.symbolWikidata.set(entry.wikidata, def);
      }

      if (dictionary.symbols.has(entry.name)) {
        throw new Error(
          `Duplicate symbol definition ${entry.name}:\n${JSON.stringify(
            dictionary.symbols.get(entry.name)!
          )}\n${JSON.stringify(entry)}`
        );
      }

      dictionary.symbols.set(entry.name, def);
    }

  if (dicts.functions)
    for (const entry of dicts.functions) {
      validateDefinitionName(engine, entry);

      const def = makeFunctionDefinition(engine, entry);

      if (!dictionary.functions.has(entry.name))
        dictionary.functions.set(entry.name, [def]);
      else {
        dictionary.functions.set(entry.name, [
          ...dictionary.functions.get(entry.name)!,
          def,
        ]);
      }

      if (entry.wikidata) {
        if (dictionary.functionWikidata.has(entry.wikidata))
          throw new Error(
            `Duplicate function with wikidata ${entry.wikidata}, ${
              entry.name
            } and ${dictionary.functionWikidata.get(entry.wikidata)!.name}`
          );
        dictionary.functionWikidata.set(entry.wikidata, def);
      }
    }

  // @todo: take dict.rules into consideration
}

/**
 * For debugging: a textual representation of the inheritance chain of sets.
 */
// function setParentsToString(
//   engine: ComputeEngineInterface,
//   expr: Expression,
//   cycle?: string[]
// ): string {
//   const result: string[] = [`${expr}`];

//   const name = typeof expr === 'string' ? expr : head(expr);
//   if (cycle) {
//     if (cycle.includes(name)) return `${name} ↩︎ `;
//     cycle.push(name);
//   } else {
//     cycle = [name];
//   }
//   const def = engine.getSymbolDefinition(name);
//   if (!def || !isSetDefinition(def)) return `${name}?!`;
//   if (!def.supersets.length || def.supersets.length === 0) return '';

//   for (const parent of def?.supersets) {
//     if (typeof parent === 'string') {
//       result.push(setParentsToString(engine, parent, [...cycle]));
//     } else {
//     }
//   }
//   if (result.length <= 1) {
//     return result[0] ?? '';
//   }
//   return '[' + result.join(' ➔ ') + ']';
// }
