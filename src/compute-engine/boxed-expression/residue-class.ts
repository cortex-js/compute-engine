/**
 * Residue classes: the elements of ℤ/nℤ, `ResidueClass(k, n)`.
 *
 * A class is held as a pair of integers `k` in [0, n) and `n ≥ 1`, in
 * `bigint`, so a modulus past 2^53 stays exact. Every function here works on
 * that pair; the arithmetic handlers of `Add`, `Multiply`, `Divide`, `Power`
 * and `Negate` call the `residue*` functions on their evaluated operands.
 *
 * Arithmetic is defined inside one ring only. Classes of different moduli do
 * not combine: `ResidueClass(2, 4) + ResidueClass(1, 6)` stays unevaluated,
 * with no error. An exact integer, or an exact rational whose denominator is
 * a unit, is read in the ring of the classes beside it:
 * `ResidueClass(5, 7) + 3` is `ResidueClass(1, 7)`. A float is never read as
 * an integer here: `7.0` is an approximation, so `ResidueClass(7.0, 5)` and
 * `ResidueClass(2, 5) + 3.0` stay unevaluated.
 */

import type {
  ArithmeticDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  KindFold,
  OperandDescriptor,
  PureEngineView,
} from '../global-types.js';
import { asBigint, asRational } from './numerics.js';
import {
  isExpression,
  isFunction,
  isNumber,
  isSymbol,
  sym,
} from './type-guards.js';
import { modularInverse } from '../numerics/numeric-bigint.js';
import { modPow } from '../numerics/primes.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  functionResult,
  hasKindArm,
  isKindArm,
  kindArmNames,
  resolveTypeAlias,
  signatureArms,
  stripMissingFromType,
  isUninhabitedWithoutKinds,
  type KindTypeNames,
} from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';
import { reduceType } from '../../common/type/reduce.js';
import { setSymbolValueHook } from './residue-class-value-hook.js';
import {
  arithmeticOf,
  engineHasKindDeclarations,
  engineHasKindValues,
  engineHasKindValuesAssigned,
  kindGeneration,
  kindTypeInfo,
  kindTypeNames,
  kindTypesOfHeadName,
  noteKindDeclaration,
  noteKindValueAssigned,
  kindTypesWithValues,
} from './value-kinds.js';

/** A class `k + nℤ`, with `0 ≤ k < n`. */
export interface Residue {
  readonly k: bigint;
  readonly n: bigint;
}

const mod = (a: bigint, n: bigint): bigint => ((a % n) + n) % n;

/**
 * The integer value of an EXACT integer literal, or `null`. A float with an
 * integer value (`7.0`, `1e30`) is `null`: its value is an approximation,
 * and its residue would be a guess.
 */
function exactInteger(expr: Expression): bigint | null {
  if (!isNumber(expr) || !expr.isExact) return null;
  return asBigint(expr);
}

/** The class of the rational `num/den` in ℤ/nℤ, if `den` is a unit mod `n`. */
export function residueOfRational(
  num: bigint,
  den: bigint,
  n: bigint
): Residue | undefined {
  if (n < 1n) return undefined;
  if (den === 1n) return { k: mod(num, n), n };
  const inverse = modularInverse(den, n);
  return inverse === null ? undefined : { k: mod(num * inverse, n), n };
}

/**
 * The class of an exact integer or rational literal in ℤ/nℤ. `undefined` for
 * anything else: a float, a symbol, or a rational with a denominator that is
 * not a unit (`1/2` mod 4).
 */
export function residueOfLiteral(
  expr: Expression,
  n: bigint
): Residue | undefined {
  if (!isNumber(expr) || !expr.isExact) return undefined;
  const integer = asBigint(expr);
  if (integer !== null) return { k: mod(integer, n), n };
  const q = asRational(expr);
  if (q === undefined) return undefined;
  return residueOfRational(BigInt(q[0]), BigInt(q[1]), n);
}

/** `ResidueClass(k, n)` with exact integer operands, read as a pair. */
export function residueOf(expr: Expression | undefined): Residue | undefined {
  if (!isFunction(expr, 'ResidueClass') || expr.nops !== 2) return undefined;
  const k = exactInteger(expr.op1);
  const n = exactInteger(expr.op2);
  if (k === null || n === null || n < 1n || k < 0n || k >= n) return undefined;
  return { k, n };
}

export function isResidueClass(expr: Expression | undefined): boolean {
  return residueOf(expr) !== undefined;
}

//
// Recognition of a VALUE KIND (`docs/plans/2026-10-26-value-kinds.md`,
// section 4.6).
//
// A value kind is a set of values with their own arithmetic (a residue
// class, an element of a finite field, …), declared by the `arithmetic` field
// of the operator definition of the head that constructs its values. The
// result type of that head is the KIND TYPE (`residue`, or a nominal type
// defined as exactly `value`). The kind registry of the engine
// (`value-kinds.ts`) holds the kind types and the heads. The functions below
// read the registry: they recognize every kind, not only residue classes.
//

/**
 * An operand that holds a kind value, as a type handler sees it: a call of a
 * head that declares a kind, an arithmetic application with one among its
 * operands at any depth (`(x·c)^2`, `2^c`), a symbol whose value holds one,
 * or an operand whose type has a kind-type arm. Such an operand does not
 * have a number type. `engine` is the engine of the type handler: in an
 * engine that has never made a kind value (see `holdsKindValue()`), the
 * answer is `false` without a walk.
 */
