import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { ComputeEngine, isFunction } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';

// These controls pin observable behavior independently of inferred precision.
describe('initialization contract semantic controls', () => {
  test.each([
    ['let a=3; let b=a+1; b', 4],
    ['let x; x=1; x', 1],
    ['let xs=[]; xs=[1,2]; xs', ['List', 1, 2]],
    ['let xs:list<real>=[]; xs=[1,2.5]; xs', ['List', 1, 2.5]],
    ['let x:integer=1; x="a"; x', 1],
    ['const x=1; x=2; x', 1],
    ['let x=1; let x=2; x', 1],
    ['let a=h(1); function h(x){x+1}; a', 2],
    ['let f=(x)=>x+1; let old=f; f=(x)=>x+2; [old(1),f(1)]', ['List', 2, 3]],
    ['let xs=[1,2,3]; while let [h,...]=xs {xs=rest(xs)}; xs', ['List']],
    ['let t=0; for x in [1,2,3] {t=t+x}; t', 6],
    ['let x=1; do {let x=2; x}; x', 1],
    ['let a="x"+1; 5', 5],
  ])('%s', async (source, expected) => {
    expect(executeEpsil(new ComputeEngine(), source).value.json).toEqual(expected);
    expect((await executeEpsilAsync(new ComputeEngine(), source)).value.json).toEqual(expected);
  });
});

describe('fixed initialization type contracts', () => {
  test.each([
    ['let x=1; x=2.5; x', 'x', 'number'],
    ['let xs=[]; xs=[1,2]; xs', 'xs', 'list<unknown>'],
    ['let xs:list<real>=[]; xs=[1,2]; xs', 'xs', 'list<real>'],
    ['let p=(1,[2,3]); p=(2.5,[4]); p', 'p', 'tuple<number, list<number>>'],
    ['let x; x=1; x', 'x', 'number'],
    ['let x; if true {x=1}; x', 'x', 'unknown'],
    ['let f; if true {f=(x)=>x+1}; f(2)', 'f', 'unknown'],
    ['let x; for k in [1] {x=1}; x', 'x', 'unknown'],
    ['let x=t; x=1; x', 'x', 'unknown'],
    ['let x:unknown=1; x=2; x', 'x', 'unknown'],
    ['let x:unknown; x=1; x', 'x', 'unknown'],
    ['let xs:list<unknown>=[]; xs=[1,2]; xs', 'xs', 'list<unknown>'],
    ['let f=(x)=>x+1; f=(x)=>"a"; f=(x)=>x+2; f', 'f', 'function'],
  ])('%s retains its prepared type across execution', (source, name, expected) => {
    const ce = new ComputeEngine();
    const ast = ce.box(resolveLibraryNames(parseEpsil(source)[0]!, source, ce));
    const before = ce.symbol(name).type.toString();
    ast.evaluate();
    const evaluated = ce.symbol(name).type.toString();
    ast.N();
    expect({ before, evaluated, numeric: ce.symbol(name).type.toString() }).toEqual({before: expected, evaluated: expected, numeric: expected});
  });

  test.each([
    ['let x; x', ['Error', ['ErrorCode', "'read-before-initialization'", "'x'"]]],
    ['let x=1; let f=()=>do {x=x+1; x}; [f(),x]', ['List',2,2]],
    ['let p=(1,2); p=(3.5,4); p', ['Tuple',3.5,4]],
    ['let f=(x)=>x+1; f=7; f(1)', 2],
  ])('%s preserves value behavior', (source, expected) => {
    expect(executeEpsil(new ComputeEngine(), source).value.json).toEqual(expected);
  });
});

describe('initialization boundaries', () => {
  test.each([
    ['let x:real; x=1; x', 1],
    ['let x; if false {x=1}; x', ['Error', ['ErrorCode', "'read-before-initialization'", "'x'"]]],
    ['let x; let f=()=>x; let before=f(); x=1; before', ['Error', ['ErrorCode', "'read-before-initialization'", "'x'"]]],
    ['let x; x=1; let f=()=>x; f()', 1],
    ['let f=(x,k=2)=>x+k; f(3)', 5],
    ['let f=(x,k=2)=>x+k; f(k:4,x:3)', 7],
    ['let f; if false {f=(x)=>x+1}; f(2)', ['Error', ['ErrorCode', "'read-before-initialization'", "'f'"]]],
    ['let f; if true {f=(x)=>x+1}; f(2)', 3],
    ['let r; r=[[1,2],[3,4]][7]; r=[5,6]; r', ['List',5,6]],
    ['let f=(x,y)=>x+y; let g=f(2); g(3)', 5],
    ['let f=(x:integer)=>x+1; f(1.5)', ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'1.5'"], 1.5, ['ErrorTrace', ['ErrorFrame', "'f'", 1]]]],
  ])('%s', async (source, expected) => {
    expect(executeEpsil(new ComputeEngine(), source).value.json).toEqual(expected);
    expect((await executeEpsilAsync(new ComputeEngine(), source)).value.json).toEqual(expected);
  });

  test('a typed empty slot keeps its annotation', () => {
    const ce = new ComputeEngine();
    const source = 'let x:real; x=1; x';
    const e = ce.box(resolveLibraryNames(parseEpsil(source)[0]!, source, ce));
    expect(ce.symbol('x').type.toString()).toBe('real');
    expect(e.evaluate().json).toBe(1);
    expect(ce.symbol('x').type.toString()).toBe('real');
  });

  test('fixed types also apply to Block activations', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Block', ['Declare', 'x', "'unknown'", 1], ['Assign', 'x', 2.5], 'x']);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().json).toBe(2.5);
    expect(e.N().json).toBe(2.5);
    expect(e.type.toString()).toBe('number');
  });
});


