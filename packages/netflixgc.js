// 奈飞工厂（netflixgc.com）Conflux Extension
//
// 站点结构（MacCMS / dsn2 主题）：
// - 首页板块是静态 HTML，卡片为 <a class="public-list-exp" href="/voddetail/{id}.html">
//   （title 属性 + 内嵌 img 的 data-src 海报）；搜索页 /vodsearch/-------------.html?wd= 同样是静态结果
// - 注意：/vodshow 分类页的网格由 JS 加载，纯 HTTP 抓不到，因此本包的浏览 = 首页板块 + 全量片库接口 + 搜索
// - 详情页：源标签是 swiper-slide（蓝光-4 / 1080P-3 等，带集数角标），
//   每源一个 anthology-list-box，内含 /vodplay/{id}-{sid}-{nid}.html 选集；
//   影片参数抽屉（info-parameter）里有结构化 li 字段（主演/导演/年份/地区/类型/状态/简介），
//   正文简介另见 div#height_limit，站方评分见 div.fraction
// - 播放页 player_aaaa={...}，url 按 encrypt 解码：2 = base64 + 百分号解码
// - 片库接口 POST /index.php/ds_api/vod?type=&page=（参数放查询串，body 丢失时站点会退回默认分类）
// - 搜索建议 GET /index.php/ajax/suggest?mid=1&wd=&limit=（中文/拼音前缀匹配）
//
// 条目 ref.source 统一 "custom"：详情 ref.id 是 /voddetail/{id}.html，
// 每集 ref.id 是 /vodplay/{id}-{sid}-{nid}.html，playback 两种都认。
//
// v1.2.0 变更（用户真机反馈：演职人员没封面）：
// - 站点详情页不提供演员照片（角色区恒空，实证）。新增豆瓣 rexxar 公开接口按片名+年份匹配条目，
//   取 celebrities 头像按姓名补到 people.avatar；失败静默跳过不影响详情；结果缓存 1 小时。
//   新增权限 m.douban.com；requestRules 给 *.doubanio.com 带 Referer（无 Referer 418）。
//
// v1.1.1 变更（用户真机反馈修复）：
// - 电影不再输出 episodes[]（旧版电影被 App 渲染成「第1季/Episode 1」剧集 UI；官方 ddys/bangumi 契约：仅 tv 带分集）
// - fetchHTML 兼容站点偶发的 JSON 字符串包裹页（content-type: application/json 的 CF 缓存变体）
// - 标题类型判定改取末段下划线（片名含下划线时不再误判）
//
// v1.1.0 变更（实证回放后修复）：
// - 详情简介/类型/主演改用结构化抽取（旧 metaField 120 字符上限 + 关键词误命中导致恒空）
// - 详情新增站方评分 rating、更新状态拼入 subtitle、海报优先 detail-pic
// - 片库条目 mediaType 按分类映射（旧版全部硬编码 movie）
// - 搜索支持分页（?page=N + mac-total 判终页）
// - 搜索 ASCII≥11 字符触发站点丢弃关键词返回全库的 BUG：检测回退签名后改走 suggest 接口兜底
// - 跳过 NBY（蓝光-1）线路：其分片为 PNG 头包装 TS，原生播放器不可解，且解析直链单次有效
// - widget header 别名升级为 headerIntent

var BASE_URL = "https://www.netflixgc.com";
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
var REQUEST_TIMEOUT_MS = 20000;
var MAX_CARD_ITEMS = 60;
var SEARCH_PAGE_SIZE = 10;

var BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

// ========== 文本与 URL 工具 ==========

var HTML_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…",
  mdash: "—", ndash: "–", middot: "·",
};

function trim(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/^\s+|\s+$/g, "");
}

function decodeEntities(value) {
  if (!value) return "";
  return String(value).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, function (match, name) {
    if (name.charAt(0) === "#") {
      var code = name.charAt(1) === "x" || name.charAt(1) === "X"
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      if (isNaN(code) || code <= 0) return match;
      try { return String.fromCharCode(code); } catch (error) { return match; }
    }
    var entity = HTML_ENTITIES[name.toLowerCase()];
    return entity === undefined ? match : entity;
  });
}

function stripTags(value) {
  if (!value) return "";
  var text = String(value)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|span|a)>/gi, " ")
    .replace(/<[^>]*>/g, "");
  text = decodeEntities(text);
  return trim(text.replace(/\s+/g, " "));
}

function truncate(value, limit) {
  var text = trim(value);
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}

function attr(tag, name) {
  var m = new RegExp(name + '="([^"]*)"').exec(tag);
  return m ? decodeEntities(m[1]) : "";
}

function resolveURL(value) {
  var url = trim(value);
  if (!url) return "";
  if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.indexOf("/") === 0) return BASE_URL + url;
  return BASE_URL + "/" + url;
}

// 站点大量封面走 image.baidu.com 的跳转代理；App 图片管线对跨域跳转不稳定，
// 直接取出内部真实地址。
function unwrapBaiduImage(value) {
  var url = trim(value);
  if (!/image\.baidu\.com\/search\/down/i.test(url)) return url;
  var m = /[?&]url=([^&]+)/.exec(url);
  if (!m) return url;
  var inner = m[1];
  try { inner = decodeURIComponent(inner); } catch (error) { /* 保留原值 */ }
  return /^https?:\/\//i.test(inner) ? inner : url;
}

function imageURL(value, width) {
  var url = unwrapBaiduImage(resolveURL(value));
  // Conflux 图片管线对 WebP 支持不稳定（可可影视同款问题）；转成 JPEG 再交给 App。
  if (/\.webp(?:$|[?#])/i.test(url)) {
    return "https://wsrv.nl/?url=" + encodeURIComponent(url) +
      "&output=jpg&w=" + (width || 360) + "&q=75";
  }
  return url;
}

// 纯 JS base64 解码（运行时不保证有 atob）
function base64Decode(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var str = String(input).replace(/[^A-Za-z0-9+/=]/g, "");
  var output = "";
  var i = 0;
  while (i < str.length) {
    var e1 = chars.indexOf(str.charAt(i++));
    var e2 = chars.indexOf(str.charAt(i++));
    var e3 = chars.indexOf(str.charAt(i++));
    var e4 = chars.indexOf(str.charAt(i++));
    if (e1 < 0 || e2 < 0) break;
    output += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 >= 0 && str.charAt(i - 2) !== "=") {
      output += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    }
    if (e4 >= 0 && str.charAt(i - 1) !== "=") {
      output += String.fromCharCode(((e3 & 3) << 6) | e4);
    }
  }
  return output;
}

function percentDecode(value) {
  var text = String(value);
  try { return decodeURIComponent(text); } catch (error) {
    try { return unescape(text); } catch (e2) { return text; }
  }
}

// MacCMS 播放地址解码：encrypt 0 明文 / 1 百分号 / 2 base64+百分号
function decodePlayURL(raw, encrypt) {
  var url = trim(raw);
  if (!url) return "";
  if (url.indexOf("$") !== -1) {
    var parts = url.split("$");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf("http") === 0 || parts[i].indexOf("%") !== -1 || parts[i].indexOf("aHR") === 0) {
        url = parts[i];
        break;
      }
    }
  }
  if (encrypt === 2 || (encrypt !== 1 && url.indexOf("http") !== 0 && /^[A-Za-z0-9+/=]{24,}$/.test(url))) {
    var decoded = base64Decode(url);
    if (decoded) url = percentDecode(decoded);
  } else if (encrypt === 1) {
    url = percentDecode(url);
  } else if (url.indexOf("http") !== 0 && url.indexOf("%") !== -1) {
    url = percentDecode(url);
  }
  return trim(url);
}

