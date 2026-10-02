import type {
  BoxedDefinition,
  EngineCheckpoint,
  IComputeEngine as ComputeEngine,
  LibraryDefinition,
  PartialSymbolDefinition,
  SymbolDefinitions,
} from './global-types.js';
import { assertLibraryDefinitionContract } from './engine-extension-contracts.js';
import { journalCheckpointMapEntry } from './checkpoint-journal.js';
import {
  isOperatorDef,
  isValueDef,
} from './boxed-expression/definition-guards.js';
import { isValidSymbol, validateSymbol } from '../math-json/symbols.js';

import {
  STANDARD_LIBRARIES,
  getStandardLibrary,
  setSymbolDefinitions,
  sortLibraries,
} from './library/library.js';

function resolveLibraryEntry(
  library: string | LibraryDefinition
): LibraryDefinition {
  if (typeof library !== 'string') {
    assertLibraryDefinitionContract(library);
    return library;
  }

  const found = STANDARD_LIBRARIES.find((entry) => entry.name === library);
  if (!found) throw new Error(`Unknown standard library: "${library}"`);
  return found;
}

export function resolveBootstrapLibraries(
  libraries?: readonly (string | LibraryDefinition)[]
): LibraryDefinition[] {
  if (!libraries) return [...getStandardLibrary()];
  return sortLibraries(libraries.map(resolveLibraryEntry));
}

/**
 * Is `library` one of the engine's own standard libraries?
 *
 * Decided by OBJECT IDENTITY against `STANDARD_LIBRARIES`, never by name: a
 * caller re-passing a standard entry by reference (or naming it as a string,
 * which `resolveLibraryEntry` resolves to that same object) is standard, while
 * a caller-authored library is custom even if it borrows a standard name.
 */
function isStandardLibrary(library: LibraryDefinition): boolean {
  return STANDARD_LIBRARIES.includes(library);
}

export function loadLibraryDefinitions(
  engine: ComputeEngine,
  libraries: readonly LibraryDefinition[]
): void {
  for (const library of libraries) {
    const definitions = library.definitions;
    if (!definitions) continue;

    // Record the provenance of caller-authored definitions: they are installed
    // in the SYSTEM scope, exactly like the standard ones, so consumers that
    // need to tell engine-authored from caller-authored code (compile-time CSE,
    // which exempts built-in `compile` handlers from its caller-splice guard)
    // cannot rely on scope identity alone.
    const custom = !isStandardLibrary(library);

    const tables = Array.isArray(definitions) ? definitions : [definitions];
    const bindings = engine.context.lexicalScope.bindings;
    for (const table of tables) {
      if (custom)
        for (const name of Object.keys(table))
          engine._customLibraryOperators.add(name.normalize());
      // A definition that fails is reported by `setSymbolDefinitions` and
      // skipped, and a name that an earlier library already defines keeps
      // that library's binding. So the provenance of a name is recorded
      // only when this table installed a NEW binding for it.
      const names = Object.keys(table).map((name) => name.normalize());
      const before = names.map((name) => bindings.get(name));
      setSymbolDefinitions(engine, table);
      names.forEach((name, i) => {
        const binding = bindings.get(name);
        if (binding !== undefined && binding !== before[i])
          engine._libraryProvenance.set(name, {
            library: library.name,
            binding,
          });
      });
    }
  }
  for (const library of libraries)
    engine._loadedLibraries.set(library.name, library);
}

/**
 * Install a caller library on an engine that is already constructed
 * (`ce.loadLibrary()`).
 *
 * The constructor installs libraries into the SYSTEM scope. This function
 * installs into the GLOBAL scope instead, with `ce.declare()`, so a library
 * loaded late behaves like the same definitions declared by the caller:
 * - an expression boxed before the call, with a head the library defines
 *   (`Sq(3)` that stayed `Sq(3)`), uses the new definition (`9`);
 * - the declarations are journaled, so `ce.restore()` of a checkpoint taken
 *   before the call removes them, and the provenance recorded here is
 *   journaled the same way;
 * - the code that tells built-in definitions from caller definitions by
 *   comparing with the system-scope binding (`systemScopeBinding()`,
 *   `shadowsLibraryName()`, the derivative of a user function) classifies
 *   these definitions as caller definitions with no other help. So the names
 *   are NOT added to `_customLibraryOperators`, which records only the caller
 *   definitions that the constructor put in the system scope.
 *
 * The checks, in order, each throwing an `Error` with the library name:
 * - the library has the shape the `libraries` constructor option requires;
 * - it is not one of the standard libraries: those are selected with the
 *   `libraries` constructor option, which puts them in the system scope;
 * - no library with the same name is loaded;
 * - each name in `requires` is a library that is already loaded;
 * - each definition name is a valid symbol, appears once in the library, is
 *   not defined by a library loaded earlier with `loadLibrary()`, and is not
 *   explicitly declared in the global scope. A name the engine only inferred
 *   from a use (for example `Sq` after `ce.box(['Sq', 3])`) can be defined.
 *   A name of the system scope (a standard operator such as `Sin`) can be
 *   defined: as with `ce.declare()`, the new definition shadows it.
 *
 * Nothing is installed when one of these checks fails. A definition that
 * `ce.declare()` itself rejects (for example an unknown key) throws when it
 * is reached. The declarations are made after an internal checkpoint, which
 * is restored before the error is thrown again: the definitions declared
 * before the failing one are removed, no provenance is recorded, and the
 * library is not recorded as loaded. The exception: while an evaluation, a
 * static pre-pass or a declaration batch is in progress, no checkpoint can be
 * taken, and the definitions declared before the failing one stay declared.
 */
