/**
 * Example: Compiling vector/matrix operations with custom operators
 *
 * This example demonstrates how to override operators to use function calls
 * instead of native operators, enabling vector and matrix operations.
 *
 * Related to Issue #240:
 * https://github.com/cortex-js/compute-engine/issues/240
 */

import { ComputeEngine } from '@cortex-js/compute-engine';

const ce = new ComputeEngine();

// Define vector operation functions
function vectorAdd(a, b) {
  return a.map((v, i) => v + b[i]);
}

function vectorMultiply(a, b) {
  return a.map((v, i) => v * b[i]);
}

function vectorSubtract(a, b) {
  return a.map((v, i) => v - b[i]);
}

// Example 1: Simple vector addition
console.log('Example 1: Vector Addition');
console.log('=' .repeat(50));

const expr1 = ce.parse('v + w');
console.log('Expression:', expr1.toString());

// Compile with operator override
const fn1 = expr1.compile({
  operators: {
    Add: ['vectorAdd', 11],
  },
  functions: {
    vectorAdd,
  },
});

console.log('Compiled code:', fn1.toString());

const result1 = fn1({ v: [1, 2, 3], w: [4, 5, 6] });
console.log('Result:', result1); // [5, 7, 9]
console.log();

// Example 2: Complex vector expression
console.log('Example 2: Complex Vector Expression');
console.log('=' .repeat(50));

const expr2 = ce.parse('v + w * u');
console.log('Expression:', expr2.toString());

const fn2 = expr2.compile({
  operators: {
    Add: ['vectorAdd', 11],
    Multiply: ['vectorMultiply', 12],
  },
  functions: {
    vectorAdd,
    vectorMultiply,
  },
});

console.log('Compiled code:', fn2.toString());

const result2 = fn2({
  v: [1, 2, 3],
  w: [2, 3, 4],
  u: [1, 1, 1],
});
console.log('Result:', result2); // [3, 5, 7]
console.log();

// Example 3: Using function-based operator override
console.log('Example 3: Function-Based Override');
console.log('=' .repeat(50));

const expr3 = ce.parse('a + b - c');
console.log('Expression:', expr3.toString());

const fn3 = expr3.compile({
  operators: (op) => {
    // Override only Add, others use defaults
    if (op === 'Add') return ['vectorAdd', 11];
    return undefined;
  },
  functions: {
    vectorAdd,
  },
});

console.log('Compiled code:', fn3.toString());

const result3 = fn3({
  a: [1, 2, 3],
  b: [4, 5, 6],
  c: [1, 1, 1],
});
console.log('Result:', result3); // [4, 6, 8]
console.log();

// Example 4: Handling negation with vectors
console.log('Example 4: Vector Negation');
console.log('=' .repeat(50));

function vectorNegate(a) {
  return a.map((v) => -v);
}

const expr4 = ce.parse('v - w');
console.log('Expression:', expr4.toString());

const fn4 = expr4.compile({
  operators: {
    Add: ['vectorAdd', 11],
    Negate: ['vectorNegate', 14],
  },
  functions: {
    vectorAdd,
    vectorNegate,
  },
});

console.log('Compiled code:', fn4.toString());

const result4 = fn4({
  v: [5, 6, 7],
  w: [1, 2, 3],
});
console.log('Result:', result4); // [4, 4, 4]
console.log();

// Example 5: Using native operators for symbols
console.log('Example 5: Symbol Operators (Not Function Names)');
console.log('=' .repeat(50));

// You can still use symbol operators like '⊕' if needed
const expr5 = ce.parse('x + y');
const fn5 = expr5.compile({
  operators: {
    Add: ['⊕', 11], // This will use ⊕ as an infix operator
  },
});

console.log('Compiled code:', fn5.toString());
console.log('This would need runtime support for ⊕ operator');
console.log();

console.log('Summary');
console.log('=' .repeat(50));
console.log('✓ Operators can be overridden to function calls');
console.log('✓ Partial overrides are supported');
console.log('✓ Works with both scalar and vector arguments');
console.log('✓ Function-based overrides enable conditional logic');
