import { ComputeEngine } from '../../src/compute-engine';
import type { ParseDiagnostic } from '../../src/compute-engine';

/**
 * Opt-in parse diagnostics: `ce.parse(latex, { diagnostics: true })` attaches a
 * `parseDiagnostics` array to the top-level result flagging charitable parse
 * decisions (undeclared symbols, application-like juxtaposition read as
 * multiply, discarded `%` comments, trailing noise dropped by recovery).
 *
 * These are additive metadata — enabling the flag never changes parse output.
 *
 * Note (ratified acceptable noise): every occurrence of an undeclared symbol
 * fires `undeclared-symbol`, including plain variables like `x` in `x + 1`.
 * Consumers pre-declare their legitimate symbols before parsing. Tests use a
 * fresh engine per `describe` so symbol type-inference from one test never
 * pollutes another.
 */

function diags(
  latex: string,
  opts: Record<string, unknown> = {}
): ReadonlyArray<ParseDiagnostic> {
  const ce = new ComputeEngine();
  const e = ce.parse(latex, { diagnostics: true, ...opts });
  return e.parseDiagnostics ?? [];
}

function byCode(
  ds: ReadonlyArray<ParseDiagnostic>,
  code: string
): ParseDiagnostic[] {
  return ds.filter((d) => d.code === code);
}

describe('motivation-table rows', () => {
  test('x(3) — undeclared symbol + juxtaposition-as-multiply', () => {
    const ds = diags('x(3)');
    const undeclared = byCode(ds, 'undeclared-symbol');
    expect(undeclared.some((d) => d.detail?.name === 'x')).toBe(true);

    const jux = byCode(ds, 'juxtaposition-as-multiply');
    expect(jux).toHaveLength(1);
    expect(jux[0].detail).toMatchObject({ name: 'x', declaredAs: 'unknown' });
  });

  test('\\mathrm{Frobnicate}(x) — undeclared symbol + juxtaposition', () => {
    const ds = diags('\\mathrm{Frobnicate}(x)');
    const undeclared = byCode(ds, 'undeclared-symbol');
    // Both the head `Frobnicate` and the argument `x` are undeclared.
    expect(undeclared.some((d) => d.detail?.name === 'Frobnicate')).toBe(true);
    expect(undeclared.some((d) => d.detail?.name === 'x')).toBe(true);

    const jux = byCode(ds, 'juxtaposition-as-multiply');
    expect(jux).toHaveLength(1);
    expect(jux[0].detail).toMatchObject({
      name: 'Frobnicate',
      declaredAs: 'unknown',
    });
  });

  test('multi-token symbol span covers the whole \\mathrm{…} construct', () => {
    const latex = '\\mathrm{Frobnicate}';
    const ds = diags(latex);
    const d = byCode(ds, 'undeclared-symbol').find(
      (x) => x.detail?.name === 'Frobnicate'
    )!;
    expect(d).toBeDefined();
    // The span is more than a single token wide.
    expect(d.end - d.start).toBeGreaterThan(1);
  });

  test('\\mathrm{Eigenvalues}\\begin{pmatrix}…\\end{pmatrix} — declaredAs:function', () => {
    const ds = diags(
      '\\mathrm{Eigenvalues}\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}'
    );
    const jux = byCode(ds, 'juxtaposition-as-multiply');
    expect(jux).toHaveLength(1);
    expect(jux[0].detail).toMatchObject({
      name: 'Eigenvalues',
      declaredAs: 'function',
    });
    // Eigenvalues is a registered function → NOT undeclared.
    expect(byCode(ds, 'undeclared-symbol')).toHaveLength(0);
  });

  test('2 + 2 % + 100 — comment-discarded with correct length and original-input span', () => {
    const latex = '2 + 2 % + 100';
    const ds = diags(latex);
    const comment = byCode(ds, 'comment-discarded');
    expect(comment).toHaveLength(1);
    const c = comment[0];
    expect(c.detail?.discardedLength).toBe(7);
    // Span is in ORIGINAL-INPUT coordinates: slicing reproduces the discarded
    // text (`%` through end of line).
    expect(latex.slice(c.start, c.end)).toBe('% + 100');
  });
});

