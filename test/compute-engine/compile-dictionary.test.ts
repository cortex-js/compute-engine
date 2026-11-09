// Compilation of a dictionary literal, `["Dictionary", ["Tuple", "'a'", 1]]`
// (`{a -> 1}` in Epsil, `{}` for the empty dictionary).
//
// The JavaScript target spells it as an object literal and the Python target
// as a `dict` display, with each value compiled. Each evaluation makes a new
// value, in the run-time form that the host supplies for an input of type
// `dictionary`: a plain object in JavaScript, a `dict` in Python. A value
// whose type is `unknown` declines, and so does a dictionary on a target that
// has no dictionary value (interval-js, GLSL).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';
import { typeHoldsKeyedValue } from '../../src/compute-engine/compilation/compiler-type-facts';
import { parseType } from '../../src/common/type/parse';

type Json = any;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('d', 'dictionary<integer>');

function compiled(expr: Json, to: string): any {
  return compile(ce.box(expr) as any, { to, fallback: false } as any);
}

/** The entry `key -> value` of a dictionary literal. */
function entry(key: string, value: Json): Json {
  return ['Tuple', `'${key}'`, value];
}

/** A dictionary whose values read `x`, nest a list and a dictionary, and
 * whose key `__proto__` must be an own key of the value. */
const MIXED: Json = [
  'Dictionary',
  entry('a', ['Add', 'x', 1]),
  entry('__proto__', 2),
  entry('b', ['List', 1, ['Multiply', 3, 'x']]),
  entry('c', ['Dictionary', entry('s', "'text'")]),
];

/** A key with a quote, a backslash, a line break and a non-ASCII letter. */
const ESCAPED: Json = ['Dictionary', entry('q"\\\n é', 1)];

/** The interpreter's value of `expr` at `x = 1`, as a plain object. */
function interpreted(expr: Json): unknown {
  const value = ce.box(expr).subs({ x: 1 }).N();
  const plain = (json: Json): unknown => {
    if (typeof json === 'object' && json !== null && 'dict' in json) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(json.dict))
        Object.defineProperty(out, k, {
          value: plain(v),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      return out;
    }
    if (Array.isArray(json) && json[0] === 'List')
      return json.slice(1).map(plain);
    if (typeof json === 'object' && json !== null && 'str' in json)
      return json.str;
    if (typeof json === 'object' && json !== null && 'num' in json)
      return Number(json.num);
    if (typeof json === 'string' && json.startsWith("'"))
      return json.slice(1, -1);
    return json;
  };
  return plain(value.json);
}

