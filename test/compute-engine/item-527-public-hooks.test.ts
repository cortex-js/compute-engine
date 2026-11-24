import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function declareFibonacci(ce: ComputeEngine, withHook: boolean): void {
  ce.declare('FibonacciModTest', {
    signature: '(integer) -> integer',
    evaluate: (ops: any[], { engine }: any) =>
      ops[0]?.isSame(10) ? engine.number(55) : undefined,
    ...(withHook
      ? {
          evaluateMod: (ops: any[]) => (ops[0]?.isSame(10) ? 55n : undefined),
        }
      : {}),
  });
}

describe('issue 527: evaluateMod', () => {
  test('a host hook answers Mod without evaluating the operand', () => {
    const ce = new ComputeEngine();
    ce.declare('HugeFib', {
      signature: '(integer) -> integer',
      evaluate: () => {
        return undefined;
      },
      evaluateMod: (ops: any[]) => (ops[0]?.isSame(10) ? 55n : undefined),
    });

    expect(ce.box(['Mod', ['HugeFib', 10], 7]).evaluate().json).toBe(6);
  });

  test('the hook value agrees with evaluation without the hook', () => {
    const withHook = new ComputeEngine();
    const withoutHook = new ComputeEngine();
    declareFibonacci(withHook, true);
    declareFibonacci(withoutHook, false);

    for (const json of [
      ['Mod', ['FibonacciModTest', 10], 7],
      ['Mod', ['FibonacciModTest', 10], 7, -1],
    ]) {
      expect(withHook.box(json as never).evaluate().json).toEqual(
        withoutHook.box(json as never).evaluate().json
      );
    }
    expect(withHook.box(['Mod', ['FibonacciModTest', 10], 7, -1] as never).evaluate().json).toBe(
      -1
    );
  });

  test('nested core hooks and PowerMod use the hook', () => {
    const ce = new ComputeEngine();
    declareFibonacci(ce, true);

    expect(
      ce.box(['Mod', ['Add', ['FibonacciModTest', 10], 1], 7]).evaluate().json
    ).toBe(0);
    expect(
      ce.box(['PowerMod', ['FibonacciModTest', 10], 2, 7]).evaluate().json
    ).toBe(1);
  });
});

describe('issue 527: inherited compile lowering', () => {
  test("compile: 'inherit' keeps the library lowering when evaluate is wrapped", () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare(
      'Sin',
      {
        evaluate: () => undefined,
        compile: 'inherit',
      } as never,
      { extend: true }
    );

    const f = compile(ce.box(['Sin', 'x']));
    expect(f.success).toBe(true);
    expect(f.hostCalls ?? []).not.toContain('Sin');
    expect(f.run!({ x: 1 })).toBeCloseTo(Math.sin(1), 12);
  });

  test('a compile handler can defer to the library lowering', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare(
      'Sin',
      {
        evaluate: () => undefined,
        compile: () => undefined,
      },
      { extend: true }
    );

    const f = compile(ce.box(['Sin', 'x']));
    expect(f.success).toBe(true);
    expect(f.hostCalls ?? []).not.toContain('Sin');
    expect(f.run!({ x: 1 })).toBeCloseTo(Math.sin(1), 12);
  });

  test('a compile handler receives the inherited handler', () => {
    const ce = new ComputeEngine();
    const first = jest.fn(() => undefined);
    let inherited: unknown;
    ce.declare('Sin', { compile: first }, { extend: true });
    ce.declare(
      'Sin',
      {
        compile: (_ops: never, _compile: never, context: any) => {
          inherited = context.inherited;
          return undefined;
        },
      },
      { extend: true }
    );
    ce.declare('x', 'real');
    compile(ce.box(['Sin', 'x']));
    expect(inherited).toBe(first);
  });
});
