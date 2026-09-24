import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Complex values and the signatures of user functions on the shader targets.
 *
 * On GLSL and WGSL a complex value lowers to a `vec2` of (re, im), and a real
 * value to a `float`. A shader has no implicit conversion between the two, so
 * the emitted definition of a user function has static parameter and return
 * types, taken from the declared signature:
 *
 *  - A complex argument to a parameter whose declared type admits a complex
 *    value but does not say complex (`unknown`, `number`, or no declaration)
 *    calls a second definition of the function, `_fn_f_complex`, whose
 *    parameter is a `vec2`. A real argument keeps the `float` definition.
 *  - A complex argument to a parameter declared `real` fails closed: the
 *    declaration is a contract.
 *  - A declared complex result over a body whose value is real (`z ↦ Re(z)`)
 *    returns `vec2(v, 0.0)`: the body is `Typed(Re(z), complex)`, and the
 *    lowering of `Typed` converts the value to the ascribed type.
 *  - A declared real result over a body whose value is complex fails closed.
 *
 * A host declares a uniform for each free symbol with the type the engine
 * knows for that symbol after the compile, including a type inferred from a
 * use: after `f(x)` with `f: (complex) -> complex`, an undeclared `x` is
 * complex, and the shader reads it as a `vec2`.
 *
 * Every test builds its OWN engine: these tests assign and declare symbols,
 * and a use of an undeclared symbol can narrow its type for the lifetime of
 * the engine.
 */

/** An engine where each `[name, signature, body]` is declared and assigned. */
function engineWith(...fns: [string, string, string][]): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, signature, body] of fns) {
    ce.declare(name, { signature });
    ce.assign(name, ce.parse(body));
  }
  return ce;
}

function glsl(ce: ComputeEngine, expr: any): any {
  const e = typeof expr === 'string' ? ce.parse(expr) : ce.box(expr);
  return compile(e, { to: 'glsl', fallback: false } as any) as any;
}

function wgsl(ce: ComputeEngine, expr: any): any {
  const e = typeof expr === 'string' ? ce.parse(expr) : ce.box(expr);
  return compile(e, { to: 'wgsl', fallback: false } as any) as any;
}

// ---------------------------------------------------------------------------
// A small GLSL evaluator for the emitted source: the complex preamble
// (`_gpu_cpow`, `_gpu_cmul`, `_gpu_cexp`, `_gpu_cln`, `_gpu_csin`), the
// user-function definitions and the root code, translated to JavaScript. It
// covers only the GLSL subset these tests emit. The arithmetic operators are
// translated to calls of `OP`, which follows the GLSL rules for a `vec2`: a
// `vec2` and a `float` combine componentwise, the `float` spread over both
// components. A `vec2` cannot be converted to a number, so a `vec2` that
// reaches a scalar builtin gives `NaN` and a comparison throws.
// ---------------------------------------------------------------------------

type Vec2 = { x: number; y: number };
const isVec2 = (v: unknown): v is Vec2 =>
  typeof v === 'object' && v !== null && 'x' in v && 'y' in v;
function V2(x: number | Vec2, y?: number): Vec2 {
  if (isVec2(x) || isVec2(y)) return { x: NaN, y: NaN };
  const v = { x, y: y ?? x };
  Object.defineProperty(v, 'valueOf', {
    value: () => {
      throw new Error('a vec2 used as a number');
    },
  });
  return v;
}
function OP(op: string, a: unknown, b: unknown): unknown {
  const f = (p: number, q: number): number =>
    op === '+' ? p + q : op === '-' ? p - q : op === '*' ? p * q : p / q;
  if (!isVec2(a) && !isVec2(b)) return f(a as number, b as number);
  const ax = isVec2(a) ? a.x : (a as number);
  const ay = isVec2(a) ? a.y : (a as number);
  const bx = isVec2(b) ? b.x : (b as number);
  const by = isVec2(b) ? b.y : (b as number);
  return V2(f(ax, bx), f(ay, by));
}
const NEG = (a: unknown): unknown => OP('-', 0, a);
/** A scalar builtin: `NaN` when given a `vec2`. */
const scalar =
  (fn: (...xs: number[]) => number) =>
  (...xs: unknown[]): number =>
    xs.some(isVec2) ? NaN : fn(...(xs as number[]));
