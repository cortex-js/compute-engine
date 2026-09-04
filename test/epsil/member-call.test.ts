import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Calling a protocol function with the dot: `c.area()` is `area(c)`, and
// `c.scale(2)` is `scale(c, 2)`. The rules, ruled 2026-09-04 and recorded in
// `docs/plans/2026-09-04-protocol-member-dot-call.md`:
//
//   1. only protocol function members are reached this way;
//   2. any receiver expression, so calls chain;
//   3. the parentheses are the call — `c.area` without them stays a field or
//      property read, and a function member read that way stays an error;
//   4. a field the receiver's type declares wins over a member of the same
//      name.
//
// The parse is `["MemberCall", receiver, "name", args…]`, a node that
// canonicalization rewrites to the bare dispatcher call or to
// `Apply(Field(…))`; no canonical expression contains it.
//

const SHAPES = `
protocol Shape {
  function area(self: Self) -> number
  function scale(self: Self, k: number) -> Self
}
type Circle = tuple<r: number> is Shape {
  function area(self: Circle) -> number { Pi * self.r^2 }
  function scale(self: Circle, k: number) -> Circle { Circle(self.r * k) }
}
type Box = object{w: number, h: number} is Shape {
  function area(self: Box) -> number { self.w * self.h }
  function scale(self: Box, k: number) -> Box { self.w = self.w * k; self }
}
protocol Named { function name(self: Self) -> string }
type integer is Named { function name(self) -> string { "int" } }
c := Circle(1)
b := Box(w: 2, h: 3)
n := 5
`;

/** An engine with the fixture run. */
function engine(setup = SHAPES): ComputeEngine {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, setup);
  if (result.diagnostics.length > 0)
    throw new Error(
      `fixture: ${JSON.stringify(result.diagnostics[0].message)}`
    );
  return ce;
}

/** The value of `source` on a fresh fixture engine, as a string, and its
 * diagnostics' codes. */
function run(
  source: string,
  setup = SHAPES
): { value: string; codes: string[] } {
  const result = executeEpsil(engine(setup), source);
  return {
    value: result.value.toString(),
    codes: result.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message[0] : d.message
    ),
  };
}

/** The raw parse of `source`, with source offsets stripped. */
function parse(source: string): unknown {
  const [ast, diags] = parseEpsil(source);
  expect(diags).toEqual([]);
  return JSON.parse(
    JSON.stringify(ast, (k, v) => (k === 'sourceOffsets' ? undefined : v))
  );
}

describe('parse', () => {
  test('`c.area()` is a MemberCall with no arguments', () => {
    expect(parse('c.area()')).toEqual({
      fn: ['MemberCall', { sym: 'c' }, { str: 'area' }],
    });
  });

  test('`c.scale(2)` carries its arguments after the member name', () => {
    expect(parse('c.scale(2)')).toEqual({
      fn: ['MemberCall', { sym: 'c' }, { str: 'scale' }, { num: '2' }],
    });
  });

  test('chains nest, receiver first: `c.scale(2).area()`', () => {
    expect(parse('c.scale(2).area()')).toEqual({
      fn: [
        'MemberCall',
        { fn: ['MemberCall', { sym: 'c' }, { str: 'scale' }, { num: '2' }] },
        { str: 'area' },
      ],
    });
  });

  test('any receiver expression: `(a + b).area()`', () => {
    expect(parse('(a + b).area()')).toEqual({
      fn: [
        'MemberCall',
        { fn: ['Add', { sym: 'a' }, { sym: 'b' }] },
        { str: 'area' },
      ],
    });
  });

  test('the qualified form `c.(Shape.scale)(2)` lowers to ProtocolMember', () => {
    expect(parse('c.(Shape.scale)(2)')).toEqual({
      fn: [
        'ProtocolMember',
        { str: 'Shape' },
        { str: 'scale' },
        { sym: 'c' },
        { num: '2' },
      ],
    });
  });

  test('a parenthesized read applied to arguments is NOT a member call', () => {
    expect(parse('(c.area)(2)')).toEqual({
      fn: [
        'Apply',
        { fn: ['Field', { sym: 'c' }, { str: 'area' }] },
        { num: '2' },
      ],
    });
  });

  test('whitespace before the parentheses ends the field clause', () => {
    // `c.area ()` is the field read `c.area` followed by a separate primary,
    // exactly as `f (x)` is not a call.
    const [ast] = parseEpsil('c.area ()');
    const json = JSON.parse(JSON.stringify(ast));
    expect(json.fn?.[0]).not.toBe('MemberCall');
  });

  test('a stray dot before the name is diagnosed, as for a field', () => {
    const [, diags] = parseEpsil('c .area()');
    expect(diags.length).toBeGreaterThan(0);
  });

  test('serialization round-trips the dot form', () => {
    for (const source of [
      'c.area()',
      'c.scale(2)',
      'c.scale(2).area()',
      '(a + b).area()',
      'c.(Shape.scale)(2)',
      'c.scale(k: 2)',
    ]) {
      const [ast] = parseEpsil(source);
      expect(serializeEpsil(ast!)).toBe(source);
    }
  });
});

