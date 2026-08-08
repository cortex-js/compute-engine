import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Regression tests for the 2026-08-07 "JSON parser" bug cluster: an
// unannotated function parameter used as a collection must ACCUMULATE that
// evidence on the parameter's own binding, so the inferred signature reflects
// the use and the lambda auto-broadcast binds a collection argument WHOLE
// instead of mapping the function over its elements.
//
// Three mechanisms, three fixes:
//
// 1. A parameter referenced from a NESTED Block scope (an `if` branch, a
//    `while` body) auto-declared a fresh shadow binding per scope, so the
//    type evidence inference wrote (`cs[j]` ⇒ indexed collection) landed on a
//    throwaway binding: the literal's parameter stayed `unknown` and the
//    function broadcast. Bare parameters now share ONE cached binding for the
//    whole body canonicalization (the caching annotated parameters already
//    had), and the parameter declaration adopts it
//    (`engine-expression-entrypoints.ts`, `canonicalFunctionLiteralArguments`).
//
// 2. Calls to user functions with INFERRED signatures skip argument
//    validation, which also silenced its narrowing side-channel — so a
//    function that merely forwards its parameter (`g(xs) = f(xs)`) learned
//    nothing. `narrowArgsFromInferredSignature` (box.ts) now propagates a
//    collection-only callee parameter type onto an unknown symbol argument.
//
// 3. `Length`'s parameter is deliberately `any` (Length(5) stays symbolic),
//    so validation contributes no inference; its canonical handler now treats
//    `Length(x)` on a not-yet-typed symbol as collection evidence.
//
// Also covered here: the nullary makeLambda path swept its stale
// canonicalization bindings (a zero-arg function's `while` loop never
// terminated), and the Kleene handling of `boolean | missing` conditions in
// `And`/`Or`/`Not` (a guarded loop condition `j <= n && cs[j] == "a"` was
// rejected at canonicalization with `incompatible-type`).
//

function run(source: string): string {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return r.value?.toString() ?? '<no value>';
}

/** The inferred signature of `f` after executing `source`. */
function signatureOf(source: string, name = 'f'): string {
  const ce = new ComputeEngine();
  executeEpsil(ce, source);
  const def = ce.lookupDefinition(name);
  if (def && 'operator' in def && def.operator)
    return def.operator.signature?.toString() ?? '<none>';
  return '<no definition>';
}

describe('collection evidence reaches the parameter binding', () => {
  test('indexing in an if condition (single nested scope)', () => {
    expect(
      signatureOf('function f(cs) { if cs[1] == "a" { 1 } else { 2 } }')
    ).toMatch(/indexed_collection/);
  });

  test('indexing in a doubly-nested if', () => {
    expect(
      signatureOf(
        'function f(cs) { if 1 < 2 { if cs[1] == "a" { 1 } else { 2 } } else { 0 } }'
      )
    ).toMatch(/indexed_collection/);
  });

  test('indexing in a while condition', () => {
    expect(
      signatureOf(
        'function f(cs) { let j = 1\nwhile cs[j] != "z" { j = j + 1 }\nj }'
      )
    ).toMatch(/indexed_collection/);
  });

  test('Length-only use infers collection', () => {
    expect(signatureOf('function f(cs) { Length(cs) }')).toMatch(/collection/);
  });

  test('forwarding to a collection-consuming callee propagates', () => {
    expect(
      signatureOf('function h(cs) { cs[1] }\nfunction f(xs) { h(xs) }')
    ).toMatch(/indexed_collection/);
  });

  test('a scalar-bodied lambda still infers scalar-friendly (broadcast preserved)', () => {
    // The ratified vectorization default: no collection evidence, parameter
    // stays unknown, and the function maps over a list argument.
    expect(run('f(x) = x * 2\nf([1, 2, 3])')).toBe('[2,4,6]');
  });
});

describe('collection arguments bind whole (no spurious broadcast)', () => {
  test('parameter passed through one frame', () => {
    expect(
      run(
        'function f(cs) { if cs[1] == "a" { "yes" } else { "no" } }\n' +
          'function g(xs) { f(xs) }\n' +
          'g(["a", "b", "c"])'
      )
    ).toBe('"yes"');
  });

  test('lazy collection argument through one frame', () => {
    expect(
      run(
        'function f(cs) { if cs[1] == "a" { "yes" } else { "no" } }\n' +
          'function g(xs) { f(xs) }\n' +
          'g(Characters("abc"))'
      )
    ).toBe('"yes"');
  });

  test('one-step wrapper over a recursive scanner', () => {
    expect(
      run(
        'function scan(cs, i, acc) {\n' +
          '  let c = cs[i]\n' +
          '  if c == "q" { (StringJoin(ListFrom(acc)), i + 1) }\n' +
          '  else { scan(cs, i + 1, Join(acc, [c])) }\n' +
          '}\n' +
          'ps(cs, i) = scan(cs, i + 1, [])\n' +
          'function jp(s) {\n' +
          '  let (v, w) = ps(Characters(s), 1)\n' +
          '  v\n' +
          '}\n' +
          'jp("xhiq")'
      )
    ).toBe('"hi"');
  });

  test('while loop over Length of a parameter', () => {
    expect(
      run(
        'function f(cs) {\n' +
          '  let j = 1\n' +
          '  while j < Length(cs) { j = j + 1 }\n' +
          '  j\n' +
          '}\n' +
          'f(Characters("abc"))'
      )
    ).toBe('3');
  });
});

describe('nullary block functions sweep stale canonicalization bindings', () => {
  test('while loop in a zero-argument function terminates', () => {
    expect(
      run('function f() {\n  let j = 1\n  while j < 3 { j = j + 1 }\n  j\n}\nf()')
    ).toBe('3');
  });
});

describe('Kleene absence in loop conditions', () => {
  test('guarded out-of-range read: And(False, Missing) is False', () => {
    expect(
      run(
        'let cs = Characters("  4")\n' +
          'let j = 1\n' +
          'while j <= Length(cs) && cs[j] == " " { j = j + 1 }\n' +
          'j'
      )
    ).toBe('3');
  });

  test('Not(Missing) is Missing', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Not', 'Missing']).evaluate().symbol).toBe('Missing');
  });

  test('And short-circuits False over a possibly-missing operand', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'And',
      'False',
      ['Equal', ['At', ['List', { str: 'a' }], 5], { str: 'a' }],
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().symbol).toBe('False');
  });
});
