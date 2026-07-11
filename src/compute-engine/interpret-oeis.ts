/**
 * OEIS-backed interpretation proposals (the async v4 of the `Interpret`
 * ladder).
 *
 * `ce.interpret(expr)` mirrors the sync `Interpret` head — it runs the same
 * offline recognizer (`inferContinuationPattern`) — and *additionally* performs
 * a live OEIS lookup on the extracted numeric samples, parsing and verifying
 * the free-text formula fields of the hits into attributed closed-form
 * candidates.
 *
 * This is the ONLY interpretation path that touches the network. The sync
 * `Interpret` head and `evaluate()` never perform a lookup and remain
 * deterministic and offline.
 *
 * OEIS data is CC BY-NC: it is never bundled into the library. Candidates are
 * produced only by live lookup and always carry attribution (`id`/`name`/`url`).
 *
 * @see docs/plans/2026-07-09-ellipsis-interpretation-design.md (v4)
 * @see https://oeis.org
 */

import type {
  IComputeEngine as ComputeEngine,
  Expression,
  OEISCandidate,
  InterpretResult,
} from './global-types.js';
import {
  inferContinuationPattern,
  extractContinuationSamples,
} from './symbolic/interpret.js';
import { lookupOEISByTerms } from './oeis.js';
import type { OEISSequenceInfo, OEISOptions } from './oeis.js';

/** OEIS needs a handful of terms to return a meaningful match. */
const MIN_SAMPLES = 4;

/**
 * Candidate index offsets to try when aligning a parsed formula `a(n)` against
 * the extracted samples. The OEIS `offset` field is not currently carried
 * through `OEISSequenceInfo`, so alignment is by exact-match search over this
 * small window (offsets are almost always 0 or 1).
 */
const OFFSET_WINDOW = [0, 1, -1, 2, -2, 3, 4];

/**
 * Interpret `expr`: run the offline recognizer, then propose OEIS-attributed
 * closed forms verified against the extracted samples.
 *
 * The returned `expression` is exactly what the sync `Interpret` head produces
 * (the recognized `Sum`/`Product`, or the input unchanged). Network failures,
 * being offline, too-few samples, or an empty OEIS result all degrade
 * gracefully to an empty `candidates` list — this never rejects for those
 * reasons.
 *
 * @param ce - ComputeEngine instance
 * @param expr - The (typically inert, continuation-bearing) expression
 * @param options - OEIS request options (timeout, maxResults)
 *
 * @example
 * ```typescript
 * // 1 + 3 + 6 + 10 + … + n
 * const expr = ce.parse('1 + 3 + 6 + 10 + \\cdots + n');
 * const { expression, candidates } = await ce.interpret(expr);
 * // expression → Sum(...)   (offline recognizer)
 * // candidates → [{ id: 'A000217', expression: <n(n+1)/2>, url: '…/A000217', … }]
 * ```
 */
export async function interpret(
  ce: ComputeEngine,
  expr: Expression,
  options?: OEISOptions
): Promise<InterpretResult> {
  // 1. Offline recognizer — identical to the `Interpret` head's evaluate path.
  const recognized = inferContinuationPattern(expr) ?? expr;

  // 2. Extract the exact numeric sample run from the continuation.
  const sampleExprs = extractContinuationSamples(expr);
  const terms = integerSamples(sampleExprs);
  if (!sampleExprs || !terms || terms.length < MIN_SAMPLES)
    return { expression: recognized, candidates: [] };

  // 3. OEIS lookup. Any failure (offline, timeout, HTTP error) degrades to no
  //    candidates rather than rejecting the whole interpretation.
  let hits: OEISSequenceInfo[];
  try {
    hits = await lookupOEISByTerms(terms, options);
  } catch {
    return { expression: recognized, candidates: [] };
  }

  // 4. Parse + verify each hit's formula lines into attributed candidates.
  const candidates: OEISCandidate[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const candidate = candidateFromHit(ce, hit, sampleExprs);
    if (candidate && !seen.has(candidate.id)) {
      seen.add(candidate.id);
      candidates.push(candidate);
    }
  }

  return { expression: recognized, candidates };
}

/**
 * Convert the extracted sample expressions to plain integers for the OEIS
 * query. Returns `null` if any sample is not an exact integer (OEIS indexes
 * integer sequences only).
 */
function integerSamples(exprs: Expression[] | null): number[] | null {
  if (!exprs) return null;
  const out: number[] = [];
  for (const e of exprs) {
    if (e.isInteger !== true) return null;
    const v = e.re;
    if (!Number.isInteger(v)) return null;
    out.push(v);
  }
  return out;
}

/**
 * Produce the first verified candidate from an OEIS hit, or `null`. Every
 * formula line is scanned for `a(n) = <rhs>` clauses; each parseable RHS is
 * verified against ALL samples before being accepted.
 */
