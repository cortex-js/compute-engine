import { Buffer } from './buffer';
import { parseSpan, renderSpan as renderSpans } from './markdown-span';
import type {
  TaggedBlock,
  BlockTag,
  TaggedCodeBlock,
  TaggedCallout,
  TaggedList,
  TaggedText,
  TaggedTable,
  TaggedParagraph,
  TaggedHeading,
  TaggedBlockQuote,
} from './markdown-types';
import { StyledBlock } from './styled-text';

// https://devbit-git-course.netlify.app/markdown/#text
// https://github.github.com/gfm/#insecure-characters

export class MarkdownParser extends Buffer {
  constructor(s: string, pos = 0) {
    super(s, pos);
  }

  parseBlocks(): TaggedBlock[] {
    const blocks: TaggedBlock[] = [];
    while (!this.atEnd()) {
      this.skipEmptyLines();

      if (this.atEnd()) break;

      const block = this.parseBlock();
      if (block) {
        blocks.push(block);
      } else {
        // If no block is recognized, consume the line to prevent infinite loops
        this.consumeLine();
      }
    }
    return blocks;
  }

  parseBlock(): TaggedBlock | null {
    this.skipWhitespace();

    if (this.match('#')) {
      return this.parseHeading();
    } else if (this.match('>')) {
      return this.parseBlockquote();
    } else if (this.match('```')) {
      return this.parseCodeBlock();
    } else if (this.match(':::')) {
      return this.parseCallout();
    } else if (
      this.peek() === '*' ||
      this.peek() === '-' ||
      this.peek() === '+' ||
      this.isDigit(this.peek())
    ) {
      return this.parseList();
    } else if (this.peek() === '|') {
      return this.parseTable();
    } else {
      return this.parseParagraph();
    }
  }

  parseHeading(): TaggedBlock {
    let level = 1;
    while (!this.atEnd() && this.peek() === '#' && level < 3) {
      this.consume();
      level++;
    }
    this.skipWhitespace();
    const content = this.readUntil('\n');
    const contentParsed = parseSpan(content.trim());
    const tag: BlockTag = `h${level}` as 'h1' | 'h2' | 'h3';
    return {
      tag,
      content: contentParsed,
    };
  }

  parseBlockquote(): TaggedBlock {
    const contentLines: string[] = [];
    while (true) {
      this.skipWhitespace();
      if (this.match('>')) {
        if (this.peek() === ' ') this.consume();
        const line = this.readUntil('\n');
        contentLines.push(line);
        if (!this.atEnd()) this.consume(); // Consume the newline
      } else if (this.peek() === '\n') {
        // Empty line within blockquote
        contentLines.push('');
        this.consume();
      } else {
        break;
      }
    }
    const contentString = contentLines.join('\n');
    const nestedParser = new MarkdownParser(contentString);
    const contentBlocks = nestedParser.parseBlocks();
    return {
      tag: 'blockquote',
      content: contentBlocks,
    };
  }

  parseCodeBlock(): TaggedCodeBlock {
    const language = this.readUntil('\n').trim();
    const codeLines: string[] = [];
    while (!this.atEnd()) {
      const lineStartPos = this.pos;
      if (this.match('```')) {
        // Check if it's the end of the code block
        if (this.peek() === '\n') this.consume();
        break;
      } else {
        this.pos = lineStartPos; // Reset position if not matching '```'
      }
      const line = this.readUntil('\n');
      codeLines.push(line);
      if (!this.atEnd()) this.consume(); // Consume the newline
    }
    const linesContent = codeLines.map((line) => ({
      content: [{ s: line }],
    }));
    return {
      tag: 'code-block',
      language,
      lines: linesContent,
    };
  }

  parseCallout(): TaggedCallout {
    const typeMatch = this.readUntil('\n')
      .trim()
      .match(/^(info|warning|error)\s*(.*)$/);
    if (!typeMatch) {
      throw new Error('Invalid callout type');
    }
    const type = typeMatch[1] as 'info' | 'warning' | 'error';
    const labelText = typeMatch[2];
    const labelParsed = parseSpan(labelText);
    const contentLines: string[] = [];
    while (!this.atEnd()) {
      const lineStartPos = this.pos;
      if (this.match(':::')) {
        if (this.peek() === '\n') this.consume();
        break;
      } else {
        this.pos = lineStartPos;
      }
      const line = this.readUntil('\n');
      contentLines.push(line);
      if (!this.atEnd()) this.consume(); // Consume the newline
    }
    const contentString = contentLines.join('\n');
    const nestedParser = new MarkdownParser(contentString);
    const contentBlocks = nestedParser.parseBlocks();
    return {
      tag: 'callout',
      type,
      label: labelParsed,
      content: contentBlocks,
    };
  }

  parseList(): TaggedList {
    const items: TaggedText[][] = [];
    let listType: 'ordered-list' | 'unordered-list' = 'unordered-list';
    while (!this.atEnd()) {
      this.skipWhitespace();
      const markerMatch = this.matchListMarker();
      if (markerMatch) {
        const { marker, isOrdered } = markerMatch;
        listType = isOrdered ? 'ordered-list' : 'unordered-list';
        this.skipWhitespace();
        const content = this.readUntil('\n');
        const itemContent = parseSpan(content.trim());
        items.push(itemContent);
        if (!this.atEnd()) this.consume(); // Consume the newline
      } else {
        break;
      }
    }
    return {
      tag: listType,
      items,
    };
  }

