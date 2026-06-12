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
  | { kind: 'string'; value: string; spaceBefore: boolean }
  | { kind: 'symbol'; value: string; spaceBefore: boolean }
  | {
      kind: 'pattern';
      /** pattern name; '' for anonymous `_` */
      name: string;
      /** head constraint, e.g. 'Symbol' in `x_Symbol` */
      head?: string;
      /** `_.` — optional with operator-derived default */
      optional: boolean;
      spaceBefore: boolean;
    }
  | { kind: 'punct'; value: string; spaceBefore: boolean };

// Multi-character operators, longest first.
const MULTI_PUNCT = [
  '=!=',
  '===',
  ':=',
  '/;',
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '->',
];

class Tokenizer {
  private pos = 0;
  readonly tokens: Token[] = [];

  constructor(private src: string) {
    this.tokenize();
  }

  // WL comments nest: (* a (* b *) c *)
  private skipComment(): void {
    let depth = 0;
    const s = this.src;
    do {
      if (s.startsWith('(*', this.pos)) {
        depth++;
        this.pos += 2;
      } else if (s.startsWith('*)', this.pos)) {
        depth--;
        this.pos += 2;
      } else if (this.pos >= s.length) {
        throw new Error('unterminated comment');
      } else this.pos++;
    } while (depth > 0);
  }

