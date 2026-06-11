// Wolfram Language InputForm expression parser → MathJSON.
//
// Scope: the subset of InputForm used by the Rubi test suites
// (https://github.com/RuleBasedIntegration/MathematicaSyntaxTestSuite):
// numbers, symbols, function calls `F[a, b]`, lists `{a, b}`, parentheses,
// operators `+ - * / ^` (with WL precedence, `^` right-associative),
// juxtaposition-as-multiplication, and unary minus (binds looser than `^`).
//
// Head and symbol mapping to Compute Engine names happens in a single
// table at the end (WL `Log` → `Ln`, `ArcTan` → `Arctan`, `E` →
// `ExponentialE`, …). Unknown heads pass through unchanged so shell-declared
// operators (Hypergeometric2F1, EllipticF, …) keep working.

export type Json = number | string | Json[];

type Token =
  | { kind: 'number'; value: string; spaceBefore: boolean }
  | { kind: 'symbol'; value: string; spaceBefore: boolean }
  | { kind: 'punct'; value: string; spaceBefore: boolean };

class Tokenizer {
  private pos = 0;
  readonly tokens: Token[] = [];

  constructor(private src: string) {
    this.tokenize();
  }

  private tokenize(): void {
    const s = this.src;
    while (this.pos < s.length) {
      let spaceBefore = false;
      while (this.pos < s.length && /\s/.test(s[this.pos])) {
        spaceBefore = true;
        this.pos++;
      }
      if (this.pos >= s.length) break;
      const c = s[this.pos];
      // Comments (* ... *) — skip (no nesting in the test suite)
      if (c === '(' && s[this.pos + 1] === '*') {
        const end = s.indexOf('*)', this.pos + 2);
        if (end < 0) throw new Error('unterminated comment');
        this.pos = end + 2;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[this.pos + 1]))) {
        const m = /^[0-9]*\.?[0-9]+(`[0-9.]*)?/.exec(s.slice(this.pos))!;
        this.tokens.push({ kind: 'number', value: m[0], spaceBefore });
        this.pos += m[0].length;
        continue;
      }
      if (/[A-Za-z$]/.test(c)) {
        const m = /^[A-Za-z$][A-Za-z0-9$]*/.exec(s.slice(this.pos))!;
        this.tokens.push({ kind: 'symbol', value: m[0], spaceBefore });
        this.pos += m[0].length;
        continue;
      }
      if ('[](){},^*/+-!'.includes(c)) {
        this.tokens.push({ kind: 'punct', value: c, spaceBefore });
        this.pos++;
        continue;
      }
      throw new Error(`unexpected character '${c}' at ${this.pos}`);
    }
  }
}

// WL precedence (subset): Plus 10 < Times 20 < unary-minus 15 (looser than
// Power) < Power 30 (right-assoc) < Factorial 40.
const PREC_PLUS = 10;
const PREC_TIMES = 20;
const PREC_UNARY_MINUS = 15;
const PREC_POWER = 30;
const PREC_FACTORIAL = 40;

class Parser {
  private i = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }
  private next(): Token {
    const t = this.tokens[this.i++];
    if (!t) throw new Error('unexpected end of input');
    return t;
  }
  private expect(value: string): void {
    const t = this.next();
    if (t.kind !== 'punct' || t.value !== value)
      throw new Error(`expected '${value}', got '${t.value}'`);
  }

  atEnd(): boolean {
    return this.i >= this.tokens.length;
  }

  parseExpression(minPrec = 0): Json {
    let lhs = this.parsePrefix();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.kind === 'punct') {
        if (t.value === '+' && PREC_PLUS >= minPrec) {
          this.next();
          lhs = flatBinary('Add', lhs, this.parseExpression(PREC_PLUS + 1));
          continue;
        }
        if (t.value === '-' && PREC_PLUS >= minPrec) {
          this.next();
          lhs = ['Subtract', lhs, this.parseExpression(PREC_PLUS + 1)];
          continue;
        }
        if (t.value === '*' && PREC_TIMES >= minPrec) {
          this.next();
          lhs = flatBinary(
            'Multiply',
            lhs,
            this.parseExpression(PREC_TIMES + 1)
          );
          continue;
        }
        if (t.value === '/' && PREC_TIMES >= minPrec) {
          this.next();
          lhs = divide(lhs, this.parseExpression(PREC_TIMES + 1));
          continue;
        }
        if (t.value === '^' && PREC_POWER >= minPrec) {
          this.next();
          // right-associative
          lhs = ['Power', lhs, this.parseExpression(PREC_POWER)];
          continue;
        }
        if (t.value === '!' && PREC_FACTORIAL >= minPrec) {
          this.next();
          lhs = ['Factorial', lhs];
          continue;
        }
      }
      // Juxtaposition = multiplication: `2 x`, `a (b + c)` — an operand
      // token follows directly. Only when we can still bind at Times level.
      if (
        PREC_TIMES >= minPrec &&
        (t.kind === 'number' ||
          t.kind === 'symbol' ||
          (t.kind === 'punct' && t.value === '('))
      ) {
        lhs = flatBinary('Multiply', lhs, this.parseExpression(PREC_TIMES + 1));
        continue;
      }
      break;
    }
    return lhs;
  }

  private parsePrefix(): Json {
    const t = this.next();
    if (t.kind === 'punct') {
      if (t.value === '-') {
        const arg = this.parseExpression(PREC_UNARY_MINUS + 1);
        return negate(arg);
      }
      if (t.value === '+') return this.parseExpression(PREC_UNARY_MINUS + 1);
      if (t.value === '(') {
        const e = this.parseExpression(0);
        this.expect(')');
        return this.parsePostfix(e);
      }
      if (t.value === '{') {
        const items: Json[] = [];
        if (!(this.peek()?.kind === 'punct' && this.peek()!.value === '}')) {
          items.push(this.parseExpression(0));
          while (this.peek()?.kind === 'punct' && this.peek()!.value === ',') {
            this.next();
            items.push(this.parseExpression(0));
          }
        }
        this.expect('}');
        return this.parsePostfix(['List', ...items]);
      }
      throw new Error(`unexpected token '${t.value}'`);
    }
    if (t.kind === 'number') {
      // strip precision marks like 1.5`20
      const v = t.value.split('`')[0];
      return this.parsePostfix(v.includes('.') ? parseFloat(v) : parseInt(v));
    }
    // symbol — possibly a function call F[...]
    return this.parsePostfix(mapSymbol(t.value), t.value);
  }

