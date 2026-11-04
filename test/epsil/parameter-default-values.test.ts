import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { canonicalLibraryName } from '../../src/epsil/library-names';
import { describeName } from '../../src/cli/doc';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// Default values of parameters in Epsil: `function f(x, k: number = 2)`,
// `f(x, k = 2) = …`, `(x, k = 2) => …`, `(x, k: number = 2) => …`. A parameter
// with a default lowers to the `Function` operand `["Optional", param,
// default]`, and the engine completes a call that leaves the argument out.
//
// A default is a constant: a number, a string, `true` or `false`, `[]`,
// `{}`, a library constant (`pi`, `Integers`) or a symbol that the parameter
// type lists (`mode: symbol<Auto> | symbol<Manual> = Auto`). The engine
// refuses any other symbol default when the function is defined
// (`expected-a-literal-default`). A rest parameter with a default is refused
// by the parser (`default-value-invalid`). A default fills only an argument
// that the call leaves out; a value that the call supplies, also an absent
// one, is passed through.
//

/** Drop the parser's `sourceOffsets` decoration and the object spellings of
 * numbers and symbols, so an expected value can be written as plain
 * MathJSON. Strings keep their `{str}` wrapper (a bare string is a symbol). */
function strip(expr: any): any {
  if (Array.isArray(expr)) return expr.map(strip);
  if (expr !== null && typeof expr === 'object') {
    if ('fn' in expr) return expr.fn.map(strip);
    if ('sym' in expr) return expr.sym;
    if ('num' in expr) return Number(expr.num);
    if ('str' in expr) return { str: expr.str };
  }
  return expr;
}

/** The parsed MathJSON of a program that must parse without a diagnostic. */
function parse(source: string): MathJsonExpression {
  const [value, diagnostics] = parseEpsil(source);
  expect(diagnostics).toEqual([]);
  return strip(value);
}

/** The parse diagnostics of a program, as `[code, ...arguments]`. */
function parseDiagnostics(source: string): unknown[] {
  return parseEpsil(source)[1].map((d) => d.message);
}

function run(source: string) {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, source);
  return {
    ce,
    value: result.value?.json,
    diagnostics: result.diagnostics.map((d) => d.message),
  };
}

/** The value of a program that must run without a diagnostic. */
function value(source: string): unknown {
  const r = run(source);
  expect(r.diagnostics).toEqual([]);
  return r.value;
}

/** Parse then serialize a program with `serializeEpsil()`. */
function format(source: string): string {
  const [expr, diagnostics] = parseEpsil(source);
  expect(diagnostics).toEqual([]);
  return serializeEpsil(expr);
}

