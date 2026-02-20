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

import type { MathJsonExpression } from '../../../math-json/types';
import {
  operand,
  operator,
  symbol,
  machineValue,
} from '../../../math-json/utils';
import type {
  LatexDictionary,
  Parser,
  Serializer,
  ExpressionParseHandler,
} from '../types';
import { joinLatex } from '../tokenizer';
import {
  getUnitDimension,
  parseUnitDSL,
  type UnitExpression,
} from '../../numerics/unit-data';
import { normalizeAngle, formatDMS } from '../serialize-dms';

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
 * Returns `null` if no opening brace is found.
 */
function readBracedText(parser: Parser): string | null {
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

    // Skip space tokens inside the group
    if (token === '<space>') {
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
    // We want to collect `^{2}` as `^2`.
    if (token === '^') {
      text += '^';
      parser.nextToken();
      continue;
    }

    text += token;
    parser.nextToken();
  }

  // If we ran out of tokens without closing the group, return null
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
 * Check whether a raw text string from `\mathrm{...}` or `\text{...}`
 * represents a known unit (simple or compound).
 *
 * Returns a MathJSON unit expression, or `null` if not recognised.
 */
function resolveUnitText(text: string): MathJsonExpression | null {
  if (!text || text.length === 0) return null;

  // Block symbols that have primary mathematical meanings
  if (UNIT_BLOCKLIST.has(text)) return null;

  // Simple unit check: is the whole string a known unit?
  if (getUnitDimension(text) !== null) return text;

  // Compound unit check: does the string contain `/`, `*`, or `^`?
  if (/[/*^]/.test(text)) {
    try {
      const parsed = parseUnitDSL(text);
      // Verify the parsed expression represents valid units
      if (parsed !== null && isValidUnitExpression(parsed))
        return parsed as MathJsonExpression;
    } catch {
      return null;
    }
  }

  return null;
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
const parseUnitExpression: ExpressionParseHandler = (
  parser: Parser
): MathJsonExpression | null => {
  const saved = parser.index;

  const text = readBracedText(parser);
  if (text === null) {
    parser.index = saved;
    return null;
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
 */
function unitToMathrm(expr: MathJsonExpression): string {
  // Simple symbol
  const sym = symbol(expr);
  if (sym !== null) return sym;

  // Number (e.g. the 1 in ['Divide', 1, 's'] from prettified Power(s, -1))
  if (typeof expr === 'number') return String(expr);

  const op = operator(expr);
  if (!op) return '';

  if (op === 'Divide') {
    const num = operand(expr, 1);
    const den = operand(expr, 2);
    return `${unitToMathrm(num!)}/${unitToMathrm(den!)}`;
  }

  if (op === 'Multiply') {
    // Collect all operands
    const parts: string[] = [];
    if (Array.isArray(expr)) {
      for (let i = 1; i < expr.length; i++) {
        parts.push(unitToMathrm(expr[i]));
      }
    }
    return parts.join('\\cdot ');
  }

  if (op === 'Power') {
    const base = operand(expr, 1);
    const exp = operand(expr, 2);
    const expStr =
      typeof exp === 'number' ? String(exp) : symbol(exp) ?? String(exp);
    return `${unitToMathrm(base!)}^{${expStr}}`;
  }

  // Handle prettified forms: Square(x) → x^{2}
  if (op === 'Square') {
    const base = operand(expr, 1);
    return `${unitToMathrm(base!)}^{2}`;
  }

  return '';
}

// ---------------------------------------------------------------------------
// siunitx shared parse helpers
// ---------------------------------------------------------------------------

/**
 * Parse `\qty{value}{unit}` or `\SI{value}{unit}`.
 * First braced group is a math expression (magnitude), second is raw
 * text (unit).  Returns `['Quantity', value, unit]` or `null`.
 */
function parseSiunitxQuantity(parser: Parser): MathJsonExpression | null {
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
  return readBracedUnit(parser);
}

/**
 * Read a braced group as raw text, resolve it as a unit, and restore the
 * parser on failure.  Shared by siunitx handlers.
 */
function readBracedUnit(parser: Parser): MathJsonExpression | null {
  const saved = parser.index;
  const unitText = readBracedText(parser);
  if (unitText === null) {
    parser.index = saved;
    return null;
  }
  const unit = resolveUnitText(unitText);
  if (unit === null) {
    parser.index = saved;
    return null;
  }
  return unit;
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
          const magLatex = serializer.serialize(magnitude);
          const unitStr = unitToMathrm(unit);
          return joinLatex([magLatex, '\\,', `\\mathrm{${unitStr}}`]);
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

      // Fall through to default Quantity serialization
      const magLatex = serializer.serialize(magnitude);
      const unitStr = unitToMathrm(unit);

      return joinLatex([magLatex, '\\,', `\\mathrm{${unitStr}}`]);
    },
  },
];
