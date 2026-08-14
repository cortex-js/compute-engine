/**
 * `Max`/`Min` over a COLLECTION on the GPU targets.
 *
 * These heads are REDUCTIONS — the interpreter (`evaluateMinMax`) and the
 * JavaScript target (`compileExtremum`) both flatten every collection operand
 * and fold the lot to one scalar. The shader `max`/`min` builtins are
 * COMPONENTWISE, so the variadic scalar fold returned an AGGREGATE where a
 * scalar was owed, behind `success: true`:
 *
 *   Max([1,2,3])      →  vec3(1.0, 2.0, 3.0)              was 3
 *   Max([1,2,3], 5)   →  max(vec3(1.0, 2.0, 3.0), 5.0)    was 5
 *
 * Valid shader source, wrong value — the worst failure mode. The reduction now
 * destructures each collection operand into its scalar components and folds
 * pairwise; an operand with no compile-time component list fails closed (D6).
 *
 * There is no GPU here, so correctness is checked by EVALUATING the emitted
 * source (the emissions in this file live in the `max`/`min`/literal/swizzle
 * subset, which is identical in GLSL, WGSL and JavaScript) and comparing
 * against the interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off throughout this file. Almost every
 * probe here is a LITERAL collection (`Max([1,2,3])`), i.e. a pure subtree with
 * no free variables, which the compiler would otherwise evaluate at compile
 * time and emit as one number — erasing the pairwise-fold emission, the
 * empty-collection `_gpu_nan()` emission and the fail-closed throw that are the
 * whole subject of these tests. The VALUE agreement with the interpreter is
 * still checked, by running the structural emission through `runShader`.
 */
const NO_FOLD = { constantFold: false } as const;

const g = (expr: any): string => glsl.compile(ce.box(expr), NO_FOLD).code!;
const w = (expr: any): string => wgsl.compile(ce.box(expr), NO_FOLD).code!;

/**
 * Evaluate an emitted shader EXPRESSION over the `max`/`min`/float-literal/
 * swizzle subset. `max`/`min` are the same builtins with the same semantics in
 * both shader languages and in `Math`, and a `vecN` swizzle is a plain index,
 * so this is a faithful reading of what a driver would compute.
 */
