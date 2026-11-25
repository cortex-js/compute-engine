import { ComputeEngine } from '../../src/compute-engine';
import { checkSource } from '../../src/cli/check';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

//
// An assignment to a list element, `xs[i] = v`, is the rebinding
// `xs = ReplaceAt(xs, i, v)`. Lists have value semantics: another variable
// that holds the old list keeps it.
//

function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

function codes(source: string): string[] {
  return checkSource(source).diagnostics.map((d) => d.message[3] ?? d.message[0]);
}

/** The parsed form of the last statement, without the source offsets. */
function lastStatement(source: string): unknown {
  const ce = new ComputeEngine();
  const block = ce.box(parseEpsil(source)[0] as never, { form: 'raw' }).json;
  return Array.isArray(block) && block[0] === 'Program' ? block.at(-1) : block;
}

/** The number of nested `ReplaceAt`, `Insert` and `DeleteAt` views along
 * the first operand of `expr`. */
function chainDepth(expr: {
  operator: string;
  ops?: ReadonlyArray<unknown>;
}): number {
  let depth = 0;
  let node = expr;
  while (
    ['ReplaceAt', 'Insert', 'DeleteAt'].includes(node.operator) &&
    node.ops !== undefined
  ) {
    depth += 1;
    node = node.ops[0] as typeof expr;
  }
  return depth;
}

describe('a chain of rebuilding views of a large list', () => {
  // `ReplaceAt`, `Insert` and `DeleteAt` over a source of more than 100
  // elements give a lazy view. Each operator, applied 3000 times to its
  // previous result, gives a chain of at most 32 views, with the values of
  // the writes.
  const ce = new ComputeEngine();
  const start = () => ce.function('List', Array.from({ length: 200 }, () => ce.number(0)));

  test('ReplaceAt', () => {
    let xs = start();
    for (let k = 1; k <= 3000; k++)
      xs = ce.function('ReplaceAt', [xs, ce.number((k % 200) + 1), ce.number(k)]).evaluate();
    expect(chainDepth(xs)).toBeLessThanOrEqual(32);
    expect(xs.count).toBe(200);
    expect(xs.at(1)!.re).toBe(3000);
    expect(xs.at(2)!.re).toBe(2801);
    expect(JSON.stringify(xs.json).length).toBeGreaterThan(0);
  });

  test('Insert and DeleteAt', () => {
    let xs = start();
    for (let k = 1; k <= 3000; k++)
      xs = ce.function('Insert', [xs, ce.number(1), ce.number(k)]).evaluate();
    expect(chainDepth(xs)).toBeLessThanOrEqual(32);
    expect(xs.count).toBe(3200);
    expect(xs.at(1)!.re).toBe(3000);
    for (let k = 1; k <= 3000; k++)
      xs = ce.function('DeleteAt', [xs, ce.number(1)]).evaluate();
    expect(chainDepth(xs)).toBeLessThanOrEqual(32);
    expect([...xs.each()].map((x) => x.re)).toEqual(new Array(200).fill(0));
  });

  test('one write stays a lazy view', () => {
    const xs = ce.function('ReplaceAt', [start(), ce.number(1), ce.number(9)]).evaluate();
    expect(xs.operator).toBe('ReplaceAt');
  });
});

