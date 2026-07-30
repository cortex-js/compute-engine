import '../utils'; // For snapshot serializers
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

/**
 * GPU user-defined function emission — Phase 2 of the compile-CSE design
 * (§9.1 of `docs/plans/2026-07-28-compile-cse-design.md`).
 *
 * A user-defined function literal called from a shader-compiled expression
 * used to fail as an unknown operator, forcing consumers to inline the body at
 * every call site (the dominant duplication source in the Tycho corpus). The
 * GPU targets now host the same `userFunctions` registry the JS/interval-js
 * targets do: the definition is emitted ONCE as a real GLSL/WGSL function and
 * called by name.
 *
 * Assertions are SHAPE assertions (emitted-source structure) — there is no GPU
 * in the test environment to run the shader against — plus fail-closed
 * diagnostics for everything the shader languages cannot express.
 *
 * Every test builds its OWN engine: these tests assign symbols.
 */

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/** An engine with `f(x) = sin(x) + x²` assigned. */
function engineWithF(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('f', ce.parse('x \\mapsto \\sin x + x^2'));
  return ce;
}

/** Occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('GPU USER FUNCTIONS — one definition, called by name', () => {
  it('GLSL: emits the definition once and calls it twice', () => {
    const ce = engineWithF();
    const r = glsl.compile(ce.parse('f(u) + f(2u)'));

    // Two call sites, no inlined body.
    expect(r.code).toMatchInlineSnapshot(`_fn_f(u) + _fn_f(2.0 * u)`);
    expect(r.code).not.toContain('sin(');

    // Exactly ONE definition, delivered on the same channel as the `_gpu_*`
    // helpers (`CompilationResult.preamble`).
    expect(r.preamble).toMatchInlineSnapshot(`
      float _fn_f(float x) {
        return (x * x) + sin(x);
      }

    `);
    expect(count(r.preamble!, 'float _fn_f(')).toBe(1);
  });

  it('WGSL: emits the definition once and calls it twice', () => {
    const ce = engineWithF();
    const r = wgsl.compile(ce.parse('f(u) + f(2u)'));

    expect(r.code).toMatchInlineSnapshot(`_fn_f(u) + _fn_f(2.0 * u)`);
    expect(r.code).not.toContain('sin(');
    expect(r.preamble).toMatchInlineSnapshot(`
      fn _fn_f(x: f32) -> f32 {
        return (x * x) + sin(x);
      }

    `);
    expect(count(r.preamble!, 'fn _fn_f(')).toBe(1);
  });

  it('a free symbol of the DEFINITION body is still reported as free', () => {
    // The registry (rather than a `functions`-resolver shim) is what keeps
    // `analyzeReferences` descending into the body: a uniform the consumer
    // must bind lives inside `f`, not in the compiled expression.
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x + k'));
    const r = glsl.compile(ce.parse('f(u)'));
    expect([...(r.freeSymbols ?? [])].sort()).toEqual(['k', 'u']);
  });

  it('a helper used only INSIDE the definition body is still declared', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^7'));
    const r = glsl.compile(ce.parse('f(u)'));
    expect(r.code).toBe('_fn_f(u)');
    // `_gpu_powi` appears only in the definition, and the preamble scan sees
    // the definitions as well as the emitted code.
    expect(r.preamble).toContain('_gpu_powi');
    // …and the helper is declared BEFORE the definition that calls it.
    expect(r.preamble!.indexOf('float _gpu_powi(')).toBeLessThan(
      r.preamble!.indexOf('float _fn_f(')
    );
  });
});

describe('GPU USER FUNCTIONS — synthesized signatures', () => {
  it('a point-valued body gets a vecN return type', () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.parse('t \\mapsto (\\cos t, \\sin t)'));

    expect(glsl.compile(ce.parse('p(u)')).preamble).toMatchInlineSnapshot(`
      vec2 _fn_p(float t) {
        return vec2(cos(t), sin(t));
      }

    `);
    expect(wgsl.compile(ce.parse('p(u)')).preamble).toMatchInlineSnapshot(`
      fn _fn_p(t: f32) -> vec2f {
        return vec2f(cos(t), sin(t));
      }

    `);
  });

  it('a 3-component body gets a vec3 return type', () => {
    const ce = new ComputeEngine();
    ce.assign('q', ce.parse('t \\mapsto (t, 2t, 3t)'));
    expect(glsl.compile(ce.parse('q(u)')).preamble).toContain(
      'vec3 _fn_q(float t)'
    );
  });

  it('a declared tuple parameter gets a vecN parameter type', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(tuple<real,real>) -> real');
    ce.assign('h', ce.parse('v \\mapsto 1'));
    const r = glsl.compile(ce.expr(['h', ['Tuple', 1, 2]]));
    expect(r.preamble).toContain('float _fn_h(vec2 v)');
    expect(r.code).toBe('_fn_h(vec2(1.0, 2.0))');
  });

  it('a declared complex parameter/return uses the vec2 complex convention', () => {
    const ce = new ComputeEngine();
    ce.declare('q', '(complex) -> complex');
    ce.assign('q', ce.parse('z \\mapsto z^2'));
    const r = glsl.compile(ce.expr(['q', ['Complex', 1, 2]]));
    expect(r.preamble).toContain('vec2 _fn_q(vec2 z)');
    // The body analysis agrees with the declaration: `z²` lowers through the
    // complex helper, not float multiplication.
    expect(r.preamble).toContain('_gpu_cpow(z');
    expect(r.code).toBe('_fn_q(vec2(1.0, 2.0))');
  });

  it('an undeclared parameter is a float — never an int', () => {
    // GPU number literals always carry a decimal point, so an `int` parameter
    // would disagree with its own call sites (the `compileBlock` rule).
    const ce = new ComputeEngine();
    ce.declare('n', '(integer) -> integer');
    ce.assign('n', ce.parse('m \\mapsto m + 1'));
    const r = glsl.compile(ce.expr(['n', 'u']));
    expect(r.preamble).toContain('float _fn_n(float m)');
    expect(r.preamble).not.toContain('int ');
  });
});

describe('GPU USER FUNCTIONS — definition ordering', () => {
  it('GLSL: a callee is declared before its caller', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('y \\mapsto y + 1'));
    ce.assign('f', ce.parse('x \\mapsto g(x) * 2'));
    const r = glsl.compile(ce.parse('f(u)'));

    expect(r.code).toBe('_fn_f(u)');
    expect(r.preamble).toMatchInlineSnapshot(`
      float _fn_g(float y) {
        return y + 1.0;
      }

      float _fn_f(float x) {
        return 2.0 * _fn_g(x);
      }

    `);
    // GLSL requires declaration before use.
    expect(r.preamble!.indexOf('_fn_g(float y)')).toBeLessThan(
      r.preamble!.indexOf('_fn_f(float x)')
    );
  });

  it('WGSL keeps the same ordering', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('y \\mapsto y + 1'));
    ce.assign('f', ce.parse('x \\mapsto g(x) * 2'));
    const r = wgsl.compile(ce.parse('f(u)'));
    expect(r.preamble!.indexOf('fn _fn_g(')).toBeLessThan(
      r.preamble!.indexOf('fn _fn_f(')
    );
  });
});

describe('GPU USER FUNCTIONS — delivery on every compile route', () => {
  it('compileFunction prepends the definitions to the declaration', () => {
    const ce = engineWithF();
    const src = glsl.compileFunction(
      ce.parse('f(u) + f(2u)'),
      'myFn',
      'float',
      [['u', 'float']]
    );
    expect(src).toMatchInlineSnapshot(`
      float _fn_f(float x) {
        return (x * x) + sin(x);
      }

      float myFn(float u) {
        return _fn_f(u) + _fn_f(2.0 * u);
      }
    `);
    expect(src.indexOf('_fn_f(float x)')).toBeLessThan(
      src.indexOf('float myFn(')
    );
  });

  it('WGSL compileFunction prepends the definitions too', () => {
    const ce = engineWithF();
    const src = wgsl.compileFunction(ce.parse('f(u)'), 'myFn', 'float', [
      ['u', 'float'],
    ]);
    expect(src).toContain('fn _fn_f(x: f32) -> f32');
    expect(src.indexOf('fn _fn_f(')).toBeLessThan(src.indexOf('fn myFn('));
  });

  it('compileFunction declares a helper used only INSIDE the definition', () => {
    // The route returns a COMPLETE declaration, so it must carry the `_gpu_*`
    // helpers the definition bodies reference too — otherwise the emitted
    // source calls `_gpu_powi` with no `_gpu_powi` declared.
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^7'));
    const src = glsl.compileFunction(ce.parse('f(u)'), 'myFn', 'float', [
      ['u', 'float'],
    ]);
    expect(src).toContain('float _gpu_powi(');
    // Declared before the definition that calls it, which precedes `myFn`.
    expect(src.indexOf('float _gpu_powi(')).toBeLessThan(
      src.indexOf('float _fn_f(')
    );
    expect(src.indexOf('float _fn_f(')).toBeLessThan(src.indexOf('float myFn('));
    // …and the definition is delivered EXACTLY once.
    expect(count(src, 'float _fn_f(')).toBe(1);
  });

  it('WGSL compileFunction declares the definition-only helper too', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^7'));
    const src = wgsl.compileFunction(ce.parse('f(u)'), 'myFn', 'float', [
      ['u', 'float'],
    ]);
    expect(src).toContain('fn _gpu_powi(');
    expect(src.indexOf('fn _gpu_powi(')).toBeLessThan(src.indexOf('fn _fn_f('));
    expect(src.indexOf('fn _fn_f(')).toBeLessThan(src.indexOf('fn myFn('));
    expect(count(src, 'fn _fn_f(')).toBe(1);
  });

  it('compileShader splices the definitions ahead of main()', () => {
    const ce = engineWithF();
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [{ variable: 'fragColor.r', expression: ce.parse('f(u) + f(2u)') }],
    });
    expect(count(shader, 'float _fn_f(')).toBe(1);
    expect(shader.indexOf('float _fn_f(')).toBeLessThan(
      shader.indexOf('void main()')
    );
    expect(shader).toContain('fragColor.r = _fn_f(u) + _fn_f(2.0 * u);');
  });

  it('WGSL compileShader splices the definitions ahead of the entry point', () => {
    const ce = engineWithF();
    const shader = wgsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'color', type: 'vec4f' }],
      body: [{ variable: 'output.color.r', expression: ce.parse('f(u)') }],
    });
    expect(count(shader, 'fn _fn_f(')).toBe(1);
    expect(shader.indexOf('fn _fn_f(')).toBeLessThan(
      shader.indexOf('fn main(')
    );
  });

  it('compileToSource has no definition channel and keeps failing closed', () => {
    // It answers with a bare EXPRESSION string; a function declaration is not
    // an expression, so the route opts out of the registry rather than emit a
    // call whose definition is dropped.
    const ce = engineWithF();
    expect(() => glsl.compileToSource(ce.parse('f(u)'))).toThrow(
      /no lowering for it/
    );
  });
});

describe('GPU USER FUNCTIONS — fail closed', () => {
  it('recursion fails closed, naming the function', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'R',
      ce.expr([
        'Function',
        [
          'Which',
          ['LessEqual', 'n', 0],
          1,
          'True',
          ['Multiply', 'n', ['R', ['Subtract', 'n', 1]]],
        ],
        "'(n: integer) -> number'",
      ])
    );
    for (const target of [glsl, wgsl]) {
      expect(() => target.compile(ce.expr(['R', 'u']))).toThrow(
        /^R: a recursive \(or mutually recursive\) user-defined function/
      );
      // Never a call to a name no declaration provides.
      expect(() => target.compile(ce.expr(['R', 'u']))).toThrow(
        /forbid recursion/
      );
    }
  });

  it('mutual recursion fails closed as well', () => {
    const ce = new ComputeEngine();
    ce.assign('A', ce.expr(['Function', ['B', ['Subtract', 'n', 1]], 'n']));
    ce.assign('B', ce.expr(['Function', ['A', ['Subtract', 'n', 1]], 'n']));
    expect(() => glsl.compile(ce.expr(['A', 'u']))).toThrow(/forbid recursion/);
  });

  it('a parameter with no static shader type fails closed, naming it', () => {
    const ce = new ComputeEngine();
    ce.declare('m', '(list<real>) -> real');
    ce.assign('m', ce.parse('M \\mapsto 1'));
    expect(() => glsl.compile(ce.expr(['m', 'A']))).toThrow(
      /^m: parameter "M" has no static GLSL type/
    );
  });

  it('a return value with no static shader type fails closed', () => {
    const ce = new ComputeEngine();
    ce.assign('w', ce.parse('t \\mapsto (t, t, t, t, t)'));
    expect(() => glsl.compile(ce.parse('w(u)'))).toThrow(
      /^w: the return value has no static GLSL type/
    );
  });

  it('a collection argument fails closed — no silent scalar apply', () => {
    const ce = engineWithF();
    expect(() => glsl.compile(ce.expr(['f', ['List', 1, 2, 3, 4, 5]]))).toThrow(
      /no runtime broadcast dispatch/
    );
    // The JS target answers this with `_SYS.bcastFn`; a shader has no analog.
    expect(() => wgsl.compile(ce.expr(['f', ['List', 1, 2, 3, 4, 5]]))).toThrow(
      /no runtime broadcast dispatch/
    );
  });

  it('an argument whose shape disagrees with the parameter fails closed', () => {
    const ce = engineWithF();
    expect(() => glsl.compile(ce.expr(['f', ['Tuple', 1, 2]]))).toThrow(
      /argument 1 lowers to "vec2" but parameter "x" is declared "float"/
    );
  });

  it('an arity mismatch fails closed', () => {
    const ce = engineWithF();
    expect(() => glsl.compile(ce.expr(['f', 'u', 'v']))).toThrow(
      /called with 2 argument\(s\) but declared with 1/
    );
  });

  it('a user function in VALUE position fails closed', () => {
    // The shader languages have no function values.
    const ce = engineWithF();
    expect(() => glsl.compile(ce.expr('f'))).toThrow(
      /cannot be used as a VALUE on target 'glsl'/
    );
  });
});

describe('GPU USER FUNCTIONS — determinism', () => {
  it('two compiles of the same expression are byte-identical', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('y \\mapsto y + 1'));
    ce.assign('f', ce.parse('x \\mapsto g(x) * 2 + \\sum_{i=1}^{4} i x'));
    const expr = ce.parse('f(u) + f(2u)');

    for (const target of [glsl, wgsl]) {
      const a = target.compile(expr);
      const b = target.compile(expr);
      expect(a.code).toBe(b.code);
      expect(a.preamble).toBe(b.preamble);
      // The generated names are deterministic, not random.
      expect(a.preamble).toContain('_fn_f');
      expect(a.preamble).toContain('_fn_g');
    }
  });

  it('the shader route is deterministic too', () => {
    const ce = engineWithF();
    const options = {
      type: 'fragment' as const,
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [{ variable: 'fragColor.r', expression: ce.parse('f(u) + f(2u)') }],
    };
    expect(glsl.compileShader(options)).toBe(glsl.compileShader(options));
  });
});

describe('GPU USER FUNCTIONS — the JS target is unchanged', () => {
  it('still emits the JS arrow-function form and allows recursion', () => {
    const ce = engineWithF();
    const r = compile(ce.parse('f(u) + f(2u)'), { fallback: false });
    // `u` is wide-typed, so the first call keeps the JS target's runtime
    // broadcast dispatch — the behavior a shader has no analog for, and the
    // reason the GPU call-site hook fails closed instead.
    expect(r.code).toMatchInlineSnapshot(
      `_SYS.bcastFn((_tv1) => _fn_f(_tv1), _.u) + _fn_f(2 * _.u)`
    );
    // The JS lowering keeps its arrow-function definition form, spliced into
    // the generated function's own body (there is no `preamble` channel on
    // this route — the artifact is self-contained).
    expect(r.preamble).toBeUndefined();
    expect(r.run!({ u: 0.3 })).toBeCloseTo(
      ce.parse('f(u) + f(2u)').subs({ u: 0.3 }).N().re,
      12
    );
  });

  it('a recursive user function still compiles by name on the JS target', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'R',
      ce.expr([
        'Function',
        [
          'Which',
          ['LessEqual', 'n', 0],
          1,
          'True',
          ['Multiply', 'n', ['R', ['Subtract', 'n', 1]]],
        ],
        "'(n: integer) -> number'",
      ])
    );
    const r = compile(ce.expr(['R', 'u']), { fallback: false });
    expect(r.run!({ u: 5 })).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Review round: shader reserved words, definition scoping, aggregate component
// types, unroll ordering, and the `Match` subject. Appended as their own
// describes.
// ---------------------------------------------------------------------------

describe('GPU USER FUNCTIONS — a reserved word as a PARAMETER fails closed', () => {
  it('GLSL: `discard` as a parameter name', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.expr(['Function', ['Add', 'discard', 1], 'discard'])
    );
    // Without the check this emitted `float _fn_f(float discard)` — source no
    // driver accepts — behind a reported success.
    expect(() => glsl.compile(ce.parse('f(u)'))).toThrow(
      /"discard" is a reserved word in glsl/
    );
  });

  it('WGSL: `loop` as a parameter name', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.expr(['Function', ['Add', 'loop', 1], 'loop']));
    expect(() => wgsl.compile(ce.parse('f(u)'))).toThrow(
      /"loop" is a reserved word in wgsl/
    );
  });

  it('a non-reserved parameter still compiles', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.expr(['Function', ['Add', 'w', 1], 'w']));
    expect(glsl.compile(ce.parse('f(u)')).preamble).toContain(
      'float _fn_f(float w)'
    );
  });
});

describe('GPU USER FUNCTIONS — a nested definition is scoped to the ROOT, not its caller', () => {
  /**
   * `g`'s body reads the GLOBAL `z`; `f`'s parameter is named `param`. When
   * `param` is `z`, emitting `g` from inside `f`'s body used to inherit `f`'s
   * parameter shadowing, so the global resolved to `f`'s parameter — a bare,
   * undeclared `z` in the GLSL definition, and a `ReferenceError` on the JS
   * route.
   */
  function engineWithNestedG(param: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('z', 10);
    ce.assign('g', ce.parse('w \\mapsto w + z'));
    ce.assign('f', ce.expr(['Function', ['Add', ['g', 1], param], param]));
    return ce;
  }

  it('GLSL: the global is folded, whether or not the name collides', () => {
    for (const param of ['z', 'q']) {
      const ce = engineWithNestedG(param);
      const preamble = glsl.compile(ce.parse('f(u)')).preamble!;
      // `g` sees the GLOBAL `z` (folded to 10.0), never `f`'s parameter.
      expect(preamble).toContain('float _fn_g(float w) {\n  return w + 10.0;\n}');
      expect(preamble).toContain(`float _fn_f(float ${param})`);
    }
  });

  it('JavaScript: the same, and the compiled value matches the interpreter', () => {
    for (const param of ['z', 'q']) {
      const ce = engineWithNestedG(param);
      const expr = ce.parse('f(u)');
      const r = compile(expr, { fallback: false });
      expect(r.run!({ u: 2 })).toBe(13);
      expect(r.run!({ u: 2 })).toBe(expr.subs({ u: 2 }).N().re);
    }
  });

  it('the callee does not inherit the caller\u2019s parameter SHAPE either', () => {
    // `f`'s parameter `z` is complex (a `vec2`); `g`'s body references a free
    // scalar named `z`. Chaining the shape frame declared `_fn_g` `vec2`.
    const ce = new ComputeEngine();
    ce.assign('g', ce.expr(['Function', ['Multiply', 'z', 'w'], 'w']));
    ce.declare('f', '(complex) -> complex');
    ce.assign('f', ce.expr(['Function', ['Multiply', ['g', 2], 'z'], 'z']));
    const preamble = glsl.compile(ce.parse('f(p)')).preamble!;
    expect(preamble).toContain('float _fn_g(float w)');
    expect(preamble).not.toContain('vec2 _fn_g(');
    // `f`'s OWN declared complex parameter is untouched.
    expect(preamble).toContain('vec2 _fn_f(vec2 z)');
  });
});

