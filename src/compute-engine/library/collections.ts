import {
  checkArity,
  checkType,
  checkTypes,
  spellCheckMessage,
  validateArguments,
} from '../boxed-expression/validate.js';
import { toInteger } from '../boxed-expression/numerics.js';

import {
  basicIndexedCollectionHandlers,
  broadcastOverIndexedCollections,
  isDeclaredScalarNumber,
  isFiniteIndexedCollection,
  isTuple,
  MAX_SIZE_EAGER_COLLECTION,
} from '../collection-utils.js';
import { extractFiniteDomainWithReason } from './logic-analysis.js';
import { applicable, canonicalFunctionLiteral } from '../function-utils.js';
// Dynamic import for compile to avoid circular dependency
// (collections → compile-expression → base-compiler → library/utils → collections)
import { parseType } from '../../common/type/parse.js';
import { ListType, Type } from '../../common/type/types.js';
import {
  collectionElementType,
  functionResult,
  functionSignature,
  widen,
} from '../../common/type/utils.js';
import { interval, intervalContains } from '../numerics/interval.js';
import { deterministicRandom, nextSeed } from '../numerics/random.js';
import { CancellationError, run } from '../../common/interruptible.js';
import type {
  Expression,
  OperatorDefinition,
  ExpressionInput,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import { BoxedType } from '../types.js';
import { typeToString } from '../../common/type/serialize.js';
// BoxedDictionary dynamically imported to avoid circular dependency
import { canonical } from '../boxed-expression/canonical-utils.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
  sym,
} from '../boxed-expression/type-guards.js';
import { typeMembership } from './sets.js';

// From NumPy:
export const DEFAULT_LINSPACE_COUNT = 50;

// Parsed form of the `At` signature (kept in sync with the `signature:` string
// on the `At` definition), used by its custom canonical handler to delegate
// operand validation to `validateArguments`.
const AT_SIGNATURE = parseType(
  '(value: indexed_collection | dictionary, index: (number|string|boolean|indexed_collection)+) -> unknown'
);

// Shared instance of the basic handlers, used by the `Set` handlers to
// delegate the literal (non-comprehension) cases.
const SET_BASE_HANDLERS = basicIndexedCollectionHandlers();

// Element type of `xs` at 1-based `position` (`-1` = last), used by the
// `First`/`Second`/`Third`/`Last` type handlers. Prefers the operand's
// collection element-type handler (covers literal collections); for a
// symbolic operand with a statically-known tuple type, derives the type of
// the element at `position`; otherwise falls back to the (widened) collection
// element type.
function componentType(xs: Expression, position: number): Type {
  const elt = xs.operatorDefinition?.collection?.elttype?.(xs);
  if (elt) return elt;
  const t = xs.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple' && position >= 1) {
    const e = t.elements[position - 1]?.type;
    if (e) return e;
  }
  return collectionElementType(t) ?? 'any';
}

// Build the result type of `Map`: a collection with the same shape and
// indexed-ness as the `source` collection, but whose elements are the
// mapping lambda's result type (`elementType`) — not the source element
// type. `Map(Range(1,3), k |-> k + i)` is thus `indexed_collection<complex>`,
// not `indexed_collection<integer>`.
function mapResultType(
  source: Readonly<Type>,
  elementType: Readonly<Type>
): Type {
  if (typeof source === 'string') {
    if (
      source === 'indexed_collection' ||
      source === 'list' ||
      source === 'set' ||
      source === 'collection'
    )
      return parseType(`${source}<${typeToString(elementType)}>`);
    // dictionary/record/tuple/etc.: yield a plain collection of the results.
    return parseType(`collection<${typeToString(elementType)}>`);
  }
  if (source.kind === 'list') {
    const t: ListType = { kind: 'list', elements: elementType as Type };
    if (source.dimensions) t.dimensions = source.dimensions;
    return t;
  }
  if (source.kind === 'indexed_collection')
    return { kind: 'indexed_collection', elements: elementType as Type };
  if (source.kind === 'set')
    return { kind: 'set', elements: elementType as Type };
  if (source.kind === 'collection')
    return { kind: 'collection', elements: elementType as Type };
  // tuple/dictionary/record and anything else: fall back to a plain
  // collection of the lambda results.
  return parseType(`collection<${typeToString(elementType)}>`);
}

// Access the element of `xs` at 1-based `position` (`-1` = last), used by the
// `First`/`Second`/`Third`/`Last` evaluate handlers. A literal indexed
// collection returns the element; a symbolic operand whose type is (or could
// be) an indexed collection stays symbolic (return `undefined`); an operand
// provably not an indexed collection is a type error.
function componentAt(
  xs: Expression,
  position: number,
  ce: ComputeEngine
): Expression | undefined {
  if (xs.isCollection) return xs.at(position) ?? ce.Nothing;
  if (xs.type.matches('indexed_collection')) return undefined;
  return ce.error(['incompatible-type', `'collection'`, xs.type.toString()]);
}

// A point is a tuple (its coordinates are its elements). The `.x`/`.y`/`.z`
// accessors — `PointX`/`PointY`/`PointZ` — extract a coordinate. Unlike
// `First`/`Second`/`Third` (which index a collection and return an *element*),
// they broadcast over a *list of points*, returning the list of coordinates —
// matching Desmos and the threadable `Real`/`Imaginary` accessors. On a single
// point the two coincide (`First` of a 2-tuple is its x-coordinate); on a list
// of points they diverge (`First` returns the first point, not the x-list).
function isPointLike(e: Expression): boolean {
  const t = e.type.type;
  return (
    (typeof t !== 'string' && t.kind === 'tuple') || e.operator === 'Tuple'
  );
}

// True when the operand's declared type says its elements are points (tuples).
// Used to decide how an *empty* collection broadcasts: a declared `list<tuple>`
// with no elements is still a (empty) list of points, so a coordinate accessor
// yields an empty list — matching the JS compiler's `[].map(...)` → `[]`.
function hasPointElementType(xs: Expression): boolean {
  const elt = collectionElementType(xs.type.type);
  return elt !== undefined && typeof elt !== 'string' && elt.kind === 'tuple';
}

// Result type of a point-component accessor: a single point yields the
// coordinate type; a collection of points broadcasts to a collection of
// coordinates.
function pointComponentType(xs: Expression, position: number): Type {
  const t = xs.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple')
    return componentType(xs, position);
  // A list of points broadcasts. The coordinate type is not reliably
  // recoverable (a literal list of tuples is often mis-typed as `vector<n>`
  // with numeric elements), so use `number` — honest for the geometric point
  // case, and it keeps the result an (honest) collection type, not a scalar.
  if (xs.type.matches('indexed_collection')) return mapResultType(t, 'number');
  return componentType(xs, position);
}

// Evaluate a point-component accessor, broadcasting the coordinate over a list
// of points. We inspect the actual elements (not the declared element type,
// which is unreliable for a literal list of points) to decide whether to
// broadcast; a collection whose elements are not points falls back to the
// `First`/`Second`/`Third` element-indexing behavior.
function pointComponentAt(
  xs: Expression,
  position: number,
  ce: ComputeEngine
): Expression | undefined {
  // A single point (tuple): the coordinate.
  const t = xs.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple')
    return componentAt(xs, position, ce);

  // A finite collection: decide broadcast-vs-index WITHOUT materializing the
  // whole collection. A large lazy `Range` is finite, so enumerating every
  // element just to test point-ness would hang (the case the `validate.ts`
  // guard also protects against). Peek at the first element only: if it is a
  // point, broadcast the coordinate element-wise; otherwise fall back to O(1)
  // element indexing, like First/Second/Third.
  if (xs.isFiniteCollection) {
    // Peek via `each()` rather than `at(1)`: a non-indexed collection (a `Set`)
    // has no `at()`, so `at(1)` is `undefined` and a non-empty Set of points
    // was misread as empty (→ a silently-wrong `[]`). `each()` yields the first
    // element for indexed and non-indexed collections alike, and taking just
    // one element keeps the peek O(1) (no materialization of a large domain).
    let first: Expression | undefined;
    for (const e of xs.each()) {
      first = e;
      break;
    }
    if (first !== undefined) {
      if (isPointLike(first))
        return ce.function(
          'List',
          [...xs.each()].map((e) => e.at(position) ?? ce.Nothing)
        );
      // Elements are not points → element indexing, like First/Second/Third.
      return componentAt(xs, position, ce);
    }
    // Empty collection: if the declared element type is a point, broadcast to
    // an empty list (matching the JS compiler's `[].map(...)` → `[]`);
    // otherwise index (→ Nothing), like First/Second/Third on an empty list.
    if (hasPointElementType(xs)) return ce.function('List', []);
    return componentAt(xs, position, ce);
  }

  // Symbolic / non-finite operand: stay symbolic (or error) like componentAt.
  return componentAt(xs, position, ce);
}

// @todo: future thoughts. Consider
// - operations from the Scala library, which is particularly well designed:
//    - https://scala-lang.org/api/3.3.1/scala/language$.html#
//    - https://superruzafa.github.io/visual-scala-reference//
// - Scala/Breeze universal functions:
//     https://github.com/scalanlp/breeze/wiki/Universal-Functions
// See also Julia:
//    - https://docs.julialang.org/en/v1/base/iterators/

// • Permutations()
// •	Append()
// •	Prepend()
// •	Partition()
// • Apply(expr, n) -> if head of expr has a at handler, use it to access an element

// • Keys: { domain: 'Functions' },
// • Entries: { domain: 'Functions' },
// • cons -> cons(first (element), rest (list)) = list
// • append -> append(list, list) -> list
// • in
// • such-that {x ∈ Z | x ≥ 0 ∧ x < 100 ∧ x 2 ∈ Z}

// TakeDiagonal(matrix) -> [matrix[1, 1], matrix[2, 2], ...]

// Diagonal(list) -> [[list[1, 1], 0, 0], [0, list[2, 2], 0], ...]

