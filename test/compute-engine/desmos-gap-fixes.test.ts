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

  // 2026-07-10 round, items 6–8
  describe('Fix 4: bare-command function names', () => {
    test('\\abs(x) → Abs', () => {
      expect(parse('\\abs\\left(x\\right)')).toEqual(['Abs', 'x']);
      expect(parse('\\abs(x-2)')).toEqual(['Abs', ['Add', 'x', -2]]);
    });

    test('\\floor(x) → Floor', () => {
      expect(parse('\\floor(x)')).toEqual(['Floor', 'x']);
    });

    test('\\mod(a, b) → Mod; infix \\mod unchanged', () => {
      expect(parse('\\mod(x,3)')).toEqual(['Mod', 'x', 3]);
      expect(parse('5\\mod 3')).toEqual(['Mod', 5, 3]);
      expect(parse('26\\bmod 5')).toEqual(['Mod', 26, 5]);
    });

    test('\\sign(x) → Sign', () => {
      expect(parse('\\sign(x)')).toEqual(['Sign', 'x']);
    });

    test('\\operatorname{sign} aliases to Sign (was a silent free-symbol multiply)', () => {
      expect(parse('\\operatorname{sign}(x)')).toEqual(['Sign', 'x']);
      expect(parse('\\operatorname{sgn}(x)')).toEqual(['Sign', 'x']);
    });
  });

  describe('Fix 5: dot-number juxtaposition after a closing group', () => {
    test('(1-t).9(2) → product with 0.9', () => {
      expect(parse('\\left(1-t\\right).9\\left(2\\right)')).toEqual([
        'Multiply',
        2,
        0.9,
        ['Add', ['Negate', 't'], 1],
      ]);
    });

    test('t^{i}.4 → 0.4 · t^i', () => {
      expect(parse('t^{i}.4')).toEqual([
        'Multiply',
        0.4,
        ['Power', 't', ['Complex', 0, 1]],
      ]);
    });

    test('x.9 → 0.9 · x', () => {
      expect(parse('x.9')).toEqual(['Multiply', 0.9, 'x']);
    });

    describe('no regression for other dot syntax', () => {
      test('trailing-dot number in a tuple', () => {
        expect(parse('(1.,2)')).toEqual(['Tuple', 1, 2]);
      });

      test('ranges still parse', () => {
        expect(parse('1..2')).toEqual(['Range', 1, 2]);
        expect(parse('x..y')).toEqual(['Range', 'x', 'y']);
      });

      test('member access still parses', () => {
        expect(parse('v.x')).toEqual(['PointX', 'v']);
        expect(parse('x.\\max')).toEqual(['Max', 'x']);
      });
    });
  });

  describe('Fix 6: \\frac{d}{X} is a division when the denominator has no differential', () => {
    test('\\frac{d}{L} → Divide(d, L)', () => {
      expect(parse('\\frac{d}{L}')).toEqual(['Divide', 'd', 'L']);
    });

    test('corpus row: d/L inside a larger expression', () => {
      const e = ce.parse(
        'E\\frac{1+\\cos\\left(2\\pi\\space\\frac{d}{L}\\right)}{2}',
        { canonical: false }
      );
      expect(JSON.stringify(e.json)).toContain('["Divide","d","L"]');
      expect(JSON.stringify(e.json)).not.toContain('"D"');
    });

    describe('Leibniz notation still parses', () => {
      test('\\frac{d}{dx} f', () => {
        expect(parse('\\frac{d}{dx}\\sin x')).toEqual(['D', ['Sin', 'x'], 'x']);
      });

      test('\\frac{dy}{dx}', () => {
        expect(parse('\\frac{dy}{dx}')).toEqual([
          'D',
          ['Function', ['Block', 'y'], 'x'],
          'x',
        ]);
      });

      test('\\frac{d^2}{dx^2} (upright \\mathrm{d} too)', () => {
        expect(parse('\\frac{d^2y}{dx^2}')).toEqual([
          'D',
          ['D', ['Function', ['Block', 'y'], 'x'], 'x'],
          'x',
        ]);
        expect(parse('\\frac{\\mathrm{d}}{\\mathrm{d}x}\\sin x')).toEqual([
          'D',
          ['Sin', 'x'],
          'x',
        ]);
      });

      test('partial derivatives unaffected', () => {
        expect(parse('\\frac{\\partial f}{\\partial x}')).toEqual([
          'D',
          ['Function', ['Block', 'f'], 'x'],
          'x',
        ]);
      });
    });
  });
});
