/**
 * LaTeX dictionary entries for parsing and serializing physical quantities
 * with units.
 *
 * Parsing:  `12\,\mathrm{cm}`  →  `['Quantity', 12, 'cm']`
 * Serializing:  `['Quantity', 12, 'cm']`  →  `12\,\mathrm{cm}`
 *
 * Registers `\mathrm` and `\text` as **expression** entries.  When the braced
 * content is a recognised unit the handler returns the unit expression;
 * otherwise it returns `null` so the parser backtracks and the normal
 * symbol-parsing takes over.
 *
 * The number-times-unit → Quantity conversion is handled during
 * canonicalization of `InvisibleOperator` (juxtaposition) in
 * `invisible-operator.ts`.
 *
 * CRITICAL: The expression entry trigger `\mathrm` (1 token) coexists with
 * existing longer triggers like `\mathrm{e}` (4 tokens, ExponentialE).  The
 * parser tries longer triggers first, so `\mathrm{e}` will always match before
 * our 1-token `\mathrm` entry.
 */

import type { MathJsonExpression } from '../../../math-json/types.js';
import {
  operand,
  operator,
  symbol,
  machineValue,
  rationalValue,
  matchesSymbol,
  isNumberExpression,
  isNumberObject,
} from '../../../math-json/utils.js';
import type {
  LatexDictionary,
  Parser,
  Serializer,
  ExpressionParseHandler,
} from '../types.js';
import { joinLatex } from '../tokenizer.js';
import {
  getUnitDimension,
  parseUnitDSL,
  type UnitExpression,
} from '../../numerics/unit-data.js';
import { normalizeAngle, formatDMS } from '../serialize-dms.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the content of a `{...}` group as raw text, reconstructing the
 * string character by character from individual tokens.
 *
 * Handles nested braces for LaTeX exponents like `s^{2}` → `s^2` and
 * `s^{-1}` → `s^-1`.
 *
 * **Limitation**: Nested braces are silently consumed (not emitted into
 * the output string).  This means `\mathrm{m^{2}s}` produces `m^2s` —
 * which the DSL parser reads as a single token and will fail to resolve.
 * Use `\mathrm{m^{2}\cdot s}` (with explicit `\cdot`) for multi-unit
 * expressions that include braced exponents.
 *
 * When `siunitx` is true (the unit argument of a siunitx command), a `~`
 * is emitted as `.`: in siunitx, both are a product of two units. Elsewhere
 * a `~` is a space, as in LaTeX.
 *
 * Returns `null` if no opening brace is found.
 */
function readBracedText(parser: Parser, siunitx = false): string | null {
  // Skip spaces between the trigger and the opening brace, e.g. the space
  // in `\text { gallons/ft}`.
  while (parser.peek === '<space>') parser.nextToken();

  if (!parser.match('<{>')) return null;

  let text = '';
  let depth = 0; // track nested braces (e.g. for ^{2})

  while (!parser.atEnd) {
    const token = parser.peek;

    // Closing brace at depth 0 → done
    if (token === '<}>' && depth === 0) {
      parser.nextToken(); // consume the closing brace
      return text;
    }

    // Nested closing brace
    if (token === '<}>') {
      depth--;
      parser.nextToken();
      continue;
    }

    // Opening brace inside the group
    if (token === '<{>') {
      depth++;
      parser.nextToken();
      continue;
    }

    // Emit a single space for space tokens, collapsing consecutive spaces.
    // Multi-word unit phrases like `miles per hour` depend on the word
    // boundaries surviving to the alias pass; `resolveUnitText` trims and
    // strips the spaces before the unit lookup.
    if (token === '<space>') {
      if (siunitx && parser._isTilde(parser.index)) text += '.';
      else if (text.length > 0 && !text.endsWith(' ')) text += ' ';
      parser.nextToken();
      continue;
    }

    // A literal `$` tokenizes as `<$>`; emit it as `$` so the currency alias
    // (`$` → USD) can match in `\text{$}`.
    if (token === '<$>') {
      text += '$';
      parser.nextToken();
      continue;
    }

    // `\cdot` is used for unit multiplication in LaTeX: `m\cdot s^{-1}`
    if (token === '\\cdot') {
      text += '*';
      parser.nextToken();
      continue;
    }

    // `^` followed by `{...}` is common LaTeX notation for exponents.
    // We want to collect `^{2}` as `^2`. A fraction exponent keeps its
    // group as parentheses, `^{1/2}` as `^(1/2)`: without them the unit DSL
    // reads `m^1/2` as `m^1` divided by `2`.
    if (token === '^') {
      text += '^';
      parser.nextToken();
      if (parser.peek === '<{>') {
        const exp = readExponentGroup(parser);
        if (exp === null) return null;
        text += exp.includes('/') ? `(${exp})` : exp;
      }
      continue;
    }

    text += token;
    parser.nextToken();
  }

  // If we ran out of tokens without closing the group, return null
  return null;
}