export const COLLECTIONS_LIBRARY: SymbolDefinitions = {
  //
  // Data Structures
  //
  List: {
    description: 'An ordered collection of elements (a list).',
    complexity: 8200,

    signature: '(any*) -> list',
    type: (ops, { engine: _ce }) =>
      parseType(`list<${BoxedType.widen(...ops.map((op) => op.type))}>`),
    canonical: canonicalList,
    lazy: true,
    evaluate: (ops, { engine, numericApproximation, materialization }) => {
      // Eager materialization: flatten and materialize lazy sub-collections.
      if (materialization) {
        return engine._fn(
          'List',
          enlist(ops).map((op) =>
            op.evaluate({ numericApproximation, materialization })
          )
        );
      }
      // A collection literal evaluates its elements (unlike lazy operators,
      // which keep late binding). Fast path: a list whose elements are all
      // already fully-evaluated literals is returned unchanged, avoiding an
      // O(n) rebuild for large numeric lists.
      if (
        ops.every((op) => isEvaluatedElement(op, numericApproximation ?? false))
      )
        return undefined;
      return engine.function(
        'List',
        ops.map((op) => op.evaluate({ numericApproximation, materialization }))
      );
    },
    eq: defaultCollectionEq,
    collection: basicIndexedCollectionHandlers(),
  } as OperatorDefinition,

  // Extensional set. Elements do not repeat. The order of the elements is not significant.
  // For intensional set, use `Filter` with a condition, e.g. `Filter(RealNumbers, _ > 0)`
  //
  // A `Set` expression can also be a set-builder (comprehension), e.g.
  // `["Set", body, ["Element", k, domain, cond?]]` or
  // `["Set", body, ["Condition", ...]]` (see `parseSetComprehension()`).
  // Comprehensions are not literal 2-element sets: their elements are the
  // substituted bodies over the (filtered) domain.
  Set: {
    description: 'An unordered collection of distinct elements (a set).',
    complexity: 8200,

    signature: '(any*) -> set',
    type: (ops, { engine: _ce }) => {
      // A comprehension's element type is not the type of its syntactic
      // operands (body + indexing set)
      if (parseSetComprehension(ops) !== null) return parseType('set');
      return parseType(`set<${BoxedType.widen(...ops.map((op) => op.type))}>`);
    },

    canonical: canonicalSet,
    // The `lazy` flag suppresses the default operand evaluation: evaluating
    // the operands of a comprehension would mangle its indexing set (e.g.
    // the condition `gcd(n,k) = 1` with a free `k` evaluates to `False`).
    // Literal elements are evaluated explicitly in the `evaluate` handler.
    lazy: true,
    evaluate: (ops, { engine: ce, numericApproximation, materialization }) => {
      const comp = parseSetComprehension(ops);
      if (comp !== null) {
        // Materialize the comprehension as a literal set if the (filtered)
        // domain is enumerable and small enough; otherwise stay symbolic.
        const elements = enumerateSetComprehension(comp);
        if (
          elements === undefined ||
          elements.length > MAX_SIZE_EAGER_COLLECTION
        )
          return undefined;
        return ce.function('Set', elements);
      }
      // Literal set: evaluate each element (matches the default, non-lazy
      // evaluation behavior this operator had before it was marked lazy)
      return ce.function(
        'Set',
        ops.map((op) => op.evaluate({ numericApproximation, materialization }))
      );
    },
    eq: (a: Expression, b: Expression) => {
      // `b` may be an unevaluated set-valued expression (`Intersection(…)`,
      // `Union(…)`, a symbol assigned a set…): decline so `eq()` in
      // compare.ts can evaluate both sides and re-consult. A value whose
      // type cannot be a set is definitively unequal.
      if (a.operator !== b.operator)
        return b.type.matches('set') ? undefined : false;
      if (!isFunction(a) || !isFunction(b)) return false;
      if (a.nops !== b.nops) return false;
      // The elements are not indexed
      const has: (x: Expression) => boolean = (x) =>
        b.ops.some((y) => x.isSame(y));
      return a.ops.every(has);
    },
    collection: {
      ...SET_BASE_HANDLERS,
      // A set is not indexable
      at: undefined,
      indexWhere: undefined,
      // A comprehension computes its elements on demand
      isLazy: (expr) =>
        isFunction(expr) && parseSetComprehension(expr.ops) !== null,
      count: (expr) => {
        if (!isFunction(expr)) return 0;
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return expr.nops;
        // Cardinality of the comprehension: number of distinct substituted
        // bodies. Symbolic or infinite domains are not enumerable: undefined.
        return enumerateSetComprehension(comp)?.length;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return true;
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return expr.nops === 0;
        const elements = enumerateSetComprehension(comp);
        return elements === undefined ? undefined : elements.length === 0;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return true;
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return true;
        if (enumerateSetComprehension(comp) !== undefined) return true;
        // A comprehension over a finite domain is finite even when it cannot
        // be enumerated. The converse doesn't hold: a condition may filter an
        // infinite domain down to a finite set, so otherwise we can't tell.
        if (comp.domain?.isFiniteCollection === true) return true;
        return undefined;
      },
      iterator: (expr) => {
        if (!isFunction(expr)) return SET_BASE_HANDLERS.iterator(expr);
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return SET_BASE_HANDLERS.iterator(expr);
        const elements = enumerateSetComprehension(comp);
        // Non-enumerable comprehension: no iterator (`each()` yields nothing;
        // consumers should check `isFinite`/`count` first, e.g. `Reduce`)
        if (elements === undefined) return undefined;
        let i = 0;
        return {
          next: () =>
            i >= elements.length
              ? { value: undefined, done: true as const }
              : { value: elements[i++], done: false as const },
        };
      },
      // Three-valued membership: `true` when an element matches, `false`
      // only when every element is definitively different from `target`
      // (concrete values), `undefined` otherwise — e.g. a symbolic target
      // (`Element(ω, {-1, 1})`) is indeterminate, not refuted.
      contains: (expr, target) => {
        if (!isFunction(expr)) return undefined;
        const comp = parseSetComprehension(expr.ops);
        if (comp !== null) return setComprehensionContains(comp, target);
        return literalSetContains(expr.ops, target);
      },
      elttype: (expr) => {
        if (!isFunction(expr)) return SET_BASE_HANDLERS.elttype!(expr);
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return SET_BASE_HANDLERS.elttype!(expr);
        const elements = enumerateSetComprehension(comp);
        if (elements === undefined || elements.length === 0) return 'unknown';
        return widen(...elements.map((op) => op.type.type));
      },
    },
  } as OperatorDefinition,

  Length: {
    description:
      'Number of elements in a collection. Returns undefined for non-collections and for infinite collections.',
    keywords: ['size'],
    complexity: 4000,
    signature: '(any) -> integer',
    type: () => 'integer' as Type,
    evaluate: ([xs], { engine }) => {
      // Guard non-collection inputs (e.g. Length(5), Length(x+y)).
      if (!xs.isCollection) return undefined;
      if (xs.isEmptyCollection) return engine.Zero;
      const n = xs.count;
      // Guard infinite collections (e.g. Length(Repeat(5))).
      if (n === undefined || !isFinite(n)) return undefined;
      return engine.number(n);
    },
  },

  Tuple: {
    description: 'A fixed number of heterogeneous elements',
    complexity: 8200,
    signature: '(any*) -> tuple',
    type: (ops) => parseType(`tuple<${ops.map((op) => op.type).join(', ')}>`),
    canonical: (ops, { engine }) => engine.tuple(...ops),
    // A `Tuple` is inert data: it evaluates its operands but never transposes a
    // collection component into a list of points. The Desmos point-list idiom
    // (zip a tuple-with-collection into a `List` of point-tuples) lives in the
    // explicit `PointList` operator that importers emit; plain tuples stay data.
    eq: defaultCollectionEq,
    collection: {
      ...basicIndexedCollectionHandlers(),
      keys: (_expr: Expression) => {
        return ['first', 'second', 'last'];
      },
    },
  } as OperatorDefinition,

  // The Desmos point-list surface form. Explicit: importers emit it, default
  // parsing NEVER produces it from `(a, b)` (that stays an inert `Tuple`). A
  // `PointList` with one or more finite-collection components transposes to the
  // `List` of point-tuples (zip-to-shortest, scalars broadcast) — e.g.
  // `PointList(-6, n)` with `n` a 21-element list is 21 points. With no
  // collection component it is just a plain point (`Tuple`). An empty
  // collection component yields an empty `List`; an infinite/unknown-length
  // component fails closed (stays inert, no hang) via
  // `broadcastOverIndexedCollections` returning `undefined`.
  //
  // No compile handler in v1: compiling a `PointList` fails closed.
  PointList: {
    description:
      'A list of points: zips collection components into a List of point-tuples (Desmos point-list idiom); a plain point when no component is a collection.',
    complexity: 8200,
    signature: '(any+) -> any',
    type: (ops) => {
      // A list component (for typing): an indexed-collection type that is not
      // itself a tuple. Mirrors the `evaluate` predicate, but type-based.
      const isListType = (op: Expression): boolean => {
        const t = op.type.type;
        const isTupleKind = typeof t !== 'string' && t.kind === 'tuple';
        return !isTupleKind && op.type.matches('indexed_collection');
      };
      if (ops.some(isListType)) return parseType('list<tuple>');
      return parseType(`tuple<${ops.map((op) => op.type).join(', ')}>`);
    },
    evaluate: (ops, { engine: ce, numericApproximation }) => {
      const isListComponent = (op: Expression): boolean =>
        isFiniteIndexedCollection(op) && !isTuple(op);
      // Fail closed on a collection component that cannot be safely zipped —
      // infinite or unknown-length (e.g. `Range(1,∞)`) or non-indexed (a
      // Set): stay inert rather than silently degrading to a plain point.
      if (
        ops.some(
          (op) => !isTuple(op) && op.isCollection && !isListComponent(op)
        )
      )
        return undefined;
      // No collection component: a plain point.
      if (!ops.some(isListComponent)) return ce.tuple(...ops);
      // Otherwise transpose into the `List` of point-tuples.
      return broadcastOverIndexedCollections(
        ce,
        'Tuple',
        ops,
        numericApproximation ?? false
      );
    },
    // No `eq` handler: a definitive structural comparison would make
    // `PointList(1,2)` unequal to the `Tuple(1,2)` it evaluates to; the
    // generic compare path evaluates both sides instead.
  } as OperatorDefinition,

  KeyValuePair: {
    description: 'A key/value pair',
    complexity: 8200,
    signature: '(key: string, value: any) -> tuple<string, unknown>',
    type: ([_key, value]) => parseType(`tuple<string, ${value.type}>`),

    canonical: (args, { engine }) => {
      const [key, value] = checkTypes(engine, args, ['string', 'any']);
      if (!key.isValid || !value.isValid)
        return engine._fn('KeyValuePair', [key, value]);
      return engine.tuple(key, value);
    },
  },

  Keys: {
    description: 'Return a list of the keys of a dictionary.',
    complexity: 8200,
    signature: '(dictionary) -> list<string>',
    type: () => parseType('list<string>'),
    evaluate: ([dict], { engine: ce }) => {
      if (!isDictionary(dict)) return undefined;
      // Iteration order matches `each()` (both enumerate the underlying
      // key/value record in insertion order), so `Keys`, `Values` and
      // `for kv in d` agree.
      return ce.function(
        'List',
        dict.keys.map((k) => ce.string(k))
      );
    },
  },

  Values: {
    description: 'Return a list of the values of a dictionary.',
    complexity: 8200,
    signature: '(dictionary) -> list',
    type: ([dict]) => {
      const t = dict.type.type;
      if (typeof t === 'object' && t.kind === 'dictionary')
        return parseType(`list<${typeToString(t.values)}>`);
      if (typeof t === 'object' && t.kind === 'record')
        return parseType(
          `list<${typeToString(widen(...Object.values(t.elements)))}>`
        );
      return parseType('list<any>');
    },
    evaluate: ([dict], { engine: ce }) => {
      if (!isDictionary(dict)) return undefined;
      // Same insertion order as `Keys` and `each()`.
      return ce.function('List', dict.values);
    },
  },

  Single: {
    description: 'A tuple with a single element',
    complexity: 8200,
    signature: '(value: any) -> tuple<any>',
    type: ([value]) => parseType(`tuple<${value.type}>`),
    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 1)),
  },

  Pair: {
    description: 'A tuple of two elements',
    complexity: 8200,
    signature: '(first: any, second: any) -> tuple<any, any>',
    type: ([first, second]) =>
      parseType(`tuple<${first.type}, ${second.type}>`),
    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 2)),
  },

  Triple: {
    description: 'A tuple of three elements',
    complexity: 8200,
    signature: '(first: any, second: any, third: any) -> tuple<any, any, any>',
    type: ([first, second, third]) =>
      parseType(`tuple<${first.type}, ${second.type}, ${third.type}>`),

    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 3)),
  },

  //
  // Numeric Collections
  //

  Range: {
    description:
      'A sequence of numbers from a start to an end value with an optional step.',
    complexity: 8200,
    signature: '(number, number?, step: number?) -> indexed_collection<number>',

    type: (ops) => {
      // ops: [lower, upper?, step?]
      // The element type is integer iff every present operand is integer-
      // valued. Range(0.5, 2.5) iterates 0.5, 1.5, 2.5 — number, not integer.
      const allInt = ops.every((op) => op.isInteger);
      return allInt
        ? parseType('indexed_collection<integer>')
        : parseType('indexed_collection<number>');
    },

    canonical: (ops, { engine: ce }) => {
      if (ops.length === 0) return null;
      if (ops.length === 1) return ce._fn('Range', [ce.One, ops[0].canonical]);
      if (ops.length === 2)
        return ce._fn('Range', [ops[0].canonical, ops[1].canonical]);

      // We have a range with a step. The step may be an expression, which
      // we will evaluate... (when coming from the LaTeX parser, it is a Subtract expression)
      return ce._fn('Range', [
        ops[0].canonical,
        ops[1].canonical,
        ops[2].canonical.evaluate(),
      ]);
    },

    eq: (a: Expression, b: Expression) => {
      // Decline on operator mismatch when `b` could still evaluate to a
      // range (e.g. a symbol assigned a `Range`) — `eq()` in compare.ts
      // evaluates both sides and re-consults.
      if (a.operator !== b.operator)
        return b.type.matches('indexed_collection') ? undefined : false;
      // Symbolic bounds (e.g. Range(1, n)): `range()` coerces them to 1, so
      // the numeric comparison below would equate every symbolic range
      // (Range(1, n) = Range(1, m) → true). Compare structurally instead;
      // structurally different symbolic ranges are indeterminate.
      if (hasSymbolicRangeBounds(a) || hasSymbolicRangeBounds(b)) {
        if (!isFunction(a) || !isFunction(b) || a.nops !== b.nops)
          return undefined;
        return a.ops.every((op, i) => op.isSame(b.ops[i])) ? true : undefined;
      }
      const [al, au, as] = range(a);
      const [bl, bu, bs] = range(b);
      return al === bl && au === bu && as === bs;
    },

    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        // Symbolic bounds (e.g. Range(1, n)): the count is indeterminate —
        // `range()` would coerce the bound to 1 and report a count of 1.
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);
        if (step === 0) return 0;
        if (!isFinite(lower) || !isFinite(upper)) return Infinity;
        // Math.max guards a sign-mismatched step (e.g. Range(5, 1, 1)) from
        // returning a positive count. The +1 must be inside the max so an
        // empty range returns 0, not 1.
        return Math.max(0, Math.floor((upper - lower) / step) + 1);
      },

      contains: (expr, target) => {
        const t = target.re;
        // Symbolic target (no concrete numeric value): membership is
        // indeterminate unless the target's type rules it out entirely.
        // (Refute against `'number'`, not `'finite_real'`: the type
        // intersection treats incomparable numeric primitives — e.g.
        // `integer` vs `finite_real` — as disjoint, which would unsoundly
        // refute symbols of extended numeric type.)
        if (Number.isNaN(t))
          return typeMembership(target, 'number') === false ? false : undefined;
        // A non-real number (imaginary part ≠ 0) is never in a Range
        if (target.im !== 0) return false;
        if (!isFinite(t)) return false;
        // Symbolic bounds (e.g. Range(1, n)) cannot be decided structurally
        if (isFunction(expr) && expr.ops.some((op) => Number.isNaN(op.re)))
          return undefined;
        const [lower, upper, step] = range(expr);
        if (step === 0) return false;
        // Directional bounds check: t must lie between lower and upper in
        // the direction implied by step's sign.
        if (step > 0) {
          if (t < lower || t > upper) return false;
        } else {
          if (t > lower || t < upper) return false;
        }
        // Step-grid check: t must be reachable as `lower + k*step` for some
        // non-negative integer k, within engine tolerance.
        const k = (t - lower) / step;
        const tol = expr.engine.tolerance;
        const kRounded = Math.round(k);
        return kRounded >= 0 && Math.abs(k - kRounded) < tol;
      },

      iterator: (expr) => {
        // Symbolic bounds (e.g. Range(1, n)): the elements cannot be
        // enumerated — return undefined (no iterator) rather than iterating
        // the collapsed [1]. Consumers keep the lazy form (materialize) or
        // stay inert (Reduce guards on isFiniteCollection).
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);

        // Number of elements in the range. Math.max guards against a
        // sign-mismatched step (e.g. Range(0, 1, -1)) producing a negative
        // count and looping forever.
        const maxCount =
          step === 0 ? 0 : Math.max(0, Math.floor((upper - lower) / step) + 1);

        let index = 1;

        return {
          next: () => {
            if (index === maxCount + 1) return { value: undefined, done: true };
            index += 1;
            return {
              value: expr.engine.number(lower + step * (index - 1 - 1)),
              done: false,
            };
          },
        };
      },

      // Return the nth step of the range.
      // Questionable if this is useful.
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        // Symbolic bounds: whether the index is within range is indeterminate
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);
        if (step === 0) return undefined;
        const maxCount = Math.max(0, Math.floor((upper - lower) / step) + 1);
        if (index < 1 || index > maxCount) return undefined;
        return expr.engine.number(lower + step * (index - 1));
      },

      indexWhere: undefined,

      subsetOf: (expr, target) => {
        // Note: Linspace is not considered a subset of Range
        if (target.operator === 'Range') {
          // Symbolic bounds on either side: indeterminate
          if (hasSymbolicRangeBounds(expr) || hasSymbolicRangeBounds(target))
            return undefined;
          const [al, au, as] = range(expr);
          const [bl, bu, bs] = range(target);
          return al >= bl && au <= bu && as % bs === 0;
        }

        if (!target.isCollection) return false;

        let i = 1;
        for (const x of target.each()) {
          if (!expr.contains(x)) return false;
          if (!expr.at(i)?.isSame(x)) return false;
          i++;
        }
        return true;
      },

      eltsgn: (expr) => {
        // Symbolic bounds: the elements' common sign is indeterminate
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);
        if (step === 0) return 'zero';
        if (step > 0) return lower <= upper ? 'positive' : 'negative';
        return lower >= upper ? 'positive' : 'negative';
      },

      elttype: (expr) => {
        // Mirror the dynamic Range type: every present operand must be
        // integer-valued for the element type to be finite_integer.
        if (!isFunction(expr)) return 'finite_integer';
        for (let i = 1; i <= expr.nops; i++) {
          if (!(expr as any)[`op${i}`].isInteger) return 'finite_real';
        }
        return 'finite_integer';
      },
    },
  } as OperatorDefinition,

  Interval: {
    description:
      'A set of real numbers between two endpoints. The endpoints may or may not be included.',
    complexity: 8200,
    lazy: true,
    signature: '(number, number) -> set<real>',
    canonical: ([lo, hi], { engine }) => {
      if (!lo || !hi) return null;
      // Endpoints may be wrapped in `Open`/`Closed` markers and may be
      // infinite: `Interval(Open(-oo), 0)` is the ray (-∞, 0]. Unwrap the
      // markers so the endpoint values can be type-checked, then restore
      // the `Open` markers (`Closed` is the default and is normalized away).
      const unwrap = (
        op: Expression
      ): [endpoint: Expression, open: boolean] => {
        if (isFunction(op, 'Open')) return [op.op1, true];
        if (isFunction(op, 'Closed')) return [op.op1, false];
        return [op, false];
      };
      const [loVal, loOpen] = unwrap(lo);
      const [hiVal, hiOpen] = unwrap(hi);
      const [lower, upper] = checkTypes(
        engine,
        [loVal.canonical, hiVal.canonical],
        ['number', 'number']
      );
      if (!lower.isValid || !upper.isValid) return null;
      return engine._fn('Interval', [
        loOpen ? engine._fn('Open', [lower]) : lower,
        hiOpen ? engine._fn('Open', [upper]) : upper,
      ]);
    },
    eq: (a: Expression, b: Expression) => {
      const intervalA = interval(a);
      const intervalB = interval(b);
      // `b` may be an unevaluated set-valued expression (a symbol assigned
      // an interval, a set operation…): decline so `eq()` in compare.ts can
      // evaluate both sides and re-consult.
      if (!intervalB && b.type.matches('set')) return undefined;
      if (!intervalA || !intervalB) return false;
      return (
        intervalA.start === intervalB.start &&
        intervalA.end === intervalB.end &&
        intervalA.openStart === intervalB.openStart &&
        intervalA.openEnd === intervalB.openEnd
      );
    },
    collection: {
      count: (_expr) => Infinity,
      iterator: (expr) => {
        const int = interval(expr);
        if (!int) return { next: () => ({ value: undefined, done: true }) };

        // Handle empty interval
        if (int.start >= int.end) {
          return { next: () => ({ value: undefined, done: true }) };
        }

        const ce = expr.engine;
        let level = 0; // Current level in binary tree
        let index = 0; // Index within current level

        return {
          next: () => {
            // Calculate total points at this level: 2^level
            const pointsAtLevel = Math.pow(2, level);

            if (index >= pointsAtLevel) {
              // Move to next level (double the resolution)
              level++;
              index = 0;
            }

            // For level n, we have 2^n points
            // Point i at level n is at position: (2*i + 1) / 2^(n+1)
            // This creates a binary tree pattern:
            // Level 0: 1 point at 0.5 (middle)
            // Level 1: 2 points at 0.25, 0.75 (quarters)
            // Level 2: 4 points at 0.125, 0.375, 0.625, 0.875 (eighths)
            // etc.
            const t = (2 * index + 1) / Math.pow(2, level + 1);
            const value = int.start + t * (int.end - int.start);

            index++;
            return { value: ce.number(value), done: false };
          },
        };
      },
      isEmpty: (_expr) => {
        // An interval is empty if the start is greater or equal to the end
        const int = interval(_expr);
        // Symbolic endpoints: emptiness is indeterminate
        if (!int) return undefined;
        // Should account for open intervals???
        if (int.openStart && int.start === int.end) return true;
        if (int.openEnd && int.start === int.end) return true;
        if (int.openStart && int.openEnd) return false;
        return int.start >= int.end;
      },
      isFinite: (_expr) => false,
      // Three-valued membership: `true` only when both bound checks are
      // entailed, `false` when a bound check (or the type of the target)
      // refutes membership, `undefined` otherwise (e.g. symbolic target
      // with unknown bounds). Endpoints may be ±Infinity.
      contains: (expr, target) => {
        const int = interval(expr);
        // Symbolic endpoints: membership is indeterminate
        if (!int) return undefined;

        // An interval only contains (real) numbers: refute non-numbers
        // (strings, booleans, …) on type alone. Note: `'number'` rather
        // than `'real'` — the type-intersection reduction treats
        // incomparable numeric primitives (e.g. `finite_number` vs `real`)
        // as disjoint, which would unsoundly refute compound expressions
        // of indeterminate numeric type.
        if (typeMembership(target, 'number') === false) return false;

        // Concrete numeric target: decide by direct numeric comparison.
        // This is more than a fast path: it refutes non-real targets
        // (`im !== 0`), and it uses exact IEEE endpoint comparisons rather
        // than the tolerance-based symbolic comparisons below. (The
        // symbolic comparisons used to mishandle infinite endpoints, e.g.
        // `-∞ > -∞` — fixed in `cmp()` — but the exact endpoint semantics
        // still differ from the tolerance-based path.)
        const t = target.re;
        if (!Number.isNaN(t)) {
          if (target.im !== 0) return false;
          return intervalContains(int, t);
        }

        const aboveLower = int.openStart
          ? target.isGreater(int.start)
          : target.isGreaterEqual(int.start);
        if (aboveLower === false) return false;
        const belowUpper = int.openEnd
          ? target.isLess(int.end)
          : target.isLessEqual(int.end);
        if (belowUpper === false) return false;
        // A target that is provably within both bounds is comparable,
        // hence real: membership is entailed.
        if (aboveLower === true && belowUpper === true) return true;
        return undefined;
      },

      eltsgn: (expr) => {
        const i = interval(expr);
        if (!i) return 'unsigned';
        // If the interval is empty, it is unsigned
        if (i.start === i.end) return 'unsigned';

        // If the start includes 0, the interval is non-negative
        if (i.start >= 0 && !i.openStart) return 'non-negative';
        // If the end includes 0, the interval is non-positive
        if (i.end <= 0 && !i.openEnd) return 'non-positive';

        // If the start and end are both positive the interval is positive
        if (i.start > 0 && i.end > 0) return 'positive';
        // If the start and end are both negative the interval is negative
        if (i.start < 0 && i.end < 0) return 'negative';

        return undefined;
      },

      elttype: (expr) => {
        const i = interval(expr);
        if (!i) return 'never';
        if (isFinite(i.start) && isFinite(i.end)) return 'finite_real';
        return 'real';
      },
    },
  } as OperatorDefinition,

  Linspace: {
    description:
      'A sequence of evenly spaced numbers between a start and end value, both endpoints included.',
    complexity: 8200,
    signature:
      '(start: number, end: number?, count: number?) -> indexed_collection',
    // @todo: the canonical form should consider if this can be simplified to a range (if the elements are integers)

    // @todo: need eq handler
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        // A symbolic count (e.g. Linspace(0, 1, m)) is indeterminate; only a
        // *missing* count selects the default.
        if (isSymbolicOperand(expr.op3)) return undefined;
        let count = expr.op3.re;
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        return Math.max(0, Math.floor(count));
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        // Symbolic count: whether the index is in range is indeterminate
        if (isSymbolicOperand(expr.op3)) return undefined;
        const lower = expr.op1.re;
        const upper = expr.op2.re;
        let count = expr.op3.re;
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        count = Math.floor(count);
        if (!isFinite(lower) || !isFinite(upper)) return undefined;
        if (index < 1 || index > count) return undefined;
        // Linspace includes both endpoints: at(1) = lower, at(count) = upper.
        // count === 1 is a degenerate case — return lower (NumPy convention).
        if (count === 1) return expr.engine.number(lower);
        return expr.engine.number(
          lower + ((upper - lower) * (index - 1)) / (count - 1)
        );
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        // A symbolic endpoint or count cannot be enumerated (the arithmetic
        // below would yield NaN literals) — no iterator; consumers keep the
        // lazy form. Missing (`Nothing`) operands still select the defaults.
        if (expr.ops.some((op) => isSymbolicOperand(op))) return undefined;
        let lower = expr.op1.re;
        let upper = expr.op2.re;
        let totalCount: number;
        if (!isFinite(upper)) {
          upper = lower;
          lower = 1;
          totalCount = DEFAULT_LINSPACE_COUNT;
        } else {
          totalCount = Math.max(
            0,
            !isFinite(expr.op3.re) ? DEFAULT_LINSPACE_COUNT : expr.op3.re
          );
        }
        totalCount = Math.floor(totalCount);

        // Denominator for endpoint-inclusive spacing. totalCount === 1
        // yields a single sample at `lower` (matches NumPy `linspace`).
        const denom = totalCount > 1 ? totalCount - 1 : 1;

        let index = 1;

        return {
          next: () => {
            if (index === totalCount + 1)
              return { value: undefined, done: true };
            index += 1;
            return {
              value: expr.engine.number(
                lower + ((upper - lower) * (index - 1 - 1)) / denom
              ),
              done: false,
            };
          },
        };
      },
      contains: (expr, target) => {
        const t = target.re;
        // Symbolic target: indeterminate unless the type refutes membership
        // (`'number'`, not `'finite_real'` — see the Range.contains note)
        if (Number.isNaN(t))
          return typeMembership(target, 'number') === false ? false : undefined;
        if (target.im !== 0) return false;
        if (!isFinite(t)) return false;
        if (!isFunction(expr)) return undefined;
        const lower = expr.op1.re;
        const upper = expr.op2.re;
        // Symbolic bounds cannot be decided structurally
        if (Number.isNaN(lower) || Number.isNaN(upper)) return undefined;
        if (t < lower || t > upper) return false;
        // A symbolic count: the sample grid is indeterminate (the bounds
        // check above may still have refuted membership definitively)
        if (isSymbolicOperand(expr.op3)) return undefined;
        let count = expr.op3.re;
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        count = Math.floor(count);
        if (count === 0) return false;
        if (count === 1) return t === lower;
        const step = (upper - lower) / (count - 1);
        const k = (t - lower) / step;
        const tol = expr.engine.tolerance;
        const kRounded = Math.round(k);
        return (
          kRounded >= 0 && kRounded <= count - 1 && Math.abs(k - kRounded) < tol
        );
      },
    },
  },

  //
  // Operations on collections (indexed or not)
  //

  Contains: {
    description:
      'Return True if the collection contains the given element, False otherwise.',
    complexity: 8200,
    signature: '(collection, element: any) -> boolean',
    evaluate: ([xs, value], { engine: ce }) => {
      return xs.contains(value) ? ce.True : ce.False;
    },
  },

  Count: {
    description: ['Return the number of elements in the collection.'],
    keywords: ['cardinality'],
    complexity: 8200,
    signature: '(collection) -> integer',
    evaluate: ([xs], { engine }) => {
      if (xs.isEmptyCollection) return engine.Zero;
      // An indeterminate count (e.g. a set-builder over a symbolic domain)
      // stays symbolic
      const n = xs.count;
      if (n === undefined) return undefined;
      return engine.number(n);
    },
    sgn: ([xs]) => {
      const empty = xs.isEmptyCollection;
      if (empty === true) return 'zero';
      if (empty === false) return 'positive';
      return undefined;
    },
  },

  IsEmpty: {
    description: ['Return True if the collection is empty, False otherwise.'],
    complexity: 8200,
    signature: '(collection) -> boolean',
    evaluate: ([xs], { engine: ce }) =>
      xs.isEmptyCollection ? ce.True : ce.False,
  },

  // Any(collection, predicate?): True if the predicate holds for at least one
  // element (or, without a predicate, if any element is itself True). The
  // predicate is optional so a collection of booleans can be tested directly,
  // like Julia's `any(itr)`.
  Any: {
    description:
      'Return True if the predicate holds for at least one element of the collection (or if any element is True when no predicate is given).',
    complexity: 8200,
    lazy: true,
    signature: '(collection, function?) -> boolean',
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0], 'collection');
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('Any', [collection]);
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!fn) return null;
      return engine._fn('Any', [collection, fn]);
    },
    type: () => 'boolean',
    evaluate: ([collection, fn], { engine: ce }) =>
      evaluateQuantifier('Any', collection, fn, ce),
  },

  // All(collection, predicate?): True if the predicate holds for every element
  // (or, without a predicate, if every element is itself True). Vacuously True
  // for an empty collection, like Julia's `all(itr)`.
  All: {
    description:
      'Return True if the predicate holds for every element of the collection (or if every element is True when no predicate is given).',
    complexity: 8200,
    lazy: true,
    signature: '(collection, function?) -> boolean',
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0], 'collection');
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('All', [collection]);
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!fn) return null;
      return engine._fn('All', [collection, fn]);
    },
    type: () => 'boolean',
    evaluate: ([collection, fn], { engine: ce }) =>
      evaluateQuantifier('All', collection, fn, ce),
  },

  // { f(x) for x in xs }
  // { 2x | x ∈ [ 1 , 10 ] }
  Map: {
    description: [
      'Return the collection where each element has been transformed by the mapping function.',
      'With a single collection, equivalent to `[f(x) for x in xs]`. With',
      'multiple collections, combines them element-wise (like `zipWith`): ',
      '`Map(xs, ys, f) = [f(x1, y1), f(x2, y2), …]`, with the length of the',
      'shortest input. The mapping function is always the LAST argument.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection+, function) -> indexed_collection',
    // The mapped collection keeps the source's shape/indexed-ness, but its
    // elements are the lambda's RESULT type — not the source element type.
    // (If the input collection is indexed, the output collection is indexed.)
    // For the multi-collection (zipWith) form the result is always an indexed
    // collection (like `Zip`) of the lambda's result type.
    type: (ops) => {
      if (ops.length <= 2) {
        const resultType = functionResult(ops[1].type.type);
        if (!resultType || resultType === 'unknown' || resultType === 'any')
          return ops[0].type;
        return mapResultType(ops[0].type.type, resultType);
      }
      const resultType = functionResult(ops[ops.length - 1].type.type);
      return mapResultType(
        'indexed_collection',
        !resultType || resultType === 'unknown' || resultType === 'any'
          ? 'unknown'
          : resultType
      );
    },
    canonical: (ops, { engine }) => {
      // The mapping function is the LAST argument; every preceding argument is
      // a source collection. Keep the single-collection form byte-for-byte
      // identical to its historical behavior.
      if (ops.length <= 2) {
        const collection = checkType(engine, ops[0]?.canonical, 'collection');
        const fn = canonicalFunctionLiteral(ops[1]);
        if (!collection.isValid || !fn) return null;

        return engine._fn('Map', [collection, fn]);
      }

      const fn = canonicalFunctionLiteral(ops[ops.length - 1]);
      const collections = ops
        .slice(0, -1)
        .map((c) => checkType(engine, c?.canonical, 'collection'));
      if (!fn || collections.some((c) => !c.isValid)) return null;

      return engine._fn('Map', [...collections, fn]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops > 2)
          return minCount(expr.ops.slice(0, -1).map((c) => c.count));
        return expr.op1.count;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops > 2) {
          // Empty as soon as *any* source is empty (mirrors Zip).
          let anyUnknown = false;
          for (const x of expr.ops.slice(0, -1)) {
            const e = x.isEmptyCollection;
            if (e === true) return true;
            if (e === undefined) anyUnknown = true;
          }
          return anyUnknown ? undefined : false;
        }
        return expr.op1.isEmptyCollection;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops > 2) {
          // Finite as soon as *any* source is finite (mirrors Zip).
          let anyUnknown = false;
          for (const x of expr.ops.slice(0, -1)) {
            const f = x.isFiniteCollection;
            if (f === true) return true;
            if (f === undefined) anyUnknown = true;
          }
          return anyUnknown ? undefined : false;
        }
        return expr.op1.isFiniteCollection;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };

        if (expr.nops > 2) {
          // Multi-collection (zipWith): apply the mapping function to the
          // element-wise tuple of the sources, bounded by the shortest
          // input. Driven by each source's iterator — not by up-front
          // counts — so a source with an unknown count (or an infinite one
          // zipped with a finite one) still iterates; the zip ends as soon
          // as any source ends.
          const f = applicable(expr.ops[expr.nops - 1]);
          if (!f) return { next: () => ({ value: undefined, done: true }) };
          const sources = expr.ops.slice(0, -1).map((c) => c.each());
          return {
            next: () => {
              const items: Expression[] = [];
              for (const source of sources) {
                const { value, done } = source.next();
                if (done || value === undefined)
                  return { value: undefined, done: true };
                items.push(value);
              }
              const v = f(items) ?? expr.engine.Nothing;
              return { value: v, done: false };
            },
          };
        }

        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };

        const source = expr.op1.each();

        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              const v = f([value]) ?? expr.engine.Nothing;
              return { value: v, done: false };
            }
          },
        };
      },
      at: (expr: Expression, index: number | string) => {
        if (!isFunction(expr)) return undefined;
        if (typeof index !== 'number') return undefined;

        if (expr.nops > 2) {
          // Multi-collection (zipWith): f of each source's element at `index`;
          // undefined if any source has no element there — no up-front count
          // needed (a source with an unknown count still answers `at`).
          const collections = expr.ops.slice(0, -1);
          if (index < 1) return undefined;
          const items = collections.map((c) => c.at(index));
          if (items.some((x) => x === undefined)) return undefined;
          return applicable(expr.ops[expr.nops - 1])?.(items as Expression[]);
        }

        if (!expr.isIndexedCollection) return undefined;
        if (!Number.isFinite(index) || index === 0) return undefined;
        const item = expr.op1.at(index);
        if (!item) return undefined;
        return applicable(expr.op2)?.([item]);
      },
    },
  },

  Filter: {
    description: [
      'Return the elements of the collection for which the predicate function returns True.',
      'Equivalent to `[x for x in xs if p(x)]`.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection, predicate: function) -> collection',
    // If the input collection is indexed, the output collection is indexed.
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;

      return engine._fn('Filter', [collection, fn]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        // The filtered count is unknown without testing the predicate. For a
        // finite source, count the matching elements (so e.g.
        // `Sum(Filter([1,2,3], _ > 1))` can evaluate instead of bailing on an
        // `Infinity` count); an infinite source stays `Infinity`.
        if (!isFunction(expr)) return undefined;
        if (!expr.op1.isFiniteCollection) return Infinity;
        let n = 0;
        for (const _ of expr.each()) n++;
        return n;
      },
      contains: (expr, target) => {
        // True if target is in the source collection and the predicate returns
        // True for that target. Note: query the source (`op1`), not `expr` —
        // `expr.contains()` would dispatch back into this handler.
        if (!isFunction(expr)) return false;
        if (!(expr.op1.contains(target) ?? false)) return false;
        const f = applicable(expr.op2);
        return sym(f([target])) === 'True';
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };

        const source = expr.op1.each();
        let count = 0;
        const limit = expr.engine.iterationLimit;
        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              count += 1;
              if (count > limit) {
                throw new CancellationError({
                  cause: 'iteration-limit-exceeded',
                  message: `Iteration limit of ${limit} exceeded while evaluating Filter()`,
                });
              }
              if (done) return { value: undefined, done: true };
              const pred = f([value]);
              if (!pred) {
                throw new Error(
                  `Invalid filter predicate. ${spellCheckMessage(expr.op2)}`
                );
              }
              if (sym(pred) === 'True') return { value, done: false };
              if (sym(pred) !== 'False') {
                throw new Error(
                  `Filter predicate must return "True" or "False". ${spellCheckMessage(
                    expr.op2
                  )}`
                );
              }
            }
          },
        };
      },
      /**
       * Return the element at the given 1‑based `index` **after** applying the
       * filter predicate.
       *
       * * If `index` is positive, iterate through the source collection until
       *   the `index`‑th element that satisfies the predicate is found.
       * * If `index` is negative, first materialise the filtered result (only
       *   possible for finite source collections) and count from the end
       *   (‑1 → last, ‑2 → penultimate, …).
       * * For non‑numeric indexes or out‑of‑range requests, return
       *   `undefined`.
       *
       * The function never mutates the source collection and stops iterating
       * as soon as the requested element is found.
       */
      at: (
        expr: Expression,
        index: number | string
      ): Expression | undefined => {
        // Only numeric indexes are supported
        if (typeof index !== 'number' || !Number.isFinite(index) || index === 0)
          return undefined;
        if (!isFunction(expr)) return undefined;

        // Resolve the predicate
        const predicate = applicable(expr.op2);
        if (!predicate) return undefined;

        // Handle negative indexes by materialising the filtered sequence
        if (index < 0) {
          // Need a definite end to count from the back
          if (!expr.op1.isFiniteCollection) return undefined;

          const data = Array.from(expr.each()); // already filtered
          const i = data.length + index + 1; // convert ‑N to 1‑based
          if (i < 1 || i > data.length) return undefined;
          return data[i - 1];
        }

        // Positive index: stream through until we reach the desired element
        let count = 0;
        for (const item of expr.op1.each()) {
          const pred = sym(predicate([item]));
          if (pred === 'True') {
            count += 1;
            if (count === index) return item;
          } else if (pred !== 'False') {
            throw new Error(
              `Filter predicate must return "True" or "False". ${spellCheckMessage(
                expr.op2
              )}`
            );
          }
        }
        return undefined; // Not enough matching elements
      },
    },
  },

  // Haskell: "foldl"
  // For "foldr", apply Reverse() first
  Reduce: {
    description:
      'Reduce (fold) a collection to a single value by repeatedly applying a binary function, with an optional initial value.',
    complexity: 8200,
    lazy: true,
    signature: '(collection, function, initial:value?) -> value',
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0], 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;

      const initial = ops[2]?.canonical;
      if (initial?.isValid)
        return engine._fn('Reduce', [collection, fn, initial]);
      return engine._fn('Reduce', [collection, fn]);
    },

    type: (ops) => parseType(functionResult(ops[1].type.type) ?? 'unknown'),

    evaluate: (
      [collection, fn, initial],
      { engine: ce, numericApproximation }
    ) => {
      if (!collection.isFiniteCollection) return undefined;
      // A collection may report a finite count yet decline enumeration
      // (e.g. Linspace(a, 1, 3) with a symbolic endpoint: size 3, but the
      // elements have no numeric value, so its iterator returns undefined
      // and each() yields nothing). Folding that would silently produce the
      // initial value (Sum → 0): stay inert instead.
      if (enumerationDeclined(collection)) return undefined;
      const hasInitial = initial !== undefined;
      initial ??= ce.Nothing;

      // The compiled fast path folds with JS numbers, so it always yields a
      // float. Under exact evaluation that violates the Evaluate-vs-N
      // exactness contract (e.g. `a + 1/k` over a Range would collapse the
      // exact rational sum to a float). Only take it under numeric
      // approximation, or when the inputs are already inexact (a float result
      // is then correct anyway). Otherwise fall through to the interpreted
      // path, which is contract-correct.
      const inputsInexact =
        numericApproximation || (isNumber(initial) && !initial.isExact);

      if (
        inputsInexact &&
        initial.type.matches('real') &&
        collection.type.matches(ce.type('collection<real>'))
      ) {
        // If we're dealing with real numbers, we can compile.
        const compiled = ce._compile(fn);
        // Only take the compiled fast path if the function actually compiled
        // to a lambda; otherwise fall through to the interpreted path below
        // (previously this returned `undefined`, leaving Reduce unevaluated).
        if (compiled.calling === 'lambda' && compiled.run) {
          return run(
            (function* () {
              // With an explicit initial value, fold it in from the start; do
              // not overwrite it with the first element (that is only the seed
              // when no initial value was supplied).
              let accumulator = hasInitial ? initial.re : NaN;
              let first = true;
              for (const item of collection.each()) {
                if (first && !hasInitial) accumulator = item.re;
                else
                  accumulator = compiled.run!(accumulator, item.re) as number;
                first = false;
                yield;
              }
              return ce.expr(accumulator);
            })(),
            ce._timeRemaining
          );
        }
      }
      // We don't have a compiled function, so we need to use the
      // interpreted version.
      const f = applicable(fn);
      return run(
        reduceCollection<Expression>(
          collection,
          (acc, x) => f([acc, x]) ?? ce.Nothing,
          initial
        ) as Generator<Expression | undefined, Expression | undefined>,
        ce._timeRemaining
      );
    },
  },

  // Mathematica `Fold[f, x, list]`: a thin variant of `Reduce` (Haskell
  // `foldl`) with the argument order flipped so the binary function comes
  // first and the collection last. `Fold(f, x, {a, b, c}) = f(f(f(x, a), b),
  // c)`. Canonicalizes directly to the equivalent `Reduce(list, f, x)`, so it
  // shares Reduce's evaluation, laziness, and inert-when-symbolic behavior.
  Fold: {
    description:
      'Fold a collection to a single value, applying a binary function f(accumulator, element) left to right from an initial value.',
    complexity: 8200,
    lazy: true,
    signature: '(function, value, collection) -> value',
    canonical: (ops, { engine }) => {
      const fn = canonicalFunctionLiteral(ops[0]);
      const initial = ops[1]?.canonical;
      const collection = checkType(engine, ops[2], 'collection');
      if (!fn || !initial?.isValid || !collection.isValid) return null;
      return engine._fn('Reduce', [collection, fn, initial]);
    },
  },

  // Julia `accumulate`: a cumulative fold that keeps the SAME length as the
  // input (unlike Haskell/Wolfram `scanl`, which prepends the seed). Without an
  // initial value, `y1 = x1` and `yk = f(y(k-1), xk)`; with an initial value,
  // `y1 = f(initial, x1)`. Lazy — the running accumulator is computed
  // incrementally, so `Take(Scan(Range(1, 10^9), Add), 5)` stays fast.
  Scan: {
    description:
      'Return the cumulative fold of a collection: a same-length collection whose k-th element is the running result of applying a binary function left to right (optionally seeded by an initial value).',
    complexity: 8200,
    lazy: true,
    signature: '(collection, function, initial:value?) -> indexed_collection',
    // Same shape/indexed-ness as the source, but elements are the fold's
    // result type (mirrors Map).
    type: (ops) => {
      const resultType = functionResult(ops[1].type.type);
      if (!resultType || resultType === 'unknown' || resultType === 'any')
        return ops[0].type;
      return mapResultType(ops[0].type.type, resultType);
    },
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;
      // An initial value is optional, but when one is PROVIDED it must not be
      // silently dropped if invalid — otherwise `Scan(xs, f, Divide(1))` would
      // fold unseeded and diverge. Keep the (canonicalized) operand so the
      // standard error machinery surfaces the error.
      if (ops[2] !== undefined)
        return engine._fn('Scan', [collection, fn, ops[2].canonical]);
      return engine._fn('Scan', [collection, fn]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => (isFunction(expr) ? expr.op1.count : undefined),
      isEmpty: (expr) =>
        isFunction(expr) ? expr.op1.isEmptyCollection : undefined,
      isFinite: (expr) =>
        isFunction(expr) ? expr.op1.isFiniteCollection : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const hasInitial = expr.ops.length >= 3;
        const initial = expr.ops[2];
        const source = expr.op1.each();
        let acc: Expression | undefined = undefined;
        let started = false;
        return {
          next: () => {
            const { value, done } = source.next();
            if (done) return { value: undefined, done: true };
            if (!started) {
              started = true;
              acc = hasInitial
                ? f([initial, value]) ?? expr.engine.Nothing
                : value;
            } else {
              acc = f([acc!, value]) ?? expr.engine.Nothing;
            }
            return { value: acc!, done: false };
          },
        };
      },
      // The k-th cumulative element requires folding the first k source
      // elements; O(k) per call, so this stays cheap for the small indices
      // `Take` requests. Mirrors `Iterate`'s fold-from-the-start `at`.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const f = applicable(expr.op2);
        if (!f) return undefined;
        const hasInitial = expr.ops.length >= 3;
        const initial = expr.ops[2];
        let i = 0;
        let acc: Expression | undefined = undefined;
        for (const item of expr.op1.each()) {
          i += 1;
          if (i === 1)
            acc = hasInitial ? f([initial, item]) ?? expr.engine.Nothing : item;
          else acc = f([acc!, item]) ?? expr.engine.Nothing;
          if (i === index) return acc;
        }
        return undefined;
      },
    },
  },

  // Julia/R `diff`, Wolfram `Differences`: the successive differences of a
  // collection, `yk = x(k+1) − xk`. Length n−1. Lazy — keeps only the previous
  // element.
  Differences: {
    description:
      'Return the successive differences of a collection: a collection whose k-th element is `x(k+1) − xk`, of length one less than the input.',
    complexity: 8200,
    lazy: true,
    signature: '(collection) -> indexed_collection',
    type: (ops) => {
      const elt = collectionElementType(ops[0].type.type) ?? 'number';
      return parseType(`list<${typeToString(elt)}>`);
    },
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      if (!collection.isValid) return null;
      return engine._fn('Differences', [collection]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const c = expr.op1.count;
        if (c === undefined) return undefined;
        if (!Number.isFinite(c)) return Infinity;
        return Math.max(0, c - 1);
      },
      isFinite: (expr) =>
        isFunction(expr) ? expr.op1.isFiniteCollection : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        const first = source.next();
        if (first.done)
          return { next: () => ({ value: undefined, done: true }) };
        let prev = first.value as Expression;
        return {
          next: () => {
            const { value, done } = source.next();
            if (done) return { value: undefined, done: true };
            // Build each difference as a canonical subtraction and evaluate it,
            // so exact operands stay exact (e.g. 3/4 − 1/2 = 1/4, not 0.25).
            const diff = expr.engine
              .function('Subtract', [value, prev])
              .evaluate();
            prev = value as Expression;
            return { value: diff, done: false };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const a = expr.op1.at(index);
        const b = expr.op1.at(index + 1);
        if (a === undefined || b === undefined) return undefined;
        return expr.engine.function('Subtract', [b, a]).evaluate();
      },
    },
  },

  // Haskell `takeWhile`: the leading run of elements for which the predicate is
  // True; stops at (and excludes) the first element that is not True.
  TakeWhile: {
    description: [
      'Return the leading elements of the collection for which the predicate returns True, stopping at the first element that does not.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection, predicate: function) -> collection',
    // Preserve the source's element type / indexed-ness (mirrors Filter).
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;
      return engine._fn('TakeWhile', [collection, fn]);
    },
    collection: {
      isLazy: (_expr) => true,
      // Length is unknown without enumeration. For a finite source we can count
      // the taken prefix (bounded); an infinite source stays unknown.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        let n = 0;
        for (const _ of expr.each()) n++;
        return n;
      },
      // True if the source is finite (the taken prefix is then finite too);
      // for an infinite/unknown source we cannot know (it MAY be finite).
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isFiniteCollection === true
          ? true
          : undefined,
      // Empty iff the first source element already fails the predicate. Cheap
      // (one element), and keeps the collection materializable.
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isEmptyCollection === true) return true;
        const first = expr.op1.each().next();
        if (first.done) return true;
        const f = applicable(expr.op2);
        if (!f) return undefined;
        return sym(f([first.value])) !== 'True';
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        let stopped = false;
        let count = 0;
        const limit = expr.engine.iterationLimit;
        return {
          next: () => {
            if (stopped) return { value: undefined, done: true };
            const { value, done } = source.next();
            if (done) {
              stopped = true;
              return { value: undefined, done: true };
            }
            count += 1;
            if (count > limit) {
              throw new CancellationError({
                cause: 'iteration-limit-exceeded',
                message: `Iteration limit of ${limit} exceeded while evaluating TakeWhile()`,
              });
            }
            const pred = f([value]);
            // A predicate that cannot be applied at all is a broken predicate:
            // throw, as Filter does. Otherwise take while the result is exactly
            // True; stop at the first non-True result (False OR undetermined).
            if (pred === undefined) {
              throw new Error(
                `Invalid TakeWhile predicate. ${spellCheckMessage(expr.op2)}`
              );
            }
            if (sym(pred) === 'True') return { value, done: false };
            stopped = true;
            return { value: undefined, done: true };
          },
        };
      },
      // The k-th taken element: iterate the source, checking the predicate,
      // until the k-th element is reached or the prefix ends.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const f = applicable(expr.op2);
        if (!f) return undefined;
        let i = 0;
        for (const item of expr.op1.each()) {
          if (sym(f([item])) !== 'True') return undefined;
          i += 1;
          if (i === index) return item;
        }
        return undefined;
      },
    },
  },

  // Haskell `dropWhile`: discard the leading run of elements for which the
  // predicate is True, then yield everything after (the predicate is not
  // applied past the first non-True element).
  DropWhile: {
    description: [
      'Return the collection with its leading elements for which the predicate returns True removed; the remaining elements are returned unfiltered.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection, predicate: function) -> collection',
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;
      return engine._fn('DropWhile', [collection, fn]);
    },
    collection: {
      isLazy: (_expr) => true,
      // For a finite source we can count the retained suffix (bounded); an
      // infinite/unknown source stays unknown.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        let n = 0;
        for (const _ of expr.each()) n++;
        return n;
      },
      // Delegates to the source for finite sources; unknown otherwise.
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isFiniteCollection === true
          ? true
          : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        let dropping = true;
        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              if (dropping) {
                if (sym(f([value])) === 'True') continue;
                dropping = false;
              }
              return { value, done: false };
            }
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        let i = 0;
        for (const item of expr.each()) {
          i += 1;
          if (i === index) return item;
        }
        return undefined;
      },
    },
  },

  // Map then flatten one level: apply `f` to each element and splice the
  // result into the output if it is a collection, otherwise include it as a
  // single element (singleton coercion — a CAS should not error on
  // `FlatMap([1, 2], x -> x^2)`).
  FlatMap: {
    description: [
      'Map a function over a collection and concatenate the results into a single list, splicing collection-valued results and keeping scalar results as single elements.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection, function) -> list',
    type: (ops) => {
      const resultType = functionResult(ops[1].type.type);
      if (!resultType || resultType === 'unknown' || resultType === 'any')
        return parseType('list');
      const inner = collectionElementType(resultType);
      return parseType(`list<${typeToString(inner ?? resultType)}>`);
    },
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;
      return engine._fn('FlatMap', [collection, fn]);
    },
    evaluate: (ops, { engine, materialization }) => {
      if (!materialization) return undefined;
      const expr = engine._fn('FlatMap', ops);
      // Only materialize when the source is finite; an infinite source stays
      // lazy (consumers can still bound it with Take).
      if (!ops[0].isFiniteCollection) return undefined;
      return engine._fn('List', Array.from(expr.each()) as Expression[]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: (expr) =>
        isFunction(expr) && expr.op1.isEmptyCollection === true ? 0 : undefined,
      isEmpty: (expr) =>
        isFunction(expr) && expr.op1.isEmptyCollection === true
          ? true
          : undefined,
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isEmptyCollection === true
          ? true
          : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        let inner: Iterator<Expression> | null = null;
        return {
          next: () => {
            while (true) {
              if (inner) {
                const r = inner.next();
                if (!r.done) return { value: r.value, done: false };
                inner = null;
              }
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              const mapped = f([value]) ?? expr.engine.Nothing;
              if (mapped.isCollection) inner = mapped.each();
              else return { value: mapped, done: false };
            }
          },
        };
      },
      // Nested access requires walking the flattened stream up to `index`
      // (O(index)); FlatMap is `list`-typed, so an `at` handler is required.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        let i = 0;
        for (const item of expr.each()) {
          i += 1;
          if (i === index) return item;
        }
        return undefined;
      },
    },
  },

  Join: {
    description: [
      'Join the elements of some collections into a flat collection.',
    ],
    complexity: 8200,
    signature: '(collection*) -> collection',
    type: joinResultType,
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        let total = 0;
        for (const op of expr.ops) {
          const count = op.count;
          if (count === undefined) return undefined;
          if (!Number.isFinite(count)) return Infinity;
          total += count;
        }
        return total;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        return expr.ops.some((op) => op.contains(target));
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const iters = expr.ops.map((op) => op.each());
        let index = 0;
        return {
          next: () => {
            while (true) {
              const { value, done } = iters[index].next();
              if (!done) return { value, done: false };
              index += 1;
              // No more sources?
              if (index >= iters.length)
                return { value: undefined, done: true };
            }
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || !isFunction(expr)) return undefined;

        // A negative index counts from the end of the joined collection
        if (index < 0) {
          let total = 0;
          for (const op of expr.ops) {
            const count = op.count;
            if (count === undefined || !Number.isFinite(count))
              return undefined;
            total += count;
          }
          index = total + index + 1;
        }
        if (index < 1) return undefined;

        // Walk the sources, skipping over each one's elements
        for (const op of expr.ops) {
          const count = op.count;
          if (count === undefined) return undefined;
          if (index <= count) return op.at(index);
          index -= count;
        }
        return undefined;
      },
    },
  },

  // Mathematica `Append[collection, element]`: the collection with `element`
  // added at the end. Lazy, like `Join` — it wraps its source rather than
  // materializing, so appending to an infinite collection stays inert until
  // forced. `element` is the second operand (not itself a collection).
  Append: {
    description: ['Add an element to the end of a collection.'],
    complexity: 8200,
    signature: '(collection, value) -> collection',
    type: (ops) => joinResultType([ops[0]]),
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        if (!Number.isFinite(count)) return Infinity;
        return count + 1;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      isEmpty: (_expr) => false, // always contains at least the appended element
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        return expr.op1.contains(target) || expr.op2.isSame(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        let appended = false;
        return {
          next: () => {
            const { value, done } = source.next();
            if (!done) return { value, done: false };
            // Source exhausted: yield the appended element once, then stop.
            if (!appended) {
              appended = true;
              return { value: expr.op2, done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || !isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined || !Number.isFinite(count)) return undefined;
        const total = count + 1;
        // A negative index counts from the end of the appended collection.
        if (index < 0) index = total + index + 1;
        if (index < 1) return undefined;
        if (index <= count) return expr.op1.at(index);
        if (index === total) return expr.op2;
        return undefined;
      },
    },
  },

  //
  // Operations on indexed collections
  //

  At: {
    description: [
      'Access an element of an indexed collection.',
      'If the index is negative, it is counted from the end.',
      'Multiple indices can be provided to access nested collections (e.g., matrices).',
      'If the index is a finite collection of booleans, returns the elements where the mask is True.',
      'If the index is a finite collection of integers, returns the elements at those indices.',
    ],
    complexity: 8200,
    signature:
      '(value: indexed_collection | dictionary, index: (number|string|boolean|indexed_collection)+) -> unknown',
    type: (ops) => {
      const xs = ops[0];
      const t = xs.type.type;
      // A dictionary/record is a keyed collection whose `At` returns the
      // VALUE, not the iteration pair `tuple<string, T>` that
      // `collectionElementType` reports (that is correct for iteration, but
      // wrong here). Special-case it.
      if (typeof t === 'string') {
        if (t === 'dictionary' || t === 'record') return 'any';
      } else if (t.kind === 'dictionary') {
        return t.values;
      } else if (t.kind === 'record') {
        // A literal string index selecting a known field yields that field's
        // type; otherwise widen across all field value types.
        const key = ops[1];
        if (key && isString(key)) {
          const fieldType = t.elements[key.string];
          if (fieldType) return fieldType;
        }
        return widen(...Object.values(t.elements)) as Type;
      }
      return (
        xs.operatorDefinition?.collection?.elttype?.(xs) ??
        collectionElementType(t) ??
        'any'
      );
    },

    // Custom canonical handler delegating operand validation to
    // `validateArguments` (matching the standard signature-validation flags).
    // The index type accepts `boolean` so a Desmos filter condition that only
    // *becomes* a `list<boolean>` at evaluate — e.g. `L[|[1...n]-i|>0]`, whose
    // condition `|…|>0` is a broadcast expression typed scalar `boolean` before
    // evaluation (its operand is not yet a materialized collection) — passes
    // canonicalization. At evaluate the condition broadcasts to a boolean list
    // and the mask branch (Case B) fires. A genuinely scalar boolean index that
    // stays scalar leaves `At` unevaluated (see Case C).
    // The value operand additionally tolerates an operand whose number type
    // was merely *inferred* (not declared): inference is retractable, and an
    // untyped function parameter used as `a[1]` may only resolve to a
    // collection when the function is applied. Rejecting it here would
    // permanently invalidate the definition (see `isDeclaredScalarNumber`).
    canonical: (ops, { engine: ce }) => {
      // `ops` are already canonical (At is not lazy).
      const adjusted = validateArguments(ce, ops, AT_SIGNATURE, false, false);

      // `null` → every operand matched; nothing to relax.
      if (!adjusted) return ce._fn('At', ops);

      const patched = [...adjusted];
      const value = ops[0];
      // Restore the value operand when it failed only because its number type
      // is inferred and thus retractable (may still resolve to a collection).
      if (
        value?.isValid &&
        patched[0]?.operator === 'Error' &&
        value.type.matches('number') &&
        !isDeclaredScalarNumber(value)
      )
        patched[0] = value;

      return ce._fn('At', patched);
    },

    evaluate: (ops, { engine: ce }) => {
      // @todo: the implementation does not match the description. Need to think this through...
      let expr = ops[0];
      let index = 1;
      while (ops[index]) {
        const opAtIndex = ops[index];

        // Dictionary key access: a `dictionary` is a keyed (not indexed)
        // collection with no `collection.at` handler, so look the value up by
        // its string key directly. Only string keys are supported; a missing
        // key yields `Nothing`, a non-string index leaves `At` unevaluated.
        if (isDictionary(expr)) {
          if (!isString(opAtIndex)) return undefined;
          expr = expr.get(opAtIndex.string) ?? ce.Nothing;
          index += 1;
          continue;
        }

        const def = expr.baseDefinition;
        const at = def?.collection?.at;
        if (!at) return undefined;

        // Case A: string key (dictionary-style access).
        const s = isString(opAtIndex) ? opAtIndex.string : undefined;
        if (s !== undefined) {
          expr = at(expr, s) ?? ce.Nothing;
          index += 1;
          continue;
        }

        // Case B: finite collection index — boolean mask or integer list.
        if (opAtIndex.isCollection && opAtIndex.isFiniteCollection) {
          const indices = Array.from(opAtIndex.each()) as Expression[];
          const isMask = indices.every((m) => {
            const name = sym(m);
            return name === 'True' || name === 'False';
          });

          const picked: Expression[] = [];
          if (isMask) {
            // Boolean mask: keep element i when mask[i] is True. Mask
            // entries past the end of the source contribute nothing.
            indices.forEach((m, i) => {
              if (sym(m) !== 'True') return;
              const v = at(expr, i + 1);
              if (v !== undefined) picked.push(v);
            });
          } else {
            // Integer-list pick: select element at each integer index.
            // Out-of-range indices are dropped.
            for (const m of indices) {
              const k = m.re;
              if (!Number.isInteger(k)) return undefined;
              const v = at(expr, k);
              if (v !== undefined) picked.push(v);
            }
          }

          expr = ce._fn('List', picked);
          index += 1;
          continue;
        }

        // Case C: primitive integer index.
        const i = opAtIndex.re;
        if (!Number.isInteger(i)) return undefined;
        expr = at(expr, i) ?? ce.Nothing;
        index += 1;
      }
      return expr;
    },
  },

  // Miranda: `take` (also Haskell)
  Take: {
    description: ['Return `n` elements from a collection.'],
    complexity: 8200,
    signature: '(xs: indexed_collection, count: number) -> indexed_collection',
    type: ([xs]) =>
      `list<${typeToString(collectionElementType(xs.type.type) ?? 'any')}>`,
    // No `evaluate` handler: materialization goes through the generic lazy-
    // collection path, driven by the `count`/`at`/`iterator` handlers below.
    // (A previous handler materialized eagerly from its operands — but the
    // operands are evaluated first, so an unknown-length lazy source arrived
    // already collapsed to its display preview, placeholder included, and
    // `Take` returned the preview's elements instead of its own.)
    collection: {
      isLazy: (_expr) => true,
      count: takeCount,
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        const [xs, op2] = expr.ops;
        if (xs.isEmptyCollection) return true;
        if (xs.isFiniteCollection === false) return false;
        const n = Math.max(0, toInteger(op2) ?? 0);
        // A known non-empty source with n ≥ 1 gives a non-empty Take even
        // when the source's count is unknown (e.g. Dedup of an infinite
        // Iterate) — required for the generic materializer, which keeps the
        // lazy form when emptiness is indeterminate.
        if (xs.isEmptyCollection === false && n >= 1) return false;
        const count = xs.count;
        if (count === undefined) return undefined;
        if (!Number.isFinite(n)) return false;
        return Math.min(count, n) === 0;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      iterator: takeIterator,
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || index === 0) return undefined;
        if (!isFunction(expr)) return undefined;
        const n = Math.max(0, toInteger(expr.op2) ?? 0);
        if (n === 0) return undefined;

        if (index > 0) {
          if (index > n) return undefined;
          return expr.op1.at(index);
        }

        const count = takeCount(expr);
        if (count === undefined || count === 0) return undefined;
        if (index < -count) return undefined;
        // Negative index counts from the end: at(-1) is the count-th element.
        return expr.op1.at(count + index + 1);
      },
    },
  },

  // Miranda: `drop` (also Haskell)
  Drop: {
    description: ['Return the collection without the first n elements.'],
    complexity: 8200,
    signature: '(xs: indexed_collection, count: number) -> indexed_collection',
    type: ([xs]) =>
      `list<${typeToString(collectionElementType(xs.type.type) ?? 'any')}>`,
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const [xs, n] = expr.ops;
        const count = xs.count;
        if (count === undefined) return undefined;
        if (!Number.isFinite(count)) return Infinity;
        if (xs.isEmptyCollection) return 0;
        const nValue = toInteger(n) ?? 0;
        if (nValue >= count) return 0;
        return Math.max(0, count - nValue);
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const [xs, nExpr] = expr.ops;

        const n = toInteger(nExpr) ?? 0;
        if (n <= 0) return xs.each();

        const count = xs.count;
        let index = n + 1;

        return {
          next: () => {
            // Stop at the end of a finite collection: `List.at()` returns an
            // Error (not `undefined`) past the end, so the count bound is what
            // reliably terminates iteration.
            if (count !== undefined && index > count)
              return { value: undefined, done: true };
            const value = xs.at(index++);
            if (value === undefined) return { value: undefined, done: true };
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const [xs, nExpr] = expr.ops;

        const n = toInteger(nExpr) ?? 0;
        // Dropping <= 0 elements is the identity (matches the iterator, which
        // returns `xs.each()` for n <= 0).
        if (n <= 0) return xs.at(index);

        // A negative index counts from the end. Dropping from the front does
        // not move the tail, so `xs.at(index)` is already correct — but reject
        // indices that would reach back into the dropped prefix.
        if (index < 0) {
          const count = xs.count;
          if (count !== undefined && -index > count - n) return undefined;
          return xs.at(index);
        }
        if (index < 1) return undefined;
        return xs.at(index + n);
      },
    },
  },

  First: {
    description: 'The first element of a collection.',
    complexity: 8200,
    signature: '(any) -> any',
    type: ([xs]) => componentType(xs, 1),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, 1, ce),
  },

  Second: {
    description: 'The second element of a collection.',
    complexity: 8200,
    signature: '(any) -> any',
    type: ([xs]) => componentType(xs, 2),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, 2, ce),
  },

  Third: {
    description: 'The third element of a collection.',
    complexity: 8200,
    signature: '(any) -> any',
    type: ([xs]) => componentType(xs, 3),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, 3, ce),
  },

  // Point-coordinate accessors (`.x`/`.y`/`.z`). On a single point they return
  // the coordinate; on a list of points they broadcast, returning the list of
  // coordinates (Desmos semantics). Distinct from First/Second/Third, which
  // index a collection — see `pointComponentAt`.
  PointX: {
    description:
      'The x-coordinate of a point, broadcasting over a list of points.',
    complexity: 8200,
    signature: '(any) -> any',
    type: ([xs]) => pointComponentType(xs, 1),
    evaluate: ([xs], { engine: ce }) => pointComponentAt(xs, 1, ce),
  },

  PointY: {
    description:
      'The y-coordinate of a point, broadcasting over a list of points.',
    complexity: 8200,
    signature: '(any) -> any',
    type: ([xs]) => pointComponentType(xs, 2),
    evaluate: ([xs], { engine: ce }) => pointComponentAt(xs, 2, ce),
  },

  PointZ: {
    description:
      'The z-coordinate of a point, broadcasting over a list of points.',
    complexity: 8200,
    signature: '(any) -> any',
    type: ([xs]) => pointComponentType(xs, 3),
    evaluate: ([xs], { engine: ce }) => pointComponentAt(xs, 3, ce),
  },

  Last: {
    description: 'The last element of a collection.',
    complexity: 8200,
    signature: '(collection) -> any',
    type: ([xs]) => componentType(xs, -1),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, -1, ce),
  },

  Rest: {
    description: [
      'Return the collection without the first element.',
      'If the collection has only one element, return an empty collection.',
    ],
    complexity: 8200,
    signature: '(indexed_collection) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return Math.max(0, count - 1);
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isEmptyCollection) return true;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return count <= 1;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        // Rest yields the collection without its first element, i.e. starting
        // at the second element. `index` must persist across `next()` calls.
        const op1 = expr.op1;
        const count = op1.count;
        let index = 2;
        return {
          next: () => {
            // Terminate at the end of a finite collection. `List.at()` returns
            // an Error (not `undefined`) past the end, so the count bound is
            // what reliably stops iteration; the `undefined` check covers
            // unbounded collections.
            if (count !== undefined && index > count)
              return { value: undefined, done: true };
            const value = op1.at(index);
            if (value === undefined) return { value: undefined, done: true };
            index += 1;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;

        return expr.op1.at(index > 0 ? index + 1 : index);
      },
    },
  },

  Most: {
    complexity: 8200,
    description: [
      'Return the collection without the last element.',
      'If the collection has only one element, return an empty collection.',
    ],
    signature: '(indexed_collection) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return Math.max(0, count - 1);
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return count <= 1;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const l = expr.op1.count;
        if (l === undefined || l <= 1)
          return { next: () => ({ value: undefined, done: true }) };

        let index = 1;
        const last = l - 1;
        return {
          next: () => {
            if (index > last) return { value: undefined, done: true };
            const value = expr.op1.at(index++)!;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l - 1) return undefined;
        return expr.op1.at(index);
      },
    },
  },

  Slice: {
    description: [
      'Return a range of elements from an indexed collection.',
      'If the index is negative, it is counted from the end.',
    ],
    complexity: 8200,
    signature:
      '(value: indexed_collection, start: number, end: number) -> list',
    type: ([xs]) =>
      parseType(
        `list<${typeToString(collectionElementType(xs.type.type) ?? 'any')}>`
      ),
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        // Resolve start/end the same way the `at` and `iterator` handlers do,
        // so all three agree (negative indices count from the end).
        let start = toInteger(expr.op2) ?? 1;
        if (start < 1) start = count + 1 + start;
        if (start < 1) start = 1;
        if (start > count) return 0;
        let end = toInteger(expr.op3) ?? count;
        if (end < 1) end = count + 1 + end;
        if (end < 1) end = 1;
        if (end > count) end = count;
        return Math.max(0, end - start + 1);
      },
      isFinite: (_expr) => true,
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        let start = toInteger(expr.op2) ?? 1;
        if (start < 1) start = count + 1 + start; // Convert negative index to positive
        if (start < 1) start = 1; // Ensure start is at least 1
        if (start > count) return undefined; // Start is beyond the end of the collection
        let end = toInteger(expr.op3) ?? count;
        if (end < 1) end = count + 1 + end; // Convert negative index to positive
        if (end < 1) end = 1; // Ensure end is at least 1
        if (end > count) end = count; // Ensure end is within bounds

        // `index` is 1-based within the slice; a negative index counts from
        // the end of the slice. Return the element at that position.
        const length = end - start + 1;
        if (length <= 0) return undefined;
        if (index < 0) index = length + 1 + index;
        if (index < 1 || index > length) return undefined;
        return expr.op1.at(start + index - 1);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        let start = toInteger(expr.op2) ?? 1;
        const count = expr.op1.count;
        if (count === undefined)
          return { next: () => ({ value: undefined, done: true }) };
        if (start < 1) start = count + 1 + start; // Convert negative index to positive
        if (start < 1) start = 1; // Ensure start is at least 1
        if (start > count)
          return { next: () => ({ value: undefined, done: true }) };
        let end = toInteger(expr.op3) ?? count;
        if (end < 1) end = count + 1 + end; // Convert negative index to positive
        if (end < 1) end = 1; // Ensure end is at least 1
        if (end > count) end = count;

        let index = start;
        const last = end;

        return {
          next: () => {
            if (index > last) return { value: undefined, done: true };
            const value = expr.op1.at(index)!;
            index += 1;
            return { value, done: false };
          },
        };
      },
    },
  },

  // APL: rotate ⌽
  Reverse: {
    description: 'Reverse the order of the elements of an indexed collection.',
    complexity: 8200,
    signature: '(indexed_collection) -> indexed_collection',
    type: ([xs]) => xs.type,
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.count;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        return expr.op1.contains(target) ?? false;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        // Walk `op1` from the last element to the first using negative
        // (from-the-end) indices, so this works even when `op1.count` isn't
        // known upfront. Termination must be based on `.at()` returning
        // `undefined` (out of range), not on `index` reaching a sentinel
        // value: previously this compared `index === 0`, but `index` starts
        // at -1 and is decremented (-1, -2, -3, …), so it never equals 0 and
        // the iterator ran past the end, yielding `undefined` "elements"
        // forever (surfacing as a raw "Cannot read properties of undefined"
        // once a consumer called `.evaluate()` on one of them).
        let index = -1;
        return {
          next: () => {
            const value = expr.op1.at(index);
            if (value === undefined) return { value: undefined, done: true };
            index -= 1;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        return expr.op1.at(-index);
      },
    },
  },

  // Elixir `List.insert_at/3`: return a copy with `value` inserted before the
  // 1-based `index`. Eager on finite indexed collections; inert otherwise. The
  // result head is always `List` (rebuilding a Range/other structured source
  // from its materialized operands would be wrong).
  Insert: {
    description: [
      'Return a copy of the indexed collection with `value` inserted before the 1-based `index`.',
      '`index` may range from 1 to n+1 (n+1 appends). A negative index counts from the end, with -1 appending at the end (Elixir semantics).',
      'An out-of-range, zero, or non-integer index leaves the expression unevaluated.',
    ],
    complexity: 8200,
    signature: '(indexed_collection, integer, value) -> list',
    // Element type widens to include the inserted value's type.
    type: (ops) =>
      parseType(
        `list<${typeToString(
          widen(collectionElementType(ops[0].type.type) ?? 'any', ops[2].type.type)
        )}>`
      ),
    evaluate: ([xs, idx, value], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const index = toInteger(idx);
      if (index === null || index === 0) return undefined;
      const all = Array.from(xs.each()) as Expression[];
      const n = all.length;
      // Convert the 1-based `index` (negative counts from the end, with -1
      // appending) to a 0-based gap position in 0..n.
      let gap: number;
      if (index > 0) {
        if (index > n + 1) return undefined;
        gap = index - 1;
      } else {
        if (index < -(n + 1)) return undefined;
        gap = n + 1 + index;
      }
      return ce.function('List', [
        ...all.slice(0, gap),
        value,
        ...all.slice(gap),
      ]);
    },
  },

  // Elixir `List.delete_at/2`: return a copy with the element at the 1-based
  // `index` removed. Eager on finite indexed collections; inert otherwise.
  DeleteAt: {
    description: [
      'Return a copy of the indexed collection with the element at the 1-based `index` removed.',
      'A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.',
    ],
    complexity: 8200,
    signature: '(indexed_collection, integer) -> list',
    type: (ops) =>
      parseType(
        `list<${typeToString(collectionElementType(ops[0].type.type) ?? 'any')}>`
      ),
    evaluate: ([xs, idx], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const index = toInteger(idx);
      if (index === null) return undefined;
      const all = Array.from(xs.each()) as Expression[];
      const n = all.length;
      // Convert the 1-based `index` (negative counts from the end) to a 0-based
      // position in 0..n-1.
      let i0: number;
      if (index > 0) {
        if (index > n) return undefined;
        i0 = index - 1;
      } else if (index < 0) {
        if (index < -n) return undefined;
        i0 = n + index;
      } else return undefined;
      return ce.function('List', [...all.slice(0, i0), ...all.slice(i0 + 1)]);
    },
  },

  // Elixir `List.replace_at/3`: return a copy with the element at the 1-based
  // `index` replaced by `value`. Eager on finite indexed collections; inert
  // otherwise.
  ReplaceAt: {
    description: [
      'Return a copy of the indexed collection with the element at the 1-based `index` replaced by `value`.',
      'A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.',
    ],
    complexity: 8200,
    signature: '(indexed_collection, integer, value) -> list',
    // Element type widens to include the replacement value's type.
    type: (ops) =>
      parseType(
        `list<${typeToString(
          widen(collectionElementType(ops[0].type.type) ?? 'any', ops[2].type.type)
        )}>`
      ),
    evaluate: ([xs, idx, value], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const index = toInteger(idx);
      if (index === null) return undefined;
      const all = Array.from(xs.each()) as Expression[];
      const n = all.length;
      let i0: number;
      if (index > 0) {
        if (index > n) return undefined;
        i0 = index - 1;
      } else if (index < 0) {
        if (index < -n) return undefined;
        i0 = n + index;
      } else return undefined;
      const out = [...all];
      out[i0] = value;
      return ce.function('List', out);
    },
  },

  RotateLeft: {
    description:
      'Rotate the elements of the collection to the left by n positions.',
    complexity: 8200,
    signature: '(indexed_collection, integer?) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.count;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        return expr.op1.contains(target) ?? false;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const l = expr.op1.count;
        if (l === undefined || l <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        let index = 1;
        const last = l;

        return {
          next: () => {
            if (index === last + 1) return { value: undefined, done: true };
            index += 1;
            const v = expr.op1.at(((index - 1 - 1 + n) % l) + 1);
            if (v === undefined) return { value: undefined, done: true };
            return { value: v, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined || l <= 0) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l) return undefined;
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        return expr.op1.at(((index - 1 + n) % l) + 1);
      },
    },
  },

  RotateRight: {
    description:
      'Rotate the elements of the collection to the right by n positions.',
    complexity: 8200,
    signature: '(indexed_collection, integer?) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.count;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        return expr.op1.contains(target) ?? false;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const l = expr.op1.count;
        if (l === undefined || l <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        let index = 1;

        return {
          next: () => {
            if (index === l + 1) return { value: undefined, done: true };
            index += 1;
            const i = ((index - 1 - 1 + (l - n)) % l) + 1;
            const v = expr.op1.at(i);
            if (v === undefined) return { value: undefined, done: true };
            return { value: v, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined || l <= 0) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l) return undefined;
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift
        const i = ((index - 1 + (l - n)) % l) + 1;
        return expr.op1.at(i);
      },
    },
  },
  // Return a list of the elements of each collection.
  // If all collections are Set, return a Set
  // ["Join", ["List", 1, 2, 3], ["List", 4, 5, 6]] -> ["List", 1, 2, 3, 4, 5, 6]

  IndexOf: {
    description:
      'Return the 1-based index of the first occurrence of value in collection, or 0 if not found.',
    complexity: 8200,
    signature: '(collection, any) -> integer',
    evaluate: ([xs, value], { engine: ce }) => {
      const index = xs.indexWhere((x) => x.isSame(value)) ?? undefined;
      return ce.number(index ?? 0);
    },
  },

  IndexWhere: {
    description:
      'Return the 1-based index of the first element satisfying the predicate, or 0 if not found.',
    complexity: 8200,
    signature: '(collection, function) -> integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Zero;
      const index =
        xs.indexWhere((x) => {
          const pred = sym(f([x]));
          if (pred === 'True') return true;
          if (pred === 'False') return false;
          throw new Error(
            `Filter predicate must return "True" or "False". ${spellCheckMessage(
              fn
            )}`
          );
        }) ?? undefined;
      return ce.number(index ?? 0);
    },
  },

  Find: {
    description:
      'Return the first element of the collection satisfying the predicate, or Nothing if none found.',
    complexity: 8200,
    signature: '(collection, function) -> any',
    type: (ops) => ops[0].type,
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Nothing;
      for (const item of xs.each()) {
        const pred = sym(f([item]));
        if (pred === 'False') continue;
        if (pred === 'True') return item;
        throw new Error(
          `Filter predicate must return "True" or "False". ${spellCheckMessage(
            fn
          )}`
        );
      }
      return ce.Nothing;
    },
  },

  CountIf: {
    description:
      'Return the number of elements in the collection satisfying the predicate.',
    complexity: 8200,
    signature: '(collection, function) -> integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Zero;
      let count = 0;
      for (const item of xs.each()) {
        const pred = sym(f([item]));
        if (pred === 'False') continue;
        if (pred === 'True') count++;
        else
          throw new Error(
            `Filter predicate must return "True" or "False". ${spellCheckMessage(
              fn
            )}`
          );
      }
      return ce.number(count);
    },
  },

  Position: {
    description:
      'Return a list of indexes of elements in the collection satisfying the predicate.',
    complexity: 8200,
    signature: '(collection, function) -> list<integer>',
    type: () => 'list<integer>',
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.function('List', []);
      const indices: Expression[] = [];
      let index = 1;
      for (const item of xs.each()) {
        const pred = sym(f([item]));
        if (pred === 'True') indices.push(ce.number(index));
        else if (pred !== 'False')
          throw new Error(
            `Filter predicate must return "True" or "False". ${spellCheckMessage(
              fn
            )}`
          );
        index++;
      }
      return ce.function('List', indices);
    },
  },

  // Return the indexes of the elements so they are in sorted order.
  // `Sort` is equivalent to `["Take", xs, ["Ordering", xs]]`.
  // APL: Grade Up `⍋` and Grade Down `⍒`
  // Mathematica: `Ordering`
  Ordering: {
    description: 'Return the indexes that would sort the collection.',
    complexity: 8200,
    signature: '(indexed_collection, function?) -> list<integer>',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return ce.function('List', []);
      const indices = sortedIndices(xs, fn);
      if (!indices) return ce.function('List', []);
      return ce.function('List', indices);
    },
  },

  Sort: {
    description:
      'Return the elements of the collection sorted according to the given comparison function.',
    complexity: 8200,
    signature: '(indexed_collection, function?) -> indexed_collection',
    type: (ops) => ops[0].type,
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return ce.function(xs.operator, []);
      const indices = sortedIndices(xs, fn);
      if (!indices) return undefined;
      return ce.function(
        xs.operator,
        indices.map((i) => xs.at(i)!)
      );
    },
  },

  // Return the element of the collection that maximizes/minimizes the unary
  // key `f(x)`. First occurrence wins ties. Eager and inert (undefined) on a
  // non-finite or empty collection, or when a key comparison is undetermined.
  MaxBy: {
    description:
      'Return the element of the collection that maximizes the given key function.',
    complexity: 8200,
    lazy: true,
    signature: '(collection, function) -> value',
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0], 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;
      return engine._fn('MaxBy', [collection, fn]);
    },
    type: (ops) => collectionElementType(ops[0].type.type) ?? 'any',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      return run(extremumBy(xs, f, ce, 'max', 'element'), ce._timeRemaining);
    },
  },

  MinBy: {
    description:
      'Return the element of the collection that minimizes the given key function.',
    complexity: 8200,
    lazy: true,
    signature: '(collection, function) -> value',
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0], 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;
      return engine._fn('MinBy', [collection, fn]);
    },
    type: (ops) => collectionElementType(ops[0].type.type) ?? 'any',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      return run(extremumBy(xs, f, ce, 'min', 'element'), ce._timeRemaining);
    },
  },

  // Return the 1-based index (Julia semantics) of the element maximizing/
  // minimizing the unary key `f(x)`, or the element itself as the key when `f`
  // is absent. First occurrence wins ties. Inert on non-finite/empty
  // collections or undetermined comparisons.
  ArgMax: {
    description:
      'Return the 1-based index of the element that maximizes the given key function (or the element itself when no key is given).',
    complexity: 8200,
    lazy: true,
    signature: '(indexed_collection, function?) -> integer',
    canonical: (ops, { engine }) => {
      // Optimization form `ArgMax(f, domain)` (Wolfram/Fungrim convention:
      // the locations maximizing f over a set). The engine does not evaluate
      // it, but it must canonicalize the function operand normally — the
      // identities library ships rewrite rules whose stored patterns are the
      // canonical (Block-wrapped) function form; short-circuiting here left
      // the operand un-wrapped and made those patterns unmatchable.
      const optForm = canonicalOptimumForm(engine, 'ArgMax', ops);
      if (optForm !== undefined) return optForm;
      // An index result only makes sense for an INDEXED collection — match
      // the declared signature (MaxBy/MinBy, which return the element,
      // accept any collection).
      const collection = checkType(engine, ops[0], 'indexed_collection');
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('ArgMax', [collection]);
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!fn) return null;
      return engine._fn('ArgMax', [collection, fn]);
    },
    type: () => 'integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = fn ? applicable(fn) : undefined;
      return run(extremumBy(xs, f, ce, 'max', 'index'), ce._timeRemaining);
    },
  },

  ArgMin: {
    description:
      'Return the 1-based index of the element that minimizes the given key function (or the element itself when no key is given).',
    complexity: 8200,
    lazy: true,
    signature: '(indexed_collection, function?) -> integer',
    canonical: (ops, { engine }) => {
      // Optimization form `ArgMin(f, domain)` — see the ArgMax note.
      const optForm = canonicalOptimumForm(engine, 'ArgMin', ops);
      if (optForm !== undefined) return optForm;
      // An index result only makes sense for an INDEXED collection — match
      // the declared signature (MaxBy/MinBy, which return the element,
      // accept any collection).
      const collection = checkType(engine, ops[0], 'indexed_collection');
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('ArgMin', [collection]);
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!fn) return null;
      return engine._fn('ArgMin', [collection, fn]);
    },
    type: () => 'integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = fn ? applicable(fn) : undefined;
      return run(extremumBy(xs, f, ce, 'min', 'index'), ce._timeRemaining);
    },
  },

  // Randomize the order of the elements in the collection.
  Shuffle: {
    description:
      'Randomize the order of the elements in the collection. ' +
      'With an optional `seed` argument, the shuffle is deterministic.',
    complexity: 8200,
    signature: '(indexed_collection, real?) -> indexed_collection',
    type: (ops) => ops[0].type,
    evaluate: ([xs, seedOp], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;

      const data = Array.from(xs.each());
      const seed = seedOp?.re;
      if (seed !== undefined && !Number.isNaN(seed)) {
        // Deterministic Fisher-Yates with advancing seed.
        let s = seed;
        for (let i = data.length - 1; i > 0; i--) {
          const j = Math.floor(deterministicRandom(s) * (i + 1));
          [data[i], data[j]] = [data[j], data[i]];
          s = nextSeed(s);
        }
      } else {
        // No explicit seed: draw from the engine's seeded stream when
        // `ce.randomSeed` is set, otherwise non-deterministic Fisher-Yates.
        for (let i = data.length - 1; i > 0; i--) {
          const j = Math.floor(ce._random() * (i + 1));
          [data[i], data[j]] = [data[j], data[i]];
        }
      }

      return ce.function(xs.operator, data);
    },
  },

  Tabulate: {
    description:
      'Create a collection by applying a function to each index in the specified dimensions.',
    keywords: ['table'],
    complexity: 8200,

    lazy: true,
    signature: '(function, integer, integer?) -> indexed_collection',
    // Tabulate is an INDEXED collection (ordered, `at`-addressable). Report the
    // element type so it serializes as a list `[…]`, not a set `{…}`: for a 1-D
    // tabulation the element is the function's result; for higher rank each
    // element is itself a (nested) list.
    type: (ops) => {
      if (ops.length <= 1) return parseType('indexed_collection');
      if (ops.length === 2) {
        const elt = functionResult(ops[0].type.type) ?? 'any';
        return parseType(`indexed_collection<${typeToString(elt)}>`);
      }
      return parseType('indexed_collection<list>');
    },
    canonical: (ops, { engine }) => {
      const fn = canonicalFunctionLiteral(ops[0]);
      if (!fn) return null;

      if (!ops[2])
        return engine._fn('Tabulate', [
          fn,
          checkType(engine, ops[1]?.canonical, 'integer'),
        ]);

      return engine._fn('Tabulate', [
        fn,
        checkType(engine, ops[1]?.canonical, 'integer'),
        checkType(engine, ops[2]?.canonical, 'integer'),
      ]);
    },
    // A lazy indexed collection (like `Range`/`Map`): `evaluate()` returns the
    // `Tabulate` itself. `.count` is the outer dimension (no walk); an element
    // is computed by applying the function only when indexed or iterated, so a
    // `Tabulate(f, 1_000_000)` bound but unread costs O(1) instead of building
    // a million-element list.
    collection: {
      isLazy: () => true,
      count: (expr) => tabulateCount(expr),
      isEmpty: (expr) => {
        const c = tabulateCount(expr);
        return c === undefined ? undefined : c === 0;
      },
      isFinite: (expr) => {
        const c = tabulateCount(expr);
        return c === undefined ? undefined : Number.isFinite(c);
      },
      iterator: tabulateIterator,
      at: (expr, index) => tabulateAt(expr, index),
    },
  },

  Table: {
    description: [
      'An alias for `Tabulate` (the preferred name) that additionally accepts',
      'Mathematica-style iterator specs, e.g. `Table(i^2, {i, 1, n})` or',
      '`Table(i, {i, lo, hi, step})`.',
    ],
    complexity: 8200,

    // Lazy so the iterator `Set`s are held (raw): their index symbols are not
    // canonicalized (which would fold `i` to the imaginary unit) before this
    // handler can reinterpret them as iterator specs.
    lazy: true,
    signature: '(function, integer, integer?) -> collection',
    canonical: (ops, { engine: ce }) => {
      const specs = ops.slice(1);

      // Alias form: no iterator `Set` present (e.g. `Table(fn, 5)`). Delegate
      // to `Tabulate`, which — also being lazy — canonicalizes the raw held
      // ops through its own canonical handler.
      if (!specs.some((op) => isFunction(op, 'Set')))
        return ce.function('Tabulate', ops);

      // Iterator form: EVERY operand after the body must be a valid iterator
      // triple `{sym, lo, hi}` or `{sym, lo, hi, step}` — the same shape
      // validation as the `Set` branch of `canonicalIndexingSet`. A malformed
      // spec (non-symbol first element, wrong arity, or a mix of `Set` and
      // non-`Set` operands) keeps the strict posture: return `null` so the
      // expression stays inert rather than guessing a bound.
      type Spec = {
        index: Expression;
        lo: Expression;
        hi: Expression;
        step?: Expression;
      };
      const parsed: Spec[] = [];
      for (const op of specs) {
        if (!isFunction(op, 'Set')) return null;
        const setOps = op.ops ?? [];
        const idx = setOps[0];
        if (!idx || !isSymbol(idx) || setOps.length < 3 || setOps.length > 4)
          return null;
        parsed.push({
          index: idx,
          lo: setOps[1],
          hi: setOps[2],
          step: setOps.length === 4 ? setOps[3] : undefined,
        });
      }

      // All-ones fast path: every spec is exactly `{v, 1, n}` (lower bound the
      // literal integer 1, no step). Canonicalize to
      // `Tabulate(Function(expr, v₁, …), n₁, …)`; `Tabulate` applies the
      // function to 1-based indices, matching the iterator semantics.
      if (parsed.every((s) => s.step === undefined && s.lo.isSame(1))) {
        const fn = ce._fn('Function', [ops[0], ...parsed.map((s) => s.index)], {
          canonical: false,
        });
        return ce.function('Tabulate', [fn, ...parsed.map((s) => s.hi)]);
      }

      // General `lo`/`step` case: nested `Map` over `Range`. Fold from the LAST
      // spec inward so the FIRST spec is the outermost dimension (Mathematica
      // row order: `Table[i·j, {i,1,2}, {j,1,3}]` → `[[1,2,3],[2,4,6]]`). Build
      // the tree raw and canonicalize it in a single top-down pass so each
      // `Function`'s parameters shadow their index symbols (keeping the inner
      // body symbolic).
      let acc: Expression = ops[0];
      for (let k = parsed.length - 1; k >= 0; k--) {
        const s = parsed[k];
        const range = ce._fn(
          'Range',
          s.step ? [s.lo, s.hi, s.step] : [s.lo, s.hi],
          { canonical: false }
        );
        const fn = ce._fn('Function', [acc, s.index], { canonical: false });
        acc = ce._fn('Map', [range, fn], { canonical: false });
      }
      return acc.canonical;
    },
  },

  /* Return a tuple of the unique elements, and their respective count
   * Ex: Tally([a, c, a, d, a, c]) = [[a, c, d], [3, 2, 1]]
   */
  Tally: {
    description:
      'Return a tuple with the unique elements of the collection and their respective counts.',
    complexity: 8200,
    signature: '(collection) -> tuple<list, list<integer>>',
    type: ([xs], { engine: _ce }) => {
      const t = xs.type.type;
      if (t === 'string')
        return parseType(`tuple<list<string>, list<integer>>`);
      return parseType(
        `tuple<list<${typeToString(
          collectionElementType(t) ?? 'any'
        )}>, list<integer>>`
      );
    },
    evaluate: (ops, { engine: ce }) => {
      if (!ops[0].isFiniteCollection) return undefined;
      const [values, counts] = tally(ops[0]!);
      return ce.tuple(ce.function('List', values), ce.function('List', counts));
    },
  },

  // Return the first element of Tally()
  // Equivalent to `Union` in Mathematica, `distinct` in Scala,
  // Unique or Nub ∪, ↑ in APL
  Unique: {
    description: 'Return a list of the unique elements of the collection.',
    complexity: 8200,
    signature: '(collection) -> list',
    type: ([xs]) =>
      `list<${typeToString(collectionElementType(xs.type.type) ?? 'any')}>`,
    evaluate: (ops, { engine: ce }) => {
      if (!ops[0].isFiniteCollection) return undefined;
      const [values, _counts] = tally(ops[0]!);
      return ce.function('List', values);
    },
  },

  // Elixir `Enum.dedup` / R `rle`-style collapse: keep each element that
  // differs from its immediate predecessor, collapsing consecutive runs of
  // equal elements to a single element. This is NOT `Unique` (which removes
  // ALL duplicates globally): `Dedup([1,1,2,2,1])` is `[1,2,1]` whereas
  // `Unique([1,1,2,2,1])` is `[1,2]`. Lazy — keeps only the previous element.
  Dedup: {
    description: [
      'Return the collection with consecutive duplicate elements collapsed to a single element.',
      'Only immediately-adjacent equal elements are removed; unlike `Unique`, a value that recurs after a different element is kept.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection) -> collection',
    // Preserve the source's element type / indexed-ness (mirrors TakeWhile).
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      if (!collection.isValid) return null;
      return engine._fn('Dedup', [collection]);
    },
    collection: {
      isLazy: (_expr) => true,
      // Length is unknown without enumeration. For a finite source we can count
      // the deduped result (bounded); an infinite source stays unknown.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        let n = 0;
        for (const _ of expr.each()) n++;
        return n;
      },
      // Finite source ⇒ deduped result is finite; otherwise unknown.
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isFiniteCollection === true
          ? true
          : undefined,
      // Empty iff the source is empty (dedup of a non-empty source is
      // non-empty). Cheap and keeps the collection materializable.
      isEmpty: (expr) =>
        isFunction(expr) ? expr.op1.isEmptyCollection : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        // `.isSame()`: exact structural/symbolic equality (see ChunkBy note).
        let prev: Expression | undefined = undefined;
        let hasPrev = false;
        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              if (hasPrev && prev!.isSame(value as Expression)) continue;
              prev = value as Expression;
              hasPrev = true;
              return { value, done: false };
            }
          },
        };
      },
      // The k-th deduped element: walk the source collapsing adjacent equals.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        let i = 0;
        let prev: Expression | undefined = undefined;
        let hasPrev = false;
        for (const item of expr.op1.each()) {
          if (hasPrev && prev!.isSame(item)) continue;
          prev = item;
          hasPrev = true;
          i += 1;
          if (i === index) return item;
        }
        return undefined;
      },
    },
  },

  // Partition a collection into fixed-size chunks, sliding windows, or by a
  // predicate function. See `Chunk` for splitting into k nearly-equal groups.
  Partition: {
    description: [
      'Partition a collection into consecutive chunks each of size `n`; the trailing chunk may be shorter when `n` does not divide the length.',
      'With a third argument `step`, produce sliding windows of length `n` whose starts are `step` apart, keeping only complete windows.',
      'With a predicate function instead of an integer, split into two groups: elements for which the predicate is true, and those for which it is false.',
      'Asymmetry: with no `step`, the trailing partial chunk is included; with an explicit `step`, only complete windows are returned.',
      'See `Chunk` for splitting into a given number of nearly-equal groups.',
    ],
    wikidata: 'Q381060',
    complexity: 8200,
    signature: '(collection, integer | function, integer?) -> list',
    type: ([xs]) =>
      `list<list<${typeToString(collectionElementType(xs.type.type) ?? 'any')}>>`,
    evaluate: ([xs, arg, stepArg], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;

      // Partition(collection, n) and Partition(collection, n, step)
      const n = toInteger(arg);
      if (n !== null) {
        if (n <= 0) return undefined;
        const all = Array.from(xs.each());
        const result: Expression[] = [];

        // Partition(collection, n, step) → sliding windows of length `n`
        // whose starts are `step` apart; only COMPLETE windows are emitted.
        if (stepArg !== undefined) {
          const step = toInteger(stepArg);
          if (step === null || step <= 0) return undefined;
          for (let i = 0; i + n <= all.length; i += step)
            result.push(ce.function('List', all.slice(i, i + n)));
          return ce.function('List', result);
        }

        // Partition(collection, n) → consecutive chunks EACH of size `n`; the
        // trailing chunk may be shorter when `n` does not divide the length.
        for (let i = 0; i < all.length; i += n)
          result.push(ce.function('List', all.slice(i, i + n)));

        return ce.function('List', result);
      }

      // Partition(collection, predicate)
      const fn = applicable(arg);
      if (!fn) return undefined;

      const trueGroup: Expression[] = [];
      const falseGroup: Expression[] = [];
      for (const item of xs.each()) {
        const pred = sym(fn([item]));
        if (pred === 'True') trueGroup.push(item);
        else if (pred === 'False') falseGroup.push(item);
        else
          throw new Error(
            `Partition predicate must return "True" or "False". ${spellCheckMessage(
              arg
            )}`
          );
      }

      return ce.function('List', [
        ce.function('List', trueGroup),
        ce.function('List', falseGroup),
      ]);
    },
  },

  Chunk: {
    description:
      'Split the collection into `k` nearly equal-sized groups. See `Partition` for splitting into fixed-size chunks.',
    complexity: 8200,
    signature: '(collection, integer) -> list<list>',
    evaluate: ([xs, n], { engine: ce }) => {
      const k = toInteger(n);
      if (!xs.isFiniteCollection || k === null || k <= 0) return undefined;

      const all = Array.from(xs.each());
      const result: Expression[] = [];
      const chunkSize = Math.ceil(all.length / k);

      for (let i = 0; i < k; i++) {
        const chunk = all.slice(i * chunkSize, (i + 1) * chunkSize);
        result.push(ce.function('List', chunk));
      }

      return ce.function('List', result);
    },
  },

  // Elixir `Enum.chunk_by` / Wolfram `Split` / Haskell `groupBy`-on-adjacent:
  // split the collection into maximal runs of CONSECUTIVE elements over which
  // the unary key `f(x)` yields the same value. Returns a list of lists.
  ChunkBy: {
    description: [
      'Split the collection into maximal runs of consecutive elements over which the key function yields the same value.',
      'Returns a list of lists. Unlike `GroupBy`, only adjacent elements are grouped, so a key value that recurs after a different run starts a new chunk.',
    ],
    complexity: 8200,
    signature: '(collection, function) -> list<list>',
    // Element types flow through from the source: list<list<elt>>.
    type: (ops) =>
      parseType(
        `list<list<${typeToString(
          collectionElementType(ops[0].type.type) ?? 'any'
        )}>>`
      ),
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      if (!f) return undefined;

      const runs: Expression[][] = [];
      let currentKey: Expression | undefined = undefined;
      let current: Expression[] = [];
      for (const item of xs.each()) {
        const key = f([item]) ?? ce.Nothing;
        // Compare run keys with `.isSame()` — exact structural/symbolic
        // equality, the engine's internal-comparison convention. `.isEqual()`
        // is deliberately avoided: it can be undetermined and can equate
        // structurally-distinct exact values, which would make the run
        // boundaries unstable.
        if (current.length === 0) {
          current = [item];
          currentKey = key;
        } else if (currentKey!.isSame(key)) {
          current.push(item);
        } else {
          runs.push(current);
          current = [item];
          currentKey = key;
        }
      }
      if (current.length > 0) runs.push(current);

      return ce.function(
        'List',
        runs.map((r) => ce.function('List', r))
      );
    },
  },

  GroupBy: {
    description: [
      'Partition the collection into a dictionary of lists based on the key returned by the function.',
    ],
    complexity: 8200,
    signature: '(collection, function) -> dictionary<list>',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      if (!f) return undefined;

      const groups: Record<string, Expression[]> = {};

      for (const item of xs.each()) {
        const keyExpr = f([item]) ?? ce.Nothing;

        // A key that is an inert application of an operator that was only
        // auto-declared by this very use (no operator definition, inferred
        // value type) is almost certainly a typo (`Even` for `IsEven`): every
        // element would land in its own garbage group ("Even(1)", "Even(2)",
        // …). Report it like Filter reports a broken predicate. Explicitly
        // declared symbols are untouched — grouping by a symbolic key is
        // legitimate.
        if (isFunction(keyExpr)) {
          const keyDef = ce.lookupDefinition(keyExpr.operator);
          if (
            keyDef !== undefined &&
            'value' in keyDef &&
            keyDef.value?.inferredType === true
          ) {
            throw new Error(
              `Unknown function "${keyExpr.operator}" in GroupBy key function. ${spellCheckMessage(keyExpr)}`
            );
          }
        }

        const key =
          (isSymbol(keyExpr) ? keyExpr.symbol : undefined) ??
          (isString(keyExpr) ? keyExpr.string : undefined) ??
          keyExpr.toString();

        if (!(key in groups)) groups[key] = [];
        groups[key].push(item);
      }

      return ce.function(
        'Dictionary',
        Object.entries(groups).map(([k, vals]) =>
          ce._fn('Tuple', [ce.string(k), ce.function('List', vals)])
        )
      );
    },
  },

  // Similar to Transpose, but acts on a sequence of collections
  // Equivalent to zip in Python
  // The length of the result is the length of the shortest argument
  // Ex: Zip([a, b, c], [1, 2]) = [[a, 1], [b, 2]]
  Zip: {
    description:
      'Combine multiple collections element-wise into a list of tuples. The result has the length of the shortest input.',
    complexity: 8200,
    signature: '(indexed_collection+) -> list',
    collection: {
      isLazy: (_expr) => true,
      count: zipCount,
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops === 0) return true;
        // Zip has the length of its *shortest* input, so it is finite as soon
        // as *any* input is finite (was `every`, which wrongly called
        // `Zip([1,2,3], <infinite>)` infinite).
        let anyUnknown = false;
        for (const x of expr.ops) {
          const f = x.isFiniteCollection;
          if (f === true) return true;
          if (f === undefined) anyUnknown = true;
        }
        return anyUnknown ? undefined : false;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops === 0) return true;
        // Zip is empty as soon as *any* input is empty (the shortest input
        // bounds the result), not only when *every* input is empty.
        let anyUnknown = false;
        for (const x of expr.ops) {
          const e = x.isEmptyCollection;
          if (e === true) return true;
          if (e === undefined) anyUnknown = true;
        }
        return anyUnknown ? undefined : false;
      },
      // Driven by each source's iterator — not by up-front counts — so a
      // source with an unknown count (or an infinite one zipped with a
      // finite one) still iterates; the zip ends as soon as any source ends.
      iterator: (expr) => {
        if (!isFunction(expr) || expr.nops === 0)
          return { next: () => ({ value: undefined, done: true }) };
        const sources = expr.ops.map((op) => op.each());
        return {
          next: () => {
            const items: Expression[] = [];
            for (const source of sources) {
              const { value, done } = source.next();
              if (done || value === undefined)
                return { value: undefined, done: true };
              items.push(value);
            }
            return { value: expr.engine.tuple(...items), done: false };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr) || expr.nops === 0) return undefined;
        // No up-front count needed — a source with an unknown count still
        // answers `at`, and any source without an element there bounds the
        // zip.
        const items = expr.ops.map((op) => op.at(index));
        if (items.some((x) => x === undefined)) return undefined;
        return expr.engine.tuple(...(items as Expression[]));
      },
    },
  },

  // Iterate(fn, init) -> [fn(1, init), fn(2, fn(1, init)), ...]
  // Iterate(fn) -> [fn(1), fn(2), ...]
  // Infinite series. Can use Take(Iterate(fn), n) to get a finite series
  Iterate: {
    description:
      'Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value.',
    complexity: 8200,
    signature: '((index: integer, acc:any) -> any, initial: any?) -> list',
    canonical: ([f, initialExpr], { engine }) => {
      const fn = canonicalFunctionLiteral(f);
      if (!fn) return null;
      const initial = initialExpr?.canonical;
      if (!initial) return engine._fn('Iterate', [fn]);
      return engine._fn('Iterate', [fn, initial]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: () => Infinity,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op1);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        let acc = expr.op2 ?? expr.engine.Nothing;
        let n = 0;
        return {
          next: () => {
            n += 1;
            acc = f([expr.engine.number(n), acc]) ?? expr.engine.Nothing;
            return { value: acc, done: false };
          },
        };
      },
      at: (expr, index) => {
        // @todo: use cache
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const f = applicable(expr.op1);
        if (!f) return undefined;
        let acc = expr.op2 ?? expr.engine.Nothing;
        for (let i = 1; i < index; i++) {
          acc = f([expr.engine.number(i), acc]) ?? expr.engine.Nothing;
        }
        return acc;
      },
    },
  },

  // Repeat(x) -> [x, x, ...]        — infinite sequence
  // Repeat(x, n) -> [x, x, ..., x]  — finite list of n copies
  Repeat: {
    description:
      'Produce a sequence by repeating a single value. With 1 argument, returns an infinite sequence; with 2 arguments (value, count), returns a finite list of `count` copies.',
    complexity: 8200,
    signature: '(value: any, count: integer?) -> list',
    evaluate: (ops, { engine }) => {
      if (ops.length !== 2) return undefined;
      const raw = toInteger(ops[1]);
      if (raw === null) return undefined;
      const n = Math.max(0, raw);
      // Larger requests stay lazy; elements remain accessible via .at()
      // and the iterator.
      if (n > engine.maxCollectionSize) return undefined;
      return engine._fn('List', Array(n).fill(ops[0]));
    },
    collection: {
      isLazy: (expr) => isFunction(expr) && expr.ops?.length === 1,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.ops?.length === 2) {
          const n = toInteger(expr.op2);
          return n !== null ? Math.max(0, n) : undefined;
        }
        return Infinity;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.ops?.length === 2) {
          const n = toInteger(expr.op2);
          return n !== null ? n <= 0 : undefined;
        }
        return false; // infinite — never empty
      },
      isFinite: (expr) => isFunction(expr) && expr.ops?.length === 2,
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        if (expr.ops?.length === 2) {
          const n = toInteger(expr.op2);
          if (n !== null && n <= 0) return false; // empty list
        }
        return expr.op1.isSame(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        if (expr.ops?.length === 2) {
          const n = toInteger(expr.op2);
          if (n === null) {
            return { next: () => ({ value: undefined, done: true }) };
          }
          const count = Math.max(0, n);
          let i = 0;
          return {
            next: () =>
              i++ < count
                ? { value: expr.op1, done: false }
                : { value: undefined, done: true },
          };
        }
        // Infinite sequence
        return { next: () => ({ value: expr.op1, done: false }) };
      },
      // at is 1-based (consistent with Range, Take, and other collection handlers)
      at: (expr, index) => {
        if (!isFunction(expr)) return undefined;
        if (typeof index !== 'number') return undefined;
        if (expr.ops?.length === 2) {
          const n = toInteger(expr.op2);
          const count = n !== null ? Math.max(0, n) : 0;
          if (index < 1 || index > count) return undefined;
        } else {
          // Infinite sequence: any positive 1-based index is valid
          if (index < 1) return undefined;
        }
        return expr.op1;
      },
    },
  },

  // Cycle(list) -> [list[1], list[2], ...]
  // -> repeats infinitely
  Cycle: {
    description:
      'Produce an infinite sequence by cycling through the elements of a finite collection.',
    complexity: 8200,
    signature: '(list) -> list',
    collection: {
      isLazy: (_expr) => true,
      // Cycling a non-empty collection is infinite; cycling an empty one is
      // empty. Inspect the *underlying* collection (`op1`) — reading
      // `expr.isEmptyCollection`/`expr.isFiniteCollection` here would re-enter
      // these same handlers and recurse infinitely.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection ? 0 : Infinity;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        return expr.op1.contains(target) ?? false;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        let index = 1;
        const l = expr.op1.count;
        if (l === undefined || l === 0)
          return { next: () => ({ value: undefined, done: true }) };
        return {
          next: () => {
            const i = ((index - 1) % l) + 1;
            const value = expr.op1.at(i);
            if (value === undefined) return { value: undefined, done: true };
            index += 1;
            return { value, done: false };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined || l === 0) return undefined;
        const i = ((index - 1) % l) + 1; // 1-based index
        return expr.op1.at(i);
      },
    },
  },

  // Fill(f, [n, m])
  // Fill a nxm matrix with the result of f(i, j)
  // Fill( Random(5), [3, 3] )
  Fill: {
    description:
      'Produce a 2D list (matrix) by applying a function to each pair of row and column indexes.',
    complexity: 8200,
    signature: '(function, tuple) -> list',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (!isFunction(expr.op2)) return undefined;
        const dims = expr.op2.ops.map((op) => toInteger(op) ?? 0);
        return dims[0] ?? 0;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op1);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        if (!isFunction(expr.op2))
          return { next: () => ({ value: undefined, done: true }) };
        const dims = expr.op2.ops.map((op) => toInteger(op) ?? 0);
        const rows = dims[0] ?? 0;
        const cols = dims[1] ?? 0;
        const last = rows;
        let index = 1;
        return {
          next: () => {
            if (index === last + 1) return { value: undefined, done: true };
            index += 1;
            const row: Expression[] = [];
            for (let j = 1; j <= cols; j++) {
              row.push(
                f([expr.engine.number(index - 1), expr.engine.number(j)]) ??
                  expr.engine.Nothing
              );
            }
            return {
              value: expr.engine.function('List', row),
              done: false,
            };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const f = applicable(expr.op1);
        if (!f) return undefined;
        if (!isFunction(expr.op2)) return undefined;
        const dims = expr.op2.ops.map((op) => toInteger(op) ?? 0);
        const rows = dims[0] ?? 0;
        const cols = dims[1] ?? 0;
        if (index > rows * cols) return undefined;
        const row = Math.ceil(index / cols);
        const col = ((index - 1) % cols) + 1; // 1-based column index
        return (
          f([expr.engine.number(row), expr.engine.number(col)]) ??
          expr.engine.Nothing
        );
      },
    },
  },

  //
  // Create eager collections from other collections.
  //
  ListFrom: {
    description: 'Create a list from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> list',
    type: (ops) => {
      if (ops.length === 0) return 'list';
      let type: Type = 'unknown';
      for (const xs of ops) {
        if (xs.isCollection && !xs.isFiniteCollection) return 'list';
        type = widen(type, collectionElementType(xs.type.type) ?? type);
      }
      return parseType(`list<${typeToString(type)}>`);
    },
    evaluate: (ops, { engine: ce }) => {
      const elements: Expression[] = [];
      for (const xs of ops) {
        if (!xs.isCollection) elements.push(xs);
        else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as Expression[]));
        }
      }
      return ce.function('List', elements);
    },
  },

  SetFrom: {
    description: 'Create a set from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> set',
    type: (ops) => {
      if (ops.length === 0) return 'set';
      let type: Type = 'unknown';
      for (const xs of ops) {
        if (xs.isCollection && !xs.isFiniteCollection) return 'set';
        type = widen(type, collectionElementType(xs.type.type) ?? type);
      }
      return parseType(`set<${typeToString(type)}>`);
    },
    evaluate: (ops, { engine: ce }) => {
      const elements: Expression[] = [];
      for (const xs of ops) {
        if (!xs.isCollection) elements.push(xs);
        else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as Expression[]));
        }
      }
      return ce.function('Set', elements);
    },
  },

  TupleFrom: {
    description: 'Create a tuple from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const elements: Expression[] = [];
      for (const xs of ops) {
        if (!xs.isCollection) elements.push(xs);
        else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as Expression[]));
        }
      }
      return ce.tuple(...elements);
    },
  },

  DictionaryFrom: {
    description:
      'Create a dictionary from the elements of a collection of (key, value) pairs.',
    complexity: 8200,
    signature: '(collection) -> dictionary',
    evaluate: ([xs], { engine: ce }) => {
      if (!xs.isCollection) return undefined;

      // If the collection is a Record, use its ops directly
      if (isFunction(xs, 'Record'))
        return ce.function('Dictionary', [...xs.ops]);

      const entries: Expression[] = [];
      for (const keyValue of xs.each()) {
        if (!isFunction(keyValue) || keyValue.nops !== 2) {
          throw new Error(
            `Expected a collection of pairs, got ${keyValue.type}`
          );
        }
        const key = keyValue.op1;
        const value = keyValue.op2;
        if (!isString(key)) {
          throw new Error(`Expected a string key, got ${key.type}`);
        }
        entries.push(ce.tuple(key, value));
      }
      return ce.function('Dictionary', entries);
    },
  },

  RecordFrom: {
    description:
      'Create a record from the elements of a collection of (key, value) pairs.',
    complexity: 8200,
    signature: '(collection) -> record',
    evaluate: ([xs], { engine: ce }) => {
      if (!xs.isCollection) return undefined;

      // If the collection is a Dictionary, use its ops directly
      if (isFunction(xs, 'Dictionary'))
        return ce.function('Record', [...xs.ops]);

      const entries: Expression[] = [];
      for (const keyValue of xs.each()) {
        if (!isFunction(keyValue) || keyValue.nops !== 2) {
          throw new Error(
            `Expected a collection of pairs, got ${keyValue.type}`
          );
        }
        const key = keyValue.op1;
        const value = keyValue.op2;
        if (!isString(key)) {
          throw new Error(`Expected a string key, got ${key.type}`);
        }
        entries.push(ce.tuple(key, value));
      }
      return ce.function('Record', entries);
    },
  },
};

