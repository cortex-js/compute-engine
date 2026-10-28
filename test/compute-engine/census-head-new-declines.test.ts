import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Rows of the Tycho code-generation census that compiled at CE 0.171.0 and
// declined after it.
//

// ---------------------------------------------------------------------------
// Document `neyret/ra1p9naofs`, row `d(B(A(P)))\le0`, target GLSL.
//
//   P(x, y) := [x, y]
//   d(p) := f(p[1])·sin(r(p)) + f(p[2])·cos(r(p))
//   r(p) := (T + floor(p[1]))·max(0, 0.5 - l(f(p)))
//   A(p: vector<2>) := [arctan2(p[2], p[1])/(2π) + 0.5, l(p)]
//   B(p: vector<2>) := [2.6(p[1] + floor(p[2] - p[1]))^2 - T, p[2] - p[1]]
//   f(p) := mod(p, 1) - 0.5
//   l(p: vector<2>) := sqrt(p[1]^2 + p[2]^2)
//
// The call `r(B(…))` takes a copy of `r` whose parameter is the list
// `vector<2>` (a `vec2`). In that copy, `f(p)` applies `f` to a list: the
// interpreter applies `f` to each element, because the parameter of `f` is a
// scalar. The definition of `f` has a `float` parameter, and the call
// declined: "argument 1 lowers to vec2 but parameter is declared float". The
// shader targets now emit such a call through a wrapper that applies `f` to
// each component (`elementwiseCall`, gpu-target.ts).
// ---------------------------------------------------------------------------

function ra1p9naofs(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('T', 'real');
  ce.assign('T', 2.332);
  const V2 = "'vector<2>'";
  const at = (i: number) => ['At', 'p', i];
  const defs: Record<string, unknown> = {
    f: ['Function', ['Block', ['Add', ['Mod', 'p', 1], -0.5]], 'p'],
    l: [
      'Function',
      ['Block', ['Sqrt', ['Add', ['Power', at(1), 2], ['Power', at(2), 2]]]],
      ['Typed', 'p', V2],
    ],
    r: [
      'Function',
      [
        'Block',
        [
          'Multiply',
          ['Add', 'T', ['Floor', at(1)]],
          ['Max', 0, ['Add', ['Negate', ['l', ['f', 'p']]], 0.5]],
        ],
      ],
      'p',
    ],
    d: [
      'Function',
      [
        'Block',
        [
          'Add',
          ['Multiply', ['f', at(1)], ['Sin', ['r', 'p']]],
          ['Multiply', ['f', at(2)], ['Cos', ['r', 'p']]],
        ],
      ],
      'p',
    ],
    A: [
      'Function',
      [
        'Block',
        [
          'List',
          [
            'Add',
            ['Divide', ['Arctan2', at(2), at(1)], ['Multiply', 2, 'Pi']],
            0.5,
          ],
          ['l', 'p'],
        ],
      ],
      ['Typed', 'p', V2],
    ],
    B: [
      'Function',
      [
        'Block',
        [
          'List',
          [
            'Add',
            ['Negate', 'T'],
            [
              'Multiply',
              2.6,
              [
                'Power',
                ['Add', at(1), ['Floor', ['Add', ['Negate', at(1)], at(2)]]],
                2,
              ],
            ],
          ],
          ['Add', ['Negate', at(1)], at(2)],
        ],
      ],
      ['Typed', 'p', V2],
    ],
    P: ['Function', ['List', 'x', 'y'], 'x', 'y'],
  };
  for (const [name, def] of Object.entries(defs))
    ce.assign(name, ce.box(def as any));
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  return ce;
}

// A minimal evaluator for the GLSL that the calls below emit: the functions
// of the preamble (except the `_gpu_` helpers, which are given in
// JavaScript), `float` locals, `vec2(…)` constructors, `.x`/`.y` reads and
// scalar arithmetic. The emitted code has no arithmetic on a `vec2`; such an
// operation computes `NaN` or a string here (a `vec2` is an object, and
// `{x, y} + -0.5` concatenates), and the comparison with the interpreter
// fails in both cases, so a wrong shape does not go unnoticed.

const GLSL_BUILTINS: Record<string, unknown> = {
  vec2: (x: number, y: number) => ({ x, y }),
  fract: (x: number) => x - Math.floor(x),
  floor: Math.floor,
  sqrt: Math.sqrt,
  atan: (y: number, x: number) => Math.atan2(y, x),
  max: Math.max,
  _gpu_pow2: (x: number) => x * x,
  _gpu_max: (a: number, b: number) =>
    Number.isNaN(a) ? a : Number.isNaN(b) ? b : Math.max(a, b),
  _gpu_sin: Math.sin,
  _gpu_cos: Math.cos,
};

