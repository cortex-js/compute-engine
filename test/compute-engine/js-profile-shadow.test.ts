import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import {
  _jsProfileShadowStats,
  _jsProfileStats,
} from '../../src/compute-engine/js-profile-switch';
import {
  _mapAutoCompileStats as mapStats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

// The shadow measure: each compilation for the `javascript` target is also
// tried with the `numeric-kernel` profile, and only the outcome is counted
// (docs/plans/2026-11-10-js-profile-first-consumer.md, "Shadow measure").

/** An engine with the shadow measure on or off. The setting is set
 * explicitly, so that `CE_JS_PROFILE_SHADOW` does not change these tests. */
function engine(shadow: boolean): ComputeEngine {
  const ce = new ComputeEngine({ precision: 'machine' });
  ce._jsProfile = undefined;
  ce._jsProfileShadow = shadow;
  return ce;
}

/** The names of the scopes of `ce` that a compilation could change, with
 * the type of each. */
function scopeState(ce: ComputeEngine): string[] {
  const names: string[] = [];
  for (let scope = ce.context.lexicalScope; scope; scope = scope.parent!) {
    for (const [name, def] of scope.bindings) {
      const type =
        'value' in def
          ? def.value.type.toString()
          : 'operator' in def
            ? def.operator.signature.toString()
            : '';
      names.push(`${name}: ${type}`);
    }
    if (!scope.parent) break;
  }
  return names.sort();
}

type Outcome = {
  success: boolean;
  code: string | undefined;
  preamble: string | undefined;
  values: unknown[];
  deps: string[];
  scope: string[];
  error?: string;
};

/** Compile `make(ce)` with `options`, run it at each of `points`, and
 * collect what a caller sees. */
function outcome(
  ce: ComputeEngine,
  make: (ce: ComputeEngine) => Expression,
  points: Record<string, number>[],
  options: Record<string, unknown> = {}
): Outcome {
  const expr = make(ce);
  const deps = new Set<string>();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = compile(expr, { ...options, symbolDeps: deps });
    return {
      success: result.success,
      code: result.code,
      preamble: result.preamble,
      values: points.map((p) => result.run?.(p as never)),
      deps: [...deps].sort(),
      scope: scopeState(ce),
    };
  } catch (e) {
    return {
      success: false,
      code: undefined,
      preamble: undefined,
      values: [],
      deps: [...deps].sort(),
      scope: scopeState(ce),
      error: (e as Error).message,
    };
  } finally {
    warn.mockRestore();
  }
}

const points = [{ x: 0.5 }, { x: 2 }, { x: -3 }];

describe('the setting changes no result', () => {
  test.each<[string, (ce: ComputeEngine) => Expression]>([
    ['a program the profile admits', (ce) => ce.parse('x^2 + 1')],
    ['a program the profile declines', (ce) => ce.box(['Heaviside', 'x'])],
    ['a program the existing compiler declines', (ce) => ce.box(['Foo', 'x'])],
    [
      'a user function',
      (ce) => {
        ce.parse('f(t) := t^2 + 3t').evaluate();
        return ce.parse('f(x) + 1');
      },
    ],
  ])('%s', (_, make) => {
    const on = engine(true);
    const off = engine(false);
    const a = outcome(on, make, points);
    const b = outcome(off, make, points);
    expect(a).toEqual(b);
    // A second compilation sees the same state.
    expect(outcome(on, make, points)).toEqual(outcome(off, make, points));
    expect(_jsProfileShadowStats(off)).toEqual({});
  });

  test('an error of the existing compilation is thrown as it is', () => {
    const run = (ce: ComputeEngine) =>
      outcome(ce, (ce) => ce.box(['Foo', 'x']), points, { fallback: false });
    const a = run(engine(true));
    expect(a.error).toBeDefined();
    expect(a).toEqual(run(engine(false)));
  });

  test('a Map with a captured symbol whose value then changes', () => {
    const scenario = (ce: ComputeEngine) => {
      ce.declare('k', 'real');
      ce.assign('k', 2);
      const expr = ce.box([
        'Map',
        ['Function', ['Multiply', 'k', 'x'], ['Typed', 'x', "'real'"]],
        ['List', 1, 2, 3],
      ]);
      const deps = new Set<string>();
      const result = compile(expr, { symbolDeps: deps });
      const first = result.run?.({} as never);
      ce.assign('k', 5);
      const second = result.run?.({} as never);
      const recompiled = compile(expr).run?.({} as never);
      return {
        success: result.success,
        code: result.code,
        values: [first, second, recompiled],
        deps: [...deps].sort(),
        scope: scopeState(ce),
      };
    };
    const on = engine(true);
    const a = scenario(on);
    expect(a).toEqual(scenario(engine(false)));
    // The code holds the value of `k` when it was compiled, and the caller
    // learns of the dependency (`symbolDeps`).
    expect(a.values).toEqual([
      [2, 4, 6],
      [2, 4, 6],
      [5, 10, 15],
    ]);
    expect(a.deps).toContain('k');
    expect(_jsProfileShadowStats(on).public?.attempts).toBe(2);
  });

  test('the cache of the Map auto-compilation, with a symbol that changes', () => {
    const scenario = (ce: ComputeEngine) => {
      ce.declare('offset', 'real');
      ce.assign('offset', 0.5);
      const map = ce.box([
        'Map',
        ['Function', ['N', ['Add', 'x', 'offset']], ['Typed', 'x', "'real'"]],
        ['Range', 1, 64],
      ]);
      const values = (e: Expression) => Array.from(e.each(), (v) => v.re);
      _resetMapAutoCompileStats();
      const first = values(map);
      const repeated = values(map);
      ce.assign('offset', 10.5);
      const changed = values(map);
      return {
        first,
        repeated,
        changed,
        stats: { ...mapStats },
        scope: scopeState(ce),
      };
    };
    const on = engine(true);
    const a = scenario(on);
    expect(a).toEqual(scenario(engine(false)));
    expect(a.changed[0]).toBe(11.5);
    expect(_jsProfileShadowStats(on)['implicit:map']?.attempts).toBe(
      a.stats.recompiles + 1
    );
  });
});

