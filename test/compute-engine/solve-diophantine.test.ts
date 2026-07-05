import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

// A dedicated engine: several tests DECLARE integer-typed unknowns (and one
// ASSIGNS a value to a would-be parameter name), which mutate the global scope;
// keeping them off the shared test engine avoids cross-file leakage.
const ce = new ComputeEngine();

/** Evaluate a multi-variable `Solve` and return its tuples as arrays of numbers
 *  (each coordinate numericized). Throws if the result is not a `List` of
 *  `Tuple`s. Order is preserved. */
function tuples(expr: BoxedExpression): number[][] {
  const r = expr.evaluate();
  if (r.operator !== 'List')
    throw new Error(`Expected a List, got ${r.operator}: ${r.toString()}`);
  return r.ops!.map((t) => {
    if (t.operator !== 'Tuple')
      throw new Error(`Expected a Tuple, got ${t.operator}: ${t.toString()}`);
    return t.ops!.map((o) => o.N().re);
  });
}

/** True if the `Solve` expression stayed unevaluated (undecided / inert). */
function isInert(expr: BoxedExpression): boolean {
  return expr.evaluate().operator === 'Solve';
}

/** Brute-force the integer solutions of a two-unknown equation over a box, as a
 *  lexicographically sorted array — the oracle the symbolic path must match. */
function bruteForce(
  f: (x: number, y: number) => number,
  xlo: number,
  xhi: number,
  ylo: number,
  yhi: number
): number[][] {
  const out: number[][] = [];
  for (let x = xlo; x <= xhi; x++)
    for (let y = ylo; y <= yhi; y++)
      if (f(x, y) === 0) out.push([x, y]);
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

describe('DIOPHANTINE — linear, bounded domains', () => {
  test('3x + 4y = 7 over [-10,10]² yields the exact lattice line', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Multiply', 3, 'x'], ['Multiply', 4, 'y']], 7],
      ['Element', 'x', ['Range', -10, 10]],
      ['Element', 'y', ['Range', -10, 10]],
    ]);
    // x = -7 + 4t, y = 7 - 3t, filtered to the box.
    expect(tuples(expr)).toEqual([
      [-7, 7],
      [-3, 4],
      [1, 1],
      [5, -2],
      [9, -5],
    ]);
  });

  test('bounded linear matches plain brute-force enumeration', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Multiply', 3, 'x'], ['Multiply', 4, 'y']], 7],
      ['Element', 'x', ['Range', -5, 5]],
      ['Element', 'y', ['Range', -5, 5]],
    ]);
    expect(tuples(expr)).toEqual(
      bruteForce((x, y) => 3 * x + 4 * y - 7, -5, 5, -5, 5)
    );
  });

  test('proven-unsolvable 6x + 9y = 4 over a huge box → empty List (fast)', () => {
    // gcd(6,9)=3 ∤ 4. The 10⁶-wide box would blow the enumeration budget; the
    // symbolic path decides it is empty without sweeping.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Multiply', 6, 'x'], ['Multiply', 9, 'y']], 4],
      ['Element', 'x', ['Range', -1000000, 1000000]],
      ['Element', 'y', ['Range', -1000000, 1000000]],
    ]);
    const r = expr.evaluate();
    expect(r.operator).toBe('List');
    expect(r.nops).toBe(0);
  });

  test('a domain with a step filters out members off the grid', () => {
    // 2x + y = 10; x drawn from the even grid Range(0,10,2). Enumerating y over
    // 0..10 too, the surviving (x, y) all have even x.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Multiply', 2, 'x'], 'y'], 10],
      ['Element', 'x', ['Range', 0, 10, 2]],
      ['Element', 'y', ['Range', 0, 10]],
    ]);
    const t = tuples(expr);
    // Every emitted x is even and in range; matches brute force restricted to
    // even x.
    expect(t.every(([x]) => x % 2 === 0)).toBe(true);
    expect(t).toEqual([
      [0, 10],
      [2, 6],
      [4, 2],
    ]);
  });

  test('rational coefficients are cleared to integers (x/2 + y/3 = 1)', () => {
    // Scale through by 6 → 3x + 2y = 6.
    const expr = ce.box([
      'Solve',
      [
        'Equal',
        ['Add', ['Divide', 'x', 2], ['Divide', 'y', 3]],
        1,
      ],
      ['Element', 'x', ['Range', -10, 10]],
      ['Element', 'y', ['Range', -10, 10]],
    ]);
    expect(tuples(expr)).toEqual(
      bruteForce((x, y) => 3 * x + 2 * y - 6, -10, 10, -10, 10)
    );
  });
});