export function isKindOperand(
  d: OperandDescriptor,
  engine: PureEngineView
): boolean {
  // The type is read before the engine gate: a descriptor typed `residue`
  // comes from a declaration or a signature, which an engine that has never
  // made a kind value can have (`deriveApplicationType()` types a call from
  // operand types alone).
  if (hasKindArm(d.type, kindTypeNames(engine))) return true;
  if (!engineHasKindValues(engine)) return false;
  return describesKind(d, engine);
}

function describesKind(d: OperandDescriptor, engine: PureEngineView): boolean {
  // An operand that holds a kind value is never typed as a number (the type
  // handlers of the arithmetic operators answer the kind type for it), so a
  // number type ends the walk at once: this is the usual operand.
  if (isSubtype(d.type, 'number')) return false;
  // The type says it: a call of a kind head, a call of a head declared to
  // return a kind type, a symbol declared with a kind type, an arithmetic
  // expression over one of them. The descriptor's type is computed for the
  // type handler in any case, so this reads nothing more. An operand typed
  // `value`, `unknown` or `any` can hold a kind value without saying so: the
  // walk below reads its structure and the value of a symbol.
  if (hasKindArm(d.type, kindTypeNames(engine))) return true;
  const s = d.structureOf?.();
  if (s?.kind === 'symbol') {
    if (!engineHasKindValuesAssigned(engine)) return false;
    const value = engine.lookupDefinition(s.name)?.value?.value;
    return value !== undefined && holdsKindValue(value);
  }
  if (s?.kind !== 'application') return false;
  // The structure gives the name of the head only, not its definition.
  if (kindTypesOfHeadName(engine, s.head) !== undefined) return true;
  return (
    RESIDUE_ARITHMETIC.includes(s.head) &&
    s.children.some((x) => describesKind(x, engine))
  );
}

/**
 * The arithmetic operators (group 1 of `docs/plans/2026-10-26-value-kinds.md`,
 * section 4.2). The simplification barrier (`simplify.ts`) stops at an
 * expression with one of them as its operator when it holds a kind value,
 * and the type handlers look for a kind value through them
 * (`isKindOperand()`).
 */
export const RESIDUE_ARITHMETIC: ReadonlyArray<string> = [
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Root',
];

//
// The per-engine gates. The registry of an engine (`value-kinds.ts`) has
// three gates for each kind type, which only open:
//
// - a VALUE gate (`engineHasKindValues()`): a value of the kind was
//   constructed (the `BoxedFunction` constructor), assigned, or declared.
//   In an engine where no value gate is open, no expression can hold a kind
//   value, and `holdsKindValue()` answers without a walk of the expression:
//   the arithmetic of an engine that does not use a kind does not pay for
//   it.
// - an ASSIGNED gate (`engineHasKindValuesAssigned()`): a symbol was given a
//   value that holds a kind value. Only then are the values of symbols read.
// - a DECLARATION gate (`engineHasKindDeclarations()`): a symbol or a user
//   callable was declared with a type that has a kind arm. Only then are the
//   types of the symbols of an expression read (about a third of the cost of
//   the walk in an engine that uses classes, measured 2026-10-23).
//
// The walk reads whether ANY gate of the engine is open: the recognition of
// one expression does not know in advance which kind it will find.
//

/**
 * Record that a symbol of `ce` now has the value `value`. The value
 * definition calls it through `noteSymbolValue()`
 * (`residue-class-value-hook.ts`).
 */
export function noteAssignedKindValue(ce: object, value: unknown): void {
  if (!isExpression(value)) return;
  // A value whose type says it is a kind value (a call of a head declared to
  // return a kind type that the engine has not made itself, a value from
  // another engine) brings the engine in: the gates record where kind values
  // can be, and a stored value is one more place.
  const named = declaredKindTypes(ce, value.type.type);
  if (named.length > 0) {
    for (const t of named) noteKindValueAssigned(ce, t);
    return;
  }
  if (!engineHasKindValues(ce)) return;
  if (!holdsKindValue(value)) return;
  // The walk does not say which kind it found. A value it finds was made in
  // this engine, so its kind type has an open value gate: opening the
  // assigned gate of each of those types is a superset, which is safe (an
  // open gate costs a walk, never a wrong answer).
  for (const t of kindTypesWithValues(ce)) noteKindValueAssigned(ce, t);
}

/**
 * Record that a symbol or an operator of `ce` has been declared with a type
 * that has a kind arm somewhere: a symbol `r: residue`, a signature
 * `(any, any) -> residue`, a function type `(integer) -> gf8`. From then on
 * an expression of the engine can hold a value of that kind, so the engine
 * opens the gates of the kind type, before any value is made. The
 * declarations of the host and of Epsil call it (`engine-declarations.ts`,
 * `boxed-symbol.ts`); the library's own signatures do not.
 */
export function noteKindTypeDeclaration(ce: object, type: Type): void {
  for (const t of declaredKindTypes(ce, type)) noteKindDeclaration(ce, t);
}

/**
 * The kind types that `type` names as an arm, or as an arm of the result of
 * one of its signature arms (a function type).
 */
