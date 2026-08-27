import { ComputeEngine } from '../../src/compute-engine';
import { typeAcceptsValue } from '../../src/compute-engine/boxed-expression/value-membership';

/**
 * Phase 0 of the function-polymorphism design
 * (docs/TYPE-SYSTEM.md §4.1, §7):
 * value types are inhabitable. A concrete value is tested against a
 * value-component type by MEMBERSHIP (`typeAcceptsValue`), not by its
 * synthesized type — `ce.box(0).type` is `finite_integer`, which is not a
 * subtype of the value type `0`, yet `0` plainly inhabits it.
 */

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

// ─── Lattice fix: a finite literal claims the finite base type ──────────────

describe('VALUE TYPES — subtype lattice', () => {
  it('an integer value type is a subtype of finite_integer', () => {
    expect(ce.type('0').matches('finite_integer')).toBe(true);
    expect(ce.type('0').matches('integer')).toBe(true);
    expect(ce.type('0').matches('finite_real')).toBe(true);
    expect(ce.type('0').matches('finite_number')).toBe(true);
  });

  it('a non-integer value type is a subtype of finite_real', () => {
    expect(ce.type('3.5').matches('finite_real')).toBe(true);
    expect(ce.type('3.5').matches('real')).toBe(true);
    expect(ce.type('3.5').matches('integer')).toBe(false);
  });

  it('the reverse direction stays false', () => {
    expect(ce.type('finite_integer').matches('0')).toBe(false);
    expect(ce.type('integer').matches('0')).toBe(false);
  });
});

// ─── The membership predicate ───────────────────────────────────────────────

