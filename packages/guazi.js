/**
 * Conflux Extension — 瓜子影视（聚合榜单 + 全站播放）
 * engine 1。数据经 Cloudflare Worker 协议桥：guazi.113210833.xyz
 *   /rank/{cateId}?page=1  榜单列表（10 条/页）
 *   /search?kw=            全站搜索（≤20 条）
 *   /catalog/{vodId}       剧集目录
 *   /play/{vurlId}         播放页（内含 data-hls 直链）
 * 协议层由「瓜子榜单」组件原样拼接，加密/鉴权/域名轮换逻辑零重写。
 */
var VERSION = "1.2.6";

var API_BASE = "https://guazi.113210833.xyz";
/* HLS 规范化代理：给清单补 .m3u8、分片补 .ts、带 3 次重试与显式 Content-Length */
var HLS_PROXY = "https://gzhls.113210833.xyz";
var ICON = "https://guazi.113210833.xyz/icon.png";

/* 官方周榜 / 流媒体新片榜（cateId 与 guazi_cates.tsv 对齐） */
var RANKS = [
  { id: "148", name: "本周电影榜" },
  { id: "15", name: "本周国剧榜" },
  { id: "8", name: "本周美剧榜" },
  { id: "10", name: "本周韩剧榜" },
  { id: "9", name: "本周英剧榜" },
  { id: "11", name: "本周日剧榜" },
  { id: "149", name: "本周泰剧榜" },
  { id: "12", name: "本周动漫榜" },
  { id: "171", name: "本周综艺榜" },
  { id: "172", name: "本周纪录片榜" },
];
var NEW = [
  { id: "2", name: "Netflix 新片" },
  { id: "3", name: "Disney Plus 新片" },
  { id: "5", name: "Apple TV Plus 新片" },
  { id: "4", name: "HBO Max 新片" },
  { id: "6", name: "Prime Video 新片" },
];
var RANK_IDS = {};
RANKS.concat(NEW).forEach(function (r) { RANK_IDS[r.id] = r.name; });
/* 混榜固定取这四个官方周榜 */
var MIX_IDS = ["148", "15", "8", "12"];

/* ============ ref.id 元数据打包（替代 ctx.storage） ============
 * 实证：App 调用 ctx.storage.set/get 会崩溃（探针包 2026-11-02 真机确认），
 * 故详情页所需的标题/封面等信息不能再走 storage，改为编码进 ref.id 随点击传递。
 * id 形如 "5531~<base64url(JSON)>"；协议只用 ref 传参，不传其他字段。
 */
var IMG_PREFIX = "https://images.67c6c7a.com";
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function utf8Bytes(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var c2 = s.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function b64u(s) {
  var b = utf8Bytes(str(s)), out = "";
  for (var i = 0; i < b.length; i += 3) {
    var n = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8) | (i + 2 < b.length ? b[i + 2] : 0);
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64_CHARS[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64_CHARS[n & 63];
  }
  return out;
}
function unb64u(s) {
  var bits = 0, acc = 0, bytes = [], i;
  for (i = 0; i < s.length; i++) {
    var v = B64_CHARS.indexOf(s.charAt(i));
    if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); }
  }
  var out = "", j = 0;
  while (j < bytes.length) {
    var c = bytes[j++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 31) << 6) | (bytes[j++] & 63));
    else if (c < 0xf0) {
      var c2 = bytes[j++], c3 = bytes[j++];
      out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    } else {
      var d2 = bytes[j++], d3 = bytes[j++], d4 = bytes[j++];
      var cp2 = (((c & 7) << 18) | ((d2 & 63) << 12) | ((d3 & 63) << 6) | (d4 & 63)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp2 >> 10), 0xdc00 + (cp2 & 1023));
    }
  }
  return out;
}

/* 把协议桥的 /hls/<base64> 还原成源站真实地址（源站只拒浏览器 UA，播放器 UA 可直连） */
function decodePlayUrl(hlsUrl) {
  var m = /\/hls\/([A-Za-z0-9+/_-]+)$/.exec(hlsUrl || "");
  if (!m) return "";
  var t = m[1].replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  var u = unb64u(t);
  return /^https?:\/\//i.test(u) ? u : "";
}
/* 把列表侧拿到的元数据压进 id；封面去掉公共前缀缩短长度 */
function packRef(vodId, meta) {
  var m = asObject(meta);
  var cover = imageUrl(null, m.cover);
  if (cover.indexOf(IMG_PREFIX) === 0) cover = cover.slice(IMG_PREFIX.length);
  var payload = { t: pick(m.title), c: cover, s: pick(m.score), y: pick(m.year), n: num(m.total) || num(m.episode_count) };
  if (!payload.t && !payload.c) return vodId;
  return vodId + "~" + b64u(JSON.stringify(payload));
}
/* 解析 ref.id：纯数字（旧数据/分集）与打包 id 都兼容 */
function unpackRef(refId) {
  var s = str(refId);
  var i = s.indexOf("~");
  if (i < 0) return { id: digits(s), meta: null };
  var id = digits(s.slice(0, i));
  var meta = null;
  try {
    var m = JSON.parse(unb64u(s.slice(i + 1)));
    if (m && typeof m === "object") meta = m;
  } catch (e) { meta = null; }
  return { id: id, meta: meta };
}

