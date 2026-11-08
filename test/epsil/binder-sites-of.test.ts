import {
  ComputeEngine,
  binderSitesOf,
  executeEpsil,
  parseEpsil,
  type BinderSite,
} from '../../src/epsil';
import { documentBindings } from '../../src/epsil/occurrences';

// `binderSitesOf` is exported from the Epsil entry so that a host can tell
// which names of a library call are the call's own variables and which ones
// the call reads from outside, with the engine's rules instead of a copy.

const ce = new ComputeEngine();

/** The sites of the call that the one-statement program `source` is. */
function sitesOf(source: string): readonly BinderSite[] | undefined {
  const [call] = parseEpsil(source);
  return binderSitesOf(ce, call, source);
}

describe('binderSitesOf from the Epsil entry', () => {
  test('a sum binds its index in the body and the bounds', () => {
    expect(sitesOf('sum(k^2, k, 1, n)')).toEqual([
      { name: 'k', operands: [0, 1, 2, 3] },
    ]);
  });

  test('a sum whose upper bound is a name it does not bind reads that name', () => {
    // `n1` occurs once, as the upper bound, so the call reads it from outside.
    const sites = sitesOf('sum(k, k, 1, n1)') ?? [];
    expect(sites.map((site) => site.name)).toEqual(['k']);
  });

  test('a limit that writes its variable binds it in the whole call', () => {
    expect(sitesOf('limit(sin(h)/h, h, 0)')).toEqual([
      { name: 'h', operands: 'all' },
    ]);
  });

  // The engine chooses the variable of a limit that does not write it: the
  // first, in sorted order, of the names that the first operand reads from
  // outside (`canonicalImplicitLimitFunction()`). The variable is visible in
  // the first operand only, so a point with the same name reads it from
  // outside.
  test.each([
    ['limit(sin(h)/h, 0)', 'h'],
    ['limit(sin(h)/h, 0, 1)', 'h'],
    ['nLimit(sin(h)/h, 0)', 'h'],
    ['nd(h^3, 1)', 'h'],
    ['nIntegrate(sqrt(h), 0, 1)', 'h'],
    ['limit(sin(h)/h, h)', 'h'],
    // `y` comes first in sorted order; `z` is read from outside.
    ['limit(y*z, 0)', 'y'],
    // `pi` is the constant `Pi`, never a variable.
    ['limit(x*pi, 0)', 'x'],
    // The index of the sum is bound inside the operand.
    ['limit(sum(k*h, k, 1, 3), 0)', 'h'],
    // A variable with the name of an operator is an unknown of the body, as
    // in the engine: `limit(N + h, 1)` gives `1 + h`.
    ['limit(N + h, 1)', 'N'],
    ['limit((1 + 1/N)^N, infinity)', 'N'],
    // The verbatim `pi` is the raw symbol `pi`, not the constant `Pi`.
    ['limit(`pi`*x, 0)', 'pi'],
    // The pipe binds the `_`, so the operand has no free slot.
    ['limit(h + (1 |> _^2), 0)', 'h'],
  ])('%s binds its implicit variable %s in its first operand', (source, name) => {
    expect(sitesOf(source)).toEqual([{ name, operands: [0] }]);
  });

  test.each([
    // A bare symbol names a function.
    'limit(h, 0)',
    // A function literal names its own parameter.
    'limit((x) => sin(x)/x, 0)',
    // An anonymous slot names the parameter.
    'limit(_ + 1, 0)',
    // No name is read from outside.
    'limit(2*pi, 0)',
    // The engine binds the verbatim `pi` only. A site would bind the plain
    // `pi` too, which must stay free to become `Pi`.
    'limit(pi + `pi`*x, 0)',
  ])('%s binds no implicit variable', (source) => {
    expect(sitesOf(source)).toEqual([]);
  });

  test('the implicit variable of a limit is not the outer name in a rename', () => {
    // The program gives 1: the limit binds `h`, and `let h = 5` does not
    // reach `sin(h)/h`. A rename of the `let h` changes only its own name.
    // `h` is the one candidate, so the value of the outer `h` does not
    // change the choice.
    const source = 'let h = 5\nlimit(sin(h)/h, 0)';
    const [ast] = parseEpsil(source);
    const groups = documentBindings(ast, source, {
      binderSites: (node, isBound) =>
        binderSitesOf(ce, node, source, undefined, isBound),
    });
    const starts = groups
      .filter((group) => group.name === 'h')
      .map((group) => group.occurrences.map((occurrence) => occurrence.start));
    expect(starts).toEqual([[4], [20, 23]]);
  });

  // The engine reads the value of a name that the program binds. A host that
  // gives `isBound` but not the declarations of the program does not know
  // that value. When that name is the first candidate and others follow, the
  // variable depends on that value, so the limit binds no name and its names
  // keep their outer bindings.
  test.each([
    // The engine binds `t`: `L` is a list.
    ['let L = [1, 2]\nlimit(total(L)*t, 0)', 'L'],
    // The engine binds `a`: its value is a number.
    ['let a = 5\nlimit(a*h, 0)', 'a'],
  ])('without the declarations, in %j the limit binds no name', (source, name) => {
    const [ast] = parseEpsil(source);
    const groups = documentBindings(ast, source, {
      binderSites: (node, isBound) =>
        binderSitesOf(ce, node, source, undefined, isBound),
    });
    const declared = groups.find(
      (group) => group.name === name && group.kind === 'variable'
    );
    expect(declared?.occurrences.length).toBe(2);
    expect(groups.some((group) => group.kind === 'parameter')).toBe(false);
  });

  /** The sites of the last `limit` call of `source`, with the bindings and
   * the declarations of the program, as the language server reads them. */
  function limitSitesOf(source: string): readonly BinderSite[] | undefined {
    const [ast] = parseEpsil(source);
    let result: readonly BinderSite[] | undefined;
    documentBindings(ast, source, {
      binderSites: (node, isBound, declarationOf) => {
        const sites = binderSitesOf(
          ce,
          node,
          source,
          undefined,
          isBound,
          declarationOf
        );
        if ((node as { fn?: unknown[] }).fn?.[0] === 'limit') result = sites;
        return sites;
      },
    });
    return result;
  }

  /** The value of the program `source`, on an engine of its own. */
  function valueOf(source: string): string {
    return executeEpsil(new ComputeEngine(), source).value.toString();
  }

  // With the declarations of the program, a `let` with a literal initializer
  // and a `const` at the top level give the variable that the engine
  // chooses. Each value shows the choice of the engine: in `h + 1` the
  // engine bound the outer name (`a`) and kept `h`.
  test.each([
    // `a` is a number: the engine binds it.
    ['let a = 5\nlimit(a + h, 1)', 'a', 'h + 1'],
    ['let a = -5\nlimit(a + h, 1)', 'a', 'h + 1'],
    ['let a = 1/2\nlimit(a + h, 1)', 'a', 'h + 1'],
    // `L` is a list and `s` a string: the engine binds `t`.
    ['let L = [1, 2]\nlimit(total(L)*t, 1)', 't', 'total([1,2])'],
    ['let s = "ab"\nlimit(length(s)*t, 1)', 't', '2'],
    // A `const` is not a candidate: the engine binds `h`.
    ['const a = 5\nlimit(a + h, 1)', 'h', '6'],
    // The one candidate is a number: the engine binds it.
    ['let h = 5\nlimit(sin(h)/h, 0)', 'h', '1'],
    // The statement has run: the engine reads the value, whatever the
    // annotation.
    ['let a: any = 5\nlimit(a + h, 1)', 'a', 'h + 1'],
    ['let L: any = [1, 2]\nlimit(total(L)*t, 1)', 't', 'total([1,2])'],
    // `e` is the variable of the program, not the constant `ExponentialE`.
    ['let e = 5\nlimit(e + t, 1)', 'e', 't + 1'],
    // No statement above the `function` statement calls `g`: its body is
    // boxed after the `const` runs.
    ['const a = 5\nfunction g() { limit(a + h, 1) }\ng()', 'h', '6'],
    // Only a function statement above `g` names it: the runner boxes `g` at
    // its turn.
    [
      'const a = 5\nfunction f() { g() }\nfunction g() { limit(a + h, 1) }\ng()',
      'h',
      '6',
    ],
    // `g` is called above its `function` statement: a list is not a
    // candidate, whether the body is boxed early or not.
    [
      'const L = [1, 2]\nlet r = g()\nfunction g() { limit(total(L)*t, 1) }\nr',
      't',
      'total([1,2])',
    ],
  ])('in %j the limit binds %s', (source, name, value) => {
    expect(limitSitesOf(source)).toEqual([{ name, operands: [0] }]);
    expect(valueOf(source)).toBe(value);
  });

  test.each([
    // A list is not a candidate: the engine binds no name, and the `L` of
    // the limit reads the outer `L`.
    ['let L = [1, 2]\nlimit(total(L), 0)', 'total([1,2])'],
    // A `const` is not a candidate.
    ['const h = 5\nlimit(sin(h)/h, 0)', '1/5 * sin(5)'],
    ['const h = 5\nfunction g() { limit(sin(h)/h, 0) }\ng()', '1/5 * sin(5)'],
  ])('in %j the limit binds no name', (source, value) => {
    expect(limitSitesOf(source)).toEqual([]);
    expect(valueOf(source)).toBe(value);
  });

  test('a rename of a `let` does not change the variable of a limit', () => {
    // The engine binds the `a` of the limit, so it is not in the group of
    // the `let a`.
    const source = 'let a = 5\nlimit(a + h, 1)';
    const [ast] = parseEpsil(source);
    const groups = documentBindings(ast, source, {
      binderSites: (node, isBound, declarationOf) =>
        binderSitesOf(ce, node, source, undefined, isBound, declarationOf),
    });
    const starts = groups
      .filter((group) => group.name === 'a')
      .map((group) => group.occurrences.map((occurrence) => occurrence.start));
    expect(starts).toEqual([[4], [16]]);
  });

  // When the declaration does not tell whether the engine can choose a name,
  // the rule is the one without the declarations: no site when other
  // candidates follow, and the name when it is the one candidate.
  test.each([
    // Another statement writes the name: its value is a list at the call.
    ['let a = 5\na = [1, 2]\nlimit(total(a) + h, 1)', []],
    ['let a = 5\na += 1\nlimit(a + h, 1)', []],
    // The initializer is not a literal.
    ['let b = 5\nlet a = b\nlimit(a + h, 1)', []],
    // A parameter has no declaration that the program fixes.
    ['function f(a) { limit(a + h, 1) }', []],
    // A `let` in a function body is not at the top level of the program.
    ['function f() {\n let L = [1, 2]\n limit(total(L), 1) }', ['L']],
    // `g` is called above its `function` statement: the runner boxes its
    // body before the `let` runs, and `L` is then a variable of the declared
    // type `any`.
    [
      'let L: any = [1, 2]\nlet r = g()\nfunction g() { limit(total(L) + h, 1) }',
      [],
    ],
    // A `const` whose initializer is a number, in a function that a
    // statement above calls: the runner prepares `f` through `g` in the
    // first program, and does not prepare a function after a `type`
    // statement in the second. The analysis does not tell the two apart, so
    // it does not decide.
    [
      'const a = 5\nlet r = g()\nfunction g() { f() }\nfunction f() { limit(a + h, 1) }',
      [],
    ],
    [
      'const a = 5\nlet r = g()\ntype T = integer\nfunction g() { limit(a + h, 1) }',
      [],
    ],
  ])('in %j the declaration does not tell', (source, names) => {
    expect(limitSitesOf(source)).toEqual(
      names.map((name) => ({ name, operands: [0] }))
    );
  });

  test('the engine values of the programs whose declaration does not tell', () => {
    // These values show that each choice depends on more than the
    // declaration: `a` is a list at the call, and `L` is a variable when
    // the body is boxed.
    expect(valueOf('let a = 5\na = [1, 2]\nlimit(total(a) + h, 1)')).toBe(
      '1 + total([1,2])'
    );
    expect(
      valueOf('function f() {\n let L = [1, 2]\n limit(total(L), 1) }\nf()')
    ).toBe('total(1)');
    expect(
      valueOf(
        'let L: any = [1, 2]\nlet r = g()\nfunction g() { limit(total(L) + h, 1) }\nr'
      )
    ).toBe('h + total(1)');
  });

  test('a `const` in a function body boxed early is a variable', () => {
    // `g` is called above its `function` statement, so the runner boxes its
    // body before the `const` runs: the engine binds `h`, the one candidate.
    // The analysis does not decide, and gives the one candidate.
    const source =
      'const h = 5\nlet r = g()\nfunction g() { limit(sin(h)/h, 0) }\nr';
    expect(limitSitesOf(source)).toEqual([{ name: 'h', operands: [0] }]);
    expect(valueOf(source)).toBe('1');
    // A nested `function f` in the body of `g` names the top-level `f`, as
    // the runner reads it: the runner prepares `f`, and the engine binds `a`.
    const nested =
      'const a = 5\nlet r = g()\nfunction g() { function f() { 1 }\n 2 }\nfunction f() { h + limit(sin(a)/a, 0) }\nf()';
    expect(limitSitesOf(nested)).toEqual([{ name: 'a', operands: [0] }]);
    expect(valueOf(nested)).toBe('h + 1');
  });

  /** The sites of the last call of `source`, with the bindings of the
   * program, as the language server reads them. */
  function programSitesOf(
    source: string,
    head: string
  ): readonly BinderSite[] | undefined {
    const [ast] = parseEpsil(source);
    let result: readonly BinderSite[] | undefined;
    documentBindings(ast, source, {
      binderSites: (node, isBound) => {
        const sites = binderSitesOf(ce, node, source, undefined, isBound);
        if ((node as { fn?: unknown[] }).fn?.[0] === head) result = sites;
        return sites;
      },
    });
    return result;
  }

  test('a name the program binds is not a spelling of the library', () => {
    // With `let pi = 5`, `pi` is the first candidate, not the constant `Pi`;
    // the engine binds it only if its value is a number, so no site.
    expect(programSitesOf('let pi = 5\nlimit(pi*z, 0)', 'limit')).toEqual([]);
  });

  test('a call whose callee the program binds binds no index', () => {
    // The `sum` in the limit is the user's function, so `k` is read from
    // outside and is the first candidate (it is not bound by the program).
    const source =
      'function sum(a, b, c, d) { a }\nlimit(sum(k*z, k, 1, 3) + z, 0)';
    expect(programSitesOf(source, 'limit')).toEqual([
      { name: 'k', operands: [0] },
    ]);
  });

  test('nested calls with an implicit variable are walked once each', () => {
    // A walk for each enclosing call doubled the work at each level, and
    // 40 levels did not end. The outer call binds no name: the inner call
    // binds `h`, so the outer operand reads no name from outside.
    let source = 'h^3';
    for (let i = 0; i < 40; i++) source = `nd(${source}, 1)`;
    expect(sitesOf(source)).toEqual([]);
  });

  test('an integral binds its variable', () => {
    expect(sitesOf('integrate(x^2, x)')).toEqual([
      { name: 'x', operands: [0, 1] },
    ]);
  });

  test('a library operator that takes no variable binds nothing', () => {
    expect(sitesOf('max(pi, pi)')).toEqual([]);
  });

  test('a call of a name that is not a library operator gives undefined', () => {
    expect(sitesOf('foo(k, k)')).toBeUndefined();
  });
});
