/**
 * Composite types are synthesized in TIER form.
 *
 * A number literal's own `.type` is its literal type — the value (`21`), an
 * exact rational's singleton range (`rational<0.5..0.5>`), or a compact
 * enclosure of a value no double holds (`real<1.4..1.5>` for `√2`). That
 * precision belongs to the literal NODE only. Every composite type built
 * from literals — a tuple, a list, a set, a sequence, a point list, a
 * record or dictionary, the body of a mapping stage, a held literal — is a
 * STORED contract and carries each component's TIER (`integer`, `rational`,
 * `real`, …) instead. (Ruling of 2026-08-27; `docs/TYPE-SYSTEM.md`
 * §"Number literal types".)
 *
 * Three families of pins:
 *
 * 1. The contract: for every composite kind and every literal shape, the
 *    aggregate type is tier-form, while the component NODES keep their
 *    literal types.
 * 2. Interning: equal flat composite types are one frozen object, so the
 *    cells of a large list join by identity.
 * 3. Cost, measured by COUNTS rather than time so the pin does not depend
 *    on the load of the machine: typing a list of N tuples costs a bounded
 *    number of descriptors and subtype queries per element. A timing probe
 *    is kept for a `CE_PERF=1` run only.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { subtypeStats } from '../../src/common/type/subtype';
import { internType, isInternedType } from '../../src/common/type/intern';
import { descriptorStats } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { numberLiteralTierType } from '../../src/compute-engine/boxed-expression/literal-tier';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** One literal per representation the number kernel has, with the literal
 * type its NODE reports and the tier a composite must carry for it. */
const LITERALS: [
  label: string,
  mathjson: unknown,
  node: string,
  tier: string,
][] = [
  ['machine integer', 21, '21', 'integer'],
  ['negative integer', -3, '-3', 'integer'],
  ['zero', 0, '0', 'integer'],
  ['machine float', 0.5, '0.5', 'real'],
  ['exact rational', ['Rational', 1, 2], 'rational<0.5..0.5>', 'rational'],
  ['enclosed rational', ['Rational', 1, 3], 'rational<0.33..0.34>', 'rational'],
  [
    'negative enclosed rational',
    ['Rational', -1, 3],
    'rational<-0.34..-0.33>',
    'rational',
  ],
  ['radical', ['Sqrt', 2], 'real<1.4..1.5>', 'real'],
  ['negative radical', ['Negate', ['Sqrt', 2]], 'real<-1.5..-1.4>', 'real'],
  [
    'big integer',
    { num: '1000000000000000000000000000001' },
    'integer<9.9e+29..1.1e+30>',
    'integer',
  ],
  ['NaN', 'NaN', 'NaN', 'nan'],
  ['positive infinity', 'PositiveInfinity', '+oo', 'signed_infinity'],
  ['negative infinity', 'NegativeInfinity', '-oo', 'signed_infinity'],
  ['complex infinity', 'ComplexInfinity', '~oo', 'infinity'],
  ['complex', ['Complex', 2, 3], 'complex', 'complex'],
  ['imaginary unit', 'ImaginaryUnit', 'imaginary', 'imaginary'],
];

describe('the component node keeps its literal type', () => {
  test.each(LITERALS)('%s', (_label, mj, node) => {
    const t = ce.box(['Tuple', mj, 1]);
    expect(t.op1.type.toString()).toBe(node);
    // The tier the composite carries is read off the literal's value, never
    // by widening the node's type.
    expect(isNumber(t.op1)).toBe(true);
  });
});