describe('an assignment to a list element rebinds the list', () => {
  test.each([
    ['`=`', 'let xs = [1, 2, 3]\nxs[2] = 9\nxs'],
    ['`:=`', 'let xs = [1, 2, 3]\nxs[2] := 9\nxs'],
    ['a negative index', 'let xs = [1, 2, 3]\nxs[-2] = 9\nxs'],
    ['a symbol index', 'let xs = [1, 2, 3]\nlet k = 2\nxs[k] = 9\nxs'],
  ])('%s', (_name, source) => {
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 1, 9, 3]);
  });

  test('the parsed form', () => {
    expect(lastStatement('let xs = [1, 2, 3]\nxs[i + 1] = 9')).toEqual([
      'Assign',
      'xs',
      ['ReplaceAt', 'xs', ['Add', 'i', 1], 9],
    ]);
  });

  test('the value reads the old list', () => {
    const { value } = run('let xs = [1, 2, 3]\nxs[1] = xs[1] + xs[3]\nxs');
    expect(value.json).toEqual(['List', 4, 2, 3]);
  });

  test.each([
    ['two positions', 'let m = [[1, 2], [3, 4]]\nm[2, 1] = 9\nm'],
    ['nested brackets', 'let m = [[1, 2], [3, 4]]\nm[2][1] = 9\nm'],
  ])('a matrix element: %s', (_name, source) => {
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', ['List', 1, 2], ['List', 9, 4]]);
    expect(lastStatement(source.slice(0, source.lastIndexOf('\n')))).toEqual([
      'Assign',
      'm',
      ['ReplaceAt', 'm', 2, 1, 9],
    ]);
  });

  test('lists have value semantics: another variable keeps the old list', () => {
    const { value, diagnostics } = run(
      'let xs = [1, 2, 3]\nlet a = xs\nxs[1] = 5\n[a, xs]'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual([
      'List',
      ['List', 1, 2, 3],
      ['List', 5, 2, 3],
    ]);
  });

  test('a loop', () => {
    const { value, diagnostics } = run(
      'let xs = [1, 2, 3]\nfor i in 1..3 { xs[i] = 10 * i }\nxs'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 10, 20, 30]);
  });

  test('a local of a block that hides an outer list', () => {
    const { value } = run(
      'let xs = [1, 2, 3]\nlet ys = do { let xs = [4, 5]; xs[1] = 0; xs }\n[xs, ys]'
    );
    expect(value.json).toEqual(['List', ['List', 1, 2, 3], ['List', 0, 5]]);
  });

  test('a symbolic position keeps the unevaluated form', () => {
    // As `ReplaceAt` documents: with `k` unknown, `xs` holds the
    // unevaluated write.
    const { value, diagnostics } = run('let xs = [1, 2]\nxs[k] = 1\nxs');
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['ReplaceAt', ['List', 1, 2], 'k', 1]);
  });
});

