/**
 * On GLSL, a tuple assignment of locals that is the whole body of a loop
 * (`Loop(Assign((a, b), (b, a + b)), …)`) is a statement list of its own:
 * `compileStatementList()` splits it into one assignment per local
 * (`desugarPatternAssign()`), and each value is computed into a temporary
 * before any local is written. Without the temporaries, the second
 * assignment would read the new value of `a`. The fragment pass admits the
 * form, so the compiled code must give the interpreter's value.
 * `npm run test:glsl` draws the same block on WebGL 2 and compares its value
 * with the interpreter's ("a tuple assignment of locals as a loop body").
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
const glsl = new GLSLTarget();
ce.registerCompilationTarget('glsl', glsl);

/** The code from `for (` to the next closing brace at the start of a line,
 *  which is the brace that closes the loop in the code of a root block. */
function loopBody(code: string): string {
  const start = code.indexOf('for (');
  expect(start).toBeGreaterThan(-1);
  const end = code.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe('GLSL: a tuple assignment of locals as a loop body', () => {
  test('two locals: each value is computed before either local is written', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", 'x'],
      ['Declare', 'b', "'unknown'", 'y'],
      [
        'Loop',
        ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', ['Add', 'a', 'b']]],
        ['Element', 'k', ['Range', 1, 5]],
      ],
      'a',
    ]);
    expect(glsl.canCompile(expr)).toEqual({ ok: true });
    const result = ce._compile(expr, { to: 'glsl' });
    expect(result.success).toBe(true);
    const body = loopBody(result.code);
    const tempOfB = body.indexOf('_tv1 = b;');
    const tempOfSum = body.indexOf('_tv2 = a + b;');
    const writeOfA = body.indexOf('a = _tv1;');
    const writeOfB = body.indexOf('b = _tv2;');
    expect(tempOfB).toBeGreaterThan(-1);
    expect(tempOfSum).toBeGreaterThan(tempOfB);
    expect(writeOfA).toBeGreaterThan(tempOfSum);
    expect(writeOfB).toBeGreaterThan(writeOfA);
    // The interpreter: (x, y) → (y, x + y), five times, gives a = 3x + 5y.
    expect(
      expr.subs({ x: ce.number(1), y: ce.number(2) }).evaluate().re
    ).toBe(13);
  });

  test('three locals: a rotation reads only the old values', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", 'x'],
      ['Declare', 'b', "'unknown'", 'y'],
      ['Declare', 'c', "'unknown'", 0],
      [
        'Loop',
        ['Assign', ['Tuple', 'a', 'b', 'c'], ['Tuple', 'b', 'c', 'a']],
        ['Element', 'k', ['Range', 1, 2]],
      ],
      'a',
    ]);
    expect(glsl.canCompile(expr)).toEqual({ ok: true });
    const result = ce._compile(expr, { to: 'glsl' });
    expect(result.success).toBe(true);
    const body = loopBody(result.code);
    // The three values are read into temporaries, then the three locals are
    // written from them.
    const reads = ['_tv1 = b;', '_tv2 = c;', '_tv3 = a;'].map((s) =>
      body.indexOf(s)
    );
    const writes = ['a = _tv1;', 'b = _tv2;', 'c = _tv3;'].map((s) =>
      body.indexOf(s)
    );
    for (const i of [...reads, ...writes]) expect(i).toBeGreaterThan(-1);
    expect(Math.min(...writes)).toBeGreaterThan(Math.max(...reads));
  });
});
