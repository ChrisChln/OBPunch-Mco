import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

describe('serverless ESM imports', () => {
  test('keeps shared position imports resolvable after Vercel emits JavaScript', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/shared/positions.ts'), 'utf8');

    expect(source).toContain("from '../lib/labelTone.js'");
  });
});
