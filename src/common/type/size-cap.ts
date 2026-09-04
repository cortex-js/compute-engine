import type { Type, TypeReference } from './types.js';
import { typeToDedupKey } from './serialize.js';

/**
 * The largest DERIVED type the engine keeps in full, counted in nodes (one
 * per primitive, one per compound). A derived type past this size has its
 * compound components flattened by `boundTypeSize` before it is stored on an
 * expression.
 *
 * Why a bound exists. A type handler builds a compound type from the types
 * of the operands: `Tuple(a, b)` types `tuple<A, B>`, a ragged list literal
 * types `list<A | B>`. A boxed expression is a DAG, so a value built from one
 * sub-expression referenced twice — `t = Tuple(t, t)` repeated, the block
 * form of a Hadamard matrix, a fractal point set, a perfect binary tree of
 * pairs — has a type with one slot per LEAF: 2^k slots for k levels of
 * doubling, shared by object identity but read as a tree by every type-level
 * reader (`isSubtype`, `widen`, `typeToString`, `hasFreeVariables`). At 20
 * levels a `Length` over such a value took seconds and `Negate` 14 s, and the
 * printed type had a million slots. A dimensioned list type never has this
 * problem, because it summarizes a regular shape as one element type and a
 * dimension vector; tuples, ragged lists and records have no such summary.
 *
 * The bound is on the TOTAL size, not on depth or on width alone: 256
 * copies of one child nested eight deep is nine nodes and a type of 256^8
 * slots, which no depth cap or width cap catches on its own.
 *
 * Why 256. A hover past that size is unreadable, a point is two or three
 * slots wide, a point list is `list<tuple<number, number>>` (four nodes),
 * and a matrix is dimensioned and never counts. What a component past the
 * bound loses is the types of ITS components, never its own kind or arity,
 * and never soundness: `tuple<any, any>` is a supertype of every pair type.
 */
export const TYPE_SIZE_LIMIT = 256;

/**
 * `t`, or a supertype of `t` of bounded size.
 *
 * When `t` has more than `limit` nodes, every compound COMPONENT of `t` is
 * flattened: it keeps its kind and its arity, and its own components become
 * `any` (`tuple<tuple<A, B>, tuple<C, D>>` becomes
 * `tuple<tuple<any, any>, tuple<any, any>>`; `list<list<A> | list<B>>`
 * becomes `list<list<any>>`). The top level keeps its own shape, so the
 * result is linear in the node's own arity and in each component's arity,
 * and never in the depth of the value.
 *
 * The slots become `any`, not `unknown`: `unknown` is the type of every
 * VALUE and excludes the absence markers (`missing`, `nothing`) and `error`,
 * so a `tuple<missing>` component flattened to `tuple<unknown>` would lose
 * inhabitants. `any` is the top of the lattice and is a supertype of every
 * slot type.
 *
 * The flattened component is deliberately NOT the bare kind (`tuple`,
 * `list`). The engine's tuple gates (`isTuple`, the `tuples` broadcast
 * exemption, the component-wise `Add`/`Multiply` arms) recognize a tuple by
 * the compound spelling, and a tuple with `any` components is the shape they
 * already admit under could-be-numeric semantics; a bare `tuple` is not, so
 * `2·t` over a bare-typed value would broadcast into a list where the value
 * is a point.
 *
 * A type reference's DEFINITION is a leaf: it is the text the user wrote,
 * and a self-referential alias would otherwise never end. Its type
 * ARGUMENTS (`tree<T>` applied to a derived `T`) are components like any
 * other, counted and flattened.
 */
export function boundTypeSize(
  t: Readonly<Type>,
  limit: number = TYPE_SIZE_LIMIT
): Type {
  if (typeSizeUpTo(t, limit) <= limit) return t as Type;
  return mapComponents(t, flattenComponent);
}

/**
 * The number of nodes in `t`, read as a tree, stopping once the count
 * passes `limit` (the caller only asks whether it fits). A reference counts
 * one for itself plus its type arguments, whatever it names.
 */
