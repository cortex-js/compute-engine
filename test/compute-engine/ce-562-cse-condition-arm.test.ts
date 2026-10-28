import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { harvestCse } from '../../src/compute-engine/compilation/cse';

/**
 * ROADMAP CE-562: a subexpression that the condition of a `When` and its
 * value both read is computed once.
 *
 * `When(value, cond)` evaluates its condition on every path and its value
 * only when the condition holds. A temporary bound for the condition is
 * therefore available to the value arm. The CSE harvest walked the operands
 * in index order (the value first), so the value occurrence came before the
 * condition occurrence and the arm could not read the temporary: the call was
 * emitted twice. The harvest now walks the operands in emission order (the
 * condition first), and every `When` handler compiles the condition first.
 *
 * The witness is the Desmos restriction `T_4(t) = T_3(t) {cos(T_3(t)) > c}`,
 * registered the way Tycho does it (a declared signature, then a `Function`
 * literal with a `Block` body).
 */

const T3 = [
  'Function',
  [
    'Block',
    [
      'Add',
      [
        'Multiply',
        ['Rational', 1, 16],
        'Pi',
        ['Floor', ['Multiply', ['Rational', 1, 5], 'ceArg_0']],
      ],
      ['Multiply', ['Rational', 1, 2], 'Pi'],
    ],
  ],
  'ceArg_0',
];

const T4 = [
  'Function',
  [
    'Block',
    [
      'When',
      ['T_3', 'ceArg_0'],
      ['Less', -0.8164965809277259, ['Cos', ['T_3', 'ceArg_0']]],
    ],
  ],
  'ceArg_0',
];

function engineWithT4(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const name of ['T_3', 'T_4'])
    ce.declare(name, {
      signature: '(real | signed_infinity | nan) -> unknown',
    });
  ce.assign('T_3', ce.box(T3 as never));
  ce.assign('T_4', ce.box(T4 as never));
  ce.declare('t', 'real');
  return ce;
}

/** Occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The text of the emitted definition of `_fn_<name>`, up to the next blank
 * line. */
function definition(preamble: string | undefined, name: string): string {
  const text = preamble ?? '';
  const start = text.search(new RegExp(`(const|float|fn) _fn_${name}\\b`));
  if (start < 0) return '';
  const end = text.indexOf('\n\n', start);
  return (end < 0 ? text.slice(start) : text.slice(start, end)).trim();
}

