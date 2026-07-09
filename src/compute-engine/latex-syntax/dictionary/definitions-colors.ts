import type { LatexDictionary } from '../types.js';

/**
 * LaTeX dictionary for color constructors and conversions.
 *
 * Constructors preserve their colorspace on evaluation; the head is the
 * discriminator. A `Color` value type may be introduced later — for now
 * each constructor returns a tuple-shaped value and downstream code
 * branches on the operator name.
 */
export const DEFINITIONS_COLORS: LatexDictionary = [
  // Color constructors (one per colorspace, preserves space on evaluation)
  {
    name: 'Rgb',
    latexTrigger: ['\\operatorname{rgb}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{rgb}' + serializer.wrapArguments(expr),
  },
  {
    name: 'Hsv',
    latexTrigger: ['\\operatorname{hsv}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{hsv}' + serializer.wrapArguments(expr),
  },
  {
    name: 'Hsl',
    latexTrigger: ['\\operatorname{hsl}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{hsl}' + serializer.wrapArguments(expr),
  },
  {
    name: 'Oklab',
    latexTrigger: ['\\operatorname{oklab}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{oklab}' + serializer.wrapArguments(expr),
  },
  {
    name: 'Oklch',
    latexTrigger: ['\\operatorname{oklch}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{oklch}' + serializer.wrapArguments(expr),
  },

  // Conversion functions (color → color in the named space)
  {
    name: 'AsRgb',
    latexTrigger: ['\\operatorname{asRgb}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{asRgb}' + serializer.wrapArguments(expr),
  },
  {
    name: 'AsHsv',
    latexTrigger: ['\\operatorname{asHsv}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{asHsv}' + serializer.wrapArguments(expr),
  },
  {
    name: 'AsHsl',
    latexTrigger: ['\\operatorname{asHsl}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{asHsl}' + serializer.wrapArguments(expr),
  },
  {
    name: 'AsOklab',
    latexTrigger: ['\\operatorname{asOklab}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{asOklab}' + serializer.wrapArguments(expr),
  },
  {
    name: 'AsOklch',
    latexTrigger: ['\\operatorname{asOklch}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{asOklch}' + serializer.wrapArguments(expr),
  },

  // Perceptual difference (returns a scalar in [0, ~1])
  {
    name: 'ColorDelta',
    latexTrigger: ['\\operatorname{colorDelta}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{colorDelta}' + serializer.wrapArguments(expr),
  },
];
