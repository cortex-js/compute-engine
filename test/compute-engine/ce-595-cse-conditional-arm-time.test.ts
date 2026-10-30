/**
 * CE-595: the common-subexpression pass (`harvestCse()`, `cse.ts`) took
 * exponential time on a graph that reads a node again inside a conditional
 * arm, although the code it gave was small.
 *
 * The witnesses are two graphs with one node object per level:
 * - `e_0 = sin(x)`, `e_{k+1} = Arctan2(e_k, If(x > k, e_k, 0))`;
 * - `e_0 = sin(x)`, `e_{k+1} = When(sin(e_k), e_k > k)` (the condition of a
 *   `When` is written first, and its value is the conditional arm).
 *
 * The arm is a region of its own, so the walk of `e_k` in the arm was not a
 * replay of the walk of `e_k` before the arm: it opened a copy of every
 * region below `e_k`, and the number of regions doubled at each level. At
 * depth 14 the first graph took 36 seconds. The emitted code is linear: the
 * arm reads the temporary of `e_k`, which the code before the arm binds.
 *
 * Now, when the walk in full opens more regions than a budget that is
 * linear in the number of the edges that can open a region
 * (`harvestRegionBudget`, `regionSites`), the harvest is made
 * again, and the walk in the arm replays the walk before the arm
 * (`Harvester.earlierWalkAbove`). Below the budget the harvest is the walk
 * in full, as before. Above it the selection can be different (it does not
 * count the occurrences in the copies), but on these two graphs the emitted
 * code is the same as before the change.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { harvestCse } from '../../src/compute-engine/compilation/cse';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce;
}

/** `e_{k+1} = Arctan2(e_k, If(x > k, e_k, 0))`, with `e_0 = sin(x)`. */
function ifArmGraph(ce: ComputeEngine, depth: number): Expression {
  let e = ce.function('Sin', [ce.symbol('x')]);
  for (let k = 0; k < depth; k++)
    e = ce.function('Arctan2', [
      e,
      ce.function('If', [
        ce.function('Greater', [ce.symbol('x'), ce.number(k)]),
        e,
        ce.number(0),
      ]),
    ]);
  return e;
}

/** `e_{k+1} = When(sin(e_k), e_k > k)`, with `e_0 = sin(x)`. */
function whenArmGraph(ce: ComputeEngine, depth: number): Expression {
  let e = ce.function('Sin', [ce.symbol('x')]);
  for (let k = 0; k < depth; k++)
    e = ce.function('When', [
      ce.function('Sin', [e]),
      ce.function('Greater', [e, ce.number(k)]),
    ]);
  return e;
}

const GRAPHS = [
  ['If arm', ifArmGraph],
  ['When value', whenArmGraph],
] as const;

function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
}

// Wall-clock limits are checked only in a `CE_PERF=1` run
// (`npm run test:perf`), which runs the timing suites alone. The region
// counts and the code sizes are checked in every run.
function expectFast(ms: number, ceiling: number): void {
  if (process.env.CE_PERF === '1') expect(ms).toBeLessThan(ceiling);
}

describe('CE-595: a node read again in a conditional arm', () => {
  for (const [name, graph] of GRAPHS) {
    test(`${name}: the harvest has a linear number of regions`, () => {
      const ce = engine();
      const harvest = harvestCse(graph(ce, 20));
      // One region for the root and one for each arm. Before the change,
      // there were 2^21 - 1 regions (If arm) and 2^20 regions (When value).
      expect(harvest.regions.length).toBeLessThanOrEqual(41);
    });

    for (const to of ['wgsl', 'glsl', 'javascript'] as const) {
      test(`${name}: depth 20 compiles quickly to ${to}`, () => {
        const ce = engine();
        const e = graph(ce, 20);
        const [result, ms] = timed(() => compile(e, { to }));
        expect(result.success).toBe(true);
        // About 2,400 characters; 100 to 120 for each level.
        expect(result.code.length).toBeLessThan(3_000);
        expectFast(ms, 2_000);
      });
    }
  }
});

