/**
 * The fixpoint of ASSIGNMENT EVIDENCE over one canonicalization of a block.
 *
 * `Assign` and an untyped `let` (`Declare` with an initial value) record the
 * static type of their value on the target binding when they are
 * canonicalized (`joinAssignmentEvidence`, `library/core.ts`). The value's
 * type is read at that moment. When the value reads another local whose type
 * is widened by an assignment canonicalized LATER — in a loop, the back edge
 * carries that later assignment to the earlier read — the recorded type is
 * too narrow:
 *
 * ```
 * let circles = [(2, 0.5, 0, 1)]         // list<tuple<integer, real, …>>
 * while … {
 *   let e = circles[j]                   // recorded: tuple<integer, real, …>
 *   …
 *   circles = [...circles, (k, x, y, 1)] // k: number, widens circles
 * }
 * ```
 *
 * `e` stayed typed with real elements although the second turn of the loop
 * reads a tuple with `number` elements. The compiled complex lane represents
 * a `number` value as a `{re, im}` object and a `real` value as a JavaScript
 * number, so `e[1] - k` added a number to an object and every comparison
 * with `e[1]` was false (Tycho item 332, the gasket programs b and c, whose
 * compiled run never ended because its de-duplication test never matched).
 *
 * So each evidence site registers a function that joins its value's CURRENT
 * type again, and the outermost block canonicalization re-runs every site
 * until no recorded type changes. Joins only widen, so the passes converge
 * unless a type grows without bound (`xs = (xs, 1)` in a loop). After
 * `evidencePassBudget(sites)` passes the joins continue with every compound
 * type nested deeper than `EVIDENCE_TYPE_DEPTH` replaced by a wide type
 * (`coarsenEvidenceType` says which kinds), which bounds the height of the
 * types and so ends the growth. If that also does not converge, every
 * binding the sites wrote is reset to `unknown`, which is wide and therefore
 * sound for every consumer.
 *
 * The reset is GLOBAL, not limited to the sites that still changed on the
 * last pass: a site that settled may have read its value type from a binding
 * that an unsettled site writes, so its recorded type can be too narrow as
 * well. Finding the sites that depend on an unsettled one would need the
 * read dependencies between the sites, which are not recorded.
 */

import type { Type } from '../../common/type/types.js';
import { reduceType } from '../../common/type/reduce.js';

/** A registered evidence site. `rejoin` joins the value's current type on
 * the binding and returns `true` when the recorded type changed; with
 * `coarse`, the joined type goes through `coarsenEvidenceType` first.
 * `reset` sets the binding back to `unknown`. */
type EvidenceSite = {
  rejoin: (coarse: boolean) => boolean;
  reset: () => void;
};

const EVIDENCE_TYPE_DEPTH = 4;

/**
 * `t` with every compound type nested more than `EVIDENCE_TYPE_DEPTH` levels
 * deep replaced by a wide type. The kinds that count as a level are: `tuple`,
 * `list`, `set`, `collection`, `indexed_collection` and `broadcastable`
 * (their element types), `dictionary` and `record` (their value types), each
 * replaced by `any` below the limit, and a function `signature` (its result
 * type only), replaced by `function` below the limit. The argument types of
 * a signature are not coarsened: replacing an argument type by a wider one
 * makes the signature NARROWER (a function that accepts more is a subtype),
 * so that would not be a widening. A polymorphic signature (with type
 * parameters) is only replaced at the limit, since its result type can name
 * its type parameters. The members of a union or an intersection are at the
 * depth of the union. Other types are kept as they are.
 */
