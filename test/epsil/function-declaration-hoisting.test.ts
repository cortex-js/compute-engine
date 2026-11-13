import { ComputeEngine } from '../../src/compute-engine';
import {
  executeEpsil,
  executeEpsilAsync,
} from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isString } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';
import type { Type } from '../../src/common/type/types';

//
// A `function` statement (`DefineFunction` with a `Function` literal) at the
// top level of an Epsil program defines a function of the engine, available
// in the whole program, before the first statement runs. The Epsil runner
// boxes one statement at a time, so it installs the `function` statements of
// the program before the statement loop (`prepareFunctionDeclarations()`,
// `src/epsil/execute-epsil.ts`).
//
// The same program boxed as one block (`block()`) is not the top level of a
// program: there a function statement declares a local, a variable that has
// its value when the statement runs, so a call before it is the error
// `read-before-declaration` (`blockErrors()`).
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

/** The codes of the static errors of `source` boxed as one block. In a
 * block, a function statement declares a variable: a call before it is a
 * read before the declaration, and a `let` or a second function statement of
 * the same name is a second declaration. */
function blockErrors(source: string): string[] {
  const json = JSON.stringify(
    new ComputeEngine().box(parseEpsil(source)[0] as never).json
  );
  return [...json.matchAll(/"ErrorCode","'([a-z-]+)'"/g)].map((m) => m[1]);
}

const SCOPE_ERROR =
  'writes outside a function require a declared `scope` effect';

