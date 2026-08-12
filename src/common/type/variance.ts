import type {
  Type,
  TypeParameter,
  TypeReference,
  TypeVariance,
} from './types.js';
import { declarationOf } from './reference.js';

/**
 * Variance of a parameterized NOMINAL type — the position analysis of
 * `docs/plans/2026-08-06-parameterized-nominal-types-design.md` §4.2, the
 * prescriptive diagnostic of §4.4, and the variance a subtype judgment may
 * actually use (§4.3, ruling C).
 *
 * Variance is **verified, never inferred**: every parameter has a declared
 * variance — the marker the author wrote, or `out` when none is spelled — and
 * this module checks that declaration against the body. A body edit that would
 * change the type's subtyping contract is therefore a loud error at the
 * declaration, never a silent re-inference at the use sites.
 *
 * Layering: this module sits BELOW `subtype.ts` and must never import it. §4.3
 * decides `tree<A> <: tree<B>` from the declared variance plus an argument-wise
 * comparison, so no body is ever consulted and no subtype question arises here.
 */

/** Where a parameter occurs, relative to the root of the body. */
export type Polarity = TypeVariance;

/** One occurrence of a type parameter in a body. */
export type VarianceOccurrence = {
  param: string;
  polarity: Polarity;
  /** §4.4 path syntax: named fields and tuple elements by name, unnamed
   * positions as `[0]`, signature parameters as `(arg 1)`, nested steps joined
   * with `.`. The empty string is the root of the body. */
  path: string;
  /** The unfulfilled forward reference this occurrence sits under. Such an
   * occurrence is RECORDED, not judged (ruling C): it counts as a USE of the
   * parameter but is excluded from the polarity join until the reference is
   * fulfilled. */
  deferredVia?: string;
};

export type VarianceAnalysis = {
  /** The joined polarity of each parameter's non-deferred occurrences.
   * `undefined` when it has none (either unused, or used only under an
   * unfulfilled forward reference). */
  observed: Map<string, Polarity | undefined>;
  occurrences: VarianceOccurrence[];
  /** The unfulfilled forward-reference names this verification waits on. */
  blockedOn: Set<string>;
};

export type VarianceResult =
  | { status: 'ok'; analysis: VarianceAnalysis }
  | { status: 'deferred'; blockedOn: string[]; analysis: VarianceAnalysis }
  | {
      status: 'violation';
      // The two `TypeVariableErrorCode`s this module can produce, spelled
      // INLINE rather than imported: `instantiate.ts` reads this module's
      // {@link subtypingVarianceOf}, and an `import type` back to it would be a
      // (madge-detected) type cycle.
      code: 'variance-violation' | 'generic-alias-unused-parameter';
      message: string;
      analysis: VarianceAnalysis;
    };

//
// ── Sign algebra ─────────────────────────────────────────────────────────────
//

function flip(p: Polarity): Polarity {
  return p === 'out' ? 'in' : p === 'in' ? 'out' : 'inout';
}

/** Compose the enclosing polarity with the variance of the position below it
 * (§4.2: `out` = same, `in` = flipped, `inout` absorbs). */
function compose(enclosing: Polarity, position: Polarity): Polarity {
  if (position === 'inout' || enclosing === 'inout') return 'inout';
  return position === 'out' ? enclosing : flip(enclosing);
}

/** The join of a set of observed polarities: a parameter occurring in both a
 * `+` and a `−` position is invariant. */
function joinPolarity(a: Polarity | undefined, b: Polarity): Polarity {
  if (a === undefined) return b;
  return a === b ? a : 'inout';
}

function step(path: string, next: string): string {
  if (path === '') return next;
  return next.startsWith('[') ? `${path}${next}` : `${path}.${next}`;
}

//
// ── Whose variance may be relied upon ────────────────────────────────────────
//

/**
 * May a variance judgment READ `decl`'s declared markers?
 *
 * True for everything that has no variance state to wait on — a plain
 * (non-parameterized) nominal, and a generic alias, which is expanded before
 * any of this sees it — and for a parameterized nominal whose verification has
 * completed. A record still `'deferred'` promises nothing yet: its declared
 * variance is an ASSUMPTION that fulfilment may still reject.
 */
export function isVarianceSettled(decl: Readonly<TypeReference>): boolean {
  return (
    decl._varianceState === undefined || decl._varianceState === 'verified'
  );
}

/** Every APPLIED reference in `t`, in structural order. Never follows a
 * reference's `def`: the walk stays within one body, and the records it yields
 * are the caller's to traverse (with its own seen-set). */
