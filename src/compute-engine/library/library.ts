import { ARITHMETIC_LIBRARY } from './arithmetic.js';
import { CALCULUS_LIBRARY } from './calculus.js';
import { COLLECTIONS_LIBRARY } from './collections.js';
import { REGEXP_LIBRARY } from './regexp.js';
import { COLORS_LIBRARY } from './colors.js';
import { CONTROL_STRUCTURES_LIBRARY } from './control-structures.js';
import { COMBINATORICS_LIBRARY } from './combinatorics.js';
import { COMPLEX_LIBRARY } from './complex.js';
import { CORE_LIBRARY } from './core.js';
import { LINEAR_ALGEBRA_LIBRARY } from './linear-algebra.js';
import { LOGIC_LIBRARY, LOGIC_FUNCTION_LIBRARY } from './logic.js';
import { NUMBER_THEORY_LIBRARY } from './number-theory.js';
import { POLYNOMIALS_LIBRARY } from './polynomials.js';
import { RELOP_LIBRARY } from './relational-operator.js';
import { SETS_LIBRARY } from './sets.js';
import { SPECIAL_FUNCTIONS_LIBRARY } from './special-functions.js';
import { STATISTICS_LIBRARY } from './statistics.js';
import { DISTRIBUTIONS_LIBRARY } from './distributions.js';
import { TRIGONOMETRY_LIBRARY } from './trigonometry.js';
import { UNITS_LIBRARY, canonicalUnit } from './units.js';
import { QUANTITY_LIBRARY } from './quantity-kind.js';
import { ENCLOSURE_LIBRARY } from './enclosure.js';
import { FRACTALS_LIBRARY } from './fractals.js';

import type { LibraryCategory } from '../latex-syntax/types.js';

import { _BoxedValueDefinition } from '../boxed-expression/boxed-value-definition.js';
import { _BoxedExpression } from '../boxed-expression/abstract-boxed-expression.js';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols.js';
import {
  isValidOperatorDef,
  isValidValueDef,
} from '../boxed-expression/utils.js';
import type {
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
  LibraryDefinition,
  ExpressionInput,
  Expression,
  BoxedOperatorDefinition,
  OperatorDefinition,
  TaggedOperatorDefinition,
} from '../global-types.js';
import {
  _BoxedOperatorDefinition,
  buildDeferredLibraryOperator,
  noteDeferredLibraryEntry,
} from '../boxed-expression/boxed-operator-definition.js';
import {
  commitKindRegistration,
  deferKindValueGates,
  prepareKindRegistration,
} from '../boxed-expression/value-kinds.js';
import {
  isInstallingStandardLibrary,
  withStandardLibraryInstall,
} from '../boxed-expression/host-handler-changes.js';
import { inDeclaringScope } from '../boxed-expression/parameter-defaults.js';

/**
 * A unit symbol (`m`, `J`, `K`, …) for the `Quantity` value of a physical
 * constant.
 *
 * A unit name is not a variable, so it must not get a declaration. A plain
 * `ce.symbol(name)` declares a name that does not resolve as a new `unknown`
 * symbol in the current scope. While the libraries load, the current scope is
 * the system scope. Thus every unit name of a constant became a system-scope
 * variable: `K + 1` then read `K` from the system scope, and
 * `ce.undeclare('K')` refused it. The unit symbol is resolve-only: it binds to
 * an existing definition (for example, `N` is the `N` operator), and otherwise
 * it stays unbound.
 */
function unit(ce: ComputeEngine, name: string) {
  return ce.symbol(name, { autoDeclare: false });
}

/**
 * The `Quantity` value of a physical constant. The unit takes its canonical
 * form (see `canonicalUnit()`): `Power(mol, -1)` is `Divide(1, mol)`, the
 * tree that the parser gives for `\mathrm{1/mol}`. So the value of the
 * constant and the parse of its LaTeX are the same expression.
 */
function constantQuantity(
  ce: ComputeEngine,
  [magnitude, unitExpr]: [Expression, Expression]
): Expression {
  return ce._fn('Quantity', [magnitude, canonicalUnit(ce, unitExpr)]);
}

