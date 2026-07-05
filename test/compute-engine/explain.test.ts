import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import { labelFor } from '../../src/compute-engine/boxed-expression/explain-labels';
import { UNIVARIATE_ROOTS } from '../../src/compute-engine/boxed-expression/solve';

export const ce = new ComputeEngine();

//
// A fixed corpus of LaTeX expressions spanning the simplify domains
// (rational simplification, powers, radicals, logs, trig identities,
// absolute value, numeric folding). Representative inputs are borrowed
// from `simplify.test.ts`.
//
const CORPUS: string[] = [
  // Numeric folding
  '2 + 4',
  '3/4 + 5/7',
  '1.234 + 5.678',
  '2(13.1+x) - 26.2 - 2x',
  '-1234 - 5678',
  // Rational simplification / cancellation
  '\\frac{x^2-1}{x-1}',
  'x/x',
  '\\pi/\\pi',
  '(\\pi+1)/(\\pi+1)',
  '1/(1/x)',
  'x/(a/b)',
  '2/3*5/x',
  // Powers
  'x^2/x',
  'x^5/x^7',
  '\\frac{a^5}{a^2}',
  '(x^2)^3',
  '(x^1)^3',
  'e^x e^{-x}',
  'e*e^x',
  '\\pi^2/\\pi',
  // Radicals
  '\\sqrt{x^2}',
  '\\sqrt{\\sqrt{x}}',
  '\\sqrt[3]{-2}',
  '\\sqrt[4]{16b^{4}}',
  '\\sqrt{0}',
  // Logs
  '\\ln(e^x)',
  '\\ln(1/x)',
  '\\frac{\\ln(9)}{\\ln(3)}',
  '\\ln(x^3) - 3\\ln(x)',
  '\\log_2(1/x)',
  '\\ln(e^x/y)+\\ln(y)',
  // Trig identities
  '\\sin^2(x) + \\cos^2(x)',
  '\\sin(\\pi + x)',
  '\\cos(-x)',
  '\\sin(-x)',
  // Absolute value
  '\\left|-x\\right|',
  '|-\\pi|',
  '|2x|-2|x|',
  '|-1-\\pi|',
  // Combine like terms
  'x+2*x',
  '2*\\pi * x^2-\\pi * x^2+2*\\pi',
];

// ============================================================
// 1. Contract battery
// ============================================================

describe('explain: contract battery', () => {
  for (const latex of CORPUS) {
    test(`contract: ${latex}`, () => {
      const expr = ce.parse(latex);
      const ex = expr.explain();

      // operation is always 'simplify' (default)
      expect(ex.operation).toBe('simplify');

      // result agrees with plain simplify()
      expect(ex.result.isSame(expr.simplify())).toBe(true);

      const { steps, initial, result } = ex;

      // Terminal contract: zero steps => result is the initial;
      // otherwise the last step value is the result.
      if (steps.length === 0) {
        expect(result.isSame(initial)).toBe(true);
      } else {
        expect(steps.at(-1)!.value.isSame(result)).toBe(true);
        // First step differs from the initial.
        expect(steps[0].value.isSame(initial)).toBe(false);
      }

      // Consecutive step values differ pairwise.
      for (let i = 1; i < steps.length; i++)
        expect(steps[i].value.isSame(steps[i - 1].value)).toBe(false);

      // Every step has a non-empty string id and description.
      for (const s of steps) {
        expect(typeof s.id).toBe('string');
        expect(s.id.length).toBeGreaterThan(0);
        expect(typeof s.description).toBe('string');
        expect(s.description.length).toBeGreaterThan(0);
      }
    });
  }
});

// ============================================================
// 2. Curation
// ============================================================

