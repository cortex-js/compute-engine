import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

/**
 * Performance benchmarks for the compilation system
 *
 * These tests measure:
 * - Compilation time
 * - Execution time (interpreted vs compiled)
 * - Memory usage
 * - Performance with different targets
 * - Impact of operator customization
 */

describe('COMPILATION PERFORMANCE', () => {
  const verbose =
    process.env.COMPILE_PERF_VERBOSE === '1' ||
    process.env.BENCH_VERBOSE === '1' ||
    process.env.VERBOSE === '1';
  const log = (...args: unknown[]) => {
    if (verbose) {
      console.log(...args);
    }
  };
  // Helper to measure execution time
  function benchmark(fn: () => any, iterations: number): number {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    const end = performance.now();
    return end - start;
  }

  // Helper to measure memory (approximation)
  function measureMemory(fn: () => any): number {
    if (global.gc) {
      global.gc();
    }
    const before = process.memoryUsage().heapUsed;
    fn();
    const after = process.memoryUsage().heapUsed;
    return after - before;
  }

  describe('Simple Expressions', () => {
    it('should compile simple arithmetic quickly', () => {
      const expr = ce.parse('x + y');

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 1000);

      log(
        `  Simple arithmetic compilation: ${(compilationTime / 1000).toFixed(3)}ms per compilation`
      );
      expect(compilationTime).toBeLessThan(1000); // Should be very fast
    });

    it('should execute compiled code faster than evaluation', () => {
      const expr = ce.parse('x^2 + y^2 + z^2');
      const compiled = compile(expr);

      const testData = { x: 3, y: 4, z: 5 };

      // Measure evaluation time
      const evalTime = benchmark(() => {
        expr.evaluate({ x: testData.x, y: testData.y, z: testData.z }).numericValue;
      }, 10000);

      // Measure compiled execution time
      const compiledTime = benchmark(() => {
        compiled(testData);
      }, 10000);

      log(`  Evaluation time: ${evalTime.toFixed(2)}ms (10k iterations)`);
      log(`  Compiled time: ${compiledTime.toFixed(2)}ms (10k iterations)`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      // Compiled should be faster
      expect(compiledTime).toBeLessThan(evalTime);
    });
  });

  describe('Complex Expressions', () => {
    it('should handle polynomial expressions efficiently', () => {
      const expr = ce.parse('x^4 + 3x^3 + 2x^2 + x + 1');

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 100);

      log(
        `  Polynomial compilation: ${(compilationTime / 100).toFixed(3)}ms per compilation`
      );

      const compiled = compile(expr);
      const evalTime = benchmark(() => {
        expr.evaluate({ x: 2.5 }).numericValue;
      }, 10000);

      const compiledTime = benchmark(() => {
        compiled({ x: 2.5 });
      }, 10000);

      log(`  Polynomial evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Polynomial compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });

    it('should handle trigonometric expressions efficiently', () => {
      const expr = ce.parse('\\sin(x) + \\cos(y) + \\tan(z)');

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 100);

      log(
        `  Trigonometric compilation: ${(compilationTime / 100).toFixed(3)}ms per compilation`
      );

      const compiled = compile(expr);
      const testData = { x: 1, y: 2, z: 3 };

      const evalTime = benchmark(() => {
        expr.evaluate(testData).numericValue;
      }, 10000);

      const compiledTime = benchmark(() => {
        compiled(testData);
      }, 10000);

      log(`  Trig evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Trig compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });

    it('should handle nested expressions efficiently', () => {
      const expr = ce.parse('\\sqrt{(x-a)^2 + (y-b)^2 + (z-c)^2}');

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 100);

      log(
        `  Nested expr compilation: ${(compilationTime / 100).toFixed(3)}ms per compilation`
      );

      const compiled = compile(expr);
      const testData = { x: 5, y: 6, z: 7, a: 1, b: 2, c: 3 };

      const evalTime = benchmark(() => {
        expr.evaluate(testData).numericValue;
      }, 10000);

      const compiledTime = benchmark(() => {
        compiled(testData);
      }, 10000);

      log(`  Nested evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Nested compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });
  });

  describe('Large Expressions', () => {
    it('should handle expressions with many terms', () => {
      // Create an expression with 50 terms
      const terms = Array.from({ length: 50 }, (_, i) => `x^${i}`).join(' + ');
      const expr = ce.parse(terms);

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 10);

      log(
        `  Large expr (50 terms) compilation: ${(compilationTime / 10).toFixed(3)}ms per compilation`
      );

      const compiled = compile(expr);

      const evalTime = benchmark(() => {
        expr.evaluate({ x: 1.1 }).numericValue;
      }, 1000);

      const compiledTime = benchmark(() => {
        compiled({ x: 1.1 });
      }, 1000);

      log(`  Large expr evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Large expr compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });

    it('should handle expressions with many variables', () => {
      // Create an expression with 20 variables
      const terms = Array.from({ length: 20 }, (_, i) => `x${i}`).join(' + ');
      const expr = ce.parse(terms);

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 100);

      log(
        `  Many variables (20) compilation: ${(compilationTime / 100).toFixed(3)}ms per compilation`
      );

      const compiled = compile(expr);

      const testData: any = {};
      for (let i = 0; i < 20; i++) {
        testData[`x${i}`] = i + 1;
      }

      const evalTime = benchmark(() => {
        expr.evaluate(testData).numericValue;
      }, 10000);

      const compiledTime = benchmark(() => {
        compiled(testData);
      }, 10000);

      log(`  Many vars evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Many vars compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });
  });

  describe('Different Targets', () => {
    it('should compile to JavaScript efficiently', () => {
      const expr = ce.parse('x^2 + y^2');

      const time = benchmark(() => {
        compile(expr, { to: 'javascript' });
      }, 1000);

      log(`  JavaScript target: ${(time / 1000).toFixed(3)}ms per compilation`);
      expect(time).toBeLessThan(1000);
    });

    it('should compile to GLSL efficiently', () => {
      const expr = ce.parse('x^2 + y^2');

      const time = benchmark(() => {
        compile(expr, { to: 'glsl' });
      }, 1000);

      log(`  GLSL target: ${(time / 1000).toFixed(3)}ms per compilation`);
      expect(time).toBeLessThan(1000);
    });

    it('should handle target switching overhead', () => {
      const expr = ce.parse('\\sin(x) * \\cos(y)');

      const jsTime = benchmark(() => {
        compile(expr, { to: 'javascript' });
      }, 500);

      const glslTime = benchmark(() => {
        compile(expr, { to: 'glsl' });
      }, 500);

      log(`  JavaScript target: ${(jsTime / 500).toFixed(3)}ms`);
      log(`  GLSL target: ${(glslTime / 500).toFixed(3)}ms`);
      log(`  Overhead: ${Math.abs(jsTime - glslTime).toFixed(2)}ms total`);

      // Both should be reasonably fast
      expect(jsTime).toBeLessThan(500);
      expect(glslTime).toBeLessThan(500);
    });
  });

  describe('Operator Customization', () => {
    it('should measure overhead of custom operators', () => {
      const expr = ce.parse('x + y * z');

      // Baseline: no customization
      const baselineTime = benchmark(() => {
        compile(expr);
      }, 1000);

      // With operator customization
      const customTime = benchmark(() => {
        compile(expr, {
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
      }, 1000);

      log(`  Baseline compilation: ${(baselineTime / 1000).toFixed(3)}ms`);
      log(`  Custom operators: ${(customTime / 1000).toFixed(3)}ms`);
      log(`  Overhead: ${((customTime - baselineTime) / 1000).toFixed(3)}ms`);

      // Overhead should be minimal
      expect(customTime - baselineTime).toBeLessThan(100);
    });

    it('should measure execution overhead of custom operators', () => {
      const expr = ce.parse('x + y');

      // Baseline compiled
      const baseline = compile(expr);
      const baselineExec = benchmark(() => {
        baseline({ x: 1, y: 2 });
      }, 10000);

      // Custom operator compiled
      const custom = compile(expr, {
        operators: {
          Add: ['customAdd', 11],
        },
        functions: {
          customAdd: (a: number, b: number) => a + b,
        },
      });
      const customExec = benchmark(() => {
        custom({ x: 1, y: 2 });
      }, 10000);

      log(`  Baseline execution: ${baselineExec.toFixed(2)}ms`);
      log(`  Custom op execution: ${customExec.toFixed(2)}ms`);
      log(`  Overhead: ${(customExec - baselineExec).toFixed(2)}ms`);

      // Should be comparable (function call overhead is small)
      expect(customExec).toBeLessThan(baselineExec * 2);
    });
  });

  describe('Memory Usage', () => {
    it('should measure memory usage of compilation', () => {
      const expr = ce.parse('x^2 + y^2 + z^2');

      const memory = measureMemory(() => {
        for (let i = 0; i < 100; i++) {
          compile(expr);
        }
      });

      log(`  Memory for 100 compilations: ${(memory / 1024).toFixed(2)} KB`);
      log(`  Per compilation: ${(memory / 100 / 1024).toFixed(2)} KB`);

      // Should be reasonable (< 1MB for 100 compilations)
      expect(memory).toBeLessThan(1024 * 1024);
    });

    it('should measure memory usage of GLSL compilation', () => {
      const glsl = new GLSLTarget();
      const expr = ce.parse('\\sin(x) + \\cos(y)');

      const memory = measureMemory(() => {
        for (let i = 0; i < 100; i++) {
          glsl.compile(expr);
        }
      });

      log(`  GLSL memory for 100 compilations: ${(memory / 1024).toFixed(2)} KB`);
      log(`  Per compilation: ${(memory / 100 / 1024).toFixed(2)} KB`);

      expect(memory).toBeLessThan(1024 * 1024);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle distance formula efficiently', () => {
      // Common in game development and physics
      const expr = ce.parse('\\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}');

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 100);

      log(`  Distance formula compilation: ${(compilationTime / 100).toFixed(3)}ms`);

      const compiled = compile(expr);
      const testData = { x_1: 0, y_1: 0, x_2: 3, y_2: 4 };

      const evalTime = benchmark(() => {
        expr.evaluate(testData).numericValue;
      }, 10000);

      const compiledTime = benchmark(() => {
        compiled(testData);
      }, 10000);

      log(`  Distance evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Distance compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });

    it('should handle quadratic formula efficiently', () => {
      // Common in many applications
      const expr = ce.parse('\\frac{-b + \\sqrt{b^2 - 4ac}}{2a}');

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 100);

      log(`  Quadratic formula compilation: ${(compilationTime / 100).toFixed(3)}ms`);

      const compiled = compile(expr);
      const testData = { a: 1, b: -5, c: 6 };

      const evalTime = benchmark(() => {
        expr.evaluate(testData).numericValue;
      }, 10000);

      const compiledTime = benchmark(() => {
        compiled(testData);
      }, 10000);

      log(`  Quadratic evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Quadratic compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });

    it('should handle physics kinematics efficiently', () => {
      // Position with constant acceleration: s = ut + (1/2)at^2
      const expr = ce.parse('u \\cdot t + \\frac{1}{2} a \\cdot t^2');

      const compilationTime = benchmark(() => {
        compile(expr);
      }, 100);

      log(`  Kinematics compilation: ${(compilationTime / 100).toFixed(3)}ms`);

      const compiled = compile(expr);
      const testData = { u: 10, a: 9.8, t: 2 };

      const evalTime = benchmark(() => {
        expr.evaluate(testData).numericValue;
      }, 10000);

      const compiledTime = benchmark(() => {
        compiled(testData);
      }, 10000);

      log(`  Kinematics evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Kinematics compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });
  });

  describe('Compilation Caching', () => {
    it('should benefit from repeated compilation of same expression', () => {
      const latex = 'x^2 + y^2';

      // First compilation
      const firstTime = benchmark(() => {
        const expr = ce.parse(latex);
        compile(expr);
      }, 100);

      // Subsequent compilations (same expression)
      const cachedTime = benchmark(() => {
        const expr = ce.parse(latex);
        compile(expr);
      }, 100);

      log(`  First compilation: ${(firstTime / 100).toFixed(3)}ms`);
      log(`  Cached compilation: ${(cachedTime / 100).toFixed(3)}ms`);
      log(`  Difference: ${((firstTime - cachedTime) / 100).toFixed(3)}ms`);

      // Both should be fast
      expect(firstTime).toBeLessThan(1000);
      expect(cachedTime).toBeLessThan(1000);
    });
  });
});
