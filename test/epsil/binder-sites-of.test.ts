import {
  ComputeEngine,
  binderSitesOf,
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

  // The engine reads the value of a name that the program binds. When that
  // name is the first candidate and others follow, the variable depends on
  // that value, so the limit binds no name and its names keep their outer
  // bindings.
  test.each([
    // The engine binds `t`: `L` is a list.
    ['let L = [1, 2]\nlimit(total(L)*t, 0)', 'L'],
    // The engine binds `a`: its value is a number.
    ['let a = 5\nlimit(a*h, 0)', 'a'],
  ])('in %j the limit binds no name', (source, name) => {
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