describe('a write that does not give a list is an error, and the variable keeps its value', () => {
  test.each([
    ['a position past the end', 'let xs = [1, 2]\nxs[5] = 1\nxs', '5'],
    ['the position zero', 'let xs = [1, 2]\nxs[0] = 1\nxs', '0'],
    ['a negative position', 'let xs = [1, 2]\nxs[-3] = 1\nxs', '-3'],
  ])('%s is out-of-range', (_name, source, position) => {
    // The literal index 0 also has the lint `zero-index`.
    const { value, diagnostics } = run(source);
    const runtime = diagnostics.filter((d) => d.message[0] === 'runtime-error');
    expect(runtime.map((d) => d.message[3])).toEqual(['out-of-range']);
    expect(runtime[0].message[1]).toContain(position);
    expect(value.json).toEqual(['List', 1, 2]);
  });

  test('a row past the end of a matrix', () => {
    const { value, diagnostics } = run(
      'let m = [[1, 2], [3, 4]]\nm[3][1] = 9\nm'
    );
    expect(diagnostics.map((d) => d.message[3])).toEqual(['out-of-range']);
    expect(value.json).toEqual(['List', ['List', 1, 2], ['List', 3, 4]]);
  });

  test.each([
    [
      'a string',
      'let s: any = "abc"\ns[1] = "z"\ns',
      ['List', "'z'", ['CharacterFrom', "'b'"], ['CharacterFrom', "'c'"]],
    ],
    ['a tuple', 'let t: any = (1, 2)\nt[1] = 5\nt', ['List', 5, 2]],
    ['a tuple inside the list', 'let m: any = [(1, 2)]\nm[1, 1] = 9\nm', ['List', ['List', 9, 2]]],
  ])('%s gives the list that replaceAt gives', (_name, source, list) => {
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(list);
  });

  test('an implicit string contract refuses a replacement list', () => {
    const { value, diagnostics } = run('let s = "abc"\ns[1] = "z"\ns');
    expect(diagnostics.map((d) => d.message[3])).toEqual(['assignment-type-mismatch']);
    expect(value.json).toBe("'abc'");
  });

  test('a string position past its last character is out-of-range', () => {
    const { value, diagnostics } = run('let s: any = "abc"\ns[4] = "z"\ns');
    expect(diagnostics.map((d) => d.message[3])).toEqual(['out-of-range']);
    expect(value.json).toBe("'abc'");
  });

  test.each([
    ['a number', 'let x = 5\nx[1] = 3\nx', 5],
    ['a flat list with two positions', 'let xs = [1, 2, 3]\nxs[1, 1] = 5\nxs', ['List', 1, 2, 3]],
  ])('%s is the error of replaceAt', (_name, source, kept) => {
    // `replaceAt` gives the error `incompatible-type`, and the variable keeps
    // its value.
    const { value, diagnostics } = run(source);
    expect(diagnostics.map((d) => d.message[3])).toContain('incompatible-type');
    expect(value.json).toEqual(kept);
  });

  test('an index with an effect is evaluated once', () => {
    const { value, diagnostics } = run(
      'let n = 0\nfunction pos() scope -> integer { n = n + 1; 2 }\nlet xs = [1, 2, 3]\nxs[pos()] = 9\n[n, xs]'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 1, ['List', 1, 9, 3]]);
    // Out of range: the index is evaluated once too, and the list is kept.
    const failed = run(
      'let n = 0\nfunction pos() scope -> integer { n = n + 1; 5 }\nlet xs = [1, 2, 3]\nxs[pos()] = 9\n[n, xs]'
    );
    expect(failed.diagnostics.map((d) => d.message[3])).toEqual([
      'out-of-range',
    ]);
    expect(failed.value.json).toEqual(['List', 1, ['List', 1, 2, 3]]);
  });

  test('a static type error in the write quotes the assignment as written', () => {
    const d = checkSource('let x = 5\nx[1] = 3\nx').diagnostics;
    expect(d.map((x) => [x.message[2], x.message[3]])).toEqual([
      ['x[1] := 3', 'incompatible-type'],
    ]);
  });

  test('a list of more than 100 elements', () => {
    const { value, diagnostics } = run(
      'let xs = 1..101 |> map(k => k)\nxs[1] = 9\nxs[101] = 7\n[xs[1], xs[2], xs[101]]'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 9, 2, 7]);
  });

  // A write to a list of more than 100 elements gives a lazy view over the
  // list. A loop of writes made a chain of views with one level for each
  // write, and a walk of the value (its `json`) exceeded the call stack.
  // The chain is now listed into a `List` when it has 32 levels.
  test('a loop of writes to a list of more than 100 elements (CE-1143)', () => {
    const { value, diagnostics } = run(
      'let xs = [0 for k in 1..200]\nfor k in 1..5000 { xs[k % 200 + 1] = xs[k % 200 + 1] + 1 }\nxs'
    );
    expect(diagnostics).toEqual([]);
    const counts = [...value.each()].map((x) => x.re);
    expect(counts).toEqual(new Array(200).fill(25));
    expect(chainDepth(value)).toBeLessThanOrEqual(32);
  });

  // The chain was listed only for a list of at most `ce.maxCollectionSize`
  // (10 000) elements. For a longer list, the chain had one level for each
  // write, and 2000 writes exceeded the call stack.
  test('a loop of writes to a list of more than 10 000 elements (CE-1796)', () => {
    const { value, diagnostics } = run(
      'let fb: list<integer> = [0 for k in 1..12000]\nfor k in 1..300 { fb[k] = k % 256 }\nfb'
    );
    expect(diagnostics).toEqual([]);
    expect(value.count).toBe(12000);
    expect(chainDepth(value)).toBeLessThanOrEqual(32);
    const elements = [...value.each()].map((x) => x.re);
    expect(elements.slice(0, 300)).toEqual(
      Array.from({ length: 300 }, (_, i) => (i + 1) % 256)
    );
    expect(elements.slice(300).every((x) => x === 0)).toBe(true);
  });

  test('the writes of a chain are applied in their order, with negative positions (CE-1796)', () => {
    // 40 writes: the chain is listed once, at 32 views. Positions 1 and -1
    // are each written 20 times; the last write of each is the value.
    const { value, diagnostics } = run(
      'let xs = [0 for k in 1..10500]\nfor k in 1..20 { xs[1] = k; xs[-1] = -k }\n[xs[1], xs[2], xs[10500], count(xs)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 20, 0, -20, 10500]);
  });

  test('another variable keeps the list it held before the writes (CE-1796)', () => {
    const { value, diagnostics } = run(
      'let xs = [0 for k in 1..10500]\nxs[1] = 1\nlet ys = xs\nfor k in 1..40 { xs[2] = k }\n[ys[1], ys[2], xs[1], xs[2]]'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 1, 0, 1, 40]);
  });

  test('a chain of `Insert` and `ReplaceAt` over a list of more than 10 000 elements (CE-1796)', () => {
    const ce = new ComputeEngine();
    let xs = ce.function(
      'List',
      Array.from({ length: 10500 }, (_, i) => ce.number(i))
    );
    const expected = Array.from({ length: 10500 }, (_, i) => i);
    for (let k = 1; k <= 40; k++) {
      if (k % 2 === 0) {
        xs = ce.function('Insert', [xs, ce.number(k), ce.number(-k)]).evaluate();
        expected.splice(k - 1, 0, -k);
      } else {
        xs = ce
          .function('ReplaceAt', [xs, ce.number(-k), ce.number(-k)])
          .evaluate();
        expected[expected.length - k] = -k;
      }
    }
    expect(chainDepth(xs)).toBeLessThanOrEqual(32);
    expect([...xs.each()].map((x) => x.re)).toEqual(expected);
  });

  test('a chain over a range of more than 10 000 elements stays a chain (CE-1796)', () => {
    // The elements of a range are not in memory, and a list of them can be
    // larger than `ce.maxCollectionSize` allows. Such a chain has no limit
    // of depth: issue CE-1832.
    const ce = new ComputeEngine();
    let xs = ce.function('Range', [ce.number(1), ce.number(20000)]).evaluate();
    for (let k = 1; k <= 40; k++)
      xs = ce.function('ReplaceAt', [xs, ce.number(k), ce.number(0)]).evaluate();
    expect(chainDepth(xs)).toBe(40);
    expect(xs.at(40)?.re).toBe(0);
    expect(xs.at(41)?.re).toBe(41);
  });

  test('a write to an element of an undeclared list is assignment-to-undeclared-variable', () => {
    const { value, diagnostics } = run('ys[1] = 9\nys');
    expect(diagnostics.map((d) => d.message[3])).toEqual([
      'assignment-to-undeclared-variable',
    ]);
    expect(value.json).toBe('ys');
  });

  test('in a loop, the write that fails stops the loop', () => {
    const { value, diagnostics } = run(
      'let xs = [1, 2]\nfor i in 1..3 { xs[i] = 10 * i }\nxs'
    );
    expect(diagnostics.map((d) => d.message[3])).toEqual(['out-of-range']);
    expect(value.json).toEqual(['List', 10, 20]);
  });

  test('in a function, the error is the value of the call', () => {
    const { value } = run('function g() { let ys = [1, 2]; ys[5] = 1; ys }\ng()');
    expect(JSON.stringify(value.json)).toContain("'out-of-range'");
  });
});

