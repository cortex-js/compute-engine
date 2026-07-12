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
  }
}
