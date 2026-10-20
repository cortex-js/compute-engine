import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A local of a function body that is read before its first assignment is
// the `read-before-declaration` error. A comprehension reads the domains of
// its clauses when its elements are read, not where it is written:
//
// - a read of the list before the local is assigned gives the error, and
//   the error is the value of the whole list (`Length`, `Count`, `Sum`, an
//   element), not its only element;
// - a read of the list after the assignment reads the assigned value.
//
// The static check does not report a read in the domain of a comprehension
// (`collectReads()`, `src/epsil/read-before-assignment.ts`): it cannot know
// when the list is read.
//

function run(source: string): { value: unknown; diagnostics: string[] } {
  const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
  return {
    value: value.json,
    diagnostics: diagnostics.map((d) => d.message.map(String).join(' ')),
  };
}

const READ_BEFORE_T = [
  'Error',
  ['ErrorCode', "'read-before-declaration'", "'t'", "'assignment'"],
];

describe('A COMPREHENSION OVER A LOCAL READ BEFORE ITS ASSIGNMENT', () => {
  test.each([
    ['Length', 'n = Length(r)'],
    ['Count', 'n = Count(r)'],
    ['Sum', 'n = Sum(r)'],
    ['an element', 'n = r[1]'],
  ])('%s of the list is the error', (_name, read) => {
    const source = `function f() { r = [x * 2 for x in t]; ${read}; t = [1]; n }\nf()`;
    expect(run(source)).toEqual({ value: READ_BEFORE_T, diagnostics: [] });
  });

  test('a second clause over the local', () => {
    const source =
      'function f() { n = Length([[x, y] for x in [1, 2], y in t]); t = [1]; n }\nf()';
    expect(run(source)).toEqual({ value: READ_BEFORE_T, diagnostics: [] });
  });

  test('a read of the list after the assignment reads the assigned value', () => {
    const source =
      'function f() { r = [x * 2 for x in t]; t = [1]; [Length(r), r[1]] }\nf()';
    expect(run(source)).toEqual({ value: ['List', 1, 2], diagnostics: [] });
  });

  test('a `for` loop over the local stops with the error', () => {
    const source = 'function f() { for x in t { x }; t = [1]; 3 }\nf()';
    const { value, diagnostics } = run(source);
    expect(value).toEqual(READ_BEFORE_T);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('read-before-declaration');
  });
});

describe('AN ASSIGNMENT IN THE INITIALIZER OF A `let`', () => {
  // The initializer of a `let` is in the attributes dictionary of the
  // `Declare` statement. An assignment there is the first assignment of
  // the local, so a later read is not reported.
  test('a `do` block that assigns the local', () => {
    const source = 'function g() { let z = do { t = 1 }; t = t + 1; t }\ng()';
    expect(run(source)).toEqual({ value: 2, diagnostics: [] });
  });

  test('a read in the initializer is still reported', () => {
    const source = 'function g() { let z = t; t = 1; t }\ng()';
    const { value, diagnostics } = run(source);
    expect(value).toEqual(READ_BEFORE_T);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('read-before-declaration');
  });
});

describe('A LAZY VIEW OVER A LOCAL READ BEFORE ITS ASSIGNMENT', () => {
  // A lazy view (`Map`, `Filter`) holds its source and reads it when its
  // elements are read. A read before the local is assigned gives the error,
  // and the error is the value of the view. Before, `Length` stayed
  // unevaluated, and the read of `n` after the assignment gave `1`.
  test.each([
    ['Length of a Map', 'n = Length(Map((x) => x * 2, t))'],
    ['Sum of a Map', 'n = Sum(Map((x) => x * 2, t))'],
    ['an element of a Map', 'n = Map((x) => x * 2, t)[1]'],
    ['Count of a Filter', 'n = Count(Filter(t, (x) => x > 0))'],
    ['a Map held by a local', 'r = Map((x) => x * 2, t); n = Length(r)'],
  ])('%s', (_name, read) => {
    const source = `function f() { ${read}; t = [1]; n }\nf()`;
    expect(run(source)).toEqual({ value: READ_BEFORE_T, diagnostics: [] });
  });

  test('a read of the view after the assignment reads the assigned value', () => {
    const source =
      'function f() { r = Map((x) => x * 2, t); t = [1]; [Length(r), r[1]] }\nf()';
    expect(run(source)).toEqual({ value: ['List', 1, 2], diagnostics: [] });
  });
});
