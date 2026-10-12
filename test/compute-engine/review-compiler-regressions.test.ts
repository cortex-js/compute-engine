import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { indexingSetSites } from '../../src/compute-engine/boxed-expression/binding-sites';
import { TEST_PYTHON } from './test-python';

const compiler = BaseCompiler as any;

describe('compiler review regressions', () => {
  test.each([
    [['Element', 'k', ['Range', 5, 7]], ['Limits', 'k', 1, 3]],
    [['Limits', 'k', 1, 3], ['Element', 'k', ['Range', 5, 7]]],
    [['Element', 'k', ['Range', 5, 7]], 'k', 1, 3],
    [['Element', 'k', ['Range', 5, 7]], ['Element', 'k', ['Range', 1, 3]]],
  ])('a shared index accepts every clause range: %j', (...clauses) => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Sum', 'k', ...clauses] as never);
    expect(expr.op1.type.toString()).toBe('integer');
    expect(expr.evaluate().re).toBe(18);
    const single = ce.box(['Sum', 'k', ['Element', 'k', ['Range', 5, 7]]]);
    expect(single.op1.type.toString()).toBe('integer<5..7>');
    expect(single.evaluate().re).toBe(18);
  });

  test('held clauses count as duplicate binding sites too', () => {
    const ce = new ComputeEngine();
    const operands = [
      ce.symbol('k'),
      ce.box(['Element', 'k', ['Range', 5, 7]]),
      ce.box(['Hold', ['Limits', 'k', 1, 3]]),
    ];
    const sites = indexingSetSites(1, 'integer')(operands, 'pre');
    expect(sites[0].type).toBeUndefined();
  });

  test('parameter writes and radical counts visit shared nodes once', () => {
    const ce = new ComputeEngine();
    let tower = ce.box(['Sqrt', 'x']);
    const depth = 16;
    for (let i = 0; i < depth; i++) tower = ce.function('Max', [tower, tower]);
    const literal = ce.box(['Function', ['Hold', tower], 't']);
    let reads = 0;
    const nodes = new Set<any>();
    const watch = (node: any): void => {
      if (nodes.has(node) || node.ops === undefined) return;
      nodes.add(node);
      const children = node.ops;
      for (const child of children) watch(child);
      Object.defineProperty(node, 'ops', {
        configurable: true,
        get: () => {
          reads++;
          return children;
        },
      });
    };
    watch(literal.op1);
    try {
      expect(compiler.parametersCanBeTyped(literal)).toBe(true);
      expect(reads).toBeLessThanOrEqual(nodes.size * 2);
      reads = 0;
      expect(compiler.unprovenRadicalCount(ce, tower, {}, new Set())).toBe(
        2 ** depth
      );
      expect(reads).toBeLessThanOrEqual(nodes.size * 4);
    } finally {
      for (const node of nodes) delete node.ops;
    }
    const writesParameter = ce.box([
      'Function',
      ['Block', ['Assign', 't', 1], 't'],
      't',
    ]);
    expect(compiler.parametersCanBeTyped(writesParameter)).toBe(false);
  });

  test('numeric stores contain neither writes nor radicals', () => {
    const ce = new ComputeEngine();
    const numbers = ce.list([1, 2, 3]);
    const literal = ce._fn('Function', [numbers, ce.symbol('t')]);
    Object.defineProperty(numbers, 'ops', {
      configurable: true,
      get: () => {
        throw new Error('numeric store was materialized');
      },
    });
    try {
      expect(compiler.parametersCanBeTyped(literal)).toBe(true);
      expect(compiler.unprovenRadicalCount(ce, numbers, {}, new Set())).toBe(
        0
      );
    } finally {
      delete (numbers as any).ops;
    }
  });

  test('unchecked exact-fold operands must fit the digit cap before evaluation', () => {
    const ce = new ComputeEngine();
    const makeSum = (lo: number, hi: number) =>
      ce.box([
        'Sum',
        ['DigitSum', ['Power', 'n', 'n']],
        ['Limits', 'n', lo, hi],
      ]);
    const large = makeSum(100000, 100700);
    const largeEvaluation = jest
      .spyOn(large, 'evaluate')
      .mockReturnValue(ce.number(0));
    try {
      expect(compiler.foldCostEstimate(large)).toBeLessThan(200000);
      expect(
        compiler.exactFoldValue(large, [
          { operand: large.op1.op1, digits: undefined },
        ])
      ).toBeUndefined();
      expect(largeEvaluation).not.toHaveBeenCalled();
    } finally {
      largeEvaluation.mockRestore();
    }
    const small = makeSum(1, 10);
    const smallEvaluation = jest
      .spyOn(small, 'evaluate')
      .mockReturnValue(ce.number(42));
    try {
      expect(
        compiler.exactFoldValue(small, [
          { operand: small.op1.op1, digits: undefined },
        ]).re
      ).toBe(42);
      expect(smallEvaluation).toHaveBeenCalledTimes(1);
    } finally {
      smallEvaluation.mockRestore();
    }
    const result = compile(
      ce.box([
        'Sum',
        ['Mod', ['Power', 'n', 'n'], 7],
        ['Limits', 'n', 1, 10],
      ]),
      { to: 'javascript', fallback: false }
    );
    expect(result.code).toBe('25');
    expect(result.run!({} as never)).toBe(25);
  });

  test('constant CSE source is cached separately for each unrolled iteration', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('n', 'integer');
    let tower = ce.box(['Sin', 'n']);
    for (let i = 0; i < 10; i++) tower = ce.function('Max', [tower, tower]);
    const expr = ce.function('Sum', [
      ce.function('Multiply', [ce.symbol('x'), tower]),
      ce.function('Limits', [ce.symbol('n'), ce.number(1), ce.number(2)]),
    ]);
    const inner = jest.spyOn(compiler, '_compileInner');
    let result: ReturnType<typeof compile>;
    try {
      result = compile(expr, { to: 'interval-js', fallback: false });
      expect(inner.mock.calls.length).toBeLessThan(100);
    } finally {
      inner.mockRestore();
    }
    expect(result!.code).not.toContain('_cse');
    const output = result!.run!({ x: 2 } as never) as any;
    const expected = 2 * (Math.sin(1) + Math.sin(2));
    expect(output.kind).toBe('interval');
    expect(output.value.lo).toBeLessThanOrEqual(expected);
    expect(output.value.hi).toBeGreaterThanOrEqual(expected);
  });

  test('finite pipeline sources bound their callback parameters for folding', () => {
    const ce = new ComputeEngine();
    for (const source of [
      ce.box(['Range', 1, 10]),
      ce.box(['List', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      ce.list([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    ]) {
      const filtered = ce.box([
        'Filter',
        source,
        ['Function', ['Equal', ['Mod', 'y', 2], 0], 'y'],
      ]);
      const folded = compile(filtered, { to: 'javascript', fallback: false });
      expect(folded.code).not.toContain('_SYS.floorMod');
      expect(folded.run!({} as never)).toEqual([2, 4, 6, 8, 10]);
    }

    const findPower = (node: any): any =>
      node.operator === 'Power'
        ? node
        : node.ops?.map(findPower).find((power: any) => power !== undefined);
    const makeFilter = (lo: number, hi: number, exponent = 3) => ce.box([
      'Filter',
      ['Range', lo, hi],
      [
        'Function',
        ['Equal', ['Mod', ['Power', 'y', exponent], 7], 0],
        ['Typed', 'y', "'integer'"],
      ],
    ]);
    const small = makeFilter(1, 10);
    const power = findPower(small);
    const ranges = compiler.exactFoldCallbackRanges(small);
    expect(compiler.exactFoldOperandFits(power)).toBe(false);
    expect(compiler.exactFoldOperandFits(power, ranges)).toBe(true);
    const callback = small.op2;
    const reused = ce._fn('List', [
      small,
      ce._fn('Apply', [callback, ce.number(100000)]),
    ]);
    expect(
      compiler.exactFoldOperandFits(
        power,
        compiler.exactFoldCallbackRanges(reused)
      )
    ).toBe(false);

    const large = makeFilter(100000, 100001, 100000);
    const evaluation = jest
      .spyOn(large, 'evaluate')
      .mockReturnValue(ce.box(['List', 1]));
    try {
      expect(
        compiler.exactFoldValue(large, [
          { operand: findPower(large), digits: undefined },
        ])
      ).toBeUndefined();
      expect(evaluation).not.toHaveBeenCalled();
    } finally {
      evaluation.mockRestore();
    }
  });

  test('exact folding charges pipeline callbacks before evaluation or counting', () => {
    const ce = new ComputeEngine();
    const large = ce.box([
      'Filter',
      ['Range', 1, 10000],
      [
        'Function',
        ['Equal', ['Mod', ['Power', 'y', 800], 99991], 0],
        ['Typed', 'y', "'integer'"],
      ],
    ]);
    const findPower = (node: any): any =>
      node.operator === 'Power'
        ? node
        : node.ops?.map(findPower).find((power: any) => power !== undefined);
    const power = findPower(large);
    expect(
      compiler.exactFoldOperandFits(
        power,
        compiler.exactFoldCallbackRanges(large)
      )
    ).toBe(true);
    const nested = ce.box([
      'Map',
      ['Function', 'z', ['Typed', 'z', "'integer'"]],
      large,
    ]);
    const nestedFilter = ce.box([
      'Filter',
      large,
      ['Function', 'True', ['Typed', 'z', "'integer'"]],
    ]);
    const innerCount = jest.spyOn(large, 'count', 'get').mockReturnValue(0);
    try {
      for (const [expr, trips] of [
        [large, 10000],
        [nested, 20000],
        [nestedFilter, 20000],
      ] as const) {
        const operand = findPower(expr);
        expect(
          compiler.exactFoldOperandFits(
            operand,
            compiler.exactFoldCallbackRanges(expr)
          )
        ).toBe(true);
        const evaluation = jest
          .spyOn(expr, 'evaluate')
          .mockReturnValue(ce.box(['List', 1]));
        try {
          expect(compiler.foldCostEstimate(expr)).toBeLessThan(200000);
          expect(compiler.bigOpIterations(expr)).toBe(trips);
          expect(
            compiler.exactFoldValue(expr, [
              { operand, digits: undefined },
            ])
          ).toBeUndefined();
          expect(evaluation).not.toHaveBeenCalled();
          expect(innerCount).not.toHaveBeenCalled();
        } finally {
          evaluation.mockRestore();
        }
      }
    } finally {
      innerCount.mockRestore();
    }
    const small = ce.box([
      'Filter',
      ['Range', 1, 10],
      ['Function', ['Equal', ['Mod', 'y', 2], 0], 'y'],
    ]);
    const folded = compile(small, { to: 'javascript', fallback: false });
    expect(folded.code).not.toContain('_SYS.floorMod');
    expect(folded.run!({} as never)).toEqual([2, 4, 6, 8, 10]);
    const reducedMap = ce.box([
      'Sum',
      ['Map', ['Function', 'x', ['Typed', 'x', "'integer'"]], ['Range', 1, 10]],
    ]);
    expect(compiler.bigOpIterations(reducedMap)).toBe(20);
    expect(compile(reducedMap, { fallback: false }).run!({} as never)).toBe(55);
  });
});

const hasNumpy = (() => {
  if (TEST_PYTHON === undefined) return false;
  try {
    execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

(hasNumpy ? test : test.skip)('Python Mod guards integer inputs promoted to float', () => {
  const ce = new ComputeEngine();
  const python = new PythonTarget();
  const expr = ce.box(['Mod', 'x', 'm']);
  const source = python.compile(expr).code.split('\n');
  const expression = source.pop()!;
  const lambda = python.compileLambda(expr, ['x', 'm']);
  const program = [
    'import numpy as np',
    ...source,
    `def f(x, m):\n    return ${expression}`,
    `g = ${lambda}`,
    'for fn in (f, g):',
    '    for x, m in ((np.uint64(2**63 + 1), np.int64(10)), (np.uint64(2**63 + 1), np.uint64(10)), (np.uint64(2**63 + 1), 10), (17.0, 10), (2**100, 10.0)):',
    '        try:',
    '            print(int(fn(x, m)))',
    '        except ValueError:',
    "            print('ValueError')",
  ].join('\n');
  expect(execFileSync(TEST_PYTHON!, ['-c', program]).toString().trim().split('\n')).toEqual([
    'ValueError', '9', '9', '7', 'ValueError',
    'ValueError', '9', '9', '7', 'ValueError',
  ]);
});
