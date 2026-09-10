/**
 * The compile-time KIND analysis (`compilation/provable-kind.ts`): what a
 * user-function application provably IS at run time — one number, or a point
 * (a numeric tuple of a fixed width).
 *
 * The analysis grew out of the scalar-only look-through that admitted
 * `q(x) < y` for a helper declared with an open result type
 * (`(unknown, unknown) -> unknown`, the spelling consumers use so that
 * list-broadcasting keeps working). That whitelist declined four shapes that
 * the interpreter answers with one number, all of them on the same
 * heat-map colour chain: a POINT argument, `Dot` of two points, arithmetic
 * over points, and a `Sum` whose body is a scalar. The kind analysis admits
 * all four.
 *
 * The tests below pin the analysis itself, the values the compiled chain
 * produces, and the shapes that must keep declining — the analysis may only
 * fail by declining, never by admitting a value that is an array at run time.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import {
  provableApplicationKind,
  provableTopLevelKind,
  isProvablyScalarApplication,
  type ProvableKind,
} from '../../src/compute-engine/compilation/provable-kind';

const U1 = '(unknown) -> unknown';
const U2 = '(unknown, unknown) -> unknown';
const U3 = '(unknown, unknown, unknown) -> unknown';

/**
 * The heat-map colour chain of the consumer report, in the consumer's own
 * spelling: every helper is declared with an open result type and holds a
 * lambda, and the constants it captures are declared with a scalar type and
 * assigned a value.
 */
function heatMap(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t_0', 'real');
  ce.assign('t_0', 2.855);
  ce.declare('s_eed', 'real');
  ce.assign('s_eed', 2.41);
  ce.declare('N', 'integer');
  ce.assign('N', 6);
  ce.declare('s_c1', 'number');
  ce.assign('s_c1', 2);
  ce.declare('p_rand', {
    type: U1,
    value: ce.parse(
      '(p)\\mapsto \\operatorname{mod}(\\sin(\\operatorname{Dot}(p, (12.9898,78.233,45.164)))\\cdot 43758.5453, 1)'
    ),
  });
  ce.declare('theta_0', {
    type: U2,
    value: ce.parse(
      '(x,y)\\mapsto 2\\pi\\cdot p_{rand}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,s_{eed}))+t_0'
    ),
  });
  ce.declare('p', {
    type: U2,
    value: ce.parse('(x,y)\\mapsto (\\cos(\\theta_0(x,y)), \\sin(\\theta_0(x,y)))'),
  });
  ce.declare('s_x', { type: U2, value: ce.parse('(x,y)\\mapsto \\operatorname{mod}(x,1)') });
  ce.declare('s_y', { type: U2, value: ce.parse('(x,y)\\mapsto \\operatorname{mod}(y,1)') });
  ce.declare('S', {
    type: U2,
    value: ce.parse('(x,y)\\mapsto (-s_x(x,y), -s_y(x,y))'),
  });
  ce.declare('d_00', {
    type: U2,
    value: ce.parse('(x,y)\\mapsto \\operatorname{Dot}(p(x,y), S(x,y)+(0,0))'),
  });
  ce.declare('d_10', {
    type: U2,
    value: ce.parse('(x,y)\\mapsto \\operatorname{Dot}(p(x+1,y), S(x,y)+(1,0))'),
  });
  ce.declare('d_01', {
    type: U2,
    value: ce.parse('(x,y)\\mapsto \\operatorname{Dot}(p(x,y+1), S(x,y)+(0,1))'),
  });
  ce.declare('d_11', {
    type: U2,
    value: ce.parse('(x,y)\\mapsto \\operatorname{Dot}(p(x+1,y+1), S(x,y)+(1,1))'),
  });
  ce.declare('I', { type: U3, value: ce.parse('(a,b,w)\\mapsto (b-a)w+a') });
  ce.declare('s_s', { type: U1, value: ce.parse('(w)\\mapsto (3-2w)w^2') });
  ce.declare('c_2', {
    type: U2,
    value: ce.parse(
      '(x,y)\\mapsto I(I(d_{00}(x,y), d_{10}(x,y), s_s(s_x(x,y))), I(d_{01}(x,y), d_{11}(x,y), s_s(s_x(x,y))), s_s(s_y(x,y)))'
    ),
  });
  ce.declare('f_Bm', {
    type: U2,
    value: ce.parse(
      '(x,y)\\mapsto \\sum_{n=0}^{N} \\frac{c_2(2^n x\\cos(2\\pi p_{rand}((n+s_{eed},n,n))) - 2^n y\\sin(2\\pi p_{rand}((n+s_{eed},n,n))), 2^n x\\sin(2\\pi p_{rand}((n+s_{eed},n,n))) + 2^n y\\cos(2\\pi p_{rand}((n+s_{eed},n,n))))}{2^n}'
    ),
  });
  ce.declare('R_ec', {
    type: U2,
    value: ce.parse(
      '(x,y)\\mapsto f_{Bm}(x + \\frac{f_{Bm}(x,y)|f_{Bm}(x,y)|}{s_{c1}}, y + \\frac{f_{Bm}(y,x)|f_{Bm}(y,x)|}{s_{c1}})'
    ),
  });
  return ce;
}

