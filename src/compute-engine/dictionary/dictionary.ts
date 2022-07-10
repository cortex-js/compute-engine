import { ARITHMETIC_DICTIONARY } from './arithmetic';
import { COLLECTIONS_DICTIONARY } from './collections';
import { CORE_DICTIONARY } from './core';
import { LOGIC_DICTIONARY } from './logic';
import { POLYNOMIALS_DICTIONARY } from './polynomials';
import { RELOP_DICTIONARY } from './relational-operator';
import { SETS_DICTIONARY } from './sets';
import { TRIGONOMETRY_DICTIONARY } from './trigonometry';

import { DictionaryCategory } from '../latex-syntax/public';

import {
  IComputeEngine,
  Dictionary,
  BoxedSymbolDefinition,
  BoxedFunctionDefinition,
  BaseDefinition,
} from '../public';
import { BoxedSymbolDefinitionImpl } from '../boxed-expression/boxed-symbol-definition';
import { makeFunctionDefinition } from '../boxed-expression/boxed-function-definition';
import { isValidSymbolName } from '../../math-json/utils';

export function getDefaultDictionaries(
  categories: DictionaryCategory[] | DictionaryCategory | 'all'
): Readonly<Dictionary>[] {
  if (categories === 'all') {
    // **Note** the order of the dictionaries matter:
    // earlier dictionaries cannot reference definitions in later dictionaries.
    return getDefaultDictionaries([
      'domains',
      'core',
      'control-structures', // If, Block, Loop
      'logic',
      'collections', // Dictionary, List, Sets
      'relop',
      'numeric',
      'arithmetic',
      'algebra',
      'calculus',
      'combinatorics',
      'linear-algebra',
      'other',
      'physics',
      'polynomials',
      'statistics',
      'trigonometry',
      'dimensions',
      'units',
    ]);
  } else if (typeof categories === 'string') categories = [categories];
  const result: Readonly<Dictionary>[] = [];
  for (const category of categories) {
    const dict = DICTIONARIES[category];
    if (!dict) throw Error(`Unknown dictionary category ${category}`);
    if (Array.isArray(dict)) result.push(...dict);
    else result.push(dict);
  }
  return result;
}

export const DICTIONARIES: {
  [category in DictionaryCategory]?:
    | Readonly<Dictionary>
    | Readonly<Dictionary>[];
} = {
  'algebra': [],
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
  'arithmetic': ARITHMETIC_DICTIONARY,
  'calculus': [],
  'combinatorics': [], // @todo fibonacci, binomial, etc...
  'control-structures': [],
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
  'dimensions': [], // @todo // volume, speed, area
  'domains': [],
  'core': CORE_DICTIONARY,
  'collections': [SETS_DICTIONARY, COLLECTIONS_DICTIONARY],
  // 'domains': getDomainsDictionary(),
  'linear-algebra': [], //@todo   // 'linear-algebra': [
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

  'logic': LOGIC_DICTIONARY,
  'numeric': [], // @todo   // 'numeric': [
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

  'other': [],
  'relop': RELOP_DICTIONARY,
  'polynomials': POLYNOMIALS_DICTIONARY,
  'physics': {
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
  'statistics': [], // @todo statistics: [
  //   // average
  //   // mean
  //   // variance = size(l) * stddev(l)^2 / (size(l) - 1)
  //   // stddev
  //   // median
  //   // quantile
  // ],
  'trigonometry': TRIGONOMETRY_DICTIONARY,
  'units': [],
};

function validateDefinitionName(def: BaseDefinition): void {
  if (typeof def !== 'object' || !('name' in def) || !def.name)
    throw new Error('Missing name for definition' + JSON.stringify(def)); // @todo cause

  if (!isValidSymbolName(def.name))
    throw Error(`Invalid definition name ${def.name}`); // @todo cause
}

/**
 * Set the dictionary of the current context (`engine.context`) to `dicts`
 *
 * `dicts` can be an array of dictionaries, in order to deal with circular
 * dependencies: it is possible to partition a dictionary into multiple
 * sub-dictionary, to control the order in which they are processed and
 * avoid having expressions in the definition of an entry reference a symbol
 * or function name that has not yet been added to the dictionary.
 *
 */
export function setCurrentContextDictionary(
  engine: IComputeEngine,
  dict: Dictionary
): void {
  // If this is the first dictionary, setup the context.dictionary
  if (!engine.context.dictionary)
    engine.context.dictionary = {
      symbols: new Map<string, BoxedSymbolDefinition>(),
      functions: new Map<string, BoxedFunctionDefinition>(),
      symbolWikidata: new Map<string, BoxedSymbolDefinition>(),
      functionWikidata: new Map<string, BoxedFunctionDefinition>(),
    };

  const dictionary = engine.context.dictionary;

  //
  // Validate and add the symbols from the dictionary
  //
  if (dict.symbols)
    for (const entry of dict.symbols) {
      validateDefinitionName(entry);

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

  //
  // Validate and add the functions from the dictionary
  //
  if (dict.functions)
    for (const entry of dict.functions) {
      validateDefinitionName(entry);

      const def = makeFunctionDefinition(engine, entry);

      if (entry.wikidata) {
        if (dictionary.functionWikidata.has(entry.wikidata))
          throw new Error(
            `Duplicate function with wikidata ${entry.wikidata}, ${
              entry.name
            } and ${dictionary.functionWikidata.get(entry.wikidata)!.name}`
          );
        dictionary.functionWikidata.set(entry.wikidata, def);
      }

      if (dictionary.functions.has(entry.name))
        throw new Error(
          `Duplicate function definition ${entry.name}:\n${JSON.stringify(
            dictionary.symbols.get(entry.name)!
          )}\n${JSON.stringify(entry)}`
        );

      dictionary.functions.set(entry.name, def);
    }

  // @todo: take dict.rules into consideration
}
