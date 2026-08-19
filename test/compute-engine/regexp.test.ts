import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Strings Phase 3 — regular expressions.
 *
 * Plan: `docs/STRING_ROADMAP.md`.
 *
 * The dialect is the HOST's, by user ruling 2026-08-17: no feature subset, no
 * caps. The tests that pin backreferences and lookbehind are there because
 * those are exactly what the rejected alternative (a non-backtracking engine)
 * could not have expressed — they are the ruling's payoff, so they are worth
 * a regression test rather than being assumed.
 */

const ce = new ComputeEngine();

const RE = (pattern: string, flags?: string) =>
  flags === undefined
    ? ['RegExp', { str: pattern }]
    : ['RegExp', { str: pattern }, { str: flags }];

const ev = (expr: any) => ce.box(expr).evaluate();
const field = (match: any, key: string) => ev(['At', match, { str: key }]);
/** The symbol a boolean/`Nothing` result names. `toString()` quotes symbols,
 * so comparing against `'True'` compares the wrong thing. */
const sym = (expr: any) => ev(expr).symbol;

describe('the `regexp` type', () => {
  test('is a value, but neither a scalar nor a collection', () => {
    expect(ce.type('regexp').toString()).toBe('regexp');
    expect(ce.type('regexp').matches('value')).toBe(true);
    // Not a scalar: it has no numeric or boolean reading, and nothing
    // broadcasts over it component-wise.
    expect(ce.type('regexp').matches('scalar')).toBe(false);
    // Not a collection: a pattern is not a sequence of indexable elements,
    // which is what keeps it clear of the hidden-element-type machinery.
    expect(ce.type('regexp').matches('collection')).toBe(false);
  });

  test('is disjoint from `string` in both directions', () => {
    // A pattern is not text. This is what lets `IsMatch(s, p)` state in its
    // signature that a plain string may not be passed where a pattern is
    // meant.
    expect(ce.type('regexp').matches('string')).toBe(false);
    expect(ce.type('string').matches('regexp')).toBe(false);
  });

  test('binds no kind-preserving signature (the narrowing-lie census)', () => {
    // A new primitive can turn an existing `(T) -> T` signature into a lie by
    // binding where it never used to. `regexp` is neither collection nor
    // number nor function, so there is nothing for it to bind.
    for (const t of [
      'indexed_collection',
      'list',
      'set',
      'number',
      'boolean',
      'character',
      'function',
    ])
      expect(ce.type('regexp').matches(t)).toBe(false);
  });
});

describe('RegExp — construction and validation', () => {
  test('a literal pattern types `regexp` and is the value itself', () => {
    const r = ce.box(RE('[0-9]+'));
    expect(r.type.toString()).toBe('regexp');
    expect(r.evaluate().toString()).toBe('RegExp("[0-9]+")');
  });

  test('an invalid literal pattern is an error VALUE, at canonicalization', () => {
    // Caught where it was written, rather than at the first match.
    const r = ce.box(RE('[0-9'));
    expect(r.type.toString()).toBe('error');
    expect(r.toString()).toContain('not a valid regular expression');
  });

  test('the stateful flags are refused with a diagnostic that says why', () => {
    // `g`/`y` carry mutable `lastIndex` on the compiled object, so the same
    // value would answer differently depending on what it matched last.
    for (const f of ['g', 'y']) {
      const r = ce.box(RE('a', f));
      expect(r.type.toString()).toBe('error');
      expect(r.toString()).toContain('mutable match state');
    }
    expect(ce.box(RE('a', 'Q')).toString()).toContain('unknown');
  });

  test('flags that do not carry state are accepted', () => {
    for (const f of ['i', 'm', 's', 'd', 'u'])
      expect(ce.box(RE('a', f)).type.toString()).toBe('regexp');
  });
});

