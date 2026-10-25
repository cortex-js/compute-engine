import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { widenValueTypes } from '../../src/common/type/widen-value';
import { machineNumberOf } from '../../src/compute-engine/boxed-expression/machine-number';
import type { Expression } from '../../src/compute-engine/types-expression';

// A union that holds both signed infinities is a fixed point of the widening
// of type-handler results: widening `+oo` or `-oo` gives the pair, which the
// union already holds. Before, `real | +oo | -oo` (the type of every
// extended-real symbol) was rebuilt and reduced again at each widening, once
// per type-handler result (CE-327).
describe('widenValueTypes keeps a union that holds the signed-infinity pair', () => {
  for (const spelling of [
    'real | signed_infinity',
    'signed_infinity',
    'real<0..> | signed_infinity',
    'nan | real | signed_infinity',
  ]) {
    test(spelling, () => {
      const t = parseType(spelling);
      expect(widenValueTypes(t)).toBe(t);
    });
  }

  test('a lone signed infinity still widens to the pair', () => {
    expect(typeToString(widenValueTypes(parseType('integer | +oo')))).toBe(
      'integer | signed_infinity'
    );
    expect(
      typeToString(widenValueTypes({ kind: 'value', value: -Infinity }))
    ).toBe('signed_infinity');
  });

  test('a finite value in the same union is still widened', () => {
    const t = parseType('real | signed_infinity');
    if (typeof t !== 'object' || t.kind !== 'union') throw new Error('union');
    const withValue = {
      kind: 'union' as const,
      types: [...t.types, { kind: 'value' as const, value: 3 }],
    };
    expect(typeToString(widenValueTypes(withValue))).toBe(
      'real | signed_infinity'
    );
  });
});

// A higher-order operator whose source is not a collection declines (or
// reports the callback-last misorder) whatever its callback is. It used to
// canonicalize the callback anyway, and in a misordered nested call the
// callback is the inner call: each level then canonicalized the level below
// three times, so the work was 3^depth (CE-347).
describe('misordered nested callback operators canonicalize each level once', () => {
  const P = ['Function', ['Greater', 'x', 0], 'x'];
  const F = ['Function', ['Multiply', 'x', 2], 'x'];
  const R = ['Function', ['Add', 'a', 'x'], 'a', 'x'];
  const shapes: Record<string, (inner: unknown) => unknown> = {
    Map: (e) => ['Map', e, F],
    Filter: (e) => ['Filter', P, e],
    Fold: (e) => ['List', ['Fold', e, R, 0]],
    TakeWhile: (e) => ['TakeWhile', P, e],
    DropWhile: (e) => ['DropWhile', P, e],
    FlatMap: (e) => ['FlatMap', ['Function', ['List', 'x'], 'x'], e],
    MaxBy: (e) => ['MaxBy', P, e],
    MinBy: (e) => ['MinBy', P, e],
  };
  for (const [op, wrap] of Object.entries(shapes)) {
    test(op, () => {
      const counts: number[] = [];
      for (const depth of [3, 6]) {
        const ce = new ComputeEngine();
        const def = ce.lookupDefinition(op) as unknown as {
          operator: { canonical: (...args: unknown[]) => unknown };
        };
        const original = def.operator.canonical;
        let count = 0;
        def.operator.canonical = (...args: unknown[]) => {
          count += 1;
          return original(...args);
        };
        let e: unknown = ['Range', 1, 3];
        for (let i = 0; i < depth; i++) e = wrap(e);
        ce.box(e as Parameters<typeof ce.box>[0]);
        counts.push(count);
      }
      // Linear: twice the depth costs about twice the calls. The former
      // cost was 13 and 364 calls (`Map`), or 26 and 728.
      expect(counts[1]).toBeLessThanOrEqual(2 * counts[0] + 2);
    });
  }

  test('the misordered Map still reports the callback-slot error', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Map',
      ['Range', 1, 5],
      ['Function', ['Multiply', 'x', 2], 'x'],
    ]);
    expect(e.toString()).toBe(
      'Map(Error(ErrorCode("incompatible-type", "function", "range"), Range(1, 5)), (x) => 2x)'
    );
  });
});

// The `array` facet of a list of big-number floats admits an element when
// re-boxing its double gives the same expression. That test is now made on
// the decimals, without boxing the double again (CE-337). It must give the
// same answer as the definition.
describe('machineNumberOf on big-number floats agrees with re-boxing', () => {
  // The definition for an INEXACT value. An exact value (an integer-valued
  // big decimal such as `1.7976931348623157e308` boxes as an exact integer)
  // is tested on its exact representation instead, by another branch.
  const reference = (target: Expression): number | undefined => {
    if (target.isExact) return machineNumberOf(target);
    const x = target.re;
    return target.engine.number(x).isSame(target) ? x : undefined;
  };
  const spellings = [
    '0.1',
    '0.1000000000000000055511151231257827',
    '0.10000000000000001',
    '1.24537705751568672',
    '0.3773114712421566',
    '-0.3',
    '1e-320',
    '2.5e-308',
    '1.7976931348623157e308',
    '123456789012345678.5',
    '9007199254740993.5',
    '-12345.678901234567',
  ];
  for (const precision of [21, 50]) {
    test(`precision ${precision}`, () => {
      const ce = new ComputeEngine();
      ce.precision = precision;
      for (const s of spellings) {
        const b = ce.number(ce.bignum(s));
        expect([s, machineNumberOf(b)]).toEqual([s, reference(b)]);
      }
      for (let i = 0; i < 200; i++) {
        const v = 2 - 2 * (Math.sin(i) * 0.37 + 0.5);
        const b = ce.number(ce.bignum(String(v)));
        expect(machineNumberOf(b)).toBe(reference(b));
      }
    });
  }

  test('a big-number float made at a higher precision, read at machine precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const values = spellings.map((s) => ce.number(ce.bignum(s)));
    ce.precision = 'machine';
    for (const b of values) expect(machineNumberOf(b)).toBe(reference(b));
  });

  test('the array facet of a list of such floats', () => {
    const ce = new ComputeEngine();
    const vals = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.37);
    const list = ce.function(
      'List',
      vals.map((v) => ce.number(ce.bignum(String(v))))
    );
    expect(list.array).toEqual(vals.map((v) => (v === 0 ? 0 : v)));
  });
});
