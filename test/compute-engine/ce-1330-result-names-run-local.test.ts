/**
 * CE-1330: the value of a call or of a block that the engine cannot decide
 * yet (an `If` whose condition reads a free name) names the values of the
 * locals of the call or the block, not the locals: a local has no value once
 * its call or block has ended. A parameter in the same place was already
 * replaced with its value (`bindingKeyedSubs`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

function run(src: string): string {
  const result: any = executeEpsil(new ComputeEngine(), src);
  expect(result.diagnostics ?? []).toEqual([]);
  return String(result.value ?? result.result);
}

describe('a local named by the result of a call or a block', () => {
  test.each([
    [
      'a local of a call, in an undecided branch',
      'function f(a) { let k = a^2; if t > 0 { k + 1 } else { 0 } }\nf(5)',
      'If(0 < t, {26}, {0})',
    ],
    [
      'the branch is read after the condition gets a value',
      'function f(a) { let k = a^2; if t > 0 { k + 1 } else { 0 } }\nlet r = f(5)\nlet t = 1\nr',
      '26',
    ],
    [
      'a local of a call, in a sum with a free bound',
      'function g(a) { let k = a^2; sum(k * i * t, i, 1, m) }\ng(5)',
      'sum_(i=1)^(m)(25i * t)',
    ],
    [
      'a local of a call with no parameter',
      'function f() { let k = 3; if t > 0 { k + 1 } else { 0 } }\nf()',
      'If(0 < t, {4}, {0})',
    ],
    [
      'a local of a block',
      'do { let k = 25; if t > 0 { k + 1 } else { 0 } }',
      'If(0 < t, {26}, {0})',
    ],
    [
      'locals of nested blocks',
      'do { let k = 25; do { let j = k; if t > 0 { j + k } else { 0 } } }',
      'If(0 < t, {50}, {0})',
    ],
    [
      'a global of the same name is not read',
      'let k = 100\nfunction f(a) { let k = a; if t > 0 { k + 1 } else { 0 } }\nlet r = f(2)\nlet t = 1\nr',
      '3',
    ],
  ])('%s', (_, src, expected) => {
    expect(run(src)).toBe(expected);
  });

  test('a function value keeps its local, and applied reads its value', () => {
    const src =
      'function f(a) { let k = a^2; let g = x => k + x; if t > 0 { g } else { 0 } }';
    expect(run(`${src}\nf(5)`)).toBe('If(0 < t, {(x) => k + x}, {0})');
    expect(run(`${src}\nlet t = 1\nf(5)(1)`)).toBe('26');
  });

  // Replacing the reads and not the write would give the old value of the
  // local once the branch is taken.
  test.each([
    ['an assignment', 'k = k + 1', /Assign\(k, k \+ 1\)/],
    ['a compound assignment', 'k += 1', /AddTo\(k, 1\)/],
  ])('a result that writes a local with %s keeps it', (_, write, form) => {
    const src = `function f(a) { let k = a; if t > 0 { do { ${write}; k } } else { 0 } }`;
    expect(run(`${src}\nf(2)`)).toMatch(form);
  });

  test.each([
    [
      'a destructuring assignment',
      ['Block', ['Assign', ['Tuple', 'k', 'j'], ['Tuple', 3, 4]], 'k'],
    ],
    ['a call of a closure that writes it', ['Block', ['c'], 'k']],
    ['a closure that writes it, applied', ['Block', ['Apply', 'c'], 'k']],
  ])('a result that writes a local with %s keeps it', (_, branch) => {
    const ce = new ComputeEngine();
    ce.declare('C', 'boolean');
    const r = ce
      .box([
        'Block',
        ['Declare', 'k', "'unknown'", 2],
        ['Declare', 'j', "'unknown'", 0],
        [
          'Declare',
          'c',
          "'unknown'",
          ['Function', ['Block', ['AddTo', 'k', 1], 0]],
        ],
        ['If', 'C', branch as any, 0],
      ])
      .evaluate();
    expect(r.toString()).toMatch(/\n\s*k\n/);
  });

  test.each([
    [
      'a shield of a local in a block',
      'do { let k = 3; HoldValues(k + 1, k) }',
      'k + 1',
    ],
    [
      'an error keeps the names the program wrote',
      'function f(n) { let i = 1; while i <= n { i = i + 1 }; i }\nf(m)',
      'Error(ErrorCode("incompatible-type", "boolean"), i <= m)',
    ],
  ])('%s', (_, src, expected) => {
    const result: any = executeEpsil(new ComputeEngine(), src);
    expect(String(result.value ?? result.result)).toBe(expected);
  });

  test('a closure in a list local that writes the local keeps the local', () => {
    const ce = new ComputeEngine();
    ce.declare('C', 'boolean');
    const r = ce
      .box([
        'Block',
        ['Declare', 'k', "'unknown'", 2],
        [
          'Declare',
          'fs',
          "'unknown'",
          ['List', ['Function', ['Block', ['AddTo', 'k', 1], 0]]],
        ],
        ['If', 'C', ['Block', ['Apply', ['At', 'fs', 1]], 'k'], 0],
      ])
      .evaluate();
    expect(r.toString()).toMatch(/\n\s*k\n/);
  });

  test('a value made outside the block keeps a global of the name of a local', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 100);
    ce.declare('z', 'unknown');
    ce.assign('z', ce.box(['Hold', ['Add', 'y', 1]]));
    const r = ce
      .box(['Block', ['Declare', 'y', "'unknown'", 3], 'z'])
      .evaluate();
    expect(r.toString()).toBe('Hold(y + 1)');
    expect(ce.box(['ReleaseHold', r]).evaluate().toString()).toBe('101');
  });

  test('a shield nested in the value of a block keeps the local', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        ['Declare', 'k', "'unknown'", 3],
        ['List', ['HoldValues', ['Add', 'k', 1], 'k'], 'k'],
      ])
      .evaluate();
    expect(r.toString()).toBe('[k + 1,3]');
  });

  test('a function literal in an undecided branch reads the value of the local', () => {
    for (const name of ['a', 'k']) {
      const ce = new ComputeEngine();
      ce.declare('C', 'boolean');
      ce.assign(
        'f',
        ce.box([
          'Function',
          [
            'Block',
            ['Declare', 'k', "'unknown'", 'a'],
            [
              'If',
              'C',
              ['Function', ['Add', name, 'x'], 'x'],
              ['Function', 0, 'x'],
            ],
          ],
          'a',
        ])
      );
      const r = ce.box(['f', 5]).evaluate();
      expect(r.toString()).toBe('If(C, (x) => x + 5, (x) => 0)');
      ce.assign('C', ce.symbol('True'));
      expect(ce.box(['Apply', r.evaluate(), 1]).evaluate().toString()).toBe(
        '6'
      );
    }
  });
});
