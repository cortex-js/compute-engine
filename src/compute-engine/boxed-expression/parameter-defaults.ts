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
  isMissingValue,
  isNumber,
  isString,
  isSymbol,
} from './type-guards.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import {
  parameterDefaultToString,
  typeToString,
} from '../../common/type/serialize.js';

/** Whether the call-site argument check admits `operand` at a parameter of
 * type `param`. Set by `init-lazy-refs.ts` at engine load to the check-only
 * mode of `validateArguments()`: importing `validate.ts` here would make a
 * circular dependency through the definition classes. The type is written
 * inline so that no type-only import makes the cycle either. */
type OperandAdmission = (
  ce: ComputeEngine,
  operand: Expression,
  param: Type
) => boolean;

let _admitsOperand: OperandAdmission | undefined;
export function _setOperandAdmission(fn: OperandAdmission): void {
  _admitsOperand = fn;
}

/** The message of a declaration that uses a default in a nested position. */
export const NESTED_DEFAULT_MESSAGE =
  'a default value is allowed only in a top-level function signature';

/** The message of a declaration whose overloaded signature has a default. */
export const OVERLOADED_DEFAULT_MESSAGE =
  'a default value in an overloaded signature is not supported yet';

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

/** The expression of a parameter default, boxed in the current scope. A
 * symbol default is the symbol itself: boxing it auto-declares a symbol that
 * is not declared, as writing it in an expression does. */
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
 *   (`1.1234567890123456789`, `1e400`), a complex number,
 *   `ComplexInfinity` and `Indeterminate` are not.
 * - `True` and `False` are the booleans; a string is a value.
 * - `["List"]` and `["Dictionary"]` with no operands are the empty list and
 *   the empty dictionary. A collection with elements is not a default value.
 * - Any other symbol is a symbol default, except `Nothing` and `Missing`.
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
    // integer outside the double range and `Indeterminate` (a NaN that is
    // printed by its own name) print differently.
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

/** The names a parameter type lists when it is a literal symbol type
 * (`symbol<Auto>`) or a union of them (`symbol<Auto> | symbol<Manual>`), and
 * `undefined` for any other type. */
function literalSymbolNames(t: Type): string[] | undefined {
  const r = resolveTypeAlias(t);
  if (typeof r !== 'object') return undefined;
  if (r.kind === 'symbol') return [r.name];
  if (r.kind !== 'union') return undefined;
  const names: string[] = [];
  for (const arm of r.types) {
    const a = resolveTypeAlias(arm);
    if (typeof a !== 'object' || a.kind !== 'symbol') return undefined;
    names.push(a.name);
  }
  return names;
}

/**
 * Check the default `boxed` of the optional parameter `param` and throw when
 * it does not fit the parameter type.
 *
 * - A number, a string, a boolean, `[]` or `{}` must match the parameter
 *   type: `factor: number = "a"` is refused, `xs: list<number> = []` is
 *   accepted (the type of `[]` is `list<never>`).
 * - A symbol is checked as the same symbol written as an operand at that
 *   parameter is checked when a call is boxed (`validateArguments`, in
 *   check-only mode so that the type of an undeclared symbol is not
 *   narrowed here). A declared symbol whose type does not fit is refused
 *   (`k: number = Integers`); an undeclared symbol has the type `unknown`
 *   and is accepted at every parameter type. In addition, when the
 *   parameter type lists symbols (`symbol<Auto> | symbol<Manual>`), the
 *   default must be one of them: a call site cannot make this check,
 *   because a written undeclared symbol is accepted there.
 * - With `ce.strict` set to `false`, `validateArguments` checks nothing, so
 *   a declared symbol whose type does not fit is accepted too
 *   (`k: number = Integers`). This is the same as a call in non-strict mode,
 *   which accepts `Integers` written as the operand at that parameter.
 *
 * The check is in two steps, so that a refused declaration boxes no symbol
 * (boxing an undeclared symbol auto-declares it):
 * - With `boxed` left out, the checks that need no boxed symbol: a value
 *   default, and the name of a symbol default against the symbols its
 *   parameter type lists.
 * - With `boxed`, the check of a symbol default as an operand.
 */
