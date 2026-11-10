import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { attachScalarFragment, bindScalarFragmentFunction, bindScalarFragmentBlock, enterScalarFragment } from '../../src/compute-engine/compilation/javascript-fragment-facts';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { FragmentScope } from '../../src/compute-engine/compilation/fragment';
import type { MathJsonExpression } from '../../src/math-json/types';

const parameter = (name: string, type = 'real'): MathJsonExpression =>
  ['Typed', name, `'${type}'`];

// Reduced from the four-neighbor sum in Tycho's heat prelude. This fixture
// exercises bindings and scalar arithmetic, not the collection-based heat step.
const neighborSum: MathJsonExpression = ['Function',
  ['Block',
    ['Declare', 'total', "'real'", 'w'],
    ['Assign', 'total', ['Add', 'total', 'e']],
    ['Assign', 'total', ['Add', 'total', 'n']],
    ['Assign', 'total', ['Add', 'total', 's']],
    'total'],
  parameter('w'), parameter('e'), parameter('n'), parameter('s')];

for (const mode of ['strict', 'complex'] as const) {
  for (const cse of [false, true]) {
    for (const constantFold of [false, true]) {
      describe(`${mode}, CSE=${cse}, fold=${constantFold}`, () => {
        test('bound accumulator reinitializes and shadows ambient bindings', () => {
          const ce = new ComputeEngine();
          ce.assign('w', 1000);
          ce.assign('total', -99);
          const expression = ce.expr(neighborSum);
          const options = { mode, cse, constantFold, fallback: false };
          const legacy = compile(expression, options);
          const result = new ScalarFragmentJavaScriptTarget().compile(expression, options);
          for (const [args, expected] of [
            [[1, 2, 3, 4], 10], [[-2, 0, 3, 1], 2], [[0, 0, 0, 0], 0],
            [[1, 2, 3, 4], 10],
          ] as [number[], number][]) {
            expect(result.run!(...args)).toBe(expected);
            expect(result.run!(...args)).toBe(legacy.run!(...args));
          }
          expect(compile(expression, options).code).toBe(legacy.code);
          expect(ce.expr('total').evaluate().re).toBe(-99);
          expect(ce.expr('w').evaluate().re).toBe(1000);
        });

        test('identical arithmetic before and after assignment reads the new local', () => {
          const ce = new ComputeEngine();
          const expression = ce.expr(['Function', ['Block',
            ['Declare', 'total', "'real'", 'w'],
            ['Assign', 'total', ['Add', 'total', 'e']],
            ['Assign', 'total', ['Add', 'total', 'e']],
            'total'], parameter('w'), parameter('e')]);
          const result = new ScalarFragmentJavaScriptTarget().compile(expression,
            { mode, cse, constantFold, fallback: false });
          expect(result.run!(1, 2)).toBe(5);
          expect(result.run!(-3, 4)).toBe(5);
        });

        test('complex local keeps its representation through updates', () => {
          const ce = new ComputeEngine();
          const expression = ce.expr(['Function', ['Block',
            ['Declare', 'total', "'complex'", 'z'],
            ['Assign', 'total', ['Add', 'total', 'z']],
            ['Negate', 'total']], parameter('z', 'complex')]);
          const result = new ScalarFragmentJavaScriptTarget().compile(expression,
            { mode, cse, constantFold, fallback: false });
          expect(result.run!({ re: 3, im: 4 })).toEqual({ re: -6, im: -8 });
        });
      });
    }
  }
}

test.each([
  { body: ['Block', ['Declare', 't', "'real'", 'x'], ['Assign', 'x', 2], 't'],
    reason: /only writes to the declared local are supported/ },
  // The canonical form replaces this write with an `Error` (a list assigned
  // to a real local), so the fragment refuses an `Error` statement.
  { body: ['Block', ['Declare', 't', "'real'", 'x'], ['Assign', 't', ['List', 1]], 't'],
    reason: /only writes to the declared local are supported/ },
  { body: ['Block', ['Declare', 't', "'real'", 'x'], ['Sqrt', 't']],
    reason: /unsupported bound head Sqrt/ },
  { body: ['Block', ['Declare', 't', "'real'", 'x'], ['Block', 't']],
    reason: /unsupported head Block/ },
  { body: ['Block', ['Declare', 't', "'real'", 'x'], ['Add', 't', 'capture']],
    reason: /unsupported capture capture/ },
])('declines unsupported bound program $body', ({ body, reason }) => {
  const ce = new ComputeEngine();
  ce.assign('capture', 42);
  const expression = ce.expr(['Function', body, parameter('x')] as MathJsonExpression);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
    .toThrow(reason);
});

