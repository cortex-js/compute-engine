import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import { _jsProfileStats } from '../../src/compute-engine/js-profile-switch';
import {
  _mapAutoCompileStats as mapStats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

// The internal switch of `implicitCompile()` that tries the `numeric-kernel`
// profile first (docs/plans/2026-11-10-js-profile-first-consumer.md, step 1).

let savedPrecision: number;
beforeAll(() => {
  savedPrecision = BigDecimal.precision;
});
afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

type Route = 'off' | 'on' | 'jit-off';

/** An engine with the switch off or on, or with `ce.jit = 'off'`. The
 * switch is set explicitly, so that the value of `CE_JS_PROFILE` does not
 * change these tests. */
function engine(route: Route, machine = true): ComputeEngine {
  const ce = new ComputeEngine(machine ? { precision: 'machine' } : undefined);
  ce._jsProfile = route === 'on' ? { profile: 'numeric-kernel' } : undefined;
  if (route === 'jit-off') ce.jit = 'off';
  return ce;
}

type Seen = {
  options: Record<string, unknown> | undefined;
  result?: ReturnType<ComputeEngine['_compile']>;
};

/** Record each call of `ce._compile`, with its options and its result. */
function spyCompile(ce: ComputeEngine): {
  seen: Seen[];
  restore: () => void;
} {
  const seen: Seen[] = [];
  const original = ce._compile.bind(ce);
  const spy = jest.spyOn(ce, '_compile').mockImplementation((expr, options) => {
    const entry: Seen = {
      options: options as Record<string, unknown> | undefined,
    };
    seen.push(entry);
    entry.result = original(expr, options);
    return entry.result;
  });
  return { seen, restore: () => spy.mockRestore() };
}

const values = (e: Expression): number[] => Array.from(e.each(), (v) => v.re);

/** A marked `Map` over a range: `x ↦ N(x² + 1)`, which the profile admits. */
function admittedMap(ce: ComputeEngine): Expression {
  return ce.box([
    'Map',
    [
      'Function',
      ['N', ['Add', ['Power', 'x', 2], 1]],
      ['Typed', 'x', "'real'"],
    ],
    ['Range', 1, 64],
  ]);
}

/** A marked `Map` whose callback the profile declines (`Sinh`) and that
 * reads the symbol `k`. */
function declinedMap(ce: ComputeEngine): Expression {
  ce.declare('k', 'real');
  ce.assign('k', 2);
  return ce.box([
    'Map',
    [
      'Function',
      ['N', ['Multiply', 'k', ['Sinh', 'x']]],
      ['Typed', 'x', "'real'"],
    ],
    ['Range', 1, 64],
  ]);
}

describe('switch off', () => {
  test('the counters stay empty and _compile receives no profile', () => {
    const ce = engine('off');
    const { seen, restore } = spyCompile(ce);
    try {
      values(admittedMap(ce));
      values(declinedMap(ce));
    } finally {
      restore();
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.options?.profile === undefined)).toBe(true);
    expect(_jsProfileStats(ce)).toEqual({});
  });
});

