import type { Expression } from './types-expression';
import type { LanguageTarget } from './compilation/types';
import {
  assertCompilationTargetContract,
  assertCompilationTargetName,
} from './engine-extension-contracts';

import { JavaScriptTarget } from './compilation/javascript-target';
import { GLSLTarget } from './compilation/glsl-target';
import { WGSLTarget } from './compilation/wgsl-target';
import { IntervalJavaScriptTarget } from './compilation/interval-javascript-target';
import { IntervalGLSLTarget } from './compilation/interval-glsl-target';
import { IntervalWGSLTarget } from './compilation/interval-wgsl-target';

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
    this.register('interval-js', new IntervalJavaScriptTarget());
    this.register('interval-glsl', new IntervalGLSLTarget());
    this.register('interval-wgsl', new IntervalWGSLTarget());
  }
}
