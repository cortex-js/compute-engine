import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/** `h` declared `signature` and assigned `body`, with the function held as a
 * value definition (`ce.assign` of a declared name). */
function engineWith(
  signature = '(integer) -> integer',
  body: unknown = ['Function', ['Multiply', 2, 'k'], 'k']
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('h', signature);
  ce.assign('h', ce.box(body as any));
  return ce;
}

const INCOMPATIBLE = "'incompatible-type'";

/** The code of the first `Error` in `json`, or `undefined`. */
function errorCode(json: unknown): string | undefined {
  if (!Array.isArray(json)) return undefined;
  if (json[0] === 'Error')
    return typeof json[1] === 'string' ? json[1] : json[1]?.[1];
  for (const x of json) {
    const code = errorCode(x);
    if (code !== undefined) return code;
  }
  return undefined;
}

describe('a declared parameter type is checked when a later value decides it', () => {
  test('the block form gives the error, not a value of the body', () => {
    const ce = engineWith();
    // Boxing declares no name, so `m` is declared: inferred, with no type
    // yet.
    ce.declare('m', { type: 'unknown', inferred: true });
    const block = ce.box([
      'Tuple',
      ['Block', ['Assign', 'r', ['g', ['h', 'm']]], ['Assign', 'm', 1.5], 'r'],
    ]);
    expect(errorCode(block.evaluate().json)).toBe(INCOMPATIBLE);
  });

  test('the Epsil form gives the error', () => {
    const ce = new ComputeEngine();
    const { value } = executeEpsil(
      ce,
      'let h: (integer) -> integer\nfunction h(k) { 2*k }\nlet m\nlet r = g(h(m))\nm = 1.5\nr'
    );
    expect(errorCode(value?.json)).toBe(INCOMPATIBLE);
  });

  test('the call stays, and its value is checked at the next evaluation', () => {
    const ce = engineWith();
    const held = ce.box(['h', 'm']).evaluate();
    expect(held.json).toEqual(['h', 'm']);
    ce.assign('m', 1.5);
    expect(errorCode(held.evaluate().json)).toBe(INCOMPATIBLE);
  });

  test('a later value that fits gives the value of the body', () => {
    const ce = engineWith();
    const held = ce.box(['h', 'm']).evaluate();
    ce.assign('m', 3);
    expect(held.evaluate().json).toBe(6);
  });

  test('the asynchronous evaluation holds the call too', async () => {
    const ce = engineWith();
    const held = await ce.box(['h', 'm']).evaluateAsync();
    expect(held.json).toEqual(['h', 'm']);
    ce.assign('m', 1.5);
    expect(errorCode((await held.evaluateAsync()).json)).toBe(INCOMPATIBLE);
  });

  test('a function held as an operator definition holds the call too', async () => {
    const ce = new ComputeEngine();
    ce.declare('h', {
      signature: '(integer) -> integer',
      evaluate: ce.expr(['Function', ['Multiply', 2, 'k'], 'k']),
    });
    const held = ce.box(['h', 'm']).evaluate();
    expect(held.json).toEqual(['h', 'm']);
    expect((await ce.box(['h', 'm']).evaluateAsync()).json).toEqual(['h', 'm']);
    ce.assign('m', 1.5);
    expect(errorCode(held.evaluate().json)).toBe(INCOMPATIBLE);
  });

  test('an element of a list that has no value stays, element by element', () => {
    const ce = engineWith();
    expect(ce.box(['h', ['List', 'm', 1]]).evaluate().json).toEqual([
      'List',
      ['h', 'm'],
      2,
    ]);
  });

  test('an argument declared with a wider type stays', () => {
    const ce = engineWith();
    ce.declare('z', 'real');
    expect(ce.box(['h', 'z']).evaluate().json).toEqual(['h', 'z']);
  });

  test('an expression over a symbol with no declared type stays', () => {
    const ce = engineWith();
    expect(ce.box(['h', ['Add', 'm', 1]]).evaluate().json).toEqual([
      'h',
      ['Add', 'm', 1],
    ]);
  });

  test('a symbol with no declared type at a string parameter stays', () => {
    const ce = engineWith('(string) -> string', ['Function', 's', 's']);
    expect(ce.box(['h', 'q']).evaluate().json).toEqual(['h', 'q']);
  });

  test.each([
    ['a sum with a complex term', ['Add', 'x', ['Complex', 0, 1]]],
    ['a root that can be complex', ['Sqrt', 'x']],
  ])('%s stays at a real parameter', (_label, argument) => {
    const ce = engineWith('(real) -> real', [
      'Function',
      ['Power', 'k', 2],
      'k',
    ]);
    expect(ce.box(['h', argument as any]).evaluate().operator).toBe('h');
  });

  test('a symbol with no declared type in a sum at a real parameter stays', () => {
    const ce = engineWith('(real) -> real', [
      'Function',
      ['Power', 'k', 2],
      'k',
    ]);
    expect(ce.box(['h', ['Add', 'x', 1]]).evaluate().operator).toBe('h');
    // The derivative still reads the body.
    expect(ce.box(['D', ['h', ['Add', 'x', 1]], 'x']).evaluate().json).toEqual([
      'Add',
      ['Multiply', 2, 'x'],
      2,
    ]);
  });

  test('a symbol of the caller is read through its own binding, not a parameter of the same name', () => {
    const ce = engineWith();
    // The parameter `m` of `w` is declared `integer`. The argument `m` of the
    // call of `w` is the symbol of the caller, whose type is only inferred.
    ce.assign(
      'w',
      ce.box(['Function', ['h', 'm'], ['Typed', 'm', "'integer'"]])
    );
    const held = ce.box(['w', 'm']).evaluate();
    ce.assign('m', 1.5);
    expect(errorCode(held.evaluate().json)).toBe(INCOMPATIBLE);
  });
});