describe('compilation reads initialization contracts', () => {
  test.each([
    ['let x:real; if false {x=1}; x', undefined],
    ['let x:real; for k in [] {x=1}; x', undefined],
    ['let x; x=1; x+2', 3],
    ['let xs=[]; xs=[1,2]; length(xs)', 2],
    ['let x:real=1; x=2.5; x+1', 3.5],
  ])('%s returns the interpreter value or declines', (source, expected) => {
    const ce = new ComputeEngine();
    const e = ce.box(resolveLibraryNames(parseEpsil(source)[0]!, source, ce));
    let result: ReturnType<typeof compile> | undefined;
    try { result = compile(e, {to: 'javascript', fallback: false}); } catch { /* A refusal may throw with fallback disabled. */ }
    if (expected === undefined) {
      expect(result?.success ?? false).toBe(false);
      expect(compile(e, {to: 'javascript'}).success).toBe(false);
    }
    else if (result?.success) expect(result.run!({})).toEqual(expected);
  });
});


test('a constant callable reports its refused write once', () => {
  const result = executeEpsil(new ComputeEngine(), 'const k=(n)=>n+1; k=(s)=>s; k(1)');
  expect(result.value.json).toBe(2);
  expect(result.diagnostics.map((d) => d.message[0])).toEqual(['static-type-error']);
});


describe('deferred initialization does not follow runtime calls', () => {
  test.each([
    ['function init() scope {x="a";x}; let x; let y=init(); x=1; y', 'y', "'a'"],
    ['function init() scope {x="a";x}; let x; x=init(); x', 'x', "'a'"],
    ['function init() scope {x="a";x}; let x; x=[init()]; x', 'x', ['List', "'a'"]],
  ])('%s', async (source, resultName, expected) => {
    const ce = new ComputeEngine();
    const e = ce.box(resolveLibraryNames(parseEpsil(source)[0]!, source, ce));
    expect(ce.symbol('x').type.toString()).toBe('unknown');
    expect(e.evaluate().json).toEqual(expected);
    expect(ce.symbol('x').type.toString()).toBe('unknown');
    expect(ce.symbol(resultName).evaluate().json).toEqual(expected);
    expect((await executeEpsilAsync(new ComputeEngine(), source)).value.json).toEqual(expected);
  });

  test.each([
    ['let x; x=1; x', 'number', 1],
    ['let x; let y=2; x=1; x', 'number', 1],
    ['let x; x=1+2; x', 'unknown', 3],
  ])('%s uses only direct initialization evidence', (source, type, value) => {
    const ce = new ComputeEngine();
    const e = ce.box(resolveLibraryNames(parseEpsil(source)[0]!, source, ce));
    expect(ce.symbol('x').type.toString()).toBe(type);
    expect(e.evaluate().json).toEqual(value);
  });
});


test('a deferred slot keeps its initialized state under a value shield', () => {
  const ce = new ComputeEngine();
  const value = ce.box(['Block', ['Declare', 'x'], ['Assign', 'x', 1],
    ['HoldValues', ['Add', 'x', 1], 'x']]);
  expect(value.evaluate().toString()).toBe('x + 1');
  const callable = ce.box(['Block', ['Declare', 'f'], ['Assign', 'f', ['Function', 1]],
    ['HoldValues', ['f'], 'f']]);
  expect(callable.evaluate().toString()).toBe('f()');
});


test('a mapped partial application does not acquire a scalar callable contract', () => {
  const ce = new ComputeEngine();
  const value = ce.box(['Block',
    ['Declare', 'fs', "'unknown'", ['Apply', ['Function', ['Add','x','y'],'x','y'], ['List',1,2]]],
    'fs']);
  const functions = [...value.evaluate().each()];
  expect(functions).toHaveLength(2);
  expect(functions.map((fn) => ce.function('Apply', [fn, ce.number(3)]).evaluate().json)).toEqual([4,5]);
});


