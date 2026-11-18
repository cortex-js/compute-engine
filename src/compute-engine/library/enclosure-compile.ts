/**
 * The tables that the interval mode of the profile `ir` reads to compile the
 * value kind `enclosure` (`compilation/ir/lower-enclosure.ts`;
 * `docs/plans/2026-10-26-value-kinds.md`, section 4.9.2, "Compilation").
 *
 * The compiled form of an enclosure is the interval of the interval mode
 * (`compile(expr, { to: 'interval-js' })`), which lowers the kind itself.
 * Every other target declines an expression that holds an enclosure.
 */

import type { Type } from '../../common/type/types.js';
import { isKindArm, type KindTypeNames } from '../../common/type/utils.js';
import { isRecord } from '../interval/run-support.js';

const ENCLOSURE_KIND: KindTypeNames = { has: (name) => name === 'enclosure' };

/**
 * True when a value of the type `t` may be ONE enclosure: `t` is the kind
 * type `enclosure`, or a union with an `enclosure` arm (`real | enclosure`,
 * `enclosure | nan`). A collection of enclosures (`list<enclosure>`) is not
 * one enclosure.
 */
export function hasEnclosureArm(t: Readonly<Type>): boolean {
  if (isKindArm(t, ENCLOSURE_KIND)) return true;
  return (
    typeof t !== 'string' &&
    t.kind === 'union' &&
    t.types.some((arm) => isKindArm(arm, ENCLOSURE_KIND))
  );
}

/** The `_IA` function of each operator of one operand of the `apply` table
 * (`UNARY_RULES` in `enclosure-arithmetic.ts`). */
export const ENCLOSURE_UNARY_KERNELS: Readonly<Record<string, string>> = {
  Ln: 'ln',
  Sinh: 'sinh',
  Tanh: 'tanh',
  Arsinh: 'asinh',
  Arctan: 'atan',
  Artanh: 'atanh',
  Arcosh: 'acosh',
  Arcsin: 'asin',
  Arccos: 'acos',
  Erf: 'erf',
  Erfc: 'erfc',
  Sin: 'sin',
  Cos: 'cos',
  Tan: 'tan',
  Cot: 'cot',
  Sec: 'sec',
  Csc: 'csc',
  Cosh: 'cosh',
  Abs: 'abs',
  Sign: 'sign',
  Heaviside: 'heaviside',
  Gamma: 'gamma',
  Fract: 'fract',
};

/**
 * The run-time check of a host value given for a free symbol of type
 * `enclosure`: a record `{ lo, hi }` of two numbers with `lo <= hi`, where
 * `±Infinity` is allowed but not the same infinity twice (it holds no real)
 * and `NaN` is refused; or a finite number (a point).
 */
export function isEnclosureEntry(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!isRecord(value)) return false;
  const { lo, hi } = value as { lo?: unknown; hi?: unknown };
  if (typeof lo !== 'number' || typeof hi !== 'number') return false;
  if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) return false;
  return !(lo === hi && !Number.isFinite(lo));
}
