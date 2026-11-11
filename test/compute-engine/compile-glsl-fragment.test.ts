/**
 * CE-1166.3, phase B: `canCompile()` types the prepared tree with the GLSL
 * fragment and returns a diagnostic for the first node outside it.
 *
 * The fragment is the positive list of
 * `docs/plans/2026-11-08-glsl-fragment-spec.md`, section 2. Each line of
 * the list has one case in and one case out here. The walk rules are those
 * of `docs/plans/2026-11-08-glsl-fragment-annotation-design.md`, section 4.
 *
 * `compile()` to `glsl` runs the same pass first (phase C): an expression
 * outside the fragment declines with the `outside-fragment` diagnostic, and
 * an expression inside it compiles (`expectIn()` checks both).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  canCompile,
  compile,
} from '../../src/compute-engine/compilation/compile-expression';
import { canCompile as canCompileFromEntry } from '../../src/compile';
import {
  fragmentFactsOf,
  typeFragment,
} from '../../src/compute-engine/compilation/fragment';
import type {
  CanCompileResult,
  FragmentDefinition,
} from '../../src/compute-engine/compilation/fragment';
import { glslFragmentDefinition } from '../../src/compute-engine/compilation/glsl-fragment';
import type { GlslRepresentation } from '../../src/compute-engine/compilation/glsl-fragment';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('n', 'integer');
ce.declare('z', 'complex');
ce.declare('w', 'complex');
ce.declare('p', 'tuple<real, real, real>');
ce.declare('q2', 'tuple<real, real>');
ce.declare('c', 'color');
ce.declare('b', 'boolean');
ce.declare('a', 'any');
ce.declare('e', 'expression');
ce.declare('L', 'list<real^5>');
ce.declare('Big', 'list<real^1600>');
ce.declare('M', 'matrix<real^2x2>');
ce.declare('P5', 'tuple<real, real, real, real, real>');

expect(
  executeEpsil(
    ce,
    [
      // The escape-time loop of the showcase entry `burning-ship`.
      'function B(x: real, y: real) -> real {',
      '  let a = 0',
      '  let b = 0',
      '  let n = 0',
      '  for k in 1..128 {',
      '    const t = a*a - b*b + x',
      '    b = 2*abs(a*b) + y',
      '    a = t',
      '    n = k',
      '    if a*a + b*b > 65536 { break }',
      '  }',
      '  if n < 128 { n } else { 0 }',
      '}',
      // A `parallel for` with a scalar accumulator.
      'function S(x: real) -> real {',
      '  let s = 0',
      '  parallel for k in 1..10 { s += k * x }',
      '  s',
      '}',
      // Locals declared inside a branch.
      'function C(x: real, y: real) -> real {',
      '  if x < 0 {',
      '    const u = x * 2',
      '    const v = u + y',
      '    v',
      '  } else {',
      '    y',
      '  }',
      '}',
      'function g(H: list<integer>, x: real) -> real { H[1600] * x }',
      'function g5(H: list<real>, x: real) -> real { H[1] * x }',
      'function sq(x: real) -> real { x * x }',
      'function r(x: real) -> real { if x < 1 { x } else { r(x - 1) } }',
      'function cz(t: complex) -> complex { t * t }',
      // The showcase entry `multibrot` (Tycho,
      // `src/graph-paper/onboarding/template-data.js`), as `MB`: `M` is a
      // matrix input of these tests.
      'function MB(p: real, q: real, d: real) -> real {',
      '  let a = p',
      '  let b = q',
      '  let n = 1',
      '  let s = 0.0',
      '  let t = 0.0',
      '  let w = 0.0',
      '  let r = 0.0',
      '  for k in 1..128 {',
      '    s = a^2 + b^2',
      '    if s > 4096 { break }',
      '    n = n + 1',
      '    w = if s > 0 { d * arctan2(b, a) } else { 0.0 }',
      '    r = s^(d/2)',
      '    t = r * cos(w) + p',
      '    b = r * sin(w) + q',
      '    a = t',
      '  }',
      '  s = a^2 + b^2',
      '  if s <= 4096 { 1 } else { min(1, (n + 1 - ln(ln(s) / ln(4096)) / ln(d)) / 128) }',
      '}',
      // The showcase entry `julia-set`: the value and the colour functions
      // (`channel` keeps two of the gradient segments of each branch).
      'function J(p: real, q: real, u: real, v: real) -> real {',
      '  const cr = 0.7885 * u',
      '  const ci = 0.7885 * v',
      '  let a = p',
      '  let b = q',
      '  let n = 0',
      '  let s = 0.0',
      '  let t = 0.0',
      '  let d = 1.0',
      '  for k in 1..256 {',
      '    s = a^2 + b^2',
      '    if s > 65536 { break }',
      '    n = n + 1',
      '    t = a^2 - b^2 + cr',
      '    b = 2*a*b + ci',
      '    a = t',
      '    d = min(d, abs(a), abs(b))',
      '  }',
      '  s = a^2 + b^2',
      '  if s <= 65536 {',
      '    -2 + min(1, ln(max(d, 0.0001) / 0.0001) / ln(300))',
      '  } else {',
      '    0.18 * ln(max(n + 1 - ln(ln(s) / ln(65536)) / ln(2), 3.7) / 3.7)^1.6',
      '  }',
      '}',
      'function pick(ch: integer, r: real, g: real, b: real) -> real {',
      '  if ch == 1 { r } else { if ch == 2 { g } else { b } }',
      '}',
      'function seg(w: real, a: real, b: real, c0: real, c1: real) -> real {',
      '  const u = (w - a) / (b - a)',
      '  if w < a { 0 } else { if w >= b { 0 } else { c0 + (c1 - c0) * u * u * (3 - 2*u) } }',
      '}',
      'function channel(z: real, ch: integer) -> real {',
      '  const w = z - floor(z)',
      '  const f = -1 - z',
      '  if z < 0 {',
      '    (seg(f, 0, 0.25, pick(ch, 48, 18, 3), pick(ch, 120, 56, 12))',
      '      + seg(f, 0.25, 0.6, pick(ch, 120, 56, 12), pick(ch, 235, 165, 62))) / 255',
      '  } else {',
      '    (seg(w, 0, 0.16, pick(ch, 0, 7, 100), pick(ch, 32, 107, 203))',
      '      + seg(w, 0.16, 0.42, pick(ch, 32, 107, 203), pick(ch, 237, 255, 255))) / 255',
      '  }',
      '}',
      'function shade(z: real) -> color {',
      '  rgb(channel(z, 1), channel(z, 2), channel(z, 3))',
      '}',
      // The colour formula of the showcase entry `buddhabrot`.
      'function tone(v: real, lo: real) -> real { min(1, max(lo, max(0, v)^1.5)) }',
      'function cb(H: list<integer>, x: real, y: real, z: real) -> color {',
      '  if 0 <= x && x < 150 && 0 <= y && y < 200 {',
      '    const i = floor(x) + 150 * floor(y)',
      '    const n = 1 + H[90001]',
      '    rgb(tone(z, 0.1),',
      '        tone(1700 * H[max(30001, min(60000, 30001 + i))] / n, 0.16),',
      '        tone(3600 * H[max(60001, min(90000, 60001 + i))] / n, 0.33))',
      '  } else {',
      '    rgb(0.1, 0.16, 0.33)',
      '  }',
      '}',
    ].join('\n')
  ).diagnostics
).toEqual([]);
ce.declare('H', 'list<real^1600>');
ce.declare('H90', 'list<integer^90001>');

/** The attributes of a `Declare` with the value `value` (Epsil's `let`). */
function valueOf(value: unknown): unknown {
  return ['Dictionary', ['KeyValuePair', { str: 'value' }, value]];
}

function check(json: unknown, options: Record<string, unknown> = {}) {
  return canCompile(ce.box(json as any), { to: 'glsl', ...options });
}

/** In: `canCompile()` answers yes, and `compile()` gives code. */
function expectIn(json: unknown, options: Record<string, unknown> = {}) {
  expect(check(json, options)).toEqual({ ok: true });
  const result = compile(ce.box(json as any), {
    to: 'glsl',
    fallback: false,
    ...options,
  });
  expect(result.success).toBe(true);
}

function expectOut(
  json: unknown,
  operator?: string,
  options: Record<string, unknown> = {}
): CanCompileResult & { ok: false } {
  const r = check(json, options);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('unreachable');
  expect(r.diagnostic.code).toBe('outside-fragment');
  expect(r.diagnostic.kind).toBe('capability');
  if (operator !== undefined) expect(r.diagnostic.operator).toBe(operator);
  return r;
}

describe('values and types', () => {
  test.each([
    ['real', ['Add', 'x', 1]],
    ['integer', ['Add', 'n', 1]],
    ['boolean', ['And', 'b', ['Less', 'x', 1]]],
    ['complex', ['Multiply', 'z', 'w']],
    ['point of 3 components', ['Dot', 'p', 'p']],
    ['color', ['AsOklab', 'c']],
    ['constant list', ['At', ['List', 1, 2, 3, 4, 5, 6], ['Floor', 'x']]],
    ['list input of 5 reals', ['At', 'L', 2]],
  ])('%s is in', (_, json) => expectIn(json));

  test('a list input in a texture (`storage`) is in, with no limit', () =>
    expectIn(['Multiply', ['At', 'H', ['Floor', 'x']], 2], {
      storage: { H: 'sampler2D' },
    }));

  test('a list input of 1,600 reals, not in a texture, is out (a limit)', () => {
    const r = expectOut(['At', 'Big', 2]);
    expect(r.diagnostic.binding).toBe('Big');
    expect(r.diagnostic.message).toMatch(/1600 elements/);
  });

  test('a matrix is out', () => {
    const r = expectOut(['At', 'M', 1, 1]);
    expect(r.diagnostic.operator).toBe('At');
  });

  test('a point of 5 components is out', () => {
    const r = expectOut(['PointX', 'P5']);
    expect(r.diagnostic.binding).toBe('P5');
  });

  test.each([
    ['any', 'a'],
    ['expression', 'e'],
  ])('a symbol of the type `%s` is out, and the diagnostic names it', (t, name) => {
    const r = expectOut(['Sin', name]);
    expect(r.diagnostic.binding).toBe(name);
    expect(r.diagnostic.operator).toBeUndefined();
    expect(r.diagnostic.message).toContain(`\`${t}\``);
    expect(r.diagnostic.message).toContain(`declare a numeric type for \`${name}\``);
  });

  test('the `vars` option is spelling: the predicate accepts it', () =>
    expectIn(['Add', 'x', 'y'], { vars: { x: 'v_pos.x', y: 'u_y' } }));
});

