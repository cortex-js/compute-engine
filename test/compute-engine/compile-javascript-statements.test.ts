import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { javascriptStatements } from '../../src/compute-engine/compilation/javascript-statements';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

function fixture() {
  const ce = new ComputeEngine();
  const js = (json: any, options = {}) => {
    const r = compile(ce.box(json), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
      ...options,
    } as any);
    expect(r.success).toBe(true);
    return r;
  };
  return { ce, js };
}

const sum = ['Sum', ['Multiply', 'i', 'k'], ['Limits', 'i', 1, 'n']];
const comprehension = ['Comprehension', sum, ['Element', 'k', ['Range', 1, 3]]];

test('nested sums become statements inside comprehension iterations', () => {
  const { js } = fixture();
  const r = js(comprehension);
  // The public artifact is an expression, so only its outer wrapper remains.
  expect(r.code.match(/\(\(\) =>/g)).toHaveLength(1);
  expect(r.code).toMatch(/break _js\d+/);
  expect(r.run!({ n: 200 })).toEqual([20100, 40200, 60300]);
  expect(r.run!({ n: 0 })).toEqual([0, 0, 0]);
});

test.each([NaN, Infinity, -Infinity])(
  'an inner invalid bound %s exits locally',
  (n) => {
    const { js } = fixture();
    const r = js(comprehension);
    expect(r.run!({ n })).toEqual([NaN, NaN, NaN]);
  }
);

test('an inner NaN term does not return from the enclosing comprehension', () => {
  const { js } = fixture();
  const r = js([
    'Comprehension',
    ['Sum', ['Divide', 1, ['Subtract', 'i', 'i']], ['Limits', 'i', 1, 'n']],
    ['Element', 'k', ['Range', 1, 3]],
  ]);
  expect(r.run!({ n: 200 })).toEqual([Infinity, Infinity, Infinity]);
  const nan = js([
    'Comprehension',
    ['Sum', ['At', ['List', 1, 2], 'i'], ['Limits', 'i', 1, 'n']],
    ['Element', 'k', ['Range', 1, 3]],
  ]);
  expect(nan.run!({ n: 200 })).toEqual([NaN, NaN, NaN]);
});

test.each(['Sum', 'Product'])(
  '%s supports unrolled nested computations and empty ranges',
  (op) => {
    const { js } = fixture();
    const r = js([
      'Comprehension',
      [op, ['Add', 'i', 'k'], ['Limits', 'i', 1, 3]],
      ['Element', 'k', ['Range', 1, 2]],
    ]);
    expect(r.code.match(/\(\(\) =>/g)).toHaveLength(1);
    expect(r.run!({})).toEqual(op === 'Sum' ? [9, 12] : [24, 60]);
    const empty = js([
      'Comprehension',
      [op, 'i', ['Limits', 'i', 1, 'n']],
      ['Element', 'k', ['Range', 1, 2]],
    ]);
    expect(empty.run!({ n: 0 })).toEqual(op === 'Sum' ? [0, 0] : [1, 1]);
  }
);

test('a nested comprehension keeps its result array in its own scope', () => {
  const { js } = fixture();
  const r = js([
    'Comprehension',
    ['Comprehension', ['Add', 'i', 'k'], ['Element', 'i', ['Range', 1, 2]]],
    ['Element', 'k', ['Range', 1, 3]],
  ]);
  expect(r.code.match(/\(\(\) =>/g)).toHaveLength(1);
  expect(r.run!({})).toEqual([
    [2, 3],
    [3, 4],
    [4, 5],
  ]);
});

test('a loop counter may shadow the enclosing lambda parameter', () => {
  const { js } = fixture();
  const r = js(['Function', ['Sum', 'k', ['Limits', 'k', 1, 200]], 'k']);
  expect(r.code).not.toContain('(() =>');
  expect((r.run as any)(999)).toBe(20100);
});

test('a reused compilation target resets statement names and metadata', () => {
  const { ce } = fixture();
  const target = new JavaScriptTarget().createTarget({
    var: (id) => `_.${id}`,
    constantFold: false,
  });
  const expr = ce.box(comprehension as any);
  const first = BaseCompiler.compileRoot(expr, target);
  const second = BaseCompiler.compileRoot(expr, target);
  expect(first).toBe(second);
});

test('statement temporaries do not capture a lambda parameter named _js1', () => {
  const { js } = fixture();
  const r = js([
    'Function',
    [
      'Comprehension',
      ['Sum', ['Multiply', 'i', '_js1'], ['Limits', 'i', 1, 'n']],
      ['Element', 'k', ['Range', 1, 2]],
    ],
    '_js1',
    'n',
  ]);
  expect((r.run as any)(3, 200)).toEqual([60300, 60300]);
});

test.each(['Sum', 'Product'])('unrolled complex %s uses statements', (op) => {
  const { js } = fixture();
  const r = js([
    'Comprehension',
    [op, ['Complex', 0, 'k'], ['Limits', 'i', 1, 5]],
    ['Element', 'k', ['Range', 1, 2]],
  ]);
  expect(r.code.match(/\(\(\) =>/g)).toHaveLength(1);
  expect(r.run!({})).toEqual(
    op === 'Sum'
      ? [
          { re: 0, im: 5 },
          { re: 0, im: 10 },
        ]
      : [
          { re: 0, im: 1 },
          { re: 0, im: 32 },
        ]
  );
});

test.each(['Sum', 'Product'])(
  'nested complex %s preserves its local result',
  (op) => {
    const { js } = fixture();
    const r = js([
      'Comprehension',
      [op, ['Complex', 0, 1], ['Limits', 'i', 1, 'n']],
      ['Element', 'k', ['Range', 1, 2]],
    ]);
    expect(r.code.match(/\(\(\) =>/g)).toHaveLength(1);
    expect(r.run!({ n: 201 })).toEqual(
      op === 'Sum'
        ? [
            { re: 0, im: 201 },
            { re: 0, im: 201 },
          ]
        : [
            { re: 0, im: 1 },
            { re: 0, im: 1 },
          ]
    );
    expect(r.run!({ n: Infinity })).toEqual([
      { re: NaN, im: NaN },
      { re: NaN, im: NaN },
    ]);
  }
);

test('a nested list-valued sum keeps elementwise accumulation and empty-range identity', () => {
  const { js } = fixture();
  const r = js([
    'Comprehension',
    ['Sum', ['List', 'i', 'k'], ['Limits', 'i', 1, 'n']],
    ['Element', 'k', ['Range', 1, 2]],
  ]);
  expect(r.run!({ n: 200 })).toEqual([
    [20100, 200],
    [20100, 400],
  ]);
  expect(r.run!({ n: 0 })).toEqual([0, 0]);
});

test('an unselected conditional sum never calls its effectful body', () => {
  const { ce, js } = fixture();
  ce.declare('flag', 'boolean');
  ce.declare('draw', '() -> number');
  (globalThis as any).__ceStatementCalls = 0;
  const r = js(
    [
      'Comprehension',
      ['Which', 'flag', ['Sum', ['draw'], ['Limits', 'i', 1, 'n']], 'True', 42],
      ['Element', 'k', ['Range', 1, 3]],
    ],
    {
      functions: {
        draw: '(() => { globalThis.__ceStatementCalls++; return 1; })',
      },
    }
  );
  expect(r.run!({ flag: false, n: 200 })).toEqual([42, 42, 42]);
  expect((globalThis as any).__ceStatementCalls).toBe(0);
  expect(r.run!({ flag: true, n: 200 })).toEqual([200, 200, 200]);
  expect((globalThis as any).__ceStatementCalls).toBe(600);
  delete (globalThis as any).__ceStatementCalls;
});

test('assigned comprehension initializers contain no expression wrappers', () => {
  const { ce, js } = fixture();
  ce.assign('S', ce.box(comprehension as any));
  const r = js(['At', 'S', 'x']);
  expect(r.preamble).not.toContain('(() =>');
  expect(r.run!({ x: 2, n: 200 })).toBe(40200);
});

test('the runner body has no outer comprehension or sum IIFE', () => {
  const { ce } = fixture();
  const target = new JavaScriptTarget().createTarget({
    var: (id) => `_.${id}`,
    constantFold: false,
  });
  const code = BaseCompiler.compileRoot(ce.box(comprehension as any), target);
  const body = javascriptStatements(target)!.functionBody(code);
  expect(body).not.toContain('(() =>');
  expect(new Function('_', body)({ n: 200 })).toEqual([20100, 40200, 60300]);
});

describe('statement bindings preserve expression semantics', () => {
  const context = () =>
    javascriptStatements(new JavaScriptTarget().createTarget())!;

  test('parallel arguments are evaluated once, in order, before parameters exist', () => {
    const s = context();
    const code = s.parameters(
      [
        ['x', '(events.push("first"), 2)'],
        ['y', '(events.push("second"), x)'],
      ],
      '[x, y]'
    );
    const body = s.functionBody(code);
    expect(body).not.toContain('=>');
    const events: string[] = [];
    expect(new Function('x', 'events', body)(9, events)).toEqual([2, 9]);
    expect(events).toEqual(['first', 'second']);
  });

  test('sequential common-subexpression bindings see earlier values', () => {
    const s = context();
    const code = s.bindings(
      [
        ['a', '2'],
        ['b', 'a + 3'],
      ],
      'b * a'
    );
    expect(new Function(s.functionBody(code))()).toBe(10);
  });

  test('an operand embedded in an expression is not moved past its sibling', () => {
    const s = context();
    const inner = s.parameters([['x', '(events.push("second"), 2)']], 'x');
    const body = s.functionBody(`(events.push("first"), 1) + ${inner}`);
    const events: string[] = [];
    expect(new Function('events', body)(events)).toBe(3);
    expect(events).toEqual(['first', 'second']);
  });

  test('opaque source is not parsed or rewritten', () => {
    const s = context();
    const code = '(() => { return "return NaN;"; })()';
    expect(s.functionBody(code)).toBe(`return ${code};`);
  });
});
