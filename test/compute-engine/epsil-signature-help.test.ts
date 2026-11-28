import { ComputeEngine } from '../../src/compute-engine';
import { epsilCompletions } from '../../src/epsil/completion';
import {
  epsilSignatureHelp,
  type EpsilSignatureHelp,
} from '../../src/epsil/signature-help';

const ce = new ComputeEngine();

/** The signature help at the `▮` of `source`. */
function help(source: string): EpsilSignatureHelp | null {
  const offset = source.indexOf('▮');
  return epsilSignatureHelp(ce, source.replace('▮', ''), offset);
}

/** The text of each parameter of the active signature, by its range. */
function parameterTexts(result: EpsilSignatureHelp | null): string[] {
  const signature = result?.signatures[result.activeSignature];
  return (
    signature?.parameters.map((p) => signature.label.slice(...p.range)) ?? []
  );
}

const F = 'function f(x: real, n: integer = 2) -> real { x }\n';

describe('EPSIL SIGNATURE HELP: CALLEE', () => {
  test('a library function, by its Epsil spelling', () => {
    const result = help('sin(▮)');
    expect(result).toEqual({
      callee: 'sin',
      signatures: [
        {
          label: 'sin(complex | quantity) -> number',
          parameters: [
            {
              type: 'complex | quantity',
              range: [4, 22],
              documentation:
                'The angle, in radians (or in the angular unit of the engine).',
              sample: 'pi / 6',
            },
          ],
          documentation: 'Sine of an angle.',
          description: ['Sine of an angle.'],
          activeParameter: 0,
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
      examples: ['sin(pi / 6)', 'sin(1)', 'N(sin(1))'],
    });
    expect(help('Sin(▮)')?.callee).toBe('sin');
  });

  test('a library function with parameter names', () => {
    const result = help('map(▮');
    expect(result?.signatures[0].parameters[0].name).toBe('mapping');
    expect(parameterTexts(result)).toEqual([
      'mapping: (T) any -> U',
      'collection<T>+',
    ]);
  });

  test('an overload set has one signature per arm', () => {
    const result = help('join(▮');
    expect(result?.signatures.map((s) => s.label)).toEqual([
      'join(T+) -> T where T: string',
      'join(collection<any>*) -> collection',
    ]);
  });

  test('the active signature is the first that has the argument', () => {
    // `slice(value, span)` has no third parameter, `slice(value, start,
    // end)` has one.
    const result = help('slice(x, 1, ▮');
    expect(result?.signatures).toHaveLength(4);
    expect(result?.activeSignature).toBe(1);
    expect(result?.activeParameter).toBe(2);
    expect(parameterTexts(result)).toEqual([
      'value: T',
      'start: number',
      'end: number',
    ]);
  });

  test('each signature has its own active parameter', () => {
    // The signatures with a `span` have no third parameter.
    const result = help('slice(x, 1, ▮');
    expect(result?.signatures.map((s) => s.activeParameter)).toEqual([
      -1, 2, -1, 2,
    ]);
    expect(result?.activeParameter).toBe(
      result?.signatures[result.activeSignature].activeParameter
    );
    // A named argument: the parameter of that name in each signature.
    expect(
      help('slice(x, start: ▮')?.signatures.map((s) => s.activeParameter)
    ).toEqual([-1, 1, -1, 1]);
  });

  test('a function of the source, with a default shown as optional', () => {
    const result = help(F + 'f(▮)');
    expect(result).toEqual({
      callee: 'f',
      signatures: [
        {
          label: 'f(x: real, n: integer?) -> real',
          parameters: [
            { name: 'x', type: 'real', range: [2, 9] },
            { name: 'n', type: 'integer', range: [11, 22], optional: true },
          ],
          activeParameter: 0,
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    });
  });

  test('a parameter with no type', () => {
    const result = help('function g(x, y) { x }\ng(1, ▮');
    expect(result?.signatures[0].label).toBe('g(x, y)');
    expect(result?.signatures[0].parameters[1]).toEqual({
      name: 'y',
      type: 'any',
      range: [5, 6],
    });
  });

  test('a variable with a function type', () => {
    const result = help('let h: (real, integer) -> real = (a, b) -> a\nh(1, ▮');
    expect(result?.signatures[0].label).toBe('h(real, integer) -> real');
    expect(result?.activeParameter).toBe(1);
  });

  test('effects or type parameters: the ascription is the signature', () => {
    expect(
      help('function h(x) pure -> real { x + 1 }\nh(▮')?.signatures[0].label
    ).toBe('h(x) pure -> real');
    const result = help('function id<T>(x: T) -> T { x }\nid(▮');
    expect(result?.signatures[0].label).toBe('id(x: T) -> T where T');
    expect(result?.signatures[0].parameters[0].type).toBe('T');
    // A return type that is a function type stays a return type.
    expect(
      help('function k(x) -> (real) pure -> real { x }\nk(▮')?.signatures[0]
        .label
    ).toBe('k(x) -> (real) pure -> real');
  });

  test('a type that the source declares, or that the options name', () => {
    const result = help(
      'type Point = tuple<x: real, y: real>\nlet h: (Point) -> real = p => 1\nh(▮)'
    );
    expect(result?.signatures[0].label).toBe('h(Point) -> real');
    expect(result?.signatures[0].parameters[0].type).toBe('Point');
    const source = 'let h: (Point) -> real = p => 1\nh(';
    expect(
      epsilSignatureHelp(ce, source, source.length, { typeNames: ['Point'] })
        ?.signatures[0].label
    ).toBe('h(Point) -> real');
  });

  test('the binding of the callee is the one at the callee', () => {
    // The lambda parameter `f` does not shadow the function `f`.
    const result = help(
      'function f(g: (real) -> real) { g(1) }\nf((f: real) -> ▮)'
    );
    expect(result?.signatures[0].label).toBe('f(g: (real) -> real)');
  });

  test('a `std::` call is a library function', () => {
    const result = help('function sin(x, y) { x }\nstd::sin(▮)');
    expect(result?.signatures[0].label).toBe(
      'sin(complex | quantity) -> number'
    );
  });

  test('a recursive call in the body of its function', () => {
    expect(help('function f(x) { f(▮ }')?.signatures[0].label).toBe('f(x)');
  });

  test('a non-BMP name', () => {
    const result = help('function 𝑓(𝑥: real) { 𝑥 }\n𝑓(▮');
    expect(result?.callee).toBe('𝑓');
    expect(result?.signatures[0].label).toBe('𝑓(𝑥: real)');
    expect(parameterTexts(result)).toEqual(['𝑥: real']);
  });

  test('a callee that is not a name, or unknown, gives null', () => {
    expect(help('(f)(▮')).toBeNull();
    expect(help(F + '(f)(▮')).toBeNull();
    expect(help('zzz(▮')).toBeNull();
    expect(help('xs.map(▮')).toBeNull();
    expect(help('function f(▮')).toBeNull();
    expect(help('if (▮')).toBeNull();
    // A `(` after whitespace is a group, not a call.
    expect(help('let a = sin\n(b▮ + c)')).toBeNull();
  });
});

describe('EPSIL SIGNATURE HELP: ACTIVE PARAMETER', () => {
  test('a partial call', () => {
    const result = help(F + 'f(1, ▮');
    expect(result?.activeParameter).toBe(1);
    expect(help('sin(▮')?.callee).toBe('sin');
  });

  test('the cursor right after the opening parenthesis', () => {
    expect(help(F + 'f(▮1, 2)')?.activeParameter).toBe(0);
    expect(help(F + 'f(▮')?.activeParameter).toBe(0);
  });

  test('the commas before the offset', () => {
    expect(help(F + 'f(1, ▮)')?.activeParameter).toBe(1);
    expect(help(F + 'f(1, x▮yz)')?.activeParameter).toBe(1);
  });

  test('a nested call: the innermost call', () => {
    const result = help(F + 'f(1, sin(▮');
    expect(result?.callee).toBe('sin');
    expect(result?.activeParameter).toBe(0);
  });

  test('the commas inside a nested call do not count', () => {
    expect(help(F + 'f(max(2, 3), ▮')?.callee).toBe('f');
    expect(help(F + 'f(max(2, 3), ▮')?.activeParameter).toBe(1);
  });

  test('the commas inside a list literal do not count', () => {
    expect(help(F + 'f([1, 2], ▮)')?.activeParameter).toBe(1);
    // Inside the list: the list is the first argument of `f`.
    expect(help(F + 'f([1, ▮')?.activeParameter).toBe(0);
  });

  test('after an operand: the call is from the tokens', () => {
    expect(help('join(1 ▮')?.callee).toBe('join');
    expect(help('join(1 ▮)')?.callee).toBe('join');
    expect(help(F + 'f(sin(1)▮, 2)')?.callee).toBe('f');
    expect(help(F + 'f(sin(1)▮, 2)')?.activeParameter).toBe(0);
    expect(help(F + 'f(sin(1) ▮, 2)')?.activeParameter).toBe(0);
  });

  test('in the name of a nested call', () => {
    const result = help(F + 'f(1, si▮n(2))');
    expect(result?.callee).toBe('f');
    expect(result?.activeParameter).toBe(1);
  });

  test('a named argument selects the parameter of that name', () => {
    expect(help(F + 'f(n: ▮)')?.activeParameter).toBe(1);
    expect(help(F + 'f(n▮: 2)')?.callee).toBe('f');
    expect(help(F + 'f(n▮: 2)')?.activeParameter).toBe(1);
    expect(help(F + 'f(1, n▮: 2)')?.activeParameter).toBe(1);
    expect(help(F + 'f(m: ▮)')?.activeParameter).toBe(-1);
    // A colon merged with an operator, and a verbatim name.
    expect(help(F + 'f(n:-1▮)')?.activeParameter).toBe(1);
    expect(help(F + 'f(`n`: 1▮)')?.activeParameter).toBe(1);
  });

  test('a rest parameter stays active', () => {
    const source = 'function g(x, ...rest) { x }\n';
    const result = help(source + 'g(1, 2, 3, ▮)');
    expect(result?.signatures[0].label).toBe('g(x, ...rest)');
    expect(result?.activeParameter).toBe(1);
  });

  test('a variadic library parameter stays active', () => {
    expect(help('max(1, 2, 3, ▮')?.activeParameter).toBe(0);
  });

  test('an argument past the last parameter gives -1', () => {
    const result = help(F + 'f(1, 2, ▮)');
    expect(result?.activeSignature).toBe(0);
    expect(result?.activeParameter).toBe(-1);
  });
});

describe('EPSIL SIGNATURE HELP: FUNCTIONS OF THE SOURCE', () => {
  test('a function with several clauses: one signature per clause', () => {
    const result = help(
      'function f(x) { x }\nfunction f(x, y) { x + y }\nf(1, ▮'
    );
    expect(result?.signatures.map((s) => s.label)).toEqual(['f(x)', 'f(x, y)']);
    expect(result).toMatchObject({ activeSignature: 1, activeParameter: 1 });
  });

  test('a full signature with a type of the source', () => {
    const result = help(
      'type Point = tuple<x: real, y: real>\nfunction h(p: Point) pure -> real { 1 }\nh(▮'
    );
    expect(result?.signatures[0].label).toBe('h(p: Point) pure -> real');
  });

  test('a full signature that does not parse: the parameters, no result', () => {
    const result = help(
      'type Box<T> = tuple<T>\nfunction h(p: Box<real>) pure -> real { 1 }\nh(▮'
    );
    expect(result?.signatures[0].label).toBe('h(p: Box<real>)');
  });

  test('a variable whose type is an alias of a function type', () => {
    expect(
      help(
        'type alias G = (x: real) -> real\ntype alias F = G\nlet h: F = p => 1\nh(▮'
      )?.signatures[0].label
    ).toBe('h(x: real) -> real');
    // A cycle of aliases, and a nominal type (its values are not callable).
    expect(
      help('type alias F = G\ntype alias G = F\nlet h: F = p => 1\nh(▮')
    ).toBeNull();
    expect(help('type F = (real) -> real\nlet h: F = p => 1\nh(▮')).toBeNull();
  });
});

/** The marks of each parameter of a signature: `optional`, `rest` and
 * `implicit`. */
function marks(
  signature: EpsilSignatureHelp['signatures'][number] | undefined
): Record<string, unknown>[] | undefined {
  return signature?.parameters.map(
    ({
      name: _name,
      type: _type,
      range: _range,
      documentation: _documentation,
      sample: _sample,
      ...rest
    }) => rest
  );
}

const SHAPES = `protocol Shape {
  function area(self: Self) -> number
  function scale(self: Self, k: number) -> Self
}
type Circle = tuple<r: number> is Shape {
  function area(self: Circle) -> number { Pi * self.r^2 }
  function scale(self: Circle, k: number) -> Circle { Circle(self.r * k) }
}
const c: Circle = Circle(1)
`;

describe('EPSIL SIGNATURE HELP: PARAMETER KINDS', () => {
  test('an optional parameter of a library signature', () => {
    expect(marks(help('let a = transpose(▮')?.signatures[0])).toEqual([
      {},
      { optional: true },
      { optional: true },
    ]);
  });

  test('a variadic parameter of a library signature is a rest parameter', () => {
    expect(marks(help('let a = sum(▮')?.signatures[0])).toEqual([
      {},
      { rest: true },
    ]);
  });

  test('a call with no implicit argument has no marks', () => {
    const result = help('let a = take(▮');
    expect(result?.signatures.map(marks)).toEqual([
      [{}, {}],
      [{}, {}],
    ]);
  });

  test('a parameter of the source with a default value is optional', () => {
    const result = help('function f(a: real, b: real = 1) { a }\nf(▮');
    expect(result?.signatures[0].label).toBe('f(a: real, b: real?)');
    expect(marks(result?.signatures[0])).toEqual([{}, { optional: true }]);
  });

  test('a rest parameter of the source', () => {
    const result = help('function g(a, ...rest) { a }\ng(▮');
    expect(marks(result?.signatures[0])).toEqual([{}, { rest: true }]);
  });
});

describe('EPSIL SIGNATURE HELP: THE PIPED VALUE', () => {
  const XS = 'let xs = [1, 2]\n';

  test('the piped value fills the first parameter of `take`', () => {
    const result = help(XS + 'let a = xs |> take(▮');
    // An overload set: the arm for a string has no slot for a list, so it is
    // not marked and has no active parameter.
    expect(result?.signatures.map(marks)).toEqual([
      [{}, {}],
      [{ implicit: 'pipe' }, {}],
    ]);
    expect(result?.signatures.map((s) => s.activeParameter)).toEqual([-1, 1]);
    expect(result).toMatchObject({ activeSignature: 1, activeParameter: 1 });
  });

  test('the piped value fills the first parameter of `std::take`', () => {
    // A call by the qualified name is the call of the library function
    // (CE-1699).
    const result = help(XS + 'let a = xs |> std::take(▮');
    expect(result?.signatures.map(marks)).toEqual([
      [{}, {}],
      [{ implicit: 'pipe' }, {}],
    ]);
    expect(result).toMatchObject({ activeSignature: 1, activeParameter: 1 });
  });

  test('`std::take` is the library function when the source has a `take`', () => {
    const result = help(
      XS + 'function take(a, b, c) { a }\nlet a = xs |> std::take(▮'
    );
    expect(result?.signatures.map((s) => s.label)).toEqual([
      'take(xs: T, count: number) -> T where T: string',
      'take(xs: indexed_collection<T>, count: number) -> list<T> where T: any',
    ]);
    expect(result?.signatures.map(marks)).toEqual([
      [{}, {}],
      [{ implicit: 'pipe' }, {}],
    ]);
    expect(result).toMatchObject({ activeSignature: 1, activeParameter: 1 });
  });

  test('the piped value fills the collection of `map`', () => {
    const result = help(XS + 'let a = xs |> map(▮');
    expect(marks(result?.signatures[0])).toEqual([
      {},
      { rest: true, implicit: 'pipe' },
    ]);
    expect(result?.activeParameter).toBe(0);
  });

  test('a function of the source: the slot that the value fits', () => {
    const result = help('function g(n: integer, s: string) { n }\n"a" |> g(▮');
    expect(marks(result?.signatures[0])).toEqual([{}, { implicit: 'pipe' }]);
    expect(result?.activeParameter).toBe(0);
  });

  test('no mark when the call has no implicit argument', () => {
    // A `_` places the piped value.
    const result = help(XS + 'let a = xs |> take(_, ▮');
    expect(result?.signatures.map(marks)).toEqual([
      [{}, {}],
      [{}, {}],
    ]);
    expect(result?.activeParameter).toBe(1);
  });

  test('no mark when the slot depends on the arguments still to write', () => {
    // With one argument the piped value fills `initial`, with two the
    // collection, as the snippet `fold(reducer, initial)` assumes.
    const result = help(XS + 'let a = xs |> fold(▮');
    expect(marks(result?.signatures[0])).toEqual([{}, {}, {}]);
    expect(result?.activeParameter).toBe(0);
  });

  test('no mark when a `_` under the offset places the piped value', () => {
    const result = help(XS + 'let a = xs |> take(_▮');
    expect(result?.signatures.map(marks)).toEqual([
      [{}, {}],
      [{}, {}],
    ]);
    expect(result?.activeParameter).toBe(0);
  });

  test('no mark when the slot is not known', () => {
    // `ys` has no type.
    const result = help('let a = ys |> take(▮');
    expect(result?.signatures.map(marks)).toEqual([
      [{}, {}],
      [{}, {}],
    ]);
  });
});

describe('EPSIL SIGNATURE HELP: MEMBER CALLS', () => {
  test('a protocol function: the receiver fills its first parameter', () => {
    const result = help(SHAPES + 'c.scale(▮');
    expect(result).toMatchObject({
      callee: 'scale',
      activeSignature: 0,
      activeParameter: 1,
    });
    expect(result?.signatures[0].label).toBe(
      'scale(self: Circle, k: number) -> Circle'
    );
    expect(marks(result?.signatures[0])).toEqual([
      { implicit: 'receiver' },
      {},
    ]);
    expect(help(SHAPES + 'c.scale(k: ▮')?.activeParameter).toBe(1);
    // The receiver is the only parameter: no argument is expected.
    expect(help(SHAPES + 'c.area(▮')?.activeParameter).toBe(-1);
  });

  test('a field that holds a function', () => {
    const result = help(
      'const p: record{f: (x: real) -> real} = {f -> (x => x)}\np.f(▮'
    );
    expect(result?.signatures[0].label).toBe('f(x: real) -> real');
    expect(marks(result?.signatures[0])).toEqual([{}]);
    expect(result?.activeParameter).toBe(0);
  });

  test('a value made by the constructor of a nominal type', () => {
    const source = SHAPES.replace('const c: Circle', 'let c');
    const result = help(source + 'c.scale(▮');
    expect(marks(result?.signatures[0])).toEqual([
      { implicit: 'receiver' },
      {},
    ]);
    expect(result?.activeParameter).toBe(1);
  });

  test('a field whose type is an alias of the source', () => {
    const result = help(
      'type alias F = (x: real) -> real\n' +
        'const p: record{f: F} = {f -> (x => x)}\np.f(▮'
    );
    expect(result?.signatures.length).toBe(1);
    expect(marks(result?.signatures[0])).toEqual([{}]);
    expect(result?.activeParameter).toBe(0);
  });

  test('a member that does not resolve to one function gives null', () => {
    expect(help(SHAPES + 'c.zz(▮')).toBeNull();
    expect(help(SHAPES + 'c.r(▮')).toBeNull();
    // A receiver with no type.
    expect(help('ys.scale(▮')).toBeNull();
    // A library function is not a member of a list
    // (`dot-call-not-a-protocol-function`).
    expect(help('let xs = [1, 2]\nlet a = xs.take(▮')).toBeNull();
  });
});

describe('EPSIL SIGNATURE HELP: NO CALL', () => {
  test('the parameters of a function header with a verbatim name', () => {
    expect(help('function f(a: real) { a }\nfunction `f`(x, ▮')).toBeNull();
  });

  test('outside a call', () => {
    expect(help('▮')).toBeNull();
    expect(help('let a = ▮')).toBeNull();
    expect(help('sin(1)▮')).toBeNull();
    expect(help('sin(1) ▮')).toBeNull();
  });

  test('in a string', () => {
    expect(help('let s = "sin(▮"')).toBeNull();
  });

  test('in a comment', () => {
    expect(help('// sin(▮')).toBeNull();
    expect(help('/* sin(▮ */')).toBeNull();
  });
});

describe('EPSIL COMPLETION: LIBRARY DESCRIPTION', () => {
  test('a library item has the paragraphs of its description', () => {
    const join = epsilCompletions(ce, 'joi', 3).items.find(
      (i) => i.label === 'join'
    );
    expect(join?.documentation).toBe(
      'Join the elements of some collections into a flat collection.'
    );
    expect(join?.description?.[0]).toBe(join?.documentation);
    expect(join?.description?.length).toBeGreaterThan(1);
  });

  test('a name of the source has no description', () => {
    const count = epsilCompletions(ce, 'let count = 1\nco', 16).items.find(
      (i) => i.label === 'count'
    );
    expect(count?.description).toBeUndefined();
  });
});