// ========== HTTP ==========

function describeError(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

async function fetchHTML(ctx, path, options) {
  var url = path.indexOf("http") === 0 ? path : BASE_URL + path;
  var config = { headers: BROWSER_HEADERS, timeoutMs: REQUEST_TIMEOUT_MS };
  if (options && options.query) config.query = options.query;
  var response;
  try {
    response = await ctx.http.get(url, config);
  } catch (error) {
    throw ExtensionError({ code: "unavailable", message: "无法访问奈飞工厂：" + describeError(error), retryable: true });
  }
  var status = response && typeof response.status === "number" ? response.status : 0;
  if (status !== 200) {
    throw ExtensionError({
      code: status === 404 ? "not_found" : "unavailable",
      message: "奈飞工厂返回异常状态（HTTP " + status + "）。",
      retryable: status !== 404,
    });
  }
  var text = response && typeof response.data === "string" ? response.data : "";
  if (!text) {
    throw ExtensionError({ code: "unavailable", message: "奈飞工厂返回了空页面。", retryable: true });
  }
  // 站点偶发把整页 HTML 当 JSON 字符串返回（content-type: application/json，CF 缓存变体，实证 /voddetail/153847）。
  // 运行时若已按 JSON 解析则 data 直接是 HTML 字符串；若给原始文本则这里解包。两种形态都兼容。
  var trimmedText = trim(text);
  if (trimmedText.charAt(0) === "\"" && trimmedText.charAt(trimmedText.length - 1) === "\"") {
    try {
      var unwrapped = JSON.parse(trimmedText);
      if (typeof unwrapped === "string" && unwrapped.indexOf("<") >= 0) text = unwrapped;
    } catch (error) { /* 不是合法 JSON 字符串就按原文处理 */ }
  }
  return text;
}// ========== 卡片解析（首页 / 搜索共用） ==========

function parseCards(html) {
  var items = [];
  var seen = {};
  function addItem(id, title, poster, genre) {
    if (seen[id]) {
      var prev = seen[id];
      if (!prev.images.poster && poster) prev.images.poster = poster;
      if (!prev.subtitle && genre) prev.subtitle = genre;
      return;
    }
    if (!title && !poster) return;
    var item = {
      ref: { source: "custom", id: "/voddetail/" + id + ".html" },
      title: title || ("影片 " + id),
      images: {},
    };
    if (poster) item.images.poster = poster;
    if (genre) item.subtitle = genre;
    seen[id] = item;
    items.push(item);
  }
  // 第一遍：正式卡片 public-list-exp（海报在内嵌 img 的 data-src）
  var re = /<a\b[^>]*class="[^"]*public-list-exp[^"]*"[^>]*href="\/voddetail\/(\d+)\.html"[^>]*>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (items.length >= MAX_CARD_ITEMS) break;
    var closeIdx = html.indexOf("</a>", re.lastIndex);
    var inner = closeIdx > re.lastIndex ? html.slice(re.lastIndex, closeIdx) : "";
    var poster = "";
    var im = /<img[^>]*(?:data-src|data-original)="([^"]+)"/.exec(inner);
    if (im) poster = imageURL(im[1]);
    var genre = "";
    var gm = /public-prt[^>]*>([^<]*)</.exec(inner);
    if (gm) genre = trim(decodeEntities(gm[1]));
    addItem(m[1], attr(m[0], "title"), poster, genre);
  }
  // 第二遍：其它带 title/data-src 的详情锚点（首页轮播等）补漏
  var re2 = /<a\b[^>]*href="\/voddetail\/(\d+)\.html"[^>]*>/g;
  while ((m = re2.exec(html)) !== null) {
    if (items.length >= MAX_CARD_ITEMS) break;
    if (seen[m[1]]) continue;
    var tag = m[0];
    var title2 = attr(tag, "title");
    var poster2 = attr(tag, "data-original") || attr(tag, "data-src");
    if (!poster2) {
      var close2 = html.indexOf("</a>", re2.lastIndex);
      var inner2 = close2 > re2.lastIndex ? html.slice(re2.lastIndex, close2) : "";
      var im2 = /<img[^>]*(?:data-src|data-original)="([^"]+)"/.exec(inner2);
      if (im2) poster2 = im2[1];
    }
    addItem(m[1], title2, poster2 ? imageURL(poster2) : "", "");
  }
  // 第三遍：搜索结果式卡片（标题在 h3.slide-info-title，海报在锚点之前的 img）
  var re3 = /<a\b[^>]*href="\/voddetail\/(\d+)\.html"[^>]*>\s*<h3 class="slide-info-title[^"]*">([^<]*)<\/h3>/g;
  while ((m = re3.exec(html)) !== null) {
    if (items.length >= MAX_CARD_ITEMS) break;
    if (seen[m[1]]) continue;
    var back = html.slice(Math.max(0, m.index - 900), m.index);
    var bim = /<img[^>]*(?:data-src|data-original)="([^"]+)"[^>]*>/g;
    var bLast = null;
    var bx;
    while ((bx = bim.exec(back)) !== null) bLast = bx;
    var ahead = html.slice(re3.lastIndex, re3.lastIndex + 600);
    var rk = /slide-info-remarks[^>]*>([^<]*)</.exec(ahead);
    var item3 = {
      ref: { source: "custom", id: "/voddetail/" + m[1] + ".html" },
      title: trim(decodeEntities(m[2])),
      images: {},
    };
    if (bLast) item3.images.poster = imageURL(bLast[1]);
    if (rk) item3.subtitle = trim(decodeEntities(rk[1]));
    seen[m[1]] = item3;
    items.push(item3);
  }
  return items;
}

// ========== 详情解析 ==========

var DETAIL_RE = /^\/voddetail\/(\d+)\.html$/;
var PLAY_RE = /^\/vodplay\/(\d+)-(\d+)-(\d+)\.html$/;

// 影片参数抽屉里的结构化字段：<li><em class="cor4">标签：</em>值</li>
// 值可能含链接（主演/导演/类型），统一去标签后按分隔符切分。无长度上限。
function drawerField(html, label) {
  var re = new RegExp('<em class="cor4">' + label + '：</em>([\\s\\S]*?)</li>');
  var m = re.exec(html);
  if (!m) return "";
  return trim(stripTags(m[1]).replace(/^[：:]\s*/, ""));
}