describe('explain: curation', () => {
  test("'default' contains no bookkeeping ids", () => {
    for (const latex of CORPUS) {
      const ex = ce.parse(latex).explain();
      for (const s of ex.steps) {
        expect(s.id).not.toBe('initial');
        expect(s.id).not.toBe('simplified operands');
      }
    }
  });

  test("'all' is a superset of 'default'", () => {
    // For expressions that produce a non-trivial trace, the raw chain is at
    // least as long as the curated one.
    const nonTrivial = [
      '\\frac{x^2-1}{x-1}',
      '\\ln(x^3) - 3\\ln(x)',
      '\\sqrt{x^2}',
      '\\frac{a^5}{a^2}',
      '\\sin^2(x) + \\cos^2(x)',
    ];
    for (const latex of nonTrivial) {
      const expr = ce.parse(latex);
      const all = expr.explain('simplify', { verbosity: 'all' });
      const def = ce.parse(latex).explain();
      expect(all.steps.length).toBeGreaterThanOrEqual(def.steps.length);
    }
  });
});

// ============================================================
// 3. Golden explanations
// ============================================================

function serializeExplanation(latex: string): {
  initial: string;
  result: string;
  steps: string[];
} {
  const ex = ce.parse(latex).explain();
  return {
    initial: ex.initial.toString(),
    result: ex.result.toString(),
    steps: ex.steps.map((s) => `${s.id}: ${s.value.toString()}`),
  };
}

describe('explain: golden explanations', () => {
  test('(x^2-1)/(x-1): cancel common polynomial factors', () => {
    expect(serializeExplanation('\\frac{x^2-1}{x-1}')).toMatchSnapshot();
  });

  test('sin^2(x) + cos^2(x): Pythagorean identity', () => {
    expect(serializeExplanation('\\sin^2(x) + \\cos^2(x)')).toMatchSnapshot();
  });

  test('ln(x^3): log rule brings the exponent out (transform)', () => {
    // Note: `\ln(x^3) - 3\ln(x)` reaches 0 via a single `expand` step (the
    // combined terms cancel), so it carries no transform step. `\ln(x^3)`
    // on its own fires `log(x^n) -> n log x`, which grows the expression
    // and is therefore tagged `purpose: 'transform'` (cost-gate-exempt).
    const ex = ce.parse('\\ln(x^3)').explain();
    expect({
      initial: ex.initial.toString(),
      result: ex.result.toString(),
      steps: ex.steps.map((s) => `${s.id}: ${s.value.toString()}`),
    }).toMatchSnapshot();
    expect(ex.steps.some((s) => s.purpose === 'transform')).toBe(true);
  });

  test('sqrt(x^2) -> |x|', () => {
    expect(serializeExplanation('\\sqrt{x^2}')).toMatchSnapshot();
  });

  test('a^5/a^2: exponent subtraction', () => {
    expect(serializeExplanation('\\frac{a^5}{a^2}')).toMatchSnapshot();
  });

  test('|-x| -> |x|: abs-negate', () => {
    expect(serializeExplanation('\\left|-x\\right|')).toMatchSnapshot();
  });

  test('sin(pi + x): angle shift', () => {
    expect(serializeExplanation('\\sin(\\pi + x)')).toMatchSnapshot();
  });

  test('x - 1: canonicalization out of frame (zero steps)', () => {
    // `x - 1` is boxed as `Add(x, -1)` at canonicalization time (Subtract →
    // Add). That rewrite is out of the explain frame, and simplify finds
    // nothing further to do, so the chain has zero steps. This documents the
    // "canonicalization out of frame" contract (design §4).
    //
    // Surprise: the design doc's suggested zero-step example, `e^{\ln x}`,
    // does NOT reduce at canonicalization — its `initial` is `e^(ln(x))` and
    // it takes one simplify step (`e^ln(x) -> x`) to reach `x`. See the
    // `e^{ln x}: reduces via simplify` case below.
    const ex = ce.parse('x - 1').explain();
    expect(ex.steps.length).toBe(0);
    expect(ex.result.isSame(ex.initial)).toBe(true);
    expect(serializeExplanation('x - 1')).toMatchSnapshot();
  });

  test('e^{ln x}: reduces via simplify (one step), not canonicalization', () => {
    // Contrary to the design doc's assumption, canonicalization leaves
    // `e^(ln x)` intact; simplify reduces it in one step.
    const ex = ce.parse('e^{\\ln x}').explain();
    expect(ex.initial.toString()).toBe('e^(ln(x))');
    expect(ex.steps.length).toBe(1);
    expect(ex.result.isSame(ce.parse('x'))).toBe(true);
    expect(serializeExplanation('e^{\\ln x}')).toMatchSnapshot();
  });

  test('(x+1)^2 - x^2 - 2x - 1 -> 0', () => {
    expect(serializeExplanation('(x+1)^2 - x^2 - 2x - 1')).toMatchSnapshot();
  });

  test('sqrt[4]{16 b^4}: multi-step radical chain', () => {
    expect(serializeExplanation('\\sqrt[4]{16b^{4}}')).toMatchSnapshot();
  });
});