const BUILTINS = {
  V2,
  OP,
  NEG,
  exp: scalar(Math.exp),
  log: scalar(Math.log),
  cos: scalar(Math.cos),
  sin: scalar(Math.sin),
  cosh: scalar(Math.cosh),
  sinh: scalar(Math.sinh),
  sqrt: scalar(Math.sqrt),
  abs: scalar(Math.abs),
  sign: scalar(Math.sign),
  pow: scalar(Math.pow),
  length: (v: unknown) => (isVec2(v) ? Math.hypot(v.x, v.y) : NaN),
  atan: (y: unknown, x?: unknown) =>
    isVec2(y) || isVec2(x)
      ? NaN
      : x === undefined
        ? Math.atan(y as number)
        : Math.atan2(y as number, x as number),
};

/**
 * Translate one GLSL expression to JavaScript: `+ - * /` (binary and unary)
 * become calls of `OP`/`NEG`, `vec2(` becomes `V2(`. Calls, member reads
 * (`.x`), comparisons and `? :` are kept.
 */
function glslExprToJS(src: string): string {
  const tokens =
    src.match(
      /\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\w+|>=|<=|==|!=|[-+*/()?:,.<>]/g
    ) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const PREC: Record<string, number> = {
    '>=': 3,
    '<=': 3,
    '>': 3,
    '<': 3,
    '==': 3,
    '!=': 3,
    '+': 4,
    '-': 4,
    '*': 5,
    '/': 5,
  };
  const primary = (): string => {
    const t = next();
    let e: string;
    if (t === '(') {
      e = `(${expr(0)})`;
      next(); // ')'
    } else if (t === '-') e = `NEG(${primary()})`;
    else if (/^\w/.test(t) && peek() === '(') {
      next(); // '('
      const args: string[] = [];
      while (peek() !== ')') {
        args.push(expr(0));
        if (peek() === ',') next();
      }
      next(); // ')'
      e = `${t === 'vec2' ? 'V2' : t}(${args.join(', ')})`;
    } else e = t;
    while (peek() === '.') {
      next();
      e = `(${e}).${next()}`;
    }
    return e;
  };
  const expr = (minPrec: number): string => {
    let lhs = primary();
    for (;;) {
      const op = peek();
      if (op === '?' && minPrec <= 1) {
        next();
        const a = expr(0);
        next(); // ':'
        const b = expr(1);
        lhs = `(${lhs} ? ${a} : ${b})`;
        continue;
      }
      const p = PREC[op];
      if (p === undefined || p < minPrec) return lhs;
      next();
      const rhs = expr(p + 1);
      lhs = p === 3 ? `(${lhs} ${op} ${rhs})` : `OP('${op}', ${lhs}, ${rhs})`;
    }
  };
  return expr(0);
}

function glslToJS(src: string): string {
  return src
    .replace(
      /^(?:float|vec2|bool)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm,
      (_m, name: string, params: string) =>
        `function ${name}(${params
          .split(',')
          .map((p) => p.trim().split(/\s+/).pop() ?? '')
          .filter((p) => p.length > 0)
          .join(', ')}) {`
    )
    .replace(
      /^(\s*)(?:float|vec2|bool)\s+(\w+)\s*=\s*(.*);\s*$/gm,
      (_m, indent: string, name: string, value: string) =>
        `${indent}let ${name} = ${glslExprToJS(value)};`
    )
    .replace(
      /^(\s*)return\s+(.*);\s*$/gm,
      (_m, indent: string, value: string) =>
        `${indent}return ${glslExprToJS(value)};`
    );
}

/**
 * The value of the GLSL compilation of `latex` at the given free-symbol
 * values: a number, or a `vec2` for a complex value.
 */
function evalGLSLValue(
  ce: ComputeEngine,
  latex: string,
  vars: Record<string, number>
): number | Vec2 {
  const r = glsl(ce, latex);
  const names = [...Object.keys(BUILTINS), ...Object.keys(vars)];
  const body = `${glslToJS(r.preamble ?? '')}\nreturn (${glslExprToJS(r.code)});`;
  // eslint-disable-next-line no-new-func
  const f = new Function(...names, body);
  return f(...Object.values(BUILTINS), ...Object.values(vars));
}

/**
 * Check that the GLSL value of `latex` is the interpreter's value, both
 * parts. A `float` result stands for a complex value with a zero imaginary
 * part.
 */
