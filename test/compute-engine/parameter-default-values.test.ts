import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import {
  typeToIdentityKey,
  typeToString,
} from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';
import { reduceType } from '../../src/common/type/reduce';
import { widenValueTypes } from '../../src/common/type/widen-value';
import { substituteTypeVariables } from '../../src/common/type/instantiate';
import type { FunctionSignature, Type } from '../../src/common/type/types';
import { parameterDefaultOperands } from '../../src/compute-engine/boxed-expression/parameter-defaults';
import { describe as describeOperand } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { widenUnannotatedLiteralParams } from '../../src/compute-engine/boxed-expression/validate';

// Default values for optional parameters (GitHub issue #490).
//
// A default is a constant: a number, a string, `True` or `False`, `[]` or
// `{}`. A symbol as a default is a static error: a declared signature
// throws, a function literal gets an error on the parameter, and a rest
// parameter with a default is an error too. (The type DSL still parses a
// symbol default, so that a printed type reads back; the declaration
// refuses it.)
//
// A default fills only an argument that the call leaves out: a call written
// with fewer arguments, a named call that skips the parameter, a hole of a
// named call, and a call that a consumer such as `Map`, `Sort` or `Iterate`
// makes with fewer arguments. A value that the call supplies is passed
// through, also an absent value (`Missing`, `NaN`).

/** The `rawMessage` of the error that parsing `s` throws. */
function parseError(s: string): string | undefined {
  try {
    parseType(s);
  } catch (e) {
    return (e as { rawMessage?: string }).rawMessage ?? (e as Error).message;
  }
  return undefined;
}

function optArgsOf(t: Type): FunctionSignature['optArgs'] {
  if (typeof t !== 'object' || t.kind !== 'signature')
    throw new Error(`not a signature: ${typeToString(t)}`);
  return t.optArgs;
}

describe('PARAMETER DEFAULT VALUES: TYPE DSL', () => {
  test.each([
    '(x: number, factor: number = 2) -> number',
    '(number, number = 2) -> number',
    '(x: number, s: string = "a b") -> number',
    '(x: number, flag: boolean = false) -> number',
    '(x: number, flag: boolean = true) -> number',
    '(x: number, branch: integer = -1) -> number',
    '(x: number, k: real = NaN) -> number',
    '(x: number, k: real = +oo) -> number',
    '(x: number, k: real = -oo) -> number',
    '(x: number, over: set = Integers) -> number',
    '(x: number, mode: symbol<Auto> | symbol<Manual> = Auto) -> number',
    '(x: number, xs: list<number> = []) -> number',
    '(x: number, opts: dictionary = {}) -> number',
    '(x: number, k: number = 2, m: number?) -> number',
    '(x: number, k: number = `my symbol`) -> number',
    '(x: number, f: (number) -> number = Sin) -> number',
    '(x: number, k: number = `True`) -> number',
    '(x: number, k: number = `NaN`) -> number',
    '(x: number, k: number = `oo`) -> number',
  ])('%s round-trips', (s) => {
    const printed = typeToString(parseType(s));
    expect(printed).toBe(s);
    expect(typeToIdentityKey(parseType(printed))).toBe(
      typeToIdentityKey(parseType(s))
    );
  });

  test('a parameter with a default is optional and stores the default', () => {
    const t = parseType(
      '(x: number, factor: number = 2, s: string = "a", over: set = Integers, xs: list = [], d: dictionary = {}) -> number'
    );
    expect(optArgsOf(t)).toEqual([
      { name: 'factor', type: 'number', default: { kind: 'value', value: 2 } },
      { name: 's', type: 'string', default: { kind: 'value', value: 'a' } },
      {
        name: 'over',
        type: 'set',
        default: { kind: 'symbol', name: 'Integers' },
      },
      { name: 'xs', type: 'list', default: { kind: 'empty-list' } },
      { name: 'd', type: 'dictionary', default: { kind: 'empty-dictionary' } },
    ]);
    expect(Object.isFrozen(optArgsOf(t)![0].default)).toBe(true);
  });

  test('`True` and `False` are the booleans `true` and `false`', () => {
    expect(typeToString(parseType('(flag: boolean = True) -> number'))).toBe(
      '(flag: boolean = true) -> number'
    );
    expect(typeToString(parseType('(flag: boolean = False) -> number'))).toBe(
      '(flag: boolean = false) -> number'
    );
    expect(
      typeToIdentityKey(parseType('(flag: boolean = True) -> number'))
    ).toBe(typeToIdentityKey(parseType('(flag: boolean = true) -> number')));
  });

  test('two signatures that differ only by a default have different identity keys and match each other', () => {
    const a = parseType('(x: number, k: number = 2) -> number');
    const b = parseType('(x: number, k: number = 3) -> number');
    const c = parseType('(x: number, k: number?) -> number');
    expect(typeToIdentityKey(a)).not.toBe(typeToIdentityKey(b));
    expect(typeToIdentityKey(a)).not.toBe(typeToIdentityKey(c));
    expect(isSubtype(a, b)).toBe(true);
    expect(isSubtype(b, a)).toBe(true);
    expect(isSubtype(a, c)).toBe(true);
    expect(isSubtype(c, a)).toBe(true);

    const ce = new ComputeEngine();
    const ta = ce.type('(x: number, k: number = 2) -> number');
    const tb = ce.type('(x: number, k: number = 3) -> number');
    expect(ta.toString()).toBe('(x: number, k: number = 2) -> number');
    expect(ta.matches(tb)).toBe(true);
    expect(tb.matches(ta)).toBe(true);
  });

  test('the default is kept through instantiate, reduce and widen', () => {
    const def = { kind: 'value', value: 2 } as const;
    const generic: Type = {
      kind: 'signature',
      args: [{ name: 'x', type: { kind: 'variable', name: 'T' } }],
      optArgs: [
        { name: 'k', type: { kind: 'variable', name: 'T' }, default: def },
      ],
      result: { kind: 'variable', name: 'T' },
    };
    const instantiated = substituteTypeVariables(generic, { T: 'number' });
    expect(instantiated).not.toBe(generic);
    expect(optArgsOf(instantiated)).toEqual([
      { name: 'k', type: 'number', default: def },
    ]);
    expect(typeToString(instantiated)).toBe(
      '(x: number, k: number = 2) -> number'
    );

    // A union of two numeric types reduces to the wider one, so the
    // parameter is rebuilt.
    const reducible: Type = {
      kind: 'signature',
      args: [{ name: 'x', type: 'number' }],
      optArgs: [
        {
          name: 'k',
          type: { kind: 'union', types: ['integer', 'number'] },
          default: def,
        },
      ],
      result: 'number',
    };
    const reduced = reduceType(reducible);
    expect(optArgsOf(reduced)).toEqual([
      { name: 'k', type: 'number', default: def },
    ]);

    // The literal value type `2` in the parameter of the parameter type
    // `(2) -> number` is in a covariant position and is widened, so the
    // parameter `k` is rebuilt.
    const widenable = parseType('(x: number, k: (2) -> number = F) -> number');
    const widened = widenValueTypes(widenable);
    expect(widened).not.toBe(widenable);
    expect(typeToString(widened)).toBe(
      '(x: number, k: (integer) -> number = F) -> number'
    );
    expect(optArgsOf(widened)![0].default).toEqual({
      kind: 'symbol',
      name: 'F',
    });
  });
});

describe('PARAMETER DEFAULT VALUES: PARSE ERRORS', () => {
  test.each([
    ['(x: number, k: number = 0x) -> number', '`0x` has no digits'],
    [
      '(x: number, k: number? = 2) -> number',
      'A parameter with a default value is optional; remove the `?`',
    ],
    [
      '(x: number, k: number = 2)',
      'A default value is allowed only in the argument list of a function signature',
    ],
    [
      '(number, number = 2)',
      'A default value is allowed only in the argument list of a function signature',
    ],
    [
      'tuple<x: number, k: number = 2>',
      'A default value is allowed only in the argument list of a function signature',
    ],
    [
      '(x: number, k: number* = 2) -> number',
      'A variadic parameter cannot have a default value',
    ],
    [
      '(x: number, k: number+ = 2) -> number',
      'A variadic parameter cannot have a default value',
    ],
    [
      '(x: number, a: number?, b: number = 2) -> number',
      'A parameter with a default value cannot follow an optional parameter without one',
    ],
    [
      '(x: number, k: number = 2, y: number) -> number',
      'A required parameter cannot follow a parameter with a default value',
    ],
    [
      '(x: number, k: number = x) -> number',
      'A default value cannot name a parameter: `x`',
    ],
    [
      '(k: number = y, y: number?) -> number',
      'A default value cannot name a parameter: `y`',
    ],
    [
      '(x: number, k: number = Nothing) -> number',
      '`Nothing` is not a default value; leave the parameter optional instead',
    ],
    [
      '(x: number, k: number = Missing) -> number',
      '`Missing` is not a default value; leave the parameter optional instead',
    ],
    ['(x: number, k: number = ~oo) -> number', '`~oo` is not a default value'],
    [
      '(x: number, xs: list = [1]) -> number',
      'The only list default value is the empty list `[]`',
    ],
    ['(x: number, k: number = ) -> number', 'Expected a default value'],
  ])('%s', (s, message) => {
    expect(parseError(s)).toBe(message);
  });

  test('a hexadecimal or binary default is decoded by its radix, as in a value type', () => {
    expect(typeToString(parseType('(x: number, k: number = 0x10) -> number'))).toBe(
      '(x: number, k: number = 16) -> number'
    );
    expect(typeToString(parseType('(x: number, k: number = -0x10) -> number'))).toBe(
      '(x: number, k: number = -16) -> number'
    );
    expect(typeToString(parseType('(x: number, k: number = 0b10) -> number'))).toBe(
      '(x: number, k: number = 2) -> number'
    );
  });

  test('a default and a variadic parameter do not mix, as optional and variadic do not', () => {
    expect(parseError('(k: number = 2, xs: number*) -> number')).toMatch(
      /optional/
    );
  });

  test('`ce.declare` accepts a signature with a default', () => {
    const ce = new ComputeEngine();
    ce.declare('S2', {
      signature: '(x: number, factor: number = 2) -> number',
      evaluate: (ops) => ops[0],
    });
    const def = ce.lookupDefinition('S2');
    expect(
      def !== undefined && 'operator' in def
        ? def.operator.signature.toString()
        : undefined
    ).toBe('(x: number, factor: number = 2) -> number');
    expect(ce.box('S2').type.toString()).toBe(
      '(x: number, factor: number = 2) -> number'
    );
  });
});

