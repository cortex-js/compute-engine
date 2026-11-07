import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

// CE-682: the samples of a `Linspace` with an endpoint that is an infinity or
// `NaN` cannot be computed, because the step is an infinity or `NaN`. Such a
// `Linspace` has no value: every read of it stays unevaluated in the
// interpreter, as for a symbolic endpoint, and compiled JavaScript and Python
// give `NaN`. A read must not give a value: a count of 3 with no elements for
// a sum, or a maximum of `+∞`. A count of 0 has no samples, so with an
// infinite endpoint the `Linspace` is the empty list; with a `NaN` endpoint it
// has no value.

function engine() {
  const ce = new ComputeEngine();
  // The type of the input `a` admits the infinities and `NaN` (`real`
  // excludes them), so that a compiled run with `a = ∞` is in its type.
  ce.declare('a', 'real | signed_infinity | nan');
  ce.assign('big', ce.box('PositiveInfinity'));
  ce.assign('nn', ce.NaN);
  return ce;
}

const NON_FINITE: [string, unknown][] = [
  ['+∞ end', ['Linspace', 0, 'PositiveInfinity', 3]],
  ['−∞ start', ['Linspace', 'NegativeInfinity', 1, 3]],
  ['NaN end', ['Linspace', 0, 'NaN', 3]],
  ['~∞ end', ['Linspace', 0, 'ComplexInfinity', 3]],
  ['one operand, −∞', ['Linspace', 'NegativeInfinity']],
  ['a symbol whose value is +∞', ['Linspace', 0, 'big', 3]],
  ['a symbol whose value is NaN', ['Linspace', 0, 'nn', 3]],
  ['an exact literal too large for a double', ['Linspace', 0, { num: '1e400' }, 3]],
];

const READS: [string, (l: unknown) => unknown][] = [
  ['Sum', (l) => ['Sum', l]],
  ['Product', (l) => ['Product', l]],
  ['Count', (l) => ['Count', l]],
  ['Length', (l) => ['Length', l]],
  ['Max', (l) => ['Max', l]],
  ['Min', (l) => ['Min', l]],
  ['Mean', (l) => ['Mean', l]],
  ['First', (l) => ['First', l]],
  ['At', (l) => ['At', l, 1]],
  ['Element', (l) => ['Element', 5, l]],
];

describe('CE-682: a Linspace with an endpoint that is not finite', () => {
  describe.each(NON_FINITE)('%s', (_name, linspace) => {
    test.each(READS)('%s stays unevaluated', (_read, read) => {
      const ce = engine();
      const expr = ce.box(read(linspace) as any);
      const value = expr.evaluate();
      // `Product` of a collection is a `Reduce` in canonical form.
      expect(value.operator).toBe(expr.operator);
      expect(value.isNumberLiteral).toBe(false);
    });

    test('has no count and no elements', () => {
      const l = engine().box(linspace as any);
      expect(l.count).toBeUndefined();
      expect(l.isFiniteCollection).not.toBe(true);
      expect([...l.each()]).toEqual([]);
    });
  });

  test('a finite Linspace keeps its values', () => {
    const ce = engine();
    const l = ['Linspace', 0, 1, 3];
    expect(ce.box(['Sum', l]).evaluate().re).toBe(1.5);
    expect(ce.box(['Count', l]).evaluate().re).toBe(3);
    expect(ce.box(['Max', l]).evaluate().re).toBe(1);
    expect(ce.box(['Element', 0.5, l]).evaluate().symbol).toBe('True');
    expect(ce.box(['Element', 0.4, l]).evaluate().symbol).toBe('False');
  });

  test('an infinite count is the default count, not an endpoint', () => {
    const ce = engine();
    const l = ['Linspace', 0, 1, 'PositiveInfinity'];
    expect(ce.box(['Count', l]).evaluate().re).toBe(50);
    expect(ce.box(['Max', l]).evaluate().re).toBe(1);
  });

  test('a count of 0 is the empty list for an infinite endpoint, and has no value for a NaN endpoint', () => {
    const ce = engine();
    const inf = ['Linspace', 0, 'PositiveInfinity', 0];
    expect(ce.box(['Sum', inf]).evaluate().re).toBe(0);
    expect(ce.box(['Count', inf]).evaluate().re).toBe(0);
    expect(ce.box(['Count', ['Linspace', 'big', 1, 0.5]]).evaluate().re).toBe(0);
    const nan = ['Linspace', 0, 'NaN', 0];
    expect(ce.box(['Count', nan]).evaluate().operator).toBe('Count');
    expect(ce.box(['Sum', nan]).evaluate().operator).toBe('Sum');
  });

  test('a symbolic endpoint keeps its count', () => {
    expect(
      engine().box(['Count', ['Linspace', 'a', 1, 3]]).evaluate().re
    ).toBe(3);
  });
});

