import { describe, expect, it } from "vitest";

import {
  applyEntryUpdate,
  createEntry,
  parseEntry,
  parseUpdateEntryRequest,
  serializeEntry,
  transitionEntryStatus,
  type Entry,
} from "../src/content/index.ts";
import { GitHubContentClient, type GhRunner } from "../src/github/index.ts";

type Stored = { source: string; sha: string };
type Commit = {
  sha: string;
  commit: { message: string };
  files: Array<{ filename: string; status: string }>;
};

function fakeGitHub(seed: Entry[]) {
  const files = new Map(
    seed.map((entry) => [entry.id, { source: serializeEntry(entry), sha: "a".repeat(40) }]),
  );
  const commits: Commit[] = [];
  const snapshots = new Map<string, Map<string, Stored>>();
  let putCount = 0;
  let timeoutAfterNextPut = false;
  let truncateNextPutResponse = false;

  const runner: GhRunner = (args, input) => {
    const endpoint = args.find((argument) => argument.startsWith("repos/")) ?? "";
    if (endpoint.endsWith("/commits")) {
      return { status: 0, stdout: JSON.stringify([commits]), stderr: "" };
    }
    const commitDetailSha = /\/commits\/([a-f0-9]{40})$/u.exec(endpoint)?.[1];
    if (commitDetailSha) {
      const commit = commits.find((candidate) => candidate.sha === commitDetailSha);
      return commit
        ? { status: 0, stdout: JSON.stringify(commit), stderr: "" }
        : { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
    }
    const id = /\/contents\/content\/entries\/([a-z0-9-]+)\.md$/u.exec(endpoint)?.[1];
    if (!id) return { status: 1, stdout: "", stderr: "unexpected endpoint" };

    if (args.includes("GET")) {
      const ref = args.find((argument) => argument.startsWith("ref="))?.slice(4) ?? "main";
      const stored = ref === "main" ? files.get(id) : snapshots.get(ref)?.get(id);
      if (!stored) return { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
      return {
        status: 0,
        stdout: JSON.stringify({
          content: Buffer.from(stored.source).toString("base64"),
          encoding: "base64",
          sha: stored.sha,
        }),
        stderr: "",
      };
    }

    putCount += 1;
    const payload = JSON.parse(input ?? "{}") as {
      message: string;
      content: string;
      sha?: string;
    };
    const current = files.get(id);
    if ((current && !payload.sha) || (payload.sha && payload.sha !== current?.sha)) {
      return { status: 1, stdout: "", stderr: "HTTP 409: Conflict" };
    }
    const commitSha = (commits.length + 1).toString(16).padStart(40, "c");
    const blobSha = (commits.length + 1).toString(16).padStart(40, "b");
    files.set(id, {
      source: Buffer.from(payload.content, "base64").toString("utf8"),
      sha: blobSha,
    });
    commits.unshift({
      sha: commitSha,
      commit: { message: payload.message },
      files: [
        {
          filename: `content/entries/${id}.md`,
          status: current ? "modified" : "added",
        },
      ],
    });
    snapshots.set(commitSha, new Map(files));
    if (timeoutAfterNextPut) {
      timeoutAfterNextPut = false;
      return { status: 1, stdout: "", stderr: "network timeout" };
    }
    if (truncateNextPutResponse) {
      truncateNextPutResponse = false;
      return { status: 0, stdout: "{truncated", stderr: "" };
    }
    return {
      status: 0,
      stdout: JSON.stringify({ content: { sha: blobSha }, commit: { sha: commitSha } }),
      stderr: "",
    };
  };

  return {
    client: new GitHubContentClient(runner),
    getPutCount: () => putCount,
    current: (id: string) => parseEntry(files.get(id)?.source ?? ""),
    timeoutAfterNextPut: () => {
      timeoutAfterNextPut = true;
    },
    truncateNextPutResponse: () => {
      truncateNextPutResponse = true;
    },
  };
}

function baseEntry() {
  return createEntry(
    {
      id: "mcp-inspector",
      title: "MCP Inspector",
      summary: "Inspect MCP servers.",
      category: "toolkit",
      tags: ["mcp"],
      rating: "夯",
    },
    new Date("2026-08-25T00:00:00.000Z"),
  );
}

describe("M3 GitHub 并发与幂等写入", () => {
  it("update 同时校验版本与 SHA，并以单个 PUT 写入下一版本 trailers", () => {
    const github = fakeGitHub([baseEntry()]);
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: "a".repeat(40),
      patch: { rating: "人上人" },
    });
    const result = github.client.mutateEntry(
      {
        id: "mcp-inspector",
        expectedVersion: 1,
        expectedSha: request.expected_sha,
        requestId: "123e4567-e89b-42d3-a456-426614174001",
        operation: "update",
      },
      (current) => applyEntryUpdate(current, request, new Date("2026-08-26T00:00:00.000Z")),
    );

    expect(result).toMatchObject({
      operation: "update",
      idempotent: false,
      entry: { version: 2, rating: "人上人" },
    });
    expect(github.getPutCount()).toBe(1);
    expect(github.current("mcp-inspector")).toMatchObject({ version: 2, rating: "人上人" });
  });

  it("旧版本或旧 SHA 在 PUT 前返回 VERSION_CONFLICT", () => {
    const github = fakeGitHub([baseEntry()]);
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: "d".repeat(40),
      patch: { title: "Changed" },
    });

    expect(() =>
      github.client.mutateEntry(
        {
          id: "mcp-inspector",
          expectedVersion: 1,
          expectedSha: request.expected_sha,
          requestId: "123e4567-e89b-42d3-a456-426614174002",
          operation: "update",
        },
        (current) => applyEntryUpdate(current, request),
      ),
    ).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
    expect(github.getPutCount()).toBe(0);
  });

  it("相同 request ID 重试返回原 commit 与原版本且不产生第二个 PUT", () => {
    const github = fakeGitHub([baseEntry()]);
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: "a".repeat(40),
      patch: { summary: "Changed once." },
    });
    const options = {
      id: "mcp-inspector",
      expectedVersion: 1,
      expectedSha: request.expected_sha,
      requestId: "123e4567-e89b-42d3-a456-426614174003",
      operation: "update" as const,
    };
    const first = github.client.mutateEntry(options, (current) =>
      applyEntryUpdate(current, request, new Date("2026-08-26T00:00:00.000Z")),
    );
    const retry = github.client.mutateEntry(options, () => {
      throw new Error("幂等命中后不能再次执行 mutation");
    });

    expect(retry).toMatchObject({
      commitSha: first.commitSha,
      sha: first.sha,
      idempotent: true,
      entry: { version: 2, summary: "Changed once." },
    });
    expect(github.getPutCount()).toBe(1);
  });

  it("PUT 已提交但客户端超时时会从 request 历史恢复原结果", () => {
    const github = fakeGitHub([baseEntry()]);
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: "a".repeat(40),
      patch: { title: "Recovered Update" },
    });
    github.timeoutAfterNextPut();
    const result = github.client.mutateEntry(
      {
        id: "mcp-inspector",
        expectedVersion: 1,
        expectedSha: request.expected_sha,
        requestId: "123e4567-e89b-42d3-a456-426614174006",
        operation: "update",
      },
      (current) => applyEntryUpdate(current, request),
    );

    expect(result).toMatchObject({
      idempotent: true,
      entry: { version: 2, title: "Recovered Update" },
    });
    expect(github.getPutCount()).toBe(1);
  });

  it("PUT 已提交但成功响应 JSON 截断时也会从历史恢复", () => {
    const github = fakeGitHub([baseEntry()]);
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: "a".repeat(40),
      patch: { summary: "Recovered from truncated response." },
    });
    github.truncateNextPutResponse();
    const result = github.client.mutateEntry(
      {
        id: "mcp-inspector",
        expectedVersion: 1,
        expectedSha: request.expected_sha,
        requestId: "123e4567-e89b-42d3-a456-426614174008",
        operation: "update",
      },
      (current) => applyEntryUpdate(current, request),
    );

    expect(result).toMatchObject({ idempotent: true, entry: { version: 2 } });
    expect(github.getPutCount()).toBe(1);
  });

  it("同一 request ID 不能跨条目或跨操作复用", () => {
    const github = fakeGitHub([baseEntry()]);
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: "a".repeat(40),
      patch: { title: "Changed" },
    });
    const requestId = "123e4567-e89b-42d3-a456-426614174007";
    github.client.mutateEntry(
      {
        id: "mcp-inspector",
        expectedVersion: 1,
        expectedSha: request.expected_sha,
        requestId,
        operation: "update",
      },
      (current) => applyEntryUpdate(current, request),
    );

    expect(() =>
      github.client.mutateEntry(
        {
          id: "mcp-inspector",
          expectedVersion: 2,
          expectedSha: "b".repeat(39) + "1",
          requestId,
          operation: "delete",
        },
        (current) =>
          transitionEntryStatus(
            current,
            { expected_version: 2, expected_sha: "b".repeat(39) + "1" },
            "recycled",
          ),
      ),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(github.getPutCount()).toBe(1);
  });

  it("create 支持幂等重试，且已回收 ID 仍不可复用", () => {
    const recycled = transitionEntryStatus(
      baseEntry(),
      { expected_version: 1, expected_sha: "a".repeat(40) },
      "recycled",
      new Date("2026-08-26T00:00:00.000Z"),
    );
    const github = fakeGitHub([recycled]);
    const other = createEntry(
      {
        id: "new-entry",
        title: "New Entry",
        summary: "New.",
        category: "articles",
      },
      new Date("2026-08-27T00:00:00.000Z"),
    );
    const requestId = "123e4567-e89b-42d3-a456-426614174004";
    const first = github.client.createEntry(other, serializeEntry(other), requestId);
    const retry = github.client.createEntry(other, serializeEntry(other), requestId);

    expect(retry).toMatchObject({ commitSha: first.commitSha, idempotent: true });
    expect(github.getPutCount()).toBe(1);
    expect(() =>
      github.client.createEntry(
        recycled,
        serializeEntry(recycled),
        "123e4567-e89b-42d3-a456-426614174005",
      ),
    ).toThrowError(expect.objectContaining({ code: "ID_CONFLICT" }));
  });

  it("异常 commit 历史形状会停止 create，不会继续 PUT", () => {
    let putCount = 0;
    const runner: GhRunner = (args) => {
      if (args.some((argument) => argument.endsWith("/commits"))) {
        return { status: 0, stdout: JSON.stringify({ unexpected: true }), stderr: "" };
      }
      if (args.includes("PUT")) putCount += 1;
      return { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
    };
    const client = new GitHubContentClient(runner);

    expect(() =>
      client.createEntry(
        baseEntry(),
        serializeEntry(baseEntry()),
        "123e4567-e89b-42d3-a456-426614174009",
      ),
    ).toThrowError(expect.objectContaining({ code: "GITHUB_ERROR" }));
    expect(putCount).toBe(0);
  });

  it("commit 历史中的非 SHA 字符串会停止 create，不会继续 PUT", () => {
    let putCount = 0;
    const runner: GhRunner = (args) => {
      if (args.some((argument) => argument.endsWith("/commits"))) {
        return {
          status: 0,
          stdout: JSON.stringify([[{ sha: "not-a-sha", commit: { message: "ordinary commit" } }]]),
          stderr: "",
        };
      }
      if (args.includes("PUT")) putCount += 1;
      return { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
    };

    expect(() =>
      new GitHubContentClient(runner).createEntry(
        baseEntry(),
        serializeEntry(baseEntry()),
        "123e4567-e89b-42d3-a456-426614174011",
      ),
    ).toThrowError(expect.objectContaining({ code: "GITHUB_ERROR" }));
    expect(putCount).toBe(0);
  });

  it("匹配 commit 的详情为 null 时返回稳定 GITHUB_ERROR", () => {
    const requestId = "123e4567-e89b-42d3-a456-426614174012";
    const commitSha = "c".repeat(40);
    const runner: GhRunner = (args) => {
      const endpoint = args.find((argument) => argument.startsWith("repos/")) ?? "";
      if (endpoint.endsWith("/commits")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              {
                sha: commitSha,
                commit: {
                  message: [
                    "content: create mcp-inspector",
                    "",
                    "Operation: create",
                    "Entry-ID: mcp-inspector",
                    "Content-Version: 1",
                    `Request-ID: ${requestId}`,
                  ].join("\n"),
                },
              },
            ],
          ]),
          stderr: "",
        };
      }
      if (endpoint.endsWith(`/commits/${commitSha}`)) {
        return { status: 0, stdout: "null", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected request" };
    };

    expect(() =>
      new GitHubContentClient(runner).createEntry(
        baseEntry(),
        serializeEntry(baseEntry()),
        requestId,
      ),
    ).toThrowError(expect.objectContaining({ code: "GITHUB_ERROR" }));
  });

  it("幂等恢复会拒绝 trailer 操作与历史文件状态不一致", () => {
    const requestId = "123e4567-e89b-42d3-a456-426614174010";
    const commitSha = "c".repeat(40);
    const source = serializeEntry(baseEntry());
    const runner: GhRunner = (args) => {
      const endpoint = args.find((argument) => argument.startsWith("repos/")) ?? "";
      if (endpoint.endsWith("/commits")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              {
                sha: commitSha,
                commit: {
                  message: [
                    "content: delete mcp-inspector",
                    "",
                    "Operation: delete",
                    "Entry-ID: mcp-inspector",
                    "Content-Version: 1",
                    `Request-ID: ${requestId}`,
                  ].join("\n"),
                },
              },
            ],
          ]),
          stderr: "",
        };
      }
      if (endpoint.endsWith(`/commits/${commitSha}`)) {
        return {
          status: 0,
          stdout: JSON.stringify({
            files: [{ filename: "content/entries/mcp-inspector.md", status: "modified" }],
          }),
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          content: Buffer.from(source).toString("base64"),
          encoding: "base64",
          sha: "a".repeat(40),
        }),
        stderr: "",
      };
    };

    expect(() =>
      new GitHubContentClient(runner).mutateEntry(
        {
          id: "mcp-inspector",
          expectedVersion: 1,
          expectedSha: "a".repeat(40),
          requestId,
          operation: "delete",
        },
        (current) => current,
      ),
    ).toThrowError(expect.objectContaining({ code: "GITHUB_ERROR" }));
  });
});