/* ---------- 全部 49 个官方分类（与 Yealico 版一致：15 周榜 + 33 月度新片 + 本月新片） ----------
   按 App 可承载的选项数拆成 4 组（每组 ≤15 项，与已验证可用的 movie-rank 同量级）：
   周榜 15 / 2026 月度 11 / 2025 月度 12 / 2024 月度 2 */
var CAT_WEEK = [
  { name: "本周电影榜", id: "148" }, { name: "本周国剧榜", id: "15" },
  { name: "本周美剧榜", id: "8" }, { name: "本周韩剧榜", id: "10" },
  { name: "本周英剧榜", id: "9" }, { name: "本周日剧榜", id: "11" },
  { name: "本周泰剧榜", id: "149" }, { name: "本周动漫榜", id: "12" },
  { name: "本周综艺榜", id: "171" }, { name: "本周纪录片榜", id: "172" },
];
var ALL_CATS = [
  { id: "2", name: "Netflix新片榜" }, { id: "3", name: "Disney+新片榜" },
  { id: "5", name: "Apple TV+新片榜" }, { id: "4", name: "HBOmax新片榜" },
  { id: "6", name: "prime video新片榜" }, { id: "15", name: "本周国剧排行榜" },
  { id: "8", name: "本周美剧排行榜" }, { id: "12", name: "本周动漫排行榜" },
  { id: "148", name: "本周电影排行榜" }, { id: "10", name: "本周韩剧排行榜" },
  { id: "9", name: "本周英剧排行榜" }, { id: "11", name: "本周日剧排行榜" },
  { id: "149", name: "本周泰剧排行榜" }, { id: "171", name: "本周综艺排行榜" },
  { id: "172", name: "本周纪录片排行榜" }, { id: "252", name: "2026年10月新片" },
  { id: "248", name: "2026年09月新片" }, { id: "242", name: "2026年08月新片" },
  { id: "239", name: "2026年07月新片" }, { id: "232", name: "2026年06月新片" },
  { id: "227", name: "2026年05月新片" }, { id: "223", name: "2026年04月新片" },
  { id: "220", name: "2026年03月新片" }, { id: "212", name: "2026年02月新片" },
  { id: "206", name: "2026年01月新片" }, { id: "203", name: "2025年12月新片" },
  { id: "198", name: "2025年11月新片" }, { id: "194", name: "2025年10月新片" },
  { id: "188", name: "2025年09月新片" }, { id: "183", name: "2025年08月新片" },
  { id: "179", name: "2025年07月新片" }, { id: "174", name: "2025年06月新片" },
  { id: "167", name: "2025年05月新片" }, { id: "152", name: "2025年04月新片" },
  { id: "145", name: "2025年03月新片" }, { id: "136", name: "2025年02月新片" },
  { id: "128", name: "2025年01月新片" }, { id: "119", name: "2024年12月新片" },
  { id: "110", name: "2024年11月新片" }, { id: "101", name: "2024年10月新片" },
  { id: "92", name: "2024年09月新片" }, { id: "83", name: "2024年08月新片" },
  { id: "74", name: "2024年07月新片" }, { id: "65", name: "2024年06月新片" },
  { id: "56", name: "2024年05月新片" }, { id: "47", name: "2024年04月新片" },
  { id: "38", name: "2024年03月新片" }, { id: "29", name: "2024年02月新片" },
];
var CAT_ALL = CAT_WEEK;
var CAT_IDS = {};
CAT_ALL.forEach(function (r) { CAT_IDS[r.id] = r.name; });
/* list:cat:<token> → 默认分类 id */
var CAT_ROUTE = { week: "148" };
function toOptions(list) {
  return list.map(function (r) { return { title: r.name, value: r.id }; });
}

