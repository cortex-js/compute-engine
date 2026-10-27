/**
 * On `wgsl`, a piecewise whose branch draws a random value compiles to an
 * `if` statement, so that only the branch that is taken draws, as in the
 * interpreter and in the GLSL `?:` (Tycho row 466). WGSL `select` computes
 * every branch, and a draw in the branch that is not taken advanced the
 * random stream and shifted every later draw, so such a selection declined.
 *
 * The `if` is hoisted ahead of the rest of its statement
 * (`compileGPUStatementSelection`, `compilation/gpu-target.ts`). It keeps
 * the order of draws only when nothing else in the statement draws, and when
 * each branch draws at most once: a branch's own hoisted statements run
 * before the rest of the branch, so a second draw could change places with
 * the first. Every other shape still declines.
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

describe('other shapes still decline on WGSL', () => {
  const declines = (expr: unknown) =>
    expect(() =>
      compile(ce.box(expr as never), { to: 'wgsl', fallback: false } as never)
    ).toThrow(/a branch draws a random value/);

  it('another part of the statement draws too', () => {
    declines(['WithRandomSeed', 's', ['Add', ['Random'], W]]);
    declines(['WithRandomSeed', 's', ['Add', W, ['Random']]]);
  });

  it('the same draw node stands in a branch and in a sibling', () => {
    // One `Random()` object at two places is two draws; the check counts
    // occurrences, so the sibling's draw is seen.
    const r = ce.box(['Random']);
    const expr = ce.function('WithRandomSeed', [
      ce.symbol('s'),
      ce.function('Tuple', [
        r,
        ce.function('If', [ce.box(['Less', 'x', 0]), r, ce.number(0)]),
      ]),
    ]);
    expect(() =>
      compile(expr, { to: 'wgsl', fallback: false } as never)
    ).toThrow(/a branch draws a random value/);
  });

  it('a branch draws twice', () => {
    // `Cot` uses its operand twice, so its `Random()` is bound to a
    // temporary, which would run before the first `Random()` of the tuple.
    declines([
      'WithRandomSeed',
      's',
      [
        'If',
        ['Less', 'x', 0],
        ['Tuple', ['Random'], ['Cot', ['Random']]],
        ['Tuple', 0, 0],
      ],
    ]);
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
  // temporary ahead of its statement. That keeps the order only when no draw
  // written before the operand stays in the statement.
  const glsl = (expr: unknown): string => {
    const r = compile(ce.box(['WithRandomSeed', 's', expr] as never), {
      to: 'glsl',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    return r.code!;
  };

  it('declines when a draw written before the operand stays inline', () => {
    for (const to of ['glsl', 'wgsl'] as const)
      expect(() =>
        compile(
          ce.box([
            'WithRandomSeed',
            's',
            ['Tuple', ['Random'], ['Cot', ['Random']]],
          ] as never),
          { to, fallback: false } as never
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

  it('declines when the same draw node stands before the bound operand', () => {
    const r = ce2.box(['Random']);
    const expr = ce2.function('WithRandomSeed', [
      ce2.symbol('s'),
      ce2.function('Tuple', [r, ce2.function('Cot', [r])]),
    ]);
    expect(() => run(expr)).toThrow(/a draw written before it/);
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

  it('declines a Sum whose hoisted statements draw after an earlier draw', () => {
    for (const sum of [
      ['Sum', ['Cot', ['Random']], ['Limits', 'k', 1, 2]],
      ['Sum', ['Random'], ['Limits', 'k', 1, 'n']],
    ])
      expect(() =>
        run(ce2.box(['WithRandomSeed', 's', ['Tuple', ['Random'], sum]]))
      ).toThrow(/a draw written before it/);
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

  it('a value block that draws after an earlier draw declines', () => {
    expect(() =>
      glsl([
        'Tuple',
        ['Random'],
        ['Block', ['Declare', 'a', 'real', ['Random']], ['Add', 'a', 1]],
      ])
    ).toThrow(/a draw written before it/);
  });

  it('a symbol whose value draws is bound once, and in order', () => {
    const r = glsl(['Cot', 'r']);
    expect(draws(r.code!)).toBe(1);
    expect(() => glsl(['Tuple', ['Random'], ['Cot', 'r']])).toThrow(
      /a draw written before it/
    );
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
