import { AppError } from "./errors.ts";
import type { Entry } from "./schema.ts";

export interface EntryReader {
  listEntries(): Entry[];
  getEntry(id: string): Entry;
}

/**
 * 为查询测试和未来离线场景提供不含 I/O 的 EntryReader。
 *
 * 为什么存在：查询语义必须能在不访问 GitHub 的情况下精确测试，并与真实 adapter 交换使用。
 * 数据如何流动：构造时复制 Entry 数组；list 再复制，get 按不可变 ID 查找并返回领域对象。
 * 何时失败：get 未命中返回 NOT_FOUND；它不会生成默认条目。
 * 如何排查：检查测试 fixture 的 ID 与传入查询，不要在 adapter 中修改领域对象。
 * 什么不能改：不能在这里实现另一套过滤或搜索，所有查询必须调用 query.ts。
 */
export class MemoryEntryReader implements EntryReader {
  private readonly entries: Entry[];

  constructor(entries: Entry[]) {
    this.entries = entries.slice();
  }

  listEntries(): Entry[] {
    return this.entries.slice();
  }

  getEntry(id: string): Entry {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new AppError("NOT_FOUND", "条目不存在", { id });
    return entry;
  }
}