/* ---------- Picker 静态预览数据（安装阶段不联网，写死在清单里） ----------
   官方约定：placeholder/placeholderData 均为字面量 WidgetContent，
   用于「添加」面板预览与首页骨架；缺失时 Picker 仅显示标题。 */
function sample(id, title, cover, year, rating) {
  return {
    ref: { source: "custom", id: packRef(id, { title: title, cover: cover, score: rating, year: year }), mediaType: "movie" },
    title: title,
    subtitle: year,
    rating: rating,
    images: { poster: cover, detailPoster: cover },
  };
}
var COV = {
  a: "https://images.67c6c7a.com/upload/vod/2026-08/202608281787926800.jpg",
  b: "https://images.67c6c7a.com/upload/vod/2022-07/p2874563402.jpg",
  c: "https://images.67c6c7a.com/upload/vod/2025-01/2025012016441464v9.jpg",
};
var PLACEHOLDER_RANK = {
  items: [
    sample("149446", "空枪", COV.a, "2026-08-19", 7.2),
    sample("147773", "欢迎来龙餐馆", COV.a, "2026-08-15", 6.8),
    sample("148202", "危局", COV.a, "2026-08-12", 7.5),
    sample("148996", "深夜快递", COV.a, "2026-08-08", 6.4),
    sample("146680", "沙海之上", COV.a, "2026-07-30", 7.9),
    sample("147120", "第七封信", COV.a, "2026-07-22", 6.1),
    sample("145903", "追光者", COV.a, "2026-07-18", 8.0),
    sample("146411", "候鸟不回头", COV.a, "2026-07-11", 6.6),
    sample("144280", "暴雨追凶", COV.a, "2026-07-04", 7.1),
    sample("143998", "风起时", COV.a, "2026-06-28", 6.9),
  ],
};
var PLACEHOLDER_NEW = {
  items: [
    sample("149001", "Netflix 新片推荐", COV.b, "2026-08-18", 7.6),
    sample("148877", "Disney Plus 家庭之夜", COV.b, "2026-08-16", 7.0),
    sample("148640", "Apple TV Plus 独家剧集", COV.b, "2026-08-14", 8.2),
    sample("148302", "HBO Max 罪案线", COV.b, "2026-08-09", 7.8),
    sample("147988", "Prime Video 冒险季", COV.b, "2026-08-05", 6.7),
    sample("147710", "流媒体新片速递", COV.b, "2026-08-01", 7.3),
  ],
};
var PLACEHOLDER_MIX = {
  items: [
    sample("149446", "空枪", COV.c, "本周电影榜 · 2026-08-19", 7.2),
    sample("148202", "危局", COV.c, "本周电影榜 · 2026-08-12", 7.5),
    sample("147120", "第七封信", COV.c, "本周电影榜 · 2026-07-22", 6.1),
    sample("150001", "长安十二时辰", COV.c, "本周国剧榜 · 2026-08-20", 8.4),
    sample("149880", "风起陇右", COV.c, "本周国剧榜 · 2026-08-13", 7.7),
    sample("149744", "夜市人生", COV.c, "本周国剧榜 · 2026-08-06", 6.5),
    sample("149333", "暗夜追凶", COV.c, "本周美剧榜 · 2026-08-19", 8.1),
    sample("149102", "极地救援", COV.c, "本周美剧榜 · 2026-08-11", 7.2),
    sample("148866", "高堡旅人", COV.c, "本周美剧榜 · 2026-08-02", 6.9),
    sample("148531", "星际拓荒", COV.c, "本周动漫榜 · 2026-08-17", 8.6),
  ],
};
var PLACEHOLDER_SEARCH = {
  items: [
    sample("5531", "生化危机 2022", COV.b, "2022 · 8 集", 7.4),
    sample("9045", "新生化危机", COV.b, "2023 · 6 集", 6.2),
    sample("12048", "生化危机：终章", COV.b, "2016 · 1 集", 6.8),
    sample("13902", "生化危机：恶化", COV.b, "2012 · 1 集", 7.5),
    sample("15677", "生化危机：诅咒", COV.b, "2012 · 1 集", 7.1),
    sample("17344", "生化危机：复仇", COV.b, "2017 · 1 集", 6.6),
  ],
};

