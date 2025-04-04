// very simple test file - modify and use as you want
// to run this file go to Run / Debug, select "tsx Current File" and run. Shortcut is F5.

import { ComputeEngine } from '../src/compute-engine';

const ce = new ComputeEngine();

const expr = ce.parse('3^{x}=10');
const solution = expr.solve('x')?.toString();
console.log('===========');
console.log('expression', solution);
console.log('===========');
