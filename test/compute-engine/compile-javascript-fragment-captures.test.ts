import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { Expression } from '../../src/compute-engine/global-types';
import type { CompilationOptions, CompileTarget } from '../../src/compute-engine/compilation/types';
import { attachScalarFragment, bindScalarFragmentDefinition, enterScalarFragment, assertScalarPreparedNode } from '../../src/compute-engine/compilation/javascript-fragment-facts';
import type { MathJsonExpression } from '../../src/math-json/types';

function fixture(body: MathJsonExpression = ['Add', 'u', 'offset']) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  ce.declare('helper', '(real) -> real');
  ce.assign('helper', ce.expr(['Function', body, ['Typed', 'u', "'real'"]]));
  return { ce, expression: ce.expr(['helper', 'x']) };
}

for (const mode of ['strict', 'complex'] as const) {
  for (const cse of [false, true]) {
    for (const constantFold of [false, true]) {
      test(`${mode}, CSE=${cse}, folding=${constantFold}: snapshot survives reassignment`, () => {
        const { ce, expression } = fixture();
        const options = { mode, cse, constantFold, fallback: false };
        const target = new ScalarFragmentJavaScriptTarget();
        const legacy = compile(expression, options);
        const old = target.compile(expression, options);
        expect(old.run!({ x: 3 })).toBe(5);
        expect(old.run!({ x: -4 })).toBe(-2);
        expect(old.run!({ x: 3 })).toBe(legacy.run!({ x: 3 }));
        expect(compile(expression, options).code).toBe(legacy.code);
        ce.assign('offset', 7);
        const fresh = target.compile(expression, options);
        expect(old.run!({ x: 3 })).toBe(5);
        expect(legacy.run!({ x: 3 })).toBe(5);
        expect(fresh.run!({ x: 3 })).toBe(10);
        expect(fresh.run!({ x: 3 })).toBe(compile(expression, options).run!({ x: 3 }));
      });

      test(`${mode}, CSE=${cse}, folding=${constantFold}: repeated captures restore helper scope`, () => {
        const ce = new ComputeEngine();
        ce.declare('x', 'real'); ce.declare('flag', 'boolean');
        ce.declare('offset', 'real'); ce.assign('offset', -2.5);
        ce.declare('helper', '(boolean, real) -> real');
        ce.assign('helper', ce.expr(['Function',
          ['If', 'b', ['Add', 'offset', 'u'], ['Negate', ['Add', 'u', 'offset']]],
          ['Typed', 'b', "'boolean'"], ['Typed', 'u', "'real'"]]));
        const result = new ScalarFragmentJavaScriptTarget().compile(
          ce.expr(['helper', 'flag', 'x']), { mode, cse, constantFold });
        expect(result.run!({ flag: true, x: 4 })).toBe(1.5);
        expect(result.run!({ flag: false, x: 4 })).toBe(-1.5);
      });
    }
  }
}

test('a parameter shadows a stored numeric binding', () => {
  const { ce } = fixture();
  ce.assign('helper', ce.expr(['Function', ['Negate', 'offset'], ['Typed', 'offset', "'real'"]]));
  expect(new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x']))
    .run!({ x: 3 })).toBe(-3);
});

test('a same-named ambient capture cannot replace the held binding', () => {
  const { ce, expression } = fixture();
  ce.pushScope();
  try {
    ce.declare('offset', 'real'); ce.assign('offset', 99);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false })).toThrow();
  } finally { ce.popScope(); }
});

test('a second captured binding declines', () => {
  const { ce } = fixture();
  ce.declare('other', 'real'); ce.assign('other', 4);
  ce.assign('helper', ce.expr(['Function', ['Add', 'u', 'offset', 'other'], ['Typed', 'u', "'real'"]]));
  expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x']))).toThrow(/one numeric capture/);
});

test.each(([['Add', 'x', 1], ['Random']] as MathJsonExpression[]).map(value => ({ value })))
('nonliteral stored values decline: $value', ({ value }) => {
  const { ce, expression } = fixture();
  ce.assign('offset', ce.expr(value));
  expect(ce.expr('offset').valueDefinition!.value!.operator).toBe((value as string[])[0]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false })).toThrow();
});

