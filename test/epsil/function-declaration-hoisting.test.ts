import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isString } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

//
// A `function` statement (`DefineFunction` with a `Function` literal) is
// available in its whole statement list, before the first statement runs, on
// every route. The Epsil runner boxes one statement at a time, so it installs
// the `function` statements of the program before the statement loop
// (`prepareFunctionDeclarations()`, `src/epsil/execute-epsil.ts`); the
// whole-block interpreter installs them when the block is canonicalized, and
// the compiler moves them to the front of the statement list. Which
// statements are declarations is the shared rule
// `isHoistedFunctionDefinition()` (`library/control-structures.ts`).
//
// The probe `let a = String(g(3))` stores the result of the call as a
// string, which is a value and is never resolved again, so the test sees
// whether the call resolved when its statement ran.
//
// Provenance: `docs/plans/2026-10-21-function-declaration-hoisting.md`,
// section B.
//

/** The value of `v` as JSON, with each string replaced by its content. */
function plain(v: Expression): unknown {
  if (isString(v)) return v.string;
  if (v.operator === 'List' && v.ops) return v.ops.map((op) => plain(op));
  return v.json;
}

/** Run `source` with the Epsil runner, in a new engine. */
function epsil(source: string): { value: unknown; diagnostics: string[] } {
  const ce = new ComputeEngine();
  const { value, diagnostics } = executeEpsil(ce, source);
  return {
    value: plain(value),
    diagnostics: diagnostics.map((d) => d.message.map(String).join(' ')),
  };
}

/** Evaluate `source` as one block (the whole-block interpreter), in a new
 * engine. */
function block(source: string): unknown {
  const ce = new ComputeEngine();
  return plain(ce.box(parseEpsil(source)[0] as never).evaluate());
}

const SCOPE_ERROR =
  'writes outside a function require a declared `scope` effect';

describe('A CALL BEFORE A FUNCTION STATEMENT RESOLVES WHEN ITS STATEMENT RUNS', () => {
  test('a single clause', () => {
    // Before: the Epsil runner answered "g(3)".
    const src = 'let a = String(g(3))\nfunction g(k) { k^2 }\na';
    expect(epsil(src)).toEqual({ value: '9', diagnostics: [] });
    expect(block(src)).toEqual('9');
  });

  test('a multi-clause definition, called before both clauses', () => {
    // Before: the Epsil runner answered ["foo(0)", "foo(4)"].
    const src =
      'let a = String(foo(0))\nlet b = String(foo(4))\nfoo(0) = 1\nfoo(n: integer) = n + 1\n[a, b]';
    expect(epsil(src)).toEqual({ value: ['1', '5'], diagnostics: [] });
    expect(block(src)).toEqual(['1', '5']);
  });

  test('a recursive multi-clause definition', () => {
    // Before: the Epsil runner answered "fact(5)".
    const src =
      'let a = String(fact(5))\nfact(0) = 1\nfact(n: integer) = n * fact(n - 1)\na';
    expect(epsil(src)).toEqual({ value: '120', diagnostics: [] });
    expect(block(src)).toEqual('120');
  });

  test('a function that a prepared function calls is prepared too', () => {
    // `g` is not called before its definition, but `f` is, and `f` calls
    // `g`. Before: the Epsil runner answered "f()".
    const src =
      'let a = String(f())\nfunction g() { 7 }\nfunction f() { g() }\na';
    expect(epsil(src)).toEqual({ value: '7', diagnostics: [] });
    expect(block(src)).toEqual('7');
  });

  test('a hold function', () => {
    // Before: the Epsil runner answered "f(q + 1)".
    const src = 'let a = String(f(q + 1))\nhold f(e) = Head(e)\na';
    expect(epsil(src)).toEqual({ value: '"Add"', diagnostics: [] });
    expect(block(src)).toEqual('"Add"');
  });
});