// ============================================================
// 4. Serialization
// ============================================================

describe('explain: serialization', () => {
  const cases = [
    '\\frac{x^2-1}{x-1}',
    '\\ln(x^3) - 3\\ln(x)',
    '\\sqrt{x^2}',
    '\\sin^2(x) + \\cos^2(x)',
    '2(13.1+x) - 26.2 - 2x',
  ];

  for (const latex of cases) {
    test(`round-trips json/latex: ${latex}`, () => {
      const ex = ce.parse(latex).explain();

      // initial.json re-boxes to the same expression
      expect(ce.box(ex.initial.json).isSame(ex.initial)).toBe(true);

      for (const s of ex.steps) {
        // each step value round-trips through json
        expect(ce.box(s.value.json).isSame(s.value)).toBe(true);
        // each step value has a non-empty latex serialization
        expect(typeof s.value.latex).toBe('string');
        expect(s.value.latex.length).toBeGreaterThan(0);
      }

      // JSON.stringify of a plain projection does not throw
      expect(() =>
        JSON.stringify({
          operation: ex.operation,
          steps: ex.steps.map((s) => ({
            id: s.id,
            description: s.description,
          })),
        })
      ).not.toThrow();
    });
  }
});

// ============================================================
// 5. Unsupported operations
// ============================================================

describe('explain: unsupported operations throw', () => {
  test("explain('solve') on a system throws", () => {
    expect(() =>
      ce.box(['List', ce.parse('x + y = 2'), ce.parse('x - y = 0')]).explain('solve')
    ).toThrow();
  });
  test("explain('solve') with several unknowns throws", () => {
    expect(() => ce.parse('x + y = 2').explain('solve')).toThrow();
  });
});

// ============================================================
// 6. Trivial receivers
// ============================================================

describe('explain: trivial receivers', () => {
  test('a number has zero steps', () => {
    const ex = ce.box(42).explain();
    expect(ex.steps.length).toBe(0);
    expect(ex.initial.isSame(42)).toBe(true);
    expect(ex.result.isSame(42)).toBe(true);
  });

  test('a string has zero steps', () => {
    const ex = ce.string('hello').explain();
    expect(ex.steps.length).toBe(0);
    expect(ex.initial.isSame(ex.result)).toBe(true);
  });
});

// ============================================================
// 7. Solve rule ids lock
// ============================================================

