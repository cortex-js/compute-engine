import type {
  IComputeEngine as ComputeEngine,
  Expression,
  OperandDescriptor,
  OperandFacts,
  OperandStructure,
  OperatorTypeHandlerOnExpressions,
  Sign,
  Tri,
} from '../global-types.js';
import type { Type, TypeString } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';
import { typeToString } from '../../common/type/serialize.js';
import { widenValueTypes } from '../../common/type/widen-value.js';

import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import { signOfType } from '../../common/type/utils.js';
import { isFunction, isNumber, isString, isSymbol } from './type-guards.js';
import {
  functionLiteralBody,
  functionLiteralParameters,
} from './function-literal.js';

/**
 * Operand descriptors: what a `type` handler in the `'types'` shape receives
 * in place of the operand expressions, so that deriving a type cannot
 * declare, canonicalize, or evaluate anything. `describe()` builds one from
 * a real operand; `describeType()` builds a synthetic one from a type alone.
 * These two constructors are the only way a descriptor is made.
 *
 * Design: `docs/plans/2026-08-22-type-handlers-on-types.md` §5.1–§5.2.
 */

/** The facts a TYPE alone proves, shared by both constructors. */
function factsFromType(t: Type): {
  finite: Tri;
  collection: Tri;
  indexed: Tri;
  finiteCollection: Tri;
  shape: readonly number[] | undefined;
} {
  // `infinity` is any value of infinite magnitude — the signed pair
  // `non_finite_number` is one of its subtypes, so testing it covers `±∞`
  // as well as `~oo` — and `nan` is the NaN singleton, which is disjoint
  // from `infinity` and needs its own arm.
  const finite: Tri = isSubtype(t, 'complex')
    ? true
    : isSubtype(t, 'infinity') || isSubtype(t, 'nan')
      ? false
      : undefined;

  // Shape question, not capability: a valueless symbol declared
  // `list<integer>` IS a collection even though it cannot be enumerated
  // yet, so the subtype test against the absence-admitting `collection<any>`
  // top is the right gate (bare `collection` would exclude
  // absence-carrying element types). Top types (`unknown`, `any`, `value`)
  // and `broadcastable<T>` are neither subtypes of nor provably disjoint
  // from it, and answer `undefined` — "possibly a collection".
  const collection: Tri = isSubtype(t, COLLECTION_SHAPE_TYPE)
    ? true
    : provablyDisjoint(t, COLLECTION_SHAPE_TYPE)
      ? false
      : undefined;

  const indexed: Tri = isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)
    ? true
    : provablyDisjoint(t, INDEXED_COLLECTION_SHAPE_TYPE)
      ? false
      : undefined;

  // A dimensioned list type (`list<integer^2x3>`) is the one static shape a
  // type can carry. Dimensions may hold placeholders for unknown extents, so
  // only an all-concrete dimension list counts.
  let shape: readonly number[] | undefined;
  if (
    typeof t === 'object' &&
    t.kind === 'list' &&
    Array.isArray(t.dimensions) &&
    t.dimensions.length > 0 &&
    t.dimensions.every(
      (d) => typeof d === 'number' && Number.isFinite(d) && d >= 0
    )
  )
    shape = t.dimensions;

  return {
    finite,
    collection,
    indexed,
    finiteCollection: shape !== undefined ? true : undefined,
    shape,
  };
}

/**
 * The nested dimensions of a literal `List` whose rows are themselves
 * literal `List`s of equal length: `[[1,2,3],[4,5,6]]` answers `[2, 3]`.
 * Descent stops at the first level that is not uniformly list-literal.
 */
function listLiteralShape(op: Expression): number[] {
  const shape: number[] = [];
  let level: ReadonlyArray<Expression> = [op];
  while (level.length > 0 && level.every((x) => isFunction(x, 'List'))) {
    const rows = level.map((x) => (x as Expression & { nops: number }).nops);
    const n = rows[0];
    if (!rows.every((r) => r === n)) break;
    shape.push(n);
    level = level.flatMap((x) => (isFunction(x) ? x.ops : []));
  }
  return shape;
}

