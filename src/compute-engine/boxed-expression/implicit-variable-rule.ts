/**
 * The rule that says whether a symbol can be the implicit variable of a
 * calculus operator whose variable is not written (`Limit(√x, a)`,
 * `D(x^3)`, `Series(sin x)`, `Integrate(√x, Limits(Nothing, 0, 1))`).
 *
 * A leaf module on purpose: the canonical form of the calculus operators
 * (through `implicitVariableCandidates()`, which `utils.ts` re-exports) and
 * `implicitIntegralVariables()` (`binding-sites.ts`, which cannot import
 * `utils.ts`) both read the rule here, so that the variable that the
 * canonical form chooses and the variable that the free-variable walk and
 * `subs()` treat as bound are the same, for a canonical and for a
 * non-canonical `Integrate`.
 */
import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types';
import { shadowsLibraryName } from '../library-shadowing.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isOperatorDef, isValueDef } from './definition-guards.js';
import { isSymbol } from './type-guards.js';
import {
  ANONYMOUS_SLOT_NAMES,
  isFunctionLiteralParameter,
} from './function-literal.js';

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
 * The symbols of `exprs` that can be the implicit variable of a calculus
 * operator whose variable is not written (`Limit(√x, a)`, `D(x^3)`,
 * `Series(sin x)`, `Integrate(√x, Limits(Nothing, 0, 1))`), in sorted order
 * (code-unit order, so an uppercase letter comes before a lowercase one).
 *
 * The variable is a bound variable: it never takes the value assigned to a
 * symbol of the same name. The candidates are the symbols written in the
 * expression, with or without a value: the unknowns, and the user symbols
 * that are read and have a value (the `references`). So the choice does not
 * change when a symbol gets a value before or after boxing. When nothing has
 * a value, the candidates are the unknowns.
 *
 * A constant (`Pi`, `ExponentialE`), a symbol of a library, a symbol that
 * names a function, an anonymous slot (`_`, `_1`) and a symbol bound inside
 * the expression (the index of a `Sum`) are not candidates. A symbol whose
 * declared type, or the type of whose value, has no value in common with
 * `number` (a list, a string, a boolean, a function value) is not a
 * candidate either: with `L := [1, 2, 3]`, the variable of `Total(L)·t` is
 * `t`.
 *
 * A symbol that holds a formula (`loneSymbolFormula()`) is not a candidate:
 * the candidates of its formula are, and a symbol of that formula that
 * holds a formula is read in the same way. With `G := sin(x)`, the
 * candidate of `2G` is `x`, and the candidates of `G + t` are `t` and `x`.
 * So the variable of a formula does not change when a part of the formula
 * is given a name. A symbol whose value reaches the symbol again
 * (`P := Q + 1` and `Q := P + 1`) is a candidate where the value reaches
 * it.
 *
 * Limitation: a formula is known only when the symbol holds it. An
 * expression that is boxed before `G := sin(x)` has the candidate `G` for
 * `2G`, and a canonical form made then keeps `G` as its variable.
 *
 * Limitation: the type of a symbol with no declaration is known only when
 * it gets a value. So the two orders can still give different variables for
 * a symbol that is not declared and gets a value that is not a number after
 * boxing: boxed before `L := [1, 2, 3]`, `L` is a candidate of `Total(L)·t`
 * and is the variable (the first in sorted order); boxed after, `t` is.
 *
 * Works on lazily-held (non-canonical) operands, as `defaultUnknown` does.
 */
export function implicitVariableCandidates(
  ...exprs: ReadonlyArray<Expression>
): string[] {
  return [...candidatesOfExpressions(exprs, newFormulaRead())].sort();
}

/**
 * The candidates of `implicitVariableCandidates()` for `exprs` when no
 * symbol is read as its formula: a symbol that holds a formula is a
 * candidate itself. For a caller that knows that the names of `exprs` do
 * not denote the definitions of the engine: a name that an Epsil program
 * binds (`resolve-library-names.ts`) can have the name of a symbol that
 * holds a formula in the engine.
 */
