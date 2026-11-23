// Destiny TV（tvfans.top）Conflux Extension
//
// 移植来源：Webox 原生源 shared-D95623F7_DestinyTV.webox.js 1.0.0（单文件、只解析数据、不执行网页 JS）。
// 站点是 React Router 7 的 SSR 页面，影片数据不在 DOM 里，而是以
//   streamController.enqueue("<turbo-stream 数据块>") 的形式内联在 HTML；
// 数据块拼接后第一行是扁平「表」，其余行是引用索引（对象键 "_1" 表示第 1 条字符串）。
// 本包内置纯 JS 解码器（含循环/深度/越界防护），不 eval、不依赖宿主 DOM。
//
// 站点路由（实证 2026-11-22）：
// - 首页            GET /                            → loaderData["routes/home"].home
//                     {banner, hot, latest, sections[{type:{id,name}, children, list}]}
// - 分类/片库       GET /vod/type?by=&class=&year=&area=&page=
//                   GET /vod/type/{typeId}?...        → loaderData["routes/vod-type"].list
//                     list = {page, pageCount, pageSize, list[]}
// - 搜索            GET /search?wd=&mid=1&page=       → loaderData["search"].result.vod {total, list[]}
// - 详情            GET /vod/detail/{id}              → loaderData["routes/vod-detail"].vod（含 playList，只有选集名/编号，无 url）
// - 播放数据        GET /api/vod/{id}/play            → v1 加密信封 {k,iv,d,t}（X-Enc:1），v2 为 ECDH（X-Enc-V:2，本包不支持）
//                     k 用 /api/crypto/public-key 的 RSA 公钥做 PKCS#1 v1.5 解出 32 字节 AES-256 密钥，
//                     再用 AES-256-GCM 解 d+t（iv 12 字节）得到 {vod, playList[{from,sid,player,episodes[{nid,url}]}], access}
// - 公钥            GET /api/crypto/public-key        → {publicKey: PEM, enabled, v2, handshake}
//
// 加密全部在包内用纯 JS 实现（AES 核心取自已在真机长期运行的瓜子 GxCrypto，新增 CTR+GHASH；
// RSA 为 BigInt 模幂 + PKCS#1 v1.5 去填充），不依赖 WebCrypto / 宿主 crypto。
//
// 条目 ref 约定（source 统一 "custom"）：
// - 影片：id = "vod:<vodId>"，mediaType = movie|tv
// - 选集：id = "play:<vodId>:<encodeURIComponent(from)>:<nid>"，mediaType = "tv"
//   playback 两种都认；只给 "vod:" 时用顶层 season（线路序号）/ episode（该线路内第几集）。

var SITE = "https://www.tvfans.top";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
var DEFAULT_TIMEOUT_SECONDS = 18;
var REQUEST_TIMEOUT_MS = 18000;
var MAX_TEXT_LENGTH = 12 * 1024 * 1024;
var HOME_TTL_MS = 300 * 1000;
var PLAY_TTL_MS = 60 * 1000;
var KEY_TTL_MS = 3600 * 1000;

// 站方真实栏目（home.sections / 片库下拉的 typeId 与名称，实证 2026-11-22）
var TYPES = [
  { id: "1", name: "电影", children: [["2", "动作片"], ["3", "喜剧片"], ["4", "科幻片"], ["5", "恐怖片"], ["29", "爱情片"], ["30", "剧情片"], ["31", "战争片"], ["32", "纪录片"], ["33", "动画片"]] },
  { id: "6", name: "电视剧", children: [["7", "国产剧"], ["8", "港台剧"], ["9", "日韩剧"], ["10", "欧美剧"], ["26", "海外剧"], ["27", "泰国剧"]] },
  { id: "11", name: "综艺", children: [["12", "大陆综艺"], ["13", "港台综艺"], ["14", "日韩综艺"], ["28", "欧美综艺"]] },
  { id: "15", name: "动漫", children: [["16", "国产动漫"], ["25", "港台动漫"], ["17", "日韩动漫"], ["18", "欧美动漫"], ["24", "海外动漫"]] },
  { id: "34", name: "短剧", children: [["35", "都市脑洞"], ["36", "古装仙侠"], ["37", "反转爽文"], ["38", "重生民国"], ["39", "穿越年代"], ["40", "现代言情"], ["41", "闪婚离婚"], ["42", "女恋总裁"]] }
];

// list.tabs：全部影视 + 5 个主栏目 + 32 个子栏目（每个都是站方真实页面）
var BROWSE_TABS = (function () {
  var tabs = [{ id: "all", title: "全部影视" }];
  // 先放 5 个主栏目（首屏可达），再按栏目分组列出 32 个真实子栏目。
  TYPES.forEach(function (type) {
    tabs.push({ id: type.id, title: type.name });
  });
  TYPES.forEach(function (type) {
    type.children.forEach(function (child) {
      tabs.push({ id: child[0], title: type.name + "·" + child[1] });
    });
  });
  return tabs;
})();

function tabExists(id) {
  for (var i = 0; i < BROWSE_TABS.length; i++) if (BROWSE_TABS[i].id === id) return true;
  return false;
}

function fail(code, message, retryable) {
  throw ExtensionError({ code: code, message: message, retryable: !!retryable });
}

function textOf(value) {
  return typeof value === "string" ? value : "";
}

function trimText(value) {
  return String(value == null ? "" : value).trim();
}

function headerValue(headers, name) {
  var wanted = String(name).toLowerCase();
  var keys = Object.keys(headers || {});
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) return String(headers[keys[i]]);
  }
  return "";
}

