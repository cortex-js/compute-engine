import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';

//
// Epsil execution (Phase 4, Stage 2). `executeEpsil` parses a program and
// evaluates each top-level statement sequentially in the engine's current
// scope (a notebook cell-chain), symbolic-by-default (the exactness contract),
// with runtime problems flowing as `["Error", …]` *values* and parse problems
// as diagnostics. See `roadmap/epsil/phase-4-semantics.md`.
//

/** Run an Epsil program against a fresh engine, injecting the engine's own
 * LaTeX parser for `$…$` islands. */
function run(
  source: string,
  options?: { allowHostPragmas?: boolean }
): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex, ...options });
}

describe('EPSIL EXECUTE — programs', () => {
  test('a declaration, a reassignment, and the last-statement value', () => {
    // Declarations persist across statements (one shared scope, no push/pop
    // around the program), so the reassignment sees `x` and the final bare
    // `x` reads its updated value.
    const { value, diagnostics } = run('let x = 5\nx = x + 3\nx');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(8);
  });

  test('a const declaration is usable as a value', () => {
    const { value, diagnostics } = run('const c = 6.28\nc');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6.28);
  });

  test('a typed function definition then a call', () => {
    const { value, diagnostics } = run('f(x: real) = x + 1\nf(10)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(11);
  });

  test('a typed param rejects a bad-typed call', () => {
    // `2.5` is not an `integer`, so the call boxes to an `incompatible-type`
    // Error value rather than evaluating to `3.5`.
    const { value } = run('f(x: integer) = x + 1\nf(2.5)');
    expect(value.re).not.toBe(3.5);
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a typed param accepts a good-typed call', () => {
    const { value, diagnostics } = run('f(x: integer) = x + 1\nf(3)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a multi-param typed function rejects a bad arg', () => {
    const { value } = run('f(x: integer, y: integer) = x + y\nf(2.5, 1)');
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a multi-param typed function accepts all-good args', () => {
    const { value, diagnostics } = run(
      'f(x: integer, y: integer) = x + y\nf(2, 3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });

  test('a partially-annotated function enforces only the typed param', () => {
    // Signature is `(integer, any) -> any`: the first arg is checked, the
    // second is unconstrained.
    const bad = run('f(x: integer, y) = x + y\nf(2.5, 1)');
    expect(bad.value.toString()).toContain('incompatible-type');

    const good = run('f(x: integer, y) = x + y\nf(2, 1.5)');
    expect(good.diagnostics).toEqual([]);
    expect(good.value.re).toBe(3.5);
  });

  test('an unannotated function is unchanged (no enforcement)', () => {
    const { value, diagnostics } = run('g(x) = x + 1\ng(2.5)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3.5);
  });

  test('recursion with a typed param still works', () => {
    const { value, diagnostics } = run(
      'f(n: integer) = if n <= 1 { 1 } else { n * f(n - 1) }\nf(5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(120);
  });

  test('a closure-capturing typed function still captures', () => {
    const { value, diagnostics } = run(
      'let a = 10\nf(x: integer) = x + a\nf(5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(15);
  });

  test('a block-style return type is carried and honored', () => {
    // The return type is native now (no longer dropped): a good call evaluates
    // and the operator signature carries the declared return type.
    const { value, diagnostics } = run(
      'function f(x: integer) -> integer { x + 1 }\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a return type shows in the definition signature', () => {
    const { value, diagnostics } = run(
      'function f(x: integer) -> integer { x + 1 }\n"\\(Type(f))"'
    );
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('(x: integer) -> integer');
  });

  test('a math-style return type is carried and honored', () => {
    const { value, diagnostics } = run('f(x: integer) -> real = x + 1\nf(3)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a typed mapsto rejects a bad-typed call', () => {
    const { value } = run('((x: integer) |-> x + 1)(2.5)');
    expect(value.re).not.toBe(3.5);
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a typed mapsto accepts a good-typed call', () => {
    const { value, diagnostics } = run('((x: integer) |-> x + 1)(3)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('an if expression', () => {
    const { value, diagnostics } = run('if 3 > 0 { 1 } else { 2 }');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('a conditional expression', () => {
    const { value, diagnostics } = run('let x = 5\n10 if x > 3 else 20');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(10);
  });

  test('a conditional expression as a lambda body', () => {
    const { value, diagnostics } = run(
      'let sign = x |-> 1 if x > 0 else -1\nsign(-4)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(-1);
  });

  test('the `..` range operator drives a Sum', () => {
    const { value, diagnostics } = run('Sum(k, k in 1..5)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(15);
  });

  test('the `..` range operator drives a for loop', () => {
    const { value, diagnostics } = run(
      'let t = 0\nfor k in 1..3 { t = t + k }\nt'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });

  test('`true`/`false` evaluate as booleans', () => {
    expect(run('false && (1 > 0)').value.symbol).toBe('False');
    expect(run('!true').value.symbol).toBe('False');
    expect(run('let b = true\nb').value.symbol).toBe('True');
  });

  test('a for loop executes (evaluated for effect → Nothing)', () => {
    // `for x in xs` DOES execute today via the engine `Loop`, but `Loop` is
    // evaluated *for effect*: its value is `Nothing` (the collecting/scoping
    // quirk is what the pending Loop/Map de-conflation addresses —
    // docs/plans/2026-07-07-loop-map-deconflation.md).
    const { value, diagnostics } = run('for x in [1, 2, 3] { x }');
    expect(diagnostics).toEqual([]);
    expect(value.symbol).toBe('Nothing');
  });

  test('a $…$ island is spliced via the injected parseLatex', () => {
    const { value, diagnostics } = run('let a = $2 + 3$\na');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });

  test('an empty program yields Nothing', () => {
    const { value, diagnostics } = run('   ');
    expect(diagnostics).toEqual([]);
    expect(value.symbol).toBe('Nothing');
  });
});

describe('EPSIL EXECUTE — exactness contract', () => {
  test('a transcendental of an exact argument stays symbolic', () => {
    const { value } = run('Ln(2)');
    expect(value.operator).toBe('Ln');
    expect(value.toString()).toBe('ln(2)');
  });

  test('N(…) numericizes explicitly', () => {
    const { value } = run('N(Ln(2))');
    expect(value.re).toBeCloseTo(Math.log(2), 12);
  });
});

describe('EPSIL EXECUTE — errors are values', () => {
  test('a runtime problem surfaces as an Error value, not a throw', () => {
    // A type error becomes an embedded `["Error", …]` value; nothing throws.
    const { value } = run('x + True');
    expect(value.has('Error')).toBe(true);
  });

  test('reassigning a const yields an Error value (no throw)', () => {
    const { value, diagnostics } = run('const c = 1\nc = 2');
    // The engine throws on a const reassignment; executeEpsil catches it and
    // captures an `["Error", …]` value instead of propagating.
    expect(value.operator).toBe('Error');
    expect(diagnostics).toEqual([]);
  });
});

describe('EPSIL EXECUTE — while', () => {
  test('a while loop runs to completion (lowered to Loop + Break)', () => {
    // Count `c` down from 3 to 0; the loop value is Nothing (for-effect).
    const { value, diagnostics } = run(
      'let c = 3\nwhile c > 0 { c = c - 1 }\nc'
    );
    expect(diagnostics).toHaveLength(0);
    expect(value.re).toBe(0);
  });

  test('a while whose condition is initially false does not run the body', () => {
    const { value, diagnostics } = run(
      'let c = 0\nwhile c > 0 { c = c - 1 }\nc'
    );
    expect(diagnostics).toHaveLength(0);
    expect(value.re).toBe(0);
  });
});

describe('EPSIL EXECUTE — do-block expressions', () => {
  test('a top-level do-block yields its final statement', () => {
    const { value, diagnostics } = run('do { let t = 3; t + 1 }');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a do-block as an assignment RHS', () => {
    const { value, diagnostics } = run('let y = do { let t = 3; t + 1 }\ny');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a do-block lambda body', () => {
    const { value, diagnostics } = run(
      'let f = x |-> do { let t = x * x; t + 1 }\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(10);
  });
});

describe('EPSIL EXECUTE — zero-parameter lambdas', () => {
  test('a zero-parameter lambda applies with no arguments', () => {
    const { value, diagnostics } = run('let f = () |-> 42\nf()');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(42);
  });
});

describe('EPSIL EXECUTE — pragma security', () => {
  test('#env is gated off by default (diagnostic, no host read)', () => {
    const { value, diagnostics } = run('#env("HOME")');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toStrictEqual([
      'host-pragma-disabled',
      '#env',
    ]);
    expect(value.symbol).toBe('Nothing');
  });

  test('#navigator is gated off by default (diagnostic, no host read)', () => {
    const { diagnostics } = run('#navigator("userAgent")');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toStrictEqual([
      'host-pragma-disabled',
      '#navigator',
    ]);
  });

  test('#env reads the host when allowHostPragmas is enabled', () => {
    const { value, diagnostics } = run('#env("HOME")', {
      allowHostPragmas: true,
    });
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe(process.env['HOME']);
  });

  test('#error becomes a diagnostic, never a thrown exception', () => {
    let result: ReturnType<typeof executeEpsil> | undefined;
    expect(() => {
      result = run('#error("boom")');
    }).not.toThrow();
    expect(result!.diagnostics).toHaveLength(1);
    expect(result!.diagnostics[0].message).toStrictEqual([
      'error-directive',
      'boom',
    ]);
    expect(result!.value.symbol).toBe('Nothing');
  });
});

describe('EPSIL EXECUTE — string interpolation', () => {
  test('interpolation joins values, without serialization quotes', () => {
    const { value, diagnostics } = run('"the answer is \\(6 * 7)"');
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('the answer is 42');
  });

  test('the epsil.md headline example', () => {
    const { value, diagnostics } = run(
      'let x = 2^11 - 1\n"\\(x) has type \\(Type(x))"'
    );
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('2047 has type integer');
  });
});

describe('EPSIL EXECUTE — runtime problems in non-final statements', () => {
  // Only the last statement's value is returned, so an error value produced
  // by an earlier statement would vanish silently. Each non-final statement
  // that evaluates to an error value emits a `runtime-error` diagnostic.

  test('an indexed assignment (unsupported) surfaces as a diagnostic', () => {
    const { value, diagnostics } = run('let xs = [1, 2, 3]\nxs[2] = 9\nxs');
    // The engine rejects the assignment at canonicalization time, so the
    // statement is reported twice: once by the static pass (before anything
    // runs) and once by the run of the statement itself. The duplication is
    // accepted — a static diagnostic never suppresses evaluation.
    expect(diagnostics.map((x) => x.message[0])).toEqual([
      'static-type-error',
      'runtime-error',
    ]);
    // Both diagnostics point at the offending statement
    expect(diagnostics[0].range.slice(0, 2)).toEqual([19, 28]);
    expect(diagnostics[1].range).toEqual([19, 28]);
    // The list is unchanged
    expect(value.toString()).toBe('[1,2,3]');
  });

  test('a mid-program const reassignment surfaces as a diagnostic', () => {
    const { value, diagnostics } = run('const c = 1\nc = 2\nc + 1');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[0]).toBe('runtime-error');
    expect(value.re).toBe(2);
  });

  test('a final-statement error stays in value, with no diagnostic', () => {
    const { value, diagnostics } = run('const c = 1\nc = 2');
    expect(diagnostics).toEqual([]);
    expect(value.operator).toBe('Error');
  });
});

describe('EPSIL EXECUTE — static (canonicalization-time) type errors', () => {
  // `"a" + 1` is detectable before anything runs: it canonicalizes to a tree
  // embedding an `["Error", …]` node. `executeEpsil` reports those as
  // `static-type-error` diagnostics up front, then evaluates the program
  // exactly as it otherwise would (plan §5).

  test('reports the error and still evaluates the program', () => {
    const { value, diagnostics } = run('"a" + 1\n2');
    expect(diagnostics[0].message[0]).toBe('static-type-error');
    expect(diagnostics[0].message[1]).toBe(
      'incompatible-type (expected number, got string)'
    );
    // Anchored to the offending statement.
    expect(diagnostics[0].range.slice(0, 2)).toEqual([0, 7]);
    // Evaluation proceeded: the final statement's value is unchanged.
    expect(value.re).toBe(2);
  });

  test('a clean program gets no static diagnostics', () => {
    const { value, diagnostics } = run('f(n) = n^2 + 1\nf(3)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(10);
  });

  test('the check does not perturb the session it checks', () => {
    // Canonicalizing auto-declares the symbols an expression mentions; the
    // static pass must not leak those into the program's own scope (a
    // pre-declared `x` would make `let x = 2047` narrow to `finite_integer`).
    const { value } = run('let x = 2047\nType(x)');
    expect(value.string).toBe('integer');
  });

  test('skips the static pass when parsing failed', () => {
    const { diagnostics } = run('1 +');
    expect(diagnostics.every((x) => x.message[0] !== 'static-type-error')).toBe(
      true
    );
  });

  test('an author-built Error value is not a static problem', () => {
    // Errors are values: `Error(…)` written in the source survives
    // canonicalization unchanged, and reporting it would fail every
    // errors-as-values program. Only the pre-existing runtime behavior fires
    // (a non-final statement whose value is an error).
    const final = run('Error("boom")');
    expect(final.diagnostics).toEqual([]);
    expect(final.value.operator).toBe('Error');

    const nonFinal = run('Error("boom")\n2');
    expect(nonFinal.diagnostics.map((x) => x.message[0])).toEqual([
      'runtime-error',
    ]);
    expect(nonFinal.value.re).toBe(2);

    // A payload whitelist alone would not do this: a program can author the
    // very code canonicalization mints. Provenance is what rules it out.
    const authored = run(
      'let e = Error(ErrorCode("incompatible-type", "number", "string"))\ne'
    );
    expect(
      authored.diagnostics.filter((x) => x.message[0] === 'static-type-error')
    ).toEqual([]);
  });

  test('an author-built Error does not mask a real one', () => {
    const { diagnostics } = run(
      'Error(ErrorCode("incompatible-type", "number", "string"))\n"a" + 1'
    );
    expect(
      diagnostics.filter((x) => x.message[0] === 'static-type-error')
    ).toHaveLength(1);
  });

  test('an error inside a `let` initializer is found', () => {
    // The canonical `Declare` carries its initializer inside a MathJSON
    // dictionary literal, which the walk must descend into: an ordinary type
    // error in an initializer is still reported.
    const { diagnostics } = run('let g = "a" + 1');
    expect(diagnostics.map((x) => x.message[0])).toContain('static-type-error');
  });

  test('the `->` / `|->` typo is caught at parse time and recovered', () => {
    // `(n) -> n^2 + 1` used to surface only as a static-type-error (a
    // `KeyValuePair` whose key must be a string, found by the initializer
    // descent above). The parser now diagnoses the wrong arrow directly —
    // with a fixit — and recovers as the intended lambda.
    const { value, diagnostics } = run('let f = (n) -> n^2 + 1\nf(3)');
    expect(diagnostics.map((x) => x.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    expect(value.re).toBe(10);
  });

  test('a dictionary literal built with `->` stays clean', () => {
    const { diagnostics } = run('let d = {"a" -> 1, "b" -> 2}\nd');
    expect(
      diagnostics.filter((x) => x.message[0] === 'static-type-error')
    ).toEqual([]);
  });

  test('a repeated check leaves a declared symbol typed as it was', () => {
    // The pushed scope contains the *declarations* canonicalization creates.
    // This pins the definition of a symbol a previous cell declared: running
    // the pass over it (twice) must not retype it. The scope does NOT shield
    // an outer definition from type inference in general — see the
    // `staticDiagnostics()` doc comment.
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    executeEpsil(ce, 'let x = 5', { parseLatex });
    expect(ce.box('x').type.toString()).toBe('integer');

    const source = 'x + 1.5';
    const [ast] = parseEpsil(source, undefined, { parseLatex });
    staticDiagnostics(ce, ast!, source);
    staticDiagnostics(ce, ast!, source);
    expect(ce.box('x').type.toString()).toBe('integer');
  });
});

describe('EPSIL EXECUTE — structured cancellation cause', () => {
  // A cap breach (timeLimit / iterationLimit / recursionLimit) throws a
  // `CancellationError`; executeEpsil surfaces its machine-readable `cause`
  // additively — as a second operand on the final-statement Error VALUE, and
  // as `['evaluation-canceled', cause, …]` on a non-final diagnostic — while
  // the legacy message operand (which hosts may still string-match) is
  // unchanged. See Tycho's "structured cancellation cause" request.

  /** Run against an engine with caps applied, no LaTeX island parser needed. */
  function runWith(
    source: string,
    apply: (ce: ComputeEngine) => void
  ): ReturnType<typeof executeEpsil> {
    const ce = new ComputeEngine();
    apply(ce);
    return executeEpsil(ce, source);
  }

  test('recursion-depth-exceeded on the final-statement Error value', () => {
    const { value, diagnostics } = runWith('f(n) = f(n + 1)\nf(0)', (ce) => {
      ce.recursionLimit = 20;
    });
    expect(diagnostics).toEqual([]);
    expect(value.operator).toBe('Error');
    // Machine-readable cause is the second operand
    expect(value.op2?.string).toBe('recursion-depth-exceeded');
    // Legacy message operand is unchanged (hosts may still string-match it)
    expect(value.op1?.string).toBe('Recursion limit exceeded');
  });

  test('iteration-limit-exceeded on the final-statement Error value', () => {
    const { value } = runWith('let c = 0\nwhile c >= 0 { c = c + 1 }', (ce) => {
      ce.iterationLimit = 100;
    });
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('iteration-limit-exceeded');
    // Legacy default message operand is unchanged
    expect(value.op1?.string).toBe('Operation canceled');
  });

  test('timeout on the final-statement Error value', () => {
    const ce = new ComputeEngine();
    ce.iterationLimit = 100_000_000;
    const { value } = ce.withTimeLimit(
      { ms: 1, label: 'test:epsil-timeout' },
      () => executeEpsil(ce, 'let c = 0\nwhile c >= 0 { c = c + 1 }')
    );
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('timeout');
  });

  test('a non-final cap breach surfaces an evaluation-canceled diagnostic', () => {
    const { diagnostics } = runWith('f(n) = f(n + 1)\nf(0)\n1 + 1', (ce) => {
      ce.recursionLimit = 20;
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[0]).toBe('evaluation-canceled');
    // The cause is carried as the first message argument
    expect(diagnostics[0].message[1]).toBe('recursion-depth-exceeded');
  });

  test('a non-cancellation throw keeps the single-operand Error shape', () => {
    // Back-compat: only cap breaches gain the cause operand.
    const { value } = runWith('const k = 1\nk = 2', () => {});
    expect(value.operator).toBe('Error');
    expect(value.nops).toBe(1);
    expect(value.op2?.symbol).toBe('Nothing');
  });
});

describe('EPSIL EXECUTE — did-you-mean for unknown functions', () => {
  // Calling an unknown function stays *silently* symbolic (an inert
  // `["Quartile", …]` value). When the unknown name is close to a known
  // operator, a `warning`-severity `unknown-function` diagnostic surfaces the
  // suggestion; the returned value is unchanged. A name with no near match is
  // never nagged.

  test('a plural typo suggests the known operator', () => {
    const { value, diagnostics } = run('Quartile([1, 2, 3, 4, 5])');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].message).toEqual([
      'unknown-function',
      'Quartile',
      'Quartiles',
    ]);
    // The value is still the inert symbolic form.
    expect(value.operator).toBe('Quartile');
  });

  test('a transposition typo suggests the known operator', () => {
    const { diagnostics } = run('Argmuent(3)');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toEqual([
      'unknown-function',
      'Argmuent',
      'Argument',
    ]);
  });

  test('a one-edit typo suggests the known operator', () => {
    const { diagnostics } = run('Facorial(5)');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toEqual([
      'unknown-function',
      'Facorial',
      'Factorial',
    ]);
  });

  test('an unknown function with no near match is not nagged', () => {
    const { value, diagnostics } = run('foo(3)');
    expect(diagnostics).toEqual([]);
    expect(value.operator).toBe('foo');
  });

  test('a declared function is not flagged', () => {
    const { diagnostics } = run('f(x) = x + 1\nf(3)');
    expect(diagnostics).toEqual([]);
  });

  test('a lambda parameter used as a function is not flagged', () => {
    const { value, diagnostics } = run(
      'apply(g, x) = g(x)\napply(y |-> y * 2, 5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(10);
  });

  test('a name used twice fires a single diagnostic', () => {
    const { diagnostics } = run('Quartile([1, 2, 3])\nQuartile([4, 5, 6])');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[1]).toBe('Quartile');
  });

  test('the `Arg` alias is defined, so it evaluates without a diagnostic', () => {
    const { value, diagnostics } = run('Arg(i)');
    expect(diagnostics).toEqual([]);
    // `Arg` canonicalizes to `Argument`; `Argument(i)` is π/2.
    expect(value.isSame(new ComputeEngine().parse('\\frac{\\pi}{2}'))).toBe(
      true
    );
  });
});

describe('EPSIL EXECUTE — `===` (Same), structural identity', () => {
  const sym = (source: string) => {
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    return value.symbol;
  };

  test('`===` decides; `==` may stay a condition', () => {
    expect(sym('1 === 1')).toBe('True');
    // Two distinct free symbols are structurally different, so `===` is
    // False — it is TOTAL. `==` on the same pair is an unresolved condition.
    expect(sym('x === y')).toBe('False');
    expect(run('x == y').value.operator).toBe('Equal');
    expect(sym('x === x')).toBe('True');
  });

  test('`1 === 1.0` is True (the lexer folds `1.0` to the integer 1)', () => {
    expect(sym('1 === 1.0')).toBe('True');
  });

  test('no tolerance and no numeric evaluation, unlike `==`', () => {
    expect(sym('Sqrt(2) === Sqrt(2)')).toBe('True');
    expect(sym('Sqrt(2) === 1.4142135623730951')).toBe('False');
    expect(sym('Sqrt(2) == 1.4142135623730951')).toBe('True');
  });

  test('strings and lists', () => {
    expect(sym('"a" === "a"')).toBe('True');
    expect(sym('"a" === "b"')).toBe('False');
    expect(sym('[1, 2] === [1, 2]')).toBe('True');
    expect(sym('[1, 2] === [2, 1]')).toBe('False');
  });

  test('a chained `===` is n-ary and pairwise-adjacent', () => {
    expect(sym('1 === 1 === 1')).toBe('True');
    expect(sym('1 === 1 === 2')).toBe('False');
  });
});

describe('EPSIL EXECUTE — Count(xs, v) and Count(xs, p)', () => {
  test('the value form counts structurally identical elements', () => {
    expect(run('Count([1, 1, 2, 1], 1)').value.re).toBe(3);
    expect(run('Count([1, 2, 3], 9)').value.re).toBe(0);
    expect(run('Count(["a", "b", "a"], "a")').value.re).toBe(2);
  });

  test('the predicate form counts satisfying elements', () => {
    expect(run('Count([1, 2, 3], x |-> x > 1)').value.re).toBe(2);
    // A symbol bound to a function literal is a predicate too — the forms
    // dispatch on the operand's TYPE, not on its syntax.
    expect(run('let p = x |-> x > 1\nCount([1, 2, 3], p)').value.re).toBe(2);
  });

  test('the 1-argument cardinality form is unchanged', () => {
    expect(run('Count([1, 2, 3])').value.re).toBe(3);
    expect(run('Count([])').value.re).toBe(0);
  });
});

/**
 * Rungs 1–2 of the error-propagation design
 * (`docs/plans/2026-07-31-error-propagation-design.md`), through the Epsil
 * execution route. The engine-level pins are in
 * `test/compute-engine/error-propagation.test.ts`.
 */
describe('EPSIL EXECUTE — error propagation', () => {
  test('an error argument bubbles out of a call and out of a pipe', () => {
    const expected =
      'Error(ErrorCode("incompatible-type", "number", "string"))';
    expect(run('let f = x |-> x + 1\nf("a" + 1)').value.toString()).toBe(
      expected
    );
    expect(run('let f = x |-> x + 1\n("a" + 1) |> f').value.toString()).toBe(
      expected
    );
    // A chain short-circuits at the first stage.
    expect(
      run(
        'let f = x |-> x + 1\nlet g = y |-> y * 2\n("a" + 1) |> f |> g'
      ).value.toString()
    ).toBe(expected);
  });

  test('`err + 1` bubbles to the bare error (rung 3)', () => {
    // Rung 3: operators bubble too, so the frozen `Add(…Error…, 1)` becomes
    // the error itself — carrying a breadcrumb of the frames it passed
    // through (design §2a), which `toString()` does not display.
    const { value } = run('("a" + 1) + 1');
    expect(value.operator).toBe('Error');
    expect(value.isValid).toBe(false);
    expect(value.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
  });

  test('`match` rescues an error and `IsError` observes it', () => {
    expect(run('match ("a" + 1) {\n  _ => "rescued"\n}').value.toString()).toBe(
      '"rescued"'
    );
    expect(run('IsError("a" + 1)').value.symbol).toBe('True');
    expect(run('IsError(5)').value.symbol).toBe('False');
    // `|>` is application sugar (§3), so the OBSERVER sees the error on the
    // pipe route too — `x |> f` never means something different from `f(x)`.
    expect(run('("a" + 1) |> IsError').value.symbol).toBe('True');
  });

  test('`NaN === NaN` is True (total structural identity), `==` is False', () => {
    // `===`/`Same` is total and structural, so it is reflexive on NaN. The
    // Epsil route attaches `sourceOffsets` to each literal, which defeats
    // the engine's interning of `NaN` — the answer must not depend on that.
    expect(run('NaN === NaN').value.symbol).toBe('True');
    expect(run('NaN == NaN').value.symbol).toBe('False');
  });

  test('NaN does not short-circuit a pipe', () => {
    expect(run('NaN |> IsMissing').value.symbol).toBe('True');
    const { value } = run('let f = x |-> 99\nNaN |> f');
    expect(value.re).toBe(99);
  });

  test('`Nothing` is erased from the argument list on every route', () => {
    const nullary = run('let f = x |-> x + 1\nf()').value.toString();
    expect(run('let f = x |-> x + 1\nf(Nothing)').value.toString()).toBe(
      nullary
    );
    expect(run('let f = x |-> x + 1\nNothing |> f').value.toString()).toBe(
      nullary
    );
    expect(run('let f = x |-> x + 1\nApply(f, Nothing)').value.toString()).toBe(
      nullary
    );
  });
});

describe('EPSIL EXECUTE — the bare `_` identity shorthand', () => {
  // A bare `_` in a function slot is the identity function (`x |-> x`). The
  // Epsil parser accepts `_` in argument position (it is an ordinary symbol
  // token there), so the shorthand has to work on this route too.
  test('Map([1,2,3], _) yields the elements unchanged', () => {
    const { value, diagnostics } = run('Map([1, 2, 3], _)');
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[1,2,3]');
  });

  test('an eager function-slot operator takes it as well', () => {
    const { value, diagnostics } = run('ChunkBy([1, 1, 2, 2, 3], _)');
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[[1,1],[2,2],[3]]');
  });

  test('Filter([True, False], _) keeps the truthy elements', () => {
    const { value, diagnostics } = run('Filter([True, False], _)');
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('["True"]');
  });
});

describe('EPSIL EXECUTE — `??` and `is`', () => {
  const value = (src: string): string => {
    const { value, diagnostics } = run(src);
    expect(diagnostics).toEqual([]);
    return value.toString();
  };

  test('`??` discharges absence, left to right', () => {
    expect(value('5 ?? 1')).toBe('5');
    expect(value('NaN ?? 7')).toBe('7');
    expect(value('Missing ?? 7')).toBe('7');
    expect(value('NaN ?? Missing ?? 3')).toBe('3');
  });

  test('`??` is lazy: the fallback is not evaluated when the value is present', () => {
    expect(value('1 ?? (1/0)')).toBe('1');
  });

  test('`??` over an out-of-band index discharges the hole', () => {
    expect(value('let xs = [10, 20]\nxs[9] ?? 0')).toBe('0');
  });

  test('`??` inside a lambda body', () => {
    expect(value('let f = (x) |-> x ?? 0\nf(NaN)')).toBe('0');
  });

  test('`is` is a runtime type test', () => {
    expect(value('5 is integer')).toBe('"True"');
    expect(value('5 is string')).toBe('"False"');
    expect(value('"a" is string')).toBe('"True"');
    expect(value('if 5 is integer { "yes" } else { "no" }')).toBe('"yes"');
  });
});

describe('EPSIL EXECUTE — `break` and `continue`', () => {
  test('`break` leaves the loop', () => {
    // `total` accumulates 1 + 2 and stops: the loop is abandoned at x = 3.
    const { value, diagnostics } = run(
      'let total = 0\nfor x in [1, 2, 3, 4] {\n  if x > 2 { break }\n  total = total + x\n}\ntotal'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3);
  });

  test('`continue` skips to the next iteration', () => {
    // Every element is visited; only x = 2 is skipped → 1 + 3 + 4.
    const { value, diagnostics } = run(
      'let total = 0\nfor x in [1, 2, 3, 4] {\n  if x == 2 { continue }\n  total = total + x\n}\ntotal'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(8);
  });

  test('`break` in a `while` loop', () => {
    const { value, diagnostics } = run(
      'let k = 0\nwhile True {\n  k = k + 1\n  if k >= 3 { break }\n}\nk'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3);
  });

  test('`break` targets the INNERMOST loop', () => {
    // The inner loop breaks on its first element, so the outer loop still
    // runs all three times: 3 × 1 = 3.
    const { value, diagnostics } = run(
      'let n = 0\nfor x in [1, 2, 3] {\n  for y in [10, 20] {\n    n = n + 1\n    break\n  }\n}\nn'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3);
  });
});
