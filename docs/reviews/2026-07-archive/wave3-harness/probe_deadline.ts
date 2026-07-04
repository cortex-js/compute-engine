import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';
const ce = new ComputeEngine();
let t = Date.now();
const g = ce.box(['Gamma', 1e300]).N();
console.log('Gamma(1e300).N() =', g.toString(), 'in', Date.now() - t, 'ms');
t = Date.now();
const z = ce.box(['Zeta', 1e9]).N();
console.log('Zeta(1e9).N() =', z.toString(), 'in', Date.now() - t, 'ms');
