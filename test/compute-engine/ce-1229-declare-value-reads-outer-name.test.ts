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

  test('a function literal in the value that has the name reads the outer binding', () => {
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
    // The interpreter gives 2 + (2 + 1) = 5 at z = 2.
    const r = compile(block, { to: 'javascript', fallback: false });
    expect(r.run!({ z: 2 })).toBe(5);
  });
});
