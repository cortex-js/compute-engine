/** Named design color identifiers shared by foreground and background scales. */
export type DesignColorName = keyof typeof BACKGROUND_COLORS;

// Colors from Chromatic 100 design scale
export const BACKGROUND_COLORS = {
  'red': '#fbbbb6',
  'orange': '#ffe0c2',
  'yellow': '#fff1c2',
  'lime': '#d0e8b9',
  'green': '#bceac4',
  'teal': '#b9f1f1',
  'cyan': '#b8e5c9',
  'blue': '#b6d9fb',
  'indigo': '#d1c2f0',
  'purple': '#e3baf8',
  'magenta': '#f9c8e0',
  'black': '#353535',
  'dark-grey': '#8C8C8C',
  'grey': '#D0D0D0',
  'light-grey': '#F0F0F0',
  'white': '#ffffff',
} as const;

// Colors from Chromatic 500 (and 600, 700) design scale
export const FOREGROUND_COLORS = {
  'red': '#d7170b', //<- 700, 500 ->'#f21c0d'
  'orange': '#fe8a2b',
  'yellow': '#ffc02b', // <- 600, 500 -> '#ffcf33',
  'lime': '#63b215',
  'green': '#21ba3a',
  'teal': '#17cfcf',
  'cyan': '#13a7ec',
  'blue': '#0d80f2',
  'indigo': '#63c',
  'purple': '#a219e6',
  'magenta': '#eb4799',
  'black': '#000',
  'dark-grey': '#666',
  'grey': '#A6A6A6',
  'light-grey': '#d4d5d2',
  'white': '#ffffff',
};

export const NAMED_COLORS = {
  'red': '#d7170b', //<- 700, 500 ->'#f21c0d'
  'orange': '#fe8a2b',
  'yellow': '#ffc02b', // <- 600, 500 -> '#ffcf33',
  'lime': '#63b215',
  'green': '#21ba3a',
  'teal': '#17cfcf',
  'cyan': '#13a7ec',
  'blue': '#0d80f2',
  'indigo': '#63c',
  'purple': '#a219e6',
  'magenta': '#eb4799',
  'brown': '#8c564b',
  'olive': '#8a8f2a',
  'midnight': '#2c4670',
  'sky': '#d2dce9',
  'black': '#000',
  'white': '#ffffff',
  'carbon': '#111111', // near-black, high-contrast text
  'charcoal': '#333333', // primary axis / label color
  'slate': '#555555', // secondary text, major gridlines
  'dark-grey': '#666',
  'graphite': '#777777', // minor gridlines
  'stone': '#999999', // de-emphasized strokes
  'grey': '#A6A6A6',
  'light-grey': '#d4d5d2',
  'ash': '#E6E6E6', // subtle fills, light strokes
  'mist': '#F3F3F3', // light background tint
  'snow': '#FFFFFF', // pure white
} as const;
