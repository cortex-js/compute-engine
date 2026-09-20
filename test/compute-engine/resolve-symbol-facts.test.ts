import { ComputeEngine } from '../../src/compute-engine';
import type { TypeString } from '../../src/common/type/types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

describe('external symbol facts', () => {
  test.each(['raw', 'structural', 'canonical'] as const)(
    '%s expressions preserve scalar, list and function facts',
    (form) => {
      for (const type of ['real', 'list<real>', 'function'] as TypeString[]) {
        const ce = new ComputeEngine();
        const declared = new ComputeEngine();
        declared.declare('f', type);
        for (const latex of ['f(x+1)', 'f([x])', 'f(x,y)', 'f()']) {
          const actual = ce.parse(latex, {
            form,
            resolveSymbol: (name) => (name === 'f' ? { type } : undefined),
          }).canonical;
          const expected = declared.parse(latex);
          expect(actual.json).toEqual(expected.json);
          expect(actual.type.toString()).toBe(expected.type.toString());
        }
        expect(ce.lookupDefinition('f')).toBeUndefined();
      }
    }
  );

  test('an application decision can supersede an earlier inferred number', () => {
    const ce = new ComputeEngine();
    ce.parse('f+1');
    expect(ce.symbol('f').type.toString()).toBe('number');
    const result = ce.parse('f(x)', {
      resolveApplication: () => 'apply',
    });
    expect(result.json).toEqual(['f', 'x']);
    expect(ce.symbol('f').type.toString()).toBe('number');
  });

  test('a raw parse does not replace an inferred ambient binding', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x)');
    const before = ce.lookupDefinition('f');
    const raw = ce.parse('f(x+1)', {
      form: 'raw',
      resolveSymbol: (name) =>
        name === 'f' ? { type: 'list<real>' } : undefined,
    });
    expect(ce.lookupDefinition('f')).toBe(before);
    expect(ce.symbol('f').type.toString()).toBe('function');
    expect(raw.canonical.type.toString()).toBe('list<number>');
    expect(ce.symbol('f').type.toString()).toBe('function');
  });

  test('external subscript metadata survives deferred canonicalization', () => {
    const ce = new ComputeEngine();
    const result = ce.parse('a_1', {
      form: 'raw',
      resolveSymbol: (name) =>
        name === 'a'
          ? { type: 'real', subscriptEvaluate: true }
          : undefined,
    });
    expect(result.canonical.json).toEqual(['Subscript', 'a', 1]);
    expect(result.canonical.evaluate().json).toEqual(['Subscript', 'a', 1]);
  });

  test('explicit unknown local bindings shadow an external function fact', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('f', 'unknown');
      const resolver = jest.fn((name: string) =>
        name === 'f' ? { type: 'function' as const } : undefined
      );
      const result = ce.parse('f(x+1)', { resolveSymbol: resolver });
      expect(result.json).toEqual(['Multiply', 'f', ['Add', 'x', 1]]);
      expect(resolver.mock.calls.some(([name]) => name === 'f')).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  test('a per-call fact survives changed options and a different ambient scope', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse('f(x+1)', {
      form: 'raw',
      resolveSymbol: (name) =>
        name === 'f' ? { type: 'list<real>' } : undefined,
    });
    ce.latexOptions = {
      resolveSymbol: (name) =>
        name === 'f' ? { type: 'function' } : undefined,
    };
    ce.pushScope();
    try {
      ce.declare('f', 'function');
      expect(raw.canonical.json).toEqual(['Multiply', 'f', ['Add', 'x', 1]]);
      expect(raw.canonical.type.toString()).toBe('list<number>');
      expect(raw.structural.canonical.type.toString()).toBe('list<number>');
    } finally {
      ce.popScope();
    }
  });

  test('raw operands and diagnostic copies retain their binding environment', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse('f+1', {
      form: 'raw',
      resolveSymbol: (name) =>
        name === 'f' ? { type: 'list<real>' } : undefined,
    });
    expect(isFunction(raw)).toBe(true);
    if (isFunction(raw))
      expect(raw.op1.canonical.type.toString()).toBe('list<real>');
    const symbol = ce.parse('f', {
      form: 'raw',
      diagnostics: true,
      resolveSymbol: () => ({ type: 'list<real>' }),
    });
    expect(symbol.canonical.type.toString()).toBe('list<real>');
    expect(ce.lookupDefinition('f')).toBeUndefined();
  });

  test('raw substitutions and maps retain external type facts', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse('f(x)', {
      form: 'raw',
      resolveSymbol: (name) =>
        name === 'f' ? { type: 'list<real>' } : undefined,
    });
    const substituted = raw.subs({ x: ce.number(2) }).canonical;
    expect(substituted.json).toEqual(['Multiply', 2, 'f']);
    expect(substituted.type.toString()).toBe('list<real>');
    const mapped = raw.map((x) =>
      x.symbol === 'x' ? ce.number(2) : x
    ).canonical;
    expect(mapped.json).toEqual(['Multiply', 2, 'f']);
    expect(mapped.type.toString()).toBe('list<real>');
  });

  test.each(['raw', 'structural', 'canonical'] as const)(
    '%s callable facts survive reconstruction and child extraction',
    (form) => {
      const ce = new ComputeEngine();
      const parsed = ce.parse('f(x)', {
        form,
        resolveSymbol: (name) =>
          name === 'f' ? { type: '(real) -> list<real>' } : undefined,
      });
      expect(parsed.canonical.type.toString()).toBe('list<real>');
      expect(
        parsed.canonical.subs({ x: ce.number(2) }).type.toString()
      ).toBe('list<real>');
      expect(parsed.structural.canonical.type.toString()).toBe('list<real>');

      const rebuilt = parsed.subs(
        { x: ce.expr(['f', 2], { form: 'raw' }) },
        { canonical: false }
      );
      expect(isFunction(rebuilt)).toBe(true);
      if (isFunction(rebuilt))
        expect(rebuilt.op1.canonical.type.toString()).toBe('list<real>');
      expect(ce.lookupDefinition('f')).toBeUndefined();
    }
  );

  test('ordinary free-variable inference stays in the caller scope', async () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('f(x)', {
      form: 'raw',
      resolveSymbol: (name) =>
        name === 'f' ? { type: '(real) -> real' } : undefined,
    });
    expect(ce.lookupDefinition('x')).toBeUndefined();
    expect(parsed.canonical.type.toString()).toBe('real');
    expect(ce.symbol('x').type.toString()).toBe('real');
    expect(ce.parse('x(t)').json).toEqual(['Multiply', 't', 'x']);
    ce.assign('x', 5);
    expect(parsed.canonical.evaluate().json).toEqual(['f', 5]);
    expect(parsed.canonical.evaluate().type.toString()).toBe('real');
    expect((await parsed.canonical.evaluateAsync()).type.toString()).toBe('real');
    expect(ce.lookupDefinition('f')).toBeUndefined();
    ce.assign('f', ['Function', ['Add', 'x', 1], 'x']);
    expect(parsed.canonical.evaluate().json).toBe(6);
  });

  test('callable facts survive rebuilding a bound function body', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('x\\mapsto f(x)', {
      resolveSymbol: (name) =>
        name === 'f' ? { type: '(real) -> list<real>' } : undefined,
    });
    expect(parsed.structural.canonical.type.toString()).toBe(
      parsed.type.toString()
    );
    expect(isFunction(parsed)).toBe(true);
    if (isFunction(parsed))
      expect(parsed.op1.subs({ x: ce.number(2) }).type.toString()).toBe(
        'list<real>'
      );
  });

  test('nested parse calls keep their own fact environments', () => {
    const ce = new ComputeEngine();
    let nested: ReturnType<typeof ce.parse> | undefined;
    const outer = ce.parse('f(x)', {
      form: 'raw',
      resolveSymbol: (name) => {
        if (name !== 'f') return undefined;
        nested = ce.parse('f(x)', {
          form: 'raw',
          resolveSymbol: (id) =>
            id === 'f' ? { type: 'function' } : undefined,
        });
        return { type: 'list<real>' };
      },
    });
    expect(outer.canonical.json).toEqual(['Multiply', 'f', 'x']);
    expect(outer.canonical.type.toString()).toBe('list<real>');
    expect(nested?.canonical.json).toEqual(['f', 'x']);
    expect(ce.lookupDefinition('f')).toBeUndefined();
  });

  test('a function body retains external facts below its parameter bindings', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse('x\\mapsto f(x)', {
      form: 'raw',
      resolveSymbol: (name) => {
        if (name === 'f') return { type: 'list<real>' };
        if (name === 'x') return { type: 'function' };
        return undefined;
      },
    });
    expect(raw.canonical.json).toEqual([
      'Function',
      ['Block', ['Multiply', 'f', 'x']],
      'x',
    ]);
    expect(raw.canonical.type.toString()).toBe('(unknown) -> list<real>');
    expect(ce.lookupDefinition('f')).toBeUndefined();
  });

  test('an unresolved oracle preserves the ordinary inference environment', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x)', { resolveSymbol: () => undefined });
    expect(ce.symbol('f').type.toString()).toBe('function');
  });

  test.each(['raw', 'structural', 'canonical'] as const)(
    '%s occurrence decisions can supersede an earlier inferred function',
    (form) => {
      const ce = new ComputeEngine();
      ce.parse('f(x)');
      const result = ce.parse('f(x+1)', {
        form,
        resolveApplication: () => 'multiply',
      });
      expect(result.canonical.json).toEqual([
        'Multiply',
        'f',
        ['Add', 'x', 1],
      ]);
      expect(ce.symbol('f').type.toString()).toBe('function');
    }
  );
});