describe('aggregate types are tier-form for every composite kind', () => {
  test.each(LITERALS)('tuple of %s', (_label, mj, _node, tier) => {
    expect(ce.box(['Tuple', mj, 1]).type.toString()).toBe(
      `tuple<${tier}, integer>`
    );
    expect(ce.box(['Pair', mj, 1]).type.toString()).toBe(
      `tuple<${tier}, integer>`
    );
  });

  test.each(LITERALS)('list of %s', (_label, mj, _node, tier) => {
    const t = ce.box(['List', mj, mj]).type.toString();
    // A dimensioned list prints in its `vector<T^n>`/`list<T^n>` shorthand.
    expect(t).toMatch(new RegExp(`^(vector|list)<${escape(tier)}\\^2>$`));
  });

  test.each(LITERALS)('set of %s', (_label, mj, _node, tier) => {
    expect(ce.box(['Set', mj]).type.toString()).toBe(`set<${tier}>`);
  });

  test.each(LITERALS)('sequence of %s', (_label, mj, _node, tier) => {
    expect(ce.box(['Sequence', mj, 1]).type.toString()).toBe(
      `tuple<${tier}, integer>`
    );
  });

  test.each(LITERALS)('point list of %s', (_label, mj, _node, tier) => {
    expect(ce.box(['PointList', mj, 1]).type.toString()).toBe(
      `tuple<${tier}, integer>`
    );
  });

  test.each(LITERALS)('record with a %s field', (_label, mj, _node, tier) => {
    const d = ce.box(['Dictionary', ['Tuple', { str: 'x' }, mj]]);
    expect(d.type.toString()).toBe(`record{x: ${tier}}`);
  });

  test.each(LITERALS)(
    'dictionary with a %s value',
    (_label, mj, _node, tier) => {
      // A key that is not a bare identifier falls back to `dictionary<T>`.
      const d = ce.box(['Dictionary', ['Tuple', { str: 'a b' }, mj]]);
      expect(d.type.toString()).toBe(`dictionary<${tier}>`);
    }
  );

  test.each(LITERALS)('held tuple of %s', (_label, mj, _node, tier) => {
    // `Block` holds its operands, so the tuple is typed from its structure.
    expect(ce.box(['Block', ['Tuple', mj, 1]]).type.toString()).toBe(
      `tuple<${tier}, integer>`
    );
  });

  test.each(LITERALS)('mapping body tuple of %s', (_label, mj, _node, tier) => {
    const m = ce.box([
      'Map',
      ['Function', ['Tuple', 'x', mj], 'x'],
      ['List', 1, 2],
    ]);
    expect(m.type.toString()).toBe(`list<tuple<integer, ${tier}>^2>`);
  });

  test('a list of tuples of literals', () => {
    expect(
      ce
        .box([
          'List',
          ['Tuple', ['Sqrt', 2], 1],
          ['Tuple', ['Rational', 1, 3], 2],
        ])
        .type.toString()
    ).toBe('list<tuple<real, integer>^2>');
  });

  test('`Type(…)` reports the same tier-form aggregate', () => {
    expect(
      ce
        .box(['Type', ['Tuple', ['Sqrt', 2], ['Rational', 1, 3], 1]])
        .evaluate()
        .toString()
    ).toBe('TypeFrom("tuple<real, rational, integer>")');
  });
});

describe('what stays: non-literal components keep their own claims', () => {
  test('a range claim on an application component is not literal cargo', () => {
    ce.declare('r', 'real');
    // `Abs` claims `real<0..>` for its result; the tuple keeps it.
    expect(ce.box(['Tuple', ['Abs', 'r'], 1]).type.toString()).toBe(
      'tuple<real<0..>, integer>'
    );
  });

  test('a declared constant keeps its declared ranged type', () => {
    // `Pi` is a SYMBOL with a value-bracket declared type, not a literal.
    expect(ce.box(['Tuple', 'Pi', 1]).type.toString()).toMatch(
      /^tuple<real<3\.14[0-9]*\.\.3\.14[0-9]*>, integer>$/
    );
  });

  test('a symbol holding a radical contributes the tier its value infers', () => {
    ce.assign('w', ce.box(['Sqrt', 2]));
    expect(ce.box(['Tuple', 'w', 1]).type.toString()).toBe(
      'tuple<real, integer>'
    );
  });

  test('an unevaluated power keeps the `Power` handler range claim', () => {
    // `10^30` stays an application, and its range is a HANDLER claim.
    expect(ce.box(['Tuple', ['Power', 10, 30]]).type.toString()).toMatch(
      /^tuple<integer<[0-9.e+]+\.\.[0-9.e+]+>>$/
    );
  });
});

describe('the tier read', () => {
  test.each(LITERALS)(
    '%s reads its tier off the value',
    (_label, mj, _node, tier) => {
      const n = ce.box(mj);
      if (!isNumber(n)) throw new Error('expected a number literal');
      expect(ce.type(numberLiteralTierType(n)).toString()).toBe(tier);
    }
  );
});

