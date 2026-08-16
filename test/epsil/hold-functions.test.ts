import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { definitionSites } from '../../src/epsil/definition-sites';

//
// The `hold` definition prefix — `hold f(e) = …` / `hold function f(e) { … }`.
//
// A hold function's arguments are bound to its parameters AS WRITTEN
// (canonical, bound in the caller's scope, unevaluated) and evaluate where
// the body reads them (call-by-name). It lowers to `DefineFunction`'s
// attributes operand `{hold: True}`, which installs a `lazy` operator
// definition in clause storage (single-clause), and the clause selector
// applies the literal with `holdArguments`. See `src/epsil/docs/control-flow.md`,
// "Hold functions".
//

function fresh() {
  const ce = new ComputeEngine();
  const run = (source: string) => executeEpsil(ce, source);
  const value = (source: string) => run(source).value?.json;
  const messages = (source: string) =>
    run(source).diagnostics.map((d) => d.message[0]);
  return { ce, run, value, messages };
}

describe('hold: arguments arrive unevaluated', () => {
  test('a structural operator sees the argument expression (math form)', () => {
    const { value } = fresh();
    expect(value('let a = 3; hold f(e) = Head(e); f(a + 1)')).toBe('Add');
    // The same body without `hold` receives the VALUE 4.
    expect(value('g(e) = Head(e); g(a + 1)')).toBe('Integer');
  });

  test('block form, and reading the parameter evaluates the argument', () => {
    const { value } = fresh();
    expect(
      value('let a = 3; hold function tw(e) { let v = e; v * v }; tw(a + 1)')
    ).toBe(16);
    // Call-by-name: each read evaluates the argument again.
    expect(value('hold twice(e) = e + e; twice(a + 1)')).toBe(8);
  });

  test('a bare unbound symbol and a symbolic term are applied, not left inert', () => {
    const { value } = fresh();
    expect(value('hold id(e) = e; id(q)')).toBe('q');
    expect(value('id(q + 1)')).toEqual(['Add', 'q', 1]);
    expect(value('hold t(e) = Tail(e); t(q + 1)')).toEqual([
      'Sequence',
      'q',
      1,
    ]);
  });

  test('the argument is not evaluated unless the body reaches it', () => {
    const { value } = fresh();
    // `Random()` under a hold parameter draws only when the body reads it.
    expect(
      value(
        'let a = 3; hold unless(cond, body) = if !cond { body } else { Nothing }; unless(a < 5, Random())'
      )
    ).toBe('Nothing');
    const drawn = value('unless(a > 5, Random())');
    expect(typeof drawn).toBe('number');
  });

  test('typed parameters check the argument EXPRESSION type', () => {
    const { value } = fresh();
    expect(value('hold k(e: integer) = e; k(3)')).toBe(3);
    expect(value('let n = 2; k(n + 1)')).toBe(3);
    const bad = value('k("s")');
    expect(Array.isArray(bad) && bad[0]).toBe('Error');
  });

  test('`.N()` threads through a hold call', () => {
    const { run, value } = fresh();
    expect(run('hold n(e) = e; N(n(Pi))').value.re).toBeCloseTo(Math.PI, 12);
    // Without N the exact form is kept.
    expect(value('n(Pi)')).toBe('Pi');
  });
});

