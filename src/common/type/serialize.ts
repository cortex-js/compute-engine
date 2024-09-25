import { isSubtype } from './subtype';
import type { NamedElement, Type } from './types';

const NEGATION_PRECEDENCE = 3;
const UNION_PRECEDENCE = 1;
const INTERSECTION_PRECEDENCE = 2;
const LIST_PRECEDENCE = 4;
const MAP_PRECEDENCE = 5;
const SET_PRECEDENCE = 6;
const COLLECTION_PRECEDENCE = 7;
const TUPLE_PRECEDENCE = 8;
const SIGNATURE_PRECEDENCE = 9;

export function typeToString(type: Type, precedence = 0): string {
  // Primitive types are already strings
  if (typeof type === 'string') return type;

  let result = '';

  switch (type.kind) {
    case 'value':
      // Serialize value types
      result = type.value.toString();
      break;

    case 'reference':
      // Serialize reference types
      result = type.ref;
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

    case 'list':
      if (type.dimensions && isSubtype(type.elements, 'number')) {
        // We have a numeric list, possibly vector or matrix.
        if (type.dimensions === undefined) {
          if (type.elements === 'number') result = 'tensor';
        } else if (type.dimensions.length === 1) {
          if (type.elements === 'number') {
            if (type.dimensions[0] < 0) result = 'vector';
            else result = `vector<${type.dimensions[0]}>`;
          } else {
            if (type.dimensions[0] < 0) result = `vector<${type.elements}>`;
            else result = `vector<${type.elements}^${type.dimensions[0]}>`;
          }
        } else if (type.dimensions.length === 2) {
          const dims = type.dimensions;
          if (type.elements === 'number') {
            if (dims[0] < 0 && dims[1] < 0) result = 'matrix';
            else result = `matrix<${dims[0]}x${dims[1]}>`;
          } else {
            if (dims[0] < 0 && dims[1] < 0) result = `matrix<${type.elements}>`;
            else result = `matrix<${type.elements}^(${dims[0]}x${dims[1]})>`;
          }
        }
      }
      if (!result) {
        // Serialize collection types
        const dimensions = type.dimensions
          ? type.dimensions.length === 1
            ? `^${type.dimensions[0].toString()}`
            : `^(${type.dimensions.join('x')})`
          : '';
        result = `list<${typeToString(type.elements)}${dimensions}>`;
      }
      break;

    case 'map':
      // Serialize record types
      const elements = Object.entries(type.elements)
        .map(([key, value]) => `${key}: ${typeToString(value)}`)
        .join(', ');
      result = `map<${elements}>`;
      break;

    case 'set':
      // Serialize set types
      result = `set<${typeToString(type.elements)}>`;
      break;

    case 'collection':
      // Serialize collection types
      result = `collection<${typeToString(type.elements)}>`;
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
      const restArg = type.restArg ? `...${namedElement(type.restArg)}` : '';
      const argsList = [args, optArgs, restArg].filter((s) => s).join(', ');
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
    case 'map':
      return MAP_PRECEDENCE;
    case 'set':
      return SET_PRECEDENCE;
    case 'collection':
      return COLLECTION_PRECEDENCE;
    case 'tuple':
      return TUPLE_PRECEDENCE;
    case 'signature':
      return SIGNATURE_PRECEDENCE;
    default:
      return 0;
  }
}
