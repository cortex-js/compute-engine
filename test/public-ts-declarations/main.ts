// Imports resolve into the built declarations. This mirrors what a consumer
// sees via the package's `types` export (dist/types/compute-engine.d.ts). The
// path is relative because TS 7 removed --baseUrl, which previously mapped the
// bare `compute-engine` specifier onto dist/types.
import {
  ComputeEngine,
  LatexSyntax,
  LATEX_DICTIONARY,
  version,
} from '../../dist/types/compute-engine';
import type { Parser } from '../../dist/types/compute-engine';

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
