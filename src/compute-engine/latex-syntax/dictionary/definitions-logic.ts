import { LatexDictionary } from '../public';

export const DEFINITIONS_LOGIC: LatexDictionary = [
  // Constants
  {
    name: 'True',
    trigger: ['\\mathrm', '<{>', 'T', 'r', 'u', 'e', '<}>'],
    serialize: '\\mathrm{True}',
  },
  {
    name: 'False',
    trigger: ['\\mathrm', '<{>', 'F', 'a', 'l', 's', 'e', '<}>'],
    serialize: '\\mathrm{False}',
  },
  {
    name: 'Maybe',
    trigger: ['\\mathrm', '<{>', 'M', 'a', 'y', 'b', 'e', '<}>'],
    serialize: '\\mathrm{Maybe}',
  },
];
