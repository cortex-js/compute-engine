import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

const occurrences = (code: string, needle: string): number =>
  code.split(needle).length - 1;

/**
 * The lines of a shader `for` loop's BODY — everything between the `for`
 * header and the closing brace at the loop's own indentation.
 */
function loopBody(code: string): string {
  const start = code.indexOf('for (');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = code.indexOf('{', start);
  const close = code.indexOf('\n}', open);
  return code.slice(open, close === -1 ? code.length : close);
}

/** Everything BEFORE the shader `for` loop header. */
function beforeLoop(code: string): string {
  const start = code.indexOf('for (');
  expect(start).toBeGreaterThanOrEqual(0);
  return code.slice(0, start);
}

describe('CSE and loop-invariant hoisting in a Sum body (GPU)', () => {
  /**
   * A heat-map shaped body: everything but the final `2^n` division is free of
   * the loop index, so nothing except that division has a reason to be
   * evaluated more than once.
   */
  const heatMap = (ce: ComputeEngine) => {
    // `N` is the engine's numeric-evaluation operator, so the bound is `m`.
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    ce.declare('m', 'number');
    // The bound is `m - 1` rather than `m`: a bound that compiles to one read
    // (`int(floor(m))`) is deliberately left in the loop header, so only a
    // computed one witnesses the bound hoist.
    return ce.parse(
      '\\sum_{n=0}^{m-1} \\frac{\\sin(\\lfloor x \\rfloor + \\lfloor y \\rfloor)' +
        '(\\lfloor x \\rfloor - \\lfloor y \\rfloor)}{2^n}'
    );
  };

  it('GLSL: the index-free work is declared BEFORE the loop, not inside it', () => {
    const ce = new ComputeEngine();
    const code = glsl.compile(heatMap(ce)).code;

    // Everything index-free is computed once, ahead of the loop.
    expect(beforeLoop(code)).toContain('floor(x)');
    expect(beforeLoop(code)).toContain('sin(');
    // The body keeps only the term that depends on `n`.
    expect(loopBody(code)).not.toContain('floor(x)');
    expect(loopBody(code)).not.toContain('sin(');
    expect(loopBody(code)).toContain('float(n)');
  });

  it('GLSL: a computed loop bound is evaluated once, in a local', () => {
    const ce = new ComputeEngine();
    const code = glsl.compile(heatMap(ce)).code;

    // The condition reads a local; the conversion and the addition are not
    // re-evaluated per step.
    expect(code).toMatch(/int _\w+ = int\(floor\(m \+ -1\.0\)\);/);
    expect(code).toMatch(/for \(int n = 0; n <= _\w+; n\+\+\)/);
    expect(occurrences(code, 'floor(m + -1.0)')).toBe(1);
  });

  it('GLSL: a bound that is already one read stays in the header', () => {
    // `int(floor(m))` is a register read plus a conversion, which every driver
    // folds; a local would only add a line and hide the name the header tests.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('m', 'number');
    const code = glsl.compile(
      ce.parse('\\sum_{n=1}^{m} \\frac{\\sin(x)}{n}')
    ).code;
    expect(code).toContain('n <= int(floor(m));');
  });

  it('WGSL: the same two rewrites', () => {
    const ce = new ComputeEngine();
    const code = wgsl.compile(heatMap(ce)).code;

    expect(code).toMatch(/let _\w+: i32 = i32\(floor\(m \+ -1\.0\)\);/);
    expect(code).toMatch(/for \(var n: i32 = 0; n <= _\w+; n\+\+\)/);
    expect(loopBody(code)).not.toContain('floor(x)');
  });

  it('GLSL: a literal loop bound is left in place', () => {
    // A constant bound is already one token; binding it would only add a line.
    const ce = new ComputeEngine();
    const code = glsl.compile(
      ce.parse('\\sum_{n=1}^{500} \\frac{\\sin(x)}{n}')
    ).code;
    expect(code).toContain('n <= 500');
  });

  it('GLSL: an index-free inner Sum runs its loop ONCE for an unrolled outer Sum', () => {
    const ce = new ComputeEngine();
    const inner = ['Sum', ['Multiply', 'j', 'x'], ['Limits', 'j', 1, 'm']];
    const code = glsl.compile(
      ce.box(['Sum', ['Multiply', 'i', inner], ['Limits', 'i', 1, 2]] as never)
    ).code;
    expect(occurrences(code, 'for (int j =')).toBe(1);
  });

  it('GLSL: an index-free inner Sum is lifted ABOVE the outer loop', () => {
    // A loop whose body mentions the outer index stays inside it; this one
    // does not, so it runs once for the whole outer loop instead of once per
    // iteration. `compile-glsl-structures.test.ts` pins the opposite case.
    const ce = new ComputeEngine();
    const inner = ['Sum', ['Multiply', 'j', 'x'], ['Limits', 'j', 1, 'm']];
    const code = glsl.compile(
      ce.box([
        'Sum',
        ['Multiply', 'i', inner],
        ['Limits', 'i', 1, 'n'],
      ] as never)
    ).code;
    expect(code.indexOf('for (int j =')).toBeLessThan(
      code.indexOf('for (int i =')
    );
  });

  it('JavaScript: the hoisted value agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    const expr = heatMap(ce);
    const result = compile(expr);
    const vars = { x: 3.7, y: 1.2, m: 12 };
    const expected = expr
      .subs({ x: ce.number(3.7), y: ce.number(1.2), m: ce.number(12) })
      .N().re;
    expect(result.run?.(vars)).toBeCloseTo(expected as number, 12);
  });

  it('JavaScript: the binding sits after the empty-range exit', () => {
    const ce = new ComputeEngine();
    const expr = heatMap(ce);
    const code = compile(expr).code;
    const exit = code.indexOf('if (!(n <= _upper)) return 0;');
    expect(exit).toBeGreaterThan(0);
    expect(code.indexOf('Math.sin(')).toBeGreaterThan(exit);
    // An empty range must not evaluate what the body never reached.
    expect(compile(expr).run?.({ x: 3.7, y: 1.2, m: -1 })).toBe(0);
  });

  it('JavaScript: an unrolled Sum computes its index-free work once', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\sum_{n=1}^{6} \\left( \\sin(x^2 + 1) \\cdot n + \\cos(y) \\right)'
    );
    const result = compile(expr);
    expect(occurrences(result.code, 'Math.sin(')).toBe(1);
    const expected = expr.subs({ x: ce.number(0.4), y: ce.number(2.1) }).N().re;
    expect(result.run?.({ x: 0.4, y: 2.1 })).toBeCloseTo(
      expected as number,
      12
    );
  });
});

