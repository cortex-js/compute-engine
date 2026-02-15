import type { Color } from './types';
import { asColorNumber, asRgb } from './conversion';

/**
 * APCA contrast calculation using Color objects.
 *
 * Return the contrast value (positive for dark text on light background, negative for light text on dark background)
 */
export function apca(bgColor: Color, fgColor: Color): number {
  // APCA calculations are done in sRGB color space
  const bgRgb = asRgb(bgColor);
  const fgRgb = asRgb(fgColor);

  // exponents
  const normBG = 0.56;
  const normTXT = 0.57;
  const revTXT = 0.62;
  const revBG = 0.65;

  // clamps
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  const loClip = 0.1;
  const deltaYmin = 0.0005;

  // scalers
  // see https://github.com/w3c/silver/issues/645
  const scaleBoW = 1.14;
  const loBoWoffset = 0.027;
  const scaleWoB = 1.14;
  const loWoBoffset = 0.027;

  function fclamp(Y: number) {
    return Y >= blkThrs ? Y : Y + (blkThrs - Y) ** blkClmp;
  }

  function linearize(val: number) {
    const sign = val < 0 ? -1 : 1;
    return sign * Math.pow(Math.abs(val), 2.4);
  }

  // Calculates "screen luminance" with non-standard simple gamma EOTF
  // weights should be from CSS Color 4, not the ones here which are via Myndex and copied from Lindbloom
  const Yfg = fclamp(
    linearize(fgRgb.r / 255) * 0.2126729 +
      linearize(fgRgb.g / 255) * 0.7151522 +
      linearize(fgRgb.b / 255) * 0.072175
  );

  const Ybg = fclamp(
    linearize(bgRgb.r / 255) * 0.2126729 +
      linearize(bgRgb.g / 255) * 0.7151522 +
      linearize(bgRgb.b / 255) * 0.072175
  );

  let S: number, C: number;

  if (Math.abs(Ybg - Yfg) < deltaYmin) C = 0;
  else {
    if (Ybg > Yfg) {
      // dark foreground on light background
      S = Ybg ** normBG - Yfg ** normTXT;
      C = S * scaleBoW;
    } else {
      // light foreground on dark background
      S = Ybg ** revBG - Yfg ** revTXT;
      C = S * scaleWoB;
    }
  }
  if (Math.abs(C) < loClip) return 0;

  if (C > 0) return C - loWoBoffset;
  return C + loBoWoffset;
}

/**
 * Choose the foreground color with better contrast against the background
 * Returns the color (as rgba number) that provides better APCA contrast
 */
export function contrastingColor(
  arg:
    | {
        bg: Color;
        fg1: Color;
        fg2: Color;
      }
    | Color
    | number
): number {
  let bg: Color, fg1: Color, fg2: Color;
  if (typeof arg !== 'object' || !('bg' in arg)) {
    bg = asRgb(arg);
    fg1 = '#ffffff';
    fg2 = '#000000';
  } else {
    bg = arg.bg;
    fg1 = arg.fg1;
    fg2 = arg.fg2;
  }
  // Calculate APCA contrast for both foreground options
  const contrast1 = Math.abs(apca(fg1, bg));
  const contrast2 = Math.abs(apca(fg2, bg));

  // Return the foreground color with higher absolute contrast
  return contrast1 >= contrast2 ? asColorNumber(fg1) : asColorNumber(fg2);
}
