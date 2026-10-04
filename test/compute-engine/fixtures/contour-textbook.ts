import type {
  ContourInput,
  ExpressionInput,
} from '../../../src/compute-engine';

/** Mathematical inputs and independently specified answers, not scraped prose.
 * Source locators identify the exercise or the family used for variations. */
export const contourTextbookSources = {
  mhCauchy: {
    author: 'John H. Mathews and Russell W. Howell',
    title: 'Complex Analysis, §6.5: Cauchy Integral Formulas',
    url: 'https://complexanalysis.org/web/sec_cauchy-integral-formulas.html',
    license: 'CC BY 4.0',
  },
  mhResidue: {
    author: 'John H. Mathews and Russell W. Howell',
    title: 'Complex Analysis, §8.1: The Residue Theorem',
    url: 'https://complexanalysis.org/web/sec_residue-thm.html',
    license: 'CC BY 4.0',
  },
  lebl: {
    author: 'Jiří Lebl',
    title: 'Guide to Cultivating Complex Analysis, §5.3',
    url: 'https://raw.githubusercontent.com/jirilebl/ca/master/ca.tex',
    license: 'CC BY-SA 4.0 (dual-licensed with CC BY-NC-SA 4.0)',
  },
  orloffRational: {
    author: 'Jeremy Orloff',
    title: 'Complex Variables with Applications, §10.2: Integrals',
    url: 'https://math.libretexts.org/Bookshelves/Analysis/Complex_Variables_with_Applications_(Orloff)/10%3A_Definite_Integrals_Using_the_Residue_Theorem/10.02%3A_Integrals',
    license: 'CC BY-NC-SA 4.0',
  },
  orloffPeriodic: {
    author: 'Jeremy Orloff',
    title:
      'Complex Variables with Applications, §10.3: Trigonometric Integrals',
    url: 'https://math.libretexts.org/Bookshelves/Analysis/Complex_Variables_with_Applications_(Orloff)/10%3A_Definite_Integrals_Using_the_Residue_Theorem/10.03%3A_Trigonometric_Integrals',
    license: 'CC BY-NC-SA 4.0',
  },
  orloffBranches: {
    author: 'Jeremy Orloff',
    title:
      'Complex Variables with Applications, §10.4: Integrands with branch cuts',
    url: 'https://math.libretexts.org/Bookshelves/Analysis/Complex_Variables_with_Applications_(Orloff)/10%3A_Definite_Integrals_Using_the_Residue_Theorem/10.04%3A_Integrands_with_branch_cuts',
    license: 'CC BY-NC-SA 4.0',
  },
  orloffPV: {
    author: 'Jeremy Orloff',
    title: 'Complex Variables with Applications, §10.5: Cauchy Principal Value',
    url: 'https://math.libretexts.org/Bookshelves/Analysis/Complex_Variables_with_Applications_(Orloff)/10%3A_Definite_Integrals_Using_the_Residue_Theorem/10.05%3A_Cauchy_principal_value',
    license: 'CC BY-NC-SA 4.0',
  },
} as const;

export type TextbookIntegral = {
  id: string;
  source: keyof typeof contourTextbookSources;
  locator: string;
  family: string;
  integrand: string;
  expected: string;
  contour?: ContourInput;
  bounds?: readonly [string, string];
  /** Missing capability; strict mode executes these as ordinary failing tests. */
  gap?: string;
};

const circle = (radius = 1, center: ExpressionInput = 0): ContourInput => ({
  kind: 'circle',
  // Textbook half-integer radii are exact fractions, not machine decimals.
  radius: Number.isInteger(radius) ? radius : ['Rational', radius * 2, 2],
  center,
});
const line: ContourInput = { kind: 'real-line' };

