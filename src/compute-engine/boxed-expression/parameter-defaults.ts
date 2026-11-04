/**
 * Default values of the optional parameters of a function signature
 * (`(x: number, factor: number = 2) -> number`): where a default may be
 * written, the checks a declaration makes on it, and the boxed default
 * operands that a definition keeps.
 *
 * The type parser reads a default anywhere a signature can be written, but a
 * default is used only on the top-level signature of an operator definition
 * (`ce.declare`, `ce.assign`) and of a declared variable
 * (`ce.declare("g", "(number, number = 2) -> number")`). Anywhere else
 * nothing would box, check or insert it, so the declaration that installs
 * such a type throws.
 *
 * The design is in `docs/plans/2026-10-31-parameter-default-values.md`
 * (rules R1, R4 and R9).
 */

import type {
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import type {
  FunctionSignature,
  NamedElement,
  ParameterDefault,
  Type,
} from '../../common/type/types.js';
import { hasFreeTypeVariables } from '../../common/type/instantiate.js';
import {
  isCharacter,
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from './type-guards.js';
import {
  parameterDefaultToString,
  typeToString,
} from '../../common/type/serialize.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import { isValueDef } from './definition-guards.js';
import { journalCheckpointMapEntry } from '../checkpoint-journal.js';

/** The message of a declaration that uses a default in a nested position. */
export const NESTED_DEFAULT_MESSAGE =
  'a default value is allowed only in a top-level function signature';

/** The message of a declaration whose overloaded signature has a default. */
export const OVERLOADED_DEFAULT_MESSAGE =
  'a default value in an overloaded signature is not supported yet';

/** The message of a default that is a symbol that is not constant (see
 * {@link isConstantSymbolDefault}). A default is a constant: a symbol that
 * names a variable would be read when the call runs, in a scope that the
 * declaration does not know. */
export const SYMBOL_DEFAULT_MESSAGE =
  'a default value is a constant: write a number, a string, a boolean, `[]`, `{}`, a constant (a library constant or a symbol declared constant) or a symbol that the parameter type lists, or pass the argument';

/** The message of a signature that has both a variadic parameter and a
 * default. */
export const VARIADIC_DEFAULT_MESSAGE =
  'a function with a variadic parameter has no default values: drop the default or the variadic parameter';

/** The message of a default on a parameter whose type mentions a type
 * variable. */
export const GENERIC_DEFAULT_MESSAGE =
  'a default value on a generic parameter is not supported yet';

/**
 * The type operands of the full-signature markers of function literals
 * (`["Typed", body, "(x: T, k: number = 2) -> T where T"]`). Such a
 * signature is the top-level signature of the literal, so a default value
 * on one of its parameters is the default of a parameter of the literal.
 * The `Typed` operator refuses a default in any other ascription; it reads
 * this set to accept one here. `canonicalFunctionLiteralArguments()` checks
 * that each default matches the default of the literal's parameter and that
 * no default is nested deeper in the signature, then adds the operand.
 */
const SIGNATURE_MARKER_OPERANDS = new WeakSet<Expression>();

/** Record `op` as the type operand of a function literal's full-signature
 * marker. See {@link SIGNATURE_MARKER_OPERANDS}. */
export function markSignatureMarkerOperand(op: Expression): void {
  SIGNATURE_MARKER_OPERANDS.add(op);
}

/** True when `op` is the type operand of a function literal's
 * full-signature marker. See {@link SIGNATURE_MARKER_OPERANDS}. */
export function isSignatureMarkerOperand(op: Expression): boolean {
  return SIGNATURE_MARKER_OPERANDS.has(op);
}

/**
 * True when a parameter default occurs anywhere in `t`: on a parameter of a
 * signature at any depth, or on a tuple element. A nominal reference is not
 * followed into its definition: a type declaration refuses a default in its
 * body, so only the type arguments of an applied reference can hold one.
 */
export function typeHasParameterDefault(t: Type | undefined): boolean {
  if (t === undefined || typeof t === 'string') return false;
  const some = (es: ReadonlyArray<NamedElement> | undefined) =>
    es?.some((e) => e.default !== undefined || typeHasParameterDefault(e.type));
  switch (t.kind) {
    case 'signature':
      return (
        some(t.args) === true ||
        some(t.optArgs) === true ||
        (t.variadicArg !== undefined &&
          (t.variadicArg.default !== undefined ||
            typeHasParameterDefault(t.variadicArg.type))) ||
        typeHasParameterDefault(t.result) ||
        (t.typeParams?.some((p) => typeHasParameterDefault(p.bound)) ?? false)
      );
    case 'union':
    case 'intersection':
      return t.types.some(typeHasParameterDefault);
    case 'negation':
      return typeHasParameterDefault(t.type);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return typeHasParameterDefault(t.elements);
    case 'tuple':
      return some(t.elements) === true;
    case 'dictionary':
      return typeHasParameterDefault(t.values);
    case 'record':
    case 'object':
      return Object.values(t.elements).some(typeHasParameterDefault);
    case 'reference':
      return t.args?.some(typeHasParameterDefault) ?? false;
    default:
      return false;
  }
}

/**
 * Throw when `t` has a parameter default anywhere. For a type that is not
 * the top-level signature of a definition: a `Typed` annotation, a type
 * declaration, or a part of a signature. `subject` starts the message
 * (`Type "T"`, `Symbol "x"`).
 */
export function assertNoParameterDefault(subject: string, t: Type): void {
  if (typeHasParameterDefault(t))
    throw new Error(`${subject}: ${NESTED_DEFAULT_MESSAGE}`);
}

/**
 * Throw when the parameter defaults of the declared type `t` are not where a
 * definition can use them. Only the parameters of `t` itself, when `t` is a
 * single signature, can have a default; a default in an arm of an overloaded
 * (intersection) signature, on a parameter whose type mentions a type
 * variable, or anywhere else in `t` (a parameter type, the result type, an
 * element type, a union arm) is refused.
 *
 * Returns the signature when it has at least one default, so the caller can
 * box them, and `undefined` otherwise.
 */
export function topLevelSignatureWithDefaults(
  subject: string,
  t: Type
): FunctionSignature | undefined {
  if (!typeHasParameterDefault(t)) return undefined;
  if (typeof t === 'object' && t.kind === 'intersection') {
    if (
      t.types.some(
        (arm) =>
          typeof arm === 'object' &&
          arm.kind === 'signature' &&
          arm.optArgs?.some((a) => a.default !== undefined)
      )
    )
      throw new Error(`${subject}: ${OVERLOADED_DEFAULT_MESSAGE}`);
  }
  if (typeof t !== 'object' || t.kind !== 'signature')
    throw new Error(`${subject}: ${NESTED_DEFAULT_MESSAGE}`);
  // The defaults of the signature itself are allowed; a default in the type
  // of a parameter or of the result is nested.
  const nested =
    [...(t.args ?? []), ...(t.optArgs ?? [])].some((a) =>
      typeHasParameterDefault(a.type)
    ) ||
    (t.variadicArg !== undefined &&
      typeHasParameterDefault(t.variadicArg.type)) ||
    typeHasParameterDefault(t.result) ||
    (t.typeParams?.some((p) => typeHasParameterDefault(p.bound)) ?? false);
  if (nested) throw new Error(`${subject}: ${NESTED_DEFAULT_MESSAGE}`);
  // The type parser refuses a default outside the optional parameters and a
  // defaulted optional parameter after an optional parameter without a
  // default. A signature given as a `Type` object is not parsed, so the same
  // rules are checked here. A call that leaves out trailing arguments gets
  // the defaults by position, so the defaulted parameters must be the first
  // optional parameters (`defaultedSlotsAsRequired()` relies on it).
  if (t.args?.some((a) => a.default !== undefined))
    throw new Error(
      `${subject}: A required parameter cannot have a default value`
    );
  if (t.variadicArg?.default !== undefined)
    throw new Error(
      `${subject}: A variadic parameter cannot have a default value`
    );
  if (
    t.variadicArg !== undefined &&
    t.optArgs?.some((a) => a.default !== undefined)
  )
    throw new Error(`${subject}: ${VARIADIC_DEFAULT_MESSAGE}`);
  const firstWithout = t.optArgs?.findIndex((a) => a.default === undefined);
  if (
    firstWithout !== undefined &&
    firstWithout >= 0 &&
    t.optArgs!.slice(firstWithout).some((a) => a.default !== undefined)
  )
    throw new Error(
      `${subject}: A parameter with a default value cannot follow an optional parameter without one`
    );
  // A default on a parameter whose type mentions a type variable has no
  // defined check before the variable is instantiated.
  if (
    t.optArgs?.some(
      (a) => a.default !== undefined && hasFreeTypeVariables(a.type)
    )
  )
    throw new Error(`${subject}: ${GENERIC_DEFAULT_MESSAGE}`);
  return t.optArgs?.some((a) => a.default !== undefined) ? t : undefined;
}

/** The names of the literal symbol types (`symbol<Auto>`) that the
 * parameter type `t` lists: `t` itself, or the arms of a union
 * (`symbol<Auto> | symbol<Manual>`). Empty for any other type. */
export function literalSymbolNames(t: Type): string[] {
  const r = resolveTypeAlias(t);
  if (typeof r !== 'object') return [];
  if (r.kind === 'symbol') return [r.name];
  if (r.kind !== 'union') return [];
  const names: string[] = [];
  for (const arm of r.types) {
    const a = resolveTypeAlias(arm);
    if (typeof a === 'object' && a.kind === 'symbol') names.push(a.name);
  }
  return names;
}

/**
 * True when the symbol `name` is a constant default for a parameter of type
 * `type` (`undefined` for a parameter with no annotation). This is the one
 * check of a symbol default, for a declared signature and for a function
 * literal. A constant symbol default is one of:
 *
 * - a symbol that the parameter type lists as a literal symbol type:
 *   `Auto` in `mode: symbol<Auto> | symbol<Manual> = Auto`;
 * - a constant: a symbol that the scope of the declaration binds to a value
 *   definition that is constant. This is a constant of the standard library
 *   (`Integers`, `Pi`), or a symbol that the host or the program declared
 *   constant (`ce.declare('W0', { isConstant: true, value: 5 })`, an Epsil
 *   `const`). A local of the same name in a scope between the declaration
 *   and the system scope hides the outer constant, and the local is the
 *   definition that is read.
 *
 * Any other symbol names a variable (`(k = n) ↦ k`), or is not declared,
 * and is refused (`SYMBOL_DEFAULT_MESSAGE`). `Nothing` and `Missing` are
 * not values that a call can receive in place of an argument, and are
 * refused too. `True` and `False` are boolean values, not symbols, for a
 * default (`literalParameterDefault()`).
 *
 * The default is boxed once, where the function is declared, and the call
 * that leaves out the argument receives that symbol, as if the call had
 * written it. Nothing is read where the call is made.
 */
export function isConstantSymbolDefault(
  ce: ComputeEngine,
  name: string,
  type: Type | undefined
): boolean {
  if (name === 'Nothing' || name === 'Missing') return false;
  if (type !== undefined && literalSymbolNames(type).includes(name))
    return true;
  // The declaration of the name that the program last canonicalized
  // (`CONSTANT_DECLARATIONS`), in the nearest scope that declares the name
  // or binds it. The mark comes before the binding: a binding can be left
  // by an earlier run on the same engine (a notebook cell run again after
  // an edit), and the declaration that the program makes now decides. So
  // after an earlier `let W = 5`, `const W = 5; function f(k = W) {…}`
  // accepts the default, and after an earlier `const W = 5`,
  // `let W = 7; function f(k = W) {…}` refuses it. The binding decides
  // only in a scope with no mark for the name.
  for (
    let scope: Scope | null | undefined = ce.context.lexicalScope;
    scope;
    scope = scope.parent
  ) {
    const mark = CONSTANT_DECLARATIONS.get(scope)?.get(name);
    if (mark !== undefined) return mark === 'const';
    if (scope.bindings.get(name) !== undefined) break;
  }
  const def = ce.lookupDefinition(name);
  return def !== undefined && isValueDef(def) && def.value.isConstant === true;
}

/**
 * For each scope, a mark for each name that a declaration of the scope
 * declares: `'const'` for a constant declaration with a value (an Epsil
 * `const W = 5`, `Declare(W, {value: 5, constant: True})`), `'variable'`
 * for any other declaration (an Epsil `let`). Any value counts for a
 * constant declaration, as for a constant that the host declares
 * (`ce.declare('W', { isConstant: true, value: [1] })`): the binding is
 * constant when the declaration has run, whatever its value.
 *
 * The binding of such a name is constant only when the declaration runs. A
 * function or a lambda of a later statement of the same program
 * (`function f(k = W)`) is canonicalized before that, when the binding is
 * not constant yet, or does not exist yet (the static check of a program
 * canonicalizes each top-level statement without running it). The `Declare`
 * canonical handler records the name here, and `isConstantSymbolDefault()`
 * accepts it as a constant. A function statement before the declaration (a
 * hoisted `function f(k = W)` above `const W = 5`) is canonicalized before
 * the name is recorded, so its default is refused.
 *
 * A mark is removed when the declaration runs (`declareSteps()` in
 * `library/core.ts`) and when the host declares the name (`ce.declare()`):
 * the binding then decides. A known limitation: the mark of a declaration
 * that is canonicalized and never run stays. On an engine where `W` is a
 * variable, canonicalize `Declare(W, {value: 5, constant: True})` without
 * evaluating it: `(k = W) ↦ k` is then accepted as a constant default, and
 * a call of it reads the variable `W`.
 */
const CONSTANT_DECLARATIONS = new WeakMap<
  Scope,
  Map<string, 'const' | 'variable'>
>();

/**
 * Record the declaration of `name` in the current lexical scope, with the
 * canonical attributes dictionary `attributes` (`undefined` when the
 * declaration has none) and the positional initializer `initializer`
 * (`undefined` when the declaration has none, as in
 * `Declare(W, integer, 5, {constant: True})` it is `5`). A declaration with
 * `constant: True` and a value (the initializer or a `value` entry of
 * `attributes`) marks the name `'const'` in `CONSTANT_DECLARATIONS`.
 * Any other declaration of the name (a `let`) marks it `'variable'`, so
 * that the name is a variable for a later statement, whatever binding an
 * earlier run left.
 *
 * Each write is journaled for checkpoint restore
 * (`journalCheckpointMapEntry()`): a restore puts back the mark that the
 * name had when the checkpoint was taken, or removes it.
 */
export function noteConstantDeclaration(
  ce: ComputeEngine,
  name: string,
  attributes: Expression | undefined,
  initializer?: Expression
): void {
  const scope = ce.context.lexicalScope;
  let marks = CONSTANT_DECLARATIONS.get(scope);
  if (marks === undefined) {
    marks = new Map();
    CONSTANT_DECLARATIONS.set(scope, marks);
  }
  journalCheckpointMapEntry(ce, marks, name, name);
  marks.set(
    name,
    isConstantDeclarationWithValue(attributes, initializer)
      ? 'const'
      : 'variable'
  );
}

/**
 * Remove the mark of `name` in the scope `scope` from
 * `CONSTANT_DECLARATIONS`. `ce.declare()` and the run of a `Declare`
 * (`declareSteps()`) call it: the binding that the declaration makes then
 * decides whether the name is a constant default. So after a constant declaration that was canonicalized
 * and has not run, `ce.declare('W', 'integer')` makes `W` a variable
 * for a later default. The write is journaled for checkpoint restore, as
 * in `noteConstantDeclaration()`.
 */
export function forgetConstantDeclaration(
  ce: ComputeEngine,
  name: string,
  scope: Scope
): void {
  const marks = CONSTANT_DECLARATIONS.get(scope);
  if (marks === undefined || !marks.has(name)) return;
  journalCheckpointMapEntry(ce, marks, name, name);
  marks.delete(name);
}

/** True when the attributes dictionary `attributes` of a declaration has
 * `constant: True`, and the declaration has a value: the positional
 * `initializer`, or a `value` entry of `attributes`. The flag is read in
 * either encoding, a symbol or a string, as the `Declare` handler reads
 * it. */
function isConstantDeclarationWithValue(
  attributes: Expression | undefined,
  initializer: Expression | undefined
): boolean {
  if (attributes === undefined || !isDictionary(attributes)) return false;
  const flag = attributes.get('constant');
  if (flag === undefined) return false;
  if (
    (isString(flag) ? flag.string : isSymbol(flag) ? flag.symbol : '') !==
    'True'
  )
    return false;
  return initializer !== undefined || attributes.get('value') !== undefined;
}

/** The expression of a parameter default. A symbol default is the symbol
 * itself. A declaration accepts only a constant symbol default
 * (`isConstantSymbolDefault()`), so the symbol is a constant or a symbol
 * that the parameter type lists. */
export function boxParameterDefault(
  ce: ComputeEngine,
  d: ParameterDefault
): Expression {
  switch (d.kind) {
    case 'value':
      if (typeof d.value === 'number') return ce.number(d.value);
      if (typeof d.value === 'string') return ce.string(d.value);
      return d.value ? ce.True : ce.False;
    case 'symbol':
      return ce.symbol(d.name);
    case 'empty-list':
      return ce.function('List', []);
    case 'empty-dictionary':
      return ce.function('Dictionary', []);
  }
}

/**
 * The {@link ParameterDefault} that the canonical default operand `op` of a
 * function literal's parameter `["Optional", param, default]` stands for, or
 * `undefined` when `op` is not a default value that a signature can hold.
 *
 * - A number that a JavaScript `number` holds exactly (a finite number,
 *   `NaN`, `PositiveInfinity`, `NegativeInfinity`) is a value. A rational
 *   (`["Rational", 1, 2]`), a number that a double does not hold exactly
 *   (`1.1234567890123456789`, `1e400`), a complex number
 *   and `ComplexInfinity` are not.
 * - `True` and `False` are the booleans; a string is a value.
 * - `["List"]` and `["Dictionary"]` with no operands are the empty list and
 *   the empty dictionary. A collection with elements is not a default value.
 * - Any other symbol, except `Nothing` and `Missing`, is a symbol default.
 *   Whether it is allowed depends on the parameter type, which this
 *   function does not read: the declaration and the canonicalization of the
 *   literal check it (`isConstantSymbolDefault()`).
 * - Any other expression is not a default value.
 *
 * The printed signature of the literal then parses back to the same
 * parameter default: `typeToString` prints each of these kinds, and the type
 * parser reads it back.
 */
export function literalParameterDefault(
  op: Expression
): ParameterDefault | undefined {
  if (isNumber(op)) {
    if (op.operator === 'Rational' || op.im !== 0) return undefined;
    const value = op.re;
    // The number is held exactly when the machine number prints as the same
    // MathJSON: a decimal with more digits than a double holds, a bignum
    // integer outside the double range print differently.
    const same =
      JSON.stringify(op.engine.number(value).json) === JSON.stringify(op.json);
    return same ? { kind: 'value', value } : undefined;
  }
  // A one-character string boxes as a character, a sibling of a string.
  if (isString(op) || isCharacter(op))
    return { kind: 'value', value: op.string };
  if (isSymbol(op)) {
    const name = op.symbol;
    if (name === 'True') return { kind: 'value', value: true };
    if (name === 'False') return { kind: 'value', value: false };
    if (name === 'Nothing' || name === 'Missing') return undefined;
    return { kind: 'symbol', name };
  }
  if (isFunction(op, 'List') && op.nops === 0) return { kind: 'empty-list' };
  if (isDictionary(op) && op.keys.length === 0)
    return { kind: 'empty-dictionary' };
  return undefined;
}

/**
 * Check the default of the optional parameter `param` and throw when it is
 * not a constant or does not fit the parameter type.
 *
 * - A number, a string, a boolean, `[]` or `{}` must match the parameter
 *   type: `factor: number = "a"` is refused, `xs: list<number> = []` is
 *   accepted (the type of `[]` is `list<never>`).
 * - A symbol must be a constant (`isConstantSymbolDefault()`), else it is
 *   refused (`SYMBOL_DEFAULT_MESSAGE`). A constant must match the
 *   parameter type (`over: set = Integers`). A symbol that the parameter
 *   type lists matches it, and is not boxed here: boxing a symbol that is
 *   not declared declares it.
 */
function checkParameterDefault(
  ce: ComputeEngine,
  subject: string,
  param: NamedElement,
  index: number
): void {
  const d = param.default!;
  const paramName =
    param.name !== undefined ? `"${param.name}"` : `at position ${index + 1}`;
  const display = parameterDefaultToString(d);
  if (d.kind === 'symbol') {
    if (!isConstantSymbolDefault(ce, d.name, param.type))
      throw new Error(
        `${subject}: the default value ${display} of the parameter ${paramName}: ${SYMBOL_DEFAULT_MESSAGE}`
      );
    if (literalSymbolNames(param.type).includes(d.name)) return;
  }
  if (!boxParameterDefault(ce, d).type.matches(param.type))
    throw new Error(
      `${subject}: the default value ${display} of the parameter ${paramName} does not match its type "${typeToString(param.type)}"`
    );
}

/** The boxed default operands of each definition, by the defaults they were
 * boxed from (see {@link defaultsKey}). A definition whose signature changes
 * and comes back (a checkpoint restore, a signature derived again from a
 * skeleton) finds its operands again without boxing them a second time. */
const BOXED_DEFAULTS = new WeakMap<
  object,
  Map<string, ReadonlyArray<Expression | undefined>>
>();

/** A key for the defaults of the optional parameters of `sig`, in order. Two
 * signatures with the same defaults get the same boxed operands. The key is
 * lossless: `JSON.stringify` would write `NaN`, `Infinity` and `-Infinity`
 * all as `null`, and `-0` as `0`. */
function defaultsKey(sig: FunctionSignature): string {
  return (sig.optArgs ?? [])
    .map(({ default: d }) => {
      if (d === undefined) return '-';
      switch (d.kind) {
        case 'value':
          if (typeof d.value === 'number')
            return `n${Object.is(d.value, -0) ? '-0' : String(d.value)}`;
          if (typeof d.value === 'string') return `s${JSON.stringify(d.value)}`;
          return d.value ? 'true' : 'false';
        case 'symbol':
          return `y${JSON.stringify(d.name)}`;
        case 'empty-list':
          return '[]';
        case 'empty-dictionary':
          return '{}';
      }
    })
    .join(',');
}

function boxDefaults(
  ce: ComputeEngine,
  sig: FunctionSignature
): ReadonlyArray<Expression | undefined> {
  return Object.freeze(
    (sig.optArgs ?? []).map((a) =>
      a.default === undefined ? undefined : boxParameterDefault(ce, a.default)
    )
  );
}

function remember(
  def: object,
  sig: FunctionSignature,
  operands: ReadonlyArray<Expression | undefined>
): void {
  let entries = BOXED_DEFAULTS.get(def);
  if (entries === undefined) {
    entries = new Map();
    BOXED_DEFAULTS.set(def, entries);
  }
  entries.set(defaultsKey(sig), operands);
}

/**
 * The checks of {@link installParameterDefaults}: the position of each
 * default in `t`, and each default against its parameter type. Throws when
 * one fails. Returns the top-level signature of `t` when it has a default,
 * `undefined` otherwise.
 *
 * A setter that removes state before it installs a type (the assumptions
 * that the `type` setter of a symbol forgets) runs these checks first, so
 * that a refused type leaves that state as it was.
 */
export function checkParameterDefaultsUnboxed(
  ce: ComputeEngine,
  subject: string,
  t: Type
): FunctionSignature | undefined {
  const sig = topLevelSignatureWithDefaults(subject, t);
  if (sig === undefined) return undefined;
  const index = (i: number) => (sig.args?.length ?? 0) + i;
  sig.optArgs!.forEach((param, i) => {
    if (param.default !== undefined)
      checkParameterDefault(ce, subject, param, index(i));
  });
  return sig;
}

/**
 * Check the parameter defaults of the type `t` that the definition `def`
 * declares, box each default once, and keep the boxed operands on `def` for
 * {@link parameterDefaultOperands}. Throws when a default is in a position
 * where it is not allowed (see {@link topLevelSignatureWithDefaults}), is
 * not a constant, or does not fit its parameter type. Does nothing when `t`
 * has no default.
 *
 * The defaults are checked and boxed in the scope that receives the
 * declaration of `def` when {@link inDeclaringScope} gives one for its
 * name, else in the current scope.
 *
 * `subject` starts the error messages (`Operator Definition "F"`,
 * `Symbol "g"`).
 */
export function installParameterDefaults(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition | BoxedValueDefinition,
  subject: string,
  t: Type
): void {
  const install = () => {
    const sig = checkParameterDefaultsUnboxed(ce, subject, t);
    if (sig === undefined) return;
    remember(def, sig, boxDefaults(ce, sig));
  };
  const declaring = DECLARING_SCOPE.get(ce);
  const name = (def as { name?: unknown }).name;
  if (
    declaring === undefined ||
    declaring.name !== name ||
    declaring.scope === ce.context.lexicalScope
  )
    return install();
  ce._inScope(declaring.scope, install);
}

/** For each engine, the declaration in progress that `ce.declare()` runs in
 * a given scope: the name it declares and that scope. Set by
 * {@link inDeclaringScope}. It is keyed on the engine, so that two engines
 * do not share it, and it applies only to a definition of that name, so
 * that another definition installed during the same declaration (the repair
 * of a definition that waited on this name) is not checked in that scope. */
const DECLARING_SCOPE = new WeakMap<object, { name: string; scope: Scope }>();

/**
 * Run `f`, the declaration of `name` in the scope `scope`, so that the
 * parameter defaults of the definition of `name` that it installs are
 * checked and boxed in `scope`, not in the current scope. A symbol default
 * is a constant of the scope of the declaration: with a constant `W = 5` in
 * an outer scope and a constant `W = 7` in the current inner scope, a
 * declaration of `f: (k: real = W) -> real` in the outer scope gives `k`
 * the outer `W`, 5.
 */
export function inDeclaringScope<T>(
  ce: ComputeEngine,
  name: string,
  scope: Scope,
  f: () => T
): T {
  const previous = DECLARING_SCOPE.get(ce);
  DECLARING_SCOPE.set(ce, { name, scope });
  try {
    return f();
  } finally {
    if (previous === undefined) DECLARING_SCOPE.delete(ce);
    else DECLARING_SCOPE.set(ce, previous);
  }
}

/**
 * The boxed default operand of each optional parameter of the signature of
 * `def`, aligned with the `optArgs` of the signature: entry `i` is the
 * operand that a call which leaves out optional parameter `i` receives, or
 * `undefined` when that parameter has no default.
 *
 * Returns `undefined` when the signature has no default at all, and when the
 * definition has no single signature (an overloaded signature, a type that is
 * not a function signature).
 *
 * The signature read is the operator's `signature`, or the declared type of a
 * value definition. The operands were boxed when the definition was declared
 * (`installParameterDefaults`). A signature that got its defaults by another
 * route (a type derived again from a skeleton, a function literal's inferred
 * signature) has its defaults boxed on the first read, in the current scope,
 * and kept.
 */
export function parameterDefaultOperands(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition | BoxedValueDefinition
): ReadonlyArray<Expression | undefined> | undefined {
  const t = 'signature' in def ? def.signature.type : def.declaredType.type;
  return signatureDefaultOperands(ce, def, t);
}

/**
 * The boxed default operands of the signature `t` that the definition `def`
 * holds, aligned with the `optArgs` of `t`, as {@link parameterDefaultOperands}
 * returns them. For a caller that has already read the signature of `def`.
 * `undefined` when `t` is not a single signature or has no default.
 */
export function signatureDefaultOperands(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition | BoxedValueDefinition,
  t: Type
): ReadonlyArray<Expression | undefined> | undefined {
  if (typeof t !== 'object' || t.kind !== 'signature') return undefined;
  if (!t.optArgs?.some((a) => a.default !== undefined)) return undefined;
  // The defaults boxed for an explicit declaration of the signature
  // (`installParameterDefaults`) come first: the literal assigned later can
  // name the same symbols, but bound in another scope. The operands of the
  // literal are read only for a signature that has no such defaults, the
  // signature derived from that literal.
  const key = defaultsKey(t);
  const known = BOXED_DEFAULTS.get(def)?.get(key);
  if (known !== undefined) return known;
  const ofLiteral = literalDefaultOperands(def, t);
  if (ofLiteral !== undefined) return ofLiteral;
  const operands = boxDefaults(ce, t);
  remember(def, t, operands);
  return operands;
}

/**
 * The default operands of the canonical function literal that `def` was
 * built from (an operator definition made by assigning a literal) or holds
 * (a value definition), aligned with the `optArgs` of the signature `t`.
 * `undefined` when `def` has no canonical function literal, or when the
 * defaults of the literal are not those of `t`.
 *
 * The literal canonicalized each default operand in the scope where it was
 * written, so a symbol default is bound to the constant that this scope
 * gives it. Boxing the same name again where the call is made would read a
 * local of the same name in the scope of the call instead
 * (`Block(Declare(W0, integer, 7), f())` with `f := (k = W0) ↦ k + 1`, where
 * `W0` is a constant). The parameters with a default come after the
 * required parameters, in the order of `optArgs`.
 */
function literalDefaultOperands(
  def: BoxedOperatorDefinition | BoxedValueDefinition,
  t: FunctionSignature
): ReadonlyArray<Expression | undefined> | undefined {
  const lit = 'signature' in def ? def._lambdaLiteral : def.value;
  if (lit === undefined || !lit.isCanonical || !isFunction(lit, 'Function'))
    return undefined;
  const operands = lit.ops
    .slice(1)
    .filter((p) => isFunction(p, 'Optional'))
    .map((p) => (isFunction(p, 'Optional') ? p.op2 : undefined));
  const optArgs = t.optArgs ?? [];
  if (operands.length !== optArgs.length) return undefined;
  const derived: FunctionSignature = {
    ...t,
    optArgs: optArgs.map((a, i) => {
      const d = literalParameterDefault(operands[i]!);
      return d === undefined
        ? { ...a, default: undefined }
        : { ...a, default: d };
    }),
  };
  return defaultsKey(derived) === defaultsKey(t) ? operands : undefined;
}

/**
 * The operands of a call after the default values of the parameters that
 * the call leaves out are inserted.
 *
 * `signature` is the single signature of the callee, and `defaults` its boxed
 * default operands, aligned with its `optArgs` (see
 * {@link parameterDefaultOperands}). `supplied` is the number of positions
 * that `ops` supplies: `ops.length` for a flat operand list. A list whose
 * operands are not flattened yet counts each element of a top-level
 * `Sequence` operand as a position, and the caller passes that count.
 *
 * - When every required parameter has an operand, each optional parameter
 *   after the last supplied position that has a default receives it. The
 *   defaults are appended after `ops`, in parameter order. Defaulted
 *   parameters come before the optional parameters without a default, so the
 *   fill stops at the first optional parameter without one.
 * - When a required parameter has no operand (`Scaled()` with
 *   `(x: number, factor: number = 2)`), nothing is inserted: the call reports
 *   `missing` for the required parameter as it does without defaults, and a
 *   default is never moved into a required position.
 * - An operand that the call supplies is never changed, also when it is
 *   absent (`Missing`, `NaN`): the parameter receives that value. A default
 *   fills only a position that the call leaves out.
 *
 * Returns `ops` itself when nothing is inserted.
 */
export function fillParameterDefaults(
  ops: ReadonlyArray<Expression>,
  signature: Type,
  defaults: ReadonlyArray<Expression | undefined>,
  supplied: number = ops.length
): ReadonlyArray<Expression> {
  if (typeof signature !== 'object' || signature.kind !== 'signature')
    return ops;
  const required = signature.args?.length ?? 0;
  if (supplied < required) return ops;
  const added: Expression[] = [];
  for (let i = supplied - required; i < defaults.length; i++) {
    const d = defaults[i];
    if (d === undefined) break;
    added.push(d);
  }
  return added.length === 0 ? ops : [...ops, ...added];
}
