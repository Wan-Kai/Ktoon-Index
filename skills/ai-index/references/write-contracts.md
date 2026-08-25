# Write contracts

Read this file before every mutation. The CLI accepts JSON only and rejects unknown fields.

## Shared rules

- Categories: `toolkit`, `products`, `articles`, `standards`, `ideas`.
- Ratings: `夯`, `人上人`, `NPC`, or `null`.
- IDs: lowercase ASCII letters, numbers, and single hyphens. IDs never change or become reusable.
- Links: HTTPS only, with no embedded username or password.
- Tags: pass an array; the CLI normalizes NFKC, whitespace, case, and duplicates.
- Personal judgment: restricted Markdown only—paragraphs, bold, italic, lists, inline code, and HTTPS links. Keep HTML, images, embeds, styles, and attachments out.
- `source` is one optional link. `references` is an array of additional links.

## Create

Search before creating. Chinese or non-ASCII titles require an explicit ASCII ID.

```json
{
  "id": "example-agent-tool",
  "title": "Example Agent Tool",
  "summary": "一句简短、可搜索的介绍。",
  "category": "toolkit",
  "tags": ["agents", "debugging"],
  "rating": "人上人",
  "source": {
    "title": "Official site",
    "url": "https://example.com"
  },
  "references": [
    {
      "title": "Introduction",
      "url": "https://example.com/guide",
      "description": "介绍与上手资料"
    }
  ],
  "personal_take": "简短个人判断。"
}
```

Only `title`, `summary`, and `category` are required. Omit optional values rather than inventing them.

```bash
"$RUNNER" entry create --input - --request-id "$REQUEST_ID" <<'JSON'
{ ... }
JSON
```

## Update

Run `entry get <id>` immediately before updating. Copy its top-level `sha` and `entry.version`. The patch uses merge semantics: omitted fields stay unchanged, present fields replace, arrays replace as a whole, and only `rating` or `source` accept `null`.

```json
{
  "expected_version": 3,
  "expected_sha": "0123456789abcdef0123456789abcdef01234567",
  "patch": {
    "personal_take": "补充后的个人判断。",
    "rating": "夯",
    "references": [
      {
        "title": "Deep dive",
        "url": "https://example.com/deep-dive"
      }
    ]
  }
}
```

Patch only the requested fields. Use `[]` to clear tags or references. Use `null` to clear rating or source. An empty or no-op patch fails by design.

```bash
"$RUNNER" entry update <id> --input - --request-id "$REQUEST_ID" <<'JSON'
{ ... }
JSON
```

## Recycle and restore

Both operations require the latest version and SHA from `entry get`:

```json
{
  "expected_version": 4,
  "expected_sha": "0123456789abcdef0123456789abcdef01234567"
}
```

```bash
"$RUNNER" entry delete <id> --input - --request-id "$REQUEST_ID" <<'JSON'
{ ... }
JSON

"$RUNNER" entry restore <id> --input - --request-id "$REQUEST_ID" <<'JSON'
{ ... }
JSON
```

`delete` changes status to `recycled`; it never deletes the file. `restore` changes the same entry back to `published`. Each successful transition increments the content version.
