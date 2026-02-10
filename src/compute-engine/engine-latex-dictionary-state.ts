import type { IndexedLatexDictionary } from './latex-syntax/dictionary/definitions';
import { indexLatexDictionary } from './latex-syntax/dictionary/definitions';
import type { LatexDictionaryEntry } from './latex-syntax/types';

type DefaultDictionaryProvider = () => Readonly<LatexDictionaryEntry[]>;

export class EngineLatexDictionaryState {
  private _input: Readonly<LatexDictionaryEntry[]> | undefined;
  private _indexed: IndexedLatexDictionary | undefined;

  constructor(private readonly _defaultProvider: DefaultDictionaryProvider) {}

  get dictionary(): Readonly<LatexDictionaryEntry[]> {
    return this._input ?? this._defaultProvider();
  }

  set dictionary(dictionary: Readonly<LatexDictionaryEntry[]>) {
    this._input = dictionary;
    this._indexed = indexLatexDictionary(dictionary, (signal) => {
      throw Error(
        typeof signal.message === 'string'
          ? signal.message
          : signal.message.join(',')
      );
    });
  }

  get indexedDictionary(): IndexedLatexDictionary {
    this._indexed ??= indexLatexDictionary(this.dictionary, (signal) =>
      console.error(signal)
    );
    return this._indexed;
  }
}
