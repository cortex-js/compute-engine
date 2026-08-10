/**
 * Kleene three-valued logic over `boolean | undefined`, where `undefined`
 * means UNDECIDED — not "false".
 *
 * The engine's three-valued predicates (`CollectionHandlers.contains`,
 * membership sub-queries, finiteness probes) reserve `undefined` for "cannot
 * be determined". The JavaScript built-ins collapse it: `values.some(...)` and
 * `items.every((x) => probe(x) ?? false)` both turn an undecided sub-query
 * into a definite answer, which is precisely the unsound reading those
 * handlers exist to avoid (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.2
 * invariant).
 *
 * These helpers were triplicated as private copies in `library/collections.ts`
 * (`kleeneAny`), `library/sets.ts` (`kleeneOr`/`kleeneAnd`/`kleeneNot`) and
 * `library/combinatorics.ts` (`kleeneEvery`); this is their shared home.
 */

/**
 * Three-valued OR: `true` as soon as one value is `true`, `false` only when
 * every value is definitely `false`, `undefined` when nothing holds but at
 * least one value could not be decided.
 */
export function kleeneOr(
  values: Iterable<boolean | undefined>
): boolean | undefined {
  let undecided = false;
  for (const v of values) {
    if (v === true) return true;
    if (v === undefined) undecided = true;
  }
  return undecided ? undefined : false;
}

/**
 * Three-valued AND: `false` as soon as one value is `false`, `true` only when
 * every value is definitely `true`, `undefined` when nothing refutes but at
 * least one value could not be decided.
 */
export function kleeneAnd(
  values: Iterable<boolean | undefined>
): boolean | undefined {
  let undecided = false;
  for (const v of values) {
    if (v === false) return false;
    if (v === undefined) undecided = true;
  }
  return undecided ? undefined : true;
}

/** Three-valued NOT: undecided stays undecided. */
export function kleeneNot(v: boolean | undefined): boolean | undefined {
  return v === undefined ? undefined : !v;
}

/**
 * Three-valued `Array.prototype.some()`: the probe is not run past the first
 * item that definitely holds (as `some()` does), so a probe with a cost — or
 * one that would throw on a later item — behaves as the built-in would.
 */
export function kleeneSome<T>(
  items: ReadonlyArray<T>,
  probe: (item: T, index: number) => boolean | undefined
): boolean | undefined {
  let undecided = false;
  for (let i = 0; i < items.length; i++) {
    const v = probe(items[i], i);
    if (v === true) return true;
    if (v === undefined) undecided = true;
  }
  return undecided ? undefined : false;
}

/**
 * Three-valued `Array.prototype.every()`: the probe is not run past the first
 * item that definitely refutes (as `every()` does).
 */
export function kleeneEvery<T>(
  items: ReadonlyArray<T>,
  probe: (item: T, index: number) => boolean | undefined
): boolean | undefined {
  let undecided = false;
  for (let i = 0; i < items.length; i++) {
    const v = probe(items[i], i);
    if (v === false) return false;
    if (v === undefined) undecided = true;
  }
  return undecided ? undefined : true;
}
