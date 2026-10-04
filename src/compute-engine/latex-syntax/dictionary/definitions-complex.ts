import { LatexDictionary, Parser, Serializer } from '../types.js';
import { MathJsonExpression } from '../../../math-json/types.js';
import { isNumberObject, nops, operand } from '../../../math-json/utils.js';
import { singleArgSerializer } from './definitions-other.js';

/**
 * The digits of a non-negative integer literal (`7`, `{num: '123456…'}`), or
 * `null` for anything else: a symbol, a sum, a negation, a decimal.
 */
function integerLiteralDigits(expr: MathJsonExpression | null): string | null {
  if (typeof expr === 'number')
    return Number.isSafeInteger(expr) && expr >= 0 ? String(expr) : null;
  if (isNumberObject(expr)) {
    const digits = String(expr.num);
    return /^\d+$/.test(digits) ? digits : null;
  }
  return null;
}

const isPositive = (digits: string): boolean => /[1-9]/.test(digits);

export const DEFINITIONS_COMPLEX: LatexDictionary = [
  {
    name: 'Real',
    kind: 'function',
    latexTrigger: ['\\Re'],
    arguments: 'implicit',
  },
  {
    name: 'Imaginary',
    kind: 'function',
    latexTrigger: ['\\Im'],
    arguments: 'implicit',
  },
  {
    name: 'Argument',
    kind: 'function',
    latexTrigger: ['\\arg'],
    arguments: 'implicit',
  },
  // Function-style alias: `\operatorname{arg}(z)`. Without it the head lexed as
  // a bare symbol, so `\operatorname{arg}(z)^2` was `arg·z²`. Call-binding
  // matches the native `\arg` command.
  {
    symbolTrigger: 'arg',
    kind: 'function',
    parse: 'Argument',
    arguments: 'implicit',
  },
  // Function-style aliases: `\operatorname{real}(z)` and
  // `\operatorname{imag}(z)`, the spellings Desmos writes for the real and
  // imaginary parts. Parse-only: `Real` and `Imaginary` keep serializing as
  // `\Re` and `\Im`.
  {
    symbolTrigger: 'real',
    kind: 'function',
    parse: 'Real',
    arguments: 'implicit',
  },
  {
    symbolTrigger: 'imag',
    kind: 'function',
    parse: 'Imaginary',
    arguments: 'implicit',
  },
  // The complex conjugate is written `\overline{z}`, and `\overline{…}` reads
  // as the conjugate. `z^\star` is the conjugate transpose
  // (`ConjugateTranspose`, `definitions-linear-algebra.ts`), which is the
  // conjugate for a scalar or a vector; `Conjugate` used to serialize as
  // `z^\star` as well, so it did not survive a round trip through LaTeX.
  {
    name: 'Conjugate',
    latexTrigger: ['\\overline'],
    parse: (parser: Parser): MathJsonExpression => {
      const arg = parser.parseGroup();
      if (arg === null) return ['Conjugate'];

      // `\overline{k}_{n}` with integer literals `k` and `n ≥ 1` is the
      // residue class of `k` mod `n`. Anything else keeps the conjugate:
      // `\overline{7}` and `\overline{z}_1` are not classes, and the
      // subscript is left for the subscript parselet.
      if (integerLiteralDigits(arg) !== null) {
        const start = parser.index;
        // Spaces are allowed before the `_` and before the modulus:
        // `\overline{3} _ 5` is `\overline{3}_{5}`.
        parser.skipSpace();
        if (parser.match('_')) {
          parser.skipSpace();
          const modulus = parser.parseGroup() ?? parser.parseToken();
          const digits = integerLiteralDigits(modulus);
          if (digits !== null && isPositive(digits))
            return ['ResidueClass', arg, modulus!];
        }
        parser.index = start;
      }
      return ['Conjugate', arg];
    },
    serialize: singleArgSerializer('\\overline'),
  },
  // `ResidueClass(k, n)` is written `\overline{k}_{n}` when it has exactly
  // two operands and both are integer literals, the only form that reads
  // back as a class; otherwise it is written as a function call, so that a
  // third operand and its arity error are kept (`ResidueClass(2, 5, 99)`).
  {
    name: 'ResidueClass',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const k = integerLiteralDigits(operand(expr, 1));
      const n = integerLiteralDigits(operand(expr, 2));
      if (nops(expr) !== 2 || k === null || n === null || !isPositive(n))
        return serializer.serializeFunction(expr);
      return `\\overline{${k}}_{${n}}`;
    },
  },
  // Function-style alias: `\operatorname{conj}(z)`, the spelling Desmos writes
  // for the complex conjugate. Without it `conj` lexed as an undeclared symbol:
  // `\operatorname{conj}(z)` was the product `conj·z`, and over a list argument
  // it was an unknown function, which does not broadcast. Parse-only:
  // `Conjugate` serializes as `\overline{z}`.
  {
    symbolTrigger: 'conj',
    kind: 'function',
    parse: 'Conjugate',
    arguments: 'implicit',
  },
];
