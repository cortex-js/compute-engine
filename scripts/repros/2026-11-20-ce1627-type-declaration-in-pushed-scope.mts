// CE-1627: a `type` (or `protocol`, or conformance) statement at the top level
// of a program run by `executeEpsil()` in a scope that the host pushed gets
// the diagnostic "must be at the top level of a program". The type is still
// declared, and it outlives the pushed scope: that part is the contract
// (types are engine-global).
//
// Run: npx tsx scripts/repros/2026-11-20-ce1627-type-declaration-in-pushed-scope.mts
//
// Output at af8263034fb9f22add3c3621ab48458acac2dec6 (2026-11-20):
//   run at the global scope: []
//   checkEpsil in a pushed scope: []
//   run in a pushed scope: 1 ["invalid type declaration: Type declarations must be at the top level of a program, not inside a block or function body"]
//   a second pushed scope reads Pt: 3 []
//   Pt declared after both scopes are popped: true
//
// Output with the fix (on 9b0d22b3199e5dd480953e89f83d25d21e6d0942): the same,
// except `run in a pushed scope: 1 []`. `Pt` stays declared after the scopes
// are popped: types are engine-global (`docs/TYPE-SYSTEM.md`, "Declarations
// and the global registry").
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkEpsil } from '../../src/epsil/check-epsil';

const src = 'type Pt = tuple<x: real, y: real>\nlet p = Pt(1, 2)\np.x';
const messages = (r: { diagnostics: any[] }) =>
  JSON.stringify(r.diagnostics.map((d) => d.message?.[1]?.replace(/ at `[^`]*`$/, '')));

console.log('run at the global scope:', messages(executeEpsil(new ComputeEngine(), src)));

const ce = new ComputeEngine();
ce.pushScope(undefined, 'section');
console.log('checkEpsil in a pushed scope:', messages(checkEpsil(ce, src)));
ce.pushScope(undefined, 'cell A');
const a = executeEpsil(ce, src);
console.log('run in a pushed scope:', JSON.stringify(a.value.json), messages(a));
ce.popScope();
ce.pushScope(undefined, 'cell B');
const b = executeEpsil(ce, 'let q = Pt(3, 4)\nq.x');
console.log('a second pushed scope reads Pt:', JSON.stringify(b.value.json), messages(b));
ce.popScope();
ce.popScope();
console.log('Pt declared after both scopes are popped:', [...ce._typeResolver.names].includes('Pt'));
