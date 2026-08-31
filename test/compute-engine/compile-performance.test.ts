import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

/**
 * Performance benchmarks for the compilation system
 *
 * These tests measure:
 * - Compilation cost, as a deterministic count of compiler node visits
 * - Execution time (interpreted vs compiled)
 * - Memory usage
 * - Performance with different targets
 * - Impact of operator customization
 *
 * COMPILATION COST IS NEVER ASSERTED IN MILLISECONDS. A wall-clock budget for
 * compilation measures how loaded the machine is: the same assertions passed
 * in isolation and failed under a parallel full-suite run, which made a red
 * run uninformative. What a compile-cost test is actually defending against is
 * an algorithmic blowup — a traversal that revisits nodes, or per-compile state
 * that accumulates across calls — and that is visible as a node-visit count,
 * which is identical on every machine. `countCompileVisits` below counts calls
 * to `BaseCompiler.compile`, the single recursive entry point every target's
 * emitter routes through.
 *
 * The execution-speed comparisons further down (compiled runner vs
 * interpreter) are still timed, because there is no counter that can stand in
 * for "the generated code runs faster than the interpreter". They compare two
 * measurements taken back to back in the same process, so load affects both
 * sides, and their observed margins are one to two orders of magnitude.
 */

// Timing-asserting suite: excluded from the default run (its measured
// ratios are only meaningful on a quiet machine) and run via `npm run
// test:perf`, serially, ideally under the box lock — the same env-gate
// pattern as the CE_NIGHTLY tier.
const PERF = process.env.CE_PERF === '1';
const describePerf = PERF ? describe : describe.skip;

