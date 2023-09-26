export const RESET = '\x1b[0m';

export const BLACK = '\x1b[30;1m${s}';
export const GREY = '\x1b[30;1m${s}';
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

export const GREY_BG = '\x1b[40;1m';

// Note: The Chrome Console supports RGB
// styling with 38;2;r;g;b (foreground) and 48;2;r;g;b (background)