/**
 * Does this `Range` expression have a bound with no concrete numeric value
 * (e.g. `Range(1, n)` with symbolic `n`)? Such a bound reads as NaN through
 * `.re`, and `range()` silently coerces it to 1 — so every handler that
 * consumes `range()` must first bail to its indeterminate channel, or a
 * symbolic range collapses to the 1-element range [1, 1, 1] (the
 * `undefined → value` collapse class: `Count(Range(1, n))` evaluated to 1).
 *
 * Note the `iterator` handler is *not* guarded: iteration has no
 * indeterminate channel, and its consumers (Reduce, each) predate this
 * guard. A symbolic range still iterates as the collapsed [1] there.
 */
export function hasSymbolicRangeBounds(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => Number.isNaN(op.re));
}

/**
 * A *present* operand with no concrete numeric value (a symbolic
 * expression), as opposed to a missing / `Nothing` operand — which selects a
 * documented default (e.g. `Linspace`'s default count) rather than being
 * indeterminate.
 */
function isSymbolicOperand(op: Expression | undefined): boolean {
  if (op === undefined) return false;
  if (isSymbol(op) && op.symbol === 'Nothing') return false;
  return Number.isNaN(op.re);
}

/**
 * Shared evaluation for the `Any`/`All` quantifiers.
 *
 * Three-valued and short-circuiting: `Any` returns True at the first element
 * whose predicate result is True; `All` returns False at the first False. With
 * no predicate, each element is treated as the boolean value directly (Julia's
 * `any(itr)` / `all(itr)`).
 *
 * If enumeration completes with every result definite (True/False), the
 * definite answer is returned (False for `Any`, True for `All`; vacuously so on
 * an empty collection). If any result was neither True nor False (a symbolic or
 * undetermined element) and no short-circuit fired, `undefined` is returned so
 * the expression stays inert — the CAS-correct behavior rather than throwing.
 *
 * Enumeration is driven through `run(…, ce._timeRemaining)` so that an infinite
 * or lazy collection with no short-circuit aborts on the deadline instead of
 * hanging.
 */
