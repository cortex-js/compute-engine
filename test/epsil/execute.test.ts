import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { checkSource } from '../../src/cli/check';

//
// `executeEpsil` parses a program and
// evaluates each top-level statement sequentially in the engine's current
// scope (a notebook cell-chain), symbolic-by-default (the exactness contract),
// with runtime problems flowing as `["Error", …]` *values* and parse problems
// as diagnostics.
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
    const { value } = run('((x: integer) => x + 1)(2.5)');
    expect(value.re).not.toBe(3.5);
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a typed mapsto accepts a good-typed call', () => {
    const { value, diagnostics } = run('((x: integer) => x + 1)(3)');
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
      'let sign = x => 1 if x > 0 else -1\nsign(-4)'
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
    // evaluated *for effect*: its value is `Nothing`. `Loop` is the imperative
    // form; collecting expressions use `Map` or `Comprehension`.
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
      'let f = x => do { let t = x * x; t + 1 }\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(10);
  });
});

describe('EPSIL EXECUTE — zero-parameter lambdas', () => {
  test('a zero-parameter lambda applies with no arguments', () => {
    const { value, diagnostics } = run('let f = () => 42\nf()');
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
    // Both narrow to `xs[2]` rather than underlining the whole statement —
    // the static pass from the error's position in the canonical tree, the
    // run from the error's breadcrumb, through the same matcher.
    expect(diagnostics[0].range.slice(0, 2)).toEqual([19, 24]);
    expect(diagnostics[1].range).toEqual([19, 24]);
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
      'expected `number`, got `string` at `a`'
    );
    // Anchored to the offending operand — the `"a"`, not all of `"a" + 1`.
    expect(diagnostics[0].range.slice(0, 2)).toEqual([0, 3]);
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
    const { value } = run('let x = 2047\nStringFrom(Type(x))');
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

  test('the `->` / `=>` typo is caught at parse time and recovered', () => {
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

describe('EPSIL EXECUTE — an expired time budget ends the program', () => {
  // The host's `withTimeLimit` span is one deadline for the whole program.
  // Before the fix (2026-08-15) `executeEpsil` converted each statement's
  // timeout `CancellationError` into an error value and moved on to the NEXT
  // statement — so a program of many cheap statements ran to completion
  // however far past its deadline it was, and a budget was decorative. Now
  // the deadline is checked before every statement (in the static pass and
  // in the evaluation loop) and the first expiry stops the program.
  //
  // Wall-clock doctrine: no elapsed-time assertions. A `ms: 0` span is
  // expired the moment it is armed, so every outcome below is deterministic.

  test('no statement runs once the budget has expired', () => {
    const ce = new ComputeEngine();
    const { value, diagnostics, valueRange } = ce.withTimeLimit(
      { ms: 0, label: 'test:epsil-expired' },
      () => executeEpsil(ce, 'x = 1\ny = 2\nz = 3')
    );
    // The program's value is the cancellation, anchored on the statement it
    // stopped at — the first one.
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('timeout');
    expect(valueRange).toEqual([0, 5]);
    // Non-final, so mirrored as a diagnostic — exactly one, not one per
    // statement: the loop stopped.
    expect(diagnostics.map((d) => d.message.slice(0, 2))).toEqual([
      ['evaluation-canceled', 'timeout'],
    ]);
    // Nothing after the cancellation ran: no statement bound its name.
    expect(ce.box('x').value).toBeUndefined();
    expect(ce.box('y').value).toBeUndefined();
    expect(ce.box('z').value).toBeUndefined();
  });

  test('statements before the expiry keep their effects', () => {
    // The budget expires MID-program: statement 1 runs, statement 2 spends
    // the rest of the budget, statement 3 must not run. Deterministic —
    // rather than a real span the program can outrun during parsing, a host
    // function moves the armed deadline into the past when it evaluates
    // (`withTimeLimit` restores the frame it saved when the call returns).
    const ce = new ComputeEngine();
    let spends = 0;
    ce.declare('SpendBudget', {
      signature: '() -> integer',
      evaluate: () => {
        spends += 1;
        ce._deadlineFrame = { at: Date.now() - 1, spans: ['test:spend'] };
        return ce.One;
      },
    });
    const { value, diagnostics, valueRange } = ce.withTimeLimit(
      { ms: 60_000, label: 'test:epsil-spend' },
      () => executeEpsil(ce, 'a = 1\nSpendBudget()\nb = 2\nb')
    );
    // The handler ran exactly once, at evaluation time (had canonicalization
    // folded the call, the static pass would have tripped and the program
    // would have stopped at statement 1 instead).
    expect(spends).toBe(1);
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('timeout');
    // Anchored on `b = 2`, the statement the check stopped.
    expect(valueRange).toEqual([20, 25]);
    expect(diagnostics.map((d) => d.message.slice(0, 2))).toEqual([
      ['evaluation-canceled', 'timeout'],
    ]);
    // `a = 1` ran before the budget was spent; `b = 2` after it did not.
    expect(ce.box('a').evaluate().re).toBe(1);
    expect(ce.box('b').value).toBeUndefined();
  });

  test('a count-based cap does not end the program (per-construct config)', () => {
    // Contrast: `iterationLimit` is per-construct, so the next statement gets
    // a fresh allowance and the program continues — the breach is an error
    // value plus a diagnostic, exactly as before. (`docs/TIMEOUT-MODEL.md` §9.)
    const ce = new ComputeEngine();
    ce.iterationLimit = 100;
    const { value, diagnostics } = executeEpsil(
      ce,
      'let c = 0\nwhile c >= 0 { c = c + 1 }\nb = 2\nb'
    );
    expect(diagnostics.map((d) => d.message.slice(0, 2))).toEqual([
      ['evaluation-canceled', 'iteration-limit-exceeded'],
    ]);
    expect(value.re).toBe(2);
  });

  test('a budget spent DURING the static pass keeps the diagnostics found so far', () => {
    // The pass writes into the caller's diagnostics array as it goes, so a
    // static type error established in statement 1 survives a deadline breach
    // at statement 2 (a `canonical` handler expires the frame at BOXING time,
    // which is when the pass runs — deterministic, no real span to outrun).
    // The program's result is then the cancellation at statement 1, and no
    // statement's evaluation ran.
    const ce = new ComputeEngine();
    let spends = 0;
    ce.declare('SpendAtBoxing', {
      signature: '() -> integer',
      canonical: (ops, { engine }) => {
        spends += 1;
        engine._deadlineFrame = { at: Date.now() - 1, spans: ['test:spend'] };
        return engine._fn('SpendAtBoxing', ops);
      },
    });
    const { value, diagnostics, valueRange } = ce.withTimeLimit(
      { ms: 60_000, label: 'test:epsil-static-spend' },
      () => executeEpsil(ce, '"a" + 1\nSpendAtBoxing()\nz = 3\nz')
    );
    // Boxed once, by the pass; the pass then threw at the next statement's
    // check, so the evaluation loop's own boxing never reached it.
    expect(spends).toBe(1);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'static-type-error',
      'evaluation-canceled',
    ]);
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('timeout');
    expect(valueRange).toEqual([0, 7]);
    expect(ce.box('z').value).toBeUndefined();
  });

  test('the static pass lets an expired budget through instead of eating it', () => {
    // `staticDiagnostics` boxes every statement under a per-statement catch
    // that used to swallow EVERY throw, an expired budget included. A direct
    // caller (`epsil check`) armed with a span must see the cancellation.
    const ce = new ComputeEngine();
    const [ast] = parseEpsil('x = 1\ny = 2');
    expect(() =>
      ce.withTimeLimit({ ms: 0, label: 'test:epsil-static' }, () =>
        staticDiagnostics(ce, ast!, 'x = 1\ny = 2')
      )
    ).toThrow(/Timeout exceeded/);
    // …and it left the engine clean (scope popped, depth restored): a
    // following unbudgeted pass over the same engine still works.
    expect(staticDiagnostics(ce, ast!, 'x = 1\ny = 2')).toEqual([]);
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
      'apply(g, x) = g(x)\napply(y => y * 2, 5)'
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
    expect(run('Count([1, 2, 3], x => x > 1)').value.re).toBe(2);
    // A symbol bound to a function literal is a predicate too — the forms
    // dispatch on the operand's TYPE, not on its syntax.
    expect(run('let p = x => x > 1\nCount([1, 2, 3], p)').value.re).toBe(2);
  });

  test('the 1-argument cardinality form is unchanged', () => {
    expect(run('Count([1, 2, 3])').value.re).toBe(3);
    expect(run('Count([])').value.re).toBe(0);
  });
});

/**
 * Rungs 1–2 of the error-propagation design
 * (`docs/LANGUAGE-MODEL.md`), through the Epsil
 * execution route. The engine-level pins are in
 * `test/compute-engine/error-propagation.test.ts`.
 */
describe('EPSIL EXECUTE — error propagation', () => {
  test('an error argument bubbles out of a call and out of a pipe', () => {
    const expected =
      'Error(ErrorCode("incompatible-type", "number", "string"), "a")';
    expect(run('let f = x => x + 1\nf("a" + 1)').value.toString()).toBe(
      expected
    );
    expect(run('let f = x => x + 1\n("a" + 1) |> f').value.toString()).toBe(
      expected
    );
    // A chain short-circuits at the first stage.
    expect(
      run(
        'let f = x => x + 1\nlet g = y => y * 2\n("a" + 1) |> f |> g'
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
      'Error(ErrorCode("incompatible-type", "number", "string"), "a")'
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
    const { value } = run('let f = x => 99\nNaN |> f');
    expect(value.re).toBe(99);
  });

  test('`Nothing` is erased from the argument list on every route', () => {
    const nullary = run('let f = x => x + 1\nf()').value.toString();
    expect(run('let f = x => x + 1\nf(Nothing)').value.toString()).toBe(
      nullary
    );
    expect(run('let f = x => x + 1\nNothing |> f').value.toString()).toBe(
      nullary
    );
    expect(run('let f = x => x + 1\nApply(f, Nothing)').value.toString()).toBe(
      nullary
    );
  });
});

/**
 * Pipe-stage sugar (2026-08-13). Three rules make `|>` pipelines concise:
 *
 * 1/ Implicit topic argument: a call stage missing required arguments gets
 *    the piped value as its first argument — `xs |> Take(10)` means
 *    `xs |> Take(_, 10)`. A COMPLETE call keeps its old meaning.
 * 2/ Stage lambda: a `=>` after a pipe operand binds tighter than the pipe
 *    (only there), so `xs |> x => x^2 |> Sum` is `xs |> (x => x^2) |> Sum`.
 * 3/ Implicit `Map`: a unary LITERAL lambda stage over a collection topic
 *    maps — `xs |> x => x^2` and `xs |> _^2` are `Map(x => x^2, xs)`.
 *    Named-function stages (`xs |> Sum`), string topics, and lambdas whose
 *    authored parameter annotation accepts the whole topic still apply.
 *
 * Rules 1 and 3 live in the engine (`library/core.ts`, box-route pins in
 * `test/compute-engine/functions.test.ts`); rule 2 and the `_^2` lambda
 * reading are Epsil parser rewrites.
 */
describe('EPSIL EXECUTE — pipe-stage sugar', () => {
  test('the motivating pipelines are equivalent', () => {
    expect(
      run('1..oo |> Take(_, 10) |> Map(_^2, _) |> Sum').value.re
    ).toBe(385);
    expect(run('1..oo |> Take(10) |> x => x^2 |> Sum').value.re).toBe(385);
    expect(run('1..oo |> Take(10) |> _^2 |> Sum').value.re).toBe(385);
  });

  test('implicit topic argument fills an incomplete call', () => {
    expect(run('1..10 |> Take(3)').value.toString()).toBe('[1,2,3]');
    expect(
      run('let f = x => x * 2\n[1,2,3] |> Map(f)').value.toString()
    ).toBe('[2,4,6]');
    expect(run('[1,2,3] |> Filter(x => x > 1)').value.toString()).toBe(
      '[2,3]'
    );
  });

  test('the topic takes the TRAILING fitting slot, and displaced arguments must still fit', () => {
    // `Fold(reducer, initial, collection)`: the list fits `initial: value`
    // too, but the trailing collection slot displaces nothing — and putting
    // the list at slot 1 would push `10` into the collection slot.
    expect(run('[1,2,3] |> Fold((a, b) => a + b, 10)').value.re).toBe(16);
    // A string is a collection, so `"H;"` "fits" the collection slot it
    // would be pushed into; the trailing-slot rule keeps it as the initial.
    expect(
      run('let header = "H;"\n["a", "b", "c"] |> Fold(Join, header)').value
        .string
    ).toBe('H;abc');
    expect(run('1..3 |> n => "\\(n);" |> Fold(Join, "")').value.string).toBe(
      '1;2;3;'
    );
    // …while a topic that belongs FIRST still shifts the written arguments.
    expect(run('1..10 |> Take(3)').value.toString()).toBe('[1,2,3]');
    expect(run('1..10 |> Filter(n => n % 2 == 1) |> Sum').value.re).toBe(25);
  });

  test('a complete call stage keeps its existing meaning', () => {
    // Max(3) is a valid call: the topic is applied to its value (Apply's
    // constant-nullary shorthand), exactly as before the sugar.
    expect(run('5 |> Max(3)').value.re).toBe(3);
    // An operator-written stage with a free symbol still binds the topic to
    // the unknown (the shorthand-lambda path), not to Add's first argument.
    expect(run('5 |> y + 1').value.re).toBe(6);
  });

  test('a stage lambda ends at the next pipe', () => {
    expect(
      run('[1,2,3] |> x => x + 1 |> Sum').value.re
    ).toBe(9);
  });

  test('a unary lambda stage maps over a collection topic', () => {
    expect(run('[1,2,3] |> (x => x^2)').value.toString()).toBe('[1,4,9]');
    expect(run('[1,2,3] |> _^2').value.toString()).toBe('[1,4,9]');
    expect(run('[1,2,3] |> _ + 1').value.toString()).toBe('[2,3,4]');
    // The stage maps EACH ELEMENT, so a collection-consuming body goes
    // inert per element…
    expect(run('[1,2,3] |> (l => Length(l))').value.toString()).toBe(
      '[Length(1),Length(2),Length(3)]'
    );
    // …the whole-collection spellings are the named function or an authored
    // annotation the topic satisfies.
    expect(run('[1,2,3] |> Length').value.re).toBe(3);
    expect(
      run('[1,2,3] |> ((l: list<number>) => Length(l))').value.re
    ).toBe(3);
  });

  test('a lambda stage over a non-collection topic applies', () => {
    expect(run('5 |> _^2').value.re).toBe(25);
    expect(run('5 |> (x => x + 1)').value.re).toBe(6);
    expect(run('5 |> x => x + 1').value.re).toBe(6);
  });

  test('a string topic is a scalar, not a character collection', () => {
    expect(run('"abc" |> (c => c)').value.toString()).toBe('"abc"');
  });

  test('a placeholder in a CALL stage is still the topic', () => {
    // `_` as a call argument marks where the piped value goes — no implicit
    // Map, even over a collection topic.
    expect(run('1..10 |> Take(_, 3)').value.toString()).toBe('[1,2,3]');
    expect(run('1..5 |> Map(_^2, _)').value.toString()).toBe(
      '[1,4,9,16,25]'
    );
  });
});

/**
 * Collection-literal spread (2026-08-14, rulings revised same day):
 * `[...xs, c]` splices into list literals, `{a, ...s}` into set literals,
 * and `{-> , ...d, "k" -> v}` merges dictionaries. Handled at
 * CANONICALIZATION with `Join` semantics: non-tuple collections splice
 * (lazily for an infinite segment); a TUPLE does not spread — tuples are
 * units, `ListFrom` is the explicit converter — so a provable tuple is a
 * loud `spread-tuple` error and a scalar/string is `Join`'s
 * `incompatible-type` error. A lone `[...xs]` is `Join(xs)`. Dictionary
 * merges are LAST-wins on key collisions, while duplicate LITERAL keys
 * keep the literal convention (first wins + diagnostic). Box-route pins in
 * `test/compute-engine/collections.test.ts`.
 */
describe('EPSIL EXECUTE — collection-literal spread', () => {
  test('splices lists and ranges', () => {
    expect(run('let xs = [1, 2]\n[...xs, 3]').value.toString()).toBe(
      '[1,2,3]'
    );
    expect(run('[0, ...(1..3), 9]').value.toString()).toBe('[0,1,2,3,9]');
    expect(
      run('let xs = [1,2]\nlet ys = [4,5]\n[...xs, 3, ...ys]').value.toString()
    ).toBe('[1,2,3,4,5]');
    expect(run('[...[1, 2], 3]').value.toString()).toBe('[1,2,3]');
  });

  test('tuples do NOT spread: loud spread-tuple error', () => {
    const { value } = run('let t = (1, 2)\n[...t, 3]');
    expect(value.toString()).toContain('spread-tuple');
    // The explicit conversion is the escape: ListFrom(t) splices.
    expect(
      run('let t = (1, 2)\n[...ListFrom(t), 3]').value.toString()
    ).toBe('[1,2,3]');
  });

  test('a lone spread is the list materialization (Join)', () => {
    expect(run('[...(1..4)]').value.toString()).toBe('[1,2,3,4]');
    expect(run('let xs = [1,2]\n[...xs]').value.toString()).toBe('[1,2]');
  });

  test('a scalar spread is a loud error', () => {
    expect(run('[...5]').value.isValid).toBe(false);
  });

  test('a STRING spread expands to its characters', () => {
    // Formerly a loud error, because a string was not a collection. A string
    // is an indexed collection of its grapheme clusters now, and `...` is an
    // EXPLICIT expansion the author wrote (unlike a broadcast lift, where
    // strings stay atomic), so it yields one element per character — the same
    // reading JavaScript and Python spread give.
    expect(run('[..."ab", 1]').value.toString()).toBe('["a","b",1]');
  });

  test('an infinite spread stays lazy', () => {
    expect(run('[...(1..oo), 5] |> Take(3)').value.toString()).toBe('[1,2,3]');
    expect(run('[...(1..oo), 5] |> Take(8) |> Sum').value.re).toBe(36);
    expect(run('[0, ...(1..oo)] |> Take(3)').value.toString()).toBe('[0,1,2]');
  });

  test('`Nothing` erasure still applies around spreads', () => {
    expect(run('[1, Nothing, ...[2]]').value.toString()).toBe('[1,2]');
  });

  test('set spread splices and deduplicates', () => {
    expect(run('let s = {2, 3}\n{1, ...s}').value.toString()).toBe(
      'Set(1, 2, 3)'
    );
    expect(run('{1, ...[2, 2, 3]}').value.toString()).toBe('Set(1, 2, 3)');
    expect(run('{...{1, 2}, ...{2, 3}}').value.toString()).toBe(
      'Set(1, 2, 3)'
    );
  });

  test('dictionary merge is last-wins; the bare `->` marker forces dictionary', () => {
    expect(
      run(
        'let d = {"a" -> 1, "b" -> 2}\n{...d, "b" -> 9}'
      ).value.toString()
    ).toBe('{"a" -> 1, "b" -> 9}');
    expect(
      run('let d = {"b" -> 9}\n{"a" -> 1, "b" -> 2, ...d}').value.toString()
    ).toBe('{"a" -> 1, "b" -> 9}');
    // A brace of only spreads is a SET-spread; the `->` marker makes the
    // pure merge a dictionary.
    expect(
      run(
        'let d1 = {"a" -> 1}\nlet d2 = {"b" -> 2}\n{->, ...d1, ...d2}'
      ).value.toString()
    ).toBe('{"a" -> 1, "b" -> 2}');
    expect(run('let a = {1}\nlet b = {2}\n{...a, ...b}').value.toString()).toBe(
      'Set(1, 2)'
    );
    // A literal key reappearing AFTER a spread is the override idiom:
    // last wins, and no duplicate-key diagnostic fires.
    const override = run('let d = {"a" -> 5}\n{"a" -> 1, ...d, "a" -> 2}');
    expect(override.value.toString()).toBe('{"a" -> 2}');
    expect(override.diagnostics).toEqual([]);
  });

  test('an empty dictionary prints as `{->}` and round-trips', () => {
    // `{->}` is the spelling that parses back as an empty dictionary (a bare
    // `{}` is an empty block), so the printed form must be exactly that.
    expect(run('{->}').value.toString()).toBe('{->}');
    // Escaping round-trip: a key/value with a quote, backslash, and newline
    // reparses to the same dictionary.
    const printed = run('{"a\\"b\\\\c" -> "x\\ny"}').value.toString();
    expect(printed).toBe('{"a\\"b\\\\c" -> "x\\ny"}');
    expect(run(printed).value.toString()).toBe(printed);
  });

  test('a set spread into a LIST literal stays a list (no dedup)', () => {
    const { value } = run('let s = {1, 2}\n[...s, 2]');
    expect(value.toString()).toBe('[1,2,2]');
    expect(value.type.matches('list')).toBe(true);
  });

  test('a spread of a VALUELESS dictionary-typed symbol stays symbolic', () => {
    // The bug as filed (2026-08-14): with `d` declared `dictionary<integer>`
    // but not yet assigned, the merge errored with "Expected a collection of
    // pairs, got dictionary<integer>" instead of staying symbolic until the
    // value arrives. This pins the Epsil surface; the box-route twin lives
    // in `collections.test.ts` ("a spread of a VALUELESS dictionary-typed
    // symbol stays symbolic").
    const { value, diagnostics } = run(
      'let d: dictionary<integer>\n{->, ...d, "z" -> 3}'
    );
    expect(diagnostics).toEqual([]);
    expect(value.isValid).toBe(true);
    expect(value.operator).toBe('DictionaryFrom');
    // Same program with the value present resolves to the merged dictionary.
    expect(
      run(
        'let d: dictionary<integer>\nd = {"a" -> 1}\n{->, ...d, "z" -> 3}'
      ).value.toString()
    ).toBe('{"a" -> 1, "z" -> 3}');
  });
});

describe('EPSIL EXECUTE — the bare `_` identity shorthand', () => {
  // A bare `_` in a function slot is the identity function (`x => x`). The
  // Epsil parser accepts `_` in argument position (it is an ordinary symbol
  // token there), so the shorthand has to work on this route too.
  test('Map(_, [1,2,3]) yields the elements unchanged', () => {
    const { value, diagnostics } = run('Map(_, [1, 2, 3])');
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
    expect(value('let f = (x) => x ?? 0\nf(NaN)')).toBe('0');
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

describe('EPSIL EXECUTE — diagnostic anchoring inside a NAMED call', () => {
  // The named-argument seam permutes a named call into declaration order
  // before anything downstream runs, so an error's argument index counts
  // DECLARATION slots — while the raw source still lists the arguments as
  // written. `locateError` reconciles the two through the callee's declared
  // parameter names (`argumentAtSlot`, src/epsil/error-location.ts), so the
  // underline lands on the argument the author has to fix. Before that
  // mapping, a reordered call underlined whichever argument happened to sit
  // at the declaration index in WRITTEN order — the wrong one.

  const DEF = 'function f(x: number, y: string) { x + 3 }';

  test('reordered call, faulted argument written LAST', () => {
    const src = `${DEF}\nf(y: "ok", x: "bad")\n1`;
    const { diagnostics } = run(src);
    // Static pass and run both report (same statement, same anchor).
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'static-type-error',
      'runtime-error',
    ]);
    const from = src.indexOf('x: "bad"');
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('x: "bad"');
    expect(diagnostics[0].range[0]).toBe(from);
  });

  test('reordered call, faulted argument written FIRST', () => {
    const src = `${DEF}\nf(y: 7, x: 1)\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('y: 7');
  });

  test('declaration-order named call anchors as before', () => {
    const src = `${DEF}\nf(x: "bad", y: "ok")\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('x: "bad"');
  });

  test('mixed positional-then-named call anchors on the named argument', () => {
    const src = `${DEF}\nf(1, y: 9)\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('y: 9');
  });

  test('positional-only call is unaffected by the mapping', () => {
    const src = `${DEF}\nf("bad", "ok")\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('"bad"');
  });

  // The seam's own normalization FAILURES are reported against the list AS
  // WRITTEN (`blame()` replaces the offending entry in place — the call was
  // never permuted), so their frame index needs NO slot-name remapping:
  // `errorIndexCountsWrittenArguments` (named-arguments.ts) routes them to
  // direct indexing. Remapping them would move the underline to a bystander.

  test('a duplicate name underlines the second occurrence', () => {
    const src = `${DEF}\nf(y: 1, y: 2)\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('y: 2');
  });

  test('an unknown name underlines the argument that used it', () => {
    const src = `${DEF}\nf(z: 1, x: 2)\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('z: 1');
  });

  test('a positional argument after a named one underlines the positional', () => {
    const src = `${DEF}\nf(y: "ok", 5)\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('5');
  });

  test('a missing required argument anchors on the call', () => {
    // The faulted SLOT has no written argument to underline — what is
    // missing is a parameter — so the anchor stays on the whole call.
    const src = `${DEF}\nf(y: "ok")\n1`;
    const { diagnostics } = run(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics)
      expect(src.slice(d.range[0], d.range[1])).toBe('f(y: "ok")');
  });

  test('a final-statement error narrows valueRange to the written argument', () => {
    // Errors-are-values: the final statement's RUNTIME error mints no
    // diagnostic (pinned elsewhere) — its presentation-layer anchor is
    // `valueRange`, which flows through the same locator and gets the same
    // mapping. The STATIC pass still reports the type error up front, with
    // the same corrected anchor.
    const src = `${DEF}\nf(y: "ok", x: "bad")`;
    const { diagnostics, valueRange } = run(src);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'static-type-error',
    ]);
    expect(src.slice(diagnostics[0].range[0], diagnostics[0].range[1])).toBe(
      'x: "bad"'
    );
    expect(src.slice(valueRange[0], valueRange[1])).toBe('x: "bad"');
  });
});

describe('EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier)', () => {
  // Assignment and declaration are evaluation-time effects, so the static
  // pre-pass — which canonicalizes every statement before any evaluates —
  // used to see the callee of a named call as an auto-declared symbol with no
  // parameter names, and drew one false `argument-names-unavailable`
  // diagnostic per argument for a program that runs fine. The pass now
  // registers the signature such a statement pins for its LATER statements
  // (`registerPinnedSignature`, src/epsil/static-diagnostics.ts).

  test('named call to a `:=`-assigned annotated literal is statically clean', () => {
    const { value, diagnostics } = run(
      'f := (x: number, y: string) => x + 3\nf(y: "ok", x: 1)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('named call through an annotated declaration is statically clean', () => {
    const { value, diagnostics } = run(
      'const g : (x: number, y: string) -> number = (x, y) => x + 3\ng(y: "ok", x: 1)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('an annotation-only declaration pins the names too', () => {
    // No initializer: at runtime the call permutes against the declared
    // signature and stays inert, so a static decline would be just as false.
    const { value, diagnostics } = run(
      'let g : (x: number, y: string) -> number\ng(y: "ok", x: 1)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('g(1, "ok")');
  });

  test('positional-call control: unchanged, statically clean', () => {
    const { value, diagnostics } = run(
      'f := (x: number, y: string) => x + 3\nf(1, "ok")'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a named call to an UNANNOTATED `:=`-assigned literal still declines', () => {
    // Type inference drops parameter names (`effects-inference.ts` types a
    // bare parameter `{ type: 'unknown' }`), so this named call fails at
    // runtime too — the static diagnostics are TRUE predictions and must
    // keep firing (ROADMAP "Named-argument calls — v1 residuals").
    const { value, diagnostics } = run('h := (x, y) => x + 3\nh(y: 2, x: 1)');
    expect(diagnostics.map((d) => d.message[3])).toEqual([
      'argument-names-unavailable',
      'argument-names-unavailable',
    ]);
    expect(value.errors.length).toBeGreaterThan(0);
  });

  test('a named call written BEFORE the assignment still declines', () => {
    // Registration follows statement order, so statement 1's callee has no
    // names to check — matching the runtime, where `f` is unassigned there:
    // two static diagnostics plus statement 1's runtime-error, and none for
    // statement 3, which computes 12.
    const src =
      'f(y: "ok", x: 1)\nf := (x: number, y: string) => x + 3\nf(y: "no", x: 9)';
    const { value, diagnostics } = run(src);
    expect(diagnostics.map((d) => d.message[3])).toEqual([
      'argument-names-unavailable',
      'argument-names-unavailable',
      'argument-names-unavailable',
    ]);
    expect(value.re).toBe(12);
    const firstLineEnd = src.indexOf('\n');
    for (const d of diagnostics)
      expect(d.range[1]).toBeLessThanOrEqual(firstLineEnd);
  });

  test('reassignment: the FIRST pinned signature owns the names', () => {
    // Mirror of the runtime, where the first assignment pins the binding's
    // declared type — the place parameter names live — and a later
    // reassignment never re-pins it: the second literal's names are unknown
    // at runtime, and the static tier reports the same problem.
    const src =
      'f := (x: number, y: number) => x + 3\nf := (a: number, b: number) => a * b\nf(a: 2, b: 5)';
    const { value, diagnostics } = run(src);
    expect(diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['static-type-error', 'argument-name-unknown'],
    ]);
    expect(value.errors.length).toBeGreaterThan(0);
  });

  test('incompatible reassignment: the first names keep working, no false static diagnostics', () => {
    // The incompatible literal reassignment fails at runtime (surfaced as
    // statement 2's runtime-error) and leaves the original binding in force,
    // so the final call computes 4 with the FIRST signature's names — and
    // draws no static diagnostic.
    const src =
      'f := (x: number, y: string) => x + 3\nf := (a: number, b: number) => a * b\nf(x: 1, y: "ok")';
    const { value, diagnostics } = run(src);
    expect(diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['runtime-error', 'incompatible-type'],
    ]);
    expect(value.re).toBe(4);
  });
});

describe('EPSIL EXECUTE — a parameter shadows a same-named outer binding', () => {
  // A function literal's parameter is a fresh local: inside the body, its name
  // denotes the argument, never a same-named binding of the enclosing scope.
  // That was already true in value position but not in OPERATOR position — the
  // call `bump(2)` in a body whose parameter is `bump` resolved to the outer
  // `bump` at canonicalization time, so the literal applied the wrong function
  // and returned a silently wrong number.
  //
  // The parameter names here are deliberately not engine builtins: a builtin
  // name would answer these calls on its own and the probe would prove nothing.

  test('a parameter shadows an outer `const` holding a function', () => {
    const { value, diagnostics } = run(
      [
        'const bump = (x) => x + 1',
        'const applyTwo = (bump) => bump(2)',
        'applyTwo((x) => x * 10)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(20);
  });

  test('a parameter shadows an outer named function definition', () => {
    const { value, diagnostics } = run(
      [
        'bump(x) = x + 1',
        'const applyTwo = (bump) => bump(2)',
        'applyTwo((x) => x * 10)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(20);
  });

  test('a parameter of a named function definition shadows too', () => {
    const { value, diagnostics } = run(
      [
        'const bump = (x) => x + 1',
        'applyTwo(bump) = bump(2)',
        'applyTwo((x) => x * 10)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(20);
  });

  test('an ANNOTATED function-typed parameter shadows too', () => {
    const { value, diagnostics } = run(
      [
        'const bump = (x) => x + 1',
        'const applyTwo = (bump: (number) -> number) => bump(2)',
        'applyTwo((x) => x * 10)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(20);
  });

  test('the shadowed outer binding is intact after the call', () => {
    // Shadowing is confined to the body: the outer `bump` is neither
    // overwritten nor consumed by the call that shadowed it.
    const { value, diagnostics } = run(
      [
        'const bump = (x) => x + 1',
        'const applyTwo = (bump) => bump(2)',
        'let inner = applyTwo((x) => x * 10)',
        'let outer = bump(5)',
        '[inner, outer]',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[20,6]');
  });

  test('a parameter shadows an outer `let` holding a function', () => {
    const { value, diagnostics } = run(
      [
        'let bump = (x) => x + 1',
        'const applyTwo = (bump) => bump(2)',
        'applyTwo((x) => x * 10)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(20);
  });

  test('a parameter shadows an outer non-function `const`', () => {
    const { value, diagnostics } = run(
      ['const offset = 5', 'const wrap = (offset) => offset + 1', 'wrap(10)'].join(
        '\n'
      )
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(11);
  });

  test('an inner parameter shadows an outer parameter of the same name', () => {
    // The inner literal re-binds `bump`, so its `bump(2)` is the inner
    // argument (×100), and the outer `bump` is still the outer argument (×10)
    // where the outer body applies it: 200 + 20.
    const { value, diagnostics } = run(
      [
        'const applyTwo = (bump) => ((bump) => bump(2))((y) => y * 100) + bump(2)',
        'applyTwo((x) => x * 10)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(220);
  });

  test('the compiled path agrees with the interpreter', () => {
    // Same program under `jit: 'auto'`, called enough times to make
    // auto-compilation worthwhile: a compiled call must not answer differently
    // from an interpreted one. (The compiler fails such a call closed and the
    // interpreter runs it; what is asserted here is the ANSWER, not which tier
    // produced it.)
    const ce = new ComputeEngine();
    ce.jit = 'auto';
    const { value, diagnostics } = executeEpsil(
      ce,
      [
        'const bump = (x) => x + 1',
        'const applyTwo = (bump) => bump(2)',
        'let acc = 0',
        'for k in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] { acc = acc + applyTwo((x) => x * 10) }',
        'acc',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(200);
  });
});

describe('EPSIL EXECUTE — literal narrowing at a `character` declaration', () => {
  // Epsil has no character literal, so a one-grapheme-cluster string LITERAL
  // written at a `character`-typed name becomes that character — the same
  // conversion that already happens at a `character` PARAMETER
  // (`docs/STRING_ROADMAP.md`, design constraint 4). A non-literal string does
  // NOT convert, and a multi-cluster literal is still an error.

  test('`let c: character = "a"` runs and binds the character', () => {
    const { value, diagnostics } = run('let c: character = "a"\nc');
    expect(diagnostics).toEqual([]);
    expect(value.type.toString()).toBe('character');
    expect(value.isSame(new ComputeEngine().character('a'))).toBe(true);
    expect(checkSource('let c: character = "a"').diagnostics).toEqual([]);
  });

  test('`const` and a reassignment narrow the same way', () => {
    expect(run('const c: character = "a"\nc').value.type.toString()).toBe(
      'character'
    );
    expect(checkSource('const c: character = "a"').diagnostics).toEqual([]);
    // An ASSIGNMENT to an already-declared `character` name narrows too.
    const { value, diagnostics } = run('let c: character = "a"\nc = "b"\nc');
    expect(diagnostics).toEqual([]);
    expect(value.type.toString()).toBe('character');
    expect(value.isSame(new ComputeEngine().character('b'))).toBe(true);
  });

  test('a one-cluster NON-ASCII literal narrows too', () => {
    // "One character" is one CLUSTER, not one code point: the flag of France
    // is the regional-indicator pair F + R (two astral code points).
    const { value, diagnostics } = run(
      'let c: character = "\u{1F1EB}\u{1F1F7}"\nc'
    );
    expect(diagnostics).toEqual([]);
    expect(value.type.toString()).toBe('character');
  });

  test('a MULTI-cluster literal is still an error, statically and at run time', () => {
    const { diagnostics } = run('let c: character = "ab"\nc');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics)).toContain('incompatible-type');
    const checked = checkSource('let c: character = "ab"').diagnostics;
    expect(checked.length).toBe(1);
    expect(checked[0].severity).toBe('error');
    expect(JSON.stringify(checked[0])).toContain('incompatible-type');
  });

  test('a NON-literal string does not implicitly convert', () => {
    // Only literals narrow; `CharacterFrom(s)` is the explicit conversion.
    const { diagnostics } = run('let s = "a"\nlet c: character = s\nc');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics)).toContain('incompatible-type');
    // The explicit conversion is accepted.
    expect(
      run(
        'let s = "a"\nlet c: character = CharacterFrom(s)\nc'
      ).value.type.toString()
    ).toBe('character');
  });
});

describe('EPSIL CHECK — `CharacterFrom` of a bad literal is a STATIC error', () => {
  // The operand is written in the source, so its cluster count cannot change
  // between canonicalization and evaluation: `CharacterFrom` decides a string
  // LITERAL at canonicalization, which is what lets `epsil check` report it
  // without running the program.

  test('a multi-cluster or empty literal is reported by `epsil check`', () => {
    for (const source of ['CharacterFrom("ab")', 'CharacterFrom("")']) {
      const { diagnostics } = checkSource(source);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].severity).toBe('error');
      expect(JSON.stringify(diagnostics[0])).toContain('incompatible-type');
    }
  });

  test('a one-cluster literal and a non-literal operand are silent', () => {
    expect(checkSource('CharacterFrom("a")').diagnostics).toEqual([]);
    // A symbol operand keeps the call form — its text is not known until the
    // program runs, so there is nothing to report statically.
    expect(checkSource('let s = "ab"\nCharacterFrom(s)').diagnostics).toEqual(
      []
    );
  });
});
