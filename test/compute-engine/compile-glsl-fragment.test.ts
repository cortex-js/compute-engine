/**
 * CE-1166.3, phase B: `canCompile()` types the prepared tree with the GLSL
 * fragment and returns a diagnostic for the first node outside it.
 *
 * The fragment is the positive list of
 * `docs/plans/2026-11-08-glsl-fragment-spec.md`, section 2. Each line of
 * the list has one case in and one case out here. The walk rules are those
 * of `docs/plans/2026-11-08-glsl-fragment-annotation-design.md`, section 4.
 *
 * `compile()` does not call the predicate yet: these tests check only the
 * answer of `canCompile()`.
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
    ].join('\n')
  ).diagnostics
).toEqual([]);
ce.declare('H', 'list<real^1600>');

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
  test('points and vectors: in', () =>
    expect(check(pointsAndVectors)).toEqual({ ok: true }));
  // `compile()` refuses this expression today: "Could not compile `Dot`:
  // the shader builtin `dot` requires MATCHING genType arguments, but it is
  // applied to a vec3 operand and a scalar one". The fragment admits it:
  // `Normalize` and `Cross` of a point of 3 components are points of 3
  // components. When the emitter compiles it, this test fails, and the
  // expression moves to the list of cases that are in above.
  test.failing('points and vectors: compile() gives code', () =>
    expectIn(pointsAndVectors));

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
    expect(check(sumOverRange)).toEqual({ ok: true }));
  // `compile()` refuses this expression today: "Could not compile `Sum`:
  // expected Limits indexing set". The fragment admits a `Range` as the
  // index set of a `Sum`. When the emitter compiles it, this test fails,
  // and the case becomes a plain `expectIn()`.
  test.failing('a Range as the index set of a Sum: compile() gives code', () =>
    expectIn(sumOverRange));
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
  test('a parallel loop with a scalar accumulator is in', () =>
    expect(check(['S', 'x'])).toEqual({ ok: true }));
  // `compile()` refuses this call today: "Could not compile
  // `ParallelLoop`: the `parallel for` construct compiles only to the
  // JavaScript target, not to 'glsl'". The fragment admits a parallel loop
  // with a scalar accumulator in the body of a user function. When the
  // emitter compiles it, this test fails, and the case becomes a plain
  // `expectIn()`.
  test.failing('a parallel loop with a scalar accumulator: compile() gives code', () =>
    expectIn(['S', 'x']));
  test('a list parameter bound to a list input in a texture is in', () =>
    expectIn(['g', 'H', 'x'], { storage: { H: 'sampler2D' } }));
  test('a list parameter bound to a list that is not in a texture is out', () => {
    expectOut(['g', 'H', 'x']);
  });
  test('a block at the root of the expression is out', () => {
    const r = expectOut(
      ['Block', ['Declare', 't', valueOf('x')], ['Add', 't', 1]],
      'Block'
    );
    expect(r.diagnostic.message).toMatch(/only in the body of a user function/);
  });
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
    // A condition folded to `False` drops its pair: neither operand is read.
    expect(kinds(['Which', 'False', 'x', 'b', 'z', 'True', 'x'])).toEqual([
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