describe('a protocol function called with the dot', () => {
  test('a nominal tuple conformer: `c.area()` is `area(c)`', () => {
    expect(run('c.area()').value).toBe('pi');
    expect(run('area(c)').value).toBe('pi');
  });

  test('arguments follow the receiver: `c.scale(2)` is `scale(c, 2)`', () => {
    expect(run('c.scale(2)').value).toBe('Circle(2)');
  });

  test('calls chain: `c.scale(2).area()`', () => {
    expect(run('c.scale(2).area()').value).toBe('4pi');
  });

  test('an object conformer, including a member that mutates it', () => {
    expect(run('b.area()').value).toBe('6');
    expect(run('b.scale(2); b.w').value).toBe('4');
    expect(run('b.scale(2).area()').value).toBe('12');
  });

  test('a builtin-type conformer through a symbol', () => {
    expect(run('n.name()').value).toBe('"int"');
  });

  test('a receiver that is a call, a field, or an element', () => {
    expect(run('Circle(3).area()').value).toBe('9pi');
    expect(run('[Circle(1), Circle(2)][2].area()').value).toBe('4pi');
    expect(run('[Circle(1), Circle(2)] |> Map(s => s.area())').value).toBe(
      '[pi,4pi]'
    );
  });

  test('inside a function, annotated or not', () => {
    expect(run('function h(x: Circle) { x.area() }; h(Circle(3))').value).toBe(
      '9pi'
    );
    expect(run('function g(x) { x.area() }; g(Circle(2))').value).toBe('4pi');
  });

  test('named arguments after the receiver: `c.scale(k: 2)`', () => {
    expect(run('c.scale(k: 2)').value).toBe('Circle(2)');
    expect(run('c.scale(k: 2)').codes).toEqual([]);
  });

  test('the qualified form dispatches inside one protocol', () => {
    expect(run('c.(Shape.scale)(3)').value).toBe('Circle(3)');
    expect(run('c.(Shape.scale)(k: 5)').value).toBe('Circle(5)');
    expect(run('c.(Shape.area)()').value).toBe('pi');
  });

  test('two protocols with the member: ambiguous, and the qualified form resolves it', () => {
    const setup = `${SHAPES}
protocol Other { function area(self: Self) -> string }
type Circle is Other { function area(self: Circle) -> string { "other" } }
`;
    expect(run('c.area()', setup).value).toContain('protocol-call-ambiguous');
    expect(run('c.(Other.area)()', setup).value).toBe('"other"');
    expect(run('c.(Shape.area)()', setup).value).toBe('pi');
  });

  test('a user definition that shadows the bare name does not take the dot', () => {
    // "When the bare name is taken, qualify" (protocols.md): a lexically
    // visible `area` wins over the dispatcher for the BARE call. The dot
    // names a member, so it reaches the protocol regardless.
    const setup = `${SHAPES}
function area(x) { "mine" }
`;
    expect(run('area(c)', setup).value).toBe('"mine"');
    expect(run('c.area()', setup).value).toBe('pi');
    expect(run('c.scale(2).area()', setup).value).toBe('4pi');
  });

  test('the dispatcher checks the call: arity and argument types', () => {
    const extra = run('c.scale(2, 3)');
    expect(extra.value).toContain('unexpected-argument');
    expect(extra.codes).toContain('static-type-error');
    const wrong = run('c.scale("a")');
    expect(wrong.value).toContain('incompatible-type');
    expect(wrong.codes).toContain('static-type-error');
  });

  test('the member has the dispatcher effects: a `pure` body cannot mutate through it', () => {
    expect(run('function f(x: Box) pure { x.scale(2) }').value).toContain(
      'incompatible-type'
    );
    expect(run('function f(x: Box) pure { scale(x, 2) }').value).toContain(
      'incompatible-type'
    );
  });
});

