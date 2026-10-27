/**
 * The compiled form of a VALUE KIND (`docs/plans/2026-10-26-value-kinds.md`,
 * section 4.8).
 *
 * A value kind (a residue class, an element of a finite field, a value of a
 * kind declared by the host) has no compiled representation of its own: the
 * targets compute over numbers. A kind TYPE can give one, with the
 * `compile.type` contract of the `arithmetic` field of a head of the type
 * (`ArithmeticCompile`): `lowered()` names the representation of the type on
 * a target, `add`, `multiply` and `apply` lower the operations, `entry`
 * checks a host value at run time. A head gives the source of a literal of
 * its own with `compile.value`.
 *
 * This module reads those contracts for the compiler (`BaseCompiler`) and
 * for the JavaScript target. It holds no compiler state: the compiler keeps
 * the lowering of one compilation (`KindLowering`) while it runs.
 */

import type {
  ArithmeticCompile,
  Expression,
  IComputeEngine as ComputeEngine,
  OperatorCompileContext,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import {
  hasKindArm,
  kindArmNames,
  withoutKindArms,
} from '../../common/type/utils.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import {
  kindTypeInfo,
  kindTypeNames,
} from '../boxed-expression/value-kinds.js';
import { typeIsKindForCertain } from '../boxed-expression/residue-class.js';

/** The `compile.type` contract of a kind type. */
export type KindTypeContract = NonNullable<ArithmeticCompile['type']>;

/**
 * The kind lowering of one compilation: the contracts of the kind types that
 * have a representation on the target of the compilation.
 */
export interface KindLowering {
  readonly engine: ComputeEngine;
  readonly context: OperatorCompileContext;
  /** The contract and the answer of `lowered()` of each kind type found so
   * far, or `undefined` for a kind type with no representation on the
   * target. */
  readonly contracts: Map<
    string,
    { contract: KindTypeContract; lowered: string } | undefined
  >;
}

/** A new kind lowering for a compilation to the target `language`. */
export function newKindLowering(
  engine: ComputeEngine,
  context: OperatorCompileContext
): KindLowering {
  return { engine, context, contracts: new Map() };
}

/**
 * The contract of the kind type `name` and the answer of its `lowered()` on
 * the target of `lowering`, or `undefined` when the kind type has no
 * `compile.type`, or when `lowered()` answers `undefined` for the target.
 * The answer is kept in `lowering`: `lowered()` is called once per kind type
 * and compilation.
 */
export function kindContractOf(
  lowering: KindLowering,
  name: string
): { contract: KindTypeContract; lowered: string } | undefined {
  if (lowering.contracts.has(name)) return lowering.contracts.get(name);
  const entry = typeContract(lowering.engine, name, lowering.context);
  lowering.contracts.set(name, entry);
  return entry;
}

function typeContract(
  ce: ComputeEngine,
  name: string,
  context: OperatorCompileContext
): { contract: KindTypeContract; lowered: string } | undefined {
  const contract = kindTypeInfo(ce, name)?.compileType;
  if (contract === undefined) return undefined;
  const lowered = contract.lowered(context);
  if (typeof lowered !== 'string' || lowered === '') return undefined;
  return { contract, lowered };
}

/**
 * The representation names that the JavaScript runner reads as one of its
 * own value conventions (`FreeSymbolType.lowered`): a number, a complex
 * `{ re, im }` record, an array of numbers (a list, a point, a colour). A
 * kind result is returned as it is (`normalizeRunResult()` is not applied to
 * it), and a host reads the representation by the name that `lowered()`
 * gives, so a kind type may not use one of these names on the JavaScript
 * targets: the host would read the value as a number, a complex or a list.
 */
const RUNNER_CONVENTIONS: ReadonlySet<string> = new Set([
  'number',
  'real',
  'integer',
  'complex',
  'array',
  'list',
  'point',
  'color',
]);

/**
 * The message of the decline of a kind type whose `lowered()` names a value
 * convention of the JavaScript runner, or `undefined` when the name is not
 * one of them or the target is not a JavaScript target.
 */
export function refusedRepresentationMessage(
  name: string,
  lowered: string,
  language: string
): string | undefined {
  if (language !== 'javascript') return undefined;
  if (!RUNNER_CONVENTIONS.has(lowered)) return undefined;
  return (
    `Could not compile an expression that holds a value of the kind type ` +
    `'${name}' to target '${language}': its \`compile.type.lowered()\` ` +
    `answers '${lowered}', which is a value convention of the runner. A ` +
    `kind value is returned as it is, and the runner and the host would read ` +
    `it as a number, a complex number or a list. Give the kind a ` +
    `representation of its own (an object with a field that names the kind).`
  );
}