describePerf('COMPILATION PERFORMANCE', () => {
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

  /**
   * Count the compiler node visits performed by `fn`.
   *
   * `BaseCompiler.compile` is the recursive entry point: every target emitter
   * (JavaScript, GLSL, Python, …) descends into operands by calling it on the
   * `BaseCompiler` class object, so temporarily replacing that static method
   * observes the whole traversal regardless of target. The count is a pure
   * function of the expression and the options — no timers involved — so the
   * bounds asserted against it mean the same thing on every machine and under
   * any amount of concurrent test load.
   */
  function countCompileVisits(fn: () => void): number {
    const original = BaseCompiler.compile;
    let visits = 0;
    (BaseCompiler as { compile: typeof BaseCompiler.compile }).compile =
      function (this: unknown, ...args: Parameters<typeof original>) {
        visits += 1;
        return original.apply(this, args);
      } as typeof BaseCompiler.compile;
    try {
      fn();
    } finally {
      (BaseCompiler as { compile: typeof BaseCompiler.compile }).compile =
        original;
    }
    return visits;
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
    it('should compile simple arithmetic with a bounded, constant amount of work', () => {
      const expr = ce.parse('x + y');

      const once = countCompileVisits(() => {
        compile(expr);
      });
      const thousand = countCompileVisits(() => {
        for (let i = 0; i < 1000; i++) compile(expr);
      });

      log(`  Simple arithmetic compilation: ${once} node visits`);

      // `x + y` is `Add(x, y)`: the root plus its two operands, so three
      // visits. The bound is loose enough to survive a target emitter that
      // wraps an operand in one extra node, and tight enough that any
      // re-traversal of the tree trips it.
      expect(once).toBeLessThanOrEqual(8);
      // Cost per compilation does not grow with the number of compilations
      // already performed. This is the property the old millisecond budget
      // was really guarding: per-compile state that accumulates (a cache
      // keyed so it never hits, a naming inventory that is appended to
      // instead of reset) shows up here as a superlinear total.
      expect(thousand).toBe(once * 1000);
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
        compiled.run!(testData);
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
        compiled.run!({ x: 2.5 });
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
        compiled.run!(testData);
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
        compiled.run!(testData);
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
        compiled.run!({ x: 1.1 });
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
        compiled.run!(testData);
      }, 10000);

      log(`  Many vars evaluation: ${evalTime.toFixed(2)}ms`);
      log(`  Many vars compiled: ${compiledTime.toFixed(2)}ms`);
      log(`  Speedup: ${(evalTime / compiledTime).toFixed(2)}x`);

      expect(compiledTime).toBeLessThan(evalTime);
    });
  });

  describe('Different Targets', () => {
    it('should compile to JavaScript with a bounded, constant amount of work', () => {
      const expr = ce.parse('x^2 + y^2');

      const once = countCompileVisits(() => {
        compile(expr, { to: 'javascript' });
      });
      const thousand = countCompileVisits(() => {
        for (let i = 0; i < 1000; i++) compile(expr, { to: 'javascript' });
      });

      log(`  JavaScript target: ${once} node visits per compilation`);
      // `x^2 + y^2` is `Add(Power(x,2), Power(y,2))`: five nodes, visited once
      // each. Repeating the compilation costs exactly as much each time.
      expect(once).toBeLessThanOrEqual(12);
      expect(thousand).toBe(once * 1000);
    });

    it('should compile to GLSL with a bounded, constant amount of work', () => {
      const expr = ce.parse('x^2 + y^2');

      const once = countCompileVisits(() => {
        compile(expr, { to: 'glsl' });
      });
      const thousand = countCompileVisits(() => {
        for (let i = 0; i < 1000; i++) compile(expr, { to: 'glsl' });
      });

      log(`  GLSL target: ${once} node visits per compilation`);
      expect(once).toBeLessThanOrEqual(12);
      expect(thousand).toBe(once * 1000);
    });

    it('should handle target switching overhead', () => {
      const expr = ce.parse('\\sin(x) * \\cos(y)');

      const jsVisits = countCompileVisits(() => {
        compile(expr, { to: 'javascript' });
      });
      const glslVisits = countCompileVisits(() => {
        compile(expr, { to: 'glsl' });
      });

      log(`  JavaScript target: ${jsVisits} node visits`);
      log(`  GLSL target: ${glslVisits} node visits`);

      // Switching target must not change the SHAPE of the traversal: both
      // emitters walk the same expression tree once and differ only in the
      // source they print. Comparing the two counts catches a target that
      // starts re-descending (for example to decide a type it could have
      // asked for once), which a wall-clock comparison of two consecutive
      // benchmark loops could not distinguish from scheduler noise.
      expect(jsVisits).toBe(glslVisits);
      expect(jsVisits).toBeLessThanOrEqual(12);
    });
  });

  describe('Operator Customization', () => {
    it('should measure overhead of custom operators', () => {
      const expr = ce.parse('x + y * z');

      // Baseline: no customization
      const baselineVisits = countCompileVisits(() => {
        compile(expr);
      });

      // With operator customization
      const customVisits = countCompileVisits(() => {
        compile(expr, {
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
      });

      log(`  Baseline compilation: ${baselineVisits} node visits`);
      log(`  Custom operators: ${customVisits} node visits`);

      // Supplying an operator table redirects the source a node prints; it
      // must not add a traversal step. Equal visit counts state that exactly,
      // where the previous "the two benchmark loops are within 100 ms of each
      // other" could be satisfied or broken by scheduling alone.
      expect(customVisits).toBe(baselineVisits);
    });

    it('should measure execution overhead of custom operators', () => {
      const expr = ce.parse('x + y');

      // Baseline compiled
      const baseline = compile(expr);

      // Custom operator compiled
      const custom = compile(expr, {
        operators: {
          Add: ['customAdd', 11],
        },
        functions: {
          customAdd: (a: number, b: number) => a + b,
        },
      });

      // A single 10,000-call benchmark of either function is only a few
      // milliseconds, so the difference between two single-shot runs is
      // dominated by timer and scheduler noise on shared CI runners (a single
      // GC pause or deschedule is enough to trip a tight budget). Noise only
      // ever *adds* time, so measure each function best-of-N and compare the
      // minima: that filters out transient stalls and leaves the true
      // per-call cost. Warm up first so JIT compilation isn't charged to the
      // first measured trial.
      const bestOf = (fn: () => any): number => {
        for (let i = 0; i < 2000; i++) fn(); // warm up
        let best = Infinity;
        for (let trial = 0; trial < 7; trial++)
          best = Math.min(best, benchmark(fn, 10000));
        return best;
      };

      const baselineExec = bestOf(() => baseline.run!({ x: 1, y: 2 }));
      const customExec = bestOf(() => custom.run!({ x: 1, y: 2 }));

      log(`  Baseline execution: ${baselineExec.toFixed(2)}ms`);
      log(`  Custom op execution: ${customExec.toFixed(2)}ms`);
      log(`  Overhead: ${(customExec - baselineExec).toFixed(2)}ms`);

      // Keep the added overhead below 15ms across 10,000 calls (1.5
      // microseconds per call) to catch real regressions without flaking.
      expect(customExec - baselineExec).toBeLessThan(15);
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

      // Should be reasonable (< 8MB for 100 compilations). The budget needs
      // headroom over the observed range: jest doesn't expose `global.gc`,
      // so `measureMemory` can't force a collection and the heap delta
      // includes ambient garbage (2–4.6MB observed depending on machine
      // load; the published 0.73.0 package measures ~1.4MB for this same
      // loop under plain node, and the CSE harvest adds ~0.85MB of
      // TRANSIENT allocation — retained memory verified identical with
      // `--expose-gc`, ~4–7KB per 100 compiles, cse on or off). This
      // guards against leaks (an order-of-magnitude blowup), not
      // byte-level drift.
      expect(memory).toBeLessThan(8 * 1024 * 1024);
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

      // Same leak-guard-not-drift-guard contract as above: ~1.3–1.5MB
      // observed under load with the (transient) naming-context inventory
      // included. History: briefly read ~6.1MB when GPU_FUNCTIONS hit
      // exactly 128 entries and the per-call `{...GPU_FUNCTIONS, ...}`
      // merge in getFunctions() crossed V8's fast-property cliff into
      // dictionary mode (~45KB/compile of rehash garbage, no retention);
      // fixed by memoizing the merged table on the target instance.
      expect(memory).toBeLessThan(4 * 1024 * 1024);
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
        compiled.run!(testData);
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
        compiled.run!(testData);
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
        compiled.run!(testData);
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

      // First batch of parse-and-compile round trips
      const firstVisits = countCompileVisits(() => {
        for (let i = 0; i < 100; i++) compile(ce.parse(latex));
      });

      // Second batch, identical work on an engine that has now seen this
      // expression a hundred times
      const secondVisits = countCompileVisits(() => {
        for (let i = 0; i < 100; i++) compile(ce.parse(latex));
      });

      log(`  First batch: ${firstVisits} node visits`);
      log(`  Second batch: ${secondVisits} node visits`);

      // Re-parsing and re-compiling the same LaTeX must cost the same on the
      // hundredth round trip as on the first — no growth from a memo table
      // that is consulted linearly, and no growth from an expression cache
      // whose keys accumulate. Elapsed milliseconds could not express this:
      // the two batches were each merely required to finish inside a fixed
      // budget, so a slow but constant compile passed and a load spike
      // failed.
      expect(secondVisits).toBe(firstVisits);
      expect(firstVisits).toBeLessThanOrEqual(100 * 12);
    });
  });
});
