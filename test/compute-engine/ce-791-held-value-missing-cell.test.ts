/**
 * ROADMAP CE-791: a symbol whose value holds a `Missing` cell compiles under
 * a declared type that does not name `missing`.
 *
 * A declared type cannot name `missing` (`Missing` is a result only, user
 * decision of 2026-11-02, `docs/ERROR-MODEL.md`), and a value can still hold
 * the marker: a selection with no match gives `Missing` in a cell of a
 * non-numeric list. The compile check of a held value
 * (`assertHeldValueType()`, `compile-inner.ts`) removes the `missing` arms of
 * the held type before it compares it with the type of the symbol, as the
 * store check `matchesOrAbsent()` does. A value that is wrong where it is
 * present still declines.
 *
 * Witness (corpus): Tycho document neyret/po7rdhtoth,
 * `c_d = hsv(C_ol[n+1], .1+D, 1)` with selections without an else branch in
 * `D`, declared `c_d: list<color>` and read by `AsOklab(c_d)`.
 *
 * The value of a `Missing` cell is unspecified in compiled code
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"). The JavaScript
 * target holds it as `undefined`; a color conversion gives the `NaN` color
 * for it, and `At` gives `undefined`. The tests pin those values so that a
 * change is seen, and check the present cells against the interpreter.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function run(ce: ComputeEngine, json: unknown): unknown {
  const c = compile(ce.box(json as any), { fallback: false }) as any;
  expect(c.success).toBe(true);
  return c.run ? c.run() : c();
}

// A list literal whose first cell is a selection with no match: its
// evaluated value is `[Missing, Rgb(0, 1, 0)]`, typed `list<color | missing>`.
function colorEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('cd', 'list<color>');
  ce.assign(
    'cd',
    ce
      .box([
        'List',
        ['If', ['Greater', 1, 2], ['Rgb', 1, 0, 0]],
        ['Rgb', 0, 1, 0],
      ])
      .evaluate()
  );
  return ce;
}

describe('CE-791: a held value with a Missing cell compiles', () => {
  test('the witness: a list<color> symbol read by AsOklab', () => {
    const ce = colorEngine();
    expect(ce.box('cd').evaluate().type.toString()).toBe(
      'list<color | missing>'
    );

    const interp = ce.box(['AsOklab', 'cd']).evaluate();
    // The interpreter: an error in the cell of the marker, the Oklab of
    // green in the other cell.
    expect(interp.ops![0].operator).toBe('Error');
    expect(interp.ops![1].operator).toBe('Oklab');
    const want = interp.ops![1].ops!.map((x) => x.re);

    const got = run(ce, ['AsOklab', 'cd']) as any[];
    expect(got).toHaveLength(2);
    // The cell of the marker: the NaN color (unspecified by the caveats).
    expect(got[0].space).toBe('oklab');
    expect([got[0].c0, got[0].c1, got[0].c2]).toEqual([NaN, NaN, NaN]);
    // The present cell: the interpreter's value.
    expect(got[1].space).toBe('oklab');
    [got[1].c0, got[1].c1, got[1].c2].forEach((x, i) =>
      expect(x).toBeCloseTo(want[i], 12)
    );
  });

  test('a list<string> symbol read by At', () => {
    const ce = new ComputeEngine();
    ce.declare('ss', 'list<string>');
    ce.assign(
      'ss',
      ce
        .box(['List', ['If', ['Greater', 1, 2], { str: 'a' }], { str: 'b' }])
        .evaluate()
    );
    expect(ce.box('ss').evaluate().type.toString()).toBe(
      'list<missing | string>'
    );

    // The present cell: the interpreter's value.
    expect(ce.box(['At', 'ss', 2]).evaluate().string).toBe('b');
    expect(run(ce, ['At', 'ss', 2])).toBe('b');
    // The cell of the marker: `Missing` in the interpreter, `undefined` in
    // compiled code.
    expect(ce.box(['At', 'ss', 1]).evaluate().symbol).toBe('Missing');
    expect(run(ce, ['At', 'ss', 1])).toBeUndefined();
  });

  // The interpreter's check of a value captured by a function literal
  // (`capturedValueMismatch()`, `function-utils.ts`) removes the same
  // `missing` arms, so a call reads the symbol as compiled code does.
  test('a function literal reads the symbol in the interpreter', () => {
    const ce = colorEngine();
    const r = ce
      .box(['Apply', ['Function', ['AsOklab', 'cd'], 'x'], 1])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops![1].operator).toBe('Oklab');

    ce.declare('ss', 'list<string>');
    ce.assign(
      'ss',
      ce
        .box(['List', ['If', ['Greater', 1, 2], { str: 'a' }], { str: 'b' }])
        .evaluate()
    );
    expect(
      ce.box(['Apply', ['Function', ['At', 'ss', 2], 'x'], 1]).evaluate().string
    ).toBe('b');

    // A value that is wrong where it is present is still refused.
    (ce.lookupDefinition('ss') as any).value.value = ce
      .box(['List', 5, ['If', ['Greater', 1, 2], { str: 'a' }]])
      .evaluate();
    const bad = ce
      .box(['Apply', ['Function', ['At', 'ss', 2], 'x'], 1])
      .evaluate();
    expect(bad.operator).toBe('Error');
  });

  test('a value that is wrong where it is present still declines', () => {
    // A host writes the value of the definition directly: an integer cell
    // in a list<string> symbol. Removing the `missing` arm leaves
    // `list<integer>`, which is not `list<string>`.
    const ce = new ComputeEngine();
    ce.declare('ss', 'list<string>');
    (ce.lookupDefinition('ss') as any).value.value = ce
      .box(['List', 5, ['If', ['Greater', 1, 2], { str: 'a' }]])
      .evaluate();
    expect(() =>
      compile(ce.box(['At', 'ss', 1]), { fallback: false })
    ).toThrow(/^Could not compile the symbol 'ss': its value has the type/);
  });
});