/** The inert structural view of an operand — see `OperandStructure`. Reads
 * the operand as written (raw operands of a lazy operator included) and
 * never binds or canonicalizes anything. */
function structureOfExpression(op: Expression): OperandStructure | undefined {
  if (isSymbol(op)) {
    // The inferred-type flag rides the symbol node (a property of THIS
    // symbol, not of a type): present only when true, so a declared or
    // unbound symbol's node stays `{ kind, name }`.
    return op.valueDefinition?.inferredType === true
      ? { kind: 'symbol', name: op.symbol, inferred: true }
      : { kind: 'symbol', name: op.symbol };
  }
  if (isString(op)) return { kind: 'string', text: op.string };
  if (isNumber(op)) {
    // `isSame` is strictly syntactic, so this reads the literal's own value
    // and never a symbol's assigned one.
    if (op.isSame(0)) return { kind: 'number', literal: 0 };
    if (op.isSame(1)) return { kind: 'number', literal: 1 };
    return { kind: 'number' };
  }
  if (isFunction(op, 'Function')) {
    const body = functionLiteralBody(op);
    const bodyStructure =
      body === undefined ? undefined : structureOfExpression(body);
    // A literal whose body has no structural form yields no structure at
    // all, rather than a view with a hole where the body should be.
    if (bodyStructure === undefined) return undefined;
    return {
      kind: 'function-literal',
      parameters: functionLiteralParameters(op).map(({ name, type }) =>
        type === undefined ? { name } : { name, annotated: type }
      ),
      body: bodyStructure,
    };
  }
  if (isFunction(op, 'Tuple')) return { kind: 'tuple', arity: op.nops };
  if (isFunction(op, 'List'))
    return { kind: 'list-literal', shape: listLiteralShape(op) };
  if (isFunction(op))
    return {
      kind: 'application',
      head: op.operator,
      children: op.ops.map((x) => describe(x)),
    };
  return undefined;
}

/**
 * Describe a real operand for a `'types'`-shape `type` handler.
 *
 * The descriptor's type is the operand's handler-visible type: a number
 * literal's value-carrying `_literalType` when it has one, the public type
 * otherwise — the same channel the expression-shape helpers
 * (`handlerTypeOf` in `library/type-handlers.ts`) read. `typeOverride`
 * carries the missing-value strip: at a stripped parameter position with an
 * absent operand, the call site passes the operand's `missing`-stripped
 * type and it replaces the operand's own.
 *
 * Every fact is read from a pure source: the type, a literal's value, a
 * symbol's held value or recorded assumptions, structural facets. The sign
 * of a function application reads `.sgn`, which dispatches the operator
 * `sgn` handlers — a pure family: every handler must derive its answer
 * without evaluation, canonicalization, or declarations (the contract on
 * `OperatorDefinition.sgn`; the audit that established it and rewrote the
 * two evaluating handlers is recorded at open item O7 of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`, and a drift-regression
 * test in `sgn-audit.test.ts` pins it). Finiteness likewise falls back on
 * the value channel (`Expression.isFinite`), for the reason given at that
 * branch below.
 */
