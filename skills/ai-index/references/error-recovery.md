# Error recovery

Use `error.code` as the decision point. Keep the CLI rule intact; change the request or environment, not the fact source.

| Code                | Recovery                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_FOUND`         | Search/list for the correct immutable ID. Create only when the user intended a new item.                                                                                                                          |
| `ID_CONFLICT`       | Get the existing ID. Update it if it is the same item; otherwise ask for or choose a genuinely different explicit ID. Recycled IDs remain reserved.                                                               |
| `VERSION_CONFLICT`  | Get the entry again, re-evaluate the user's intent against the new content, rebuild the guard/patch, and use a new request ID for the rebased operation.                                                          |
| `VALIDATION_FAILED` | Read `details`, correct the JSON, enum, link, Markdown, status, or no-op request, then use a new request ID when the intended payload changes.                                                                    |
| `AUTH_REQUIRED`     | Run `doctor`; ask the maintainer to complete `gh auth login`. Resume only after doctor reports authenticated.                                                                                                     |
| `FORBIDDEN`         | Run `doctor`; stop and ask the maintainer to restore repository write permission.                                                                                                                                 |
| `GITHUB_ERROR`      | If the write outcome may be ambiguous, retry the exact command once with the same request ID. An idempotent receipt is success. If failure repeats, stop with the request ID and error details for investigation. |
| `BUILD_FAILED`      | The content mutation was not made by this command or publication validation failed. Report the build issue; inspect Actions separately or wait for the next corrective publication.                               |

## Retry identity

- Same intent, same payload, uncertain transport outcome: reuse the same request ID.
- New payload after validation correction: use a new request ID.
- Rebased payload after version conflict: use a new request ID.
- A response with `idempotent: true` is a recovered success and must not be followed by another write.

## Stop conditions

Stop instead of improvising when authentication or permission is absent, repeated GitHub failure remains ambiguous, the user's target entry cannot be identified, or resolving a conflict would change their intended content. Return the last command's machine-readable code, request ID when present, and the next human action.