function expectGLSLValue(
  ce: ComputeEngine,
  latex: string,
  v: Record<string, number>
): void {
  const expected = ce.parse(latex).subs(v).N();
  const re = expected.re;
  const im = expected.im;
  expect(Number.isFinite(re) && Number.isFinite(im)).toBe(true);
  const actual = evalGLSLValue(ce, latex, v);
  const [ar, ai] = isVec2(actual) ? [actual.x, actual.y] : [actual, 0];
  expect(ar).toBeCloseTo(re, 9);
  expect(ai).toBeCloseTo(im, 9);
}

/** The interpreter's value of `latex` at the given free-symbol values. */
function interp(
  ce: ComputeEngine,
  latex: string,
  vars: Record<string, number>
): number {
  return ce.parse(latex).subs(vars).N().re;
}

const SAMPLES = [
  { x: 0.5, y: 1.2 },
  { x: -1.3, y: 0.7 },
  { x: 2, y: -0.4 },
  { x: -0.8, y: -1.9 },
];

const Z = ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']];

describe('GPU: a complex argument to a parameter not declared complex', () => {
  // The call of `f` with a complex argument uses a copy of the definition
  // whose parameter is a `vec2` (`_fn_f_complex`), emitted when a call needs
  // it. A call with a real argument keeps the `float` definition.
  for (const signature of ['(unknown) -> unknown', '(number) -> number']) {
    it(`\`${signature}\` calls the complex copy (GLSL and WGSL)`, () => {
      const ce = engineWith(['f', signature, 'z \\mapsto z^2']);
      const g = glsl(ce, '\\arg(f(x+iy))');
      expect(g.success).toBe(true);
      expect(g.code).toBe(
        'atan(_fn_f_complex(vec2(x, y)).y, _fn_f_complex(vec2(x, y)).x)'
      );
      expect(g.preamble).toContain(
        'vec2 _fn_f_complex(vec2 z) {\n  return _gpu_cpow(z, vec2(2.0, 0.0));\n}'
      );
      // Only the copy the calls use is emitted.
      expect(g.preamble).not.toContain('_fn_f(');
      const w = wgsl(ce, '|f(x+iy)|');
      expect(w.success).toBe(true);
      expect(w.code).toBe('length(_fn_f_complex(vec2f(x, y)))');
      expect(w.preamble).toContain(
        'fn _fn_f_complex(z: vec2f) -> vec2f {\n  return _gpu_cpow(z, vec2f(2.0, 0.0));\n}'
      );
      expect(w.preamble).not.toContain('_fn_f(');
      // A real argument keeps the `float` definition, and no copy.
      const r = glsl(ce, 'f(t)');
      expect(r.code).toBe('_fn_f(t)');
      expect(r.preamble).toContain('float _fn_f(float z) {');
      expect(r.preamble).not.toContain('_fn_f_complex');
    });
  }

  it('a real and a complex call in one expression emit both definitions', () => {
    const ce = engineWith(['f', '(unknown) -> unknown', 'z \\mapsto z^2']);
    const latex = 'f(t) + \\operatorname{Re}(f(x+iy))';
    const g = glsl(ce, latex);
    expect(g.code).toBe('_fn_f(t) + (_fn_f_complex(vec2(x, y))).x');
    expect(g.preamble).toContain('float _fn_f(float z) {');
    expect(g.preamble).toContain('vec2 _fn_f_complex(vec2 z) {');
    const w = wgsl(ce, latex);
    expect(w.code).toBe('_fn_f(t) + (_fn_f_complex(vec2f(x, y))).x');
    expect(w.preamble).toContain('fn _fn_f(z: f32) -> f32 {');
    expect(w.preamble).toContain('fn _fn_f_complex(z: vec2f) -> vec2f {');
  });

  it('a function with no declaration gets the complex copy', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('z \\mapsto z^2+1'));
    const g = glsl(ce, '\\arg(f(x+iy))');
    expect(g.preamble).toContain(
      'vec2 _fn_f_complex(vec2 z) {\n  return _gpu_cpow(z, vec2(2.0, 0.0)) + vec2(1.0, 0.0);\n}'
    );
  });

  it('a copy that calls another function calls its complex copy', () => {
    const ce = engineWith(
      ['f', '(unknown) -> unknown', 'z \\mapsto z^2'],
      ['g', '(unknown) -> unknown', 'w \\mapsto f(w) + 1']
    );
    const latex = '\\arg(g(x+iy)) + g(t)';
    const r = glsl(ce, latex);
    expect(r.code).toBe(
      '_fn_g(t) + atan(_fn_g_complex(vec2(x, y)).y, _fn_g_complex(vec2(x, y)).x)'
    );
    expect(r.preamble).toContain('return _fn_f(w) + 1.0;');
    expect(r.preamble).toContain('return _fn_f_complex(w) + vec2(1.0, 0.0);');
    // GLSL declares a function before its use: the callee copy comes first.
    expect(r.preamble.indexOf('vec2 _fn_f_complex(')).toBeLessThan(
      r.preamble.indexOf('vec2 _fn_g_complex(')
    );
    const w = wgsl(ce, latex);
    expect(w.preamble).toContain('return _fn_f_complex(w) + vec2f(1.0, 0.0);');
  });

  it('only the complex parameter of a two-parameter function is a vec2', () => {
    const ce = engineWith([
      'h',
      '(unknown, unknown) -> unknown',
      '(a, b) \\mapsto a b',
    ]);
    const w = wgsl(ce, '\\arg(h(x+iy, t))');
    expect(w.preamble).toContain(
      'fn _fn_h_complex_number(a: vec2f, b: f32) -> vec2f {'
    );
  });

  it('a body with a real value returns a float from the copy', () => {
    const ce = engineWith(['f', '(unknown) -> unknown', 'z \\mapsto |z|']);
    const g = glsl(ce, 'f(x+iy)');
    expect(g.preamble).toContain('float _fn_f_complex(vec2 z) {');
  });

  it('a declared real result over the complex body fails closed', () => {
    const ce = engineWith(['f', '(unknown) -> real', 'z \\mapsto z^2']);
    for (const run of [glsl, wgsl])
      expect(() => run(ce, 'f(x+iy)')).toThrow(
        /the value `z\^2` is complex, but its ascribed type `real` says it is real/
      );
  });

  it('a declared complex result over a real body is lifted', () => {
    const ce = engineWith(['f', '(unknown) -> complex', 'z \\mapsto 1']);
    const g = glsl(ce, '\\arg(f(x+iy))');
    expect(g.preamble).toContain(
      'vec2 _fn_f_complex(vec2 z) {\n  return vec2(1.0, 0.0);\n}'
    );
  });

  it('computes the interpreter value at sample points (GLSL)', () => {
    const ce = engineWith(
      ['f', '(unknown) -> unknown', 'z \\mapsto z^2'],
      ['g', '(unknown) -> unknown', 'w \\mapsto f(w) + 1']
    );
    for (const latex of [
      'f(x+iy)',
      '\\arg(f(x+iy))',
      '|f(x+iy)|',
      '\\arg(g(x+iy))',
      'f(x) + \\operatorname{Re}(f(x+iy))',
    ])
      for (const v of SAMPLES) expectGLSLValue(ce, latex, v);
  });

  it('`(real) -> real` fails closed (GLSL and WGSL)', () => {
    const ce = engineWith(['f', '(real) -> real', 'z \\mapsto z^2']);
    expect(() => glsl(ce, '|f(x+iy)|')).toThrow(
      'f: argument 1 `x + i * y` lowers to "vec2" but parameter "z" is declared "float"'
    );
    expect(() => wgsl(ce, '|f(x+iy)|')).toThrow(
      'f: argument 1 `x + i * y` lowers to "vec2f" but parameter "z" is declared "f32"'
    );
    // A real argument compiles.
    expect(glsl(ce, 'f(x)').success).toBe(true);
  });

  it('JavaScript compiles the same call', () => {
    const ce = engineWith(['f', '(unknown) -> unknown', 'z \\mapsto z^2']);
    const r = compile(ce.parse('\\arg(f(x+iy))'), {
      to: 'javascript',
    } as any) as any;
    expect(r.run({ x: 0.5, y: 1.2 })).toBeCloseTo(
      interp(ce, '\\arg(f(x+iy))', { x: 0.5, y: 1.2 }),
      12
    );
    // JavaScript keeps one definition: its complex lane follows the mode.
    expect(`${r.preamble ?? ''}\n${r.code}`).not.toContain('_fn_f_complex');
  });
});

