import type { FunctionSignature, Type } from '../../common/type/types.js';
import { isWildcardFunctionType } from '../../common/type/utils.js';
import { osaDistance } from '../../common/fuzzy-string-match.js';
import { stringValue, symbol } from '../../math-json/utils.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type {
  Expression,
  ExpressionInput,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef, isValueDef } from './utils.js';
import {
  armAdmission,
  diagnoseNoMatch,
  isMoreSpecific,
  overloadArms,
  resolveOverload,
  triStateSelect,
} from './overload.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import type { FunctionClause } from '../multi-clause.js';

/**
 * Named-argument calls: `f(rate: 0.05, years: 3)`.
 *
 * The surface syntax emits one `["NamedArgument", "'name'", value]` carrier per
 * named argument (Epsil `Parser.parseCall`; the same shape can be written by
 * hand on the `ce.box()` route). This module turns a written argument list
 * containing carriers into the positional argument list the callee's signature
 * declares — or into a diagnostic.
 *
 * Design: `docs/LANGUAGE-MODEL.md`, implementing
 * `docs/TYPE_SYSTEM_ROADMAP.md` Appendix C (rulings C1–C6 and the sub-rulings
 * R1–R4 the design doc adopts).
 *
 * The single caller is `makeCanonicalFunction` (`box.ts`), which runs
 * normalization immediately after the callee's definition is looked up and
 * BEFORE anything order-sensitive: the contextual callback stamp, `flatten`,
 * the binder pre-phase, the lazy split and `validateArguments` all read
 * operands by position, so they must see declaration order. A call with no
 * carrier never reaches this module.
 */

const CARRIER = 'NamedArgument';

/** One written argument: a positional operand (`name === undefined`) or the
 * value carried by a `NamedArgument`, in WRITTEN order. `index` is the
 * operand's position in the written argument list, so a diagnostic can be
 * substituted back where the author wrote it. */
type WrittenArgument = {
  name: string | undefined;
  value: ExpressionInput;
  index: number;
  /** Its position among the arguments that FILL a slot, or -1 when the
   * argument is OMITTED — a named argument whose value is `Nothing`
   * ({@link isOmitted}). An omitted argument is written, so every check that
   * judges the call AS WRITTEN sees it, but it supplies no operand: it is
   * absent from the emitted call and from the operand list the overload
   * machinery resolves against, which is the index space this counts in. */
  fillIndex: number;
};

/** True when the written argument supplies no value: `f(x: Nothing)`.
 *
 * `Nothing` is the engine's absent-value marker, and it cannot be passed
 * positionally in any case — `flatten` drops it unconditionally, which would
 * shift every later argument one slot left and bind it to the wrong
 * parameter. So the slot its name selects is simply left unfilled and the
 * ordinary rules below apply to it: a required slot becomes `missing`, an
 * optional one declared before a supplied optional becomes an R1 hole, and a
 * trailing optional is just not supplied. */
function isOmitted(a: WrittenArgument): boolean {
  return a.fillIndex < 0;
}

/** The written arguments that supply an operand, in written order: `args`
 * minus the omitted ones. This is the list `permutation` indexes into, and the
 * one the overload machinery boxes and resolves against. */
function fillingArguments(split: NamedArgumentSplit): WrittenArgument[] {
  return split.args.filter((a) => !isOmitted(a));
}

export type NamedArgumentSplit = {
  args: WrittenArgument[];
  /** True when a carrier's name operand was not a string — malformed MathJSON
   * that no signature can be matched against. Normalization declines, and the
   * carrier's own `canonical` handler reports `argument-names-unavailable`. */
  malformed: boolean;
};

export type NamedArgumentNormalization =
  /** No names could be checked (no usable declaration). The carriers are left
   * in place; each reports `argument-names-unavailable` when it canonicalizes.
   */
  | { kind: 'unavailable' }
  /** The written arguments, permuted into declaration order. */
  | { kind: 'ok'; ops: ExpressionInput[] }
  /** Sub-ruling R5 enforcement: the names determined ONE clause of a
   * multi-clause callee, and the ordinary call would not land on it — the
   * emitted expression applies that clause's function literal directly instead
   * of re-entering the callee's dispatch. */
  | { kind: 'apply'; literal: Expression; ops: ExpressionInput[] }
  /** A diagnostic. `ops` is an operand list embedding one or more `Error`
   * expressions, to be used as the operands of the call being canonicalized so
   * the error surfaces where the offending argument was written. */
  | { kind: 'error'; ops: ExpressionInput[] };

/** The result of matching a written argument list against ONE signature — an
 * overload set's arm, or the whole callee when it has a single signature.
 *
 * The `permutation` maps each SOURCE slot (the position of the argument in
 * {@link fillingArguments}) to the declaration slot it fills. It is always a
 * bijection over `[0, n)`: every argument that supplies a value fills exactly
 * one slot, a required slot left unfilled is a `missing` error, and an
 * optional HOLE is rejected outright (sub-ruling R1), so the filled slots are
 * exactly `0…n-1`. */
type ArmNormalization =
  | { kind: 'ok'; ops: ExpressionInput[]; permutation: number[] }
  | { kind: 'error'; ops: ExpressionInput[] };

/** True when the raw (unboxed) operand is a `NamedArgument` carrier. A purely
 * SYNTACTIC head check over every input spelling — an already-boxed
 * expression, MathJSON array, or MathJSON function object — because it runs
 * before any operand is boxed. Same shape as `isSpreadOperand` (box.ts): the
 * boxed case is tested by class, not by duck-typing an `operator` property. */
function isCarrier(x: ExpressionInput): boolean {
  if (x instanceof _BoxedExpression) return x.operator === CARRIER;
  if (typeof x !== 'object' || x === null) return false;
  if (Array.isArray(x)) return x[0] === CARRIER;
  if ('fn' in x) return (x as { fn: ReadonlyArray<unknown> }).fn[0] === CARRIER;
  return false;
}

