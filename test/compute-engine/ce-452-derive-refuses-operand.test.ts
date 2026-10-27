/**
 * ROADMAP CE-452 and CE-40.1: a type derivation from operand descriptors
 * never refused an operand that the boxed application refuses.
 *
 * With `s: string` and `n: integer`, the boxed `Add(s, n)` is typed `error`
 * (its canonical form refuses the string), but
 * `deriveApplicationType('Add', [string, integer])` gave `integer | string`.
 * `Multiply(real, boolean)` gave `number`, and `Simplify(Sin(r) * P)` with
 * `P: boolean`, whose held operand is typed through a derivation, was typed
 * `number` while its value is an `incompatible-type` error. The derivation
 * now applies the operand checks of the boxed route to the operand types:
 * the numeric check of the arithmetic operators, and the signature check of
 * the other operators.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

const ce = new ComputeEngine();
ce.declare('s', 'string');
ce.declare('n', 'integer');
ce.declare('r', 'real');
ce.declare('P', 'boolean');
ce.declare('ss', 'list<string>');
ce.declare('ys', 'list<integer>');

function derived(op: string, types: string[]): string {
  const t = deriveApplicationType(
    ce,
    op,
    types.map((x) => describeType(parseType(x)))
  );
  return t === undefined ? 'undefined' : typeToString(t);
}

describe('A DERIVATION REFUSES AN OPERAND THAT BOXING REFUSES (CE-452)', () => {
  test.each([
    ['Add', ['string', 'integer']],
    ['Add', ['real', 'boolean']],
    ['Multiply', ['real', 'boolean']],
    ['Subtract', ['string', 'integer']],
    ['Negate', ['string']],
    ['Add', ['list<string>', 'integer']],
    ['Add', ['string | missing', 'integer']],
    ['Sin', ['string']],
    ['Abs', ['boolean']],
  ])('derives %s over %j as error, as the boxed form', (op, types) => {
    expect(derived(op, types)).toBe('error');
  });

  test.each([
    ['Add', ['integer', 'real'], 'real'],
    ['Add', ['integer | string', 'integer'], 'integer'],
    ['Sin', ['list<number>'], 'list<number>'],
    ['Sin', ['tuple<real, real>'], 'tuple<number, number>'],
  ])('keeps the derivation of %s over %j', (op, types, expected) => {
    expect(derived(op, types)).toBe(expected);
  });

  test('a zip Map of Add over strings and integers is a list of failed cells', () => {
    // Every cell is an `incompatible-type` error: the list is typed as the
    // literal `[<error>, <error>]` is.
    expect(
      ce
        .box(['Map', ['Function', ['Add', 'a', 'b'], 'a', 'b'], 'ss', 'ys'])
        .type.toString()
    ).toBe('list<unknown>');
    expect(ce.box(['Map', 'Add', 'ss', 'ys']).type.toString()).toBe(
      'list<unknown>'
    );
    expect(ce.box(['Map', 'Add', 'ys', 'ys']).type.toString()).toBe(
      'list<integer>'
    );
  });

  test.each([
    ['Sin', ['list<string>']],
    ['Sin', ['list<boolean>']],
    ['Abs', ['set<string>']],
    ['Floor', ['list<string | missing>']],
  ])(
    'derives the broadcast %s over %j as error, as the boxed form',
    (op, types) => {
      expect(derived(op, types)).toBe('error');
    }
  );
});

describe('A HELD PRODUCT WITH A BOOLEAN FACTOR (CE-40.1)', () => {
  test('Simplify(Sin(r) * P) with P: boolean is typed error', () => {
    const expr = ce.box(['Simplify', ['Multiply', ['Sin', 'r'], 'P']]);
    expect(expr.type.toString()).toBe('error');
    expect(expr.evaluate().operator).toBe('Error');
  });
});

describe('A DERIVATION ADMITS A KIND VALUE THAT BOXING ADMITS', () => {
  // `Conjugate` admits a value of a kind admitted as a number (its canonical
  // handler passes `carrier: true`), and `Exp2` admits one whose kind has a
  // `power` hook (`Exp2(x)` is `Power(2, x)`). A measurement is both. The
  // derivation from the operand types refused it and answered `error`.
  test.each(['Conjugate', 'Exp2'])(
    '%s of a measurement derives the boxed type',
    (op) => {
      const boxed = ce.box([op, ['Measurement', 2, 0.1]]);
      expect(boxed.isValid).toBe(true);
      expect(derived(op, ['measurement'])).not.toBe('error');
      expect(derived(op, ['measurement'])).toBe(boxed.type.toString());
    }
  );

  test.each(['Conjugate', 'Exp2'])(
    '%s of a residue class is refused by both routes',
    (op) => {
      expect(ce.box([op, ['ResidueClass', 2, 5]]).type.toString()).toBe(
        'error'
      );
      expect(derived(op, ['residue'])).toBe('error');
    }
  );

  // These heads take a measurement through its carrier. `Exp`, `Exp2`,
  // `Lb`, `Lg`, `Log2` and `Log10` have no `evaluate` handler: their
  // canonical form is a `Power` or a `Log` call, which the derivation now
  // types. The derivation also ran the kind rules only after the engine had
  // boxed a measurement, so each head is derived in a fresh engine first.
  test.each([
    ['Exp', []],
    ['Exp2', []],
    ['Ln', []],
    ['Log', []],
    ['Log', ['integer']],
    ['Log2', []],
    ['Log10', []],
    ['Lb', []],
    ['Lg', []],
    ['Sqrt', []],
    ['Root', ['integer']],
    ['Sin', []],
  ] as const)(
    '%s of a measurement (extra operands %j) derives the boxed type in a fresh engine',
    (op, extra) => {
      const fresh = new ComputeEngine();
      const d = deriveApplicationType(fresh, op, [
        describeType(parseType('measurement')),
        ...extra.map((t) => describeType(parseType(t))),
      ]);
      const boxed = fresh.box([
        op,
        ['Measurement', 2, 0.1],
        ...extra.map(() => 3),
      ]);
      expect(boxed.isValid).toBe(true);
      expect(d === undefined ? 'undefined' : typeToString(d)).toBe(
        boxed.type.toString()
      );
      expect(boxed.type.toString()).toBe('measurement | number');
    }
  );

  // `Lb`, `Lg`, `Log2` and `Log10` built their `Log` call with an arity
  // check only, so a residue class, a quantity or a string was admitted,
  // where `Log` refuses it.
  test.each(['Lb', 'Lg', 'Log2', 'Log10'])(
    '%s refuses a residue class, a quantity and a string, as Log does',
    (op) => {
      for (const v of [['ResidueClass', 2, 5], ['Quantity', 2, 'm'], "'s'"]) {
        const boxed = ce.box([op, v]);
        expect(boxed.isValid).toBe(false);
        expect(boxed.type.toString()).toBe('error');
      }
      expect(derived(op, ['residue'])).toBe('error');
      expect(derived(op, ['quantity'])).toBe('error');
    }
  );
});
