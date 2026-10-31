// Value-kind lowering (Enclosure and the other kinds) and its report.

import type { Expression } from '../global-types.js';
import { kindArmNames } from '../../common/type/utils.js';
import { kindTypesHeldBy } from '../boxed-expression/residue-class.js';
import {
  arithmeticOf,
  kindTypeNames,
  kindTypesOfHead,
} from '../boxed-expression/value-kinds.js';
import {
  certainKindTypesOf,
  holdsKindCollection,
  kindContractOf,
  multiKindSymbols,
  newKindLowering,
  refusedRepresentationMessage,
  type KindLowering,
  type KindTypeContract,
} from './kind-lowering.js';
import { hasEnclosureArm } from '../library/enclosure-compile.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { multiClauseState } from '../multi-clause.js';
import type { CompileTarget, TargetSource } from './types.js';
import { CompilerState } from './compiler-state.js';
import { operandTypeInContext } from './compile-user-calls.js';
import { compileValueOperand } from './compile-statements.js';
import { CONTROL_FLOW_HEADS } from './compiler-tables.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';

/**
 * The kind types of the kind lowering of the most recent outermost
 * compilation, with their contracts, or `undefined` when that compilation
 * had no kind lowering. A kind type is listed when the expression holds a
 * value of it or its result type names it (a bare symbol `g: gf8` is
 * compiled with no hook, and its value is still a kind value), or when a
 * hook of its contract emitted code. The JavaScript target reads it to
 * build the result: the result of a kind lowering is returned raw, is not
 * shippable unless every contract says so, and cannot be stored.
 */
export function kindLoweringReport():
  | {
      kinds: ReadonlyArray<string>;
      contracts: ReadonlyArray<KindTypeContract>;
    }
  | undefined {
  const lowering = CompilerState._lastKindLowering;
  if (lowering === undefined) return undefined;
  const kinds: string[] = [];
  const contracts: KindTypeContract[] = [];
  for (const [k, entry] of lowering.contracts) {
    if (entry === undefined) continue;
    kinds.push(k);
    contracts.push(entry.contract);
  }
  return kinds.length === 0 ? undefined : { kinds, contracts };
}

/**
 * The kind lowering of `expr`, which holds a kind value for certain, on
 * `target`: every kind type that `expr` holds, or that its result type
 * names, has a contract whose `lowered()` answers for the target. With
 * `possibleEnclosure`, the kind type `enclosure` is one of them too (a
 * free symbol of `expr` may hold an enclosure, on `interval-js`). Throws
 * for an expression that holds a collection of kind values, for an
 * interval target with a kind other than the enclosure, and for a
 * representation that the runner would read as a number, a complex or a
 * list. `undefined` when a kind type has no representation on the target
 * (the caller declines with the general message).
 */
export function kindLoweringOf(
  expr: Expression,
  target: CompileTarget<Expression>,
  possibleEnclosure = false
): KindLowering | undefined {
  const ce = expr.engine;
  const kinds = new Set([
    ...kindTypesHeldBy(expr),
    ...kindArmNames(expr.type.type, kindTypeNames(ce)),
    ...(possibleEnclosure ? ['enclosure'] : []),
  ]);
  if (kinds.size === 0) return undefined;
  const language = target.language ?? 'javascript';
  const lowering = newKindLowering(ce, {
    language,
    typeOf: (x) => operandTypeInContext(x, target),
  });
  for (const k of kinds)
    if (kindContractOf(lowering, k) === undefined) return undefined;
  const names = [...kinds].map((t) => `'${t}'`).join(', ');
  // The runner of `interval-js` checks a host value of the kind type
  // `enclosure` (`intervalKindEntries()`, `interval-javascript-target.ts`),
  // and of no other kind type.
  if (
    language.startsWith('interval') &&
    !(
      language === 'interval-javascript' &&
      [...kinds].every((k) => k === 'enclosure')
    )
  )
    throw new Error(
      `Could not compile an expression that holds a value of the kind ` +
        `type ${names} to target '${language}': the run-time check of a ` +
        `kind value given by the host is not available on this target.`
    );
  if (holdsKindCollection(expr))
    throw new Error(
      `Could not compile an expression that holds a collection of values ` +
        `of the kind type ${names} to target '${language}': the compiled ` +
        `representation of a value kind describes one value, not a ` +
        `collection of them.`
    );
  const mixed = multiKindSymbols(expr)[0];
  if (mixed !== undefined)
    throw new Error(
      `Could not compile an expression with the symbol "${mixed.name}" ` +
        `of the type ${mixed.kinds.map((k) => `'${k}'`).join(' | ')} to ` +
        `target '${language}': a binding of a union of kind types has no ` +
        `run-time check, since the entry check of a binding reads the ` +
        `contract of one kind type.`
    );
  for (const k of kinds) {
    const message = refusedRepresentationMessage(
      k,
      kindContractOf(lowering, k)!.lowered,
      language
    );
    if (message !== undefined) throw new Error(message);
  }
  return lowering;
}

