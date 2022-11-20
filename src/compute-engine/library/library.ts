import { ARITHMETIC_LIBRARY } from './arithmetic';
import { CALCULUS_LIBRARY } from './calculus';
import { COLLECTIONS_LIBRARY } from './collections';
import { CORE_LIBRARY } from './core';
import { LOGIC_LIBRARY } from './logic';
import { POLYNOMIALS_LIBRARY } from './polynomials';
import { RELOP_LIBRARY } from './relational-operator';
import { SETS_LIBRARY } from './sets';
import { TRIGONOMETRY_LIBRARY } from './trigonometry';

import { LibraryCategory } from '../latex-syntax/public';

import { IComputeEngine, IdTable } from '../public';
import { BoxedSymbolDefinitionImpl } from '../boxed-expression/boxed-symbol-definition';
import { makeFunctionDefinition } from '../boxed-expression/boxed-function-definition';
import { isValidIdentifier } from '../../math-json/utils';
import { isFunctionDefinition, isSymbolDefinition } from './utils';

export function getStandardLibrary(
  categories: LibraryCategory[] | LibraryCategory | 'all'
): Readonly<IdTable>[] {
  if (categories === 'all') {
    // **Note** the order of the libraries matter:
    // earlier libraries cannot reference definitions in later libraries.
    return getStandardLibrary([
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
  const result: Readonly<IdTable>[] = [];
  for (const category of categories) {
    const dict = LIBRARIES[category];
    if (!dict) throw Error(`Unknown library category ${category}`);
    if (Array.isArray(dict)) result.push(...dict);
    else result.push(dict);
  }
  return result;
}

export const LIBRARIES: {
  [category in LibraryCategory]?: Readonly<IdTable> | Readonly<IdTable>[];
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
  'arithmetic': ARITHMETIC_LIBRARY,
  'calculus': CALCULUS_LIBRARY,
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
  'core': CORE_LIBRARY,
  'collections': [SETS_LIBRARY, COLLECTIONS_LIBRARY],
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

  'logic': LOGIC_LIBRARY,
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
  'relop': RELOP_LIBRARY,
  'polynomials': POLYNOMIALS_LIBRARY,
  'physics': {
    'Mu-0': {
      description: 'Vaccum permeability',
      constant: true,
      wikidata: 'Q1515261',
      domain: 'RealNumber',
      value: 1.25663706212e-6,
      // unit: ['Divide', 'N', ['Square', 'A']],
    },
  },
  'statistics': [], // @todo statistics: [
  //   // average
  //   // mean
  //   // variance = size(l) * stddev(l)^2 / (size(l) - 1)
  //   // stddev
  //   // median
  //   // quantile
  // ],
  'trigonometry': TRIGONOMETRY_LIBRARY,
  'units': [],
};

function validateDefinitionName(name: string): string {
  name = name.normalize();
  if (!isValidIdentifier(name)) throw Error(`Invalid definition name ${name}`); // @todo cause

  return name;
}

/**
 * Set the symbol table of the current context (`engine.context`) to `table`
 *
 * `table` can be an array of symbol tables, in order to deal with circular
 * dependencies: it is possible to partition a library into multiple
 * symbol tables, to control the order in which they are processed and
 * avoid having expressions in the definition of an entry reference a symbol
 * or function name that has not yet been added to the symbol table.
 *
 */
export function setCurrentContextSymbolTable(
  engine: IComputeEngine,
  table: IdTable
): void {
  if (!engine.context) throw Error('No context available');

  // If this is the first symbol table, setup the context
  engine.context.idTable ??= new Map();

  const idTable = engine.context.idTable;

  //
  // Validate and add the symbols from the symbol table
  //
  for (let name of Object.keys(table)) {
    const entry = table[name];
    name = validateDefinitionName(name);

    if (isFunctionDefinition(entry)) {
      const def = makeFunctionDefinition(engine, name, entry);

      if (idTable.has(name))
        throw new Error(
          `Duplicate function definition ${name}:\n${JSON.stringify(
            idTable.get(name)!
          )}\n${JSON.stringify(entry)}`
        );

      idTable.set(name, def);
    } else if (isSymbolDefinition(entry)) {
      const def = new BoxedSymbolDefinitionImpl(engine, name, entry);

      if (engine.strict && entry.wikidata) {
        for (const [_, d] of idTable) {
          if (d.wikidata === entry.wikidata)
            throw new Error(
              `Duplicate entries with wikidata "${entry.wikidata}": "${name}" and "${d.name}"`
            );
        }
      }

      if (idTable.has(name))
        throw new Error(`Duplicate symbol definition "${name}"`);

      idTable.set(name, def);
    } else {
      const def = new BoxedSymbolDefinitionImpl(engine, name, {
        value: engine.box(entry as any),
      });
      console.assert(def);
      idTable.set(name, def);
    }
  }
}
