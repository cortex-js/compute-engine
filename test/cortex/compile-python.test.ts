import { ComputeEngine } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { operator, operands } from '../../src/math-json/utils';

//
// End-to-end pipeline lock: Cortex source → MathJSON → engine canonicalization
// → Python codegen. Exercises the Phase 4 statement lowerings (`let` →
// value-carrying `Declare`, `while` → `Loop(Block(If(Not(cond), Break), …))`)
// through `PythonTarget.compileFunction`, so drift on either side of the
// pipeline (parser lowering shapes, Block/Declare/Loop codegen) fails here.
//
// The parser wraps a multi-statement program in `Do`, which `executeCortex`
// unwraps to run statements in the engine's current scope (a notebook
// cell-chain). A *compiled function body* wants `Block` scoping instead, so —
// mirroring that boundary translation — the helper rewraps the statements in a
// `Block`. `Do` itself has no engine definition and does not compile.
//
// The expected defs were verified to run under python3 (`f(3) === 10`,
// `g() === 10`); the assertions here are string-only so the suite does not
// depend on a Python interpreter.
//

const ce = new ComputeEngine();

function compileToPythonDef(
  source: string,
  name: string,
  params: string[]
): string {
  const [ast, diagnostics] = parseCortex(source);
  expect(diagnostics).toHaveLength(0);
  const statements = operator(ast) === 'Do' ? [...operands(ast)] : [ast];
  const body = ce.box(['Block', ...statements]);
  return new PythonTarget().compileFunction(body, name, params);
}

describe('CORTEX → PYTHON', () => {
  test('a `let` local compiles to an assignment in a def body', () => {
    expect(compileToPythonDef('let t = x^2\nt + 1', 'f', ['x'])).toBe(
      'def f(x):\n' + //
        '    t = x ** 2\n' +
        '    return t + 1\n'
    );
  });

  test('a `while` program compiles to a statement loop', () => {
    const source = [
      'let s = 0',
      'let k = 0',
      'while k < 5 { s = s + k\nk = k + 1 }',
      's',
    ].join('\n');
    expect(compileToPythonDef(source, 'g', [])).toBe(
      'def g():\n' +
        '    s = 0\n' +
        '    k = 0\n' +
        '    while True:\n' +
        '        if not (k < 5):\n' +
        '            break\n' +
        '        s = k + s\n' +
        '        k = k + 1\n' +
        '    return s\n'
    );
  });

  test('a declared local named `i` shadows the imaginary unit', () => {
    expect(compileToPythonDef('let i = 3\ni + x', 'h', ['x'])).toBe(
      'def h(x):\n' + //
        '    i = 3\n' +
        '    return i + x\n'
    );
  });
});