describe('GPU: a function declared `(complex) -> complex`', () => {
  it('takes and returns a `vec2` (GLSL and WGSL)', () => {
    const ce = engineWith(['f', '(complex) -> complex', 'z \\mapsto z^2']);
    const g = glsl(ce, '\\arg(f(x+iy))');
    expect(g.success).toBe(true);
    expect(g.preamble).toContain('vec2 _fn_f(vec2 z) {');
    expect(g.code).toBe('atan(_fn_f(vec2(x, y)).y, _fn_f(vec2(x, y)).x)');
    const w = wgsl(ce, '|f(x+iy)|');
    expect(w.success).toBe(true);
    expect(w.preamble).toContain('fn _fn_f(z: vec2f) -> vec2f {');
    expect(w.code).toBe('length(_fn_f(vec2f(x, y)))');
  });

  it('a complex function that calls another one passes its `vec2`', () => {
    const ce = engineWith(
      ['f', '(complex) -> complex', 'z \\mapsto z^2'],
      ['h', '(complex) -> complex', 'w \\mapsto f(w) + 1']
    );
    const g = glsl(ce, '\\arg(h(x+iy))');
    expect(g.success).toBe(true);
    expect(g.preamble).toContain('vec2 _fn_h(vec2 w) {');
    expect(g.preamble).toContain('return _fn_f(w) + vec2(1.0, 0.0);');
    const w = wgsl(ce, '\\arg(h(x+iy))');
    expect(w.success).toBe(true);
    expect(w.preamble).toContain('return _fn_f(w) + vec2f(1.0, 0.0);');
  });

  it('computes the interpreter value at sample points (GLSL)', () => {
    const ce = engineWith(
      ['f', '(complex) -> complex', 'z \\mapsto z^2'],
      ['h', '(complex) -> complex', 'w \\mapsto f(w) + 1']
    );
    for (const latex of [
      'f(x+iy)',
      '\\arg(f(x+iy))',
      '|f(x+iy)|',
      'h(x+iy)',
      '\\arg(h(x+iy))',
    ])
      for (const v of SAMPLES) expectGLSLValue(ce, latex, v);
  });

  it('a body with a real-only operation fails closed', () => {
    const ce = engineWith(
      ['g', '(complex) -> complex', 'z \\mapsto \\lfloor z \\rfloor'],
      ['h', '(complex) -> complex', 'z \\mapsto \\Gamma(z)']
    );
    for (const run of [glsl, wgsl]) {
      expect(() => run(ce, '|g(x+iy)|')).toThrow(
        /Floor: the target's lowering for this head is real-only/
      );
      expect(() => run(ce, '|h(x+iy)|')).toThrow(
        /Gamma: the target's lowering for this head is real-only/
      );
    }
  });
});

