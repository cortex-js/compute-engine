/**
 * LaTeX dictionary entries for parsing and serializing physical quantities
 * with units.
 *
 * Parsing:  `12\,\mathrm{cm}`  →  `['Quantity', 12, 'cm']`
 * Serializing:  `['Quantity', 12, 'cm']`  →  `12\,\mathrm{cm}`
 *
 * Registers `\mathrm` and `\text` as **postfix** operators (with optional
 * leading visual-space tokens `\,` and `\;`).  When the braced content is
 * a recognised unit the handler returns a `Quantity` expression; otherwise
 * it returns `null` so the parser backtracks and the normal symbol-parsing
 * takes over.
 */

import type { MathJsonExpression } from '../../../math-json/types';
import { operand, operator, symbol } from '../../../math-json/utils';
import type {
  LatexDictionary,
  Parser,
  Serializer,
  PostfixParseHandler,
} from '../types';
import { POSTFIX_PRECEDENCE } from '../types';
import { joinLatex } from '../tokenizer';
import {
  getUnitDimension,
  parseUnitDSL,
  type UnitExpression,
} from '../../numerics/unit-data';

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
 * Check whether a raw text string from `\mathrm{...}` or `\text{...}`
 * represents a known unit (simple or compound).
 *
 * Returns a MathJSON unit expression, or `null` if not recognised.
 */
function resolveUnitText(text: string): MathJsonExpression | null {
  if (!text || text.length === 0) return null;

  // Simple unit check: is the whole string a known unit?
  if (getUnitDimension(text) !== null) return text;

  // Compound unit check: does the string contain `/`, `*`, or `^`?
  if (/[/*^]/.test(text)) {
    try {
      const parsed = parseUnitDSL(text);
      // Verify the parsed expression represents valid units
      if (isValidUnitExpression(parsed)) return parsed as MathJsonExpression;
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
// Postfix parse handler
// ---------------------------------------------------------------------------

/**
 * Shared postfix parse handler for `\mathrm{...}` and `\text{...}` after
 * a numeric expression.  The trigger tokens (including optional space)
 * have already been consumed.  The parser is pointing right after `\mathrm`
 * or `\text`.
 */
const parseUnitPostfix: PostfixParseHandler = (
  parser: Parser,
  lhs: MathJsonExpression
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

  return ['Quantity', lhs, unit];
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
      typeof exp === 'number' ? String(exp) : (symbol(exp) ?? String(exp));
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
// Dictionary entries
// ---------------------------------------------------------------------------

/**
 * Build a postfix entry for a given trigger.
 */
function makePostfixEntry(trigger: string | string[]) {
  return {
    latexTrigger: trigger,
    kind: 'postfix' as const,
    precedence: POSTFIX_PRECEDENCE,
    parse: parseUnitPostfix,
  };
}

export const DEFINITIONS_UNITS: LatexDictionary = [
  // -- \mathrm variants --
  makePostfixEntry(['\\mathrm']), // no space
  makePostfixEntry(['\\,', '\\mathrm']), // thin space
  makePostfixEntry(['\\;', '\\mathrm']), // medium space
  makePostfixEntry(['\\:', '\\mathrm']), // medium-math space
  makePostfixEntry(['\\!', '\\mathrm']), // negative thin space (rare but possible)

  // -- \text variants --
  makePostfixEntry(['\\text']), // no space
  makePostfixEntry(['\\,', '\\text']), // thin space
  makePostfixEntry(['\\;', '\\text']), // medium space
  makePostfixEntry(['\\:', '\\text']), // medium-math space

  // -- Quantity serialization --
  {
    name: 'Quantity',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const magnitude = operand(expr, 1);
      const unit = operand(expr, 2);

      if (magnitude === null || unit === null) return '';

      const magLatex = serializer.serialize(magnitude);
      const unitStr = unitToMathrm(unit);

      return joinLatex([magLatex, '\\,', `\\mathrm{${unitStr}}`]);
    },
  },
];