describe('PARAMETER DEFAULT VALUES — parse', () => {
  test('a typed parameter of a function definition', () => {
    expect(
      parse('function f(x: number, k: number = 2) -> number { x * k }')
    ).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', ['Multiply', 'x', 'k']], { str: 'number' }],
        ['Typed', 'x', { str: 'number' }],
        ['Optional', ['Typed', 'k', { str: 'number' }], 2],
      ],
    ]);
  });

  test('an untyped parameter of an anonymous function', () => {
    expect(parse('(x, k = 2) => x * k')).toEqual([
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Optional', 'k', 2],
    ]);
  });

  test('a typed parameter of an anonymous function', () => {
    expect(parse('(x, k: number = 2) => x * k')).toEqual([
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Optional', ['Typed', 'k', { str: 'number' }], 2],
    ]);
  });

  test('the only parameter of an anonymous function', () => {
    expect(parse('(k = 2) => k')).toEqual([
      'Function',
      'k',
      ['Optional', 'k', 2],
    ]);
    expect(parse('(k: string = "a") => k')).toEqual([
      'Function',
      'k',
      ['Optional', ['Typed', 'k', { str: 'string' }], { str: 'a' }],
    ]);
  });

  test('the math form of a definition', () => {
    expect(parse('f(x, k = 2) = x * k')).toEqual([
      'DefineFunction',
      'f',
      ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 2]],
    ]);
  });

  test('each kind of default value', () => {
    const params = (
      parse(
        '(x, a = -3, b = 0.5, c = NaN, d = -oo, e = "s", f = true, g = false, h = Auto, i = [], j = {}, k = {->}) => x'
      ) as any[]
    ).slice(3);
    expect(params.map((p: any[]) => p[2])).toEqual([
      -3,
      0.5,
      NaN,
      -Infinity,
      { str: 's' },
      'True',
      'False',
      'Auto',
      ['List'],
      ['Dictionary'],
      ['Dictionary'],
    ]);
  });

  test('`==` is a comparison, not a default', () => {
    expect(parseDiagnostics('(x, k == 2) => x')).toEqual([['symbol-expected']]);
  });

  test('`-NaN` is `NaN`', () => {
    expect((parse('(x, k = -NaN) => x') as any[])[3]).toEqual([
      'Optional',
      'k',
      NaN,
    ]);
  });

  // A lambda written with the wrong arrow `->` is diagnosed and recovered as
  // the intended function, with or without a default value.
  test.each([
    [
      '(x, k: number = 2) -> x',
      ['Optional', ['Typed', 'k', { str: 'number' }], 2],
    ],
    [
      '(k: number = 2) -> k',
      ['Optional', ['Typed', 'k', { str: 'number' }], 2],
    ],
    ['(x, k = 2) -> x', ['Optional', 'k', 2]],
    ['(k = 2) -> k', ['Optional', 'k', 2]],
  ])('a wrong-arrow lambda %s', (source, param) => {
    const [expr, diagnostics] = parseEpsil(source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['mapsto-arrow-expected'],
    ]);
    const ops = strip(expr) as any[];
    expect(ops[0]).toBe('Function');
    expect(ops[ops.length - 1]).toEqual(param);
  });

  test('`(k == 2) -> k` is a pair, not a lambda', () => {
    expect(strip(parseEpsil('(k == 2) -> k')[0])).toEqual([
      'KeyValuePair',
      ['Equal', 'k', 2],
      'k',
    ]);
  });
});