export function describe(
  op: Expression,
  typeOverride?: Type
): OperandDescriptor {
  const type = typeOverride ?? op._literalType ?? op.type.type;
  const tf = factsFromType(type);

  let collection = tf.collection;
  if (collection !== true && op.isCollection === true) collection = true;
  let indexed = tf.indexed;
  if (indexed !== true && op.isIndexedCollection === true) indexed = true;
  let finiteCollection = tf.finiteCollection;
  if (collection !== false && finiteCollection === undefined)
    finiteCollection = op.isFiniteCollection;

  let finite = tf.finite;
  if (finite === undefined) {
    if (isNumber(op)) finite = op.isFinite;
    else if (isSymbol(op)) {
      // Symmetric with the sign read below: a held NUMBER value is a pure
      // source, and a wide-typed symbol (`w: number`) can legitimately hold
      // `±∞` or `NaN` that its type does not reveal. A held non-number
      // value decides nothing.
      const held = op.valueDefinition?.value;
      if (held !== undefined && isNumber(held)) finite = held.isFinite;
    } else if (isFunction(op) && isSubtype(type, 'number')) {
      // The value channel is the REFUTATION backstop for the generic-point
      // convention. A result type is deliberately optimistic about
      // finiteness: an operator that is finite at a generic point claims a
      // finite result type, and a wide `number` result type means "not
      // decided", never "non-finite is impossible". So a compound operand
      // can be provably non-finite through the values it holds — `Abs(w)`
      // with `w: number := +∞`, `Abs(hnan)` with `hnan := NaN` — while its
      // result type stays wide. The type channel alone cannot carry that
      // refutation, and without this read a consumer such as `Ceil(Abs(w))`
      // narrows to `integer` for an expression whose `.N()` is
      // `+oo`. `Expression.isFinite` on an application is the exact read
      // the expressions-shape gate performed on every derivation
      // (`provablyNonFiniteNumber`, `boxed-expression/numerics.ts`), so it
      // adds no impurity relative to the shape being replaced.
      //
      // The `number` type test is part of that gate and is load-bearing:
      // `isFinite === false` also means "not a number at all", so a
      // `List`, a `Tuple` or an application of unknown result type answers
      // `false` there without being an infinity.
      finite = op.isFinite;
    }
  }

  // Value channel first (a literal's value, a symbol's held value or
  // assumptions, an application's operator `sgn` handler), then the sign
  // the type itself proves (a ranged declaration, a literal's value type,
  // a ranged result type). The `.sgn` getter is a pure read for every
  // operand kind (the constructor comment above states the contract): a
  // symbol delegates to its held value — a held expression's operator
  // handler included, behind a cycle guard — and an application dispatches
  // its operator's `sgn` handler, memoized per node.
  let sgn: Sign | undefined;
  if (isNumber(op) || isSymbol(op) || isFunction(op)) sgn = op.sgn;
  sgn ??= signOfType(type);

  // No `valid`, `application`, or `inferred` field: an error operand's TYPE
  // is `'error'` (validity is a type read); whether the operand is an
  // application is a structural question (`structureOf()`); and the
  // inferred-type flag is an input to the engine's own derivation steps,
  // not a handler fact — when `deriveApplicationType` lands it travels the
  // primitive's private channel, like admission data.
  const facts: OperandFacts = {
    finite,
    sgn,
    closed: op.isConstant,
    collection,
    finiteCollection,
    indexed,
    shape: tf.shape,
  };

  let structureMemo: OperandStructure | undefined;
  let structureComputed = false;
  return {
    type,
    facts,
    structureOf: () => {
      if (!structureComputed) {
        structureComputed = true;
        structureMemo = structureOfExpression(op);
      }
      return structureMemo;
    },
  };
}

/**
 * Describe a synthetic operand from a type alone — the constructor a
 * recursive derivation uses for an operand it does not have in hand (the
 * element of a mapped collection, a stripped position). Facts the type
 * cannot prove stay `undefined`, which every consumer must treat as the
 * conservative branch.
 */
export function describeType(t: Type): OperandDescriptor {
  const tf = factsFromType(t);
  return {
    type: t,
    facts: {
      finite: tf.finite,
      sgn: signOfType(t),
      closed: undefined,
      collection: tf.collection,
      finiteCollection: tf.finiteCollection,
      indexed: tf.indexed,
      shape: tf.shape,
    },
  };
}

/**
 * The three-valued type-channel replacement for the mixed-channel
 * predicates (`isInteger`, `isExtendedReal`, `isRational`, …) of the
 * expressions shape: `true` when the operand's handler-visible type proves
 * the claim,
 * `false` when it provably refutes it, `undefined` when the type cannot
 * decide. On a number literal the handler-visible type carries the value,
 * so this answers exactly what the value-backed predicate answered; on a
 * symbol it answers from the declared or inferred type, which is what the
 * predicates already read there. Converted handlers must branch on the
 * explicit `=== true` / `=== false`, never on truthiness — `undefined` is
 * the conservative middle.
 */
export function typeFact(t: Type, claim: Type): Tri {
  if (isSubtype(t, claim)) return true;
  if (provablyDisjoint(t, claim)) return false;
  return undefined;
}

