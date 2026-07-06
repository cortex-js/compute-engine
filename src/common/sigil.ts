// See also: https://typst.app/docs/reference/symbols/sym/

export const ALT_SIGILS = {
  '\\x': '\\times',
  '\\/': '\\div',
  '\\*': '\\ast',
  '\\.': '\\cdot',
  '\\()': '\\circ',
  '\\(+)': '\\oplus',
  '\\(-)': '\\ominus',
  '\\(x)': '\\otimes',
  '\\(/)': '\\oslash',
  '\\(.)': '\\odot',
  '\\...': '\\dots',
  '\\dots.h': '\\dots.h',
  '\\dots.v': '\\dots.v',
  '\\dots.up': '\\dots.up',
  '\\dots.down': '\\dots.down',
  '\\+-': '\\pm',
};

/** This table maps unicode characters to sigils. */
export const SIGILS = {
  '×': '\\times', // \u00D7
  '÷': '\\div', // \u00F7

  '⁎': '\\ast', // \u204E (asterisk operator)
  '⁑': '\\**', // \u2051 (two asterisks aligned vertically)
  '⁂': '\\***', // \u2042 (asterism)
  // '⋅': '\\cdot', // \u22C5 (dot operator)
  // '∗': '\\ast', // \u2217 (asterisk operator)
  '∘': '\\()', // \u2218 (ring operator)

  '⊕': '\\oplus', // \u2295
  '⊖': '\\ominus', // \u2296 (circled minus)
  '⊗': '\\otimes', // \u2297
  '⊘': '\\oslash', // \u2298 (circled division slash)
  '⊙': '\\odot', // \u2299 (circled dot)

  '…': '\\dots', // \u2026 (horizontal ellipsis)
  '‥': '\\dots.h', // \u2025 (two dot leader)

  '⋯': '\\dots.h', // \u22EF (midline horizontal ellipsis)
  '⋮': '\\dots.v', // \u22EE (vertical ellipsis)
  '⋰': '\\dots.up', // \u22F0 (up right diagonal ellipsis)
  '⋱': '\\dots.down', // \u22F1 (down right diagonal ellipsis)

  '±': '\\+-', // \u00B1
  '√': '\\sqrt', // \u221A
  '∛': '\\cbrt', // \u221B
  // '∜': '\\sqrt[4]', // \u221C
  '∞': '\\oo', // \u221E
  // '+∞': '\\+oo', // \u221E
  // '-∞': '\\-oo', // \u221E
  // '~∞': '\\~oo', // \u221E

  '½': '\\1/2', // \u00BD
  '¼': '\\1/4', // \u00BC
  '¾': '\\3/4', // \u00BE

  '⁰': '\\^0', // \u2070 (superscript zero)
  '¹': '\\^1', // \u00B9 (superscript one)
  '²': '\\^2', // \u00B2 (superscript two)
  '³': '\\^3', // \u00B3 (superscript three)
  '⁴': '\\^4', // \u2074 (superscript four)
  '⁵': '\\^5', // \u2075 (superscript five)
  '⁶': '\\^6', // \u2076 (superscript six)
  '⁷': '\\^7', // \u2077 (superscript seven)
  '⁸': '\\^8', // \u2078 (superscript eight)
  '⁹': '\\^9', // \u2079 (superscript nine

  '°': '\\degree', // \u00B0 (degree)

  '→': '\\->', // \u2192
  '←': '\\<-', // \u2190
  '↔': '\\<->', // \u2194
  '↦': '\\|->', // \u21a6

  '≤': '\\<=', // \u2264
  '≥': '\\>=', // \u2265
  '≠': '\\!=', // \u2260
  '≔': '\\:=', // \u2254 (colon equals)
  '⩴': '\\::=', // \u2A74 (double colon equals)

  '≡': '\\===', // \u2261
  '≈': '\\approx', // \u2248
  '≅': '\\cong', // \u2245

  '⌊': '\\|_', // \u230A (left floor)
  '⌋': '\\_|', // \u230B (right floor)
  '⌈': '\\|-', // \u2308 (left ceiling)
  '⌉': '\\-|', // \u2309 (right ceiling)

  '∧': '\\and', // \u2227
  '∨': '\\or', // \u2228
  '⇒': '\\=>', // \u21D2
  '⇔': '\\<=>', // \u21D4
  '∀': '\\forall', // \u2200
  '∃': '\\exists', // \u2203

  // Blackboard letters
  'ℕ': '\\NN', // \u2115 (Natural numbers)
  'ℤ': '\\ZZ', // \u2124 (Integers)
  'ℚ': '\\QQ', // \u211A (Rational numbers)
  'ℝ': '\\RR', // \u211D (Real numbers)
  'ℂ': '\\CC', // \u2102 (Complex numbers)
  'ℙ': '\\PP', // \u2119 (Prime numbers)

  // Greek letters
  'α': '\\alpha', // \u03B1 (Greek small letter alpha)
  'β': '\\beta', // \u03B2 (Greek small letter beta)
  'γ': '\\gamma', // \u03B3 (Greek small letter gamma)
  'δ': '\\delta', // \u03B4 (Greek small letter delta)
  'ε': '\\epsilon', // \u03B5 (Greek small letter epsilon)
  'ζ': '\\zeta', // \u03B6 (Greek small letter zeta)
  'η': '\\eta', // \u03B7 (Greek small letter eta)
  'θ': '\\theta', // \u03B8 (Greek small letter theta)
  'ι': '\\iota', // \u03B9 (Greek small letter iota)
  'κ': '\\kappa', // \u03BA (Greek small letter kappa)
  'λ': '\\lambda', // \u03BB (Greek small letter lambda)
  'μ': '\\mu', // \u03BC (Greek small letter mu)
  'ν': '\\nu', // \u03BD (Greek small letter nu)
  'ξ': '\\xi', // \u03BE (Greek small letter xi)
  'ο': '\\omicron', // \u03BF (Greek small letter omicron)
  'π': '\\pi', // \u03C0 (Greek small letter pi)
  'ρ': '\\rho', // \u03C1 (Greek small letter rho)
  'σ': '\\sigma', // \u03C3 (Greek small letter sigma)
  'τ': '\\tau', // \u03C4 (Greek small letter tau)
  'υ': '\\upsilon', // \u03C5 (Greek small letter upsilon)
  'φ': '\\phi', // \u03C6 (Greek small letter phi)
  'χ': '\\chi', // \u03C7 (Greek small letter chi)
  'ψ': '\\psi', // \u03C8 (Greek small letter psi)
  'ω': '\\omega', // \u03C9 (Greek small letter omega)
  'Α': '\\Alpha', // \u0391 (Greek capital letter alpha)
  'Β': '\\Beta', // \u0392 (Greek capital letter beta)
  'Γ': '\\Gamma', // \u0393 (Greek capital letter gamma)
  'Δ': '\\Delta', // \u0394 (Greek capital letter delta)
  'Ε': '\\Epsilon', // \u0395 (Greek capital letter epsilon)
  'Ζ': '\\Zeta', // \u0396 (Greek capital letter zeta)
  'Η': '\\Eta', // \u0397 (Greek capital letter eta)
  'Θ': '\\Theta', // \u0398 (Greek capital letter theta)
  'Ι': '\\Iota', // \u0399 (Greek capital letter iota)
  'Κ': '\\Kappa', // \u039A (Greek capital letter kappa)
  'Λ': '\\Lambda', // \u039B (Greek capital letter lambda)
  'Μ': '\\Mu', // \u039C (Greek capital letter mu)
  'Ν': '\\Nu', // \u039D (Greek capital letter nu)
  'Ξ': '\\Xi', // \u039E (Greek capital letter xi)
  'Ο': '\\Omicron', // \u039F (Greek capital letter omicron)
  'Π': '\\Pi', // \u03A0 (Greek capital letter pi)
  'Ρ': '\\Rho', // \u03A1 (Greek capital letter rho)
  'Σ': '\\Sigma', // \u03A3 (Greek capital letter sigma)
  'Τ': '\\Tau', // \u03A4 (Greek capital letter tau)
  'Υ': '\\Upsilon', // \u03A5 (Greek capital letter upsilon)
  'Φ': '\\Phi', // \u03A6 (Greek capital letter phi)
  'Χ': '\\Chi', // \u03A7 (Greek capital letter chi)
  'Ψ': '\\Psi', // \u03A8 (Greek capital letter psi)
  'Ω': '\\Omega', // \u03A9 (Greek capital letter omega)

  // Bold mathematical letters
  '𝐚': '\\*a*', // \u1D41A (mathematical bold small a)
  '𝐛': '\\*b*', // \u1D41B (mathematical bold small b)
  '𝐜': '\\*c*', // \u1D41C (mathematical bold small c)
  '𝐝': '\\*d*', // \u1D41D (mathematical bold small d)
  '𝐞': '\\*e*', // \u1D41E (mathematical bold small e)
  '𝐟': '\\*f*', // \u1D41F (mathematical bold small f)
  '𝐠': '\\*g*', // \u1D420 (mathematical bold small g)
  '𝐡': '\\*h*', // \u1D421 (mathematical bold small h)
  '𝐢': '\\*i*', // \u1D422 (mathematical bold small i)
  '𝐣': '\\*j*', // \u1D423 (mathematical bold small j)
  '𝐤': '\\*k*', // \u1D424 (mathematical bold small k)
  '𝐥': '\\*l*', // \u1D425 (mathematical bold small l)
  '𝐦': '\\*m*', // \u1D426 (mathematical bold small m)
  '𝐧': '\\*n*', // \u1D427 (mathematical bold small n)
  '𝐨': '\\*o*', // \u1D428 (mathematical bold small o)
  '𝐩': '\\*p*', // \u1D429 (mathematical bold small p)
  '𝐪': '\\*q*', // \u1D42A (mathematical bold small q)
  '𝐫': '\\*r*', // \u1D42B (mathematical bold small r)
  '𝐬': '\\*s*', // \u1D42C (mathematical bold small s)
  '𝐭': '\\*t*', // \u1D42D (mathematical bold small t)
  '𝐮': '\\*u*', // \u1D42E (mathematical bold small u)
  '𝐯': '\\*v*', // \u1D42F (mathematical bold small v)
  '𝐰': '\\*w*', // \u1D430 (mathematical bold small w)
  '𝐱': '\\*x*', // \u1D431 (mathematical bold small x)
  '𝐲': '\\*y*', // \u1D432 (mathematical bold small y)
  '𝐳': '\\*z*', // \u1D433 (mathematical bold small z)
  '𝐀': '\\*A*', // \u1D400 (mathematical bold capital A)
  '𝐁': '\\*B*', // \u1D401 (mathematical bold capital B)
  '𝐂': '\\*C*', // \u1D402 (mathematical bold capital C)
  '𝐃': '\\*D*', // \u1D403 (mathematical bold capital D)
  '𝐄': '\\*E*', // \u1D404 (mathematical bold capital E)
  '𝐅': '\\*F*', // \u1D405 (mathematical bold capital F)
  '𝐆': '\\*G*', // \u1D406 (mathematical bold capital G)
  '𝐇': '\\*H*', // \u1D407 (mathematical bold capital H)
  '𝐈': '\\*I*', // \u1D408 (mathematical bold capital I)
  '𝐉': '\\*J*', // \u1D409 (mathematical bold capital J)
  '𝐊': '\\*K*', // \u1D40A (mathematical bold capital K)
  '𝐋': '\\*L*', // \u1D40B (mathematical bold capital L)
  '𝐌': '\\*M*', // \u1D40C (mathematical bold capital M)
  '𝐍': '\\*N*', // \u1D40D (mathematical bold capital N)
  '𝐎': '\\*O*', // \u1D40E (mathematical bold capital O)
  '𝐏': '\\*P*', // \u1D40F (mathematical bold capital P)
  '𝐐': '\\*Q*', // \u1D410 (mathematical bold capital Q)
  '𝐑': '\\*R*', // \u1D411 (mathematical bold capital R)
  '𝐒': '\\*S*', // \u1D412 (mathematical bold capital S)
  '𝐓': '\\*T*', // \u1D413 (mathematical bold capital T)
  '𝐔': '\\*U*', // \u1D414 (mathematical bold capital U)
  '𝐕': '\\*V*', // \u1D415 (mathematical bold capital V)
  '𝐖': '\\*W*', // \u1D416 (mathematical bold capital W)
  '𝐗': '\\*X*', // \u1D417 (mathematical bold capital X)
  '𝐘': '\\*Y*', // \u1D418 (mathematical bold capital Y)
  '𝐙': '\\*Z*', // \u1D419 (mathematical bold capital Z)

  // 'ℎ': '\\h', // \u210E (Planck's constant)
  // 'ℏ': '\\hbar', // \u210F (Reduced Planck's constant)
  // 'ℓ': '\\ell', // \u2113 (Script L, often used for length)
  // '℘': '\\wp', // \u2118 (Weierstrass p-function)
  // 'ℑ': '\\Im', // \u2111 (Imaginary part)
  // 'ℜ': '\\Re', // \u211C (Real part)

  // Currencies
  '€': '\\euro', // \u20AC (Euro sign)
  '£': '\\pound', // \u00A3 (Pound sign)
  '¥': '\\yen', // \u00A5 (Yen sign)
  '¢': '\\cent', // \u00A2 (Cent sign)
  '₱': '\\peso', // \u20B1 (Peso sign)
  '₹': '\\rupee', // \u20B9 (Indian Rupee sign)
  '₩': '\\won', // \u20A9 (Won sign)
  '₤': '\\lira', // \u20A4 (Lira sign)
  '₦': '\\naira', // \u20A6 (Naira sign)
  '₫': '\\dong', // \u20AB (Vietnamese Dong sign)
  '₭': '\\kip', // \u20AD (Lao Kip sign)
  '₮': '\\tugrik', // \u20AE (Mongolian Tugrik sign)
  '₨': '\\rupees', // \u20A8 (Rupee sign, used in several South Asian countries)
  '₯': '\\drachma', // \u20AF (Greek Drachma sign)
  '₰': '\\pfennig', // \u20B0 (German Pfennig sign)
  '₲': '\\guarani', // \u20B2 (Paraguayan Guarani sign)

  '∈': '\\in', // \u2208
  '∉': '\\notin', // \u2209
  '∋': '\\ni', // \u220B
  '∌': '\\notni', // \u220C

  '∑': '\\sum', // \u2211
  '∏': '\\prod', // \u220F
  '∂': '\\partial', // \u2202
  '∅': '\\emptyset', // \u2205
  '⊂': '\\subset', // \u2282
  '⊆': '\\subseteq', // \u2286
  '⊃': '\\supset', // \u2283
  '⊇': '\\supseteq', // \u2287
  '∠': '\\angle', // \u2220
  '∫': '\\int', // \u222B
  '∮': '\\oint', // \u222E
  '∇': '\\nabla', // \u2207
  '↗': '\\nearrow', // \u2197
  '↘': '\\searrow', // \u2198
  '↙': '\\swarrow', // \u2199
  '↖': '\\nwarrow', // \u2196
  '∼': '\\sim', // \u223C
  '∝': '\\propto', // \u221D
  '∪': '\\cup', // \u222A
  '∩': '\\cap', // \u2229
  '⊎': '\\uplus', // \u228E
  '⊓': '\\sqcap', // \u2293
  '⊔': '\\sqcup', // \u2294
  '⊥': '\\bot', // \u22A5
  '⊤': '\\top', // \u22A4
  '⊢': '\\vdash', // \u22A2
  '⊣': '\\dashv', // \u22A3
  '⊨': '\\models', // \u22A8
  '⊩': '\\vDash', // \u22A9
  '⊫': '\\Vdash', // \u22AB
  '⊬': '\\nvdash', // \u22AC
  '⊭': '\\nvDash', // \u22AD
  '⊮': '\\nVdash', // \u22AE
  '⊯': '\\nVDash', // \u22AF
  '⊰': '\\prurel', // \u22B0 (precedes under relation)
  '⊱': '\\scurel', // \u22B1 (succeeds under relation)
  '⊲': '\\lhd', // \u22B2
  '⊳': '\\rhd', // \u22B3
  '⊴': '\\unlhd', // \u22B4
  '⊵': '\\unrhd', // \u22B5
  '⊶': '\\origof', // \u22B6
  '⊷': '\\imageof', // \u22B7
  '⊸': '\\multimap', // \u22B8
  '⊹': '\\hermitmatrix', // \u22B9
  '⊺': '\\intercal', // \u22BA
  '⊻': '\\veebar', // \u22BB (xor)
  '⊼': '\\barwedge', // \u22BC (nand)
  '⊽': '\\barvee', // \u22BD (nor)
  '⊾': '\\measuredrightangle', // \u22BE
  '⊿': '\\varlrtriangle', // \u22BF
  '⊀': '\\nprec', // \u2280
  '⊁': '\\nsucc', // \u2281
};
