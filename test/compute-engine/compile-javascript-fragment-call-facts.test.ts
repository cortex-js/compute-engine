import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { emitUserFunctionCall } from '../../src/compute-engine/compilation/compile-user-calls';
import { typeFragment, walkBlock, type FragmentDefinition } from '../../src/compute-engine/compilation/fragment';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { attachScalarFragment, enterScalarFragment, type ScalarRepresentation } from '../../src/compute-engine/compilation/javascript-fragment-facts';
import type { Expression } from '../../src/compute-engine/global-types';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';

type Edge = { kind: string; representation: ScalarRepresentation };
function fixture() {
  const ce = new ComputeEngine();
  ce.declare('a', 'real'); ce.declare('b', 'complex');
  ce.declare('helper', '(real, complex) -> real');
  const literal = ce.expr(['Function', 'u', ['Typed', 'u', "'real'"], ['Typed', 'v', "'complex'"]]);
  if (!isFunction(literal)) throw new Error('expected function');
  ce.assign('helper', literal);
  const call = ce.expr(['helper', 'a', 'b']);
  if (!isFunction(call)) throw new Error('expected call');
  const body = literal.op1;
  const representation: FragmentDefinition<ScalarRepresentation>['representationOfValue'] = type =>
    type.kind === 'complex' ? 'complex' : type.kind === 'real' || type.kind === 'integer' ? 'number' : undefined;
  const annotation = typeFragment(call, {
    name: 'call test', rules: { Block: { walk: walkBlock } },
    typeOfSymbol: node => node.symbol === 'b' ? { kind: 'complex' } : { kind: 'real' },
    representationOfValue: representation,
    representationOfBinding: representation,
    functionOf: node => node === call ? {
      key: 'helper', name: 'helper', body, arguments: call.ops,
      parameters: ['u', 'v'], parameterTypes: [{ kind: 'real' }, { kind: 'complex' }],
    } : undefined,
  });
  if (annotation.refusal) throw new Error(annotation.refusal.message);
  // Preserve real producer facts; only negative controls mutate this copy.
  const facts = new Map<Expression, { representation: ScalarRepresentation; conversions?: readonly Edge[] }>();
  for (const [node, value] of annotation.scope.facts)
    if ('representation' in value) facts.set(node, value);
  const target = { rootExpression: call, mode: 'strict', language: 'javascript', userFunctions: {} } as CompileTarget<Expression>;
  attachScalarFragment(target, { root: call, helper: { name: 'helper', literal, body },
    annotate: () => ({ ...annotation, scope: { ...annotation.scope, facts } }),
  });
  const leave = enterScalarFragment(call, target)!;
  return { call, target, facts, leave };
}

afterEach(() => jest.restoreAllMocks());

test('owned scalar call bypasses legacy classifiers and preserves argument order and registered spelling', () => {
  const { call, target, leave } = fixture();
  const lane = jest.spyOn(core, 'userFunctionParamLanes').mockImplementation(() => { throw new Error('legacy lane query'); });
  const type = jest.spyOn(core, 'staticTypeOf').mockImplementation(() => { throw new Error('legacy shape query'); });
  const complex = jest.spyOn(core, 'isComplexValued').mockImplementation(() => { throw new Error('legacy complex query'); });
  const emitted: Expression[] = [];
  jest.spyOn(core, 'compile').mockImplementation(expr => {
    emitted.push(expr!);
    return expr === call.op1 ? 'first()' : 'second()';
  });
  const code = emitUserFunctionCall('_fn_registered', call.ops, target, ['real', true], true);
  expect(code).toBe('_fn_registered(first(), second())');
  expect(emitted).toEqual(call.ops);
  expect(lane).not.toHaveBeenCalled(); expect(type).not.toHaveBeenCalled(); expect(complex).not.toHaveBeenCalled();
  const trace: string[] = [];
  const result = new Function('first', 'second', '_fn_registered', `return ${code}`)(
    () => { trace.push('first'); return 2; },
    () => { trace.push('second'); return { re: 3, im: 4 }; },
    (a: number, b: { re: number }) => { trace.push('call'); return a + b.re; });
  expect(result).toBe(5); expect(trace).toEqual(['first', 'second', 'call']);
  leave();
});