function declaredKindTypes(ce: object, type: Type): string[] {
  const kinds = kindTypeNames(ce);
  const found = new Set(kindArmNames(type, kinds));
  if (typeof type !== 'string') {
    const arms = signatureArms(resolveTypeAlias(type));
    if (arms !== undefined)
      for (const arm of arms) {
        const r = functionResult(arm);
        if (r !== undefined)
          for (const t of kindArmNames(r, kinds)) found.add(t);
      }
  }
  return [...found];
}

/**
 * The CELL result type of an arithmetic operator (`Add`, `Multiply`,
 * `Divide`, `Negate`, `Power`, `Sqrt`, `Root`) when one of its operands holds
 * a kind value (`isKindOperand()`): the type of a kind value, and of an
 * expression over kind values that stays unevaluated (two moduli, a float
 * beside a class). An operand that is provably `NaN` makes the result `NaN`
 * (`NaN + c` is `NaN`, as for a number), so its type keeps the `nan` arm.
 * The shape of a collection result (`c · (1, 2)` is a tuple of classes) is
 * derived by the caller (`residueShapedResultType()`, `library/
 * arithmetic.ts`), which puts this cell type in the cells.
 *
 * The cell type is the union, over the kind types among the operand types,
 * of the answer of the `resultType` hook of the kind type
 * (`docs/plans/2026-10-26-value-kinds.md`, section 4.5, rule 2) when it gives
 * one, else the kind type itself: `x + GF8(1)` with `x: gf8` is `gf8`, and
 * `A(1) / B(1)` is `number | a | b` when only the kind type `a` answers
 * `number | a` for `Divide`. `operator` is the operator the hooks are asked
 * for (`'Add'` for a difference, `'Power'` for `Sqrt`, `Root` and `Square`),
 * and the hook receives the operand types with their shapes removed
 * (`list<gf8^2>` is `gf8`). With no engine, or no kind arm found, the answer
 * is `residue`.
 */
export function residueResultType(
  ops: ReadonlyArray<OperandDescriptor>,
  engine?: object,
  operator?: string,
  operandTypes?: ReadonlyArray<Type>
): Type {
  const nan = ops.some((d) => d.type !== 'never' && isSubtype(d.type, 'nan'));
  const kinds: Type[] = [];
  if (engine !== undefined) {
    const names = kindTypeNames(engine);
    const seen = new Set<string>();
    const collect = (t: Readonly<Type>, depth: number): void => {
      if (depth > 16) return;
      if (isKindArm(t, names)) {
        const key = typeof t === 'string' ? t : (t as { name: string }).name;
        if (!seen.has(key)) {
          seen.add(key);
          kinds.push(t as Type);
        }
        return;
      }
      if (typeof t === 'string') return;
      switch (t.kind) {
        case 'union':
          for (const x of t.types) collect(x, depth + 1);
          return;
        case 'list':
        case 'set':
        case 'collection':
        case 'indexed_collection':
        case 'broadcastable':
          collect(t.elements, depth + 1);
          return;
        case 'tuple':
          for (const e of t.elements) collect(e.type, depth + 1);
          return;
        case 'reference': {
          const r = resolveTypeAlias(t);
          if (r !== t) collect(r, depth + 1);
          return;
        }
      }
    };
    for (const d of ops) collect(d.type, 0);
  }
  if (kinds.length === 0) kinds.push('residue');
  const cells =
    engine === undefined || operator === undefined
      ? kinds
      : kinds.flatMap((k) =>
          kindResultTypeArms(
            engine,
            k,
            operator,
            operandTypes ?? ops.map((d) => typeWithoutShape(d.type))
          )
        );
  const result: Type =
    cells.length === 1 ? cells[0] : reduceType({ kind: 'union', types: cells });
  if (!nan) return result;
  return reduceType({ kind: 'union', types: ['nan', ...cells] });
}

/**
 * The arms that the kind type `kind` adds to the cell result type of
 * `operator`: the answer of the `resultType` hook of the kind type when it
 * gives one (a type string is parsed in the engine), else the kind type
 * itself (`docs/plans/2026-10-26-value-kinds.md`, section 4.5, rule 2).
 */
function kindResultTypeArms(
  engine: object,
  kind: Type,
  operator: string,
  operandTypes: ReadonlyArray<Type>
): Type[] {
  const name =
    typeof kind === 'string' ? kind : (kind as { name?: string }).name;
  const hook =
    name === undefined
      ? undefined
      : kindTypeInfo(engine as ComputeEngine, name)?.resultType;
  if (hook === undefined) return [kind];
  const answer = hook(operator, operandTypes);
  if (answer === undefined) return [kind];
  const t =
    typeof answer === 'string'
      ? (engine as PureEngineView).type(answer).type
      : answer;
  return typeof t === 'object' && t.kind === 'union' ? [...t.types] : [t];
}

/**
 * The type `t` with its shape removed: the type of a cell of a list, a set
 * or a tensor, the union of the slot types of a tuple, a union arm by arm
 * (`list<gf8^2>` is `gf8`, `tuple<integer, gf8>` is `integer | gf8`). The
 * operand types that a `resultType` hook receives.
 */
