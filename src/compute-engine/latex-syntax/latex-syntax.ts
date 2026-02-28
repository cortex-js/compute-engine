/**
 * Standalone LaTeX <-> MathJSON parsing and serialization.
 *
 * This module provides a `LatexSyntax` class and free-standing `parse()` /
 * `serialize()` functions that operate purely on MathJSON expressions --
 * no `ComputeEngine` instance is required.
 *
 * @module latex-syntax
 */

import type { MathJsonExpression } from '../../math-json/types';
import type {
  LatexDictionaryEntry,
  LatexString,
  ParseLatexOptions,
  SerializeLatexOptions,
  DelimiterScale,
} from './types';
import { LATEX_DICTIONARY } from './dictionary/default-dictionary';
import { indexLatexDictionary } from './dictionary/definitions';
import type { IndexedLatexDictionary } from './dictionary/indexed-types';
import { parse as parseImpl } from './parse';
import { serializeLatex as serializeImpl } from './serializer';
import {
  getApplyFunctionStyle,
  getFractionStyle,
  getGroupStyle,
  getLogicStyle,
  getNumericSetStyle,
  getPowerStyle,
  getRootStyle,
} from './serializer-style';
import { BoxedType } from '../../common/type/boxed-type';

// ---------------------------------------------------------------------------
//  Public option types
// ---------------------------------------------------------------------------

/**
 * Options accepted by the {@link LatexSyntax} constructor.
 *
 * Every field is optional; sensible defaults (matching the ComputeEngine
 * defaults) are used for any field that is not provided.
 */
export interface LatexSyntaxOptions {
  /**
   * Custom LaTeX dictionary entries.  When provided, replaces the default
   * dictionary entirely.  Use {@link LATEX_DICTIONARY} as a starting point
   * if you want to extend rather than replace.
   */
  dictionary?: ReadonlyArray<Partial<LatexDictionaryEntry>>;

  // --- Number formatting (shared by parse and serialize) ---

  /** @default `"."` */
  decimalSeparator?: '.' | '{,}';

  /** @default `"\\,"` */
  digitGroupSeparator?: LatexString | [LatexString, LatexString];

  /** @default `3` */
  digitGroup?: 'lakh' | number | [number | 'lakh', number];

  // --- Parse-specific ---

  /** @default `true` */
  parseStrict?: boolean;

  /** @default `true` */
  skipSpace?: boolean;

  /** @default `"auto"` */
  parseNumbers?: 'auto' | 'rational' | 'decimal' | 'never';

  /** @default `false` */
  preserveLatex?: boolean;

  /** @default `"tight"` */
  quantifierScope?: 'tight' | 'loose';

  /** @default `"t"` */
  timeDerivativeVariable?: string;

  // --- Serialize-specific ---

  /** @default `"max"` */
  fractionalDigits?: 'auto' | 'max' | number;

  /** @default `"auto"` */
  notation?: 'auto' | 'engineering' | 'scientific' | 'adaptiveScientific';

  /** @default `[-7, 20]` */
  avoidExponentsInRange?:
    | undefined
    | null
    | [negativeExponent: number, positiveExponent: number];

  /** @default `true` */
  prettify?: boolean;
}

// ---------------------------------------------------------------------------
//  Default option builders (mirrors engine defaults but without the engine)
// ---------------------------------------------------------------------------

function defaultParseOptions(
  opts: LatexSyntaxOptions
): ParseLatexOptions {
  return {
    // NumberFormat fields
    imaginaryUnit: '\\imaginaryI',
    positiveInfinity: '\\infty',
    negativeInfinity: '-\\infty',
    notANumber: '\\operatorname{NaN}',

    decimalSeparator: opts.decimalSeparator ?? '.',
    digitGroupSeparator: opts.digitGroupSeparator ?? '\\,',
    digitGroup: opts.digitGroup ?? 3,

    exponentProduct: '\\cdot',
    beginExponentMarker: '10^{',
    endExponentMarker: '}',

    truncationMarker: '\\ldots',
    repeatingDecimal: 'auto',

    // Parse-specific fields
    strict: opts.parseStrict ?? true,
    skipSpace: opts.skipSpace ?? true,
    parseNumbers: opts.parseNumbers ?? 'auto',
    preserveLatex: opts.preserveLatex ?? false,
    quantifierScope: opts.quantifierScope ?? 'tight',
    timeDerivativeVariable: opts.timeDerivativeVariable ?? 't',

    // Callbacks -- standalone mode has no engine, so these are stubs
    getSymbolType: (_id) => BoxedType.unknown,
    hasSubscriptEvaluate: (_id) => false,
    parseUnexpectedToken: (_lhs, _parser) => null,
  };
}

