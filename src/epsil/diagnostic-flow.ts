/** Value facts for diagnostics only. Canonicalization owns bindings and types. */
import type { ComputeEngine, Expression } from '../compute-engine.js';
import type {
  BoxedOperatorDefinition,
  BoxedValueDefinition,
} from '../compute-engine/types-definitions.js';
import type { Type } from '../common/type/types.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
  readBinding,
  resolvedValueDefinition,
} from '../compute-engine/boxed-expression/type-guards.js';
import { isValueDef } from '../compute-engine/boxed-expression/definition-guards.js';
import {
  threadableGate,
  validatedLiteralApplicationOperands,
} from '../compute-engine/boxed-expression/box.js';
import { paramsAreScalar } from '../compute-engine/boxed-expression/boxed-function.js';
import { overloadArms } from '../compute-engine/boxed-expression/overload.js';
import { validateArguments } from '../compute-engine/boxed-expression/validate.js';
import {
  normalizeNamedArguments,
  splitNamedArguments,
  hasNamedArguments,
} from '../compute-engine/boxed-expression/named-arguments.js';
import { storeAdmission } from '../compute-engine/boxed-expression/effects-inference.js';
import { programStatementWrites } from '../compute-engine/library/control-structures.js';
import type { ErrorFrameRef } from './error-location.js';

type FlowError = { error: Expression; frame: ErrorFrameRef };

