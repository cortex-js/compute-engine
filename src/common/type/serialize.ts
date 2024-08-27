import type { NamedElement, Type } from './types';

export function typeToString(type: Type): string {
  // Primitive types are already strings
  if (typeof type === 'string') return type;

  switch (type.kind) {
    case 'union':
      // Serialize union types, adding parentheses around intersections
      return type.types
        .map((t) => {
          const str = typeToString(t);
          return typeof t === 'object' && t.kind === 'intersection'
            ? `(${str})`
            : str;
        })
        .join(' | ');

    case 'intersection':
      // Serialize intersection types
      return type.types.map(typeToString).join(' & ');

    case 'list':
      // Serialize collection types
      const dimensions = type.dimensions
        ? type.dimensions.length === 1
          ? `^${type.dimensions[0].toString()}`
          : `^(${type.dimensions.join('x')})`
        : '';
      return `[${typeToString(type.elements)}${dimensions}]`;

    case 'map':
      // Serialize record types
      const elements = Object.entries(type.elements)
        .map(([key, value]) => `${key}: ${typeToString(value)}`)
        .join(', ');
      return `{${elements}}`;

    case 'set':
      // Serialize set types
      return `set<${typeToString(type.elements)}>`;

    case 'collection':
      // Serialize collection types
      return `collection<${typeToString(type.elements)}>`;

    case 'tuple':
      // Special case for tuples with 0 or 1 elements: use `tuple()` function
      // since `()` and `(string)` are ambiguous
      if (type.elements.length === 0) return 'tuple()';
      if (type.elements.length === 1) {
        const [el] = type.elements;
        return `tuple(${namedElement(el)})`;
      }
      return '(' + type.elements.map((el) => namedElement(el)).join(', ') + ')';

    case 'signature':
      // Serialize function signatures
      const args = type.args
        ? type.args.map((arg) => namedElement(arg)).join(', ')
        : '';
      const optArgs = type.optArgs
        ? type.optArgs.map((arg) => namedElement(arg) + '?').join(', ')
        : '';
      const restArg = type.restArg ? `...${namedElement(type.restArg)}` : '';
      const hold = type.hold ? '???' : '';
      const argsList = [args, optArgs, restArg].filter((s) => s).join(', ');
      return `${hold}(${argsList}) -> ${typeToString(type.result)}`;

    default:
      // If type is not recognized, return an error
      return 'error';
  }
}

function namedElement(el: NamedElement): string {
  if (el.name) return `${el.name}: ${typeToString(el.type)}`;
  return typeToString(el.type);
}