describe('hold: single-clause and other refusals', () => {
  test('a literal parameter is refused at parse time and the prefix dropped', () => {
    const { run } = fresh();
    const r = run('hold m(0) = 1');
    expect(r.diagnostics.map((d) => d.message[0])).toContain(
      'hold-literal-parameter'
    );
  });

  test('a second clause of a hold function is refused (either order)', () => {
    const { value } = fresh();
    const e1 = value('hold p(e) = e; p(x, y) = 2*x');
    expect(Array.isArray(e1) && e1[1]).toBe("'hold-single-clause'");
    const e2 = value('q(x) = 2*x; hold q(e, f) = e');
    expect(Array.isArray(e2) && e2[1]).toBe("'hold-single-clause'");
  });

  test('a same-domain redefinition replaces in place across programs', () => {
    const { value } = fresh();
    expect(value('let a = 3; hold r(e) = Head(e); r(a + 1)')).toBe('Add');
    expect(value('r(e) = Head(e); r(a + 1)')).toBe('Integer');
    expect(value('hold r(e) = Head(e); r(a + 1)')).toBe('Add');
  });

  test('a generic literal cannot be a hold function (box route and Epsil)', () => {
    const { value } = fresh();
    const e = value('hold function id<T>(x: T) -> T { x }');
    expect(Array.isArray(e) && e[1]).toBe("'hold-unsupported'");
  });

  test('a literal parameter is refused on the MathJSON route too', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DefineFunction',
        'm',
        ['Function', 1, ['Typed', 'z', { str: '0' }]],
        { dict: { hold: 'True' } },
      ])
      .evaluate();
    expect(r.json).toEqual(
      expect.arrayContaining(['Error', "'hold-literal-parameter'"])
    );
  });

  test('About labels a hold function', () => {
    const { run } = fresh();
    expect(run('hold f(e) = e + 1; About(f)').value.string).toContain(
      'hold function'
    );
  });

  test('the held argument is CANONICAL: literal arithmetic is already folded', () => {
    const { value } = fresh();
    expect(value('hold r(e) = Head(e); r(1 + 1)')).toBe('Integer');
    expect(value('r(2 * q)')).toBe('Multiply');
  });
});

describe('hold: forwarding a held argument to another hold function', () => {
  // A held argument that names a CALLER-FRAME binding (the caller's own hold
  // parameter, or a `let` local of its body) is inlined at the call boundary,
  // because a call frame chains to the callee's defining scope and never to
  // the caller's — left as the symbol, the callee could not resolve it.
  test('same parameter name, and a different one', () => {
    const { value } = fresh();
    expect(
      value('let a = 3; hold p1(e) = Head(e); hold p2(e) = p1(e); p2(a + 1)')
    ).toBe('Add');
    expect(value('hold p3(x) = p1(x); p3(a + 1)')).toBe('Add');
    expect(value('hold p4(x) = p1(x * 2); p4(a + 1)')).toBe('Multiply');
  });

  test('evaluation through the forwarded argument resolves fully', () => {
    const { value } = fresh();
    expect(
      value('let a = 3; hold q1(e) = e + 1; hold q3(x) = q1(x); q3(a + 1)')
    ).toBe(5);
    // Through a `let` local of the forwarding body.
    expect(value('hold q4(x) = do { let y = x; q1(y) }; q4(a + 1)')).toBe(5);
    expect(value('hold t(e) = Tail(e); hold t2(x) = t(x); t2(a * b)')).toEqual([
      'Sequence',
      'a',
      'b',
    ]);
  });

  test('bindings the callee CAN reach stay symbolic', () => {
    const { value } = fresh();
    // A top-level `let` is on the callee's chain: `e` is bound to `a + 1`.
    expect(value('let a = 3; hold f(e) = Head(e); f(a + 1)')).toBe('Add');
    // A hold function defined INSIDE a function reaches that frame's `n`.
    expect(
      value('function outer(n) { hold inner(e) = e + n; inner(a) }; outer(10)')
    ).toBe(13);
  });
});

