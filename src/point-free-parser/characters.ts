const LINEBREAK_CHARACTER = [
  0x000a, // LINE FEED
  0x000d, // CARRIAGE RETURN
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
];

// UNICODE IDENTIFIER AND PATTERN SYNTAX:
// https://unicode.org/reports/tr31/#R3

// Pattern_White_Space is an immutable set of characters defined by Unicode.
// See https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt and
// http://unicode.org/L2/L2005/05012r-pattern.html
const PATTERN_WHITE_SPACE = [
  0x0009, // CHARACTER TABULATION
  0x000a, // LINE FEED
  0x000b, // LINE TABULATION
  0x000c, // FORM FEED
  0x000d, // CARRIAGE RETURN
  0x0020, // SPACE
  0x0085, // NEXT LINE
  0x200e, // LEFT-TO-RIGHT MARK
  0x200f, // RIGHT-TO-LEFT MARK
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
];

// Pattern_Syntax is an immutable set of characters defined by Unicode
// See https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt and
// http://unicode.org/L2/L2005/05012r-pattern.html
//
// See https://dev.kwayisi.org/apps/unicode/properties/pattern-syntax/true.html
// Unicode characters with the Pattern_Syntax property are the operators,
// fences and other punctuations.
// Identifiers are characters that are not Pattern_White_Space or Pattern_Syntax
const PATTERN_SYNTAX: (number | [number, number])[] = expand([
  [0x0021, 0x002f], // !"#$%&'()*+,-./
  [0x003a, 0x0040], // :;<=>?@
  [0x005b, 0x005e], // [\]^
  0x0060, // `
  [0x007b, 0x007e], // {|}~
  [0x00a1, 0x00a7], // ¡¢£¤¥¦§
  0x00a9, // ©
  [0x00ab, 0x00ac], // «¬
  0x00ae, // ®
  [0x00b0, 0x00b1], // °±
  0x00b6, // ¶
  0x00bb, // »
  0x00bf, // ¿
  0x00d7, // ×
  0x00f7, // ÷
  [0x2010, 0x203e], // ‐‑‒–—―‖‗‘’‚‛“”„‟†‡•‣․‥…‧‪‫‬‭‮ ‰‱′″‴‵‶‷‸‹›※‼‽‾
  [0x2041, 0x2053], // ⁁⁂⁃⁄⁅⁆⁇⁈⁉⁊⁋⁌⁍⁎⁏⁐⁑⁒⁓
  [0x2190, 0x221a], // ←↑→↓↔↕↖↗↘↙↚↛↜↝↞↟↠↡↢↣↤↥↦↧↨↩↪↫↬↭↮↯↰↱↲↳↴↵↶↷↸↹↺↻↼↽↾↿⇀⇁⇂⇃⇄⇅⇆
  // ⇇⇈⇉⇊⇋⇌⇍⇎⇏⇐⇑⇒⇓⇔⇕⇖⇗⇘⇙⇚⇛⇜⇝⇞⇟⇠⇡⇢⇣⇤⇥⇦⇧⇨⇩⇪⇫⇬⇭⇮⇯⇰⇱⇲⇳⇴⇵⇶⇷⇸⇹⇺⇻⇼⇽⇾⇿∀∁∂∃∄∅∆∇∈∉∊∋∌∍∎
  // ∏∐∑−∓∔∕∖∗∘∙√
  [0x221b, 0x2775], // ∛∜∝∞∟∠∡∢∣∤∥∦∧∨∩∪∫∬∭∮∯∰∱∲∳∴∵∶∷∸∹∺∻∼∽∾∿≀≁≂≃≄≅≆≇≈≉≊≋≌≍≎≏
  // ≐≑≒≓≔≕≖≗≘≙≚≛≜≝≞≟≠≡≢≣≤≥≦≧≨≩≪≫≬≭≮≯≰≱≲≳≴≵
  [0x2794, 0x2e7f], // ➔➕➖➗➘➙➚➛➜➝➞➟➠➡➢➣➤➥➦➧➨➩➪➫➬➭➮➯➰➱➲
  // ➳➴➵➶➷➸➹➺➻➼➽➾➿⟀⟁⟂⟃⟄⟅⟆⟇⟈⟉⟊⟋⟌⟍⟎⟏⟐⟑⟒⟓⟔⟕⟖⟗⟘⟙⟚⟛⟜⟝⟞⟟⟠⟡⟢⟣⟤⟥
  // ⟦⟧⟨⟩⟪⟫⟬⟭⟮⟯⟰⟱⟲⟳⟴⟵⟶⟷⟸⟹⟺⟻⟼⟽⟾⟿⠀
  // ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿
  // ⡀⡁⡂⡃⡄⡅⡆⡇⡈⡉⡊⡋⡌⡍⡎⡏⡐⡑⡒⡓⡔⡕⡖⡗⡘⡙⡚⡛⡜⡝⡞⡟⡠⡡⡢⡣⡤⡥⡦⡧⡨⡩⡪⡫⡬⡭⡮⡯⡰⡱⡲⡳⡴⡵⡶⡷⡸⡹⡺⡻⡼⡽⡾⡿
  // ⢀⢁⢂⢃⢄⢅⢆⢇⢈⢉⢊⢋⢌⢍⢎⢏⢐⢑⢒⢓⢔⢕⢖⢗⢘⢙⢚⢛⢜⢝⢞⢟⢠⢡⢢⢣⢤⢥⢦⢧⢨⢩⢪⢫⢬⢭⢮⢯⢰⢱⢲⢳⢴⢵⢶⢷⢸⢹⢺⢻⢼⢽⢾⢿
  //⣀⣁⣂⣃⣄⣅⣆⣇⣈⣉⣊⣋⣌⣍⣎⣏⣐⣑⣒⣓⣔⣕⣖⣗⣘⣙⣚⣛⣜⣝⣞⣟⣠⣡⣢⣣⣤⣥⣦⣧⣨⣩⣪⣫⣬⣭⣮⣯⣰⣱⣲⣳⣴⣵⣶⣷⣸⣹⣺⣻⣼⣽⣾⣿
  // ⤀⤁⤂⤃⤄⤅⤆⤇⤈⤉⤊⤋⤌⤍⤎⤏⤐⤑⤒⤓⤔⤕⤖⤗⤘⤙⤚⤛⤜⤝⤞⤟⤠
  // ⤡⤢⤣⤤⤥⤦⤧⤨⤩⤪⤫⤬⤭⤮⤯⤰⤱⤲⤳⤴⤵⤶⤷⤸⤹⤺⤻⤼⤽⤾⤿⥀⥁⥂⥃⥄⥅⥆⥇⥈⥉
  // ⥊⥋⥌⥍⥎⥏⥐⥑⥒⥓⥔⥕⥖⥗⥘⥙⥚⥛⥜⥝⥞⥟⥠⥡⥢⥣⥤⥥⥦⥧⥨⥩⥪⥫⥬⥭⥮⥯⥰⥱⥲⥳⥴⥵⥶⥷⥸⥹⥺⥻⥼⥽⥾⥿⦀
  // ⦁⦂⦃⦄⦅⦆⦇⦈⦉⦊⦋⦌⦍⦎⦏⦐⦑⦒⦓⦔⦕⦖⦗⦘⦙⦚⦛⦜⦝⦞⦟⦠⦡⦢⦣⦤⦥⦦⦧⦨⦩⦪⦫⦬⦭⦮⦯⦰⦱⦲⦳⦴⦵⦶⦷⦸⦹⦺⦻⦼⦽⦾⦿⧀⧁⧂⧃⧄⧅⧆⧇⧈⧉⧊⧋⧌⧍
  // ⧎⧏⧐⧑⧒⧓⧔⧕⧖⧗⧘⧙⧚⧛⧜⧝⧞⧟⧠⧡⧢⧣⧤⧥⧦⧧⧨⧩⧪⧫⧬⧭⧮⧯⧰⧱⧲⧳⧴⧵⧶⧷⧸⧹⧺⧻⧼⧽⧾⧿⨀⨁⨂⨃⨄⨅⨆⨇⨈⨉
  // ⨊⨋⨌⨍⨎⨏⨐⨑⨒⨓⨔⨕⨖⨗⨘⨙⨚⨛⨜⨝⨞⨟⨠⨡⨢⨣⨤⨥⨦⨧⨨⨩⨪⨫⨬⨭⨮⨯⨰⨱⨲⨳⨴⨵⨶⨷⨸⨹⨺⨻⨼⨽⨾⨿⩀⩁⩂⩃⩄⩅⩆⩇⩈⩉⩊⩋⩌⩍⩎⩏⩐
  // ⩑⩒⩓⩔⩕⩖⩗⩘⩙⩚⩛⩜⩝⩞⩟⩠⩡⩢⩣⩤⩥⩦⩧⩨⩩⩪⩫⩬⩭⩮⩯⩰⩱⩲⩳⩴⩵⩶⩷⩸⩹⩺⩻⩼⩽⩾⩿⪀⪁⪂⪃⪄⪅⪆⪇⪈⪉⪊⪋⪌⪍⪎⪏⪐⪑⪒⪓⪔⪕⪖⪗⪘
  // ⪙⪚⪛⪜⪝⪞⪟⪠⪡⪢⪣⪤⪥⪦⪧⪨⪩⪪⪫⪬⪭⪮⪯⪰⪱⪲⪳⪴⪵⪶⪷⪸⪹⪺⪻⪼⪽⪾⪿⫀⫁⫂⫃⫄⫅⫆⫇⫈⫉⫊⫋⫌⫍⫎⫏⫐⫑⫒⫓⫔⫕⫖⫗⫘⫙⫚⫛⫝̸⫝⫞⫟⫠⫡
  // ⫢⫣⫤⫥⫦⫧⫨⫩⫪⫫⫬⫭⫮⫯⫰⫱⫲⫳⫴⫵⫶⫷⫸⫹⫺⫻⫼⫽⫾⫿⬀⬁⬂⬃⬄⬅⬆⬇⬈⬉⬊⬋⬌⬍⬎⬏⬐⬑⬒⬓⬔⬕⬖⬗⬘⬙⬚
  // ⬛⬜⬝⬞⬟⬠⬡⬢⬣⬤⬥⬦⬧⬨⬩⬪⬫⬬⬭⬮⬯⬰⬱⬲⬳⬴⬵⬶⬷⬸⬹⬺⬻⬼⬽⬾⬿⭀⭁⭂⭃⭄⭅⭆⭇⭈⭉⭊⭋⭌⭍⭎⭏
  // ⭐⭑⭒⭓⭔⭕⭖⭗⭘⭙⭚⭛⭜⭝⭞⭟⭠⭡⭢⭣⭤⭥⭦⭧⭨⭩⭪⭫⭬⭭⭮⭯⭰⭱⭲⭳⭴⭵⭶⭷⭸⭹⭺⭻⭼⭽⭾⭿⮀⮁⮂⮃⮄⮅⮆⮇⮈⮉⮊⮋⮌⮍⮎⮏⮐⮑⮒⮓⮔⮕⮖
  // ⮗⮘⮙⮚⮛⮜⮝⮞⮟⮠⮡⮢⮣⮤⮥⮦⮧⮨⮩⮪⮫⮬⮭⮮⮯⮰⮱⮲⮳⮴⮵⮶⮷⮸⮹⮺⮻⮼⮽⮾⮿⯀⯁⯂⯃⯄⯅⯆⯇⯈⯉⯊⯋⯌⯍⯎⯏⯐⯑⯒⯓⯔⯕⯖⯗⯘⯙⯚⯛⯜⯝⯞⯟⯠
  // ⯡⯢⯣⯤⯥⯦⯧⯨⯩⯪⯫⯬⯭⯮⯯⯰⯱⯲⯳⯴⯵⯶⯷⯸⯹⯺⯻⯼⯽⯾⯿
  // ⰀⰁⰂⰃⰄⰅⰆⰇⰈⰉⰊⰋⰌⰍⰎⰏⰐⰑⰒⰓⰔⰕⰖⰗⰘⰙⰚⰛⰜⰝⰞⰟⰠⰡⰢⰣⰤⰥⰦⰧⰨⰩⰪⰫⰬⰭⰮⰯⰰⰱⰲⰳⰴ
  //ⰵⰶⰷⰸⰹⰺⰻⰼⰽⰾⰿⱀⱁⱂⱃⱄⱅⱆⱇⱈⱉⱊⱋⱌⱍⱎⱏⱐⱑⱒⱓⱔⱕⱖⱗⱘⱙⱚⱛⱜⱝⱞⱟⱠⱡⱢⱣⱤⱥⱦⱧⱨⱩⱪⱫⱬⱭⱮⱯⱰⱱⱲⱳⱴⱵⱶⱷ
  // ⱸⱹⱺⱻⱼⱽⱾⱿⲀⲁⲂⲃⲄⲅⲆⲇⲈⲉⲊⲋⲌⲍⲎⲏⲐⲑⲒⲓⲔⲕⲖⲗⲘⲙⲚⲛⲜⲝⲞⲟⲠⲡⲢⲣⲤⲥⲦⲧⲨⲩⲪⲫⲬⲭⲮⲯⲰⲱ
  // ⲲⲳⲴⲵⲶⲷⲸⲹⲺⲻⲼⲽⲾⲿⳀⳁⳂⳃⳄⳅⳆⳇⳈⳉⳊⳋⳌⳍⳎⳏⳐⳑⳒⳓⳔⳕⳖⳗⳘⳙⳚⳛⳜⳝⳞⳟⳠⳡⳢⳣⳤ⳥⳦⳧⳨⳩⳪ⳫⳬⳭⳮ⳯⳰⳱Ⳳⳳ⳴⳵⳶⳷⳸
  // ⳹⳺⳻⳼⳽⳾⳿ⴀⴁⴂⴃⴄⴅⴆⴇⴈⴉⴊⴋⴌⴍⴎⴏⴐⴑⴒⴓⴔⴕⴖⴗⴘⴙⴚⴛⴜⴝⴞⴟⴠⴡⴢⴣⴤⴥ⴦ⴧ⴨⴩⴪⴫⴬ⴭ⴮⴯
  // ⴰⴱⴲⴳⴴⴵⴶⴷⴸⴹⴺⴻⴼⴽⴾⴿⵀⵁⵂⵃⵄⵅⵆⵇⵈⵉⵊⵋⵌⵍⵎⵏⵐⵑⵒⵓⵔⵕⵖⵗⵘⵙⵚⵛⵜⵝⵞⵟⵠⵡⵢⵣⵤⵥⵦⵧ
  // ⵨⵩⵪⵫⵬⵭⵮ⵯ⵰⵱⵲⵳⵴⵵⵶⵷⵸⵹⵺⵻⵼⵽⵾⵿ⶀⶁⶂⶃⶄⶅⶆⶇⶈⶉⶊⶋⶌⶍⶎⶏⶐⶑⶒⶓⶔⶕⶖ⶗⶘⶙⶚⶛⶜⶝⶞⶟ⶠⶡ
  // ⶢⶣⶤⶥⶦ⶧ⶨⶩⶪⶫⶬⶭⶮ⶯ⶰⶱⶲⶳⶴⶵⶶ⶷ⶸⶹⶺⶻⶼⶽⶾ⶿ⷀⷁⷂⷃⷄⷅⷆ⷇ⷈⷉⷊⷋⷌⷍ
  // ⷎ⷏ⷐⷑⷒⷓⷔⷕⷖ⷗ⷘⷙⷚⷛⷜⷝⷞ⷟ⷠⷡⷢⷣⷤⷥⷦⷧⷨⷩⷪⷫⷬⷭⷮⷯⷰⷱⷲⷳⷴⷵⷶⷷⷸⷹⷺⷻⷼⷽⷾⷿ⸀⸁⸂⸃⸄⸅⸆⸇⸈⸉⸊⸋⸌⸍⸎⸏⸐⸑⸒⸓⸔⸕⸖⸗⸘⸙⸚⸛⸜⸝⸞⸟⸠⸡⸢⸣⸤⸥⸦⸧⸨⸩⸪⸫⸬⸭⸮ⸯ⸰⸱⸲⸳⸴⸵⸶⸷⸸⸹⸺⸻
  // ⸼⸽⸾⸿⹀⹁⹂⹃⹄⹅⹆⹇⹈⹉⹊⹋⹌⹍⹎⹏⹐⹑⹒⹓⹔⹕⹖⹗⹘⹙⹚⹛⹜⹝⹞⹟⹠⹡⹢⹣⹤⹥⹦⹧⹨⹩⹪⹫⹬⹭⹮⹯⹰⹱⹲⹳⹴⹵⹶⹷⹸⹹⹺⹻⹼⹽⹾⹿
  [0x3001, 0x3003], // 、。〃
  [0x3008, 0x3020], // 〈〉《》「」『』【】〒〓〔〕〖〗〘〙〚〛〜〝〞〟〠
  0x3030, // 〰
  [0xfd3e, 0xfd3f], // ﴾﴿
  [0xfe45, 0xfe46], // ﹅﹆
]);