/**
 * Runtime purity guard for `'types'`-shape handler calls: always on under
 * test, opt-in elsewhere with the `CE_TYPE_PURITY_GUARD` environment
 * variable, and compiled out of a production bundle with the rest of the
 * `process.env` reads. A handler that reaches any state write moves one of
 * the invalidation axes or registers a scratch scope, and the guard turns
 * that silent cache poisoning into an immediate error naming the operator.
 *
 * This is the version-counter core of the full enforcement design
 * (`docs/plans/2026-08-22-type-handlers-on-types.md` §5.5); the
 * definition-write and construction counters described there require their
 * own instrumentation and land with the mass handler migration.
 */
const PURITY_GUARD_ENABLED: boolean = (() => {
  try {
    return (
      typeof process !== 'undefined' &&
      process.env !== undefined &&
      (process.env.NODE_ENV === 'test' ||
        (process.env.CE_TYPE_PURITY_GUARD ?? '') !== '')
    );
  } catch {
    return false;
  }
})();

export function guardedTypeHandlerCall<T>(
  engine: ComputeEngine,
  operator: string,
  call: () => T
): T {
  if (!PURITY_GUARD_ENABLED) return call();
  const any = engine._anyVersion;
  const semantic = engine._semanticVersion;
  const world = engine._worldVersion;
  const callable = engine._callableVersion;
  const scratch = engine._scratchDeclarationScopes.length;
  // The comparison runs in `finally` so a handler that mutates state AND
  // throws is still reported as a purity violation — otherwise the
  // incidental exception would mask the real defect (state written from a
  // type-derivation path).
  try {
    return call();
  } finally {
    const moved: string[] = [];
    if (engine._anyVersion !== any) moved.push('any');
    if (engine._semanticVersion !== semantic) moved.push('semantic');
    if (engine._worldVersion !== world) moved.push('world');
    if (engine._callableVersion !== callable) moved.push('callable');
    if (engine._scratchDeclarationScopes.length !== scratch)
      moved.push('scratch-scopes');
    if (moved.length > 0)
      throw new Error(
        `The 'types'-shape type handler of "${operator}" modified engine state ` +
          `while deriving a type (moved: ${moved.join(', ')}). A type handler ` +
          `declared with typeHandlerKind: 'types' must not declare, ` +
          `canonicalize, or evaluate anything.`
      );
  }
}

/**
 * @fixme TEMPORARY MIGRATION APPARATUS — this MUST be removed, together
 * with every piece listed here, when the expressions-shape `type` handler
 * is retired (release N+2 of the migration plan,
 * `docs/plans/2026-08-22-type-handlers-on-types.md` §5.3 step 6): with a
 * single handler shape left there is nothing to differ against. The full
 * inventory to delete: this registry, `_shadowParityStats`,
 * `normalizeHandlerResult` and `checkShadowTypeParity` below; the
 * `checkShadowTypeParity` call in `boxed-function.ts`; the
 * `CE_TYPE_PARITY_SHADOW` install hook in `test/jest-config.ts`; and the
 * files `test/compute-engine/type-handler-shadow-legacy.ts` and
 * `test/compute-engine/type-handler-shadow-parity.test.ts`.
 *
 * Test-only differential-parity registry for the handler-shape migration.
 *
 * When an operator's `type` handler converts from the expressions shape to
 * the `'types'` shape, the conversion batch moves the LEGACY handler —
 * verbatim — into the test fixture that populates this map
 * (`test/compute-engine/type-handler-shadow-legacy.ts`). While an entry is
 * installed, the type-handler call site runs BOTH shapes on every
 * derivation for that operator and throws on divergence, so every type
 * read in every test executed with the shadow installed is a parity check
 * — the whole test suite becomes the parity corpus, covering the real
 * operand mix (raw held operands, missing-stripped positions, literals,
 * valueless symbols) that a synthetic replay would have to reconstruct.
 *
 * The map is empty outside those tests: production and ordinary test runs
 * pay one `Map.size` read per `'types'`-shape derivation and nothing else.
 * To make a FULL-SUITE run the corpus, set `CE_TYPE_PARITY_SHADOW=1` —
 * the jest per-file setup installs the fixture into every test
 * environment (each file has its own module registry, so installing from
 * one suite reaches that suite alone).
 *
 * Known limitation, accepted for the migration: descriptors built lazily
 * while a handler runs (a `structureOf()` call describing children) read
 * child types inside the ancestor handler's purity-guard window, so a
 * nested legacy shadow call executes there too. The purity guard would
 * attribute any state write from that nested legacy call to the ancestor.
 * The handlers eligible for the shadow are the 213 the side-effect audit
 * found pure (`docs/plans/2026-08-22-type-handlers-on-types.md` §2.5) —
 * the seven impure ones are REWRITTEN under new contracts, never
 * shadow-checked — so no state-writing legacy handler should ever enter
 * this registry; installing one would produce misattributed guard errors.
 */