function runShader(code: string, env: Record<string, number[]> = {}): number {
  const js = code
    .replace(/\bmax\s*\(/g, 'Math.max(')
    .replace(/\bmin\s*\(/g, 'Math.min(')
    .replace(
      /\b([A-Za-z_]\w*)\.([xyzw])\b/g,
      (_m, name, comp) => `_env.${name}[${'xyzw'.indexOf(comp)}]`
    );
  // eslint-disable-next-line no-new-func
  return new Function('_env', `return (${js});`)(env);
}

const interp = (expr: any): number => ce.box(expr).evaluate().re;

/** Every emission in this table is byte-identical in GLSL and WGSL. */
const REDUCTIONS: Array<[label: string, expr: any]> = [
  ['a 3-element list', ['Max', ['List', 1, 2, 3]]],
  ['a 3-element list (Min)', ['Min', ['List', 4, 1, 9]]],
  ['a list and a scalar', ['Max', ['List', 1, 2, 3], 5]],
  ['a list and a smaller scalar', ['Max', ['List', 1, 2, 3], 0]],
  ['two lists', ['Max', ['List', 1, 2, 3], ['List', 4, 0, 9]]],
  ['two lists (Min)', ['Min', ['List', 1, 2, 3], ['List', 4, 0, 9]]],
  ['a 2-element list', ['Max', ['List', 1, 2]]],
  // 5 elements has no `vecN` reading — it lowers to a shader ARRAY
  // (`float[5]` / `array<f32, 5>`), which has no arithmetic at all.
  ['a 5-element list', ['Max', ['List', 1, 2, 3, 4, 5]]],
  ['a 5-element list (Min)', ['Min', ['List', 9, 2, 8, 4, 5]]],
  ['a 1-element list', ['Max', ['List', 7]]],
  ['negative and fractional elements', ['Min', ['List', -3.5, 2.25, -1]]],
  ['a tuple', ['Max', ['Tuple', 1, 2, 3]]],
  ['a Range', ['Min', ['Range', 1, 5]]],
  ['a Range and a scalar', ['Max', ['Range', 1, 5], 100]],
  ['a reduction inside a sum', ['Add', 1, ['Max', ['List', 1, 2, 3]]]],
];

describe('GPU Max/Min over a collection — REDUCES (was: returned a vector)', () => {
  it.each(REDUCTIONS)(
    'GLSL reduces %s to the interpreter value',
    (_label, expr) => {
      const code = g(expr);
      expect(code).not.toMatch(/\bvec[234]\s*\(|\bfloat\s*\[/);
      expect(runShader(code)).toBe(interp(expr));
    }
  );

  it.each(REDUCTIONS)(
    'WGSL reduces %s to the interpreter value',
    (_label, expr) => {
      const code = w(expr);
      expect(code).not.toMatch(/\bvec[234]f?\s*\(|\barray\s*</);
      expect(runShader(code)).toBe(interp(expr));
    }
  );

  it('emits a pairwise fold of the elements, not the aggregate', () => {
    expect(g(['Max', ['List', 1, 2, 3]])).toBe('(max(max(1.0, 2.0), 3.0))');
    expect(w(['Min', ['List', 4, 1, 9]])).toBe('(min(min(4.0, 1.0), 9.0))');
    expect(g(['Max', ['List', 1, 2, 3], 5])).toBe(
      '(max(max(max(1.0, 2.0), 3.0), 5.0))'
    );
  });

  it('a scalar-only Max/Min is unchanged (no parentheses, no reduction)', () => {
    expect(g(['Max', 1, 2, 3])).toBe('max(max(1.0, 2.0), 3.0)');
    expect(w(['Min', 1, 2, 3])).toBe('min(min(1.0, 2.0), 3.0)');
    expect(g(['Min', 5])).toBe('5.0');
  });

  it('the PARENTHESES are what keep the operand-shape gate out', () => {
    // `compileGPUExtremum` parenthesizes its reduced emission so that
    // `gpuTopLevelCall` reports "not a call" and `gpuCheckOperandShapes` takes
    // its `call === undefined` branch — its documented behaviour for a head
    // that consumes a collection on purpose, recognized by `Max`/`Min` being
    // absent from `GPU_OPERATORS`. Two unrelated properties, coupled
    // implicitly; these are the witnesses that THROW (not merely differ) if
    // the parentheses are dropped, because the gate would then judge a bare
    // `max(…)`/`bitcast<f32>(…)` call against operand shapes the emission no
    // longer contains:
    //   - a 5-element list is an `array` operand, and no builtin has an array
    //     overload;
    //   - on WGSL a `vec3f` mixed with a scalar has no `max` overload;
    //   - the empty-collection NaN is a `bitcast<f32>(…)` CALL on WGSL.
    expect(() => g(['Max', ['List', 1, 2, 3, 4, 5]])).not.toThrow();
    expect(() => w(['Max', ['List', 1, 2, 3, 4, 5]])).not.toThrow();
    expect(() => w(['Max', ['List', 1, 2, 3], 5])).not.toThrow();
    expect(() => w(['Max', ['List']])).not.toThrow();
    expect(runShader(g(['Max', ['List', 1, 2, 3, 4, 5]]))).toBe(
      interp(['Max', ['List', 1, 2, 3, 4, 5]])
    );
  });
});

describe('GPU Max/Min over an EMPTY collection — the target NaN', () => {
  // An empty literal collection has no shader constructor at all (`float[0]()`
  // / `array<f32, 0>()`), so compiling it first made the whole reduction
  // decline. It contributes NO components instead: `Max([], 5)` is `5`, and
  // `Max([])` — nothing left to fold — is NaN, which is what the interpreter
  // and the JavaScript target both answer.
  const EMPTY: any[] = [
    ['Max', ['List']],
    ['Min', ['List']],
    ['Max', ['Tuple']],
    ['Max', ['List'], ['List']],
  ];

  it.each(EMPTY.map((e) => [JSON.stringify(e), e]))(
    'emits the target NaN for %s',
    (_label, expr) => {
      expect(g(expr)).toBe('(_gpu_nan())');
      expect(w(expr)).toBe('(bitcast<f32>(0x7fc00000u))');
    }
  );

  it('agrees with the interpreter and the JavaScript target (NaN)', () => {
    for (const expr of EMPTY) {
      expect(interp(expr)).toBeNaN();
      expect(
        ce.getCompilationTarget('javascript')!.compile(ce.box(expr)).run!({})
      ).toBeNaN();
    }
  });

  it('declares the GLSL `_gpu_nan()` helper in the preamble', () => {
    expect(glsl.compile(ce.box(['Max', ['List']] as any)).preamble).toContain(
      'float _gpu_nan()'
    );
  });

  it('an empty operand contributes nothing to a MIXED reduction', () => {
    for (const [expr, code] of [
      [['Max', ['List'], 5], '(5.0)'],
      [['Max', 5, ['List']], '(5.0)'],
      [['Min', ['List'], 5], '(5.0)'],
      [['Max', ['List'], ['List', 1, 2, 3]], '(max(max(1.0, 2.0), 3.0))'],
      [['Min', ['List'], ['List', 4, 1, 9]], '(min(min(4.0, 1.0), 9.0))'],
    ] as Array<[any, string]>) {
      expect(g(expr)).toBe(code);
      expect(w(expr)).toBe(code);
      expect(runShader(code)).toBe(interp(expr));
    }
  });
});

describe('GPU Max/Min over a declared vector operand', () => {
  const cev = new ComputeEngine();
  cev.declare('v', 'vector<3>');
  const gv = (expr: any): string =>
    glsl.compile(cev.box(expr), NO_FOLD).code!;
  const wv = (expr: any): string =>
    wgsl.compile(cev.box(expr), NO_FOLD).code!;

  it('reduces a bare vector symbol over its swizzles', () => {
    expect(gv(['Max', 'v'])).toBe('(max(max(v.x, v.y), v.z))');
    expect(wv(['Max', 'v'])).toBe('(max(max(v.x, v.y), v.z))');
  });

  it.each([[[1, 2, 3]], [[-4, -1, -9]], [[0.5, 0.25, 0.75]], [[7, 7, 7]]])(
    'agrees with the JavaScript target at v = %p',
    (v) => {
      const expr = cev.box(['Max', 'v']);
      const js = cev.getCompilationTarget('javascript')!.compile(expr).run!({
        v,
      });
      expect(runShader(gv(['Max', 'v']), { v })).toBe(js);
      expect(runShader(gv(['Min', 'v']), { v })).toBe(
        cev.getCompilationTarget('javascript')!.compile(cev.box(['Min', 'v']))
          .run!({ v })
      );
    }
  );

  it('binds a COMPOUND vector operand to a temporary before swizzling', () => {
    // The operand source is repeated once per component, so a compound one is
    // hoisted: repeating it would be slow AND would re-advance `_gpu_rnd_draw`.
    expect(gv(['Max', ['Multiply', 2, 'v']])).toBe(
      'vec3 _tv1 = 2.0 * v;\nreturn (max(max(_tv1.x, _tv1.y), _tv1.z));'
    );
    expect(wv(['Max', ['Multiply', 2, 'v']])).toBe(
      'var _tv1: vec3f = 2.0 * v;\nreturn (max(max(_tv1.x, _tv1.y), _tv1.z));'
    );
  });
});

describe('GPU Max/Min — operands with no component list fail closed (D6)', () => {
  const M2 = ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]];

  it('a matrix operand declines rather than returning an aggregate', () => {
    expect(() => g(['Max', M2])).toThrow(/no compile-time component list/);
    expect(() => w(['Max', M2])).toThrow(/no compile-time component list/);
    expect(() => g(['Max', M2])).toThrow(/D6/);
  });

  it('a runtime-length collection declines', () => {
    const cel = new ComputeEngine();
    cel.declare('L', 'list<number>');
    expect(() => glsl.compile(cel.box(['Max', 'L'])).code).toThrow(
      /no compile-time component list/
    );
  });
});

describe('GPU ElementMax/ElementMin stay COMPONENTWISE', () => {
  const V3 = ['List', 1, 2, 3];
  const W3 = ['List', 4, 0, 9];

  it('a two-vector element-wise max is the native builtin, not a reduction', () => {
    expect(g(['ElementMax', V3, W3])).toBe(
      'max(vec3(1.0, 2.0, 3.0), vec3(4.0, 0.0, 9.0))'
    );
    expect(w(['ElementMin', V3, W3])).toBe(
      'min(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 0.0, 9.0))'
    );
    // …and the interpreter agrees it is element-wise.
    expect(ce.box(['ElementMax', V3, W3]).evaluate().toString()).toBe(
      '[4,2,9]'
    );
  });
});
