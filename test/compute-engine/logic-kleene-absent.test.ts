import { ComputeEngine } from '../../src/compute-engine';

// The binary connectives with an absent operand (`Missing`). `Undefined` is
// not an absent value: it is an ordinary symbol with no value
// (`docs/ERROR-MODEL.md`, "`Missing` is a result only"). The file name is from the time when the
// connectives used Kleene three-valued logic; that rule is gone.
//
// The logic is two-valued: an absent operand is not a third truth value, and
// a connective reads it as `False` (user decision of 2026-11-02, two-valued
// comparisons, `docs/ERROR-MODEL.md`). So `And(True, Missing)` is `False`,
// `Not(Missing)` is `True` and `Nand(True, Missing)` is `True`. Before it,
// these were `Missing` (Kleene).
//
// The expected tables below are written by hand: the `Missing` row and
// column are the `False` row and column. Rows are the first operand,
// columns the second, both in the order True, False, A, Missing. `T`/`F` are `True`/`False`. `S` is a result that
// depends on the value of `A`: the test checks that it stays symbolic, with
// no absence symbol in it, and that it gives the table's answer once `A` is
// replaced by `True` and by `False`.
//
// Boolean contexts use UPPERCASE symbols: evaluating a symbol as a boolean
// operand retypes it `boolean` for the engine's lifetime.

const ce = new ComputeEngine();
ce.declare('A', 'boolean');

const OPERANDS = ['True', 'False', 'A', 'Missing'] as const;
type Operand = (typeof OPERANDS)[number];
type Cell = 'T' | 'F' | 'S';

const TABLES: Record<string, Cell[][]> = {
  //         True  False   A    Missing
  And: [
    ['T', 'F', 'S', 'F'], // True
    ['F', 'F', 'F', 'F'], // False
    ['S', 'F', 'S', 'F'], // A
    ['F', 'F', 'F', 'F'], // Missing
  ],
  Or: [
    ['T', 'T', 'T', 'T'],
    ['T', 'F', 'S', 'F'],
    ['T', 'S', 'S', 'S'],
    ['T', 'F', 'S', 'F'],
  ],
  Nand: [
    ['F', 'T', 'S', 'T'],
    ['T', 'T', 'T', 'T'],
    ['S', 'T', 'S', 'T'],
    ['T', 'T', 'T', 'T'],
  ],
  Nor: [
    ['F', 'F', 'F', 'F'],
    ['F', 'T', 'S', 'T'],
    ['F', 'S', 'S', 'S'],
    ['F', 'T', 'S', 'T'],
  ],
  // `Implies(p, q)` is `Or(Not(p), q)`.
  Implies: [
    ['T', 'F', 'S', 'F'],
    ['T', 'T', 'T', 'T'],
    ['T', 'S', 'T', 'S'],
    ['T', 'T', 'T', 'T'],
  ],
  // No operand decides `Xor` or `Equivalent`. `Xor(A, A)` is `False` for
  // either value of `A`, and `Implies(A, A)` and `Equivalent(A, A)` are `True`.
  Xor: [
    ['F', 'T', 'S', 'T'],
    ['T', 'F', 'S', 'F'],
    ['S', 'S', 'F', 'S'],
    ['T', 'F', 'S', 'F'],
  ],
  Equivalent: [
    ['T', 'F', 'S', 'F'],
    ['F', 'T', 'S', 'T'],
    ['S', 'S', 'T', 'S'],
    ['F', 'T', 'S', 'T'],
  ],
};

const CELL_NAME = { T: 'True', F: 'False' } as const;

function expectedCell(op: string, a: Operand, b: Operand): Cell {
  return TABLES[op][OPERANDS.indexOf(a)][OPERANDS.indexOf(b)];
}

const cases: [string, Operand, Operand, Cell][] = [];
for (const op of Object.keys(TABLES))
  for (const a of OPERANDS)
    for (const b of OPERANDS) cases.push([op, a, b, expectedCell(op, a, b)]);

describe('TWO-VALUED CONNECTIVES WITH AN ABSENT OPERAND', () => {
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
    // The result depends on `A`: it stays symbolic, keeps no absence
    // symbol, and agrees with the table once `A` is decided.
    const text = JSON.stringify(result.json);
    expect(['True', 'False', 'Missing']).not.toContain(result.json);
    expect(text).toContain('"A"');
    expect(text).not.toContain('Missing');
    for (const value of ['True', 'False'] as const) {
      const sub = (x: Operand): Operand => (x === 'A' ? value : x);
      const decided = expectedCell(op, sub(a), sub(b));
      expect(decided).not.toBe('S');
      expect(result.subs({ A: ce.symbol(value) }).evaluate().json).toEqual(
        CELL_NAME[decided as 'T' | 'F']
      );
    }
  });
});