describe('solve: UNIVARIATE_ROOTS rule ids', () => {
  test('every object rule has a well-formed, unique id', () => {
    const ids: string[] = [];
    for (const rule of UNIVARIATE_ROOTS) {
      if (typeof rule !== 'object' || rule === null) continue;
      const id = (rule as { id?: string }).id;
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^solve\.[a-z0-9-]+$/);
      ids.push(id!);
    }
    // ids present
    expect(ids.length).toBeGreaterThan(0);
    // all unique
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ============================================================
// 8. Label coverage harness (opt-in)
// ============================================================

const describeCoverage = process.env.EXPLAIN_LABEL_COVERAGE
  ? describe
  : describe.skip;

describeCoverage('explain: label coverage', () => {
  test('>= 90% of fired steps resolve to a registered label', () => {
    const src = readFileSync(join(__dirname, 'simplify.test.ts'), 'utf-8');

    // Extract the first string argument of every `checkSimplify('...')` call.
    const inputs: string[] = [];
    const re = /checkSimplify\(\s*'((?:[^'\\]|\\.)*)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const raw = m[1].replace(/\\\\/g, '\\').replace(/\\'/g, "'");
      inputs.push(raw);
    }
    expect(inputs.length).toBeGreaterThan(0);

    const skip = new Set(['simplified operands', 'initial']);
    let fired = 0;
    let registered = 0;
    for (const latex of inputs) {
      let ex;
      try {
        ex = ce.parse(latex).explain('simplify', { verbosity: 'all' });
      } catch {
        continue;
      }
      for (const s of ex.steps) {
        if (skip.has(s.id)) continue;
        fired++;
        if (labelFor(s.id).registered) registered++;
      }
    }

    expect(fired).toBeGreaterThan(0);
    const coverage = registered / fired;
    // Report for visibility when the suite runs with the flag.
    // eslint-disable-next-line no-console
    console.info(
      `label coverage: ${registered}/${fired} = ${(coverage * 100).toFixed(1)}%`
    );
    expect(coverage).toBeGreaterThanOrEqual(0.9);
  });
});

// ============================================================
// 9. Solve contract battery
// ============================================================

//
// A univariate equation corpus spanning the algorithmic phases of
// `findUnivariateRoots` (linear, quadratic variants, radical, absolute value,
// exponential, logarithmic, trigonometric, zero-product, rational-power,
// reciprocal, higher-degree polynomial). Each entry optionally names the
// unknown when the equation carries symbolic coefficients (a second symbol
// that would otherwise be read as an additional unknown).
//
const SOLVE_CORPUS: { latex: string; variable?: string }[] = [
  { latex: '2x+1=5' }, // linear
  { latex: '3x - 9 = 0' }, // linear (no move-terms)
  { latex: 'x^2 - 5x + 6 = 0' }, // quadratic
  { latex: 'x^2 = 2x' }, // quadratic, no constant
  { latex: 'a x^2 = b', variable: 'x' }, // quadratic, symbolic coefficients
  { latex: '\\sqrt{x+1}=x-1' }, // radical (extraneous root)
  { latex: '|x-1|=2' }, // absolute value
  { latex: 'e^{2x}-3e^x+2=0' }, // exponential (substitution)
  { latex: '\\ln(x) = 2' }, // logarithmic
  { latex: '\\sin(x)=1/2' }, // trigonometric
  { latex: '\\ln(x)\\cdot(x-1)=0' }, // zero-product
  { latex: '2\\sqrt{x}+3\\sqrt[4]{x}=2' }, // rational powers (substitution)
  { latex: '1/x = 3' }, // reciprocal
  { latex: 'x^3-6x^2+11x-6=0' }, // higher-degree polynomial
];

describe('explain: solve contract battery', () => {
  for (const { latex, variable } of SOLVE_CORPUS) {
    test(`solve contract: ${latex}${variable ? ` (in ${variable})` : ''}`, () => {
      // Build the receiver once and call both methods on it.
      const expr = ce.parse(latex);
      const roots = variable ? expr.solve(variable) : expr.solve();
      const ex = variable
        ? expr.explain('solve', { variable })
        : expr.explain('solve');

      // operation + framing
      expect(ex.operation).toBe('solve');
      expect(ex.initial.operator).toBe('Equal');

      // result is a List whose ops match `solve()` exactly (length, order,
      // pairwise isSame).
      expect(ex.result.operator).toBe('List');
      expect(roots).not.toBeNull();
      const resultOps = ex.result.ops!;
      expect(resultOps.length).toBe(roots!.length);
      for (let i = 0; i < roots!.length; i++)
        expect(resultOps[i].isSame(roots![i])).toBe(true);

      // Every step has a non-empty id and description.
      for (const s of ex.steps) {
        expect(typeof s.id).toBe('string');
        expect(s.id.length).toBeGreaterThan(0);
        expect(typeof s.description).toBe('string');
        expect(s.description.length).toBeGreaterThan(0);
      }

      // Consecutive step values differ pairwise.
      for (let i = 1; i < ex.steps.length; i++)
        expect(ex.steps[i].value.isSame(ex.steps[i - 1].value)).toBe(false);

      // Every `solve.*` id resolves to a registered label (no prettifier
      // fallback for the solve phase/template ids).
      for (const s of ex.steps)
        if (s.id.startsWith('solve.'))
          expect(labelFor(s.id).registered).toBe(true);
    });
  }
});

// ============================================================
// 10. Golden solve explanations
// ============================================================

function serializeSolve(
  latex: string,
  options?: { variable?: string }
): { initial: string; result: string; steps: string[] } {
  const ex = ce.parse(latex).explain('solve', options);
  return {
    initial: ex.initial.toString(),
    result: ex.result.toString(),
    steps: ex.steps.map((s) => `${s.id}: ${s.value.toString()}`),
  };
}

describe('explain: golden solve explanations', () => {
  test('2x+1=5: linear isolation', () => {
    expect(serializeSolve('2x+1=5')).toMatchSnapshot();
  });

  test('x^2=4: quadratic (two roots)', () => {
    expect(serializeSolve('x^2=4')).toMatchSnapshot();
  });

  test('sqrt(x+1)=x-1: extraneous-root rejection', () => {
    const ex = ce.parse('\\sqrt{x+1}=x-1').explain('solve');
    // The radical branch squares both sides, so it must validate the
    // candidates and reject the extraneous one.
    expect(ex.steps.some((s) => s.id === 'solve.validate-roots')).toBe(true);
    expect(serializeSolve('\\sqrt{x+1}=x-1')).toMatchSnapshot();
  });

  test('|x-1|=2: two absolute-value branches', () => {
    const ex = ce.parse('|x-1|=2').explain('solve');
    expect(ex.steps.some((s) => s.id === 'solve.absolute-value-positive')).toBe(
      true
    );
    expect(ex.steps.some((s) => s.id === 'solve.absolute-value-negative')).toBe(
      true
    );
    expect(serializeSolve('|x-1|=2')).toMatchSnapshot();
  });

  test('e^{2x}-3e^x+2=0: substitute / substituted-equation / back-substitute', () => {
    const ex = ce.parse('e^{2x}-3e^x+2=0').explain('solve');
    const ids = ex.steps.map((s) => s.id);
    const iSub = ids.indexOf('solve.substitute');
    const iEq = ids.indexOf('solve.substituted-equation');
    const iBack = ids.indexOf('solve.back-substitute');
    expect(iSub).toBeGreaterThanOrEqual(0);
    expect(iEq).toBeGreaterThan(iSub);
    expect(iBack).toBeGreaterThan(iEq);
    expect(serializeSolve('e^{2x}-3e^x+2=0')).toMatchSnapshot();
  });

  test('ln(x)*(x-1)=0: zero-product', () => {
    const ex = ce.parse('\\ln(x)\\cdot(x-1)=0').explain('solve');
    const zp = ex.steps.find((s) => s.id === 'solve.factor-zero-product');
    expect(zp).toBeDefined();
    // The branch is rendered as a single step whose value lists the
    // sub-equations (design §8 Q5).
    expect(zp!.value.operator).toBe('List');
    expect(serializeSolve('\\ln(x)\\cdot(x-1)=0')).toMatchSnapshot();
  });

  test('2sqrt(x)+3root(4,x)=2: rational-power substitution', () => {
    expect(serializeSolve('2\\sqrt{x}+3\\sqrt[4]{x}=2')).toMatchSnapshot();
  });

  test('sin(x)=1/2: inverse trig with second branch', () => {
    expect(serializeSolve('\\sin(x)=1/2')).toMatchSnapshot();
  });
});

// ============================================================
// 11. Verbosity ('all' is a superset of 'default')
// ============================================================

describe('explain: solve verbosity', () => {
  test("'all' keeps at least as many steps as 'default'", () => {
    const expr = ce.parse('\\sqrt{x+1}=x-1');
    const all = expr.explain('solve', { verbosity: 'all' });
    const def = ce.parse('\\sqrt{x+1}=x-1').explain('solve');
    expect(all.steps.length).toBeGreaterThanOrEqual(def.steps.length);
  });
});

// ============================================================
// 12. Variable option
// ============================================================

describe('explain: solve variable option', () => {
  test('options.variable narrows a two-symbol equation', () => {
    const expr = ce.parse('a x = 6');
    const ex = expr.explain('solve', { variable: 'x' });
    const roots = expr.solve('x');
    expect(roots).not.toBeNull();
    expect(ex.result.operator).toBe('List');
    expect(ex.result.ops!.length).toBe(roots!.length);
    for (let i = 0; i < roots!.length; i++)
      expect(ex.result.ops![i].isSame(roots![i])).toBe(true);
  });

  test('without options.variable, two unknowns throw', () => {
    expect(() => ce.parse('a x = 6').explain('solve')).toThrow();
  });
});

// ============================================================
// 13. Zero-overhead sanity (no state leakage)
// ============================================================

describe('explain: solve does not perturb solve()', () => {
  test('solve() returns the same value before and after explain()', () => {
    const expr = ce.parse('\\sqrt{x+1}=x-1');
    const before = expr.solve();
    expr.explain('solve');
    const after = expr.solve();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.length).toBe(before!.length);
    for (let i = 0; i < before!.length; i++)
      expect(after![i].isSame(before![i])).toBe(true);
  });
});

