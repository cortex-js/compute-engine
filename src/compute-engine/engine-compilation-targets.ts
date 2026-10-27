import type { Expression } from './types-expression.js';
import type { LanguageTarget } from './compilation/types.js';
import {
  assertCompilationTargetContract,
  assertCompilationTargetName,
} from './engine-extension-contracts.js';

import { JavaScriptTarget } from './compilation/javascript-target.js';
import { IntervalJavaScriptTarget } from './compilation/interval-javascript-target.js';

/**
 * The compilation targets that every engine resolves, as factories so that
 * each engine gets its own target instances.
 *
 * Only two targets are built into the engine module itself:
 *
 * - `javascript`, which the engine needs for its own implicit compilation
 *   (the `Map` auto-compile, the numeric quadrature, derivative and limit
 *   kernels, `NDSolve`, the nonlinear fit, the kernel pool), and
 * - `interval-js`, which the solver's domain enumeration asks for
 *   (`intervalFunction` in `boxed-expression/solve-domain.ts`).
 *
 * The GPU targets (`glsl`, `wgsl`) and the source-only `python` target are
 * NOT imported here, so that the `@cortex-js/compute-engine/core` entry does
 * not carry them (measured on 0.169.2: 316 KB minified for the GPU targets,
 * 93 KB for Python). The full package entry (`src/compute-engine.ts`) adds
 * them to this table with `addDefaultCompilationTarget()` when it is
 * imported. This table is one value for the whole program (every entry
 * shares the engine chunk), and a registry reads it on each lookup, so an
 * engine has these three targets as soon as the full entry, `./epsil` or the
 * CLI has been loaded anywhere in the program, whichever entry made the
 * engine and in whichever order: the default engine that the free functions
 * of `./core` cache is not left behind. A program that loads `./core` alone
 * has the two built-in targets, and registers one of the others with
 * `ce.registerCompilationTarget(name, target)` after importing the target
 * class from `@cortex-js/compute-engine/compile`. Design:
 * `docs/plans/2026-10-26-esm-only-build-and-opt-in-targets.md`.
 */
const DEFAULT_TARGETS = new Map<string, () => LanguageTarget<Expression>>([
  ['javascript', () => new JavaScriptTarget()],
  ['interval-js', () => new IntervalJavaScriptTarget()],
]);

/**
 * Add a target to the table of defaults that every engine resolves, the
 * engines that already exist included. A later call with the same name
 * replaces the factory for the engines that have not instantiated it yet.
 *
 * @internal
 */
export function addDefaultCompilationTarget(
  name: string,
  factory: () => LanguageTarget<Expression>
): void {
  assertCompilationTargetName(name);
  DEFAULT_TARGETS.set(name, factory);
}

/**
 * Internal registry for compilation targets.
 *
 * Keeps compilation target registration concerns out of ComputeEngine.
 *
 * A name resolves to the target registered on this registry, or else to an
 * instance made from the table of defaults at the time of the lookup (and
 * kept, so that one engine has one instance per target). A name removed with
 * `unregister()` stays removed for this registry, even when the table of
 * defaults has it.
 *
 * @internal
 */
export class CompilationTargetRegistry {
  private readonly _targets = new Map<string, LanguageTarget<Expression>>();
  /** The names removed with `unregister()`, which a default must not revive. */
  private readonly _removed = new Set<string>();

  register(name: string, target: LanguageTarget<Expression>): void {
    assertCompilationTargetName(name);
    assertCompilationTargetContract(target);
    this._targets.set(name, target);
    this._removed.delete(name);
  }

  get(name: string): LanguageTarget<Expression> | undefined {
    const registered = this._targets.get(name);
    if (registered) return registered;
    if (this._removed.has(name)) return undefined;
    const factory = DEFAULT_TARGETS.get(name);
    if (!factory) return undefined;
    const target = factory();
    this._targets.set(name, target);
    return target;
  }

  /** The names that resolve, the defaults (in table order) before the names
   * registered on this registry only. */
  list(): string[] {
    const names = new Set<string>();
    for (const name of DEFAULT_TARGETS.keys())
      if (!this._removed.has(name)) names.add(name);
    for (const name of this._targets.keys()) names.add(name);
    return [...names];
  }

  unregister(name: string): void {
    this._targets.delete(name);
    this._removed.add(name);
  }

  /** Instantiate every default of the table now, so that the two targets the
   * engine uses itself exist from the start. */
  registerDefaults(): void {
    for (const [name, factory] of DEFAULT_TARGETS)
      this.register(name, factory());
  }
}