/**
 * Read the `{...}` group of an exponent, the next token, as raw text, with the
 * spaces and the nested braces removed: `{1/2}` is `1/2` and `{-1}` is `-1`.
 * Returns `null` when the group is not closed.
 */
function readExponentGroup(parser: Parser): string | null {
  if (!parser.match('<{>')) return null;
  let exp = '';
  let depth = 0;
  while (!parser.atEnd) {
    const token = parser.peek;
    parser.nextToken();
    if (token === '<}>') {
      if (depth === 0) return exp;
      depth--;
    } else if (token === '<{>') depth++;
    else if (token !== '<space>') exp += token;
  }
  return null;
}

/**
 * Symbols that should NOT be treated as unit names even though they
 * appear in the unit registry, because they have primary meanings in
 * mathematics that would be broken by unit parsing.
 *
 * - `d` — differential operator (`\mathrm{d}x`)
 *
 * Other single-character units like `h` (hour), `t` (tonne), `s`
 * (second) are intentionally NOT blocked: the `__unit__` wrapper
 * mechanism in `invisible-operator.ts` prevents bare variable symbols
 * from being mis-identified as units.  Only symbols inside an explicit
 * `\mathrm{...}` or `\text{...}` reach this code path, where the
 * user's intent is unambiguous.
 */
const UNIT_BLOCKLIST = new Set(['d']);

/**
 * English unit words → canonical unit symbols, applied at the parse
 * boundary (NOT added to the core lexicon in `unit-data.ts`).  The unit
 * system stays canonical; the parser normalizes words before lookup.
 *
 * Every target below is asserted to exist in `unit-data.ts` (via
 * `getUnitDimension`).  Singular and plural forms are listed explicitly
 * (words are case-sensitive lowercase, matching corpus usage).
 *
 * Values may themselves be compound DSL strings (e.g. `mph` → `mi/h`);
 * `normalizeUnitText` re-parses the result through the DSL path.
 */
const UNIT_ALIASES: Record<string, string> = {
  // Prototype-free: `UNIT_ALIASES[w] ?? w` would otherwise hand back
  // `Object.prototype` for the word `__proto__` (`??` does not fire on a
  // non-nullish value) and splice its string coercion into the unit text.
  '__proto__': null as never,
  // Length
  'inch': 'in',
  'inches': 'in',
  'in.': 'in',
  'foot': 'ft',
  'feet': 'ft',
  'ft.': 'ft',
  'mile': 'mi',
  'miles': 'mi',
  'yard': 'yd',
  'yards': 'yd',
  'meter': 'm',
  'meters': 'm',
  'metre': 'm',
  'metres': 'm',
  'centimeter': 'cm',
  'centimeters': 'cm',
  'centimetre': 'cm',
  'centimetres': 'cm',
  'kilometer': 'km',
  'kilometers': 'km',
  'kilometre': 'km',
  'kilometres': 'km',
  // Volume
  'gallon': 'gal',
  'gallons': 'gal',
  'quart': 'qt',
  'quarts': 'qt',
  'pint': 'pt',
  'pints': 'pt',
  'cup': 'cup',
  'cups': 'cup',
  'liter': 'L',
  'liters': 'L',
  'litre': 'L',
  'litres': 'L',
  // Mass / weight
  'ounce': 'oz',
  'ounces': 'oz',
  'pound': 'lb',
  'pounds': 'lb',
  'gram': 'g',
  'grams': 'g',
  'kilogram': 'kg',
  'kilograms': 'kg',
  // NO `ton(s)` alias: in US usage a "ton" is the short ton (~907 kg), but
  // the only available symbol `t` is the metric tonne (1000 kg) — mapping it
  // would be a silent 10% error. Inert is better than wrong.
  // Time
  'second': 's',
  'seconds': 's',
  'minute': 'min',
  'minutes': 'min',
  'hour': 'h',
  'hours': 'h',
  'day': 'd',
  'days': 'd',
  'week': 'wk',
  'weeks': 'wk',
  // Currency (USD only; see unit-data.ts for why other currencies are omitted)
  'dollar': 'USD',
  'dollars': 'USD',
  '$': 'USD',
  'cent': 'cent',
  'cents': 'cent',
  // Angle
  'degree': 'deg',
  'degrees': 'deg',
  // Compound
  'mph': 'mi/h',
  // `per` → `/` so multi-word phrases like `miles per hour` become `mi/h`.
  // The word regex matches `per` only as a maximal run, so `person` etc.
  // are unaffected.
  'per': '/',
};