describe('PARAMETER DEFAULT VALUES: DECLARATION', () => {
  const ce = new ComputeEngine();
  let n = 0;
  /** Declare an operator with `signature` under a fresh name. Returns the
   * name, or throws as the declaration throws. */
  function declareOp(signature: string): string {
    const name = `DefaultOp${++n}`;
    ce.declare(name, { signature, evaluate: (ops) => ops[0] });
    return name;
  }
  function operatorDef(name: string) {
    const def = ce.lookupDefinition(name);
    if (def === undefined || !('operator' in def))
      throw new Error(`no operator definition for ${name}`);
    return def.operator;
  }
  function valueDef(name: string) {
    const def = ce.lookupDefinition(name);
    if (def === undefined || !('value' in def))
      throw new Error(`no value definition for ${name}`);
    return def.value;
  }
  const json = (xs: ReadonlyArray<{ json: unknown } | undefined> | undefined) =>
    xs?.map((x) => x?.json);

  test('a value default that does not match its parameter type is refused', () => {
    expect(() =>
      declareOp('(x: number, factor: number = "a") -> number')
    ).toThrow(
      /the default value "a" of the parameter "factor" does not match its type "number"/
    );
    expect(() => declareOp('(x: number, xs: number = []) -> number')).toThrow(
      /does not match its type/
    );
    expect(() => declareOp('(x: number, over: set = 3) -> number')).toThrow(
      /does not match its type/
    );
  });

  test('the boxed defaults are kept on the operator definition, aligned with the optional parameters', () => {
    const name = declareOp(
      '(x: number, factor: number = 2, s: string = "a", m: number?) -> number'
    );
    expect(json(parameterDefaultOperands(ce, operatorDef(name)))).toEqual([
      2,
      "'a'",
      undefined,
    ]);
    // A signature without a default has no default operands.
    expect(
      parameterDefaultOperands(
        ce,
        operatorDef(declareOp('(x: number, m: number?) -> number'))
      )
    ).toBeUndefined();
  });

  test('a symbol default that is not constant is a static error', () => {
    const message = (d: string, k: string) =>
      new RegExp(
        `the default value ${d} of the parameter "${k}": a default value is a constant: write a number, a string, a boolean, .*, or pass the argument`
      );
    // A symbol that is not declared, at a type that lists no symbol.
    expect(() =>
      declareOp('(x: number, mode: symbol = Automatic) -> number')
    ).toThrow(message('Automatic', 'mode'));
    expect(() =>
      declareOp('(x: number, k: number = UndeclaredNumberName) -> number')
    ).toThrow(message('UndeclaredNumberName', 'k'));
    // A symbol that names a variable.
    ce.declare('userDefaultValue', { value: 5 });
    expect(() =>
      declareOp('(x: number, k: number = userDefaultValue) -> number')
    ).toThrow(message('userDefaultValue', 'k'));
  });

  test('a constant symbol default: a library constant, or a symbol that the type lists', () => {
    expect(
      parameterDefaultOperands(
        ce,
        operatorDef(declareOp('(x: number, over: set = Integers) -> number'))
      )?.map((d) => d?.symbol)
    ).toEqual(['Integers']);
    expect(
      parameterDefaultOperands(
        ce,
        operatorDef(
          declareOp(
            '(x: number, mode: symbol<Auto> | symbol<Manual> = Auto) -> number'
          )
        )
      )?.map((d) => d?.symbol)
    ).toEqual(['Auto']);
    // A library constant must match the parameter type.
    expect(() =>
      declareOp('(x: number, k: number = Integers) -> number')
    ).toThrow(/does not match its type "number"/);
  });

  test('a symbol default is refused at the type of a function parameter too', () => {
    expect(() =>
      declareOp('(x: number, f: (number) -> number = Sin) -> number')
    ).toThrow(/a default value is a constant/);
  });

  test('a rest parameter with a default is a static error', () => {
    expect(() =>
      declareOp('(x: number, k: number = 2, ...xs: number) -> number')
    ).toThrow();
  });

  test('`[]` and `{}` are accepted at a list and a dictionary parameter, and the signature prints them', () => {
    const xs = declareOp('(x: number, xs: list<number> = []) -> number');
    expect(operatorDef(xs).signature.toString()).toBe(
      '(x: number, xs: list<number> = []) -> number'
    );
    expect(json(parameterDefaultOperands(ce, operatorDef(xs)))).toEqual([
      ['List'],
    ]);
    const opts = declareOp('(x: number, opts: dictionary = {}) -> number');
    expect(operatorDef(opts).signature.toString()).toBe(
      '(x: number, opts: dictionary = {}) -> number'
    );
    expect(json(parameterDefaultOperands(ce, operatorDef(opts)))).toEqual([
      { dict: {} },
    ]);
  });

  test('a default on a parameter whose type mentions a type variable is refused', () => {
    expect(() => declareOp('(x: T, k: T = 2) -> T where T')).toThrow(
      /a default value on a generic parameter is not supported yet/
    );
    // The type of the defaulted parameter does not mention `T`.
    expect(() => declareOp('(x: T, k: number = 2) -> T where T')).not.toThrow();
  });

  test('a default in a nested position is refused where the type is installed', () => {
    const nested =
      /a default value is allowed only in a top-level function signature/;
    expect(() =>
      declareOp('(f: (number, number = 2) -> number) -> number')
    ).toThrow(nested);
    expect(() =>
      declareOp('(x: number) -> ((number, number = 2) -> number)')
    ).toThrow(nested);
    expect(() =>
      ce.declare('NestedDefaultList', 'list<(number, number = 2) -> number>')
    ).toThrow(nested);
    expect(ce.lookupDefinition('NestedDefaultList')).toBeUndefined();
    expect(() =>
      ce.declare(
        'NestedDefaultRecord',
        'record{a: (number, number = 2) -> number}'
      )
    ).toThrow(nested);
    expect(() =>
      ce.declare(
        'NestedDefaultUnion',
        '((number, number = 2) -> number) | string'
      )
    ).toThrow(nested);
    expect(() =>
      ce.declareType('NestedDefaultType', '(number, number = 2) -> number')
    ).toThrow(nested);
    // A `Typed` ascription and a parameter annotation are invalid.
    expect(
      ce.box(['Typed', 'q', "'(number, number = 2) -> number'"]).isValid
    ).toBe(false);
    expect(
      ce.box([
        'Function',
        'f',
        ['Typed', 'f', "'(number, number = 2) -> number'"],
      ]).isValid
    ).toBe(false);
  });

  test('a variable declared with a function type keeps its boxed defaults', () => {
    ce.declare('DeclaredG', '(number, number = 2) -> number');
    expect(ce.box('DeclaredG').type.toString()).toBe(
      '(number, number = 2) -> number'
    );
    expect(json(parameterDefaultOperands(ce, valueDef('DeclaredG')))).toEqual([
      2,
    ]);
    expect(() =>
      ce.declare('DeclaredBadG', '(number, number = "a") -> number')
    ).toThrow(/does not match its type "number"/);
  });

  test('a value that requires a defaulted parameter of the declared type is accepted', () => {
    ce.declare('AssignedG', '(number, number = 2) -> number');
    // The default is inserted when a call leaves it out, so the value may
    // require the parameter.
    ce.assign(
      'AssignedG',
      ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k'])
    );
    expect(ce.box(['AssignedG', 3, 4]).evaluate().json).toBe(12);
    // The value must still take the parameter.
    expect(() =>
      ce.assign('AssignedG', ce.box(['Function', 'x', 'x']))
    ).toThrow(/takes 1 parameter/);
    // The same with a declaration that carries the value.
    expect(() =>
      ce.declare('DeclaredWithValueG', {
        type: '(number, number = 2) -> number',
        value: ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']),
      })
    ).not.toThrow();
    expect(() =>
      ce.declare('DeclaredWithValueH', {
        type: '(number, number = 2) -> number',
        value: ce.box(['Function', 'x', 'x']),
      })
    ).toThrow(/takes 1 parameter/);
  });

  test('subtyping still ignores the default', () => {
    // A defaulted parameter is optional for subtyping: a value that requires
    // it is not a subtype, one where it is optional is.
    expect(
      isSubtype(
        parseType('(number, number?) -> number'),
        parseType('(number, number = 2) -> number')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(number, number) -> number'),
        parseType('(number, number = 2) -> number')
      )
    ).toBe(false);
  });

  test('a default in an overloaded signature is refused', () => {
    expect(() =>
      declareOp(
        '((x: number, k: number = 2) -> number) & ((x: string) -> string)'
      )
    ).toThrow(
      /a default value in an overloaded signature is not supported yet/
    );
  });

  test('the boxed defaults of `NaN`, `+oo` and `-oo` are kept apart', () => {
    const name = declareOp('(x: number, k: number = NaN) -> number');
    const def = operatorDef(name);
    expect(json(parameterDefaultOperands(ce, def))).toEqual(['NaN']);
    def.signature = ce.type('(x: number, k: number = +oo) -> number');
    expect(json(parameterDefaultOperands(ce, def))).toEqual([
      'PositiveInfinity',
    ]);
    def.signature = ce.type('(x: number, k: number = -oo) -> number');
    expect(json(parameterDefaultOperands(ce, def))).toEqual([
      'NegativeInfinity',
    ]);
    def.signature = ce.type('(x: number, k: number = NaN) -> number');
    expect(json(parameterDefaultOperands(ce, def))).toEqual(['NaN']);
  });

  test('a signature given as a `Type` object follows the placement rules of the parser', () => {
    const two = { kind: 'value', value: 2 } as const;
    expect(() =>
      ce.declare('HandArgsDefault', {
        signature: {
          kind: 'signature',
          args: [{ type: 'number', default: two }],
          result: 'number',
        },
        evaluate: (ops) => ops[0],
      })
    ).toThrow(/A required parameter cannot have a default value/);
    expect(() =>
      ce.declare('HandVariadicDefault', {
        type: {
          kind: 'signature',
          args: [{ type: 'number' }],
          variadicArg: { type: 'number', default: two },
          result: 'number',
        },
      })
    ).toThrow(/A variadic parameter cannot have a default value/);
    expect(() =>
      ce.declare('HandOrderDefault', {
        type: {
          kind: 'signature',
          args: [{ type: 'number' }],
          optArgs: [{ type: 'number' }, { type: 'number', default: two }],
          result: 'number',
        },
      })
    ).toThrow(
      /A parameter with a default value cannot follow an optional parameter without one/
    );
    expect(() =>
      ce.declare('HandOrderGood', {
        type: {
          kind: 'signature',
          args: [{ type: 'number' }],
          optArgs: [{ type: 'number', default: two }, { type: 'number' }],
          result: 'number',
        },
      })
    ).not.toThrow();
  });

  test('a typed `Declare` of an auto-declared symbol checks the defaults', () => {
    // A `Declare` has a value (`declaration-without-value` otherwise), so
    // each `Declare` here gives the function a value.
    ce.box(['UpgradedG', 1]);
    expect(() =>
      ce
        .box([
          'Declare',
          'UpgradedG',
          '\'(number, number = "a") -> number\'',
          ['Function', ['Add', 'a', 'b'], 'a', 'b'],
        ])
        .evaluate()
    ).toThrow(/does not match its type "number"/);
    ce.box('UpgradedH');
    ce.box([
      'Declare',
      'UpgradedH',
      "'(number, number = 2) -> number'",
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
    ]).evaluate();
    expect(ce.box('UpgradedH').type.toString()).toBe(
      '(number, number = 2) -> number'
    );
    expect(json(parameterDefaultOperands(ce, valueDef('UpgradedH')))).toEqual([
      2,
    ]);
  });

  test('the `type` setter of a symbol checks the defaults', () => {
    const s = ce.box('RetypedSym');
    expect(() => {
      s.type = 'list<(number, number = 2) -> number>';
    }).toThrow(
      /Symbol "RetypedSym": a default value is allowed only in a top-level function signature/
    );
    // A function type makes the symbol an operator.
    s.type = '(number, number = 2) -> number';
    expect(
      json(parameterDefaultOperands(ce, operatorDef('RetypedSym')))
    ).toEqual([2]);
    const op = ce.box(declareOp('(x: number) -> number'));
    expect(() => {
      op.type = '(x: number, k: number = "a") -> number';
    }).toThrow(/does not match its type "number"/);
  });

  test('the `signature` setter of an operator definition checks the defaults', () => {
    const def = operatorDef(declareOp('(x: number) -> number'));
    expect(() => {
      def.signature = ce.type('(x: number, k: number = "a") -> number');
    }).toThrow(/does not match its type "number"/);
    expect(def.signature.toString()).toBe('(x: number) -> number');
    expect(() => {
      def.signature = ce.type(
        '(x: number) -> ((number, number = 2) -> number)'
      );
    }).toThrow(
      /a default value is allowed only in a top-level function signature/
    );
  });

  test('a refused retype keeps the assumptions about the symbol', () => {
    const local = new ComputeEngine();
    local.declare('a', 'real');
    local.assume(local.parse('a > 0'));
    expect(local.box('a').isPositive).toBe(true);
    expect(() => {
      local.box('a').type = 'list<(number, number = 2) -> number>';
    }).toThrow(
      /a default value is allowed only in a top-level function signature/
    );
    expect(local.box('a').isPositive).toBe(true);
  });

  test('a refused declaration does not declare the symbol of its default', () => {
    expect(() =>
      declareOp(
        '(x: number, mode: symbol<Auto> | symbol<Manual> = Atuo) -> number'
      )
    ).toThrow(/a default value is a constant/);
    expect(ce.lookupDefinition('Atuo')).toBeUndefined();
    // A later value default that does not fit refuses the declaration too.
    expect(() =>
      declareOp('(x: number, m: number = 1, k: number = "a") -> number')
    ).toThrow(/does not match its type "number"/);
  });

  test('with `ce.strict` set to `false`, the checks of a symbol default are the same', () => {
    const lax = new ComputeEngine();
    lax.strict = false;
    // A library constant is checked against the parameter type as a value
    // default is.
    expect(() =>
      lax.declare('LaxDefaultOp', {
        signature: '(x: number, k: number = Integers) -> number',
        evaluate: (ops) => ops[0],
      })
    ).toThrow(/does not match its type "number"/);
    expect(() =>
      lax.declare('LaxDefaultOp2', {
        signature: '(x: number, k: number = UndeclaredName) -> number',
        evaluate: (ops) => ops[0],
      })
    ).toThrow(/a default value is a constant/);
  });
});

