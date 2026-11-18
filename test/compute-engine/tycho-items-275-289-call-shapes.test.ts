import { ComputeEngine, compile } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';
import type { MathJsonExpression } from '../../src/math-json/types';

const localPoint = (initializer: MathJsonExpression): MathJsonExpression => [
  'Block',
  ['Declare', 'theta', "'unknown'", initializer],
  ['PointList', ['Cos', 'theta'], ['Sin', 'theta']],
];

test('untyped plot inputs carry scalar shader facts through a local', () => {
  const ce = new ComputeEngine();
  ce.declare('theta_0', {
    signature: '(unknown, unknown) -> broadcastable<number>',
  });
  ce.assign('theta_0', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
  // Plot inputs with no type are refused (ROADMAP CE-712.1), with their
  // names in `unsupported`.
  const untyped = compile(ce.box(localPoint(['theta_0', 'x', 'y'])), {
    to: 'glsl',
  });
  expect(untyped.success).toBe(false);
  expect(untyped.diagnostic?.code).toBe('untyped-input');
  expect(untyped.unsupported).toEqual(expect.arrayContaining(['x', 'y']));
  // Declared `real`, they carry the scalar facts through the local.
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const result = compile(ce.box(localPoint(['theta_0', 'x', 'y'])), {
    to: 'glsl',
  });
  expect(result.success).toBe(true);
});

test('call type inference does not mutate parameters or survive redefinition', () => {
  const ce = new ComputeEngine();
  ce.declare('f', { signature: '(unknown) -> broadcastable<number>' });
  ce.assign('f', ce.box(['Function', ['Add', 't', 1], 't']));
  ce.declare('x', 'real');
  const call = ce.box(['f', 'x']);
  const before = ce.symbol('f').value!.type.toString();
  expectTypeBetween(call, { atMost: 'number' });
  expect(ce.symbol('f').value!.type.toString()).toBe(before);
  ce.assign('f', ce.box(['Function', ['List', 't', 't'], 't']));
  expectTypeBetween(call, { atMost: 'list<number>' });
});

test('a numeric chain through a finite sum stays scalar', () => {
  const ce = new ComputeEngine();
  ce.declare('q', { signature: '(unknown) -> broadcastable<number>' });
  ce.assign('q', ce.box(['Function', ['Add', 't', 1], 't']));
  ce.declare('s', { signature: '(unknown) -> broadcastable<number>' });
  ce.assign(
    's',
    ce.box([
      'Function',
      ['Sum', ['q', ['Multiply', 't', 'k']], ['Tuple', 'k', 1, 10]],
      't',
    ])
  );
  ce.declare('x', 'real');
  const expr = ce.box(['s', 'x']);
  expectTypeBetween(expr, { atMost: 'number' });
  const result = compile(expr);
  expect(result.success).toBe(true);
  expect(result.run!({ x: 2 })).toBe(120);
  expect(result.preamble).not.toContain('_SYS.bcast(');
});

test('a nested block return does not narrow the later unreachable result', () => {
  const ce = new ComputeEngine();
  ce.declare('f', { signature: '(unknown) -> broadcastable<number>' });
  ce.assign(
    'f',
    ce.box([
      'Function',
      ['Block', ['Block', ['Return', ['List', 't', 't']]], 't'],
      't',
    ])
  );
  const call = ce.box(['f', 3]);
  expect(call.evaluate().json).toEqual(['List', 3, 3]);
  expect(call.type.matches('number')).toBe(false);
});

test('a single rest argument still binds a tuple during call type inference', () => {
  const ce = new ComputeEngine();
  ce.assign('f', ce.box(['Function', 'rest', ['Spread', 'rest']]));
  const call = ce.box(['f', 3]);
  expect(call.evaluate().json).toEqual(['Tuple', 3]);
  expect(call.type.matches('number')).toBe(false);
});

test.each(['operator', 'value'] as const)(
  'nested calls retain per-element list broadcasting on the %s route',
  (route) => {
    const ce = new ComputeEngine();
    const body: MathJsonExpression = ['Function', ['Tuple', 't', 't'], 't'];
    if (route === 'operator') ce.box(['DefineFunction', 'f', body]).evaluate();
    else ce.assign('f', ce.box(body));
    const resultType =
      'tuple<unknown, unknown> | list<tuple<unknown, unknown>>';
    ce.declare('g', { signature: `(number) -> ${resultType}` });
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['f', ['List', 't', ['Add', 't', 1]]],
        ['Typed', 't', 'number'],
      ])
    );
    const call = ce.box(['g', 1]);
    const value = call.evaluate();
    expect(value.json).toEqual(['List', ['Tuple', 1, 1], ['Tuple', 2, 2]]);
    expectTypeBetween(call, {
      atLeast: value.type.toString(),
      atMost: resultType,
    });
  }
);

test('inferred function declarations retain their list calls after scalar compilation', () => {
  const ce = new ComputeEngine();
  ce.parse('f(t):=t+1').evaluate();
  ce.declare('x', 'real');
  const before = ce.lookupDefinition('f')!.operator!.signature.toString();
  const result = compile(ce.box(['f', 'x']));
  expect(result.success).toBe(true);
  expect(result.run!({ x: 2 })).toBe(3);
  expect(ce.lookupDefinition('f')!.operator!.signature.toString()).toBe(before);
  expect(ce.box(['f', ['List', 1, 2]]).evaluate().json).toEqual(['List', 2, 3]);
});
