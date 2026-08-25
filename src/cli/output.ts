import { AppError } from "../content/index.ts";

export type OutputFormat = "json" | "table";
export type TableRow = Record<string, string | number | null | undefined>;

export function parseOutputFormat(value: string | undefined): OutputFormat {
  const format = value ?? "json";
  if (format !== "json" && format !== "table") {
    throw new AppError("VALIDATION_FAILED", "format 只允许 json 或 table", { value });
  }
  return format;
}

function cellText(value: TableRow[string]): string {
  return String(value ?? "").replace(/[\r\n\t]+/gu, " ");
}

function displayWidth(value: string): number {
  return [...value].reduce(
    (width, character) => width + (/[^\u0000-\u00ff\u2000-\u206f]/u.test(character) ? 2 : 1),
    0,
  );
}

function padCell(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;
}

/**
 * 把列表数据渲染成无 ANSI、可复制的紧凑表格。
 *
 * 为什么存在：CLI 默认 JSON 服务 Agent，但维护者需要显式 `--format table` 快速浏览，不应引入另一套查询结果。
 * 数据如何流动：使用首行字段顺序作为列顺序，清理单元格换行，按近似终端显示宽度补齐表头、分隔线和所有数据行。
 * 何时失败：空数组返回 `(empty)`；不接受嵌套对象，调用方必须先映射为扁平 TableRow。
 * 如何排查：检查调用方 tableRows 的字段顺序和值；JSON payload 不受表格布局影响。
 * 什么不能改：不能注入颜色控制符或截断内容，表格只是同一完整结果的显示形式。
 */
export function renderTable(rows: TableRow[]): string {
  if (rows.length === 0) return "(empty)";
  const headers = Object.keys(rows[0]);
  const values = rows.map((row) => headers.map((header) => cellText(row[header])));
  const widths = headers.map((header, index) =>
    Math.max(displayWidth(header), ...values.map((row) => displayWidth(row[index]))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => padCell(cell, widths[index]))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...values.map(line)].join(
    "\n",
  );
}

/**
 * 按 CLI 输出契约写入 JSON 或表格。
 *
 * 为什么存在：所有只读命令必须共享默认 JSON 规则，并确保 table 只改变表现、不改变查询。
 * 数据如何流动：json 直接序列化 payload；table 渲染调用方提供的同结果扁平行，最终只向 stdout 写一次。
 * 何时失败：未知 format 在 parseOutputFormat 阶段失败；这里要求 tableRows 与 payload 由同一结果生成。
 * 如何排查：先用默认 JSON 验证结果，再比较 tableRows 映射，不要在输出层重新筛选。
 * 什么不能改：错误仍由 stderr JSON 边界处理，不能在这里捕获并伪装成功。
 */
export function writeOutput(
  payload: unknown,
  format: OutputFormat,
  tableRows: TableRow[] = [],
): void {
  const text = format === "json" ? JSON.stringify(payload, null, 2) : renderTable(tableRows);
  process.stdout.write(`${text}\n`);
}
