import { ComputeEngine } from '../../src/compute-engine.ts';

const t = (ce: any, s = 'v') => String(ce.box(s).type);

console.log('1. VACUITY CONTROL for my `v!` probe — does Factorial alone pin integer?');
{
  const ce = new ComputeEngine();
  ce.box(['Factorial', 'w']);
  console.log(`   fresh engine, w! alone            -> w : ${t(ce, 'w')}`);
}

console.log('\n2. THEIR DISCRIMINATING PROBE — declared signature, strictly narrower:');
{
  const ce: any = new ComputeEngine();
  ce.declare('g', '(integer) -> integer');
  ce.declare('x', 'number');
  ce.box(['Multiply', 'x', 'v']);
  const afterUse = t(ce);
  ce.box(['g', 'v']);
  console.log(`   x·v -> ${afterUse} ; then g(v) -> ${t(ce)}`);
}

console.log('\n3. Control for (2): does g(v) alone pin integer from unknown?');
{
  const ce: any = new ComputeEngine();
  ce.declare('g', '(integer) -> integer');
  ce.box(['g', 'v']);
  console.log(`   fresh engine, g(v) alone          -> v : ${t(ce)}`);
}

console.log('\n4. Is the OPERATOR route weaker? A strictly narrower operator context after x·v:');
{
  // Mod/GCD-style integer-demanding operators, if any narrow at all.
  for (const op of ['Factorial', 'IsPrime', 'Fibonacci'] as const) {
    const fresh: any = new ComputeEngine();
    fresh.box([op, 'w']);
    const control = String(fresh.box('w').type);

    const ce: any = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['Multiply', 'x', 'v']);
    const before = t(ce);
    ce.box([op, 'v']);
    console.log(`   ${op.padEnd(10)} control(fresh)=${control.padEnd(16)} x·v=${before} then ${op}(v) -> ${t(ce)}`);
  }
}
