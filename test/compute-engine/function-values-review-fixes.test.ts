/**
 * Declines of compiled code for function values and parameter defaults
 * (item 3.4.5 of the CE language release, `docs/COMPILATION-MODEL.md`,
 * "Function values"). Each case below declines, so that the host gets the
 * interpreter's value:
 *
 * - a symbol default that names a constant that the host or the program
 *   declares: the interpreter reads the default where the function is
 *   declared, and compiled code would read the name where the default is
 *   filled, where a local or a `vars` entry can hide it
 *   (`compiledSymbolDefaultDeclines()`);
 * - a full application of a function literal whose value is a function;
 * - a call that leaves out a defaulted argument and returns a function;
 * - an `Assign` whose value is a block-local function assigned more than
 *   once.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';

type Json = any;

function compiled(ce: ComputeEngine, json: Json, options: object = {}) {
  return compile(ce.box(json), {
    to: 'javascript',
    fallback: false,
    ...options,
  } as never)!;
}

describe('A default that names a constant of the host', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('W0', { isConstant: true, value: 5 } as never);
    ce.assign(
      'f',
      ce.box(['Function', ['Add', 'k', 1], ['Optional', 'k', 'W0']])
    );
    ce.assign(
      'fm',
      ce.box(['Function', ['Add', 'x', 'k'], 'x', ['Optional', 'k', 'W0']])
    );
    return ce;
  }
  const DECLINE = /constant declared by the program or the host \(`W0`\)/;

  test('a block local with the name of the default declines', () => {
    const ce = engine();
    const json = ['Block', ['Declare', 'W0', "'integer'", 7], ['f']];
    expect(ce.box(json).evaluate().toString()).toBe('6');
    expect(() => compiled(ce, json, { constantFold: false })).toThrow(DECLINE);
  });

  test('without a local of that name, the call declines', () => {
    const ce = engine();
    const json = ['Block', ['Declare', 'y', "'integer'", 7], ['f']];
    expect(ce.box(json).evaluate().toString()).toBe('6');
    expect(() => compiled(ce, json, { constantFold: false })).toThrow(DECLINE);
  });

  test('the call alone declines', () => {
    const ce = engine();
    expect(ce.box(['f']).evaluate().toString()).toBe('6');
    expect(() => compiled(ce, ['f'], { constantFold: false })).toThrow(
      DECLINE
    );
  });

  // The wrapper of a callback fills the default: with `vars` that map
  // `W0` to an input, it would read the input (`[8]` for `W0 = 7`).
  test('a callback with the default, and `vars` that map its name, declines', () => {
    const ce = engine();
    const json = ['Map', 'fm', ['List', 1]];
    expect(ce.box(json).evaluate().toString()).toBe('[6]');
    expect(() =>
      compiled(ce, json, { constantFold: false, vars: { W0: '_.W0' } })
    ).toThrow(DECLINE);
  });

  test('a block-local callback with the default, in a block with a local of its name, declines', () => {
    const ce = engine();
    const json = [
      'Block',
      [
        'Assign',
        'g',
        ['Function', ['Add', 'x', 'k'], 'x', ['Optional', 'k', 'W0']],
      ],
      ['Block', ['Declare', 'W0', "'integer'", 7], ['Map', 'g', ['List', 1]]],
    ];
    expect(ce.box(json).evaluate().toString()).toBe('[6]');
    expect(() => compiled(ce, json, { constantFold: false })).toThrow(DECLINE);
  });

  // An Epsil `const` is a constant that the program declares.
  test('a default that names an Epsil `const` declines', () => {
    const ce = new ComputeEngine();
    const [json] = parseEpsil('const W = 5; function f(k = W) { k + 1 }; f()');
    const program = ce.box(json as Json);
    expect(() => compiled(ce, program.json, { constantFold: false })).toThrow(
      /constant declared by the program or the host \(`W`\)/
    );
    expect(program.evaluate().toString()).toBe('6');
  });

  test('a library constant default is filled', () => {
    const ce = engine();
    ce.assign(
      'fp',
      ce.box(['Function', ['Add', 'x', 'k'], 'x', ['Optional', 'k', 'Pi']])
    );
    const result = compiled(ce, ['fp', 1], { constantFold: false });
    expect(result.success).toBe(true);
    expect(result.run!({} as never)).toBeCloseTo(1 + Math.PI);
  });
});

describe('A call whose value is a function', () => {
  test('a full application of a literal that returns a function declines', () => {
    const ce = new ComputeEngine();
    const json = [
      'Apply',
      ['Function', ['Function', ['Add', 'x', 'y'], 'y'], 'x'],
      1,
    ];
    expect(() => compiled(ce, json)).toThrow(/does not return a function/);
  });

  test('a call that leaves out a defaulted argument declines', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'mk',
      ce.box([
        'Function',
        ['Function', ['Add', 'x', 'a', 'k'], 'x'],
        'a',
        ['Optional', 'k', 2],
      ])
    );
    expect(ce.box(['mk', 1]).toString()).toBe('mk(1, 2)');
    expect(() => compiled(ce, ['mk', 1])).toThrow(
      /does not return a function/
    );
  });
});

describe('A rebound block-local function', () => {
  test('the value of an Assign that names it declines', () => {
    const ce = new ComputeEngine();
    const json = [
      'Block',
      ['Declare', 'k', "'function'", ['Function', ['Add', 'x', 1], 'x']],
      ['Assign', 'k', ['Function', ['Add', 'x', 2], 'x']],
      ['Declare', 'g', "'function'", ['Function', ['Add', 'x', 3], 'x']],
      ['Assign', 'g', 'k'],
      ['g', 1],
    ];
    expect(ce.box(json).evaluate().toString()).toBe('3');
    expect(() => compiled(ce, json)).toThrow(/block-local function `k`/);
  });
});

describe('A declaration in a scope other than the current scope', () => {
  test('reads a symbol default in the scope that receives it', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const outer = ce.context.lexicalScope;
    ce.declare('W', { isConstant: true, value: 5 } as never);
    ce.pushScope();
    ce.declare('W', { isConstant: true, value: 7 } as never);
    ce.declare(
      'f',
      {
        signature: '(k: real = W) -> real',
        evaluate: ([k]: Json[]) => k,
      } as never,
      outer
    );
    ce.popScope();
    expect(ce.box(['f']).evaluate().toString()).toBe('5');
  });
});
