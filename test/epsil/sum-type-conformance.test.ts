import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

import type { MathJsonExpression } from '../../src/math-json/types';

//
// CONFORMANCE OF A SUM TYPE — `type shape is Area { … }` where `shape` is a
// sum (user ruling of 2026-09-22).
//
// The sum sugar registers the sum's own name as a transparent ALIAS of its
// variants, and an alias cannot conform to a protocol. The whole-sum spelling
// therefore DESUGARS: it registers one conformance edge per variant, with
// `Self` bound to that variant in each edge, which is exactly what writing the
// block once per variant does. Dispatch, the registry and the compile tier all
// keep seeing only variant edges, so nothing downstream changes.
//
// A sum can GROW: a second `type shape = … | triangle` in a LATER program
// (within one program that is `type-redefinition`) adds a variant, and the
// whole-sum conformance is re-run for the variants the sum gained.
//

/** Run one Epsil program (one batch). */
function run(ce: ComputeEngine, source: string) {
  return executeEpsil(ce, source);
}

/** The diagnostic codes of a batch, in order. */
function codes(ce: ComputeEngine, source: string): string[] {
  return run(ce, source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

const AREA = `protocol Area {
  function area(self: Self) -> number
}`;

const SHAPE = 'type shape = circle(r: number) | square(s: number)';

/** The whole-sum implementation block: one body, dispatching on the variant
 * it is handed. */
const SHAPE_IS_AREA = `type shape is Area {
  function area(self: Self) -> number {
    match self {
      circle(r) => 3 * r * r
      square(s) => s * s
    }
  }
}`;

/** The target keys of every conformance edge of `protocol`, in order. */
function edgeKeys(ce: ComputeEngine, protocol: string): string[] {
  return ce._protocolRegistry[protocol].conformances.map((c) => c.targetKey);
}

describe('the whole-sum spelling', () => {
  test('registers one edge per variant and dispatches for each', () => {
    const ce = new ComputeEngine();
    expect(codes(ce, `${AREA}\n${SHAPE}\n${SHAPE_IS_AREA}`)).toEqual([]);

    // One edge per VARIANT: the sum's own name never becomes a target.
    expect(edgeKeys(ce, 'Area')).toEqual(['circle', 'square']);
    expect(
      ce._protocolRegistry.Area.conformances.every((c) => !c.pending)
    ).toBe(true);

    // The qualified spelling.
    expect(run(ce, 'Area.area(circle(2))').value.toString()).toBe('12');
    expect(run(ce, 'Area.area(square(3))').value.toString()).toBe('9');
    // The protocol-member call spelling.
    expect(run(ce, 'let c = circle(2)\nc.area()').value.toString()).toBe('12');
    expect(run(ce, 'let s = square(3)\ns.area()').value.toString()).toBe('9');
  });

  test('a block-less whole-sum conformance declares one pending edge per variant', () => {
    const ce = new ComputeEngine();
    const result = run(ce, `${AREA}\n${SHAPE}\ntype shape is Area`);
    expect(result.diagnostics.map((d) => String(d.message[0]))).toEqual([
      'protocol-implementation-pending',
      'protocol-implementation-pending',
    ]);
    expect(edgeKeys(ce, 'Area')).toEqual(['circle', 'square']);
  });

  test('re-running the statement in a LATER batch replaces, and does not report a duplicate', () => {
    const ce = new ComputeEngine();
    expect(codes(ce, `${AREA}\n${SHAPE}\n${SHAPE_IS_AREA}`)).toEqual([]);
    expect(
      codes(
        ce,
        `type shape is Area {
  function area(self: Self) -> number { 1 }
}`
      )
    ).toEqual([]);
    expect(edgeKeys(ce, 'Area')).toEqual(['circle', 'square']);
    expect(run(ce, 'Area.area(circle(2))').value.toString()).toBe('1');
  });
});

describe('a variant that already conforms individually', () => {
  test('is reported as a duplicate implementation, naming the variant', () => {
    const ce = new ComputeEngine();
    const result = run(
      ce,
      `${AREA}
${SHAPE}
type circle is Area {
  function area(self: Self) -> number { 1 }
}
${SHAPE_IS_AREA}`
    );
    // The existing duplicate-implementation diagnostic, reported against the
    // VARIANT the sum block would have implemented a second time.
    const message = result.diagnostics
      .map((d) => JSON.stringify(d.message))
      .join('\n');
    expect(message).toContain('protocol-implementation-duplicate');
    expect(message).toContain('circle');
    expect(message).toContain('Area');
    expect(result.value.toString()).toBe(
      'Error(ErrorCode("protocol-implementation-duplicate", "the type `circle` already has an implementation of the `Area` protocol in this batch"))'
    );
  });

  test('the duplicate registers nothing at all: `square` keeps no edge from the rejected block', () => {
    const ce = new ComputeEngine();
    run(
      ce,
      `${AREA}
${SHAPE}
type circle is Area {
  function area(self: Self) -> number { 1 }
}
${SHAPE_IS_AREA}`
    );
    expect(edgeKeys(ce, 'Area')).toEqual(['circle']);
  });
});

describe('a variant added to the sum LATER', () => {
  const GROWN =
    'type shape = circle(r: number) | square(s: number) | triangle(b: number)';

  test('re-runs the whole-sum conformance for the new variant', () => {
    const ce = new ComputeEngine();
    expect(codes(ce, `${AREA}\n${SHAPE}\n${SHAPE_IS_AREA}`)).toEqual([]);
    // A later PROGRAM may grow the sum; a second declaration within one
    // program is `type-redefinition`.
    expect(codes(ce, GROWN)).toEqual([]);
    expect(edgeKeys(ce, 'Area')).toEqual(['circle', 'square', 'triangle']);
    const edge = ce._protocolRegistry.Area.conformances.find(
      (c) => c.targetKey === 'triangle'
    );
    expect(edge?.pending).toBe(false);
  });

  test('the re-run edge takes the sum block, with `Self` bound to the new variant', () => {
    const ce = new ComputeEngine();
    run(
      ce,
      `${AREA}
${SHAPE}
type shape is Area {
  function area(self: Self) -> number {
    match self {
      circle(r) => 3 * r * r
      square(s) => s * s
      _ => 0
    }
  }
}`
    );
    run(ce, GROWN);
    expect(run(ce, 'Area.area(triangle(4))').value.toString()).toBe('0');
    expect(run(ce, 'Area.area(circle(2))').value.toString()).toBe('12');
  });

  test('growing the sum and re-declaring the conformance in ONE later batch is not a duplicate', () => {
    const ce = new ComputeEngine();
    expect(codes(ce, `${AREA}\n${SHAPE}\n${SHAPE_IS_AREA}`)).toEqual([]);
    expect(
      codes(
        ce,
        `${GROWN}
type shape is Area {
  function area(self: Self) -> number { 5 }
}`
      )
    ).toEqual([]);
    expect(run(ce, 'Area.area(triangle(4))').value.toString()).toBe('5');
  });

  test('a bare re-assertion of the conformance keeps the remembered block', () => {
    const ce = new ComputeEngine();
    expect(
      codes(
        ce,
        `${AREA}
${SHAPE}
type shape is Area {
  function area(self: Self) -> number {
    match self {
      circle(r) => 3 * r * r
      square(s) => s * s
      _ => 0
    }
  }
}`
      )
    ).toEqual([]);
    // Restating the conformance without a block asserts it again; it does not
    // withdraw the implementation.
    expect(codes(ce, 'type shape is Area')).toEqual([]);
    expect(run(ce, 'Area.area(circle(2))').value.toString()).toBe('12');

    // The variant the sum gains afterwards still gets the original block.
    expect(codes(ce, GROWN)).toEqual([]);
    const edge = ce._protocolRegistry.Area.conformances.find(
      (c) => c.targetKey === 'triangle'
    );
    expect(edge?.pending).toBe(false);
    expect(run(ce, 'Area.area(triangle(4))').value.toString()).toBe('0');
  });

  test('a variant the author implemented individually keeps its own block', () => {
    const ce = new ComputeEngine();
    run(ce, `${AREA}\n${SHAPE}\n${SHAPE_IS_AREA}`);
    run(ce, GROWN);
    expect(
      codes(
        ce,
        `type triangle is Area {
  function area(self: Self) -> number { 99 }
}`
      )
    ).toEqual([]);
    expect(run(ce, 'Area.area(triangle(4))').value.toString()).toBe('99');
    // A later re-declaration of the sum leaves that block alone: the re-run
    // only gives an edge to a variant that has none.
    expect(codes(ce, GROWN)).toEqual([]);
    expect(run(ce, 'Area.area(triangle(4))').value.toString()).toBe('99');
  });
});

describe('a variant that is not a legal conformance target', () => {
  test('rejects the whole spelling, naming the offending variant', () => {
    const ce = new ComputeEngine();
    run(ce, `${AREA}\n${SHAPE}`);
    // A later program may re-declare a variant as a transparent alias; the
    // sum's variant list still names it, and an alias cannot conform.
    expect(codes(ce, 'type alias circle = integer')).toEqual([]);
    const result = run(ce, SHAPE_IS_AREA);
    expect(result.value.toString()).toContain(
      'protocol-conformance-target-invalid'
    );
    expect(result.value.toString()).toContain('circle');
    expect(result.value.toString()).toContain('shape');
    // Nothing registered: the rejection is atomic over the variant list.
    expect(edgeKeys(ce, 'Area')).toEqual([]);
  });
});

describe('the compile tier', () => {
  test('a member call over a variant value compiles and agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    expect(codes(ce, `${AREA}\n${SHAPE}\n${SHAPE_IS_AREA}`)).toEqual([]);
    const expr = ce.box(['area', ['circle', 2]] as MathJsonExpression);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run?.()).toBe(12);
    expect(expr.evaluate().toString()).toBe('12');
  });

  test('a receiver decided only at run time dispatches on the variant', () => {
    const ce = new ComputeEngine();
    expect(
      codes(
        ce,
        `${AREA}
${SHAPE}
${SHAPE_IS_AREA}
function total(s: shape) -> number { area(s) }`
      )
    ).toEqual([]);
    const result = compile(ce.box(['total', 'x'] as MathJsonExpression));
    expect(result.success).toBe(true);
    // Both variants of this sum carry one number, so they share an erased
    // representation and the sum compiles TAGGED: a value is `{_tag, _ops}`.
    expect(result.run?.({ x: { _tag: 'circle', _ops: [2] } })).toBe(12);
    expect(result.run?.({ x: { _tag: 'square', _ops: [3] } })).toBe(9);
    expect(run(ce, 'total(square(3))').value.toString()).toBe('9');
  });
});
