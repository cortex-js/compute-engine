import { ComputeEngine } from '../../src/compute-engine';
import { widenValueTypes } from '../../src/common/type/widen-value';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import type { Type } from '../../src/common/type/types';

/**
 * Number literals carry a value- or sign-carrying type on type-handler
 * INPUT, and every handler result is widened back to ordinary types before
 * it is stored — ruling O9's first half (2026-08-22,
 * `docs/plans/2026-08-22-type-handlers-on-types.md` §4.3, §6), work item 3
 * of the ROADMAP entry "Ranged types should carry sign (and a literal's
 * value) through type derivation".
 *
 * The three-way representation, pinned below:
 * - a machine-exact integer or real is its VALUE type (`21`, `0.5`);
 * - a machine-exact rational keeps its tier through a SINGLETON RANGE
 *   (`finite_rational<0.5..0.5>` — the lattice deliberately does not class
 *   a bare numeric value as rational);
 * - a value no machine number holds exactly is ENCLOSED in a compact
 *   closed range on its tier, both bounds rounded OUTWARD to two
 *   significant digits (`finite_real<1.4..1.5>` for `√2`,
 *   `finite_rational<0.33..0.34>` for `1/3`). The enclosure never claims
 *   a value the literal does not have: it is not a singleton, so
 *   `operandLiteralValue` ignores it, and a value near a pole encloses as
 *   a range that ADMITS but does not assert the pole (`1 − 10⁻³⁰` →
 *   `<0.99..1.1>`). When no sound enclosure exists as doubles (magnitude
 *   outside the double range), the literal falls back to carrying its
 *   SIGN alone (`(finite_integer<0..>) & !0` for `10⁴⁰⁰`).
 *
 * O9's second half was ruled and implemented on 2026-08-23: the public
 * `.type` of a number literal IS that literal type, so `ce.box(21).type` is
 * `21`. The `_literalType` / `handlerTypeOf()` channel pinned below is still
 * the route a type HANDLER reads, and every handler RESULT is still widened
 * back to an ordinary tier before it is stored.
 */

const ce = new ComputeEngine();

const lit = (expr: any): string | undefined => {
  const t = (typeof expr === 'object' && 'engine' in expr ? expr : ce.box(expr))
    ._literalType;
  return t === undefined ? undefined : typeToString(t);
};

