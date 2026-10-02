/**
 * An f32 interpreter for the small subset of GLSL and WGSL that the GPU
 * complex helpers (`GPU_COMPLEX_FUNCTIONS`, `compilation/gpu-target.ts`) are
 * written in. Shader text cannot run under jest; this interpreter runs the
 * EMITTED text of a helper, so a test checks the shader source itself, not
 * a copy of it.
 *
 * Every arithmetic result is rounded to f32 with `Math.fround`, and every
 * built-in function (`sqrt`, `log`, `atan`, ...) is the double result
 * rounded once to f32: a CORRECTLY ROUNDED built-in. The shading languages
 * allow much larger errors: GLSL.std.450 and WGSL allow `log` an absolute
 * error of 2⁻²¹ on [0.5, 2] and 3 ULP elsewhere, and `atan`/`atan2` an error
 * of 4096 ULP. So this tests the algorithm (cancellation, overflow, the side
 * of a branch cut), not a driver: an accuracy measured here is the accuracy
 * with correctly rounded built-ins. A subnormal result is kept (many GPUs
 * flush it to zero).
 *
 * The subset: function definitions (GLSL `float f(float x) {...}` and WGSL
 * `fn f(x: f32) -> f32 {...}`), `float`/`vec2`/`let`/`var` declarations,
 * assignments, `if`, `return`, the operators `?:` (GLSL only), `||`, `&&`,
 * `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, unary `-`, the members
 * `.x` and `.y`, and calls of the helpers and of `abs`, `max`, `min`,
 * `sqrt`, `log`, `exp`, `sin`, `cos`, `length`, GLSL `atan` (one or two
 * arguments) and `vec2`, and WGSL `atan` (one argument), `atan2`, `select`
 * and `vec2f`. The NaN and infinity helpers `_gpu_nan` and `_gpu_inf`, which
 * build their value from a bit pattern, are read as `0.0 / 0.0` and
 * `1.0 / 0.0`.
 *
 * The text is also checked against some rules of its language, which a
 * shader compiler enforces and this interpreter would otherwise not see:
 *  - both: a numeric literal must have a decimal point (the helpers compute
 *    with floats only, and GLSL ES has no implicit int-to-float conversion);
 *  - GLSL: a function must be defined before a call to it; a declaration
 *    starts with its type; there is no `fn`, `let`, `var`, `atan2`,
 *    `select` or `vec2f`;
 *  - WGSL: no `?:`; the body of an `if` is a block; a declaration starts
 *    with `let` or `var`, and only a `var` can be assigned (a parameter and
 *    a `let` cannot); there is no `vec2` and no two-argument `atan`.
 */

export type Value = number | { x: number; y: number };

const fr = Math.fround;

type Node =
  | { k: 'num'; v: number }
  | { k: 'id'; name: string }
  | { k: 'member'; obj: Node; name: 'x' | 'y' }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'neg'; e: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'cond'; c: Node; t: Node; f: Node };

type Stmt =
  | { k: 'decl'; name: string; e: Node }
  | { k: 'assign'; name: string; e: Node }
  | { k: 'if'; c: Node; body: Stmt[] }
  | { k: 'return'; e: Node };

interface Fn {
  params: string[];
  body: Stmt[];
}

export type ShaderLanguage = 'glsl' | 'wgsl';

function tokenize(src: string): string[] {
  const re =
    /\s*([0-9]+\.[0-9]*(?:e[-+]?[0-9]+)?|[0-9]+(?:e[-+]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_]*|->|==|!=|<=|>=|\|\||&&|[-+*/(){}<>=?:;,.])/y;
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m)
      throw new Error(`Cannot read shader text at: ${src.slice(i, i + 30)}`);
    if (/^[0-9]/.test(m[1]) && !m[1].includes('.'))
      throw new Error(`Numeric literal without a decimal point: ${m[1]}`);
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

const TYPES = new Set(['float', 'vec2', 'f32', 'vec2f']);

const COMMON_BUILTINS = new Set([
  'abs',
  'max',
  'min',
  'sqrt',
  'log',
  'exp',
  'sin',
  'cos',
  'atan',
  'length',
]);
const LANGUAGE_BUILTINS: Record<ShaderLanguage, Set<string>> = {
  glsl: new Set(['vec2']),
  wgsl: new Set(['atan2', 'select', 'vec2f']),
};

class Parser {
  i = 0;
  /** The functions defined so far. */
  defined = new Set<string>();
  /** Whether each name of the current function can be assigned. */
  mutable = new Map<string, boolean>();
  constructor(
    private t: string[],
    private lang: ShaderLanguage
  ) {}
  fail(msg: string): never {
    throw new Error(`${this.lang.toUpperCase()}: ${msg}`);
  }
  peek(o = 0): string | undefined {
    return this.t[this.i + o];
  }
  next(): string {
    const s = this.t[this.i++];
    if (s === undefined) throw new Error('Unexpected end of shader text');
    return s;
  }
  expect(s: string): void {
    const n = this.next();
    if (n !== s) throw new Error(`Expected "${s}", read "${n}"`);
  }