export function implicitVariableCandidatesAsWritten(
  ...exprs: ReadonlyArray<Expression>
): string[] {
  return [...candidatesOfExpressions(exprs, undefined)].sort();
}

/**
 * The state of one read of the formulas that symbols hold
 * (`formulaAndCandidates()`):
 *
 * - `reading`: the symbols whose formulas are being read. A symbol in it
 *   holds no formula, so the read of a value that reaches its own symbol
 *   again ends.
 * - `cycles`: how many times the read reached a symbol of `reading`.
 * - `known`: the result for each symbol whose read reached no symbol of
 *   `reading`. Such a result does not depend on the path of the read, so a
 *   symbol that several formulas read is read once. A symbol whose read
 *   reaches a cycle of values has no known result and is read once for
 *   each path, so the cost grows with the number of paths to the cycle
 *   (`A1 := A2`, …, `An := A1` costs 2^n reads).
 */
type FormulaRead = {
  reading: Set<string>;
  cycles: number;
  known: Map<string, HeldFormula | undefined>;
};

/** The formula that a symbol holds and the candidates of that formula. */
type HeldFormula = { formula: Expression; candidates: ReadonlySet<string> };

function newFormulaRead(): FormulaRead {
  return { reading: new Set(), cycles: 0, known: new Map() };
}

/**
 * The candidates of `implicitVariableCandidates()` for `exprs`, not sorted.
 * `read` is the state of the read of the formulas; with `undefined`, no
 * symbol is read as its formula.
 */
function candidatesOfExpressions(
  exprs: ReadonlyArray<Expression>,
  read: FormulaRead | undefined
): Set<string> {
  const candidates = new Set<string>();
  for (const e of exprs)
    for (const s of candidatesFromWalks(
      e.engine,
      {
        unknowns: e.unknowns,
        references: e.references,
        referencedFunctions: e.referencedFunctions,
      },
      read
    ))
      candidates.add(s);
  return candidates;
}

/**
 * The candidates of `implicitVariableCandidates()` for one expression, from
 * the results of its walks: its `unknowns`, its `references` and its
 * `referencedFunctions`. A caller that walks the expression already (the
 * free-variable walk, `abstract-boxed-expression.ts`) gives its own results,
 * so that the walk of a nested integral does not start three new walks of
 * its integrand at each level. The result is not sorted.
 */
export function implicitVariableCandidatesFrom(
  engine: ComputeEngine,
  walks: CandidateWalks
): string[] {
  return [...candidatesFromWalks(engine, walks, newFormulaRead())];
}

/** The walks of an expression that give its candidates
 * (`implicitVariableCandidatesFrom()`). */
type CandidateWalks = {
  unknowns: Iterable<string>;
  references: Iterable<string>;
  referencedFunctions: Iterable<string>;
};

function candidatesFromWalks(
  engine: ComputeEngine,
  walks: CandidateWalks,
  read: FormulaRead | undefined
): Set<string> {
  const functions = new Set(walks.referencedFunctions);
  const unknowns = new Set(walks.unknowns);
  const candidates = new Set<string>();
  for (const s of [...unknowns, ...walks.references]) {
    if (ANONYMOUS_SLOT_NAMES.has(s) || functions.has(s)) continue;
    // The rule for one symbol: operator names, constants, library
    // symbols and symbols that cannot hold a number are excluded
    // (`isImplicitVariableCandidate()`).
    if (!isImplicitVariableCandidate(engine, s, unknowns.has(s))) continue;
    // A symbol that holds a formula gives the candidates of the formula:
    // with `G := sin(x)`, the candidate of `2G` is `x`. An unknown has no
    // value, so it holds no formula.
    const held =
      read === undefined || unknowns.has(s)
        ? undefined
        : formulaAndCandidates(engine, s, read);
    if (held === undefined) candidates.add(s);
    else for (const v of held.candidates) candidates.add(v);
  }
  return candidates;
}

