import type { Expression } from './types-expression.js';
import type { LanguageTarget } from './compilation/types.js';
import {
  assertCompilationTargetContract,
  assertCompilationTargetName,
} from './engine-extension-contracts.js';

import { JavaScriptTarget } from './compilation/javascript-target.js';
import { GLSLTarget } from './compilation/glsl-target.js';
import { WGSLTarget } from './compilation/wgsl-target.js';
import { PythonTarget } from './compilation/python-target.js';
import { IntervalJavaScriptTarget } from './compilation/interval-javascript-target.js';
import { IntervalGLSLTarget } from './compilation/interval-glsl-target.js';

/**
 * Compilation target names that are deprecated and scheduled for removal in a
 * future release. GPU interval evaluation only pays off when the whole pipeline
 * stays on the GPU; the compile → FBO → readPixels → CPU round-trip is
 * net-negative versus CPU `interval-js`, and these targets cannot compile any
 * relational operator (so they cannot host restriction/masking conditions).
 * Use `interval-js` (CPU interval arithmetic) or the scalar `glsl`/`wgsl`
 * targets instead.
 *
 * @internal
 */
const DEPRECATED_COMPILATION_TARGETS = new Set([
  'interval-glsl',
  'interval-wgsl',
]);

/**
 * Module-level guard so the deprecation notice for a given target is emitted at
 * most once per process (not once per compile). `console.*` is stripped in the
 * minified production build; that is expected.
 *
 * @internal
 */
const _warnedDeprecatedTargets = new Set<string>();

function warnDeprecatedTarget(name: string): void {
  if (_warnedDeprecatedTargets.has(name)) return;
  _warnedDeprecatedTargets.add(name);
  console.warn(
    `The "${name}" compilation target is deprecated and will be removed in a ` +
      `future release. Use "interval-js" (CPU interval arithmetic) or the ` +
      `scalar "glsl"/"wgsl" targets instead.`
  );
}

/**
 * Internal registry for compilation targets.
 *
 * Keeps compilation target registration concerns out of ComputeEngine.
 *
 * @internal
 */
export class CompilationTargetRegistry {
  private readonly _targets = new Map<string, LanguageTarget<Expression>>();

  register(name: string, target: LanguageTarget<Expression>): void {
    assertCompilationTargetName(name);
    assertCompilationTargetContract(target);
    this._targets.set(name, target);
  }

  get(name: string): LanguageTarget<Expression> | undefined {
    if (DEPRECATED_COMPILATION_TARGETS.has(name)) warnDeprecatedTarget(name);
    return this._targets.get(name);
  }

  list(): string[] {
    return [...this._targets.keys()];
  }

  unregister(name: string): void {
    this._targets.delete(name);
  }

  registerDefaults(): void {
    this.register('javascript', new JavaScriptTarget());
    this.register('glsl', new GLSLTarget());
    this.register('wgsl', new WGSLTarget());
    // Source-only Python/NumPy target. Registered so the documented
    // `compile({ to: 'python' })` name resolves; it produces `.code` (no `run`).
    this.register('python', new PythonTarget());
    this.register('interval-js', new IntervalJavaScriptTarget());
    // @deprecated `interval-glsl` (and the never-rebuilt `interval-wgsl`) are
    // deprecated and will be removed in a future release. Use `interval-js`
    // (CPU interval arithmetic) or the scalar `glsl`/`wgsl` targets instead.
    this.register('interval-glsl', new IntervalGLSLTarget());
  }
}
