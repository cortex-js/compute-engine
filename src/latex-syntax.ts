/**
 * Entry point for `@cortex-js/compute-engine/latex-syntax`.
 *
 * Provides standalone LaTeX <-> MathJSON parsing and serialization
 * without requiring a full `ComputeEngine` instance.
 *
 * @module latex-syntax
 */

// --- Class and free functions ---
export {
  LatexSyntax,
  parse,
  serialize,
} from './compute-engine/latex-syntax/latex-syntax.js';

export type { LatexSyntaxOptions } from './compute-engine/latex-syntax/latex-syntax.js';

// --- Dictionaries ---
export {
  LATEX_DICTIONARY,
  CORE_DICTIONARY,
  SYMBOLS_DICTIONARY,
  ALGEBRA_DICTIONARY,
  ARITHMETIC_DICTIONARY,
  COMPLEX_DICTIONARY,
  TRIGONOMETRY_DICTIONARY,
  CALCULUS_DICTIONARY,
  LINEAR_ALGEBRA_DICTIONARY,
  STATISTICS_DICTIONARY,
  LOGIC_DICTIONARY,
  SETS_DICTIONARY,
  INEQUALITIES_DICTIONARY,
  UNITS_DICTIONARY,
  OTHERS_DICTIONARY,
  PHYSICS_DICTIONARY,
} from './compute-engine/latex-syntax/dictionary/default-dictionary.js';

// --- Types ---
export type {
  LatexDictionaryEntry,
  LatexDictionary,
  SerializeLatexOptions,
  ParseLatexOptions,
  ParseDiagnostic,
  LatexString,
} from './compute-engine/latex-syntax/types.js';

export type { MathJsonExpression } from './math-json/types.js';

export const version = '{{SDK_VERSION}}';
