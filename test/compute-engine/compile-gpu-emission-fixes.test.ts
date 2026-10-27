/**
 * Shape and emission fixes of the GLSL and WGSL targets
 * (`src/compute-engine/compilation/gpu-target.ts`). Each block names the
 * ROADMAP reference of the defect it pins.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

const ce = new ComputeEngine();
ce.declare('u', 'real');
ce.declare('n', 'integer');
ce.declare('v', 'vector<real^3>');
ce.declare('M', 'matrix<real^(2x2)>');

const TARGETS = ['glsl', 'wgsl'] as const;

/** The compiled result; the compile must succeed. */
function shader(
  json: unknown,
  to: 'glsl' | 'wgsl',
  options: Record<string, unknown> = {}
): { code: string; preamble: string } {
  const r = compile(ce.box(json as never), {
    to,
    fallback: false,
    ...options,
  } as never);
  expect([to, r.success]).toEqual([to, true]);
  return {
    code: r.code!,
    preamble: (r as { preamble?: string }).preamble ?? '',
  };
}

/** The same, from raw (non-canonical) MathJSON. */
function rawShader(json: unknown, to: 'glsl' | 'wgsl'): string {
  const r = compile(ce.box(json as never, { form: 'raw' } as never), {
    to,
    fallback: false,
  } as never);
  expect([to, r.success]).toEqual([to, true]);
  return r.code!;
}

function declines(json: unknown, to: 'glsl' | 'wgsl', message: RegExp): void {
  expect(() =>
    compile(ce.box(json as never), { to, fallback: false } as never)
  ).toThrow(message);
}

// CE-241.2: the WGSL `select` of `ContrastingColor` has as many arguments as
// the head has operands, so the operand-shape check compared the converted
// colours with the operand shapes, and refused a colour literal (a scalar
// shape) beside a tuple background (a `vec3` shape).
describe('ContrastingColor with a tuple background and colour candidates (CE-241.2)', () => {
  const expr = [
    'ContrastingColor',
    ['Tuple', 'u', 1, 1],
    ['Rgb', 1, 0, 0],
    ['Rgb', 0, 0, 1],
  ];
  test('compiles on both shader targets', () => {
    expect(shader(expr, 'wgsl').code).toContain('select(');
    expect(shader(expr, 'glsl').code).toContain(' ? ');
  });
});