/** The definition of the operator `name`, or a thrown error. */
function operatorDefOf(ce: ComputeEngine, name: string) {
  const def = ce.lookupDefinition(name);
  if (def === undefined || !('operator' in def))
    throw new Error(`no operator definition for ${name}`);
  return def.operator;
}

describe('PARAMETER DEFAULT VALUES: THE FILL', () => {
  const ce = new ComputeEngine();
  /** The number of operands each call of `Scaled` received. */
  const received: number[] = [];
  ce.declare('Scaled', {
    signature: '(x: number, factor: number = 2) -> number',
    evaluate: (ops) => {
      received.push(ops.length);
      return ops[0].mul(ops[1] ?? ce.One);
    },
  });
  ce.declare('Two', {
    signature: '(a: number, b: number, k: number = 2) -> number',
  });

  test('a call that leaves out a defaulted parameter has the default as an operand', () => {
    const e = ce.box(['Scaled', 3]);
    expect(e.nops).toBe(2);
    expect(e.json).toEqual(['Scaled', 3, 2]);
  });

  test('the filled call is the same expression as the call written with the default', () => {
    const filled = ce.box(['Scaled', 3]);
    const written = ce.box(['Scaled', 3, 2]);
    expect(filled.isSame(written)).toBe(true);
    expect(filled.latex).toBe(written.latex);
  });

  test('the handler receives every operand', () => {
    received.length = 0;
    expect(ce.box(['Scaled', 3]).evaluate().json).toBe(6);
    expect(received).toEqual([2]);
  });

  test('a supplied argument is kept, positional or named', () => {
    expect(ce.box(['Scaled', 3, 5]).json).toEqual(['Scaled', 3, 5]);
    expect(
      ce.box(['Scaled', 3, ['NamedArgument', "'factor'", 5]]).json
    ).toEqual(['Scaled', 3, 5]);
  });

  // `Nothing` is not a number: the `number` parameter refuses it.
  const NOTHING_REFUSED = ['Error', ['ErrorCode', "'incompatible-type'", "'number'", "'nothing'"], 'Nothing'];

  test('a named argument with the value `Nothing` fills its slot', () => {
    expect(
      ce.box(['Scaled', 3, ['NamedArgument', "'factor'", 'Nothing']]).json
    ).toEqual(['Scaled', 3, NOTHING_REFUSED]);
  });

  test('a positional `Nothing` fills its slot', () => {
    expect(ce.box(['Scaled', 3, 'Nothing']).json).toEqual([
      'Scaled',
      3,
      NOTHING_REFUSED,
    ]);
  });

  test('a call with an empty required parameter is not filled', () => {
    const none = ce.box(['Scaled']);
    expect(none.json).toEqual(['Scaled', ['Error', "'missing'"]]);
    expect(none.nops).toBe(1);
    // The default is never moved into a required position.
    expect(ce.box(['Two', 1]).json).toEqual([
      'Two',
      1,
      ['Error', "'missing'"],
    ]);
    expect(ce.box(['Two', 1, 5]).json).toEqual(['Two', 1, 5, 2]);
  });

  test('a non-canonical boxing does not fill', () => {
    const e = ce.box(['Scaled', 3], { canonical: false });
    expect(e.nops).toBe(1);
    expect(e.json).toEqual(['Scaled', 3]);
    // Its canonical form does.
    expect(e.canonical.json).toEqual(['Scaled', 3, 2]);
  });
});

describe('PARAMETER DEFAULT VALUES: COLLECTION DEFAULTS', () => {
  const ce = new ComputeEngine();
  test('`[]` fills the call and the handler receives an empty list', () => {
    ce.declare('WithList', {
      signature: '(x: number, xs: list<number> = []) -> number',
      evaluate: ([_x, xs]) => ce.box(['Tuple', ce.string(xs.operator), xs.nops]),
    });
    const e = ce.box(['WithList', 1]);
    expect(e.json).toEqual(['WithList', 1, ['List']]);
    expect(e.evaluate().json).toEqual(['Tuple', "'List'", 0]);
    expect(operatorDefOf(ce, 'WithList').signature.toString()).toBe(
      '(x: number, xs: list<number> = []) -> number'
    );
  });

  test('`{}` fills the call and the handler receives an empty dictionary', () => {
    ce.declare('WithDict', {
      signature: '(x: number, d: dictionary = {}) -> number',
      evaluate: ([_x, d]) => ce.string(d.operator),
    });
    const e = ce.box(['WithDict', 1]);
    expect(e.json).toEqual(['WithDict', 1, { dict: {} }]);
    expect(e.evaluate().json).toBe("'Dictionary'");
  });
});

