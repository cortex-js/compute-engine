import { ComputeEngine } from '../src/compute-engine';

const ce = new ComputeEngine();

function benchmark(name: string, fn: () => void, iterations: number = 1) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  console.log(`${name}: ${((end - start) / iterations).toFixed(2)}ms`);
}

console.log('--- Numerical Evaluation Benchmarks ---');

// Large Sum
benchmark('Sum(1/n, 1..10000).N()', () => {
  ce.box(['Sum', ['Divide', 1, 'n'], ['Tuple', 'n', 1, 10000]]).N();
}, 5);

// Large Product
benchmark('Product(1 + 1/n^2, 1..1000).N()', () => {
  ce.box(['Product', ['Add', 1, ['Divide', 1, ['Power', 'n', 2]]], ['Tuple', 'n', 1, 1000]]).N();
}, 5);

// Statistical Mean
const largeListData = Array.from({ length: 10000 }, (_, i) => i);
const largeList = ce.box(['List', ...largeListData]);
benchmark('Mean(largeList).N()', () => {
  ce.box(['Mean', largeList]).N();
}, 50);

// Integrate
benchmark('Integrate(x, 0..1).N()', () => {
  ce.box(['Integrate', 'x', ['Tuple', 'x', 0, 1]]).N();
}, 5);
