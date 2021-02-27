//
// Generic code formatter
//
// Based on "A New Approach to Optimal Code Formatting",
// Phllip M. Yelland, Google.
// https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/44667.pdf
//
// See also:
//
// 1998, Philip Wadler "A Prettier Printer"
// https://homepages.inf.ed.ac.uk/wadler/papers/prettier/prettier.pdf
//
// 1995, John Hughes. "The design of a pretty-printer library"
// http://belle.sourceforge.net/doc/hughes95design.pdf
//
// 1980, Derek C. Oppen, "Prettyprinting"
// https://www.cs.tufts.edu/~nr/cs257/archive/derek-oppen/prettyprinting.pdf

export type FormatingOptions = {
  indentChar: string; // Which char to use to represent indents? Default: '\u0020
  indentCharWidth: number; // How many spaces does an `indentChar` represent? Default: 1
  indentWidth: number; // How many indentChar for an indent?
  margin: number; // Maximum right column
  softMargin: number; // Column before `margin` to encourage breaking
  aroundInfixOperator: string; // Spacing around infix operators. Default: '\u0020' (fancy alternate: '\u205f')
  aroundRelationalOperator: string; // Spacing around infix operators. Default: '\u0020' (fancy alternate: '\u2005')
  afterSeparator: string; // Spacing after separator (',', ';'). Default: '\u0020' (fancy alt: '\u2009)
  cost: FormatingCosts;
};

export type FormatingCosts = {
  softMargin: number; // Cost per character beyond the soft margin
  margin: number; // Cost per char beyond the hard margin
  linebreak: number; // Cost per line break
  commentLinebreak: number; // Adjustment to line break costs in inline comments
  flowLinebreak: number; // Adjustment to line break costs in flow control statements
  callLinebreak: number; // Adjustment to line break in function calls
  argLinebreak: number; // Adjustment to line break cost in argument expressions
};

export abstract class FormattingBlock {
  protected fmt: Formatter;

  /** Return a printable string representing this block */
  abstract serialize(offset: number): string;

  /** When starting at `offset`, what is the cost of this block */
  abstract cost(offset: number): number;

  /** When starting at `offset`, what is the column after this block */
  abstract nextCol(offset: number): number;

  /** Output debug representation of the block */
  abstract debug(): string;

  constructor(fmt: Formatter) {
    this.fmt = fmt;
  }
}

export class EmptyBlock extends FormattingBlock {
  constructor(fmt: Formatter) {
    super(fmt);
  }
  debug(): string {
    return 'EmptyBlock';
  }
  serialize(_offset: number): string {
    return '';
  }
  nextCol(offset: number): number {
    return offset;
  }
  cost(_offset: number): number {
    return 0;
  }
}

/**
 *
 *      |                 |        |
 *
 *      |    [--------]*  |        |
 *
 *      |    [------------|---]*   |
 *
 *      |    [------------|--------|---]*
 *
 *      |                 |        |
 *      0                          margin
 *                        soft-margin
 *
 */
export class TextBlock extends FormattingBlock {
  s: string;
  constructor(fmt: Formatter, s: string) {
    super(fmt);
    this.s = s;
  }
  debug(): string {
    if (this.s === ' ') return '" "';
    return '"' + this.s + '"';
  }
  serialize(_offset: number): string {
    return this.s;
  }
  nextCol(offset: number): number {
    return offset + this.s.length;
  }
  cost(offset: number): number {
    const next = this.nextCol(offset);
    if (next >= this.fmt.margin) {
      return (
        (next - this.fmt.margin) * this.fmt.cost.margin +
        (this.fmt.margin - this.fmt.softMargin) * this.fmt.cost.softMargin
      );
    }

    if (next >= this.fmt.softMargin) {
      return (next - this.fmt.softMargin) * this.fmt.cost.softMargin;
    }
    return 0;
  }
}

/**
 * A block that places its elements in a single line
 *
 * 0    offset
 * |
 * |    [--------][-----------][------][----------]*
 * |
 */