function forEachApplication(t: Type, cb: (ref: TypeReference) => void): void {
  if (typeof t !== 'object') return;
  switch (t.kind) {
    case 'signature':
      for (const a of t.args ?? []) forEachApplication(a.type, cb);
      for (const a of t.optArgs ?? []) forEachApplication(a.type, cb);
      if (t.variadicArg !== undefined)
        forEachApplication(t.variadicArg.type, cb);
      forEachApplication(t.result, cb);
      return;
    // The contextual-callback wrapper is transparent to a structural walk.
    case 'callback':
      forEachApplication(t.signature, cb);
      return;
    case 'union':
    case 'intersection':
      for (const x of t.types) forEachApplication(x, cb);
      return;
    case 'negation':
      forEachApplication(t.type, cb);
      return;
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      forEachApplication(t.elements, cb);
      return;
    case 'dictionary':
      forEachApplication(t.values, cb);
      return;
    case 'tuple':
      for (const el of t.elements) forEachApplication(el.type, cb);
      return;
    case 'record':
      for (const v of Object.values(t.elements)) forEachApplication(v, cb);
      return;
    case 'reference':
      if (t.args === undefined) return;
      cb(t);
      for (const a of t.args) forEachApplication(a, cb);
      return;
    default:
      return;
  }
}

/**
 * Is `decl`'s deferral (transitively) waiting on a forward reference that has
 * no definition yet — i.e. on an assumption that may never be discharged?
 *
 * This is what separates the two reasons a parameterized nominal can be
 * unverified, and the separation is load-bearing:
 *
 * - **Mutual recursion.** `a<T>`/`b<T>` referring to each other are unverified
 *   only until the group is checked, and the group check IS the coinductive
 *   assumption (§4.2: each member is verified under its own declared variance).
 *   A member may therefore be composed with, exactly as a verified declaration
 *   is — the fixpoint in `settleVarianceGroup` flips the whole group together,
 *   and a failure anywhere in it throws and rolls the group back.
 * - **An unfulfilled forward reference.** `b<T>` blocked on `type later<T>` may
 *   still be REJECTED when `later` arrives (or never verify at all). Composing
 *   with its declared variance would launder the assumption into a dependent
 *   `c<T> = tuple<x: b<T>>`, which would verify and grant `c<integer> <:
 *   c<number>` on the strength of a promise `b` has not kept — permanently, if
 *   the fulfilment is rejected. Such a reference DEFERS instead (ruling C),
 *   exactly like the unfulfilled reference it is waiting on.
 */
function dependsOnUnfulfilled(decl: Readonly<TypeReference>): boolean {
  const seen = new Set<Readonly<TypeReference>>([decl]);
  const pending: Readonly<TypeReference>[] = [decl];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.def === undefined) return true;
    let unfulfilled = false;
    forEachApplication(current.def, (ref) => {
      const d = declarationOf(ref);
      if (d.def === undefined) {
        unfulfilled = true;
        return;
      }
      if (isVarianceSettled(d) || seen.has(d)) return;
      seen.add(d);
      pending.push(d);
    });
    if (unfulfilled) return true;
  }
  return false;
}

//
// ── Position analysis ────────────────────────────────────────────────────────
//

/**
 * Every occurrence of `params` in `body`, with its polarity and its path.
 *
 * `selfName` is the type being declared: a reference to it is the RECURSIVE
 * occurrence, and it composes with its own declared (or default) variance —
 * the standard coinductive check, which terminates because the assumption is
 * fixed before descending.
 *
 * Termination is STRUCTURAL, so no seen-set is needed: an applied reference
 * descends into its `args` and NEVER into `decl.def`. A nominal type is opaque,
 * so its body is not part of this walk — the recursion a `type tree<T> =
 * tuple<value: T, children: list<tree<T>>>` closes lives entirely in the
 * argument list, and argument lists are finite.
 */