  functions(): Map<string, Fn> {
    const fns = new Map<string, Fn>();
    while (this.peek() !== undefined) {
      let name: string;
      const params: string[] = [];
      if ((this.peek() === 'fn') !== (this.lang === 'wgsl'))
        this.fail(`function definition at "${this.peek()} ${this.peek(1)}"`);
      if (this.peek() === 'fn') {
        this.next();
        name = this.next();
        this.expect('(');
        while (this.peek() !== ')') {
          params.push(this.next());
          this.expect(':');
          this.next();
          if (this.peek() === ',') this.next();
        }
        this.expect(')');
        this.expect('->');
        this.next();
      } else {
        this.next(); // return type
        name = this.next();
        this.expect('(');
        while (this.peek() !== ')') {
          this.next(); // type
          params.push(this.next());
          if (this.peek() === ',') this.next();
        }
        this.expect(')');
      }
      this.mutable = new Map(params.map((p) => [p, this.lang === 'glsl']));
      fns.set(name, { params, body: this.block() });
      this.defined.add(name);
    }
    return fns;
  }

  block(): Stmt[] {
    this.expect('{');
    const body: Stmt[] = [];
    while (this.peek() !== '}') body.push(this.statement());
    this.expect('}');
    return body;
  }

  statement(): Stmt {
    const s = this.peek()!;
    if (s === 'if') {
      this.next();
      this.expect('(');
      const c = this.expr();
      this.expect(')');
      if (this.lang === 'wgsl' && this.peek() !== '{')
        this.fail('the body of an `if` must be a block');
      const body = this.peek() === '{' ? this.block() : [this.statement()];
      return { k: 'if', c, body };
    }
    if (s === 'return') {
      this.next();
      const e = this.expr();
      this.expect(';');
      return { k: 'return', e };
    }
    if (TYPES.has(s) || s === 'let' || s === 'var') {
      if ((s === 'let' || s === 'var') !== (this.lang === 'wgsl'))
        this.fail(`a declaration cannot start with "${s}"`);
      this.next();
      const name = this.next();
      this.mutable.set(name, s !== 'let');
      this.expect('=');
      const e = this.expr();
      this.expect(';');
      return { k: 'decl', name, e };
    }
    const name = this.next();
    if (this.mutable.get(name) !== true)
      this.fail(`assignment to "${name}", which is not a variable`);
    this.expect('=');
    const e = this.expr();
    this.expect(';');
    return { k: 'assign', name, e };
  }

  expr(): Node {
    const c = this.binary(0);
    if (this.peek() !== '?') return c;
    if (this.lang === 'wgsl') this.fail('there is no `?:` operator');
    this.next();
    const t = this.expr();
    this.expect(':');
    const f = this.expr();
    return { k: 'cond', c, t, f };
  }

  static PREC: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '<=': 4,
    '>': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
  };

  binary(min: number): Node {
    let a = this.unary();
    for (;;) {
      const op = this.peek();
      const p = op === undefined ? undefined : Parser.PREC[op];
      if (p === undefined || p <= min) return a;
      this.next();
      const b = this.binary(p);
      a = { k: 'bin', op: op!, a, b };
    }
  }

  unary(): Node {
    if (this.peek() === '-') {
      this.next();
      return { k: 'neg', e: this.unary() };
    }
    let e = this.primary();
    while (this.peek() === '.') {
      this.next();
      const name = this.next();
      if (name !== 'x' && name !== 'y') throw new Error(`Member .${name}`);
      e = { k: 'member', obj: e, name };
    }
    return e;
  }

  primary(): Node {
    const s = this.next();
    if (s === '(') {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (/^[0-9]/.test(s)) return { k: 'num', v: fr(Number(s)) };
    if (this.peek() === '(') {
      this.next();
      const args: Node[] = [];
      while (this.peek() !== ')') {
        args.push(this.expr());
        if (this.peek() === ',') this.next();
      }
      this.expect(')');
      if (COMMON_BUILTINS.has(s) || LANGUAGE_BUILTINS[this.lang].has(s)) {
        if (s === 'atan' && this.lang === 'wgsl' && args.length !== 1)
          this.fail('`atan` takes one argument (use `atan2`)');
      } else if (this.lang === 'glsl' && !this.defined.has(s))
        this.fail(`call of "${s}" before its definition`);
      return { k: 'call', name: s, args };
    }
    return { k: 'id', name: s };
  }
}

function lift(a: Value, b: Value, f: (x: number, y: number) => number): Value {
  if (typeof a === 'number' && typeof b === 'number') return fr(f(a, b));
  const ax = typeof a === 'number' ? { x: a, y: a } : a;
  const bx = typeof b === 'number' ? { x: b, y: b } : b;
  return { x: fr(f(ax.x, bx.x)), y: fr(f(ax.y, bx.y)) };
}

const num = (v: Value): number => {
  if (typeof v !== 'number') throw new Error('Expected a scalar');
  return v;
};