/**
 * The chain is expensive to declare and to compile, and nothing below changes
 * it, so every test reads the same engine.
 */
let sharedHeatMap: ComputeEngine | undefined;
const heatMapEngine = (): ComputeEngine => (sharedHeatMap ??= heatMap());

/**
 * The scalar convention the compile gates use, in the form the analysis takes
 * it: an operand is one number at run time when its type is not
 * collection-shaped. A bare `unknown` symbol passes, because at a top-level
 * call site it is a free plot variable.
 */
const argIsScalar = (a: BoxedExpression): boolean =>
  !a.type.matches('collection<any>');

const kindOf = (ce: ComputeEngine, latex: string): ProvableKind | undefined =>
  provableTopLevelKind(ce.parse(latex), argIsScalar);

function compileJS(
  ce: ComputeEngine,
  latex: string
): { code: string; preamble: string; run: (args?: object) => unknown } {
  const jt = (ce as any)._getCompilationTarget('javascript');
  const r = jt.compile(ce.parse(latex));
  return {
    code: r.code ?? '',
    preamble: r.preamble ?? '',
    run: (args?: object) => (r.run ? r.run(args) : r(args)),
  };
}

/** The value the interpreter answers for `latex` at the sample point. */
function interpreted(ce: ComputeEngine, latex: string, vars: object): number {
  return Number(ce.parse(latex).subs(vars as any).N().valueOf());
}

describe('kind analysis — the heat-map chain', () => {
  test('a POINT argument: p_rand of a written-out triple is a scalar', () => {
    const ce = heatMapEngine();
    // The argument is a `Tuple` of three scalars, so the parameter `p` is a
    // point of width 3; `Dot` of two width-3 points is one number.
    expect(kindOf(ce, 'p_{rand}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,s_{eed}))')).toBe(
      'scalar'
    );
    expect(
      isProvablyScalarApplication(
        ce.parse('p_{rand}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,s_{eed}))'),
        new Set(),
        argIsScalar
      )
    ).toBe(true);
  });

  test('a point-valued body: p(x, y) is a point of width 2', () => {
    expect(kindOf(heatMapEngine(), 'p(x,y)')).toEqual({ point: 2 });
  });

  test('Dot of two points, one of them a sum of points, is a scalar', () => {
    const ce = heatMapEngine();
    expect(kindOf(ce, '\\operatorname{Dot}(p(x,y), S(x,y)+(0,0))')).toBe('scalar');
    expect(kindOf(ce, 'd_{00}(x,y)')).toBe('scalar');
  });

  test('the interpolation and the Sum over a scalar body are scalars', () => {
    const ce = heatMapEngine();
    expect(kindOf(ce, 'c_2(x,y)')).toBe('scalar');
    expect(kindOf(ce, 'f_{Bm}(x,y)')).toBe('scalar');
    expect(kindOf(ce, 'R_{ec}(x,y)')).toBe('scalar');
  });

  test('the Sum with a scalar body is unrolled, not looped', () => {
    // The `Sum` has constant bounds and a body the analysis now proves
    // scalar, which is what lets the compiler unroll it. Before the point
    // argument of `p_rand` was admitted, the body was read as possibly
    // element-wise and the emission kept a `while` loop with a broadcast
    // accumulator.
    const r = compileJS(heatMapEngine(), 'f_{Bm}(x,y)');
    expect(r.preamble + r.code).not.toContain('while (');
  });

  test('every row compiles and agrees with the interpreter', () => {
    const vars = { x: 0.3, y: 0.7, z: 0.2 };
    // The noise function multiplies a sine by 43758.5453 and keeps the
    // fractional part, so it amplifies any difference between the compiled
    // double arithmetic and the interpreter's higher-precision arithmetic by
    // about five decimal digits per octave. The last two rows sum seven
    // octaves and then warp the domain with the result, so their tolerance is
    // wider than the plain 1e-9 the shorter rows meet.
    const rows: [string, number][] = [
      ['p_{rand}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,s_{eed}))', 1e-9],
      ['\\theta_0(x,y)', 1e-9],
      ['d_{00}(x,y)', 1e-9],
      ['c_2(x,y)', 1e-9],
      ['f_{Bm}(x,y)', 1e-7],
      ['10R_{ec}(x+y, z)+12', 1e-6],
    ];
    for (const [latex, tolerance] of rows) {
      const ce = heatMapEngine();
      const r = compileJS(ce, latex);
      const value = r.run(vars);
      expect(typeof value).toBe('number');
      expect(Math.abs((value as number) - interpreted(ce, latex, vars))).toBeLessThan(
        tolerance
      );
    }
  });
});

