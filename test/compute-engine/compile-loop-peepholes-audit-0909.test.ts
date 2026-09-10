import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Peepholes the Tycho code-generation audit of 2026-09-09 measured on the
 * Desmos corpus, on the game-of-life comprehension (`[Σ … for k = 1..(N²)]`)
 * and on the GLSL heat-map shader.
 *
 * Four emissions are pinned here:
 *
 * - the element type of a `Range`, which decides whether an equality against
 *   its index compiles to `===` or to the tolerance test;
 * - the decidedness test around a comparison with a compiled loop index;
 * - the per-term NaN test of an unrolled `Sum`;
 * - the number of digits a shader float literal carries, and the reach of the
 *   emitted-code constant fold into a parenthesized numerator.
 */

/** The emitted artifact, preamble included. */
function source(r: { preamble?: string; code?: string }): string {
  return (r.preamble ?? '') + (r.code ?? '');
}

function js(ce: ComputeEngine, expr: any): string {
  return source(compile(expr, { to: 'javascript' } as any) as any);
}

describe('Range element type reads the lower bound and the step, not the upper', () => {
  test('a fractional UPPER bound leaves the elements integer', () => {
    const ce = new ComputeEngine();
    // The elements are 1 and 2; the upper bound is never one of them.
    expect(ce.box(['Range', 1, 2.5]).evaluate().toString()).toBe('[1,2]');
    expect(ce.box(['Range', 1, 2.5]).type.toString()).toBe(
      'indexed_collection<integer>'
    );
    expect(ce.box(['Range', 1, 5.7, 2]).evaluate().toString()).toBe('[1,3,5]');
    expect(ce.box(['Range', 1, 5.7, 2]).type.toString()).toBe(
      'indexed_collection<integer>'
    );
  });

  test('a fractional LOWER bound or step still widens to real', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Range', 0.5, 2.5]).type.toString()).toBe(
      'indexed_collection<real>'
    );
    expect(ce.box(['Range', 1, 3, 0.5]).type.toString()).toBe(
      'indexed_collection<real>'
    );
  });

  test('a symbolic upper bound declared `real` leaves the elements integer', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    ce.assign('N', 150);
    expect(ce.box(['Range', 1, ['Square', 'N']]).type.toString()).toBe(
      'indexed_collection<integer>'
    );
  });
});

describe('a comparison against a compiled loop index', () => {
  /** The game-of-life shape: a comprehension over `1..(N²)` whose body sums a
   * membership test against the index. `N` is declared `real`, as a Desmos
   * slider is, which is what used to widen the index to `real`. */
  const comprehension = (ce: ComputeEngine): any => {
    ce.declare('N', 'real');
    ce.assign('N', 150);
    return ce.box([
      'Comprehension',
      ['Sum', ['Which', ['Equal', 'n', 'k'], 1, 'True', 0], ['Limits', 'n', 1, 6]],
      ['Element', 'k', ['Range', 1, ['Square', 'N']]],
    ]);
  };

  test('compares exactly, with no tolerance and no decidedness test', () => {
    const ce = new ComputeEngine();
    const code = js(ce, comprehension(ce));
    expect(code).toContain('const k = 1 + (1) * ');
    expect(code).toContain('((1) === (k))');
    expect(code).not.toContain('1e-10');
    expect(code).not.toContain('k === k');
    expect(code).not.toContain('NaN');
  });

  test('the unrolled sum drops its per-term NaN test', () => {
    const ce = new ComputeEngine();
    const code = js(ce, comprehension(ce));
    expect(code).toContain('_tv1 += ');
    expect(code).not.toMatch(/!== _tv\d/);
  });

  test('the compiled comprehension answers what the interpreter answers', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Comprehension',
      [
        'Sum',
        ['Which', ['Equal', 'n', 'k'], 1, 'True', 0],
        ['Limits', 'n', 1, 6],
      ],
      ['Element', 'k', ['Range', 1, 10]],
    ]);
    const r = compile(expr, { to: 'javascript', fallback: false } as any) as any;
    expect(r.run!()).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  test('a FREE symbol keeps the NaN tests', () => {
    const ce = new ComputeEngine();
    // `x` is supplied by the caller, so it can be NaN or absent: the
    // decidedness test and the per-term exit both earn their place. The
    // comparison itself is exact (compiled equality carries no tolerance).
    const code = js(
      ce,
      ce.box([
        'Sum',
        ['Which', ['Equal', 'n', 'x'], 1, 'True', 0],
        ['Limits', 'n', 1, 6],
      ])
    );
    expect(code).toContain('_.x === _.x');
    expect(code).toContain('((1) === (_.x))');
    expect(code).not.toContain('1e-10');
    expect(code).toMatch(/!== _tv\d/);
  });
});

describe('the counted-range prologue', () => {
  test('literal bounds emit no length check', () => {
    const ce = new ComputeEngine();
    const code = js(
      ce,
      ce.box(['Comprehension', ['Multiply', 2, 'k'], ['Element', 'k', ['Range', 1, 22500]]])
    );
    expect(code).toContain('for (let _tv1 = 0; _tv1 < 22500; _tv1++)');
    expect(code).not.toContain('RangeError');
  });

  test('an upper bound the compiler cannot fold keeps the length check', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'real');
    const code = js(
      ce,
      ce.box(['Comprehension', ['Multiply', 2, 'k'], ['Element', 'k', ['Range', 1, 'M']]])
    );
    expect(code).toContain('RangeError');
  });
});