describe('hold: contextual keyword and lowering', () => {
  test('`hold` stays an ordinary identifier', () => {
    const { value } = fresh();
    expect(value('let hold = 5; hold + 1')).toBe(6);
    expect(value('hold(2)')).toEqual(
      expect.arrayContaining(['Error']) // 5(2): not a function
    );
    expect(value('h(hold) = hold * 2; h(4)')).toBe(8);
  });

  test('lowers to a DefineFunction attributes operand', () => {
    const [expr, diags] = parseEpsil('hold f(e) = Head(e)');
    expect(diags).toHaveLength(0);
    const json = JSON.parse(
      JSON.stringify(expr, (k, v) => (k === 'sourceOffsets' ? undefined : v))
    );
    expect(json).toEqual({
      fn: [
        'DefineFunction',
        { sym: 'f' },
        { fn: ['Function', { fn: ['Head', { sym: 'e' }] }, { sym: 'e' }] },
        {
          fn: [
            'Dictionary',
            { fn: ['KeyValuePair', { sym: 'hold' }, { sym: 'True' }] },
          ],
        },
      ],
    });
  });

  test('serializes back with the prefix, in both forms and both dictionary encodings', () => {
    for (const src of [
      'hold f(e) = Head(e)',
      'hold function g(e, n) random -> integer {e + n}',
      'hold k(e: integer) -> integer = e',
    ]) {
      const [expr] = parseEpsil(src);
      expect(serializeEpsil(expr)).toBe(src);
    }
    expect(
      serializeEpsil([
        'DefineFunction',
        'f',
        ['Function', ['Head', 'e'], 'e'],
        { dict: { hold: 'True' } },
      ])
    ).toBe('hold f(e) = Head(e)');
    // An attribute the language cannot spell falls back to the call form.
    expect(
      serializeEpsil([
        'DefineFunction',
        'f',
        ['Function', ['Head', 'e'], 'e'],
        { dict: { other: 'True' } },
      ])
    ).toMatch(/^DefineFunction\(/);
  });

  test('box route: the attribute installs a lazy definition', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    ce.box([
      'DefineFunction',
      'f',
      ['Function', ['Head', 'e'], 'e'],
      { dict: { hold: 'True' } },
    ]).evaluate();
    expect(ce.box(['f', ['Add', 'a', 1]]).evaluate().json).toBe('Add');
    expect(ce.lookupDefinition('f')?.operator?.lazy).toBe(true);
    // Parse route (LaTeX): same definition, same behavior.
    expect(ce.parse('f(a+1)').evaluate().json).toBe('Add');
  });

  test('a host `lazy: true` definition backed by a literal binds as written too', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    ce.declare('hf', {
      lazy: true,
      signature: '(unknown) -> unknown',
      evaluate: ce.box(['Function', ['Head', 'e'], 'e']),
    });
    expect(ce.box(['hf', ['Add', 'a', 1]]).evaluate().json).toBe('Add');
  });
});

//
// Definition attributes beyond `hold`: `bind` parameters, the algebraic
// words of the specifier slot, and the doc-comment description — all carried
// by the same `DefineFunction` attributes operand.
//

