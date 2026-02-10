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

import { DEFINITIONS_ALGEBRA } from '../latex-syntax/dictionary/definitions-algebra';
import { DEFINITIONS_ARITHMETIC } from '../latex-syntax/dictionary/definitions-arithmetic';
import { DEFINITIONS_CALCULUS } from '../latex-syntax/dictionary/definitions-calculus';
import { DEFINITIONS_COMPLEX } from '../latex-syntax/dictionary/definitions-complex';
import { DEFINITIONS_CORE } from '../latex-syntax/dictionary/definitions-core';
import { DEFINITIONS_INEQUALITIES } from '../latex-syntax/dictionary/definitions-relational-operators';
import { DEFINITIONS_LINEAR_ALGEBRA } from '../latex-syntax/dictionary/definitions-linear-algebra';
import { DEFINITIONS_LOGIC } from '../latex-syntax/dictionary/definitions-logic';
import { DEFINITIONS_OTHERS } from '../latex-syntax/dictionary/definitions-other';
import { DEFINITIONS_SETS } from '../latex-syntax/dictionary/definitions-sets';
import { DEFINITIONS_STATISTICS } from '../latex-syntax/dictionary/definitions-statistics';
import { DEFINITIONS_SYMBOLS } from '../latex-syntax/dictionary/definitions-symbols';
import { DEFINITIONS_TRIGONOMETRY } from '../latex-syntax/dictionary/definitions-trigonometry';

import type { LibraryCategory } from '../latex-syntax/types';

import { _BoxedValueDefinition } from '../boxed-expression/boxed-value-definition';
import { _BoxedExpression } from '../boxed-expression/abstract-boxed-expression';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols';
import { isValidOperatorDef, isValidValueDef } from '../boxed-expression/utils';
import type {
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
  LibraryDefinition,
  ExpressionInput,
} from '../global-types';
import { _BoxedOperatorDefinition } from '../boxed-expression/boxed-operator-definition';

/**
 * The standard libraries bundled with the Compute Engine.
 *
 * Each entry bundles symbol/operator definitions with their LaTeX dictionary
 * entries and declares dependencies on other libraries.
 */
export const STANDARD_LIBRARIES: LibraryDefinition[] = [
  {
    name: 'core',
    definitions: CORE_LIBRARY,
    latexDictionary: [
      ...DEFINITIONS_CORE,
      ...DEFINITIONS_SYMBOLS,
      ...DEFINITIONS_ALGEBRA,
    ],
  },
  {
    name: 'control-structures',
    requires: ['core'],
    definitions: CONTROL_STRUCTURES_LIBRARY,
  },
  {
    name: 'logic',
    requires: ['core'],
    definitions: [LOGIC_LIBRARY, LOGIC_FUNCTION_LIBRARY],
    latexDictionary: DEFINITIONS_LOGIC,
  },
  {
    name: 'collections',
    requires: ['core'],
    definitions: [SETS_LIBRARY, COLLECTIONS_LIBRARY],
    latexDictionary: DEFINITIONS_SETS,
  },
  {
    name: 'relop',
    requires: ['core'],
    definitions: RELOP_LIBRARY,
    latexDictionary: DEFINITIONS_INEQUALITIES,
  },
  {
    name: 'arithmetic',
    requires: ['core'],
    definitions: [...ARITHMETIC_LIBRARY, ...COMPLEX_LIBRARY],
    latexDictionary: [...DEFINITIONS_ARITHMETIC, ...DEFINITIONS_COMPLEX],
  },
  {
    name: 'trigonometry',
    requires: ['arithmetic'],
    definitions: TRIGONOMETRY_LIBRARY,
    latexDictionary: DEFINITIONS_TRIGONOMETRY,
  },
  {
    name: 'calculus',
    requires: ['arithmetic'],
    definitions: CALCULUS_LIBRARY,
    latexDictionary: DEFINITIONS_CALCULUS,
  },
  {
    name: 'polynomials',
    requires: ['arithmetic'],
    definitions: POLYNOMIALS_LIBRARY,
  },
  {
    name: 'combinatorics',
    requires: ['arithmetic'],
    definitions: COMBINATORICS_LIBRARY,
  },
  {
    name: 'number-theory',
    requires: ['arithmetic'],
    definitions: NUMBER_THEORY_LIBRARY,
  },
  {
    name: 'linear-algebra',
    requires: ['arithmetic'],
    definitions: LINEAR_ALGEBRA_LIBRARY,
    latexDictionary: DEFINITIONS_LINEAR_ALGEBRA,
  },
  {
    name: 'statistics',
    requires: ['arithmetic'],
    definitions: STATISTICS_LIBRARY,
    latexDictionary: DEFINITIONS_STATISTICS,
  },
  {
    name: 'physics',
    requires: ['arithmetic'],
    definitions: {
      Mu0: {
        description: 'Vaccum permeability',
        isConstant: true,
        wikidata: 'Q1515261',
        type: 'real',
        value: 1.25663706212e-6,
      },
    },
    latexDictionary: [
      {
        name: 'mu0',
        kind: 'symbol',
        latexTrigger: '\\mu_0',
      },
    ],
  },
  {
    name: 'other',
    requires: ['core'],
    latexDictionary: DEFINITIONS_OTHERS,
  },
];

/**
 * Topological sort of libraries using Kahn's algorithm.
 * Throws on cycle or missing dependency.
 */
export function sortLibraries(libs: LibraryDefinition[]): LibraryDefinition[] {
  const byName = new Map<string, LibraryDefinition>();
  for (const lib of libs) {
    if (byName.has(lib.name))
      throw new Error(`Duplicate library name: "${lib.name}"`);
    byName.set(lib.name, lib);
  }

  // Build in-degree map (only count dependencies within the provided set)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → libs that need it

  for (const lib of libs) {
    if (!inDegree.has(lib.name)) inDegree.set(lib.name, 0);
    for (const req of lib.requires ?? []) {
      if (!byName.has(req))
        throw new Error(
          `Library "${lib.name}" requires "${req}", which is not available`
        );
      inDegree.set(lib.name, (inDegree.get(lib.name) ?? 0) + 1);
      const deps = dependents.get(req);
      if (deps) deps.push(lib.name);
      else dependents.set(req, [lib.name]);
    }
  }

  // Seed queue with libraries that have no dependencies
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const sorted: LibraryDefinition[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(byName.get(name)!);
    for (const dep of dependents.get(name) ?? []) {
      const newDeg = inDegree.get(dep)! - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  if (sorted.length !== libs.length) {
    const remaining = libs
      .filter((l) => !sorted.some((s) => s.name === l.name))
      .map((l) => l.name);
    throw new Error(
      `Circular dependency detected among libraries: ${remaining.join(', ')}`
    );
  }

  return sorted;
}

/**
 * Return the standard libraries, optionally filtered by category name.
 * Libraries are returned in dependency order (topologically sorted).
 */
export function getStandardLibrary(
  categories?: LibraryCategory[] | LibraryCategory | 'all'
): readonly LibraryDefinition[] {
  if (!categories || categories === 'all')
    return Object.freeze(sortLibraries([...STANDARD_LIBRARIES]));

  if (typeof categories === 'string') categories = [categories];

  const filtered = categories.map((cat) => {
    const lib = STANDARD_LIBRARIES.find((l) => l.name === cat);
    if (!lib) throw new Error(`Unknown library category "${cat}"`);
    return lib;
  });

  return Object.freeze(sortLibraries(filtered));
}

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
          value: engine.box(entry as unknown as ExpressionInput),
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
