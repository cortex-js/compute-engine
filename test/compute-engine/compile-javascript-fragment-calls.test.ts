import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { attachScalarFragment, bindScalarFragmentDefinition, enterScalarFragment, assertScalarFragmentCall } from '../../src/compute-engine/compilation/javascript-fragment-facts';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { FragmentScope } from '../../src/compute-engine/compilation/fragment';
import type { MathJsonExpression } from '../../src/math-json/types';

const typed = (name: string, type: string): MathJsonExpression => ['Typed', name, `'${type}'`];
function install(ce: ComputeEngine, name: string, signature: string,
  body: MathJsonExpression, parameters: MathJsonExpression[]) {
  ce.declare(name, signature);
  ce.assign(name, ce.expr(['Function', body, ...parameters]));
}

for (const mode of ['strict', 'complex'] as const) {
  for (const cse of [false, true]) {
    for (const constantFold of [false, true]) {
      describe(`${mode} CSE=${cse} fold=${constantFold}`, () => {
        test('one resolved four-input helper matches the numeric oracle and legacy', () => {
          const ce = new ComputeEngine();
          for (const name of ['w', 'e', 'n', 's']) ce.declare(name, 'real');
          install(ce, 'neighborSum', '(real, real, real, real) -> real',
            ['Add', 'a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'].map(name => typed(name, 'real')));
          const expression = ce.expr(['neighborSum', 'w', 'e', 'n', 's']);
          const options = { mode, cse, constantFold, fallback: false };
          const legacy = compile(expression, options);
          const result = new ScalarFragmentJavaScriptTarget().compile(expression, options);
          for (const [input, expected] of [
            [{ w: 1, e: 2, n: 3, s: 4 }, 10], [{ w: -2, e: 0, n: 3, s: 1 }, 2],
          ] as [{ w: number; e: number; n: number; s: number }, number][]) {
            expect(result.run!(input)).toBe(expected);
            expect(result.run!(input)).toBe(legacy.run!(input));
          }
          expect(compile(expression, options).code).toBe(legacy.code);
        });

        test('two live call sites share one emitted definition', () => {
          const ce = new ComputeEngine();
          ce.declare('x', 'real'); ce.declare('y', 'real');
          install(ce, 'helper', '(real) -> real', ['Negate', 'u'], [typed('u', 'real')]);
          const result = new ScalarFragmentJavaScriptTarget().compile(
            ce.expr(['Add', ['helper', 'x'], ['helper', 'y']]), { mode, cse, constantFold });
          expect(result.run!({ x: 2, y: -5 })).toBe(3);
          expect(result.preamble?.match(/const _fn_helper\s*=/g)).toHaveLength(1);
        });

        test('complex helper result composes with real caller arithmetic', () => {
          const ce = new ComputeEngine();
          ce.declare('z', 'complex'); ce.declare('t', 'complex'); ce.declare('x', 'real');
          install(ce, 'helper', '(complex, complex) -> complex', ['Add', 'a', 'b'],
            [typed('a', 'complex'), typed('b', 'complex')]);
          const result = new ScalarFragmentJavaScriptTarget().compile(
            ce.expr(['Add', ['helper', 'z', 't'], 'x']), { mode, cse, constantFold });
          expect(result.run!({ z: { re: 1, im: 2 }, t: { re: 3, im: -1 }, x: 5 }))
            .toEqual({ re: 9, im: 1 });
        });
      });
    }
  }
}

test('a single-value block enters its exact annotated scope', () => {
  const ce = new ComputeEngine(); ce.declare('x', 'real');
  install(ce, 'helper', '(real) -> real', ['Block', ['Negate', 'u']], [typed('u', 'real')]);
  expect(new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x']))
    .run!({ x: 3 })).toBe(-3);
});

test.each([
  { signature: '(real) -> complex', parameter: 'real', body: 'u', input: 'real',
    reason: /helper return representation differs from its signature/ },
  // The canonical form wraps a complex body in `Typed(…, 'real')` for a real
  // result, so a complex-to-real result convention never reaches the fragment
  // checks: the helper body check refuses the `Typed` wrapper first.
  { signature: '(complex) -> real', parameter: 'complex', body: 'u', input: 'complex',
    reason: /unsupported helper body Typed/ },
  { signature: '(complex) -> complex', parameter: 'complex', body: 'u', input: 'real',
    reason: /helper arguments must preserve representation/ },
  { signature: '(real) -> real', parameter: 'real', body: 'u', input: 'complex',
    reason: /argument `x` of `helper` has the type `complex`, and the parameter `u` has the type `real`/ },
])('declines unmatched call conventions $signature from $input', testCase => {
  const ce = new ComputeEngine(); ce.declare('x', testCase.input);
  install(ce, 'helper', testCase.signature, testCase.body, [typed('u', testCase.parameter)]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x']),
    { fallback: false })).toThrow(testCase.reason);
});