/** True when the raw (unboxed) operand is a `Spread` (`f(...t)`). The same
 * check `isSpreadOperand` (box.ts) makes, repeated here because normalization
 * runs BEFORE every one of the gates that bail on a spread. */
function isSpread(x: ExpressionInput): boolean {
  if (x instanceof _BoxedExpression) return x.operator === 'Spread';
  if (typeof x !== 'object' || x === null) return false;
  if (Array.isArray(x)) return x[0] === 'Spread';
  if ('fn' in x)
    return (x as { fn: ReadonlyArray<unknown> }).fn[0] === 'Spread';
  return false;
}

/** True when the raw (unboxed) operand is the symbol `Nothing`, in any input
 * spelling: a boxed symbol, the MathJSON string `"Nothing"`, or the explicit
 * `{ sym: 'Nothing' }` object form. */
function isNothing(x: ExpressionInput): boolean {
  if (x instanceof _BoxedExpression) return x.symbol === 'Nothing';
  if (typeof x === 'string') return x === 'Nothing';
  if (typeof x !== 'object' || x === null) return false;
  if ('sym' in x) return (x as { sym: unknown }).sym === 'Nothing';
  return false;
}

/** True when any operand is a `NamedArgument` carrier: the zero-allocation
 * guard at the top of `makeCanonicalFunction`, so an all-positional call pays
 * one head comparison per operand and nothing else. */
export function hasNamedArguments(
  ops: ReadonlyArray<ExpressionInput>
): boolean {
  return ops.some(isCarrier);
}

/**
 * The operand list to emit for a call to an operator that REQUIRES named
 * arguments (`namedArgumentsRequired`) when some argument was written
 * positionally — or `undefined` when every argument carries its name and the
 * call may proceed.
 *
 * The `argument-names-required` diagnostic replaces the FIRST positional
 * argument, the earliest place an author can act on it, and it lists the
 * declared names in order, which is the whole fix: someone looking at
 * `Person("Alan", "Turing", 42)` can read off what to write. Names also make
 * the call order-free, so the list is a menu, not a sequence to match.
 *
 * Every OTHER carrier is unwrapped to the value it carries — the same rule
 * {@link blame} follows. Left in place each would canonicalize into an
 * `argument-names-unavailable` error of its own and bury the real diagnostic
 * under advice ("call it with positional arguments") that is the exact
 * opposite of what this callee wants.
 */
export function namesRequiredOperands(
  ce: ComputeEngine,
  ops: ReadonlyArray<ExpressionInput>,
  signature: Type | undefined
): ExpressionInput[] | undefined {
  let first = -1;
  for (let i = 0; i < ops.length; i++)
    if (!isCarrier(ops[i])) {
      first = i;
      break;
    }
  if (first < 0) return undefined;

  const names =
    signature !== undefined &&
    typeof signature === 'object' &&
    signature.kind === 'signature'
      ? (slotNames(signature).filter((n) => n !== undefined) as string[])
      : [];
  const detail =
    names.length > 0
      ? `write each argument with its name: ${quoteList(names)}`
      : 'write each argument with its parameter name';

  const values: ExpressionInput[] = hasNamedArguments(ops)
    ? splitNamedArguments(ops).args.map((a) => a.value)
    : [...ops];
  values[first] = ce.error(['argument-names-required', detail]);
  return values;
}

/** The operand list of a raw (possibly unboxed) function application whose
 * operator is `op`, or `undefined` when `x` is not one — the same three input
 * spellings {@link isCarrier} distinguishes. */
function rawOperands(
  x: ExpressionInput,
  op: string
): ReadonlyArray<ExpressionInput> | undefined {
  if (x instanceof _BoxedExpression)
    return x.operator === op ? (x.ops ?? undefined) : undefined;
  if (typeof x !== 'object' || x === null) return undefined;
  if (Array.isArray(x))
    return x[0] === op ? (x.slice(1) as ExpressionInput[]) : undefined;
  if ('fn' in x) {
    const fn = (x as { fn: ReadonlyArray<unknown> }).fn;
    return fn[0] === op ? (fn.slice(1) as ExpressionInput[]) : undefined;
  }
  return undefined;
}

/** The name of a raw operand that is a SYMBOL, in any input spelling. */
function rawSymbolName(x: ExpressionInput | undefined): string | undefined {
  if (x === undefined) return undefined;
  if (x instanceof _BoxedExpression) return x.symbol ?? undefined;
  return symbol(x as MathJsonExpression) ?? undefined;
}

/** The value of a raw operand that is a STRING, in any input spelling. */
function rawStringValue(x: ExpressionInput | undefined): string | undefined {
  if (x === undefined) return undefined;
  if (x instanceof _BoxedExpression) return x.string ?? undefined;
  return stringValue(x as MathJsonExpression) ?? undefined;
}

/** The `(base, member)` names of a raw callee spelled as a
 * `Field(⟨symbol⟩, ⟨string⟩)` application — the shape a QUALIFIED protocol
 * call `P.m(…)` takes once its `MemberCall` parse canonicalizes, since
 * `Comparable.compare(x, y)` becomes `Apply(Field(Comparable, "compare"),
 * x, y)`. Purely syntactic, over the
 * same input spellings as {@link isCarrier}, because it runs before any
 * operand is boxed. Whether `base` actually names a protocol is the
 * registry's question (`qualifiedMemberRequirementShape`,
 * engine-protocols.ts), not this one's. */
export function qualifiedFieldParts(
  x: ExpressionInput | undefined
): { base: string; member: string } | undefined {
  if (x === undefined) return undefined;
  const ops = rawOperands(x, 'Field');
  if (ops === undefined || ops.length !== 2) return undefined;
  const base = rawSymbolName(ops[0]);
  const member = rawStringValue(ops[1]);
  if (base === undefined || member === undefined) return undefined;
  return { base, member };
}

