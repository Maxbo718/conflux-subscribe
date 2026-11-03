// 官方扩展镜像订阅生成器
// 抓 ConfluxOne/ExtensionSamples 全仓库 → 解析每个包的 definePackage → 生成 catalog-mirror.json
// 包体直连官方 raw 地址（不复制内容），只镜像目录与版本号；新增扩展会被自动发现。
import fs from "node:fs";
import vm from "node:vm";

const OWNER = "ConfluxOne", REPO = "ExtensionSamples", BRANCH = "main";
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const OUT = process.argv[2] || "catalog-mirror.json";

async function get(url, asText = true) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "conflux-mirror/1.0" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return asText ? await r.text() : await r.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((s) => setTimeout(s, 1200 * (i + 1)));
    }
  }
}

// 解析包元数据：只跑 definePackage，不执行通信逻辑
function parsePkg(src) {
  let pkg = null;
  const sandbox = {
    definePackage: (o) => (pkg = o),
    defineWidget: () => {},
    ExtensionError: class extends Error {},
    console: { log() {}, warn() {}, error() {} },
  };
  try {
    vm.runInNewContext(src, sandbox, { timeout: 8000 });
  } catch (e) {
    throw new Error("执行 definePackage 失败：" + e.message);
  }
  if (!pkg || !pkg.id || !pkg.version) return null;
  const types = [...new Set((pkg.extensions || []).map((e) => e.type).filter(Boolean))];
  return {
    id: String(pkg.id),
    title: String(pkg.title || pkg.id),
    description: String(pkg.description || "").slice(0, 300),
    author: String(pkg.author || "").slice(0, 80),
    version: String(pkg.version),
    engine: typeof pkg.engine === "number" ? pkg.engine : 1,
    changelog: String(pkg.changelog || (pkg.changelog && pkg.changelog[0]) || "").slice(0, 300),
    types,
    url: "",
    _raw: "",
  };
}

const vnum = (v) => String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
const warnings = [];
const warn = (m) => { warnings.push(m); console.log(m); };
function newer(a, b) {
  const x = vnum(a), y = vnum(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const tree = await get(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`, false);
const js = (tree.tree || [])
  .filter((n) => n.type === "blob" && n.path.endsWith(".js"))
  .filter((n) => !/(^|\/)(test|tests|node_modules)\//.test(n.path))
  .map((n) => n.path);

console.log(`候选 .js：${js.length} 个`);

const best = new Map();
for (const p of js) {
  let src;
  try {
    src = await get(`${RAW}/${p}`);
  } catch (e) {
    console.log(`  跳过 ${p}（${e.message}）`);
    continue;
  }
  if (!src.includes("definePackage")) continue;
  let meta;
  try {
    meta = parsePkg(src);
  } catch (e) {
    warn(`⚠ ${p} 解析失败，已跳过：${e.message}`);
    continue;
  }
  if (!meta) {
    warn(`⚠ ${p} 含 definePackage 但没解析出 id/version，已跳过（请检查包格式）`);
    continue;
  }
  meta.url = `${RAW}/${p}`;
  meta._raw = p;
  const prev = best.get(meta.id);
  if (!prev || newer(meta.version, prev.version)) {
    if (prev) console.log(`  同 id 取新版：${meta.id} ${prev.version} → ${meta.version}`);
    best.set(meta.id, meta);
  }
}

if (!best.size) {
  console.error("没有解析到任何包，保持原文件不动");
  process.exit(1);
}

const packages = [...best.values()]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(({ _raw, ...rest }) => rest);

const out = {
  format: 1,
  title: "Conflux 官方扩展全集（镜像）",
  description: "ConfluxOne/ExtensionSamples 全部扩展现已收录，包体直连官方仓库，目录与版本号每日自动跟随官方更新。",
  updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  packages,
};

// 防呆：新结果比现有目录少太多时，判定为解析异常而非官方真的下架，保留原文件
function readExisting(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(d.packages) ? d.packages : [];
  } catch {
    return null;
  }
}
const prevPkgs = readExisting(OUT);
if (prevPkgs && prevPkgs.length >= 4) {
  const prevIds = new Set(prevPkgs.map((p) => p.id));
  const nowIds = new Set(packages.map((p) => p.id));
  const missing = [...prevIds].filter((i) => !nowIds.has(i));
  const ratio = packages.length / prevPkgs.length;
  if (ratio < 0.7) {
    console.error(
      `\n✗ 拒绝写入：新目录只有 ${packages.length} 个包，原目录 ${prevPkgs.length} 个（丢失 ${missing.join(", ")}）\n` +
        `  这通常是解析失败或官方仓库结构变动导致，保留原文件不动。`
    );
    if (warnings.length) for (const w of warnings) console.error("  " + w);
    process.exit(2);
  }
  if (missing.length) {
    warn(`注意：${missing.length} 个包在这次结果里消失（${missing.join(", ")}），若确为官方下架可忽略`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`\n生成 ${OUT}：${packages.length} 个包`);
for (const p of packages) console.log(`  ${p.id.padEnd(26)} ${p.version.padEnd(8)} ${p.types.join(",")}`);

if (warnings.length) {
  // 在 GitHub Actions 日志里高亮成 warning，不要静默吞掉
  console.log(`\n::warning::镜像有 ${warnings.length} 条告警，可能有扩展未被收录`);
  for (const w of warnings) console.log("::warning::" + w.replace(/\n/g, " "));
}