describe('THE DECLARED SIGNATURE IS KEPT', () => {
  test('a call outside the declared signature is still an error', () => {
    const { value, diagnostics } = epsil(
      'let g: (integer) -> integer\nfunction g(k) { 2 * k }\ng(1.5)'
    );
    expect(JSON.stringify(value)).toContain('incompatible-type');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('static-type-error');
    expect(diagnostics[0]).toContain('incompatible-type');
  });

  test('a call in the declared signature', () => {
    const src = 'let g: (integer) -> integer\nfunction g(k) { 2 * k }\ng(2)';
    expect(epsil(src)).toEqual({ value: 4, diagnostics: [] });
    expect(block(src)).toEqual(4);
  });

  test('a call before both statements', () => {
    // Before: the Epsil runner answered "g(2)".
    const src =
      'let a = String(g(2))\nlet g: (integer) -> integer\nfunction g(k) { 2 * k }\na';
    expect(epsil(src)).toEqual({ value: '4', diagnostics: [] });
    expect(block(src)).toEqual('4');
  });

  test('the declared signature does not apply before its `let` runs', () => {
    // The same answer as the block route. Before: the Epsil runner answered
    // "g(1.5)".
    const src =
      'let a = String(g(1.5))\nlet g: (integer) -> integer\nfunction g(k) { 2 * k }\na';
    expect(epsil(src)).toEqual({ value: '3', diagnostics: [] });
    expect(block(src)).toEqual('3');
  });
});

describe('THE BINDINGS OF EARLIER STATEMENTS ARE KEPT', () => {
  test('a body reads a variable that an earlier `let` declares', () => {
    const src = 'let c = 5\nfunction g(k) { c * k }\ng(2)';
    expect(epsil(src)).toEqual({ value: 10, diagnostics: [] });
    expect(block(src)).toEqual(10);
  });

  test('a body reads a variable that an earlier assignment makes', () => {
    const src = 'c = 5\nfunction g(k) { c * k }\ng(2)';
    expect(epsil(src)).toEqual({ value: 10, diagnostics: [] });
    expect(block(src)).toEqual(10);
  });

  test('a call between the `let` and the function statement', () => {
    // Before: the Epsil runner answered "g(2)" for both programs.
    for (const src of [
      'let c = 5\nlet a = String(g(2))\nfunction g(k) { c * k }\na',
      'c = 5\nlet a = String(g(2))\nfunction g(k) { c * k }\na',
    ]) {
      expect(epsil(src)).toEqual({ value: '10', diagnostics: [] });
      expect(block(src)).toEqual('10');
    }
  });

  test('a write to an earlier `let` stays a `scope` write', () => {
    for (const src of [
      'let t = 0\nfunction g(k) { t = k + 1; t }\n[g(1), t]',
      't = 3\nfunction g(k) { t = k + 1; t }\n[g(1), t]',
    ]) {
      const { diagnostics } = epsil(src);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain('runtime-error');
      expect(diagnostics[0]).toContain(SCOPE_ERROR);
    }
  });

  test('a write to an earlier `let` with the `scope` specifier', () => {
    const src = 'let t = 0\nfunction g(k) scope { t = k + 1; t }\n[g(1), t]';
    expect(epsil(src)).toEqual({ value: [2, 2], diagnostics: [] });
    expect(block(src)).toEqual([2, 2]);
  });

  test('a call before the function statement, with a `scope` write', () => {
    // Without `scope`, the function is refused, the call stays unresolved
    // and the error is the same as before.
    for (const src of [
      'let a = String(g(1))\nlet t = 0\nfunction g(k) { t = k + 1; t }\n[a, t]',
      'let t = 0\nlet a = String(g(1))\nfunction g(k) { t = k + 1; t }\n[a, t]',
      't = 3\nlet a = String(g(1))\nfunction g(k) { t = k + 1; t }\n[a, t]',
    ]) {
      const { value, diagnostics } = epsil(src);
      expect((value as unknown[])[0]).toBe('g(1)');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain(SCOPE_ERROR);
    }
    // With `scope`, the call writes `t`. Before: the Epsil runner answered
    // ["g(1)", 0].
    const src =
      'let t = 0\nlet a = String(g(1))\nfunction g(k) scope { t = k + 1; t }\n[a, t]';
    expect(epsil(src)).toEqual({ value: ['2', 2], diagnostics: [] });
    expect(block(src)).toEqual(['2', 2]);
  });

  test('a write in a function before the `let` of the name makes a local', () => {
    // The preparation of `g` declares `t`, which `let t = 0` declares before
    // `g`. The function `f` comes before that `let`: its assignment to `t`
    // makes a local of `f`, as when the program runs in order. Before the
    // fix, `f` was refused because it does not declare the `scope` effect,
    // and the value was [f(), 0].
    const src =
      'function f() { t = 1; t }\nlet a = String(g())\nlet t = 0\nfunction g() { 5 }\n[f(), t]';
    expect(epsil(src)).toEqual({ value: [1, 0], diagnostics: [] });
    expect(block(src)).toEqual([1, 0]);
    // A read of `t` before its `let` gives the symbol.
    expect(
      epsil(
        'function f() { t = 1; t }\nlet b = String(t)\nlet a = String(g())\nlet t = 0\nfunction g() { 5 }\n[f(), t, b]'
      )
    ).toEqual({ value: [1, 0, 't'], diagnostics: [] });
  });

  test('a `scope` write in a function before the `let` of the name', () => {
    // With the `scope` effect, an assignment to a name that no statement
    // before the function declares still makes a local of the function.
    // Before the fix, the Epsil runner answered [1, 1].
    const src =
      'function f() scope { t = 1; t }\nlet a = String(g())\nlet t = 0\nfunction g() { 5 }\n[f(), t]';
    expect(epsil(src)).toEqual({ value: [1, 0], diagnostics: [] });
    expect(block(src)).toEqual([1, 0]);
  });

  test('a `scope` write in a function after the `let` of the name', () => {
    const src =
      'let t = 0\nfunction f() scope { t = 1; t }\nlet a = String(g())\nfunction g() { 5 }\n[f(), t, a]';
    expect(epsil(src)).toEqual({ value: [1, 1, '5'], diagnostics: [] });
    expect(block(src)).toEqual([1, 1, '5']);
  });
});

