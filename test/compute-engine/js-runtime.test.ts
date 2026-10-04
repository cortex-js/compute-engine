import * as esbuild from 'esbuild';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { createJavaScriptRuntime, runtimeVersion } from '../../src/runtime';
import { createSysRuntime } from '../../src/compute-engine/compilation/javascript-runtime';

/**
 * The runtime for compiled JavaScript with no engine behind it
 * (`@cortex-js/compute-engine/runtime`, issue #372).
 */

const ce = new ComputeEngine();

/** Compile, refusing the interpreter fallback. Constant folding is off: a
 * seeded frame has no free variable, so folding would replace the program
 * with the value it produces and nothing would run. */
function compiled(json: any) {
  const r = compile(ce.box(json), { fallback: false, constantFold: false })!;
  expect(r.success).toBe(true);
  return r;
}

const flat = (v: any): unknown =>
  v?.operator === 'List' ? v.ops.map((x: any) => x.re) : v.re;

describe('the same seeded program three ways', () => {
  const programs: [string, any][] = [
    ['Random', ['Random']],
    ['draws', ['List', ['Random'], ['Random'], ['Random']]],
    ['RandomShuffle', ['RandomShuffle', ['Range', 1, 12]]],
    ['RandomChoice', ['RandomChoice', ['Range', 1, 50], 5]],
    ['RandomSample', ['RandomSample', ['Range', 1, 50], 5]],
    [
      'nested frame, then an outer draw',
      ['List', ['Random'], ['WithRandomSeed', 99, ['Random']], ['Random']],
    ],
  ];

  for (const [name, body] of programs) {
    for (const seed of [7, 'abc']) {
      test(`${name}, seed ${JSON.stringify(seed)}: interpreted = run() = stored code`, () => {
        const json = [
          'WithRandomSeed',
          typeof seed === 'string' ? { str: seed } : seed,
          body,
        ];
        const interpreted = withRandomSeedFrame(ce, 0, () =>
          flat(ce.box(json).evaluate())
        );
        const result = compiled(json);
        const viaRun = result.run!();
        const viaRuntime = createJavaScriptRuntime().load(result)();
        expect(viaRun).toEqual(interpreted);
        expect(viaRuntime).toEqual(interpreted);
      });
    }
  }

  test('code called from an interpreted frame draws from it and hands the counter back', () => {
    const json = ['List', ['Random'], ['Random']];
    const result = compiled(json);
    const [viaEngine, engineNext] = withRandomSeedFrame(ce, 7, () => {
      ce._random(); // the interpreter has already drawn once
      const v = result.run!();
      return [v, ce._randomFrame!.next];
    });

    // The host sends the frame state to the runtime and reads it back.
    const rt = createJavaScriptRuntime({ frame: { seed: 7, next: 1 } });
    const viaRuntime = rt.load(result)();
    expect(viaRuntime).toEqual(viaEngine);
    expect(rt.frame!.next).toBe(engineNext);
    expect(engineNext).toBe(3);

    // The folded form of the frame works the same, and is advanced in place.
    const frame = { ...rt.frame!, next: 1 };
    const rt2 = createJavaScriptRuntime({ frame });
    expect(rt2.load(result)()).toEqual(viaEngine);
    expect(frame.next).toBe(3);
  });

  test('a frame is dynamically scoped: the outer counter survives a nested frame', () => {
    const result = compiled([
      'List',
      ['Random'],
      ['WithRandomSeed', 1, ['Random']],
      ['Random'],
    ]);
    const rt = createJavaScriptRuntime({ frame: { seed: 5 } });
    rt.load(result)();
    expect(rt.frame!.next).toBe(2);
  });
});