describe('COMPILE A DICTIONARY: JAVASCRIPT', () => {
  test('the empty dictionary is a new plain object', () => {
    const r = compiled(['Dictionary'], 'javascript');
    expect(r.success).toBe(true);
    expect(r.code).toBe('({})');
    const a = r.run();
    const b = r.run();
    expect(a).toEqual({});
    expect(a).not.toBe(b);
    expect(ce.box(['Dictionary']).evaluate().json).toEqual({ dict: {} });
  });

  test('a dictionary with entries is an object literal of the compiled values', () => {
    const r = compiled(MIXED, 'javascript');
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '({"a": _.x + 1, ["__proto__"]: 2, "b": [1, 3 * _.x], "c": ({"s": "text"})})'
    );
    const value = r.run({ x: 1 });
    expect(value).toEqual(interpreted(MIXED));
    expect(r.run({ x: 1 })).not.toBe(value);
  });

  test('the key `__proto__` is an own key, and the prototype is not changed', () => {
    const value = compiled(MIXED, 'javascript').run({ x: 1 });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(['a', '__proto__', 'b', 'c']);
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toBe(2);
  });

  test('a key with a quote, a backslash and a line break is escaped', () => {
    const r = compiled(ESCAPED, 'javascript');
    expect(r.code).toBe('({"q\\"\\\\\\n é": 1})');
    expect(r.run()).toEqual(interpreted(ESCAPED));
  });

  test('a value that is a dictionary input, a block local or in a list', () => {
    const input = compiled(['Dictionary', entry('a', 'd')], 'javascript');
    expect(input.run({ d: { k: 4 } })).toEqual({ a: { k: 4 } });

    const local = [
      'Block',
      ['Assign', 'q', ['Multiply', 2, 'x']],
      ['Dictionary', entry('a', 'q'), entry('b', ['Add', 'q', 1])],
    ];
    expect(compiled(local, 'javascript').run({ x: 1 })).toEqual(
      interpreted(local)
    );

    const list = ['List', 1, ['Dictionary'], ['Dictionary', entry('a', 'x')]];
    expect(compiled(list, 'javascript').code).toBe(
      '[1, ({}), ({"a": _.x})]'
    );
    expect(compiled(list, 'javascript').run({ x: 1 })).toEqual(
      interpreted(list)
    );
  });

  test('an empty dictionary in an `If`', () => {
    const branch = ['If', ['Greater', 'x', 0], ['Dictionary'], ['Dictionary']];
    expect(compiled(branch, 'javascript').run({ x: 1 })).toEqual({});
    expect(interpreted(branch)).toEqual({});
  });

  test('a value of type `unknown` declines with a reason', () => {
    for (const to of ['javascript', 'python']) {
      expect(() =>
        compiled(['Dictionary', entry('a', ['g', 'x'])], to)
      ).toThrow(/the value of the key "a" has the type `unknown`/);
    }
  });

  test('an untyped input in a value is refused by name, as elsewhere', () => {
    for (const to of ['javascript', 'python']) {
      expect(() => compiled(['Dictionary', entry('a', 'zz')], to)).toThrow(
        /the input `zz` has no type/
      );
      const r: any = compile(
        ce.box(['Dictionary', entry('a', 'zz')]) as any,
        { to } as any
      );
      expect(r.success).toBe(false);
      expect(r.unsupported).toContain('zz');
    }
  });

  test('the free symbols of the values are inputs', () => {
    const r = compiled(['Dictionary', entry('a', ['Add', 'x', 1])], 'javascript');
    expect(r.freeSymbols).toContain('x');
  });

  test('a call of a block-local function has the result type of its literal', () => {
    const expr = [
      'Block',
      ['Assign', 'f', ['Function', ['Add', 'u', 1], 'u']],
      ['Dictionary', entry('a', ['f', 'x'])],
    ];
    expect(compiled(expr, 'javascript').run({ x: 1 })).toEqual(
      interpreted(expr)
    );
    expect(compiled(expr, 'python').success).toBe(true);
  });

  test('a value that can be `Nothing` declines with a reason', () => {
    const local = new ComputeEngine();
    local.declare('n', 'integer | nothing');
    for (const to of ['javascript', 'python']) {
      expect(() =>
        compile(
          local.box(['Dictionary', entry('a', 'n')]) as any,
          { to, fallback: false } as any
        )
      ).toThrow(/the value of the key "a" can be `Nothing`/);
    }
  });

  test('an assignment in a value declines', () => {
    // An assignment is a statement: an assignment whose value is used
    // declines on every target.
    const expr = [
      'Block',
      ['Assign', 'q', 1],
      [
        'List',
        'q',
        ['Dictionary', entry('a', ['Assign', 'q', ['Add', 'q', 1]])],
        'q',
      ],
    ];
    for (const to of ['javascript', 'python'])
      expect(() => compiled(expr, to)).toThrow(
        /an assignment or a declaration is a statement, and its value is used|an assignment is a statement in 'python'/
      );
  });

  test('a dictionary with the keys `re` and `im` is not read as a complex number', () => {
    const re = ['Dictionary', entry('re', 'x'), entry('im', 0)];
    expect(compiled(re, 'javascript').run({ x: 1 })).toEqual({ re: 1, im: 0 });
    expect(interpreted(re)).toEqual({ re: 1, im: 0 });
    expect(compiled(['List', re], 'javascript').run({ x: 1 })).toEqual([
      { re: 1, im: 0 },
    ]);
    const lit = ['Function', re, ['Typed', 'x', "'real'"]];
    expect(compiled(lit, 'javascript').run(1)).toEqual({ re: 1, im: 0 });
  });

  test('an untyped parameter or local in a value declines', () => {
    // Input admission refuses only free inputs: a bound name is not one.
    for (const to of ['javascript', 'python']) {
      expect(() =>
        compiled(['Function', ['Dictionary', entry('a', 'u')], 'u'], to)
      ).toThrow(/the value of the key "a" has the type `unknown`/);
    }
    const typed = [
      'Function',
      ['Dictionary', entry('a', 'u')],
      ['Typed', 'u', "'real'"],
    ];
    expect(compiled(typed, 'javascript').run(3)).toEqual({ a: 3 });
  });

  test('a dictionary in a tuple, a list of tuples or a union is returned as it is', () => {
    const re = ['Dictionary', entry('re', 'x'), entry('im', 0)];
    const tuple = ['Tuple', re, 1];
    expect(compiled(tuple, 'javascript').run({ x: 1 })).toEqual([
      { re: 1, im: 0 },
      1,
    ]);
    const rows = ['List', ['Tuple', re, 1], ['Tuple', re, 2]];
    expect(compiled(rows, 'javascript').run({ x: 1 })).toEqual([
      [{ re: 1, im: 0 }, 1],
      [{ re: 1, im: 0 }, 2],
    ]);
    for (const t of [
      'tuple<integer, integer> | record{re: real, im: integer}',
      'list<tuple<dictionary<integer>, number>>',
      'tuple<integer, list<record{a: real}>>',
    ])
      expect(typeHoldsKeyedValue(parseType(t))).toBe(true);
    for (const t of ['tuple<integer, real>', 'list<complex>', 'number'])
      expect(typeHoldsKeyedValue(parseType(t))).toBe(false);
  });

  test('a dictionary that a block-local function returns is returned as it is', () => {
    const expr = [
      'Block',
      [
        'Assign',
        'f',
        [
          'Function',
          ['Dictionary', entry('re', 'u'), entry('im', 0)],
          ['Typed', 'u', "'real'"],
        ],
      ],
      ['f', 'x'],
    ];
    expect(compiled(expr, 'javascript').run({ x: 1 })).toEqual({ re: 1, im: 0 });
    expect(interpreted(expr)).toEqual({ re: 1, im: 0 });
  });

  test('a block-local function assigned twice keeps the general result convention', () => {
    // The call reads the second literal, a number, so the result is not
    // read with the dictionary type of the first literal.
    const expr = [
      'Block',
      [
        'Assign',
        'f',
        [
          'Function',
          ['Dictionary', entry('re', 'u'), entry('im', 0)],
          ['Typed', 'u', "'real'"],
        ],
      ],
      ['Assign', 'f', ['Function', ['Multiply', 2, 'u'], ['Typed', 'u', "'real'"]]],
      ['f', 'x'],
    ];
    const r: any = compile(ce.box(expr) as any, { to: 'javascript' } as any);
    expect(r.run({ x: 1 })).toEqual(interpreted(expr));
  });

  test('a temporary is not named as a symbol that only a value reads', () => {
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('_cse1', 'real');
    const shared = ['Add', ['Sin', 'x'], 1];
    const expr = [
      'List',
      shared,
      ['Multiply', 2, shared],
      ['Dictionary', entry('a', '_cse1')],
    ];
    const r: any = compile(
      local.box(expr) as any,
      { to: 'python', fallback: false } as any
    );
    expect(r.code).not.toMatch(/for _cse1 in/);
    expect(r.code).toContain('{"a": _cse1}');
  });

  test('a dictionary input with the keys `re` and `im` is accepted as it is', () => {
    // The input was checked as a real number, and refused as a complex one.
    expect(compiled('d', 'javascript').run({ d: { re: 1, im: 0 } })).toEqual({
      re: 1,
      im: 0,
    });
    expect(
      compiled(['List', 'd'], 'javascript').run({ d: { re: 1, im: 2 } })
    ).toEqual([{ re: 1, im: 2 }]);
    const lit = ['Function', 'm', ['Typed', 'm', "'dictionary<integer>'"]];
    expect(compiled(lit, 'javascript').run({ re: 1, im: 0 })).toEqual({
      re: 1,
      im: 0,
    });
  });
});

