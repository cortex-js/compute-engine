import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEST_PYTHON } from './test-python';

import { ComputeEngine } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * Compiled Python reads an absent input as `NaN` in arithmetic (ROADMAP
 * CE-395, user decision 2026-10-25).
 *
 * A caller passes `None`, the Python spelling of `Missing`, for an absent
 * input. `None + 1`, `1 / None` and `np.sin(None)` raise a `TypeError`,
 * where the interpreter answers `NaN` (`Missing + 1`) and compiled
 * JavaScript gives `NaN` (`undefined + 1`). The compiled code reads such an
 * input as `float('nan')` at a numeric operand of an operator that
 * propagates absence. Only an input whose type can hold `missing`
 * (`number | missing`, `any`, and `unknown`, the type of a free symbol of a
 * parsed expression: ROADMAP CE-460) pays for the test. A comparison
 * keeps its own `is None` test, so `p ≠ 0` stays undecided for an absent
 * `p`.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('p', 'number | missing');
  ce.declare('a', 'any');
  ce.declare('x', 'number');
  return ce;
}

const GUARD = '((1 < 1 / (float(\'nan\') if p is None else p)))';

describe('COMPILE Python: an absent input in arithmetic (CE-395)', () => {
  const ce = engine();
  const python = new PythonTarget();
  const src = (json: unknown): string =>
    python.compile(ce.box(json as never)).code;

  it('reads a `number | missing` input as NaN in arithmetic', () => {
    expect(src(['Add', 'p', 1])).toBe("(float('nan') if p is None else p) + 1");
    expect(src(['Sin', 'p'])).toBe("np.sin((float('nan') if p is None else p))");
    expect(src(['Add', 'a', 1])).toBe("(float('nan') if a is None else a) + 1");
  });

  it('leaves an input that cannot be absent unchanged', () => {
    expect(src(['Add', 'x', 1])).toBe('x + 1');
    expect(src(['Sin', 'x'])).toBe('np.sin(x)');
  });

  it('reads an input typed `unknown` as NaN in arithmetic (CE-460)', () => {
    // A parsed free symbol is typed `unknown`. A caller can pass `None` for
    // it, so its read is converted too (user decision 2026-10-25).
    expect(python.compile(ce.parse('2\\pi r')).code).toBe(
      "2 * np.pi * (float('nan') if r is None else r)"
    );
  });

  it('keeps the `is None` test of a comparison', () => {
    expect(src(['NotEqual', 'p', 0])).toBe(
      '(lambda _tv1: (None if ((_tv1 is None)) else (((_tv1) != (0)))))(p)'
    );
    const guard = src([
      'If',
      ['And', ['NotEqual', 'p', 0], ['Greater', ['Divide', 1, 'p'], 1]],
      1,
      -1,
    ]);
    expect(guard).toContain(GUARD);
    expect(guard).toContain('(lambda _tv1: (None if ((_tv1 is None)) else');
  });

  it('leaves an operator that handles absence unchanged', () => {
    expect(src(['Max', 'p', 5])).not.toContain("float('nan') if p is None");
  });

  it('reads the input on every route', () => {
    const e = ce.box(['Add', 'p', 1] as never);
    expect(python.compileFunction(e, 'f', ['p'])).toContain(
      "return (float('nan') if p is None else p) + 1"
    );
    expect(python.compileLambda(e, ['p'])).toBe(
      "lambda p: (float('nan') if p is None else p) + 1"
    );
    expect(python.compileVectorized(e, 'f', ['p'])).toContain(
      "return (float('nan') if p is None else p) + 1"
    );
    // A `vars` source that is not a name is read once.
    expect(
      python.compile(e, { vars: { p: 'd["p"]' } as never }).code
    ).toBe("(lambda _c: float('nan') if _c is None else _c)(d[\"p\"]) + 1");
  });

  it('leaves a bound name unchanged', () => {
    // `p` here is the parameter of the function literal, not an input.
    const code = src([
      'Map',
      ['Function', ['Add', 'p', 1], 'p'],
      ['List', 1, 2],
    ]);
    expect(code).not.toContain('is None');
  });
});

