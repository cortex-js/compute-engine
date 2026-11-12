import type {
  BoxedDefinition,
  IComputeEngine as ComputeEngine,
  LibraryDefinition,
  PartialSymbolDefinition,
  SymbolDefinitions,
} from './global-types.js';
import type { Scope } from './types-evaluation.js';
import { assertLibraryDefinitionContract } from './engine-extension-contracts.js';
import {
  isOperatorDef,
  isReplaceableOperatorShell,
  isValueDef,
} from './boxed-expression/definition-guards.js';
import { isValidSymbol, validateSymbol } from '../math-json/symbols.js';
import { recordEngineCompileHandler } from './compilation/engine-compile-handlers.js';
import type { ConfigurationChangeListener } from '../common/configuration-change.js';
import { isFunction } from './boxed-expression/type-guards.js';
import { withStandardLibraryInstall } from './boxed-expression/host-handler-changes.js';
import {
  deferKindValueGates,
  kindRegistryRollbackPoint,
  kindTypesOfHeadName,
} from './boxed-expression/value-kinds.js';

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
  // A library constant whose value is a kind value (a physical constant is a
  // quantity) does not open the gates of its kind type while the libraries
  // load: its value is made again when it is first read, which opens them
  // then (`deferKindValueGates()`, `value-kinds.ts`).
  const deferred = deferKindValueGates(engine, () =>
    installLibraryDefinitions(engine, libraries)
  );
  if (deferred.size > 0) recomputeKindConstants(engine);
  for (const library of libraries)
    engine._loadedLibraries.set(library.name, library);
}

/**
 * Ask each constant of the system scope whose value is a call of a head
 * that declares a value kind (the `Quantity` value of `SpeedOfLight`) to
 * compute its value again when it is next read. The value made while the
 * libraries loaded did not open the gates of its kind type
 * (`deferKindValueGates()`); the value made at the first read does.
 */
function recomputeKindConstants(engine: ComputeEngine): void {
  for (const binding of engine.context.lexicalScope.bindings.values()) {
    if (!isValueDef(binding)) continue;
    const def = binding.value;
    if (!def.isConstant) continue;
    const value = def.storedValue;
    if (value === undefined || !isFunction(value)) continue;
    if (kindTypesOfHeadName(engine, value.operator) === undefined) continue;
    // A constant listens to the changes of configuration (precision, angular
    // unit), and computes its value again at the next read after one.
    if ('onConfigurationChange' in def)
      (def as unknown as ConfigurationChangeListener).onConfigurationChange?.();
  }
}

function installLibraryDefinitions(
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
      // The `compile` handlers of a standard library write the engine's own
      // code, which may run on a worker of the kernel pool. Every other
      // handler is caller code (see `engine-compile-handlers.ts`).
      else
        for (const def of Object.values(table))
          if (typeof def === 'object' && def !== null && 'compile' in def)
            recordEngineCompileHandler(def.compile);
      // A definition that fails is reported by `setSymbolDefinitions` and
      // skipped, and a name that an earlier library already defines keeps
      // that library's binding. So the provenance of a name is recorded
      // only when this table installed a NEW binding for it.
      const names = Object.keys(table).map((name) => name.normalize());
      const before = names.map((name) => bindings.get(name));
      // The operator definitions that a standard library makes are marked as
      // library code, not host code (`host-handler-changes.ts`).
      if (custom) setSymbolDefinitions(engine, table);
      else
        withStandardLibraryInstall(() => setSymbolDefinitions(engine, table));
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
 * is reached. Before the error is thrown again, the definitions declared
 * before the failing one are removed (`undoLibraryDeclarations()`): each
 * name gets back the binding it had before the call, or none, and the
 * provenance it had; the type registry and the registry of value kinds are
 * put back. The library is not recorded as loaded. A user function whose
 * definition was rebuilt when an earlier name was declared keeps that
 * rebuild, as after `ce.undeclare()` (CE-1247).
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
  // declared. The binding and the provenance of each name are recorded
  // before its declaration, and the type and kind registries before the
  // first one (a definition can add a type record or register a value kind),
  // so that a failure can put them back.
  const before: DeclaredName[] = [];
  const restoreTypes = engine._typeRegistryRollbackPoint();
  const restoreKinds = kindRegistryRollbackPoint(engine);
  try {
    for (const [name, def] of entries) {
      before.push({
        name,
        binding: globalScope.bindings.get(name),
        provenance: engine._libraryProvenance.get(name),
      });
      engine.declare(name, def, globalScope);
      const binding = globalScope.bindings.get(name);
      if (binding === undefined) continue;
      engine._libraryProvenance.set(name, { library: libName, binding });
    }
    engine._loadedLibraries.set(libName, library);
  } catch (error) {
    undoLibraryDeclarations(engine, globalScope, before);
    restoreKinds();
    restoreTypes();
    throw error;
  }
}

/** A name of a library that `loadLibraryLate()` declares: the binding it
 * had in the global scope before the declaration, and its provenance. */
type DeclaredName = {
  name: string;
  binding: BoxedDefinition | undefined;
  provenance: ReturnType<ComputeEngine['_libraryProvenance']['get']>;
};

/**
 * Remove the declarations that `loadLibraryLate()` made before one failed,
 * in the reverse order. The provenance of each name is put back first,
 * because `ce.undeclare()` refuses a name that a library defines. A name
 * whose binding is unchanged (the failing declaration put its binding back
 * itself) is left alone. Otherwise the new binding is removed with
 * `ce.undeclare()`, and the binding that the declaration replaced (a name
 * the engine inferred from a use) is put back: `ce.declare()` replaces the
 * binding record, so an expression boxed before the call holds that record.
 */
function undoLibraryDeclarations(
  engine: ComputeEngine,
  globalScope: Scope,
  before: ReadonlyArray<DeclaredName>
): void {
  for (let i = before.length - 1; i >= 0; i--) {
    const { name, binding, provenance } = before[i];
    if (provenance === undefined) engine._libraryProvenance.delete(name);
    else engine._libraryProvenance.set(name, provenance);
    const current = globalScope.bindings.get(name);
    if (current === binding) continue;
    if (current !== undefined)
      engine._inScope(globalScope, () => engine.undeclare(name));
    if (binding !== undefined) globalScope.bindings.set(name, binding);
  }
}

/** Can `ce.declare()` replace this binding? Only when there is none, or when
 * it is a declaration the engine inferred from a use, with no value: the same
 * rule `ce.declare()` applies (`declareFn()`, `engine-declarations.ts`). An
 * operator with an inferred signature is upgradable only when it holds nothing
 * the author gave (`isReplaceableOperatorShell()`): an operator that the
 * author declared with a handler but no `signature` also has an inferred
 * signature. */
function isUpgradable(existing: BoxedDefinition | undefined): boolean {
  if (existing === undefined) return true;
  if (isValueDef(existing))
    return (
      existing.value.inferredType === true && existing.value.value === undefined
    );
  if (isOperatorDef(existing))
    return isReplaceableOperatorShell(existing.operator);
  return false;
}
