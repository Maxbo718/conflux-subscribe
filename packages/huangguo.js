/*
 * 黄果短剧 · Conflux 扩展包 (Conflux Extension)
 *
 * 适用应用：Conflux (iOS)
 * 协议规范：Conflux Extension engine 1 (https://docs.conflux.one)
 * 覆盖功能：
 *   - widget:   最近上新 / 精选推荐 / 热播排行榜（均解析官网真实栏目页面）、四个频道分类
 *   - search:   站内短剧搜索（支持关键词及分页）
 *   - list:     全屏海报列表（支持点击 widget 标题查看完整列表、翻页）
 *   - detail:   剧集完整详情（元数据、标签、简介、评分、分集列表及单集时长）
 *   - playback: 官方高清 m3u8 播放线路（按选集动态加载对应直链）
 *
 * 数据源：黄果短剧 API (https://huangguoai.com/api/...)
 * 封面解密：黄果封面采用 AES 加密，默认通过专属解密服务输出标准 JPEG
 */

/* 优先取分集自带的直链；接口若忽略 ?ep= 也能拿到对应集
   （字段名各版本不一，逐个兜） */
function pickEpisodeUrl(d, epNum) {
  var eps = (d && d.episodes) || [];
  for (var i = 0; i < eps.length; i++) {
    var e = eps[i] || {};
    var n = parseInt(e.ep_num != null ? e.ep_num : e.episode, 10);
    if (n !== epNum) continue;
    var u = e.video_url || e.video_url_hevc || e.play_url || e.url || e.m3u8;
    if (u) return u;
  }
  return (d && (d.video_url || d.video_url_hevc)) || "";
}

/* 关键：黄果的 /api/videos/{id} 不认 ?ep=，但**页面** /video/{id}?ep=N 会按集渲染。
   实测 11228：?ep=3 → 50 段/247 秒（第3集），无参 → 52 段/258 秒（第1集）。
   所以播放地址统一从页面 HTML 取，接口只做兜底。 */
// 取流预检：播放器报 "Connection refused" 多半是请求头被 CDN 拒。逐个候选试，取第一个能读到 #EXTM3U 的。
// 播放器对带 & 的查询串兼容性差：优先挑「不带查询串」的等价地址
async function simplifyUrl(ctx, url, headers) {
  var variants = [];
  var noQuery = String(url).split("?")[0];
  if (noQuery !== url) {
    variants.push(noQuery);                                  // 最干净
    var q = String(url).split("?")[1] || "";
    var parts = q.split("&");
    if (parts.length > 1) variants.push(String(url).split("?")[0] + "?" + parts[0]);  // 只留第一个参数
  }
  for (var i = 0; i < variants.length; i++) {
    try {
      var r = await ctx.http.get(variants[i], { headers: headers, timeoutMs: 15000 });
      var b = r && r.data;
      if (r && r.status === 200 && typeof b === "string" && b.indexOf("#EXTM3U") === 0) {
        return { url: variants[i], simplified: true };
      }
    } catch (e) {}
  }
  return { url: url, simplified: false };
}


async function probePlayable(ctx, url) {
  var base = getApiBase(ctx);
  var ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  // 顺序很重要：优先「不带自定义头」——播放器不一定把 headers 带到分片请求上
  var candidates = [
    { name: "裸请求", headers: {} },
    { name: "无Referer", headers: { "User-Agent": ua } },
    { name: "带Referer", headers: { Referer: base + "/", "User-Agent": ua } },
    { name: "Referer+Origin", headers: { Referer: base + "/", Origin: base, "User-Agent": ua } },
  ];
  var tried = [];
  for (var i = 0; i < candidates.length; i++) {
    try {
      var r = await ctx.http.get(url, { headers: candidates[i].headers, timeoutMs: 15000 });
      var body = String((r && r.data) || "");
      var st = (r && r.status) || 0;
      if (body.indexOf("#EXTM3U") >= 0) {
        var total = 0, mm2, re2 = /#EXTINF:([0-9.]+)/g;
        while ((mm2 = re2.exec(body)) !== null) total += parseFloat(mm2[1]) || 0;
        // 分片实测无需任何自定义头（裸请求即 200/真 TS），不再额外下载分片校验：
        // 既省流量与额度，也避免 ctx.http 对二进制返回空造成的误报。
        return {
          ok: true,
          headers: candidates[i].headers,
          label: candidates[i].name + "·清单" + Math.round(total) + "秒",
          tried: tried,
          seconds: Math.round(total),
        };
      }
      tried.push(candidates[i].name + ":" + st + "/非清单");
    } catch (e) {
      tried.push(candidates[i].name + ":失败");
    }
  }
  return { ok: false, headers: candidates[0].headers, label: "", tried: tried };
}

// 页面取集：提取页面里所有 m3u8 候选，逐个下载清单，用「总时长」对齐 episodes[ep-1].duration
// 选最匹配的一条。为什么必须比时长：页面里同时存在 ep1 与其他线路的 m3u8，
// 只按正则取第一个会拿到错的地址（曾导致播放器报 Connection refused）。
function normalizeHtml(h) {
  return String(h || "")
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&quot;/g, '"');
}

function m3u8Candidates(html) {
  var out = [];
  var seen = {};
  var re = /https?:\/\/[^\s"'<>\\)]+?\.m3u8[^\s"'<>\\)]*/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var u = m[0].replace(/&amp;/g, "&");
    if (u.indexOf("//") < 0 || seen[u]) continue;
    seen[u] = 1;
    out.push(u);
    if (out.length >= 8) break;
  }
  return out;
}

