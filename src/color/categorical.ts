//
// Named categorical palettes for data visualization.
//

// Based on Tableau 10
// Average ΔE ≈ 22–26, min 17 (green vs teal), Very good perceptual separation up to ~8 colors. After 9, spacing compresses slightly
const TYCHO_11 = [
  '#4e79a7', // Blue
  '#f28e2b', // Orange
  '#59a14f', // Green
  '#e15759', // Red
  '#b07aa1', // Purple
  '#9c755f', // Brown
  '#ff9da7', // Pink
  '#edc948', // Yellow
  '#76b7b2', // Teal
  '#6b8fd6', // Steel Blue
  '#c07bc4', // Magenta
];

const TYCHO_DARK_11 = [
  '#78a6d9', // Blue
  '#ffae54', // Orange
  '#7ddc7a', // Green
  '#ff7a7a', // Red
  '#d29be0', // Purple
  '#c49a84', // Brown
  '#ffb3bf', // Pink
  '#ffe066', // Yellow
  '#7fd6d0', // Teal
  '#8fb4ff', // Steel Blue
  '#e199eb', // Magenta
];

// More accessible palette
// A perceptually reinforced variant of TYCHO_11. It improves separability under color vision deficiency, low contrast, and projection environments while preserving tonal balance
// Adjacent ΔE (OKLab) ≥ ~22, No adjacent pair collapses below ~18 under simulated Deuteranopia
// No color below L ≈ 0.55, No color above L ≈ 0.80
const TYCHO_ROBUST_11 = [
  '#4e79a7', // Blue
  '#f28e2b', // Orange
  '#2ca58d', // Teal-shifted green (more CB-safe)
  '#d13a3c', // Stronger red
  '#b07aa1', // Purple
  '#9c755f', // Brown
  '#ff9da7', // Pink
  '#e3c13b', // Darker yellow for contrast
  '#5fb8b2', // Teal
  '#6b8fd6', // Steel Blue
  '#c07bc4', // Magenta
];

// Softer contrast, Excellent for filled areas, Good for dashboards and educational visuals, Less suitable for thin line-only plots
// Average ΔE ≈ 18–22, Reduced separation due to lower chroma, Still acceptable for up to 8 series
const TYCHO_SOFT_11 = [
  '#8fb1d4',
  '#f6b878',
  '#8ecf86',
  '#f08a8b',
  '#d3a9cc',
  '#c3a492',
  '#ffc6cc',
  '#f3e08a',
  '#a8d8d4',
  '#a9c0ea',
  '#e0b4e4',
];

// Works well on charcoal backgrounds (#121212–#1e1e1e), Suitable for both lines and filled surfaces
const TYCHO_SOFT_DARK_11 = [
  '#78a6d9',
  '#ffae54',
  '#7ddc7a',
  '#ff7a7a',
  '#d29be0',
  '#c49a84',
  '#ffb3bf',
  '#ffe066',
  '#7fd6d0',
  '#8fb4ff',
  '#e199eb',
];

// Stronger constract, Better for thin lines, More punch on dark backgrounds
// Average ΔE ≈ 26–32, Strongest separation, Best for dense line charts
const TYCHO_BOLD_11 = [
  '#2f6fb0',
  '#ff7a00',
  '#2fa23a',
  '#e02f2f',
  '#9b4db5',
  '#7f4f38',
  '#ff6f86',
  '#f2c200',
  '#2daaa3',
  '#4c79e0',
  '#b84ac6',
];

// More energetic, better for thin strokes
// Average ΔE ≈ 24–28, Good separation on dark UI, Strongest structural consistency overall
const TYCHO_BOLD_DARK_11 = [
  '#4f93ff',
  '#ff8c1a',
  '#33c94a',
  '#ff4f4f',
  '#b86bff',
  '#a86a4a',
  '#ff7f9e',
  '#ffd400',
  '#2ec9c1',
  '#6f9bff',
  '#cc5bd9',
];

const MATHEMATICA_10 = [
  '#5E81B5',
  '#E19C24',
  '#8FB131',
  '#EB6235',
  '#8778B3',
  '#C56E1A',
  '#5E9EC9',
  '#B23A3A',
  '#4C9F70',
  '#C979B7',
];

// Tableau 10: https://www.tableau.com/blog/colors-upgrade-tableau-10-56782
// Also default palette in Matplotlib
const TABLEAU_10 = [
  '#1f77b4', // Blue
  '#ff7f0e', // Orange
  '#2ca02c', // Green
  '#d62728', // Red
  '#9467bd', // Purple
  '#8c564b', // Brown
  '#e377c2', // Pink
  '#7f7f7f', // Gray
  '#bcbd22', // Olive
  '#17becf', // Cyan
];

// Apple System Palette (light theme)
const CUPERTINO_10 = [
  '#007AFF',
  '#FF9500',
  '#34C759',
  '#FF3B30',
  '#AF52DE',
  '#FF2D55',
  '#30B0C7',
  '#5856D6',
  '#A2845E',
  '#32ADE6',
  '#00C7BE',
];

// Apple System Palette (dark theme)
const CUPERTINO_DARK_10 = [
  '#0A84FF',
  '#FF9F0A',
  '#30D158',
  '#FF453A',
  '#BF5AF2',
  '#FF375F',
  '#40C8E0',
  '#5E5CE6',
  '#AC8E68',
  '#64D2FF',
  '#00D1C1',
];

// https://eleanormaclure.wordpress.com/wp-content/uploads/2011/03/colour-coding.pdf
// http://www.iscc-archive.org/pdf/PC54_1724_001.pdf
const KELLY_22 = [
  '#fdfdfd', // White
  '#1d1d1d', // Black
  '#ebce2b', // Yellow
  '#702c8c', // Purple
  '#db6917', // Orange
  '#96cde6', // Light blue
  '#ba1c30', // Red
  '#c0bd7f', // Buff
  '#7f7e80', // Gray
  '#5fa641', // Green
  '#d485b2', // Purplish pink
  '#4277b6', // Blue
  '#df8461', // Yellowish pink
  '#463397', // Violet
  '#e1a11a', // Orange yellow
  '#91218c', // Purplish red
  '#e8e948', // Greenish yellow
  '#7e1510', // Reddish brown
  '#92ae31', // Yellow green
  '#6f340d', // Yellowish brown
  '#d32b1e', // Reddish orange
  '#2b3514', // Olive green
];

const SPECTRUM_12 = [
  '#4148cc',
  '#db3c80',
  '#12b5b0',
  '#ff8c14',
  '#848aff',
  '#78e16e',
  '#1e78f0',
  '#ebcd00',
  '#beeb3c',
  '#7828d2',
  '#cd5f00',
  '#00915f',
];

export const CATEGORICAL_PALETTES = {
  tycho11: TYCHO_11,
  'tycho-dark11': TYCHO_DARK_11,
  'tycho-robust11': TYCHO_ROBUST_11,
  'tycho-soft11': TYCHO_SOFT_11,
  'tycho-soft-dark11': TYCHO_SOFT_DARK_11,
  'tycho-bold11': TYCHO_BOLD_11,
  'tycho-bold-dark11': TYCHO_BOLD_DARK_11,
  tableau10: TABLEAU_10,
  kelly22: KELLY_22,
  mathematica10: MATHEMATICA_10,
  cupertino10: CUPERTINO_10,
  'cupertino-dark10': CUPERTINO_DARK_10,
  spectrum12: SPECTRUM_12,
} as const;

export type CategoricalPaletteName = keyof typeof CATEGORICAL_PALETTES;