export function analyzeVariance(
  body: Type,
  params: readonly TypeParameter[],
  selfName: string
): VarianceAnalysis {
  const names = new Set(params.map((p) => p.name));
  const occurrences: VarianceOccurrence[] = [];
  const blockedOn = new Set<string>();

  const visit = (
    t: Type,
    polarity: Polarity,
    path: string,
    shadowed: ReadonlySet<string> | undefined,
    deferredVia: string | undefined
  ): void => {
    if (typeof t !== 'object') return;
    switch (t.kind) {
      case 'variable':
        if (!names.has(t.name)) return;
        if (shadowed?.has(t.name) === true) return;
        occurrences.push(
          deferredVia === undefined
            ? { param: t.name, polarity, path }
            : { param: t.name, polarity, path, deferredVia }
        );
        return;

      case 'signature': {
        // A nested `where` clause SHADOWS a same-named declaration parameter.
        let scope = shadowed;
        if (t.typeParams !== undefined && t.typeParams.length > 0) {
          scope = new Set(shadowed);
          for (const p of t.typeParams) (scope as Set<string>).add(p.name);
        }
        const flipped = flip(polarity);
        let n = 0;
        for (const a of t.args ?? [])
          visit(
            a.type,
            flipped,
            step(path, `(arg ${++n})`),
            scope,
            deferredVia
          );
        for (const a of t.optArgs ?? [])
          visit(
            a.type,
            flipped,
            step(path, `(arg ${++n})`),
            scope,
            deferredVia
          );
        if (t.variadicArg !== undefined)
          visit(
            t.variadicArg.type,
            flipped,
            step(path, '(variadic arg)'),
            scope,
            deferredVia
          );
        visit(t.result, polarity, step(path, '(result)'), scope, deferredVia);
        return;
      }

      // The contextual-callback wrapper is transparent to the polarity walk:
      // the arrow it wraps flips its parameters exactly as a bare one does.
      case 'callback':
        visit(t.signature, polarity, path, shadowed, deferredVia);
        return;

      case 'union':
      case 'intersection':
        for (const x of t.types)
          visit(x, polarity, path, shadowed, deferredVia);
        return;

      case 'negation':
        visit(t.type, flip(polarity), path, shadowed, deferredVia);
        return;

      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        visit(t.elements, polarity, path, shadowed, deferredVia);
        return;

      case 'dictionary':
        visit(t.values, polarity, path, shadowed, deferredVia);
        return;

      case 'tuple':
        t.elements.forEach((el, i) =>
          visit(
            el.type,
            polarity,
            step(path, el.name ?? `[${i}]`),
            shadowed,
            deferredVia
          )
        );
        return;

      case 'record':
        for (const [k, v] of Object.entries(t.elements))
          visit(v, polarity, step(path, k), shadowed, deferredVia);
        return;

      case 'reference': {
        if (t.args === undefined) return;
        const decl = declarationOf(t);
        const self = decl.name === selfName;
        // An unfulfilled forward reference has no variance yet (ruling C):
        // occurrences under it are recorded, not judged, and the declaration is
        // accepted provisionally until fulfilment.
        //
        // A reference whose declaration is itself waiting on one is treated
        // IDENTICALLY: composing with its declared-but-unverified variance
        // would launder an assumption that may never be discharged into this
        // declaration's verdict (see {@link dependsOnUnfulfilled}). A record
        // unverified only because its group is still being checked is NOT
        // deferred — that assumption is the group check itself.
        const unfulfilled =
          !self &&
          (decl.def === undefined ||
            (!isVarianceSettled(decl) && dependsOnUnfulfilled(decl)));
        if (unfulfilled) blockedOn.add(decl.name);
        t.args.forEach((a, i) => {
          const at = step(path, `${decl.name}<${i + 1}>`);
          if (unfulfilled) {
            visit(a, polarity, at, shadowed, deferredVia ?? decl.name);
            return;
          }
          // The recursive occurrence composes with the variance being ASSUMED
          // for this declaration; any other known reference with its own
          // declared variance (§4.2 table).
          const declared =
            (self ? params[i]?.variance : decl.typeParams?.[i]?.variance) ??
            'out';
          visit(a, compose(polarity, declared), at, shadowed, deferredVia);
        });
        return;
      }

      default:
        return;
    }
  };

  visit(body, 'out', '', undefined, undefined);

  const observed = new Map<string, Polarity | undefined>();
  for (const p of params) observed.set(p.name, undefined);
  for (const o of occurrences) {
    if (o.deferredVia !== undefined) continue;
    observed.set(o.param, joinPolarity(observed.get(o.param), o.polarity));
  }

  return { observed, occurrences, blockedOn };
}

//
// ── Verification ─────────────────────────────────────────────────────────────
//

/**
 * Verify each parameter's DECLARED variance (the written marker, or `out`)
 * against `body`.
 *
 * Returns `deferred` when the body reaches an unfulfilled forward reference:
 * ruling C accepts the declaration provisionally, with no early error, and the
 * strongly-connected group is verified together at fulfilment. Until then every
 * subtype judgment reads the parameters as `inout` (see
 * {@link subtypingVarianceOf}), which is sound whatever fulfilment reveals.
 *
 * MUST run AFTER the body parse returns: `parseType()` prefixes "Failed to
 * parse type" onto anything thrown while a body is being built.
 */
