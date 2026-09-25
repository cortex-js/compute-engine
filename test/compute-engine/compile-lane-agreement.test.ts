import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ComputeEngine, compile } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

/**
 * A compiled value has a LANE: on the JavaScript target a complex value is a
 * `{re, im}` object and a real one a number; on the shader targets a `vec2`
 * and a `float`. The lowering of a node and the parent expression that reads
 * the node must agree on it, or the parent reads the value in the wrong
 * representation (`"[object Object]1"` behind `success: true`).
 *
 * This file pins three sources of such a disagreement, each one fixed where
 * the lane is decided:
 *
 *  - a `Typed` ascription whose type contradicts its value (a declared
 *    `(unknown) -> real` over a complex body);
 *  - a real-only lowering over a statically non-real operand, and the
 *    per-target declaration of which lowerings are real-only;
 *  - the lane question a parent asks about a user-function call, which can
 *    emit a definition before the call itself compiles.
 */

describe('A `Typed` ascription and the lane of its value', () => {
  function withSignature(signature: string, body: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('q', { signature } as any);
    ce.assign('q', ce.parse(body));
    ce.declare('w', 'complex');
    return ce;
  }

  // `q: (unknown) -> real` and `q := z ↦ z²`: `q(1 + i)` is `2i`. The body
  // is `Typed(z², real)`. The emitted `_fn_q` returned the `{re, im}` object,
  // and the call site read the lane from the ascription, so `q(w) + 1`
  // compiled to `_fn_q(_.w) + 1` and returned `"[object Object]1"`.
  for (const mode of ['auto', 'complex'] as const)
    it(`JavaScript ${mode}: a complex value under a real result fails closed`, () => {
      const ce = withSignature('(unknown) -> real', 'z \\mapsto z^2');
      const expr = ce.parse('q(w) + 1');
      expect(
        expr
          .subs({ w: ce.parse('1+\\imaginaryI') })
          .N()
          .toString()
      ).toBe('(1 + 2i)');
      expect(() =>
        compile(expr, { to: 'javascript', mode, fallback: false } as any)
      ).toThrow(
        /Could not compile `Typed`: the value `w\^2` is complex, but its ascribed type `real` says it is real\..*\(unknown\) -> complex/s
      );
    });

  it('JavaScript strict: the complex argument is refused at the parameter', () => {
    const ce = withSignature('(unknown) -> real', 'z \\mapsto z^2');
    expect(() =>
      compile(ce.parse('q(w) + 1'), {
        to: 'javascript',
        mode: 'strict',
        fallback: false,
      } as any)
    ).toThrow(/Lane mismatch/);
  });

  it('JavaScript: a real value under a real result compiles', () => {
    const ce = withSignature('(unknown) -> real', 'z \\mapsto |z|');
    const r = compile(ce.parse('q(w) + 1'), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.run({ w: { re: 3, im: 4 } })).toBe(6);
  });

  it('JavaScript: a real value under a complex result is lifted', () => {
    const ce = withSignature('(real) -> complex', 't \\mapsto t^2');
    const r = compile(ce.parse('q(x) + \\imaginaryI'), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.run({ x: 3 })).toEqual({ re: 9, im: 1 });
  });
});

describe('Real-only lowerings over a statically non-real operand', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('z', 'complex');
    return ce;
  }

  // `x + i` over a real `x` has the imaginary part 1 at every point. The
  // JavaScript `_SYS.erf` and `_SYS.gamma` are real-only, so the value has
  // no compiled form: before, the run-time rule emitted
  // `cisreal(x + i) ? erf(…) : NaN`, which was NaN at every point, where the
  // interpreter answers `Erf(0.5 + i) = 1.3162 + 0.1905i`.
  for (const latex of [
    '\\operatorname{erf}(x+\\imaginaryI)',
    '\\Gamma(x+\\imaginaryI)',
    '\\operatorname{erfc}(1-2\\imaginaryI+x)',
  ])
    for (const mode of ['auto', 'complex'] as const)
      it(`JavaScript ${mode}: ${latex} fails closed`, () => {
        expect(() =>
          compile(engine().parse(latex), {
            to: 'javascript',
            mode,
            fallback: false,
          } as any)
        ).toThrow(/is certainly not a real number/);
      });

  // A `complex`-typed symbol MAY hold a real value, so it keeps the run-time
  // rule: the real helper runs when the imaginary part is zero.
  it('JavaScript: Erf(z) over a complex-typed symbol keeps the run-time rule', () => {
    const r = compile(engine().parse('\\operatorname{erf}(z)'), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.run({ z: { re: 0.5, im: 0 } })).toBeCloseTo(0.5204998778, 9);
    expect(r.run({ z: { re: 0.5, im: 1 } })).toBeNaN();
  });

  // A factor that may be zero may cancel the imaginary part: `x·i` is real at
  // `x = 0`, so it is not statically non-real, and keeps the run-time rule.
  it('JavaScript: Erf(x·i) keeps the run-time rule', () => {
    const r = compile(engine().parse('\\operatorname{erf}(x\\imaginaryI)'), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.run({ x: 0 })).toBe(0);
    expect(r.run({ x: 1 })).toBeNaN();
  });

  it('the shader targets fail closed', () => {
    for (const to of ['glsl', 'wgsl'])
      expect(() =>
        compile(engine().parse('\\operatorname{erf}(x+\\imaginaryI)'), {
          to,
          fallback: false,
        } as any)
      ).toThrow(
        /Could not compile `Erf`: the target's lowering for this head is real-only/
      );
  });

  // `GammaLn` is not listed: `scipy.special.loggamma` takes a different
  // branch than the interpreter (`compile-linear-algebra-lanes.test.ts`).
  it('Python: Erf, Erfc and Gamma take a complex argument', () => {
    const ce = engine();
    const Z = ['Add', 'x', 'ImaginaryUnit'];
    for (const [json, helper] of [
      [['Erf', Z], 'scipy.special.erf('],
      [['Erfc', Z], 'scipy.special.erfc('],
      [['Gamma', Z], 'scipy.special.gamma('],
    ] as const) {
      const r = compile(ce.box(json as any), {
        to: 'python',
        fallback: false,
      } as any) as any;
      expect([json[0], r.success]).toEqual([json[0], true]);
      expect(r.code).toContain(helper);
      expect(r.code).not.toContain('_ce_cisreal');
    }
  });
});