// The following characters cannot be included in an identifier
const IDENTIFIER_CONTINUE_PROHIBITED = expand([
  [0x0000, 0x0020],
  [0x007f, 0x009f],
  0x005c, // \
  0x0060, // `
  [0xfffe, 0xffff],
]);

// The following characters cannot be the first character of an identifier
const IDENTIFIER_START_PROHIBITED = [
  ...IDENTIFIER_CONTINUE_PROHIBITED,
  0x0021, // EXCLAMATION MARK: **`!`**
  0x0022, // QUOTATION MARK: **`"`**
  0x0023, // NUMBER SIGN: **`#`**
  0x0024, // DOLLAR SIGN: **`$`**
  0x0025, // PERCENT: **`%`**
  0x0026, // AMPERSAND: **`&`**
  0x0027, // APOSTROPHE: **`'`**
  0x0028, // LEFT PARENTHESIS: **`(`**
  0x0029, // RIGHT PARENTHESIS: **`)`**
  0x002e, // FULL STOP: **`'`**
  0x003a, // COLON: **`:`**
  0x003c, // LESS THAN SIGN: **`:`**
  0x003f, // QUESTION MARK: **`?`**
  0x0040, // COMMERCIAL AT: **`@`**
  0x005b, // LEFT SQUARE BRACKET: **`[`**
  0x005d, // RIGHT SQUARE BRACKET: **`]`**
  0x005e, // CIRCUMFLEX ACCENT: **`^`**
  0x007b, // LEFT CURLY BRACKET: **`{`**
  0x007d, // RIGHT CURLY BRACKET: **`}`**
  0x007e, // TILDE: **`~`**
];