export const contourTextbookCases: TextbookIntegral[] = [
  {
    id: 'Periodic-double-algebraic-pole',
    source: 'lebl',
    locator: 'Periodic example family, squared denominator and c=2',
    family: 'repeated algebraic poles after periodic substitution',
    integrand: '\\frac{1}{(2+\\cos z)^2}',
    bounds: ['0', '2\\pi'],
    expected: '\\frac{4\\pi}{3\\sqrt{3}}',
  },
  {
    id: 'MH-6.5-E3',
    source: 'mhCauchy',
    locator: 'Example 6.5.3',
    family: 'Cauchy formula',
    integrand: '\\frac{e^z}{z-1}',
    contour: circle(2),
    expected: '2\\pi i e',
  },
  {
    id: 'MH-6.5-E4',
    source: 'mhCauchy',
    locator: 'Example 6.5.4',
    family: 'transcendental pole coordinates',
    integrand: '\\frac{\\sin z}{4z+\\pi}',
    contour: circle(),
    expected: '-\\frac{\\sqrt{2}\\pi i}{4}',
  },
  {
    id: 'MH-6.5-E5',
    source: 'mhCauchy',
    locator: 'Example 6.5.5',
    family: 'Cauchy formula',
    integrand: '\\frac{e^{i\\pi z}}{2z^2-5z+2}',
    contour: circle(),
    expected: '\\frac{2\\pi}{3}',
  },
  {
    id: 'MH-6.5-E9',
    source: 'mhCauchy',
    locator: 'Example 6.5.9',
    family: 'higher-order poles',
    integrand: '\\frac{e^{z^2}}{(z-i)^4}',
    contour: circle(2),
    expected: '-\\frac{4\\pi}{3e}',
  },
  {
    id: 'MH-6.5-1',
    source: 'mhCauchy',
    locator: 'Exercise 1',
    family: 'linearity',
    integrand: '\\frac{e^z+\\cos z}{z}',
    contour: circle(),
    expected: '4\\pi i',
  },
  {
    id: 'MH-6.5-2',
    source: 'mhCauchy',
    locator: 'Exercise 2',
    family: 'translated circles',
    integrand: '\\frac{1}{(z+1)(z-1)}',
    contour: circle(1, 1),
    expected: '\\pi i',
  },
  {
    id: 'MH-6.5-3',
    source: 'mhCauchy',
    locator: 'Exercise 3',
    family: 'higher-order poles',
    integrand: '\\frac{1}{(z+1)(z-1)^2}',
    contour: circle(1, 1),
    expected: '-\\frac{\\pi i}{2}',
  },
  {
    id: 'MH-6.5-4',
    source: 'mhCauchy',
    locator: 'Exercise 4',
    family: 'cubic poles',
    integrand: '\\frac{1}{z^3-1}',
    contour: circle(1, 1),
    expected: '\\frac{2\\pi i}{3}',
  },
  {
    id: 'MH-6.5-5',
    source: 'mhCauchy',
    locator: 'Exercise 5',
    family: 'higher-order poles',
    integrand: '\\frac{\\sin z}{z^4}',
    contour: circle(),
    expected: '-\\frac{\\pi i}{3}',
  },
  {
    id: 'MH-6.5-6',
    source: 'mhCauchy',
    locator: 'Exercise 6',
    family: 'trigonometric pole enumeration',
    integrand: '\\frac{1}{z\\cos z}',
    contour: circle(),
    expected: '2\\pi i',
  },
  {
    id: 'MH-6.5-7',
    source: 'mhCauchy',
    locator: 'Exercise 7',
    family: 'composition and cancellation',
    integrand: '\\frac{\\sinh(z^2)}{z^3}',
    contour: circle(),
    expected: '2\\pi i',
  },
  {
    id: 'MH-6.5-10a',
    source: 'mhCauchy',
    locator: 'Exercise 10(a)',
    family: 'mixed pole orders',
    integrand: '\\frac{e^z}{z^2(z^2-16)}',
    contour: circle(),
    expected: '-\\frac{\\pi i}{8}',
  },
  {
    id: 'MH-6.5-10b',
    source: 'mhCauchy',
    locator: 'Exercise 10(b)',
    family: 'translated circles',
    integrand: '\\frac{e^z}{z^2(z^2-16)}',
    contour: circle(1, 4),
    expected: '\\frac{\\pi i e^4}{64}',
  },
  {
    id: 'MH-6.5-11',
    source: 'mhCauchy',
    locator: 'Exercise 11',
    family: 'quartic poles',
    integrand: '\\frac{1}{z^4+4}',
    contour: circle(1, ['Complex', 1, 1]),
    expected: '\\frac{\\pi}{8}-\\frac{\\pi i}{8}',
  },
  {
    id: 'MH-6.5-12a',
    source: 'mhCauchy',
    locator: 'Exercise 12(a)',
    family: 'pole selection',
    integrand: '\\frac{e^z}{z(z-1)}',
    contour: circle(0.5),
    expected: '-2\\pi i',
  },
  {
    id: 'MH-6.5-12b',
    source: 'mhCauchy',
    locator: 'Exercise 12(b)',
    family: 'multiple residues',
    integrand: '\\frac{e^z}{z(z-1)}',
    contour: circle(2),
    expected: '2\\pi i(e-1)',
  },
  {
    id: 'MH-6.5-13a',
    source: 'mhCauchy',
    locator: 'Exercise 13(a)',
    family: 'complex trigonometric values',
    integrand: '\\frac{\\sin z}{z^2+1}',
    contour: circle(1, 'ImaginaryUnit'),
    expected: '\\pi i\\sinh(1)',
  },
  {
    id: 'MH-6.5-13b',
    source: 'mhCauchy',
    locator: 'Exercise 13(b)',
    family: 'complex trigonometric values',
    integrand: '\\frac{\\sin z}{z^2+1}',
    contour: circle(1, ['Complex', 0, -1]),
    expected: '\\pi i\\sinh(1)',
  },
  {
    id: 'MH-6.5-14',
    source: 'mhCauchy',
    locator: 'Exercise 14',
    family: 'repeated complex poles',
    integrand: '\\frac{1}{(z^2+1)^2}',
    contour: circle(1, 'ImaginaryUnit'),
    expected: '\\frac{\\pi}{2}',
  },
  {
    id: 'MH-8.1-3a',
    source: 'mhResidue',
    locator: 'Exercise 3(a)',
    family: 'quartic poles',
    integrand: '\\frac{1}{z^4+4}',
    contour: circle(1, ['Complex', -1, 1]),
    expected: '\\frac{\\pi}{8}+\\frac{\\pi i}{8}',
  },
  {
    id: 'MH-8.1-3c',
    source: 'mhResidue',
    locator: 'Exercise 3(c)',
    family: 'multiple residues',
    integrand: '\\frac{e^z}{z^3+z}',
    contour: circle(2),
    expected: '2\\pi i(1-\\cos(1))',
  },
  {
    id: 'MH-8.1-3e',
    source: 'mhResidue',
    locator: 'Exercise 3(e)',
    family: 'multiple residues',
    integrand: '\\frac{\\sin z}{z^2+1}',
    contour: circle(2),
    expected: '2\\pi i\\sinh(1)',
  },
  {
    id: 'MH-8.1-3f',
    source: 'mhResidue',
    locator: 'Exercise 3(f)',
    family: 'trigonometric pole enumeration',
    integrand: '\\frac{1}{z^2\\sin z}',
    contour: circle(),
    expected: '\\frac{\\pi i}{3}',
  },
  {
    id: 'MH-8.1-3g',
    source: 'mhResidue',
    locator: 'Exercise 3(g)',
    family: 'trigonometric pole enumeration',
    integrand: '\\frac{1}{z\\sin^2 z}',
    contour: circle(),
    expected: '\\frac{2\\pi i}{3}',
  },
  {
    id: 'MH-8.1-5a',
    source: 'mhResidue',
    locator: 'Exercise 5(a)',
    family: 'mixed pole orders',
    integrand: '\\frac{1}{(z-1)^2(z^2+4)}',
    contour: circle(1, 1),
    expected: '-\\frac{4\\pi i}{25}',
  },
  {
    id: 'MH-8.1-5b',
    source: 'mhResidue',
    locator: 'Exercise 5(b)',
    family: 'residue cancellation',
    integrand: '\\frac{1}{(z-1)^2(z^2+4)}',
    contour: circle(4),
    expected: '0',
  },
  {
    id: 'MH-8.1-6a',
    source: 'mhResidue',
    locator: 'Exercise 6(a)',
    family: 'sextic poles',
    integrand: '\\frac{1}{z^6+1}',
    contour: circle(0.5, 'ImaginaryUnit'),
    expected: '\\frac{\\pi}{3}',
  },
  {
    id: 'MH-8.1-7a',
    source: 'mhResidue',
    locator: 'Exercise 7(a)',
    family: 'biquadratic poles',
    integrand: '\\frac{1}{3z^4+10z^2+3}',
    contour: {
      kind: 'circle',
      center: ['Multiply', 'ImaginaryUnit', ['Sqrt', 3]],
      radius: 1,
    },
    expected: '-\\frac{\\pi\\sqrt{3}}{24}',
  },
  {
    id: 'MH-8.1-8a',
    source: 'mhResidue',
    locator: 'Exercise 8(a)',
    family: 'expanded repeated roots',
    integrand: '\\frac{1}{z^4-z^3-2z^2}',
    contour: circle(0.5),
    expected: '\\frac{\\pi i}{2}',
  },
  {
    id: 'MH-8.1-8b',
    source: 'mhResidue',
    locator: 'Exercise 8(b)',
    family: 'expanded repeated roots',
    integrand: '\\frac{1}{z^4-z^3-2z^2}',
    contour: circle(1.5),
    expected: '-\\frac{\\pi i}{6}',
  },
  {
    id: 'O-10.2-E1',
    source: 'orloffRational',
    locator: 'Example 1',
    family: 'repeated complex poles',
    integrand: '\\frac{1}{(1+z^2)^2}',
    contour: line,
    expected: '\\frac{\\pi}{2}',
  },
  {
    id: 'O-10.2-E2',
    source: 'orloffRational',
    locator: 'Example 2',
    family: 'quartic real integrals',
    integrand: '\\frac{1}{1+z^4}',
    contour: line,
    expected: '\\frac{\\pi}{\\sqrt{2}}',
  },
  {
    id: 'L-5.3-cosine',
    source: 'lebl',
    locator: 'Residue-theorem exercise, cosine part',
    family: 'quartic Fourier integrals',
    integrand: '\\frac{\\cos(3z)}{z^4+1}',
    contour: line,
    expected:
      '\\frac{\\pi}{\\sqrt{2}}e^{-3/\\sqrt{2}}(\\cos(3/\\sqrt{2})+\\sin(3/\\sqrt{2}))',
  },
  {
    id: 'O-10.5-E3',
    source: 'orloffPV',
    locator: 'Example 3, principal-value part',
    family: 'principal value at infinity',
    integrand: '\\frac{1}{z}',
    contour: { kind: 'real-line', principalValue: true },
    expected: '0',
  },
  {
    id: 'MH-8.1-E4',
    source: 'mhResidue',
    locator: 'Example 8.1.4',
    family: 'essential singularities',
    integrand: 'e^{2/z}',
    contour: circle(),
    expected: '4\\pi i',
  },
  {
    id: 'L-5.3-essential',
    source: 'lebl',
    locator: 'First residue-theorem exercise, n=2',
    family: 'essential singularities',
    integrand: 'z^2 e^{1/z}',
    contour: circle(),
    expected: '\\frac{\\pi i}{3}',
  },
  {
    id: 'L-5.3-periodic',
    source: 'lebl',
    locator: 'Periodic example, c=2',
    family: 'periodic trigonometric substitution',
    integrand: '\\frac{1}{2+\\cos z}',
    bounds: ['0', '2\\pi'],
    expected: '\\frac{2\\pi}{\\sqrt{3}}',
  },
  {
    id: 'L-5.3-periodic-exercise',
    source: 'lebl',
    locator: 'Trigonometric exercise, first part',
    family: 'periodic trigonometric substitution',
    integrand: '\\frac{\\cos z}{2+\\cos z}',
    bounds: ['0', '2\\pi'],
    expected: '2\\pi(1-2/\\sqrt{3})',
  },
  {
    id: 'L-5.3-half-period',
    source: 'lebl',
    locator: 'Trigonometric exercise, second part',
    family: 'half-period symmetry',
    integrand: '\\frac{\\sin^2 z}{2+\\cos z}',
    bounds: ['0', '\\pi'],
    expected: '\\pi(2-\\sqrt{3})',
  },
  {
    id: 'O-10.3-E1',
    source: 'orloffPeriodic',
    locator: 'Example 1, a=2',
    family: 'periodic trigonometric substitution',
    integrand: '\\frac{1}{5-4\\cos z}',
    bounds: ['0', '2\\pi'],
    expected: '\\frac{2\\pi}{3}',
  },
  {
    id: 'O-10.4-E1',
    source: 'orloffBranches',
    locator: 'Example 1',
    family: 'keyhole contour',
    integrand: '\\frac{z^{1/3}}{1+z^2}',
    bounds: ['0', '\\infty'],
    expected: '\\frac{\\pi}{\\sqrt{3}}',
    gap: 'branch-aware keyhole contours',
  },
  {
    id: 'O-10.4-E2',
    source: 'orloffBranches',
    locator: 'Example 2',
    family: 'branch-cut endpoints',
    integrand: '\\frac{1}{z\\sqrt{z^2-1}}',
    bounds: ['1', '\\infty'],
    expected: '\\frac{\\pi}{2}',
  },
  {
    id: 'L-5.3-Gaussian',
    source: 'lebl',
    locator: 'Final residue-theorem exercise',
    family: 'auxiliary contour construction',
    integrand: 'e^{-z^2/2}',
    bounds: ['-\\infty', '\\infty'],
    expected: '\\sqrt{2\\pi}',
  },
];

