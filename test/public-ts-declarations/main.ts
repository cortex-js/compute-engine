import { ComputeEngine, version } from 'compute-engine';
import type { BoxedExpression, Parser } from 'compute-engine';

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

const expr: BoxedExpression = ce.parse('x^2 + 2x + 1');
console.log(expr.toString());
