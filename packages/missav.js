/* MissAV Webox→Conflux；保留原解析器，安全修订见 source-changes.diff。 */
/* HTTP边界沿用已真机验证的抖音限跳转桥：Promise收同步异常、逐跳核验、禁外传Cookie。 */
var MA_VERSION = "1.0.0";
function maFail(code, message, retryable) {
  throw ExtensionError({code:code,message:message,retryable:!!retryable});
}
function maURL(value) {
  var s=String(value||"").trim(),m=s.match(/^https:\/\/([a-z0-9.-]+)(?::443)?(?=[\/?#]|$)/i);
  if(!m||/[\x00-\x20\x7f]/.test(s)||m[1].indexOf("..")>=0)return null;
  return {url:s,host:m[1].toLowerCase(),origin:"https://"+m[1].toLowerCase()};
}
function maMediaURL(value) {
  var p=maURL(value);return p&&(p.host==='surrit.com'||/\.surrit\.com$/.test(p.host))?p:null;
}
function maRelative(value, base) {
  var s=String(value||"").trim(),b=maURL(base);if(!b)return '';
  if(/^https:\/\//i.test(s))return s;
  if(s.indexOf('//')===0)return 'https:'+s;
  if(s.charAt(0)==='/')return b.origin+s;
  if(s.charAt(0)==='?')return String(base).split(/[?#]/)[0]+s;
  if(!s||/^[a-z][a-z0-9+.-]*:/i.test(s))return '';
  var path=String(base).slice(b.origin.length).split(/[?#]/)[0].replace(/[^/]*$/,'')+s;
  var parts=path.split('/'),out=[];for(var i=0;i<parts.length;i++){if(parts[i]==='..')out.pop();else if(parts[i]!=='.'&&parts[i]!=='')out.push(parts[i]);}
  return b.origin+'/'+out.join('/');
}
function maContext(ctx) {
  var settings=Object.assign({},ctx&&ctx.settings||{});
  var configured=maURL(settings.site||MA_ORIGINAL.port.defaultSite);
  if(!configured)maFail('invalid_params','站点地址必须是 HTTPS 地址，且不能包含账号密码。',false);
  settings.site=String(settings.site||MA_ORIGINAL.port.defaultSite).replace(/\/+$/,'');
  if(settings.lang&&['auto','en','cn','zh','ja'].indexOf(settings.lang)<0)maFail('invalid_params','请选择有效的语言路径。',false);
  var meta={last:null};
  function headersFor(raw,host) {
    var out={};Object.keys(raw||{}).forEach(function(k){if(k.toLowerCase()!=='cookie'&&k.toLowerCase()!=='authorization')out[k]=raw[k];});
    if(host===configured.host&&settings.cookie){out.Cookie=String(settings.cookie).replace(/[\r\n]+/g,'; ').replace(/^cookie\s*:\s*/i,'').trim();}
    return out;
  }
  function request(url,raw,hops) {
    return Promise.resolve().then(function(){
      var target=maURL(url);if(!target||hops>5||(target.host!==configured.host&&!maMediaURL(url)))maFail('unavailable','请求跳转到了未授权的站点，请检查站点地址。',false);
      var opt={headers:headersFor(raw&&raw.headers,target.host),timeoutMs:Math.min(Number(raw&&raw.timeoutMs)||18000,20000),followRedirects:false,cacheTtlSeconds:0};
      return ctx.http.get(url,opt);
    }).then(function(res){
      if(!res||typeof res.status!=='number')maFail('unavailable','网络没有返回有效响应，请稍后重试。',true);
      var head={},location='';Object.keys(res.headers||{}).forEach(function(k){head[k.toLowerCase()]=res.headers[k];if(k.toLowerCase()==='location')location=String(res.headers[k]||'');});
      if(res.status>=300&&res.status<400&&location)return request(maRelative(location,url),raw,hops+1);
      var body=typeof res.data==='string'?res.data:res.data==null?'':String(res.data);
      if(body.length>4000000)maFail('unavailable','页面响应过大，已停止解析。',false);
      if(String(head['cf-mitigated']||'').toLowerCase()==='challenge'||MA_ORIGINAL.port.challenge(res.status,body))maFail('unavailable','站点要求 Cloudflare 验证，请使用正常网络，或配置匹配的 Cookie 与 User-Agent。',false);
      meta.last={status:res.status,body:body,url:url};
      return {status:res.status,headers:res.headers||{},data:body};
    },function(e){if(e&&e.code)throw e;maFail('unavailable','网络请求失败，请稍后重试。',true);});
  }
  var out={settings:settings,http:{get:function(u,o){return request(u,o||{},0);}},fail:function(code,msg){
    var map={CONFIG_REQUIRED:'invalid_params',INVALID_RESPONSE:'unavailable',NETWORK:'unavailable',AUTH_REQUIRED:'unavailable',NOT_FOUND:'not_found',RATE_LIMITED:'rate_limited'};
    maFail(map[code]||'internal',msg||'来源请求失败。',code==='NETWORK'||code==='RATE_LIMITED');
  },portMeta:meta};
  return out;
}

function createMissavSource(){
  var legacy;var WeBox={define:function(p){legacy=p;}};
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_SITE_URL = "https://missav.live/dm265/en";
const DEFAULT_TIMEOUT_SEC = 18;
const DEFAULT_COVER_CDN = "https://fourhoi.com";

const DEFAULT_CATEGORIES = [
  { label: "最近更新 (New)", value: "new" },
  { label: "新作上市 (Release)", value: "release" },
  { label: "中文字幕 (Chinese Sub)", value: "chinese-subtitle" },
  { label: "英文字幕 (English Sub)", value: "english-subtitle" },
  { label: "无码流出 (Uncensored Leak)", value: "uncensored-leak" },
  { label: "今日热门 (Today Hot)", value: "today-hot" },
  { label: "本周热门 (Weekly Hot)", value: "weekly-hot" },
  { label: "本月热门 (Monthly Hot)", value: "monthly-hot" },
  { label: "SIRO (素人)", value: "siro" },
  { label: "LUXU (ラグジュTV)", value: "luxu" },
  { label: "GANA (ナンパTV)", value: "gana" },
  { label: "PRESTIGE PREMIUM", value: "prestigetv" },
  { label: "S-CUTE", value: "scute" },
  { label: "ARA (俺の素人)", value: "ara" },
  { label: "FC2", value: "fc2" },
  { label: "麻豆传媒 (Madou)", value: "madou" }
];

const SORT_OPTIONS = [
  { label: "默认排序", value: "" },
  { label: "发行日期", value: "released_at" },
  { label: "最近更新", value: "published_at" },
  { label: "今日浏览", value: "today_views" },
  { label: "本周浏览", value: "weekly_views" },
  { label: "本月浏览", value: "monthly_views" },
  { label: "总浏览数", value: "views" },
  { label: "收藏数", value: "saved" }
];

const NON_VIDEO_SEGMENTS = new Set([
  "new",
  "release",
  "uncensored-leak",
  "chinese-subtitle",
  "english-subtitle",
  "today-hot",
  "weekly-hot",
  "monthly-hot",
  "siro",
  "luxu",
  "gana",
  "prestigetv",
  "scute",
  "ara",
  "fc2",
  "madou",
  "klive",
  "clive",
  "tokyohot",
  "carib",
  "caribpr",
  "1pondo",
  "10musume",
  "pacopacomama",
  "gachinco",
  "xxxav",
  "marriedslash",
  "naughty4610",
  "naughty0930",
  "actresses",
  "genres",
  "makers",
  "series",
  "labels",
  "directors",
  "tags",
  "search",
  "playlists",
  "saved",
  "login",
  "register",
  "contact",
  "dmca",
  "terms",
  "privacy",
  "en",
  "cn",
  "zh",
  "ja",
  "ko",
  "ms",
  "th",
  "vi",
  "id",
  "fil",
  "fr",
  "de",
  "es",
  "pt"
]);

const PAGE_CACHE = new Map();
const VIDEO_PATH_CACHE = new Map();
const CATEGORY_PATH_CACHE = new Map();
let lastCacheGeneration = null;
let lastSettingsSnapshot = "";

function checkAborted(ctx) {
  if (ctx && ctx.signal && typeof ctx.signal.throwIfAborted === "function") {
    ctx.signal.throwIfAborted();
  }
}

function fail(ctx, code, message, details) {
  if (ctx && typeof ctx.fail === "function") {
    if (details !== undefined) {
      ctx.fail(code, message, details);
    } else {
      ctx.fail(code, message);
    }
  }
  const err = new Error(message || code);
  err.code = code;
  if (details !== undefined) err.details = details;
  throw err;
}

/**
 * 解析站点 Origin、语言代码与前缀路径（如 https://missav.live/dm265/en -> origin: https://missav.live, basePath: /dm265/en, lang: en）
 */
function getSiteConfig(ctx) {
  const settings = (ctx && ctx.settings) || {};
  const rawSite = settings.site ? String(settings.site).trim() : "";
  const targetUrl = rawSite || DEFAULT_SITE_URL;

  const match = targetUrl.match(/^(https?:\/\/[^/\s?#]+)(\/[^?#\s]*)?/i);
  if (!match) {
    fail(ctx, "CONFIG_REQUIRED", "站点地址必须是有效的 HTTP(S) 地址", {
      fields: ["site"]
    });
  }

  const origin = match[1].replace(/\/+$/, "");
  let basePath = (match[2] || "").replace(/\/+$/, "");

  const langSetting = settings.lang ? String(settings.lang).trim() : "auto";
  if (langSetting && langSetting !== "auto") {
    const dmMatch = basePath.match(/^(\/dm\d+)(?:\/[a-z]{2,3})?$/i);
    if (dmMatch) {
      basePath = dmMatch[1] + "/" + langSetting;
    } else {
      basePath = "/" + langSetting;
    }
  } else if (!basePath) {
    basePath = "/dm265/en";
  }

  const langMatch = basePath.match(/\/([a-z]{2,3})$/i);
  const lang = langMatch ? langMatch[1].toLowerCase() : "en";

  return {
    origin: origin,
    basePath: basePath,
    lang: lang,
    baseUrl: origin + basePath
  };
}

function getUserAgent(ctx) {
  const customUa =
    ctx && ctx.settings && ctx.settings.userAgent
      ? String(ctx.settings.userAgent).trim()
      : "";
  return customUa.replace(/[\r\n]+/g, " ") || DEFAULT_UA;
}

function getTimeoutMs(ctx) {
  const sec = Number(ctx && ctx.settings && ctx.settings.timeout);
  if (Number.isFinite(sec) && sec >= 5 && sec <= 60) {
    return Math.round(sec * 1000);
  }
  return DEFAULT_TIMEOUT_SEC * 1000;
}

function buildPageHeaders(ctx, origin, referer) {
  const headers = {
    "User-Agent": getUserAgent(ctx),
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": referer || origin + "/"
  };
  const cookie =
    ctx && ctx.settings && ctx.settings.cookie
      ? String(ctx.settings.cookie).replace(/[\r\n]+/g, "; ").trim()
      : "";
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  return headers;
}

function buildMediaHeaders(ctx, origin) {
  // 遵循安全规范：绝不将用户 Cookie 广播给第三方媒体 CDN (surrit.com)
  return {
    "User-Agent": getUserAgent(ctx),
    "Referer": origin + "/",
    "Origin": origin
  };
}

function syncRuntimeState(ctx) {
  const gen = ctx && ctx.cache ? ctx.cache.generation : 0;
  const settingsSnap = JSON.stringify((ctx && ctx.settings) || {});
  if (gen !== lastCacheGeneration || settingsSnap !== lastSettingsSnapshot) {
    PAGE_CACHE.clear();
    if (settingsSnap !== lastSettingsSnapshot) {
      VIDEO_PATH_CACHE.clear();
      CATEGORY_PATH_CACHE.clear();
    }
    lastCacheGeneration = gen;
    lastSettingsSnapshot = settingsSnap;
  }
}

async function readWithCache(ctx, namespace, keyParts, defaultTtlSec, refresh, loader) {
  syncRuntimeState(ctx);
  checkAborted(ctx);

  const ttlSec =
    ctx && ctx.cache && typeof ctx.cache.seconds === "function"
      ? ctx.cache.seconds(defaultTtlSec)
      : defaultTtlSec;
  const ttlMs = Math.max(0, Number(ttlSec) || 0) * 1000;
  const cacheKey = namespace + ":" + JSON.stringify(keyParts);
  const startGen = ctx && ctx.cache ? ctx.cache.generation : 0;

  if (!refresh && ttlMs > 0 && PAGE_CACHE.has(cacheKey)) {
    const entry = PAGE_CACHE.get(cacheKey);
    if (entry.generation === startGen && Date.now() - entry.savedAt < ttlMs) {
      return entry.value;
    }
    PAGE_CACHE.delete(cacheKey);
  }

  const value = await loader();
  checkAborted(ctx);

  const currentGen = ctx && ctx.cache ? ctx.cache.generation : 0;
  if (ttlMs > 0 && startGen === currentGen) {
    PAGE_CACHE.set(cacheKey, {
      generation: currentGen,
      savedAt: Date.now(),
      value: value
    });
  }
  return value;
}

function isCloudflareChallenge(status, html) {
  if (status !== 403 && status !== 503) return /<title>\s*Just a moment|__cf_chl_opt/i.test(String(html || ""));
  const text = String(html || "");
  return (
    /Just a moment\.\.\.|Attention Required! \| Cloudflare|cf-browser-verification|challenge-platform|__cf_chl_/i.test(
      text
    )
  );
}

async function fetchHtml(ctx, url, options) {
  checkAborted(ctx);
  const opts = options || {};
  const siteCfg = getSiteConfig(ctx);

  const response = await ctx.http.get(url, {
    headers: buildPageHeaders(ctx, siteCfg.origin, opts.referer || siteCfg.baseUrl),
    responseType: "text",
    timeoutMs: getTimeoutMs(ctx)
  });
  checkAborted(ctx);

  if (!response || typeof response.status !== "number") {
    fail(ctx, "NETWORK", "网络响应异常，请稍后重试");
  }

  const data =
    typeof response.data === "string"
      ? response.data
      : response.data == null
      ? ""
      : String(response.data);

  if (isCloudflareChallenge(response.status, data)) {
    fail(
      ctx,
      "AUTH_REQUIRED",
      "站点触发 Cloudflare 验证，请在配置中设置有效的 Cookie (cf_clearance) 与对应 User-Agent"
    );
  }
  if (response.status === 404) {
    if (opts.notFoundAsEmpty) return "";
    fail(ctx, "NOT_FOUND", "请求的内容不存在");
  }
  if (response.status === 429) {
    fail(ctx, "RATE_LIMITED", "请求过于频繁，请稍后再试");
  }
  if (response.status === 401 || response.status === 403) {
    fail(ctx, "AUTH_REQUIRED", "站点拒绝访问 (HTTP " + response.status + ")，请检查网络或配置 Cookie");
  }
  if (response.status < 200 || response.status >= 300) {
    fail(ctx, "NETWORK", "站点请求失败 (HTTP " + response.status + ")");
  }

  return data;
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function truncateText(str, maxLen) {
  const s = String(str || "").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function resolveUrl(ctx, rawUrl, baseOrigin) {
  if (!rawUrl) return "";
  const trimmed = decodeHtmlEntities(String(rawUrl)).trim();
  if (!trimmed || /^javascript:|^data:|^blob:/i.test(trimmed) || trimmed.indexOf("#") === 0) {
    return "";
  }
  if (trimmed.indexOf("//") === 0) return "https:" + trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (ctx && ctx.url && typeof ctx.url.resolve === "function") {
    try {
      return ctx.url.resolve(trimmed, baseOrigin + "/");
    } catch (_) {}
  }
  if (trimmed.indexOf("/") === 0) return baseOrigin + trimmed;
  return baseOrigin + "/" + trimmed;
}

/**
 * 判断候选 URL 是否是视频预览流或无效占位图（避免将 fourhoi.com/.../preview.mp4 当作图片封面）
 */
function isInvalidPosterCandidate(urlStr) {
  if (!urlStr) return true;
  const s = String(urlStr).trim();
  if (!s || /^data:|^blob:|^javascript:/i.test(s)) return true;
  const cleanPath = s.split(/[?#]/)[0];
  // 排除视频/音频流文件（MissAV 卡片内含 <a/video data-src="https://fourhoi.com/<id>/preview.mp4">）
  if (/\.(?:mp4|webm|m3u8|ts|mov|mkv|avi|mp3|m4a|ogg)$/i.test(cleanPath)) {
    return true;
  }
  // 排除站点 Logo、加载占位图、空像素图
  if (/(?:placeholder|loading|blank|spacer|1x1|logo|favicon|avatar|empty)\.(?:gif|png|svg|jpg|webp)/i.test(cleanPath)) {
    return true;
  }
  return false;
}

/**
 * 根据用户在设置中选择的封面加载方式转换海报地址（解决 fourhoi.com 未纳入分流规则或防盗链导致封面不显示问题）
 */
function formatPosterUrl(ctx, rawImgUrl) {
  if (!rawImgUrl || !/^https?:\/\//i.test(rawImgUrl)) return "";
  const settings = (ctx && ctx.settings) || {};
  const mode = settings.posterProxy ? String(settings.posterProxy).trim() : "direct";

  if (mode === "wsrv") {
    return "https://wsrv.nl/?url=" + encodeURIComponent(rawImgUrl);
  }
  if (mode === "wp") {
    const withoutProto = rawImgUrl.replace(/^https?:\/\//i, "");
    return "https://i0.wp.com/" + withoutProto;
  }
  if (mode === "custom") {
    const customPrefix = settings.customPosterProxy
      ? String(settings.customPosterProxy).trim()
      : "";
    if (!customPrefix || !/^https?:\/\/[^/\s]+/i.test(customPrefix)) {
      fail(ctx, "CONFIG_REQUIRED", "自定义封面代理地址必须是有效的 HTTP(S) 地址", {
        fields: ["customPosterProxy"]
      });
    }
    if (customPrefix.indexOf("{url}") !== -1) {
      return customPrefix.replace(/\{url\}/g, encodeURIComponent(rawImgUrl));
    }
    if (/[?&]url=$/i.test(customPrefix)) {
      return customPrefix + encodeURIComponent(rawImgUrl);
    }
    return customPrefix.replace(/\/+$/, "") + "?url=" + encodeURIComponent(rawImgUrl);
  }

  return rawImgUrl;
}

/**
 * 从视频链接提取稳定视频标识（如 https://missav.live/dm265/en/ssni-888 -> ssni-888）
 */
function extractVideoIdAndPath(href, origin) {
  if (!href) return null;
  let pathStr = String(href).trim();
  if (pathStr.indexOf(origin) === 0) {
    pathStr = pathStr.slice(origin.length);
  } else if (/^https?:\/\//i.test(pathStr)) {
    const m = pathStr.match(/^https?:\/\/[^/]+(\/.*)$/i);
    if (!m) return null;
    pathStr = m[1];
  }

  pathStr = pathStr.split(/[?#]/)[0].replace(/\/+$/, "");
  if (!pathStr || pathStr.indexOf("/") !== 0) return null;

  const segments = pathStr.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // 排除多级分类目录，如 /en/actresses/xxx、/en/genres/xxx、/en/makers/xxx、/en/search/xxx
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i].toLowerCase();
    if (
      /^(?:actresses|genres|makers|series|labels|directors|tags|search|playlists|saved)$/i.test(
        seg
      )
    ) {
      return null;
    }
  }

  const slug = segments[segments.length - 1];
  if (!slug || NON_VIDEO_SEGMENTS.has(slug.toLowerCase())) return null;
  if (/^dm\d+$/i.test(slug)) return null;

  // MissAV 番号/视频 slug 通常包含连字符或数字（如 ssni-888, fc2-ppv-123456, dldss-531-uncensored-leak）
  if (!/^[a-zA-Z0-9_-]{3,120}$/.test(slug) || !/[0-9-]/.test(slug)) {
    return null;
  }

  return {
    id: slug.toLowerCase(),
    path: pathStr
  };
}

/**
 * 从单个视频卡片 HTML 块中提取封面图 URL：
 * 1. 仅从 <img ...> 标签上提取 data-src / data-original / data-lazy-src / src，严格过滤 .mp4 等视频预览流
 * 2. 若块内存在 fourhoi.com/<id>/preview.mp4，自动将其转换为 fourhoi.com/<id>/cover-t.jpg
 * 3. 若均未提取到，基于 MissAV 官方封面 CDN 规则 (https://fourhoi.com/<videoId>/cover-t.jpg) 确定性兜底
 */
function extractPosterFromBlock(ctx, block, origin, videoId) {
  const attrs = ["data-src", "data-original", "data-lazy-src", "data-srcset", "srcset", "src"];

  // 1. 仅扫描 <img ...> 标签，绝不读取 <video> 或 <a> 上的 data-src="...preview.mp4"
  const imgTagRegex = /<img\b[\s\S]*?>/gi;
  let imgMatch;
  while ((imgMatch = imgTagRegex.exec(block)) !== null) {
    const imgTag = imgMatch[0];
    for (const attr of attrs) {
      const attrRegex = new RegExp(`\\b${attr}=["']([^"']+)["']`, "i");
      const m = imgTag.match(attrRegex);
      if (!m) continue;

      // 若是 srcset，取第一个 URL
      const rawCandidate = m[1].split(",")[0].trim().split(/\s+/)[0];
      if (isInvalidPosterCandidate(rawCandidate)) continue;

      const resolved = resolveUrl(ctx, rawCandidate, origin);
      if (/^https?:\/\//i.test(resolved) && !isInvalidPosterCandidate(resolved)) {
        return formatPosterUrl(ctx, resolved);
      }
    }
  }

  // 2. 若块内包含 fourhoi.com/<slug>/preview.mp4 或其他 fourhoi 资源，直接转换为 cover-t.jpg
  const fourhoiMatch = block.match(/https?:\/\/(?:[a-z0-9-]+\.)?fourhoi\.com\/([a-zA-Z0-9_-]+)\/[^\s"'<>]+/i);
  if (fourhoiMatch && fourhoiMatch[1]) {
    const slug = fourhoiMatch[1].toLowerCase();
    return formatPosterUrl(ctx, `${DEFAULT_COVER_CDN}/${slug}/cover-t.jpg`);
  }

  // 3. 确定性兜底：使用视频 ID 构造标准封面地址
  if (videoId) {
    return formatPosterUrl(ctx, `${DEFAULT_COVER_CDN}/${videoId}/cover-t.jpg`);
  }

  return "";
}

function parseSingleThumbnailBlock(ctx, block, origin) {
  if (!block) return null;

  const aRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let aMatch;
  let videoInfo = null;
  let titleFromText = "";
  let titleFromAlt = "";

  while ((aMatch = aRegex.exec(block)) !== null) {
    const attrs = aMatch[1];
    const inner = aMatch[2];
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch) continue;

    const extracted = extractVideoIdAndPath(hrefMatch[1], origin);
    if (!extracted) continue;

    if (!videoInfo) {
      videoInfo = extracted;
    }

    const text = stripTags(inner);
    if (
      text &&
      text.length >= 3 &&
      !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text) &&
      !/^(?:HD|4K|NEW|VR)$/i.test(text)
    ) {
      titleFromText = text;
    }

    const altAttr = attrs.match(/\balt=["']([^"']+)["']/i) || inner.match(/\balt=["']([^"']+)["']/i);
    if (altAttr && !titleFromAlt) {
      const candidateAlt = decodeHtmlEntities(altAttr[1]).trim();
      if (candidateAlt && candidateAlt.toLowerCase() !== extracted.id) {
        titleFromAlt = candidateAlt;
      } else if (candidateAlt && !titleFromAlt) {
        titleFromAlt = candidateAlt.toUpperCase();
      }
    }
  }

  if (!videoInfo) return null;

  let title = titleFromText || titleFromAlt;
  if (!title) {
    const imgAltMatch = block.match(/<img\b[\s\S]*?\balt=["']([^"']+)["']/i);
    if (imgAltMatch) {
      title = decodeHtmlEntities(imgAltMatch[1]).trim();
    }
  }
  if (!title) {
    title = videoInfo.id.toUpperCase();
  }
  title = truncateText(title, 240);

  VIDEO_PATH_CACHE.set(videoInfo.id, videoInfo.path);

  const item = {
    id: videoInfo.id,
    title: title,
    kind: "movie"
  };

  const poster = extractPosterFromBlock(ctx, block, origin, videoInfo.id);
  if (poster) {
    item.poster = poster;
  }

  // 提取时长与字幕/无码标签作为 subtitle
  const subtitleParts = [];
  const durationMatch = block.match(/\b((?:\d{1,2}:)?\d{2}:\d{2})\b/);
  if (durationMatch) {
    subtitleParts.push(durationMatch[1]);
  }

  const badgeRegex =
    /<span\b[^>]*class=["'][^"']*(?:bg-blue|bg-red|bg-green|bg-pink|bg-indigo|badge)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  let badgeMatch;
  while ((badgeMatch = badgeRegex.exec(block)) !== null) {
    const badgeText = stripTags(badgeMatch[1]);
    if (
      badgeText &&
      badgeText !== durationMatch?.[1] &&
      badgeText.length <= 24 &&
      !subtitleParts.includes(badgeText)
    ) {
      subtitleParts.push(badgeText);
    }
  }

  if (subtitleParts.length > 0) {
    item.subtitle = truncateText(subtitleParts.join(" · "), 1024);
  }

  return item;
}

/**
 * 从页面导航链接中缓存各分类的动态 /dmXXX/<lang>/<category> 路径
 */
function harvestCategoryPaths(html, origin, lang) {
  if (!html) return;
  const hrefRegex = /\bhref=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRegex.exec(html)) !== null) {
    let raw = m[1].trim();
    if (raw.indexOf(origin) === 0) {
      raw = raw.slice(origin.length);
    }
    const routeMatch = raw.match(/^(\/dm\d+\/([a-z]{2,3})\/([a-z0-9-]+))\/?$/i);
    if (routeMatch) {
      const fullPath = routeMatch[1];
      const routeLang = routeMatch[2].toLowerCase();
      const catSlug = routeMatch[3].toLowerCase();
      if (routeLang === lang) {
        CATEGORY_PATH_CACHE.set(lang + ":" + catSlug, fullPath);
      }
    }
  }
}

/**
 * 从 MissAV 列表/搜索 HTML 提取视频卡片列表
 */
function parseVideoCards(ctx, html, origin, lang) {
  if (!html) return [];
  if (lang) {
    harvestCategoryPaths(html, origin, lang);
  }

  const items = [];
  const seen = new Set();

  // 1. 优先匹配 MissAV 标准卡片容器 <div class="thumbnail ...">
  const thumbRegex = /<div\b[^>]*class=["'][^"']*\bthumbnail\b[^"']*["'][^>]*>/gi;
  const indices = [];
  let match;
  while ((match = thumbRegex.exec(html)) !== null) {
    indices.push(match.index);
  }

  for (let i = 0; i < indices.length; i++) {
    checkAborted(ctx);
    const end = i + 1 < indices.length ? indices[i + 1] : Math.min(html.length, indices[i] + 4500);
    const block = html.slice(indices[i], end);
    const card = parseSingleThumbnailBlock(ctx, block, origin);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    items.push(card);
    if (items.length >= 1000) return items;
  }

  if (items.length > 0) return items;

  // 2. 兜底：若页面 DOM 结构变化，按包含封面与番号链接的上下文提取
  const linkRegex = /<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const grouped = new Map();
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[2];
    const extracted = extractVideoIdAndPath(href, origin);
    if (!extracted || seen.has(extracted.id)) continue;

    const start = Math.max(0, match.index - 400);
    const end = Math.min(html.length, match.index + match[0].length + 600);
    const snippet = html.slice(start, end);
    if (!grouped.has(extracted.id)) {
      grouped.set(extracted.id, []);
    }
    grouped.get(extracted.id).push(snippet);
  }

  for (const [, snippets] of grouped.entries()) {
    const card = parseSingleThumbnailBlock(ctx, snippets.join("\n"), origin);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    items.push(card);
    if (items.length >= 1000) break;
  }

  return items;
}

function parsePageCursor(ctx, cursor) {
  if (cursor === null || cursor === undefined) return 1;
  if (typeof cursor !== "string" || cursor.length > 2048 || !/^[1-9][0-9]*$/.test(cursor)) {
    fail(ctx, "INVALID_RESPONSE", "分页游标无效");
  }
  const page = Number(cursor);
  if (!Number.isSafeInteger(page) || page < 2 || page > 100000) {
    fail(ctx, "INVALID_RESPONSE", "分页游标无效");
  }
  return page;
}

function hasNextPage(html, page, itemsCount) {
  if (!html || itemsCount === 0) return false;
  const nextPage = page + 1;
  if (
    new RegExp(`[?&]page=${nextPage}(?:[&#"']|$)`, "i").test(html) ||
    /rel=["']next["']/i.test(html)
  ) {
    return true;
  }
  if (/[?&]page=\d+/i.test(html)) {
    return false;
  }
  return itemsCount >= 12;
}

function appendQueryParams(baseUrl, sort, page) {
  const queryParts = [];
  if (sort) {
    queryParts.push("sort=" + encodeURIComponent(sort));
  }
  if (page > 1) {
    queryParts.push("page=" + encodeURIComponent(String(page)));
  }
  return queryParts.length > 0 ? baseUrl + "?" + queryParts.join("&") : baseUrl;
}

function buildListUrl(siteCfg, category, sort, page) {
  const cleanCat = String(category || "new").replace(/^\/+|\/+$/g, "");
  let base;
  if (cleanCat === "home") {
    base = siteCfg.baseUrl;
  } else if (/^(?:dm\d+\/)?(?:en|cn|zh|ja)\//i.test(cleanCat)) {
    base = siteCfg.origin + "/" + cleanCat;
  } else if (CATEGORY_PATH_CACHE.has(siteCfg.lang + ":" + cleanCat.toLowerCase())) {
    base = siteCfg.origin + CATEGORY_PATH_CACHE.get(siteCfg.lang + ":" + cleanCat.toLowerCase());
  } else {
    base = siteCfg.baseUrl + "/" + cleanCat;
  }

  return appendQueryParams(base, sort, page);
}

/**
 * 纯 JS 解包 Dean Edwards Packer: eval(function(p,a,c,k,e,d){...})
 */
function unpackDeanEdwards(html) {
  const unpackedChunks = [];
  const packerRegex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let match;
  while ((match = packerRegex.exec(html)) !== null) {
    try {
      const payload = match[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
      const radix = parseInt(match[3], 10);
      const count = parseInt(match[4], 10);
      const symtab = match[6].split("|");
      if (radix < 2 || radix > 62 || count < 1 || count > 4096 || !symtab.length) continue;

      const encodeBase = function (num, base) {
        const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const first = num < base ? "" : encodeBase(Math.floor(num / base), base);
        const rem = num % base;
        const ch = rem > 35 ? String.fromCharCode(rem + 29) : chars.charAt(rem);
        return first + ch;
      };

      const dict = new Map();
      for (let i = count - 1; i >= 0; i--) {
        const key = encodeBase(i, radix);
        dict.set(key, symtab[i] || key);
      }

      const unpacked = payload.replace(/\b\w+\b/g, word =>
        dict.has(word) ? dict.get(word) : word
      );
      unpackedChunks.push(unpacked);
    } catch (_) {}
  }

  return unpackedChunks.join("\n");
}

/**
 * 从视频详情/播放页 HTML 中提取所有可用的 HLS (.m3u8) 线路
 * 结合：
 * 1) Dean Edwards Packer 解包提取 surrit.com / playlist.m3u8 与分清晰度流
 * 2) 页面直链 surrit.com/{uuid} 与 UUID 正则提取（参考 net900/missav-batch-downloader）
 */
function extractMissAvStreams(html) {
  const streams = [];
  const seenUrls = new Set();

  function addStream(id, name, url) {
    if (!url) return;
    const cleaned = String(url)
      .replace(/\\\//g, "/")
      .replace(/\\u0026/gi, "&")
      .trim();
    if (!/^https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?$/i.test(cleaned)) return;
    if (seenUrls.has(cleaned)) return;
    seenUrls.add(cleaned);
    streams.push({ id: id, name: name, url: cleaned });
  }

  const unpacked = unpackDeanEdwards(html);
  const rawHtml = String(html || "").replace(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g, "");
  const combined = unpacked + "\n" + rawHtml;

  // 1. 直接匹配已解包或原始文本中的完整 m3u8 URL
  const m3u8Regex = /(https?:\\?\/\\?\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?)/gi;
  let m;
  while ((m = m3u8Regex.exec(combined)) !== null) {
    const rawUrl = m[1].replace(/\\\//g, "/");
    if (/playlist\.m3u8/i.test(rawUrl)) {
      addStream("auto", "自动 (Master HLS)", rawUrl);
    } else if (/1080p|1920x1080/i.test(rawUrl)) {
      addStream("1080p", "1080p 高清", rawUrl);
    } else if (/720p|1280x720/i.test(rawUrl)) {
      addStream("720p", "720p 清晰", rawUrl);
    } else if (/480p|842x480|854x480/i.test(rawUrl)) {
      addStream("480p", "480p 流畅", rawUrl);
    } else if (/360p|640x360/i.test(rawUrl)) {
      addStream("360p", "360p 极速", rawUrl);
    } else {
      addStream("stream-" + (streams.length + 1), "默认线路", rawUrl);
    }
  }

  // 仅使用页面实际写出的HLS，不从封面、追踪或任意UUID猜造播放地址。

  return streams;
}

function parseDetailMetadata(ctx, contentId, html, origin) {
  const detail = {
    id: contentId,
    kind: "movie",
    groups: []
  };

  if (!html) return detail;

  // 提取标题
  let title = "";
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    title = stripTags(h1Match[1]);
  }
  if (!title) {
    const ogTitleMatch = html.match(
      /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i
    );
    if (ogTitleMatch) {
      title = decodeHtmlEntities(ogTitleMatch[1])
        .replace(/\s*[-|]\s*MissAV.*$/i, "")
        .trim();
    }
  }
  if (title) {
    detail.title = truncateText(title, 240);
  }

  // 提取海报（过滤视频流与无效占位图，并提供 fourhoi.com 标准封面兜底）
  let posterUrl = "";
  const ogImgMatch =
    html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (ogImgMatch && !isInvalidPosterCandidate(ogImgMatch[1])) {
    const resolvedOg = resolveUrl(ctx, ogImgMatch[1], origin);
    if (/^https?:\/\//i.test(resolvedOg) && !isInvalidPosterCandidate(resolvedOg)) {
      posterUrl = resolvedOg;
    }
  }
  if (!posterUrl) {
    const videoPosterMatch = html.match(/\bposter=["']([^"']+)["']/i);
    if (videoPosterMatch && !isInvalidPosterCandidate(videoPosterMatch[1])) {
      const resolvedVideoPoster = resolveUrl(ctx, videoPosterMatch[1], origin);
      if (/^https?:\/\//i.test(resolvedVideoPoster) && !isInvalidPosterCandidate(resolvedVideoPoster)) {
        posterUrl = resolvedVideoPoster;
      }
    }
  }
  if (!posterUrl && contentId) {
    posterUrl = `${DEFAULT_COVER_CDN}/${contentId}/cover-n.jpg`;
  }
  if (posterUrl) {
    detail.poster = formatPosterUrl(ctx, posterUrl);
  }

  // 提取简介与番号、演员、发行日期等详情信息
  const summaryParts = [];
  const ogDescMatch =
    html.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDescMatch) {
    const desc = decodeHtmlEntities(ogDescMatch[1]).trim();
    if (desc) summaryParts.push(desc);
  }

  const infoBlockRegex = /<div\b[^>]*class=["'][^"']*\btext-secondary\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let infoMatch;
  const metaLines = [];
  while ((infoMatch = infoBlockRegex.exec(html)) !== null) {
    const line = stripTags(infoMatch[1]);
    if (
      line &&
      line.length <= 200 &&
      /发行日期|番號|番号|女优|女優|演员|類型|类型|片商|发行商|標籤|标签|Release date|Code|Actress|Genre|Maker|Label/i.test(
        line
      )
    ) {
      metaLines.push(line);
    }
  }
  if (metaLines.length > 0) {
    summaryParts.push(metaLines.join("\n"));
  }

  if (summaryParts.length > 0) {
    detail.summary = truncateText(summaryParts.join("\n\n"), 65536);
  }

  const streams = extractMissAvStreams(html);
  if (streams.length > 0 || /plyr|video|surrit\.com|eval\(function\(p,a,c,k,e/i.test(html)) {
    detail.groups.push({
      id: "main",
      name: "默认线路",
      episodes: [
        {
          id: "feature",
          name: "正片"
        }
      ]
    });
  }

  return detail;
}

function buildVideoPageUrl(siteCfg, contentId, refresh) {
  if (!refresh && VIDEO_PATH_CACHE.has(contentId)) {
    return siteCfg.origin + VIDEO_PATH_CACHE.get(contentId);
  }
  return siteCfg.baseUrl + "/" + encodeURIComponent(contentId);
}

WeBox.define({
  api: "1.1",
  id: "live.missav.webox",
  name: "MissAV",
  version: "1.1.0",
  requires: ["html"],
  cache: {
    list: 300,
    detail: 120,
    filters: 3600
  },

  settings: {
    fields: [
      {
        key: "site",
        label: "站点地址",
        type: "url",
        placeholder: "默认 https://missav.live/dm265/en"
      },
      {
        key: "lang",
        label: "语言路径",
        type: "select",
        default: "auto",
        options: [
          { label: "跟随站点地址 (默认 /dm265/en)", value: "auto" },
          { label: "English (/en)", value: "en" },
          { label: "简体中文 (/cn)", value: "cn" },
          { label: "繁體中文 (/zh)", value: "zh" },
          { label: "日本語 (/ja)", value: "ja" }
        ]
      },
      {
        key: "posterProxy",
        label: "封面图加载方式",
        type: "select",
        default: "direct",
        options: [
          { label: "直连原图 (fourhoi.com)", value: "direct" },
          { label: "公共图片加速 (wsrv.nl，免分流/防盗链)", value: "wsrv" },
          { label: "Jetpack 镜像代理 (i0.wp.com)", value: "wp" },
          { label: "自定义图片代理", value: "custom" }
        ]
      },
      {
        key: "customPosterProxy",
        label: "自定义图片代理地址",
        type: "url",
        placeholder: "例如 https://example.com/proxy?url=",
        showWhen: { key: "posterProxy", equals: "custom" }
      },
      {
        key: "quality",
        label: "优先画质",
        type: "select",
        default: "auto",
        options: [
          { label: "自动 (Master HLS)", value: "auto" },
          { label: "1080p 高清", value: "1080p" },
          { label: "720p 清晰", value: "720p" },
          { label: "480p 流畅", value: "480p" },
          { label: "360p 极速", value: "360p" }
        ]
      },
      {
        key: "cookie",
        label: "Cookie (可选，过 Cloudflare 验证)",
        type: "secret",
        maxLength: 4096
      },
      {
        key: "userAgent",
        label: "自定义 User-Agent (可选)",
        type: "text",
        maxLength: 512,
        placeholder: "留空使用默认 Chrome UA"
      },
      {
        key: "timeout",
        label: "请求超时秒数",
        type: "number",
        default: 18,
        min: 5,
        max: 60,
        step: 1
      }
    ]
  },

  async filters(ctx, req) {
    checkAborted(ctx);
    return [
      {
        key: "category",
        label: "分类",
        type: "select",
        default: "new",
        options: DEFAULT_CATEGORIES.map(item => ({
          label: item.label,
          value: item.value
        }))
      },
      {
        key: "sort",
        label: "排序",
        type: "select",
        default: "",
        options: SORT_OPTIONS.map(item => ({
          label: item.label,
          value: item.value
        }))
      }
    ];
  },

  async list(ctx, req) {
    const page = parsePageCursor(ctx, req ? req.cursor : null);
    const category =
      req && req.filters && req.filters.category
        ? String(req.filters.category).trim()
        : "new";
    const sort =
      req && req.filters && req.filters.sort
        ? String(req.filters.sort).trim()
        : "";

    if (category.length > 120 || /\.\.|[\s<>\\"']/.test(category)) {
      fail(ctx, "INVALID_RESPONSE", "分类参数无效");
    }

    const siteCfg = getSiteConfig(ctx);
    const refresh = Boolean(req && req.refresh);

    return readWithCache(
      ctx,
      "list",
      [siteCfg.baseUrl, category, sort, page],
      300,
      refresh,
      async () => {
        const url = buildListUrl(siteCfg, category, sort, page);
        let html = await fetchHtml(ctx, url, { notFoundAsEmpty: page > 1 });
        let items = html ? parseVideoCards(ctx, html, siteCfg.origin, siteCfg.lang) : [];

        // 若带 /dm265 前缀的某子分类返回空或 404，自动尝试页面内解析出的真实分类路径或标准语言路径 (如 /en/new)
        if (items.length === 0 && page === 1 && /^\/dm\d+\//i.test(siteCfg.basePath)) {
          const cachedCatPath = CATEGORY_PATH_CACHE.get(
            siteCfg.lang + ":" + category.toLowerCase()
          );
          if (cachedCatPath) {
            const cachedUrl = appendQueryParams(siteCfg.origin + cachedCatPath, sort, page);
            if (cachedUrl !== url) {
              const altHtml = await fetchHtml(ctx, cachedUrl, { notFoundAsEmpty: true });
              if (altHtml) {
                html = altHtml;
                items = parseVideoCards(ctx, html, siteCfg.origin, siteCfg.lang);
              }
            }
          }

          if (items.length === 0) {
            const fallbackBasePath = "/" + siteCfg.lang;
            const fallbackCfg = {
              origin: siteCfg.origin,
              basePath: fallbackBasePath,
              lang: siteCfg.lang,
              baseUrl: siteCfg.origin + fallbackBasePath
            };
            const fallbackUrl = appendQueryParams(
              fallbackCfg.baseUrl + "/" + category,
              sort,
              page
            );
            const fallbackHtml = await fetchHtml(ctx, fallbackUrl, { notFoundAsEmpty: true });
            if (fallbackHtml) {
              html = fallbackHtml;
              items = parseVideoCards(ctx, html, siteCfg.origin, siteCfg.lang);
            }
          }
        }

        if (!html || items.length === 0) {
          return { items: [], nextCursor: null };
        }

        const nextCursor = hasNextPage(html, page, items.length)
          ? String(page + 1)
          : null;

        return {
          items: items,
          nextCursor: nextCursor
        };
      }
    );
  },

  async search(ctx, req) {
    const query = String((req && req.query) || "").trim();
    if (!query) {
      return { items: [], nextCursor: null };
    }
    const page = parsePageCursor(ctx, req ? req.cursor : null);
    const siteCfg = getSiteConfig(ctx);
    const refresh = Boolean(req && req.refresh);

    return readWithCache(
      ctx,
      "search",
      [siteCfg.baseUrl, query, page],
      180,
      refresh,
      async () => {
        const searchUrl =
          siteCfg.baseUrl +
          "/search/" +
          encodeURIComponent(query) +
          (page > 1 ? "?page=" + encodeURIComponent(String(page)) : "");
        const html = await fetchHtml(ctx, searchUrl, { notFoundAsEmpty: page > 1 });
        if (!html) {
          return { items: [], nextCursor: null };
        }

        const items = parseVideoCards(ctx, html, siteCfg.origin, siteCfg.lang);
        const nextCursor = hasNextPage(html, page, items.length)
          ? String(page + 1)
          : null;

        return {
          items: items,
          nextCursor: nextCursor
        };
      }
    );
  },

  async detail(ctx, req) {
    const contentId = String((req && req.id) || "")
      .trim()
      .toLowerCase();
    if (!contentId || contentId.length > 240 || !/^[a-zA-Z0-9_-]+$/.test(contentId)) {
      fail(ctx, "NOT_FOUND", "内容不存在");
    }

    const siteCfg = getSiteConfig(ctx);
    const refresh = Boolean(req && req.refresh);

    return readWithCache(
      ctx,
      "detail",
      [siteCfg.baseUrl, contentId],
      120,
      refresh,
      async () => {
        const url = buildVideoPageUrl(siteCfg, contentId, refresh);
        let html = await fetchHtml(ctx, url, { notFoundAsEmpty: true });

        if (!html && /^\/dm\d+\//i.test(siteCfg.basePath)) {
          const altLangPath = "/" + siteCfg.lang;
          const altUrl =
            siteCfg.origin + altLangPath + "/" + encodeURIComponent(contentId);
          html = await fetchHtml(ctx, altUrl, { notFoundAsEmpty: false });
        } else if (!html) {
          fail(ctx, "NOT_FOUND", "请求的内容不存在");
        }

        return parseDetailMetadata(ctx, contentId, html, siteCfg.origin);
      }
    );
  },

  async play(ctx, req) {
    syncRuntimeState(ctx);
    checkAborted(ctx);

    const contentId = String((req && req.contentId) || "")
      .trim()
      .toLowerCase();
    const groupId = String((req && req.groupId) || "").trim();
    const episodeId = String((req && req.episodeId) || "").trim();

    if (!contentId || !/^[a-zA-Z0-9_-]+$/.test(contentId)) {
      fail(ctx, "NOT_FOUND", "内容不存在");
    }
    if (groupId !== "main" || episodeId !== "feature") {
      fail(ctx, "NOT_FOUND", "选集已变化，请重新打开详情");
    }

    const siteCfg = getSiteConfig(ctx);
    const refresh = Boolean(req && req.refresh);
    const targetUrl = buildVideoPageUrl(siteCfg, contentId, refresh);

    let html = await fetchHtml(ctx, targetUrl, { notFoundAsEmpty: true });
    if (!html && /^\/dm\d+\//i.test(siteCfg.basePath)) {
      const altLangPath = "/" + siteCfg.lang;
      const altUrl =
        siteCfg.origin + altLangPath + "/" + encodeURIComponent(contentId);
      html = await fetchHtml(ctx, altUrl, { notFoundAsEmpty: false });
    } else if (!html) {
      fail(ctx, "NOT_FOUND", "请求的内容不存在");
    }

    const streams = extractMissAvStreams(html);
    if (streams.length === 0) {
      return { sources: [] };
    }

    // 根据用户在设置中选择的优先画质重排 sources 顺序
    const preferredQuality =
      ctx && ctx.settings && ctx.settings.quality
        ? String(ctx.settings.quality)
        : "auto";
    streams.sort((a, b) => {
      const aScore = a.id === preferredQuality ? 1 : 0;
      const bScore = b.id === preferredQuality ? 1 : 0;
      return bScore - aScore;
    });

    const mediaHeaders = buildMediaHeaders(ctx, siteCfg.origin);
    const sources = streams.map(stream => ({
      id: stream.id,
      name: stream.name,
      url: stream.url,
      mime: "application/vnd.apple.mpegurl",
      headers: mediaHeaders,
      downloadable: true
    }));

    return {
      sources: sources
    };
  }
});

  return {impl:legacy,port:{defaultSite:DEFAULT_SITE_URL,categories:DEFAULT_CATEGORIES,sorts:SORT_OPTIONS,
    videoInfo:extractVideoIdAndPath,parseCards:parseVideoCards,parseDetail:parseDetailMetadata,streams:extractMissAvStreams,
    challenge:isCloudflareChallenge,config:getSiteConfig,prepare:syncRuntimeState,
    path:function(id){return VIDEO_PATH_CACHE.get(id);},seed:function(id,path){VIDEO_PATH_CACHE.set(id,path);},
    trim:function(){while(PAGE_CACHE.size>64)PAGE_CACHE.delete(PAGE_CACHE.keys().next().value);while(VIDEO_PATH_CACHE.size>512)VIDEO_PATH_CACHE.delete(VIDEO_PATH_CACHE.keys().next().value);}
  }};
}
var MA_ORIGINAL=createMissavSource();

/* Conflux适配：原稿的filters移为实例params；详情ref保存路径，不依赖跨请求内存。 */
function maPage(input) {
  var v=input&&input.page;if(v==null)return 1;
  if(typeof v==='object')v=v.page!=null?v.page:v.cursor;
  var n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>100000)maFail('invalid_params','分页信息无效，请重新打开列表。',false);
  return n;
}
function maChoice(value, options, fallback) {
  var v=value==null||value===''?fallback:String(value);
  for(var i=0;i<options.length;i++)if(options[i].value===v)return v;
  maFail('invalid_params','请选择有效的分类或排序。',false);
}
function maCategory(input) {
  return maChoice(input&&input.params&&input.params.category,MA_CATEGORIES,'new');
}
function maTitle(ctx,input) {
  var cat=maCategory(input),a=MA_CATEGORIES;
  for(var i=0;i<a.length;i++)if(a[i].value===cat)return 'MissAV · '+a[i].label;
  return 'MissAV';
}
function maRef(path) {return {source:'custom',id:'missav:'+path,mediaType:'movie'};}
function maOwned(ref) {
  if(!ref||ref.source!=='custom')return null;
  var raw=String(ref.id||'');if(raw.indexOf('missav:/')!==0)return null;
  var path=raw.slice(7);if(path.length>400||!/^[a-z0-9/_-]+$/i.test(path)||path.indexOf('//')>=0)return null;
  return MA_ORIGINAL.port.videoInfo(path,'');
}
function maContextForRef(ctx,ref) {
  var info=maOwned(ref);if(!info)return null;
  var c=maContext(ctx);MA_ORIGINAL.port.prepare(c);MA_ORIGINAL.port.seed(info.id,info.path);
  return {ctx:c,info:info};
}
function maItems(rows,ctx) {
  var out=[],seen={};MA_ORIGINAL.port.prepare(ctx);
  for(var i=0;i<(rows||[]).length;i++){
    var r=rows[i],path=MA_ORIGINAL.port.path(r.id),info=path&&MA_ORIGINAL.port.videoInfo(path,'');
    if(!info||seen[info.path])continue;seen[info.path]=true;
    var cover=String(r.poster||'');out.push({ref:maRef(info.path),title:String(r.title||r.id),subtitle:String(r.subtitle||''),intent:'detail',images:{poster:cover,backdrop:cover,cover:cover}});
  }
  MA_ORIGINAL.port.trim();return out;
}
function maContent(result,ctx) {
  var out={items:maItems(result&&result.items,ctx)},next=result&&result.nextCursor;
  if(next!=null){var n=Number(next);if(Number.isSafeInteger(n)&&n>1)out.next={type:'page',page:n};}
  return out;
}
async function maBrowse(ctx,input) {
  var c=maContext(ctx),page=maPage(input),params=input&&input.params||{};
  var cat=maCategory(input),sort=maChoice(params.sort,MA_ORIGINAL.port.sorts,'');
  var result=await MA_ORIGINAL.impl.list(c,{cursor:page>1?String(page):null,filters:{category:cat,sort:sort}});
  return maContent(result,c);
}
async function maList(ctx,input) {
  if(!input||!input.ref||input.ref.source!=='custom'||input.ref.id!=='missav:list')return {items:[]};
  return maBrowse(ctx,input);
}
async function maSearch(ctx,input) {
  var query=String(input&&input.query||'').trim();if(!query)return {items:[]};
  if(query.length>200||/[\x00-\x1f]/.test(query))maFail('invalid_params','搜索词过长或包含无效字符。',false);
  var c=maContext(ctx),page=maPage(input),result=await MA_ORIGINAL.impl.search(c,{query:query,cursor:page>1?String(page):null});
  return maContent(result,c);
}
async function maDetail(ctx,input) {
  var p=maContextForRef(ctx,input&&input.ref);if(!p)return null;
  var r;try{r=await MA_ORIGINAL.impl.detail(p.ctx,{id:p.info.id});}catch(e){if(e&&e.code==='not_found')return null;throw e;}
  if(!r||!r.title)return null;
  var cover=String(r.poster||''),text=String(r.summary||'');
  return {ref:maRef(p.info.path),title:String(r.title),images:{poster:cover,backdrop:cover,cover:cover,detailPoster:cover},overview:text,description:text};
}
function maVariants(text,base) {
  var lines=String(text||'').split(/\r?\n/),out=[],meta=null;
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();if(line.indexOf('#EXT-X-STREAM-INF:')===0){meta=line;continue;}
    if(!meta||!line||line.charAt(0)==='#')continue;
    var u=maRelative(line,base),height=(/RESOLUTION=\d+x(\d+)/i.exec(meta)||[])[1];
    if(maMediaURL(u)&&/\.m3u8(?:\?|$)/i.test(u))out.push({id:height?height+'p':'variant-'+out.length,name:height?height+'p':'HLS '+(out.length+1),url:u});
    meta=null;if(out.length>=12)break;
  }
  return out;
}
async function maPlayback(ctx,input) {
  var p=maContextForRef(ctx,input&&input.ref);if(!p)return [];
  var r=await MA_ORIGINAL.impl.play(p.ctx,{contentId:p.info.id,groupId:'main',episodeId:'feature'});
  var rows=(r&&r.sources||[]).filter(function(x){return maMediaURL(x.url);}),seen={},out=[];
  if(!rows.length)return [];
  var master=rows.find(function(x){return /playlist\.m3u8(?:\?|$)/i.test(x.url);});
  if(master){
    /* 与官方ddys测活边界一致：403/超时为unknown，不能因此挡住原生播放器。 */
    try {
      var res=await p.ctx.http.get(master.url,{headers:master.headers||{},timeoutMs:6000});
      if(res.status===200&&/^\s*#EXTM3U/.test(res.data))rows=rows.concat(maVariants(res.data,master.url).map(function(v){v.headers=master.headers;return v;}));
      else if(res.status===404||res.status===410)rows=rows.filter(function(v){return v.url!==master.url;});
      else if(ctx&&ctx.console&&ctx.console.warn)ctx.console.warn('HLS预探测未确认，保留页面原始线路供播放器加载。');
    } catch(e) {
      if(ctx&&ctx.console&&ctx.console.warn)ctx.console.warn('HLS预探测未完成，保留页面原始线路供播放器加载。');
    }
  }
  var prefer=String(p.ctx.settings.quality||'auto');rows.sort(function(a,b){return (b.id===prefer?1:0)-(a.id===prefer?1:0);});
  for(var i=0;i<rows.length;i++){
    var x=rows[i];if(seen[x.url])continue;seen[x.url]=true;
    var h={};Object.keys(x.headers||{}).forEach(function(k){if(k.toLowerCase()!=='cookie'&&k.toLowerCase()!=='authorization')h[k]=x.headers[k];});
    out.push({id:'missav-'+i+'-'+x.id,name:String(x.name||'HLS'),url:x.url,headers:h,player:'system',skipRedirectProbe:true});
  }
  return out;
}

var MA_CATEGORIES=[{label:"最近更新 (New)",value:"new"},{label:"新作上市 (Release)",value:"release"},{label:"中文字幕 (Chinese Sub)",value:"chinese-subtitle"},{label:"英文字幕 (English Sub)",value:"english-subtitle"},{label:"无码流出 (Uncensored Leak)",value:"uncensored-leak"},{label:"今日热门 (Today Hot)",value:"today-hot"},{label:"本周热门 (Weekly Hot)",value:"weekly-hot"},{label:"本月热门 (Monthly Hot)",value:"monthly-hot"},{label:"SIRO (素人)",value:"siro"},{label:"LUXU (ラグジュTV)",value:"luxu"},{label:"GANA (ナンパTV)",value:"gana"},{label:"S-CUTE",value:"scute"},{label:"ARA (俺の素人)",value:"ara"},{label:"FC2",value:"fc2"},{label:"麻豆传媒 (Madou)",value:"madou"}];
definePackage({id:"conflux.missav",icon:"https://missav.live/favicon.ico",title:"MissAV",version:"1.0.0",engine:1,description:"Webox脚本移植：分类与排序参数、搜索、详情及实际HLS线路；不需要个人Worker。",permissions:{network:["https://","https://missav.live","https://surrit.com"]},settings:[{name:"site",title:"站点地址",type:"text",default:"https://missav.live/dm265/en",description:"沿用原稿地址；站点验证通过后使用，支持更换HTTPS地址。"},{name:"lang",title:"语言路径",type:"select",default:"auto",options:[{title:"跟随站点地址",value:"auto"},{title:"English",value:"en"},{title:"简体中文",value:"cn"},{title:"繁體中文",value:"zh"},{title:"日本語",value:"ja"}]},{name:"posterProxy",title:"封面加载方式",type:"select",default:"direct",options:[{title:"直连原图（默认）",value:"direct"},{title:"wsrv.nl（图片URL会交给第三方）",value:"wsrv"},{title:"i0.wp.com（图片URL会交给第三方）",value:"wp"},{title:"自定义图片代理",value:"custom"}]},{name:"customPosterProxy",title:"自定义图片代理地址",type:"text",default:"",visibleWhen:{field:"posterProxy",in:["custom"]}},{name:"quality",title:"优先画质",type:"select",default:"auto",description:"只排序实际存在的线路，不补造清晰度。",options:[{title:"自动",value:"auto"},{title:"1080p",value:"1080p"},{title:"720p",value:"720p"},{title:"480p",value:"480p"},{title:"360p",value:"360p"}]},{name:"cookie",title:"站点 Cookie（选填）",type:"text",default:"",description:"验证后使用；只发给配置的站点，不发媒体CDN。Conflux文本设置不等同密钥库，请勿分享。"},{name:"userAgent",title:"User-Agent（选填）",type:"text",default:"",description:"留空沿用原稿Chrome UA；验证Cookie需匹配完成验证时的UA。"},{name:"timeout",title:"请求超时（秒）",type:"number",default:18,description:"原稿范围5–60；仍受Conflux请求上限及本包20秒上限限制。"}],extensions:[{type:"widget",id:"browse",title:"MissAV",description:"原稿分类与排序均可在小组件参数中选择。",template:"backdrop-rail",families:["extraLarge"],headerIntent:"list",ref:{source:"custom",id:"missav:list"},params:[{name:"category",title:"分类",type:"select",default:"new",options:[{title:"最近更新 (New)",value:"new"},{title:"新作上市 (Release)",value:"release"},{title:"中文字幕 (Chinese Sub)",value:"chinese-subtitle"},{title:"英文字幕 (English Sub)",value:"english-subtitle"},{title:"无码流出 (Uncensored Leak)",value:"uncensored-leak"},{title:"今日热门 (Today Hot)",value:"today-hot"},{title:"本周热门 (Weekly Hot)",value:"weekly-hot"},{title:"本月热门 (Monthly Hot)",value:"monthly-hot"},{title:"SIRO (素人)",value:"siro"},{title:"LUXU (ラグジュTV)",value:"luxu"},{title:"GANA (ナンパTV)",value:"gana"},{title:"S-CUTE",value:"scute"},{title:"ARA (俺の素人)",value:"ara"},{title:"FC2",value:"fc2"},{title:"麻豆传媒 (Madou)",value:"madou"}]},{name:"sort",title:"排序",type:"select",default:"",options:[{title:"默认排序",value:""},{title:"发行日期",value:"released_at"},{title:"最近更新",value:"published_at"},{title:"今日浏览",value:"today_views"},{title:"本周浏览",value:"weekly_views"},{title:"本月浏览",value:"monthly_views"},{title:"总浏览数",value:"views"},{title:"收藏数",value:"saved"}]}],cache:{ttlSeconds:300},placeholderData:{items:[{ref:{source:"custom",id:"missav:/dm265/en/sample-000",mediaType:"movie"},title:"MissAV",subtitle:"选择分类后加载",intent:"detail"}]},resolveTitle:maTitle,load:maBrowse},
{type:"list",id:"list",title:"MissAV列表",style:"backdrop-grid",accepts:{sources:["custom"]},search:{id:"search"},cache:{ttlSeconds:300},load:maList},
{type:"search",id:"search",title:"MissAV搜索",cache:{ttlSeconds:180},search:maSearch},
{type:"detail",id:"detail",title:"MissAV详情",accepts:{sources:["custom"]},cache:{ttlSeconds:120},load:maDetail},
{type:"playback",id:"playback",title:"MissAV HLS",accepts:{sources:["custom"]},cache:{ttlSeconds:0},sources:maPlayback}]});