test('captures and transitive calls remain outside the helper slice', () => {
  const ce = new ComputeEngine(); ce.declare('x', 'real'); ce.assign('offset', 2);
  install(ce, 'helper', '(real) -> real', ['Add', 'u', 'offset'], [typed('u', 'real')]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x'])))
    .toThrow(/unsupported helper capture/);
  install(ce, 'other', '(real) -> real', ['Negate', 'u'], [typed('u', 'real')]);
  ce.assign('helper', ce.expr(['Function', ['other', 'u'], typed('u', 'real')]));
  expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x'])))
    .toThrow(/unsupported helper body/);
});

test('different lexical helper binding cannot substitute for the bound definition', () => {
  const ce = new ComputeEngine(); ce.declare('x', 'real');
  install(ce, 'helper', '(real) -> real', ['Negate', 'u'], [typed('u', 'real')]);
  const expression = ce.expr(['helper', 'x']);
  ce.pushScope();
  install(ce, 'helper', '(real) -> real', ['Add', 'u', 10], [typed('u', 'real')]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
    .toThrow(/captured callable has a different binding from the ambient function/);
  ce.popScope();
});

test('a new compilation observes a replacement without changing the built artifact', () => {
  const ce = new ComputeEngine(); ce.declare('x', 'real');
  install(ce, 'helper', '(real) -> real', ['Negate', 'u'], [typed('u', 'real')]);
  const target = new ScalarFragmentJavaScriptTarget();
  const old = target.compile(ce.expr(['helper', 'x']));
  ce.assign('helper', ce.expr(['Function', ['Add', 'u', 10], typed('u', 'real')]));
  const next = target.compile(ce.expr(['helper', 'x']));
  expect(old.run!({ x: 3 })).toBe(-3);
  expect(next.run!({ x: 3 })).toBe(13);
});

test('named-body handoff rejects changed identity, scopes, policy and hidden arguments', () => {
  const ce = new ComputeEngine(); ce.declare('x', 'real');
  install(ce, 'helper', '(real) -> real', ['Negate', 'u'], [typed('u', 'real')]);
  const call = ce.expr(['helper', 'x']);
  const literal = ce.expr(['Function', ['Negate', 'u'], typed('u', 'real')]);
  if (!isFunction(literal) || !isFunction(call)) throw Error('fixture function');
  const body = literal.op1.canonical;
  const foreign = ce.expr(['Add', 'x', 1]);
  const real = { type: { kind: 'real' as const }, representation: 'number' as const };
  const scope: FragmentScope<'number'> = {
    bindings: new Map(), facts: new Map([[call, { ...real,
      conversions: [{ kind: 'none' as const, ...real }] }], [call.op1, real]]), inner: new Map(),
    statements: new Set(),
  };
  const functionScope: FragmentScope<'number'> = {
    parent: scope, bindings: new Map(), facts: new Map([[body, real]]), inner: new Map(),
    statements: new Set(),
  };
  const target = { rootExpression: call, mode: 'strict' } as CompileTarget<Expression>;
  attachScalarFragment(target, { root: call, helper: { name: 'helper', literal, body },
    annotation: { root: call, scope, functions: new Map([['helper', {
      body, scope: functionScope, type: { kind: 'function',
        parameters: [{ name: 'u', type: { kind: 'real' } }], result: { kind: 'real' } },
    }]]) } });
  const leave = enterScalarFragment(call, target)!;
  const inner = { ...target, var: (name: string) => name, boundVars: new Set(['u']) };
  expect(() => bindScalarFragmentDefinition(target, inner, foreign, body, 'helper'))
    .toThrow(/different prepared definition/);
  expect(() => bindScalarFragmentDefinition(target, inner, literal, foreign, 'helper'))
    .toThrow(/different prepared definition/);
  expect(() => bindScalarFragmentDefinition(target, inner, literal, body, 'variant'))
    .toThrow(/different prepared definition/);
  bindScalarFragmentDefinition(target, inner, literal, body, 'helper');
  enterScalarFragment(body, inner)!();
  expect(() => enterScalarFragment(call, inner)).toThrow(/missing prepared-node facts/);
  expect(() => enterScalarFragment(body, { ...inner, mode: 'complex' }))
    .toThrow(/different prepared policy/);
  expect(() => assertScalarFragmentCall(target, call.ops, ['extra']))
    .toThrow(/different prepared call/);
  expect(() => assertScalarFragmentCall(target, [foreign], []))
    .toThrow(/different prepared call/);
  assertScalarFragmentCall(target, call.ops, []);
  leave();
});

test('a helper converts its selected result arm without changing argument conventions', () => {
  const ce = new ComputeEngine();
  ce.declare('C', 'boolean'); ce.declare('x', 'real'); ce.declare('z', 'complex');
  install(ce, 'choose', '(boolean, real, complex) -> complex', ['If', 'c', 'r', 'v'],
    [typed('c', 'boolean'), typed('r', 'real'), typed('v', 'complex')]);
  const expression = ce.expr(['choose', 'C', 'x', 'z']);
  for (const mode of ['strict', 'complex'] as const) {
    const result = new ScalarFragmentJavaScriptTarget().compile(expression, { mode, constantFold: false });
    expect(result.run!({ C: true, x: 5, z: { re: 3, im: 4 } })).toBe(5);
    expect(result.run!({ C: false, x: 5, z: { re: 3, im: 4 } })).toEqual({ re: 3, im: 4 });
  }
});

test.each(['_', 'Math'])('renamed helper parameter %s keeps its exact binding', name => {
  const ce = new ComputeEngine(); ce.declare('x', 'real');
  install(ce, 'helper', '(real) -> real', ['Negate', name], [typed(name, 'real')]);
  expect(new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 'x']))
    .run!({ x: 7 })).toBe(-7);
});
