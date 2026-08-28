import { NUMERIC_TYPES_SET } from './primitive.js';
import { effectSetToString } from './effects.js';
import { isComplexInfinityValue } from './types.js';
import type { NamedElement, NumericPrimitiveType, Type } from './types.js';

// Binding tightness, ascending. A node is parenthesized when the context it is
// being emitted into binds *tighter* than the node itself (see the check at the
// end of `typeToString`), so these must mirror the grammar in `parser.ts`.
//
// `signature` is the LOOSEST: the parser reads a signature's result type with
// `parseUnionType()` (`parser.ts:594`), so `->` extends maximally to the right
// and absorbs any following `&`/`|`. A signature appearing as a member of a
// union, an intersection or a negation must therefore be parenthesized —
// without it, `((number) -> real) & string` re-parsed as the single signature
// `(number) -> (real & string)`, a structurally different type with an
// identical serialization.
const SIGNATURE_PRECEDENCE = 1;
const UNION_PRECEDENCE = 2;
const INTERSECTION_PRECEDENCE = 3;
const NEGATION_PRECEDENCE = 4;
const LIST_PRECEDENCE = 5;
const RECORD_PRECEDENCE = 6;
const DICTIONARY_PRECEDENCE = 7;
const SET_PRECEDENCE = 8;
const COLLECTION_PRECEDENCE = 9;
const TUPLE_PRECEDENCE = 10;
const VALUE_PRECEDENCE = 11;

/**
 * While set, {@link typeToString} elides the ` pure` specifier of a STATED
 * empty effect set, emitting the bare arrow instead. See
 * {@link typeToDedupKey}. Read only by the `signature` case below; set and
 * restored around one synchronous, non-reentrant call.
 */
let ELIDE_STATED_PURE = false;

/**
 * The structural de-duplication key of a type: its serialization, with every
 * stated-pure arrow (`effects: []`) written as a bare arrow.
 *
 * `(int) pure -> int` and `(int) -> int` are the SAME type — the two spellings
 * of ∅ are semantically one state (ruled 2026-08-01, see `EffectSet` in
 * `types.ts`) — so union reduction, which keys members by their serialized
 * form, has to merge them. Serialization alone would not.
 */
export function typeToDedupKey(type: Type): string {
  if (typeof type === 'string') return type;
  ELIDE_STATED_PURE = true;
  try {
    return typeToString(type);
  } finally {
    ELIDE_STATED_PURE = false;
  }
}

