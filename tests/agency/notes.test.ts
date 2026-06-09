import { describe, expect, it } from 'vitest';
import { normalizeAgencyNote } from '../../src/agency/notes';

describe('normalizeAgencyNote', () => {
  it('trims whitespace and caps long notes', () => {
    const longNote = `  ${'A'.repeat(520)}  `;

    expect(normalizeAgencyNote(longNote)).toBe('A'.repeat(500));
  });
});