async function manifestDuration(ctx, url) {
  try {
    var r = await ctx.http.get(url, {
      headers: {
        Referer: getApiBase(ctx) + "/",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
      timeoutMs: 15000,
    });
    var body = String((r && r.data) || "");
    if (body.indexOf("#EXTM3U") < 0) return null;
    var total = 0, n = 0, mm;
    var re = /#EXTINF:([0-9.]+)/g;
    while ((mm = re.exec(body)) !== null) { total += parseFloat(mm[1]) || 0; n++; }
    return { duration: Math.round(total), segments: n, url: url };
  } catch (e) {
    return null;
  }
}

/* 站方新版播放器：起播/切集均 POST，即取即用，不缓存签名。 */
async function currentPlayback(ctx, base, id, ep) {
  if (!ctx.http || typeof ctx.http.post !== "function") return null;
  var endpoint = base + "/api/videos/" + encodeURIComponent(id) + "/episodes/" + ep + "/playback";
  var res;
  try {
    // 与官方 hongguo 样例一致：两参，body 在 options 内。
    res = await ctx.http.post(endpoint, {
      body: "{}",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", "Referer": base + "/video/" + id + "/" },
      timeoutMs: 12000
    });
  } catch (e) { fail("unavailable", "黄果取流请求失败，请稍后重试", true); }
  var envelope = check(res, true);
  if (!envelope) return null;
  var p = envelope.data || envelope;
  if (p.manifest_method !== "GET" || String(p.id) !== String(id) || Number(p.ep) !== ep || !p.streams) {
    fail("unavailable", "黄果取流返回无效或集数不匹配", true);
  }
  var headers = { "User-Agent": "Mozilla/5.0", "Referer": base + "/" };
  var cdn = p.cdn || {};
  if (cdn.m3u8Enabled && cdn.authKey === "x-cdn-auth" && cdn.authValue && cdn.app) {
    headers[cdn.authKey] = String(cdn.authValue);
    headers["x-cdn-app"] = String(cdn.app);
  }
  var lines = [];
  var codecs = ["main", "hevc"];
  for (var i = 0; i < codecs.length; i++) {
    var key = codecs[i], url = normalizeHtml(p.streams[key]);
    if (!/^https?:\/\//i.test(url) || !/\.m3u8(?:[?#]|$)/i.test(url)) continue;
    if (lines.length && lines[0].url === url) continue;
    lines.push({ id: "huangguo." + id + "." + ep + (key === "hevc" ? ".hevc" : ""),
      name: "第 " + ep + " 集" + (key === "hevc" ? " · HEVC" : ""), url: url,
      description: "黄果短剧 · 即时取流", player: "system", headers: headers });
  }
  if (!lines.length) fail("unavailable", "黄果暂未返回该集播放地址", true);
  return lines;
}

async function playUrlByPage(ctx, videoId, epNum, expectedSeconds, pageUrl) {
  var base = getApiBase(ctx);
  var ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  // 站点每集有独立页面：/video/{id}/ep-{n}/（第1集就是 /video/{id}/）
  var vid = String(videoId);
  var path = "/video/" + encodeURIComponent(vid) + "/";
  if (epNum && epNum > 1) path = "/video/" + encodeURIComponent(vid) + "/ep-" + epNum + "/";
  if (pageUrl) path = pageUrl;   // ref 自带分集页地址时优先，地址即锁定集数
  var pageTarget = /^https?:\/\//i.test(path) ? path : base + path;
  var html = "";
  try {
    var r = await ctx.http.get(pageTarget, {
      headers: { "User-Agent": ua, Accept: "text/html" }, timeoutMs: 20000,
    });
    html = normalizeHtml((r && r.data) || "");
  } catch (e) {
    return { url: "", matched: false, seconds: 0 };
  }
  if (!html) return { url: "", matched: false, seconds: 0 };

  // 优先 <source src>（该集独立页面里的唯一播放源，Yealico/CapyPlayer 用的就是它）
  var direct = "";
  var ms = html.match(/<source[^>]*\bsrc="([^"]+\.m3u8[^"]*)"/i);
  if (ms && ms[1]) direct = ms[1].replace(/&amp;/g, "&");
  if (!direct) {
    var md = html.match(/data-hls="([^"]+)"/);
    if (md && md[1]) direct = md[1].replace(/&amp;/g, "&");
  }

  // 独立分集页里的 <source src> 就是这一集的唯一播放源：直接采信，不再猜时长
  if (direct && /\.m3u8/i.test(direct)) {
    return { url: direct, matched: true, seconds: 0, viaSource: true };
  }

  var cands = m3u8Candidates(html);
  if (direct && cands.indexOf(direct) < 0) cands.unshift(direct);
  if (!cands.length) return { url: direct, matched: false, seconds: 0 };

  var fallback = "", fbSeconds = 0;
  var bestUrl = "", bestSeconds = 0, bestDiff = 1e9;
  for (var i = 0; i < cands.length; i++) {
    var info = await manifestDuration(ctx, cands[i]);
    if (!info) continue;
    if (!fallback) { fallback = cands[i]; fbSeconds = info.duration; }
    if (!expectedSeconds) return { url: cands[i], matched: true, seconds: info.duration };
    var diff = Math.abs(info.duration - expectedSeconds);
    if (diff < bestDiff) { bestDiff = diff; bestUrl = cands[i]; bestSeconds = info.duration; }
  }
  // 时长误差约 ±2 秒（EXTINF 取整），容差 6 秒；仍无法唯一确定时如实标注
  if (bestUrl && bestDiff <= 6) return { url: bestUrl, matched: true, seconds: bestSeconds };
  if (fallback) return { url: fallback, matched: false, seconds: fbSeconds };
  if (direct) return { url: direct, matched: false, seconds: 0 };
  return { url: "", matched: false, seconds: 0 };
}

var DEFAULT_API_BASE = "https://huangguoai.com";
var DEFAULT_COVER_PROXY = "https://hgpic.113210833.xyz/";
var VERSION = "3.4.0";

// base64url 编码（纯 JS，避免依赖 btoa 的可用性）
function b64u(str) {
  var CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var bytes = [], i, k, c;
  str = String(str);
  for (k = 0; k < str.length; k++) {
    c = str.charCodeAt(k);
    if (c < 128) bytes.push(c);
    else if (c < 2048) { bytes.push(192 | (c >> 6), 128 | (c & 63)); }
    else { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
  }
  var out = "";
  for (i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += CH[b0 >> 2];
    out += CH[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    if (b1 === undefined) break;
    out += CH[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    if (b2 === undefined) break;
    out += CH[b2 & 63];
  }
  return out;
}

var PAGE_SIZE = 20;

/* ---------- 异常与错误处理 ---------- */

function fail(code, message, retryable) {
  var payload = { code: code, message: message, retryable: !!retryable };
  if (typeof ExtensionError === "function") {
    throw new ExtensionError(payload);
  }
  var e = new Error(message);
  e.code = code;
  e.retryable = !!retryable;
  throw e;
}

function parseData(res) {
  var data = res && res.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      fail("unavailable", "上游返回了无法解析的数据格式", true);
    }
  }
  return data;
}

function check(res, allow404) {
  if (!res) fail("unavailable", "服务无响应，请检查网络", true);
  var s = res.status;
  if (s >= 200 && s < 300) return parseData(res);
  if (s === 404 && allow404) return null;
  if (s === 404) fail("not_found", "找不到该作品或内容", false);
  if (s === 429) fail("rate_limited", "请求过于频繁，请稍后再试", true);
  if (s === 400 || s === 422) fail("invalid_params", "请求参数无效", false);
  fail("unavailable", "黄果服务暂时不可用 (HTTP " + s + ")", true);
}

/* ---------- 网络与 URL 辅助 ---------- */

function getApiBase(ctx) {
  var s = (ctx && ctx.settings && ctx.settings.apiBase) || "";
  s = String(s).trim().replace(/\/+$/, "");
  return s || DEFAULT_API_BASE;
}

function getCoverProxy(ctx) {
  var s = (ctx && ctx.settings && ctx.settings.coverProxy) || "";
  s = String(s).trim();
  if (s && !/\/+$/.test(s)) s += "/";
  return s || DEFAULT_COVER_PROXY;
}

function wrapCover(ctx, rawUrl) {
  var u = String(rawUrl || "").trim();
  if (!u) return undefined;
  if (/^data:|^blob:/i.test(u)) return u;
  var proxy = getCoverProxy(ctx);
  if (!proxy) return u;
  if (u.indexOf(proxy) === 0) return u;
  var sep = proxy.indexOf("?") >= 0 ? "&" : "?";
  return proxy + sep + "url=" + encodeURIComponent(u);
}

function cleanTitle(val) {
  return String(val || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[-|_]\s*(黄果短剧|黄果AI|黄果影视).*$/i, "")
    .trim();
}

/* ref.id 形态：<videoid> 或 <videoid>:<ep>（分集点进来时带集号） */
function parseRef(raw) {
  var t = String(raw == null ? "" : raw).trim();
  // 形态 A：url:<分集页绝对地址>  —— 地址本身即锁定集数，最稳
  if (/^url:/i.test(t)) {
    var u = t.slice(4);
    var vm = u.match(/\/video\/(\d+)(?:\/ep-(\d+))?/i);
    if (vm) return { id: vm[1], ep: vm[2] ? parseInt(vm[2], 10) : 1, pageUrl: u };
    return { id: "", ep: 0 };
  }
  var m = t.match(/^(\d+)(?:\D+(\d+))?$/);
  if (!m) return { id: "", ep: 0 };
  return { id: m[1], ep: m[2] ? parseInt(m[2], 10) : 0 };
}

/* 播放集号：ref 后缀 → input.episode（对象或数字）→ 1
   官方契约里 input.episode 是 {season, episode} 对象，不是数字 */
// 记忆"上次播放到第几集"。注意：ctx.storage 只能在 search/detail/playback 里用，
// 官方 hongguo 样例同样如此；放进 widget.load 会原生崩溃（见 pitfalls #6）。
var HG_LAST_EP = {};
function rememberEp(seriesId, ep) {
  if (ep > 0) HG_LAST_EP[String(seriesId)] = ep;
}
function recallEp(seriesId) {
  var n = parseInt(HG_LAST_EP[String(seriesId)], 10);
  return n > 0 ? n : 0;
}


function explicitEpisode(ref, input) {
  var fromRef = parseRef(ref && ref.id).ep;
  if (fromRef > 0) return fromRef;
  var e = input && input.episode;
  if (e && typeof e === "object") {
    var n = parseInt(e.episode, 10) || parseInt(e.number, 10) || parseInt(e.ep, 10);
    if (n > 0) return n;
    return 0;
  }
  var n2 = parseInt(e, 10);
  return n2 > 0 ? n2 : 0;
}

function episodeNumber(ref, input) {
  var fromRef = parseRef(ref && ref.id).ep;
  if (fromRef > 0) return fromRef;
  var e = input && input.episode;
  if (e && typeof e === "object") {
    var n = parseInt(e.episode, 10);
    if (n > 0) return n;
    var n2 = parseInt(e.number, 10) || parseInt(e.ep, 10);
    if (n2 > 0) return n2;
  }
  if (typeof e === "number" && e > 0) return e;
  if (typeof e === "string") {
    var n3 = parseInt(e, 10);
    if (n3 > 0) return n3;
  }
  return 1;
}

function pageNumber(page) {
  if (page && page.type === "page" && typeof page.page === "number" && page.page >= 1) {
    return Math.floor(page.page);
  }
  if (typeof page === "number" && page >= 1) {
    return Math.floor(page);
  }
  return 1;
}

function shorten(text, n) {
  if (!text) return undefined;
  var t = String(text).replace(/\r/g, "").trim();
  if (!t) return undefined;
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/* ---------- 数据模型转换 ---------- */

function toListItem(ctx, item) {
  if (!item || !item.id) return null;
  var id = String(item.id);
  var title = cleanTitle(item.title);
  if (!title) title = "未命名短剧";

  var ref = {
    source: "custom",
    id: id,
    mediaType: "tv",
  };

  var res = {
    ref: ref,
    title: title,
  };

  // 描述
  var desc = shorten(item.description, 120);
  if (desc) res.description = desc;

  // 评分 (score)
  if (typeof item.score === "number" && item.score > 0) {
    res.rating = Math.round(item.score * 10) / 10;
  }

  // 标签/类型
  if (Array.isArray(item.tags) && item.tags.length > 0) {
    res.genre = item.tags.slice(0, 3).join(" · ");
  }

  // 副标题：显示集数或更新状态
  var epCount = item.episode_count || item.total_episodes;
  if (epCount && epCount > 0) {
    res.subtitle = (item.is_finished ? "全 " : "更新至 ") + epCount + " 集";
  }

  // 封面 (经解密中转)
  var c = wrapCover(ctx, item.cover);
  if (c) {
    res.images = {
      poster: c,
      backdrop: c,
      cover: c,
    };
  }

  return res;
}

/* ---------- 黄果官网栏目 HTML 解析 ---------- */

var HG_PAGE_TTL_MS = 15 * 60 * 1000;
var hgPageCache = {};

async function getSiteHtml(ctx, path) {
  var base = getApiBase(ctx);
  var key = base + path;
  var now = Date.now();
  var cached = hgPageCache[key];
  if (cached && now - cached.at < HG_PAGE_TTL_MS) return cached.html;
  var res = await ctx.http.get(key, {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      Accept: "text/html",
      Referer: base + "/",
    },
    timeoutMs: 15000,
    cacheTtlSeconds: 900,
  });
  if (!res || res.status < 200 || res.status >= 300) {
    fail("unavailable", "黄果栏目页面请求失败 (HTTP " + (res ? res.status : 0) + ")", true);
  }
  var html = String(res.data || "");
  if (!html) fail("unavailable", "黄果栏目页面为空", true);
  hgPageCache[key] = { at: now, html: html };
  return html;
}

function decodeHtmlText(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}

function htmlText(s) {
  return decodeHtmlText(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function sectionHtml(html, title) {
  var marker = "<h2>" + title + "</h2>";
  var pos = html.indexOf(marker);
  if (pos < 0) return "";
  var start = html.lastIndexOf('<section class="hg-section"', pos);
  var end = html.indexOf("</section>", pos);
  return start >= 0 && end >= 0 ? html.slice(start, end + 10) : "";
}

function parseDramaCards(ctx, html) {
  var cards = [], re = /<div class="hg-drama-card"([^>]*)>([\s\S]*?)(?=<div class="hg-drama-card"|$)/g, m;
  while ((m = re.exec(html))) {
    var id = (m[1].match(/data-track-item-id="(\d+)"/) || [])[1];
    var title = (m[1].match(/data-track-item-name="([^"]*)"/) || [])[1];
    if (!id) continue;
    if (!title) title = (m[2].match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    var img = (m[2].match(/<img[^>]*data-src="([^"]+)"/) || m[2].match(/<img[^>]*src="([^"]+)"/) || [])[1];
    var score = (m[2].match(/hg-drama-card__score[^>]*>\s*([0-9.]+)/) || [])[1];
    var tagsBlock = (m[2].match(/hg-drama-card__tags[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "";
    var tags = tagsBlock.match(/<span[^>]*>([\s\S]*?)<\/span>/g) || [];
    var item = { id: id, title: htmlText(title), cover: decodeHtmlText(img || "") };
    if (score) item.score = parseFloat(score);
    if (tags.length) {
      item.tags = tags.map(htmlText)
        .map(function (t) { return t.replace(/^[·\s]+|[\s·]+$/g, ""); })
        .filter(Boolean).slice(0, 3);
    }
    var li = toListItem(ctx, item);
    if (li) cards.push(li);
  }
  return cards;
}

function parseHotRank(ctx, html) {
  var items = [], re = /<div class="hg-rank-item"[^>]*data-track-id="(\d+)"[^>]*>([\s\S]*?)(?=<div class="hg-rank-item"|$)/g, m;
  while ((m = re.exec(html))) {
    var body = m[2], id = m[1];
    var title = (body.match(/hg-rank-item__title[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    var img = (body.match(/hg-rank-item__cover[^>]*>[\s\S]*?<img[^>]*data-src="([^"]+)"/) || body.match(/hg-rank-item__cover[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/) || [])[1];
    var score = (body.match(/([0-9.]+)分/) || [])[1];
    var heat = (body.match(/hg-rank-metric-value[^>]*>\s*(\d+)/) || [])[1];
    var tagsBlock = (body.match(/hg-rank-item__tags[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "";
    var tags = tagsBlock.match(/<span[^>]*>([\s\S]*?)<\/span>/g) || [];
    var item = { id: id, title: htmlText(title), cover: decodeHtmlText(img || "") };
    if (score) item.score = parseFloat(score);
    if (tags.length) {
      item.tags = tags.map(htmlText)
        .map(function (t) { return t.replace(/^[·\s]+|[\s·]+$/g, ""); })
        .filter(Boolean).slice(0, 3);
    }
    var li = toListItem(ctx, item);
    if (li) { li.subtitle = heat ? "热力指数 " + heat : "热播榜"; items.push(li); }
  }
  return items;
}

async function loadHomeSection(ctx, title) {
  var html = await getSiteHtml(ctx, "/");
  var section = sectionHtml(html, title);
  if (!section) fail("unavailable", "黄果首页未找到栏目：" + title, true);
  return { items: parseDramaCards(ctx, section) };
}

async function loadHotRank(ctx) {
  var html = await getSiteHtml(ctx, "/ranks/hot/");
  var items = parseHotRank(ctx, html);
  if (!items.length) fail("unavailable", "黄果热播排行榜页面未解析到条目", true);
  return { items: items };
}

/* 专题推荐：首页专题卡片 → 各专题页内的短剧 */
function parseTopicCards(html) {
  var section = sectionHtml(html, "专题推荐");
  var out = [], re = /<a class="hg-topic-card" href="(\/topics\/[a-z0-9-]+\/)"[\s\S]*?<h3 class="hg-topic-card__title">([\s\S]*?)<\/h3>/g, m;
  while ((m = re.exec(section))) {
    out.push({ slug: m[1], title: htmlText(m[2]) });
  }
  return out;
}

function topicMainCards(html) {
  var start = html.indexOf('<div class="hg-card-grid"');
  if (start < 0) return "";
  var end = html.length;
  var e1 = html.indexOf("hg-topic-related", start);
  var e2 = html.indexOf("hg-search-suggest", start);
  if (e1 > 0) end = Math.min(end, e1);
  if (e2 > 0) end = Math.min(end, e2);
  return html.slice(start, end);
}

async function loadTopics(ctx) {
  var html = await getSiteHtml(ctx, "/");
  var topics = parseTopicCards(html).slice(0, 6);
  var items = [], seen = {};
  /* 复用抖音1.5.0已真机验证的分组Promise.all+分项失败隔离；仅2路，不注入timer。 */
  for (var i = 0; i < topics.length; i += 2) {
    var batch = topics.slice(i, i + 2);
    var results = await Promise.all(batch.map(async function (t) {
      try {
        var thtml = await getSiteHtml(ctx, t.slug);
        return { topic: t, items: parseDramaCards(ctx, topicMainCards(thtml)) };
      } catch (e) { return { topic: t, items: [] }; }
    }));
    /* Promise.all保持原专题顺序；重复片仍由先出现专题决定副标题。 */
    for (var n = 0; n < results.length; n++) {
      var r = results[n];
      for (var j = 0; j < r.items.length; j++) {
        var card = r.items[j], cid = card.ref.id;
        if (seen[cid]) continue;
        seen[cid] = 1;
        card.subtitle = r.topic.title;
        items.push(card);
      }
    }
  }
  if (!items.length) fail("unavailable", "黄果专题页面未解析到条目", true);
  return { items: items };
}

/* 站方真排行榜，影片主键video_id而不是rank/id；不从其他栏目拼榜。 */
async function loadNamedRank(ctx, kind) {
  if (kind !== "recommend" && kind !== "potential") fail("invalid_params", "未知榜单", false);
  var json = await apiGet(ctx, "/api/ranks/" + kind, null, { cacheTtlSeconds: 900 });
  var data = json && json.data;
  if (!data || !Array.isArray(data.items) || (data.type && data.type !== kind)) {
    fail("unavailable", "黄果榜单返回结构无效", true);
  }
  var out = [], seen = {};
  for (var i = 0; i < data.items.length; i++) {
    var row = data.items[i] || {}, id = String(row.video_id || "");
    if (!/^[1-9]\d*$/.test(id) || seen[id]) continue;
    var item = toListItem(ctx, {
      id: id, title: row.title, cover: row.cover, score: row.score,
      tags: row.tags, episode_count: row.episode_count, is_finished: row.is_finished
    });
    if (!item) continue;
    seen[id] = true;
    var metric = row.metric_label && row.metric_value != null ? String(row.metric_label) + " " + String(row.metric_value) : "";
    if (metric) item.subtitle = (item.subtitle ? item.subtitle + " · " : "") + metric;
    out.push(item);
  }
  if (data.items.length && !out.length) fail("unavailable", "黄果榜单没有有效影片标识", true);
  return { items: out };
}

/* ---------- 上游 API 请求封装 ---------- */

async function apiGet(ctx, path, query, opts) {
  opts = opts || {};
  var base = getApiBase(ctx);
  var url = base + path;
  var res = await ctx.http.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      Accept: "application/json",
      Referer: base + "/",
    },
    query: query || undefined,
    timeoutMs: opts.timeoutMs || 15000,
    cacheTtlSeconds: opts.cacheTtlSeconds,
  });
  return check(res, opts.allow404);
}

// 抓取视频列表：最新、频道或排序
async function fetchVideoList(ctx, endpoint, query, page) {
  var p = pageNumber(page);
  var q = Object.assign({}, query || {}, { page: p });
  var json = await apiGet(ctx, endpoint, q, { cacheTtlSeconds: 900 });
  var data = (json && json.data) || {};
  var items = Array.isArray(data.items) ? data.items : [];
  var pagination = data.pagination || {};

  var listItems = [];
  for (var i = 0; i < items.length; i++) {
    var li = toListItem(ctx, items[i]);
    if (li) listItems.push(li);
  }

  var out = { items: listItems };
  var totalPages = pagination.pages || 1;
  if (p < totalPages && listItems.length > 0) {
    out.next = { type: "page", page: p + 1 };
  }
  return out;
}

/* ---------- 静态占位数据（防启动空白与离线 Picker） ---------- */

var PLACEHOLDER_ITEMS = [
  {
    ref: { source: "custom", id: "11228", mediaType: "tv" },
    title: "神豪外挂：开局失业，逆袭成神",
    subtitle: "全 5 集",
    genre: "大男主 · 系统 · 后宫",
    rating: 8.4,
  },
  {
    ref: { source: "custom", id: "12", mediaType: "tv" },
    title: "神瞳觉醒 第一季",
    subtitle: "全 21 集",
    genre: "超能力 · 都市 · 奇幻",
    rating: 9.6,
  },
  {
    ref: { source: "custom", id: "10374", mediaType: "tv" },
    title: "锁情咒",
    subtitle: "更新至 2 集",
    genre: "现代 · 情感",
    rating: 9.4,
  },
];

/* ---------- 扩展包导出 ---------- */

definePackage({
  id: "conflux.huangguo",
  title: "黄果短剧",
  description: "提供黄果 AI 短剧、漫剧、换脸与魔改视频浏览、搜索、选集与全集流畅播放",
  author: "Conflux Community",
  site: "https://huangguoai.com",
  icon: "https://huangguoai.com/apple-touch-icon.png",
  version: VERSION,
  engine: 1,

  permissions: {
    network: [
      "https://huangguoai.com",
      "https://hgpic.113210833.xyz",
      "https://",
      "http://",
    ],
  },

  settings: [
    {
      name: "coverProxy",
      title: "封面解密代理",
      type: "text",
      default: DEFAULT_COVER_PROXY,
      description: "黄果短剧封面使用 AES 加密，需通过解密服务输出有效 JPEG 图像",
    },
    {
      name: "apiBase",
      title: "站点 API 主机",
      type: "text",
      default: DEFAULT_API_BASE,
      description: "主站域名（如遇到域名更换可在此自定义）",
    },
  ],

  extensions: [
    /* 小组件：诊断（把 /api/videos 的真实返回摊在卡片上，排查完可删） */

    /* 1. 小组件：最近上新（backdrop-rail 横向大图） */
    {
      type: "widget",
      id: "newest",
      title: "最近上新",
      description: "黄果首页最近上新栏目，横向大图滑动。",
      template: "backdrop-rail",
      families: ["extraLarge"],
      header: "list",
      ref: { source: "custom", id: "list:newest" },
      cache: { ttlSeconds: 900 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return loadHomeSection(ctx, "最近上新");
      },
    },

    /* 2. 小组件：热门短剧榜单 */
    {
      type: "widget",
      id: "hot",
      title: "热播排行榜",
      description: "黄果官网热播排行榜 TOP20",
      template: "poster-ranked",
      families: ["medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:hot" },
      cache: { ttlSeconds: 1800 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return loadHotRank(ctx);
      },
    },

    /* 增量入口：站方两个真榜单及全库分页；旧八组件ID/ref不变。 */
    {
      type: "widget",
      id: "rank-recommend",
      title: "推荐榜",
      description: "黄果官网推荐榜，按站方推荐顺序展示。",
      template: "ranked-rail",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "list:rank:recommend" },
      cache: { ttlSeconds: 900 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) { return loadNamedRank(ctx, "recommend"); },
    },
    {
      type: "widget",
      id: "rank-potential",
      title: "潜力榜",
      description: "黄果官网潜力榜，按站方潜力顺序展示。",
      template: "poster-rail",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "list:rank:potential" },
      cache: { ttlSeconds: 900 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) { return loadNamedRank(ctx, "potential"); },
    },
    {
      type: "widget",
      id: "all-dramas",
      title: "全部短剧",
      description: "黄果全库分页浏览；保留最近上新原栏目，不把首页固定集合当全库。",
      template: "poster-grid",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "list:browse" },
      cache: { ttlSeconds: 900 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return fetchVideoList(ctx, "/api/videos", { sort: "latest" }, input && input.page);
      },
    },

    /* 2b. 黄果精选：横向分页大海报 */
    {
      type: "widget",
      id: "featured-pager",
      title: "黄果精选",
      description: "黄果首页焦点推荐，横向分页大海报。",
      template: "poster-pager",
      families: ["extraLarge"],
      cache: { ttlSeconds: 1800 },
      header: "list",
      ref: { source: "custom", id: "list:featured-pager" },
      placeholderData: { items: PLACEHOLDER_ITEMS.slice(0, 4) },
      load: async function (ctx, input) {
        return loadHomeSection(ctx, "精选推荐");
      },
    },

    /* 2c/2d 已删除：与「热播排行榜」「最近上新」数据完全重复，只保留一套 */

    /* 2e. 已删除「分类推荐」组件：与四个分类 widget 实测 75% 重合，属重复 */

    /* 2f. 专题推荐：各专题页内的短剧聚合 */
    {
      type: "widget",
      id: "topics",
      title: "专题推荐",
      description: "黄果首页专题推荐栏目，各专题（如精品高分AI短剧专辑）内的短剧。",
      template: "poster-grid",
      families: ["medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:topics" },
      cache: { ttlSeconds: 3600 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return loadTopics(ctx);
      },
    },

    /* 小组件：AI成人短剧（poster-grid 网格） */
    {
      type: "widget",
      id: "cat-ai-duanju",
      title: "AI成人短剧",
      description: "黄果分类 · AI成人短剧 最新上架（网格）",
      template: "poster-grid",
      families: ["medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:cat:ai-duanju" },
      cache: { ttlSeconds: 1800 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return fetchVideoList(ctx, "/api/videos/category/ai-duanju", { sort: "latest" }, input && input.page);
      },
    },

    /* 小组件：AI成人漫剧（统一网格风格） */
    {
      type: "widget",
      id: "cat-ai-manju",
      title: "AI成人漫剧",
      description: "黄果分类 · AI成人漫剧 最新上架",
      template: "poster-grid",
      families: ["medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:cat:ai-manju" },
      cache: { ttlSeconds: 1800 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return fetchVideoList(ctx, "/api/videos/category/ai-manju", { sort: "latest" }, input && input.page);
      },
    },

    /* 小组件：AI换脸（统一网格风格） */
    {
      type: "widget",
      id: "cat-ai-huanlian",
      title: "AI换脸",
      description: "黄果分类 · AI换脸 最新上架",
      template: "poster-grid",
      families: ["medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:cat:ai-huanlian" },
      cache: { ttlSeconds: 1800 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return fetchVideoList(ctx, "/api/videos/category/ai-huanlian", { sort: "latest" }, input && input.page);
      },
    },

    /* 小组件：AI魔改（统一网格风格） */
    {
      type: "widget",
      id: "cat-ai-mogai",
      title: "AI魔改",
      description: "黄果分类 · AI魔改 最新上架",
      template: "poster-grid",
      families: ["medium", "large"],
      header: "list",
      ref: { source: "custom", id: "list:cat:ai-mogai" },
      cache: { ttlSeconds: 1800 },
      placeholderData: { items: PLACEHOLDER_ITEMS },
      load: async function (ctx, input) {
        return fetchVideoList(ctx, "/api/videos/category/ai-mogai", { sort: "latest" }, input && input.page);
      },
    },

    /* 4. 搜索扩展 */
    {
      type: "search",
      id: "search",
      title: "黄果短剧搜索",
      search: async function (ctx, input) {
        var q = ((input && input.query) || "").trim();
        if (!q) return { items: [] };
        var p = pageNumber(input && input.page);
        var json = await apiGet(ctx, "/api/search", { q: q, page: p });
        var data = (json && json.data) || {};
        var items = Array.isArray(data.items) ? data.items : [];
        var pagination = data.pagination || {};

        var listItems = [];
        for (var i = 0; i < items.length; i++) {
          var li = toListItem(ctx, items[i]);
          if (li) listItems.push(li);
        }

        var out = { items: listItems };
        var totalPages = pagination.pages || 1;
        if (p < totalPages && listItems.length > 0) {
          out.next = { type: "page", page: p + 1 };
        }
        return out;
      },
    },

    /* 5. 全屏列表扩展（支持 widget 头部跳转与分页） */
    {
      type: "list",
      id: "list",
      title: "短剧列表",
      style: "grid",
      accepts: { sources: ["custom"] },
      search: { id: "search" },
      load: async function (ctx, input) {
        var id = (input && input.ref && input.ref.id) || "list:newest";
        var page = input && input.page;
        var p = page && typeof page.page === "number" ? page.page : 1;
        var token = { type: "page", page: p };

        var res;
        if (id === "list:hot-rail" || id === "list:hot") {
          // list:hot-rail 为旧版组件遗留 ref，与 list:hot 同源，兼容保留
          return loadHotRank(ctx);
        }
        if (id === "list:featured-pager") return loadHomeSection(ctx, "精选推荐");
        if (id === "list:latest-rail") return loadHomeSection(ctx, "最近上新");
        if (id === "list:newest") return loadHomeSection(ctx, "最近上新");
        if (id === "list:cat-rec") {
          // 旧 ref 兼容：该组件已删，改跳首页精选推荐
          return loadHomeSection(ctx, "精选推荐");
        }
        if (id === "list:topics") return loadTopics(ctx);
        if (id === "list:rank:recommend") return loadNamedRank(ctx, "recommend");
        if (id === "list:rank:potential") return loadNamedRank(ctx, "potential");
        if (id === "list:debug" || id === "list:browse") {
          res = await fetchVideoList(ctx, "/api/videos", { sort: "latest" }, token);
        } else if (id.indexOf("list:cat:") === 0) {
          var channel = encodeURIComponent(id.slice("list:cat:".length));
          res = await fetchVideoList(ctx, "/api/videos/category/" + channel, { sort: "latest" }, token);
        } else {
          // 默认按最新上架浏览
          res = await fetchVideoList(ctx, "/api/videos", { sort: "latest" }, token);
        }

        var out = { items: res.items };
        if (res.next && res.next.page) {
          out.next = { page: res.next.page };
        }
        return out;
      },
    },

    /* 6. 详情扩展 */
    {
      type: "detail",
      id: "detail",
      title: "短剧详情",
      accepts: { sources: ["custom"] },
      cache: { ttlSeconds: 1800 },
      load: async function (ctx, input) {
        var ref = input && input.ref;
        if (!ref || !ref.id) return null;
        var id = parseRef(ref.id).id;
        if (!id) return null;

        var json = await apiGet(ctx, "/api/videos/" + id, null, { allow404: true });
        if (!json || !json.data) return null;
        var d = json.data;

        var title = cleanTitle(d.title) || "黄果短剧";
        var cover = wrapCover(ctx, d.cover);

        var detail = {
          ref: { source: "custom", id: id, mediaType: "tv" },
          title: title,
        };

        if (d.description) {
          detail.description = String(d.description).replace(/\r/g, "").trim();
        }

        if (typeof d.score === "number" && d.score > 0) {
          detail.rating = Math.round(d.score * 10) / 10;
        }

        if (d.created_at) {
          detail.releaseDate = String(d.created_at).split(" ")[0];
        }

        if (cover) {
          detail.images = {
            poster: cover,
            detailPoster: cover,
            backdrop: cover,
            cover: cover,
            stills: [cover],
          };
        }

        // 标签
        if (Array.isArray(d.tags) && d.tags.length > 0) {
          detail.genre = d.tags.slice(0, 3).join(" · ");
          detail.genres = d.tags.map(function (tag) {
            return { id: tag, title: tag };
          });
        }

        // 构建分集列表
        var eps = Array.isArray(d.episodes) ? d.episodes : [];
        if (cover) {
          var stills = [];
          var totalCount = eps.length > 0 ? eps.length : 1;
          for (var si = 0; si < totalCount; si++) {
            stills.push(cover);
          }
          if (!detail.images) detail.images = {};
          detail.images.stills = stills;
        }

        if (eps.length > 0) {
          detail.episodes = eps.map(function (ep) {
            var num = typeof ep.ep_num === "number" ? ep.ep_num : parseInt(ep.ep_num, 10) || 1;
            var epTitle = (ep.title || "").trim();
            if (!epTitle || epTitle.indexOf("第") !== 0) {
              epTitle = "第 " + num + " 集" + (epTitle ? " · " + epTitle : "");
            }
            var epItem = {
              season: 1,
              episode: num,
              title: epTitle,
              ref: {
                source: "custom",
                id: "url:" + getApiBase(ctx) + "/video/" + id + (num > 1 ? "/ep-" + num + "/" : "/"),
                mediaType: "movie",
              },
            };
            if (cover) {
              epItem.image = cover;
              epItem.still = cover;
              epItem.cover = cover;
              epItem.poster = cover;
              epItem.backdrop = cover;
              epItem.images = {
                still: cover,
                poster: cover,
                cover: cover,
                backdrop: cover,
              };
            }
            return epItem;
          });

          // 设置第一集单集时长 (秒)
          var firstDur = parseInt(eps[0].duration, 10);
          if (firstDur > 0) {
            detail.runtimeSeconds = firstDur;
          }
        } else {
          // 兜底至少有一集可供播放
          var singleEp = {
            season: 1,
            episode: 1,
            title: "正片",
            ref: { source: "custom", id: id, mediaType: "tv" },
          };
          if (cover) {
            singleEp.image = cover;
            singleEp.still = cover;
            singleEp.cover = cover;
            singleEp.poster = cover;
            singleEp.backdrop = cover;
            singleEp.images = {
              still: cover,
              poster: cover,
              cover: cover,
              backdrop: cover,
            };
          }
          detail.episodes = [singleEp];
        }

        return detail;
      },
    },

    /* 7. 播放线路扩展 */
    {
      type: "playback",
      id: "playback",
      title: "短剧播放",
      accepts: { sources: ["custom"] },
      cache: { ttlSeconds: 0 },
      sources: async function (ctx, input) {
        var ref = input && input.ref;
        if (!ref || !ref.id) return [];
        var pref = parseRef(ref.id);
        var id = pref.id;
        if (!id) return [];

        var epNum = explicitEpisode(ref, input);
        var fromMemory = false;
        if (pref.pageUrl) {
          // ref 自带分集页地址：集数已被地址锁定，不参与记忆覆盖
          epNum = pref.ep > 0 ? pref.ep : 1;
          rememberEp(id, epNum);
        } else if (epNum > 1) {
          rememberEp(id, epNum);
        } else {
          // App 打开播放器时常显式传 episode=1（默认起播集）；
          // 若刚选过其它集，则以刚选的为准，否则永远播第 1 集。
          var memo = recallEp(id);   // 纯模块级，不调用 ctx.storage
          if (memo > 1 && (epNum <= 0 || memo !== epNum)) {
            epNum = memo;
            fromMemory = true;
            if (explicitEpisode(ref, input) > 0) fromMemory = true;
          } else if (epNum <= 0) {
            epNum = memo > 0 ? memo : 1;
            fromMemory = memo > 0;
          }
        }

        var freshLines = await currentPlayback(ctx, getApiBase(ctx), id, epNum);
        if (freshLines) return freshLines;

        // 先拿接口数据：既用于第1集兜底，也提供该集的标准时长（用于校验页面候选）
        var json = await apiGet(ctx, "/api/videos/" + id, {}, { allow404: true });
        var data = (json && json.data) || null;
        var expected = 0;
        if (data && Array.isArray(data.episodes)) {
          for (var ei = 0; ei < data.episodes.length; ei++) {
            if (parseInt(data.episodes[ei].ep_num, 10) === epNum) {
              expected = parseInt(data.episodes[ei].duration, 10) || 0;
              break;
            }
          }
        }

        var picked = await playUrlByPage(ctx, id, epNum, expected, pref.pageUrl);
        var playUrl = picked.url;

        // 兜底：仅第 1 集用接口直链（接口不认 ?ep=，ep>1 兜底会播错集）
        if (!playUrl && epNum <= 1 && data) playUrl = pickEpisodeUrl(data, epNum);
        if (!playUrl) return [];

        var pathTail = "";
        try {
          var tail1 = String(playUrl).split("?")[0].split("/");
          pathTail = tail1[tail1.length - 1].slice(-10);
        } catch (e) { pathTail = ""; }

        var probe = await probePlayable(ctx, playUrl);
        var simplified = false;
        if (probe.ok) {
          var simple = await simplifyUrl(ctx, playUrl, probe.headers);
          if (simple.simplified) { playUrl = simple.url; simplified = true; }
        }
        var cmp = probe.ok
          ? ("取流OK·" + probe.label)
          : ("取流失败" + (probe.label || "") + "·" + probe.tried.join(","));
        if (expected > 0) {
          cmp += "·" + (Math.abs((probe.seconds || 0) - expected) <= 8 ? "时长对上" : "标称" + expected + "实测" + (probe.seconds || 0));
        }
        if (simplified) cmp += "·已去查询串";
        // 诊断：把收到的入参编进线路名（确认 App 实际传了什么）
        var rawRef = String((input && input.ref && input.ref.id) || "-");
        if (/^url:/i.test(rawRef)) {
          var mm3 = rawRef.match(/\/video\/\d+(\/ep-\d+\/|\/)$/);
          rawRef = "url…" + (mm3 ? mm3[1] : "?");
        }
        var rawEp = input && input.episode;
        var epTxt = "-";
        if (typeof rawEp === "number") epTxt = "n" + rawEp;
        else if (rawEp && typeof rawEp === "object") epTxt = "o" + (rawEp.episode === undefined ? "?" : rawEp.episode);
        else if (rawEp !== undefined) epTxt = String(rawEp);
        var epLabel = "第" + epNum + "集·r" + rawRef + "·e" + epTxt
          + (fromMemory ? "·记忆" : "");
        // 正式版：只用直连。实测该站点对手机直连完全放行（清单与分片均 200 真数据），
        // 而 Cloudflare 机房 IP 被 EdgeOne 拉黑（upstream 403），中继反而会 5XX。
        var list = [
          {
            id: "line-play-ep" + epNum,
            name: "第" + epNum + "集 · " + pathTail,
            description: "黄果短剧 · 高清 · 1080P",
            url: playUrl,
            headers: probe.headers,
            player: "system",
          },
        ];
        return list;
      },
    },
  ],
});