/* ---------- 基础工具 ---------- */
function str(v) { return typeof v === "string" ? v : (v === null || v === undefined ? "" : String(v)); }
function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function digits(v) { return str(v).replace(/\D+/g, ""); }
function trim(v) { return str(v).replace(/^\s+|\s+$/g, ""); }
function pick(v, fallback) { var s = trim(v); return s ? s : (fallback || ""); }
/**
 * HTTP 响应统一校验：Conflux 的 ctx.http 返回 { status, headers, data }，**没有 ok 字段**。
 * 早前这里写的是 `res.ok === false`，判断恒为假 → 429/500/404 全被当成成功，界面上只剩占位数据。
 * 错误码只用协议规定的 5 个：invalid_params / not_found / rate_limited / unavailable / internal。
 */
function check(res, allow404) {
  if (!res || typeof res.status !== "number") {
    fail("接口无响应", "unavailable");
  }
  var st = res.status;
  if (st >= 200 && st < 300) return res;
  if (allow404 && st === 404) return res;
  if (st === 400 || st === 422) fail("请求参数不被接受 (HTTP " + st + ")", "invalid_params");
  if (st === 404) fail("资源不存在 (HTTP 404)", "not_found");
  if (st === 429) fail("请求过于频繁，请稍后再试 (HTTP 429)", "rate_limited");
  fail("上游服务异常 (HTTP " + st + ")", "unavailable");
}

var RETRYABLE_CODES = { rate_limited: true, unavailable: true };
function fail(msg, code) {
  code = code || "internal";
  if (typeof ExtensionError === "function") {
    throw new ExtensionError({ code: code, message: msg, retryable: !!RETRYABLE_CODES[code] });
  }
  var e = new Error(msg); e.code = code; e.retryable = !!RETRYABLE_CODES[code]; throw e;
}
function enc(s) { try { return encodeURIComponent(str(s)); } catch (e) { return ""; } }


function baseUrl(ctx) {
  var v = ctx && ctx.settings && trim(ctx.settings.apiBase);
  return v || API_BASE;
}
function imageUrl(ctx, u) {
  var s = trim(u);
  if (!s) return "";
  /* 瓜子图床 images.67c6c7a.com 直连 200 真 JPEG，无需代理 */
  return s;
}

