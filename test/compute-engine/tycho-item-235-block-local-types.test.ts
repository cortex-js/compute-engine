/**
 * Tycho item 235.
 *
 * A `Block`-bound local used to lose its declared/assigned type on the
 * compilation routes. `Declare` and `Assign` register their binding at
 * EVALUATION time, so the binding `canonicalBlock` hoists for a block-local
 * stayed `unknown`-typed on every route that never evaluates — compilation in
 * particular, whose operand type gates then failed closed:
 * `Block(Declare(d, "list<number>"), Assign(d, [4,5,4]), Length(d))` refused
 * with "operand is not an indexed collection", while the equivalent binding
 * through a parameter (`Apply(Function(Length(d), d), [4,5,4])`) compiled.
 *
 * A local of a block is made by a `Declare`, and its binding carries the
 * type that the `Declare` gives, or the type of its initial value, so the
 * routes that never evaluate see it. An `Assign` writes a variable in scope;
 * one to an undeclared name is the static error
 * `assignment-to-undeclared-variable`, and a compilation declines it.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let warn: jest.SpyInstance;
beforeAll(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warn.mockRestore());

function ce(): ComputeEngine {
  const engine = new ComputeEngine();
  engine.declare('_', 'real');
  engine.precision = 'machine';
  return engine;
}

describe('Tycho item 235 — Block-local types on the JavaScript target', () => {
  test('Declare + Assign + Length compiles and runs', () => {
    const e = ce().box([
      'Block',
      ['Declare', 'd', "'list<number>'", ['List', 4, 5, 4]],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(3);
  });

  test('a Declare with no written type takes the type of its value', () => {
    const e = ce().box([
      'Block',
      ['Declare', 'd', "'unknown'", ['List', 4, 5, 4]],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(3);
  });

  test('an Assign to an undeclared local is invalid and declines', () => {
    const e = ce().box([
      'Block',
      ['Assign', 'd', ['List', 4, 5, 4]],
      ['Length', 'd'],
    ]);
    expect(e.isValid).toBe(false);
    expect(JSON.stringify(e.json)).toContain(
      'assignment-to-undeclared-variable'
    );
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(false);
  });

  test('At over a Block local compiles (gather index)', () => {
    const e = ce().box([
      'Block',
      ['Declare', 'd', "'list<number>'", ['List', 4, 5, 4]],
      ['At', 'd', ['List', 1, 3]],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toEqual([4, 4]);
  });

  test('a read of the local types from the declared type', () => {
    const engine = ce();
    const e = engine.box([
      'Block',
      ['Declare', 'd', "'list<number>'", ['List', 4, 5, 4]],
      ['Length', 'd'],
    ]);
    if (!('ops' in e) || e.ops === null) throw new Error('expected operands');
    const read = (e as any).ops[1].ops[0];
    expect(read.type.matches('list<any>')).toBe(true);
  });

  test('evaluation is unchanged', () => {
    const engine = ce();
    expect(
      engine
        .box([
          'Block',
          ['Declare', 'd', "'list<number>'", ['List', 4, 5, 4]],
          ['Length', 'd'],
        ])
        .evaluate()
        .toString()
    ).toBe('3');
    // A nested block's own local shadows the outer one, compiled and
    // interpreted alike.
    const shadow = [
      'Block',
      ['Declare', 'd', "'unknown'", ['List', 1, 2]],
      ['Block', ['Declare', 'd', "'number'", 7], ['Add', 'd', 1]],
    ];
    expect(engine.box(shadow).evaluate().toString()).toBe('8');
    const r = compile(engine.box(shadow), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(8);
  });

  test('a reassignment with a value of another type is invalid and declines', () => {
    // A local keeps the type of its first value: a string after a list is the
    // static error `assignment-type-mismatch`.
    const e = ce().box([
      'Block',
      ['Declare', 'd', "'unknown'", ['List', 1, 2]],
      ['Assign', 'd', { str: 'ab' }],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/invalid expression/);
  });

  test('a write from a closure defined in the block joins too', () => {
    // The function literal's body canonicalizes in the block scope, so its
    // `Assign(d, "zz")` reaches the same binding: the local may hold a string
    // at run time and `Length` must fail closed rather than emit `.length`.
    const e = ce().box([
      'Block',
      ['Declare', 'd', "'unknown'", ['List', 1, 2]],
      [
        'Declare',
        'f',
        "'unknown'",
        ['Function', ['Assign', 'd', { str: 'zz' }]],
      ],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(false);
  });

  test('reassignment in a loop body stays sound: compiled matches interpreted', () => {
    const mj = [
      'Block',
      ['Declare', 'd', "'unknown'", ['List', 1, 2]],
      [
        'Loop',
        ['Assign', 'd', ['Append', 'd', 9]],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      ['Length', 'd'],
    ];
    const engine = ce();
    expect(engine.box(mj).evaluate().toString()).toBe('5');
    const r = compile(engine.box(mj), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(5);
  });

  test('the boolean-mask read (Tycho witness shapes) compiles with interpreter parity', () => {
    const lengthShape = [
      'Block',
      ['Declare', 'd', "'list<number>'", ['List', 4, 5, 4]],
      ['Length', ['At', 'd', ['Equal', 'd', 4]]],
    ];
    const sumShape = [
      'Block',
      ['Declare', 'd', "'list<number>'", ['List', 4, 5, 4]],
      ['Sum', ['At', 'd', ['Equal', 'd', 4]]],
    ];
    expect(ce().box(lengthShape).evaluate().toString()).toBe('2');
    const r1 = compile(ce().box(lengthShape), { to: 'javascript' });
    expect(r1.success).toBe(true);
    expect(r1.run()).toBe(2);
    expect(ce().box(sumShape).evaluate().toString()).toBe('8');
    const r2 = compile(ce().box(sumShape), { to: 'javascript' });
    expect(r2.success).toBe(true);
    expect(r2.run()).toBe(8);
  });

  test('the Apply(Function(…)) control keeps working', () => {
    const e = ce().box([
      'Apply',
      ['Function', ['Length', 'd'], 'd'],
      ['List', 4, 5, 4],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(3);
  });
});

describe('destructured Block locals take their types from the pattern position', () => {
  // `Declare((x, y), "unknown", v)` declares one block-local per pattern
  // leaf, and each leaf takes its type from the matching position of the
  // tuple type of `v`, so a type-gated read of it (`Length`, `At`) compiles.
  test('Length over a destructured list local compiles and runs', () => {
    const e = ce().box([
      'Block',
      [
        'Declare',
        ['Tuple', 'xs', 'n'],
        "'unknown'",
        ['Tuple', ['List', 1, 2, 3], 2],
      ],
      ['Length', 'xs'],
    ]);
    expect(e.evaluate().toString()).toBe('3');
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(3);
  });

  test('At with a destructured index compiles', () => {
    const e = ce().box([
      'Block',
      [
        'Declare',
        ['Tuple', 'xs', 'n'],
        "'unknown'",
        ['Tuple', ['List', 1, 2, 3], 2],
      ],
      ['At', 'xs', 'n'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(2);
  });

  test('a nested pattern and a `_` position', () => {
    const nested = ce().box([
      'Block',
      [
        'Declare',
        ['Tuple', 'a', ['Tuple', 'b', 'c']],
        "'unknown'",
        ['Tuple', 1, ['Tuple', ['List', 5, 6], 3]],
      ],
      ['Add', 'a', ['Length', 'b'], 'c'],
    ]);
    expect(nested.evaluate().toString()).toBe('6');
    const r1 = compile(nested, { to: 'javascript' });
    expect(r1.success).toBe(true);
    expect(r1.run()).toBe(6);
    const skipped = ce().box([
      'Block',
      [
        'Declare',
        ['Tuple', '_', 'ys'],
        "'unknown'",
        ['Tuple', 1, ['List', 7, 8]],
      ],
      ['Length', 'ys'],
    ]);
    const r2 = compile(skipped, { to: 'javascript' });
    expect(r2.success).toBe(true);
    expect(r2.run()).toBe(2);
  });

  test('a reassignment of a different kind joins, as for a plain local', () => {
    const e = ce().box([
      'Block',
      ['Declare', ['Tuple', 'x', 'y'], "'unknown'", ['Tuple', 1, 2]],
      ['Assign', ['Tuple', 'x', 'y'], ['Tuple', ['List', 1], 2]],
      ['Length', 'x'],
    ]);
    // `x` may hold a number at run time, so `Length` fails closed.
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(false);
  });

  test('the leaves are block-local: nothing escapes the block', () => {
    const engine = ce();
    engine
      .box([
        'Block',
        ['Declare', ['Tuple', 'x', 'y'], "'unknown'", ['Tuple', 1, 2]],
        ['Add', 'x', 'y'],
      ])
      .evaluate();
    expect(engine.symbol('x').value).toBeUndefined();
    expect(engine.symbol('y').value).toBeUndefined();
  });
});