describe('DIOPHANTINE — Pell / diagonal quadratics, bounded domains', () => {
  test('MathNet 0jxv: x² − 29y² = 1 over [1,10⁵]² → exactly (9801, 1820)', () => {
    // MathNet characterization case id `0jxv`: smallest x + y with x, y ≥ 1.
    // The 10¹⁰ box proves the symbolic (non-enumerating) path fired.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Subtract', ['Power', 'x', 2], ['Multiply', 29, ['Power', 'y', 2]]], 1],
      ['Element', 'x', ['Range', 1, 100000]],
      ['Element', 'y', ['Range', 1, 100000]],
    ]);
    const t = tuples(expr);
    expect(t).toEqual([[9801, 1820]]);
    expect(9801 + 1820).toBe(11621);
  });

  test('x² + y² = 25 over [-100,100]² → the 12 signed lattice solutions', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 25],
      ['Element', 'x', ['Range', -100, 100]],
      ['Element', 'y', ['Range', -100, 100]],
    ]);
    expect(tuples(expr)).toEqual(
      bruteForce((x, y) => x * x + y * y - 25, -100, 100, -100, 100)
    );
  });

  test('elliptic x² + 3y² = 28 (finite) matches brute force', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Power', 'x', 2], ['Multiply', 3, ['Power', 'y', 2]]], 28],
      ['Element', 'x', ['Range', -50, 50]],
      ['Element', 'y', ['Range', -50, 50]],
    ]);
    expect(tuples(expr)).toEqual(
      bruteForce((x, y) => x * x + 3 * y * y - 28, -50, 50, -50, 50)
    );
  });

  test('Pell family x² − 2y² = 1 over a bounded box matches brute force', () => {
    const expr = ce.box([
      'Solve',
      ['Equal', ['Subtract', ['Power', 'x', 2], ['Multiply', 2, ['Power', 'y', 2]]], 1],
      ['Element', 'x', ['Range', -200, 200]],
      ['Element', 'y', ['Range', -200, 200]],
    ]);
    expect(tuples(expr)).toEqual(
      bruteForce((x, y) => x * x - 2 * y * y - 1, -200, 200, -200, 200)
    );
  });

  test('reversed roles: 29x² − y² = -1 (|B|=1) maps coordinates correctly', () => {
    // Same Pell content as 0jxv but with the unit coefficient on the SECOND
    // unknown; the coordinate mapping must keep tuples in (x, y) order.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Subtract', ['Multiply', 29, ['Power', 'x', 2]], ['Power', 'y', 2]], -1],
      ['Element', 'x', ['Range', 1, 100000]],
      ['Element', 'y', ['Range', 1, 100000]],
    ]);
    // 29x² − y² = -1 ⇔ y² − 29x² = 1 → (y, x) = (9801, 1820), i.e. x=1820.
    expect(tuples(expr)).toEqual([[1820, 9801]]);
  });
});