// These characters in strings and identifiers may be escaped.
//
// Unicode characters with the White_Space property.
// See: https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt
const WHITE_SPACE = [
  ...PATTERN_WHITE_SPACE,
  0x0000,
  0x00a0, // NO-BREAK SPACE
  0x1680, // OGHAM SPACE MARK
  0x180e, // MONGOLIAN VOWEL SEPARATOR
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
  0x202f, // NARROW NO-BREAK SPACE
  0x205f, // MEDIUM MATHEMATICAL SPACE  4/18em
  0x3000, // IDEOGRAPHIC SPACE
];

// These are a set of characters that are visually confusing.
// When used in identifiers or strings, they should be escaped.
// See http://www.unicode.org/Public/security/revision-05/confusables.txt
const CONFUSABLE_CHARACTERS = [
  0x07fa, // NKO LAJANYALAN ‎ߺ
  0xfe4d, // DASHED LOW LINE ﹍
  0xfe4e, // CENTRELINE LOW LINE ﹎
  0xfe4f, // WAVY LOW LINE ﹏
  0x2010, // HYPHEN
  0x2011, // NON-BREAKING HYPHEN
  0x2012, // FIGURE DASH
  0x2013, // EN DASH
  0xfe58, // SMALL EM DASH
  0x2043, // HYPHEN BULLET
  0x02d7, //MODIFIER LETTER MINUS SIGN,
  0xff5e, // FULLWIDTH TILDE
  0xff1a, // FULLWIDTH COLON → COLON
  0x0589, // ARMENIAN FULL STOP → COLON
  0x0703, // SYRIAC SUPRALINEAR COLON → COLON
  0x0704, // SYRIAC SUBLINEAR COLON → COLON
  0xfe30, // PRESENTATION FORM FOR VERTICAL TWO DOT LEADER → COLON
  0x205a, // TWO DOT PUNCTUATION → COLON
  0x05c3, // HEBREW PUNCTUATION SOF PASUQ → COLON
  0x02f8, // MODIFIER LETTER RAISED COLON → COLON
  0xa789, // MODIFIER LETTER COLON → COLON
  0x2236, // RATIO → COLON
  0xa4fd, // MODIFIER LETTER TRIANGULAR COLON → COLON
  0x037e, // GREEK QUESTION MARK
  0xff01, // FULLWIDTH EXCLAMATION MARK
  0x01c3, // LATIN LETTER RETROFLEX CLICK → EXCLAMATION MARK
  0x0294, // LATIN LETTER GLOTTAL STOP → QUESTION MARK
  0x097d, // DEVANAGARI LETTER GLOTTAL STOP → QUESTION MARK
  0x2024, // ONE DOT LEADER → FULL STOP
  0x06d4, // ARABIC FULL STOP → FULL STOP
  0x0701, // SYRIAC SUPRALINEAR FULL STOP → FULL STOP
  0x0702, // SYRIAC SUBLINEAR FULL STOP → FULL STOP
  0x0660, // ARABIC-INDIC DIGIT ZERO → FULL STOP
  0x06f0, // EXTENDED ARABIC-INDIC DIGIT ZERO → FULL STOP
  0x30fb, // KATAKANA MIDDLE DOT → MIDDLE DOT
  0xff65, // HALFWIDTH KATAKANA MIDDLE DOT → MIDDLE DOT
  0x0387, // GREEK ANO TELEIA → MIDDLE DOT
  0x10101, // AEGEAN WORD SEPARATOR DOT → MIDDLE DOT
  0x2027, // HYPHENATION POINT → MIDDLE DOT
  0xff02, // FULLWIDTH QUOTATION MARK → APOSTROPHE
  0x201c, // LEFT DOUBLE QUOTATION MARK → APOSTROPHE
  0x201d, // RIGHT DOUBLE QUOTATION MARK → APOSTROPHE
];