/**
 * The standard libraries bundled with the Compute Engine.
 *
 * Each entry bundles symbol/operator definitions and declares dependencies
 * on other libraries.
 */
export const STANDARD_LIBRARIES: LibraryDefinition[] = [
  {
    name: 'core',
    definitions: CORE_LIBRARY,
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
  },
  {
    name: 'collections',
    requires: ['core'],
    definitions: [SETS_LIBRARY, COLLECTIONS_LIBRARY],
  },
  {
    name: 'colors',
    requires: ['core'],
    definitions: COLORS_LIBRARY,
  },
  {
    name: 'regexp',
    requires: ['core'],
    definitions: REGEXP_LIBRARY,
  },
  {
    name: 'relop',
    requires: ['core'],
    definitions: RELOP_LIBRARY,
  },
  {
    name: 'arithmetic',
    requires: ['core'],
    definitions: [...ARITHMETIC_LIBRARY, ...COMPLEX_LIBRARY, ENCLOSURE_LIBRARY],
  },
  {
    name: 'fractals',
    requires: ['arithmetic'],
    definitions: FRACTALS_LIBRARY,
  },
  {
    name: 'trigonometry',
    requires: ['arithmetic'],
    definitions: TRIGONOMETRY_LIBRARY,
  },
  {
    name: 'calculus',
    requires: ['arithmetic'],
    definitions: CALCULUS_LIBRARY,
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
    name: 'special-functions',
    requires: ['arithmetic'],
    definitions: SPECIAL_FUNCTIONS_LIBRARY,
  },
  {
    name: 'linear-algebra',
    requires: ['arithmetic'],
    definitions: LINEAR_ALGEBRA_LIBRARY,
  },
  {
    name: 'statistics',
    requires: ['arithmetic'],
    definitions: [...STATISTICS_LIBRARY, ...DISTRIBUTIONS_LIBRARY],
  },
  {
    name: 'units',
    requires: ['arithmetic'],
    definitions: [UNITS_LIBRARY, QUANTITY_LIBRARY],
  },
  {
    name: 'physics',
    requires: ['arithmetic', 'units'],
    definitions: {
      SpeedOfLight: {
        description: 'Speed of light in vacuum',
        isConstant: true,
        wikidata: 'Q2111',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(299792458),
            ce._fn('Divide', [unit(ce, 'm'), unit(ce, 's')]),
          ]),
      },
      PlanckConstant: {
        description: 'Planck constant',
        isConstant: true,
        wikidata: 'Q122894',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(6.62607015e-34),
            ce._fn('Multiply', [unit(ce, 'J'), unit(ce, 's')]),
          ]),
      },
      Mu0: {
        description: 'Vacuum permeability',
        isConstant: true,
        wikidata: 'Q1515261',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(1.25663706212e-6),
            ce._fn('Divide', [
              unit(ce, 'N'),
              ce._fn('Power', [unit(ce, 'A'), ce.number(2)]),
            ]),
          ]),
      },
      StandardGravity: {
        description: 'Standard acceleration due to gravity',
        isConstant: true,
        wikidata: 'Q30006',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(9.80665),
            ce._fn('Divide', [
              unit(ce, 'm'),
              ce._fn('Power', [unit(ce, 's'), ce.number(2)]),
            ]),
          ]),
      },
      ElementaryCharge: {
        description: 'Elementary electric charge',
        isConstant: true,
        wikidata: 'Q2101',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [ce.number(1.602176634e-19), unit(ce, 'C')]),
      },
      BoltzmannConstant: {
        description: 'Boltzmann constant',
        isConstant: true,
        wikidata: 'Q5962',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(1.380649e-23),
            ce._fn('Divide', [unit(ce, 'J'), unit(ce, 'K')]),
          ]),
      },
      AvogadroConstant: {
        description: 'Avogadro constant',
        isConstant: true,
        wikidata: 'Q6203',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(6.02214076e23),
            ce._fn('Power', [unit(ce, 'mol'), ce.number(-1)]),
          ]),
      },
      VacuumPermittivity: {
        description: 'Vacuum permittivity (electric constant)',
        isConstant: true,
        wikidata: 'Q6158',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(8.8541878128e-12),
            ce._fn('Divide', [unit(ce, 'F'), unit(ce, 'm')]),
          ]),
      },
      GravitationalConstant: {
        description: 'Newtonian constant of gravitation',
        isConstant: true,
        wikidata: 'Q18373',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(6.6743e-11),
            ce._fn('Divide', [
              ce._fn('Power', [unit(ce, 'm'), ce.number(3)]),
              ce._fn('Multiply', [
                unit(ce, 'kg'),
                ce._fn('Power', [unit(ce, 's'), ce.number(2)]),
              ]),
            ]),
          ]),
      },
      StefanBoltzmannConstant: {
        description: 'Stefan-Boltzmann constant',
        isConstant: true,
        wikidata: 'Q51374',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(5.670374419e-8),
            ce._fn('Divide', [
              unit(ce, 'W'),
              ce._fn('Multiply', [
                ce._fn('Power', [unit(ce, 'm'), ce.number(2)]),
                ce._fn('Power', [unit(ce, 'K'), ce.number(4)]),
              ]),
            ]),
          ]),
      },
      GasConstant: {
        description: 'Molar gas constant',
        isConstant: true,
        wikidata: 'Q182333',
        type: 'quantity',
        value: (ce) =>
          constantQuantity(ce, [
            ce.number(8.314462618),
            ce._fn('Divide', [
              unit(ce, 'J'),
              ce._fn('Multiply', [unit(ce, 'mol'), unit(ce, 'K')]),
            ]),
          ]),
      },
    },
  },
];