describe('DIOPHANTINE — unbounded, parametric results', () => {
  test('linear 3n + 4m = 7 (integer-typed, no domain) → one parametric tuple', () => {
    ce.pushScope();
    try {
      ce.declare('n', 'integer');
      ce.declare('m', 'integer');
      const expr = ce.box([
        'Solve',
        ['Equal', ['Add', ['Multiply', 3, 'n'], ['Multiply', 4, 'm']], 7],
        'n',
        'm',
      ]);
      const r = expr.evaluate();
      expect(r.operator).toBe('List');
      expect(r.nops).toBe(1);
      const tuple = r.op1;
      expect(tuple.operator).toBe('Tuple');
      // Verify by substituting several integer parameter values, rather than
      // pinning the parametric form.
      for (const tv of [-3, -1, 0, 2, 5]) {
        const nv = tuple.op1.subs({ t: ce.number(tv) }).evaluate();
        const mv = tuple.op2.subs({ t: ce.number(tv) }).evaluate();
        expect(3 * nv.re + 4 * mv.re).toBe(7);
        expect(Number.isInteger(nv.re)).toBe(true);
        expect(Number.isInteger(mv.re)).toBe(true);
      }
    } finally {
      ce.popScope();
    }
  });

  test('parameter name is fresh: a bound `t` does not leak into the result', () => {
    ce.pushScope();
    try {
      ce.declare('n', 'integer');
      ce.declare('m', 'integer');
      ce.assign('t', 5); // `t` now has a value
      const r = ce
        .box([
          'Solve',
          ['Equal', ['Add', ['Multiply', 3, 'n'], ['Multiply', 4, 'm']], 7],
          'n',
          'm',
        ])
        .evaluate();
      const tuple = r.op1;
      // The result must NOT have collapsed `t`→5 (which would make the
      // coordinates concrete garbage); it stays parametric in a fresh symbol.
      expect(tuple.op1.symbols.includes('t')).toBe(false);
      // The fresh parameter still verifies the equation.
      const freshName = tuple.op1.symbols.find((s) => s !== 'n' && s !== 'm')!;
      for (const tv of [0, 3]) {
        const nv = tuple.op1.subs({ [freshName]: ce.number(tv) }).evaluate();
        const mv = tuple.op2.subs({ [freshName]: ce.number(tv) }).evaluate();
        expect(3 * nv.re + 4 * mv.re).toBe(7);
      }
    } finally {
      ce.popScope();
    }
  });

  test('n ≥ 3 variables: parametric tuple in n−1 parameters', () => {
    ce.pushScope();
    try {
      ce.declare('a', 'integer');
      ce.declare('b', 'integer');
      ce.declare('c', 'integer');
      const r = ce
        .box([
          'Solve',
          [
            'Equal',
            ['Add', ['Multiply', 2, 'a'], ['Multiply', 3, 'b'], ['Multiply', 5, 'c']],
            1,
          ],
          'a',
          'b',
          'c',
        ])
        .evaluate();
      expect(r.operator).toBe('List');
      const tuple = r.op1;
      expect(tuple.operator).toBe('Tuple');
      // Two free parameters; verify over a small grid.
      const params = [
        ...new Set(
          [...tuple.op1.symbols, ...tuple.op2.symbols, ...tuple.op3.symbols].filter(
            (s) => s !== 'a' && s !== 'b' && s !== 'c'
          )
        ),
      ];
      expect(params.length).toBe(2);
      for (const t1 of [-1, 0, 2])
        for (const t2 of [-2, 1]) {
          const sub = { [params[0]]: ce.number(t1), [params[1]]: ce.number(t2) };
          const av = tuple.op1.subs(sub).evaluate().re;
          const bv = tuple.op2.subs(sub).evaluate().re;
          const cv = tuple.op3.subs(sub).evaluate().re;
          expect(2 * av + 3 * bv + 5 * cv).toBe(1);
        }
    } finally {
      ce.popScope();
    }
  });

  test('unbounded Pell p² − 2q² = 1 → closed-form tuples verified at t=0,1,2', () => {
    ce.pushScope();
    try {
      ce.declare('p', 'integer');
      ce.declare('q', 'integer');
      const r = ce
        .box([
          'Solve',
          ['Equal', ['Subtract', ['Power', 'p', 2], ['Multiply', 2, ['Power', 'q', 2]]], 1],
          'p',
          'q',
        ])
        .evaluate();
      expect(r.operator).toBe('List');
      // Two tuples per class: the family and its negation.
      expect(r.nops).toBeGreaterThanOrEqual(2);
      const fam = r.op1; // first family
      for (const tv of [0, 1, 2]) {
        // `.N().re`: closed forms in √2 stay symbolic, so numericize.
        const pv = fam.op1.subs({ t: ce.number(tv) }).N().re;
        const qv = fam.op2.subs({ t: ce.number(tv) }).N().re;
        expect(pv * pv - 2 * qv * qv).toBeCloseTo(1, 6);
      }
      // The negation family also satisfies the equation.
      const neg = r.op2;
      for (const tv of [0, 1, 2]) {
        const pv = neg.op1.subs({ t: ce.number(tv) }).N().re;
        const qv = neg.op2.subs({ t: ce.number(tv) }).N().re;
        expect(pv * pv - 2 * qv * qv).toBeCloseTo(1, 6);
      }
    } finally {
      ce.popScope();
    }
  });

  test('Element(x, Integers) domain spec produces a parametric linear result', () => {
    // The `Integers` collection is an unbounded integer domain (its element type
    // is integer), so the multi-domain path dispatches diophantine and returns
    // the parametric family — no declared-type unknowns needed.
    const r = ce
      .box([
        'Solve',
        ['Equal', ['Add', ['Multiply', 3, 'x'], ['Multiply', 4, 'y']], 7],
        ['Element', 'x', 'Integers'],
        ['Element', 'y', 'Integers'],
      ])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.nops).toBe(1);
    const tuple = r.op1;
    for (const tv of [-2, 0, 3]) {
      const xv = tuple.op1.subs({ t: ce.number(tv) }).evaluate().re;
      const yv = tuple.op2.subs({ t: ce.number(tv) }).evaluate().re;
      expect(3 * xv + 4 * yv).toBe(7);
    }
  });
});