describe('GPU: the declared result type and the value of the body', () => {
  // The body of a function with a declared result type is
  // `Typed(value, type)`. The definition returns the declared type, so the
  // lowering of `Typed` converts the value to it, or fails closed.

  it('a real value under a complex result is lifted to `vec2(v, 0.0)`', () => {
    // Before, the definition was `vec2 _fn_s(vec2 z) { return (z).x; }`,
    // which no shader compiler accepts, behind `success: true`.
    const ce = engineWith([
      's',
      '(complex) -> complex',
      'z \\mapsto \\operatorname{Re}(z)',
    ]);
    const g = glsl(ce, 's(x+iy)');
    expect(g.success).toBe(true);
    expect(g.preamble).toContain(
      'vec2 _fn_s(vec2 z) {\n  return vec2((z).x, 0.0);\n}'
    );
    expect(g.code).toBe('_fn_s(vec2(x, y))');
    const w = wgsl(ce, 's(x+iy)');
    expect(w.success).toBe(true);
    expect(w.preamble).toContain(
      'fn _fn_s(z: vec2f) -> vec2f {\n  return vec2f((z).x, 0.0);\n}'
    );
    expect(w.code).toBe('_fn_s(vec2f(x, y))');
  });

  it('a real value under a complex result: interpreter values (GLSL)', () => {
    for (const body of [
      '\\operatorname{Re}(z)',
      '\\operatorname{Re}(z) + 1',
      '|z|',
    ]) {
      const ce = engineWith([
        's',
        '(complex) -> complex',
        `z \\mapsto ${body}`,
      ]);
      for (const latex of [
        's(x+iy)',
        's(x+iy)+1',
        '\\arg(s(x+iy))',
        '\\sin(s(x+iy))',
        '|s(x+iy)|',
      ])
        for (const v of SAMPLES) expectGLSLValue(ce, latex, v);
    }
  });

  it('a complex value under a real result fails closed', () => {
    // The interpreter returns the complex value (`s(1+i)` is `2i`) and keeps
    // the type `real`. A shader function has one return type, and there is
    // no conversion from a `vec2` to a `float` that keeps the value.
    const ce = engineWith(['s', '(complex) -> real', 'z \\mapsto z^2']);
    expect(() => glsl(ce, 's(x+iy)')).toThrow(
      /Typed: the value `\(x \+ i \* y\)\^2` is complex, but its ascribed type `real` says it is real\..*\(unknown\) -> complex/s
    );
    expect(() => wgsl(ce, 's(x+iy)')).toThrow(
      /Typed: the value `\(x \+ i \* y\)\^2` is complex, but its ascribed type `real` says it is real\..*\(unknown\) -> complex/s
    );
  });

  it('a real value under a real result is unchanged', () => {
    const ce = engineWith(['s', '(complex) -> real', 'z \\mapsto |z|']);
    const g = glsl(ce, 's(x+iy)');
    expect(g.preamble).toContain(
      'float _fn_s(vec2 z) {\n  return length(z);\n}'
    );
    for (const v of SAMPLES) expectGLSLValue(ce, 's(x+iy)', v);
  });

  it('a value that is not a number under a complex result fails closed', () => {
    for (const body of ['(t, 2t)', 't > 0']) {
      const ce = engineWith(['s', '(real) -> complex', `t \\mapsto ${body}`]);
      for (const run of [glsl, wgsl])
        expect(() => run(ce, 's(x)')).toThrow(
          /Typed: the ascribed type `complex` says the value is complex, but the value .* is not a number/
        );
    }
  });

  it('other ascriptions keep the shader type of the value', () => {
    // A point under a tuple type is a `vec2` on both sides.
    const pair = engineWith([
      's',
      '(real) -> tuple<real, real>',
      't \\mapsto (t, 2t)',
    ]);
    expect(glsl(pair, 's(x)').preamble).toContain(
      'vec2 _fn_s(float t) {\n  return vec2(t, 2.0 * t);\n}'
    );
    // An integer result is a `float` in a shader: the value is unchanged.
    const int = engineWith(['s', '(real) -> integer', 't \\mapsto t/2']);
    expect(wgsl(int, 's(x)').preamble).toContain(
      'fn _fn_s(t: f32) -> f32 {\n  return 0.5 * t;\n}'
    );
    // A `number` or `unknown` result over a real value is not read as
    // complex: the value stays a `float`.
    for (const result of ['number', 'unknown']) {
      const ce = engineWith(['s', `(real) -> ${result}`, 't \\mapsto t^2']);
      const g = glsl(ce, 's(x)+1');
      expect(g.preamble).toContain(
        'float _fn_s(float t) {\n  return (t * t);\n}'
      );
      expect(g.code).toBe('_fn_s(x) + 1.0');
    }
  });
});

