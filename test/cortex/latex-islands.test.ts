import { parseCortex } from '../../src/cortex/parse-cortex';
import { ComputeEngine } from '../../src/compute-engine';
import { MathJsonExpression } from '../../src/math-json/types';

//
// `$…$` LaTeX islands (Phase 2, Stage C). A `LATEX_ISLAND` token is a primary.
// Its inner LaTeX is parsed by an INJECTED parser (`options.parseLatex`), a
// structural mirror of the engine's `ILatexSyntax` injection — `src/cortex`
// never statically imports `latex-syntax`. The returned MathJSON is spliced in
// raw with its `sourceOffsets` set to the island's Cortex-source range. Absent
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

describe('CORTEX LATEX ISLANDS (stub parser)', () => {
  const stub = {
    parseLatex: (s: string): MathJsonExpression => ['LatexStub', s] as any,
  };

  test('an island is spliced in as a primary', () => {
    const [value] = parseCortex('$\\frac{1}{2}$', undefined, stub);
    expect(bare(value)).toStrictEqual(['LatexStub', '\\frac{1}{2}']);
  });

  test('the spliced node carries the island Cortex-source range', () => {
    const source = '$x+1$';
    const [value] = parseCortex(source, undefined, stub);
    // The whole `$…$` span, including the delimiters.
    expect((value as any).sourceOffsets).toStrictEqual([0, source.length]);
  });

  test('an island composes inside a larger expression', () => {
    const [value] = parseCortex('2 * $\\pi$', undefined, stub);
    expect(bare(value)).toStrictEqual([
      'Multiply',
      2,
      ['LatexStub', '\\pi'],
    ]);
  });

  test('no diagnostics for a well-formed island', () => {
    const [, diags] = parseCortex('$a$', undefined, stub);
    expect(diags).toHaveLength(0);
  });

  test('an unterminated island surfaces the lexer diagnostic', () => {
    const [, diags] = parseCortex('$a+1', undefined, stub);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message[0]).toBe(
      'string-literal-closing-delimiter-expected'
    );
  });
});

describe('CORTEX LATEX ISLANDS (no injection)', () => {
  test('an island without an injected parser is a diagnostic', () => {
    const [, diags] = parseCortex('$\\frac{1}{2}$');
    expect(diags).toHaveLength(1);
    expect(diags[0].message[0]).toBe('latex-parsing-unavailable');
  });
});

describe('CORTEX LATEX ISLANDS (real engine)', () => {
  test('wires the real engine as the injected LaTeX parser', () => {
    const ce = new ComputeEngine();
    const parseLatex = (s: string): MathJsonExpression =>
      ce.parse(s, { canonical: false }).json as MathJsonExpression;

    const [value, diags] = parseCortex('2 * $\\frac{1}{2}$', undefined, {
      parseLatex,
    });
    expect(diags).toHaveLength(0);
    expect(bare(value)).toStrictEqual(['Multiply', 2, ['Divide', 1, 2]]);
  });
});
