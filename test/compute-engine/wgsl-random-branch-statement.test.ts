/**
 * On `wgsl`, a piecewise whose branch draws a random value compiles to an
 * `if` statement, so that only the branch that is taken draws, as in the
 * interpreter and in the GLSL `?:` (Tycho row 466). WGSL `select` computes
 * every branch, and a draw in the branch that is not taken advanced the
 * random stream and shifted every later draw, so such a selection declined.
 *
 * The `if` is hoisted ahead of the rest of its statement
 * (`compileGPUStatementSelection`, `compilation/gpu-target.ts`). Alone, it
 * keeps the order of draws only when nothing else in the statement draws,
 * and when each branch draws at most once. Every other shape is compiled a
 * second time with each draw bound to a temporary of its own, at the point
 * it is compiled, so that the draws run in the interpreter's order
 * (`gpuRecompileWithBoundDraws`, `compilation/gpu-target.ts`). A statement that still
 * declines: a draw that stays in its expression (the lazy operand of `And`)
 * before a draw that is bound, and a call of a function whose body draws.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { gpuDrawCount } from '../../src/compute-engine/compilation/gpu-target';

const ce = new ComputeEngine();
ce.declare('s', 'real');
ce.declare('x', 'real');

const W = ['Which', ['Less', 'x', 0], ['Random'], 'True', 0];

function wgsl(expr: unknown): string {
  const r = compile(ce.box(expr as never), {
    to: 'wgsl',
    fallback: false,
  } as never);
  expect(r.success).toBe(true);
  return r.code!;
}

const draws = (code: string): number => code.split('_gpu_rnd_draw(').length - 1;

describe('a WGSL branch that draws once takes the `if` form', () => {
  it('a piecewise alone in its statement', () => {
    const code = wgsl(['WithRandomSeed', 's', W]);
    expect(code).toMatch(
      /^var _tv\d+: f32;\nif \(x < 0\.0\) \{\n  _tv\d+ = _gpu_rnd_draw\(/
    );
    expect(code).not.toContain('select(');
    expect(draws(code)).toBe(1);
  });

  it('a piecewise inside an expression that does not draw', () => {
    const code = wgsl(['WithRandomSeed', 's', ['Add', 1, W]]);
    expect(code).toContain('if (x < 0.0) {');
    expect(code).toMatch(/return \(_tv\d+ \+ 1\.0\);$/);
    expect(draws(code)).toBe(1);
  });

  it('each branch draws once', () => {
    const code = wgsl([
      'WithRandomSeed',
      's',
      ['If', ['Less', 'x', 0], ['Multiply', 2, ['Random']], ['Random']],
    ]);
    expect(code).toContain('} else {');
    expect(draws(code)).toBe(2);
    expect(code).not.toContain('select(');
  });
});

/** The lines of `code` that draw, with the draw call written `DRAW`. */
const drawLines = (code: string): string[] =>
  code
    .split('\n')
    .filter((line) => line.includes('_gpu_rnd_draw('))
    .map((line) => line.trim().replace(/_gpu_rnd_draw\(.*\)(?=;$)/, 'DRAW'));