describe('written bare parameters keep an unknown contract', () => {
  test.each([
    [['Add','x',1], ['Assign','x',['List',1,2]], 'x'],
    [['Assign','x',['List',1,2]], ['Add','x',1], 'x'],
  ])('list writes do not inherit a numeric use requirement: %j', (...statements) => {
    const ce = new ComputeEngine();
    const fn = ce.box(['Function', ['Block', ...statements], 'x']);
    const type = fn.type.type;
    expect(typeof type).toBe('object');
    if (typeof type === 'object' && type.kind === 'signature') {
      expect(type.args?.[0].type).toBe('unknown');
      expect(type.result).toBe('unknown');
    }
    expect(ce.function('Apply', [fn, ce.number(3)]).evaluate().json).toEqual(['List',1,2]);
    expect(compile(fn, {to:'javascript'}).success).toBe(false);
  });

  test('a numeric write still executes without a numeric parameter claim', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(['Function', ['Block', ['Add','x',1], ['Assign','x',2], 'x'], 'x']);
    expect(ce.function('Apply', [fn, ce.number(3)]).evaluate().json).toBe(2);
    expect(fn.type.toString()).toContain('unknown');
  });
});

describe.each([
  ['sync', executeEpsil],
  ['async', executeEpsilAsync],
] as const)('Program callable replacement (%s)', (_, execute) => {
  const replacement = 'h = x => x + random()';

  test('a pure slot rejects a random replacement and retains its value', async () => {
    const ce = new ComputeEngine();
    const source = [
      'let h: (number) pure -> number = x => 2x',
      replacement,
      'h(3)',
    ].join('\n');
    const result = await execute(ce, source);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        message: [
          'runtime-error',
          'expected `pure effects`, got `random effects`',
          '',
          'incompatible-type',
        ],
        range: [
          source.indexOf(replacement),
          source.indexOf(replacement) + replacement.length,
        ],
      }),
    ]);
    expect(result.value.json).toBe(6);
    expect(ce.box(['h', 3]).evaluate().json).toBe(6);
    expect(ce.box('h').type.toString()).toBe('(number) pure -> number');
  });

  test('a slot allowing random effects accepts the replacement', async () => {
    const ce = new ComputeEngine();
    const result = await execute(
      ce,
      [
        'let h: (number) random -> number = x => 2x',
        replacement,
        'h(3)',
      ].join('\n')
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.re).toBeGreaterThanOrEqual(3);
    expect(result.value.re).toBeLessThan(4);
    expect(ce.box('h').type.toString()).toBe('(number) random -> number');
  });
});

describe('matrix initialization and forward calls', () => {
  test.each([
    [
      'a Program initializer calls a later typed function',
      [
        'let answer = f([[1, 2], [3, 4]])',
        'function f(A: matrix) -> number { determinant(2 * A) }',
        'answer',
      ].join('\n'),
      -8,
      true,
    ],
    [
      'Block locals supply matrix shape during boxing',
      [
        'do {',
        '  let A: matrix = [[1, 2], [3, 4]]',
        '  let B: matrix = [[2, 0], [0, 1]]',
        '  determinant(A + 2 * B)',
        '}',
      ].join('\n'),
      24,
      false,
    ],
    [
      'Block functions can call a typed sibling declared later',
      [
        'do {',
        '  function forward(A: matrix) -> number { later(A) }',
        '  function later(A: matrix) -> number { determinant(2 * A) }',
        '  forward([[1, 2], [3, 4]])',
        '}',
      ].join('\n'),
      -8,
      false,
    ],
  ])('%s', async (_name, source, expected, publishesAnswer) => {
    for (const execute of [executeEpsil, executeEpsilAsync]) {
      const ce = new ComputeEngine();
      const result = await execute(ce, source);
      expect(result.diagnostics).toEqual([]);
      expect(result.value.json).toBe(expected);
      expect(ce.lookupDefinition('A')).toBeUndefined();
      expect(ce.lookupDefinition('B')).toBeUndefined();
      expect(ce.lookupDefinition('later')).toBeUndefined();
      expect(ce.lookupDefinition('answer') !== undefined).toBe(publishesAnswer);
    }
  });

  test('a typed but uninitialized matrix still produces a runtime error', async () => {
    for (const execute of [executeEpsil, executeEpsilAsync]) {
      const ce = new ComputeEngine();
      const { value } = await execute(ce, 'do { let A: matrix; determinant(A) }');
      if (!isFunction(value, 'Error')) throw new Error('Expected an Error');
      expect(value.op1.json).toEqual([
        'ErrorCode',
        "'read-before-initialization'",
        "'A'",
      ]);
      expect(ce.lookupDefinition('A')).toBeUndefined();
    }
  });
});