function checkParameterDefault(
  ce: ComputeEngine,
  subject: string,
  param: NamedElement,
  index: number,
  boxed?: Expression
): void {
  const d = param.default!;
  const paramName =
    param.name !== undefined ? `"${param.name}"` : `at position ${index + 1}`;
  const display = parameterDefaultToString(d);
  const refuse = (): never => {
    throw new Error(
      `${subject}: the default value ${display} of the parameter ${paramName} does not match its type "${typeToString(param.type)}"`
    );
  };
  if (d.kind !== 'symbol') {
    // A value default boxes no symbol: box it here.
    if (!boxParameterDefault(ce, d).type.matches(param.type)) refuse();
    return;
  }
  if (boxed === undefined) {
    const names = literalSymbolNames(param.type);
    if (names !== undefined && !names.includes(d.name))
      throw new Error(
        `${subject}: the default value ${display} of the parameter ${paramName} is not one of the symbols its type lists (${names.join(', ')})`
      );
    return;
  }
  if (_admitsOperand !== undefined && !_admitsOperand(ce, boxed, param.type))
    refuse();
}

/**
 * True when the canonical default operand `boxed` of a function literal's
 * parameter, which stands for the default `d` (see
 * {@link literalParameterDefault}), fits the parameter type `type`. The rules
 * are the rules of a default in a declared signature (see
 * {@link checkParameterDefault}): a value default must match the type; a
 * symbol default is checked as the same symbol written as an operand at that
 * parameter, and must be one of the symbols that a literal symbol type lists.
 */
export function literalParameterDefaultFits(
  ce: ComputeEngine,
  d: ParameterDefault,
  boxed: Expression,
  type: Type
): boolean {
  if (d.kind !== 'symbol') return boxed.type.matches(type);
  const names = literalSymbolNames(type);
  if (names !== undefined && !names.includes(d.name)) return false;
  return _admitsOperand === undefined || _admitsOperand(ce, boxed, type);
}

/** For each engine, the declaration in progress that `ce.declare` runs in a
 * given scope: the name it declares and that scope. Set by
 * {@link inDeclaringScope}. It is keyed on the engine, so that two engines do
 * not share it, and it applies only to a definition of that name, so that
 * another definition installed during the same declaration (a cycle
 * refinement, the repair of a definition that waited on this name) is not
 * boxed in that scope. */
const DECLARING_SCOPE = new WeakMap<object, { name: string; scope: Scope }>();

/**
 * Run `f`, the declaration of `name` in the scope `scope`, so that the
 * parameter defaults of the definition of `name` that it installs are boxed
 * in `scope` and not in the current scope. A symbol default that is not
 * declared is then auto-declared in `scope`, the scope of the definition
 * that uses it. Use it when the definition `f` installs is not yet held by a
 * binding of a scope (a definition built by `updateDef()`, which puts it in
 * the binding record only after its constructor ran).
 */
export function inDeclaringScope<T>(
  ce: ComputeEngine,
  name: string,
  scope: Scope | undefined,
  f: () => T
): T {
  // An `undefined` scope means "the current scope": an entry of an outer
  // declaration of the same name must not apply inside `f`, so the entry is
  // removed for the duration of `f` and restored after it.
  const previous = DECLARING_SCOPE.get(ce);
  if (scope === undefined) {
    if (previous?.name !== name) return f();
    DECLARING_SCOPE.delete(ce);
  } else DECLARING_SCOPE.set(ce, { name, scope });
  try {
    return f();
  } finally {
    if (previous === undefined) DECLARING_SCOPE.delete(ce);
    else DECLARING_SCOPE.set(ce, previous);
  }
}