describe('GPU USER FUNCTIONS — a vecN needs REAL components', () => {
  /** `f` with a declared signature and a constant body. */
  function engineWithSignature(signature: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', signature);
    ce.assign('f', ce.expr(['Function', 1, 'b']));
    return ce;
  }

  it('GLSL: a `tuple<boolean, boolean>` parameter fails closed, naming it', () => {
    const ce = engineWithSignature('(tuple<boolean,boolean>) -> real');
    // `vec2` is two floats: declaring one by LENGTH alone emitted
    // `vec2(true, false)` at the call site.
    expect(() => glsl.compile(ce.parse('f(p)'))).toThrow(
      /f: parameter "b" has no static GLSL type/
    );
  });

  it('WGSL: the same', () => {
    const ce = engineWithSignature('(tuple<boolean,boolean>) -> real');
    expect(() => wgsl.compile(ce.parse('f(p)'))).toThrow(
      /f: parameter "b" has no static WGSL type/
    );
  });

  it('a `tuple<real, real>` parameter still lowers to `vec2`', () => {
    const ce = engineWithSignature('(tuple<real,real>) -> real');
    expect(glsl.compile(ce.parse('f(p)')).preamble).toContain(
      'float _fn_f(vec2 b)'
    );
  });

  it('the VALUE side agrees: a boolean-tuple return has no shader type', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.expr(['Function', ['Tuple', 'True', 'False'], 'b']));
    expect(() => glsl.compile(ce.parse('f(p)'))).toThrow(
      /f: the return value has no static GLSL type/
    );
  });

  it('a real-tuple return still lowers to `vec2`', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.expr(['Function', ['Tuple', 1, 2], 'b']));
    expect(glsl.compile(ce.parse('f(p)')).preamble).toContain(
      'vec2 _fn_f(float b)'
    );
  });
});