// ============================================================
// 14. D contract battery
// ============================================================

//
// A corpus of differentiable expressions spanning the branches of the
// `differentiate()` switch: polynomial sum/power, product rule (incl. a
// triple product), chain rule, quotient rule, exponential rule (base e and
// base 2), the log chain, the general power rule (x^x), radical chains, and
// trig products. Each entry differentiates in `x` (inferred: single unknown).
//
const D_CORPUS: string[] = [
  'x^3+2x+1', // sum + power + product
  'x \\sin x', // product + known-derivative
  '\\sin(x^2)', // chain + power
  '\\frac{x^2+1}{x-1}', // quotient rule
  'e^{\\cos x}', // exponential rule + chain
  '\\ln(\\sin x)', // log chain
  'x^x', // general power rule
  '\\sqrt{x^2+1}', // chain + power (radical)
  '\\cos(x) \\sin(x)', // product of two trig
  '\\tan(3x)', // chain + product
  '2^x', // exponential rule (base != e)
  'x e^x \\sin x', // triple product
];

describe('explain: D contract battery', () => {
  for (const latex of D_CORPUS) {
    test(`D contract: ${latex}`, () => {
      // Build the receiver once and call both the operator and explain on it.
      const expr = ce.parse(latex);
      const ex = expr.explain('D');
      const dEval = ce
        .function('D', [expr, ce.symbol('x')])
        .evaluate();

      // operation + framing
      expect(ex.operation).toBe('D');
      expect(ex.initial.operator).toBe('D');

      // Result parity: the driver evaluates the actual D operator.
      expect(ex.result.isSame(dEval)).toBe(true);

      const { steps, result } = ex;

      // Every case in this corpus takes at least one step.
      expect(steps.length).toBeGreaterThanOrEqual(1);

      // Consecutive step values differ pairwise.
      for (let i = 1; i < steps.length; i++)
        expect(steps[i].value.isSame(steps[i - 1].value)).toBe(false);

      // The last step value is the result.
      expect(steps.at(-1)!.value.isSame(result)).toBe(true);

      // Every step id is a registered `derivative.*` label with a
      // non-empty description.
      for (const s of steps) {
        expect(s.id.startsWith('derivative.')).toBe(true);
        expect(labelFor(s.id).registered).toBe(true);
        expect(typeof s.description).toBe('string');
        expect(s.description.length).toBeGreaterThan(0);
      }

      // Intermediate steps may carry inert `D(...)` sub-expressions (the
      // point of the traversal-order presentation), but the final step must
      // be fully resolved: no `D` operator remains.
      expect(steps.at(-1)!.value.has('D')).toBe(false);
    });
  }
});