describe('additive: no output change, absent when flag omitted', () => {
  const rows = [
    'x(3)',
    '\\mathrm{Frobnicate}(x)',
    '\\mathrm{Eigenvalues}\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}',
    '2 + 2 % + 100',
  ];

  test('parseDiagnostics is undefined when the flag is omitted', () => {
    const ce = new ComputeEngine();
    for (const row of rows)
      expect(ce.parse(row).parseDiagnostics).toBeUndefined();
  });

  test('parse output (JSON) is identical with and without the flag', () => {
    const ce = new ComputeEngine();
    for (const row of rows) {
      const withOff = JSON.stringify(ce.parse(row).json);
      const withOn = JSON.stringify(ce.parse(row, { diagnostics: true }).json);
      expect(withOn).toBe(withOff);
    }
  });

  test('flag on with a clean input yields a present-but-empty array', () => {
    // `\pi` is declared; `2\pi` is `2·Pi` but neither symbol is undeclared and
    // the shape (number followed by symbol) is not application-like.
    const ce = new ComputeEngine();
    expect(ce.parse('\\pi', { diagnostics: true }).parseDiagnostics).toEqual(
      []
    );
    expect(ce.parse('2\\pi', { diagnostics: true }).parseDiagnostics).toEqual(
      []
    );
  });
});

describe('interned-instance non-pollution', () => {
  test('a diagnostics parse of a value that folds to an interned number does not leak', () => {
    const ce = new ComputeEngine();
    // `2 + 2 % + 100` canonicalizes to the number 4, which the engine may
    // intern/share. The diagnostic must attach to a fresh instance.
    const p = ce.parse('2 + 2 % + 100', { diagnostics: true });
    expect(p.parseDiagnostics?.length).toBeGreaterThan(0);

    // A subsequent parse / number construction of the same value must NOT see
    // the diagnostics.
    expect(ce.parse('4').parseDiagnostics).toBeUndefined();
    expect(ce.number(4).parseDiagnostics).toBeUndefined();
  });

  test('a diagnostics parse of a bare interned integer does not leak', () => {
    const ce = new ComputeEngine();
    const p = ce.parse('4 % tail', { diagnostics: true });
    expect(byCode(p.parseDiagnostics ?? [], 'comment-discarded')).toHaveLength(
      1
    );
    expect(ce.number(4).parseDiagnostics).toBeUndefined();
    expect(ce.parse('4').parseDiagnostics).toBeUndefined();
  });

  test('a diagnostics parse of a constant symbol does not leak onto the shared constant', () => {
    const ce = new ComputeEngine();
    const p = ce.parse('\\pi % tail', { diagnostics: true });
    expect(byCode(p.parseDiagnostics ?? [], 'comment-discarded')).toHaveLength(
      1
    );
    expect(ce.parse('\\pi').parseDiagnostics).toBeUndefined();
    expect(ce.symbol('Pi').parseDiagnostics).toBeUndefined();
  });
});

describe('canonical:false still emits parse-time diagnostics', () => {
  test('codes 1 & 2 fire under { canonical: false }', () => {
    const ds = diags('x(3)', { canonical: false });
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'x')
    ).toBe(true);
    expect(byCode(ds, 'juxtaposition-as-multiply')).toHaveLength(1);
  });
});

describe('comment escaping', () => {
  test('escaped \\% does not fire comment-discarded', () => {
    const ds = diags('50\\% + x');
    expect(byCode(ds, 'comment-discarded')).toHaveLength(0);
  });
});

describe('recovered (trailing noise)', () => {
  test('trailing sentence punctuation dropped by recovery fires `recovered`', () => {
    const ds = diags('x^2.');
    const rec = byCode(ds, 'recovered');
    expect(rec).toHaveLength(1);
    expect(rec[0].detail?.skipped).toBe('.');
  });

  test('recovered span reproduces the exact (untrimmed) skipped tail (D2)', () => {
    const latex = 'x^2.  ';
    const rec = byCode(diags(latex), 'recovered');
    expect(rec).toHaveLength(1);
    // `latex.slice(start, end)` must equal `detail.skipped`, including trailing
    // whitespace.
    expect(latex.slice(rec[0].start, rec[0].end)).toBe(rec[0].detail?.skipped);
    expect(rec[0].detail?.skipped).toBe('.  ');
  });
});