export class LineBlock extends FormattingBlock {
  private blocks: FormattingBlock[];
  constructor(fmt: Formatter, ...blocks: FormattingBlock[]) {
    super(fmt);
    this.blocks = blocks;
  }
  debug(): string {
    return 'Line(' + this.blocks.map((x) => x.debug()).join(', ') + ')';
  }
  serialize(offset: number): string {
    const fragments: string[] = [];
    for (const block of this.blocks) {
      fragments.push(block.serialize(offset));
      offset = block.nextCol(offset);
    }
    return fragments.join('');
  }
  nextCol(offset: number): number {
    return this.blocks.reduce((acc, val) => val.nextCol(acc), offset);
  }
  cost(offset: number): number {
    let result = 0;
    for (const block of this.blocks) {
      result += block.cost(offset);
      offset = block.nextCol(offset);
    }
    return result;
  }
}

/**
 * A block that arranges its elements vertically, separated by line breaks.
 *
 *      0    offset
 *      |
 *      |    [---1----]
 *      |    [-----2------]
 *      |    [--3--]
 *      |    [----4----]
 *      |    *
 *      |
 */

export class StackBlock extends FormattingBlock {
  private blocks: FormattingBlock[];
  constructor(fmt: Formatter, ...blocks: FormattingBlock[]) {
    super(fmt);
    this.blocks = blocks;
  }
  debug(): string {
    return 'Stack(' + this.blocks.map((x) => x.debug()).join(', ') + ')';
  }
  serialize(offset: number): string {
    let result = '';
    let indent = '';
    for (const block of this.blocks) {
      result += indent + block.serialize(offset);
      if (!indent) indent = this.fmt.newLine() + this.fmt.indentChars(offset);
    }

    return result;
  }
  nextCol(offset: number): number {
    return offset;
  }
  cost(offset: number): number {
    return this.blocks.reduce(
      (acc, val) => this.fmt.cost.linebreak + acc + val.cost(offset),
      0
    );
  }
}

/**
 * A block that arranges its elements like a justified paragraph
 *
 *      |                            |
 *      |    [---1----][----2------] |
 *      |    [--3---][----4-----]    |
 *      |    [--5--][--6---][--7--]  |
 *      |    [---8----]*             |
 *      |                            |
 *
 */
export class WrapBlock extends FormattingBlock {
  private blocks: FormattingBlock[];
  constructor(fmt: Formatter, ...blocks: FormattingBlock[]) {
    super(fmt);
    this.blocks = blocks;
  }
  debug(): string {
    return 'Wrap(' + this.blocks.map((x) => x.debug()).join(', ') + ')';
  }

  solution(offset: number): FormattingBlock {
    const lines: FormattingBlock[][] = [];
    let line: FormattingBlock[] = [];

    for (const block of this.blocks) {
      if (line.length === 0) {
        // If nothing on the line yet, add this block
        line.push(block);
      } else {
        // At least one item on the line. Does this new item fit?
        const lineBlock = new LineBlock(this.fmt, ...line, block);
        if (lineBlock.nextCol(offset) <= this.fmt.margin) {
          // It fits!
          line.push(block);
        } else {
          // Does not fit
          lines.push(line);
          line = [block];
        }
      }
    }

    // Don't forget the last line
    if (line.length !== 0) lines.push(line);

    return new StackBlock(
      this.fmt,
      ...lines.map((x) => new LineBlock(this.fmt, ...x))
    );
  }

  serialize(offset: number): string {
    return this.solution(offset).serialize(offset);
  }
  nextCol(offset: number): number {
    return this.solution(offset).nextCol(offset);
  }
  cost(offset: number): number {
    return this.solution(offset).cost(offset);
  }
}

