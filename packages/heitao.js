var HT_CODEC=(function(){
const B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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


return {utf8:utf8Decode,base64:base64ToBytes};
})();

/* 内置HTML解析：真机没有 ctx.html 时使用；只实现原稿用到的选择器子集。
 * 支持：tag / .class / #id / [attr] / [attr=v] / [attr*=v] / 后代(空格) / 逗号组。
 * 不支持：> + ~ :pseudo（原稿未使用）。 */
var HT_DOM=(function(){
var VOID={area:1,base:1,br:1,col:1,embed:1,hr:1,img:1,input:1,link:1,meta:1,param:1,source:1,track:1,wbr:1};
var ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’',hellip:'…',mdash:'—',ndash:'–',middot:'·',copy:'©',reg:'®',trade:'™',times:'×',divide:'÷'};
function dec(s){
 var t=String(s==null?'':s);
 if(t.indexOf('&')<0)return t;
 return t.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g,function(m,name){
  if(name.charAt(0)==='#'){
   var code=name.charAt(1)==='x'||name.charAt(1)==='X'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);
   if(!isFinite(code)||code<=0||code>0x10ffff)return m;
   try{return String.fromCodePoint(code);}catch(e){return m;}
  }
  var v=ENT[name.toLowerCase()];
  return v===undefined?m:v;
 });
}
function parseAttrs(s){
 var out={},re=/([^\s=\/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]*)))?/g,m;
 while((m=re.exec(s))){
  var k=m[1].toLowerCase();
  var v=m[3]!==undefined?m[3]:(m[4]!==undefined?m[4]:(m[5]!==undefined?m[5]:''));
  if(!(k in out))out[k]=dec(v);
 }
 return out;
}
function tagEnd(html,from){
 var q=0;
 for(var i=from;i<html.length;i++){
  var c=html.charAt(i);
  if(q){if(c===q)q=0;}
  else if(c==='"'||c==="'")q=c;
  else if(c==='>')return i;
 }
 return html.length;
}
function parse(html){
 var root={type:'root',name:'#root',attribs:{},children:[],parent:null};
 var stack=[root],i=0,n=html.length,lower=null;
 function lowerHtml(){if(lower===null)lower=html.toLowerCase();return lower;}
 function text(str){
  if(!str)return;
  var node={type:'text',data:dec(str),parent:stack[stack.length-1]};
  node.parent.children.push(node);
 }
 while(i<n){
  var lt=html.indexOf('<',i);
  if(lt<0){text(html.slice(i));break;}
  if(lt>i)text(html.slice(i,lt));
  if(html.substr(lt,4)==='<!--'){var ce=html.indexOf('-->',lt+4);i=ce<0?n:ce+3;continue;}
  if(html.charAt(lt+1)==='!'||html.charAt(lt+1)==='?'){var de=html.indexOf('>',lt);i=de<0?n:de+1;continue;}
  if(html.charAt(lt+1)==='/'){
   var ee=html.indexOf('>',lt),nm=html.slice(lt+2,ee<0?n:ee).trim().toLowerCase();
   for(var k=stack.length-1;k>0;k--)if(stack[k].name===nm){stack.length=k;break;}
   i=ee<0?n:ee+1;continue;
  }
  var gt=tagEnd(html,lt+1),raw=html.slice(lt+1,gt);
  var self=/\/\s*$/.test(raw);
  if(self)raw=raw.replace(/\/\s*$/,'');
  var mm=raw.match(/^([a-zA-Z][^\s\/>]*)/);
  if(!mm){i=gt+1;continue;}
  var name=mm[1].toLowerCase();
  var el={type:'tag',name:name,attribs:parseAttrs(raw.slice(mm[0].length)),children:[],parent:stack[stack.length-1]};
  el.parent.children.push(el);
  i=gt+1;
  if(name==='script'||name==='style'){
   var close=lowerHtml().indexOf('</'+name,i);
   if(close<0){el.children.push({type:'text',data:html.slice(i),parent:el});i=n;}
   else{el.children.push({type:'text',data:html.slice(i,close),parent:el});var g2=html.indexOf('>',close);i=g2<0?n:g2+1;}
   continue;
  }
  if(!self&&!VOID[name])stack.push(el);
 }
 return root;
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function serialize(node){
 if(node.type==='text')return esc(node.data);
 var out='';
 for(var i=0;i<node.children.length;i++){
  var c=node.children[i];
  if(c.type==='text'){out+=esc(c.data);continue;}
  out+='<'+c.name;
  for(var k in c.attribs)if(Object.prototype.hasOwnProperty.call(c.attribs,k))out+=' '+k+'="'+esc(c.attribs[k])+'"';
  out+='>'+(VOID[c.name]?'':serialize(c)+'</'+c.name+'>');
 }
 return out;
}
function textOf(node){
 if(node.type==='text')return node.data;
 var t='';
 for(var i=0;i<node.children.length;i++)t+=textOf(node.children[i]);
 return t;
}
/* ---- 选择器 ---- */
var compoundCache={};
function parseCompound(src){
 var c={tag:'',id:'',classes:[],attrs:[]};
 var re=/([#.]?)([A-Za-z0-9_\-]+)|\[\s*([^\]]*)\]/g,m;
 while((m=re.exec(src))){
  if(m[3]!==undefined){
   var body=m[3],eq=body.search(/[~^$*|]?=/);
   if(eq<0)c.attrs.push({name:body.trim().toLowerCase(),op:'',val:''});
   else{
    var name=body.slice(0,eq).trim().toLowerCase(),rest=body.slice(eq);
    var opm=rest.match(/^[~^$*|]?=/);var op=opm?opm[0]:'=';
    var val=rest.slice(op.length).trim().replace(/^["']|["']$/g,'');
    c.attrs.push({name:name,op:op,val:dec(val)});
   }
   continue;
  }
  var pre=m[1]||'',nm=m[2];
  if(pre==='.')c.classes.push(nm);
  else if(pre==='#')c.id=nm;
  else c.tag=nm.toLowerCase();
 }
 return c;
}
function parseSelector(sel){
 var key=String(sel);
 if(compoundCache[key])return compoundCache[key];
 var groups=key.split(',').map(function(g){
  var parts=g.trim().split(/\s+/).filter(Boolean).map(parseCompound);
  return parts.length?parts:null;
 }).filter(Boolean);
 compoundCache[key]=groups;return groups;
}
function matchCompound(el,cp){
 if(el.type!=='tag')return false;
 if(cp.tag&&cp.tag!=='*'&&el.name!==cp.tag)return false;
 if(cp.id&&el.attribs.id!==cp.id)return false;
 if(cp.classes.length){
  var cl=' '+(el.attribs['class']||'')+' ';
  for(var i=0;i<cp.classes.length;i++)if(cl.indexOf(' '+cp.classes[i]+' ')<0)return false;
 }
 for(i=0;i<cp.attrs.length;i++){
  var a=cp.attrs[i],v=el.attribs[a.name];
  if(v===undefined)return false;
  if(!a.op)continue;
  if(a.op==='='&&v!==a.val)return false;
  if(a.op==='*='&&v.indexOf(a.val)<0)return false;
  if(a.op==='^='&&v.indexOf(a.val)!==0)return false;
  if(a.op==='$='&&(v.length<a.val.length||v.slice(v.length-a.val.length)!==a.val))return false;
  if(a.op==='~='&&(' '+v+' ').indexOf(' '+a.val+' ')<0)return false;
  if(a.op==='|='&&v!==a.val&&v.indexOf(a.val+'-')!==0)return false;
 }
 return true;
}
function matchChain(el,parts){
 var idx=parts.length-1;
 if(!matchCompound(el,parts[idx]))return false;
 idx--;
 var cur=el;
 while(idx>=0){
  var found=false,p=cur.parent;
  while(p&&p.type==='tag'){
   if(matchCompound(p,parts[idx])){found=true;cur=p;break;}
   p=p.parent;
  }
  if(!found)return false;
  idx--;
 }
 return true;
}
function matchesGroups(el,groups){
 for(var i=0;i<groups.length;i++)if(matchChain(el,groups[i]))return true;
 return false;
}
function matches(el,sel){return matchesGroups(el,parseSelector(sel));}
function descendants(node,out){
 for(var i=0;i<node.children.length;i++){
  var c=node.children[i];
  if(c.type==='tag'){out.push(c);descendants(c,out);}
 }
 return out;
}
/* ---- 集合 ---- */
function Collection(nodes){
 var self=this;
 this.nodes=nodes||[];
 this.length=this.nodes.length;
 for(var i=0;i<this.nodes.length;i++)this[i]=this.nodes[i];
 return self;
}
var P=Collection.prototype;
P.each=function(fn){for(var i=0;i<this.nodes.length;i++){if(fn.call(this.nodes[i],i,this.nodes[i])===false)break;}return this;};
P.map=function(fn){var out=[];for(var i=0;i<this.nodes.length;i++){var v=fn.call(this.nodes[i],i,this.nodes[i]);if(v!=null)out.push(v);}return new Collection(out);};
P.get=function(i){if(i===undefined)return this.nodes.slice();return this.nodes[i<0?this.nodes.length+i:i];};
P.first=function(){return new Collection(this.nodes.slice(0,1));};
P.last=function(){return new Collection(this.nodes.slice(-1));};
P.eq=function(i){return new Collection(this.nodes.slice(i,i+1));};
P.find=function(sel){
 var out=[],seen=typeof Set==='function'?new Set():null,groups=parseSelector(sel);
 for(var i=0;i<this.nodes.length;i++){
  var d=descendants(this.nodes[i],[]);
  for(var j=0;j<d.length;j++){
   var n=d[j];
   if(!matchesGroups(n,groups))continue;
   if(seen){if(seen.has(n))continue;seen.add(n);}else if(out.indexOf(n)>=0)continue;
   out.push(n);
  }
 }
 return new Collection(out);
};
P.filter=function(fnOrSel){
 var out=[],selGroups=typeof fnOrSel==='function'?null:parseSelector(fnOrSel);
 for(var i=0;i<this.nodes.length;i++){
  var n=this.nodes[i];
  var keep=typeof fnOrSel==='function'?fnOrSel.call(n,i,n):(n.type==='tag'&&matchesGroups(n,selGroups));
  if(keep)out.push(n);
 }
 return new Collection(out);
};
P.is=function(sel){
 var groups=parseSelector(sel);
 for(var i=0;i<this.nodes.length;i++){var n=this.nodes[i];if(n.type==='tag'&&matchesGroups(n,groups))return true;}
 return false;
};
P.closest=function(sel){
 for(var i=0;i<this.nodes.length;i++){
  var p=this.nodes[i];
  var g=parseSelector(sel);
  while(p&&p.type==='tag'){if(matchesGroups(p,g))return new Collection([p]);p=p.parent;}
 }
 return new Collection([]);
};
P.parent=function(){
 var out=[];
 for(var i=0;i<this.nodes.length;i++){var p=this.nodes[i].parent;if(p&&p.type==='tag'&&out.indexOf(p)<0)out.push(p);}
 return new Collection(out);
};
P.children=function(sel){
 var out=[],g=sel?parseSelector(sel):null;
 for(var i=0;i<this.nodes.length;i++){
  var ch=this.nodes[i].children||[];
  for(var j=0;j<ch.length;j++){
   var c=ch[j];
   if(c.type!=='tag')continue;
   if(g&&!matchesGroups(c,g))continue;
   out.push(c);
  }
 }
 return new Collection(out);
};
P.contents=function(){
 var out=[];
 for(var i=0;i<this.nodes.length;i++)out=out.concat(this.nodes[i].children||[]);
 return new Collection(out);
};
P.attr=function(name,value){
 if(value===undefined){
  var n=this.nodes[0];
  if(!n||!n.attribs)return undefined;
  var v=n.attribs[String(name).toLowerCase()];
  return v===undefined?undefined:v;
 }
 for(var i=0;i<this.nodes.length;i++){if(this.nodes[i].attribs)this.nodes[i].attribs[String(name).toLowerCase()]=String(value);}
 return this;
};
P.text=function(){var t='';for(var i=0;i<this.nodes.length;i++)t+=textOf(this.nodes[i]);return t;};
P.html=function(){return this.nodes.length?serialize(this.nodes[0]):'';};
P.remove=function(){
 for(var i=0;i<this.nodes.length;i++){
  var n=this.nodes[i],p=n.parent;
  if(p&&p.children){var k=p.children.indexOf(n);if(k>=0)p.children.splice(k,1);}
 }
 return this;
};
function load(html){
 var root=parse(String(html==null?'':html));
 var allNodes=null;
 function every(){if(!allNodes)allNodes=descendants(root,[]);return allNodes;}
 function $(sel,ctxNodes){
  if(sel&&typeof sel==='object')return new Collection(sel.nodes?sel.nodes.slice():[sel]);
  if(typeof sel==='string'&&/^\s*</.test(sel)){
   var frag=parse(sel);
   return new Collection(frag.children.filter(function(c){return c.type==='tag';}));
  }
  if(ctxNodes)return ctxNodes.find(sel);
  return new Collection(every().filter(function(n){return matches(n,sel);}));
 }
 $.root=function(){return new Collection([root]);};
 $.html=function(){return serialize(root);};
 return $;
}
return {load:load,parse:parse,text:function(n){return textOf(n);}};
})();

/* 黑桃 HTTP 桥：复用 MissAV 的 Promise/限跳转/凭据隔离控制流；仅适配本站域名与query/文本。 */
var HT_VERSION='1.0.0',HT_SITE='https://heitaodj.com';
function htFail(code,message,retryable){throw ExtensionError({code:code,message:message,retryable:!!retryable});}
var htUrlMemo=Object.create(null),htUrlMemoN=0;
function htUrl(v){
 var raw=String(v||'').trim();
 var hit=htUrlMemo[raw];if(hit!==undefined)return hit;
 var r=htUrlParse(raw);
 if(htUrlMemoN>=512){htUrlMemo=Object.create(null);htUrlMemoN=0;}
 htUrlMemo[raw]=r;htUrlMemoN++;
 return r;
}
function htUrlParse(s){var m=s.match(/^https:\/\/([a-z0-9.-]+)(?::443)?(?=[\/?#]|$)/i);if(!m||/[\x00-\x20\x7f]/.test(s)||m[1].indexOf('..')>=0)return null;return {url:s,host:m[1].toLowerCase(),origin:'https://'+m[1].toLowerCase()};}
function htResolve(v,base){
 var s=String(v||'').trim(),b=htUrl(base);if(!b)return '';
 if(/^https:\/\//i.test(s))return htUrl(s)?s:'';
 if(s.indexOf('//')===0)return htUrl('https:'+s)?'https:'+s:'';
 if(s.charAt(0)==='/')return b.origin+s;
 if(s.charAt(0)==='?')return String(base).split(/[?#]/)[0]+s;
 if(s.charAt(0)==='#')return String(base).split('#')[0]+s;
 if(!s||/^[a-z][a-z0-9+.-]*:/i.test(s))return '';
 var p=String(base).slice(b.origin.length).split(/[?#]/)[0].replace(/[^/]*$/,'')+s;
 var q='',i=p.search(/[?#]/);if(i>=0){q=p.slice(i);p=p.slice(0,i);}
 var a=p.split('/'),out=[];for(i=0;i<a.length;i++){if(a[i]==='..')out.pop();else if(a[i]!=='.'&&a[i]!=='')out.push(a[i]);}
 return b.origin+'/'+out.join('/')+q;
}
function htAllowed(p,site){return p&&(p.host===site.host||p.host==='play.djqiepian.app');}
function htText(v){
 if(typeof v==='string')return v;
 if(v==null)return '';
 var tag=Object.prototype.toString.call(v),b=null;
 if(tag==='[object ArrayBuffer]')b=new Uint8Array(v);
 else if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(v))b=new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
 else if(Array.isArray(v)&&v.every(function(x){return Number.isInteger(x)&&x>=0&&x<=255;}))b=v;
 if(!b)htFail('unavailable','网络返回的页面类型无法识别。',false);
 return HT_CODEC.utf8(b);
}
function htContext(ctx){
 var settings=Object.assign({},ctx&&ctx.settings||{}),base=htUrl(settings.site||HT_SITE);
 if(!base||!['heitaodj.com','www.heitaodj.com'].includes(base.host)||(base.url!==base.origin&&base.url!==base.origin+'/'))htFail('invalid_params','站点地址仅支持本站 HTTPS 主机。',false);
 if(!ctx||!ctx.http||typeof ctx.http.get!=='function')htFail('unavailable','Conflux 未提供 HTTP 访问能力。',false);
 settings.site=base.origin;settings.cookie=String(settings.cookie||'').replace(/^cookie\s*:\s*/i,'').trim();
 function get(u,o,hops){
  return Promise.resolve().then(function(){
   var p=htUrl(u);if(!htAllowed(p,base)||hops>4)htFail('unavailable','页面跳转到了未授权站点，已停止请求。',false);
   var h={};Object.keys(o.headers||{}).forEach(function(k){var n=k.toLowerCase();if(n==='authorization'||n==='cookie'&&p.origin!==base.origin)return;h[k]=o.headers[k];});
   return ctx.http.get(u,{headers:h,timeoutMs:Math.min(Math.max(Number(o.timeoutMs)||15000,5000),20000),followRedirects:false,cacheTtlSeconds:0});
  }).then(function(r){
   if(!r||typeof r.status!=='number')htFail('unavailable','未收到有效的 HTTP 响应。',true);
   var location='',headers={};Object.keys(r.headers||{}).forEach(function(k){headers[k]=r.headers[k];if(k.toLowerCase()==='location')location=String(r.headers[k]);});
   if(r.status>=300&&r.status<400&&location)return get(htResolve(location,u),o,hops+1);
   var text=htText(r.data);if(text.length>2000000)htFail('unavailable','页面响应过大，已停止解析。',false);
   if(/__cf_chl_opt|_cf_chl_opt|cf-browser-verification|Just a moment|Attention Required|Sorry, you have been blocked/i.test(text))htFail('unavailable','站点要求访问验证，当前请求未通过。',false);
   return {status:r.status,headers:headers,url:u,data:text};
  },function(e){if(e&&e.code)throw e;htFail('unavailable','网络请求失败，请稍后重试。',true);});
 }
var htmlLoad=(function(){
 if(ctx.html&&typeof ctx.html.load==='function')return function(s){return ctx.html.load(s);};
 /* 同一次加载里原稿会解析同一份 HTML 两次（导航缓存 + 卡片），按引用复用，省一半解析开销。 */
 var lastSrc=null,lastDom=null,lastLen=-1;
 return function(s){
  var str=String(s==null?'':s);
  if(lastDom&&str===lastSrc)return lastDom;
  /* 只用引用相等的短字符串做键，避免长串比较；超长文档每次都解析。 */
  if(lastSrc!==null&&str.length===lastLen&&str===lastSrc)return lastDom;
  lastDom=HT_DOM.load(str);lastSrc=str;lastLen=str.length;return lastDom;
 };
})();
 return {settings:settings,html:{load:htmlLoad},url:{resolve:htResolve,origin:function(u){var p=htUrl(u);return p?p.origin:'';}},crypto:{base64Decode:function(s){return HT_CODEC.utf8(HT_CODEC.base64(s));}},
  signal:{throwIfAborted:function(){if(ctx.signal&&typeof ctx.signal.throwIfAborted==='function')ctx.signal.throwIfAborted();}},
  http:{get:function(u,o){o=o||{};var q=o.query;if(q&&Object.keys(q).length){u+=u.indexOf('?')>=0?'&':'?';u+=Object.keys(q).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(String(q[k]));}).join('&');}return get(u,o,0);}},
  fail:function(code,msg){var map={CONFIG_REQUIRED:'invalid_params',INVALID_RESPONSE:'unavailable',NETWORK:'unavailable',AUTH_REQUIRED:'unavailable',NOT_FOUND:'not_found',RATE_LIMITED:'rate_limited',CANCELLED:'unavailable',TIMEOUT:'unavailable'};htFail(map[code]||'internal',msg||'来源请求失败。',code==='NETWORK'||code==='TIMEOUT'||code==='RATE_LIMITED');}
 };
}

function createHeitaoOriginal(){
var p;var WeBox={define:function(x){p=x;}};
const DEFAULT_SITE = "https://heitaodj.com";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let listSnapshot = null;
let navDiscoveryCache = { origin: "", map: null, searchAction: "", searchParam: "" };

WeBox.define({
  api: "1.1",
  id: "com.heitaodj.webox",
  name: "黑桃短剧",
  version: "1.0.2",
  requires: ["html", "crypto"],
  cache: { list: 180, detail: 60, filters: 3600 },

  settings: {
    fields: [
      {
        key: "site",
        label: "站点地址",
        type: "url",
        required: false,
        default: DEFAULT_SITE,
        placeholder: "https://heitaodj.com"
      },
      {
        key: "cookie",
        label: "访问 Cookie（可选）",
        type: "secret",
        maxLength: 8192,
        help: "站点年龄提示由脚本自动处理。仅遇到其他访问验证时，才需填写有效 Cookie。",
        placeholder: "填入浏览器访问站点后的 Cookie（如有验证拦截时使用）"
      },
      {
        key: "timeout",
        label: "请求超时秒数",
        type: "number",
        default: 15,
        min: 5,
        max: 30,
        step: 1
      }
    ]
  },

  async filters(ctx, req) {
    return [
      {
        key: "category",
        label: "短剧栏目",
        type: "select",
        default: "all",
        options: [
          { label: "首页推荐", value: "all" },
          { label: "现代都市", value: "现代都市" },
          { label: "古装传奇", value: "古装传奇" },
          { label: "仙侠玄幻", value: "仙侠玄幻" },
          { label: "科幻脑洞", value: "科幻脑洞" },
          { label: "灵异悬疑", value: "灵异悬疑" },
          { label: "其他短剧", value: "其他短剧" }
        ]
      },
      {
        key: "tag",
        label: "题材细分",
        type: "select",
        default: "",
        searchable: true,
        options: [
          { label: "全部题材", value: "" },
          { label: "家庭纠葛", value: "家庭纠葛" },
          { label: "职场权色", value: "职场权色" },
          { label: "逆袭打脸", value: "逆袭打脸" },
          { label: "系统逆袭", value: "系统逆袭" },
          { label: "异能超能", value: "异能超能" },
          { label: "群芳后宫", value: "群芳后宫" },
          { label: "后宫争宠", value: "后宫争宠" },
          { label: "鬼艳志怪", value: "鬼艳志怪" },
          { label: "都市怪谈", value: "都市怪谈" },
          { label: "身体奇谭", value: "身体奇谭" },
          { label: "综合脑洞", value: "综合脑洞" },
          { label: "都市其他", value: "都市其他" },
          { label: "古装其他", value: "古装其他" },
          { label: "仙侠其他", value: "仙侠其他" },
          { label: "科幻其他", value: "科幻其他" }
        ]
      }
    ];
  },

  async list(ctx, req) {
    ctx.signal.throwIfAborted();
    const filters = req.filters || {};
    const category = String(filters.category || "all").trim();
    const tagFilter = String(filters.tag || "").trim();
    const baseSite = resolveBaseSite(ctx);
    const cursor = parsePageCursor(ctx, req.cursor, baseSite);
    const page = cursor.page;

    const ttlMs = 0;
    const cacheKey = JSON.stringify([settingsKey(ctx), category, tagFilter, req.cursor]);

    if (
      !req.refresh &&
      ttlMs > 0 &&
      listSnapshot &&
      listSnapshot.key === cacheKey &&
      listSnapshot.generation === 0 &&
      Date.now() - listSnapshot.savedAt < ttlMs
    ) {
      return listSnapshot.value;
    }

    const generation = 0;
    const candidates = await buildCategoryCandidates(
      ctx,
      baseSite,
      category,
      page,
      req.refresh
    );

    let parsed = { items: [], nextCursor: null };

    for (const c of candidates) {
      ctx.signal.throwIfAborted();
      const res = await fetchPage(ctx, cursor.url || c.url, cursor.url ? null : c.query);
      updateNavCacheFromHtml(ctx, res.data, baseSite);
      parsed = parseHeitaoCards(ctx, res.data, baseSite, "", tagFilter, res.url, page);
      break;
    }

    ctx.signal.throwIfAborted();
    const result = { items: parsed.items, nextCursor: category === "all" ? null : parsed.nextCursor };

    if (ttlMs > 0 && generation === 0) {
      listSnapshot = {
        key: cacheKey,
        generation,
        savedAt: Date.now(),
        value: result
      };
    }
    return result;
  },

  async search(ctx, req) {
    ctx.signal.throwIfAborted();
    const keyword = String(req.query || "").trim();
    if (!keyword) return { items: [], nextCursor: null };
    if (keyword.length > 200) {
      ctx.fail("CONFIG_REQUIRED", "搜索词长度不能超过 200 个字符");
    }

    const tagFilter = String(req.filters?.tag || "").trim();
    const baseSite = resolveBaseSite(ctx);
    const cursor = parsePageCursor(ctx, req.cursor, baseSite);
    const page = cursor.page;

    const candidates = await buildSearchCandidates(
      ctx,
      baseSite,
      keyword,
      page,
      req.refresh
    );

    for (const c of candidates) {
      ctx.signal.throwIfAborted();
      const res = await fetchPage(ctx, cursor.url || c.url, cursor.url ? null : c.query);
      const parsed = parseHeitaoCards(ctx, res.data, baseSite, "", tagFilter, res.url, page);
      ctx.signal.throwIfAborted();
      return { items: parsed.items, nextCursor: parsed.nextCursor };
    }
    return { items: [], nextCursor: null };
  },

  async detail(ctx, req) {
    const contentId = validateContentId(ctx, req.id);
    const baseSite = resolveBaseSite(ctx);
    const detailUrl = ctx.url.resolve(contentId, baseSite);

    const res = await fetchPage(ctx, detailUrl);
    ctx.signal.throwIfAborted();

    const html = res.data;
    const $ = ctx.html.load(html);

    const title = extractDetailTitle($);
    const poster = extractDetailPoster(ctx, $, baseSite);
    const summary = extractDetailSummary($);
    const groups = extractDetailGroups(ctx, $, html, contentId, baseSite, title);

    const hasMultiEpisodes = groups.some(
      g => Array.isArray(g.episodes) && g.episodes.length > 1
    );
    const kind = hasMultiEpisodes ? "series" : "movie";

    const result = {
      id: req.id,
      kind,
      groups
    };
    if (title) result.title = title.slice(0, 240);
    if (poster) result.poster = poster;
    if (summary) result.summary = summary.slice(0, 65536);

    return result;
  },

  async play(ctx, req) {
    ctx.signal.throwIfAborted();
    validateContentId(ctx, req.contentId);
    const groupId = String(req.groupId || "").trim();
    const episodeId = String(req.episodeId || "").trim();
    if (groupId !== "main" || !episodeId || episodeId.length > 1024) {
      ctx.fail("NOT_FOUND", "选集参数无效，请重新打开详情");
    }

    const baseSite = resolveBaseSite(ctx);
    const detailUrl = ctx.url.resolve(req.contentId, baseSite);

    // 1. 若 episodeId 本身即为直链媒体地址
    if (looksLikeDirectStream(episodeId)) {
      const mediaUrl = normalizeMediaUrl(ctx, episodeId, detailUrl);
      if (!mediaUrl) ctx.fail("NOT_FOUND", "视频地址无效，请重新打开详情");
      return {
        sources: [buildMediaSource("direct-1", "默认线路", mediaUrl, detailUrl)]
      };
    }

    // 2. 请求播放页并解析流媒体地址
    const playUrl = ctx.url.resolve(episodeId, baseSite);
    const res = await fetchPage(ctx, playUrl, null, { Referer: detailUrl });
    ctx.signal.throwIfAborted();

    const sources = await extractPlaySources(
      ctx,
      res.data,
      res.url || playUrl,
      groupId
    );

    if (sources.length === 0) {
      ctx.fail("NOT_FOUND", "未能从当前播放页解析出有效视频流地址");
    }

    return { sources };
  }
});

/* ======================== 站点配置与网络工具 ======================== */

function resolveBaseSite(ctx) {
  const raw = String(ctx.settings?.site || DEFAULT_SITE).trim();
  if (!raw) return DEFAULT_SITE;
  if (!/^https?:\/\//i.test(raw)) {
    ctx.fail("CONFIG_REQUIRED", "请填写以 http:// 或 https:// 开头的站点地址", {
      fields: ["site"]
    });
  }
  return raw.replace(/\/+$/, "");
}

function getTimeoutMs(ctx) {
  const sec = Number(ctx.settings?.timeout || 15);
  const clamped = Number.isFinite(sec) ? Math.min(Math.max(sec, 5), 30) : 15;
  return clamped * 1000;
}

function settingsKey(ctx) {
  return JSON.stringify(ctx.settings || {});
}

function buildSiteCookie(ctx) {
  const parts = String(ctx.settings?.cookie || "")
    .replace(/[\r\n]+/g, "; ")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean);
  // 本站通过此 Cookie 保存自声明状态；这并非真实年龄验证。
  // 已有同名 Cookie（包括显式的未确认状态）不覆盖、不重复添加。
  if (!parts.some(part => /^heitao_age_confirmed\s*=/.test(part))) {
    parts.push("heitao_age_confirmed=1");
  }
  return parts.join("; ");
}

async function fetchPage(ctx, url, query, extraHeaders) {
  ctx.signal.throwIfAborted();
  const baseSite = resolveBaseSite(ctx);
  const baseOrigin = ctx.url.origin(baseSite);
  const targetOrigin = ctx.url.origin(url);

  const headers = Object.assign(
    {
      "User-Agent": DEFAULT_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: baseOrigin + "/"
    },
    extraHeaders || {}
  );

  // 年龄提示 Cookie 和用户配置 Cookie 都只发送给本站，不广播给外站。
  if (targetOrigin === baseOrigin) {
    headers["Cookie"] = buildSiteCookie(ctx);
  }

  const options = {
    headers,
    responseType: "text",
    timeoutMs: getTimeoutMs(ctx)
  };
  if (query && Object.keys(query).length > 0) {
    options.query = query;
  }

  let response;
  try {
    response = await ctx.http.get(url, options);
  } catch (err) {
    ctx.signal.throwIfAborted();
    if (["AUTH_REQUIRED", "NETWORK", "RATE_LIMITED", "NOT_FOUND", "INVALID_RESPONSE", "CANCELLED", "TIMEOUT"].includes(err.code) ||
        String(err.message || "").includes("WBX_ERROR:")) throw err;
    ctx.fail("NETWORK", "网络请求未完成，请检查网络连接或站点地址");
  }

  const text = String(response.data || "");
  if (/Just a moment\.\.\.|cf-browser-verification|_cf_chl_opt/i.test(text)) {
    ctx.fail("AUTH_REQUIRED", "触发站点防火墙验证，请在源设置中填入浏览器 Cookie", {
      fields: ["cookie"]
    });
  }
  if (/id=["']heitao-age-gate["']/i.test(text) && /data-reload-on-confirm=["']1["']/i.test(text)) {
    ctx.fail("AUTH_REQUIRED", "站点未接受年龄确认 Cookie，请检查访问 Cookie 或稍后重试", {
      fields: ["cookie"]
    });
  }

  if (response.status === 429) {
    ctx.fail("RATE_LIMITED", "请求过于频繁，请稍后重试", {
      retryAfterSeconds: 15
    });
  }
  if (response.status === 404) {
    ctx.fail("NOT_FOUND", "请求的页面不存在");
  }
  if (response.status === 403 || response.status === 503) {
    ctx.fail("NETWORK", `站点拒绝访问 (HTTP ${response.status})`);
  }
  if (response.status < 200 || response.status >= 300) {
    ctx.fail("NETWORK", `站点请求失败 (HTTP ${response.status})`);
  }

  if (!text.trim()) {
    ctx.fail("INVALID_RESPONSE", "站点返回空白内容");
  }
  return {
    status: response.status,
    headers: response.headers || {},
    url: response.url || url,
    data: text
  };
}

function parsePageCursor(ctx, cursor, baseSite) {
  if (cursor === null) return { page: 1, url: "" };
  if (typeof cursor !== "string" || cursor.length > 2048) {
    ctx.fail("INVALID_RESPONSE", "分页游标无效");
  }
  let page, url = "";
  if (/^[1-9][0-9]*$/.test(cursor)) {
    page = Number(cursor);
  } else {
    let data;
    try { data = JSON.parse(cursor); } catch (_) {}
    if (!Array.isArray(data) || data.length !== 2 || typeof data[1] !== "string") {
      ctx.fail("INVALID_RESPONSE", "分页游标无效");
    }
    page = data[0];
    url = normalizeHttpUrl(ctx, data[1], baseSite);
    if (!url || ctx.url.origin(url) !== ctx.url.origin(baseSite)) {
      ctx.fail("INVALID_RESPONSE", "分页链接无效");
    }
    if (getUrlPageNumber(url) !== page) ctx.fail("INVALID_RESPONSE", "分页链接与页码不匹配");
  }
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    ctx.fail("INVALID_RESPONSE", "分页游标超出范围");
  }
  return { page, url };
}

function validateContentId(ctx, id) {
  const clean = String(id || "").trim();
  if (!clean || clean.length > 1024) {
    ctx.fail("NOT_FOUND", "内容标识无效");
  }
  return clean;
}

/* ======================== 导航路径自动发现与列表构建 ======================== */

function updateNavCacheFromHtml(ctx, html, baseSite) {
  const origin = ctx.url.origin(baseSite);
  const $ = ctx.html.load(html);
  const map = new Map();

  const knownCategories = [
    "现代都市",
    "古装传奇",
    "仙侠玄幻",
    "科幻脑洞",
    "灵异悬疑",
    "其他短剧"
  ];

  $("a[href]").each((_, el) => {
    const a = $(el);
    const text = cleanSingleLine(a.text());
    const rawHref = String(a.attr("href") || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) {
      return;
    }

    for (const catName of knownCategories) {
      if (text === catName && !map.has(catName)) {
        const path = normalizeContentPath(ctx, rawHref, baseSite);
        if (path && path !== "/") {
          map.set(catName, path);
        }
      }
    }
  });

  // 探测搜索表单 action 与输入框参数名
  let searchAction = "";
  let searchParam = "";
  const searchForm = $("form")
    .filter(
      (_, el) =>
        $(el).find("input[type='search'], input[placeholder*='搜索'], input[name]")
          .length > 0
    )
    .first();

  if (searchForm.length) {
    const rawAction = String(searchForm.attr("action") || "").trim();
    if (rawAction && !rawAction.startsWith("javascript:")) {
      searchAction = normalizeContentPath(ctx, rawAction, baseSite);
    }
    const inputNode = searchForm
      .find("input[type='search'], input[type='text'], input[name]")
      .first();
    const inputName = String(inputNode.attr("name") || "").trim();
    if (inputName) {
      searchParam = inputName;
    }
  }

  navDiscoveryCache = {
    origin,
    map,
    searchAction,
    searchParam,
    settingsKey: settingsKey(ctx),
    generation: 0
  };
}

async function ensureNavDiscovered(ctx, baseSite, forceRefresh) {
  const origin = ctx.url.origin(baseSite);
  if (
    !forceRefresh &&
    navDiscoveryCache.origin === origin &&
    navDiscoveryCache.settingsKey === settingsKey(ctx) &&
    navDiscoveryCache.generation === 0 &&
    navDiscoveryCache.map &&
    navDiscoveryCache.map.size > 0
  ) {
    return navDiscoveryCache;
  }
  const homeRes = await fetchPage(ctx, baseSite + "/");
  updateNavCacheFromHtml(ctx, homeRes.data, baseSite);
  return navDiscoveryCache;
}

async function buildCategoryCandidates(ctx, baseSite, category, page, refresh) {
  const candidates = [];
  const add = (path, query = {}, sectionHint = "") => {
    candidates.push({
      url: ctx.url.resolve(path, baseSite),
      query,
      sectionHint
    });
  };

  if (category === "all") {
    if (page === 1) {
      add("/", {});
    }
    return candidates;
  }

  // 只使用真实导航，未发现时使用本站已确认的路由，不轮询猜测地址。
  const navInfo = await ensureNavDiscovered(ctx, baseSite, refresh);
  const indexMap = {
    现代都市: 1,
    古装传奇: 2,
    仙侠玄幻: 3,
    科幻脑洞: 4,
    灵异悬疑: 5,
    其他短剧: 6
  };
  if (!indexMap[category]) ctx.fail("INVALID_RESPONSE", "栏目无效，请重新选择");
  const discoveredPath = navInfo.map?.get(category) || `/index.php/vod/type/id/${indexMap[category]}.html`;
  const categoryUrl = normalizeHttpUrl(ctx, discoveredPath, baseSite);
  if (!categoryUrl || ctx.url.origin(categoryUrl) !== ctx.url.origin(baseSite)) {
    ctx.fail("INVALID_RESPONSE", "栏目链接无效");
  }
  if (page === 1) {
    add(discoveredPath);
  } else if (/\/vod\/type\/id\/\d+\.html$/i.test(discoveredPath)) {
    add(discoveredPath.replace(/\.html$/i, `/page/${page}.html`));
  } else {
    add(discoveredPath, { page: String(page) });
  }

  return candidates;
}

async function buildSearchCandidates(ctx, baseSite, keyword, page, refresh) {
  const navInfo = await ensureNavDiscovered(ctx, baseSite, refresh);
  const candidates = [];

  const add = (path, query = {}) => {
    candidates.push({
      url: ctx.url.resolve(path, baseSite),
      query
    });
  };

  const action = navInfo.searchAction || "/index.php/vod/search.html";
  const searchUrl = normalizeHttpUrl(ctx, action, baseSite);
  if (!searchUrl || ctx.url.origin(searchUrl) !== ctx.url.origin(baseSite)) {
    ctx.fail("INVALID_RESPONSE", "搜索链接无效");
  }
  const query = { [navInfo.searchParam || "wd"]: keyword };
  if (page > 1) query.page = String(page);
  add(action, query);

  return candidates;
}

/* ======================== 卡片解析与过滤 ======================== */

function parseHeitaoCards(ctx, html, baseSite, sectionHint, tagFilter, pageUrl, page) {
  const $ = ctx.html.load(html);
  const entriesById = new Map();

  // 如果指定了 sectionHint（例如在首页按“现代都市”标题区域提取），先尝试定位对应板块容器
  let searchRoot = $("main").first();
  if (!searchRoot.length) searchRoot = $("body");
  if (!searchRoot.find(".m-list, .module-items, .no_data, .no-results").length &&
      !searchRoot.is(".m-list") && !searchRoot.find("a[href] img").length) {
    ctx.fail("INVALID_RESPONSE", "未识别到站点列表，请检查站点地址或稍后重试");
  }
  if (sectionHint) {
    $("h1, h2, h3, h4, .title, .module-title, .section-title").each((_, el) => {
      const headingText = cleanSingleLine($(el).text());
      if (headingText.includes(sectionHint)) {
        const sectionBox = $(el).closest("section, .module, .block, .container, div");
        if (sectionBox.length && sectionBox.find("a[href]").length >= 2) {
          searchRoot = sectionBox;
          return false;
        }
      }
    });
  }

  searchRoot.find("a[href]").each((_, el) => {
    const a = $(el);
    if (a.closest("header, nav, footer, .pagination, .page-links").length > 0) {
      return;
    }

    const rawHref = String(a.attr("href") || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) {
      return;
    }

    const normId = normalizeContentPath(ctx, rawHref, baseSite);
    if (!isHeitaoDramaPath(normId, a, $)) return;

    let entry = entriesById.get(normId);
    if (!entry) {
      entry = { id: normId, links: [], containers: [] };
      entriesById.set(normId, entry);
    }
    entry.links.push(a);

    const card = findSingleDramaCardContainer($, a, normId, ctx, baseSite);
    if (card && card.length) {
      entry.containers.push(card);
    }
  });

  const items = [];
  for (const entry of entriesById.values()) {
    const item = buildHeitaoCardItem(ctx, $, entry, baseSite);
    if (!item) continue;

    if (
      tagFilter &&
      (!item.subtitle || !item.subtitle.includes(tagFilter)) &&
      !item.title.includes(tagFilter)
    ) {
      continue;
    }
    items.push(item);
  }

  const nextCursor = sectionHint ? null : extractNextCursor(ctx, $, pageUrl || baseSite, page || 1);
  return { items, nextCursor };
}

function getUrlPageNumber(url) {
  const match = url.match(/\/page\/([1-9]\d*)(?:[/.?#]|$)/i) ||
    url.match(/[?&](?:page|paged)=([1-9]\d*)(?:[&#]|$)/i);
  return match ? Number(match[1]) : null;
}

function extractNextCursor(ctx, $, pageUrl, page) {
  let result = null;
  $("a.next[href], a[rel='next'][href], a:contains('下一页'), a:contains('下页'), link[rel='next'][href]").each((_, el) => {
    const node = $(el);
    if (node.is(".disabled, [aria-disabled='true']") || node.closest(".disabled, [aria-disabled='true']").length) return;
    const url = normalizeHttpUrl(ctx, node.attr("href"), pageUrl);
    if (!url || ctx.url.origin(url) !== ctx.url.origin(resolveBaseSite(ctx))) return;
    const nextPage = getUrlPageNumber(url);
    if (!Number.isSafeInteger(nextPage) || nextPage <= page || nextPage > 10000) return;
    const currentType = pageUrl.match(/\/vod\/type\/id\/(\d+)/i);
    const nextType = url.match(/\/vod\/type\/id\/(\d+)(?:\/|\.|[?#]|$)/i);
    if (currentType && (!nextType || currentType[1] !== nextType[1])) return;
    result = JSON.stringify([nextPage, url]);
    if (result.length > 2048) ctx.fail("INVALID_RESPONSE", "站点分页链接过长");
    return false;
  });
  return result;
}

function isHeitaoDramaPath(path, linkNode, $) {
  if (!path || path === "/" || !path.startsWith("/") || path.startsWith("//")) return false;
  if (/^(?:\/index\.php)?\/vod\/(?:type|search|player)(?:\/|\.)/i.test(path)) return false;

  // 排除已知的分类导航文本与非视频路径
  const linkText = cleanSingleLine(linkNode.text());
  if (
    /^(首页|现代都市|古装传奇|仙侠玄幻|科幻脑洞|灵异悬疑|其他短剧|更多|顶部|搜索|登录|注册|免责声明.*)$/.test(
      linkText
    )
  ) {
    return false;
  }

  if (
    /^\/(?:search|vodsearch|vodtype|vodshow|type|category|categories|tag|tags|page|login|register|about|disclaimer|contact)(?:\/|$|\.)/i.test(
      path
    )
  ) {
    return false;
  }

  // 如果已经在导航缓存中确认为分类链接，则排除
  if (navDiscoveryCache.map) {
    for (const catPath of navDiscoveryCache.map.values()) {
      if (catPath === path) return false;
    }
  }

  // 匹配常见短剧详情或播放路径
  if (
    /^(?:\/index\.php)?\/vod\/(?:detail|play)\/id\/\d+/i.test(path) ||
    /^\/(?:voddetail|vodplay|detail|play|video|watch|drama|duanju|short|series|v|d|p|archives|post)\/[^/?#]+/i.test(
      path
    )
  ) {
    return true;
  }
  if (/^\/[a-zA-Z0-9_-]{2,}\.html$/i.test(path)) return true;

  // 若链接内部包含封面图片或集数标签，也视为有效剧集入口
  if (linkNode.find("img").length > 0) return true;
  return false;
}

function findSingleDramaCardContainer($, linkNode, targetNormId, ctx, baseSite) {
  let curr = linkNode;
  let best = linkNode.parent();

  for (let depth = 0; depth < 4; depth++) {
    const parent = curr.parent();
    if (!parent || !parent.length || parent.is("body, html, main, section, ul")) {
      break;
    }

    let otherLinks = 0;
    parent.find("a[href]").each((_, aEl) => {
      const h = normalizeContentPath(ctx, $(aEl).attr("href"), baseSite);
      if (h && h !== targetNormId && isHeitaoDramaPath(h, $(aEl), $)) {
        otherLinks++;
      }
    });

    if (otherLinks > 0) break;
    best = parent;
    curr = parent;
  }
  return best;
}

function buildHeitaoCardItem(ctx, $, entry, baseSite) {
  let explicitTitle = "";
  let poster = "";
  const tokens = [];

  const searchNodes = [...entry.links, ...entry.containers];

  for (const node of searchNodes) {
    if (!explicitTitle) {
      const tAttr = cleanSingleLine(node.attr("title"));
      if (isValidHeitaoTitle(tAttr)) explicitTitle = tAttr;
    }

    const imgs = node.is("img") ? node : node.find("img");
    imgs.each((_, imgEl) => {
      const img = $(imgEl);
      if (!explicitTitle) {
        const alt = cleanSingleLine(img.attr("alt"));
        if (isValidHeitaoTitle(alt)) explicitTitle = alt;
      }
      if (!poster) {
        const rawSrc =
          img.attr("data-original") ||
          img.attr("data-src") ||
          img.attr("data-lazy-src") ||
          img.attr("src") ||
          "";
        poster = normalizeHttpUrl(ctx, rawSrc, baseSite);
      }
    });

    if (!poster) {
      const styleStr =
        node.attr("style") ||
        node.find("[style*='url(']").first().attr("style") ||
        "";
      const bgMatch = styleStr.match(/url\(['"]?([^'")]+)['"]?\)/i);
      if (bgMatch) {
        poster = normalizeHttpUrl(ctx, bgMatch[1], baseSite);
      }
    }
  }

  for (const node of searchNodes) {
    collectLeafTexts($, node, tokens);
  }

  let epNote = "";
  let genreTag = "";
  const titleCandidates = [];

  for (const rawToken of tokens) {
    const token = cleanSingleLine(rawToken);
    if (!token) continue;

    // 匹配集数标记（如 "8集"、"10集"、"更新至5集"、"全12集"）
    if (/^(?:更新至\s*|全\s*)?\d+\s*[集话期]$/.test(token)) {
      if (!epNote) epNote = token.replace(/\s+/g, "");
      continue;
    }

    // 匹配题材细分标签（如 "家庭纠葛"、"职场权色"、"逆袭打脸"、"都市其他"）
    if (
      /^(家庭纠葛|职场权色|逆袭打脸|都市其他|异能超能|群芳后宫|古装其他|后宫争宠|系统逆袭|仙侠其他|科幻其他|身体奇谭|鬼艳志怪|都市怪谈|综合脑洞|其他短剧)$/.test(
        token
      )
    ) {
      if (!genreTag) genreTag = token;
      continue;
    }

    if (isValidHeitaoTitle(token)) {
      titleCandidates.push(token);
    }
  }

  const title = explicitTitle || titleCandidates[0] || "";
  if (!title) return null;

  const subParts = [];
  if (genreTag) subParts.push(genreTag);
  if (epNote) subParts.push(epNote);

  const item = {
    id: entry.id.slice(0, 1024),
    title: title.slice(0, 240),
    kind: epNote && !/^1集$/.test(epNote) ? "series" : "unknown"
  };
  if (poster) item.poster = poster;
  if (subParts.length > 0) {
    item.subtitle = subParts.join(" · ").slice(0, 1024);
  }

  return item;
}

function collectLeafTexts($, rootNode, outList) {
  if (!rootNode || !rootNode.length) return;
  const children = rootNode.children();
  if (children.length === 0) {
    const t = cleanSingleLine(rootNode.text());
    if (t) outList.push(t);
    return;
  }

  rootNode.contents().each((_, contentNode) => {
    if (contentNode.type === "text") {
      const t = cleanSingleLine($(contentNode).text());
      if (t) outList.push(t);
    } else if (contentNode.type === "tag") {
      collectLeafTexts($, $(contentNode), outList);
    }
  });
}

function isValidHeitaoTitle(str) {
  const s = cleanSingleLine(str);
  if (!s || s.length < 2 || s.length > 80) return false;
  if (
    /^(推荐|本周热播|最新更新|现代都市|古装传奇|仙侠玄幻|科幻脑洞|灵异悬疑|其他短剧|更多|首页|搜索|立即播放|详情|\d+集)$/.test(
      s
    )
  ) {
    return false;
  }
  return true;
}

/* ======================== 详情与选集解析 ======================== */

function extractDetailTitle($) {
  const raw =
    cleanSingleLine($("h1").first().text()) ||
    cleanSingleLine($("meta[property='og:title']").attr("content")) ||
    cleanSingleLine($("title").first().text());

  if (!raw) return "";
  return raw
    .replace(/\s*[-|_·]\s*黑桃短剧.*$/i, "")
    .replace(/\s*[-|_·]\s*高清短剧在线观看.*$/i, "")
    .replace(/\s*-\s*第\s*\d+\s*[集话期].*$/i, "")
    .trim();
}

function extractDetailPoster(ctx, $, baseSite) {
  const candidates = [
    $("meta[property='og:image']").attr("content"),
    $("video").first().attr("poster"),
    $(".poster img, .cover img, .detail-pic img, article img")
      .first()
      .attr("data-original"),
    $(".poster img, .cover img, .detail-pic img, article img")
      .first()
      .attr("data-src"),
    $(".poster img, .cover img, .detail-pic img, article img").first().attr("src")
  ];
  for (const c of candidates) {
    const u = normalizeHttpUrl(ctx, c, baseSite);
    if (u) return u;
  }
  return "";
}

function extractDetailSummary($) {
  const candidates = [
    $("meta[property='og:description']").attr("content"),
    $("meta[name='description']").attr("content"),
    $(
      ".desc, .summary, .intro, .synopsis, .detail-content, .module-info-introduction-content"
    )
      .first()
      .text()
  ];
  for (const c of candidates) {
    const t = cleanSingleLine(c);
    if (t && t.length > 6 && !t.includes("本站内容面向成年人")) {
      return t;
    }
  }
  return "";
}

function extractDetailGroups(ctx, $, html, contentId, baseSite, title) {
  const episodes = [];
  const seenIds = new Set();

  // 1. 提取页面中的选集链接（如 第1集、01、EP1、全集、正片）
  const playlist = $(".juji-list, .playlist, .episodelist, .module-play-list, .detail-play-list");
  const links = playlist.length ? playlist.find("a[href]") : $("a[href]");
  const contentMatch = contentId.match(/\/vod\/(?:detail|play)\/id\/(\d+)/i);
  links.each((_, el) => {
    const a = $(el);
    if (a.find("img").length > 0) return;

    const epPath = normalizeContentPath(ctx, a.attr("href"), baseSite);
    if (!epPath || seenIds.has(epPath)) return;

    const epText = cleanSingleLine(a.text()) || cleanSingleLine(a.attr("title"));
    if (!epText || epText.length > 35) return;

    const isEpLabel =
      /^(第\s*\d+\s*[集话期季]|EP?\s*\d+|\d{1,3}集?|\d{2,3}|正片|全集|完整版|上篇|下篇|番外.*)$/i.test(
        epText
      );
    const isPlayRoute = /\/(vodplay|play|watch)\//i.test(epPath);
    if (!isPlayRoute && !looksLikeDirectStream(epPath) && !(playlist.length && isEpLabel)) return;
    const playMatch = epPath.match(/\/vod\/play\/id\/(\d+)/i);
    if (contentMatch && playMatch && contentMatch[1] !== playMatch[1]) return;
    if (epText === title) return;

    seenIds.add(epPath);
    episodes.push({
      id: epPath,
      name: /^\d+$/.test(epText) ? `第${epText}集` :
        (isEpLabel ? epText : (epPath.match(/\/nid\/(\d+)/i) ? `第${epPath.match(/\/nid\/(\d+)/i)[1]}集` : "正片"))
    });
  });

  // 2. 检查页面脚本中是否内嵌了选集数组 (如 episodes / playlist / videourls)
  if (episodes.length === 0) {
    const embeddedList = extractEmbeddedEpisodeList(html);
    for (let i = 0; i < embeddedList.length; i++) {
      const item = embeddedList[i];
      if (!item.url || seenIds.has(item.url)) continue;
      seenIds.add(item.url);
      episodes.push({
        id: item.url,
        name: item.name || `第${i + 1}集`
      });
    }
  }

  // 3. 兜底：若页面本身可直接播放或仅有一集合集版，提供单集入口
  if (episodes.length === 0 &&
      ($("video[src], video source[src], iframe[src], iframe[data-src], iframe[data-heitao-player-src]").length || /player_aaaa\s*=/.test(html))) {
    episodes.push({
      id: contentId,
      name: "正片"
    });
  }

  if (episodes.length === 0) return [];
  return [
    {
      id: "main",
      name: "默认线路",
      episodes
    }
  ];
}

function extractEmbeddedEpisodeList(html) {
  const results = [];
  // 匹配 MacCMS vod_play_url 或 JSON 数组格式的剧集列表
  const m3u8PairsRegex =
    /([^\$"'\s<>]{1,20})\$(https?:\/\/[^\s"'<>$]+\.(?:m3u8|mp4)(?:\?[^\s"'<>$#]*)?)/gi;
  let m;
  while ((m = m3u8PairsRegex.exec(html)) !== null) {
    results.push({
      name: cleanSingleLine(m[1]),
      url: m[2].replace(/\\\//g, "/")
    });
  }
  return results;
}

/* ======================== 播放源提取与解析 ======================== */

async function extractPlaySources(ctx, html, pageUrl, groupId) {
  const sources = [];
  const seenUrls = new Set();
  const iframeQueue = [];

  const addSource = (rawUrl, label, refOverride, decodeEntities = false) => {
    const ref = refOverride || pageUrl;
    const resolved = normalizeMediaUrl(ctx, rawUrl, ref, decodeEntities);
    if (!resolved || !looksLikeDirectStream(resolved) || seenUrls.has(resolved)) return;
    if (
      /\.(js|css|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|json|xml|vtt|srt)(\?|$)/i.test(
        resolved
      )
    ) {
      return;
    }

    seenUrls.add(resolved);
    const idx = sources.length + 1;
    sources.push(
      buildMediaSource(
        `${groupId}-${idx}`,
        label || `高清线路 ${idx}`,
        resolved,
        ref
      )
    );
  };

  scanPageForStreams(ctx, html, pageUrl, addSource, iframeQueue);

  const visited = new Set([pageUrl]);
  let requested = 0;
  for (let i = 0; i < iframeQueue.length && requested < 4 && sources.length === 0; i++) {
    const frame = iframeQueue[i];
    if (visited.has(frame.url)) continue;
    visited.add(frame.url);
    requested++;
    ctx.signal.throwIfAborted();

    try {
      const subRes = await fetchPage(ctx, frame.url, null, {
        Referer: frame.referer
      });
      ctx.signal.throwIfAborted();
      scanPageForStreams(
        ctx,
        subRes.data,
        subRes.url || frame.url,
        addSource,
        iframeQueue
      );
    } catch (err) {
      ctx.signal.throwIfAborted();
      if (err.code !== "NOT_FOUND" && !String(err.message || "").includes('"code":"NOT_FOUND"')) throw err;
    }
  }

  ctx.signal.throwIfAborted();
  return sources;
}

function scanPageForStreams(ctx, html, pageUrl, addSource, iframeQueue) {
  const $ = ctx.html.load(html);
  let found = false;
  const add = (rawUrl, label, decodeEntities = false) => {
    const url = normalizeMediaUrl(ctx, rawUrl, pageUrl, decodeEntities);
    if (!url || !looksLikeDirectStream(url)) return false;
    addSource(url, label, pageUrl);
    found = true;
    return true;
  };
  const enqueue = rawUrl => {
    const url = normalizeHttpUrl(ctx, rawUrl, pageUrl);
    if (!url) return;
    if (looksLikeDirectStream(url)) { add(url, "直连线路"); return; }
    if (!iframeQueue.some(frame => frame.url === url)) iframeQueue.push({ url, referer: pageUrl });
  };

  // 1. 原生 <video> / <source> 及 data-* 播放属性
  $(
    "video[src], video source[src], [data-video], [data-url], [data-m3u8], [data-mp4]"
  ).each((_, el) => {
    const node = $(el);
    const candidates = [
      node.attr("src"),
      node.attr("data-video"),
      node.attr("data-url"),
      node.attr("data-m3u8"),
      node.attr("data-mp4")
    ];
    for (const c of candidates) {
      if (c && !c.startsWith("blob:") && looksLikeDirectStream(c)) {
        add(c, "直连线路");
      }
    }
  });
  if (found) return;

  // 2. 收集内嵌播放器 <iframe>
  $("iframe").each((_, el) => {
    const rawSrc =
      $(el).attr("data-heitao-player-src") || $(el).attr("src") || $(el).attr("data-src") || "";
    enqueue(rawSrc);
  });

  // 3. 解析 MacCMS player_aaaa 配置对象
  const playerMatch = html.match(
    /player_aaaa\s*=\s*(\{[\s\S]*?\})\s*(?:<|;|\n)/i
  );
  if (playerMatch) {
    try {
      const cfg = JSON.parse(playerMatch[1]);
      let rawUrl = String(cfg.url || "");
      if (cfg.encrypt === 2 || cfg.encrypt === "2") rawUrl = ctx.crypto.base64Decode(rawUrl);
      const resolved = normalizeMediaUrl(ctx, rawUrl, pageUrl, false);
      if (!resolved) ctx.fail("INVALID_RESPONSE", "播放器配置中的地址无效");
      if (!add(resolved, cfg.from || "主线路")) enqueue(resolved);
      // 不把 url_next 等其他集的地址当成当前集的播放线路。
      return;
    } catch (err) {
      if (err.code || String(err.message || "").includes("WBX_ERROR:")) throw err;
      ctx.fail("INVALID_RESPONSE", "播放器配置格式无效");
    }
  }

  // 4. 反转义脚本中的斜杠与 Unicode 编码后匹配 .m3u8 / .mp4 链接
  const unescaped = $("script").map((_, el) => $(el).html() || "").get().join("\n")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, "&");

  const absMediaRegex =
    /(?:https?:)?\/\/[a-zA-Z0-9._~:/?#[\]@!$&()*+,;=%-]+\.(?:m3u8|mp4)(?:\?[a-zA-Z0-9._~:/?#[\]@!$&()*+,;=%-]*)?(?=["'\s<>\\]|$)/gi;
  let m;
  while ((m = absMediaRegex.exec(unescaped)) !== null) {
    add(m[0], "HLS/MP4 线路");
  }

  const relMediaRegex =
    /["'](\/[a-zA-Z0-9._~:/?#[\]@!$&()*+,;=%-]+\.(?:m3u8|mp4)(?:\?[a-zA-Z0-9._~:/?#[\]@!$&()*+,;=%-]*)?)["']/gi;
  let rm;
  while ((rm = relMediaRegex.exec(unescaped)) !== null) {
    add(rm[1], "高清线路");
  }
}

/* ======================== 通用格式化工具 ======================== */

function looksLikeDirectStream(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  return /\.(m3u8|mp4|mkv|flv|webm|mpd)(?:[?#].*)?$/i.test(s);
}

function normalizeContentPath(ctx, rawHref, baseSite) {
  const trimmed = String(rawHref || "").trim();
  if (!trimmed || /^(?:javascript:|data:|mailto:|#)/i.test(trimmed)) return "";
  try {
    const abs = ctx.url.resolve(trimmed, baseSite);
    const origin = ctx.url.origin(baseSite);
    if (!/^https?:\/\//i.test(abs)) return "";
    if (ctx.url.origin(abs) === origin) {
      return abs.slice(origin.length).split("#")[0] || "/";
    }
    return abs;
  } catch (_) {
    return "";
  }
}

function normalizeHttpUrl(ctx, rawUrl, baseSite) {
  const raw = String(rawUrl || "");
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "";
  const trimmed = raw.trim();
  if (!trimmed || /^(data:|javascript:|about:blank|#)/i.test(trimmed)) return "";
  try {
    const abs = ctx.url.resolve(trimmed, baseSite);
    if (/^https?:\/\//i.test(abs) && !/^https?:\/\/[^/?#]*@/.test(abs)) return abs;
  } catch (_) {}
  return "";
}

function normalizeMediaUrl(ctx, rawUrl, refererUrl, decodeEntities = true) {
  if (/[\u0000-\u001f\u007f]/.test(String(rawUrl || ""))) return "";
  let cleaned = String(rawUrl || "")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .trim();
  if (decodeEntities) cleaned = cleaned.replace(/&amp;|&#0*38;|&#x0*26;/gi, "&");
  if (!cleaned) return "";

  // 只拆解整条 URL 的外层编码，绝不解码已成形 URL 中的签名参数。
  if (/^(?:https?%3a(?:%2f|\/){2}|https?:%2f%2f|%2f)/i.test(cleaned)) {
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch (_) {}
  }

  return normalizeHttpUrl(ctx, cleaned, refererUrl);
}

function buildMediaSource(id, name, mediaUrl, refererUrl) {
  const extension = (mediaUrl.match(/\.(m3u8|mp4|mkv|flv|webm|mpd)(?:[?#]|$)/i) || [])[1];
  const mime = {
    m3u8: "application/vnd.apple.mpegurl", mp4: "video/mp4", mkv: "video/x-matroska",
    flv: "video/x-flv", webm: "video/webm", mpd: "application/dash+xml"
  }[String(extension || "").toLowerCase()];
  const origin = refererUrl
    ? refererUrl.replace(/^(https?:\/\/[^/]+).*$/, "$1")
    : DEFAULT_SITE;

  return {
    id,
    name,
    url: mediaUrl,
    ...(mime ? { mime } : {}),
    headers: {
      "User-Agent": DEFAULT_UA,
      Referer: refererUrl || origin + "/",
      Origin: origin
    },
    downloadable: String(extension || "").toLowerCase() !== "mpd"
  };
}

function cleanSingleLine(str) {
  return String(str || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

return p;
}

/* 只映射Conflux协议；WeBox解析、分级状态、分集和媒体地址保留。 */
function htRef(path,kind){return {source:'custom',id:'heitao:'+path,mediaType:kind==='series'?'tv':'movie'};}
function htOwned(ref){
 if(!ref||ref.source!=='custom')return null;var s=String(ref.id||'');if(s.indexOf('heitao:')!==0)return null;
 var path=s.slice(7),match=path.match(/^((?:\/index\.php)?\/vod\/(detail|play|player)\/id\/[1-9]\d*(?:\/(?:sid|nid)\/[1-9]\d*)*\.html)(?:~ep=([1-9]\d*))?$/);
 if(!match||path.length>500)return null;return {path:match[1],kind:match[2],index:match[3]?Number(match[3]):0};
}
function htParam(v,opts,fallback){var s=v==null||v===''?fallback:String(v);for(var i=0;i<opts.length;i++)if(opts[i].value===s)return s;htFail('invalid_params','请选择有效的栏目或题材。',false);}
function htFilters(input){var p=input&&input.params||{};return {category:htParam(p.category,HT_CATEGORIES,'all'),tag:htParam(p.tag,HT_TAGS,'')};}
function htTitle(ctx,input){var p=htFilters(input);for(var i=0;i<HT_CATEGORIES.length;i++)if(HT_CATEGORIES[i].value===p.category)return '黑桃短剧 · '+HT_CATEGORIES[i].label;return '黑桃短剧';}
function htCursor(input){var p=input&&input.page;if(p==null)return null;var v=typeof p==='object'?p.cursor:p;
 if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<1||v>10000)htFail('invalid_params','分页信息无效。',false);v=String(v);}
 if(typeof v!=='string'||v.length>2048)htFail('invalid_params','分页游标无效，请重新打开列表。',false);return v;
}
function htItems(rows){var out=[],seen={};(rows||[]).forEach(function(x){if(!x||!x.title||!htOwned(htRef(x.id,x.kind))||seen[x.id])return;seen[x.id]=true;var it={ref:htRef(x.id,x.kind),title:String(x.title),subtitle:String(x.subtitle||''),intent:'detail'};if(x.poster)it.images={poster:x.poster,backdrop:x.poster,cover:x.poster};out.push(it);});return out;}
async function htBrowse(ctx,input){var c=htContext(ctx),p=createHeitaoOriginal(),r=await p.list(c,{filters:htFilters(input),cursor:htCursor(input),refresh:false});var out={items:htItems(r.items)};if(r.nextCursor)out.next={type:'cursor',cursor:r.nextCursor};return out;}
async function htList(ctx,input){if(!input||!input.ref||input.ref.source!=='custom'||input.ref.id!=='heitao:list')return {items:[]};var r=await htBrowse(ctx,input),out={items:r.items};if(r.next)out.next=r.next;return out;}
async function htSearch(ctx,input){var q=String(input&&input.query||'').trim();if(!q)return {items:[]};if(q.length>200)htFail('invalid_params','搜索词不能超过200个字符。',false);var c=htContext(ctx),p=createHeitaoOriginal(),r=await p.search(c,{query:q,filters:htFilters(input),cursor:htCursor(input),refresh:false});var out={items:htItems(r.items)};if(r.nextCursor)out.next={type:'cursor',cursor:r.nextCursor};return out;}
function htEpisodeNumber(ep,index){var m=String(ep.id||'').match(/\/nid\/(\d+)/)||String(ep.name||'').match(/(?:第|EP?\s*)(\d+)/i);return m?Number(m[1]):index+1;}
async function htDetail(ctx,input){var owned=htOwned(input&&input.ref);if(!owned||owned.kind==='player')return null;var p=createHeitaoOriginal(),r=await p.detail(htContext(ctx),{id:owned.path});if(!r||!r.title)return null;
 var all=[];(r.groups||[]).forEach(function(g){if(g.id==='main')all=all.concat(g.episodes||[]);});var kind=r.kind==='series'||all.length>1?'series':'movie';var out={ref:htRef(owned.path,kind),title:r.title,overview:r.summary||'',images:{poster:r.poster||'',backdrop:r.poster||'',cover:r.poster||'',detailPoster:r.poster||''}};
 if(kind==='series')out.episodes=all.map(function(e,i){var direct=htOwned(htRef(e.id,kind)),path=direct?e.id:owned.path+'~ep='+(i+1);return {season:1,episode:htEpisodeNumber(e,i),title:e.name||'第'+(i+1)+'集',ref:htRef(path,kind),still:r.poster||''};});
 return out;
}
async function htPlayback(ctx,input){var own=htOwned(input&&input.ref);if(!own)return [];var c=htContext(ctx),p=createHeitaoOriginal(),content=own.path,episode=own.path;
 if(own.kind==='detail'){
  var r=await p.detail(c,{id:content}),eps=[];(r.groups||[]).forEach(function(g){if(g.id==='main')eps=eps.concat(g.episodes||[]);});
  var n=own.index||(typeof input.episode==='object'?Number(input.episode.episode):Number(input.episode))||1;
  var e=own.index?eps[n-1]:eps.find(function(e,i){return htEpisodeNumber(e,i)===n;});if(!e)return [];episode=e.id;
 }
 var r=await p.play(c,{contentId:content,groupId:'main',episodeId:episode}),out=[];
 (r.sources||[]).forEach(function(s){var u=htUrl(s.url),site=htUrl(c.settings.site);if(!htAllowed(u,site))return;var h={};Object.keys(s.headers||{}).forEach(function(k){if(!/^(cookie|authorization)$/i.test(k))h[k]=s.headers[k];});out.push({id:'heitao-'+s.id,name:s.name||'原站HLS',url:s.url,headers:h});});
 return out;
}

var HT_CATEGORIES=[{label:"首页推荐",value:"all"},{label:"现代都市",value:"现代都市"},{label:"古装传奇",value:"古装传奇"},{label:"仙侠玄幻",value:"仙侠玄幻"},{label:"科幻脑洞",value:"科幻脑洞"},{label:"灵异悬疑",value:"灵异悬疑"},{label:"其他短剧",value:"其他短剧"}];
var HT_TAGS=[{label:"全部题材",value:""},{label:"家庭纠葛",value:"家庭纠葛"},{label:"职场权色",value:"职场权色"},{label:"逆袭打脸",value:"逆袭打脸"},{label:"系统逆袭",value:"系统逆袭"},{label:"异能超能",value:"异能超能"},{label:"群芳后宫",value:"群芳后宫"},{label:"后宫争宠",value:"后宫争宠"},{label:"鬼艳志怪",value:"鬼艳志怪"},{label:"都市怪谈",value:"都市怪谈"},{label:"身体奇谭",value:"身体奇谭"},{label:"综合脑洞",value:"综合脑洞"},{label:"都市其他",value:"都市其他"},{label:"古装其他",value:"古装其他"},{label:"仙侠其他",value:"仙侠其他"},{label:"科幻其他",value:"科幻其他"}];
definePackage({id:"conflux.heitao",title:"黑桃短剧",version:"1.0.3",engine:1,site:"https://heitaodj.com",icon:"suit.spade.fill",description:"原站直连：栏目与题材参数、搜索、详情、分集HLS。无需Worker或封面解密服务；仅本地测试，真机待验。",permissions:{network:["https://heitaodj.com","https://www.heitaodj.com","https://play.djqiepian.app"]},settings:[{name:"site",title:"站点地址",type:"text",default:"https://heitaodj.com",description:"本站HTTPS主机，不使用中转。"},{name:"cookie",title:"访问Cookie（选填）",type:"text",default:"",description:"无登录要求；原稿自声明分级提示标志按原逻辑处理。仅遇访问验证时填写，不分享凭据。"},{name:"timeout",title:"请求超时秒数",type:"number",default:15,description:"页面请求5–20秒，有界iframe解析最多4次。"}],extensions:[{type:"widget",id:"browse",title:"黑桃短剧",description:"选择原站栏目和当前页题材，无Worker直连。",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"heitao:list"},params:[{name:"category",title:"短剧栏目",type:"select",default:"all",options:[{title:"首页推荐",value:"all"},{title:"现代都市",value:"现代都市"},{title:"古装传奇",value:"古装传奇"},{title:"仙侠玄幻",value:"仙侠玄幻"},{title:"科幻脑洞",value:"科幻脑洞"},{title:"灵异悬疑",value:"灵异悬疑"},{title:"其他短剧",value:"其他短剧"}]},{name:"tag",title:"题材筛选（当前页）",type:"select",default:"",options:[{title:"全部题材",value:""},{title:"家庭纠葛",value:"家庭纠葛"},{title:"职场权色",value:"职场权色"},{title:"逆袭打脸",value:"逆袭打脸"},{title:"系统逆袭",value:"系统逆袭"},{title:"异能超能",value:"异能超能"},{title:"群芳后宫",value:"群芳后宫"},{title:"后宫争宠",value:"后宫争宠"},{title:"鬼艳志怪",value:"鬼艳志怪"},{title:"都市怪谈",value:"都市怪谈"},{title:"身体奇谭",value:"身体奇谭"},{title:"综合脑洞",value:"综合脑洞"},{title:"都市其他",value:"都市其他"},{title:"古装其他",value:"古装其他"},{title:"仙侠其他",value:"仙侠其他"},{title:"科幻其他",value:"科幻其他"}]}],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"heitao:/index.php/vod/detail/id/1.html"},title:"黑桃短剧",subtitle:"选择栏目后加载",intent:"detail"}]},resolveTitle:htTitle,load:htBrowse},
{type:"list",id:"list",title:"黑桃列表",style:"grid",accepts:{sources:["custom"]},cache:{ttlSeconds:180},search:{id:"search"},load:htList},
{type:"search",id:"search",title:"黑桃搜索",params:[{name:"category",title:"短剧栏目",type:"select",default:"all",options:[{title:"首页推荐",value:"all"},{title:"现代都市",value:"现代都市"},{title:"古装传奇",value:"古装传奇"},{title:"仙侠玄幻",value:"仙侠玄幻"},{title:"科幻脑洞",value:"科幻脑洞"},{title:"灵异悬疑",value:"灵异悬疑"},{title:"其他短剧",value:"其他短剧"}]},{name:"tag",title:"题材筛选（当前页）",type:"select",default:"",options:[{title:"全部题材",value:""},{title:"家庭纠葛",value:"家庭纠葛"},{title:"职场权色",value:"职场权色"},{title:"逆袭打脸",value:"逆袭打脸"},{title:"系统逆袭",value:"系统逆袭"},{title:"异能超能",value:"异能超能"},{title:"群芳后宫",value:"群芳后宫"},{title:"后宫争宠",value:"后宫争宠"},{title:"鬼艳志怪",value:"鬼艳志怪"},{title:"都市怪谈",value:"都市怪谈"},{title:"身体奇谭",value:"身体奇谭"},{title:"综合脑洞",value:"综合脑洞"},{title:"都市其他",value:"都市其他"},{title:"古装其他",value:"古装其他"},{title:"仙侠其他",value:"仙侠其他"},{title:"科幻其他",value:"科幻其他"}]}],cache:{ttlSeconds:180},search:htSearch},
{type:"detail",id:"detail",title:"黑桃详情",accepts:{sources:["custom"]},cache:{ttlSeconds:60},load:htDetail},
{type:"playback",id:"playback",title:"黑桃原站线路",accepts:{sources:["custom"]},cache:{ttlSeconds:0},sources:htPlayback}]});