describe('other shapes bind every draw in order on WGSL', () => {
  it('another part of the statement draws too', () => {
    // The canonical `Add` puts the selection first, so the `if` draws first.
    for (const expr of [
      ['Add', ['Random'], W],
      ['Add', W, ['Random']],
    ]) {
      const code = wgsl(['WithRandomSeed', 's', expr]);
      expect(code).toMatch(
        /^var _tv1: f32;\nif \(x < 0\.0\) \{\n  let _tv2: f32 = _gpu_rnd_draw\(.*\n  _tv1 = _tv2;\n\} else \{\n  _tv1 = 0\.0;\n\}\nlet _tv3: f32 = _gpu_rnd_draw\(.*\nreturn \(_tv1 \+ _tv3\);$/
      );
    }
    // In a tuple, the draw written first runs first.
    const code = wgsl(['WithRandomSeed', 's', ['Tuple', ['Random'], W]]);
    expect(drawLines(code)).toEqual([
      'let _tv1: f32 = DRAW;',
      'let _tv3: f32 = DRAW;',
    ]);
    expect(code.indexOf('let _tv1')).toBeLessThan(code.indexOf('if ('));
    expect(code).toMatch(/return vec2f\(_tv1, _tv2\);$/);
  });

  it('the same draw node stands in a branch and in a sibling', () => {
    // One `Random()` object at two places is two draws.
    const r = ce.box(['Random']);
    const expr = ce.function('WithRandomSeed', [
      ce.symbol('s'),
      ce.function('Tuple', [
        r,
        ce.function('If', [ce.box(['Less', 'x', 0]), r, ce.number(0)]),
      ]),
    ]);
    const result = compile(expr, { to: 'wgsl', fallback: false } as never);
    expect(result.success).toBe(true);
    expect(drawLines(result.code!)).toEqual([
      'let _tv1: f32 = DRAW;',
      'let _tv3: f32 = DRAW;',
    ]);
  });

  it('a branch draws twice', () => {
    // `Cot` uses its operand twice, so its `Random()` is bound to a
    // temporary; the first `Random()` of the tuple is bound before it.
    const code = wgsl([
      'WithRandomSeed',
      's',
      [
        'If',
        ['Less', 'x', 0],
        ['Tuple', ['Random'], ['Cot', ['Random']]],
        ['Tuple', 0, 0],
      ],
    ]);
    expect(drawLines(code)).toEqual([
      'let _tv2: f32 = DRAW;',
      'let _tv4: f32 = DRAW;',
    ]);
    expect(code).toContain(
      '_tv1 = vec2f(_tv2, (_gpu_cos(_tv3) / _gpu_sin(_tv3)));'
    );
  });
});

describe('the draw count on a tree with shared nodes', () => {
  it('stays linear: a tower of shared Max nodes', () => {
    // Each level names the level below twice: 2^30 paths, 31 distinct
    // nodes. Tested on the count directly: a full compile of such a tower
    // emits text that doubles at each level, for a reason unrelated to the
    // count.
    let e = ce.box(['Add', 'x', 1]);
    for (let i = 0; i < 30; i++) e = ce.function('Max', [e, e]);
    expect(gpuDrawCount(e)).toBe(0);
    const r = ce.box(['Random']);
    let d = ce.function('Add', [r, 1]);
    for (let i = 0; i < 30; i++) d = ce.function('Max', [d, d]);
    // Each occurrence counts: 2^30 occurrences of one draw node.
    expect(gpuDrawCount(d)).toBe(2 ** 30);
  });

  it('counts the draw of a node whose operand draws too', () => {
    expect(gpuDrawCount(ce.box(['Random', ['Interval', 0, ['Random']]]))).toBe(
      2
    );
    expect(gpuDrawCount(ce.box(['WithRandomSeed', 's', ['Random']]))).toBe(1);
  });
});

describe('a draw bound to a temporary keeps the order of the draws', () => {
  // A lowering that uses an impure operand twice (`Cot`) binds it to a
  // temporary ahead of its statement. When a draw written before the operand
  // stays in the statement, the statement is compiled again with every draw
  // bound in order.
  const glsl = (expr: unknown): string => {
    const r = compile(ce.box(['WithRandomSeed', 's', expr] as never), {
      to: 'glsl',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    return r.code!;
  };

  it('binds a draw written before the operand first', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      const r = compile(
        ce.box([
          'WithRandomSeed',
          's',
          ['Tuple', ['Random'], ['Cot', ['Random']]],
        ] as never),
        { to, fallback: false } as never
      );
      expect(r.success).toBe(true);
      const decl = to === 'wgsl' ? 'let _tv%: f32' : 'float _tv%';
      expect(drawLines(r.code!)).toEqual([
        `${decl.replace('%', '1')} = DRAW;`,
        `${decl.replace('%', '3')} = DRAW;`,
      ]);
      expect(r.code!).toMatch(/return vec2f?\(_tv1, \(_gpu_cos\(_tv2\)/);
    }
  });

  it('declines when a draw that stays in its expression comes first', () => {
    // The second operand of `And` is evaluated only when the first is true,
    // so its draw stays in the expression and runs after the bound draws.
    expect(() =>
      compile(
        ce.box([
          'WithRandomSeed',
          's',
          [
            'Tuple',
            ['If', ['And', ['Less', 'x', 0], ['Less', ['Random'], 0.5]], 1, 0],
            ['Cot', ['Random']],
          ],
        ] as never),
        { to: 'glsl', fallback: false } as never
      )
    ).toThrow(/a draw written before it/);
  });

  it('compiles when the bound operand is drawn first', () => {
    const code = glsl(['Tuple', ['Cot', ['Random']], ['Random']]);
    expect(code).toMatch(
      /^float _tv1 = _gpu_rnd_draw\(.*\);\nreturn vec2\(\(_gpu_cos\(_tv1\) \/ _gpu_sin\(_tv1\)\), _gpu_rnd_draw\(/
    );
  });

  it('compiles when every draw is bound, in order', () => {
    const code = glsl([
      'Variance',
      ['List', ['Random'], ['Random'], ['Random']],
    ]);
    expect(code.split('\n').slice(0, 3)).toEqual([
      expect.stringMatching(/^float _tv1 = _gpu_rnd_draw\(/),
      expect.stringMatching(/^float _tv2 = _gpu_rnd_draw\(/),
      expect.stringMatching(/^float _tv3 = _gpu_rnd_draw\(/),
    ]);
  });
});

describe('statements hoisted ahead of the statement keep the order of the draws', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('s', 'real');
  ce2.declare('n', 'integer');
  ce2.declare('f', 'function');
  ce2.assign('f', ce2.parse(String.raw`t \mapsto t + \operatorname{Random}()`));
  const run = (expr: ReturnType<typeof ce2.box>) =>
    compile(expr, { to: 'glsl', fallback: false } as never);

  it('binds the same draw node at each place it stands', () => {
    const r = ce2.box(['Random']);
    const expr = ce2.function('WithRandomSeed', [
      ce2.symbol('s'),
      ce2.function('Tuple', [r, ce2.function('Cot', [r])]),
    ]);
    const result = run(expr);
    expect(result.success).toBe(true);
    expect(drawLines(result.code!)).toEqual([
      'float _tv1 = DRAW;',
      'float _tv3 = DRAW;',
    ]);
  });

  it('declines when a call whose body draws comes before the binding', () => {
    expect(() =>
      run(
        ce2.box([
          'WithRandomSeed',
          's',
          ['Tuple', ['f', ['Cot', ['Random']]], ['Cot', ['Random']]],
        ])
      )
    ).toThrow(/a draw written before it/);
  });

  it('binds the draws of a Sum after an earlier draw', () => {
    // Unrolled: the draw of each term is bound in turn.
    const unrolled = run(
      ce2.box([
        'WithRandomSeed',
        's',
        [
          'Tuple',
          ['Random'],
          ['Sum', ['Cot', ['Random']], ['Limits', 'k', 1, 2]],
        ],
      ])
    );
    expect(drawLines(unrolled.code!)).toEqual([
      'float _tv2 = DRAW;',
      'float _tv4 = DRAW;',
      'float _tv7 = DRAW;',
    ]);
    // A loop: the draw before the loop is bound ahead of it, and the draw of
    // the body is bound inside it.
    const loop = run(
      ce2.box([
        'WithRandomSeed',
        's',
        ['Tuple', ['Random'], ['Sum', ['Random'], ['Limits', 'k', 1, 'n']]],
      ])
    );
    expect(loop.code!).toMatch(
      /^float _tv\d+ = _gpu_rnd_draw\(.*\nfloat _tv\d+ = 0\.0;\nfor \(.*\n  float _tv\d+ = _gpu_rnd_draw\(/
    );
  });

  it('compiles a loop that draws before the other draws of its statement', () => {
    const r = run(
      ce2.box([
        'WithRandomSeed',
        's',
        ['Tuple', ['Sum', ['Random'], ['Limits', 'k', 1, 'n']], ['Random']],
      ])
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('for (');
  });
});

describe('the round-3 shapes', () => {
  const ce3 = new ComputeEngine();
  ce3.declare('s', 'real');
  ce3.declare('x', 'real');
  ce3.declare('r', 'real');
  ce3.assign('r', ce3.box(['Random']));
  const glsl = (expr: unknown) =>
    compile(ce3.box(['WithRandomSeed', 's', expr] as never), {
      to: 'glsl',
      fallback: false,
    } as never);
  const draws = (code: string) => code.split('_gpu_rnd_draw(').length - 1;

  it('a nested binding still sees its own draw', () => {
    const r = glsl(['Tuple', ['Cot', ['Cot', ['Random']]], ['Random']]);
    expect(r.success).toBe(true);
    expect(draws(r.code!)).toBe(2);
  });

  it('a value block that draws after an earlier draw binds both in order', () => {
    const r = glsl([
      'Tuple',
      ['Random'],
      ['Block', ['Declare', 'a', 'real', ['Random']], ['Add', 'a', 1]],
    ]);
    expect(r.success).toBe(true);
    expect(drawLines(r.code!)).toEqual([
      'float _tv1 = DRAW;',
      'float _tv2 = DRAW;',
    ]);
    expect(r.code!.indexOf('float _tv1')).toBeLessThan(r.code!.indexOf('{'));
  });

  it('a symbol whose value draws is bound once, and in order', () => {
    const r = glsl(['Cot', 'r']);
    expect(draws(r.code!)).toBe(1);
    const t = glsl(['Tuple', ['Random'], ['Cot', 'r']]);
    expect(drawLines(t.code!)).toEqual([
      'float _tv1 = DRAW;',
      'float _tv3 = DRAW;',
    ]);
  });

  it('a pure first operand does not anchor the order check', () => {
    const r = glsl([
      'Tuple',
      ['Remainder', 'x', ['Random']],
      ['Multiply', 'x', ['Random']],
    ]);
    expect(r.success).toBe(true);
    expect(draws(r.code!)).toBe(2);
  });
});

describe('the second compilation with every draw bound', () => {
  const glsl = (expr: unknown) =>
    compile(ce.box(['WithRandomSeed', 's', expr] as never), {
      to: 'glsl',
      fallback: false,
    } as never);

  it('declares a temporary of common subexpressions the first attempt bound', () => {
    // The first attempt binds the repeated `sin` tower to a temporary, then
    // declines; its declaration was in the discarded statements, so the
    // second attempt must declare it again.
    let u: unknown = 'x';
    for (let i = 0; i < 7; i++) u = ['Sin', u];
    const code = glsl(['Tuple', u, u, ['Random'], ['Cot', ['Random']]]).code!;
    const name = code.match(/return vec4\((_cse\d+),/)?.[1];
    expect(name).toBeDefined();
    expect(code).toContain(`float ${name} = `);
  });

  it('declines when a lowering binds a later operand first', () => {
    // `Round` with a step binds the step before the value, and `Root`
    // compiles its degree before its radicand.
    expect(() =>
      glsl(['Round', ['Multiply', 2, ['Random']], ['Multiply', 3, ['Random']]])
    ).toThrow(/a draw written before it/);
    expect(() =>
      glsl([
        'Tuple',
        ['Random'],
        ['Cot', ['Random']],
        ['Root', ['Multiply', 2, ['Random']], ['Multiply', 3, ['Random']]],
      ])
    ).toThrow(/a draw written before it/);
  });

  it('declines a draw after a draw that stays in its expression', () => {
    // Both draws are in the lazy operand of `And`, so neither is bound, but
    // the loop of the `Sum` is hoisted ahead of the tuple and would draw
    // first.
    ce.declare('n', 'integer');
    expect(() =>
      glsl([
        'Tuple',
        ['If', ['And', ['Less', 'x', 0], ['Less', ['Random'], 0.5]], 1, 0],
        [
          'Sum',
          ['If', ['And', ['Less', 'k', 2], ['Less', ['Random'], 0.5]], 1, 0],
          ['Limits', 'k', 1, 'n'],
        ],
      ])
    ).toThrow(/a draw written before it/);
  });

  it('declines when a lowering compiles its operands out of order', () => {
    // `Root` compiles its degree before its radicand, so the draw of the
    // degree would be bound first.
    expect(() =>
      glsl([
        'Tuple',
        ['Random'],
        ['Root', ['Exp', ['Random']], ['Random']],
        ['Cot', ['Random']],
      ])
    ).toThrow(/a draw written before it/);
  });
});
