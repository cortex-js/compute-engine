import { LatexDictionary } from '../public';

const SYMBOLS: [string, string, number][] = [
  // Greek
  ['Alpha', '\\alpha', 0x03b1],
  ['Beta', '\\beta', 0x03b2],
  ['Gamma', '\\gamma', 0x03b3],
  ['Delta', '\\delta', 0x03b4],
  ['Epsilon', '\\epsilon', 0x03b5],
  ['EpsilonSymbol', '\\varepsilon', 0x03f5], // GREEK LUNATE EPSILON SYMBOL
  ['Zeta', '\\zeta', 0x03b6],
  ['Eta', '\\eta', 0x03b7],
  ['Theta', '\\theta', 0x03b8],
  ['ThetaSymbol', '\\vartheta', 0x03d1], // Unicode GREEK THETA SYMBOL
  ['Iota', '\\iota', 0x03b9],
  ['Kappa', '\\kappa', 0x03ba],
  ['KappaSymbol', '\\varkappa', 0x03f0], // GREEK KAPPA SYMBOL
  ['Lambda', '\\lambda', 0x03bb],
  ['Mu', '\\mu', 0x03bc],
  ['Nu', '\\nu', 0x03bd],
  ['Xi', '\\xi', 0x03be],
  ['Omicron', '\\omicron', 0x03bf],
  // ['', '\\pi', 0x03c0],
  ['PiSymbol', '\\varpi', 0x03d6], // GREEK PI SYMBOL
  ['Rho', '\\rho', 0x03c1],
  ['RhoSymbol', '\\varrho', 0x03f1], // GREEK RHO SYMBOL
  ['Sigma', '\\sigma', 0x03c3],
  ['FinalSigma', '\\varsigma', 0x03c2], //GREEK SMALL LETTER FINAL SIGMA
  ['Tau', '\\tau', 0x03c4],
  ['Phi', '\\phi', 0x03d5], // Note GREEK PHI SYMBOL, but common usage in math
  ['PhiLetter', '\\varphi', 0x03c6],
  ['Upsilon', '\\upsilon', 0x03c5],
  ['Chi', '\\chi', 0x03c7],
  ['Psi', '\\psi', 0x03c8],
  ['Omega', '\\omega', 0x03c9],

  ['CapitalAlpha', '\\Alpha', 0x0391],
  ['CapitalBeta', '\\Beta', 0x0392],
  ['CapitalGamma', '\\Gamma', 0x0393],
  ['CapitalDelta', '\\Delta', 0x0394],
  ['CapitalEpsilon', '\\Epsilon', 0x0395],
  ['CapitalZeta', '\\Zeta', 0x0396],
  ['CapitalEta', '\\Eta', 0x0397],
  ['CapitalTheta', '\\Theta', 0x0398],
  ['CapitaIota', '\\Iota', 0x0399],
  ['CapitalKappa', '\\Kappa', 0x039a],
  ['CapitalLambda', '\\Lambda', 0x039b],
  ['CapitalMu', '\\Mu', 0x039c],
  ['CapitalNu', '\\Nu', 0x039d],
  ['CapitalXi', '\\Xi', 0x039e],
  ['CapitalOmicron', '\\Omicron', 0x039f],
  ['CapitalPi', '\\Pi', 0x03a0],
  ['CapitalRho', '\\Rho', 0x03a1],
  ['CapitalSigma', '\\Sigma', 0x03a3],
  ['CapitalTau', '\\Tau', 0x03a4],
  ['CapitalPhi', '\\Phi', 0x03a6],
  ['CapitalUpsilon', '\\Upsilon', 0x03a5],
  ['CapitalChi', '\\Chi', 0x03a7],
  ['CapitalPsi', '\\Psi', 0x03a8],
  ['CapitalOmega', '\\Omega', 0x03a9],

  ['Digamma', '\\digamma', 0x03dd],

  // Hebrew
  ['Alef', '\\aleph', 0x2135], // Unicode ALEF SYMBOL
  ['Bet', '\\beth', 0x2136],
  ['Gimel', '\\gimel', 0x2137],
  ['Dalet', '\\daleth', 0x2138],

  // Letter-like
  ['TurnedCapitalF', '\\Finv', 0x2132], // Unicode TURNED CAPITAL F'
  ['TurnedCapitalG', '\\Game', 0x2141], // TURNED SANS-SERIF CAPITAL G
  ['Weierstrass', '\\wp', 0x2118], // Unicode SCRIPT CAPITAL P
  ['Eth', '\\eth', 0x00f0],
  ['InvertedOhm', '\\mho', 0x2127], // Unicode INVERTED OHM SIGN

  // Symbols
  ['BlackClubSuit', '\\clubsuit', 0x2663],
  ['WhiteHeartSuit', '\\heartsuit', 0x2661],
  ['BlackSpadeSuit', '\\spadesuit', 0x2660],
  ['WhiteDiamondSuit', '\\diamondsuit', 0x2662],
  ['Sharp', '\\sharp', 0x266f],
  ['Flat', '\\flat', 0x266d],
  ['Natural', '\\natural', 0x266e],
];

export const DEFINITIONS_SYMBOLS: LatexDictionary = [
  ...SYMBOLS.map(([symbol, latex, _codepoint]) => {
    return {
      name: symbol,
      trigger: [latex],
      parse: symbol,
    };
  }),
  ...SYMBOLS.map(([symbol, _latex, codepoint]) => {
    return {
      trigger: [String.fromCodePoint(codepoint)],
      parse: symbol,
    };
  }),
];
