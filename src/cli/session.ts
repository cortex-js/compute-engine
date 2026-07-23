import { performance } from 'node:perf_hooks';

import { ComputeEngine, executeCortex, parseCortex } from '../cortex.js';
import type { ParsingDiagnostic } from '../cortex/diagnostics.js';

import type { CortexSession, EvaluationResult } from './types.js';

export function makeCortexSession(timeLimit: number): CortexSession {
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
        executeCortex(engine, source, {
          url,
          parseLatex,
        });
      const result =
        timeLimit > 0
          ? engine.withTimeLimit({ ms: timeLimit, label: 'cortex:cli' }, run)
          : run();

      return {
        source,
        ...result,
        elapsedMs: performance.now() - start,
      };
    },

    parse(source: string, url?: string): ParsingDiagnostic[] {
      try {
        return parseCortex(source, url, { parseLatex })[1];
      } catch {
        return [];
      }
    },

    reset(): void {
      engine = new ComputeEngine();
    },
  };
}