describe('what the dot does NOT do', () => {
  test('`c.area` without parentheses is still the function-member read error', () => {
    expect(run('c.area').value).toContain(
      'ErrorCode("protocol-function-not-a-field", "area", "Shape", "read")'
    );
    // No bound-method value: a parenthesized read applied to arguments is
    // the same read, and the same error.
    expect(run('(c.area)()').value).toContain('protocol-function-not-a-field');
  });

  test('a library function is not reached: `xs.Sort()`', () => {
    const r = run('xs := [3, 1, 2]; xs.Sort()');
    expect(r.value).toContain(
      'ErrorCode("dot-call-not-a-protocol-function", "Sort", "vector<integer^3>")'
    );
    // The refusal is a canonicalization error, so the static check reports
    // it with the two spellings that work.
    expect(r.codes).toContain('static-type-error');
    expect(run('xs := [3, 1, 2]; xs |> Sort').value).toBe('[1,2,3]');
  });

  test('a plain user function is not reached either', () => {
    expect(
      run('function double(x: number) { 2 * x }; y := 3; y.double()').value
    ).toContain('dot-call-not-a-protocol-function');
  });

  test('a member the receiver does not have is the field error', () => {
    expect(run('c.aera()').value).toContain(
      'ErrorCode("unknown-field", "aera")'
    );
  });

  test('a stored function keeps winning: `d.f(2)` calls the stored value', () => {
    expect(run('d := {f -> (x => x + 1)}; d.f(2)').value).toBe('3');
    expect(
      run('type pt = tuple<x: number, y: number>; p := pt(1, 2); p.x').value
    ).toBe('1');
  });

  test('a declared field wins over a protocol member of the same name', () => {
    // `Wrap` declares a field `area` holding a function AND conforms to
    // `Shape`; the dot reads the field (rule 4), and the bare call reaches
    // the protocol.
    const setup = `${SHAPES}
type Wrap = object{area: (number) -> number, r: number} is Shape {
  function area(self: Wrap) -> number { self.r }
  function scale(self: Wrap, k: number) -> Wrap { self }
}
w := Wrap(area: x => 10 * x, r: 7)
`;
    expect(run('w.area(2)', setup).value).toBe('20');
    expect(run('area(w)', setup).value).toBe('7');
  });

  test('a number literal never takes a member: `5.name()` is not a call', () => {
    // The lexer folds the dot into the number (`5.` then `name()`), the
    // same rule that makes `2.x` a multiplication. Bind the number to a
    // symbol to call a member on it.
    expect(run('5.name()').value).not.toBe('"int"');
    expect(run('n.name()').value).toBe('"int"');
  });
});

