// On input, all these characters are considered white space
// Unicode characters with property White_Space=yes
// See https://en.wikipedia.org/wiki/Whitespace_character
export const WHITE_SPACE = [
  0x0009, // CHARACTER TABULATION
  0x000a, // LINE FEED
  0x000b, // LINE TABULATION
  0x000c, // FORM FEED
  0x000d, // CARRIAGE RETURN
  0x0020, // SPACE
  0x0085, // NEXT LINE
  0x00a0, // NO-BREAK SPACE
  0x1680, // OGHAM SPACE MARK
  0x2000, // EN QUAD
  0x2001, // EM QUAD
  0x2002, // EN SPACE                   9/18em
  0x2003, // EM SPACE                   18/18em
  0x2004, // THREE-PER-EM SPACE         6/18em
  0x2005, // FOUR-PER-EM SPACE          5/18em
  0x2006, // SIX-PER-EM SPACE
  0x2007, // FIGURE SPACE (digit width)
  0x2008, // PUNCTUATION SPACE
  0x2009, // THIN SPACE                 3/18em
  0x200a, // HAIR SPACE                 1/18em
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
  0x202f, // NARROW NO-BREAK SPACE
  0x205f, // MEDIUM MATHEMATICAL SPACE  4/18em
  0x3000, // IDEOGRAPHIC SPACE
];

// In a string all these characters are escape to a Unicode escape sequence
export const INVISIBLE_CHARS = [
  ...WHITE_SPACE,
  0x007f, // Delete
  0x00ad, // Soft-hyphen
  0x061c, // Arabic Letter Mark
  0x180e, // Mongolian Vowel Separator
  0x200b, // 0em      Zero-Width Space
  0x200c, // Zero-Width Non-Joiner
  0x200d, // ZWJ, Zero-Width Joiner
  0x200e, // Left-to-right Mark
  0x200f, // Right-to-left Mark
  0x2060, // Word Joiner
  0x2061, // FUNCTION APPLICATION
  0x2062, // INVISIBLE TIMES
  0x2063, // INVISIBLE SEPARATOR
  0x2064, // INVISIBLE PLUS
  0x2066, // LEFT - TO - RIGHT ISOLATE
  0x2067, // RIGHT - TO - LEFT ISOLATE
  0x2068, // FIRST STRONG ISOLATE
  0x2069, // POP DIRECTIONAL ISOLATE
  0x206a, // INHIBIT SYMMETRIC SWAPPING
  0x206b, // ACTIVATE SYMMETRIC SWAPPING
  0x206c, // INHIBIT ARABIC FORM SHAPING
  0x206d, // ACTIVATE ARABIC FORM SHAPING
  0x206e, // NATIONAL DIGIT SHAPES
  0x206f, // NOMINAL DIGIT SHAPES
  0x2800, // Braille Pattern Blank
  0xfeff, // Byte Order Mark
  0xfffe, // Byte Order Mark
];

export const SUPERSCRIPT_UNICODE = {
  //   '\u00bb': '>>',
  '\u2070': '0', // Superscript
  '\u00b9': '1', // Superscript
  '\u00b2': '2', // Superscript
  '\u00b3': '3', // Superscript
  '\u2074': '4', // Superscript
  '\u2075': '5', // Superscript
  '\u2076': '6', // Superscript
  '\u2077': '7', // Superscript
  '\u2078': '8', // Superscript
  '\u2079': '9', // Superscript
  '\u207a': '+', // Superscript
  '\u207b': '-', // Superscript
  '\u207d': '(', // Superscript
  '\u207e': ')', // Superscript
  '\u2071': 'i', // Superscript
  '\u207f': 'n', // Superscript
};
export const SUBSCRIPT_UNICODE = {
  '\u1d62': 'i', // Subscript
  '\u2080': '0', // Subscript
  '\u0081': '1', // Subscript
  '\u0082': '2', // Subscript
  '\u0083': '3', // Subscript
  '\u2084': '4', // Subscript
  '\u2085': '5', // Subscript
  '\u2086': '6', // Subscript
  '\u2087': '7', // Subscript
  '\u2088': '8', // Subscript
  '\u2089': '9', // Subscript
  '\u208a': '+', // Subscript
  '\u208b': '-', // Subscript
  '\u208d': '(', // Subscript
  '\u208e': ')', // Subscript
  '\u2090': 'a', // Subscript
  '\u2091': 'e', // Subscript
  '\u2092': 'o', // Subscript
  '\u2093': 'x', // Subscript
  '\u2097': 'k', // Subscript
  '\u2098': 'm', // Subscript
  '\u2099': 'n', // Subscript
  '\u209c': 't', // Subscript
  '\u2c7c': 'j', // Subscript
};

export const VULGAR_FRACTIONS_UNICODE = {
  '\u00BC': '1/4', // ¼	1⁄4	0.25	Vulgar Fraction One Fourth
  '\u00BE': '3/4', // ¾	3⁄4	0.75	Vulgar Fraction Three Fourths
  '\u2150': '1/7', // ⅐	1⁄7	0.142857...	Vulgar Fraction One Seventh
  '\u2151': '1/9', //⅑	1⁄9	0.111...	Vulgar Fraction One Ninth
  '\u2152': '1/10', // ⅒	1⁄10	0.1	Vulgar Fraction One Tenth
  '\u2153': '1/3', // ⅓	1⁄3	0.333...	Vulgar Fraction One Third
  '\u2154': '2/3', // ⅔	2⁄3	0.666...	Vulgar Fraction Two Thirds
  '\u2155': '1/5', // ⅕	1⁄5	0.2	Vulgar Fraction One Fifth
  '\u2156': '2/5', // ⅖	2⁄5	0.4	Vulgar Fraction Two Fifths
  '\u2157': '3/5', // ⅗	3⁄5	0.6	Vulgar Fraction Three Fifths
  '\u2158': '4/5', // ⅘	4⁄5	0.8	Vulgar Fraction Four Fifths
  '\u2159': '1/6', // ⅙	1⁄6	0.166...	Vulgar Fraction One Sixth
  '\u215A': '5/6', // ⅚	5⁄6	0.833...	Vulgar Fraction Five Sixths
  '\u215B': '1/8', // ⅛	1⁄8	0.125	Vulgar Fraction One Eighth
  '\u215C': '3/8', // ⅜	3⁄8	0.375	Vulgar Fraction Three Eighths
  '\u215D': '5/8', // ⅝	5⁄8	0.625	Vulgar Fraction Five Eighths
  '\u215E': '7/8', // ⅞	7⁄8	0.875	Vulgar Fraction Seven Eighths
  '\u00bd': '1/2', // ½ VULGAR FRACTION ONE HALF,
};

