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
  '\u00ac': '!',

  '\u00d7': '*', // Multiplication sign
  '\u00f7': '/', // Division sign

  '\u2044': '/', // Fraction slash FRACTION SLASH

  '\u03c0': 'Pi', // GREEK SMALL LETTER PI
  '\u2148': 'ImaginaryI',
  '\u2147': 'ExponentialE',
  '\u2102': 'ComplexNumber',
  '\u2115': 'RealNumber',
  '\u211d': 'NaturalNumber',
  '\u2124': 'Integer',
  '\u211A': 'RationalNumber',

  //   '\u2190': '<-',
  '\u2192': '->',
  '\u2194': '<->',
  //   '\u21A4': '<-|',
  '\u21A6': '|->',
  '\u21d0': '=>',
  '\u21d4': '<=>',

  '\u2205': 'EmptySet', //
  '\u221E': 'Infinity', //
  '\u29dd': 'ComplexInfinity', // ⧝ TIE OVER INFINITY

  '\u2212': '-', // MINUS

  //   '\u22bb': 'Xor', // ⊻
  '\u22c0': '&&', // See also \u2227
  '\u22c1': '||', // See also \u2228

  '\u2227': '&&', // ∧
  '\u2228': '||', // ∨
  '\u2260': '!=',
  '\u2261': '==', // ≡	(==)
  '\u2262': '!==', // ≢		!(==)
  '\u2263': '===',
  '\u2A7d': '<=',
  '\u2A7e': '>=',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2266': '<=',
  '\u2267': '>=',

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
