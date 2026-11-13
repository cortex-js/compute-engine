/**
 * The effects memo of a node is served in another activation of its scope
 * when both chains resolve every name the same way (`equivalentChains()`,
 * `ambient-chain.ts`), and the values of the activated definitions that the
 * projection read are checked before a hit (`readBindingValue()`,
 * `effectsLookupsValid()`, `effects-of.ts`). A local, a parameter or a
 * block local that holds a pure function in one activation and a function
 * with an effect in another must give each activation its own answer.
 *
 * In a loop, the write of a function value into the activation of an
 * iteration advances the callable axis, so the memo is not served in the
 * next iteration whatever the activations hold. The frames of two calls of
 * one function hold their bindings in two objects, so `equivalentChains()`
 * does not match them either. These tests are therefore the guard for a
 * later change of either rule: with frames of calls matched by their
 * definitions and the check of the values removed, the test of two calls
 * of `g` reads `["True","True","True","True"]`.
 *
 * `PureOf` is lazy: it reads `isPure` of its operand, unevaluated, in the
 * activation in progress.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('PureOf', {
    signature: '(any) -> boolean',
    lazy: true,
    evaluate: (ops, { engine }) => (ops[0].isPure ? engine.True : engine.False),
  });
  return ce;
}

function run(program: string): string | undefined {
  const r = executeEpsil(engine(), program);
  expect(r.diagnostics).toEqual([]);
  return r.value?.toString();
}

describe('the effects memo across activations', () => {
  it('a loop local that holds a pure function, then a random draw', () => {
    expect(
      run(`do {
  let out = []
  for i in 1..4 {
    let f: function = if i % 2 == 1 { (x) => x + 1 } else { (x) => x + random() }
    out = append(out, PureOf(f(1)))
  }
  out
}`)
    ).toBe('["True","False","True","False"]');
  });

  it('a loop local that holds an assignment to an outer variable, then a pure function', () => {
    expect(
      run(`do {
  let out = []
  let c = 0
  for i in 1..4 {
    let f: function = if i % 2 == 0 { (x) => x + 1 } else { (x) => do { c = c + 1; x } }
    out = append(out, PureOf(f(1)))
  }
  out
}`)
    ).toBe('["False","True","False","True"]');
  });

  it('a loop local reassigned in some iterations', () => {
    expect(
      run(`do {
  let out = []
  for i in 1..4 {
    let f = (x) => x + 1
    if i % 2 == 0 { f = (x) => x + random() }
    out = append(out, PureOf(f(1)))
  }
  out
}`)
    ).toBe('["True","False","True","False"]');
  });

  it('a call of the loop local runs the assignment in each iteration that holds it', () => {
    expect(
      run(`do {
  let c = 0
  for i in 1..4 {
    let f: function = if i % 2 == 0 { (x) => x + 1 } else { (x) => do { c = c + 1; x } }
    f(1)
  }
  c
}`)
    ).toBe('2');
  });

  it('a MathJSON loop whose body declares a function local', () => {
    const ce = engine();
    const loop = [
      'Block',
      ['Declare', 'out', "'list'", ['List']],
      [
        'Loop',
        [
          'Block',
          [
            'Declare',
            'f',
            "'function'",
            [
              'If',
              ['Equal', ['Mod', 'i', 2], 1],
              ['Function', ['Add', 'x', 1], 'x'],
              ['Function', ['Add', 'x', ['Random']], 'x'],
            ],
          ],
          ['Assign', 'out', ['Append', 'out', ['PureOf', ['f', 1]]]],
        ],
        ['Element', 'i', ['Range', 1, 4]],
      ],
      'out',
    ];
    expect(
      ce
        .box(loop as never)
        .evaluate()
        .toString()
    ).toBe('["True","False","True","False"]');
  });

  it('two calls of one function whose parameter is a function value', () => {
    expect(
      run(`do {
  function g(h) { PureOf(h(1)) }
  [g((x) => x + 1), g((x) => x + random()), g((x) => x + 1), g((x) => x + random())]
}`)
    ).toBe('["True","False","True","False"]');
    expect(
      run(`do {
  let c = 0
  function g(h) { PureOf(h(1)) }
  [g((x) => do { c = c + 1; x }), g((x) => x + 1), g((x) => do { c = c + 1; x })]
}`)
    ).toBe('["False","True","False"]');
  });

  it('a block evaluated twice, with a pure function local, then a random draw', () => {
    const ce = engine();
    ce.assign('pick', 1);
    const block = ce.box([
      'Block',
      [
        'Declare',
        'f',
        "'function'",
        [
          'If',
          ['Equal', 'pick', 1],
          ['Function', ['Add', 'x', 1], 'x'],
          ['Function', ['Add', 'x', ['Random']], 'x'],
        ],
      ],
      ['PureOf', ['f', 1]],
    ] as never);
    expect(block.evaluate().toString()).toBe('"True"');
    ce.assign('pick', 2);
    expect(block.evaluate().toString()).toBe('"False"');
    ce.assign('pick', 1);
    expect(block.evaluate().toString()).toBe('"True"');
  });
});