// ============================================================
// 15. Golden D explanations
// ============================================================

function serializeD(
  latex: string,
  options?: { variable?: string }
): { initial: string; result: string; steps: string[] } {
  const ex = ce.parse(latex).explain('D', options);
  return {
    initial: ex.initial.toString(),
    result: ex.result.toString(),
    steps: ex.steps.map((s) => `${s.id}: ${s.value.toString()}`),
  };
}

describe('explain: golden D explanations', () => {
  test('x sin(x): product rule + known derivative', () => {
    const ex = ce.parse('x \\sin x').explain('D');
    expect(ex.steps.some((s) => s.id === 'derivative.product-rule')).toBe(true);
    expect(ex.steps.some((s) => s.id === 'derivative.known-derivative')).toBe(
      true
    );
    expect(serializeD('x \\sin x')).toMatchSnapshot();
  });

  test('sin(x^2): chain rule + power rule', () => {
    const ex = ce.parse('\\sin(x^2)').explain('D');
    expect(ex.steps.some((s) => s.id === 'derivative.chain-rule')).toBe(true);
    expect(ex.steps.some((s) => s.id === 'derivative.power-rule')).toBe(true);
    expect(serializeD('\\sin(x^2)')).toMatchSnapshot();
  });

  test('(x^2+1)/(x-1): quotient rule chain', () => {
    const ex = ce.parse('\\frac{x^2+1}{x-1}').explain('D');
    expect(ex.steps.some((s) => s.id === 'derivative.quotient-rule')).toBe(true);
    expect(serializeD('\\frac{x^2+1}{x-1}')).toMatchSnapshot();
  });

  test('e^{cos x}: exponential rule + chain', () => {
    const ex = ce.parse('e^{\\cos x}').explain('D');
    expect(ex.steps.some((s) => s.id === 'derivative.exponential-rule')).toBe(
      true
    );
    expect(serializeD('e^{\\cos x}')).toMatchSnapshot();
  });

  test('x^x: general power rule', () => {
    const ex = ce.parse('x^x').explain('D');
    expect(
      ex.steps.some((s) => s.id === 'derivative.general-power-rule')
    ).toBe(true);
    expect(serializeD('x^x')).toMatchSnapshot();
  });

  test('x^3+2x+1: sum / power / product chain', () => {
    const ex = ce.parse('x^3+2x+1').explain('D');
    expect(ex.steps.some((s) => s.id === 'derivative.sum-rule')).toBe(true);
    expect(ex.steps.some((s) => s.id === 'derivative.power-rule')).toBe(true);
    expect(serializeD('x^3+2x+1')).toMatchSnapshot();
  });
});