// slide-info partition 区块里的链接列表（导演/演员/类型），比纯文本更干净
function partitionLinks(html, label) {
  var out = [];
  var re = /<div class="slide-info hide partition">([\s\S]*?)<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var seg = m[1];
    var lm = new RegExp('<strong[^>]*>\\s*' + label + '\\s*[:：]\\s*</strong>').exec(seg);
    if (!lm) continue;
    var linkRe = /target="_blank">([^<]*)<\/a>/g;
    var lx;
    while ((lx = linkRe.exec(seg)) !== null) {
      var name = trim(decodeEntities(lx[1]));
      if (name && out.indexOf(name) === -1) out.push(name);
    }
  }
  return out;
}

function splitNames(value) {
  return String(value || "").split(/[,\s，、]+/).map(trim).filter(function (s) { return s; });
}

// 源名（按页面顺序）与每源的集数表：{ names: [...], bySid: { sid: [{nid, path, title}] } }
// 注意：swiper 标签顺序与服务端 sid 顺序不一致（已实证），names 仅作兜底展示，
// 线路身份以播放页 player_aaaa.from 为准。
function parseSourcesAndEpisodes(html, vodId) {
  var names = [];
  var firstBox = html.indexOf("anthology-list-box");
  var headSeg = firstBox > 0 ? html.slice(0, firstBox) : html;
  var tabRe = /<a class="swiper-slide[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  var tm;
  while ((tm = tabRe.exec(headSeg)) !== null) {
    var raw = tm[1].replace(/<span class="badge">[\s\S]*?<\/span>/g, "");
    var name = stripTags(raw);
    if (name && name.length <= 16) names.push(name);
  }
  var bySid = {};
  var linkRe = new RegExp('<a[^>]*href="(/vodplay/' + vodId + '-(\\d+)-(\\d+)\\.html)"[^>]*>([\\s\\S]*?)</a>', "g");
  var lm;
  while ((lm = linkRe.exec(html)) !== null) {
    var sid = parseInt(lm[2], 10);
    var nid = parseInt(lm[3], 10);
    if (!bySid[sid]) bySid[sid] = [];
    var dup = false;
    for (var i = 0; i < bySid[sid].length; i++) {
      if (bySid[sid][i].nid === nid) { dup = true; break; }
    }
    if (dup) continue;
    bySid[sid].push({ nid: nid, path: lm[1], title: stripTags(lm[4]) || ("第" + nid + "集") });
  }
  // 源标签可能多于源数（页面里还有别的 swiper），取最靠近选集区的一组
  var sidCount = Object.keys(bySid).length;
  if (sidCount > 0 && names.length > sidCount) {
    names = names.slice(names.length - sidCount);
  }
  return { names: names, bySid: bySid };
}

function parseDetail(html, ref) {
  var idm = DETAIL_RE.exec(ref.id);
  var vodId = idm ? idm[1] : "";

  var title = "";
  var kind = "";
  var tm = /<title>([^<]*)<\/title>/.exec(html);
  if (tm) {
    var fullTitle = decodeEntities(tm[1]);
    // 标题格式「片名_类型 - 奈飞工厂…」；片名本身可能含下划线，取最后一个下划线到站点名之间的段作类型。
    var km = fullTitle.match(/_([^_]*?)\s*-\s*奈飞工厂/);
    if (km) {
      kind = trim(km[1]);
      title = trim(fullTitle.slice(0, fullTitle.indexOf(km[0])));
    } else {
      var tparts = fullTitle.split("_");
      title = trim(tparts[0]);
      if (tparts.length > 1) kind = trim(tparts[1].replace(/\s*-\s*奈飞工厂.*$/, ""));
    }
  }
  if (!title) title = drawerField(html, "片名") || ("影片 " + vodId);

  // 海报：优先详情主图 detail-pic 的 data-src（canonical），回退 upload/vod 正则
  var poster = "";
  var dp = html.indexOf("detail-pic");
  if (dp >= 0) {
    var dpSeg = html.slice(dp, dp + 1200);
    var dm = /<img[^>]*data-src="([^"]+)"/.exec(dpSeg);
    if (dm) poster = imageURL(dm[1], 720);
  }
  if (!poster) {
    var pm = /<img[^>]*(?:data-src|src)="(https?:\/\/[^"]*(?:upload\/vod|image\.baidu\.com)[^"]*)"/.exec(html);
    if (pm) poster = imageURL(decodeEntities(pm[1]), 720);
  }

  // 结构化字段（抽屉 li），主演/导演/类型另用 partition 链接块交叉补全
  var actors = partitionLinks(html, "演员");
  if (!actors.length) actors = splitNames(drawerField(html, "主演"));
  var directors = partitionLinks(html, "导演");
  if (!directors.length) directors = splitNames(drawerField(html, "导演"));
  var yearM = /年份：\s*(\d{4})/.exec(html);
  var year = yearM ? yearM[1] : (drawerField(html, "年份").match(/\d{4}/) || [""])[0];
  var area = drawerField(html, "地区");
  var status = drawerField(html, "状态");
  var genreNames = partitionLinks(html, "类型");
  if (!genreNames.length) genreNames = splitNames(drawerField(html, "类型"));

  // 简介：height_limit 是正文展开块（最可靠）→ 抽屉 li 简介 → meta description。
  // 不再用 text.indexOf('剧情介绍')：它会先命中相关作品卡的「暂无剧情介绍」。
  var overview = "";
  var hl = /id="height_limit"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  if (hl) overview = trim(stripTags(hl[1]));
  if (!overview) overview = drawerField(html, "简介");
  if (!overview) {
    var md = /<meta name="description" content="([^"]+)"/.exec(html);
    if (md) overview = trim(decodeEntities(md[1]).replace(/^[\s　]+/, ""));
  }
  // 站点有把别片的状态文字混进简介的情况：开头带更新状态的不是简介，宁缺毋滥
  if (overview && /^(更新至|更新第|已完结|HD中字|正片)/.test(overview.slice(0, 30))) {
    overview = "";
  }

  // 站方评分（0-10 制，与豆瓣/TMDB 样例同量纲）
  var rating;
  var fm = /class="fraction">([\d.]+)</.exec(html);
  if (fm) {
    var rv = parseFloat(fm[1]);
    if (isFinite(rv) && rv > 0 && rv <= 10) rating = Math.round(rv * 10) / 10;
  }

  var mediaType = kind === "电影" ? "movie" : "tv";
  var detail = {
    ref: { source: "custom", id: ref.id, mediaType: mediaType },
    title: title,
    images: {},
    overview: truncate(overview, 2000),
  };
  if (poster) { detail.images.poster = poster; detail.images.backdrop = poster; }
  var subParts = [];
  if (year) subParts.push(year);
  if (area) subParts.push(area);
  if (kind) subParts.push(kind);
  if (status && status !== "内详") subParts.push(status);
  if (subParts.length) detail.subtitle = subParts.join(" · ");
  if (year) detail.releaseDate = year;
  if (rating !== undefined) detail.rating = rating;
  if (genreNames.length) {
    detail.genres = genreNames.slice(0, 5).map(function (g) { return { id: g, title: g }; });
  }
  var people = [];
  actors.slice(0, 10).forEach(function (name) {
    people.push({ id: name, title: name, role: "主演" });
  });
  directors.slice(0, 5).forEach(function (name) {
    people.push({ id: name, title: name, role: "导演" });
  });
  if (people.length) detail.people = people;

  var parsed = parseSourcesAndEpisodes(html, vodId);
  var episodes = [];
  Object.keys(parsed.bySid).forEach(function (sidKey) {
    var sid = parseInt(sidKey, 10);
    parsed.bySid[sidKey].forEach(function (ep) {
      var item = {
        season: sid,
        episode: ep.nid,
        // 集名带上剧名：Conflux 只把集标题当作弹幕匹配的 fileName，
        // 光秃秃的「第N集」匹配不到弹幕，必须让标题自带剧名。
        title: title && ep.title.indexOf(title) !== 0 ? title + " " + ep.title : ep.title,
        ref: { source: "custom", id: ep.path },
      };
      // 站点不给分集剧照，用详情海报兜底，避免选集列表一片空白。
      if (poster) item.still = poster;
      episodes.push(item);
    });
  });
  episodes.sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
  // 官方样例契约（ddys/bangumi 实证）：只有 tv 才输出 episodes[]。
  // 电影带 episodes 会被 App 渲染成「第1季 / Episode 1」剧集 UI（用户真机实证 154952）。
  // 电影不输出分集，播放按钮直接走 playback.sources（detail ref 默认 sid1/nid1 枚举全部线路）。
  if (episodes.length && mediaType === "tv") detail.episodes = episodes;
  return detail;
}// ========== 播放页解析与线路 ==========

