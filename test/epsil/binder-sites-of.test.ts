import {
  ComputeEngine,
  binderSitesOf,
  parseEpsil,
  type BinderSite,
} from '../../src/epsil';

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