export function typeWithoutShape(t: Type, depth = 0): Type {
  if (depth > 16 || typeof t === 'string') return t;
  switch (t.kind) {
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return typeWithoutShape(t.elements, depth + 1);
    case 'tuple':
      return reduceType({
        kind: 'union',
        types: t.elements.map((e) => typeWithoutShape(e.type, depth + 1)),
      });
    case 'union':
      return reduceType({
        kind: 'union',
        types: t.types.map((x) => typeWithoutShape(x, depth + 1)),
      });
    default:
      return t;
  }
}

setSymbolValueHook(noteAssignedKindValue);

/**
 * True when a call of a head that declares a value kind is in the function
 * expression `expr`, at any depth and through any operator. Computed once
 * per node and kept in `KIND_CALL_FACTS` with the generation of the kind
 * registry it was computed under: an expression does not change, but the
 * registry can (a head declared with `arithmetic` after `expr` was boxed),
 * so an answer of another generation is computed again.
 */
const KIND_CALL_FACTS = new WeakMap<
  Expression,
  { generation: number; value: boolean }
>();

function hasKindCall(expr: Expression, generation: number): boolean {
  const known = KIND_CALL_FACTS.get(expr);
  if (known !== undefined && known.generation === generation)
    return known.value;
  const value =
    isKindHeadCall(expr) ||
    (isFunction(expr) &&
      expr.ops.some((op) => isFunction(op) && hasKindCall(op, generation)));
  KIND_CALL_FACTS.set(expr, { generation, value });
  return value;
}

/** True when `expr` is a call of a head that declares a value kind: its
 * bound operator definition is in the dispatch part of the registry, or,
 * for a call that is not bound (a non-canonical expression), a registered
 * head has its name. */
function isKindHeadCall(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  const def = expr.operatorDefinition;
  if (def !== undefined) return arithmeticOf(expr.engine, def) !== undefined;
  // Bound to a value (a function value), not to an operator: not a kind head.
  if (expr.valueDefinition !== undefined) return false;
  return kindTypesOfHeadName(expr.engine, expr.operator) !== undefined;
}

/**
 * The symbols in the function expression `expr`, at any depth. A symbol's
 * value can change, so the symbols are kept with the expression, and their
 * values are read when they are used. They are computed only in an engine
 * where a symbol value holds a kind value (the assigned gate). The symbols
 * of an expression do not depend on the kind registry, so this cache has no
 * generation.
 */
const CLASS_SYMBOLS = new WeakMap<Expression, ReadonlyArray<Expression>>();

function classSymbols(expr: Expression): ReadonlyArray<Expression> {
  let result = CLASS_SYMBOLS.get(expr);
  if (result !== undefined) return result;
  const found = new Map<string, Expression>();
  if (isFunction(expr)) {
    for (const op of expr.ops) {
      if (isSymbol(op)) found.set(op.symbol, op);
      else if (isFunction(op))
        for (const x of classSymbols(op)) found.set(sym(x)!, x);
    }
  }
  result = [...found.values()];
  CLASS_SYMBOLS.set(expr, result);
  return result;
}

/**
 * True when `expr` holds a kind value, following the values of symbols
 * transitively. `visited` holds the names of the symbols already followed,
 * so that a cycle of values (`a := b`, `b := a`) ends; it is made when the
 * first symbol is followed.
 */
function holds(
  expr: Expression,
  visited: Set<string> | undefined,
  certain: boolean
): boolean {
  if (isSymbol(expr)) return symbolHolds(expr, visited, certain);
  if (!isFunction(expr)) return false;
  const ce = expr.engine;
  if (hasKindCall(expr, kindGeneration(ce))) return true;
  if (hasKindCallee(expr, certain)) return true;
  // A symbol declared with a kind type holds a kind value whether or not it
  // has a value (`symbolHolds()`), so the symbols are read before the gate
  // below, which only says whether a VALUE in this engine holds one. Their
  // types are read only in an engine where such a declaration exists.
  const symbols = classSymbols(expr);
  if (engineHasKindDeclarations(ce)) {
    const kinds = kindTypeNames(ce);
    if (symbols.some((x) => typeSaysKind(x.type.type, kinds, certain)))
      return true;
  }
  if (!engineHasKindValuesAssigned(ce)) return false;
  visited ??= new Set();
  return symbols.some((x) => symbolHolds(x, visited, certain));
}

/**
 * True when a signature type (one arm, or a union of arms for an overloaded
 * operator) has an arm whose result can be a value of a kind of `ce`:
 * `(any, any) -> residue`, `(integer) -> integer | residue`,
 * `(integer) -> gf8`.
 */