const BUILTINS: Record<string, (...a: Value[]) => Value> = {
  abs: (x) => Math.abs(num(x)),
  max: (x, y) => Math.max(num(x), num(y)),
  min: (x, y) => Math.min(num(x), num(y)),
  sqrt: (x) => fr(Math.sqrt(num(x))),
  log: (x) => fr(Math.log(num(x))),
  exp: (x) => fr(Math.exp(num(x))),
  sin: (x) => fr(Math.sin(num(x))),
  cos: (x) => fr(Math.cos(num(x))),
  atan: (y, x) =>
    x === undefined ? fr(Math.atan(num(y))) : fr(Math.atan2(num(y), num(x))),
  atan2: (y, x) => fr(Math.atan2(num(y), num(x))),
  length: (v) => {
    if (typeof v === 'number') return Math.abs(v);
    return fr(Math.sqrt(fr(fr(v.x * v.x) + fr(v.y * v.y))));
  },
  select: (f, t, c) => (c ? t : f),
  vec2: (x, y) => ({ x: num(x), y: num(y ?? x) }),
  vec2f: (x, y) => ({ x: num(x), y: num(y ?? x) }),
};

/** Parse the shader text `src` (one or more function definitions) and
 * return a function that calls the named shader function. */
export function shaderFunctions(
  src: string,
  language: ShaderLanguage
): (name: string, ...args: Value[]) => Value {
  // The NaN and infinity helpers are built from a bit pattern (a hex literal
  // and `intBitsToFloat` or `bitcast<f32>`): their bodies are replaced.
  src = src.replace(
    /(float _gpu_(inf|nan)\(\)|fn _gpu_(inf|nan)\(\) -> f32)\s*\{[^}]*\}/g,
    (_m, head: string, a?: string, b?: string) =>
      `${head} { return ${(a ?? b) === 'inf' ? '1.0' : '0.0'} / 0.0; }`
  );
  const fns = new Parser(tokenize(src), language).functions();

  const call = (name: string, args: Value[]): Value => {
    const fn = fns.get(name);
    if (!fn) {
      const b = BUILTINS[name];
      if (!b) throw new Error(`Unknown function ${name}`);
      return b(...args);
    }
    const env = new Map<string, Value>();
    fn.params.forEach((p, i) => env.set(p, args[i]));
    const r = run(fn.body, env);
    if (r === undefined) throw new Error(`${name} returned no value`);
    return r;
  };

  const evaluate = (e: Node, env: Map<string, Value>): Value | boolean => {
    switch (e.k) {
      case 'num':
        return e.v;
      case 'id': {
        const v = env.get(e.name);
        if (v === undefined) throw new Error(`Unknown name ${e.name}`);
        return v;
      }
      case 'member': {
        const v = evaluate(e.obj, env) as Value;
        if (typeof v === 'number') throw new Error('Member of a scalar');
        return v[e.name];
      }
      case 'neg': {
        const v = evaluate(e.e, env) as Value;
        return typeof v === 'number' ? -v : { x: -v.x, y: -v.y };
      }
      case 'cond':
        return evaluate(e.c, env) ? evaluate(e.t, env) : evaluate(e.f, env);
      case 'call':
        return call(
          e.name,
          e.args.map((a) => evaluate(a, env) as Value)
        );
      case 'bin': {
        const a = evaluate(e.a, env);
        if (e.op === '||') return Boolean(a) || Boolean(evaluate(e.b, env));
        if (e.op === '&&') return Boolean(a) && Boolean(evaluate(e.b, env));
        const b = evaluate(e.b, env);
        switch (e.op) {
          case '==':
            return num(a as Value) === num(b as Value);
          case '!=':
            return num(a as Value) !== num(b as Value);
          case '<':
            return num(a as Value) < num(b as Value);
          case '<=':
            return num(a as Value) <= num(b as Value);
          case '>':
            return num(a as Value) > num(b as Value);
          case '>=':
            return num(a as Value) >= num(b as Value);
          case '+':
            return lift(a as Value, b as Value, (x, y) => x + y);
          case '-':
            return lift(a as Value, b as Value, (x, y) => x - y);
          case '*':
            return lift(a as Value, b as Value, (x, y) => x * y);
          case '/':
            return lift(a as Value, b as Value, (x, y) => x / y);
        }
        throw new Error(`Operator ${e.op}`);
      }
    }
  };

  const run = (body: Stmt[], env: Map<string, Value>): Value | undefined => {
    for (const s of body) {
      if (s.k === 'decl' || s.k === 'assign')
        env.set(s.name, evaluate(s.e, env) as Value);
      else if (s.k === 'return') return evaluate(s.e, env) as Value;
      else if (evaluate(s.c, env)) {
        const r = run(s.body, env);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };

  return (name, ...args) =>
    call(
      name,
      args.map((a) =>
        typeof a === 'number' ? fr(a) : { x: fr(a.x), y: fr(a.y) }
      )
    );
}
