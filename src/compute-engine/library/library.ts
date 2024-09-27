import { ARITHMETIC_LIBRARY } from './arithmetic.ts';
import { CALCULUS_LIBRARY } from './calculus.ts';
import { COLLECTIONS_LIBRARY } from './collections.ts';
import { CONTROL_STRUCTURES_LIBRARY } from './control-structures.ts';
import { COMPLEX_LIBRARY } from './complex.ts';
import { CORE_LIBRARY } from './core.ts';
import { LINEAR_ALGEBRA_LIBRARY } from './linear-algebra.ts';
import { LOGIC_LIBRARY } from './logic.ts';
import { POLYNOMIALS_LIBRARY } from './polynomials.ts';
import { RELOP_LIBRARY } from './relational-operator.ts';
import { SETS_LIBRARY } from './sets.ts';
import { STATISTICS_LIBRARY } from './statistics.ts';
import { TRIGONOMETRY_LIBRARY } from './trigonometry.ts';

import { LibraryCategory } from '../latex-syntax/public.ts';

import { IComputeEngine, IdentifierDefinitions } from '../public.ts';
import { _BoxedSymbolDefinition } from '../boxed-expression/boxed-symbol-definition.ts';
import { makeFunctionDefinition } from '../boxed-expression/boxed-function-definition.ts';
import { _BoxedExpression } from '../boxed-expression/abstract-boxed-expression.ts';
import {
  isValidIdentifier,
  validateIdentifier,
} from '../../math-json/identifiers.ts';
import {
  isFunctionDefinition,
  isSymbolDefinition,
} from '../boxed-expression/utils.ts';

export function getStandardLibrary(
  categories: LibraryCategory[] | LibraryCategory | 'all'
): readonly IdentifierDefinitions[] {
  if (categories === 'all') {
    // **Note** the order of the libraries is significant:
    // earlier libraries cannot reference definitions in later libraries.
    return getStandardLibrary([
      'core',
      'control-structures', // If, Block, Loop
      'logic',
      'collections', // Dictionary, List, Sets
      'relop',

      'numeric',
      'arithmetic',
      'trigonometry',

      'algebra',
      'calculus', // D, Integerate
      'polynomials',

      'combinatorics',
      'linear-algebra',

      'statistics',
      'dimensions',
      'units',
      'physics',

      'other',
    ]);
  } else if (typeof categories === 'string') categories = [categories];
  const result: IdentifierDefinitions[] = [];
  for (const category of categories) {
    const dict = LIBRARIES[category];
    if (!dict) throw Error(`Unknown library category ${category}`);
    if (Array.isArray(dict)) result.push(...dict);
    else result.push(dict);
  }
  return Object.freeze(result);
}

export const LIBRARIES: {
  [category in LibraryCategory]?:
    | IdentifierDefinitions
    | IdentifierDefinitions[];
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
  'arithmetic': [...ARITHMETIC_LIBRARY, ...COMPLEX_LIBRARY],
  'calculus': CALCULUS_LIBRARY,
  'collections': [SETS_LIBRARY, COLLECTIONS_LIBRARY],
  'combinatorics': [], // @todo fibonacci, binomial, etc...
  'control-structures': CONTROL_STRUCTURES_LIBRARY,
  'core': CORE_LIBRARY,
  'dimensions': [], // @todo // volume, speed, area
  'domains': [],
  // 'domains': getDomainsDictionary(),
  'linear-algebra': LINEAR_ALGEBRA_LIBRARY,
  'logic': LOGIC_LIBRARY,
  'numeric': [], // @todo   // 'numeric': [

  'other': [],
  'relop': RELOP_LIBRARY,
  'polynomials': POLYNOMIALS_LIBRARY,
  'physics': {
    Mu0: {
      description: 'Vaccum permeability',
      constant: true,
      wikidata: 'Q1515261',
      type: 'real',
      value: 1.25663706212e-6,
      // unit: ['Divide', 'N', ['Square', 'A']],
    },
  },
  'statistics': STATISTICS_LIBRARY,
  'trigonometry': TRIGONOMETRY_LIBRARY,
  'units': [], // @todo see also "dimensions"
};

function validateDefinitionName(name: string): string {
  name = name.normalize();
  if (isValidIdentifier(name)) return name;
  throw new Error(
    `Invalid definition name "${name}": ${validateIdentifier(name)}`
  ); // @todo: cause
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
export function setIdentifierDefinitions(
  engine: IComputeEngine,
  table: IdentifierDefinitions
): void {
  if (!engine.context) throw Error('No context available');

  // If this is the first symbol table, setup the context
  engine.context.ids ??= new Map();

  const idTable = engine.context.ids;

  if (!engine.strict) {
    // @fastpath @todo
  }

  //
  // Validate and add the symbols from the symbol table
  //
  // eslint-disable-next-line prefer-const
  for (let [name, entry] of Object.entries(table)) {
    try {
      name = validateDefinitionName(name);
      if (isFunctionDefinition(entry)) {
        try {
          const def = makeFunctionDefinition(engine, name, entry);

          if (idTable.has(name))
            throw new Error(
              `Duplicate function definition:\n${JSON.stringify(
                idTable.get(name)!
              )}\n${JSON.stringify(entry)}`
            );

          idTable.set(name, def);
        } catch (e) {
          console.error(
            [
              `\nError in function definition`,
              '',
              JSON.stringify(entry),
              '',
              e.message,
            ].join('\n|   ') + '\n'
          );
        }
      } else if (isSymbolDefinition(entry)) {
        try {
          const def = new _BoxedSymbolDefinition(engine, name, entry);

          if (engine.strict && entry.wikidata) {
            for (const [_, d] of idTable) {
              if (d.wikidata === entry.wikidata)
                throw new Error(
                  `Duplicate entries with wikidata "${entry.wikidata}": "${name}" and "${d.name}"`
                );
            }
          }

          if (idTable.has(name))
            throw new Error(`The symbol is already defined`);

          idTable.set(name, def);
        } catch (e) {
          console.error(
            [
              `\nError in symbol definition of "${name}"`,
              '',
              JSON.stringify(entry),
              '',
              e.message,
            ].join('\n|   ')
          );
        }
      } else {
        const def = new _BoxedSymbolDefinition(engine, name, {
          value: engine.box(entry as any),
        });
        console.assert(def);
        idTable.set(name, def);
      }
    } catch (e) {
      console.error(
        [
          `\nError in definition of "${name}"`,
          '',
          JSON.stringify(entry),
          '',
          e.message,
        ].join('\n|   ') + '\n'
      );
    }
  }
}