export function signatureReturnsKind(
  ce: object,
  type: Type,
  certain = false
): boolean {
  if (typeof type === 'string') return false;
  // Kept per type OBJECT: a type is immutable, and an inferred signature that
  // changes is a new object (`_inferWithoutFacts()` replaces the signature of
  // the definition, and a rollback restores the earlier object), so the
  // answer for one object never changes and needs no invalidation. The walk
  // of `holdsKindValue()` asks this for every application it visits;
  // without the cache the signature analysis was most of its cost
  // (`docs/plans/2026-10-23-residue-class-type.md`, section 7).
  //
  // The answer does not depend on the engine either: a result type that
  // names no type by reference can only have a kind PRIMITIVE as a kind
  // arm, and a kind primitive is a kind type in every engine
  // (`kindTypeNames()`). A result that names a type by reference is not
  // kept (below).
  const cache = certain
    ? SIGNATURE_RETURNS_KIND_CERTAINLY
    : SIGNATURE_RETURNS_KIND;
  const cached = cache.get(type);
  if (cached !== undefined) return cached;
  const kinds = kindTypeNames(ce);
  const arms = signatureArms(resolveTypeAlias(type));
  const result =
    arms !== undefined &&
    arms.some((arm) => {
      const r = functionResult(arm);
      return r !== undefined && typeSaysKind(r, kinds, certain);
    });
  // A result that names a type by reference is read through its record: an
  // alias record is updated in place when the alias is declared again
  // (`integer` today, `residue` after `type T = residue`), and a nominal
  // type becomes a kind type when a head of it is registered. The type
  // object is the same, the answer is not, so it is not kept.
  if (!signatureNamesAlias(type)) cache.set(type, result);
  return result;
}

/**
 * True when the signature `type` (or one of its arms) has a result type
 * that names a type by reference (an alias or a declared type), at any
 * depth. The answer of `signatureReturnsKind()` for such a signature can
 * change without the type object changing, so it is not cached.
 */
function signatureNamesAlias(type: Type): boolean {
  const arms = signatureArms(resolveTypeAlias(type));
  if (arms === undefined) return false;
  return arms.some((arm) => {
    const r = functionResult(arm);
    return r !== undefined && mentionsReference(r);
  });
}

function mentionsReference(t: Type): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'reference':
      return true;
    case 'union':
    case 'intersection':
      return t.types.some(mentionsReference);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return mentionsReference(t.elements);
    case 'tuple':
      return t.elements.some((e) => mentionsReference(e.type));
    case 'dictionary':
      return mentionsReference(t.values);
    case 'record':
    case 'object':
      return Object.values(t.elements).some(mentionsReference);
    case 'signature':
      return signatureNamesAlias(t);
    default:
      return false;
  }
}

const SIGNATURE_RETURNS_KIND = new WeakMap<object, boolean>();
const SIGNATURE_RETURNS_KIND_CERTAINLY = new WeakMap<object, boolean>();

/**
 * Whether a type is evidence of a kind value. In the usual reading
 * (`certain` false) a type with a kind arm anywhere is: a value of that type
 * MAY be a kind value, and a rule that is wrong for one (`x/x` is 1) must
 * not run on it. In the strict reading (`certain` true) only a type whose
 * values ARE kind values is: `residue`, `gf8`, beside an absent or `NaN` arm
 * at most. The compiler asks the strict question
 * (`holdsKindValueForCertain()`): a parameter typed `number | residue` is
 * compiled as the number it is given.
 */
function typeSaysKind(
  t: Type,
  kinds: KindTypeNames,
  certain: boolean
): boolean {
  if (!hasKindArm(t, kinds)) return false;
  if (!certain) return true;
  // `residue`, `nan | residue`, `set<residue>`, `list<gf8^2>`: nothing but
  // kind values, at the top level or in the cells.
  return isUninhabitedWithoutKinds(stripMissingFromType(t), kinds);
}

/** Whether the values of type `t` are kind values of `engine` for certain:
 * `t` is a kind type, beside an absent or `NaN` arm at most (the strict
 * reading of `typeSaysKind()`). A type with no kind arm, `missing`
 * included, answers false. */
export function typeIsKindForCertain(t: Type, engine: object): boolean {
  return typeSaysKind(t, kindTypeNames(engine), true);
}

/**
 * True when the callee of the application `expr` is declared to return a
 * kind value: the operator definition of a named call (`MyMod(2, 4)` with
 * `MyMod` declared `(any, any) -> residue`), the function type of a named
 * call bound to a value (`g(2)` with `g := k ↦ ResidueClass(k, 4)`, whose
 * inferred signature is `(unknown) -> residue`), or the type of the callee
 * of an `Apply(g, 2)`. A `type:` handler of the operator is not consulted:
 * a head with a handler that returns kind values declares the kind type in
 * its signature too.
 */
function calleeReturnsKind(expr: Expression, certain: boolean): boolean {
  if (!isFunction(expr)) return false;
  const ce = expr.engine;
  // `Apply` has a library definition of its own (its declared result is
  // `unknown`), so its callee is read first: the applied function is its
  // first operand, whatever expression that is (`Apply(If(p, f, g), 2)`).
  if (expr.operator === 'Apply' && expr.nops > 0)
    return signatureReturnsKind(ce, expr.op1.type.type, certain);
  const opDef = expr.operatorDefinition;
  if (opDef !== undefined)
    return signatureReturnsKind(ce, opDef.signature.type, certain);
  const valDef = expr.valueDefinition;
  if (valDef !== undefined)
    return signatureReturnsKind(ce, valDef.type.type, certain);
  return false;
}