describe('THE NAMES THAT A FUNCTION BINDS FOR ITS BODY', () => {
  test('a parameter with the name of an earlier variable with no static type', () => {
    // `k` in the body is the parameter, not the earlier dictionary-valued
    // `k`, so the function is prepared.
    const src =
      'let k = {I -> 1}\nlet a = String(g(3))\nfunction g(k) { k^2 }\na';
    expect(epsil(src)).toEqual({ value: '9', diagnostics: [] });
    expect(block(src)).toEqual('9');
  });

  test('a local `let` with the name of an earlier variable', () => {
    const src =
      'let k = {I -> 1}\nlet a = String(g(3))\nfunction g(x) { let k = 2 * x; k^2 }\na';
    expect(epsil(src)).toEqual({ value: '36', diagnostics: [] });
    expect(block(src)).toEqual('36');
  });
});

describe('A LIBRARY CONSTANT AND A VARIABLE OF THE SAME NAME', () => {
  test('a body reads the variable that an earlier `let` declares', () => {
    const src = 'let i = 2\nfunction g() { i^2 }\n[g(), i^2]';
    expect(epsil(src)).toEqual({ value: [4, 4], diagnostics: [] });
    expect(block(src)).toEqual([4, 4]);
  });

  test('a statement before the `let` reads the constant', () => {
    const src = 'let a = i^2\nlet i = 2\nfunction g() { i^2 }\n[a, i^2, g()]';
    expect(epsil(src)).toEqual({ value: [-1, 4, 4], diagnostics: [] });
    expect(block(src)).toEqual([-1, 4, 4]);
  });

  test('a body before the `let` reads the constant', () => {
    const src = 'function g() { i^2 }\nlet i = 2\n[g(), i^2]';
    expect(epsil(src)).toEqual({ value: [-1, 4], diagnostics: [] });
    expect(block(src)).toEqual([-1, 4]);
  });

  // In the two programs below, a call before the `function` statement makes
  // the preparation declare `i` for the body and then remove that binding
  // again, so that a statement before the `let` reads the constant.
  test('a call after the `let` of a constant prepares the function', () => {
    const src =
      'let a = i^2\nlet i = 2\nlet b = g()\nfunction g() { i^2 }\n[a, b, g()]';
    expect(epsil(src)).toEqual({ value: [-1, 4, 4], diagnostics: [] });
  });

  test('a call before the `let` of a constant reads the constant', () => {
    const src = 'let a = g()\nlet i = 2\nfunction g() { i^2 }\n[a, g()]';
    expect(epsil(src)).toEqual({ value: [-1, 4], diagnostics: [] });
  });
});