describe('review-found edge cases', () => {
  test('a malformed MemberCall evaluates to an inert node, not a stack overflow', () => {
    // The malformed operand becomes an error and the node stays inert; the
    // evaluate handler must not feed the unresolved node back to itself.
    const ce = engine();
    for (const bad of [
      ['MemberCall', 'c', 5],
      ['MemberCall', 'c'],
    ]) {
      const op = ce.box(bad as any).evaluate().operator;
      expect(['Error', 'MemberCall']).toContain(op);
    }
  });

  test('shadowed bare name AND several protocols: an ambiguity error that names the qualified form', () => {
    const setup = `${SHAPES}
protocol Other { function area(self: Self) -> string }
type Circle is Other { function area(self: Circle) -> string { "other" } }
function area(x) { "mine" }
`;
    const r = run('c.area()', setup);
    expect(r.value).toContain('protocol-call-ambiguous');
    expect(r.value).toContain('.(');
    expect(run('c.(Other.area)()', setup).value).toBe('"other"');
    // An undecided receiver (an unannotated parameter) gets the same advice,
    // at the definition: without the dispatcher there is nothing to resolve
    // the call at run time, so the author is asked to qualify it there.
    expect(run('function g(x) { x.area() }', setup).value).toContain(
      'protocol-call-ambiguous'
    );
  });

  test('an alias of a bare dictionary keeps the stored-value reading', () => {
    const setup = `${SHAPES}
type alias D = dictionary
function h(d: D) { d.area(2) }
`;
    expect(run('h({area -> (x => 10 * x)})', setup).value).toBe('20');
  });

  test('a numeric receiver serializes in a form that parses', () => {
    const ce = engine();
    const raw = ce.box(['MemberCall', 5, { str: 'name' }] as any, {
      form: 'raw',
    });
    const text = serializeEpsil(raw.json);
    expect(text).not.toContain('5.name');
    const [ast, diags] = parseEpsil(text);
    expect(diags).toEqual([]);
    expect(ce.box(ast!).evaluate().toString()).toBe('"int"');
    const qualified = serializeEpsil(
      ce.box(['ProtocolMember', { str: 'Named' }, { str: 'name' }, 5] as any, {
        form: 'raw',
      }).json
    );
    expect(qualified).not.toContain('5.(');
    expect(parseEpsil(qualified)[1]).toEqual([]);
  });

  test('a plain value binding of the member name is not "a known function"', () => {
    // `foo := 3` is a value with no applicable definition behind it, so the
    // refusal must not recommend `foo(x)`. The ordinary field error stands.
    const r = run('xs := [3, 1, 2]; foo := 3; xs.foo()');
    expect(r.value).not.toContain('dot-call-not-a-protocol-function');
    expect(r.value).toContain('incompatible-type');
  });

  test('a protocol PROPERTY holding a function is read, then called', () => {
    const setup = `${SHAPES}
protocol Handler { readonly step: (number) -> number }
type integer is Handler { get step(self) -> ((number) -> number) { x => x + self } }
k := 5
`;
    expect(run('k.step(1)', setup).value).toBe('6');
  });
});

describe('the qualified call `Shape.area(c)` is unchanged', () => {
  test('parses as a member call on the protocol name and canonicalizes to Apply(Field(…))', () => {
    expect(parse('Shape.area(c)')).toEqual({
      fn: ['MemberCall', { sym: 'Shape' }, { str: 'area' }, { sym: 'c' }],
    });
    const ce = engine();
    const [ast] = parseEpsil('Shape.area(c)');
    expect(ce.box(ast!).toString()).toBe('Apply(Field("Shape", "area"), c)');
    expect(run('Shape.area(c)').value).toBe('pi');
    expect(run('Shape.scale(c, k: 4)').value).toBe('Circle(4)');
  });
});

describe('box route and compiled tier', () => {
  test('a hand-built MemberCall canonicalizes to the dispatcher call', () => {
    const ce = engine();
    const expr = ce.box(['MemberCall', 'c', { str: 'area' }] as any);
    expect(expr.toString()).toBe('area(c)');
    expect(expr.evaluate().toString()).toBe('pi');
    expect(
      ce
        .box(['MemberCall', 'c', { str: 'scale' }, 2] as any)
        .evaluate()
        .toString()
    ).toBe('Circle(2)');
  });

  test('a member call compiles through the dispatcher lowering', () => {
    const ce = engine();
    const [ast] = parseEpsil('c.area()');
    const direct = compile(ce.box(ast!));
    expect(direct.success).toBe(true);
    expect(direct.run?.()).toBeCloseTo(Math.PI);

    executeEpsil(ce, 'function k(x: Circle) -> number { x.scale(2).area() }');
    const inBody = compile(ce.box(['k', ['Circle', 1]] as any));
    expect(inBody.success).toBe(true);
    expect(inBody.run?.()).toBeCloseTo(4 * Math.PI);
  });
});