describe('the body is applied when the type of the argument decides', () => {
  test('an argument declared with the type of the parameter', () => {
    const ce = engineWith();
    ce.declare('n', 'integer');
    expect(ce.box(['h', 'n']).evaluate().json).toEqual(['Multiply', 2, 'n']);
    expect(ce.box(['h', ['Add', 'n', 1]]).evaluate().json).toEqual([
      'Multiply',
      2,
      ['Add', 'n', 1],
    ]);
  });

  test('a symbol with no declared type at a real parameter', () => {
    const ce = engineWith('(real) -> real', [
      'Function',
      ['Power', 'k', 2],
      'k',
    ]);
    expect(ce.box(['h', 'x']).evaluate().json).toEqual(['Power', 'x', 2]);
    expect(ce.box(['D', ['h', 'x'], 'x']).evaluate().json).toEqual([
      'Multiply',
      2,
      'x',
    ]);
  });

  test('a map of a declared broadcastable parameter applies the body', () => {
    const ce = engineWith('(integer, broadcastable<real>) -> real', [
      'Function',
      ['Multiply', 'a', 'b'],
      'a',
      'b',
    ]);
    expect(ce.box(['h', 'm', ['List', 1, 2]]).evaluate().operator).toBe('List');
    // A lazy collection beside the map has a value, and maps too.
    expect(
      ce
        .box(['h', ['Range', 1, 2], ['List', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('[3,8]');
  });

  test('a length error among mapped arguments is not lost', () => {
    const ce = engineWith(
      '(integer, broadcastable<real>, broadcastable<real>) -> real',
      ['Function', ['Add', 'a', 'b', 'c'], 'a', 'b', 'c']
    );
    ce.declare('A', 'list<real>');
    ce.declare('B', 'list<real>');
    const call = ce.box(['h', 'm', 'A', 'B']);
    ce.assign('A', ce.box(['List', 1, 2]));
    ce.assign('B', ce.box(['List', 1, 2, 3]));
    expect(errorCode(call.evaluate().json)).toBe("'incompatible-dimensions'");
  });

  test('a declared real expression at a real parameter', () => {
    const ce = engineWith('(real) -> real', [
      'Function',
      ['Power', 'k', 2],
      'k',
    ]);
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    expect(ce.box(['h', ['Add', 'a', 'b']]).evaluate().json).toEqual([
      'Power',
      ['Add', 'a', 'b'],
      2,
    ]);
  });

  test('a symbol with no declared type at a number parameter', () => {
    const ce = engineWith('(number) -> number', [
      'Function',
      ['Power', 'k', 3],
      'k',
    ]);
    expect(ce.box(['h', 'x']).evaluate().json).toEqual(['Power', 'x', 3]);
  });

  test('a predicate at a boolean parameter', () => {
    const ce = engineWith('(boolean) -> integer', [
      'Function',
      ['If', 'b', 1, 2],
      'b',
    ]);
    expect(ce.box(['h', ['Greater', 'x', 0]]).evaluate().operator).toBe('If');
  });

  test('a concrete value', () => {
    const ce = engineWith();
    expect(ce.box(['h', 3]).evaluate().json).toBe(6);
    expect(errorCode(ce.box(['h', 1.5]).evaluate().json)).toBe(INCOMPATIBLE);
  });

  test('a function with no declared signature', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Multiply', 2, 'k'], 'k']));
    expect(ce.box(['h', 'm']).evaluate().json).toEqual(['Multiply', 2, 'm']);
  });
});
