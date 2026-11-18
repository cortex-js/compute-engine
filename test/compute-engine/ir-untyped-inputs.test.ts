import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import type { CompileDiagnostic } from '../../src/compute-engine/compilation/types';

// An input of the profile `ir` whose type is `unknown` or `any` is refused
// with the diagnostic of the existing compiler (`ir/README.md`, "Inputs";
// `docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time").

type Json = unknown;
type Result = {
  success?: boolean;
  diagnostic?: CompileDiagnostic;
  unsupported?: string[];
  run?: (...a: unknown[]) => unknown;
};

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('kAny', 'any');
ce.declare('cst', 'real');
ce.assign('cst', 3);
ce.declare('sy', 'real');
ce.assign('sy', 2);
// A function whose body reads the input `bb`, of no type.
ce.assign(
  'hb',
  ce.box(['Function', ['If', ['Greater', 't', 0], 'bb', 't'], 't'] as never)
);
// `qq` has no type in `fq` and `fr`, and a type in `gq` (`Add`).
ce.assign('gq', ce.box(['Function', ['Add', 'qq', 1], 't'] as never));
ce.assign(
  'fq',
  ce.box(['Function', ['Tuple', 'qq', ['gq', 't']], 't'] as never)
);
ce.assign(
  'fr',
  ce.box(['Function', ['Tuple', ['gq', 't'], 'qq'], 't'] as never)
);
ce.declare('vd', 'real');
// `vars` names read in a body: `ww` declared `any`, `wu` and `wv`
// undeclared (`wv` is typed where the root reads it in `Add`).
ce.declare('ww', 'any');
// A user function whose signature declares its parameter `any`, and one
// that takes a real.
ce.declare('fa', '(any) -> real');
ce.assign('fa', ce.box(['Function', ['Add', 'p', 1], 'p'] as never));
ce.declare('fs', '(real) -> real');
ce.assign('fs', ce.box(['Function', ['Add', 'p', 1], 'p'] as never));
ce.assign(
  'hm',
  ce.box(['Function', ['If', ['Less', 'ww', 3], 'ww', 't'], 't'] as never)
);
ce.assign(
  'hn',
  ce.box(['Function', ['If', ['Less', 'wu', 3], 'wu', 't'], 't'] as never)
);
ce.assign(
  'hv',
  ce.box(['Function', ['If', ['Less', 'wv', 3], 'wv', 't'], 't'] as never)
);
// A function whose parameter `s` has no declared type.
ce.assign(
  'hp',
  ce.box(['Function', ['If', ['Greater', 'x', 0], 's', 0], 's'] as never)
);

/** The result of `compile()`, or the diagnostic of its throw. */
function compiled(json: Json, options: object): Result {
  try {
    return compile(ce.box(json as never), options as never) as Result;
  } catch (e) {
    const diagnostic = (e as { diagnostic?: CompileDiagnostic }).diagnostic;
    if (diagnostic === undefined) throw e;
    return { diagnostic };
  }
}

const refusal = (names: string) => ({
  code: 'untyped-input',
  kind: 'correctness',
  value: names,
});

// The programs, and the names that the refusal lists.
const REFUSED: [string, Json, string][] = [
  ['one name', 'w', 'w'],
  ['two names', ['List', 'w', 'v'], 'w,v'],
  ['a name declared any', ['Add', 'kAny', 1], 'kAny'],
  ['a name read only in a called body', ['hb', 'x'], 'bb'],
  ['a name that is a list at run time', ['If', ['Less', 'M', 3], 'M', 0], 'M'],
];

/** The options of the `vars` witness: `M` is read as the host's `_.M`. */
const VARS = { vars: { M: '_.M' } };