export function coarsenEvidenceType(
  t: Type,
  depth: number = EVIDENCE_TYPE_DEPTH
): Type {
  if (typeof t === 'string') return t;
  if (t.kind === 'union' || t.kind === 'intersection')
    return { ...t, types: t.types.map((x) => coarsenEvidenceType(x, depth)) };
  switch (t.kind) {
    case 'tuple':
      if (depth <= 0) return 'any';
      return {
        ...t,
        elements: t.elements.map((e) => ({
          ...e,
          type: coarsenEvidenceType(e.type, depth - 1),
        })),
      };
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      if (depth <= 0) return 'any';
      return { ...t, elements: coarsenEvidenceType(t.elements, depth - 1) };
    case 'dictionary':
      if (depth <= 0) return 'any';
      return { ...t, values: coarsenEvidenceType(t.values, depth - 1) };
    case 'record':
      if (depth <= 0) return 'any';
      return {
        ...t,
        elements: Object.fromEntries(
          Object.entries(t.elements).map(([k, v]) => [
            k,
            coarsenEvidenceType(v, depth - 1),
          ])
        ),
      };
    case 'signature':
      if (depth <= 0) return 'function';
      if (t.typeParams !== undefined) return t;
      return { ...t, result: coarsenEvidenceType(t.result, depth - 1) };
    default:
      return t;
  }
}

/**
 * The block locals whose hoisted binding carries a DECLARED type
 * (`Declare(v, "list<real>")`, `let v: list<real>`). The declared type is
 * the contract, so a second read of an assignment's value type must not
 * widen it: `joinAssignmentEvidence` registers no evidence site for them.
 */
const DECLARED_LOCALS = new WeakSet<object>();

/** Record that the block-local binding `def` has a declared type. */
export function markDeclaredLocal(def: object): void {
  DECLARED_LOCALS.add(def);
}

/** Whether the block-local binding `def` has a declared type. */
export function isDeclaredLocal(def: object): boolean {
  return DECLARED_LOCALS.has(def);
}

type EvidenceSession = {
  depth: number;
  sites: EvidenceSite[];
  lost: WeakSet<object>;
};

/**
 * The number of passes over `sites` before the joins are coarsened (and
 * again before the reset). A widening moves along a chain of sites one site
 * per pass when each site reads the binding the previous one writes, in the
 * opposite order of registration (a back edge), so a chain of `n` sites can
 * need `n + 1` passes to settle without any unbounded growth. The budget is
 * therefore `sites.length + 1`, at least 16, and at most 256 so that a very
 * large program does not spend quadratic time before the coarsening.
 */
function evidencePassBudget(sites: ReadonlyArray<EvidenceSite>): number {
  return Math.min(256, Math.max(16, sites.length + 1));
}

const SESSIONS = new WeakMap<object, EvidenceSession>();

/**
 * Register an evidence site on the canonicalization in progress. Outside a
 * block canonicalization (a lone `Assign` boxed at the top level) there is
 * no later statement that could widen a read, and nothing is registered.
 */
export function registerEvidenceSite(engine: object, site: EvidenceSite): void {
  const session = SESSIONS.get(engine);
  if (session !== undefined && session.depth > 0) session.sites.push(site);
}

/**
 * Record, in the session in progress, that the value type of an evidence
 * site targeting the binding `target` could no longer be read after an
 * earlier read succeeded. The site then wrote `unknown` on the binding.
 * A binding recorded `unknown` is read as "no evidence yet" by the join, so
 * without this mark another site's join would replace that `unknown` with
 * its own narrower type. `isEvidenceLost` lets the join skip the binding for
 * the rest of the session. Outside a session nothing is recorded.
 */
export function markEvidenceLost(engine: object, target: object): void {
  const session = SESSIONS.get(engine);
  if (session !== undefined && session.depth === 0) session.lost.add(target);
}

/** Whether `markEvidenceLost` recorded `target` in the session in progress. */
export function isEvidenceLost(engine: object, target: object): boolean {
  return SESSIONS.get(engine)?.lost.has(target) ?? false;
}

/**
 * Run `fn` (the canonicalization of a block's statements) inside an evidence
 * session. When the outermost session ends, re-run every registered site to
 * a fixpoint.
 */
