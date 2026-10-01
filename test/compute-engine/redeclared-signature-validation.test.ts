import { ComputeEngine } from '../../src/compute-engine';

/**
 * Several operators have a custom `canonical` handler that validates its own
 * operands. The handler must validate against the signature of the LIVE
 * definition, not against a copy of the signature text: a host that
 * redeclares the operator with a wider signature and keeps the handler
 * (`ce.declare(name, { ...def, signature })`, the copy pattern of
 * `doc/06-guide-augmenting.md`, "Overloading Functions") must get the wider
 * validation. Before the fix, `SetMinus(5, 2)` stayed invalid after
 * `SetMinus` was redeclared as `(value, value*) -> set` (GitHub issue #394).
 *
 * `Union`, `Intersection`, `Join` and `At` validate against a signature that
 * is deliberately different from their declaration, and are not covered.
 */

type Case = {
  name: string;
  /** A signature that admits `widened`, which the stock signature refuses */
  signature: string;
  /** Refused by the stock signature, admitted by `signature` */
  widened: unknown;
  /** Admitted by both; its canonical and evaluated forms must not change */
  stock: unknown;
};

const CASES: Case[] = [
  {
    name: 'SetMinus',
    signature: '(value, value*) -> set',
    widened: ['SetMinus', 5, 2],
    stock: ['SetMinus', ['Set', 1, 2, 3], ['Set', 2]],
  },
  {
    name: 'Length',
    signature: '(any, any?) -> integer | infinity',
    widened: ['Length', ['List', 1, 2], 3],
    stock: ['Length', ['List', 1, 2, 3]],
  },
  {
    name: 'Count',
    signature: '(any, any?) -> integer | infinity',
    widened: ['Count', 5],
    stock: ['Count', ['List', 1, 2, 2], 2],
  },
  {
    name: 'IsEmpty',
    signature: '(any) -> boolean',
    widened: ['IsEmpty', 5],
    stock: ['IsEmpty', ['List']],
  },
  {
    name: 'Contains',
    signature: '(any, element: any) -> boolean',
    widened: ['Contains', 5, 1],
    stock: ['Contains', ['List', 1, 2], 2],
  },
  {
    name: 'Append',
    signature: '(any, (value | missing)+) -> collection',
    widened: ['Append', 5, 1],
    stock: ['Append', ['List', 1, 2], 3],
  },
  {
    name: 'Slice',
    signature: '(any, any, any?) -> any',
    widened: ['Slice', 5, 1, 2],
    stock: ['Slice', ['List', 1, 2, 3, 4], 2, 3],
  },
];

/** Redeclare `name` with the copy pattern: every field of the current
 * definition, with only the signature replaced. */
function widen(name: string, signature: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare(name, {
    ...ce.lookupDefinition(name)!.operator!,
    signature,
  });
  return ce;
}

describe('A redeclared signature is the one the canonical handler validates', () => {
  for (const c of CASES) {
    test(`${c.name}: the stock signature refuses the operand`, () => {
      const ce = new ComputeEngine();
      expect(ce.box(c.widened as any).isValid).toBe(false);
    });

    test(`${c.name}: a widened redeclaration admits the operand`, () => {
      const ce = widen(c.name, c.signature);
      const expr = ce.box(c.widened as any);
      expect(expr.isValid).toBe(true);
      expect(expr.json).toEqual(c.widened);
    });

    test(`${c.name}: the widened redeclaration keeps the stock results`, () => {
      const stock = new ComputeEngine();
      const ce = widen(c.name, c.signature);
      const a = stock.box(c.stock as any);
      const b = ce.box(c.stock as any);
      expect(a.isValid).toBe(true);
      expect(b.json).toEqual(a.json);
      expect(b.evaluate().json).toEqual(a.evaluate().json);
    });
  }
});

describe('A stock engine is unchanged', () => {
  const ce = new ComputeEngine();
  test.each([
    [
      ['SetMinus', ['Set', 1, 2, 3], ['Set', 2]],
      ['Set', 1, 3],
    ],
    [['Length', ['List', 1, 2, 3]], 3],
    [['Count', ['List', 1, 2, 2], 2], 2],
    [['IsEmpty', ['List']], 'True'],
    [['Contains', ['List', 1, 2], 2], 'True'],
    [
      ['Append', ['List', 1, 2], 3],
      ['List', 1, 2, 3],
    ],
    // `Slice` is a lazy view: `ListFrom` materializes it.
    [
      ['ListFrom', ['Slice', ['List', 1, 2, 3, 4], 2, 3]],
      ['List', 2, 3],
    ],
  ])('%j evaluates to %j', (expr, expected) => {
    expect(ce.box(expr as any).evaluate().json).toEqual(expected);
  });

  test.each([
    ['SetMinus', ['SetMinus', 5, 2], 'incompatible-type'],
    ['Length', ['Length', ['List', 1, 2], 3], 'unexpected-argument'],
    ['Count', ['Count', 5], 'incompatible-type'],
    ['IsEmpty', ['IsEmpty', 5], 'incompatible-type'],
    ['Contains', ['Contains', 5, 1], 'incompatible-type'],
    ['Append', ['Append', 5, 1], 'incompatible-type'],
    ['Slice', ['Slice', 5, 1, 2], 'incompatible-type'],
  ])('%s refuses %j with %s', (_name, expr, code) => {
    const boxed = ce.box(expr as any);
    expect(boxed.isValid).toBe(false);
    expect(JSON.stringify(boxed.json)).toContain(code);
  });
});
