import { BigDecimal } from '../../src/big-decimal';
import { Decimal } from 'decimal.js';

function bench(name: string, fn: () => void, iterations = 1000): string {
  // Warmup
  for (let i = 0; i < 10; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const msPerOp = elapsed / iterations;
  const line = `  ${name.padEnd(30)} ${msPerOp.toFixed(4)} ms/op  (${iterations} iters)`;
  console.log(line);
  return line;
}

console.log('BigDecimal vs Decimal.js Benchmarks');
console.log('='.repeat(70));

for (const prec of [50, 100, 500, 1000]) {
  console.log(`\nPrecision: ${prec}`);
  console.log('-'.repeat(70));

  BigDecimal.precision = prec;
  Decimal.set({ precision: prec });

  const bdA = new BigDecimal('123.456789012345678901234567890');
  const bdB = new BigDecimal('987.654321098765432109876543210');
  const dA = new Decimal('123.456789012345678901234567890');
  const dB = new Decimal('987.654321098765432109876543210');

  const iters = prec <= 100 ? 10000 : prec <= 500 ? 1000 : 100;
  const trigIters = prec <= 100 ? 1000 : prec <= 500 ? 100 : 20;

  console.log('  --- Addition ---');
  bench('BigDecimal add', () => bdA.add(bdB), iters);
  bench('Decimal.js  add', () => dA.add(dB), iters);

  console.log('  --- Multiplication ---');
  bench('BigDecimal mul', () => bdA.mul(bdB), iters);
  bench('Decimal.js  mul', () => dA.mul(dB), iters);

  console.log('  --- Division ---');
  bench('BigDecimal div', () => bdA.div(bdB), iters);
  bench('Decimal.js  div', () => dA.div(dB), iters);

  console.log('  --- Square Root ---');
  bench('BigDecimal sqrt', () => bdA.sqrt(), trigIters);
  bench('Decimal.js  sqrt', () => dA.sqrt(), trigIters);

  console.log('  --- Exponential ---');
  bench('BigDecimal exp', () => new BigDecimal('1.5').exp(), trigIters);
  bench('Decimal.js  exp', () => new Decimal('1.5').exp(), trigIters);

  console.log('  --- Natural Log ---');
  bench('BigDecimal ln', () => bdA.ln(), trigIters);
  bench('Decimal.js  ln', () => dA.ln(), trigIters);

  console.log('  --- Sine ---');
  bench('BigDecimal sin', () => new BigDecimal('1.5').sin(), trigIters);
  bench('Decimal.js  sin', () => new Decimal('1.5').sin(), trigIters);

  console.log('  --- Cosine ---');
  bench('BigDecimal cos', () => new BigDecimal('1.5').cos(), trigIters);
  bench('Decimal.js  cos', () => new Decimal('1.5').cos(), trigIters);

  console.log('  --- Arctangent ---');
  bench('BigDecimal atan', () => new BigDecimal('0.5').atan(), trigIters);
  bench('Decimal.js  atan', () => new Decimal('0.5').atan(), trigIters);
}
