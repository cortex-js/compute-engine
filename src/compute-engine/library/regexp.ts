import type { SymbolDefinitions, Expression } from '../global-types.js';
import { isFunction, isString } from '../boxed-expression/type-guards.js';
import { splitGraphemeClusters } from '../../common/grapheme-splitter.js';
import { asSmallInteger } from '../boxed-expression/numerics.js';

/**
 * Regular expressions (Strings Phase 3).
 *
 * Plan: `docs/STRING_ROADMAP.md`.
 * Spec: `docs/STRING_ROADMAP.md`, "Regular Expressions".
 *
 * THE DIALECT IS THE HOST'S (user ruling, 2026-08-17): patterns are compiled
 * with the JavaScript engine's own `RegExp`, with no feature subset, no
 * pattern-complexity cap and no input-size cap. Backreferences, lookahead and
 * lookbehind therefore all work, and compiled JavaScript emits the same host
 * `RegExp`, so the interpreter and compiled code agree by construction.
 *
 * The cost of that ruling, recorded here because it cannot be guarded
 * against: host regex engines BACKTRACK, so a pattern such as `(a+)+$`
 * against a non-matching subject can take time exponential in the subject
 * length, and the engine cannot interrupt it. Deadlines are cooperative
 * polling BETWEEN evaluation steps (`docs/TIMEOUT-MODEL.md`) and one
 * `RegExp.exec()` is a single step, so no `withTimeLimit` span, abort signal
 * or timeout bounds it. Callers must not combine untrusted patterns with
 * untrusted input when a bounded execution time is required.
 */

/** Flags the host understands, minus the ones this library owns.
 *
 * `g` and `y` are REJECTED as user input rather than passed through: they
 * carry mutable `lastIndex` state on the compiled object, so the same
 * `regexp` value would answer differently depending on what matched it last —
 * a value must not do that. `StringMatchAll` adds `g` to its own private
 * copy instead. */
// JavaScript's flags are `d g i m s u v y`. `x` (free-spacing) is an
// unshipped proposal and is NOT accepted: letting it through this gate sent
// the call on to the host, which threw, and the user got "not a valid regular
// expression" — an error blaming a perfectly good PATTERN for a bad FLAG.
const ACCEPTED_FLAGS = 'dimsuv';

/** Compiled host patterns, keyed by pattern and flags.
 *
 * A `regexp` VALUE is the `RegExp(pattern, flags)` expression itself (there
 * is no separate boxed class), so two structurally identical patterns are the
 * same value and share one compiled object. The cache is keyed by text rather
 * than by node identity for exactly that reason. */
const HOST_PATTERN_CACHE = new Map<string, globalThis.RegExp>();

/** How many compiled patterns the cache keeps.
 *
 * Bounded because patterns can be COMPUTED: a long-running host that accepts
 * dynamic patterns would otherwise retain one `RegExp` per distinct pattern
 * text for the life of the process. Oldest-first eviction — a plain insertion
 * order drop rather than a true LRU, which is enough for a cache whose miss
 * costs one `RegExp` construction. */
const HOST_PATTERN_CACHE_LIMIT = 256;

/** The flags actually handed to the host: the user's, plus a Unicode mode.
 *
 * The spec requires patterns to be code-point-aware, so `u` is added when the
 * user asked for neither `u` nor `v`. `u` rather than `v` deliberately: `v`
 * is STRICTER (it rejects patterns with an unescaped `[`, `{` or `-` inside a
 * character class that `u` accepts), and rejecting a pattern a user wrote
 * would be a dialect limitation, which the ruling excludes. */
function hostFlags(flags: string, extra = ''): string {
  const base = flags.includes('u') || flags.includes('v') ? flags : flags + 'u';
  return extra && !base.includes(extra) ? base + extra : base;
}

/** Compile `pattern` for the host, or `undefined` if the host rejects it.
 *
 * SHARED and cached, and therefore only ever compiled WITHOUT `g`/`y`: a
 * non-global `exec`/`test` neither reads nor writes `lastIndex`, so the same
 * object can serve every caller. Anything that ITERATES needs
 * {@linkcode iteratingRegExp} instead. */