describe('IR profile: an input with no type', () => {
  test.each(REFUSED)(
    '%s: the diagnostic of the existing compiler on javascript',
    (_, json, names) => {
      for (const fallback of [false, true]) {
        const existing = compiled(json, { fallback });
        const ir = compiled(json, { profile: 'ir', fallback });
        expect(existing.diagnostic).toMatchObject(refusal(names));
        expect(ir.diagnostic).toEqual(existing.diagnostic);
        expect(ir.success).toBe(existing.success);
        // The fallback of the profile names the inputs of the refusal only
        // (the existing one also names the user function `hb` that its
        // reference analysis does not lower).
        expect(ir.unsupported).toEqual(fallback ? names.split(',') : undefined);
        if (fallback) expect(typeof ir.run).toBe('function');
      }
    }
  );

  test.each(REFUSED)('%s: refused on glsl', (_, json, names) => {
    const ir = compiled(json, { to: 'glsl', profile: 'ir', fallback: false });
    expect(ir.diagnostic).toMatchObject(refusal(names));
    expect(ir.diagnostic?.message).toBe(
      compiled(json, { profile: 'ir', fallback: false }).diagnostic?.message
    );
    // With `fallback`, the existing GLSL target compiles the expression
    // (and refuses the input with a diagnostic of its own).
    const glsl = { to: 'glsl', fallback: true };
    const existing = compiled(json, glsl);
    const fallback = compiled(json, { ...glsl, profile: 'ir' });
    expect(fallback.success).toBe(false);
    expect(fallback.diagnostic).toEqual(existing.diagnostic);
    expect(fallback.unsupported).toEqual(existing.unsupported);
  });

  test('the message names each input', () => {
    expect(
      compiled(['List', 'w', 'v'], { profile: 'ir', fallback: false })
        .diagnostic?.message
    ).toBe(
      'Could not compile: the inputs `w`, `v` have no type (`unknown` or ' +
        '`any`). Declare the type of each input, for example with ' +
        '`ce.declare("w", "real")`.'
    );
  });

  test('in the complex mode', () => {
    for (const json of [
      ['List', 'w', 1],
      ['Add', 'kAny', 1],
    ])
      expect(
        compiled(json, { profile: 'ir', fallback: false, mode: 'complex' })
          .diagnostic
      ).toMatchObject(refusal(json[1] as string));
  });

  test('in the bigint mode, the decline of the mode, which reads the inputs as reals', () => {
    const ir = { profile: 'ir', fallback: false };
    const json = ['List', 'w', 'v'];
    expect(compiled(json, { ...ir, mode: 'bigint' }).diagnostic).toMatchObject({
      code: 'bigint-lane',
      message: expect.stringContaining('the bigint mode'),
    });
    expect(compiled(json, ir).diagnostic).toMatchObject(refusal('w,v'));
  });

  test('a vars name with no type is refused', () => {
    const json = ['If', ['Less', 'M', 3], 'M', 0];
    const existing = compiled(json, { ...VARS, fallback: false });
    expect(existing.diagnostic).toMatchObject(refusal('M'));
    expect(
      compiled(json, { ...VARS, profile: 'ir', fallback: false }).diagnostic
    ).toEqual(existing.diagnostic);
    expect(
      compiled(json, { ...VARS, to: 'glsl', profile: 'ir', fallback: false })
        .diagnostic
    ).toMatchObject(refusal('M'));
  });

  test('a decline of the lowering is reported, before or after the input with no type', () => {
    for (const json of [
      ['List', 'w', ['HarmonicNumber', 'x']],
      ['List', ['HarmonicNumber', 'x'], 'w'],
    ])
      for (const to of ['javascript', 'glsl'])
        expect(
          compiled(json, { to, profile: 'ir', fallback: false }).diagnostic
        ).toMatchObject({
          code: 'outside-profile',
          operator: 'HarmonicNumber',
        });
  });

  // `unsupported` names the inputs with no type also when the program
  // declines for another reason, so the host learns which names to declare
  // (CE-1432). A name that an occurrence types (`u` in `Add`) is not one.
  test.each(['javascript', 'glsl', 'interval-js'])(
    'a decline for another reason lists the inputs with no type on %s',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const unsupported = (json: Json) =>
        (compile(ce.box(json as never), { to } as never) as Result).unsupported;
      expect(
        unsupported(['Assign', 'u', ['If', ['Less', 'x', 0], 'u', 0]])
      ).toEqual(['Assign', 'u']);
      expect(unsupported(['Add', ['Sort', ['List', 'x', 'w']], 'v'])).toEqual([
        'Sort',
        'w',
      ]);
    }
  );

  test('a vars name with no type read in a called body is refused', () => {
    for (const [json, vars, name] of [
      [['hm', 'x'], { ww: '_.ww' }, 'ww'],
      [['hn', 'x'], { wu: '_.wu' }, 'wu'],
    ] as const) {
      // The existing compiler: `untyped-input` for `wu`; for `ww`, declared
      // `any`, an error of its `If` (a condition that may be a list).
      if (name === 'wu')
        expect(
          compiled(json, { vars, fallback: false }).diagnostic
        ).toMatchObject(refusal(name));
      for (const to of ['javascript', 'interval-js'])
        expect(
          compiled(json, { to, vars, profile: 'ir', fallback: false })
            .diagnostic
        ).toMatchObject(refusal(name));
      // In the complex mode the input is complex, and the comparison in the
      // body declines first: no code either.
      expect(
        compiled(json, {
          vars,
          profile: 'ir',
          fallback: false,
          mode: 'complex',
        }).diagnostic?.code
      ).toBe('outside-profile');
    }
  });

  test('a vars name read in a body and typed at the root compiles', () => {
    const r = compiled(['Add', 'wv', ['hv', 'x']], {
      vars: { wv: '_.wv' },
      profile: 'ir',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run?.({ x: 0, wv: 2 })).toBe(4);
    expect(r.run?.({ x: 7, wv: 4 })).toBe(11);
  });

  test('the names are in the order the lowering reads them', () => {
    const json = ['Sum', 'w', ['Limits', 'k', 'v', 'u']];
    expect(
      compiled(json, { profile: 'ir', fallback: false }).diagnostic?.value
    ).toBe('v,u,w');
  });

  test('a name typed at one occurrence and untyped at another compiles', () => {
    const point = { x: 1, qq: 2 };
    // Entry then body, body then entry, and two bodies in both orders.
    for (const [json, value] of [
      [
        ['List', 'qq', ['gq', 'x']],
        [2, 3],
      ],
      [
        ['List', ['gq', 'x'], 'qq'],
        [3, 2],
      ],
      [
        ['fq', 'x'],
        [2, 3],
      ],
      [
        ['fr', 'x'],
        [3, 2],
      ],
    ]) {
      const r = compiled(json, { profile: 'ir', fallback: false });
      expect([json, r.success]).toEqual([json, true]);
      expect(r.run?.(point)).toEqual(value);
      expect(
        compiled(json, { to: 'glsl', profile: 'ir', fallback: false })
          .diagnostic?.code
      ).not.toBe('untyped-input');
    }
  });

  test('canCompile() with the profile', () => {
    expect(canCompile(ce.box(['List', 'w', 'v']), { profile: 'ir' })).toEqual({
      ok: false,
      diagnostic: compiled(['List', 'w', 'v'], {
        profile: 'ir',
        fallback: false,
      }).diagnostic,
    });
    expect(
      canCompile(ce.box(['List', 'w', 1]), {
        profile: 'ir',
        inputs: { w: 'real' },
      }).ok
    ).toBe(true);
  });

  test('an input of type number is wide: a real, or a complex in the complex mode', () => {
    const inputs = { u: 'number' };
    const ir = { profile: 'ir', fallback: false, inputs };
    expect(compiled(['List', 'u', 1], ir).run?.({ u: 2 })).toEqual([2, 1]);
    expect(
      compiled(['Sqrt', 'u'], { ...ir, mode: 'complex' }).run?.({ u: -9 })
    ).toEqual({ re: 0, im: 3 });
  });

  // The names that are not inputs, and the inputs that a declaration types:
  // the value on JavaScript, and the types of the inputs on GLSL (`null`: a
  // comprehension declines on GLSL, for a cause that is not a type).
  const real = { type: 'real', lowered: 'float', provenance: 'declared' };
  test.each([
    ['a name with a value', ['List', 'cst', 1], {}, {}, [3, 1], {}],
    [
      'a declared vars name',
      ['List', 'vd', 1],
      { vars: { vd: '_.vd' } },
      { vd: 5 },
      [5, 1],
      { vd: real },
    ],
    [
      'a local',
      ['Block', ['Declare', 'loc', 'unknown', 2], 'loc'],
      {},
      {},
      2,
      {},
    ],
    ['a loop index', ['Sum', 'k', ['Limits', 'k', 1, 3]], {}, {}, 6, {}],
    [
      'the index of a comprehension',
      ['Comprehension', 'j', ['Element', 'j', ['Range', 1, 3]]],
      {},
      {},
      [1, 2, 3],
      null,
    ],
    [
      'an untyped parameter of a user function',
      ['hp', 'x'],
      {},
      { x: 2 },
      2,
      { x: real },
    ],
    [
      'a declared symbolic name',
      ['List', 'sy', 'x'],
      { symbolic: ['sy'] },
      { sy: 4, x: 1 },
      [4, 1],
      { sy: real, x: real },
    ],
    [
      'a name typed by the option inputs only',
      ['List', 'w', 1],
      { inputs: { w: 'real' } },
      { w: 7 },
      [7, 1],
      { w: real },
    ],
  ])('%s compiles', (_, json, options, point, value, glslTypes) => {
    const ir = { profile: 'ir', fallback: false, ...options };
    const r = compiled(json, ir);
    expect(r.success).toBe(true);
    expect(r.run?.(point)).toEqual(value);
    const glsl = compiled(json, { ...ir, to: 'glsl' }) as Result & {
      freeSymbolTypes?: unknown;
    };
    if (glslTypes === null)
      expect(glsl.diagnostic?.code).toBe('outside-profile');
    else {
      expect(glsl.success).toBe(true);
      expect(glsl.freeSymbolTypes).toEqual(glslTypes);
    }
  });

  test('a declared any that is not an input keeps its decline', () => {
    const literal = (op: string, type: string) => [
      'Function',
      [op, 'p', 'q'],
      ['Typed', 'p', { str: type }],
      ['Typed', 'q', { str: type }],
    ];
    const ir = { profile: 'ir', fallback: false };
    for (const to of ['javascript', 'glsl']) {
      // A parameter of the root literal declared `any` or `value`.
      for (const op of ['Add', 'Max', 'Less'])
        for (const type of ['any', 'value'])
          expect(
            compiled(literal(op, type), { ...ir, to }).diagnostic?.message
          ).toMatch(`p: the input p of type ${type}`);
      // A parameter declared `any` in the signature of a user function.
      expect(compiled(['fa', 'x'], { ...ir, to }).diagnostic).toMatchObject({
        code: 'unsettled-shape',
        message: expect.stringContaining('the parameter p of fa'),
      });
      // An argument of type `any` for a real parameter.
      expect(
        compiled(['Function', ['fs', 'a'], ['Typed', 'a', { str: 'any' }]], {
          ...ir,
          to,
        }).diagnostic?.message
      ).toMatch('a: the input a of type any');
    }
    // A parameter declared `unknown` is a real.
    expect(compiled(literal('Add', 'unknown'), ir).run?.(1, 2)).toBe(3);
    // An input declared `any`, read as a free name, is refused.
    expect(compiled(['Add', 'kAny', 1], ir).diagnostic).toMatchObject(
      refusal('kAny')
    );
  });

  test('a parameter of a root function literal with no type is a real', () => {
    const r = compiled(['Function', ['If', ['Greater', 'u', 0], 'u', 0], 'u'], {
      profile: 'ir',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run?.(3)).toBe(3);
    expect(r.run?.(-3)).toBe(0);
  });

  test('a free name of a root function literal with no type is refused', () => {
    const json = ['Function', ['List', 'u', 'q'], 'u'];
    const existing = compiled(json, { fallback: false });
    expect(existing.diagnostic).toMatchObject(refusal('q'));
    expect(
      compiled(json, { profile: 'ir', fallback: false }).diagnostic
    ).toEqual(existing.diagnostic);
  });
});
