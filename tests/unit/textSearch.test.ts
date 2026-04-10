import { describe, expect, test } from 'vitest';
import { compactLooseSearchText, matchesLooseSearch, normalizeLooseSearchText } from '../../src/lib/textSearch';

describe('textSearch', () => {
  test('normalizes whitespace and punctuation into searchable text', () => {
    expect(normalizeLooseSearchText('  Carlos   Perez / Outbound  ')).toBe('carlos perez outbound');
  });

  test('builds compact text for no-space matching', () => {
    expect(compactLooseSearchText('Carlos Perez')).toBe('carlosperez');
  });

  test('matches names even when the search term omits spaces', () => {
    expect(matchesLooseSearch('Carlos Perez', 'CarlosPerez')).toBe(true);
  });

  test('matches diacritic variants', () => {
    expect(matchesLooseSearch('Jos\u00E9 N\u00FA\u00F1ez', 'JoseNunez')).toBe(true);
  });

  test('returns false when the normalized text does not match', () => {
    expect(matchesLooseSearch('Carlos Perez', 'Maria')).toBe(false);
  });
});
