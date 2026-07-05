// Shared MathJSON → Wolfram Language translator.
//
// Every Wolfram runner in this suite drives the system `wolframscript` kernel
// from a Wolfram Language *string*. None of the benchmark cases carry a native
// Wolfram dialect — but they all carry structured **MathJSON** (the `ce` input).
// This module is the single MathJSON→WL mapping shared by:
//
//   runners/run_wolfram.mjs        the capability benchmark (one case / process)
//   runners/run_wolfram_batch.mjs  the audit family (all cases / one kernel)
//
// Keeping the translation in one place means a new MathJSON head only has to be
// taught once and every Wolfram column picks it up. Heads map almost 1:1 onto
// WL (`["Power","x",2]`→`x^2`, `["Sin","x"]`→`Sin[x]`, `["Ln",2]`→`Log[2]`).
//
// Note on `Log`: WL's `Log[z]` is the **natural** log. MathJSON `Ln` and the
// Wester-sourced single-argument `Log` (those cases originate in Mathematica,
// where `Log` is natural) both map to `Log[z]`. A two-argument `["Log", x, b]`
// (log base b) maps to WL `Log[b, x]`.

// Symbols / constants. Anything not listed maps to itself (e.g. `x`, `t`).
const SYM = {
  Pi: 'Pi',
  ExponentialE: 'E',
  ImaginaryUnit: 'I',
  EulerGamma: 'EulerGamma',
  GoldenRatio: 'GoldenRatio',
  CatalanConstant: 'Catalan',
  PositiveInfinity: 'Infinity',
  NegativeInfinity: '-Infinity',
  ComplexInfinity: 'ComplexInfinity',
};

// Heads taking a single bracketed argument: MathJSON name -> WL name.
const UNARY = {
  Sqrt: 'Sqrt',
  Abs: 'Abs',
  Exp: 'Exp',
  Sin: 'Sin', Cos: 'Cos', Tan: 'Tan', Cot: 'Cot', Sec: 'Sec', Csc: 'Csc',
  Sinh: 'Sinh', Cosh: 'Cosh', Tanh: 'Tanh', Coth: 'Coth', Sech: 'Sech', Csch: 'Csch',
  Arcsin: 'ArcSin', Arccos: 'ArcCos', Arctan: 'ArcTan',
  Arcsinh: 'ArcSinh', Arccosh: 'ArcCosh', Arctanh: 'ArcTanh',
  Zeta: 'Zeta', Gamma: 'Gamma', Factorial: 'Factorial',
  Erf: 'Erf', Erfc: 'Erfc',
  LambertW: 'ProductLog',   // single-branch Lambert W
  Digamma: 'PolyGamma',     // PolyGamma[z] == digamma
};

/**
 * Translate a MathJSON node into a Wolfram Language expression string.
 * Throws on an unknown head so a runner can fall back to `status: 'error'`
 * rather than emit a silently-wrong expression.
 */
export function mathJsonToWL(node) {
  if (typeof node === 'number') return String(node);
  if (typeof node === 'bigint') return String(node);
  if (typeof node === 'string') return SYM[node] ?? node;
  if (!Array.isArray(node)) throw new Error('bad MathJSON node: ' + JSON.stringify(node));

  const [head, ...args] = node;
  const a = args.map(mathJsonToWL);
  switch (head) {
    case 'Add': return '(' + a.join(' + ') + ')';
    case 'Subtract': return '(' + a[0] + ' - ' + a[1] + ')';
    case 'Multiply': return '(' + a.join('*') + ')';
    case 'Divide': return '((' + a[0] + ')/(' + a[1] + '))';
    case 'Negate': return '(-(' + a[0] + '))';
    case 'Power': return '((' + a[0] + ')^(' + a[1] + '))';
    case 'Rational': return '((' + a[0] + ')/(' + a[1] + '))';
    case 'Complex': return '((' + a[0] + ') + (' + a[1] + ')*I)';
    case 'Root': return '((' + a[0] + ')^(1/(' + a[1] + ')))';
    case 'Ln': return 'Log[' + a[0] + ']';
    case 'Log': return a.length === 2 ? 'Log[' + a[1] + ', ' + a[0] + ']' : 'Log[' + a[0] + ']';
    case 'Tuple': case 'List': return '{' + a.join(', ') + '}';
    // The capability `evaluate` cases pass whole Limit / Integrate nodes; the
    // audit family builds these in the runner and never reaches here.
    case 'Limit': return 'Limit[' + a[0] + ', x -> ' + a[1] + ']';
    case 'Integrate': return 'Integrate[' + a[0] + ', ' + a[1] + ']';
    default:
      if (UNARY[head]) return UNARY[head] + '[' + a[0] + ']';
      throw new Error('unknown MathJSON head: ' + head);
  }
}

export default mathJsonToWL;
