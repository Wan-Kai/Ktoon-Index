import { readFileSync } from "node:fs";
import { Window, type HTMLElement } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const windows: Window[] = [];
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");

async function setup(tags: string[] = []) {
  const window = new Window({
    url: "https://example.com/?category=toolkit",
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(window);
  window.document.write(html);
  window.fetch = async () =>
    new window.Response(
      JSON.stringify({
        categories: [
          {
            id: "toolkit",
            label: "Toolkit",
            labelZh: "工具箱",
            entries: [
              {
                id: "older",
                title: "Older",
                description: "Older record",
                rating: "夯",
                tags,
                addedAt: "2020-01-01T00:00:00Z",
              },
              {
                id: "newer",
                title: "Newer",
                description: "New record",
                rating: "NPC",
                tags: [],
                addedAt: new Date().toISOString(),
              },
            ],
          },
          ...["products", "articles", "standards", "ideas"].map((id) => ({
            id,
            label: id,
            labelZh: id,
            entries: [],
          })),
        ],
      }),
    );
  window.eval(script);
  await vi.waitFor(() => expect(window.document.querySelectorAll(".track")).toHaveLength(2));
  return window;
}

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

describe("分类筛选的页面内菜单", () => {
  it("所有浏览器都使用按钮和 listbox，不依赖系统 select 弹窗", async () => {
    const { document } = await setup();
    expect(document.body.classList.contains("category-view")).toBe(true);
    expect(document.querySelectorAll("button[role=combobox]")).toHaveLength(3);
    expect(document.querySelector("#category-time")?.hasAttribute("hidden")).toBe(true);
    document.querySelector<HTMLElement>("#category-time-trigger")!.click();
    expect(document.querySelector("#category-time-listbox")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelectorAll("#category-time-listbox [role=option]")).toHaveLength(4);
  });

  it("点击选项更新实际过滤结果，关闭菜单并保留焦点", async () => {
    const { document } = await setup();
    const trigger = document.querySelector<HTMLElement>("#category-time-trigger")!;
    trigger.click();
    document.querySelector<HTMLElement>('#category-time-listbox [data-value="7"]')!.click();
    expect(document.querySelectorAll(".track")).toHaveLength(1);
    expect(document.querySelector(".track__title")?.textContent).toBe("Newer");
    expect(trigger.textContent).toContain("最近 7 天");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("方向键、Home/End、Enter、Escape 和 Tab 不误提交选择", async () => {
    const window = await setup();
    const trigger = window.document.querySelector<HTMLElement>("#category-sort-trigger")!;
    const key = (value: string) =>
      trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true }));
    key("ArrowDown");
    key("End");
    key("Escape");
    expect(window.document.querySelector(".track__title")?.textContent).toBe("Older");
    key("ArrowDown");
    key("End");
    key("Enter");
    expect(window.document.querySelector(".track__title")?.textContent).toBe("Newer");
    key("Home");
    key("Tab");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false);
    expect(window.document.querySelector(".track__title")?.textContent).toBe("Newer");
  });

  it("外部点击关闭，同一时刻只展开一个菜单，无标签时禁用", async () => {
    const window = await setup();
    const { document } = window;
    expect(document.querySelector("#category-tag-trigger")?.hasAttribute("disabled")).toBe(true);
    document.querySelector<HTMLElement>("#category-sort-trigger")!.click();
    document.querySelector<HTMLElement>("#category-time-trigger")!.click();
    expect(document.querySelector("#category-sort-trigger")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    expect(document.querySelector("#category-time-trigger")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("标签按文字处理，切换界面语言不丢失选择", async () => {
    const { document } = await setup(["<img src=x>"]);
    document.querySelector<HTMLElement>("#category-tag-trigger")!.click();
    const options = document.querySelectorAll<HTMLElement>("#category-tag-listbox [role=option]");
    expect(options[1].textContent).toBe("# <img src=x>");
    expect(options[1].querySelector("img")).toBeNull();
    options[1].click();
    document.querySelector<HTMLElement>("#language-switch")!.click();
    expect(document.querySelectorAll(".track")).toHaveLength(1);
    expect(document.querySelector("#category-tag-trigger")?.textContent).toContain("<img src=x>");
    expect(document.querySelector("#category-tag-trigger")?.getAttribute("aria-label")).toContain(
      "Filter by tag",
    );
  });
});