// These variations have closed forms derived from Cauchy's differentiation
// formula and rational Fourier transforms, independent of engine output.
for (const n of [1, 2, 3, 4, 5, 6, 8]) {
  let factorial = 1;
  for (let k = 2; k < n; k++) factorial *= k;
  contourTextbookCases.push({
    id: `MH-6.5-9-n${n}`,
    source: 'mhCauchy',
    locator: `Exercise 9, n=${n}`,
    family: 'Cauchy derivative family',
    integrand: `\\frac{e^z}{z^{${n}}}`,
    contour: circle(),
    expected: `\\frac{2\\pi i}{${factorial}}`,
  });
}
for (const b of [1, 2, 3]) {
  for (const a of [-3, -1, 1, 2]) {
    contourTextbookCases.push({
      id: `O-Fourier-a${a}-b${b}`,
      source: 'orloffRational',
      locator: `Example 3 family, full line, a=${a}, b=${b}`,
      family: 'Fourier frequency and scale',
      integrand: `\\frac{\\cos(${a}z)}{z^2+${b * b}}`,
      contour: line,
      expected: `\\frac{\\pi}{${b}}e^{-${Math.abs(a) * b}}`,
    });
  }
  contourTextbookCases.push({
    id: `O-half-line-b${b}`,
    source: 'orloffRational',
    locator: `Example 3, b=${b}`,
    family: 'even half-line reduction',
    integrand: `\\frac{\\cos z}{z^2+${b * b}}`,
    bounds: ['0', '\\infty'],
    expected: `\\frac{\\pi}{${2 * b}}e^{-${b}}`,
  });
  contourTextbookCases.push({
    id: `O-repeated-b${b}`,
    source: 'orloffRational',
    locator: `Example 1 scale variation, b=${b}`,
    family: 'repeated complex poles',
    integrand: `\\frac{1}{(z^2+${b * b})^3}`,
    contour: line,
    expected: `\\frac{3\\pi}{${8 * b ** 5}}`,
  });
}