// CE-241.3: an infinite OKLab or OKLCh channel is not a colour. The javascript
// target answers the NaN colour; the shader targets passed the channels
// through.
describe('Oklch and Oklab check their channels on the shader targets (CE-241.3)', () => {
  test.each(TARGETS)('%s: a channel that is not a literal is checked', (to) => {
    const lch = shader(['Oklch', 'u', 0.1, 30], to);
    expect(lch.code).toMatch(/^_gpu_finite_color\(vec3f?\(u, 0\.1, 30\.0\)\)$/);
    expect(lch.preamble).toMatch(/_gpu_finite_color\(/);
    expect(lch.preamble).toContain('3.4028234663852886e38');
    const lab = shader(['Oklab', 'u', 0.1, 0.2], to);
    expect(lab.code).toMatch(
      /^_gpu_oklab_to_oklch\(_gpu_finite_color\(vec3f?\(u, 0\.1, 0\.2\)\)\)$/
    );
  });

  test.each(TARGETS)('%s: an infinite literal channel is checked', (to) => {
    for (const head of ['Oklch', 'AsOklch']) {
      const json =
        head === 'Oklch'
          ? ['Oklch', 'PositiveInfinity', 0.1, 30]
          : ['AsOklch', ['Oklch', 'PositiveInfinity', 0.1, 30]];
      expect(shader(json, to, { constantFold: false }).code).toMatch(
        /^_gpu_finite_color\(vec3f?\(_gpu_inf\(\), 0\.1, 30\.0\)\)$/
      );
    }
  });

  test.each(TARGETS)(
    '%s: finite literal channels keep the plain vector',
    (to) => {
      expect(shader(['Oklch', 0.5, 0.1, 30], to).code).toMatch(
        /^vec3f?\(0\.5, 0\.1, 30\.0\)$/
      );
    }
  );

  test('the javascript target gives the NaN colour for the same input', () => {
    const r = compile(ce.box(['Oklch', 'u', 0.1, 30]), { to: 'javascript' });
    const c = r.run!({ u: Infinity }) as { c0: number; c1: number; c2: number };
    expect([c.c0, c.c1, c.c2]).toEqual([NaN, NaN, NaN]);
  });
});

// CE-251.1: an identity lowering hands the parent its operand's code, so an
// infix operand must keep its parentheses. Only non-canonical input has these
// shapes.
describe('identity lowerings keep the grouping of their operand (CE-251.1)', () => {
  const X1 = ['Add', 'u', 1];
  test.each(TARGETS)('%s', (to) => {
    for (const inner of [
      ['Binomial', X1, 1],
      ['Choose', X1, 1],
      ['ElementMax', X1],
      ['ElementMin', X1],
      ['Median', X1],
    ])
      expect(rawShader(['Multiply', 3, inner], to)).toBe('3.0 * (u + 1.0)');
  });

  // `Apply` substitutes the argument into the body of its callee. The
  // derivative of `x³ + sin x` is a sum, which must stay one operand of the
  // product: `3·h'(x)` is `9x² + 3cos x`, not `9x² + cos x`.
  test.each(TARGETS)('Apply of a derivative, %s', (to) => {
    const e = new ComputeEngine();
    e.parse('h(x) \\coloneq x^3 + \\sin x').evaluate();
    const r = compile(e.parse("3h'(x)"), { to, fallback: false } as never);
    expect(r.code).toBe('3.0 * (3.0 * (x * x) + _gpu_cos(x))');
  });
});

// CE-254: the `fract` and `exp2` peepholes leave an operand out of the
// emitted call. The lowerings declare it (`markOperandConsuming`), so a
// vector operand takes the peephole too.
describe('the fract and exp2 peepholes apply to a vector operand (CE-254)', () => {
  test.each(TARGETS)('%s', (to) => {
    expect(shader(['Mod', 'v', 1], to).code).toBe('fract(fract(v))');
    expect(shader(['Power', 2, 'v'], to).code).toBe('exp2(v)');
    // A divisor other than 1 keeps the general lowering.
    expect(shader(['Mod', 'v', 2], to).code).not.toContain('fract');
  });

  test.each(TARGETS)('%s: an operand with no overload still declines', (to) => {
    declines(['Mod', 'M', 1], to, /`fract` .* no `matN` overload/);
    declines(['Power', 2, 'M'], to, /`exp2` .* no `matN` overload/);
  });
});

// CE-258: a hoisted binding that no code reads is not declared.
describe('a loop-invariant binding with no reader is not declared (CE-258)', () => {
  test.each(TARGETS)('%s', (to) => {
    for (const upper of [3, 200]) {
      const r = compile(
        ce.parse(`\\sum_{i=1}^{${upper}}(i u + \\min([1,2,3]))`),
        { to, fallback: false }
      );
      expect(r.success).toBe(true);
      // The list literal was bound as its own class, and `Min` folded to 1
      // without reading it.
      expect(r.code).not.toMatch(/vec3f?\(1\.0, 2\.0, 3\.0\)/);
      // Every declared temporary is read.
      for (const [, name] of r.code!.matchAll(
        /(?:float|f32|let|var) (_tv\d+)/g
      ))
        expect(
          r.code!.split(new RegExp(`\\b${name}\\b`)).length
        ).toBeGreaterThan(2);
    }
  });

  test('a binding that is read is still declared', () => {
    const r = compile(ce.parse('\\sum_{i=1}^{200}(i u + \\sin(u)^2)'), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.code).toMatch(/float _tv\d+ = _gpu_pow2\(_gpu_sin\(u\)\);/);
  });
});

// CE-280.6: a collection with a complex element is complex-valued, but it has
// one component per element, not the two of a complex value.
describe('the component count of a collection with a complex element (CE-280.6)', () => {
  test('is the number of elements', () => {
    const x = ce.box(['Add', ['List', 1, 2, 'ImaginaryUnit'], 'x']);
    expect(BaseCompiler.isComplexValued(x)).toBe(true);
    expect(BaseCompiler.aggregateComponentCount(x)).toBe(3);
    expect(
      BaseCompiler.aggregateComponentCount(
        ce.box(['Negate', ['List', 1, 2, 'ImaginaryUnit']])
      )
    ).toBe(3);
  });

  test('a complex scalar still has two components', () => {
    const z = ce.box(['Add', ['Complex', 1, 2], 'x']);
    expect(BaseCompiler.aggregateComponentCount(z)).toBe(2);
  });
});

// CE-280.11: `GCD`/`LCM` fold over the components of their operands, as in
// the interpreter.
describe('GCD and LCM fold over the components (CE-280.11)', () => {
  test.each(TARGETS)('%s', (to) => {
    expect(shader(['GCD', 'v'], to).code).toBe(
      '_gpu_gcd(_gpu_gcd(v.x, v.y), v.z)'
    );
    const lcm = shader(['LCM', 'v'], to);
    expect(lcm.code).toBe('_gpu_lcm(_gpu_lcm(v.x, v.y), v.z)');
    expect(lcm.preamble).toMatch(/_gpu_lcm\(/);
    expect(shader(['GCD', 'v', 'u'], to).code).toBe(
      '_gpu_gcd(_gpu_gcd(_gpu_gcd(v.x, v.y), v.z), u)'
    );
    expect(shader(['GCD', 'u', 'x', 'y'], to).code).toBe(
      '_gpu_gcd(_gpu_gcd(u, x), y)'
    );
    // `GCD(-12)` is 12 in the interpreter.
    expect(shader(['GCD', 'u'], to).code).toBe('abs(u)');
    declines(['GCD', 'M'], to, /no compile-time component list/);
  });

  test('the interpreter values the fold reproduces', () => {
    expect(ce.box(['GCD', ['List', 4, 6, 8]]).evaluate().re).toBe(2);
    expect(ce.box(['LCM', ['List', 4, 6, 8]]).evaluate().re).toBe(24);
    expect(ce.box(['GCD', -12]).evaluate().re).toBe(12);
    // `_gpu_lcm(a, b)` is `|a| / gcd(a, b) · |b|`, as on the javascript
    // target for real operands.
    const r = compile(ce.box(['LCM', 'x', 'y']), { to: 'javascript' });
    expect(r.run!({ x: 4.5, y: 6 })).toBe((4.5 / 1.5) * 6);
  });
});

// CE-274: a `Match` case body that needs statements takes the statement form
// of `If`/`Which`.
describe('Match with a loop-form Sum in a case body (CE-274)', () => {
  const LOOP = [
    'Sum',
    ['Cos', ['Multiply', 'k', 'u']],
    ['Limits', 'k', 1, ['Floor', 'u']],
  ];
  test.each(TARGETS)('%s: the loop runs inside its case', (to) => {
    for (const expr of [
      [
        'Match',
        'n',
        ['MatchCase', 1, LOOP],
        ['MatchCase', 2, 20],
        ['MatchCase', '_', 0],
      ],
      [
        'Match',
        'n',
        ['MatchCase', 1, 10],
        ['MatchCase', 2, LOOP],
        ['MatchCase', '_', 0],
      ],
      ['Match', 'n', ['MatchCase', 1, 10], ['MatchCase', '_', LOOP]],
    ]) {
      const { code } = shader(expr, to);
      const loop = code.indexOf('for (');
      expect(code).toMatch(/if \(n == 1\.0\) \{/);
      expect(loop).toBeGreaterThan(code.indexOf('if ('));
    }
    const { code } = shader(
      [
        'Match',
        'n',
        ['MatchCase', 1, LOOP],
        ['MatchCase', 2, 20],
        ['MatchCase', '_', 0],
      ],
      to
    );
    // The loop is in the branch of the first case, before its `else`.
    expect(code.indexOf('for (')).toBeLessThan(code.indexOf('} else {'));
  });

  // A case guard that is the symbol `True` was given to the statement form
  // as its condition, and the statement form reads a `True` condition as the
  // default branch: the case body was emitted with no pattern test, and the
  // later cases were dropped.
  test.each(TARGETS)(
    '%s: a case with a True guard keeps its pattern test',
    (to) => {
      for (const expr of [
        [
          'Match',
          'n',
          ['MatchCase', 1, 'True', LOOP],
          ['MatchCase', 2, 20],
          ['MatchCase', '_', 0],
        ],
        [
          'Match',
          'n',
          ['MatchCase', 1, 'True', 10],
          ['MatchCase', 2, LOOP],
          ['MatchCase', '_', 0],
        ],
      ]) {
        const { code } = shader(expr, to);
        expect(code).toMatch(/if \(\(n == 1\.0\) && \(true\)\) \{/);
        expect(code).toMatch(/if \(n == 2\.0\) \{/);
      }
    }
  );

  test.each(TARGETS)(
    '%s: a Match with no such body keeps the ternary',
    (to) => {
      const { code } = shader(
        [
          'Match',
          'n',
          ['MatchCase', 1, 10],
          ['MatchCase', 3, 30],
          ['MatchCase', '_', -1],
        ],
        to
      );
      expect(code).not.toContain('if (');
    }
  );
});

// `Clamp(x, lo, hi)` takes three operands. A raw expression with fewer
// operands evaluates to `Error("missing")`, and the lowerings emitted invalid
// code for it (`clamp(u + 1.0)`, `Math.max(_.u + 1, )`).
describe('Clamp with fewer than three operands fails closed', () => {
  test.each(['glsl', 'wgsl', 'javascript', 'python'])('%s', (to) => {
    for (const json of [
      ['Clamp', ['Add', 'u', 1]],
      ['Clamp', ['Add', 'u', 1], 0],
    ])
      expect(() =>
        compile(ce.box(json as never, { form: 'raw' }), {
          to,
          fallback: false,
        } as never)
      ).toThrow(/expected three operands/);
  });
});