describe('IsMatch', () => {
  test('answers a boolean', () => {
    expect(sym(['IsMatch', { str: 'abc123' }, RE('[0-9]+')])).toBe('True');
    expect(sym(['IsMatch', { str: 'abc' }, RE('[0-9]+')])).toBe('False');
  });

  test('honors flags', () => {
    expect(sym(['IsMatch', { str: 'ABC' }, RE('a+', 'i')])).toBe('True');
  });

  test('a plain string where a pattern is required is a type error', () => {
    // The disjointness of `regexp` and `string`, observable. Without it,
    // every string call site would be silently regex-sensitive and `"a.c"`
    // would stop meaning what it says.
    expect(ev(['IsMatch', { str: 'a' }, { str: 'a' }]).toString()).toContain(
      'incompatible-type'
    );
  });

  test('the same value answers the same way twice (no leaked match state)', () => {
    const call = ['IsMatch', { str: 'aaa' }, RE('a')];
    expect(sym(call)).toBe('True');
    expect(sym(call)).toBe('True');
  });
});

describe('StringMatch — the match record', () => {
  test('reports the matched text and its captures', () => {
    const m = ['StringMatch', { str: 'abc123' }, RE('[0-9]+')];
    expect(field(m, 'match').toString()).toBe('"123"');
  });

  test('no match is `Nothing`', () => {
    expect(sym(['StringMatch', { str: 'abc' }, RE('[0-9]+')])).toBe('Nothing');
  });

  test('`Slice(subject, m.range)` returns the matched text', () => {
    // The composition law the `range` field exists for. It only holds if the
    // offsets are GRAPHEME CLUSTER indices — a host regex reports code units,
    // and every other string operator in the library indexes by cluster.
    for (const [subject, pattern] of [
      ['abc123', '[0-9]+'],
      ['héllo wörld', 'w[a-zö]+'],
      ['a👍b👍c', '👍'],
    ]) {
      const m = ['StringMatch', { str: subject }, RE(pattern)];
      const sliced = ev(['Slice', { str: subject }, ['At', m, { str: 'range' }]]);
      expect(sliced.toString()).toBe(field(m, 'match').toString());
    }
  });

  test('a multi-code-point cluster does not shift the reported span', () => {
    // The family emoji is ONE cluster made of several code points; a
    // code-unit offset would put `y` at the wrong index.
    const s = 'x👨‍👩‍👧y';
    expect(ev(['Length', { str: s }]).toString()).toBe('3');
    const m = ['StringMatch', { str: s }, RE('y')];
    expect(ev(['Slice', { str: s }, ['At', m, { str: 'range' }]]).toString()).toBe(
      '"y"'
    );
  });

  test('numbered and named captures both reach the caller', () => {
    const m = [
      'StringMatch',
      { str: '2026-08-17' },
      RE('(?<y>[0-9]{4})-(?<m>[0-9]{2})'),
    ];
    expect(field(m, 'groups').toString()).toBe('["2026","08"]');
    expect(
      ev(['At', ['At', m, { str: 'names' }], { str: 'y' }]).toString()
    ).toBe('"2026"');
  });
});

describe('StringMatchAll', () => {
  test('returns every non-overlapping match', () => {
    const all = ev(['StringMatchAll', { str: 'a1b22c333' }, RE('[0-9]+')]);
    expect(all.count).toBe(3);
    expect(
      [...all.each()].map((m) => ce.box(['At', m, { str: 'match' }]).evaluate().toString())
    ).toEqual(['"1"', '"22"', '"333"']);
  });

  test('a pattern that can match nothing terminates', () => {
    // An empty match does not advance `lastIndex` on its own, so the loop
    // would spin forever without stepping past it — by one code POINT, so a
    // surrogate pair is never split.
    const all = ev(['StringMatchAll', { str: 'bab' }, RE('a*')]);
    expect(all.count).toBeGreaterThan(0);
    expect(Number.isFinite(all.count!)).toBe(true);
  });
});

describe('the host dialect is the whole dialect (user ruling 2026-08-17)', () => {
  test('backreferences work', () => {
    // Not expressible in a non-backtracking engine — this is what the ruling
    // bought.
    expect(sym(['IsMatch', { str: 'abab' }, RE('(ab)\\1')])).toBe('True');
    expect(sym(['IsMatch', { str: 'abcd' }, RE('(ab)\\1')])).toBe('False');
  });

  test('lookbehind and lookahead work', () => {
    expect(sym(['IsMatch', { str: 'price: 42' }, RE('(?<=price: )[0-9]+')])).toBe(
      'True'
    );
    expect(sym(['IsMatch', { str: 'foo.txt' }, RE('foo(?=\\.txt)')])).toBe('True');
  });

  test('matching is code-point aware', () => {
    // A Unicode mode is always added, so a character class does not operate
    // on UTF-16 code units.
    expect(sym(['IsMatch', { str: '👍' }, RE('^.$')])).toBe('True');
  });
});