/** The `(protocol, member)` names of a raw `ProtocolMember(P, m, …)` operand
 * list — the box-route spelling of a qualified protocol call, where the first
 * two operands name the protocol and the member as strings (or symbols, which
 * `protocolMemberOperandsOf` also accepts at evaluation). */
export function protocolMemberParts(
  ops: ReadonlyArray<ExpressionInput>
): { base: string; member: string } | undefined {
  const base = rawStringValue(ops[0]) ?? rawSymbolName(ops[0]);
  const member = rawStringValue(ops[1]) ?? rawSymbolName(ops[1]);
  if (base === undefined || member === undefined) return undefined;
  return { base, member };
}

/**
 * A signature carrying the parameter names of a raw INLINE `Function` literal
 * callee — what lets `((x: number) => x + 1)(x: 5)` (which canonicalizes
 * through `Apply`) take named arguments.
 *
 * The names are read SYNTACTICALLY from the literal's parameter operands (a
 * bare symbol, or a `Typed(symbol, …)` annotation), not from its type: an
 * unannotated literal's inferred signature drops parameter names
 * (`effects-inference.ts` types a bare parameter with no `name`), but for an
 * inline literal the names sit in the very expression being applied, so both
 * annotated and unannotated literals are name-addressable here. The slot
 * types are all `unknown` because normalization only permutes — it reads slot
 * NAMES and arity, never slot types; typing happens downstream when the
 * canonicalized literal is applied.
 *
 * Returns `undefined` — the caller then leaves the carriers to decline as
 * before — when `x` is not a `Function` application, or when ANY parameter is
 * something other than a bare symbol or a `Typed` annotation (a spread rest
 * parameter, say): a parameter this function cannot name might also not be
 * one-slot-per-parameter, and a wrong guess here silently binds arguments to
 * the wrong parameters. Every parameter it does accept fills exactly one
 * required slot, which is also why the synthesized signature has no optional
 * or variadic part: a literal's parameter list has no such syntax.
 */
export function inlineLiteralSignature(
  x: ExpressionInput | undefined
): Type | undefined {
  if (x === undefined) return undefined;
  const ops = rawOperands(x, 'Function');
  if (ops === undefined || ops.length === 0) return undefined;
  const args: { name: string; type: Type }[] = [];
  for (const param of ops.slice(1)) {
    const name =
      rawSymbolName(param) ?? rawSymbolName(rawOperands(param, 'Typed')?.[0]);
    if (name === undefined) return undefined;
    args.push({ name, type: 'unknown' });
  }
  return { kind: 'signature', args, result: 'unknown' };
}

/** The `[nameExpression, valueExpression]` operands of a carrier, whatever
 * spelling it arrived in. */
function carrierOperands(
  x: ExpressionInput
): [unknown, ExpressionInput] | undefined {
  if (Array.isArray(x)) return [x[1], x[2] as ExpressionInput];
  if (typeof x === 'object' && x !== null && 'fn' in x) {
    const fn = (x as { fn: ReadonlyArray<unknown> }).fn;
    return [fn[1], fn[2] as ExpressionInput];
  }
  if (typeof x === 'object' && x !== null && 'ops' in x) {
    const ops = (x as { ops: ReadonlyArray<Expression> | null }).ops;
    if (!ops) return undefined;
    return [ops[0], ops[1]];
  }
  return undefined;
}

/** The name a carrier declares, or `undefined` when it is not a string. */
function carrierName(nameOperand: unknown): string | undefined {
  if (nameOperand === undefined || nameOperand === null) return undefined;
  // An already-boxed name operand: a `BoxedString` exposes `.string`.
  if (typeof nameOperand === 'object' && 'string' in nameOperand) {
    const s = (nameOperand as { string: string | null }).string;
    return s ?? undefined;
  }
  return stringValue(nameOperand as MathJsonExpression) ?? undefined;
}

/**
 * The written argument list with the `NamedArgument` carriers unwrapped. Only
 * called for an argument list that HAS a carrier — an all-positional call does
 * exactly what it did before this feature existed, and never gets here.
 */
export function splitNamedArguments(
  ops: ReadonlyArray<ExpressionInput>
): NamedArgumentSplit {
  // No carrier scan here: every caller reaches this function only after
  // `hasNamedArguments(ops)` said yes.
  const args: WrittenArgument[] = [];
  let malformed = false;
  /** The next {@link WrittenArgument.fillIndex} to hand out. */
  let fill = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!isCarrier(op)) {
      args.push({ name: undefined, value: op, index: i, fillIndex: fill++ });
      continue;
    }
    const operands = carrierOperands(op);
    const name = operands ? carrierName(operands[0]) : undefined;
    // A carrier missing its name string or its VALUE is malformed MathJSON.
    // The value matters as much as the name: `undefined` is this module's
    // "slot not filled" sentinel, so letting one through would read as an
    // omitted argument and mint a `missing` diagnostic for an argument the
    // author did write.
    if (
      name === undefined ||
      operands === undefined ||
      operands[1] === undefined
    ) {
      malformed = true;
      args.push({ name: undefined, value: op, index: i, fillIndex: fill++ });
      continue;
    }
    // `x: Nothing` is an argument the author wrote but did not supply: it
    // stays in the list, so every check that judges the call as written sees
    // it, and takes no `fillIndex`, so it fills no slot. See {@link
    // isOmitted} for why `Nothing` cannot be passed positionally.
    args.push({
      name,
      value: operands[1],
      index: i,
      fillIndex: isNothing(operands[1]) ? -1 : fill++,
    });
  }
  return { args, malformed };
}

/** The declared name of each `args`/`optArgs` slot, `undefined` for a slot that
 * has none. A parameter WITHOUT a declared name is positional-only: most of the
 * library is in that shape, and a name can never address such a slot. */
function slotNames(sig: FunctionSignature): (string | undefined)[] {
  return [
    ...(sig.args ?? []).map((a) => a.name),
    ...(sig.optArgs ?? []).map((a) => a.name),
  ];
}