export function diagnosticFlow(ce: ComputeEngine, program: Expression) {
  const facts = new Map<BoxedValueDefinition, Expression>();
  const written = new Set<BoxedValueDefinition>();
  const uncertainCallees = new Set<BoxedOperatorDefinition>();
  const suppressed = new WeakSet<Expression>();
  let initialMutableFacts = true;
  const bindingFact = (
    binding: BoxedValueDefinition
  ): Expression | undefined => {
    const known = facts.get(binding);
    if (known !== undefined) return known;
    if (!binding.isConstant && (!initialMutableFacts || written.has(binding)))
      return undefined;
    const value = binding.value;
    return value !== undefined &&
      (isNumber(value) || isString(value) || isFunction(value, 'Function'))
      ? value
      : undefined;
  };
  const errors = new Map<Expression, FlowError[]>();
  const evidence = new Map<
    Expression,
    ReadonlyMap<BoxedValueDefinition, Type>
  >();
  const callableTypes = new WeakMap<Expression, Type>();
  let currentEvidence = new Map<BoxedValueDefinition, Type>();
  const loseMutable = (): void => {
    initialMutableFacts = false;
    for (const binding of facts.keys())
      if (!binding.isConstant) facts.delete(binding);
  };
  const fact = (value: Expression): Expression | undefined => {
    if (isSymbol(value)) {
      const binding = resolvedValueDefinition(value);
      const known = binding === undefined ? undefined : bindingFact(binding);
      if (binding !== undefined && known !== undefined)
        currentEvidence.set(binding, known._literalType ?? known.type.type);
      return known;
    }
    if (isNumber(value) || isString(value) || isFunction(value, 'Function'))
      return value;
    if (
      (isFunction(value, 'Tuple') || isFunction(value, 'List')) &&
      value.ops.every((op) => fact(op) === op)
    )
      return value;
    return undefined;
  };
  const writtenValue = (statement: Expression): Expression | undefined => {
    if (isFunction(statement, 'Assign')) return statement.op2;
    if (!isFunction(statement, 'Declare')) return undefined;
    const last = statement.ops[statement.ops.length - 1];
    return isDictionary(last) ? last.get('value') : statement.ops[2];
  };
  const visit = (node: Expression, output: FlowError[]): void => {
    if (
      !isFunction(node) ||
      node.operator === 'Error' ||
      node.operator === 'Hold'
    )
      return;
    if (node.operator === 'Function') {
      // A mutable value can change before this body is called. Its present
      // value is not the function body's permanent callable contract.
      const saved = new Map(facts);
      const savedInitial = initialMutableFacts;
      loseMutable();
      visit(node.op1, output);
      facts.clear();
      for (const [key, value] of saved) facts.set(key, value);
      initialMutableFacts = savedInitial;
      return;
    }
    if (
      [
        'Block',
        'If',
        'Which',
        'Match',
        'Loop',
        'ParallelLoop',
        'Comprehension',
      ].includes(node.operator)
    ) {
      loseMutable();
      for (const op of node.ops) visit(op, output);
      loseMutable();
      return;
    }
    for (const op of node.ops) visit(op, output);
    // A global operator assignment is not replayed by this analysis. Its
    // old call interface cannot diagnose a later use of the replaced value.
    if (
      node.operatorDefinition !== undefined &&
      uncertainCallees.has(node.operatorDefinition)
    ) {
      for (const error of node.errors) suppressed.add(error);
      loseMutable();
      return;
    }
    if (!node.isValid) return;
    const binding = readBinding(node);
    const literal =
      binding !== undefined && isValueDef(binding)
        ? bindingFact(binding.value)
        : undefined;
    let args = node.ops.map((op) => fact(op) ?? op);
    if (
      literal !== undefined &&
      isFunction(literal, 'Function') &&
      hasNamedArguments(args)
    ) {
      const split = splitNamedArguments(args);
      const normalized = normalizeNamedArguments(ce, split, literal.type.type);
      if (normalized.kind === 'ok')
        args = normalized.ops.map((op) => ce.box(op));
      else if (normalized.kind === 'error') {
        normalized.ops
          .map((op) => ce.box(op))
          .forEach((error, i) => {
            if (isFunction(error, 'Error'))
              output.push({
                error,
                frame: { name: node.operator, index: i + 1 },
              });
          });
        return;
      } else return;
    }
    const hasArgumentFacts = args.some((op, i) => op !== node.ops[i]);
    let invalid: readonly Expression[] | null | undefined;
    if (literal !== undefined && isFunction(literal, 'Function'))
      invalid = validatedLiteralApplicationOperands(ce, literal, args, true);
    else if (node.operatorDefinition !== undefined) {
      const definition = node.operatorDefinition;
      invalid = validateArguments(
        ce,
        args,
        definition.signature.type,
        definition.lazy,
        definition.broadcastable,
        undefined,
        {
          noInference: true,
          diagnostic: true,
          operatorName: node.operator,
          operatorDefinition: definition,
          userFunction: definition.isUserFunctionDefinition,
          refusesAbsentAt: (i) => definition.refusesAbsentOperandAt(i),
        }
      );
    } else if (binding !== undefined && isValueDef(binding)) {
      const signature = binding.value.type.type;
      if (
        typeof signature !== 'string' &&
        (signature.kind === 'signature' ||
          overloadArms(signature) !== undefined)
      )
        invalid = validateArguments(
          ce,
          args,
          signature,
          undefined,
          threadableGate(signature, paramsAreScalar(signature)),
          undefined,
          {
            noInference: true,
            diagnostic: true,
            operatorName: node.operator,
            mapsPointLists: true,
            userFunction: true,
          }
        );
    }
    invalid?.forEach((error, i) => {
      if (isFunction(error, 'Error') && error !== args[i]) {
        const original = node.ops[i];
        const originalBinding = isSymbol(original)
          ? resolvedValueDefinition(original)
          : undefined;
        const code = error.op1;
        const kind = isString(code)
          ? code.string
          : isFunction(code, 'ErrorCode') && isString(code.op1)
            ? code.op1.string
            : undefined;
        // Without value evidence, retain only the existing validator's
        // structural arity refusals, not a projected type refinement.
        if (
          literal === undefined &&
          !hasArgumentFacts &&
          kind !== 'missing-argument' &&
          kind !== 'unexpected-argument'
        )
          return;
        // An invalidated write gives no literal proof. Keep disjoint-type
        // refusals, but do not turn an overlapping contract into a fact.
        if (
          originalBinding !== undefined &&
          written.has(originalBinding) &&
          bindingFact(originalBinding) === undefined &&
          isFunction(code, 'ErrorCode') &&
          isString(code.op1) &&
          code.op1.string === 'incompatible-type' &&
          isString(code.op2) &&
          !original.type.isDisjointFrom(code.op2.string)
        )
          return;
        const operands = [...error.ops];
        if (isSymbol(original) && operands.length > 1) operands[1] = original;
        const reported = ce._fn('Error', operands, {
          metadata: { sourceOffsets: original?.sourceOffsets },
        });
        if (literal !== undefined)
          callableTypes.set(reported, literal.type.type);
        output.push({
          error: reported,
          frame: { name: node.operator, index: i + 1 },
        });
      }
    });
    if (node.effects === 'any' || node.effects?.includes('scope'))
      loseMutable();
  };
  if (isFunction(program))
    for (const statement of program.ops) {
      const output: FlowError[] = [];
      currentEvidence = new Map();
      const value = writtenValue(statement);
      if (value !== undefined) visit(value, output);
      else visit(statement, output);
      if (statement.isValid && value !== undefined) {
        const tupleTarget =
          isFunction(statement) && isFunction(statement.op1, 'Tuple');
        const next = tupleTarget ? undefined : fact(value);
        const declaration = isFunction(statement, 'Declare');
        for (const [name, definition] of programStatementWrites(statement)) {
          if (!isValueDef(definition)) {
            if (!declaration) uncertainCallees.add(definition.operator);
            continue;
          }
          const binding = definition.value;
          // A tuple write can partly succeed before refusing another leaf.
          // Discard all leaf facts without reproducing tuple assignment here.
          if (tupleTarget) {
            written.add(binding);
            facts.delete(binding);
            continue;
          }
          if (!declaration && binding.isConstant) continue;
          const admission = storeAdmission(
            ce,
            value,
            binding.type,
            binding.effectsDeclared,
            name
          );
          if (admission === 'refuse') continue;
          written.add(binding);
          if (next !== undefined && admission === 'match')
            facts.set(binding, next);
          else facts.delete(binding);
        }
      }
      if (output.length > 0) {
        errors.set(statement, output);
        evidence.set(statement, currentEvidence);
      }
    }
  return {
    get: (statement: Expression) => errors.get(statement),
    suppresses: (error: Expression) => suppressed.has(error),
    calleeType: (error: Expression | undefined) =>
      error === undefined ? undefined : callableTypes.get(error),
    evidenceAt: (statement: Expression, binding: BoxedValueDefinition) =>
      evidence.get(statement)?.get(binding),
  };
}