  parseTable(): TaggedTable {
    const headerLine = this.readUntil('\n');
    this.consume(); // Consume the newline
    // Skip the separator line
    const separatorLine = this.readUntil('\n');
    this.consume();
    const headerCells = headerLine
      .split('|')
      .map((cell) => parseSpan(cell.trim()));
    const cells: TaggedText[][][] = [];
    while (!this.atEnd()) {
      const line = this.peekLine();
      if (line.trim() === '' || !line.includes('|')) {
        break;
      }
      const rowLine = this.readUntil('\n');
      this.consume();
      const rowCells = rowLine.split('|').map((cell) => parseSpan(cell.trim()));
      cells.push(rowCells);
    }
    return {
      tag: 'table',
      header: headerCells,
      cells,
    };
  }

  parseParagraph(): TaggedBlock {
    const contentLines: string[] = [];
    while (!this.atEnd()) {
      const line = this.peekLine();
      if (
        line.trim() === '' ||
        line.startsWith('#') ||
        line.startsWith('>') ||
        line.startsWith('```') ||
        line.startsWith(':::') ||
        this.isListMarker(line.trim()) ||
        line.startsWith('|')
      ) {
        break;
      }
      contentLines.push(this.readUntil('\n'));
      if (!this.atEnd()) this.consume(); // Consume the newline
    }
    const contentText = contentLines.join('\n');
    const contentParsed = parseSpan(contentText.trim());
    return {
      tag: 'paragraph',
      content: contentParsed,
    };
  }

  // Helper methods
  skipWhitespace() {
    while (!this.atEnd() && (this.peek() === ' ' || this.peek() === '\t')) {
      this.consume();
    }
  }

  skipEmptyLines() {
    while (!this.atEnd()) {
      const line = this.peekLine();
      if (line.trim() === '') {
        this.consumeLine();
      } else {
        break;
      }
    }
  }

  readUntil(char: string): string {
    let result = '';
    while (!this.atEnd() && this.peek() !== char) {
      result += this.consume();
    }
    return result;
  }

  consumeLine() {
    while (!this.atEnd() && this.peek() !== '\n') {
      this.consume();
    }
    if (!this.atEnd() && this.peek() === '\n') {
      this.consume();
    }
  }

  peekLine(): string {
    const currentPos = this.pos;
    let line = '';
    while (!this.atEnd() && this.peek() !== '\n') {
      line += this.consume();
    }
    // Reset position
    this.pos = currentPos;
    return line;
  }

  isDigit(char: string): boolean {
    return /\d/.test(char);
  }

  isListMarker(line: string): boolean {
    return /^(\s*)([*+-]|\d+\.)\s+/.test(line);
  }

  matchListMarker(): { marker: string; isOrdered: boolean } | null {
    const startPos = this.pos;
    const match = this.s.slice(this.pos).match(/^(\s*)([*+-]|\d+\.)\s+/);
    if (match) {
      const marker = match[2];
      this.pos += match[0].length;
      const isOrdered = /^\d+\.$/.test(marker);
      return { marker, isOrdered };
    } else {
      this.pos = startPos;
      return null;
    }
  }
}

export function parseMarkdownBlock(s: string): TaggedBlock[] {
  const parser = new MarkdownParser(s);
  return parser.parseBlocks();
}

function renderParagraph(block: TaggedParagraph): StyledBlock {
  return {
    tag: 'paragraph',
    spans: renderSpans(block.content),
  };
}

function renderHeading(block: TaggedHeading): StyledBlock {
  if (block.tag === 'h1') {
    return {
      tag: 'paragraph',
      spans: renderSpans(
        block.content.map((span) => ({
          ...span,
          s: span.s.toUpperCase(),
          fg: 'blue',
        }))
      ),
    };
  }

  if (block.tag === 'h2') {
    return {
      tag: 'paragraph',
      spans: renderSpans(
        block.content.map((span) => ({
          ...span,
          s: span.s.toUpperCase(),
          fg: 'bright-blue',
        }))
      ),
    };
  }

  return {
    tag: 'paragraph',
    spans: renderSpans(block.content),
  };
}

function renderBlockquote(block: TaggedBlockQuote): StyledBlock {
  return {
    tag: 'blockquote',
    blocks: block.content.flatMap((b) => renderMarkdownBlock([b])),
  };
}

function renderCodeBlock(block: TaggedCodeBlock): StyledBlock {
  return {
    tag: 'block',
    spans: block.lines.flatMap((line) => renderSpans(line.content)),
  };
}

// function renderCallout(block: TaggedCallout): StyledBlock {
//   return {
//     tag: 'block',
//     blocks: [
//       {
//         tag: 'paragraph',
//         spans: renderSpans(block.label),
//       },
//       ...block.content.flatMap((b) => renderMarkdownBlock([b])),
//     ],
//   };
// }

export function renderMarkdownBlock(blocks: TaggedBlock[]): StyledBlock[] {
  const result: StyledBlock[] = [];
  for (const block of blocks) {
    switch (block.tag) {
      case 'paragraph':
        result.push(renderParagraph(block));
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        result.push(renderHeading(block));
        break;
      case 'blockquote':
        result.push(renderBlockquote(block));
        break;
      case 'code-block':
        result.push(renderCodeBlock(block));
        break;
      // case 'callout':
      //   result.push(renderCallout(block));
      //   break;
      // case 'ordered-list':
      // case 'unordered-list':
      //   result.push(renderList(block));
      //   break;
      // case 'table':
      //   result.push(renderTable(block));
      //   break;
    }
  }
  return result;
}