describe('LITERAL HANDLER TYPES — the _literalType channel', () => {
  it('machine-exact integers and reals carry their value type', () => {
    expect(lit(21)).toBe('21');
    expect(lit(-3)).toBe('-3');
    expect(lit(0)).toBe('0');
    expect(lit(0.5)).toBe('0.5');
  });

  it('an integer beyond ±2⁵³ is enclosed, not claimed as a value', () => {
    // `1e21` happens to be an exactly representable double, but the bignum
    // store compares doubles through their decimal STRING, which beyond
    // ±2⁵³ can call a rounded double "equal" to a value it does not
    // represent (`1e23` vs `10²³`) — so the exactness test refuses the
    // whole span and the literal carries a two-digit outward enclosure
    // instead of a value type. (The mixed bound spellings are plain
    // JavaScript number formatting: it switches to exponent form at 10²¹.)
    expect(lit(1e21)).toBe('finite_integer<990000000000000000000..1.1e+21>');
  });

  it('a machine-exact rational keeps its tier through a singleton range', () => {
    expect(lit(ce.parse('\\frac12'))).toBe('finite_rational<0.5..0.5>');
    expect(lit(ce.parse('-\\frac{3}{4}'))).toBe(
      'finite_rational<-0.75..-0.75>'
    );
  });

  it('a non-machine-representable value is enclosed outward, never claimed as a rounded double', () => {
    expect(lit(ce.parse('\\frac13'))).toBe('finite_rational<0.33..0.34>');
    expect(lit(ce.parse('-\\frac13'))).toBe('finite_rational<-0.34..-0.33>');
    expect(lit(ce.parse('\\sqrt2').evaluate())).toBe('finite_real<1.4..1.5>');
    // An integer beyond the DOUBLE range has no finite double bounds, so it
    // falls back to proving its sign alone.
    expect(lit(ce.parse('10^{400}').evaluate())).toBe(
      '(finite_integer<0..>) & !0'
    );
    expect(lit(ce.parse('-10^{400}').evaluate())).toBe(
      '(finite_integer<..0>) & !0'
    );
    // A magnitude in the SUBNORMAL double range falls back too: subnormal
    // spacing is absolute (5·10⁻³²⁴), so the nearest-double projection of a
    // bound can cross the value — near the bottom, `7·10⁻³²⁴` would
    // project both bounds onto the same double `5·10⁻³²⁴`, an unsound
    // singleton BELOW the value. See `MIN_NORMAL_DOUBLE` in
    // `boxed-expression/boxed-number.ts`.
    expect(lit(ce.parse('\\frac{7}{10^{324}}').evaluate())).toBe(
      '(finite_rational<0..>) & !0'
    );
    expect(lit(ce.parse('\\frac{-7}{10^{324}}').evaluate())).toBe(
      '(finite_rational<..0>) & !0'
    );
    // Just above the smallest NORMAL double the enclosure still holds. (The
    // specimen must have a non-terminating decimal expansion: a short one
    // like `7·10⁻³⁰⁸` compares string-equal to its double and takes the
    // machine-exact singleton branch instead.)
    expect(lit(ce.parse('\\frac{1}{3\\cdot 10^{307}}').evaluate())).toBe(
      'finite_rational<3.3e-308..3.4e-308>'
    );
  });

  it('NaN, ±∞ and complex literals carry nothing beyond their public type', () => {
    expect(lit(NaN)).toBeUndefined();
    expect(lit(Infinity)).toBeUndefined();
    expect(lit(-Infinity)).toBeUndefined();
    expect(lit(ce.parse('2+3i').evaluate())).toBeUndefined();
  });

  it('symbols and function expressions have no literal type — even when they hold a value', () => {
    const e = new ComputeEngine();
    e.assign('kk', 5);
    expect(e.box('kk')._literalType).toBeUndefined();
    e.declare('x', 'real');
    expect(e.parse('x+1')._literalType).toBeUndefined();
  });

  it('the PUBLIC type of a literal IS its literal type (O9 second half, ruled and implemented 2026-08-23)', () => {
    expect(ce.box(21).type.toString()).toBe('21');
    expect(ce.box(21).type.matches('21')).toBe(true);
    expect(ce.box(0.5).type.toString()).toBe('0.5');
    expect(ce.parse('\\frac12').type.toString()).toBe(
      'finite_rational<0.5..0.5>'
    );
  });

  it('the handler-visible type is a SUBTYPE of the public type', () => {
    for (const e of [
      ce.box(21),
      ce.box(-3),
      ce.box(0.5),
      ce.parse('\\frac12'),
      ce.parse('\\frac13'),
      ce.parse('\\sqrt2').evaluate(),
      ce.parse('10^{400}').evaluate(),
    ]) {
      const t = e._literalType;
      expect(t).toBeDefined();
      expect(ce.type(typeToString(t!)).matches(e.type)).toBe(true);
    }
  });
});

describe('LITERAL HANDLER TYPES — results are widened before storage', () => {
  it('a handler that echoes a literal type stores the ordinary tier', () => {
    const e = new ComputeEngine();
    e.declare('EchoLit', {
      signature: '(number) -> number',
      type: () => '21',
      evaluate: ([x]) => x,
    });
    e.declare('x', 'real');
    // `tuple<1, 2>`-style over-specific contracts must never be stored.
    expect(e.box(['EchoLit', 'x']).type.toString()).toBe('finite_integer');
  });

  it('a ranged handler result passes through the widener untouched', () => {
    const e = new ComputeEngine();
    e.declare('RangedResult', {
      signature: '(number) -> number',
      type: () => 'finite_real<0..>',
      evaluate: ([x]) => x,
    });
    e.declare('x', 'real');
    expect(e.box(['RangedResult', 'x']).type.toString()).toBe(
      'finite_real<0..>'
    );
  });
});

