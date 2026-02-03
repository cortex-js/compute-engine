/**
 * Interval arithmetic library for reliable function evaluation
 *
 * This module provides interval versions of mathematical operations
 * that return guaranteed enclosures of the true result. It's designed
 * for use in plotting applications to detect singularities and enable
 * adaptive sampling.
 *
 * @module interval
 */

// Import functions for the library object
import {
  ok as _ok,
  point as _point,
  containsExtremum as _containsExtremum,
  unionResults as _unionResults,
  mergeDomainClip as _mergeDomainClip,
  isPoint as _isPoint,
  containsZero as _containsZero,
  isPositive as _isPositive,
  isNegative as _isNegative,
  isNonNegative as _isNonNegative,
  isNonPositive as _isNonPositive,
  width as _width,
  midpoint as _midpoint,
  getValue as _getValue,
  unwrap as _unwrap,
  unwrapOrPropagate as _unwrapOrPropagate,
} from './util';
import {
  add as _add,
  sub as _sub,
  mul as _mul,
  div as _div,
  negate as _negate,
} from './arithmetic';
import {
  sqrt as _sqrt,
  square as _square,
  pow as _pow,
  powInterval as _powInterval,
  exp as _exp,
  ln as _ln,
  log10 as _log10,
  log2 as _log2,
  abs as _abs,
  floor as _floor,
  ceil as _ceil,
  round as _round,
  min as _min,
  max as _max,
  mod as _mod,
  sign as _sign,
} from './elementary';
import {
  sin as _sin,
  cos as _cos,
  tan as _tan,
  cot as _cot,
  sec as _sec,
  csc as _csc,
  asin as _asin,
  acos as _acos,
  atan as _atan,
  atan2 as _atan2,
  sinh as _sinh,
  cosh as _cosh,
  tanh as _tanh,
  asinh as _asinh,
  acosh as _acosh,
  atanh as _atanh,
} from './trigonometric';
import {
  less as _less,
  lessEqual as _lessEqual,
  greater as _greater,
  greaterEqual as _greaterEqual,
  equal as _equal,
  notEqual as _notEqual,
  and as _and,
  or as _or,
  not as _not,
  piecewise as _piecewise,
  clamp as _clamp,
} from './comparison';

// Types
export type { Interval, IntervalResult, BoolInterval } from './types';

// Utilities
export {
  ok,
  point,
  containsExtremum,
  unionResults,
  mergeDomainClip,
  isPoint,
  containsZero,
  isPositive,
  isNegative,
  isNonNegative,
  isNonPositive,
  width,
  midpoint,
  getValue,
  unwrap,
  unwrapOrPropagate,
} from './util';

// Arithmetic operations
export { add, sub, mul, div, negate, _mul } from './arithmetic';

// Elementary functions
export {
  sqrt,
  square,
  pow,
  powInterval,
  exp,
  ln,
  log10,
  log2,
  abs,
  floor,
  ceil,
  round,
  min,
  max,
  mod,
  sign,
} from './elementary';

// Trigonometric functions
export {
  sin,
  cos,
  tan,
  cot,
  sec,
  csc,
  asin,
  acos,
  atan,
  atan2,
  sinh,
  cosh,
  tanh,
  asinh,
  acosh,
  atanh,
} from './trigonometric';

// Comparison operations
export {
  less,
  lessEqual,
  greater,
  greaterEqual,
  equal,
  notEqual,
  and,
  or,
  not,
  piecewise,
  clamp,
} from './comparison';

/**
 * The complete interval arithmetic library object.
 *
 * This is the runtime library injected as `_IA` in compiled
 * interval arithmetic functions.
 */
export const IntervalArithmetic = {
  // Utilities
  ok: _ok,
  point: _point,
  containsExtremum: _containsExtremum,
  unionResults: _unionResults,
  mergeDomainClip: _mergeDomainClip,
  isPoint: _isPoint,
  containsZero: _containsZero,
  isPositive: _isPositive,
  isNegative: _isNegative,
  isNonNegative: _isNonNegative,
  isNonPositive: _isNonPositive,
  width: _width,
  midpoint: _midpoint,
  getValue: _getValue,
  unwrap: _unwrap,
  unwrapOrPropagate: _unwrapOrPropagate,

  // Arithmetic
  add: _add,
  sub: _sub,
  mul: _mul,
  div: _div,
  negate: _negate,

  // Elementary
  sqrt: _sqrt,
  square: _square,
  pow: _pow,
  powInterval: _powInterval,
  exp: _exp,
  ln: _ln,
  log10: _log10,
  log2: _log2,
  abs: _abs,
  floor: _floor,
  ceil: _ceil,
  round: _round,
  min: _min,
  max: _max,
  mod: _mod,
  sign: _sign,

  // Trigonometric
  sin: _sin,
  cos: _cos,
  tan: _tan,
  cot: _cot,
  sec: _sec,
  csc: _csc,
  asin: _asin,
  acos: _acos,
  atan: _atan,
  atan2: _atan2,
  sinh: _sinh,
  cosh: _cosh,
  tanh: _tanh,
  asinh: _asinh,
  acosh: _acosh,
  atanh: _atanh,

  // Comparison
  less: _less,
  lessEqual: _lessEqual,
  greater: _greater,
  greaterEqual: _greaterEqual,
  equal: _equal,
  notEqual: _notEqual,
  and: _and,
  or: _or,
  not: _not,
  piecewise: _piecewise,
  clamp: _clamp,
};