describe('GPU: the engine type of each free symbol after the compile', () => {
  // A host reads these types to declare its uniforms: a `number` is a
  // `float`, a `complex` a `vec2`, a tuple of 3 reals a `vec3`, a `boolean` a
  // `bool`.
  function typedEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    // `f` makes an undeclared `x` complex once `f(x)` is canonicalized.
    ce.declare('f', { signature: '(complex) -> complex' });
    ce.assign('f', ce.parse('z \\mapsto z^2'));
    ce.declare('p', 'tuple<real, real, real>');
    ce.declare('B', 'boolean');
    return ce;
  }

  const LATEX =
    '\\arg(f(x)) + t + p_1 + \\begin{cases}1 & B\\\\0 & \\text{otherwise}\\end{cases}';
  const JSON_EXPR = [
    'Add',
    ['Arg', ['f', 'x']],
    't',
    ['At', 'p', 1],
    ['If', 'B', 1, 0],
  ];

  const expected = {
    x: 'complex',
    t: 'number',
    p: 'tuple<real, real, real>',
    B: 'boolean',
  };
  const typesOf = (ce: ComputeEngine, names: string[]) =>
    Object.fromEntries(names.map((n) => [n, ce.box(n).type.toString()]));

  for (const [name, run] of [
    ['GLSL', glsl],
    ['WGSL', wgsl],
  ] as const) {
    it(`${name}, parse and box routes`, () => {
      for (const input of [LATEX, JSON_EXPR]) {
        const ce = typedEngine();
        const r = run(ce, input);
        expect(r.success).toBe(true);
        expect(typesOf(ce, r.freeSymbols)).toEqual(expected);
      }
    });
  }

  it('the complex argument is read as a vec2 in the emitted code', () => {
    const ce = typedEngine();
    expect(glsl(ce, ['f', 'x']).code).toBe('_fn_f(x)');
    expect(ce.box('x').type.toString()).toBe('complex');
    expect(glsl(ce, ['f', 'x']).preamble).toContain('vec2 _fn_f(vec2 z)');
  });

  it('a complex argument built from real symbols leaves them real', () => {
    const ce = typedEngine();
    const r = glsl(ce, '\\arg(f(u+iv))');
    expect(r.success).toBe(true);
    expect([...r.freeSymbols].sort()).toEqual(['u', 'v']);
    for (const n of r.freeSymbols)
      expect(ce.box(n).type.matches('complex')).toBe(false);
  });

  it('a Mandelbrot point symbol is complex', () => {
    const ce = new ComputeEngine();
    const r = wgsl(ce, ['Mandelbrot', 'c', 100]);
    expect(r.code).toBe('_fractal_mandelbrot(c, 100)');
    expect(ce.box('c').type.toString()).toBe('complex');
  });
});

