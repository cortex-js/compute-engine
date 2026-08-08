// Source-offset propagation through canonicalization.
//
// The Epsil parser stamps `sourceOffsets` on every MathJSON node. For a
// debugger to map canonical statements back to source
// (`vscode-epsil/VSCODE_EPSIL_ROADMAP.md`, Tier 2), statement-level positions
// must survive canonical boxing. Historically they were lost at two sites:
// custom `canonical` handler returns (and the numeric fast-path constructors)
// in `box.ts`, and the `.canonical` getter of an already-boxed expression.
//
// Contract pinned here:
//  - a canonically boxed FUNCTION expression keeps the offsets its MathJSON
//    carried, including through custom canonical handlers and rewrites;
//  - interned singletons (`ce.One`, …) are never stamped (a `x/x → 1` fold
//    must not smear a statement's position onto an engine-wide object);
//  - inputs without offsets (LaTeX, programmatic) are untouched;
//  - default JSON serialization does not emit offsets (opt-in metadata).

import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';

let ce: ComputeEngine;

beforeAll(() => {
  ce = new ComputeEngine();
});

describe('canonical boxing preserves sourceOffsets', () => {
  test('operator with a numeric fast path (Add, folded)', () => {
    const expr = ce.box({
      fn: ['Add', 'x', { num: '2' }, { num: '5' }],
      sourceOffsets: [10, 19],
    } as any);
    // The fold rewrote the operands (2 + 5 → 7); the position survives.
    expect(expr.sourceOffsets).toEqual([10, 19]);
  });

  test('operator with a custom canonical handler (Declare)', () => {
    const expr = ce.box({
      fn: ['Declare', 'declTest', { dict: { value: 3 } }],
      sourceOffsets: [0, 9],
    } as any);
    expect(expr.sourceOffsets).toEqual([0, 9]);
  });

  test('head rewrite keeps the source position (Sqrt → Power/Root)', () => {
    const expr = ce.box({
      fn: ['Sqrt', 'x'],
      sourceOffsets: [4, 11],
    } as any);
    expect(expr.sourceOffsets).toEqual([4, 11]);
  });

  test('statements inside a Block keep their own spans', () => {
    const block = ce.box({
      fn: [
        'Block',
        { fn: ['Add', 'x', { num: '1' }], sourceOffsets: [2, 7] },
        { fn: ['Add', 'y', { num: '2' }], sourceOffsets: [9, 14] },
      ],
      sourceOffsets: [0, 16],
    } as any);
    expect(block.sourceOffsets).toEqual([0, 16]);
    if (!isFunction(block)) throw new Error('expected function expression');
    expect(block.op1.sourceOffsets).toEqual([2, 7]);
    expect(block.op2.sourceOffsets).toEqual([9, 14]);
  });

  test('already-boxed structural expression: .canonical inherits offsets', () => {
    const structural = ce.box(
      { fn: ['Add', 'a', { num: '2' }], sourceOffsets: [3, 8] } as any,
      { form: 'structural' }
    );
    expect(structural.sourceOffsets).toEqual([3, 8]);
    expect(structural.canonical.sourceOffsets).toEqual([3, 8]);
  });
});

describe('sourceOffsets never smear', () => {
  test('a fold to an interned singleton does not stamp it', () => {
    const one = ce.box({
      fn: ['Divide', 'q', 'q'],
      sourceOffsets: [5, 10],
    } as any);
    expect(one.toString()).toEqual('1');
    expect(one.sourceOffsets).toBeUndefined();
    expect(ce.One.sourceOffsets).toBeUndefined();
  });

  test('inputs without offsets stay without offsets', () => {
    expect(ce.box(['Add', 'q', 1]).sourceOffsets).toBeUndefined();
    expect(ce.parse('x + 1').sourceOffsets).toBeUndefined();
  });

  test('repeated identical statements carry distinct spans', () => {
    const first = ce.box({
      fn: ['Add', 'b', { num: '1' }],
      sourceOffsets: [0, 5],
    } as any);
    const second = ce.box({
      fn: ['Add', 'b', { num: '1' }],
      sourceOffsets: [6, 11],
    } as any);
    expect(first.sourceOffsets).toEqual([0, 5]);
    expect(second.sourceOffsets).toEqual([6, 11]);
  });
});

describe('serialization', () => {
  test('default JSON output does not emit sourceOffsets', () => {
    const expr = ce.box({
      fn: ['Add', 'x', { num: '2' }],
      sourceOffsets: [0, 5],
    } as any);
    expect(JSON.stringify(expr.json)).not.toContain('sourceOffsets');
  });

  test('explicitly requested metadata does emit them', () => {
    const expr = ce.box({
      fn: ['Add', 'x', { num: '2' }],
      sourceOffsets: [0, 5],
    } as any);
    expect(
      JSON.stringify(expr.toMathJson({ metadata: ['sourceOffsets'] }))
    ).toContain('"sourceOffsets":[0,5]');
  });
});

describe('Epsil route (parse → canonical box)', () => {
  test('while-loop body statements keep their spans', () => {
    const source = 'let x = 0\nwhile x < 3 { x := x + 1 }';
    const [ast] = parseEpsil(source);
    const program = ce.box(ast as any);
    if (!isFunction(program)) throw new Error('expected Block');
    const loop = program.ops.find((op) => op.operator === 'Loop');
    expect(loop).toBeDefined();
    expect(loop!.sourceOffsets).toEqual([
      source.indexOf('while'),
      source.length,
    ]);
    // The loop body is a synthesized wrapper (condition test + user block);
    // the user's `{ … }` block and the statement inside it keep their spans.
    const assignSpan: [number, number] = [
      source.indexOf('x := x + 1'),
      source.indexOf('x := x + 1') + 'x := x + 1'.length,
    ];
    const spans: ([number, number] | undefined)[] = [];
    const walk = (e: any) => {
      spans.push(e.sourceOffsets);
      if (isFunction(e)) e.ops.forEach(walk);
    };
    walk(loop);
    expect(spans).toContainEqual(assignSpan);
  });
});