describe('switch on, Map', () => {
  test('a callback that the profile admits', () => {
    const ce = engine('on');
    const { seen, restore } = spyCompile(ce);
    let on: number[];
    try {
      on = values(admittedMap(ce));
    } finally {
      restore();
    }
    const profiled = seen.filter(
      (s) => s.options?.profile === 'numeric-kernel'
    );
    expect(profiled.length).toBe(1);
    expect(profiled[0].result?.profile).toBe('numeric-kernel');
    // The profile gave the code: the existing compiler did not run.
    expect(seen.length).toBe(1);
    expect(on).toEqual(values(admittedMap(engine('off'))));
    expect(on).toEqual(values(admittedMap(engine('jit-off'))));
    expect(_jsProfileStats(ce).map).toMatchObject({
      attempts: 1,
      admitted: 1,
      declined: 0,
      failed: 0,
    });
  });

  test('a callback that the profile declines: the existing compiler compiles it, and the caller sets are unchanged', () => {
    const run = (route: Route) => {
      const ce = engine(route);
      const { seen, restore } = spyCompile(ce);
      try {
        return { ce, seen, values: values(declinedMap(ce)) };
      } finally {
        restore();
      }
    };
    const on = run('on');
    const off = run('off');
    expect(on.values).toEqual(off.values);
    expect(on.values).toEqual(run('jit-off').values);

    // One attempt of the profile, then the existing compiler.
    expect(on.seen.map((s) => s.options?.profile)).toEqual([
      'numeric-kernel',
      undefined,
    ]);
    expect(on.seen[1].result?.success).toBe(true);
    expect(on.seen[1].result?.profile).toBeUndefined();

    // The attempt had its own sets; the caller's set holds what it holds
    // with the switch off.
    const callerDeps = on.seen[1].options?.symbolDeps as Set<string>;
    expect(on.seen[0].options?.symbolDeps).not.toBe(callerDeps);
    const offDeps = off.seen[0].options?.symbolDeps as Set<string>;
    expect([...callerDeps].sort()).toEqual([...offDeps].sort());
    expect(callerDeps.has('k')).toBe(true);

    const stats = _jsProfileStats(on.ce).map;
    expect(stats).toMatchObject({
      attempts: 1,
      admitted: 0,
      declined: 1,
      failed: 0,
    });
    expect(Object.keys(stats.declinedMessages)).toEqual([
      "Could not compile with the profile 'numeric-kernel': unsupported head Sinh",
    ]);
  });

  test('invalidation: a callback that reads an assigned symbol follows a new value', () => {
    const scenario = (route: Route) => {
      const ce = engine(route);
      ce.declare('offset', 'real');
      ce.assign('offset', 0.5);
      const map = ce.box([
        'Map',
        ['Function', ['N', ['Add', 'x', 'offset']], ['Typed', 'x', "'real'"]],
        ['Range', 1, 64],
      ]);
      _resetMapAutoCompileStats();
      const first = values(map);
      const repeated = values(map);
      ce.assign('offset', 10.5);
      const changed = values(map);
      return {
        first,
        repeated,
        changed,
        recompiles: mapStats.recompiles,
        stats: _jsProfileStats(ce),
      };
    };
    const on = scenario('on');
    const off = scenario('off');
    expect(on.first).toEqual(off.first);
    expect(on.repeated).toEqual(off.first);
    expect(on.changed).toEqual(off.changed);
    expect(on.changed[0]).toBe(11.5);
    expect(on.recompiles).toBe(off.recompiles);
    // The profile compiled both versions.
    expect(on.stats.map?.admitted).toBeGreaterThanOrEqual(1);
    expect(on.stats.map?.declined).toBe(0);
  });
});

describe('when the profile is not tried', () => {
  test('a consumer that is not in the list', () => {
    const ce = engine('off');
    ce._jsProfile = { profile: 'numeric-kernel', consumers: new Set(['nd']) };
    const { seen, restore } = spyCompile(ce);
    try {
      values(admittedMap(ce));
    } finally {
      restore();
    }
    expect(seen.every((s) => s.options?.profile === undefined)).toBe(true);
    expect(_jsProfileStats(ce)).toEqual({});
  });

  test("the target 'interval-js'", () => {
    const ce = engine('on');
    const { seen, restore } = spyCompile(ce);
    let compiled: ReturnType<typeof implicitCompile>;
    try {
      compiled = implicitCompile(ce, ce.parse('x^2 + 1'), 'interval-proof', {
        to: 'interval-js',
      });
    } finally {
      restore();
    }
    expect(compiled?.success).toBe(true);
    expect(seen.length).toBe(1);
    expect(seen[0].options?.profile).toBeUndefined();
    expect(_jsProfileStats(ce)).toEqual({});
  });
});

/** `x: real`, a parameter that the profile admits. */
const REAL_X = ['Typed', 'x', "'real'"];

/** A consumer, its program, whether the engine computes at machine
 * precision, and whether the interpreter (`ce.jit = 'off'`) gives the same
 * string. */
type Program = [string, (ce: ComputeEngine) => unknown, boolean?, boolean?];

/** The public result with the switch on, with the switch off, and with
 * `ce.jit = 'off'`, and the counters of the engine with the switch on. */
function results(compute: (ce: ComputeEngine) => unknown, machine: boolean) {
  const on = engine('on', machine);
  const off = engine('off', machine);
  return {
    on: String(compute(on)),
    off: String(compute(off)),
    interpreted: String(compute(engine('jit-off', machine))),
    stats: _jsProfileStats(on),
    offStats: _jsProfileStats(off),
  };
}

