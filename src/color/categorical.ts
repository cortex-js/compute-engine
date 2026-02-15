// Named categorical palettes for data visualization.
// Sources:

const TYCHO_11 = [
  '#0d80f2', // blue
  '#d7170b', // red
  '#21ba3a', // green
  '#eb4799', // magenta
  '#13a7ec', // cyan
  '#fe8a2b', // orange
  '#17cfcf', // teal
  '#a219e6', // purple
  '#ffc02b', // yellow
  '#63b215', // lime
  '#663399', // indigo
];

// Tableau 10: https://www.tableau.com/blog/colors-upgrade-tableau-10-56782
const TABLEAU_10 = [
  '#4e79a7', // Blue
  '#f28e2b', // Orange
  '#e15759', // Red
  '#76b7b2', // Teal
  '#59a14f', // Green
  '#edc948', // Yellow
  '#b07aa1', // Purple
  '#ff9da7', // Pink
  '#9c755f', // Brown
  '#bab0ac', // Gray
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

const GRAPH_6 = [
  '#2d6fb4', // Blue
  '#c84442', // Red
  '#398c46', // Green
  '#fa7d19', // Orange
  '#00beff', // Light Blue
  '#6042a6', // Purple
];

const SPECTRUM_6 = [
  '#4148cc',
  '#db3c80',
  '#12b5b0',
  '#ff8c14',
  '#848aff',
  '#78e16e',
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
  tableau10: TABLEAU_10,
  kelly22: KELLY_22,
  graph6: GRAPH_6,
  spectrum6: SPECTRUM_6,
  spectrum12: SPECTRUM_12,
} as const;

export type CategoricalPaletteName = keyof typeof CATEGORICAL_PALETTES;
