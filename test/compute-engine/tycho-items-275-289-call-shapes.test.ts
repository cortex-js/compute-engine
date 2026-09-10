import { ComputeEngine, compile } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';
import type { MathJsonExpression } from '../../src/math-json/types';

const point = 'tuple<number, number, number>';
const broad = `${point} | list<${point}> | indexed_collection<number | ${point}>`;
function pointFunction(ce: ComputeEngine): void {
  ce.declare('F', { signature: `(${broad}, ${broad}) -> ${broad}` });
  ce.assign(
    'F',
    ce.box([
      'Function',
      [
        'Tuple',
        ...['PointX', 'PointY', 'PointZ'].map((op) => [
          'Add',
          [op, 'a'],
          [op, 'c'],
        ]),
      ],
      ['Typed', 'a', broad],
      ['Typed', 'c', broad],
    ])
  );
}
const localPoint = (initializer: MathJsonExpression): MathJsonExpression => [
  'Block',
  ['Declare', 'theta'],
  ['Assign', 'theta', initializer],
  ['PointList', ['Cos', 'theta'], ['Sin', 'theta']],
];

test('scalar point calls use shared helpers and retain list admission', () => {
  const ce = new ComputeEngine();
  pointFunction(ce);
  ce.declare('x', 'real');
  const signature = ce.symbol('F').type.toString();
  const scalar = ce.box([
    'PointZ',
    ['F', ['Tuple', 1, 2, 3], ['Tuple', 'x', 1, 2]],
  ]);
  expectTypeBetween(scalar, { atMost: 'number' });
  for (const to of ['javascript', 'glsl', 'wgsl'] as const) {
    const result = compile(scalar, { to });
    expect(result.success).toBe(true);
    expect(result.preamble).toMatch(/_fn_F/);
    if (to === 'javascript') expect(result.run!({ x: 4 })).toBe(5);
    if (to === 'glsl') expect(result.preamble).toMatch(/vec3 _fn_F/);
    if (to === 'wgsl') expect(result.preamble).toMatch(/-> vec3f/);
  }
  expect(ce.symbol('F').type.toString()).toBe(signature);
  const list = ce.box([
    'F',
    ['List', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]],
    ['Tuple', 1, 1, 1],
  ]);
  expect(list.isValid).toBe(true);
  expect(list.evaluate().isValid).toBe(true);
});

test('scalar shapes cross retained locals and nested shared calls', () => {
  const ce = new ComputeEngine();
  ce.declare('theta_0', {
    signature: '(unknown, unknown) -> broadcastable<number>',
  });
  ce.assign('theta_0', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
  ce.declare('p', {
    signature:
      '(unknown, unknown) -> tuple<broadcastable<number>, broadcastable<number>>',
  });
  ce.assign(
    'p',
    ce.box(['Function', localPoint(['theta_0', 'x', 'y']), 'x', 'y'])
  );
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const e = ce.box(['p', 'x', 'y']);
  expectTypeBetween(e, { atMost: 'tuple<number, number>' });
  const js = compile(e);
  expect(js.success).toBe(true);
  expect(js.run!({ x: 0.2, y: 0.3 })).toEqual([Math.cos(0.5), Math.sin(0.5)]);
  expect(js.preamble).not.toContain('_SYS.bcast(');
  const gpu = compile(e, { to: 'glsl' });
  expect(gpu.success).toBe(true);
  expect(gpu.preamble).toMatch(/theta = _fn_theta/);
  expect(gpu.preamble).toMatch(/vec2 _fn_p/);
});

test('broad functions remain usable with scalar and list arguments after compilation', () => {
  const ce = new ComputeEngine();
  ce.declare('f', { signature: '(unknown) -> broadcastable<number>' });
  ce.assign('f', ce.box(['Function', ['Add', 't', 1], 't']));
  ce.declare('x', 'real');
  expect(compile(ce.box(['f', 'x'])).run!({ x: 2 })).toBe(3);
  expect(ce.box(['f', ['List', 1, 2]]).evaluate().json).toEqual(['List', 2, 3]);
  const dynamic = compile(ce.box(['f', 'u']));
  expect(dynamic.success).toBe(true);
  expect(dynamic.run!({ u: [1, 2] })).toEqual([2, 3]);
});

test('untyped plot inputs carry scalar shader facts through a local', () => {
  const ce = new ComputeEngine();
  ce.declare('theta_0', {
    signature: '(unknown, unknown) -> broadcastable<number>',
  });
  ce.assign('theta_0', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
  const result = compile(ce.box(localPoint(['theta_0', 'x', 'y'])), {
    to: 'glsl',
  });
  expect(result.success).toBe(true);
  expect(result.code).toContain('theta = _fn_theta_0(x, y)');
  expect(result.code).toContain('vec2(cos(theta), sin(theta))');
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

test('shared point helpers evaluate an impure argument once', () => {
  const ce = new ComputeEngine();
  pointFunction(ce);
  ce.declare('draw', { signature: '() -> real', pure: false });
  const draw = jest.spyOn(Math, 'random').mockReturnValue(0.7);
  try {
    const result = compile(
      ce.box(['PointZ', ['F', ['Tuple', ['draw'], 2, 3], ['Tuple', 4, 5, 6]]]),
      { functions: { draw: 'Math.random' } }
    );
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(9);
    expect(draw).toHaveBeenCalledTimes(1);
  } finally {
    draw.mockRestore();
  }
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

test('one artifact shares helpers separately for two point widths', () => {
  const ce = new ComputeEngine();
  ce.declare('scale', { signature: '(unknown) -> unknown' });
  ce.assign('scale', ce.box(['Function', ['Multiply', 2, 'p'], 'p']));
  ce.declare('x', 'real');
  const expression = ce.box([
    'List',
    ['scale', ['Tuple', 'x', 2]],
    ['scale', ['Tuple', 'x', 2, 3]],
  ]);
  const result = compile(expression, { constantFold: false });
  expect(result.success).toBe(true);
  expect(result.run!({ x: 1 })).toEqual([
    [2, 4],
    [2, 4, 6],
  ]);
  expect(result.preamble?.match(/const _fn_scale_/g)).toHaveLength(2);
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
