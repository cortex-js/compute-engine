/**
 * Which compilation targets an engine registers, by package entry.
 *
 * Every engine registers `javascript` and `interval-js`. The full entry
 * (`src/compute-engine.ts`) adds `glsl`, `wgsl` and `python` to the table of
 * defaults when it is imported; the `./core` entry (`src/core.ts`) does not,
 * so a `./core` consumer registers a GPU or Python target with
 * `ce.registerCompilationTarget()` after importing it from `./compile`.
 *
 * The jest module registry is shared by every test of this file, and the full
 * entry is imported here, so an engine from either entry has all five targets
 * in this process. The `./core`-only behavior is checked by `jest.isolateModules`,
 * which gives the engine module a fresh registry with nothing added.
 *
 * Design: `docs/plans/2026-10-26-esm-only-build-and-opt-in-targets.md`.
 */

import { ComputeEngine, GLSLTarget, PythonTarget } from '../../src/compute-engine';

describe('compilation target registration', () => {
  test('an engine of the full entry has the five default targets', () => {
    const ce = new ComputeEngine();
    expect(ce._listCompilationTargets()).toEqual([
      'javascript',
      'interval-js',
      'glsl',
      'wgsl',
      'python',
    ]);
  });

  test('an engine of the core entry has the two built-in targets only', () => {
    jest.isolateModules(() => {
      const core = require('../../src/core');
      const ce = new core.ComputeEngine();
      expect(ce._listCompilationTargets()).toEqual([
        'javascript',
        'interval-js',
      ]);

      // An unregistered target name fails with a message that names the
      // registered targets, so a `./core` consumer learns what to register.
      // (A `./core` engine has no LaTeX parser, hence `box`, not `parse`.)
      expect(() =>
        ce._compile(ce.box(['Add', 'x', 1]), { to: 'glsl', fallback: false })
      ).toThrow(/"glsl" is not registered.*javascript.*interval-js/);
    });
  });

  test('a core engine compiles to GLSL and Python after registering the targets', () => {
    jest.isolateModules(() => {
      const core = require('../../src/core');
      const {
        GLSLTarget: IsolatedGLSLTarget,
        PythonTarget: IsolatedPythonTarget,
      } = require('../../src/compile');
      const ce = new core.ComputeEngine();
      ce.registerCompilationTarget('glsl', new IsolatedGLSLTarget());
      ce.registerCompilationTarget('python', new IsolatedPythonTarget());
      expect(ce._listCompilationTargets()).toEqual([
        'javascript',
        'interval-js',
        'glsl',
        'python',
      ]);
      const expr = ce.box(['Add', 'x', 1]);
      const glsl = ce._compile(expr, { to: 'glsl' });
      expect(glsl.success).toBe(true);
      expect(glsl.code).toContain('x + 1.0');
      const python = ce._compile(expr, { to: 'python' });
      expect(python.success).toBe(true);
      // The Python target guards an undeclared variable against `None`, so
      // the sum is `(... x) + 1`, not a bare `x + 1`.
      expect(python.code).toMatch(/x\)? \+ 1$/);

      ce.unregisterCompilationTarget('python');
      expect(ce._listCompilationTargets()).not.toContain('python');
    });
  });

  test('a core engine made before the full entry loads resolves the targets the full entry adds', () => {
    // The default engine that the free functions of `./core` cache is in
    // this position: made first, used later by the full entry's `compile()`.
    jest.isolateModules(() => {
      const core = require('../../src/core');
      const ce = new core.ComputeEngine();
      expect(ce._listCompilationTargets()).toEqual([
        'javascript',
        'interval-js',
      ]);
      require('../../src/compute-engine');
      expect(ce._listCompilationTargets()).toEqual([
        'javascript',
        'interval-js',
        'glsl',
        'wgsl',
        'python',
      ]);
      const glsl = ce._compile(ce.box(['Add', 'x', 1]), { to: 'glsl' });
      expect(glsl.success).toBe(true);
      // One instance per engine: a second lookup gives the same target.
      expect(ce._getCompilationTarget('glsl')).toBe(
        ce._getCompilationTarget('glsl')
      );
      // A removed default stays removed for this engine.
      ce.unregisterCompilationTarget('wgsl');
      expect(ce._listCompilationTargets()).not.toContain('wgsl');
      expect(ce._getCompilationTarget('wgsl')).toBeUndefined();
    });
  });

  test('the public registration method validates the name and the target', () => {
    const ce = new ComputeEngine();
    expect(() => ce.registerCompilationTarget('', new GLSLTarget())).toThrow();
    expect(() =>
      ce.registerCompilationTarget('broken', {} as any)
    ).toThrow();
    // A registration under an existing name replaces the earlier target.
    const python = new PythonTarget({ includeImports: true });
    ce.registerCompilationTarget('python', python);
    expect(ce._getCompilationTarget('python')).toBe(python);
  });
});
