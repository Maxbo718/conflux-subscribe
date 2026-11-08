/**
 * Conflux Extension — 瓜子影视（聚合榜单 + 全站播放）· 直连版（无 Worker）
 * engine 1。加密 / 签名 / 域名轮换全部在本包内完成，请求直连站点 API：
 *   鉴权  POST /App/Authentication/Device/signIn | signUp
 *   榜单  POST /App/NewDiscover/getList     {cateId, page, pageSize}
 *   片库  POST /App/IndexList/indexList    {tid, sub, area, year, sort, page, pageSize}
 *   搜索  POST /App/Index/findMoreVod       {keywords, order_val}
 *   目录  POST /App/Resource/Vurl/show      {vod_d_id, vurl_cloud_id:"2"}
 *   播放  POST /App/Resource/Vod/vurlDetail {vurl_id} → 源站 m3u8 直链
 * 协议参考：ZenmoFeiShi/Forward forward_rank.js（同站，AES-CBC + MD5 + RSA 纯 JS）。
 * 播放不再经过中转：源站只拦浏览器 UA，播放器 UA（AppleCoreMedia）直接放行。
 *
 * 已知边界：
 *  - token 只在内存里缓存（context 级）；ctx.storage 仅在 detail/playback 使用。
 *  - 设备号由固定种子派生 ⇒ 同一份包在同一 App 内是同一个匿名设备账号。
 */
var VERSION = "2.2.0";
/* 包图标：SF Symbol（原来的图标 png 挂在中转 Worker 上，已随直连改造下线） */
var ICON = "https://maxbo718.github.io/conflux-subscribe/icons/guazi.png";

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


function imageUrl(ctx, u) {
  var s = trim(u);
  if (!s) return "";
  /* 瓜子图床 images.67c6c7a.com 直连 200 真 JPEG，无需代理 */
  return s;
}

/* ==================== 纯 JS 加密（AES-CBC / MD5 / RSA-BigInt） ====================
 * 取自 ZenmoFeiShi/Forward forward_rank.js（同站协议，已在真机长期运行）。
 * 搬到 Conflux 后不依赖任何宿主原生加密能力。
 */