describe('COMPILE A DICTIONARY: PYTHON', () => {
  test('a dictionary is a `dict` display of the compiled values', () => {
    expect(compiled(['Dictionary'], 'python').code).toBe('{}');
    expect(compiled(MIXED, 'python').code).toBe(
      '{"a": x + 1, "__proto__": 2, "b": [1, 3 * x], "c": {"s": "text"}}'
    );
    expect(compiled(ESCAPED, 'python').code).toBe('{"q\\"\\\\\\n é": 1}');
  });

  const python = TEST_PYTHON ?? '';
  const pythonTest = fs.existsSync(python) ? test : test.skip;

  pythonTest('the emitted Python agrees with the interpreter', () => {
    const empty = compiled(['Dictionary'], 'python').code;
    const program = [
      'import json',
      'x = 1',
      `f = lambda: ${empty}`,
      `print(json.dumps([${compiled(MIXED, 'python').code}, ` +
        `${compiled(ESCAPED, 'python').code}, f() is not f()]))`,
    ].join('\n');
    const file = path.join(os.tmpdir(), `ce-py-dictionary-${process.pid}.py`);
    fs.writeFileSync(file, program, 'utf8');
    let out = '';
    try {
      out = execFileSync(python, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual([
      interpreted(MIXED),
      interpreted(ESCAPED),
      true,
    ]);
  });
});

describe('COMPILE A DICTIONARY: TARGETS WITH NO DICTIONARY VALUE', () => {
  test('GLSL and interval-js decline with a reason', () => {
    for (const expr of [['Dictionary'], MIXED]) {
      for (const to of ['glsl']) {
        expect(() => compiled(expr, to)).toThrow(
          /is outside the GLSL fragment/
        );
      }
      const r = compiled(expr, 'interval-js');
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/the target has no dictionary value/);
    }
  });
});