describe('StringSplit and StringReplace — regex arms', () => {
  test('splitting on a pattern matches host semantics', () => {
    expect(
      ev(['StringSplit', { str: 'a1b22c' }, RE('[0-9]+')]).toString()
    ).toBe('["a","b","c"]');
    expect(ev(['StringSplit', { str: 'a,b;c' }, RE('[,;]')]).toString()).toBe(
      '["a","b","c"]'
    );
  });

  test('the literal and whitespace arms are unaffected', () => {
    expect(ev(['StringSplit', { str: 'a-b-c' }, { str: '-' }]).toString()).toBe(
      '["a","b","c"]'
    );
    expect(ev(['StringSplit', { str: 'a b  c' }]).toString()).toBe(
      '["a","b","c"]'
    );
  });

  test('replacing on a pattern, with and without a count', () => {
    expect(
      ev([
        'StringReplace',
        { str: 'a1b22c' },
        RE('[0-9]+'),
        { str: '#' },
      ]).toString()
    ).toBe('"a#b#c"');
    expect(
      ev([
        'StringReplace',
        { str: 'a1b2c3' },
        RE('[0-9]'),
        { str: '#' },
        2,
      ]).toString()
    ).toBe('"a#b#c3"');
    // The literal-target arm is untouched.
    expect(
      ev([
        'StringReplace',
        { str: 'aXbXc' },
        { str: 'X' },
        { str: '-' },
      ]).toString()
    ).toBe('"a-b-c"');
  });

  test('a FUNCTION replacement receives the match record', () => {
    // Deliberately uses letters: `ToUpperCase` of a digit is the identity, so
    // a digit subject could not tell a working callback from an ignored one.
    expect(
      ev([
        'StringReplace',
        { str: 'ab cd' },
        RE('[a-z]+'),
        ['Function', ['ToUpperCase', ['At', 'm', { str: 'match' }]], 'm'],
      ]).toString()
    ).toBe('"AB CD"');
    // The callback can read captures, which is the reason it exists.
    expect(
      ev([
        'StringReplace',
        { str: '2026-08' },
        RE('(?<y>[0-9]{4})-(?<m>[0-9]{2})'),
        [
          'Function',
          ['At', ['At', 'm', { str: 'names' }], { str: 'm' }],
          'm',
        ],
      ]).toString()
    ).toBe('"08"');
  });
});

describe('a match that is not whole clusters reports no span', () => {
  test('a component of a multi-cluster emoji has `match` but no `range`', () => {
    // A host regex can match a code point that is only PART of a
    // user-perceived character. Widening the span outward to the containing
    // cluster would make `Slice(subject, m.range)` return the whole family
    // emoji while `match` is the single component — silently breaking the
    // composition law the field exists for. There is no honest span, so the
    // key is absent.
    const s = '👨‍👩‍👧';
    const m = ['StringMatch', { str: s }, RE('👩')];
    expect(field(m, 'match').toString()).toBe('"👩"');
    expect(field(m, 'range').symbol).toBe('Missing');
  });

  test('a cluster-aligned match still reports its span', () => {
    expect(field(['StringMatch', { str: 'abc' }, RE('b')], 'range').toString()).toBe(
      '[2]'
    );
  });
});

describe('splitting matches the host exactly, zero-width separators included', () => {
  // The host splits at a zero-width match (`"ab".split(/(?=b)/)` is
  // `["a","b"]`) but NOT where doing so would make no progress, and not at
  // the very end of the subject. Getting either rule wrong is invisible on
  // ordinary separators and obvious on these.
  test.each([
    ['ab', '(?=b)'],
    ['a1b', '(?=[0-9])'],
    ['a1b22c', '[0-9]+'],
    ['ab', 'a*'],
    ['ab', '(?:)'],
    ['ab', '\\b'],
    ['', 'a'],
    ['aaa', 'a'],
    ['abc', 'x'],
    ['👍a👍', 'a'],
    ['ab', '^'],
    ['ab', '$'],
    ['a,b;c', '[,;]'],
    ['a  b', '\\s+'],
  ])('split %p on /%s/ agrees with the host', (subject, pattern) => {
    const ours = [...ev(['StringSplit', { str: subject }, RE(pattern)]).each()].map(
      (x) => x.string
    );
    expect(ours).toEqual(subject.split(new RegExp(pattern, 'u')));
  });
});

