// Reset removes all colors and previous styles
export const RESET = '\x1b[0m';

export const DEFAULT_COLOR = '\x1b[39m';
export const DEFAULT_BG = '\x1b[49m';

export const WHITE_BG = '\x1b[47m';
export const BLACK_BG = '\x1b[40m';
export const GREY_BG = '\x1b[100m'; // grey + bright
export const GREEN_BG = '\x1b[42m';
export const RED_BG = '\x1b[41m';
export const YELLOW_BG = '\x1b[43m';
export const BLUE_BG = '\x1b[44m';
export const MAGENTA_BG = '\x1b[45m';
export const CYAN_BG = '\x1b[46m';

export const WHITE = '\x1b[37;1m';
export const BLACK = '\x1b[30;1m';
export const GREY = '\x1b[30;1m'; // grey + bold
export const GREEN = '\x1b[32;1m';
export const RED = '\x1b[31;1m';
export const YELLOW = '\x1b[33m';
export const BLUE = '\x1b[34;1m';
export const MAGENTA = '\x1b[35;1m';
export const CYAN = '\x1b[36;1m'; // cyan + bold

export const INVERSE_RED = '\x1b[101;97m'; // bright white on bright red
export const INVERSE_GREEN = '\x1b[102;97m'; // bright white on bright green
export const INVERSE_YELLOW = '\x1b[103;97m'; // bright white on bright yellow
export const INVERSE_BLUE = '\x1b[104;97m'; // bright white on bright blue

export const BOLD = '\x1b[1m';
export const BOLD_OFF = '\x1b[22m';
export const DIM = '\x1b[2m';
export const DIM_OFF = '\x1b[22m';
export const ITALIC = '\x1b[3m';
export const ITALIC_OFF = '\x1b[23m';
export const UNDERLINE = '\x1b[4m';
export const UNDERLINE_OFF = '\x1b[24m';
export const BLINK = '\x1b[5m';
export const BLINK_OFF = '\x1b[25m';
export const INVERSE = '\x1b[7m';
export const INVERSE_OFF = '\x1b[27m';
export const HIDDEN = '\x1b[8m';
export const HIDDEN_OFF = '\x1b[28m';

/*
SOLARIZED HEX     16/8 TERMCOL  XTERM/HEX   L*A*B      RGB         HSB
--------- ------- ---- -------  ----------- ---------- ----------- -----------
base03    #002b36  8/4 brblack  234 #1c1c1c 15 -12 -12   0  43  54 193 100  21
base02    #073642  0/4 black    235 #262626 20 -12 -12   7  54  66 192  90  26
base01    #586e75 10/7 brgreen  240 #585858 45 -07 -07  88 110 117 194  25  46
base00    #657b83 11/7 bryellow 241 #626262 50 -07 -07 101 123 131 195  23  51
base0     #839496 12/6 brblue   244 #808080 60 -06 -03 131 148 150 186  13  59
base1     #93a1a1 14/4 brcyan   245 #8a8a8a 65 -05 -02 147 161 161 180   9  63
base2     #eee8d5  7/7 white    254 #e4e4e4 92 -00  10 238 232 213  44  11  93
base3     #fdf6e3 15/7 brwhite  230 #ffffd7 97  00  10 253 246 227  44  10  99
yellow    #b58900  3/3 yellow   136 #af8700 60  10  65 181 137   0  45 100  71
orange    #cb4b16  9/3 brred    166 #d75f00 50  50  55 203  75  22  18  89  80
red       #dc322f  1/1 red      160 #d70000 50  65  45 220  50  47   1  79  86
magenta   #d33682  5/5 magenta  125 #af005f 50  65 -05 211  54 130 331  74  83
violet    #6c71c4 13/5 brmagenta 61 #5f5faf 50  15 -45 108 113 196 237  45  77
blue      #268bd2  4/4 blue      33 #0087ff 55 -10 -45  38 139 210 205  82  82
cyan      #2aa198  6/6 cyan      37 #00afaf 60 -35 -05  42 161 152 175  74  63
green     #859900  2/2 green     64 #5f8700 60 -20  65 133 153   0  68 100  60
*/

