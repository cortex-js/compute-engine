import { ComputeEngine } from '../../src/compute-engine';

/**
 * Assignment of a RESTRICTED (gated) value — `5 {a > 0}` — to a symbol that
 * an assumption or a declared range constrains.
 *
 * A restriction holds its value operand when its condition is true and the
 * absence marker when it is false. Both checks at the assignment site must
 * therefore judge the value the restriction PRESENTS: the `missing` arm is
 * removed, and the number literal the restriction holds is read back, because
 * the restriction's own type has widened it to its tier (`5 {a > 0}` types
 * `integer | missing`, and `integer` inhabits no range).
 *
 * The rule to hold: a gated value binds exactly when its ungated value
 * operand binds, and is refused with the same message when it does not.
 * (User ruling of 2026-09-22.)
 */
describe('gated value assignment', () => {
  describe('under an assumption', () => {
    test('a gated value that satisfies the assumption binds', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('v > 3'));
      ce.assign('v', ce.parse('5\\{a>0\\}'));
      expect(ce.box('v').evaluate().toString()).toBe('5 {0 < a}');
    });

    test('the ungated value binds (control)', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('v > 3'));
      ce.assign('v', 5);
      expect(ce.box('v').evaluate().toString()).toBe('5');
    });

    test('a gated value that breaks the assumption is refused', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('v > 3'));
      expect(() => ce.assign('v', ce.parse('1\\{a>0\\}'))).toThrow(
        'refused by the assumptions in force, which require the type "real<3<..>"'
      );
    });

    test('the ungated value is refused with the same message (control)', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('v > 3'));
      expect(() => ce.assign('v', 1)).toThrow(
        'refused by the assumptions in force, which require the type "real<3<..>"'
      );
    });

    // The type a fact contributes is only a summary of it: an equality
    // contributes the promoted TIER of its value, so `x = 5` leaves the type
    // check happy with any integer and only the fact itself can refuse `7`.
    // The fact is asked of the value the restriction holds, so it refuses the
    // gated `7` exactly as it refuses the ungated one.
    test('an equality fact refuses a gated value that breaks it', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x = 5'));
      expect(() => ce.assign('x', ce.parse('7\\{a>0\\}'))).toThrow(
        'refused by the assumption in force "x == 5"'
      );
    });

    test('an equality fact refuses the ungated value (control)', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x = 5'));
      expect(() => ce.assign('x', 7)).toThrow(
        'refused by the assumption in force "x == 5"'
      );
    });
  });

  describe('against a declared range', () => {
    test('a gated value inside the range binds', () => {
      const ce = new ComputeEngine();
      ce.declare('e', 'integer<3<..>');
      ce.assign('e', ce.parse('5\\{a>0\\}'));
      expect(ce.box('e').evaluate().toString()).toBe('5 {0 < a}');
    });

    test('the ungated value binds (control)', () => {
      const ce = new ComputeEngine();
      ce.declare('e', 'integer<3<..>');
      ce.assign('e', 5);
      expect(ce.box('e').evaluate().toString()).toBe('5');
    });

    test('a gated value outside the range is refused', () => {
      const ce = new ComputeEngine();
      ce.declare('e', 'integer<3<..>');
      expect(() => ce.assign('e', ce.parse('2\\{a>0\\}'))).toThrow(
        'is not compatible with the type "integer<4..>"'
      );
    });

    test('the ungated value is refused with the same message (control)', () => {
      const ce = new ComputeEngine();
      ce.declare('e', 'integer<3<..>');
      expect(() => ce.assign('e', 2)).toThrow(
        'is not compatible with the type "integer<4..>"'
      );
    });

    // The declare-with-value route runs the same check, so it binds too.
    test('declaring with a gated value binds', () => {
      const ce = new ComputeEngine();
      ce.declare('e', {
        type: 'integer<3<..>',
        value: ce.parse('5\\{a>0\\}'),
      });
      expect(ce.box('e').evaluate().toString()).toBe('5 {0 < a}');
    });
  });

  describe('the restriction type is unchanged', () => {
    // The refinement lives at the assignment site, not in the `When` type
    // handler: a handler result is widened back to ordinary types, so the
    // handler cannot keep the literal `5` in the type it stores.
    test('a scalar restriction types the tier joined with missing', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('5\\{a>0\\}').type.toString()).toBe('integer | missing');
    });

    test('a list-broadcast restriction types a list of cells', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('[10,20,30]\\{[1,2,3]>2\\}').type.toString()).toBe(
        'list<integer | missing>'
      );
    });
  });

  describe('list-broadcast restrictions keep their own type', () => {
    test('a masked list binds to a declared list', () => {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<integer>');
      ce.assign('L', ce.parse('[10,20,30]\\{[1,2,3]>2\\}'));
      expect(ce.box('L').evaluate().toString()).toBe(
        '["Missing","Missing",30]'
      );
    });

    test('a scalar masked by a list of conditions binds to a declared list', () => {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<integer>');
      ce.assign('L', ce.parse('5\\{[a>0, b>0]\\}'));
      expect(ce.box('L').evaluate().toString()).toBe('[5 {0 < a},5 {0 < b}]');
    });
  });
});