describe('heads', () => {
  test.each([
    ['arithmetic', ['Mod', ['Hypot', 'x', 'y'], ['Clamp', 'x', 0, 1]]],
    ['elementary and special functions', ['Add', ['Gamma', 'x'], ['Arctan2', 'y', 'x'], ['Erf', 'x']]],
    ['complex', ['Add', ['Real', ['Exp', 'z']], ['Argument', 'w']]],
    ['colors', ['ColorMix', 'c', ['Rgb', 'x', 0.5, 0.2], 0.3]],
    ['comparison and logic', ['Or', ['Less', 'x', 'y'], ['Not', 'b']]],
    ['selection', ['Which', ['Less', 'x', 0], 1, 'True', ['If', 'b', 'x', 'y']]],
    ['aggregates with a bound in an input', ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']]],
    ['nested aggregates, a bound on an outer index', ['Sum', ['Product', 'j', ['Limits', 'j', 1, 'k']], ['Limits', 'k', 1, 'n']]],
    ['indexing with a computed index', ['At', 'p', ['Add', ['Floor', 'x'], 1]]],
  ])('%s: in', (_, json) => expectIn(json));

  const pointsAndVectors = [
    'Dot',
    ['Normalize', 'p'],
    ['Cross', 'p', ['Tuple', 0, 0, 1]],
  ];
  // `Normalize` and `Cross` of a point of 3 components are points of 3
  // components, so `dot` takes two `vec3`.
  test('points and vectors: in', () => expectIn(pointsAndVectors));
  test('`Length` of a point is its static count', () => {
    expectIn(['Length', 'p']);
    expect(compile(ce.box(['Length', 'p']), { to: 'glsl' }).code).toBe('3.0');
  });

  test.each([
    ['arithmetic on a boolean', ['Max', 'b', 1], 'Max'],
    ['a special function on a complex operand', ['Gamma', 'z'], 'Gamma'],
    ['a complex operand where only a real is accepted', ['Floor', 'z'], 'Floor'],
    ['a point whose component is a point', ['Tuple', 'p', 1], 'Tuple'],
    ['a colour from a complex number', ['Rgb', 'z', 0, 0], 'Rgb'],
    ['an ordering comparison of a complex number', ['Less', 'z', 'x'], 'Less'],
    ['branches of two types', ['If', 'b', 'x', 'p'], 'If'],
    ['an aggregate with a boolean body', ['Sum', ['Less', 'k', 'x'], ['Limits', 'k', 1, 10]], 'Sum'],
    ['a scalar where GLSL has no float overload: mod(float, vec3)', ['Mod', 1, 'p'], 'Mod'],
    ['a colour with an alpha channel', ['Rgb', 'x', 0, 0, 0.5], 'Rgb'],
    ['a colour string that is not a colour', ['Color', { str: 'bogus' }], 'Color'],
    ['Binomial with a second operand that is not a literal', ['Binomial', 'x', 'n'], 'Binomial'],
    ['an aggregate with a constant bound outside the loop counter', ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 2147483647]], 'Sum'],
  ])('%s: out', (_, json, operator) => {
    expectOut(json, operator);
  });

  test('the innermost cause is named: `Add(Integrate(…), 1)` reports `Integrate`', () => {
    const r = expectOut(['Add', ['Integrate', ['Sin', 'x'], 'x'], 1], 'Integrate');
    expect(r.diagnostic.value).toContain('int');
  });

  test.each([
    ['Loop', ['Loop', ['Add', 'x', 1]]],
    ['Map', ['Map', 'L', ['Function', ['Add', 't', 1], 't']]],
    ['Random', ['Add', ['Random'], 'x']],
    ['Integrate', ['Integrate', ['Sin', 'x'], 'x']],
    ['D with no closed form', ['D', ['unknownFn', 'x'], 'x']],
    ['a string', ['Add', 'x', { str: 'a' }]],
  ])('%s is out', (_, json) => {
    expectOut(json);
  });
});

describe('Range', () => {
  const sumOverRange = [
    'Sum',
    ['Multiply', 'k', 'x'],
    ['Element', 'k', ['Range', 1, 'n']],
  ];
  test('a Range is in as the index set of a Sum', () =>
    expectIn(sumOverRange));
  test('a Range with a step is out as the index set of a Sum', () => {
    expectOut(
      ['Sum', ['Multiply', 'k', 'x'], ['Element', 'k', ['Range', 1, 'n', 2]]],
      'Element'
    );
  });
  test('a Range is out as a value', () => {
    const r = expectOut(['Add', ['Range', 1, 'n'], 'x']);
    expect(r.diagnostic.operator).toBe('Range');
  });
});

describe('calls of user functions', () => {
  test('a call of a function with an expression body is in', () =>
    expectIn(['Add', ['sq', 'x'], ['sq', 'y']]));
  test('a real argument at a complex parameter is in', () =>
    expectIn(['cz', 'x']));
  test('a recursive function is out (a limit)', () => {
    const r = expectOut(['r', 'x']);
    expect(r.diagnostic.message).toMatch(/calls itself/);
  });
  test('an argument of the wrong type is out', () => {
    expectOut(['sq', 'p']);
  });
});

describe('the body of a user function', () => {
  test('a scalar block with a counted loop and `break` is in (burning-ship)', () =>
    expectIn(['B', 'x', 'y']));
  test('locals declared inside a branch are in', () =>
    expectIn(['C', 'x', 'y']));
  // The shader runs the passes of a `parallel for` in order, as a counted
  // loop.
  test('a parallel loop with a scalar accumulator is in', () =>
    expectIn(['S', 'x']));
  test('a list parameter bound to a list input in a texture is in', () =>
    expectIn(['g', 'H', 'x'], { storage: { H: 'sampler2D' } }));
  test('a list parameter bound to a list that is not in a texture is out', () => {
    expectOut(['g', 'H', 'x']);
  });
  test('a block at the root of the expression is in (decision 13)', () =>
    expectIn(['Block', ['Declare', 't', valueOf('x')], ['Add', 't', 1]]));
  test('`Break` outside a loop is out', () => {
    ce.assign(
      'brk',
      ce.box(['Function', ['Block', ['Break'], 'u'], ['Typed', 'u', "'real'"]])
    );
    expectOut(['brk', 'x'], 'Break');
  });
  test('an assignment to a parameter is out', () => {
    ce.assign(
      'asg',
      ce.box(['Function', ['Block', ['Assign', 'u', 1], 'u'], ['Typed', 'u', "'real'"]])
    );
    const r = expectOut(['asg', 'x'], 'Assign');
    expect(r.diagnostic.message).toMatch(/not a local/);
  });
  test('a refusal in a body names the function', () => {
    ce.assign(
      'integ',
      ce.box(['Function', ['Integrate', ['Sin', 't'], 't'], ['Typed', 't', "'real'"]])
    );
    const r = expectOut(['integ', 'x']);
    expect(r.diagnostic.message).toMatch(/user function `integ`/);
  });
});

describe('a read of a block local before its declaration', () => {
  // `Function(Block(Declare(s, k + 1), Declare(k, 2), s), …)`: the first
  // declaration reads `k`, which the block declares after it.
  const body = [
    'Block',
    ['Declare', 's', valueOf(['Add', 'k', 1])],
    ['Declare', 'k', valueOf(2)],
    's',
  ];
  // The engine refuses such a body when it defines the function (the error
  // `read-before-declaration`), so a canonical body never reaches the pass
  // with it. The rule of the pass is a second guard: it is tested on the
  // body as written, assembled from canonical parts with no check of the
  // block, and given to the pass as the body of the call `early(x)`.
  const declare = (name: string, value: unknown) =>
    ce._fn('Declare', [ce.symbol(name), ce.box(valueOf(value) as any)]);
  const written = ce._fn('Block', [
    declare('s', ['Add', 'k', 1]),
    declare('k', 2),
    ce.symbol('s'),
  ]);
  const target = ce._getCompilationTarget('glsl')!.createTarget();
  const glsl = glslFragmentDefinition(target);
  const annotate = (parameter: string) => {
    const definition: FragmentDefinition<GlslRepresentation> = {
      ...glsl,
      constantValue: undefined,
      functionOf: (call) =>
        isFunction(call) && call.operator === 'early'
          ? {
              key: 'early',
              name: 'early',
              parameters: [parameter],
              parameterTypes: [{ kind: 'real' }],
              arguments: call.ops,
              body: written,
            }
          : undefined,
    };
    return typeFragment(ce._fn('early', [ce.symbol('x')]), definition);
  };
  test('with no outer binding of the name', () => {
    const refusal = annotate('t').refusal;
    expect(refusal?.reason).toBe('place');
    expect(refusal?.binding).toBe('k');
    expect(refusal?.message).toMatch(/before its declaration/);
  });
  test('with a parameter of the same name: the lookup stops at the block', () => {
    const refusal = annotate('k').refusal;
    expect(refusal?.reason).toBe('place');
    expect(refusal?.binding).toBe('k');
    expect(refusal?.message).toMatch(/before its declaration/);
  });
  test('the engine refuses the same body when it defines the function', () =>
    expect(() =>
      ce.assign('early1', ce.box(['Function', body, ['Typed', 't', "'real'"]]))
    ).toThrow(/read-before-declaration/));
  test('a read after the declaration is in', () => {
    ce.assign(
      'late',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'k', valueOf(2)],
          ['Declare', 's', valueOf(['Add', 'k', 't'])],
          's',
        ],
        ['Typed', 't', "'real'"],
      ])
    );
    expectIn(['late', 'x']);
  });
});

describe('compile-time work', () => {
  test('a constant subtree has the type of its value', () =>
    expectIn(['Add', ['Mean', ['List', 1, 2, 3]], 'x']));
  test('a comprehension over constant ranges is unrolled, and in', () =>
    expectIn([
      'Min',
      ['Comprehension', ['Multiply', 'k', 'x'], ['Element', 'k', ['Range', 0, 2]]],
    ]));
  test('the closed-form derivative is in', () =>
    expectIn(['D', ['Sin', ['Multiply', 2, 'x']], 'x']));
  test('with `constantFold: false`, a constant subtree outside the list is out', () => {
    expectOut(
      ['Add', ['Mean', ['List', 1, 2, 3]], 'x'],
      'Mean',
      { constantFold: false }
    );
  });
});

