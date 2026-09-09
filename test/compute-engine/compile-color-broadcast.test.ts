import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A color-space conversion (`AsRgb`, `AsHsv`, `AsHsl`, `AsOklab`, `AsOklch`)
 * is `broadcastable`: a LIST of colors at its operand is one conversion per
 * element. Its definition also exempts a TUPLE from that broadcast, because a
 * numeric tuple written at a color position is one color in 0-1 sRGB.
 *
 * The compiled route has to honor both readings at once, and it cannot borrow
 * the generic element-wise broadcast to do it: the operand may be a list of
 * colors at any depth, and the color-aware dispatch `_SYS.bcastColor` is what
 * recurses to the leaves and answers the non-finite color at an absent
 * position. A color VALUE is an object carrying its space, so an ARRAY at this
 * operand is always a list.
 *
 * Regression context: 0.127.0 declined every one of these forms with a
 * fail-closed list-arithmetic diagnostic, and the lowering before it mapped a
 * single color value over its own channels.
 */

/**
 * Compile-time constant folding is off for every probe here. Several probes
 * are fully literal, and the compiler would otherwise evaluate them through
 * the INTERPRETER and emit one literal — erasing the lowering under test.
 */
const NO_FOLD = { constantFold: false } as const;

/** Compile for the JavaScript target. */
function js(ce: ComputeEngine, expr: any): any {
  return compile(ce.box(expr), NO_FOLD as any);
}

/**
 * The interpreter's color as a plain array of channels. A conversion answers a
 * typed color head (`Rgb(r, g, b)`), whose operands are the same three
 * channels a compiled color value carries in `c0, c1, c2` — the comparison
 * `color-argument-consistency.test.ts` makes with its `interpOklch` helper,
 * here for any output space.
 */
function channels(color: any): number[] {
  return color.ops!.map((op: any) => op.re);
}

/** The interpreter's list of colors as an array of channel arrays. */
function channelList(list: any): number[][] {
  return list.ops!.map((c: any) => channels(c));
}

/**
 * The two routes disagree in the third significant digit of a channel: the
 * compiled converters round to 8-bit integer channels inside `toRgb255`,
 * where the interpreter keeps the fractional 0-255 value. That predates this
 * work and is not what these tests are about. These tests are about WHICH
 * color reaches WHICH conversion, so the comparison allows one 8-bit step and
 * what it grows to in a derived channel: an absolute part for a 0-1 sRGB
 * channel, and a relative part for a hue, which runs to 360 and moves by a
 * fraction of a degree when the sRGB channels it is computed from are rounded.
 * The colorimetric agreement of the two routes is
 * `color-argument-consistency.test.ts`'s subject, not this file's.
 */
function expectChannelsClose(actual: unknown, expected: number[]): void {
  const got = compiledChannels(actual);
  expect(got).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++)
    expect(Math.abs(got[i] - expected[i])).toBeLessThanOrEqual(
      0.005 + 0.02 * Math.abs(expected[i])
    );
}

/**
 * The channels of a COMPILED color value, as the flat array the pins in this
 * file read before a compiled color carried its space.
 *
 * A compiled color is the object `{ space, c0, c1, c2, alpha }`; a compiled
 * LIST of colors is a JavaScript array of those objects. These tests are about
 * WHICH color reaches WHICH conversion, so they read the channels; the space
 * tag is `compile-color-value-representation.test.ts`'s subject.
 *
 * A plain array of numbers is the compiled value of a COMPONENTS head
 * (`ColorToColorspace`, declared `-> tuple`), and its channels are the array
 * itself.
 */
function compiledChannels(v: unknown): number[] {
  if (Array.isArray(v) && v.every((x) => typeof x === 'number'))
    return v as number[];
  const c = v as {
    space: string;
    c0: number;
    c1: number;
    c2: number;
    alpha?: number;
  };
  expect(typeof c).toBe('object');
  expect(typeof c.space).toBe('string');
  const channels = [c.c0, c.c1, c.c2];
  if (c.alpha !== undefined) channels.push(c.alpha);
  return channels;
}

