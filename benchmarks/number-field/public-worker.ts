import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import {
  ComputeEngine,
  factor,
  factorDetailed,
  type ExpressionInput,
} from '../../src/compute-engine.js';
import { decodePublicFactor } from './verify.js';
import type { Element, Rational } from './corpus.js';

const backend = process.argv[2];
const ce = new ComputeEngine();
const rational = ([n, d]: Rational): ExpressionInput => [
  'Rational',
  { num: n },
  { num: d },
];
console.log(JSON.stringify({ ready: true, runtime: process.version, backend }));
for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  try {
    const start = performance.now();
    const generator: ExpressionInput = [
      'AlgebraicGenerator',
      ['List', ...msg.modulus.map(rational)],
    ];
    const coefficient = (e: Element): ExpressionInput => [
      'Add',
      ...e.map((q, i): ExpressionInput => [
        'Multiply',
        rational(q),
        ['Power', generator, i],
      ]),
    ];
    const polynomial: ExpressionInput = [
      'Add',
      ...msg.coefficients.map((e: Element, i: number): ExpressionInput => [
        'Multiply',
        coefficient(e),
        ['Power', 'x', i],
      ]),
    ];
    const input = ce.expr(polynomial),
      g = ce.expr(generator);
    const conversionMs = performance.now() - start,
      solve = performance.now();
    const detailed =
      backend === 'public-detailed'
        ? factorDetailed(input, { variable: 'x', generator: g })
        : undefined;
    const output =
      detailed?.expression ??
      (backend === 'public-helper'
        ? factor(input, { variable: 'x', generator: g })
        : ce.expr(['Factor', input, 'x', g]).evaluate());
    const solveMs = performance.now() - solve;
    const structuredExpression =
      detailed && detailed.status === 'complete'
        ? [
            'Multiply',
            detailed.coefficient.json,
            ...detailed.factors.map((f) => [
              'Power',
              f.factor.json,
              f.multiplicity,
            ]),
          ]
        : undefined;
    const complete = detailed
      ? detailed.status === 'complete'
      : output.operator !== 'Factor';
    const result = complete
      ? { status: 'complete', ...decodePublicFactor(msg.modulus, output.json) }
      : {
          status: 'incomplete',
          reason:
            detailed && 'reason' in detailed
              ? detailed.reason
              : 'unevaluated-public-request',
          factors: [],
        };
    console.log(
      JSON.stringify({
        id: msg.id,
        conversionMs,
        solveMs,
        expression: output.json,
        structuredExpression,
        publicStatus: detailed?.status,
        failureStage:
          detailed && 'stage' in detailed ? detailed.stage : undefined,
        statistics: detailed?.statistics,
        result,
      })
    );
  } catch (e) {
    console.log(JSON.stringify({ id: msg.id, error: String(e) }));
  }
}
