import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('api imports', () => {
  test('uses runtime-resolvable .js extensions for api imports from src', () => {
    const source = readFileSync(join(process.cwd(), 'api', '_punchCore.ts'), 'utf8');

    expect(source).not.toMatch(/from ['"]\.\.\/src\/[^'"]*(?<!\.js)['"]/);
  });
});
