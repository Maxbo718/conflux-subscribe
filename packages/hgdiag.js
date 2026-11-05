// conflux-hgdiag 0.1.1 —— 二进制响应二次诊断
// 目的：确认运行时把图片字节放在哪里（还是干脆不给）
var VERSION = "0.1.1";
var IMG = "https://pic.drleao.cn/upload_01/upload/20260807/2026080723212440212.jpg?auth_key=1793881403-0-0-63af";
var TXT = "https://huangguoai.com/api/videos?page=1&limit=2";

function desc(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  var t = typeof v;
  if (t === "string") return "string(" + v.length + ")";
  if (t === "number") return "number(" + v + ")";
  if (t === "boolean") return "bool(" + v + ")";
  if (t === "object") {
    var cn = "";
    try { cn = v.constructor && v.constructor.name ? v.constructor.name : ""; } catch (e) {}
    if (cn === "ArrayBuffer") return "ArrayBuffer(" + v.byteLength + ")";
    if (cn && cn !== "Object") {
      var bl = 0;
      try { bl = v.byteLength !== undefined ? v.byteLength : (v.length !== undefined ? v.length : 0); } catch (e2) {}
      return cn + "(" + bl + ")";
    }
    if (Array.isArray(v)) return "Array(" + v.length + ")";
    var ks = [];
    try { for (var k in v) ks.push(k); } catch (e3) {}
    return "object[" + ks.slice(0, 8).join(",") + "]";
  }
  return t;
}

function keysOf(o) {
  if (!o || typeof o !== "object") return [];
  var ks = [];
  try { for (var k in o) ks.push(k); } catch (e) {}
  return ks;
}

function headBytes(data) {
  try {
    var bs = [];
    if (typeof data === "string") {
      for (var i = 0; i < Math.min(4, data.length); i++) bs.push(data.charCodeAt(i));
    } else if (data && data.byteLength !== undefined) {
      var u = new Uint8Array(data.buffer || data, data.byteOffset || 0, Math.min(4, data.byteLength));
      for (var j = 0; j < u.length; j++) bs.push(u[j]);
    } else if (Array.isArray(data)) {
      for (var m = 0; m < Math.min(4, data.length); m++) bs.push(data[m] & 0xff);
    }
    return bs.map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join(" ");
  } catch (e) { return "?"; }
}

function card(id, title, subtitle) {
  return { ref: { source: "custom", id: "hgdiag:" + id }, title: title, subtitle: subtitle, mediaType: "movie" };
}

definePackage({
  id: "conflux.hgdiag",
  title: "黄果封面诊断",
  version: VERSION,
  engine: 1,
  icon: "https://maxbo718.github.io/conflux-subscribe/icons/guazi.png",
  description: "临时诊断包，验完即删",
  permissions: { network: ["https://", "http://"] },
  extensions: [
    {
      type: "widget",
      id: "hgdiag",
      title: "黄果封面诊断",
      template: "poster-grid",
      load: async function (ctx) {
        var t0 = Date.now();
        var items = [];
        var env = "get=" + typeof ctx.http.get + " post=" + typeof ctx.http.post + " setTimeout=" + typeof setTimeout;
        items.push(card(0, "① 环境", env));

        /* ② 响应对象全貌 */
        var r2 = "";
        try {
          var resp = await ctx.http.get(IMG, { timeout: 20000 });
          var ks = keysOf(resp);
          var parts = [];
          for (var i = 0; i < ks.length; i++) {
            var v = resp[ks[i]];
            parts.push(ks[i] + "=" + desc(v));
          }
          r2 = "status=" + resp.status + " keys[" + ks.length + "] " + parts.join(" ");
        } catch (e) {
          r2 = "异常：" + (e && e.message ? e.message : e);
        }
        items.push(card(1, "② 响应全貌", r2.slice(0, 300)));

        /* ③ 看每个可能字段的字节头 */
        var r3 = "";
        try {
          var resp3 = await ctx.http.get(IMG, { timeout: 20000 });
          var cands = ["data", "body", "bytes", "buffer", "arrayBuffer", "content", "text", "json", "raw"];
          var arr = [];
          for (var c = 0; c < cands.length; c++) {
            if (resp3[cands[c]] !== undefined) arr.push(cands[c] + ":" + desc(resp3[cands[c]]) + " head=" + headBytes(resp3[cands[c]]));
          }
          var hk = keysOf(resp3.headers);
          r3 = arr.length ? arr.join(" | ") : "所有候选字段都 undefined";
          r3 += " · 头[" + hk.length + "]";
        } catch (e) {
          r3 = "异常：" + (e && e.message ? e.message : e);
        }
        items.push(card(2, "③ 字节头探测", r3.slice(0, 300)));

        /* ④ 文本对照：同一运行时取 JSON */
        var r4 = "";
        try {
          var resp4 = await ctx.http.get(TXT, { timeout: 20000, headers: { "User-Agent": "Mozilla/5.0" } });
          var d4 = resp4 && resp4.data;
          var isStr = typeof d4 === "string";
          r4 = "status=" + resp4.status + " data=" + desc(d4) + " 前40=" + (isStr ? d4.slice(0, 40) : "非字符串") + " head=" + headBytes(d4);
        } catch (e) {
          r4 = "异常：" + (e && e.message ? e.message : e);
        }
        items.push(card(3, "④ 文本对照（JSON 接口）", r4.slice(0, 300)));

        /* ⑤ 带 Accept 头再取一次图 */
        var r5 = "";
        try {
          var resp5 = await ctx.http.get(IMG, { timeout: 20000, headers: { Accept: "image/avif,image/webp,image/jpeg,*/*", "User-Agent": "Mozilla/5.0" } });
          r5 = "status=" + resp5.status + " data=" + desc(resp5 && resp5.data) + " head=" + headBytes(resp5 && resp5.data) +
               " cl=" + ((resp5 && resp5.headers && (resp5.headers["content-length"] || resp5.headers["Content-Length"])) || "?");
        } catch (e) {
          r5 = "异常：" + (e && e.message ? e.message : e);
        }
        items.push(card(4, "⑤ 带 Accept 头取图", r5.slice(0, 300)));

        items.push(card(5, "⑥ 总耗时", (Date.now() - t0) + "ms"));
        return items;
      },
    },
  ],
});