/**
 * The declared slot names of the callee `operatorName` currently resolves to,
 * or `undefined` when they are not knowable: no definition, a type that is
 * not a single signature (for an overload set the winning arm depends on the
 * arguments), or a signature with no parameter list.
 *
 * This is the error-anchoring counterpart of the normalization seam: after a
 * named call is permuted into declaration order, a diagnostic's argument
 * index counts DECLARATION slots, while the raw source still lists the
 * arguments as written. `locateError` (`src/epsil/error-location.ts`) uses
 * these names to find which written argument fills the faulted slot, so the
 * underline lands on the argument the author has to fix. A value-typed
 * callee mirrors `calleeSignatureType` (box.ts): a bare-`function` wildcard
 * declaration carries no parameters, so the assigned value's own signature
 * is the only one there is.
 */
export function calleeSlotNames(
  ce: ComputeEngine,
  operatorName: string
): readonly (string | undefined)[] | undefined {
  const def = ce.lookupDefinition(operatorName);
  if (def === undefined) return undefined;
  let type: Type | undefined;
  if (isValueDef(def))
    type = isWildcardFunctionType(def.value.type.type)
      ? def.value.value?.type.type
      : def.value.type.type;
  else if (isOperatorDef(def)) type = def.operator.signature.type;
  if (type === undefined || typeof type === 'string') return undefined;
  if (type.kind !== 'signature') return undefined;
  return slotNames(type);
}

/** The closest declared name to `spelled`, for a did-you-mean. Conservative,
 * with the same thresholds as the protocol-member suggestion
 * (`unknownMemberProblem`, engine-protocols.ts): a distance of at most 2, and
 * never on a name too short for a typo to be distinguishable from a different
 * word. */
