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
// The design is `docs/plans/2026-10-31-parameter-default-values.md` (R7).
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

  // The parser cannot see scopes, so it refuses only the exact names. The
  // library constant spelled `missing` is refused by the engine after name
  // resolution; a user binding or a backticked name `missing` is a valid
  // symbol default.
  test('the library constant `missing` is refused after name resolution', () => {
    expect(parseDiagnostics(`(x, k = missing) => x`)).toEqual([]);
    const r = run('let f = (x, k = missing) => x\nf(3)');
    expect(r.diagnostics.map((m) => m[m.length - 1])).toContain(
      'expected-a-literal-default'
    );
  });

  test('a user binding named `missing` is a valid default', () => {
    expect(
      value('let missing = 7\nlet f = (x, k = missing) => x + k\nf(3)')
    ).toBe(10);
    expect(value('let f = (x, k = `missing`) => x\nf(3)')).toBe(3);
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

  test('a symbol default is read as if the caller wrote it', () => {
    expect(value('let s = (x, mode = Auto) => [x, mode]\ns(1)')).toEqual([
      'List',
      1,
      'Auto',
    ]);
    // A lowercase library spelling resolves as in a call.
    expect(value('let s = (x, k = pi) => x * k\ns(1)')).toBe('Pi');
    expect(value('let d = 2\nlet s = (x, k = d) => x * k\ns(3)')).toBe(6);
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
      'function f(x: number, k: number = 2) -> number { x * k }\nlet g = (xs = [], mode = Auto) => xs'
    );
    expect(describeName(ce, 'f')?.signature).toBe(
      '(x: number, k: number = 2) -> number'
    );
    expect(describeName(ce, 'g')?.type).toBe(
      '(xs: unknown = [], mode: unknown = Auto) -> unknown'
    );
  });
});
