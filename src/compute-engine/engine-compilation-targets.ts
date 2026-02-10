import type { BoxedExpression } from './types-expression';
import type { LanguageTarget } from './compilation/types';

import { JavaScriptTarget } from './compilation/javascript-target';
import { GLSLTarget } from './compilation/glsl-target';
import { IntervalJavaScriptTarget } from './compilation/interval-javascript-target';
import { IntervalGLSLTarget } from './compilation/interval-glsl-target';

/**
 * Internal registry for compilation targets.
 *
 * Keeps compilation target registration concerns out of ComputeEngine.
 *
 * @internal
 */
export class CompilationTargetRegistry {
  private readonly _targets = new Map<string, LanguageTarget<BoxedExpression>>();

  register(name: string, target: LanguageTarget<BoxedExpression>): void {
    this._targets.set(name, target);
  }

  get(name: string): LanguageTarget<BoxedExpression> | undefined {
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
    this.register('interval-js', new IntervalJavaScriptTarget());
    this.register('interval-glsl', new IntervalGLSLTarget());
  }
}

