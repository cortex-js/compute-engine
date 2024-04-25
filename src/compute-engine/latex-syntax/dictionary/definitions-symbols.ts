import { LatexDictionary, SymbolEntry } from '../public';

// From mathlab: https://www.mathworks.com/help/symbolic/add-subscripts-superscripts-accents-to-symbolic-variables.html
// subscript: '_'
// superscript: '__'
// Multiple subscript:
//    "x_b_1" -> "x_{b, 1}
//    "A__plusmn__c" -> "A^{\pm c}"
// dot accent: '_dot'
// double-dot: '_ddot'
// other modifiers: "ast"; "dag"; "deg"; "hat"; "tilde"; "vec"; "bar"; "ubar"; "dot"; "ddot"; "tdot"; "qdot"; "prime"; "dprime"; "tprime"; "qprime"
// more modifiers: "minus"; "plus"; "plusmn"; "hash"
// "If you add multiple accents, then the input accents are assigned from left to right to the closest preceding variable or index."
//

// From sympy: https://github.com/sympy/sympy/blob/master/sympy/printing/latex.py
// - Fmathring

// From Gina: // https://www.ginac.de/ginac.git/?p=ginac.git;a=blob;f=ginac/symbol.cpp;h=b8068c800fffd0de592dc84e85868cf021c62ef3;hb=refs/heads/master

export const SYMBOLS: [string, string, number][] = [
  // Greek
  ['alpha', '\\alpha', 0x03b1],
  ['beta', '\\beta', 0x03b2],
  ['gamma', '\\gamma', 0x03b3],
  ['delta', '\\delta', 0x03b4],
  ['epsilon', '\\epsilon', 0x03b5],
  ['epsilonSymbol', '\\varepsilon', 0x03f5], // GREEK LUNATE EPSILON SYMBOL
  ['zeta', '\\zeta', 0x03b6],
  ['eta', '\\eta', 0x03b7],
  ['theta', '\\theta', 0x03b8],
  ['thetaSymbol', '\\vartheta', 0x03d1], // Unicode GREEK THETA SYMBOL
  ['iota', '\\iota', 0x03b9],
  ['kappa', '\\kappa', 0x03ba],
  ['kappaSymbol', '\\varkappa', 0x03f0], // GREEK KAPPA SYMBOL
  ['lambda', '\\lambda', 0x03bb],
  ['mu', '\\mu', 0x03bc],
  ['nu', '\\nu', 0x03bd],
  ['xi', '\\xi', 0x03be],
  ['omicron', '\\omicron', 0x03bf],
  ['pi', '\\pi', 0x03c0],
  ['piSymbol', '\\varpi', 0x03d6], // GREEK PI SYMBOL
  ['rho', '\\rho', 0x03c1],
  ['rhoSymbol', '\\varrho', 0x03f1], // GREEK RHO SYMBOL
  ['sigma', '\\sigma', 0x03c3],
  ['finalSigma', '\\varsigma', 0x03c2], //GREEK SMALL LETTER FINAL SIGMA
  ['tau', '\\tau', 0x03c4],
  ['phi', '\\phi', 0x03d5], // Note GREEK PHI SYMBOL, but common usage in math
  ['phiLetter', '\\varphi', 0x03c6],
  ['upsilon', '\\upsilon', 0x03c5],
  ['chi', '\\chi', 0x03c7],
  ['psi', '\\psi', 0x03c8],
  ['omega', '\\omega', 0x03c9],

  ['Alpha', '\\Alpha', 0x0391],
  ['Beta', '\\Beta', 0x0392],
  ['Gamma', '\\Gamma', 0x0393],
  ['Delta', '\\Delta', 0x0394],
  ['Epsilon', '\\Epsilon', 0x0395],
  ['Zeta', '\\Zeta', 0x0396],
  ['Eta', '\\Eta', 0x0397],
  ['Theta', '\\Theta', 0x0398],
  ['Iota', '\\Iota', 0x0399],
  ['Kappa', '\\Kappa', 0x039a],
  ['Lambda', '\\Lambda', 0x039b],
  ['Mu', '\\Mu', 0x039c],
  ['Nu', '\\Nu', 0x039d],
  ['Xi', '\\Xi', 0x039e],
  ['Omicron', '\\Omicron', 0x039f],
  // ['Pi', '\\Pi', 0x03a0],
  ['Rho', '\\Rho', 0x03a1],
  ['Sigma', '\\Sigma', 0x03a3],
  ['Tau', '\\Tau', 0x03a4],
  ['Phi', '\\Phi', 0x03a6],
  ['Upsilon', '\\Upsilon', 0x03a5],
  ['Chi', '\\Chi', 0x03a7],
  ['Psi', '\\Psi', 0x03a8],
  ['Omega', '\\Omega', 0x03a9],

  ['digamma', '\\digamma', 0x03dd],

  // Hebrew
  ['aleph', '\\aleph', 0x2135], // Unicode ALEF SYMBOL
  ['bet', '\\beth', 0x2136],
  ['gimel', '\\gimel', 0x2137],
  ['dalet', '\\daleth', 0x2138],

  // Letter-like
  ['ell', '\\ell', 0x2133], // Unicode SCRIPT SMALL L
  ['turnedCapitalF', '\\Finv', 0x2132], // Unicode TURNED CAPITAL F'
  ['turnedCapitalG', '\\Game', 0x2141], // TURNED SANS-SERIF CAPITAL G
  ['weierstrass', '\\wp', 0x2118], // Unicode SCRIPT CAPITAL P
  ['eth', '\\eth', 0x00f0],
  ['invertedOhm', '\\mho', 0x2127], // Unicode INVERTED OHM SIGN
  ['hBar', '\\hbar', 0x0127], // Unicode LATIN SMALL LETTER H WITH STROKE
  ['hSlash', '\\hslash', 0x210f], // Unicode PLANCK CONSTANT OVER TWO PI

  // Symbols
  ['blackClubSuit', '\\clubsuit', 0x2663],
  ['whiteHeartSuit', '\\heartsuit', 0x2661],
  ['blackSpadeSuit', '\\spadesuit', 0x2660],
  ['whiteDiamondSuit', '\\diamondsuit', 0x2662],
  ['sharp', '\\sharp', 0x266f],
  ['flat', '\\flat', 0x266d],
  ['natural', '\\natural', 0x266e],
];

export const DEFINITIONS_SYMBOLS: LatexDictionary = [
  ...SYMBOLS.map(([symbol, latex, _codepoint]) => {
    return {
      kind: 'symbol',
      name: symbol,
      latexTrigger: [latex],
      parse: symbol,
    } as SymbolEntry;
  }),
  ...SYMBOLS.map(([symbol, _latex, codepoint]) => {
    return {
      kind: 'symbol',
      latexTrigger: [String.fromCodePoint(codepoint)],
      parse: symbol,
    } as SymbolEntry;
  }),
];