/**
 * True when an application in the function expression `expr`, at any depth,
 * has a callee declared to return a kind value (`calleeReturnsKind()`).
 *
 * The answer is kept with the expression (`CALLEE_FACTS`) only when every
 * callee in it is a library operator with a declared signature: such a
 * signature does not change, so neither does the answer. An expression with
 * a user function (declared by the host or by an Epsil program, or with an
 * inferred signature), a named call bound to a function value, or an `Apply`
 * is walked again on each query: an inferred signature changes (a function
 * value is re-derived when a name it reads gains a definition, and a
 * rollback of the Epsil static check restores an earlier one), so a kept
 * answer would depend on the order of the queries. The walk reads a
 * definition that each node already holds, and runs only in an engine that
 * can hold a kind value (the value gate), so the engines that do not use a
 * kind do not pay for it; the cache is what keeps its cost in the engines
 * that do near the cost of the name test
 * (`docs/plans/2026-10-23-residue-class-type.md`, section 7). A kept answer
 * also stores the generation of the kind registry, and is computed again
 * when the generation moved.
 */
function hasKindCallee(expr: Expression, certain: boolean): boolean {
  const cache = certain ? CALLEE_FACTS_CERTAIN : CALLEE_FACTS;
  const generation = kindGeneration(expr.engine);
  const known = cache.get(expr);
  if (known !== undefined && known.generation === generation)
    return known.value;
  let stable = true;
  const walk = (e: Expression): boolean => {
    if (!isFunction(e)) return false;
    const opDef = e.operatorDefinition;
    if (opDef === undefined || e.operator === 'Apply') {
      // A named call bound to a function value, or an `Apply`, whose callee
      // is its first operand (`calleeReturnsKind()`).
      stable = false;
      if (calleeReturnsKind(e, certain)) return true;
    } else {
      // A library operator's signature does not change, unless its result
      // names an alias: an alias record is updated in place when the alias
      // is declared again, so such a callee is read on each query.
      if (
        opDef.inferredSignature ||
        opDef.isUserFunctionDefinition ||
        signatureNamesAlias(opDef.signature.type)
      )
        stable = false;
      if (signatureReturnsKind(e.engine, opDef.signature.type, certain))
        return true;
    }
    return e.ops.some(walk);
  };
  const value = walk(expr);
  if (stable) cache.set(expr, { generation, value });
  return value;
}

/** The answers of `hasKindCallee()` for the expressions whose callees
 * are all library operators (see there), in each reading. */
const CALLEE_FACTS = new WeakMap<
  Expression,
  { generation: number; value: boolean }
>();
const CALLEE_FACTS_CERTAIN = new WeakMap<
  Expression,
  { generation: number; value: boolean }
>();

function symbolHolds(
  expr: Expression,
  visited: Set<string> | undefined,
  certain: boolean
): boolean {
  // A symbol declared with a kind type (or `integer | residue`) holds a kind
  // value whether or not it has a value yet: the declaration is the
  // evidence, and `r/r` is protected before `r` is assigned.
  const ce = expr.engine;
  if (
    engineHasKindDeclarations(ce) &&
    typeSaysKind(expr.type.type, kindTypeNames(ce), certain)
  )
    return true;
  if (!engineHasKindValuesAssigned(ce)) return false;
  const name = sym(expr)!;
  visited ??= new Set();
  if (visited.has(name)) return false;
  visited.add(name);
  const value = expr.value;
  return (
    value !== undefined && value !== expr && holds(value, visited, certain)
  );
}

/**
 * True when `expr` holds a value of a VALUE KIND (a residue class, or a value
 * of any kind registered in the engine): a call of a head that declares a
 * kind is in it at any depth, through any operator (`c + 1`, `Max(c, x)`,
 * `At([c], 1)`, `Sum(ResidueClass(k, 4), k, 1, 3)`). The call does not have
 * to be a value yet: `ResidueClass(k, 4)` with a symbol `k` counts too. A
 * symbol whose value holds a kind value counts too (`q := ResidueClass(2,
 * 4)`, and `r := q + y` through `q`): values are followed transitively, and
 * a cycle of values ends the walk. The type is evidence too: a symbol
 * declared with a kind type (`residue`, `integer | gf8`, `list<gf8>`) holds
 * a kind value with or without a value, and an application whose callee is
 * declared to return a kind type (a head declared `(any, any) -> residue`, a
 * function value `g := k ↦ ResidueClass(k, 4)`) holds one
 * (`hasKindCallee()`). This is the NON-STRICT reading: a type with a kind
 * arm beside other arms counts.
 *
 * The test does not read the type of `expr` itself: computing the type of
 * every expression a rule looks at costs more than the rules
 * (`docs/plans/2026-10-23-residue-class-type.md`, section 2), and a symbol
 * typed `value` or `unknown` can hold a kind value without saying so. The
 * structural walk of a function expression is done once and kept with the
 * expression (`hasKindCall()`), so that part of the test is a lookup. The
 * same test is used by every rule that checks for a kind value, in
 * canonicalization, evaluation and simplification: when two rules used
 * different tests, one built what the other then rebuilt, without end.
 *
 * The arithmetic of a kind is defined only by its own rules (the hooks of
 * its `arithmetic` field; for a class, the `residue*` functions). The
 * generic rules of canonicalization, evaluation and simplification do not
 * know them, and give wrong answers for an expression for which this is
 * true: they read `c/c` as 1 when the class `c` has no inverse, `c - c` as
 * the integer 0, `c + ∞` as `∞`, and `(c^{2/3})^3` as `c^2`. So these rules
 * check this first, and keep the expression as it is.
 */
export function holdsKindValue(expr: Expression): boolean {
  if (!engineHasKindValues(expr.engine)) return false;
  if (!isSymbol(expr) && !isFunction(expr)) return false;
  return holds(expr, undefined, false);
}