function evaluateQuantifier(
  kind: 'Any' | 'All',
  collection: Expression,
  fn: Expression | undefined,
  ce: ComputeEngine
): Expression | undefined {
  const f = fn ? applicable(fn) : undefined;
  // `Any` short-circuits to True on the first True; `All` to False on the
  // first False. The complementary symbol ('False' for Any, 'True' for All) is
  // the "definite, keep going" result; anything else is undetermined.
  const shortSym = kind === 'Any' ? 'True' : 'False';
  const definiteSym = kind === 'Any' ? 'False' : 'True';
  const shortValue = kind === 'Any' ? ce.True : ce.False;
  const defaultValue = kind === 'Any' ? ce.False : ce.True;

  let sawUndetermined = false;
  return run(
    (function* (): Generator<undefined, Expression | undefined> {
      for (const item of collection.each()) {
        const result = f ? f([item]) : item.evaluate();
        const s = sym(result);
        if (s === shortSym) return shortValue;
        if (s !== definiteSym) sawUndetermined = true;
        yield;
      }
      return sawUndetermined ? undefined : defaultValue;
    })(),
    ce._timeRemaining
  );
}

/**
 * Normalize the arguments of range:
 * - [from, to] -> [from, to, 1] if to > from, or [from, to, -1] if to < from
 * - [x] -> [1, x, 1]
 *
 * Bounds and step are kept as raw numeric values (not rounded). The step is
 * trusted as-given when provided explicitly; iteration produces an empty
 * collection when the step's sign disagrees with the direction (lower→upper).
 */