describe('PARAMETER DEFAULT VALUES: ROUTES OF THE FILL', () => {
  const ce = new ComputeEngine();
  /** The operands that a `canonical` handler received, as MathJSON. */
  const seen: unknown[] = [];
  const recordingHandler =
    (name: string) =>
    (ops: ReadonlyArray<{ json: unknown }>, { engine }: { engine: any }) => {
      seen.push(ops.map((x) => x.json));
      return engine._fn(name, ops);
    };
  for (const [name, lazy] of [
    ['Eager', false],
    ['Lazy', true],
  ] as const) {
    ce.declare(name, {
      signature: '(x: number, k: number = 2) -> number',
      lazy,
      canonical: recordingHandler(name) as any,
    });
  }
  ce.declare('NoDefault', {
    signature: '(x: number, k: number?) -> number',
    canonical: recordingHandler('NoDefault') as any,
  });

  test('a custom `canonical` handler sees the default, after the written operands', () => {
    seen.length = 0;
    ce.box(['Eager', 3]);
    ce.box(['Eager', ['Sequence', 3]]);
    expect(seen).toEqual([
      [3, 2],
      [3, 2],
    ]);
  });

  test('a `Sequence` operand of a custom handler counts each of its elements', () => {
    // The operands of a handler are not flattened. `Sequence(3, 5)` supplies
    // two positions, so the call gets no default and the handler sees the 5.
    seen.length = 0;
    ce.box(['Eager', ['Sequence', 3, 5]]);
    ce.box(['Lazy', ['Sequence', 3, 5]]);
    expect(seen).toEqual([[['Sequence', 3, 5]], [['Sequence', 3, 5]]]);
  });

  test('an empty `Sequence` supplies no position and gets no default', () => {
    seen.length = 0;
    ce.box(['Eager', ['Sequence']]);
    ce.box(['Lazy', ['Sequence']]);
    // The operands of a handler are not flattened, and the canonical form of
    // an empty `Sequence` is the empty `Sequence`: both handlers see it.
    expect(seen).toEqual([[['Sequence']], [['Sequence']]]);
  });

  test('a lazy operator sees the default, after the written operands', () => {
    seen.length = 0;
    ce.box(['Lazy', 3]);
    ce.box(['Lazy', ['Sequence', 3]]);
    expect(seen).toEqual([
      [3, 2],
      [['Sequence', 3], 2],
    ]);
  });

  test('a handler of an operator without a default sees the operands it sees without the fill', () => {
    seen.length = 0;
    ce.box(['NoDefault', 3, 'Nothing']);
    ce.box(['NoDefault', 3]);
    expect(seen).toEqual([[3, 'Nothing'], [3]]);
  });

  test('a lazy operator holds the boxed default of its definition', () => {
    ce.declare('LazyPlain', {
      signature: '(x: number, k: number = 2) -> number',
      lazy: true,
    });
    const e = ce.box(['LazyPlain', 3]);
    expect(e.json).toEqual(['LazyPlain', 3, 2]);
    const defaults = parameterDefaultOperands(
      ce,
      operatorDefOf(ce, 'LazyPlain')
    );
    expect(e.ops![1]).toBe(defaults![0]);
  });

  describe('a `Spread` operand', () => {
    ce.declare('p', 'tuple');
    for (const lazy of [false, true]) {
      const name = lazy ? 'SpreadLazy' : 'SpreadEager';
      ce.declare(name, {
        signature: '(x: number, k: number = 2) -> number',
        lazy,
        evaluate: (ops) => ops[0].evaluate().mul(ops[1].evaluate()),
      });
      test(`${lazy ? 'lazy' : 'eager'}: is not filled at canonicalization, and the call is filled after the splice`, () => {
        const e = ce.box([name, ['Spread', 'p']]);
        expect(e.nops).toBe(1);
        const at = (v: unknown) => {
          ce.assign('p', ce.box(v as any));
          return e.evaluate().json;
        };
        const code = (v: unknown) => (at(v) as unknown[]).slice(0, 2);
        expect(code(['Tuple'])).toEqual(['Error', "'missing'"]);
        expect(at(['Tuple', 3])).toBe(6);
        expect(at(['Tuple', 3, 5])).toBe(15);
        expect(code(['Tuple', 3, 5, 7])).toEqual([
          'Error',
          "'unexpected-argument'",
        ]);
      });
    }
  });
});