describe('A HOST BINDING AND A VARIABLE OF THE SAME NAME', () => {
  // The host binds `c` in a scope around the program scope. The program
  // declares its own `c` later. A statement before that `let` reads the
  // host binding, as when the program runs in order; the body of the
  // prepared function reads the variable of the program once its `let` has
  // run.
  function withHostBinding(source: string): unknown {
    const ce = new ComputeEngine();
    ce.declare('c', 'integer');
    ce.assign('c', 10);
    ce.pushScope();
    return plain(executeEpsil(ce, source).value);
  }

  test('a statement before the `let` reads the host binding', () => {
    // In order (no call before the function statement), `a` is "10".
    expect(
      withHostBinding(
        'let a = String(c)\nlet c = 2\nfunction g() { c^2 }\n[a, g()]'
      )
    ).toEqual(['10', 4]);
    // With a call before the function statement, the function is prepared,
    // and the statement before the `let` still reads the host binding.
    // Before: `a` was "c", the valueless variable that the preparation
    // declared.
    expect(
      withHostBinding(
        'let a = String(c)\nlet c = 2\nlet b = String(g())\nfunction g() { c^2 }\n[a, b, g()]'
      )
    ).toEqual(['10', '4', 4]);
  });

  test('a call before the `let` reads the host binding in the body', () => {
    // As for a library constant (above), the top level of the runner has no
    // binding that is declared and not yet initialized.
    expect(
      withHostBinding(
        'let a = String(g())\nlet c = 2\nfunction g() { c^2 }\n[a, g()]'
      )
    ).toEqual(['100', 4]);
  });
});

