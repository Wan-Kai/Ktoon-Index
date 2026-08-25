import { AppError } from "../content/index.ts";

export type OutputFormat = "json" | "table";
export type TableRow = Record<string, string | number | null | undefined>;

/**
 * 在任何查询或网络请求前解析输出格式。
 *
 * 为什么存在：CLI 只承诺 JSON 与 table，未知格式必须成为稳定校验错误而不是静默回退。
 * 数据如何流动：undefined 映射默认 json；两个白名单值原样返回；其余抛出 VALIDATION_FAILED。
 * 何时失败：调用方传入 yaml、csv、空字符串等未支持值时失败。
 * 如何排查：删除 format 参数使用 JSON，或显式传入 `--format table`。
 * 什么不能改：不能在输出层猜测格式，也不能等 GitHub 请求完成后再校验。
 */
export function parseOutputFormat(value: string | undefined): OutputFormat {
  const format = value ?? "json";
  if (format !== "json" && format !== "table") {
    throw new AppError("VALIDATION_FAILED", "format 只允许 json 或 table", { value });
  }
  return format;
}

/**
 * 把领域文本收敛为不会改变终端状态的单行单元格。
 *
 * 为什么存在：标题和摘要来自公开事实源，若保留 ESC、BEL 或其他控制字符，table 模式可能伪造颜色、链接和终端显示。
 * 数据如何流动：任意标量先转字符串，再把 C0、DEL 与 C1 控制字符统一替换为空格；普通 Unicode 与完整正文原样保留。
 * 何时失败：本函数不抛错；空值转为空字符串，恶意控制字节只失去控制能力而不会导致整条查询失败。
 * 如何排查：若 table 与 JSON 的可见空白不同，检查源文本是否包含不可见控制字符，并用 JSON 模式确认原始数据。
 * 什么不能改：不能只处理换行或只识别某一种 ANSI 序列；控制字符白名单遗漏会重新打开终端注入风险。
 */
function cellText(value: TableRow[string]): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ");
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
