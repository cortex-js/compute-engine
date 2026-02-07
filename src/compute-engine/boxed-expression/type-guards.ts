import { _BoxedExpression } from './abstract-boxed-expression';
import { BoxedNumber } from './boxed-number';
import { BoxedSymbol } from './boxed-symbol';
import { BoxedFunction } from './boxed-function';
import { BoxedString } from './boxed-string';
import { BoxedTensor } from './boxed-tensor';
import { BoxedDictionary } from './boxed-dictionary';
import type { BoxedExpression, DictionaryInterface } from '../global-types';

export function isBoxedExpression(x: unknown): x is BoxedExpression {
  return x instanceof _BoxedExpression;
}

export function isBoxedNumber(
  expr: BoxedExpression | null | undefined
): expr is BoxedNumber {
  return expr instanceof BoxedNumber;
}

export function isBoxedSymbol(
  expr: BoxedExpression | null | undefined
): expr is BoxedSymbol {
  return expr instanceof BoxedSymbol;
}

export function isBoxedFunction(
  expr: BoxedExpression | null | undefined
): expr is BoxedFunction {
  return expr instanceof BoxedFunction;
}

export function isBoxedString(
  expr: BoxedExpression | null | undefined
): expr is BoxedString {
  return expr instanceof BoxedString;
}

export function isBoxedTensor(
  expr: BoxedExpression | null | undefined
): expr is BoxedTensor<any> {
  return expr instanceof BoxedTensor;
}

export function isDictionary(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & DictionaryInterface {
  return expr instanceof BoxedDictionary;
}
