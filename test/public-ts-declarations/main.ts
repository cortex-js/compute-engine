import { ComputeEngine, version } from 'compute-engine';
import type { BoxedExpression } from 'compute-engine';

console.log(version);
const ce = new ComputeEngine();
const expr: BoxedExpression = ce.parse('x^2 + 2x + 1');
console.log(expr.toString());
