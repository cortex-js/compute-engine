/**
 * Which compilation targets an engine registers, by package entry.
 *
 * Every engine compiles to `interval-js`, which `compile()` routes itself
 * (`ROUTED_TARGETS`, listed first), and registers `javascript`. The full entry
 * (`src/compute-engine.ts`) adds `glsl` to the table of
 * defaults when it is imported; the `./core` entry (`src/core.ts`) does not,
 * so a `./core` consumer registers a GPU target with
 * `ce.registerCompilationTarget()` after importing it from `./compile`.
 *
 * The jest module registry is shared by every test of this file, and the full
 * entry is imported here, so an engine from either entry has all three targets
 * in this process. The `./core`-only behavior is checked by `jest.isolateModules`,
 * which gives the engine module a fresh registry with nothing added.
 *
 * Design: `docs/plans/2026-10-26-esm-only-build-and-opt-in-targets.md`.
 */

import { ComputeEngine, GLSLTarget } from '../../src/compute-engine';

describe('compilation target registration', () => {
  test('an engine of the full entry has the three default targets', () => {
    const ce = new ComputeEngine();
    expect(ce._listCompilationTargets()).toEqual([
      'interval-js',
      'javascript',
      'glsl',
    ]);
  });

  test('interval-js is listed, compiles, and cannot be registered or unregistered', () => {
    const ce = new ComputeEngine();
    expect(ce._listCompilationTargets()).toContain('interval-js');
    const r = ce._compile(ce.box(['Add', 'x', 1]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run!({ x: { lo: 1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 3 },
    });
    // `compile()` routes the name itself: a registration under it is refused.
    expect(() =>
      ce.registerCompilationTarget('interval-js', new GLSLTarget())
    ).toThrow(/"interval-js" is built in and cannot be registered/);
    expect(() => ce.unregisterCompilationTarget('interval-js')).toThrow(
      /"interval-js" is built in and cannot be unregistered/
    );
    expect(ce._listCompilationTargets()).toContain('interval-js');
  });

  test('an engine of the core entry has the two built-in targets only', () => {
    jest.isolateModules(() => {
      const core = require('../../src/core');
      const ce = new core.ComputeEngine();
      expect(ce._listCompilationTargets()).toEqual([
        'interval-js',
        'javascript',
      ]);

      // An unregistered target name fails with a message that names the
      // registered targets, so a `./core` consumer learns what to register.
      // (A `./core` engine has no LaTeX parser, hence `box`, not `parse`.)
      expect(() =>
        ce._compile(ce.box(['Add', 'x', 1]), { to: 'glsl', fallback: false })
      ).toThrow(/"glsl" is not registered.*interval-js, javascript$/);
    });
  });

  test('a core engine compiles to GLSL after registering the target', () => {
    jest.isolateModules(() => {
      const core = require('../../src/core');
      const { GLSLTarget: IsolatedGLSLTarget } = require('../../src/compile');
      const ce = new core.ComputeEngine();
      ce.registerCompilationTarget('glsl', new IsolatedGLSLTarget());
      expect(ce._listCompilationTargets()).toEqual([
        'interval-js',
        'javascript',
        'glsl',
      ]);
      const expr = ce.box(['Add', 'x', 1]);
      const glsl = ce._compile(expr, { to: 'glsl' });
      expect(glsl.success).toBe(true);
      expect(glsl.code).toContain('x + 1.0');

      ce.unregisterCompilationTarget('glsl');
      expect(ce._listCompilationTargets()).not.toContain('glsl');
    });
  });

  test('a core engine made before the full entry loads resolves the targets the full entry adds', () => {
    // The default engine that the free functions of `./core` cache is in
    // this position: made first, used later by the full entry's `compile()`.
    jest.isolateModules(() => {
      const core = require('../../src/core');
      const ce = new core.ComputeEngine();
      expect(ce._listCompilationTargets()).toEqual([
        'interval-js',
        'javascript',
      ]);
      require('../../src/compute-engine');
      expect(ce._listCompilationTargets()).toEqual([
        'interval-js',
        'javascript',
        'glsl',
      ]);
      const glsl = ce._compile(ce.box(['Add', 'x', 1]), { to: 'glsl' });
      expect(glsl.success).toBe(true);
      // One instance per engine: a second lookup gives the same target.
      expect(ce._getCompilationTarget('glsl')).toBe(
        ce._getCompilationTarget('glsl')
      );
      // A removed default stays removed for this engine.
      ce.unregisterCompilationTarget('glsl');
      expect(ce._listCompilationTargets()).not.toContain('glsl');
      expect(ce._getCompilationTarget('glsl')).toBeUndefined();
    });
  });

  test('the public registration method validates the name and the target', () => {
    const ce = new ComputeEngine();
    expect(() => ce.registerCompilationTarget('', new GLSLTarget())).toThrow();
    expect(() => ce.registerCompilationTarget('broken', {} as any)).toThrow();
    // A registration under an existing name replaces the earlier target.
    const glsl = new GLSLTarget();
    ce.registerCompilationTarget('glsl', glsl);
    expect(ce._getCompilationTarget('glsl')).toBe(glsl);
  });
});