export function withEvidenceSession<T>(engine: object, fn: () => T): T {
  let session = SESSIONS.get(engine);
  if (session === undefined) {
    session = { depth: 0, sites: [], lost: new WeakSet() };
    SESSIONS.set(engine, session);
  }
  session.depth += 1;
  let result: T;
  try {
    result = fn();
  } catch (e) {
    session.depth -= 1;
    if (session.depth === 0) {
      session.sites = [];
      session.lost = new WeakSet();
    }
    throw e;
  }
  session.depth -= 1;
  if (session.depth === 0) {
    const sites = session.sites;
    session.sites = [];
    if (sites.length > 0) {
      const run = (coarse: boolean): boolean => {
        let changed = true;
        let passes = 0;
        const budget = evidencePassBudget(sites);
        while (changed && passes < budget) {
          changed = false;
          for (const site of sites) if (site.rejoin(coarse)) changed = true;
          passes += 1;
        }
        return changed;
      };
      try {
        if (run(false) && run(true)) for (const site of sites) site.reset();
      } finally {
        session.lost = new WeakSet();
      }
    }
  }
  return result;
}

/**
 * The join of two evidence types, taken STRUCTURALLY: the lists among the
 * members of the two types become one list whose element type is the join of
 * their element types, and the tuples of one length (with the same names, or
 * none) become one tuple whose slots are the joins of their slots. Every
 * other member is kept, and the members are reduced as a union.
 *
 * The plain union of two list types whose elements are tuples of different
 * component types reduced to the bare `list`, which says nothing about the
 * elements. In a work-queue loop (`let gap = queue[i]`, `let p = gap[1]`,
 * `queue = [...queue, (p, q, c, depth + 1)]`) the second pass of the
 * fixpoint then read `gap` as `unknown`, every local derived from it lost
 * its evidence, and the compiler refused the element reads of a program
 * whose interpreter run is correct (Tycho item 332, program a).
 *
 * The result is a supertype of both inputs, so the join only widens. It is
 * less precise than the union in one respect: it does not keep which slot
 * types occur together.
 */
export function joinEvidenceTypes(a: Type, b: Type): Type {
  const members: Type[] = [];
  const flatten = (t: Type): void => {
    if (typeof t === 'object' && t.kind === 'union') t.types.forEach(flatten);
    else members.push(t);
  };
  flatten(a);
  flatten(b);

  let list: Type | undefined;
  const tuples = new Map<string, Type>();
  const rest: Type[] = [];
  for (const m of members) {
    if (typeof m === 'object' && m.kind === 'list') {
      if (list === undefined) list = m;
      else if (typeof list === 'object' && list.kind === 'list') {
        const sameShape =
          JSON.stringify(list.dimensions) === JSON.stringify(m.dimensions);
        list = {
          kind: 'list',
          elements: joinEvidenceTypes(list.elements, m.elements),
          ...(sameShape && list.dimensions !== undefined
            ? { dimensions: list.dimensions }
            : {}),
        };
      }
      continue;
    }
    if (typeof m === 'object' && m.kind === 'tuple') {
      // The length is part of the key: the names alone give the empty tuple
      // and a one-element unnamed tuple the same key.
      const key = JSON.stringify([
        m.elements.length,
        ...m.elements.map((e) => e.name ?? ''),
      ]);
      const seen = tuples.get(key);
      if (
        seen === undefined ||
        typeof seen !== 'object' ||
        seen.kind !== 'tuple'
      )
        tuples.set(key, m);
      else
        tuples.set(key, {
          kind: 'tuple',
          elements: seen.elements.map((e, i) => ({
            ...e,
            type: joinEvidenceTypes(e.type, m.elements[i].type),
          })),
        });
      continue;
    }
    rest.push(m);
  }
  const all: Type[] = [
    ...rest,
    ...(list !== undefined ? [list] : []),
    ...tuples.values(),
  ];
  if (all.length === 1) return all[0];
  return reduceType({ kind: 'union', types: all });
}
