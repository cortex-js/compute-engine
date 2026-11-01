import { ComputeEngine } from '../../src/compute-engine';

// The elements of a collection, computed and printed, or the value printed.
function elements(x: any): string {
  return x.isCollection
    ? `[${[...x.each()].map((e: any) => elements(e)).join(',')}]`
    : x.toString();
}

// A lazy `Map` in the body of a callback, or of a function, is one
// expression for every application. Under `.N()`, its callback is rewrapped
// with the numeric marker (`lazyMapNumericApproximation`), and the rewrap
// was kept for that expression. A rewrap that reads a parameter of the
// enclosing callback, or a local of a `Block`, was made for one
// application, and the later applications read it: every row was the first
// row.
describe('a nested lazy Map under N() reads the values of each application', () => {
  const nested = [
    'Map',
    [
      'Function',
      ['Map', ['Function', ['Add', 'k', 'j'], 'j'], ['List', 10, 20]],
      'k',
    ],
    ['List', 1, 2, 3],
  ];
  const inFunction = [
    'Block',
    ['Declare', 'c', { str: 'real' }, 5],
    [
      'DefineFunction',
      'g',
      [
        'Function',
        ['Map', ['Function', ['Add', 'c', 'k', 'j'], 'j'], ['List', 10]],
        'k',
      ],
    ],
    ['Map', ['Function', ['g', 'k'], 'k'], ['List', 1, 2]],
  ];
  // The callback of the inner `Map` calls a parameter of the function, a
  // name that `.symbols` leaves out: the second application read the
  // callback of the first one, `h(10)`.
  const callsParameter = [
    'Block',
    [
      'DefineFunction',
      'f',
      ['Function', ['Map', ['Function', ['h', 'j'], 'j'], ['List', 10]], 'h'],
    ],
    [
      'List',
      ['f', ['Function', ['Add', 'x', 1], 'x']],
      ['f', ['Function', ['Multiply', 2, 'x'], 'x']],
    ],
  ];
  const options = { numericApproximation: true };

  test.each([
    ['a Map in the callback of a Map', nested, '[[11,21],[12,22],[13,23]]'],
    ['a Map in a function that a block defines', inFunction, '[[16],[17]]'],
    [
      'a Map that calls a parameter of a function',
      callsParameter,
      '[[11],[20]]',
    ],
  ])('%s', async (_name, program, expected) => {
    const ce = new ComputeEngine();
    const e = ce.box(program as any);
    expect([
      elements(e.evaluate()),
      elements(e.evaluate(options)),
      elements(e.N()),
      elements(e.evaluate().N()),
      elements(await e.evaluateAsync()),
      elements(await e.evaluateAsync(options)),
    ]).toEqual(Array(6).fill(expected));
  });
});