describe('GPU: real-only lowerings reject a complex argument', () => {
  const ce = new ComputeEngine();
  // Before, each of these emitted either a helper call no shader compiler
  // accepts (`_gpu_gamma(vec2(x, y))`) or a componentwise builtin with a
  // different value than the interpreter (`asinh(1.0 / (vec2(x, y)))`),
  // behind `success: true`.
  //
  // The shader targets declare them real-only (`gpuIsRealOnlyLowering`), and
  // the base compiler rejects a complex argument of a real-only lowering
  // before the lowering runs. The `shaderOnly` heads have a complex form on
  // another target (JavaScript `_SYS.cacot`, Python `scipy.special.gamma`),
  // which does not change the answer here.
  const shared: any[] = [
    ['Arctan2', Z, 'u'],
    ['Arctan2', 'u', Z],
    ['Haversine', Z],
    ['GammaLn', Z],
    ['Beta', Z, 'u'],
    ['Erf', Z],
    ['Erfc', Z],
    ['ErfInv', Z],
    ['Heaviside', Z],
    ['Sinc', Z],
    ['FresnelC', Z],
    ['FresnelS', Z],
    ['BesselJ', 'u', Z],
  ];
  const shaderOnly: any[] = [
    ['Arccot', Z],
    ['Arcsch', Z],
    ['InverseHaversine', Z],
    ['Gamma', Z],
    ['Factorial', Z],
  ];
  for (const [cases, message] of [
    [shared, "the target's lowering for this head is real-only"],
    [shaderOnly, "the target's lowering for this head is real-only"],
  ] as const) {
    for (const c of cases) {
      it(`${c[0]} with a complex argument fails closed; a real one compiles`, () => {
        for (const run of [glsl, wgsl]) {
          expect(() => run(ce, c)).toThrow(`${c[0]}: ${message}`);
          const real = c.map((a: any) => (a === Z ? 'x' : a));
          expect(run(ce, real).success).toBe(true);
        }
      });
    }
  }

  it('JavaScript: `Haversine` and `BesselJ` of a maybe-complex operand', () => {
    // Before, the JavaScript lowerings passed the `{ re, im }` object to
    // `Math.cos` and `_SYS.besselJ`, and the result was NaN even when the
    // imaginary part was zero at run time. Now the real part is used when
    // the imaginary part is zero, and the result is NaN otherwise.
    for (const expr of [
      ['Haversine', Z],
      ['BesselJ', 1, Z],
    ]) {
      const r = compile(ce.box(expr), { to: 'javascript' } as any) as any;
      expect(r.success).toBe(true);
      const real = ce.box(expr).subs({ x: 0.5, y: 0 }).N().re;
      expect(Number.isFinite(real)).toBe(true);
      expect(r.run({ x: 0.5, y: 0 })).toBeCloseTo(real, 12);
      expect(r.run({ x: 0.5, y: 0.25 })).toBeNaN();
    }
  });
});

