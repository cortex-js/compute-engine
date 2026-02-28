import {
  ComputeEngine,
  LatexSyntax,
  LATEX_DICTIONARY,
  version,
} from 'compute-engine';
import type { Parser } from 'compute-engine';

console.log(version);
const ce = new ComputeEngine();

// Verify custom LatexSyntax with extended dictionary
const syntax = new LatexSyntax({
  dictionary: [
    ...LATEX_DICTIONARY,
    {
      latexTrigger: '\\placeholder',
      parse: (parser: Parser) => {
        parser.parseOptionalGroup();
        return parser.parseGroup() ?? ['Error', "'missing'"];
      },
    },
  ],
});

const originalDef = ce.expr('Ln').operatorDefinition!;
ce.declare('Ln', {
  ...originalDef,
  evaluate: ([x], options) => {
    if (x.is(0)) return ce.NaN;
    return originalDef.evaluate!([x], options);
  },
});

const expr = ce.parse('x^2 + 2x + 1');
console.log(expr.toString());
