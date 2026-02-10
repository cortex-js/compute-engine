import type {
  IComputeEngine as ComputeEngine,
  LibraryDefinition,
} from './global-types';
import type { LatexDictionaryEntry, LibraryCategory } from './latex-syntax/types';
import { assertLibraryDefinitionContract } from './engine-extension-contracts';

import {
  STANDARD_LIBRARIES,
  getStandardLibrary,
  setSymbolDefinitions,
  sortLibraries,
} from './library/library';

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

export function loadLibraryDefinitions(
  engine: ComputeEngine,
  libraries: readonly LibraryDefinition[]
): void {
  for (const library of libraries) {
    const definitions = library.definitions;
    if (!definitions) continue;

    const tables = Array.isArray(definitions) ? definitions : [definitions];
    for (const table of tables) setSymbolDefinitions(engine, table);
  }
}

export function collectLibraryLatexEntries(
  libraries: readonly LibraryDefinition[]
): LatexDictionaryEntry[] {
  const result: LatexDictionaryEntry[] = [];
  for (const library of libraries) {
    if (library.latexDictionary)
      result.push(...(library.latexDictionary as LatexDictionaryEntry[]));
  }
  return result;
}

export function getLatexDictionaryForDomain(
  domain?: LibraryCategory | 'all'
): readonly Readonly<LatexDictionaryEntry>[] {
  const libraries =
    !domain || domain === 'all'
      ? STANDARD_LIBRARIES
      : STANDARD_LIBRARIES.filter((entry) => entry.name === domain);

  const result: LatexDictionaryEntry[] = [];
  for (const library of libraries) {
    if (library.latexDictionary)
      result.push(...(library.latexDictionary as LatexDictionaryEntry[]));
  }

  return result;
}