describe('never throws', () => {
  test('an invalid expression', () => {
    const r = canCompile(ce.box(['Add', 'x', ['Sqrt']]), { to: 'glsl' });
    expect(r.ok).toBe(false);
  });
  test('an unknown storage kind', () => {
    const r = check(['Add', 'x', 1], { storage: { x: 'texture' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe('outside-fragment');
  });
  test('a storage hint that names no free symbol', () => {
    const r = check(['Add', 'x', 1], { storage: { nowhere: 'sampler2D' } });
    expect(r.ok).toBe(false);
  });
  test('a mode that the target does not offer', () => {
    const r = check(['Add', 'x', 1], { mode: 'complex' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.message).toMatch(/mode 'complex'/);
  });
  test('an unknown option value', () => {
    const r = check(['Add', 'x', 1], { mode: 'nonsense' });
    expect(r.ok).toBe(false);
  });
});

describe('the targets', () => {
  test('a target with no fragment answers no', () => {
    const r = canCompile(ce.box(['Add', 'x', 1]), { to: 'javascript' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.message).toMatch(/'glsl' target only/);
  });
  test('the entry of the compile sub-path exports the predicate', () =>
    expect(canCompileFromEntry(ce.box(['Add', 'x', 1]), { to: 'glsl' })).toEqual({
      ok: true,
    }));
});

describe('review fixes', () => {
  ce.declare('H100', 'list<real^100>');
  // A counted loop inside a parallel loop that writes the local `s` of the
  // function with `=`. Epsil refuses this program (`parallel-outer-write`),
  // so the function is written in MathJSON.
  ce.assign(
    'PS',
    ce.box([
      'Function',
      [
        'Block',
        ['Declare', 's', valueOf(0)],
        [
          'ParallelLoop',
          [
            'Loop',
            ['Assign', 's', ['Multiply', 'k', 'u']],
            ['Element', 'j', ['Range', 1, 2]],
          ],
          ['Element', 'k', ['Range', 1, 10]],
        ],
        's',
      ],
      ['Typed', 'u', "'real'"],
    ])
  );

  test('with `strictTypes`, a free symbol with an inferred type is out', () => {
    const json = ['Add', 'strictU', 1];
    expect(check(json)).toEqual({ ok: true });
    const r = expectOut(json, undefined, { strictTypes: true });
    expect(r.diagnostic.binding).toBe('strictU');
    expect(r.diagnostic.message).toMatch(/strictTypes/);
  });

  test('a list in a texture is out at a value place, also with a count the target can hold', () => {
    const r = expectOut(['Max', 'H100'], undefined, {
      storage: { H100: 'sampler2D' },
    });
    expect(r.diagnostic.binding).toBe('H100');
    expect(r.diagnostic.message).toMatch(/only as the base of an `At`/);
  });

  test('an index operand of a signature is typed in its own scope (an aggregate index)', () =>
    expectIn(['Sum', ['Mandelbrot', 'z', 'k'], ['Limits', 'k', 1, 10]]));

  test('a list input held as a uniform array reaches the bound variant', () => {
    // `L` has 5 elements and is not in the `storage` option, so the shader
    // declares it as `float L[5]`, and the variant of `g5` reads it by name.
    expectIn(['g5', 'L', 'x']);
    const r = compile(ce.box(['g5', 'L', 'x']), { to: 'glsl', fallback: false });
    expect(r.code).toBe('_fn_g5_bind0_L(x)');
  });

  test('a computed list argument does not reach the bound variant', () => {
    const r = expectOut(['g5', ['List', 'x', 1, 2, 3, 4], 'x']);
    expect(r.diagnostic.binding).toBe('H');
  });

  test.each([
    ['Second of a point of 2', ['Second', 'q2']],
    ['Third of a point of 3', ['Third', 'p']],
    ['At with a negative index from the end', ['At', 'L', -1]],
    ['At with the last index', ['At', 'L', 5]],
  ])('%s is in', (_, json) => expectIn(json));

  test.each([
    ['Third of a point of 2', ['Third', 'q2'], 'Third'],
    ['At with an index past the end', ['At', 'L', 6], 'At'],
    ['At with the index 0', ['At', 'L', 0], 'At'],
    ['At with a negative index past the start', ['At', 'L', -6], 'At'],
    ['a slice with a bound past the end', ['At', 'L', ['Range', 2, 6]], 'At'],
    ['a slice with the bound 0', ['At', 'L', ['Range', 0, 2]], 'At'],
    [
      'a slice with a negative bound past the start',
      ['At', 'L', ['Range', -6, -1]],
      'At',
    ],
  ])('%s is out', (_, json, operator) => {
    expectOut(json, operator);
  });

  test('a free symbol with a stored value is typed by its value', () => {
    ce.assign('storedGamma', ce.box(['Gamma', 'z']));
    expectOut(['Add', 'storedGamma', 1], 'Gamma');
  });

  test('a real ascription of a complex value is out', () => {
    expectOut(['Add', ['Typed', 'z', "'real'"], 1], 'Typed');
  });

  test('a complex ascription of a real value is in, read as a complex number', () => {
    const glsl = glslFragmentDefinition(
      ce._getCompilationTarget('glsl')!.createTarget()
    );
    const typed = ce.box(['Typed', 'x', "'complex'"]);
    const annotation = typeFragment(typed, glsl);
    expect(annotation.refusal).toBeUndefined();
    const facts = fragmentFactsOf(annotation.scope, typed) as {
      type: { kind: string };
      conversions?: { kind: string }[];
    };
    expect(facts.type.kind).toBe('complex');
    expect(facts.conversions?.map((c) => c.kind)).toEqual(['real-to-complex']);
    expectIn(['Multiply', ['Typed', 'x', "'complex'"], 'z']);
  });

  test('a colour space that the shader has no helper for is out', () => {
    expectOut(['ColorToColorspace', 'c', { str: 'xyz' }], 'ColorToColorspace');
    expectIn(['ColorToColorspace', 'c', { str: 'hsl' }]);
  });

  test('a `vars` replacement that GLSL reserves is out', () => {
    const r = expectOut(['Add', 'x', 1], undefined, { vars: { x: 'input' } });
    expect(r.diagnostic.binding).toBe('x');
    expect(r.diagnostic.message).toMatch(/reserved word/);
  });

  test('`Break` in the body of a `Sum` inside a loop is out', () => {
    // The engine wraps such a `Break` in an `Error` when it boxes the body
    // (`incompatible-type`), so the rule of the pass is a second guard: the
    // body is assembled from parts with no check, and given to the pass as
    // the body of the call `sumBreak(x)`.
    const sum = ce._fn('Sum', [
      ce._fn('Block', [ce._fn('Break', []), ce.symbol('k')]),
      ce.box(['Limits', 'k', 1, 3]),
    ]);
    const body = ce._fn('Block', [
      ce._fn('Declare', [ce.symbol('s'), ce.box(valueOf(0) as any)]),
      ce._fn('Loop', [
        ce._fn('Assign', [ce.symbol('s'), sum]),
        ce.box(['Element', 'j', ['Range', 1, 3]]),
      ]),
      ce.symbol('s'),
    ]);
    const glsl = glslFragmentDefinition(
      ce._getCompilationTarget('glsl')!.createTarget()
    );
    const refusal = typeFragment(ce._fn('sumBreak', [ce.symbol('x')]), {
      ...glsl,
      constantValue: undefined,
      functionOf: (call) =>
        isFunction(call) && call.operator === 'sumBreak'
          ? {
              key: 'sumBreak',
              name: 'sumBreak',
              parameters: ['u'],
              parameterTypes: [{ kind: 'real' }],
              arguments: call.ops,
              body,
            }
          : undefined,
    }).refusal;
    expect(refusal?.operator).toBe('Break');
    expect(refusal?.reason).toBe('place');
  });

  test('a write with `=` in a counted loop inside a parallel loop is out', () => {
    const r = expectOut(['PS', 'x'], 'Assign');
    expect(r.diagnostic.message).toMatch(/only with `\+=`/);
  });

  test('`AddTo` on a point local is out', () => {
    ce.assign(
      'addPoint',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'v', valueOf(['Tuple', 'u', 'u'])],
          ['AddTo', 'v', ['Tuple', 1, 1]],
          ['At', 'v', 1],
        ],
        ['Typed', 'u', "'real'"],
      ])
    );
    const r = expectOut(['addPoint', 'x'], 'AddTo');
    expect(r.diagnostic.message).toMatch(/scalar local/);
  });

  test('a parameter with a name that GLSL reserves is out when the function is emitted', () => {
    // The body is a block, so the compiler cannot write it at the call
    // site: it emits a shader function, whose signature would name the
    // parameter `filter`.
    ce.assign(
      'reservedBlockParam',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 's', valueOf(0)],
          ['Loop', ['Assign', 's', ['Add', 's', 'filter']], ['Element', 'k', ['Range', 1, 3]]],
          's',
        ],
        ['Typed', 'filter', "'real'"],
      ])
    );
    const r = expectOut(['reservedBlockParam', 'x']);
    expect(r.diagnostic.binding).toBe('filter');
    expect(r.diagnostic.message).toMatch(/reserved word/);
  });

  test('a parameter with a name that GLSL reserves is in when the call is inlined', () => {
    // The compiler refuses to emit a function with the parameter `filter`,
    // and writes the body at the call site instead (`x + 1.0`): the name
    // is never written.
    ce.assign(
      'reservedParam',
      ce.box(['Function', ['Add', 'filter', 1], ['Typed', 'filter', "'real'"]])
    );
    expectIn(['reservedParam', 'x']);
  });

  // CE-1184. A parameter with no declared type, called with a real: the
  // compiler takes no copy of the function typed by the argument, since
  // the copy has the same parameter name and cannot be emitted either. The
  // call is written in place, as `canCompile()` answers.
  test.each(['filter', 'input', 'output', 'sample'])(
    'an untyped parameter named `%s` is in when the call is inlined',
    (name) => {
      const f = `reservedUntyped_${name}`;
      ce.assign(f, ce.box(['Function', ['Add', name, 1], name]));
      expectIn([f, 'x']);
      const result = compile(ce.box([f, 'x']), { to: 'glsl', fallback: false });
      expect(result.code).toBe('x + 1.0');
    }
  );

  // CE-1166 step 5. A call of a function with a parameter that GLSL
  // reserves is written in place in the prepare stage
  // (`inlineReservedParameterCalls()`), so the typing pass types the tree
  // that the emitter writes, and `canCompile()` and `compile()` agree.
  describe('a parameter named `discard`', () => {
    // The argument `v` of the calls below is an input mapped by `vars`: it
    // has a declared type, so the walk reaches the body of the callee.
    ce.declare('v', 'real');
    ce.assign(
      'discardSquare',
      ce.box(['Function', ['Multiply', 'discard', 'discard'], 'discard'])
    );
    const code = (json: unknown, options: Record<string, unknown> = {}) =>
      compile(ce.box(json as any), { to: 'glsl', fallback: false, ...options })
        .code;

    test('a call in the root is in, and is written in place', () => {
      expectIn(['discardSquare', 'x']);
      expect(code(['discardSquare', 'x'])).toBe('x * x');
    });

    test('a call whose argument is a call of the same function is in', () => {
      expectIn(['discardSquare', ['discardSquare', 'x']]);
      expect(code(['discardSquare', ['discardSquare', 'x']])).not.toContain(
        'discard'
      );
    });

    test('a call in a loop body is in', () =>
      expectIn([
        'Sum',
        ['discardSquare', ['Multiply', 'k', 'x']],
        ['Limits', 'k', 1, 'n'],
      ]));

    // One call object at three places, two of them under the index of a
    // `Sum`: the rewrite keeps a memo per set of bound names, so each place
    // is written in place, and no parameter name reaches the code.
    test('a call object shared under a loop index and outside it is in', () => {
      const call = ce.box(['discardSquare', 'x']);
      const expr = ce.function('Add', [
        call,
        ce.function('Sum', [
          ce.function('Add', [call, call, ce.symbol('k')]),
          ce.box(['Limits', 'k', 1, 'n']),
        ]),
      ]);
      expect(check(expr.json, {})).toEqual({ ok: true });
      const result = compile(expr, { to: 'glsl', fallback: false });
      expect(result.success).toBe(true);
      expect(result.code).not.toContain('discard');
    });

    // The substituted body can run the code of an argument zero times,
    // several times or in a short-circuit operand, where the interpreter
    // runs it once per call: the call stays a call, which is out.
    const expectCallStays = (
      json: unknown,
      options: Record<string, unknown> = {}
    ) => {
      const r = expectOut(json, undefined, options);
      expect(r.diagnostic.binding).toBe('discard');
      expect(() => code(json, options)).toThrow(r.diagnostic.message);
    };

    test('an argument that is caller code is out', () =>
      expectCallStays(['discardSquare', 'v'], { vars: { v: 'myFn(1.0)' } }));

    test('an argument that is caller code in an `If` body is out', () => {
      ce.assign(
        'discardIf',
        ce.box([
          'Function',
          ['If', ['Greater', 'x', 0], 'discard', 0],
          'discard',
        ])
      );
      expectCallStays(['discardIf', 'v'], { vars: { v: 'myFn(1.0)' } });
    });

    test('an argument that is caller code in an `And` body is out', () => {
      ce.assign(
        'discardAnd',
        ce.box([
          'Function',
          ['And', ['Greater', 'x', 0], ['Greater', 'discard', 1]],
          'discard',
        ])
      );
      expectCallStays(['discardAnd', 'v'], { vars: { v: 'myFn(1.0)' } });
    });

    test('a callee body that reads caller code is out', () => {
      // Two substituted copies would share the one node of `v`, and its
      // code would run once where the interpreter runs it once per call.
      ce.assign(
        'discardPlusV',
        ce.box(['Function', ['Add', 'discard', 'v'], 'discard'])
      );
      expectCallStays(
        ['Add', ['discardPlusV', 'x'], ['discardPlusV', 'y']],
        { vars: { v: 'nextValue()' } }
      );
    });

    test('an argument whose type cannot match the declared parameter type is out', () => {
      ce.assign(
        'discardMagnitude',
        ce.box([
          'Function',
          ['Abs', 'discard'],
          ['Typed', 'discard', "'real'"],
        ])
      );
      expectCallStays(['discardMagnitude', 'z']);
    });

    test('an argument that calls a caller function that is not pure is out', () => {
      const options = { functions: { effectG: 'myG' } };
      const call = ['discardSquare', ['effectG', 'x']];
      const r = expectOut(call, undefined, options);
      expect(r.diagnostic.binding).toBe('discard');
      expect(() => code(call, options)).toThrow(r.diagnostic.message);
    });

    test('a call in the body of an emitted function is out', () => {
      // The body of `callsDiscard` is emitted as a shader function, and the
      // prepare stage writes in place only the calls of the root.
      ce.assign(
        'callsDiscard',
        ce.box(['Function', ['Add', ['discardSquare', 'w'], 1], 'w'])
      );
      const r = expectOut(['callsDiscard', 'x']);
      expect(r.diagnostic.binding).toBe('discard');
      expect(() => code(['callsDiscard', 'x'])).toThrow(r.diagnostic.message);
    });
  });

  test('a gamut that the shader has no helper for is out', () => {
    expectOut(['GamutMap', ['Rgb', 'x', 0, 0], { str: 'rec2020' }], 'GamutMap');
    expectIn(['GamutMap', ['Rgb', 'x', 0, 0], { str: 'display-p3' }]);
  });

  test('`If`, `Which`, `List` and `Sum` record one conversion per operand read as a value', () => {
    const glsl = glslFragmentDefinition(
      ce._getCompilationTarget('glsl')!.createTarget()
    );
    const kinds = (json: unknown) => {
      const node = ce.box(json as any);
      const annotation = typeFragment(node, glsl);
      expect(annotation.refusal).toBeUndefined();
      const facts = fragmentFactsOf(annotation.scope, node) as {
        conversions?: { kind: string }[];
      };
      return facts.conversions?.map((c) => c.kind);
    };
    expect(kinds(['If', 'b', 'x', 'z'])).toEqual([
      'none',
      'real-to-complex',
      'none',
    ]);
    expect(kinds(['Which', 'b', 'z', 'True', 'x'])).toEqual([
      'none',
      'none',
      'none',
      'real-to-complex',
    ]);
    // A condition that is the symbol `False` keeps its pair, as the shader
    // code keeps it (`false ? x : …`): its value is read as the type of the
    // `Which`. Only the clauses after a `True` condition are dropped.
    expect(kinds(['Which', 'False', 'x', 'b', 'z', 'True', 'x'])).toEqual([
      'none',
      'real-to-complex',
      'none',
      'none',
      'none',
      'real-to-complex',
    ]);
    expect(kinds(['List', 'x', 'n', 'y'])).toEqual(['none', 'none', 'none']);
    expect(kinds(['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']])).toEqual([
      'to-int',
      'to-int',
      'none',
    ]);
  });

  test('one node shared at an index-set place and a value place: the value place is out', () => {
    const range = ce.function('Range', [ce.number(1), ce.symbol('n')]);
    const sum = ce._fn('Sum', [
      ce.box(['Multiply', 'k', 'x']),
      ce._fn('Element', [ce.symbol('k'), range]),
    ]);
    const glsl = glslFragmentDefinition(
      ce._getCompilationTarget('glsl')!.createTarget()
    );
    expect(typeFragment(sum, glsl).refusal).toBeUndefined();
    const refusal = typeFragment(ce._fn('Add', [sum, range]), glsl).refusal;
    expect(refusal?.reason).toBe('place');
    expect(refusal?.node).toBe(range);
  });
});