async function apiGet(ctx, path, query) {
  var q = "";
  if (query) {
    var parts = [];
    Object.keys(query).forEach(function (k) {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") parts.push(k + "=" + enc(query[k]));
    });
    if (parts.length) q = "?" + parts.join("&");
  }
  var res = await ctx.http.get(baseUrl(ctx) + path + q, { timeout: 25000 });
  check(res);
  return res.data;
}
/* 运行时可能返回字符串或已解析对象；统一成对象 */
function asJson(v) {
  if (v && typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch (e) { return null; }
}
function asArray(v) { return Object.prototype.toString.call(v) === "[object Array]" ? v : []; }
function asObject(v) { return v && typeof v === "object" && Object.prototype.toString.call(v) !== "[object Array]" ? v : {}; }

function mapLimit(items, limit, fn) {
  var out = new Array(items.length);
  var idx = 0;
  var workers = [];
  var n = Math.max(1, Math.min(limit, items.length));
  for (var i = 0; i < n; i++) {
    workers.push(
      (function step() {
        if (idx >= items.length) return Promise.resolve();
        var cur = idx++;
        return Promise.resolve()
          .then(function () { return fn(items[cur], cur); })
          .then(function (r) { out[cur] = r; })
          .then(step);
      })()
    );
  }
  return Promise.all(workers).then(function () { return out; });
}

/* ---------- 数据整形 ---------- */
function listItem(ctx, row) {
  var d = asObject(row);
  var id = digits(d.id);
  if (!id) return null;
  var totalEarly = num(d.total) > 0 ? num(d.total) : num(d.episode_count);
  var item = {
    ref: { source: "custom", id: packRef(id, d), mediaType: totalEarly > 1 ? "tv" : "movie" },
    title: pick(d.title, "未命名"),
  };
  var cover = imageUrl(ctx, d.cover);
  if (cover) item.images = { poster: cover, detailPoster: cover };
  var rating = parseFloat(d.score);
  if (!isNaN(rating) && rating > 0) item.rating = rating;
  var year = pick(d.year);
  if (year) item.releaseDate = year;
  var total = num(d.total);
  var eps = num(d.episode_count);
  var count = total > 0 ? total : eps;
  var bits = [];
  if (year) bits.push(year.slice(0, 4));
  if (count > 0) bits.push(count + " 集");
  if (bits.length) item.subtitle = bits.join(" · ");
  return item;
}

function episodesOf(detail, vodId, cover) {
  var list = asArray(detail && detail.list);
  var out = [];
  list.forEach(function (row) {
    var e = asObject(row);
    var n = num(e.n) || out.length + 1;
    var ep = {
      season: 1,
      episode: n,
      title: pick(e.title, "第 " + n + " 集"),
      ref: { source: "custom", id: digits(e.id), mediaType: "movie" },
    };
    /* 分集剧照：站方无独立剧照，按 pitfall #1 铁律双通道注入（stills + 单集全量图字段） */
    if (cover) {
      ep.image = cover;
      ep.still = cover;
      ep.cover = cover;
      ep.poster = cover;
      ep.backdrop = cover;
      ep.images = { still: cover, poster: cover, cover: cover, backdrop: cover };
    }
    out.push(ep);
  });
  return out;
}

/* 混榜：固定四个官方周榜各取前 5，按榜名打 subtitle */
function loadMix(ctx) {
  return mapLimit(MIX_IDS, 4, function (id) {
    return apiGet(ctx, "/rank/" + id, { page: 1 })
      .then(function (json) { return { id: id, rows: asArray(asJson(json) && asJson(json).list) }; })
      .catch(function () { return { id: id, rows: [] }; });
  }).then(function (groups) {
    var items = [];
    var seen = {};
    groups.forEach(function (g) {
      var rankName = RANK_IDS[g.id] || "";
      g.rows.slice(0, 5).forEach(function (r) {
        var id = digits(asObject(r).id);
        if (!id || seen[id]) return;
        seen[id] = 1;
        var it = listItem(ctx, r);
        if (it) {
          it.subtitle = rankName + (it.subtitle ? " · " + it.subtitle : "");
          items.push(it);
        }
      });
    });
    return items;
  });
}

/* ---------- definePackage ---------- */
/* 合并官方分类：单池并发 8，单类失败跳过，去重后按上映日期倒序。
   两级用法：widget 只聚合最近 3 个月（快），list 页聚合全部 48 类（约 900 部）。 */
var ALL_MEMO = { at: 0, rows: null };

function monthCats() {
  return ALL_CATS.filter(function (c) { return /新片/.test(c.name); }).sort(function (a, b) {
    return a.name === b.name ? 0 : (a.name < b.name ? 1 : -1);
  });
}

async function fetchRowsByCats(ctx, ids) {
  var out = [], cursor = { i: 0 };
  async function worker() {
    while (cursor.i < ids.length) {
      var idx = cursor.i++;
      try {
        var json = await apiGet(ctx, "/rank/" + ids[idx], { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        for (var k = 0; k < rows.length; k++) { if (rows[k] && rows[k].id) out.push(rows[k]); }
      } catch (e) { /* 单个分类失败不影响整体 */ }
    }
  }
  var running = [], n = Math.min(8, ids.length);
  for (var i = 0; i < n; i++) running.push(worker());
  await Promise.all(running);

  var seen = {}, uniq = [];
  for (var j = 0; j < out.length; j++) {
    if (seen[out[j].id]) continue;
    seen[out[j].id] = 1; uniq.push(out[j]);
  }
  uniq.sort(function (a, b) {
    var x = str(a.year), y = str(b.year);
    return x === y ? 0 : (x < y ? 1 : -1);
  });
  return uniq;
}

/* 全量聚合：结果在进程内缓存 30 分钟，避免每次进页面都打 48 个请求 */
async function fetchAllRows(ctx) {
  var now = Date.now();
  if (ALL_MEMO.rows && now - ALL_MEMO.at < 1800000) return ALL_MEMO.rows;
  var rows = await fetchRowsByCats(ctx, ALL_CATS.map(function (c) { return c.id; }));
  if (rows.length) { ALL_MEMO.rows = rows; ALL_MEMO.at = now; }
  return rows;
}

definePackage({
  id: "conflux.guazi",
  title: "瓜子影视",
  version: VERSION,
  engine: 1,
  description: "15 个独立榜单 + 全站播放：周榜、流媒体新片、搜索、详情、选集与直连播放",
  icon: ICON,
  permissions: {
    /* 黄果包同款写法：apiBase 可由用户改，故保留通配前缀（真机已验证不会崩） */
    network: ["https://", "http://"],
  },
  settings: [
    {
      name: "apiBase",
      title: "协议桥地址",
      type: "text",
      default: API_BASE,
      description: "Worker 协议桥地址，站点域名变化时改这里（保留 https://）",
    },
  ],
  extensions: [
    /* ---------- Widget：瓜子影视 ---------- */
    {
      type: "widget",
      id: "all-videos",
      title: "瓜子影视",
      description: "最近 3 个月新片速览 · 点开看全站 900+ 部",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:all" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 3600 },
      load: async function (ctx) {
        var rows = await fetchRowsByCats(ctx, monthCats().slice(0, 3).map(function (c) { return c.id; }));
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },

    /* ---------- Widget：本周电影榜 ---------- */
    {
      type: "widget",
      id: "rank-148",
      title: "本周电影榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-ranked",
      header: "list",
      ref: { source: "custom", id: "list:rank:148" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/148", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周国剧榜 ---------- */
    {
      type: "widget",
      id: "rank-15",
      title: "本周国剧榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:15" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/15", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周美剧榜 ---------- */
    {
      type: "widget",
      id: "rank-8",
      title: "本周美剧榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:8" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/8", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周韩剧榜 ---------- */
    {
      type: "widget",
      id: "rank-10",
      title: "本周韩剧榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:10" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/10", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周英剧榜 ---------- */
    {
      type: "widget",
      id: "rank-9",
      title: "本周英剧榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:9" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/9", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周日剧榜 ---------- */
    {
      type: "widget",
      id: "rank-11",
      title: "本周日剧榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:11" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/11", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周泰剧榜 ---------- */
    {
      type: "widget",
      id: "rank-149",
      title: "本周泰剧榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:149" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/149", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周动漫榜 ---------- */
    {
      type: "widget",
      id: "rank-12",
      title: "本周动漫榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:12" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/12", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周综艺榜 ---------- */
    {
      type: "widget",
      id: "rank-171",
      title: "本周综艺榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:171" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/171", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：本周纪录片榜 ---------- */
    {
      type: "widget",
      id: "rank-172",
      title: "本周纪录片榜",
      description: "瓜子官方豆瓣周榜 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:172" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/172", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：Netflix 新片 ---------- */
    {
      type: "widget",
      id: "new-2",
      title: "Netflix 新片",
      description: "瓜子官方流媒体新片 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:2" },
      placeholderData: PLACEHOLDER_NEW,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/2", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：Disney Plus 新片 ---------- */
    {
      type: "widget",
      id: "new-3",
      title: "Disney Plus 新片",
      description: "瓜子官方流媒体新片 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:3" },
      placeholderData: PLACEHOLDER_NEW,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/3", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：Apple TV Plus 新片 ---------- */
    {
      type: "widget",
      id: "new-5",
      title: "Apple TV Plus 新片",
      description: "瓜子官方流媒体新片 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:5" },
      placeholderData: PLACEHOLDER_NEW,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/5", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：HBO Max 新片 ---------- */
    {
      type: "widget",
      id: "new-4",
      title: "HBO Max 新片",
      description: "瓜子官方流媒体新片 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:4" },
      placeholderData: PLACEHOLDER_NEW,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/4", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },
    /* ---------- Widget：Prime Video 新片 ---------- */
    {
      type: "widget",
      id: "new-6",
      title: "Prime Video 新片",
      description: "瓜子官方流媒体新片 · Top 10",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:6" },
      placeholderData: PLACEHOLDER_NEW,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        var json = await apiGet(ctx, "/rank/6", { page: 1 });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },

    /* ---------- Widget：豆瓣周榜总览 ---------- */
    {
      type: "widget",
      id: "weekly-mix",
      title: "本周热搜混榜",
      description: "电影 / 国剧 / 美剧 / 动漫 周榜各取前列混合",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:rank:mix" },
      placeholderData: PLACEHOLDER_MIX,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx) {
        return { items: await loadMix(ctx) };
      },
    },

    /* ---------- Widget：快速搜索 ---------- */
    {
      type: "widget",
      id: "quick-search",
      title: "瓜子搜索",
      description: "输入片名，直接给出可播放条目",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:search" },
      placeholderData: PLACEHOLDER_SEARCH,
      params: [{ name: "kw", title: "关键词", type: "text", default: "" }],
      load: async function (ctx, input) {
        var params = (input && input.params) || {};
        var kw = trim(params.kw);
        if (!kw) return { items: [] };
        var json = await apiGet(ctx, "/search", { kw: kw });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },

    /* ---------- 搜索 ---------- */
    {
      type: "search",
      id: "main",
      title: "瓜子影视",
      search: async function (ctx, input) {
        var query = trim(input && input.query);
        if (!query) return { items: [] };
        var json = await apiGet(ctx, "/search", { kw: query });
        var rows = asArray(asJson(json) && asJson(json).list);
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },

    /* ---------- 全屏列表 ---------- */
    {
      type: "list",
      id: "list",
      title: "瓜子影视列表",
      style: "grid",
      accepts: { sources: ["custom"] },
      search: { id: "main" },
      load: async function (ctx, input) {
        var ref = (input && input.ref) || {};
        var id = str(ref.id);
        var params = (input && input.params) || {};
        /* params.rank 优先（用户在小组件上选的分类），否则用 widget ref 里带的默认 cateId */
        var wanted = (RANK_IDS[params.rank] || CAT_IDS[params.rank])
          ? params.rank
          : (id.indexOf("list:cat:") === 0 ? CAT_ROUTE[id.slice("list:cat:".length)] : id.indexOf("list:rank:") === 0 ? id.slice("list:rank:".length) : "148");
        if (id === "list:all") {
          var allRows = await fetchAllRows(ctx);
          var allItems = [];
          allRows.forEach(function (r) { var it = listItem(ctx, r); if (it) allItems.push(it); });
          return { items: allItems };
        }
        if (wanted === "mix") {
          /* 混榜：与 widget 同一套混合逻辑 */
          var mixed = await loadMix(ctx);
          return { items: mixed };
        }
        var rows = [];
        if (id.indexOf("list:rank") === 0 || id.indexOf("list:cat") === 0) {
          var page = input && input.page && num(input.page.page) > 0 ? num(input.page.page) : 1;
          var json = await apiGet(ctx, "/rank/" + wanted, { page: page });
          rows = asArray(asJson(json) && asJson(json).list);
        } else if (id.indexOf("list:search") === 0) {
          var kw = trim(params.kw);
          if (!kw) return { items: [] };
          var sres = await apiGet(ctx, "/search", { kw: kw });
          rows = asArray(asJson(sres) && asJson(sres).list);
        } else {
          return { items: [] };
        }
        var items = [];
        rows.forEach(function (r) { var it = listItem(ctx, r); if (it) items.push(it); });
        return { items: items };
      },
    },

    /* ---------- 详情 ---------- */
    {
      type: "detail",
      id: "main",
      title: "瓜子影视详情",
      accepts: { sources: ["custom"] },
      cache: { ttlSeconds: 600 },
      load: async function (ctx, input) {
        var ref = (input && input.ref) || {};
        var parsed = unpackRef(ref.id);
        var vodId = parsed.id;
        if (!vodId) return null;

        var raw = await apiGet(ctx, "/catalog/" + vodId);
        var detail = (raw && typeof raw === "object") ? raw : asJson(raw) || {};
        var eps = episodesOf(detail, vodId, null);

        /* 封面/标题来自 ref.id 打包（worker /catalog 只给分集；storage 会崩，已弃用） */
        var meta = parsed.meta || {};
        var cover = imageUrl(ctx, meta.c);
        if (cover.indexOf("http") !== 0 && cover) cover = IMG_PREFIX + cover;

        /* 电影/剧集判定：不能只看目录条数——剧集可能只更新了 1 集。
           实测瓜子数据规律：剧集 total=总集数(28~40)，电影 total=0 或分片数(1~2)。
           规则：total>=4 或 目录>=4 条 → 剧集；否则电影。
           注意：2~3 集的迷你短剧会被判成电影（瓜子侧无 type 字段可查，已知局限）。 */
        var isMovie = !(num(meta.n) >= 4 || eps.length >= 4);
        var out = {
          /* mediaType 必须与分集数一致：多集=剧集(tv)，单集=电影(movie)。
             之前一律写 movie，导致 App 同时给出「标记本集/标记本季」两项菜单。 */
          ref: { source: "custom", id: vodId, mediaType: isMovie ? "movie" : "tv" },
          title: pick(meta.t, "瓜子影视 " + vodId),
        };
        if (cover) out.images = { poster: cover, detailPoster: cover, backdrop: cover };
        var rating = parseFloat(meta.s);
        if (!isNaN(rating) && rating > 0) out.rating = rating;
        var year = pick(meta.y);
        if (year) out.releaseDate = year;
        var bits = [];
        if (year) bits.push(year.slice(0, 4));
        /* 剧集：已更新集数与总集数不同时写成「更新至 N 集（共 M 集）」 */
        var totalN = num(meta.n);
        if (isMovie) {
          bits.push("电影");
        } else if (totalN > eps.length) {
          bits.push("更新至 " + eps.length + " 集（共 " + totalN + " 集）");
        } else {
          bits.push(eps.length + " 集");
        }
        out.subtitle = bits.join(" · ");

        /* 分集剧照铁律（pitfall #1）：顶层 stills 与分集等长 */
        if (cover && eps.length) {
          var stills = [];
          for (var i = 0; i < eps.length; i++) stills.push(cover);
          out.images.stills = stills;
          eps.forEach(function (ep) {
            ep.image = cover; ep.still = cover; ep.cover = cover; ep.poster = cover; ep.backdrop = cover;
            ep.images = { still: cover, poster: cover, cover: cover, backdrop: cover };
          });
        }

        /* 电影（≤1 集）不返回 episodes —— App 只有拿到 episodes 才渲染「第 1 季 / 第N集」；
           电影形态下播放器直接播 ref 本身（playback 会自动取第 1 条线路）。 */
        if (!isMovie && eps.length) {
          out.episodes = eps;
        }
        return out;
      },
    },

    /* ---------- 播放 ---------- */
    {
      type: "playback",
      id: "main",
      title: "瓜子影视播放",
      accepts: { sources: ["custom"] },
      cache: { ttlSeconds: 0 },
      sources: async function (ctx, input) {
        var ref = (input && input.ref) || {};
        var parsed = unpackRef(ref.id);
        var id = parsed.id;
        if (!id) return [];

        /* 定位真正的播放 id（vurlId）。
           坑：App 传进来的 ref 可能是「影片级」ref（id = vodId），直接拿去 /play/ 会播到
           完全不相干的片子（vodId 与 vurlId 不同命名空间，实测 /play/147773 → 204s 无关视频）。
           判据：/catalog/{id} 非空 ⇒ id 是 vodId，按 input.episode 挑分集 id；
                 空列表 ⇒ id 本身就是分集/播放 id，原样使用。 */
        var vurlId = id;
        var epLabel = "";
        var epRefId = input && input.episode && input.episode.ref && input.episode.ref.id;
        try {
          var rawCat = await apiGet(ctx, "/catalog/" + id);
          var cat = (rawCat && typeof rawCat === "object") ? rawCat : asJson(rawCat) || {};
          var eps = episodesOf(cat, id, null);
          if (eps.length) {
            var want = 0;
            var e = input && input.episode;
            if (typeof e === "number") want = e;
            else if (e && typeof e.episode === "number") want = e.episode;
            var chosen = null;
            var i;
            if (want) {
              for (i = 0; i < eps.length; i++) {
                if (eps[i].episode === want) { chosen = eps[i]; break; }
              }
            }
            if (!chosen && epRefId) {
              var cand = digits(String(epRefId).indexOf("~") >= 0 ? unpackRef(epRefId).id : epRefId);
              for (i = 0; i < eps.length; i++) {
                if (eps[i].ref.id === cand) { chosen = eps[i]; break; }
              }
            }
            if (!chosen) chosen = eps[0];
            vurlId = chosen.ref.id;
            /* 电影不挂「第N集」标签：以 ref.mediaType 为准（详情已判定形态）。
               不能用 eps.length>1 —— 电影可能被拆成 2 个分片。 */
            epLabel = (String((input && input.ref && input.ref.mediaType) || "") === "movie")
              ? "" : (chosen.title || "");
          } else if (epRefId) {
            vurlId = digits(String(epRefId).indexOf("~") >= 0 ? unpackRef(epRefId).id : epRefId) || id;
          }
        } catch (err) {
          /* 目录查询失败不阻断播放，退回原 id */
        }

        var res = await ctx.http.get(baseUrl(ctx) + "/play/" + vurlId, { timeout: 25000 });
        if (!res || res.ok === false) return [];
        var html = typeof res.data === "string" ? res.data : "";
        if (!html && res.data && typeof res.data.text === "string") html = res.data.text;
        var m = html.match(/data-hls="([^"]+)"/);
        if (!m) return [];
        var url = m[1].replace(/&amp;/g, "&");
        var rm = html.match(/data-res="([^"]+)"/);
        var label = (rm ? rm[1] + "P" : "高清") + (epLabel ? " · " + epLabel : "");
        var out = [];
        // 线路一：源站直连（零中转、不消耗 Worker 额度）
        var direct = decodePlayUrl(url);
        if (direct) {
          out.push({
            id: "direct-" + vurlId,
            name: "线路一 · " + label + "（直连）",
            description: "源站直连，不经过中转",
            url: direct,
            player: "system",
          });
        }
        // 线路二：HLS 规范化代理（源站异常/UA 被拦时兜底）
        try {
          out.push({
            id: "gzhls-" + vurlId,
            name: (direct ? "线路二" : "线路一") + " · " + label + "（代理兜底）",
            description: "HLS 代理线路",
            url: HLS_PROXY + "/p/" + b64u(url) + ".m3u8",
            player: "system",
          });
        } catch (e) {}
        return out;
      },
    },
  ],
});