/**
 * Topological sort of libraries that keeps the input order wherever the
 * dependencies allow it.
 *
 * The libraries are visited in input order. Before a library is added, each
 * library in its `requires` list is visited (and added) first, also in order.
 * As a result, a library comes after every library listed before it in the
 * input, unless an earlier library requires it: then it moves ahead of the
 * first library that requires it. A caller library listed after
 * the standard libraries, which no standard library requires, thus loads after
 * them, even when it has no `requires` list: its definitions can use operators
 * such as `Loop` (from `control-structures`) without declaring them.
 *
 * Throws on a duplicate name, a cycle or a missing dependency.
 */
export function sortLibraries(libs: LibraryDefinition[]): LibraryDefinition[] {
  const byName = new Map<string, LibraryDefinition>();
  for (const lib of libs) {
    if (byName.has(lib.name))
      throw new Error(`Duplicate library name: "${lib.name}"`);
    byName.set(lib.name, lib);
  }

  for (const lib of libs) {
    for (const req of lib.requires ?? []) {
      if (!byName.has(req))
        throw new Error(
          `Library "${lib.name}" requires "${req}", which is not available`
        );
    }
  }

  const sorted: LibraryDefinition[] = [];
  const done = new Set<string>();
  // The libraries being visited, from the outermost to the innermost
  const visiting: string[] = [];

  const visit = (lib: LibraryDefinition): void => {
    if (done.has(lib.name)) return;
    const index = visiting.indexOf(lib.name);
    if (index >= 0) {
      throw new Error(
        `Circular dependency detected among libraries: ${visiting
          .slice(index)
          .join(', ')}`
      );
    }
    visiting.push(lib.name);
    for (const req of lib.requires ?? []) visit(byName.get(req)!);
    visiting.pop();
    done.add(lib.name);
    sorted.push(lib);
  };

  for (const lib of libs) visit(lib);

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

  // Each requested library comes with the libraries it requires, directly or
  // indirectly: every standard library except `core` requires another one,
  // and a list without them cannot be sorted or loaded.
  const selected = new Set<LibraryDefinition>();
  const add = (name: string): void => {
    const lib = STANDARD_LIBRARIES.find((l) => l.name === name);
    if (!lib) throw new Error(`Unknown library category "${name}"`);
    if (selected.has(lib)) return;
    selected.add(lib);
    for (const req of lib.requires ?? []) add(req);
  };
  for (const cat of categories) add(cat);

  return Object.freeze(sortLibraries([...selected]));
}

