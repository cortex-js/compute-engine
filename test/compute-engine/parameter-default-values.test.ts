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

// Default values for optional parameters (GitHub issue #490). The design is
// in `docs/plans/2026-10-31-parameter-default-values.md`.

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
    [
      '(x: number, k: number = 0x10) -> number',
      '`0x10` is not a default value',
    ],
    [
      '(x: number, k: number = 0b10) -> number',
      '`0b10` is not a default value',
    ],
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
    [
      '(x: number, k: number = Indeterminate) -> number',
      '`Indeterminate` is not a default value',
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

  test('a signed hexadecimal default is refused', () => {
    expect(parseError('(x: number, k: number = -0x10) -> number')).toMatch(
      /is not a default value/
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

  test('a declared symbol default is accepted when it fits the parameter', () => {
    const name = declareOp('(x: number, over: set = Integers) -> number');
    expect(json(parameterDefaultOperands(ce, operatorDef(name)))).toEqual([
      'Integers',
    ]);
  });

  test('an undeclared symbol default is accepted at every parameter type', () => {
    const name = declareOp('(x: number, mode: symbol = Automatic) -> number');
    expect(json(parameterDefaultOperands(ce, operatorDef(name)))).toEqual([
      'Automatic',
    ]);
    expect(() =>
      declareOp('(x: number, over: set = UndeclaredSetName) -> number')
    ).not.toThrow();
    expect(() =>
      declareOp('(x: number, k: number = UndeclaredNumberName) -> number')
    ).not.toThrow();
  });

  test('a declared symbol default whose type does not fit is refused', () => {
    expect(() =>
      declareOp('(x: number, k: number = Integers) -> number')
    ).toThrow(
      /the default value Integers of the parameter "k" does not match its type "number"/
    );
  });

  test('a symbol default must be one of the literal symbol types of its parameter', () => {
    expect(() =>
      declareOp(
        '(x: number, mode: symbol<Auto> | symbol<Manual> = Atuo) -> number'
      )
    ).toThrow(/is not one of the symbols its type lists \(Auto, Manual\)/);
    expect(() =>
      declareOp(
        '(x: number, mode: symbol<Auto> | symbol<Manual> = Auto) -> number'
      )
    ).not.toThrow();
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
    ce.box(['UpgradedG', 1]);
    expect(() =>
      ce
        .box(['Declare', 'UpgradedG', '\'(number, number = "a") -> number\''])
        .evaluate()
    ).toThrow(/does not match its type "number"/);
    ce.box('UpgradedH');
    ce.box([
      'Declare',
      'UpgradedH',
      "'(number, number = 2) -> number'",
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

  test('an undeclared symbol default is declared in the scope given to `ce.declare`', () => {
    const outer = ce.context.lexicalScope;
    ce.pushScope();
    try {
      ce.declare(
        'ScopedDefaultOp',
        {
          signature: '(x: number, m: symbol = ScopedDefaultSym) -> number',
          evaluate: (ops) => ops[0],
        },
        outer
      );
      expect(ce.context.lexicalScope.bindings.has('ScopedDefaultSym')).toBe(
        false
      );
      expect(outer.bindings.has('ScopedDefaultSym')).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('a retype in an inner scope boxes the defaults in the scope that holds the binding', () => {
    const outer = ce.context.lexicalScope;
    // An operator definition, retyped through the `type` setter of its
    // symbol and through its `signature` setter.
    ce.declare('RetypedOp', {
      signature: '(x: number) -> number',
      evaluate: (ops) => ops[0],
    });
    // A value definition retyped to a function type, and a value definition
    // whose type is replaced.
    ce.declare('RetypedValue', 'number');
    ce.declare('RetypedFnValue', '(number) -> number');
    ce.pushScope();
    const inner = ce.context.lexicalScope;
    try {
      ce.box('RetypedOp').type =
        '(x: number, m: symbol = RetypeSymA) -> number';
      operatorDef('RetypedOp').signature = ce.type(
        '(x: number, m: symbol = RetypeSymB) -> number'
      );
      ce.box('RetypedValue').type =
        '(x: number, m: symbol = RetypeSymC) -> number';
      ce.box('RetypedFnValue').type =
        '(x: number, m: symbol = RetypeSymD) -> number';
      for (const name of ['RetypeSymA', 'RetypeSymB', 'RetypeSymC', 'RetypeSymD']) {
        expect(inner.bindings.has(name)).toBe(false);
        expect(outer.bindings.has(name)).toBe(true);
      }
    } finally {
      ce.popScope();
    }
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

  test('a refused declaration does not declare its symbol default', () => {
    expect(() =>
      declareOp(
        '(x: number, mode: symbol<Auto> | symbol<Manual> = Atuo) -> number'
      )
    ).toThrow(/is not one of the symbols its type lists/);
    expect(ce.lookupDefinition('Atuo')).toBeUndefined();
    // A later value default that does not fit refuses the declaration too.
    expect(() =>
      declareOp(
        '(x: number, m: symbol = UnusedDefaultSym, k: number = "a") -> number'
      )
    ).toThrow(/does not match its type "number"/);
    expect(ce.lookupDefinition('UnusedDefaultSym')).toBeUndefined();
  });

  test('with `ce.strict` set to `false`, a symbol default is not checked against its parameter type', () => {
    // A call in non-strict mode accepts `Integers` written as the argument
    // at a `number` parameter, so the declaration accepts it as a default.
    const lax = new ComputeEngine();
    lax.strict = false;
    expect(() =>
      lax.declare('LaxDefaultOp', {
        signature: '(x: number, k: number = Integers) -> number',
        evaluate: (ops) => ops[0],
      })
    ).not.toThrow();
    // The literal symbol types of a parameter are still checked.
    expect(() =>
      lax.declare('LaxSymbolOp', {
        signature:
          '(x: number, mode: symbol<Auto> | symbol<Manual> = Atuo) -> number',
        evaluate: (ops) => ops[0],
      })
    ).toThrow(/is not one of the symbols its type lists/);
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

  test('a named argument with the value `Nothing` takes the default', () => {
    expect(
      ce.box(['Scaled', 3, ['NamedArgument', "'factor'", 'Nothing']]).json
    ).toEqual(['Scaled', 3, 2]);
  });

  test('a positional `Nothing` is dropped before the fill', () => {
    expect(ce.box(['Scaled', 3, 'Nothing']).json).toEqual(['Scaled', 3, 2]);
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
    // The eager operand canonicalizes to `Nothing`, which is removed for a
    // callee with a default; the lazy operand is held as written.
    expect(seen).toEqual([[], [['Sequence']]]);
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
    ).toEqual(['Holes', 3, 1, 5]);
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

describe('PARAMETER DEFAULT VALUES: SYMBOL DEFAULTS', () => {
  const ce = new ComputeEngine();
  test('a symbol default is inserted as the symbol', () => {
    ce.declare('Over', { signature: '(x: number, over: set = Integers) -> number' });
    expect(ce.box(['Over', 'x']).json).toEqual(['Over', 'x', 'Integers']);
  });

  test('a symbol default with a value evaluates as the written symbol does', () => {
    ce.declare('TimesK', {
      signature: '(x: number, k: number = Pi) -> number',
      evaluate: ([x, k]) => x.mul(k),
    });
    const filled = ce.box(['TimesK', 2]);
    expect(filled.json).toEqual(['TimesK', 2, 'Pi']);
    expect(
      filled.evaluate().isSame(ce.box(['TimesK', 2, 'Pi']).evaluate())
    ).toBe(true);
  });

  describe('the symbol is read where the call is evaluated, as a written symbol is', () => {
    ce.declare('d', 'number');
    ce.assign('d', 2);
    ce.declare('ScaledByD', {
      signature: '(x: number, k: number = d) -> number',
      evaluate: ([x, k]) => x.mul(k).evaluate(),
    });

    test('at the top level', () => {
      expect(ce.box(['ScaledByD', 3]).json).toEqual(['ScaledByD', 3, 'd']);
      expect(ce.box(['ScaledByD', 3]).evaluate().json).toBe(6);
    });

    test('inside a block that declares `d`', () => {
      const block = (call: unknown) =>
        ce
          .box(['Block', ['Declare', 'd', "'number'"], ['Assign', 'd', 5], call] as any)
          .evaluate().json;
      expect(block(['ScaledByD', 3])).toBe(15);
      expect(block(['ScaledByD', 3, 'd'])).toBe(15);
    });

    test('inside a function whose parameter is named `d`', () => {
      const inFunction = (call: unknown) =>
        ce.box(['Apply', ['Function', call, 'd'], 10] as any).evaluate().json;
      // The filled call reads the same binding as the written call.
      expect(inFunction(['ScaledByD', 3])).toBe(
        inFunction(['ScaledByD', 3, 'd'])
      );
    });

    test('an assignment after the call was made changes a later evaluation', () => {
      const e = ce.box(['ScaledByD', 3]);
      ce.assign('d', 7);
      expect(e.evaluate().json).toBe(21);
      ce.assign('d', 2);
    });
  });
});

describe('PARAMETER DEFAULT VALUES: REVIEW FIXES OF THE FILL', () => {
  test('a positional `Nothing` in a named call is an absent operand: a required slot is `missing`', () => {
    const ce = new ComputeEngine();
    ce.declare('Holes', {
      signature:
        '(x: number, density: number = 1, factor: number = 2) -> number',
    });
    const e = ce.box(['Holes', 'Nothing', ['NamedArgument', "'factor'", 5]]);
    expect(e.isValid).toBe(false);
    expect(JSON.stringify(e.json)).toMatch(/missing/);
    expect(JSON.stringify(e.json)).toMatch(/`x`/);
    // A positional `Nothing` before another positional argument is removed,
    // as `flatten` removes it: the next argument takes its slot.
    expect(
      ce.box(['Holes', 'Nothing', 3, ['NamedArgument', "'factor'", 5]]).json
    ).toEqual(['Holes', 3, 1, 5]);
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

  test('a symbol default reads the binding of the scope of the call', () => {
    const ce = new ComputeEngine();
    ce.declare('d', { value: 2, constant: true, holdUntil: 'evaluate' });
    ce.declare('ScaledByD', {
      signature: '(x: number, k: number = d) -> number',
      evaluate: ([x, k]) => x.mul(k).evaluate(),
    });
    expect(ce.box(['ScaledByD', 3]).evaluate().json).toBe(6);
    ce.pushScope();
    try {
      ce.declare('d', { value: 5, constant: true, holdUntil: 'evaluate' });
      expect(ce.box(['ScaledByD', 3, 'd']).evaluate().json).toBe(15);
      expect(ce.box(['ScaledByD', 3]).evaluate().json).toBe(15);
    } finally {
      ce.popScope();
    }
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

  test('a positional `Nothing` in a named call to an overload set fills no slot', () => {
    const ce = new ComputeEngine();
    ce.declare('Ov', {
      signature:
        '((x: number, y: number, z: number?) -> number) & ((a: number, b: number, c: number?) -> number)',
    });
    expect(
      ce.box(['Ov', 'Nothing', named('x', 1), named('y', 2)] as any).json
    ).toEqual(['Ov', 1, 2]);
    // Two arms that read the call in different orders.
    ce.declare('Swap', {
      signature:
        '((a: number, b: number) -> number) & ((b: number, a: number) -> number)',
    });
    expect(ce.box(['Swap', 'Nothing', 3, named('b', 4)] as any).json).toEqual(
      ce.box(['Swap', 3, named('b', 4)] as any).json
    );
  });

  test('a positional `Nothing` in a named call without defaults', () => {
    const ce = new ComputeEngine();
    ce.declare('G', { signature: '(a: number, b: number) -> number' });
    expect(ce.box(['G', 'Nothing', 3, named('b', 4)] as any).json).toEqual([
      'G',
      3,
      4,
    ]);
    const e = ce.box(['G', 'Nothing', named('b', 4)] as any);
    expect(e.isValid).toBe(false);
    expect(JSON.stringify(e.json)).toMatch(/missing/);
  });

  test('a call boxed again after its callee changed reads a symbol default in the scope of the call', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'number');
    ce.assign('d', 2);
    ce.declare('f', {
      signature: '(x: number, k: number = d) -> number',
      evaluate: ['Function', ['Multiply', 'x', 'k'], 'x', 'k'],
    });
    const e = ce.box(['f', 3]);
    expect(e.json).toEqual(['f', 3, 'd']);
    expect(e.evaluate().json).toBe(6);
    ce.assign('f', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    // `Probe` evaluates the saved call while the parameter `d` of `H` is
    // bound to 10. The default `d` of the call is the global `d`, as a `d`
    // written in the call would be.
    ce.declare('Probe', {
      signature: '() -> number',
      pure: false,
      evaluate: () => e.evaluate(),
    });
    ce.declare('H', {
      signature: '(d: number) -> number',
      evaluate: ['Function', ['Probe'], 'd'],
    });
    expect(ce.box(['H', 10]).evaluate().json).toBe(5);
    expect(e.evaluate().json).toBe(5);
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

  test('a call boxed again after its callee changed reads a symbol default received at a hole in the scope of the call', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'number');
    ce.assign('d', 2);
    ce.declare('f', {
      signature: '(x: number, k: number = d, factor: number = 2) -> number',
      evaluate: ['Function', ['Multiply', 'x', 'k', 'factor'], 'x', 'k', 'factor'],
    });
    const e = ce.box(['f', 3, named('factor', 5)] as any);
    expect(e.json).toEqual(['f', 3, 'd', 5]);
    expect(e.evaluate().json).toBe(30);
    ce.assign(
      'f',
      ce.box(['Function', ['Add', 'x', 'k', 'factor'], 'x', 'k', 'factor'])
    );
    // `Probe` evaluates the saved call while the parameter `d` of `H` is
    // bound to 10. The default `d` of the call is the global `d`.
    ce.declare('Probe', {
      signature: '() -> number',
      pure: false,
      evaluate: () => e.evaluate(),
    });
    ce.declare('H', {
      signature: '(d: number) -> number',
      evaluate: ['Function', ['Probe'], 'd'],
    });
    expect(ce.box(['H', 10]).evaluate().json).toBe(10);
    expect(e.evaluate().json).toBe(10);
  });
});