describe('PARAMETER DEFAULT VALUES: A VARIABLE WITH A DECLARED SIGNATURE', () => {
  const ce = new ComputeEngine();
  ce.declare('g', '(number, number = 2) -> number');

  test('a value that requires the defaulted parameter is accepted, and the call is filled from the declared type', () => {
    ce.assign('g', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    const e = ce.box(['g', 3]);
    expect(e.json).toEqual(['g', 3, 2]);
    expect(e.evaluate().json).toBe(6);
  });

  test('a value that does not take the defaulted parameter is refused', () => {
    expect(() => ce.assign('g', ce.box(['Function', 'x', 'x']))).toThrow(
      /takes 1 parameter/
    );
  });

  test('a call is not matched again after an assignment: the declared type is a contract', () => {
    ce.assign('g', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    const e = ce.box(['g', 3]);
    ce.assign('g', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    expect(e.json).toEqual(['g', 3, 2]);
    expect(e.evaluate().json).toBe(5);
  });

  test('a callback passed by name is called through the name, so it is filled', () => {
    ce.assign('g', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    expect(
      ce.box(['At', ['Map', 'g', ['List', 1, 4]], 2]).evaluate().json
    ).toBe(8);
  });

  test('the value passed to a parameter is not filled (limit of the canonical fill)', () => {
    ce.assign('g', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    // `f` holds the function literal, not the name `g`: the call `f(3)` has
    // no declared default, so it is a partial application of the literal,
    // and `Map` reports that the callback takes two arguments.
    expect(
      ce.box(['Apply', ['Function', ['Apply', 'f', 3], 'f'], 'g']).evaluate()
        .operator
    ).toBe('Function');
    expect(
      ce
        .box(['Apply', ['Function', ['Map', 'f', ['List', 1]], 'f'], 'g'])
        .evaluate()
        .toString()
    ).toMatch(/callback-arity/);
  });

  test('a variable declared `function` is not filled at canonicalization', () => {
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    expect(ce.box(['h', 3]).json).toEqual(['h', 3]);
  });
});

describe('PARAMETER DEFAULT VALUES: CALLEES THAT CHANGE', () => {
  test('a user function: the written arguments are filled again from the function in force at evaluation', () => {
    const ce = new ComputeEngine();
    // A user function (its definition holds a function literal) whose
    // declared signature gives `k` a default.
    ce.declare('f', {
      signature: '(x: number, k: number = 2) -> number',
      evaluate: ['Function', ['Multiply', 'x', 'k'], 'x', 'k'],
    });
    expect(operatorDefOf(ce, 'f').isUserFunctionDefinition).toBe(true);
    const e = ce.box(['f', 3]);
    expect(e.json).toEqual(['f', 3, 2]);
    expect(e.evaluate().json).toBe(6);
    // The declared signature is kept by the assignment of a literal that
    // fits it: the default still applies.
    ce.assign('f', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    expect(e.evaluate().json).toBe(5);
  });

  test('a variable with an inferred type: the written arguments are matched again after an assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('v', {
      type: '(number, number = 2) -> number',
      inferred: true,
      value: ['Function', ['Multiply', 'x', 'k'], 'x', 'k'],
    });
    const e = ce.box(['v', 3]);
    expect(e.json).toEqual(['v', 3, 2]);
    expect(e.evaluate().json).toBe(6);
    // The call was written `v(3)`: against `(x) => x` it is `v(3)`, not
    // `v(3, 2)`, which would be `unexpected-argument`.
    ce.assign('v', ce.box(['Function', 'x', 'x']));
    expect(e.evaluate().json).toBe(3);
    // Against a function without a default, the written call is a partial
    // application of the literal, as `v(3)` written after the assignment is.
    ce.assign('v', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    expect(e.evaluate().operator).toBe('Function');
    expect(e.evaluate().isSame(ce.box(['v', 3]).evaluate())).toBe(true);
  });

  test('a variable with a declared type is not matched again', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number, number = 2) -> number');
    ce.assign('f', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    const e = ce.box(['f', 3]);
    ce.assign('f', ce.box(['Function', ['Multiply', 'x', 'k', 5], 'x', 'k']));
    expect(e.json).toEqual(['f', 3, 2]);
    expect(e.evaluate().json).toBe(30);
  });
});

describe('PARAMETER DEFAULT VALUES: NAMED ARGUMENTS AND HOLES', () => {
  const ce = new ComputeEngine();
  test('a hole at a defaulted parameter is filled by the default', () => {
    ce.declare('Holes', {
      signature:
        '(x: number, density: number = 1, factor: number = 2) -> number',
    });
    expect(
      ce.box(['Holes', 3, ['NamedArgument', "'factor'", 5]]).json
    ).toEqual(['Holes', 3, 1, 5]);
    expect(
      ce.box([
        'Holes',
        3,
        ['NamedArgument', "'density'", 'Nothing'],
        ['NamedArgument', "'factor'", 5],
      ]).json
    ).toEqual([
      'Holes',
      3,
      // A named `Nothing` fills its slot, and the `number` parameter refuses it.
      ['Error', ['ErrorCode', "'incompatible-type'", "'number'", "'nothing'"], 'Nothing'],
      5,
    ]);
  });

  test('a hole at an optional parameter without a default is still `argument-optional-skipped`', () => {
    ce.declare('MixedHoles', {
      signature: '(x: number, a: number = 1, b: number?, c: number?) -> number',
    });
    const e = ce.box(['MixedHoles', 3, ['NamedArgument', "'c'", 7]]);
    expect(JSON.stringify(e.json)).toMatch(/argument-optional-skipped/);
    expect(JSON.stringify(e.json)).toMatch(/`b` is not/);
  });
});

describe('PARAMETER DEFAULT VALUES: AN ABSENT VALUE AT A DEFAULTED POSITION', () => {
  // A default fills an argument that the call leaves out. An argument that
  // the call supplies is never replaced by the default, also when its value
  // is absent (`Missing`, `NaN`, the result of an `At` outside its list or of
  // `First` of an empty list). A numeric parameter that receives it makes the
  // call `Missing`; a parameter of another type passes it to the body.
  const ce = new ComputeEngine();
  ce.declare('ScaledBy', {
    signature: '(x: number, k: number = 2) -> number',
    evaluate: ['Function', ['Multiply', 'x', 'k'], 'x', 'k'],
  });

  test('a call that leaves out the argument is filled', () => {
    expect(ce.box(['ScaledBy', 3]).evaluate().json).toBe(6);
  });

  test('a supplied `Missing` is kept in the call and not replaced by the default', () => {
    const e = ce.box(['ScaledBy', 3, 'Missing']);
    expect(e.json).toEqual(['ScaledBy', 3, 'Missing']);
    expect(e.evaluate().json).toBe('Missing');
  });

  test('a supplied `NaN` is not replaced by the default', () => {
    expect(ce.box(['ScaledBy', 3, 'NaN']).evaluate().json).toBe('NaN');
  });

  test('the value of an `At` outside its list is not replaced by the default', () => {
    expect(
      ce.box(['ScaledBy', 3, ['At', ['List', 1], 100]]).evaluate().json
    ).not.toBe(6);
  });

  test('`First` of an empty list is not replaced by the default', () => {
    expect(
      ce.box(['ScaledBy', 3, ['First', ['List']]]).evaluate().json
    ).toBe('Missing');
  });

  test('a function literal passes a supplied absent value to its body', () => {
    const isMissing = ['Function', ['IsMissing', 'k'], ['Optional', 'k', 0]];
    expect(ce.box(['Apply', isMissing]).evaluate().json).toBe('False');
    expect(ce.box(['Apply', isMissing, 'Missing']).evaluate().json).toBe(
      'True'
    );
  });

  test('a numeric parameter of a literal that receives `Missing` or `NaN` makes the call absent', () => {
    const lit = ['Function', 'k', ['Optional', ['Typed', 'k', "'real'"], 0]];
    expect(ce.box(['Apply', lit]).evaluate().json).toBe(0);
    expect(ce.box(['Apply', lit, 5]).evaluate().json).toBe(5);
    expect(ce.box(['Apply', lit, 'Missing']).evaluate().json).toBe('Missing');
    expect(ce.box(['Apply', lit, 'NaN']).evaluate().json).toBe('NaN');
  });
});

describe('PARAMETER DEFAULT VALUES: REVIEW FIXES OF THE FILL', () => {
  test('a positional `Nothing` in a named call fills its slot', () => {
    const ce = new ComputeEngine();
    ce.declare('Holes', {
      signature:
        '(x: number, density: number = 1, factor: number = 2) -> number',
    });
    const e = ce.box(['Holes', 'Nothing', ['NamedArgument', "'factor'", 5]]);
    expect(e.isValid).toBe(false);
    // `Nothing` is not a number: the `number` parameter `x` refuses it.
    const refused = ['Error', ['ErrorCode', "'incompatible-type'", "'number'", "'nothing'"], 'Nothing'];
    expect(e.json).toEqual(['Holes', refused, 1, 5]);
    // A positional `Nothing` before another positional argument keeps its
    // slot: the next argument takes the next slot.
    expect(
      ce.box(['Holes', 'Nothing', 3, ['NamedArgument', "'factor'", 5]]).json
    ).toEqual(['Holes', refused, 3, 5]);
  });

  test('a replaceable operator: a call made before the assignment of a function literal is filled again', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(x: number, k: number = 2) -> number',
      inferredSignature: true,
    });
    const e = ce.box(['f', 3]);
    expect(e.json).toEqual(['f', 3, 2]);
    ce.assign('f', ce.box(['Function', 'x', 'x']));
    expect(e.evaluate().json).toBe(3);
  });

  test('a filled call is not boxed again when the new definition gives the same call', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(x: number, k: number = 2) -> number',
      evaluate: ['Function', ['Multiply', 'x', 'k'], 'x', 'k'],
    });
    const e = ce.box(['f', 3]) as any;
    expect(e.json).toEqual(['f', 3, 2]);
    // The written operands are kept: they are the operands before the
    // default was inserted.
    expect(e._calleeStamp?.ops?.length).toBe(1);
    ce.assign('f', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    expect(e._reboxedForCallee()).toBeUndefined();
    expect(e.evaluate().json).toBe(5);
  });

  test('a variable with an inferred `function` type is filled from the function it holds', () => {
    const ce = new ComputeEngine();
    ce.declare('Scaled', {
      signature: '(x: number, k: number = 2) -> number',
      evaluate: ([x, k]) => x.mul(k).evaluate(),
    });
    ce.declare('g', { type: 'function', inferred: true });
    ce.assign('g', ce.symbol('Scaled'));
    const positional = ce.box(['g', 3]);
    expect(positional.json).toEqual(['g', 3, 2]);
    const named = ce.box(['g', ['NamedArgument', "'x'", 3]]);
    expect(positional.json).toEqual(named.json);
    expect(positional.evaluate().json).toBe(6);
  });
});

describe('PARAMETER DEFAULT VALUES: REVIEW FIXES OF THE FILL, ROUND 2', () => {
  const named = (name: string, value: unknown) => [
    'NamedArgument',
    `'${name}'`,
    value,
  ];

  test('a positional `Nothing` in a named call to an overload set fills a slot', () => {
    const ce = new ComputeEngine();
    ce.declare('Ov', {
      signature:
        '((x: number, y: number, z: number?) -> number) & ((a: number, b: number, c: number?) -> number)',
    });
    // `Nothing` fills `x`, so the named `x` is a duplicate.
    expect(
      ce.box(['Ov', 'Nothing', named('x', 1), named('y', 2)] as any).json
    ).toEqual([
      'Ov',
      'Nothing',
      [
        'Error',
        [
          'ErrorCode',
          "'argument-name-duplicate'",
          "'x'",
          "'that parameter is already filled by a positional argument'",
        ],
      ],
      2,
    ]);
    // Two arms that read the call in different orders.
    ce.declare('Swap', {
      signature:
        '((a: number, b: number) -> number) & ((b: number, a: number) -> number)',
    });
    expect(ce.box(['Swap', 'Nothing', 3, named('b', 4)] as any).json).toEqual([
      'Swap',
      'Nothing',
      3,
      [
        'Error',
        [
          'ErrorCode',
          "'argument-name-duplicate'",
          "'b'",
          "'that parameter is already filled by a positional argument'",
        ],
      ],
    ]);
  });

  test('a positional `Nothing` in a named call without defaults fills a slot', () => {
    const ce = new ComputeEngine();
    ce.declare('G', { signature: '(a: number, b: number) -> number' });
    // `Nothing` fills `a` and `3` fills `b`, so the named `b` is a duplicate.
    expect(ce.box(['G', 'Nothing', 3, named('b', 4)] as any).json).toEqual([
      'G',
      'Nothing',
      3,
      [
        'Error',
        [
          'ErrorCode',
          "'argument-name-duplicate'",
          "'b'",
          "'that parameter is already filled by a positional argument'",
        ],
      ],
    ]);
    const e = ce.box(['G', 'Nothing', named('b', 4)] as any);
    expect(e.isValid).toBe(false);
    expect(JSON.stringify(e.json)).toMatch(/incompatible-type/);
  });

  test('a replaceable operator: every call is recorded, also one that supplies every argument', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(x: number, k: number = 2) -> number',
      inferredSignature: true,
    });
    expect((ce.box(['f', 3, 4]) as any)._calleeStamp).toBeDefined();
    expect((ce.box(['f', 3]) as any)._calleeStamp).toBeDefined();
    // The route of a `canonical` handler does not give the written operands,
    // so a call on it is not recorded.
    ce.declare('g', {
      signature: '(x: number, k: number = 2) -> number',
      inferredSignature: true,
      canonical: (ops, { engine }) => engine._fn('g', ops),
    });
    const g = ce.box(['g', 3]) as any;
    expect(g.json).toEqual(['g', 3, 2]);
    expect(g._calleeStamp).toBeUndefined();
  });

  test('a filled call is boxed again when an inserted default was replaced', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(x: number, k: number = 2.5) -> number',
      evaluate: ['Function', ['Multiply', 'x', 'k'], 'x', 'k'],
    });
    const e = ce.box(['f', 3]) as any;
    const stamp = e._calleeStamp;
    expect(stamp.filled.length).toBe(2);
    expect(stamp.filled[1]).toBe(e.ops[1]);
    // No declared default can be replaced by the check today (a value
    // default must match its parameter type), so the replacement is
    // simulated: the inserted operand differs, by identity, from the
    // operand of the call, but `isSame()` holds.
    stamp.filled = [stamp.filled[0], ce.number(2.5)];
    expect(stamp.filled[1]).not.toBe(e.ops[1]);
    ce.assign('f', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    expect(e._reboxedForCallee()).toBeDefined();
    expect(e.evaluate().json).toBe(5.5);
  });
});

