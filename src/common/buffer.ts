export class Buffer {
  s: string;
  pos: number;

  constructor(s: string, pos = 0) {
    this.s = s;
    this.pos = pos;
  }

  atEnd(): boolean {
    return this.pos >= this.s.length;
  }

  peek(): string {
    return this.s[this.pos];
  }

  consume(): string {
    return this.s[this.pos++];
  }

  match(s: string): boolean {
    let i = this.pos;
    for (let j = 0; j < s.length; j++) if (this.s[i++] !== s[j]) return false;

    this.pos += s.length;
    return true;
  }
}