describe('CE-682: compiled JavaScript', () => {
  function run(json: unknown, args: Record<string, number> = {}) {
    const result = compile(engine().box(json as any), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    });
    expect(result.success).toBe(true);
    return result.run!(args);
  }

  test.each([
    ['the Linspace', (l: unknown) => l],
    ['Sum', (l: unknown) => ['Sum', l]],
    ['Max', (l: unknown) => ['Max', l]],
    ['At', (l: unknown) => ['At', l, 1]],
  ])('%s of a literal infinite endpoint is NaN', (_name, read) => {
    expect(run(read(['Linspace', 0, 'PositiveInfinity', 3]))).toBeNaN();
  });

  test('an input endpoint is tested at run time', () => {
    const l = ['Linspace', 0, 'a', 3];
    expect(run(l, { a: 1 })).toEqual([0, 0.5, 1]);
    expect(run(['Sum', l], { a: 1 })).toBe(1.5);
    expect(run(l, { a: Infinity })).toBeNaN();
    expect(run(l, { a: NaN })).toBeNaN();
    expect(run(['Sum', l], { a: -Infinity })).toBeNaN();
  });

  test('a count of 0 is the empty array, except for a NaN endpoint', () => {
    const l = ['Linspace', 0, 'a', 0];
    expect(run(l, { a: Infinity })).toEqual([]);
    expect(run(l, { a: 1 })).toEqual([]);
    expect(run(l, { a: NaN })).toBeNaN();
  });
});

describe('CE-682: compiled Python', () => {
  const python = new PythonTarget();

  test('the emitted code tests the endpoints', () => {
    const code = python.compileFunction(
      engine().box(['Linspace', 0, 'PositiveInfinity', 3]),
      'fn',
      []
    );
    expect(code).toContain(
      "abs(_s) < float('inf') and abs(_e) < float('inf')"
    );
  });

  const hasNumpy = (() => {
    if (TEST_PYTHON === undefined) return false;
    try {
      execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  (hasNumpy ? test : test.skip)('the emitted code runs', () => {
    const ce = engine();
    // The endpoint is the input `a`, so that no case is folded at compile
    // time and each one runs the emitted test.
    const cases: [string, unknown][] = [
      ['three', ['Linspace', 0, 'a', 3]],
      ['three_start', ['Linspace', 'a', 1, 3]],
      ['zero', ['Linspace', 0, 'a', 0]],
    ];
    let src = 'import numpy as np\nimport math\n\n';
    for (const [name, json] of cases)
      src += `${python.compileFunction(ce.box(json as any), `fn_${name}`, ['a'])}\n`;
    src +=
      "inf, nan = float('inf'), float('nan')\n" +
      'print(repr(math.isnan(fn_three(inf))), repr(math.isnan(fn_three_start(nan))), ' +
      'repr(fn_three(1.0)), repr(fn_zero(inf)), repr(math.isnan(fn_zero(nan))))\n';
    const file = join(tmpdir(), `ce-682-${process.pid}.py`);
    writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(TEST_PYTHON!, [file], { encoding: 'utf8' });
    } finally {
      unlinkSync(file);
    }
    expect(out.trim()).toBe('True True [0.0, 0.5, 1.0] [] True');
  });
});