  // Handles call brackets after a head: F[a, b][c]…
  private parsePostfix(expr: Json, wlHead?: string): Json {
    while (
      this.peek()?.kind === 'punct' &&
      this.peek()!.value === '[' &&
      !this.peek()!.spaceBefore
    ) {
      this.next();
      const args: Json[] = [];
      if (!(this.peek()?.kind === 'punct' && this.peek()!.value === ']')) {
        args.push(this.parseExpression(0));
        while (this.peek()?.kind === 'punct' && this.peek()!.value === ',') {
          this.next();
          args.push(this.parseExpression(0));
        }
      }
      this.expect(']');
      expr = wlHead
        ? mapCall(wlHead, args)
        : ([expr, ...args] as Json[]);
      wlHead = undefined;
    }
    return expr;
  }
}

function flatBinary(op: 'Add' | 'Multiply', a: Json, b: Json): Json {
  const ops: Json[] = [];
  for (const x of [a, b]) {
    if (Array.isArray(x) && x[0] === op) ops.push(...(x as Json[]).slice(1));
    else ops.push(x);
  }
  return [op, ...ops];
}

function negate(x: Json): Json {
  if (typeof x === 'number') return -x;
  return ['Negate', x];
}

function divide(a: Json, b: Json): Json {
  if (
    typeof a === 'number' &&
    typeof b === 'number' &&
    Number.isInteger(a) &&
    Number.isInteger(b)
  )
    return ['Rational', a, b];
  return ['Divide', a, b];
}

// ---------------------------------------------------------------------------
// WL → Compute Engine name mapping
// ---------------------------------------------------------------------------

const SYMBOL_MAP: Record<string, string> = {
  E: 'ExponentialE',
  Pi: 'Pi',
  I: 'ImaginaryUnit',
  Infinity: 'PositiveInfinity',
  GoldenRatio: 'GoldenRatio',
  EulerGamma: 'EulerGamma',
  Catalan: 'CatalanConstant',
  // Lower-case parameters that collide with Compute Engine built-ins
  // (same convention as the Fungrim corpus: rename with `_var` suffix).
  e: 'e_var',
  i: 'i_var',
  N: 'N_var',
  D: 'D_var',
};

const HEAD_MAP: Record<string, string> = {
  Sqrt: 'Sqrt',
  Exp: 'Exp',
  Abs: 'Abs',
  Sign: 'Sign',
  Floor: 'Floor',
  Ceiling: 'Ceil',
  Sin: 'Sin',
  Cos: 'Cos',
  Tan: 'Tan',
  Cot: 'Cot',
  Sec: 'Sec',
  Csc: 'Csc',
  Sinh: 'Sinh',
  Cosh: 'Cosh',
  Tanh: 'Tanh',
  Coth: 'Coth',
  Sech: 'Sech',
  Csch: 'Csch',
  ArcSin: 'Arcsin',
  ArcCos: 'Arccos',
  ArcTan: 'Arctan',
  ArcCot: 'Arccot',
  ArcSec: 'Arcsec',
  ArcCsc: 'Arccsc',
  ArcSinh: 'Arcsinh',
  ArcCosh: 'Arccosh',
  ArcTanh: 'Arctanh',
  ArcCoth: 'Arccoth',
  ArcSech: 'Arcsech',
  ArcCsch: 'Arccsch',
  Gamma: 'Gamma',
  LogGamma: 'LogGamma',
  Erf: 'Erf',
  Erfc: 'Erfc',
  Erfi: 'Erfi',
  Factorial: 'Factorial',
  Max: 'Max',
  Min: 'Min',
};

function mapSymbol(name: string): string {
  return SYMBOL_MAP[name] ?? name;
}

function mapCall(wlHead: string, args: Json[]): Json {
  // WL Log[x] is the natural log; Log[b, x] is log base b.
  if (wlHead === 'Log')
    return args.length === 1 ? ['Ln', args[0]] : ['Log', args[1], args[0]];
  const head = HEAD_MAP[wlHead];
  if (head) return [head, ...args];
  // Pass through (Hypergeometric2F1, AppellF1, EllipticE/F/Pi, PolyLog,
  // FresnelS, … — resolved as shells or reported as unknown-symbol).
  return [wlHead, ...args];
}

/** Parse a single WL InputForm expression. Throws on syntax errors. */
export function parseWL(src: string): Json {
  const parser = new Parser(new Tokenizer(src).tokens);
  const result = parser.parseExpression(0);
  if (!parser.atEnd()) throw new Error(`trailing input in: ${src}`);
  return result;
}
