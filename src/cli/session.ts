import { performance } from 'node:perf_hooks';

import {
  ComputeEngine,
  executeEpsil,
  executeEpsilAsync,
  parseEpsil,
  type ExecuteEpsilResult,
} from '../epsil.js';
import type { BoxedExpression } from '../compute-engine.js';
import {
  budgetCauseOf,
  isTimeoutCancellation,
} from '../common/interruptible.js';
import type { ParsingDiagnostic } from '../epsil/diagnostics.js';
import type { KernelPool } from '../compute-engine/kernel-pool-types.js';

import { evaluateCompiled } from './compile.js';
import type { EpsilSession, EvaluationResult, InputFormat } from './types.js';

/** A session of the command line, the REPL or the MCP server. `workers`,
 * when given, is the kernel pool of the engine (`ce.workers`), and of each
 * engine that `reset()` builds. The caller owns the pool and disposes of
 * it. */
export function makeEpsilSession(
  timeLimit: number,
  workers?: KernelPool
): EpsilSession {
  const newEngine = () =>
    workers === undefined
      ? new ComputeEngine()
      : new ComputeEngine({ workers });
  let engine = newEngine();

  const parseLatex = (latex: string) => engine.parse(latex).json;

  return {
    get engine(): ComputeEngine {
      return engine;
    },

    timeLimit,

    workers,

    evaluate(source: string, url?: string): EvaluationResult {
      const start = performance.now();
      const run = () =>
        executeEpsil(engine, source, {
          url,
          parseLatex,
        });
      const result =
        timeLimit > 0
          ? engine.withTimeLimit({ ms: timeLimit, label: 'epsil:cli' }, run)
          : run();

      return {
        source,
        ...result,
        elapsedMs: performance.now() - start,
      };
    },

    async evaluateAsync(
      source: string,
      url?: string,
      signal?: AbortSignal
    ): Promise<EvaluationResult> {
      const start = performance.now();
      // `executeEpsilAsync` reads the deadline frame of the enclosing span
      // when it is called, and applies it to the whole program, although
      // the span closes when the call returns its promise.
      let pending: Promise<ExecuteEpsilResult> | undefined;
      const run = () => {
        pending = executeEpsilAsync(engine, source, {
          url,
          parseLatex,
          signal,
        });
        return 0;
      };
      if (timeLimit > 0)
        engine.withTimeLimit({ ms: timeLimit, label: 'epsil:cli' }, run);
      else run();
      const result = await pending!;

      return {
        source,
        ...result,
        elapsedMs: performance.now() - start,
      };
    },

    evaluateLatex(latex: string): EvaluationResult {
      const start = performance.now();
      let value: BoxedExpression;
      try {
        const run = () => engine.parse(latex).evaluate();
        value =
          timeLimit > 0
            ? engine.withTimeLimit({ ms: timeLimit, label: 'epsil:cli' }, run)
            : run();
      } catch (error) {
        if (!isTimeoutCancellation(error)) throw error;
        // The same error value an Epsil program produces on a timeout.
        value = engine.box([
          'Error',
          { str: error instanceof Error ? error.message : 'Timeout exceeded' },
          { str: budgetCauseOf(error) },
        ]);
      }
      return {
        source: latex,
        value,
        diagnostics: [],
        elapsedMs: performance.now() - start,
      };
    },

    compile(source: string, inputFormat: InputFormat, url?: string) {
      return evaluateCompiled(engine, source, { url, inputFormat, timeLimit });
    },

    parse(source: string, url?: string): ParsingDiagnostic[] {
      try {
        return parseEpsil(source, url, { parseLatex })[1];
      } catch {
        return [];
      }
    },

    reset(): void {
      engine = newEngine();
    },
  };
}