export const _legacyTypeHandlerShadow = new Map<
  string,
  OperatorTypeHandlerOnExpressions
>();

/** Shadow-parity counters. A parity suite asserts `checks` moved — and that
 * every installed operator's own count moved — so an empty corpus, a broken
 * install, or a corpus that misses an operator fails loudly instead of
 * passing vacuously. */
export const _shadowParityStats = {
  checks: 0,
  checksByOperator: new Map<string, number>(),
};

/** Both handler shapes may answer with a `BoxedType`, a structural `Type`,
 * or a type string; results are compared after the same normalization the
 * call site applies when storing them (parse against the engine's resolver,
 * then widen literal cargo to tiers). */
function normalizeHandlerResult(
  engine: ComputeEngine,
  raw: Type | TypeString | BoxedType | undefined
): Type | undefined {
  if (raw === undefined) return undefined;
  const t =
    raw instanceof BoxedType ? raw.type : parseType(raw, engine._typeResolver);
  return t === undefined ? undefined : widenValueTypes(t);
}

/**
 * Differential check between a converted `'types'`-shape handler's answer
 * and the legacy expressions-shape handler held in the shadow registry.
 * Equivalence is mutual subtyping after normalization — spelling
 * differences are fine, a widening or narrowing is a divergence. Throws
 * with both spellings so the failing operand mix is reproducible from the
 * test that tripped it.
 */
export function checkShadowTypeParity(
  engine: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>,
  operandTypes: ReadonlyArray<Type | undefined> | undefined,
  newRaw: Type | TypeString | BoxedType | undefined
): void {
  if (_legacyTypeHandlerShadow.size === 0) return;
  const legacy = _legacyTypeHandlerShadow.get(operator);
  if (legacy === undefined) return;
  _shadowParityStats.checks += 1;
  _shadowParityStats.checksByOperator.set(
    operator,
    (_shadowParityStats.checksByOperator.get(operator) ?? 0) + 1
  );
  // The diagnostic is computed BEFORE the comparison: reading an operand's
  // type inside the throw expression could itself re-enter a nested shadow
  // check (or fail for an unrelated reason) and replace the divergence
  // report with a different exception.
  let operandSpelling: string;
  try {
    operandSpelling = ops
      .map((x) =>
        x._literalType !== undefined
          ? typeToString(x._literalType)
          : typeToString(x.type.type)
      )
      .join(', ');
  } catch {
    operandSpelling = '<unavailable>';
  }
  const oldNorm = normalizeHandlerResult(
    engine,
    legacy(ops, { engine, operandTypes })
  );
  const newNorm = normalizeHandlerResult(engine, newRaw);
  const agree =
    oldNorm === undefined || newNorm === undefined
      ? oldNorm === newNorm
      : isSubtype(oldNorm, newNorm) && isSubtype(newNorm, oldNorm);
  if (!agree)
    throw new Error(
      `type-handler shadow parity: "${operator}" diverged — legacy shape ` +
        `answered ${oldNorm === undefined ? 'undefined' : typeToString(oldNorm)}, ` +
        `'types' shape answered ${newNorm === undefined ? 'undefined' : typeToString(newNorm)} ` +
        `(operand types: ${operandSpelling})`
    );
}