describe('a color conversion over a possibly-list operand compiles', () => {
  test('AsRgb of a `broadcastable<color>` symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'broadcastable<color>');
    const compiled = js(ce, ['AsRgb', 'w']);
    expect(compiled.success).not.toBe(false);
    expect(compiled.code).toBe(
      '_SYS.bcastColor((_tv1) => _SYS.asRgb(_tv1), _.w)'
    );
  });

  test('AsRgb of a color built from a `broadcastable<number>` symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'broadcastable<number>');
    const compiled = js(ce, ['AsRgb', ['Hsv', 'u', 0.5, 0.5]]);
    expect(compiled.success).not.toBe(false);
    expect(compiled.code).toBe(
      '_SYS.bcastColor((_tv1) => _SYS.asRgb(_tv1), ' +
        '_SYS.bcast((_tv2, _tv3, _tv4) => _SYS.hsv(_tv2, _tv3, _tv4), ' +
        '_.u, 0.5, 0.5))'
    );
  });
});

describe('the compiled conversion answers what the interpreter answers', () => {
  test('a scalar argument is ONE color', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'broadcastable<number>');
    const run = js(ce, ['AsRgb', ['Hsv', 'u', 0.5, 0.5]]).run;

    const expected = channels(
      ce.box(['AsRgb', ['Hsv', 20, 0.5, 0.5]]).evaluate()
    );
    expect(expected).toHaveLength(3);
    expectChannelsClose(run({ u: 20 }), expected);
  });

  test('a list argument is one color per element', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'broadcastable<number>');
    const run = js(ce, ['AsRgb', ['Hsv', 'u', 0.5, 0.5]]).run;

    const hues = [20, 140, 260];
    const expected = channelList(
      ce
        .box(['AsRgb', ['Hsv', ['List', ...hues], 0.5, 0.5]])
        .evaluate()
    );
    expect(expected).toHaveLength(3);
    const actual = run({ u: hues });
    expect(actual).toHaveLength(3);
    for (let i = 0; i < 3; i++) expectChannelsClose(actual[i], expected[i]);
    // The three hues really are three different colors, so an accidental
    // scalar reading could not pass the comparison above.
    expect(actual[0]).not.toEqual(actual[1]);
  });

  test('a color VALUE bound to the symbol is converted whole', () => {
    // The lowering before 0.127.0 handed this operand to the generic
    // broadcast, which descends into any array — so one color, which IS an
    // array of three channels, was converted channel by channel and came back
    // as a list of three colors.
    const ce = new ComputeEngine();
    const one = js(ce, ['Hsv', 0.3, 0.5, 0.5]).run();
    // One color is one OBJECT carrying its space, not an array of channels.
    expect(one.space).toBe('oklch');

    const cw = new ComputeEngine();
    cw.declare('w', 'broadcastable<color>');
    const run = js(cw, ['AsRgb', 'w']).run;

    const actual = run({ w: one });
    expect(Array.isArray(actual)).toBe(false);
    expect(actual.space).toBe('rgb');
    expectChannelsClose(
      actual,
      channels(ce.box(['AsRgb', ['Hsv', 0.3, 0.5, 0.5]]).evaluate())
    );

    // A LIST of colors bound to the same symbol is one conversion per element.
    const asList = run({ w: [one, one] });
    expect(asList).toHaveLength(2);
    expectChannelsClose(asList[0], compiledChannels(actual));
    expectChannelsClose(asList[1], compiledChannels(actual));

    // A color STRING is one color too — the other value spelling a color
    // takes at the compiled boundary — and a list of them is a list.
    expectChannelsClose(
      run({ w: 'red' }),
      channels(ce.box(['AsRgb', { str: 'red' }]).evaluate())
    );
    expect(run({ w: ['red', 'red'] })).toHaveLength(2);

    // An empty array holds no channels, so it is the empty list, and a
    // broadcast over an empty operand answers `Nothing` in the interpreter —
    // NaN on this target, the same answer `_SYS.bcast` gives.
    expect(ce.box(['AsRgb', ['List']]).evaluate().symbol).toBe('Nothing');
    expect(run({ w: [] })).toBeNaN();
  });

  test('a literal list of colors compiles to the map', () => {
    const ce = new ComputeEngine();
    const expr = [
      'AsRgb',
      ['List', ['Hsv', 20, 0.5, 0.5], ['Hsv', 200, 0.5, 0.5]],
    ];
    const compiled = js(ce, expr);
    expect(compiled.code).toBe(
      '_SYS.bcastColor((_tv1) => _SYS.asRgb(_tv1), ' +
        '[_SYS.hsv(20, 0.5, 0.5), _SYS.hsv(200, 0.5, 0.5)])'
    );
    const expected = channelList(ce.box(expr).evaluate());
    const actual = compiled.run();
    expect(actual).toHaveLength(2);
    for (let i = 0; i < 2; i++) expectChannelsClose(actual[i], expected[i]);
  });

  test('a NESTED list of colors is one conversion per leaf', () => {
    // `broadcastable<color>` alone does not admit a list of lists, so the
    // proof is written with one wrapper per level of nesting
    // (`NESTED_COLOR_BROADCAST_TYPE`). `_SYS.bcastColor` recurses, and the
    // interpreter broadcasts to the same depth.
    const ce = new ComputeEngine();
    ce.declare('M', 'list<list<color>>');
    const compiled = js(ce, ['AsRgb', 'M']);
    expect(compiled.code).toBe(
      '_SYS.bcastColor((_tv1) => _SYS.asRgb(_tv1), _.M)'
    );

    const first = js(ce, ['Hsv', 20, 0.5, 0.5]).run();
    const second = js(ce, ['Hsv', 200, 0.5, 0.5]).run();
    const expected = ce
      .box([
        'AsRgb',
        [
          'List',
          ['List', ['Hsv', 20, 0.5, 0.5]],
          ['List', ['Hsv', 200, 0.5, 0.5]],
        ],
      ])
      .evaluate()
      .ops!.map((row: any) => channelList(row));

    const actual = compiled.run({ M: [[first], [second]] });
    expect(actual).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      expect(actual[i]).toHaveLength(1);
      expectChannelsClose(actual[i][0], expected[i][0]);
    }
  });

  test('an absent position inside the operand stays that position', () => {
    // An upstream broadcast spells an empty position `NaN`, so a ragged
    // operand reaches `_SYS.bcastColor` with a number and a color side by
    // side. Reading the FIRST element alone called the whole array one color.
    const ce = new ComputeEngine();
    ce.declare('u', 'broadcastable<number>');
    const run = js(ce, ['AsRgb', ['Hsv', 'u', 0.5, 0.5]]).run;

    const interpreted = ce
      .box(['AsRgb', ['Hsv', ['List', ['List'], ['List', 20]], 0.5, 0.5]])
      .evaluate();
    // The interpreter answers an `incompatible-type` error at the empty
    // position and a one-element list of colors at the other.
    expect(interpreted.ops![0].operator).toBe('Error');
    const secondPosition = channelList(interpreted.ops![1]);

    const actual = run({ u: [[], [20]] });
    expect(actual).toHaveLength(2);
    // The error position projects as the non-finite color — a color value
    // with NaN channels, the same projection `_SYS.rgb` gives a non-finite
    // channel.
    expect(compiledChannels(actual[0])).toEqual([NaN, NaN, NaN]);
    expect(actual[1]).toHaveLength(1);
    expectChannelsClose(actual[1][0], secondPosition[0]);
  });

  test('a colormap — a head whose own type is `color | list<color>`', () => {
    const ce = new ComputeEngine();
    const expr = ['AsRgb', ['Colormap', { str: 'viridis' }, 5]];
    const compiled = js(ce, expr);
    expect(compiled.success).not.toBe(false);
    const expected = channelList(ce.box(expr).evaluate());
    const actual = compiled.run();
    expect(actual).toHaveLength(5);
    for (let i = 0; i < 5; i++) expectChannelsClose(actual[i], expected[i]);
  });
});