// export class VerbatimBlock extends FormattingBlock {
//   private block: FormattingBlock;
//   constructor(fmt: Formatter, block: FormattingBlock) {
//     super(fmt);
//     this.block = block;
//   }
//   serialize(offset: number): string {
//     return '';
//   }
//   nextCol(offset: number): number {
//     return 0;
//   }
//   cost(offset: number): number {
//     return 0;
//   }
// }

export class ChoiceBlock extends FormattingBlock {
  private blocks: FormattingBlock[];
  constructor(fmt: Formatter, ...blocks: FormattingBlock[]) {
    super(fmt);
    this.blocks = blocks;
  }
  debug(): string {
    return (
      'Choice(\n  ' + this.blocks.map((x) => x.debug()).join('\n  ') + '\n)'
    );
  }
  // Which block would be chosen if starting at column `offset`
  choice(offset: number): FormattingBlock {
    let block: FormattingBlock;
    let minCost = Infinity;
    this.blocks.forEach((x) => {
      const cost = x.cost(offset);
      if (cost < minCost) {
        minCost = cost;
        block = x;
      }
    });
    return block;
  }
  serialize(offset: number): string {
    return this.choice(offset).serialize(offset);
  }
  nextCol(offset: number): number {
    return this.choice(offset).nextCol(offset);
  }
  cost(offset: number): number {
    return Math.min(...this.blocks.map((x) => x.cost(offset)));
  }
}

export class Formatter {
  private options: FormatingOptions;
  constructor(options?: FormatingOptions) {
    if (options?.indentChar === 'space') {
      options.indentChar = '\u0020';
    } else if (options?.indentChar === 'tab') {
      options.indentChar = '\t';
    }
    this.options = {
      cost: {
        softMargin: 0.05,
        margin: 100,
        linebreak: 2,
        commentLinebreak: 0.5,
        flowLinebreak: 0.3,
        callLinebreak: 0.5,
        argLinebreak: 5,
        ...(options?.cost ?? {}),
      },
      indentChar: '\u0020',
      indentCharWidth: 1,
      indentWidth: 2,
      margin: 80,
      softMargin: 50,
      aroundInfixOperator: '\u0020',
      aroundRelationalOperator: '\u0020',
      afterSeparator: '\u0020',
      ...(options ?? {}),
    };
  }
  get cost(): FormatingCosts {
    return this.options.cost;
  }
  get margin(): number {
    return this.options.margin;
  }
  get softMargin(): number {
    return this.options.softMargin;
  }
  indentChars(n = 1): string {
    return (this.options.indentChar === 'tab' ? '\t' : ' ').repeat(
      n * this.options.indentWidth
    );
  }
  indentLength(n = 1): number {
    return n * this.options.indentWidth * this.options.indentCharWidth;
  }
  newLine(a?: string, b?: string): string {
    if (!a && !b) return '\n';
    if (!b) return a + '\n';
    return a + '\n' + b;
  }

  countNewlines(s: string): number {
    return s.split(/\r\n|\r|\n/).length;
  }

  normalizedBlocks(blocks: (string | FormattingBlock)[]): FormattingBlock[] {
    return blocks
      .map((x) => (typeof x === 'string' ? new TextBlock(this, x) : x))
      .filter((x) => !(x instanceof EmptyBlock));
  }

  /** A binary or ternary operator: +, -, etc... */
  infixOperator(op: string): TextBlock {
    return new TextBlock(
      this,
      this.options.aroundInfixOperator + op + this.options.aroundInfixOperator
    );
  }

  /** A relational operator: =, <=, etc.. */
  relationalOperator(op: string): TextBlock {
    return new TextBlock(
      this,
      this.options.aroundRelationalOperator +
        op +
        this.options.aroundRelationalOperator
    );
  }

  separator(op: string): TextBlock {
    return new TextBlock(this, op + this.options.afterSeparator);
  }

  fence(f: string): TextBlock {
    return new TextBlock(this, f);
  }

  /** A single line of unbroken text */
  text(s?: string): EmptyBlock | TextBlock {
    if (!s || s.length === 0) return new EmptyBlock(this);
    return new TextBlock(this, s);
  }