// In a string or symbol all these characters are escaped to a Unicode escape
// sequence
const INVISIBLE_CHARS: (number | [number, number])[] = expand([
  ...WHITE_SPACE,
  ...CONFUSABLE_CHARACTERS,
  [0x0000, 0x001f], // CC1
  [0x007f, 0x009f], // Delete and CC2
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
  [0xfdd0, 0xfdef], // Non-character
  0xfeff, // Byte Order Mark
  0xfffe, // Byte Order Mark
  0xffff, // Non-character
]);

// When escaped, these characters are escaped to the specified special escape
// sequence
export const ESCAPED_CHARS = new Map([
  [0x0000, '\\0'],
  // [    // 0x0007,  '\\a'], // Alert
  [0x0008, '\\b'], // Backspace
  [0x0009, '\\t'], // Tab
  [0x000a, '\\n'], // Line feed
  // [    // 0x000b,  '\\v'], // Vertical tab
  [0x000c, '\\f'], // Form Feed
  [0x000d, '\\r'], // Carriage Return
  [0x0020, ' '], // We don't escape SPACE
  [0x005c, '\\\\'],
  [0x0027, "\\'"],
  [0x0022, '\\"'],
]);

export const REVERSED_ESCAPED_CHARS = new Map([
  [0x0030, 0x0000], // "\0"
  [0x005c, 0x005c], // "\\"
  [0x0027, 0x0027], // "\'"
  [0x022, 0x0022], // "\\""
  // // [  // 'a',  0x0007],
  [0x0062, 0x0008], // "\b"
  [0x0066, 0x000c], // "\f"
  [0x006e, 0x000a], // "\n"
  [0x0072, 0x000d], // "\r"
  [0x0073, 0x0020], // "\s"
  [0x0074, 0x0009], // "\t"
  // [  // 'v',  0x000b],
]);