describe('interning', () => {
  test('equal flat tuple types are one frozen object', () => {
    const a = ce.box(['Tuple', 1.5, 2.5]).type.type;
    const b = ce.box(['Tuple', 3.5, 4.5]).type.type;
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(isInternedType(a)).toBe(true);
  });

  test('equal dimensioned list types are one object', () => {
    const a = ce.box(['List', 1, 2, 3]).type.type;
    const b = ce.box(['List', 4, 5, 6]).type.type;
    expect(a).toBe(b);
  });

  test('equal record types are one object', () => {
    const a = ce.box(['Dictionary', ['Tuple', { str: 'x' }, 1]]).type.type;
    const b = ce.box(['Dictionary', ['Tuple', { str: 'x' }, 7]]).type.type;
    expect(a).toBe(b);
  });

  test('every cell of a list of points is the same tuple type object', () => {
    const N = 500;
    const l = ce.box([
      'List',
      ...Array.from({ length: N }, (_, i) => ['Tuple', i + 0.25, 2 * i + 0.5]),
    ]);
    expect(l.type.toString()).toBe(`list<tuple<real, real>^${N}>`);
    const first = l.ops![0].type.type;
    for (const op of l.ops!) expect(op.type.type).toBe(first);
  });

  test('a type carrying literal cargo, a range, or a reference is not interned', () => {
    expect(
      isInternedType(
        internType({
          kind: 'tuple',
          elements: [{ type: { kind: 'value', value: 1 } }],
        })
      )
    ).toBe(false);
    expect(
      isInternedType(
        internType({ kind: 'list', elements: ce.type('real<0..>').type })
      )
    ).toBe(false);
    ce.declareType('pt', 'tuple<real, real>');
    expect(
      isInternedType(internType({ kind: 'list', elements: ce.type('pt').type }))
    ).toBe(false);
  });

  test('a flat composite past the size cap is not interned', () => {
    const elements = Array.from({ length: 300 }, () => ({
      type: 'integer' as const,
    }));
    expect(isInternedType(internType({ kind: 'tuple', elements }))).toBe(false);
  });

  test('a nested interned composite is itself interned', () => {
    const inner = internType({
      kind: 'tuple',
      elements: [{ type: 'real' }, { type: 'real' }],
    });
    const outer = internType({ kind: 'list', elements: inner });
    expect(isInternedType(outer)).toBe(true);
    expect(internType({ kind: 'list', elements: inner })).toBe(outer);
  });
});

describe('cost pins (counts, not time)', () => {
  const N = 2000;
  const measure = (mk: (i: number) => unknown) => {
    const l = ce.box(['List', ...Array.from({ length: N }, (_, i) => mk(i))]);
    const s0 = subtypeStats.queries;
    const d0 = descriptorStats.built;
    const type = l.type.toString();
    return {
      type,
      subtypePerElement: (subtypeStats.queries - s0) / N,
      descriptorsPerElement: (descriptorStats.built - d0) / N,
    };
  };

  test('typing a list of scalars costs one descriptor per element and no per-element subtype walk', () => {
    const m = measure((i) => i + 0.25);
    expect(m.type).toBe(`vector<real^${N}>`);
    expect(m.descriptorsPerElement).toBeCloseTo(1, 2);
    expect(m.subtypePerElement).toBeLessThan(0.01);
  });

  test('typing a list of pairs costs three descriptors per element and no per-element subtype walk', () => {
    // One descriptor for the pair as a list element, one per component for
    // the pair's own derivation. The component descriptors never build the
    // literal type, and the interned tuple type joins by identity, so no
    // subtype query is made per element.
    const m = measure((i) => ['Tuple', i + 0.25, 2 * i + 0.5]);
    expect(m.type).toBe(`list<tuple<real, real>^${N}>`);
    expect(m.descriptorsPerElement).toBeCloseTo(3, 2);
    expect(m.subtypePerElement).toBeLessThan(0.01);
  });

  test('components with no machine-exact value cost the same', () => {
    const m = measure((i) => [
      'Tuple',
      ['Rational', 1, i + 3],
      ['Sqrt', i + 2],
    ]);
    expect(m.type).toBe(`list<tuple<rational, real>^${N}>`);
    expect(m.descriptorsPerElement).toBeCloseTo(3, 2);
    expect(m.subtypePerElement).toBeLessThan(0.01);
  });

  // Timing is load-dependent, so the probe runs only in a `CE_PERF=1` run
  // (`npm run test:perf`), and reports the ratio it measures.
  const PERF = process.env.CE_PERF === '1';
  (PERF ? test : test.skip)(
    'timing probe: 5,000 pairs against 5,000 scalars',
    () => {
      const M = 5000;
      const time = (mk: (i: number) => unknown): number => {
        let best = Infinity;
        for (let k = 0; k < 5; k++) {
          const l = ce.box([
            'List',
            ...Array.from({ length: M }, (_, i) => mk(i)),
          ]);
          const t0 = performance.now();
          l.type.toString();
          best = Math.min(best, performance.now() - t0);
        }
        return best;
      };
      const scalars = time((i) => i + 0.25);
      const pairs = time((i) => ['Tuple', i + 0.25, 2 * i + 0.5]);
      console.log(
        `typing 5,000 pairs: ${pairs.toFixed(1)} ms; 5,000 scalars: ${scalars.toFixed(1)} ms; ratio ${(pairs / scalars).toFixed(2)}`
      );
      // Each pair is a typed node of its own, so it costs more than a scalar;
      // the bound is generous on purpose and guards a regression to the
      // previous tenfold cost, not a parity that the node-per-pair design
      // cannot reach.
      expect(pairs / scalars).toBeLessThan(8);
    }
  );
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
