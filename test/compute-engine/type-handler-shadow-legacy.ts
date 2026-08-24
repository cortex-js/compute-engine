/**
 * @fixme TEMPORARY MIGRATION FIXTURE — this whole file MUST be deleted
 * when the expressions-shape `type` handler is retired; the shadow
 * registry's doc comment (`_legacyTypeHandlerShadow`,
 * `boxed-expression/operand-descriptor.ts`) lists every piece that goes
 * with it. Individual `LEGACY_TYPE_HANDLERS` entries retire earlier, once
 * their batch has shipped in a release.
 *
 * The LEGACY expressions-shape `type` handlers of operators that have been
 * converted to the `'types'` shape — moved here verbatim when each operator
 * converts, so the shadow-parity mechanism
 * (`checkShadowTypeParity`, `boxed-expression/operand-descriptor.ts`) can
 * run both shapes and throw on divergence. This file is a fixture, not a
 * test suite (jest only matches `*.test.ts`).
 *
 * Conversion protocol: when converting an operator in `library/*.ts`, copy
 * its old handler here unchanged — same reads, same branches — keyed by the
 * operator name, and let the parity suite (and any full run with the shadow
 * installed) prove the equivalence. Once a batch has been proven and
 * shipped for a release, its entries can be deleted.
 */

import type { Type } from '../../src/common/type/types';
import type { OperatorTypeHandlerOnExpressions } from '../../src/compute-engine/global-types';
import { _legacyTypeHandlerShadow } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import {
  functionResult,
  stripMissingFromType,
  widen,
} from '../../src/common/type/utils';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

export const LEGACY_TYPE_HANDLERS: Record<
  string,
  OperatorTypeHandlerOnExpressions
> = {
  // From library/core.ts, pre-conversion (commit bca1105e).
  Coalesce: (ops) => {
    if (ops.length === 0) return 'nothing';
    const arms = ops.map((op, i) =>
      i < ops.length - 1 ? stripMissingFromType(op.type.type) : op.type.type
    );
    return widen(...arms) as Type;
  },

  Hold: ([x]) => {
    if (isSymbol(x)) return 'symbol';
    if (isString(x)) return 'string';
    if (isNumber(x)) return x.type;
    if (isFunction(x)) return functionResult(x.type.type) ?? 'unknown';
    return 'unknown';
  },

  ReleaseHold: ([x]) => (isFunction(x, 'Hold') ? x.op1.type : x.type),

  // From library/number-theory.ts, pre-conversion (commit a1587fbe).
  DigitCount: ([, , digit]) =>
    digit !== undefined ? 'finite_integer' : 'list',

  // `Binomial`/`Choose`/`Pochhammer` are deliberately NOT here: they stay
  // on the expressions shape until the audited sign channel for function
  // expressions lands (open item O7 of the plan doc) — their negative/
  // non-negative gates can be proven by operator `sgn` handlers on compound
  // operands, a channel descriptors do not carry, and converting would
  // narrow their pole claims. See the note on `binomialType` in
  // `library/combinatorics.ts`.

  // From library/control-structures.ts, pre-conversion (commit a1587fbe).
  Block: (args) => {
    if (args.length === 0) return 'nothing';
    return args[args.length - 1].type;
  },
  When: ([expr, cond]) => {
    if (cond?.type.matches(parseType('list<boolean>')!))
      return `list<${typeToString(expr.type.type)}>`;
    return expr.type;
  },
};

/**
 * Operators whose constant `type` handler (`type: () => 'finite_integer'`-
 * style, reading nothing from its operands) was RETIRED outright: the
 * constant result moved into the declared signature
 * (`(integer) -> finite_integer`) and the handler was deleted. This is
 * the strongest form of the migration — no handler at all cannot touch
 * engine state — and it is behavior-preserving because the no-handler
 * fallback narrowing at the type-derivation call site activates only for
 * a declared result of bare `number` or `finite_number`, never for these
 * spellings. Each entry records the declared result the signature must
 * keep claiming; a suite pin asserts the definition has NO `type` handler
 * and its signature result matches.
 */
export const RETIRED_CONSTANT_TYPE_HANDLERS: ReadonlyArray<
  [operator: string, declaredResult: string]
> = [
  // library/number-theory.ts
  ['NthPrime', 'finite_integer'],
  ['NextPrime', 'finite_integer'],
  ['PrimeNu', 'finite_integer'],
  ['PrimeOmega', 'finite_integer'],
  ['MoebiusMu', 'finite_integer'],
  ['Radical', 'finite_integer'],
  ['PowerMod', 'finite_integer'],
  ['ModularInverse', 'finite_integer'],
  ['IntegerSqrt', 'finite_integer'],
  ['CarmichaelLambda', 'finite_integer'],
  ['LucasL', 'finite_integer'],
  ['CatalanNumber', 'finite_integer'],
  ['RandomPrime', 'finite_integer'],
  ['PrimePi', 'finite_integer'],
  ['BernoulliB', 'finite_rational'],
  ['FromDigits', 'finite_integer'],
  ['DigitSum', 'finite_integer'],
  ['DivisorSigma', 'finite_integer'],
  ['JacobiSymbol', 'finite_integer'],
  ['LegendreSymbol', 'finite_integer'],
  ['MultiplicativeOrder', 'finite_integer'],
  ['PrimitiveRoot', 'finite_integer'],
  ['Totient', 'finite_integer'],
  ['Sigma0', 'finite_integer'],
  ['Sigma1', 'finite_integer'],
  ['SigmaMinus1', 'finite_rational'],
  ['Eulerian', 'finite_integer'],
  ['Stirling', 'finite_integer'],
  ['StirlingS1', 'finite_integer'],
  ['NPartition', 'finite_integer'],
  // `GammaRegularized`/`BetaRegularized` are deliberately NOT here: their
  // old constant `finite_real` claim was unsound off the proven domain
  // (`GammaRegularized(-1, 2)` is NaN), so instead of retiring the claim
  // into the signature they got domain-gated `'types'` handlers — a
  // deliberate behavior CORRECTION, so no differential shadow either;
  // pinned directly in `type-handler-parity.test.ts`.
  // library/combinatorics.ts
  ['Fibonacci', 'finite_integer'],
  ['Multinomial', 'finite_integer'],
  ['Subfactorial', 'finite_integer'],
  ['BellNumber', 'finite_integer'],
];

export function installLegacyTypeHandlerShadow(): void {
  for (const [operator, handler] of Object.entries(LEGACY_TYPE_HANDLERS))
    _legacyTypeHandlerShadow.set(operator, handler);
}

export function uninstallLegacyTypeHandlerShadow(): void {
  for (const operator of Object.keys(LEGACY_TYPE_HANDLERS))
    _legacyTypeHandlerShadow.delete(operator);
}