describe('CSE inside an emitted user-function body (GPU)', () => {
  /** `S(s) := m(s)·m(s) + m(s)` over a non-trivial `m`. */
  const repeatedCall = (ce: ComputeEngine) => {
    ce.declare('x', 'number');
    ce.assign('m', ce.parse('(s) \\mapsto \\sin(s) + \\cos(s) + s^3'));
    ce.assign('S', ce.parse('(s) \\mapsto m(s) \\cdot m(s) + m(s)'));
    return ce.parse('S(x)');
  };

  it('GLSL: a repeated inner call is bound to a local in the body', () => {
    const ce = new ComputeEngine();
    const preamble = glsl.compile(repeatedCall(ce)).preamble;
    expect(preamble).toMatch(/float _cse\d+ = _fn_m\(s\);/);
    expect(occurrences(preamble, '_fn_m(s)')).toBe(1);
  });

  it('WGSL: the same body-level sharing', () => {
    const ce = new ComputeEngine();
    const preamble = wgsl.compile(repeatedCall(ce)).preamble;
    expect(preamble).toMatch(/let _cse\d+: f32 = _fn_m\(s\);/);
    expect(occurrences(preamble, '_fn_m(s)')).toBe(1);
  });

  it('the compiled value still agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    const expr = repeatedCall(ce);
    const result = compile(expr);
    const expected = expr.subs({ x: ce.number(0.7) }).N().re;
    expect(result.run?.({ x: 0.7 })).toBeCloseTo(expected as number, 12);
  });
});