function candidateFromHit(
  ce: ComputeEngine,
  hit: OEISSequenceInfo,
  samples: Expression[]
): OEISCandidate | null {
  if (!hit.id) return null;

  for (const line of formulaLines(hit)) {
    for (const rhs of closedFormCandidates(line)) {
      const parsed = parseClosedForm(ce, rhs);
      if (!parsed) continue;
      if (!verifyCandidate(parsed, samples)) continue;
      return {
        expression: parsed,
        id: hit.id,
        name: hit.name,
        url: hit.url,
        formula: line.trim(),
      };
    }
  }
  return null;
}

/** All formula lines of a hit, split on embedded newlines. */
function formulaLines(hit: OEISSequenceInfo): string[] {
  const raw = hit.formulas ?? (hit.formula ? [hit.formula] : []);
  const lines: string[] = [];
  for (const f of raw) for (const l of f.split('\n')) lines.push(l);
  return lines;
}

/**
 * Extract closed-form RHS candidates from a single formula line. Only lines of
 * the form `a(n) = …` are considered. Trailing attribution (`- _Name_, date`),
 * qualifiers (`for n >= 0`, `with …`), and a trailing period are stripped;
 * equality chains (`a(n) = binomial(n+1,2) = n*(n+1)/2`) yield one candidate
 * per segment. Self-referential (recurrence) segments — those mentioning
 * `a(…)` — are dropped, since `a` cannot be evaluated here.
 */
function closedFormCandidates(line: string): string[] {
  const m = /a\(\s*n\s*\)\s*=\s*(.+)$/i.exec(line);
  if (!m) return [];

  let rhs = m[1];

  // Strip attribution: "... - _Name_, date".
  const attr = rhs.search(/\s[-–—]\s_/);
  if (attr >= 0) rhs = rhs.slice(0, attr);

  // Strip a trailing qualifier clause ("for n >= 0", "with a(0)=1", …) BEFORE
  // splitting on '=' (qualifiers can themselves contain '>=' etc.).
  const qual = rhs.search(/\s+(for|with|where|when|if)\s+/i);
  if (qual >= 0) rhs = rhs.slice(0, qual);

  const out: string[] = [];
  for (let part of rhs.split('=')) {
    part = part.replace(/\.\s*$/, '').trim();
    if (!part) continue;
    if (/\ba\s*\(/i.test(part)) continue; // self-reference
    out.push(part);
  }
  return out;
}

/**
 * Parse an ASCII-ish OEIS RHS into a `BoxedExpression` in the single index
 * variable `n`, or `null` when it can't be parsed cleanly.
 *
 * `ce.parse` reads LaTeX, so a small set of multi-letter function spellings is
 * mapped to LaTeX macros first ({@link asciiToLatex}). Anything left containing
 * a free variable other than `n` (an unmapped function name explodes into a
 * product of single-letter symbols) is rejected — the verification step is the
 * final net, but this cheap check drops most junk early.
 */
function parseClosedForm(ce: ComputeEngine, rhs: string): Expression | null {
  let parsed: Expression;
  try {
    parsed = ce.parse(asciiToLatex(rhs));
  } catch {
    return null;
  }
  if (!parsed || parsed.operator === 'Error') return null;
  if (parsed.freeVariables.some((v) => v !== 'n')) return null;
  return parsed;
}

/**
 * Cheaply rewrite the common OEIS ASCII function spellings into LaTeX macros
 * that `ce.parse` understands. Only single-level (non-nested) arguments are
 * mapped — the honest, cheap subset; anything more elaborate is left as-is and
 * dropped downstream rather than guessed.
 */
function asciiToLatex(s: string): string {
  let out = s;
  // binomial(a, b) / C(a, b) → \binom{a}{b}
  out = out.replace(
    /\bbinomial\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)/gi,
    '\\binom{$1}{$2}'
  );
  out = out.replace(
    /\bC\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)/g,
    '\\binom{$1}{$2}'
  );
  // sqrt(x) → \sqrt{x}
  out = out.replace(/\bsqrt\(\s*([^()]*?)\s*\)/gi, '\\sqrt{$1}');
  // floor(x) → \lfloor x \rfloor ; ceiling(x) → \lceil x \rceil
  out = out.replace(/\bfloor\(\s*([^()]*?)\s*\)/gi, '\\lfloor $1 \\rfloor');
  out = out.replace(/\bceiling\(\s*([^()]*?)\s*\)/gi, '\\lceil $1 \\rceil');
  return out;
}

/**
 * A candidate is accepted only if, for some index offset in
 * {@link OFFSET_WINDOW}, it reproduces EVERY sample exactly (integer equality,
 * no float tolerance).
 */
function verifyCandidate(f: Expression, samples: Expression[]): boolean {
  for (const offset of OFFSET_WINDOW)
    if (matchesAtOffset(f, samples, offset)) return true;
  return false;
}

/** `f(offset + i) === samples[i]` exactly for every `i`. */
function matchesAtOffset(
  f: Expression,
  samples: Expression[],
  offset: number
): boolean {
  for (let i = 0; i < samples.length; i++) {
    const v = f.subs({ n: offset + i }).evaluate();
    if (!v.isSame(samples[i])) return false;
  }
  return true;
}