/** Translate the GLSL functions of `src` to JavaScript functions. */
function glslFunctionsToJS(src: string): string {
  const out: string[] = [];
  const re = /^(?:float|vec[234]|bool) (\w+)\(([^)]*)\) \{\n([\s\S]*?)\n\}/gm;
  for (const m of src.matchAll(re)) {
    const [, name, params, body] = m;
    if (name.startsWith('_gpu_')) continue;
    const names = params
      .split(',')
      .map((p) => p.trim().split(/\s+/).pop() ?? '')
      .filter((p) => p.length > 0);
    const js = body.replace(/^(\s*)(?:float|vec[234]) (\w+) =/gm, '$1let $2 =');
    out.push(`function ${name}(${names.join(', ')}) {\n${js}\n}`);
  }
  return out.join('\n');
}

function evalGLSL(
  result: { code: string; preamble?: string },
  vars: Record<string, number>
): unknown {
  const names = [...Object.keys(GLSL_BUILTINS), ...Object.keys(vars)];
  const body = `${glslFunctionsToJS(result.preamble ?? '')}\nreturn (${result.code});`;
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, body);
  return fn(...Object.values(GLSL_BUILTINS), ...Object.values(vars));
}

const SAMPLES: [number, number][] = [
  [0.3, 0.4],
  [1.7, -2.2],
  [-0.9, 3.1],
];