/**
 * The formula that the symbol `name` holds, when a lone `name` is the
 * operand of the implicit form of a calculus operator whose variable is not
 * written (`Limit(G, 0)`, `NLimit`, `ND`, `NIntegrate`,
 * `Integrate(G, Limits(Nothing, 0, 1))`); otherwise `undefined`.
 *
 * Such an operand is read as its value, and the variable is chosen from the
 * symbols of the value with the rule of the implicit form: with
 * `G := sin(x)`, `Limit(G, 0)` is the limit of `sin(x)` as x → 0, and
 * `\int_0^1 G` is `1 − cos(1)`, not `∫₀¹ G dG`.
 *
 * A symbol holds a formula when it is a user symbol with a value
 * definition, is not a constant, and its value is not a function and has a
 * candidate for the variable (`implicitVariableCandidates()`). A symbol that
 * names a function (`Sin`, `g(t) := t^2`, a value of function type) keeps
 * its reading: its parameter is the variable. A symbol with no value, or
 * whose value has no candidate (`c := 5`), keeps its reading too: it is its
 * own variable for `Integrate` and a constant for the others.
 *
 * A value that is itself a lone symbol is read again: with `G := H` and
 * `H := sin(x)`, the formula of `G` is `sin(x)`; with `G := x` and `x` with
 * no value, it is `x`. A cycle of such values (`G := H`, `H := G`) has no
 * formula.
 *
 * A parameter of a function literal is not read through the argument of a
 * running call: in `f(t) := \int_0^1 t`, the integral is `∫₀¹ t dt` at
 * definition, and a call `f(sin(x))` does not change its variable.
 */
export function loneSymbolFormula(
  engine: ComputeEngine,
  name: string
): Expression | undefined {
  return formulaAndCandidates(engine, name, newFormulaRead())?.formula;
}

/**
 * The formula that the symbol `name` holds (`loneSymbolFormula()`) and the
 * candidates of that formula (`implicitVariableCandidates()`), or
 * `undefined` when `name` holds no formula.
 *
 * A symbol whose formula is being read (`read.reading`) holds no formula. A
 * symbol is removed from `read.reading` when its read ends, so a symbol
 * that two parts of a formula read (`G` in `G + K` with `K := G + 1`) holds
 * its formula in each part.
 */
function formulaAndCandidates(
  engine: ComputeEngine,
  name: string,
  read: FormulaRead
): HeldFormula | undefined {
  if (read.reading.has(name)) {
    read.cycles += 1;
    return undefined;
  }
  if (read.known.has(name)) return read.known.get(name);
  const cycles = read.cycles;
  const held = readFormulaAndCandidates(engine, name, read);
  if (read.cycles === cycles) read.known.set(name, held);
  return held;
}

/** The read of `formulaAndCandidates()` for a symbol that is not being
 * read and has no known result. */
function readFormulaAndCandidates(
  engine: ComputeEngine,
  name: string,
  read: FormulaRead
): HeldFormula | undefined {
  const def = engine.lookupDefinition(name);
  if (!isValueDef(def)) return undefined;
  if (
    def.value.isConstant ||
    isFunctionLiteralParameter(def.value) ||
    isLibraryDefinition(engine, name, def)
  )
    return undefined;
  if (def.value.type.matches('function')) return undefined;
  const value = def.value.value;
  if (
    value === undefined ||
    value.operator === 'Function' ||
    value.type.matches('function')
  )
    return undefined;
  read.reading.add(name);
  try {
    const candidates = candidatesOfExpressions([value], read);
    if (candidates.size === 0) return undefined;
    if (isSymbol(value)) {
      // The chain ends at the symbol only when the symbol has no value
      // (`G := x`). A symbol that holds a value that is not a formula
      // (`H := 5`) gives no formula for the whole chain, and so does a
      // cycle: the test at the entry of `formulaAndCandidates()` catches
      // it.
      const target = engine.lookupDefinition(value.symbol);
      if (isValueDef(target) && target.value.value !== undefined)
        return formulaAndCandidates(engine, value.symbol, read);
    }
    return { formula: value, candidates };
  } finally {
    read.reading.delete(name);
  }
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