export function verifyVariance(
  typeName: string,
  params: readonly TypeParameter[],
  body: Type,
  ctx?: { triggeredBy?: string }
): VarianceResult {
  const analysis = analyzeVariance(body, params, typeName);

  // A phantom parameter is meaningless under either reading (§4.2). An
  // occurrence under an unfulfilled forward reference still COUNTS as a use.
  const used = new Set(analysis.occurrences.map((o) => o.param));
  const unused = params.filter((p) => !used.has(p.name));
  if (unused.length > 0)
    return {
      status: 'violation',
      code: 'generic-alias-unused-parameter',
      message: `The type parameter${unused.length === 1 ? '' : 's'} \`${unused
        .map((p) => p.name)
        .join('`, `')}\` of "${typeName}" ${
        unused.length === 1 ? 'is' : 'are'
      } never used in its definition`,
      analysis,
    };

  if (analysis.blockedOn.size > 0)
    return {
      status: 'deferred',
      blockedOn: [...analysis.blockedOn],
      analysis,
    };

  for (const p of params) {
    const declared = p.variance ?? 'out';
    const observed = analysis.observed.get(p.name)!;
    // An `inout` declaration verifies against ANY body: invariance promises
    // nothing, so it is always sound — just less permissive (§4.4).
    if (declared === 'inout' || declared === observed) continue;
    return {
      status: 'violation',
      code: 'variance-violation',
      message: violationMessage(typeName, p, observed, analysis, ctx),
      analysis,
    };
  }

  return { status: 'ok', analysis };
}

//
// ── The §4.4 prescriptive message ────────────────────────────────────────────
//

const WORD: Record<Polarity, string> = {
  out: 'covariant',
  in: 'contravariant',
  inout: 'invariant',
};

function describePath(path: string): string {
  return path === '' ? 'the body' : `\`${path}\``;
}

/** One representative occurrence of `polarity`, by path. */
function representative(
  analysis: VarianceAnalysis,
  param: string,
  polarity: Polarity
): string {
  const o = analysis.occurrences.find(
    (x) =>
      x.param === param &&
      x.deferredVia === undefined &&
      x.polarity === polarity
  );
  return describePath(o?.path ?? '');
}

function violationMessage(
  typeName: string,
  param: TypeParameter,
  observed: Polarity,
  analysis: VarianceAnalysis,
  ctx?: { triggeredBy?: string }
): string {
  const p = param.name;
  const declared = param.variance ?? 'out';

  // 1. Which variance was violated, and where it came from.
  const origin =
    param.variance === undefined
      ? `is ${WORD[declared]} (\`out\` is the default when no marker is written)`
      : `is declared \`${declared}\` (${WORD[declared]})`;

  // 2. The offending occurrence(s), BY PATH.
  let where: string;
  if (observed === 'inout')
    where =
      `but \`${p}\` appears in both output (${representative(analysis, p, 'out')})` +
      ` and input (${representative(analysis, p, 'in')}) positions, so it can only be invariant`;
  else
    where =
      `but \`${p}\` appears only in ${observed === 'in' ? 'input' : 'output'} positions` +
      ` (${representative(analysis, p, observed)}), so it is ${WORD[observed]}`;

  // 3. The remedy set: exactly the markers that would verify. The join is the
  // most permissive one the body admits; `inout` is always sound. A marker
  // outside the set is NEVER offered.
  const markers: Polarity[] = [observed];
  if (observed !== 'inout') markers.push('inout');
  const lines = markers.map((m) => {
    const clause = `  • declare it \`${m}\`:  type ${typeName}<${m} ${p}> = …`;
    if (m !== 'inout') return clause;
    const a = /^[aeiou]/i.test(typeName) ? 'an' : 'a';
    return `${clause}\n    (${a} \`${typeName}<integer>\` is then no longer usable as ${a} \`${typeName}<number>\`)`;
  });
  // The structural alternative is listed LAST: only the author knows whether
  // the wider subtyping is worth the split.
  const offending = flip(declared); // `declared` is never `inout` here
  lines.push(
    `  • or keep \`${typeName}\` ${WORD[declared]} by moving the ${
      offending === 'in' ? 'input' : 'output'
    } occurrence (${representative(analysis, p, offending)}) out of the body — e.g. split it off into a type of its own`
  );

  const late =
    ctx?.triggeredBy === undefined
      ? ''
      : ` (surfaced when \`${ctx.triggeredBy}\` was declared)`;

  return `parameter \`${p}\` of \`${typeName}\` ${origin}${late}, ${where}.\n${lines.join('\n')}`;
}

//
// ── What a subtype judgment may use (§4.3) ───────────────────────────────────
//

/**
 * The variance parameter `i` of `ref`'s declaration may be READ AS by a subtype
 * judgment.
 *
 * `inout` until the declaration's variance has been verified: in the window
 * between a provisional acceptance and fulfilment (ruling C) an answer given
 * under invariance stays sound under whatever variance fulfilment reveals, so
 * nothing recorded in the window ever needs invalidating.
 */
export function subtypingVarianceOf(
  ref: Readonly<TypeReference>,
  i: number
): Polarity {
  const decl = declarationOf(ref as TypeReference);
  if (decl._varianceState !== 'verified') return 'inout';
  return decl.typeParams?.[i]?.variance ?? 'out';
}
