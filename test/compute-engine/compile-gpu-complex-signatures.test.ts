import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Complex values and the signatures of user functions on the shader targets.
 *
 * On GLSL a complex value lowers to a `vec2` of (re, im), and a real
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
  return (
    src
      // The NaN-part guard of the complex and colour helpers
      // (`gpuNaNPartGuard`): the bit test of one part is a NaN test.
      .replace(
        /^(\s*)if \(\(floatBitsToUint\((\w+)\.([xyz])\) & 0x7FFFFFFFu\) > 0x7F800000u\) return vec([23])\(\2\.\3\);\s*$/gm,
        (_m, indent: string, v: string, p: string, n: string) =>
          `${indent}if (Number.isNaN(${v}.${p})) return V${n}(${v}.${p});`
      )
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
      )
  );
}

/** The interpreter's value of `latex` at the given free-symbol values. */
function interp(
  ce: ComputeEngine,
  latex: string,
  vars: Record<string, number>
): number {
  return ce.parse(latex).subs(vars).N().re;
}

describe('GPU: a complex argument to a parameter not declared complex', () => {
  // The call of `f` with a complex argument uses a copy of the definition
  // whose parameter is a `vec2` (`_fn_f_complex`), emitted when a call needs
  // it. A call with a real argument keeps the `float` definition.
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

describe('GPU: the declared result type and the value of the body', () => {
  // A point body and a boolean body have no value in common with `complex`,
  // so their assignment is refused when it is made.
  it('a value that is not a number under a complex result is refused', () => {
    for (const body of ['(t, 2t)', 't > 0'])
      expect(() =>
        engineWith(['s', '(real) -> complex', `t \\mapsto ${body}`])
      ).toThrow(/is not compatible with the type/);
  });
});

describe('GPU: the engine type of each free symbol after the compile', () => {
  // A host reads these types to declare its uniforms: a `number` is a
  // `float`, a `complex` a `vec2`, a tuple of 3 reals a `vec3`, a `boolean` a
  // `bool`. Boxing declares no name, so the type of an undeclared symbol is
  // read from the compilation result, not from a new boxing of the name.
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
  const typesOf = (r: any, names: string[]) =>
    Object.fromEntries(names.map((n) => [n, r.freeSymbolTypes[n].type]));

  for (const [name, run] of [['GLSL', glsl]] as const) {
    it(`${name}, parse and box routes`, () => {
      for (const input of [LATEX, JSON_EXPR]) {
        const ce = typedEngine();
        const r = run(ce, input);
        expect(r.success).toBe(true);
        expect(typesOf(r, r.freeSymbols)).toEqual(expected);
      }
    });
  }

  it('a complex argument built from real symbols leaves them real', () => {
    const ce = typedEngine();
    const r = glsl(ce, '\\arg(f(u+iv))');
    expect(r.success).toBe(true);
    expect([...r.freeSymbols].sort()).toEqual(['u', 'v']);
    for (const n of r.freeSymbols)
      expect(ce.type(r.freeSymbolTypes[n].type).matches('complex')).toBe(
        false
      );
  });
});

describe('a complex helper gives NaN for a NaN part', () => {
  // On Apple GPUs (WebGL2 over ANGLE Metal, WebGPU over Metal) the built-ins
  // `sin` and `cos` of a NaN give 0, so `exp(1 + NaN·i)` gave `(0, 0)`. The
  // helpers test each part first (`gpuNaNPartGuard`, `gpu-target.ts`). This
  // evaluator gives `sin` and `cos` that behaviour.
  const zeroAtNaN =
    (fn: (x: number) => number) =>
    (x: unknown): number =>
      isVec2(x) ? NaN : Number.isNaN(x as number) ? 0 : fn(x as number);
  const APPLE = {
    ...BUILTINS,
    cos: zeroAtNaN(Math.cos),
    sin: zeroAtNaN(Math.sin),
  };
  const run = (latex: string, vars: Record<string, number>): unknown => {
    const r = glsl(new ComputeEngine(), latex);
    expect(r.success).toBe(true);
    const names = [...Object.keys(APPLE), ...Object.keys(vars)];
    const body = `${glslToJS(r.preamble ?? '')}\nreturn (${glslExprToJS(r.code)});`;
    // eslint-disable-next-line no-new-func
    const f = new Function(...names, body);
    return f(...Object.values(APPLE), ...Object.values(vars));
  };

  test.each([
    '\\exp(x+iy)',
    '\\sinh(x+iy)',
    '\\cosh(x+iy)',
  ])('%s', (latex) => {
    for (const [x, y] of [
      [1, NaN],
      [NaN, 1],
    ]) {
      const v = run(latex, { x, y });
      expect(isVec2(v)).toBe(true);
      expect(Number.isNaN((v as Vec2).x)).toBe(true);
      expect(Number.isNaN((v as Vec2).y)).toBe(true);
    }
    // A finite operand is unchanged by the guard.
    const v = run(latex, { x: 0.5, y: 0.25 }) as Vec2;
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });
});
