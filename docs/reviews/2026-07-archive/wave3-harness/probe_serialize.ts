import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';
const ce = new ComputeEngine();
// machine-precision engine baseline
ce.precision = 'machine' as any;
console.log('machine engine, box(1.0737517071310738e42):', ce.box(1.0737517071310738e42).toString());
console.log('machine engine, BesselI(0,100).N():', ce.box(['BesselI', 0, 100]).N().toString());
ce.precision = 50;
console.log('p50 engine, box(1.0737517071310738e42):', ce.box(1.0737517071310738e42).toString());
ce.precision = 21;