export function range(
  expr: Expression
): [lower: number, upper: number, step: number] {
  if (!isFunction(expr)) return [1, 0, 0];
  if (expr.nops === 0) return [1, 0, 0];

  // A symbolic (non-numeric) operand reads as NaN and propagates: callers
  // must check `hasSymbolicRangeBounds()` first. (These used to be coerced
  // to 1, which collapsed every symbolic range to [1, 1, 1] — the
  // `Count(Range(1, n)) → 1` class of wrong scalars.)
  const op1 = expr.op1.re;
  if (expr.nops === 1) return [1, op1, 1];

  const op2 = expr.op2.re;
  if (expr.nops === 2) return [op1, op2, op2 >= op1 ? 1 : -1];

  return [op1, op2, expr.op3.re];
}

/** Return the last value in the range
 * - could be less that lower if step is negative
 * - could be less than upper if step is positive, for
 * example `rangeLast([1, 6, 2])` = 5
 */
export function rangeLast(
  r: [lower: number, upper: number, step: number]
): number {
  const [lower, upper, step] = r;
  if (!Number.isFinite(upper)) return step > 0 ? Infinity : -Infinity;

  if (step > 0) return upper - ((upper - lower) % step);
  return upper + ((lower - upper) % step);
}

/**
 * An index range is of the form:
 * - an index, as an integer
 * - a tuple of the form [from, to]
 * - a tuple of the form [from, to, step]. `step` must be a positive number.
 *   If invalid, or absent, 1 is assumed.
 * - a ["List"] of indexes
 *
 * Negative indexes indicate position relative to the last element: -1 is
 * the last element, -2 the one before that, etc...
 *
 */