describe('GPU SUM/PRODUCT — an unrolled term keeps its own statement order', () => {
  /** `\sum_{i=1}^{2} i · \sum_{j=1}^{m} j·x` — two terms, each hoisting a loop. */
  function twoTermUnroll(ce: ComputeEngine) {
    const inner = ['Sum', ['Multiply', 'j', 'x'], ['Limits', 'j', 1, 'm']];
    return ce.box(['Sum', ['Multiply', 'i', inner], ['Limits', 'i', 1, 2]] as any);
  }

  it('GLSL: term 1 is finished off BEFORE term 2 starts', () => {
    const ce = new ComputeEngine();
    const code = glsl.compile(twoTermUnroll(ce)).code;
    // Two hoisted loops, one per term.
    expect(code.match(/for \(int j =/g)?.length).toBe(2);
    // Each term's value is bound to a temporary right after its own
    // statements. Collecting all the statements and draining them at the end
    // reordered the unroll (loop1, loop2, rest1, rest2), which moves a
    // `_gpu_rnd_draw` in term 2 ahead of one in term 1's remainder.
    const term1 = code.search(/^float _\w+ = 1\.0 \* _\w+;$/m);
    const term2Loop = code.indexOf('for (int j =', code.indexOf('for (int j =') + 1);
    expect(term1).toBeGreaterThan(0);
    expect(term1).toBeLessThan(term2Loop);
    expect(code).toMatch(/return \(\(_\w+\) \+ \(_\w+\)\);$/m);
  });

  it('WGSL: the same ordering', () => {
    const ce = new ComputeEngine();
    const code = wgsl.compile(twoTermUnroll(ce)).code;
    expect(code.match(/for \(var j:/g)?.length).toBe(2);
    const term1 = code.search(/^var _\w+: f32 = 1\.0 \* _\w+;$/m);
    const term2Loop = code.indexOf('for (var j:', code.indexOf('for (var j:') + 1);
    expect(term1).toBeGreaterThan(0);
    expect(term1).toBeLessThan(term2Loop);
  });
});

describe('GPU MATCH — the SUBJECT is unconditional', () => {
  const bigSum = ['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 1000]];

  it('a loop-form Sum as the subject compiles (its loop is hoisted)', () => {
    const ce = new ComputeEngine();
    const code = glsl.compile(
      ce.box([
        'Match',
        bigSum,
        ['MatchCase', 1, 10],
        ['MatchCase', '_', -1],
      ] as any)
    ).code;
    // The loop lands ahead of the ternary — it runs on every path anyway.
    expect(code).toContain('for (int i = 1; i <= 1000; i++)');
    expect(code).toMatch(/return \(\(_\w+ == 1\.0\) \? \(10\.0\) : \(-1\.0\)\);$/m);
  });

  it('a loop-form Sum inside a case BODY still fails closed', () => {
    const ce = new ComputeEngine();
    expect(() =>
      glsl.compile(
        ce.box([
          'Match',
          'x',
          ['MatchCase', 1, bigSum],
          ['MatchCase', '_', -1],
        ] as any)
      )
    ).toThrow(/Match: a conditionally-evaluated branch/);
  });
});

describe('GPU USER FUNCTIONS — a vec2 wrapper parameter reaches a vec2 callee', () => {
  /**
   * A `compileFunction` parameter declared `vec2` by the CALLER, passed
   * straight through to a user function whose signature declares a
   * 2-component tuple. This works because boxing `h(v)` types `v` from `h`'s
   * declared signature, so the call-site classification and the synthesized
   * declaration agree without the caller's parameter list being consulted.
   *
   * Known gap (NOT covered here): a COMPOUND argument built from such
   * parameters — `h(v + w)` — types as `number` in the engine and is rejected,
   * because the shape analysis answers for bare symbols only.
   */
  function engineWithTupleH(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('h', '(tuple<real,real>) -> real');
    ce.assign('h', ce.expr(['Function', 5, 'v']));
    return ce;
  }

  it('GLSL', () => {
    const ce = engineWithTupleH();
    const src = glsl.compileFunction(ce.parse('h(v)'), 'wrap', 'float', [
      ['v', 'vec2'],
    ]);
    expect(src).toContain('float _fn_h(vec2 v)');
    expect(src).toContain('return _fn_h(v);');
  });

  it('WGSL', () => {
    const ce = engineWithTupleH();
    const src = wgsl.compileFunction(ce.parse('h(v)'), 'wrap', 'float', [
      ['v', 'vec2'],
    ]);
    expect(src).toContain('fn _fn_h(v: vec2f)');
    expect(src).toContain('return _fn_h(v);');
  });
});