describe('PARAMETER DEFAULT VALUES — invalid defaults', () => {
  const INVALID =
    'a default value is a number, a string, a boolean, a symbol, `[]` or `{}`';
  const SYMBOL =
    'a default value is a constant: write a number, a string, a boolean, `[]`, `{}`, a constant (a library constant or a symbol declared constant) or a symbol that the parameter type lists, or pass the argument';

  test.each([
    ['an expression', '(x, k = x + 1) => x'],
    ['a list with elements', '(x, k = [1]) => x'],
    ['an interpolated string', '(x, s = "a\\(x)") => x'],
    ['a function definition', 'function f(x, k = x + 1) { x }'],
  ])('%s', (_, source) => {
    expect(parseDiagnostics(source)).toEqual([
      ['default-value-invalid', INVALID],
    ]);
  });

  test('a default that names a parameter of the same list', () => {
    expect(parseDiagnostics('(x, k = x) => x')).toEqual([
      ['default-value-invalid', 'a default value cannot name a parameter'],
    ]);
    // A parameter written AFTER the default counts too.
    expect(parseDiagnostics('function f(x, k = m, m = 1) { x }')).toEqual([
      ['default-value-invalid', 'a default value cannot name a parameter'],
    ]);
  });

  test('`Nothing` is not a default', () => {
    expect(parseDiagnostics('(x, k = Nothing) => x')).toEqual([
      [
        'default-value-invalid',
        '`Nothing` is not a default value; leave the parameter optional instead',
      ],
    ]);
  });

  test('`Missing` is not a default', () => {
    expect(parseDiagnostics(`(x, k = Missing) => x`)).toEqual([
      [
        'default-value-invalid',
        '`Missing` is not a default value; leave the parameter optional instead',
      ],
    ]);
  });

  // The parser cannot see scopes or the library, so it accepts a symbol
  // default. The engine checks that the symbol is constant when the function
  // is defined.
  test('a symbol default that names a variable is refused by the engine', () => {
    for (const source of [
      'let s = (x, k = Auto) => x\ns(1)',
      'let d = 2\nlet s = (x, k = d) => x * k\ns(3)',
      'let missing = 7\nlet f = (x, k = missing) => x + k\nf(3)',
    ]) {
      expect(parseDiagnostics(source)).toEqual([]);
      const r = run(source);
      expect(r.diagnostics[0]).toEqual([
        'static-type-error',
        expect.stringContaining(SYMBOL),
        expect.any(String),
        'expected-a-literal-default',
      ]);
    }
  });

  // A function statement is hoisted: it is defined before the `const` that
  // follows it has run, so the name is not a constant there, and the default
  // is refused, as a `let` is.
  test('a `const` declared after the function, or a `let`, is refused', () => {
    for (const source of [
      'function f(k = W) { k + 1 }; const W = 5; f()',
      'function g() { function f(k = W) { k + 1 }; const W = 5; f() }; g()',
      'let W = 5; function f(k = W) { k + 1 }; f()',
      'const W = 5; function g() { let W = 2; let h = (k = W) => k + 1; h() }; g()',
    ]) {
      const r = run(source);
      expect(r.diagnostics[0]).toEqual([
        'static-type-error',
        expect.stringContaining(SYMBOL),
        expect.any(String),
        'expected-a-literal-default',
      ]);
    }
  });

  test('the library constant `missing` is refused after name resolution', () => {
    expect(parseDiagnostics(`(x, k = missing) => x`)).toEqual([]);
    const r = run('let f = (x, k = missing) => x\nf(3)');
    expect(r.diagnostics.map((m) => m[m.length - 1])).toContain(
      'expected-a-literal-default'
    );
  });

  test('a function with a rest parameter has no default values', () => {
    expect(parseDiagnostics('(x, k = 2, ...r) => x')).toEqual([
      [
        'default-value-invalid',
        'a function with a rest parameter has no default values: drop the default or the rest parameter',
      ],
    ]);
  });

  test('a refused default leaves the parameter required', () => {
    const [expr] = parseEpsil('(x, k = x + 1) => x');
    expect(strip(expr)).toEqual(['Function', 'x', 'x', 'k']);
  });

  test('a `bind` parameter of a hold definition', () => {
    expect(parseDiagnostics('hold f(body, bind i = 1, n) = n')).toEqual([
      [
        'default-value-invalid',
        'a `bind` parameter of a `hold` definition cannot have a default value',
      ],
    ]);
  });

  test('a default beside a literal parameter (a multi-clause function)', () => {
    expect(parseDiagnostics('function f(0, k = 2) { k }')).toEqual([
      [
        'default-value-invalid',
        'a default value in an overloaded signature is not supported yet',
      ],
    ]);
  });

  test('a default in one clause of a multi-clause function', () => {
    // In either order, the definition that makes the second clause is
    // refused when it runs; the first definition stays.
    for (const source of [
      'function f(n, k = 2) { n }\nfunction f(0, k) { k }\nf(1)',
      'function f(0, k) { k }\nfunction f(n: number, k = 2) { n }\n0',
    ]) {
      const r = run(source);
      expect(
        r.diagnostics.some(
          (d) =>
            Array.isArray(d) &&
            d[0] === 'runtime-error' &&
            String(d[1]).includes(
              'a default value in an overloaded signature is not supported yet'
            )
        )
      ).toBe(true);
    }
  });

  test('a default that does not fit the parameter type', () => {
    const r = run('let f = (x, k: number = "a") => x');
    expect(r.diagnostics).toEqual([
      [
        'static-type-error',
        'expected `number`, got `string` at `a`',
        '(x, k: number = "a") => x',
        'incompatible-type',
      ],
    ]);
  });

  test('a protocol requirement with a default is refused', () => {
    // The same check as an optional parameter (`k: number?`): protocol
    // dispatch assumes a fixed arity.
    const r = run(`protocol Scalable {
  function scale(self, k: number = 2) -> number
}`);
    expect(r.value).toEqual([
      'Error',
      [
        'ErrorCode',
        "'invalid-protocol-declaration'",
        "'The signature of `Scalable.scale` declares an optional argument; a protocol member may not be optional, variadic or generic'",
      ],
      "'Scalable'",
    ]);
  });
});