describe('widenValueTypes — the §4.3 walker', () => {
  const widenStr = (s: string): string =>
    typeToString(widenValueTypes(parseType(s)));

  it('rewrites numeric value nodes to their tier', () => {
    expect(widenStr('21')).toBe('finite_integer');
    expect(widenStr('0.5')).toBe('finite_real');
    expect(widenStr('0')).toBe('finite_integer');
  });

  it('descends structural nodes', () => {
    // (`list<21>` as a STRING would parse as a dimension, so the list case
    // is built as a node.)
    const listOf21: Type = {
      kind: 'list',
      elements: { kind: 'value', value: 21 },
    };
    expect(typeToString(widenValueTypes(listOf21))).toBe(
      'list<finite_integer>'
    );
    expect(widenStr('tuple<1, 2>')).toBe(
      'tuple<finite_integer, finite_integer>'
    );
    expect(widenStr('21 | string')).toBe('finite_integer | string');
    expect(widenStr('set<0.5>')).toBe('set<finite_real>');
  });

  it('keeps a contravariant literal: a `(0) -> …` parameter survives', () => {
    // Widening a parameter would make the SIGNATURE narrower, not wider.
    expect(widenStr('(0) -> 21')).toBe('(0) -> finite_integer');
  });

  it('a negation flips polarity: `!0` is preserved', () => {
    expect(widenStr('(finite_real<0..>) & !0')).toBe(
      '(finite_real<0..>) & !0'
    );
  });

  it('open ranges are handler claims: they pass through', () => {
    expect(widenStr('integer<0..10>')).toBe('integer<0..10>');
    expect(widenStr('real<0..>')).toBe('real<0..>');
  });

  it('a RATIONAL singleton range widens to its tier: it is literal cargo', () => {
    // A singleton range on the rational tier is the exact-rational literal
    // representation (ruling O9 — the lattice has no value node that keeps
    // the rational tier), so at a covariant storage position it widens
    // exactly like a value node. Contravariant positions keep it, same
    // polarity rule as `value` nodes — and a singleton range on any OTHER
    // tier is an author's narrowing, not literal cargo, and passes through.
    expect(widenStr('finite_rational<0.5..0.5>')).toBe('finite_rational');
    expect(widenStr('(finite_rational<0.5..0.5>) -> integer')).toBe(
      '(finite_rational<0.5..0.5>) -> integer'
    );
    expect(widenStr('finite_integer<5..5>')).toBe('finite_integer<5..5>');
  });

  it('string and boolean value types are leaves', () => {
    expect(widenStr('"abc"')).toBe('"abc"');
  });

  it('rewrites NaN and ±∞ value nodes', () => {
    const nan: Type = { kind: 'value', value: NaN };
    const inf: Type = { kind: 'value', value: Infinity };
    expect(widenValueTypes(nan)).toBe('number');
    expect(widenValueTypes(inf)).toBe('non_finite_number');
  });

  it('returns an unchanged type by identity (no rebuild, no cycle risk)', () => {
    const t = parseType('list<tuple<finite_integer, string>>');
    expect(widenValueTypes(t)).toBe(t);
    // A recursive type reaches its own body only through a `reference`
    // node, which is a leaf here — identity again.
    const e = new ComputeEngine();
    e.declareType('LinkedList', 'tuple<value: integer, next: LinkedList>', {
      nominal: true,
    });
    const rec = e.type('LinkedList').type;
    expect(widenValueTypes(rec)).toBe(rec);
  });
});