function suggestArgumentName(
  spelled: string,
  candidates: readonly string[]
): string | undefined {
  if (spelled.length < 3) return undefined;
  const max = spelled.length >= 6 ? 2 : 1;
  let best: string | undefined = undefined;
  let bestDistance = max + 1;
  for (const candidate of candidates) {
    const d = osaDistance(spelled.toLowerCase(), candidate.toLowerCase(), max);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

function quoteList(names: readonly string[]): string {
  return names.map((n) => `\`${n}\``).join(', ');
}

/** The `argument-name-unknown` diagnostic for a name the callee does not
 * declare, listing `candidates` and pointing at the closest of them. */
function unknownNameError(
  ce: ComputeEngine,
  spelled: string,
  candidates: readonly string[]
): Expression {
  const suggestion = suggestArgumentName(spelled, candidates);
  const detail =
    (suggestion !== undefined ? `did you mean \`${suggestion}\`? ` : '') +
    (candidates.length > 0
      ? `declared parameter names: ${quoteList(candidates)}`
      : 'this function declares no parameter names');
  return ce.error(['argument-name-unknown', spelled, detail]);
}

/** The written operand list with the operand at `index` replaced by `error`,
 * and every other carrier replaced by the VALUE it carries. Unwrapping the
 * other carriers matters: left in place they would each canonicalize into an
 * `argument-names-unavailable` error of their own and bury the real
 * diagnostic. */
function blame(
  split: NamedArgumentSplit,
  index: number,
  error: Expression
): ExpressionInput[] {
  return split.args.map((a) => (a.index === index ? error : a.value));
}

/**
 * Whether an argument diagnostic with this code indexes the argument list AS
 * WRITTEN rather than in declaration order.
 *
 * The seam emits its errors in two different operand orders. A normalization
 * FAILURE — an unknown or duplicate name, a positional argument after a named
 * one, a skipped optional, names unavailable — is reported via {@link blame},
 * which replaces the offending entry of the WRITTEN list in place: the call
 * was never permuted, so an error frame's operand index counts written
 * positions. The other argument diagnostics (`missing` and the
 * variadic-tail shortfall) are appended to a slot-ordered list AFTER the
 * permutation succeeded, so their index counts declaration slots — as does
 * every downstream error (a type mismatch) in a successfully normalized
 * call. Error-anchoring (`argumentAtSlot`, `src/epsil/error-location.ts`)
 * must know which order it is reconciling: remapping a written-order index
 * through the declared slot names lands the underline on a bystander.
 */
export function errorIndexCountsWrittenArguments(code: string): boolean {
  return WRITTEN_ORDER_ARGUMENT_CODES.has(code);
}
const WRITTEN_ORDER_ARGUMENT_CODES: ReadonlySet<string> = new Set([
  'argument-name-unknown',
  'argument-name-duplicate',
  'argument-order-invalid',
  'argument-optional-skipped',
  'argument-names-unavailable',
  // Reported before any permutation is attempted (there are no names to
  // permute with), so its operand index counts written positions.
  'argument-names-required',
]);

/**
 * Permute a written argument list into the positional order the callee
 * declares, per §3–§4 of the design doc.
 *
 * `signature` is the callee's declared type: `calleeSignatureType(def.value)`
 * for a value definition, `opDef.signature.type` for an operator definition.
 * Two shapes are understood — a single signature (§3) and an OVERLOAD SET, an
 * intersection of signatures (§4, {@link normalizeAgainstArms}). Anything else
 * yields `unavailable`: a bare `function` wildcard, an unresolved forward
 * reference, a non-callable type — there are no declared names to match, which
 * is precisely the `argument-names-unavailable` case (§6).
 */
export function normalizeNamedArguments(
  ce: ComputeEngine,
  split: NamedArgumentSplit,
  signature: Type | undefined,
  /** The callee's clauses, when it is a multi-clause user function
   * (`multiClauseState(def)?.clauses`). Their function literals are what
   * sub-ruling R5 enforcement applies when the names determine a clause the
   * ordinary dispatch would not select ({@link normalizeAgainstArms}). */
  clauses?: ReadonlyArray<FunctionClause>
): NamedArgumentNormalization {
  if (split.malformed) return { kind: 'unavailable' };

  // A `Spread` operand (`f(...t, rate: 1)`) is not ONE argument: it splices
  // into an unknown number of them at EVALUATION, so which parameter each
  // written argument fills is not knowable here. Every other position-
  // sensitive gate bails when an operand is a spread (the `isSpreadOperand`
  // checks in box.ts) and this seam runs before all of them, so filling slots
  // left to right here would silently bind arguments to the wrong parameters.
  // Fail closed: the call must be written positionally.
  const spread = split.args.find((a) => isSpread(a.value));
  if (spread !== undefined) {
    const culprit = split.args.find((a) => a.name !== undefined);
    return {
      kind: 'error',
      ops: blame(
        split,
        culprit?.index ?? spread.index,
        ce.error([
          'argument-names-unavailable',
          culprit?.name ?? '',
          'a spread argument makes the argument positions unknown until evaluation; call it positionally',
        ])
      ),
    };
  }

  if (signature === undefined || typeof signature === 'string')
    return { kind: 'unavailable' };

  if (signature.kind === 'signature')
    return normalizeAgainstSignature(ce, split, signature);

  const arms = overloadArms(signature);
  if (arms === undefined || arms.length === 0) return { kind: 'unavailable' };
  return normalizeAgainstArms(ce, split, arms, clauses);
}

/**
 * The §3 algorithm against ONE signature: the whole callee when it has a single
 * signature, or one arm of an overload set.
 */
function normalizeAgainstSignature(
  ce: ComputeEngine,
  split: NamedArgumentSplit,
  sig: FunctionSignature
): ArmNormalization {
  const required = sig.args?.length ?? 0;
  const optional = sig.optArgs?.length ?? 0;
  const slots = required + optional;
  const names = slotNames(sig);
  const declaredNames = names.filter((n): n is string => n !== undefined);

  //
  // Step 1: a positional argument may not follow a named one.
  //
  let seenNamed = false;
  for (const a of split.args) {
    if (a.name !== undefined) {
      seenNamed = true;
      continue;
    }
    if (seenNamed) {
      return {
        kind: 'error',
        ops: blame(
          split,
          a.index,
          ce.error([
            'argument-order-invalid',
            'a positional argument cannot follow a named argument',
          ])
        ),
      };
    }
  }

  //
  // Step 3, first half — hoisted ABOVE the positional fill. An unknown name is
  // the more fundamental problem, and reporting it first is what makes the
  // design doc's own example true in a MIXED call: `Add` declares no parameter
  // names, so `Add(1, x: 2)` must say so rather than complain (via step 2
  // below) that its variadic tail cannot be filled positionally — a rule the
  // author could not have satisfied anyway. A name that IS declared still
  // yields the step-2 diagnostic, which is the right one there.
  //
  for (const a of split.args) {
    if (a.name === undefined || names.includes(a.name)) continue;
    return {
      kind: 'error',
      ops: blame(split, a.index, unknownNameError(ce, a.name, declaredNames)),
    };
  }

  const filled: (ExpressionInput | undefined)[] = new Array(slots).fill(
    undefined
  );
  /** The written argument that CLAIMED each slot, for the duplicate message,
   * `undefined` for a slot no argument has claimed yet. An omitted argument
   * (`x: Nothing`) claims its slot without filling it, so writing the same
   * name twice is a duplicate whichever of the two supplies a value. */
  const filledBy: ('position' | string | undefined)[] = new Array(slots).fill(
    undefined
  );
  /** Source slot → declaration slot, filled in as each written argument finds
   * its parameter. Only meaningful once every step below has succeeded. */
  const permutation: number[] = new Array(fillingArguments(split).length).fill(
    -1
  );

  //
  // Step 2: the positional prefix fills slots left to right, in `paramAt`
  // order (required, then optional, then the variadic tail). Because at least
  // one argument is named, the prefix must not reach the variadic tail: a
  // named call supplies no tail (C5), so there is no way to say where the
  // prefix stops and the tail begins.
  //
  let next = 0;
  for (let j = 0; j < split.args.length; j++) {
    const a = split.args[j];
    if (a.name !== undefined) break;
    if (next >= slots) {
      return {
        kind: 'error',
        ops: blame(
          split,
          a.index,
          ce.error([
            'unexpected-argument',
            sig.variadicArg !== undefined
              ? 'a call that names any argument cannot also fill the variadic tail positionally'
              : `this function accepts at most ${slots} argument${slots === 1 ? '' : 's'}`,
          ])
        ),
      };
    }
    filled[next] = a.value;
    filledBy[next] = 'position';
    permutation[a.fillIndex] = next;
    next += 1;
  }

  //
  // Step 3, second half: each named argument takes the slot its name declares,
  // across `args` then `optArgs`. Name uniqueness within one signature is not
  // enforced anywhere in the type system, so a duplicated DECLARED name
  // matches its FIRST slot. Every name is known by now (hoisted check above),
  // so all that is left is the collision with an already-claimed slot.
  //
  for (const a of split.args) {
    if (a.name === undefined) continue;
    const slot = names.indexOf(a.name);
    if (filledBy[slot] !== undefined) {
      return {
        kind: 'error',
        ops: blame(
          split,
          a.index,
          ce.error([
            'argument-name-duplicate',
            a.name,
            filledBy[slot] === 'position'
              ? 'that parameter is already filled by a positional argument'
              : 'that parameter is already filled by an earlier named argument',
          ])
        ),
      };
    }
    filledBy[slot] = a.name;
    // An OMITTED argument (`x: Nothing`) has claimed its slot — so writing the
    // name again is still a duplicate — but supplies no value, leaving the
    // slot to the ordinary rules below ({@link isOmitted}).
    if (isOmitted(a)) continue;
    filled[slot] = a.value;
    permutation[a.fillIndex] = slot;
  }

  //
  // Step 4: saturation (C5). A named call is never a partial application — an
  // unfilled required parameter is an error stamped here, so the call never
  // reaches the currying site. This also stands in for `validateArguments` on
  // the routes that skip it (an inferred-signature callee).
  //
  const missing: number[] = [];
  for (let i = 0; i < required; i++)
    if (filled[i] === undefined) missing.push(i);

  if (missing.length > 0) {
    // Blamed at the slot, in DECLARATION order: the call is well-formed as
    // written, so there is no written argument to underline — what is missing
    // is a parameter, and the operand list shows where.
    const ops: ExpressionInput[] = [];
    const upTo = Math.max(required, lastFilled(filled) + 1);
    for (let i = 0; i < upTo; i++) {
      const value = filled[i];
      if (value !== undefined) ops.push(value);
      else
        ops.push(
          ce.error([
            'missing',
            names[i] !== undefined
              ? `no value for parameter \`${names[i]}\``
              : `no value for argument ${i + 1}`,
          ])
        );
    }
    return { kind: 'error', ops };
  }

  //
  // Step 5: no optional holes (sub-ruling R1). A named optional may be
  // supplied only if every optional declared before it is also supplied. The
  // engine has no absent-argument placeholder that survives canonicalization
  // (`flatten` DROPS `Nothing`), so a hole would silently shift every later
  // argument one slot left — the exact failure class named arguments exist to
  // prevent.
  //
  // Ahead of the unsatisfiable-`+`-tail branch below: a call that both leaves
  // a hole and fails to fill a `+` tail has two problems, and the hole is the
  // more specific one — it names the parameter the author skipped, while the
  // tail message says only that the tail is empty.
  //
  const last = lastFilled(filled);
  const holes: string[] = [];
  for (let i = required; i < last; i++)
    if (filled[i] === undefined)
      holes.push(names[i] !== undefined ? `\`${names[i]}\`` : `${i + 1}`);

  if (holes.length > 0) {
    const culprit = split.args.find(
      (a) => a.name !== undefined && names.indexOf(a.name) === last
    );
    return {
      kind: 'error',
      ops: blame(
        split,
        culprit?.index ?? split.args[split.args.length - 1].index,
        ce.error([
          'argument-optional-skipped',
          names[last] ?? `${last + 1}`,
          `every optional parameter declared before it must also be supplied; ${holes.join(', ')} ${holes.length === 1 ? 'is' : 'are'} not`,
        ])
      ),
    };
  }

  if (sig.variadicArg !== undefined && (sig.variadicMin ?? 0) >= 1) {
    // The tail is empty by construction (step 2 rejects a positional argument
    // that reaches it), so a `+` tail can never be satisfied by a named call.
    const ops: ExpressionInput[] = [];
    for (let i = 0; i <= last; i++) {
      // Every slot up to `last` is filled by now — the required ones by step 4
      // and the optional ones by the hole check above — but the fallback is
      // kept so that a slot left unfilled by some future path becomes a
      // `missing` diagnostic instead of a raw `undefined` operand, which
      // `box()` would turn into an unattributed generic `missing`.
      const value = filled[i];
      if (value !== undefined) ops.push(value);
      else
        ops.push(
          ce.error([
            'missing',
            names[i] !== undefined
              ? `no value for parameter \`${names[i]}\``
              : `no value for argument ${i + 1}`,
          ])
        );
    }
    ops.push(
      ce.error([
        'missing',
        `no value for the \`${sig.variadicArg.name ?? 'variadic'}\` argument, which requires at least one`,
      ])
    );
    return { kind: 'error', ops };
  }

  //
  // Step 6: emit the reordered operands. Trailing unsupplied optionals are
  // simply absent, exactly as in a positional call that stops short.
  //
  const ops: ExpressionInput[] = [];
  for (let i = 0; i <= last; i++) ops.push(filled[i]!);
  return { kind: 'ok', ops, permutation };
}

/** The highest filled slot index, or -1 when nothing is filled. */
function lastFilled(filled: readonly (ExpressionInput | undefined)[]): number {
  for (let i = filled.length - 1; i >= 0; i--)
    if (filled[i] !== undefined) return i;
  return -1;
}

//
// ── Overload sets: per-arm permutation (§4) ──────────────────────────────────
//

/** The written arguments reordered by `permutation` (source slot →
 * declaration slot). The permutation is a bijection over
 * {@link fillingArguments}, so no slot is left unwritten. */
function applyPermutation(
  split: NamedArgumentSplit,
  permutation: ReadonlyArray<number>
): ExpressionInput[] {
  const filling = fillingArguments(split);
  const ops = new Array<ExpressionInput>(permutation.length);
  for (let j = 0; j < permutation.length; j++)
    ops[permutation[j]] = filling[j].value;
  return ops;
}

/** Do two arms consume the written arguments in the same order? */
function sameOrder(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>
): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** How many of the call's names this arm does not declare — the plausibility
 * score used to pick whose diagnostic to report when no arm fits. */
function unknownNameCount(
  split: NamedArgumentSplit,
  sig: FunctionSignature
): number {
  const names = slotNames(sig);
  let n = 0;
  for (const a of split.args)
    if (a.name !== undefined && !names.includes(a.name)) n += 1;
  return n;
}

/**
 * Match a named call against an OVERLOAD SET (§4 of the design doc).
 *
 * An overload set cannot be permuted up front, because its arms may name the
 * same position differently — the shipped multi-clause functions already do
 * (`fib`'s clauses type as `((z: 0) -> …) & ((o: 1) -> …) & ((n: integer) ->
 * …)`). So the §3 algorithm runs against each arm separately and the names
 * themselves filter arms, before any type is consulted:
 *
 * 1. Every arm survives the names and they all agree on the ORDER — the
 *    operand list is the same whichever of them wins, so emit it and let
 *    ordinary positional resolution choose the arm downstream, exactly as for
 *    a positional call. This is the zero-extra-work path.
 * 2. Some arm is ELIMINATED by the names, or the survivors disagree about the
 *    order — then operand types are consulted, and sub-ruling R5 applies: the
 *    surviving arms are the only candidates, statically AND at runtime.
 *
 * **Sub-ruling R5 — names eliminate branches, persistently.** What the seam
 * normally emits is an operand array, never an arm selection, and everything
 * below it (`validateArguments`, and the runtime clause dispatch of a
 * multi-clause function) resolves that array again with no names left to
 * eliminate anything. That re-resolution may land on an arm the names ruled
 * out — a more specific value clause, or an arm that reads the same operands
 * in the other order. So the emitted call is checked against both
 * re-resolutions ({@link plainCallIsFaithful}) and, when it would diverge,
 * the winning CLAUSE's function literal is applied directly instead of the
 * callee (`kind: 'apply'`), which is what makes the elimination semantic. A
 * callee with no clause literals to apply (an overload set that is only
 * declared) cannot be pinned that way, so a divergence there is an error
 * steering the author to a positional call.
 */
function normalizeAgainstArms(
  ce: ComputeEngine,
  split: NamedArgumentSplit,
  arms: ReadonlyArray<FunctionSignature>,
  clauses: ReadonlyArray<FunctionClause> | undefined
): NamedArgumentNormalization {
  const perArm = arms.map((arm) => normalizeAgainstSignature(ce, split, arm));
  const permutations = perArm.map((r) =>
    r.kind === 'ok' ? r.permutation : undefined
  );
  const admissible = perArm.filter(
    (r): r is Extract<ArmNormalization, { kind: 'ok' }> => r.kind === 'ok'
  );

  if (admissible.length === 0)
    return { kind: 'error', ops: blameNoArm(ce, split, arms, perArm) };

  const agree = admissible.every((r) =>
    sameOrder(r.permutation, admissible[0].permutation)
  );
  /** Did the names rule out an arm? Then R5's enforcement work is owed. */
  const eliminated = admissible.length < arms.length;

  if (agree && !eliminated) return { kind: 'ok', ops: admissible[0].ops };

  // Past this point the call pays for boxing the arguments: the types are what
  // decide which arm the names left, and in which order it reads them. These
  // boxed operands are used for resolution alone — the operand list handed
  // back is the RAW one, so the ordinary path below the seam boxes each
  // argument in its own context (contextual callback annotation, the binder
  // pre-phase) as it always does.
  const ops = fillingArguments(split).map((a) => ce.expr(a.value));

  let winner: number[];
  if (agree) {
    winner = admissible[0].permutation;
  } else {
    // The surviving arms read the call in different orders, so which order it
    // means is a typing question. `resolveOverload` admits and ranks each
    // survivor on its OWN permutation (an arm with no permutation was
    // name-eliminated and is not a candidate).
    const resolved = resolveOverload(ce, ops, arms, undefined, permutations);
    if (resolved.permutationAmbiguous)
      return orderUndetermined(ce, split, ambiguousOrderDetail);
    // No surviving arm admits the call's types. The refusal is reported below
    // when it is PROVABLE (R5: the names picked those arms, so their refusal is
    // the call's answer); otherwise emit the first survivor's order and let
    // `validateArguments` own the no-matching-overload diagnosis, as before.
    winner = resolved.selectedPermutation ?? admissible[0].permutation;
  }

  const emitted = applyPermutation(split, winner);
  const reordered = new Array<Expression>(ops.length);
  for (let j = 0; j < ops.length; j++) reordered[winner[j]] = ops[j];

  // Which arm do the SURVIVORS give the call, by the same tri-state procedure
  // the runtime clause dispatch uses?
  const survivorPick = triStateSelect(ops, arms, permutations);

  // Every surviving arm refutes the call. Under R5 that verdict is the call's:
  // the names chose these arms, and a type they refuse may not be quietly
  // handed to an arm the names ruled out (the arm-substitution bug). Reported
  // here because `validateArguments` below the seam has no names left to know
  // which arms were eliminated.
  if (eliminated && survivorPick.kind === 'none')
    return {
      kind: 'error',
      ops: blameRefusedBySurvivors(ce, reordered, arms, permutations, winner),
    };

  const clauseLiterals = alignedClauseLiterals(arms, clauses);

  if (
    plainCallIsFaithful(
      ce,
      reordered,
      arms,
      permutations,
      winner,
      clauseLiterals !== undefined
    )
  )
    return { kind: 'ok', ops: emitted };

  // The plain call would not land where the names point. Pin it to the clause
  // the names determined, when there is a literal to pin it to — and when that
  // clause reads the operands in the order they are emitted in. (The two
  // procedures can disagree: `survivorPick` admits values, the ranking above
  // admits types, so the clause the values select may not be the arm whose
  // order `emitted` is in. Applying a literal to the other arm's order would
  // bind each argument to the wrong parameter — the failure this whole feature
  // exists to prevent — so that case declines instead.)
  if (
    clauseLiterals !== undefined &&
    survivorPick.kind === 'selected' &&
    sameOrder(permutations[survivorPick.index]!, winner)
  )
    return {
      kind: 'apply',
      literal: clauseLiterals[survivorPick.index],
      ops: emitted,
    };

  return orderUndetermined(
    ce,
    split,
    eliminated ? eliminatedBranchDetail : ambiguousOrderDetail
  );
}

const ambiguousOrderDetail =
  'these names do not determine which parameter each argument fills: several overloads of this function accept the call and they disagree about the order; call it with positional arguments';

const eliminatedBranchDetail =
  'these names select an overload that the same arguments would not select positionally, and this function has no single implementation the call can be pinned to; call it with positional arguments';

/** The `argument-names-unavailable` decline, blamed on the first named
 * argument — the call is well-formed, so what is at fault is the naming, not
 * one particular value. */
function orderUndetermined(
  ce: ComputeEngine,
  split: NamedArgumentSplit,
  detail: string
): NamedArgumentNormalization {
  const culprit = split.args.find((a) => a.name !== undefined)!;
  return {
    kind: 'error',
    ops: blame(
      split,
      culprit.index,
      ce.error(['argument-names-unavailable', culprit.name!, detail])
    ),
  };
}

/**
 * Would the ordinary positional call — the operand array this seam emits,
 * resolved again with no names left to eliminate anything — still honor the
 * names?
 *
 * Two re-resolutions run below the seam and neither may reach an arm the names
 * ruled out:
 *
 * - `validateArguments` and result typing pick an arm with `resolveOverload`.
 *   The arm it picks must be one the names left AND must read the operands in
 *   the winning order. (Which of several surviving arms it picks does not
 *   matter: within the surviving set, resolution proceeds exactly as it does
 *   for a positional call — that is R5's third clause.)
 * - a multi-clause callee dispatches again at runtime, over ALL its clauses,
 *   with `triStateSelect` on the EVALUATED operands. Two facts about an
 *   eliminated arm `E` put it out of reach whatever those values turn out to
 *   be, because both are stable under evaluation (evaluation only narrows an
 *   operand's type): `E` is REFUTED here, or a surviving arm that this call
 *   definitely admits is strictly more specific than `E` — dispatch takes the
 *   most specific admitted arm, so `E` can never be the one.
 */
function plainCallIsFaithful(
  ce: ComputeEngine,
  reordered: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>,
  permutations: ReadonlyArray<number[] | undefined>,
  winner: ReadonlyArray<number>,
  dispatches: boolean
): boolean {
  const selected = resolveOverload(ce, reordered, arms).selected;
  if (selected !== undefined) {
    const order = permutations[arms.indexOf(selected)];
    if (order === undefined || !sameOrder(order, winner)) return false;
  }

  if (!dispatches) return true;

  /** The surviving arms this call definitely admits, read in the emitted
   * order — the arms that beat a less specific one at every dispatch. */
  const admitted = arms.filter(
    (arm, k) =>
      permutations[k] !== undefined &&
      sameOrder(permutations[k]!, winner) &&
      armAdmission(reordered, arm) === 'admit'
  );

  return arms.every((arm, k) => {
    if (permutations[k] !== undefined) return true; // a survivor
    if (armAdmission(reordered, arm) === 'refute') return true;
    return admitted.some((s) => isMoreSpecific(s, arm, reordered.length));
  });
}

/** The clause function literals of a multi-clause callee, index-aligned with
 * `arms`, or `undefined` when there are none to apply or the alignment cannot
 * be established.
 *
 * A clause list installs the intersection of the CLAUSE signatures as the
 * definition's signature, so `arms[k]` is clause `k` — except when the symbol
 * was declared before it was defined, where the author's declared signature is
 * the definition's instead and its arms are unrelated to the clause list. The
 * parameter names are what the elimination keys on, so they are what the
 * alignment is checked with. */
function alignedClauseLiterals(
  arms: ReadonlyArray<FunctionSignature>,
  clauses: ReadonlyArray<FunctionClause> | undefined
): Expression[] | undefined {
  if (clauses === undefined || clauses.length !== arms.length) return undefined;
  for (let k = 0; k < arms.length; k++) {
    const a = slotNames(arms[k]);
    const b = slotNames(clauses[k].signature);
    if (a.length !== b.length || a.some((n, i) => n !== b[i])) return undefined;
  }
  return clauses.map((c) => c.literal);
}

/** The diagnostic for a call every SURVIVING arm refuses on types (R5): the
 * operands the survivors reject, marked where they were rejected. The same
 * blame `validateArguments` computes, restricted to the arms the names left —
 * and computed here because the names are gone below the seam.
 *
 * Only the survivors that read the operands in the winner's order can be
 * diagnosed against one operand array; a survivor with another permutation
 * has a different array and is left out (it refutes the call too, so no arm
 * is exonerated by the omission). */
function blameRefusedBySurvivors(
  ce: ComputeEngine,
  reordered: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>,
  permutations: ReadonlyArray<number[] | undefined>,
  winner: ReadonlyArray<number>
): ExpressionInput[] {
  const survivors = arms.filter((_, k) => {
    const order = permutations[k];
    return order !== undefined && sameOrder(order, winner);
  });
  const { refuted } = diagnoseNoMatch(ce, reordered, survivors);
  const blamed = reordered.map((op, i) => {
    const expected = refuted.get(i);
    return expected === undefined ? op : ce.typeError(expected, op.type, op);
  });
  // A refusal must never come back fully valid: the same backstop
  // `validateArguments` keeps for a `refuted` map that came back empty (an arm
  // refused on arity alone, say).
  if (blamed.every((x) => x.isValid))
    blamed[0] = ce.error('unexpected-argument', reordered[0]?.toString() ?? '');
  return blamed;
}

/**
 * The diagnostic for a named call that no arm of an overload set admits.
 *
 * A name that NO arm declares is unambiguously the problem, and it is the only
 * case where the message may list the union of every arm's parameter names
 * without contradicting itself. Otherwise every written name is declared
 * somewhere and the arms failed for other reasons (a duplicate, an unfilled
 * required parameter, an optional hole, or names that no single arm has all
 * of): report the most plausible arm's own diagnostic — the one that knows the
 * most of the call's names, declaration order breaking the tie.
 */
function blameNoArm(
  ce: ComputeEngine,
  split: NamedArgumentSplit,
  arms: ReadonlyArray<FunctionSignature>,
  perArm: ReadonlyArray<ArmNormalization>
): ExpressionInput[] {
  const declared = [
    ...new Set(
      arms.flatMap((arm) => slotNames(arm).filter((n) => n !== undefined))
    ),
  ] as string[];

  const orphan = split.args.find(
    (a) => a.name !== undefined && !declared.includes(a.name)
  );
  if (orphan !== undefined)
    return blame(
      split,
      orphan.index,
      unknownNameError(ce, orphan.name!, declared)
    );

  let best = 0;
  let fewest = Infinity;
  for (let k = 0; k < arms.length; k++) {
    const n = unknownNameCount(split, arms[k]);
    if (n < fewest) {
      fewest = n;
      best = k;
    }
  }
  return (perArm[best] as Extract<ArmNormalization, { kind: 'error' }>).ops;
}
