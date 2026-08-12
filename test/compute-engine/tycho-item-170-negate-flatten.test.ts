import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 170 (2026-08-12): `canonicalMultiply` flattened nested `Multiply`
// operands BEFORE stripping `Negate`, so a `Negate` wrapping a product hid one
// from the flatten pass:
//
//   Multiply(Negate(Multiply(a, b)), c)
//     flatten  -> unchanged (no direct `Multiply` operand)
//     unnegate -> sign = -1, operands [Multiply(a, b), c]
//     result   -> Negate(Multiply(c, Multiply(a, b)))   <- nested + unordered
//
// `.json` flattens `Multiply` on serialization, so the unflattened node
// serialized as `["Negate", ["Multiply", "a", "b", "c"]]` — byte-identical to
// the flat form — while `isSame` and `hash` (which see the real operand tree)
// disagreed about them. Consumers that treat serialized canonical MathJSON as
// the identity authority therefore saw one object with two identities, in
// violation of the `hash` contract (`isSame ⇒ equal hash`).
//
// The fix runs the unnegate pass as a queue that re-enters lifted operands, so
// flattening and the sign channel stay in lockstep at any depth.

describe('Tycho item 170: a negated product flattens and orders', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  // The operand tree, spelled as an ASCII string, is the facet `.json` hides.
  const shape = (expr: any) => expr.toString();

  describe('shape A: Negate hiding a nested product', () => {
    test('canonical Multiply has no Multiply operand', () => {
      const expr = ce.box(['Multiply', ['Multiply', 'b', ['Negate', 'a']], 'c']);
      expect(expr.json).toEqual(['Negate', ['Multiply', 'a', 'b', 'c']]);
      expect(shape(expr)).toEqual('-(a * b * c)');
      expect(expr.op1.ops!.every((x) => x.operator !== 'Multiply')).toBe(true);
    });

    test('parse round-trips to an identical box', () => {
      const expr = ce.parse('(b\\cdot-a)c', { strict: false });
      const back = ce.parse(expr.toLatex({ materialization: false }), {
        strict: false,
      });
      expect(expr.json).toEqual(back.json);
      expect(expr.isSame(back)).toBe(true);
      expect(expr.hash).toEqual(back.hash);
    });

    test('re-boxing the serialized json yields the same box', () => {
      const expr = ce.parse('(b\\cdot-a)c', { strict: false });
      expect(ce.box(expr.json).isSame(expr)).toBe(true);
    });
  });

  describe('shape B: negated rational coefficient in front of a product', () => {
    test('canonical Multiply has no Multiply operand', () => {
      const expr = ce.parse('\\frac{1}{2}(-sx^2)');
      expect(expr.json).toEqual([
        'Multiply',
        ['Rational', -1, 2],
        's',
        ['Power', 'x', 2],
      ]);
      expect(expr.ops!.every((x) => x.operator !== 'Multiply')).toBe(true);
    });

    test('parse round-trips to an identical box', () => {
      const expr = ce.parse('-(\\frac{1}{2})s\\cdot x^2');
      const back = ce.parse(expr.toLatex({ materialization: false }));
      expect(expr.json).toEqual(back.json);
      expect(expr.isSame(back)).toBe(true);
      expect(expr.hash).toEqual(back.hash);
    });
  });

  describe('the two spellings of one product agree', () => {
    // Every one of these is the same canonical object reached two ways: the
    // `Negate`-wrapped nested spelling, and the flat one.
    const cases: [string, any, any][] = [
      [
        'Negate around a nested product',
        ['Multiply', ['Multiply', 'b', ['Negate', 'a']], 'c'],
        ['Negate', ['Multiply', 'a', 'b', 'c']],
      ],
      [
        'nested product behind a rational coefficient',
        ['Multiply', ['Rational', 1, 2], ['Negate', ['Multiply', 's', 'x']]],
        ['Multiply', ['Rational', -1, 2], 's', 'x'],
      ],
      [
        'doubly nested',
        ['Multiply', ['Negate', ['Multiply', 'a', ['Multiply', 'b', 'c']]], 'd'],
        ['Negate', ['Multiply', 'a', 'b', 'c', 'd']],
      ],
      [
        'two negations cancel',
        ['Multiply', ['Negate', ['Multiply', 'a', 'b']], ['Negate', 'c']],
        ['Multiply', 'a', 'b', 'c'],
      ],
    ];

    test.each(cases)('%s', (_label, nested, flat) => {
      const a = ce.box(nested);
      const b = ce.box(flat);
      expect(a.json).toEqual(b.json);
      expect(a.isSame(b)).toBe(true);
      expect(a.hash).toEqual(b.hash);
    });
  });

  test('the ellipsis fold barrier is still not flattened', () => {
    // A `Multiply` carrying a `ContinuationPlaceholder` is notational: it keeps
    // its authored structure, including a nested product anchor.
    const expr = ce.parse('2\\cdot 4\\cdot\\cdots\\cdot 2n');
    expect(expr.json).toEqual([
      'Multiply',
      2,
      4,
      'ContinuationPlaceholder',
      ['Multiply', 2, 'n'],
    ]);
  });
});