function defaultSerializeOptions(
  opts: LatexSyntaxOptions
): SerializeLatexOptions {
  return {
    // NumberFormat fields
    imaginaryUnit: '\\imaginaryI',
    positiveInfinity: '\\infty',
    negativeInfinity: '-\\infty',
    notANumber: '\\operatorname{NaN}',

    decimalSeparator: opts.decimalSeparator ?? '.',
    digitGroupSeparator: opts.digitGroupSeparator ?? '\\,',
    digitGroup: opts.digitGroup ?? 3,

    exponentProduct: '\\cdot',
    beginExponentMarker: '10^{',
    endExponentMarker: '}',

    truncationMarker: '\\ldots',
    repeatingDecimal: 'vinculum',

    // NumberSerializationFormat fields
    fractionalDigits: opts.fractionalDigits ?? 'max',
    notation: opts.notation ?? 'auto',
    avoidExponentsInRange: opts.avoidExponentsInRange ?? [-7, 20],

    // SerializeLatexOptions fields
    prettify: opts.prettify ?? true,
    materialization: false,

    invisibleMultiply: '',
    invisiblePlus: '',
    multiply: '\\times',
    missingSymbol: '\\blacksquare',

    dmsFormat: false,
    angleNormalization: 'none' as const,

    // Style callbacks -- use same defaults as the engine
    applyFunctionStyle: getApplyFunctionStyle,
    groupStyle: getGroupStyle,
    rootStyle: getRootStyle,
    fractionStyle: getFractionStyle,
    logicStyle: getLogicStyle,
    powerStyle: getPowerStyle,
    numericSetStyle: getNumericSetStyle,
  };
}

// ---------------------------------------------------------------------------
//  LatexSyntax class
// ---------------------------------------------------------------------------

/**
 * A lightweight LaTeX parser/serializer that operates on raw MathJSON
 * expressions without requiring a `ComputeEngine` instance.
 *
 * ```ts
 * import { LatexSyntax } from '@cortex-js/compute-engine/latex-syntax';
 *
 * const syntax = new LatexSyntax();
 * const expr = syntax.parse('x^2 + 1');
 * const latex = syntax.serialize(['Add', ['Power', 'x', 2], 1]);
 * ```
 */
export class LatexSyntax {
  private _options: LatexSyntaxOptions;
  private _indexed: IndexedLatexDictionary | undefined;

  constructor(options?: LatexSyntaxOptions) {
    this._options = options ?? {};
  }

  /** Lazily built indexed dictionary. */
  private get indexed(): IndexedLatexDictionary {
    if (!this._indexed) {
      const dict = this._options.dictionary ?? LATEX_DICTIONARY;
      this._indexed = indexLatexDictionary(
        dict as LatexDictionaryEntry[],
        (signal) => {
          // In standalone mode, surface dictionary warnings on the console
          console.error('LatexSyntax dictionary warning:', signal);
        }
      );
    }
    return this._indexed;
  }

  /**
   * Parse a LaTeX string into a MathJSON expression.
   *
   * @param latex  The LaTeX source string
   * @param options  Per-call overrides for parse options
   * @returns The resulting MathJSON expression, or `null` if the input is
   *   empty / invalid.
   */
  parse(
    latex: string,
    options?: Partial<ParseLatexOptions>
  ): MathJsonExpression | null {
    const defaults = defaultParseOptions(this._options);
    return parseImpl(latex, this.indexed, { ...defaults, ...options });
  }

  /**
   * Serialize a MathJSON expression into a LaTeX string.
   *
   * @param expr  The MathJSON expression to serialize
   * @param options  Per-call overrides for serialize options
   * @returns The resulting LaTeX string
   */
  serialize(
    expr: MathJsonExpression,
    options?: Partial<SerializeLatexOptions>
  ): string {
    const defaults = defaultSerializeOptions(this._options);
    return serializeImpl(expr, this.indexed, { ...defaults, ...options });
  }
}

// ---------------------------------------------------------------------------
//  Lazy singleton free functions
// ---------------------------------------------------------------------------

let _defaultSyntax: LatexSyntax | null = null;

function getDefaultSyntax(): LatexSyntax {
  _defaultSyntax ??= new LatexSyntax();
  return _defaultSyntax;
}

/**
 * Parse a LaTeX string into a MathJSON expression using the default
 * dictionary and options.
 *
 * This is a convenience wrapper around `new LatexSyntax().parse()`.
 *
 * ```ts
 * import { parse } from '@cortex-js/compute-engine/latex-syntax';
 * const expr = parse('\\frac{x}{2}');
 * // => ['Divide', 'x', 2]
 * ```
 */
export function parse(latex: string): MathJsonExpression | null {
  return getDefaultSyntax().parse(latex);
}

/**
 * Serialize a MathJSON expression to LaTeX using the default dictionary
 * and options.
 *
 * This is a convenience wrapper around `new LatexSyntax().serialize()`.
 *
 * ```ts
 * import { serialize } from '@cortex-js/compute-engine/latex-syntax';
 * const latex = serialize(['Add', 'x', 1]);
 * // => 'x + 1'
 * ```
 */
export function serialize(expr: MathJsonExpression): string {
  return getDefaultSyntax().serialize(expr);
}