export function loadLibraryLate(
  engine: ComputeEngine,
  library: LibraryDefinition
): void {
  assertLibraryDefinitionContract(library);
  const libName = library.name;

  if (isStandardLibrary(library))
    throw new Error(
      `Cannot load the standard library "${libName}" after the engine is constructed: use the "libraries" constructor option`
    );

  if (engine._loadedLibraries.has(libName))
    throw new Error(`A library named "${libName}" is already loaded`);

  for (const req of library.requires ?? [])
    if (!engine._loadedLibraries.has(req))
      throw new Error(
        STANDARD_LIBRARIES.some((l) => l.name === req)
          ? `Library "${libName}" requires the standard library "${req}", which is not loaded. A standard library cannot be loaded after the engine is constructed: select "${req}" with the "libraries" constructor option.`
          : `Library "${libName}" requires "${req}", which is not loaded. Load "${req}" first.`
      );

  const globalScope = engine.contextStack[1]?.lexicalScope;
  if (globalScope === undefined)
    throw new Error(
      `Cannot load library "${libName}": the engine has no global scope`
    );

  // Collect the entries and check them all before declaring any of them.
  const definitions = library.definitions;
  const tables: readonly SymbolDefinitions[] =
    definitions === undefined
      ? []
      : Array.isArray(definitions)
        ? definitions
        : [definitions];
  const entries: [string, PartialSymbolDefinition][] = [];
  const seen = new Set<string>();
  for (const table of tables)
    for (const [rawName, def] of Object.entries(table)) {
      const name = rawName.normalize();
      if (!isValidSymbol(name))
        throw new Error(
          `Library "${libName}": invalid definition name "${name}": ${validateSymbol(name)}`
        );
      if (seen.has(name))
        throw new Error(
          `Library "${libName}" defines "${name}" more than once`
        );
      seen.add(name);
      const existing = globalScope.bindings.get(name);
      // `ce.declare()` lets an operator with no explicit signature be
      // declared again. A library must not silently replace the definition
      // of another library.
      const owner = engine._libraryProvenance.get(name);
      if (existing !== undefined && owner?.binding === existing)
        throw new Error(
          `Library "${libName}": "${name}" is already defined by library "${owner.library}"`
        );
      if (!isUpgradable(existing))
        throw new Error(
          `Library "${libName}": "${name}" is already declared in the global scope`
        );
      entries.push([name, def]);
    }

  // A definition that `ce.declare()` rejects is found only when it is
  // declared. To declare nothing in that case, the declarations are made
  // after an internal checkpoint: on a failure, the checkpoint is restored,
  // which removes the definitions declared before the failing one and their
  // recorded provenance, and the error is thrown again. On success, the
  // checkpoint is discarded: its journal is merged into the checkpoint the
  // caller took before the call, if any, so `ce.restore()` of that
  // checkpoint still removes the library.
  //
  // A checkpoint cannot be taken while an evaluation, a static pre-pass or a
  // declaration batch is in progress. In that case the declarations are made
  // without one, and a failure leaves the definitions declared before the
  // failing one in place.
  let cp: EngineCheckpoint | undefined;
  try {
    cp = engine.checkpoint(`loadLibrary:${libName}`);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'checkpoint-not-quiescent')
      throw error;
  }

  try {
    for (const [name, def] of entries) {
      engine.declare(name, def, globalScope);
      const binding = globalScope.bindings.get(name);
      if (binding === undefined) continue;
      journalCheckpointMapEntry(
        engine,
        engine._libraryProvenance,
        name,
        `library-provenance:${name}`,
        'declare'
      );
      engine._libraryProvenance.set(name, { library: libName, binding });
    }

    journalCheckpointMapEntry(
      engine,
      engine._loadedLibraries,
      libName,
      `loaded-library:${libName}`,
      'declare'
    );
    engine._loadedLibraries.set(libName, library);
  } catch (error) {
    if (cp !== undefined) {
      engine.restore(cp);
      engine.discard(cp);
    }
    throw error;
  }
  if (cp !== undefined) engine.discard(cp);
}

/** Can `ce.declare()` replace this binding? Only when there is none, or when
 * it is a declaration the engine inferred from a use, with no value: the same
 * rule `ce.declare()` applies (`declareFn()`, `engine-declarations.ts`). */
function isUpgradable(existing: BoxedDefinition | undefined): boolean {
  if (existing === undefined) return true;
  if (isValueDef(existing))
    return (
      existing.value.inferredType === true && existing.value.value === undefined
    );
  if (isOperatorDef(existing)) return existing.operator.inferredSignature;
  return false;
}
