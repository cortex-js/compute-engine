import { MathJsonExpression } from '../../../math-json/types.js';
import { operand } from '../../../math-json/utils.js';
import {
  ExpressionParseHandler,
  LatexDictionary,
  MULTIPLICATION_PRECEDENCE,
  Parser,
  Serializer,
  Terminator,
} from '../types.js';
import { PIPE_TOPIC_MARKER } from './definitions-core.js';

/**
 * Trigonometric functions have some special conventions that require a
 * custom parser: they can be followed by a "-1" superscript indicating
 * that the inversion function should be used, i.e. "\sin^{-1}" for "arcsin".
 *
 */
function parseTrig(op: string): ExpressionParseHandler {
  return (parser: Parser, until?: Terminator): MathJsonExpression | null => {
    // Note: names as per NIST-DLMF
    const trigCommands: Record<string, MathJsonExpression> = {
      '\\arcsin': 'Arcsin',
      '\\arccos': 'Arccos',
      '\\arctan': 'Arctan',
      '\\arctg': 'Arctan',
      '\\arcctg': 'Arccot',
      '\\arcsec': 'Arcsec', // Non-standard
      '\\arccsc': 'Arccsc', // Non-standard
      // Inverse hyperbolic functions use ISO 80000-2 standard names (ar- prefix)
      // We accept both ar- (standard) and arc- (common) spellings
      '\\arsinh': 'Arsinh',
      '\\arcsinh': 'Arsinh',
      '\\arcosh': 'Arcosh',
      '\\arccosh': 'Arcosh',
      '\\artanh': 'Artanh',
      '\\arctanh': 'Artanh',
      '\\arsech': 'Arsech',
      '\\arcsech': 'Arsech',
      '\\arcsch': 'Arcsch',
      '\\arccsch': 'Arcsch',
      '\\arcoth': 'Arcoth',
      '\\arccoth': 'Arcoth',

      '\\ch': 'Cosh', // Non-standard

      '\\cos': 'Cos',

      '\\cosh': 'Cosh',

      '\\cosec': 'Csc', // Non-standard

      '\\cot': 'Cot',
      '\\cotg': 'Cot', // Non-standard
      '\\ctg': 'Cot', // Non-standard

      '\\csc': 'Csc',

      '\\csch': 'Csch', // Non-standard

      '\\coth': 'Coth',
      '\\cth': 'Coth', // Non-standard

      '\\sec': 'Sec',

      '\\sech': 'Sech', // Non-standard

      '\\sin': 'Sin',

      '\\sinh': 'Sinh',
      '\\sh': 'Sinh', // Non-standard

      '\\tan': 'Tan',
      '\\tg': 'Tan', // Non-standard

      '\\tanh': 'Tanh',
      '\\th': 'Tanh', // Non-standard
    };
    const operator: MathJsonExpression = trigCommands[op ?? ''] ?? op ?? '';

    if (parser.atTerminator(until)) return operator;

    // Check for \sin' x, \sin^{-1} x, etc.
    let fn: MathJsonExpression | null = operator;
    do {
      const pf = parser.parsePostfixOperator(fn, until);
      if (pf === null) break;
      fn = pf;
    } while (true);

    parser.skipSpace();

    // Check for \sin^2 x
    let sup: MathJsonExpression | null = null;
    if (parser.match('^')) sup = parser.parseGroup() ?? parser.parseToken();

    parser.skipSpace();

    // Look for an implicit argument (a product of terms) but stop if another
    // trig function is encountered, i.e. ensure that
    // "\cos a \sin b" is parsed as "(\cos a)(\sin b)" and not "\cos (a \sin b)"
    let args = parser.parseArguments('implicit', {
      minPrec: MULTIPLICATION_PRECEDENCE,
      condition: (parser) =>
        trigCommands[parser.peek] !== undefined ||
        (until?.condition?.(parser) ?? false),
    });

    // A superscript but no argument (`\cos^2`): the topic marker `\square`
    // stands in for the argument, so a pipeline can fill it
    // (`x |> \cos^2` → cos²x); standalone it displays as `\cos(\square)^2`.
    if (args === null && sup !== null) args = [PIPE_TOPIC_MARKER];

    // Desmos compatibility: `\arctan(y, x)` and `\tan^{-1}(y, x)` are
    // both 2-arg atan2. We must lower to Arctan2 here, before the operator
    // is resolved: by the time `['InverseFunction', 'Tan']` becomes
    // `Arctan`, the 2-argument call would be treated as an arity error.
    // No other inverse trig has a 2-arg variant, so this is Tan-only.
    const isTwoArgArctan =
      args?.length === 2 &&
      (fn === 'Arctan' ||
        (Array.isArray(fn) && fn[0] === 'InverseFunction' && fn[1] === 'Tan'));
    const head = isTwoArgArctan ? 'Arctan2' : fn;

    const appliedFn: MathJsonExpression =
      args === null
        ? fn
        : typeof head === 'string'
          ? [head, ...args]
          : ['Apply', head, ...args];

    return sup === null ? appliedFn : ['Power', appliedFn, sup];
  };
}