describe('neyret/ra1p9naofs: a scalar function applied to a vec2 list on GLSL', () => {
  const glsl = (ce: ComputeEngine, json: unknown) =>
    compile(ce.box(json as any), { to: 'glsl', fallback: false } as any) as {
      success: boolean;
      code: string;
      preamble?: string;
    };

  test('d(B(A(P(x, y)))) compiles to the interpreter value', () => {
    const ce = ra1p9naofs();
    const json = ['d', ['B', ['A', ['P', 'x', 'y']]]];
    const result = glsl(ce, json);
    expect(result.success).toBe(true);
    // `f` is applied to each component of the `vec2` list in the copy of `r`.
    expect(result.preamble).toMatch(
      /vec2 _fn_f_each2_1\(vec2 a0\) \{\n {2}return vec2\(_fn_f\(a0\.x\), _fn_f\(a0\.y\)\);/
    );
    for (const [x, y] of SAMPLES) {
      const expected = ce
        .box(json as any)
        .subs({ x, y })
        .evaluate().re;
      expect(evalGLSL(result, { x, y })).toBeCloseTo(expected, 5);
    }
  });

  test('f([x, y]) compiles to the list of the values of f', () => {
    const ce = ra1p9naofs();
    const json = ['f', ['List', 'x', 'y']];
    const result = glsl(ce, json);
    expect(result.success).toBe(true);
    for (const [x, y] of SAMPLES) {
      const expected = ce
        .box(json as any)
        .subs({ x, y })
        .evaluate();
      const v = evalGLSL(result, { x, y }) as { x: number; y: number };
      expect(v.x).toBeCloseTo(expected.ops![0].re, 5);
      expect(v.y).toBeCloseTo(expected.ops![1].re, 5);
    }
  });

  test('the wrapper name does not collide with a user function', () => {
    // A user function named `f_each2_1` has the emitted name
    // `_fn_f_each2_1`, the name of the wrapper of `f` with a `vec2` at its
    // only parameter. The wrapper takes another name.
    const ce = ra1p9naofs();
    ce.assign('f_each2_1', ce.box(['Function', ['Add', 'q', 100], 'q'] as any));
    ce.declare('z', 'real');
    const a = ['f_each2_1', 'z'];
    const b = ['f', ['List', 'x', 'y']];
    for (const json of [
      ['Add', a, b],
      ['Add', b, a],
    ]) {
      const result = glsl(ce, json);
      expect(result.success).toBe(true);
      const names = [...result.code.matchAll(/(_fn_\w+)\(/g)].map((m) => m[1]);
      expect(names).toHaveLength(2);
      expect(names[0]).not.toBe(names[1]);
      const user = names.find((n) => /^_fn_f_each2_1$/.test(n));
      const wrapper = names.find((n) => n !== user);
      expect(user).toBeDefined();
      expect(result.preamble).toContain(`float ${user}(float q) {`);
      expect(result.preamble).toContain(`vec2 ${wrapper}(vec2 a0) {`);
    }
  });

  test('on WGSL, the wrapper takes and returns a vec2f', () => {
    const ce = ra1p9naofs();
    const result = compile(ce.box(['f', ['List', 'x', 'y']] as any), {
      to: 'wgsl',
      fallback: false,
    } as any) as { success: boolean; code: string; preamble?: string };
    expect(result.success).toBe(true);
    expect(result.code).toBe('_fn_f_each2_1(vec2f(x, y))');
    expect(result.preamble).toMatch(
      /fn _fn_f_each2_1\(a0: vec2f\) -> vec2f \{\n {2}return vec2f\(_fn_f\(a0\.x\), _fn_f\(a0\.y\)\);/
    );
  });

  test('a two-parameter function with a list and a scalar', () => {
    const ce = ra1p9naofs();
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Subtract', ['Mod', 'p', 1], ['Multiply', 0.5, 'q']],
        'p',
        'q',
      ] as any)
    );
    ce.declare('z', 'real');
    for (const json of [
      ['g', ['List', 'x', 'y'], 'z'],
      ['g', 'z', ['List', 'x', 'y']],
    ]) {
      const result = glsl(ce, json);
      expect(result.success).toBe(true);
      for (const [x, y] of SAMPLES) {
        const z = x - 2 * y;
        const expected = ce
          .box(json as any)
          .subs({ x, y, z })
          .evaluate();
        const v = evalGLSL(result, { x, y, z }) as { x: number; y: number };
        expect(v.x).toBeCloseTo(expected.ops![0].re, 5);
        expect(v.y).toBeCloseTo(expected.ops![1].re, 5);
      }
    }
  });

  test('a list at two different positions gives two wrappers, each emitted once', () => {
    const ce = ra1p9naofs();
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Subtract', ['Mod', 'p', 1], ['Multiply', 0.5, 'q']],
        'p',
        'q',
      ] as any)
    );
    ce.declare('z', 'real');
    const json = [
      'Add',
      ['At', ['g', ['List', 'x', 'y'], 'z'], 1],
      ['At', ['g', 'z', ['List', 'x', 'y']], 2],
    ];
    const result = glsl(ce, json);
    expect(result.success).toBe(true);
    const preamble = result.preamble ?? '';
    expect(
      preamble.match(/vec2 _fn_g_each2_10\(vec2 a0, float a1\) \{/g)
    ).toHaveLength(1);
    expect(
      preamble.match(/vec2 _fn_g_each2_01\(float a0, vec2 a1\) \{/g)
    ).toHaveLength(1);
    for (const [x, y] of SAMPLES) {
      const z = x - 2 * y;
      const expected = ce
        .box(json as any)
        .subs({ x, y, z })
        .evaluate().re;
      expect(evalGLSL(result, { x, y, z })).toBeCloseTo(expected, 5);
    }
  });

  test('lists of different widths decline', () => {
    const ce = ra1p9naofs();
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Subtract', ['Mod', 'p', 1], ['Multiply', 0.5, 'q']],
        'p',
        'q',
      ] as any)
    );
    ce.declare('z', 'real');
    const json = ['g', ['List', 'x', 'y'], ['List', 'x', 'y', 'z']];
    expect(() => glsl(ce, json)).toThrow(
      /argument 1 `\[x,y\]` lowers to "vec2" but parameter "p" is declared "float"/
    );
  });

  test('a point argument keeps the shape check', () => {
    // A point is not a list: the interpreter refuses `f((x, y))` (a tuple
    // minus a number), and the shader call declines.
    const ce = ra1p9naofs();
    const json = ['f', ['Tuple', 'x', 'y']];
    expect(
      JSON.stringify(
        ce
          .box(json as any)
          .subs({ x: 0.3, y: 0.4 })
          .evaluate().json
      )
    ).toMatch(/incompatible-type/);
    expect(() => glsl(ce, json)).toThrow(/call of `f`: argument 1 is a point/);
  });
});

