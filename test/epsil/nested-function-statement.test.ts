import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';

//
// A `function` statement inside a function body binds its name in the call
// frame of that body: the binding is local, it shadows a same-named outer
// definition, and each call makes it again.
//
// When the name was also a constant of the library (`i`, `e`, `Pi`), the
// definition went through the scope chain to that constant and was refused:
// `function o() { function i() { 2 }; i() }` then `o()` gave
// `Error(ErrorCode("constant-assignment", "i"))`. At the top level the same
// definition worked, because the canonical handler of `DefineFunction` gives
// the name a binding in the current scope first. The runtime now does the
// same in the call frame (`declareLocalClauseTarget()`,
// `src/compute-engine/multi-clause.ts`).
//

function run(source: string) {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, source);
  return {
    json: result.value.json,
    text: result.value.toString(),
    diagnostics: result.diagnostics.map((d) => d.message),
  };
}

function check(source: string) {
  return checkSource(source).diagnostics.map((d) => d.message);
}

describe('A NESTED FUNCTION STATEMENT WITH THE NAME OF A LIBRARY CONSTANT', () => {
  test('the first call returns the value of the nested function', () => {
    const r = run(
      'function o() -> integer { function i() -> integer { 2 }; i() }\no()'
    );
    expect(r.text).toBe('2');
    expect(r.diagnostics).toEqual([]);
  });

  test('a later call works too, with no diagnostic', () => {
    const r = run('function o() { function i() { 2 }\n i() }\no()\no()');
    expect(r.text).toBe('2');
    expect(r.diagnostics).toEqual([]);
  });

  test('many calls in one expression', () => {
    const r = run('function o() { function i() { 2 }; i() }\n[o(), o(), o()]');
    expect(r.json).toEqual(['List', 2, 2, 2]);
    expect(r.diagnostics).toEqual([]);
  });

  test('the library constant keeps its value outside the body', () => {
    const r = run(
      'function o() { function i() { 2 }; i() }\n' +
        'function p() { function e() { 3 }; e() }\n' +
        '[o(), p(), i, e]'
    );
    expect(r.json).toEqual(['List', 2, 3, ['Complex', 0, 1], 'ExponentialE']);
    expect(r.diagnostics).toEqual([]);
  });

  test('`Pi` as the name of a nested function', () => {
    const r = run('function o() { function Pi() { 2 }; Pi() }\n[o(), o(), Pi]');
    expect(r.json).toEqual(['List', 2, 2, 'Pi']);
    expect(r.diagnostics).toEqual([]);
  });

  test('the static check reports nothing', () => {
    expect(
      check(
        'function o() -> integer { function i() -> integer { 2 }; i() }\no()'
      )
    ).toEqual([]);
    expect(check('function o() { function e() { 3 }; e() }\no()\no()')).toEqual(
      []
    );
  });
});

describe('RECURSION IN A NESTED FUNCTION', () => {
  test('an ordinary name', () => {
    const r = run(
      'function o(n) { function f(k) { if k <= 1 { 1 } else { k * f(k - 1) } }; f(n) }\n' +
        '[o(5), o(6)]'
    );
    expect(r.json).toEqual(['List', 120, 720]);
    expect(r.diagnostics).toEqual([]);
  });

  test('the name of a library constant', () => {
    const r = run(
      'function o(n) { function e(k) { if k <= 1 { 1 } else { k * e(k - 1) } }; e(n) }\n' +
        'o(5)\no(6)'
    );
    expect(r.text).toBe('720');
    expect(r.diagnostics).toEqual([]);
  });

  test('the static check reports nothing', () => {
    expect(
      check(
        'function o(n) { function e(k) { if k <= 1 { 1 } else { k * e(k - 1) } }; e(n) }\no(5)'
      )
    ).toEqual([]);
  });
});

describe('TWO CLAUSES OF A NESTED FUNCTION', () => {
  test('an ordinary name', () => {
    const r = run(
      'function o(n) { function g(0) { 1 }\n function g(m) { m * 10 }\n g(n) }\n' +
        '[o(3), o(0), o(4)]'
    );
    expect(r.json).toEqual(['List', 30, 1, 40]);
    expect(r.diagnostics).toEqual([]);
  });

  test('the name of a library constant', () => {
    const r = run(
      'function o(n) { function i(0) { 1 }\n function i(m) { m * 10 }\n i(n) }\n' +
        '[o(3), o(0), o(4), i]'
    );
    expect(r.json).toEqual(['List', 30, 1, 40, ['Complex', 0, 1]]);
    expect(r.diagnostics).toEqual([]);
  });

  test('the same two clauses at the top level', () => {
    const r = run(
      'function i(0) { 1 }\nfunction i(m) { m * 10 }\n[i(3), i(0)]'
    );
    expect(r.json).toEqual(['List', 30, 1]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe('A NESTED FUNCTION THAT USES A PARAMETER OF THE OUTER FUNCTION', () => {
  test('each call sees the argument of that call', () => {
    const r = run(
      'function o(a) { function g() { a + 1 }; g() }\n[o(1), o(10)]'
    );
    expect(r.json).toEqual(['List', 2, 11]);
    expect(r.diagnostics).toEqual([]);
  });

  test('as separate statements', () => {
    const first = run('function o(a) { function g() { a + 1 }; g() }\no(1)');
    expect(first.text).toBe('2');
    const second = run(
      'function o(a) { function g() { a + 1 }; g() }\no(1)\no(10)'
    );
    expect(second.text).toBe('11');
    expect(second.diagnostics).toEqual([]);
  });

  test('the name of a library constant', () => {
    const r = run(
      'function o(a) { function e() { a + 1 }; e() }\n[o(1), o(10)]'
    );
    expect(r.json).toEqual(['List', 2, 11]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe('A CONSTANT OF THE PROGRAM', () => {
  test('a top-level `function` statement cannot replace a top-level `const`', () => {
    const r = run('const k = 5\nfunction k(n) { n }\nk');
    expect(r.text).toBe('5');
    expect(r.diagnostics).toEqual([
      [
        'static-type-error',
        'invalid clause definition — "k" is a constant; it cannot be redefined',
        'function k(n) {n}',
        'invalid-clause-definition',
      ],
    ]);
  });

  test('a nested function with the name of a `const` shadows it in the body', () => {
    const r = run(
      'const k = 5\nfunction o() { function k() { 2 }; k() }\n[o(), o(), k]'
    );
    expect(r.json).toEqual(['List', 2, 2, 5]);
    expect(r.diagnostics).toEqual([]);
    expect(
      check('const k = 5\nfunction o() { function k() { 2 }; k() }\no()')
    ).toEqual([]);
  });
});
