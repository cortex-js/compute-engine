/**
 * The names of the built-in compilation targets, which `compile()` is to
 * route itself. Custom targets are being removed.
 *
 * @module compilation/targets
 */
export const BUILT_IN_TARGETS = ['javascript', 'glsl', 'interval-js'] as const;

export type BuiltInTarget = (typeof BUILT_IN_TARGETS)[number];

/**
 * The built-in names that `compile()` routes itself today, without the
 * registry: every engine compiles to them. ce-compiler adds `javascript` and
 * `glsl` when it routes them.
 */
export const ROUTED_TARGETS = [
  'interval-js',
] as const satisfies readonly BuiltInTarget[];