describe('PARAMETER DEFAULT VALUES: REVIEW FIXES OF THE FILL, ROUND 3', () => {
  const named = (name: string, value: unknown) => [
    'NamedArgument',
    `'${name}'`,
    value,
  ];

  test('a replaceable operator: a call that supplies every argument is checked again after an assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(x: number, k: number = 2) -> number',
      inferredSignature: true,
    });
    const e = ce.box(['f', 3, 4]);
    expect(e.json).toEqual(['f', 3, 4]);
    ce.assign('f', ce.parse('(x: \\mathrm{number}) \\mapsto 7'));
    const fresh = ce.box(['f', 3, 4]);
    expect(fresh.type.toString()).toBe('error');
    expect(e.type.toString()).toBe('error');
    expect(JSON.stringify(e.evaluate().json)).toMatch(/unexpected-argument/);
    expect(e.evaluate().isSame(fresh.evaluate())).toBe(true);
  });

  test('a replaceable operator: a default received at a hole is inserted again from the new definition', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature:
        '(x: number, density: number = 1, factor: number = 2) -> number',
      inferredSignature: true,
    });
    const e = ce.box(['f', 3, named('factor', 5)] as any);
    expect(e.json).toEqual(['f', 3, 1, 5]);
    // The new literal has no default for `density`: the call written
    // `f(3, factor: 5)` leaves out a required parameter.
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Multiply', 'x', 'density', 'factor'],
        'x',
        'density',
        'factor',
      ])
    );
    const fresh = ce.box(['f', 3, named('factor', 5)] as any).evaluate();
    expect(JSON.stringify(fresh.json)).toMatch(/missing/);
    expect(e.evaluate().isSame(fresh)).toBe(true);
  });
});

/** The function literal `(x, k = d) => body`, as MathJSON. */
function defaultedLiteral(d: unknown, body: unknown = ['Multiply', 'x', 'k']) {
  return ['Function', body, 'x', ['Optional', 'k', d]] as any;
}

/** The code of the error at the parameter `index` (1-based) of the boxed
 * function literal `literal`, or `undefined` when that parameter is not an
 * error. */
function parameterErrorCode(literal: any, index: number): string | undefined {
  const param = literal.ops[index];
  if (param?.operator !== 'Error') return undefined;
  const code = param.op1;
  return code.operator === 'ErrorCode' ? code.op1.string : code.string;
}

describe('PARAMETER DEFAULT VALUES: FUNCTION LITERALS', () => {
  const ce = new ComputeEngine();
  const lit = defaultedLiteral(2);

  test('a call with the required arguments is a full call, not a partial application', () => {
    expect(ce.box(['Apply', lit, 3]).evaluate().json).toBe(6);
    expect(ce.box(['Apply', lit, 3, 5]).evaluate().json).toBe(15);
  });

  test('the canonical form of a call of an inline literal carries the default', () => {
    expect(ce.box(['Apply', lit, 3]).json).toEqual(['Apply', lit_json(), 3, 2]);
    function lit_json() {
      return ce.box(lit).json;
    }
  });

  test('a call with fewer arguments than the required ones curries, and the residual keeps the default', () => {
    const residual = ce.box(['Apply', lit]).evaluate();
    expect(residual.operator).toBe('Function');
    expect(residual.ops![2].json).toEqual(['Optional', '_2', 2]);
    expect(ce.box(['Apply', residual.json, 3]).evaluate().json).toBe(6);
    expect(ce.box(['Apply', residual.json, 3, 5]).evaluate().json).toBe(15);
  });

  test('the type prints the default; an untyped parameter keeps its inferred slot type', () => {
    expect(ce.box(lit).type.toString()).toBe(
      '(x: unknown, k: unknown = 2) -> number'
    );
    expect(ce.box(defaultedLiteral(2, 'k')).type.toString()).toBe(
      '(x: unknown, k: unknown = 2) -> unknown'
    );
    expect(
      ce
        .box([
          'Function',
          ['Multiply', 'x', 'k'],
          'x',
          ['Optional', ['Typed', 'k', "'number'"], 2],
        ])
        .type.toString()
    ).toBe('(x: unknown, k: number = 2) -> number');
  });

  test.each([
    ['a number', 2],
    ['a negative number', -1.5],
    ['NaN', 'NaN'],
    ['+oo', 'PositiveInfinity'],
    ['a string', "'abc'"],
    ['a boolean', 'True'],
    ['the empty list', ['List']],
    ['the empty dictionary', ['Dictionary']],
  ])(
    'the printed type of a literal with %s as default parses back to the same identity key',
    (_, d) => {
      const t = ce.box(defaultedLiteral(d, 'k')).type.type;
      expect(typeToIdentityKey(parseType(typeToString(t)))).toBe(
        typeToIdentityKey(t)
      );
    }
  );

  test('`Typed(k, "number?")` is a diagnostic, not an untyped parameter', () => {
    const f = ce.box([
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Typed', 'k', "'number?'"],
    ]);
    expect(parameterErrorCode(f, 2)).toBe('invalid-parameter-annotation');
    expect(f.ops![2].toString()).toMatch(/Optional\(k, default\)/);
  });

  test('the signature-string sugar desugars a default to an `Optional` parameter', () => {
    const f = ce.box([
      'Function',
      ['Multiply', 'x', 'k'],
      "'(x: number, k: number = 2) -> number'",
    ]);
    expect(f.ops![2].json).toEqual(['Optional', ['Typed', 'k', "'number'"], 2]);
    expect(ce.box(['Apply', f.json, 3]).evaluate().json).toBe(6);
    const g = ce.box(['Function', ['Length', 'xs'], "'(xs: list = []) -> integer'"]);
    expect(ce.box(['Apply', g.json]).evaluate().json).toBe(0);
    // An optional argument without a default and a variadic argument have
    // no parameter spelling: the operand stays an error.
    expect(
      parameterErrorCode(
        ce.box(['Function', 'k', "'(x: number, k: number?) -> number'"]),
        1
      )
    ).toBe('expected-a-symbol');
    expect(
      parameterErrorCode(
        ce.box(['Function', 'k', "'(x: number, k: number*) -> number'"]),
        1
      )
    ).toBe('expected-a-symbol');
  });

  test('an empty-list default', () => {
    expect(
      ce
        .box(['Apply', ['Function', ['Length', 'xs'], ['Optional', 'xs', ['List']]]])
        .evaluate().json
    ).toBe(0);
  });

  test('a default that does not fit the parameter type is `incompatible-type`, inline and at `ce.assign`', () => {
    const annotated = [
      'Function',
      'k',
      ['Optional', ['Typed', 'k', "'number'"], "'a'"],
    ];
    const inferred = defaultedLiteral("'a'");
    expect(parameterErrorCode(ce.box(annotated), 1)).toBe('incompatible-type');
    expect(parameterErrorCode(ce.box(inferred), 2)).toBe('incompatible-type');
    // `ce.assign` refuses an invalid function literal, as it refuses any
    // other.
    const ce2 = new ComputeEngine();
    expect(() => ce2.assign('f1', ce2.box(annotated))).toThrow(
      /incompatible-type/
    );
    expect(() => ce2.assign('f2', ce2.box(inferred))).toThrow(
      /incompatible-type/
    );
  });

  test.each([
    ['a default that names a parameter', ['Optional', 'k', 'x'], 2, 'expected-a-literal-default'],
    ['a symbol', ['Optional', 'k', 'd'], 2, 'expected-a-literal-default'],
    ['a symbol that the parameter type does not list', ['Optional', 'k', 'Auto'], 2, 'expected-a-literal-default'],
    ['`Nothing`', ['Optional', 'k', 'Nothing'], 2, 'expected-a-literal-default'],
    ['`Missing`', ['Optional', 'k', 'Missing'], 2, 'expected-a-literal-default'],
    ['`ComplexInfinity`', ['Optional', 'k', 'ComplexInfinity'], 2, 'expected-a-literal-default'],
    ['a rational', ['Optional', 'k', ['Rational', 1, 2]], 2, 'expected-a-literal-default'],
    ['a complex number', ['Optional', 'k', ['Complex', 1, 2]], 2, 'expected-a-literal-default'],
    ['a decimal that a double does not hold', ['Optional', 'k', { num: '1.12345678901234567890123' }], 2, 'expected-a-literal-default'],
    ['a list with elements', ['Optional', 'k', ['List', 1]], 2, 'expected-a-literal-default'],
    ['an expression', ['Optional', 'k', ['Add', 'y', 1]], 2, 'expected-a-literal-default'],
    ['`Optional` on a rest parameter', ['Optional', ['Spread', 'k'], 2], 2, 'expected-a-symbol'],
    ['`Optional` on a destructuring parameter', ['Optional', ['Tuple', 'p', 'q'], 2], 2, 'expected-a-symbol'],
    ['`Optional` with no default', ['Optional', 'k'], 2, 'missing'],
  ])('%s is an error on the parameter', (_, param, index, code) => {
    const f = ce.box(['Function', 'x', 'x', param] as any);
    expect(parameterErrorCode(f, index)).toBe(code);
  });

  test('a library constant, or a symbol that the annotation lists, is a valid default', () => {
    const pi = ce.box(['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 'Pi']]);
    expect(parameterErrorCode(pi, 2)).toBeUndefined();
    expect(ce.box(['Apply', pi, 2]).evaluate().toString()).toBe('2pi');
    const mode = ce.box([
      'Function',
      'm',
      'x',
      ['Optional', ['Typed', 'm', "'symbol<Auto> | symbol<Manual>'"], 'Auto'],
    ]);
    expect(parameterErrorCode(mode, 2)).toBeUndefined();
    expect(ce.box(['Apply', mode, 2]).evaluate().symbol).toBe('Auto');
  });

  test('a rest parameter or a plain parameter after an `Optional` is an error on that parameter', () => {
    expect(
      parameterErrorCode(
        ce.box(['Function', 'x', 'x', ['Optional', 'k', 2], ['Spread', 'r']]),
        3
      )
    ).toBe('expected-a-symbol');
    expect(
      parameterErrorCode(
        ce.box(['Function', 'x', ['Optional', 'k', 2], 'x']),
        2
      )
    ).toBe('expected-a-symbol');
    // A plain parameter before the `Optional` is accepted.
    expect(parameterErrorCode(ce.box(lit), 1)).toBeUndefined();
    expect(parameterErrorCode(ce.box(lit), 2)).toBeUndefined();
  });

  test('`Optional` outside a parameter list is `unexpected-argument`', () => {
    const e = ce.box(['Optional', 'k', 2]);
    expect(e.operator).toBe('Error');
    expect(e.toString()).toMatch(/unexpected-argument/);
  });

  test('a symbol default is an error on the parameter, with a message that says what to write', () => {
    const f = ce.box(defaultedLiteral('d'));
    expect(f.isValid).toBe(false);
    expect(parameterErrorCode(f, 2)).toBe('expected-a-literal-default');
    expect(JSON.stringify(f.json)).toContain(
      'a default value is a constant: write a number, a string, a boolean, `[]`, `{}`, a constant (a library constant or a symbol declared constant) or a symbol that the parameter type lists, or pass the argument'
    );
    // A call of the literal is an error as well: the literal is not valid.
    const ce2 = new ComputeEngine();
    expect(() => ce2.assign('f', ce2.box(defaultedLiteral('d')))).toThrow(
      /expected-a-literal-default/
    );
  });

  test('a rest parameter after a parameter with a default is an error, with a message that says why', () => {
    const f = ce.box([
      'Function',
      'x',
      'x',
      ['Optional', 'k', 2],
      ['Spread', 'r'],
    ]);
    expect(f.isValid).toBe(false);
    expect(parameterErrorCode(f, 3)).toBe('expected-a-symbol');
    expect(JSON.stringify(f.json)).toContain(
      'a function with a rest parameter has no default values: drop the default or the rest parameter'
    );
    // A default on the rest parameter itself is an error on that parameter.
    const g = ce.box(['Function', 'x', 'x', ['Optional', ['Spread', 'r'], 2]]);
    expect(g.isValid).toBe(false);
    expect(parameterErrorCode(g, 2)).toBe('expected-a-symbol');
  });

  test('a named argument that skips a parameter with a default gives it the default', () => {
    const f = [
      'Function',
      ['Add', 'x', ['Multiply', 10, 'a'], ['Multiply', 100, 'b']],
      'x',
      ['Optional', 'a', 1],
      ['Optional', 'b', 2],
    ];
    const e = ce.box(['Apply', f, 3, ['NamedArgument', "'b'", 5]] as any);
    expect(e.ops!.slice(1).map((x) => x.json)).toEqual([3, 1, 5]);
    expect(e.evaluate().json).toBe(513);
  });
});

describe('PARAMETER DEFAULT VALUES: READERS OF A LITERAL', () => {
  const ce = new ComputeEngine();
  const lit = defaultedLiteral(2);

  test('`Map` calls the literal with one argument, and the default fills `k`', () => {
    expect(ce.box(['Map', lit, ['List', 1, 2]]).evaluate().toString()).toBe(
      '[2,4]'
    );
  });

  test('a pipe stage', () => {
    expect(
      ce.box(['Pipe', ['List', 1, 2], ['Map', lit]]).evaluate().toString()
    ).toBe('[2,4]');
  });

  test('`Sort` reads the literal as a unary key', () => {
    expect(ce.box(['Sort', ['List', 3, 1, 2], lit]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
  });

  test('`Iterate` calls the literal with the previous value only', () => {
    const f = defaultedLiteral(2, ['Add', 'x', 'k']);
    expect(
      ce.box(['Take', ['Iterate', f, 0], 3]).evaluate().toString()
    ).toBe('[2,4,6]');
  });

  test('the static callback-arity check accepts the literal, and counts its parameters with a default as optional', () => {
    expect(ce.box(['Map', lit, ['List', 1]]).isValid).toBe(true);
    const two = [
      'Function',
      ['Multiply', 'x', 'j', 'k'],
      'x',
      'j',
      ['Optional', 'k', 2],
    ];
    expect(
      ce.box(['Map', two, ['List', 1]] as any).evaluate().toString()
    ).toMatch(/takes 2 to 3 parameters/);
  });

  test('a user function assigned a literal takes its defaults', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('f', ce2.box(lit));
    expect(operatorDefOf(ce2, 'f').signature.toString()).toBe(
      '(x: unknown, k: unknown = 2) -> number'
    );
    expect(ce2.box(['f', 3]).json).toEqual(['f', 3, 2]);
    expect(ce2.box(['f', 3]).evaluate().json).toBe(6);
    expect(ce2.box(['f', 3, 5]).evaluate().json).toBe(15);
  });

  test('`inferredSignature: true`: the literal\'s default replaces the declared one, also for a call made before', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('F', {
      signature: '(x: number, k: number = 2) -> number',
      inferredSignature: true,
    });
    const before = ce2.box(['F', 3]);
    expect(before.json).toEqual(['F', 3, 2]);
    ce2.assign('F', ce2.box(defaultedLiteral(3)));
    expect(ce2.box(['F', 3]).json).toEqual(['F', 3, 3]);
    expect(ce2.box(['F', 3]).evaluate().json).toBe(9);
    expect(before.evaluate().json).toBe(9);
  });
});

describe('PARAMETER DEFAULT VALUES: LITERALS HELD BY VARIABLES', () => {
  test('a declared default wins over the default of the literal the variable holds', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number, number = 2) -> number');
    ce.assign('g', ce.box(defaultedLiteral(3)));
    expect(ce.box(['g', 3]).json).toEqual(['g', 3, 2]);
    expect(ce.box(['g', 3]).evaluate().json).toBe(6);
  });

  test('a variable declared `function` gets the default of its literal at evaluation', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(defaultedLiteral(2)));
    expect(ce.box(['h', 3]).json).toEqual(['h', 3]);
    expect(ce.box(['h', 3]).evaluate().json).toBe(6);
  });

  test.each([
    ['a user function', (ce: ComputeEngine) => ce.assign('f', ce.box(defaultedLiteral(2)))],
    [
      'a variable with an inferred type',
      (ce: ComputeEngine) =>
        ce.declare('f', { value: defaultedLiteral(2), inferred: true }),
    ],
  ])('%s: a call made before the callee changes is filled again', (_, define) => {
    const ce = new ComputeEngine();
    define(ce);
    const e = ce.box(['f', 3]);
    expect(e.json).toEqual(['f', 3, 2]);
    ce.assign('f', ce.box(['Function', 'x', 'x']));
    expect(e.evaluate().json).toBe(3);
    ce.assign('f', ce.box(defaultedLiteral(5)));
    expect(e.evaluate().json).toBe(15);
    // A function that requires `k`: the written call `f(3)` is a partial
    // application, as `f(3)` written after the assignment is.
    ce.assign('f', ce.box(['Function', ['Multiply', 'x', 'k'], 'x', 'k']));
    expect(e.evaluate().operator).toBe('Function');
    expect(e.evaluate().isSame(ce.box(['f', 3]).evaluate())).toBe(true);
  });
});