describe('switch on: a consumer whose program the profile admits gives the result of the switch off and of the interpreter', () => {
  test.each<Program>([
    ['nd', (ce) => ce.box(['ND', ['Function', ['Sin', 'x'], REAL_X], 1]).N()],
    [
      'nlimit',
      (ce) =>
        ce
          .box([
            'NLimit',
            ['Function', ['Divide', ['Sin', 'x'], 'x'], REAL_X],
            0,
          ])
          .N(),
      true,
      // With `ce.jit = 'off'` this `NLimit` is `NaN`, with a typed or an
      // untyped parameter.
      false,
    ],
    [
      'reduce',
      (ce) =>
        ce
          .box([
            'Reduce',
            ['List', 1.5, 2, 3],
            [
              'Function',
              ['Add', 'a', 'b'],
              ['Typed', 'a', "'real'"],
              ['Typed', 'b', "'real'"],
            ],
          ])
          .N(),
    ],
    [
      'integrand',
      (ce) =>
        ce
          .box(['NIntegrate', ['Function', ['Power', 'x', 2], REAL_X], 0, 1])
          .N(),
    ],
    [
      'stochastic-equal',
      (ce) =>
        ce.parse('\\sin^2(x) + \\cos^2(x)').isIdenticallyEqual(ce.parse('1')),
      false,
    ],
    [
      'fit',
      (ce) =>
        ce
          .box([
            'FindFit',
            [
              'List',
              ['Tuple', 0, 1],
              ['Tuple', 1, 3],
              ['Tuple', 2, 5],
              ['Tuple', 3, 7],
            ],
            ['Add', ['Multiply', 'a', 'x'], 'b'],
            ['List', 'a', 'b'],
            'x',
          ])
          .evaluate(),
      false,
      // The interpreted model gives other last digits of the fitted
      // parameters.
      false,
    ],
  ])('%s', (consumer, compute, machine = true, sameAsInterpreter = true) => {
    const r = results(compute, machine);
    expect(r.on).toBe(r.off);
    if (sameAsInterpreter) expect(r.on).toBe(r.interpreted);
    expect(r.offStats).toEqual({});
    expect(r.stats[consumer]?.admitted).toBeGreaterThan(0);
  });
});

// A parameter with no declared type is a real number in the `strict` mode
// (docs/plans/2026-11-10-js-numeric-kernel-profile-spec.md, "Names with no
// declared type"): the profile admits the untyped programs of these
// consumers.
describe('switch on: a consumer whose program has untyped parameters', () => {
  test.each<Program>([
    ['nd', (ce) => ce.box(['ND', ['Function', ['Sin', 'x'], 'x'], 1]).N()],
    [
      'nlimit',
      (ce) =>
        ce
          .box(['NLimit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
          .N(),
      true,
      // With `ce.jit = 'off'` this `NLimit` is `NaN`.
      false,
    ],
    [
      'reduce',
      (ce) =>
        ce
          .box([
            'Reduce',
            ['List', 1.5, 2, 3],
            ['Function', ['Add', 'a', 'b'], 'a', 'b'],
          ])
          .N(),
    ],
    [
      'solve-enumeration',
      (ce) =>
        ce
          .box([
            'Solve',
            ['Equal', ['Add', ['Power', 2, 'x'], 'x'], 1034],
            ['Element', 'x', ['Range', 1, 100]],
          ])
          .evaluate(),
      false,
    ],
  ])('%s', (consumer, compute, machine = true, sameAsInterpreter = true) => {
    const r = results(compute, machine);
    expect(r.on).toBe(r.off);
    if (sameAsInterpreter) expect(r.on).toBe(r.interpreted);
    expect(r.offStats).toEqual({});
    expect(r.stats[consumer]?.admitted).toBeGreaterThan(0);
  });
});

describe('switch on: consumers whose programs the profile does not take', () => {
  test('series passes `vars`: the profile is not tried, and the result is the same', () => {
    const r = results(
      (ce) => ce.parse('\\sum_{k=1}^\\infty \\frac{1}{k^3+k+1}').N(),
      false
    );
    expect(r.on).toBe(r.off);
    expect(r.stats.series).toBeUndefined();
  });
});

describe('the environment variables', () => {
  const names = ['CE_JS_PROFILE', 'CE_JS_PROFILE_CONSUMERS'] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  });
  afterEach(() => {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  test('CE_JS_PROFILE and CE_JS_PROFILE_CONSUMERS set the switch of a new engine', () => {
    process.env.CE_JS_PROFILE = 'numeric-kernel';
    delete process.env.CE_JS_PROFILE_CONSUMERS;
    expect(new ComputeEngine()._jsProfile).toEqual({
      profile: 'numeric-kernel',
    });

    process.env.CE_JS_PROFILE_CONSUMERS = 'map, nd';
    expect(new ComputeEngine()._jsProfile).toEqual({
      profile: 'numeric-kernel',
      consumers: new Set(['map', 'nd']),
    });

    delete process.env.CE_JS_PROFILE;
    expect(new ComputeEngine()._jsProfile).toBeUndefined();
  });
});
