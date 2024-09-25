export type StyledSpan = {
  fg?: string;
  bg?: string;
  weight?: 'bold' | 'normal' | 'thin';
  italic?: boolean;
  mono?: boolean;
  content: string;
};

/** A paragraph block has a blank line before and after
 * and is wrapped to the width of the terminal.
 *
 * A 'block' is rendered as is, with no wrapping, but possibly
 * with an indent. Used for code blocks, tables.
 *
 * A `blockquote` is a block with a vertical bar on the left,
 * and is wrapped to the available width.
 *
 * A `note`, `warning` or `error` is an admonition block with a
 * colored background or border (blue, orange or red).
 *
 */
export type StyledBlock =
  | {
      tag: 'paragraph' | 'block';
      spans: StyledSpan[];
    }
  | {
      tag: 'blockquote' | 'note' | 'warning' | 'error';
      blocks: StyledBlock[];
    };
