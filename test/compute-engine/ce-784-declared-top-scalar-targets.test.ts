import { ComputeEngine, compile } from '../../src/compute-engine';
import type { CompilationResult } from '../../src/compute-engine';

// A parameter declared `any` or `value` can hold a number or a list, and
// compiled code does not test the shape of a value at run time. The scalar
// code of the Python and interval-js targets gives a wrong result for a list:
// `(lambda t: 2 * t)` gives `[1, 2, 1, 2]` for `[1, 2]`, and
// `(t) => _IA.scale(_k1, t)` gives an `empty` interval, where the interpreter
// gives `[2, 4]`. These targets now decline as the JavaScript target does, and
// the host declares the shape to compile the program.

const TARGETS = ['javascript', 'python', 'interval-js'] as const;

function typed(name: string, type: string): unknown {
  return ['Typed', name, `'${type}'`];
}

function compileTo(ce: ComputeEngine, json: unknown, to: string) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return compile(ce.box(json as any), { to }) as CompilationResult;
  } finally {
    console.warn = warn;
  }
}

describe('A SYMBOL DECLARED ANY OR VALUE ON THE SCALAR TARGETS', () => {
  describe.each(TARGETS)('target %s', (to) => {
    test.each([
      ['2t', ['Multiply', 2, 't'], 't'],
      ['t + 1', ['Add', 't', 1], 't'],
      ['t - 1', ['Subtract', 't', 1], 't'],
      ['-t', ['Negate', 't'], 't'],
      ['t / 2', ['Divide', 't', 2], 't'],
      ['t ^ 2', ['Power', 't', 2], 't'],
      ['t < 1', ['Less', 't', 1], 't'],
      ['t = 1', ['Equal', 't', 1], 't'],
      ['Sin(t)', ['Sin', 't'], 't'],
      ['Abs(t)', ['Abs', 't'], 't'],
      ['Max(t)', ['Max', 't'], 't'],
      ['Min(t, 1)', ['Min', 't', 1], 't'],
      ['2(t + 1)', ['Multiply', 2, ['Add', 't', 1]], 't'],
    ])('%s declines over a parameter declared any', (_label, body, name) => {
      const ce = new ComputeEngine();
      const result = compileTo(ce, ['Function', body, typed('t', 'any')], to);
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('unsettled-shape');
      expect(result.unsupported).toEqual([name]);
    });

    test('a parameter declared value declines', () => {
      const ce = new ComputeEngine();
      const result = compileTo(
        ce,
        ['Function', ['Multiply', 2, 't'], typed('t', 'value')],
        to
      );
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('unsettled-shape');
      expect(result.unsupported).toEqual(['t']);
    });

    test('two parameters declared any decline, and the first is named', () => {
      const ce = new ComputeEngine();
      const result = compileTo(
        ce,
        ['Function', ['Add', 'p', 'q'], typed('p', 'any'), typed('q', 'any')],
        to
      );
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('unsettled-shape');
      expect(result.unsupported).toEqual(['p']);
    });

    test('an input declared value declines', () => {
      const ce = new ComputeEngine();
      ce.declare('v', 'value');
      const result = compileTo(ce, ['Multiply', 2, 'v'], to);
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('unsettled-shape');
      expect(result.unsupported).toEqual(['v']);
    });

    test('an input declared any with no value keeps its own decline', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'any');
      const result = compileTo(ce, ['Multiply', 2, 'u'], to);
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('untyped-input');
      expect(result.unsupported).toEqual(['u']);
    });

    test('a parameter that the body only returns compiles', () => {
      const ce = new ComputeEngine();
      const result = compileTo(ce, ['Function', 't', typed('t', 'any')], to);
      expect(result.success).toBe(true);
    });

    test.each(['real', 'list<real>'])(
      'a parameter declared %s compiles',
      (type) => {
        const ce = new ComputeEngine();
        const result = compileTo(
          ce,
          ['Function', ['Multiply', 2, 't'], typed('t', type)],
          to
        );
        expect(result.success).toBe(true);
      }
    );

    test('a parameter with no declaration compiles as a scalar', () => {
      const ce = new ComputeEngine();
      const result = compileTo(ce, ['Function', ['Multiply', 2, 't'], 't'], to);
      expect(result.success).toBe(true);
    });

    test('a scalar Max with typed operands compiles', () => {
      const ce = new ComputeEngine();
      const result = compileTo(
        ce,
        ['Function', ['Max', 't', 1], typed('t', 'real')],
        to
      );
      expect(result.success).toBe(true);
    });
  });

  test('the interpreter fallback gives the value of each witness', () => {
    const ce = new ComputeEngine();
    const double = ['Function', ['Multiply', 2, 't'], typed('t', 'any')];
    const add = [
      'Function',
      ['Add', 'p', 'q'],
      typed('p', 'any'),
      typed('q', 'any'),
    ];
    const list = (...xs: number[]) => ce.box(['List', ...xs]);
    expect(
      ce.function('Apply', [ce.box(double as any), list(1, 2)]).evaluate().json
    ).toEqual(['List', 2, 4]);
    expect(
      ce
        .function('Apply', [ce.box(add as any), list(1, 2), list(3, 4)])
        .evaluate().json
    ).toEqual(['List', 4, 6]);
  });

  test('a declared list on interval-js still gives one interval per element', () => {
    const ce = new ComputeEngine();
    const result = compileTo(
      ce,
      ['Function', ['Multiply', 2, 't'], typed('t', 'list<real>')],
      'interval-js'
    );
    expect(result.success).toBe(true);
    expect((result.run as any)([1, 2])).toEqual([
      { kind: 'interval', value: { lo: 2, hi: 2 } },
      { kind: 'interval', value: { lo: 4, hi: 4 } },
    ]);
  });
});