// CE-1166 step 5. A `Sum` or a `Product` with more than one index set is
// written as a nest of one aggregate per index, the first index outermost,
// in the prepare stage (`nestMultiIndexAggregate()`), so the typing pass
// types the nest that the emitter writes, and `canCompile()` and
// `compile()` agree.
describe('a multi-index Sum or Product', () => {
  const code = (json: unknown) =>
    compile(ce.box(json as any), { to: 'glsl', fallback: false }).code ?? '';

  test.each([
    [
      'Sum',
      ['Multiply', 'i', 'j', 'x'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 4],
    ],
    // An inner bound reads the outer index.
    [
      'Sum',
      ['Multiply', 'i', 'j', 'x'],
      ['Limits', 'i', 1, 'n'],
      ['Limits', 'j', 1, 'i'],
    ],
    [
      'Product',
      ['Add', 'i', 'j', 'x'],
      ['Limits', 'i', 1, 'n'],
      ['Limits', 'j', 'i', 3],
    ],
    [
      'Sum',
      ['Multiply', 'i', 'j', 'k', 'x'],
      ['Limits', 'i', 1, 'n'],
      ['Limits', 'j', 1, 'i'],
      ['Limits', 'k', 'j', 'i'],
    ],
  ])('%s over several index sets is in', (...json) => expectIn(json));

  test('an inner bound that reads the outer index is read in the outer loop', () => {
    const glsl = code([
      'Sum',
      ['Multiply', 'i', 'j', 'x'],
      ['Limits', 'i', 1, 'n'],
      ['Limits', 'j', 1, 'i'],
    ]);
    expect(glsl).toMatch(
      /for \(int i = 1; [^]*for \(int j = 1; j <= int\(floor\(float\(i\)\)\)/
    );
  });

  // The unrolled code is also a JavaScript expression of `x`, so its value
  // can be compared with the value of the interpreter.
  test.each([
    [
      [
        'Sum',
        ['Multiply', 'i', 'j', 'x'],
        ['Limits', 'i', 1, 3],
        ['Limits', 'j', 1, 4],
      ],
      120,
    ],
    [
      [
        'Product',
        ['Add', 'i', 'j', 'x'],
        ['Limits', 'i', 1, 2],
        ['Limits', 'j', 1, 2],
      ],
      600,
    ],
  ])(
    'the unrolled nest of %j has the value of the interpreter',
    (json, value) => {
      const glsl = code(json);
      expect(glsl).not.toContain('for');
      expect(new Function('x', `return ${glsl};`)(2)).toBe(value);
      const interpreted = ce.box(json as any).subs({ x: 2 });
      expect(interpreted.N().re).toBe(value);
    }
  );

  test('a multi-index Sum in the body of a user function is in', () => {
    ce.assign(
      'multiIndexSum',
      ce.box([
        'Function',
        [
          'Sum',
          ['Multiply', 'i', 'j', 't'],
          ['Limits', 'i', 1, 3],
          ['Limits', 'j', 1, 'i'],
        ],
        't',
      ])
    );
    expectIn(['multiIndexSum', 'x']);
    expectIn(['Add', ['multiIndexSum', 'x'], ['multiIndexSum', 'y']]);
  });

  test('a multi-index Sum that is not nested is out', () => {
    const sum = ce.box([
      'Sum',
      ['Multiply', 'i', 'j', 'x'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 4],
    ]);
    const glsl = glslFragmentDefinition(
      ce._getCompilationTarget('glsl')!.createTarget()
    );
    expect(typeFragment(sum, glsl).refusal?.node).toBe(sum);
  });
});

describe('review fixes, second round', () => {
  test('a stored value with a name that an index binds where it is read is out', () => {
    ce.assign('capturedK', ce.parse('k^2'));
    const json = ['Sum', 'capturedK', ['Limits', 'k', 1, 10]];
    const r = expectOut(json);
    expect(r.diagnostic.binding).toBe('capturedK');
    expect(r.diagnostic.message).toMatch(/mentions `k`/);
    expect(() =>
      compile(ce.box(json as any), { to: 'glsl', fallback: false })
    ).toThrow(/mentions `k`/);
  });

  test('with `strictTypes`, an undeclared capture read in a called function is out', () => {
    ce.assign(
      'readsCapU',
      ce.box(['Function', ['Add', 't', 'capU'], ['Typed', 't', "'real'"]])
    );
    expect(check(['readsCapU', 'x'])).toEqual({ ok: true });
    const r = expectOut(['readsCapU', 'x'], undefined, { strictTypes: true });
    expect(r.diagnostic.binding).toBe('capU');
  });

  test('a generic function does not reach the bound variant', () => {
    // The compiler makes no variant of a generic function
    // (`ensureBoundListVariantEmitted()`): the list parameter is kept, and
    // it has no type in the fragment.
    ce.declare('genF', '(list<T>, real) -> T where T: real');
    ce.assign(
      'genF',
      ce.box(['Function', ['Multiply', ['At', 'Hg', 1], 'xg'], 'Hg', 'xg'])
    );
    const r = expectOut(['genF', 'L', 'x']);
    expect(r.diagnostic.binding).toBe('Hg');
  });

  test('an input that the `vars` option maps from a reserved name is converted as a bound', () => {
    ce.declare('in', 'real');
    const glsl = glslFragmentDefinition(
      ce._getCompilationTarget('glsl')!.createTarget(),
      { vars: { in: 'u_in' } }
    );
    const node = ce.box(['Sum', 'k', ['Limits', 'k', 1, 'in']]);
    const annotation = typeFragment(node, glsl);
    expect(annotation.refusal).toBeUndefined();
    const facts = fragmentFactsOf(annotation.scope, node) as {
      conversions?: { kind: string }[];
    };
    expect(facts.conversions?.[1].kind).toBe('to-int');
  });

  test('a literal RGB tuple at a colour place is in', () =>
    expectIn(['ColorMix', ['Tuple', 'x', 0, 0], 'c', 0.5]));
});

describe('phase C: compile() runs the pass first', () => {
  test.each([
    ['burning-ship', ['B', 'x', ['Negate', 'y']]],
    ['multibrot', ['MB', 'x', 'y', 3]],
    ['julia-set, the value', ['J', 'x', 'y', 1, 0]],
    ['julia-set, the colour', ['shade', ['J', 'x', 'y', 1, 0]]],
  ])('the showcase body %s is in', (_, json) => expectIn(json));

  test('the colour formula of buddhabrot is in, with its list in a texture', () =>
    expectIn(['cb', 'H90', 'x', 'y', 'x'], { storage: { H90: 'sampler2D' } }));

  test('the colour formula of buddhabrot is out without `storage` (decision 12)', () => {
    const r = expectOut(['cb', 'H90', 'x', 'y', 'x']);
    expect(r.diagnostic.binding).toBe('H90');
    expect(r.diagnostic.message).toContain('90001 elements');
    expect(r.diagnostic.message).toContain('limit of 256');
    expect(r.diagnostic.message).toContain(`storage: { H90: 'sampler2D' }`);
  });

  test('an expression outside the fragment declines with the diagnostic of canCompile()', () => {
    const expr = ce.box(['Add', ['Integrate', ['Sin', 'x'], 'x'], 1]);
    const result = compile(expr, { to: 'glsl', fallback: true });
    expect(result.success).toBe(false);
    expect(result.diagnostic).toEqual(
      (canCompile(expr, { to: 'glsl' }) as CanCompileResult & { ok: false })
        .diagnostic
    );
    expect(result.diagnostic?.operator).toBe('Integrate');
    expect(() => compile(expr, { to: 'glsl', fallback: false })).toThrow(
      /`Integrate` is outside the GLSL fragment/
    );
  });

  test('the `vars` option is spelling: a mapped input compiles with its spelling', () => {
    const json = ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']];
    const vars = { x: 'v_pos.x', n: 'u_n' };
    expectIn(json, { vars });
    const code = compile(ce.box(json as any), { to: 'glsl', vars }).code!;
    expect(code).toContain('v_pos.x');
    expect(code).toContain('u_n');
  });

  test('compileFunction() runs the pass: a declared name with no fragment type is out where the body reads it', () => {
    const glsl = ce._getCompilationTarget('glsl') as unknown as {
      compileFunction(
        e: unknown,
        name: string,
        ret: string,
        params: [string, string][]
      ): string;
    };
    expect(
      glsl.compileFunction(ce.box(['Add', 'u', 1]), 'f', 'float', [
        ['u', 'float'],
        ['m', 'mat2'],
      ])
    ).toContain('u + 1.0');
    expect(() =>
      glsl.compileFunction(ce.box(['Add', 'm', 1]), 'f', 'float', [
        ['m', 'mat2'],
      ])
    ).toThrow(/`m` is declared `mat2`, which has no type in the GLSL fragment/);
  });

  test('compileToSource() runs the pass: a call of a user function is out', () => {
    const glsl = ce._getCompilationTarget('glsl') as unknown as {
      compileToSource(e: unknown): string;
    };
    expect(glsl.compileToSource(ce.box(['Add', 'x', 1]))).toBe('x + 1.0');
    expect(() => glsl.compileToSource(ce.box(['sq', 'x']))).toThrow(
      /`sq` is outside the GLSL fragment/
    );
  });
});

describe('decisions 11 to 14', () => {
  ce.declare('t', 'real');
  ce.assign('fu', ce.box(['Function', ['Power', 'u', 2], 'u']));

  test('11: a parameter with no declared type takes the type of its argument', () => {
    expectIn(['fu', 'z']);
    const code = compile(ce.box(['fu', 'z']), { to: 'glsl' });
    expect(code.preamble).toMatch(/vec2 _fn_fu\w*\(vec2 u\)/);
  });

  test('11: a later call with another type is out, naming the parameter and both types', () => {
    const r = expectOut(['Add', ['fu', 't'], ['fu', 'z']]);
    expect(r.diagnostic.binding).toBe('u');
    expect(r.diagnostic.message).toMatch(/`u` of `fu` has no declared type/);
    expect(r.diagnostic.message).toContain('`real`');
    expect(r.diagnostic.message).toContain('`complex`');
  });

  test('12: a list input of at most 256 elements without `storage` is a uniform array', () =>
    expectIn(['At', 'L', ['Floor', 'x']]));

  test('12: a longer list input without `storage` is out, and the diagnostic names the fix', () => {
    const r = expectOut(['At', 'Big', 2]);
    expect(r.diagnostic.message).toContain('1600 elements');
    expect(r.diagnostic.message).toContain('limit of 256');
    expect(r.diagnostic.message).toContain(`storage: { Big: 'sampler2D' }`);
  });

  test('13: the row root takes the block forms of a function body', () => {
    // `acc` is not a symbol of the engine, so the assignment declares a
    // local of the block.
    expectIn(['Block', ['Assign', 'acc', 'x'], 'acc']);
    const code = compile(ce.box(['Block', ['Assign', 'acc', 'x'], 'acc']), {
      to: 'glsl',
    }).code;
    expect(code).toContain('acc = x;');
  });

  test('13: a write to an input at the root is out', () => {
    const r = expectOut(['Block', ['Assign', 'x', 1], 'x'], 'Assign');
    expect(r.diagnostic.message).toMatch(/not a local/);
  });

  test('14: a list parameter bound to a list input held as a uniform array is in', () =>
    expectIn(['g5', 'L', 'x']));

  test('14: a list parameter bound to a computed list is out', () => {
    // A list of 2 to 4 reals is a `vecN` argument (decision 18); a longer
    // one is not.
    expectOut(['g5', ['List', 1, 2, 3, 4, 5], 'x']);
  });
});

describe('decisions 16 to 18, and the complex reciprocal functions', () => {
  const glsl = (json: unknown) =>
    compile(ce.box(json as any), { to: 'glsl', fallback: false });

  test('16: an If with no else branch is a value, NaN where the condition fails', () => {
    const json = ['If', ['Less', 'x', 0], ['Sin', 'x']];
    expectIn(json);
    expect(glsl(json).code).toMatch(/\? \(\w*sin\(x\)\) : \(_gpu_nan\(\)\)/);
    // The NaN of a point and of a complex number fills each lane.
    expect(glsl(['If', ['Less', 'x', 0], 'p']).code).toContain('vec3(_gpu_nan())');
    expect(glsl(['If', ['Less', 'x', 0], 'z']).code).toContain('vec2(_gpu_nan())');
    // A boolean branch is `False` where the condition fails, as in the
    // interpreter.
    expectIn(['If', ['Less', 'x', 0], ['Less', 'x', -1]]);
    expect(glsl(['If', ['Less', 'x', 0], ['Less', 'x', -1]]).code).toContain(
      ': (false)'
    );
    expect(
      ce.box(['If', ['Less', 'x', 0], ['Less', 'x', -1]]).subs({ x: 1 }).evaluate()
        .symbol
    ).toBe('False');
  });

  test('16: an If with no else branch and a colour or a long list is out', () => {
    const r = expectOut(['If', ['Less', 'x', 0], 'c'], 'If');
    expect(r.diagnostic.message).toMatch(/no else branch.*`color`/);
    expectOut(['If', ['Less', 'x', 0], ['List', 1, 2, 3, 4, 5]], 'If');
    // A `Which` with no default clause and a colour value is out too: the
    // emitter has no `NaN` colour.
    expectOut(['Which', ['Less', 'x', 0], 'c'], 'Which');
  });

  test('16: an If with no else branch whose condition is False is a value', () => {
    // The code writes it as a `Which` of one clause, whose value is the
    // absence value of the type of the branch, as in the interpreter.
    const json = ['Add', 1, ['If', 'False', 'x']];
    expectIn(json);
    expect(glsl(json).code).toBe('((false) ? (x) : (_gpu_nan())) + 1.0');
    expect(ce.box(['If', 'False', 'x']).evaluate().isNaN).toBe(true);
    expectIn(['If', 'False', ['Less', 'x', 1]]);
    expect(glsl(['If', 'False', ['Less', 'x', 1]]).code).toBe(
      '((false) ? (x < 1.0) : (false))'
    );
  });

  test('17: Sum and Product of a list of known length unroll', () => {
    expectIn(['Sum', ['List', 'x', 'y', 3]]);
    expect(glsl(['Sum', ['List', 'x', 'y', 3]]).code).toBe('x + y + 3.0');
    expectIn(['Product', ['List', 'x', 'y', 3]]);
    expectIn(['Sum', 'p']);
    expect(glsl(['Sum', ['Power', 'p', 2]]).code).toBe('dot(p, p)');
    expectIn(['Sum', ['List', 1, 'x', 3, 4, 5, 6]]);
  });

  test('17: Sum of a list input held as an array, in a texture or a scalar is out', () => {
    const r = expectOut(['Sum', 'L'], 'Sum');
    expect(r.diagnostic.message).toMatch(/list literal of at most 256/);
    expectOut(['Sum', 'H'], undefined, { storage: { H: 'sampler2D' } });
    expectOut(['Sum', 'x'], 'Sum');
    expectOut(['Sum', 'z'], 'Sum');
  });

  test('18: a parameter typed as a collection takes the type of its argument', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('y', 'real');
    // The type that the engine infers from the `At` reads of the body.
    e.declare('d', '(list<number>, list<number>) -> number');
    e.assign(
      'd',
      e.box([
        'Function',
        [
          'Add',
          ['Multiply', ['At', 'a', 1], ['At', 'b', 1]],
          ['Multiply', ['At', 'a', 2], ['At', 'b', 2]],
        ],
        'a',
        'b',
      ])
    );
    const json = ['d', ['List', 'x', 'y'], ['List', 1, 2]];
    expect(canCompile(e.box(json as any), { to: 'glsl' })).toEqual({ ok: true });
    const r = compile(e.box(json as any), { to: 'glsl', fallback: false });
    expect(r.code).toBe('_fn_d(vec2(x, y), vec2(1.0, 2.0))');
    expect(r.preamble).toContain('float _fn_d(vec2 a, vec2 b)');
    // A later call with a list of another length is out (decision 11).
    const out = canCompile(
      e.box([
        'Add',
        json,
        ['d', ['List', 'x', 'y', 1], ['List', 1, 2, 3]],
      ] as any),
      { to: 'glsl' }
    );
    expect(out.ok).toBe(false);
    if (!out.ok)
      expect(out.diagnostic.message).toMatch(
        /`a` of `d` has no declared type in the GLSL fragment.*`list<real, 2>`.*`list<real, 3>`/
      );
  });

  test('19: a parameter with no type and a list argument is mapped, not typed as a list', () => {
    // The interpreter applies `fu` to each element of the list (decision
    // 19): the parameter is a `float`, and a wrapper maps it.
    expectIn(['fu', ['List', 'x', 'y']]);
    const r = glsl(['fu', ['List', 'x', 'y']]);
    expect(r.code).toBe('_fn_fu_each2_1(vec2(x, y))');
    expect(r.preamble).toContain('float _fn_fu(float u)');
  });

  test.each(['Cot', 'Sec', 'Csc'])('%s of a complex number is in', (h) => {
    expectIn([h, 'z']);
    expect(glsl([h, 'z']).code).toMatch(/^_gpu_cdiv\(/);
  });

  test('Log of a complex number, and to a complex base, is in', () => {
    expectIn(['Log', 'z']);
    expectIn(['Log', 'x', 'z']);
  });

  test.each(['Arccot', 'Arcsch'])('%s of a complex number is out: no complex helper', (h) => {
    expectOut([h, 'z'], h);
  });
});

/**
 * Decision 19 of `docs/plans/2026-11-08-glsl-fragment-spec.md`: a call of a
 * user function with a list argument has the value that the interpreter
 * gives. The functions are reduced from the Tycho documents
 * `neyret/0et6fx01id` (`f(x) = x mod 1` called with `[-x, -y]`),
 * `neyret/pqflulcixs` (the rotation `R(V, θ)`), `neyret/9pal1xuvqq` (`f(c)`
 * with `c` a list of three reals) and `neyret/ra1p9naofs` (`l(p)`). The
 * values of the compiled shaders are compared with the interpreter in the
 * GLSL lane (`scripts/glsl-check/glsl-driver.test.ts`, "the calls of user
 * functions with a list argument").
 */
describe('decision 19: a call of a user function with a list argument', () => {
  const glsl = (json: unknown) =>
    compile(ce.box(json as any), { to: 'glsl', fallback: false });
  ce.assign('m19', ce.box(['Function', ['Mod', 'u', 1], 'u']));
  ce.declare('mr19', '(real) -> real');
  ce.assign('mr19', ce.box(['Function', ['Mod', 'u', 1], 'u']));
  ce.assign('add19', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
  ce.assign('lt19', ce.box(['Function', ['Less', 'u', 0], 'u']));
  ce.assign(
    'R19',
    ce.box([
      'Function',
      [
        'List',
        ['Sum', ['Multiply', 'V', ['List', ['Cos', 't'], ['Negate', ['Sin', 't']]]]],
        ['Sum', ['Multiply', 'V', ['List', ['Sin', 't'], ['Cos', 't']]]],
      ],
      'V',
      't',
    ])
  );
  ce.assign(
    'C19',
    ce.box([
      'Function',
      [
        'Subtract',
        [
          'Add',
          ['Power', ['Subtract', 'p', ['At', 'c', 1]], 2],
          ['Power', ['Subtract', 'q', ['At', 'c', 2]], 2],
        ],
        ['Power', ['At', 'c', 3], 2],
      ],
      'c',
      'p',
      'q',
    ])
  );
  ce.assign(
    'l19',
    ce.box([
      'Function',
      ['Sqrt', ['Add', ['Power', ['At', 'v', 1], 2], ['Power', ['At', 'v', 2], 2]]],
      'v',
    ])
  );

  test('the interpreter maps the scalar functions and reads the others whole', () => {
    const value = (json: unknown) => ce.box(json as any).evaluate().toString();
    expect(value(['m19', ['List', -2.25, 3.5]])).toBe('[0.75,0.5]');
    expect(value(['R19', ['List', 3, 4], 0])).toBe('[3,4]');
    expect(value(['C19', ['List', 1, 2, 0.5], 3, 4])).toBe('7.75');
    expect(value(['l19', ['List', 3, 4]])).toBe('5');
  });

  test('a scalar function called with a list of 2 to 4 reals is applied to each element', () => {
    for (const [f, param] of [
      ['m19', 'u'],
      ['mr19', 'u'],
    ]) {
      const json = [f, ['List', ['Negate', 'x'], ['Negate', 'y']]];
      expectIn(json);
      const r = glsl(json);
      expect(r.code).toBe(`_fn_${f}_each2_1(vec2(-x, -y))`);
      expect(r.preamble).toContain(`float _fn_${f}(float ${param})`);
      expect(r.preamble).toContain(
        `vec2 _fn_${f}_each2_1(vec2 a0) {\n  return vec2(_fn_${f}(a0.x), _fn_${f}(a0.y));`
      );
    }
    expectIn(['m19', ['List', 'x', 'y', 1, 2]]);
    // A scalar call and a list call of one function share its definition.
    expectIn(['Add', ['m19', 'x'], ['At', ['m19', ['List', 'x', 'y', 1]], 1]]);
    // A scalar argument beside a list is held whole by the wrapper.
    expectIn(['add19', ['List', 'x', 'y'], 'x']);
    expect(glsl(['add19', ['List', 'x', 'y'], 'x']).code).toBe(
      '_fn_add19_each2_10(vec2(x, y), x)'
    );
  });

  test('a scalar function called with a longer list, lists of two lengths or a non-real value is out', () => {
    const long = expectOut(['m19', ['List', 'x', 'y', 1, 2, 3]]);
    expect(long.diagnostic.message).toMatch(
      /applies `m19` to each element of `\[x,y,1,2,3\]`, of the type `list<real, 5>`: the GLSL code maps a list of 2 to 4 reals only/
    );
    const mixed = expectOut(['add19', ['List', 'x', 'y'], ['List', 'x', 'y', 1]]);
    expect(mixed.diagnostic.message).toMatch(/lists of different lengths/);
    const bool = expectOut(['lt19', ['List', 'x', 'y']]);
    expect(bool.diagnostic.message).toMatch(/has the type `boolean`, not `real`/);
    // The wrapper does not convert a complex argument, as a call does.
    const complex = expectOut(['add19', ['List', 'x', 'y'], 'z']);
    expect(complex.diagnostic.message).toMatch(/no complex or colour parameter/);
  });

  test('a parameter that the body reads as a vector takes the list type of its argument', () => {
    const rotation = ['R19', ['List', 'x', 'y'], 0.5];
    expectIn(rotation);
    expect(glsl(rotation).preamble).toMatch(
      /vec2 _fn_R19_vector_real_2_number\(vec2 V, float t\)/
    );
    const circle = ['C19', ['List', 'y', 'x', 0.5], 'x', 'y'];
    expectIn(circle);
    expect(glsl(circle).preamble).toMatch(
      /float _fn_C19\w*\(vec3 c, float p, float q\)/
    );
    // A parameter typed as a point by its `At` reads takes a list of reals
    // of its size whole, and a list built by a mapped call.
    expectIn(['l19', ['List', 'x', 'y']]);
    expectIn(['l19', ['m19', ['List', 'x', 'y']]]);
    expect(glsl(['l19', ['m19', ['List', 'x', 'y']]]).code).toBe(
      '_fn_l19_vector_real_2(_fn_m19_each2_1(vec2(x, y)))'
    );
  });

  test('a parameter typed by index reads that the body also reads whole is read as a list', () => {
    // `g(p) := p[1] + p[2] + |p|`: the interpreter maps `Abs` over the list,
    // so the value of the call is a list, not a real (the absolute value of
    // a point is its norm). The engine type of the call is
    // `number | vector<real^2>`, which the emitter reads as a real, so the
    // call is out.
    ce.assign(
      'g19',
      ce.box([
        'Function',
        ['Add', ['At', 'p', 1], ['At', 'p', 2], ['Abs', 'p']],
        'p',
      ])
    );
    expect(ce.box(['g19', ['List', 3, 4]]).evaluate().toString()).toBe(
      '[10,11]'
    );
    const json = [
      'Add',
      ['Sin', ['g19', ['List', 'x', 'y']]],
      ['Cos', ['g19', ['List', 'x', 'y']]],
    ];
    const message =
      /The call `g19\(\[x,y\]\)` has a list value, and its type `number \| vector<real\^2>` is not a list type/;
    expect(expectOut(json).diagnostic.message).toMatch(message);
    expect(() => glsl(json)).toThrow(message);
    // A body that reads the parameter by index only still takes the list.
    expectIn(['l19', ['List', 'x', 'y']]);
  });

  test('a list of another length, or a later call with another type, is out', () => {
    expectOut(['R19', ['List', 'x', 'y', 1, 2, 3], 0.5]);
    // A parameter typed by its index reads takes the type of its argument:
    // a list of 3 reals is read by index, as the interpreter reads it.
    expectIn(['l19', ['List', 'x', 'y', 1]]);
    // One GLSL function per parameter type is not needed by the witnesses:
    // the refusal of decision 11 stays.
    const r = expectOut([
      'Add',
      ['At', ['R19', ['List', 'x', 'y'], 0.5], 1],
      ['At', ['R19', ['List', 'x', 'y', 1], 0.5], 1],
    ]);
    expect(r.diagnostic.message).toMatch(
      /`V` of `R19` has no declared type.*`list<real, 2>`.*`list<real, 3>`/
    );
  });
});

describe('the pass cap (iterationBudget)', () => {
  // Two equal sums: the common-subexpression pass writes one loop for both.
  const twoSums = [
    'Add',
    ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']],
    ['Multiply', 2, ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']]],
  ];
  const code = (options: Record<string, unknown>) =>
    compile(ce.box(twoSums as any), { to: 'glsl', ...options });
  const loops = (c: string) => c.split('\n').filter((l) => l.startsWith('for (')).length;

  test('the default cap is 10,000 passes per evaluation', () => {
    const r = code({});
    expect(r.code).toMatch(/^_gpu_passes = 0;/);
    expect(r.code).toContain('if (++_gpu_passes > 10000) break;');
    expect(r.code).toMatch(/return _gpu_passes > 10000 \? _gpu_nan\(\) : _tv\d+;$/);
    expect(r.preamble).toContain('int _gpu_passes = 0;');
  });

  test('with `cse`, two equal sums run one loop, so their passes count once', () => {
    const r = code({ iterationBudget: 50 });
    expect(loops(r.code!)).toBe(1);
    expect(r.code).toContain('if (++_gpu_passes > 50) break;');
  });

  test('with `cse: false`, each sum runs its own loop, and both count', () => {
    const r = code({ iterationBudget: 50, cse: false });
    expect(loops(r.code!)).toBe(2);
    expect(r.code!.split('if (++_gpu_passes > 50) break;').length - 1).toBe(2);
  });

  // The emitted shader is not run here: these tests read the counter and
  // the test of the value. A loop of `n` passes with `n` over the cap leaves
  // its loop at the pass `cap + 1`, and the value of the evaluation is
  // `_gpu_nan()`; with `n` at most the cap, the test reads the value.
  test.each([
    ['under the cap', 100],
    ['over the cap', 5],
  ])('a cap %s writes the same guard with its own value', (_, budget) => {
    for (const cse of [true, false]) {
      const r = code({ iterationBudget: budget, cse });
      expect(r.code).toContain(`if (++_gpu_passes > ${budget}) break;`);
      expect(r.code).toContain(`return _gpu_passes > ${budget} ? _gpu_nan() :`);
    }
  });

  test('a loop in a user function counts its passes too', () => {
    const r = compile(ce.box(['B', 'x', 'y']), { to: 'glsl' });
    expect(r.preamble).toContain('if (++_gpu_passes > 10000) break;');
    expect(r.code).toMatch(/^_gpu_passes = 0;/);
  });

  test('an expression with no loop has no counter', () => {
    const r = compile(ce.box(['Add', 'x', 1]), { to: 'glsl' });
    expect(r.code).toBe('x + 1.0');
    expect(r.preamble ?? '').not.toContain('_gpu_passes');
  });
});

describe('phase C, review fixes', () => {
  ce.declare('L3', 'list<real^3>');
  // A sum of `n` passes: the code then holds the value of the root in a
  // temporary of its shader type, which the pass cap tests.
  const sum = ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']];
  const rootTemporary = (json: unknown): string | undefined =>
    /^(\w+) _tv\d+ = .*;$/m.exec(
      compile(ce.box(json as any), { to: 'glsl', fallback: false }).code!
        .split('\n')
        .slice(-2)
        .join('\n')
    )?.[1];

  test('`Abs` of a list of 3 reals is the list of the absolute values: a vec3', () => {
    expectIn(['Add', ['Abs', 'L3'], sum]);
    expect(rootTemporary(['Add', ['Abs', 'L3'], sum])).toBe('vec3');
    // The absolute value of a point is its norm.
    expect(rootTemporary(['Add', ['Abs', 'p'], sum])).toBe('float');
  });

  test('`Max` of a list and a real is the largest element: a float', () => {
    expectIn(['Multiply', ['Max', 'L3', 'x'], sum]);
    expect(rootTemporary(['Multiply', ['Max', 'L3', 'x'], sum])).toBe('float');
    // A point and a real: the largest component, as in the interpreter
    // (`Max((1, 5, 3), 2)` is 5).
    expect(rootTemporary(['Multiply', ['Max', 'p', 'x'], sum])).toBe('float');
    expect(rootTemporary(['Multiply', ['Min', 'L3', 'x'], sum])).toBe('float');
  });

  test('a `parallel for` at the root is typed in its lowered form, and its value is the value of the interpreter', () => {
    const json = [
      'Block',
      ['Assign', 'acc3', 0],
      [
        'ParallelLoop',
        ['AddTo', 'acc3', ['Multiply', 'k', 'x']],
        ['Element', 'k', ['Range', 1, 10]],
      ],
      'acc3',
    ];
    expectIn(json);
    const code = compile(ce.box(json as any), { to: 'glsl' }).code!;
    expect(code).toContain('for (int k = 1; k <= 10; k++) {');
    expect(code).toContain('acc3 = acc3 + float(k) * x;');
    // The value at x = 0.5: 55 * 0.5.
    expect(ce.box(json as any).subs({ x: 0.5 }).evaluate().re).toBe(27.5);
  });

  test('a write with `=` to an outer local in a lowered `parallel for` is out', () => {
    const r = expectOut(
      [
        'Block',
        ['Assign', 'acc4', 0],
        [
          'ParallelLoop',
          ['Assign', 'acc4', ['Add', 'acc4', 'x']],
          ['Element', 'k', ['Range', 1, 10]],
        ],
        'acc4',
      ],
      'Assign'
    );
    expect(r.diagnostic.message).toMatch(/only with `\+=`/);
  });

  test('`iterationBudget: Infinity` sets no cap: the code counts no pass', () => {
    expect(check(sum, { iterationBudget: Infinity })).toEqual({ ok: true });
    const r = compile(ce.box(sum as any), {
      to: 'glsl',
      iterationBudget: Infinity,
    });
    expect(r.code).not.toContain('_gpu_passes');
    expect(r.preamble ?? '').not.toContain('_gpu_passes');
  });

  test.each([NaN, -1, 0])(
    '`iterationBudget: %p` is refused by compile() and canCompile()',
    (budget) => {
      const r = check(sum, { iterationBudget: budget });
      expect(r.ok).toBe(false);
      expect(() =>
        compile(ce.box(sum as any), { to: 'glsl', iterationBudget: budget })
      ).toThrow(/iterationBudget/);
    }
  );

  // Each loop entry after the cap adds one to the counter, so the cap keeps
  // room for them below the largest `int`, 2^31 - 1.
  test('a budget over 2^30 is kept at 2^30', () => {
    const r = compile(ce.box(sum as any), { to: 'glsl', iterationBudget: 1e12 });
    expect(r.code).toContain('if (++_gpu_passes > 1073741824) break;');
    expect(r.code).not.toContain('1000000000000');
  });

  test('`Length` of an operand with an effect is out', () => {
    // The interpreter gives `x`: the block assigns `x` to `s` and then
    // counts the components. The compiler would write the count only.
    const json = [
      'Block',
      ['Declare', 'acc5', valueOf(0)],
      ['Length', ['Block', ['Assign', 'acc5', 'x'], ['Tuple', 'x', 'x']]],
      'acc5',
    ];
    expectOut(json, 'Length');
    expect(compile(ce.box(json as any), { to: 'glsl' }).success).toBe(false);
    // An operand with no effect is in, and its count is written.
    expectIn(['Length', ['Tuple', 'x', 'x']]);
  });

  test('the pass counter is declared under a guard, so two preambles can be joined', () => {
    const r = compile(ce.box(sum as any), { to: 'glsl' });
    expect(r.preamble).toContain(
      '#ifndef _GPU_PASSES_DECLARED\n#define _GPU_PASSES_DECLARED\nint _gpu_passes = 0;\n#endif\n'
    );
  });
});

describe('phase C, second review fixes', () => {
  // A symbol whose type admits a point and a list of points: the compiler
  // writes its point value in place of it (`inlinePointValues()`), which
  // makes new nodes.
  ce.declare('PU', 'list<tuple<number, number>> | tuple<number, number>');
  ce.assign('PU', ce.box(['Tuple', 3, 4]));
  expect(
    executeEpsil(
      ce,
      [
        'function mapMin(t: real) -> real { min(map(u => u * t, [1, 2, 3])) }',
        'function normSum(t: real) -> real {',
        '  let s = 0',
        '  parallel for k in 1..10 { s += norm(PU) * k * t }',
        '  s',
        '}',
      ].join('\n')
    ).diagnostics
  ).toEqual([]);

  test('the body of a user function is prepared as the emitter prepares it: a `Map` over a constant list is unrolled', () => {
    expectIn(['mapMin', 'x']);
    const code = compile(ce.box(['mapMin', 'x'] as any), { to: 'glsl' })
      .preamble!;
    expect(code).toContain('_gpu_min(_gpu_min(t, 2.0 * t), 3.0 * t)');
  });

  test('a `+=` in a `parallel for` is in after its value is rewritten; a write with `=` is out', () => {
    // In the body of a user function: 55 * |(3, 4)| * x.
    expectIn(['normSum', 'x']);
    expect(
      ce.box(['normSum', 'x'] as any).subs({ x: 0.5 }).evaluate().re
    ).toBe(137.5);
    // At the root of the expression.
    const loop = (statement: unknown) => [
      'Block',
      ['Assign', 'acc6', 0],
      ['ParallelLoop', statement, ['Element', 'k', ['Range', 1, 10]]],
      'acc6',
    ];
    const term = ['Multiply', ['Norm', 'PU'], 'k'];
    expectIn(loop(['AddTo', 'acc6', term]));
    expect(
      compile(ce.box(loop(['AddTo', 'acc6', term]) as any), { to: 'glsl' })
        .code
    ).toMatch(/acc6 = (float\(k\) \* 5\.0 \+ acc6|acc6 \+ float\(k\) \* 5\.0);/);
    // The same form written with `=` is out.
    const r = expectOut(
      loop(['Assign', 'acc6', ['Add', 'acc6', term]]),
      'Assign'
    );
    expect(r.diagnostic.message).toMatch(/only with `\+=`/);
  });
});

// Phase C2: `canCompile()` and `compile()` to GLSL agree. Each case is in
// (both accept) or out (both refuse with the diagnostic of the pass). A
// rule of the pass below mirrors a test of the emitter, so that the pass
// refuses what the emitter would decline.
describe('phase C2: canCompile() and compile() agree', () => {
  /** Both refuse `json` on the engine `engine`, with the same message.
   *  `code` is the diagnostic code of `compile()`; the code of
   *  `canCompile()` is `outside-fragment`. */
  function outOn(
    engine: ComputeEngine,
    json: unknown,
    message: RegExp,
    options: Record<string, unknown> = {},
    code = 'outside-fragment'
  ): void {
    const expr = engine.box(json as any);
    const r = canCompile(expr, { to: 'glsl', ...options });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostic.code).toBe('outside-fragment');
    expect(r.diagnostic.message).toMatch(message);
    const result = compile(expr, { to: 'glsl', ...options });
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe(code);
    expect(result.diagnostic?.message).toMatch(message);
  }
  /** Both accept `json` on the engine `engine`. */
  function inOn(
    engine: ComputeEngine,
    json: unknown,
    options: Record<string, unknown> = {}
  ): string {
    const expr = engine.box(json as any);
    expect(canCompile(expr, { to: 'glsl', ...options })).toEqual({ ok: true });
    const result = compile(expr, { to: 'glsl', fallback: false, ...options });
    expect(result.success).toBe(true);
    return String(result.code);
  }

  test('a condition: the shader code keeps both branches of an If whose condition is the symbol True or False', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    // The static type of `2 < 3` is the value `True`: one branch is kept.
    expect(inOn(e, ['If', ['Less', 2, 3], ['Tuple', 1, 2], 0])).toBe(
      'vec2(1.0, 2.0)'
    );
    // An `If` with no else branch is a `Which`: `If(True, x)` is `x`.
    expect(inOn(e, ['If', 'True', 'x'])).toBe('(x)');
    // A `Which` drops the clauses after a condition that is the symbol
    // `True`.
    inOn(e, [
      'Which',
      ['Greater', 'x', 0],
      1,
      'True',
      2,
      'True',
      ['Tuple', 1, 2],
    ]);
    outOn(e, ['If', 'False', ['Tuple', 1, 2], 0], /branches of `If`/);
    outOn(
      e,
      ['Which', ['Less', 2, 3], ['Tuple', 1, 2], 'True', 0],
      /values of `Which`/
    );
    outOn(e, ['If', 'True', 0, 'z0'], /`z0` has the type `unknown`/);
  });

  // `canCompile()` runs the search of `compile()` for a value with no
  // settled shape (`unsettledShapeIn()`), and gives its diagnostic, with
  // the code `outside-fragment`; `compile()` gives the code
  // `unsettled-shape`.
  test('a value with no settled shape (rule R3)', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('c', 'real');
    // A block with an assignment is not an operand.
    outOn(
      e,
      ['Add', ['Block', ['Assign', 'q', 2], 'q'], 1],
      /a block with a statement other than/,
      {},
      'unsettled-shape'
    );
    outOn(
      e,
      [
        'Block',
        ['Assign', 's', 'x'],
        ['Assign', 't', ['Block', ['Assign', 'u', 's'], ['Multiply', 2, 'u']]],
        ['Add', 't', 1],
      ],
      /a block with a statement other than/,
      {},
      'unsettled-shape'
    );
    // A block that only declares names with a value is an operand.
    inOn(e, [
      'Add',
      [
        'Block',
        ['Declare', 'a', "'unknown'", ['Multiply', 3.7, 'x']],
        ['Subtract', 'a', ['Floor', 'a']],
      ],
      1,
    ]);
    // A local assigned a real and a complex value in mode `strict`.
    outOn(
      e,
      [
        'Block',
        ['Assign', 'a', 1],
        ['If', ['Less', 0, 'c'], ['Assign', 'a', ['Sqrt', ['Negate', 'x']]]],
        'a',
      ],
      /different shapes/,
      { mode: 'strict' },
      'unsettled-shape'
    );
  });

  test('a Break is a statement of the loop body, or the branch of an If with no else branch', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    const loop = (body: unknown) => [
      'Block',
      ['Assign', 's', 0],
      ['Loop', body, ['Element', 'k', ['Range', 1, 3]]],
      's',
    ];
    inOn(
      e,
      loop([
        'Block',
        ['If', ['Less', 'x', 'k'], ['Break']],
        ['Assign', 's', ['Add', 's', 'k']],
      ])
    );
    const misplaced =
      /A `Break` of a `Loop` is in the GLSL fragment as a statement/;
    outOn(
      e,
      loop([
        'Assign',
        's',
        ['Add', 's', ['Block', ['If', ['Less', 1, 'x'], ['Break']], 'k']],
      ]),
      misplaced
    );
    outOn(
      e,
      loop(['If', ['Less', 1, 'x'], ['Break'], ['Assign', 's', 1]]),
      misplaced
    );
    outOn(
      e,
      loop([
        'Which',
        ['Less', 1, 'x'],
        ['Break'],
        ['Less', 0, 'x'],
        ['Assign', 's', 1],
      ]),
      misplaced
    );
  });

  test('a destructuring takes a literal tuple, or the call of a user function', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('t', 'tuple<number, number>');
    e.assign('t', e.box(['Tuple', 3, 4]));
    inOn(e, [
      'Block',
      ['Declare', ['Tuple', 'a', 'b'], "'unknown'", ['Tuple', 'x', 2]],
      ['Add', 'a', 'b'],
    ]);
    outOn(
      e,
      [
        'Block',
        [
          'Declare',
          ['Tuple', 'a', 'b'],
          ['Dictionary', ['KeyValuePair', { str: 'value' }, 't']],
        ],
        ['Add', ['Multiply', 10, 'a'], 'b'],
      ],
      /The value of the destructuring declaration, `t`, is not a literal tuple/
    );
    outOn(
      e,
      [
        'Block',
        ['Declare', 'a', "'unknown'", 0],
        ['Declare', 'b', "'unknown'", 0],
        ['Assign', ['Tuple', 'a', 'b'], 't'],
        ['Add', ['Multiply', 10, 'a'], 'b'],
      ],
      /The value of the destructuring assignment, `t`, is not a literal tuple/
    );
  });

  test('a Which with no default clause has a GLSL value for Missing only when it is a number or a point', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('t', 'real');
    e.declare('c', 'boolean');
    inOn(e, ['Which', 'c', ['Tuple', 1, 2]]);
    outOn(
      e,
      ['Which', 'c', ['List', 1, 2, 3, 4, 5]],
      /no representation of `Missing`/
    );
    outOn(
      e,
      [
        'Which',
        ['Greater', 'x', 0],
        'True',
        ['Greater', ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]], 3],
        'False',
      ],
      /no representation of `Missing`/,
      { constantFold: false }
    );
  });

  test('types that the emitter reads as another shape', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('y', 'real');
    // The finite part of the element type is complex.
    e.declare('u', 'list<complex | +oo | -oo ^2>');
    outOn(e, ['Add', 'u', 'u'], /The symbol `u` has the type/);
    // There is no `vec1`.
    e.declare('v1', 'vector<1>');
    outOn(e, ['At', 'v1', 1], /list of one element/);
    // A list of no stated length is not a point, whatever its value.
    e.declare('P', 'list<real>');
    e.assign('P', e.box(['List', 'x', 'y']));
    outOn(
      e,
      ['Add', 'x', ['PointX', 'P']],
      /a list with no stated length, not a point/
    );
    // `Sqrt(-2)` is complex, and `Mod` takes reals only; `Sqrt(x)` is real.
    outOn(e, ['Mod', ['Sqrt', -2], 1], /No signature of `Mod`/, {
      constantFold: false,
    });
    inOn(e, ['Mod', ['Sqrt', 'x'], 1], { constantFold: false });
    inOn(e, ['Add', ['Sqrt', -2], 1], { constantFold: false });
  });

  test('a color operand in two color spaces', () => {
    const e = new ComputeEngine();
    e.declare('u', 'number');
    e.declare('v', 'number');
    outOn(
      e,
      [
        'ColorMix',
        [
          'Which',
          ['Greater', 'u', 0],
          ['AsRgb', ['Hsv', 'u', 0.5, 0.5]],
          'True',
          ['AsHsv', ['Hsv', 'v', 0.5, 0.5]],
        ],
        ['Rgb', 0, 0, 1],
        0.5,
      ],
      /holds colors in different color spaces/
    );
  });

  test('user functions and caller code', () => {
    // A stored value that reads the parameter of the function that reads it.
    const e = new ComputeEngine();
    e.assign('a', e.parse('3t + 1'));
    e.assign('g', e.parse('(t) \\mapsto t + a'));
    outOn(e, ['g', 2], /mentions `t`/);

    // A body that contradicts the declared result.
    const e2 = new ComputeEngine();
    e2.declare('a', { signature: '(number) -> number' });
    e2.assign('a', e2.box(['Function', ['h', 't'], 't']));
    e2.assign(
      'h',
      e2.box(['Function', ['List', ['Cos', 't'], ['Sin', 't']], 't'])
    );
    e2.declare('u', 'number');
    outOn(e2, ['Add', ['a', 'u'], 1], /contradicts its declared result type/);

    // A value that admits a point and another shape.
    const e3 = new ComputeEngine();
    e3.declare('x', 'real');
    e3.declare('t', 'real');
    e3.declare('H', '(real) -> list<number> | tuple<number, number>');
    outOn(e3, ['Abs', ['H', 't']], /admits a point and another shape/, {
      functions: { H: (t: number) => [3 * t, -4 * t] },
    });
    e3.declare(
      'Q',
      '(real) -> list<tuple<number, number>> | tuple<number, number>'
    );
    e3.assign(
      'Q',
      e3.box([
        'Function',
        ['Block', ['Assign', 'r', ['Tuple', 'x', 1]], 'r'],
        'x',
      ])
    );
    outOn(e3, ['Norm', ['Q', 'x']], /admits more than one shape/);
    e3.declare('PU', 'list<tuple<number, number>> | tuple<number, number>');
    e3.assign('PU', e3.box(['Tuple', 3, 4]));
    outOn(
      e3,
      [
        'Block',
        ['Assign', 's', 0],
        ['Assign', 's', ['Add', 's', ['Multiply', ['At', 'PU', 1], 'x']]],
        's',
      ],
      /may be a point by its type/
    );

    // A `vars` entry that is a name or a field.
    const e4 = new ComputeEngine();
    e4.declare('x', 'real');
    expect(inOn(e4, ['Power', 'x', 2], { vars: { x: 'v_pos.x' } })).toContain(
      'v_pos.x'
    );
  });
});

