import type { Type } from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';
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

export function createTypeErrorExpression(
  engine: ValidationHost,
  expected: Type,
  actual: undefined | Type | BoxedType,
  where?: string | Expression
): Expression {
  if (actual) {
    return createErrorExpression(
      engine,
      ['incompatible-type', typeToString(expected), actual.toString()],
      where
    );
  }
  return createErrorExpression(
    engine,
    ['incompatible-type', typeToString(expected)],
    where
  );
}