describe('DIOPHANTINE — Pythagorean triples (3 unknowns, homogeneous)', () => {
  // The two classical leg-swap families, as raw closed forms (matching the
  // engine's parametrization). Used both to check the engine's tuples by
  // substitution AND to run the completeness sweep in plain JS (sound because
  // the closed forms are what the engine emits — verified by substitution at a
  // few points below — so a JS sweep over them is a sweep over the engine's
  // own families).
  const famA = (t: number, t1: number, t2: number): [number, number, number] => [
    t * (t1 * t1 - t2 * t2),
    2 * t * t1 * t2,
    t * (t1 * t1 + t2 * t2),
  ];
  const famB = (t: number, t1: number, t2: number): [number, number, number] => [
    2 * t * t1 * t2,
    t * (t1 * t1 - t2 * t2),
    t * (t1 * t1 + t2 * t2),
  ];

  test('x² + y² = z² (unbounded ℤ) → 2 Tuples; a parameter grid stays on-shell', () => {
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      ce.declare('y', 'integer');
      ce.declare('z', 'integer');
      const r = ce
        .box([
          'Solve',
          ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], ['Power', 'z', 2]],
          'x',
          'y',
          'z',
        ])
        .evaluate();
      expect(r.operator).toBe('List');
      expect(r.nops).toBe(2);
      expect(r.op1.operator).toBe('Tuple');
      expect(r.op2.operator).toBe('Tuple');
      // Substitute a grid of parameter values into BOTH tuples; every member
      // must satisfy x² + y² = z² exactly.
      for (const tuple of [r.op1, r.op2]) {
        for (let tv = -3; tv <= 3; tv++)
          for (let t1 = -3; t1 <= 3; t1++)
            for (let t2 = -3; t2 <= 3; t2++) {
              const sub = {
                t: ce.number(tv),
                t_1: ce.number(t1),
                t_2: ce.number(t2),
              };
              const xv = tuple.op1.subs(sub).evaluate().re;
              const yv = tuple.op2.subs(sub).evaluate().re;
              const zv = tuple.op3.subs(sub).evaluate().re;
              expect(Number.isInteger(xv)).toBe(true);
              expect(Number.isInteger(yv)).toBe(true);
              expect(Number.isInteger(zv)).toBe(true);
              expect(xv * xv + yv * yv).toBe(zv * zv);
            }
      }
    } finally {
      ce.popScope();
    }
  });

  test('the engine tuples match the closed-form families at sample points', () => {
    // Anchors the JS completeness sweep to the engine: confirm the engine's two
    // tuples ARE famA/famB (up to the leg-swap) by substitution at a few points.
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      ce.declare('y', 'integer');
      ce.declare('z', 'integer');
      const r = ce
        .box([
          'Solve',
          ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], ['Power', 'z', 2]],
          'x',
          'y',
          'z',
        ])
        .evaluate();
      const engine = (tuple: BoxedExpression, tv: number, t1: number, t2: number) => {
        const sub = { t: ce.number(tv), t_1: ce.number(t1), t_2: ce.number(t2) };
        return [
          tuple.op1.subs(sub).evaluate().re,
          tuple.op2.subs(sub).evaluate().re,
          tuple.op3.subs(sub).evaluate().re,
        ];
      };
      for (const [tv, t1, t2] of [
        [1, 2, 1],
        [2, 3, 1],
        [-1, 3, 2],
        [3, 4, 2],
      ] as const) {
        expect(engine(r.op1, tv, t1, t2)).toEqual(famA(tv, t1, t2));
        expect(engine(r.op2, tv, t1, t2)).toEqual(famB(tv, t1, t2));
      }
    } finally {
      ce.popScope();
    }
  });

  test('COMPLETENESS: every triple with |·| ≤ 25 is generated by the two families', () => {
    // Brute-force all integer solutions with |x|,|y|,|z| ≤ 25.
    const B = 25;
    const brute = new Set<string>();
    for (let x = -B; x <= B; x++)
      for (let y = -B; y <= B; y++)
        for (let z = -B; z <= B; z++)
          if (x * x + y * y === z * z) brute.add(`${x},${y},${z}`);
    // Sweep the two families (anchored to the engine's parametrization by the
    // test above) over a parameter box that provably covers every |·| ≤ 25
    // triple: |t| ≤ 25, |t₁|,|t₂| ≤ 5. Collect only in-window triples.
    const gen = new Set<string>();
    const add = (tr: [number, number, number]) => {
      if (Math.abs(tr[0]) <= B && Math.abs(tr[1]) <= B && Math.abs(tr[2]) <= B)
        gen.add(`${tr[0]},${tr[1]},${tr[2]}`);
    };
    for (let t = -B; t <= B; t++)
      for (let t1 = -5; t1 <= 5; t1++)
        for (let t2 = -5; t2 <= 5; t2++) {
          add(famA(t, t1, t2));
          add(famB(t, t1, t2));
        }
    for (const key of brute) expect(gen.has(key)).toBe(true);
    // Sanity: the brute set is non-trivial (well past just (0,0,0)).
    expect(brute.size).toBeGreaterThan(50);
  });

  test('coordinate mapping: y² = x² + z² lands the hypotenuse role on y', () => {
    // The −1 (hypotenuse) coordinate is y (the MIDDLE unknown, not the last):
    // the mapping must put t·(t₁²+t₂²) on y and the leg forms on x and z.
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      ce.declare('y', 'integer');
      ce.declare('z', 'integer');
      const r = ce
        .box([
          'Solve',
          ['Equal', ['Power', 'y', 2], ['Add', ['Power', 'x', 2], ['Power', 'z', 2]]],
          'x',
          'y',
          'z',
        ])
        .evaluate();
      expect(r.operator).toBe('List');
      expect(r.nops).toBe(2);
      for (const tuple of [r.op1, r.op2])
        for (let tv = -2; tv <= 2; tv++)
          for (let t1 = -3; t1 <= 3; t1++)
            for (let t2 = -3; t2 <= 3; t2++) {
              const sub = {
                t: ce.number(tv),
                t_1: ce.number(t1),
                t_2: ce.number(t2),
              };
              const xv = tuple.op1.subs(sub).evaluate().re;
              const yv = tuple.op2.subs(sub).evaluate().re;
              const zv = tuple.op3.subs(sub).evaluate().re;
              // Roles landed correctly ⇒ y² = x² + z² holds.
              expect(yv * yv).toBe(xv * xv + zv * zv);
            }
    } finally {
      ce.popScope();
    }
  });

  test('negated form z² − x² − y² = 0 → the same two families', () => {
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      ce.declare('y', 'integer');
      ce.declare('z', 'integer');
      const r = ce
        .box([
          'Solve',
          [
            'Equal',
            [
              'Subtract',
              ['Subtract', ['Power', 'z', 2], ['Power', 'x', 2]],
              ['Power', 'y', 2],
            ],
            0,
          ],
          'x',
          'y',
          'z',
        ])
        .evaluate();
      expect(r.operator).toBe('List');
      expect(r.nops).toBe(2);
      // z has the hypotenuse role (last unknown) ⇒ family A === famA / B === famB.
      const engine = (tuple: BoxedExpression, tv: number, t1: number, t2: number) => {
        const sub = { t: ce.number(tv), t_1: ce.number(t1), t_2: ce.number(t2) };
        return [
          tuple.op1.subs(sub).evaluate().re,
          tuple.op2.subs(sub).evaluate().re,
          tuple.op3.subs(sub).evaluate().re,
        ];
      };
      for (const [tv, t1, t2] of [
        [1, 2, 1],
        [2, 3, 1],
        [-2, 3, 2],
      ] as const) {
        expect(engine(r.op1, tv, t1, t2)).toEqual(famA(tv, t1, t2));
        expect(engine(r.op2, tv, t1, t2)).toEqual(famB(tv, t1, t2));
      }
    } finally {
      ce.popScope();
    }
  });

  test('declines: weighted 4x² + y² = z² stays inert', () => {
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      ce.declare('y', 'integer');
      ce.declare('z', 'integer');
      const expr = ce.box([
        'Solve',
        [
          'Equal',
          ['Add', ['Multiply', 4, ['Power', 'x', 2]], ['Power', 'y', 2]],
          ['Power', 'z', 2],
        ],
        'x',
        'y',
        'z',
      ]);
      expect(isInert(expr)).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('declines: four unknowns x² + y² + z² = w² stays inert', () => {
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      ce.declare('y', 'integer');
      ce.declare('z', 'integer');
      ce.declare('w', 'integer');
      const expr = ce.box([
        'Solve',
        [
          'Equal',
          ['Add', ['Power', 'x', 2], ['Power', 'y', 2], ['Power', 'z', 2]],
          ['Power', 'w', 2],
        ],
        'x',
        'y',
        'z',
        'w',
      ]);
      expect(isInert(expr)).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('declines: inhomogeneous x² + y² − z² = 1 stays inert (not Pell)', () => {
    // Three unknowns, so NOT the 2-unknown Pell path; the nonzero constant term
    // means it is not the homogeneous Pythagorean form either → must stay inert,
    // not crash.
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      ce.declare('y', 'integer');
      ce.declare('z', 'integer');
      const expr = ce.box([
        'Solve',
        [
          'Equal',
          [
            'Subtract',
            ['Add', ['Power', 'x', 2], ['Power', 'y', 2]],
            ['Power', 'z', 2],
          ],
          1,
        ],
        'x',
        'y',
        'z',
      ]);
      expect(isInert(expr)).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('bounded box defers to enumeration: x² + y² = z² over Range(−6,6)³', () => {
    // Bounded → the Pythagorean path declines; the existing enumeration produces
    // concrete tuples with NO free parameters.
    const r = ce
      .box([
        'Solve',
        ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], ['Power', 'z', 2]],
        ['Element', 'x', ['Range', -6, 6]],
        ['Element', 'y', ['Range', -6, 6]],
        ['Element', 'z', ['Range', -6, 6]],
      ])
      .evaluate();
    expect(r.operator).toBe('List');
    const rows = r.ops!.map((t) => t.ops!.map((o) => o.re));
    // Concrete: no coordinate carries a free symbol.
    const anyFree = r.ops!.some((t) => t.ops!.some((o) => o.symbols.length > 0));
    expect(anyFree).toBe(false);
    const has = (x: number, y: number, z: number) =>
      rows.some((t) => t[0] === x && t[1] === y && t[2] === z);
    // Known members within the box.
    expect(has(0, 0, 0)).toBe(true);
    expect(has(3, 4, 5)).toBe(true);
    expect(has(4, 3, 5)).toBe(true);
    expect(has(-3, -4, 5)).toBe(true);
    expect(has(3, -4, -5)).toBe(true);
  });
});

describe('DIOPHANTINE — guards & documented limitations', () => {
  test('untyped unknowns (no declared type) stay inert', () => {
    // `a`, `b` are not declared integer-typed → this is a real-domain solve, and
    // a single equation in two unknowns has no univariate/system path → inert.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Multiply', 3, 'a'], ['Multiply', 4, 'b']], 7],
      'a',
      'b',
    ]);
    expect(isInert(expr)).toBe(true);
  });

  test('half-bounded domain Range(1, +∞) stays inert (documented limitation)', () => {
    // A half-bounded integer domain is neither a finitely instantiable box nor
    // fully unbounded, so Phase 3 declines it — never silently dropping the
    // domain constraint. Documented limitation; not a wrong answer.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Subtract', ['Power', 'x', 2], ['Multiply', 29, ['Power', 'y', 2]]], 1],
      ['Element', 'x', ['Range', 1, 'PositiveInfinity']],
      ['Element', 'y', ['Range', 1, 'PositiveInfinity']],
    ]);
    expect(isInert(expr)).toBe(true);
  });

  test('real Interval domain does not dispatch diophantine', () => {
    // An `Interval` is a real (non-integer) domain: the integer-domain gate
    // fails, so the existing (enumeration/inert) path is used unchanged.
    const expr = ce.box([
      'Solve',
      ['Equal', ['Add', ['Multiply', 3, 'x'], ['Multiply', 4, 'y']], 7],
      ['Element', 'x', ['Interval', -10, 10]],
      ['Element', 'y', ['Interval', -10, 10]],
    ]);
    // Non-enumerable real domains → inert (no wrong answer).
    expect(isInert(expr)).toBe(true);
  });

  test('non-Pell binary quadratic (cross term) is not recognized → inert path', () => {
    ce.pushScope();
    try {
      ce.declare('u', 'integer');
      ce.declare('v', 'integer');
      // x² + xy + y² = 1 has a cross term; not a diagonal Pell form → declines
      // to the existing (here inert) path.
      const expr = ce.box([
        'Solve',
        [
          'Equal',
          ['Add', ['Power', 'u', 2], ['Multiply', 'u', 'v'], ['Power', 'v', 2]],
          1,
        ],
        'u',
        'v',
      ]);
      expect(isInert(expr)).toBe(true);
    } finally {
      ce.popScope();
    }
  });
});
