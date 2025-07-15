import { ComputeEngine } from './src/compute-engine/index.ts';

const ce = new ComputeEngine();

console.log('Testing the original playground expression...');

// Test the original expression from playground
const result = ce.box([
  'Take',
  ['Filter', ['Range', 'PositiveInfinity'], ['GreaterThan', '_', 10]],
  5,
]);

console.log('Expression:', result.toString());

try {
  const evaluated = result.evaluate({ materialization: 'eager' });
  console.log('Result:', evaluated.toString());
  console.log('Expected: ["List", 11, 12, 13, 14, 15]');
} catch (error) {
  console.error('Error:', error.message);
}