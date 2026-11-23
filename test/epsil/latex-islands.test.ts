import { operand } from '../../src/math-json/utils';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { ComputeEngine } from '../../src/compute-engine';
import { ComputeEngine as ComputeEngineImpl } from '../../src/compute-engine/index';
import { MathJsonExpression } from '../../src/math-json/types';
import { islandParser } from '../../src/epsil/latex-islands';
import {
  checkEpsil,
  epsilCompletions,
  epsilDebugStatements,
  epsilHover,
  epsilSignatureHelp,
  executeEpsil,
  executeEpsilAsync,
} from '../../src/epsil';

//
// `$…$` LaTeX islands (Phase 2, Stage C). A `LATEX_ISLAND` token is a primary.
// Its inner LaTeX is parsed by an INJECTED parser (`options.parseLatex`), a
// structural mirror of the engine's `ILatexSyntax` injection — `src/epsil`
// never statically imports `latex-syntax`. The returned MathJSON is spliced in
// raw with its `sourceOffsets` set to the island's Epsil-source range. Absent
// the injection, an island is a `latex-parsing-unavailable` diagnostic.
//

// Recursively drop `sourceOffsets` so structural comparisons are clean.
function bare(e: any): any {
  if (e === null || typeof e !== 'object') return e;
  if (Array.isArray(e)) return e.map(bare);
  if ('fn' in e) return (e.fn as any[]).map(bare);
  if ('num' in e) return Number(e.num);
  if ('sym' in e) return e.sym;
  if ('str' in e) return { str: e.str };
  return e;
}

describe('EPSIL LATEX ISLANDS (stub parser)', () => {
  const stub = {
    parseLatex: (s: string): MathJsonExpression => ['LatexStub', s] as any,
  };

  test('an island is spliced in as a primary', () => {
    const [value] = parseEpsil('$\\frac{1}{2}$', undefined, stub);
    expect(bare(operand(value, 1)!)).toStrictEqual(['LatexStub', '\\frac{1}{2}']);
  });

  test('the spliced node carries the island Epsil-source range', () => {
    const source = '$x+1$';
    const [value] = parseEpsil(source, undefined, stub);
    // The whole `$…$` span, including the delimiters.
    expect((operand(value, 1) as any).sourceOffsets).toStrictEqual([0, source.length]);
  });

  test('an island composes inside a larger expression', () => {
    const [value] = parseEpsil('2 * $\\pi$', undefined, stub);
    expect(bare(operand(value, 1)!)).toStrictEqual([
      'Multiply',
      2,
      ['LatexStub', '\\pi'],
    ]);
  });

  test('no diagnostics for a well-formed island', () => {
    const [, diags] = parseEpsil('$a$', undefined, stub);
    expect(diags).toHaveLength(0);
  });

  test('an unterminated island surfaces the lexer diagnostic', () => {
    const [, diags] = parseEpsil('$a+1', undefined, stub);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message[0]).toBe(
      'string-literal-closing-delimiter-expected'
    );
  });
});

describe('EPSIL LATEX ISLANDS (no injection)', () => {
  test('an island without an injected parser is a diagnostic', () => {
    const [, diags] = parseEpsil('$\\frac{1}{2}$');
    expect(diags).toHaveLength(1);
    expect(diags[0].message[0]).toBe('latex-parsing-unavailable');
  });
});

describe('EPSIL LATEX ISLANDS (real engine)', () => {
  test('wires the real engine as the injected LaTeX parser', () => {
    const ce = new ComputeEngine();
    const parseLatex = (s: string): MathJsonExpression =>
      ce.parse(s, { canonical: false }).json as MathJsonExpression;

    const [value, diags] = parseEpsil('2 * $\\frac{1}{2}$', undefined, {
      parseLatex,
    });
    expect(diags).toHaveLength(0);
    expect(bare(operand(value, 1)!)).toStrictEqual(['Multiply', 2, ['Divide', 1, 2]]);
  });
});