describe('PARAMETER DEFAULT VALUES: LATEX OF A LITERAL', () => {
  const ce = new ComputeEngine();

  test('a literal with a default is written with its MathJSON operands', () => {
    // There is no `\mapsto` notation for a default value: the parser reads
    // `(x, k=2)\mapsto kx` as a list that holds an equation. The literal is
    // written `\mathrm{Function}(…)`, which reads back as the same literal.
    const f = ce.box(defaultedLiteral(2));
    expect(f.latex).toBe('\\mathrm{Function}(kx, x, \\mathrm{Optional}(k, 2))');
    expect(ce.parse(f.latex).isSame(f)).toBe(true);
    const typed = ce.box([
      'Function',
      'k',
      ['Optional', ['Typed', 'k', "'number'"], 2],
    ]);
    expect(typed.latex).toBe(
      '\\mathrm{Function}(k, \\mathrm{Optional}(\\mathrm{Typed}(k, \\text{number}), 2))'
    );
    expect(ce.parse(typed.latex).isSame(typed)).toBe(true);
    expect(f.toString()).toBe('(x, k = 2) => k * x');
  });

  test('the `\\mapsto` notation with `k = 2` is not a function literal', () => {
    expect(ce.parse('(x, k=2)\\mapsto kx').json).toEqual([
      'Sequence',
      ['Tuple', 'x', ['Equal', 'k', 2]],
      ['Error', "'unexpected-operator'", ['LatexString', "'\\mapsto'"]],
    ]);
  });
});

describe('PARAMETER DEFAULT VALUES: OTHER READERS OF THE PARAMETER LIST', () => {
  const lit = defaultedLiteral(2);

  test('a variable declared with an optional parameter accepts a literal whose parameter has a default', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number, number?) -> number');
    ce.assign('g', ce.box(lit));
    expect(ce.box(['g', 3]).evaluate().json).toBe(6);
    ce.declare('g1', '(number) -> number');
    ce.assign('g1', ce.box(lit));
    expect(ce.box(['g1', 3]).evaluate().json).toBe(6);
    ce.declare('g3', '(number, number, number) -> number');
    expect(() => ce.assign('g3', ce.box(lit))).toThrow(
      /takes 1 to 2 parameter/
    );
  });

  test('a recursive call that leaves out a parameter with a default', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'r',
      ce.box([
        'Function',
        [
          'If',
          ['LessEqual', 'n', 0],
          'acc',
          ['r', ['Subtract', 'n', 1], ['Add', 'acc', 'n']],
        ],
        'n',
        ['Optional', 'acc', 0],
      ])
    );
    expect(ce.box(['r', 4]).evaluate().json).toBe(10);
  });

  test('a callback whose declared slot is stamped on a literal with a default', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Filter',
          ['List', 1, 2, 3],
          ['Function', ['Greater', 'x', 'k'], 'x', ['Optional', 'k', 1]],
        ])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
  });

  test('`EvaluateAt` accepts a point that leaves out a parameter with a default', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['EvaluateAt', lit, 3]).evaluate().json).toBe(6);
  });
});

