/**
 * 把 .env 转成 Windows 批处理的 set 语句。
 *   node env-lines.mjs <env 文件>            → 打到标准输出（人工调试用）
 *   node env-lines.mjs <env 文件> <输出 .cmd> → 写进临时批处理，由启动器 call 之后删除
 * 写文件模式是启动器实际用的那条路：批处理里 `call set "K=v"` 会把 ^ 再解析一遍，
 * 密钥含 ^ 就会被吃掉；直接把 set 语句写成文件只经过一次解析，值保持原样。
 * 两种模式都只输出 KEY=VALUE 的 set 语句本身，绝不把值打印到控制台或日志。
 * 语义：# 开头是注释，第一个 = 之后全部算值（含 = 的值不会被截断），值里的引号去掉。
 */
import fs from "node:fs";

const file = process.argv[2];
const outFile = process.argv[3];
if (!file) {
  process.stderr.write("用法：node env-lines.mjs <env 文件> [输出 .cmd]\n");
  process.exit(2);
}
// 这些变量会改写启动环境本身，不接受 .env 覆盖（只报名字，不回显值）。
const DENY = new Set([
  "path", "pathext", "temp", "tmp", "windir", "systemroot", "comspec",
  "prompt", "node_options", "node_path", "node_exec_path"
]);

const lines = [];
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim().replace(/[^A-Za-z0-9_]/g, "");
    if (!key) continue;
    if (DENY.has(key.toLowerCase())) {
      process.stderr.write(`已跳过会破坏启动环境的变量：${key}（值未打印）\n`);
      continue;
    }
    let value = t.slice(i + 1).trim().replace(/"/g, "");
    if (outFile) value = value.replace(/%/g, "%%");
    lines.push(`set "${key}=${value}"`);
  }
}

if (outFile) {
  // 批处理文件本身按系统代码页读取，所以键和值只允许 ASCII。
  const bad = lines.filter((l) => /[^\x20-\x7E]/.test(l));
  if (bad.length) {
    process.stderr.write(`有 ${bad.length} 行含非 ASCII 字符，已跳过（值未打印）\n`);
  }
  fs.writeFileSync(outFile, "@echo off\r\n" + lines.filter((l) => !/[^\x20-\x7E]/.test(l)).join("\r\n") + "\r\n", "ascii");
} else {
  process.stdout.write(lines.join("\n") + (lines.length ? "\n" : ""));
}