// ============================================================
// 16. D variable handling
// ============================================================

describe('explain: D variable option', () => {
  test('options.variable selects the variable of differentiation', () => {
    const inX = ce.parse('a x^2').explain('D', { variable: 'x' });
    const inA = ce.parse('a x^2').explain('D', { variable: 'a' });
    // d/dx (a x^2) = 2 a x ; d/da (a x^2) = x^2 — different results.
    expect(inX.result.isSame(inA.result)).toBe(false);
    expect(
      inX.result.isSame(
        ce.function('D', [ce.parse('a x^2'), ce.symbol('x')]).evaluate()
      )
    ).toBe(true);
    expect(
      inA.result.isSame(
        ce.function('D', [ce.parse('a x^2'), ce.symbol('a')]).evaluate()
      )
    ).toBe(true);
  });

  test('two unknowns without options.variable throws', () => {
    expect(() => ce.parse('a x^2').explain('D')).toThrow();
  });

  test('a single unknown is inferred', () => {
    const ex = ce.parse('x^2').explain('D');
    expect(
      ex.result.isSame(
        ce.function('D', [ce.parse('x^2'), ce.symbol('x')]).evaluate()
      )
    ).toBe(true);
  });
});

// ============================================================
// 17. D verbosity ('all' is a superset of 'default')
// ============================================================

describe('explain: D verbosity', () => {
  test("'all' keeps at least as many steps as 'default'", () => {
    const all = ce.parse('x e^x \\sin x').explain('D', { verbosity: 'all' });
    const def = ce.parse('x e^x \\sin x').explain('D');
    expect(all.steps.length).toBeGreaterThanOrEqual(def.steps.length);
  });
});

// ============================================================
// 18. D zero-overhead sanity (no state leakage)
// ============================================================

describe('explain: D does not perturb the D operator', () => {
  test('D(...) evaluates the same before and after explain()', () => {
    const expr = ce.parse('x \\sin x');
    const before = ce.function('D', [expr, ce.symbol('x')]).evaluate();
    expr.explain('D');
    const after = ce.function('D', [expr, ce.symbol('x')]).evaluate();
    expect(after.isSame(before)).toBe(true);
  });
});