describe('a non-string flags operand is refused, not read as "no flags"', () => {
  test('RegExp("a", 1) is an error value', () => {
    // It used to type `regexp` and match case-sensitively — a wrong ANSWER
    // rather than a refusal.
    const r = ce.box(['RegExp', { str: 'a' }, 1]);
    expect(r.type.toString()).toBe('error');
    expect(r.toString()).toContain('flags must be a string');
  });
});

describe('a compiled pattern is never shared while it carries scan state', () => {
  test('a replacement callback may re-enter the SAME pattern', () => {
    // A `g`-flagged host object keeps its scan position in `lastIndex`. When
    // one was cached and shared, this hung forever: the inner call reset
    // `lastIndex` under the outer loop, which then restarted from the top.
    // Reachable from ordinary user code, which is why it is pinned here.
    const inner = [
      'StringReplace',
      ['At', 'm', { str: 'match' }],
      RE('[a-z]+'),
      { str: 'Z' },
    ];
    expect(
      ev([
        'StringReplace',
        { str: 'ab cd ef' },
        RE('[a-z]+'),
        ['Function', inner, 'm'],
      ]).toString()
    ).toBe('"Z Z Z"');
  });

  test('a callback may re-enter through StringMatchAll too', () => {
    const inner = [
      'At',
      ['At', ['StringMatchAll', ['At', 'm', { str: 'match' }], RE('[a-z]')], 1],
      { str: 'match' },
    ];
    expect(
      ev([
        'StringReplace',
        { str: 'ab cd' },
        RE('[a-z]+'),
        ['Function', inner, 'm'],
      ]).toString()
    ).toBe('"a c"');
  });
});

describe('patterns that can match nothing still terminate', () => {
  // Each of these advances only because the walk steps past an empty match
  // by one code POINT. Without that they spin; with a code UNIT step they
  // would split a surrogate pair.
  test.each(['a*', '(?:)', '\\b', '^', '$'])(
    'StringMatchAll over /%s/ finds exactly the host\'s matches',
    (pattern) => {
      // Pinned to the HOST's count, not merely "finite and positive": a walk
      // that regressed to a different wrong stride — one code unit, or
      // skipping a position — would still be finite and positive and would
      // sail past a weaker assertion.
      const all = ev(['StringMatchAll', { str: 'ab' }, RE(pattern)]);
      expect(all.count).toBe(
        [...'ab'.matchAll(new RegExp(pattern, 'gu'))].length
      );
    }
  );

  test('split and replace terminate on an empty-matching pattern', () => {
    expect(ev(['StringSplit', { str: 'ab' }, RE('a*')]).toString()).toBe(
      '["","b"]'
    );
    expect(
      ev(['StringReplace', { str: 'ab' }, RE('(?:)'), { str: '-' }]).toString()
    ).toBe('"-a-b-"');
  });

  test('an empty subject follows the host split rule', () => {
    // The host returns `[]` when the separator matches the empty string and
    // `[""]` when it does not — a rule the scan itself cannot express, since
    // it is guarded by `scan < subject.length` and never runs here.
    for (const pattern of ['a*', '(?:)', '^', '$', 'x?', 'a', 'a|', '(?!a)']) {
      const ours = [...ev(['StringSplit', { str: '' }, RE(pattern)]).each()].map(
        (x) => x.string
      );
      expect(ours).toEqual(''.split(new RegExp(pattern, 'u')));
    }
    expect(
      ev(['StringMatchAll', { str: '' }, RE('a*')]).count
    ).toBe([...''.matchAll(/a*/gu)].length);
  });

  test('the empty-match step does not split a surrogate pair', () => {
    // Two astral characters: positions before each and after the last.
    expect(ev(['StringMatchAll', { str: '👍👍' }, RE('a*')]).count).toBe(3);
  });
});

