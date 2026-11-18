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
    expect(r.error).toMatch(/static type error/);
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
});

describe('destructured Block locals take their types from the pattern position', () => {

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