/**
 * The code of the function node `node` (operator `h`, operands `args`)
 * through the kind contracts of the compilation (`_kindLowering`), or
 * `undefined` when the node is compiled as usual:
 *
 * - a call of a kind head is a literal value of the head: its
 *   `compile.value` gives the code, and a head without it declines;
 * - a structural or control-flow operator (`If`, `Block`, `List`, `Tuple`,
 *   `Assign`, `Hold`, …) and a call of a user function are compiled as
 *   usual, and treat the representation of a kind value as an opaque
 *   value;
 * - an `Add` (a `Multiply`) with an operand that is a kind value for
 *   certain is lowered by the `add` (`multiply`) of the kind type; any
 *   other operator with such an operand by its `apply`. With operands of
 *   two kind types, the types are asked in the order of their first
 *   operand, and the first answer is the code.
 *
 * A hook that answers `undefined` (or an empty string) declines; when no
 * kind type answers, the compilation declines. A kind type with no
 * representation on the target declines too.
 */
export function compileKindOperation(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  const lowering = CompilerState._kindLowering;
  if (lowering === undefined || node === undefined || !isFunction(node))
    return undefined;
  const ce = node.engine;
  const language = lowering.context.language;
  const compile = (x: Expression): string => compileValueOperand(x, target);
  const noLowering = (kind: string, what: string): Error =>
    new Error(
      `Could not compile ${what} to target '${language}': the kind type ` +
        `'${kind}' has no compiled lowering for it.`
    );

  // A literal value of a kind head.
  const def = node.operatorDefinition;
  const headKinds = def !== undefined ? kindTypesOfHead(ce, def) : undefined;
  if (def !== undefined && headKinds !== undefined) {
    for (const k of headKinds)
      if (kindContractOf(lowering, k) === undefined)
        throw noLowering(k, `a value of \`${h}\``);
    const value = arithmeticOf(ce, def)?.compile?.value;
    const code = value?.(node, compile, lowering.context);
    if (typeof code !== 'string' || code === '')
      throw new Error(
        `Could not compile a value of \`${h}\` to target '${language}': ` +
          `the head has no \`compile.value\` for this target.`
      );
    return code;
  }

  if (
    CONTROL_FLOW_HEADS.has(h) ||
    KIND_OPAQUE_HEADS.has(h) ||
    userFunctionLiteral(ce, h) !== undefined ||
    multiClauseState(ce.lookupDefinition(h)) !== undefined
  )
    return undefined;

  // The kind types of the operands, in the order of their first operand.
  // On `interval-js` an operand that MAY be an enclosure (`number |
  // enclosure`) is lowered by the contract of the enclosure too: a number
  // is a point interval on that target, and the code of the contract is
  // valid for it.
  const kinds: string[] = [];
  const possible = language === 'interval-javascript';
  for (const x of args) {
    for (const k of certainKindTypesOf(x))
      if (!kinds.includes(k)) kinds.push(k);
    if (
      possible &&
      !kinds.includes('enclosure') &&
      hasEnclosureArm(x.type.type)
    )
      kinds.push('enclosure');
  }
  if (kinds.length === 0) return undefined;
  for (const k of kinds)
    if (kindContractOf(lowering, k) === undefined)
      throw noLowering(k, `\`${h}\``);
  for (const k of kinds) {
    const { contract } = kindContractOf(lowering, k)!;
    const code =
      h === 'Add'
        ? contract.add?.(args, compile, lowering.context)
        : h === 'Multiply'
          ? contract.multiply?.(args, compile, lowering.context)
          : contract.apply?.(h, args, compile, lowering.context);
    if (typeof code === 'string' && code !== '') return code;
  }
  throw new Error(
    `Could not compile \`${h}\` with an operand of the kind type ` +
      `${kinds.map((k) => `'${k}'`).join(', ')} to target '${language}': ` +
      `the compiled lowering of the kind does not define it.`
  );
}

/**
 * The structural operators that `compileKindOperation()` leaves to their
 * usual lowering, beside `CONTROL_FLOW_HEADS`: they hold or pass a kind
 * value without computing with it, so the representation is an opaque
 * value for them.
 */
export const KIND_OPAQUE_HEADS: ReadonlySet<string> = new Set([
  'List',
  'Tuple',
  'Hold',
  'Apply',
]);