describe('bound variables do not fire undeclared-symbol (A1)', () => {
  const undeclaredNames = (latex: string): string[] =>
    byCode(diags(latex), 'undeclared-symbol').map(
      (d) => d.detail?.name as string
    );

  test('sum index is bound; only the free bound `n` fires', () => {
    // `i` is the imaginary unit (declared); use `j` to exercise a genuinely
    // free-looking index that must nonetheless be recognized as bound.
    expect(undeclaredNames('\\sum_{j=1}^{n} j')).toEqual(['n']);
  });

  test('product index is fully bound (no fire)', () => {
    // Both the subscript `k=1` reference and the body `k` are bound: two
    // genuine reference sites, both pruned (not a speculative duplicate).
    expect(undeclaredNames('\\prod_{k=1}^{5} k')).toEqual([]);
  });

  test('integral differential (dummy) variable is bound; bounds stay free', () => {
    expect(undeclaredNames('\\int_0^1 x^2 \\, dx')).toEqual([]);
    // `a`, `b` are free bounds and must still fire; `x` (the dummy) must not.
    expect(undeclaredNames('\\int_a^b x \\, dx').sort()).toEqual(['a', 'b']);
  });

  test('mapsto parameter is bound in both operands', () => {
    expect(undeclaredNames('x \\mapsto x^2')).toEqual([]);
    expect(undeclaredNames('(x, y) \\mapsto x + y')).toEqual([]);
  });

  test('quantified variable is bound', () => {
    expect(undeclaredNames('\\forall x, x^2 \\geq 0')).toEqual([]);
  });

  test('limit variable is bound', () => {
    expect(undeclaredNames('\\lim_{x \\to 0} x')).toEqual([]);
  });

  test('a free variable sharing the construct still fires (not over-pruned)', () => {
    // `n` is free in the sum; the pruning is by bound-name, so `n` survives.
    expect(undeclaredNames('\\sum_{j=1}^{n} j')).toContain('n');
  });
});

describe('declaration presence, not type knowledge (A2)', () => {
  test('a symbol declared with unknown type does not fire undeclared-symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'unknown');
    const e = ce.parse('y + 1', { diagnostics: true });
    expect(byCode(e.parseDiagnostics ?? [], 'undeclared-symbol')).toHaveLength(
      0
    );
  });

  test('a declared unknown-type symbol reports declaredAs:value, not unknown', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'unknown');
    const jux = byCode(
      ce.parse('g(3)', { diagnostics: true }).parseDiagnostics ?? [],
      'juxtaposition-as-multiply'
    );
    expect(jux).toHaveLength(1);
    expect(jux[0].detail).toMatchObject({ name: 'g', declaredAs: 'value' });
  });
});

describe('bare-run symbol paths still emit (A3)', () => {
  test('a leftover letter in a segmented run fires (strict:false)', () => {
    // `xpi` → `x·π`; `x` is a leftover letter that must still be flagged.
    const ds = diags('xpi', { strict: false });
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'x')
    ).toBe(true);
  });

  test('the argument of a bare function name fires', () => {
    // `sin(x)` (no backslash): whichever way it parses, the undeclared `x`
    // surfaces through the shared emission helper.
    const ds = diags('sin(x)');
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'x')
    ).toBe(true);
  });
});

describe('collector lifecycle (B1, B2, B3)', () => {
  test('engine-wide ce.latexOptions.diagnostics is honored (B1)', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { diagnostics: true } as any;
    const e = ce.parse('x(3)');
    expect(e.parseDiagnostics).toBeDefined();
    expect(
      byCode(e.parseDiagnostics ?? [], 'juxtaposition-as-multiply')
    ).toHaveLength(1);
  });

  test('an explicit per-call diagnostics:false overrides engine-wide true (B1)', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { diagnostics: true } as any;
    expect(
      ce.parse('x(3)', { diagnostics: false } as any).parseDiagnostics
    ).toBeUndefined();
  });

  test('identical-span diagnostics are not duplicated (B2)', () => {
    // A single reference site must yield a single diagnostic even through
    // speculative enclosure reparsing.
    const ds = diags('|x|');
    const xs = byCode(ds, 'undeclared-symbol').filter(
      (d) => d.detail?.name === 'x'
    );
    expect(xs).toHaveLength(1);
  });

  test('diagnostics and their detail are deeply frozen (B3)', () => {
    const ds = diags('x(3)');
    expect(ds.length).toBeGreaterThan(0);
    expect(Object.isFrozen(ds)).toBe(true);
    for (const d of ds) {
      expect(Object.isFrozen(d)).toBe(true);
      if (d.detail) expect(Object.isFrozen(d.detail)).toBe(true);
    }
  });
});

