import { ComputeEngine } from '../compute-engine-interface';
import { Expression } from '../math-json-format';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { BoxedExpression } from './public';
import {
  BoxedDictionary,
  BoxedFunction,
  BoxedNumber,
  BoxedString,
  BoxedSymbol,
} from './expression';

export function box(
  expr: Expression | BoxedExpression,
  ce?: ComputeEngine
): BoxedExpression {
  if (isBoxed(expr)) return expr;
  if (Array.isArray(expr)) return boxFunction(expr, ce);
  if (typeof expr === 'string') {
    if (
      expr.length >= 2 &&
      (expr[0] !== "'" || expr[expr.length - 1] !== "'")
    ) {
      //
      // A string literal is a JSON string that begins and ends with
      // **U+0027 APOSTROPHE** : **`'`** or an object literal with a `str` key.
      //
      return new BoxedString(expr.substring(1, expr.length - 1), ce);
    }
    return boxSymbol(expr, ce);
  }

  if (typeof expr === 'object') {
    if ('num' in expr) {
      expr = expr.num;
    } else {
      if ('dict' in expr) return new BoxedDictionary(expr.dict, ce);
      if ('fn' in expr) return boxFunction(expr.fn, ce);
      if ('str' in expr) return new BoxedString(expr.str, ce);
      if ('sym' in expr) return boxSymbol(expr.sym, ce);
    }
  }

  // console.assert(
  //   typeof expr === 'number' ||
  //     typeof expr === 'string' ||
  //     expr instanceof Decimal ||
  //     expr instanceof Complex
  // );
  if (typeof expr === 'string') {
    if (expr.endsWith('d') || expr.endsWith('n')) {
      new BoxedNumber(new Decimal(expr.slice(0, -1)));
    }
    return new BoxedNumber(Number.parseFloat(expr));
  }
  return new BoxedNumber(expr);
}

function boxSymbol(sym: string, ce?: ComputeEngine): BoxedExpression {
  // Special symbols
  if (sym === 'ThreeQuarter') return new BoxedNumber([3, 4], ce);
  if (sym === 'TwoThird') return new BoxedNumber([2, 3], ce);
  if (sym === 'Half') return new BoxedNumber([1, 2], ce);
  if (sym === 'Third') return new BoxedNumber([1, 3], ce);
  if (sym === 'Quarter') return new BoxedNumber([1, 4], ce);

  if (sym === 'ImaginaryUnit') return new BoxedNumber(Complex.I, ce);
  if (sym === 'ComplexInfinity') return new BoxedNumber(Complex.INFINITY, ce);

  return new BoxedSymbol(sym, ce);
}

function boxFunction(fn: Expression[], ce?: ComputeEngine): BoxedExpression {
  console.assert(fn.length > 0);
  const head = fn[0];

  //
  // Is this a complex number in disguise?
  // - ["Add", re, "ImaginaryUnit"]
  // - ["Add", re, ["Multiply", im, "ImaginaryUnit"]]
  // - ["Subtract", re, "ImaginaryUnit"]
  // - ["Subtract", re, ["Multiply", im, "ImaginaryUnit"]]
  // - ["Complex", re, im]
  //
  if (head === 'Complex') {
    const re = getMachineValue(fn[1]);
    const im = getMachineValue(fn[2]);
    if (im === 0) return new BoxedNumber(re);
    return new BoxedNumber(new Complex(re, im));
  }

  let im = getImaginaryValue(fn);
  if (im !== null) return new BoxedNumber(new Complex(0, im));

  if (head === 'Add' && fn.length === 2) {
    let re = getMachineValue(fn[1]);
    if (re !== null) im = getImaginaryValue(fn[2]);
    else {
      im = getImaginaryValue(fn[1]);
      if (im !== null) re = getMachineValue(fn[2]);
    }
    if (re !== null && im !== null) return new BoxedNumber(new Complex(re, im));
  }

  if (head === 'Subtract' && fn.length === 2) {
    let re = getMachineValue(fn[1]);
    if (re !== null) {
      im = getImaginaryValue(fn[2]);
      if (im !== null) return new BoxedNumber(new Complex(re, -im));
    } else {
      im = getImaginaryValue(fn[1]);
      if (im !== null) {
        re = getMachineValue(fn[2]);
        if (re !== null) return new BoxedNumber(new Complex(-re, im));
      }
    }
  }

  if (head === 'Divide') {
    const numer = getMachineValue(fn[1]);
    const denom = getMachineValue(fn[2]);
    if (numer === null || denom === null) return new BoxedFunction(fn, ce);
    if (denom === 1) return new BoxedNumber(numer);
    if (Number.isInteger(numer) && Number.isInteger(denom))
      return new BoxedNumber([numer, denom]);
  }

  if (head === 'Power') {
    const exponent = getMachineValue(fn[2]);
    if (exponent === 1) {
      const base = getMachineValue(fn[1]);
      if (base !== null && Number.isInteger(base)) return new BoxedNumber(base);
    } else if (exponent === -1) {
      const base = getMachineValue(fn[1]);
      if (base !== null && Number.isInteger(base))
        return new BoxedNumber([1, base]);
    }
  }

  // @todo: if (head === 'Negate')
  // @todo: if (head === 'Square')
  // @todo: if (head === 'Square')

  return new BoxedFunction(fn, ce);
}