describe('CE-562 — a user-function body shares a call between the condition and the value of a When', () => {
  it('javascript', () => {
    const ce = engineWithT4();
    const r = compile(ce.parse('\\cos(T_4(t))'), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(definition(r.preamble, 'T_4')).toBe(
      'const _fn_T_4 = (ceArg_0) => { { const _cse1 = _fn_T_3(ceArg_0); ' +
        'return ((-0.8164965809277259 < Math.cos(_cse1)) ? (_cse1) : NaN); } };'
    );
  });

  it('glsl', () => {
    const ce = engineWithT4();
    const r = compile(ce.parse('\\cos(T_4(t))'), { to: 'glsl' });
    expect(r.success).toBe(true);
    expect(definition(r.preamble, 'T_4')).toBe(
      [
        'float _fn_T_4(float ceArg_0) {',
        '  float _cse1 = _fn_T_3(ceArg_0);',
        '  return ((-0.8164966 < _gpu_cos(_cse1)) ? (_cse1) : (_gpu_nan()));',
        '}',
      ].join('\n')
    );
  });

  it('wgsl', () => {
    const ce = engineWithT4();
    const r = compile(ce.parse('\\cos(T_4(t))'), { to: 'wgsl' });
    expect(r.success).toBe(true);
    const body = definition(r.preamble, 'T_4');
    expect(count(body, '_fn_T_3(')).toBe(1);
    // The binding is placed before the `if`, which reads it.
    expect(body.indexOf('_fn_T_3(')).toBeLessThan(body.indexOf('if ('));
  });

  it('interval-js', () => {
    const ce = engineWithT4();
    const r = compile(ce.parse('\\cos(T_4(t))'), { to: 'interval-js' });
    expect(r.success).toBe(true);
    expect(definition(r.preamble, 'T_4')).toBe(
      'const _fn_T_4 = (ceArg_0) => (() => { const _cse1 = _fn_T_3(ceArg_0); ' +
        'return _IA.restrict(_IA.less(_k4, _IA.cos(_cse1)), () => _cse1); })();'
    );
  });

  it('the compiled function agrees with the interpreter, the NaN branch included', () => {
    const ce = engineWithT4();
    const r = compile(ce.parse('T_4(t)'), { to: 'javascript' });
    expect(r.success).toBe(true);
    // floor(t/5) = 0 and 3 keep the value; 6 and 10 take the NaN branch
    // (cos(π/2 + kπ/16) ≤ -0.8165 from k = 5 on).
    for (const t of [0, 2.5, 17, 31, 52]) {
      const expected = ce.box(['T_4', t]).N();
      const actual = r.run!({ t }) as number;
      if (expected.isNaN === true || expected.symbol === 'Missing')
        expect(actual).toBeNaN();
      else expect(actual).toBeCloseTo(expected.re, 12);
    }
    expect(r.run!({ t: 31 })).toBeNaN();
    expect(r.run!({ t: 0 })).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('CE-562 — a top-level When', () => {
  function engineWithF(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('f', ce.parse('t \\mapsto t^2 + \\sin t'));
    return ce;
  }
  const shared = ['When', ['f', 'x'], ['Less', 0, ['Cos', ['f', 'x']]]];

  it.each(['javascript', 'glsl', 'wgsl', 'interval-js'] as const)(
    '%s: the call is emitted once',
    (to) => {
      const ce = engineWithF();
      const r = compile(ce.box(shared as never), { to });
      expect(r.success).toBe(true);
      expect(count(r.code, '_fn_f(')).toBe(1);
    }
  );

  it('javascript: the emission', () => {
    const ce = engineWithF();
    const r = compile(ce.box(shared as never), { to: 'javascript' });
    // The condition compares a value computed from the input `x`, so it
    // is tested for being decided first, as in `If` (ROADMAP CE-569).
    expect(r.code).toBe(
      '(() => { const _cse1 = _fn_f(_.x); ' +
        'return ((_.x !== undefined) ? ((0 < Math.cos(_cse1)) ? (_cse1) : NaN) : NaN); })()'
    );
  });

  it('the compiled value agrees with the interpreter', () => {
    const ce = engineWithF();
    const expr = ce.box(shared as never);
    const r = compile(expr, { to: 'javascript' });
    // f(x) = x² + sin x: cos(f(x)) > 0 at 0.5 (f ≈ 0.73), not at 1.5 (f ≈ 3.25).
    for (const x of [0.5, 1.5, -0.3]) {
      const expected = expr.subs({ x }).N();
      const actual = r.run!({ x }) as number;
      if (expected.isNaN === true || expected.symbol === 'Missing')
        expect(actual).toBeNaN();
      else expect(actual).toBeCloseTo(expected.re, 12);
    }
    expect(r.run!({ x: 1.5 })).toBeNaN();
  });

  it('the harvest places the shared call in the root region', () => {
    const ce = engineWithF();
    const harvest = harvestCse(ce.box(shared as never), {
      admitPureUserFunctions: true,
    });
    expect(harvest.candidates.map((c) => c.region.kind)).toEqual(['root']);
  });

  it('a subexpression that only the value reads stays in the value arm', () => {
    const ce = engineWithF();
    const expr = ce.box([
      'When',
      ['Add', ['f', 'x'], ['Sin', ['f', 'x']]],
      ['Less', 0, 'x'],
    ] as never);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    // Nothing is bound in front of the condition: the binding of `f(x)`, if
    // any, is inside the arm, after the `?`.
    const question = r.code.indexOf('?');
    const firstCall = r.code.indexOf('_fn_f(');
    expect(question).toBeGreaterThan(-1);
    expect(firstCall).toBeGreaterThan(question);
    expect(r.run!({ x: -1 })).toBeNaN();
    const f = 4 + Math.sin(2);
    expect(r.run!({ x: 2 }) as number).toBeCloseTo(f + Math.sin(f), 12);
  });

  it('an impure call is never shared', () => {
    const ce = engineWithF();
    const expr = ce.box([
      'When',
      ['Add', ['Random'], ['Sin', 'x']],
      ['Less', 0.5, ['Add', ['Random'], ['Sin', 'x']]],
    ] as never);
    const js = compile(expr, { to: 'javascript' });
    expect(js.success).toBe(true);
    expect(count(js.code, '_SYS.drawNextRandomNumber()')).toBe(2);
    const glsl = compile(expr, { to: 'glsl' });
    expect(glsl.success).toBe(true);
    expect(count(glsl.code, '_gpu_rnd_draw(')).toBe(2);
  });
});

/**
 * The second shape of ROADMAP CE-562 (Tycho document `hyvhlz4chj`): a call
 * whose argument reads a symbol that `vars` maps to a uniform with another
 * name (`s_eed` → `u_var_s_5f_eed`), used twice in one statement.
 *
 * A string `vars` source was treated as caller code that may have an effect,
 * so nothing that reads it was shared. On the shader targets a bare
 * identifier is a plain read of a uniform, which the shader cannot write, so
 * it is shared now, unless a variable of the compiled code has the same
 * name (`gpuPlainUniformRead`, `gpu-target.ts`). The JavaScript target is
 * unchanged: a bare global name there can be a getter.
 */
describe('CE-562 — a vars source that is a bare identifier is a plain read on the shader targets', () => {
  function engineWithFBm(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    ce.declare('s_eed', 'real');
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const real = 'real | signed_infinity | nan';
    ce.declare('p_rand', {
      signature: '(tuple<real, real, real>) -> unknown',
    });
    ce.assign(
      'p_rand',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Mod',
            [
              'Multiply',
              43758.5453,
              [
                'Sin',
                ['Dot', 'ceArg_0', ['PointList', 12.9898, 78.233, 45.164]],
              ],
            ],
            1,
          ],
        ],
        'ceArg_0',
      ] as never)
    );
    // The body of `f_Bm` in the document: a sum over `n` whose term is a
    // block that calls `p_rand` twice in each of two statements.
    const call = [
      'p_rand',
      ['PointList', ['Add', 'ceArg_2', 's_eed'], 'ceArg_2', 'ceArg_2'],
    ];
    const turn = ['Multiply', 2, 'Pi', call];
    ce.declare('f_Bm', { signature: `(${real}, ${real}) -> unknown` });
    ce.assign(
      'f_Bm',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Sum',
            [
              'Block',
              ['Declare', 'ceArg_4'],
              [
                'Assign',
                'ceArg_4',
                [
                  'Add',
                  ['Multiply', 'ceArg_0', ['Cos', turn]],
                  ['Negate', ['Multiply', 'ceArg_1', ['Sin', turn]]],
                ],
              ],
              ['Declare', 'ceArg_5'],
              [
                'Assign',
                'ceArg_5',
                [
                  'Add',
                  ['Multiply', 'ceArg_0', ['Sin', turn]],
                  ['Multiply', 'ceArg_1', ['Cos', turn]],
                ],
              ],
              ['Add', 'ceArg_4', 'ceArg_5'],
            ],
            ['Limits', 'ceArg_2', 0, 'N'],
          ],
        ],
        'ceArg_0',
        'ceArg_1',
      ] as never)
    );
    return ce;
  }
  const VARS = { s_eed: 'u_var_s_5f_eed', N: 'u_var_N' };

  it.each(['glsl', 'wgsl'] as const)(
    '%s: each statement calls p_rand once',
    (to) => {
      const ce = engineWithFBm();
      const r = compile(ce.parse('f_{Bm}(x, y)'), { to, vars: VARS });
      expect(r.success).toBe(true);
      const body = definition(r.preamble, 'f_Bm');
      // Two statements, one bound call in each (before: four calls).
      expect(count(body, '_fn_p_rand(')).toBe(2);
      expect(body).toContain('u_var_s_5f_eed');
      expect(count(body, '_cse')).toBeGreaterThanOrEqual(6);
    }
  );

  it('javascript is unchanged: the four calls stay', () => {
    const ce = engineWithFBm();
    const r = compile(ce.parse('f_{Bm}(x, y)'), {
      to: 'javascript',
      vars: VARS,
    });
    expect(r.success).toBe(true);
    expect(count(definition(r.preamble, 'f_Bm'), '_fn_p_rand(')).toBe(4);
  });

  function engineWithF(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('x', 'real');
    ce.assign('f', ce.parse('t \\mapsto t^2 + \\sin t'));
    return ce;
  }
  const twice = ['Add', ['f', 'a'], ['Sin', ['f', 'a']]];

  it.each(['glsl', 'wgsl'] as const)(
    '%s: a bare identifier is shared',
    (to) => {
      const ce = engineWithF();
      const r = compile(ce.box(twice as never), { to, vars: { a: 'u_a' } });
      expect(r.success).toBe(true);
      expect(count(r.code, '_fn_f(u_a)')).toBe(1);
    }
  );

  it.each(['glsl', 'wgsl'] as const)(
    '%s: a vars source that is an expression stays opaque',
    (to) => {
      const ce = engineWithF();
      const r = compile(ce.box(twice as never), {
        to,
        vars: { a: 'u.x + 1' },
      });
      expect(r.success).toBe(true);
      expect(count(r.code, '_fn_f(u.x + 1)')).toBe(2);
    }
  );

  const withLocal = (local: string) => [
    'Block',
    ['Declare', local, "'real'"],
    ['Assign', local, ['Add', 'x', 1]],
    ['Add', twice, local],
  ];

  // Before the refusal, `vars: { a: 'k' }` beside a local `k` emitted
  // `_fn_f(k)` after `k = x + 1.0`: every read of `a` gave the local's value.
  it.each(['glsl', 'wgsl'] as const)(
    '%s: a source that names a Block local is refused',
    (to) => {
      const ce = engineWithF();
      const r = compile(ce.box(withLocal('k') as never), {
        to,
        vars: { a: 'k' },
      });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /Could not compile: the `vars` entry for `a` reads the uniform `k`, but the compiled code declares or writes the symbol `k`/
      );
    }
  );

  it.each(['glsl', 'wgsl'] as const)(
    '%s: a source that names a binder variable or a parameter is refused',
    (to) => {
      const ce = engineWithF();
      const sum = compile(
        ce.box(['Sum', ['Add', 'a', 'n'], ['Limits', 'n', 1, 3]] as never),
        { to, vars: { a: 'n' } }
      );
      expect(sum.success).toBe(false);
      expect(sum.error).toMatch(/reads the uniform `n`/);
      // `f`'s parameter `t` is a variable of the emitted `_fn_f`.
      const param = compile(ce.box(['Add', ['f', 'x'], 'a'] as never), {
        to,
        vars: { a: 't' },
      });
      expect(param.success).toBe(false);
      expect(param.error).toMatch(/reads the uniform `t`/);
    }
  );

  it.each(['glsl', 'wgsl'] as const)(
    '%s: a renamed uniform that names no variable compiles and is shared',
    (to) => {
      const ce = engineWithF();
      const r = compile(ce.box(withLocal('m') as never), {
        to,
        vars: { a: 'k' },
      });
      expect(r.success).toBe(true);
      expect(count(r.code, '_fn_f(k)')).toBe(1);
    }
  );

  it.each(['glsl', 'wgsl'] as const)(
    '%s: a self-mapped entry compiles, also when the code writes the symbol',
    (to) => {
      const ce = engineWithF();
      const r = compile(
        ce.box([
          'Block',
          ['Assign', 'a', ['Add', 'a', 1]],
          ['Add', twice, 'a'],
        ] as never),
        { to, vars: { a: 'a' } }
      );
      expect(r.success).toBe(true);
      const plain = compile(ce.box(twice as never), {
        to,
        vars: { a: 'a' },
      });
      expect(plain.success).toBe(true);
      expect(count(plain.code, '_fn_f(a)')).toBe(1);
    }
  );

  it.each(['glsl', 'wgsl'] as const)(
    '%s: a source that names a symbol the code only reads compiles and stays opaque',
    (to) => {
      const ce = engineWithF();
      const r = compile(ce.box(['Add', twice, 'x'] as never), {
        to,
        vars: { a: 'x' },
      });
      expect(r.success).toBe(true);
      expect(count(r.code, '_fn_f(x)')).toBe(2);
    }
  );

  it.each(['glsl', 'wgsl'] as const)(
    '%s: two vars keys with one source stay opaque',
    (to) => {
      const ce = engineWithF();
      const r = compile(ce.box(['Add', twice, 'x'] as never), {
        to,
        vars: { a: 'u_a', x: 'u_a' },
      });
      expect(r.success).toBe(true);
      expect(count(r.code, '_fn_f(u_a)')).toBe(2);
    }
  );

  // A host can pass one `vars` map for many expressions: an entry whose key
  // the code never reads is not refused, even when its source names a local.
  it.each(['glsl', 'wgsl'] as const)(
    '%s: an entry whose key the code does not read is not refused',
    (to) => {
      const ce = engineWithF();
      const r = compile(
        ce.box([
          'Block',
          ['Declare', 'k', "'real'"],
          ['Assign', 'k', ['Add', 'x', 1]],
          ['Add', 'k', 'b'],
        ] as never),
        { to, vars: { a: 'k', b: 'u_b' } }
      );
      expect(r.success).toBe(true);
      expect(r.code).toContain('u_b');
    }
  );

  // An assigned symbol that no `vars` entry maps is compiled as its value,
  // written into the shader, so a binder in that value is a variable of the
  // emitted code. Before the refusal, `w := Sum(k·a, k, 1, 100000)` with
  // `vars: { a: 'k' }` emitted `_tv1 += k * float(k)` inside
  // `for (int k = 1; …)`: the read of `a` gave the loop variable.
  it.each(['glsl', 'wgsl'] as const)(
    '%s: a source that names a binder in the value of an assigned symbol is refused',
    (to) => {
      const ce = engineWithF();
      ce.assign('w', ce.box(['Sum', 'k', ['Limits', 'k', 1, 3]]) as never);
      const small = compile(ce.box(['Add', 'a', 'w'] as never), {
        to,
        vars: { a: 'k' },
      });
      expect(small.success).toBe(false);
      expect(small.error).toMatch(/reads the uniform `k`/);
      ce.assign(
        'v',
        ce.box([
          'Sum',
          ['Multiply', 'k', 'a'],
          ['Limits', 'k', 1, 100000],
        ]) as never
      );
      const loop = compile(ce.box(['Add', 'v', 'x'] as never), {
        to,
        vars: { a: 'k' },
      });
      expect(loop.success).toBe(false);
      expect(loop.error).toMatch(/reads the uniform `k`/);
    }
  );

  it('javascript: a bare identifier stays opaque', () => {
    const ce = engineWithF();
    const r = compile(ce.box(twice as never), {
      to: 'javascript',
      vars: { a: 'u_a' },
    });
    expect(r.success).toBe(true);
    expect(count(r.code, '(u_a)')).toBe(2);
  });
});