describe('comment span in CRLF input (C1)', () => {
  test('a comment after a CRLF newline keeps original-input coordinates', () => {
    const latex = '1 + 2 % first\r\n3 + 4 % second';
    const comments = byCode(diags(latex), 'comment-discarded');
    expect(comments).toHaveLength(2);
    // Without CRLF accounting, the second span would drift one char left.
    for (const c of comments)
      expect(latex.slice(c.start, c.end)).toBe(
        c.detail?.discardedLength === 7 ? '% first' : '% second'
      );
    const second = comments.find((c) => c.detail?.discardedLength === 8)!;
    expect(latex.slice(second.start, second.end)).toBe('% second');
  });
});

describe('structural auto-prune on backtrack (follow-up item 1)', () => {
  const undeclaredNames = (latex: string): string[] =>
    byCode(diags(latex), 'undeclared-symbol').map(
      (d) => d.detail?.name as string
    );

  test('a speculative standalone-symbol quantifier parse that backtracks does not duplicate', () => {
    // `\forall n \ge 1` first tries `n` as a standalone quantified symbol,
    // fails (no separator), rewinds (`parser.index = index`) and re-parses as a
    // condition. The rewind auto-prunes the speculative `n`; the reparse
    // re-emits it exactly once. (This path no longer has an explicit rollback.)
    expect(undeclaredNames('\\forall n \\ge 1')).toEqual(['n']);
  });

  test('nested enclosures emit each free symbol exactly once', () => {
    // The outer `(` speculatively parses the body; a rejected matchfix def
    // rewinds to `start`, auto-pruning that branch. Adopted parse emits once.
    expect(undeclaredNames('((x+y))')).toEqual(['x', 'y']);
  });

  test('reversed-interval speculation does not leave stray diagnostics', () => {
    expect(undeclaredNames(']a, b[')).toEqual(['a', 'b']);
  });

  test('rollbackDiagnostics/pruneUndeclared clamp when a checkpoint exceeds the (auto-pruned) length', () => {
    // A binder captures a checkpoint, then an inner backtrack auto-prunes below
    // it; the later pruneUndeclared must not extend the array with holes. If
    // clamping were wrong, `parseDiagnostics` would contain `undefined` holes.
    const ds = diags('\\sum_{j=1}^{(n)} j');
    expect(ds.every((d) => d !== undefined && typeof d.code === 'string')).toBe(
      true
    );
    // `j` is bound; `n` is free.
    expect(byCode(ds, 'undeclared-symbol').map((d) => d.detail?.name)).toEqual([
      'n',
    ]);
  });
});

