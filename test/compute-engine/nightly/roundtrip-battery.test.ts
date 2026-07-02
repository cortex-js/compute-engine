import { ComputeEngine } from '../../../src/compute-engine';

/**
 * NIGHTLY — .json round-trip battery.
 *
 * Ported from the ROUNDTRIP review harness (`roundtrip/b3-forms.ts`,
 * `b1c-bigint-float.ts`, `b1-precision.ts`, `test-json-battery.mjs`). The
 * contract is `ce.expr(x.json).isSame(x)` for a broad battery of numeric and
 * structural values, plus JSON idempotence `stringify(r.json) === stringify(j)`
 * where it should hold. Includes the RT-P1-1 radical-literal cases (√3/2 in
 * Divide form), lossless complex bignums, large exact integers, and repetends.
 *
 * BigDecimal.precision is GLOBAL — saved in beforeAll, restored in afterAll.
 */

const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;

const ce = new ComputeEngine();
let savedPrecision: number | 'machine';
beforeAll(() => {
  savedPrecision = ce.precision;
});
afterAll(() => {
  ce.precision = savedPrecision;
});

function roundTrips(x: any): { same: boolean; idempotent: boolean; detail: string } {
  const j = x.json;
  const r = ce.expr(j);
  const same = r.isSame(x);
  const idempotent = JSON.stringify(r.json) === JSON.stringify(j);
  return {
    same,
    idempotent,
    detail: `json=${JSON.stringify(j).slice(0, 90)} r.json=${JSON.stringify(r.json).slice(0, 90)}`,
  };
}

// [label, builder]. `idem: false` marks cases that legitimately do not have a
// byte-identical .json after one round-trip (still isSame).
type RtCase = { label: string; mk: () => any; idem?: boolean };

const NUMERIC: RtCase[] = [
  { label: 'int 42', mk: () => ce.number(42) },
  { label: 'int -7', mk: () => ce.number(-7) },
  { label: 'zero', mk: () => ce.number(0) },
  { label: 'rational 3/4', mk: () => ce.box(['Rational', 3, 4]) },
  { label: 'rational -5/6', mk: () => ce.box(['Rational', -5, 6]) },
  { label: 'half via latex', mk: () => ce.parse('\\frac12') },
  // RT-P1-1 radical literals (Divide form must fold back to the same literal)
  { label: 'sqrt3/2 exact', mk: () => ce.parse('\\frac{\\sqrt{3}}{2}').evaluate() },
  { label: 'golden ratio exact', mk: () => ce.parse('\\frac{1+\\sqrt{5}}{2}').evaluate() },
  { label: '-sqrt2', mk: () => ce.parse('-\\sqrt{2}').evaluate() },
  { label: '3sqrt2/5', mk: () => ce.parse('\\frac{3\\sqrt{2}}{5}').evaluate() },
  { label: 'sqrt2 literal', mk: () => ce.box(['Sqrt', 2]) },
  // complex
  { label: 'complex machine 2+3i', mk: () => ce.box(['Complex', 2, 3]).evaluate() },
  { label: 'complex float 2.5-3.25i', mk: () => ce.box(['Complex', 2.5, -3.25]).evaluate() },
  {
    label: 'complex bignum re',
    mk: () =>
      ce.box(['Complex', { num: '2.12345678901234567890123456789' }, 1]).evaluate(),
  },
  // large exact integers / rationals
  { label: '10^23 via Power', mk: () => ce.parse('10^{23}').evaluate() },
  { label: '2^100', mk: () => ce.parse('2^{100}').evaluate() },
  { label: '25!', mk: () => ce.parse('25!').evaluate() },
  { label: 'rational bigints', mk: () => ce.box(['Rational', { num: '12345678901234567890123' }, { num: '98765432109876543210987' }]) },
  { label: '1/1e300', mk: () => ce.box(['Rational', 1, { num: '1e300' }]).evaluate() },
  // sci-notation / repetends
  { label: 'sci 6.02e23', mk: () => ce.box({ num: '6.02e23' }) },
  { label: 'repetend 1.(3)', mk: () => ce.box({ num: '1.(3)' }) },
  { label: 'repetend 0.(142857)', mk: () => ce.box({ num: '0.(142857)' }) },
  { label: 'overline latex', mk: () => ce.parse('0.\\overline{142857}') },
  // machine-range exponents
  { label: 'num 1e-300', mk: () => ce.box({ num: '1e-300' }) },
  { label: 'num 1e300', mk: () => ce.box({ num: '1e300' }) },
  { label: 'num 1.5e-320', mk: () => ce.box({ num: '1.5e-320' }) },
];

const STRUCTURAL: RtCase[] = [
  { label: 'symbol x', mk: () => ce.box('x') },
  { label: 'symbol Pi', mk: () => ce.box('Pi') },
  { label: 'string hello', mk: () => ce.string('hello') },
  { label: 'string that looks like op', mk: () => ce.string('Add') },
  { label: 'string that looks numeric', mk: () => ce.string('123') },
  { label: 'Nothing', mk: () => ce.box('Nothing') },
  { label: 'list', mk: () => ce.parse('\\lbrack 1, 2, 3\\rbrack') },
  { label: 'tensor 2x2', mk: () => ce.parse('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}') },
  { label: 'equation', mk: () => ce.parse('x^2+1=0') },
  { label: 'inequality', mk: () => ce.parse('x\\le 2') },
  { label: 'interval', mk: () => ce.box(['Interval', 0, 1]) },
  { label: 'range', mk: () => ce.box(['Range', 1, 10]) },
  { label: 'hold fn', mk: () => ce.box(['Hold', ['Add', 1, 2]]) },
  { label: 'fn form Add(1,x)', mk: () => ce.box({ fn: ['Add', 1, 'x'] }) },
];

describeNightly('NIGHTLY round-trip battery — numeric values', () => {
  for (const c of NUMERIC) {
    it(`isSame(ce.expr(x.json)) — ${c.label}`, () => {
      const x = c.mk();
      const { same, idempotent, detail } = roundTrips(x);
      if (!same) throw new Error(`NOT isSame — ${c.label}: ${detail}`);
      expect(same).toBe(true);
      if (c.idem !== false && !idempotent)
        throw new Error(`NOT idempotent — ${c.label}: ${detail}`);
    });
  }
});

describeNightly('NIGHTLY round-trip battery — structural forms', () => {
  for (const c of STRUCTURAL) {
    it(`isSame(ce.expr(x.json)) — ${c.label}`, () => {
      const x = c.mk();
      const { same, detail } = roundTrips(x);
      if (!same) throw new Error(`NOT isSame — ${c.label}: ${detail}`);
      expect(same).toBe(true);
    });
  }
});

describeNightly('NIGHTLY round-trip battery — high precision', () => {
  const PRECISIONS = [21, 50, 200];
  for (const p of PRECISIONS) {
    it(`.N() results round-trip at precision ${p}`, () => {
      ce.precision = p;
      const cases: [string, any][] = [
        ['pi.N()', ce.parse('\\pi').N()],
        ['(2/3).N()', ce.parse('2/3').N()],
        ['sqrt2.N()', ce.parse('\\sqrt{2}').N()],
        ['long literal', ce.parse('1.234567890123456789012345678901234567890')],
      ];
      const bad: string[] = [];
      for (const [label, x] of cases) {
        const { same, idempotent, detail } = roundTrips(x);
        if (!same) bad.push(`NOT isSame ${label}: ${detail}`);
        if (!idempotent) bad.push(`NOT idempotent ${label}: ${detail}`);
      }
      ce.precision = savedPrecision;
      expect(bad).toEqual([]);
    });
  }
});
