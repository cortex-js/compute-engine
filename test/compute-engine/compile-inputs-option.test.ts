import { ComputeEngine } from '../../src/compute-engine';
import {
  canCompile,
  compile,
} from '../../src/compute-engine/compilation/compile-expression';

// The `inputs` compile option: the inputs of the compiled code, each with
// its type, given at the call (`docs/COMPILATION-MODEL.md`, "The scope a
// compilation reads"; `docs/plans/2026-11-11-bound-once-spec.md`, section
// 10, C6). The compilation declares each name in a scope of its own and
// binds the occurrences of the name in the expression to it.

const run = (r: { run?: unknown }, v: object): unknown =>
  (r.run as (v: object) => unknown)(v);

describe('COMPILE the inputs option', () => {
  test('a name with no declaration, read in the expression and in a called body', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t) := t x').evaluate();
    const expr = ce.parse('g(2) + x');
    const result = compile(expr, { fallback: false, inputs: { x: 'real' } });
    expect(run(result, { x: 3 })).toBe(9);
    // Nothing is declared after the call.
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  test.each(['javascript', 'interval-js', 'glsl'] as const)(
    'inputs declared for names first read through an assigned list on %s',
    (to) => {
      const ce = new ComputeEngine();
      ce.assign('C', ce.parse('[c_1,c_2,c_3]'));
      const expr = ce.parse(
        String.raw`\sum_{i=0}^{\operatorname{Length}(C)-1}C[i+1]x^{i}`
      );
      const inputs = { x: 'real', c_1: 'real', c_2: 'real', c_3: 'real' };
      const result = compile(expr, { to, inputs, fallback: false });
      expect(result.freeSymbols?.slice().sort()).toEqual(Object.keys(inputs).sort());
      expect(result.freeSymbolTypes?.c_1).toMatchObject({
        type: 'real',
        provenance: 'declared',
      });
      const vars = { x: 2, c_1: 1, c_2: 1, c_3: 1 };
      if (to === 'javascript') expect(run(result, vars)).toBe(7);
      if (to === 'interval-js')
        expect(run(result, vars)).toEqual({
          kind: 'interval',
          value: { lo: 7, hi: 7 },
        });
      expect(ce.lookupDefinition('c_1')).toBeUndefined();
      expect(() => compile(expr, { to, fallback: false })).toThrow(/no type/);
    }
  );

  test('the given type wins over a stored value of another shape', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('n', ce.box(['Range', 1, 3]));
    const expr = ce.parse('n x');
    const result = compile(expr, { fallback: false, inputs: { n: 'real' } });
    expect(run(result, { n: 2, x: 5 })).toBe(10);
    expect(ce.box('n').evaluate().toString()).toBe('[1,2,3]');
  });

  test('a name that holds a value is an input, also in a called body', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 4);
    ce.parse('f(x) := |a| x').evaluate();
    const result = compile(ce.parse('f(x) + a'), {
      fallback: false,
      inputs: { a: 'real' },
    });
    expect(run(result, { x: 2, a: -3 })).toBe(3);
    expect(ce.box('a').evaluate().re).toBe(4);
  });

  test('the other names keep the definitions they were boxed with', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 10);
    const expr = ce.parse('x + a');
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    const result = compile(expr, { fallback: false, inputs: { x: 'real' } });
    expect(run(result, { x: 2 })).toBe(12);
    ce.popScope();
  });

  test('a name that a binder of the expression binds is not an input there', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sum_{k=1}^{3} k x + k');
    const result = compile(expr, {
      fallback: false,
      inputs: { k: 'real', x: 'real' },
    });
    // The index of the sum is 1, 2, 3; the `k` outside the sum is the input.
    expect(run(result, { k: 10, x: 1 })).toBe(16);
  });

  test('a complex input', () => {
    const ce = new ComputeEngine();
    const result = compile(ce.parse('z^2 + 1'), {
      fallback: false,
      inputs: { z: 'complex' },
    });
    expect(result.success).toBe(true);
  });

  test.each(['glsl', 'interval-js'] as const)(
    'the option on %s',
    (to) => {
      const ce = new ComputeEngine();
      const result = compile(ce.parse('\\sin(x) + y'), {
        to,
        fallback: false,
        inputs: { x: 'real', y: 'real' },
      });
      expect(result.success).toBe(true);
    }
  );

  test('the ir profile and canCompile() take the option', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin(x) + y');
    const result = compile(expr, {
      fallback: false,
      profile: 'ir',
      inputs: { x: 'real', y: 'real' },
    });
    expect(run(result, { x: 0, y: 2 })).toBe(2);
    expect(
      canCompile(expr, { to: 'glsl', inputs: { x: 'real', y: 'real' } }).ok
    ).toBe(true);
    // Without a type, a bare name is refused.
    expect(canCompile(ce.parse('q'), { to: 'glsl' }).ok).toBe(false);
    expect(
      canCompile(ce.parse('q'), { to: 'glsl', inputs: { q: 'real' } }).ok
    ).toBe(true);
  });

  // A function of the host whose result is typed `any` has no settled shape,
  // so its call declines (`docs/COMPILATION-MODEL.md`, "Functions of the
  // host") and the result is the interpreter fallback.
  test('the interpreter fallback evaluates with the inputs', () => {
    const ce = new ComputeEngine();
    ce.declare('L2', {
      signature: '(real) -> any',
      evaluate: ([x]: [{ mul(y: unknown): unknown }]) => x.mul(ce.number(2)),
    } as never);
    const expr = ce.box(['Add', ['L2', 'x'], 1]);
    const result = compile(expr, { inputs: { x: 'real' } });
    expect(result.success).toBe(false);
    expect(run(result, { x: 3 })).toBe(7);
  });

  test('a function of the host typed `(real) -> real` compiles with the inputs', () => {
    const ce = new ComputeEngine();
    ce.declare('L2', {
      signature: '(real) -> real',
      evaluate: ([x]: [{ mul(y: unknown): unknown }]) => x.mul(ce.number(2)),
    } as never);
    const expr = ce.box(['Add', ['L2', 'x'], 1]);
    const result = compile(expr, { inputs: { x: 'real' } });
    expect(result.success).toBe(true);
    expect(run(result, { x: 3 })).toBe(7);
    expect(expr.subs({ x: 3 }).evaluate().re).toBe(7);
  });

  test('the interpreter fallback gives the input to a called body too', () => {
    // `f` reads the `a` of the scope of the call, which holds 4. A run with
    // `a = 3` must give 3 to the body of `f` as well: 3·2 + 2·3.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 4);
    ce.parse('f(t) := a t').evaluate();
    ce.declare('L2', {
      signature: '(real) -> any',
      evaluate: ([x]: [{ mul(y: unknown): unknown }]) => x.mul(ce.number(2)),
    } as never);
    const expr = ce.box(['Add', ['f', 2], ['L2', 'a']]);
    const result = compile(expr, { inputs: { a: 'real' } });
    expect(result.success).toBe(false);
    expect(run(result, { a: 3 })).toBe(12);
    expect(ce.box('a').evaluate().re).toBe(4);
  });

  test('a constant that a called body reads declines, and the message names `inputs`', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('H', {
      type: 'list<real>',
      value: ['List', 1, 2, 3],
      isConstant: true,
    });
    ce.parse('g(u) := H_2 u').evaluate();
    const result = compile(ce.parse('g(x)'), { inputs: { H: 'list<real>' } });
    expect(result.success).toBe(false);
    expect(result.diagnostic?.binding).toBe('H');
    expect(result.diagnostic?.message).toMatch(
      /the name "H" of the `inputs` option is a constant/
    );
    // The fallback reads the constant.
    expect(run(result, { x: 5 })).toBe(10);
    expect(
      canCompile(ce.parse('g(x)'), { inputs: { H: 'list<real>' } }).diagnostic
        ?.message
    ).toMatch(/of the `inputs` option is a constant/);
    // Without the name in `inputs`, the constant is read.
    const plain = compile(ce.parse('g(x)'));
    expect(plain.success).toBe(true);
    expect(run(plain, { x: 5 })).toBe(10);
    // In the expression alone, the name is an input.
    const alone = compile(ce.parse('H_2 + x'), { inputs: { H: 'list<real>' } });
    expect(alone.success).toBe(true);
    expect(run(alone, { x: 2, H: [5, 6, 7] })).toBe(8);
  });

  test('canCompile() does not throw for a type string that is not a type', () => {
    const ce = new ComputeEngine();
    expect(
      canCompile(ce.parse('w + 1'), { to: 'glsl', inputs: { w: 'not-a-type<' } })
        .ok
    ).toBe(false);
  });

  test('a type string that is not a type throws', () => {
    const ce = new ComputeEngine();
    expect(() =>
      compile(ce.parse('w + 1'), { inputs: { w: 'not-a-type<' } })
    ).toThrow(/Failed to parse type/);
    // The scope of the compilation is popped after the throw.
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });
});