/**
 * True when `expr` holds a kind value FOR CERTAIN: the same walk as
 * `holdsKindValue()`, with the strict reading of a type (`typeSaysKind()`):
 * a call of a kind head, a symbol whose value holds one, a symbol or a
 * callee whose type is a kind type (an absent or `NaN` arm aside). A symbol
 * or a callee typed `number | residue` does not count: it may be a number.
 * The compiler asks this question (`BaseCompiler.compile()`), and declines
 * what it cannot represent; the rules of arithmetic ask the other, and keep
 * away from what may be a kind value.
 */
export function holdsKindValueForCertain(expr: Expression): boolean {
  if (!engineHasKindValues(expr.engine)) return false;
  if (!isSymbol(expr) && !isFunction(expr)) return false;
  return holds(expr, undefined, true);
}

/**
 * The kind types that `expr` holds a value of FOR CERTAIN, for the message
 * of the compiler when it declines (`BaseCompiler.compile()`): the kind
 * types of the kind heads called in `expr`, and of the strict types of its
 * symbols. Empty when none is found by this shallow reading (a value held
 * through a symbol's value or a callee); the caller then names the kind in
 * general terms.
 */
export function kindTypesHeldBy(expr: Expression): string[] {
  const ce = expr.engine;
  const kinds = kindTypeNames(ce);
  const found = new Set<string>();
  const visit = (e: Expression): void => {
    if (isSymbol(e)) {
      if (typeSaysKind(e.type.type, kinds, true))
        for (const t of kindArmNames(e.type.type, kinds)) found.add(t);
      return;
    }
    if (!isFunction(e)) return;
    if (isKindHeadCall(e))
      for (const t of kindArmNames(e.type.type, kinds)) found.add(t);
    else if (calleeReturnsKind(e, true))
      for (const t of declaredKindTypes(ce, calleeType(e))) found.add(t);
    for (const op of e.ops) visit(op);
  };
  visit(expr);
  return [...found];
}

/** The signature type of the callee of the application `expr` (see
 * `calleeReturnsKind()`). */
function calleeType(expr: Expression): Type {
  if (!isFunction(expr)) return 'never';
  if (expr.operator === 'Apply' && expr.nops > 0) return expr.op1.type.type;
  return (
    expr.operatorDefinition?.signature.type ??
    expr.valueDefinition?.type.type ??
    'never'
  );
}

/**
 * What a transformation that does not apply to an expression with a class
 * (`Expand`, `Factor`, `Together`) gives for `expr`, which holds one: the
 * residue fold of `expr` when it is pure and every symbol in it is a
 * constant (`Expand(c + c)` is the class `2c`), else `expr` as it is.
 */
export function residueFoldOrKeep(expr: Expression): Expression {
  return expr.isPure === true && expr.isConstant ? expr.evaluate() : expr;
}

export function residueExpression(ce: ComputeEngine, x: Residue): Expression {
  return ce._fn('ResidueClass', [ce.number(x.k), ce.number(x.n)]);
}

/**
 * `ResidueClass(k, n)` in canonical form: `k` reduced into [0, n). `undefined`
 * when `n` is not an exact integer literal ≥ 1, or `k` is not an exact
 * integer or a rational literal that is a unit mod `n`: the call stays as it
 * is.
 */
export function residueClassOf(
  ce: ComputeEngine,
  k: Expression,
  n: Expression
): Expression | undefined {
  const modulus = exactInteger(n);
  if (modulus === null || modulus < 1n) return undefined;
  const r = residueOfLiteral(k, modulus);
  return r === undefined ? undefined : residueExpression(ce, r);
}

//
// Arithmetic on pairs of one modulus
//

const add = (x: Residue, y: Residue): Residue => ({
  k: mod(x.k + y.k, x.n),
  n: x.n,
});

const multiply = (x: Residue, y: Residue): Residue => ({
  k: mod(x.k * y.k, x.n),
  n: x.n,
});

const negate = (x: Residue): Residue => ({ k: mod(-x.k, x.n), n: x.n });

/** x⁻¹, or `undefined` when gcd(k, n) ≠ 1. */
const inverse = (x: Residue): Residue | undefined => {
  const k = modularInverse(x.k, x.n);
  return k === null ? undefined : { k, n: x.n };
};

/** xᵉ; a negative exponent inverts first, so it needs a unit. */
const power = (x: Residue, e: bigint): Residue | undefined => {
  const base = e < 0n ? inverse(x) : x;
  if (base === undefined) return undefined;
  return { k: modPow(base.k, e < 0n ? -e : e, x.n), n: x.n };
};

//
// Operands
//

/**
 * The class that `op` is: a class, or the negation of a class
 * (`-ResidueClass(2, 5)` is `ResidueClass(3, 5)`).
 */
function classOf(op: Expression): Residue | undefined {
  if (isFunction(op, 'Negate')) {
    const r = residueOf(op.op1);
    return r === undefined ? undefined : negate(r);
  }
  return residueOf(op);
}

/**
 * The modulus of the `ResidueClass(…)` calls among `ops`, also under a
 * negation. `undefined` when
 * there is none, `null` when they do not share one ring: a call that is not
 * a class yet (a symbolic `k`), or classes of different moduli.
 */
