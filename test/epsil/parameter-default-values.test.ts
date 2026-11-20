import { operand, operator } from '../../src/math-json/utils';
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
  expect(operator(value)).toBe('Program');
  return strip(operand(value, 1)!);
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
    const ops = strip(operand(expr, 1)!) as any[];
    expect(ops[0]).toBe('Function');
    expect(ops[ops.length - 1]).toEqual(param);
  });

  test('`(k == 2) -> k` is a pair, not a lambda', () => {
    expect(strip(operand(parseEpsil('(k == 2) -> k')[0], 1)!)).toEqual([
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
    expect(strip(operand(expr, 1)!)).toEqual(['Function', 'x', 'x', 'k']);
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
});

describe('PARAMETER DEFAULT VALUES — protocol requirements', () => {
  // CE-1554: the REQUIREMENT owns the default, the dispatcher fills it, and
  // every implementation receives the full argument list.
  const SCALABLE = `protocol Scalable {
  function scale(self, k: number = 2) -> number
}
type Money = tuple<cents: integer>
`;
  const IMPLEMENTED = `${SCALABLE}type Money is Scalable {
  function scale(self: Money, k: number) -> number { self.cents * k }
}
`;

  test('a call that leaves the argument out receives the default', () => {
    expect(
      value(
        `${IMPLEMENTED}[scale(Money(3)), Money(3).scale(), Scalable.scale(Money(3))]`
      )
    ).toEqual(['List', 6, 6, 6]);
  });

  test('an argument that the call supplies is passed', () => {
    expect(
      value(
        `${IMPLEMENTED}[scale(Money(3), 5), Money(3).scale(5), Scalable.scale(Money(3), 5)]`
      )
    ).toEqual(['List', 15, 15, 15]);
  });

  test('the canonical call keeps the arguments as written', () => {
    // The default is filled when the call is evaluated, from the requirement
    // that dispatch selects, so that a later declaration of the protocol
    // with another default applies to a call made before it. The default
    // of the dispatcher's signature is the placeholder `ProtocolDefault`,
    // which the canonical call drops after the last written argument.
    const { ce } = run(IMPLEMENTED);
    const short = ce.box(['scale', ['Money', 3]]);
    expect(short.json).toEqual(['scale', ['Money', 3]]);
    expect(short.evaluate().json).toBe(6);
    expect(ce.lookupDefinition('scale')?.operator?.signature.toString()).toBe(
      '(self: any, k: any = ProtocolDefault) -> unknown'
    );
  });

  test('a later declaration of the protocol with another default applies', () => {
    const ce = new ComputeEngine();
    const first = executeEpsil(
      ce,
      `protocol P { function f(self: Self, k: real = 2) -> real }
type Money = tuple<cents: integer>
type Money is P { function f(self: Money, k: real) -> real { k } }
function g(m: Money) { f(m) }
g(Money(1))`
    );
    expect(first.diagnostics).toEqual([]);
    expect(first.value?.json).toBe(2);
    const second = executeEpsil(
      ce,
      `protocol P { function f(self: Self, k: real = 3) -> real }
g(Money(1))`
    );
    expect(second.diagnostics).toEqual([]);
    expect(second.value?.json).toBe(3);
  });

  test('a default that the parameter type lists', () => {
    // `Auto` is not declared: the type lists it, so it is a constant.
    expect(
      value(`protocol P { function f(self: Self, mode: symbol<Auto> | symbol<Manual> = Auto) -> symbol }
type Money = tuple<cents: integer>
type Money is P { function f(self: Money, mode: symbol<Auto> | symbol<Manual>) -> symbol { mode } }
let x = Money(1)
[f(x), x.f(), P.f(x), f(x, Manual)]`)
    ).toEqual(['List', 'Auto', 'Auto', 'Auto', 'Manual']);
  });

  test('a symbol default is the constant of the declaring scope', () => {
    // A local `D` where the member is called does not replace the constant
    // `D` that the protocol was declared with.
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'const D = 5').diagnostics).toEqual([]);
    const r = executeEpsil(
      ce,
      `protocol P { function f(self: Self, k: real = D) -> real }
type Money = tuple<cents: integer>
type Money is P { function f(self: Money, k: real) -> real { k } }
function g(m: Money) { let D = 100; [f(m), m.f(), P.f(m), P.f(m, D)] }
g(Money(1))`
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.json).toEqual(['List', 5, 5, 5, 100]);
  });

  test('a host implementation receives the value of a constant default', () => {
    const ce = new ComputeEngine();
    ce.declare('W', { value: 7, isConstant: true });
    ce.declareProtocol('Q', {
      functions: { q: '(self: Self, k: real = W) -> any' },
    });
    ce.declareProtocolImplementation('real', 'Q', {
      functions: {
        q: (_x: any, k: any) => ce.string(JSON.stringify(k.json)),
      },
    });
    expect(ce.box(['q', 1]).evaluate().json).toBe("'7'");
    expect(ce.box(['q', 1, 'W']).evaluate().json).toBe("'7'");
  });

  test('under `.N()` a default keeps its exact source near a jump', () => {
    // The float of `(25! - 1)/24!` is 25; its floor is 24.
    const ce = new ComputeEngine();
    ce.declare('D', {
      value: ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]],
      isConstant: true,
    });
    expect(
      executeEpsil(
        ce,
        `protocol P { function f(self: Self, k: real = D) -> integer }
type Money = tuple<cents: integer>
type Money is P { function f(self: Money, k: real) -> integer { floor(k) } }`
      ).diagnostics
    ).toEqual([]);
    const n = (x: any) => ce.box(x).N().toString();
    expect(n(['f', ['Money', 1]])).toBe('24');
    expect(n(['f', ['Money', 1], 'D'])).toBe('24');
    expect(n(['ProtocolMember', "'P'", "'f'", ['Money', 1]])).toBe('24');
  });

  test('a constant default declared again by a later program is read with its new value', () => {
    // CE-1557: the default is resolved in the declaring scope when it is
    // filled, not once when the protocol is declared.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'const W = 9');
    const declared = executeEpsil(
      ce,
      [
        'const W = 2',
        'protocol P { function scaled(self: Self, k: real = W) -> real }',
        'type real is P { function scaled(self: real, k: real) -> real { self * k } }',
        'P.scaled(3)',
      ].join('\n')
    );
    expect(declared.diagnostics).toEqual([]);
    expect(declared.value.json).toEqual(6);
    expect(executeEpsil(ce, 'scaled(3)').value.json).toEqual(6);
    executeEpsil(ce, 'const W = 5');
    expect(executeEpsil(ce, 'scaled(3)').value.json).toEqual(15);
    expect(executeEpsil(ce, 'P.scaled(3)').value.json).toEqual(15);
    expect(
      executeEpsil(ce, 'function g(v: real) { let W = 100; scaled(v) }\ng(3)')
        .value.json
    ).toEqual(15);
    // A value of `P.scaled` stored before reads the new value too.
    executeEpsil(ce, 'let h = P.scaled');
    executeEpsil(ce, 'const W = 7');
    expect(executeEpsil(ce, 'h(3)').value.json).toEqual(21);
  });

  test('under `.N()` a local of the caller does not replace a constant default', () => {
    // The `floor` makes the body read the exact source of `k` under `.N()`.
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'const D = 5').diagnostics).toEqual([]);
    const r = executeEpsil(
      ce,
      `protocol P { function f(self: Self, k: real = D) -> real }
type Money = tuple<cents: integer>
type Money is P { function f(self: Money, k: real) -> real { floor(k) } }
function g(m: Money) { let D = 100; f(m) }`
    );
    expect(r.diagnostics).toEqual([]);
    const call = ce.box(['g', ['Money', 1]]);
    expect(call.N().toString()).toBe('5');
  });

  test('a default reaches a host implementation as a written operand', () => {
    // The `materialization` option is for the result of the call: the
    // implementation receives the lazy `Range`, not its preview.
    const ce = new ComputeEngine();
    ce.declare('R', { value: ['Range', 1, 5000], isConstant: true });
    ce.declareProtocol('Q', {
      functions: { q: '(self: Self, k: any = R) -> any' },
    });
    ce.declareProtocolImplementation('real', 'Q', {
      functions: { q: (_x: any, k: any) => k.count },
    });
    expect(ce.box(['q', 1]).evaluate({ materialization: [5, 5] }).json).toBe(
      5000
    );
    expect(
      ce.box(['q', 1, 'R']).evaluate({ materialization: [5, 5] }).json
    ).toBe(5000);
  });

  test('a named argument skips a parameter with a default', () => {
    // The bare and the method call hold the placeholder `ProtocolDefault`
    // at the skipped position, and the dispatcher replaces it with the
    // default of the selected requirement.
    const ce = new ComputeEngine();
    const declarations = `protocol S { function sc(self: Self, a: real = 1, b: real = 2) -> real }
type Money = tuple<cents: integer>
type Money is S { function sc(self: Money, a: real, b: real) -> real { a * 10 + b } }
let x = Money(1)`;
    const r = executeEpsil(
      ce,
      `${declarations}\n[sc(x, 3), S.sc(x, b: 5), sc(x, b: 5), x.sc(b: 5), sc(x), x.sc()]`
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.json).toEqual(['List', 32, 15, 15, 15, 12, 12]);
    // In a later program.
    const later = executeEpsil(ce, '[sc(x, b: 7), x.sc(b: 8)]');
    expect(later.diagnostics).toEqual([]);
    expect(later.value?.json).toEqual(['List', 17, 18]);
  });

  test('a skipped parameter receives the default of the selected requirement', () => {
    const r =
      value(`protocol A { function sc(self: Self, a: real = 1, b: real = 2) -> real }
protocol B { function sc(self: Self, a: real = 7, b: real = 2) -> real }
type Money = tuple<cents: integer>
type Euro = tuple<cents: integer>
type Money is A { function sc(self: Money, a: real, b: real) -> real { a * 10 + b } }
type Euro is B { function sc(self: Euro, a: real, b: real) -> real { a * 10 + b } }
[sc(Money(1), b: 5), sc(Euro(1), b: 5), Euro(1).sc(b: 3)]`);
    expect(r).toEqual(['List', 15, 75, 73]);
  });

  test('a host implementation receives the default of a skipped parameter', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Q', {
      functions: { q: '(self: Self, a: real = 1, b: real = 2) -> any' },
    });
    ce.declareProtocolImplementation('real', 'Q', {
      functions: { q: (_x: any, a: any, b: any) => ce.box(['List', a, b]) },
    });
    expect(
      ce.box(['q', 5, ['NamedArgument', { str: 'b' }, 7]]).evaluate().json
    ).toEqual(['List', 1, 7]);
    const r = executeEpsil(ce, 'q(5, b: 7)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.json).toEqual(['List', 1, 7]);
  });

  test('a skipped middle parameter keeps the exact sources of the later arguments under .N()', () => {
    // `(1/49) * 49` is `0.9999999999999999` in floating point: `floor` gives
    // 1 only with the exact source of `b`, which stays at its position after
    // the default fills the skipped `a`. The placeholder that the Epsil
    // serializer writes for the skipped slot reads back as the same call.
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      [
        'protocol S { function sc(self: Self, a: real = 1, b: real = 2) -> real }',
        'type Money = tuple<cents: integer>',
        'type Money is S { function sc(self: Money, a: real, b: real) -> real { floor(a * b * 49) } }',
        'let x = Money(1)',
      ].join('\n')
    );
    const value = (src: string) => executeEpsil(ce, src).value.json;
    expect(value('N(sc(x, b: 1/49))')).toEqual({ num: '1.0' });
    expect(value('N(sc(x, 1, 1/49))')).toEqual({ num: '1.0' });
    expect(value('sc(x, ProtocolDefault, 1/49)')).toEqual(1);
  });

  test('a call that leaves out a parameter with a default prints as written', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `protocol Figure { function stroke(self: Self, color: string, width: real = 1, dash: real = 0) -> Self }
type Pen = tuple<color: string, width: real, dash: real>
type Pen is Figure { function stroke(self: Pen, color: string, width: real, dash: real) -> Pen { Pen(color, width, dash) } }
let p = Pen("black", 3, 0)`
    );
    expect(r.diagnostics).toEqual([]);
    const call = ce.box(['stroke', 'p', { str: 'red' }]);
    expect(call.json).toEqual(['stroke', 'p', "'red'"]);
    expect(call.latex).toBe('\\mathrm{stroke}(p, \\text{red})');
    expect(serializeEpsil(call.json)).toBe('stroke(p, "red")');
    expect(call.isSame(ce.box(['stroke', 'p', { str: 'red' }]))).toBe(true);
    // A position that a named argument skips holds the placeholder, which
    // reads back as the same call.
    const skipped = ce.box([
      'stroke',
      'p',
      { str: 'red' },
      ['NamedArgument', { str: 'dash' }, 2],
    ]);
    expect(skipped.json).toEqual([
      'stroke',
      'p',
      "'red'",
      'ProtocolDefault',
      2,
    ]);
    expect(serializeEpsil(skipped.json)).toBe(
      'stroke(p, "red", ProtocolDefault, 2)'
    );
    expect(ce.box(skipped.json).isSame(skipped)).toBe(true);
    expect(ce.parse(skipped.latex).isSame(skipped)).toBe(true);
    expect(skipped.evaluate().json).toEqual(['Pen', "'red'", 1, 2]);
  });

  test('an implementation with an optional parameter without a default is refused', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('S', {
      functions: { sc: '(self: Self, k: number = 2) -> number' },
    });
    const r = ce
      .box([
        'DeclareConformance',
        { str: 'real' },
        ['List', 'S'],
        [
          'Dictionary',
          [
            'KeyValuePair',
            'sc',
            [
              'Function',
              1,
              ['Typed', 'self', { str: 'real' }],
              ['Optional', ['Typed', 'k', { str: 'number' }]],
            ],
          ],
        ],
      ] as any)
      .evaluate();
    expect(JSON.stringify(r.json)).toContain(
      'argument 2 is optional; an implementation takes every parameter of the requirement'
    );
  });

  test('a supplied absent value is passed, not replaced by the default', () => {
    // As for every other function: a default fills only an argument that
    // the call leaves out.
    expect(
      value(`protocol Probe { function probe(self: Self, k: any = 2) -> boolean }
type Money = tuple<cents: integer>
type Money is Probe { function probe(self: Money, k) -> boolean { isMissing(k) } }
[probe(Money(3)), probe(Money(3), Missing), Money(3).probe(Missing)]`)
    ).toEqual(['List', 'False', 'True', 'True']);
  });

  test('an implementation may repeat the default', () => {
    expect(
      value(`${SCALABLE}type Money is Scalable {
  function scale(self: Money, k: number = 2) -> number { self.cents * k }
}
scale(Money(4))`)
    ).toBe(8);
  });

  test('an implementation that leaves out the parameter with a default is refused', () => {
    const r = run(`${SCALABLE}type Money is Scalable {
  function scale(self: Money) -> number { self.cents }
}`);
    expect(JSON.stringify(r.value)).toContain('protocol-signature-mismatch');
    expect(JSON.stringify(r.value)).toContain(
      'it takes 1 parameter; the requirement takes 2, and an implementation takes the parameters with a default value too'
    );
  });

  test('an implementation that declares another default is refused', () => {
    const r = run(`${SCALABLE}type Money is Scalable {
  function scale(self: Money, k: number = 3) -> number { self.cents * k }
}`);
    expect(JSON.stringify(r.value)).toContain('protocol-signature-mismatch');
    expect(JSON.stringify(r.value)).toContain(
      'argument 2 declares the default value 3; the requirement declares 2'
    );
  });

  test('a default on a parameter whose type mentions `Self` is refused', () => {
    expect(
      run(`protocol Figure {
  function rotate(self: Self, angle: real, about: Self = 0) -> Self
}`).value
    ).toEqual([
      'Error',
      [
        'ErrorCode',
        "'invalid-protocol-declaration'",
        `'The signature of \`Figure.rotate\` declares a default value on the parameter "about" of type \`Self\`; a default value of a protocol member cannot be on a parameter whose type mentions \`Self\`'`,
      ],
      "'Figure'",
    ]);
  });

  test('an optional parameter without a default is refused', () => {
    expect(
      JSON.stringify(
        run(`protocol Scalable { function scale(self, k: number?) -> number }`)
          .value
      )
    ).toContain(
      'declares an optional argument without a default value; a protocol member may not be variadic or generic, and an optional argument must have a default value'
    );
  });

  test('a default that is not a constant, or does not fit its type, is refused', () => {
    expect(
      JSON.stringify(
        run(`protocol P { function f(self, k: real = "a") -> real }`).value
      )
    ).toContain(
      'the default value \\"a\\" of the parameter \\"k\\" does not match its type \\"real\\"'
    );
    expect(
      JSON.stringify(
        run(`protocol P { function f(self, k: real = W) -> real }`).value
      )
    ).toContain('a default value is a constant');
  });

  test('a `const` declared above the protocol in the same program is a constant for its default', () => {
    // CE-1557: as for a function default, a constant declared above the
    // `protocol` statement is admitted; one declared below it, or a `let`,
    // is not. A constant of an earlier program on the same engine is one too.
    const source = `protocol P { function f(self, k: real = W) -> real }`;
    const impl =
      'type real is P { function f(self: real, k: real) -> real { self * k } }';
    const above = run(`const W = 2\n${source}\n${impl}\nf(3)`);
    expect(above.diagnostics).toEqual([]);
    expect(above.value).toEqual(6);
    expect(JSON.stringify(run(`${source}\nconst W = 2`).diagnostics)).toContain(
      'a default value is a constant'
    );
    expect(JSON.stringify(run(`let W = 2\n${source}`).diagnostics)).toContain(
      'a default value is a constant'
    );
    // Its type is checked when the default is filled.
    const text = run(`const W = "abc"\n${source}\n${impl}\nf(3)`);
    expect(JSON.stringify(text.value)).toContain('incompatible-type');
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'const W = 2').diagnostics).toEqual([]);
    expect(executeEpsil(ce, source).value?.json).toBe('Nothing');
    // What an earlier program left does not decide: a `const` of another
    // type is declared again, and a `let` hides an earlier constant.
    const retyped = new ComputeEngine();
    executeEpsil(retyped, 'const W = "abc"');
    const again = executeEpsil(
      retyped,
      `const W = 2\n${source}\n${impl}\nf(3)`
    );
    expect(again.diagnostics).toEqual([]);
    expect(again.value.json).toEqual(6);
    // A function statement of the program still checks the type of the
    // constant at declaration, against the binding the program hoists.
    expect(
      JSON.stringify(
        run(`const W = "abc"\nfunction f(k: real = W) -> real { k }`)
          .diagnostics
      )
    ).toContain('expected `real`, got `string` at `W`');
    const hidden = new ComputeEngine();
    executeEpsil(hidden, 'const W = 9');
    expect(
      JSON.stringify(
        executeEpsil(hidden, `let W = 2\n${source}`).diagnostics.map(
          (d) => d.message
        )
      )
    ).toContain('a default value is a constant');
  });

  test('two protocols that give the member different defaults', () => {
    // The dispatcher's signature carries the placeholder `ProtocolDefault`,
    // and the default of the requirement that dispatch selects is filled when
    // the call is evaluated.
    const r =
      run(`protocol A { function scale(self: Self, k: real = 2) -> real }
protocol B { function scale(self: Self, k: real = 3) -> real }
type Money = tuple<cents: integer>
type Coin = tuple<n: integer>
type Money is A { function scale(self: Money, k: real) -> real { self.cents * k } }
type Coin is B { function scale(self: Coin, k: real) -> real { self.n * k } }
[scale(Money(3)), scale(Coin(3)), scale(Coin(3), 1), A.scale(Money(1)), B.scale(Coin(1))]`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toEqual(['List', 6, 9, 3, 2, 3]);
    expect(r.ce.lookupDefinition('scale')?.operator?.signature.toString()).toBe(
      '(self: any, k: any = ProtocolDefault) -> unknown'
    );
  });

  test('a receiver whose type is decided when the call runs', () => {
    expect(value(`${IMPLEMENTED}function g(m) { scale(m) }\ng(Money(3))`)).toBe(
      6
    );
  });

  test('a member with a library twin: the twin receives the arguments as written', () => {
    // `round` is the Epsil spelling of the library `Round`. A first argument
    // that conforms calls the member with the default; one that conforms to
    // no protocol of the member calls `Round` with its one argument.
    expect(
      value(`protocol Roundable { function round(self: Self, digits: integer = 0) -> real }
type Money = tuple<cents: integer>
type Money is Roundable { function round(self: Money, digits: integer) -> real { self.cents + digits } }
[round(Money(3)), round(Money(3), 2), Money(3).round(), Roundable.round(Money(3)), round(2.7)]`)
    ).toEqual(['List', 3, 5, 3, 3, 3]);
  });

  test('a protocol declared by the host takes defaults too', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Sized', {
      functions: { size: '(self: Self, scale: real = 10) -> real' },
    });
    ce.declareProtocolImplementation('real', 'Sized', {
      functions: { size: (x: any, k: any) => x.re * k.re },
    });
    expect(ce.box(['size', 3]).evaluate().json).toBe(30);
    expect(ce.box(['size', 3, 2]).evaluate().json).toBe(6);
    expect(
      ce.box(['ProtocolMember', "'Sized'", "'size'", 3]).evaluate().json
    ).toBe(30);
    expect(ce.box(['size', 1, 2, 3]).evaluate().toString()).toContain(
      'unexpected-argument'
    );
  });

  test('the Figure example of CE-1554', () => {
    // The constant `Origin` is declared by an earlier program, as a prelude
    // declares it.
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'const Origin = (0, 0)').diagnostics).toEqual([]);
    const r = executeEpsil(
      ce,
      `protocol Figure {
  function rotate(self: Self, angle: real, about: tuple<real, real> = Origin) -> Self
  function stroke(self: Self, color: string, width: real = 1) -> Self
}
type Box = tuple<w: real, about: tuple<real, real>, color: string, width: real>
type Box is Figure {
  function rotate(self: Box, angle: real, about: tuple<real, real>) -> Box { Box(self.w + angle, about, self.color, self.width) }
  function stroke(self: Box, color: string, width: real) -> Box { Box(self.w, self.about, color, width) }
}
let r = Box(1, (5, 5), "black", 3)
[r.rotate(2), r.rotate(2, (1, 2)), rotate(r, 2), Figure.rotate(r, 2), Figure.rotate(r, 2, (3, 4)), r.stroke("red"), r.stroke("red", 4)]`
    );
    expect(r.diagnostics).toEqual([]);
    const box = (about: unknown, color: string, width: number) => [
      'Box',
      3,
      about,
      `'${color}'`,
      width,
    ];
    expect(r.value?.json).toEqual([
      'List',
      box(['Tuple', 0, 0], 'black', 3),
      box(['Tuple', 1, 2], 'black', 3),
      box(['Tuple', 0, 0], 'black', 3),
      box(['Tuple', 0, 0], 'black', 3),
      box(['Tuple', 3, 4], 'black', 3),
      ['Box', 1, ['Tuple', 5, 5], "'red'", 1],
      ['Box', 1, ['Tuple', 5, 5], "'red'", 4],
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
    expect(value('let g = (x, k = 2) => [x, isMissing(k)]\ng(1)')).toEqual([
      'List',
      1,
      'False',
    ]);
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
    // An unannotated Program variable keeps its coarse callable contract.
    expect(describeName(ce, 'g')?.type).toBe('function');
  });
});
