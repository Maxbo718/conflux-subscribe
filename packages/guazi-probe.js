/* Conflux 诊断探针包 v0.0.1 —— 仅用于定位「瓜子影视」包崩溃触发条件
 *
 * 三个 widget，每个只隔离一个变量，其余完全相同（静态数据、不发网络请求）：
 *   probe-noop     无 parameters、不碰 storage        → 对照组，预期不崩
 *   probe-select   有 select 参数、不碰 storage        → 隔离「select 参数」
 *   probe-storage  无参数、仅调用 ctx.storage.set/get → 隔离「storage 写入」
 *
 * 判读：
 *   只有 probe-select 崩  → 根因是 select 参数
 *   只有 probe-storage 崩 → 根因是 ctx.storage
 *   两者都崩             → 共同根因在别处（回到包级排查）
 *   两者都不崩           → 触发条件是「select + storage 同时存在」
 */

var VERSION = "0.0.1";

var ITEMS = [
  { ref: { source: "custom", id: "1", mediaType: "movie" }, title: "探针 甲", subtitle: "静态条目" },
  { ref: { source: "custom", id: "2", mediaType: "movie" }, title: "探针 乙", subtitle: "静态条目" },
  { ref: { source: "custom", id: "3", mediaType: "movie" }, title: "探针 丙", subtitle: "静态条目" },
];

function cloneItems() {
  var out = [];
  for (var i = 0; i < ITEMS.length; i++) {
    out.push({
      ref: { source: ITEMS[i].ref.source, id: ITEMS[i].ref.id, mediaType: ITEMS[i].ref.mediaType },
      title: ITEMS[i].title,
      subtitle: ITEMS[i].subtitle,
    });
  }
  return out;
}

definePackage({
  id: "conflux.guazi.probe",
  title: "瓜子探针",
  version: VERSION,
  engine: 1,
  description: "崩溃定位诊断包：分别隔离 select 参数与 ctx.storage 写入，不发网络请求",
  permissions: { network: [] },
  settings: [],
  extensions: [
    /* ---------- 对照：无参数、无 storage ---------- */
    {
      type: "widget",
      id: "probe-noop",
      title: "探针1 对照",
      description: "无参数、不写存储；预期不崩",
      template: "poster-grid",
      placeholderData: { items: ITEMS },
      load: async function () {
        return { items: cloneItems() };
      },
    },

    /* ---------- 隔离 select 参数 ---------- */
    {
      type: "widget",
      id: "probe-select",
      title: "探针2 选择框",
      description: "有 select 参数、不写存储；若崩则 select 是根因",
      template: "poster-grid",
      params: [
        {
          name: "pick",
          title: "选项",
          type: "select",
          default: "a",
          options: [
            { title: "甲", value: "a" },
            { title: "乙", value: "b" },
          ],
        },
      ],
      placeholderData: { items: ITEMS },
      load: async function (ctx, input) {
        var p = (input && input.params) || {};
        var items = cloneItems();
        if (p.pick === "b") items.reverse();
        return { items: items };
      },
    },

    /* ---------- 隔离 storage 写入 ---------- */
    {
      type: "widget",
      id: "probe-storage",
      title: "探针3 存储",
      description: "无参数、仅写存储；若崩则 ctx.storage 是根因",
      template: "poster-grid",
      placeholderData: { items: ITEMS },
      load: async function (ctx) {
        ctx.storage.set("probe_key", "hello");
        var v = ctx.storage.get("probe_key");
        var items = cloneItems();
        if (v) items[0].subtitle = "存储读取成功";
        return { items: items };
      },
    },
  ],
});
