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
import { asRational } from './numerics.js';
import { numberLiteralTierType } from './literal-tier.js';
import { COUNT_STATS } from '../../common/cache-stats.js';
import {
  functionLiteralBody,
  functionLiteralParameters,
} from './function-literal.js';

/**
 * Operand descriptors: what a `type` handler receives in place of the
 * operand expressions, so that deriving a type cannot
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
  // `+oo | -oo` is one of its subtypes, so testing it covers `±∞`
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
 * Descent stops at the first depth that is not uniformly list-literal: a
 * depth counts only when every node at that depth, across the whole
 * literal, is a `List` of the same length.
 *
 * Computed per node as its own length followed by the longest common prefix
 * of its children's shapes (a non-`List` child has the empty shape), which
 * is the same answer: a depth survives the prefix exactly when every node
 * at that depth agrees. The per-node result is memoized by node identity. A
 * boxed expression is a DAG — a list built from one sub-list referenced
 * twice holds the same object twice — so a walk that collected each
 * occurrence doubled with every nesting of `List(t, t)` and reached 2^26
 * entries for a 26-level tower of 27 distinct nodes (the `Hold` type handler
 * reads this structure); the memo makes the walk linear in the distinct
 * nodes, whatever depths share them.
 */
function listLiteralShape(op: Expression): number[] {
  const memo = new Map<Expression, number[]>();
  const shapeOf = (x: Expression): number[] => {
    if (!isFunction(x, 'List')) return [];
    const cached = memo.get(x);
    if (cached !== undefined) return cached;
    let prefix: number[] | undefined;
    for (const child of x.ops) {
      const s = shapeOf(child);
      if (prefix === undefined) prefix = s;
      else {
        let k = 0;
        while (k < prefix.length && k < s.length && prefix[k] === s[k]) k++;
        if (k < prefix.length) prefix = prefix.slice(0, k);
      }
      if (prefix.length === 0) break;
    }
    const shape = [x.nops, ...(prefix ?? [])];
    memo.set(x, shape);
    return shape;
  };
  return shapeOf(op);
}

/** The inert structural view of an operand — see `OperandStructure`. Reads
 * the operand as written (raw operands of a lazy operator included) and
 * never binds or canonicalizes anything. */
/**
 * One structure walk's descriptor memo, keyed by operand expression. A boxed
 * expression is a DAG — a list built from one sub-list referenced twice holds
 * the same object twice — so every child of a structure is described through
 * this map: a shared node yields ONE descriptor, and a consumer that memoizes
 * its own analysis by descriptor identity (`List`'s shape analysis) stays
 * linear in the number of distinct nodes instead of the number of paths (a
 * 26-level `List(t, t)` tower has 27 nodes and 2^26 paths). The call site
 * hands one map to every operand of an application, so a node shared
 * between two operands is described once as well. The map lives as long
 * as the descriptor tree it belongs to — one type derivation — so a stale
 * fact can never outlive the engine state it was read from.
 */
export type DescriptorMemo = Map<Expression, OperandDescriptor>;