  /** Horizontal juxtaposition of a list of blocks */
  line(...inBlocks: (string | FormattingBlock)[]): FormattingBlock {
    const blocks = this.normalizedBlocks(inBlocks);

    // Consecutive text blocks can be merged
    const mergedBlocks = [];
    let previousText = '';
    for (const block of blocks) {
      if (block instanceof TextBlock) {
        if (previousText) {
          mergedBlocks.pop();
          previousText = previousText + block.s;
          mergedBlocks.push(new TextBlock(this, previousText));
        } else {
          mergedBlocks.push(block);
          previousText = block.s;
        }
      } else {
        previousText = '';
        mergedBlocks.push(block);
      }
    }

    if (mergedBlocks.length === 1) return mergedBlocks[0];

    return new LineBlock(this, ...mergedBlocks);
  }

  /** A list of block stacked on top of one another */
  stack(...inBlocks: (string | FormattingBlock)[]): FormattingBlock {
    const blocks = this.normalizedBlocks(inBlocks);
    if (blocks.length === 1) return blocks[0];

    return new StackBlock(this, ...blocks);
  }

  /** Packs its constituent layouts horizontally, inserting line breaks
   * between them so as to minimize the total cost of output, in a manner
   * analogous to the composition of words in paragraph.
   *
   * Output after line breaks begins at the starting column of the entire
   * block.
   * */
  wrap(...inBlocks: (string | FormattingBlock)[]): FormattingBlock {
    const blocks = this.normalizedBlocks(inBlocks);
    if (blocks.length === 1) return blocks[0];

    return new WrapBlock(this, ...blocks);
  }

  /** Indent a block by `indent` units. The value of a unit is specified in the options */
  indent(block: FormattingBlock, indent = 1): FormattingBlock {
    return new LineBlock(
      this,
      new TextBlock(this, this.indentChars(indent)),
      block
    );
  }

  choice(...inBlocks: (string | FormattingBlock)[]): FormattingBlock {
    const blocks = this.normalizedBlocks(inBlocks);
    if (blocks.length === 1) return blocks[0];
    return new ChoiceBlock(this, ...blocks);
  }

  fencedBlock(
    open: string,
    block: FormattingBlock,
    close: string
  ): FormattingBlock {
    if (!block) return this.line(this.fence(open), this.fence(close));
    return this.fencedList(open, '', close, [block]);
  }

  fencedList(
    open: string,
    sep: string | FormattingBlock,
    close: string,
    blocks: FormattingBlock[]
  ): FormattingBlock {
    const openBlock = this.fence(open);
    const closeBlock = this.fence(close);
    if (blocks.length === 0) return this.line(openBlock, closeBlock);

    if (blocks.length === 1) {
      return this.line(openBlock, blocks[0], closeBlock);
    }

    // `sepBlocks` has all the elements followed by a separator
    const sepBlocks: FormattingBlock[] = blocks.map((block) =>
      this.line(block, sep)
    );

    // `inlineSepBlocks` has a separator between each element (but not after
    // the last one).
    const inlineSepBlocks: FormattingBlock[] = [...sepBlocks];
    inlineSepBlocks.pop();
    inlineSepBlocks.push(blocks[blocks.length - 1]);

    if (!open && !close) {
      return this.choice(
        this.line(...inlineSepBlocks),
        this.wrap(...sepBlocks)
      );
    }
    return this.choice(
      this.line(openBlock, ...inlineSepBlocks, closeBlock),
      this.stack(openBlock, this.indent(this.stack(...sepBlocks)), closeBlock)
    );
  }

  list(
    sep: string | FormattingBlock,
    blocks: FormattingBlock[]
  ): FormattingBlock {
    return this.fencedList(undefined, sep, undefined, blocks);
  }

  /** A block that prints out several lines of text verbatim. */
  // verbatim(block: FormattingBlock): FormattingBlock {
  //   return new VerbatimBlock(this, block);
  // }
}
