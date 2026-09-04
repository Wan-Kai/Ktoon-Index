# Research publishing

Use this branch when a research task includes a standing instruction to publish useful discoveries to Ktoon's Index. The research conclusion is the input; the `ai-index` runner remains the only content interface.

## Capture policy

Create an entry when the user explicitly selects it or the active research handoff instructs you to publish accepted findings. A candidate is accepted only when it has a stable identity, a concise factual summary, and an HTTPS primary source. Skip incidental mentions, rejected candidates, inaccessible sources, and items whose identity is still uncertain.

The standing handoff authorizes content mutations for accepted findings; it does not authorize guessed personal opinions. Set `rating` and `personal_take` only when the user supplied that judgment. Otherwise omit both fields so the entry is visibly unrated and can be reviewed later.

## Category decision

Assign exactly one category by the identity of the indexed object:

| Primary identity of the indexed object                                               | Category    |
| ------------------------------------------------------------------------------------ | ----------- |
| Normative protocol, specification, convention, or interoperability standard          | `standards` |
| Article, tutorial, report, newsletter issue, or paper being preserved as reading     | `articles`  |
| Skill, library, framework, developer utility, or tool integrated into a workflow     | `toolkit`   |
| Standalone product, hosted service, platform, or end-user application                | `products`  |
| Original concept, proposal, hypothesis, or product idea without a canonical artifact | `ideas`     |

Classify the object, not the page that describes it. For a hybrid tool/platform, use `toolkit` when the reason for indexing it is integration into code, an Agent, or a development workflow; use `products` when the reason is using its standalone interface or hosted service. Do not duplicate the same identity merely because it supports both modes. A product discovered through an article is a product entry whose article may be a reference. Create a separate article entry only when the publication itself has independent reading value.

## Field extraction

- `title`: use the source's canonical name or article title.
- `id`: use a short lowercase ASCII slug. Provide it explicitly for non-ASCII titles. Search the slug before creating; IDs are immutable and never reusable.
- `summary`: write one factual, searchable sentence about what the object is or what the article explains. Keep recommendations and opinions out.
- `source`: use the canonical official page, repository, specification, or original article. For an article, this is normally the original publication URL.
- `references`: retain only additional high-signal links that materially help evaluation or use. Do not repeat `source`.
- `tags`: run `tag list` and reuse an existing normalized tag when it means the same thing. Add a new concise tag only when it improves future retrieval.
- `rating` and `personal_take`: preserve the user's wording and intent; omit them when no user judgment exists.

## Per-task workflow

1. Follow the main Skill's setup and run its `doctor` gate once for the task.
2. Turn the research output into accepted candidates using the capture policy. Keep rejected and uncertain findings in the research report instead of the Index.
3. Process candidates sequentially. Use `entry search` for the canonical title and common aliases. Use `entry get <likely-id>` for a likely slug because search does not inspect IDs. Use `entry list` and compare canonical source URLs across plausible candidates; the same source is the same identity even when its title or summary changed. Include recycled entries in duplicate decisions because their IDs remain reserved.
4. If no equivalent entry exists, construct one create request from `write-contracts.md`. If a published equivalent exists, run `entry get <id>` and update only factual fields that the new research genuinely improves. Preserve its `rating` and `personal_take` unless the user supplied a replacement; make no mutation when nothing improves. If the equivalent entry is recycled, report it as a duplicate that remains recycled. Restore it only after the maintainer explicitly asks to restore that ID; a general research-publishing handoff is not restore authorization.
5. Execute each accepted mutation through the main Skill's Mutation workflow and Completion rules. Categorize the final report as created, updated, skipped-as-duplicate, or failed.

Any CLI failure leaves this research-specific branch and follows `error-recovery.md`. Its stop conditions decide whether later candidates may proceed; do not invent a batch-level recovery path here.

## Handoff instruction

Give the receiving Agent this project Skill and the following standing instruction:

> Use `$ai-index` during this research. Apply its research-publishing workflow to each accepted product, tool, article, standard, or idea. Publish sequentially through the bundled CLI, never by editing content files. Omit my rating and personal judgment unless I explicitly provide them. Return the research result together with the per-entry CLI receipts and deployment status.
