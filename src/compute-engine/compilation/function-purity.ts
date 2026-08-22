/**
 * Purity of a caller-supplied `functions` entry.
 *
 * A compiled `Sum`/`Product` exits as soon as its accumulator becomes NaN,
 * since NaN absorbs both `+` and `*` and no remaining term can change the
 * answer. That exit is suppressed for a body that splices caller-supplied
 * source, because such code is free to count its own calls, log, or mutate
 * shared state — running it fewer times would be a change of behavior rather
 * than an optimization. The value is already decided at that point, so the
 * only thing the suppression preserves is the supplied function's SIDE
 * EFFECTS.
 *
 * A caller who knows their helper has none can say so, and get the exit back:
 *
 * ```typescript
 * compile(expr, { functions: { s: { source: '((t) => t * t)', pure: true } } })
 * ```
 *
 * An entry that does not declare `pure` is analysed instead
 * ({@link inferSourcePurity}). The analysis is deliberately narrow — it
 * recognizes an arithmetic one-liner over the parameters and an allowlist of
 * `Math` members, calls NOTHING else, and answers `false` for everything else,
 * including source it simply does not understand. It can therefore miss a pure
 * helper, which costs only the early exit. It is not a JavaScript semantics
 * checker and does not claim to be: it accepts a small, explicitly enumerated
 * grammar and rejects the rest, which is what keeps the rejections safe.
 *
 * A declared `pure` is an assertion by the caller and is taken at face value:
 * it is not re-derived from the source, so `pure: true` on a drawing helper
 * will drop calls to it. Declaring `pure: false` pins the conservative
 * behavior and skips the analysis entirely.
 */

import type { CompiledFunctionEntry, TargetSource } from './types.js';

/** The implementation carried by `entry`, whichever spelling was used. */
export function entrySource(
  entry: CompiledFunctionEntry
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
): TargetSource | Function {
  if (typeof entry === 'string' || typeof entry === 'function') return entry;
  return entry.source;
}

/**
 * Whether `entry` may be skipped at run time: its declared purity when it has
 * one, otherwise whatever {@link inferSourcePurity} can establish from the
 * source text.
 */
export function entryIsPure(entry: CompiledFunctionEntry): boolean {
  if (typeof entry === 'object' && entry !== null && 'source' in entry) {
    if (entry.pure !== undefined) return entry.pure;
    return inferSourcePurity(sourceText(entry.source));
  }
  return inferSourcePurity(sourceText(entry));
}

/** The source text of an implementation. A `Function` is read via `toString`,
 * which yields `[native code]` for a native or bound function — text the
 * analysis below rejects, as it must. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function sourceText(source: TargetSource | Function): string {
  return typeof source === 'function' ? source.toString() : source;
}

/**
 * Whether `src` is an arithmetic one-liner that can have no side effect.
 *
 * Recognized shapes, after comments are stripped and surrounding parentheses
 * removed:
 *
 * - `(a, b) => EXPR` and `a => EXPR`
 * - `(a, b) => { return EXPR; }`
 * - `function name?(a, b) { return EXPR; }`
 *
 * where EXPR contains only: the parameter names, numeric literals, the
 * constants `Infinity` / `NaN` / `true` / `false`, `Math.<member>` reads and
 * calls, and the operators `+ - * / % ** ( ) , ? : < > <= >= == === != !== &&
 * || !`. Everything else answers `false` — a string or template literal, an
 * array or object literal, any assignment or increment, `new`, `this`,
 * `await`, `yield`, a nested arrow, a property read on anything but `Math`,
 * and any free identifier, which is what rules out a closure over mutable
 * state (`(t) => t * scale` mentions `scale`, which is not a parameter).
 *
 * The rejections are all conservative: a `false` costs the early exit and
 * nothing else.
 */
export function inferSourcePurity(src: string): boolean {
  const text = stripComments(src).trim();
  const shape = matchFunctionShape(text);
  if (shape === undefined) return false;
  return isPureArithmetic(shape.body, shape.params);
}

/** Remove `//` and block comments so they cannot smuggle a banned token past
 * the scan, nor cause a pure body to be rejected for words inside a comment. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** The parameter names and single-expression body of a recognized function
 * shape, or `undefined` when `text` is not one. */
function matchFunctionShape(
  text: string
): { params: Set<string>; body: string } | undefined {
  // A caller commonly parenthesizes an arrow so it can be spliced into an
  // expression position (`'((t) => t * t)'`). Peel balanced outer parentheses
  // before matching, since the shapes below are written without them.
  let s = text;
  while (s.startsWith('(') && matchingParen(s, 0) === s.length - 1)
    s = s.slice(1, -1).trim();

  // `function name?(params) { return EXPR; }`
  const fn = /^function\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/.exec(
    s
  );
  const anonFn = /^function\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/.exec(s);
  const named = fn ?? anonFn;
  if (named) {
    const body = onlyReturn(named[2]);
    if (body === undefined) return undefined;
    const params = paramNames(named[1]);
    if (params === undefined) return undefined;
    return { params, body };
  }

  // Arrow forms. The parameter list is either parenthesized or a single bare
  // identifier; a destructuring or defaulted parameter list is not recognized,
  // so it falls through to `undefined`.
  const arrow = /^\(([^)]*)\)\s*=>\s*([\s\S]+)$/.exec(s);
  const bare = /^([A-Za-z_$][\w$]*)\s*=>\s*([\s\S]+)$/.exec(s);
  const a = arrow ?? bare;
  if (!a) return undefined;
  const params = paramNames(a[1]);
  if (params === undefined) return undefined;
  let body = a[2].trim();
  if (body.startsWith('{')) {
    if (!body.endsWith('}')) return undefined;
    const inner = onlyReturn(body.slice(1, -1));
    if (inner === undefined) return undefined;
    body = inner;
  }
  return { params, body };
}

