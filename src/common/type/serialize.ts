import { NUMERIC_TYPES } from './primitive';
import type { NamedElement, NumericPrimitiveType, Type } from './types';

const NEGATION_PRECEDENCE = 3;
const UNION_PRECEDENCE = 1;
const INTERSECTION_PRECEDENCE = 2;
const LIST_PRECEDENCE = 4;
const RECORD_PRECEDENCE = 5;
const DICTIONARY_PRECEDENCE = 6;
const SET_PRECEDENCE = 7;
const COLLECTION_PRECEDENCE = 8;
const TUPLE_PRECEDENCE = 9;
const SIGNATURE_PRECEDENCE = 10;
const VALUE_PRECEDENCE = 11;

export function typeToString(type: Type, precedence = 0): string {
  // Primitive types are already strings
  if (typeof type === 'string') return type;

  let result = '';

  switch (type.kind) {
    case 'value':
      // Serialize value types
      if (typeof type.value === 'string') result = `"${type.value}"`;
      else if (typeof type.value === 'boolean')
        result = type.value ? 'true' : 'false';
      else result = type.value.toString();
      break;

    case 'reference':
      // Serialize reference types
      result = type.name;
      break;

    case 'negation':
      // Serialize negation types
      result = `!${typeToString(type.type, NEGATION_PRECEDENCE)}`;
      break;

    case 'union':
      // Serialize union types
      result = type.types
        .map((t) => typeToString(t, UNION_PRECEDENCE))
        .join(' | ');
      break;

    case 'intersection':
      // Serialize intersection types
      result = type.types
        .map((t) => typeToString(t, INTERSECTION_PRECEDENCE))
        .join(' & ');
      break;

    case 'expression':
      result = `expression<${symbolName(type.operator)}>`;
      break;

    case 'symbol':
      result = `symbol<${symbolName(type.name)}>`;
      break;

    case 'numeric':
      if (Number.isFinite(type.lower) && Number.isFinite(type.upper)) {
        result = `${type.type}<${type.lower}..${type.upper}>`;
      } else if (Number.isFinite(type.lower)) {
        result = `${type.type}<${type.lower}..>`;
      } else if (Number.isFinite(type.upper)) {
        result = `${type.type}<..${type.upper}>`;
      } else {
        result = `${type.type}`;
      }
      break;

    case 'list':
      if (
        type.dimensions &&
        typeof type.elements === 'string' &&
        NUMERIC_TYPES.includes(type.elements as NumericPrimitiveType)
      ) {
        // We have a numeric list, possibly vector or matrix.
        if (type.dimensions === undefined) {
          //
          // A list of numbers without dimensions is a tensor
          //
          if (type.elements === 'number') result = 'tensor';
        } else if (type.dimensions.length === 1) {
          //
          // A list with one dimension is a vector
          //
          if (type.elements === 'number') {
            if (type.dimensions[0] < 0) result = 'vector';
            else result = `vector<${type.dimensions[0]}>`;
          } else {
            if (type.dimensions[0] < 0)
              result = `vector<${typeToString(type.elements)}>`;
            else
              result = `vector<${typeToString(type.elements)}^${type.dimensions[0]}>`;
          }
        } else if (type.dimensions.length === 2) {
          //
          // A list with two dimensions is a matrix
          //
          const dims = type.dimensions;
          if (type.elements === 'number') {
            // If the elements are 'number', we can use a simplified syntax
            if (dims[0] < 0 && dims[1] < 0) result = 'matrix';
            else result = `matrix<${dims[0]}x${dims[1]}>`;
          } else {
            if (dims[0] < 0 && dims[1] < 0)
              result = `matrix<${typeToString(type.elements)}>`;
            else
              result = `matrix<${typeToString(type.elements)}^(${dims[0]}x${dims[1]})>`;
          }
        }
      }
      if (!result) {
        // Serialize generic list types
        const dimensions = type.dimensions
          ? type.dimensions.length === 1
            ? `^${type.dimensions[0].toString()}`
            : `^(${type.dimensions.join('x')})`
          : '';
        result = `list<${typeToString(type.elements)}${dimensions}>`;
      }
      break;

    case 'record':
      // Serialize record types
      const elements = Object.entries(type.elements)
        .map(([key, value]) => `${key}: ${typeToString(value)}`)
        .join(', ');
      result = `record<${elements}>`;
      break;

    case 'dictionary':
      result = `dictionary<${typeToString(type.values)}>`;
      break;

    case 'set':
      result = `set<${typeToString(type.elements)}>`;
      break;

    case 'collection':
      result = `collection<${typeToString(type.elements)}>`;
      break;

    case 'indexed_collection':
      result = `indexed_collection<${typeToString(type.elements)}>`;
      break;

    case 'tuple':
      // Special case for tuples with 0 or 1 elements: use `tuple()` function
      // since `()` and `(string)` are ambiguous
      if (type.elements.length === 0) result = 'tuple';
      else if (type.elements.length === 1) {
        const [el] = type.elements;
        result = `tuple<${namedElement(el)}>`;
      } else {
        result =
          'tuple<' +
          type.elements.map((el) => namedElement(el)).join(', ') +
          '>';
      }
      break;

    case 'signature':
      // Serialize function signatures
      const args = type.args
        ? type.args.map((arg) => namedElement(arg)).join(', ')
        : '';
      const optArgs = type.optArgs
        ? type.optArgs.map((arg) => namedElement(arg) + '?').join(', ')
        : '';
      const varArg = type.variadicArg
        ? type.variadicMin === 0
          ? `${namedElement(type.variadicArg)}*`
          : `${namedElement(type.variadicArg)}+`
        : '';
      const argsList = [args, optArgs, varArg].filter((s) => s).join(', ');
      result = `(${argsList}) -> ${typeToString(type.result)}`;
      break;

    default:
      // If type is not recognized, return an error
      result = 'error';
  }

  // Add parentheses if the current type's precedence is lower than the parent type's precedence
  if (precedence > 0 && precedence > getPrecedence(type.kind))
    return `(${result!})`;

  return result!;
}

function namedElement(el: NamedElement): string {
  if (el.name) return `${el.name}: ${typeToString(el.type)}`;
  return typeToString(el.type);
}

function symbolName(name: string): string {
  // If the name is a basic identifier, return it as is
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;

  // Otherwise, return the name in backticks
  return `\`${name}\``;
}

function getPrecedence(kind: string): number {
  switch (kind) {
    case 'negation':
      return NEGATION_PRECEDENCE;
    case 'union':
      return UNION_PRECEDENCE;
    case 'intersection':
      return INTERSECTION_PRECEDENCE;
    case 'list':
      return LIST_PRECEDENCE;
    case 'record':
      return RECORD_PRECEDENCE;
    case 'dictionary':
      return DICTIONARY_PRECEDENCE;
    case 'set':
      return SET_PRECEDENCE;
    case 'collection':
    case 'indexed_collection':
      return COLLECTION_PRECEDENCE;
    case 'tuple':
      return TUPLE_PRECEDENCE;
    case 'signature':
      return SIGNATURE_PRECEDENCE;
    case 'value':
      return VALUE_PRECEDENCE;
    default:
      return 0;
  }
}