describe('code-2 coverage: unit-lexed and letter-run applications (Tycho 0.78.0)', () => {
  const jux = (
    latex: string,
    opts: Record<string, unknown> = {}
  ): ParseDiagnostic[] =>
    byCode(diags(latex, opts), 'juxtaposition-as-multiply');

  test('a unit-lexed symbol applied fires code 2 with lexedAs:"unit" (undeclared)', () => {
    // `\mathrm{T}` is lexed as the tesla unit; `T` is undeclared here.
    const js = jux('\\mathrm{T}(2)');
    expect(js).toHaveLength(1);
    expect(js[0].detail).toMatchObject({
      name: 'T',
      declaredAs: 'unknown',
      lexedAs: 'unit',
    });
  });

  test('a unit-lexed symbol declared as a value reports declaredAs:"value"', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    const js = byCode(
      ce.parse('\\mathrm{N}(2)', { diagnostics: true }).parseDiagnostics ?? [],
      'juxtaposition-as-multiply'
    );
    expect(js).toHaveLength(1);
    expect(js[0].detail).toMatchObject({
      name: 'N',
      declaredAs: 'value',
      lexedAs: 'unit',
    });
  });

  test('an applied letter-run fires ONE code 2 for the joined name', () => {
    const latex = 'divisors(60)';
    const js = jux(latex);
    expect(js).toHaveLength(1);
    expect(js[0].detail).toMatchObject({
      name: 'divisors',
      declaredAs: 'unknown',
    });
    // No `lexedAs` for a plain letter run.
    expect(js[0].detail).not.toHaveProperty('lexedAs');
    // Span covers the run start through the delimiter end.
    expect(latex.slice(js[0].start, js[0].end)).toBe('divisors(60)');
  });

  test('the letter-run stops at a leading number (2x(3) → x)', () => {
    const latex = '2x(3)';
    const js = jux(latex);
    expect(js).toHaveLength(1);
    expect(js[0].detail).toMatchObject({ name: 'x', declaredAs: 'unknown' });
    expect(latex.slice(js[0].start, js[0].end)).toBe('x(3)');
  });

  test('the letter-run stops at a multi-char command (\\pi r(2) → r, not πr)', () => {
    const js = jux('\\pi r(2)');
    expect(js).toHaveLength(1);
    expect(js[0].detail).toMatchObject({ name: 'r', declaredAs: 'unknown' });
  });

  test('existing rows unchanged: x(3), Frobnicate, Eigenvalues+pmatrix', () => {
    expect(jux('x(3)')[0].detail).toMatchObject({
      name: 'x',
      declaredAs: 'unknown',
    });
    expect(jux('\\mathrm{Frobnicate}(x)')[0].detail).toMatchObject({
      name: 'Frobnicate',
      declaredAs: 'unknown',
    });
    const eig = jux(
      '\\mathrm{Eigenvalues}\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}'
    );
    expect(eig).toHaveLength(1);
    expect(eig[0].detail).toMatchObject({
      name: 'Eigenvalues',
      declaredAs: 'function',
    });
    // None of these carry a `lexedAs` hint.
    expect(jux('x(3)')[0].detail).not.toHaveProperty('lexedAs');
  });
});

describe('span-aware bound-variable pruning (review A-3)', () => {
  const undeclaredNames = (latex: string): string[] =>
    byCode(diags(latex), 'undeclared-symbol').map(
      (d) => d.detail?.name as string
    );

  test('a same-named integral limit stays free while the body dummy is pruned', () => {
    // Lower bound `x` is outside the binder scope and must FIRE; the integrand
    // and differential `x` are bound and must not.
    expect(undeclaredNames('\\int_x^1 x \\, dx')).toEqual(['x']);
  });

  test('sum index declaration + body pruned; both bounds fire', () => {
    expect(undeclaredNames('\\sum_{i=k}^{n} i').sort()).toEqual(['k', 'n']);
  });

  test('limit variable pruned in the clause and body; the target fires', () => {
    expect(undeclaredNames('\\lim_{x \\to y} x')).toEqual(['y']);
  });

  test('distinct-named bounds still fire (no regression)', () => {
    expect(undeclaredNames('\\int_a^b x \\, dx').sort()).toEqual(['a', 'b']);
    expect(undeclaredNames('\\sum_{i=1}^{n} i')).toEqual(['n']);
  });
});

describe('remaining emission-bypass paths (review B-4, B-5)', () => {
  test('an undeclared predicate/function head fires (B-4a)', () => {
    // The head `P` of `P(x)` in a quantifier context goes through the raw
    // parseSymbol; it must still report undeclared. `x` is bound → pruned.
    const names = byCode(diags('\\forall x, P(x)'), 'undeclared-symbol').map(
      (d) => d.detail?.name
    );
    expect(names).toContain('P');
    expect(names).not.toContain('x');
  });

  test('a spelled-out bare symbol fires under strict:false (B-4b)', () => {
    const names = byCode(
      diags('alpha + 1', { strict: false }),
      'undeclared-symbol'
    ).map((d) => d.detail?.name);
    expect(names).toContain('alpha');
  });

  test('a trailing bare backslash is reported as recovered (B-5)', () => {
    const latex = 'x\\';
    const rec = byCode(diags(latex), 'recovered');
    expect(rec).toHaveLength(1);
    expect(rec[0].detail?.skipped).toBe('\\');
  });
});

