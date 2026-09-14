/**
 * A shader conditional whose arm needs statements is emitted as a STATEMENT.
 *
 * A GLSL ternary and a WGSL `select` are expressions, so an arm has no
 * statement position: a loop-form `Sum` in an arm could only be hoisted
 * ahead of the conditional, where it would run whichever branch is
 * selected — and shift every later draw of the shader's random stream —
 * so such arms failed closed. The Tycho code-generation audit document
 * `yac5cxfjm1` declined 14 records on exactly that shape:
 * `f(x, N) := Which(1 ≤ N, Σ_{n=1}^{⌊N⌋} cos(…)/√N_m, True, 0)`.
 *
 * `compileGPUStatementSelection` (gpu-target.ts) now emits `if … else …`
 * storing the selected value in a temporary declared ahead of it, each
 * clause's hoisted statements captured into its own branch, a later
 * condition's statements inside the `else` of the clause before it. Only a
 * conditional with such an arm takes the form; the ternary emission of
 * every other conditional is unchanged.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { gpuNeedsStatements } from '../../src/compute-engine/compilation/gpu-target';

const ce = new ComputeEngine();
ce.declare('t', 'real');
ce.declare('x', 'real');
ce.assign('N_m', 100);
ce.declare('r', 'function');
ce.assign('r', ce.parse(String.raw`n \mapsto \sin(n)`));
ce.declare('f_mx', 'function');
ce.assign(
  'f_mx',
  ce.parse(
    String.raw`(x, N) \mapsto \begin{cases}\sum_{n=1}^{\lfloor N\rfloor}\cos(2\pi(x((10n)/N_{m}+10)+r(n)))/\sqrt{N_{m}}&1\le N\\0&\top\end{cases}`
  )
);

const MINIMAL = String.raw`\begin{cases}\sum_{n=1}^{\lfloor t\rfloor}\cos(nt)&1\le t\\0&\top\end{cases}`;

/** The compiled root; with `withPreamble`, the helper definitions ahead of it. */
function shader(
  latex: string,
  to: 'glsl' | 'wgsl',
  withPreamble = false
): string {
  const r = compile(ce.parse(latex), { to, fallback: false });
  expect([to, r.success, r.error?.message]).toEqual([to, true, undefined]);
  return withPreamble ? `${r.preamble ?? ''}\n${r.code}` : r.code!;
}