describe('bind: bound-variable parameters of a hold function', () => {
  test('the caller names the bound variable; the body binder uses it', () => {
    const { value } = fresh();
    expect(
      value(
        'hold mySum(body, bind i, n) = Sum(body, (i, 1, n)); mySum(k^2, k, 3)'
      )
    ).toBe(14);
    // A global `k` does not leak in: the call node declares its own `k`.
    expect(value('let k = 5; mySum(k^2, k, 3)')).toBe(14);
    // Another free symbol in the body argument still resolves normally.
    expect(value('mySum(k * j, j, 3)')).toBe(30);
  });

  test('a bind argument must be a symbol', () => {
    const { value } = fresh();
    const e = value(
      'hold mySum(body, bind i, n) = Sum(body, (i, 1, n)); mySum(k^2, 2, 3)'
    );
    expect(Array.isArray(e) && e[1]).toBe("'bind-symbol-expected'");
  });

  test('bind requires hold (parser), and is refused on the box route too', () => {
    const { messages } = fresh();
    expect(messages('f2(bind i) = i')).toContain('bind-requires-hold');
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DefineFunction',
        'g',
        ['Function', 'i', 'i'],
        { dict: { bind: ['i'] } },
      ])
      .evaluate();
    // Same code as the parser's, so both routes agree.
    expect(r.json).toEqual(
      expect.arrayContaining(['Error', "'bind-requires-hold'"])
    );
    const r2 = ce
      .box([
        'DefineFunction',
        'h',
        ['Function', 'i', 'i'],
        { dict: { hold: 'True', bind: ['nope'] } },
      ])
      .evaluate();
    expect(r2.json).toEqual(
      expect.arrayContaining(['Error', "'invalid-definition-attribute'"])
    );
  });

  test('a nested definition in the body does not lose the outer bind', () => {
    const { value } = fresh();
    expect(
      value(
        'hold function mySum(body, bind i, n) { function helper(x) { x }; Sum(body, (i, 1, n)) }; mySum(k^2, k, 3)'
      )
    ).toBe(14);
    expect(
      value(
        'hold mySum2(body, bind i, n) = do { g(x) = x; Sum(body, (i, 1, n)) }; mySum2(k^2, k, 3)'
      )
    ).toBe(14);
  });

  test('`bind` on a protocol member is diagnosed', () => {
    const { messages } = fresh();
    // A requirement's parameter list is a type-level signature, where `bind`
    // reads as an unknown type; an IMPLEMENTATION member parses a real
    // parameter list and diagnoses the marker explicitly.
    expect(
      messages('protocol P { function f(self: Self, n: integer) -> number }')
    ).toEqual([]);
    expect(
      messages(
        'protocol Q { function g(self: Self, n: integer) -> number }; type string is Q { function g(self: string, bind n) -> number { 1 } }'
      )
    ).toContain('unexpected-definition-attribute');
  });

  test('`bind` alone is an ordinary parameter name', () => {
    const { value } = fresh();
    expect(value('f(bind) = bind * 2; f(4)')).toBe(8);
    expect(value('g(bind: integer) = bind + 1; g(4)')).toBe(5);
  });

  test('lowers to a `bind` list of names and round-trips', () => {
    const src = 'hold mySum(body, bind i, n) = Sum(body, (i, 1, n))';
    const [expr, diags] = parseEpsil(src);
    expect(diags).toHaveLength(0);
    const json = JSON.parse(
      JSON.stringify(expr, (k, v) => (k === 'sourceOffsets' ? undefined : v))
    );
    expect(json.fn[3].fn).toEqual([
      'Dictionary',
      { fn: ['KeyValuePair', { sym: 'hold' }, { sym: 'True' }] },
      { fn: ['KeyValuePair', { sym: 'bind' }, { fn: ['List', { str: 'i' }] }] },
    ]);
    expect(serializeEpsil(expr)).toBe(src);
    expect(
      serializeEpsil([
        'DefineFunction',
        'mySum',
        ['Function', ['Sum', 'body', ['Tuple', 'i', 1, 'n']], 'body', 'i', 'n'],
        { dict: { hold: 'True', bind: ['i'] } },
      ])
    ).toBe(src);
  });
});