describe('STATEMENTS THAT ARE NOT HOISTED', () => {
  test('the constructor of a nominal type runs after its type statement', () => {
    // The same answer as before: the call before the `type` statement stays
    // unresolved.
    const { value, diagnostics } = epsil(
      'let p = String(point(7))\ntype point = tuple<integer, integer>\nfunction point(a: integer) { (a, a) }\nlet q = point(7)\n[p, String(q), String(Type(q))]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['point(7)', 'point(7, 7)', 'point']);
  });

  test('the constructor of a variant of a sum type', () => {
    // The same answer as before.
    const { value, diagnostics } = epsil(
      'let p = String(jnum(3, 4))\ntype json = jbool(boolean) | jnum(number)\nfunction jnum(a: integer, b: integer) { a + b }\n[p, String(jnum(3, 4))]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['jnum(3, 4)', 'jnum(7)']);
  });

  test('a function statement for a name that holds a value keeps its error', () => {
    // The same value and diagnostic as before.
    const { value, diagnostics } = epsil('let g = 5\nfunction g(k) { k }\ng');
    expect(value).toBe(5);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('runtime-error');
    expect(diagnostics[0]).toContain('invalid-clause-definition');
  });

  test('a function statement for a name that an earlier assignment writes', () => {
    // The definition adds a clause to the function that the assignment
    // installs, so it runs in order. The same answer as before.
    const { value, diagnostics } = epsil(
      'let a = String(g(2))\ng = (k: integer) => 10 * k\nfunction g(k: string) { k }\n[a, String(g(2)), g("s")]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['g(2)', '20', 's']);
  });

  test('a function statement after a type statement', () => {
    // Its annotations can name the type, which does not exist before the
    // type statement runs, so it runs in order. The same answer as before.
    const { value, diagnostics } = epsil(
      'type alias num = number\nlet a = String(g(3))\nfunction g(k: num) { k^2 }\n[a, String(g(3))]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['g(3)', '9']);
    // Without the `String(…)` probe, `a` holds the unresolved `g(3)`, and
    // the read of `a` in the last statement, a later top-level evaluation,
    // resolves it.
    expect(
      epsil(
        'type alias num = number\nlet a = g(3)\nfunction g(k: num) { k^2 }\na'
      )
    ).toEqual({ value: 9, diagnostics: [] });
  });

  test('a function that uses an earlier variable with no static type', () => {
    // The value of `value` is a dictionary, whose type is not read
    // statically. Canonicalized before the `let` runs, the body would narrow
    // `value` to a string, and the function would be refused. So the
    // statement runs in order: the same answer as before, where the block
    // route answers "14".
    const src =
      'let value = {I -> 1, V -> 5, X -> 10}\nlet r = String(decode("XIV"))\ndecode(s) = do {\n  let vs = map(c => value[String(c)], characters(s))\n  let n = length(vs)\n  sum(map(i => -vs[i] if i < n && vs[i] < vs[i + 1] else vs[i], 1..n))\n}\n[r, String(decode("XIV"))]';
    expect(epsil(src)).toEqual({
      value: ['decode("XIV")', '14'],
      diagnostics: [],
    });
    // Without the probe, the read of `r` in the last statement resolves the
    // stored call.
    expect(
      epsil(
        'let value = {I -> 1, V -> 5, X -> 10}\nlet r = decode("XIV")\ndecode(s) = do {\n  let vs = map(c => value[String(c)], characters(s))\n  let n = length(vs)\n  sum(map(i => -vs[i] if i < n && vs[i] < vs[i + 1] else vs[i], 1..n))\n}\n[r, decode("XIV")]'
      )
    ).toEqual({ value: [14, 14], diagnostics: [] });
  });

  test('a body that reads an earlier dictionary-valued variable', () => {
    // The same exclusion as above, for a body that reads a dictionary.
    const probed =
      'let v = {I -> 1}\nlet a = String(g(3))\nfunction g(k) { v["I"] + k }\na';
    expect(epsil(probed)).toEqual({ value: 'g(3)', diagnostics: [] });
    expect(block(probed)).toEqual('4');
    const src =
      'let v = {I -> 1}\nlet a = g(3)\nfunction g(k) { v["I"] + k }\na';
    expect(epsil(src)).toEqual({ value: 4, diagnostics: [] });
    expect(block(src)).toEqual(4);
  });

  test('a body that uses a variable that two earlier statements write', () => {
    // The preparation can give `c` one type only. With the `string` type of
    // the `let`, the body `c^2` was boxed with an `incompatible-type` error
    // that the prepared statement kept, where in order `c^2` is boxed after
    // `c = 2`. So the statement runs in order.
    const src =
      'let c = "old"\nc = 2\nlet a = String(g())\nfunction g() { c^2 }\n[a, g()]';
    expect(epsil(src)).toEqual({ value: ['g()', 4], diagnostics: [] });
  });

  test('an earlier assignment of a literal gives its type to the body', () => {
    // The preparation declares `c` with the type of the assigned literal,
    // as the assignment does when it runs, so the body `c^2` is refused as
    // it is in order. Before: `c` was declared `unknown`, the body narrowed
    // it to a number, and the program reported errors at other places.
    const { value, diagnostics } = epsil(
      'c = "s"\nlet a = String(g())\nfunction g() { c^2 }\n[a, g()]'
    );
    expect((value as unknown[])[0]).toBe('g()');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toContain('static-type-error');
    expect(diagnostics[1]).toContain('in DefineFunction argument 2');
    expect(diagnostics[1]).toContain('incompatible-type');
  });

  test('a body that uses a variable that an earlier program declared', () => {
    // The program scope binds `c` from the first run. In order, the `let`
    // of the second program declares `c` again before the function
    // statement runs; the preparation boxed the body against the string
    // binding of the first run. So the statement runs in order.
    const ce = new ComputeEngine();
    const first = executeEpsil(ce, 'let c = "old"\nc');
    expect(plain(first.value)).toBe('old');
    const { value, diagnostics } = executeEpsil(
      ce,
      'let c = 2\nlet a = String(g())\nfunction g() { c^2 }\n[a, g()]'
    );
    expect(plain(value)).toEqual(['g()', 4]);
    expect(diagnostics).toEqual([]);
  });

  test('a body that calls a lambda bound by an earlier `let`', () => {
    // The value of `h` is a function literal, which has no static type in
    // the sense of the selection, so `g` runs in order.
    const probed =
      'let h = (x) => 3 * x\nlet a = String(g(2))\nfunction g(k) { h(k) }\na';
    expect(epsil(probed)).toEqual({ value: 'g(2)', diagnostics: [] });
    expect(block(probed)).toEqual('6');
    const src = 'let h = (x) => 3 * x\nlet a = g(2)\nfunction g(k) { h(k) }\na';
    expect(epsil(src)).toEqual({ value: 6, diagnostics: [] });
    expect(block(src)).toEqual(6);
  });

  test('a generic function', () => {
    // The `DefineFunction` canonical handler installs no generic clause at
    // canonicalization, so a generic function takes effect when its
    // statement runs, on both routes.
    const probed = 'let a = String(f(3))\nfunction f<T>(x: T) -> T { x }\na';
    expect(epsil(probed)).toEqual({ value: 'f(3)', diagnostics: [] });
    expect(block(probed)).toEqual('f(3)');
    const src = 'let a = f(3)\nfunction f<T>(x: T) -> T { x }\na';
    expect(epsil(src)).toEqual({ value: 3, diagnostics: [] });
    expect(block(src)).toEqual(3);
  });

  test('an ordinary clause after a generic function of the same name', () => {
    // The clauses of a name are prepared together or not at all. The
    // generic definition is not prepared, so the later ordinary clause is
    // not prepared either. In written order, the generic definition is
    // installed first, `a` is `f(3) = 3`, and the later clause is refused
    // (a generic function has one clause). With the ordinary clause
    // installed ahead, `a` was `6` and the generic definition was refused.
    const src =
      'function f<T>(x: T) -> T { x }\nlet a = f(3)\nfunction f(x: integer) { 2*x }\na';
    const { value, diagnostics } = epsil(src);
    expect(value).toEqual(3);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('generic-clause-unsupported');
    // The whole-block route refuses the same statement: a block stops at the
    // error of its third statement.
    expect(JSON.stringify(block(src))).toContain('generic-clause-unsupported');
  });

  test('an assignment of a function literal takes effect when it runs', () => {
    const src = 'let a = String(g(3))\ng = (k) => k^2\na';
    expect(epsil(src)).toEqual({ value: 'g(3)', diagnostics: [] });
    expect(block(src)).toEqual('g(3)');
  });
});

describe('THE COMPILER', () => {
  test('a call before a function statement', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      parseEpsil('let a = g(3)\nfunction g(k) { k^2 }\na')[0] as never
    );
    const result = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never)!;
    expect(result.success).toBe(true);
    expect(result.run!({} as never)).toBe(9);
  });
});