describe('LITERAL HANDLER TYPES — enclosure soundness', () => {
  // The bounds of a literal's enclosing range are DOUBLES; the value they
  // enclose is exact. Verify `lower <= value <= upper` exactly, by
  // decomposing each double bound into its dyadic fraction (power-of-two
  // scaling is lossless) and cross-multiplying in bigints.
  const dyadic = (n: number): [bigint, bigint] => {
    let num = n;
    let den = 1n;
    while (!Number.isInteger(num)) {
      num *= 2;
      den *= 2n;
    }
    return [BigInt(num), den];
  };
  const bounds = (expr: any): [number, number] => {
    const t = (
      typeof expr === 'object' && 'engine' in expr ? expr : ce.box(expr)
    )._literalType;
    expect(t).toBeDefined();
    expect(typeof t).toBe('object');
    if (typeof t !== 'object' || t.kind !== 'numeric')
      throw new Error('not a range');
    expect(t.lower).toBeDefined();
    expect(t.upper).toBeDefined();
    return [t.lower!, t.upper!];
  };

  it('rational enclosures contain the exact rational, strictly excluding 0', () => {
    for (const [p, q] of [
      [1n, 3n],
      [-1n, 3n],
      [2n, 7n],
      [22n, 7n],
      [1n, 999999937n],
      [123456789123456789n, 1000000000000000003n],
      [-987654321n, 11n],
    ] as const) {
      const [lower, upper] = bounds(ce.parse(`\\frac{${p}}{${q}}`));
      const [ln, ld] = dyadic(lower);
      const [un, ud] = dyadic(upper);
      // lower ≤ p/q ≤ upper (q > 0): ln·q·ud ≤ p·ld·ud and p·ld·ud ≤ un·q·ld
      expect(ln * q <= p * ld).toBe(true);
      expect(p * ud <= un * q).toBe(true);
      // The enclosure keeps the sign fact the `& !0` range used to carry.
      expect(lower > 0 === p > 0n).toBe(true);
      expect(upper < 0 === p < 0n).toBe(true);
    }
  });

  it('radical enclosures contain the exact root', () => {
    for (const k of [2n, 3n, 5n, 7n, 999983n]) {
      const [lower, upper] = bounds(ce.parse(`\\sqrt{${k}}`).evaluate());
      const [ln, ld] = dyadic(lower);
      const [un, ud] = dyadic(upper);
      // lower ≤ √k ≤ upper with lower > 0: lower² ≤ k and k ≤ upper²
      expect(lower).toBeGreaterThan(0);
      expect(ln * ln <= k * ld * ld).toBe(true);
      expect(k * ud * ud <= un * un).toBe(true);
    }
  });

  it('an enclosure is never a singleton, so no handler reads a value off it', () => {
    // `operandLiteralValue` treats a SINGLETON range as the literal's value
    // (that is the machine-exact-rational spelling). An outward enclosure of
    // a non-machine value must therefore never collapse to one.
    for (const s of ['\\frac13', '\\sqrt2', '10^{30}+1']) {
      const [lower, upper] = bounds(ce.parse(s).evaluate());
      expect(lower).toBeLessThan(upper);
    }
  });
});

describe('LITERAL HANDLER TYPES — precision edge (kept last: constructing a high-precision engine reprecisions the module-global BigDecimal)', () => {
  it('a bignum a half-ulp from a pole does NOT claim the pole value', () => {
    const hp = new ComputeEngine({ precision: 40 });
    const nearOne = hp.parse('1 - 10^{-30}').evaluate();
    // `re` rounds to exactly 1; claiming the value type `1` would let
    // `Artanh(1 − 10⁻³⁰)` classify as the pole at 1. (The exact evaluation
    // produces the rational `(10³⁰−1)/10³⁰`, hence the rational tier.)
    // The enclosure ADMITS 1 — the value sits within the outward padding of
    // the grid point, so both neighboring notches appear — but it is not a
    // singleton, so no handler reads a value off it
    // (`operandLiteralValue` returns undefined for it).
    expect(nearOne.re).toBe(1);
    const t = nearOne._literalType;
    expect(t === undefined ? undefined : typeToString(t)).toBe(
      'finite_rational<0.99..1.1>'
    );
  });

  it('exactness is decided by exact rational comparison, not through the working-precision projection', () => {
    // At DEFAULT precision, `bignumRe` of `(10³⁰−1)/10³⁰` ROUNDS to
    // exactly 1.0, and a comparison through that projection called the
    // value "equal" to the double 1 — the literal claimed the VALUE type
    // `1` for a value provably ≠ 1 (the artanh-pole class; regression
    // fixed 2026-08-27 with `rationalEqualsDecimal`). The exact-rational
    // comparison is precision-independent, so the sound enclosure appears
    // at every precision.
    const dp = new ComputeEngine(); // default precision
    const nearOne = dp.parse('1 - 10^{-30}').evaluate();
    expect(nearOne.isSame(1)).toBe(false); // the value IS the exact rational
    expect(nearOne.type.toString()).toBe('finite_rational<0.99..1.1>');
    // The engine's decimal reading of doubles is preserved: an exact
    // rational whose decimal expansion terminates within double range is
    // still "machine-exact" (`1/5` ≡ `0.2` — the isSame convention).
    expect(dp.parse('\\frac15').type.toString()).toBe(
      'finite_rational<0.2..0.2>'
    );
    expect(dp.parse('\\frac{7}{5}').type.toString()).toBe(
      'finite_rational<1.4..1.4>'
    );
  });
});