describe('random outside a frame', () => {
  const random = compiled(['Random']);

  test('comes from the `random` option', () => {
    expect(createJavaScriptRuntime({ random: () => 0.25 }).load(random)()).toBe(
      0.25
    );
  });

  test('a null source denies draws, and a draw throws', () => {
    const rt = createSysRuntime({ random: null });
    expect(() => rt.load(random)()).toThrow(/entropy/);
    expect(() => rt.integrateMC((x) => x, 0, 1)).toThrow(/entropy/);
    // The class differs in each bundle: the error is identified by its name.
    try {
      rt.load(random)();
    } catch (e: any) {
      expect(e.name).toBe('CapabilityDeniedError');
    }
  });

  test('Monte-Carlo integrals sample from it, inside a frame too', () => {
    let draws = 0;
    const rt = createSysRuntime({
      random: () => {
        draws++;
        return 0.5;
      },
      frame: { seed: 3 },
    });
    expect(rt.integrateMC((x) => x, 0, 1)).toBeCloseTo(0.5, 6);
    expect(draws).toBeGreaterThan(0);
    // The frame's counter is not consumed by a live sample.
    expect(rt.frame!.next).toBe(0);
  });
});

describe('limits are options of the runtime', () => {
  const endless = function* (): Generator<number> {
    for (let i = 0; ; i++) yield i;
  };

  test('the iteration limit caps the lazy-stream walks', () => {
    const rt = createSysRuntime({ iterationLimit: 50 });
    expect(() =>
      rt.takeIter(
        rt.filterIter(endless(), () => false),
        1
      )
    ).toThrow('Iteration limit of 50 exceeded while evaluating Filter()');
    expect(() => rt.takeWhileIter(endless(), () => true)).toThrow(
      'Iteration limit of 50'
    );
    rt.iterationLimit = 0; // no cap
    expect(rt.iterationLimit).toBe(Infinity);
    expect(
      rt.takeWhileIter(endless(), (x) => (x as number) < 5000)
    ).toHaveLength(5000);
  });

  test('the default iteration limit is the engine default', () => {
    expect(createJavaScriptRuntime().iterationLimit).toBe(ce.iterationLimit);
  });

  test('a limit of 0 or less reads back as no cap, as `ce.iterationLimit` does', () => {
    for (const n of [0, -5]) {
      expect(
        createJavaScriptRuntime({ iterationLimit: n }).iterationLimit
      ).toBe(Infinity);
    }
    const saved = ce.iterationLimit;
    ce.iterationLimit = 0;
    expect(ce.iterationLimit).toBe(Infinity);
    ce.iterationLimit = saved;
  });

  test('the frame accepts a seed and a counter, and reads back the folded frame', () => {
    const rt = createJavaScriptRuntime();
    rt.setFrame({ seed: 7, next: 3 });
    expect(rt.frame!.next).toBe(3);
    rt.setFrame(undefined);
    expect(rt.frame).toBeUndefined();
  });

  test('a deadline stops the shuffle and choice loops; unset, there is none', () => {
    const xs = Array.from({ length: 5000 }, (_, i) => i);
    const rt = createSysRuntime();
    expect(rt.shuffle(xs)).toHaveLength(5000);
    rt.deadline = Date.now() - 1;
    expect(() => rt.shuffle(xs)).toThrow(/Timeout/);
    expect(() =>
      rt.randomChoice(rt.domainRange('RandomChoice', 1, 10), 5000)
    ).toThrow(/Timeout/);
    rt.deadline = undefined;
    expect(rt.shuffle(xs)).toHaveLength(5000);
  });
});

describe('runtimeVersion', () => {
  test('a compilation result and the runtime carry the same version', () => {
    const result = compiled(['Add', 'x', 1]);
    const rt = createJavaScriptRuntime();
    expect(result.runtimeVersion).toBe(rt.runtimeVersion);
    expect(runtimeVersion).toBe(rt.runtimeVersion);
  });

  test('load() refuses code from another version', () => {
    const rt = createJavaScriptRuntime();
    expect(() => rt.load({ code: '1', runtimeVersion: '0.0.0-other' })).toThrow(
      /0\.0\.0-other/
    );
  });
});

describe('the published type', () => {
  test('has no helper table', () => {
    const rt = createJavaScriptRuntime();
    // The helpers are reachable at run time (the code calls them) but are not
    // part of the type; the type's members are the five below.
    const members: (keyof typeof rt)[] = [
      'load',
      'frame',
      'iterationLimit',
      'deadline',
      'runtimeVersion',
    ];
    for (const m of members) expect(m in rt).toBe(true);
    // @ts-expect-error `cabs` is a helper, not a member of the runtime type
    void rt.cabs;
  });
});