describe('PARAMETER DEFAULT VALUES: REVIEW FIXES OF FUNCTION LITERALS', () => {
  test('`.N()` reads the exact argument of a parameter with a default', () => {
    const ce = new ComputeEngine();
    // (25! - 1)/24! is just below 25: rounded to a machine number it is 25.
    const q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];
    const lit = [
      'Function',
      ['Floor', 'k'],
      ['Optional', ['Typed', 'k', "'real'"], 0],
    ];
    expect(ce.box(['Apply', lit, q]).N().toString()).toBe('24');
  });

  test('a bare parameter with a default imposes no constraint, as without the default', () => {
    const ce = new ComputeEngine();
    const withDefault = [
      'Function',
      ['Multiply', 'x', 'k'],
      ['Typed', 'x', "'number'"],
      ['Optional', 'k', 2],
    ];
    const without = [
      'Function',
      ['Multiply', 'x', 'k'],
      ['Typed', 'x', "'number'"],
      'k',
    ];
    // The default fills only a left-out argument, so a supplied `Missing`
    // gives the same value with and without the default, and neither call
    // refuses its argument.
    const a = ce.box(['Apply', withDefault, 1, 'Missing']).evaluate();
    const b = ce.box(['Apply', without, 1, 'Missing']).evaluate();
    expect(a.toString()).toBe(b.toString());
    expect(a.operator).not.toBe('Error');
    expect(ce.box(['Apply', withDefault, 1]).evaluate().toString()).toBe('2');
  });

  test('the callback compatibility rule widens a bare parameter with a default', () => {
    const ce = new ComputeEngine();
    // The body infers `k: collection`, a guess that the compatibility rule
    // does not enforce, whether or not the parameter has a default.
    const lit = ce.box(defaultedLiteral(['List'], ['Length', 'k']));
    expect(lit.type.toString()).toBe(
      '(x: unknown, k: collection = []) -> integer | signed_infinity'
    );
    expect(
      typeToString(widenUnannotatedLiteralParams(lit, lit.type.type))
    ).toBe('(x: unknown, k: unknown = []) -> integer | signed_infinity');
  });

  test('the signature-string sugar with a default and a `where` clause', () => {
    const ce = new ComputeEngine();
    const g = ce.box([
      'Function',
      'x',
      "'(x: T, k: number = 2) -> T where T'",
    ] as any);
    expect(g.isValid).toBe(true);
    expect(g.type.toString()).toBe('(x: T, k: number = 2) -> T where T');
    expect(ce.box(['Apply', g, 5]).evaluate().json).toBe(5);
    // The canonical form boxes again to the same literal.
    expect(ce.box(['Apply', g.json, 5]).evaluate().json).toBe(5);
  });

  test('the signature-string sugar with a default and effects', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Multiply', 'k', 3],
      "'(k: number = 2) pure -> number'",
    ] as any);
    expect(f.isValid).toBe(true);
    expect(ce.box(['Apply', f]).evaluate().json).toBe(6);
    expect(ce.box(['Apply', f.json, 4]).evaluate().json).toBe(12);
  });

  test('a default on a quantified parameter of a literal is refused', () => {
    const ce = new ComputeEngine();
    const g = ce.box(['Function', 'x', "'(x: T = 0) -> T where T'"] as any);
    expect(g.isValid).toBe(false);
    expect(g.toString()).toMatch(
      /a default value on a generic parameter is not supported yet/
    );
  });

  test('a marker whose default differs from the default of the parameter is refused', () => {
    const ce = new ComputeEngine();
    const g = ce.box([
      'Function',
      ['Typed', 'x', "'(x: number, k: number = 3) -> number'"],
      'x',
      ['Optional', 'k', 2],
    ] as any);
    expect(g.isValid).toBe(false);
  });

  test('a generic literal keeps the default of a parameter that the marker lists as required', () => {
    const ce = new ComputeEngine();
    // The Epsil lowering of `function g<T>(x: T, k: number = 2) -> T`
    // writes the marker without the default.
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Typed', ['Add', 'x', 'k'], "'(x: T, k: number) -> T where T'"],
        'x',
        ['Optional', ['Typed', 'k', "'number'"], 2],
      ] as any)
    );
    expect(ce.box('g').type.toString()).toBe(
      '(x: T, k: number = 2) -> T where T'
    );
    expect(ce.box(['g', 3]).evaluate().json).toBe(5);
    expect(ce.box(['g', 3, 5]).evaluate().json).toBe(8);
  });

  test('a callback whose only parameter has a default is unary', () => {
    const ce = new ComputeEngine();
    const negate = ['Function', ['Negate', 'x'], ['Optional', 'x', 0]];
    expect(
      ce.box(['Sort', ['List', 1, 3, 2], negate]).evaluate().toString()
    ).toBe('[3,2,1]');
    const step = ['Function', ['Add', 'x', 1], ['Optional', 'x', 0]];
    const plain = ['Function', ['Add', 'x', 1], 'x'];
    expect(
      ce.box(['Take', ['Iterate', step, 0], 3]).evaluate().toString()
    ).toBe(ce.box(['Take', ['Iterate', plain, 0], 3]).evaluate().toString());
  });

  test('the operand descriptor and `def.lambda` report a parameter with a default as optional', () => {
    const ce = new ComputeEngine();
    const lit = ce.box(defaultedLiteral(2));
    const s = describeOperand(lit).structureOf?.();
    expect(s?.kind).toBe('function-literal');
    if (s?.kind === 'function-literal')
      expect(s.parameters).toEqual([
        { name: 'x' },
        { name: 'k', optional: true, default: { kind: 'value', value: 2 } },
      ]);
    ce.assign('h', lit);
    const params = operatorDefOf(ce, 'h').lambda?.parameters;
    expect(params?.map((p) => [p.name, p.optional, p.default])).toEqual([
      ['x', undefined, undefined],
      ['k', true, { kind: 'value', value: 2 }],
    ]);
  });

  test('a rewritten marker keeps the argument names of the marker', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Typed', ['Add', 'x', 'k'], "'(a: T, d: number) -> T where T'"],
        'x',
        ['Optional', ['Typed', 'k', "'number'"], 2],
      ] as any)
    );
    expect(ce.box('g').type.toString()).toBe(
      '(a: T, d: number = 2) -> T where T'
    );
    expect(ce.box(['g', 3]).evaluate().json).toBe(5);
    expect(
      ce.box(['g', 3, ['NamedArgument', { str: 'd' }, 5]] as any).evaluate()
        .json
    ).toBe(8);
  });

  test('a default that names a parameter of a literal with a marker gives one error', () => {
    const ce = new ComputeEngine();
    const g = ce.box([
      'Function',
      ['Typed', ['Add', 'x', 'k'], "'(a: T, d: number) -> T where T'"],
      'x',
      ['Optional', ['Typed', 'k', "'number'"], 'x'],
    ] as any);
    expect(g.isValid).toBe(false);
    expect(g.errors.length).toBe(1);
    expect(g.toString()).toMatch(/a default value cannot name a parameter/);
  });

  test('an argument named like a keyword of the type lexer is backticked', () => {
    const ce = new ComputeEngine();
    const g = ce.box([
      'Function',
      ['Typed', ['Add', 'x', 'true'], "'(a: T, b: number) -> T where T'"],
      'x',
      ['Optional', ['Typed', 'true', "'number'"], 2],
    ] as any);
    expect(g.type.toString()).toBe('(a: T, b: number = 2) -> T where T');
    const sig: Type = {
      kind: 'signature',
      args: [{ name: 'x', type: 'number' }],
      optArgs: [
        { name: 'true', type: 'number', default: { kind: 'value', value: 2 } },
      ],
      result: 'number',
    };
    const text = typeToString(sig);
    expect(text).toBe('(x: number, `true`: number = 2) -> number');
    expect(typeToString(parseType(text))).toBe(text);
    expect(parseType(text)).toEqual(sig);
  });

  test('the operand of a marker is not marked: the same operand in another `Typed` refuses a default', () => {
    const ce = new ComputeEngine();
    const s = ce.string('(x: number, k: number = 2) -> number');
    const lit = ce.box([
      'Function',
      ['Typed', ['Add', 'x', 'k'], s],
      'x',
      ['Optional', 'k', 2],
    ] as any);
    expect(lit.isValid).toBe(true);
    const other = ce.box([
      'Typed',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      s,
    ] as any);
    expect(other.isValid).toBe(false);
    expect(other.toString()).toMatch(
      /a default value is allowed only in a top-level function signature/
    );
  });

  test('a marker default that differs from an empty-dictionary default is refused', () => {
    const ce = new ComputeEngine();
    const g = ce.box([
      'Function',
      ['Typed', 'x', "'(x: any, m: any = 5) -> any'"],
      'x',
      ['Optional', 'm', ['Dictionary']],
    ] as any);
    expect(g.isValid).toBe(false);
  });

  test('a generic literal keeps an empty-dictionary default that the marker lists as required', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Typed', 'x', "'(x: T, m: dictionary) -> T where T'"],
        'x',
        ['Optional', ['Typed', 'm', "'dictionary'"], ['Dictionary']],
      ] as any)
    );
    expect(ce.box('g').type.toString()).toBe(
      '(x: T, m: dictionary = {}) -> T where T'
    );
    expect(ce.box(['g', 3]).evaluate().json).toBe(3);
  });
});
