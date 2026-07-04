import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';
const ce = new ComputeEngine();
ce.precision = 50;
for (const expr of [['BesselI', 0, 100], ['BesselJ', 0, 10], ['AiryAi', -10], ['BesselK', 2, 20]] as any[]) {
  const r = ce.box(expr).N();
  console.log(JSON.stringify(expr), '→', r.toString(), '| numericValue ctor:', (r as any).numericValue?.constructor?.name, '| bignumRe:', (r as any).bignumRe?.toString()?.slice(0, 60));
}
ce.precision = 21;
