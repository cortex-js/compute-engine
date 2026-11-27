import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { checkSource } from '../../src/cli/check';
import { epsilValueText } from '../../src/cli/format';
import { explainErrorCode } from '../../src/epsil/error-explanations';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

//
// The Epsil front end of mutable arrays
// (`docs/plans/2026-11-25-mutable-arrays-spec.md`, section 6, and the
// acceptance cases 2, 4a, 5 and 6 of section 18, the interpreter halves):
// the compound assignment to an index of any expression, the static check
// `constant-assignment` of an element write, the error explanations, and the
// examples of the page "Evaluation", section "Arrays".
//

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** The value of the Epsil program `source`, as the CLI prints it. */
function show(source: string): string {
  const result = executeEpsil(ce, source);
  expect(result.diagnostics).toEqual([]);
  return epsilValueText(result.value);
}

/** The value of the Epsil program `source`. */
function value(source: string): Expression {
  return executeEpsil(ce, source).value;
}

/** The error code of an error expression, or `undefined`. */
function errorCode(x: Expression): string | undefined {
  if (x.operator !== 'Error') return undefined;
  return x.json?.[1]?.[1]?.replace(/'/g, '');
}

/** The codes of the diagnostics of `epsil check`. */
function codes(source: string): string[] {
  return checkSource(source).diagnostics.map(
    (d) => d.message[3] ?? d.message[0]
  );
}

/** The parsed form of the last statement, without the source offsets, and
 * the codes of the parse diagnostics. */
function parsed(source: string): [unknown, string[]] {
  const [ast, diagnostics] = parseEpsil(source);
  const block = ce.box(ast as never, { form: 'raw' }).json;
  return [
    Array.isArray(block) && block[0] === 'Program' ? block.at(-1) : block,
    diagnostics.map((d) => d.message[0]),
  ];
}

describe('THE PARSER', () => {
  test('a compound assignment to an index of a field', () => {
    expect(parsed('p.pixels[i] += v')).toEqual([
      ['AddTo', ['At', ['Field', 'p', "'pixels'"], 'i'], 'v'],
      [],
    ]);
  });

  test('a compound assignment to an index of a call', () => {
    expect(parsed('f(x)[i] += v')).toEqual([
      ['AddTo', ['At', ['f', 'x'], 'i'], 'v'],
      [],
    ]);
  });

  test('the positions of a nested index of a field are in order', () => {
    expect(parsed('p.rows[i][j] += v')).toEqual([
      ['AddTo', ['At', ['Field', 'p', "'rows'"], 'i', 'j'], 'v'],
      [],
    ]);
  });

  test('the other forms do not change', () => {
    expect(parsed('a[i] = v')).toEqual([
      ['Assign', 'a', ['ReplaceAt', 'a', 'i', 'v']],
      [],
    ]);
    expect(parsed('m[i][j] = v')).toEqual([
      ['Assign', 'm', ['ReplaceAt', 'm', 'i', 'j', 'v']],
      [],
    ]);
    expect(parsed('p.pixels[i] = v')).toEqual([
      ['Assign', ['At', ['Field', 'p', "'pixels'"], 'i'], 'v'],
      [],
    ]);
    expect(parsed('a[i] += v')).toEqual([['AddTo', ['At', 'a', 'i'], 'v'], []]);
    expect(parsed('s += v')).toEqual([['AddTo', 's', 'v'], []]);
  });

  test('a field, a call and a string position stay add-to-target', () => {
    for (const source of [
      'p.x += 1',
      'f(x) += 1',
      'd["a"] += 1',
      'p.pixels["a"] += 1',
    ])
      expect(parsed(source)).toEqual(['Nothing', ['add-to-target']]);
  });

  test('an inner index with no position stays add-to-target', () => {
    expect(parsed('a[][i] += 1')).toEqual(['Nothing', ['add-to-target']]);
  });
});

describe('A COMPOUND STORE OF A CELL IN A PARALLEL FOR', () => {
  const header = `type P = object{pixels: array<real>, scale: real}
let p = P(pixels: arrayFrom([1, 2, 3], "real"), scale: 2)
let n = 3
`;

  test('p.pixels[i] += v is judged as the plain store p.pixels[i] = v', () => {
    const compound = codes(
      header + 'parallel for i in 1..n { p.pixels[i] += p.scale }'
    );
    expect(compound).toEqual(['parallel-outer-write']);
    expect(
      codes(header + 'parallel for i in 1..n { p.pixels[i] = p.scale }')
    ).toEqual(compound);
  });

  test('a read of an accumulator in a computed base is reported', () => {
    expect(
      codes(
        header +
          `let s = 0
pix(x) = p.pixels
parallel for i in 1..n { s += 1; pix(s)[i] += 1 }`
      )
    ).toContain('parallel-accumulator-read');
  });
});

describe('A COMPOUND ASSIGNMENT TO A CELL', () => {
  test('p.pixels[i] += v stores in the array of the field', () => {
    expect(
      show(`type P = object{pixels: array<integer>}
let p = P(pixels: arrayFrom([1, 2, 3], "integer"))
p.pixels[2] += 10
p.pixels[-1] += 1
listFrom(p.pixels)`)
    ).toBe('[1,12,4]');
  });

  test('f(x)[i] += v stores in the array that the call gives', () => {
    expect(
      show(`type P = object{pixels: array<integer>}
let p = P(pixels: arrayFrom([1, 2, 3], "integer"))
pixelsOf(q) = q.pixels
pixelsOf(p)[1] += 5
listFrom(p.pixels)`)
    ).toBe('[6,2,3]');
  });

  test('a cell of an array in a list field', () => {
    expect(
      show(`type P = object{rows: list<array<integer>>}
let p = P(rows: [arrayFrom([1, 2], "integer")])
p.rows[1][2] += 5
listFrom(p.rows[1])`)
    ).toBe('[1,7]');
  });

  test('an element of a list field is immutable-value-assignment', () => {
    expect(
      errorCode(
        value(`type S = object{px: list<integer>}
let s = S(px: [1, 2])
s.px[2] += 9`)
      )
    ).toBe('immutable-value-assignment');
  });
});

describe('THE STATIC CHECK constant-assignment', () => {
  test('a constant that holds an array accepts a store', () => {
    const source = `const a = arrayFrom([1, 2], "integer")
a[1] = 5
a[2] += 1
listFrom(a)`;
    expect(codes(source)).toEqual([]);
    expect(show(source)).toBe('[5,3]');
  });

  test('a constant that holds a list keeps the diagnostic', () => {
    expect(codes('const L = [1, 2, 3]\nL[2] = 7')).toEqual([
      'constant-assignment',
    ]);
  });

  test('an assignment of a constant that holds an array keeps it', () => {
    expect(codes('const a = arrayFrom([1, 2])\na = arrayFrom([3])')).toEqual([
      'constant-assignment',
    ]);
  });

  test('a constant array in a block, a loop and a function body', () => {
    const source = `function f() {
  const a = arrayFrom([1, 2, 3], "integer")
  for k in 1..2 { a[k] = 5 }
  if true { a[3] = 9 }
  listFrom(a)
}
f()`;
    expect(codes(source)).toEqual([]);
    expect(show(source)).toBe('[5,5,9]');
  });

  test('a function defined before the constant stores in its array', () => {
    const source = `const g = () => do { c[1] = 2 }
const c = arrayFrom([1, 2])
g()
listFrom(c)`;
    expect(codes(source)).toEqual([]);
    expect(show(source)).toBe('[2,2]');
  });

  test('a function defined before a constant range keeps the diagnostic', () => {
    expect(
      codes(`function f() { c[1] = 5; 0 }
const c = 1..3
f()`)
    ).toEqual(['constant-assignment']);
    expect(
      codes(`function f() { c[1] = 5; 0 }
const c = [arrayFrom([1, 2])]
f()`)
    ).toEqual(['constant-assignment']);
  });

  test('a function statement before the constant stores in its array', () => {
    const source = `function f() { c[1] = 2; 0 }
const c = arrayFrom([1, 2])
f()
listFrom(c)`;
    expect(codes(source)).toEqual([]);
    expect(show(source)).toBe('[2,2]');
  });

  test('a constant list of arrays: m[i][j] = v stores in m[i]', () => {
    const source = `const m = [arrayFrom([1, 2]), arrayFrom([3])]
m[1][2] = 7
listFrom(m[1])`;
    expect(codes(source)).toEqual([]);
    expect(show(source)).toBe('[1,7]');
  });

  test('a constant object: a store in its array field', () => {
    const source = `type P = object{pixels: array<integer>}
const p = P(pixels: arrayFrom([1, 2, 3], "integer"))
p.pixels[1] = 9
p.pixels[2] += 1
listFrom(p.pixels)`;
    expect(codes(source)).toEqual([]);
    expect(show(source)).toBe('[9,3,3]');
  });
});

describe('A RUN ERROR IN A NESTED STORE', () => {
  test('a cell value that holds an error is reported at its statement', () => {
    const source = `function g(x: integer) { x + 1 }
let s: any = "a"
let a = arrayFrom([[0], [0]], "any")
for k in 1..1 { a[k] = [g(s)] }
0`;
    const result = executeEpsil(ce, source);
    const reported = result.diagnostics.filter(
      (d) => d.message[0] === 'runtime-error'
    );
    expect(reported.map((d) => d.message[3])).toEqual(['incompatible-type']);
    expect(source.slice(reported[0].range[0], reported[0].range[1])).toBe('s');
  });
});

describe('THE ERROR EXPLANATIONS', () => {
  test('array-allocation-refused', () => {
    const text = explainErrorCode('array-allocation-refused')!;
    expect(text).toContain('ce.arrayAllocation');
    expect(text).toContain('arrayFrom(repeat(0, 100000), "integer<0..255>")');
  });

  test('immutable-value-assignment names the two remedies of an element', () => {
    const text = explainErrorCode('immutable-value-assignment')!;
    expect(text).toContain('s.px = replaceAt(s.px, 2, 9)');
    expect(text).toContain('type S = object{px: array<integer>}');
  });

  test('the example of array-allocation-refused', () => {
    ce.arrayAllocation = (count) => count <= 1000;
    expect(
      errorCode(value('arrayFrom(repeat(0, 100000), "integer<0..255>")'))
    ).toBe('array-allocation-refused');
    expect(show('length(arrayFrom(repeat(0, 1000), "real"))')).toBe('1000');
  });

  test('the remedies of immutable-value-assignment', () => {
    expect(
      show(`type S = object{px: list<integer>}
let s = S(px: [1, 2, 3])
s.px = replaceAt(s.px, 2, 9)
s.px`)
    ).toBe('[1,9,3]');
    expect(
      show(`type S = object{px: array<integer>}
let s = S(px: arrayFrom([1, 2, 3], "integer"))
s.px[2] = 9
listFrom(s.px)`)
    ).toBe('[1,9,3]');
  });

  test('the generated page lists both codes', () => {
    const page = readFileSync(
      join(__dirname, '../../src/epsil/docs/errors.md'),
      'utf8'
    );
    expect(page).toContain('## `immutable-value-assignment`');
    expect(page).toContain('## `array-allocation-refused`');
  });
});

describe('ACCEPTANCE 2: IDENTITY', () => {
  test('let b = a is the same array', () => {
    expect(
      show(`let a = arrayFrom([1, 2, 3])
let b = a
a[1] = 7
(b[1], a == b, a == arrayFrom(a))`)
    ).toBe('(7, true, false)');
  });

  test('the hash of an array is the same before and after a store', () => {
    const a = value('let a = arrayFrom([1, 2])\na');
    const before = a.hash;
    value('a[1] = 9');
    expect(a.hash).toBe(before);
    expect(show('listFrom(a)')).toBe('[9,2]');
  });
});

test('a structural pixel cell keeps its field names when read and saved', () => {
  expect(
    show(`type alias Byte = integer<0..255>
type alias Rgba = tuple<r: Byte, g: Byte, b: Byte, a: Byte>
let img = arrayFrom(repeat((0, 0, 0, 255), 2), "Rgba")
img[2] = (9, 8, 7, 6)
let savedPixel = img[2]
(img[2].g, img[2][2], savedPixel.g, img[3].g)`)
  ).toBe('(8, 8, 8, NaN)');
  const saved = ce.box('savedPixel').evaluate({ materialization: true });
  expect(
    ce.function('Field', [saved, ce.string('g')]).evaluate().json
  ).toBe(8);
});

test('equal bytes can have different field layouts in the same evaluation', () => {
  ce.declareType('Byte', 'integer<0..255>', { alias: true });
  ce.declareType('Rgba', 'tuple<r: Byte, g: Byte, b: Byte, a: Byte>', {
    alias: true,
  });
  ce.declareType('Grba', 'tuple<g: Byte, r: Byte, b: Byte, a: Byte>', {
    alias: true,
  });
  const green = (type: string) => {
    const array = ce.array(new Uint8Array([9, 8, 7, 6]), type);
    const cell = ce.function('At', [array, ce.One]).evaluate();
    return ce.function('Field', [cell, ce.string('g')]);
  };
  expect(
    ce.function('Tuple', [green('Rgba'), green('Grba')]).evaluate().json
  ).toEqual(['Tuple', 8, 9]);
});

describe('ACCEPTANCE 4a: A RANGE AS THE INDEX', () => {
  const A = 'let a = arrayFrom([10, 20, 30, 40, 50])\n';

  test('the reads', () => {
    expect(show(`${A}(a[2..4], a[[1, 3, 5]], a[4..7])`)).toBe(
      '([20,30,40], [10,30,50], [40,50,NaN,NaN])'
    );
    // `4..2` has the warning `range-empty`.
    expect(epsilValueText(value(`${A}a[4..2]`))).toBe('[]');
    expect(show(`${A}a[Range(4, 2)]`)).toBe('[40,30,20]');
  });

  test('a read of a range is a copy', () => {
    expect(show(`${A}let s = a[2..4]\na[2] = 99\ns`)).toBe('[20,30,40]');
  });

  test('a cell of no tuple out of range', () => {
    expect(
      show(`type alias Byte = integer<0..255>
type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>
let img = arrayFrom(repeat(Pixel(0, 0, 0, 255), 2), "Pixel")
img[[0]]`)
    ).toBe('[(NaN, NaN, NaN, NaN)]');
  });

  test('a store to a range is incompatible-type', () => {
    expect(codes(`${A}a[2..3] = [7, 8]`)).toEqual(['incompatible-type']);
  });
});

describe('ACCEPTANCE 5: THE INDEX', () => {
  const A = 'let a = arrayFrom([1, 2, 3], "integer")\n';

  test('a negative index reads and stores the last cell', () => {
    expect(show(`${A}a[-1] = 9\n(a[-1], listFrom(a))`)).toBe('(9, [1,2,9])');
  });

  test('an index out of range reads NaN', () => {
    expect(show(`${A}let n = 3\n(a[n - 3], a[n + 1], a[1.5])`)).toBe(
      '(NaN, NaN, NaN)'
    );
  });

  test('a store out of range is out-of-range', () => {
    for (const index of ['0', 'n + 1', '1.5'])
      expect(errorCode(value(`${A}let n = 3\na[${index}] = 7`))).toBe(
        'out-of-range'
      );
    expect(show('listFrom(a)')).toBe('[1,2,3]');
  });
});

describe('ACCEPTANCE 6: THE FORMS OF A STORE', () => {
  test('a[i] = v of a name declared an array is Assign(At(a, i), v), state', () => {
    value('let b: array<integer> = arrayFrom([1, 2], "integer")');
    const expr = ce.box(parseEpsil('b[1] = 5')[0] as never);
    expect(expr.json).toEqual(['Program', ['Assign', ['At', 'b', 1], 5]]);
    expect(expr.effects).toEqual(['state']);
  });

  test('an untyped parameter stores for an array argument', () => {
    expect(
      show(`function f(a) { a[1] = 5; a }
let x = arrayFrom([1, 2])
f(x)
listFrom(x)`)
    ).toBe('[5,2]');
    expect(ce.box('f').type.toString()).toContain('state');
  });

  test('a local declared any keeps the list write, and stores in an array', () => {
    expect(
      show(`let s: any = [1, 2, 3]
let s0 = s
s[1] = 9
let t: any = arrayFrom([1, 2, 3])
let t0 = t
t[1] = 9
(s, s0, listFrom(t0))`)
    ).toBe('([9,2,3], [1,2,3], [9,2,3])');
  });

  test('m[i][j] = v with m a list of arrays stores in m[i]', () => {
    expect(
      show(`let m = [arrayFrom([1, 2]), arrayFrom([3, 4])]
let row = m[2]
m[2][1] = 30
m[1][2] += 10
[listFrom(m[1]), listFrom(row)]`)
    ).toEqual('[[1,12],[30,4]]');
  });

  test('a list field, and a list cell of an array, are immutable-value-assignment', () => {
    expect(
      errorCode(
        value(`type S = object{px: list<integer>}
let s = S(px: [1, 2])
s.px[2] = 9`)
      )
    ).toBe('immutable-value-assignment');
    expect(
      errorCode(
        value(`let w = arrayFrom([[1, 2]], "list<integer>")
w[1][2] = 5`)
      )
    ).toBe('immutable-value-assignment');
  });
});

describe('THE EXAMPLES OF THE DOCUMENTATION', () => {
  test('the sieve of Eratosthenes', () => {
    expect(
      show(`function primes(n: integer) {
  let composite = arrayFrom(repeat(0, n), "integer<0..1>")
  let found = []
  for k in 2..n {
    if composite[k] == 0 {
      found = [...found, k]
      let j = k * k
      while j <= n {
        composite[j] = 1
        j += k
      }
    }
  }
  found
}
primes(30)`)
    ).toBe('[2,3,5,7,11,13,17,19,23,29]');
  });

  test('a blinker of the Game of Life turns at each step', () => {
    show(`let w = 5
let h = 5
let cur = arrayFrom(repeat(0, w * h), "integer<0..1>")
let next = arrayFrom(repeat(0, w * h), "integer<0..1>")
let board = cur
cell(x, y) = (y % h) * w + x % w + 1
function step() {
  for y in 0..(h - 1) {
    for x in 0..(w - 1) {
      let n = 0
      for dy in -1..1 {
        for dx in -1..1 {
          if dx != 0 || dy != 0 { n += cur[cell(x + dx, y + dy)] }
        }
      }
      let alive = cur[cell(x, y)]
      next[cell(x, y)] = if n == 3 || (alive == 1 && n == 2) { 1 } else { 0 }
    }
  }
  swap(cur, next)
}
rows() = [listFrom(cur[(y * w + 1)..(y * w + w)]) for y in 0..(h - 1)]
for x in 1..3 { cur[cell(x, 2)] = 1 }`);
    const row = '[0,0,0,0,0]';
    const horizontal = `[${row},${row},[0,1,1,1,0],${row},${row}]`;
    const vertical = `[${row},[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],${row}]`;
    expect(show('rows()')).toBe(horizontal);
    for (const expected of [vertical, horizontal, vertical]) {
      show('step()');
      expect(show('rows()')).toBe(expected);
    }
    // `swap` keeps the identity: `board` still names `cur`.
    expect(show('board == cur')).toBe('true');
  });

  test('the page "Evaluation" gives the results that it shows', () => {
    const page = readFileSync(
      join(__dirname, '../../src/epsil/docs/evaluation.md'),
      'utf8'
    );
    const start = page.indexOf('## Arrays');
    const end = page.indexOf('## Errors are values');
    const section = page.slice(start, end);
    const blocks = [...section.matchAll(/```epsil\n([\s\S]*?)\n```/g)];
    expect(blocks.length).toBeGreaterThan(10);
    for (const [, source] of blocks) {
      const expected = [...source.matchAll(/^\/\/ ➔ (.+)$/gm)].at(-1)?.[1];
      ce = new ComputeEngine();
      const result = executeEpsil(ce, source);
      expect(result.diagnostics).toEqual([]);
      if (expected !== undefined)
        expect(epsilValueText(result.value).replace(/\s+/g, '')).toBe(
          expected.replace(/\s+/g, '')
        );
    }
  });
});

describe('A CALL OF A FUNCTION THAT STORES TO A CELL', () => {
  // The function statements of a program are canonicalized before its `let`
  // initializers. The hoisted binding of `a` has the type of an `arrayFrom`
  // initializer, so the store in the body is judged as the store of a cell
  // (`state`), the clause is installed at canonicalization, and the call in
  // the function literal `t` is bound to it.

  /** Whether the call of `name` in the value that `t` holds has an
   * operator definition, and the diagnostics of the program. */
  function callBound(source: string, name = 'z'): [boolean, unknown[]] {
    const result = executeEpsil(ce, source);
    const find = (e: Expression | undefined): Expression | undefined => {
      if (e === undefined) return undefined;
      if (e.operator === name) return e;
      for (const op of e.ops ?? []) {
        const found = find(op);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const def = ce.lookupDefinition('t');
    const stored =
      def !== undefined && 'value' in def ? def.value.value : undefined;
    const call = find(stored);
    expect(call).toBeDefined();
    return [call?.operatorDefinition !== undefined, result.diagnostics];
  }

  const literal = 'let t = (u: real) => do { z(); 1 }';
  const grid = 'let a = arrayFrom(repeat(0, 25), "integer<0..1>")';

  test.each([
    ['a function of no argument', `${grid}\nfunction z() { a[2] = 1 }\n${literal}`],
    [
      'a function of one argument',
      `${grid}\nfunction z(k: integer) { a[k] = 1 }\nlet t = (u: real) => do { z(2); 1 }`,
    ],
    ['a compound assignment', `${grid}\nfunction z() { a[2] += 1 }\n${literal}`],
    [
      'an array of no cell type operand',
      `let a = arrayFrom(repeat(0, 3))\nfunction z() { a[2] = 1 }\n${literal}`,
    ],
    [
      'swap',
      `${grid}\nlet b = arrayFrom(repeat(1, 25), "integer<0..1>")\nfunction z() { swap(a, b) }\n${literal}`,
    ],
    [
      'a store through a field',
      `type P = object{pixels: array<integer>}\nlet p = P(pixels: arrayFrom([1, 2, 3], "integer"))\nfunction z() { p.pixels[2] = 7 }\n${literal}`,
    ],
    [
      'a store to a field of an object',
      `type P = object{x: integer}\nlet p = P(x: 1)\nfunction z() { p.x = 5 }\n${literal}`,
    ],
    [
      'a write of a declared scope',
      `let s: real = 0\nfunction z() scope { s = s + 1 }\n${literal}`,
    ],
    ['print', `function z() { print("x") }\n${literal}`],
  ])('%s', (_, source) => {
    expect(callBound(source)).toEqual([true, []]);
  });

  test('the store runs when the literal is called', () => {
    expect(
      show(`${grid}\nfunction z(k: integer) { a[k] = 1 }
let t = (u: real) => do { z(3); 1 }
t(0)
listFrom(a[1..4])`)
    ).toBe('[0,0,1,0]');
  });

  test('an element write of a list still needs the scope effect', () => {
    const result = executeEpsil(
      ce,
      `let a = [0, 0, 0]\nfunction z() { a[2] = 1 }\n${literal}`
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