describe('explicit inputs on interpreter fallback', () => {
  const engine = () => {
    const ce = new ComputeEngine();
    ce.declare('HostDouble', {
      signature: '(real) -> any',
      evaluate: ([value]) => value.mul(ce.number(2)),
    });
    return ce;
  };

  test.each(['javascript', 'glsl', 'interval-js'] as const)(
    'an assigned typed input stays in the %s report after a decline',
    (to) => {
      const ce = engine();
      ce.declare('a', 'real');
      ce.assign('a', 4);
      const result = compile(ce.box(['HostDouble', 'a']), {
        to,
        inputs: { a: 'real' },
      });
      expect(result.success).toBe(false);
      expect(result.freeSymbols).toEqual(['a']);
    }
  );

  test('a valid storage hint survives typed-input fallback', () => {
    const ce = engine();
    ce.declare('S', 'list<real^3>');
    ce.assign('S', ce.box(['List', 10, 20, 30]));
    ce.declare('i', 'integer');
    const result = compile(ce.box(['HostDouble', ['At', 'S', 'i']]), {
      to: 'glsl',
      inputs: { S: 'list<real^3>' },
      storage: { S: 'sampler2D' },
    });
    expect(result.success).toBe(false);
    expect(run(result, { S: [1, 2, 3], i: 2 })).toBe(4);
  });

  test('fallback boxes array arguments for the original binding', () => {
    const ce = engine();
    ce.declare('L', 'list<real>');
    ce.assign('L', ce.box(['List', 1, 2]));
    const result = compile(ce.box(['HostDouble', ['At', 'L', 1]]), {
      inputs: { L: 'tuple<real, real>' },
    });
    expect(result.success).toBe(false);
    expect(run(result, { L: [3, 4] })).toBe(6);
  });

  test('interval fallback reads a string Boolean for an assigned input', () => {
    const ce = engine();
    ce.declare('b', 'boolean');
    ce.assign('b', true);
    const result = compile(ce.box(['If', 'b', 1, ['HostDouble', 3]]), {
      to: 'interval-js',
      inputs: { b: 'boolean' },
    });
    expect(result.success).toBe(false);
    expect(run(result, { b: 'false' })).toEqual(run(result, { b: false }));
    expect(run(result, { b: 'false' })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  test('an undecided interval Boolean hides the stored choice during fallback', () => {
    const ce = engine();
    ce.declare('b', 'boolean');
    ce.assign('b', true);
    let calls = 0;
    ce.declare('HostProbe', {
      signature: '() -> real',
      evaluate: () => {
        calls++;
        return ce.number(1);
      },
    });
    const result = compile(ce.box(['If', 'b', ['HostProbe'], 0]), {
      to: 'interval-js',
      inputs: { b: 'boolean' },
    });
    expect(result.success).toBe(false);
    run(result, { b: 'maybe' });
    expect(calls).toBe(0);
    expect(ce.box('b').evaluate().json).toBe('True');
  });

  test.each([
    { inputs: { a: 'real' } },
    { symbolic: ['a'] },
    { vars: { a: '_.a' } },
  ])('an override reaches both lexical bindings with %o', (options) => {
    const ce = engine();
    ce.declare('x', 'real');
    ce.declare('a', 'real');
    ce.assign('a', 10);
    ce.parse('f(x) := a x').evaluate();
    ce.pushScope();
    try {
      ce.declare('a', 'real');
      ce.assign('a', 100);
      const expr = ce.box(['Add', ['f', 'x'], ['HostDouble', 'a']]);
      const result = compile(expr, options);
      expect(result.success).toBe(false);
      expect(run(result, { a: 3, x: 2 })).toBe(12);
      expect(ce.box('a').evaluate().json).toBe(100);
    } finally {
      ce.popScope();
    }
    expect(ce.box('a').evaluate().json).toBe(10);
  });

  test('a refused override keeps the caller binding and the called constant', () => {
    const ce = engine();
    ce.declare('x', 'real');
    ce.declare('a', { type: 'real', value: 10, isConstant: true });
    ce.parse('f(x) := a x').evaluate();
    ce.pushScope();
    try {
      ce.declare('a', 'real');
      ce.assign('a', 100);
      const expr = ce.box(['Add', ['f', 'x'], ['HostDouble', 'a']]);
      const result = compile(expr, { inputs: { a: 'real' } });
      expect(result.success).toBe(false);
      expect(run(result, { a: 3, x: 2 })).toBe(26);
    } finally {
      ce.popScope();
    }
  });
});
