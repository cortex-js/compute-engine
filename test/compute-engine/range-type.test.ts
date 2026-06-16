import { ComputeEngine } from '../../src/compute-engine';

describe('Range dynamic type narrowing', () => {
  const ce = new ComputeEngine();

  test('Range with integer endpoints types as indexed_collection<integer>', () => {
    const r = ce.expr(['Range', 1, 9]);
    expect(String(r.type)).toContain('integer');
  });

  test('Range with integer step types as indexed_collection<integer>', () => {
    const r = ce.expr(['Range', 1, 9, 2]);
    expect(String(r.type)).toContain('integer');
  });

  test('Range with float step types as indexed_collection<number>', () => {
    const r = ce.expr(['Range', 0, 1, 0.1]);
    expect(String(r.type)).toContain('number');
    expect(String(r.type)).not.toMatch(/integer/);
  });

  test('Range with symbolic step types as indexed_collection<number>', () => {
    ce.declare('s', 'number');
    const r = ce.expr(['Range', 0, 1, ce.symbol('s')]);
    expect(String(r.type)).toContain('number');
  });

  test('Range with fractional lower bound types as number, not integer', () => {
    // Reviewer P2: Range(0.5, 2.5) iterates 0.5, 1.5, 2.5 — element type
    // must be number, not integer.
    const t = String(ce.expr(['Range', 0.5, 2.5]).type);
    expect(t).toContain('number');
    expect(t).not.toMatch(/integer/);
  });

  test('Range with fractional upper bound types as number, not integer', () => {
    const t = String(ce.expr(['Range', 1, 4.5]).type);
    expect(t).toContain('number');
    expect(t).not.toMatch(/integer/);
  });
});

describe('Range runtime iteration', () => {
  const ce = new ComputeEngine();

  function values(expr: any): number[] {
    const out: number[] = [];
    for (const v of expr.each()) out.push(v.re);
    return out;
  }

  test('Range(1, 5) → [1, 2, 3, 4, 5]', () => {
    expect(values(ce.expr(['Range', 1, 5]))).toEqual([1, 2, 3, 4, 5]);
  });

  test('Range(5, 1) → [5, 4, 3, 2, 1] (auto-direction)', () => {
    expect(values(ce.expr(['Range', 5, 1]))).toEqual([5, 4, 3, 2, 1]);
  });

  test('Range(10, 0, -2) → [10, 8, 6, 4, 2, 0]', () => {
    expect(values(ce.expr(['Range', 10, 0, -2]))).toEqual([10, 8, 6, 4, 2, 0]);
  });

  test('Range(0, 1, -1) → empty (sign mismatch)', () => {
    expect(values(ce.expr(['Range', 0, 1, -1]))).toEqual([]);
  });

  test('Range(5, 1, 1) → empty (sign mismatch with explicit step)', () => {
    expect(values(ce.expr(['Range', 5, 1, 1]))).toEqual([]);
  });

  test('Range(0, 1, 0.25) → 5 fractional values', () => {
    const out = values(ce.expr(['Range', 0, 1, 0.25]));
    expect(out.length).toBe(5);
    out.forEach((v, k) => expect(v).toBeCloseTo(k * 0.25, 10));
  });

  test('Range(0, 1, 0) → empty (zero step)', () => {
    expect(values(ce.expr(['Range', 0, 1, 0]))).toEqual([]);
  });

  test('Range.at(n) returns undefined past end for sign-mismatched range', () => {
    const r = ce.expr(['Range', 0, 1, -1]);
    expect((r as any).at(1)).toBeUndefined();
  });
});

describe('Range collection handlers', () => {
  const ce = new ComputeEngine();

  test('count: empty range with sign-mismatched explicit step returns 0', () => {
    expect(ce.expr(['Range', 5, 1, 1]).count).toBe(0);
    expect(ce.expr(['Range', 0, 1, -1]).count).toBe(0);
  });

  test('count: normal ranges agree with iteration length', () => {
    expect(ce.expr(['Range', 1, 5]).count).toBe(5);
    expect(ce.expr(['Range', 5, 1]).count).toBe(5);
    expect(ce.expr(['Range', 0, 1, 0.25]).count).toBe(5);
  });

  test('contains: integer target on integer range', () => {
    const r = ce.expr(['Range', 0, 10, 2]);
    expect(r.contains(ce.number(4))).toBe(true);
    expect(r.contains(ce.number(3))).toBe(false); // off-grid
    expect(r.contains(ce.number(11))).toBe(false); // past upper
  });

  test('contains: fractional target on fractional range', () => {
    const r = ce.expr(['Range', 0, 1, 0.25]);
    expect(r.contains(ce.number(0.5))).toBe(true);
    expect(r.contains(ce.number(0.3))).toBe(false); // off-grid
    expect(r.contains(ce.number(1))).toBe(true);
  });

  test('contains: returns false for empty (sign-mismatched) range', () => {
    const r = ce.expr(['Range', 0, 1, -1]);
    expect(r.contains(ce.number(0))).toBe(false);
    expect(r.contains(ce.number(1))).toBe(false);
  });

  test('elttype: integer range claims finite_integer element type', () => {
    expect(String(ce.expr(['Range', 1, 9]).type)).toContain('integer');
    expect(String(ce.expr(['Range', 1, 9, 2]).type)).toContain('integer');
  });

  test('elttype: fractional-step range claims number element type', () => {
    const t = String(ce.expr(['Range', 0, 1, 0.25]).type);
    expect(t).toContain('number');
    expect(t).not.toMatch(/integer/);
  });
});
