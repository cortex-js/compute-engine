import type {
  IComputeEngine as ComputeEngine,
  LibraryDefinition,
} from './global-types.js';
import { assertLibraryDefinitionContract } from './engine-extension-contracts.js';

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
    for (const table of tables) {
      if (custom)
        for (const name of Object.keys(table))
          engine._customLibraryOperators.add(name.normalize());
      setSymbolDefinitions(engine, table);
    }
  }
}