describe('keyword probes do not contribute diagnostics (follow-up item 3)', () => {
  test('if/then/else keywords do not fire undeclared-symbol; branch symbols still do', () => {
    const ds = diags(
      '\\operatorname{if} a \\operatorname{then} b \\operatorname{else} c'
    );
    const names = byCode(ds, 'undeclared-symbol').map(
      (d) => d.detail?.name as string
    );
    // The genuinely undeclared branch symbols must still be flagged...
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toContain('c');
    // ...but the control-flow keywords (matched via speculative parseSymbol in
    // `matchKeyword`) must NOT leak as undeclared symbols.
    expect(names).not.toContain('if');
    expect(names).not.toContain('then');
    expect(names).not.toContain('else');
  });
});

describe('bound-variable post-filter + assert (follow-up item 2)', () => {
  test('a function definition binds its parameters (:= form)', () => {
    // `f(x) := x^2` — `x` is a bound parameter, pruned at parse time.
    const ce = new ComputeEngine();
    const e = ce.parse('f(x) := x^2', { diagnostics: true });
    const undeclared = byCode(
      e.parseDiagnostics ?? [],
      'undeclared-symbol'
    ).map((d) => d.detail?.name);
    expect(undeclared).not.toContain('x');
  });

  test('the post-check is DETECT-ONLY: a bound-only source reference is retained, and console.assert still fires', () => {
    // `x, y \in \mathbb{R}_{>0}`: the restricted-set-builder canonicalizes to a
    // set-builder that reuses the name `y`, so `y` appears only bound in the
    // canonical result even though it is a genuinely-free *source* reference.
    // The post-check must NOT drop it (dropping would hide exactly what the
    // consumer needs — C-1) but must still `console.assert` to flag the case.
    const realAssert = console.assert;
    const asserts: string[] = [];
    console.assert = ((cond: unknown, ...args: unknown[]): void => {
      if (!cond) asserts.push(String(args[0] ?? ''));
    }) as typeof console.assert;
    let e;
    try {
      const ce = new ComputeEngine();
      e = ce.parse('x, y \\in \\mathbb{R}_{>0}', { diagnostics: true });
    } finally {
      console.assert = realAssert;
    }
    const undeclared = byCode(
      e.parseDiagnostics ?? [],
      'undeclared-symbol'
    ).map((d) => d.detail?.name);
    expect(undeclared).toContain('x'); // free → kept
    expect(undeclared).toContain('y'); // bound-only → RETAINED (detect-only)
    expect(asserts.some((m) => m.includes('bound-only "y"'))).toBe(true);
  });

  test('wired binders never trip the post-filter assert', () => {
    const realAssert = console.assert;
    const asserts: string[] = [];
    console.assert = ((cond: unknown, ...args: unknown[]): void => {
      if (!cond) asserts.push(String(args[0] ?? ''));
    }) as typeof console.assert;
    try {
      for (const latex of [
        '\\sum_{j=1}^{n} j',
        '\\prod_{k=1}^{5} k',
        '\\int_a^b x \\, dx',
        'x \\mapsto x^2',
        '\\lim_{x \\to 0} x',
        'f(x) := x^2',
        // Same-named free limit: the deliberately-kept lower-bound `x` reads
        // bound-only in the canonical result (the name collides with the
        // dummy), but the binder registered it via `onBoundVariable`, so the
        // post-check must stay silent.
        '\\int_x^1 x \\, dx',
        '\\lim_{x \\to y} x',
      ]) {
        new ComputeEngine().parse(latex, { diagnostics: true });
      }
    } finally {
      console.assert = realAssert;
    }
    expect(asserts.filter((m) => m.includes('bound-only'))).toEqual([]);
  });

  test('the post-filter is skipped for non-canonical parses', () => {
    // Should not throw, and codes 1 & 2 still fire (canonical:false path).
    const ds = diags('x(3)', { canonical: false });
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'x')
    ).toBe(true);
  });
});

