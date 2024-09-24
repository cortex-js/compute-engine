export type SpanTag =
  | 'default'
  /** In text, an inline code fragment */
  | 'code'
  /** In text, some bold text */
  | 'b'
  /** In text, some italic text */
  | 'i'
  | 'em';

export type BlockTag =
  /** In text, a first level heading */
  | 'h1'
  /** In text, a second level heading */
  | 'h2'
  /** In text, a third level heading */
  | 'h3'
  /** In text, a block quote  */
  | 'blockquote'
  /** In text, a paragraph */
  | 'paragraph'
  | 'code-block'
  | 'callout';
// | 'table'

export type Tag = SpanTag | BlockTag;

export type TaggedText = TaggedSpan | TaggedBlock;

export type TaggedSpan = {
  tag?: SpanTag;
  s: string;
};

export type TaggedBlock =
  | TaggedHeading
  | TaggedBlockQuote
  | TaggedParagraph
  | TaggedCodeBlock
  | TaggedList
  | TaggedTable
  | TaggedCallout;

export type TaggedHeading = {
  tag: 'h1' | 'h2' | 'h3';
  content: TaggedSpan[];
};

export type TaggedBlockQuote = {
  tag: 'blockquote';
  content: TaggedBlock[];
};

export type TaggedParagraph = {
  tag: 'paragraph';
  content: TaggedSpan[];
};

export type TaggedCodeBlock = {
  tag: 'code-block';
  language: string;
  lineStart?: number;
  lineMark?: number | string;
  lines: { line?: number; content: TaggedSpan[] }[];
};

export type TaggedList = {
  tag: 'ordered-list' | 'unordered-list';
  items: TaggedText[][];
};

export type TaggedTable = {
  tag: 'table';
  header: TaggedText[][];
  cells: TaggedText[][][];
};

export type TaggedCallout = {
  tag: 'callout';
  type: 'info' | 'warning' | 'error';
  label: TaggedText[];
  content: TaggedText[];
};