function hostRegExp(
  pattern: string,
  flags: string
): globalThis.RegExp | undefined {
  // A NUL separator, not a space: a pattern may legally CONTAIN a space,
  // and `'a b' + '' ` must not collide with `'a' + 'b'`.
  const key = `${pattern}\u0000${hostFlags(flags)}`;
  const cached = HOST_PATTERN_CACHE.get(key);
  if (cached) return cached;
  let compiled: globalThis.RegExp;
  try {
    compiled = new globalThis.RegExp(pattern, hostFlags(flags));
  } catch {
    return undefined;
  }
  if (HOST_PATTERN_CACHE.size >= HOST_PATTERN_CACHE_LIMIT) {
    const oldest = HOST_PATTERN_CACHE.keys().next().value;
    if (oldest !== undefined) HOST_PATTERN_CACHE.delete(oldest);
  }
  HOST_PATTERN_CACHE.set(key, compiled);
  return compiled;
}

/** A FRESH `g`-flagged compiled pattern, for a caller that walks matches.
 *
 * Deliberately never cached, and this is load-bearing rather than cautious. A
 * `g`-flagged object carries its scan position in `lastIndex`, so sharing one
 * between two live loops corrupts both. That is reachable from ordinary user
 * code, not just in principle: a FUNCTION replacement whose body matches the
 * same pattern re-enters this library while the outer `StringReplace` loop is
 * mid-scan —
 *
 *     StringReplace(s, p, m -> StringReplace(m.match, p, "Z"))
 *
 * — and with a shared object the inner call resets `lastIndex`, so the outer
 * loop restarts forever and never returns. Compiling per call costs a
 * `RegExp` construction, which is negligible beside the match itself. */
function iteratingRegExp(
  pattern: string,
  flags: string
): globalThis.RegExp | undefined {
  try {
    return new globalThis.RegExp(pattern, hostFlags(flags, 'g'));
  } catch {
    return undefined;
  }
}

/** The code-unit width of the code POINT starting at `i` — 2 for a surrogate
 * pair, 1 otherwise.
 *
 * Used to step past a zero-width match. The obvious spelling,
 * `[...subject.slice(i)][0].length`, copies the whole remaining suffix and
 * expands its code points just to read the first one, which makes a pattern
 * that matches at every position (`(?:)`) quadratic in the subject length. */
function codePointWidthAt(s: string, i: number): number {
  const cp = s.codePointAt(i);
  return cp !== undefined && cp > 0xffff ? 2 : 1;
}

/** The pattern and flag text of a `regexp`-valued expression, following a
 * symbol to its value, or `undefined` if this is not a compiled pattern. */
function patternOf(
  expr: Expression | undefined
): { pattern: string; flags: string } | undefined {
  if (expr === undefined) return undefined;
  // A `regexp`-typed symbol holds the `RegExp(…)` expression as its value.
  const x = isFunction(expr, 'RegExp') ? expr : (expr.value ?? expr);
  if (!isFunction(x, 'RegExp') || x.nops < 1) return undefined;
  // Resolve each operand to a string VALUE. A literal already is one; a
  // COMPUTED operand (a symbol holding a string, a `Join(...)`) becomes one
  // only once evaluated — which is exactly where a computed pattern is meant
  // to be checked, since its text is not known before then. An operand that
  // does not resolve to a string declines, leaving the call symbolic rather
  // than matching with a wrong pattern or a silently empty flag set.
  const textOf = (op: Expression | undefined): string | undefined => {
    if (op === undefined) return undefined;
    if (isString(op)) return op.string;
    const v = op.evaluate();
    return isString(v) ? v.string : undefined;
  };
  const pattern = textOf(x.op1);
  if (pattern === undefined) return undefined;
  let flags = '';
  if (x.nops >= 2) {
    const f = textOf(x.op2);
    if (f === undefined) return undefined;
    flags = f;
  }
  return { pattern, flags };
}

/**
 * Code-unit offset → 1-based GRAPHEME CLUSTER index, for a whole subject.
 *
 * Every string operator in the library indexes by grapheme cluster
 * (`Length("é")` is 1 whatever its normalization), but a host regex reports
 * code-unit offsets. Returning code-unit offsets here would make the regex
 * operators the only ones in the library that disagree, and would break the
 * composition the `range` field exists for: `Slice(s, m.range)` would cut
 * into the middle of a cluster.
 *
 * Two arrays are returned. `index` maps each code-unit offset in `0…s.length`
 * to the 1-based index of the cluster CONTAINING it (an offset at a cluster
 * boundary maps to the cluster starting there; `s.length` maps one past the
 * last cluster). `isBoundary` marks the offsets where a cluster starts, and
 * it is what lets `clusterSpan` REFUSE a match that begins or ends inside a
 * cluster rather than widening outward to whole ones. Widening was the
 * earlier design and is wrong: it would make `Slice(subject, m.range)` return
 * the containing cluster while `match` is the component inside it, silently
 * breaking the composition law the `range` field exists for.
 */