test('a real write to a complex local declines', () => {
  for (const mode of ['strict', 'complex'] as const) {
    const ce = new ComputeEngine();
    const expression = ce.expr(['Function', ['Block',
      ['Declare', 't', "'complex'", 'z'], ['Assign', 't', 'x'], 't'],
      parameter('z', 'complex'), parameter('x')]);
    expect(expression.isValid).toBe(true);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { mode, fallback: false }))
      .toThrow(/local writes must preserve representation/);
  }
});

test('does not accept an untyped parameter from an ambient declaration', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  const expression = ce.expr(['Function', ['Block',
    ['Declare', 'total', "'real'", 'x'], 'total'], 'x']);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
    .toThrow(/explicit distinct scalar parameters/);
});

test('declines an unannotated broadcast scope from cross-shape ambient shadowing', () => {
  const ce = new ComputeEngine();
  ce.assign('w', ['Complex', 0, 7]);
  ce.assign('total', ['List', 91, 92]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(neighborSum),
    { fallback: false, cse: true }))
    .toThrow(/different prepared policy/);
  expect(ce.expr('w').evaluate().im).toBe(7);
  expect(ce.expr('total').evaluate().json).toEqual(['List', 91, 92]);
});

test('boolean local and conditional updates preserve the declared representation', () => {
  const ce = new ComputeEngine();
  const expression = ce.expr(['Function', ['Block',
    ['Declare', 'selected', "'boolean'", 'False'],
    ['Assign', 'selected', ['If', 'C', 'True', 'False']],
    'selected'], parameter('C', 'boolean')]);
  const result = new ScalarFragmentJavaScriptTarget().compile(expression,
    { fallback: false });
  expect(result.run!(false)).toBe(false);
  expect(result.run!(true)).toBe(true);
});

test('scope handoffs reject foreign bodies, statements, nodes and policies', () => {
  const ce = new ComputeEngine();
  const fn = ce.expr(neighborSum);
  if (!isFunction(fn) || !isFunction(fn.op1)) throw new Error('fixture function');
  const body = fn.op1.canonical;
  if (!isFunction(body)) throw new Error('fixture body');
  const final = body.ops[body.nops - 1];
  const rootOnly = ce.expr('outside');
  const value = { type: { kind: 'real' as const }, representation: 'number' as const };
  const root: FragmentScope<'number'> = {
    bindings: new Map(), facts: new Map([[body, value], [rootOnly, value]]), inner: new Map(),
    statements: new Set(),
  };
  const block: FragmentScope<'number'> = {
    parent: root, bindings: new Map(), facts: new Map([[final, value]]), inner: new Map(),
    statements: new Set(),
  };
  root.inner.set(body, block);
  const outer = { rootExpression: fn, mode: 'strict' } as CompileTarget<Expression>;
  attachScalarFragment(outer, { root: body, functionRoot: fn,
    annotate: () => ({ root: body, scope: root, functions: new Map() }) });
  const lambda = { ...outer, var: (name: string) => name, boundVars: new Set(['w', 'e', 'n', 's']) };
  const foreign = ce.expr(['Block', 0]);
  expect(() => bindScalarFragmentFunction(outer, lambda, fn, foreign))
    .toThrow(/different prepared function/);
  bindScalarFragmentFunction(outer, lambda, fn, body);
  const leaveFunction = enterScalarFragment(body, lambda)!;
  const local = { ...lambda, var: (name: string) => name,
    boundVars: new Set([...lambda.boundVars, 'total']) };
  expect(() => bindScalarFragmentBlock(lambda, local, body,
    [foreign, ...body.ops.slice(1)]))
    .toThrow(/different prepared block/);
  bindScalarFragmentBlock(lambda, local, body, body.ops);
  const leaveRead = enterScalarFragment(final, local)!;
  leaveRead();
  expect(() => enterScalarFragment(rootOnly, local))
    .toThrow(/missing prepared-node facts/);
  expect(() => enterScalarFragment(final, { ...local, mode: 'complex' }))
    .toThrow(/different prepared policy/);
  expect(() => enterScalarFragment(final, { ...local, var: () => 'foreign' }))
    .toThrow(/different prepared policy/);
  leaveFunction();
});