describe('algebraic attributes: commutative / associative / idempotent / involution', () => {
  test('commutative + associative: calls are sorted, flattened, and folded pairwise', () => {
    const { value } = fresh();
    expect(
      value(
        'function op(a, b) commutative associative -> number { a + b + 1 }; op(1, op(2, 3))'
      )
    ).toBe(8);
    expect(value('op(op(1, 2), 3)')).toBe(8);
    expect(value('op(1, 2, 3, 4)')).toBe(13);
    // Symbolic operands: sorted at canonicalization, and still applied.
    expect(value('op(y, x)')).toEqual(['Add', 'x', 'y', 1]);
  });

  test('involution and idempotent fold nested calls at canonicalization', () => {
    const { value } = fresh();
    expect(value('conj(z) involution -> number = -z; conj(conj(w))')).toBe('w');
    expect(value('conj(3)')).toBe(-3);
    // `norm(norm(w))` folds to `norm(w)` at canonicalization, then applies.
    expect(
      value('norm(z) idempotent -> number = Abs(z); norm(norm(w))')
    ).toEqual(['Abs', 'w']);
    expect(
      new ComputeEngine().box(['norm', ['norm', 'w']], { form: 'raw' }).json
    ).toEqual(['norm', ['norm', 'w']]); // raw: untouched, sanity
    expect(value('norm(-2)')).toBe(2);
  });

  test('About lists the flags', () => {
    const { run } = fresh();
    const s = run(
      'function op(a, b) commutative associative -> number { a + b }; About(op)'
    ).value.string;
    expect(s).toContain('commutative associative');
  });

  test('refusals: with hold, on a protocol member, wrong arity, disagreeing clauses', () => {
    const { messages, value } = fresh();
    expect(messages('hold f3(x) commutative -> number = x')).toContain(
      'unexpected-definition-attribute'
    );
    expect(
      messages('function d(x) commutative commutative -> number { x }')
    ).toContain('duplicate-definition-attribute');
    const e1 = value('function u(x) associative -> number { x }');
    expect(Array.isArray(e1) && e1[1]).toBe("'invalid-definition-attribute'");
    const e2 = value('function v(a, b) involution -> number { a }');
    expect(Array.isArray(e2) && e2[1]).toBe("'invalid-definition-attribute'");
    // A second clause must state the same flags.
    const e3 = value(
      'function w(a: integer, b: integer) commutative -> number { a + b }; function w(a: string, b: string) -> number { 0 }'
    );
    expect(Array.isArray(e3) && e3[1]).toBe("'invalid-definition-attribute'");
    // hold + algebraic on the box route.
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DefineFunction',
        'bad',
        ['Function', 'z', 'z'],
        { dict: { hold: 'True', commutative: 'True' } },
      ])
      .evaluate();
    expect(r.json).toEqual(
      expect.arrayContaining(['Error', "'invalid-definition-attribute'"])
    );
  });

  test('round-trips through the specifier slot (math form needs the arrow)', () => {
    for (const src of [
      'function op(a, b) commutative associative -> number {a + b}',
      'conj(z) involution -> number = -z',
      'function m(a, b) random commutative -> number {a + b}',
    ]) {
      const [expr, diags] = parseEpsil(src);
      expect(diags).toHaveLength(0);
      expect(serializeEpsil(expr)).toBe(src);
    }
    expect(
      serializeEpsil([
        'DefineFunction',
        'op',
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
        { dict: { commutative: 'True' } },
      ])
    ).toBe('op(a, b) commutative -> unknown = a + b');
  });
});

describe('doc comments become the definition description', () => {
  test('`///` lines and a `/** */` block, markers stripped', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      '/// Adds two things.\n/// Second **line**.\nfunction add(a, b) { a + b }'
    );
    expect(ce.lookupDefinition('add')?.operator?.description).toBe(
      'Adds two things.\nSecond **line**.'
    );
    executeEpsil(
      ce,
      '/** Block doc\n * more */\nmul(a, b) commutative -> number = a * b'
    );
    expect(ce.lookupDefinition('mul')?.operator?.description).toBe(
      'Block doc\nmore'
    );
    // Both representations (plain and clause storage) surface it in About.
    expect(executeEpsil(ce, 'About(add)').value.string).toContain(
      'Adds two things.'
    );
    expect(executeEpsil(ce, 'About(mul)').value.string).toContain('Block doc');
  });

  test('survives conversion to clause storage, and a later overload may update it', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, '/// First.\nfunction d(a: integer) { a }');
    executeEpsil(ce, 'function d(a: string) { 0 }');
    expect(ce.lookupDefinition('d')?.operator?.description).toBe('First.');
    executeEpsil(ce, '/// Second.\nfunction d(a: boolean) { 1 }');
    expect(ce.lookupDefinition('d')?.operator?.description).toBe('Second.');
  });

  test('an ordinary comment is not a description', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, '// not documentation\nfunction plain(a) { a }');
    expect(ce.lookupDefinition('plain')?.operator?.description).toBeUndefined();
  });

  test('round-trips as `///` lines and reaches definitionSites', () => {
    const src = '/// Doubles.\n/// Really.\ntwice(x) = 2x';
    const [expr] = parseEpsil(src);
    expect(serializeEpsil(expr)).toBe(src);
    expect(definitionSites(expr).get('twice')?.description).toBe(
      'Doubles.\nReally.'
    );
  });
});
