import type { FunctionSignature, Type } from '../../common/type/types.js';
import { osaDistance } from '../../common/fuzzy-string-match.js';
import { stringValue } from '../../math-json/utils.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type {
  Expression,
  ExpressionInput,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { overloadArms, resolveOverload } from './overload.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';

/**
 * Named-argument calls: `f(rate: 0.05, years: 3)`.
 *
 * The surface syntax emits one `["NamedArgument", "'name'", value]` carrier per
 * named argument (Epsil `Parser.parseCall`; the same shape can be written by
 * hand on the `ce.box()` route). This module turns a written argument list
 * containing carriers into the positional argument list the callee's signature
 * declares — or into a diagnostic.
 *
 * Design: `docs/plans/2026-08-12-named-arguments-design.md` §2–§3, implementing
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
  signature: Type | undefined
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
  return normalizeAgainstArms(ce, split, arms);
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
 * 1. One name-admissible arm — the answer, with no type work at all.
 * 2. Several arms that agree on the ORDER — the operand list is the same
 *    whichever of them wins, so emit it and let ordinary positional overload
 *    resolution choose the arm downstream, exactly as for a positional call.
 * 3. Several arms that DISAGREE on the order — only then are operand types
 *    consulted: `resolveOverload` admits and ranks each arm on its OWN
 *    permutation of the call, and the winner's order is emitted. Ranking that
 *    leaves the order undecided is sub-ruling R3, an error.
 *
 * "Normalize after win" — what is emitted is an operand array, never an arm
 * selection. The downstream machinery (`validateArguments`, and the runtime
 * clause dispatch of a multi-clause function) resolves the call again on those
 * operands as an ordinary positional call, which is what keeps static and
 * runtime selection sharing one decision procedure.
 */
function normalizeAgainstArms(
  ce: ComputeEngine,
  split: NamedArgumentSplit,
  arms: ReadonlyArray<FunctionSignature>
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

  if (
    admissible.every((r) => sameOrder(r.permutation, admissible[0].permutation))
  )
    return { kind: 'ok', ops: admissible[0].ops };

  // Only the disagreeing case pays for boxing the arguments: the types are
  // what decide which order the call means. These boxed operands are used for
  // resolution alone — the operand list handed back is the RAW one, so the
  // ordinary path below the seam boxes each argument in its own context
  // (contextual callback annotation, the binder pre-phase) as it always does.
  const ops = fillingArguments(split).map((a) => ce.expr(a.value));
  const resolved = resolveOverload(ce, ops, arms, undefined, permutations);

  const winner = resolved.selectedPermutation;
  // No arm survives TYPE admission. Emit the first name-admissible arm's order
  // and let `validateArguments` report the type error on those operands: it
  // owns the no-matching-overload diagnosis, and duplicating it here would
  // give the same call two opinions.
  if (winner === undefined) return { kind: 'ok', ops: admissible[0].ops };

  if (
    resolved.permutationAmbiguous ||
    !orderSurvivesReordering(ce, ops, arms, permutations, winner)
  ) {
    const culprit = split.args.find((a) => a.name !== undefined)!;
    return {
      kind: 'error',
      ops: blame(
        split,
        culprit.index,
        ce.error([
          'argument-names-unavailable',
          culprit.name!,
          'these names do not determine which parameter each argument fills: several overloads of this function accept the call and they disagree about the order; call it with positional arguments',
        ])
      ),
    };
  }

  return { kind: 'ok', ops: applyPermutation(split, winner) };
}

/**
 * Would the reordered call still bind each argument to the parameter its name
 * asked for?
 *
 * What a named call emits is an operand ARRAY, never an arm selection: below
 * the seam the call is an ordinary positional one and is resolved again, by
 * `validateArguments` statically and by the clause selector at runtime. When
 * two arms take the same parameter TYPES in a different order — the swapped-
 * names shape — that second resolution can land on an arm that reads the very
 * same operands in the OTHER order, silently binding each argument to the
 * parameter the author did not name. That is the wrong-values failure the
 * whole feature exists to prevent, so it is rejected rather than emitted.
 *
 * The test is on the ORDER, not on the arm: an arm that binds the same names
 * to the same slots is interchangeable here, whatever else distinguishes it.
 * `undefined` from the re-resolution is fine — no arm accepts the reordered
 * call, so `validateArguments` will report the type error on those operands.
 *
 * Only the disagreeing-permutation branch of {@link normalizeAgainstArms} runs
 * this: when every surviving arm consumes the arguments in the same order there
 * is no other order to be confused with.
 */
function orderSurvivesReordering(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>,
  permutations: ReadonlyArray<number[] | undefined>,
  winner: ReadonlyArray<number>
): boolean {
  const reordered = new Array<Expression>(ops.length);
  for (let j = 0; j < ops.length; j++) reordered[winner[j]] = ops[j];
  const selected = resolveOverload(ce, reordered, arms).selected;
  if (selected === undefined) return true;
  const order = permutations[arms.indexOf(selected)];
  return order !== undefined && sameOrder(order, winner);
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