export function typeToString(type: Type, precedence = 0): string {
  // Primitive types are already strings
  if (typeof type === 'string') return type;

  let result = '';

  switch (type.kind) {
    case 'value':
      // Serialize value types. A string literal is double-quoted, and a
      // backslash or a double quote inside it is escaped, mirroring the two
      // escape sequences the lexer recognizes inside a string literal
      // (`readStringLiteral()` in `lexer.ts`): `\\` reads back as a backslash
      // and `\"` as a quote; every other character is read verbatim.
      if (typeof type.value === 'string')
        result = `"${type.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      else if (typeof type.value === 'boolean')
        result = type.value ? 'true' : 'false';
      // The unsigned complex infinity carries a sentinel object, not a number,
      // so `toString()` on it would print `[object Object]` instead of a
      // spelling the parser can read back.
      else if (isComplexInfinityValue(type.value)) result = '~oo';
      else result = type.value.toString();
      break;

    case 'reference':
      // Serialize reference types. An APPLIED reference to a parameterized
      // nominal type keeps its arguments (`tree<integer>`); the declaration's
      // variance markers belong to the clause, never to an application.
      result =
        type.args === undefined
          ? type.name
          : `${type.name}<${type.args.map((t) => typeToString(t)).join(', ')}>`;
      break;

    case 'variable':
      // A type variable is atomic: its name, as the author wrote it. Variable
      // names are NEVER canonicalized here — the author's letters round-trip
      // by construction, which the `where` clause below relies on (the
      // α-blindness of string-keyed identity is recorded and accepted, see
      // §5 of the type-variables design).
      result = type.name;
      break;

    case 'negation':
      // Serialize negation types
      result = `!${typeToString(type.type, NEGATION_PRECEDENCE)}`;
      break;

    case 'union': {
      // Serialize union types. Flatten nested unions and emit members in a
      // canonical (lexicographic-by-serialized-form) order so the string is
      // deterministic regardless of how the union object was built — even for
      // unions that never went through `reduceType` (SYM P2-20).
      const flat: string[] = [];
      const pushMember = (t: Type): void => {
        if (typeof t === 'object' && t.kind === 'union')
          t.types.forEach(pushMember);
        else flat.push(typeToString(t, UNION_PRECEDENCE));
      };
      type.types.forEach(pushMember);
      result = flat.sort().join(' | ');
      break;
    }

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

    case 'numeric': {
      // Open endpoints carry their marker: `0<..` for an excluded lower
      // bound, `..<3` for an excluded upper one (the chained-inequality
      // reading, user-ruled 2026-08-28).
      const lo = Number.isFinite(type.lower)
        ? `${type.lower}${type.lowerOpen ? '<' : ''}`
        : '';
      const hi = Number.isFinite(type.upper)
        ? `${type.upperOpen ? '<' : ''}${type.upper}`
        : '';
      result = lo === '' && hi === '' ? `${type.type}` : `${type.type}<${lo}..${hi}>`;
      break;
    }

    case 'list':
      if (
        type.dimensions &&
        typeof type.elements === 'string' &&
        NUMERIC_TYPES_SET.has(type.elements as NumericPrimitiveType)
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
              result = `vector<${typeToString(type.elements)}^${
                type.dimensions[0]
              }>`;
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
              result = `matrix<${typeToString(type.elements)}^(${dims[0]}x${
                dims[1]
              })>`;
          }
        }
      }
      if (!result) {
        const dims = type.dimensions;
        if (
          dims !== undefined &&
          dims.length <= 2 &&
          dims.every((d) => d < 0)
        ) {
          // An all-open rank of 1 or 2 has a NAMED head — `vector<T>` and
          // `matrix<T>` — and must use it, because the nesting below cannot
          // express either one faithfully. At rank 1 the nested form is
          // `list<T>`, which parses back with no dimensions at all, i.e.
          // rank-UNCONSTRAINED: strictly weaker than the rank-1 type being
          // serialized. The named heads carry their rank explicitly and avoid
          // making rank preservation depend on how a nested element type is
          // normalized. (The numeric branch above already reaches for these
          // spellings; this extends them to every element type.)
          const head = dims.length === 1 ? 'vector' : 'matrix';
          result = `${head}<${typeToString(type.elements)}>`;
        } else if (dims !== undefined && dims.some((d) => d < 0)) {
          // A wildcard dimension (`-1`, the open-length sentinel `matrix`/
          // `vector` parse to) has no literal spelling — `^(-1x-1)` neither
          // parses back nor means a negative length (Tycho item 164 note).
          // Express the open rank by NESTING instead: `list<list<T>>` parses
          // back to the same `[-1, -1]` shape (`staticCollectionDims`), and a
          // bounded dimension keeps its `^n`.
          let nested = typeToString(type.elements);
          for (let i = dims.length - 1; i >= 0; i--)
            nested =
              dims[i] < 0 ? `list<${nested}>` : `list<${nested}^${dims[i]}>`;
          result = nested;
        } else {
          // Serialize generic list types
          const dimensions = dims
            ? dims.length === 1
              ? `^${dims[0].toString()}`
              : `^(${dims.join('x')})`
            : '';
          result = `list<${typeToString(type.elements)}${dimensions}>`;
        }
      }
      break;

    case 'record':
      // Serialize record types. A key that is not a plain identifier is
      // wrapped in backticks by `symbolName()`: the type lexer reads only
      // `[a-zA-Z_][a-zA-Z0-9_]*` bare, so an unquoted exotic key would not
      // parse back.
      const elements = Object.entries(type.elements)
        .map(([key, value]) => `${symbolName(key)}: ${typeToString(value)}`)
        .join(', ');
      result = `record{${elements}}`;
      break;

    case 'object':
      // The stored-field layout of an object type: the same surface form as a
      // record, with the `object` head naming the mutable/nominal category.
      result = `object{${Object.entries(type.elements)
        .map(([key, value]) => `${symbolName(key)}: ${typeToString(value)}`)
        .join(', ')}}`;
      break;

    case 'dictionary':
      result = `dictionary<${typeToString(type.values)}>`;
      break;

    case 'set':
      result = `set<${typeToString(type.elements)}>`;
      break;

    case 'broadcastable':
      result = `broadcastable<${typeToString(type.elements)}>`;
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
      // The effect specifier slot. An ABSENT effect set has an empty slot and
      // serializes byte-identically to an unannotated signature. A STATED
      // empty set (`[]`) is the same set spelled `pure`, and round-trips as
      // such (ruled 2026-08-01) — see `EffectSet` in `types.ts`.
      const effects =
        type.effects === undefined ||
        (ELIDE_STATED_PURE && type.effects !== 'any' && !type.effects.length)
          ? ''
          : ` ${effectSetToString(type.effects)}`;
      // The trailing `where` clause, emitted with the author's variable names
      // (they round-trip by construction). An unbounded variable — including
      // an author-written explicit `: unknown`, which since the bare-synonym
      // ruling (2026-08-17) is the identity bound (`where T` means "some
      // value type") — emits the SHORTHAND (`where T`), so a type has
      // exactly one canonical string (the serialization ruling of the
      // where-clause spec). An explicit `: any` bound is a DIFFERENT, wider
      // contract (it admits absence markers) and must survive serialization
      // — eliding it round-tripped `T: any` into the narrower unbounded
      // reading. A polytype has SIGNATURE_PRECEDENCE, so an arm of an
      // overload set is parenthesized by the check below, exactly as the
      // per-arm clause syntax requires.
      const clause = type.typeParams?.length
        ? ` where ${type.typeParams
            .map((p) => {
              const bound =
                p.bound === undefined ? undefined : typeToString(p.bound);
              const decl =
                bound === undefined || bound === 'unknown'
                  ? p.name
                  : `${p.name}: ${bound}`;
              return p.protocols?.length
                ? `${decl} is ${p.protocols.join(' & ')}`
                : decl;
            })
            .join(', ')}`
        : '';
      result = `(${argsList})${effects} -> ${typeToString(type.result)}${clause}`;
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
  // The label of a tuple element or a function argument. Backticked when it is
  // not a plain identifier, for the same reason a record key is: the type
  // lexer reads only `[a-zA-Z_][a-zA-Z0-9_]*` bare, so `tuple<my x: integer>`
  // would not parse back.
  if (el.name) return `${symbolName(el.name)}: ${typeToString(el.type)}`;
  return typeToString(el.type);
}

function symbolName(name: string): string {
  // If the name is a basic identifier, return it as is
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;

  // Otherwise, return the name in backticks. A backslash or a backtick inside
  // the name has to be escaped, mirroring the two escape sequences the lexer
  // recognizes inside a verbatim string (`readVerbatimString()` in
  // `lexer.ts`): `\\` reads back as a backslash and `` \` `` as a backtick.
  // Any other character (including a `\` followed by something else) is read
  // verbatim, so escaping every backslash is what makes the round trip exact.
  return `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
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
    // Delimited exactly like `record{…}`, so it never needs parentheses.
    case 'object':
      return RECORD_PRECEDENCE;
    case 'dictionary':
      return DICTIONARY_PRECEDENCE;
    case 'set':
      return SET_PRECEDENCE;
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return COLLECTION_PRECEDENCE;
    case 'tuple':
      return TUPLE_PRECEDENCE;
    case 'signature':
      return SIGNATURE_PRECEDENCE;
    case 'value':
    // A type variable is an atom, like a primitive name: never parenthesized.
    case 'variable':
      return VALUE_PRECEDENCE;
    default:
      return 0;
  }
}