type ClusterMap = { index: number[]; isBoundary: boolean[] };

/** A cluster map built at most ONCE per subject.
 *
 * `clusterIndexOfOffset` walks the whole subject and allocates two arrays of
 * its length. Calling it per match made `StringMatchAll` and a
 * function-replacement `StringReplace` quadratic — measured at 45 ms / 99 ms /
 * 331 ms / 1393 ms for 200 / 400 / 800 / 1600 matches, a clean 4× per
 * doubling — and `ce.maxCollectionSize` lets a legitimate call reach ~10 000
 * matches. Threading one map through a whole walk makes it O(n + m). */
function clusterMapOf(s: string): () => ClusterMap {
  let cached: ClusterMap | undefined;
  return () => (cached ??= clusterIndexOfOffset(s));
}

function clusterIndexOfOffset(s: string): ClusterMap {
  const index = new Array<number>(s.length + 1);
  const isBoundary = new Array<boolean>(s.length + 1).fill(false);
  let offset = 0;
  let cluster = 1;
  for (const g of splitGraphemeClusters(s)) {
    isBoundary[offset] = true;
    for (let k = 0; k < g.length; k++) index[offset + k] = cluster;
    offset += g.length;
    cluster += 1;
  }
  index[s.length] = cluster; // one past the end
  isBoundary[s.length] = true;
  return { index, isBoundary };
}

/** The 1-based, inclusive cluster span covered by a code-unit match, or
 * `undefined` when the match does not correspond to whole clusters.
 *
 * `undefined` in two cases, and the second is the subtle one:
 *
 * - An EMPTY match occupies no cluster at all.
 * - A match that starts or ends INSIDE a cluster has no cluster span that
 *   names exactly it. A host regex can match a code point that is only part
 *   of a user-perceived character — `👩` inside the family emoji
 *   `👨‍👩‍👧` is one such match — and widening outward to the containing
 *   cluster would make `Slice(subject, m.range)` return the WHOLE family
 *   emoji while `match` is the single component. That silently breaks the
 *   composition law `range` exists for, so there is no honest span to report
 *   and the field is `Nothing` instead. `match` still carries the exact text
 *   the host matched, so nothing is lost — only the span is unavailable.
 */
function clusterSpan(
  subject: string,
  start: number,
  length: number,
  map?: ClusterMap
): [first: number, last: number] | undefined {
  if (length === 0) return undefined;
  const { index, isBoundary } = map ?? clusterIndexOfOffset(subject);
  if (!isBoundary[start] || !isBoundary[start + length]) return undefined;
  const first = index[start];
  const last = index[start + length - 1];
  if (first === undefined || last === undefined || last < first)
    return undefined;
  return [first, last];
}

/** Build the record a match reports.
 *
 * - `match`   the matched text. ALWAYS present.
 * - `range`   its 1-based inclusive span in GRAPHEME CLUSTERS, so
 *             `Slice(subject, m.range)` returns exactly `match`. **Present
 *             only when the match spans whole clusters** — see
 *             {@linkcode clusterSpan} for the two cases that have no span (an
 *             empty match, and one that starts or ends inside a cluster).
 *             Where there is none the key is ABSENT, so reading it answers
 *             `Missing`: a `Nothing` value is erased from a dictionary by the
 *             engine's own literal rule, and `Missing` is precisely the
 *             "absent but meaningful" marker. Test it before slicing.
 * - `groups`  the numbered captures, in order. ALWAYS present (empty for a
 *             pattern with no groups); a group that did not participate is
 *             `Nothing`.
 * - `names`   the named captures as a dictionary. ALWAYS present (empty for a
 *             pattern with no named groups).
 */