// See https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt
// Property: Hex_Digit
export const HEX_DIGITS: Map<number, number> = new Map<number, number>([
  [0x0030, 0], // DIGIT 0
  [0x0031, 1],
  [0x0032, 2],
  [0x0033, 3],
  [0x0034, 4],
  [0x0035, 5],
  [0x0036, 6],
  [0x0037, 7],
  [0x0038, 8],
  [0x0039, 9],
  [0x0061, 10], // LATIN SMALL LETTER A
  [0x0041, 10], // LATIN CAPITAL LETTER A
  [0x0062, 11],
  [0x0042, 11],
  [0x0063, 12],
  [0x0043, 12],
  [0x0064, 13],
  [0x0044, 13],
  [0x0065, 14],
  [0x0045, 14],
  [0x0066, 15],
  [0x0046, 15],
  [0xff10, 0], // FULLWIDTH DIGIT ZERO
  [0xff11, 1],
  [0xff12, 2],
  [0xff13, 3],
  [0xff14, 4],
  [0xff15, 5],
  [0xff16, 6],
  [0xff17, 7],
  [0xff18, 8],
  [0xff19, 9],
  [0xff21, 10], //FULLWIDTH LATIN CAPITAL LETTER A
  [0xff22, 11],
  [0xff23, 12],
  [0xff24, 13],
  [0xff25, 14],
  [0xff26, 15], //FULLWIDTH LATIN CAPITAL LETTER F
  [0xff41, 10], //FULLWIDTH LATIN SMALL LETTER A
  [0xff42, 11],
  [0xff43, 12],
  [0xff44, 13],
  [0xff45, 14],
  [0xff46, 15], //FULLWIDTH LATIN SMALL LETTER F
]);

