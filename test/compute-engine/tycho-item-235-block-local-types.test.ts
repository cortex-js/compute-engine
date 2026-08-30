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
 * Now the hoisted binding carries the statically-readable `Declare` type, and
 * the `Assign` canonical handler records assignment evidence — the JOIN over
 * every assignment canonicalized against the binding, widened through
 * `widenAssignedType` — so reads of the local (which resolve the binding
 * lazily) see a type that admits every value the block can bind. The binding
 * stays inferred and valueless, so evaluation-time behavior is unchanged.
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
  engine.precision = 'machine';
  return engine;
}

describe('Tycho item 235 — Block-local types on the JavaScript target', () => {
  test('Declare + Assign + Length compiles and runs', () => {
    const e = ce().box([
      'Block',
      ['Declare', 'd', "'list<number>'"],
      ['Assign', 'd', ['List', 4, 5, 4]],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(3);
  });

  test('Assign-only block (no Declare) compiles and runs', () => {
    const e = ce().box([
      'Block',
      ['Assign', 'd', ['List', 4, 5, 4]],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(3);
  });

  test('At over a Block local compiles (gather index)', () => {
    const e = ce().box([
      'Block',
      ['Declare', 'd', "'list<number>'"],
      ['Assign', 'd', ['List', 4, 5, 4]],
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
      ['Declare', 'd', "'list<number>'"],
      ['Assign', 'd', ['List', 4, 5, 4]],
      ['Length', 'd'],
    ]);
    if (!('ops' in e) || e.ops === null) throw new Error('expected operands');
    const read = (e as any).ops[2].ops[0];
    expect(read.type.matches('list<any>')).toBe(true);
  });

  test('evaluation is unchanged', () => {
    const engine = ce();
    expect(
      engine
        .box([
          'Block',
          ['Declare', 'd', "'list<number>'"],
          ['Assign', 'd', ['List', 4, 5, 4]],
          ['Length', 'd'],
        ])
        .evaluate()
        .toString()
    ).toBe('3');
    // A nested block's own local shadows the outer one, compiled and
    // interpreted alike.
    const shadow = [
      'Block',
      ['Assign', 'd', ['List', 1, 2]],
      ['Block', ['Declare', 'd', "'number'"], ['Assign', 'd', 7], ['Add', 'd', 1]],
    ];
    expect(engine.box(shadow).evaluate().toString()).toBe('8');
    const r = compile(engine.box(shadow), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run()).toBe(8);
  });

  test('reassignment of a different kind joins — Length fails closed on a maybe-string', () => {
    const e = ce().box([
      'Block',
      ['Assign', 'd', ['List', 1, 2]],
      ['Assign', 'd', { str: 'ab' }],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/text at run time|string arm/);
  });

  test('a write from a closure defined in the block joins too', () => {
    // The function literal's body canonicalizes in the block scope, so its
    // `Assign(d, "zz")` reaches the same binding: the local may hold a string
    // at run time and `Length` must fail closed rather than emit `.length`.
    const e = ce().box([
      'Block',
      ['Assign', 'd', ['List', 1, 2]],
      ['Assign', 'f', ['Function', ['Assign', 'd', { str: 'zz' }]]],
      ['Length', 'd'],
    ]);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(false);
  });

  test('reassignment in a loop body stays sound: compiled matches interpreted', () => {
    const mj = [
      'Block',
      ['Assign', 'd', ['List', 1, 2]],
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
      ['Declare', 'd', "'list<number>'"],
      ['Assign', 'd', ['List', 4, 5, 4]],
      ['Length', ['At', 'd', ['Equal', 'd', 4]]],
    ];
    const sumShape = [
      'Block',
      ['Declare', 'd', "'list<number>'"],
      ['Assign', 'd', ['List', 4, 5, 4]],
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
