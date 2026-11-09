// CE-1183: a call of a `functions` entry has the declared result type of its
// operator in the GLSL fragment check, not always `real`.
// Run: npx tsx scripts/repros/2026-11-09-ce1183-functions-entry-result-type.mts
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('g', { signature: '(any, any) -> color' });
const r = compile(ce.box(['AsOklab', ['g', 0, 'x']]), {
  to: 'glsl',
  functions: { g: 'hostG' },
} as any) as any;
console.log('color:', r.success, r.success ? r.code : r.message ?? r);

const r2 = compile(ce.box(['Add', ['h', 'x'], 1]), {
  to: 'glsl',
  functions: { h: 'hostH' },
} as any) as any;
console.log('real control:', r2.success, r2.code);
console.log(r.success ? 'READY' : 'NOT READY');