export const FANCY_UNICODE = {
  //   '\u00ab': '<<',
  '\u00ac': '!', // NOT SIGN ¬
  '\u00b1': '+-', // PLUS-MINUS SIGN
  '\u2213': '-+', // MINUS-PLUS SIGN

  '\u00d7': '*', // × MULTIPLICATION SIGN
  '\u00f7': '/', // ÷ DIVISION SIGN
  '\u2215': '/', // ∕ DIVISION SLASH

  '\u2024': '.', // ONE DOT LEADER
  '\u2025': '..', // TWO DOT LEADER
  '\u2026': '...', // HORIZONTAL ELLIPSIS
  '\u2027': '.', // HYPHENATION POINT
  '\u2032': "'", // PRIME
  '\u2033': "''", // DOUBLE PRIME
  '\u2034': "'''", // TRIPLE PRIME
  '\u2042': '***', // ⁂ ASTERISM
  '\u2044': '/', // FRACTION SLASH
  '\u2047': '??', // DOUBLE QUESTION MARK
  '\u2048': '?!', // QUESTION EXCLAMATION MARK
  '\u2049': '!?', // EXCLAMATION QUESTION MARK
  '\u204e': '*', // 	⁕ LOW ASTERISK
  '\u2051': '**', // TWO ASTERISKS ALIGNED VERTICALLY
  '\u2056': '...', // ⁖ THREE DOT PUNCTUATION
  '\u2059': '.....', // ⁙ FIVE DOT PUNCTUATION
  '\u205a': ':', // ⁚ TWO DOT PUNCTUATION
  '\u205b': '.:.', // ⁛ FOUR DOT MARK

  '\u2062': '*', // Invisible multiply
  '\u2064': '+', // Invisible plus

  '\u03c0': 'Pi', // GREEK SMALL LETTER PI
  '\u203c': '!!', // DOUBLE EXCLAMATION MARK

  '\u2148': 'ImaginaryI', // ⅈ
  '\u2147': 'ExponentialE', // ⅇ
  '\u2102': 'ComplexNumber', // ℂ
  '\u211d': 'RealNumber', // ℝ
  '\u2115': 'NaturalNumber', // ℕ
  '\u2124': 'Integer', // ℤ
  '\u211A': 'RationalNumber', // ℚ

  //   '\u2190': '<-',
  '\u2192': '->', // RIGHTWARDS ARROW
  '\u2194': '<->',
  //   '\u21A4': '<-|',
  '\u21A6': '|->', // RIGHTWARDS ARROW FROM BAR
  '\u21d0': '=>',
  '\u21d4': '<=>',

  '\u2205': 'EmptySet', //
  '\u221E': 'Infinity', //
  '\u29dd': 'ComplexInfinity', // ⧝ TIE OVER INFINITY

  '\u2212': '-', // MINUS
  '\u2218': '.', // RING OPERATOR (function composition)

  //   '\u22bb': 'Xor', // ⊻
  '\u22c0': '&&', // See also \u2227
  '\u22c1': '||', // See also \u2228

  '\u2227': '&&', // ∧
  '\u2228': '||', // ∨
  // '\u2254': ':=', // COLON EQUALS
  // '\u2255': '=:', // EQUALS COLON
  '\u2237': '::',
  '\u2260': '!=', // ≠ NOT EQUAL TO
  '\u2261': '==', // ≡ IDENTICAL TO	(==)
  '\u2262': '!==', // ≢	NOT IDENTICAL TO	!(==)
  '\u2263': '===', // ≣ STRICTLY EQUIVALENT TO
  '\u2A7d': '<=', // LESS-THAN OR SLANTED EQUAL TO
  '\u2A7e': '>=', // GREATER-THAN OR SLANTED EQUAL TO
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2266': '<=',
  '\u2267': '>=',
  '\u226a': '<<',
  '\u226b': '>>',

  //
  // Perl/Raku support a collection of infix operators
  //
  '\u2208': 'in', // ∈	(elem)
  '\u2209': '!in', // ∉	!(elem)
  // '\u220B',	// ∋	(cont)
  // '\u220C', //  ∌	!(cont)
  // '\u2286', // ⊆		(<=)
  // '\u2288', // ⊈		!(<=)
  // '\u2282', // ⊂		(<)
  // '\u2284', //⊄		!(<)
  // '\u2287', // ⊇		(>=)
  // '\u2289', //⊉		!(>=)
  // '\u2283', // ⊃		(>)
  // '\u2285', // ⊅		!(>)
  // '\u222A', //∪		(|)
  // '\u2229', // ∩		(&)
  // '\u2216', // ∖		(-) SetMinus
  // '\u2296', // ⊖		(^)
  // '\u228D', // ⊍		(.)
  // '\u228E', //	(+)

  '\u2A75': '==',
  '\u2A76': '===',
};