describe('kind analysis — the operator rules', () => {
  /** `f` applied to one scalar argument, for a body written in LaTeX. */
  const bodyKind = (latex: string, extra?: (ce: ComputeEngine) => void) => {
    const ce = new ComputeEngine();
    extra?.(ce);
    ce.declare('f', { type: U1, value: ce.parse(`(x)\\mapsto ${latex}`) });
    return provableApplicationKind(ce.parse('f(x)'), new Set(), () => 'scalar');
  };

  test('a point constructor is a point of its width', () => {
    expect(bodyKind('(x, 1, 2x)')).toEqual({ point: 3 });
  });

  test('Norm and Abs of a point are scalars', () => {
    expect(bodyKind('\\operatorname{Norm}((x, 1))')).toBe('scalar');
    // The interpreter answers the norm for the absolute value of a point:
    // `|(3, 4)|` is 5.
    expect(bodyKind('\\left|(x, 1)\\right|')).toBe('scalar');
  });

  test('a component accessor of a wide enough point is a scalar', () => {
    expect(bodyKind('\\operatorname{PointY}((x, 1))')).toBe('scalar');
    expect(bodyKind('\\operatorname{PointZ}((x, 1, 2))')).toBe('scalar');
    // A component the point does not have never reaches the analysis at all:
    // the interpreter reports `incompatible-dimensions` for `PointZ((x, 1))`
    // while canonicalizing it, so such a body cannot even be declared as the
    // value of a function.
  });

  test('point arithmetic keeps the width', () => {
    expect(bodyKind('(x, 1) + (2, x)')).toEqual({ point: 2 });
    expect(bodyKind('-(x, 1)')).toEqual({ point: 2 });
    expect(bodyKind('3(x, 1)')).toEqual({ point: 2 });
    expect(bodyKind('\\frac{(x, 1)}{2}')).toEqual({ point: 2 });
    // A point raised to a scalar power is raised component-wise: `(1, 2)^2`
    // is `(1, 4)`.
    expect(bodyKind('(x, 1)^2')).toEqual({ point: 2 });
  });

  test('a Sum whose bounds and body are scalars is a scalar', () => {
    expect(
      bodyKind('\\sum_{n=1}^{M} n x', (ce) => {
        ce.declare('M', 'integer');
        ce.assign('M', 3);
      })
    ).toBe('scalar');
  });

  test('a literal term in the Sum body does not stop the proof', () => {
    // The reduction body has a walk of its own, which adds the indices to the
    // reading. That walk must know that a number literal is one number: `n x`
    // was proved scalar while `n x + 1` was not, purely because of the `1`.
    expect(
      bodyKind('\\sum_{n=1}^{M} (n x + 1)', (ce) => {
        ce.declare('M', 'integer');
        ce.assign('M', 3);
      })
    ).toBe('scalar');
  });
});

