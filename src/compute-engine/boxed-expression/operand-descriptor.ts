import type {
  IComputeEngine as ComputeEngine,
  Expression,
  OperandDescriptor,
  OperandFacts,
  OperandStructure,
  Sign,
  Tri,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';

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
  const finite: Tri = isSubtype(t, 'finite_number')
    ? true
    : isSubtype(t, 'non_finite_number')
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
  if (isSymbol(op)) return { kind: 'symbol', name: op.symbol };
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
 * symbol's held value or recorded assumptions, structural facets. In
 * particular the sign of a function APPLICATION comes only from its type
 * (a ranged result such as `Abs`'s `real<0..>`) — the operator `sgn`
 * handlers are never invoked here, so a compound operand of signless type
 * answers `undefined`.
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
  if (finite === undefined && isNumber(op)) finite = op.isFinite;

  // Value channel first for atoms (a literal's value, a symbol's held value
  // or assumption), then the sign the type itself proves (a ranged
  // declaration, a literal's value type, a ranged result type). A symbol
  // holding a NON-NUMBER expression is excluded from the value channel: its
  // `.sgn` would delegate to the held expression, whose operator `sgn`
  // handler is not a pure source (those handlers are unaudited and never
  // consulted on the type path); a valueless symbol's own `.sgn` reads only
  // assumptions and the declared type, which are pure.
  let sgn: Sign | undefined;
  if (isNumber(op)) sgn = op.sgn;
  else if (isSymbol(op)) {
    const held = op.valueDefinition?.value;
    if (held === undefined) sgn = op.sgn;
    else if (isNumber(held)) sgn = held.sgn;
  }
  sgn ??= signOfType(type);

  const facts: OperandFacts = {
    valid: op.isValid,
    finite,
    sgn,
    closed: op.isConstant,
    collection,
    finiteCollection,
    indexed,
    shape: tf.shape,
    application: isFunction(op),
    inferred: isSymbol(op)
      ? (op.valueDefinition?.inferredType ?? false)
      : false,
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
      valid: t !== 'error',
      finite: tf.finite,
      sgn: signOfType(t),
      closed: undefined,
      collection: tf.collection,
      finiteCollection: tf.finiteCollection,
      indexed: tf.indexed,
      shape: tf.shape,
      application: undefined,
      inferred: undefined,
    },
  };
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