test('legacy target still uses the existing lane classifier', () => {
  const { call, leave } = fixture();
  const legacy = { language: 'javascript', userFunctions: {} } as CompileTarget<Expression>;
  jest.spyOn(core, 'userFunctionParamLanes').mockImplementation(() => { throw new Error('legacy lane query'); });
  expect(() => emitUserFunctionCall('_fn_registered', call.ops, legacy, [false, false], true))
    .toThrow('legacy lane query');
  leave();
});

test('legacy target still reads the existing complex classifier', () => {
  const { call, leave } = fixture();
  const legacy = { language: 'javascript', userFunctions: {} } as CompileTarget<Expression>;
  // Real parameter lanes and no declared coercion make the legacy call ask
  // whether each argument is complex-valued.
  jest.spyOn(core, 'userFunctionParamLanes').mockImplementation(() => [false, false]);
  jest.spyOn(core, 'isComplexValued').mockImplementation(() => { throw new Error('legacy complex query'); });
  expect(() => emitUserFunctionCall('_fn_registered', call.ops, legacy, [false, false], true))
    .toThrow('legacy complex query');
  leave();
});

test('legacy target still reads the existing static type', () => {
  const { call, leave } = fixture();
  const legacy = { language: 'javascript', userFunctions: {} } as CompileTarget<Expression>;
  // Scalar parameters make the legacy call read the static type of each
  // argument to find its map rank.
  jest.spyOn(core, 'staticTypeOf').mockImplementation(() => { throw new Error('legacy shape query'); });
  expect(() => emitUserFunctionCall('_fn_registered', call.ops, legacy, [false, false], true))
    .toThrow('legacy shape query');
  leave();
});

test.each([
  { name: 'missing', edges: undefined },
  { name: 'short', edges: [{ kind: 'none', representation: 'number' }] },
  { name: 'sparse', edges: new Array(2) },
  { name: 'conversion', edges: [{ kind: 'real-to-complex', representation: 'complex' }, { kind: 'none', representation: 'complex' }] },
  { name: 'mismatched', edges: [{ kind: 'none', representation: 'complex' }, { kind: 'none', representation: 'complex' }] },
] as { name: string; edges: Edge[] | undefined }[])('rejects $name edges before emitting operands', ({ edges }) => {
  const { call, target, facts, leave } = fixture();
  facts.set(call, { representation: 'number', conversions: edges });
  const emit = jest.spyOn(core, 'compile');
  expect(() => emitUserFunctionCall('_fn_registered', call.ops, target, [], true))
    .toThrow(/invalid scalar call conversions/);
  expect(emit).not.toHaveBeenCalled(); leave();
});

test('missing operand facts and changed policy fail before emission', () => {
  const { call, target, facts, leave } = fixture();
  const emit = jest.spyOn(core, 'compile');
  expect(() => emitUserFunctionCall('_fn_registered', call.ops, { ...target, mode: 'complex' }, [], true))
    .toThrow(/different prepared policy/);
  facts.delete(call.op2);
  expect(() => emitUserFunctionCall('_fn_registered', call.ops, target, [], true))
    .toThrow(/missing prepared-node facts/);
  expect(emit).not.toHaveBeenCalled(); leave();
});


test('a zero-parameter helper needs no conversion entries', () => {
  const ce = new ComputeEngine();
  ce.declare('helper', '() -> real');
  ce.assign('helper', ce.expr(['Function', 7]));
  const expression = ce.expr(['helper']);
  for (const mode of ['strict', 'complex'] as const) {
    const options = { mode, constantFold: false, fallback: false };
    const result = new ScalarFragmentJavaScriptTarget().compile(expression, options);
    expect(result.run!()).toBe(7);
    expect(result.run!()).toBe(compile(expression, options).run!());
    expect(result.code).toContain('_fn_helper()');
  }
});