describe('phase C2, review fixes', () => {
  function outOn(
    engine: ComputeEngine,
    json: unknown,
    message: RegExp,
    options: Record<string, unknown> = {}
  ): void {
    const expr = engine.box(json as any);
    const r = canCompile(expr, { to: 'glsl', ...options });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostic.message).toMatch(message);
    const result = compile(expr, { to: 'glsl', ...options });
    expect(result.success).toBe(false);
  }
  function inOn(
    engine: ComputeEngine,
    json: unknown,
    options: Record<string, unknown> = {}
  ): string {
    const expr = engine.box(json as any);
    expect(canCompile(expr, { to: 'glsl', ...options })).toEqual({ ok: true });
    const result = compile(expr, { to: 'glsl', fallback: false, ...options });
    expect(result.success).toBe(true);
    return String(result.code);
  }

  test('a `vars` entry that is code is caller code, computed once into a temporary', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    expect(inOn(e, ['Add', 'x', 1], { vars: { x: 'u.x + 1.0' } })).toContain(
      'u.x + 1.0'
    );
    inOn(e, ['Multiply', 'x', 2], { vars: { x: 'v_uv.x * 2.0' } });
    inOn(e, ['Add', 'x', 1], { vars: { x: '-3' } });
    // `cot(x)` is `cos(x) / sin(x)`: the code is computed once, into a
    // temporary ahead of the statement (`gpu-caller-binding.ts`).
    expect(inOn(e, ['Cot', 'x'], { vars: { x: 'draw()' } })).toBe(
      'float _tv1 = draw();\nreturn (_gpu_cos(_tv1) / _gpu_sin(_tv1));'
    );
  });

  test('an operand with caller code that the code writes twice is computed once', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    const functions = { F: 'external_f' };
    inOn(e, ['Round', ['F', 'x']], { functions });
    inOn(e, ['Power', ['F', 'x'], 2], { functions });
    // The real branch of `Power` with a constant non-integer exponent writes
    // the base twice (`sign(b) * pow(abs(b), e)`): the call is computed once,
    // into a temporary.
    expect(
      inOn(e, ['Power', ['F', 'x'], ['Rational', 1, 3]], { functions })
    ).toBe(
      'float _tv1 = external_f(x);\n' +
        'return (sign(_tv1) * pow(abs(_tv1), 0.33333334));'
    );
  });

  test('a value with no settled shape is refused also when the expression calls caller code', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    outOn(
      e,
      ['Add', ['Block', ['Assign', 'q', 2], 'q'], ['F', 'x']],
      /a block with a statement other than/,
      { functions: { F: 'external_f' } }
    );
  });

  test('decision 15: a number added to a name declared with a GLSL vector type', () => {
    const e = new ComputeEngine();
    const glsl = e._getCompilationTarget('glsl') as unknown as {
      compileFunction(
        e: unknown,
        name: string,
        ret: string,
        params: [string, string][]
      ): string;
    };
    expect(
      glsl.compileFunction(e.box(['Add', 'v', 1]), 'f', 'vec2', [
        ['v', 'vec2'],
      ])
    ).toContain('v + 1.0');
    expect(
      glsl.compileFunction(e.box(['Subtract', 'v', 1]), 'f', 'vec2', [
        ['v', 'vec2'],
      ])
    ).toContain('v + -1.0');
    // A point of the expression beside a number is still refused.
    expect(() =>
      glsl.compileFunction(
        e.box([
          'Block',
          ['Assign', 'q', ['Tuple', 'u', 'u']],
          ['Add', 'v', 'q', 1],
        ]),
        'f',
        'vec2',
        [
          ['v', 'vec2'],
          ['u', 'float'],
        ]
      )
    ).toThrow(/may be a point by its type/);
  });

  test('a user function whose code would be over the size limit is refused', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('c', 'real');
    const t = e.symbol('t');
    // `e_{k+1} = If(t > k, e_k, Sin(e_k))`: the two branches read the
    // level below, so its code doubles at each level.
    let body = e.function('Add', [t, e.symbol('c')]);
    for (let i = 0; i < 14; i++)
      body = e.function('If', [
        e.function('Greater', [t, e.number(i)]),
        body,
        e.function('Sin', [body]),
      ]);
    e.declare('h', '(real) -> real');
    e.assign('h', e.function('Function', [body, t]));
    outOn(e, ['h', 'x'], /would have more than 50,000 nodes/);
  });

  test('a base of At in a texture with no stated length, an empty one, or a tuple', () => {
    for (const type of ['list<number>', 'list<number^0>', 'tuple<number, number>']) {
      const e = new ComputeEngine();
      e.declare('S', type);
      e.declare('k', 'integer');
      outOn(e, ['At', 'S', 'k'], /"S" is sampler2D-backed/, {
        storage: { S: 'sampler2D' },
      });
    }
  });
});