// The repo's Python virtual environment, when present. The value checks are
// skipped without it.
const PYTHON = [
  path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
  path.join(process.cwd(), 'venv', 'bin', 'python3'),
].find((p) => fs.existsSync(p));

(PYTHON === undefined ? describe.skip : describe)(
  'Python values of a special function over a complex argument',
  () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const Z = ['Add', 'x', 'ImaginaryUnit'];
    // The interpreter has no complex `Erfc` (it leaves `Erfc(0.5 + i)`
    // unevaluated), so its reference value is `1 − Erf(z)`, the definition
    // of `Erfc`.
    for (const [json, reference] of [
      [
        ['Erf', Z],
        ['Erf', Z],
      ],
      [
        ['Erfc', Z],
        ['Subtract', 1, ['Erf', Z]],
      ],
      [
        ['Gamma', Z],
        ['Gamma', Z],
      ],
      [
        ['Arcosh', ['Subtract', Z, 3]],
        ['Arcosh', ['Subtract', Z, 3]],
      ],
      [
        ['Log2', Z],
        ['Log2', Z],
      ],
      [
        ['Determinant', ['List', ['List', Z, 2], ['List', 1, 'x']]],
        ['Determinant', ['List', ['List', Z, 2], ['List', 1, 'x']]],
      ],
    ] as const)
      it(json[0], () => {
        const expr = ce.box(json as any);
        const r = compile(expr, {
          to: 'python',
          fallback: false,
        } as any) as any;
        // The helper receives the complex value as it is, not through the
        // run-time realness rule.
        expect(r.code).not.toContain('_ce_cisreal');
        const program = [
          'import numpy as np',
          'import scipy.special',
          'import cmath',
          'import math',
          'x = 0.5',
          r.preamble ?? '',
          `v = complex(${r.code})`,
          'print(repr(v.real), repr(v.imag))',
        ].join('\n');
        const out = execFileSync(PYTHON!, ['-c', program], {
          encoding: 'utf8',
        }).trim();
        const [re, im] = out.split(/\s+/).map(Number);
        const expected = ce
          .box(reference as any)
          .subs({ x: 0.5 })
          .N();
        expect(re).toBeCloseTo(expected.re, 9);
        expect(im).toBeCloseTo(expected.im, 9);
      });
  }
);

describe('The lane question about a user-function call', () => {
  // A parent asks for the lane of a call before the call compiles, and the
  // answer comes from the definition the call uses, which is emitted to
  // answer it (`userCallDefinition`). When the call is then compiled another
  // way — here, folded to a constant — that definition is dead text, and is
  // removed from the preamble (`pruneUnreferencedVariantBases`).
  it('a definition emitted for the question and not used is removed', () => {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(unknown) -> unknown' } as any);
    ce.assign('h', ce.parse('s \\mapsto s + \\imaginaryI'));
    const seen: string[][] = [];
    const prune = jest
      .spyOn(BaseCompiler, 'pruneUnreferencedVariantBases')
      .mockImplementation(function (this: unknown, registry, rootCode) {
        seen.push([...registry.defs.keys()]);
        prune.mockRestore();
        return BaseCompiler.pruneUnreferencedVariantBases(registry, rootCode);
      });
    const r = compile(ce.parse('h(2) + x'), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    // The question emitted `_fn_h`…
    expect(seen).toEqual([['_fn_h']]);
    // …and the compiled code does not use it.
    expect(r.preamble ?? '').not.toContain('_fn_h');
    expect(r.code).not.toContain('_fn_h');
    expect(r.run({ x: 1 })).toEqual({ re: 3, im: 1 });
  });
});

describe('One boxed expression compiled on two targets in turn', () => {
  // The lane of a call and the route it takes are remembered per compilation
  // (the route memo keyed on the call node, and the call-site target the lane
  // question reads). Compiling the same boxed node on GLSL between two
  // JavaScript compilations must not leak either into the next compilation.
  it('JavaScript, then GLSL, then JavaScript', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { signature: '(real) -> complex' } as any);
    ce.assign('k', ce.parse('s \\mapsto s + \\imaginaryI'));
    ce.declare('g', { signature: '(real) -> real' } as any);
    ce.assign('g', ce.parse('s \\mapsto s^2 + 1'));
    const expr = ce.parse('k(x) + g(x)');

    const js1 = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    const gl = compile(expr, { to: 'glsl', fallback: false } as any) as any;
    const js2 = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as any) as any;

    expect(js1.run({ x: 2 })).toEqual({ re: 7, im: 1 });
    expect(js2.run({ x: 2 })).toEqual({ re: 7, im: 1 });
    expect(js2.code).toBe(js1.code);
    expect(js2.preamble).toBe(js1.preamble);

    // The GLSL compilation has its own definitions, in its own lanes.
    expect(gl.preamble).toContain('vec2 _fn_k(float s)');
    expect(gl.preamble).toContain('float _fn_g(float s)');
    expect(gl.code).not.toContain('_SYS');
    expect(gl.code).not.toContain('_.');
  });
});
