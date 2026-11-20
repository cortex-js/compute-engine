// CE-1554: a protocol requirement may declare a default value for a
// parameter; a call that leaves the parameter out gets the default.
// Run: npx tsx scripts/repros/2026-11-19-ce1554-protocol-requirement-default.mts
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();
const protocol = executeEpsil(
  ce,
  `protocol Stroked {
  function stroke(self: Self, width: real = 1) -> real
}`
);
console.log('protocol:', JSON.stringify(protocol.value?.json));
const declared = executeEpsil(
  ce,
  `type number is Stroked {
  function stroke(self: number, width: real) -> real { self * width }
}`
);
console.log('conformance:', JSON.stringify(declared.value?.json));

const short = executeEpsil(ce, 'stroke(3)').value?.json;
const full = executeEpsil(ce, 'stroke(3, 2)').value?.json;
console.log('stroke(3):', JSON.stringify(short), '(expected 3)');
console.log('stroke(3, 2):', JSON.stringify(full), '(expected 6)');
console.log(short === 3 && full === 6 ? 'READY' : 'NOT READY');
