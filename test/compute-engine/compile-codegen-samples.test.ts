import { ComputeEngine, compile } from '../../src/compute-engine';

describe('code generation for document samples', () => {
  test('small powers preserve non-finite values and signed zero', () => {
    const ce = new ComputeEngine();
    for (const n of [2, 3, 4, 5]) {
      const fn = compile(ce.expr(['Power', 'x', n]), {
        to: 'javascript',
        vars: { x: '_.draw()' },
      });
      for (const x of [
        -Infinity,
        -2,
        -0,
        0,
        Number.MIN_VALUE,
        0.125,
        1e-64,
        Number.MAX_VALUE,
        Infinity,
        NaN,
      ]) {
        let calls = 0;
        const actual = fn.run!({
          draw: () => {
            calls++;
            return x;
          },
        }) as number;
        const expected = Math.pow(x, n);
        expect(calls).toBe(1);
        if (!Number.isFinite(expected) || expected === 0)
          expect(actual).toBe(expected);
        else
          expect(Math.abs((actual - expected) / expected)).toBeLessThan(1e-14);
      }
    }
  });
  test.each([2, 3, 4, 5])('compound power %i evaluates its base once', (n) => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) -> number');
    let calls = 0;
    const fn = compile(ce.expr(['Power', ['f', 'x'], n]), {
      to: 'javascript',
      functions: { f: '_.draw' },
    });
    expect(fn.success).toBe(true);
    expect(
      fn.run!({
        x: 1,
        draw: () => {
          calls++;
          return -2;
        },
      })
    ).toBe((-2) ** n);
    expect(calls).toBe(1);
    if (n > 2) expect(fn.code).not.toContain('Math.pow');
  });

  test.each(['javascript', 'glsl', 'wgsl'] as const)(
    '%s uses native exp',
    (to) => {
      const ce = new ComputeEngine();
      const expr = ce.expr(['Power', 'ExponentialE', 'x']);
      const fn = compile(expr, { to });
      expect(fn.code).toContain(to === 'javascript' ? 'Math.exp(' : 'exp(');
      if (to === 'javascript') {
        for (const x of [-Infinity, -4, 0, 3, Infinity, NaN])
          expect(fn.run!({ x })).toBe(Math.exp(x));
      }
      const mapped = compile(expr, { to, vars: { ExponentialE: 'otherBase' } });
      expect(mapped.code).not.toContain('exp(');
    }
  );

  test.each(['javascript', 'glsl', 'wgsl'] as const)(
    '%s shares a small expensive call and honors cse:false',
    (to) => {
      const ce = new ComputeEngine();
      const expr = ce.expr([
        'And',
        ['Less', ['Sin', 'x'], 1],
        ['Greater', ['Sin', 'x'], 0],
      ]);
      const fn = compile(expr, { to });
      expect(fn.code!.match(/sin\(/gi)).toHaveLength(1);
      expect(fn.code).toContain('_cse');
      expect(
        compile(expr, { to, cse: false }).code!.match(/sin\(/gi)
      ).toHaveLength(2);
      if (to === 'javascript') {
        for (const x of [-1, 0, 1, NaN])
          expect(fn.run!({ x })).toBe(Math.sin(x) < 1 && Math.sin(x) > 0);
      }
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s keeps GPU temporaries in their scope',
    (to) => {
      const ce = new ComputeEngine();
      const repeated = [
        'Add',
        ['Sin', ['Add', 'x', 'k']],
        ['Cos', ['Sin', ['Add', 'x', 'k']]],
      ];
      const loop = compile(
        ce.expr(['Sum', repeated, ['Limits', 'k', 1, 153]]),
        { to }
      );
      expect(loop.code!.indexOf('for (')).toBeLessThan(
        loop.code!.indexOf('_cse')
      );
      expect(loop.code!.match(/sin\(/g)).toHaveLength(1);
      const conditional = compile(
        ce.expr(['Which', ['Less', 'x', 0], repeated, 'True', 0]),
        { to }
      );
      expect(conditional.success).toBe(true);
      expect(conditional.code).not.toContain('_cse');
      const override = compile(
        ce.expr(['Add', ['Sin', 'x'], ['Cos', ['Sin', 'x']]]),
        { to, functions: { Sin: 'customSin' } }
      );
      expect(override.code).not.toContain('_cse');
      expect(override.code!.match(/customSin\(/g)).toHaveLength(2);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s preserves lazy connective operands',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('flag', 'boolean');
      const fn = compile(
        ce.expr([
          'And',
          'flag',
          ['Less', ['Add', ['Sin', 'x'], ['Cos', ['Sin', 'x']]], 1],
        ]),
        { to }
      );
      expect(fn.success).toBe(true);
      expect(fn.code).not.toContain('_cse');
      const mapped = compile(ce.expr(['Power', 'x', 2]), {
        to,
        vars: { x: 'draw()' },
      });
      expect(mapped.code!.match(/draw\(/g)).toHaveLength(1);
    }
  );

  test('counter arguments avoid broadcast guards while free inputs keep them', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.expr(['Function', ['Add', 't', 1], 't']));
    const loop = compile(
      ce.expr(['Sum', ['f', 'k'], ['Limits', 'k', 1, 153]]),
      { to: 'javascript', constantFold: false }
    );
    expect(loop.code).not.toContain('Array.isArray');
    expect(loop.code).not.toContain('bcastFn');
    expect(loop.run!()).toBe(11934);
    const generic = compile(ce.expr(['f', 'x']), { to: 'javascript' });
    expect(generic.code).toMatch(/Array.isArray|bcastFn/);
    expect(generic.run!({ x: [1, 2] })).toEqual([2, 3]);
  });

  test('counted ranges match materialized ranges, including fractional steps', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'Comprehension',
      ['Multiply', 'k', 'x'],
      ['Element', 'k', ['Range', 'lo', 'hi', 'step']],
    ]);
    const fn = compile(expr, { to: 'javascript', constantFold: false });
    expect(fn.success).toBe(true);
    expect(fn.code).not.toContain('Array.from');
    for (const [lo, hi, step] of [
      [1, 5, 1],
      [5, 1, -1],
      [0, 1, 0.1],
      [1, 5, -1],
      [1, 5, 0],
      [NaN, 5, 1],
    ]) {
      const length =
        step === 0 ? 0 : Math.max(0, Math.floor((hi - lo) / step) + 1);
      const expected = Array.from({ length }, (_, k) => 2 * (lo + step * k));
      expect(fn.run!({ lo, hi, step, x: 2 })).toEqual(expected);
    }
    expect(() => fn.run!({ lo: 0, hi: Infinity, step: 1, x: 2 })).toThrow(
      RangeError
    );
  });

  test('complex range constants preserve the iterable real-part behavior', () => {
    const ce = new ComputeEngine();
    const cases = [
      [ce.number({ re: 1, im: 1 }), ce.number({ re: 3, im: 1 })],
      [ce.number(1), ce.number(5), ce.number({ re: 2, im: 1 })],
      [ce.number(1), ce.number(3)],
    ];
    for (const [index, bounds] of cases.entries()) {
      const expr = ce.function('Comprehension', [
        ce.symbol('k'),
        ce.function('Element', [
          ce.symbol('k'),
          ce.function('Range', bounds),
        ]),
      ]);
      const fn = compile(expr, { to: 'javascript', constantFold: false });
      expect(fn.success).toBe(true);
      expect(fn.run!()).toEqual(index === 1 ? [1, 3, 5] : [1, 2, 3]);
      if (index < 2) expect(fn.code).toContain('Array.from');
      else expect(fn.code).not.toContain('Array.from');
    }
  });

  test('nested counted ranges evaluate dependent bounds in the outer loop', () => {
    const ce = new ComputeEngine();
    const fn = compile(
      ce.expr([
        'Comprehension',
        ['Add', 'i', 'j'],
        ['Element', 'i', ['Range', 1, 'n']],
        ['Element', 'j', ['Range', 1, 'i']],
      ]),
      { to: 'javascript', constantFold: false }
    );
    expect(fn.success).toBe(true);
    expect(fn.run!({ n: 3 })).toEqual([2, 3, 4, 4, 5, 6]);
  });
});