// Derived from HEX_DIGITS
// (there isn't a Unicode property for decimal digits, but
// there is one for hex digits)
export const DIGITS = new Map<number, number>([
  [0x0030, 0], // DIGIT 0
  [0x0031, 1],
  [0x0032, 2],
  [0x0033, 3],
  [0x0034, 4],
  [0x0035, 5],
  [0x0036, 6],
  [0x0037, 7],
  [0x0038, 8],
  [0x0039, 9],
  [0xff10, 0], // FULLWIDTH DIGIT ZERO
  [0xff11, 1],
  [0xff12, 2],
  [0xff13, 3],
  [0xff14, 4],
  [0xff15, 5],
  [0xff16, 6],
  [0xff17, 7],
  [0xff18, 8],
  [0xff19, 9],
]);

export const SUPERSCRIPT_UNICODE = new Map<number, string>([
  //   0x00bb: '>>',
  [0x2070, '0'], // Superscript
  [0x00b9, '1'], // Superscript
  [0x00b2, '2'], // Superscript
  [0x00b3, '3'], // Superscript
  [0x2074, '4'], // Superscript
  [0x2075, '5'], // Superscript
  [0x2076, '6'], // Superscript
  [0x2077, '7'], // Superscript
  [0x2078, '8'], // Superscript
  [0x2079, '9'], // Superscript
  [0x207a, '+'], // Superscript
  [0x207b, '-'], // Superscript
  [0x207d, '('], // Superscript
  [0x207e, ')'], // Superscript
  [0x2071, 'i'], // Superscript
  [0x207f, 'n'], // Superscript
]);
export const SUBSCRIPT_UNICODE = new Map<number, string>([
  [0x1d62, 'i'], // Subscript
  [0x2080, '0'], // Subscript
  [0x0081, '1'], // Subscript
  [0x0082, '2'], // Subscript
  [0x0083, '3'], // Subscript
  [0x2084, '4'], // Subscript
  [0x2085, '5'], // Subscript
  [0x2086, '6'], // Subscript
  [0x2087, '7'], // Subscript
  [0x2088, '8'], // Subscript
  [0x2089, '9'], // Subscript
  [0x208a, '+'], // Subscript
  [0x208b, '-'], // Subscript
  [0x208d, '('], // Subscript
  [0x208e, ')'], // Subscript
  [0x2090, 'a'], // Subscript
  [0x2091, 'e'], // Subscript
  [0x2092, 'o'], // Subscript
  [0x2093, 'x'], // Subscript
  [0x2097, 'k'], // Subscript
  [0x2098, 'm'], // Subscript
  [0x2099, 'n'], // Subscript
  [0x209c, 't'], // Subscript
  [0x2c7c, 'j'], // Subscript
]);

