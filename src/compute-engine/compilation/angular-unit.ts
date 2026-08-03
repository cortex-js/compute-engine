/**
 * The angular-unit compile boundary.
 *
 * The rewrite itself lives in `symbolic/angular-unit.ts` so the derivative
 * lowering in `library/calculus.ts` can reach it (`library/` must not import
 * from `compilation/`); it is re-exported here because the compilation
 * targets are its primary consumer — each applies it at its public
 * `compile()` entry.
 */
export { rewriteAngularUnit } from '../symbolic/angular-unit.js';