describe('GPU: Root of a complex radicand', () => {
  // A complex radicand is a `vec2`. Before, the shader targets declared
  // `Root` real-only and failed it closed. It takes the principal root
  // through `_gpu_cpow`, except for a radicand whose imaginary part is zero
  // under an odd integer degree, which has the real root, as in the
  // interpreter and the JavaScript `_SYS.croot`.
  const ce = new ComputeEngine();
  for (const latex of ['\\sqrt[3]{x+iy}', '\\sqrt[4]{x+iy}', '\\sqrt[5]{x+iy}'])
    it(`GLSL value of ${latex}`, () => {
      // The degree is emitted as a `float` literal (`0.33333334`), so the
      // value is compared at single precision.
      for (const v of [...SAMPLES, { x: -8, y: 0 }, { x: 5, y: 0 }]) {
        const expected = ce.parse(latex).subs(v).N();
        const actual = evalGLSLValue(ce, latex, v);
        expect(isVec2(actual)).toBe(true);
        expect((actual as Vec2).x).toBeCloseTo(expected.re, 6);
        expect((actual as Vec2).y).toBeCloseTo(expected.im, 6);
      }
    });

  it('the odd degree over a real-at-run-time radicand is the real root', () => {
    expect(ce.parse('\\sqrt[3]{x+iy}').subs({ x: -8, y: 0 }).N().re).toBe(-2);
    const v = evalGLSLValue(ce, '\\sqrt[3]{x+iy}', { x: -8, y: 0 }) as Vec2;
    expect(v.x).toBeCloseTo(-2, 6);
    expect(v.y).toBe(0);
  });

  it('WGSL emits the same lowering, with `select` for the real root', () => {
    expect(wgsl(ce, ['Root', Z, 4]).code).toBe(
      '_gpu_cpow(vec2f(x, y), vec2f(0.25, 0.0))'
    );
    expect(wgsl(ce, ['Root', Z, 3]).code).toBe(
      'select(_gpu_cpow(vec2f(x, y), vec2f(0.33333334, 0.0)), ' +
        'vec2f(sign((vec2f(x, y)).x) * pow(abs((vec2f(x, y)).x), 0.33333334), 0.0), ' +
        '(vec2f(x, y)).y == 0.0)'
    );
  });

  it('a complex degree fails closed', () => {
    for (const run of [glsl, wgsl])
      expect(() => run(ce, ['Root', 'x', Z])).toThrow(
        'Root: a complex degree has no shader lowering'
      );
  });
});

describe('GPU: Root with a compound degree', () => {
  it('parenthesizes the degree', () => {
    const ce = new ComputeEngine();
    expect(glsl(ce, ['Root', 'x', ['Add', 'u', 1]]).code).toBe(
      'pow(x, 1.0 / (u + 1.0))'
    );
    expect(wgsl(ce, ['Root', 'x', ['Add', 'u', 1]]).code).toBe(
      'pow(x, 1.0 / (u + 1.0))'
    );
    // A single name is not parenthesized (the output is unchanged).
    expect(glsl(ce, ['Root', 'x', 'n']).code).toBe('pow(x, 1.0 / n)');
  });
});

describe('GPU: the iteration count of a fractal is an integer', () => {
  // The count is converted with `int(…)`. A complex count emitted
  // `int(vec2(x, y))`, which no shader compiler accepts.
  const ce = new ComputeEngine();
  it('a complex count fails closed; a complex point compiles', () => {
    for (const run of [glsl, wgsl]) {
      expect(() => run(ce, ['Mandelbrot', 'u', Z])).toThrow(
        'Mandelbrot: the integer operand `x + i * y` is complex'
      );
      expect(() => run(ce, ['Julia', Z, 'c', Z])).toThrow(
        'Julia: the integer operand `x + i * y` is complex'
      );
      expect(run(ce, ['Mandelbrot', Z, 'u']).success).toBe(true);
      expect(run(ce, ['Julia', Z, Z, 'u']).success).toBe(true);
    }
    expect(glsl(ce, ['Mandelbrot', Z, 'u']).code).toBe(
      '_fractal_mandelbrot(vec2(x, y), int(u))'
    );
    expect(wgsl(ce, ['Julia', Z, Z, 'u']).code).toBe(
      '_fractal_julia(vec2f(x, y), vec2f(x, y), i32(u))'
    );
  });
});
