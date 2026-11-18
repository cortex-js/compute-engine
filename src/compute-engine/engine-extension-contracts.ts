import type { LibraryDefinition } from './global-types.js';
import { assertStorageHintsShape } from './compilation/storage-hints.js';
import type { CompilationOptions } from './compilation/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertExtensionName(
  value: unknown,
  options: { kind: 'library' }
): string {
  if (typeof value !== 'string')
    throw new Error(`${options.kind} name must be a string`);

  if (value.length === 0)
    throw new Error(`${options.kind} name must not be empty`);

  if (value.trim() !== value)
    throw new Error(
      `${options.kind} name must not include leading or trailing whitespace`
    );

  if (/\s/u.test(value))
    throw new Error(`${options.kind} name must not include whitespace`);

  return value;
}

export function assertLibraryName(name: unknown): string {
  return assertExtensionName(name, { kind: 'library' });
}

function assertLibraryRequires(value: unknown, libraryName: string): void {
  if (value === undefined) return;

  if (!Array.isArray(value))
    throw new Error(
      `Invalid library "${libraryName}": "requires" must be an array of library names`
    );

  const seenDependencies = new Set<string>();
  for (const dependency of value) {
    let normalizedDependency: string;
    try {
      normalizedDependency = assertLibraryName(dependency);
    } catch (e) {
      throw new Error(
        `Invalid library "${libraryName}": ${(e as Error).message}`
      );
    }

    if (seenDependencies.has(normalizedDependency)) {
      throw new Error(
        `Invalid library "${libraryName}": duplicate dependency "${normalizedDependency}"`
      );
    }

    seenDependencies.add(normalizedDependency);
  }
}

function assertLibraryDefinitions(value: unknown, libraryName: string): void {
  if (value === undefined) return;

  const tables = Array.isArray(value) ? value : [value];
  for (const table of tables) {
    if (!isRecord(table) || Array.isArray(table)) {
      throw new Error(
        `Invalid library "${libraryName}": "definitions" must be an object or an array of objects`
      );
    }
  }
}

export function assertLibraryDefinitionContract(
  library: unknown
): asserts library is LibraryDefinition {
  if (!isRecord(library) || Array.isArray(library))
    throw new Error(
      'Invalid library definition: expected an object with at least a "name" field'
    );

  const name = assertLibraryName(library.name);

  assertLibraryRequires(library.requires, name);
  assertLibraryDefinitions(library.definitions, name);
}

/**
 * The mode names that pass option validation. `'auto'` is not a
 * `CompileMode` any more, but it is accepted here so that a request for it
 * reaches `compile()`, which declines it with `code: 'unsupported-mode'` and
 * names `'complex'` as its replacement. An option error here would throw out
 * of `compile()` instead of giving that decline.
 */
const COMPILE_MODES: readonly string[] = [
  'strict',
  'complex',
  'auto',
  'bigint',
];

/**
 * The options of `compile()` that 0.194.0 removed, with the replacement that
 * the error names (the migration note of 0.194.0 in `CHANGELOG.md`). The
 * option types no longer have them; a JavaScript caller that still passes
 * one gets this error rather than an option that is silently ignored.
 */
const REMOVED_OPTIONS: Readonly<Record<string, string>> = {
  target:
    "compile to a built-in target with the option `to` ('javascript', 'glsl' or 'interval-js')",
  functions:
    'define the function in the engine with a body, or give its operator a `compile` handler that returns an expression',
  operators: 'the operators of a target are not configurable',
  imports: 'the compiled code is self-contained',
  preamble: 'put the definitions in the host code that uses the result',
  strictTypes:
    'read the `provenance` of each entry of `freeSymbolTypes` in the result',
  broadcast: '`broadcast()` of the result needs no option',
};

function assertNoRemovedOption(options: Record<string, unknown>): void {
  for (const [name, replacement] of Object.entries(REMOVED_OPTIONS))
    if (options[name] !== undefined)
      throw new Error(
        `The compilation option "${name}" was removed in 0.194.0: ${replacement}. See the migration note of 0.194.0 in the changelog.`
      );
}

function assertCompilationOptionsVars(value: unknown): void {
  if (value === undefined) return;

  if (!isRecord(value) || Array.isArray(value)) {
    throw new Error('Invalid compilation option "vars": expected a record');
  }

  for (const [name, variable] of Object.entries(value)) {
    if (typeof variable !== 'string') {
      throw new Error(
        `Invalid compilation option "vars.${name}": expected a string`
      );
    }
  }
}

export function assertCompilationOptionsContract(
  options: unknown
): asserts options is CompilationOptions & {
  fallback?: boolean;
} {
  if (options === undefined) return;

  if (!isRecord(options) || Array.isArray(options)) {
    throw new Error('Invalid compilation options: expected an object');
  }

  if (options.to !== undefined && typeof options.to !== 'string') {
    throw new Error('Invalid compilation option "to": expected a string');
  }

  assertNoRemovedOption(options);

  assertCompilationOptionsVars(options.vars);

  if (options.fallback !== undefined && typeof options.fallback !== 'boolean') {
    throw new Error(
      'Invalid compilation option "fallback": expected a boolean'
    );
  }

  if (
    options.mode !== undefined &&
    !COMPILE_MODES.includes(options.mode as string)
  ) {
    throw new Error(
      'Invalid compilation option "mode": expected "strict", "complex" or "bigint"'
    );
  }

  if (
    options.constantFold !== undefined &&
    typeof options.constantFold !== 'boolean'
  ) {
    throw new Error(
      'Invalid compilation option "constantFold": expected a boolean'
    );
  }

  // The shape half of the `storage` contract (an object of known storage
  // kinds). The name half — every hinted name is a free symbol of the
  // expression — needs the expression, and runs in `compile()` itself.
  assertStorageHintsShape(options.storage);

  if (
    options.iterationBudget !== undefined &&
    (typeof options.iterationBudget !== 'number' ||
      !(options.iterationBudget > 0))
  ) {
    throw new Error(
      'Invalid compilation option "iterationBudget": expected a positive number'
    );
  }

  if (options.profile !== undefined && options.profile !== 'ir') {
    throw new Error('Invalid compilation option "profile": expected "ir"');
  }

  if (
    options.quadrature !== undefined &&
    options.quadrature !== 'adaptive' &&
    options.quadrature !== 'monte-carlo'
  ) {
    throw new Error(
      'Invalid compilation option "quadrature": expected "adaptive" or "monte-carlo"'
    );
  }

  if (
    options.symbolDeps !== undefined &&
    !(options.symbolDeps instanceof Set)
  ) {
    throw new Error(
      'Invalid compilation option "symbolDeps": expected a Set of symbol ids'
    );
  }

  if (
    options.varsObjectRefs !== undefined &&
    !(options.varsObjectRefs instanceof Set)
  ) {
    throw new Error(
      'Invalid compilation option "varsObjectRefs": expected a Set of symbol ids'
    );
  }
}
