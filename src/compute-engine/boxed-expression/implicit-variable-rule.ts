/**
 * The rule that says whether a symbol can be the implicit variable of a
 * calculus operator whose variable is not written (`Limit(√x, a)`,
 * `D(x^3)`, `Series(sin x)`, `Integrate(√x, Limits(Nothing, 0, 1))`).
 *
 * A leaf module on purpose: `implicitVariableCandidates()` (`utils.ts`) and
 * `implicitIntegralVariables()` (`binding-sites.ts`, which cannot import
 * `utils.ts`) both read the rule here, so that the variable that the
 * canonical form chooses and the variable that the free-variable walk and
 * `subs()` treat as bound are the same.
 */
import type { IComputeEngine as ComputeEngine } from '../global-types';
import { shadowsLibraryName } from '../library-shadowing.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isOperatorDef, isValueDef } from './definition-guards.js';

/**
 * True when `def`, the definition that the name `name` resolves to, was
 * installed by a library and not by the user. A library is the standard
 * library, a library given to the constructor (`libraries`), or a library
 * loaded with `ce.loadLibrary()`: a dependency graph keyed on the user's
 * cells has no cell for these names. The test reads:
 *
 * - the binding of the outermost (system) scope, where the standard library
 *   and the constructor's libraries are installed;
 * - `_libraryProvenance`, which records the binding each library installed,
 *   in the global scope for `ce.loadLibrary()`;
 * - for a library name that the current scope resolves to another binding,
 *   `shadowsLibraryName()` (`library-shadowing.ts`): an extension made with
 *   `ce.declare(name, patch, { extend: true })` that keeps the library's
 *   handlers is still the library operator.
 *
 * A user definition (`f(x) := …`, `ce.assign()`, `ce.declare()`) is none of
 * these. `def` is the binding (`{ value }` or `{ operator }`) or the
 * definition it holds.
 */
export function isLibraryDefinition(
  engine: ComputeEngine,
  name: string,
  def: object | undefined
): boolean {
  if (def === undefined) return false;
  const holds = (binding: unknown): boolean => {
    if (binding === undefined || binding === null) return false;
    const b = binding as { value?: object; operator?: object };
    return (
      b === def ||
      (b.value !== undefined && b.value === def) ||
      (b.operator !== undefined && b.operator === def)
    );
  };
  const system = engine.contextStack[0]?.lexicalScope.bindings.get(name);
  if (holds(system)) return true;
  if (holds(engine._libraryProvenance.get(name)?.binding)) return true;
  return (
    system !== undefined &&
    holds(engine.lookupDefinition(name)) &&
    !shadowsLibraryName(engine, name)
  );
}

/**
 * Whether the symbol `name` can be an implicit variable, from its
 * definition in the current scope. `isUnknown` is true when the caller found
 * the name among the unknowns of the expression.
 *
 * - An unknown that has the name of an operator is a candidate: an unknown
 *   can be bound in a scope of its own and still have the name of an
 *   operator in the caller's scope (`N` in `x + N`). Any other name of an
 *   operator (`Sin`) is not.
 * - A constant (`Pi`, `ExponentialE`) and a name defined by a library are
 *   not candidates.
 * - A symbol that cannot hold a number is not a candidate: its declared
 *   type, or the type of its value, has no value in common with `number` (a
 *   list, a string, a boolean, a function).
 */
export function isImplicitVariableCandidate(
  engine: ComputeEngine,
  name: string,
  isUnknown: boolean
): boolean {
  const def = engine.lookupDefinition(name);
  if (isOperatorDef(def)) return isUnknown;
  if (!isValueDef(def)) return true;
  if (def.value.isConstant) return false;
  if (!isUnknown && isLibraryDefinition(engine, name, def)) return false;
  return !(
    def.value.type.isDisjointFrom('number') ||
    def.value.value?.type.isDisjointFrom('number') === true
  );
}

/**
 * Whether the symbol `name` is a function symbol for `D`: a symbol with an
 * operator definition (`g(x) := x^2`, `Sin`), or a symbol whose DECLARED
 * type is a function (`ce.declare('f', 'function')`, with or without a
 * value), which has a value definition. An inferred type is not enough: it
 * is provisional.
 *
 * `D(f, x)` of a function symbol is the derivative of `f(x)`, and `D(f)`
 * has no implicit variable. The LaTeX serializer reads the same test
 * (`readsAsFunctionSymbol`): `\frac{\mathrm{d}f}{\mathrm{d}x}` reads back as
 * the derivative of `f(x)` exactly when `f` is a function symbol.
 */
export function isFunctionSymbolName(
  engine: ComputeEngine,
  name: string
): boolean {
  const def = engine.lookupDefinition(name);
  if (isOperatorDef(def)) return true;
  return (
    isValueDef(def) &&
    !def.value.inferredType &&
    isSubtype(def.value.type.type, 'function')
  );
}