function structureOfExpression(
  op: Expression,
  memo: DescriptorMemo
): OperandStructure | undefined {
  if (isSymbol(op)) {
    // The inferred-type and system-binding flags ride the symbol node (a
    // property of THIS symbol, not of a type): each is present only when
    // true, so a plain declared or unbound symbol's node stays
    // `{ kind, name }`. A symbol is system-bound when its value definition
    // IS the one the engine's outermost scope binds under its name (the
    // binding-identity test `isRingConstant` makes on an expression); an
    // unbound symbol resolves to nothing and is never system-bound.
    const node: OperandStructure = { kind: 'symbol', name: op.symbol };
    const def = op.valueDefinition;
    if (def !== undefined) {
      if (def.inferredType === true) node.inferred = true;
      const systemBinding =
        op.engine.contextStack[0]?.lexicalScope.bindings.get(op.symbol);
      if (
        systemBinding !== undefined &&
        'value' in systemBinding &&
        systemBinding.value === def
      )
        node.system = true;
    }
    return node;
  }
  if (isString(op)) return { kind: 'string', text: op.string };
  if (isNumber(op)) {
    // `isSame` is strictly syntactic, so this reads the literal's own value
    // and never a symbol's assigned one.
    const literal = op.isSame(0) ? 0 : op.isSame(1) ? 1 : undefined;
    // The reduced fraction is read on demand: it converts both terms to
    // `bigint`, and the container handlers that read a literal's structure
    // for its `tier` alone (`Tuple`, `List`, `Set`) never ask for it.
    let rational: readonly [bigint, bigint] | undefined;
    let rationalComputed = false;
    const node: OperandStructure = {
      kind: 'number',
      tier: numberLiteralTierType(op),
      get rational(): readonly [bigint, bigint] | undefined {
        if (!rationalComputed) {
          rationalComputed = true;
          const r = asRational(op);
          if (r !== undefined) rational = [BigInt(r[0]), BigInt(r[1])];
        }
        return rational;
      },
    };
    if (literal !== undefined) node.literal = literal;
    return node;
  }
  if (isFunction(op, 'Function')) {
    const body = functionLiteralBody(op);
    const bodyStructure =
      body === undefined ? undefined : structureOfExpression(body, memo);
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
  // The operands of a compound are described on demand. A handler that
  // reads a compound's structure for its KIND alone — the `List` cell
  // classifier asks each cell "are you a number literal?" and a tuple cell
  // answers no — must not pay for one descriptor per operand of every
  // tuple in a 5,000-point list. The walk memo is captured, so a shared
  // node is still described once per derivation whenever the read happens.
  if (isFunction(op, 'Tuple')) {
    const ops = op.ops;
    let elements: ReadonlyArray<OperandDescriptor> | undefined;
    return {
      kind: 'tuple',
      arity: op.nops,
      get elements(): ReadonlyArray<OperandDescriptor> {
        return (elements ??= ops.map((x) => describe(x, undefined, memo)));
      },
    };
  }
  if (isFunction(op, 'List')) {
    const ops = op.ops;
    let elements: ReadonlyArray<OperandDescriptor> | undefined;
    return {
      kind: 'list-literal',
      shape: listLiteralShape(op),
      get elements(): ReadonlyArray<OperandDescriptor> {
        return (elements ??= ops.map((x) => describe(x, undefined, memo)));
      },
    };
  }
  if (isFunction(op)) {
    const ops = op.ops;
    let children: ReadonlyArray<OperandDescriptor> | undefined;
    return {
      kind: 'application',
      head: op.operator,
      get children(): ReadonlyArray<OperandDescriptor> {
        return (children ??= ops.map((x) => describe(x, undefined, memo)));
      },
    };
  }
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
  typeOverride?: Type,
  walk?: DescriptorMemo
): OperandDescriptor {
  // A child reached through a structure walk is described once per walk
  // (see `DescriptorMemo`); a top-level operand with a type override is
  // never shared, so it is never memoized.
  if (typeOverride === undefined) {
    const shared = walk?.get(op);
    if (shared !== undefined) return shared;
  }
  if (COUNT_STATS) descriptorStats.built++;
  const descriptor = new ExpressionOperandDescriptor(op, typeOverride, walk);
  if (typeOverride === undefined) walk?.set(op, descriptor);
  return descriptor;
}

/**
 * The number of descriptors `describe()` has built since the module loaded —
 * a measurement counter for the load-immune cost pins in
 * `test/compute-engine/composite-type-synthesis.test.ts` (one descriptor per
 * operand of a derivation; a list of N tuples must cost O(N) of them, not
 * O(N) per level). Read through the module export because an ES-module
 * export cannot be spied on. Incremented only under `COUNT_STATS` (the test
 * runner, or `CE_CACHE_STATS`), never reset.
 */
export const descriptorStats = { built: 0 };

// The memo bits of `ExpressionOperandFacts`: one bit per fact that has been
// computed. A fact's VALUE can legitimately be `undefined` (the undecided
// branch of a `Tri`, an absent sign), so presence cannot be read from the
// slot itself.
const FINITE_COMPUTED = 1;
const SGN_COMPUTED = 2;
const CLOSED_COMPUTED = 4;
const COLLECTION_COMPUTED = 8;
const FINITE_COLLECTION_COMPUTED = 16;
const INDEXED_COMPUTED = 32;
const ELEMENT_TYPE_COMPUTED = 64;

/**
 * The facts of a real operand, each computed ON FIRST READ and memoized.
 *
 * A class with prototype getters, not an object literal with accessor
 * properties: a descriptor is built for EVERY operand of EVERY type
 * derivation — every element of a list literal each time a fresh list is
 * typed — and an accessor-bearing literal plus the closures it captured cost
 * about 1.6 µs per operand before a single fact was read, forty times the
 * cost of an instance whose getters live on the prototype. That allocation
 * was the whole per-element cost of typing a list.
 *
 * The value-channel reads are not free: a collection value's finiteness or
 * element type comes from its operator's collection handlers, and a `Range`
 * whose bound is a `Sum` evaluates that bound to answer its `count`. Reading
 * every fact eagerly made building a descriptor evaluate operands no handler
 * was going to ask about, and moved that evaluation OUTSIDE the purity
 * guard's window, where a state write went unreported (a `sgn` read of
 * `Random(Range(1, Sum(…)))` advanced the cache axis through its type
 * derivation). Lazily, a handler pays only for the facts it reads, and reads
 * them inside the guarded window. The facts the TYPE proves are lazy for the
 * same reason of cost: they take six lattice checks (`factsFromType`), and
 * the handlers that read only the type and the structure — the `List` shape
 * analysis — were paying for them on every operand.
 */
class ExpressionOperandFacts implements OperandFacts {
  // ECMAScript private fields, not TypeScript `private`: a `type` handler
  // receives descriptors and no expressions (`OperandDescriptor`,
  // `types-definitions.ts`), and a TypeScript-private property is an
  // ordinary property at runtime that a handler could read the operand
  // through.
  readonly #op: Expression;
  // A thunk, not the type: a number literal's type is read on demand (see
  // `ExpressionOperandDescriptor.type`), and the facts must not force it.
  readonly #typeOf: () => Type;
  private _computed = 0;
  private _typeFacts: ReturnType<typeof factsFromType> | undefined;
  private _finite: Tri;
  private _sgn: Sign | undefined;
  private _closed: Tri;
  private _collection: Tri;
  private _finiteCollection: Tri;
  private _indexed: Tri;
  private _elementType: Type | undefined;

  constructor(op: Expression, typeOf: () => Type) {
    this.#op = op;
    this.#typeOf = typeOf;
  }

  private typeFacts(): ReturnType<typeof factsFromType> {
    return (this._typeFacts ??= factsFromType(this.#typeOf()));
  }

  get finite(): Tri {
    if (!(this._computed & FINITE_COMPUTED)) {
      this._computed |= FINITE_COMPUTED;
      this._finite = this.finiteOf();
    }
    return this._finite;
  }

  // Value channel first (a literal's value, a symbol's held value or
  // assumptions, an application's operator `sgn` handler), then the sign
  // the type itself proves (a ranged declaration, a literal's value type,
  // a ranged result type). The `.sgn` getter is a pure read for every
  // operand kind (the `describe` doc comment states the contract): a
  // symbol delegates to its held value — a held expression's operator
  // handler included, behind a cycle guard — and an application dispatches
  // its operator's `sgn` handler, memoized per node.
  get sgn(): Sign | undefined {
    if (!(this._computed & SGN_COMPUTED)) {
      this._computed |= SGN_COMPUTED;
      const op = this.#op;
      let sgn: Sign | undefined;
      if (isNumber(op) || isSymbol(op) || isFunction(op)) sgn = op.sgn;
      this._sgn = sgn ?? signOfType(this.#typeOf());
    }
    return this._sgn;
  }

  get closed(): Tri {
    if (!(this._computed & CLOSED_COMPUTED)) {
      this._computed |= CLOSED_COMPUTED;
      this._closed = this.#op.isConstant;
    }
    return this._closed;
  }

  get collection(): Tri {
    if (!(this._computed & COLLECTION_COMPUTED)) {
      this._computed |= COLLECTION_COMPUTED;
      const tf = this.typeFacts();
      this._collection =
        tf.collection === true || this.#op.isCollection === true
          ? true
          : tf.collection;
    }
    return this._collection;
  }

  get finiteCollection(): Tri {
    if (!(this._computed & FINITE_COLLECTION_COMPUTED)) {
      this._computed |= FINITE_COLLECTION_COMPUTED;
      const tf = this.typeFacts();
      this._finiteCollection =
        tf.finiteCollection !== undefined
          ? tf.finiteCollection
          : this.collection !== false
            ? this.#op.isFiniteCollection
            : undefined;
    }
    return this._finiteCollection;
  }

  get indexed(): Tri {
    if (!(this._computed & INDEXED_COMPUTED)) {
      this._computed |= INDEXED_COMPUTED;
      const tf = this.typeFacts();
      this._indexed =
        tf.indexed === true || this.#op.isIndexedCollection === true
          ? true
          : tf.indexed;
    }
    return this._indexed;
  }

  get shape(): readonly number[] | undefined {
    return this.typeFacts().shape;
  }

  // The per-instance element type: the operand's own collection handler,
  // consulted only for an application whose operator declares one. The
  // `elttype` family reads literal operands and static types (the
  // set-comprehension and interval handlers are rewritten to that
  // contract with the handler migration), so the read is pure.
  get elementType(): Type | undefined {
    if (!(this._computed & ELEMENT_TYPE_COMPUTED)) {
      this._computed |= ELEMENT_TYPE_COMPUTED;
      const op = this.#op;
      this._elementType =
        !isFunction(op) || this.collection === false
          ? undefined
          : op.operatorDefinition?.collection?.elttype?.(op);
    }
    return this._elementType;
  }

  private finiteOf(): Tri {
    const tf = this.typeFacts();
    if (tf.finite !== undefined) return tf.finite;
    const op = this.#op;
    if (isNumber(op)) return op.isFinite;
    if (isSymbol(op)) {
      // Symmetric with the sign read above: a held NUMBER value is a pure
      // source, and a wide-typed symbol (`w: number`) can legitimately hold
      // `±∞` or `NaN` that its type does not reveal. A held non-number
      // value decides nothing.
      const held = op.valueDefinition?.value;
      return held !== undefined && isNumber(held) ? held.isFinite : undefined;
    }
    if (isFunction(op) && isSubtype(this.#typeOf(), 'number')) {
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
      return op.isFinite;
    }
    return undefined;
  }
}

/**
 * The descriptor of a real operand (`describe`). No `valid`, `application`,
 * or `inferred` field: an error operand's TYPE is `'error'` (validity is a
 * type read); whether the operand is an application is a structural question
 * (`structureOf()`); and the inferred-type flag is an input to the engine's
 * own derivation steps, not a handler fact — it rides the `structureOf()`
 * symbol node.
 */
class ExpressionOperandDescriptor implements OperandDescriptor {
  // Private fields for the same reason as in `ExpressionOperandFacts`: the
  // operand and the walk memo (which maps expressions) must not be reachable
  // from a handler.
  readonly #op: Expression;
  #walk: DescriptorMemo | undefined;
  readonly facts: OperandFacts;
  private _type: Type | undefined;
  private _structure: OperandStructure | undefined;
  private _structureComputed = false;

  constructor(
    op: Expression,
    typeOverride: Type | undefined,
    walk: DescriptorMemo | undefined
  ) {
    this.#op = op;
    this.#walk = walk;
    // A number literal's type is read on demand (see `type` below). Every
    // other operand's type is read here, up front: a compound's type
    // derivation may write state (an inferred symbol type), and that
    // derivation belongs to the child, not to the handler whose guarded
    // window would otherwise report it.
    this._type = typeOverride;
    if (typeOverride === undefined && !isNumber(op)) this._type = op.type.type;
    this.facts = new ExpressionOperandFacts(op, () => this.type);
  }

  /**
   * The operand's handler-visible type: a number literal's value-carrying
   * `_literalType` when it has one, the public type otherwise. For a number
   * literal it is computed on first read — its literal type is a pure memo
   * on the node, so nothing about the guarded window changes when the read
   * moves inside it — and a container handler (`Tuple`, `List`, `Set`) that
   * reads the literal's TIER off its structure never asks for it at all.
   */
  get type(): Type {
    return (this._type ??= this.#op._literalType ?? this.#op.type.type);
  }

  // An instance property, not a prototype method: two call sites copy the
  // function out of the descriptor unbound (`{ type, facts: d.facts,
  // structureOf: d.structureOf }`, the missing-strip rewrap), and a method
  // would lose its `this` there.
  readonly structureOf = (): OperandStructure | undefined => {
    if (!this._structureComputed) {
      this._structureComputed = true;
      this._structure = structureOfExpression(
        this.#op,
        (this.#walk ??= new Map())
      );
    }
    return this._structure;
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
 * Describe a BOUND VARIABLE of a given type — the stand-in a recursive
 * derivation uses for a mapping literal's parameter, a comprehension's
 * bound variable, a pipe stage's parameter — as the DECLARED symbol it
 * stands for, not as a bare type.
 *
 * `describeType(t)` alone is not a faithful stand-in for such an operand: it
 * has no structural view, and a handler that distinguishes a declared
 * scalar symbol from an untyped one (`Multiply` scales a literal tuple's
 * components only by a declared scalar number; `Add`, `Divide` and the
 * `List` fold read the same symbol node) sees "no structure" and takes its
 * conservative branch, so `Map(k ↦ k·(1, 0), R)` over a real `R` typed its
 * elements `tuple<integer, integer>` instead of `tuple<number, number>`.
 * The expression route never had that gap because it DECLARED a fresh
 * symbol of the element type and spliced the symbol into a probe; this
 * constructor reproduces that symbol's descriptor without the declaration.
 * The name is never resolved (a descriptor holds no binding), so it only
 * needs to be one no user symbol can carry.
 */
export function describeBoundSymbol(
  t: Type,
  name = '__boundSymbol'
): OperandDescriptor {
  const d = describeType(t);
  return {
    type: d.type,
    // A bound variable is a free symbol, not a closed constant: `closed` is
    // `false`, as `isConstant` is for the declared stand-in symbol the
    // expression route spliced in, so a handler that widens a CLOSED
    // operand at a possible pole (`Tan(π/2)`) keeps its claim for the
    // element.
    facts: { ...d.facts, closed: false },
    structureOf: () => ({ kind: 'symbol', name }),
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
  // The comparison runs after the call whether or not it threw, so a
  // handler that mutates state AND throws is still reported as a purity
  // violation. One exception: an error that IS a purity report from a
  // nested handler call (`context.derive` guards its own call) passes
  // through untouched, so the violation is blamed on the handler that
  // wrote the state, not on every ancestor whose window also saw the axis
  // move.
  let threw: unknown = undefined;
  let didThrow = false;
  try {
    return call();
  } catch (e) {
    threw = e;
    didThrow = true;
    throw e;
  } finally {
    if (didThrow && isPurityViolation(threw)) {
      // Re-thrown above; the outer report would only misattribute it.
    } else {
      reportAxisMovement(
        engine,
        operator,
        any,
        semantic,
        world,
        callable,
        scratch
      );
    }
  }
}

const PURITY_VIOLATION_MARK = 'modified engine state while deriving a type';

function isPurityViolation(e: unknown): boolean {
  return e instanceof Error && e.message.includes(PURITY_VIOLATION_MARK);
}

function reportAxisMovement(
  engine: ComputeEngine,
  operator: string,
  any: number,
  semantic: number,
  world: number,
  callable: number,
  scratch: number
): void {
  {
    const moved: string[] = [];
    if (engine._anyVersion !== any) moved.push('any');
    if (engine._semanticVersion !== semantic) moved.push('semantic');
    if (engine._worldVersion !== world) moved.push('world');
    if (engine._callableVersion !== callable) moved.push('callable');
    if (engine._scratchDeclarationScopes.length !== scratch)
      moved.push('scratch-scopes');
    if (moved.length > 0)
      throw new Error(
        `The type handler of "${operator}" ${PURITY_VIOLATION_MARK} ` +
          `(moved: ${moved.join(', ')}). A type handler must not declare, ` +
          `canonicalize, or evaluate anything.`
      );
  }
}