describe('VALUE MEMBERSHIP — typeAcceptsValue', () => {
  const t = (s: string) => ce.type(s).type;

  it('numeric literals inhabit their value types', () => {
    expect(typeAcceptsValue(ce.box(0), t('0'))).toBe(true);
    expect(typeAcceptsValue(ce.box(1), t('0'))).toBe(false);
    expect(typeAcceptsValue(ce.box(3.5), t('3.5'))).toBe(true);
  });

  it('exactness is the engine value identity (0.0 boxes to exact 0)', () => {
    // The engine normalizes at boxing: `0.0` IS the exact integer 0.
    expect(typeAcceptsValue(ce.box({ num: '0.0' }), t('0'))).toBe(true);
    // −0.0 normalizes to 0 as well.
    expect(typeAcceptsValue(ce.box(-0.0), t('0'))).toBe(true);
  });

  it('NaN is a member of exactly the `NaN` value type (amended 2026-08-02)', () => {
    // The value type is spelled with the CAPITALIZED `NaN`. The lowercase
    // `nan` names the not-a-number PRIMITIVE type, which this predicate does
    // not decide: a primitive has no value component, so membership in it
    // coincides with subtyping and the caller has already checked that.
    expect(typeAcceptsValue(ce.box(NaN), t('NaN'))).toBe(true);
    expect(typeAcceptsValue(ce.box(NaN), t('0'))).toBe(false);
    expect(typeAcceptsValue(ce.box(NaN), t('integer<0..10>'))).toBe(false);
    // …and nothing else inhabits the `NaN` value type.
    expect(typeAcceptsValue(ce.box(0), t('NaN'))).toBe(false);
    expect(typeAcceptsValue(ce.box(Infinity), t('NaN'))).toBe(false);
  });

  it('infinities match only themselves', () => {
    expect(typeAcceptsValue(ce.box(Infinity), t('oo'))).toBe(true);
    expect(typeAcceptsValue(ce.box(-Infinity), t('-oo'))).toBe(true);
    expect(typeAcceptsValue(ce.box(Infinity), t('-oo'))).toBe(false);
    expect(typeAcceptsValue(ce.box(-Infinity), t('oo'))).toBe(false);
    expect(typeAcceptsValue(ce.box(5), t('oo'))).toBe(false);
  });

  it('string and boolean literals inhabit their value types', () => {
    expect(typeAcceptsValue(ce.box({ str: 'red' }), t('"red"'))).toBe(true);
    expect(typeAcceptsValue(ce.box({ str: 'blue' }), t('"red"'))).toBe(false);
    expect(typeAcceptsValue(ce.box('True'), t('true'))).toBe(true);
    expect(typeAcceptsValue(ce.box('False'), t('true'))).toBe(false);
    expect(typeAcceptsValue(ce.box('False'), t('false'))).toBe(true);
  });

  it('bounded numeric types: inclusive endpoints, base-kind respected', () => {
    expect(typeAcceptsValue(ce.box(7), t('integer<5..10>'))).toBe(true);
    expect(typeAcceptsValue(ce.box(5), t('integer<5..10>'))).toBe(true);
    expect(typeAcceptsValue(ce.box(10), t('integer<5..10>'))).toBe(true);
    expect(typeAcceptsValue(ce.box(4), t('integer<5..10>'))).toBe(false);
    expect(typeAcceptsValue(ce.box(11), t('integer<5..10>'))).toBe(false);
    // A non-integer float does not inhabit an integer-based range.
    expect(typeAcceptsValue(ce.box(7.5), t('integer<5..10>'))).toBe(false);
  });

  it('unions and intersections recurse', () => {
    expect(typeAcceptsValue(ce.box(0), t('0 | 1'))).toBe(true);
    expect(typeAcceptsValue(ce.box(1), t('0 | 1'))).toBe(true);
    expect(typeAcceptsValue(ce.box(2), t('0 | 1'))).toBe(false);
  });

  it('a symbol is followed one hop into a literal binding', () => {
    ce.assign('k', 0);
    expect(typeAcceptsValue(ce.box('k'), t('0'))).toBe(true);
    // A symbol with no value is not a concrete value (undecidable → false).
    expect(typeAcceptsValue(ce.box('n'), t('0'))).toBe(false);
  });

  it('error values and applications are members of nothing', () => {
    expect(typeAcceptsValue(ce.box(['Error', { str: 'x' }]), t('0'))).toBe(
      false
    );
    expect(
      typeAcceptsValue(ce.box(['Add', 'a', 'b'], { canonical: false }), t('0'))
    ).toBe(false);
  });

  it('bails (false) when the type has no value component', () => {
    // Membership is a fallback: plain subtyping already covers these.
    expect(typeAcceptsValue(ce.box(0), t('integer'))).toBe(false);
  });

  it('range bounds compare exactly — no double projection', () => {
    // 2^53 + 1 is not double-representable: `.re` would round it onto 2^53
    // and wrongly admit it into a range capped there.
    const v = ce.box({ num: '9007199254740993' }); // 2^53 + 1
    expect(v.isSame(ce.box({ num: '9007199254740992' }))).toBe(false);
    expect(
      typeAcceptsValue(v, t('integer<0..9007199254740992>'))
    ).toBe(false);
  });

  it('a non-real value never inhabits a bounded range', () => {
    // Bounds are only meaningful over an ordered (real) domain. (The range
    // grammar only admits real base kinds — `complex<0..10>` does not parse
    // — so the base-kind check rejects and the `isReal` guard in the
    // numeric branch is defense-in-depth.)
    const z = ce.box(['Complex', 5, 1000]).evaluate();
    expect(typeAcceptsValue(z, t('real<0..10>'))).toBe(false);
  });

  it('fully-known List/Tuple values recurse element-wise', () => {
    // NOTE: in the type grammar a bare integer inside `list<…>` is a
    // DIMENSION, not an element value type: `list<0>` = zero-length list of
    // any. A dimension is not a value component, so the predicate BAILS
    // (false) and ordinary subtyping on the synthesized type governs.
    expect(typeAcceptsValue(ce.box(['List']), t('list<0>'))).toBe(false);
    expect(typeAcceptsValue(ce.box(['List', 0]), t('list<0>'))).toBe(false);
    // Element value types spell as types: `list<"red">`, `tuple<0, "x">`.
    expect(
      typeAcceptsValue(ce.box(['List', { str: 'red' }]), t('list<"red">'))
    ).toBe(true);
    expect(
      typeAcceptsValue(
        ce.box(['List', { str: 'red' }, { str: 'red' }]),
        t('list<"red">')
      )
    ).toBe(true);
    expect(
      typeAcceptsValue(ce.box(['List', { str: 'blue' }]), t('list<"red">'))
    ).toBe(false);
    expect(
      typeAcceptsValue(ce.box(['Tuple', 0, { str: 'x' }]), t('tuple<0, "x">'))
    ).toBe(true);
    expect(
      typeAcceptsValue(ce.box(['Tuple', 1, { str: 'x' }]), t('tuple<0, "x">'))
    ).toBe(false);
    // Arity mismatch on a tuple refutes.
    expect(typeAcceptsValue(ce.box(['Tuple', 0]), t('tuple<0, "x">'))).toBe(
      false
    );
    // A collection containing a symbolic element is not a concrete value.
    expect(
      typeAcceptsValue(ce.box(['List', 'someSym']), t('list<"red">'))
    ).toBe(false);
  });
});

