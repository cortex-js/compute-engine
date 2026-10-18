import { ComputeEngine, compile } from '../../src/compute-engine';

// Shapes found by the Tycho code-generation audit of 2026-10-17 (CE 0.154.0,
// core corpus): a property-path `vars` entry disabled common-subexpression
// sharing, a half-integer power of a compound base used `Math.pow`, and a
// repeated `e^x` or `m^q` was emitted at each occurrence.

describe('a vars entry that is a property path is a plain read', () => {
  test('a repeated subexpression that reads it is shared', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('t', 'real');
    const expr = ce.parse('\\cos(a)\\sin(t) + \\cos(a)\\cos(t)');
    const plain = compile(expr, { to: 'javascript' });
    const mapped = compile(expr, { to: 'javascript', vars: { a: '_.a' } });
    expect(mapped.code).toBe(plain.code);
    expect(mapped.code!.match(/Math\.cos\(_\.a\)/g)).toHaveLength(1);
    expect(mapped.run!({ a: 0.3, t: 1.1 })).toBeCloseTo(
      Math.cos(0.3) * (Math.sin(1.1) + Math.cos(1.1)),
      14
    );
  });

  test('a GLSL entry that is the symbol name itself is shared the same way', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('t', 'real');
    const result = compile(ce.parse('\\cos(a)\\sin(t) + \\cos(a)\\cos(t)'), {
      to: 'glsl',
      vars: { a: 'a' },
    });
    expect(result.success).toBe(true);
    expect(result.code!.match(/cos\(a\)/g)).toHaveLength(1);
  });

  test.each([
    ['another symbol', '_.b'],
    ['a deeper path', '_.state.a'],
    ['the vars object', '_'],
  ])('an entry that names %s is still caller source', (_label, source) => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('t', 'real');
    const result = compile(ce.parse('\\cos(a)\\sin(t) + \\cos(a)\\cos(t)'), {
      to: 'javascript',
      vars: { a: source },
    });
    expect(result.code).not.toContain('_cse');
  });

  test('an alias written by an assignment to the other symbol reads the new value', () => {
    // `_.b` is also the storage of `b`: sharing `cos(a)` across `b := 5`
    // would read the value from before the assignment.
    const ce = new ComputeEngine();
    for (const s of ['a', 'b', 't']) ce.declare(s, 'real');
    const term = ['Multiply', ['Cos', 'a'], ['Sin', 't']];
    const result = compile(
      ce.box(['Add', term, ['Block', ['Assign', 'b', 5], term]]),
      { to: 'javascript', vars: { a: '_.b' } }
    );
    expect(result.run!({ b: 0, t: 1 })).toBeCloseTo(
      Math.sin(1) + Math.cos(5) * Math.sin(1),
      14
    );
  });

  test('on a compiled function literal, a `_.k` entry stays live', () => {
    // A function literal's runner has no vars object: `_` is a global there,
    // and a value that reads it must not be computed once for all calls.
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.assign('B', ce.parse('k + \\sin(k)'));
    const f = compile(ce.parse('x \\mapsto x + B'), {
      to: 'javascript',
      vars: { k: '_.k' },
    });
    const g = globalThis as { _?: unknown };
    const saved = g._;
    try {
      g._ = { k: 1 };
      expect(f.run!(0)).toBeCloseTo(1 + Math.sin(1), 14);
      g._ = { k: 2 };
      expect(f.run!(0)).toBeCloseTo(2 + Math.sin(2), 14);
    } finally {
      g._ = saved;
    }
  });

  test('the interval target shares it too', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('t', 'real');
    const result = compile(ce.parse('\\cos(a)\\sin(t) + \\cos(a)\\cos(t)'), {
      to: 'interval-js',
      vars: { a: '_.a' },
    });
    expect(result.success).toBe(true);
    expect(result.code!.match(/_IA\.cos\(_\.a\)/g)).toHaveLength(1);
  });

  test('a value that reads it stays per call', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('lv', ce.box(['Add', 'x', 1]));
    const result = compile(ce.box(['Multiply', 'lv', 2]), {
      to: 'javascript',
      vars: { x: '_.x' },
    });
    expect(result.run!({ x: 10 })).toBe(22);
    expect(result.run!({ x: 20 })).toBe(42);
  });

  test('control: a call is still evaluated at each occurrence', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('t', 'real');
    const result = compile(ce.parse('\\cos(a)\\sin(t) + \\cos(a)\\cos(t)'), {
      to: 'javascript',
      vars: { a: '_.draw()' },
    });
    expect(result.code!.match(/Math\.cos\(_\.draw\(\)\)/g)).toHaveLength(2);
  });
});

describe('a half-integer power of a compound base', () => {
  test.each([
    ['(x^2+1)^{3/2}', '_SYS.pow3h(', 1.5],
    ['(x^2+y^2)^{5/2}', '_SYS.pow5h(', 2.5],
  ])('%s goes through the square root', (latex, helper, e) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const result = compile(ce.parse(latex), { to: 'javascript' });
    expect(result.code).toContain(helper);
    expect(result.code).not.toContain('Math.pow');
    for (const [x, y] of [
      [0, 0],
      [0.5, -2],
      [1e100, 3],
      [-7.25, 1e-200],
    ]) {
      const base = latex.includes('y') ? x * x + y * y : x * x + 1;
      const expected = Math.pow(base, e);
      const actual = result.run!({ x, y }) as number;
      if (expected === 0 || !Number.isFinite(expected))
        expect(actual).toBe(expected);
      else expect(Math.abs((actual - expected) / expected)).toBeLessThan(1e-15);
    }
  });

  test('the base is evaluated once', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    let calls = 0;
    const result = compile(ce.parse('(x^2+1)^{3/2}'), {
      to: 'javascript',
      vars: { x: '_.draw()' },
    });
    expect(
      result.run!({
        draw: () => {
          calls++;
          return 2;
        },
      })
    ).toBeCloseTo(Math.pow(5, 1.5), 14);
    expect(calls).toBe(1);
  });
});

describe('a repeated power that lowers to a library call is shared', () => {
  test.each([
    ['(\\exp(0.1t)\\cos(t), \\exp(0.1t)\\sin(t))', /Math\.exp\(/g],
    ['(\\cos(t)m^q, \\sin(t)m^q, m^q)', /_SYS\.pow\(/g],
  ])('%s', (latex, call) => {
    const ce = new ComputeEngine();
    for (const s of ['t', 'm', 'q']) ce.declare(s, 'real');
    const result = compile(ce.parse(latex), { to: 'javascript' });
    expect(result.code!.match(call)).toHaveLength(1);
  });

  test('a small integer power keeps the ordinary thresholds', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const result = compile(ce.parse('(\\cos(t)t^3, \\sin(t)t^3)'), {
      to: 'javascript',
    });
    expect(result.code).not.toContain('_cse');
  });
});