/**
 * The scope that holds the binding of `name` to `def`: the first scope, from
 * the current lexical scope outward, whose binding record of `name` is `def`
 * or has `def` as its value or operator definition. `undefined` when no scope
 * of the current chain holds it.
 *
 * Limit: the search follows only the current chain of lexical scopes. A
 * definition bound in a scope outside that chain (a symbol boxed inside a
 * scope that was popped since, or bound in the scope of a captured function)
 * is not found, and the caller then boxes its defaults in the current scope,
 * so an undeclared symbol default is auto-declared there. Scopes keep no
 * link from a definition to the scope that binds it, so the search cannot
 * do better without one.
 */
export function scopeHoldingDefinition(
  ce: ComputeEngine,
  name: string,
  def: object
): Scope | undefined {
  for (
    let scope: Scope | null = ce.context.lexicalScope;
    scope;
    scope = scope.parent
  ) {
    const record = scope.bindings.get(name);
    if (record === undefined) continue;
    if (
      record === def ||
      ('value' in record && record.value === def) ||
      ('operator' in record && record.operator === def)
    )
      return scope;
  }
  return undefined;
}

/** Run `f` in the scope of the declaration of `def`, the definition of
 * `name`: the scope that holds its binding (see
 * {@link scopeHoldingDefinition}), else the scope given to
 * {@link inDeclaringScope} for `name`, else the current scope. */