describe('phase C2, third review fixes', () => {
  function outOn(
    engine: ComputeEngine,
    json: unknown,
    message: RegExp,
    options: Record<string, unknown> = {}
  ): void {
    const expr = engine.box(json as any);
    const r = canCompile(expr, { to: 'glsl', ...options });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostic.message).toMatch(message);
    const result = compile(expr, { to: 'glsl', ...options });
    expect(result.success).toBe(false);
  }
  function inOn(
    engine: ComputeEngine,
    json: unknown,
    options: Record<string, unknown> = {}
  ): string {
    const expr = engine.box(json as any);
    expect(canCompile(expr, { to: 'glsl', ...options })).toEqual({ ok: true });
    const result = compile(expr, { to: 'glsl', fallback: false, ...options });
    expect(result.success).toBe(true);
    return String(result.code);
  }
  type GlslTarget = {
    compileFunction(
      e: unknown,
      name: string,
      ret: string,
      params: [string, string][]
    ): string;
    compileShader(shader: unknown): string;
  };
  /** `e_depth`, with `e_0 = t + c` and `e_{k+1} = e_k + Sin(e_k)`: each
   *  level reads the level below twice, the same node object. */
  function graph(e: ComputeEngine, t: Expression, depth: number): Expression {
    let g = e.function('Add', [t, e.symbol('c')]);
    for (let i = 0; i < depth; i++)
      g = e.function('Add', [g, e.function('Sin', [g])]);
    return g;
  }

  test('the size of a user function is measured with the `cse` option of compile()', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('c', 'real');
    const t = e.symbol('t');
    e.declare('h', '(real) -> real');
    e.assign('h', e.function('Function', [graph(e, t, 14), t]));
    // With no node shared, the body has more than 50,000 nodes.
    outOn(e, ['h', 'x'], /would have more than 50,000 nodes/, { cse: false });
    // The common-subexpression pass of the definition shares each level.
    inOn(e, ['h', 'x']);
  });

  test('decision 15: an arithmetic expression of declared vectors takes a number', () => {
    const e = new ComputeEngine();
    const glsl = e._getCompilationTarget('glsl') as unknown as GlslTarget;
    expect(
      glsl.compileFunction(
        e.box(['Subtract', ['Multiply', 'uv', 2], 1]),
        'f',
        'vec2',
        [
          ['uv', 'vec2'],
        ]
      )
    ).toMatch(/return 2\.0 \* uv (\+ -1\.0|- 1\.0);/);
    expect(
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'o', type: 'vec4' }],
        body: [
          {
            variable: 'o',
            expression: e.box([
              'Add',
              ['Multiply', 2, 'gl_FragCoord'],
              1,
            ]),
          },
        ],
      })
    ).toContain('o = 2.0 * gl_FragCoord + 1.0;');
    // A point of the user's expression in the operand stays out.
    expect(() =>
      glsl.compileFunction(
        e.box([
          'Block',
          ['Assign', 'q', ['Tuple', 'u', 'u']],
          ['Add', ['Multiply', 2, 'q'], 1],
        ]),
        'f',
        'vec2',
        [['u', 'float']]
      )
    ).toThrow(/may be a point by its type/);
  });

  test('decision 15: a parameter with the name of a declared vector is not the vector', () => {
    const e = new ComputeEngine();
    // The parameter `v` of `f` takes a point of the user's expression,
    // not the `vec2` input `v` of the shader function: `(1, 2) + 1` is
    // an `incompatible-type` error in the interpreter.
    e.declare('f', '(any) -> any');
    e.assign('f', e.box(['Function', ['Add', 'v', 1], 'v']));
    const glsl = e._getCompilationTarget('glsl') as unknown as GlslTarget;
    expect(() =>
      glsl.compileFunction(
        e.box(['f', ['Tuple', 1, 2]]),
        'g',
        'vec2',
        [['v', 'vec2']]
      )
    ).toThrow(/No signature of `Add`.*in the body of the user function `f`/);
  });

  test('a block search of the operands of And visits a shared graph once per node', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('c', 'real');
    // At depth 27 the graph has about 2^27 paths and 80 distinct nodes. A
    // search of each path took about 1.3 s, and doubles at each level; the
    // search of each node, with the rest of canCompile(), about 10 ms. The
    // depth is kept small because the canonical form of each level takes a
    // time that also doubles at each level (about 4 s here).
    const expr = e.function('And', [
      e.function('Greater', [e.symbol('x'), e.number(0)]),
      e.function('Less', [graph(e, e.symbol('x'), 27), e.number(1)]),
    ]);
    const start = Date.now();
    expect(canCompile(expr, { to: 'glsl' })).toEqual({ ok: true });
    expect(Date.now() - start).toBeLessThan(500);
  });

  test('At over a list of one point compiles', () => {
    const e = new ComputeEngine();
    e.declare('P', 'list<tuple<real, real>^1>');
    e.declare('k', 'integer');
    inOn(e, ['At', 'P', 'k']);
  });

});