function parsePlayerData(html) {
  var idx = html.indexOf("player_aaaa");
  if (idx < 0) return null;
  var start = html.indexOf("{", idx);
  if (start < 0) return null;
  var depth = 0;
  var inStr = false;
  var esc = false;
  for (var i = start; i < html.length; i++) {
    var ch = html.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
    } else if (ch === "\"") {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch (error) { return null; }
      }
    }
  }
  return null;
}

// 站点线路标签以播放页 player_aaaa.from 为准（playerconfig.js 的 MacPlayerConfig.player_list，已逐条核对一致）；
// swiper 标签顺序与服务端 sid 顺序不一致，不能用标签下标猜线路名。
var SOURCE_LABELS = {
  "NBY": "蓝光-1",
  "ntflixzx": "蓝光-2",
  "bfzym3u8": "蓝光-3",
  "wsym3u8": "蓝光-4",
  "ffm3u8": "蓝光-5",
  "dm295": "蓝光-6",
  "anfun2": "蓝光-8",
  "1080zyk": "1080P-2",
  "lzm3u8": "1080P-3",
  "dyttm3u8": "1080P-4",
  "xiguam3u8": "蓝光-5（西瓜）",
  "zxskplayer": "独享4K-APP独享",
  "zxlgplayer": "独享蓝光-APP独享",
  "zb": "直播"
};

function sourceLabel(from, sid) {
  var key = trim(from);
  if (key && SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  return key ? key : ("线路 " + sid);
}

// NBY 线路的 player_aaaa.url 解码后是 "NBY-XMYAES…" 自定义串。
// 站点解析器（mizhi_json.php，要求 X-Requested-With）能换成 getM3u8 直链，但实测：
// ① 直链单次有效，第二次请求即返回「链接失效」页；
// ② 分片字节 = 104B PNG 头 + IEND 之后才是真 MPEG-TS（0x47 sync），原生播放器无法解 PNG 包装。
// 因此本包不再输出 NBY 线路（保留函数仅供诊断/未来宿主支持时启用）。
function isNBYRaw(raw) {
  return trim(raw).indexOf("NBY-") === 0;
}

async function resolveNBY(ctx, raw) {
  if (!ctx || !ctx.http || typeof ctx.http.post !== "function") return null;
  var endpoint = "https://mplayer.nfgc.net/admin/mizhi_json.php";
  var body = "url=" + encodeURIComponent(raw) + "&time=" + Math.floor(Date.now() / 1000) + "&key=&vkey=";
  var headers = {};
  Object.keys(BROWSER_HEADERS).forEach(function (k) { headers[k] = BROWSER_HEADERS[k]; });
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  headers["Accept"] = "application/json, text/javascript, */*; q=0.01";
  headers["X-Requested-With"] = "XMLHttpRequest";
  headers["Origin"] = "https://mplayer.nfgc.net";
  headers["Referer"] = "https://mplayer.nfgc.net/";
  var options = { headers: headers, timeoutMs: REQUEST_TIMEOUT_MS };
  var attempts = [
    function () { return ctx.http.post(endpoint, body, options); },
    function () { return ctx.http.post(endpoint, { body: body, headers: headers, timeoutMs: REQUEST_TIMEOUT_MS }); }
  ];
  for (var i = 0; i < attempts.length; i++) {
    var response;
    try { response = await attempts[i](); } catch (error) { continue; }
    var status = response && typeof response.status === "number" ? response.status : 0;
    if (status !== 200) continue;
    var data = response.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (parseError) { continue; }
    }
    if (!data || (String(data.code) !== "200" && String(data.success) !== "1")) continue;
    var direct = trim(data.url || data.json_url || "");
    if (direct.indexOf("http") !== 0) continue;
    return { url: direct, hls: !!data.is_hls || /\.m3u8(?:$|\?)/i.test(direct) };
  }
  return null;
}

// ---- 线路实测：只隐藏当场 403/404 的线路，并按真实分辨率重命名 ----
var DETAIL_CACHE = {};
var PROBE_CACHE = {};
var CACHE_TTL_MS = 5 * 60 * 1000;
var PROBE_HOSTS = {
  "pcdn-qn-new.samtory.cn": 1,
  "v.fengbao11.com": 1,
  "v13.wsyzym3u8.com": 1,
  "v14.wsyzym3u8.com": 1,
  "vod.ffzy-bofang.com": 1,
  "v.lfthirtytwo.com": 1,
  "play.phimgood.com": 1,
  "cdn.yzzyvip-29.com": 1,
  "v.lzcdn27.com": 1,
  "v.fengbao8.com": 1,
  "svip.feifei-play.com": 1,
  "vip.dytt-see.com": 1,
  "cdn.yzzy29-play.com": 1
};