describe('an assignment to a list element that is refused', () => {
  test('a `const` list gives the error of an assignment to the constant', () => {
    const source = 'const c = [1, 2]\nc[1] = 5\nc';
    expect(codes(source)).toEqual(['constant-assignment']);
    // The message quotes the assignment as it is written.
    expect(checkSource(source).diagnostics[0].message[2]).toBe('c[1] := 5');
    const { value } = run(source);
    expect(value.json).toEqual(['List', 1, 2]);
  });

  test('a string position is the parse error `assignment-to-list-element`', () => {
    // `ReplaceAt` refuses a string position. The parse reports it, over the
    // statement, and the statement changes nothing.
    const source = 'let xs = [1, 2]\nxs["a"] = 1\nxs';
    const { value, diagnostics } = run(source);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'assignment-to-list-element',
    ]);
    expect(source.slice(diagnostics[0].range[0], diagnostics[0].range[1])).toBe(
      'xs["a"] = 1'
    );
    expect(value.json).toEqual(['List', 1, 2]);
    expect(codes(source)).toEqual(['assignment-to-list-element']);
  });

  test('a string position in a function that is not called', () => {
    expect(codes('function f(xs) { xs["a"] = 1; xs }\n0')).toEqual([
      'assignment-to-list-element',
    ]);
  });

  test('a chained assignment', () => {
    expect(codes('let xs = [1, 2]\nxs[1] := xs[2] := 5')).toContain(
      'chained-assignment'
    );
  });

  test('the function `At` keeps its library meaning', () => {
    const { value } = run('let xs = [7, 8, 9]\nxs[1] = 5\n[xs[2], [1, 2][2]]');
    expect(value.json).toEqual(['List', 8, 2]);
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let xs = [7, 8, 9]\nxs[1] = 5');
    expect(ce.box(['At', ['List', 1, 2], 2]).evaluate().json).toBe(2);
  });

  test('a field path is still a property store', () => {
    const { value } = run('let xs = [1, 2, 3]\nxs[1].name = 5');
    expect(JSON.stringify(value.json)).toContain('immutable-value-assignment');
  });
});