/**
 * The value of an inverse function of a real operand can be complex
 * (`Arcsin(2)` is `1.5708 - 1.3170i`), and the compiler then writes the
 * complex helper (`_gpu_casin(vec2(x, 0.0))`). The pass types such a node
 * as complex, so that the representation of each node is the GLSL type of
 * its code, and a head that takes reals only refuses it, as the emitter
 * declines it.
 */
describe('an elementary function whose value on a real is complex', () => {
  const glsl = ce._getCompilationTarget('glsl') as unknown as {
    _fragmentAnnotationForTest(
      expr: Expression,
      options: Record<string, unknown>
    ): {
      root: Expression;
      scope: { facts: Map<Expression, { representation?: string }> };
    };
  };
  const representationOf = (json: unknown): string | undefined => {
    const a = glsl._fragmentAnnotationForTest(ce.box(json as any), {
      to: 'glsl',
    });
    return a.scope.facts.get(a.root)?.representation;
  };

  test.each([
    [['Arcsin', 'x'], 'vec2'],
    [['Multiply', 'x', ['Arcsin', 'x']], 'vec2'],
    [['Sin', ['Arcosh', 'x']], 'vec2'],
    [['Real', ['Arccos', 'x']], 'float'],
    // A real operand in [-1, 1] by its type: the value is real.
    [['Arccos', ['Clamp', 'x', -1, 1]], 'float'],
  ])('%j is in, with the representation %s', (json, representation) => {
    expectIn(json);
    expect(representationOf(json)).toBe(representation);
  });

  test('the code reads the operand as a complex number', () =>
    expect(compile(ce.box(['Arcsin', 'x']), { to: 'glsl' }).code).toBe(
      '_gpu_casin(vec2(x, 0.0))'
    ));

  test.each([
    [['Max', ['Arcsin', 'x'], 0], 'Max'],
    [['Mod', ['Arccos', 'x'], 1], 'Mod'],
    [['Floor', ['Arcsin', 'x']], 'Floor'],
    [['Hypot', ['Arcsin', 'x'], 1], 'Hypot'],
    [['Less', ['Arcsin', 'x'], 1], 'Less'],
  ])('%j is out, and compile() declines it', (json, operator) => {
    expectOut(json, operator);
    expect(
      compile(ce.box(json as any), { to: 'glsl', fallback: true }).success
    ).toBe(false);
  });

  // In the body of a user function, a parameter named `i` is a real, not
  // the imaginary unit: the question is asked with the parameter bound, as
  // the emitter asks it. The value is real (`h(2)` is `0.8476`, `s(2)`
  // is `Sqrt(5) - 2`), and the code reads it as a `float`.
  test.each([
    [
      'h',
      'h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)',
      'float _fn_h(float i)',
    ],
    [
      's',
      's(i)\\coloneq\\operatorname{mod}(\\sqrt{i^2+1},1)',
      'float _fn_s(float i)',
    ],
  ])('a parameter named `i` in the body of %s is a real', (name, latex, fn) => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.parse(latex).evaluate();
    const expr = e.box([name, 'x']);
    expect(canCompile(expr, { to: 'glsl' })).toEqual({ ok: true });
    const result = compile(expr, { to: 'glsl', fallback: false });
    expect(result.preamble).toContain(fn);
  });
});
