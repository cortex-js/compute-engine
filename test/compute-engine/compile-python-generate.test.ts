import { engine as ce } from '../utils';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate Python benchmark script
 *
 * This test generates a standalone Python script that benchmarks
 * the same expressions as the JavaScript/GLSL performance tests.
 *
 * Run the generated script with: python benchmarks/python-performance.py
 */

describe('PYTHON BENCHMARK GENERATION', () => {
  const python = new PythonTarget({ includeImports: true });
  const verbose =
    process.env.COMPILE_PERF_VERBOSE === '1' ||
    process.env.BENCH_VERBOSE === '1' ||
    process.env.VERBOSE === '1';
  const writeLine = (line: string) => {
    process.stdout.write(`${line}\n`);
  };
  const log = (...args: unknown[]) => {
    if (verbose) {
      writeLine(args.join(' '));
    }
  };

  it('should generate Python performance benchmark script', () => {
    // Benchmark expressions matching compile-performance.test.ts
    const benchmarks = [
      {
        name: 'Simple Power',
        latex: 'x^2 + y^2 + z^2',
        vars: ['x', 'y', 'z'],
        testData: { x: 3, y: 4, z: 5 },
        iterations: 10000,
      },
      {
        name: 'Polynomial',
        latex: 'x^4 + 3x^3 + 2x^2 + x + 1',
        vars: ['x'],
        testData: { x: 2.5 },
        iterations: 10000,
      },
      {
        name: 'Trigonometric',
        latex: '\\sin(x) + \\cos(y) + \\tan(z)',
        vars: ['x', 'y', 'z'],
        testData: { x: 1, y: 2, z: 3 },
        iterations: 10000,
      },
      {
        name: 'Nested Expression',
        latex: '\\sqrt{(x-a)^2 + (y-b)^2 + (z-c)^2}',
        vars: ['x', 'y', 'z', 'a', 'b', 'c'],
        testData: { x: 5, y: 6, z: 7, a: 1, b: 2, c: 3 },
        iterations: 10000,
      },
      {
        name: 'Large Expression (50 terms)',
        latex: Array.from({ length: 50 }, (_, i) => `x^${i}`).join(' + '),
        vars: ['x'],
        testData: { x: 1.1 },
        iterations: 1000,
      },
      {
        name: 'Many Variables (20 vars)',
        latex: Array.from({ length: 20 }, (_, i) => `x_{${i}}`).join(' + '),
        vars: Array.from({ length: 20 }, (_, i) => `x_${i}`),
        testData: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`x_${i}`, i + 1])
        ),
        iterations: 10000,
      },
      {
        name: 'Distance Formula',
        latex: '\\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}',
        vars: ['x_1', 'y_1', 'x_2', 'y_2'],
        testData: { x_1: 0, y_1: 0, x_2: 3, y_2: 4 },
        iterations: 10000,
      },
      {
        name: 'Quadratic Formula',
        latex: '\\frac{-b + \\sqrt{b^2 - 4ac}}{2a}',
        vars: ['a', 'b', 'c'],
        testData: { a: 1, b: -5, c: 6 },
        iterations: 10000,
      },
      {
        name: 'Kinematics',
        latex: 'u \\cdot t + \\frac{1}{2} a \\cdot t^2',
        vars: ['u', 'a', 't'],
        testData: { u: 10, a: 9.8, t: 2 },
        iterations: 10000,
      },
    ];

    // Generate Python code
    let pythonCode = `#!/usr/bin/env python3
"""
Python/NumPy Performance Benchmarks
Generated from Compute Engine expressions

This script benchmarks NumPy-compiled mathematical expressions
and compares performance with pure Python evaluation.

Run with: python benchmarks/python-performance.py

Requirements:
  pip install numpy
"""

import numpy as np
import os
import sys
import time
from typing import Dict, Any, Callable

def benchmark(fn: Callable, iterations: int, **kwargs) -> float:
    """Benchmark a function over multiple iterations"""
    start = time.perf_counter()
    for _ in range(iterations):
        fn(**kwargs)
    end = time.perf_counter()
    return (end - start) * 1000  # Convert to milliseconds

def is_verbose() -> bool:
    return ('--verbose' in sys.argv) or ('-v' in sys.argv) or (os.getenv('BENCH_VERBOSE') == '1')

# Generated benchmark functions
`;

    // Generate each benchmark function
    for (const bench of benchmarks) {
      const expr = ce.parse(bench.latex);

      // Generate function
      const funcName = bench.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const funcCode = python.compileFunction(
        expr,
        funcName,
        bench.vars,
        `${bench.name}: ${bench.latex}`
      );

      // Remove the import statement (we'll add it once at the top)
      const codeWithoutImport = funcCode.replace(/^import.*\n\n/gm, '');
      pythonCode += `\n${codeWithoutImport}\n`;
    }

    // Add benchmark execution code
    pythonCode += `
# Benchmark suite
def run_benchmarks():
    """Run all benchmarks and display results"""
    verbose = is_verbose()
    if verbose:
        print("=" * 80)
        print("Python/NumPy Performance Benchmarks")
        print("=" * 80)
        print()
    else:
        print("Python/NumPy Performance Benchmarks (summary)")

    results = []
`;

    for (const bench of benchmarks) {
      const funcName = bench.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const testDataStr = JSON.stringify(bench.testData);
      const iterations = bench.iterations.toLocaleString('en-US');

      pythonCode += `
    # ${bench.name}
    if verbose:
        print(f"Running: ${bench.name} (${iterations} iterations)")
    test_data_${funcName} = ${testDataStr}
    time_${funcName} = benchmark(${funcName}, ${bench.iterations}, **test_data_${funcName})
    result_${funcName} = ${funcName}(**test_data_${funcName})
    if verbose:
        print(f"  Time: {time_${funcName}:.2f} ms")
        print(f"  Result: {result_${funcName}}")
    results.append({
        'name': '${bench.name}',
        'iterations': ${bench.iterations},
        'time_ms': time_${funcName},
        'time_per_op_us': (time_${funcName} * 1000) / ${bench.iterations},
        'result': result_${funcName}
    })
    if verbose:
        print()
`;
    }

    pythonCode += `
    # Summary
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print()
    print(f"{'Benchmark':<30} {'Iterations':<12} {'Total (ms)':<12} {'Per Op (μs)':<12}")
    print("-" * 80)

    for r in results:
        print(f"{r['name']:<30} {r['iterations']:<12,} {r['time_ms']:<12.2f} {r['time_per_op_us']:<12.6f}")

    print()
    if verbose:
        print("=" * 80)
        print("Comparison with JavaScript (from compile-performance.test.ts)")
        print("=" * 80)
        print()
        print("To compare with JavaScript performance:")
        print("  npm run test compute-engine/compile-performance")
        print()
        print("Expected results:")
        print("  - NumPy should be faster than JavaScript for vectorized operations")
        print("  - JavaScript may be faster for single evaluations (less overhead)")
        print("  - Both should be much faster than interpreted evaluation")
        print()
    else:
        print("Tip: run with --verbose (or set BENCH_VERBOSE=1) for per-benchmark output.")

if __name__ == '__main__':
    run_benchmarks()
`;

    // Write to file
    const outputPath = path.join(
      __dirname,
      '../../benchmarks/python-performance.py'
    );

    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, pythonCode);

    log(`\n✔ Generated Python benchmark script:`);
    log(`   ${outputPath}`);
    log(`\nTo run the benchmarks:`);
    log(`   python benchmarks/python-performance.py`);
    log(`\nOr with timing:`);
    log(`   time python benchmarks/python-performance.py`);
    if (!verbose) {
      writeLine(
        '\u001b[2K\u001b[80D\u001b[32m✔ \u001b[0m Generated Python benchmark script. \u001b[0;2mSet BENCH_VERBOSE=1 for details.\u001b[0m'
      );
    }
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('should generate README for Python benchmarks', () => {
    const readmeContent = `# Python/NumPy Performance Benchmarks

This directory contains generated Python benchmarks for comparing NumPy performance
with JavaScript compilation performance.

## Setup

Install dependencies:

\`\`\`bash
pip install numpy
\`\`\`

## Running Benchmarks

Run the benchmark script:

\`\`\`bash
python benchmarks/python-performance.py
\`\`\`

Show per-benchmark output:

\`\`\`bash
python benchmarks/python-performance.py --verbose
\`\`\`

Or via environment variable:

\`\`\`bash
BENCH_VERBOSE=1 python benchmarks/python-performance.py
\`\`\`

## Regenerating Benchmarks

The Python benchmark script is generated from TypeScript tests. To regenerate:

\`\`\`bash
npm run test compute-engine/compile-python-generate
\`\`\`

## Comparing with JavaScript

To see JavaScript performance for the same expressions:

\`\`\`bash
npm run test compute-engine/compile-performance
\`\`\`

## Expected Results

- **NumPy**: Fast for array operations, some overhead for scalar operations
- **JavaScript Compiled**: Very fast for scalar operations, optimized by V8 JIT
- **Both**: Much faster than interpreted evaluation (40-2900x speedup)

## Use Cases

- **NumPy/Python**: Ideal for scientific computing, data analysis, ML workflows
- **JavaScript**: Ideal for browser/Node.js applications, real-time computation
- **GLSL**: Ideal for GPU parallel computation, graphics, WebGL

## Performance Tips

For NumPy:
- Use vectorized operations (arrays) instead of scalar loops
- Leverage NumPy's C-optimized implementations
- Avoid Python loops when possible

For JavaScript:
- Compiled functions are optimized by V8 JIT
- Minimal overhead for function calls
- Works great in browser and Node.js
`;

    const outputPath = path.join(__dirname, '../../benchmarks/README.md');

    fs.writeFileSync(outputPath, readmeContent);

    log(`\n✔  Generated README:`);
    log(`   ${outputPath}`);

    expect(fs.existsSync(outputPath)).toBe(true);
  });
});
