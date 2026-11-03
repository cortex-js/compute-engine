import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEST_PYTHON } from './test-python';

import { ComputeEngine } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Compiled Python and an input that may be absent.
 *
 * A caller passes `None`, the Python spelling of `Missing`, for an absent
 * input. Until 2026-11-01 the compiled code read such an input as
 * `float('nan')` at a numeric operand (ROADMAP CE-395 and CE-460), so that
 * `None + 1` gave `NaN` as the interpreter does. Since then the compiled
 * value of arithmetic or a comparison with an absent operand is not
 * specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the
 * bullet "Everything computed from an absent value, except at a
 * discharge"): the input is read as it is, and `None + 1` raises a
 * `TypeError`. The tests check that no read conversion is emitted, the
 * compiled value for a present input, and the interpreter's value for an
 * absent one.
 */

// A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
// is a result only"): `p` is declared `number`, and the interpreter is given
// `Missing` for it.
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('p', 'number');
  ce.declare('a', 'any');
  ce.declare('x', 'number');
  return ce;
}

describe('COMPILE Python: an absent input in arithmetic (CE-395)', () => {
  // The compiled value with an absent input is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`): the emitted code
  // reads the input as it is.
  const ce = engine();
  const python = new PythonTarget();
  const src = (json: unknown): string =>
    python.compile(ce.box(json as never)).code;

  it('reads a `number` input as it is in arithmetic', () => {
    expect(src(['Add', 'p', 1])).toBe('p + 1');
    expect(src(['Sin', 'p'])).toBe('np.sin(p)');
  });

  it('refuses an input declared `any`', () => {
    // An input with no type (`unknown` or `any`) is refused at compile time
    // (ROADMAP CE-712.1), with its name in `unsupported`.
    const r = compile(ce.box(['Add', 'a', 1] as never), { to: 'python' });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toContain('a');
  });

  it('leaves an input that cannot be absent unchanged', () => {
    expect(src(['Add', 'x', 1])).toBe('x + 1');
    expect(src(['Sin', 'x'])).toBe('np.sin(x)');
  });

  it('reads an input typed `unknown` as it is in arithmetic (CE-460)', () => {
    // A parsed free symbol is typed `unknown`, or `number` when its use
    // narrows it.
    expect(python.compile(ce.parse('2\\pi r')).code).toBe('2 * np.pi * r');
  });

  it('reads an input with an inferred `number` type as it is (CE-460)', () => {
    // A use narrows each free symbol to `number`. The type is inferred, not
    // declared.
    const ce = new ComputeEngine();
    const code = (latex: string): string =>
      python.compile(ce.parse(latex)).code;
    expect(code('\\sin(s)')).toBe('np.sin(s)');
    expect(ce.symbol('s').type.toString()).toBe('number');
    expect(ce.symbol('s').valueDefinition?.inferredType).toBe(true);
    expect(code('t^2+1')).toBe('t ** 2 + 1');
    expect(code('u+v')).toBe('u + v');
  });

  it('leaves an input with a declared `number` type unchanged (CE-460)', () => {
    // A declaration is a promise that the input is present: no test.
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    ce.declare('t', 'integer');
    expect(python.compile(ce.parse('\\sin(s)')).code).toBe('np.sin(s)');
    expect(python.compile(ce.parse('t^2+1')).code).toBe('t ** 2 + 1');
  });

  it('compiles a comparison with the native operator', () => {
    expect(src(['NotEqual', 'p', 0])).toBe('((p) != (0))');
    const guard = src([
      'If',
      ['And', ['NotEqual', 'p', 0], ['Greater', ['Divide', 1, 'p'], 1]],
      1,
      -1,
    ]);
    // Over a `number` input the branch is the plain conditional.
    expect(guard).toContain('1 < 1 / p');
  });

  it('leaves an operator that handles absence unchanged', () => {
    expect(src(['Max', 'p', 5])).not.toContain("float('nan') if p is None");
  });

  it('reads the input as it is on every route', () => {
    const e = ce.box(['Add', 'p', 1] as never);
    expect(python.compileFunction(e, 'f', ['p'])).toContain('return p + 1');
    expect(python.compileLambda(e, ['p'])).toBe('lambda p: p + 1');
    expect(python.compileVectorized(e, 'f', ['p'])).toContain(
      'return p + 1'
    );
    expect(
      python.compile(e, { vars: { p: 'd["p"]' } as never }).code
    ).toBe('(d["p"]) + 1');
    expect(python.compile(e, { vars: { p: '9' } as never }).code).toBe(
      '9 + 1'
    );
    for (const literal of ['.5', '-2.5e3', '1_000'])
      expect(
        python.compile(e, { vars: { p: literal } as never }).code
      ).not.toContain('is None');
  });

  it('parenthesizes a compound `vars` source, for every declared type', () => {
    // The read is an operand of the operator around it: `2p` with
    // `vars: { p: '2+3' }` is `2 * (2+3)`, which is 10, not `2 * 2+3`.
    for (const type of ['real']) {
      const e = new ComputeEngine();
      e.declare('p', type);
      const twice = e.box(['Multiply', 2, 'p'] as never);
      expect(python.compile(twice, { vars: { p: '2+3' } as never }).code).toBe(
        '2 * (2+3)'
      );
      // A source that holds a quote is always grouped, because a bracket
      // inside a string literal would mislead the test for a primary
      // expression: `len("(") + len(")")` is two operands of `+`.
      expect(
        python.compile(twice, { vars: { p: 'd["p"]' } as never }).code
      ).toBe('2 * (d["p"])');
      expect(
        python.compile(twice, {
          vars: { p: 'len("(") + len(")")' } as never,
        }).code
      ).toBe('2 * (len("(") + len(")"))');
      // A negative constant is grouped: `**` binds tighter than unary minus.
      expect(
        python.compile(e.box(['Power', 'p', 2] as never), {
          vars: { p: -3 } as never,
        }).code
      ).toBe('(-3) ** 2');
    }
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
  TEST_PYTHON ?? '';
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
  // The compiled value with an absent input is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`): the compiled code
  // runs with present inputs only, and the interpreter's value is checked
  // for an absent one.
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

  it('answers for a present input; the interpreter answers Missing for an absent one', () => {
    expect(run(['Add', 'p', 1], ['2'])).toEqual(['3 3']);
    expect(ce.box(['Add', 'Missing', 1]).evaluate().symbol).toBe('Missing');
  });

  it('runs the guard idiom: the interpreter takes the else arm for an absent input', () => {
    // The interpreter: `Missing ≠ 0` is undecided, `1 / Missing > 1` is
    // `False`, so the `And` is `False` and the value is -1. The compiled
    // code runs with present inputs only.
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
    expect(run(json, ['0.5', '0', '2'])).toEqual([
      '1 1',
      '-1 -1',
      '-1 -1',
    ]);
  });

  it('compares a present input', () => {
    expect(run(['NotEqual', 'p', 0], ['1'])).toEqual(['True True']);
    expect(run(['If', ['NotEqual', 'p', 0], 1, -1], ['1'])).toEqual(['1 1']);
  });

  it('compiles an input typed `unknown` (CE-460)', () => {
    // `r` is a free symbol of a parsed expression. Its type is inferred:
    // `unknown`, or `number` if the product narrows its symbols.
    const e = ce.parse('2\\pi r');
    expect(ce.symbol('r').valueDefinition?.inferredType).toBe(true);
    // An operator over `Missing` gives `Missing` in the interpreter.
    expect(e.subs({ r: ce.Missing }).evaluate().symbol).toBe('Missing');
    const script =
      `import numpy as np\nimport math\n` +
      `${python.compileFunction(e, 'f', ['r'])}\n` +
      `print(repr(float(f(1.0))))\n`;
    const present = execFileSync(VENV_PYTHON, ['-c', script], {
      encoding: 'utf-8',
    }).trim();
    expect(Number(present)).toBeCloseTo(e.subs({ r: 1 }).N().re, 12);
  });

  it('compiles an input with an inferred `number` type (CE-460)', () => {
    const ce = new ComputeEngine();
    for (const latex of ['\\sin(r)', 'r^2+1', '\\sum_{k=1}^{10} k r']) {
      const e = ce.parse(latex);
      expect(ce.symbol('r').type.toString()).toBe('number');
      expect(e.subs({ r: ce.Missing }).evaluate().symbol).toBe('Missing');
      const script =
        `import numpy as np\nimport math\n` +
        `${python.compileFunction(e, 'f', ['r'])}\n` +
        `print(repr(float(f(0.5))))\n`;
      const present = execFileSync(VENV_PYTHON, ['-c', script], {
        encoding: 'utf-8',
      }).trim();
      expect(Number(present)).toBeCloseTo(e.subs({ r: 0.5 }).N().re, 12);
    }
  });

  it('evaluates a compound `vars` source as one operand', () => {
    for (const type of ['real']) {
      const e = new ComputeEngine();
      e.declare('p', type);
      const code = python.compile(e.box(['Multiply', 2, 'p'] as never), {
        vars: { p: '2+3' } as never,
      }).code;
      const out = execFileSync(
        VENV_PYTHON,
        ['-c', `import numpy as np\nprint(${code})\n`],
        { encoding: 'utf-8' }
      ).trim();
      expect(out).toBe('10');
    }
  });

  it('reads a present cell of an array through np.vectorize', () => {
    const e = ce.box(['Add', 'p', 1] as never);
    const script =
      `import numpy as np\n${python.compileVectorized(e, 'f', ['p'])}\n` +
      `print([float(v) for v in f(np.array([0.5, 1.0], dtype=object))])\n`;
    expect(
      execFileSync(VENV_PYTHON, ['-c', script], { encoding: 'utf-8' }).trim()
    ).toBe('[1.5, 2.0]');
  });
});