describe('CSE across a ternary: a condition and an arm may share', () => {
  /** `\begin{cases} g(t) & -0.8 < \cos(g(t)) \end{cases}` — the shape a
   * piecewise takes when its guard tests the value it returns. */
  const guardedByItsOwnValue = (ce: ComputeEngine) => {
    ce.declare('t', 'number');
    ce.assign('g', ce.parse('(u) \\mapsto \\sin(u) + \\cos(2u) + u^3'));
    return ce.parse('\\begin{cases} g(t) & -0.8 < \\cos(g(t)) \\end{cases}');
  };

  it('JavaScript: the shared call is evaluated once', () => {
    const ce = new ComputeEngine();
    const code = compile(guardedByItsOwnValue(ce)).code;
    expect(code).toMatch(/const _cse\d+ = _fn_g\(_\.t\);/);
    expect(occurrences(code, '_fn_g(_.t)')).toBe(1);
  });

  it('GLSL: the shared call is evaluated once', () => {
    const ce = new ComputeEngine();
    const code = glsl.compile(guardedByItsOwnValue(ce)).code;
    expect(code).toMatch(/float _cse\d+ = _fn_g\(t\);/);
    expect(occurrences(code, '_fn_g(t)')).toBe(1);
  });

  it('GLSL: the same sharing inside another function body', () => {
    // The report's shape: the piecewise IS the body of an emitted function.
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    ce.assign('g', ce.parse('(u) \\mapsto \\sin(u) + \\cos(2u) + u^3'));
    ce.assign(
      'h',
      ce.parse(
        '(v) \\mapsto \\begin{cases} g(v) & -0.8 < \\cos(g(v)) \\end{cases}'
      )
    );
    const preamble = glsl.compile(ce.parse('h(t)')).preamble;
    expect(preamble).toMatch(/float _cse\d+ = _fn_g\(v\);/);
    expect(occurrences(preamble, '_fn_g(v)')).toBe(1);
  });

  it('a term appearing ONLY in arms is never lifted out of them', () => {
    // Hoisting an arm-only term would evaluate it on the path that does not
    // take the arm — a change of which code runs, not an optimization.
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    const code = compile(
      ce.parse(
        '\\begin{cases} \\sin(t^2+1) + \\sin(t^2+1) & t > 0 \\\\ 0 & \\top \\end{cases}'
      )
    ).code;
    const branch = code.indexOf('?');
    expect(branch).toBeGreaterThan(0);
    // Whatever is bound for the arm is bound inside it, after the test.
    expect(code.slice(0, branch)).not.toContain('Math.sin(');
  });
});

describe('CSE keys on the application a Negate wraps', () => {
  /** `-mod(x,1)` twice, `mod(x,1)` three more times. */
  const negatedAndBare = (ce: ComputeEngine) => {
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    return ce.parse(
      '(y - \\operatorname{mod}(x,1))^2 + (2y - \\operatorname{mod}(x,1))^2 + ' +
        '\\operatorname{mod}(x,1) y + \\operatorname{mod}(x,1) + ' +
        '3\\operatorname{mod}(x,1)'
    );
  };

  it('GLSL: the inner application is the temporary; the negations read it', () => {
    const ce = new ComputeEngine();
    const code = glsl.compile(negatedAndBare(ce)).code;
    // `Mod(x, 1)` lowers either to `mod(x, 1.0)` or to the equivalent
    // `fract(x)`; the sharing is what this pins, not the spelling.
    expect(code).toMatch(/float _cse\d+ = (?:mod\(x, 1\.0\)|fract\(x\));/);
    expect(
      occurrences(code, 'mod(x, 1.0)') + occurrences(code, 'fract(x)')
    ).toBe(1);
    expect(code).toMatch(/\+ -_cse\d+/);
  });

  it('JavaScript: the same keying, and the value is unchanged', () => {
    const ce = new ComputeEngine();
    const expr = negatedAndBare(ce);
    const result = compile(expr);
    expect(result.code).toMatch(/const _cse\d+ = /);
    expect(result.code).toMatch(/\+ -_cse\d+/);
    const expected = expr.subs({ x: ce.number(3.7), y: ce.number(1.2) }).N().re;
    expect(result.run?.({ x: 3.7, y: 1.2 })).toBeCloseTo(
      expected as number,
      12
    );
  });

  it('with NO bare occurrence the negation stays the candidate', () => {
    // Nothing is gained by binding the inner term when every occurrence is
    // negated: the negation is then shared too.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    const code = glsl.compile(
      ce.parse(
        '(y - \\operatorname{mod}(x,1))^2 + (2y - \\operatorname{mod}(x,1))^2 + ' +
          '(3y - \\operatorname{mod}(x,1))^2'
      )
    ).code;
    expect(code).toMatch(/float _cse\d+ = -(?:mod\(x, 1\.0\)|fract\(x\));/);
  });
});
