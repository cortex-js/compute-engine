import { validateSymbol } from '../../../src/math-json/symbols';
import { engine as ce, exprToString, latex } from '../../utils';

function symbol(expr) {
  return exprToString(ce.symbol(expr));
}

function parse(s) {
  return ce.parse(s);
}

// for (let i = 0; i < 0x10ffff; i++) {
//   const s = String.fromCodePoint(i);
//   if (/\p{Emoji}/u.test(s) && /\p{XIDC}/s.test(s)) {
//     console.info(s, `U+${i.toString(16).toUpperCase()}`);
//   }
// }

describe('SYMBOLS', () => {
  describe('validateSymbol()', () => {
    test('Valid symbols', () => {
      expect(validateSymbol('x')).toEqual('valid');
      expect(validateSymbol('ab')).toEqual('valid');
      expect(validateSymbol('θ')).toEqual('valid');
      expect(validateSymbol('ϑ')).toEqual('valid');
      expect(validateSymbol('_')).toEqual('valid');
      expect(validateSymbol('_a')).toEqual('valid');
      expect(validateSymbol('o_o')).toEqual('valid');
      expect(validateSymbol('café')).toEqual('valid');

      // Catalan interpunct is valid in a symbol and not
      // considered punctuation (also used in French for "écriture inclusive")
      expect(validateSymbol('col·lecció')).toEqual('valid');

      // Oh boy. "8" is an emoji. Specifically, it has the emoji property
      // "Emoji" and the emoji property "Emoji_Component" (EC), but
      // it is not a "Emoji_Presentation" (EP). It doesn't
      // have "Extended_Pictographic" either.
      // This is because the emoji 8️⃣ (8 keycap) is a sequence of two
      // code points: 8 (base), U+FE0F (variation selector-16) and
      // U+20E3 (combining enclosing keycap).
      expect(validateSymbol('a8')).toEqual('valid');
      expect(validateSymbol('8️⃣')).toEqual('valid');
      expect(validateSymbol('a8️⃣')).toEqual('unexpected-mixed-emoji');

      // Emoji with skin tone and ZWJ
      // Man            U+1F468
      // Skin1-2        U+1F3FB
      // ZWJ            U+200D
      // Microphone     U+1F3A4
      expect(validateSymbol('👨🏻‍🎤')).toEqual('valid');

      // Some emojis are displayed by default as black and white
      // characters. For example, 🕶 U+1F576 (xD83D xDD76) has the emoji
      // properties:
      // - "Emoji"
      // - "Extended_Pictographic" property
      // It does not have
      // - "Emoji_Presentation" (EP).
      // Interestingly, this specific emoji appears to be displayed
      // the same with or without the Emoji Presentation (VS-16).
      // A combination of emojis with and without EP is allowed.
      // The specific sequence 😎🤏😳🕶🤏 was found in the wild.

      // Sequence of emojis with presentation and non-presentation
      expect(validateSymbol('😎🤏😳🕶🤏')).toEqual('valid');

      // Sequence of emojis with presentation and VS-16
      // VS-16 U+FE0F
      expect(validateSymbol('😎🤏😳🕶\uFE0F🤏')).toEqual('valid');

      // UN flag.
      // First way to encode flags: as a sequence of two regional
      // indicator symbols
      //
      // 🇺 U+1F1FA 🇳 U+1F1F3
      expect(validateSymbol('🇺🇳')).toEqual('valid');

      // England flag
      // Second way of encoding flags: as a flag emoji followed by
      // tag emojis, and a cancel tag at the end.
      // The England flag uses the tags "gbeng":
      //
      //  U+1F3F4 U+E0067 U+E0062 U+E0065 U+E006E U+E0067 U+E007F
      expect(validateSymbol('🏴󠁧󠁢󠁥󠁮󠁧󠁿')).toEqual('valid');

      // Same thing with the CA flag, but it is rarely displayed correctly
      //
      // 🏴 U+1F3F4 󠁵u U+E0075 󠁳s U+E0073 c󠁣 U+E0063 a 󠁡 U+E0061 cancel 󠁿 U+E007F
      expect(validateSymbol('🏴󠁵󠁳󠁣󠁡󠁿')).toEqual('valid');

      // Rainbow flag.
      // Third way to encode flags, as a sequence of various emojis combined.
      //
      // 🏳 U+1F3F3 ️ VS-16 U+FE0F ‍ ZWJ U+200D 🌈 U+1F308
      expect(validateSymbol('🏳️‍🌈')).toEqual('valid');

      // Checkered flag.
      // Fourth way to encode flags, as a standalone emoji
      // U+1F3C1
      expect(validateSymbol('🏁')).toEqual('valid');

      // Flag (regional indicator) and non-flag mixed
      expect(validateSymbol('👨🏻‍🎤🇺🇸')).toEqual('valid');

      // Non latin letters
      expect(validateSymbol('半径')).toEqual('valid');
      expect(validateSymbol('半径8546')).toEqual('valid');
      // Not recommended, but valid: script combos
      expect(validateSymbol('半径circle')).toEqual('valid');
      // Caution: make sure the string is NFC-normalized (see below):
      // '\u5dc\u5b0\u5d4\u5b7\u5d2\u5d1\u5b4\u5bc\u5d9\u5dc'
      expect(validateSymbol('לְהַגבִּיל')).toEqual('valid');
    });
    test('Not a string', () => {
      expect(validateSymbol(42)).toEqual('not-a-string');
    });
    test('Empty string', () => {
      expect(validateSymbol('')).toEqual('empty-string');
    });
    test('Expected NFC', () => {
      expect(validateSymbol('cafe\u0301')).toEqual('expected-nfc');

      //Not normalized: לְהַגבִּיל = '\u05dc\u05b0\u05d4\u05b7\u05d2\u05d1\u05bc\u05b4\u05d9\u05dc'
      // Normalized: '\u05dc\u05b0\u05d4\u05b7\u05d2\u05d1\u05b4\u05bc\u05d9\u05dc'
      expect(
        validateSymbol(
          '\u05dc\u05b0\u05d4\u05b7\u05d2\u05d1\u05bc\u05b4\u05d9\u05dc'
        )
      ).toEqual('expected-nfc');
    });
    test('Mixed Emoji', () => {
      expect(validateSymbol('not😀')).toEqual('unexpected-mixed-emoji');
      // Flag with non-emoji
      expect(validateSymbol('USA🇺🇸')).toEqual('unexpected-mixed-emoji');
    });
    test('Bidi marker', () => {
      // Note: bidi markers are stripped when parsing LaTeX
      expect(validateSymbol('מְהִירוּת\u200E')).toEqual(
        'unexpected-bidi-marker'
      );
    });
    test('Unexpected script', () => {
      expect(validateSymbol('𓀀')).toEqual('unexpected-script');
    });
    test('Invalid first char', () => {
      expect(validateSymbol('+')).toEqual('invalid-first-char');
      expect(validateSymbol('$x')).toEqual('invalid-first-char');
    });
    test('Invalid char', () => {
      expect(validateSymbol('a.b')).toEqual('invalid-char');
    });
  });

  describe('BOXING', () => {
    test('simple symbols', () => {
      expect(symbol('x')).toEqual(`x`);
    });
    test('multi letter symbol', () => {
      expect(symbol('ab')).toEqual('ab');
    });
    test('multi letter symbol with digits', () => {
      expect(symbol('a8')).toEqual(`a8`);
    });
    test('greek letters and symbols', () => {
      expect(symbol('θ')).toEqual('`θ`');
      // `vartheta` or THETA SYMBOL (as Unicode calls it) is a variant
      // of the theta letter which is used in math, not written greek
      // Both are valid.
      expect(symbol('ϑ')).toEqual('`ϑ`');
    });
    test('underline', () => {
      expect(symbol('_')).toEqual('_');
      expect(symbol('__')).toEqual('__');
      expect(symbol('_a')).toEqual('_a');
      expect(symbol('o_o')).toEqual('o_o');
    });
    test('extended latin', () => {
      expect(symbol('café')).toEqual('`café`');
      expect(symbol('col·lecció')).toEqual('`col·lecció`');
    });
    test('emojis', () => {
      expect(symbol('😎🤏😳🕶🤏')).toEqual('`😎🤏😳🕶🤏`');
      // emoji with ZWJ and skin tone
      expect(symbol('👨🏻‍🎤')).toEqual('`👨🏻‍🎤`');
    });
    test('non-latin scripts', () => {
      expect(symbol('半径')).toEqual('`半径`');
      expect(symbol('半径8546')).toEqual('`半径8546`');
      expect(symbol('半径circle')).toEqual('`半径circle`');
      expect(symbol('לְהַגבִּיל')).toEqual(`\`לְהַגבִּיל\``);
    });
  });

  describe('BOXING ERRORS', () => {
    test('Math operators are not valid symbols', () => {
      expect(symbol('+')).toMatchInlineSnapshot(
        `["Error", ["ErrorCode", "invalid-symbol", "invalid-first-char"], "+"]`
      );
      expect(symbol('=')).toMatchInlineSnapshot(
        `["Error", ["ErrorCode", "invalid-symbol", "invalid-first-char"], "="]`
      );
    });

    test('LaTeX commands are not valid symbols', () => {
      expect(symbol('\\alpha')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "invalid-first-char"],
          "\\alpha"
        ]
      `);
    });

    test('Braile symbols are not valid symbols', () => {
      expect(symbol('⠋')).toMatchInlineSnapshot(
        `["Error", ["ErrorCode", "invalid-symbol", "unexpected-script"], "⠋"]`
      );
    });

    // U+13000, D80C DC00
    test('Egyptians Hieroglyphs are not valid symbols', () => {
      expect(symbol('𓀀')).toMatchInlineSnapshot(
        `["Error", ["ErrorCode", "invalid-symbol", "unexpected-script"], "𓀀"]`
      );
    });

    test('Symbols should not include LTR or RTL marks', () => {
      expect(symbol('מְהִירוּת‎')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-bidi-marker"],
          "מְהִירוּת‎"
        ]
      `);
      expect(symbol('‎מְהִירוּת')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-bidi-marker"],
          "‎מְהִירוּת"
        ]
      `);
    });
    test('Symbols should not mix emojis and non-emojis', () => {
      expect(symbol('👨🏻‍🎤DavidBowie')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-mixed-emoji"],
          "👨🏻‍🎤DavidBowie"
        ]
      `);
      expect(symbol('DavidBowie👨🏻‍🎤')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-mixed-emoji"],
          "DavidBowie👨🏻‍🎤"
        ]
      `);
    });
  });

  describe('PARSING', () => {
    test('single letter symbol', () => {
      expect(parse('x')).toMatchInlineSnapshot(`x`);
      expect(parse('\\mathit{x}')).toMatchInlineSnapshot(`x_italic`);
      expect(parse('\\mathrm{x}')).toMatchInlineSnapshot(`x_upright`);
    });
    test('multi letter symbol', () => {
      // Multi-letter symbols are upright by default
      expect(parse('\\mathrm{ab}')).toMatchInlineSnapshot(`ab`);
      expect(parse('\\operatorname{ab}')).toMatchInlineSnapshot(`ab`);
      expect(parse('\\mathit{ab}')).toMatchInlineSnapshot(`ab_italic`);
    });

    test('multiletter with subscript', () => {
      expect(parse('\\mathrm{speed_{max}}')).toMatchInlineSnapshot(`speed_max`);
      // Multi-letter subscript without delimiter becomes compound symbol
      expect(parse('\\mathrm{speed}_{max}')).toMatchInlineSnapshot(`speed_max`);
      // With parentheses, it remains an expression (Delimiter is stripped)
      expect(parse('\\mathrm{speed}_{(max)}')).toMatchInlineSnapshot(
        `["Subscript", "speed", ["Multiply", "a", "m", "x"]]`
      );
      expect(parse('A_{(n+1)}')).toMatchInlineSnapshot(
        `["Subscript", "A", ["Add", "n", 1]]`
      );
    });

    test('subscript serialization roundtrip', () => {
      // Compound symbols with subscripts should serialize back correctly
      expect(engine.parse('A_{max}').latex).toMatch(/A_\{?max\}?/);
      expect(engine.parse('T_{max}').latex).toMatch(/T_\{?max\}?/);
      expect(engine.parse('x_{ij}').latex).toMatch(/x_\{?ij\}?/);
    });

    test('multi letter symbol with digits', () => {
      expect(parse('\\mathrm{a8}')).toMatchInlineSnapshot(`a8`);
    });
    test('greek letters and symbols', () => {
      expect(parse('\\theta')).toMatchInlineSnapshot(`theta`);
      expect(parse('\\vartheta')).toMatchInlineSnapshot(`thetaSymbol`);
    });
    test('underline', () => {
      expect(parse('\\_')).toMatchInlineSnapshot(`_`);
      expect(parse('\\mathrm{\\_a}')).toMatchInlineSnapshot(`_a`);
      expect(parse('\\mathrm{o\\_o}')).toMatchInlineSnapshot(`o_o`);
    });
    test('extended latin', () => {
      expect(parse('\\operatorname{caf\\char"00E9}')).toMatchInlineSnapshot(
        `café`
      );
    });
    test('emojis', () => {
      // Sequence of emojis do not need to be wrapped...
      expect(parse('🥤+🍔🍟=3')).toMatchInlineSnapshot(`
        [
          "Equal",
          [
            "Add",
            [
              "Error",
              ["ErrorCode", "incompatible-type", "'number'", "'string'"]
            ],
            [
              "Error",
              ["ErrorCode", "incompatible-type", "'number'", "'string'"]
            ]
          ],
          3
        ]
      `);
      // ... but optionally they can be.
      expect(parse('\\operatorname{😎🤏😳🕶🤏}')).toMatchInlineSnapshot(
        `😎🤏😳🕶🤏`
      );
      // emoji with ZWJ and skin tone
      // U+1F468 U+1F3FB U+200D U+1F3A4
      expect(parse('👨🏻‍🎤')).toMatchInlineSnapshot(`👨🏻‍🎤`);
    });
    test('non-latin scripts', () => {
      expect(parse('\\operatorname{半径}')).toMatchInlineSnapshot(`半径`);
      expect(parse('\\operatorname{半径8546}')).toMatchInlineSnapshot(
        `半径8546`
      );
      expect(parse('\\operatorname{半径circle}')).toMatchInlineSnapshot(
        `半径circle`
      );
      expect(parse('\\operatorname{לְהַגבִּיל}')).toMatchInlineSnapshot(
        `לְהַגבִּיל`
      );
      // Bidi markers are OK outside of symbols (they are ignored, though,
      // since they are not applicable to the math layout algorithm)
      expect(parse('\\operatorname{לְהַגבִּיל}\u200e')).toMatchInlineSnapshot(
        `לְהַגבִּיל`
      );
    });
  });
  describe('PARSING SYMBOLS WITH MODIFIERS', () => {
    test('Expressions that should not be interpreted as symbols with modifiers', () => {
      expect(parse('x^2')).toMatchInlineSnapshot(`["Square", "x"]`);
      expect(parse('a^b')).toMatchInlineSnapshot(`["Power", "a", "b"]`);
      expect(parse('x_{i+1}')).toMatchInlineSnapshot(
        `["Subscript", "x", ["Add", "i", 1]]`
      );
      expect(parse('\\vec{x}')).toMatchInlineSnapshot(`["OverVector", "x"]`);
      expect(parse('x^\\prime')).toMatchInlineSnapshot(`["Prime", "x"]`);
      expect(parse('\\vec{AB}')).toMatchInlineSnapshot(
        `["OverVector", ["Multiply", "A", "B"]]`
      );
    });

    test('Symbols without modifiers', () => {
      expect(parse('x')).toMatchInlineSnapshot(`x`);
      expect(parse('\\mathit{x}')).toMatchInlineSnapshot(`x_italic`);
      expect(parse('\\mathrm{x}')).toMatchInlineSnapshot(`x_upright`);
      expect(parse('\\mathrm{ab}')).toMatchInlineSnapshot(`ab`);
      expect(parse('\\mathrm{ab012}')).toMatchInlineSnapshot(`ab012`);
      expect(parse('\\mathrm{ab_0}')).toMatchInlineSnapshot(`ab_0`);
      expect(parse('\\mathrm{\\alpha}')).toMatchInlineSnapshot(`alpha`);
      expect(parse('👨🏻‍🎤')).toMatchInlineSnapshot(`👨🏻‍🎤`);
      expect(parse('😎🤏😳🕶🤏')).toMatchInlineSnapshot(`😎🤏😳🕶🤏`);
      expect(parse('\\mathrm{半径}')).toMatchInlineSnapshot(`半径`);
      expect(parse('\\mathrm{半径8546}')).toMatchInlineSnapshot(`半径8546`);
      expect(parse('\\mathrm{לְהַגבִּיל}')).toMatchInlineSnapshot(`לְהַגבִּיל`);
    });

    test('Symbols with single modifiers', () => {
      expect(parse('\\mathfrak{X}')).toMatchInlineSnapshot(`X_fraktur`);
      expect(parse('\\mathbf{x}')).toMatchInlineSnapshot(`x_bold`);

      // Special handling of initial digits
      expect(parse('\\mathbb{1}')).toMatchInlineSnapshot(`one_doublestruck`);
    });

    test('Symbols with multiple modifiers', () => {
      expect(parse('\\mathrm{\\vec{x}^\\prime}')).toMatchInlineSnapshot(
        `x_vec_prime`
      );
      expect(parse('\\mathrm{\\vec{\\mathbf{x}}}')).toMatchInlineSnapshot(
        `x_bold_vec`
      );
      expect(parse('\\mathbf{\\vec{x}}')).toMatchInlineSnapshot(`x_vec_bold`);
      expect(parse('\\mathbf{\\mathsf{x}}')).toMatchInlineSnapshot(
        `x_sansserif_bold`
      );
      expect(parse('\\mathsf{\\mathbf{x}}')).toMatchInlineSnapshot(
        `x_bold_sansserif`
      );
      expect(parse('\\mathbf{\\vec{x}_{\\mathfrak{I}}}')).toMatchInlineSnapshot(
        `x_vec_I_fraktur_bold`
      );
    });

    test('Symbols with common names', () => {
      expect(parse('\\mathrm{x^+}')).toMatchInlineSnapshot(`x__plus`);
    });
  });

  describe('PARSING ERRORS', () => {
    test('Math operators are not valid symbols', () => {
      expect(parse('\\mathrm{=}')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "invalid-first-char"],
          ["LatexString", "\\mathrm{=}"]
        ]
      `);
    });
    test('Braille are not valid symbols', () => {
      expect(parse('\\mathrm{\\char"280B}')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-script"],
          ["LatexString", "\\mathrm{\\char"280B}"]
        ]
      `);
    });
    test('Egyptians Hieroglyphs are not valid symbols', () => {
      expect(parse('\\mathrm{\\char"13000}')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-script"],
          ["LatexString", "\\mathrm{\\char"13000}"]
        ]
      `);
    });

    test('Tokenization should remove bidi markers', () => {
      expect(parse('\\mathrm{מְהִירוּת‎}')).toMatchInlineSnapshot(`מְהִירוּת`);
      expect(parse('\\mathrm{‎מְהִירוּת}')).toMatchInlineSnapshot(`מְהִירוּת`);
    });

    test('Symbols should not mix emojis and non-emojis', () => {
      expect(parse('\\mathrm{👨🏻‍🎤DavidBowie}')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-mixed-emoji"],
          ["LatexString", "\\mathrm{👨🏻‍🎤DavDavidBowie}"]
        ]
      `);
      expect(parse('\\mathrm{DavidBowie👨🏻‍🎤}')).toMatchInlineSnapshot(`
        [
          "Error",
          ["ErrorCode", "invalid-symbol", "unexpected-mixed-emoji"],
          ["LatexString", "\\mathrm{DavidBowie👨🏻‍🎤}}"]
        ]
      `);
    });
  });

  describe('SERIALIZING', () => {
    test('no modifier', () => {
      expect(latex('x')).toEqual('x');
      expect(latex('x_upright')).toEqual(`\\mathrm{x}`);
      expect(latex('x_italic')).toEqual(`\\mathit{x}`);
      expect(latex('speed')).toEqual(`\\mathrm{speed}`);
      expect(latex('speed_max')).toEqual(`\\mathrm{speed_{max}}`);
      expect(latex('_')).toEqual(`\\operatorname{\\_}`);
      expect(latex('_0')).toEqual(`\\operatorname{\\_0}`);
      expect(latex('_abc')).toEqual(`\\operatorname{\\_abc}`);
      expect(latex('o_o')).toEqual(`\\mathrm{o_{o}}`); // single char uses mathrm rather than operatorname
      expect(latex('`café`')).toEqual(`\\mathrm{café}`);
      // Catalan interpunct (·) is valid in a symbol
      expect(latex('`col·lecció`')).toEqual(`\\mathrm{col·lecció}`);
      expect(latex('`😎🤏😳🕶🤏`')).toEqual('😎🤏😳🕶🤏');
      expect(latex('`👨🏻‍🎤`')).toEqual('👨🏻‍🎤');
      expect(latex('`半径`')).toEqual(`\\mathrm{半径}`);
    });

    test('single modifier', () => {
      expect(latex('`x_deg`')).toEqual(`\\mathrm{x\\degree}`);
      expect(latex('`x_prime`')).toEqual(`\\mathrm{x^{\\prime}}`);
      expect(latex('`x_dprime`')).toEqual(`\\mathrm{x^{\\doubleprime}}`);
      expect(latex('`x_ring`')).toEqual(`\\mathrm{\\mathring{x}}`);
      expect(latex('`x_hat`')).toEqual(`\\mathrm{\\hat{x}}`);
      expect(latex('`x_tilde`')).toEqual(`\\mathrm{\\tilde{x}}`);
      expect(latex('`x_vec`')).toEqual(`\\mathrm{\\vec{x}}`);
      expect(latex('`x_bar`')).toEqual(`\\mathrm{\\overline{x}}`);
      expect(latex('`x_underbar`')).toEqual(`\\mathrm{\\underline{x}}`);
      expect(latex('`x_dot`')).toEqual(`\\mathrm{\\dot{x}}`);
      expect(latex('`x_ddot`')).toEqual(`\\mathrm{\\ddot{x}}`);
      expect(latex('`x_tdot`')).toEqual(`\\mathrm{\\dddot{x}}`);
      expect(latex('`x_qdot`')).toEqual(`\\mathrm{\\ddddot{x}}`);
      expect(latex('`a_acute`')).toEqual(`\\mathrm{\\acute{a}}`);
      expect(latex('`a_grave`')).toEqual(`\\mathrm{\\grave{a}}`);
      expect(latex('`a_breve`')).toEqual(`\\mathrm{\\breve{a}}`);
      expect(latex('`a_check`')).toEqual(`\\mathrm{\\check{a}}`);
      expect(latex('`x_upright`')).toEqual(`\\mathrm{x}`);
      expect(latex('`x_italic`')).toEqual(`\\mathit{x}`);
      expect(latex('`x_bold`')).toEqual(`\\mathbf{x}`);
      expect(latex('`x_script`')).toEqual(`\\mathscr{x}`);
      expect(latex('`x_fraktur`')).toEqual(`\\mathfrak{x}`);
      expect(latex('`x_doublestruck`')).toEqual(`\\mathbb{x}`);
      expect(latex('`x_blackboard`')).toEqual(`\\mathbb{x}`);
      expect(latex('`x_bold_talic`')).toEqual(`\\mathbf{x_{talic}}`);
      expect(latex('`x_calligraphic`')).toEqual(`\\mathcal{x}`);
      expect(latex('`x_script_old`')).toEqual(`\\mathscr{x_{old}}`);
      expect(latex('`x_calligraphic_bold`')).toEqual(`\\mathbf{\\mathcal{x}}`);
      expect(latex('`x_gothic_bold`')).toEqual(`\\mathbf{\\mathfrak{x}}`);
      expect(latex('`x_fraktur_bold`')).toEqual(`\\mathbf{\\mathfrak{x}}`);
      expect(latex('`x_sansserif`')).toEqual(`\\mathsf{x}`);
      expect(latex('`x_sansserif_bold`')).toEqual(`\\mathbf{\\mathsf{x}}`);
      expect(latex('`x_sansserif_italic`')).toEqual(`\\mathit{\\mathsf{x}}`);
      expect(latex('`x_monospace`')).toEqual(`\\mathtt{x}`);
      expect(latex('`one_blackboard`')).toEqual(`\\mathbb{1}`);
    });

    test('multiple modifiers', () => {
      expect(latex('`x_hat_vec`')).toEqual(`\\mathrm{\\vec{\\hat{x}}}`);
      expect(latex('`x_vec_hat`')).toEqual(`\\mathrm{\\hat{\\vec{x}}}`);
      expect(latex('`x_hat_vec_calligraphic`')).toEqual(
        `\\mathcal{\\vec{\\hat{x}}}`
      );
      expect(latex('`x_calligraphic_hat_vec`')).toEqual(
        `\\mathcal{x_{\\vec{hat}}}`
      );
      expect(latex('`x_bold_italic`')).toEqual(`\\mathit{\\mathbf{x}}`);
      expect(latex('`x_calligraphic_bold`')).toEqual(`\\mathbf{\\mathcal{x}}`);
      expect(latex('`x_vec_bold_I_fraktur`')).toEqual(
        `\\mathbf{\\vec{x}_{\\mathfrak{I}}}`
      );
    });

    test('multiletters and non-latin scripts with modifiers and subscripts', () => {
      expect(latex('`speed_bold`')).toEqual(`\\mathbf{speed}`);
      expect(latex('`radius_moon`')).toEqual(`\\mathrm{radius_{moon}}`);
      expect(latex('`半径_bold`')).toEqual(`\\mathbf{半径}`);
      expect(latex('`半径_earth`')).toEqual(`\\mathrm{半径_{earth}}`);
    });

    test('superscripts and subscripts', () => {
      expect(latex('`speed_max`')).toEqual(`\\mathrm{speed_{max}}`);
      expect(latex('`speed_light_max`')).toEqual(`\\mathrm{speed_{light,max}}`);
      expect(latex('`mass__earth`')).toEqual(`\\mathrm{mass^{earth}}`);
      expect(latex('`radius__moon_min`')).toEqual(
        `\\mathrm{radius^{moon}_{min}}`
      );
    });

    test('numeric modifiers', () => {
      expect(latex('x0')).toEqual(`\\mathrm{x_0}`);
      expect(latex('x123')).toEqual(`\\mathrm{x_{123}}`);
      expect(latex('`mu_123`')).toEqual(`\\mathrm{\\mu_{123}}`);
    });

    test('special names', () => {
      expect(latex('alpha')).toEqual(`\\alpha`);
      expect(latex('deltagamma')).toMatchInlineSnapshot(`\\mathrm{deltagamma}`);
      expect(latex('Alpha')).toEqual(`\\Alpha`);
      expect(latex('aleph')).toEqual(`\\aleph`);
      expect(latex('`aleph__plus`')).toMatchInlineSnapshot(
        `\\mathrm{\\aleph^{+}}`
      );
      expect(latex('`x_alpha`')).toEqual(`\\mathrm{x_{\\alpha}}`);
      expect(latex('`alpha_gamma`')).toEqual(`\\mathrm{\\alpha_{\\gamma}}`);
      expect(latex('`alpha_gamma_delta`')).toEqual(
        `\\mathrm{\\alpha_{\\gamma,\\delta}}`
      );
      expect(latex('`beta_bold`')).toEqual(`\\mathbf{\\beta}`);
      expect(latex('`beta_calligraphic`')).toMatchInlineSnapshot(
        `\\mathcal{\\beta}`
      );
      expect(latex('`x_plus`')).toEqual(`\\mathrm{x_{+}}`);
      expect(latex('`R_blackboard__0__plus`')).toEqual(`\\mathbb{R^{0,+}}`);
    });
  });
});
