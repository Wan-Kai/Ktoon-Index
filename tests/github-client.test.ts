import { describe, expect, it } from "vitest";

import {
  MemoryEntryReader,
  createEntry,
  searchEntries,
  serializeEntry,
} from "../src/content/index.ts";
import { GitHubContentClient, GitHubEntryReader, type GhRunner } from "../src/github/index.ts";

const entry = createEntry(
  {
    id: "mcp-inspector",
    title: "MCP Inspector",
    summary: "Inspect MCP servers.",
    category: "toolkit",
    tags: ["mcp"],
    rating: "夯",
    personal_take: "适合 **调试**。",
  },
  new Date("2026-08-25T08:00:00.000Z"),
);

describe("M1 GitHub adapter", () => {
  it("doctor 只接受固定 main 且当前身份可写", () => {
    const runner: GhRunner = (args) => {
      if (args[0] === "auth") return { status: 0, stdout: "", stderr: "" };
      return {
        status: 0,
        stdout: JSON.stringify({ default_branch: "main", permissions: { push: true } }),
        stderr: "",
      };
    };

    expect(new GitHubContentClient(runner).doctor()).toEqual({
      authenticated: true,
      repository: "Wan-Kai/Ktoon-Index",
      branch: "main",
      writable: true,
    });
  });

  it("get 解码 GitHub 内容并返回 version 与文件 SHA", () => {
    const source = serializeEntry(entry);
    const runner: GhRunner = () => ({
      status: 0,
      stdout: JSON.stringify({
        content: Buffer.from(source).toString("base64"),
        encoding: "base64",
        sha: "file-sha",
      }),
      stderr: "",
    });

    expect(new GitHubContentClient(runner).getEntry("mcp-inspector")).toMatchObject({
      entry: { id: "mcp-inspector", version: 1 },
      sha: "file-sha",
      path: "content/entries/mcp-inspector.md",
    });
  });

  it("create 先检查远端 ID，再用单个 PUT 写入 main 与 commit trailers", () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const runner: GhRunner = (args, input) => {
      calls.push({ args, input });
      if (args.includes("GET")) {
        return { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
      }
      return { status: 0, stdout: JSON.stringify({ commit: { sha: "commit-sha" } }), stderr: "" };
    };

    const result = new GitHubContentClient(runner).createEntry(
      entry,
      serializeEntry(entry),
      "request-123",
    );
    const payload = JSON.parse(calls[1].input ?? "{}") as { message: string; branch: string };

    expect(result.commitSha).toBe("commit-sha");
    expect(calls[0].args).toContain("GET");
    expect(calls[1].args).toContain("PUT");
    expect(payload.branch).toBe("main");
    expect(payload.message).toContain("Content-Version: 1");
    expect(payload.message).toContain("Request-ID: request-123");
  });

  it("GitHub 与内存 reader 向查询层返回相同领域结果", () => {
    const second = createEntry(
      {
        id: "context7",
        title: "Context7",
        summary: "Documentation in agent context.",
        category: "toolkit",
        tags: ["agent-tooling"],
        rating: "人上人",
      },
      new Date("2026-08-24T08:00:00.000Z"),
    );
    const sources = new Map([
      ["mcp-inspector.md", serializeEntry(entry)],
      ["context7.md", serializeEntry(second)],
    ]);
    const runner: GhRunner = (args) => {
      const endpoint = args.find((argument) => argument.includes("/contents/")) ?? "";
      if (endpoint.endsWith("/content/entries")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            { name: "mcp-inspector.md", type: "file" },
            { name: "context7.md", type: "file" },
            { name: "README.txt", type: "file" },
          ]),
          stderr: "",
        };
      }
      const name = endpoint.split("/").at(-1) ?? "";
      return {
        status: 0,
        stdout: JSON.stringify({
          content: Buffer.from(sources.get(name) ?? "").toString("base64"),
          encoding: "base64",
          sha: `${name}-sha`,
        }),
        stderr: "",
      };
    };
    const github = new GitHubEntryReader(new GitHubContentClient(runner));
    const memory = new MemoryEntryReader([entry, second]);

    expect(searchEntries(github.listEntries(), "context")).toEqual(
      searchEntries(memory.listEntries(), "context"),
    );
  });
});