export function isBoxed(
  expr: BoxedExpression | Expression
): expr is BoxedExpression {
  return expr instanceof BoxedExpression;
}

function getMachineValue(expr: Expression | undefined): number | null {
  if (expr === undefined) return null;
  let fn: null | Expression[] = null;
  if (Array.isArray(expr)) {
    fn = expr;
  } else if (typeof expr === 'object' && 'fn' in expr) {
    fn = expr.fn;
  }
  if (fn) {
    const head = fn[0];
    // The `-` sign is not considered part of numbers when parsed, instead a
    // ['Negate'...] is generated. This is to correctly support `-1^2`
    if (head === 'Negate') {
      const val = getMachineValue(expr[1]);
      if (val === null) return null;
      return -val;
    }
  }

  if (typeof expr === 'object' && 'num' in expr) expr = expr.num;

  if (typeof expr === 'number') return expr;

  if (typeof expr === 'string') {
    if (expr === 'NaN') return Number.NaN;
    if (expr === 'Infinity' || expr === '+Infinity') return Infinity;
    if (expr === '-Infinity') return -Infinity;
    if (expr.endsWith('d') || expr.endsWith('n')) {
      return new Decimal(expr.slice(-1)).toNumber();
    }
    return Number.parseFloat(expr);
  }
  return null;
}

/**
 * Return a multiple of the imaginary unit, e.g.
 * - 'ImaginaryUnit'
 * - ['Negate', 'ImaginaryUnit']
 * - ['Multiply', 5, 'ImaginaryUnit']
 * - ['Multiply', 'ImaginaryUnit', 5]
 */
function getImaginaryValue(expr: Expression): number | null {
  if (isImaginaryUnit(expr)) return 1;

  let val: number | null = null;
  let fn: null | Expression[] = null;
  if (Array.isArray(expr)) {
    fn = expr;
  } else if (typeof expr === 'object' && 'fn' in expr) {
    fn = expr.fn;
  }
  if (fn === null) return null;
  const name = fn[0];
  if (name === 'Multiply' && fn.length === 2) {
    if (isImaginaryUnit(fn[1])) {
      val = getMachineValue(fn[2]);
    } else if (isImaginaryUnit(fn[2])) {
      val = getMachineValue(fn[1]);
    }
  } else if (name === 'Negate' && fn.length === 1) {
    val = getImaginaryValue(fn[1]);
    if (val !== null) return -val;
  }
  return val === 0 ? null : val;
}

function isImaginaryUnit(expr: Expression): boolean {
  if (expr === 'ImaginaryUnit') return true;
  return (
    typeof expr === 'object' && 'sym' in expr && expr.sym === 'ImaginaryUnit'
  );
}
