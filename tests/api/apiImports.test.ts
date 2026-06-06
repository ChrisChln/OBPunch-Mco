import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('api imports', () => {
  test('uses runtime-resolvable .js extensions in the punch api import chain', () => {
    const paths = [
      join(process.cwd(), 'api', '_punchCore.ts'),
      join(process.cwd(), 'src', 'lib', 'staffId.ts'),
      join(process.cwd(), 'src', 'shared', 'agencyRules.ts'),
      join(process.cwd(), 'src', 'shared', 'employeeStatus.ts'),
    ];

    const violations = paths.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const matches = source.matchAll(/from ['"](\.{1,2}\/[^'"]*)['"]/g);
      return Array.from(matches)
        .filter((match) => !match[1].endsWith('.js') && !match[1].endsWith('.css'))
        .map((match) => `${path}: ${match[0]}`);
    });

    expect(violations).toEqual([]);
  });
});
