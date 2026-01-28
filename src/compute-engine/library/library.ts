import { ARITHMETIC_LIBRARY } from './arithmetic';
import { CALCULUS_LIBRARY } from './calculus';
import { COLLECTIONS_LIBRARY } from './collections';
import { CONTROL_STRUCTURES_LIBRARY } from './control-structures';
import { COMBINATORICS_LIBRARY } from './combinatorics';
import { COMPLEX_LIBRARY } from './complex';
import { CORE_LIBRARY } from './core';
import { LINEAR_ALGEBRA_LIBRARY } from './linear-algebra';
import { LOGIC_LIBRARY, LOGIC_FUNCTION_LIBRARY } from './logic';
import { NUMBER_THEORY_LIBRARY } from './number-theory';
import { POLYNOMIALS_LIBRARY } from './polynomials';
import { RELOP_LIBRARY } from './relational-operator';
import { SETS_LIBRARY } from './sets';
import { STATISTICS_LIBRARY } from './statistics';
import { TRIGONOMETRY_LIBRARY } from './trigonometry';

import { LibraryCategory } from '../latex-syntax/types';

import { _BoxedValueDefinition } from '../boxed-expression/boxed-value-definition';
import { _BoxedExpression } from '../boxed-expression/abstract-boxed-expression';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols';
import { isValidOperatorDef, isValidValueDef } from '../boxed-expression/utils';
import type { SymbolDefinitions, ComputeEngine } from '../global-types';
import { _BoxedOperatorDefinition } from '../boxed-expression/boxed-operator-definition';

export function getStandardLibrary(
  categories: LibraryCategory[] | LibraryCategory | 'all'
): readonly SymbolDefinitions[] {
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
      'number-theory',
      'linear-algebra',

      'statistics',
      'dimensions',
      'units',
      'physics',

      'other',
    ]);
  } else if (typeof categories === 'string') categories = [categories];
  const result: SymbolDefinitions[] = [];
  for (const category of categories) {
    const dict = LIBRARIES[category];
    if (!dict) throw Error(`Unknown library category ${category}`);
    if (Array.isArray(dict)) result.push(...dict);
    else result.push(dict);
  }
  return Object.freeze(result);
}

export const LIBRARIES: {
  [category in LibraryCategory]?: SymbolDefinitions | SymbolDefinitions[];
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
  'combinatorics': COMBINATORICS_LIBRARY,
  'control-structures': CONTROL_STRUCTURES_LIBRARY,
  'core': CORE_LIBRARY,
  'dimensions': [], // @todo // volume, speed, area
  'domains': [],
  // 'domains': getDomainsDictionary(),
  'linear-algebra': LINEAR_ALGEBRA_LIBRARY,
  'logic': [LOGIC_LIBRARY, LOGIC_FUNCTION_LIBRARY],
  'number-theory': NUMBER_THEORY_LIBRARY,
  'numeric': [], // @todo   // 'numeric': [

  'other': [],
  'relop': RELOP_LIBRARY,
  'polynomials': POLYNOMIALS_LIBRARY,
  'physics': {
    Mu0: {
      description: 'Vaccum permeability',
      isConstant: true,
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
  if (isValidSymbol(name)) return name;
  throw new Error(`Invalid definition name "${name}": ${validateSymbol(name)}`); // @todo: cause
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
export function setSymbolDefinitions(
  engine: ComputeEngine,
  table: SymbolDefinitions
): void {
  const bindings = engine.context.lexicalScope.bindings;

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
      if (isValidOperatorDef(entry)) {
        try {
          if (bindings.has(name))
            throw new Error(
              `Duplicate operator definition: "${name}"\n${JSON.stringify(
                bindings.get(name)!,
                undefined,
                4
              )}\n`
            );

          bindings.set(name, {
            operator: new _BoxedOperatorDefinition(engine, name, entry),
          });
        } catch (e) {
          console.error(
            [
              `\nError in operator definition`,
              JSON.stringify(entry, undefined, 4),
              '',
              e.message,
            ].join('\n|   ') + '\n'
          );
        }
      } else if (isValidValueDef(entry)) {
        try {
          if (bindings.has(name))
            throw new Error(`The symbol "${name}" is already defined`);

          bindings.set(name, {
            value: new _BoxedValueDefinition(engine, name, entry),
          });
        } catch (e) {
          console.error(
            [
              `\nError in value definition of "${name}"`,
              '',
              JSON.stringify(entry, undefined, 4),
              '',
              e.message,
            ].join('\n|   ')
          );
        }
      } else {
        const def = new _BoxedValueDefinition(engine, name, {
          value: engine.box(entry as any),
        });
        bindings.set(name, { value: def });
      }
    } catch (e) {
      console.error(
        [
          `\nError in definition of "${name}"`,
          '',
          JSON.stringify(entry, undefined, 4),
          '',
          e.message,
        ].join('\n|   ') + '\n'
      );
    }
  }
}