describe('A conditional arm with a loop-form Sum takes the statement form', () => {
  test('the audit shape compiles on both shader targets', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      const code = shader(String.raw`f_{mx}(x, t)`, to, true);
      // The helper holds the if/else with the loop inside the taken branch.
      expect(code).toMatch(/if \(1\.0 <= N\) \{/);
      expect(code.indexOf('for (')).toBeGreaterThan(code.indexOf('if ('));
      expect(code.indexOf('for (')).toBeLessThan(code.indexOf('} else {'));
    }
  });

  test('the minimal shape: the loop runs only when its clause is taken', () => {
    const glsl = shader(MINIMAL, 'glsl');
    expect(glsl).toBe(
      [
        'float _tv1;',
        'if (1.0 <= t) {',
        '  float _tv2 = 0.0;',
        '  for (int n = 1; n <= int(floor(floor(t))); n++) {',
        '    _tv2 += cos(float(n) * t);',
        '  }',
        '  _tv1 = _tv2;',
        '} else {',
        '  _tv1 = 0.0;',
        '}',
        'return _tv1;',
      ].join('\n')
    );
    const wgsl = shader(MINIMAL, 'wgsl');
    expect(wgsl).toContain(
      'var _tv1: f32;\nif (1.0 <= t) {\n  var _tv2: f32 = 0.0;'
    );
    expect(wgsl).toContain('} else {\n  _tv1 = 0.0;\n}\nreturn _tv1;');
  });

  test('a later condition with a loop runs inside the else of the clause before it', () => {
    const latex = String.raw`\begin{cases}1&t<0\\2&\sum_{n=1}^{\lfloor t\rfloor}n\gt3\\0&\top\end{cases}`;
    const code = shader(latex, 'glsl');
    const elseAt = code.indexOf('} else {');
    const forAt = code.indexOf('for (');
    expect(forAt).toBeGreaterThan(elseAt);
    // Three assignments: the two clauses and the default.
    expect(code.match(/_tv1 = /g)?.length).toBe(3);
  });

  test('If and When take the same form', () => {
    const ifCode = shader(
      String.raw`\operatorname{If}(t > 1, \sum_{n=1}^{\lfloor t\rfloor} n, -1)`,
      'glsl'
    );
    expect(ifCode).toMatch(/^float _tv\d+;\nif \(1\.0 < t\) \{/);
    expect(ifCode).toContain('} else {\n  _tv1 = -1.0;\n}');
    const whenCode = shader(
      String.raw`\left(\sum_{n=1}^{\lfloor t\rfloor} n\right)\left\{t > 1\right\}`,
      'glsl'
    );
    expect(whenCode).toMatch(/^float _tv\d+;\nif \(1\.0 < t\) \{/);
    // The masked branch is NaN, as in the ternary form.
    expect(whenCode).toMatch(/\} else \{\n  _tv\d+ = _gpu_nan\(\);\n\}/);
  });

  test('a nested conditional inside the taken branch keeps its own form', () => {
    // The inner ternary has scalar arms: it stays a ternary inside the
    // branch, and a loop in ITS arm would still fail closed there.
    const latex = String.raw`\begin{cases}\sum_{n=1}^{\lfloor t\rfloor}\begin{cases}n&n>2\\0&\top\end{cases}&1\le t\\0&\top\end{cases}`;
    const code = shader(latex, 'glsl');
    expect(code).toContain('? (');
    expect(code.indexOf('? (')).toBeGreaterThan(code.indexOf('for ('));
  });

  test('a statement-form selection nested in a captured branch', () => {
    // The inner selection needs the statement form too; it hoists into the
    // captured branch of the outer one, so the loop runs only when both
    // conditions hold.
    const latex = String.raw`\begin{cases}\begin{cases}\sum_{n=1}^{\lfloor t\rfloor}\sin(n)&t>5\\0&\top\end{cases}&t>0\\-1&\top\end{cases}`;
    const code = shader(latex, 'glsl');
    const outerIf = code.indexOf('if (0.0 < t) {');
    const innerIf = code.indexOf('if (5.0 < t) {');
    const forAt = code.indexOf('for (');
    expect(outerIf).toBeGreaterThanOrEqual(0);
    expect(innerIf).toBeGreaterThan(outerIf);
    expect(forAt).toBeGreaterThan(innerIf);
    expect(code.match(/\} else \{/g)?.length).toBe(2);
  });

  test('a selection with a loop arm inside a sum body takes the form in the loop', () => {
    // The body of a loop-form sum, and each term of an unrolled one, is a
    // statement position of its own: the selection's statement lands inside
    // the loop (or the term), ahead of the accumulation.
    const inner = ['Sum', 'm', ['Limits', 'm', 1, 'n']];
    const loop = compile(
      ce.box([
        'Sum',
        ['If', ['Greater', 'n', 'x'], inner, 0],
        ['Limits', 'n', 1, ['Floor', 't']],
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(loop.success).toBe(true);
    const forAt = loop.code!.indexOf('for (');
    const ifAt = loop.code!.indexOf('if (');
    expect(ifAt).toBeGreaterThan(forAt);
    expect(loop.code!.indexOf('for (', ifAt)).toBeGreaterThan(ifAt);
    const unrolled = compile(
      ce.box([
        'Sum',
        ['If', ['Greater', 'n', 'x'], inner, 0],
        ['Limits', 'n', 1, 3],
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(unrolled.success).toBe(true);
    expect(unrolled.code).toContain('if (');
  });

  test('a selection with an effect keeps the ternary form and declines', () => {
    // Hoisted as a statement, an effect inside the selection — a draw, a
    // write to an enclosing binding, directly or in a called function —
    // would run ahead of an operand written before it. Such a selection
    // keeps the ternary form, which declines a hoisting arm as before.
    ce.declare('f', 'function');
    ce.assign('f', ce.parse(String.raw`n \mapsto n + \operatorname{Random}()`));
    const declines = [
      [
        'If',
        ['Greater', 'x', 0],
        ['Tuple', ['Random'], ['Sum', ['Random'], ['Limits', 'n', 1, 1000]]],
        ['Tuple', 0, 0],
      ],
      [
        'If',
        ['Greater', 'x', 0],
        ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]],
        ['Random'],
      ],
      [
        'If',
        ['Greater', 'x', 0],
        ['Sum', ['f', 'n'], ['Limits', 'n', 1, ['Floor', 't']]],
        0,
      ],
      [
        'If',
        ['Greater', 'x', 0],
        ['Block', ['Declare', 'q', 'real', ['Random']], 'q'],
        0,
      ],
      [
        'If',
        ['Greater', 'x', 0],
        ['Tuple', ['Random'], ['Cot', ['Random']]],
        ['Tuple', ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]], 0],
      ],
    ];
    for (const expr of declines)
      expect(() =>
        compile(ce.box(expr), {
          to: 'glsl',
          fallback: false,
          constantFold: false,
        })
      ).toThrow(/conditionally-evaluated branch|multi-statement construct/);
  });

  test('a selection reading a name the unit assigns keeps the ternary form', () => {
    // Hoisted ahead of the tuple, the selection would read `k` before the
    // assignment written before it; the ternary form declines the loop arm.
    expect(() =>
      compile(
        ce.parse(
          String.raw`k := 0; (k := 1, \operatorname{If}(k > 0, \sum_{n=1}^{\lfloor t\rfloor} n, 0))`
        ),
        { to: 'glsl', fallback: false, constantFold: false }
      )
    ).toThrow(/conditionally-evaluated branch/);
  });

  test('a write outside the selection, in any form, keeps the ternary form', () => {
    const loop = ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 'x']]];
    // The helper body is its own unit: its `k := 1` precedes the selection.
    ce.declare('h_k', 'function');
    ce.assign(
      'h_k',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'k', 'real'],
          ['Assign', 'k', 0],
          ['Tuple', ['Assign', 'k', 1], ['If', ['Greater', 'k', 0], loop, 0]],
        ],
        'x',
      ])
    );
    // A pure function reading the assigned global: the read is in its body.
    ce.declare('k_g', 'real');
    ce.declare('g_k', 'function');
    ce.assign('g_k', ce.box(['Function', ['Add', 'u', 'k_g'], 'u']));
    // A nested block declaring its own `k` does not make the outer read local.
    const nestedArm = [
      'Block',
      ['Declare', 'v', 'real'],
      ['Assign', 'v', 'k'],
      ['Block', ['Declare', 'k', 'real'], ['Assign', 'k', 2], 'k'],
      'v',
    ];
    // A symbol whose inlined value reads the assigned name.
    ce.declare('k_a', 'real');
    ce.declare('a_l', 'real');
    ce.assign('a_l', ce.parse('k_a + 1'));
    // A sibling that writes the name inside a called function; the engine
    // requires the function to declare the `scope` effect.
    ce.declare('k_s', 'real');
    ce.declare('setK', '(real) scope -> real');
    ce.assign('setK', ce.box(['Function', ['Assign', 'k_s', 'v'], 'v']));
    const declines = [
      ['h_k', 'x'],
      [
        'Block',
        ['Assign', 'k_a', 0],
        ['Tuple', ['Assign', 'k_a', 1], ['If', ['Greater', 'a_l', 1], loop, 0]],
      ],
      ['Tuple', ['setK', 1], ['If', ['Greater', 'k_s', 0], loop, 0]],
      [
        'Block',
        ['Assign', 'k_g', 0],
        [
          'Tuple',
          ['Assign', 'k_g', 1],
          [
            'If',
            ['Greater', 'x', 0],
            ['Sum', ['g_k', 'n'], ['Limits', 'n', 1, ['Floor', 'x']]],
            0,
          ],
        ],
      ],
      [
        'Block',
        ['Declare', 'k', 'real'],
        ['Assign', 'k', 0],
        [
          'Tuple',
          ['Assign', 'k', 1],
          ['If', ['Greater', 'x', 0], nestedArm, 0],
        ],
      ],
    ];
    for (const expr of declines)
      expect(() =>
        compile(ce.box(expr), {
          to: 'glsl',
          fallback: false,
          constantFold: false,
        })
      ).toThrow(/conditionally-evaluated branch|multi-statement construct/);
  });

  test('a sibling draw beside a selection without effects keeps the statement form', () => {
    // The selection itself draws nothing, so running it ahead of the
    // sibling's draw changes no value and shifts no draw.
    const r = compile(
      ce.box([
        'Tuple',
        ['Random'],
        [
          'If',
          ['Greater', 'x', 0],
          ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]],
          0,
        ],
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/if \(0\.0 < x\) \{/);
  });

  test('a statement storing the selection examines only its right side', () => {
    // The store runs after the right side is evaluated, so the statement's
    // own assignment is no write ahead of the selection.
    const r = compile(
      ce.box([
        'Block',
        ['Declare', 'q', 'real'],
        [
          'Assign',
          'q',
          [
            'If',
            ['Greater', 'x', 0],
            ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]],
            0,
          ],
        ],
        'q',
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('if (0.0 < x) {');
    expect(r.code).toContain('q = _tv1;');
  });

  test('a draw in the attributes dictionary of a declaration is an effect', () => {
    // A dictionary is pure as a value; the initializer is read out of it.
    const decl = ce.function('Declare', [
      ce.symbol('q'),
      ce.string('real'),
      ce.function('Dictionary', [
        ce.function('Tuple', [ce.string('value'), ce.box(['Random'])]),
      ]),
    ]);
    const block = ce.function('Block', [decl, ce.symbol('q')]);
    expect(BaseCompiler.hasObservableEffect(block)).toBe(true);
    const quiet = ce.function('Block', [
      ce.function('Declare', [ce.symbol('q'), ce.string('real'), ce.box(1)]),
      ce.symbol('q'),
    ]);
    expect(BaseCompiler.hasObservableEffect(quiet)).toBe(false);
  });

  test('a draw behind an assigned symbol in an arm is an effect', () => {
    // The engine calls a symbol with a value pure; the shader inlines the
    // value, so an arm reading `r := Random()` draws when taken.
    ce.declare('r_d', 'real');
    ce.assign('r_d', ce.box(['Random']));
    expect(() =>
      compile(
        ce.box([
          'Tuple',
          ['Random'],
          [
            'If',
            ['Greater', 'x', 0],
            ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]],
            'r_d',
          ],
        ]),
        { to: 'glsl', fallback: false, constantFold: false }
      )
    ).toThrow(/conditionally-evaluated branch/);
  });

  test('a draw behind an assigned symbol inside a called function is an effect', () => {
    // `f(n) := n + r_d` is pure to the engine; the shader inlines `r_d`'s
    // draw into the helper, so the arm draws when taken.
    ce.declare('f_r', 'function');
    ce.assign('f_r', ce.box(['Function', ['Add', 'n', 'r_d'], 'n']));
    expect(() =>
      compile(
        ce.box([
          'Tuple',
          ['Random'],
          [
            'If',
            ['Greater', 'x', 0],
            ['Sum', ['f_r', 'n'], ['Limits', 'n', 1, ['Floor', 't']]],
            0,
          ],
        ]),
        { to: 'glsl', fallback: false, constantFold: false }
      )
    ).toThrow(/conditionally-evaluated branch/);
  });

  test('the statement-needs scan is linear in the distinct nodes of a shared arm', () => {
    // A tower `Max(e, e)` of depth 30 holds 31 distinct nodes and unfolds to
    // 2^30; a scan that unfolds it does not finish. Tested on the scan
    // directly rather than through a compile: the common-subexpression pass
    // itself runs super-linearly on a very deeply shared tower (a separate,
    // pre-existing cost recorded in `ROADMAP.md`), so a full compile of a
    // depth-30 tower would not finish here for a reason unrelated to the scan.
    let tower = ce.box(['Add', 'x', 't']);
    for (let i = 0; i < 30; i++) tower = ce.function('Max', [tower, tower]);
    expect(gpuNeedsStatements(tower)).toBe(false);
    const withLoop = ce.function('Max', [
      tower,
      ce.box(['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]]),
    ]);
    expect(gpuNeedsStatements(withLoop)).toBe(true);
  });

  test('a shared subexpression of a statement-form arm is bound inside the branch', () => {
    // The arm needs statements (a loop-form Sum), so it takes the statement
    // form, whose captured branch is a statement position: the shared tower
    // is declared there, once, instead of expanded once per occurrence.
    let tower = ce.box(['Add', 'x', 't']);
    for (let i = 0; i < 6; i++) tower = ce.function('Max', [tower, tower]);
    const r = compile(
      ce.function('If', [
        ce.box(['Greater', 'x', 0]),
        ce.function('Add', [
          tower,
          ce.box(['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]]),
        ]),
        ce.box(0),
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code!.length).toBeLessThan(1000);
    // The declaration sits inside the branch, after the opening `if (`.
    expect(r.code!.search(/float _cse\d+ =/)).toBeGreaterThan(
      r.code!.indexOf('if (')
    );
  });

  test('each branch of a statement-form selection binds its shared work separately', () => {
    // A temporary lives inside its branch's braces, so a subexpression shared
    // by two arms is declared once PER branch, never once ahead of the
    // conditional where the sibling branch could not reach it.
    let tower = ce.box(['Add', 'x', 't']);
    for (let i = 0; i < 4; i++) tower = ce.function('Max', [tower, tower]);
    const r = compile(
      ce.function('Which', [
        ce.box(['Greater', 'x', 0]),
        ce.function('Add', [
          tower,
          ce.box(['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]]),
        ]),
        ce.symbol('True'),
        ce.function('Add', [
          tower,
          ce.box(['Sum', 'm', ['Limits', 'm', 1, ['Floor', 't']]]),
        ]),
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    const code = r.code!;
    // No temporary is declared ahead of the first branch.
    expect(code.search(/float _cse\d+ =/)).toBeGreaterThan(
      code.indexOf('if (')
    );
    // The else branch declares its own.
    const elseAt = code.indexOf('} else {');
    expect(code.slice(elseAt).search(/float _cse\d+ =/)).toBeGreaterThanOrEqual(
      0
    );
  });

  test('a shared subexpression in a nested lazy operand of an arm stays inline', () => {
    // The `And` right side is a lazy operand of its own: a binding hoisted
    // out of it would run even when the `And` short-circuits, so it keeps
    // the ternary form and the tower there is not bound.
    let tower = ce.box(['Add', 'x', 't']);
    for (let i = 0; i < 4; i++) tower = ce.function('Max', [tower, tower]);
    const r = compile(
      ce.function('If', [
        ce.box(['Greater', 'x', 0]),
        ce.function('Add', [
          ce.box(['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]]),
          ce.function('If', [
            ce.function('And', [
              ce.box(['Greater', 'x', 1]),
              ce.box(['Greater', tower, 0]),
            ]),
            ce.box(1),
            ce.box(2),
          ]),
        ]),
        ce.box(0),
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_cse');
  });

  test('a scalar arm that repeats a subexpression takes the statement form', () => {
    // No loop, block, or loop-form sum: a plain expression arm that shares a
    // deep subtree. The ternary would unfold the sharing; the statement form
    // binds it once in the branch, so the emission stays small.
    let tower = ce.box(['Add', 'x', 't']);
    for (let i = 0; i < 16; i++) tower = ce.function('Max', [tower, tower]);
    const r = compile(
      ce.function('If', [ce.box(['Greater', 'x', 0]), tower, ce.box(0)]),
      {
        to: 'glsl',
        fallback: false,
        constantFold: false,
      }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('if (0.0 < x) {');
    expect(r.code!.length).toBeLessThan(1000);
  });

  test('a symbol value cycle in an arm does not hang the shared-work scan', () => {
    // `a := b; b := a` is a value cycle; the scan follows a value on the
    // current path only, so it terminates instead of overflowing the stack.
    ce.declare('cyc_a', 'number');
    ce.declare('cyc_b', 'number');
    ce.assign('cyc_a', ce.symbol('cyc_b'));
    ce.assign('cyc_b', ce.symbol('cyc_a'));
    const r = compile(
      ce.function('If', [
        ce.box(['Greater', 'x', 0]),
        ce.symbol('cyc_a'),
        ce.box(0),
      ]),
      {
        to: 'glsl',
        fallback: true,
        constantFold: false,
      }
    );
    // The point is that compilation returns rather than hangs; either a
    // fail-closed fallback or a compile is acceptable.
    expect(r).toBeDefined();
  });

  test('an arm repeating a symbol whose value is shared takes the statement form', () => {
    // The shader inlines `k`'s value, so `k + k` inlines a shared tower twice;
    // the detector reads through the symbol as the statement-needs scan does.
    let tower = ce.box(['Add', 'x', 't']);
    for (let i = 0; i < 10; i++) tower = ce.function('Max', [tower, tower]);
    ce.declare('k_shared', 'number');
    ce.assign('k_shared', tower);
    const r = compile(
      ce.function('If', [
        ce.box(['Greater', 'x', 0]),
        ce.function('Add', [ce.symbol('k_shared'), ce.symbol('k_shared')]),
        ce.box(0),
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('if (0.0 < x) {');
  });

  test('a scalar conditional whose arms share nothing keeps its ternary', () => {
    // The extension must not turn every conditional into an if/else: an arm
    // with no repeated subexpression stays a compact ternary.
    const code = shader(
      String.raw`\begin{cases}x+1&t<0\\0&\top\end{cases}`,
      'glsl'
    );
    expect(code).not.toContain('if (');
    expect(code).toContain('? (');
  });

  test('a subexpression the first condition shares with its arm is bound once', () => {
    // The condition is compiled first, as in the ternary form, so the
    // binding it establishes for the shared tower serves the arm.
    let tower = ce.box(['Add', 'x', 't']);
    for (let i = 0; i < 16; i++) tower = ce.function('Max', [tower, tower]);
    const r = compile(
      ce.function('Which', [
        ce.function('Greater', [tower, ce.box(0)]),
        ce.function('Add', [
          tower,
          ce.box(['Sum', 'n', ['Limits', 'n', 1, 2]]),
        ]),
        ce.symbol('True'),
        ce.box(0),
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code!.length).toBeLessThan(4000);
  });

  test('an arm that is a symbol assigned a loop-form sum takes the form', () => {
    // The shader inlines the symbol's value; the scan reads it in place.
    ce.declare('a_s', 'number');
    ce.assign('a_s', ce.box(['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]]));
    const r = compile(ce.box(['If', ['Greater', 'x', 0], 'a_s', 0]), {
      to: 'glsl',
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/^float _tv\d+;\nif \(0\.0 < x\) \{/);
    expect(r.code!.indexOf('for (')).toBeGreaterThan(r.code!.indexOf('if ('));
  });

  test('a block assigning its own local is not an effect', () => {
    const r = compile(
      ce.box([
        'If',
        ['Greater', 'x', 0],
        ['Block', ['Declare', 'q'], ['Assign', 'q', 2], 'q'],
        1,
      ]),
      { to: 'glsl', fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/^float _tv1;\nif \(0\.0 < x\) \{/);
  });

  test('a conditional with scalar arms keeps its ternary', () => {
    const code = shader(
      String.raw`\begin{cases}1&t<0\\0&\top\end{cases}`,
      'glsl'
    );
    expect(code).not.toContain('if (');
    expect(code).toContain('? (');
  });

  test('a vector-valued selection with a loop arm is typed by its arms', () => {
    const latex = String.raw`\begin{cases}\left(\sum_{n=1}^{\lfloor t\rfloor} n, t\right)&1\le t\\(0, 0)&\top\end{cases}`;
    const code = shader(latex, 'glsl');
    expect(code).toMatch(/^vec2 _tv\d+;\nif \(1\.0 <= t\) \{/);
  });

  test('a boolean selection with no default clause still declines', () => {
    // Such a selection types `boolean | missing`, and the absent-position
    // gate of the base compiler declines it before any lowering runs; the
    // statement form's own guard against a NaN fall-through into a `bool`
    // temporary sits behind that gate, for a type the gate does not cover.
    expect(() =>
      compile(
        ce.box([
          'Which',
          ['Greater', 'x', 0],
          'True',
          ['Greater', ['Sum', 'n', ['Limits', 'n', 1, ['Floor', 't']]], 3],
          'False',
        ]),
        { to: 'glsl', fallback: false, constantFold: false }
      )
    ).toThrow();
  });
});