function validateDefinitionName(name: string): string {
  name = name.normalize();
  if (isValidSymbol(name)) return name;
  throw new Error(`Invalid definition name "${name}": ${validateSymbol(name)}`); // @todo: cause
}

/**
 * True if the definition of `name` in a library table can be built at the
 * first read of its binding instead of when the table is installed: the
 * table is a standard library table, and making the definition changes no
 * state of the engine beyond the binding. A definition with an `arithmetic`
 * field registers a value kind, and a definition of `Add` or `Multiply` can
 * mark the engine as one with ordered arithmetic
 * (`noteArithmeticDefinition()`): these are built at once.
 */
function isDeferrableLibraryOperator(
  name: string,
  entry: OperatorDefinition
): boolean {
  return (
    isInstallingStandardLibrary() &&
    entry.arithmetic === undefined &&
    name !== 'Add' &&
    name !== 'Multiply'
  );
}

/**
 * The binding of the operator `name` of a standard library table, whose
 * definition is built at the first read of its `operator` property. An
 * engine reads a small part of the library, and building every definition
 * was most of the time of `new ComputeEngine()` (CE-1289).
 *
 * The binding is in the scope from the start, so `has()`, `size` and the
 * iteration of the bindings are unchanged, and `'operator' in binding` is
 * true. The first read replaces the accessor with a data property that holds
 * the definition; a write before the first read replaces it with the value
 * written, and the definition is never built.
 *
 * The definition is built with the state the engine had when it installed
 * the table: the scope of the table (and the declaring scope that the
 * parameter defaults are boxed in), no facts, the mark of a standard library
 * install, `strict`, the kind value gates held, and `undefined` placeholders
 * for the `operands` probes (`buildDeferredLibraryOperator()`). The type
 * registry is not saved: a type name that a library signature resolves is a
 * registry record that is never replaced, and a name it does not resolve
 * would have made the install fail.
 *
 * The definition is built from a copy of the table entry, made when the
 * binding is installed, at the depth that the build reads each field (see
 * the comment above the copy): the tables are public
 * (`ComputeEngine.getStandardLibrary()`), and a host that replaces a field of
 * an entry after the engine is built must not change the engine, as with a
 * definition built at install.
 *
 * A definition that fails to build is reported at its first read, as an
 * eager install reports it: the error is logged once, the binding is
 * removed from the scope of the table (and from the library provenance), and
 * the error is thrown to the reader. The binding object then has no
 * `operator`, so a reader that kept it does not build it again.
 */