export const VULGAR_FRACTIONS_UNICODE = new Map<number, string>([
  [0x00bc, '1/4'], // ¼	1⁄4	0.25	Vulgar Fraction One Fourth
  [0x00be, '3/4'], // ¾	3⁄4	0.75	Vulgar Fraction Three Fourths
  [0x2150, '1/7'], // ⅐	1⁄7	0.142857...	Vulgar Fraction One Seventh
  [0x2151, '1/9'], //⅑	1⁄9	0.111...	Vulgar Fraction One Ninth
  [0x2152, '1/10'], // ⅒	1⁄10	0.1	Vulgar Fraction One Tenth
  [0x2153, '1/3'], // ⅓	1⁄3	0.333...	Vulgar Fraction One Third
  [0x2154, '2/3'], // ⅔	2⁄3	0.666...	Vulgar Fraction Two Thirds
  [0x2155, '1/5'], // ⅕	1⁄5	0.2	Vulgar Fraction One Fifth
  [0x2156, '2/5'], // ⅖	2⁄5	0.4	Vulgar Fraction Two Fifths
  [0x2157, '3/5'], // ⅗	3⁄5	0.6	Vulgar Fraction Three Fifths
  [0x2158, '4/5'], // ⅘	4⁄5	0.8	Vulgar Fraction Four Fifths
  [0x2159, '1/6'], // ⅙	1⁄6	0.166...	Vulgar Fraction One Sixth
  [0x215a, '5/6'], // ⅚	5⁄6	0.833...	Vulgar Fraction Five Sixths
  [0x215b, '1/8'], // ⅛	1⁄8	0.125	Vulgar Fraction One Eighth
  [0x215c, '3/8'], // ⅜	3⁄8	0.375	Vulgar Fraction Three Eighths
  [0x215d, '5/8'], // ⅝	5⁄8	0.625	Vulgar Fraction Five Eighths
  [0x215e, '7/8'], // ⅞	7⁄8	0.875	Vulgar Fraction Seven Eighths
  [0x00bd, '1/2'], // ½ VULGAR FRACTION ONE HALF,
]);

export const FANCY_UNICODE = new Map<number, string>([
  //   0x00ab: '<<',
  [0x00ac, '!'], // NOT SIGN ¬
  [0x00b1, '+-'], // PLUS-MINUS SIGN
  [0x2213, '-+'], // MINUS-PLUS SIGN

  [0x00d7, '*'], // × MULTIPLICATION SIGN
  [0x00f7, '/'], // ÷ DIVISION SIGN
  [0x2215, '/'], // ∕ DIVISION SLASH

  [0x2024, '.'], // ONE DOT LEADER
  [0x2025, '..'], // TWO DOT LEADER
  [0x2026, '...'], // HORIZONTAL ELLIPSIS
  [0x2027, '.'], // HYPHENATION POINT
  [0x2032, "'"], // PRIME
  [0x2033, "''"], // DOUBLE PRIME
  [0x2034, "'''"], // TRIPLE PRIME
  [0x2042, '***'], // ⁂ ASTERISM
  [0x2044, '/'], // FRACTION SLASH
  [0x2047, '??'], // DOUBLE QUESTION MARK
  [0x2048, '?!'], // QUESTION EXCLAMATION MARK
  [0x2049, '!?'], // EXCLAMATION QUESTION MARK
  [0x204e, '*'], // 	⁕ LOW ASTERISK
  [0x2051, '**'], // TWO ASTERISKS ALIGNED VERTICALLY
  [0x2056, '...'], // ⁖ THREE DOT PUNCTUATION
  [0x2059, '.....'], // ⁙ FIVE DOT PUNCTUATION
  [0x205a, ':'], // ⁚ TWO DOT PUNCTUATION
  [0x205b, '.:.'], // ⁛ FOUR DOT MARK

  [0x2062, '*'], // Invisible multiply
  [0x2064, '+'], // Invisible plus

  [0x03c0, 'Pi'], // GREEK SMALL LETTER PI
  [0x203c, '!!'], // DOUBLE EXCLAMATION MARK

  [0x2148, 'ImaginaryUnit'], // ⅈ
  [0x2147, 'ExponentialE'], // ⅇ
  [0x2102, 'ComplexNumber'], // ℂ
  [0x211d, 'RealNumber'], // ℝ
  [0x2115, 'NaturalNumber'], // ℕ
  [0x2124, 'Integer'], // ℤ
  [0x211a, 'RationalNumber'], // ℚ

  [0x2190, '<-'],
  [0x2192, '->'], // RIGHTWARDS ARROW
  [0x2194, '<->'],
  // [     0x21A4,  '<-|'],
  [0x21a6, '|->'], // RIGHTWARDS ARROW FROM BAR
  [0x21d0, '=>'],
  [0x21d4, '<=>'],

  [0x2205, 'EmptySet'], // ∅ EMPTY SET
  [0x221e, 'Infinity'], // ∞ INFINITY
  [0x29dd, 'ComplexInfinity'], // ⧝ TIE OVER INFINITY

  [0x2212, '-'], // MINUS
  [0x2218, '.'], // RING OPERATOR (function composition)

  // [    0x22bb,  'Xor'], // ⊻
  [0x22c0, '&&'], // See also \u2227
  [0x22c1, '||'], // See also \u2228

  [0x2227, '&&'], // ∧
  [0x2228, '||'], // ∨
  // [  0x2254,  ':='], // COLON EQUALS
  // [  0x2255,  '=:'], // EQUALS COLON
  [0x2237, '::'],
  [0x2260, '!='], // ≠ NOT EQUAL TO
  [0x2261, '=='], // ≡ IDENTICAL TO	(==)
  [0x2262, '!=='], // ≢	NOT IDENTICAL TO	!(==)
  [0x2263, '==='], // ≣ STRICTLY EQUIVALENT TO
  [0x2a7d, '<='], // LESS-THAN OR SLANTED EQUAL TO
  [0x2a7e, '>='], // GREATER-THAN OR SLANTED EQUAL TO
  [0x2264, '<='],
  [0x2265, '>='],
  [0x2266, '<='],
  [0x2267, '>='],
  [0x226a, '<<'],
  [0x226b, '>>'],

  [0x25b7, '|>'], // WHITE RIGHT-POINTING TRIANGLE
  [0x25c1, '<|'], // WHITE LEFT-POINTING TRIANGLE
  [0x29d0, '||>'], // VERTICAL BAR BESIDE RIGHT TRIANGLE
  [0x29cf, '<||'], // LEFT TRIANGLE BESIDE VERTICAL BAR
  [0x21dd, '~>'], // ⇝ RIGHTWARDS SQUIGGLE ARROW
  [0x21dc, '<~'], // ⇜ LEFTWARDS SQUIGGLE ARROW

  //
  // Perl/Raku support a collection of infix operators
  //
  [0x2208, 'in'], // ∈	(elem)
  [0x2209, '!in'], // ∉	!(elem)
  // 0x220B,	// ∋	(cont)
  // 0x220C, //  ∌	!(cont)
  // 0x2286, // ⊆		(<=)
  // 0x2288, // ⊈		!(<=)
  // 0x2282, // ⊂		(<)
  // 0x2284, //⊄		!(<)
  // 0x2287, // ⊇		(>=)
  // 0x2289, //⊉		!(>=)
  // 0x2283, // ⊃		(>)
  // 0x2285, // ⊅		!(>)
  // 0x222A, //∪		(|)
  // 0x2229, // ∩		(&)
  // 0x2216, // ∖		(-) SetMinus
  // 0x2296, // ⊖		(^)
  // 0x228D, // ⊍		(.)
  // 0x228E, //	(+)

  [0x2a75, '=='],
  [0x2a76, '==='],

  [0x2400, '\\0'], // SYMBOL FOR NULL ␀
  [0x2408, '\\b'], // SYMBOL FOR BACKSPACE ␈
  [0x2409, '\\t'], // SYMBOL FOR TAB ␉
  [0x240a, '\\n'], // SYMBOL FOR LINE FEED ␊
  [0x2424, '\\n'], // SYMBOL FOR NEW LINE ␤
  [0x240d, '\\r'], // SYMBOL FOR CARRIAGE RETURN ␍
]);

