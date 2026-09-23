import { performance } from 'node:perf_hooks';

import { ComputeEngine, executeEpsil, parseEpsil } from '../epsil.js';
import type { BoxedExpression } from '../compute-engine.js';
import { isTimeoutCancellation } from '../common/interruptible.js';
import type { ParsingDiagnostic } from '../epsil/diagnostics.js';

import type { EpsilSession, EvaluationResult } from './types.js';

export function makeEpsilSession(timeLimit: number): EpsilSession {
  let engine = new ComputeEngine();

  const parseLatex = (latex: string) => engine.parse(latex).json;

  return {
    get engine(): ComputeEngine {
      return engine;
    },

    timeLimit,

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
          { str: 'timeout' },
        ]);
      }
      return {
        source: latex,
        value,
        diagnostics: [],
        elapsedMs: performance.now() - start,
      };
    },

    parse(source: string, url?: string): ParsingDiagnostic[] {
      try {
        return parseEpsil(source, url, { parseLatex })[1];
      } catch {
        return [];
      }
    },

    reset(): void {
      engine = new ComputeEngine();
    },
  };
}