for (const b of [1, 2]) {
  for (const a of [-2, 1, 3]) {
    const decay = `e^{-${Math.abs(a) * b}}`;
    const common = {
      source: 'orloffRational' as const,
      locator: `Example 3 Fourier-family variation, a=${a}, b=${b}`,
      contour: line,
    };
    contourTextbookCases.push(
      {
        ...common,
        id: `Fourier-odd-${a}-${b}`,
        family: 'odd Fourier cancellation',
        integrand: `\\frac{\\sin(${a}z)}{z^2+${b * b}}`,
        expected: '0',
      },
      {
        ...common,
        id: `Fourier-first-moment-${a}-${b}`,
        family: 'conditionally convergent Fourier integrals',
        integrand: `\\frac{z\\sin(${a}z)}{z^2+${b * b}}`,
        expected: `${Math.sign(a)}\\pi ${decay}`,
      },
      {
        ...common,
        id: `Fourier-double-pole-${a}-${b}`,
        family: 'Fourier integrals with double poles',
        integrand: `\\frac{\\cos(${a}z)}{(z^2+${b * b})^2}`,
        expected: `\\frac{${1 + Math.abs(a) * b}\\pi}{${2 * b ** 3}}${decay}`,
      },
      {
        ...common,
        id: `Fourier-phase-${a}-${b}`,
        family: 'Fourier phase offsets',
        integrand: `\\frac{\\cos(${a}z+1)}{z^2+${b * b}}`,
        expected: `\\frac{\\pi}{${b}}${decay}\\cos(1)`,
      }
    );
  }
}
for (const a of [-2, 1, 3]) {
  contourTextbookCases.push(
    {
      id: `Dirichlet-${a}`,
      source: 'orloffPV',
      locator: `Example 1, full-line frequency variation a=${a}`,
      family: 'removable real-axis singularity',
      integrand: `\\frac{\\sin(${a}z)}{z}`,
      contour: line,
      expected: `${Math.sign(a)}\\pi`,
    },
    {
      id: `PV-shift-${a}`,
      source: 'orloffPV',
      locator: `Principal-value definition, Fourier indentation variation a=${a}`,
      family: 'principal value with shifted pole',
      integrand: `\\frac{\\cos(${a}z)}{z-1}`,
      contour: { kind: 'real-line', principalValue: true },
      expected: `${-Math.sign(a)}\\pi\\sin(${a})`,
    }
  );
}
for (const a of [3, 4, 5]) {
  contourTextbookCases.push({
    id: `Periodic-Poisson-${a}`,
    source: 'orloffPeriodic',
    locator: `Example 1, a=${a}`,
    family: 'periodic trigonometric substitution',
    integrand: `\\frac{1}{${1 + a * a}-${2 * a}\\cos z}`,
    bounds: ['0', '2\\pi'],
    expected: `\\frac{2\\pi}{${a * a - 1}}`,
  });
}
for (const shift of [-2, 1, 3]) {
  contourTextbookCases.push({
    id: `Rational-translation-${shift}`,
    source: 'orloffRational',
    locator: `Example 1 translated by ${shift}`,
    family: 'translation invariance on the real line',
    integrand: `\\frac{1}{(1+(z-(${shift}))^2)^2}`,
    contour: line,
    expected: '\\frac{\\pi}{2}',
  });
}
