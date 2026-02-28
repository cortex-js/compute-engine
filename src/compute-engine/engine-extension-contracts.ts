import type { Expression, LibraryDefinition } from './global-types';
import type {
  LanguageTarget,
  CompileTarget,
  CompilationOptions,
} from './compilation/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertExtensionName(
  value: unknown,
  options: { kind: 'library' | 'compilation target' }
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

export function assertCompilationTargetName(name: unknown): string {
  return assertExtensionName(name, { kind: 'compilation target' });
}

export function assertLibraryName(name: unknown): string {
  return assertExtensionName(name, { kind: 'library' });
}

const REQUIRED_TARGET_METHODS = [
  'getOperators',
  'getFunctions',
  'createTarget',
  'compile',
] as const;

export function assertCompilationTargetContract(
  target: unknown
): asserts target is LanguageTarget<Expression> {
  if (!isRecord(target))
    throw new Error(
      'Invalid compilation target: expected an object implementing LanguageTarget'
    );

  for (const methodName of REQUIRED_TARGET_METHODS) {
    if (typeof target[methodName] !== 'function') {
      throw new Error(
        `Invalid compilation target: missing required method "${methodName}()"`
      );
    }
  }
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

function assertCompileTargetContract(
  target: unknown
): asserts target is CompileTarget<Expression> {
  if (!isRecord(target))
    throw new Error('Invalid compile target: expected an object');

  if (typeof target.var !== 'function')
    throw new Error('Invalid compile target: missing required method "var()"');
  if (typeof target.string !== 'function')
    throw new Error(
      'Invalid compile target: missing required method "string()"'
    );
  if (typeof target.number !== 'function')
    throw new Error(
      'Invalid compile target: missing required method "number()"'
    );
  if (typeof target.ws !== 'function')
    throw new Error('Invalid compile target: missing required method "ws()"');
  if (typeof target.preamble !== 'string')
    throw new Error('Invalid compile target: "preamble" must be a string');
  if (!isFiniteNumber(target.indent))
    throw new Error('Invalid compile target: "indent" must be a finite number');

  if (
    target.operators !== undefined &&
    typeof target.operators !== 'function'
  ) {
    throw new Error('Invalid compile target: "operators" must be a function');
  }

  if (
    target.functions !== undefined &&
    typeof target.functions !== 'function'
  ) {
    throw new Error('Invalid compile target: "functions" must be a function');
  }

  if (target.language !== undefined && typeof target.language !== 'string') {
    throw new Error('Invalid compile target: "language" must be a string');
  }
}

function assertOperatorEntry(operator: string, value: unknown): void {
  if (value === undefined) return;

  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    !isFiniteNumber(value[1])
  ) {
    throw new Error(
      `Invalid compilation option "operators.${operator}": expected [string, number]`
    );
  }
}

function assertCompilationOptionsOperators(value: unknown): void {
  if (value === undefined) return;

  if (typeof value === 'function') return;

  if (!isRecord(value) || Array.isArray(value)) {
    throw new Error(
      'Invalid compilation option "operators": expected a function or a record'
    );
  }

  for (const [operator, entry] of Object.entries(value)) {
    assertOperatorEntry(operator, entry);
  }
}

function assertCompilationOptionsFunctions(value: unknown): void {
  if (value === undefined) return;

  if (!isRecord(value) || Array.isArray(value)) {
    throw new Error(
      'Invalid compilation option "functions": expected a record'
    );
  }

  for (const [name, fn] of Object.entries(value)) {
    if (typeof fn !== 'string' && typeof fn !== 'function') {
      throw new Error(
        `Invalid compilation option "functions.${name}": expected a string or function`
      );
    }
  }
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

function assertCompilationOptionsImports(value: unknown): void {
  if (value === undefined) return;

  if (!Array.isArray(value)) {
    throw new Error('Invalid compilation option "imports": expected an array');
  }
}

export function assertCompilationOptionsContract(
  options: unknown
): asserts options is CompilationOptions<Expression> & {
  fallback?: boolean;
} {
  if (options === undefined) return;

  if (!isRecord(options) || Array.isArray(options)) {
    throw new Error('Invalid compilation options: expected an object');
  }

  if (options.to !== undefined && typeof options.to !== 'string') {
    throw new Error('Invalid compilation option "to": expected a string');
  }

  if (options.target !== undefined) {
    assertCompileTargetContract(options.target);
  }

  assertCompilationOptionsOperators(options.operators);
  assertCompilationOptionsFunctions(options.functions);
  assertCompilationOptionsVars(options.vars);
  assertCompilationOptionsImports(options.imports);

  if (options.preamble !== undefined && typeof options.preamble !== 'string') {
    throw new Error('Invalid compilation option "preamble": expected a string');
  }

  if (options.fallback !== undefined && typeof options.fallback !== 'boolean') {
    throw new Error(
      'Invalid compilation option "fallback": expected a boolean'
    );
  }
}
