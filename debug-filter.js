import { ComputeEngine } from './src/compute-engine/index.ts';

const ce = new ComputeEngine();

console.log('Testing Filter iterator...');

// Test 1: Simple finite range
console.log('\n1. Testing finite range:');
const finiteRange = ce.box(['Range', 1, 20]);
console.log('Finite range:', finiteRange.toString());

// Test 2: Filter finite range
console.log('\n2. Testing filter on finite range:');
const filteredFinite = ce.box(['Filter', ['Range', 1, 20], ['GreaterThan', '_', 10]]);
console.log('Filtered finite:', filteredFinite.toString());

// Test 3: Manually iterate through a few elements
console.log('\n3. Manual iteration:');
const iterator = filteredFinite.each();
for (let i = 0; i < 5; i++) {
  const next = iterator.next();
  if (next.done) break;
  console.log(`Element ${i}:`, next.value.toString());
}

// Test 4: Test with infinite range but limited iteration
console.log('\n4. Testing infinite range with limited iteration:');
const infiniteRange = ce.box(['Range', 1, 'PositiveInfinity']);
console.log('Infinite range:', infiniteRange.toString());
console.log('Infinite range count:', infiniteRange.xsize);

// Test 5: Filter infinite range with limited iteration
console.log('\n5. Testing filter on infinite range (limited):');
const filteredInfinite = ce.box(['Filter', ['Range', 1, 'PositiveInfinity'], ['GreaterThan', '_', 10]]);
console.log('Filtered infinite:', filteredInfinite.toString());

console.log('\n6. Manual iteration of infinite filter (5 elements):');
const infIterator = filteredInfinite.each();
for (let i = 0; i < 5; i++) {
  const next = infIterator.next();
  if (next.done) break;
  console.log(`Element ${i}:`, next.value.toString());
}