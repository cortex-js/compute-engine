import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine/index.ts';
import { engine } from '../utils';

const ce = engine;

function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

describe('Parser: component access', () => {
  describe('bare-letter members (x, y, z)', () => {
    test('p.x → First(p)', () => {
      ce.declare('p', 'tuple<number, number>');
      expect(parse('p.x')).toEqual(['First', 'p']);
    });

    test('p.y → Second(p)', () => {
      expect(parse('p.y')).toEqual(['Second', 'p']);
    });

    test('p.z → Third(p)', () => {
      expect(parse('p.z')).toEqual(['Third', 'p']);
    });

    test('chained: p.x.real → Real(First(p))', () => {
      expect(parse('p.x.\\operatorname{real}')).toEqual([
        'Real', ['First', 'p'],
      ]);
    });
  });

  describe('operator-name members', () => {
    test('L.\\operatorname{count} → Length(L)', () => {
      ce.declare('L', 'list<number>');
      expect(parse('L.\\operatorname{count}')).toEqual(['Length', 'L']);
    });

    test('L.\\operatorname{total} → Sum(L)', () => {
      expect(parse('L.\\operatorname{total}')).toEqual(['Sum', 'L']);
    });

    test('L.\\max → Max(L)', () => {
      expect(parse('L.\\max')).toEqual(['Max', 'L']);
    });

    test('L.\\operatorname{max} → Max(L)', () => {
      expect(parse('L.\\operatorname{max}')).toEqual(['Max', 'L']);
    });

    test('L.\\min → Min(L)', () => {
      expect(parse('L.\\min')).toEqual(['Min', 'L']);
    });

    test('z.\\operatorname{real} → Real(z)', () => {
      ce.declare('z', 'complex');
      expect(parse('z.\\operatorname{real}')).toEqual(['Real', 'z']);
    });

    test('z.\\operatorname{re} (alias) → Real(z)', () => {
      expect(parse('z.\\operatorname{re}')).toEqual(['Real', 'z']);
    });

    test('z.\\operatorname{imag} → Imaginary(z)', () => {
      expect(parse('z.\\operatorname{imag}')).toEqual(['Imaginary', 'z']);
    });

    test('z.\\operatorname{im} (alias) → Imaginary(z)', () => {
      expect(parse('z.\\operatorname{im}')).toEqual(['Imaginary', 'z']);
    });
  });

  describe('disambiguation from decimal', () => {
    test('1.x → First(1) (integer terminator)', () => {
      expect(parse('1.x')).toEqual(['First', 1]);
    });

    test('1.5.x → First(1.5)', () => {
      expect(parse('1.5.x')).toEqual(['First', 1.5]);
    });

    test('1.5 alone stays as 1.5', () => {
      expect(parse('1.5')).toEqual(1.5);
    });

    test('1.\\operatorname{count} → Length(1)', () => {
      expect(parse('1.\\operatorname{count}')).toEqual(['Length', 1]);
    });
  });

  describe('worked corpus example', () => {
    test('[x,y]^{2}.\\max^{\\tau i}.\\operatorname{real} \\le 0', () => {
      ce.declare('x', 'number');
      ce.declare('y', 'number');
      const expr = '[x,y]^{2}.\\max^{\\tau i}.\\operatorname{real} \\le 0';
      const ast = parse(expr);
      expect(Array.isArray(ast) && (ast as any[])[0]).toBe('LessEqual');
    });
  });

  describe('rejection of unsupported wrappers', () => {
    test('\\mathrm{count} as member name → parse error (deliberately tight)', () => {
      const result = ce.parse('L.\\mathrm{count}');
      expect(result.isValid).toBe(false);
    });

    test('unknown bare-letter member → parse error', () => {
      const result = ce.parse('p.q');
      expect(result.isValid).toBe(false);
    });
  });

  describe('evaluation of degenerate cases', () => {
    test('First(1) evaluates to an Error expression', () => {
      const result = ce.parse('1.x').evaluate();
      expect(result.operator).toBe('Error');
    });
  });
});