describe('PARAMETER DEFAULT VALUES — evaluate', () => {
  test.each([
    ['function f(x: number, k: number = 2) -> number { x * k }'],
    ['f(x, k = 2) = x * k'],
    ['let f = (x, k = 2) => x * k'],
    ['let f = (x, k: number = 2) => x * k'],
    // An effect specifier: the signature marker lists `k` with its type.
    ['function f(x, k: number = 2) pure -> number { x * k }'],
  ])('%s', (definition) => {
    expect(value(`${definition}\n[f(3), f(3, 5)]`)).toEqual(['List', 6, 15]);
  });

  test('an inline anonymous function', () => {
    expect(value('((x, k = 2) => x * k)(3)')).toBe(6);
  });

  test('collection defaults', () => {
    expect(value('let g = (xs = []) => length(xs)\ng()')).toBe(0);
    expect(value('let g = (d = {}) => d\ng()')).toEqual({ dict: {} });
    expect(value('let g = (d = {->}) => d\ng()')).toEqual({ dict: {} });
  });

  test('a constant symbol default: a library constant, or a symbol that the type lists', () => {
    expect(value('let s = (x, k = pi) => x * k\ns(1)')).toBe('Pi');
    expect(value('let s = (x, over: set = Integers) => x in over\ns(1)')).toBe(
      'True'
    );
    expect(
      value(
        'let s = (x, mode: symbol<Auto> | symbol<Manual> = Auto) => [x, mode]\ns(1)'
      )
    ).toEqual(['List', 1, 'Auto']);
    expect(
      value(
        'function f(x, mode: symbol<Auto> | symbol<Manual> = Auto) { [x, mode] }\nf(1)'
      )
    ).toEqual(['List', 1, 'Auto']);
  });

  // A `const` of the same program, declared before the function, is a
  // constant default, also before the declaration has run (the static check
  // of the program canonicalizes the function without running the `const`).
  test('a `const` of the program declared before the function', () => {
    expect(value('const W = 5; function f(k = W) { k + 1 }; f()')).toBe(6);
    expect(value('const V = 5; let h = (k = V) => k + 1; h()')).toBe(6);
    // Any value of a `const` counts, as for a constant the host declares.
    expect(value('const W = [1]; function f(k = W) { k }; f()')).toEqual([
      'List',
      1,
    ]);
    expect(
      value(
        'function g() { const W = 5; function f(k = W) { k + 1 }; f() }; g()'
      )
    ).toBe(6);
    expect(
      value(
        'function g() { const W = 5; do { let h = (k = W) => k + 1; h() } }; g()'
      )
    ).toBe(6);
  });

  // A program run again on the same engine (a notebook cell edited and run
  // again) finds the binding that the earlier run left. The declaration of
  // the program that runs now decides, not that binding.
  test('a run on an engine that an earlier run left a binding in', () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'let W = 5').diagnostics).toEqual([]);
    const a = executeEpsil(ce, 'const W = 5; function f(k = W) { k + 1 }; f()');
    expect(a.diagnostics).toEqual([]);
    expect(a.value?.json).toBe(6);

    const ce2 = new ComputeEngine();
    expect(executeEpsil(ce2, 'const W = 5').diagnostics).toEqual([]);
    const b = executeEpsil(ce2, 'let W = 7; function f(k = W) { k }; f()');
    expect(b.diagnostics.map((d) => d.message[d.message.length - 1])).toContain(
      'expected-a-literal-default'
    );

    // A destructuring `let` makes each name of its pattern a variable, for
    // the static check too (not only for the run).
    const ce3 = new ComputeEngine();
    expect(executeEpsil(ce3, 'const W = 5').diagnostics).toEqual([]);
    const c = executeEpsil(
      ce3,
      'let (W, b) = (7, 0); function f(k = W) { k }; f()'
    );
    expect(
      c.diagnostics.map(
        (d) => `${d.message[0]}: ${d.message[d.message.length - 1]}`
      )
    ).toContain('static-type-error: expected-a-literal-default');
  });

  test('an argument that the call supplies is not replaced by the default', () => {
    expect(value('let g = (x, k = 2) => [x, k]\ng(1, 5)')).toEqual([
      'List',
      1,
      5,
    ]);
    expect(
      value('let g = (x, k = 2) => [x, isMissing(k)]\ng(1, Missing)')
    ).toEqual(['List', 1, 'True']);
    expect(
      value('let g = (x, k = 2) => [x, isMissing(k)]\ng(1)')
    ).toEqual(['List', 1, 'False']);
  });

  test('a hold definition with a default', () => {
    expect(value('hold f(e, k = 2) = [e, k]\nf(x + 1)')).toEqual([
      'List',
      ['Add', 'x', 1],
      2,
    ]);
  });

  test('a callback with a default is a unary key', () => {
    expect(value('sort([3, 1, 2], (x, k = 2) => x * k)')).toEqual([
      'List',
      1,
      2,
      3,
    ]);
  });

  test('a named argument skips a parameter with a default', () => {
    // `factor` is also the Epsil spelling of a library function: as a
    // parameter name it binds, and is not read as that function.
    expect(
      value(
        'function f(x, density: number = 1, factor: number = 2) { [x, density, factor] }\nf(3, factor: 5)'
      )
    ).toEqual(['List', 3, 1, 5]);
  });

  test('a named argument `Nothing` fills its slot, and a `number` parameter refuses it', () => {
    const r = run('function f(x, k: number = 2) { [x, k] }\nf(3, k: Nothing)');
    expect(JSON.stringify(r.diagnostics)).toMatch(/incompatible-type/);
  });

  test('a skipped optional parameter without a default is still a diagnostic', () => {
    const skipped = (signature: string) => {
      const ce = new ComputeEngine();
      ce.declare('g', signature);
      return executeEpsil(ce, 'g(3, c: 7)').diagnostics.some(
        (d) =>
          Array.isArray(d.message) &&
          d.message[3] === 'argument-optional-skipped'
      );
    };
    expect(
      skipped('(x: number, a: number = 1, b: number?, c: number?) -> number')
    ).toBe(true);
    expect(skipped('(x: number, a: number = 1, c: number?) -> number')).toBe(
      false
    );
  });
});