describe('a capture that did not participate keeps its slot', () => {
  test('`groups` stays positional across alternatives', () => {
    // `Nothing` is the empty-sequence marker and is ERASED from a `List`, so
    // using it collapsed the slot: `(a)|(b)` reported a ONE-element `groups`
    // for both subjects, and a caller could not tell which alternative fired
    // — destroying exactly the information numbered captures carry.
    const forA = ['StringMatch', { str: 'a' }, RE('(a)|(b)')];
    const forB = ['StringMatch', { str: 'b' }, RE('(a)|(b)')];
    expect(field(forA, 'groups').count).toBe(2);
    expect(field(forB, 'groups').count).toBe(2);
    expect(ev(['At', ['At', forA, { str: 'groups' }], 1]).toString()).toBe('"a"');
    expect(ev(['At', ['At', forA, { str: 'groups' }], 2]).symbol).toBe('Missing');
    expect(ev(['At', ['At', forB, { str: 'groups' }], 1]).symbol).toBe('Missing');
    expect(ev(['At', ['At', forB, { str: 'groups' }], 2]).toString()).toBe('"b"');
  });

  test('a named group that did not participate keeps its KEY', () => {
    const m = ['StringMatch', { str: 'b' }, RE('(?<x>a)|(?<y>b)')];
    expect(ev(['At', ['At', m, { str: 'names' }], { str: 'x' }]).symbol).toBe(
      'Missing'
    );
    expect(ev(['At', ['At', m, { str: 'names' }], { str: 'y' }]).toString()).toBe(
      '"b"'
    );
  });
});

describe('a bad FLAG is reported as a flag error', () => {
  test('`x` is not a host flag and says so', () => {
    // `x` (free-spacing) is an unshipped proposal. Letting it through the
    // gate sent it to the host, which threw, and the user got "not a valid
    // regular expression" — blaming a perfectly good PATTERN for a bad flag.
    expect(ce.box(RE('a', 'x')).toString()).toContain(
      'unknown regular-expression flag'
    );
  });
});

describe('a computed pattern or flag is resolved at evaluation', () => {
  test('a pattern built at runtime matches', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('p', 'string');
    ce2.assign('p', ce2.string('[0-9]+'));
    expect(
      ce2.box(['IsMatch', { str: 'a1' }, ['RegExp', 'p']]).evaluate().symbol
    ).toBe('True');
    expect(
      ev(['IsMatch', { str: 'a1' }, ['RegExp', ['Join', { str: '[0-9]' }, { str: '+' }]]])
        .symbol
    ).toBe('True');
  });

  test('computed FLAGS stay inert rather than erroring at canonicalization', () => {
    // Their text is not known yet, exactly like a computed pattern's. Only an
    // operand that CANNOT be a string is an error.
    const withComputedFlags = ['RegExp', { str: 'a' }, ['Join', { str: 'i' }]];
    expect(ce.box(withComputedFlags).type.toString()).toBe('regexp');
    expect(sym(['IsMatch', { str: 'A' }, withComputedFlags])).toBe('True');
    expect(ce.box(['RegExp', { str: 'a' }, 1]).type.toString()).toBe('error');
  });

  test('an unresolvable pattern leaves the call symbolic', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('q', 'string');
    expect(
      ce2.box(['IsMatch', { str: 'a1' }, ['RegExp', 'q']]).evaluate().operator
    ).toBe('IsMatch');
  });
});

describe('a bad flag SET is reported against the flags', () => {
  test('a repeated flag and the u/v combination each say what is wrong', () => {
    // The host rejects both. Letting them reach it surfaced "not a valid
    // regular expression" — blaming the PATTERN for a bad flag.
    expect(ce.box(RE('a', 'ii')).toString()).toContain("the flag 'i' is repeated");
    expect(ce.box(RE('a', 'uv')).toString()).toContain('alternative Unicode modes');
    // A legitimate combination is untouched.
    expect(ce.box(RE('a', 'im')).type.toString()).toBe('regexp');
    expect(ce.box(RE('a', 'iu')).type.toString()).toBe('regexp');
  });
});