/** The expression of a block body that is exactly `return EXPR;`, or
 * `undefined` for a block that does anything else — including one with
 * several statements, which is where an effect would hide. */
function onlyReturn(block: string): string | undefined {
  const m = /^\s*return\s+([\s\S]+?);?\s*$/.exec(block);
  if (!m) return undefined;
  // A `;` inside what looked like one expression means several statements.
  if (m[1].includes(';')) return undefined;
  return m[1].trim();
}

/** The names in a parameter list, or `undefined` if any parameter is not a
 * plain identifier (a default value, a rest element, or destructuring — each
 * of which can run arbitrary code at call time). */
function paramNames(list: string): Set<string> | undefined {
  const trimmed = list.trim();
  if (trimmed === '') return new Set();
  const names = new Set<string>();
  for (const part of trimmed.split(',')) {
    const p = part.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(p)) return undefined;
    names.add(p);
  }
  return names;
}

/**
 * The members of `Math` that are pure functions of their arguments, or
 * constants. `random` is deliberately absent: it is standard, but two calls
 * disagree, so skipping one is observable.
 */
const PURE_MATH_MEMBERS = new Set([
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'cbrt',
  'ceil',
  'clz32',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'floor',
  'fround',
  'hypot',
  'imul',
  'log',
  'log10',
  'log1p',
  'log2',
  'max',
  'min',
  'pow',
  'round',
  'sign',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
  'trunc',
  'E',
  'LN10',
  'LN2',
  'LOG10E',
  'LOG2E',
  'PI',
  'SQRT1_2',
  'SQRT2',
]);

/** Identifiers that denote a value rather than a binding, and are therefore
 * allowed to appear free in a pure body. */
const FREE_LITERAL_NAMES = new Set([
  'Infinity',
  'NaN',
  'true',
  'false',
  'null',
  'undefined',
]);

/** Characters that may appear in a pure arithmetic body outside identifiers
 * and numbers. `=` is admitted only as part of a comparison, which the
 * assignment scan below checks separately. */
const ALLOWED_PUNCTUATION = /^[\s+\-*/%()<>!=&|?:.,]*$/;

function isPureArithmetic(body: string, params: Set<string>): boolean {
  if (body === '') return false;

  // Anything that can carry an effect, produce a binding, or hide a call
  // behind a getter. `[` covers both array literals and computed member
  // access; `{` covers object literals and any block that reached here.
  if (/[[\]{}`'";]/.test(body)) return false;
  if (
    /\b(new|this|await|yield|delete|void|typeof|in|instanceof|function|var|let|const)\b/.test(
      body
    )
  )
    return false;
  if (/\+\+|--/.test(body)) return false;
  if (/=>/.test(body)) return false;
  // An assignment: `=` not part of `==`, `===`, `!=`, `!==`, `<=` or `>=`.
  if (/(^|[^=!<>])=(?!=)/.test(body)) return false;

  // `Math.member` is the one property read allowed, and only for the members
  // named in PURE_MATH_MEMBERS. An allowlist rather than a pattern because
  // `Math` is an ordinary mutable object: `Math.audit = () => log(...)` is
  // legal, so `\bMath\.\w+\b` would bless a call to whatever a page has
  // attached. `Math.random` is excluded for a different reason — it is a
  // standard member, but it is not a function of its arguments, so two calls
  // disagree and dropping one changes what the program observes even though
  // nothing is written.
  if (
    /\bMath\s*\.\s*([A-Za-z_$][\w$]*)/.test(body) &&
    [...body.matchAll(/\bMath\s*\.\s*([A-Za-z_$][\w$]*)/g)].some(
      (m) => !PURE_MATH_MEMBERS.has(m[1])
    )
  )
    return false;

  // Blank the accepted pairs out so the member name is not mistaken for a free
  // identifier, then require that no `.` survives except a decimal point — a
  // property read on anything else could be a getter.
  const blanked = body.replace(/\bMath\s*\.\s*[A-Za-z_$][\w$]*/g, ' 0 ');

  // Numeric literals go before the identifier scan, not after: the exponent of
  // `1.5e3` is letters, and left in place it reads as a free identifier `e3`.
  const noNumbers = blanked.replace(/\b\d+(\.\d+)?([eE][+-]?\d+)?\b/g, ' ');
  if (noNumbers.includes('.')) return false;

  // No identifier may be CALLED. Only the `Math` members blanked above reach
  // this point as callees, so anything still followed by `(` is a call through
  // a name this analysis cannot see the body of — most importantly a parameter
  // (`(f) => f(x)`), whose value at run time is whatever the caller passed and
  // may draw, log, or count. `Math` is checked before blanking, so this scan
  // cannot be defeated by spelling a call as `Math.sin(x)`.
  if (/[A-Za-z_$][\w$]*\s*\(/.test(noNumbers)) return false;

  // Every remaining identifier must be a parameter or a literal name.
  for (const [ident] of noNumbers.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (params.has(ident)) continue;
    if (FREE_LITERAL_NAMES.has(ident)) continue;
    return false;
  }

  // Whatever is left once identifiers are removed must be arithmetic
  // punctuation; this catches anything the scans above missed.
  return ALLOWED_PUNCTUATION.test(noNumbers.replace(/[A-Za-z_$][\w$]*/g, ' '));
}

/** The index of the `)` matching the `(` at `from`, or `-1` if unbalanced. */
function matchingParen(s: string, from: number): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
