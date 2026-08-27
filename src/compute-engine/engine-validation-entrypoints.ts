import type { Type } from '../common/type/types.js';
import {
  inBroadcastCell,
  withoutBroadcastCellWidening,
} from './boxed-expression/broadcast-cell-widening.js';
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
      return typeToString(reduceType({ ...expected, types: members } as Type));
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
    // A diagnostic must name the offending VALUE, not the tier it belongs
    // to. When the check ran inside a broadcast cell, the type it read was
    // deliberately widened (`broadcast-cell-widening.ts`), which would print
    // "expected integer, got finite_real" for the element `2.5`. Re-read the
    // operand's type outside the window to recover the precise text.
    //
    // Only when the widened reading is exactly what the caller passed: that
    // identifies `actual` as having come from this same operand, and leaves a
    // caller that deliberately reports some OTHER type alone.
    //
    // Provenance is identified by the type TEXT matching, which is a
    // heuristic, not a proof: it holds because every call site that reports a
    // widened type passes that operand's own `.type` verbatim as `actual`. A
    // caller that deliberately reports some OTHER type whose text happens to
    // coincide would be re-read too — harmless, since the re-read answers for
    // the same operand the caller named as `where`.
    //
    if (
      typeof where === 'object' &&
      where !== null &&
      'type' in where &&
      'engine' in where
    ) {
      const operand = where as Expression;
      if (
        inBroadcastCell(operand.engine) &&
        actual.toString() === operand.type.toString()
      )
        actual = withoutBroadcastCellWidening(
          operand.engine,
          () => operand.type
        );
    }

    // `actual` may be a raw `Type`, which since ruling O9 (a literal's
    // public type is its literal type) is often an OBJECT node (`{kind:
    // 'value', value: 5}`) rather than a primitive string — `.toString()`
    // on one prints "[object Object]". A `BoxedType` has no `kind`
    // property, so its presence tells the two apart without an
    // `instanceof` (which fails across plugin-bundle boundaries).
    const actualText =
      typeof actual === 'object' && 'kind' in actual
        ? typeToString(actual as Type)
        : actual.toString();
    return createErrorExpression(
      engine,
      ['incompatible-type', displayedExpectedType(expected), actualText],
      where
    );
  }
  return createErrorExpression(
    engine,
    ['incompatible-type', displayedExpectedType(expected)],
    where
  );
}
