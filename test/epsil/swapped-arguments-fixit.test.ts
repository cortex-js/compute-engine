import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The note and the fixit of a call whose two arguments are exchanged
// (`swappedArgumentsFixit` in `src/epsil/static-diagnostics.ts`,
// `swappedArgument` in `src/epsil/signature-notes.ts`). `map` takes its
// function first and `filter` its collection first, so `map(xs, f)` and
// `filter(p, xs)` are the usual cases.
//

const NOTE = /^arguments \d and \d look exchanged$/;

/** The source with the fixit of each diagnostic applied, and the notes about
 * exchanged arguments. */
function exchanged(source: string): { fixed: string[]; notes: string[] } {
  const { diagnostics } = executeEpsil(new ComputeEngine(), source);
  const fixed: string[] = [];
  const notes: string[] = [];
  for (const d of diagnostics) {
    for (const note of d.notes ?? [])
      if (NOTE.test(note.message)) notes.push(note.message);
    for (const [start, end, value] of d.fixits ?? [])
      fixed.push(source.slice(0, start) + value + source.slice(end));
  }
  return { fixed, notes };
}

describe('EPSIL EXCHANGED ARGUMENTS', () => {
  test.each([
    ['map([1, 2, 3], x => x^2)', 'map(x => x^2, [1, 2, 3])', '1 and 2'],
    [
      'filter(x => x > 1, [1, 2, 3])',
      'filter([1, 2, 3], x => x > 1)',
      '1 and 2',
    ],
    ['filter(isPrime, 1..10)', 'filter(1..10, isPrime)', '1 and 2'],
    ['flatMap(x => [x, x], [1, 2])', 'flatMap([1, 2], x => [x, x])', '1 and 2'],
    [
      'reduce((a, b) => a + b, [1, 2, 3], 0)',
      'reduce([1, 2, 3], (a, b) => a + b, 0)',
      '1 and 2',
    ],
    [
      'fold([1, 2, 3], 0, (a, b) => a + b)',
      'fold((a, b) => a + b, 0, [1, 2, 3])',
      '1 and 3',
    ],
    // An operator with two overloads, and two arguments that both have an
    // error: one fixit, on the first argument.
    ['sort(x => -x, [3, 1, 2])', 'sort([3, 1, 2], x => -x)', '1 and 2'],
    ['take(2, [1, 2, 3])', 'take([1, 2, 3], 2)', '1 and 2'],
  ])('%s', (source, fixed, positions) => {
    expect(exchanged(source)).toEqual({
      fixed: [fixed],
      notes: [`arguments ${positions} look exchanged`],
    });
  });

  test('the corrected call has no diagnostic', () => {
    const { diagnostics, value } = executeEpsil(
      new ComputeEngine(),
      'map(x => x^2, [1, 2, 3])'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 1, 4, 9]);
  });

  test('a function and a list that are named', () => {
    const source = ['let xs = [1, 2, 3]', 'let f = x => x^2', 'map(xs, f)'];
    expect(exchanged(source.join('\n')).fixed).toEqual([
      [...source.slice(0, 2), 'map(f, xs)'].join('\n'),
    ]);
  });

  test('a function of the program', () => {
    const declaration = 'function pw(s: string, n: integer) { n }';
    expect(exchanged(`${declaration}\npw(2, "a")`).fixed).toEqual([
      `${declaration}\npw("a", 2)`,
    ]);
  });

  test('in the initializer of a declaration', () => {
    expect(exchanged('let squares = map([1, 2, 3], x => x^2)').fixed).toEqual([
      'let squares = map(x => x^2, [1, 2, 3])',
    ]);
  });

  test('the text between the two arguments is kept', () => {
    expect(exchanged('1 + map( [1, 2, 3] ,\n   x => x^2)').fixed).toEqual([
      '1 + map( x => x^2 ,\n   [1, 2, 3])',
    ]);
  });

  test.each([
    // No exchange fits the signature.
    'map([1, 2], [3, 4])',
    'map(sin, cos)',
    'sin("a")',
    // The signature of `Add` accepts each argument at each position.
    'let p = true\np + 1',
    'let q = true\nlet y = q + 1',
    // Two functions at two function parameters, one with an error.
    'function ap(f: (number) -> number, g: (string) -> string) { 1 }\nap(x => x, (b: boolean) => b)',
    'function ap(f: (number) -> number, g: (number) -> number) { 1 }\nap((x: number) => x, (b: boolean) => b)',
    // The argument that is not typed could be the one exchanged.
    'function h(a: string, b: integer, c: integer) { b }\nh(1, u, "a")',
    // A named argument: the written order is not the order of the signature.
    'function pw(s: string, n: integer) { n }\npw(n: "a", s: 2)',
  ])('no note and no fixit: %s', (source) => {
    expect(exchanged(source)).toEqual({ fixed: [], notes: [] });
  });
});
