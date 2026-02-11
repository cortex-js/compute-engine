// https://docs.python.org/3/reference/expressions.html

// https://github.com/python/cpython/blob/390459de6db1e68b79c0897cc88c0d562693ec5c/Grammar/python.gram

import { symbol } from '../math-json';
import type { MathJsonExpression as Expression } from './types';

const DIGITS = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  'a': 10,
  'b': 11,
  'c': 12,
  'd': 13,
  'e': 14,
  'f': 15,
  'A': 10,
  'B': 11,
  'C': 12,
  'D': 13,
  'E': 14,
  'F': 15,
};

function skipWhitespace(s: string, i: number): number {
  while (/[\u0020\u0009\u000c]/.test(s[i])) i += 1;
  return i;
}

function identifier(
  s: string,
  i: number
): [i: number, result: Expression | null] {
  const m = s.slice(i).match(/^[\p{XIDS}_][\p{XIDC}]*/u);
  if (m === null) return [i, null];
  return [i + m[0].length, symbol(m[0])];
}

function exponent(s: string, i: number): [i: number, result: string | null] {
  if (s[i] !== 'e' && s[i] !== 'E') return [i, null];
  const start = i;
  i += 1;
  let sign = '';
  if (s[i] === '+' || s[i] === '-') sign = s[i++];
  let d: string | null;
  [i, d] = digitpart(s, i);
  if (d !== null) return [i, 'e' + sign + d];

  return [start, null];
}

function fraction(s: string, i: number): [i: number, result: string | null] {
  const start = i;
  if (s[i] !== '.') return [i, null];
  let d: string | null;
  [i, d] = digitpart(s, i + 1);
  if (d !== null) return [i, '.' + d];
  return [start, null];
}

function digitpart(
  s: string,
  i: number
): [index: number, digits: string | null] {
  if (!/^[0-9]$/.test(s[i])) return [i, null];
  let result = s[i++];
  while (/^[0-9_]$/.test(s[i])) {
    if (s[i] !== '_') result = result + s[i];
    i += 1;
  }

  return [i, result];
}

function integer(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  const start = i;
  let result: Expression | null = null;
  [i, result] = decinteger(s, start);
  if (result === null) [i, result] = bininteger(s, start);
  if (result === null) [i, result] = octinteger(s, start);
  if (result === null) [i, result] = hexinteger(s, start);

  if (result === null || /^[eEjJ\.]$/.test(s[i])) return [start, null];

  return [i, result];
}

function hexinteger(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  const start = i;
  if (s[i] === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
    i += 2;
    if (/[0-9A-Fa-f_]/.test(s[i])) {
      let result = 0;
      while (s[i] && /^[0-9A-Fa-f_]$/.test(s[i])) {
        if (s[i] === '_') i += 1;
        else result = 16 * result + DIGITS[s[i++]];
      }
      return [i, ['BaseForm', result, 16]];
    }
  }

  return [start, null];
}

function octinteger(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  const start = i;
  if (s[i] === '0' && (s[i + 1] === 'o' || s[i + 1] === 'O')) {
    i += 2;
    if (/^[0-7_]$/.test(s[i])) {
      let result = 0;
      while (s[i] && /[07_]/.test(s[i])) {
        if (s[i] === '_') i += 1;
        else result = 8 * result + DIGITS[s[i++]];
      }
      return [i, ['BaseForm', result, 8]];
    }
  }

  return [start, null];
}

function bininteger(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  const start = i;
  if (s[i] === '0' && (s[i + 1] === 'b' || s[i + 1] === 'B')) {
    i += 2;
    if (/^[01_]$/.test(s[i])) {
      let result = 0;
      while (s[i] && /[01_]/.test(s[i])) {
        if (s[i] === '0') result *= 2;
        else if (s[i] === '1') result = 2 * result + 1;
        i += 1;
      }
      return [i, ['BaseForm', result, 2]];
    }
  }

  return [start, null];
}

function decinteger(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  if (s[i] === '0') {
    if (/[bBoOxX]/.test(s[i + 1])) return [i, null];
    i += 1;
    while (s[i] === '_' || s[i] === '0') i++;
    return [i, 0];
  }

  if (!/[1-9]/.test(s[i])) return [i, null];

  let result = s.charCodeAt(i++) - 0x30;
  while (/[0-9_]/.test(s[i])) {
    if (s[i] !== '_') result = result * 10 + s.charCodeAt(i) - 0x30;
    i += 1;
  }
  return [i, result];
}

function pointfloat(
  s: string,
  i: number
): [index: number, result: string | null] {
  const start = i;

  let d: string | null;
  let f: string | null;

  [i, d] = digitpart(s, i);
  [i, f] = fraction(s, i);
  if (d === null && f !== null) return [i, f];
  if (f !== null) return [i, d + f];
  if (s[i] === '.') return [i + 1, d + '.'];
  return [start, null];
}

