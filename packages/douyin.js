/* 抖音直播 Conflux 1.0.0；内容核心来自 Angel Live 2.0.58。
 * 原包热门=聊天，同接口只保留一套组件。无扫码登录/弹幕/浏览器SDK。
 * 关键词搜索尚未移植；支持房间号和直播分享链接查找。 */
var DY_VERSION='1.1.0';
function dyFail(code,msg,retry){if(typeof ExtensionError==='function')throw ExtensionError({code:code,message:msg,retryable:!!retry});var e=new Error(msg);e.code=code;e.retryable=!!retry;throw e;}
function dyCore(ctx){return createDouyinCore(ctx,String(ctx.settings&&ctx.settings.cookie||'').trim());}
async function dyCall(ctx,method,args,kind){try{return await dyCore(ctx)[method](args||{});}catch(e){var c=String(e&&e.code||'');if(c==='AUTH_REQUIRED'||c==='UNAUTHORIZED'){if(kind==='search')dyFail('unavailable','还没有可用的抖音 Cookie：请到扩展设置粘贴登录 Cookie 后再搜索关键词。',false);dyFail('unavailable','抖音要求登录或验证，请更换公开直播间。',false);}if(c==='RATE_LIMITED')dyFail('rate_limited','抖音请求过于频繁，请稍后重试。',true);if(c==='VERIFY_REQUIRED')dyFail('rate_limited',(e&&e.nilType&&e.nilType!=='verify_check')?'抖音没有返回搜索结果（风控：'+e.nilType+'）。请稍后重试。':'抖音要求安全验证，关键词搜索暂时不可用。请稍后重试，或在浏览器打开抖音完成验证。',true);if(c==='NOT_FOUND')dyFail('not_found','直播间不存在、已下播或当前没有可用线路。',false);if(c==='INVALID_ARGS')dyFail('invalid_params','请填写有效的抖音房间号或直播分享链接。',false);dyFail('unavailable','抖音暂时未返回有效数据，请稍后重试。',true);}}
function dyRef(id){return {source:'custom',id:'douyin:'+id,mediaType:'movie'};}
function dyRoomId(ref){var s=String(ref&&ref.id||'').trim(),m=s.match(/^(?:douyin:)?([1-9]\d*)$/);if(m)return m[1];m=s.match(/^https?:\/\/live\.douyin\.com\/([1-9]\d*)/i);return m?m[1]:'';}
function dyOwnedRoomId(ref){var m=String(ref&&ref.id||'').match(/^douyin:([1-9]\d*)$/);return m&&(!ref.source||ref.source==='custom')?m[1]:'';}
function dyImage(url){return /^https?:\/\//i.test(String(url||''))?String(url):'';}
function dyItem(row,intent){var r=row&&row.room||row;if(!r||!/^[1-9]\d*$/.test(String(r.roomId||'')))return null;var cover=dyImage(r.roomCover);return {ref:dyRef(String(r.roomId)),title:r.roomTitle||r.userName||'抖音直播',subtitle:r.userName||'',overview:r.description||'',intent:intent||'play',images:{poster:cover,backdrop:cover,cover:cover}};}
function dyItems(rows,intent){var out=[],seen={};for(var i=0;i<(rows||[]).length;i++){var item=dyItem(rows[i],intent);if(item&&!seen[item.ref.id]){seen[item.ref.id]=true;out.push(item);}}return out;}
function dyPage(input){var p=input&&input.page;return Math.max(1,Math.floor(Number(p&&p.page||p||1))||1);}
function dyCookieLooksLoggedIn(c){var s=String(c||'');return /(^|;\s*)sessionid=[^;\s]/.test(s);}

var DY_POOL={rooms:{},jobs:null,queue:[],ts:0,lastCrawl:0},DY_POOL_STORE='dy_pool_v3',DY_POOL_LOADED=false;
function dyNorm(v){return String(v==null?'':v).toLowerCase();}
function dyMatch(item,terms){var h=dyNorm(item&&item.title)+' '+dyNorm(item&&item.subtitle)+' '+dyNorm(item&&item.overview);for(var i=0;i<terms.length;i++){if(h.indexOf(terms[i])<0)return false;}return true;}
var DY_POOL_BUDGET=9000,DY_POOL_WORKERS=10,DY_POOL_MAX=12000,DY_POOL_PAGES_PER_JOB=1,DY_POOL_TTL=900000;
function dyPoolJobs(){
  if(DY_POOL.jobs)return DY_POOL.jobs;
  var jobs=[];
  for(var g in DY_GROUPS){if(!Object.prototype.hasOwnProperty.call(DY_GROUPS,g))continue;
    var grp=DY_GROUPS[g],mid=(grp&&grp.id)?String(grp.id).replace(/^group-/,''):'';if(!mid)continue;
    var subs=(grp&&grp.subList)||[];
    for(var i=0;i<subs.length;i++){var sub=subs[i];if(!sub||!sub.id)continue;
      jobs.push({mid:mid,cat:String(sub.id)+'|'+String(sub.parentId==null?'0':sub.parentId),name:String(sub.title||sub.name||''),page:1,done:false});}}
  DY_POOL.jobs=jobs;return jobs;
}
function dyPoolSize(){var n=0;for(var k in DY_POOL.rooms)if(Object.prototype.hasOwnProperty.call(DY_POOL.rooms,k))n++;return n;}
function dyPoolVisited(){var j=dyPoolJobs(),n=0;for(var i=0;i<j.length;i++)if(j[i].page>1)n++;return n;}
async function dyPoolCrawl(ctx,budgetMs){
  var jobs=dyPoolJobs(),deadline=Date.now()+Math.max(1500,Number(budgetMs)||DY_POOL_BUDGET);
  var need=[];
  for(var i2=0;i2<jobs.length;i2++){var jb=jobs[i2];if(!jb.done&&jb.page<=DY_POOL_PAGES_PER_JOB)need.push(jb);}
  need.sort(function(a,b){return (a.page-b.page)||0;});
  var idx=0;
  async function one(job){
    var list;
    try{list=await dyRooms(ctx,job.cat,job.page);}catch(e){job.page=DY_POOL_PAGES_PER_JOB+1;job.done=true;return;}
    if(!list.length){job.done=true;return;}
    for(var i=0;i<list.length;i++){var it=list[i],id=(it&&it.ref)?it.ref.id:'';if(!id)continue;
      if(!DY_POOL.rooms[id]){if(dyPoolSize()>=DY_POOL_MAX){job.done=true;return;}
        DY_POOL.rooms[id]={ref:it.ref,title:it.title,subtitle:it.subtitle,overview:String(it.overview||'').slice(0,80),images:{cover:(it.images&&it.images.cover)||''}};}}
    job.page++;
    if(list.length<10)job.done=true;
  }
  async function worker(){while(Date.now()<deadline){var job=need[idx++];if(!job)break;await one(job);}}
  var ws=[];for(var w=0;w<DY_POOL_WORKERS;w++)ws.push(worker());
  await Promise.all(ws);
  DY_POOL.ts=Date.now();
}
function dyPoolList(){var out=[];for(var k in DY_POOL.rooms){if(Object.prototype.hasOwnProperty.call(DY_POOL.rooms,k))out.push(DY_POOL.rooms[k]);}return out;}
function dyPoolFilter(terms){var rows=dyPoolList(),hits=[];for(var i=0;i<rows.length;i++){var it=rows[i];if(dyMatch(it,terms))hits.push({ref:it.ref,title:it.title,subtitle:it.subtitle,overview:it.overview,intent:'detail',images:it.images||{}});}return hits;}
function dyPoolLoad(ctx){
  if(DY_POOL_LOADED)return;
  DY_POOL_LOADED=true;
  try{
    var raw=ctx&&ctx.storage&&ctx.storage.get?ctx.storage.get(DY_POOL_STORE):null;
    if(typeof raw==='string')raw=JSON.parse(raw);
    if(raw&&raw.rooms){DY_POOL.rooms=raw.rooms||{};DY_POOL.ts=Number(raw.ts||0);}
    if(raw&&raw.pages){DY_POOL.pages=raw.pages||{};}
  }catch(e){}
}
function dyPoolSave(ctx){
  try{if(!ctx||!ctx.storage||!ctx.storage.set)return;ctx.storage.set(DY_POOL_STORE,{ts:DY_POOL.ts,rooms:DY_POOL.rooms,pages:DY_POOL.pages||{}});}catch(e){}
}
async function dyPoolSearch(ctx,q,p){
  var terms=dyNorm(q).split(/\s+/).filter(function(x){return !!x;});
  if(!terms.length)return {items:[]};
  dyPoolJobs();dyPoolLoad(ctx);
  var hits=dyPoolFilter(terms);
  var stale=!DY_POOL.ts||(Date.now()-DY_POOL.ts)>10000;
  var needExtend=!DY_POOL.ts||dyPoolVisited()<dyPoolJobs().length;
  if(stale&&(needExtend||!hits.length)){await dyPoolCrawl(ctx,DY_POOL_BUDGET);dyPoolSave(ctx);}
  hits=dyPoolFilter(terms);
  if(!hits.length){
    var jobs=dyPoolJobs();
    dyFail('unavailable','未登录时只能筛选已采集的在播直播间：目前 '+dyPoolSize()+' 个房间，覆盖 '+dyPoolVisited()+'/'+jobs.length+' 个分类（已访问 '+dyPoolVisited()+' 类），没有匹配「'+q+'」的。再搜一次会继续扩充采集范围；要全站搜索请到扩展设置粘贴抖音 Cookie。',false);
  }
  var per=30,from=(p-1)*per,page=hits.slice(from,from+per);
  return {items:page,next:(hits.length>from+per)?{type:'page',page:p+1}:null};
}
async function dySearch(ctx,input){var q=String(input.query||'').trim();if(!q)return {items:[]};var p=dyPage(input),id=dyRoomId({id:q}),room;if(id){if(p>1)return {items:[]};room=await dyCall(ctx,'detail',{roomId:id});return {items:dyItems([room],'detail')};}if(/https?:\/\/(?:[a-z0-9-]+\.)*(?:douyin\.com|amemv\.com)(?:\/|\b)/i.test(q)){if(p>1)return {items:[]};room=await dyCall(ctx,'share',{shareCode:q});return {items:dyItems([room],'detail')};}var ck=String(ctx.settings&&ctx.settings.cookie||'');if(!dyCookieLooksLoggedIn(ck))return dyPoolSearch(ctx,q,p);
 var rows;try{rows=await dyCall(ctx,'search',{keyword:q,page:p},'search');}catch(err){if(err&&err.code==='unavailable')return dyPoolSearch(ctx,q,p);throw err;}var items=dyItems(rows,'detail');return {items:items,next:items.length?{type:'page',page:p+1}:null};}
async function dyRooms(ctx,key,page){var p=String(key||'').split('|');if(!/^[1-9]\d*$/.test(p[0])||!/^\d+$/.test(p[1]||''))dyFail('invalid_params','请选择有效的抖音直播分类。',false);return dyItems(await dyCall(ctx,'rooms',{id:p[0],parentId:p[1],page:page}));}
function dyKey(input,fallback){return String(input.params&&input.params.category||fallback);}
function dyCategoryTitle(key){for(var i=0;i<DY_GROUPS.length;i++){var s=DY_GROUPS[i].subList||[];for(var j=0;j<s.length;j++)if(String(s[j].id)+'|'+String(s[j].parentId)===key)return s[j].title;}return '抖音直播';}
async function dyList(ctx,input){var id=String(input.ref&&input.ref.id||'');if(id==='dyall:live')return dyAllContent(ctx,input);var p=dyPage(input),items=[];if(id.indexOf('dygroup:')!==0)return {items:[]};var g=id.slice(8),fallback=DY_DEFAULTS[g]||'';if(!fallback)return {items:[]};items=await dyRooms(ctx,dyKey(input,fallback),p);return {items:items,next:items.length?{page:p+1}:null};}
async function dyDetail(ctx,input){var id=dyOwnedRoomId(input.ref);if(!id)return null;var r;try{r=await dyCall(ctx,'detail',{roomId:id});}catch(e){if(e&&e.code==='not_found')return null;throw e;}var item=dyItem(r);if(!item)return null;delete item.intent;item.images.detailPoster=dyImage(r.userHeadImg)||item.images.poster;item.people=r.userName?[{id:String(r.userId||id),title:r.userName,avatar:dyImage(r.userHeadImg),role:'主播'}]:[];item.overview=(r.liveState==='1'?'正在直播':'当前直播状态待确认')+(r.liveWatchedCount?' · '+r.liveWatchedCount+' 人气':'')+'\n房间号：'+id;return item;}
async function dyPlayback(ctx,input){var id=dyOwnedRoomId(input.ref);if(!id)return [];var rows=await dyCall(ctx,'playback',{roomId:id}),out=[],seen={};for(var i=0;i<(rows||[]).length;i++){var qs=rows[i].qualitys||[];for(var j=0;j<qs.length;j++){var q=qs[j];if(!/^https?:\/\//i.test(String(q.url||''))||q.liveCodeType!=='m3u8'||seen[q.url])continue;seen[q.url]=true;out.push({id:'dy-'+i+'-'+String(q.qn||j),name:(rows[i].cdn||'直播线路')+' · '+String(q.title||'HLS').replace(/_HLS$/,''),url:q.url,headers:q.headers||{'User-Agent':q.userAgent||'libmpv'},player:'system',skipRedirectProbe:true});}}return out;}

/* Aggregate controller only. The original HTTP/signature/callback core is unchanged.
 * Cursor retains a bounded recent-room window (4096 IDs), not an eternal census. */
var DY_ALL_SEEN_LIMIT=4096;
function dyAllInitial(){return {v:1,q:DY_ALL_KEYS.map(function(k,i){return [i,1];}),seen:[]};}
function dyAllState(input){
  var p=input&&input.page;
  if(p===undefined||p===null||p===1||(p&&p.page===1&&(p.type===undefined||p.type==='page')))return dyAllInitial();
  if(p&&p.type==='cursor'){
    if(typeof p.cursor!=='string'||p.cursor.length>150000)dyFail('invalid_params','抖音直播分页信息无效，请重新打开分类。',false);
    try{p=JSON.parse(p.cursor);}catch(e){dyFail('invalid_params','抖音直播分页信息无效，请重新打开分类。',false);}
  }
  if(!p||p.v!==1||!Array.isArray(p.q)||p.q.length>DY_ALL_KEYS.length||!Array.isArray(p.seen)||p.seen.length>DY_ALL_SEEN_LIMIT)dyFail('invalid_params','抖音直播分页信息无效，请重新打开分类。',false);
  var ids={},q=[];
  for(var i=0;i<p.q.length;i++){var x=p.q[i];if(!Array.isArray(x)||x.length!==2||typeof x[0]!=='number'||!Number.isFinite(x[0])||x[0]%1||x[0]<0||x[0]>=DY_ALL_KEYS.length||ids[x[0]]||typeof x[1]!=='number'||!Number.isFinite(x[1])||x[1]%1||x[1]<1||x[1]>1000000)dyFail('invalid_params','抖音直播分页信息无效，请重新打开分类。',false);ids[x[0]]=true;q.push([x[0],x[1]]);}
  var seen=[];for(var j=0;j<p.seen.length;j++){if(typeof p.seen[j]!=='string'||!/^douyin:[1-9]\d{0,29}$/.test(p.seen[j]))dyFail('invalid_params','抖音直播分页信息无效，请重新打开分类。',false);seen.push(p.seen[j]);}
  return {v:1,q:q,seen:seen};
}
// Native request timeoutMs, not JavaScript timers. Same three-argument POST as baseline.
function dyAllContext(ctx,deadline){
  function options(o){var left=deadline-Date.now();if(left<1)dyFail('unavailable','抖音聚合加载超时，请稍后重试。',true);var out=Object.assign({},o||{});out.timeoutMs=Math.max(1,Math.min(Number(out.timeoutMs)||10000,10000,left));return out;}
  return {settings:ctx.settings,http:{get:function(url,o){return ctx.http.get(url,options(o));},post:function(url,body,o){return ctx.http.post(url,body,options(o));}}};
}
async function dyAllContent(ctx,input){
  var state=dyAllState(input),out=[],seen={};for(var i=0;i<state.seen.length;i++)seen[state.seen[i]]=true;
  if(!state.q.length)return {items:[]};
  var deadline=Date.now()+18000,core=dyCore(dyAllContext(ctx,deadline)),scans=0;
  while(state.q.length&&out.length===0&&scans<16&&Date.now()<deadline){
    var batch=state.q.splice(0,4);scans+=batch.length;
    var results=await Promise.all(batch.map(async function(task){
      var key=DY_ALL_KEYS[task[0]].split('|');
      try{return {task:task,items:dyItems(await core.rooms({id:key[0],parentId:key[1],page:task[1]}))};}catch(e){return {task:task,error:true,limited:String(e&&e.code||'')==='RATE_LIMITED'};}
    }));
    var failures=0;
    for(var n=0;n<results.length;n++){
      var r=results[n];
      if(r.error){failures++;state.q.push(r.task);continue;}
      // Only a successful confirmed empty category is exhausted.
      if(r.items.length)state.q.push([r.task[0],r.task[1]+1]);
      for(var m=0;m<r.items.length;m++){var item=r.items[m],rid=item.ref.id;if(!seen[rid]){seen[rid]=true;state.seen.push(rid);out.push(item);}}
    }
    // Do not disguise a complete batch outage as an empty/end page.
    if(failures===results.length)dyFail(results.every(function(r){return r.limited;})?'rate_limited':'unavailable','抖音直播分区暂时不可用，请稍后重试。',true);
  }
  state.seen=state.seen.slice(-DY_ALL_SEEN_LIMIT);
  var content={items:out};if(state.q.length)content.next=state;return content;
}
async function dyAllWidget(ctx,input){var content=await dyAllContent(ctx,input);if(content.next)content.next={type:'cursor',cursor:JSON.stringify(content.next)};return content;}

/* Minimal Conflux Host glue; original content/signature algorithms remain intact. */
function createDouyinCore(ctx,cookieHeader){
  var globalThis={};
  function safeHost(url){var m=String(url||'').match(/^https:\/\/([a-z0-9.-]+)(?::443)?(?:[\/?#]|$)/i);var h=m?m[1].toLowerCase():'';return ['live.douyin.com','www.douyin.com','v.douyin.com','webcast.amemv.com','ttwid.bytedance.com'].indexOf(h)>=0?h:'';}
  function bridgeError(code){var e=new Error('Douyin request failed');e.code=code||'UNAVAILABLE';return e;}
  function headersFor(raw,host,auth){var out={};Object.keys(raw||{}).forEach(function(k){if(k.toLowerCase()!=='cookie'||host==='live.douyin.com'||host==='www.douyin.com')out[k]=raw[k];});if(auth==='platform_cookie'&&cookieHeader&&(host==='live.douyin.com'||host==='www.douyin.com'))out.Cookie=cookieHeader;return out;}
  function request(envelope,url,hops){return Promise.resolve().then(function(){
    var r=envelope.request||{},host=safeHost(url),method=String(r.method||'GET').toUpperCase();if(!host||hops>5)throw bridgeError('INVALID_ARGS');
    var opt={headers:headersFor(r.headers,host,envelope.authMode),timeoutMs:Math.min(Number(r.timeoutMs||(Number(r.timeout||15)*1000)),20000),followRedirects:false,cacheTtlSeconds:0};
    // Conflux documented three-argument POST; keep the original serialized body.
    if(method==='GET')return ctx.http.get(url,opt);
    if(method==='POST')return ctx.http.post(url,r.body,opt);
    throw bridgeError('INVALID_ARGS');
  }).then(function(res){
    var status=Number(res.status||0),r=envelope.request||{},headers={},location='';Object.keys(res.headers||{}).forEach(function(k){headers[k]=res.headers[k];if(k.toLowerCase()==='set-cookie')headers['Set-Cookie']=Array.isArray(res.headers[k])?res.headers[k].join('; '):String(res.headers[k]||'');if(k.toLowerCase()==='location')location=String(res.headers[k]||'');});
    if(status>=300&&status<400&&location){
      if(String(r.method||'GET').toUpperCase()!=='GET')throw bridgeError('UNAVAILABLE');
      if(location.indexOf('//')===0)location='https:'+location;else if(location.charAt(0)==='/')location='https://'+safeHost(url)+location;else if(location.indexOf('https://')!==0)location=url.split('?')[0].replace(/[^/]*$/,'')+location;
      // Each hop rechecks hosts and removes account Cookie outside its exact credential hosts.
      return request(envelope,location,hops+1);
    }
    if(status<200||status>=300)throw bridgeError(status===429?'RATE_LIMITED':status===401||status===403?'AUTH_REQUIRED':'UNAVAILABLE');
    var body=res.data;if(typeof body!=='string')body=JSON.stringify(body===undefined?null:body);
    var obj=null;try{obj=JSON.parse(body);}catch(_){}
    if(obj&&typeof obj==='object'&&obj.status_code!==undefined&&Number(obj.status_code)!==0)throw bridgeError(Number(obj.status_code)===2483?'AUTH_REQUIRED':'UNAVAILABLE');
    if(url.indexOf('/webcast/web/partition/detail/room/v2/')>=0&&(!obj||!obj.data||!Array.isArray(obj.data.data)))throw bridgeError('UNAVAILABLE');
    return {status:status,statusCode:status,headers:headers,body:body,bodyText:body,url:url};
  },function(){throw bridgeError('UNAVAILABLE');});}
  var Host={http:{request:function(e){return request(e,(e.request||{}).url,0);}},session:{getCookieHeader:function(){return cookieHeader||'';},isAuthenticated:function(){return /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_guard)=/.test(cookieHeader||'');}},log:function(){},makeError:function(code){return bridgeError(code);}};
  globalThis.Host=Host;
/* Original HTTP helper and index inserted below. */
function _dy_ready(value) {
  const deferred = _dy_deferred();
  deferred.resolve(value);
  return deferred.thenable;
}

function _dy_fail(error) {
  const deferred = _dy_deferred();
  deferred.reject(error);
  return deferred.thenable;
}

function _dy_export(value) {
  if (value && typeof value.then === "function") return value;
  return _dy_ready(value);
}

function _dy_hostHttp(envelope, onSuccess, onError) {
  const bridge = globalThis.__lp_host_http_request;
  if (typeof bridge !== "function") {
    Host.http.request(envelope).then(onSuccess, onError);
    return;
  }
  bridge(
    JSON.stringify(envelope || {}),
    function (resultJSON) {
      try {
        onSuccess(JSON.parse(resultJSON));
      } catch (error) {
        onError(error);
      }
    },
    function (error) {
      const message = String(error || "host http request failed");
      if (message.indexOf("LP_PLUGIN_ERROR:") !== -1) onError(new Error(message));
      else if (globalThis.Host && typeof Host.makeError === "function") onError(Host.makeError("NETWORK", message, {}));
      else onError(new Error(message));
    }
  );
}

function _dy_httpTask(envelope) {
  const deferred = _dy_deferred();
  _dy_hostHttp(envelope, deferred.resolve, deferred.reject);
  return deferred.thenable;
}

function _dy_syncAsync(genFn) {
  return function () {
    const deferred = _dy_deferred();
    const gen = genFn.apply(this, arguments);
    function step(next, isError) {
      let result;
      try {
        result = isError ? gen.throw(next) : gen.next(next);
      } catch (error) {
        deferred.reject(error);
        return;
      }
      if (result.done) {
        deferred.resolve(result.value);
        return;
      }
      const yielded = result.value;
      if (yielded && typeof yielded.then === "function") {
        yielded.then(function (value) { step(value, false); }, function (error) { step(error, true); });
        return;
      }
      step(yielded, false);
    }
    step(undefined, false);
    return deferred.thenable;
  };
}


const _dy_ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const _dy_playbackUserAgent = "libmpv";
const _dy_playbackHeaders = {
  "User-Agent": _dy_playbackUserAgent
};
const _dy_platformId = "douyin";
const __dy_loginGlobalKey = "__lp_plugin_douyin_1_0_13_login";
const _dy_runtime = {
  searchId: "",
  searchKeyword: ""
};
const _dy_roomIdResolveCache = Object.create(null);
const _dy_searchWebCommonQueryParts = [
  "channel=channel_pc_web",
  "update_version_code=170400",
  "pc_client_type=1",
  "pc_libra_divert=Mac",
  "support_h265=1",
  "support_dash=1",
  "version_code=170400",
  "version_name=17.4.0",
  "cookie_enabled=true",
  "screen_width=1920",
  "screen_height=1080",
  "browser_language=zh-CN",
  "browser_platform=MacIntel",
  "browser_name=Chrome",
  "browser_version=140.0.0.0",
  "browser_online=true",
  "engine_name=Blink",
  "engine_version=140.0.0.0",
  "os_name=Mac+OS",
  "os_version=10.15.7",
  "cpu_core_num=8",
  "device_memory=8",
  "platform=PC",
  "downlink=10",
  "effective_type=4g",
  "round_trip_time=100",
  "webid=7247041636524377637"
];

function _dy_request(request, authMode) {
  return _dy_httpTask({
    platformId: _dy_platformId,
    authMode: authMode || "none",
    request: request || {}
  });
}

// Host.http.request resolves a Promise. On the host JS queue that continuation
// sometimes never runs, so getRooms/getRoomDetail stop after the ttwid POST.
// Call the native bridge and continue in its callback instead.
function _dy_deferred() {
  let settleNative;
  let failNative;
  const promise = new Promise(function (resolve, reject) {
    settleNative = resolve;
    failNative = reject;
  });
  Promise.prototype.then.call(promise, function () {}, function () {});
  let settled = false;
  let failed = false;
  let value;
  const handlers = [];
  function finish(isError, next) {
    if (settled) return;
    settled = true;
    failed = isError;
    value = next;
    const pending = handlers.splice(0, handlers.length);
    for (let i = 0; i < pending.length; i++) {
      const handler = isError ? pending[i].reject : pending[i].resolve;
      if (typeof handler === "function") handler(next);
    }
    if (isError) failNative(next);
    else settleNative(next);
  }
  promise.then = function (onFulfilled, onRejected) {
    if (!settled) {
      handlers.push({ resolve: onFulfilled, reject: onRejected });
      return promise;
    }
    const handler = failed ? onRejected : onFulfilled;
    if (typeof handler === "function") handler(value);
    return promise;
  };
  return {
    thenable: promise,
    resolve: function (next) { finish(false, next); },
    reject: function (error) { finish(true, error); }
  };
}

function _dy_httpCall(request, authMode, onSuccess, onError) {
  _dy_hostHttp({
    platformId: _dy_platformId,
    authMode: authMode || "none",
    request: request || {}
  }, onSuccess, onError);
}

function _dy_requestWithSession(request) {
  return _dy_request(request, "platform_cookie");
}

function _dy_loginHelper() {
  const helper = globalThis[__dy_loginGlobalKey];
  if (!helper) {
    _dy_throw("UNSUPPORTED", "douyin login helper is unavailable", {});
  }
  return helper;
}

function _dy_throw(code, message, context) {
  if (globalThis.Host && typeof Host.raise === "function") {
    Host.raise(code, message, context || {});
  }
  if (globalThis.Host && typeof Host.makeError === "function") {
    throw Host.makeError(code || "UNKNOWN", message || "", context || {});
  }
  throw new Error(`LP_PLUGIN_ERROR:${JSON.stringify({ code: String(code || "UNKNOWN"), message: String(message || ""), context: context || {} })}`);
}

function _dy_tryDecodeURIComponent(text) {
  try {
    return decodeURIComponent(String(text || ""));
  } catch (e) {
    return String(text || "");
  }
}

function _dy_toString(v) {
  return v === undefined || v === null ? "" : String(v);
}

function _dy_normalizeCookie(cookie) {
  return _dy_toString(cookie).trim();
}

function _dy_firstURL(text) {
  const m = _dy_shareURLSource(text).match(/https?:\/\/[^\s|"'<>\\]+/);
  if (!m) return "";
  return String(m[0]).replace(/[),，。】]+$/g, "");
}

function _dy_shareURLSource(text) {
  // Decode markup/JSON separators without decoding signed percent-encoded values.
  return _dy_decodeHTMLEntities(text)
    .replace(/\\+(?:\/|u002f)/gi, "/")
    .replace(/\\+u0026/gi, "&");
}

function _dy_firstMatch(text, re) {
  const m = String(text || "").match(re);
  return m && m[1] ? String(m[1]) : "";
}

function _dy_decodeHTMLEntities(text) {
  return _dy_toString(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/");
}

function _dy_normalizeShareText(text) {
  return _dy_decodeHTMLEntities(text)
    .replace(/\\u002F/gi, "/")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\")
    .replace(/\\+$/g, "")
    .trim();
}

function _dy_isNumericId(text) {
  const s = _dy_toString(text).trim();
  return /^\d+$/.test(s);
}

function _dy_firstArrayValue(v) {
  if (Array.isArray(v) && v.length > 0) {
    return _dy_toString(v[0]);
  }
  return "";
}

function _dy_pickFirstPresentValue(values) {
  for (const value of values || []) {
    if (value === undefined || value === null) continue;
    const text = _dy_toString(value).trim();
    if (text) return text;
  }
  return "";
}

function _dy_hasPlayableStream(streamUrl) {
  const current = streamUrl || {};
  const hlsMap = current.hls_pull_url_map || {};
  const flvMap = current.flv_pull_url || {};

  return !!((((current.live_core_sdk_data || {}).pull_data || {}).stream_data)
    || current.hls_pull_url
    || current.rtmp_pull_url
    || hlsMap.origin || hlsMap.origion || hlsMap.ORIGIN || hlsMap.ORIGION
    || flvMap.origin || flvMap.origion || flvMap.ORIGIN || flvMap.ORIGION
    || hlsMap.FULL_HD1 || hlsMap.HD1 || hlsMap.SD2 || hlsMap.SD1
    || flvMap.FULL_HD1 || flvMap.HD1 || flvMap.SD2 || flvMap.SD1);
}

function _dy_pickRoomStatsWatchedCount(room, fallback) {
  const currentRoom = room || {};
  const currentStats = currentRoom.stats || {};
  const currentViewStats = currentRoom.room_view_stats || {};
  const fallbackRoom = fallback || {};
  const fallbackStats = fallbackRoom.stats || {};
  const fallbackViewStats = fallbackRoom.room_view_stats || {};

  return _dy_pickFirstPresentValue([
    currentRoom.user_count_str,
    currentStats.user_count_str,
    currentViewStats.display_short,
    currentViewStats.display_value,
    currentRoom.user_count,
    currentStats.user_count,
    fallbackRoom.user_count_str,
    fallbackStats.user_count_str,
    fallbackViewStats.display_short,
    fallbackViewStats.display_value,
    fallbackRoom.user_count,
    fallbackStats.user_count,
    fallbackRoom.online_total,
  ]);
}

function _dy_pickRoomDetailWatchedCount(room, fallback) {
  const currentRoom = room || {};
  const currentStats = currentRoom.stats || {};
  const currentViewStats = currentRoom.room_view_stats || {};
  const fallbackRoom = fallback || {};
  const fallbackStats = fallbackRoom.stats || {};
  const fallbackViewStats = fallbackRoom.room_view_stats || {};

  return _dy_pickFirstPresentValue([
    currentRoom.user_count_str,
    currentStats.user_count_str,
    currentViewStats.display_short,
    currentViewStats.display_value,
    currentRoom.user_count,
    currentStats.user_count,
    fallbackRoom.user_count_str,
    fallbackStats.user_count_str,
    fallbackViewStats.display_short,
    fallbackViewStats.display_value,
    fallbackRoom.user_count,
    fallbackStats.user_count,
    fallbackRoom.online_total,
  ]);
}

function _dy_pickSearchWatchedCount(room, raw) {
  const currentRoom = room || {};
  const currentStats = currentRoom.stats || {};
  const currentViewStats = currentRoom.room_view_stats || {};
  const rawRoom = raw || {};
  const rawStats = rawRoom.stats || {};
  const rawViewStats = rawRoom.room_view_stats || {};

  return _dy_pickFirstPresentValue([
    rawRoom.user_count,
    rawRoom.user_count_str,
    rawStats.user_count_str,
    rawViewStats.display_short,
    rawViewStats.display_value,
    currentRoom.user_count,
    currentRoom.user_count_str,
    currentStats.user_count_str,
    currentViewStats.display_short,
    currentViewStats.display_value,
  ]);
}

function _dy_extractFirstJSONObjectText(text) {
  const source = _dy_toString(text);
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (start < 0) {
      if (ch === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return "";
}

function _dy_parseEscapedStateFromScript(html) {
  const marker = '\\"state\\":{';
  const markerPos = html.indexOf(marker);
  if (markerPos < 0) return null;

  const scriptStart = html.lastIndexOf("<script", markerPos);
  const scriptTagEnd = scriptStart >= 0 ? html.indexOf(">", scriptStart) : -1;
  const scriptEnd = html.indexOf("</script>", markerPos);

  let scriptText = "";
  if (scriptTagEnd >= 0 && scriptEnd > scriptTagEnd) {
    scriptText = html.slice(scriptTagEnd + 1, scriptEnd);
  } else {
    const start = Math.max(0, markerPos - 128);
    const end = Math.min(html.length, markerPos + 350000);
    scriptText = html.slice(start, end);
  }

  const normalized = _dy_toString(scriptText)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "");

  const jsonText = _dy_extractFirstJSONObjectText(normalized);
  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    return null;
  }
}

function _dy_pickHeaders(cookie) {
  const out = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7; application/json",
    "Authority": "live.douyin.com",
    "Referer": "https://live.douyin.com",
    "User-Agent": _dy_ua
  };
  const normalizedCookie = _dy_normalizeCookie(cookie);
  if (normalizedCookie) out.Cookie = normalizedCookie;
  return out;
}

function _dy_runtimePayload(payload) {
  return payload && typeof payload === "object" ? Object.assign({}, payload) : {};
}

function _dy_getCookieValue(cookie, name) {
  const source = _dy_toString(cookie);
  if (!source || !name) return "";
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`);
  const m = source.match(re);
  return m && m[1] ? _dy_toString(m[1]) : "";
}

function _dy_appendCookieKV(cookie, name, value) {
  const normalized = _dy_normalizeCookie(cookie);
  if (!name || !value) return normalized;
  if (_dy_getCookieValue(normalized, name)) return normalized;
  if (!normalized) return `${name}=${value}`;
  return `${normalized}${normalized.endsWith(";") ? "" : ";"} ${name}=${value}`;
}

function _dy_randomString(length, charset) {
  const chars = Array.from(_dy_toString(charset));
  if (chars.length === 0 || length <= 0) return "";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function _dy_generateMsToken() {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  return _dy_randomString(184, charset);
}

function _dy_generateVerifyFp() {
  const now = Date.now().toString(36);
  const rand = _dy_randomString(36, "0123456789abcdefghijklmnopqrstuvwxyz");
  return `verify_${now}_${rand}`;
}

function _dy_objectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  try {
    return Object.keys(value).join("|");
  } catch (e) {
    return "";
  }
}

function _dy_firstNonEmptyString(values) {
  for (const value of values || []) {
    const text = _dy_toString(value);
    if (text) return text;
  }
  return "";
}

function _dy_firstNonEmptyObject(values) {
  for (const value of values || []) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function _dy_extractReflowURL(text) {
  const source = _dy_shareURLSource(text);
  if (!source) return "";
  const match = source.match(/https?:\/\/[^"'\\\s<>]*\/douyin\/webcast\/reflow\/\d+[^"'\\\s<>]*/i);
  if (!match || !match[0]) return "";
  return _dy_toString(match[0]);
}

function _dy_extractHiddenInputValue(text, name) {
  const source = _dy_toString(text);
  const inputName = _dy_toString(name).trim();
  if (!source || !inputName) return "";
  const escapedName = inputName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`<input[^>]*name=["']${escapedName}["'][^>]*value=["']([^"']*)["']`, "i"));
  return _dy_normalizeShareText(match && match[1] ? match[1] : "");
}

function _dy_extractShareRoomIds(text) {
  const source = _dy_toString(text);
  if (!source) {
    return { webRid: "", roomIdStr: "", reflowURL: "" };
  }

  return {
    webRid: _dy_firstNonEmptyString([
      _dy_firstMatch(source, /\\\"webRid\\\":\\\"(\d+)\\\"/),
      _dy_firstMatch(source, /\\\"webRid\\\":(\d+)/),
      _dy_firstMatch(source, /\\\"web_rid\\\":\\\"(\d+)\\\"/),
      _dy_firstMatch(source, /\\\"web_rid\\\":(\d+)/),
      _dy_firstMatch(source, /\\"webRid\\":(\d+)/),
      _dy_firstMatch(source, /live\.douyin\.com\/(\d+)/),
      _dy_firstMatch(source, /"webRid":"(\d+)"/),
      _dy_firstMatch(source, /"webRid":(\d+)/),
      _dy_firstMatch(source, /"web_rid":"(\d+)"/),
      _dy_firstMatch(source, /"web_rid":(\d+)/),
      _dy_firstMatch(source, /\bweb_rid=(\d+)/)
    ]),
    roomIdStr: _dy_firstNonEmptyString([
      _dy_firstMatch(source, /\\\"params\\\":\{\\\"id\\\":\\\"(\d+)\\\"/),
      _dy_firstMatch(source, /\\\"roomIdStr\\\":\\\"(\d+)\\\"/),
      _dy_firstMatch(source, /\\\"room_id_str\\\":\\\"(\d+)\\\"/),
      _dy_firstMatch(source, /\\\"roomIdsStr\\\":\[\\"?(\d+)"/),
      _dy_firstMatch(source, /douyin\/webcast\/reflow\/(\d+)/),
      _dy_firstMatch(source, /"params":\{"id":"(\d+)"/),
      _dy_firstMatch(source, /"roomIdStr":"(\d+)"/),
      _dy_firstMatch(source, /\broom_id_str=(\d+)/),
      _dy_firstMatch(source, /\broom_id=(\d+)/),
      _dy_firstMatch(source, /"roomIdsStr":\["(\d+)"/),
      _dy_firstMatch(source, /"room_id_str":"(\d+)"/),
      _dy_firstMatch(source, /"room_id_str":(\d+)/),
      _dy_firstMatch(source, /"room_id":"(\d+)"/),
      _dy_firstMatch(source, /"room_id":(\d+)/)
    ]),
    reflowURL: _dy_extractReflowURL(source)
  };
}

function _dy_mergeShareRoomIds(current, next) {
  const left = current || {};
  const right = next || {};
  return {
    webRid: _dy_firstNonEmptyString([left.webRid, right.webRid]),
    roomIdStr: _dy_firstNonEmptyString([left.roomIdStr, right.roomIdStr]),
    reflowURL: _dy_firstNonEmptyString([left.reflowURL, right.reflowURL])
  };
}

function _dy_extractShareRoomTitle(text) {
  const source = _dy_toString(text);
  return _dy_normalizeShareText(_dy_firstNonEmptyString([
    _dy_extractHiddenInputValue(source, "shareTitle"),
    _dy_firstMatch(source, /room\\":\{[\s\S]*?\\"title\\":\\"([^"]+)/),
    _dy_firstMatch(source, /"room":\{[\s\S]*?"title":"([^"]+)/)
  ]));
}

function _dy_extractShareUserName(text, roomTitle) {
  const source = _dy_toString(text);
  const title = _dy_toString(roomTitle);
  const fromTitle = title.endsWith("的直播") ? title.replace(/的直播$/, "") : "";
  return _dy_normalizeShareText(_dy_firstNonEmptyString([
    _dy_firstMatch(source, /【([^】]+)】正在直播/),
    _dy_firstMatch(source, /owner\\":\{[\s\S]*?\\"nickname\\":\\"([^"]+)/),
    _dy_firstMatch(source, /"owner":\{[\s\S]*?"nickname":"([^"]+)/),
    fromTitle
  ]));
}

function _dy_extractShareRoomCover(text) {
  const source = _dy_toString(text);
  return _dy_normalizeShareText(_dy_firstNonEmptyString([
    _dy_extractHiddenInputValue(source, "shareImage"),
    _dy_firstMatch(source, /cover\\":\{[\s\S]*?\\"urlList\\":\[\\"([^"]+)/),
    _dy_firstMatch(source, /"cover":\{[\s\S]*?"urlList":\["([^"]+)/)
  ]));
}

function _dy_extractShareUserHeadImg(text) {
  const source = _dy_toString(text);
  return _dy_normalizeShareText(_dy_firstNonEmptyString([
    _dy_firstMatch(source, /avatarThumb\\":\{\\"urlList\\":\[\\"([^"]+)/),
    _dy_firstMatch(source, /avatar_thumb\\":\{\\"url_list\\":\[\\"([^"]+)/),
    _dy_firstMatch(source, /"avatarThumb":\{"urlList":\["([^"]+)/),
    _dy_firstMatch(source, /"avatar_thumb":\{"url_list":\["([^"]+)/)
  ]));
}

function _dy_extractShareWatchedCount(text) {
  const source = _dy_toString(text);
  return _dy_normalizeShareText(_dy_firstNonEmptyString([
    _dy_firstMatch(source, /roomViewStats\\":\{[\s\S]*?\\"displayShort\\":\\"([^"]+)/),
    _dy_firstMatch(source, /"roomViewStats":\{[\s\S]*?"displayShort":"([^"]+)/),
    _dy_firstMatch(source, /stats\\":\{[\s\S]*?\\"totalUserStr\\":\\"([^"]+)/),
    _dy_firstMatch(source, /stats\\":\{[\s\S]*?\\"userCountStr\\":\\"([^"]+)/),
    _dy_firstMatch(source, /"stats":\{[\s\S]*?"totalUserStr":"([^"]+)/),
    _dy_firstMatch(source, /"stats":\{[\s\S]*?"userCountStr":"([^"]+)/)
  ]));
}

function _dy_extractShareLiveState(text) {
  const source = _dy_toString(text);
  const statusText = _dy_firstNonEmptyString([
    _dy_firstMatch(source, /room\\":\{[\s\S]*?\\"status\\":(\d+)/),
    _dy_firstMatch(source, /"room":\{[\s\S]*?"status":(\d+)/)
  ]);
  if (statusText) {
    return _dy_statusToLiveState(Number(statusText), true);
  }

  const desc = _dy_extractHiddenInputValue(source, "shareDesc");
  if (desc.includes("正在直播")) return "1";
  if (desc.includes("已结束") || desc.includes("回放")) return "0";
  return "";
}

function _dy_buildLiveModelFromShareSource(text, resolved) {
  const source = _dy_toString(text);
  if (!source) return null;

  const ids = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(source));
  const roomId = ids.webRid || "";
  const userId = ids.roomIdStr || ids.webRid || "";
  if (!roomId && !userId) return null;

  const roomTitle = _dy_extractShareRoomTitle(source);
  const userName = _dy_extractShareUserName(source, roomTitle);
  const roomCover = _dy_extractShareRoomCover(source);
  const userHeadImg = _dy_extractShareUserHeadImg(source);
  const liveWatchedCount = _dy_extractShareWatchedCount(source);
  const liveState = _dy_extractShareLiveState(source) || "1";
  const normalizedTitle = roomTitle || (userName ? `${userName}的直播` : "");

  if (!userName && !normalizedTitle && !roomCover && !userHeadImg && !liveWatchedCount) {
    return null;
  }

  return {
    userName,
    roomTitle: normalizedTitle,
    roomCover,
    userHeadImg,
    liveType: "2",
    liveState,
    userId,
    roomId,
    liveWatchedCount
  };
}

function _dy_parseJSONObjectLike(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  const text = _dy_toString(value).trim();
  if (!text || (text[0] !== "{" && text[0] !== "[")) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function _dy_buildSearchCandidateLiveModel(candidate, resolved) {
  const current = candidate || {};
  const ids = resolved || {};
  return {
    userName: _dy_toString(current.userName || ""),
    roomTitle: _dy_toString(current.roomTitle || ""),
    roomCover: _dy_toString(current.roomCover || ""),
    userHeadImg: _dy_toString(current.userHeadImg || ""),
    liveType: "2",
    liveState: "1",
    userId: _dy_toString(ids.userId || current.roomIdStr || ""),
    roomId: _dy_toString(ids.roomId || current.roomIdStr || ""),
    liveWatchedCount: _dy_toString(current.liveWatchedCount || "")
  };
}

function _dy_extractSearchCandidateFromAwemeItem(item) {
  const current = item || {};
  const aweme = current.aweme_info || (Array.isArray(current.aweme_list) ? current.aweme_list[0] : null) || {};
  const author = aweme.author || {};
  const roomIdStr = _dy_toString(author.room_id_str || author.room_id || "").trim();
  if (!_dy_isNumericId(roomIdStr) || roomIdStr === "0") return null;

  const avatar = author.avatar_larger || author.avatar_thumb || {};
  const video = aweme.video || {};
  const cover = aweme.cover || video.cover || video.origin_cover || {};

  return {
    roomIdStr,
    userName: _dy_toString(author.nickname || ""),
    roomTitle: _dy_toString(aweme.desc || author.signature || ""),
    roomCover: _dy_firstArrayValue(cover.url_list),
    userHeadImg: _dy_firstArrayValue(avatar.url_list),
    liveWatchedCount: _dy_pickFirstPresentValue([
      aweme.live_watch_count,
      ((aweme.statistics || {}).live_watch_count),
      author.room_view_stats && author.room_view_stats.display_short
    ])
  };
}

const _dy_resolveRoomIdsFromRoomIdStr = _dy_syncAsync(function* _dy_resolveRoomIdsFromRoomIdStr(roomIdStr) {
  const normalized = _dy_toString(roomIdStr).trim();
  if (!_dy_isNumericId(normalized) || normalized === "0") {
    return { roomId: "", userId: "" };
  }
  if (_dy_roomIdResolveCache[normalized]) {
    return _dy_roomIdResolveCache[normalized];
  }

  let resolved = _dy_extractShareRoomIds(`https://webcast.amemv.com/douyin/webcast/reflow/${normalized}`);
  try {
    const resp = yield _dy_requestWithSession({
      url: `https://webcast.amemv.com/douyin/webcast/reflow/${encodeURIComponent(normalized)}`,
      method: "GET",
      headers: _dy_pickHeaders(""),
      timeout: 20
    });
    resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(_dy_toString((resp && resp.url) || "")));
    resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(_dy_toString(resp && resp.bodyText)));
  } catch (e) {
  }

  const out = {
    roomId: _dy_toString(resolved.webRid || resolved.roomIdStr || normalized),
    userId: _dy_toString(resolved.roomIdStr || normalized)
  };
  _dy_roomIdResolveCache[normalized] = out;
  return out;
});


function _dy_extractLiveModelsFromUserList(item) {
  const result = [];
  const userList = Array.isArray((item || {}).user_list) ? item.user_list : [];
  for (const userItem of userList) {
    const userInfo = (userItem && userItem.user_info) || {};
    const roomData = _dy_firstNonEmptyObject([
      _dy_parseJSONObjectLike(userItem && userItem.room_data),
      _dy_parseJSONObjectLike(userInfo && userInfo.room_data),
      _dy_parseJSONObjectLike(userItem && userItem.live_info),
      _dy_parseJSONObjectLike(userInfo && userInfo.live_info),
      _dy_parseJSONObjectLike(userItem && userItem.webcast_info),
      _dy_parseJSONObjectLike(userInfo && userInfo.webcast_info),
      _dy_parseJSONObjectLike(userItem && userItem.room_info),
      _dy_parseJSONObjectLike(userInfo && userInfo.room_info)
    ]);
    const room = _dy_firstNonEmptyObject([
      roomData.room,
      roomData.data,
      roomData.room_data,
      roomData.live_info,
      roomData.webcast_info,
      roomData
    ]);
    const roomOwner = _dy_firstNonEmptyObject([roomData.owner, room.owner]);
    const avatar = userInfo.avatar_larger || userInfo.avatar_thumb || {};
    const cover = room.cover || roomData.cover || roomData.room_cover || {};
    const streamURL = room.stream_url || roomData.stream_url || {};
    const roomId = _dy_firstNonEmptyString([
      room.web_rid,
      room.room_id,
      room.id_str,
      room.id,
      room.room_id_str,
      roomData.web_rid,
      roomData.room_id,
      roomData.id_str,
      roomData.room_id_str,
      roomOwner.web_rid,
      userInfo.web_rid,
      userInfo.room_id,
      userInfo.room_id_str,
      userItem.room_id,
      userItem.room_id_str,
      userInfo.roomId
    ]);
    const userId = _dy_firstNonEmptyString([
      room.id_str,
      room.room_id_str,
      room.room_id,
      roomData.id_str,
      roomData.room_id_str,
      roomData.room_id,
      userInfo.room_id_str,
      userItem.room_id_str,
      userInfo.room_id,
      userItem.room_id,
      roomOwner.id_str,
      userInfo.uid,
      userInfo.user_id,
      roomId
    ]);
    if (!roomId) continue;
    const status = Number(room.status || roomData.status || roomData.live_status || userItem.live_status || 0);
    const hasStream = _dy_hasPlayableStream(streamURL);
    result.push({
      userName: _dy_toString(userInfo.nickname || roomOwner.nickname || ""),
      roomTitle: _dy_toString(room.title || roomData.title || roomData.room_title || userInfo.signature || ""),
      roomCover: _dy_firstArrayValue(cover.url_list),
      userHeadImg: _dy_firstArrayValue(avatar.url_list),
      liveType: "2",
      liveState: _dy_statusToLiveState(status, hasStream),
      userId,
      roomId,
      liveWatchedCount: _dy_pickRoomDetailWatchedCount(room, roomData)
    });
  }
  return result;
}

function _dy_signDetail(queryString) {
  const query = _dy_toString(queryString);
  if (!query) _dy_throw("INVALID_ARGS", "queryString is empty", { field: "queryString" });
  // Prefer bdms/fn150 signer (2.0.3+); fall back to classic sign_datail.
  if (typeof globalThis.__lp_douyin_abogus_sign === "function") {
    try {
      const token = _dy_toString(globalThis.__lp_douyin_abogus_sign(query, _dy_ua));
      if (token) return token;
    } catch (e) {
    }
  }
  if (typeof sign_datail !== "function") {
    _dy_throw("PARSE", "sign_datail is not available in douyin plugin");
  }
  return _dy_toString(sign_datail(query, _dy_ua));
}

function _dy_signClassicDetail(query) {
  // sign_datail itself prefers the SDK; call the original algorithm directly
  // without toggling global signers shared by concurrent account/login calls.
  return _ab_generateAbogus(_dy_toString(query));
}

const _dy_category_cache = {
  version: "",
  built: null,
  builtAt: 0
};

const _dy_category_source = {"version":"2025-01","description":"抖音直播分类数据（本地缓存）","categoryData":[{"partition":{"id_str":"101","type":4,"title":"聊天"},"sub_partition":[]},{"partition":{"id_str":"102","type":4,"title":"音乐"},"sub_partition":[]},{"partition":{"id_str":"103","type":4,"title":"游戏"},"sub_partition":[{"partition":{"id_str":"1","type":1,"title":"射击游戏"},"sub_partition":[{"partition":{"id_str":"1010032","type":1,"title":"和平精英"},"sub_partition":[]},{"partition":{"id_str":"1010037","type":1,"title":"穿越火线"},"sub_partition":[]},{"partition":{"id_str":"1011032","type":1,"title":"三角洲行动"},"sub_partition":[]},{"partition":{"id_str":"1010213","type":1,"title":"逆战手游"},"sub_partition":[]},{"partition":{"id_str":"1010017","type":1,"title":"无畏契约"},"sub_partition":[]},{"partition":{"id_str":"1010026","type":1,"title":"绝地求生"},"sub_partition":[]},{"partition":{"id_str":"1010003","type":1,"title":"CSGO"},"sub_partition":[]},{"partition":{"id_str":"1011309","type":1,"title":"无畏契约：源能行动"},"sub_partition":[]},{"partition":{"id_str":"1010015","type":1,"title":"穿越火线：枪战王者"},"sub_partition":[]},{"partition":{"id_str":"1011124","type":1,"title":"暗区突围：无限"},"sub_partition":[]},{"partition":{"id_str":"1010018","type":1,"title":"暗区突围"},"sub_partition":[]},{"partition":{"id_str":"1010002","type":1,"title":"Apex英雄"},"sub_partition":[]},{"partition":{"id_str":"1010339","type":1,"title":"守望先锋"},"sub_partition":[]},{"partition":{"id_str":"1010080","type":1,"title":"使命召唤手游"},"sub_partition":[]},{"partition":{"id_str":"1010132","type":1,"title":"逆战"},"sub_partition":[]},{"partition":{"id_str":"1010104","type":1,"title":"逃离塔科夫"},"sub_partition":[]},{"partition":{"id_str":"1010336","type":1,"title":"反恐精英OL"},"sub_partition":[]},{"partition":{"id_str":"1010214","type":1,"title":"萤火突击"},"sub_partition":[]},{"partition":{"id_str":"1010064","type":1,"title":"荒野行动"},"sub_partition":[]},{"partition":{"id_str":"1010329","type":1,"title":"使命召唤"},"sub_partition":[]},{"partition":{"id_str":"1010260","type":1,"title":"解限机"},"sub_partition":[]},{"partition":{"id_str":"1010593","type":1,"title":"The Finals"},"sub_partition":[]},{"partition":{"id_str":"1010409","type":1,"title":"生死狙击"},"sub_partition":[]},{"partition":{"id_str":"1010068","type":1,"title":"生死狙击2"},"sub_partition":[]},{"partition":{"id_str":"1010187","type":1,"title":"远光84"},"sub_partition":[]},{"partition":{"id_str":"1010367","type":1,"title":"战地1"},"sub_partition":[]},{"partition":{"id_str":"1010198","type":1,"title":"高能英雄"},"sub_partition":[]},{"partition":{"id_str":"1010168","type":1,"title":"卡拉彼丘"},"sub_partition":[]},{"partition":{"id_str":"1010402","type":1,"title":"彩虹六号：围攻"},"sub_partition":[]},{"partition":{"id_str":"1010383","type":1,"title":"堡垒之夜"},"sub_partition":[]},{"partition":{"id_str":"1010445","type":1,"title":"战术小队"},"sub_partition":[]},{"partition":{"id_str":"1010144","type":1,"title":"超凡先锋"},"sub_partition":[]}]},{"partition":{"id_str":"2","type":1,"title":"竞技游戏"},"sub_partition":[{"partition":{"id_str":"1010005","type":1,"title":"云顶之弈"},"sub_partition":[]},{"partition":{"id_str":"1010014","type":1,"title":"英雄联盟"},"sub_partition":[]},{"partition":{"id_str":"1010016","type":1,"title":"永劫无间"},"sub_partition":[]},{"partition":{"id_str":"1010041","type":1,"title":"第五人格"},"sub_partition":[]},{"partition":{"id_str":"1010055","type":1,"title":"金铲铲之战"},"sub_partition":[]},{"partition":{"id_str":"1010045","type":1,"title":"王者荣耀"},"sub_partition":[]},{"partition":{"id_str":"1010023","type":1,"title":"英雄联盟手游"},"sub_partition":[]},{"partition":{"id_str":"1010350","type":1,"title":"魔兽争霸3"},"sub_partition":[]},{"partition":{"id_str":"1010007","type":1,"title":"巅峰极速"},"sub_partition":[]},{"partition":{"id_str":"1010146","type":1,"title":"QQ飞车端游"},"sub_partition":[]},{"partition":{"id_str":"1010341","type":1,"title":"DOTA1"},"sub_partition":[]},{"partition":{"id_str":"1010278","type":1,"title":"永劫无间手游"},"sub_partition":[]},{"partition":{"id_str":"1010093","type":1,"title":"DOTA2"},"sub_partition":[]},{"partition":{"id_str":"1010340","type":1,"title":"坦克世界"},"sub_partition":[]},{"partition":{"id_str":"1010397","type":1,"title":"炉石传说"},"sub_partition":[]},{"partition":{"id_str":"1010102","type":1,"title":"红色警戒2"},"sub_partition":[]},{"partition":{"id_str":"1010033","type":1,"title":"QQ飞车手游"},"sub_partition":[]},{"partition":{"id_str":"1010131","type":1,"title":"跑跑卡丁车官方竞速版"},"sub_partition":[]},{"partition":{"id_str":"1010313","type":1,"title":"狼人杀"},"sub_partition":[]},{"partition":{"id_str":"1010170","type":1,"title":"战争雷霆"},"sub_partition":[]},{"partition":{"id_str":"1010292","type":1,"title":"决胜巅峰"},"sub_partition":[]},{"partition":{"id_str":"1010061","type":1,"title":"三国杀"},"sub_partition":[]},{"partition":{"id_str":"1010483","type":1,"title":"星际争霸"},"sub_partition":[]},{"partition":{"id_str":"1010331","type":1,"title":"跑跑卡丁车"},"sub_partition":[]},{"partition":{"id_str":"1010686","type":1,"title":"极品飞车：集结"},"sub_partition":[]},{"partition":{"id_str":"1010235","type":1,"title":"王者万象棋"},"sub_partition":[]},{"partition":{"id_str":"1010435","type":1,"title":"至暗时刻"},"sub_partition":[]},{"partition":{"id_str":"1010418","type":1,"title":"战舰世界"},"sub_partition":[]},{"partition":{"id_str":"1010430","type":1,"title":"恐惧饥荒"},"sub_partition":[]},{"partition":{"id_str":"1010429","type":1,"title":"极限竞速：地平线5"},"sub_partition":[]},{"partition":{"id_str":"1010509","type":1,"title":"星际争霸2"},"sub_partition":[]},{"partition":{"id_str":"1010524","type":1,"title":"王牌竞速"},"sub_partition":[]},{"partition":{"id_str":"1010180","type":1,"title":"全明星街球派对"},"sub_partition":[]},{"partition":{"id_str":"1010230","type":1,"title":"皇室战争"},"sub_partition":[]},{"partition":{"id_str":"1010057","type":1,"title":"决战！平安京"},"sub_partition":[]},{"partition":{"id_str":"1010030","type":1,"title":"实况足球"},"sub_partition":[]},{"partition":{"id_str":"1010327","type":1,"title":"猫和老鼠"},"sub_partition":[]},{"partition":{"id_str":"1010054","type":1,"title":"哈利波特：魔法觉醒"},"sub_partition":[]},{"partition":{"id_str":"1010058","type":1,"title":"逃跑吧！少年"},"sub_partition":[]},{"partition":{"id_str":"1010138","type":1,"title":"荒野乱斗"},"sub_partition":[]},{"partition":{"id_str":"1010395","type":1,"title":"坦克世界：闪电战"},"sub_partition":[]},{"partition":{"id_str":"1010353","type":1,"title":"极限竞速：地平线4"},"sub_partition":[]},{"partition":{"id_str":"1010107","type":1,"title":"最强NBA"},"sub_partition":[]},{"partition":{"id_str":"1010264","type":1,"title":"极品飞车"},"sub_partition":[]},{"partition":{"id_str":"1010381","type":1,"title":"曙光英雄"},"sub_partition":[]},{"partition":{"id_str":"1010510","type":1,"title":"红色警戒3"},"sub_partition":[]}]},{"partition":{"id_str":"3","type":1,"title":"单机游戏"},"sub_partition":[{"partition":{"id_str":"1010324","type":1,"title":"植物大战僵尸"},"sub_partition":[]},{"partition":{"id_str":"1010791","type":1,"title":"星露谷物语"},"sub_partition":[]},{"partition":{"id_str":"1011359","type":1,"title":"流放之路2"},"sub_partition":[]},{"partition":{"id_str":"1010358","type":1,"title":"黑神话：悟空"},"sub_partition":[]},{"partition":{"id_str":"1011048","type":1,"title":"俄罗斯钓鱼4"},"sub_partition":[]},{"partition":{"id_str":"1011393","type":1,"title":"Half Sword"},"sub_partition":[]},{"partition":{"id_str":"1010100","type":1,"title":"方舟"},"sub_partition":[]},{"partition":{"id_str":"1010250","type":1,"title":"星际战甲"},"sub_partition":[]},{"partition":{"id_str":"1010335","type":1,"title":"饥荒"},"sub_partition":[]},{"partition":{"id_str":"1010087","type":1,"title":"艾尔登法环"},"sub_partition":[]},{"partition":{"id_str":"1010038","type":1,"title":"猛兽派对"},"sub_partition":[]},{"partition":{"id_str":"1010593","type":1,"title":"The Finals"},"sub_partition":[]},{"partition":{"id_str":"1010149","type":1,"title":"只狼：影逝二度"},"sub_partition":[]},{"partition":{"id_str":"1010981","type":1,"title":"幻兽帕鲁"},"sub_partition":[]},{"partition":{"id_str":"1010783","type":1,"title":"森林之子"},"sub_partition":[]},{"partition":{"id_str":"1010363","type":1,"title":"荒野大镖客2"},"sub_partition":[]},{"partition":{"id_str":"1010326","type":1,"title":"人渣"},"sub_partition":[]},{"partition":{"id_str":"1010361","type":1,"title":"街头霸王6"},"sub_partition":[]},{"partition":{"id_str":"1010429","type":1,"title":"极限竞速：地平线5"},"sub_partition":[]},{"partition":{"id_str":"1010401","type":1,"title":"骑马与砍杀2：霸主"},"sub_partition":[]},{"partition":{"id_str":"1011136","type":1,"title":"掘地求升"},"sub_partition":[]},{"partition":{"id_str":"1011119","type":1,"title":"英雄无敌3"},"sub_partition":[]},{"partition":{"id_str":"1010396","type":1,"title":"泰拉瑞亚"},"sub_partition":[]},{"partition":{"id_str":"1010779","type":1,"title":"全面战争：三国"},"sub_partition":[]},{"partition":{"id_str":"1010171","type":1,"title":"女神异闻录5"},"sub_partition":[]},{"partition":{"id_str":"1010847","type":1,"title":"宝可梦朱紫"},"sub_partition":[]},{"partition":{"id_str":"1010334","type":1,"title":"拳皇97"},"sub_partition":[]},{"partition":{"id_str":"1010774","type":1,"title":"仁王"},"sub_partition":[]},{"partition":{"id_str":"1010030","type":1,"title":"实况足球"},"sub_partition":[]},{"partition":{"id_str":"1010081","type":1,"title":"塞尔达传说：旷野之息"},"sub_partition":[]},{"partition":{"id_str":"1010514","type":1,"title":"三国志14"},"sub_partition":[]},{"partition":{"id_str":"1010367","type":1,"title":"战地1"},"sub_partition":[]},{"partition":{"id_str":"1011000","type":1,"title":"绝地潜兵2"},"sub_partition":[]},{"partition":{"id_str":"1010436","type":1,"title":"双影奇境"},"sub_partition":[]},{"partition":{"id_str":"1010360","type":1,"title":"空洞骑士：丝之歌"},"sub_partition":[]},{"partition":{"id_str":"1011304","type":1,"title":"怪物猎人：荒野"},"sub_partition":[]},{"partition":{"id_str":"1010142","type":1,"title":"都市：天际线"},"sub_partition":[]},{"partition":{"id_str":"1011170","type":1,"title":"链在一起"},"sub_partition":[]},{"partition":{"id_str":"1010424","type":1,"title":"古墓丽影：暗影"},"sub_partition":[]},{"partition":{"id_str":"1010320","type":1,"title":"匹诺曹的谎言"},"sub_partition":[]},{"partition":{"id_str":"1010128","type":1,"title":"赛博朋克2077"},"sub_partition":[]},{"partition":{"id_str":"1011238","type":1,"title":"超级兔子人"},"sub_partition":[]},{"partition":{"id_str":"1010411","type":1,"title":"流放之路"},"sub_partition":[]},{"partition":{"id_str":"1011399","type":1,"title":"天国拯救2"},"sub_partition":[]},{"partition":{"id_str":"1010626","type":1,"title":"潜水员戴夫"},"sub_partition":[]},{"partition":{"id_str":"1010408","type":1,"title":"木筏求生"},"sub_partition":[]},{"partition":{"id_str":"1010130","type":1,"title":"人类：一败涂地"},"sub_partition":[]},{"partition":{"id_str":"1010485","type":1,"title":"刺客信条：奥德赛"},"sub_partition":[]},{"partition":{"id_str":"1010846","type":1,"title":"致命公司"},"sub_partition":[]},{"partition":{"id_str":"1010353","type":1,"title":"极限竞速：地平线4"},"sub_partition":[]},{"partition":{"id_str":"1010082","type":1,"title":"塞尔达传说：王国之泪"},"sub_partition":[]},{"partition":{"id_str":"1011366","type":1,"title":"去上班"},"sub_partition":[]},{"partition":{"id_str":"1010515","type":1,"title":"三国志11"},"sub_partition":[]}]},{"partition":{"id_str":"4","type":1,"title":"棋牌游戏"},"sub_partition":[{"partition":{"id_str":"1010040","type":1,"title":"指尖四川麻将"},"sub_partition":[]},{"partition":{"id_str":"1010004","type":1,"title":"JJ斗地主"},"sub_partition":[]},{"partition":{"id_str":"1010063","type":1,"title":"JJ象棋"},"sub_partition":[]},{"partition":{"id_str":"1010094","type":1,"title":"JJ麻将"},"sub_partition":[]},{"partition":{"id_str":"1010062","type":1,"title":"欢乐斗地主"},"sub_partition":[]},{"partition":{"id_str":"1010060","type":1,"title":"天天象棋"},"sub_partition":[]},{"partition":{"id_str":"1010012","type":1,"title":"途游斗地主"},"sub_partition":[]},{"partition":{"id_str":"1010714","type":1,"title":"微乐斗地主"},"sub_partition":[]},{"partition":{"id_str":"1010028","type":1,"title":"芒果斗地主"},"sub_partition":[]},{"partition":{"id_str":"1010711","type":1,"title":"开运麻将"},"sub_partition":[]},{"partition":{"id_str":"1010710","type":1,"title":"微乐四川麻将"},"sub_partition":[]},{"partition":{"id_str":"1010721","type":1,"title":"多乐升级"},"sub_partition":[]},{"partition":{"id_str":"1010059","type":1,"title":"腾讯欢乐麻将"},"sub_partition":[]},{"partition":{"id_str":"1010720","type":1,"title":"多乐够级"},"sub_partition":[]},{"partition":{"id_str":"1010098","type":1,"title":"禅游斗地主"},"sub_partition":[]}]},{"partition":{"id_str":"5","type":1,"title":"休闲益智"},"sub_partition":[{"partition":{"id_str":"1010022","type":1,"title":"我的世界"},"sub_partition":[]},{"partition":{"id_str":"1010011","type":1,"title":"蛋仔派对"},"sub_partition":[]},{"partition":{"id_str":"1011640","type":1,"title":"鹅鸭杀（手游）"},"sub_partition":[]},{"partition":{"id_str":"1010806","type":1,"title":"天天台球"},"sub_partition":[]},{"partition":{"id_str":"1010263","type":1,"title":"元梦之星"},"sub_partition":[]},{"partition":{"id_str":"1010010","type":1,"title":"球球大作战"},"sub_partition":[]},{"partition":{"id_str":"1010520","type":1,"title":"开心消消乐"},"sub_partition":[]},{"partition":{"id_str":"1010895","type":1,"title":"群雄逐鹿"},"sub_partition":[]},{"partition":{"id_str":"1010129","type":1,"title":"忍者必须死3"},"sub_partition":[]},{"partition":{"id_str":"1010046","type":1,"title":"迷你世界"},"sub_partition":[]},{"partition":{"id_str":"1010056","type":1,"title":"贪吃蛇大作战"},"sub_partition":[]},{"partition":{"id_str":"1010921","type":1,"title":"台球帝国"},"sub_partition":[]},{"partition":{"id_str":"1010099","type":1,"title":"地铁跑酷"},"sub_partition":[]},{"partition":{"id_str":"1010410","type":1,"title":"天天酷跑"},"sub_partition":[]}]},{"partition":{"id_str":"6","type":1,"title":"角色扮演"},"sub_partition":[{"partition":{"id_str":"1010053","type":1,"title":"梦幻西游"},"sub_partition":[]},{"partition":{"id_str":"1010051","type":1,"title":"梦幻西游手游"},"sub_partition":[]},{"partition":{"id_str":"1010039","type":1,"title":"原神"},"sub_partition":[]},{"partition":{"id_str":"1010150","type":1,"title":"魔兽世界"},"sub_partition":[]},{"partition":{"id_str":"1010190","type":1,"title":"明日方舟：终末地"},"sub_partition":[]},{"partition":{"id_str":"1010271","type":1,"title":"燕云十六声"},"sub_partition":[]},{"partition":{"id_str":"1010205","type":1,"title":"大话西游2"},"sub_partition":[]},{"partition":{"id_str":"1010092","type":1,"title":"地下城与勇士"},"sub_partition":[]},{"partition":{"id_str":"1010042","type":1,"title":"火影忍者手游"},"sub_partition":[]},{"partition":{"id_str":"1010241","type":1,"title":"火炬之光：无限"},"sub_partition":[]},{"partition":{"id_str":"1010159","type":1,"title":"鸣潮"},"sub_partition":[]},{"partition":{"id_str":"1010083","type":1,"title":"逆水寒手游"},"sub_partition":[]},{"partition":{"id_str":"1010234","type":1,"title":"地下城与勇士：起源"},"sub_partition":[]},{"partition":{"id_str":"1010035","type":1,"title":"光遇"},"sub_partition":[]},{"partition":{"id_str":"1010249","type":1,"title":"剑网3"},"sub_partition":[]},{"partition":{"id_str":"1010006","type":1,"title":"明日之后"},"sub_partition":[]},{"partition":{"id_str":"1010116","type":1,"title":"问道"},"sub_partition":[]},{"partition":{"id_str":"1010558","type":1,"title":"七日世界"},"sub_partition":[]},{"partition":{"id_str":"1010151","type":1,"title":"诛仙世界"},"sub_partition":[]},{"partition":{"id_str":"1010143","type":1,"title":"大话西游"},"sub_partition":[]},{"partition":{"id_str":"1010233","type":1,"title":"命运方舟"},"sub_partition":[]},{"partition":{"id_str":"1010155","type":1,"title":"绝区零"},"sub_partition":[]},{"partition":{"id_str":"1010364","type":1,"title":"逆水寒"},"sub_partition":[]},{"partition":{"id_str":"1010250","type":1,"title":"星际战甲"},"sub_partition":[]},{"partition":{"id_str":"1010203","type":1,"title":"洛克王国"},"sub_partition":[]},{"partition":{"id_str":"1010253","type":1,"title":"无限暖暖"},"sub_partition":[]},{"partition":{"id_str":"1010049","type":1,"title":"梦幻西游网页版"},"sub_partition":[]},{"partition":{"id_str":"1010149","type":1,"title":"只狼：影逝二度"},"sub_partition":[]},{"partition":{"id_str":"1010119","type":1,"title":"天涯明月刀"},"sub_partition":[]},{"partition":{"id_str":"1010568","type":1,"title":"新大话西游3"},"sub_partition":[]},{"partition":{"id_str":"1011139","type":1,"title":"航海王：壮志雄心"},"sub_partition":[]},{"partition":{"id_str":"1010533","type":1,"title":"妄想山海"},"sub_partition":[]},{"partition":{"id_str":"1010096","type":1,"title":"暗黑破坏神：不朽"},"sub_partition":[]},{"partition":{"id_str":"1010024","type":1,"title":"月圆之夜"},"sub_partition":[]},{"partition":{"id_str":"1010311","type":1,"title":"冒险岛：枫之传说"},"sub_partition":[]},{"partition":{"id_str":"1010256","type":1,"title":"诛仙2"},"sub_partition":[]},{"partition":{"id_str":"1010097","type":1,"title":"长安幻想"},"sub_partition":[]},{"partition":{"id_str":"1010231","type":1,"title":"航海王热血航线"},"sub_partition":[]},{"partition":{"id_str":"1010171","type":1,"title":"女神异闻录5"},"sub_partition":[]},{"partition":{"id_str":"1010631","type":1,"title":"境·界 刀鸣"},"sub_partition":[]},{"partition":{"id_str":"1010193","type":1,"title":"星球：重启"},"sub_partition":[]},{"partition":{"id_str":"1010044","type":1,"title":"晶核"},"sub_partition":[]},{"partition":{"id_str":"1010320","type":1,"title":"匹诺曹的谎言"},"sub_partition":[]},{"partition":{"id_str":"1010257","type":1,"title":"新完美世界"},"sub_partition":[]},{"partition":{"id_str":"1010411","type":1,"title":"流放之路"},"sub_partition":[]},{"partition":{"id_str":"1010405","type":1,"title":"激战2"},"sub_partition":[]},{"partition":{"id_str":"1010675","type":1,"title":"时空猎人3"},"sub_partition":[]}]},{"partition":{"id_str":"7","type":1,"title":"策略卡牌"},"sub_partition":[{"partition":{"id_str":"1010013","type":1,"title":"明日方舟"},"sub_partition":[]},{"partition":{"id_str":"1010324","type":1,"title":"植物大战僵尸"},"sub_partition":[]},{"partition":{"id_str":"1010043","type":1,"title":"崩坏：星穹铁道"},"sub_partition":[]},{"partition":{"id_str":"1010160","type":1,"title":"少女前线2：追放"},"sub_partition":[]},{"partition":{"id_str":"1010025","type":1,"title":"阴阳师"},"sub_partition":[]},{"partition":{"id_str":"1010009","type":1,"title":"三国志·战略版"},"sub_partition":[]},{"partition":{"id_str":"1010021","type":1,"title":"率土之滨"},"sub_partition":[]},{"partition":{"id_str":"1010067","type":1,"title":"植物大战僵尸2"},"sub_partition":[]},{"partition":{"id_str":"1010365","type":1,"title":"斗罗大陆：魂师对决"},"sub_partition":[]},{"partition":{"id_str":"1010084","type":1,"title":"恋与深空"},"sub_partition":[]},{"partition":{"id_str":"1010145","type":1,"title":"部落冲突"},"sub_partition":[]},{"partition":{"id_str":"1010105","type":1,"title":"万国觉醒"},"sub_partition":[]},{"partition":{"id_str":"1010419","type":1,"title":"奥奇传说"},"sub_partition":[]},{"partition":{"id_str":"1010287","type":1,"title":"大话西游：归来"},"sub_partition":[]},{"partition":{"id_str":"1010515","type":1,"title":"三国志11"},"sub_partition":[]},{"partition":{"id_str":"1010196","type":1,"title":"重返未来1999"},"sub_partition":[]}]}]},{"partition":{"id_str":"104","type":4,"title":"二次元"},"sub_partition":[]},{"partition":{"id_str":"105","type":4,"title":"舞蹈"},"sub_partition":[]},{"partition":{"id_str":"106","type":4,"title":"文化"},"sub_partition":[]},{"partition":{"id_str":"107","type":4,"title":"生活"},"sub_partition":[]},{"partition":{"id_str":"108","type":4,"title":"运动"},"sub_partition":[]}]};

function _dy_fallbackCategories() {
  return [
    {
      id: "101",
      title: "聊天",
      icon: "",
      biz: "",
      subList: [{ id: "101", parentId: "4", title: "聊天", icon: "", biz: "" }]
    },
    {
      id: "102",
      title: "音乐",
      icon: "",
      biz: "",
      subList: [{ id: "102", parentId: "4", title: "音乐", icon: "", biz: "" }]
    },
    {
      id: "103",
      title: "游戏",
      icon: "",
      biz: "",
      subList: [
        { id: "1010045", parentId: "1", title: "王者荣耀", icon: "", biz: "" },
        { id: "1010014", parentId: "1", title: "英雄联盟", icon: "", biz: "" },
        { id: "1010032", parentId: "1", title: "和平精英", icon: "", biz: "" }
      ]
    },
    {
      id: "104",
      title: "娱乐天地",
      icon: "",
      biz: "",
      subList: [{ id: "104", parentId: "4", title: "娱乐天地", icon: "", biz: "" }]
    }
  ];
}

function _dy_makeCategoryNode(partition, parentIdOverride) {
  const node = partition && typeof partition === "object" ? partition : {};
  const id = _dy_toString(node.id_str);
  if (!id) return null;
  const parentIdValue = parentIdOverride === undefined || parentIdOverride === null
    ? node.type
    : parentIdOverride;
  return {
    id,
    parentId: _dy_toString(parentIdValue),
    title: _dy_toString(node.title),
    icon: "",
    biz: ""
  };
}

function _dy_buildCategoriesFromSource(source) {
  const categoryData = Array.isArray((source || {}).categoryData) ? source.categoryData : [];
  const result = [];

  for (const item of categoryData) {
    const partition = (item && item.partition) || {};
    const mainId = _dy_toString(partition.id_str);
    const mainTitle = _dy_toString(partition.title);
    if (!mainId || !mainTitle) continue;

    const subPartition = Array.isArray(item && item.sub_partition) ? item.sub_partition : null;

    if (subPartition && subPartition.length === 0) {
      const node = _dy_makeCategoryNode(partition, partition.type);
      if (!node) continue;
      result.push({
        id: mainId,
        title: mainTitle,
        icon: "",
        biz: "",
        subList: [node]
      });
      continue;
    }

    if (!subPartition) {
      continue;
    }

    if (subPartition.length === 0) {
      const node = _dy_makeCategoryNode(partition, mainId);
      if (!node) continue;
      result.push({
        id: mainId,
        title: mainTitle,
        icon: "",
        biz: "",
        subList: [node]
      });
      continue;
    }

    const subList = [];

    for (const subItem of subPartition) {
      const subNodePartition = (subItem && subItem.partition) || {};
      const subNode = _dy_makeCategoryNode(subNodePartition, subNodePartition.type);
      if (!subNode) continue;

      const thirdPartition = Array.isArray(subItem && subItem.sub_partition) ? subItem.sub_partition : null;
      if (thirdPartition && thirdPartition.length > 0) {
        const thirdList = [];
        for (const thirdItem of thirdPartition) {
          const thirdNodePartition = (thirdItem && thirdItem.partition) || {};
          const thirdNode = _dy_makeCategoryNode(thirdNodePartition, thirdNodePartition.type);
          if (thirdNode) thirdList.push(thirdNode);
        }
        if (thirdList.length > 0) {
          result.push({
            id: _dy_toString(subNodePartition.id_str),
            title: _dy_toString(subNodePartition.title),
            icon: "",
            biz: "",
            subList: thirdList
          });
        }
      } else {
        subList.push(subNode);
      }
    }

    if (subList.length > 0) {
      result.push({
        id: mainId,
        title: mainTitle,
        icon: "",
        biz: "",
        subList
      });
    }
  }

  return result;
}

function _dy_defaultCategories() {
  const sourceVersion = _dy_toString((_dy_category_source || {}).version);
  if (_dy_category_cache.built && _dy_category_cache.version === sourceVersion) {
    return _dy_category_cache.built;
  }

  const built = _dy_buildCategoriesFromSource(_dy_category_source);
  const resolved = built.length > 0 ? built : _dy_fallbackCategories();
  _dy_category_cache.version = sourceVersion;
  _dy_category_cache.built = resolved;
  _dy_category_cache.builtAt = Date.now();
  return resolved;
}
function _dy_statusToLiveState(status, hasStream) {
  const s = Number(status || 0);
  if (s === 2) return hasStream ? "1" : "0";
  if (s === 4) return "0";
  return "3";
}

function _dy_buildLiveModel(roomData, explicitRoomId) {
  const room = (roomData && roomData.room) || {};
  const roomInfo = (roomData && roomData.roomInfo) || {};
  const owner = room.owner || {};
  const anchor = roomInfo.anchor || {};
  const streamUrl = room.stream_url || {};
  const hasStream = _dy_hasPlayableStream(streamUrl);

  const status = Number(room.status || 0);
  const activeOwner = status === 2 ? owner : anchor;
  const cover = room.cover || {};
  const avatar = activeOwner.avatar_thumb || {};

  const userId = _dy_toString(room.id_str || activeOwner.id_str || "");
  const webRid = _dy_toString(activeOwner.web_rid || explicitRoomId || room.id_str || "");

  return {
    userName: _dy_toString(activeOwner.nickname || ""),
    roomTitle: _dy_toString(room.title || ""),
    roomCover: _dy_firstArrayValue(cover.url_list),
    userHeadImg: _dy_firstArrayValue(avatar.url_list),
    liveType: "2",
    liveState: _dy_statusToLiveState(status, hasStream),
    userId,
    roomId: webRid,
    liveWatchedCount: _dy_pickRoomDetailWatchedCount(room, roomInfo.room || roomInfo)
  };
}

function _dy_getPlaybackQualityMeta(parsed, fallbackOptions) {
  const labelMap = {
    origin: "原画",
    uhd: "蓝光",
    hd: "超清",
    sd: "高清",
    ld: "标清",
    md: "流畅",
    ao: "音频",
    audio: "音频"
  };
  const rankMap = {
    origin: 500,
    uhd: 400,
    hd: 300,
    sd: 200,
    ld: 100,
    md: 50,
    ao: 10,
    audio: 10
  };
  const infoMap = Object.create(null);
  const parsedOptions = (parsed && parsed.options) || {};

  function applyQuality(item, isDefault) {
    const key = _dy_toString(item && item.sdk_key).trim();
    if (!key) return;

    const title = _dy_toString(item && item.name).trim();
    const level = Number(item && item.level);
    if (title && (!isDefault || !labelMap[key])) labelMap[key] = title;
    if (!Number.isNaN(level) && level > 0) rankMap[key] = level * 100;

    const current = infoMap[key] || {};
    const fps = Number(item && item.fps);
    const bitrate = Number(item && item.v_bit_rate);
    const resolution = _dy_toString(item && item.resolution).trim();
    const codec = _dy_toString(item && item.v_codec).trim();
    if (!Number.isNaN(fps) && fps > 0) current.fps = fps;
    if (!Number.isNaN(bitrate) && bitrate > 0) current.vBitRate = bitrate;
    if (resolution) current.resolution = resolution;
    if (codec) current.vCodec = codec;
    infoMap[key] = current;
  }

  [fallbackOptions || {}, parsedOptions].forEach(function (options) {
    const qualities = Array.isArray(options.qualities) ? options.qualities : [];
    qualities.forEach(function (item) { applyQuality(item, false); });
    applyQuality(options.default_quality || {}, true);
  });

  return { labelMap, rankMap, infoMap };
}

function _dy_formatPlaybackQualityTitle(title, qualityInfo) {
  const baseTitle = _dy_toString(title).trim();
  const fps = Number(qualityInfo && qualityInfo.fps);
  if (!Number.isNaN(fps) && fps > 30 && !/(?:\d+\s*帧|\d+\s*fps)/i.test(baseTitle)) {
    return `${baseTitle} ${Math.round(fps)}帧`;
  }
  return baseTitle;
}

function _dy_collectPlaybackLineDefs(commonLines, data) {
  const lineDefs = [];

  function pushLine(lineKey) {
    const key = _dy_toString(lineKey).trim();
    if (!key) return;
    if (lineDefs.some(function (item) { return item.key === key; })) return;

    let cdn = "";
    if (key === "main") {
      cdn = "主线路";
    } else if (key === "backup") {
      cdn = "备用线路";
    } else {
      cdn = `线路 ${lineDefs.length + 1}`;
    }

    lineDefs.push({ key, cdn });
  }

  Object.keys(commonLines || {}).forEach(function (lineKey) {
    pushLine(lineKey);
  });

  Object.keys(data || {}).forEach(function (qualityKey) {
    const quality = data[qualityKey] || {};
    Object.keys(quality).forEach(function (lineKey) {
      const lineStream = quality[lineKey];
      if (!lineStream || typeof lineStream !== "object" || Array.isArray(lineStream)) return;
      if (!lineStream.flv && !lineStream.hls) return;
      pushLine(lineKey);
    });
  });

  return lineDefs;
}

function _dy_makePlaybackVariant(roomId, title, rank, protocol, url, qualityInfo) {
  const resolvedURL = _dy_toString(url).trim();
  if (!resolvedURL) return null;

  const info = qualityInfo || {};
  const fps = Number(info.fps || 0);
  const displayTitle = _dy_formatPlaybackQualityTitle(title, info);
  const requestContext = {
    rate: String(rank || 0),
    qn: String(rank || 0),
    streamType: protocol === "flv" ? "flv" : "hls"
  };
  if (!Number.isNaN(fps) && fps > 0) requestContext.fps = String(Math.round(fps));
  if (_dy_toString(info.resolution).trim()) requestContext.resolution = _dy_toString(info.resolution).trim();
  if (_dy_toString(info.vCodec).trim()) requestContext.vCodec = _dy_toString(info.vCodec).trim();
  if (Number(info.vBitRate || 0) > 0) requestContext.vBitRate = String(Math.round(Number(info.vBitRate)));

  return {
    rank: Number(rank || 0),
    fpsRank: !Number.isNaN(fps) ? fps : 0,
    protocolRank: protocol === "flv" ? 2 : 1,
    detail: {
      roomId: _dy_toString(roomId),
      title: `${displayTitle}_${String(protocol || "").toUpperCase()}`,
      qn: Number(rank || 0),
      url: resolvedURL,
      liveCodeType: protocol === "flv" ? "flv" : "m3u8",
      liveType: "2",
      userAgent: _dy_playbackUserAgent,
      headers: _dy_playbackHeaders,
      requestContext: requestContext,
      playbackHints: {
        streamFormat: protocol === "flv" ? "flv" : "hlsLive"
      }
    }
  };
}

function _dy_sortPlaybackVariants(variants) {
  return (variants || []).sort(function (left, right) {
    const rankDelta = Number((right && right.rank) || 0) - Number((left && left.rank) || 0);
    if (rankDelta !== 0) return rankDelta;

    const fpsDelta = Number((right && right.fpsRank) || 0) - Number((left && left.fpsRank) || 0);
    if (fpsDelta !== 0) return fpsDelta;

    const protocolDelta = Number((right && right.protocolRank) || 0) - Number((left && left.protocolRank) || 0);
    if (protocolDelta !== 0) return protocolDelta;

    return _dy_toString((left && left.detail && left.detail.title) || "").localeCompare(
      _dy_toString((right && right.detail && right.detail.title) || "")
    );
  });
}

function _dy_extractPlayArgsFromStreamData(roomId, streamDataText, fallbackOptions) {
  if (!streamDataText) return [];

  let parsed;
  try {
    parsed = JSON.parse(String(streamDataText));
  } catch (e) {
    return [];
  }

  const common = (parsed && parsed.common) || {};
  const data = (parsed && parsed.data) || {};
  const qualityMeta = _dy_getPlaybackQualityMeta(parsed, fallbackOptions);
  const lineDefs = _dy_collectPlaybackLineDefs(common.lines || {}, data);

  return lineDefs.map(function (lineDef) {
    const variants = [];
    const seen = Object.create(null);

    Object.keys(data).forEach(function (qualityKey) {
      const quality = data[qualityKey] || {};
      const lineStream = quality[lineDef.key] || {};
      const title = qualityMeta.labelMap[qualityKey] || qualityKey;
      const rank = qualityMeta.rankMap[qualityKey] || 0;
      const qualityInfo = qualityMeta.infoMap[qualityKey] || {};

      ["flv", "hls"].forEach(function (protocol) {
        const variant = _dy_makePlaybackVariant(roomId, title, rank, protocol, lineStream[protocol], qualityInfo);
        if (!variant) return;
        const dedupeKey = `${variant.detail.title}|${variant.detail.url}`;
        if (seen[dedupeKey]) return;
        seen[dedupeKey] = true;
        variants.push(variant);
      });
    });

    const ordered = _dy_sortPlaybackVariants(variants).map(function (item) { return item.detail; });
    return ordered.length > 0 ? { cdn: lineDef.cdn, qualitys: ordered } : null;
  }).filter(Boolean);
}

function _dy_fallbackResolutionMeta(options) {
  const qualityMeta = _dy_getPlaybackQualityMeta(null, options);
  const definitions = {
    origin: { sdkKey: "origin", title: "原画", rank: 500 },
    origion: { sdkKey: "origin", title: "原画", rank: 500 },
    ORIGION: { sdkKey: "origin", title: "原画", rank: 500 },
    ORIGIN: { sdkKey: "origin", title: "原画", rank: 500 },
    FULL_HD1: { sdkKey: "uhd", title: "蓝光", rank: 400 },
    HD1: { sdkKey: "hd", title: "超清", rank: 300 },
    SD2: { sdkKey: "sd", title: "高清", rank: 200 },
    SD1: { sdkKey: "ld", title: "标清", rank: 100 }
  };

  Object.keys(definitions).forEach(function (resolutionKey) {
    const definition = definitions[resolutionKey];
    const sdkKey = definition.sdkKey;
    definition.title = qualityMeta.labelMap[sdkKey] || definition.title;
    definition.rank = qualityMeta.rankMap[sdkKey] || definition.rank;
    definition.qualityInfo = qualityMeta.infoMap[sdkKey] || {};
  });
  return definitions;
}

function _dy_extractFallbackPlayArgs(roomId, streamUrl, options) {
  const urlInfo = streamUrl || {};
  const hlsMap = Object.assign({}, urlInfo.hls_pull_url_map || {});
  const flvMap = Object.assign({}, urlInfo.flv_pull_url || {});
  const defaultResolution = _dy_toString(urlInfo.default_resolution).trim();
  if (defaultResolution && urlInfo.hls_pull_url && !hlsMap[defaultResolution]) {
    hlsMap[defaultResolution] = _dy_toString(urlInfo.hls_pull_url);
  }

  const resolutionMeta = _dy_fallbackResolutionMeta(options);
  const variants = [];
  const seen = Object.create(null);

  Object.keys(resolutionMeta).forEach(function (resolutionKey) {
    const meta = resolutionMeta[resolutionKey];
    ["flv", "hls"].forEach(function (protocol) {
      const sourceMap = protocol === "flv" ? flvMap : hlsMap;
      const variant = _dy_makePlaybackVariant(roomId, meta.title, meta.rank, protocol, sourceMap[resolutionKey], meta.qualityInfo);
      if (!variant) return;
      const dedupeKey = `${variant.detail.title}|${variant.detail.url}`;
      if (seen[dedupeKey]) return;
      seen[dedupeKey] = true;
      variants.push(variant);
    });
  });

  const ordered = _dy_sortPlaybackVariants(variants).map(function (item) { return item.detail; });
  return ordered.length > 0 ? [{ cdn: "主线路", qualitys: ordered }] : [];
}

function _dy_extractPlayArgsFromStreamUrl(roomId, streamUrl) {
  const normalizedStreamUrl = streamUrl || {};
  const pullData = ((normalizedStreamUrl.live_core_sdk_data || {}).pull_data || {});
  const streamData = pullData.stream_data || "";
  const options = pullData.options || {};
  let cdns = _dy_extractPlayArgsFromStreamData(roomId, streamData, options);

  if (cdns.length === 0) {
    cdns = _dy_extractFallbackPlayArgs(roomId, normalizedStreamUrl, options);
  }

  return cdns;
}

function _dy_pickPrimaryPlaybackLine(cdns) {
  if (!Array.isArray(cdns) || cdns.length === 0) return null;

  const preferred = cdns.find(function (item) {
    return _dy_toString(item && item.cdn) === "主线路";
  });
  return preferred || cdns[0] || null;
}

function _dy_parseStreamInfoQualities(streamInfo, roomId) {
  const info = streamInfo || {};
  const pullData = ((info.live_core_sdk_data || {}).pull_data || {});
  const streamData = pullData.stream_data || "";
  const options = pullData.options || {};

  if (streamData) {
    try {
      const parsed = JSON.parse(String(streamData));
      const data = (parsed && parsed.data) || {};
      const qualityMeta = _dy_getPlaybackQualityMeta(parsed, options);
      const variants = [];
      const seen = Object.create(null);

      Object.keys(data).forEach(function (qualityKey) {
        const quality = data[qualityKey] || {};
        const lineStream = quality.main || {};
        const title = qualityMeta.labelMap[qualityKey] || qualityKey;
        const rank = qualityMeta.rankMap[qualityKey] || 0;
        const qualityInfo = qualityMeta.infoMap[qualityKey] || {};

        ["flv", "hls"].forEach(function (protocol) {
          const variant = _dy_makePlaybackVariant(roomId, title, rank, protocol, lineStream[protocol], qualityInfo);
          if (!variant) return;
          const dedupeKey = variant.detail.title + "|" + variant.detail.url;
          if (seen[dedupeKey]) return;
          seen[dedupeKey] = true;
          variants.push(variant);
        });
      });

      if (variants.length > 0) {
        return _dy_sortPlaybackVariants(variants).map(function (item) { return item.detail; });
      }
    } catch (e) {}
  }

  const flvMap = info.flv_pull_url || {};
  const resolutionMeta = _dy_fallbackResolutionMeta(options);
  const variants = [];
  Object.keys(resolutionMeta).forEach(function (key) {
    var url = _dy_toString(flvMap[key]).trim();
    if (!url) return;
    var meta = resolutionMeta[key];
    const variant = _dy_makePlaybackVariant(roomId, meta.title, meta.rank, "flv", url, meta.qualityInfo);
    if (variant) variants.push(variant);
  });

  return _dy_sortPlaybackVariants(variants).map(function (item) { return item.detail; });
}

function _dy_extractMultiCameraPlayArgs(room) {
  const episodeExtra = (room && room.episode_extra) || {};
  const cameraInfos = Array.isArray(episodeExtra.camera_infos) ? episodeExtra.camera_infos : [];
  const results = [];

  cameraInfos.forEach(function (camera, index) {
    const streamInfo = (camera && camera.stream_info) || {};
    const cameraId = _dy_toString(camera && camera.camera_id).trim() || String(index);
    const qualitys = _dy_parseStreamInfoQualities(streamInfo, cameraId);
    if (qualitys.length === 0) return;

    const title = _dy_toString(camera && camera.title).trim() || (`机位${index + 1}`);
    results.push({
      cdn: `多机位-${title}`,
      qualitys: qualitys
    });
  });

  return results;
}

function _dy_extractPlayArgs(roomData, roomId) {
  const room = (roomData && roomData.room) || {};
  const streamUrl = room.stream_url || {};
  const multiCameraCdns = _dy_extractMultiCameraPlayArgs(room);
  let cdns = _dy_extractPlayArgsFromStreamUrl(roomId, streamUrl);

  if (cdns.length === 0) {
    if (multiCameraCdns.length > 0) {
      return multiCameraCdns;
    }
    _dy_throw("INVALID_RESPONSE", `empty quality list for roomId=${roomId}`, { roomId: String(roomId || "") });
  }

  return cdns.concat(multiCameraCdns);
}

function _dy_enrichCookie(cookie) {
  let enriched = _dy_normalizeCookie(cookie);
  if (!enriched) return enriched;
  if (!_dy_getCookieValue(enriched, "__ac_nonce")) {
    enriched = _dy_appendCookieKV(enriched, "__ac_nonce", _dy_randomString(21, "0123456789abcdef"));
  }
  if (!_dy_getCookieValue(enriched, "msToken")) {
    enriched = _dy_appendCookieKV(enriched, "msToken", _dy_generateMsToken());
  }
  return enriched;
}

function _dy_readPlatformCookie() {
  try {
    if (globalThis.Host && Host.session && typeof Host.session.getCookieHeader === "function") {
      return _dy_normalizeCookie(Host.session.getCookieHeader(_dy_platformId));
    }
  } catch (e) {
  }
  return "";
}

function _dy_getSessionCookie(cookie) {
  const explicitCookie = _dy_enrichCookie(cookie);
  if (explicitCookie) return explicitCookie;
  return _dy_enrichCookie(_dy_readPlatformCookie());
}

function _dy_resolveRoomAccess(cookie) {
  const header = _dy_normalizeCookie(cookie) || _dy_readPlatformCookie();
  // Device/bootstrap cookies alone do not establish an account session.
  // Keep this aligned with manifest.loginFlow.authSignalCookies.
  const authenticated = ["sessionid", "sessionid_ss", "sid_guard"].some(function (name) {
    return !!_dy_getCookieValue(header, name).trim();
  });
  return {
    authenticated: authenticated,
    cookie: authenticated ? _dy_enrichCookie(header) : "",
    authMode: authenticated ? "platform_cookie" : "none"
  };
}

// 获取匿名 cookie（ttwid + __ac_nonce + msToken）
// ttwid 通过 bytedance 注册接口获取，__ac_nonce 和 msToken 随机生成
// 仅在宿主没有可用平台登录态时回退使用；付费/已购直播间必须走平台 cookie。
// 24 小时缓存，避免频繁调用注册接口
const _dy_cookie_cache = {
  cookie: "",
  expireAt: 0
};
const _dy_cookie_ttl = 24 * 60 * 60 * 1000; // 24h
const _dy_cookie_waiters = [];

function _dy_cookieFromRegisterResponse(resp) {
  let ttwid = "";
  const setCookie = _dy_toString(resp && resp.headers && resp.headers["Set-Cookie"]);
  if (setCookie) {
    const parts = setCookie.split(";");
    for (const part of parts) {
      const kv = part.trim();
      if (kv.startsWith("ttwid=")) {
        ttwid = kv.split("=")[1];
        break;
      }
    }
  }
  let dyCookie = "";
  if (ttwid) dyCookie += "ttwid=" + ttwid + ";";
  dyCookie += "__ac_nonce=" + _dy_randomString(21, "0123456789abcdef") + ";";
  dyCookie += "msToken=" + _dy_generateMsToken() + ";";
  return dyCookie;
}

function _dy_storeAnonymousCookie(cookie, now) {
  _dy_cookie_cache.cookie = cookie;
  _dy_cookie_cache.expireAt = now + _dy_cookie_ttl;
  return cookie;
}

function _dy_getCookieCb(roomId, done) {
  const now = Date.now();
  if (_dy_cookie_cache.cookie && now < _dy_cookie_cache.expireAt) {
    done(null, _dy_cookie_cache.cookie);
    return;
  }
  _dy_cookie_waiters.push(done);
  if (_dy_cookie_waiters.length > 1) return;
  _dy_httpCall({
    url: "https://ttwid.bytedance.com/ttwid/union/register/",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      region: "cn",
      aid: 1768,
      needFid: false,
      service: "www.ixigua.com",
      migrate_info: { ticket: "", source: "node" },
      cbUrlProtocol: "https",
      union: true
    }),
    timeout: 10
  }, "none", function (resp) {
    const cookie = _dy_storeAnonymousCookie(_dy_cookieFromRegisterResponse(resp), now);
    const waiters = _dy_cookie_waiters.splice(0, _dy_cookie_waiters.length);
    for (let i = 0; i < waiters.length; i++) waiters[i](null, cookie);
  }, function () {
    const cookie = _dy_storeAnonymousCookie(_dy_cookieFromRegisterResponse(null), now);
    const waiters = _dy_cookie_waiters.splice(0, _dy_cookie_waiters.length);
    for (let i = 0; i < waiters.length; i++) waiters[i](null, cookie);
  });
}

function _dy_getCookie(roomId) {
  const deferred = _dy_deferred();
  _dy_getCookieCb(roomId, function (error, cookie) {
    if (error) deferred.reject(error);
    else deferred.resolve(cookie);
  });
  return deferred.thenable;
}

async function _dy_getRoomDataByApi(roomId, userId, cookie, roomAccess) {
  const webRid = _dy_toString(roomId).trim();
  const roomIdStr = _dy_toString(userId || roomId).trim();
  if (!webRid) _dy_throw("INVALID_ARGS", "roomId is empty", { field: "roomId" });

  const access = roomAccess || _dy_resolveRoomAccess(cookie);
  const finalCookie = access.authenticated ? access.cookie : await _dy_getCookie(webRid);

  // 和 Swift buildRequestUrl 完全一致：不 encode，直接拼接
  const params = `aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN&enter_from=web_live&cookie_enabled=true&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Chrome&browser_version=140.0.0.0&web_rid=${webRid}&room_id_str=${roomIdStr}&enter_source=&is_need_double_stream=false&insert_task_id=&live_reason=`;

  // Anonymous rooms retain the classic signing path exercised by 2.0.5 in
  // the host. Account rooms keep the SDK signer and host-managed credentials.
  const aBogus = access.authenticated ? _dy_signDetail(params) : _dy_signClassicDetail(params);
  // Swift: url + "?\(urlParams)&a_bogus=\(signature)" — 不 encodeURIComponent
  const requestURL = `https://live.douyin.com/webcast/room/web/enter/?${params}&a_bogus=${aBogus}`;

  // Swift: var requestHeaders = headers; requestHeaders.add(name: "cookie", value: cookie); requestHeaders.add(name: "accept", value: "application/json, text/plain, */*")
  const hdrs = _dy_pickHeaders(finalCookie);
  hdrs["Accept"] = "application/json, text/plain, */*";


  const resp = await _dy_request({
    url: requestURL,
    method: "GET",
    headers: hdrs,
    timeout: 20
  }, access.authMode);

  return _dy_roomPayloadFromEnterResponse(resp, webRid, roomId);
}

function _dy_roomPayloadFromEnterResponse(resp, webRid, roomId) {
  const httpStatus = resp && resp.status;
  const bodyText = _dy_toString(resp && resp.bodyText);
  let obj;
  try {
    obj = JSON.parse(bodyText || "{}");
  } catch (e) {
    _dy_throw("PARSE", "douyin API json parse failed", { roomId: String(roomId || ""), httpStatus: String(httpStatus || ""), bodyLen: String(bodyText.length) });
  }

  const statusCode = obj && obj.status_code;

  const dataArr = (((obj || {}).data || {}).data) || [];
  const roomData = Array.isArray(dataArr) && dataArr.length > 0 ? dataArr[0] : null;
  const userData = ((obj || {}).data || {}).user || null;

  if (!roomData || !roomData.id_str) {
    _dy_throw("INVALID_RESPONSE", "douyin API returned empty room data", { roomId: String(roomId || ""), status_code: String(statusCode || "") });
  }

  // Build the same structure as _dy_getRoomDataByHtml returns
  const room = roomData;
  const owner = userData ? {
    nickname: _dy_toString(userData.nickname || ""),
    id_str: _dy_toString(userData.id_str || ""),
    web_rid: _dy_toString(userData.web_rid || webRid),
    avatar_thumb: userData.avatar_thumb || {}
  } : (room.owner || {});

  room.owner = owner;

  return { room, roomInfo: { room, anchor: owner }, roomStore: {}, streamStore: {}, state: {} };
}

async function _dy_getDouyinRoomDetail(roomId, userId, cookie, maxRetries) {
  const retries = maxRetries || 3;
  // Resolve once per operation; retries and HTML fallback must stay on the
  // same account/anonymous path. The next operation reads the current vault.
  const access = _dy_resolveRoomAccess(cookie);
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      return await _dy_getRoomDataByApi(roomId, userId, "", access);
    } catch (e) {
      lastError = e;
    }
  }

  try {
    return await _dy_getRoomDataByHtml(roomId, "", access);
  } catch (e) {
    throw lastError || e;
  }
}

async function _dy_getRoomDataByHtml(roomId, cookie, roomAccess) {
  const webRid = _dy_toString(roomId).trim();
  if (!webRid) _dy_throw("INVALID_ARGS", "roomId is empty", { field: "roomId" });

  const access = roomAccess || _dy_resolveRoomAccess(cookie);

  const resp = await _dy_request({
    url: `https://live.douyin.com/${encodeURIComponent(webRid)}`,
    method: "GET",
    headers: _dy_pickHeaders(access.cookie),
    timeout: 20
  }, access.authMode);

  return _dy_roomPayloadFromHtmlText(_dy_toString(resp && resp.bodyText), roomId);
}

function _dy_roomPayloadFromHtmlText(html, roomId) {
  if (!html) {
    _dy_throw("INVALID_RESPONSE", "empty room html", { roomId: String(roomId || "") });
  }

  let payloadObj = null;

  const escapedMatch = html.match(/(\{\\"state\\":\{[\s\S]*?\]\\n)/);
  if (escapedMatch && escapedMatch[1]) {
    const normalized = String(escapedMatch[1])
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\]\\n/g, "]");
    try {
      const jsonText = _dy_extractFirstJSONObjectText(normalized);
      payloadObj = jsonText ? JSON.parse(jsonText) : null;
    } catch (e) {
      payloadObj = null;
    }
  }

  if (!payloadObj) {
    const renderDataMatch = html.match(/<script[^>]*id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i);
    if (renderDataMatch && renderDataMatch[1]) {
      const renderText = _dy_tryDecodeURIComponent(String(renderDataMatch[1]));
      try {
        payloadObj = JSON.parse(renderText);
      } catch (e) {
        payloadObj = null;
      }
    }
  }

  if (!payloadObj) {
    const initStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/i);
    if (initStateMatch && initStateMatch[1]) {
      try {
        payloadObj = JSON.parse(initStateMatch[1]);
      } catch (e) {
        payloadObj = null;
      }
    }
  }

  if (!payloadObj) {
    payloadObj = _dy_parseEscapedStateFromScript(html);
  }

  if (!payloadObj) {
    const hasEscapedState = html.includes('\\"state\\"');
    const hasRenderData = html.includes('id="RENDER_DATA"');
    const hasInitialState = html.includes('__INITIAL_STATE__');
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].substring(0, 100) : "no-title";
    _dy_throw("PARSE", "cannot parse douyin state payload from html", { roomId: String(roomId || "") });
  }

  const state = payloadObj.state || payloadObj;
  const roomStore = (state && state.roomStore) || {};
  const streamStore = (state && state.streamStore) || {};
  const roomInfo = (roomStore && roomStore.roomInfo) || {};
  let room = (roomInfo && roomInfo.room) || {};

  if ((!room || !room.id_str) && roomInfo) {
    const statusRaw = _dy_toString(roomInfo.status || roomStore.liveStatus || "").toLowerCase();
    let status = 0;
    if (statusRaw === "normal" || statusRaw === "2") status = 2;
    else if (statusRaw === "end" || statusRaw === "close" || statusRaw === "4") status = 4;

    room = {
      id_str: _dy_toString(roomInfo.roomId || roomInfo.web_rid || roomId),
      status,
      title: _dy_toString(roomInfo.title || ""),
      owner: roomInfo.anchor || {},
      cover: roomInfo.cover || {},
      room_view_stats: roomInfo.room_view_stats || {},
      stream_url: roomInfo.web_stream_url || {}
    };
  }

  if (!room || !room.id_str) {
    _dy_throw("INVALID_RESPONSE", "room info missing from html payload", { roomId: String(roomId || "") });
  }

  return { room, roomInfo, roomStore, streamStore, state };
}

async function _dy_getRoomList(id, parentId, page, cookie) {
  // 使用匿名 cookie 避免 444
  const freshCookie = await _dy_getCookie("");
  const params = [
    "aid=6383",
    "app_name=douyin_web",
    "live_id=1",
    "device_platform=web",
    "language=zh-CN",
    "enter_from=link_share",
    "cookie_enabled=true",
    "screen_width=1980",
    "screen_height=1080",
    "browser_language=zh-CN",
    "browser_platform=Win32",
    "browser_name=Edge",
    "browser_version=140.0.0.0",
    "browser_online=true",
    "count=15",
    `offset=${encodeURIComponent(String((Number(page || 1) - 1) * 15))}`,
    `partition=${encodeURIComponent(String(id || ""))}`,
    `partition_type=${encodeURIComponent(String(parentId || ""))}`,
    "req_from=2"
  ].join("&");

  const aBogus = _dy_signDetail(params);
  const requestURL = `https://live.douyin.com/webcast/web/partition/detail/room/v2/?${params}&a_bogus=${encodeURIComponent(aBogus)}`;

  const resp = await _dy_request({
    url: requestURL,
    method: "GET",
    headers: _dy_pickHeaders(freshCookie),
    timeout: 20
  }, "none");

  const obj = JSON.parse(_dy_toString(resp && resp.bodyText) || "{}");
  const list = (((obj || {}).data || {}).data) || [];
  if (!Array.isArray(list) || list.length === 0) {
    _dy_throw("BLOCKED", "douyin room list empty or blocked", { id: String(id || ""), parentId: String(parentId || ""), page: Number(page || 1) });
  }

  return _dy_mapPartitionRooms(list, id, parentId, page);
}

function _dy_mapPartitionRooms(list, id, parentId, page) {
  if (!Array.isArray(list) || list.length === 0) {
    _dy_throw("BLOCKED", "douyin room list empty or blocked", { id: String(id || ""), parentId: String(parentId || ""), page: Number(page || 1) });
  }
  return list.map(function (item) {
    const room = item.room || item || {};
    const owner = room.owner || item.owner || {};
    const avatar = owner.avatar_thumb || {};
    const cover = room.cover || item.cover || {};
    const webRid = _dy_toString(owner.web_rid || item.web_rid || room.id_str || item.id_str || owner.id_str || "");
    return {
      userName: _dy_toString(owner.nickname || ""),
      roomTitle: _dy_toString(room.title || ""),
      roomCover: _dy_firstArrayValue(cover.url_list),
      userHeadImg: _dy_firstArrayValue(avatar.url_list),
      liveType: "2",
      liveState: _dy_statusToLiveState(Number(room.status || 0), true),
      userId: _dy_toString(room.id_str || owner.id_str || ""),
      roomId: webRid,
      liveWatchedCount: _dy_pickRoomStatsWatchedCount(room, item)
    };
  });
}

function _dy_partitionListRequest(id, parentId, page, freshCookie) {
  const params = [
    "aid=6383",
    "app_name=douyin_web",
    "live_id=1",
    "device_platform=web",
    "language=zh-CN",
    "enter_from=link_share",
    "cookie_enabled=true",
    "screen_width=1980",
    "screen_height=1080",
    "browser_language=zh-CN",
    "browser_platform=Win32",
    "browser_name=Edge",
    "browser_version=140.0.0.0",
    "browser_online=true",
    "count=15",
    `offset=${encodeURIComponent(String((Number(page || 1) - 1) * 15))}`,
    `partition=${encodeURIComponent(String(id || ""))}`,
    `partition_type=${encodeURIComponent(String(parentId || ""))}`,
    "req_from=2"
  ].join("&");
  const aBogus = _dy_signDetail(params);
  return {
    url: `https://live.douyin.com/webcast/web/partition/detail/room/v2/?${params}&a_bogus=${encodeURIComponent(aBogus)}`,
    method: "GET",
    headers: _dy_pickHeaders(freshCookie),
    timeout: 20
  };
}

function _dy_getRoomListCb(id, parentId, page, done) {
  _dy_getCookieCb("", function (_error, freshCookie) {
    let request;
    try {
      request = _dy_partitionListRequest(id, parentId, page, freshCookie);
    } catch (error) {
      done(error);
      return;
    }
    _dy_httpCall(request, "none", function (resp) {
      try {
        const obj = JSON.parse(_dy_toString(resp && resp.bodyText) || "{}");
        const list = (((obj || {}).data || {}).data) || [];
        done(null, _dy_mapPartitionRooms(list, id, parentId, page));
      } catch (error) {
        done(error);
      }
    }, done);
  });
}

function _dy_enterRequest(roomId, userId, access, finalCookie) {
  const webRid = _dy_toString(roomId).trim();
  const roomIdStr = _dy_toString(userId || roomId).trim();
  const params = `aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN&enter_from=web_live&cookie_enabled=true&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Chrome&browser_version=140.0.0.0&web_rid=${webRid}&room_id_str=${roomIdStr}&enter_source=&is_need_double_stream=false&insert_task_id=&live_reason=`;
  const aBogus = access.authenticated ? _dy_signDetail(params) : _dy_signClassicDetail(params);
  const hdrs = _dy_pickHeaders(finalCookie);
  hdrs["Accept"] = "application/json, text/plain, */*";
  return {
    webRid: webRid,
    authMode: access.authMode,
    request: {
      url: `https://live.douyin.com/webcast/room/web/enter/?${params}&a_bogus=${aBogus}`,
      method: "GET",
      headers: hdrs,
      timeout: 20
    }
  };
}

function _dy_getRoomDataByApiCb(roomId, userId, cookie, roomAccess, done) {
  const webRid = _dy_toString(roomId).trim();
  if (!webRid) {
    done(_dy_error("INVALID_ARGS", "roomId is empty", { field: "roomId" }));
    return;
  }
  const access = roomAccess || _dy_resolveRoomAccess(cookie);
  function send(finalCookie) {
    let built;
    try {
      built = _dy_enterRequest(roomId, userId, access, finalCookie);
    } catch (error) {
      done(error);
      return;
    }
    _dy_httpCall(built.request, built.authMode, function (resp) {
      try {
        done(null, _dy_roomPayloadFromEnterResponse(resp, built.webRid, roomId));
      } catch (error) {
        done(error);
      }
    }, done);
  }
  if (access.authenticated) send(access.cookie);
  else _dy_getCookieCb(webRid, function (_error, cookieValue) { send(cookieValue); });
}

function _dy_error(code, message, context) {
  try {
    _dy_throw(code, message, context);
  } catch (error) {
    return error;
  }
  return new Error(message);
}

function _dy_getRoomDataByHtmlCb(roomId, cookie, roomAccess, done) {
  const webRid = _dy_toString(roomId).trim();
  if (!webRid) {
    done(_dy_error("INVALID_ARGS", "roomId is empty", { field: "roomId" }));
    return;
  }
  const access = roomAccess || _dy_resolveRoomAccess(cookie);
  _dy_httpCall({
    url: `https://live.douyin.com/${encodeURIComponent(webRid)}`,
    method: "GET",
    headers: _dy_pickHeaders(access.cookie),
    timeout: 20
  }, access.authMode, function (resp) {
    try {
      done(null, _dy_roomPayloadFromHtmlText(_dy_toString(resp && resp.bodyText), roomId));
    } catch (error) {
      done(error);
    }
  }, done);
}

function _dy_getDouyinRoomDetailCb(roomId, userId, cookie, maxRetries, done) {
  const retries = maxRetries || 3;
  const access = _dy_resolveRoomAccess(cookie);
  let lastError = null;
  function attempt(index) {
    if (index >= retries) {
      _dy_getRoomDataByHtmlCb(roomId, "", access, function (error, data) {
        if (error) done(lastError || error);
        else done(null, data);
      });
      return;
    }
    _dy_getRoomDataByApiCb(roomId, userId, "", access, function (error, data) {
      if (!error) {
        done(null, data);
        return;
      }
      lastError = error;
      attempt(index + 1);
    });
  }
  attempt(0);
}

const __dy_homeBannerLimit = 5;
const __dy_homeSectionRoomLimit = 20;
const __dy_homeTTLSeconds = 900;
const __dy_homeFeedURL = "https://live.douyin.com/webcast/feed/?aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN";

function _dy_httpsURL(url) {
  const value = _dy_toString(url).trim();
  if (!value) return "";
  if (value.indexOf("//") === 0) return "https:" + value;
  if (value.indexOf("http://") === 0) return "https://" + value.slice(7);
  return value;
}

function _dy_mapHomeRoomModel(item) {
  const roomId = _dy_toString(item && item.roomId).trim();
  if (!roomId || roomId === "0") return null;
  const liveState = _dy_toString(item && item.liveState).trim();
  return {
    userName: _dy_toString(item && item.userName),
    roomTitle: _dy_toString(item && item.roomTitle),
    roomCover: _dy_httpsURL((item && (item.roomCover || item.cover)) || ""),
    userHeadImg: _dy_httpsURL((item && (item.userHeadImg || item.face)) || ""),
    liveType: "2",
    liveState: liveState || "1",
    userId: _dy_toString(item && item.userId),
    roomId: roomId,
    liveWatchedCount: _dy_toString(item && item.liveWatchedCount)
  };
}

function _dy_mapFeedHomeRoom(item) {
  if (!item || item.is_ad) return null;
  const room = item.data && typeof item.data === "object" ? item.data : item;
  const owner = (room && room.owner) || {};
  const cover = (room && room.cover) || {};
  const avatar = owner.avatar_thumb || {};
  const roomId = _dy_toString(
    owner.web_rid || item.web_rid || owner.display_id || room.id_str || item.id_str || ""
  ).trim();
  if (!roomId || roomId === "0") return null;
  return {
    userName: _dy_toString(owner.nickname),
    roomTitle: _dy_toString(room.title),
    roomCover: _dy_httpsURL(_dy_firstArrayValue(cover.url_list)),
    userHeadImg: _dy_httpsURL(_dy_firstArrayValue(avatar.url_list)),
    liveType: "2",
    liveState: "1",
    userId: _dy_toString(room.id_str || owner.id_str || room.owner_user_id || ""),
    roomId: roomId,
    liveWatchedCount: _dy_toString(room.user_count || room.user_count_str || "")
  };
}

function _dy_homeBannerFromRoom(room, imageURL, badge) {
  if (!room || !room.roomId) return null;
  const bannerImage = _dy_httpsURL(imageURL || room.roomCover);
  if (bannerImage.indexOf("https://") !== 0) return null;
  const title = _dy_toString(room.roomTitle || room.userName).trim();
  if (!title) return null;
  const banner = {
    id: "banner-" + room.roomId,
    imageURL: bannerImage,
    title: title,
    badge: _dy_toString(badge || "直播中").trim() || "直播中",
    target: {
      type: "room",
      room: room
    }
  };
  const subtitle = _dy_toString(room.userName).trim();
  if (subtitle && subtitle !== title) banner.subtitle = subtitle;
  return banner;
}

function _dy_collectFeedBanners(rooms) {
  const banners = [];
  const seen = {};
  const source = rooms || [];
  for (let i = 0; i < source.length && banners.length < __dy_homeBannerLimit; i += 1) {
    const room = _dy_mapHomeRoomModel(source[i]);
    if (!room || seen[room.roomId]) continue;
    const banner = _dy_homeBannerFromRoom(room);
    if (!banner) continue;
    seen[room.roomId] = true;
    banners.push(banner);
  }
  return banners;
}

function _dy_homeSection(spec, rooms) {
  const items = [];
  const seen = {};
  const source = rooms || [];
  for (let i = 0; i < source.length && items.length < __dy_homeSectionRoomLimit; i += 1) {
    const room = _dy_mapHomeRoomModel(source[i]);
    if (!room || seen[room.roomId]) continue;
    seen[room.roomId] = true;
    items.push({
      id: room.roomId,
      room: room
    });
  }
  if (!items.length) return null;
  const section = {
    id: spec.id,
    kind: "rooms",
    title: spec.title,
    personalized: false,
    items: items
  };
  if (spec.subtitle) section.subtitle = spec.subtitle;
  if (spec.seeAll && spec.seeAll.id) {
    section.seeAllTarget = {
      type: "category",
      category: {
        id: _dy_toString(spec.seeAll.id),
        parentId: _dy_toString(spec.seeAll.parentId || ""),
        title: _dy_toString(spec.seeAll.title || spec.title || ""),
        icon: _dy_toString(spec.seeAll.icon || ""),
        biz: _dy_toString(spec.seeAll.biz || "")
      }
    };
  }
  return section;
}

async function _dy_getHomeFeedRooms() {
  try {
    const resp = await _dy_request({
      url: __dy_homeFeedURL,
      method: "GET",
      headers: _dy_pickHeaders(""),
      timeout: 20
    }, "none");
    const obj = JSON.parse(_dy_toString(resp && resp.bodyText) || "{}");
    const list = obj && Array.isArray(obj.data) ? obj.data : [];
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const room = _dy_mapFeedHomeRoom(list[i]);
      if (room) out.push(room);
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function _dy_getHomeRoomList(id, parentId) {
  try {
    const rows = await _dy_getRoomList(id, parentId, 1, "");
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const room = _dy_mapHomeRoomModel(rows[i]);
      if (room) out.push(room);
    }
    return out;
  } catch (e) {
    return [];
  }
}

function _dy_buildHomeFeed() {
  const deferred = _dy_deferred();
  const extraSpecs = [
    { id: "lol", title: "英雄联盟", cateId: "1010014", parentId: "1", seeAll: { id: "1010014", parentId: "1", title: "英雄联盟" } },
    { id: "wzry", title: "王者荣耀", cateId: "1010045", parentId: "1", seeAll: { id: "1010045", parentId: "1", title: "王者荣耀" } },
    { id: "chat", title: "聊天", cateId: "101", parentId: "4", seeAll: { id: "101", parentId: "4", title: "聊天" } }
  ];
  const extraLists = new Array(extraSpecs.length);
  let remaining = extraSpecs.length;
  function finishOne(index, rows) {
    extraLists[index] = rows;
    remaining -= 1;
    if (remaining > 0) return;
    try {
      deferred.resolve(_dy_assembleHomeFeed(extraSpecs, extraLists));
    } catch (error) {
      deferred.reject(error);
    }
  }
  for (let i = 0; i < extraSpecs.length; i += 1) {
    const spec = extraSpecs[i];
    const index = i;
    _dy_getRoomListCb(spec.cateId, spec.parentId, 1, function (error, rows) {
      if (error) {
        finishOne(index, []);
        return;
      }
      const out = [];
      for (let n = 0; n < rows.length; n += 1) {
        const room = _dy_mapHomeRoomModel(rows[n]);
        if (room) out.push(room);
      }
      finishOne(index, out);
    });
  }
  return deferred.thenable;
}

function _dy_assembleHomeFeed(extraSpecs, extraLists) {
  const hotRooms = extraLists[2];
  if (!hotRooms || !hotRooms.length) {
    _dy_throw("INVALID_RESPONSE", "home feed hot list empty", {});
  }

  const banners = [];
  const sections = [];
  const hotSection = _dy_homeSection({
    id: "hot",
    title: "热门直播",
    seeAll: { id: "101", parentId: "4", title: "聊天" }
  }, hotRooms);
  if (hotSection) sections.push(hotSection);

  for (let i = 0; i < extraSpecs.length - 1; i += 1) {
    const section = _dy_homeSection(extraSpecs[i], extraLists[i]);
    if (section) sections.push(section);
  }

  const revisionParts = [];
  for (let i = 0; i < banners.length; i += 1) revisionParts.push(banners[i].id);
  for (let i = 0; i < sections.length; i += 1) {
    const first = sections[i].items[0];
    revisionParts.push(sections[i].id + ":" + ((first && first.id) || "0"));
  }

  return {
    schemaVersion: 1,
    revision: revisionParts.join("|").slice(0, 256),
    generatedAt: new Date().toISOString(),
    ttlSeconds: __dy_homeTTLSeconds,
    banners: banners,
    sections: sections
  };
}

const _dy_searchRooms = _dy_syncAsync(function* _dy_searchRooms(keyword, page, cookie) {
  // Prefer explicit cookie, then host vault login cookie.
  // 2.0.3: attach bdms/fn150 a_bogus (classic 164-char sign soft-fails empty data).
  const sessionCookie = _dy_getSessionCookie(cookie);
  const normalizedCookie = _dy_normalizeCookie(sessionCookie);
  const msTokenFromCookie = _dy_getCookieValue(normalizedCookie, "msToken");
  const msToken = msTokenFromCookie || _dy_generateMsToken();
  const generatedMsToken = msTokenFromCookie ? 0 : 1;
  const verifyFp = _dy_getCookieValue(normalizedCookie, "s_v_web_id") || _dy_getCookieValue(normalizedCookie, "verifyFp");
  const uifid = _dy_getCookieValue(normalizedCookie, "UIFID") || _dy_getCookieValue(normalizedCookie, "uifid");
  const keywordText = String(keyword || "").trim();
  const encodedKeyword = encodeURIComponent(keywordText);
  const pageNo = Number(page || 1);
  if (pageNo <= 1 || _dy_runtime.searchKeyword !== keywordText) {
    _dy_runtime.searchId = "";
    _dy_runtime.searchKeyword = keywordText;
  }
  const queryParts = [
    "device_platform=webapp",
    "aid=6383",
    "channel=channel_pc_web",
    "search_channel=aweme_live",
    `keyword=${encodedKeyword}`,
    "search_source=normal_search",
    "query_correct_type=1",
    "is_filter_search=0",
    "from_group_id=",
    "disable_rs=0",
    `offset=${encodeURIComponent(String((pageNo - 1) * 15))}`,
    "count=15",
    "need_filter_settings=1",
    "list_type=single",
    `pc_search_top_1_params=${encodeURIComponent("{\"enable_ai_search_top_1\":1}")}`,
    "update_version_code=170400",
    "pc_client_type=1",
    "pc_libra_divert=Mac",
    "support_h265=1",
    "support_dash=1",
    "version_code=170400",
    "version_name=17.4.0",
    "cookie_enabled=true",
    "screen_width=1920",
    "screen_height=1080",
    "browser_language=zh-CN",
    "browser_platform=MacIntel",
    "browser_name=Chrome",
    "browser_version=140.0.0.0",
    "browser_online=true",
    "engine_name=Blink",
    "engine_version=140.0.0.0",
    "os_name=Mac+OS",
    "os_version=10.15.7",
    "cpu_core_num=8",
    "device_memory=8",
    "platform=PC",
    "downlink=10",
    "effective_type=4g",
    "round_trip_time=100",
    "webid=7247041636524377637"
  ];
  if (uifid) queryParts.push(`uifid=${encodeURIComponent(uifid)}`);
  queryParts.push(`msToken=${encodeURIComponent(msToken)}`);
  if (verifyFp) {
    queryParts.push(`verifyFp=${encodeURIComponent(verifyFp)}`);
    queryParts.push(`fp=${encodeURIComponent(verifyFp)}`);
  }

  const qs = queryParts.join("&");
  let requestURL = `https://www.douyin.com/aweme/v1/web/live/search/?${qs}`;
  try {
    const aBogus = _dy_signDetail(qs);
    if (aBogus) {
      requestURL += `&a_bogus=${encodeURIComponent(aBogus)}`;
    }
  } catch (e) {
    // Fail-open for search: cookie-only still works when signer is unavailable.
  }
  const searchHeaders = Object.assign({}, _dy_pickHeaders(""), {
    "Accept": "application/json, text/plain, */*",
    "Authority": "www.douyin.com",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": `https://www.douyin.com/search/${encodedKeyword}?type=live`
  });
  if (uifid) searchHeaders.uifid = uifid;

  const resp = yield _dy_requestWithSession({
    url: requestURL,
    method: "GET",
    headers: searchHeaders,
    timeout: 20
  });

  const bodyText = _dy_toString(resp && resp.bodyText);

  let obj = {};
  try {
    obj = JSON.parse(bodyText || "{}");
  } catch (e) {
    _dy_throw("PARSE", "douyin search json parse failed", {
      http: _dy_toString(resp && resp.status),
      cookie_len: String(normalizedCookie.length),
      url: requestURL
    });
  }

  const statusCode = _dy_toString(obj && obj.status_code);
  const statusMsg = _dy_toString(obj && (obj.status_msg || obj.message || obj.msg));
  const list = (obj && obj.data);
  const searchNilType = _dy_toString((((obj || {}).search_nil_info || {}).search_nil_type));
  const logId = _dy_toString((((obj || {}).extra || {}).logid) || (((obj || {}).log_pb || {}).impr_id));
  if (logId) {
    _dy_runtime.searchId = logId;
  }

  // 2483: 请先登录，再继续搜索吧
  if (statusCode === "2483" || /请先登录/.test(statusMsg)) {
    const authContext = {
      api: "search",
      upstreamCode: statusCode,
      http: _dy_toString(resp && resp.status),
      status_code: statusCode,
      search_nil_type: searchNilType,
      logid: logId,
      cookie_len: String(normalizedCookie.length),
      generated_msToken: String(generatedMsToken),
      has_verifyFp: verifyFp ? "1" : "0",
      has_uifid: uifid ? "1" : "0",
      url: requestURL
    };
    const httpStatus = _dy_toString(resp && (resp.status || resp.statusCode));
    if (httpStatus) authContext.httpStatus = httpStatus;
    if (!statusCode) delete authContext.upstreamCode;
    if (statusMsg) authContext.upstreamMsg = statusMsg;
    authContext.reason = "login_required";
    _dy_throw("AUTH_REQUIRED", "抖音搜索需要登录后使用", authContext);
  }

  if (!Array.isArray(list)) {
    _dy_throw("INVALID_RESPONSE", statusMsg || "douyin search response invalid", {
      http: _dy_toString(resp && resp.status),
      status_code: statusCode,
      search_nil_type: searchNilType,
      logid: logId,
      cookie_len: String(normalizedCookie.length),
      generated_msToken: String(generatedMsToken),
      has_verifyFp: verifyFp ? "1" : "0",
      has_uifid: uifid ? "1" : "0",
      url: requestURL
    });
  }

  const out = [];
  const seenRoomIds = new Set();
  const awemeCandidates = [];
  let rawParsedCount = 0;
  let userListModelCount = 0;
  let userListUserCount = 0;
  let firstItemType = "";
  let firstItemKeys = "";
  let firstUserKeys = "";
  let firstUserInfoKeys = "";
  let firstRoomDataKeys = "";
  let firstUserRoomId = "";
  let firstUserInfoRoomId = "";
  let firstUserInfoRoomIdStr = "";
  let firstUserInfoUID = "";
  const pushModel = (model) => {
    const roomId = _dy_toString(model && model.roomId);
    if (!roomId || roomId === "0" || seenRoomIds.has(roomId)) return;
    seenRoomIds.add(roomId);
    out.push(model);
  };
  for (const item of list) {
    if (!firstItemType) {
      firstItemType = _dy_toString((item || {}).type);
      firstItemKeys = _dy_objectKeys(item);
    }
    const users = Array.isArray((item || {}).user_list) ? item.user_list : [];
    if (users.length > 0) {
      userListUserCount += users.length;
      if (!firstUserKeys) {
        const firstUser = users[0] || {};
        firstUserKeys = _dy_objectKeys(firstUser);
        firstUserInfoKeys = _dy_objectKeys(firstUser.user_info || {});
        firstUserRoomId = _dy_toString(firstUser.room_id);
        firstUserInfoRoomId = _dy_toString((firstUser.user_info || {}).room_id);
        firstUserInfoRoomIdStr = _dy_toString((firstUser.user_info || {}).room_id_str);
        firstUserInfoUID = _dy_toString((firstUser.user_info || {}).uid);
        firstRoomDataKeys = _dy_objectKeys(
          firstUser.room_data ||
          ((firstUser.user_info || {}).room_data) ||
          firstUser.live_info ||
          ((firstUser.user_info || {}).live_info) ||
          firstUser.webcast_info ||
          ((firstUser.user_info || {}).webcast_info) ||
          firstUser.room_info ||
          ((firstUser.user_info || {}).room_info) ||
          {}
        );
      }
    }
    const rawText = _dy_toString(
      (((item || {}).lives || {}).rawdata) ||
      (((item || {}).live || {}).rawdata) ||
      ((item || {}).rawdata) ||
      ""
    );
    if (rawText) {
      try {
        const raw = JSON.parse(rawText);
        const room = raw.room || {};
        const owner = raw.owner || room.owner || {};
        const cover = raw.cover || room.cover || {};
        const avatar = owner.avatar_thumb || {};
        const status = Number(raw.status || room.status || 0);
        const hasStream = !!((((raw.stream_url || room.stream_url || {}).live_core_sdk_data || {}).pull_data || {}).stream_data);
        pushModel({
          userName: _dy_toString(owner.nickname || ""),
          roomTitle: _dy_toString(raw.title || room.title || ""),
          roomCover: _dy_firstArrayValue(cover.url_list),
          userHeadImg: _dy_firstArrayValue(avatar.url_list),
          liveType: "2",
          liveState: _dy_statusToLiveState(status, hasStream),
          userId: _dy_toString(raw.id_str || room.id_str || owner.id_str || ""),
          roomId: _dy_toString(owner.web_rid || raw.web_rid || room.web_rid || room.id_str || ""),
          liveWatchedCount: _dy_pickSearchWatchedCount(room, raw)
        });
        rawParsedCount += 1;
      } catch (e) {
      }
    }

    const fallbackModels = _dy_extractLiveModelsFromUserList(item);
    for (const model of fallbackModels) {
      pushModel(model);
      userListModelCount += 1;
    }

    const awemeCandidate = _dy_extractSearchCandidateFromAwemeItem(item);
    if (awemeCandidate) {
      awemeCandidates.push(awemeCandidate);
    }
  }

  if (out.length === 0 && awemeCandidates.length > 0) {
    const resolvedRoomIdStrs = new Set();
    for (const candidate of awemeCandidates) {
      const roomIdStr = _dy_toString(candidate && candidate.roomIdStr);
      if (!roomIdStr || roomIdStr === "0" || resolvedRoomIdStrs.has(roomIdStr)) continue;
      resolvedRoomIdStrs.add(roomIdStr);
      const resolved = yield _dy_resolveRoomIdsFromRoomIdStr(roomIdStr);
      pushModel(_dy_buildSearchCandidateLiveModel(candidate, resolved));
    }
  }

  if (out.length === 0) {
    return [];
  }

  return out;
});


const _dy_resolveRoomIdFromShareCode = _dy_syncAsync(function* _dy_resolveRoomIdFromShareCode(shareCode, cookie) {
  const text = _dy_toString(shareCode).trim();
  if (!text) _dy_throw("INVALID_ARGS", "shareCode is empty", { field: "shareCode" });
  if (_dy_isNumericId(text)) {
    return { roomId: text, userId: text, shareModel: null };
  }

  let resolved = _dy_extractShareRoomIds(text);
  const shareSources = [text];
  if (resolved.webRid) {
    return {
      roomId: resolved.webRid,
      userId: resolved.roomIdStr || resolved.webRid || "",
      shareModel: _dy_buildLiveModelFromShareSource(shareSources.join("\n"), resolved)
    };
  }

  const shortURL = _dy_firstURL(text) || (text.startsWith("http") ? text : "");
  if (shortURL) {
    try {
      const sessionResp = yield _dy_requestWithSession({
        url: shortURL,
        method: "GET",
        headers: _dy_pickHeaders(""),
        timeout: 20
      });

      const sessionFinalURL = _dy_toString((sessionResp && sessionResp.url) || shortURL);
      const sessionHTML = _dy_toString(sessionResp && sessionResp.bodyText);
      shareSources.push(sessionFinalURL, sessionHTML);
      resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(sessionFinalURL));
      resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(sessionHTML));
    } catch (e) {
    }

    // The first response may already contain the room and anchor metadata.
    // Do not let a redundant redirect fetch turn that success into a failure.
    if (!resolved.webRid && (!resolved.roomIdStr || !resolved.reflowURL)) {
      const resp = yield _dy_request({
        url: shortURL,
        method: "GET",
        headers: _dy_pickHeaders(cookie),
        timeout: 20
      }, "none");

      const finalURL = _dy_toString((resp && resp.url) || shortURL);
      const html = _dy_toString(resp && resp.bodyText);
      shareSources.push(finalURL, html);
      resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(finalURL));
      resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(html));
    }

    const reflowURL = _dy_firstNonEmptyString([
      resolved.reflowURL,
      _dy_extractReflowURL(shareSources.join("\n"))
    ]);

    if (!resolved.webRid && reflowURL) {
      const reflowResp = yield _dy_requestWithSession({
        url: reflowURL,
        method: "GET",
        headers: _dy_pickHeaders(""),
        timeout: 20
      });
      const reflowFinalURL = _dy_toString((reflowResp && reflowResp.url) || reflowURL);
      const reflowHTML = _dy_toString(reflowResp && reflowResp.bodyText);
      shareSources.push(reflowFinalURL, reflowHTML);
      resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(reflowFinalURL));
      resolved = _dy_mergeShareRoomIds(resolved, _dy_extractShareRoomIds(reflowHTML));
    }
  }

  const shareModel = _dy_buildLiveModelFromShareSource(shareSources.join("\n"), resolved);
  if (resolved.webRid || resolved.roomIdStr) {
    return {
      roomId: resolved.webRid || resolved.roomIdStr,
      userId: resolved.roomIdStr || resolved.webRid || "",
      shareModel
    };
  }

  _dy_throw("NOT_FOUND", `cannot resolve douyin roomId from shareCode: ${shareCode}`, {
    shareCode: String(shareCode || ""),
    webRid: resolved.webRid || "",
    roomIdStr: resolved.roomIdStr || "",
    reflowURL: resolved.reflowURL || ""
  });
});



const __dy_sharedGlobalKey = "__lp_plugin_douyin_1_0_13_shared";

function _dy_randomUserUniqueId() {
  const lo = 7300000000000000000;
  const hi = 7999999999999999999;
  return String(Math.floor(Math.random() * (hi - lo + 1)) + lo);
}

function _dy_buildDanmakuContext(payload) {
  const deferred = _dy_deferred();
  try {
    const runtimePayload = _dy_runtimePayload(payload);
    const roomId = _dy_toString(runtimePayload.roomId);
    if (!roomId) _dy_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
    globalThis.LiveParsePlugin.getRoomDetail(runtimePayload).then(function (live) {
      _dy_getCookieCb(roomId, function (_error, cookie) {
        const finalRoomId = _dy_toString((live && live.userId) || roomId);
        const userUniqueId = _dy_randomUserUniqueId();
        const sigParams = "live_id=1,aid=6383,version_code=180800,webcast_sdk_version=1.0.14-beta.0,"
          + "room_id=" + finalRoomId + ",sub_room_id=,sub_channel_id=,did_rule=3,"
          + "user_unique_id=" + userUniqueId + ",device_platform=web,device_type=,ac=,identity=audience";
        const xmsStub = Host.crypto.md5(sigParams);
        let signature = "";
        if (typeof get_sign === "function") signature = _dy_toString(get_sign(xmsStub)) || "";
        deferred.resolve({
          roomId: roomId,
          finalRoomId: finalRoomId,
          userUniqueId: userUniqueId,
          signature: signature,
          cookie: cookie
        });
      });
    }, deferred.reject);
  } catch (error) {
    deferred.reject(error);
  }
  return deferred.thenable;
}


function _dy_buildLegacyDanmakuResult(context) {
  return {
    args: {
      room_id: _dy_toString(context && context.finalRoomId),
      compress: "gzip",
      version_code: "180800",
      webcast_sdk_version: "1.0.14-beta.0",
      live_id: "1",
      did_rule: "3",
      user_unique_id: _dy_toString(context && context.userUniqueId),
      identity: "audience",
      signature: _dy_toString(context && context.signature),
      aid: "6383",
      device_platform: "web",
      browser_language: "zh-CN",
      browser_platform: "Win32",
      browser_name: "Mozilla",
      browser_version: _dy_ua
    },
    headers: { "User-Agent": _dy_ua, "cookie": _dy_toString(context && context.cookie) }
  };
}

function _dy_buildDanmakuWebSocketURL(args) {
  const source = args || {};
  const pairs = [];
  Object.keys(source).forEach(function (key) {
    const value = _dy_toString(source[key]);
    if (!value) return;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return `wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/?${pairs.join("&")}`;
}

function _dy_sharedDanmakuDriver() {
  return globalThis.__douyinDanmakuDriver || null;
}

globalThis[__dy_sharedGlobalKey] = {
  throwError: _dy_throw,
  toString: _dy_toString,
  buildDanmakuContext: _dy_buildDanmakuContext,
  buildDanmakuWebSocketURL: _dy_buildDanmakuWebSocketURL,
  userAgent: _dy_ua
};

globalThis.LiveParsePlugin = {
  apiVersion: 1,

  setCookie(payload) {
    try { return _dy_export(_dy_loginHelper().setCookie(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  clearCookie() {
    try { return _dy_export(_dy_loginHelper().clearCookie()); }
    catch (error) { return _dy_fail(error); }
  },

  setCredential(payload) {
    try { return _dy_export(_dy_loginHelper().setCredential(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  clearCredential() {
    try { return _dy_export(_dy_loginHelper().clearCredential()); }
    catch (error) { return _dy_fail(error); }
  },

  getCredentialStatus(payload) {
    try { return _dy_export(_dy_loginHelper().getCredentialStatus(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  validateCredential(payload) {
    try { return _dy_export(_dy_loginHelper().validateCredential(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  createLoginChallenge(payload) {
    try { return _dy_export(_dy_loginHelper().createLoginChallenge(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  pollLoginChallenge(payload) {
    try { return _dy_export(_dy_loginHelper().pollLoginChallenge(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  cancelLoginChallenge(payload) {
    try { return _dy_export(_dy_loginHelper().cancelLoginChallenge(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  onLoginChallengePush(payload) {
    try { return _dy_export(_dy_loginHelper().onLoginChallengePush(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  submitLoginChallengeVerification(payload) {
    try { return _dy_export(_dy_loginHelper().submitLoginChallengeVerification(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  resendLoginChallengeVerification(payload) {
    try { return _dy_export(_dy_loginHelper().resendLoginChallengeVerification(payload)); }
    catch (error) { return _dy_fail(error); }
  },

  getCategories() {
    return _dy_ready(_dy_defaultCategories());
  },

  getRooms(payload) {
    const deferred = _dy_deferred();
    try {
      const runtimePayload = _dy_runtimePayload(payload);
      const id = _dy_toString(runtimePayload.id);
      const parentId = _dy_toString(runtimePayload.parentId);
      const page = Number(runtimePayload.page || 1);
      if (!id) _dy_throw("INVALID_ARGS", "id is required", { field: "id" });
      _dy_getRoomListCb(id, parentId, page, function (error, rooms) {
        if (error) deferred.reject(error);
        else deferred.resolve(rooms);
      });
    } catch (error) {
      deferred.reject(error);
    }
    return deferred.thenable;
  },

  getHomeFeed(payload) {
    try { return _dy_buildHomeFeed(payload || {}); }
    catch (error) { return _dy_fail(error); }
  },

  getPlayback(payload) {
    const deferred = _dy_deferred();
    try {
      const runtimePayload = _dy_runtimePayload(payload);
      const roomId = _dy_toString(runtimePayload.roomId);
      const userId = _dy_toString(runtimePayload.userId);
      if (!roomId) _dy_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
      _dy_getDouyinRoomDetailCb(roomId, userId, "", 3, function (error, data) {
        if (error) {
          deferred.reject(error);
          return;
        }
        try {
          deferred.resolve(_dy_extractPlayArgs(data, roomId));
        } catch (extractError) {
          deferred.reject(extractError);
        }
      });
    } catch (error) {
      deferred.reject(error);
    }
    return deferred.thenable;
  },

  refreshPlayback(payload) {
    const deferred = _dy_deferred();
    let playback;
    try {
      const runtimePayload = _dy_runtimePayload(payload);
      const roomId = _dy_toString(runtimePayload.roomId);
      if (!roomId) _dy_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
      const quality = runtimePayload.quality || {};
      const qualityContext = quality.requestContext || {};
      const requestedQn = Number(qualityContext.qn !== undefined ? qualityContext.qn : (quality.qn || 0));
      const requestedStreamType = _dy_toString(
        qualityContext.streamType || qualityContext.format || quality.liveCodeType || ""
      ).toLowerCase();
      playback = this.getPlayback({ roomId: roomId, userId: runtimePayload.userId });
      playback.then(function (refreshed) {
        try {
          let picked = null;
          for (const cdn of refreshed) {
            const qualitys = cdn && cdn.qualitys ? cdn.qualitys : [];
            for (const detail of qualitys) {
              if (!picked) picked = detail;
              const detailType = _dy_toString(detail && detail.liveCodeType).toLowerCase() === "m3u8" ? "hls" : "flv";
              const rawDetailType = _dy_toString(detail && detail.liveCodeType).toLowerCase();
              const qnMatched = requestedQn <= 0 || Number(detail && detail.qn || 0) === requestedQn;
              const typeMatched = !requestedStreamType || requestedStreamType === detailType || requestedStreamType === rawDetailType;
              if (qnMatched && typeMatched) {
                picked = detail;
                break;
              }
            }
            if (picked) {
              const pickedType = _dy_toString(picked.liveCodeType).toLowerCase() === "m3u8" ? "hls" : "flv";
              const rawPickedType = _dy_toString(picked.liveCodeType).toLowerCase();
              if ((requestedQn <= 0 || Number(picked.qn || 0) === requestedQn) && (!requestedStreamType || requestedStreamType === pickedType || requestedStreamType === rawPickedType)) break;
            }
          }
          if (!picked) _dy_throw("NOT_FOUND", "refreshed playback is empty", { roomId: roomId });
          deferred.resolve(Object.assign({}, quality, picked, {
            requestContext: Object.assign({}, qualityContext, picked.requestContext || {})
          }));
        } catch (error) {
          deferred.reject(error);
        }
      }, deferred.reject);
    } catch (error) {
      deferred.reject(error);
    }
    return deferred.thenable;
  },

  search(payload) {
    try {
      const runtimePayload = _dy_runtimePayload(payload);
      const keyword = _dy_toString(runtimePayload.keyword);
      const page = Number(runtimePayload.page || 1);
      if (!keyword) _dy_throw("INVALID_ARGS", "keyword is required", { field: "keyword" });
      return _dy_searchRooms(keyword, page, _dy_readPlatformCookie());
    } catch (error) {
      return _dy_fail(error);
    }
  },

  getRoomDetail(payload) {
    const deferred = _dy_deferred();
    try {
      const runtimePayload = _dy_runtimePayload(payload);
      const roomId = _dy_toString(runtimePayload.roomId);
      const userId = _dy_toString(runtimePayload.userId);
      if (!roomId) _dy_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
      _dy_getDouyinRoomDetailCb(roomId, userId, "", 3, function (error, data) {
        if (error) {
          deferred.reject(error);
          return;
        }
        try {
          deferred.resolve(_dy_buildLiveModel(data, roomId));
        } catch (buildError) {
          deferred.reject(buildError);
        }
      });
    } catch (error) {
      deferred.reject(error);
    }
    return deferred.thenable;
  },

  getLiveState(payload) {
    const deferred = _dy_deferred();
    let detail;
    try {
      detail = this.getRoomDetail(payload);
    } catch (error) {
      deferred.reject(error);
      return deferred.thenable;
    }
    detail.then(function (latest) {
      deferred.resolve({ liveState: _dy_toString((latest && latest.liveState) || "3") });
    }, function (error) {
      deferred.reject(error);
    });
    return deferred.thenable;
  },

  resolveShare(payload) {
    const deferred = _dy_deferred();
    try {
      const runtimePayload = _dy_runtimePayload(payload);
      const shareCode = _dy_toString(runtimePayload.shareCode);
      if (!shareCode) _dy_throw("INVALID_ARGS", "shareCode is required", { field: "shareCode" });
      _dy_resolveRoomIdFromShareCode(shareCode, "").then(function (resolved) {
        if (resolved && resolved.shareModel) {
          deferred.resolve(resolved.shareModel);
          return;
        }
        globalThis.LiveParsePlugin.getRoomDetail({ roomId: resolved.roomId, userId: resolved.userId }).then(deferred.resolve, deferred.reject);
      }, deferred.reject);
    } catch (error) {
      deferred.reject(error);
    }
    return deferred.thenable;
  },

  getDanmaku(payload) {
    const deferred = _dy_deferred();
    try {
      const runtimePayload = _dy_runtimePayload(payload);
      const driver = _dy_sharedDanmakuDriver();
      if (driver && typeof driver.getDanmakuPlan === "function") {
        return _dy_export(driver.getDanmakuPlan(runtimePayload));
      }
      _dy_buildDanmakuContext(runtimePayload).then(function (context) {
        deferred.resolve(_dy_buildLegacyDanmakuResult(context));
      }, deferred.reject);
    } catch (error) {
      deferred.reject(error);
    }
    return deferred.thenable;
  },

  createDanmakuSession(payload) {
    try {
      const driver = _dy_sharedDanmakuDriver();
      if (!driver || typeof driver.createDanmakuSession !== "function") {
        _dy_throw("UNSUPPORTED", "douyin danmaku driver is unavailable", {});
      }
      return _dy_export(driver.createDanmakuSession(payload || {}));
    } catch (error) {
      return _dy_fail(error);
    }
  },

  onDanmakuOpen(payload) {
    try {
      const driver = _dy_sharedDanmakuDriver();
      if (!driver || typeof driver.onDanmakuOpen !== "function") {
        _dy_throw("UNSUPPORTED", "douyin danmaku driver is unavailable", {});
      }
      return _dy_export(driver.onDanmakuOpen(payload || {}));
    } catch (error) {
      return _dy_fail(error);
    }
  },

  onDanmakuFrame(payload) {
    try {
      const driver = _dy_sharedDanmakuDriver();
      if (!driver || typeof driver.onDanmakuFrame !== "function") {
        _dy_throw("UNSUPPORTED", "douyin danmaku driver is unavailable", {});
      }
      return _dy_export(driver.onDanmakuFrame(payload || {}));
    } catch (error) {
      return _dy_fail(error);
    }
  },

  onDanmakuTick(payload) {
    try {
      const driver = _dy_sharedDanmakuDriver();
      if (!driver || typeof driver.onDanmakuTick !== "function") {
        _dy_throw("UNSUPPORTED", "douyin danmaku driver is unavailable", {});
      }
      return _dy_export(driver.onDanmakuTick(payload || {}));
    } catch (error) {
      return _dy_fail(error);
    }
  },

  destroyDanmakuSession(payload) {
    try {
      const driver = _dy_sharedDanmakuDriver();
      if (!driver || typeof driver.destroyDanmakuSession !== "function") {
        return _dy_ready({ ok: true });
      }
      return _dy_export(driver.destroyDanmakuSession(payload || {}));
    } catch (error) {
      return _dy_fail(error);
    }
  }
};


// ---- a_bogus implementation aligned with Swift ABogus (pageId=0, bigArray transform) ----
function rc4_encrypt(plaintext, key) {
    var s = [];
    for (var i = 0; i < 256; i++) {
        s[i] = i;
    }
    var j = 0;
    for (var i = 0; i < 256; i++) {
        j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
        var temp = s[i];
        s[i] = s[j];
        s[j] = temp;
    }

    var i = 0;
    var j = 0;
    var cipher = [];
    for (var k = 0; k < plaintext.length; k++) {
        i = (i + 1) % 256;
        j = (j + s[i]) % 256;
        var temp = s[i];
        s[i] = s[j];
        s[j] = temp;
        var t = (s[i] + s[j]) % 256;
        cipher.push(String.fromCharCode(s[t] ^ plaintext.charCodeAt(k)));
    }
    return cipher.join('');
}

// SM3 implementation (vendored from sm-crypto, MIT license)
const _dy_sm3_W = new Uint32Array(68);
const _dy_sm3_M = new Uint32Array(64);
const _dy_sm3_blockLen = 64;
const _dy_sm3_iPad = new Uint8Array(_dy_sm3_blockLen);
const _dy_sm3_oPad = new Uint8Array(_dy_sm3_blockLen);
for (let _lp_i = 0; _lp_i < _dy_sm3_blockLen; _lp_i++) {
    _dy_sm3_iPad[_lp_i] = 0x36;
    _dy_sm3_oPad[_lp_i] = 0x5C;
}

function _dy_sm3_rotl(x, n) {
    const s = n & 31;
    return (x << s) | (x >>> (32 - s));
}

function _dy_sm3_xor(x, y) {
    const result = [];
    for (let i = x.length - 1; i >= 0; i--) result[i] = (x[i] ^ y[i]) & 0xFF;
    return result;
}

function _dy_sm3_P0(X) { return (_dy_sm3_rotl(X, 9) ^ _dy_sm3_rotl(X, 17) ^ X); }
function _dy_sm3_P1(X) { return (_dy_sm3_rotl(X, 15) ^ _dy_sm3_rotl(X, 23) ^ X); }

function _dy_sm3_core(array) {
    let len = array.length * 8;
    let k = len % 512;
    k = k >= 448 ? 512 - (k % 448) - 1 : 448 - k - 1;
    const kArr = new Array((k - 7) / 8);
    const lenArr = new Array(8);
    for (let i = 0; i < kArr.length; i++) kArr[i] = 0;
    for (let i = 0; i < lenArr.length; i++) lenArr[i] = 0;
    len = len.toString(2);
    for (let i = 7; i >= 0; i--) {
        if (len.length > 8) {
            const start = len.length - 8;
            lenArr[i] = parseInt(len.substr(start), 2);
            len = len.substr(0, start);
        } else if (len.length > 0) {
            lenArr[i] = parseInt(len, 2);
            len = "";
        }
    }
    const m = new Uint8Array([...array, 0x80, ...kArr, ...lenArr]);
    const dataView = new DataView(m.buffer, 0);
    const n = m.length / 64;
    const V = new Uint32Array([0x7380166F, 0x4914B2B9, 0x172442D7, 0xDA8A0600, 0xA96F30BC, 0x163138AA, 0xE38DEE4D, 0xB0FB0E4E]);
    for (let i = 0; i < n; i++) {
        _dy_sm3_W.fill(0); _dy_sm3_M.fill(0);
        const start = 16 * i;
        for (let j = 0; j < 16; j++) _dy_sm3_W[j] = dataView.getUint32((start + j) * 4, false);
        for (let j = 16; j < 68; j++) _dy_sm3_W[j] = (_dy_sm3_P1((_dy_sm3_W[j - 16] ^ _dy_sm3_W[j - 9]) ^ _dy_sm3_rotl(_dy_sm3_W[j - 3], 15)) ^ _dy_sm3_rotl(_dy_sm3_W[j - 13], 7) ^ _dy_sm3_W[j - 6]);
        for (let j = 0; j < 64; j++) _dy_sm3_M[j] = _dy_sm3_W[j] ^ _dy_sm3_W[j + 4];
        const T1 = 0x79CC4519, T2 = 0x7A879D8A;
        let A = V[0], B = V[1], C = V[2], D = V[3], E = V[4], F = V[5], G = V[6], H = V[7];
        for (let j = 0; j < 64; j++) {
            const T = j <= 15 ? T1 : T2;
            const SS1 = _dy_sm3_rotl(_dy_sm3_rotl(A, 12) + E + _dy_sm3_rotl(T, j), 7);
            const SS2 = SS1 ^ _dy_sm3_rotl(A, 12);
            const TT1 = (j <= 15 ? ((A ^ B) ^ C) : (((A & B) | (A & C)) | (B & C))) + D + SS2 + _dy_sm3_M[j];
            const TT2 = (j <= 15 ? ((E ^ F) ^ G) : ((E & F) | ((~E) & G))) + H + SS1 + _dy_sm3_W[j];
            D = C; C = _dy_sm3_rotl(B, 9); B = A; A = TT1;
            H = G; G = _dy_sm3_rotl(F, 19); F = E; E = _dy_sm3_P0(TT2);
        }
        V[0] ^= A; V[1] ^= B; V[2] ^= C; V[3] ^= D; V[4] ^= E; V[5] ^= F; V[6] ^= G; V[7] ^= H;
    }
    const result = [];
    for (let i = 0; i < V.length; i++) {
        const word = V[i];
        result.push((word & 0xFF000000) >>> 24, (word & 0xFF0000) >>> 16, (word & 0xFF00) >>> 8, word & 0xFF);
    }
    return result;
}

function _dy_sm3_hmac(input, key) {
    if (key.length > _dy_sm3_blockLen) key = _dy_sm3_core(key);
    while (key.length < _dy_sm3_blockLen) key.push(0);
    return _dy_sm3_core([..._dy_sm3_xor(key, _dy_sm3_oPad), ..._dy_sm3_core([..._dy_sm3_xor(key, _dy_sm3_iPad), ...input])]);
}

function _dy_sm3_arrayToHex(arr) { return arr.map(function(item) { const h = item.toString(16); return h.length === 1 ? "0" + h : h; }).join(""); }
function _dy_sm3_hexToArray(hexStr) {
    const words = []; let text = _dy_toString(hexStr);
    if (text.length % 2 !== 0) text = "0" + text;
    for (let i = 0; i < text.length; i += 2) words.push(parseInt(text.substr(i, 2), 16));
    return words;
}
function _dy_sm3_utf8ToArray(str) {
    const arr = [];
    for (let i = 0; i < str.length; i++) {
        const point = str.codePointAt(i);
        if (point <= 0x007F) { arr.push(point); }
        else if (point <= 0x07FF) { arr.push(0xC0 | (point >>> 6)); arr.push(0x80 | (point & 0x3F)); }
        else if (point <= 0xD7FF || (point >= 0xE000 && point <= 0xFFFF)) { arr.push(0xE0 | (point >>> 12)); arr.push(0x80 | ((point >>> 6) & 0x3F)); arr.push(0x80 | (point & 0x3F)); }
        else if (point >= 0x010000 && point <= 0x10FFFF) { i += 1; arr.push(0xF0 | ((point >>> 18) & 0x1C)); arr.push(0x80 | ((point >>> 12) & 0x3F)); arr.push(0x80 | ((point >>> 6) & 0x3F)); arr.push(0x80 | (point & 0x3F)); }
        else { arr.push(point); }
    }
    return arr;
}

function sm3(input, options) {
    const normalizedInput = typeof input === "string" ? _dy_sm3_utf8ToArray(input) : Array.prototype.slice.call(input);
    if (options) {
        let key = options.key;
        if (!key) throw new Error("invalid key");
        key = typeof key === "string" ? _dy_sm3_hexToArray(key) : Array.prototype.slice.call(key);
        return _dy_sm3_arrayToHex(_dy_sm3_hmac(normalizedInput, key));
    }
    return _dy_sm3_arrayToHex(_dy_sm3_core(normalizedInput));
}

// ---- Swift-aligned ABogus (pageId=0, bigArray, Edge fingerprint) ----
const _ab_character = "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe";
const _ab_character2 = "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe";
const _ab_salt = "cus";
const _ab_pageId = 0;
const _ab_aid = 6383;
const _ab_uaKey = [0x00, 0x01, 0x0E];
const _ab_options = [0, 1, 14];
const _ab_sortIndex = [18,20,52,26,30,34,58,38,40,53,42,21,27,54,55,31,35,57,39,41,43,22,28,32,60,36,23,29,33,37,44,45,59,46,47,48,49,50,24,25,65,66,70,71];
const _ab_sortIndex2 = [18,20,26,30,34,38,40,42,21,27,31,35,39,41,43,22,28,32,36,23,29,33,37,44,45,46,47,48,49,50,24,25,52,53,54,55,57,58,59,60,65,66,70,71];

function _ab_createBigArray() {
    return [121,243,55,234,103,36,47,228,30,231,106,6,115,95,78,101,250,207,198,50,139,227,220,105,97,143,34,28,194,215,18,100,159,160,43,8,169,217,180,120,247,45,90,11,27,197,46,3,84,72,5,68,62,56,221,75,144,79,73,161,178,81,64,187,134,117,186,118,16,241,130,71,89,147,122,129,65,40,88,150,110,219,199,255,181,254,48,4,195,248,208,32,116,167,69,201,17,124,125,104,96,83,80,127,236,108,154,126,204,15,20,135,112,158,13,1,188,164,210,237,222,98,212,77,253,42,170,202,26,22,29,182,251,10,173,152,58,138,54,141,185,33,157,31,252,132,233,235,102,196,191,223,240,148,39,123,92,82,128,109,57,24,38,113,209,245,2,119,153,229,189,214,230,174,232,63,52,205,86,140,66,175,111,171,246,133,238,193,99,60,74,91,225,51,76,37,145,211,166,151,213,206,0,200,244,176,218,44,184,172,49,216,93,168,53,21,183,41,67,85,224,155,226,242,87,177,146,70,190,12,162,19,137,114,25,165,163,192,23,59,9,94,179,107,35,7,142,131,239,203,149,136,61,249,14,156];
}

function _ab_sm3ToArray(input) {
    return _dy_sm3_hexToArray(sm3(input));
}

function _ab_paramsToArray(param, addSalt) {
    if (addSalt === undefined) addSalt = true;
    if (typeof param === "string" && addSalt) return _ab_sm3ToArray(param + _ab_salt);
    return _ab_sm3ToArray(param);
}

function _ab_base64Encode(inputString, selectedAlphabet) {
    const alphabet = selectedAlphabet === 1 ? _ab_character2 : _ab_character;
    const charValues = [];
    for (let i = 0; i < inputString.length; i++) charValues.push(inputString.charCodeAt(i) & 0xFF);
    let binaryString = charValues.map(function(v) { let s = v.toString(2); while (s.length < 8) s = "0" + s; return s; }).join("");
    const paddingLength = (6 - binaryString.length % 6) % 6;
    binaryString += "0".repeat(paddingLength);
    let result = "";
    for (let i = 0; i < binaryString.length; i += 6) result += alphabet[parseInt(binaryString.substring(i, i + 6), 2)];
    return result + "=".repeat(Math.floor(paddingLength / 2));
}

function _ab_transformBytes(bigArray, bytesList) {
    let resultValues = [];
    let indexB = bigArray[1];
    let initialValue = 0;
    let valueE = 0;
    for (let index = 0; index < bytesList.length; index++) {
        let sumInitial;
        if (index === 0) {
            initialValue = bigArray[indexB];
            sumInitial = indexB + initialValue;
            bigArray[1] = initialValue;
            bigArray[indexB] = indexB;
        } else {
            sumInitial = initialValue + valueE;
        }
        const charValue = bytesList[index] & 0xFF;
        sumInitial = ((sumInitial % bigArray.length) + bigArray.length) % bigArray.length;
        const valueF = bigArray[sumInitial];
        resultValues.push(charValue ^ valueF);
        valueE = bigArray[(index + 2) % bigArray.length];
        sumInitial = ((indexB + valueE) % bigArray.length + bigArray.length) % bigArray.length;
        initialValue = bigArray[sumInitial];
        bigArray[sumInitial] = bigArray[(index + 2) % bigArray.length];
        bigArray[(index + 2) % bigArray.length] = initialValue;
        indexB = sumInitial;
    }
    return resultValues;
}

function _ab_abogusEncode(randomValues, transformValues) {
    const alphabet = _ab_character;
    const charValues = randomValues.concat(transformValues);
    let abogus = [];
    for (let i = 0; i < charValues.length; i += 3) {
        let n;
        if (i + 2 < charValues.length) n = ((charValues[i] & 0xFF) << 16) | ((charValues[i+1] & 0xFF) << 8) | (charValues[i+2] & 0xFF);
        else if (i + 1 < charValues.length) n = ((charValues[i] & 0xFF) << 16) | ((charValues[i+1] & 0xFF) << 8);
        else n = (charValues[i] & 0xFF) << 16;
        const shifts = [18, 12, 6, 0], masks = [0xFC0000, 0x03F000, 0x0FC0, 0x3F];
        for (let j = 0; j < 4; j++) {
            if (shifts[j] === 6 && i + 1 >= charValues.length) break;
            if (shifts[j] === 0 && i + 2 >= charValues.length) break;
            abogus.push(alphabet[(n & masks[j]) >> shifts[j]]);
        }
    }
    return abogus.join("") + "=".repeat((4 - abogus.length % 4) % 4);
}

function _ab_generateRandomBytes() {
    let result = [];
    for (let i = 0; i < 3; i++) {
        const rd = Math.floor(Math.random() * 10000);
        result.push(((rd & 255) & 170) | 1);
        result.push(((rd & 255) & 85) | 2);
        result.push((((rd & 0xFFFFFFFF) >>> 8) & 170) | 5);
        result.push((((rd & 0xFFFFFFFF) >>> 8) & 85) | 40);
    }
    return result;
}

function _ab_generateEdgeFingerprint() {
    function r(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    const iw = r(1024, 1920), ih = r(768, 1080);
    const ow = iw + r(24, 32), oh = ih + r(75, 90);
    const sy = [0, 30][Math.floor(Math.random() * 2)];
    const sw = r(1024, 1920), sh = r(768, 1080), aw = r(1280, 1920), ah = r(800, 1080);
    return iw+"|"+ih+"|"+ow+"|"+oh+"|0|"+sy+"|0|0|"+sw+"|"+sh+"|"+aw+"|"+ah+"|"+iw+"|"+ih+"|24|24|Win32";
}

function _ab_generateAbogus(params) {
    const userAgent = _dy_ua;
    const browserFp = _ab_generateEdgeFingerprint();
    const bigArray = _ab_createBigArray();

    let abDir = {};
    abDir[8] = 3;
    abDir[18] = 44;
    abDir[66] = 0; abDir[69] = 0; abDir[70] = 0; abDir[71] = 0;

    const startEncryption = Date.now();
    const array0 = _ab_paramsToArray(params, true);
    const array1 = _ab_sm3ToArray(array0);
    const bodyArray0 = _ab_paramsToArray("", true);
    const array2 = _ab_sm3ToArray(bodyArray0);
    const uaKeyStr = String.fromCharCode.apply(null, _ab_uaKey);
    const encryptedUA = rc4_encrypt(userAgent, uaKeyStr);
    const base64EncodedUA = _ab_base64Encode(encryptedUA, 1);
    const array3 = _dy_sm3_hexToArray(sm3(base64EncodedUA));
    const endEncryption = Date.now();

    abDir[20] = (startEncryption >> 24) & 255;
    abDir[21] = (startEncryption >> 16) & 255;
    abDir[22] = (startEncryption >> 8) & 255;
    abDir[23] = startEncryption & 255;
    abDir[24] = Math.floor(startEncryption / 256 / 256 / 256 / 256);
    abDir[25] = Math.floor(startEncryption / 256 / 256 / 256 / 256 / 256);
    abDir[26] = 0; abDir[27] = 0; abDir[28] = 0; abDir[29] = 0;
    abDir[30] = 0; abDir[31] = 1; abDir[32] = 0; abDir[33] = 0;
    abDir[34] = 0; abDir[35] = 0; abDir[36] = 0; abDir[37] = 14;
    abDir[38] = array1[21]; abDir[39] = array1[22];
    abDir[40] = array2[21]; abDir[41] = array2[22];
    abDir[42] = array3[23]; abDir[43] = array3[24];
    abDir[44] = (endEncryption >> 24) & 255;
    abDir[45] = (endEncryption >> 16) & 255;
    abDir[46] = (endEncryption >> 8) & 255;
    abDir[47] = endEncryption & 255;
    abDir[48] = 3;
    abDir[49] = Math.floor(endEncryption / 256 / 256 / 256 / 256);
    abDir[50] = Math.floor(endEncryption / 256 / 256 / 256 / 256 / 256);
    abDir[51] = 0; abDir[52] = 0; abDir[53] = 0; abDir[54] = 0; abDir[55] = 0;
    abDir[56] = 6383; abDir[57] = 6383 & 255; abDir[58] = (6383 >> 8) & 255; abDir[59] = 0; abDir[60] = 0;
    abDir[64] = browserFp.length;
    abDir[65] = browserFp.length;

    const fpBytes = [];
    for (let i = 0; i < browserFp.length; i++) fpBytes.push(browserFp.charCodeAt(i) & 0xFF);

    let abXor = (browserFp.length & 255) >> 8 & 255;
    for (let idx = 0; idx < _ab_sortIndex2.length - 1; idx++) {
        if (idx === 0) abXor = abDir[_ab_sortIndex2[idx]] || 0;
        abXor ^= (abDir[_ab_sortIndex2[idx + 1]] || 0);
    }

    const sortedValues = _ab_sortIndex.map(function(i) { return abDir[i] || 0; });
    const finalSortedValues = sortedValues.concat(fpBytes).concat([abXor]);
    const transformValues = _ab_transformBytes(bigArray, finalSortedValues);
    const randomValues = _ab_generateRandomBytes();
    return _ab_abogusEncode(randomValues, transformValues);
}

function sign_datail(params, userAgent) {
    if (typeof globalThis.__lp_douyin_abogus_sign === "function") {
        try {
            const token = globalThis.__lp_douyin_abogus_sign(params, userAgent || _dy_ua);
            if (token) return String(token);
        } catch (e) {
        }
    }
    return _ab_generateAbogus(params);
}

function sign_reply(params, userAgent) {
    return _ab_generateAbogus(params);
}

/* Adapter exports only content functions: no login challenge, danmu or SDK globals. */
  // The bridge already validates a successful partition JSON response.
  // A confirmed empty data array is a valid empty category/end page, not a blockade.
  var originalPartitionMap = _dy_mapPartitionRooms;
  _dy_mapPartitionRooms = function(list,id,parentId,page) {
    if (Array.isArray(list) && list.length === 0) return [];
    return originalPartitionMap(list,id,parentId,page);
  };
/* ---- 1.2.0 keyword search: classic a_bogus triggers verify_check; search omits it ---- */
  var originalSearchSigner = _dy_signDetail;
  _dy_signDetail = function(qs){
    var text = String(qs || '');
    if (text.indexOf('search_channel=aweme_live') >= 0) return '';
    return originalSearchSigner(qs);
  };
  var originalSearchRequest = _dy_requestWithSession;
  _dy_requestWithSession = function(request){
    var url = String((request && request.url) || '');
    if (url.indexOf('/aweme/v1/web/live/search/') < 0) return originalSearchRequest(request);
    var attempts = 0;
    function once(){
      return originalSearchRequest(request).then(function(res){
        var body = _dy_toString(res && res.bodyText);
        var nilType = '';
        var hit = body.match(/"search_nil_type"\s*:\s*"([^"]*)"/);
        if (hit) nilType = hit[1];
        var emptyData = /"data"\s*:\s*\[\s*\]/.test(body);
        if (!nilType || !emptyData) return res;
        if (attempts < 1) { attempts += 1; return once(); }
        var error = new Error('douyin search blocked: ' + nilType);
        error.code = 'VERIFY_REQUIRED';
        error.nilType = nilType;
        throw error;
      });
    }
    return once();
  };
  var plugin = globalThis.LiveParsePlugin;
  return { categories:plugin.getCategories, home:plugin.getHomeFeed, rooms:plugin.getRooms, detail:plugin.getRoomDetail, playback:plugin.getPlayback,
           search:plugin.search, share:plugin.resolveShare,
           ua:_dy_ua, version:"2.0.58" };
}

var DY_ALL_KEYS=["101|4","102|4","1010032|1","1010005|1","1010324|1","1010040|1","1010022|1","1010053|1","1010013|1","104|4","105|4","106|4","107|4","108|4","1010037|1","1010014|1","1010791|1","1010004|1","1010011|1","1010051|1","1011032|1","1010016|1","1011359|1","1010063|1","1011640|1","1010039|1","1010043|1","1010213|1","1010041|1","1010358|1","1010094|1","1010806|1","1010150|1","1010160|1","1010017|1","1010055|1","1011048|1","1010062|1","1010263|1","1010190|1","1010025|1","1010026|1","1010045|1","1011393|1","1010060|1","1010010|1","1010271|1","1010009|1","1010003|1","1010023|1","1010100|1","1010012|1","1010520|1","1010205|1","1010021|1","1011309|1","1010350|1","1010250|1","1010714|1","1010895|1","1010092|1","1010067|1","1010015|1","1010007|1","1010335|1","1010028|1","1010129|1","1010042|1","1010365|1","1011124|1","1010146|1","1010087|1","1010711|1","1010046|1","1010241|1","1010084|1","1010018|1","1010341|1","1010038|1","1010710|1","1010056|1","1010159|1","1010145|1","1010002|1","1010278|1","1010593|1","1010721|1","1010921|1","1010083|1","1010105|1","1010339|1","1010093|1","1010149|1","1010059|1","1010099|1","1010234|1","1010419|1","1010080|1","1010340|1","1010981|1","1010720|1","1010410|1","1010035|1","1010287|1","1010132|1","1010397|1","1010783|1","1010098|1","1010249|1","1010515|1","1010104|1","1010102|1","1010363|1","1010006|1","1010196|1","1010336|1","1010033|1","1010326|1","1010116|1","1010214|1","1010131|1","1010361|1","1010558|1","1010064|1","1010313|1","1010429|1","1010151|1","1010329|1","1010170|1","1010401|1","1010143|1","1010260|1","1010292|1","1011136|1","1010233|1","1010061|1","1011119|1","1010155|1","1010409|1","1010483|1","1010396|1","1010364|1","1010068|1","1010331|1","1010779|1","1010187|1","1010686|1","1010171|1","1010203|1","1010367|1","1010235|1","1010847|1","1010253|1","1010198|1","1010435|1","1010334|1","1010049|1","1010168|1","1010418|1","1010774|1","1010402|1","1010430|1","1010030|1","1010119|1","1010383|1","1010081|1","1010568|1","1010445|1","1010509|1","1010514|1","1011139|1","1010144|1","1010524|1","1010533|1","1010180|1","1011000|1","1010096|1","1010230|1","1010436|1","1010024|1","1010057|1","1010360|1","1010311|1","1011304|1","1010256|1","1010327|1","1010142|1","1010097|1","1010054|1","1011170|1","1010231|1","1010058|1","1010424|1","1010138|1","1010320|1","1010631|1","1010395|1","1010128|1","1010193|1","1010353|1","1011238|1","1010044|1","1010107|1","1010411|1","1010264|1","1011399|1","1010257|1","1010381|1","1010626|1","1010510|1","1010408|1","1010405|1","1010130|1","1010675|1","1010485|1","1010846|1","1010082|1","1011366|1"];
var DY_DEFAULTS={"101":"101|4","102":"102|4","1":"1010032|1","2":"1010005|1","3":"1010324|1","4":"1010040|1","5":"1010022|1","6":"1010053|1","7":"1010013|1","104":"104|4","105":"105|4","106":"106|4","107":"107|4","108":"108|4"};
var DY_GROUPS=[{"id":"101","title":"聊天","icon":"","biz":"","subList":[{"id":"101","parentId":"4","title":"聊天","icon":"","biz":""}]},{"id":"102","title":"音乐","icon":"","biz":"","subList":[{"id":"102","parentId":"4","title":"音乐","icon":"","biz":""}]},{"id":"1","title":"射击游戏","icon":"","biz":"","subList":[{"id":"1010032","parentId":"1","title":"和平精英","icon":"","biz":""},{"id":"1010037","parentId":"1","title":"穿越火线","icon":"","biz":""},{"id":"1011032","parentId":"1","title":"三角洲行动","icon":"","biz":""},{"id":"1010213","parentId":"1","title":"逆战手游","icon":"","biz":""},{"id":"1010017","parentId":"1","title":"无畏契约","icon":"","biz":""},{"id":"1010026","parentId":"1","title":"绝地求生","icon":"","biz":""},{"id":"1010003","parentId":"1","title":"CSGO","icon":"","biz":""},{"id":"1011309","parentId":"1","title":"无畏契约：源能行动","icon":"","biz":""},{"id":"1010015","parentId":"1","title":"穿越火线：枪战王者","icon":"","biz":""},{"id":"1011124","parentId":"1","title":"暗区突围：无限","icon":"","biz":""},{"id":"1010018","parentId":"1","title":"暗区突围","icon":"","biz":""},{"id":"1010002","parentId":"1","title":"Apex英雄","icon":"","biz":""},{"id":"1010339","parentId":"1","title":"守望先锋","icon":"","biz":""},{"id":"1010080","parentId":"1","title":"使命召唤手游","icon":"","biz":""},{"id":"1010132","parentId":"1","title":"逆战","icon":"","biz":""},{"id":"1010104","parentId":"1","title":"逃离塔科夫","icon":"","biz":""},{"id":"1010336","parentId":"1","title":"反恐精英OL","icon":"","biz":""},{"id":"1010214","parentId":"1","title":"萤火突击","icon":"","biz":""},{"id":"1010064","parentId":"1","title":"荒野行动","icon":"","biz":""},{"id":"1010329","parentId":"1","title":"使命召唤","icon":"","biz":""},{"id":"1010260","parentId":"1","title":"解限机","icon":"","biz":""},{"id":"1010593","parentId":"1","title":"The Finals","icon":"","biz":""},{"id":"1010409","parentId":"1","title":"生死狙击","icon":"","biz":""},{"id":"1010068","parentId":"1","title":"生死狙击2","icon":"","biz":""},{"id":"1010187","parentId":"1","title":"远光84","icon":"","biz":""},{"id":"1010367","parentId":"1","title":"战地1","icon":"","biz":""},{"id":"1010198","parentId":"1","title":"高能英雄","icon":"","biz":""},{"id":"1010168","parentId":"1","title":"卡拉彼丘","icon":"","biz":""},{"id":"1010402","parentId":"1","title":"彩虹六号：围攻","icon":"","biz":""},{"id":"1010383","parentId":"1","title":"堡垒之夜","icon":"","biz":""},{"id":"1010445","parentId":"1","title":"战术小队","icon":"","biz":""},{"id":"1010144","parentId":"1","title":"超凡先锋","icon":"","biz":""}]},{"id":"2","title":"竞技游戏","icon":"","biz":"","subList":[{"id":"1010005","parentId":"1","title":"云顶之弈","icon":"","biz":""},{"id":"1010014","parentId":"1","title":"英雄联盟","icon":"","biz":""},{"id":"1010016","parentId":"1","title":"永劫无间","icon":"","biz":""},{"id":"1010041","parentId":"1","title":"第五人格","icon":"","biz":""},{"id":"1010055","parentId":"1","title":"金铲铲之战","icon":"","biz":""},{"id":"1010045","parentId":"1","title":"王者荣耀","icon":"","biz":""},{"id":"1010023","parentId":"1","title":"英雄联盟手游","icon":"","biz":""},{"id":"1010350","parentId":"1","title":"魔兽争霸3","icon":"","biz":""},{"id":"1010007","parentId":"1","title":"巅峰极速","icon":"","biz":""},{"id":"1010146","parentId":"1","title":"QQ飞车端游","icon":"","biz":""},{"id":"1010341","parentId":"1","title":"DOTA1","icon":"","biz":""},{"id":"1010278","parentId":"1","title":"永劫无间手游","icon":"","biz":""},{"id":"1010093","parentId":"1","title":"DOTA2","icon":"","biz":""},{"id":"1010340","parentId":"1","title":"坦克世界","icon":"","biz":""},{"id":"1010397","parentId":"1","title":"炉石传说","icon":"","biz":""},{"id":"1010102","parentId":"1","title":"红色警戒2","icon":"","biz":""},{"id":"1010033","parentId":"1","title":"QQ飞车手游","icon":"","biz":""},{"id":"1010131","parentId":"1","title":"跑跑卡丁车官方竞速版","icon":"","biz":""},{"id":"1010313","parentId":"1","title":"狼人杀","icon":"","biz":""},{"id":"1010170","parentId":"1","title":"战争雷霆","icon":"","biz":""},{"id":"1010292","parentId":"1","title":"决胜巅峰","icon":"","biz":""},{"id":"1010061","parentId":"1","title":"三国杀","icon":"","biz":""},{"id":"1010483","parentId":"1","title":"星际争霸","icon":"","biz":""},{"id":"1010331","parentId":"1","title":"跑跑卡丁车","icon":"","biz":""},{"id":"1010686","parentId":"1","title":"极品飞车：集结","icon":"","biz":""},{"id":"1010235","parentId":"1","title":"王者万象棋","icon":"","biz":""},{"id":"1010435","parentId":"1","title":"至暗时刻","icon":"","biz":""},{"id":"1010418","parentId":"1","title":"战舰世界","icon":"","biz":""},{"id":"1010430","parentId":"1","title":"恐惧饥荒","icon":"","biz":""},{"id":"1010429","parentId":"1","title":"极限竞速：地平线5","icon":"","biz":""},{"id":"1010509","parentId":"1","title":"星际争霸2","icon":"","biz":""},{"id":"1010524","parentId":"1","title":"王牌竞速","icon":"","biz":""},{"id":"1010180","parentId":"1","title":"全明星街球派对","icon":"","biz":""},{"id":"1010230","parentId":"1","title":"皇室战争","icon":"","biz":""},{"id":"1010057","parentId":"1","title":"决战！平安京","icon":"","biz":""},{"id":"1010030","parentId":"1","title":"实况足球","icon":"","biz":""},{"id":"1010327","parentId":"1","title":"猫和老鼠","icon":"","biz":""},{"id":"1010054","parentId":"1","title":"哈利波特：魔法觉醒","icon":"","biz":""},{"id":"1010058","parentId":"1","title":"逃跑吧！少年","icon":"","biz":""},{"id":"1010138","parentId":"1","title":"荒野乱斗","icon":"","biz":""},{"id":"1010395","parentId":"1","title":"坦克世界：闪电战","icon":"","biz":""},{"id":"1010353","parentId":"1","title":"极限竞速：地平线4","icon":"","biz":""},{"id":"1010107","parentId":"1","title":"最强NBA","icon":"","biz":""},{"id":"1010264","parentId":"1","title":"极品飞车","icon":"","biz":""},{"id":"1010381","parentId":"1","title":"曙光英雄","icon":"","biz":""},{"id":"1010510","parentId":"1","title":"红色警戒3","icon":"","biz":""}]},{"id":"3","title":"单机游戏","icon":"","biz":"","subList":[{"id":"1010324","parentId":"1","title":"植物大战僵尸","icon":"","biz":""},{"id":"1010791","parentId":"1","title":"星露谷物语","icon":"","biz":""},{"id":"1011359","parentId":"1","title":"流放之路2","icon":"","biz":""},{"id":"1010358","parentId":"1","title":"黑神话：悟空","icon":"","biz":""},{"id":"1011048","parentId":"1","title":"俄罗斯钓鱼4","icon":"","biz":""},{"id":"1011393","parentId":"1","title":"Half Sword","icon":"","biz":""},{"id":"1010100","parentId":"1","title":"方舟","icon":"","biz":""},{"id":"1010250","parentId":"1","title":"星际战甲","icon":"","biz":""},{"id":"1010335","parentId":"1","title":"饥荒","icon":"","biz":""},{"id":"1010087","parentId":"1","title":"艾尔登法环","icon":"","biz":""},{"id":"1010038","parentId":"1","title":"猛兽派对","icon":"","biz":""},{"id":"1010593","parentId":"1","title":"The Finals","icon":"","biz":""},{"id":"1010149","parentId":"1","title":"只狼：影逝二度","icon":"","biz":""},{"id":"1010981","parentId":"1","title":"幻兽帕鲁","icon":"","biz":""},{"id":"1010783","parentId":"1","title":"森林之子","icon":"","biz":""},{"id":"1010363","parentId":"1","title":"荒野大镖客2","icon":"","biz":""},{"id":"1010326","parentId":"1","title":"人渣","icon":"","biz":""},{"id":"1010361","parentId":"1","title":"街头霸王6","icon":"","biz":""},{"id":"1010429","parentId":"1","title":"极限竞速：地平线5","icon":"","biz":""},{"id":"1010401","parentId":"1","title":"骑马与砍杀2：霸主","icon":"","biz":""},{"id":"1011136","parentId":"1","title":"掘地求升","icon":"","biz":""},{"id":"1011119","parentId":"1","title":"英雄无敌3","icon":"","biz":""},{"id":"1010396","parentId":"1","title":"泰拉瑞亚","icon":"","biz":""},{"id":"1010779","parentId":"1","title":"全面战争：三国","icon":"","biz":""},{"id":"1010171","parentId":"1","title":"女神异闻录5","icon":"","biz":""},{"id":"1010847","parentId":"1","title":"宝可梦朱紫","icon":"","biz":""},{"id":"1010334","parentId":"1","title":"拳皇97","icon":"","biz":""},{"id":"1010774","parentId":"1","title":"仁王","icon":"","biz":""},{"id":"1010030","parentId":"1","title":"实况足球","icon":"","biz":""},{"id":"1010081","parentId":"1","title":"塞尔达传说：旷野之息","icon":"","biz":""},{"id":"1010514","parentId":"1","title":"三国志14","icon":"","biz":""},{"id":"1010367","parentId":"1","title":"战地1","icon":"","biz":""},{"id":"1011000","parentId":"1","title":"绝地潜兵2","icon":"","biz":""},{"id":"1010436","parentId":"1","title":"双影奇境","icon":"","biz":""},{"id":"1010360","parentId":"1","title":"空洞骑士：丝之歌","icon":"","biz":""},{"id":"1011304","parentId":"1","title":"怪物猎人：荒野","icon":"","biz":""},{"id":"1010142","parentId":"1","title":"都市：天际线","icon":"","biz":""},{"id":"1011170","parentId":"1","title":"链在一起","icon":"","biz":""},{"id":"1010424","parentId":"1","title":"古墓丽影：暗影","icon":"","biz":""},{"id":"1010320","parentId":"1","title":"匹诺曹的谎言","icon":"","biz":""},{"id":"1010128","parentId":"1","title":"赛博朋克2077","icon":"","biz":""},{"id":"1011238","parentId":"1","title":"超级兔子人","icon":"","biz":""},{"id":"1010411","parentId":"1","title":"流放之路","icon":"","biz":""},{"id":"1011399","parentId":"1","title":"天国拯救2","icon":"","biz":""},{"id":"1010626","parentId":"1","title":"潜水员戴夫","icon":"","biz":""},{"id":"1010408","parentId":"1","title":"木筏求生","icon":"","biz":""},{"id":"1010130","parentId":"1","title":"人类：一败涂地","icon":"","biz":""},{"id":"1010485","parentId":"1","title":"刺客信条：奥德赛","icon":"","biz":""},{"id":"1010846","parentId":"1","title":"致命公司","icon":"","biz":""},{"id":"1010353","parentId":"1","title":"极限竞速：地平线4","icon":"","biz":""},{"id":"1010082","parentId":"1","title":"塞尔达传说：王国之泪","icon":"","biz":""},{"id":"1011366","parentId":"1","title":"去上班","icon":"","biz":""},{"id":"1010515","parentId":"1","title":"三国志11","icon":"","biz":""}]},{"id":"4","title":"棋牌游戏","icon":"","biz":"","subList":[{"id":"1010040","parentId":"1","title":"指尖四川麻将","icon":"","biz":""},{"id":"1010004","parentId":"1","title":"JJ斗地主","icon":"","biz":""},{"id":"1010063","parentId":"1","title":"JJ象棋","icon":"","biz":""},{"id":"1010094","parentId":"1","title":"JJ麻将","icon":"","biz":""},{"id":"1010062","parentId":"1","title":"欢乐斗地主","icon":"","biz":""},{"id":"1010060","parentId":"1","title":"天天象棋","icon":"","biz":""},{"id":"1010012","parentId":"1","title":"途游斗地主","icon":"","biz":""},{"id":"1010714","parentId":"1","title":"微乐斗地主","icon":"","biz":""},{"id":"1010028","parentId":"1","title":"芒果斗地主","icon":"","biz":""},{"id":"1010711","parentId":"1","title":"开运麻将","icon":"","biz":""},{"id":"1010710","parentId":"1","title":"微乐四川麻将","icon":"","biz":""},{"id":"1010721","parentId":"1","title":"多乐升级","icon":"","biz":""},{"id":"1010059","parentId":"1","title":"腾讯欢乐麻将","icon":"","biz":""},{"id":"1010720","parentId":"1","title":"多乐够级","icon":"","biz":""},{"id":"1010098","parentId":"1","title":"禅游斗地主","icon":"","biz":""}]},{"id":"5","title":"休闲益智","icon":"","biz":"","subList":[{"id":"1010022","parentId":"1","title":"我的世界","icon":"","biz":""},{"id":"1010011","parentId":"1","title":"蛋仔派对","icon":"","biz":""},{"id":"1011640","parentId":"1","title":"鹅鸭杀（手游）","icon":"","biz":""},{"id":"1010806","parentId":"1","title":"天天台球","icon":"","biz":""},{"id":"1010263","parentId":"1","title":"元梦之星","icon":"","biz":""},{"id":"1010010","parentId":"1","title":"球球大作战","icon":"","biz":""},{"id":"1010520","parentId":"1","title":"开心消消乐","icon":"","biz":""},{"id":"1010895","parentId":"1","title":"群雄逐鹿","icon":"","biz":""},{"id":"1010129","parentId":"1","title":"忍者必须死3","icon":"","biz":""},{"id":"1010046","parentId":"1","title":"迷你世界","icon":"","biz":""},{"id":"1010056","parentId":"1","title":"贪吃蛇大作战","icon":"","biz":""},{"id":"1010921","parentId":"1","title":"台球帝国","icon":"","biz":""},{"id":"1010099","parentId":"1","title":"地铁跑酷","icon":"","biz":""},{"id":"1010410","parentId":"1","title":"天天酷跑","icon":"","biz":""}]},{"id":"6","title":"角色扮演","icon":"","biz":"","subList":[{"id":"1010053","parentId":"1","title":"梦幻西游","icon":"","biz":""},{"id":"1010051","parentId":"1","title":"梦幻西游手游","icon":"","biz":""},{"id":"1010039","parentId":"1","title":"原神","icon":"","biz":""},{"id":"1010150","parentId":"1","title":"魔兽世界","icon":"","biz":""},{"id":"1010190","parentId":"1","title":"明日方舟：终末地","icon":"","biz":""},{"id":"1010271","parentId":"1","title":"燕云十六声","icon":"","biz":""},{"id":"1010205","parentId":"1","title":"大话西游2","icon":"","biz":""},{"id":"1010092","parentId":"1","title":"地下城与勇士","icon":"","biz":""},{"id":"1010042","parentId":"1","title":"火影忍者手游","icon":"","biz":""},{"id":"1010241","parentId":"1","title":"火炬之光：无限","icon":"","biz":""},{"id":"1010159","parentId":"1","title":"鸣潮","icon":"","biz":""},{"id":"1010083","parentId":"1","title":"逆水寒手游","icon":"","biz":""},{"id":"1010234","parentId":"1","title":"地下城与勇士：起源","icon":"","biz":""},{"id":"1010035","parentId":"1","title":"光遇","icon":"","biz":""},{"id":"1010249","parentId":"1","title":"剑网3","icon":"","biz":""},{"id":"1010006","parentId":"1","title":"明日之后","icon":"","biz":""},{"id":"1010116","parentId":"1","title":"问道","icon":"","biz":""},{"id":"1010558","parentId":"1","title":"七日世界","icon":"","biz":""},{"id":"1010151","parentId":"1","title":"诛仙世界","icon":"","biz":""},{"id":"1010143","parentId":"1","title":"大话西游","icon":"","biz":""},{"id":"1010233","parentId":"1","title":"命运方舟","icon":"","biz":""},{"id":"1010155","parentId":"1","title":"绝区零","icon":"","biz":""},{"id":"1010364","parentId":"1","title":"逆水寒","icon":"","biz":""},{"id":"1010250","parentId":"1","title":"星际战甲","icon":"","biz":""},{"id":"1010203","parentId":"1","title":"洛克王国","icon":"","biz":""},{"id":"1010253","parentId":"1","title":"无限暖暖","icon":"","biz":""},{"id":"1010049","parentId":"1","title":"梦幻西游网页版","icon":"","biz":""},{"id":"1010149","parentId":"1","title":"只狼：影逝二度","icon":"","biz":""},{"id":"1010119","parentId":"1","title":"天涯明月刀","icon":"","biz":""},{"id":"1010568","parentId":"1","title":"新大话西游3","icon":"","biz":""},{"id":"1011139","parentId":"1","title":"航海王：壮志雄心","icon":"","biz":""},{"id":"1010533","parentId":"1","title":"妄想山海","icon":"","biz":""},{"id":"1010096","parentId":"1","title":"暗黑破坏神：不朽","icon":"","biz":""},{"id":"1010024","parentId":"1","title":"月圆之夜","icon":"","biz":""},{"id":"1010311","parentId":"1","title":"冒险岛：枫之传说","icon":"","biz":""},{"id":"1010256","parentId":"1","title":"诛仙2","icon":"","biz":""},{"id":"1010097","parentId":"1","title":"长安幻想","icon":"","biz":""},{"id":"1010231","parentId":"1","title":"航海王热血航线","icon":"","biz":""},{"id":"1010171","parentId":"1","title":"女神异闻录5","icon":"","biz":""},{"id":"1010631","parentId":"1","title":"境·界 刀鸣","icon":"","biz":""},{"id":"1010193","parentId":"1","title":"星球：重启","icon":"","biz":""},{"id":"1010044","parentId":"1","title":"晶核","icon":"","biz":""},{"id":"1010320","parentId":"1","title":"匹诺曹的谎言","icon":"","biz":""},{"id":"1010257","parentId":"1","title":"新完美世界","icon":"","biz":""},{"id":"1010411","parentId":"1","title":"流放之路","icon":"","biz":""},{"id":"1010405","parentId":"1","title":"激战2","icon":"","biz":""},{"id":"1010675","parentId":"1","title":"时空猎人3","icon":"","biz":""}]},{"id":"7","title":"策略卡牌","icon":"","biz":"","subList":[{"id":"1010013","parentId":"1","title":"明日方舟","icon":"","biz":""},{"id":"1010324","parentId":"1","title":"植物大战僵尸","icon":"","biz":""},{"id":"1010043","parentId":"1","title":"崩坏：星穹铁道","icon":"","biz":""},{"id":"1010160","parentId":"1","title":"少女前线2：追放","icon":"","biz":""},{"id":"1010025","parentId":"1","title":"阴阳师","icon":"","biz":""},{"id":"1010009","parentId":"1","title":"三国志·战略版","icon":"","biz":""},{"id":"1010021","parentId":"1","title":"率土之滨","icon":"","biz":""},{"id":"1010067","parentId":"1","title":"植物大战僵尸2","icon":"","biz":""},{"id":"1010365","parentId":"1","title":"斗罗大陆：魂师对决","icon":"","biz":""},{"id":"1010084","parentId":"1","title":"恋与深空","icon":"","biz":""},{"id":"1010145","parentId":"1","title":"部落冲突","icon":"","biz":""},{"id":"1010105","parentId":"1","title":"万国觉醒","icon":"","biz":""},{"id":"1010419","parentId":"1","title":"奥奇传说","icon":"","biz":""},{"id":"1010287","parentId":"1","title":"大话西游：归来","icon":"","biz":""},{"id":"1010515","parentId":"1","title":"三国志11","icon":"","biz":""},{"id":"1010196","parentId":"1","title":"重返未来1999","icon":"","biz":""}]},{"id":"104","title":"二次元","icon":"","biz":"","subList":[{"id":"104","parentId":"4","title":"二次元","icon":"","biz":""}]},{"id":"105","title":"舞蹈","icon":"","biz":"","subList":[{"id":"105","parentId":"4","title":"舞蹈","icon":"","biz":""}]},{"id":"106","title":"文化","icon":"","biz":"","subList":[{"id":"106","parentId":"4","title":"文化","icon":"","biz":""}]},{"id":"107","title":"生活","icon":"","biz":"","subList":[{"id":"107","parentId":"4","title":"生活","icon":"","biz":""}]},{"id":"108","title":"运动","icon":"","biz":"","subList":[{"id":"108","parentId":"4","title":"运动","icon":"","biz":""}]}];
definePackage({id:"conflux.douyin",title:"抖音直播",version:"1.4.0",engine:1,author:"Angel Live / Conflux移植",site:"https://live.douyin.com/",icon:"https://live.douyin.com/favicon.ico",description:"抖音公开直播：新增抖音直播聚合分类，分页汇总现有218个分区接口并去重；保留14分类组、230子选项与房间号查找、多清晰度HLS。非抖音全站完整目录；新增按主播/标题关键词搜索直播间（需登录Cookie，可能遇到抖音安全验证）；无扫码登录/实时弹幕。",permissions:{network:["https://live.douyin.com","https://www.douyin.com","https://v.douyin.com","https://webcast.amemv.com","https://ttwid.bytedance.com"]},settings:[{name:"cookie",title:"抖音 Cookie（选填）",type:"text",default:"",description:"用于直播访问权限和关键词搜索。含账号凭据，仅在本机使用；不提供扫码登录。未填写时关键词搜索会提示需要登录。"}],extensions:[
{type:"widget",id:"all-live",title:"抖音直播",template:"poster-grid",headerIntent:"list",ref:{source:"custom",id:"dyall:live",mediaType:"movie"},families:["medium","large"],params:[],cache:{ttlSeconds:60},placeholderData:{items:[{ref:{source:"custom",id:"douyin:1",mediaType:"movie"},title:"抖音直播",subtitle:"各分区直播间分页汇总",intent:"play"}]},load:dyAllWidget},
{"type":"widget","id":"group-101","title":"聊天","template":"backdrop-rail","headerIntent":"list","ref":{"source":"custom","id":"dygroup:101","mediaType":"movie"},"families":["extraLarge"],"cache":{"ttlSeconds":120},"params":[],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"聊天直播","subtitle":"添加后加载在线直播间","intent":"play"}]},"constants":{"category":"101|4"},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"101|4"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"101|4"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-102","title":"音乐","template":"poster-pager","headerIntent":"list","ref":{"source":"custom","id":"dygroup:102","mediaType":"movie"},"families":["extraLarge"],"cache":{"ttlSeconds":120},"params":[],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"音乐直播","subtitle":"添加后加载在线直播间","intent":"play"}]},"constants":{"category":"102|4"},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"102|4"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"102|4"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-1","title":"射击游戏","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:1","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[{"name":"category","title":"直播分类","type":"select","default":"1010032|1","options":[{"title":"和平精英","value":"1010032|1"},{"title":"穿越火线","value":"1010037|1"},{"title":"三角洲行动","value":"1011032|1"},{"title":"逆战手游","value":"1010213|1"},{"title":"无畏契约","value":"1010017|1"},{"title":"绝地求生","value":"1010026|1"},{"title":"CSGO","value":"1010003|1"},{"title":"无畏契约：源能行动","value":"1011309|1"},{"title":"穿越火线：枪战王者","value":"1010015|1"},{"title":"暗区突围：无限","value":"1011124|1"},{"title":"暗区突围","value":"1010018|1"},{"title":"Apex英雄","value":"1010002|1"},{"title":"守望先锋","value":"1010339|1"},{"title":"使命召唤手游","value":"1010080|1"},{"title":"逆战","value":"1010132|1"},{"title":"逃离塔科夫","value":"1010104|1"},{"title":"反恐精英OL","value":"1010336|1"},{"title":"萤火突击","value":"1010214|1"},{"title":"荒野行动","value":"1010064|1"},{"title":"使命召唤","value":"1010329|1"},{"title":"解限机","value":"1010260|1"},{"title":"The Finals","value":"1010593|1"},{"title":"生死狙击","value":"1010409|1"},{"title":"生死狙击2","value":"1010068|1"},{"title":"远光84","value":"1010187|1"},{"title":"战地1","value":"1010367|1"},{"title":"高能英雄","value":"1010198|1"},{"title":"卡拉彼丘","value":"1010168|1"},{"title":"彩虹六号：围攻","value":"1010402|1"},{"title":"堡垒之夜","value":"1010383|1"},{"title":"战术小队","value":"1010445|1"},{"title":"超凡先锋","value":"1010144|1"}]}],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"射击游戏直播","subtitle":"添加后加载在线直播间","intent":"play"}]},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"1010032|1"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"1010032|1"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-2","title":"竞技游戏","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:2","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[{"name":"category","title":"直播分类","type":"select","default":"1010005|1","options":[{"title":"云顶之弈","value":"1010005|1"},{"title":"英雄联盟","value":"1010014|1"},{"title":"永劫无间","value":"1010016|1"},{"title":"第五人格","value":"1010041|1"},{"title":"金铲铲之战","value":"1010055|1"},{"title":"王者荣耀","value":"1010045|1"},{"title":"英雄联盟手游","value":"1010023|1"},{"title":"魔兽争霸3","value":"1010350|1"},{"title":"巅峰极速","value":"1010007|1"},{"title":"QQ飞车端游","value":"1010146|1"},{"title":"DOTA1","value":"1010341|1"},{"title":"永劫无间手游","value":"1010278|1"},{"title":"DOTA2","value":"1010093|1"},{"title":"坦克世界","value":"1010340|1"},{"title":"炉石传说","value":"1010397|1"},{"title":"红色警戒2","value":"1010102|1"},{"title":"QQ飞车手游","value":"1010033|1"},{"title":"跑跑卡丁车官方竞速版","value":"1010131|1"},{"title":"狼人杀","value":"1010313|1"},{"title":"战争雷霆","value":"1010170|1"},{"title":"决胜巅峰","value":"1010292|1"},{"title":"三国杀","value":"1010061|1"},{"title":"星际争霸","value":"1010483|1"},{"title":"跑跑卡丁车","value":"1010331|1"},{"title":"极品飞车：集结","value":"1010686|1"},{"title":"王者万象棋","value":"1010235|1"},{"title":"至暗时刻","value":"1010435|1"},{"title":"战舰世界","value":"1010418|1"},{"title":"恐惧饥荒","value":"1010430|1"},{"title":"极限竞速：地平线5","value":"1010429|1"},{"title":"星际争霸2","value":"1010509|1"},{"title":"王牌竞速","value":"1010524|1"},{"title":"全明星街球派对","value":"1010180|1"},{"title":"皇室战争","value":"1010230|1"},{"title":"决战！平安京","value":"1010057|1"},{"title":"实况足球","value":"1010030|1"},{"title":"猫和老鼠","value":"1010327|1"},{"title":"哈利波特：魔法觉醒","value":"1010054|1"},{"title":"逃跑吧！少年","value":"1010058|1"},{"title":"荒野乱斗","value":"1010138|1"},{"title":"坦克世界：闪电战","value":"1010395|1"},{"title":"极限竞速：地平线4","value":"1010353|1"},{"title":"最强NBA","value":"1010107|1"},{"title":"极品飞车","value":"1010264|1"},{"title":"曙光英雄","value":"1010381|1"},{"title":"红色警戒3","value":"1010510|1"}]}],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"竞技游戏直播","subtitle":"添加后加载在线直播间","intent":"play"}]},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"1010005|1"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"1010005|1"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-3","title":"单机游戏","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:3","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[{"name":"category","title":"直播分类","type":"select","default":"1010324|1","options":[{"title":"植物大战僵尸","value":"1010324|1"},{"title":"星露谷物语","value":"1010791|1"},{"title":"流放之路2","value":"1011359|1"},{"title":"黑神话：悟空","value":"1010358|1"},{"title":"俄罗斯钓鱼4","value":"1011048|1"},{"title":"Half Sword","value":"1011393|1"},{"title":"方舟","value":"1010100|1"},{"title":"星际战甲","value":"1010250|1"},{"title":"饥荒","value":"1010335|1"},{"title":"艾尔登法环","value":"1010087|1"},{"title":"猛兽派对","value":"1010038|1"},{"title":"The Finals","value":"1010593|1"},{"title":"只狼：影逝二度","value":"1010149|1"},{"title":"幻兽帕鲁","value":"1010981|1"},{"title":"森林之子","value":"1010783|1"},{"title":"荒野大镖客2","value":"1010363|1"},{"title":"人渣","value":"1010326|1"},{"title":"街头霸王6","value":"1010361|1"},{"title":"极限竞速：地平线5","value":"1010429|1"},{"title":"骑马与砍杀2：霸主","value":"1010401|1"},{"title":"掘地求升","value":"1011136|1"},{"title":"英雄无敌3","value":"1011119|1"},{"title":"泰拉瑞亚","value":"1010396|1"},{"title":"全面战争：三国","value":"1010779|1"},{"title":"女神异闻录5","value":"1010171|1"},{"title":"宝可梦朱紫","value":"1010847|1"},{"title":"拳皇97","value":"1010334|1"},{"title":"仁王","value":"1010774|1"},{"title":"实况足球","value":"1010030|1"},{"title":"塞尔达传说：旷野之息","value":"1010081|1"},{"title":"三国志14","value":"1010514|1"},{"title":"战地1","value":"1010367|1"},{"title":"绝地潜兵2","value":"1011000|1"},{"title":"双影奇境","value":"1010436|1"},{"title":"空洞骑士：丝之歌","value":"1010360|1"},{"title":"怪物猎人：荒野","value":"1011304|1"},{"title":"都市：天际线","value":"1010142|1"},{"title":"链在一起","value":"1011170|1"},{"title":"古墓丽影：暗影","value":"1010424|1"},{"title":"匹诺曹的谎言","value":"1010320|1"},{"title":"赛博朋克2077","value":"1010128|1"},{"title":"超级兔子人","value":"1011238|1"},{"title":"流放之路","value":"1010411|1"},{"title":"天国拯救2","value":"1011399|1"},{"title":"潜水员戴夫","value":"1010626|1"},{"title":"木筏求生","value":"1010408|1"},{"title":"人类：一败涂地","value":"1010130|1"},{"title":"刺客信条：奥德赛","value":"1010485|1"},{"title":"致命公司","value":"1010846|1"},{"title":"极限竞速：地平线4","value":"1010353|1"},{"title":"塞尔达传说：王国之泪","value":"1010082|1"},{"title":"去上班","value":"1011366|1"},{"title":"三国志11","value":"1010515|1"}]}],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"单机游戏直播","subtitle":"添加后加载在线直播间","intent":"play"}]},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"1010324|1"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"1010324|1"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-4","title":"棋牌游戏","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:4","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[{"name":"category","title":"直播分类","type":"select","default":"1010040|1","options":[{"title":"指尖四川麻将","value":"1010040|1"},{"title":"JJ斗地主","value":"1010004|1"},{"title":"JJ象棋","value":"1010063|1"},{"title":"JJ麻将","value":"1010094|1"},{"title":"欢乐斗地主","value":"1010062|1"},{"title":"天天象棋","value":"1010060|1"},{"title":"途游斗地主","value":"1010012|1"},{"title":"微乐斗地主","value":"1010714|1"},{"title":"芒果斗地主","value":"1010028|1"},{"title":"开运麻将","value":"1010711|1"},{"title":"微乐四川麻将","value":"1010710|1"},{"title":"多乐升级","value":"1010721|1"},{"title":"腾讯欢乐麻将","value":"1010059|1"},{"title":"多乐够级","value":"1010720|1"},{"title":"禅游斗地主","value":"1010098|1"}]}],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"棋牌游戏直播","subtitle":"添加后加载在线直播间","intent":"play"}]},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"1010040|1"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"1010040|1"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-5","title":"休闲益智","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:5","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[{"name":"category","title":"直播分类","type":"select","default":"1010022|1","options":[{"title":"我的世界","value":"1010022|1"},{"title":"蛋仔派对","value":"1010011|1"},{"title":"鹅鸭杀（手游）","value":"1011640|1"},{"title":"天天台球","value":"1010806|1"},{"title":"元梦之星","value":"1010263|1"},{"title":"球球大作战","value":"1010010|1"},{"title":"开心消消乐","value":"1010520|1"},{"title":"群雄逐鹿","value":"1010895|1"},{"title":"忍者必须死3","value":"1010129|1"},{"title":"迷你世界","value":"1010046|1"},{"title":"贪吃蛇大作战","value":"1010056|1"},{"title":"台球帝国","value":"1010921|1"},{"title":"地铁跑酷","value":"1010099|1"},{"title":"天天酷跑","value":"1010410|1"}]}],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"休闲益智直播","subtitle":"添加后加载在线直播间","intent":"play"}]},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"1010022|1"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"1010022|1"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-6","title":"角色扮演","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:6","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[{"name":"category","title":"直播分类","type":"select","default":"1010053|1","options":[{"title":"梦幻西游","value":"1010053|1"},{"title":"梦幻西游手游","value":"1010051|1"},{"title":"原神","value":"1010039|1"},{"title":"魔兽世界","value":"1010150|1"},{"title":"明日方舟：终末地","value":"1010190|1"},{"title":"燕云十六声","value":"1010271|1"},{"title":"大话西游2","value":"1010205|1"},{"title":"地下城与勇士","value":"1010092|1"},{"title":"火影忍者手游","value":"1010042|1"},{"title":"火炬之光：无限","value":"1010241|1"},{"title":"鸣潮","value":"1010159|1"},{"title":"逆水寒手游","value":"1010083|1"},{"title":"地下城与勇士：起源","value":"1010234|1"},{"title":"光遇","value":"1010035|1"},{"title":"剑网3","value":"1010249|1"},{"title":"明日之后","value":"1010006|1"},{"title":"问道","value":"1010116|1"},{"title":"七日世界","value":"1010558|1"},{"title":"诛仙世界","value":"1010151|1"},{"title":"大话西游","value":"1010143|1"},{"title":"命运方舟","value":"1010233|1"},{"title":"绝区零","value":"1010155|1"},{"title":"逆水寒","value":"1010364|1"},{"title":"星际战甲","value":"1010250|1"},{"title":"洛克王国","value":"1010203|1"},{"title":"无限暖暖","value":"1010253|1"},{"title":"梦幻西游网页版","value":"1010049|1"},{"title":"只狼：影逝二度","value":"1010149|1"},{"title":"天涯明月刀","value":"1010119|1"},{"title":"新大话西游3","value":"1010568|1"},{"title":"航海王：壮志雄心","value":"1011139|1"},{"title":"妄想山海","value":"1010533|1"},{"title":"暗黑破坏神：不朽","value":"1010096|1"},{"title":"月圆之夜","value":"1010024|1"},{"title":"冒险岛：枫之传说","value":"1010311|1"},{"title":"诛仙2","value":"1010256|1"},{"title":"长安幻想","value":"1010097|1"},{"title":"航海王热血航线","value":"1010231|1"},{"title":"女神异闻录5","value":"1010171|1"},{"title":"境·界 刀鸣","value":"1010631|1"},{"title":"星球：重启","value":"1010193|1"},{"title":"晶核","value":"1010044|1"},{"title":"匹诺曹的谎言","value":"1010320|1"},{"title":"新完美世界","value":"1010257|1"},{"title":"流放之路","value":"1010411|1"},{"title":"激战2","value":"1010405|1"},{"title":"时空猎人3","value":"1010675|1"}]}],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"角色扮演直播","subtitle":"添加后加载在线直播间","intent":"play"}]},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"1010053|1"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"1010053|1"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-7","title":"策略卡牌","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:7","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[{"name":"category","title":"直播分类","type":"select","default":"1010013|1","options":[{"title":"明日方舟","value":"1010013|1"},{"title":"植物大战僵尸","value":"1010324|1"},{"title":"崩坏：星穹铁道","value":"1010043|1"},{"title":"少女前线2：追放","value":"1010160|1"},{"title":"阴阳师","value":"1010025|1"},{"title":"三国志·战略版","value":"1010009|1"},{"title":"率土之滨","value":"1010021|1"},{"title":"植物大战僵尸2","value":"1010067|1"},{"title":"斗罗大陆：魂师对决","value":"1010365|1"},{"title":"恋与深空","value":"1010084|1"},{"title":"部落冲突","value":"1010145|1"},{"title":"万国觉醒","value":"1010105|1"},{"title":"奥奇传说","value":"1010419|1"},{"title":"大话西游：归来","value":"1010287|1"},{"title":"三国志11","value":"1010515|1"},{"title":"重返未来1999","value":"1010196|1"}]}],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"策略卡牌直播","subtitle":"添加后加载在线直播间","intent":"play"}]},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"1010013|1"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"1010013|1"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-104","title":"二次元","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:104","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"二次元直播","subtitle":"添加后加载在线直播间","intent":"play"}]},"constants":{"category":"104|4"},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"104|4"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"104|4"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-105","title":"舞蹈","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:105","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"舞蹈直播","subtitle":"添加后加载在线直播间","intent":"play"}]},"constants":{"category":"105|4"},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"105|4"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"105|4"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-106","title":"文化","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:106","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"文化直播","subtitle":"添加后加载在线直播间","intent":"play"}]},"constants":{"category":"106|4"},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"106|4"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"106|4"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-107","title":"生活","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:107","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"生活直播","subtitle":"添加后加载在线直播间","intent":"play"}]},"constants":{"category":"107|4"},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"107|4"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"107|4"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{"type":"widget","id":"group-108","title":"运动","template":"poster-grid","headerIntent":"list","ref":{"source":"custom","id":"dygroup:108","mediaType":"movie"},"families":["medium","large"],"cache":{"ttlSeconds":120},"params":[],"placeholderData":{"items":[{"ref":{"source":"custom","id":"douyin:1","mediaType":"movie"},"title":"运动直播","subtitle":"添加后加载在线直播间","intent":"play"}]},"constants":{"category":"108|4"},resolveTitle:function(ctx,input){return dyCategoryTitle(dyKey(input,"108|4"));},load:async function(ctx,input){var items=await dyRooms(ctx,dyKey(input,"108|4"),dyPage(input));var content={items:items};if(items.length)content.next={type:"page",page:dyPage(input)+1};return content;}},
{type:"list",id:"rooms",title:"抖音直播列表",style:"backdrop-grid",accepts:{sources:["custom"]},cache:{ttlSeconds:60},search:{id:"room-lookup"},load:dyList},
{type:"search",id:"room-lookup",title:"抖音搜索（房间号/链接/关键词）",description:"输入主播昵称或直播标题关键词搜索直播间；也可输入房间号或直播分享链接直接打开。",cache:{ttlSeconds:0},params:[],search:dySearch},
{type:"detail",id:"room-detail",title:"抖音直播详情",accepts:{sources:["custom"]},cache:{ttlSeconds:15},load:dyDetail},
{type:"playback",id:"room-playback",title:"抖音HLS直播",accepts:{sources:["custom"]},cache:{ttlSeconds:0},sources:dyPlayback}
]});