function ringOf(ops: ReadonlyArray<Expression>): bigint | null | undefined {
  let ring: bigint | undefined = undefined;
  for (const op of ops) {
    const call = isFunction(op, 'Negate') ? op.op1 : op;
    if (call.operator !== 'ResidueClass') continue;
    const r = residueOf(call);
    if (r === undefined) return null;
    if (ring !== undefined && ring !== r.n) return null;
    ring = r.n;
  }
  return ring;
}

/**
 * The result of `residueFold()`: `value` is the class that the class
 * operands and the literals that read in their ring make together, and
 * `rest` holds the indexes of the operands that are not part of it.
 */
export interface ResidueFold {
  readonly value: Expression;
  readonly rest: ReadonlyArray<number>;
}

/**
 * Fold the operands of a sum or a product that are in one ring: the classes,
 * and the exact integer or rational literals that read in their ring. The
 * other operands (a symbol, a float, an infinity, an expression with a class
 * inside it such as `1/c`) are not part of the fold; their indexes are in
 * `rest`, and the caller keeps them as they are, beside the class:
 * `ResidueClass(1, 5) + ResidueClass(2, 5) + x` is `x + ResidueClass(3, 5)`.
 *
 * `undefined` when there is nothing to fold: no class among `ops`, classes
 * of different moduli, or a `ResidueClass(…)` call that is not a class yet.
 */
export function residueFold(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  operation: 'add' | 'multiply'
): ResidueFold | undefined {
  const ring = ringOf(ops);
  if (ring === undefined || ring === null) return undefined;
  const step = operation === 'add' ? add : multiply;
  let acc: Residue | undefined = undefined;
  const rest: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const r = classOf(op) ?? residueOfLiteral(op, ring);
    if (r === undefined) {
      rest.push(i);
      continue;
    }
    acc = acc === undefined ? r : step(acc, r);
  }
  return acc === undefined
    ? undefined
    : { value: residueExpression(ce, acc), rest };
}

export function residueNegate(
  ce: ComputeEngine,
  x: Expression
): Expression | undefined {
  const r = residueOf(x);
  return r === undefined ? undefined : residueExpression(ce, negate(r));
}

/**
 * `num / den` in one ring: `undefined` when the operands are not both in the
 * ring of a class (a class of another modulus, a symbol, a float), or when
 * `den` is not a unit.
 */
export function residueDivide(
  ce: ComputeEngine,
  num: Expression,
  den: Expression
): Expression | undefined {
  const ring = ringOf([num, den]);
  if (ring === undefined || ring === null) return undefined;
  const a = residueOf(num) ?? residueOfLiteral(num, ring);
  const b = residueOf(den) ?? residueOfLiteral(den, ring);
  if (a === undefined || b === undefined) return undefined;
  const b1 = inverse(b);
  return b1 === undefined ? undefined : residueExpression(ce, multiply(a, b1));
}

/**
 * `x ^ e` for an exact integer exponent: `undefined` for a negative one on a
 * non-unit.
 */
export function residuePower(
  ce: ComputeEngine,
  x: Expression,
  e: Expression
): Expression | undefined {
  const r = residueOf(x);
  const exponent = exactInteger(e);
  if (r === undefined || exponent === null) return undefined;
  const p = power(r, exponent);
  return p === undefined ? undefined : residueExpression(ce, p);
}

/**
 * The value kind of `ResidueClass` (the `arithmetic` field of its operator
 * definition, `library/sets.ts`; `docs/plans/2026-10-26-value-kinds.md`,
 * sections 4.3 and 4.7). The hooks wrap the `residue*` functions above, in
 * the shapes of `ArithmeticDefinition`: `add` and `multiply` fold the
 * classes of one ring and the exact literals that read in it into one
 * class, and name the operands they combined; `negate`, `divide` and
 * `power` answer a class or decline. Each hook reads the EXACT value of its
 * operands (`exact()`), so that `(c + 1/3).N()` is a class and not a sum
 * with `0.333…`.
 *
 * Classes have no order (no `compare`), are admitted only where a
 * parameter names `residue` or admits `value` (`admittedAs: 'none'`), and
 * have no compiled form (no `compile`).
 */
export const RESIDUE_CLASS_ARITHMETIC: ArithmeticDefinition = {
  admittedAs: 'none',
  add: (ops, { engine }) => residueKindFold(engine, ops, 'add'),
  multiply: (ops, { engine }) => residueKindFold(engine, ops, 'multiply'),
  negate: (x, { engine }) => residueNegate(engine, x.exact()),
  divide: (a, b, { engine }) => residueDivide(engine, a.exact(), b.exact()),
  power: (base, exponent, { engine }) =>
    residuePower(engine, base.exact(), exponent.exact()),
};

function residueKindFold(
  ce: ComputeEngine,
  ops: {
    readonly evaluated: ReadonlyArray<Expression>;
    exact(i: number): Expression;
  },
  operation: 'add' | 'multiply'
): ReadonlyArray<KindFold> | undefined {
  const exact = ops.evaluated.map((_, i) => ops.exact(i));
  const fold = residueFold(ce, exact, operation);
  if (fold === undefined) return undefined;
  const rest = new Set(fold.rest);
  const operands = exact.map((_, i) => i).filter((i) => !rest.has(i));
  return [{ value: fold.value, operands }];
}