function matchRecord(
  ce: Expression['engine'],
  subject: string,
  m: RegExpExecArray,
  map?: () => ClusterMap
): Expression {
  const span = clusterSpan(subject, m.index, m[0].length, map?.());
  const range =
    span === undefined
      ? ce.Nothing
      : ce.function('Range', [ce.number(span[0]), ce.number(span[1])]);

  // `Missing`, never `Nothing`, for a group that did not participate:
  // `Nothing` is the empty-sequence marker and is ERASED when the `List` is
  // built, which COLLAPSES the slot. With it, `(a)|(b)` reported a
  // one-element `groups` for both `"a"` and `"b"`, so a caller could not tell
  // which alternative fired — destroying exactly the positional information
  // numbered captures exist to carry. `Missing` is the "absent but
  // positioned" marker and survives the list.
  const groups = ce.function(
    'List',
    m.slice(1).map((g) => (g === undefined ? ce.Missing : ce.string(g)))
  );

  // Same reasoning for a named group that did not participate: keep the KEY,
  // so `names` still tells the caller the group exists.
  const named = Object.entries(m.groups ?? {}).map(([k, v]) =>
    ce.function('KeyValuePair', [
      ce.string(k),
      v === undefined ? ce.Missing : ce.string(v),
    ])
  );

  return ce.function('Dictionary', [
    ce.function('KeyValuePair', [ce.string('match'), ce.string(m[0])]),
    ce.function('KeyValuePair', [ce.string('range'), range]),
    ce.function('KeyValuePair', [ce.string('groups'), groups]),
    ce.function('KeyValuePair', [
      ce.string('names'),
      ce.function('Dictionary', named),
    ]),
  ]);
}

/** Split `subject` at each match of a `regexp`-valued operand, or `undefined`
 * if `sep` is not one (leaving the literal-separator path to its caller).
 *
 * Follows the host's own split rule, including for ZERO-WIDTH separators,
 * which are the whole reason this is not a simple `exec` loop. A lookahead
 * such as `(?=b)` matches without consuming anything, and the host still
 * splits there: `"ab".split(/(?=b)/)` is `["a", "b"]`. The rule that makes
 * that work — and that stops a zero-width pattern from splitting at every
 * position forever — is the host's: a match whose END equals the start of the
 * current segment produces NO split, and the scan simply advances. Advancing
 * is by one code POINT, never one code unit, so a surrogate pair is never
 * split down the middle.
 *
 * Captures are NOT emitted, unlike the host, which interleaves them into the
 * result. That is the plan's D12 deferral, not an oversight: a caller who
 * wants captures wants `StringMatchAll`, whose records carry them. */
export function splitByPattern(
  subject: string,
  sep: Expression
): string[] | undefined {
  const p = patternOf(sep);
  if (p === undefined) return undefined;
  const re = iteratingRegExp(p.pattern, p.flags);
  if (re === undefined) return undefined;

  /** The code-unit width of the code POINT starting at `i`. */
  const step = (i: number) => codePointWidthAt(subject, i);

  // The host's EMPTY-SUBJECT rule, which the scan below cannot express
  // because it is guarded by `scan < subject.length` and so never runs:
  // splitting `""` yields `[]` when the separator matches the empty string,
  // and `[""]` when it does not. Without this, `StringSplit("", RegExp("a*"))`
  // answered `[""]` where the host answers `[]`.
  if (subject.length === 0) {
    re.lastIndex = 0;
    return re.test('') ? [] : [subject];
  }

  const out: string[] = [];
  let segmentStart = 0; // start of the segment being accumulated
  let scan = 0; // where to look for the next separator
  while (scan < subject.length) {
    re.lastIndex = scan;
    const m = re.exec(subject);
    if (m === null) break;
    // `exec` searches FORWARD from `scan`, so it can land on a zero-width
    // match at the very end of the subject. The host never splits there — its
    // scan only considers positions strictly before the end — and admitting
    // it appended a spurious trailing `""` for patterns like `$` and `\b`.
    if (m.index >= subject.length) break;
    const matchEnd = m.index + m[0].length;
    if (matchEnd === segmentStart) {
      // No progress would be made: the host does not split here.
      scan = m.index + step(m.index);
      continue;
    }
    out.push(subject.slice(segmentStart, m.index));
    segmentStart = matchEnd;
    scan = matchEnd > m.index ? matchEnd : matchEnd + step(matchEnd);
  }
  out.push(subject.slice(segmentStart));
  return out;
}

