import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import type { MathJsonExpression } from '../../src/math-json/types';

// A multi-statement `Block` used as a VALUE on the shader targets — a `with`
// clause as the term of a `Sum`, or as one operand of an addition — has no
// expression form in GLSL or WGSL. It now lowers to one compound statement
// `{ … }` in the enclosing statement position, which stores the block's value
// in a temporary declared ahead of the braces; the temporary stands in for the
// block. The braces scope the block's locals, so each unrolled term of a `Sum`
// declares its own `a`, and two blocks in one function body can share a local
// name.
//
// The same change gives every statement of a block a statement sink of its
// own. Before it, a loop-form `Sum` on the right of a block-local assignment
// had nowhere to put its loop and spliced its whole statement block into the
// assignment (`a = float _tv1 = 0.0; for (…) { … } return _tv1;;`), which the
// compiler reported as a SUCCESS. The programs below were validated on a real
// WebGL2 context (compile + link) and a real WebGPU device
// (`createShaderModule` + `getCompilationInfo`) when the lowering landed.

const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

/** Lines that only an invalid splice produces. */
function expectValidShape(code: string) {
  // A declaration or a `return` on the right of an assignment or `+=`.
  expect(code).not.toMatch(
    /[+*]?=\s*(?:return\b|(?:float|var|let)\s+[A-Za-z_]\w*\s*[;=:])/
  );
  expect(code).not.toContain(';;');
  // A `return` inside a loop body or a compound statement returns from the
  // shader function on the first iteration.
  const depth = code.split('\n').reduce<number[]>((acc, line, i) => {
    const d = i === 0 ? 0 : acc[i - 1];
    acc.push(
      d + (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0)
    );
    return acc;
  }, []);
  code.split('\n').forEach((line, i) => {
    if (/^\s*return\b/.test(line)) expect(depth[i]).toBeLessThanOrEqual(1);
  });
}

function engine() {
  const ce = new ComputeEngine();
  for (const s of ['N', 'x', 'y', 't']) ce.declare(s, 'real');
  return ce;
}

const term: MathJsonExpression = [
  'Block',
  ['Declare', 'a'],
  ['Assign', 'a', ['Power', 2, 'n']],
  ['Divide', 'x', 'a'],
];

