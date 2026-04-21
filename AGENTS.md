# Repository Constraints

When editing this repository, follow these safety rules in addition to the global instructions:

1. Treat terminal-rendered garbled text as a display issue first, not as proof that the source file is corrupted.
2. Prefer `apply_patch` for source edits. Do not use shell scripts or bulk string replacement to rewrite `.tsx`, `.ts`, `.js`, `.jsx`, `.json`, or `.css` files.
3. Avoid copying text from PowerShell output back into source files.
4. For UI work, make small incremental patches:
   - add state
   - add handlers
   - add markup
   - add styles
5. After each substantial source edit, run `npm run build`.
6. If a file contains non-ASCII user-facing text, avoid broad rewrites of existing text blocks unless absolutely necessary.
7. If a scripted edit ever introduces syntax or encoding risk, revert the affected file immediately and re-apply the change with smaller `apply_patch` edits.
