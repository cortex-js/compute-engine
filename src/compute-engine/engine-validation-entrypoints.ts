import type { Type } from '../common/type/types';
import { typeToString } from '../common/type/serialize';
import { BoxedType } from '../common/type/boxed-type';

import { asLatexString, isLatexString } from './latex-syntax/utils';
import type {
  BoxedExpression,
  Metadata,
  ExpressionInput,
} from './global-types';

type ValidationHost = {
  string(s: string, metadata?: Metadata): BoxedExpression;
  function(
    name: string,
    ops: ReadonlyArray<ExpressionInput>,
    options?: { metadata?: Metadata }
  ): BoxedExpression;
  box(expr: ExpressionInput): BoxedExpression;
};

export function createErrorExpression(
  engine: ValidationHost,
  message: string | string[],
  where?: string
): BoxedExpression {
  let msg: BoxedExpression;
  if (typeof message === 'string') msg = engine.string(message);
  else
    msg = engine.function(
      'ErrorCode',
      message.map((part) => engine.string(part))
    );

  let whereExpr: BoxedExpression | undefined;
  if (where && isLatexString(where)) {
    whereExpr = engine.function('LatexString', [
      engine.string(asLatexString(where)!),
    ]);
  } else if (typeof where === 'string' && where.length > 0) {
    whereExpr = engine.string(where);
  }

  const ops: BoxedExpression[] = [engine.box(msg)];
  if (whereExpr) ops.push(whereExpr);

  return engine.function('Error', ops);
}

export function createTypeErrorExpression(
  engine: ValidationHost,
  expected: Type,
  actual: undefined | Type | BoxedType,
  where?: string
): BoxedExpression {
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
