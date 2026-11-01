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
