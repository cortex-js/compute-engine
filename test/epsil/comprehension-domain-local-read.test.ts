import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A use of a local of a block before the statement that declares it is a
// static error (`read-before-declaration`), also when the use is the domain
// of a comprehension, the collection of a `for` loop, or the source of a lazy
// view (`Map`, `Filter`). Such a list reads its domain when its elements are
// read, which can be after the declaration, but the rule reads the program,
// not the run: the statement that holds the use is the error. A use in the
// body of a function literal is not a use: it runs when the function is
// called.
//

function run(source: string): {
  value: unknown;
  diagnostics: [string, string][];
} {
  const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
  return {
    value: value.json,
    // The code of each diagnostic and the source text at it.
    diagnostics: diagnostics.map((d) => [
      String(d.message[3] ?? d.message[0]),
      source.slice(d.range[0], d.range[1]),
    ]),
  };
}

describe('A USE OF A LOCAL BEFORE ITS DECLARATION IS A STATIC ERROR', () => {
  test.each([
    // The domain of a comprehension, read later by `Length`, `Count`, `Sum`
    // or an index.
    ['let r = [x * 2 for x in t]', 'let n = Length(r)'],
    ['let r = [x * 2 for x in t]', 'let n = Count(r)'],
    ['let r = [x * 2 for x in t]', 'let n = Sum(r)'],
    ['let r = [x * 2 for x in t]', 'let n = r[1]'],
    // A read of the list after the declaration does not change the rule.
    ['let r = [x * 2 for x in t]', 'let n = [Length(r), r[1]]'],
    // The domain of a second clause.
    ['let n = Length([[x, y] for x in [1, 2], y in t])', 'n = n'],
    // The collection of a `for` loop.
    ['for x in t { x }', 'let n = 3'],
    // The source of a lazy view.
    ['let n = Length(Map((x) => x * 2, t))', 'n = n'],
    ['let n = Sum(Map((x) => x * 2, t))', 'n = n'],
    ['let n = Map((x) => x * 2, t)[1]', 'n = n'],
    ['let n = Count(Filter(t, (x) => x > 0))', 'n = n'],
    ['let r = Map((x) => x * 2, t)', 'let n = Length(r)'],
    // The initializer of a `let`.
    ['let z = t', 'let n = z'],
  ])('`%s`, then `let t = [1]`', (use, read) => {
    const source = `function f() { ${use}; ${read}; let t = [1]; n }\nf()`;
    // The diagnostic has the range of the name that is read.
    expect(run(source).diagnostics).toEqual([['read-before-declaration', 't']]);
  });

  test('an assignment in a `do` block of a `let` initializer', () => {
    // `let t = 2` at the own level of the function body declares `t`. The
    // assignment in the `do` block, before it, is a use of that local.
    const source = 'function g() { let z = do { t = 1 }; let t = 2; t }\ng()';
    expect(run(source).diagnostics).toEqual([['read-before-declaration', 't']]);
  });
});

describe('A USE AFTER THE DECLARATION, OR IN A FUNCTION LITERAL', () => {
  test.each([
    ['let t = [1]', 'let r = [x * 2 for x in t]'],
    ['let t = [1]', 'let r = Map((x) => x * 2, t)'],
  ])('`%s` then `%s`', (declaration, use) => {
    const source = `function f() { ${declaration}; ${use}; [Length(r), r[1]] }\nf()`;
    expect(run(source)).toEqual({ value: ['List', 1, 2], diagnostics: [] });
  });

  test('a comprehension in the body of a function literal', () => {
    const source =
      'function f() { let r = () => [x * 2 for x in t]; let t = [1]; Length(r()) }\nf()';
    expect(run(source)).toEqual({ value: 1, diagnostics: [] });
  });
});