// ---------------------------------------------------------------------------
// Document `neyret/ndqj7hupta`, row `R(20, x, y)\le3..9`, target interval-js.
//
//   R(0, x, y) = 0
//   R(i, x, y) = R(i - 1, x, y) + 0.5·S(x, y, R(i - 1, x, y))
//   S(a, b, c) = max(G(2ac, 2bc, 2c), C(ac, bc, c))
//
// `R`, `S` and `C` are declared `function` (Tycho), so the signature of the
// recursive `R` is derived with the recursion check (CE-544,
// `_wildcardRecursiveSignature`). While it is derived, the recursive calls
// in the body read the skeleton, whose result is `unknown`, and the body
// node `0.5·S(x, y, R(i - 1, x, y))` was typed `list<…> | number | tuple`
// and cached. After an evaluation moved the cache generation, a compilation
// of the body read that type and declined: "may be a collection at run
// time". The derivation now reads the result an earlier derivation settled
// (`_deriveSignatureOnce`, boxed-value-definition.ts). The row compiled at
// 0.171.0; the same defect was there for `R` declared
// `(unknown, unknown, unknown) -> unknown`.
// ---------------------------------------------------------------------------

function ndqj7hupta(rDeclaration: string): ComputeEngine {
  const ce = new ComputeEngine();
  const W = 'real | signed_infinity | nan';
  ce.declare('R', rDeclaration);
  ce.declare('S', 'function');
  ce.declare('C', 'function');
  ce.declare('G', `(${W}, ${W}, ${W}) -> unknown`);
  const fn = (body: unknown) => ['Function', ['Block', body], 'a', 'b', 'c'];
  ce.assign(
    'G',
    ce.box(
      fn([
        'Add',
        [
          'Abs',
          [
            'Add',
            ['Multiply', ['Sin', 'c'], ['Cos', 'a']],
            ['Multiply', ['Sin', 'a'], ['Cos', 'b']],
            ['Multiply', ['Sin', 'b'], ['Cos', 'c']],
          ],
        ],
        -0.1,
      ]) as any
    )
  );
  ce.assign(
    'C',
    ce.box(
      fn([
        'Add',
        ['Max', ['Abs', 'a'], ['Abs', 'b'], ['Abs', ['Add', 'c', -6]]],
        -3,
      ]) as any
    )
  );
  ce.assign(
    'S',
    ce.box(
      fn([
        'Max',
        [
          'G',
          ['Multiply', 2, 'a', 'c'],
          ['Multiply', 2, 'b', 'c'],
          ['Multiply', 2, 'c'],
        ],
        ['C', ['Multiply', 'a', 'c'], ['Multiply', 'b', 'c'], 'c'],
      ]) as any
    )
  );
  const recursive = ['R', ['Add', 'i', -1], 'x', 'y'];
  ce.assign(
    'R',
    ce.box([
      'Function',
      [
        'Block',
        [
          'Which',
          ['Equal', 'i', 0],
          0,
          'True',
          ['Add', recursive, ['Multiply', 0.5, ['S', 'x', 'y', recursive]]],
        ],
      ],
      'i',
      'x',
      'y',
    ] as any)
  );
  ce.declare('x', W);
  ce.declare('y', W);
  return ce;
}

