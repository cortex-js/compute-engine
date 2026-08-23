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
 * - a value no machine number holds exactly carries its SIGN
 *   (`finite_real<0..> & !0` for `√2`), never a rounded double — a rounded
 *   bound could put `1 − 10⁻³⁰` "at" a pole or unsoundly tighten a range.
 *
 * The public `.type` is deliberately UNCHANGED (O9's second half is open):
 * literal types are visible through `_literalType` / `handlerTypeOf()`
 * only.
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

  it('an integer beyond ±2⁵³ carries only its sign', () => {
    // `1e21` happens to be an exactly representable double, but the bignum
    // store compares doubles through their decimal STRING, which beyond
    // ±2⁵³ can call a rounded double "equal" to a value it does not
    // represent (`1e23` vs `10²³`) — so the exactness test refuses the
    // whole span and the literal carries its sign instead.
    expect(lit(1e21)).toBe('(finite_integer<0..>) & !0');
  });

  it('a machine-exact rational keeps its tier through a singleton range', () => {
    expect(lit(ce.parse('\\frac12'))).toBe('finite_rational<0.5..0.5>');
    expect(lit(ce.parse('-\\frac{3}{4}'))).toBe(
      'finite_rational<-0.75..-0.75>'
    );
  });

  it('a non-machine-representable value carries its sign, never a rounded double', () => {
    expect(lit(ce.parse('\\frac13'))).toBe('(finite_rational<0..>) & !0');
    expect(lit(ce.parse('-\\frac13'))).toBe('(finite_rational<..0>) & !0');
    expect(lit(ce.parse('\\sqrt2').evaluate())).toBe('(finite_real<0..>) & !0');
    // An integer beyond the double range still proves its sign.
    expect(lit(ce.parse('10^{400}').evaluate())).toBe(
      '(finite_integer<0..>) & !0'
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

  it('the PUBLIC type of a literal is unchanged (O9 second half is open)', () => {
    expect(ce.box(21).type.toString()).toBe('finite_integer');
    expect(ce.box(21).type.matches('21')).toBe(false);
    expect(ce.box(0.5).type.toString()).toBe('finite_real');
    expect(ce.parse('\\frac12').type.toString()).toBe('finite_rational');
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

  it('ranges are not literals: they pass through', () => {
    expect(widenStr('integer<0..10>')).toBe('integer<0..10>');
    expect(widenStr('finite_rational<0.5..0.5>')).toBe(
      'finite_rational<0.5..0.5>'
    );
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

describe('LITERAL HANDLER TYPES — precision edge (kept last: constructing a high-precision engine reprecisions the module-global BigDecimal)', () => {
  it('a bignum a half-ulp from a pole does NOT claim the pole value', () => {
    const hp = new ComputeEngine({ precision: 40 });
    const nearOne = hp.parse('1 - 10^{-30}').evaluate();
    // `re` rounds to exactly 1; claiming the value type `1` would let
    // `Artanh(1 − 10⁻³⁰)` classify as the pole at 1. (The exact evaluation
    // produces the rational `(10³⁰−1)/10³⁰`, hence the rational tier.)
    expect(nearOne.re).toBe(1);
    const t = nearOne._literalType;
    expect(t === undefined ? undefined : typeToString(t)).toBe(
      '(finite_rational<0..>) & !0'
    );
  });
});