test('declared complex capture with a real literal remains outside the slice', () => {
  const ce = new ComputeEngine(); ce.declare('x', 'complex');
  ce.declare('offset', 'complex'); ce.assign('offset', 2);
  ce.declare('helper', '(complex) -> complex');
  ce.assign('helper', ce.expr(['Function', ['Add', 'u', 'offset'], ['Typed', 'u', "'complex'"]]));
  expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x']))).toThrow(/unsupported helper capture/);
});


test('changing the capture between preparation and annotation fails closed', () => {
  const { ce, expression } = fixture();
  class ChangedCapture extends ScalarFragmentJavaScriptTarget {
    protected prepareCompilation(expr: Expression, options: CompilationOptions<Expression>, batch?: unknown) {
      const prepared = super.prepareCompilation(expr, options, batch);
      ce.assign('offset', 7);
      return prepared;
    }
  }
  expect(() => new ChangedCapture().compile(expression)).toThrow(/different captured binding or value/);
});

test('stored literal access requires the exact captured-symbol operation and restores scope', () => {
  const ce = new ComputeEngine();
  const call = ce.expr(['Add', 'x', 1]);
  const body = ce.expr(['Add', 'u', 'offset']);
  const symbol = ce.expr('offset');
  const literal = ce.expr(['Function', body, 'u']);
  const value = ce.expr(2);
  const foreign = ce.expr(3);
  const real = { representation: 'number' as const };
  const scope = { facts: new Map([[call, real], [value, real], [foreign, real]]), inner: new Map() };
  const innerScope = { facts: new Map([[body, real], [symbol, real]]), inner: new Map() };
  const target = { rootExpression: call, mode: 'strict' } as CompileTarget<Expression>;
  let valid = true;
  attachScalarFragment(target, { root: call,
    helper: { name: 'helper', literal, body, capture: {
      symbols: new Set([symbol]), value,
      assertCurrent: () => { if (!valid) throw new Error('changed snapshot'); },
    } },
    annotate: () => ({ root: call, scope,
      functions: new Map([['helper', { body, scope: innerScope }]]) }),
  });
  const leaveRoot = enterScalarFragment(call, target)!;
  const inner = { ...target, boundVars: new Set(['u']) };
  bindScalarFragmentDefinition(target, inner, literal, body, 'helper');
  const leaveBody = enterScalarFragment(body, inner)!;
  expect(() => assertScalarPreparedNode(value, inner)).toThrow(/missing prepared-node facts/);
  const leaveSymbol = enterScalarFragment(symbol, inner)!;
  expect(() => assertScalarPreparedNode(foreign, inner)).toThrow(/missing prepared-node facts/);
  assertScalarPreparedNode(value, inner);
  const leaveValue = enterScalarFragment(value, inner)!;
  expect(() => assertScalarPreparedNode(symbol, inner)).toThrow(/missing prepared-node facts/);
  leaveValue();
  assertScalarPreparedNode(symbol, inner);
  valid = false;
  expect(() => assertScalarPreparedNode(value, inner)).toThrow(/changed snapshot/);
  leaveSymbol(); leaveBody(); leaveRoot();
});


test('changing a captured declaration after preparation fails closed', () => {
  const { ce, expression } = fixture();
  class ChangedType extends ScalarFragmentJavaScriptTarget {
    protected prepareCompilation(expr: Expression, options: CompilationOptions<Expression>, batch?: unknown) {
      const prepared = super.prepareCompilation(expr, options, batch);
      ce.expr('offset').valueDefinition!.type = ce.type('complex');
      return prepared;
    }
  }
  expect(() => new ChangedType().compile(expression)).toThrow(/was typed when/);
});


test('an explicitly integer capture is snapshotted with the real representation', () => {
  const ce = new ComputeEngine(); ce.declare('x', 'real');
  ce.declare('offset', 'integer'); ce.assign('offset', -3);
  ce.declare('helper', '(real) -> real');
  ce.assign('helper', ce.expr(['Function', ['Add', 'u', 'offset'], ['Typed', 'u', "'real'"]]));
  const result = new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x']));
  expect(result.run!({ x: 1.5 })).toBe(-1.5);
});