describe('all five conversions broadcast the same way', () => {
  // `AsOklch` is the identity on ONE color value, but not on a color STRING
  // and not on a list, so it takes the map like the other four.
  test.each(['AsRgb', 'AsHsv', 'AsHsl', 'AsOklab', 'AsOklch'])(
    '%s of a list of colors',
    (head) => {
      const ce = new ComputeEngine();
      const expr = [
        head,
        ['List', ['Hsv', 20, 0.5, 0.5], ['Hsv', 200, 0.5, 0.5]],
      ];
      const compiled = js(ce, expr);
      expect(compiled.success).not.toBe(false);
      const expected = channelList(ce.box(expr).evaluate());
      const actual = compiled.run();
      expect(actual).toHaveLength(2);
      for (let i = 0; i < 2; i++) expectChannelsClose(actual[i], expected[i]);
    }
  );
});

describe('the shapes a color conversion still refuses', () => {
  test('a literal list of NUMBERS is not a list of colors', () => {
    const ce = new ComputeEngine();
    expect(() =>
      compile(ce.box(['AsRgb', ['List', 1, 0, 0]]), {
        ...NO_FOLD,
        fallback: false,
      } as any)
    ).toThrow(/A list is not a color/);
  });

  test('a collection whose elements are not colors fails closed', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    expect(() =>
      compile(ce.box(['AsRgb', 'L']), {
        ...NO_FOLD,
        fallback: false,
      } as any)
    ).toThrow(/does not prove a color at every element position/);
  });

  test('a SET of colors fails closed', () => {
    // The elements are colors, but `broadcastable<T>` admits an indexed
    // collection only: a set has no positions to map over, and the
    // interpreter does not broadcast one either.
    const ce = new ComputeEngine();
    ce.declare('S', 'set<color>');
    expect(() =>
      compile(ce.box(['AsRgb', 'S']), {
        ...NO_FOLD,
        fallback: false,
      } as any)
    ).toThrow(/does not prove a color at every element position/);
  });
});