describe('neyret/ndqj7hupta: a recursive function after an evaluation on interval-js', () => {
  test.each(['function', '(unknown, unknown, unknown) -> unknown'])(
    'R(20, x, y) - k compiles after a symbolic evaluation (R declared %s)',
    (declaration) => {
      const ce = ndqj7hupta(declaration);
      for (const k of [3, 4, 5]) {
        const json = ['Add', ['R', 20, 'x', 'y'], -k];
        // Tycho evaluates the row before it compiles it. The evaluation
        // moves the cache generation, and the body of `R` is typed again.
        ce.box(json as any).evaluate();
        for (const to of ['interval-js', 'javascript']) {
          const result = compile(ce.box(json as any), {
            to,
            fallback: false,
          } as any) as { success: boolean; run: (v: object) => any };
          expect(result.success).toBe(true);
          for (const [x, y] of SAMPLES) {
            const expected = ce
              .box(['Add', ['R', 20, x, y], -k] as any)
              .evaluate().re;
            const v = result.run({ x, y });
            if (to === 'javascript') {
              expect(v).toBeCloseTo(expected, 6);
            } else {
              expect(v.kind).toBe('interval');
              const tol = 1e-9 * Math.max(1, Math.abs(expected));
              expect(v.value.lo).toBeLessThanOrEqual(expected + tol);
              expect(v.value.hi).toBeGreaterThanOrEqual(expected - tol);
            }
          }
        }
      }
    }
  );

  test('the recursive call in the body of R is typed as a number', () => {
    const ce = ndqj7hupta('function');
    // The sequence of the Tycho run: evaluate, compile, evaluate again.
    ce.box(['Add', ['R', 20, 'x', 'y'], -3]).evaluate();
    compile(ce.box(['Add', ['R', 20, 'x', 'y'], -3]), {
      to: 'interval-js',
    } as any);
    ce.box(['Add', ['R', 20, 'x', 'y'], -4]).evaluate();
    const literal = (ce.lookupDefinition('R') as any).value.value;
    // Block > Which > [Equal, 0, True, Add]: the general branch.
    const general = literal.ops[0].ops[0].ops[3];
    expect(general.operator).toBe('Add');
    expect(general.type.toString()).toBe('number');
    expect(general.ops[1].type.matches('number')).toBe(true);
  });

  test('the body of R stays typed as a number after a Block evaluates a call of R', () => {
    // The evaluation of the block runs in a scope of its own. The reuse of
    // the earlier result does not depend on the scope of the read, so the
    // derivation in that scope types the body as the one outside does.
    const ce = ndqj7hupta('function');
    const row = ['Add', ['R', 20, 'x', 'y'], -3];
    ce.box(row).evaluate();
    compile(ce.box(row), { to: 'interval-js' } as any);
    ce.box(row).evaluate();
    const general = () =>
      (ce.lookupDefinition('R') as any).value.value.ops[0].ops[0].ops[3];
    expect(general().type.toString()).toBe('number');
    ce.box([
      'Block',
      ['Declare', 'q', "'integer'"],
      ['Assign', 'q', 2],
      ['R', 'q', 'x', 'y'],
    ]).evaluate();
    expect(general().type.toString()).toBe('number');
    const result = compile(ce.box(['Add', ['R', 20, 'x', 'y'], -4]), {
      to: 'interval-js',
      fallback: false,
    } as any) as { success: boolean };
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The reuse of an earlier derivation's result by `_deriveSignatureOnce`
// (boxed-value-definition.ts), for the ndqj7hupta fix above.
// ---------------------------------------------------------------------------

describe('a recursive signature derived again', () => {
  // The two callee tests check the type of `R` after a callee changes. They
  // do not check the conditions on the reuse of the earlier result: the
  // contribution of `S` comes from the signature of `S` itself, so they pass
  // without those conditions too. The tests of a value write and of a
  // `Block` evaluation below check the conditions.
  function engineWithCallee(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('R', 'function');
    ce.declare('S', 'function');
    ce.assign('S', ce.box(['Function', ['Multiply', 2, 'k'], 'k']));
    // R(i) := If(i ≤ 0, 0, S(R(i − 1)))
    ce.assign(
      'R',
      ce.box([
        'Function',
        ['If', ['LessEqual', 'i', 0], 0, ['S', ['R', ['Subtract', 'i', 1]]]],
        'i',
      ])
    );
    // Derive the signature, compile, and evaluate, so that a result is
    // settled and memoized before the callee changes.
    expect(ce.box(['R', 'n']).type.toString()).toBe('number');
    compile(ce.box(['R', 'n']), { to: 'javascript' } as any);
    ce.box(['R', 3]).evaluate();
    return ce;
  }

  test('a callee whose result widens from a number to a string', () => {
    const ce = engineWithCallee();
    ce.assign('S', ce.box(['Function', "'s'", 'k']));
    const t = ce.box(['R', 'n']).type;
    expect(t.matches('string')).toBe(false);
    expect(t.toString()).toMatch(/string/);
    ce.box(['R', 3]).evaluate();
    expect(ce.box(['R', 'n']).type.toString()).toMatch(/string/);
    expect(ce.box(['R', 3]).evaluate().toString()).toBe('"s"');
  });

  test('a callee whose result widens from a number to a list', () => {
    const ce = engineWithCallee();
    ce.assign('S', ce.box(['Function', ['List', 'k'], 'k']));
    ce.box(['R', 3]).evaluate();
    // After the change, R(2) is `[[0]]`, a list of lists: the signature and
    // the type of the recursive call in the body include lists.
    const t = ce.box(['R', 'n']).type;
    expect(t.toString()).toMatch(/list<unknown>/);
    const literal = (ce.lookupDefinition('R') as any).value.value;
    const find = (e: any): any =>
      e.operator === 'S' ? e : (e.ops ?? []).map(find).find((x: any) => x);
    expect(find(literal.ops[0]).ops[0].type.toString()).toMatch(
      /list<unknown>/
    );
    expect(ce.box(['R', 2]).evaluate().toString()).toBe('[[0]]');
    const result = compile(ce.box(['R', 'n']), {
      to: 'javascript',
      fallback: false,
    } as any) as { success: boolean; run: (v: object) => unknown };
    expect(result.success).toBe(true);
    expect(result.run({ n: 2 })).toEqual([[0]]);
  });

  test('a write to a data symbol that the body reads widens the signature', () => {
    // a := 5, R(i) := If(i ≤ 0, 0, R(i − 1) + a), then a := [1, 2]: R(2)
    // is the list [2, 4]. The first read after the write is the type of
    // the recursive call in the body.
    const ce = new ComputeEngine();
    ce.assign('a', 5);
    ce.declare('R', 'function');
    ce.assign(
      'R',
      ce.box([
        'Function',
        [
          'If',
          ['LessEqual', 'i', 0],
          0,
          ['Add', ['R', ['Subtract', 'i', 1]], 'a'],
        ],
        'i',
      ])
    );
    const literal = (ce.lookupDefinition('R') as any).value.value;
    const find = (e: any): any =>
      e.operator === 'Add' ? e : (e.ops ?? []).map(find).find((x: any) => x);
    ce.box(['Add', ['R', 3], 1]).evaluate();
    compile(ce.box(['Add', ['R', 'n'], 1]), { to: 'javascript' } as any);
    ce.box(['Add', ['R', 3], 2]).evaluate();
    expect(ce.box(['R', 'n']).type.toString()).toBe('number');
    ce.assign('a', ce.box(['List', 1, 2]));
    expect(find(literal.ops[0]).type.toString()).toBe('vector<integer^2>');
    expect(ce.box(['R', 'n']).type.toString()).toBe(
      'integer | vector<integer^2>'
    );
    expect(ce.box(['R', 2]).evaluate().toString()).toBe('[2,4]');
  });

  test('a recursive tuple builder keeps a stable signature', () => {
    // R(i) := If(i ≤ 0, 0, (R(i − 1), 1)). The result derived under the
    // earlier result is that result again, so the signature is the same in
    // every cache generation.
    const ce = new ComputeEngine();
    ce.declare('R', 'function');
    ce.assign(
      'R',
      ce.box([
        'Function',
        [
          'If',
          ['LessEqual', 'i', 0],
          0,
          ['Tuple', ['R', ['Subtract', 'i', 1]], 1],
        ],
        'i',
      ])
    );
    const signatures: string[] = [];
    for (let round = 0; round < 4; round++) {
      signatures.push(ce.box(['R', 'n']).type.toString());
      ce.box(['R', 3]).evaluate();
      compile(ce.box(['R', 'n']), { to: 'javascript' } as any);
    }
    expect(signatures[0]).toBe(
      'integer | tuple<integer | tuple<unknown, integer>, integer>'
    );
    expect(new Set(signatures).size).toBe(1);
  });

  test('a body whose result grows at each step keeps a stable type', () => {
    // R(i) := If(i ≤ 0, 0, [R(i − 1)]): R(3) is [[[0]]]. Each cache
    // generation derives the signature again; the signature and the type
    // of the recursive call in the body must not nest one level deeper
    // each time.
    const ce = new ComputeEngine();
    ce.declare('R', 'function');
    ce.assign(
      'R',
      ce.box([
        'Function',
        ['If', ['LessEqual', 'i', 0], 0, ['List', ['R', ['Subtract', 'i', 1]]]],
        'i',
      ])
    );
    const literal = (ce.lookupDefinition('R') as any).value.value;
    const find = (e: any): any =>
      e.operator === 'List' ? e : (e.ops ?? []).map(find).find((x: any) => x);
    const signatures: string[] = [];
    const calls: string[] = [];
    for (let round = 0; round < 5; round++) {
      signatures.push(ce.box(['R', 'n']).type.toString());
      calls.push(find(literal.ops[0]).ops[0].type.toString());
      expect(
        ce
          .box(['R', 3 + round])
          .evaluate()
          .toString()
      ).toMatch(/^\[\[\[/);
      compile(ce.box(['R', 'n']), { to: 'javascript' } as any);
    }
    expect(signatures[0]).toBe('integer | list<integer | list<unknown>>');
    expect(new Set(signatures).size).toBe(1);
    expect(new Set(calls).size).toBe(1);
  });
});
