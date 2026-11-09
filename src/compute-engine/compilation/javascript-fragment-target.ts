/** Internal opt-in scalar slice; intentionally absent from target registration. */
import type { Expression } from '../global-types.js';
import type { CompilationOptions, CompileTarget } from './types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import { JavaScriptTarget } from './javascript-target.js';
import { BaseCompiler } from './base-compiler.js';
import { isLibraryOperator } from './builtin-callback.js';
import {
  typeFragment,
  walkIf,
  type FragmentDefinition,
  type FragmentRule,
} from './fragment.js';
import {
  attachScalarFragment,
  type ScalarRepresentation,
} from './javascript-fragment-facts.js';

const numericRule: FragmentRule<ScalarRepresentation> = {
  walk: (node, scope, context, w) => {
    const lane = BaseCompiler.isComplexValued(node) ? 'complex' : 'real';
    return w.signatures(node, scope, context, [
      {
        operands: [lane],
        ...(node.operator === 'Add' ? { rest: lane } : {}),
        result: lane,
      },
    ]);
  },
};
const definition: FragmentDefinition<ScalarRepresentation> = {
  name: 'JS scalar',
  rules: {
    Add: numericRule,
    Negate: numericRule,
    Sqrt: numericRule,
    If: { walk: walkIf },
  },
  typeOfSymbol(node) {
    const type = node.type.type;
    if (isSubtype(type, 'boolean')) return { kind: 'boolean' };
    if (isSubtype(type, 'integer')) return { kind: 'integer' };
    if (isSubtype(type, 'real')) return { kind: 'real' };
    if (isSubtype(type, 'complex')) return { kind: 'complex' };
    return undefined;
  },
  representationOfBinding: representation,
  representationOfValue: representation,
  functionOf: () => undefined,
};
function representation(type: {
  kind: string;
}): ScalarRepresentation | undefined {
  if (type.kind === 'integer' || type.kind === 'real') return 'number';
  if (type.kind === 'boolean' || type.kind === 'complex') return type.kind;
  return undefined;
}

export class ScalarFragmentJavaScriptTarget extends JavaScriptTarget {
  protected prepareCompilation(
    expr: Expression,
    options: CompilationOptions<Expression>,
    batch?: unknown
  ): { expr: Expression; target: CompileTarget<Expression> } {
    if (
      batch !== undefined ||
      options.broadcast ||
      options.functions ||
      options.operators ||
      options.vars ||
      options.preamble ||
      options.imports?.length ||
      (options.mode !== undefined &&
        options.mode !== 'strict' &&
        options.mode !== 'complex')
    )
      throw new Error('JS scalar fragment: unsupported compile options');
    const prepared = super.prepareCompilation(expr, options);
    const seen = new Set<Expression>();
    const check = (node: Expression): void => {
      if (seen.has(node)) return;
      seen.add(node);
      if (!node.isValid || node.type.type === 'error')
        throw new Error('JS scalar fragment: invalid expression');
      if (isNumber(node)) return;
      if (isSymbol(node)) {
        if (node.symbol === 'True' || node.symbol === 'False') return;
        if (
          node.valueDefinition?.value !== undefined ||
          definition.typeOfSymbol(node) === undefined
        )
          throw new Error(
            `JS scalar fragment: unsupported binding ${node.symbol}`
          );
        return;
      }
      if (
        !isFunction(node) ||
        !Object.hasOwn(definition.rules, node.operator) ||
        !isLibraryOperator(node, node.operator)
      )
        throw new Error(
          `JS scalar fragment: unsupported head ${node.operator}`
        );
      if (
        (node.operator === 'If' && node.nops !== 3) ||
        ((node.operator === 'Sqrt' || node.operator === 'Negate') &&
          node.nops !== 1)
      )
        throw new Error('JS scalar fragment: unsupported arity');
      for (const operand of node.ops) check(operand);
    };
    check(prepared.expr);
    attachScalarFragment(prepared.target, {
      root: prepared.expr,
      annotate: () => {
        const annotation = typeFragment(prepared.expr, definition);
        if (annotation.refusal)
          throw new Error(`JS scalar fragment: ${annotation.refusal.message}`);
        return annotation;
      },
    });
    return prepared;
  }
}
