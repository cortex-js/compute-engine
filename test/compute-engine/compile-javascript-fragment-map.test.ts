import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

let savedPrecision: number;
beforeAll(() => { savedPrecision = BigDecimal.precision; });
afterAll(() => { BigDecimal.precision = savedPrecision; });

// Factor the offset callback from map-compile-captured-values.test.ts through
// a local and a named helper. This is a consumer integration fixture, not an
// admission claim for the full Tycho heat program.
function fixture() {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('offset', 'real');
  ce.assign('offset', 0.5);
  ce.declare('helper', '(real) -> real');
  ce.assign('helper', ce.expr(['Function', ['Add', 'u', 'offset'],
    ['Typed', 'u', "'real'"]]));
  const map = ce.expr(['Map', ['Function', ['N', ['Block',
    ['Declare', 'total', "'real'", 'x'],
    ['Assign', 'total', ['helper', 'total']],
    'total']], ['Typed', 'x', "'real'"]], ['Range', 1, 128]]);
  return { ce, map };
}

function scenario(route: 'fragment' | 'legacy' | 'off') {
  const { ce, map } = fixture();
  if (route === 'off') ce.jit = 'off';
  const original = ce._compile.bind(ce);
  const artifacts: CompilationResult[] = [];
  const optionsSeen: (Record<string, unknown> | undefined)[] = [];
  const bodies: string[] = [];
  let runHits = 0;
  const compileSpy = jest.spyOn(ce, '_compile').mockImplementation((expr, options) => {
    optionsSeen.push(options);
    bodies.push(JSON.stringify(expr.json));
    const result = route === 'fragment'
      ? new ScalarFragmentJavaScriptTarget().compile(expr, options)
      : original(expr, options);
    artifacts.push(result);
    const run = result.run;
    return run === undefined ? result : {
      ...result,
      run: (...args: Parameters<typeof run>) => {
        runHits++;
        return run(...args);
      },
    };
  });
  _resetMapAutoCompileStats();
  try {
    const first = Array.from(map.each(), value => value.re);
    const afterFirst = artifacts.length;
    const firstRunHits = runHits;
    const repeated = Array.from(map.each(), value => value.re);
    const afterRepeated = artifacts.length;
    const repeatedRunHits = runHits;
    const old = artifacts[0];
    ce.assign('offset', 10.5);
    const changed = Array.from(map.each(), value => value.re);
    return {
      first, repeated, changed, artifacts, optionsSeen, bodies, runHits,
      attempts: compileSpy.mock.calls.length,
      compiledHits: stats.compiledHits,
      recompiles: stats.recompiles, afterFirst, afterRepeated,
      firstRunHits, repeatedRunHits,
      oldValue: old?.run?.(1),
    };
  } finally {
    compileSpy.mockRestore();
  }
}

test('the actual Map consumer runs the fragment callback and refreshes its capture', () => {
  const interpreted = scenario('off');
  expect(interpreted.attempts).toBe(0);
  expect(interpreted.compiledHits).toBe(0);
  expect(interpreted.runHits).toBe(0);
  const legacy = scenario('legacy');
  const fragment = scenario('fragment');
  const initial = Array.from({ length: 128 }, (_, i) => i + 1.5);
  const updated = Array.from({ length: 128 }, (_, i) => i + 11.5);
  for (const result of [interpreted, legacy, fragment]) {
    expect(result.first).toEqual(initial);
    expect(result.repeated).toEqual(initial);
    expect(result.changed).toEqual(updated);
  }
  for (const result of [legacy, fragment]) {
    expect(result.attempts).toBe(2);
    expect(result.artifacts.every(artifact => artifact.success)).toBe(true);
    // The unchanged second drain reuses Map's element memo. Both drains
    // that compute elements use the compiled runner for every element.
    expect(result.compiledHits).toBe(256);
    expect(result.runHits).toBe(256);
    expect(result.firstRunHits).toBe(128);
    expect(result.repeatedRunHits).toBe(128);
    expect(result.afterFirst).toBe(1);
    expect(result.afterRepeated).toBe(1);
    expect(result.recompiles).toBe(1);
    expect(result.oldValue).toBe(1.5);
  }
  for (const options of fragment.optionsSeen) {
    expect(options).toMatchObject({ fallback: false, entryChecks: false });
    expect(options?.symbolDeps).toBeInstanceOf(Set);
    expect(options?.varsObjectRefs).toBeInstanceOf(Set);
    expect((options?.symbolDeps as Set<string>).has('offset')).toBe(true);
    expect((options?.varsObjectRefs as Set<string>).size).toBe(0);
  }
  for (const body of fragment.bodies) {
    expect(body).toContain('"Declare"');
    expect(body).toContain('"Assign"');
    expect(body).toContain('"helper"');
    expect(body).not.toContain('"N"');
  }
});