export const REVERSE_FANCY_UNICODE = reverse(FANCY_UNICODE);

/**
 * Build the reverse fancy Unicode table from the FANCY_UNICODE table
 */
function reverse(table: Map<number, string>): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const [k, v] of Object.entries(table)) {
    if (result.has(v)) {
      const ks: number[] = result.get(v)!;
      ks.push(parseInt(k));
      result.set(v, ks);
    } else {
      result.set(v, [parseInt(k)]);
    }
  }
  return result;
}

function expand(source: (number | [start: number, end: number])[]): number[] {
  const result: number[] = [];

  for (const entry of source) {
    if (typeof entry === 'number') {
      result.push(entry);
    } else {
      for (let i = entry[0]; i <= entry[1]; i++) {
        result.push(i);
      }
    }
  }

  return result;
}

export function isLinebreak(c: number): boolean {
  return LINEBREAK_CHARACTER.includes(c);
}

/** Most restrictive whitespace only TAB or SPACE */
export function isInlineSpace(c: number): boolean {
  return c === 0x0009 || c === 0x0020;
}

export function isPatternWhitespace(c: number): boolean {
  return PATTERN_WHITE_SPACE.includes(c);
}

/** Everything in pattern white space, plus some other
 * characters considered whitespace */
export function isWhitespace(c: number): boolean {
  return WHITE_SPACE.includes(c);
}

export function isSyntax(c: number): boolean {
  return PATTERN_SYNTAX.includes(c);
}

/** A 'break' character is an whitespace, operator, punctuation, bracket, etc..
 * It indicates the end of an identifier (or number).
 */
export function isBreak(c: number): boolean {
  return WHITE_SPACE.includes(c) || PATTERN_SYNTAX.includes(c);
}

export function isIdentifierContinueProhibited(c: number): boolean {
  return IDENTIFIER_CONTINUE_PROHIBITED.includes(c);
}

export function isIdentifierStartProhibited(c: number): boolean {
  return IDENTIFIER_START_PROHIBITED.includes(c);
}

export function isInvisible(c: number): boolean {
  return INVISIBLE_CHARS.includes(c);
}

export function codePointLength(code: number): number {
  console.assert(String.fromCodePoint(code).length === (code > 0xffff ? 2 : 1));
  return code > 0xffff ? 2 : 1;
}
