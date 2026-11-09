/**
 * Compiles the GLSL that the engine writes with the WebGL 2 compiler of a
 * headless Chromium (`glsl-driver.ts`). Run it with `npm run test:glsl`.
 *
 * This lane is not part of the Jest suite, because it needs a browser. A run
 * takes about one second.
 *
 * The operator sweep builds `Op()`, `Op(x)`, `Op(x, y)` and `Op(x, y, z)` for
 * each operator of the GPU function tables, with real inputs, and keeps each
 * expression that is valid and has a real type. It compiles each one to a
 * fragment shader that writes the value to a `float` output. A decline of the
 * engine (an error whose message starts with "Could not compile") is counted
 * and is not a failure: this test checks that the code the engine writes
 * compiles, not which expressions it accepts. Any other error of the engine,
 * when it builds or compiles an expression, fails the test.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { GPU_FUNCTIONS } from '../../src/compute-engine/compilation/gpu-functions';
import type { Expression } from '../../src/compute-engine/global-types';
import { GlslDriver, type GlslResult, type GlslShader } from './glsl-driver';

/** Gives the names of the GLSL-specific lowerings, which are protected. */
class SweepTarget extends GLSLTarget {
  operators(): string[] {
    return Object.keys(this.getLanguageSpecificFunctions());
  }
}

const glsl = new SweepTarget();
const ce = new ComputeEngine();
const INPUTS = ['x', 'y', 'z'] as const;
for (const name of INPUTS) ce.declare(name, 'real');

/**
 * A fragment shader that writes the value of `expr` to a `float` output, with
 * the real inputs as uniforms. Constant folding is off, so that a fold does
 * not remove the operation under test.
 */
function fragmentShader(expr: Expression): string {
  return glsl.compileShader({
    type: 'fragment',
    uniforms: INPUTS.map((name) => ({ name, type: 'float' })),
    outputs: [{ name: 'result', type: 'float' }],
    body: [{ variable: 'result', expression: expr }],
    constantFold: false,
  });
}

function report(failures: GlslResult[], shaders: GlslShader[]): string {
  const source = new Map(shaders.map((s) => [s.name, s.source]));
  return failures
    .map(
      (f) =>
        `--- ${f.name} (failed at ${f.failedAt})\n${f.log.trim()}\n` +
        `${source.get(f.name)}`
    )
    .join('\n');
}

/**
 * The shaders of the sweep that WebGL 2 refuses today, each with its open
 * issue. The sweep fails when a shader that is not in this list is refused,
 * and also when a shader in this list compiles, so that the list does not keep
 * an entry after its fix.
 */
const KNOWN_FAILURES = new Map<string, string>([
  // `_gpu_polevl` takes `float c[12]`, and the Fresnel helpers pass arrays of
  // other sizes, which GLSL does not convert.
  ['FresnelC(x)', 'CE-1168'],
  ['FresnelS(x)', 'CE-1168'],
]);

/**
 * The sweep fails when it builds fewer shaders than this. Without a minimum,
 * a change that makes most operators decline, or that changes the type of the
 * expressions so that the filter drops them, would leave a sweep that passes
 * with almost no shader. The sweep built 62 shaders on 2026-11-08, after
 * `compile()` and `compileShader()` to GLSL began to refuse the forms outside
 * the GLSL fragment (`Matrix`, `Mean`, `Random`, `WithRandomSeed`, and `Sum`
 * and `Product` of a collection: `docs/plans/2026-11-08-glsl-fragment-spec.md`,
 * section 2); raise the minimum when the count grows.
 */
const MIN_SHADERS = 62;

/**
 * Node's test runner has no default time limit, and a compiler that never
 * returns would stop the lane forever. A run takes about one second.
 */
const TIMEOUT_MS = 60_000;

let driver: GlslDriver;

before(
  async () => {
    driver = await GlslDriver.start();
  },
  { timeout: TIMEOUT_MS }
);

after(async () => {
  await driver?.stop();
});

describe('the GLSL driver', { timeout: TIMEOUT_MS }, () => {
  it('runs on SwiftShader', () => {
    assert.match(driver.renderer, /SwiftShader/i);
  });

  // A control: if the driver accepted every source, each test below would
  // pass with no check.
  it('refuses a shader that does not compile, and one that does not link', async () => {
    const [bad, unlinked] = await driver.compile([
      {
        name: 'type error',
        stage: 'fragment',
        source: `#version 300 es
precision highp float;
out float result;
void main() { result = vec2(1.0); }
`,
      },
      {
        // The input `v` compiles, but the pass-through vertex shader does
        // not write it, so the program does not link.
        name: 'input with no vertex output',
        stage: 'fragment',
        source: `#version 300 es
precision highp float;
in float v;
out float result;
void main() { result = v; }
`,
      },
    ]);
    assert.equal(bad.ok, false);
    assert.equal(bad.failedAt, 'compile');
    assert.notEqual(bad.log, '');
    assert.equal(unlinked.ok, false);
    assert.equal(unlinked.failedAt, 'link');
    assert.notEqual(unlinked.log, '');
  });

  it('accepts a shader that the engine writes', async () => {
    const source = fragmentShader(ce.parse('\\sin(x) + y^2'));
    const [result] = await driver.compile([
      { name: 'sin(x) + y^2', stage: 'fragment', source },
    ]);
    assert.equal(result.ok, true, result.log);
  });
});

describe('the GLSL of each operator of the GPU function tables', () => {
  it('compiles on WebGL 2', { timeout: TIMEOUT_MS }, async () => {
    const operators = [
      ...new Set([...Object.keys(GPU_FUNCTIONS), ...glsl.operators()]),
    ].sort();
    const shaders: GlslShader[] = [];
    const declined: string[] = [];
    for (const op of operators) {
      for (let arity = 0; arity <= INPUTS.length; arity++) {
        const name = `${op}(${INPUTS.slice(0, arity).join(', ')})`;
        const expr = ce.function(op, [...INPUTS.slice(0, arity)]);
        if (!expr.isValid || !expr.type.matches('real')) continue;
        let source: string;
        try {
          source = fragmentShader(expr);
        } catch (e) {
          if (!(e instanceof Error && e.message.startsWith('Could not compile')))
            throw e;
          declined.push(name);
          continue;
        }
        shaders.push({ name, stage: 'fragment', source });
      }
    }
    const results = await driver.compile(shaders);
    const refused = results.filter((r) => !r.ok);
    console.log(
      `${operators.length} operators; ${shaders.length} shaders compiled by ` +
        `WebGL 2, ${refused.length} refused (${KNOWN_FAILURES.size} known); ` +
        `${declined.length} declined by the engine.`
    );
    assert.ok(
      shaders.length >= MIN_SHADERS,
      `the sweep built ${shaders.length} shaders, fewer than ${MIN_SHADERS}`
    );
    const unexpected = refused.filter((r) => !KNOWN_FAILURES.has(r.name));
    assert.equal(unexpected.length, 0, report(unexpected, shaders));
    const fixed = results
      .filter((r) => r.ok && KNOWN_FAILURES.has(r.name))
      .map((r) => `${r.name} (${KNOWN_FAILURES.get(r.name)})`);
    assert.deepEqual(
      fixed,
      [],
      'these shaders compile now: remove them from KNOWN_FAILURES'
    );
  });
});