describe('a literal in a reduction body keeps the compiled row scalar', () => {
  /**
   * `h` keeps the open result type consumers declare, so the TYPE of a row
   * that calls it never proves the row is one number and the compile gate has
   * to ask the kind analysis. When the analysis declined the `+ 1` in the
   * reduction body, the comparison below was emitted as a run-time broadcast
   * dispatch instead of a straight comparison.
   */
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('M', 'integer');
    ce.assign('M', 3);
    ce.declare('h', {
      type: U1,
      value: ce.parse('(t)\\mapsto \\operatorname{Dot}((t,1),(1,2))'),
    });
    ce.declare('f', {
      type: U1,
      value: ce.parse('(x)\\mapsto \\sum_{n=1}^{M} (h(n x) + 1)'),
    });
    return ce;
  }

  test('the comparison compiles straight, with no run-time broadcast', () => {
    const ce = engine();
    const r = compileJS(ce, 'f(x) < y');
    expect(r.code).not.toContain('_SYS.bcast(');
    expect(r.run({ x: 0.3, y: 5 })).toBe(false);
  });

  test('the compiled row agrees with the interpreter', () => {
    const ce = engine();
    const r = compileJS(ce, 'f(x)');
    expect(r.run({ x: 0.3 })).toBeCloseTo(interpreted(ce, 'f(x)', { x: 0.3 }), 12);
  });
});

describe('kind analysis — the shapes that must decline', () => {
  test('a list argument is not scalar, so the call keeps its broadcast', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.declare('d_00', {
      type: U2,
      value: ce.parse('(x,y)\\mapsto \\operatorname{Dot}((x,y), (1,2))'),
    });
    expect(kindOf(ce, 'd_{00}(L, y)')).toBe(undefined);
    const r = compileJS(ce, '\\sin(d_{00}(L, y))');
    expect(r.code).toContain('_SYS.bcast(');
    // `d_00(x, y)` is `Dot((x, y), (1, 2))`, that is `x + 2y`, broadcast over
    // the list argument.
    expect(r.run({ L: [1, 2], y: 3 })).toEqual([
      Math.sin(1 + 2 * 3),
      Math.sin(2 + 2 * 3),
    ]);
  });

  test('a point-valued call is NOT admitted as a scalar', () => {
    // A point is a JavaScript array at run time, so the compile gates must
    // keep treating it as a collection.
    const ce = new ComputeEngine();
    ce.declare('q', { type: U1, value: ce.parse('(x)\\mapsto (x, 1)') });
    expect(kindOf(ce, 'q(x)')).toEqual({ point: 2 });
    expect(isProvablyScalarApplication(ce.parse('q(x)'), new Set(), argIsScalar)).toBe(
      false
    );
    const r = compileJS(ce, '\\sin(q(x))');
    expect(r.code).toContain('_SYS.bcast(');
    expect(r.run({ x: 2 })).toEqual([Math.sin(2), Math.sin(1)]);
  });

  test('a captured symbol with no scalar type declines', () => {
    // Unlike a free plot variable, a captured document symbol is routinely
    // assigned a list later, so a type that does not prove a number is not
    // evidence. (A symbol the engine has already inferred a number from its
    // use — an undeclared `u` inside `x + u` — is a number by that inference
    // and is admitted.)
    const ce = new ComputeEngine();
    ce.declare('u', 'value');
    ce.declare('h', { type: U1, value: ce.parse('(x)\\mapsto x + u') });
    expect(
      provableApplicationKind(ce.parse('h(x)'), new Set(), () => 'scalar')
    ).toBe(undefined);
  });

  test('a point added to a scalar declines', () => {
    // The interpreter reports `incompatible-type` for `(1, 2) + 3`.
    const ce = new ComputeEngine();
    ce.declare('P', { type: U1, value: ce.parse('(x)\\mapsto (x,1) + x') });
    expect(provableApplicationKind(ce.parse('P(x)'), new Set(), () => 'scalar')).toBe(
      undefined
    );
  });

  test('a Sum whose body is a list declines', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'integer');
    ce.assign('M', 3);
    ce.declare('g', {
      type: U1,
      value: ce.parse('(x)\\mapsto \\sum_{n=1}^{M} \\lbrack n, x\\rbrack'),
    });
    expect(provableApplicationKind(ce.parse('g(x)'), new Set(), () => 'scalar')).toBe(
      undefined
    );
  });
});

describe('a symbol whose value the target inlines is not a sequence', () => {
  test('Norm of a point holding an inlined constant does not spread it', () => {
    // `target.sequenceVars` and `target.var` both answer `undefined` for a
    // symbol the target inlined as a literal. Comparing the two readings
    // without checking that an accessor exists made them equal, so the
    // component was emitted as `...2.41` and the kernel threw
    // "2.41 is not iterable".
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    ce.assign('s', 2.41);
    const r = compileJS(ce, '\\operatorname{Norm}((x, 1, s))');
    expect(r.code).not.toContain('...');
    expect(r.run({ x: 3 })).toBeCloseTo(Math.sqrt(9 + 1 + 2.41 ** 2), 12);
  });
});
