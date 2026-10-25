/**
 * Two different symbols stay two different names in the compiled Python.
 *
 * Python reads each identifier in its NFKC normal form, so `ﬁ` (the one
 * character U+FB01, a ligature) and `fi` were the same variable in the
 * compiled code: `ﬁ + fi` gave `fi + ﬁ`, which Python reads as `fi + fi`.
 *
 * - An identifier whose NFKC form no other identifier of the code has is
 *   kept as it is written, so the names that the result reports
 *   (`freeSymbols`) are the names that the code reads.
 * - In a group of identifiers with the same NFKC form, a bound name (a
 *   parameter, a local, an index) is renamed (`ﬁ` is written `_uFB01_`).
 * - Two inputs that the host gives by name (two free symbols) cannot be
 *   given two values: the compilation fails, and a `vars` mapping is the
 *   fix.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';
import { execFileSync } from 'child_process';

const ce = new ComputeEngine();
// The tests check names, not how an input is read. A free symbol with an
// INFERRED `number` type is read through a `None` test (ROADMAP CE-460); a
// DECLARED `number` is read as is. So the symbols are declared.
for (const s of ['ﬁ', 'fi', '𝑥', 'x', '_uFB01_']) ce.declare(s, 'number');
const py = new PythonTarget();
const fi = { sym: 'ﬁ' };
const sum = ce.box(['Add', fi, 'fi']);

function runPython(program: string): any {
  return JSON.parse(
    execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
  );
}

describe('PYTHON: IDENTIFIERS WITH THE SAME NFKC FORM', () => {
  test('a lone identifier that NFKC changes is kept', () => {
    const r = py.compile(ce.box(['Add', { sym: '𝑥' }, 1]));
    expect(r.code).toBe('𝑥 + 1');
    expect(r.freeSymbols).toEqual(['𝑥']);
    expect(py.compileFunction(ce.box(['Add', 'x', 1]), 'ﬁ', ['x'])).toBe(
      'def ﬁ(x):\n    return x + 1\n'
    );
  });

  test('two inputs with the same NFKC form fail closed', () => {
    expect(ce.symbol('ﬁ').isSame(ce.symbol('fi'))).toBe(false);
    // Before: `fi + ﬁ`, which Python reads as `fi + fi`.
    expect(() => py.compile(sum)).toThrow(
      /the inputs "fi" and "ﬁ" are the same name for Python/
    );
    expect(() => py.compileToSource(sum)).toThrow(/the same name for Python/);
    expect(() => py.compileFunction(sum, 'f', ['x'])).toThrow(
      /the same name for Python/
    );
    // A `vars` mapping gives one of them another name.
    expect(py.compile(sum, { vars: { ﬁ: 'lig' } }).code).toBe('fi + lig');
  });

  test('a parameter is renamed, an input is kept', () => {
    // Before: `def f(ﬁ, fi):`, a duplicate parameter for Python.
    expect(py.compileFunction(sum, 'f', ['ﬁ', 'fi'])).toBe(
      'def f(_uFB01_, fi):\n    return fi + _uFB01_\n'
    );
    expect(py.compileLambda(sum, ['ﬁ', 'fi'])).toBe(
      'lambda _uFB01_, fi: fi + _uFB01_'
    );
    // The input `ﬁ` keeps its name; the parameter `fi` is renamed.
    expect(py.compileFunction(sum, 'f', ['fi'])).toBe(
      'def f(fi_1):\n    return fi_1 + ﬁ\n'
    );
  });

  test('an index is renamed', () => {
    const r = py.compile(
      ce.box(['Sum', ['Add', fi, 'fi'], ['Limits', fi, 1, 'n']])
    );
    expect(r.code).toBe('sum(fi + _uFB01_ for _uFB01_ in range(1, int((n) // 1) + 1))');
    expect(r.freeSymbols).toEqual(['fi', 'n']);
    // The new name has a suffix when a symbol already has it.
    expect(
      py.compile(
        ce.box(['Sum', ['Add', fi, 'fi', '_uFB01_'], ['Limits', fi, 1, 3]])
      ).code
    ).toBe('sum(_uFB01_ + fi + _uFB01__1 for _uFB01__1 in range(1, 4))');
  });

  test('a string literal is unchanged', () => {
    expect(py.compileToSource(ce.box({ str: 'ﬁ' }))).toBe('"ﬁ"');
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'ﬁ + fi with ﬁ = 1 and fi = 2 gives 3',
    () => {
      const program = [
        'import json',
        py.compileFunction(sum, 'f', ['ﬁ', 'fi']),
        `g = ${py.compileLambda(sum, ['ﬁ', 'fi'])}`,
        // The host binds the inputs by the names of `freeSymbols` (and of
        // the `vars` mapping).
        'lig = 1',
        'fi = 2',
        `h = ${py.compile(sum, { vars: { ﬁ: 'lig' } }).code}`,
        // A lone `𝑥` is the Python name `x`.
        '𝑥 = 3',
        `k = ${py.compile(ce.box(['Add', { sym: '𝑥' }, 1])).code}`,
        'print(json.dumps([f(1, 2), g(1, 2), h, k]))',
      ].join('\n');
      expect(runPython(program)).toEqual([3, 3, 3, 4]);
    }
  );

  (TEST_PYTHON === undefined ? it.skip : it)(
    'a written global with a name that NFKC changes is read by its NFKC form',
    () => {
      // `u ≔ u + 1` in a function makes `u` a local initialized from the
      // module global. Python stores the global `ﬁ = 1` under the name `fi`.
      const e = new ComputeEngine();
      e.declare('ﬁ', 'real');
      const fn = py.compileFunction(
        e.box(['Block', ['Assign', fi, ['Add', fi, 1]], fi]),
        'w',
        ['x']
      );
      expect(fn).toContain('globals().get("fi")');
      const program = ['import json', 'ﬁ = 1', fn, 'print(json.dumps(w(0)))'];
      expect(runPython(program.join('\n'))).toBe(2);
    }
  );
});
