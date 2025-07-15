import { ComputeEngine } from '../../src/compute-engine';

import { engine } from '../utils';

const ce: ComputeEngine = engine;

describe('DECLARING', () => {
  beforeAll(() => {
    ce.pushScope();
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Declare a variable with a type', () => {
    ce.declare('a', { type: 'number' });
    expect(ce.box('a').type.toString()).toEqual('number');
  });

  test('Declare a variable with value', () => {
    ce.declare('b', { value: 5 });
    expect(ce.box('b').type.toString()).toEqual('integer');
    expect(ce.box('b').valueOf()).toEqual(5);
  });

  test('Declare a variable with value and type', () => {
    ce.declare('c', { type: 'number', value: 5 });
    expect(ce.box('c').type.toString()).toEqual('number');
    expect(ce.box('c').valueOf()).toEqual(5);
  });

  test("Can't declare twice in same scope", () => {
    ce.declare('d', { type: 'number' });

    expect(() => ce.declare('d', { type: 'boolean' })).toThrow(
      `The symbol "d" is already declared`
    );
  });

  test('Declare a variable and widen type', () => {
    ce.declare('g', { value: 5 }); // Inferred as finite_integer
    expect(ce.box('g').type.toString()).toEqual('integer');
    ce.assign('g', 5.5);
    expect(ce.box('g').type.toString()).toEqual('real');
  });

  // test('Default value of declared variables', () => {
  //   ce.declare('d', { value: 42 });
  //   expect(ce.box('d').value).toEqual(42);
  // });
});

describe('CONSTANTS', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('c', { type: 'number', value: 5, isConstant: true });
    ce.declare('d', { type: 'number', isConstant: true }); // Constant without value
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Access constant', () => {
    expect(ce.box('c').valueOf()).toEqual(5);
  });
  test('Access constant without value', () => {
    expect(ce.box('d').value?.toString()).toBeUndefined();
    expect(ce.box('d').type.toString()).toEqual('number');
  });
  test("Constants can't be changed", () => {
    expect(() => (ce.box('c').value = 0)).toThrow(
      `The value of the constant "c" cannot be changed`
    );
  });
  test('Access value-less constants', () => {
    // The value of a value-less constant is undefined
    expect(ce.box('True').value).toBeUndefined();
    expect(ce.box('q').value).toBeUndefined();
  });
});

describe('VARIABLES IN NESTED SCOPES', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 5 });
  });
  afterAll(() => {
    ce.popScope();
  });

  test('Access global from inner scope', () => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 10 });
    expect(ce.box('var1').valueOf()).toEqual(10);
    ce.popScope();
  });

  test('Change local in inner scope', () => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 10 });
    ce.box('var1').value = 20;
    expect(ce.box('var1').valueOf()).toEqual(20);
    ce.popScope();
  });
});

// Although the compute engine uses lexical scoping, we can simulate dynamic
// scoping by using the `Symbol` operator.
describe('DYNAMIC SCOPING', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 5 });
    ce.declare('f', 'function');
    ce.declare('g', 'function');
    // 'f' is lexically scoped, 'g' is dynamically scoped
    ce.assign('f', ce.function('Function', [['Block', 'var1']]));
    ce.assign('g', ce.function('Function', [['Symbol', 'var1']]));
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Lexical scoping', () => {
    expect(
      ce
        .function('Block', [
          ['Declare', 'var1', 'number'],
          ['Assign', 'var1', 10],
          ['f'],
        ])
        .evaluate()
        .valueOf()
    ).toMatchInlineSnapshot(`10`); // 5
  });
  test('Dynamic scoping', () => {
    expect(
      ce
        .function('Block', [
          ['Declare', 'var1', 'number'],
          ['Assign', 'var1', 10],
          ['g'],
        ])
        .evaluate()
        .valueOf()
    ).toMatchInlineSnapshot(`10`); // 10
  });
});

describe('FUNCTIONS WITH ARGUMENTS AND LOCAL VARIABLES', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('f', { type: '(number) -> number' });
    ce.declare('x', { type: 'number', value: 5 });
    ce.assign('f', ce.box(['Function', ['Multiply', 'x', 2], 'x']));
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Calling function with arguments', () => {
    expect(ce.box(['f', 15]).evaluate().valueOf()).toEqual(30);
    expect(ce.box('x').evaluate().valueOf()).toEqual(5);
  });
});

describe('FUNCTIONS WITH CONFLICTING ARGUMENTS AND LOCAL VARIABLES', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('f', { type: '(number) -> number' });
    ce.declare('x', { type: 'number', value: 5 });
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Block', ['Declare', 'x'], ['Multiply', 'x', 2]],
        'x',
      ])
    );
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Calling function with conflicting arguments', () => {
    expect(() =>
      ce.box(['f', 15]).evaluate()
    ).toThrowErrorMatchingInlineSnapshot(
      `The symbol "x" is already declared in this scope`
    );
  });
});

describe('RECURSIVE FUNCTION WITH OUTER VARIABLE', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('fib', { type: '(number) -> number' });
    ce.declare('counter', { type: 'number', value: 0 });
    ce.assign(
      'fib',
      ce.box([
        'Function',
        [
          'Block',
          ['Assign', 'counter', ['Add', 'counter', 1]],
          [
            'If',
            ['Less', 'n', 2],
            'n',
            ['Add', ['fib', ['Add', 'n', -1]], ['fib', ['Add', 'n', -2]]],
          ],
        ],
        'n',
      ])
    );
  });
  afterAll(() => {
    ce.popScope();
  });

  test('Calling recursive function', () => {
    expect(ce.box(['fib', 8]).evaluate().valueOf()).toEqual(21);
    expect(ce.box('counter').evaluate().valueOf()).toEqual(67);
  });
});