// ─── Wiring: declared types (assign / declare-with-value) ───────────────────

describe('VALUE MEMBERSHIP — declared types accept their witnesses', () => {
  it('z: 0; z := 0 works; z := 1 rejected', () => {
    ce.declare('z', '0');
    expect(() => ce.assign('z', 0)).not.toThrow();
    expect(ce.box('z').evaluate().toString()).toBe('0');
    ce.declare('z2', '0');
    expect(() => ce.assign('z2', 1)).toThrow();
  });

  it('declare-with-value route accepts the witness', () => {
    expect(() => ce.declare('w', { type: '0', value: 0 })).not.toThrow();
    expect(() =>
      ce.declare('w2', { type: '"red"', value: ce.string('red') })
    ).not.toThrow();
  });

  it('string- and boolean-value-typed symbols accept their witnesses', () => {
    ce.declare('s', '"red"');
    expect(() => ce.assign('s', ce.string('red'))).not.toThrow();
    ce.declare('s2', '"red"');
    expect(() => ce.assign('s2', ce.string('blue'))).toThrow();
    ce.declare('b', 'true');
    expect(() => ce.assign('b', ce.box('True'))).not.toThrow();
  });

  it('bounded-range declared type accepts in-range, rejects out-of-range', () => {
    ce.declare('r', 'integer<0..10>');
    expect(() => ce.assign('r', 7)).not.toThrow();
    ce.declare('r2', 'integer<0..10>');
    expect(() => ce.assign('r2', 11)).toThrow();
  });
});

// ─── Wiring: argument validation (single signature and overload set) ────────

describe('VALUE MEMBERSHIP — argument validation', () => {
  it('g: (0) -> integer accepts g(0), rejects g(1)', () => {
    ce.declare('g', '(0) -> integer');
    expect(ce.box(['g', 0]).isValid).toBe(true);
    expect(ce.box(['g', 1]).isValid).toBe(false);
  });

  it('range parameter: inclusive endpoints', () => {
    ce.declare('h', '(integer<5..10>) -> integer');
    expect(ce.box(['h', 5]).isValid).toBe(true);
    expect(ce.box(['h', 10]).isValid).toBe(true);
    expect(ce.box(['h', 7]).isValid).toBe(true);
    expect(ce.box(['h', 4]).isValid).toBe(false);
  });

  it('overload set with a value arm admits the literal call', () => {
    ce.declare('ov', '((0) -> string) & ((integer) -> integer)');
    expect(ce.box(['ov', 0]).isValid).toBe(true);
    expect(ce.box(['ov', 3]).isValid).toBe(true);
    expect(ce.box(['ov', { str: 'x' }]).isValid).toBe(false);
  });

  it('membership admission never narrows a symbol to the value type', () => {
    // `k` is admitted into `g: (0) -> integer` by value membership; the
    // final inference pass must NOT pin `k`'s type to the value type `0`
    // (deferred admission, like the other provisional branches).
    ce.assign('k', 0);
    ce.declare('g2', '(0) -> integer');
    expect(ce.box(['g2', 'k']).isValid).toBe(true);
    expect(ce.box('k').type.toString()).not.toBe('0');
  });
});