function _indexRangeArg(
  op: Expression | undefined,
  l: number
): [lower: number, upper: number, step: number] {
  if (!op) return [0, 0, 0];
  let n = op.re;

  if (isFinite(n)) {
    n = Math.round(n);
    if (n < 0) {
      if (l === undefined) return [0, 0, 0];
      n = l + n + 1;
    }
    return [n, n, 1];
  }

  // We may have a Tuple...
  const h = op.operator;
  if (!h || typeof h !== 'string' || !/^(Single|Pair|Triple|Tuple|)$/.test(h))
    return [0, 0, 0];
  // A symbolic tuple entry has no concrete numeric value: invalid as an
  // index range (range() no longer coerces it to 1).
  if (hasSymbolicRangeBounds(op)) return [0, 0, 0];
  let [lower, upper, step] = range(op);

  if ((lower < 0 || upper < 0) && l === undefined) return [0, 0, 0];

  if (lower < 0) lower = l! + lower + 1;
  if (upper < 0) upper = l! + upper + 1;

  step = Math.abs(Math.round(step));
  if (step === 0) return [0, 0, 0];
  if (lower > upper) step = -step;

  return [lower, upper, step];
}

function canonicalList(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine; scope: Scope | undefined }
): Expression {
  // Do we have a matrix with a custom delimiter, i.e.
  // \left\lbrack \begin{array}...\end{array} \right\rbrack

  const op1 = ops[0];
  if (ops.length === 1 && isFunction(op1, 'Matrix')) {
    // Adjust the matrix to have the correct delimiter
    const [body, delimiters, columns] = op1.ops;

    if (!delimiters || (isString(delimiters) && delimiters.string === '..')) {
      if (!columns) return ce._fn('Matrix', [body, delimiters]);
      return ce._fn('Matrix', [body, ce.string('[]'), columns]);
    }
  }

  const canonicalOps = ops.map((op) => {
    if (isFunction(op, 'Delimiter')) {
      if (isFunction(op.op1, 'Sequence'))
        return ce._fn('List', canonical(ce, op.op1.ops));
      return ce._fn('List', [op.op1?.canonical ?? ce.Nothing]);
    }
    return op.canonical;
  });
  return ce._fn('List', canonicalOps);
}