function inScopeOfDeclaration<T>(
  ce: ComputeEngine,
  name: string,
  def: object,
  f: () => T
): T {
  let scope = scopeHoldingDefinition(ce, name, def);
  if (scope === undefined) {
    const declaring = DECLARING_SCOPE.get(ce);
    if (declaring?.name === name) scope = declaring.scope;
  }
  if (scope === undefined || scope === ce.context.lexicalScope) return f();
  return ce._inScope(scope, f);
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
 * The checks of {@link installParameterDefaults} that box no symbol: the
 * position of each default in `t`, each value default against its parameter
 * type, and the name of each symbol default against the symbols its
 * parameter type lists. Throws when one fails. Returns the top-level
 * signature of `t` when it has a default, `undefined` otherwise.
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
 * declares, box each default once, in the declaring scope (see
 * {@link inScopeOfDeclaration}), and keep the boxed
 * operands on `def` for {@link parameterDefaultOperands}. Throws when a
 * default is in a position where it is not allowed (see
 * {@link topLevelSignatureWithDefaults}) or does not fit its parameter type.
 * Does nothing when `t` has no default.
 *
 * A refused declaration auto-declares no symbol: the checks that need no
 * boxed symbol run first, then a symbol default that has a definition is
 * boxed and checked, and an undeclared symbol default is boxed (and
 * auto-declared) only when every check passed.
 *
 * `name` is the name that `def` defines. `subject` starts the error messages
 * (`Operator Definition "F"`, `Symbol "g"`).
 */
export function installParameterDefaults(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition | BoxedValueDefinition,
  name: string,
  subject: string,
  t: Type
): void {
  const sig = checkParameterDefaultsUnboxed(ce, subject, t);
  if (sig === undefined) return;
  const index = (i: number) => (sig.args?.length ?? 0) + i;
  inScopeOfDeclaration(ce, name, def, () => {
    // A symbol that has a definition is not auto-declared by boxing it.
    sig.optArgs!.forEach((param, i) => {
      const d = param.default;
      if (d?.kind === 'symbol' && ce.lookupDefinition(d.name) !== undefined)
        checkParameterDefault(
          ce,
          subject,
          param,
          index(i),
          boxParameterDefault(ce, d)
        );
    });
    remember(def, sig, boxDefaults(ce, sig));
  });
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
  const key = defaultsKey(t);
  const known = BOXED_DEFAULTS.get(def)?.get(key);
  if (known !== undefined) return known;
  const operands = boxDefaults(ce, t);
  remember(def, t, operands);
  return operands;
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
 * - An operand that is absent (`Missing`, `NaN`,
 *   `Indeterminate`, a `NaN` point: the absence test of `Coalesce`,
 *   `isMissingValue()`) at
 *   a parameter with a default is replaced by the default too
 *   (`withAbsentDefaults()`). An operand that is present is never changed.
 *
 * Returns `ops` itself when nothing is inserted or replaced.
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
  ops = withAbsentDefaults(ops, required, defaults, callSiteDefault);
  const added: Expression[] = [];
  for (let i = supplied - required; i < defaults.length; i++) {
    const d = defaults[i];
    if (d === undefined) break;
    added.push(callSiteDefault(d));
  }
  return added.length === 0 ? ops : [...ops, ...added];
}

/**
 * The operands `ops` of a call, with each operand that is absent at a
 * parameter with a default replaced by `read(d)`, where `d` is the default
 * operand of that parameter. Returns `ops` itself when nothing is replaced.
 *
 * A default fills an absent argument as it fills an argument that the call
 * leaves out: `(k: real | missing = 2) ↦ k` gives 2 for `f()`, `f(Missing)`
 * and `f(At(L, 100))` with `L` a list of two elements. The default is then a
 * discharge of absence, as `Coalesce` is, and it uses the same absence test
 * (`isMissingValue()`): `Missing`, `NaN`, `Indeterminate` and a `NaN`
 * point are absent. `Nothing` is not: a written `Nothing` operand is removed before the
 * fill, so the parameter is left out and takes its default that way. A
 * caller that needs to pass an absent value through a parameter declares no
 * default for it. (R6 of `docs/plans/2026-11-01-absent-value-contract.md`.)
 *
 * The operand at position `i` is the argument of the parameter at position
 * `i`: `ops` is flat. A top-level `Sequence` operand (a list of operands
 * that is not flattened yet) stands for several positions; its elements are
 * not replaced, and the positions after it are counted past it. `required`
 * is the number of parameters without a default before the first one with
 * a default, and `defaults` is aligned with the parameters after them.
 *
 * At canonicalization `read` is `callSiteDefault`, and only an operand that
 * is written absent is replaced (`f(Missing)`). At evaluation `read` also
 * evaluates the default, and the operands are the evaluated arguments, so an
 * argument that evaluates to an absent value is replaced (`f(At(L, 100))`).
 * `read` receives the index of the operand in `ops` too, so that it can
 * evaluate the default as it evaluates an operand at that position.
 */
export function withAbsentDefaults(
  ops: ReadonlyArray<Expression>,
  required: number,
  defaults: ReadonlyArray<Expression | undefined>,
  read: (d: Expression, index: number) => Expression
): ReadonlyArray<Expression> {
  let result: Expression[] | undefined;
  let position = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (isFunction(op, 'Sequence')) {
      position += op.nops;
      continue;
    }
    const d = defaults[position - required];
    position += 1;
    if (d === undefined || !isMissingValue(op)) continue;
    result ??= [...ops];
    result[i] = read(d, i);
  }
  return result ?? ops;
}

/**
 * The operand that a call receives for the boxed default `d` of a parameter
 * that it leaves out.
 *
 * A value default (a number, a string, `True`, `False`, `[]`, `{}`) is `d`
 * itself. A symbol default is the symbol boxed again in the current scope,
 * which is the scope of the call: the default behaves exactly as the symbol
 * written in the call, and reads the binding that a written symbol reads. The
 * operand boxed at declaration is bound in the declaring scope, so a
 * declaration of the same name in a scope that encloses the call would not
 * be read through it. That operand is still used to check the default and to
 * auto-declare an undeclared symbol in the declaring scope. A call whose
 * callee can change records the lexical scope of the call. When the callee
 * changes, the call is boxed again in that scope
 * (`BoxedFunction._stampCallee()`), so a symbol default, of the old or of the
 * new definition, reads the binding of the scope of the call.
 */
export function callSiteDefault(d: Expression): Expression {
  if (!isSymbol(d) || d.symbol === 'True' || d.symbol === 'False') return d;
  return d.engine.symbol(d.symbol);
}