/** `StringReplace` with a `regexp` target.
 *
 * Owns the whole call rather than sharing the literal path's loop, because an
 * occurrence here is a host match rather than a run of grapheme clusters.
 * `replacement` is either a string used literally — `$1`-style templates are
 * NOT expanded, per the plan's D12, since the function form covers the need
 * without the parsing ambiguity — or a function called with the same match
 * record `StringMatch` returns. */
export function replaceByPattern(
  ce: Expression['engine'],
  subject: string,
  target: Expression,
  replacement: Expression | undefined,
  count: Expression | undefined
): Expression | undefined {
  const p = patternOf(target);
  if (p === undefined || replacement === undefined) return undefined;
  const re = iteratingRegExp(p.pattern, p.flags);
  if (re === undefined) return undefined;

  let limit = Infinity;
  if (count !== undefined) {
    // `asSmallInteger`, matching the literal-target arm: `count.re` silently
    // took the REAL PART of a complex value and accepted arbitrarily large
    // magnitudes, so one operator's two arms disagreed about what a valid
    // count is, for no stated reason.
    const n = asSmallInteger(count);
    if (n === null || n < 1)
      return ce.error(
        'unexpected-argument',
        'StringReplace: count must be a positive integer'
      );
    limit = n;
  }

  const literal = isString(replacement) ? replacement.string : undefined;
  const fn = literal === undefined ? replacement.canonical : undefined;
  if (literal === undefined && !fn?.type.matches('function')) return undefined;

  re.lastIndex = 0;
  // ONE cluster map for the whole walk, used only by the callback form.
  const map = clusterMapOf(subject);
  const out: string[] = [];
  let from = 0;
  let done = 0;
  for (;;) {
    if (done >= limit) break;
    const m = re.exec(subject);
    if (m === null) break;
    out.push(subject.slice(from, m.index));
    if (literal !== undefined) out.push(literal);
    else {
      // The callback sees exactly what `StringMatch` would have returned for
      // this match, so the two surfaces agree on what "a match" is.
      const applied = ce
        .function('Apply', [fn!, matchRecord(ce, subject, m, map)])
        .evaluate();
      if (!isString(applied)) return undefined; // not a string: stay symbolic
      out.push(applied.string);
    }
    from = m.index + m[0].length;
    done += 1;
    if (m[0].length === 0) {
      const step = codePointWidthAt(subject, re.lastIndex);
      out.push(subject.slice(from, from + step));
      from += step;
      re.lastIndex += step;
      if (re.lastIndex > subject.length) break;
    }
  }
  out.push(subject.slice(from));
  return ce.string(out.join(''));
}