const GxCrypto = (function () {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function utf8Encode(str) {
    const s = String(str == null ? "" : str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const a = bytes[i++];
      let c;
      if (a < 0x80) c = a;
      else if (a >= 0xf0) c = ((a & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else if (a >= 0xe0) c = ((a & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else if (a >= 0xc0) c = ((a & 31) << 6) | (bytes[i++] & 63);
      else c = 0xfffd;
      if (c > 0xffff) {
        c -= 0x10000;
        out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
      } else {
        out += String.fromCharCode(c);
      }
    }
    return out;
  }

  function hexToBytes(hex) {
    const h = String(hex || "").replace(/[^0-9a-f]/gi, "");
    const out = new Array(h.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }

  function base64ToBytes(text) {
    const s = String(text || "").replace(/[^A-Za-z0-9+/]/g, "");
    const out = [];
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64.indexOf(s.charAt(i));
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 255);
      }
    }
    return out;
  }

  function bytesToBase64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
      out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : "=";
      out += i + 2 < bytes.length ? B64.charAt(n & 63) : "=";
    }
    return out;
  }

  const SBOX = new Array(256);
  const INV_SBOX = new Array(256);
  (function () {
    let p = 1;
    let q = 1;
    do {
      p = p ^ ((p << 1) & 255) ^ (p & 128 ? 0x1b : 0);
      q ^= q << 1;
      q ^= q << 2;
      q ^= q << 4;
      q &= 255;
      if (q & 128) q ^= 0x09;
      const x = q ^ ((q << 1 | q >> 7) & 255) ^ ((q << 2 | q >> 6) & 255) ^ ((q << 3 | q >> 5) & 255) ^ ((q << 4 | q >> 4) & 255) ^ 0x63;
      SBOX[p] = x;
      INV_SBOX[x] = p;
    } while (p !== 1);
    SBOX[0] = 0x63;
    INV_SBOX[0x63] = 0;
  })();

  function xtime(a) { return ((a << 1) ^ (a & 128 ? 0x1b : 0)) & 255; }
  function gmul(a, b) {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = xtime(a);
      b >>= 1;
    }
    return r;
  }

  function expandKey(key) {
    const nk = key.length >> 2;
    const nr = nk + 6;
    const w = key.slice();
    let rcon = 1;
    for (let i = nk; i < 4 * (nr + 1); i++) {
      let t = w.slice((i - 1) * 4, i * 4);
      if (i % nk === 0) {
        t = [SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
        rcon = xtime(rcon);
      } else if (nk > 6 && i % nk === 4) {
        t = t.map(v => SBOX[v]);
      }
      for (let j = 0; j < 4; j++) w.push(w[(i - nk) * 4 + j] ^ t[j]);
    }
    return { w, nr };
  }

  function encryptBlock(s, ks) {
    const { w, nr } = ks;
    for (let i = 0; i < 16; i++) s[i] ^= w[i];
    for (let r = 1; r <= nr; r++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      if (r < nr) {
        for (let c = 0; c < 16; c += 4) {
          const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
          const x = a0 ^ a1 ^ a2 ^ a3;
          s[c] ^= x ^ xtime(a0 ^ a1);
          s[c + 1] ^= x ^ xtime(a1 ^ a2);
          s[c + 2] ^= x ^ xtime(a2 ^ a3);
          s[c + 3] ^= x ^ xtime(a3 ^ a0);
        }
      }
      for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    }
    return s;
  }

  function decryptBlock(s, ks) {
    const { w, nr } = ks;
    for (let i = 0; i < 16; i++) s[i] ^= w[nr * 16 + i];
    for (let r = nr - 1; r >= 0; r--) {
      let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
      for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
      if (r > 0) {
        for (let c = 0; c < 16; c += 4) {
          const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
          s[c] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
          s[c + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
          s[c + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
          s[c + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
        }
      }
    }
    return s;
  }

  function aesCbcEncrypt(data, key, iv) {
    const ks = expandKey(key);
    const pad = 16 - (data.length % 16);
    const src = data.concat(new Array(pad).fill(pad));
    const out = [];
    let prev = iv.slice();
    for (let i = 0; i < src.length; i += 16) {
      const block = src.slice(i, i + 16).map((v, j) => v ^ prev[j]);
      prev = encryptBlock(block, ks);
      for (let j = 0; j < 16; j++) out.push(prev[j]);
    }
    return out;
  }

  function aesCbcDecrypt(data, key, iv) {
    if (!data.length || data.length % 16) throw new Error("AES 密文长度错误");
    const ks = expandKey(key);
    const out = [];
    let prev = iv.slice();
    for (let i = 0; i < data.length; i += 16) {
      const block = data.slice(i, i + 16);
      const plain = decryptBlock(block.slice(), ks);
      for (let j = 0; j < 16; j++) out.push(plain[j] ^ prev[j]);
      prev = block;
    }
    const pad = out[out.length - 1];
    if (pad < 1 || pad > 16) throw new Error("AES 填充错误");
    return out.slice(0, out.length - pad);
  }

  function md5(bytes) {
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const msg = bytes.slice();
    const bitLen = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (let i = 0; i < 8; i++) msg.push(i < 4 ? (bitLen >>> (8 * i)) & 255 : Math.floor(bitLen / 4294967296) >>> (8 * (i - 4)) & 255);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let off = 0; off < msg.length; off += 64) {
      const M = [];
      for (let i = 0; i < 16; i++) M[i] = msg[off + i * 4] | (msg[off + i * 4 + 1] << 8) | (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const sh = S[(i >> 4) * 4 + (i & 3)];
        const x = (A + F + K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((x << sh) | (x >>> (32 - sh)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = [];
    [a0, b0, c0, d0].forEach(v => { for (let i = 0; i < 4; i++) out.push((v >>> (8 * i)) & 255); });
    return bytesToHex(out);
  }

  let ZERO, ONE;
  function initBig() {
    if (ONE) return;
    if (typeof BigInt !== "function") throw new Error("当前运行环境不支持 BigInt");
    ZERO = BigInt(0);
    ONE = BigInt(1);
  }

  function bytesToBig(bytes) {
    initBig();
    const h = bytesToHex(bytes);
    return h ? BigInt("0x" + h) : ZERO;
  }

  function bigToBytes(n, len) {
    let h = n.toString(16);
    if (h.length % 2) h = "0" + h;
    const b = hexToBytes(h);
    while (b.length < len) b.unshift(0);
    return b;
  }

  function modPow(base, exp, mod) {
    let r = ONE;
    let b = base % mod;
    let e = exp;
    while (e > ZERO) {
      if (e & ONE) r = (r * b) % mod;
      e >>= ONE;
      b = (b * b) % mod;
    }
    return r;
  }

  function derIntegers(bytes) {
    const ints = [];
    (function walk(start, end) {
      let p = start;
      while (p < end) {
        const tag = bytes[p++];
        let len = bytes[p++];
        if (len & 128) {
          const n = len & 127;
          len = 0;
          for (let i = 0; i < n; i++) len = len * 256 + bytes[p++];
        }
        if (tag === 0x02) ints.push(bytesToBig(bytes.slice(p, p + len)));
        else if (tag === 0x30) walk(p, p + len);
        else if (tag === 0x03) walk(p + 1, p + len);
        else if (tag === 0x04) { try { walk(p, p + len); } catch (e) {} }
        p += len;
      }
    })(0, bytes.length);
    return ints;
  }

  const keyCache = {};
  function parseKey(pem) {
    if (keyCache[pem]) return keyCache[pem];
    const der = base64ToBytes(String(pem).replace(/-----[^-]+-----/g, ""));
    const ints = derIntegers(der);
    let i = 0;
    while (i < ints.length && ints[i] < BigInt(1) << BigInt(256)) i++;
    const n = ints[i];
    if (!n) throw new Error("RSA 密钥解析失败");
    const key = { n, e: ints[i + 1], d: ints[i + 2], p: ints[i + 3], q: ints[i + 4], dp: ints[i + 5], dq: ints[i + 6], qi: ints[i + 7] };
    key.size = bigToBytes(n, 0).length;
    keyCache[pem] = key;
    return key;
  }

  function rsaEncrypt(text, pem) {
    const key = parseKey(pem);
    const k = key.size;
    const msg = utf8Encode(text);
    if (msg.length > k - 11) throw new Error("RSA 明文过长");
    const em = [0, 2];
    for (let i = 0; i < k - 3 - msg.length; i++) em.push(1 + Math.floor(Math.random() * 255));
    em.push(0);
    const c = modPow(bytesToBig(em.concat(msg)), key.e, key.n);
    return bytesToBase64(bigToBytes(c, k));
  }

  function rsaPrivate(c, key) {
    if (key.p && key.q && key.dp && key.dq && key.qi) {
      const m1 = modPow(c % key.p, key.dp, key.p);
      const m2 = modPow(c % key.q, key.dq, key.q);
      let h = ((m1 - m2) * key.qi) % key.p;
      if (h < ZERO) h += key.p;
      return m2 + h * key.q;
    }
    return modPow(c, key.d, key.n);
  }

  function rsaDecrypt(b64, pem) {
    try {
      const key = parseKey(pem);
      const k = key.size;
      const raw = base64ToBytes(b64);
      let out = [];
      for (let off = 0; off < raw.length; off += k) {
        const em = bigToBytes(rsaPrivate(bytesToBig(raw.slice(off, off + k)), key), k);
        if (em[0] !== 0 || em[1] !== 2) return null;
        const sep = em.indexOf(0, 2);
        if (sep < 10) return null;
        out = out.concat(em.slice(sep + 1));
      }
      return utf8Decode(out);
    } catch (e) {
      return null;
    }
  }

  return {
    aesEncryptHex: (text, key, iv) => bytesToHex(aesCbcEncrypt(utf8Encode(text), utf8Encode(key), utf8Encode(iv))),
    aesDecryptHex: (hex, key, iv) => utf8Decode(aesCbcDecrypt(hexToBytes(hex), utf8Encode(key), utf8Encode(iv))),
    md5: text => md5(utf8Encode(text)),
    rsaEncrypt,
    rsaDecrypt,
    base64Decode: text => utf8Decode(base64ToBytes(text))
  };
})();

/* ==================== 瓜子协议常量（来自站点客户端） ==================== */
var GZ_UA = "Phenomara/1 CFNetwork/3896.200.61 Darwin/27.2.0";
/* 播放/取流必须用播放器 UA：浏览器类 UA 会被源站 302 到占位清单 */
var GZ_PLAY_UA = "AppleCoreMedia/1.0.0.24A5390f (iPhone; U; CPU OS 27_0 like Mac OS X; zh_cn)";
var GZ_KEY = "aaaabbbbccccdddd", GZ_IV = "1111222233334444";
var GZ_SALT = "&ffddffujhjhgvdvdvdz4Y!s!2br";
var GZ_APPVER = "2026033001", GZ_APIVER = "3.0.6.3";
var GZ_PKGNAME = "com.jfm202203", GZ_CODE = "GZ0520";
var GZ_PUB = "-----BEGIN PUBLIC KEY-----MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCWJafJAdhTPWMrNpbmlk672o06smRwxe1LoHjy2XbLRaKIXfQJWgJTBhLH4qUIPMmpnIKQYqjMLTrJhwG5Bwsd3/15YHdL7eWad7lpomF5doOQmmexK2+gSBHmCOhXeumhrOD63vx8ERepxR6UCxTi5b5fZmqMdbLk45IW39mn6wIDAQAB-----END PUBLIC KEY-----";
var GZ_PRIV = "-----BEGIN RSA PRIVATE KEY-----MIICXQIBAAKBgQCM+iJdCeYFydG3DiFG0Ajr6IS0NENW1Bb2MSwrUdvLiI7nXHG+zZZuyqewVUPUPQRdEvhSMCyTKjjX9QajRJ1Uv+xVnsOmxEQQIhAIUa1dsXsN30nLGA+VuNHF7J1SE+Vh/46duR/0Q+Iq+3esSYlb3/PdN4wgK5ab+jKeR0JA2wIDAQABAoGAbst/CkPnRZFRgl5WhMKm4FDDSqTwb2MMELygjAMvjIxsUyRyOJR2r+gRViIMxtaVgViRVHaL8bTzK7ZkWxhn1LEM7RpWB1zjKFvXxE+dzxPrYY/Qw7dobzAAMyQhZ2+7PTO/plUYOxNgZPUzsvcoI44M3HRy1yFxGbF9z9LiMDECQQDTs5eXJnjEN1JmqbBotFw0III0/se/r0oDv4AvJdbxl64t64dZI2tS3BO7NL3OAOzf+WL14Pf2uADFDZz9kzHPAkEAqnn7TBlZXc6L70TnCaggMAN9C+2Iuik2Q2dePfTBI9IyJiC54k4G66iT+kQ5F6T4MGWf6jb7xUuUTk6AHck/NQJBALk+5oAh7v0rt5QUGkSUxjXq2GUNKLbn6Ok8sisPfnVrF8Qg3A+4+ZnI8A8ZSJkxoBUgwWKMWA5w1mOX1O7i1WsCQHV0qgHajUomnx9x18U9gz/Rh3yKYmPxNSPnunTxh4kIr+i5L5mOrRH9CkeqbbOuxBmES1PyIjHjSwFQ8NCU8ekCQQCwb4PirUbcqeHbjN0Nv6vm5pqsgJ29GhA9qiy2l+1Wb637STe9L2mEt7ImUd9FGy7k3Nnsn5eou/t2SV3OkGaU-----END RSA PRIVATE KEY-----";
/* 站点域名池：任一可用即可；全部失败时再拉远程域名表兜底 */
var GZ_HOSTS = [
  "https://api.sef5w7.com", "https://api.mxtxqe.com", "https://sdapi.u4gdp3.com",
  "https://sdapi.4zu76s.com", "https://sdapi.re3k7n.com", "https://api.8b42w67.com",
  "https://api.4pmyvfz.com", "https://sdapi.s3432pr.com", "https://sdapi.q5sn3gk.com",
  "https://apinew.qwepe.com",
];
var GZ_THIRD = "https://raw.githubusercontent.com/tdopops/jiafeimao/main/0103/jfm-ios-prod.json";
var GZ_THIRD_AES = { key: "m4nQCskrndxTCULX", iv: "92ilxgNlcweTTfvG" };

/* 进程内状态：token / 设备号 / 已选域名 / post 调用形态 */
/* 请求形态候选：真机 ctx.http.post 的调用约定各版本不一致，
   官方的红果包（App 内实测可用）用「两参 + body 传对象」，bangumi 用「三参 + body 字符串」。
   这里按顺序试，第一个能解出响应包络的形态锁定下来，之后不再试探。 */
var GZ_SHAPES = ["obj2", "str2", "obj2mini", "str3"];
var GZ_STATE = { host: "", token: "", tid: "", dev: "", style: "" };
var GZ_KEYS_CACHE = "";
var GZ_REMOTE_CACHE = null;

function gzKeysBlob() {
  if (!GZ_KEYS_CACHE) GZ_KEYS_CACHE = GxCrypto.rsaEncrypt(JSON.stringify({ key: GZ_KEY, iv: GZ_IV }), GZ_PUB);
  return GZ_KEYS_CACHE;
}
/* 设备号：固定种子派生（同一 App 内稳定，避免每次调用都注册新账号） */
function gzDeviceId() {
  if (GZ_STATE.dev) return GZ_STATE.dev;
  var h = GxCrypto.md5("conflux.guazi.v2|device").toUpperCase();
  GZ_STATE.dev = h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(12, 15) + "-8" + h.slice(0, 3) + "-" + h.slice(0, 12);
  return GZ_STATE.dev;
}
function gzHeaders() {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Version": GZ_APPVER, "api-ver": GZ_APIVER,
    "packagename": GZ_PKGNAME, "code": GZ_CODE, "ver": GZ_APIVER,
    "deviceid": gzDeviceId(), "ip": "", "lang": "zh_cn",
    "User-Agent": GZ_UA, "x-customer-client-ip": "", "parent-code": "",
  };
}
function gzPayload(params) {
  var ts = Math.floor(new Date().getTime() / 1000);
  var rk = GxCrypto.aesEncryptHex(JSON.stringify(params || {}), GZ_KEY, GZ_IV);
  var keys = gzKeysBlob();
  var tok = GZ_STATE.token, tid = GZ_STATE.tid;
  var sb = "token_id=" + tid + ",token=" + tok + ",phone_type=2,request_key=" + rk +
    ",app_id=1,time=" + ts + ",keys=" + keys;
  return JSON.stringify({
    token: tok, token_id: tid, time: ts, app_id: "1", phone_type: 2,
    keys: keys, request_key: rk,
    signature: GxCrypto.md5(sb + "*" + GZ_SALT).toUpperCase(), ad_version: 1,
  });
}
/* ctx.http.post 形态自适应：官方样例两种写法并存（post(url,{headers,body}) 与 post(url, bodyStr, opts)）。
   先试 options-body 形态；抛异常或鉴权拿不到 token 时切到三参形态并记住。 */
/* 响应里是否带加密包络（服务端用我们发的 AES key 加密后的 data） */
function gzHasEnvelope(res) {
  var body = res && res.data !== undefined ? res.data : res;
  var d = body && body.data;
  return !!(d && d.response_key && d.keys);
}

function gzMiniHeaders() {
  return { "Content-Type": "application/json", "Accept": "application/json, text/plain, */*", "User-Agent": GZ_UA };
}

async function gzPostShape(ctx, url, bodyStr, shape) {
  var res;
  if (shape === "obj2" || shape === "obj2mini") {
    var hd = shape === "obj2mini" ? gzMiniHeaders() : gzHeaders();
    res = await ctx.http.post(url, { headers: hd, body: JSON.parse(bodyStr), timeoutMs: 20000 });
  } else if (shape === "str3") {
    res = await ctx.http.post(url, bodyStr, { headers: gzHeaders(), timeoutMs: 20000 });
  } else {
    res = await ctx.http.post(url, { headers: gzHeaders(), body: bodyStr, timeoutMs: 20000 });
  }
  return res;
}

/* 按候选顺序请求，返回第一个能解出响应包络的结果；全部失败返回最后一次的 null */
async function gzPostRaw(ctx, url, bodyStr) {
  var order = GZ_STATE.style ? [GZ_STATE.style] : GZ_SHAPES;
  var best = null, firstErr = null;
  for (var i = 0; i < order.length; i++) {
    try {
      var res = await gzPostShape(ctx, url, bodyStr, order[i]);
      var enc = gzHasEnvelope(res);
      var obj = gzDecode(res);
      if (obj && (enc || num(obj.code) === 200)) {
        GZ_STATE.style = order[i];
        gzLog(ctx, "形态锁定 " + order[i]);
        return obj;
      }
      /* 能解析但没有加密包络、code 也不是 200：多半这个形态的 body 没送到，
         记下第一个错误包络（含服务端原话），继续试下一个形态 */
      if (obj && !best) best = obj;
    } catch (e) {
      if (!firstErr) firstErr = e;
      gzLog(ctx, order[i] + " 异常：" + ((e && e.message) || e));
    }
  }
  if (best) return best;
  if (firstErr) throw firstErr;
  return null;
}
function gzDecode(res) {
  var obj = asJson(res && res.data);
  if (!obj) return null;
  var d = obj.data;
  if (d && d.response_key && d.keys) {
    try {
      var ai = JSON.parse(GxCrypto.rsaDecrypt(d.keys, GZ_PRIV));
      var txt = GxCrypto.aesDecryptHex(d.response_key, ai.key, ai.iv);
      try { obj.data = JSON.parse(txt); } catch (e2) { obj.data = txt; }
    } catch (e) {
      /* 解不开 ⇒ 不是「请求成功」：多半是运行时没把 body 送到（post 形态不对），
         交给上层切形态重试；真错误时上层会抛 unavailable。 */
      return null;
    }
  }
  return obj;
}
async function gzLoginPass(ctx, host) {
  var dev = gzDeviceId();
  var paths = ["/App/Authentication/Device/signIn", "/App/Authentication/Device/signUp"];
  for (var i = 0; i < paths.length; i++) {
    try {
      var obj = await gzPostRaw(ctx, host + paths[i], gzPayload({ new_key: dev, old_key: dev }));
      if (obj && num(obj.code) === 200 && obj.data && obj.data.token) {
        GZ_STATE.token = str(obj.data.token);
        GZ_STATE.tid = str(obj.data.token_id);
        return true;
      }
    } catch (e) { /* 换下一个入口 / 下一个域名 */ }
  }
  return false;
}

/* 登录：gzPostRaw 内部已按候选形态逐个试，这里只需按两个入口各试一次。
 * 两个入口都失败才算真失败（新设备首次可能 signIn 报「不存在」）。 */
async function gzLogin(ctx, host) {
  return await gzLoginPass(ctx, host);
}
function gzHosts(ctx) {
  var out = [];
  /* 上次成功的域名优先，省掉一轮试错 */
  if (GZ_STATE.host) out.push(GZ_STATE.host);
  var custom = trim(ctx && ctx.settings && ctx.settings.apiHost).replace(/\/+$/, "");
  if (custom && /^https?:\/\//i.test(custom)) out.push(custom);
  for (var i = 0; i < GZ_HOSTS.length; i++) if (out.indexOf(GZ_HOSTS[i]) < 0) out.push(GZ_HOSTS[i]);
  return out;
}
/* 兜底：拉远程域名表（作者维护），解出域名后追加尝试 */
async function gzRemoteHosts(ctx) {
  if (GZ_REMOTE_CACHE) return GZ_REMOTE_CACHE;
  var out = [];
  try {
    var res = await ctx.http.get(GZ_THIRD, { headers: { "User-Agent": GZ_UA }, timeoutMs: 8000 });
    var root = asJson(res && res.data);
    var enc = root && root.code === 200 && root.data && root.data.response_key;
    if (enc) {
      var txt = GxCrypto.aesDecryptHex(enc, GZ_THIRD_AES.key, GZ_THIRD_AES.iv);
      var list = asJson(txt) && asJson(txt).list;
      if (Object.prototype.toString.call(list) === "[object Array]") {
        for (var i = 0; i < list.length; i++) {
          var u = trim(list[i]).replace(/\/+$/, "");
          if (/^https:\/\/[a-z0-9.-]+$/i.test(u) && out.indexOf(u) < 0) out.push(u);
        }
      }
    }
  } catch (e) { /* 远程表不可用就算了，不阻断 */ }
  GZ_REMOTE_CACHE = out;
  return out;
}
/* 切换 post 形态（options ↔ three），全局最多切 2 次 */
/* 单域名一次尝试：需要鉴权时先登录；token 失效就重登一次 */
function gzLog(ctx, msg) {
  try { if (ctx && ctx.console && typeof ctx.console.log === "function") ctx.console.log("[guazi] " + msg); } catch (e) {}
}

function gzDelay(ms) {
  return new Promise(function (resolve) {
    if (typeof setTimeout === "function") setTimeout(resolve, ms);
    else resolve();
  });
}

async function gzAttempt(ctx, host, path, params, needAuth) {
  if (needAuth && !GZ_STATE.token) { if (!(await gzLogin(ctx, host))) return null; }
  var obj = await gzPostRaw(ctx, host + path, gzPayload(params));
  var code = num(obj && obj.code);
  if (code === 301 || code === 401 || code === 403) {
    GZ_STATE.token = ""; GZ_STATE.tid = "";
    if (await gzLogin(ctx, host)) obj = await gzPostRaw(ctx, host + path, gzPayload(params));
  }
  /* 并发一高上游会用 404/300 假错误限流（实测并发 16 时 50 次调用出现 70 次 404），
     退避 600ms 重发一次即可恢复，不必换域名 */
  code = num(obj && obj.code);
  if (code === 429 || code === 404 || code === 300) {
    await gzDelay(600);
    obj = await gzPostRaw(ctx, host + path, gzPayload(params));
  }
  return obj;
}
/* 主入口：多域名轮换 + 远程域名兜底；成功返回 data，失败抛 ExtensionError */
async function gzCall(ctx, path, params, needAuth) {
  var hosts = gzHosts(ctx);
  var lastMsg = "";
  for (var pass = 0; pass < 2; pass++) {
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      var obj = null;
      try { obj = await gzAttempt(ctx, host, path, params, needAuth); }
      catch (e) { lastMsg = (e && e.message) || "网络异常"; continue; }
      /* 解不开不是域名问题，换域名只会白白放大请求量 */
      if (!obj) { lastMsg = "响应无法解密"; break; }
      var code = num(obj.code);
      if (code === 200) { GZ_STATE.host = host; return obj.data !== undefined && obj.data !== null ? obj.data : obj; }
      lastMsg = pick(obj.msg, "接口返回 " + code);
      /* 只对鉴权/限流类错误换域名，业务错误直接抛 */
      if (code !== 301 && code !== 401 && code !== 403 && code !== 429) break;
    }
    if (pass === 0) {
      var extra = await gzRemoteHosts(ctx);
      for (var k = 0; k < extra.length; k++) if (hosts.indexOf(extra[k]) < 0) hosts.push(extra[k]);
      if (!extra.length) break;
    }
  }
  fail("瓜子接口不可用：" + pick(lastMsg, "所有域名均失败"), "unavailable");
}

/* ---------- 统一数据整形：把两种上游行形态（榜单/搜索）归一 ----------
 * 榜单行：vod_id / title / pic / score / vod_year / vod_continu / d_total
 * 搜索行：vod_id / vod_name / vod_pic / vod_scroe / vod_year / vod_continu / d_total
 */
function asRows(v) {
  if (Object.prototype.toString.call(v) === "[object Array]") return v;
  if (v && Object.prototype.toString.call(v.list) === "[object Array]") return v.list;
  return [];
}
function normRows(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = asObject(rows[i]);
    var id = digits(r.vod_id || r.id);
    if (!id) continue;
    var total = num(r.vod_continu) || num(r.d_total) || num(r.total);
    out.push({
      id: id,
      title: pick(r.title || r.vod_name, "未命名"),
      cover: trim(r.pic || r.vod_pic),
      year: trim(r.vod_year),
      score: trim(r.score || r.vod_scroe),
      total: total,
      desc: pick(r.sub_title || r.vod_remarks),
    });
  }
  return out;
}

/* ---------- 数据入口：保持旧桥的 path 形态，内部直连站点 API ----------
 * /rank/<cateId>?page=N  → NewDiscover/getList
 * /search?kw=            → Index/findMoreVod
 * /catalog/<vodId>       → Resource/Vurl/show
 * /play/<vurlId>         → Resource/Vod/vurlDetail
 * token 只在内存里缓存（context 级）：不碰 ctx.storage —— widget.load 里调用会原生崩溃（pitfall #6）。
 */
async function apiGet(ctx, path, query, opts) {
  var q = asObject(query), p = str(path);
  if (p === "/search") {
    var kw = trim(q.kw || q.keywords);
    if (!kw) return { list: [] };
    var d1 = await gzCall(ctx, "/App/Index/findMoreVod", { keywords: kw, order_val: "" }, true);
    return { list: normRows(asRows(d1)), more: false };
  }
  if (p.indexOf("/rank/") === 0) {
    var cate = p.slice("/rank/".length);
    var page = num(q.page) > 0 ? num(q.page) : 1;
    var size = num(q.size) > 0 ? num(q.size) : 10;
    /* 榜单列表不要求 token（实测未鉴权也返回 200），省一次登录往返 */
    var d2 = await gzCall(ctx, "/App/NewDiscover/getList", { cateId: cate, page: page, pageSize: size }, false);
    return {
      list: normRows(asRows(d2)),
      total: num(d2 && d2.total),
      more: !!(d2 && d2.is_more),
      page: page,
    };
  }
  if (p.indexOf("/catalog/") === 0) {
    var vodId = digits(p.slice("/catalog/".length));
    if (!vodId) return { list: [] };
    var d3 = await gzCall(ctx, "/App/Resource/Vurl/show", { vod_d_id: vodId, vurl_cloud_id: "2" }, true);
    var raw = asRows(d3), eps = [];
    for (var i = 0; i < raw.length; i++) {
      var e = asObject(raw[i]);
      if (!e.id) continue;
      var n = num(e.sort) || eps.length + 1;
      eps.push({ id: digits(e.id), n: n, title: pick(e.title, "第 " + n + " 集") });
    }
    return { list: eps };
  }
  if (p.indexOf("/play/") === 0) {
    var vurlId = digits(p.slice("/play/".length));
    if (!vurlId) return { list: [] };
    var d4 = await gzCall(ctx, "/App/Resource/Vod/vurlDetail", { vurl_id: vurlId }, true);
    var items = asRows(d4), lines = [];
    for (var j = 0; j < items.length; j++) {
      var it = asObject(items[j]);
      var u = trim(it.url);
      if (!u) continue;
      lines.push({ url: u, resolution: num(it.resolution), name: pick(it.name) });
    }
    return { list: lines };
  }
  return { list: [] };
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

var LIBRARY_TYPES = [
  {
    "id": "1",
    "name": "电影",
    "subs": [
      {
        "id": "5",
        "name": "动作片"
      },
      {
        "id": "29",
        "name": "悬疑片"
      },
      {
        "id": "6",
        "name": "喜剧片"
      },
      {
        "id": "7",
        "name": "爱情片"
      },
      {
        "id": "8",
        "name": "科幻片"
      },
      {
        "id": "9",
        "name": "恐怖片"
      },
      {
        "id": "10",
        "name": "剧情片"
      },
      {
        "id": "11",
        "name": "战争片"
      },
      {
        "id": "36",
        "name": "动画片"
      },
      {
        "id": "20",
        "name": "纪录片"
      },
      {
        "id": "38",
        "name": "灾难片"
      },
      {
        "id": "61",
        "name": "犯罪片"
      }
    ]
  },
  {
    "id": "2",
    "name": "电视剧",
    "subs": [
      {
        "id": "12",
        "name": "国产剧"
      },
      {
        "id": "13",
        "name": "香港剧"
      },
      {
        "id": "14",
        "name": "台湾剧"
      },
      {
        "id": "15",
        "name": "欧美剧"
      },
      {
        "id": "16",
        "name": "日本剧"
      },
      {
        "id": "17",
        "name": "韩国剧"
      },
      {
        "id": "18",
        "name": "海外剧"
      },
      {
        "id": "19",
        "name": "泰国剧"
      },
      {
        "id": "69",
        "name": "新加坡"
      }
    ]
  },
  {
    "id": "4",
    "name": "动漫",
    "subs": [
      {
        "id": "30",
        "name": "中国动漫"
      },
      {
        "id": "31",
        "name": "日本动漫"
      },
      {
        "id": "33",
        "name": "欧美动漫"
      }
    ]
  },
  {
    "id": "3",
    "name": "综艺",
    "subs": [
      {
        "id": "22",
        "name": "大陆综艺"
      },
      {
        "id": "23",
        "name": "港台综艺"
      },
      {
        "id": "24",
        "name": "日韩综艺"
      },
      {
        "id": "25",
        "name": "欧美综艺"
      }
    ]
  },
  {
    "id": "64",
    "name": "短剧",
    "subs": []
  },
  {
    "id": "72",
    "name": "音乐",
    "subs": []
  },
  {
    "id": "74",
    "name": "AI漫剧",
    "subs": []
  },
  {
    "id": "73",
    "name": "电影解说",
    "subs": []
  },
  {
    "id": "71",
    "name": "体育解说",
    "subs": []
  },
  {
    "id": "70",
    "name": "电竞解说",
    "subs": []
  },
  {
    "id": "75",
    "name": "AI剧场",
    "subs": []
  },
  {
    "id": "39",
    "name": "分类39",
    "subs": []
  }
];
/* ---------- 隐藏片库：与 NewDiscover 榜单分开，站方 IndexList 真分页 ---------- */
var LIBRARY_PAGE_SIZE = 30;
function libraryType(tid) {
  for (var i = 0; i < LIBRARY_TYPES.length; i++) if (LIBRARY_TYPES[i].id === str(tid)) return LIBRARY_TYPES[i];
  return null;
}
function librarySpec(refId) {
  var m = /^list:library:(\d+):(\d+)$/.exec(str(refId));
  if (!m) return null;
  var t = libraryType(m[1]);
  if (!t) return null;
  var sub = m[2];
  if (sub !== "0" && !asArray(t.subs).some(function (s) { return s.id === sub; })) return null;
  return { tid: t.id, sub: sub, name: t.name };
}
function libraryPage(input) {
  var p = input && input.page && input.page.page;
  if (p === undefined || p === null) return 1;
  var n = Number(p);
  if (!isFinite(n) || n < 1 || Math.floor(n) !== n) fail("片库页码无效", "invalid_params");
  if (n > 100) fail("站方片库分页最多 100 页，请使用搜索定位更早影片", "invalid_params");
  return n;
}
async function fetchLibraryPage(ctx, spec, page) {
  var data = await gzCall(ctx, "/App/IndexList/indexList", {
    area: "0", year: "0", sort: "d_id", page: String(page), pageSize: String(LIBRARY_PAGE_SIZE),
    tid: spec.tid, sub: spec.sub
  }, true);
  if (!data || !Array.isArray(data.list)) fail("瓜子片库返回了无效列表", "unavailable");
  if (num(data.page) > 0 && num(data.page) !== page) fail("站方片库分页未前进，已停止重复加载", "unavailable");
  var rows = normRows(data.list);
  var total = num(data.total);
  var size = num(data.pageSize) || LIBRARY_PAGE_SIZE;
  var more = page < 100 && rows.length > 0 && (total > 0 ? page * size < total : rows.length >= size);
  return { rows: rows, total: total, more: more };
}
function libraryItems(ctx, rows) {
  var seen = {}, items = [];
  rows.forEach(function (r) {
    if (!r || !r.id || seen[r.id]) return;
    seen[r.id] = true;
    var it = listItem(ctx, r);
    if (it) { it.intent = "detail"; items.push(it); }
  });
  return items;
}
async function loadLibrary(ctx, input, tid, sub, widget) {
  var spec = librarySpec("list:library:" + tid + ":" + sub);
  if (!spec) fail("瓜子片库分类不存在", "invalid_params");
  var p = libraryPage(input), res = await fetchLibraryPage(ctx, spec, p);
  var out = { items: libraryItems(ctx, res.rows) };
  if (res.more) out.next = { type: "page", page: p + 1 };
  return out;
}
async function loadAllLibrary(ctx, input) {
  var p = libraryPage(input);
  var res = await fetchLibraryPage(ctx, { tid: "0", sub: "0" }, p);
  var out = { items: libraryItems(ctx, res.rows) };
  if (res.more) out.next = { type: "page", page: p + 1 };
  return out;
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
        var json = await apiGet(ctx, "/rank/" + ids[idx], { page: 1, size: 20 });
        var rows = asArray(asJson(json) && asJson(json).list);
        for (var k = 0; k < rows.length; k++) { if (rows[k] && rows[k].id) out.push(rows[k]); }
      } catch (e) { /* 单个分类失败不影响整体 */ }
    }
  }
  var running = [], n = Math.min(6, ids.length); /* 实测并发 16 会触发上游 404 限流，6 更稳 */
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
  description: "15 个独立榜单 + 全站播放：周榜、流媒体新片、搜索、详情、选集与 HLS 直链播放",
  icon: ICON,
  permissions: {
    /* 前缀通配（官方 danmu.js 同写法）覆盖站点轮换域名 + 用户自填域名；
       同时逐个列出已知 API 域名与远程兜底表，双保险。 */
    network: [
      "https://",
      "http://",
      "https://api.sef5w7.com",
      "https://api.mxtxqe.com",
      "https://sdapi.u4gdp3.com",
      "https://sdapi.4zu76s.com",
      "https://sdapi.re3k7n.com",
      "https://api.8b42w67.com",
      "https://api.4pmyvfz.com",
      "https://sdapi.s3432pr.com",
      "https://sdapi.q5sn3gk.com",
      "https://apinew.qwepe.com",
      "https://raw.githubusercontent.com",
    ],
  },
  settings: [
    {
      name: "apiHost",
      title: "API 域名（留空自动）",
      type: "text",
      default: "",
      description: "留空则在 10 个已知域名中自动择优；站点换域名时可手填 https:// 开头的地址",
    },
  ],
  extensions: [
    /* ---------- 诊断（排查用；确认正常后可删） ---------- */
    /* ---------- Widget：瓜子影视 ---------- */
    {
      type: "widget",
      id: "all-videos",
      title: "瓜子影视",
      description: "全类型片库（含隐藏分类）· 真实分页，不再限制为榜单精选",
      template: "poster-grid",
      header: "list",
      ref: { source: "custom", id: "list:all" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadAllLibrary(ctx, input);
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

    {
      type: "widget",
      id: "library-1",
      title: "电影片库",
      description: "完整电影片库 · 站方实时列表与分页",
      template: "backdrop-rail",
      families: ["extraLarge"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "0");
      },
    },
    {
      type: "widget",
      id: "library-1-5",
      title: "动作片",
      description: "完整动作片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:5" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "5");
      },
    },
    {
      type: "widget",
      id: "library-1-29",
      title: "悬疑片",
      description: "完整悬疑片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:29" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "29");
      },
    },
    {
      type: "widget",
      id: "library-1-6",
      title: "喜剧片",
      description: "完整喜剧片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:6" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "6");
      },
    },
    {
      type: "widget",
      id: "library-1-7",
      title: "爱情片",
      description: "完整爱情片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:7" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "7");
      },
    },
    {
      type: "widget",
      id: "library-1-8",
      title: "科幻片",
      description: "完整科幻片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:8" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "8");
      },
    },
    {
      type: "widget",
      id: "library-1-9",
      title: "恐怖片",
      description: "完整恐怖片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:9" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "9");
      },
    },
    {
      type: "widget",
      id: "library-1-10",
      title: "剧情片",
      description: "完整剧情片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:10" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "10");
      },
    },
    {
      type: "widget",
      id: "library-1-11",
      title: "战争片",
      description: "完整战争片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:11" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "11");
      },
    },
    {
      type: "widget",
      id: "library-1-36",
      title: "动画片",
      description: "完整动画片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:36" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "36");
      },
    },
    {
      type: "widget",
      id: "library-1-20",
      title: "纪录片",
      description: "完整纪录片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:20" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "20");
      },
    },
    {
      type: "widget",
      id: "library-1-38",
      title: "灾难片",
      description: "完整灾难片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:38" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "38");
      },
    },
    {
      type: "widget",
      id: "library-1-61",
      title: "犯罪片",
      description: "完整犯罪片片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:1:61" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "1", "61");
      },
    },
    {
      type: "widget",
      id: "library-2",
      title: "电视剧片库",
      description: "完整电视剧片库 · 站方实时列表与分页",
      template: "poster-pager",
      families: ["extraLarge"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "0");
      },
    },
    {
      type: "widget",
      id: "library-2-12",
      title: "国产剧",
      description: "完整国产剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:12" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "12");
      },
    },
    {
      type: "widget",
      id: "library-2-13",
      title: "香港剧",
      description: "完整香港剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:13" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "13");
      },
    },
    {
      type: "widget",
      id: "library-2-14",
      title: "台湾剧",
      description: "完整台湾剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:14" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "14");
      },
    },
    {
      type: "widget",
      id: "library-2-15",
      title: "欧美剧",
      description: "完整欧美剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:15" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "15");
      },
    },
    {
      type: "widget",
      id: "library-2-16",
      title: "日本剧",
      description: "完整日本剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:16" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "16");
      },
    },
    {
      type: "widget",
      id: "library-2-17",
      title: "韩国剧",
      description: "完整韩国剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:17" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "17");
      },
    },
    {
      type: "widget",
      id: "library-2-18",
      title: "海外剧",
      description: "完整海外剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:18" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "18");
      },
    },
    {
      type: "widget",
      id: "library-2-19",
      title: "泰国剧",
      description: "完整泰国剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:19" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "19");
      },
    },
    {
      type: "widget",
      id: "library-2-69",
      title: "新加坡",
      description: "完整新加坡片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:2:69" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "2", "69");
      },
    },
    {
      type: "widget",
      id: "library-4",
      title: "动漫片库",
      description: "完整动漫片库 · 站方实时列表与分页",
      template: "poster-ranked",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:4:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "4", "0");
      },
    },
    {
      type: "widget",
      id: "library-4-30",
      title: "中国动漫",
      description: "完整中国动漫片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:4:30" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "4", "30");
      },
    },
    {
      type: "widget",
      id: "library-4-31",
      title: "日本动漫",
      description: "完整日本动漫片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:4:31" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "4", "31");
      },
    },
    {
      type: "widget",
      id: "library-4-33",
      title: "欧美动漫",
      description: "完整欧美动漫片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:4:33" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "4", "33");
      },
    },
    {
      type: "widget",
      id: "library-3",
      title: "综艺片库",
      description: "完整综艺片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:3:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "3", "0");
      },
    },
    {
      type: "widget",
      id: "library-3-22",
      title: "大陆综艺",
      description: "完整大陆综艺片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:3:22" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "3", "22");
      },
    },
    {
      type: "widget",
      id: "library-3-23",
      title: "港台综艺",
      description: "完整港台综艺片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:3:23" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "3", "23");
      },
    },
    {
      type: "widget",
      id: "library-3-24",
      title: "日韩综艺",
      description: "完整日韩综艺片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:3:24" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "3", "24");
      },
    },
    {
      type: "widget",
      id: "library-3-25",
      title: "欧美综艺",
      description: "完整欧美综艺片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:3:25" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "3", "25");
      },
    },
    {
      type: "widget",
      id: "library-64",
      title: "短剧片库",
      description: "完整短剧片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:64:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "64", "0");
      },
    },
    {
      type: "widget",
      id: "library-72",
      title: "音乐片库",
      description: "完整音乐片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:72:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "72", "0");
      },
    },
    {
      type: "widget",
      id: "library-74",
      title: "AI漫剧片库",
      description: "完整AI漫剧片库 · 站方实时列表与分页",
      template: "poster-pager",
      families: ["extraLarge"],
      header: "list",
      ref: { source: "custom", id: "list:library:74:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "74", "0");
      },
    },
    {
      type: "widget",
      id: "library-73",
      title: "电影解说片库",
      description: "完整电影解说片库 · 站方实时列表与分页",
      template: "backdrop-rail",
      families: ["extraLarge"],
      header: "list",
      ref: { source: "custom", id: "list:library:73:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "73", "0");
      },
    },
    {
      type: "widget",
      id: "library-71",
      title: "体育解说片库",
      description: "完整体育解说片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:71:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "71", "0");
      },
    },
    {
      type: "widget",
      id: "library-70",
      title: "电竞解说片库",
      description: "完整电竞解说片库 · 站方实时列表与分页",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:70:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "70", "0");
      },
    },
    {
      type: "widget",
      id: "library-75",
      title: "AI剧场片库",
      description: "完整AI剧场片库 · 站方实时列表与分页",
      template: "backdrop-rail",
      families: ["extraLarge"],
      header: "list",
      ref: { source: "custom", id: "list:library:75:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "75", "0");
      },
    },

    /* 站方分类39：仅ID与数据已确认，尚无可靠原名，不臆造栏目标签。 */
    {
      type: "widget",
      id: "library-39",
      title: "分类39片库（原名未确认）",
      description: "站方独立分类39 · 数据实时分页，栏目原名未确认",
      template: "poster-grid",
      families: ["small", "medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:library:39:0" },
      placeholderData: PLACEHOLDER_RANK,
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input, "39", "0");
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
        if (id === "list:all") return loadAllLibrary(ctx, input);
        if (id.indexOf("list:library") === 0) {
          var spec = librarySpec(id);
          if (!spec) fail("瓜子片库分类不存在", "invalid_params");
          return loadLibrary(ctx, input, spec.tid, spec.sub);
        }
        if (id.indexOf("list:cat:") === 0 && !CAT_ROUTE[id.slice("list:cat:".length)]) {
          fail("瓜子分类不存在", "invalid_params");
        }
        if (wanted === "mix") {
          /* 混榜：与 widget 同一套混合逻辑 */
          var mixed = await loadMix(ctx);
          return { items: mixed };
        }
        var rows = [];
        var nextPage = null;
        if (id.indexOf("list:rank") === 0 || id.indexOf("list:cat") === 0) {
          var page = input && input.page && num(input.page.page) > 0 ? num(input.page.page) : 1;
          var json = await apiGet(ctx, "/rank/" + wanted, { page: page, size: 20 });
          rows = asArray(asJson(json) && asJson(json).list);
          /* 只有上游明确还有更多（is_more）才给 next，避免「加载更多」得到空白页 */
          if (json && json.more) nextPage = { page: page + 1 };
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
        return { items: items, next: nextPage };
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

        /* 封面/标题来自 ref.id 打包（目录接口只给分集；ctx.storage 在 widget 里会崩，已弃用） */
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
          ref: { source: "custom", id: str(ref.id).indexOf("~") >= 0 ? str(ref.id) : vodId, mediaType: isMovie ? "movie" : "tv" },
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
        var refId = str(ref.id);
        var parsed = unpackRef(refId);
        var id = parsed.id;
        if (!id) return [];

        var e = input && input.episode;
        var want = 0;
        if (typeof e === "number") want = e;
        else if (e && typeof e.episode === "number") want = e.episode;
        var epRefId = e && e.ref && e.ref.id;
        if (!want && epRefId) want = 0;

        /* ref.id 带 "~" ⇒ 影片级 ref（vodId），必须按集号换出 vurlId；
           纯数字 ⇒ 已是分集 id（vurlId），直接播。
           坑 #8：拿 vodId 当 vurlId 会静默播出完全不相干的片子。 */
        var packed = refId.indexOf("~") >= 0;
        var vurlId = id;
        var epTitle = "";
        var eps = [];
        if (packed) {
          try {
            var cat = await apiGet(ctx, "/catalog/" + id);
            eps = asArray(cat && cat.list);
          } catch (err) { eps = []; }
          if (eps.length) {
            var chosen = null;
            for (var i = 0; i < eps.length; i++) {
              if (!want || num(eps[i].n) === want) { chosen = eps[i]; break; }
            }
            if (!chosen) chosen = eps[0];
            vurlId = digits(chosen.id) || id;
            epTitle = pick(chosen.title);
          }
        }
        /* 电影不挂「第N集」标签：以 ref.mediaType 为准（详情已判定形态），
           不能用 eps.length>1 —— 电影可能被拆成 2 个分片。 */
        var epLabel = str(ref.mediaType) === "movie" ? "" : epTitle;

        var play = await apiGet(ctx, "/play/" + vurlId);
        var lines = asArray(play && play.list);

        /* 兜底：没拿到线路且 ref 不是影片级 ⇒ 把 id 当 vodId 再解析一次
           （覆盖「ref 没打包元数据、只有裸 vodId」的历史条目） */
        if (!lines.length && !packed) {
          try {
            var cat2 = await apiGet(ctx, "/catalog/" + id);
            var eps2 = asArray(cat2 && cat2.list);
            if (eps2.length) {
              var pickEp = eps2[0];
              for (var k = 0; k < eps2.length; k++) { if (want && num(eps2[k].n) === want) { pickEp = eps2[k]; break; } }
              vurlId = digits(pickEp.id) || id;
              var play2 = await apiGet(ctx, "/play/" + vurlId);
              lines = asArray(play2 && play2.list);
              if (str(ref.mediaType) !== "movie") epLabel = pick(pickEp.title);
            }
          } catch (err2) { /* 拿不到就按空结果返回 */ }
        }
        if (!lines.length) return [];

        /* 按清晰度从高到低，同清晰度去重；每档一条线路，播放器 UA 直连源站 */
        lines.sort(function (a, b) { return num(b.resolution) - num(a.resolution); });
        var seen = {}, out = [], idx = 0;
        for (var n = 0; n < lines.length; n++) {
          var ln = lines[n];
          var res = num(ln.resolution);
          var key = res ? String(res) : "auto";
          if (seen[key]) continue;
          seen[key] = 1;
          idx++;
          out.push({
            id: "gz-" + vurlId + "-" + (res || "auto"),
            name: "线路" + idx + " · " + (res ? res + "P" : "高清") + (epLabel ? " · " + epLabel : ""),
            description: pick(ln.name, "源站直连"),
            url: ln.url,
            headers: { "User-Agent": GZ_PLAY_UA },
            player: "system",
          });
        }
        return out;
      },
    },
  ],
});