describe('EPSIL LATEX ISLANDS (the LaTeX syntax of the engine)', () => {
  const source = 'const b = $\\sqrt5$\nconst c = $\\frac{1}{2}$ + 1\nb^2 + c';

  test('checkEpsil and executeEpsil read an island with ce.latexSyntax', () => {
    const ce = new ComputeEngine();
    expect(checkEpsil(ce, source).diagnostics).toEqual([]);
    const result = executeEpsil(ce, source);
    expect(result.diagnostics).toEqual([]);
    expect(result.value.toString()).toBe('13/2');
  });

  test('executeEpsilAsync reads an island with ce.latexSyntax', async () => {
    const ce = new ComputeEngine();
    const result = await executeEpsilAsync(ce, source);
    expect(result.diagnostics).toEqual([]);
    expect(result.value.toString()).toBe('13/2');
  });

  test('the island uses the engine-wide LaTeX options', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { ...ce.latexOptions, decimalSeparator: '{,}' };
    const result = executeEpsil(ce, '$1{,}5$ * 2');
    expect(result.diagnostics).toEqual([]);
    expect(result.value.toString()).toBe('3');
  });

  test('the island knows the functions of the engine', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    // `ce.latexSyntax.parse('f(x)')` alone gives a product of `f` and `(x)`.
    expect(islandParser(ce, undefined)!('f(x)')).toEqual(['f', 'x']);
    // The raw parse declares nothing on the engine.
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  test('an island cannot replace a library function', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(ce, '$\\sin(x) \\coloneq 5$\n$\\sin(0)$');
    expect(result.value.toString()).toBe('0');
    expect(ce.box(['Sin', 0]).evaluate().toString()).toBe('0');
  });

  test('an injected parseLatex wins over the engine', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(ce, '$x$ + 1', { parseLatex: () => 41 });
    expect(result.value.toString()).toBe('42');
  });

  test('the editor functions read an island with the engine or with parseLatex', () => {
    const real = new ComputeEngine().latexSyntax!;
    const seen: string[] = [];
    const syntax = {
      parse: (latex: string, options?: any) => {
        seen.push(latex);
        return real.parse(latex, options);
      },
      serialize: (expr: MathJsonExpression) => real.serialize(expr),
    };
    const ce = new ComputeEngine({ latexSyntax: syntax });
    const text = 'let a = $\\sqrt{2}$\nmax(a, ';
    epsilDebugStatements(ce, text);
    epsilCompletions(ce, text, text.length);
    epsilSignatureHelp(ce, text, text.length);
    epsilHover(ce, text, 4);
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(seen.every((latex) => latex === '\\sqrt{2}')).toBe(true);

    seen.length = 0;
    const injected: string[] = [];
    const parseLatex = (latex: string): MathJsonExpression => {
      injected.push(latex);
      return 2;
    };
    epsilDebugStatements(ce, text, { parseLatex });
    epsilCompletions(ce, text, text.length, { parseLatex });
    epsilSignatureHelp(ce, text, text.length, { parseLatex });
    epsilHover(ce, text, 4, { parseLatex });
    expect(seen).toEqual([]);
    expect(injected.length).toBeGreaterThanOrEqual(4);
  });

  test('an engine with no LaTeX syntax gives latex-parsing-unavailable', () => {
    const factory = ComputeEngineImpl._latexSyntaxFactory;
    ComputeEngineImpl._latexSyntaxFactory = null;
    try {
      const ce = new ComputeEngine();
      expect(ce.latexSyntax).toBeUndefined();
      const codes = checkEpsil(ce, source).diagnostics.map((d) => d.message[0]);
      expect(codes).toEqual([
        'latex-parsing-unavailable',
        'latex-parsing-unavailable',
      ]);
    } finally {
      ComputeEngineImpl._latexSyntaxFactory = factory;
    }
  });
});