describe.each(['glsl', 'wgsl'] as const)(
  '%s: a block as a value operand',
  (to) => {
    const isWGSL = to === 'wgsl';
    const decl = isWGSL ? 'var a: f32;' : 'float a;';

    test('loop-form Sum: the term is a scoped compound statement in the loop body', () => {
      const ce = engine();
      const expr = ce.expr(['Sum', term, ['Limits', 'n', 0, 'N']]);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      // One loop; the block's local is declared INSIDE braces inside it, and
      // the accumulator reads the block's temporary.
      expect(code.match(/for \(/g)).toHaveLength(1);
      expect(code).toMatch(
        new RegExp(`\\{\\n\\s*${decl.replace(/[()]/g, '\\$&')}`)
      );
      expect(code).toMatch(/_tv\d+ \+= _tv\d+;/);
      // JavaScript agrees with the interpreter.
      const js = compile(expr);
      expect(js.run!({ x: 8, N: 3 })).toBe(15);
    });

    test('Product: the same lowering, multiplicative accumulator', () => {
      const ce = engine();
      const r = compile(ce.expr(['Product', term, ['Limits', 'n', 0, 'N']]), {
        to,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expectValidShape(source(r));
      expect(source(r)).toMatch(/_tv\d+ \*= _tv\d+;/);
    });

    test('unrolled Sum: each term declares its own local inside its own braces', () => {
      const ce = engine();
      const expr = ce.expr(['Sum', term, ['Limits', 'n', 0, 3]]);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      expect(code.match(/for \(/g)).toBeNull();
      // Four terms, four scoped declarations of `a`, no redeclaration in one
      // scope.
      expect(code.split(decl)).toHaveLength(5);
      expect(code.match(/\{\n/g)).toHaveLength(4);
      expect(code).toMatch(
        /return \(\(_tv1\) \+ \(_tv2\) \+ \(_tv3\) \+ \(_tv4\)\);/
      );
      expect(compile(expr).run!({ x: 8, N: 3 })).toBe(15);
    });

    test('a Sum with a block term composes with surrounding arithmetic', () => {
      const ce = engine();
      const expr = ce.expr(['Add', 1, ['Sum', term, ['Limits', 'n', 0, 'N']]]);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      expectValidShape(source(r));
      expect(source(r)).toMatch(/return _tv1 \+ 1\.0;/);
      expect(compile(expr).run!({ x: 8, N: 3 })).toBe(16);
    });

    test('a block term whose local is itself a loop-form Sum nests both loops', () => {
      const ce = engine();
      const expr = ce.expr([
        'Sum',
        [
          'Block',
          ['Declare', 'a'],
          [
            'Assign',
            'a',
            ['Sum', ['Multiply', 'j', 'n'], ['Limits', 'j', 1, 'N']],
          ],
          ['Divide', 'a', ['Add', 'n', 1]],
        ],
        ['Limits', 'n', 0, 'N'],
      ]);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      expect(code.match(/for \(/g)).toHaveLength(2);
      // Σ_{n=0}^{3} (Σ_{j=1}^{3} j·n) / (n+1) = 0 + 3 + 4 + 4.5
      expect(compile(expr).run!({ N: 3 })).toBeCloseTo(11.5, 12);
    });

    test('two blocks in one body declare the same local name in separate scopes', () => {
      const ce = engine();
      ce.declare('g2', 'function');
      ce.assign(
        'g2',
        ce.expr([
          'Function',
          [
            'Add',
            ['Block', ['Declare', 'a'], ['Assign', 'a', ['Square', 't']], 'a'],
            [
              'Block',
              ['Declare', 'a'],
              ['Assign', 'a', ['Multiply', 3, 't']],
              'a',
            ],
          ],
          ['Typed', 't', 'real'],
        ])
      );
      const expr = ce.expr(['g2', 'x']);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      expect(code.split(decl)).toHaveLength(3);
      expect(code).toMatch(/return _tv1 \+ _tv2;/);
      expect(compile(expr).run!({ x: 2 })).toBe(10);
    });

    test('a vector-valued block gets a vector temporary', () => {
      const ce = engine();
      const expr = ce.expr([
        'Dot',
        [
          'Block',
          ['Declare', 'p'],
          ['Assign', 'p', ['Tuple', 't', ['Multiply', 2, 't']]],
          'p',
        ],
        ['Tuple', 1, 1],
      ]);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      expect(code).toMatch(
        isWGSL
          ? /var _tv1: vec2f;\n\s*{\n\s*var p: vec2f;\n\s*p = vec2f\(t, 2\.0 \* t\);\n\s*_tv1 = p;\n\s*}\n\s*return dot\(_tv1, vec2f\(1\.0, 1\.0\)\);/
          : /vec2 _tv1;\n\s*{\n\s*vec2 p;\n\s*p = vec2\(t, 2\.0 \* t\);\n\s*_tv1 = p;\n\s*}\n\s*return dot\(_tv1, vec2\(1\.0, 1\.0\)\);/
      );
      expect(compile(expr).run!({ t: 2 })).toBe(6);
    });

    test('a block on the right of a short-circuiting And fails closed', () => {
      // Hoisting the block ahead of `&&` would run its assignment even when
      // the left operand already decided the result.
      const ce = engine();
      const r = compile(
        ce.expr([
          'And',
          ['Greater', 'x', 0],
          [
            'Block',
            ['Declare', 'q'],
            ['Assign', 'q', 'x'],
            ['Greater', 'q', 1],
          ],
        ]),
        { to, constantFold: false }
      );
      expect(r.success).toBe(false);
      // The value-block hook declines on a conditional sink, so the operand
      // gate reports; a loop-form Sum in the same position reports through
      // the arm guard instead. Both are the same fail-closed decision.
      expect(r.error).toMatch(
        /conditionally-evaluated branch|cannot be used as a sub-expression/
      );
    });

    test('a block whose final statement is a Loop is not a value', () => {
      const glslTarget = new GLSLTarget();
      const ce = engine();
      expect(() =>
        glslTarget.compileShader({
          type: 'fragment',
          uniforms: [{ name: 'x', type: 'float' }],
          body: [
            {
              variable: 'gl_FragColor.r',
              expression: ce.box([
                'Block',
                ['Declare', 'q'],
                ['Loop', ['Assign', 'q', 1], ['Element', 'k', ['Range', 1, 3]]],
              ] as MathJsonExpression),
            },
          ],
          constantFold: false,
        })
      ).toThrow(/final statement of a block|EXPRESSION/);
    });

    test('a conditional arm takes the statement form of the conditional', () => {
      // The block's compound statement lands inside the branch that selects
      // it (`compileGPUStatementSelection`), never ahead of the conditional.
      const ce = engine();
      const r = compile(ce.expr(['If', ['Greater', 'x', 0], term, 0]), {
        to,
        constantFold: false,
      });
      expect([r.success, r.error]).toEqual([true, undefined]);
      const code = r.code!;
      expect(code.indexOf('if (0.0 < x) {')).toBeGreaterThanOrEqual(0);
      // The block's own compound statement: a bare brace line inside the branch.
      expect(code).toMatch(/\n  \{\n/);
      expect(code.indexOf('} else {')).toBeGreaterThan(code.indexOf('if ('));
    });

    test('a block whose final statement is a Return still fails closed', () => {
      const ce = engine();
      const r = compile(
        ce.expr([
          'Sum',
          ['Block', ['Declare', 'a'], ['Assign', 'a', 'n'], ['Return', 'a']],
          ['Limits', 'n', 0, 'N'],
        ]),
        { to, constantFold: false }
      );
      expect(r.success).toBe(false);
    });
  }
);

describe.each(['glsl', 'wgsl'] as const)(
  '%s: statements inside a block get a statement sink of their own',
  (to) => {
    test('a loop-form Sum assigned to a block local was a silent miscompile', () => {
      const ce = engine();
      ce.declare('f', 'function');
      ce.assign(
        'f',
        ce.expr([
          'Function',
          [
            'Block',
            ['Declare', 'a'],
            ['Assign', 'a', ['Sum', 'j', ['Limits', 'j', 1, 't']]],
            ['Add', 'a', 1],
          ],
          ['Typed', 't', 'real'],
        ])
      );
      const expr = ce.expr(['f', 'x']);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      // The loop lands ahead of the assignment, which reads its accumulator.
      expect(code).toMatch(/for \([^\n]*\n[^\n]*\n\s*}\n\s*a = _tv1;/);
      expect(compile(expr).run!({ x: 3 })).toBe(7);
    });

    test('a loop-form Sum as the final statement of a function body', () => {
      const ce = engine();
      ce.declare('h', 'function');
      ce.assign(
        'h',
        ce.expr([
          'Function',
          [
            'Block',
            ['Declare', 'a'],
            ['Assign', 'a', 1],
            ['Sum', ['Multiply', 'a', 'j'], ['Limits', 'j', 1, 't']],
          ],
          ['Typed', 't', 'real'],
        ])
      );
      const expr = ce.expr(['h', 'x']);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      expect(code).toMatch(/}\n\s*return _tv1;\n}/);
      expect(compile(expr).run!({ x: 3 })).toBe(6);
    });

    test('a loop-form Sum assigned inside a Loop body', () => {
      const ce = engine();
      const expr = ce.box([
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', 0],
        [
          'Loop',
          ['Assign', 'a', ['Add', 'a', ['Sum', 'j', ['Limits', 'j', 1, 't']]]],
          ['Element', 'k', ['Range', 1, 3]],
        ],
        'a',
      ] as MathJsonExpression);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      expect(code.match(/for \(/g)).toHaveLength(2);
      expect(compile(expr).run!({ t: 3 })).toBe(18);
    });
  }
);

describe('GLSL expression routes', () => {
  const glsl = new GLSLTarget();

  test('a compileShader body statement accepts a block operand', () => {
    const ce = engine();
    const shader = glsl.compileShader({
      type: 'fragment',
      uniforms: [{ name: 'x', type: 'float' }],
      body: [
        {
          variable: 'gl_FragColor.r',
          expression: ce.expr([
            'Add',
            ['Block', ['Declare', 'q'], ['Assign', 'q', 2], 'q'],
            'x',
          ]),
        },
      ],
      constantFold: false,
    });
    expectValidShape(shader);
    expect(shader).toMatch(
      /float _tv1;\n\s*{\n\s*float q;\n\s*q = 2\.0;\n\s*_tv1 = q;\n\s*}\n\s*gl_FragColor\.r = x \+ _tv1;/
    );
  });
});

describe('the Tycho noise kernel (art/hyvhlz4chj)', () => {
  // The fractional-Brownian-motion term is a `with` clause — three locals
  // bound from the loop index — and the corpus audit of CE 0.128.9 found the
  // kernel emitted with the clause's statement block spliced into `+=`.
  function kernel() {
    const ce = new ComputeEngine();
    for (const s of ['s_eed', 't_0', 'N', 's_c1', 's_c2', 'x', 'y', 'z'])
      ce.declare(s, 'real');
    const fn = (body: MathJsonExpression, ...params: string[]) =>
      ce.expr([
        'Function',
        body,
        ...params.map((p) => ['Typed', p, 'real'] as MathJsonExpression),
      ]);
    const def = (
      name: string,
      body: MathJsonExpression,
      ...params: string[]
    ) => {
      ce.declare(name, 'function');
      ce.assign(name, fn(body, ...params));
    };
    const blk = (
      locals: Array<[string, MathJsonExpression]>,
      value: MathJsonExpression
    ): MathJsonExpression => [
      'Block',
      ...locals.flatMap(
        ([n, v]) =>
          [
            ['Declare', n],
            ['Assign', n, v],
          ] as MathJsonExpression[]
      ),
      value,
    ];
    const TWO_PI: MathJsonExpression = ['Multiply', 2, 'Pi'];
    ce.declare('p_rand', 'function');
    ce.assign(
      'p_rand',
      ce.expr([
        'Function',
        [
          'Mod',
          [
            'Multiply',
            ['Sin', ['Dot', 'p', ['Tuple', 12.9898, 78.233, 45.164]]],
            43758.5453,
          ],
          1,
        ],
        ['Typed', 'p', 'tuple<number, number, number>'],
      ])
    );
    def(
      'theta_0',
      [
        'Add',
        [
          'Multiply',
          TWO_PI,
          ['p_rand', ['Tuple', ['Floor', 'x'], ['Floor', 'y'], 's_eed']],
        ],
        't_0',
      ],
      'x',
      'y'
    );
    def(
      'p',
      blk(
        [['theta', ['theta_0', 'x', 'y']]],
        ['Tuple', ['Cos', 'theta'], ['Sin', 'theta']]
      ),
      'x',
      'y'
    );
    ce.assign('s_x', ce.expr(['Mod', 'x', 1]));
    ce.assign('s_y', ce.expr(['Mod', 'y', 1]));
    ce.assign('S', ce.expr(['Tuple', ['Negate', 's_x'], ['Negate', 's_y']]));
    ce.assign(
      'd_00',
      ce.expr(['Dot', ['p', 'x', 'y'], ['Add', 'S', ['Tuple', 0, 0]]])
    );
    ce.assign(
      'd_10',
      ce.expr([
        'Dot',
        ['p', ['Add', 'x', 1], 'y'],
        ['Add', 'S', ['Tuple', 1, 0]],
      ])
    );
    ce.assign(
      'd_01',
      ce.expr([
        'Dot',
        ['p', 'x', ['Add', 'y', 1]],
        ['Add', 'S', ['Tuple', 0, 1]],
      ])
    );
    ce.assign(
      'd_11',
      ce.expr([
        'Dot',
        ['p', ['Add', 'x', 1], ['Add', 'y', 1]],
        ['Add', 'S', ['Tuple', 1, 1]],
      ])
    );
    def(
      'I',
      ['Add', ['Multiply', ['Subtract', 'b', 'a'], 'w'], 'a'],
      'a',
      'b',
      'w'
    );
    def(
      's_s',
      ['Multiply', ['Subtract', 3, ['Multiply', 2, 'w']], ['Square', 'w']],
      'w'
    );
    def(
      'c_2',
      blk(
        [
          ['f_x', ['s_s', 's_x']],
          ['f_y', ['s_s', 's_y']],
        ],
        ['I', ['I', 'd_00', 'd_10', 'f_x'], ['I', 'd_01', 'd_11', 'f_x'], 'f_y']
      ),
      'x',
      'y'
    );
    const ang: MathJsonExpression = [
      'Multiply',
      TWO_PI,
      ['p_rand', ['Tuple', ['Add', 'n', 's_eed'], 'n', 'n']],
    ];
    def(
      'f_Bm',
      [
        'Sum',
        blk(
          [
            ['a', ['Power', 2, 'n']],
            [
              'i',
              [
                'Subtract',
                ['Multiply', 'x', ['Cos', ang]],
                ['Multiply', 'y', ['Sin', ang]],
              ],
            ],
            [
              'j',
              [
                'Add',
                ['Multiply', 'x', ['Sin', ang]],
                ['Multiply', 'y', ['Cos', ang]],
              ],
            ],
          ],
          [
            'Divide',
            ['c_2', ['Multiply', 'a', 'i'], ['Multiply', 'a', 'j']],
            'a',
          ]
        ),
        ['Limits', 'n', 0, 'N'],
      ],
      'x',
      'y'
    );
    def(
      'R_ec',
      blk(
        [
          ['o_1', ['f_Bm', ['Divide', 'x', 's_c2'], ['Divide', 'y', 's_c2']]],
          ['o_2', ['f_Bm', ['Divide', 'y', 's_c2'], ['Divide', 'x', 's_c2']]],
        ],
        [
          'f_Bm',
          ['Add', 'x', ['Divide', ['Multiply', 'o_1', ['Abs', 'o_1']], 's_c1']],
          ['Add', 'y', ['Divide', ['Multiply', 'o_2', ['Abs', 'o_2']], 's_c1']],
        ]
      ),
      'x',
      'y'
    );
    return ce.expr(
      blk(
        [['a', ['R_ec', ['Add', 'x', 'y'], 'z']]],
        [
          'Hsv',
          ['Add', 12, ['Multiply', 10, 'a']],
          ['Add', 0.87, ['Divide', 'a', 5]],
          ['Subtract', 0.8, ['Multiply', 0.4, 'a']],
        ]
      )
    );
  }

  test.each(['glsl', 'wgsl'] as const)(
    '%s: compiles with the with-clause as a scoped block in the loop',
    (to) => {
      const r = compile(kernel(), {
        to,
        vars: { x: 'a_position.x', y: 'a_position.y', z: 'a_position.z' },
      });
      expect(r.success).toBe(true);
      const code = source(r);
      expectValidShape(code);
      const fbm = /_fn_f_Bm\([^)]*\)[^{]*{([\s\S]*?)\n}/.exec(code)?.[1] ?? '';
      expect(fbm.match(/for \(/g)).toHaveLength(1);
      expect(fbm).toMatch(
        to === 'wgsl'
          ? /{\n\s*var a: f32;\n\s*a = exp2\(f32\(n\)\);/
          : /{\n\s*float a;\n\s*a = exp2\(float\(n\)\);/
      );
      expect(fbm).toMatch(/_tv1 \+= _tv2;/);
    }
  );
});