describe('a color operand that is itself a conversion is CORRECT', () => {
  // A compiled color value carries its own space, and every helper that reads
  // a color goes through one `toOklch` that converts from that space. So a
  // conversion at a color position answers the interpreter's color instead of
  // being read as an OKLCh triple.
  //
  // These were DECLINE pins. Before the color value carried its space,
  // `AsRgb(AsRgb(Hsv(0.3, 0.5, 0.5)))` ran to `[0.714, 0, 0.369]` where the
  // interpreter answers `Rgb(0.5, 0.251, 0.25)`, so the static nesting failed
  // closed rather than answer a wrong color. Each pin below now records the
  // VALUE, which is what the decline was standing in for.
  const A = ['Hsv', 0.3, 0.5, 0.5];
  const B = ['Rgb', 1, 0, 0];

  test('AsRgb of AsRgb is AsRgb, channel for channel', () => {
    const ce = new ComputeEngine();
    // `toRgb255` scales an sRGB color directly rather than routing it back
    // through OKLCh, so the second conversion is exactly the identity.
    expect(js(ce, ['AsRgb', ['AsRgb', A]]).run()).toEqual(
      js(ce, ['AsRgb', A]).run()
    );
  });

  test('AsHsv of AsRgb recovers the HSV color', () => {
    const ce = new ComputeEngine();
    const nested = js(ce, ['AsHsv', ['AsRgb', A]]).run();
    expect(nested.space).toBe('hsv');
    // The same color as the direct conversion. The HUE does not come back as
    // the 0.3 degrees it was written with: `toRgb255` rounds to 8-bit sRGB
    // channels, and a hue that small is inside one 8-bit step, so both routes
    // answer 0. That is the documented third-digit difference between the
    // routes, and it is the same on the direct conversion.
    expect(nested).toEqual(js(ce, ['AsHsv', A]).run());
    // With a hue that survives the 8-bit step, the nested conversion agrees
    // with the interpreter channel for channel.
    const C = ['Hsv', 200, 0.5, 0.5];
    expectChannelsClose(
      js(ce, ['AsHsv', ['AsRgb', C]]).run(),
      channels(ce.box(['AsHsv', C] as any).evaluate())
    );
  });

  test('AsRgb of ColorToColorspace agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    const expr = ['AsRgb', ['ColorToColorspace', A, { str: 'rgb' }]];
    expectChannelsClose(
      js(ce, expr).run(),
      channels(ce.box(expr as any).evaluate())
    );
  });

  test('AsRgb of a list holding a conversion maps the list', () => {
    const ce = new ComputeEngine();
    const expr = ['AsRgb', ['List', ['AsRgb', A]]];
    const actual = js(ce, expr).run();
    expect(actual).toHaveLength(1);
    expectChannelsClose(
      actual[0],
      compiledChannels(js(ce, ['AsRgb', A]).run())
    );
  });

  test('ColorDelta of a converted operand is the delta of the color', () => {
    const ce = new ComputeEngine();
    // The conversion is a no-op on the color the delta measures, up to the
    // 8-bit sRGB rounding `toRgb255` takes on the way through the rgb space —
    // the documented third-digit difference between the routes.
    expect(js(ce, ['ColorDelta', ['AsRgb', A], B]).run()).toBeCloseTo(
      js(ce, ['ColorDelta', A, B]).run(),
      2
    );
  });

  test('ColorMix of a converted operand mixes the same colors', () => {
    const ce = new ComputeEngine();
    expectChannelsClose(
      js(ce, ['ColorMix', ['AsHsv', A], B, 0.5]).run(),
      compiledChannels(js(ce, ['ColorMix', A, B, 0.5]).run())
    );
  });

  test('ColorContrast, ContrastingColor, ColorToColorspace and ColorToString', () => {
    const ce = new ComputeEngine();
    expect(js(ce, ['ColorContrast', ['AsRgb', A], B]).run()).toBeCloseTo(
      js(ce, ['ColorContrast', A, B]).run(),
      3
    );
    expectChannelsClose(
      js(ce, ['ContrastingColor', ['AsRgb', A]]).run(),
      compiledChannels(js(ce, ['ContrastingColor', A]).run())
    );
    // `ColorToColorspace` answers COMPONENTS — a plain array of channels, not
    // a color value — on both sides of this comparison.
    expectChannelsClose(
      js(ce, ['ColorToColorspace', ['AsRgb', A], { str: 'hsl' }]).run(),
      compiledChannels(js(ce, ['ColorToColorspace', A, { str: 'hsl' }]).run())
    );
    expect(js(ce, ['ColorToString', ['AsRgb', A]]).run()).toBe(
      js(ce, ['ColorToString', A]).run()
    );
  });

  test('a color VALUE at those same positions still compiles', () => {
    const ce = new ComputeEngine();
    expect(js(ce, ['AsRgb', A]).code).toBe(
      '_SYS.asRgb(_SYS.hsv(0.3, 0.5, 0.5))'
    );
    expect(js(ce, ['ColorDelta', A, B]).code).toBe(
      '_SYS.colorDelta(_SYS.hsv(0.3, 0.5, 0.5), _SYS.rgb(1, 0, 0))'
    );
    expect(js(ce, ['ColorMix', A, B, 0.5]).code).toBe(
      '_SYS.colorMix(_SYS.hsv(0.3, 0.5, 0.5), _SYS.rgb(1, 0, 0), 0.5)'
    );
  });

  test('a conversion of a `broadcastable<color>` symbol still compiles', () => {
    // A variable may hold the output of a conversion at run time. The value
    // now says which space it is in, so the map is sound for either.
    const ce = new ComputeEngine();
    ce.declare('w', 'broadcastable<color>');
    expect(js(ce, ['AsRgb', 'w']).code).toBe(
      '_SYS.bcastColor((_tv1) => _SYS.asRgb(_tv1), _.w)'
    );
  });
});