function deferredOperatorBinding(
  engine: ComputeEngine,
  name: string,
  tableEntry: OperatorDefinition
): TaggedOperatorDefinition {
  // Copied at the depth the eager build reads them: `examples` (list), `collection` (handlers), `invokes` (map), `discharges` (map and label lists), `effects` (labels); every other field is kept by reference, as by an eager definition.
  const snapshot = { ...tableEntry } as Record<string, unknown>;
  if (Array.isArray(tableEntry.examples))
    snapshot.examples = [...tableEntry.examples];
  if (tableEntry.collection !== undefined)
    snapshot.collection = { ...tableEntry.collection };
  if (typeof tableEntry.invokes === 'object' && tableEntry.invokes !== null)
    snapshot.invokes = { ...tableEntry.invokes };
  if (tableEntry.discharges !== undefined)
    snapshot.discharges = Object.fromEntries(
      Object.entries(tableEntry.discharges).map(([k, labels]) => [
        k,
        [...labels],
      ])
    );
  if (
    tableEntry.effects !== undefined &&
    typeof tableEntry.effects !== 'string'
  )
    snapshot.effects = [...tableEntry.effects];
  const entry = snapshot as OperatorDefinition;
  const scope = engine.context.lexicalScope;
  const strict = engine.strict;
  const binding = {} as TaggedOperatorDefinition;
  const settle = (operator: BoxedOperatorDefinition) =>
    Object.defineProperty(binding, 'operator', {
      value: operator,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  const build = (): BoxedOperatorDefinition => {
    let operator: BoxedOperatorDefinition | undefined;
    const previousStrict = engine.strict;
    engine.strict = strict;
    try {
      withStandardLibraryInstall(() =>
        deferKindValueGates(engine, () =>
          engine._inScope(
            scope === engine.context.lexicalScope ? undefined : scope,
            () =>
              inDeclaringScope(engine, name, scope, () =>
                engine._withoutFacts(() => {
                  operator = buildDeferredLibraryOperator(engine, name, entry);
                })
              )
          )
        )
      );
    } finally {
      engine.strict = previousStrict;
    }
    return operator!;
  };
  let building = false;
  Object.defineProperty(binding, 'operator', {
    enumerable: true,
    configurable: true,
    get(): BoxedOperatorDefinition {
      if (building)
        throw new Error(
          `The library definition of "${name}" was read while it was built`
        );
      building = true;
      let operator: BoxedOperatorDefinition;
      try {
        operator = build();
      } catch (e) {
        delete (binding as { operator?: unknown }).operator;
        if (scope.bindings.get(name) === binding) scope.bindings.delete(name);
        if (engine._libraryProvenance.get(name)?.binding === binding)
          engine._libraryProvenance.delete(name);
        console.error(
          [
            `\nError in operator definition`,
            JSON.stringify(entry, undefined, 4),
            '',
            e instanceof Error ? e.message : String(e),
          ].join('\n|   ') + '\n'
        );
        throw e;
      } finally {
        building = false;
      }
      settle(operator);
      return operator;
    },
    set(operator: BoxedOperatorDefinition) {
      settle(operator);
    },
  });
  noteDeferredLibraryEntry(binding, entry);
  return binding;
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

          if (isDeferrableLibraryOperator(name, entry)) {
            bindings.set(name, deferredOperatorBinding(engine, name, entry));
            continue;
          }

          const operator = new _BoxedOperatorDefinition(engine, name, entry);
          // A library value kind (the `arithmetic` field): checked before the
          // binding is installed, so a refused definition is reported and
          // skipped like any other. A library registration does not open the
          // per-engine gates of its kind type (an engine that never makes a
          // value of the kind pays nothing for it).
          const kind =
            operator.arithmetic === undefined
              ? undefined
              : prepareKindRegistration(
                  engine,
                  name,
                  operator.signature.type,
                  operator.arithmetic,
                  { library: true }
                );
          bindings.set(name, { operator });
          if (kind !== undefined)
            commitKindRegistration(engine, operator, kind);
        } catch (e) {
          console.error(
            [
              `\nError in operator definition`,
              JSON.stringify(entry, undefined, 4),
              '',
              e instanceof Error ? e.message : String(e),
            ].join('\n|   ') + '\n'
          );
        }
      } else if (isValidValueDef(entry)) {
        try {
          if (bindings.has(name))
            throw new Error(`The symbol "${name}" is already defined`);

          bindings.set(name, {
            value: new _BoxedValueDefinition(engine, name, entry, {
              trustedLibraryDefinition: true,
            }),
          });
        } catch (e) {
          console.error(
            [
              `\nError in value definition of "${name}"`,
              '',
              JSON.stringify(entry, undefined, 4),
              '',
              e instanceof Error ? e.message : String(e),
            ].join('\n|   ')
          );
        }
      } else {
        const def = new _BoxedValueDefinition(
          engine,
          name,
          { value: engine.expr(entry as unknown as ExpressionInput) },
          { trustedLibraryDefinition: true }
        );
        bindings.set(name, { value: def });
      }
    } catch (e) {
      console.error(
        [
          `\nError in definition of "${name}"`,
          '',
          JSON.stringify(entry, undefined, 4),
          '',
          e instanceof Error ? e.message : String(e),
        ].join('\n|   ') + '\n'
      );
    }
  }
}