describe('the counters', () => {
  test('each class of outcome', () => {
    const ce = engine(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      compile(ce.parse('x^2 + 1'));
      compile(ce.parse('y^2 + 1'));
      compile(ce.box(['Heaviside', 'x']));
      compile(ce.box(['Foo', 'x']));
      expect(() =>
        compile(ce.box(['Foo', 'x']), { fallback: false })
      ).toThrow();
      // Not measured: another target, a profile asked for.
      compile(ce.parse('x^2 + 1'), { to: 'interval-js' });
      compile(ce.parse('x^2 + 1'), { profile: 'numeric-kernel' });
    } finally {
      warn.mockRestore();
    }
    const stats = _jsProfileShadowStats(ce);
    expect(Object.keys(stats)).toEqual(['public']);
    expect(stats.public).toMatchObject({
      attempts: 3,
      admitted: 2,
      declined: 1,
      failed: 0,
      baselineDeclined: 2,
      baselineDeclinedAdmitted: 0,
    });
    expect(stats.public.declinedMessages).toEqual({
      "Could not compile with the profile 'numeric-kernel': unsupported head Heaviside": 1,
    });
    // The counters of the switch are separate.
    expect(_jsProfileStats(ce)).toEqual({});
  });

  test('the messages are normalized, with one example each', () => {
    const ce = engine(true);
    compile(ce.parse('x^2 + 1'), { operators: () => undefined });
    compile(ce.parse('y^2 + 1'), { operators: () => undefined });
    const stats = _jsProfileShadowStats(ce).public;
    expect(stats.declined).toBe(2);
    const keys = Object.keys(stats.declinedMessages);
    expect(keys).toEqual([
      "Could not compile with the profile 'numeric-kernel': the function form of the option `operators` is not in the profile.",
    ]);
    expect(stats.examples[keys[0]]).toBe(keys[0]);
  });

  test('an expression with many paths is compiled with the profile', () => {
    // A 40-level doubling DAG: the profile lowers each shared level once.
    const ce = engine(true);
    let e: Expression = ce.function('Add', [ce.symbol('x'), ce.One]);
    for (let k = 0; k < 40; k++) e = ce._fn('Add', [e, e]);
    const result = compile(ce.function('Floor', [e]), { constantFold: false });
    expect(result.success).toBe(true);
    expect(_jsProfileShadowStats(ce).public).toMatchObject({
      attempts: 1,
      admitted: 1,
      failed: 0,
    });
  });

  test('a program over the limit of the profile is counted as declined', () => {
    // A node in both branches of an `If` is lowered once per branch: at
    // depth 14 the program is over the limit of operations. (The existing
    // compiler is slow on this shape with its CSE pass.)
    const ce = engine(true);
    const x = ce.symbol('x');
    let e: Expression = ce.function('Add', [x, ce.One]);
    for (let k = 0; k < 14; k++)
      e = ce._fn('If', [
        ce.function('Greater', [x, ce.number(k)]),
        ce._fn('Add', [e, ce.One]),
        ce._fn('Multiply', [e, ce.number(2)]),
      ]);
    expect(compile(e, { cse: false, constantFold: false }).success).toBe(true);
    const stats = _jsProfileShadowStats(ce).public;
    expect(stats).toMatchObject({ attempts: 1, declined: 1, failed: 0 });
    expect(Object.keys(stats.declinedMessages)).toEqual([
      expect.stringMatching(/operations, the limit of the profile$/),
    ]);
  });

  test('a compilation of implicitCompile() has the name of its consumer', () => {
    const ce = engine(true);
    expect(implicitCompile(ce, ce.parse('x^2 + 1'), 'nd')?.success).toBe(true);
    expect(_jsProfileShadowStats(ce)).toEqual({
      'implicit:nd': expect.objectContaining({ attempts: 1, admitted: 1 }),
    });
  });

  test('a compilation that follows an attempt of the switch is not measured', () => {
    const ce = engine(true);
    ce._jsProfile = { profile: 'numeric-kernel' };
    expect(implicitCompile(ce, ce.box(['Heaviside', 'x']), 'nd')?.success).toBe(
      true
    );
    expect(_jsProfileStats(ce).nd).toMatchObject({ attempts: 1, declined: 1 });
    expect(_jsProfileShadowStats(ce)).toEqual({});
  });

  test('the environment variable', () => {
    const saved = process.env.CE_JS_PROFILE_SHADOW;
    try {
      process.env.CE_JS_PROFILE_SHADOW = '1';
      expect(new ComputeEngine()._jsProfileShadow).toBe(true);
      delete process.env.CE_JS_PROFILE_SHADOW;
      expect(new ComputeEngine()._jsProfileShadow).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.CE_JS_PROFILE_SHADOW;
      else process.env.CE_JS_PROFILE_SHADOW = saved;
    }
  });
});
