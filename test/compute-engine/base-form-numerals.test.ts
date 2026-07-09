import { engine as ce } from '../utils';

/**
 * Base-subscript numerals: a decimal numeral subscripted by an integer base
 * ≥ 2 whose digits are all valid for that base parses to the existing numeric
 * head `BaseForm(value, base)`, e.g. `10111_2` → `BaseForm(23, 2)`.
 */
describe('Base-subscript numeral parsing', () => {
  test('unbraced subscript', () => {
    expect(ce.parse('10111_2').json).toEqual(['BaseForm', 23, 2]);
    expect(ce.parse('7_8').json).toEqual(['BaseForm', 7, 8]);
  });

  test('braced subscript', () => {
    // 2748 base 16 = 2·4096 + 7·256 + 4·16 + 8 = 10056
    expect(ce.parse('2748_{16}').json).toEqual(['BaseForm', 10056, 16]);
    expect(ce.parse('43210_{6}').json).toEqual(['BaseForm', 5910, 6]);
  });

  test('value correctness (independent computation)', () => {
    // 10111 base 2 = 1·16 + 0·8 + 1·4 + 1·2 + 1·1 = 23
    expect(ce.parse('10111_2').evaluate().re).toBe(23);
    // 43210 base 6 = 4·1296 + 3·216 + 2·36 + 1·6 + 0 = 5910
    expect(ce.parse('43210_{6}').evaluate().re).toBe(5910);
    // 3124 base 5 = 3·125 + 1·25 + 2·5 + 4 = 414
    expect(ce.parse('3124_{5}').evaluate().re).toBe(414);
  });

  test('base greater than 10 (all decimal digits valid)', () => {
    // 235935623 base 74: every decimal digit (0-9) is < 74
    const p = ce.parse('235935623_{74}');
    let v = 0n;
    for (const c of '235935623') v = v * 74n + BigInt(c.charCodeAt(0) - 48);
    expect(p.json).toEqual(['BaseForm', Number(v), 74]);
    expect(p.evaluate().re).toBe(Number(v));
  });

  test('big value beyond 2^53 stays exact', () => {
    const p = ce.parse('123456789012345_{16}');
    let v = 0n;
    for (const c of '123456789012345') v = v * 16n + BigInt(c.charCodeAt(0) - 48);
    expect(v > 9007199254740992n).toBe(true);
    expect(p.json).toEqual(['BaseForm', { num: v.toString() }, 16]);
    // Exact evaluation preserves the full digit string
    expect(ce.parse('123456789012345_{16}').evaluate().toString()).toBe(
      v.toString()
    );
  });
});

describe('Base-subscript numeral guards (unchanged behavior)', () => {
  test('invalid digit for the base stays an inert Subscript', () => {
    expect(ce.parse('19_2').json).toEqual(['Subscript', 19, 2]);
    expect(ce.parse('8_8').json).toEqual(['Subscript', 8, 8]);
  });

  test('symbolic base stays an inert Subscript', () => {
    expect(ce.parse('161_b').json).toEqual(['Subscript', 161, 'b']);
    expect(ce.parse('161_{b}').json).toEqual(['Subscript', 161, 'b']);
  });

  test('base of 1 or 0 stays an inert Subscript', () => {
    expect(ce.parse('10_1').json).toEqual(['Subscript', 10, 1]);
    expect(ce.parse('10_0').json).toEqual(['Subscript', 10, 0]);
  });

  test('subscripted symbols are untouched', () => {
    // Symbol + numeric subscript fuses to a symbol id, not a Subscript/BaseForm
    expect(ce.parse('x_2').json).toEqual('x_2');
    expect(ce.parse('a_n').json).toEqual('a_n');
  });
});

describe('Base-subscript numeral arithmetic', () => {
  test('binary multiplication', () => {
    // 1011_2 · 101_2 = 11 · 5 = 55
    expect(ce.parse('1011_2 \\cdot 101_2').evaluate().re).toBe(55);
  });

  test('octal subtraction equation', () => {
    // 11_8 - 3_8 = 9 - 3 = 6 = 6_8  → True
    expect(ce.parse('11_8-3_8=6_8').evaluate().symbol).toBe('True');
    expect(ce.parse('15_8-7_8=6_8').evaluate().symbol).toBe('True');
  });

  test('mixed-base subtraction', () => {
    // 43210_6 - 3210_7 = 5910 - 1134 = 4776
    expect(ce.parse('43210_{6}-3210_{7}').evaluate().re).toBe(4776);
  });

  test('base-5 sum', () => {
    // 3124_5 + 3122_5 + 124_5 = 414 + 412 + 39 = 865
    expect(ce.parse('3124_{5}+3122_{5}+124_{5}').evaluate().re).toBe(865);
  });
});

describe('BaseForm LaTeX serialization round-trip', () => {
  const cases: [number | { num: string }, number][] = [
    [23, 2],
    [10056, 16],
    [2748, 10],
    [0, 2],
    [7, 8],
    [5910, 6],
    [414, 5],
  ];

  test.each(cases)('BaseForm(%p, %p) serializes to a subscripted numeral', (value, base) => {
    const e = ce.box(['BaseForm', value, base]);
    const latex = e.latex;
    // Plain digits + subscript, no unbalanced parens or \text wrapper
    expect(latex).not.toContain('\\text');
    expect(latex.startsWith('(')).toBe(false);
    // Round-trips through the new parse path
    expect(ce.parse(latex).json).toEqual(['BaseForm', value, base]);
  });

  test('specific serialized forms', () => {
    expect(ce.box(['BaseForm', 23, 2]).latex).toBe('10111_{2}');
    expect(ce.box(['BaseForm', 10056, 16]).latex).toBe('2748_{16}');
  });

  test('big value round-trips exactly', () => {
    let v = 0n;
    for (const c of '123456789012345') v = v * 16n + BigInt(c.charCodeAt(0) - 48);
    const e = ce.box(['BaseForm', { num: v.toString() }, 16]);
    expect(e.latex).toBe('123456789012345_{16}');
    expect(ce.parse(e.latex).json).toEqual(['BaseForm', { num: v.toString() }, 16]);
  });
});
