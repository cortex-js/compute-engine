import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Tuple destructuring in a lambda PARAMETER, and as a `for` loop variable.
//
// `((p, q)) => p && q` is a ONE-parameter function whose single argument — a
// pair — is destructured into `p` and `q`; `(p, q) => p && q` remains the
// TWO-parameter function it has always been. The second pair of parentheses is
// the whole difference (Kotlin's design), and the pattern grammar is the one
// `let (a, b) = v` and `match` already use: names, `_` to skip a position, and
// nested patterns.
//
// `for (p, q) in pairs { … }` takes the same pattern.
//
// A shape mismatch at application is an ordinary Error value — the same one
// `let (p, q) = v` produces, since both go through `collectTuplePattern`.
//

/** Run an Epsil program against a fresh engine. */
function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

/** The diagnostic codes a source produces, in order. */
function codes(source: string): string[] {
  const ce = new ComputeEngine();
  const [, diagnostics] = parseEpsil(source, ce as any) as any;
  return (diagnostics ?? []).map((d: any) =>
    Array.isArray(d.message) ? d.message[0] : d.message
  );
}

describe('EPSIL TUPLE PARAMETER DESTRUCTURING — evaluation', () => {
  test('the motivating Map: a pair-consuming predicate', () => {
    const { value, diagnostics } = run(
      '[(true, true), (true, false), (false, true), (false, false)] ' +
        '|> Map(((p, q)) => p && q, _)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('["True","False","False","False"]');
  });

  test('a direct call destructures its single tuple argument', () => {
    const { value, diagnostics } = run('(((p, q)) => p + q)((1, 2))');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3);
  });

  test('a mixed list: one plain parameter, one destructured', () => {
    const { value, diagnostics } = run('((x, (p, q)) => x + p + q)(1, (2, 3))');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });

  test('patterns nest', () => {
    const { value, diagnostics } = run(
      '(((a, (b, c))) => a + b * c)((1, (2, 3)))'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(7);
  });

  test('`_` discards a position', () => {
    const { value, diagnostics } = run('(((p, _)) => p)((7, 8))');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(7);
  });

  test('`(p, q) => …` is still a TWO-parameter function', () => {
    const { value, diagnostics } = run('((p, q) => p + q)(1, 2)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3);
  });

  test('the pattern captures its enclosing scope', () => {
    const { value, diagnostics } = run(
      'let k = 10\nMap(((p, q)) => p + q + k, [(1, 2), (3, 4)])'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[13,17]');
  });

  test('a pattern name shadows an outer binding of the same name', () => {
    const { value, diagnostics } = run('let p = 99\n(((p, q)) => p)((1, 2))');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('Filter over a list of pairs', () => {
    const { value, diagnostics } = run(
      'Filter([(1, 2), (5, 4)], ((p, q)) => p > q)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[(5, 4)]');
  });

  test('a destructuring literal bound to a name applies the same way', () => {
    const { value, diagnostics } = run('let f = ((p, q)) => p + q\nf((3, 4))');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(7);
  });

  test('partial application keeps the unapplied pattern', () => {
    const { value, diagnostics } = run(
      'let g = (x, (p, q)) => x + p + q\nlet h = g(1)\nh((2, 3))'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });
});

describe('EPSIL TUPLE PARAMETER DESTRUCTURING — `for` loops', () => {
  test('`for (p, q) in pairs` binds both names each iteration', () => {
    const { value, diagnostics } = run(
      'let s = 0\nfor (p, q) in [(1, 2), (3, 4)] { s = s + p * q }\ns'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(14);
  });

  test('a nested pattern in a `for` loop variable', () => {
    const { value, diagnostics } = run(
      'let s = 0\nfor (a, (b, c)) in [(1, (2, 3))] { s = a + b + c }\ns'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });

  test('`_` skips a position in a `for` loop variable', () => {
    const { value, diagnostics } = run(
      'let s = 0\nfor (p, _) in [(1, 2), (3, 4)] { s = s + p }\ns'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('an element of the wrong shape stops the loop with the error', () => {
    // FAIL-FAST, not transactional — the same rule the destructuring `let`
    // was pinned to: iterations before the bad element keep their effects.
    const { value, diagnostics } = run(
      'let s = 0\nfor (p, q) in [(1, 2), 5] { s = s + p }\ns'
    );
    expect(diagnostics.map((d) => d.message[0])).toEqual(['runtime-error']);
    expect(diagnostics[0].message[3]).toBe('incompatible-type');
    expect(value.re).toBe(1);
  });

  test('a duplicate name anywhere in the pattern is a diagnostic', () => {
    expect(codes('for (p, p) in [(1, 2)] { p }')).toEqual([
      'unexpected-symbol',
    ]);
  });

  test('a plain `for x in xs` is unchanged', () => {
    const { value, diagnostics } = run(
      'let s = 0\nfor x in [1, 2, 3] { s = s + x }\ns'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });
});

describe('EPSIL TUPLE PARAMETER DESTRUCTURING — diagnostics', () => {
  test('an argument of the wrong arity is a shape-mismatch error value', () => {
    const { value } = run('(((p, q)) => p + q)((1, 2, 3))');
    expect(value.operator).toBe('Error');
    expect(value.toString()).toContain('incompatible-type');
    expect(value.toString()).toContain('tuple<unknown, unknown>');
  });

  test('a non-tuple argument is the same shape-mismatch error value', () => {
    const { value } = run('(((p, q)) => p + q)(5)');
    expect(value.operator).toBe('Error');
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a literal in a pattern position is a binding diagnostic', () => {
    expect(codes('((1, q)) => q')).toEqual(['pattern-binding-expected']);
  });

  test('a per-element type annotation is rejected, once', () => {
    expect(codes('((p: integer, q: integer)) => p + q')).toEqual([
      'pattern-element-annotation',
    ]);
  });

  test('the annotation diagnostic underlines the ANNOTATED element', () => {
    // Only the first element carries a `:` here, so anchoring on the last
    // element of the group would underline `q`, which states no type.
    const source = '((p: integer, q)) => p';
    const ce = new ComputeEngine();
    const [, diagnostics] = parseEpsil(source, ce as any) as any;
    expect(diagnostics.map((d: any) => d.message[0])).toEqual([
      'pattern-element-annotation',
    ]);
    const [from, to] = diagnostics[0].range;
    expect(source.slice(from, to)).toBe('p: integer');
  });

  test('a duplicate name in a pattern is a diagnostic', () => {
    expect(codes('(((p, p)) => p)((1, 2))')).toEqual(['unexpected-symbol']);
  });

  test('a pattern leaf colliding with a plain parameter is a diagnostic', () => {
    expect(codes('(x, (p, x)) => x')).toEqual(['unexpected-symbol']);
  });

  test('a duplicate in a NESTED pattern is a diagnostic', () => {
    expect(codes('((p, (q, p))) => p')).toEqual(['unexpected-symbol']);
  });

  test('distinct pattern names stay diagnostic-free', () => {
    expect(codes('(p, q) => p + q')).toEqual([]);
    expect(codes('((p, q)) => p + q')).toEqual([]);
    expect(codes('((p, _), (q, _)) => p + q')).toEqual([]);
  });

  test('a WHOLE-parameter annotation is unaffected', () => {
    const { value, diagnostics } = run('((x: integer) => x + 1)(4)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });
});

describe('EPSIL TUPLE PARAMETER DESTRUCTURING — serialization', () => {
  const roundTrip = (source: string): string => {
    const ce = new ComputeEngine();
    const [expr] = parseEpsil(source, ce as any) as any;
    return serializeEpsil(expr);
  };

  test('a destructuring lambda serializes with the doubled parentheses', () => {
    expect(roundTrip('((p, q)) => p && q')).toBe('((p, q)) => p && q');
  });

  test('mixed and nested patterns serialize', () => {
    expect(roundTrip('(x, (p, q)) => x + p + q')).toBe(
      '(x, (p, q)) => x + p + q'
    );
    expect(roundTrip('((a, (b, c))) => a + b + c')).toBe(
      '((a, (b, c))) => a + b + c'
    );
  });

  test('the serialized form re-parses to the same source', () => {
    for (const source of [
      '((p, q)) => p && q',
      '(x, (p, q)) => x + p + q',
      'Map(((p, q)) => p + q, xs)',
      'for (p, q) in xs { p + q }',
    ]) {
      const once = roundTrip(source);
      expect(roundTrip(once)).toBe(once);
    }
  });

  test('ASCII-math renders the doubled parentheses', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'p', 'q'], ['Tuple', 'p', 'q']]);
    expect(f.toString()).toBe('((p, q)) => p + q');
  });
});

describe('TUPLE PARAMETER DESTRUCTURING — engine routes', () => {
  test('the box route builds the same literal the parse route does', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'p', 'q'], ['Tuple', 'p', 'q']]);
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Add', 'p', 'q']],
      ['Tuple', 'p', 'q'],
    ]);
    expect(ce.box(['Apply', f, ['Tuple', 1, 2]]).evaluate().re).toBe(3);
  });

  test('the ce.function route applies pre-boxed arguments', () => {
    const ce = new ComputeEngine();
    const f = ce.function('Function', [
      ce.box(['Add', 'p', 'q'], { form: 'raw' }),
      ce.box(['Tuple', 'p', 'q'], { form: 'raw' }),
    ]);
    expect(
      ce.function('Apply', [f, ce.box(['Tuple', 4, 5])]).evaluate().re
    ).toBe(9);
  });

  test('the pattern leaves are BOUND, not free', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'p', 'q'], ['Tuple', 'p', 'q']]);
    expect(f.unknowns).toEqual([]);
    expect(f.freeVariables).toEqual([]);
  });

  test('the parameter slot states the tuple shape it will match', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'p', 'q'], ['Tuple', 'p', 'q']]);
    expect(f.type.toString()).toBe('(tuple<unknown, unknown>) -> number');
  });

  test('compilation fails CLOSED rather than emitting a wrong lambda', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<tuple<number, number>>');
    const f = ce.box(['Function', ['Add', 'p', 'q'], ['Tuple', 'p', 'q']]);
    // The compile route swallows the throw and falls back; what matters is
    // that no code is emitted for the destructuring lambda.
    expect(compile(ce.box(['Map', f, 'xs']))?.code ?? '').toBe('');
  });
});