const VENV_PYTHON =
  TEST_PYTHON ?? path.join(process.cwd(), 'venv', 'bin', 'python3');
function venvHasNumpy(): boolean {
  try {
    if (!fs.existsSync(VENV_PYTHON)) return false;
    execFileSync(VENV_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const describePython = venvHasNumpy() ? describe : describe.skip;

describePython('COMPILE Python: an absent input, run (CE-395)', () => {
  const ce = engine();
  const python = new PythonTarget();

  /** Define `f` with `compileFunction`, call it on each argument, and print
   * the results. `None` is the absent value. */
  function run(json: unknown, args: string[]): string[] {
    const e = ce.box(json as never);
    const fn = python.compileFunction(e, 'f', ['p']);
    const lambda = python.compileLambda(e, ['p']);
    const script =
      `import numpy as np\nimport math\n${fn}\ng = ${lambda}\n` +
      `for v in [${args.join(', ')}]:\n` +
      `    r1, r2 = f(v), g(v)\n` +
      `    print(repr(r1) + ' ' + repr(r2))\n`;
    return execFileSync(VENV_PYTHON, ['-c', script], { encoding: 'utf-8' })
      .trim()
      .split('\n');
  }

  it('answers NaN for an absent input, as the interpreter does', () => {
    expect(run(['Add', 'p', 1], ['None', '2'])).toEqual(['nan nan', '3 3']);
    expect(run(['Sin', 'p'], ['None'])).toEqual([
      'np.float64(nan) np.float64(nan)',
    ]);
    expect(
      ce.box(['Add', 'Missing', 1]).evaluate().isNaN
    ).toBe(true);
  });

  it('runs the guard idiom: an absent input takes the else arm', () => {
    // The interpreter: `Missing ≠ 0` is undecided, `1 / Missing > 1` is
    // `False`, so the `And` is `False` and the value is -1.
    const json = [
      'If',
      ['And', ['NotEqual', 'p', 0], ['Greater', ['Divide', 1, 'p'], 1]],
      1,
      -1,
    ];
    expect(
      ce
        .box(json as never)
        .subs({ p: ce.Missing })
        .evaluate()
        .toString()
    ).toBe('-1');
    expect(run(json, ['None', '0.5', '0', '2'])).toEqual([
      '-1 -1',
      '1 1',
      '-1 -1',
      '-1 -1',
    ]);
  });

  it('keeps a comparison with an absent input undecided', () => {
    expect(run(['NotEqual', 'p', 0], ['None', '1'])).toEqual([
      'None None',
      'True True',
    ]);
    expect(run(['If', ['NotEqual', 'p', 0], 1, -1], ['None'])).toEqual([
      'nan nan',
    ]);
  });

  it('answers NaN for an absent input typed `unknown` (CE-460)', () => {
    // `r` is a free symbol of a parsed expression, typed `unknown`.
    const e = ce.parse('2\\pi r');
    expect(ce.symbol('r').type.toString()).toBe('unknown');
    expect(e.subs({ r: ce.Missing }).evaluate().isNaN).toBe(true);
    const script =
      `import numpy as np\nimport math\n` +
      `${python.compileFunction(e, 'f', ['r'])}\n` +
      `print(repr(float(f(None))), repr(float(f(1.0))))\n`;
    const [absent, present] = execFileSync(VENV_PYTHON, ['-c', script], {
      encoding: 'utf-8',
    })
      .trim()
      .split(' ');
    expect(absent).toBe('nan');
    expect(Number(present)).toBeCloseTo(e.subs({ r: 1 }).N().re, 12);
  });

  it('reads an absent cell of an array through np.vectorize', () => {
    const e = ce.box(['Add', 'p', 1] as never);
    const script =
      `import numpy as np\n${python.compileVectorized(e, 'f', ['p'])}\n` +
      `print([float(v) for v in f(np.array([None, 1.0], dtype=object))])\n`;
    expect(
      execFileSync(VENV_PYTHON, ['-c', script], { encoding: 'utf-8' }).trim()
    ).toBe('[nan, 2.0]');
  });
});
