import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// The source range of a node that contains a parenthesized operand covers the
// parentheses of that operand. Before, `(a) + (b)` had the range `a) + (b`:
// the range of a binary operator ran from the start of the content of its left
// operand to the end of the content of its right operand, and the parentheses
// were left out. A statement that ends with such an operand
// (`let v = (1) + (2)`) also ended before its last `)`.
//
// A single parenthesized expression `(a)` keeps the range of its content `a`.
// Some checks read the authored text of a node and depend on that: `(x) = 5`
// assigns, and `(x) -> x^2` is diagnosed as a lambda with the wrong arrow.
//

/** The source text covered by a node's `sourceOffsets`. */
function text(src: string, node: MathJsonExpression): string | undefined {
  if (typeof node !== 'object' || node === null || Array.isArray(node))
    return undefined;
  const o = (node as { sourceOffsets?: [number, number] }).sourceOffsets;
  return o ? src.slice(o[0], o[1]) : undefined;
}

/** The operands of a function node. */
function ops(node: MathJsonExpression): MathJsonExpression[] {
  const fn = (node as { fn?: MathJsonExpression[] }).fn;
  return fn ? fn.slice(1) : [];
}

/** The head of a function node. */
function head(node: MathJsonExpression): unknown {
  const fn = (node as { fn?: MathJsonExpression[] }).fn;
  return fn?.[0];
}

/** Parse `src` and return the root node; fail on any diagnostic. */
function parse(src: string): MathJsonExpression {
  const [expr, diagnostics] = parseEpsil(src);
  expect(diagnostics).toEqual([]);
  return expr;
}

/** The first node, depth first, whose head is `name`. */
function find(
  node: MathJsonExpression,
  name: string
): MathJsonExpression | undefined {
  if (head(node) === name) return node;
  for (const op of ops(node)) {
    const found = find(op, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('a binary operator covers the parentheses of its operands', () => {
  test.each([
    '(1) + (2)',
    '(a) * (b)',
    '((a)) - (b)',
    '(a) + b',
    'a + (b)',
    '(a + (b)) + (c)',
    '(a) < (b)',
    '(a) == (b)',
    '(1)..(3)',
    '(a)^(b)',
    '(a) ?? (b)',
    '(a) |> (f)',
  ])('%s', (src) => {
    expect(text(src, parse(src))).toBe(src);
  });

  test('a nested sum covers the parentheses of its own operands only', () => {
    const src = '(a + (b)) + (c)';
    const outer = parse(src);
    expect(text(src, ops(outer)[0])).toBe('a + (b)');
  });

  test('an implicit product covers the parentheses of its factors', () => {
    const src = '(2)√(3)';
    expect(text(src, parse(src))).toBe(src);
  });
});

describe('a statement covers its last parenthesis', () => {
  test('a declaration', () => {
    const src = 'let v = (1) + (2)';
    const stmt = parse(src);
    expect(head(stmt)).toBe('Declare');
    expect(text(src, stmt)).toBe(src);
  });

  test('a declaration whose value is one parenthesized expression', () => {
    const src = 'let v = (1)';
    expect(text(src, parse(src))).toBe(src);
  });

  test('an assignment', () => {
    const src = 'x := (a) + (b)';
    expect(text(src, parse(src))).toBe(src);
  });

  test('a function definition in math form', () => {
    const src = 'f(x) = (x) + (1)';
    expect(text(src, parse(src))).toBe(src);
  });

  test('a statement in a program of several statements', () => {
    const src = 'let a = 1\nlet b = (a) + (2)';
    const program = parse(src);
    expect(text(src, ops(program)[1])).toBe('let b = (a) + (2)');
  });
});

describe('other operators cover the parentheses of their operands', () => {
  test.each([
    '-(a)',
    '√(2)',
    '(a)!',
    '(a)²',
    '(f)(x)',
    '(a).b',
    '(xs)[1]',
    '(a) is integer',
    'b if (a) else (c)',
  ])('%s', (src) => {
    expect(text(src, parse(src))).toBe(src);
  });

  test('a spread argument', () => {
    const src = 'f(...(xs))';
    expect(text(src, find(parse(src), 'Spread')!)).toBe('...(xs)');
  });

  test('a named argument', () => {
    const src = 'f(k: (1))';
    expect(text(src, find(parse(src), 'NamedArgument')!)).toBe('k: (1)');
  });

  test('the collection of a for loop', () => {
    const src = 'for x in (xs) { x }';
    expect(text(src, find(parse(src), 'Element')!)).toBe('x in (xs)');
  });

  test('a comprehension', () => {
    const src = '[(x) for x in (xs) if (x)]';
    const expr = parse(src);
    expect(text(src, expr)).toBe(src);
    expect(text(src, find(expr, 'Element')!)).toBe('x in (xs) if (x)');
  });

  test('a lambda whose parameter is a destructured pair', () => {
    const src = '((p, q)) => p';
    const expr = parse(src);
    expect(head(expr)).toBe('Function');
    expect(text(src, expr)).toBe(src);
  });
});

describe('patterns cover the parentheses of their operands', () => {
  test('an operator pattern', () => {
    const src = 'match x { (p) + (q) => (p) }';
    const expr = parse(src);
    expect(text(src, find(expr, 'MatchCase')!)).toBe('(p) + (q) => (p)');
    expect(text(src, find(expr, 'Add')!)).toBe('(p) + (q)');
  });

  test('alternatives', () => {
    const src = 'match x { (1) | (2) => 0 }';
    expect(text(src, find(parse(src), 'Alternatives')!)).toBe('(1) | (2)');
  });

  test('a pin', () => {
    const src = 'match x { == (a) => 1 }';
    expect(text(src, find(parse(src), 'Pin')!)).toBe('== (a)');
  });
});

describe('a single parenthesized expression keeps the range of its content', () => {
  test('(a)', () => {
    const src = '(a)';
    expect(text(src, parse(src))).toBe('a');
  });

  test('`(x) = 5` assigns', () => {
    const src = '(x) = 5';
    const expr = parse(src);
    expect(head(expr)).toBe('Assign');
    expect(text(src, ops(expr)[0])).toBe('x');
  });

  test('`(x) -> x^2` is a lambda written with the wrong arrow', () => {
    const [, diagnostics] = parseEpsil('(x) -> x^2');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
  });
});

describe('an error reported on a statement underlines all of it', () => {
  test('the underline ends at the last parenthesis', () => {
    const src = 'let w: any = "s"\nlet v = (w) * (2)\n0';
    const result = executeEpsil(new ComputeEngine(), src);
    expect(
      result.diagnostics.map((d) =>
        d.range ? src.slice(d.range[0], d.range[1]) : undefined
      )
    ).toEqual(['let v = (w) * (2)']);
  });
});

describe('parentheses around the receiver of a binding target', () => {
  // The range of a `Field` or `At` node covers the parentheses of its
  // receiver. A bare `=` must still assign when the receiver is a name in
  // redundant parentheses, as `(x) = 5` does.
  test.each([
    '(p).x = 1',
    '(xs)[1] = 1',
    '((p)).x = 1',
    '((xs))[1] = 1',
    '(p).x[1] = 1',
    '((p).x).y = 1',
    '(p)[1].x = 1',
    '(p.x) = 1',
  ])('%s assigns', (src) => {
    expect(head(parse(src))).toBe('Assign');
  });

  test.each(['(+p).x = 1', '+(p).x = 1', '+p.x = 1', '(true).x = 1'])(
    '%s compares',
    (src) => {
      expect(head(parse(src))).toBe('Equal');
    }
  );
});
