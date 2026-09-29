/**
 * Tycho item 331: a spread of a function parameter inside a list literal in
 * the function's body.
 *
 * `g(a) = [...a, 0]` canonicalizes its body to `Join(a, [0])`. The list
 * literal built that `Join` without validating it against `Join`'s
 * signature, so the parameter `a` got no use-site type evidence and stayed
 * `unknown`. A function whose parameter is `unknown` auto-broadcasts over a
 * list argument, so `g([9])` was evaluated as `[g(9)]` = `[[9, 0]]` instead
 * of `[9, 0]`. A reducer `h(a, x) = [...a, x]` with the empty list as its
 * initial value broadcast over that empty list and returned `[]` at every
 * step.
 *
 * The `Join` is now built through its canonical handler, which infers the
 * parameter as `collection<any>` (as the body `Join(a, [0])` written by hand
 * already did). The set literal `{...a, 0}` had the same defect.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

function epsil(source: string): string {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return JSON.stringify(r.value?.json);
}

describe('Spread of a parameter in a function body (Tycho item 331)', () => {
  test('Epsil: expression-body function', () => {
    expect(epsil('g(a) = [...a, 0]\ng([9])')).toBe('["List",9,0]');
  });

  test('Epsil: block-body function', () => {
    expect(epsil('function g(a) { [...a, 0] }\ng([9])')).toBe(
      '["List",9,0]'
    );
  });

  test('Epsil: same result as the spread at the top level', () => {
    expect(epsil('let top = [9]\n[...top, 0]')).toBe('["List",9,0]');
  });

  test('Epsil: reduce with a named spreading reducer', () => {
    expect(
      epsil(
        'h(a, x) = [...a, x]\nreduce([1, 2, 3], (a, x) => h(a, x), [])'
      )
    ).toBe('["List",1,2,3]');
  });

  test('Epsil: two spread parameters', () => {
    expect(epsil('g(a, b) = [...a, ...b]\ng([1, 2], [3])')).toBe(
      '["List",1,2,3]'
    );
  });

  test('Epsil: spread of a call that returns a list', () => {
    expect(epsil('f(n) = [n, n]\ng(n) = [...f(n), 1]\ng(4)')).toBe(
      '["List",4,4,1]'
    );
  });

  test('Epsil: a scalar argument is still one element', () => {
    expect(epsil('g(a) = [...a, 0]\ng(5)')).toBe('["List",5,0]');
  });

  test('Epsil: set literal with a spread parameter', () => {
    expect(epsil('g(a) = {...a, 0}\ng([9, 9])')).toBe('["Set",9,0]');
  });

  test('box route: the parameter is inferred as a collection', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(['Function', ['List', ['Spread', 'a'], 0], 'a']);
    expect(fn.type.toString()).toBe('(a: collection<any>) -> list<any>');
    ce.assign('g', fn);
    expect(JSON.stringify(ce.box(['g', ['List', 9]]).evaluate().json)).toBe(
      '["List",9,0]'
    );
    expect(
      JSON.stringify(ce.box(['g', ['List', 9, 8]]).evaluate().json)
    ).toBe('["List",9,8,0]');
  });

  test('box route: set literal', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Set', ['Spread', 'a'], 0], 'a']));
    expect(
      JSON.stringify(ce.box(['g', ['List', 9, 9]]).evaluate().json)
    ).toBe('["Set",9,0]');
  });

  test('ce.function and LaTeX routes', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['List', ['Spread', 'a'], 0], 'a']));
    expect(
      JSON.stringify(ce.function('g', [ce.box(['List', 9])]).evaluate().json)
    ).toBe('["List",9,0]');
    expect(JSON.stringify(ce.parse('g([9])').evaluate().json)).toBe(
      '["List",9,0]'
    );
  });

  test('Map over a list of lists applies the function to each list', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['List', ['Spread', 'a'], 0], 'a']));
    const m = ce
      .box(['Map', 'g', ['List', ['List', 1], ['List', 2, 3]]])
      .evaluate();
    expect(
      JSON.stringify([...m.each()].map((x) => x.evaluate().json))
    ).toBe('[["List",1,0],["List",2,3,0]]');
  });
});
