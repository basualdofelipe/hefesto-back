import { BadRequestException } from '@nestjs/common';
import { assertSameSet } from './catalog-order';

const MISMATCH_MESSAGE =
  'El orden enviado no coincide con los ítems actuales del catálogo';

describe('assertSameSet (R2 exact-set rule)', () => {
  it.each<[string, string[], string[]]>([
    ['an unknown id', ['a', 'x'], ['a', 'b']],
    ['a duplicate id at equal length', ['a', 'a'], ['a', 'b']],
    ['a missing id', ['a'], ['a', 'b']],
    ['an extra id', ['a', 'b', 'c'], ['a', 'b']],
    ['[] on a non-empty dimension', [], ['a']],
  ])('rejects %s with a 400', (_label, requested, current) => {
    expect(() => assertSameSet(current, requested)).toThrow(
      BadRequestException,
    );
  });

  it.each<[string, string[], string[]]>([
    ['[] on an empty dimension', [], []],
    ['[id] on a single-item dimension', ['a'], ['a']],
    ['a permutation of the current set', ['b', 'a'], ['a', 'b']],
  ])('accepts %s', (_label, requested, current) => {
    expect(() => assertSameSet(current, requested)).not.toThrow();
  });

  it('throws the fixed Spanish mismatch message', () => {
    expect(() => assertSameSet(['a', 'b'], ['a'])).toThrow(MISMATCH_MESSAGE);
  });
});