describe('stored code', () => {
  test('load() rejects code without a runtimeVersion', () => {
    expect(() => createJavaScriptRuntime().load({ code: '1' })).toThrow(
      /no runtimeVersion/
    );
  });

  test('constant definitions are built once, not on every call', () => {
    const L = ce.box(['Range', 1, 1000]).evaluate();
    ce.declare('Lconst', { type: 'list<integer>', value: L });
    const result = compile(ce.box(['At', 'Lconst', ['Floor', 'x']]), {
      fallback: false,
    })!;
    expect(result.preambleOnce).toMatch(/_SYS\.range\(1, 1000, 1\)/);

    // Count the constructions of the list through the helper that builds it.
    const constructions = (stored: any, calls: number): number => {
      const rt = createSysRuntime();
      let built = 0;
      const range = rt.range;
      rt.range = (...args: Parameters<typeof range>) => {
        built++;
        return range(...args);
      };
      const f = rt.load(stored);
      for (let i = 1; i <= calls; i++) expect(f({ x: i })).toBe(i);
      return built;
    };
    expect(constructions(result, 50)).toBe(1);
    // Stored without the split (an older result), the preamble runs per call.
    const { preambleOnce, preamblePerCall, ...legacy } = result as any;
    expect(constructions(legacy, 50)).toBe(50);
    // The engine's own runner does the same once-only construction.
    expect(result.run!({ x: 3 })).toBe(3);
  });

  test('a lambda builds its constant definitions once too', () => {
    ce.declare('Mconst', {
      type: 'list<integer>',
      value: ce.box(['Range', 1, 1000]).evaluate(),
    });
    const result = compile(
      ce.box(['Function', ['At', 'Mconst', ['Floor', 'k']], 'k']),
      { fallback: false }
    )!;
    expect(result.preambleOnce).toBeDefined();
    const rt = createSysRuntime();
    let built = 0;
    const range = rt.range;
    rt.range = (...args: Parameters<typeof range>) => {
      built++;
      return range(...args);
    };
    const f = rt.load(result);
    for (let i = 1; i <= 20; i++) expect(f(i)).toBe(i);
    expect(built).toBe(1);
  });

  test('an expression with free symbols', () => {
    const result = compiled(['Add', ['Sin', 'x'], ['Multiply', 2, 'y']]);
    const f = createJavaScriptRuntime().load(result);
    expect(f({ x: 1, y: 3 })).toBe(result.run!({ x: 1, y: 3 }));
  });

  test('a lambda', () => {
    const result = compile(
      ce.box(['Function', ['Add', ['Gamma', 'x'], 1], 'x']),
      { fallback: false }
    )!;
    const f = createJavaScriptRuntime().load(result);
    expect(f(5)).toBe(25);
  });

  test('a function with a preamble', () => {
    const result = compiled(['Add', ['Erf', 'x'], ['Factorial', 5]]);
    expect(createJavaScriptRuntime().load(result)({ x: 0.5 })).toBe(
      result.run!({ x: 0.5 })
    );
  });
});