describe('a `regexp` is a value (D9)', () => {
  test('equal pattern and flags means equal value, and equal hash', () => {
    const a = ce.box(RE('a+'));
    const b = ce.box(RE('a+'));
    expect(a.isSame(b)).toBe(true);
    expect(a.hash).toBe(b.hash);
  });

  test('flags are part of the identity', () => {
    expect(ce.box(RE('a+')).isSame(ce.box(RE('a+', 'i')))).toBe(false);
  });

  test('round-trips through MathJSON', () => {
    // Serialized as an ordinary `RegExp("…")` call, never as a raw literal:
    // the raw form is one parser's convenience, and MathJSON must be
    // parser-independent.
    const a = ce.box(RE('a+'));
    const round = ce.box(JSON.parse(JSON.stringify(a.json)));
    expect(round.isSame(a)).toBe(true);
  });
});

describe('compiling to JavaScript', () => {
  // The dialect ruling is what makes parity here free: compiled code and the
  // interpreter hand the SAME pattern text to the SAME `RegExp`
  // implementation, so there is no second engine to diverge from.
  const ce2 = new ComputeEngine();
  ce2.declare('s', 'string');
  const run = (expr: any, subject: string) => {
    const r: any = compile(ce2.box(expr), {
      fallback: false,
      constantFold: false,
    } as any);
    return r.success ? r.run({ s: subject }) : 'DECLINED';
  };
  const declines = (expr: any) => {
    const r: any = compile(ce2.box(expr), {
      fallback: true,
      constantFold: false,
    } as any);
    return r.success !== true;
  };

  test('IsMatch agrees with the interpreter', () => {
    for (const [subject, pattern, flags] of [
      ['ab12', '[0-9]+', undefined],
      ['abc', '[0-9]+', undefined],
      ['AAA', 'a+', 'i'],
    ] as [string, string, string | undefined][]) {
      const interpreted =
        ev(['IsMatch', { str: subject }, RE(pattern, flags)]).symbol === 'True';
      expect(run(['IsMatch', 's', RE(pattern, flags)], subject)).toBe(
        interpreted
      );
    }
  });

  test('StringReplace with a pattern agrees with the interpreter', () => {
    for (const [subject, pattern] of [
      ['a1b22c', '[0-9]+'],
      ['abc', 'x'],
    ]) {
      const interpreted = ev([
        'StringReplace',
        { str: subject },
        RE(pattern),
        { str: '#' },
      ]).string;
      expect(
        run(['StringReplace', 's', RE(pattern), { str: '#' }], subject)
      ).toBe(interpreted);
    }
  });

  test('the offset-reporting surface fails closed', () => {
    // A coverage boundary, NOT a dialect one: `StringMatch`/`StringMatchAll`
    // report grapheme-cluster spans, and a function replacement receives the
    // same record. Compiled code has neither, so lowering them would report
    // code-unit offsets that disagree with the interpreter.
    expect(declines(['StringMatch', 's', RE('a')])).toBe(true);
    expect(declines(['StringMatchAll', 's', RE('a')])).toBe(true);
    expect(
      declines(['StringReplace', 's', RE('a'), ['Function', { str: 'Z' }, 'm']])
    ).toBe(true);
  });

  test('compiled and interpreted replacement agree, shape by shape', () => {
    // `_SYS.rerep` and the interpreter's `replaceByPattern` are two separate
    // implementations of one algorithm, which is the classic place for a
    // silent divergence. Zero-width patterns, surrogate pairs, a `count`
    // limit, a combining mark and CRLF are where they would drift first.
    const cases: [string, string, string | undefined, number | undefined][] = [
      ['a1b22c', '[0-9]+', undefined, undefined],
      ['a1b2c3', '[0-9]', undefined, 2],
      ['abc', 'x', undefined, undefined],
      ['ab', 'a*', undefined, undefined],
      ['ab', '(?:)', undefined, undefined],
      ['ab', '$', undefined, undefined],
      ['ab', '^', undefined, undefined],
      ['ab', '\\b', undefined, undefined],
      ['', 'a*', undefined, undefined],
      ['AaA', 'a', 'i', undefined],
      ['👍a👍', 'a', undefined, undefined],
      ['👍👍', 'a*', undefined, undefined],
      ['aaa', 'a', undefined, 1],
      ['q\u0301b', 'q', undefined, undefined],
      ['a\r\nb', '\\n', undefined, undefined],
    ];
    for (const [subject, pattern, flags, count] of cases) {
      const interpreted: any[] = [
        'StringReplace',
        { str: subject },
        RE(pattern, flags),
        { str: '#' },
      ];
      const compiled: any[] = [
        'StringReplace',
        's',
        RE(pattern, flags),
        { str: '#' },
      ];
      if (count !== undefined) {
        interpreted.push(count);
        compiled.push(count);
      }
      expect(run(compiled, subject)).toBe(ev(interpreted).string);
    }
  });

  test('a pattern whose TEXT is hostile to source embedding is safe', () => {
    // The pattern is embedded as a JS STRING literal passed to `new RegExp`,
    // not as a `/.../` literal, so a slash is harmless — but a quote,
    // backslash, backtick, `${}` or U+2028 would each break a different
    // escaping scheme if the wrong one were used.
    for (const [subject, pattern] of [
      ['a"b', '"'],
      ['a\\b', '\\\\'],
      ['a/b', '/'],
      ['a`b', '`'],
      ['a${x}b', '\\$\\{x\\}'],
      ['a\u2028b', '\u2028'],
    ]) {
      expect(run(['StringReplace', 's', RE(pattern), { str: '#' }], subject)).toBe(
        ev(['StringReplace', { str: subject }, RE(pattern), { str: '#' }]).string
      );
    }
  });

  test('compiled matching conditions its input like the interpreter', () => {
    // The interpreter NFC-normalizes and repairs lone surrogates at boxing.
    // Without the same conditioning, the NFD spelling of `é` matched `/é/`
    // interpreted and NOT compiled — a silent divergence on real text.
    for (const subject of ['\u00e9', 'e\u0301']) {
      expect(run(['IsMatch', 's', RE('\u00e9')], subject)).toBe(
        ev(['IsMatch', { str: subject }, RE('\u00e9')]).symbol === 'True'
      );
    }
  });

  test('compiled code rejects a non-string subject instead of coercing it', () => {
    const r: any = compile(ce2.box(['IsMatch', 's', RE('a')]), {
      fallback: false,
      constantFold: false,
    } as any);
    expect(r.success).toBe(true);
    // `test()` would coerce 42 to "42" and answer; the interpreter would not.
    expect(() => r.run({ s: 42 })).toThrow();
  });

  test('the compiled replacement normalizes its joined result', () => {
    // Re-segmentation happens once, when the pieces are joined: replacing `q`
    // with `e` in `q` + U+0301 must give the single character `é` (U+00E9).
    // Without a `.normalize()` on the join the compiled result was `e` +
    // U+0301 — two code points, a different `Length()` from the interpreter's.
    const subject = 'q\u0301';
    const compiled = run(['StringReplace', 's', RE('q'), { str: 'e' }], subject);
    expect(compiled).toBe(
      ev(['StringReplace', { str: subject }, RE('q'), { str: 'e' }]).string
    );
    expect(compiled).toBe('\u00e9');
  });

  test('the RegExp decline names only operators that actually lower', () => {
    // The message is advice a user follows, so naming an operator with no
    // lowering sends them into a second failure. `StringSplit` has none —
    // regex arm or otherwise — so it must not appear, and this test fails if
    // it is ever added back to the message without a lowering to match.
    const r: any = compile(ce2.box(['RegExp', { str: 'a' }]), {
      fallback: true,
      constantFold: false,
    } as any);
    expect(r.success).toBe(false);
    const message = String(r.error ?? r.diagnostic ?? '');
    if (message) {
      expect(message).not.toContain('StringSplit');
      expect(message).toContain('IsMatch');
    }
    // The premise the message rests on: `StringSplit` really does decline.
    expect(declines(['StringSplit', 's', RE('a')])).toBe(true);
  });

  test('a COMPUTED pattern fails closed', () => {
    // Its text is not known at compile time, and emitting `new RegExp(<expr>)`
    // would move a construction error the interpreter reports at
    // canonicalization into the compiled artifact.
    expect(declines(['IsMatch', 's', ['RegExp', 's']])).toBe(true);
  });
});
