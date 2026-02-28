/**
 * Default LaTeX dictionary assembly.
 *
 * This file imports all individual domain dictionaries and assembles them
 * into a single `LATEX_DICTIONARY` constant. The dictionaries are
 * independently importable -- they do not depend on the engine's library
 * system.
 */

import type { LatexDictionary } from '../types';

import { DEFINITIONS_CORE } from './definitions-core';
import { DEFINITIONS_SYMBOLS } from './definitions-symbols';
import { DEFINITIONS_ALGEBRA } from './definitions-algebra';
import { DEFINITIONS_LOGIC } from './definitions-logic';
import { DEFINITIONS_SETS } from './definitions-sets';
import { DEFINITIONS_INEQUALITIES } from './definitions-relational-operators';
import { DEFINITIONS_ARITHMETIC } from './definitions-arithmetic';
import { DEFINITIONS_COMPLEX } from './definitions-complex';
import { DEFINITIONS_TRIGONOMETRY } from './definitions-trigonometry';
import { DEFINITIONS_CALCULUS } from './definitions-calculus';
import { DEFINITIONS_LINEAR_ALGEBRA } from './definitions-linear-algebra';
import { DEFINITIONS_STATISTICS } from './definitions-statistics';
import { DEFINITIONS_UNITS } from './definitions-units';
import { DEFINITIONS_OTHERS } from './definitions-other';

// Re-export all individual dictionaries with their original names
export {
  DEFINITIONS_CORE,
  DEFINITIONS_SYMBOLS,
  DEFINITIONS_ALGEBRA,
  DEFINITIONS_LOGIC,
  DEFINITIONS_SETS,
  DEFINITIONS_INEQUALITIES,
  DEFINITIONS_ARITHMETIC,
  DEFINITIONS_COMPLEX,
  DEFINITIONS_TRIGONOMETRY,
  DEFINITIONS_CALCULUS,
  DEFINITIONS_LINEAR_ALGEBRA,
  DEFINITIONS_STATISTICS,
  DEFINITIONS_UNITS,
  DEFINITIONS_OTHERS,
};

// Public-friendly aliases
export {
  DEFINITIONS_CORE as CORE_DICTIONARY,
  DEFINITIONS_SYMBOLS as SYMBOLS_DICTIONARY,
  DEFINITIONS_ALGEBRA as ALGEBRA_DICTIONARY,
  DEFINITIONS_LOGIC as LOGIC_DICTIONARY,
  DEFINITIONS_SETS as SETS_DICTIONARY,
  DEFINITIONS_INEQUALITIES as INEQUALITIES_DICTIONARY,
  DEFINITIONS_ARITHMETIC as ARITHMETIC_DICTIONARY,
  DEFINITIONS_COMPLEX as COMPLEX_DICTIONARY,
  DEFINITIONS_TRIGONOMETRY as TRIGONOMETRY_DICTIONARY,
  DEFINITIONS_CALCULUS as CALCULUS_DICTIONARY,
  DEFINITIONS_LINEAR_ALGEBRA as LINEAR_ALGEBRA_DICTIONARY,
  DEFINITIONS_STATISTICS as STATISTICS_DICTIONARY,
  DEFINITIONS_UNITS as UNITS_DICTIONARY,
  DEFINITIONS_OTHERS as OTHERS_DICTIONARY,
};

/**
 * LaTeX dictionary entries for physics constants that have LaTeX triggers.
 * These were previously inline in the physics library definition.
 */
export const DEFINITIONS_PHYSICS: LatexDictionary = [
  {
    name: 'Mu0',
    kind: 'symbol',
    latexTrigger: '\\mu_0',
  },
  {
    name: 'VacuumPermittivity',
    kind: 'symbol',
    latexTrigger: '\\varepsilon_0',
  },
];

export { DEFINITIONS_PHYSICS as PHYSICS_DICTIONARY };

/**
 * The complete default LaTeX dictionary, combining all domain dictionaries.
 *
 * This is used as the default dictionary when no custom dictionary is provided.
 */
export const LATEX_DICTIONARY: LatexDictionary = [
  ...DEFINITIONS_CORE,
  ...DEFINITIONS_SYMBOLS,
  ...DEFINITIONS_ALGEBRA,
  ...DEFINITIONS_LOGIC,
  ...DEFINITIONS_SETS,
  ...DEFINITIONS_INEQUALITIES,
  ...DEFINITIONS_ARITHMETIC,
  ...DEFINITIONS_COMPLEX,
  ...DEFINITIONS_TRIGONOMETRY,
  ...DEFINITIONS_CALCULUS,
  ...DEFINITIONS_LINEAR_ALGEBRA,
  ...DEFINITIONS_STATISTICS,
  ...DEFINITIONS_UNITS,
  ...DEFINITIONS_OTHERS,
  ...DEFINITIONS_PHYSICS,
];