export const DEFINITIONS_TRIGONOMETRY: LatexDictionary = [
  {
    name: 'Arcsin',
    latexTrigger: ['\\arcsin'],

    parse: parseTrig('Arcsin'),
  },
  {
    name: 'Arccos',
    latexTrigger: ['\\arccos'],

    parse: parseTrig('Arccos'),
  },
  {
    name: 'Arctan',
    latexTrigger: ['\\arctan'],

    parse: parseTrig('Arctan'),
  },
  {
    // Two-argument arctangent (atan2). It has no `latexTrigger`/`parse` of its
    // own — a 2-arg `\arctan(y, x)` is lowered to `Arctan2` by `parseTrig`
    // (the Desmos-compatibility branch above). This entry exists only to
    // serialize `Arctan2` back to that round-tripping `\arctan(y, x)` form.
    // Without it the default operator serializer emits `\mathrm{Arctan_2}`,
    // which re-parses as a DISTINCT symbol (`Arctan` subscript `2`) that no
    // compilation target recognizes.
    name: 'Arctan2',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      `\\arctan(${serializer.serialize(operand(expr, 1))}, ${serializer.serialize(operand(expr, 2))})`,
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arctg'],
    parse: parseTrig('Arctan'),
  },
  {
    // Variant, symbol
    symbolTrigger: 'arctg',
    parse: parseTrig('Arctan'),
  },
  {
    name: 'Arccot',
    symbolTrigger: 'arcctg',
    parse: parseTrig('Arccot'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arcctg'],
    parse: parseTrig('Arccot'),
  },
  {
    name: 'Arcoth',
    symbolTrigger: 'arcoth',
    parse: parseTrig('Arcoth'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arccoth',
    parse: parseTrig('Arcoth'),
  },
  {
    // Accept variant with LaTeX command
    latexTrigger: ['\\arcoth'],
    parse: parseTrig('Arcoth'),
  },
  {
    // Accept variant with `arc-` prefix LaTeX command
    latexTrigger: ['\\arccoth'],
    parse: parseTrig('Arcoth'),
  },
  {
    name: 'Arcsec',
    symbolTrigger: 'arcsec',

    parse: parseTrig('Arcsec'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arcsec'],

    parse: parseTrig('Arcsec'),
  },
  {
    name: 'Arccsc',
    symbolTrigger: 'arccsc',

    parse: parseTrig('Arccsc'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arccsc'],

    parse: parseTrig('Arccsc'),
  },
  {
    name: 'Arsinh',
    symbolTrigger: 'arsinh',
    parse: parseTrig('Arsinh'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arcsinh',
    parse: parseTrig('Arsinh'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: ['\\arsinh'],
    parse: parseTrig('Arsinh'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arcsinh'],
    parse: parseTrig('Arsinh'),
  },
  {
    name: 'Arcosh',
    symbolTrigger: 'arcosh',
    parse: parseTrig('Arcosh'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arccosh',
    parse: parseTrig('Arcosh'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: '\\arcosh',
    parse: parseTrig('Arcosh'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: '\\arccosh',
    parse: parseTrig('Arcosh'),
  },
  {
    name: 'Artanh',
    symbolTrigger: 'artanh',
    parse: parseTrig('Artanh'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arctanh',
    parse: parseTrig('Artanh'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: '\\artanh',
    parse: parseTrig('Artanh'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arctanh'],
    parse: parseTrig('Artanh'),
  },
  {
    name: 'Arsech',
    symbolTrigger: 'arsech',
    parse: parseTrig('Arsech'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arcsech',
    parse: parseTrig('Arsech'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: ['\\arsech'],
    parse: parseTrig('Arsech'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arcsech'],
    parse: parseTrig('Arsech'),
  },
  {
    name: 'Arcsch',
    symbolTrigger: 'arcsch',
    parse: parseTrig('Arcsch'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arccsch',
    parse: parseTrig('Arcsch'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: ['\\arcsch'],
    parse: parseTrig('Arcsch'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arccsch'],
    parse: parseTrig('Arcsch'),
  },
  {
    name: 'Cosec',
    symbolTrigger: 'cosec',

    parse: parseTrig('Cosec'),
  },
  {
    // Variant with non-standard command
    latexTrigger: ['\\cosec'],

    parse: parseTrig('Cosec'),
  },
  {
    name: 'Cosh',
    latexTrigger: ['\\cosh'],

    parse: parseTrig('Cosh'),
  },
  {
    // Rusian hyperbolic cosine
    latexTrigger: ['\\ch'],

    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cot',
    latexTrigger: ['\\cot'],

    parse: parseTrig('Cot'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\cotg'],
    parse: parseTrig('Cot'),
  },
  {
    // Rusian cotangent
    latexTrigger: ['\\ctg'],

    parse: parseTrig('Cot'),
  },
  {
    name: 'Csc',
    latexTrigger: ['\\csc'],

    parse: parseTrig('Csc'),
  },
  {
    name: 'Csch',
    latexTrigger: ['\\csch'],

    parse: parseTrig('Csch'),
  },
  {
    // Variant: `\operatorname{csch}` (mirrors the `sech` symbol trigger)
    symbolTrigger: 'csch',
    parse: parseTrig('Csch'),
  },
  {
    name: 'Coth',
    latexTrigger: ['\\coth'],
    parse: parseTrig('Coth'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\cth'],
    parse: parseTrig('Coth'),
  },
  {
    // Variant
    symbolTrigger: 'cth',
    parse: parseTrig('Coth'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\coth'],
    parse: parseTrig('Coth'),
  },
  {
    name: 'Sec',
    latexTrigger: ['\\sec'],

    parse: parseTrig('Sec'),
  },
  {
    name: 'Sech',
    symbolTrigger: 'sech',
    parse: parseTrig('Sech'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\sech'],
    parse: parseTrig('Sech'),
  },
  {
    name: 'Sinh',
    latexTrigger: ['\\sinh'],

    parse: parseTrig('Sinh'),
  },
  {
    // Russian variant
    latexTrigger: ['\\sh'],

    parse: parseTrig('Sinh'),
  },
  {
    name: 'Tan',
    latexTrigger: ['\\tan'],

    parse: parseTrig('Tan'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\tg'],

    parse: parseTrig('Tan'),
  },
  {
    name: 'Tanh',
    latexTrigger: ['\\tanh'],

    parse: parseTrig('Tanh'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\th'],

    parse: parseTrig('Tanh'),
  },

  {
    name: 'Cos',
    latexTrigger: ['\\cos'],

    parse: parseTrig('Cos'),
  },
  {
    name: 'Sin',
    latexTrigger: ['\\sin'],

    parse: parseTrig('Sin'),
  },
  {
    name: 'Sinc',
    symbolTrigger: 'sinc',
    kind: 'function',
  },
  {
    name: 'FresnelS',
    symbolTrigger: 'FresnelS',
    kind: 'function',
  },
  {
    name: 'FresnelC',
    symbolTrigger: 'FresnelC',
    kind: 'function',
  },

  // Function-style aliases for the spelled-out lowercase names of the
  // natively-commanded trig functions: `\operatorname{sin}(x)`,
  // `\operatorname{arctan}(x)`, etc. Without these the head lexed as a bare
  // symbol, so `\operatorname{sin}(x)^2` parsed as `sin·x²` and
  // `-\operatorname{sin}(x)` negated the symbol — silently wrong. Reusing
  // `parseTrig` gives call-binding identical to the native `\sin` command
  // (prefix minus binds after the call, postfix power applies to the call
  // result, `^{-1}`/`^2` and implicit arguments all behave the same). These
  // mirror the `arsinh`/`sech`/`csch` symbol-trigger aliases above; the `ar-`/
  // `arc-` inverse-hyperbolic spellings are already covered there, so only the
  // short `a-` forms (`asinh`, …) are added here.
  { symbolTrigger: 'sin', parse: parseTrig('Sin') },
  { symbolTrigger: 'cos', parse: parseTrig('Cos') },
  { symbolTrigger: 'tan', parse: parseTrig('Tan') },
  { symbolTrigger: 'sec', parse: parseTrig('Sec') },
  { symbolTrigger: 'csc', parse: parseTrig('Csc') },
  { symbolTrigger: 'cot', parse: parseTrig('Cot') },
  { symbolTrigger: 'sinh', parse: parseTrig('Sinh') },
  { symbolTrigger: 'cosh', parse: parseTrig('Cosh') },
  { symbolTrigger: 'tanh', parse: parseTrig('Tanh') },
  { symbolTrigger: 'coth', parse: parseTrig('Coth') },
  { symbolTrigger: 'arcsin', parse: parseTrig('Arcsin') },
  { symbolTrigger: 'asin', parse: parseTrig('Arcsin') },
  { symbolTrigger: 'arccos', parse: parseTrig('Arccos') },
  { symbolTrigger: 'acos', parse: parseTrig('Arccos') },
  { symbolTrigger: 'arctan', parse: parseTrig('Arctan') },
  { symbolTrigger: 'atan', parse: parseTrig('Arctan') },
  { symbolTrigger: 'asinh', parse: parseTrig('Arsinh') },
  { symbolTrigger: 'acosh', parse: parseTrig('Arcosh') },
  { symbolTrigger: 'atanh', parse: parseTrig('Artanh') },
];
