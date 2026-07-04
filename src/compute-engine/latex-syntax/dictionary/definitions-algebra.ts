import type { LatexDictionary } from '../types';

export const DEFINITIONS_ALGEBRA: LatexDictionary = [
  {
    name: 'To',
    latexTrigger: ['\\to'],
    kind: 'infix',
    precedence: 270, // MathML rightwards arrow
  },
  {
    // `\rightarrow` is the mapping arrow, same as `\to` (`f: A \rightarrow B`).
    // It previously parsed to `Implies`; use `\Rightarrow`/`\implies` for
    // implication. Parse-only alias: serialization of `To` stays `\to`.
    latexTrigger: ['\\rightarrow'],
    kind: 'infix',
    precedence: 270,
    parse: 'To',
  },
  {
    // Non-strict mode: -> for maps-to arrow
    latexTrigger: ['-', '>'],
    kind: 'infix',
    precedence: 270,
    parse: (parser, lhs, until) => {
      if (parser.options.strict !== false) return null;
      const rhs = parser.parseExpression({ ...until, minPrec: 270 });
      if (rhs === null) return null;
      return ['To', lhs, rhs];
    },
  },
];