describe('PARAMETER DEFAULT VALUES — print', () => {
  test.each([
    'function f(x: number, k: number = 2) -> number {x * k}',
    'f(x, k = 2) = x * k',
    'hold f(e, k = 2) = e',
    'function f(x, k: number = 2) pure -> number {x * k}',
    'let g = (x, k = 2) => x * k',
    'let g = (x, xs = [], d = {}, s = "a", m = Auto, n = -3) => x',
  ])('%s', (source) => {
    expect(format(source)).toBe(source);
  });

  test('`Optional` has no library spelling', () => {
    expect(canonicalLibraryName('optional')).toBeUndefined();
    expect(serializeEpsil(['f', ['Optional', 'k', 2]])).not.toContain(
      'optional('
    );
  });

  test('a canonical function literal', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Optional', ['Typed', 'k', "'number'"], 2],
      ['Optional', 'd', ['Dictionary']],
      ['Optional', 's', "'hi'"],
    ]);
    expect(serializeEpsil(literal.json)).toBe(
      '(x, k: number = 2, d = {}, s = "hi") => do {k * x}'
    );
  });

  test('`epsil doc` shows the default in the signature', () => {
    const { ce } = run(
      'function f(x: number, k: number = 2) -> number { x * k }\nlet g = (xs = [], mode = "auto") => xs'
    );
    expect(describeName(ce, 'f')?.signature).toBe(
      '(x: number, k: number = 2) -> number'
    );
    expect(describeName(ce, 'g')?.type).toBe(
      '(xs: unknown = [], mode: unknown = "auto") -> unknown'
    );
  });
});