function canonicalSet(
  ops: ReadonlyArray<Expression>,
  { engine }: { engine: ComputeEngine; scope: Scope | undefined }
): Expression {
  // Since the `Set` operator is `lazy`, the canonical handler receives raw
  // operands: canonicalize them first
  ops = ops.map((op) => op.canonical);

  // A set-builder (comprehension) is not a literal set: do not deduplicate
  // its syntactic operands (body + indexing set)
  if (parseSetComprehension(ops) !== null) return engine._fn('Set', [...ops]);

  // Check that each element is only present once
  const set: Expression[] = [];
  const has = (x: Expression) => set.some((y) => y.isSame(x));

  for (const op of ops) if (!has(op)) set.push(op);

  return engine._fn('Set', set);
}

/**
 * A set-builder (comprehension) expression, e.g. `{k ∈ 1..n : gcd(n,k) = 1}`.
 *
 * - `body`: the expression each domain value is substituted into
 * - `variable`: the bound (index) variable, or `undefined` if it could not
 *   be identified (the comprehension is then never enumerable)
 * - `domain`: the collection the variable ranges over, or `undefined` if
 *   unknown (e.g. `{x | x > 0}`)
 * - `condition`: an optional filter predicate
 */
type SetComprehension = {
  body: Expression;
  variable: string | undefined;
  domain: Expression | undefined;
  condition: Expression | undefined;
};

/**
 * Determine whether the operands of a `Set` expression describe a
 * set-builder (comprehension) rather than a literal set.
 *
 * A `Set` is a comprehension iff it has exactly two operands and the second
 * operand is an indexing-set form:
 *
 * - `["Set", body, ["Element", v, domain, cond?]]` — the form used by the
 *   big operators (Sum/Product) and the Fungrim corpus — provided the bound
 *   variable `v` occurs in `body` (otherwise the `Element` is just a
 *   proposition and the set is literal, e.g. `{x, k ∈ S}`);
 * - `["Set", ["Element", v, domain], ["Condition", pred]]` — produced by the
 *   LaTeX parser for `\{k \in S \mid pred\}`;
 * - `["Set", body, ["Condition", ...]]` — produced by the LaTeX parser for
 *   `\{body \mid ...\}`. A `Condition` operand is a syntactic marker, not a
 *   value, so such a `Set` is always treated as a comprehension, possibly
 *   with an unknown (non-enumerable) domain, e.g. `{x | x > 0}`.
 *
 * Literal sets — `{1, 2}`, `{x, y}`, … — never match: their second operand
 * is not an `Element`/`Condition` indexing-set form.
 *
 * Returns `null` if the operands describe a literal set.
 */
function parseSetComprehension(
  ops: ReadonlyArray<Expression>
): SetComprehension | null {
  if (ops.length !== 2) return null;
  const [body, spec] = ops;

  // The `Condition` operator holds its operands, so the domain/condition
  // extracted from inside it may be non-canonical (unbound). Canonicalize
  // the extracted pieces so they can be enumerated and evaluated.
  const canon = (x: Expression) => (x.isCanonical ? x : x.canonical);

  // Form A: ["Set", body, ["Element", v, domain, cond?]]
  if (isFunction(spec, 'Element') && spec.nops >= 2) {
    if (!isSymbol(spec.op1)) return null;
    const v = spec.op1.symbol;
    // The bound variable must occur in the body, else this is a literal set
    if (!body.has(v)) return null;
    const cond =
      spec.nops >= 3 && sym(spec.op3) !== 'Nothing' ? spec.op3 : undefined;
    return { body, variable: v, domain: spec.op2, condition: cond };
  }

  if (isFunction(spec, 'Condition') && spec.nops >= 1) {
    const pred = spec.op1;

    // Form B: ["Set", ["Element", v, domain], ["Condition", pred]]
    // e.g. `\{k \in S \mid pred\}`: the body is the bound variable itself
    if (isFunction(body, 'Element') && body.nops === 2 && isSymbol(body.op1)) {
      return {
        body: body.op1,
        variable: body.op1.symbol,
        domain: canon(body.op2),
        condition: canon(pred),
      };
    }

    // Form C: ["Set", body, ["Condition", ["Element", v, domain]]]
    // e.g. `\{2k \mid k \in S\}`
    if (isFunction(pred, 'Element') && pred.nops === 2 && isSymbol(pred.op1)) {
      const v = pred.op1.symbol;
      if (body.has(v))
        return {
          body,
          variable: v,
          domain: canon(pred.op2),
          condition: undefined,
        };
    }

    // Form C': the predicate is a conjunction including exactly one
    // membership over a variable of the body,
    // e.g. ["Set", body, ["Condition", ["And", ["Element", v, domain], cond]]]
    if (isFunction(pred, 'And')) {
      const memberships = pred.ops.filter(
        (x) =>
          isFunction(x, 'Element') &&
          x.nops === 2 &&
          isSymbol(x.op1) &&
          body.has(x.op1.symbol)
      );
      const membership = memberships.length === 1 ? memberships[0] : undefined;
      if (
        membership &&
        isFunction(membership, 'Element') &&
        isSymbol(membership.op1)
      ) {
        const rest = pred.ops.filter((x) => x !== membership).map(canon);
        const ce = body.engine;
        const cond =
          rest.length === 0
            ? undefined
            : rest.length === 1
              ? rest[0]
              : ce._fn('And', rest);
        return {
          body,
          variable: membership.op1.symbol,
          domain: canon(membership.op2),
          condition: cond,
        };
      }
    }

    // Unrecognized `Condition` form: still a comprehension (a `Condition` is
    // not a value), but over an unknown domain — never enumerable, e.g.
    // `{x | x > 0}`. This keeps it symbolic instead of a 2-element literal.
    return {
      body,
      variable: isSymbol(body) ? body.symbol : undefined,
      domain: undefined,
      condition: pred,
    };
  }

  return null;
}