describe('A CALL BEFORE A FUNCTION STATEMENT RESOLVES WHEN ITS STATEMENT RUNS', () => {
  test('a single clause', () => {
    // Before: the Epsil runner answered "g(3)".
    const src = 'let a = String(g(3))\nfunction g(k) { k^2 }\na';
    expect(epsil(src)).toEqual({ value: '9', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('a multi-clause definition, called before both clauses', () => {
    // Before: the Epsil runner answered ["foo(0)", "foo(4)"].
    const src =
      'let a = String(foo(0))\nlet b = String(foo(4))\nfoo(0) = 1\nfoo(n: integer) = n + 1\n[a, b]';
    expect(epsil(src)).toEqual({ value: ['1', '5'], diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('a recursive multi-clause definition', () => {
    // Before: the Epsil runner answered "fact(5)".
    const src =
      'let a = String(fact(5))\nfact(0) = 1\nfact(n: integer) = n * fact(n - 1)\na';
    expect(epsil(src)).toEqual({ value: '120', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('a function that a prepared function calls is prepared too', () => {
    // `g` is not called before its definition, but `f` is, and `f` calls
    // `g`. Before: the Epsil runner answered "f()".
    const src =
      'let a = String(f())\nfunction g() { 7 }\nfunction f() { g() }\na';
    expect(epsil(src)).toEqual({ value: '7', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('a hold function', () => {
    // Before: the Epsil runner answered "f(q + 1)".
    const src = 'let a = String(f(q + 1))\nhold f(e) = Head(e)\na';
    expect(epsil(src)).toEqual({ value: '"Add"', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
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
    expect(blockErrors(src)).toContain('variable-redeclaration');
  });

  test('a call before both statements', () => {
    // Before: the Epsil runner answered "g(2)".
    const src =
      'let a = String(g(2))\nlet g: (integer) -> integer\nfunction g(k) { 2 * k }\na';
    expect(epsil(src)).toEqual({ value: '4', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('the declared signature does not apply before its `let` runs', () => {
    // The same answer as the block route. Before: the Epsil runner answered
    // "g(1.5)".
    const src =
      'let a = String(g(1.5))\nlet g: (integer) -> integer\nfunction g(k) { 2 * k }\na';
    expect(epsil(src)).toEqual({ value: '3', diagnostics: [] });
    expect(blockErrors(src)).toContain('variable-redeclaration');
  });
});

describe('THE BINDINGS OF EARLIER STATEMENTS ARE KEPT', () => {
  test('a body reads a variable that an earlier `let` declares', () => {
    const src = 'let c = 5\nfunction g(k) { c * k }\ng(2)';
    expect(epsil(src)).toEqual({ value: 10, diagnostics: [] });
    expect(block(src)).toEqual(10);
  });

  test('an earlier assignment with no `let` does not declare the variable', () => {
    // A variable of the top level of a program is introduced by `let`.
    const src = 'c = 5\nfunction g(k) { c * k }\ng(2)';
    const { value, diagnostics } = epsil(src);
    expect(value).toEqual(['Multiply', 2, 'c']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('assignment-to-undeclared-variable');
    expect(JSON.stringify(block(src))).toContain(
      "'assignment-to-undeclared-variable'"
    );
  });

  test('a call between the `let` and the function statement', () => {
    // Before: the Epsil runner answered "g(2)".
    const src = 'let c = 5\nlet a = String(g(2))\nfunction g(k) { c * k }\na';
    expect(epsil(src)).toEqual({ value: '10', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('a write to an earlier `let` stays a `scope` write', () => {
    const { diagnostics } = epsil(
      'let t = 0\nfunction g(k) { t = k + 1; t }\n[g(1), t]'
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('runtime-error');
    expect(diagnostics[0]).toContain(SCOPE_ERROR);
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
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  // In a program, a function can assign a variable only if the `let` of the
  // variable comes before the function: the statements are read one at a
  // time, and an assignment never declares a name. A `Block` evaluated as a
  // whole declares its locals for the whole block, so there `f` writes the
  // `t` of the block.
  test('a write in a function before the `let` of the name is an error', () => {
    const src =
      'function f() { t = 1; t }\nlet a = String(g())\nlet t = 0\nfunction g() { 5 }\n[f(), t]';
    expect(epsil(src).diagnostics[0]).toContain(
      'assignment-to-undeclared-variable'
    );
    // In the block, the write to the `t` of the block is the `scope` effect,
    // which `f` does not declare.
    expect(blockErrors(src)).toContain('read-before-declaration');
    // A read of `t` before its `let` is an error too.
    const read =
      'function f() { t = 1; t }\nlet b = String(t)\nlet a = String(g())\nlet t = 0\nfunction g() { 5 }\n[f(), t, b]';
    const { diagnostics } = epsil(read);
    expect(diagnostics[0]).toContain('assignment-to-undeclared-variable');
    expect(diagnostics[1]).toContain('read-before-declaration');
    expect(JSON.stringify(block(read))).toContain('read-before-declaration');
  });

  test('a `scope` write in a function before the `let` of the name is an error', () => {
    const src =
      'function f() scope { t = 1; t }\nlet a = String(g())\nlet t = 0\nfunction g() { 5 }\n[f(), t]';
    expect(epsil(src).diagnostics).toHaveLength(1);
    expect(epsil(src).diagnostics[0]).toContain(
      'assignment-to-undeclared-variable'
    );
    expect(blockErrors(src)).toContain('read-before-declaration');
    const late = 'function g(k) scope { t = k + 1; t }\nlet t = 0\n[g(1), t]';
    expect(epsil(late).diagnostics).toHaveLength(1);
    expect(epsil(late).diagnostics[0]).toContain(
      'assignment-to-undeclared-variable'
    );
    expect(block(late)).toEqual([2, 2]);
  });

  test('a `scope` write in a function after the `let` of the name', () => {
    const src =
      'let t = 0\nfunction f() scope { t = 1; t }\nlet a = String(g())\nfunction g() { 5 }\n[f(), t, a]';
    expect(epsil(src)).toEqual({ value: [1, 1, '5'], diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });
});

describe('THE NAMES THAT A FUNCTION BINDS FOR ITS BODY', () => {
  test('a parameter with the name of an earlier variable with no static type', () => {
    // `k` in the body is the parameter, not the earlier dictionary-valued
    // `k`, so the function is prepared.
    const src =
      'let k = {I -> 1}\nlet a = String(g(3))\nfunction g(k) { k^2 }\na';
    expect(epsil(src)).toEqual({ value: '9', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('a local `let` with the name of an earlier variable', () => {
    const src =
      'let k = {I -> 1}\nlet a = String(g(3))\nfunction g(x) { let k = 2 * x; k^2 }\na';
    expect(epsil(src)).toEqual({ value: '36', diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
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
  // declares its own `c` later. The top level of a program is a block, so a
  // statement before that `let` is a use of the variable before its
  // declaration; the body of a prepared function reads the variable of the
  // program once its `let` has run.
  function withHostBinding(source: string): unknown {
    const ce = new ComputeEngine();
    ce.declare('c', 'integer');
    ce.assign('c', 10);
    ce.pushScope();
    return plain(executeEpsil(ce, source).value);
  }

  test('a statement before the `let` is a use before the declaration', () => {
    // With a call before the function statement too, where the function is
    // prepared.
    for (const source of [
      'let a = String(c)\nlet c = 2\nfunction g() { c^2 }\n[a, g()]',
      'let a = String(c)\nlet c = 2\nlet b = String(g())\nfunction g() { c^2 }\n[a, b, g()]',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('c', 'integer');
      ce.assign('c', 10);
      ce.pushScope();
      expect(
        executeEpsil(ce, source).diagnostics.map((d) => d.message[3])
      ).toEqual(['read-before-declaration']);
    }
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

describe('THE SIGNATURE OF A PREPARED FUNCTION HOLDS A CALL BEFORE THE `let`', () => {
  // A call of a prepared function before the `let` of a name that an
  // enclosing scope defines reads the outer definition in the body (the
  // tests above). The signature that the body infers must hold the value of
  // that call, so the binding that the preparation gives the body has the
  // union of the two types. The host operator `Snap` reads the signature of
  // `g` when its statement runs, before the `function` statement runs and
  // installs `g` again with the binding of the `let`.
  //
  // Provenance: ROADMAP entry CE-480.
  function run(
    source: string,
    host?: (ce: ComputeEngine) => void
  ): { value: Expression; result: string; matches: boolean } {
    const ce = new ComputeEngine();
    host?.(ce);
    let signature: string | undefined = undefined;
    let resultType: Type | undefined = undefined;
    ce.declare('Snap', {
      signature: '() -> integer',
      evaluate: (_ops, { engine }) => {
        const def = engine.lookupDefinition('g');
        if (def !== undefined && 'operator' in def) {
          signature = def.operator.signature.toString();
          const t = def.operator.signature.type;
          if (typeof t === 'object' && t.kind === 'signature')
            resultType = t.result;
        }
        return engine.number(0);
      },
    });
    const { value, diagnostics } = executeEpsil(ce, source);
    expect(diagnostics).toEqual([]);
    expect(resultType).toBeDefined();
    return {
      value,
      result: signature!,
      matches: value.type.matches(ce.type(resultType!)),
    };
  }

  test('a body that squares the constant `i`', () => {
    // Before: the signature was `() -> integer<0..>`, and the value `-1`.
    const r = run('let a = g()\nSnap()\nlet i = 2\nfunction g() { i^2 }\na');
    expect(r.value.json).toEqual(-1);
    expect(r.result).toEqual('() -> number');
    expect(r.matches).toBe(true);
  });

  test('a body that adds 1 to the constant `i`', () => {
    // Before: the signature was `() -> integer`, and the value `1 + i`.
    const r = run('let a = g()\nSnap()\nlet i = 2\nfunction g() { i + 1 }\na');
    expect(r.value.toString()).toEqual('(1 + i)');
    expect(r.result).toEqual('() -> complex');
    expect(r.matches).toBe(true);
  });

  test('a host binding of another type', () => {
    // Before: the signature was `() -> integer<0..>`, and the value `2.25`.
    const r = run(
      'let a = g()\nSnap()\nlet c = 2\nfunction g() { c^2 }\na',
      (ce) => {
        ce.declare('c', 'real');
        ce.assign('c', 1.5);
        ce.pushScope();
      }
    );
    expect(r.value.json).toEqual(2.25);
    expect(r.matches).toBe(true);
  });

  test('a host binding that holds `Nothing`', () => {
    // The union keeps the `nothing` arm. Before: the signature was
    // `() -> integer`, and the value `Nothing`.
    const r = run(
      'let a = g()\nSnap()\nlet v = 2\nfunction g() { v }\na',
      (ce) => {
        ce.declare('v', 'integer | nothing');
        ce.assign('v', ce.Nothing);
        ce.pushScope();
      }
    );
    expect(r.value.symbol).toEqual('Nothing');
    expect(r.result).toEqual('() -> integer | nothing');
    expect(r.matches).toBe(true);
  });

  test('a host binding of type `unknown`', () => {
    // An outer type that is `unknown` makes the binding `unknown`, which
    // admits every value. Before: the signature was `() -> integer`.
    const r = run(
      'let a = g()\nSnap()\nlet v = 2\nfunction g() { v }\na',
      (ce) => {
        ce.declare('v', 'unknown');
        ce.pushScope();
      }
    );
    expect(r.result).toEqual('() -> unknown');
    expect(r.matches).toBe(true);
  });

  test('no call before the `let`: the signature keeps the variable type', () => {
    const r = run(
      'let a = i^2\nlet i = 2\nlet b = g()\nSnap()\nfunction g() { i^2 }\nb'
    );
    expect(r.value.json).toEqual(4);
    expect(r.result).toEqual('() -> integer<0..>');
    expect(r.matches).toBe(true);
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

  test('a function statement for a name that an earlier `let` binds', () => {
    // The definition adds a clause to the function that the `let`
    // installs, so it runs in order. The same answer as before.
    const { value, diagnostics } = epsil(
      'let a = String(g(2))\nlet g = (k: integer) => 10 * k\nfunction g(k: string) { k }\n[a, String(g(2)), g("s")]'
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
    expect(blockErrors(probed)).toContain('read-before-declaration');
    const src =
      'let v = {I -> 1}\nlet a = g(3)\nfunction g(k) { v["I"] + k }\na';
    expect(epsil(src)).toEqual({ value: 4, diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
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

  test('an earlier `let` of a literal gives its type to the body', () => {
    // The preparation declares `c` with the type of the literal, as the
    // `let` does when it runs, so the body `c^2` is refused as
    // it is in order. Before: `c` was declared `unknown`, the body narrowed
    // it to a number, and the program reported errors at other places.
    const { value, diagnostics } = epsil(
      'let c = "s"\nlet a = String(g())\nfunction g() { c^2 }\n[a, g()]'
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
    expect(blockErrors(probed)).toContain('read-before-declaration');
    const src = 'let h = (x) => 3 * x\nlet a = g(2)\nfunction g(k) { h(k) }\na';
    expect(epsil(src)).toEqual({ value: 6, diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
  });

  test('a generic function', () => {
    // The `DefineFunction` canonical handler installs no generic clause at
    // canonicalization, so a generic function takes effect when its
    // statement runs, on both routes.
    const probed = 'let a = String(f(3))\nfunction f<T>(x: T) -> T { x }\na';
    expect(epsil(probed)).toEqual({ value: 'f(3)', diagnostics: [] });
    expect(blockErrors(probed)).toContain('read-before-declaration');
    const src = 'let a = f(3)\nfunction f<T>(x: T) -> T { x }\na';
    expect(epsil(src)).toEqual({ value: 3, diagnostics: [] });
    expect(blockErrors(src)).toContain('read-before-declaration');
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
    expect(blockErrors(src)).toContain('variable-redeclaration');
  });

  test('a `let` of a function literal takes effect when it runs', () => {
    const src = 'let a = String(g(3))\nlet g = (k) => k^2\na';
    // The top level of a program is a block: the `let` declares the
    // variable `g`, and the call before it is a use before the declaration.
    const { diagnostics } = epsil(src);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('read-before-declaration');
    expect(JSON.stringify(block(src))).toContain("'read-before-declaration'");
  });
});

describe('A PROGRAM RUN AGAIN ON THE SAME ENGINE WITH ANOTHER SIGNATURE', () => {
  // The program scope keeps the binding of `f` that the first program made.
  // In order, the `let` of the second program declares `f` again, and the
  // `function` statement is boxed against the new binding. The preparation
  // declares `f` again too, so the clause gets the parameter types of the
  // new declaration, and each second program gives the value that it gives
  // on a new engine. A clause boxed against the binding of the first program
  // would keep the parameter type `integer`.

  /** The value of `second` after `first` on one engine, and on a new
   * engine. */
  const reRun = (first: string, second: string) => {
    const ce = new ComputeEngine();
    executeEpsil(ce, first);
    const again = executeEpsil(ce, second);
    const fresh = executeEpsil(new ComputeEngine(), second);
    return {
      again: plain(again.value),
      againDiagnostics: again.diagnostics,
      fresh: plain(fresh.value),
    };
  };

  test('the parameter type of the new declaration', () => {
    const { again, againDiagnostics, fresh } = reRun(
      'let f: (integer) -> integer\nfunction f(n) { 2*n }\nf(3)',
      'let f: (real) -> real\nfunction f(n) { 2*n }\nf(2.5)'
    );
    expect(again).toEqual({ num: '5.0' });
    expect(fresh).toEqual(again);
    expect(againDiagnostics).toEqual([]);
  });

  test('a call between the declaration and the definition', () => {
    const { again, fresh } = reRun(
      'let f: (integer) -> integer\nlet a = f(2)\nfunction f(n) { 2*n }\na',
      'let f: (real) -> real\nlet a = f(2.5)\nfunction f(n) { 2*n }\na'
    );
    expect(again).toEqual({ num: '5.0' });
    expect(fresh).toEqual(again);
  });

  test('two functions that a later function calls', () => {
    const { again, fresh } = reRun(
      'let g: (integer) -> integer\nlet f: (integer) -> integer\nlet a = f(2)\nfunction f(n) { g(n) + 1 }\nfunction g(n) { 2*n }\na',
      'let g: (real) -> real\nlet f: (real) -> real\nlet a = f(2.5)\nfunction f(n) { g(n) + 1 }\nfunction g(n) { 2*n }\na'
    );
    expect(again).toEqual({ num: '6.0' });
    expect(fresh).toEqual(again);
  });

  test('the same signature and a new body', () => {
    const { again, fresh } = reRun(
      'let f: (real) -> real\nlet a = f(2)\nfunction f(n) { 2*n }\na',
      'let f: (real) -> real\nlet a = f(2)\nfunction f(n) { 3*n }\na'
    );
    expect(again).toEqual(6);
    expect(fresh).toEqual(again);
  });

  test('a later program with no `let` keeps the declaration', () => {
    // The `let` of the second program declared `f` again; a third program
    // that only calls `f` uses that declaration.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f: (integer) -> integer\nfunction f(n) { 2*n }');
    executeEpsil(ce, 'let f: (real) -> real\nfunction f(n) { 3*n }');
    expect(plain(executeEpsil(ce, 'f(2.5)').value)).toEqual(7.5);
  });

  test('a host binding of the same name around the program scope', () => {
    // The binding of the first program hides the host binding of `f`. The
    // preparation declares `f` again in the program scope and keeps that
    // binding with its clause: it does not remove it as it removes a new
    // binding of a name that an enclosing scope defines.
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.pushScope();
    executeEpsil(ce, 'let f: (integer) -> integer\nfunction f(n) { 2*n }');
    expect(
      plain(
        executeEpsil(
          ce,
          'let f: (integer) -> integer\nlet a = String(f(2))\nfunction f(n) { 3*n }\na'
        ).value
      )
    ).toBe('6');
    expect(
      plain(
        executeEpsil(
          ce,
          'let f: (real) -> real\nlet a = String(f(2.5))\nfunction f(n) { 3*n }\na'
        ).value
      )
    ).toBe('7.5');
  });

  test('a preparation that cannot box the statement keeps the earlier binding', () => {
    // The preparation boxes each statement with `{ form: 'raw' }` first, and
    // then boxes the `function` statement to install its clause. That second
    // boxing throws here once, so the statement runs in order: the call
    // before the `let` reads the function of the first program (`2*n`), and
    // the call after the definition reads the new one (`3*n`).
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f: (integer) -> integer\nfunction f(n) { 2*n }');
    const box = ce.box.bind(ce);
    let rawSeen = false;
    let thrown = false;
    ce.box = ((expr: unknown, options?: { form?: string }) => {
      if (JSON.stringify(expr).startsWith('{"fn":["DefineFunction"')) {
        if (options?.form === 'raw') rawSeen = true;
        else if (rawSeen && !thrown) {
          thrown = true;
          throw new Error('the boxing fails');
        }
      }
      return box(expr as never, options as never);
    }) as typeof ce.box;
    const { value } = executeEpsil(
      ce,
      'let a = String(f(2))\nlet f: (integer) -> integer\nfunction f(n) { 3*n }\n[a, f(2)]'
    );
    expect(thrown).toBe(true);
    expect(plain(value)).toEqual(['4', 6]);
  });

  test('the asynchronous runner', async () => {
    const ce = new ComputeEngine();
    await executeEpsilAsync(
      ce,
      'let f: (integer) -> integer\nfunction f(n) { 2*n }\nf(3)'
    );
    const { value } = await executeEpsilAsync(
      ce,
      'let f: (real) -> real\nfunction f(n) { 2*n }\nf(2.5)'
    );
    expect(plain(value)).toEqual({ num: '5.0' });
  });
});

describe('THE COMPILER', () => {
  test('a call before a function statement', () => {
    // In a block the call reads the local before its declaration: the block
    // is invalid, and the compilation refuses it.
    const ce = new ComputeEngine();
    const expr = ce.box(
      parseEpsil('let a = g(3)\nfunction g(k) { k^2 }\na')[0] as never
    );
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false } as never)
    ).toThrow();
  });
});