/* Oceanic Next

  let s:base00 = ['#1b2b34', '235']
  let s:base01 = ['#343d46', '237']
  let s:base02 = ['#4f5b66', '240']
  let s:base03 = ['#65737e', '243']
  let s:base04 = ['#a7adba', '145']
  let s:base05 = ['#c0c5ce', '251']
  let s:base06 = ['#cdd3de', '252']
  let s:base07 = ['#d8dee9', '253']
  let s:red    = ['#ec5f67', '203']
  let s:orange = ['#f99157', '209']
  let s:yellow = ['#fac863', '221']
  let s:green  = ['#99c794', '114']
  let s:cyan   = ['#62b3b2', '73']
  let s:blue   = ['#6699cc', '68']
  let s:purple = ['#c594c5', '176']
  let s:brown  = ['#ab7967', '137']
  let s:white  = ['#ffffff', '15']
*/

const TERMINAL_COLORS = {
  'black': 0,
  'red': 1,
  'green': 2,
  'yellow': 3,
  'blue': 4,
  'magenta': 5,
  'cyan': 6,
  'white': 7,
  'grey': 8,
  'gray': 8,
  'bright-red': 9,
  'bright-green': 10,
  'bright-yellow': 11,
  'bright-blue': 12,
  'bright-magenta': 13,
  'bright-cyan': 14,
  'bright-white': 15,
};

// The Ubuntu terminal color palette
// https://oatcookies.neocities.org/ubuntu-terminal-colors
// Works well on dark and light backgrounds
const COLOR_PALETTE = {
  'black': '#2E3436',
  'red': '#ff0000', // crimson
  'green': '#4E9A06', // forest
  'yellow': '#C4A000', // mustard
  // 'orange': '#CE5C00', // burnt orange
  'blue': '#3465A4', // azure
  'magenta': '#75507B', // lavender/purple
  // 'purple': '#5C3566', // plum
  'cyan': '#06989A',
  'white': '#D3D7CF',
  'grey': '#555753',
  'gray': '#555753',
  'bright-red': '#EF2929', // ruby
  'bright-green': '#8AE234', // lime
  'bright-yellow': '#FCE94F', // lemon
  // 'bright-orange': '#FCAF3E', // tangerine
  'bright-blue': '#729FCF', // sky
  'bright-magenta': '#AD7FA8', // orchid
  // 'bright-purple': '#75507B', // grape
  'bright-cyan': '#34E2E2',
  'bright-white': '#EEEEEC',
};

function rgbAnsi(color: string): number[] {
  const hexCode = COLOR_PALETTE[color];

  if (hexCode === undefined) return [];

  let rgb: number[] = [];
  // Split the hex color strings with the format "#rrggbb" into an array of three hex numbers
  let rgbArray = hexCode.match(/#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
  if (rgbArray !== null) {
    rgb = rgbArray.slice(1).map((x) => parseInt(x, 16));
  } else {
    rgbArray = hexCode.match(/#([\da-f])([\da-f])([\da-f])/i);
    rgb = rgbArray.slice(1).map((x) => 16 * parseInt(x, 16));
  }

  return rgb;
}

export function ansiFgColor(
  color: string | number,
  mode: 'none' | 'basic' | 'full'
): number[] {
  if (mode === 'none') return [];
  if (color === 'default') return [39];
  if (mode === 'basic') {
    const code = typeof color === 'string' ? TERMINAL_COLORS[color] : color;
    if (code === undefined) return [];
    if (code < 8) return [30 + code];
    return [90 + code - 8];
  }

  // If color is a number, get the color name from the index
  if (typeof color === 'number') {
    const keys = Object.keys(TERMINAL_COLORS);
    color = keys[color];
  }

  return [38, 2, ...rgbAnsi(color)];
}

export function ansiBgColor(
  color: string,
  mode: 'none' | 'basic' | 'full'
): number[] {
  if (mode === 'none') return [];

  if (color === 'default') return [49];
  if (mode === 'basic') {
    const code = TERMINAL_COLORS[color];
    if (code === undefined) return [];
    if (code < 8) return [40 + code];
    return [100 + code - 8];
  }

  return [48, 2, ...rgbAnsi(color)];
}
