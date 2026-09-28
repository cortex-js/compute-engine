import { ComputeEngine } from '../../src/compute-engine';

// The six binary connectives under Kleene three-valued logic, with an absent
// operand (`Missing`, or `Undefined`, which is read the same way).
//
// An absent operand is an undecided truth value. The result is decided when
// the other operand decides it (`Implies(Missing, True)` is `True`, as
// `Or(Missing, True)` is). It is `Missing` when the other operand is a truth
// value that does not decide it (`Nand(True, Missing)`). It stays symbolic
// when the other operand is an unknown boolean symbol (`And(A, Missing)`
// stays `And(A, Missing)`), with each absent operand spelled `Missing`.
//
// User decision of 2026-09-27: `Implies`, `Nand` and `Nor` follow `And` and
// `Or`. Before it, `Implies(Missing, True)` was `Missing` and
// `Nand(A, Missing)` was `Missing`.
//
// The expected tables below are written by hand from the Kleene truth
// tables. Rows are the first operand, columns the second, both in the order
// True, False, A, Missing, Undefined. `T`/`F`/`M` are `True`/`False`/
// `Missing`. `S` is a result that depends on the value of `A`: the test
// checks that it stays symbolic, and that it gives the Kleene answer once
// `A` is replaced by `True` and by `False`.
//
// Boolean contexts use UPPERCASE symbols: evaluating a symbol as a boolean
// operand retypes it `boolean` for the engine's lifetime.

const ce = new ComputeEngine();
ce.declare('A', 'boolean');

const OPERANDS = ['True', 'False', 'A', 'Missing', 'Undefined'] as const;
type Operand = (typeof OPERANDS)[number];
type Cell = 'T' | 'F' | 'M' | 'S';

const TABLES: Record<string, Cell[][]> = {
  //         True  False   A    Missing Undefined
  And: [
    ['T', 'F', 'S', 'M', 'M'], // True
    ['F', 'F', 'F', 'F', 'F'], // False
    ['S', 'F', 'S', 'S', 'S'], // A
    ['M', 'F', 'S', 'M', 'M'], // Missing
    ['M', 'F', 'S', 'M', 'M'], // Undefined
  ],
  Or: [
    ['T', 'T', 'T', 'T', 'T'],
    ['T', 'F', 'S', 'M', 'M'],
    ['T', 'S', 'S', 'S', 'S'],
    ['T', 'M', 'S', 'M', 'M'],
    ['T', 'M', 'S', 'M', 'M'],
  ],
  Nand: [
    ['F', 'T', 'S', 'M', 'M'],
    ['T', 'T', 'T', 'T', 'T'],
    ['S', 'T', 'S', 'S', 'S'],
    ['M', 'T', 'S', 'M', 'M'],
    ['M', 'T', 'S', 'M', 'M'],
  ],
  Nor: [
    ['F', 'F', 'F', 'F', 'F'],
    ['F', 'T', 'S', 'M', 'M'],
    ['F', 'S', 'S', 'S', 'S'],
    ['F', 'M', 'S', 'M', 'M'],
    ['F', 'M', 'S', 'M', 'M'],
  ],
  // `Implies(p, q)` is `Or(Not(p), q)`.
  Implies: [
    ['T', 'F', 'S', 'M', 'M'],
    ['T', 'T', 'T', 'T', 'T'],
    ['T', 'S', 'S', 'S', 'S'],
    ['T', 'M', 'S', 'M', 'M'],
    ['T', 'M', 'S', 'M', 'M'],
  ],
  // No operand decides `Xor` or `Equivalent`. `Xor(A, A)` is `False` for
  // either value of `A`.
  Xor: [
    ['F', 'T', 'S', 'M', 'M'],
    ['T', 'F', 'S', 'M', 'M'],
    ['S', 'S', 'F', 'S', 'S'],
    ['M', 'M', 'S', 'M', 'M'],
    ['M', 'M', 'S', 'M', 'M'],
  ],
  Equivalent: [
    ['T', 'F', 'S', 'M', 'M'],
    ['F', 'T', 'S', 'M', 'M'],
    ['S', 'S', 'S', 'S', 'S'],
    ['M', 'M', 'S', 'M', 'M'],
    ['M', 'M', 'S', 'M', 'M'],
  ],
};

const CELL_NAME = { T: 'True', F: 'False', M: 'Missing' } as const;

function expectedCell(op: string, a: Operand, b: Operand): Cell {
  return TABLES[op][OPERANDS.indexOf(a)][OPERANDS.indexOf(b)];
}

const cases: [string, Operand, Operand, Cell][] = [];
for (const op of Object.keys(TABLES))
  for (const a of OPERANDS)
    for (const b of OPERANDS) cases.push([op, a, b, expectedCell(op, a, b)]);

describe('KLEENE THREE-VALUED CONNECTIVES WITH AN ABSENT OPERAND', () => {
  test.each(cases)('%s(%s, %s) is %s', async (op, a, b, cell) => {
    const expr = ce.box([op, a, b]);
    expect(expr.isValid).toBe(true);
    const result = expr.evaluate();
    if (cell !== 'S') {
      expect(result.json).toEqual(CELL_NAME[cell]);
      expect(expr.N().json).toEqual(CELL_NAME[cell]);
      expect((await expr.evaluateAsync()).json).toEqual(CELL_NAME[cell]);
      return;
    }
    // The result depends on `A`: it stays symbolic, spells every absent
    // operand `Missing`, and agrees with the table once `A` is decided.
    const text = JSON.stringify(result.json);
    expect(['True', 'False', 'Missing']).not.toContain(result.json);
    expect(text).toContain('"A"');
    expect(text).not.toContain('Undefined');
    for (const value of ['True', 'False'] as const) {
      const sub = (x: Operand): Operand => (x === 'A' ? value : x);
      const decided = expectedCell(op, sub(a), sub(b));
      expect(decided).not.toBe('S');
      expect(result.subs({ A: ce.symbol(value) }).evaluate().json).toEqual(
        CELL_NAME[decided as 'T' | 'F' | 'M']
      );
    }
  });
});
