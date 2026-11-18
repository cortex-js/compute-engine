/**
 * The names of the built-in compilation targets, which `compile()` routes
 * itself: every engine compiles to them, with the profile `ir`
 * (`compileInScope()` in `compile-expression.ts`).
 *
 * @module compilation/targets
 */
export const BUILT_IN_TARGETS = ['javascript', 'glsl', 'interval-js'] as const;