describe('a color STRING is one color, not a list of grapheme clusters', () => {
  // The single-collection fan-out gate treats a string as a finite indexed
  // collection, so it used to intercept these two and decline for want of a
  // `broadcastUnary` lowering — while the conversion's own codegen reads the
  // string as one CSS color and compiles it.
  test('a literal color string compiles and runs', () => {
    const ce = new ComputeEngine();
    const compiled = js(ce, ['AsRgb', { str: 'red' }]);
    expect(compiled.code).toBe('_SYS.asRgb("red")');
    expectChannelsClose(
      compiled.run(),
      channels(ce.box(['AsRgb', { str: 'red' }]).evaluate())
    );
  });

  test('a `string`-declared symbol compiles to the direct conversion', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'string');
    expect(js(ce, ['AsOklch', 's']).code).toBe('_SYS.asOklch(_.s)');
    expect(js(ce, ['AsRgb', 's']).code).toBe('_SYS.asRgb(_.s)');
  });
});

describe('a numeric tuple is still ONE color, not three', () => {
  test('AsRgb of a literal tuple keeps the direct conversion', () => {
    const ce = new ComputeEngine();
    const compiled = js(ce, ['AsRgb', ['Tuple', 1, 0, 0]]);
    expect(compiled.code).toBe('_SYS.asRgb(_SYS.rgb(1, 0, 0))');
    expectChannelsClose(compiled.run(), [1, 0, 0]);
  });
});

describe('the reported witness', () => {
  // `AsRgb(Hsv(10u + 12, u/5 + 0.87, 0.8 - 0.4u))` — the color of a Desmos
  // document, where `u` stands for a user function whose declared return type
  // admits a collection while the value it produces is one number.
  const witness = [
    'AsRgb',
    [
      'Hsv',
      ['Add', ['Multiply', 10, 'u'], 12],
      ['Add', ['Divide', 'u', 5], 0.87],
      ['Subtract', 0.8, ['Multiply', 0.4, 'u']],
    ],
  ];

  test('compiles and runs for a scalar argument', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'broadcastable<number>');
    const compiled = js(ce, witness);
    expect(compiled.success).not.toBe(false);

    const cs = new ComputeEngine();
    const expected = channels(
      cs
        .box([
          'AsRgb',
          [
            'Hsv',
            ['Add', ['Multiply', 10, 0.4], 12],
            ['Add', ['Divide', 0.4, 5], 0.87],
            ['Subtract', 0.8, ['Multiply', 0.4, 0.4]],
          ],
        ])
        .evaluate()
    );
    expectChannelsClose(compiled.run({ u: 0.4 }), expected);
  });
});