describe('the audit’s game-of-life membership list', () => {
  /** `[ Σ_{i=1}^{Length(P)} { P[i] = k : 1, 0 }  for k = 1..(N²) ]`, the setup
   * expression of the corpus document. `P[i]` is typed `integer | nan` (an
   * out-of-range read answers NaN), which used to keep the tolerance test. */
  const LATEX =
    '\\left[\\sum_{i=1}^{\\mathrm{Length}(P)}' +
    '\\begin{cases}1&P[i]=k\\\\0&\\top\\end{cases} ' +
    '\\operatorname{for} k = 1..(N^2)\\right]';

  const cells = [3, 9, 14, 15, 16, 21, 25, 30];

  const setup = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    ce.assign('N', 6);
    ce.assign('P', ce.box(['List', ...cells]));
    return ce;
  };

  test('every term is an exact integer comparison, with no guard', () => {
    const ce = setup();
    const code = js(ce, ce.parse(LATEX));
    expect(code).toContain('((3) === (k))');
    expect(code).not.toContain('1e-10');
    expect(code).not.toContain('NaN');
    expect(code).not.toMatch(/!== _tv\d/);
  });

  test('the compiled list is the interpreted list', () => {
    const ce = setup();
    const expr = ce.parse(LATEX);
    const r = compile(expr, { to: 'javascript', fallback: false } as any) as any;
    expect(r.run!()).toEqual(
      Array.from({ length: 36 }, (_, i) => (cells.includes(i + 1) ? 1 : 0))
    );
  });
});

describe('a Sum over a collection declines by naming its clause', () => {
  test('the interpreter still answers it', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Sum',
      ['Multiply', 'n', 2],
      ['Element', 'n', ['List', 3, 5, 7]],
    ]);
    expect(expr.evaluate().toString()).toBe('30');
    const r = compile(expr, { to: 'javascript' } as any) as any;
    expect(r.code ?? '').toBe('');
    expect(String(r.error ?? r.diagnostic ?? '')).not.toContain(
      'erasure marker'
    );
  });
});

describe('shader float literals', () => {
  test('abs of a folded literal folds too, so the sqrt around it folds', () => {
    // `abs` only clears the sign bit, so it is exact in every IEEE format and
    // the emitted-code fold may take it; before, `sqrt(abs(0.999375))` was
    // left as a run-time call because `abs` was not in the shader dialect.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const code = glsl(ce, '\\sqrt{\\left|1 - 0.000625\\right|} x');
    expect(code).toContain('0.99968743');
    expect(code).not.toContain('abs(');
  });

  const glsl = (ce: ComputeEngine, latex: string): string =>
    source(compile(ce.parse(latex), { to: 'glsl' } as any) as any);

  test('a folded constant prints the shortest single-precision decimal', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    // `Math.fround(2π)` is exactly 6.2831854820251465 as a double; single
    // precision cannot tell it from 6.2831855.
    expect(glsl(ce, '2\\pi x')).toContain('6.2831855');
    expect(glsl(ce, '2\\pi x')).not.toContain('6.2831854820251465');
    expect(glsl(ce, '\\sqrt{2} x')).toContain('1.4142135');
  });

  test('a value single precision holds exactly is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(glsl(ce, '0.5 x')).toContain('0.5');
    expect(glsl(ce, '3 x')).toContain('3.0');
    expect(glsl(ce, '0.1 x')).toContain('0.1');
  });

  test('a value that underflows single precision to zero is left to toString', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    // `Math.fround(1e-300)` is `0`: single precision cannot represent a
    // magnitude this small. The shortest-decimal search must not hand back
    // the round-tripping candidate `"0"`, which would silently drop the
    // value to zero.
    expect(glsl(ce, '1e-300 x')).toContain('1e-300');
  });
});

describe('the emitted-code fold reaches a parenthesized numerator', () => {
  const withPeriod = (ce: ComputeEngine): void => {
    ce.parse('P := 100').evaluate();
  };

  test('at the root', () => {
    const ce = new ComputeEngine();
    withPeriod(ce);
    expect(js(ce, ce.parse('\\cos(\\frac{2\\pi u}{P})'))).toBe(
      'Math.cos((6.283185307179586 * _.u) / 100)'
    );
  });

  test('inside a user-function body', () => {
    const ce = new ComputeEngine();
    withPeriod(ce);
    ce.parse('X(s) := \\cos(\\frac{2\\pi s}{P})').evaluate();
    expect(js(ce, ce.parse('X(t)'))).toContain(
      'Math.cos((6.283185307179586 * s) / 100)'
    );
  });

  test('the folded quotient computes what the unfolded one computed', () => {
    const ce = new ComputeEngine();
    withPeriod(ce);
    const r = compile(ce.parse('\\cos(\\frac{2\\pi u}{P})'), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.run!({ u: 25 })).toBeCloseTo(
      Math.cos((2 * Math.PI * 25) / 100),
      12
    );
  });
});
