import * as esbuild from 'esbuild';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { createJavaScriptRuntime, runtimeVersion } from '../../src/runtime';

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
    const rt = createJavaScriptRuntime({ random: null });
    expect(() => rt.load(random)()).toThrow(/entropy/);
    expect(() => rt.integrateMC((x) => x, 0, 1)).toThrow(/entropy/);
  });

  test('Monte-Carlo integrals sample from it, inside a frame too', () => {
    let draws = 0;
    const rt = createJavaScriptRuntime({
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
    const rt = createJavaScriptRuntime({ iterationLimit: 50 });
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
    expect(
      rt.takeWhileIter(endless(), (x) => (x as number) < 5000)
    ).toHaveLength(5000);
  });

  test('the default iteration limit is the engine default', () => {
    expect(createJavaScriptRuntime().iterationLimit).toBe(ce.iterationLimit);
  });

  test('a deadline stops the shuffle and choice loops; unset, there is none', () => {
    const xs = Array.from({ length: 5000 }, (_, i) => i);
    const rt = createJavaScriptRuntime();
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

describe('stored code', () => {
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

  test('no engine module is bundled', () => {
    const inputs = Object.keys(metafile.inputs);
    expect(inputs).toContain(
      'src/compute-engine/compilation/javascript-runtime.ts'
    );
    const engine = inputs.filter((f) =>
      /compute-engine\/(index|boxed-expression|library|symbolic|rubi|latex-syntax|global-types|types-engine)|^src\/(latex-syntax|math-json)\b|compilation\/(base-compiler|javascript-target|compile-expression|jet-derivative)/.test(
        f
      )
    );
    expect(engine).toEqual([]);
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