// A `Sum` binds its loop invariants to names in its own body
// (`hoistLoopInvariants`) and gives the nodes of the invariant that name,
// wherever they are in the body. A narrowed arm compiles its nodes with
// clamped inputs, and the arms nested in it are local functions defined
// outside the `Sum`. So a narrowed arm reads no such name
// (`BaseCompiler.withoutNodeCodeOverrides`).
describe('CE-595: loop invariants and narrowed arms', () => {
  function ceXY(): ComputeEngine {
    const ce = engine();
    ce.declare('y', 'real');
    ce.declare('n', 'integer');
    return ce;
  }

  // The nested arm `Arctan2(x, s)` is a function of the arm table of the
  // outer arm. It read the name the `Sum` gives to `s = sin(y)`, which is
  // declared in the body of the `Sum`, not where the function is defined:
  // a ReferenceError when the arm ran.
  test('an arm function does not read a name bound in a Sum', () => {
    const ce = ceXY();
    const f = (op: string, ...ops: Expression[]) => ce.function(op, ops);
    const x = ce.symbol('x');
    const s = f('Sin', ce.symbol('y'));
    const A = f(
      'Arctan2',
      s,
      f('If', f('Less', x, ce.number(1)), f('Arctan2', x, s), ce.number(0))
    );
    const e = f(
      'If',
      f('Greater', x, ce.number(0)),
      f(
        'Sum',
        f('Add', ce.symbol('j'), A),
        f('Limits', ce.symbol('j'), ce.number(1), ce.number(1000))
      ),
      ce.number(0)
    );
    const result = compile(e, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(
      result.run!({ x: { lo: 0.5, hi: 0.7 }, y: { lo: 0, hi: 1 } })
    ).toEqual({
      kind: 'interval',
      value: { lo: 500499.99999997433, hi: 501503.50858892244 },
    });
  });

  // The `Sum` bound `x > 1` and `ln(x - 1)` and gave the same name to the
  // equal nodes in the nested arm, where `x` is clamped: the arm read the
  // value over the inputs that are not clamped, and the result was
  // `partial`. Before the change, the `Sum` alone (not in an arm) gave
  // `partial` too.
  test('a narrowed arm in a Sum reads no loop invariant of the Sum', () => {
    const ce = ceXY();
    const sum = [
      'Sum',
      [
        'If',
        ['Greater', 'x', 1],
        ['Ln', ['Add', 'k', 'x']],
        [
          'If',
          ['Greater', 'x', 1],
          ['Ln', ['Subtract', 'x', 1]],
          ['Arccos', 'x'],
        ],
      ],
      ['Limits', 'k', 1, 'n'],
    ];
    const want = {
      kind: 'interval',
      value: { lo: 0, hi: 2.2999605196919664 },
    };
    for (const json of [sum, ['If', ['Less', 'x', 5], sum, 0]]) {
      const result = compile(ce.box(json as any), { to: 'interval-js' });
      expect(result.success).toBe(true);
      expect(
        result.run!({ x: { lo: 0.5, hi: 1.5 }, n: { lo: 2, hi: 2 } })
      ).toEqual(want);
    }
  });
});

// The CSE harvest of a narrowed arm decides whether two calls of `f` can be
// merged by reading the definition of `f`. The arm's harvest looked `f` up
// in the engine even when `f` names a block-local function, so with a pure
// engine-level `f` it merged the two calls of the local `f`, whose body calls
// host code: one call of `g` instead of two. Now the names that the scope
// of the arm binds are shadowed in its harvest
// (`BaseCompiler.withOwnCseHarvest`).
describe('CE-595: a block-local function in a narrowed arm', () => {
  test('two calls of a local function that shadows a pure global one', () => {
    for (const nested of [false, true]) {
      const ce = engine();
      ce.assign('f', ce.box(['Function', ['Multiply', 'u', 2], 'u']));
      const arm = ['Arctan2', ['f', 'x'], ['f', 'x']];
      const e = ce.box([
        'Block',
        ['Declare', 'f', "'function'"],
        ['Assign', 'f', ['Function', ['g', 'u'], 'u']],
        nested
          ? [
              'If',
              ['Greater', 'x', 0],
              ['Arctan2', ['Sqrt', 'x'], ['If', ['Greater', 'x', 1], arm, 0]],
              0,
            ]
          : ['If', ['Greater', 'x', 0], arm, 0],
      ] as any);
      const host = globalThis as { __ce595Calls?: number };
      const result = compile(e, {
        to: 'interval-js',
        fallback: false,
        functions: {
          // The host code is passed as its source text, so it reads the
          // counter through `globalThis`, not through a captured name.
          g: (v: unknown) => {
            (globalThis as { __ce595Calls?: number }).__ce595Calls =
              ((globalThis as { __ce595Calls?: number }).__ce595Calls ?? 0) + 1;
            return v;
          },
        },
      } as never);
      expect(result.success).toBe(true);
      host.__ce595Calls = 0;
      result.run!({ x: { lo: 1, hi: 2 } } as never);
      expect(host.__ce595Calls).toBe(2);
      delete host.__ce595Calls;
    }
  });
});

// The region budget is counted over the edges that can open a region, not
// over all the nodes: terms that open no region do not raise it. With a
// budget of 4 times the nodes plus 256, these terms let the walk in full
// open 2^14 regions: 35 seconds for the harvest.
describe('CE-595: nodes that open no region do not raise the budget', () => {
  test('the If graph at depth 14 next to 20 terms of 10 nodes', () => {
    const ce = engine();
    const f = (op: string, ...ops: Expression[]) => ce.function(op, ops);
    const x = ce.symbol('x');
    const terms: Expression[] = [ifArmGraph(ce, 14)];
    for (let j = 0; j < 20; j++) {
      let g = f('Cos', f('Multiply', x, ce.number(j + 2)));
      for (let i = 0; i < 10; i++)
        g = f('Sin', f('Add', g, ce.number(i + 1000 * j)));
      terms.push(f('Multiply', g, g));
    }
    const e = f('Add', ...terms);
    const [harvest, ms] = timed(() => harvestCse(e));
    expect(harvest.regions.length).toBeLessThanOrEqual(29);
    expectFast(ms, 1_000);
    const [result, compileMs] = timed(() => compile(e, { to: 'javascript' }));
    expect(result.success).toBe(true);
    expect(result.code.length).toBeLessThan(8_000);
    expectFast(compileMs, 1_000);
  });
});

// A replay is used only for an arm that reads the temporary of the node.
// When the selection does not credit an arm to a candidate (here `W`, a
// `When` read again in an arm), the harvest is made again with `W` walked
// in full in its arm, and the other arms still replay. Before, one such arm
// turned off every replay, and the time was exponential again (2.4 seconds
// at depth 12).
describe('CE-595: an arm that does not read a temporary', () => {
  function withUnservedArm(ce: ComputeEngine, depth: number): Expression {
    const x = ce.symbol('x');
    const W = ce.function('When', [
      ce.function('Cos', [ce.symbol('y')]),
      ce.function('Less', [ce.number(0), ce.function('Sin', [x])]),
    ]);
    const extra = ce.function('Arctan2', [
      W,
      ce.function('If', [
        ce.function('Less', [ce.number(8), x]),
        W,
        ce.number(0),
      ]),
    ]);
    return ce.function('Add', [ifArmGraph(ce, depth), extra]);
  }

  test('depth 20 has a linear number of regions and small code', () => {
    const ce = engine();
    ce.declare('y', 'real');
    const e = withUnservedArm(ce, 20);
    expect(harvestCse(e).regions.length).toBeLessThanOrEqual(50);
    const [result, ms] = timed(() => compile(e, { to: 'javascript' }));
    expect(result.success).toBe(true);
    // About 2,100 characters.
    expect(result.code.length).toBeLessThan(3_000);
    expectFast(ms, 2_000);
  });
});

// Two graphs where the selection with replays binds other nodes than the
// walk in full (found by comparing random graphs). They are below the region
// budget, so the harvest is the walk in full and the code is the code before
// the change.
describe('CE-595: below the region budget, the code does not change', () => {
  function ce2(): ComputeEngine {
    const ce = engine();
    ce.declare('y', 'real');
    return ce;
  }

  /** With replays, the arm does not bind `cos(y)`, which it reads once. */
  function graphA(ce: ComputeEngine): Expression {
    const f = (op: string, ...ops: Expression[]) => ce.function(op, ops);
    const x = ce.symbol('x');
    const y = ce.symbol('y');
    const W = f(
      'If',
      f('Greater', f('Sin', x), ce.number(0)),
      f('Cos', y),
      f('Exp', x)
    );
    return f(
      'Add',
      W,
      f(
        'If',
        f('Greater', x, ce.number(0)),
        f('Multiply', f('Cos', y), W),
        ce.number(0)
      )
    );
  }

  /** A node `X` read in nested arms. */
  function graphB(ce: ComputeEngine): Expression {
    const f = (op: string, ...ops: Expression[]) => ce.function(op, ops);
    const x = ce.symbol('x');
    const y = ce.symbol('y');
    const X = f('Add', x, y, f('Cos', y));
    return f(
      'Add',
      f('Exp', X),
      f(
        'If',
        f('Greater', y, ce.number(0)),
        f(
          'Multiply',
          y,
          f('If', f('Less', x, ce.number(1)), f('Multiply', X, f('Sin', x)), X)
        ),
        ce.number(0)
      ),
      f('If', f('Greater', x, ce.number(2)), f('Ln', X), ce.number(0))
    );
  }

  test('A, JavaScript', () => {
    expect(compile(graphA(ce2()), { to: 'javascript' }).code).toBe(
      '(() => { const _cse1 = ((_.x !== undefined) ? ((0 < Math.sin(_.x)) ? (Math.cos(_.y)) : (Math.exp(_.x))) : NaN); ' +
        'return _cse1 + ((_.x !== undefined) ? ((0 < _.x) ? ((() => { const _cse2 = Math.cos(_.y); return _cse2 * _cse1; })()) : (0)) : NaN); })()'
    );
  });

  test('A, GLSL', () => {
    expect(compile(graphA(ce2()), { to: 'glsl' }).code).toBe(
      [
        'float _cse1 = ((0.0 < sin(x)) ? (cos(y)) : (exp(x)));',
        'return _cse1 + ((0.0 < x) ? (cos(y) * _cse1) : (0.0));',
      ].join('\n')
    );
  });

  test('B, GLSL', () => {
    expect(compile(graphB(ce2()), { to: 'glsl' }).code).toBe(
      [
        'float _cse1 = x + y + cos(y);',
        'float _tv2;',
        'if (0.0 < y) {',
        '  _tv2 = y * ((x < 1.0) ? (_cse1 * sin(x)) : (_cse1));',
        '} else {',
        '  _tv2 = 0.0;',
        '}',
        'return exp(_cse1) + ((2.0 < x) ? (log(_cse1)) : (0.0)) + _tv2;',
      ].join('\n')
    );
  });
});

// The interval target had two more defects on these graphs.
// - It compiled an `If` arm again over the inputs narrowed to where the arm
//   can be selected (`compileNarrowedIntervalArm`), without the CSE pass, and
//   wrote it two times (the arm, and the hull of the two arms). The arm did
//   not share the nodes of `e_k`, and the code of the `If` graph doubled at
//   each level: 314 KB at depth 10, out of memory at depth 20. Now a
//   narrowed arm has a CSE harvest of its own, a clamp that cannot change
//   the value is not written (the arm in the arm of `x > k` is narrowed by
//   `x > k - 1`), and the arms nested in a narrowed arm are functions that
//   are compiled once. The values are the same as before.
// - A check of the block-local functions (`assertSpelledLocalCallsConsumed`)
//   walked the graph once per path: 8 seconds at depth 28 for the `When`
//   graph. Now it visits each node object once.
describe('CE-595: the interval target', () => {
  test('If arm: an arm nested in a narrowed arm is not clamped again', () => {
    expect(compile(ifArmGraph(engine(), 3), { to: 'interval-js' }).code).toBe(
      '(() => { const _cse1 = _IA.sin(_.x); ' +
        "const _cse3 = _IA.atan2(_cse1, ((_tv2 = _IA.less(_k1, _.x)) === 'true' ? _IA.res(_cse1) : _tv2 === 'false' ? _IA.res(_k1) : _IA.hull(_cse1, _k1))); " +
        "const _cse8 = _IA.atan2(_cse3, ((_tv7 = _IA.less(_k2, _.x)) === 'true' ? _IA.res(((_tv4) => (() => { const _cse5 = _IA.sin(_tv4); return _IA.atan2(_cse5, ((_tv6 = _IA.less(_k1, _tv4)) === 'true' ? _IA.res(_cse5) : _tv6 === 'false' ? _IA.res(_k1) : _IA.hull(_cse5, _k1))); })())(_IA.max(_.x, _k2))) : _tv7 === 'false' ? _IA.res(_k1) : _IA.hull(((_tv4) => (() => { const _cse5 = _IA.sin(_tv4); return _IA.atan2(_cse5, ((_tv6 = _IA.less(_k1, _tv4)) === 'true' ? _IA.res(_cse5) : _tv6 === 'false' ? _IA.res(_k1) : _IA.hull(_cse5, _k1))); })())(_IA.max(_.x, _k2)), _k1))); " +
        "return _IA.atan2(_cse8, ((_tv14 = _IA.less(_k3, _.x)) === 'true' ? _IA.res(((_tv9) => (() => { const _cse10 = _IA.sin(_tv9); const _cse12 = _IA.atan2(_cse10, ((_tv11 = _IA.less(_k1, _tv9)) === 'true' ? _IA.res(_cse10) : _tv11 === 'false' ? _IA.res(_k1) : _IA.hull(_cse10, _k1))); return _IA.atan2(_cse12, ((_tv13 = _IA.less(_k2, _tv9)) === 'true' ? _IA.res(_cse12) : _tv13 === 'false' ? _IA.res(_k1) : _IA.hull(_cse12, _k1))); })())(_IA.max(_.x, _k3))) : _tv14 === 'false' ? _IA.res(_k1) : _IA.hull(((_tv9) => (() => { const _cse10 = _IA.sin(_tv9); const _cse12 = _IA.atan2(_cse10, ((_tv11 = _IA.less(_k1, _tv9)) === 'true' ? _IA.res(_cse10) : _tv11 === 'false' ? _IA.res(_k1) : _IA.hull(_cse10, _k1))); return _IA.atan2(_cse12, ((_tv13 = _IA.less(_k2, _tv9)) === 'true' ? _IA.res(_cse12) : _tv13 === 'false' ? _IA.res(_k1) : _IA.hull(_cse12, _k1))); })())(_IA.max(_.x, _k3)), _k1))); })()"
    );
  });

  test('If arm: depth 20 compiles quickly to small code', () => {
    const e = ifArmGraph(engine(), 20);
    const [result, ms] = timed(() => compile(e, { to: 'interval-js' }));
    expect(result.success).toBe(true);
    // About 36,000 characters: the arm of level k is compiled once over the
    // inputs clamped to x >= k, so the size grows as the square of the depth.
    expect(result.code.length).toBeLessThan(45_000);
    expectFast(ms, 2_000);
  });

  // In the arm of `x > k` the arm of `x < -(k-1)` is clamped again, and so
  // on, so the arms nested in an arm have other clamps at each level. Each
  // is a function compiled once (`IntervalArmTable`). Before the change, the
  // code was 2 MB at depth 8 and 6.6 MB at depth 9. Now it is about
  // 266,000 characters at depth 10, and grows as a power of the depth.
  test('two narrowed branches per level, depth 10', () => {
    const ce = engine();
    const f = (op: string, ...ops: Expression[]) => ce.function(op, ops);
    const x = ce.symbol('x');
    let e = f('Sin', x);
    for (let k = 0; k < 10; k++)
      e = f(
        'Add',
        e,
        f('If', f('Greater', x, ce.number(k)), e, ce.number(0)),
        f('If', f('Less', x, ce.number(-k)), f('Sqrt', e), ce.number(1))
      );
    const [result, ms] = timed(() => compile(e, { to: 'interval-js' }));
    expect(result.success).toBe(true);
    expect(result.code.length).toBeLessThan(350_000);
    expectFast(ms, 2_000);
  });

  // An arm compiled over the narrowed inputs must not read a temporary of
  // the code around it, which holds a value over the inputs that are not
  // narrowed. The arm `sqrt(x - 1)` (clamped to x >= 1) and the arm
  // `arccos(x)` (clamped to x <= 1) are defined where they are selected, so
  // the results are `interval`, not `partial`.
  test('a narrowed arm does not read the temporary of an arm that is not narrowed', () => {
    const ce = engine();
    const f = (op: string, ...ops: Expression[]) => ce.function(op, ops);
    const x = ce.symbol('x');
    const s = f('Sqrt', f('Subtract', x, ce.number(1)));
    const which = compile(
      f(
        'Which',
        f('Greater', s, ce.number(1)),
        ce.number(0),
        f('Greater', x, ce.number(1)),
        s,
        ce.True,
        ce.number(5)
      ),
      { to: 'interval-js' }
    );
    for (const [lo, hi] of [
      [0.5, 1.5],
      [-1, 2],
      [0.9, 1.1],
    ])
      expect(which.run!({ x: { lo, hi } })).toEqual({
        kind: 'interval',
        value: { lo: 0, hi: 5 },
      });

    const acos = f('Arccos', x);
    const list = compile(
      f(
        'List',
        acos,
        f('If', f('LessEqual', ce.number(1), x), ce.number(0), acos)
      ),
      { to: 'interval-js' }
    );
    expect(list.run!({ x: { lo: 0.99, hi: 1.01 } })).toEqual([
      {
        kind: 'partial',
        value: { lo: 0, hi: 0.14153947332442732 },
        domainClipped: 'hi',
      },
      { kind: 'interval', value: { lo: 0, hi: 0.14153947332442732 } },
    ]);
  });

  // A narrowed arm compiled without the CSE pass, so a shared graph in the
  // arm was written once per path: 1 MB at depth 14 for these two branches.
  test('two branches that read one shared graph, depth 20', () => {
    const ce = engine();
    const f = (op: string, ...ops: Expression[]) => ce.function(op, ops);
    let s = f('Sin', ce.symbol('x'));
    for (let k = 0; k < 20; k++) s = f('Add', s, f('Sin', s));
    const e = f(
      'If',
      f('Greater', ce.symbol('x'), ce.number(0)),
      f('Sqrt', s),
      f('Ln', s)
    );
    const [result, ms] = timed(() => compile(e, { to: 'interval-js' }));
    expect(result.success).toBe(true);
    // About 8,500 characters.
    expect(result.code.length).toBeLessThan(12_000);
    expectFast(ms, 2_000);
    // The same value as the JavaScript target, inside a narrow interval.
    const want = compile(e, { to: 'javascript' }).run!({ x: 0.5 }) as number;
    const got = result.run!({ x: 0.5 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(got.kind).toBe('interval');
    expect(got.value.lo).toBeLessThanOrEqual(want);
    expect(got.value.hi).toBeGreaterThanOrEqual(want);
  });

  test('When value: depth 28 compiles quickly to small code', () => {
    const e = whenArmGraph(engine(), 28);
    const [result, ms] = timed(() => compile(e, { to: 'interval-js' }));
    expect(result.success).toBe(true);
    // About 2,100 characters.
    expect(result.code.length).toBeLessThan(3_000);
    expectFast(ms, 2_000);
  });
});

// The code that the pass gave before the change, at depth 3.
describe('CE-595: the emitted code does not change', () => {
  test('If arm, WGSL', () => {
    expect(compile(ifArmGraph(engine(), 3), { to: 'wgsl' }).code).toBe(
      [
        'let _cse1: f32 = sin(x);',
        'let _cse2: f32 = atan2(_cse1, select(0.0, _cse1, 0.0 < x));',
        'var _tv3: f32;',
        'if (1.0 < x) {',
        '  _tv3 = _cse2;',
        '} else {',
        '  _tv3 = 0.0;',
        '}',
        'let _cse4: f32 = atan2(_cse2, _tv3);',
        'var _tv5: f32;',
        'if (2.0 < x) {',
        '  _tv5 = _cse4;',
        '} else {',
        '  _tv5 = 0.0;',
        '}',
        'return atan2(_cse4, _tv5);',
      ].join('\n')
    );
  });

  test('If arm, GLSL', () => {
    expect(compile(ifArmGraph(engine(), 3), { to: 'glsl' }).code).toBe(
      [
        'float _cse1 = sin(x);',
        'float _cse2 = atan(_cse1, ((0.0 < x) ? (_cse1) : (0.0)));',
        'float _tv3;',
        'if (1.0 < x) {',
        '  _tv3 = _cse2;',
        '} else {',
        '  _tv3 = 0.0;',
        '}',
        'float _cse4 = atan(_cse2, _tv3);',
        'float _tv5;',
        'if (2.0 < x) {',
        '  _tv5 = _cse4;',
        '} else {',
        '  _tv5 = 0.0;',
        '}',
        'return atan(_cse4, _tv5);',
      ].join('\n')
    );
  });

  test('If arm, JavaScript', () => {
    expect(compile(ifArmGraph(engine(), 3), { to: 'javascript' }).code).toBe(
      '(() => { const _cse1 = Math.sin(_.x); ' +
        'const _cse2 = Math.atan2(_cse1, ((_.x !== undefined) ? ((0 < _.x) ? (_cse1) : (0)) : NaN)); ' +
        'const _cse3 = Math.atan2(_cse2, ((_.x !== undefined) ? ((1 < _.x) ? (_cse2) : (0)) : NaN)); ' +
        'return Math.atan2(_cse3, ((_.x !== undefined) ? ((2 < _.x) ? (_cse3) : (0)) : NaN)); })()'
    );
  });

  test('When value, WGSL', () => {
    expect(compile(whenArmGraph(engine(), 3), { to: 'wgsl' }).code).toBe(
      [
        'var _tv1: f32;',
        'var _tv2: f32;',
        'let _cse3: f32 = sin(x);',
        'let _cse4: f32 = select(_gpu_nan(), sin(_cse3), 0.0 < _cse3);',
        'if (1.0 < _cse4) {',
        '  _tv2 = _gpu_sin(_cse4);',
        '} else {',
        '  _tv2 = _gpu_nan();',
        '}',
        'let _cse5: f32 = _tv2;',
        'if (2.0 < _cse5) {',
        '  _tv1 = _gpu_sin(_cse5);',
        '} else {',
        '  _tv1 = _gpu_nan();',
        '}',
        'return _tv1;',
      ].join('\n')
    );
  });

  test('When value, GLSL', () => {
    expect(compile(whenArmGraph(engine(), 3), { to: 'glsl' }).code).toBe(
      [
        'float _tv1;',
        'float _tv2;',
        'float _cse3 = sin(x);',
        'float _cse4 = ((0.0 < _cse3) ? (sin(_cse3)) : (_gpu_nan()));',
        'if (1.0 < _cse4) {',
        '  _tv2 = _gpu_sin(_cse4);',
        '} else {',
        '  _tv2 = _gpu_nan();',
        '}',
        'float _cse5 = _tv2;',
        'if (2.0 < _cse5) {',
        '  _tv1 = _gpu_sin(_cse5);',
        '} else {',
        '  _tv1 = _gpu_nan();',
        '}',
        'return _tv1;',
      ].join('\n')
    );
  });

  test('When value, JavaScript', () => {
    expect(compile(whenArmGraph(engine(), 3), { to: 'javascript' }).code).toBe(
      '(() => { const _cse1 = Math.sin(_.x); ' +
        'const _cse2 = ((_.x !== undefined) ? ((0 < _cse1) ? (Math.sin(_cse1)) : NaN) : NaN); ' +
        'const _cse3 = ((_.x !== undefined) ? ((1 < _cse2) ? (Math.sin(_cse2)) : NaN) : NaN); ' +
        'return ((_.x !== undefined) ? ((2 < _cse3) ? (Math.sin(_cse3)) : NaN) : NaN); })()'
    );
  });
});
