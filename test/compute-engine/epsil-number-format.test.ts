import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

const NONE = { digitGroup: 0 } as const;
const EMPTY = { digitGroupSeparator: '' } as const;

const reparse = (src: string) =>
  JSON.stringify(parseEpsil(src)[0], (k, v) =>
    k === 'sourceOffsets' ? undefined : v
  );

describe('serializeEpsil numberFormat', () => {
  it('groups with _ by default', () => {
    expect(serializeEpsil(3811)).toBe('3_811');
    expect(serializeEpsil(12345.678)).toBe('12_345.678');
  });

  const cases: [string, MathJsonExpression, string][] = [
    ['integer', 3811, '3811'],
    ['negative integer', -3811, '-3811'],
    ['decimal', 12345.678, '12345.678'],
    [
      'big integer',
      { num: '123456789012345678901234567890' },
      '123456789012345678901234567890',
    ],
    ['rational', ['Rational', 3811, 7000], '3811 / 7000'],
  ];

  describe.each([
    ['digitGroup: 0', NONE],
    ["digitGroupSeparator: ''", EMPTY],
    ['digitGroup: [0, 0]', { digitGroup: [0, 0] as [number, number] }],
  ])('%s', (_name, numberFormat) => {
    it.each(cases)('%s', (_n, expr, expected) => {
      const out = serializeEpsil(expr, { numberFormat });
      expect(out).toBe(expected);
      // Same expression as the grouped spelling
      expect(reparse(out)).toBe(reparse(serializeEpsil(expr)));
    });
  });

  it('reaches nested numbers', () => {
    expect(
      serializeEpsil(['Add', ['Multiply', 3811, 'x'], 12345], {
        numberFormat: NONE,
      })
    ).toBe('3811x + 12345');
  });

  it('does not leak into later calls', () => {
    serializeEpsil(3811, { numberFormat: NONE });
    expect(serializeEpsil(3811)).toBe('3_811');
  });

  it('rejects a separator that would not read back', () => {
    expect(() =>
      serializeEpsil(3811, { numberFormat: { digitGroupSeparator: ',' } })
    ).toThrow(RangeError);
  });
});
