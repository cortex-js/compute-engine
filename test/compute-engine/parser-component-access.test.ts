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

  describe('member access on a tuple-typed symbol (no value)', () => {
    // Use a fresh engine so the tuple declaration does not leak into the
    // shared one (where `z` is already declared `complex`).
    const tupleEngine = () => {
      const e = new ComputeEngine();
      e.declare('z', 'tuple<number, number>');
      return e;
    };

    test('z.x stays symbolic First(z), valid, typed number', () => {
      const e = tupleEngine();
      const result = e.parse('z.x').evaluate();
      expect(result.operator).toBe('First');
      expect(result.op1.symbol).toBe('z');
      expect(result.isValid).toBe(true);
      expect(result.type.toString()).toBe('number');
    });

    test('z.y stays symbolic Second(z), valid, typed number', () => {
      const e = tupleEngine();
      const result = e.parse('z.y').evaluate();
      expect(result.operator).toBe('Second');
      expect(result.op1.symbol).toBe('z');
      expect(result.isValid).toBe(true);
      expect(result.type.toString()).toBe('number');
    });

    test('literal (10,20).x still evaluates to 10', () => {
      const e = tupleEngine();
      expect(e.parse('(10,20).x').evaluate().valueOf()).toBe(10);
    });

    test('1.x still evaluates to an Error (provably not a collection)', () => {
      const e = tupleEngine();
      expect(e.parse('1.x').evaluate().operator).toBe('Error');
    });

    test('(z.x, z.y) builds a tuple<number, number>', () => {
      const e = tupleEngine();
      const pair = e.function('Tuple', [e.parse('z.x'), e.parse('z.y')]);
      expect(pair.type.toString()).toBe('tuple<number, number>');
    });
  });

  describe('dictionary key access via dot-notation', () => {
    // A symbol declared as a `dictionary` gets `.member` key access; the key
    // is an alphabetic, space-free run. Use a fresh engine so the dictionary
    // declaration does not leak into the shared one.
    const dictEngine = () => {
      const e = new ComputeEngine();
      const d = e.box({ dict: { height: 42, width: 7, x: 99, real: 5 } });
      e.declare('data', d.type);
      e.assign('data', d);
      return e;
    };

    test('reads a multi-letter key', () => {
      const e = dictEngine();
      const expr = e.parse('\\mathrm{data}.height');
      expect(expr.operator).toBe('At');
      expect(expr.op1.symbol).toBe('data');
      expect(expr.op2.string).toBe('height');
      expect(expr.evaluate().valueOf()).toBe(42);
    });

    test('a single-letter key is a key, not a First/Second component', () => {
      const e = dictEngine();
      expect(e.parse('\\mathrm{data}.x').evaluate().valueOf()).toBe(99);
    });

    test('a key that shadows a component head is still a key', () => {
      const e = dictEngine();
      expect(e.parse('\\mathrm{data}.real').evaluate().valueOf()).toBe(5);
    });

    test('dot-access on a non-dictionary symbol is unchanged', () => {
      // `p` is not a dictionary, so the deliberately-tight component rules apply.
      expect(parse('p.x')).toEqual(['First', 'p']);
      expect(ce.parse('p.q').isValid).toBe(false);
    });
  });
});