// 只接受 https 且带主机的地址；站方 CDN 与播放域名都在 https 上。
function safeURL(value, base) {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\\\x00-\x20]/.test(value)) return "";
  var absolute;
  if (/^https:\/\//i.test(value)) absolute = value;
  else if (/^\/\//.test(value)) absolute = "https:" + value;
  else if (/^\//.test(value) && base) absolute = base.replace(/\/+$/, "") + value;
  else return "";
  if (!/^https:\/\/[^/?#@\s]+(?:[/?#][^\\\s]*)?$/i.test(absolute)) return "";
  return absolute;
}

function originOf(url) {
  var match = /^(https:\/\/[^/?#@\s]+)/i.exec(String(url || ""));
  return match ? match[1].toLowerCase() : "";
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      var code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, function (_, dec) {
      var code = parseInt(dec, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

// 详情简介是站方 HTML 富文本；宿主不保证有 ctx.html，这里用纯 JS 去标签。
function stripHTML(text) {
  var html = textOf(text);
  if (!html) return "";
  html = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  html = html.replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/<\/(p|div|li)>/gi, "\n");
  html = html.replace(/<[^>]*>/g, " ");
  return decodeEntities(html).replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function splitNames(value) {
  var raw = textOf(value);
  if (!raw) return [];
  var seen = {};
  var out = [];
  raw.split(/[,，、/|]/).forEach(function (part) {
    var name = trimText(part);
    if (!name || name.length > 60 || seen[name]) return;
    seen[name] = true;
    out.push(name);
  });
  return out;
}
// ========== Base64 / 十六进制 / UTF-8（纯 JS，不依赖 atob/TextDecoder） ==========

var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(text) {
  var s = String(text == null ? "" : text);
  if (!s || s.length > 4 * 1024 * 1024) throw new Error("Invalid Base64");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new Error("Invalid Base64");
  var out = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === "=") break;
    buffer = (buffer << 6) | B64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return out;
}

function bytesToHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return out;
}

function utf8Decode(bytes) {
  var out = "";
  var i = 0;
  while (i < bytes.length) {
    var a = bytes[i++];
    var code;
    if (a < 0x80) code = a;
    else if (a >= 0xf0) code = ((a & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else if (a >= 0xe0) code = ((a & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else if (a >= 0xc0) code = ((a & 31) << 6) | (bytes[i++] & 63);
    else code = 0xfffd;
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

// ========== AES-256（GCM 只需要加密方向）+ GHASH ==========
// AES 核心（SBOX 生成 / expandKey / encryptBlock）整段取自已在真机长期运行的瓜子 GxCrypto，
// 只是不再需要 CBC 模式；GCM 的 CTR 与 GHASH 是本包新增。

var AES_SBOX = new Array(256);
var AES_INV_SBOX = new Array(256);
(function () {
  var p = 1;
  var q = 1;
  do {
    p = p ^ ((p << 1) & 255) ^ (p & 128 ? 0x1b : 0);
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 255;
    if (q & 128) q ^= 0x09;
    var x = q ^ ((q << 1 | q >> 7) & 255) ^ ((q << 2 | q >> 6) & 255) ^ ((q << 3 | q >> 5) & 255) ^ ((q << 4 | q >> 4) & 255) ^ 0x63;
    AES_SBOX[p] = x;
    AES_INV_SBOX[x] = p;
  } while (p !== 1);
  AES_SBOX[0] = 0x63;
  AES_INV_SBOX[0x63] = 0;
})();

function aesXtime(a) {
  return ((a << 1) ^ (a & 128 ? 0x1b : 0)) & 255;
}

function aesExpandKey(key) {
  var nk = key.length >> 2;
  var rounds = nk + 6;
  var words = key.slice();
  var rcon = 1;
  var total = 4 * (rounds + 1);
  for (var i = nk; i < total; i++) {
    var t = words.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) {
      t = [AES_SBOX[t[1]] ^ rcon, AES_SBOX[t[2]], AES_SBOX[t[3]], AES_SBOX[t[0]]];
      rcon = aesXtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      t = [AES_SBOX[t[0]], AES_SBOX[t[1]], AES_SBOX[t[2]], AES_SBOX[t[3]]];
    }
    for (var j = 0; j < 4; j++) words.push(words[(i - nk) * 4 + j] ^ t[j]);
  }
  return { words: words, rounds: rounds };
}

function aesEncryptBlock(block, schedule) {
  var words = schedule.words;
  var rounds = schedule.rounds;
  var s = block.slice();
  var i;
  for (i = 0; i < 16; i++) s[i] ^= words[i];
  for (var r = 1; r <= rounds; r++) {
    for (i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
    var t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
    if (r < rounds) {
      for (var c = 0; c < 16; c += 4) {
        var a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
        var x = a0 ^ a1 ^ a2 ^ a3;
        s[c] ^= x ^ aesXtime(a0 ^ a1);
        s[c + 1] ^= x ^ aesXtime(a1 ^ a2);
        s[c + 2] ^= x ^ aesXtime(a2 ^ a3);
        s[c + 3] ^= x ^ aesXtime(a3 ^ a0);
      }
    }
    for (i = 0; i < 16; i++) s[i] ^= words[r * 16 + i];
  }
  return s;
}

// GF(2^128) 乘法（GCM 的 GHASH 用，按位实现，够 4MB 以内的短包用）
function ghashMultiply(x, y) {
  var z = new Array(16);
  var v = y.slice();
  var i, j;
  for (i = 0; i < 16; i++) z[i] = 0;
  for (i = 0; i < 128; i++) {
    if ((x[i >> 3] >> (7 - (i & 7))) & 1) {
      for (j = 0; j < 16; j++) z[j] ^= v[j];
    }
    var carry = v[15] & 1;
    for (j = 15; j > 0; j--) v[j] = ((v[j] >> 1) | ((v[j - 1] & 1) << 7)) & 255;
    v[0] = (v[0] >> 1) & 255;
    if (carry) v[0] ^= 0xe1;
  }
  return z;
}

function ghashBlocks(hashKey, data) {
  var y = new Array(16);
  var i, j;
  for (i = 0; i < 16; i++) y[i] = 0;
  for (var offset = 0; offset < data.length; offset += 16) {
    for (j = 0; j < 16; j++) y[j] ^= offset + j < data.length ? data[offset + j] : 0;
    y = ghashMultiply(y, hashKey);
  }
  return y;
}

function aesGcmDecrypt(cipher, keyBytes, ivBytes, tagBytes) {
  if (keyBytes.length !== 32) throw new Error("Invalid AES-256 key");
  if (ivBytes.length !== 12) throw new Error("Unsupported GCM IV length");
  if (tagBytes.length !== 16) throw new Error("Invalid GCM tag length");
  if (cipher.length > 2 * 1024 * 1024) throw new Error("GCM payload too large");
  var schedule = aesExpandKey(keyBytes);
  var zero = new Array(16);
  var i;
  for (i = 0; i < 16; i++) zero[i] = 0;
  var hashKey = aesEncryptBlock(zero, schedule);
  var j0 = [ivBytes[0], ivBytes[1], ivBytes[2], ivBytes[3], ivBytes[4], ivBytes[5], ivBytes[6], ivBytes[7],
    ivBytes[8], ivBytes[9], ivBytes[10], ivBytes[11], 0, 0, 0, 1];
  var s = ghashBlocks(hashKey, cipher);
  var lengthBlock = new Array(16);
  for (i = 0; i < 16; i++) lengthBlock[i] = 0;
  var cipherBits = cipher.length * 8;
  var hi = Math.floor(cipherBits / 4294967296);
  var lo = cipherBits % 4294967296;
  lengthBlock[8] = (hi >>> 24) & 255; lengthBlock[9] = (hi >>> 16) & 255;
  lengthBlock[10] = (hi >>> 8) & 255; lengthBlock[11] = hi & 255;
  lengthBlock[12] = (lo >>> 24) & 255; lengthBlock[13] = (lo >>> 16) & 255;
  lengthBlock[14] = (lo >>> 8) & 255; lengthBlock[15] = lo & 255;
  for (i = 0; i < 16; i++) s[i] ^= lengthBlock[i];
  s = ghashMultiply(s, hashKey);
  var mask = aesEncryptBlock(j0, schedule);
  var diff = 0;
  for (i = 0; i < 16; i++) diff |= (s[i] ^ mask[i]) ^ tagBytes[i];
  if (diff !== 0) throw new Error("GCM authentication failed");
  var counter = j0.slice();
  var plain = [];
  for (var offset = 0; offset < cipher.length; offset += 16) {
    counter[15] = (counter[15] + 1) & 255;
    if (counter[15] === 0) {
      counter[14] = (counter[14] + 1) & 255;
      if (counter[14] === 0) {
        counter[13] = (counter[13] + 1) & 255;
        if (counter[13] === 0) counter[12] = (counter[12] + 1) & 255;
      }
    }
    var stream = aesEncryptBlock(counter, schedule);
    var take = Math.min(16, cipher.length - offset);
    for (var j = 0; j < take; j++) plain.push(cipher[offset + j] ^ stream[j]);
  }
  return plain;
}

// ========== RSA（公钥还原 PKCS#1 v1.5 封装，BigInt 模幂） ==========
// 站点 v1 协议：服务端用「RSA 公钥」加密 AES-256 密钥（k），客户端用同一公钥做模幂即可还原明文块。
// 这不是私钥解密接口，纯 JS 足够，无需宿主 crypto。

function rsaBigInt(hex) {
  return BigInt("0x" + hex);
}

function rsaPublicFromPem(pem) {
  if (typeof pem !== "string" || pem.length > 8192) throw new Error("Invalid public key");
  var match = /^-----BEGIN PUBLIC KEY-----([\s\S]+)-----END PUBLIC KEY-----\s*$/.exec(pem);
  if (!match) throw new Error("Invalid public key");
  var der = base64ToBytes(match[1].replace(/\s+/g, ""));
  function readTLV(position, limit, tag) {
    if (position + 2 > limit || der[position] !== tag) throw new Error("Invalid DER tag");
    position += 1;
    var size = der[position];
    position += 1;
    if (size & 128) {
      var count = size & 127;
      if (!count || count > 4 || position + count > limit) throw new Error("Invalid DER length");
      size = 0;
      for (var i = 0; i < count; i++) size = size * 256 + der[position++];
    }
    if (position + size > limit) throw new Error("Truncated DER");
    return { start: position, end: position + size };
  }
  var outer = readTLV(0, der.length, 48);
  if (outer.end !== der.length) throw new Error("Invalid SPKI");
  var algorithm = readTLV(outer.start, outer.end, 48);
  var algorithmOid = bytesToHex(der.slice(algorithm.start, algorithm.end));
  if (algorithmOid !== "06092a864886f70d0101010500") throw new Error("Not an RSA public key");
  var bits = readTLV(algorithm.end, outer.end, 3);
  if (bits.end !== outer.end || der[bits.start] !== 0) throw new Error("Invalid SPKI bits");
  var sequence = readTLV(bits.start + 1, bits.end, 48);
  var modulus = readTLV(sequence.start, sequence.end, 2);
  var exponent = readTLV(modulus.end, sequence.end, 2);
  if (sequence.end !== bits.end || exponent.end !== sequence.end) throw new Error("Invalid RSA integers");
  if (modulus.start === modulus.end || exponent.start === exponent.end) throw new Error("Invalid RSA integers");
  if (der[modulus.start] & 128 || der[exponent.start] & 128) throw new Error("Negative RSA integer");
  var n = rsaBigInt(bytesToHex(der.slice(modulus.start, modulus.end)));
  var e = rsaBigInt(bytesToHex(der.slice(exponent.start, exponent.end)));
  var length = Math.ceil(n.toString(16).length / 2);
  if (length < 128 || length > 512) throw new Error("Unsupported RSA size");
  if (e < BigInt(3) || e > BigInt(4294967295) || !(e & BigInt(1))) throw new Error("Unsupported RSA exponent");
  return { n: n, e: e, length: length, pem: pem };
}

function rsaModPow(base, exponent, modulus) {
  var result = BigInt(1);
  var b = base % modulus;
  var e = exponent;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= BigInt(1);
  }
  return result;
}

// 返回 32 字节 AES 密钥（十六进制字符串）；失败抛 Error，由调用方转成 ExtensionError。
function rsaUnwrapAesKey(encoded, key) {
  var bytes = base64ToBytes(encoded);
  if (bytes.length !== key.length) throw new Error("Invalid RSA block size");
  var base = rsaBigInt(bytesToHex(bytes));
  if (base >= key.n) throw new Error("RSA block out of range");
  var plain = rsaModPow(base, key.e, key.n);
  var hex = plain.toString(16);
  if (hex.length > key.length * 2) throw new Error("Invalid RSA payload");
  while (hex.length < key.length * 2) hex = "0" + hex;
  var block = [];
  for (var i = 0; i < key.length; i++) block.push(parseInt(hex.substr(i * 2, 2), 16));
  if (block[0] !== 0 || (block[1] !== 1 && block[1] !== 2)) throw new Error("Invalid RSA padding");
  var end = 2;
  while (end < block.length && block[end] !== 0) {
    if (block[1] === 1 && block[end] !== 255) throw new Error("Invalid RSA padding bytes");
    end++;
  }
  if (end < 10 || block.length - end - 1 !== 32) throw new Error("Invalid AES key size");
  return bytesToHex(block.slice(end + 1));
}
// ========== React Router SSR 数据块解码（turbo-stream 扁平表） ==========
// 网页把数据写成 streamController.enqueue("<JSON 字符串>") 的若干块：
//   第一行是「表」（数组，元素可为值或引用索引），后续行是字符串分片。
// 对象用 {"_1": 2} 表示字段名指向表内第 1 条（字符串）；-1 / -5 表示 null；
// ["D", "..."] 表示日期。这里逐层解引用，带深度、越界与循环防护；不 eval。

function badPage(message) {
  fail("internal", message + "（网站结构可能已变化，请等待扩展更新）", false);
}

function decodeStreamTable(html) {
  var marker = "streamController.enqueue(";
  var chunks = [];
  var position = 0;
  var limit = html.length;
  while (true) {
    var at = html.indexOf(marker, position);
    if (at < 0) break;
    var start = at + marker.length;
    while (start < limit) {
      var pad = html.charAt(start);
      if (pad !== " " && pad !== "\t" && pad !== "\n" && pad !== "\r") break;
      start++;
    }
    if (html.charAt(start) !== "\"") badPage("网页数据不是可读取的 JSON 字符串");
    var end = start + 1;
    while (end < limit) {
      var ch = html.charAt(end);
      if (ch === "\\") end += 2;
      else if (ch === "\"") break;
      else end++;
    }
    if (end >= limit) badPage("网页数据不完整");
    var chunk;
    try {
      chunk = JSON.parse(html.slice(start, end + 1));
    } catch (error) {
      badPage("网页数据块无法解析");
    }
    if (typeof chunk !== "string") badPage("网页数据块类型无效");
    chunks.push(chunk);
    position = end + 1;
  }
  if (!chunks.length) badPage("未找到影片数据");
  var firstLine = chunks.join("").split("\n")[0];
  var table;
  try {
    table = JSON.parse(firstLine);
  } catch (error) {
    badPage("网页数据表无法解析");
  }
  if (!Array.isArray(table) || !table.length || table.length > 100000) badPage("网页数据表无效");
  return table;
}

function resolveStreamTable(table) {
  var cache = {};
  var active = {};
  var visited = 0;
  function read(index, depth) {
    visited++;
    if (visited > 400000) badPage("网页数据引用过多");
    if (!Number.isInteger(index) || depth > 100) badPage("网页数据引用无效");
    if (index === -1 || index === -5) return null;
    if (index < 0 || index >= table.length || active[index]) badPage("网页数据引用越界或循环");
    if (Object.prototype.hasOwnProperty.call(cache, index)) return cache[index];
    var value = table[index];
    if (value === null || typeof value !== "object") {
      if (typeof value === "number" && !Number.isFinite(value)) badPage("网页数据包含无效数值");
      return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
      if (value[0] === "D") {
        var date = new Date(value[1]);
        if (!Number.isFinite(date.getTime())) badPage("网页日期格式无效");
        return date.toISOString();
      }
      badPage("网页使用了尚未支持的数据编码");
    }
    active[index] = true;
    var result;
    var i;
    if (Array.isArray(value)) {
      result = [];
      for (i = 0; i < value.length; i++) result.push(read(value[i], depth + 1));
    } else {
      result = {};
      var keys = Object.keys(value);
      for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!/^_\d+$/.test(key)) badPage("网页对象引用无效");
        var name = read(Number(key.slice(1)), depth + 1);
        if (typeof name !== "string" || name === "__proto__" || name === "constructor" || name === "prototype") badPage("网页对象字段无效");
        result[name] = read(value[key], depth + 1);
      }
    }
    delete active[index];
    cache[index] = result;
    return result;
  }
  return read(0, 0);
}

function loaderDataOf(html) {
  var data = resolveStreamTable(decodeStreamTable(html));
  if (!data || !data.loaderData || data.errors) badPage("网页页面加载失败");
  var loaders = data.loaderData;
  if (typeof loaders !== "object") badPage("网页页面数据缺失");
  return loaders;
}

// 路由键（routes/home 等）属于站点内部标识，允许按末段兜底匹配，降低改名风险。
function routeOf(loaders, name) {
  if (loaders[name] && typeof loaders[name] === "object") return loaders[name];
  var tail = name.split("/").pop();
  var keys = Object.keys(loaders);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].split("/").pop() === tail && loaders[keys[i]] && typeof loaders[keys[i]] === "object") return loaders[keys[i]];
  }
  return null;
}

// ========== HTTP ==========

function requestTimeout(ctx) {
  var raw = ctx && ctx.settings ? ctx.settings.timeoutSeconds : null;
  var seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 30) seconds = DEFAULT_TIMEOUT_SECONDS;
  return Math.round(seconds * 1000);
}


// 宿主对 res.data 的类型未作承诺（文档只写"未限定"）：字符串、字节、已解析对象都接。
function textOfData(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  var i;
  if (typeof ArrayBuffer !== "undefined" && typeof ArrayBuffer.isView === "function" && ArrayBuffer.isView(value)) {
    var bytes = [];
    for (i = 0; i < value.length; i++) bytes.push(value[i] & 255);
    return utf8Decode(bytes);
  }
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
    var view = new Uint8Array(value);
    var copy = [];
    for (i = 0; i < view.length; i++) copy.push(view[i]);
    return utf8Decode(copy);
  }
  if (Array.isArray(value)) {
    var allNumbers = value.length > 0;
    for (i = 0; i < value.length && i < 64; i++) {
      if (typeof value[i] !== "number") { allNumbers = false; break; }
    }
    if (allNumbers) return utf8Decode(value);
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return "";
  }
}

function jsonOf(response) {
  var data = response ? response.data : null;
  if (data && typeof data === "object" && !Array.isArray(data) && !(typeof ArrayBuffer !== "undefined" && (data instanceof ArrayBuffer || ArrayBuffer.isView(data)))) return data;
  var text = textOfData(data);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function request(ctx, path, query) {
  var url = SITE + path;
  var response;
  async function send() {
    return ctx.http.get(url, {
      query: query || {},
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": SITE + "/",
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5"
      },
      timeoutMs: requestTimeout(ctx)
    });
  }
  try {
    response = await send();
  } catch (error) {
    if (error && error.code) throw error;
    // 站点偶发丢包：网络层失败再试一次，状态码类错误不重试
    try {
      response = await send();
    } catch (retryError) {
      if (retryError && retryError.code) throw retryError;
      fail("unavailable", "连接 Destiny TV 失败，请检查网络后重试", true);
    }
  }
  var status = response && typeof response.status === "number" ? response.status : 0;
  var headers = response && response.headers ? response.headers : {};
  var text = textOfData(response ? response.data : null);
  if (text && text.length > MAX_TEXT_LENGTH) fail("internal", "网站返回内容异常过大", false);
  if (status === 429) {
    var retryAfter = headerValue(headers, "Retry-After");
    var seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0;
    fail("rate_limited", "网站请求过于频繁，请稍后重试", true);
  }
  if (status === 401 || status === 403 ||
    /<title>\s*(?:Just a moment|Attention Required|人机验证|安全验证)/i.test(text.slice(0, 4000)) ||
    /_cf_chl_opt/.test(text.slice(0, 4000))) {
    fail("unavailable", "网站要求人机验证或登录，请稍后重试", true);
  }
  if (status === 404) fail("not_found", "内容或接口不存在", false);
  if (status < 200 || status >= 300) fail("unavailable", "网站请求失败（HTTP " + status + "）", true);
  if (!text) fail("unavailable", "网站返回了空响应", true);
  var finalURL = response && typeof response.url === "string" ? response.url : "";
  if (finalURL && originOf(finalURL) && originOf(finalURL) !== originOf(SITE)) {
    fail("internal", "网站跳转到其他域名，已停止处理", false);
  }
  return { status: status, headers: headers, text: text, data: response ? response.data : null };
}

async function routeData(ctx, path, query, routeName) {
  var response = await request(ctx, path, query);
  var loaders = loaderDataOf(response.text);
  var value = routeOf(loaders, routeName);
  if (!value) badPage("影片页面数据缺失");
  return value;
}

// 「全部影视」页面的路由键是 routes/vod-library，分类页是 routes/vod-type，两者 list 结构相同。
async function browseRoute(ctx, path, query) {
  var response = await request(ctx, path, query);
  var loaders = loaderDataOf(response.text);
  var value = routeOf(loaders, "routes/vod-library") || routeOf(loaders, "routes/vod-type");
  if (!value || !value.list) badPage("片库页面数据缺失");
  return value;
}

// ========== 进程内缓存（不用 ctx.storage：本设备历史 widget storage 曾崩；扩展级缓存已覆盖大部分） ==========

var HOME_CACHE = { ts: 0, value: null, pending: null };
var PLAY_CACHE = {};
var KEY_CACHE = { ts: 0, value: null, pem: "" };

// 首页数据被 8 个组件共用：同一时刻的并发 load 只发一次请求，其余等同一个 Promise。
async function loadHomeData(ctx) {
  if (HOME_CACHE.value && Date.now() - HOME_CACHE.ts < HOME_TTL_MS) return HOME_CACHE.value;
  if (HOME_CACHE.pending) return HOME_CACHE.pending;
  var pending = (async function () {
    var route = await routeData(ctx, "/", {}, "routes/home");
    var home = route.home;
    if (!home || !Array.isArray(home.sections)) badPage("首页栏目数据无效");
    HOME_CACHE = { ts: Date.now(), value: home, pending: null };
    return home;
  })();
  HOME_CACHE = { ts: HOME_CACHE.ts, value: HOME_CACHE.value, pending: pending };
  try {
    return await pending;
  } catch (error) {
    HOME_CACHE.pending = null;
    throw error;
  }
}
// ========== 影片 / 选集映射 ==========

function vodId(value) {
  var id = String(value == null ? "" : value);
  if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) return "";
  return id;
}

// 解析 ref.id：vod:<id> 或 play:<id>:<from>:<nid>；纯数字 id 也兼容。
function parseRef(ref) {
  var id = ref && typeof ref.id === "string" ? trimText(ref.id) : "";
  var out = { vodId: "", from: "", nid: "" };
  if (!id || id.length > 512) return out;
  var match = /^vod:([1-9]\d{0,14})$/.exec(id);
  if (match) {
    out.vodId = match[1];
    return out;
  }
  match = /^play:([1-9]\d{0,14}):([^:]+):([1-9]\d{0,9})$/.exec(id);
  if (match) {
    out.vodId = match[1];
    out.nid = match[3];
    try {
      out.from = decodeURIComponent(match[2]);
    } catch (error) {
      out.from = "";
    }
    return out;
  }
  if (/^[1-9]\d{0,14}$/.test(id)) out.vodId = id;
  return out;
}

function mediaTypeOf(vod, multiEpisode) {
  var main = Number(vod && (vod.typeId1 != null ? vod.typeId1 : vod.typeId));
  if (main === 6 || main === 11 || main === 15 || main === 34) return "tv";
  if (main === 1) {
    // 电影栏目同一条线路里的多条 play 是「版本」（英语 / HDTC中字 / HD中字），不是剧集；
    // 只有纪录片子类（typeId 32）是按集更新的节目。用户实证：街头霸王2026(700) 被渲染成第1季/Episode 1-2。
    // 分集不能只看当前已上架集数：守护解放西·传承季(120978) total=10 但只上架 1 集，
    // 旧逻辑会判成电影；这里改用站方声明的 total/serial，单集纪录片（total=1）仍按电影。
    if (Number(vod && vod.typeId) === 32) {
      var total = Number(vod && vod.total);
      var serial = Number(vod && vod.serial);
      if (multiEpisode || (Number.isFinite(total) && total > 1) || (Number.isFinite(serial) && serial > 1)) return "tv";
    }
    return "movie";
  }
  return multiEpisode ? "tv" : "movie";
}

function withoutDocs(rows) {
  // 站点把纪录片（子类 32）挂在电影主类（1）下；「电影」栏目只留真人/动画电影，
  // 纪录片走片库的「电影·纪录片」子栏目（tab 32）。
  if (!Array.isArray(rows)) return rows;
  return rows.filter(function (v) { return Number(v && v.typeId) !== 32; });
}

function cardItem(vod) {
  if (!vod || typeof vod !== "object") return null;
  var id = vodId(vod.id);
  var name = trimText(vod.name);
  if (!id || !name) return null;
  var multi = Number(vod.total) > 1 || Number(vod.serial) > 1;
  var item = {
    ref: { source: "custom", id: "vod:" + id, mediaType: mediaTypeOf(vod, multi) },
    title: name.slice(0, 240)
  };
  var poster = safeURL(vod.pic || vod.picThumb, SITE);
  if (poster) item.images = { poster: poster };
  var parts = [];
  ["remarks", "year", "area"].forEach(function (key) {
    var piece = trimText(vod[key]);
    if (piece && piece.length <= 60) parts.push(piece);
  });
  if (parts.length) item.subtitle = parts.join(" · ").slice(0, 200);
  var score = Number(vod.score);
  if (Number.isFinite(score) && score > 0 && score <= 10) item.rating = Math.round(score * 10) / 10;
  var year = trimText(vod.year);
  if (/^\d{4}$/.test(year)) item.releaseDate = year;
  return item;
}

function cardItems(rows, limit) {
  if (!Array.isArray(rows) || rows.length > 5000) badPage("影片列表格式无效");
  var seen = {};
  var items = [];
  var cap = limit || 120;
  for (var i = 0; i < rows.length; i++) {
    var item = cardItem(rows[i]);
    if (!item || seen[item.ref.id]) continue;
    seen[item.ref.id] = true;
    items.push(item);
    if (items.length >= cap) break;
  }
  return items;
}

function parseGroups(rows) {
  if (!Array.isArray(rows)) return [];
  var groups = [];
  var seenFrom = {};
  for (var i = 0; i < rows.length && i < 200; i++) {
    var row = rows[i];
    if (!row || typeof row.from !== "string") continue;
    var from = trimText(row.from);
    if (!from || from.length > 120 || seenFrom[from]) continue;
    var list = Array.isArray(row.episodes) ? row.episodes : [];
    var episodes = [];
    var seenNid = {};
    for (var j = 0; j < list.length && j < 5000; j++) {
      var episode = list[j];
      if (!episode) continue;
      var nid = vodId(episode.nid);
      if (!nid || seenNid[nid]) continue;
      seenNid[nid] = true;
      episodes.push({
        nid: nid,
        name: trimText(episode.name).slice(0, 240) || ("第" + nid + "集"),
        url: typeof episode.url === "string" ? trimText(episode.url) : ""
      });
    }
    if (!episodes.length) continue;
    seenFrom[from] = true;
    var player = row.player && typeof row.player === "object" ? row.player : {};
    groups.push({
      from: from,
      sid: vodId(row.sid) || "",
      name: trimText(player.name).slice(0, 240) || from,
      type: trimText(player.type),
      parse: trimText(player.parse),
      episodes: episodes
    });
  }
  return groups;
}

function buildEpisodes(playId, groups, poster, title) {
  var episodes = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var group = groups[gi];
    for (var ei = 0; ei < group.episodes.length; ei++) {
      var episode = group.episodes[ei];
      var name = episode.name;
      if (title && name.indexOf(title) !== 0) name = title + " " + name;
      var item = {
        season: gi + 1,
        episode: ei + 1,
        title: name.slice(0, 240),
        ref: {
          source: "custom",
          id: "play:" + playId + ":" + encodeURIComponent(group.from) + ":" + episode.nid,
          mediaType: "tv"
        }
      };
      // 站点不给单集剧照，用详情海报兜底，避免选集卡片全是灰色场记板。
      if (poster) item.still = poster;
      episodes.push(item);
      if (episodes.length >= 2000) return episodes;
    }
  }
  return episodes;
}

function detailItem(vod, id) {
  var name = trimText(vod.name);
  var poster = safeURL(vod.pic || vod.picThumb, SITE);
  var groups = parseGroups(vod.playList);
  var multiEpisode = false;
  for (var i = 0; i < groups.length; i++) if (groups[i].episodes.length > 1) multiEpisode = true;
  var mediaType = mediaTypeOf(vod, multiEpisode);
  var item = {
    ref: { source: "custom", id: "vod:" + id, mediaType: mediaType },
    title: name ? name.slice(0, 240) : ("影片 " + id)
  };
  if (poster) item.images = { poster: poster };
  var parts = [];
  ["remarks", "year", "area"].forEach(function (key) {
    var piece = trimText(vod[key]);
    if (piece && piece.length <= 60) parts.push(piece);
  });
  if (parts.length) item.subtitle = parts.join(" · ").slice(0, 200);
  var summary = stripHTML(vod.content || vod.blurb);
  if (summary) item.overview = summary.slice(0, 8000);
  var year = trimText(vod.year);
  if (/^\d{4}$/.test(year)) item.releaseDate = year;
  var score = Number(vod.score);
  if (Number.isFinite(score) && score > 0 && score <= 10) item.rating = Math.round(score * 10) / 10;
  var genres = splitNames(vod.class).slice(0, 8);
  if (genres.length) {
    item.genres = genres.map(function (title) {
      return { id: "genre:" + title, title: title };
    });
  }
  var people = [];
  splitNames(vod.actor).slice(0, 12).forEach(function (actor) {
    people.push({ id: "person:" + actor, title: actor, role: "主演" });
  });
  splitNames(vod.director).slice(0, 4).forEach(function (director) {
    people.push({ id: "person:" + director, title: director, role: "导演" });
  });
  if (people.length) item.people = people;
  // 官方契约（ddys/bangumi 实证）：只有 tv 才输出 episodes；电影带分集会被渲染成「第1季」剧集 UI。
  if (mediaType === "tv" && groups.length) item.episodes = buildEpisodes(id, groups, poster, name);
  return item;
}

// ========== 播放数据（RSA 公钥 + AES-256-GCM） ==========

async function loadPublicKey(ctx, force) {
  if (!force && KEY_CACHE.value && Date.now() - KEY_CACHE.ts < KEY_TTL_MS) {
    return { value: KEY_CACHE.value, pem: KEY_CACHE.pem, cached: true };
  }
  var response = await request(ctx, "/api/crypto/public-key", {});
  var data = jsonOf(response);
  if (!data || typeof data.publicKey !== "string") fail("internal", "网站公开公钥接口数据无效，请等待扩展更新", false);
  if (data.enabled === false) fail("internal", "网站已关闭公开取流", false);
  var key;
  try {
    key = rsaPublicFromPem(data.publicKey);
  } catch (error) {
    fail("internal", "网站公开公钥格式无效，请等待扩展更新", false);
  }
  KEY_CACHE = { ts: Date.now(), value: key, pem: data.publicKey };
  return { value: key, pem: data.publicKey, cached: false };
}

function tryDecryptPlay(payload, key) {
  try {
    var iv = base64ToBytes(payload.iv);
    var tag = base64ToBytes(payload.t);
    var cipher = base64ToBytes(payload.d);
    var hexKey = rsaUnwrapAesKey(payload.k, key);
    var keyBytes = [];
    for (var i = 0; i < 32; i++) keyBytes.push(parseInt(hexKey.substr(i * 2, 2), 16));
    var plain = aesGcmDecrypt(cipher, keyBytes, iv, tag);
    var data = JSON.parse(utf8Decode(plain));
    return data && typeof data === "object" ? data : null;
  } catch (error) {
    return null;
  }
}

async function loadPlayData(ctx, id) {
  var cached = PLAY_CACHE[id];
  if (cached && cached.value && Date.now() - cached.ts < PLAY_TTL_MS) return cached.value;
  if (cached && cached.pending) return cached.pending;
  var pending = fetchPlayData(ctx, id);
  PLAY_CACHE[id] = { ts: 0, value: null, pending: pending };
  try {
    var value = await pending;
    var keys = Object.keys(PLAY_CACHE);
    if (keys.length > 40) PLAY_CACHE = {};
    PLAY_CACHE[id] = { ts: Date.now(), value: value, pending: null };
    return value;
  } catch (error) {
    delete PLAY_CACHE[id];
    throw error;
  }
}

async function fetchPlayData(ctx, id) {
  var response = await request(ctx, "/api/vod/" + id + "/play", {});
  var version = headerValue(response.headers, "X-Enc-V");
  var encrypted = headerValue(response.headers, "X-Enc") === "1";
  var payload = jsonOf(response);
  if (!payload) fail("internal", "网站返回的播放数据不是 JSON", false);
  if (version === "2" || payload.v === 2) {
    fail("internal", "网站已升级到 V2 加密协议（ECDH），请更新此扩展", false);
  }
  var data = payload;
  if (encrypted || !Array.isArray(payload.playList)) {
    if (typeof payload.k !== "string" || typeof payload.iv !== "string" || typeof payload.d !== "string" || typeof payload.t !== "string") {
      fail("internal", "播放接口数据格式无效", false);
    }
    var key = await loadPublicKey(ctx, false);
    data = tryDecryptPlay(payload, key.value);
    if (!data && key.cached) {
      // 公钥轮换：只在缓存命中且 PEM 变化时刷新一次，不重复抓取选集。
      var fresh = await loadPublicKey(ctx, true);
      if (fresh.pem !== key.pem) data = tryDecryptPlay(payload, fresh.value);
    }
    if (!data) fail("internal", "播放数据解密失败，网站协议可能已变化", false);
  }
  if (!data || !data.vod || !Array.isArray(data.playList)) fail("internal", "播放数据结构不完整", false);
  return data;
}
// ========== Handler：首页小组件 ==========

function pageNumber(input) {
  var raw = input && input.page;
  var page = 1;
  if (raw == null) page = 1;
  else if (typeof raw === "number") page = raw;
  else if (typeof raw === "string" && /^\d{1,6}$/.test(raw)) page = Number(raw);
  else if (typeof raw === "object" && typeof raw.page === "number") page = raw.page;
  else fail("invalid_params", "分页参数不正确", false);
  if (!Number.isFinite(page) || page < 1 || page > 10000) {
    fail("invalid_params", "分页参数不正确", false);
  }
  return Math.floor(page);
}

function tabFromRef(ref) {
  var id = ref && typeof ref.id === "string" ? ref.id : "";
  var match = /^browse:(all|[1-9]\d{0,9})$/.exec(id);
  return match && tabExists(match[1]) ? match[1] : "";
}

function resolveTab(input) {
  var tab = input && typeof input.tab === "string" ? trimText(input.tab) : "";
  if (!tabExists(tab)) tab = tabFromRef(input && input.ref);
  if (!tab || !tabExists(tab)) tab = "all";
  return tab;
}

function sectionRows(home, typeId) {
  var sections = Array.isArray(home.sections) ? home.sections : [];
  for (var i = 0; i < sections.length; i++) {
    var section = sections[i];
    if (section && section.type && String(section.type.id) === String(typeId)) {
      return Array.isArray(section.list) ? section.list : null;
    }
  }
  return null;
}

// kind：featured / hot / latest / cat<typeId>
async function homeWidget(ctx, kind) {
  var home = await loadHomeData(ctx);
  var rows = null;
  if (kind === "featured") rows = home.banner;
  else if (kind === "hot") rows = home.hot;
  else if (kind === "latest") rows = home.latest;
  else rows = sectionRows(home, kind.replace(/^cat/, ""));
  if (!rows || !rows.length) {
    // 首页板块缺失时退回站方片库（真实页面），不让组件空白。
    var path = kind.indexOf("cat") === 0 ? "/vod/type/" + kind.replace(/^cat/, "") : "/vod/type";
    var route = await browseRoute(ctx, path, { by: kind === "featured" ? "time" : "hits", page: "1" });
    rows = route && route.list ? route.list.list : null;
  }
  if (kind === "cat1") rows = withoutDocs(rows); // 电影板块不混入纪录片（同片库 tab 1）
  return { items: cardItems(rows || [], 30) };
}

// ========== Handler：片库 / 搜索 / 详情 / 播放 ==========

async function loadBrowse(ctx, input) {
  var tab = resolveTab(input);
  var page = pageNumber(input);
  var path = tab === "all" ? "/vod/type" : "/vod/type/" + tab;
  var route = await browseRoute(ctx, path, { by: "time", page: String(page) });
  var list = route && route.list;
  if (!list || !Array.isArray(list.list)) badPage("片库列表数据无效");
  // 「电影」主栏目（tab 1）不混入纪录片子类，纪录片有独立子栏目（tab 32）。
  var rows = tab === "1" ? withoutDocs(list.list) : list.list;
  var returned = Number(list.page);
  if (Number.isFinite(returned) && returned !== page) {
    fail("unavailable", "网站返回的分页与请求不一致，请下拉刷新", true);
  }
  var items = cardItems(rows, 120);
  var content = { items: items };
  var pages = Number(list.pageCount);
  if (items.length && Number.isFinite(pages) && page < pages && page < 5000) content.next = { page: page + 1 };
  return content;
}

async function searchVods(ctx, input) {
  var query = trimText(input && input.query);
  if (!query) return { items: [] };
  if (query.length > 100) fail("invalid_params", "搜索词过长", false);
  var page = pageNumber(input);
  var route = await routeData(ctx, "/search", { wd: query, mid: "1", page: String(page) }, "search");
  var result = route && route.result;
  if (!result) fail("internal", "搜索结果数据无效，请等待扩展更新", false);
  var vod = result.vod;
  if (!vod) return { items: [] };
  var items = cardItems(vod.list || [], 120);
  var content = { items: items };
  var total = Number(vod.total);
  var size = Number(result.pageSize);
  var pages = size > 0 && Number.isFinite(total) ? Math.ceil(total / size) : 0;
  // 官方 PageToken 形状：{type:"page", page:n}（ddys/hongguo/bangumi 一致）
  if (items.length && page < pages && page < 5000) content.next = { type: "page", page: page + 1 };
  return content;
}

async function readDetail(ctx, input) {
  var parsed = parseRef(input && input.ref);
  if (!parsed.vodId) fail("invalid_params", "缺少影片标识", false);
  var route = await routeData(ctx, "/vod/detail/" + parsed.vodId, {}, "routes/vod-detail");
  var vod = route && route.vod;
  if (!vod || vodId(vod.id) !== parsed.vodId) fail("not_found", "网站返回了其他影片，请重新打开详情", false);
  if (route.access && route.access.canView === false) fail("not_found", "当前内容暂不可访问或需要登录", false);
  return detailItem(vod, parsed.vodId);
}

function pickEpisode(groups, parsed, input) {
  var group = null;
  var episode = null;
  var i;
  var j;
  if (parsed.from) {
    for (i = 0; i < groups.length; i++) {
      if (groups[i].from === parsed.from) {
        group = groups[i];
        break;
      }
    }
    if (group) {
      for (j = 0; j < group.episodes.length; j++) {
        if (group.episodes[j].nid === parsed.nid) {
          episode = group.episodes[j];
          break;
        }
      }
    }
    if (!episode && parsed.nid) {
      // 线路改名/顺序变化的兜底：按同一集号在其它线路里找
      for (i = 0; i < groups.length && !episode; i++) {
        for (j = 0; j < groups[i].episodes.length; j++) {
          if (groups[i].episodes[j].nid === parsed.nid) {
            group = groups[i];
            episode = groups[i].episodes[j];
            break;
          }
        }
      }
    }
  } else {
    var season = Number(input && input.season);
    if (!Number.isFinite(season) || season < 1) season = 1;
    var index = Number(input && input.episode);
    if (!Number.isFinite(index) || index < 1) index = 1;
    group = groups[Math.min(Math.floor(season), groups.length) - 1];
    episode = group.episodes[Math.min(Math.floor(index), group.episodes.length) - 1];
  }
  return { group: group, episode: episode };
}

async function loadSources(ctx, input) {
  var parsed = parseRef(input && input.ref);
  if (!parsed.vodId) fail("invalid_params", "缺少影片标识", false);
  var data = await loadPlayData(ctx, parsed.vodId);
  if (vodId(data.vod.id) !== parsed.vodId) fail("not_found", "播放数据与影片不匹配，请重新打开详情", false);
  var access = data.access && typeof data.access === "object" ? data.access : {};
  if (access.canPlay === false || access.previewOnly === true) {
    fail("not_found", "当前内容需要登录、解锁或仅支持网页试看", false);
  }
  if (data.jumpurl) fail("not_found", "此内容要求转到其他网站播放", false);
  var groups = parseGroups(data.playList);
  if (!groups.length) return [];

  var multiEpisode = false;
  for (var gi = 0; gi < groups.length; gi++) if (groups[gi].episodes.length > 1) multiEpisode = true;
  // 播放接口的 data.vod 只有 id/name/pic（没有 typeId1），类型以 ref.mediaType 为准。
  var refType = input && input.ref && (input.ref.mediaType === "movie" || input.ref.mediaType === "tv") ? input.ref.mediaType : "";
  var mediaType = refType || mediaTypeOf(data.vod, multiEpisode);
  var candidates = [];

  if (parsed.from) {
    // 从分集卡片进入：精确到线路 + 集号
    var picked = pickEpisode(groups, parsed, input);
    if (!picked.group || !picked.episode) fail("not_found", "线路或选集已变化，请重新打开详情", false);
    candidates.push({ group: picked.group, episode: picked.episode });
  } else if (mediaType === "movie") {
    // 电影：同一条线路里的多条 play 是不同版本（英语 / HDTC中字 / HD中字），全部作为可选线路
    for (var m = 0; m < groups.length && candidates.length < 8; m++) {
      for (var v = 0; v < groups[m].episodes.length && candidates.length < 8; v++) {
        candidates.push({ group: groups[m], episode: groups[m].episodes[v] });
      }
    }
  } else {
    // 剧集从详情 ref 直接播放：season=线路序号，episode=该线路内序号
    var season = Number(input && input.season);
    if (!Number.isFinite(season) || season < 1) season = 1;
    var index = Number(input && input.episode);
    if (!Number.isFinite(index) || index < 1) index = 1;
    var group = groups[Math.min(Math.floor(season), groups.length) - 1];
    var episode = group.episodes[Math.min(Math.floor(index), group.episodes.length) - 1];
    candidates.push({ group: group, episode: episode });
  }

  var multiVersion = candidates.length > 1;
  var sources = [];
  for (var i = 0; i < candidates.length; i++) {
    var item = candidates[i];
    if (item.group.parse) continue;
    var url = safeURL(item.episode.url, SITE);
    if (!url) continue;
    var path = url.split(/[?#]/)[0].toLowerCase();
    var playable = /\.(m3u8|mp4|m4v|mpd|webm)$/.test(path) ||
      (item.group.type === "hls" && !/\.(?:html?|php|aspx?)$/.test(path));
    if (!playable) continue;
    sources.push({
      id: "line:" + item.group.from + ":" + item.episode.nid,
      name: multiVersion ? (item.group.name + " · " + item.episode.name) : item.group.name,
      url: url,
      description: multiVersion ? "" : item.episode.name,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": SITE + "/vod/play/" + parsed.vodId + "/" + (item.group.sid || "1") + "/" + item.episode.nid,
        "Origin": SITE
      },
      player: "system"
    });
  }
  return sources;
}
// ========== 包定义 ==========
// 版式分层：精选轮播 poster-pager / 热播 poster-ranked / 最近更新 poster-rail / 五大栏目统一 poster-grid。

definePackage({
  id: "conflux.tvfans",
  title: "Destiny TV",
  description: "Destiny TV（tvfans.top）：精选推荐、正在热播、最近更新，38 个真实栏目片库、搜索、详情与在线播放。",
  author: "Minis",
  site: SITE,
  icon: SITE + "/icon-192.png",
  version: "1.2.2",
  engine: 1,
  permissions: { network: [SITE] },
  settings: [
    {
      name: "timeoutSeconds",
      title: "请求超时（秒）",
      type: "number",
      default: 18,
      description: "站点页面较大，建议 5–30 秒；留空或越界时使用 18 秒。"
    }
  ],
  extensions: [
    {
      type: "widget",
      id: "destinytv",
      title: "Destiny TV",
      description: "Destiny TV 分类入口：全部影视最新内容，点标题进入 38 个栏目的完整片库。",
      template: "poster-grid",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:all" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:230", mediaType: "tv" },
            title: "家乡美食大赛",
            subtitle: "更新至第20261122期 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/500/poster" }
          },
          {
            ref: { source: "custom", id: "vod:68", mediaType: "tv" },
            title: "走马上任",
            subtitle: "已完结 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/148434/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        // 分类入口：全部影视第一页（按最近更新），不带分页 next
        var content = await loadBrowse(ctx, { tab: "all" });
        return { items: content.items };
      }
    },
    {
      type: "widget",
      id: "featured",
      title: "精选推荐",
      description: "Destiny TV 首页精选轮播。",
      template: "poster-pager",
      families: ["extraLarge"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:all" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:241", mediaType: "tv" },
            title: "打歌2026·X舞台",
            subtitle: "更新至第20261122期 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/504/poster" }
          },
          {
            ref: { source: "custom", id: "vod:981", mediaType: "movie" },
            title: "空枪",
            subtitle: "HD国语|粤语 · 2026 · 大陆",
            rating: 7.2,
            images: { poster: "https://p1.czzyplay.com/images/2116/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "featured");
      }
    },
    {
      type: "widget",
      id: "hot",
      title: "正在热播",
      description: "Destiny TV 正在热播榜。",
      template: "poster-ranked",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:all" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:69", mediaType: "tv" },
            title: "现在就出发第4季",
            subtitle: "更新至第20261122期 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/10/poster" }
          },
          {
            ref: { source: "custom", id: "vod:87005", mediaType: "tv" },
            title: "谷雨",
            subtitle: "已完结 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/148515/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "hot");
      }
    },
    {
      type: "widget",
      id: "latest",
      title: "最近更新",
      description: "Destiny TV 最新上架的影视与综艺。",
      template: "poster-rail",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:all" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:230", mediaType: "tv" },
            title: "家乡美食大赛",
            subtitle: "更新至第20261122期 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/500/poster" }
          },
          {
            ref: { source: "custom", id: "vod:121015", mediaType: "tv" },
            title: "奔跑吧·大湾区篇",
            subtitle: "更新至第20261122期 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/149705/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "latest");
      }
    },
    {
      type: "widget",
      id: "cat1",
      title: "电影",
      description: "Destiny TV 电影栏目（动作、喜剧、科幻、恐怖、爱情、剧情、战争、动画；纪录片见片库「电影·纪录片」）。",
      template: "poster-grid",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:1" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:981", mediaType: "movie" },
            title: "空枪",
            subtitle: "HD国语|粤语 · 2026 · 大陆",
            rating: 7.2,
            images: { poster: "https://p1.czzyplay.com/images/2116/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "cat1");
      }
    },
    {
      type: "widget",
      id: "cat6",
      title: "电视剧",
      description: "Destiny TV 电视剧栏目（国产、港台、日韩、欧美、海外、泰国）。",
      template: "poster-grid",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:6" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:68", mediaType: "tv" },
            title: "走马上任",
            subtitle: "已完结 · 2026 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/148434/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "cat6");
      }
    },
    {
      type: "widget",
      id: "cat11",
      title: "综艺",
      description: "Destiny TV 综艺栏目（大陆、港台、日韩、欧美）。",
      template: "poster-grid",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:11" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:78", mediaType: "tv" },
            title: "你好，星期六",
            subtitle: "更新至第20261122期 · 2022 · 大陆",
            rating: 6.1,
            images: { poster: "https://p1.czzyplay.com/images/506/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "cat11");
      }
    },
    {
      type: "widget",
      id: "cat15",
      title: "动漫",
      description: "Destiny TV 动漫栏目（国产、港台、日韩、欧美、海外）。",
      template: "poster-grid",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:15" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:387", mediaType: "tv" },
            title: "死灵法师！我即是天灾动态漫",
            subtitle: "更新至312集 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/666/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "cat15");
      }
    },
    {
      type: "widget",
      id: "cat34",
      title: "短剧",
      description: "Destiny TV 短剧栏目（都市脑洞、古装仙侠、反转爽文、重生民国、穿越年代、现代言情、闪婚离婚、女恋总裁）。",
      template: "poster-grid",
      families: ["medium", "large"],
      headerIntent: "list",
      ref: { source: "custom", id: "browse:34" },
      cache: { ttlSeconds: 300, staleWhileRevalidateSeconds: 300 },
      placeholderData: {
        items: [
          {
            ref: { source: "custom", id: "vod:120937", mediaType: "tv" },
            title: "穿越成弃妃：我靠医术当团宠",
            subtitle: "已完结 · 大陆",
            images: { poster: "https://p1.czzyplay.com/images/149640/poster" }
          }
        ]
      },
      load: async function (ctx, input) {
        return homeWidget(ctx, "cat34");
      }
    },
    {
      type: "list",
      id: "browse",
      title: "Destiny TV 片库",
      description: "全部影视与电影、电视剧、综艺、动漫、短剧共 38 个站方真实栏目，按最近更新排序。",
      style: "grid",
      accepts: { sources: ["custom"] },
      search: { id: "main" },
      cache: { ttlSeconds: 600, staleWhileRevalidateSeconds: 600 },
      tabs: async function (ctx, input) {
        return { tabs: BROWSE_TABS, default: tabFromRef(input && input.ref) || "all" };
      },
      load: async function (ctx, input) {
        return loadBrowse(ctx, input);
      }
    },
    {
      type: "search",
      id: "main",
      title: "搜索 Destiny TV",
      description: "按片名搜索 Destiny TV 站内影片。",
      cache: { ttlSeconds: 1800, staleWhileRevalidateSeconds: 300 },
      search: async function (ctx, input) {
        return searchVods(ctx, input);
      }
    },
    {
      type: "detail",
      id: "detail",
      title: "Destiny TV 详情",
      description: "读取 Destiny TV 影片详情、简介、演职员与全部线路的选集。",
      accepts: { sources: ["custom"] },
      cache: { ttlSeconds: 600, staleWhileRevalidateSeconds: 600 },
      load: async function (ctx, input) {
        return readDetail(ctx, input);
      }
    },
    {
      type: "playback",
      id: "playback",
      title: "Destiny TV 线路",
      description: "解密站方 v1 播放接口（RSA 公钥 + AES-256-GCM），返回 HLS 直链。",
      accepts: { sources: ["custom"] },
      cache: { ttlSeconds: 0 },
      sources: async function (ctx, input) {
        return loadSources(ctx, input);
      }
    }
  ]
});