export const REGEXP_LIBRARY: SymbolDefinitions = {
  RegExp: {
    description: [
      'A compiled regular expression, using the host JavaScript dialect.',
      'The pattern is written most readably as a raw string literal: `RegExp(#"[0-9]+"#)`.',
    ],
    complexity: 8200,
    // A pure container: it STORES its pattern text. The VALUE of a `regexp`
    // is this expression, which is why it has no `evaluate` handler — it is
    // already the value, and stays inert like a `Tuple` of its operands.
    invokes: false,
    signature: '(pattern: string, flags: string?) -> regexp',
    // Validate a LITERAL pattern at canonicalization so a typo surfaces where
    // it was written; a computed pattern can only be checked when it has a
    // value, and is validated by the operators that consume it. The literal
    // test is the operand's SHAPE, which is the same rule the compile targets
    // use to decide compile-time versus run-time domain errors.
    canonical: (ops, { engine: ce }) => {
      const [pattern, flags] = ops;
      if (pattern === undefined) return ce._fn('RegExp', ops);
      if (!isString(pattern)) return ce._fn('RegExp', ops);
      // A flags operand that CANNOT be a string is an error — leaving it inert
      // while still typing the node `regexp` let it reach the matchers, which
      // read it as "no flags" and answered. A merely COMPUTED one (a symbol, a
      // `Join(...)`) is NOT an error: its text is not known yet, so it stays
      // inert here and `patternOf` resolves it at evaluation, exactly as a
      // computed PATTERN is handled.
      if (flags !== undefined && !isString(flags)) {
        if (!flags.type.matches('string'))
          return ce.error(
            ['invalid-value', 'the flags must be a string'],
            flags.toString()
          );
        return ce._fn('RegExp', ops);
      }
      const flagText = flags !== undefined ? flags.string : '';
      // Validate the flag SET, not only each letter: the host also rejects a
      // REPEATED flag and the `u`/`v` combination, and letting those reach it
      // meant the failure surfaced from `new RegExp` as "not a valid regular
      // expression" — blaming a perfectly good PATTERN for a bad flag.
      const seen = new Set<string>();
      for (const f of flagText) {
        if (seen.has(f))
          return ce.error(
            ['invalid-value', `the flag '${f}' is repeated`],
            flags!.toString()
          );
        seen.add(f);
      }
      if (seen.has('u') && seen.has('v'))
        return ce.error(
          [
            'invalid-value',
            "'u' and 'v' are alternative Unicode modes and cannot be combined",
          ],
          flags!.toString()
        );
      for (const f of flagText) {
        if (!ACCEPTED_FLAGS.includes(f)) {
          // `g`/`y` are named explicitly: they are real host flags, so
          // "unknown flag" would be a misleading diagnostic.
          const why =
            f === 'g' || f === 'y'
              ? `the '${f}' flag carries mutable match state and is not allowed on a value; use StringMatchAll`
              : `unknown regular-expression flag '${f}'`;
          return ce.error(['invalid-value', why], flags!.toString());
        }
      }
      if (hostRegExp(pattern.string, flagText) === undefined)
        return ce.error(
          ['invalid-value', 'not a valid regular expression'],
          pattern.toString()
        );
      return ce._fn('RegExp', ops);
    },
    type: () => 'regexp',
  },

  IsMatch: {
    description: 'Whether a string contains a match for a regular expression.',
    complexity: 8200,
    signature: '(subject: string, pattern: regexp) -> boolean',
    evaluate: ([subject, pattern], { engine: ce }) => {
      if (!isString(subject)) return undefined;
      const p = patternOf(pattern);
      if (p === undefined) return undefined;
      const re = hostRegExp(p.pattern, p.flags);
      if (re === undefined) return undefined;
      // A fresh `lastIndex` every call: `re` is shared through the cache and
      // must not carry state between calls (which is also why `g`/`y` are
      // rejected at construction).
      re.lastIndex = 0;
      return re.test(subject.string) ? ce.True : ce.False;
    },
  },

  StringMatch: {
    description: [
      'The first match of a regular expression in a string, as a record.',
      'The record holds `match`, `range`, `groups` and `names`; the result is `Nothing` when there is no match.',
    ],
    complexity: 8200,
    signature: '(subject: string, pattern: regexp) -> record | nothing',
    evaluate: ([subject, pattern], { engine: ce }) => {
      if (!isString(subject)) return undefined;
      const p = patternOf(pattern);
      if (p === undefined) return undefined;
      const re = hostRegExp(p.pattern, p.flags);
      if (re === undefined) return undefined;
      re.lastIndex = 0;
      const m = re.exec(subject.string);
      if (m === null) return ce.Nothing;
      return matchRecord(ce, subject.string, m);
    },
  },

  StringMatchAll: {
    description: [
      'Every non-overlapping match of a regular expression in a string, as a list of records.',
      'Each record has the same shape as `StringMatch`.',
    ],
    complexity: 8200,
    signature: '(subject: string, pattern: regexp) -> list<record>',
    evaluate: ([subject, pattern], { engine: ce }) => {
      if (!isString(subject)) return undefined;
      const p = patternOf(pattern);
      if (p === undefined) return undefined;
      // `g` is added to a PRIVATE compiled copy: the user's `regexp` value
      // must stay stateless (see `ACCEPTED_FLAGS`).
      const re = iteratingRegExp(p.pattern, p.flags);
      if (re === undefined) return undefined;
      re.lastIndex = 0;
      const text = subject.string;
      const out: Expression[] = [];
      const limit = ce.maxCollectionSize;
      // ONE cluster map for the whole walk — see `clusterMapOf`.
      const map = clusterMapOf(text);
      for (;;) {
        const m = re.exec(text);
        if (m === null) break;
        out.push(matchRecord(ce, text, m, map));
        if (out.length > limit) return undefined;
        // An empty match does not advance `lastIndex` on its own, so the loop
        // would spin on a pattern that can match nothing (`a*`). Step past it
        // by one code POINT, not one code unit, so a surrogate pair is not
        // split.
        if (m[0].length === 0)
          re.lastIndex += codePointWidthAt(text, re.lastIndex);
      }
      return ce.function('List', out);
    },
  },
};
