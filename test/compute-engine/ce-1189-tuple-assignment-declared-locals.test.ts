/**
 * A tuple assignment to block locals that have a declared type.
 *
 * The interpreter checks each component of the value against the declared
 * type of its target before it writes any, and refuses the whole assignment
 * when one component does not fit. The compiled code writes each target in
 * turn and has no such check. When the static type of each component is a
 * subtype of the declared type of its target, the check of the interpreter
 * never refuses the assignment, so the compiled writes give the same outcome
 * and the assignment compiles. Otherwise the compilation declines, and on
 * GLSL the fragment check (`canCompile()`) refuses the same assignment, so
 * the two agree.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

/** A loop that runs `(a, b) := value` five times, then gives `a`. */
function swapLoop(typeA: string, typeB: string, value: unknown) {
  return ce.box([
    'Block',
    ['Declare', 'a', { str: typeA }, 0],
    ['Declare', 'b', { str: typeB }, 1],
    [
      'Loop',
      ['Assign', ['Tuple', 'a', 'b'], value],
      ['Element', 'k', ['Range', 1, 5]],
    ],
    'a',
  ] as any);
}

const fibonacciStep = ['Tuple', 'b', ['Add', 'a', 'b']];

describe('CE-1189: a tuple assignment to locals with a declared type', () => {
  it.each([
    ['real', 'real'],
    ['integer', 'integer'],
  ])(
    'compiles when each component proves the type (%s, %s)',
    (typeA, typeB) => {
      const expr = swapLoop(typeA, typeB, fibonacciStep);
      expect(expr.evaluate().re).toBe(5);

      const js = compile(expr, { to: 'javascript' });
      expect(js.success).toBe(true);
      expect(js.run!({})).toBe(5);

      expect(glsl.canCompile(expr)).toEqual({ ok: true });
      const code = glsl.compile(expr).code;
      expect(code).toContain('_tv1 = b;');
      expect(code).toContain('_tv2 = a + b;');
      expect(code).toContain('a = _tv1;');
      expect(code).toContain('b = _tv2;');
    }
  );

  it('declines when a component does not prove the type, and canCompile() agrees', () => {
    // `b` is a `real` and `a` is declared `integer`: the interpreter checks
    // the value of `b` at run time (here an integer, which fits).
    const expr = swapLoop('integer', 'real', fibonacciStep);
    expect(expr.evaluate().re).toBe(5);

    const js = compile(expr, { to: 'javascript' });
    expect(js.success).toBe(false);
    expect(js.error).toMatch(/destructuring assignment/);

    const check = glsl.canCompile(expr);
    expect(check.ok).toBe(false);
    expect(JSON.stringify(check)).toMatch(
      /writes `a`, which is declared `integer`/
    );
    expect(() => glsl.compile(expr)).toThrow(/declared `integer`/);
  });

  it('checks the declaration of an enclosing block too, and canCompile() agrees', () => {
    // The inner block declares `a` and `b` as `real`, and an outer block
    // declares `a` as `integer`. Both the compilation and the fragment check
    // test the value against each declaration of `a`, so both decline.
    const expr = ce.box([
      'Block',
      ['Declare', 'a', { str: 'integer' }, 0],
      [
        'Block',
        ['Declare', 'a', { str: 'real' }, 0],
        ['Declare', 'b', { str: 'real' }, 1],
        [
          'Loop',
          ['Assign', ['Tuple', 'a', 'b'], fibonacciStep],
          ['Element', 'k', ['Range', 1, 5]],
        ],
        'a',
      ],
    ] as any);
    expect(expr.evaluate().re).toBe(5);
    expect(compile(expr, { to: 'javascript' }).success).toBe(false);
    expect(glsl.canCompile(expr).ok).toBe(false);
    expect(() => glsl.compile(expr)).toThrow(/declared `integer`/);
  });
});