function hostOf(url) {
  var m = /^https?:\/\/([^\/?#]+)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase().split(":")[0] : "";
}

// 单次有效的解析直链绝不能探测（探测会消耗掉唯一一次取流机会）
function isSingleUseURL(url) {
  return /nbyjson\.top|getM3u8/i.test(String(url || ""));
}

function qualityFromPlaylist(text) {
  var maxHeight = 0;
  var re = /RESOLUTION=(\d+)x(\d+)/gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    var h = parseInt(m[2], 10);
    if (h > maxHeight) maxHeight = h;
  }
  if (!maxHeight) return "";
  if (maxHeight >= 2000) return "4K";
  if (maxHeight >= 1000) return "1080P";
  if (maxHeight >= 700) return "720P";
  if (maxHeight >= 500) return "540P";
  return maxHeight + "P";
}

function qualityFromURL(url) {
  if (/[?&]currentQuality=SD(?:&|$)/i.test(url)) return "SD";
  if (/[?&]currentQuality=(?:HD|FHD)(?:&|$)/i.test(url)) return "HD";
  if (/[-_.](?:LD|SD)\.mp4(?:[?#]|$)/i.test(url)) return "SD";
  return "";
}

function qualityRank(q) {
  if (q === "4K") return 2160;
  if (q === "1080P") return 1080;
  if (q === "720P") return 720;
  if (q === "540P") return 540;
  if (q === "SD") return 480;
  if (q === "HD") return 720;
  return 0;
}

async function probeLine(ctx, source) {
  var fallback = { keep: true, quality: qualityFromURL(source.url) };
  // 探测只针对 HLS 清单；MP4 直链已在解析时确认，避免整文件下载。
  if (!/\.m3u8(?:[?#]|$)/i.test(source.url)) return fallback;
  // 单次有效直链（NBY getM3u8 等）不探测，否则播放器拿到的是失效页。
  if (isSingleUseURL(source.url)) return fallback;
  var probeHost = hostOf(source.url);
  var hideModeNow = !!(ctx && ctx.settings && ctx.settings.probeMode === "hide");
  var cachedProbe = PROBE_CACHE[probeHost];
  if (!hideModeNow && cachedProbe && Date.now() - cachedProbe.ts < CACHE_TTL_MS) {
    return { keep: cachedProbe.keep, quality: cachedProbe.quality, status: cachedProbe.status };
  }
  if (!PROBE_HOSTS[probeHost] || !ctx || !ctx.http || typeof ctx.http.get !== "function") return fallback;
  var headers = {};
  Object.keys(source.headers || {}).forEach(function (k) { headers[k] = source.headers[k]; });
  var rangeHeaders = {};
  Object.keys(headers).forEach(function (k) { rangeHeaders[k] = headers[k]; });
  rangeHeaders["Range"] = "bytes=0-2047";
  async function request(checkHeaders) {
    try { return await ctx.http.get(source.url, { headers: checkHeaders, timeoutMs: 4000 }); }
    catch (error) { return null; }
  }
  var response = await request(rangeHeaders);
  if (!response) return fallback; // 超时/网络错误不等于线路失效
  var status = response && typeof response.status === "number" ? response.status : 0;
  // 有些 CDN 对带 Range 的探测返回 403，去掉 Range 再确认一次，避免误杀。
  if (status === 403) {
    var retry = await request(headers);
    if (!retry) return fallback;
    response = retry;
    status = retry && typeof retry.status === "number" ? retry.status : 0;
  }
  if (status === 403 || status === 404 || status === 410) {
    PROBE_CACHE[probeHost] = { keep: false, quality: "", status: status, ts: Date.now() };
    return { keep: false, quality: "", status: status };
  }
  if (status !== 200 && status !== 206) return fallback;
  var text = response && typeof response.data === "string" ? response.data : "";
  if (/^\s*<(?:!doctype|html|pre)/i.test(text.slice(0, 200))) return { keep: false, quality: "" };
  var quality = "";
  if (text.indexOf("#EXTM3U") >= 0) {
    quality = qualityFromPlaylist(text);
  }
  if (!quality) quality = qualityFromURL(source.url);
  PROBE_CACHE[probeHost] = { keep: true, quality: quality, status: status, ts: Date.now() };
  return { keep: true, quality: quality, status: status };
}

async function playbackSources(ctx, input) {
  var ref = input && input.ref ? input.ref : null;
  if (!ref || !ref.id) {
    throw ExtensionError({ code: "invalid_params", message: "缺少条目地址", retryable: false });
  }
  var vodId = null;
  var sidWanted = 1;
  var nidWanted = 1;
  var pm = PLAY_RE.exec(ref.id);
  var dm = DETAIL_RE.exec(ref.id);
  if (pm) {
    vodId = pm[1];
    sidWanted = parseInt(pm[2], 10);
    nidWanted = parseInt(pm[3], 10);
  } else if (dm) {
    vodId = dm[1];
    if (typeof input.season === "number" && input.season > 0) sidWanted = input.season;
    if (typeof input.episode === "number" && input.episode > 0) nidWanted = input.episode;
  } else {
    throw ExtensionError({ code: "invalid_params", message: "无法识别的条目地址：" + ref.id, retryable: false });
  }

  // 从详情页枚举所有源在这一集上的播放页
  var targets = {};
  try {
    var cachedDetail = DETAIL_CACHE[vodId];
    var detailHTML;
    if (cachedDetail && Date.now() - cachedDetail.ts < CACHE_TTL_MS) {
      detailHTML = cachedDetail.html;
    } else {
      detailHTML = await fetchHTML(ctx, "/voddetail/" + vodId + ".html");
      DETAIL_CACHE[vodId] = { html: detailHTML, ts: Date.now() };
    }
    var parsed = parseSourcesAndEpisodes(detailHTML, vodId);
    Object.keys(parsed.bySid).forEach(function (sidKey) {
      var sid = parseInt(sidKey, 10);
      parsed.bySid[sidKey].forEach(function (ep) {
        if (ep.nid === nidWanted) targets[sid] = ep.path;
      });
    });
  } catch (error) {
    targets = {};
  }
  // 选集 ref 自带用户点的那条播放页；站点每次渲染会给线路重新分配 sid，
  // 不能拿重新抓的详情页覆盖它，否则用户点“蓝光-1”可能播到别的线路。
  if (pm) targets[sidWanted] = ref.id;
  if (!targets[sidWanted]) {
    targets[sidWanted] = "/vodplay/" + vodId + "-" + sidWanted + "-" + nidWanted + ".html";
  }

  var sids = Object.keys(targets).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
  var sources = [];
  var seenURL = {};
  // 各线路播放页并发抓取，避免多条线路串行等待。
  var fetched = await Promise.all(sids.map(function (sid) {
    return fetchHTML(ctx, targets[sid]).then(function (html) {
      return { sid: sid, path: targets[sid], html: html };
    }).catch(function () { return null; });
  }));
  for (var i = 0; i < fetched.length; i++) {
    if (!fetched[i]) continue;
    var sid = fetched[i].sid;
    var playPath = fetched[i].path;
    var playHTML = fetched[i].html;
    var data = parsePlayerData(playHTML);
    if (!data || !data.url) continue;
    var raw = decodePlayURL(data.url, typeof data.encrypt === "number" ? data.encrypt : 0);
    // NBY（蓝光-1）分片是 PNG 包装 TS 且直链单次有效，原生不可播，跳过。
    if (isNBYRaw(raw)) continue;
    var label = sourceLabel(data.from, sid);
    var url = raw;
    var headers = { "Referer": BASE_URL + playPath, "User-Agent": USER_AGENT };
    if (url.indexOf("http") !== 0) continue;
    if (seenURL[url]) continue;
    seenURL[url] = true;
    sources.push({
      id: "line-" + sid,
      name: label,
      url: url,
      headers: headers,
      player: /\.mp4(?:[?#]|$)/i.test(url) ? "system" : undefined,
      _rank: 0,
    });
  }
  if (sources.length) {
    var probes = await Promise.all(sources.map(function (s) { return probeLine(ctx, s); }));
    var hideMode = !!(ctx && ctx.settings && ctx.settings.probeMode === "hide");
    var keepMode = !hideMode;
    var kept = [];
    for (var k = 0; k < sources.length; k++) {
      var item = sources[k];
      if (!probes[k].keep && !keepMode) continue;
      if (probes[k].keep) {
        if (probes[k].quality) item.name = probes[k].quality + " · " + item.name;
        item._rank = qualityRank(probes[k].quality);
      } else {
        item.name = (probes[k].status || "不可用") + " · " + item.name;
        item._rank = -1;
      }
      delete item.player;
      if (/\.mp4(?:[?#]|$)/i.test(item.url)) item.player = "system";
      kept.push(item);
    }
    // 探测全部失败时保留原列表，避免临时网络波动把线路清空
    if (kept.length) {
      kept.sort(function (a, b) { return b._rank - a._rank; });
      kept.forEach(function (s) { delete s._rank; });
      sources = kept;
    } else {
      var allRejected = hideMode && probes.every(function (p) { return !p.keep; });
      sources.forEach(function (s) { delete s._rank; });
      if (allRejected) {
        throw ExtensionError({
          code: "unavailable",
          message: "该片所有线路都被源站拒绝（403/404），当前网络无法播放；请换网络或换片源。",
          retryable: true,
        });
      }
    }
  }
  return sources;
}// ========== 全量片库（分类接口） ==========

var LIB_TABS = [
  { id: "1", title: "电影" },
  { id: "2", title: "连续剧" },
  { id: "3", title: "漫剧" },
  { id: "23", title: "综艺" },
  { id: "24", title: "纪录片" }
];

// 分类 → mediaType（旧版全部硬编码 movie，连续剧/综艺/纪录片标错）
var TAB_MEDIA_TYPE = { "1": "movie", "2": "tv", "3": "tv", "23": "tv", "24": "tv" };

function stripTagsLite(value) {
  return trim(decodeEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " "));
}

function apiItem(row, mediaType) {
  var id = row && row.vod_id;
  if (!id) return null;
  var title = trim(row.vod_name);
  var item = {
    ref: { source: "custom", id: "/voddetail/" + id + ".html", mediaType: mediaType || "movie" },
    title: title || ("影片 " + id),
    images: {},
  };
  var poster = trim(row.vod_pic || row.vod_pic_thumb);
  if (poster) item.images.poster = imageURL(poster);
  var remark = stripTagsLite(row.vod_remarks);
  var tag = stripTagsLite(row.vod_tag);
  if (remark || tag) item.subtitle = [remark, tag].filter(function (s) { return s; }).join(" · ");
  var blurb = stripTagsLite(row.vod_blurb);
  if (blurb) item.overview = truncate(blurb, 160);
  var score = parseFloat(row.vod_douban_score);
  if (isFinite(score) && score > 0 && score <= 10) item.rating = Math.round(score * 10) / 10;
  return item;
}

var POST_SHAPE = 0; // 0 未定；1 三参；2 两参 options

async function postForm(ctx, path, body) {
  var url = path.indexOf("http") === 0 ? path : BASE_URL + path;
  var headers = {};
  Object.keys(BROWSER_HEADERS).forEach(function (k) { headers[k] = BROWSER_HEADERS[k]; });
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  headers["Accept"] = "application/json, text/javascript, */*; q=0.01";
  headers["X-Requested-With"] = "XMLHttpRequest";
  var options = { headers: headers, timeoutMs: REQUEST_TIMEOUT_MS };
  var attempts = POST_SHAPE === 2 ? [
    function () { return ctx.http.post(url, { body: body, headers: headers, timeoutMs: REQUEST_TIMEOUT_MS }); },
    function () { return ctx.http.post(url, body, options); }
  ] : [
    function () { return ctx.http.post(url, body, options); },
    function () { return ctx.http.post(url, { body: body, headers: headers, timeoutMs: REQUEST_TIMEOUT_MS }); }
  ];
  for (var i = 0; i < attempts.length; i++) {
    var response;
    try { response = await attempts[i](); } catch (error) { continue; }
    var status = response && typeof response.status === "number" ? response.status : 0;
    if (status !== 200) continue;
    var data = response.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (parseError) { continue; }
    }
    if (data && Number(data.code) === 1) {
      var twoFirst = POST_SHAPE === 2;
      POST_SHAPE = (twoFirst ? (i === 0 ? 2 : 1) : (i === 0 ? 1 : 2));
      return data;
    }
  }
  throw ExtensionError({ code: "unavailable", message: "片库接口暂时不可用，请稍后重试。", retryable: true });
}

async function loadLibrary(ctx, input) {
  var tab = String((input && input.tab) || "1");
  var valid = false;
  for (var i = 0; i < LIB_TABS.length; i++) if (LIB_TABS[i].id === tab) { valid = true; break; }
  if (!valid) tab = "1";
  var page = input && input.page && typeof input.page.page === "number" ? input.page.page : 1;
  if (!Number.isFinite(page) || page < 1 || page > 5000) {
    throw ExtensionError({ code: "invalid_params", message: "分页参数不正确。", retryable: false });
  }
  // 站点接口在 POST body 丢失时会退回默认电影分类；把参数放查询串，body 只作兼容。
  var path = "/index.php/ds_api/vod?type=" + encodeURIComponent(tab) +
    "&class=&area=&year=&lang=&version=&state=&letter=&time=&level=0&weekday=&by=&page=" + page;
  var data = await postForm(ctx, path, "");
  var items = [];
  var mediaType = TAB_MEDIA_TYPE[tab] || "tv";
  (data.list || []).forEach(function (row) {
    var item = apiItem(row, mediaType);
    if (item) items.push(item);
  });
  var content = { items: items };
  var pages = Number(data.pagecount) || 0;
  if (items.length && page < pages) content.next = { page: page + 1 };
  return content;
}

// ========== 搜索 ==========

// 站点 BUG（实证）：纯 ASCII 关键词 ≥11 字符时 wd 被丢弃，返回全库列表（95087 条），
// 其分页链接变成 /vodsearch/++++++++++----------N---.html（关键词位置是加号/空格）。
// 正常搜索页的分页链接一定带编码后的关键词。用这个签名识别回退，避免把全库当搜索结果。
function isSearchFallback(html) {
  return /href="\/vodsearch\/\+{3,}/.test(html);
}

function searchTotalPages(html, itemCount) {
  // mac-total 脚本在所有搜索页都存在（含空结果/回退页），是最可靠的总数信号
  var tm = /mac-total'\)\.html\('(\d+)'\)/.exec(html);
  if (tm) {
    var total = parseInt(tm[1], 10);
    if (isFinite(total) && total >= 0) return Math.ceil(total / SEARCH_PAGE_SIZE);
  }
  var tip = /共\d+条数据,当前(\d+)\/(\d+)页/.exec(html);
  if (tip) return parseInt(tip[2], 10) || 0;
  // 无总数信号时按满页推断（站点每页 10 条）
  return itemCount >= SEARCH_PAGE_SIZE ? 2 : 1;
}

// suggest 兜底：GET /index.php/ajax/suggest?mid=1&wd=&limit=50（中文/拼音前缀匹配，无 ≥11 字符 BUG）
async function searchSuggest(ctx, query) {
  var url = BASE_URL + "/index.php/ajax/suggest?mid=1&limit=50&wd=" + encodeURIComponent(query);
  var headers = {};
  Object.keys(BROWSER_HEADERS).forEach(function (k) { headers[k] = BROWSER_HEADERS[k]; });
  headers["Accept"] = "application/json, text/javascript, */*; q=0.01";
  headers["X-Requested-With"] = "XMLHttpRequest";
  var response;
  try {
    response = await ctx.http.get(url, { headers: headers, timeoutMs: REQUEST_TIMEOUT_MS });
  } catch (error) {
    return [];
  }
  if (!response || response.status !== 200) return [];
  var data = response.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (parseError) { return []; }
  }
  if (!data || Number(data.code) !== 1 || !Array.isArray(data.list)) return [];
  var items = [];
  var seen = {};
  data.list.forEach(function (row) {
    var id = row && row.id;
    if (!id || seen[id]) return;
    seen[id] = 1;
    var name = trim(row.name);
    if (!name) return;
    var item = {
      ref: { source: "custom", id: "/voddetail/" + id + ".html" },
      title: name,
      images: {},
    };
    var pic = trim(row.pic);
    if (pic) item.images.poster = imageURL(pic);
    items.push(item);
  });
  return items;
}

async function searchExtension(ctx, input) {
  var query = trim(input && input.query ? input.query : "");
  if (!query) return { items: [] };
  var page = input && input.page && typeof input.page.page === "number" ? input.page.page : 1;
  if (!Number.isFinite(page) || page < 1) page = 1;
  var html = await fetchHTML(ctx, "/vodsearch/-------------.html", { query: { wd: query, page: page } });
  if (isSearchFallback(html)) {
    // 关键词被站点丢弃：改走 suggest 接口（仅第一页有意义，不给 next）
    var sugItems = await searchSuggest(ctx, query);
    return { items: sugItems };
  }
  var items = parseCards(html);
  var content = { items: items };
  var totalPages = searchTotalPages(html, items.length);
  if (items.length && page < totalPages) content.next = { page: page + 1 };
  return content;
}

// ========== 演职员头像补全（豆瓣 rexxar 公开接口） ==========
// 站点详情页不提供演员照片（角色区恒空，实证多部影片）。用豆瓣移动端公开接口按片名匹配条目，
// 再取 celebrities 的 avatar 按姓名补到 people 上。失败静默跳过，绝不影响详情主流程。
// 接口：GET m.douban.com/rexxar/api/v2/search/subjects?q=&loc_id=0（需 Referer）
//       GET m.douban.com/rexxar/api/v2/{movie|tv}/{id}/celebrities
// 图片：img*.doubanio.com 无 Referer 返回 418，由 requestRules 统一带本站 Referer（实测任意 Referer 均 200）。

var DOUBAN_ORIGIN = "https://m.douban.com";
var AVATAR_CACHE = {};
var AVATAR_CACHE_TTL_MS = 60 * 60 * 1000;
// 豆瓣匿名配额有限（实证：本出口连续 ~30 次搜索后 403 need_login，celebrities 仍可用）。
// 失败时按片冷却 5 分钟、全局熔断 10 分钟，避免每次详情都白打两次请求。
var AVATAR_FAIL_CACHE = {};
var AVATAR_FAIL_TTL_MS = 5 * 60 * 1000;
var DOUBAN_COOLDOWN_UNTIL = 0;

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[\s·・:：\-—–_,，.。!！?？'""''()（）\[\]【】]/g, "");
}

function doubanHeaders() {
  var headers = {};
  Object.keys(BROWSER_HEADERS).forEach(function (k) { headers[k] = BROWSER_HEADERS[k]; });
  headers["Referer"] = "https://m.douban.com/movie/";
  headers["Accept"] = "application/json, text/plain, */*";
  return headers;
}

async function doubanGet(ctx, path) {
  var response;
  try {
    response = await ctx.http.get(DOUBAN_ORIGIN + path, { headers: doubanHeaders(), timeoutMs: 8000 });
  } catch (error) {
    return null;
  }
  if (!response) return null;
  // 403/429 = 匿名配额耗尽或限流：触发全局熔断，期间所有头像补全直接跳过
  if (response.status === 403 || response.status === 429) {
    DOUBAN_COOLDOWN_UNTIL = Date.now() + 10 * 60 * 1000;
    return null;
  }
  if (response.status !== 200) return null;
  var data = response.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (parseError) { return null; }
  }
  if (!data || typeof data !== "object") return null;
  if (data.banned) {
    DOUBAN_COOLDOWN_UNTIL = Date.now() + 10 * 60 * 1000;
    return null;
  }
  return data;
}

// 按片名+年份在豆瓣搜索结果里挑最匹配的条目，返回 { id, kind } 或 null
function pickDoubanSubject(data, title, year) {
  var items = (data && data.subjects && data.subjects.items) || [];
  var want = normalizeName(title);
  if (!want) return null;
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < items.length && i < 10; i++) {
    var target = items[i] && items[i].target;
    if (!target || !target.id) continue;
    var got = normalizeName(target.title);
    if (!got) continue;
    var score = 0;
    if (got === want) score += 4;
    else if (got.indexOf(want) === 0 || want.indexOf(got) === 0) score += 2;
    else continue;
    var ty = String(target.year || "");
    if (year && ty === String(year)) score += 2;
    else if (year && ty && Math.abs(parseInt(ty, 10) - parseInt(year, 10)) <= 1) score += 1;
    var uri = String(target.uri || "");
    var km = /\/(movie|tv)\/(\d+)/.exec(uri);
    if (!km) continue;
    if (score > bestScore) {
      bestScore = score;
      best = { id: km[2], kind: km[1] };
    }
  }
  // 至少要有标题匹配（score>=2）才采用，避免拿错片子的头像
  return bestScore >= 2 ? best : null;
}

async function enrichPeopleAvatars(ctx, detail, vodId) {
  if (!detail || !detail.people || !detail.people.length) return;
  if (!ctx || !ctx.http || typeof ctx.http.get !== "function") return;
  var now = Date.now();
  if (now < DOUBAN_COOLDOWN_UNTIL) return;
  var failedAt = AVATAR_FAIL_CACHE[vodId];
  if (failedAt && now - failedAt < AVATAR_FAIL_TTL_MS) return;
  var cached = AVATAR_CACHE[vodId];
  if (cached && now - cached.ts < AVATAR_CACHE_TTL_MS) {
    applyAvatarMap(detail.people, cached.map);
    return;
  }
  try {
    var search = await doubanGet(ctx, "/rexxar/api/v2/search/subjects?q=" + encodeURIComponent(detail.title) + "&loc_id=0");
    var subject = pickDoubanSubject(search, detail.title, detail.releaseDate);
    if (!subject) { AVATAR_FAIL_CACHE[vodId] = Date.now(); return; }
    var celeb = await doubanGet(ctx, "/rexxar/api/v2/" + subject.kind + "/" + subject.id + "/celebrities");
    if (!celeb) { AVATAR_FAIL_CACHE[vodId] = Date.now(); return; }
    var map = {};
    ["directors", "actors"].forEach(function (key) {
      (celeb[key] || []).forEach(function (person) {
        var name = trim(person && person.name);
        if (!name) return;
        var avatar = person.avatar && (person.avatar.large || person.avatar.normal || person.avatar.small);
        if (avatar && /^https?:\/\//.test(avatar)) map[normalizeName(name)] = avatar;
      });
    });
    AVATAR_CACHE[vodId] = { map: map, ts: Date.now() };
    applyAvatarMap(detail.people, map);
  } catch (error) {
    // 补全失败不影响详情
    AVATAR_FAIL_CACHE[vodId] = Date.now();
  }
}

function applyAvatarMap(people, map) {
  if (!map) return;
  people.forEach(function (person) {
    if (person.avatar) return;
    var url = map[normalizeName(person.title)];
    if (url) person.avatar = url;
  });
}

// ========== 扩展 handlers ==========

async function loadHome(ctx) {
  var html = await fetchHTML(ctx, "/");
  return { items: parseCards(html) };
}

async function readDetailPage(ctx, input) {
  var ref = input && input.ref ? input.ref : null;
  if (!ref || !ref.id || !DETAIL_RE.test(ref.id)) {
    throw ExtensionError({ code: "invalid_params", message: "缺少条目地址", retryable: false });
  }
  var html = await fetchHTML(ctx, ref.id);
  var detail = parseDetail(html, ref);
  if (detail) {
    var idm = DETAIL_RE.exec(ref.id);
    await enrichPeopleAvatars(ctx, detail, idm ? idm[1] : ref.id);
  }
  return detail;
}

function placeholderContent() {
  return {
    items: [
      {
        ref: { source: "custom", id: "/voddetail/80498.html", mediaType: "movie" },
        title: "弗兰肯斯坦",
        subtitle: "恐怖",
        images: { poster: "https://img1.wsyzy.org/upload/vod/20251129-1/061df7e2975211d55afacb13b54dbc20.jpg" },
      },
      {
        ref: { source: "custom", id: "/voddetail/80633.html", mediaType: "tv" },
        title: "怪奇物语第五季",
        subtitle: "欧美",
        images: { poster: "https://tupian.ffeiimg.com/upload/vod/20251127-1/fd3b3f1c4ec01106cb9cbd9b16bc50f5.jpg" },
      },
    ],
  };
}

// ========== 包定义 ==========

definePackage({
  id: "sixian.netflixgc",
  title: "奈飞工厂",
  description: "奈飞工厂（netflixgc.com）在线影视：首页推荐、全量片库分类浏览、搜索（含分页）、详情与多线路在线播放。",
  author: "sixian",
  site: "https://www.netflixgc.com",
  icon: "https://www.netflixgc.com/upload/site/20241029-1/708c271d0bbf43725b96fad94d0c1eb4.png",
  version: "1.2.0",
  engine: 1,
  permissions: {
    network: [
    "https://www.netflixgc.com",
    "https://m.douban.com",
    "https://mplayer.nfgc.net",
    "https://pcdn-qn-new.samtory.cn",
    "https://v.fengbao11.com",
    "https://v13.wsyzym3u8.com",
    "https://v14.wsyzym3u8.com",
    "https://vod.ffzy-bofang.com",
    "https://v.lfthirtytwo.com",
    "https://play.phimgood.com",
    "https://cdn.yzzyvip-29.com",
    "https://v.lzcdn27.com",
    "https://v.fengbao8.com",
    "https://svip.feifei-play.com",
    "https://vip.dytt-see.com",
    "https://cdn.yzzy29-play.com"
  ],
  },
  requestRules: [
    { host: "*.wsyzy.org", headers: { Referer: "https://www.netflixgc.com/" } },
    { host: "*.doubanio.com", headers: { Referer: "https://www.netflixgc.com/" } },
  ],
  settings: [
    {
      name: "probeMode",
      title: "线路检测",
      type: "select",
      default: "keep",
      options: [
        { title: "全部显示，只标注状态（默认）", value: "keep" },
        { title: "隐藏明确打不开的线路", value: "hide" }
      ],
      description: "播放前用当前网络探测线路。只隐藏明确返回 403/404/410 的线路；超时或未知状态保留。选择“全部显示”时一条都不隐藏。"
    }
  ],
  extensions: [
    {
      type: "widget",
      id: "latest",
      title: "奈飞工厂",
      description: "奈飞工厂首页推荐（Netflix 与欧美剧为主）。",
      template: "poster-grid",
      headerIntent: "list",
      ref: { source: "custom", id: "browse" },
      cache: { ttlSeconds: 600 },
      resolveTitle: function (ctx, input) {
        return "奈飞工厂";
      },
      placeholderData: placeholderContent(),
      load: async function (ctx, input) {
        return loadHome(ctx);
      },
    },
    {
      type: "list",
      id: "browse",
      title: "奈飞工厂",
      description: "奈飞工厂全量片库：电影、连续剧、漫剧、综艺、纪录片，分类切换与无限翻页。",
      style: "grid",
      accepts: { sources: ["custom"] },
      search: { id: "main" },
      tabs: async function (ctx, input) {
        return { tabs: LIB_TABS, default: "1" };
      },
      cache: { ttlSeconds: 600 },
      load: async function (ctx, input) {
        return loadLibrary(ctx, input);
      },
    },
    {
      type: "search",
      id: "main",
      title: "奈飞工厂",
      description: "搜索奈飞工厂站点（支持分页）。",
      cache: { ttlSeconds: 1800 },
      search: async function (ctx, input) {
        return searchExtension(ctx, input);
      },
    },
    {
      type: "detail",
      id: "main",
      title: "奈飞工厂详情",
      description: "读取奈飞工厂详情页的标题、简介、评分、演职员和剧集列表。",
      accepts: { sources: ["custom"] },
      load: async function (ctx, input) {
        return readDetailPage(ctx, input);
      },
    },
    {
      type: "playback",
      id: "main",
      title: "奈飞工厂线路",
      description: "从奈飞工厂播放页解析在线播放线路（自动跳过原生不可播的 NBY 包装线路）。",
      accepts: { sources: ["custom"] },
      sources: async function (ctx, input) {
        return playbackSources(ctx, input);
      },
    },
  ],
});