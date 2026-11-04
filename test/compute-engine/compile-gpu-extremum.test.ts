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
 * pairwise; an operand with no compile-time component list fails closed.
 *
 * There is no GPU here, so correctness is checked by EVALUATING the emitted
 * source (the emissions in this file live in the `max`/`min`/literal/swizzle
 * subset, which is identical in GLSL, WGSL and JavaScript) and comparing
 * against the interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { gpuScalarComponents } from '../../src/compute-engine/compilation/gpu-extrema';

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
 * Evaluate an emitted shader EXPRESSION over the `_gpu_max`/`_gpu_min`/
 * float-literal/swizzle subset. The helpers `_gpu_max` and `_gpu_min` give
 * NaN for a NaN operand, as `Math.max` and `Math.min` do, and a `vecN`
 * swizzle is a plain index, so this is a faithful reading of what a driver
 * computes.
 */
function runShader(code: string, env: Record<string, number[]> = {}): number {
  const js = code
    .replace(/\b(?:_gpu_)?max\s*\(/g, 'Math.max(')
    .replace(/\b(?:_gpu_)?min\s*\(/g, 'Math.min(')
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
    // Finite operands call the built-in (`gpuProvablyFinite`).
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
    // `max(…)`/`_gpu_nan()` call against operand shapes the emission no
    // longer contains:
    //   - a 5-element list is an `array` operand, and no builtin has an array
    //     overload;
    //   - on WGSL a `vec3f` mixed with a scalar has no `max` overload;
    //   - the empty-collection NaN is a `_gpu_nan()` CALL on WGSL.
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
      expect(w(expr)).toBe('(_gpu_nan())');
    }
  );

  it('agrees with the interpreter and the JavaScript target (NaN)', () => {
    for (const expr of EMPTY) {
      expect(interp(expr)).toBeNaN();
      expect(
        ce._getCompilationTarget('javascript')!.compile(ce.box(expr)).run!({})
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
  const gv = (expr: any): string => glsl.compile(cev.box(expr), NO_FOLD).code!;
  const wv = (expr: any): string => wgsl.compile(cev.box(expr), NO_FOLD).code!;

  it('reduces a bare vector symbol over its swizzles', () => {
    expect(gv(['Max', 'v'])).toBe('(_gpu_max(_gpu_max(v.x, v.y), v.z))');
    expect(wv(['Max', 'v'])).toBe('(_gpu_max(_gpu_max(v.x, v.y), v.z))');
  });

  it.each([[[1, 2, 3]], [[-4, -1, -9]], [[0.5, 0.25, 0.75]], [[7, 7, 7]]])(
    'agrees with the JavaScript target at v = %p',
    (v) => {
      const expr = cev.box(['Max', 'v']);
      const js = cev._getCompilationTarget('javascript')!.compile(expr).run!({
        v,
      });
      expect(runShader(gv(['Max', 'v']), { v })).toBe(js);
      expect(runShader(gv(['Min', 'v']), { v })).toBe(
        cev._getCompilationTarget('javascript')!.compile(cev.box(['Min', 'v']))
          .run!({ v })
      );
    }
  );

  it('binds a COMPOUND vector operand to a temporary before swizzling', () => {
    // The operand source is repeated once per component, so a compound one is
    // hoisted: repeating it would be slow AND would re-advance `_gpu_rnd_draw`.
    expect(gv(['Max', ['Multiply', 2, 'v']])).toBe(
      'vec3 _tv1 = 2.0 * v;\nreturn (_gpu_max(_gpu_max(_tv1.x, _tv1.y), _tv1.z));'
    );
    expect(wv(['Max', ['Multiply', 2, 'v']])).toBe(
      'var _tv1: vec3f = 2.0 * v;\nreturn (_gpu_max(_gpu_max(_tv1.x, _tv1.y), _tv1.z));'
    );
  });
});

describe('GPU Max/Min — operands with no component list fail closed', () => {
  const M2 = ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]];

  it('a matrix operand declines rather than returning an aggregate', () => {
    expect(() => g(['Max', M2])).toThrow(/no compile-time component list/);
    expect(() => w(['Max', M2])).toThrow(/no compile-time component list/);
    expect(() => g(['Max', M2])).toThrow(/Could not compile/);
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

  it('a two-vector element-wise max is componentwise, not a reduction', () => {
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

describe('GPU reductions over a vector splat read every component', () => {
  // `PointY(PointList(xs, y))` gives the second coordinate of each of the
  // three points, which is `y` three times. It lowers to the splat
  // constructor `vec3(y)`, which has ONE operand for three components. The
  // reduction read the operands as the components, so it emitted `y` where
  // the interpreter computes `3y` (Sum) or `y³` (Product). CE-684.
  const ces = new ComputeEngine();
  ces.declare('xs', 'list<real^3>');
  ces.declare('y', 'real');
  ces.declare('k', 'integer');
  ces.declare('c', 'boolean');
  const gs = (expr: any): string => glsl.compile(ces.box(expr), NO_FOLD).code!;
  const ws = (expr: any): string => wgsl.compile(ces.box(expr), NO_FOLD).code!;
  const AT = { y: 2, k: 6, c: true };
  const interpAt = (expr: any): number =>
    ces
      .box(expr)
      .subs({ xs: ces.box(['List', 1, 2, 3]), y: AT.y, k: AT.k, c: 'True' })
      .evaluate().re;

  /**
   * Evaluate an emission at `AT` by rewriting it to JavaScript. It knows the
   * forms these tests emit: the splat constructors `vec3`/`vec3f` of one
   * operand, swizzles, the declarations of temporaries, `if`/`else`, the
   * GLSL `?:` and the WGSL `select`, and the `_gpu_max`/`_gpu_gcd` helpers.
   */
  function runSplat(code: string): number {
    let js = code
      .replace(/\b(?:vec3|float|let|var)\s+(_tv\d+)(?::\s*\w+)?\s*=/g, 'let $1 =')
      .replace(/\b(?:float|var)\s+(_tv\d+)(?::\s*\w+)?;/g, 'let $1;')
      .replace(/\.([xyz])\b/g, (_m, c) => `[${'xyz'.indexOf(c)}]`);
    if (!/\breturn\b/.test(js)) js = `return (${js});`;
    // eslint-disable-next-line no-new-func
    return new Function(
      'y',
      'k',
      'c',
      'const vec3 = (s) => [s, s, s], vec3f = vec3;' +
        'const select = (f, t, cond) => (cond ? t : f);' +
        'const _gpu_max = Math.max;' +
        'const _gpu_gcd = (a, b) => (b === 0 ? Math.abs(a) : _gpu_gcd(b, a % b));' +
        js
    )(AT.y, AT.k, AT.c);
  }

  const P = (s: any) => ['PointY', ['PointList', 'xs', s]];
  const Y1 = ['Add', 'y', 1];

  it.each([
    ['Sum', ['Sum', P('y')], 6],
    ['Product', ['Product', P('y')], 8],
    ['Max', ['Max', P('y')], 2],
    ['GCD', ['GCD', P('k')], 6],
    ['Sum, compound operand', ['Sum', P(Y1)], 9],
    ['Max, compound operand', ['Max', P(Y1)], 3],
    ['Sum in an If arm', ['If', 'c', ['Sum', P('y')], 0], 6],
    ['Max in an If arm', ['If', 'c', ['Max', P('y')], 0], 2],
    ['Sum, compound operand, in an If arm', ['If', 'c', ['Sum', P(Y1)], 0], 9],
    ['Max, compound operand, in an If arm', ['If', 'c', ['Max', P(Y1)], 0], 3],
    ['a literal splat', ['Sum', P(2)], 6],
  ])('%s gives the interpreter value', (_label, expr, value) => {
    expect(interpAt(expr)).toBe(value);
    expect(runSplat(gs(expr))).toBe(value);
    expect(runSplat(ws(expr))).toBe(value);
  });

  it('a splat of a symbol is read through the swizzles of the constructor', () => {
    expect(gs(['Sum', P('y')])).toBe(
      '((vec3(y).x) + (vec3(y).y) + (vec3(y).z))'
    );
    expect(ws(['Product', P('y')])).toBe(
      '((vec3f(y).x) * (vec3f(y).y) * (vec3f(y).z))'
    );
  });

  it('a compound splat operand is evaluated once, in a temporary', () => {
    expect(gs(['Sum', P(Y1)])).toBe(
      'vec3 _tv1 = vec3(y + 1.0);\nreturn ((_tv1.x) + (_tv1.y) + (_tv1.z));'
    );
    expect(ws(['Sum', P(Y1)])).toBe(
      'var _tv1: vec3f = vec3f(y + 1.0);\nreturn ((_tv1.x) + (_tv1.y) + (_tv1.z));'
    );
  });

  it('Max reads the swizzles of a pure compound splat in an If arm', () => {
    // No temporary can be placed in a conditionally evaluated arm, so the
    // pure constructor is repeated once per component.
    expect(gs(['If', 'c', ['Max', P(Y1)], 0])).toBe(
      '((c) ? ((_gpu_max(_gpu_max(vec3(y + 1.0).x, vec3(y + 1.0).y), ' +
        'vec3(y + 1.0).z))) : (0.0))'
    );
    expect(ws(['If', 'c', ['Max', P(Y1)], 0])).toBe(
      'select(0.0, (_gpu_max(_gpu_max(vec3f(y + 1.0).x, vec3f(y + 1.0).y), ' +
        'vec3f(y + 1.0).z)), c)'
    );
  });

  it('a constructor written by the caller is not repeated in an arm', () => {
    // `vars` writes `V` as the conversion `vec3(u + v)` of a vector. Reading
    // its one operand as the only component made `Max` a vector, and the
    // two branches of the conditional had different types. Repeating the
    // constructor once per component would run the caller's code three
    // times (`vec3(nextValue())` can count its calls), and an arm has no
    // place for a temporary, so the reduction declines on GLSL. On WGSL,
    // where `select` would compute both arms, an arm with caller code takes
    // the statement form of `If`, whose branch holds the temporary.
    const cev = new ComputeEngine();
    cev.declare('V', 'list<real^3>');
    cev.declare('c', 'boolean');
    const expr = cev.box(['If', 'c', ['Max', 'V'], 0]);
    for (const source of ['vec3(u + v)', 'vec3(nextValue())']) {
      const opts = { ...NO_FOLD, vars: { V: source } };
      expect(() => glsl.compile(expr, opts)).toThrow(
        /conditionally-evaluated branch/
      );
      expect(wgsl.compile(expr, opts).code).toBe(
        'var _tv1: f32;\n' +
          'if (c) {\n' +
          `  var _tv2 = ${source};\n` +
          '  _tv1 = (_gpu_max(_gpu_max(_tv2.x, _tv2.y), _tv2.z));\n' +
          '} else {\n' +
          '  _tv1 = 0.0;\n' +
          '}\n' +
          'return _tv1;'
      );
    }
    // Outside an arm, the constructor is held once in a temporary.
    const outside = cev.box(['Max', 'V']);
    const opts = { ...NO_FOLD, vars: { V: 'vec3(nextValue())' } };
    expect(glsl.compile(outside, opts).code).toMatch(
      /vec3 _tv\d+ = vec3\(nextValue\(\)\);/
    );
  });


  it('a splat of a numeric literal repeats the literal', () => {
    expect(gs(['Sum', P(2)])).toBe('((2.0) + (2.0) + (2.0))');
    expect(ws(['Sum', P(2)])).toBe('((2.0) + (2.0) + (2.0))');
  });

  describe('gpuScalarComponents on a target with no statement sink', () => {
    // A binder that installs no sink of its own has no place for a
    // temporary. These calls use a target with no `hoist` sink.
    const noSink = (language: 'glsl' | 'wgsl') => ({ language }) as any;
    const s = ces.box('y');

    it('a pure compound splat is read through its own swizzles', () => {
      expect(gpuScalarComponents(s, 'vec2(y + 1.0)', noSink('glsl'))).toEqual(
        ['vec2(y + 1.0).x', 'vec2(y + 1.0).y']
      );
    });

    it('an impure compound splat declines', () => {
      // Each repetition of the source would make a draw of its own.
      const r = ces.box(['Random']);
      expect(gpuScalarComponents(r, 'vec3(y + 1.0)', noSink('glsl'))).toBe(
        undefined
      );
    });

    it('a draw reached through a symbol value declines', () => {
      // `r := Random()` makes `r + 1` impure once the value of `r` is looked
      // through, though `(r + 1).isPure` is true. Repeating the source once
      // per component would draw three times where the interpreter draws
      // once.
      const cer = new ComputeEngine();
      cer.assign('r', cer.box(['Random'], { form: 'raw' }));
      const e = cer.box(['Add', 'r', 1]);
      expect(e.isPure).toBe(true);
      expect(gpuScalarComponents(e, 'vec3(r + 1.0)', noSink('glsl'))).toBe(
        undefined
      );
    });

    it('a symbol whose `vars` entry is caller source declines', () => {
      // The caller's text can count its calls; the compiler cannot see it.
      const target = {
        language: 'glsl',
        cse: { harvestOptions: { isStringVar: (n: string) => n === 'V' } },
      } as any;
      const v = ces.box('V');
      expect(gpuScalarComponents(v, 'vec3(nextValue())', target)).toBe(
        undefined
      );
      // The same call when `V` is not caller source.
      const plain = {
        language: 'glsl',
        cse: { harvestOptions: { isStringVar: () => false } },
      } as any;
      expect(gpuScalarComponents(v, 'vec3(nextValue())', plain)).toEqual([
        'vec3(nextValue()).x',
        'vec3(nextValue()).y',
        'vec3(nextValue()).z',
      ]);
    });

    it('caller source reached through a value or a body declines', () => {
      // `r := Sin(y)` with `Sin` supplied by the caller, and `f(t) := t + w`
      // with `w` mapped to caller source: the caller's code is inlined in
      // the emission, so repeating it would run it once per component.
      const cei = new ComputeEngine();
      cei.declare('y', 'real');
      cei.declare('w', 'real');
      cei.assign('r', cei.box(['Sin', 'y']));
      cei.assign('f', cei.box(['Function', ['Add', 't', 'w'], 't']));
      const target = {
        language: 'glsl',
        cse: {
          harvestOptions: {
            isOverriddenOperator: (n: string) => n === 'Sin',
            isStringVar: (n: string) => n === 'w',
          },
        },
      } as any;
      for (const e of [['Add', 'r', 1], ['f', 'y']])
        expect(
          gpuScalarComponents(cei.box(e as any), 'vec3(s + 1.0)', target)
        ).toBe(undefined);
      // The same shapes with no caller source are read through swizzles.
      const plain = { language: 'glsl', cse: { harvestOptions: {} } } as any;
      expect(
        gpuScalarComponents(cei.box(['Add', 'r', 1]), 'vec2(s + 1.0)', plain)
      ).toEqual(['vec2(s + 1.0).x', 'vec2(s + 1.0).y']);
    });

    it('a constructor of a vector and a scalar is not read as a splat', () => {
      expect(gpuScalarComponents(s, 'vec3(v, z)', noSink('wgsl'))).toEqual([
        'vec3(v, z).x',
        'vec3(v, z).y',
        'vec3(v, z).z',
      ]);
    });

    it('the typed WGSL forms and an integer vector', () => {
      expect(gpuScalarComponents(s, 'vec3<f32>(y)', noSink('wgsl'))).toEqual(
        ['vec3<f32>(y).x', 'vec3<f32>(y).y', 'vec3<f32>(y).z']
      );
      expect(gpuScalarComponents(s, 'ivec2(k)', noSink('glsl'))).toEqual([
        'ivec2(k).x',
        'ivec2(k).y',
      ]);
    });

    it('a matrix constructor with fewer operands than elements declines', () => {
      // `mat2(y)` is the diagonal matrix of `y`, not four copies of `y`.
      expect(gpuScalarComponents(s, 'mat2(y)', noSink('glsl'))).toBe(
        undefined
      );
      expect(
        gpuScalarComponents(s, 'mat2(1.0, 0.0, 0.0, y)', noSink('glsl'))
      ).toEqual(['1.0', '0.0', '0.0', 'y']);
    });
  });
});

describe('GPU code supplied by the caller runs once, in order', () => {
  // `W` and `V` are written by the caller as calls (`nextValue()` can count
  // its calls or draw a number). The interpreter evaluates each operand
  // once, from the first to the last, so a shader that runs such code twice,
  // ahead of code written before it, or in a branch that is not taken gives
  // a different value. These forms decline. `U` is a plain uniform read,
  // which is not caller code: it compiles as a symbol with no `vars` entry
  // does.
  const cev = new ComputeEngine();
  cev.declare('b', 'real | signed_infinity | nan');
  cev.declare('n', 'real | signed_infinity | nan');
  cev.declare('V', 'list<real^3>');
  cev.declare('c', 'boolean');
  cev.declare('x', 'real');
  const opts = {
    ...NO_FOLD,
    vars: { W: 'nextValue()', V: 'vec3(nextValue())', U: 'u_u' },
  };
  const both = (expr: any, message: RegExp) => {
    const boxed = cev.box(expr);
    expect(() => glsl.compile(boxed, opts)).toThrow(message);
    expect(() => wgsl.compile(boxed, opts)).toThrow(message);
  };
  const MOVED = /ahead of the rest of its statement/;
  const REPEATED = /more than once/;

  it('a temporary for caller code does not run ahead of earlier caller code', () => {
    // `vec3 _tv = vec3(nextValue());` would run before the `W` of the sum.
    both(['Add', 'W', ['Max', 'V']], MOVED);
    // The same through the `dot(v, v)` form of a sum of squares.
    both(['Add', 'W', ['Sum', ['Square', 'V']]], MOVED);
  });

  it('a loop or an unrolled sum does not run ahead of earlier caller code', () => {
    both(['Add', 'W', ['Sum', ['Add', 'W', 'k'], ['Limits', 'k', 1, 'n']]], MOVED);
    both(
      ['Add', 'W', ['Sum', ['Multiply', ['Max', 'V'], 'k'], ['Limits', 'k', 1, 3]]],
      MOVED
    );
    both(
      ['Add', 'W', ['Block', ['Declare', 'a', "'unknown'", ['Square', 'x']], 'a']],
      MOVED
    );
  });

  it('a hoisted draw does not run ahead of earlier caller code', () => {
    both(['WithRandomSeed', 1, ['Tuple', 'W', ['Cot', ['Random']]]], MOVED);
    both(
      [
        'WithRandomSeed',
        1,
        ['Add', 'W', ['Match', ['Random'], ['MatchCase', 1, 10], ['MatchCase', '_', 30]]],
      ],
      /Match/
    );
  });

  it('caller code is not written more than once', () => {
    both(['Cot', 'W'], REPEATED);
    both(['Cot', ['Complex', 'W', 1]], REPEATED);
    both(['Remainder', 'W', 2], REPEATED);
    both(['Remainder', 2, 'W'], REPEATED);
    both(['Binomial', 'W', 3], REPEATED);
    both(['ContrastingColor', ['Tuple', 'W', 1, 1], ['Rgb', 1, 0, 0], ['Rgb', 0, 0, 1]], REPEATED);
    both(['Match', 'W', ['MatchCase', 1, 10], ['MatchCase', 2, 20], ['MatchCase', '_', 30]], REPEATED);
    // The middle operand of a chained comparison is in two comparisons.
    both(['Less', 'x', 'W', 3], /chained comparison/);
  });

  it('a head mapped through `functions` is caller code', () => {
    const boxed = cev.box(['Cot', ['F', 'x']]);
    const fopts = { ...NO_FOLD, functions: { F: 'myF' } };
    expect(() => glsl.compile(boxed, fopts)).toThrow(REPEATED);
    expect(() => wgsl.compile(boxed, fopts)).toThrow(REPEATED);
  });

  it('WGSL computes caller code in a branch only when the branch is taken', () => {
    // `select(f, t, c)` computes both branches, so on WGSL a branch with
    // caller code takes the statement form, an `if` statement. GLSL's `?:`
    // computes one branch and keeps the ternary form.
    for (const expr of [
      ['If', 'c', 'W', 0],
      ['Which', 'c', 'W', 'True', 0],
      ['If', 'c', 'W'],
      ['Match', 'x', ['MatchCase', 1, 'W'], ['MatchCase', '_', 30]],
    ]) {
      const boxed = cev.box(expr);
      const code = wgsl.compile(boxed, opts).code!;
      expect(code).toMatch(/^var _tv1: f32;\nif \(/);
      expect(code).not.toContain('select');
      expect(code.split('nextValue()').length).toBe(2);
      expect(glsl.compile(boxed, opts).code).toContain('?');
    }
    expect(wgsl.compile(cev.box(['If', 'c', 'W', 0]), opts).code).toBe(
      'var _tv1: f32;\n' +
        'if (c) {\n' +
        '  _tv1 = nextValue();\n' +
        '} else {\n' +
        '  _tv1 = 0.0;\n' +
        '}\n' +
        'return _tv1;'
    );
  });

  it('WGSL declines a branch with caller code when the statement form is refused', () => {
    // The `if` statement would run ahead of the first `W`, so the statement
    // form is refused, and `select` would compute the branch when it is not
    // taken.
    for (const expr of [
      ['Add', 'W', ['If', 'c', 'W', 0]],
      ['Add', 'W', ['Which', 'c', 'W', 'True', 0]],
      ['Add', 'W', ['If', 'c', 'W']],
      ['Add', 'W', ['Match', 'x', ['MatchCase', 1, 'W'], ['MatchCase', '_', 30]]],
    ]) {
      const boxed = cev.box(expr);
      expect(() => wgsl.compile(boxed, opts)).toThrow(/computes every branch/);
      expect(glsl.compile(boxed, opts).code).toContain('?');
    }
    expect(
      glsl.compile(
        cev.box(['Add', 'W', ['Match', 'x', ['MatchCase', 1, 'W'], ['MatchCase', '_', 30]]]),
        opts
      ).code
    ).toBe('nextValue() + ((x == 1.0) ? (nextValue()) : (30.0))');
  });

  it('WGSL takes the statement form for a function mapped through `functions` in a branch', () => {
    const boxed = cev.box(['If', ['Greater', 'x', 0], ['f', 'x'], 0]);
    expect(
      wgsl.compile(boxed, { ...NO_FOLD, functions: { f: 'myFn' } }).code
    ).toBe(
      'var _tv1: f32;\n' +
        'if (0.0 < x) {\n' +
        '  _tv1 = myFn(x);\n' +
        '} else {\n' +
        '  _tv1 = 0.0;\n' +
        '}\n' +
        'return _tv1;'
    );
  });

  it('a loop in a `Match` case with caller code runs in the branch of the case', () => {
    const boxed = cev.box([
      'Match',
      'x',
      ['MatchCase', 1, ['Sum', ['Multiply', 'W', 'k'], ['Limits', 'k', 1, 'n']]],
      ['MatchCase', '_', 0],
    ]);
    expect(wgsl.compile(boxed, opts).code).toBe(
      'var _tv1: f32;\n' +
        'if (x == 1.0) {\n' +
        '  var _tv2: f32 = 0.0;\n' +
        '  for (var k: i32 = 1; k <= i32(floor(n)); k++) {\n' +
        '    _tv2 += nextValue() * f32(k);\n' +
        '  }\n' +
        '  _tv1 = _tv2;\n' +
        '} else {\n' +
        '  _tv1 = 0.0;\n' +
        '}\n' +
        'return _tv1;'
    );
    expect(glsl.compile(boxed, opts).code).toContain(
      '    _tv2 += nextValue() * float(k);\n'
    );
    // In the branch, the loop would run ahead of the first `W` of the case.
    both(
      [
        'Match',
        'x',
        [
          'MatchCase',
          1,
          ['Add', 'W', ['Sum', ['Multiply', 'W', 'k'], ['Limits', 'k', 1, 'n']]],
        ],
        ['MatchCase', '_', 0],
      ],
      MOVED
    );
  });

  it('a `Which` checks only the operands behind an emitted `select`', () => {
    // A leading `True` clause is evaluated with no `select`, and the clauses
    // after a `True` clause are not emitted.
    expect(wgsl.compile(cev.box(['Which', 'True', 'W']), opts).code).toBe(
      '(nextValue())'
    );
    expect(
      wgsl.compile(cev.box(['Which', 'c', 1, 'True', 2, 'c', 'W']), opts).code
    ).toBe('select((2.0), 1.0, c)');
  });

  it('the statement form of a selection is refused when it would move caller code', () => {
    // The `if` statement holds the loop, and it would run ahead of the first
    // `W`; the ternary form cannot hold the loop, so the selection declines.
    both(
      [
        'Add',
        'W',
        ['If', 'c', ['Sum', ['Multiply', 'W', 'k'], ['Limits', 'k', 1, 'n']], 0],
      ],
      MOVED
    );
    // With a plain read, the statement form is placed as before.
    expect(
      glsl.compile(
        cev.box([
          'Add',
          'U',
          ['If', 'c', ['Sum', ['Multiply', 'x', 'k'], ['Limits', 'k', 1, 'n']], 0],
        ]),
        opts
      ).code
    ).toBe(
      'float _tv1;\n' +
        'if (c) {\n' +
        '  float _tv2 = 0.0;\n' +
        '  for (int k = 1; k <= int(floor(n)); k++) {\n' +
        '    _tv2 += float(k) * x;\n' +
        '  }\n' +
        '  _tv1 = _tv2;\n' +
        '} else {\n' +
        '  _tv1 = 0.0;\n' +
        '}\n' +
        'return u_u + _tv1;'
    );
  });

  it('a symbol that `vars` maps to a plain read does not read its stored value', () => {
    // `T` has the value `Sin(x)`, and `Sin` is mapped through `functions`,
    // but the code reads the uniform `u_T` only.
    const ce2 = new ComputeEngine();
    ce2.declare('x', 'real');
    ce2.parse('T \\coloneq \\sin(x)').evaluate();
    const topts = {
      ...NO_FOLD,
      vars: { T: 'u_T' },
      functions: { Sin: 'hostSin' },
    };
    expect(glsl.compile(ce2.box(['Cot', 'T']), topts).code).toBe(
      '(_gpu_cos(u_T) / _gpu_sin(u_T))'
    );
    expect(glsl.compile(ce2.box(['Less', 'x', 'T', 3]), topts).code).toBe(
      '(x < u_T) && (u_T < 3.0)'
    );
  });

  it('a draw does not run ahead of caller code in its own endpoints', () => {
    both(['WithRandomSeed', 1, ['Random', ['Interval', 'W', 1]]], /Random/);
    both(['Random', ['Interval', 'W', 1]], /Random/);
    both(['Random', ['Interval', 0, 'W']], /Random/);
    // A plain read in an endpoint compiles as before.
    expect(
      glsl.compile(cev.box(['Random', ['Interval', 'U', 1]]), opts).code
    ).toBe(
      '((u_u) + _gpu_rnd_draw(uvec2(floatBitsToUint(gl_FragCoord.x), ' +
        'floatBitsToUint(gl_FragCoord.y)), _gpu_rnd_n0) * ((1.0) - (u_u)))'
    );
  });

  it('an element-wise lowering does not repeat a vector with caller code', () => {
    both(['Cot', ['List', 'W', 'x', 1]], /more than once/);
    expect(glsl.compile(cev.box(['Cot', ['List', 'U', 'x', 1]]), opts).code).toBe(
      '(_gpu_cos3(vec3(u_u, x, 1.0)) / _gpu_sin3(vec3(u_u, x, 1.0)))'
    );
  });

  it('a `vars` entry that is a read of one variable can be written twice', () => {
    // `u_t` is the source of two keys, so it is caller source, but two
    // copies of a read run no code.
    const aopts = { ...NO_FOLD, vars: { a: 'u_t', b: 'u_t' } };
    expect(glsl.compile(cev.box(['Cot', 'a']), aopts).code).toBe(
      '(_gpu_cos(u_t) / _gpu_sin(u_t))'
    );
    expect(glsl.compile(cev.box(['Less', 'x', 'a', 3]), aopts).code).toBe(
      '(x < u_t) && (u_t < 3.0)'
    );
  });

  it('a temporary for caller code is also looked for in function bodies', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('V', 'list<real^3>');
    ce2.assign('g', ce2.box(['Function', ['Add', 'n', ['Max', 'V']], 'n']));
    const expr = ce2.box(['Add', ['g', 1], ['Max', 'V']]);
    const vopts = { ...NO_FOLD, vars: { V: 'vec3(nextValue())' } };
    expect(() => glsl.compile(expr, vopts)).toThrow(MOVED);
    expect(() => wgsl.compile(expr, vopts)).toThrow(MOVED);
  });

  it('hoisted caller code does not run ahead of an earlier read of a `vars` input', () => {
    // `state.value` is a plain read, but `nextValue` can write the variable
    // it reads, and the interpreter reads `W` first.
    const sopts = {
      ...NO_FOLD,
      vars: { W: 'state.value', V: 'vec3(nextValue())' },
      functions: { F: 'nextValue' },
    };
    const forBoth = (expr: any, message: RegExp) => {
      const boxed = cev.box(expr);
      expect(() => glsl.compile(boxed, sopts)).toThrow(message);
      expect(() => wgsl.compile(boxed, sopts)).toThrow(message);
    };
    expect(() =>
      wgsl.compile(cev.box(['Tuple', 'W', ['If', 'c', ['F', 'x'], 0]]), sopts)
    ).toThrow(/If/);
    forBoth(['Tuple', 'W', ['Max', 'V']], MOVED);
    // A read after the hoisted code runs after it in both orders.
    expect(glsl.compile(cev.box(['Tuple', ['Max', 'V'], 'W']), sopts).code).toBe(
      'vec3 _tv1 = vec3(nextValue());\n' +
        'return vec2((_gpu_max(_gpu_max(_tv1.x, _tv1.y), _tv1.z)), state.value);'
    );
    expect(
      wgsl.compile(cev.box(['Tuple', ['If', 'c', ['F', 'x'], 0], 'W']), sopts)
        .code
    ).toBe(
      'var _tv1: f32;\n' +
        'if (c) {\n' +
        '  _tv1 = nextValue(x);\n' +
        '} else {\n' +
        '  _tv1 = 0.0;\n' +
        '}\n' +
        'return vec2f(_tv1, state.value);'
    );
  });

  it('an element-wise lowering does not read the stored value of a mapped input', () => {
    // `r` has the value `Random()`, but the code reads the uniform `u_r`.
    const ce2 = new ComputeEngine();
    ce2.declare('x', 'real');
    ce2.declare('r', 'real');
    ce2.assign('r', ce2.box(['Random']));
    expect(
      glsl.compile(ce2.box(['Cot', ['List', 'r', 'x', 1]]), {
        ...NO_FOLD,
        vars: { r: 'u_r' },
      }).code
    ).toBe('(_gpu_cos3(vec3(u_r, x, 1.0)) / _gpu_sin3(vec3(u_r, x, 1.0)))');
  });

  it('a bound draw reads endpoints that are reads of one variable', () => {
    // The draws are bound in order (the loop draws too). `a` and `b` have
    // the same source, so they count as caller source, but they run no code.
    const expr = (first: any[]) =>
      cev.box([
        'WithRandomSeed',
        1,
        ['Tuple', ...first, ['Sum', ['Random'], ['Limits', 'n', 1, ['Floor', 't']]]],
      ]);
    const aopts = { ...NO_FOLD, vars: { a: 'u_t', b: 'u_t', W: 'nextValue()' } };
    expect(glsl.compile(expr([['Random', ['Interval', 'a', 'b']]]), aopts).code).toBe(
      'float _tv2 = _gpu_rnd_draw(uvec2(0x3ff00000u, 0x00000000u), _gpu_rnd_n1);\n' +
        'float _tv3 = 0.0;\n' +
        'for (int n = 1; n <= int(floor(floor(t))); n++) {\n' +
        '  float _tv4 = _gpu_rnd_draw(uvec2(0x3ff00000u, 0x00000000u), _gpu_rnd_n1);\n' +
        '  _tv3 += _tv4;\n' +
        '}\n' +
        'return vec2(((u_t) + _tv2 * ((u_t) - (u_t))), _tv3);'
    );
    expect(
      wgsl.compile(expr([['Random', ['Interval', 'a', 'b']]]), aopts).code
    ).toContain('return vec2f(((u_t) + _tv2 * ((u_t) - (u_t))), _tv3);');
    // The bound draw would run before the call of `W`.
    expect(() =>
      glsl.compile(expr(['W', ['Random', ['Interval', 'a', 'b']]]), aopts)
    ).toThrow(MOVED);
  });

  it('a `Match` whose first case always matches emits no selection', () => {
    expect(wgsl.compile(cev.box(['Match', 'x', ['MatchCase', '_', 'W']]), opts).code).toBe(
      'nextValue()'
    );
    expect(
      wgsl.compile(
        cev.box(['Match', 'x', ['MatchCase', '_', 'W'], ['MatchCase', 1, 'W']]),
        opts
      ).code
    ).toBe('nextValue()');
    // A case after a case that always matches is not emitted, so it is not
    // checked.
    expect(
      wgsl.compile(
        cev.box([
          'Add',
          'W',
          ['Match', 'x', ['MatchCase', 1, 10], ['MatchCase', '_', 30], ['MatchCase', 2, 'W']],
        ]),
        opts
      ).code
    ).toBe('nextValue() + select(30.0, 10.0, x == 1.0)');
  });

  it('a `Match` pin with caller code runs only when the earlier cases fail', () => {
    // The comparison with the pin of a later case is behind a `select` on
    // WGSL, so the `Match` takes the statement form; GLSL's `?:` keeps it
    // in its branch.
    const popts = { ...NO_FOLD, vars: { Pi: 'nextValue()', W: 'nextValue()' } };
    const match = [
      'Match',
      'x',
      ['MatchCase', 1, 10],
      ['MatchCase', ['Pin', 'Pi'], 20],
      ['MatchCase', '_', 30],
    ];
    expect(wgsl.compile(cev.box(match), popts).code).toBe(
      'var _tv1: f32;\n' +
        'if (x == 1.0) {\n' +
        '  _tv1 = 10.0;\n' +
        '} else {\n' +
        '  if (x == nextValue()) {\n' +
        '    _tv1 = 20.0;\n' +
        '  } else {\n' +
        '    _tv1 = 30.0;\n' +
        '  }\n' +
        '}\n' +
        'return _tv1;'
    );
    expect(glsl.compile(cev.box(match), popts).code).toBe(
      '((x == 1.0) ? (10.0) : (((x == nextValue()) ? (20.0) : (30.0))))'
    );
    // The `if` statement would call the pin before `W`; `select` would call
    // it when the first case matches.
    const after = cev.box(['Add', 'W', match]);
    expect(() => wgsl.compile(after, popts)).toThrow(/computes every branch/);
    expect(glsl.compile(after, popts).code).toBe(
      'nextValue() + ((x == 1.0) ? (10.0) : (((x == nextValue()) ? (20.0) : (30.0))))'
    );
  });

  it('forms with no caller code compile as before', () => {
    const c = (expr: any) => glsl.compile(cev.box(expr), opts).code;
    const cw = (expr: any) => wgsl.compile(cev.box(expr), opts).code;
    expect(c(['Match', 'x', ['MatchCase', 1, 10], ['MatchCase', 2, 20], ['MatchCase', '_', 30]])).toBe(
      '((x == 1.0) ? (10.0) : (((x == 2.0) ? (20.0) : (30.0))))'
    );
    expect(cw(['Match', 'x', ['MatchCase', 1, 'U'], ['MatchCase', '_', 30]])).toBe(
      'select(30.0, u_u, x == 1.0)'
    );
    expect(c(['Remainder', 'U', 2])).toBe(
      '((u_u) - (2.0) * _gpu_round_up((u_u) / (2.0)))'
    );
    expect(cw(['Remainder', 'x', 'U'])).toBe(
      '((x) - (u_u) * _gpu_round_up((x) / (u_u)))'
    );
    expect(cw(['Less', 'x', 'U', 3])).toBe('(x < u_u) && (u_u < 3.0)');
    // A block of declarations is a value expression, so it compiles as the
    // operand of an addition.
    expect(
      c(['Add', 'x', ['Block', ['Declare', 'a', "'unknown'", ['Square', 'x']], 'a']])
    ).toBe(
      'float _tv1;\n{\n  float a;\n  a = (x * x);\n  _tv1 = a;\n}\nreturn x + _tv1;'
    );
    expect(
      cw(['Add', 'U', ['Block', ['Declare', 'a', "'unknown'", ['Square', 'x']], 'a']])
    ).toBe(
      'var _tv1: f32;\n{\n  var a: f32;\n  a = (x * x);\n  _tv1 = a;\n}\nreturn u_u + _tv1;'
    );
    expect(
      wgsl.compile(cev.box(['Add', 'x', ['Sum', ['Square', 'V']]]), {
        ...NO_FOLD,
        vars: { V: 'u_v' },
      }).code
    ).toBe('x + dot(u_v, u_v)');
    expect(cw(['Which', 'True', 'U'])).toBe('(u_u)');
  });

  it('caller code with nothing before it is held in a temporary', () => {
    expect(glsl.compile(cev.box(['Tuple', ['Max', 'V'], 'U']), opts).code).toBe(
      'vec3 _tv1 = vec3(nextValue());\n' +
        'return vec2((_gpu_max(_gpu_max(_tv1.x, _tv1.y), _tv1.z)), u_u);'
    );
    // The canonical `Add` puts `U` first, and the interpreter reads it
    // before it calls `V`: the caller's code could write the variable that
    // `u_u` reads, so the temporary is refused.
    expect(() =>
      glsl.compile(cev.box(['Add', ['Max', 'V'], 'U']), opts)
    ).toThrow(MOVED);
  });

  it('a plain uniform read and a symbol with no `vars` entry compile as before', () => {
    const c = (expr: any) => glsl.compile(cev.box(expr), opts).code;
    const cw = (expr: any) => wgsl.compile(cev.box(expr), opts).code;
    expect(c(['Cot', 'U'])).toBe('(_gpu_cos(u_u) / _gpu_sin(u_u))');
    expect(c(['Cot', 'x'])).toBe('(cos(x) / sin(x))');
    expect(c(['Binomial', 'U', 3])).toBe(
      '(((u_u) * ((u_u) - 1.0) * ((u_u) - 2.0)) / 6.0)'
    );
    expect(c(['Less', 'x', 'U', 3])).toBe('(x < u_u) && (u_u < 3.0)');
    expect(cw(['If', 'c', 'U', 0])).toBe('select(0.0, u_u, c)');
    expect(c(['WithRandomSeed', 1, ['Tuple', 'U', ['Cot', ['Random']]]])).toBe(
      'float _tv1 = _gpu_rnd_draw(uvec2(0x3ff00000u, 0x00000000u), _gpu_rnd_n0);\n' +
        'return vec2(u_u, (_gpu_cos(_tv1) / _gpu_sin(_tv1)));'
    );
  });
});
