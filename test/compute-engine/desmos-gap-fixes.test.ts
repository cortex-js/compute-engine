import { Expression } from '../../src/math-json/types.ts';
import { engine } from '../utils';

const ce = engine;

function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

describe('Desmos gap fixes', () => {
  describe('Fix 1: postfix restriction after visual space', () => {
    // A `\{…\}` When-restriction must attach to its base even when separated
    // by visual space (`\ `). The spaced form must match the unspaced form.
    const spaced =
      's\\left(t\\right)=\\ \\left(1-t\\right)^{2}\\left(1+2t\\right)\\ \\ \\ \\ \\left\\{t\\ge0\\right\\}\\left\\{t\\le1\\right\\}';
    const unspaced =
      's\\left(t\\right)=\\left(1-t\\right)^{2}\\left(1+2t\\right)\\left\\{t\\ge0\\right\\}\\left\\{t\\le1\\right\\}';

    test('full corpus row parses valid with both conditions captured', () => {
      const e = ce.parse(spaced);
      expect(e.isValid).toBe(true);
      // Both restriction conditions (t >= 0 AND t <= 1) must be captured; they
      // canonicalize to a conjunction of two `LessEqual` inequalities.
      const s = JSON.stringify(e.json);
      expect(s).toContain('["And",["LessEqual",0,"t"],["LessEqual","t",1]]');
    });

    test('spaced form matches unspaced form', () => {
      expect(parse(spaced)).toEqual(parse(unspaced));
    });

    test('t\\ \\{t\\ge0\\} attaches the When restriction across space', () => {
      expect(parse('t\\ \\left\\{t\\ge0\\right\\}')).toEqual([
        'When',
        't',
        ['LessEqual', 0, 't'],
      ]);
    });

    describe('no regression for existing postfix operators', () => {
      test('5! → Factorial', () => {
        expect(parse('5!')).toEqual(['Factorial', 5]);
      });

      test("x' → Prime", () => {
        expect(parse("x'")).toEqual(['Prime', 'x']);
      });

      test('A[1] → At', () => {
        expect(parse('A[1]')).toEqual(['At', 'A', 1]);
      });
    });
  });

  describe('Fix 2: inert Polygon head', () => {
    test('parses to Polygon with tuple args and round-trips', () => {
      const e = ce.parse(
        '\\operatorname{polygon}\\left(\\left(0,0\\right),\\left(1,0\\right),\\left(0,1\\right)\\right)'
      );
      expect(e.isValid).toBe(true);
      expect(e.json).toEqual([
        'Polygon',
        ['Tuple', 0, 0],
        ['Tuple', 1, 0],
        ['Tuple', 0, 1],
      ]);
      expect(ce.parse(e.latex).json).toEqual(e.json);
    });
  });

  describe('Fix 3: lowercase stats parse aliases', () => {
    test('histogram → Histogram, valid', () => {
      const e = ce.parse(
        '\\operatorname{histogram}\\left(\\left[1,2,2,3\\right],1\\right)'
      );
      expect(e.isValid).toBe(true);
      expect(e.json).toEqual(['Histogram', ['List', 1, 2, 2, 3], 1]);
    });

    test('pdf → PDF head (valid with a distribution argument)', () => {
      expect(ce.parse('\\operatorname{pdf}\\left(1\\right)').operator).toBe(
        'PDF'
      );
      const e = ce.parse(
        '\\operatorname{pdf}\\left(\\operatorname{NormalDistribution}(),0.5\\right)'
      );
      expect(e.operator).toBe('PDF');
      expect(e.isValid).toBe(true);
    });

    test('cdf → CDF head (valid with a distribution argument)', () => {
      expect(ce.parse('\\operatorname{cdf}\\left(1\\right)').operator).toBe(
        'CDF'
      );
      const e = ce.parse(
        '\\operatorname{cdf}\\left(\\operatorname{NormalDistribution}(),0.5\\right)'
      );
      expect(e.operator).toBe('CDF');
      expect(e.isValid).toBe(true);
    });
  });
});
