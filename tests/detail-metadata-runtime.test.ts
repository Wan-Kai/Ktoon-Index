import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { SITE_URL } from "../scripts/build-content.ts";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const appSourceFile = ts.createSourceFile("app.js", appSource, ts.ScriptTarget.ESNext, true);

type FakeElement = {
  attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  tagName: string;
};

function createElement(tagName: string, attributes: Record<string, string> = {}): FakeElement {
  const values = new Map(Object.entries(attributes));
  return {
    attributes: values,
    getAttribute: (name) => values.get(name) ?? null,
    setAttribute: (name, value) => values.set(name, value),
    tagName,
  };
}

function declarationSource(names: string[]): string {
  const selected = appSourceFile.statements.filter((statement) => {
    if (ts.isFunctionDeclaration(statement)) return names.includes(statement.name?.text ?? "");
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text),
    );
  });
  expect(selected).toHaveLength(names.length);
  return selected.map((statement) => statement.getText(appSourceFile)).join("\n");
}

function readAppSiteUrl(): string {
  const declaration = appSourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (candidate) =>
        ts.isIdentifier(candidate.name) && candidate.name.text === "PRODUCTION_SITE_URL",
    );
  if (!declaration?.initializer || !ts.isStringLiteral(declaration.initializer)) {
    throw new Error("app.js 缺少字符串形式的 PRODUCTION_SITE_URL");
  }
  return declaration.initializer.text;
}

function createMetadataHarness() {
  const metas = [
    createElement("meta", { name: "description", content: "fallback" }),
    createElement("meta", { property: "og:title", content: "fallback" }),
    createElement("meta", { property: "og:description", content: "fallback" }),
    createElement("meta", { name: "twitter:title", content: "fallback" }),
    createElement("meta", { name: "twitter:description", content: "fallback" }),
  ];
  const links: FakeElement[] = [];
  const query = (selector: string): FakeElement | null => {
    const attribute = selector.match(/^(meta|link)\[(name|property|rel)="([^"]+)"\]$/u);
    if (!attribute) return null;
    const collection = attribute[1] === "meta" ? metas : links;
    return (
      collection.find((element) => element.getAttribute(attribute[2]) === attribute[3]) ?? null
    );
  };
  const document = {
    createElement: (tagName: string) => createElement(tagName),
    head: {
      append: (element: FakeElement) => {
        (element.tagName === "meta" ? metas : links).push(element);
      },
    },
    querySelector: query,
    title: "Ktoon’s Index Entry",
  };
  const context = { document } as Record<string, unknown>;
  runInNewContext(
    `${declarationSource(["PRODUCTION_SITE_URL", "setMetaContent", "updateDetailMetadata"])}\nglobalThis.__api = { updateDetailMetadata };`,
    context,
  );
  return {
    document,
    links,
    metas,
    update: (context.__api as { updateDetailMetadata(entry: unknown): void }).updateDetailMetadata,
  };
}

async function runInitialization(shouldFail: boolean) {
  const title = { textContent: "" };
  const context = {
    console: { error: () => undefined },
    document: {
      body: { classList: { contains: () => true } },
      querySelector: () => title,
    },
    languages: 0,
    shouldFail,
    updates: 0,
  } as Record<string, unknown>;
  const prelude = `
    let currentDetailEntry = { id: "mcp-inspector" };
    const state = { language: "zh" };
    const categoryStack = null;
    const escapeHtml = String;
    async function loadGeneratedIndex() {}
    async function loadGeneratedDetail() { if (globalThis.shouldFail) throw new Error("failed"); }
    function updateDetailMetadata() { globalThis.updates += 1; }
    function applyLanguage() { globalThis.languages += 1; }
  `;
  runInNewContext(
    `${prelude}\n${declarationSource(["initializeApplication"])}\nglobalThis.__run = initializeApplication;`,
    context,
  );
  await (context.__run as () => Promise<void>)();
  return { languages: context.languages, title: title.textContent, updates: context.updates };
}

describe("详情页运行时元信息", () => {
  it("生产脚本与构建器使用同一站点根地址", () => {
    expect(readAppSiteUrl()).toBe(SITE_URL);
  });

  it("成功更新只生成一个 canonical 与 og:url，且不吸收页面附加 query", () => {
    const harness = createMetadataHarness();
    const entry = {
      id: "mcp-inspector",
      title: "MCP Inspector",
      summary: "A focused workbench for testing MCP servers.",
    };
    harness.update(entry);
    harness.update(entry);

    const canonical = harness.links.filter((link) => link.getAttribute("rel") === "canonical");
    const ogUrl = harness.metas.filter((meta) => meta.getAttribute("property") === "og:url");
    expect(canonical).toHaveLength(1);
    expect(ogUrl).toHaveLength(1);
    expect(canonical[0].getAttribute("href")).toBe(`${SITE_URL}detail.html?id=mcp-inspector`);
    expect(ogUrl[0].getAttribute("content")).toBe(canonical[0].getAttribute("href"));
    expect(harness.document.title).toBe("MCP Inspector · Ktoon’s Index");
  });

  it("只有首页与详情 JSON 都成功后才更新元信息并进入渲染", async () => {
    await expect(runInitialization(false)).resolves.toEqual({
      languages: 1,
      title: "",
      updates: 1,
    });
    await expect(runInitialization(true)).resolves.toEqual({
      languages: 0,
      title: "条目加载失败",
      updates: 0,
    });
  });
});
