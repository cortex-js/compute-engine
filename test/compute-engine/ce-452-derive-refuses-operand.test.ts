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