describe('declared symbols suppress diagnostics', () => {
  test('a declared constant does not fire undeclared-symbol', () => {
    // `\pi` resolves to the Pi constant.
    expect(byCode(diags('\\pi'), 'undeclared-symbol')).toHaveLength(0);
  });

  test('a symbol declared via ce.declare does not fire undeclared-symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'real');
    const e = ce.parse('w + 1', { diagnostics: true });
    expect(
      byCode(e.parseDiagnostics ?? [], 'undeclared-symbol').some(
        (d) => d.detail?.name === 'w'
      )
    ).toBe(false);
  });

  test('a declared function applied with parens does not fire juxtaposition', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    // `\left(...\right)` and plain `(...)` application forms both apply f
    // directly (no InvisibleOperator), so no juxtaposition diagnostic.
    for (const latex of ['f(x)', 'f\\left(x\\right)']) {
      const e = ce.parse(latex, { diagnostics: true });
      expect(
        byCode(e.parseDiagnostics ?? [], 'juxtaposition-as-multiply')
      ).toHaveLength(0);
    }
  });
});

describe('function-definition LHS is a declaration (E1)', () => {
  // The `f(x)` LHS of a definition is first parsed as a neutral juxtaposition,
  // then consumed as a signature. Neither the juxtaposition (code 2) nor the
  // undeclared head (code 1) is a real problem — the construct declares `f`.
  for (const latex of ['f(x) := x^2', 'f(x) \\coloneq x^2']) {
    test(`${latex} — no diagnostics for the head`, () => {
      const ds = diags(latex);
      expect(byCode(ds, 'juxtaposition-as-multiply')).toHaveLength(0);
      // Parameter `x` is bound; head `f` is a declaration — neither is
      // undeclared.
      expect(byCode(ds, 'undeclared-symbol')).toHaveLength(0);
    });
  }

  test('a genuinely-undeclared symbol USED in the body still fires', () => {
    // `y` is neither a parameter nor the head — a free reference in the body.
    const ds = diags('f(x) := x + y');
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'y')
    ).toBe(true);
  });

  test('a genuine application-shaped juxtaposition (no :=) still fires both codes', () => {
    // Regression guard: pruning is scoped to the definition route only.
    const ds = diags('a(x+1)');
    expect(
      byCode(ds, 'juxtaposition-as-multiply').some(
        (d) => d.detail?.name === 'a'
      )
    ).toBe(true);
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'a')
    ).toBe(true);
  });
});

describe('undeclared-symbol honors the getSymbolType hook (E2)', () => {
  test('a symbol the hook types as non-unknown is treated as declared', () => {
    // The parse-option `getSymbolType` replaces scope lookup for typing; a
    // symbol it types as `number` is declared, so no undeclared diagnostic —
    // and no self-contradiction (flagging undeclared while reporting a type).
    const ds = diags('k + 1', {
      getSymbolType: (id: string) => (id === 'k' ? 'number' : 'unknown'),
    });
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'k')
    ).toBe(false);
  });

  test('a symbol the hook types as unknown still fires', () => {
    const ds = diags('w + 1', {
      getSymbolType: (id: string) => (id === 'k' ? 'number' : 'unknown'),
    });
    expect(
      byCode(ds, 'undeclared-symbol').some((d) => d.detail?.name === 'w')
    ).toBe(true);
  });
});

describe('undeclared-symbol is per-engine order-dependent (E4, documented)', () => {
  // Documents (does not change) the warm-engine statefulness of code 1: the
  // first canonical parse of an undeclared name auto-declares it, so an
  // identical second parse on the SAME engine no longer flags it. A validation
  // gate should use a fresh engine (as `diags()` does).
  test('same engine: second identical parse no longer flags the name', () => {
    const ce = new ComputeEngine();
    const first = ce.parse('u + 1', { diagnostics: true });
    expect(
      byCode(first.parseDiagnostics ?? [], 'undeclared-symbol').some(
        (d) => d.detail?.name === 'u'
      )
    ).toBe(true);

    const second = ce.parse('u + 1', { diagnostics: true });
    expect(
      byCode(second.parseDiagnostics ?? [], 'undeclared-symbol').some(
        (d) => d.detail?.name === 'u'
      )
    ).toBe(false);
  });
});
