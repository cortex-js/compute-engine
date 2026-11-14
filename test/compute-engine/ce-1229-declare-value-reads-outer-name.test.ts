import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json';

// CE-1229: the value of a `Declare` that reads the name of its own local
// (`3z with z = z + Z`) reads the enclosing binding of the name, in the
// compiled code as in the interpreter. The local gets an emitted name of its
// own, and the value is compiled against the enclosing binding.

const value = (v: MathJsonExpression): MathJsonExpression => [
  'Dictionary',
  ['KeyValuePair', "'value'", v],
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('z', 'real');
  ce.declare('Z', 'real');
  ce.declare('w', 'complex');
  return ce;
}

describe('CE-1229: a declaration whose value reads the outer name', () => {
  test.each([
    ['the attributes form', value(['Add', 'z', 'Z'])],
    ['the positional form', "'unknown'", ['Add', 'z', 'Z']],
  ] as [string, ...MathJsonExpression[]][])(
    '%s compiles to the interpreter value',
    (_label, ...declaration) => {
      const ce = engine();
      const block = ce.box([
        'Block',
        ['Declare', 'z', ...declaration],
        ['Multiply', 3, 'z'],
      ]);
      expect(ce.withValues({ z: 2, Z: 10 }, () => block.evaluate().re)).toBe(
        36
      );
      const js = compile(block, { to: 'javascript', fallback: false });
      expect(js.success).toBe(true);
      expect(js.code).toMatch(/let _tv\d+ = _\.Z \+ _\.z/);
      expect(js.code).not.toContain('let z');
      expect(js.run!({ z: 2, Z: 10 })).toBe(36);
      for (const to of ['glsl', 'python', 'interval-js'] as const)
        expect(compile(block, { to, fallback: false }).success).toBe(true);
    }
  );

  test('a later assignment writes the local, not the input', () => {
    const block = engine().box([
      'Block',
      ['Declare', 'z', value(['Add', 'z', 1])],
      ['Assign', 'z', ['Multiply', 'z', 2]],
      ['Add', 'z', 0.5],
    ]);
    const r = compile(block, { to: 'javascript', fallback: false });
    const vars = { z: 2 };
    expect(r.run!(vars)).toBe(6.5);
    expect(vars.z).toBe(2);
  });

  test('a later local reads the new local', () => {
    const block = engine().box([
      'Block',
      ['Declare', 'a', value(3)],
      ['Declare', 'z', value(['Add', 'z', 'a'])],
      ['Declare', 'u', value(['Multiply', 'z', 2])],
      'u',
    ]);
    const r = compile(block, { to: 'javascript', fallback: false });
    expect(r.run!({ z: 2 })).toBe(10);
  });

  test('a nested block reads the local of the enclosing block', () => {
    const block = engine().box([
      'Block',
      ['Declare', 'z', value(['Add', 'z', 1])],
      [
        'Multiply',
        ['Block', ['Declare', 'z', value(['Multiply', 'z', 10])], 'z'],
        'z',
      ],
    ]);
    const r = compile(block, { to: 'javascript', fallback: false });
    expect(r.run!({ z: 2 })).toBe(90);
  });

  test('the value reads the lane of the outer name', () => {
    // The outer `w` is complex and the local is real: the value is the
    // modulus of the input, not of the local.
    const ce = engine();
    const block = ce.box([
      'Block',
      ['Declare', 'w', value(['Abs', 'w'])],
      ['Multiply', 3, 'w'],
    ]);
    expect(
      ce.withValues({ w: ce.complex(3, 4) }, () => block.evaluate().re)
    ).toBe(15);
    const r = compile(block, { to: 'javascript', fallback: false });
    expect(r.run!({ w: { re: 3, im: 4 } })).toBe(15);
    const glsl = compile(block, { to: 'glsl', fallback: false });
    expect(glsl.code).toMatch(/_tv\d+ = length\(w\)/);
  });

  test('an enclosing operation reads the lane of the block value', () => {
    // The local is complex through the outer `w`: `Abs` of the block is
    // the complex modulus.
    const block = engine().box([
      'Abs',
      ['Block', ['Declare', 'w', "'unknown'", ['Add', 'w', 1]], 'w'],
    ]);
    const r = compile(block, { to: 'javascript', fallback: false });
    expect(r.run!({ w: { re: 3, im: 4 } })).toBeCloseTo(Math.sqrt(32), 12);
  });

  test('a local that shadows an enclosing local keeps its own shape in the value', () => {
    const ce = engine();
    ce.declare('n', 'integer');
    const block = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", 3],
      [
        'Block',
        ['Declare', 'a', "'unknown'", ['List', 1, 2]],
        [
          'Declare',
          'z',
          "'unknown'",
          ['Sum', ['Add', 'z', 'a'], ['Limits', 'k', 1, 'n']],
        ],
        'z',
      ],
    ]);
    const r = compile(block, { to: 'javascript', fallback: false });
    expect(r.run!({ z: 2, n: 2 })).toEqual([6, 8]);
  });

  test('a function literal in the value that has the name declines', () => {
    const block = engine().box([
      'Block',
      [
        'Declare',
        'z',
        value([
          'Add',
          'z',
          ['Apply', ['Function', ['Add', 'z', 'x'], 'x'], 1],
        ]),
      ],
      'z',
    ]);
    expect(() =>
      compile(block, { to: 'javascript', fallback: false })
    ).toThrow(/reads the block local "z" before any statement gives it a value/);
  });
});