describe('the entry point has no engine in it', () => {
  // Bundle `src/runtime.ts` as a consumer's bundler would, then check which
  // modules went in and that the output runs on its own.
  let metafile: esbuild.Metafile;
  let code: string;
  beforeAll(async () => {
    const out = await esbuild.build({
      entryPoints: ['./src/runtime.ts'],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      resolveExtensions: ['.ts', '.js'],
      metafile: true,
      logLevel: 'silent',
    });
    metafile = out.metafile;
    code = out.outputFiles[0].text;
  }, 60_000);

  test('only the runtime and its numerics are bundled', () => {
    // An allow-list: a module added to the bundle's graph fails here until it
    // is judged engine-free and listed.
    const allowed = [
      /^src\/runtime\.ts$/,
      /^src\/common\/interruptible\.ts$/,
      /^src\/compute-engine\/effects-registry\.ts$/,
      /^src\/compute-engine\/numerics\/[\w-]+\.ts$/,
      /^src\/big-decimal\/[\w-]+\.ts$/,
      /^src\/compute-engine\/compilation\/(javascript-runtime|jet-helpers)\.ts$/,
      /node_modules\/(complex-esm|@arnog\/colors)\//,
    ];
    const inputs = Object.keys(metafile.inputs);
    expect(inputs).toContain(
      'src/compute-engine/compilation/javascript-runtime.ts'
    );
    expect(inputs.filter((f) => !allowed.some((re) => re.test(f)))).toEqual([]);
  });

  test('the bundle runs without the engine', () => {
    const module = { exports: {} as any };
    new Function('module', 'exports', code)(module, module.exports);
    const rt = module.exports.createJavaScriptRuntime({ frame: { seed: 7 } });
    const stored = compiled(['List', ['Random'], ['Random']]);
    const viaEngine = withRandomSeedFrame(ce, 7, () => stored.run!());
    expect(rt.load(stored)()).toEqual(viaEngine);
    expect(rt.runtimeVersion).toBe(stored.runtimeVersion);
  });
});

describe('load() applies the input conversions of run()', () => {
  const typed = new ComputeEngine();
  typed.declare('z', 'complex');
  typed.declare('L', 'list<real>');

  const cases: [string, any, Record<string, unknown>, unknown][] = [
    [
      'a real for a complex symbol, z^2 + z at z = 2',
      ['Add', ['Power', 'z', 2], 'z'],
      { z: 2 },
      6,
    ],
    [
      'a Float64Array for a list symbol, the sum of L',
      ['Sum', ['At', 'L', 'i'], ['Limits', 'i', 1, 3]],
      { L: new Float64Array([1, 2, 3]) },
      6,
    ],
  ];
  for (const [name, json, vars, expected] of cases) {
    test(`${name}: run() = load() = ${expected}`, () => {
      const result = compile(typed.box(json), { fallback: false })!;
      expect(result.success).toBe(true);
      const viaRun = result.run!(vars as any);
      const viaLoad = createJavaScriptRuntime().load(result)(vars);
      expect(viaRun).toEqual(expected);
      expect(viaLoad).toEqual(expected);
    });
  }

  test('a complex value for a real symbol is refused by load() as by run()', () => {
    const result = compile(ce.box(['Add', 'q', 1]), { fallback: false })!;
    const vars = { q: { re: 1, im: 1 } };
    expect(() => result.run!(vars as any)).toThrow(TypeError);
    expect(() => createJavaScriptRuntime().load(result)(vars)).toThrow(
      TypeError
    );
  });

  test('the plan survives JSON storage', () => {
    const result = compile(typed.box(cases[0][1]), { fallback: false })!;
    const stored = JSON.parse(JSON.stringify(result));
    expect(createJavaScriptRuntime().load(stored)({ z: 2 })).toEqual(6);
  });
});

describe('the reconstruction digits of a negative base travel with the result', () => {
  const x = 33.3333333333333;
  const power = ['Power', -2, 'x'];

  test('(-2)^x at x = 33.3333333333333 reads the exponent to 15 digits at machine precision', () => {
    const saved = ce.precision;
    try {
      ce.precision = 'machine';
      const result = compile(ce.box(power), { fallback: false })!;
      expect(result.reconstructionDigits).toBe(15);
      const viaRun = result.run!({ x });
      expect(viaRun).toBeCloseTo(10822639409.68, 1);
      // The runtime reads the digits from the result, not from whatever
      // precision the number library holds when the code is called.
      ce.precision = 300;
      expect(result.reconstructionDigits).toBe(15);
      expect(createJavaScriptRuntime().load(result)({ x })).toBe(viaRun);
    } finally {
      ce.precision = saved;
    }
  });

  test('the digits are 17 at the default precision and when absent', () => {
    const result = compile(ce.box(power), { fallback: false })!;
    expect(result.reconstructionDigits).toBe(17);
    expect(
      createJavaScriptRuntime().load({
        ...result,
        reconstructionDigits: undefined,
      })({ x })
    ).toEqual(createJavaScriptRuntime().load(result)({ x }));
  });
});