/**
 * Enumerate the elements of a set-builder: the distinct substituted bodies
 * over the (filtered) domain.
 *
 * Returns `undefined` if the domain cannot be enumerated (symbolic bounds,
 * infinite or unknown domain, more than 1000 values...): the comprehension
 * must then stay symbolic.
 */
function enumerateSetComprehension(
  comp: SetComprehension
): Expression[] | undefined {
  const { body, variable, domain, condition } = comp;
  if (variable === undefined || domain === undefined) return undefined;
  const ce = body.engine;

  // Reuse the big-op machinery (how Sum/Product enumerate an
  // `Element(v, domain, cond?)` indexing set, including condition filtering)
  const extract = (dom: Expression) =>
    extractFiniteDomainWithReason(
      ce._fn('Element', [
        ce.symbol(variable),
        dom,
        ...(condition ? [condition] : []),
      ]),
      ce
    );

  let result = extract(domain);

  // The domain may reference symbols with assigned values, e.g.
  // `Range(1, n)` with `n := 5`: retry with the evaluated domain
  if (result.status !== 'success') {
    const evaluatedDomain = domain.evaluate();
    if (!evaluatedDomain.isSame(domain)) result = extract(evaluatedDomain);
  }
  if (result.status !== 'success') return undefined;

  // Substitute each domain value into the body and evaluate. A set has no
  // duplicate elements: equal substituted bodies collapse, e.g.
  // `{k mod 2 : k ∈ 1..4}` has two elements, `{0, 1}`.
  const isIdentity = isSymbol(body) && body.symbol === variable;
  const elements: Expression[] = [];
  for (const value of result.values) {
    const x = isIdentity ? value : body.subs({ [variable]: value }).evaluate();
    if (!elements.some((y) => y.isSame(x))) elements.push(x);
  }
  return elements;
}

/**
 * Three-valued membership for a literal set: `true` when an element matches,
 * `false` only when every element is definitively different from `target`
 * (concrete values), `undefined` otherwise.
 */
function literalSetContains(
  ops: ReadonlyArray<Expression>,
  target: Expression
): boolean | undefined {
  let indeterminate = false;
  for (const op of ops) {
    if (target.isSame(op)) return true;
    if (isNumber(target) && isNumber(op)) {
      // Concrete numbers decide definitively
      const eq = target.isEqual(op);
      if (eq === true) return true;
      if (eq !== false) indeterminate = true;
    } else if (isString(target) && isString(op)) {
      // Two distinct string literals (isSame was false): refuted
    } else {
      indeterminate = true;
    }
  }
  return indeterminate ? undefined : false;
}

/**
 * Three-valued membership for a set-builder: decide by enumeration over
 * finite domains; over symbolic/infinite domains, decide via the domain and
 * the condition when the body is the bare bound variable, and stay
 * indeterminate otherwise.
 */
function setComprehensionContains(
  comp: SetComprehension,
  target: Expression
): boolean | undefined {
  const elements = enumerateSetComprehension(comp);
  if (elements !== undefined) return literalSetContains(elements, target);

  // Non-enumerable domain: when the body is the bare bound variable, the
  // comprehension is `{v ∈ domain : cond(v)}`, so membership is the Kleene
  // conjunction of domain membership and the condition.
  if (
    comp.domain !== undefined &&
    comp.variable !== undefined &&
    isSymbol(comp.body) &&
    comp.body.symbol === comp.variable
  ) {
    const inDomain = comp.domain.contains(target);
    // Exclusion from the domain refutes membership (e.g. `1/2 ∉ {k ∈ ℤ : …}`)
    if (inDomain === false) return false;

    let condition: boolean | undefined = true;
    if (comp.condition !== undefined) {
      // Only literal candidates can be decided by evaluating the condition:
      // a symbolic target could make the condition evaluate to a spurious
      // `False` (e.g. `Equal` of distinct symbolic expressions)
      if (isNumber(target) || isString(target)) {
        const result = comp.condition
          .subs({ [comp.variable]: target })
          .evaluate();
        condition =
          sym(result) === 'True'
            ? true
            : sym(result) === 'False'
              ? false
              : undefined;
      } else condition = undefined;
    }
    if (condition === false) return false;
    if (inDomain === true && condition === true) return true;
  }

  return undefined;
}

function tally(collection: Expression): [ReadonlyArray<Expression>, number[]] {
  const values: Expression[] = [];
  const counts: number[] = [];

  const indexOf = (expr: Expression) => {
    for (let i = 0; i < values.length; i++)
      if (values[i].isSame(expr)) return i;
    return -1;
  };

  for (const op of collection.each()) {
    const index = indexOf(op);
    if (index >= 0) counts[index]++;
    else {
      values.push(op);
      counts.push(1);
    }
  }

  return [values, counts];
}

/**
 * True when a collection claims to have elements (`isEmptyCollection` is
 * not `true`) yet its iterator declines to enumerate them — e.g.
 * `Linspace(a, 1, 3)` with a symbolic endpoint: the size (3) is known, but
 * the elements have no computable value, so `each()` yields nothing.
 * Folding such a collection would silently produce the fold's initial
 * value (`Sum → 0`); callers should stay inert instead.
 */
export function enumerationDeclined(collection: Expression): boolean {
  if (collection.isEmptyCollection === true) return false;
  return collection.each().next().done === true;
}

/**
 * This function is used to reduce a collection of expressions to a single value. It
 * iterates over the collection, applying the given function to each element and the
 * accumulator. If the function returns `null`, the iteration is stopped and `undefined`
 * is returned. Otherwise, the result of the function is used as the new accumulator.
 * If the iteration completes, the final accumulator is returned.
 */
export function* reduceCollection<T>(
  collection: Expression,
  fn: (acc: T, next: Expression) => T | null,
  initial: T
): Generator<T | undefined> {
  let acc = initial;
  for (const x of collection.each()) {
    const result = fn(acc, x);
    if (result === null) return undefined;
    yield acc;
    acc = result;
  }
  return acc;
}

function joinResultType(ops: ReadonlyArray<Expression>): Type {
  if (ops.some((op) => op.type.matches('record'))) return 'record';
  if (ops.some((op) => op.type.matches('dictionary'))) return 'dictionary';
  if (ops.some((op) => op.type.matches('set'))) return 'set';
  return 'list';
}

function defaultCollectionEq(a: Expression, b: Expression) {
  // Compare two collections
  if (a.operator !== b.operator) {
    // `b` may be an unevaluated expression that evaluates to this literal
    // kind (`Map(…)`, `Join(…)`, `Filter(…)`, a symbol assigned a
    // collection…): decline so `eq()` in compare.ts can evaluate both sides,
    // re-consult, or fall back to its element-wise collection comparison. A
    // value whose type cannot be this kind is definitively unequal.
    const compatible =
      a.operator === 'Tuple'
        ? b.type.matches('tuple')
        : b.type.matches('indexed_collection') && !b.type.matches('tuple');
    return compatible ? undefined : false;
  }
  if (!isFunction(a) || !isFunction(b)) return false;
  if (a.nops !== b.nops) return false;

  // The elements are assumed to be in the same order
  return a.ops.every((x, i) => x.isSame(b.ops[i]));
}

export function fromRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function sortedIndices(
  expr: Expression,
  fn: Expression | undefined = undefined
): number[] | undefined {
  const l = expr.count;
  if (l === undefined || !Number.isFinite(l) || l < 1) return undefined;

  const indices = Array.from({ length: l }, (_, i) => i + 1);

  const defaultCmp = (a: Expression, b: Expression) => {
    if (a.isLess(b)) return -1;
    if (a.isEqual(b)) return 0;
    return 1;
  };

  const f = fn ? applicable(fn) : undefined;

  // A unary function is used as a sort KEY: sort ascending by `f(x)` using
  // `compareKeys` (both comparison directions probed — the one-directional
  // `defaultCmp` treats an undetermined comparison as "greater"). Compute
  // each key once (decorate-sort-undecorate). A key that cannot be computed
  // or an undetermined key comparison makes the whole sort undetermined
  // (inert), matching `MaxBy`/`MinBy`/`ArgMax`/`ArgMin`. A binary function
  // is used as a comparator (historical behavior); a statically-unknown
  // arity (bare `function`) is also treated as a comparator, so nothing
  // existing changes meaning.
  if (f && fn && functionArity(fn) === 1) {
    const keys = new Map<number, Expression>();
    for (const i of indices) {
      const key = f([expr.at(i)!]);
      if (key === undefined) return undefined;
      keys.set(i, key);
    }
    // Array.prototype.sort is stable, so elements with equal keys keep their
    // original relative order (first-listed stays first).
    let undetermined = false;
    indices.sort((i, j) => {
      const c = compareKeys(keys.get(i)!, keys.get(j)!);
      if (c === undefined) {
        undetermined = true;
        return 0;
      }
      return c;
    });
    return undetermined ? undefined : indices;
  }

  const cmpFn = f
    ? (a: Expression, b: Expression) => {
        const r = f([a, b]);
        // A boolean comparator (Elixir-style): True means the first argument
        // sorts first. Previously a boolean result was silently treated as
        // "greater" (never negative, never zero), so e.g.
        // `Sort(xs, (a,b) -> a > b)` did not reorder at all.
        const s = sym(r);
        if (s === 'True') return -1;
        if (s === 'False') return 1;
        return r?.isNegative ? -1 : r?.isSame(0) ? 0 : 1;
      }
    : defaultCmp;

  indices.sort((i, j) => {
    const va = expr.at(i)!;
    const vb = expr.at(j)!;
    return cmpFn(va, vb);
  });

  return indices;
}

/**
 * Return the fixed arity of a function operand, read from its declared
 * signature type: 1 for a unary function, 2 for a binary function, or
 * `undefined` when the arity is not statically a single fixed value (a bare
 * `function` type, a variadic or optional-argument signature, or a non-
 * signature type).
 */
function functionArity(fn: Expression): number | undefined {
  const sig = functionSignature(fn.type.type);
  if (!sig || typeof sig === 'string' || sig.kind !== 'signature')
    return undefined;
  // Variadic or optional arguments make the arity ambiguous.
  if (sig.variadicArg || (sig.optArgs && sig.optArgs.length > 0))
    return undefined;
  return sig.args?.length;
}

/** Compare two (already evaluated) key values with the default element
 * ordering. Returns -1, 0, 1, or `undefined` when the order is undetermined
 * (symbolic keys). `a.isLess(b)` being `false` is NOT the same as
 * `b.isLess(a)` being `true`, so both directions are probed. */
function compareKeys(a: Expression, b: Expression): -1 | 0 | 1 | undefined {
  if (a.isEqual(b) === true) return 0;
  if (a.isLess(b) === true) return -1;
  if (b.isLess(a) === true) return 1;
  return undefined;
}

/**
 * Canonicalize the Wolfram/Fungrim optimization form `ArgMax(f, domain)` /
 * `ArgMin(f, domain)`: first operand a function literal, second a domain (a
 * set, not an indexed collection). The engine keeps it inert, but the
 * function operand must go through `canonicalFunctionLiteral` so it gets the
 * canonical (Block-wrapped) body that the identities library's stored rule
 * patterns match. Returns `undefined` when `ops` is not the optimization form
 * (the caller then proceeds with the collection form).
 */
function canonicalOptimumForm(
  engine: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression | null | undefined {
  if (ops.length !== 2) return undefined;
  const [f, domain] = ops;
  if (!isFunction(f, 'Function')) return undefined;
  const d = domain.canonical;
  if (!d.type.matches('set')) return undefined;
  const fn = canonicalFunctionLiteral(f);
  if (!fn) return null;
  return engine._fn(operator, [fn, d]);
}

/** Shared driver for `MaxBy`/`MinBy`/`ArgMax`/`ArgMin`. Enumerates a finite
 * collection, computing the unary key `f(x)` (or the element itself when `f`
 * is absent) once per element, and tracks the extremum. First occurrence wins
 * ties. Yields per element for interruptibility. Returns the winning element
 * (or its 1-based index when `want === 'index'`), or `undefined` (inert) on an
 * empty collection or an undetermined key comparison. */
function* extremumBy(
  xs: Expression,
  f: ((xs: ReadonlyArray<Expression>) => Expression | undefined) | undefined,
  ce: ComputeEngine,
  mode: 'max' | 'min',
  want: 'element' | 'index'
): Generator<undefined, Expression | undefined, unknown> {
  let best: Expression | undefined = undefined;
  let bestKey: Expression | undefined = undefined;
  let index = 0;
  for (const item of xs.each()) {
    index += 1;
    const key = f ? f([item]) : item;
    if (key === undefined) return undefined;
    const winner = want === 'index' ? ce.number(index) : item;
    if (bestKey === undefined) {
      bestKey = key;
      best = winner;
      yield undefined;
      continue;
    }
    const cmp = compareKeys(bestKey, key);
    if (cmp === undefined) return undefined;
    const takeNew = mode === 'max' ? cmp === -1 : cmp === 1;
    if (takeNew) {
      bestKey = key;
      best = winner;
    }
    yield undefined;
  }
  return best;
}

/**
 *
 * Flatten an array of BoxedExpressions (possibly lazy collections),
 * handling Sequence and Nothing
 *
 */

function enlist(xs: ReadonlyArray<Expression>): Expression[] {
  if (xs.length === 0) return [];

  const result: Expression[] = [];
  // let s: string | undefined = undefined;
  for (const x of xs) {
    if (sym(x) === 'Nothing') continue;

    // if (isString(x)) {
    //   if (s === undefined) s = '';
    //   s += x.string;
    //   continue;
    // }

    // if (s !== undefined) {
    //   result.push(ce.string(s));
    //   s = undefined;
    // }

    if (isFunction(x, 'Sequence')) {
      result.push(...enlist([...x.ops]));
    } else if (isString(x)) {
      // A string is a collection (of strings), but we don't want to iterate it recursively
      // if (s === undefined) s = '';
      // s += x.string;
      result.push(x);
    } else if (x.isCollection) {
      result.push(...enlist([...x.each()]));
    } else {
      result.push(x);
    }
  }

  // if (s !== undefined) result.push(ce.string(s));

  return result;
}

/** Is `op` an already fully-evaluated literal element for the requested
 * evaluation mode? Used by the `List` fast path to avoid rebuilding a
 * collection literal whose elements need no further evaluation.
 *
 * A string is always fully evaluated. A number literal is fully evaluated
 * under `evaluate()`; under `.N()` (numericApproximation) only an inexact
 * (float) number is — an exact number (integer aside) may still numericize.
 * Symbols and function expressions are never treated as fully evaluated (they
 * may be bound or reducible). */
function isEvaluatedElement(
  op: Expression,
  numericApproximation: boolean
): boolean {
  if (isString(op)) return true;
  if (isNumber(op)) return !numericApproximation || !op.isExact;
  return false;
}

function takeIterator(expr: Expression): Iterator<Expression> {
  if (!isFunction(expr))
    return { next: () => ({ value: undefined, done: true }) };
  // Number of elements to take
  const count = Math.max(0, toInteger(expr.op2) ?? 0);

  if (count === 0) return { next: () => ({ value: undefined, done: true }) };

  let index = 1;
  let n = 0;

  return {
    next: () => {
      if (n >= Math.abs(count)) return { value: undefined, done: true };
      const value = expr.op1.at(index);
      if (!value) return { value: undefined, done: true };
      index += 1;
      n += 1;
      return { value, done: false };
    },
  };
}

function takeCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const [xs, op2] = expr.ops;
  const count = xs.count;
  if (count === undefined) return undefined;
  const n = Math.max(0, toInteger(op2) ?? 0);
  if (!Number.isFinite(n)) return Infinity;
  return Math.min(count, n);
}

/** The integer dimensions of a `Tabulate`, or `null` if any is missing,
 * non-integer, or non-positive. `Tabulate(fn)` (no dimensions) returns `[]`. */
function tabulateDims(expr: Expression): number[] | null {
  if (!isFunction(expr)) return null;
  const dims = expr.ops.slice(1).map((op) => toInteger(op));
  if (dims.some((d) => d === null || d <= 0)) return null;
  return dims as number[];
}

/** Element count of a `Tabulate` = its OUTER dimension (no enumeration).
 * `Tabulate(fn)` with no dimensions is the empty list (count 0). */
function tabulateCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  if (expr.ops.length <= 1) return 0;
  const dims = tabulateDims(expr);
  if (dims === null) return undefined;
  return dims[0];
}

/** The element at 1-based outer index `outerIndex` of a `Tabulate`. For a 1-D
 * tabulation this is `fn(outerIndex)`; for higher rank it is the nested sub-
 * array over the remaining dimensions (built on demand). */
function tabulateElement(
  ce: ComputeEngine,
  fn: (args: Expression[]) => Expression | undefined | null,
  dims: number[],
  outerIndex: number
): Expression {
  if (dims.length === 1) return fn([ce.number(outerIndex)]) ?? ce.Nothing;

  const fillArray = (index: number[], level: number): ExpressionInput => {
    if (level === dims.length)
      return fn(index.map((v) => ce.number(v))) ?? ce.Nothing;
    const arr: ['List', ...ExpressionInput[]] = ['List'];
    for (let j = 1; j <= dims[level]; j++) {
      index[level] = j;
      arr.push(fillArray(index, level + 1));
    }
    return arr;
  };
  const index = Array(dims.length).fill(0);
  index[0] = outerIndex;
  return ce.expr(fillArray(index, 1));
}

function tabulateAt(
  expr: Expression,
  index: number | string
): Expression | undefined {
  if (typeof index !== 'number' || !Number.isInteger(index) || index === 0)
    return undefined;
  if (!isFunction(expr)) return undefined;
  const dims = tabulateDims(expr);
  if (dims === null || dims.length === 0) return undefined;
  const fn = applicable(expr.op1);
  if (!fn) return undefined;
  let i = index;
  if (i < 0) i = dims[0] + i + 1;
  if (i < 1 || i > dims[0]) return undefined;
  return tabulateElement(expr.engine, fn, dims, i);
}

function* tabulateIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const dims = tabulateDims(expr);
  if (dims === null || dims.length === 0) return;
  const fn = applicable(expr.op1);
  if (!fn) return;
  const ce = expr.engine;
  for (let i = 1; i <= dims[0]; i++) yield tabulateElement(ce, fn, dims, i);
}

// The length of an element-wise combination of collections (Zip, and the
// multi-collection `Map`): the shortest input bounds the result, so `undefined`
// as soon as any count is unknown, `Infinity` only if all are infinite, and
// otherwise the minimum — a finite source bounds an infinite one
// (`Math.min` handles `Infinity` operands directly).
function minCount(
  counts: ReadonlyArray<number | undefined>
): number | undefined {
  if (counts.some((c) => c === undefined)) return undefined;
  if (counts.length === 0) return 0;
  return Math.min(...(counts as number[]));
}

function zipCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  return minCount(expr.ops.map((x) => x.count));
}