/**
 * True when `expr` holds, at any depth, a COLLECTION of kind values: a node
 * or a symbol whose type has a kind arm below its top level (`list<gf8>`,
 * `tuple<gf8, integer>`, `set<residue>`). The `entry` and `lowered()` of a
 * kind contract describe one value, not a collection, so the compiler
 * declines such an expression in phase 1 of the design, on every target.
 * The arms of a function type are not read: a function that returns a kind
 * value is not a collection.
 */
export function holdsKindCollection(expr: Expression): boolean {
  const kinds = kindTypeNames(expr.engine);
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e) || isFunction(e)) {
      if (isCollectionOfKinds(e.type.type)) return true;
    }
    return isFunction(e) && e.ops.some(visit);
  };
  const isCollectionOfKinds = (t: Type): boolean => {
    if (!hasKindArm(t, kinds)) return false;
    const rest = withoutKindArms(t, kinds);
    const arms =
      typeof rest !== 'string' && rest.kind === 'union' ? rest.types : [rest];
    return arms.some(
      (arm) =>
        typeof arm !== 'string' &&
        arm.kind !== 'signature' &&
        hasKindArm(arm, kinds)
    );
  };
  return visit(expr);
}

/**
 * The kind types of a value of type `t` FOR CERTAIN: the kind arms of a type
 * whose values are kind values (`gf8`, `residue | nan`). Empty for a type
 * whose values may be numbers (`number | gf8`), and for a collection of kind
 * values (`list<gf8>`), which is not one kind value.
 */
function scalarKindTypes(ce: ComputeEngine, t: Type): string[] {
  if (!typeIsKindForCertain(t, ce)) return [];
  const kinds = kindTypeNames(ce);
  if (hasKindArm(withoutKindArms(t, kinds), kinds)) return [];
  return kindArmNames(t, kinds);
}

/**
 * The kind types of the operand `x` FOR CERTAIN, read from its type
 * (`scalarKindTypes()`). Empty for an operand that may be a number
 * (`number | gf8`): such an operand is compiled as a number.
 */
export function certainKindTypesOf(x: Expression): string[] {
  return scalarKindTypes(x.engine, x.type.type);
}

/**
 * The symbols of `expr`, at any depth, whose type is a union of two or more
 * kind types for certain (`gf8 | gf4`), each with those kind types. The
 * entry check of a binding reads the `entry` of ONE kind type
 * (`kindEntryCheck()`), and an operation reads the contract of the first
 * kind type that lowers it, so the compilation of such a symbol declines
 * instead of accepting a host value that no kind has checked.
 */
export function multiKindSymbols(
  expr: Expression
): { name: string; kinds: string[] }[] {
  const found = new Map<string, string[]>();
  const seen = new Set<Expression>();
  const visit = (e: Expression): void => {
    if (seen.has(e)) return;
    seen.add(e);
    if (isSymbol(e)) {
      const names = scalarKindTypes(e.engine, e.type.type);
      if (names.length > 1 && !found.has(e.symbol)) found.set(e.symbol, names);
      return;
    }
    if (isFunction(e)) for (const x of e.ops) visit(x);
  };
  visit(expr);
  return [...found].map(([name, kinds]) => ({ name, kinds }));
}

/**
 * The representation of a value of type `t` on the target `language`, for
 * the type report of a free symbol (`CompilationResult.freeSymbolTypes`):
 * the answer of `lowered()` of the kind type of `t` when `t` is one kind
 * type for certain and its contract answers. `undefined` otherwise.
 */
export function loweredKindType(
  ce: ComputeEngine,
  t: Type,
  context: OperatorCompileContext
): string | undefined {
  const names = scalarKindTypes(ce, t);
  if (names.length !== 1) return undefined;
  return typeContract(ce, names[0], context)?.lowered;
}

/**
 * The run-time entry check of a host value given for a binding of type `t`
 * on the target `language`: the `entry` of the contract of the kind type of
 * `t`, when `t` is one kind type for certain and its contract has a
 * representation on the target. `undefined` otherwise (the binding is
 * checked by the numeric and collection rules of the runner).
 */
export function kindEntryCheck(
  ce: ComputeEngine,
  t: Type,
  language: string
): { kind: string; check: (value: unknown) => boolean } | undefined {
  const names = scalarKindTypes(ce, t);
  if (names.length !== 1) return undefined;
  const context: OperatorCompileContext = { language };
  const found = typeContract(ce, names[0], context);
  if (found === undefined) return undefined;
  const { contract } = found;
  return {
    kind: names[0],
    check: (value) => contract.entry(value, context) === true,
  };
}
