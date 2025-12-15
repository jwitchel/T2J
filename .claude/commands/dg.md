---
description: Apply design guidelines to code review
argument-hint: [code or request to review]
---

Apply our Design Principles to the following request:

**Six Mandatory Principles:**

1. **Trust the Caller** - NEVER validate typed parameters. If the type is `string`, don't check `if (!param)`.
2. **Throw Hard** - NO try/catch for safety. Let errors propagate. Only catch when you can actually handle it.
3. **Named Types** - NEVER return anonymous objects. NEVER use `any`. Define interfaces for everything.
4. **Private Extraction** - Extract helpers WITHIN existing files. Do NOT create new modules for helpers.
5. **No Defensive Defaults** - NEVER use `|| {}` or `|| []`. If data is missing, that's a bug to fix at the source.
6. **Search Before Creating** - ALWAYS search the codebase before writing new code.

**Additional Rules:**
- Use `??` only for protocol-optional fields (like RFC 5322 optional email headers)
- Use non-null assertions (`!`) when you know the value exists
- Reuse existing services/utilities - don't duplicate

Now apply these principles to:

$ARGUMENTS
