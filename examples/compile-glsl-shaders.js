/**
 * Example: Compiling to GLSL Shaders
 *
 * This example demonstrates how to compile mathematical expressions
 * to GLSL (OpenGL Shading Language) for use in WebGL shaders.
 *
 * GLSL is used for:
 * - 3D graphics rendering
 * - GPU-accelerated computations
 * - Visual effects and post-processing
 * - Scientific visualization
 */

import { ComputeEngine, GLSLTarget } from '../dist/compute-engine.esm.js';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

console.log('GLSL Shader Compilation Examples');
console.log('='.repeat(70));
console.log();

// ============================================================================
// Example 1: Basic Expression Compilation
// ============================================================================
console.log('Example 1: Basic GLSL Expressions');
console.log('-'.repeat(70));

const expr1 = ce.parse('x^2 + y^2');
const glsl1 = glsl.compile(expr1);
console.log('Math Expression: x² + y²');
console.log('GLSL Code:', glsl1);
console.log();

const expr2 = ce.parse('\\sin(x) * \\cos(y)');
const glsl2 = glsl.compile(expr2);
console.log('Math Expression: sin(x) * cos(y)');
console.log('GLSL Code:', glsl2);
console.log();

// ============================================================================
// Example 2: Vector Operations
// ============================================================================
console.log('Example 2: Vector Operations');
console.log('-'.repeat(70));

// Compile a vec3
const vec3 = ce.box(['List', 1, 2, 3]);
const glslVec = glsl.compile(vec3);
console.log('Vector [1, 2, 3]:');
console.log('GLSL Code:', glslVec);
console.log();

// Vector addition
const vecAdd = ce.box(['Add', ['List', 'r', 'g', 'b'], ['List', 0.1, 0.1, 0.1]]);
const glslVecAdd = glsl.compile(vecAdd);
console.log('Vector Addition (color brighten):');
console.log('GLSL Code:', glslVecAdd);
console.log();

// ============================================================================
// Example 3: Complete GLSL Function
// ============================================================================
console.log('Example 3: Generate Complete GLSL Function');
console.log('-'.repeat(70));

// Distance calculation
const distExpr = ce.parse('\\sqrt{x^2 + y^2 + z^2}');
const distFunc = glsl.compileFunction(
  distExpr,
  'distance3D',
  'float',
  [
    ['x', 'float'],
    ['y', 'float'],
    ['z', 'float'],
  ]
);
console.log('Function: Calculate 3D distance');
console.log(distFunc);
console.log();

// Circle equation
const circleExpr = ce.parse('\\sqrt{1 - x^2}');
const circleFunc = glsl.compileFunction(
  circleExpr,
  'circleY',
  'float',
  [['x', 'float']]
);
console.log('Function: Circle equation (y = √(1 - x²))');
console.log(circleFunc);
console.log();

// ============================================================================
// Example 4: Fragment Shader - Simple Color
// ============================================================================
console.log('Example 4: Fragment Shader - Simple Color');
console.log('-'.repeat(70));

// Create a simple red color output
const redColor = ce.box(['List', 1, 0, 0, 1]);

const colorShader = glsl.compileShader({
  type: 'fragment',
  version: '300 es',
  outputs: [{ name: 'fragColor', type: 'vec4' }],
  body: [
    {
      variable: 'fragColor',
      expression: redColor,
    },
  ],
});

console.log('Simple Red Color Shader:');
console.log(colorShader);
console.log();

// ============================================================================
// Example 5: Fragment Shader - With Uniforms
// ============================================================================
console.log('Example 5: Fragment Shader - With Uniforms');
console.log('-'.repeat(70));

const uniformShader = glsl.compileShader({
  type: 'fragment',
  version: '300 es',
  uniforms: [{ name: 'scale', type: 'float' }],
  outputs: [{ name: 'fragColor', type: 'vec4' }],
  body: [
    {
      variable: 'fragColor',
      expression: ce.box(['List', 'scale', 'scale', 'scale', 1]),
    },
  ],
});

console.log('Uniform Shader:');
console.log(uniformShader);
console.log();

// ============================================================================
// Example 6: Vertex Shader - Simple Pass-Through
// ============================================================================
console.log('Example 6: Vertex Shader - Simple Pass-Through');
console.log('-'.repeat(70));

const vertexShader = glsl.compileShader({
  type: 'vertex',
  version: '300 es',
  inputs: [{ name: 'aPos', type: 'vec3' }],
  outputs: [{ name: 'vCol', type: 'vec3' }],
  body: [
    {
      variable: 'vCol',
      expression: ce.box(['List', 1, 1, 1]),
    },
  ],
});

console.log('Simple Vertex Shader:');
console.log(vertexShader);
console.log();

// ============================================================================
// Example 7: Mathematical Functions in GLSL
// ============================================================================
console.log('Example 7: Mathematical Functions');
console.log('-'.repeat(70));

// Use direct function calls instead of LaTeX
const absExpr = ce.box(['Abs', 'x']);
console.log('Absolute value: abs(x) →', glsl.compile(absExpr));

const sqrtExpr = ce.box(['Sqrt', 'x']);
console.log('Square root: sqrt(x) →', glsl.compile(sqrtExpr));

const powExpr = ce.box(['Power', 'x', 2]);
console.log('Power: pow(x, 2) →', glsl.compile(powExpr));

const minExpr = ce.box(['Min', 'a', 'b']);
console.log('Minimum: min(a, b) →', glsl.compile(minExpr));

const maxExpr = ce.box(['Max', 'a', 'b']);
console.log('Maximum: max(a, b) →', glsl.compile(maxExpr));

console.log();

// ============================================================================
// Example 8: Complex Fragment Shader - Mandelbrot Set
// ============================================================================
console.log('Example 8: Mandelbrot Set Fragment Shader');
console.log('-'.repeat(70));

const mandelbrotShader = `#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform float uZoom;
uniform vec2 uCenter;
uniform int uMaxIterations;

void main() {
  // Map texture coordinates to complex plane
  vec2 c = (vTexCoord - 0.5) * 4.0 / uZoom + uCenter;

  vec2 z = vec2(0.0);
  float iterations = 0.0;

  // Mandelbrot iteration: z = z² + c
  for (int i = 0; i < 100; i++) {
    if (i >= uMaxIterations) break;
    if (dot(z, z) > 4.0) break;

    // z² = (a + bi)² = (a² - b²) + 2abi
    float zx = z.x * z.x - z.y * z.y + c.x;
    float zy = 2.0 * z.x * z.y + c.y;
    z = vec2(zx, zy);

    iterations += 1.0;
  }

  // Color based on iterations
  float color = iterations / float(uMaxIterations);
  fragColor = vec4(vec3(color), 1.0);
}`;

console.log('Mandelbrot Set Shader (manual):');
console.log(mandelbrotShader);
console.log();

// ============================================================================
// Summary
// ============================================================================
console.log('Summary');
console.log('='.repeat(70));
console.log('✓ Compiled mathematical expressions to GLSL');
console.log('✓ Generated vector operations (vec2, vec3, vec4)');
console.log('✓ Created complete GLSL functions');
console.log('✓ Built fragment shaders for visual effects');
console.log('✓ Generated vertex shaders for geometry manipulation');
console.log('✓ Demonstrated GLSL-specific functions (smoothstep, mix, etc.)');
console.log();
console.log('Use cases for GLSL compilation:');
console.log('  • WebGL graphics and visualization');
console.log('  • GPU-accelerated computations');
console.log('  • Real-time visual effects');
console.log('  • Scientific visualization');
console.log('  • Game development');
console.log('  • Image processing and filters');
