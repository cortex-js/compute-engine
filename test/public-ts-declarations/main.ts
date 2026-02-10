import { ComputeEngine, version } from 'compute-engine';
import type { Parser } from 'compute-engine';

console.log(version);
const ce = new ComputeEngine();

ce.latexDictionary = [
  ...ce.latexDictionary,
  {
    latexTrigger: '\\placeholder',
    parse: (parser: Parser) => {
      parser.parseOptionalGroup();
      return parser.parseGroup() ?? ['Error', "'missing'"];
    },
  },
];

const originalDef = ce.box('Ln').operatorDefinition!;
ce.declare('Ln', {
  ...originalDef,
  evaluate: ([x], options) => {
    if (x.is(0)) return ce.NaN;
    return originalDef.evaluate!([x], options);
  },
});

const expr = ce.parse('x^2 + 2x + 1');
console.log(expr.toString());
