import { ComputeEngine } from '../../src/compute-engine.ts';

/**
 * TYPE_SYSTEM_ROADMAP §1: inference is "evidence-based and *revisable* (narrow
 * from argument use, widen from value assignment …) rather than a
 * once-and-final principal type". Test the two direction rules directly.
 */
const t = (ce: any, s = 'v') => String(ce.box(s).type);

console.log('WIDEN FROM VALUE ASSIGNMENT — assign narrow, then assign wider:');
{
  const ce = new ComputeEngine();
  ce.box(['Assign', 'v', 5]).evaluate();
  const before = t(ce);
  ce.box(['Assign', 'v', 2.5]).evaluate();
  console.log(`  v := 5 -> ${before} ; then v := 2.5 -> ${t(ce)}   (widening expected)`);
}

console.log('\nNARROW FROM ARGUMENT USE — use in a narrower context after a wide inference:');
{
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.box(['Multiply', 'x', 'v']);          // numeric use -> wide
  const before = t(ce);
  ce.box(['Add', ['Factorial', 'v'], 1]);  // integer-demanding use
  console.log(`  after x·v -> ${before} ; after v! -> ${t(ce)}   (narrowing expected)`);
}

console.log('\nDOES ASSIGNMENT NARROW? (the case §1 appears to exclude):');
{
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.box(['Multiply', 'x', 'v']);
  const before = t(ce);
  ce.box(['Assign', 'v', 5]).evaluate();
  console.log(`  after x·v -> ${before} ; then v := 5 -> ${t(ce)}   (stays wide if narrowing-by-assignment is excluded)`);
}

console.log('\nCONTROL — value is 5 in every branch above:');
{
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.box(['Multiply', 'x', 'v']);
  ce.box(['Assign', 'v', 5]).evaluate();
  console.log(`  value = ${ce.box('v').evaluate().toString()}`);
}