/**
 * Normalize a raw unit text by mapping English unit words to canonical
 * symbols.  Applies to whole simple words (`inches` → `in`) AND to each
 * leaf word inside a compound DSL string (`inches/foot` → `in/ft`).
 *
 * Non-unit words (`to`, `cis`, …) are left unchanged, so the caller's
 * subsequent `getUnitDimension` / DSL check still rejects them.
 */
function normalizeUnitText(text: string): string {
  // Replace each maximal run of letters/period (or a literal `$`) with its
  // alias, leaving DSL operators (`/ * ^`), spaces, and digits untouched.
  // A compound alias is put in parentheses, so that an exponent applies to
  // all of it: `mph^2` is `(mi/h)^2`, not `mi/h^2`.
  return text.replace(/\$|[A-Za-z.]+/g, (w) => {
    const alias = UNIT_ALIASES[w];
    if (alias === undefined) return w;
    return /[A-Za-z]/.test(alias) && /[/*]/.test(alias) ? `(${alias})` : alias;
  });
}

/**
 * Check whether a raw text string from `\mathrm{...}` or `\text{...}`
 * represents a known unit (simple or compound).
 *
 * Returns a MathJSON unit expression, or `null` if not recognised.
 */
export function resolveUnitText(text: string): MathJsonExpression | null {
  if (!text) return null;

  // Trim surrounding whitespace so the blocklist and unit lookups see the
  // bare base text (e.g. `\mathrm{ d }` still blocks the differential `d`).
  // The NFC form is the form of a symbol name: the ohm sign U+2126 is the
  // unit `Ω` (U+03A9), and the angstrom sign U+212B is the unit `Å` (U+00C5).
  const trimmed = text.trim().normalize('NFC');
  if (trimmed.length === 0) return null;

  // Block symbols that have primary mathematical meanings.  Checked on the
  // trimmed text so that bare `\mathrm{d}` (differential) stays blocked while
  // the word `days` still normalizes to the `d` unit below.
  if (UNIT_BLOCKLIST.has(trimmed)) return null;

  // Normalize English unit words (singular/plural, `per` → `/`) to canonical
  // symbols, then drop the internal spaces that separated the words:
  // `miles per hour` → `mi / h` → `mi/h`.
  const normalized = normalizeUnitText(trimmed).replace(/\s+/g, '');

  // Simple unit check: is the whole string a known unit?
  if (getUnitDimension(normalized) !== null) return unitSymbols(normalized);

  // Compound unit check: does the string contain `/`, `*`, or `^`?
  if (/[/*^]/.test(normalized)) {
    try {
      const parsed = parseUnitDSL(normalized);
      // Verify the parsed expression represents valid units
      if (parsed !== null && isValidUnitExpression(parsed))
        return unitSymbols(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * The MathJSON of a unit expression of the unit DSL. A unit symbol that is
 * not an ASCII name (`µm`, `Å`, `Ω`) is written `{ sym: … }`: a bare string
 * with other characters is a MathJSON string, not a symbol, so
 * `\mathrm{µm}` gave the string `'µm'` and `\mathrm{µm/s}` a type error.
 */
function unitSymbols(expr: UnitExpression): MathJsonExpression {
  if (typeof expr === 'string')
    return matchesSymbol(expr) ? expr : { sym: expr };
  if (!Array.isArray(expr)) return expr as MathJsonExpression;
  const [op, ...args] = expr;
  return [op, ...args.map((x) => unitSymbols(x))] as MathJsonExpression;
}

/**
 * Recursively check that every leaf symbol in a UnitExpression is a known unit.
 */
function isValidUnitExpression(expr: UnitExpression): boolean {
  if (typeof expr === 'string') return getUnitDimension(expr) !== null;

  if (!Array.isArray(expr)) return false;

  const op = expr[0];
  if (op === 'Multiply' || op === 'Divide') {
    return expr.slice(1).every((arg) => isValidUnitExpression(arg));
  }
  if (op === 'Power') {
    return isValidUnitExpression(expr[1]);
    // The exponent (expr[2]) is a number, no need to check it as a unit
  }

  return false;
}

// ---------------------------------------------------------------------------
// Expression parse handler
// ---------------------------------------------------------------------------

/**
 * Shared expression parse handler for `\mathrm{...}` and `\text{...}`.
 * The trigger token (`\mathrm` or `\text`) has already been consumed.
 *
 * If the braced content is a recognised unit, returns
 * `['__unit__', unitExpr]` — a tagged wrapper that signals to
 * `canonicalInvisibleOperator` that this came from a unit context.
 * This prevents bare variables like `h` or `t` (which happen to be
 * recognised units) from being treated as units.
 *
 * If the content is NOT a recognised unit, restores the parser index and
 * returns `null` so that longer triggers (like `\mathrm{e}` → ExponentialE)
 * or normal symbol parsing can take over.
 */
/**
 * Read an exponent suffix (`^{n}` or `^n`) as a raw string (e.g. `"3"`,
 * `"-1"`), or `null` if the next token is not `^`.  Restores the parser
 * index if a `^` is present but no exponent can be read.
 */
function readExponentSuffix(parser: Parser): string | null {
  const saved = parser.index;
  if (!parser.match('^')) return null;

  // Braced exponent: `^{...}`
  if (parser.match('<{>')) {
    let exp = '';
    while (!parser.atEnd && parser.peek !== '<}>') {
      exp += parser.peek;
      parser.nextToken();
    }
    if (!parser.match('<}>')) {
      parser.index = saved;
      return null;
    }
    return exp;
  }

  // Single-token exponent: `^3`
  if (parser.atEnd) {
    parser.index = saved;
    return null;
  }
  const token = parser.peek;
  parser.nextToken();
  return token;
}

const parseUnitExpression: ExpressionParseHandler = (
  parser: Parser
): MathJsonExpression | null => {
  const saved = parser.index;

  const text = readBracedText(parser);
  if (text === null) {
    parser.index = saved;
    return null;
  }

  // An exponent may sit OUTSIDE the braced text, e.g. `\text{ gallons/ft}^3`.
  // Fold it into the LAST factor of the unit expression before resolving:
  // `gallons/ft^3` (gallons per cubic foot), NOT `(gallons/ft)^3`.  The
  // unit DSL binds `^` to the trailing factor, so appending `^n` to the
  // raw text yields the intended structure.  Consume the `^` only if the
  // combined text resolves; otherwise restore to just after the brace.
  // The fold must respect the blocklist on the BASE text: `\mathrm{d}` is
  // blocked (differential), and `\mathrm{d}^{2}` must stay the Leibniz
  // numerator `d²` — without this gate the folded text `d^2` resolves as
  // "square days" and breaks Leibniz-notation round-trips.
  const afterBrace = parser.index;
  if (!UNIT_BLOCKLIST.has(text.trim())) {
    const exp = readExponentSuffix(parser);
    if (exp !== null) {
      // A fraction exponent is grouped, as in `readBracedText()`.
      const withExp = resolveUnitText(
        `${text}^${exp.includes('/') ? `(${exp})` : exp}`
      );
      if (withExp !== null) return ['__unit__', withExp];
      parser.index = afterBrace;
    }
  }

  const unit = resolveUnitText(text);
  if (unit === null) {
    parser.index = saved;
    return null;
  }

  // Wrap in __unit__ tag so that canonicalInvisibleOperator can
  // distinguish explicit unit annotations (from \mathrm/\text) from
  // bare variable symbols that happen to share a unit name.
  return ['__unit__', unit];
};

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/**
 * Convert a MathJSON unit expression into a string suitable for the
 * content of `\mathrm{...}`.
 *
 * Examples:
 * - `'m'`  →  `'m'`
 * - `['Divide', 'm', 's']`  →  `'m/s'`
 * - `['Power', 's', 2]`  →  `'s^{2}'`
 * - `['Divide', 'm', ['Power', 's', 2]]`  →  `'m/s^{2}'`
 * - `['Multiply', 'kg', 'm']`  →  `'kg\\cdot m'`
 *
 * Returns `null` when the unit is not a product of powers of unit symbols
 * with finite numeric exponents, for example `m^{n+1}`. The unit parser
 * reads only a numeric exponent inside `\mathrm{...}`: the text `m^{n}`
 * parses as the symbol `m_n`. The caller then writes the quantity as a
 * function, `\mathrm{Quantity}(1, m^{n+1})`, which parses back to the same
 * expression. A symbol that is not a known unit also returns `null`.
 */
function unitToMathrm(expr: MathJsonExpression): string | null {
  return unitFactorsToMathrm(expr);
}

/**
 * The exponent of a unit factor: an exact fraction `[n, d]` with `d > 0`, or
 * a machine number for a float exponent.
 */
type UnitFactorExponent = [number, number] | number;

function readUnitFactorExponent(
  expr: MathJsonExpression | null
): UnitFactorExponent | null {
  const r = rationalValue(expr);
  if (r !== null && r[1] !== 0) return r[1] < 0 ? [-r[0], -r[1]] : r;
  const v = machineValue(expr);
  if (v === null || !Number.isFinite(v)) return null;
  return Number.isInteger(v) ? [v, 1] : v;
}

/**
 * The product of two exponents, or `null` when it is not a finite number.
 * A fraction whose numerator or denominator is not a safe integer is
 * written as a float: `gcd()` of an `Infinity` (the product of the
 * exponents of `Power(Power(m, 1e200), 1e200)`) never ended, because
 * `Infinity % 1` is `NaN`.
 */
function multiplyUnitFactorExponents(
  a: UnitFactorExponent,
  b: UnitFactorExponent
): UnitFactorExponent | null {
  if (typeof a === 'number' || typeof b === 'number') {
    const x = typeof a === 'number' ? a : a[0] / a[1];
    const y = typeof b === 'number' ? b : b[0] / b[1];
    return Number.isFinite(x * y) ? x * y : null;
  }
  const n = a[0] * b[0];
  const d = a[1] * b[1];
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    const v = n / d;
    return Number.isFinite(v) ? v : null;
  }
  const g = gcd(Math.abs(n), d);
  return [n / g, d / g];
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a === 0 ? 1 : a;
}

function isNegativeUnitFactorExponent(e: UnitFactorExponent): boolean {
  return typeof e === 'number' ? e < 0 : e[0] < 0;
}

function unitFactorExponentToString(e: UnitFactorExponent): string {
  if (typeof e === 'number') return String(e);
  return e[1] === 1 ? String(e[0]) : `${e[0]}/${e[1]}`;
}

/**
 * The unit symbols that the parser does not read back as a unit inside
 * `\mathrm{...}`, and the word that is written in their place. The parser
 * reads `\mathrm{d}` as the differential `d` (see `UNIT_BLOCKLIST`), so the
 * unit day is written `\mathrm{day}`: the alias `day` → `d` of
 * `UNIT_ALIASES` reads it back as the unit `d`, also in a compound unit
 * (`m/day`, `day^{2}`).
 */
const SERIALIZED_UNIT_NAMES: Record<string, string> = {
  __proto__: null as never,
  d: 'day',
};

/**
 * The content of `\mathrm{...}` for a unit expression, written as a product
 * of unit symbols with exponents: the factors with a positive exponent, then
 * `/` and the factors with a negative exponent. With no positive factor the
 * numerator is `1` (`1/mol`). The unit DSL of `parseUnitDSL()` reads this
 * text back as the same unit.
 *
 * An exponent applies to every factor of its base, so `(m/s)^2` is written
 * `m^{2}/s^{2}`: the text `m/s^{2}` is `m/s²`. A fraction exponent is written
 * as a fraction: `Sqrt(m)` is `m^{1/2}`.
 *
 * Returns `null` for a unit expression that is not a product of powers of
 * known unit symbols with finite numeric exponents (for example `m^n`).
 */
function unitFactorsToMathrm(expr: MathJsonExpression): string | null {
  const factors: [string, UnitFactorExponent][] = [];

  const walk = (
    e: MathJsonExpression | null,
    exp: UnitFactorExponent | null
  ): boolean => {
    if (e === null || exp === null) return false;
    const sym = symbol(e);
    if (sym !== null) {
      // A symbol that is not a known unit (`Quantity(3, foo)`) would parse
      // back as a product with a symbol, not as a quantity.
      if (getUnitDimension(sym) === null) return false;
      factors.push([sym, exp]);
      return true;
    }
    const op = operator(e);
    if (op === 'Multiply') {
      if (!Array.isArray(e)) return false;
      for (let i = 1; i < e.length; i++) if (!walk(e[i], exp)) return false;
      return true;
    }
    if (op === 'Divide') {
      const num = operand(e, 1);
      const den = operand(e, 2);
      // The `1` of a reciprocal unit, `Divide(1, s)`, is not a factor.
      if (machineValue(num) !== 1 && !walk(num, exp)) return false;
      return walk(den, multiplyUnitFactorExponents(exp, [-1, 1]));
    }
    let inner: UnitFactorExponent | null = null;
    if (op === 'Power') inner = readUnitFactorExponent(operand(e, 2));
    else if (op === 'Square') inner = [2, 1];
    else if (op === 'Sqrt') inner = [1, 2];
    else if (op === 'Root') {
      const n = machineValue(operand(e, 2));
      if (n !== null && Number.isInteger(n) && n > 0) inner = [1, n];
    }
    if (inner === null) return false;
    return walk(operand(e, 1), multiplyUnitFactorExponents(exp, inner));
  };

  if (!walk(expr, [1, 1]) || factors.length === 0) return null;

  const write = ([sym, e]: [string, UnitFactorExponent]) => {
    const s = unitFactorExponentToString(e);
    const name = SERIALIZED_UNIT_NAMES[sym] ?? sym;
    return s === '1' ? name : `${name}^{${s}}`;
  };
  const num = factors.filter(([, e]) => !isNegativeUnitFactorExponent(e));
  const den = factors.filter(([, e]) => isNegativeUnitFactorExponent(e));
  const numText = num.map(write).join('\\cdot ');
  if (den.length === 0) return numText;
  const denText = den
    .map(([sym, e]) => write([sym, typeof e === 'number' ? -e : [-e[0], e[1]]]))
    .join('\\cdot ');
  return `${numText || '1'}/${denText}`;
}

/**
 * True if the MathJSON expression is a finite real number literal: `3`,
 * `-3`, `2.5`, `{ num: "1.5e30" }`. A rational, a radical, a complex number,
 * a symbol such as `Pi`, and the non-finite literals `NaN` and `oo` are not.
 */
function isFiniteRealNumberLiteral(expr: MathJsonExpression): boolean {
  if (typeof expr === 'number') return Number.isFinite(expr);
  if (!isNumberExpression(expr)) return false;
  const text = isNumberObject(expr) ? String(expr.num) : expr;
  return !/^[+-]?(nan|oo|infinity)$/i.test(text);
}

/**
 * The LaTeX of a quantity, given the content of `\mathrm{...}` for its unit.
 *
 * A magnitude that is a finite real number literal is written before the
 * unit: `3\,\mathrm{m}`. A measurement (`5.1 ± 0.2`) is written the same
 * way, in parentheses, so that the unit applies to the whole measurement:
 * `\left(5.1\pm0.2\right)\,\mathrm{cm}`. The parser reads these two forms
 * back as a quantity.
 *
 * Any other magnitude (`2\sqrt{2}`, `\frac{1}{64}`, `\pi`, `x`, `1+\pi`, a
 * complex number) is written with the siunitx command `\qty`:
 * `\qty[parse-numbers=false]{2\sqrt{2}}{m}`. Juxtaposed with a unit, a
 * numeric constant expression parses as a quantity too
 * (`2\sqrt{2}\,\mathrm{m}`, `\pi\,\mathrm{rad}`; see the canonical form of
 * `InvisibleOperator` in `boxed-expression/invisible-operator.ts`), but a
 * magnitude with a variable parses as a product (`x\,\mathrm{m}` is `x·m`).
 * The parser reads the first argument of `\qty` as a LaTeX
 * expression, so the `\qty` form parses back as the same quantity. The
 * option `parse-numbers=false` is necessary for real siunitx: without it,
 * siunitx reads the first argument as a number and stops with an
 * "invalid-number" error on a token such as `\sqrt` or `\frac`. With it,
 * siunitx typesets the argument as math. The unit argument is the same text
 * as the content of `\mathrm{...}` (`m/s^{2}`, `kg\cdot m`), which siunitx
 * typesets as a literal unit.
 */
function serializeQuantity(
  serializer: Serializer,
  magnitude: MathJsonExpression,
  unitStr: string
): string {
  if (isFiniteRealNumberLiteral(magnitude))
    return joinLatex([
      serializer.serialize(magnitude),
      '\\,',
      `\\mathrm{${unitStr}}`,
    ]);
  if (operator(magnitude) === 'Measurement')
    return joinLatex([
      `\\left(${serializer.serialize(magnitude)}\\right)`,
      '\\,',
      `\\mathrm{${unitStr}}`,
    ]);
  return `\\qty[parse-numbers=false]{${serializer.serialize(magnitude)}}{${unitStr}}`;
}

// ---------------------------------------------------------------------------
// siunitx shared parse helpers
// ---------------------------------------------------------------------------

/**
 * Skip the optional argument of a siunitx command, the key-value options in
 * `\qty[parse-numbers=false]{…}{…}`. The options change only how siunitx
 * typesets the quantity, so they are read as raw tokens and dropped. Braces
 * inside the options are balanced, so a `]` inside a braced value does not
 * end them. When there is no `[`, or the `]` is missing, the parser index is
 * not changed.
 */
function skipSiunitxOptions(parser: Parser): void {
  const saved = parser.index;
  while (parser.peek === '<space>') parser.nextToken();
  if (!parser.match('[')) {
    parser.index = saved;
    return;
  }
  let depth = 0;
  while (!parser.atEnd) {
    const token = parser.peek;
    parser.nextToken();
    if (token === ']' && depth === 0) return;
    if (token === '<{>') depth++;
    else if (token === '<}>') depth--;
  }
  parser.index = saved;
}

/**
 * Parse `\qty{value}{unit}` or `\SI{value}{unit}`, with optional siunitx
 * options before the value (`\qty[parse-numbers=false]{2\sqrt{2}}{m}`).
 * First braced group is a math expression (magnitude), second is raw
 * text (unit).  Returns `['Quantity', value, unit]` or `null`.
 */
function parseSiunitxQuantity(parser: Parser): MathJsonExpression | null {
  skipSiunitxOptions(parser);
  const value = parser.parseGroup();
  if (value === null) return null;

  const unit = readBracedUnit(parser);
  if (unit === null) return null;

  return ['Quantity', value, unit];
}

/**
 * Parse `\unit{unit}` or `\si{unit}`.
 * Single braced group of raw text.  Returns the unit expression or `null`.
 */
function parseSiunitxUnit(parser: Parser): MathJsonExpression | null {
  skipSiunitxOptions(parser);
  return readBracedUnit(parser);
}

/**
 * Replace the siunitx product separator `.` with the `*` of the unit DSL:
 * `m.s^-1` is `m*s^-1`, and `kg.m^2.s^-2` is `kg*m^2*s^-2`.
 *
 * In the unit argument of a siunitx command, a `.` between two units is a
 * product of the units. A `.` is a separator only when a unit or an
 * exponent comes before it and a unit comes after it. So the decimal point
 * of an exponent (`m^1.5`) stays, and so does a `.` at the end of the text,
 * as in the abbreviation `in.` of the alias table `UNIT_ALIASES`.
 *
 * The other siunitx product separator, `~`, is already a `.` in the text
 * (see `readBracedText()`). A space is not a separator: `m s` is `ms`, the
 * millisecond, as LaTeX prints it.
 */
function siunitxProductsToDsl(text: string): string {
  return text.replace(/(?<=[^\s./*^(])\s*\.\s*(?=[^\s\d./*^)+-])/g, '*');
}

/**
 * Read a braced group as raw text and resolve it as a unit.  Shared by
 * siunitx handlers. In the text, the siunitx product separators `.` and `~`
 * are a product (`m.s^{-1}` and `m~s^{-1}` are `m·s⁻¹`).
 *
 * When there is no braced group, or it is not closed, restore the parser
 * and return `null`. When the text of the group is not a unit, return an
 * `unknown-unit` error with the text of the group:
 * `["Error", "'unknown-unit'", ["LatexString", "'foo'"]]` for `{foo}`.
 * Without it, the parser reported an `unexpected-command` error on the
 * siunitx command, which does not say that the unit is the problem.
 */
function readBracedUnit(parser: Parser): MathJsonExpression | null {
  const saved = parser.index;
  while (parser.peek === '<space>') parser.nextToken();
  // The index of the first token after the `{`
  const start = parser.index + 1;
  const unitText = readBracedText(parser, true);
  if (unitText === null) {
    parser.index = saved;
    return null;
  }
  const unit = resolveUnitText(siunitxProductsToDsl(unitText));
  if (unit !== null) return unit;
  // The error spans the text of the group, without the braces: move back
  // before the `}`, make the error, then move after the `}` again.
  const end = parser.index;
  parser.index = end - 1;
  const error = parser.error('unknown-unit', start);
  parser.index = end;
  return error;
}

// ---------------------------------------------------------------------------
// Dictionary entries
// ---------------------------------------------------------------------------

export const DEFINITIONS_UNITS: LatexDictionary = [
  // -- Expression entries for unit parsing --
  // These are tried as primary expressions.  Longer triggers (like
  // `\mathrm{e}` → ExponentialE in definitions-arithmetic.ts) are tried
  // first, so there is no conflict.
  {
    latexTrigger: '\\mathrm',
    kind: 'expression',
    parse: parseUnitExpression,
  },
  {
    latexTrigger: '\\text',
    kind: 'expression',
    parse: parseUnitExpression,
  },

  // -- siunitx commands --
  // \qty{value}{unit} and \SI{value}{unit} — quantity with magnitude + unit
  { latexTrigger: '\\qty', parse: parseSiunitxQuantity },
  { latexTrigger: '\\SI', parse: parseSiunitxQuantity },
  // \unit{unit} and \si{unit} — bare unit expression (no magnitude)
  { latexTrigger: '\\unit', parse: parseSiunitxUnit },
  { latexTrigger: '\\si', parse: parseSiunitxUnit },

  // -- Quantity serialization --
  {
    name: 'Quantity',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const magnitude = operand(expr, 1);
      const unit = operand(expr, 2);

      if (magnitude === null || unit === null) return '';

      // Check if this is an angle unit and DMS format is requested
      const unitSymbol = symbol(unit);
      const isAngleUnit =
        unitSymbol === 'deg' ||
        unitSymbol === 'rad' ||
        unitSymbol === 'arcmin' ||
        unitSymbol === 'arcsec';

      const options = serializer.options;

      if (
        isAngleUnit &&
        (options.dmsFormat ||
          (options.angleNormalization && options.angleNormalization !== 'none'))
      ) {
        // Get numeric value
        const magnitudeValue = machineValue(magnitude);
        if (magnitudeValue === null) {
          // Fall back to default serialization if we can't get a numeric value
          const unitStr = unitToMathrm(unit);
          if (unitStr === null) return serializer.serializeFunction(expr);
          return serializeQuantity(serializer, magnitude, unitStr);
        }

        // Convert to degrees
        let degrees = magnitudeValue;

        if (unitSymbol === 'rad') {
          degrees = (degrees * 180) / Math.PI;
        } else if (unitSymbol === 'arcmin') {
          degrees = degrees / 60;
        } else if (unitSymbol === 'arcsec') {
          degrees = degrees / 3600;
        }

        // Apply normalization
        if (options.angleNormalization && options.angleNormalization !== 'none')
          degrees = normalizeAngle(degrees, options.angleNormalization);

        if (options.dmsFormat) return formatDMS(degrees);
        return `${degrees}°`;
      }

      // Fall through to default Quantity serialization.
      const unitStr = unitToMathrm(unit);
      if (unitStr === null) return serializer.serializeFunction(expr);
      return serializeQuantity(serializer, magnitude, unitStr);
    },
  },
];
