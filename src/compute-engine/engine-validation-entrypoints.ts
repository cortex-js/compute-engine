import type { Type } from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';
import { reduceType } from '../common/type/reduce.js';
import { BoxedType } from '../common/type/boxed-type.js';

import { asLatexString, isLatexString } from './latex-syntax/utils.js';
import type { Expression, Metadata, ExpressionInput } from './global-types.js';

type ValidationHost = {
  string(s: string, metadata?: Metadata): Expression;
  function(
    name: string,
    ops: ReadonlyArray<ExpressionInput>,
    options?: { metadata?: Metadata }
  ): Expression;
  expr(expr: ExpressionInput): Expression;
};

export function createErrorExpression(
  engine: ValidationHost,
  message: string | string[],
  where?: string | Expression
): Expression {
  let msg: Expression;
  if (typeof message === 'string') msg = engine.string(message);
  else
    msg = engine.function(
      'ErrorCode',
      message.map((part) => engine.string(part))
    );

  let whereExpr: Expression | undefined;
  if (where !== undefined && typeof where !== 'string') {
    // An EXPRESSION site: the offending operand itself, attached AS-IS so it
    // keeps its binding — a symbol operand still reaches its (possibly
    // scope-dead) value definition through `.valueDefinition`, which is what
    // lets diagnostics read the binding's own `_typeProvenance` instead of
    // re-resolving the bare name in the ambient scope (where a same-named
    // outer binding would shadow the one that actually faulted). The
    // `IComputeEngine.typeError` interface always declared an expression
    // `where`; until 2026-08-13 the implementation silently dropped it.
    whereExpr = where;
  } else if (where && isLatexString(where)) {
    whereExpr = engine.function('LatexString', [
      engine.string(asLatexString(where)!),
    ]);
  } else if (typeof where === 'string' && where.length > 0) {
    whereExpr = engine.string(where);
  }

  const ops: Expression[] = [engine.expr(msg)];
  if (whereExpr) ops.push(whereExpr);

  return engine.function('Error', ops);
}

/** The EXPECTED type as the diagnostic spells it. A collection-family
 * `<any>` top (`indexed_collection<any>` — the absence-admitting spelling
 * structural parameters use since the bare-synonym ruling, 2026-08-17)
 * displays as the plain family name: "expected indexed_collection" is what
 * a reader needs, and it matches the spelling the unbound-variable display
 * path produces, so the two error routes agree. Display only — the
 * admission check itself always uses the full `<any>` type. */
/** One member of the expected type, with a collection-family `<any>` top
 * collapsed to the bare family NAME (see `displayedExpectedType`). */
function displayedExpectedMember(expected: Type): Type {
  if (typeof expected === 'object') {
    if (
      (expected.kind === 'collection' ||
        expected.kind === 'indexed_collection' ||
        expected.kind === 'set' ||
        (expected.kind === 'list' && expected.dimensions === undefined)) &&
      expected.elements === 'any'
    )
      return expected.kind;
    if (expected.kind === 'dictionary' && expected.values === 'any')
      return 'dictionary';
  }
  return expected;
}

function displayedExpectedType(expected: Type): string {
  const mapped = displayedExpectedMember(expected);
  if (mapped !== expected) return typeToString(mapped);
  // A union displays member-wise — `dictionary<any> |
  // indexed_collection<any>` (the `At` base parameter) reads `dictionary |
  // indexed_collection` — and is re-reduced so the members keep the
  // CANONICAL presentation order the plain `typeToString` route produced
  // (`nothing | range`, not the as-declared `range | nothing`).
  if (typeof expected === 'object' && expected.kind === 'union') {
    const members = expected.types.map(displayedExpectedMember);
    if (members.some((m, i) => m !== expected.types[i]))
      return typeToString(
        reduceType({ ...expected, types: members } as Type)
      );
  }
  return typeToString(expected);
}

export function createTypeErrorExpression(
  engine: ValidationHost,
  expected: Type,
  actual: undefined | Type | BoxedType,
  where?: string | Expression
): Expression {
  if (actual) {
    return createErrorExpression(
      engine,
      ['incompatible-type', displayedExpectedType(expected), actual.toString()],
      where
    );
  }
  return createErrorExpression(
    engine,
    ['incompatible-type', displayedExpectedType(expected)],
    where
  );
}