  private tokenize(): void {
    const s = this.src;
    while (this.pos < s.length) {
      let spaceBefore = false;
      for (;;) {
        if (this.pos < s.length && /\s/.test(s[this.pos])) {
          spaceBefore = true;
          this.pos++;
        } else if (s.startsWith('(*', this.pos)) {
          spaceBefore = true;
          this.skipComment();
        } else break;
      }
      if (this.pos >= s.length) break;
      const c = s[this.pos];
      // \[Star] is Times (Rubi uses it for display-deferred multiplication);
      // any other \[…] escape is unsupported — fail loudly.
      if (c === '\\' && s[this.pos + 1] === '[') {
        const m = /^\\\[([A-Za-z]+)\]/.exec(s.slice(this.pos));
        if (m?.[1] === 'Star') {
          this.tokens.push({ kind: 'punct', value: '*', spaceBefore });
          this.pos += m[0].length;
          continue;
        }
        throw new Error(`unsupported escape ${m?.[0] ?? '\\['} at ${this.pos}`);
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[this.pos + 1]))) {
        // includes trailing-dot reals (`x_^2.` in some Rubi patterns)
        const m = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(`[0-9.]*)?/.exec(
          s.slice(this.pos)
        )!;
        this.tokens.push({ kind: 'number', value: m[0], spaceBefore });
        this.pos += m[0].length;
        continue;
      }
      if (c === '"') {
        const m = /^"((?:[^"\\]|\\.)*)"/.exec(s.slice(this.pos));
        if (!m) throw new Error(`unterminated string at ${this.pos}`);
        this.tokens.push({ kind: 'string', value: m[1], spaceBefore });
        this.pos += m[0].length;
        continue;
      }
      if (/[A-Za-z$_]/.test(c)) {
        const m =
          /^([A-Za-z$][A-Za-z0-9$]*)?(_(?:[A-Za-z][A-Za-z0-9$]*)?)?/.exec(
            s.slice(this.pos)
          )!;
        const [, name, blank] = m;
        this.pos += m[0].length;
        if (blank !== undefined) {
          // `a_`, `a_Symbol`, `_`, `_Head` — plus optional trailing `.`
          let optional = false;
          if (s[this.pos] === '.' && !/[0-9]/.test(s[this.pos + 1])) {
            optional = true;
            this.pos++;
          }
          this.tokens.push({
            kind: 'pattern',
            name: name ?? '',
            head: blank.length > 1 ? blank.slice(1) : undefined,
            optional,
            spaceBefore,
          });
        } else {
          this.tokens.push({ kind: 'symbol', value: name!, spaceBefore });
        }
        continue;
      }
      const multi = MULTI_PUNCT.find((op) => s.startsWith(op, this.pos));
      if (multi) {
        this.tokens.push({ kind: 'punct', value: multi, spaceBefore });
        this.pos += multi.length;
        continue;
      }
      if ("[](){},^*/+-!=<>;'".includes(c)) {
        this.tokens.push({ kind: 'punct', value: c, spaceBefore });
        this.pos++;
        continue;
      }
      throw new Error(`unexpected character '${c}' at ${this.pos}`);
    }
  }
}

// WL precedence (subset), loosest to tightest:
// CompoundExpression 1 < Set/SetDelayed 2 < Rule 3 < Condition 4 <
// Or 6 < And 7 < Not (prefix) 8 < comparisons 9 < Plus 10 <
// Times 20 (and unary minus 15, looser than Power) < Power 30 (right-assoc)
// < Factorial 40.
const PREC_PLUS = 10;
const PREC_TIMES = 20;
const PREC_UNARY_MINUS = 15;
const PREC_POWER = 30;
const PREC_FACTORIAL = 40;
const PREC_NOT = 8;

// Binary operators handled uniformly: token → [operator, precedence,
// right-assoc?, flatten?]
const BINARY_OPS: Record<
  string,
  { op: string; prec: number; right?: boolean; flat?: boolean }
> = {
  ';': { op: 'CompoundExpression', prec: 1, flat: true },
  ':=': { op: 'SetDelayed', prec: 2, right: true },
  '=': { op: 'Set', prec: 2, right: true },
  '->': { op: 'Rule', prec: 3, right: true },
  '/;': { op: 'Condition', prec: 4 },
  '||': { op: 'Or', prec: 6, flat: true },
  '&&': { op: 'And', prec: 7, flat: true },
  '==': { op: 'Equal', prec: 9 },
  '!=': { op: 'Unequal', prec: 9 },
  '===': { op: 'SameQ', prec: 9 },
  '=!=': { op: 'UnsameQ', prec: 9 },
  '<': { op: 'Less', prec: 9 },
  '<=': { op: 'LessEqual', prec: 9 },
  '>': { op: 'Greater', prec: 9 },
  '>=': { op: 'GreaterEqual', prec: 9 },
};

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
        const bin = BINARY_OPS[t.value];
        if (bin && bin.prec >= minPrec) {
          this.next();
          const rhs = this.parseExpression(bin.right ? bin.prec : bin.prec + 1);
          lhs = bin.flat ? flatBinaryOp(bin.op, lhs, rhs) : [bin.op, lhs, rhs];
          continue;
        }
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
          t.kind === 'pattern' ||
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
    if (t.kind === 'pattern') {
      // `a_` → ["Blank","a"], `x_Symbol` → ["Blank","x","Symbol"],
      // `b_.` → ["BlankOptional","b"], `_` → ["Blank",""]
      const node: Json[] = [
        t.optional ? 'BlankOptional' : 'Blank',
        mapSymbol(t.name),
      ];
      if (t.head) node.push(t.head);
      return this.parsePostfix(node);
    }
    if (t.kind === 'punct') {
      if (t.value === '-') {
        const arg = this.parseExpression(PREC_UNARY_MINUS + 1);
        return negate(arg);
      }
      if (t.value === '+') return this.parseExpression(PREC_UNARY_MINUS + 1);
      if (t.value === '!') return ['Not', this.parseExpression(PREC_NOT + 1)];
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
    if (t.kind === 'string') return ['Str', t.value];
    // symbol — possibly a function call F[...]
    return this.parsePostfix(mapSymbol(t.value), t.value);
  }

  // Handles postfix forms after a head: calls F[a, b][c]…, Part
  // `lst[[1]]`, and derivative marks `F'[x]`.
  private parsePostfix(expr: Json, wlHead?: string): Json {
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'punct') break;
      if (t.value === "'") {
        // F' → Derivative[1][F]; chain for F''
        let order = 0;
        while (this.peek()?.kind === 'punct' && this.peek()!.value === "'") {
          this.next();
          order++;
        }
        expr = [['Derivative', order], wlHead ? mapSymbol(wlHead) : expr];
        wlHead = undefined;
        continue;
      }
      if (t.value !== '[' || t.spaceBefore) break;
      this.next();
      // Part: lst[[i, j]]
      if (this.peek()?.kind === 'punct' && this.peek()!.value === '[') {
        this.next();
        const indices: Json[] = [this.parseExpression(0)];
        while (this.peek()?.kind === 'punct' && this.peek()!.value === ',') {
          this.next();
          indices.push(this.parseExpression(0));
        }
        this.expect(']');
        this.expect(']');
        expr = ['Part', wlHead ? mapSymbol(wlHead) : expr, ...indices];
        wlHead = undefined;
        continue;
      }
      const args: Json[] = [];
      if (!(this.peek()?.kind === 'punct' && this.peek()!.value === ']')) {
        args.push(this.parseExpression(0));
        while (this.peek()?.kind === 'punct' && this.peek()!.value === ',') {
          this.next();
          args.push(this.parseExpression(0));
        }
      }
      this.expect(']');
      expr = wlHead ? mapCall(wlHead, args) : ([expr, ...args] as Json[]);
      wlHead = undefined;
    }
    return expr;
  }
}

function flatBinaryOp(op: string, a: Json, b: Json): Json {
  const ops: Json[] = [];
  for (const x of [a, b]) {
    if (Array.isArray(x) && x[0] === op) ops.push(...(x as Json[]).slice(1));
    else ops.push(x);
  }
  return [op, ...ops];
}

function flatBinary(op: 'Add' | 'Multiply', a: Json, b: Json): Json {
  return flatBinaryOp(op, a, b);
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
  // Compute Engine canonical names for the inverse hyperbolic functions
  // drop the 'c' (Arsinh, not Arcsinh) — the Arc* spellings are undefined
  // symbols in the engine and silently fail to evaluate numerically.
  ArcSinh: 'Arsinh',
  ArcCosh: 'Arcosh',
  ArcTanh: 'Artanh',
  ArcCoth: 'Arcoth',
  ArcSech: 'Arsech',
  ArcCsch: 'Arcsch',
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