export function typeSizeUpTo(t: Readonly<Type>, limit: number): number {
  let count = 0;
  const visit = (x: Readonly<Type>): void => {
    if (count > limit) return;
    count++;
    if (typeof x === 'string') return;
    switch (x.kind) {
      case 'union':
      case 'intersection':
        for (const m of x.types) visit(m);
        return;
      case 'negation':
        visit(x.type);
        return;
      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        visit(x.elements);
        return;
      case 'dictionary':
        visit(x.values);
        return;
      case 'record':
      case 'object':
        for (const v of Object.values(x.elements)) visit(v);
        return;
      case 'tuple':
        for (const e of x.elements) visit(e.type);
        return;
      case 'signature':
        for (const a of x.args ?? []) visit(a.type);
        for (const a of x.optArgs ?? []) visit(a.type);
        if (x.variadicArg) visit(x.variadicArg.type);
        for (const p of x.typeParams ?? []) if (p.bound) visit(p.bound);
        visit(x.result);
        return;
      case 'reference':
        for (const a of x.args ?? []) visit(a);
        return;
      default:
        // `value`, `numeric`, `symbol`, `expression`, `variable`: leaves.
        return;
    }
  };
  visit(t);
  return count;
}

/** `t` with `f` applied to each of its direct components. */
function mapComponents(t: Readonly<Type>, f: (x: Type) => Type): Type {
  if (typeof t === 'string') return t;
  switch (t.kind) {
    case 'union':
    case 'intersection':
      return algebraic(t.kind, t.types.map(f));
    case 'negation':
      return { ...t, type: f(t.type) };
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return { ...t, elements: f(t.elements) };
    case 'dictionary':
      return { ...t, values: f(t.values) };
    case 'record':
    case 'object': {
      const elements: Record<string, Type> = {};
      for (const [k, v] of Object.entries(t.elements)) elements[k] = f(v);
      return { ...t, elements };
    }
    case 'tuple':
      return {
        ...t,
        elements: t.elements.map((e) => ({ ...e, type: f(e.type) })),
      };
    case 'signature':
      return {
        ...t,
        ...(t.args
          ? { args: t.args.map((a) => ({ ...a, type: f(a.type) })) }
          : {}),
        ...(t.optArgs
          ? { optArgs: t.optArgs.map((a) => ({ ...a, type: f(a.type) })) }
          : {}),
        ...(t.variadicArg
          ? { variadicArg: { ...t.variadicArg, type: f(t.variadicArg.type) } }
          : {}),
        ...(t.typeParams
          ? {
              typeParams: t.typeParams.map((p) =>
                p.bound ? { ...p, bound: f(p.bound) } : p
              ),
            }
          : {}),
        result: f(t.result),
      };
    case 'reference':
      return t.args ? { ...t, args: t.args.map(f) } : (t as Type);
    default:
      return t as Type;
  }
}

/** Whether `t` has components of its own (a compound), as opposed to a leaf
 * such as a primitive, a value type, a ranged numeric type, a symbol or
 * expression type, or a type variable. A reference is a compound only when
 * it carries type arguments. */
function isCompound(t: Readonly<Type>): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'value':
    case 'numeric':
    case 'symbol':
    case 'expression':
    case 'variable':
      return false;
    case 'reference':
      return (t as TypeReference).args !== undefined;
    default:
      return true;
  }
}

/**
 * `t` with its own components widened to `any`: the same kind, the same
 * arity (and field names), no deeper structure. A union or intersection
 * flattens each member; a negation of a compound widens to `any`; a
 * signature becomes the bare `function`; a leaf is itself.
 */
function flattenComponent(t: Readonly<Type>): Type {
  if (!isCompound(t)) return t as Type;
  switch ((t as Exclude<Type, string>).kind) {
    case 'union':
    case 'intersection': {
      const a = t as { kind: 'union' | 'intersection'; types: Type[] };
      return algebraic(a.kind, a.types.map(flattenComponent));
    }
    case 'negation':
      return isCompound((t as { type: Type }).type) ? 'any' : (t as Type);
    case 'signature':
      return 'function';
    default:
      return mapComponents(t, () => 'any');
  }
}

/**
 * A union or intersection over `types` with structural repeats removed
 * (flattening several components produces identical members), unwrapped
 * when one member remains. The key is `typeToDedupKey`, which keeps the
 * spelling of a value type (`Infinity`, `NaN`) and does not descend into a
 * reference's definition.
 */
function algebraic(kind: 'union' | 'intersection', types: Type[]): Type {
  const seen = new Set<string>();
  const out: Type[] = [];
  for (const t of types) {
    const key = typeToDedupKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  if (out.length === 1) return out[0];
  return { kind, types: out };
}