function exponentfloat(
  s: string,
  i: number
): [index: number, result: string | null] {
  const start = i;
  let f: string | null;

  [i, f] = pointfloat(s, i);
  if (f === null) [i, f] = digitpart(s, i);
  if (f === null) return [start, null];

  let e: string | null;
  [i, e] = exponent(s, i);
  if (e === null) return [start, null];

  return [i, f + e];
}

function floatnumber(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  let result: Expression | null = null;
  [i, result] = exponentfloat(s, i);
  if (result === null) [i, result] = pointfloat(s, i);
  if (result === null) return [i, null];
  return [i, parseFloat(result)];
}

function imagnumber(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  let n: Expression | null = null;
  const start = i;
  [i, n] = floatnumber(s, start);
  if (n === null) [i, n] = digitpart(s, start);
  if (n !== null && /^[jJ]$/.test(s[i])) {
    if (typeof n === 'string') n = Number.parseInt(n);
    return [i + 1, ['Complex', 0, n]];
  }
  return [start, null];
}

function bytesliteral(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  // @todo
  return [i, null];
}

function stringliteral(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  // if (/^(r|u|f|fr|rf)/i.test(s.slice(i))

  //  @todo
  return [i, null];
}

function literal(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  let rhs: Expression | null;
  const start = i;
  [i, rhs] = stringliteral(s, start);
  if (rhs !== null) return [i, rhs];
  [i, rhs] = bytesliteral(s, start);
  if (rhs !== null) return [i, rhs];
  [i, rhs] = imagnumber(s, start); // order matters, before float
  if (rhs !== null) return [i, rhs];
  [i, rhs] = floatnumber(s, start); // order matters, before integer
  if (rhs !== null) return [i, rhs];
  [i, rhs] = integer(s, start);
  if (rhs !== null) return [i, rhs];
  return [start, null];
}

function enclosure(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  let r: Expression | null;
  [i, r] = parenth_form(s, i);
  // @todo:
  // if (r === null) [i, r] = list_display(s, i);
  // if (r === null) [i, r] = dict_display(s, i);
  // if (r === null) [i, r] = set_display(s, i);
  // if (r === null) [i, r] = generator_expression(s, i);
  // if (r === null) [i, r] = yield_atom(s, i);

  return [i, r];
}

function atom(
  s: string,
  start: number
): [index: number, result: Expression | null] {
  let [i, e] = identifier(s, start);
  if (e) return [i, e];

  [i, e] = literal(s, start);
  if (e) return [i, e];

  [i, e] = enclosure(s, start);
  if (e) return [i, e];

  return [start, null];
}

// expression_list    ::=  expression ("," expression)* [","]
function expressionList(
  s: string,
  start: number
): [index: number, result: Expression[]] {
  let done = false;
  const exprs: Expression[] = [];
  let i = start;
  while (!done) {
    let e: Expression | null;
    [i, e] = expression(s, i);

    if (e !== null) exprs.push(e);
    if (s[i] === ',') i += 1;

    done = e === null;
  }
  return [i, exprs];
}

function primary(
  s: string,
  start: number
): [index: number, result: Expression | null] {
  // @todo:  atom | attributeref | subscription | slicing | call

  // eslint-disable-next-line prefer-const
  let [i, e] = atom(s, start);
  if (e) return [i, e];

  // subscription, slice, call attribute reference (x[i], x[a:b], x(a), x.a)
  if (e !== null && s[i] === '(') {
    if (symbol(e)) {
      let args: Expression[];
      [i, args] = expressionList(s, i);
      if (s[i] === ')') {
        return [i, [symbol(e), ...args] as Expression];
      }
    }
  }

  return [start, null];
}

function expression(
  s: string,
  i: number
): [index: number, result: Expression | null] {
  let lhs: Expression | null;
  [i, lhs] = primary(s, i);
  return [i, lhs];
}

function parenth_form(
  s: string,
  start: number
): [i: number, result: Expression | null] {
  if (s[start] !== '(') return [start, null];
  // In full python, this could be a starred_expression
  const [i, e] = expression(s, start + 1);
  if (e === null) return [start, null];
  if (s[i] !== ')') return [start, null];
  return [i, ['Delimiter', e]];
}

export function parse(s: string): Expression {
  if (!s) return 'Nothing';
  try {
    // eslint-disable-next-line prefer-const
    let [i, result] = expression(s, skipWhitespace(s, 0));

    i = skipWhitespace(s, i);

    if (i < s.length)
      return ['Error', { str: 'unexpected-token' }, { str: s.substring(i) }];

    return result ?? 'Nothing';
  } catch (e) {
    console.error(e.message);
  }
  return 'Nothing';
}
