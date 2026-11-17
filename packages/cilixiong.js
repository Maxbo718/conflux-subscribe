/* Conflux 磁力熊 1.0.4 | 无Worker | 当前真实页面重建 | Conflux真机待验。
原始参考底座: 黑桃1.0.4 SHA256 7ffeea17e14919ceb1d85ddbc79110e5b45287c43b65ef044113f393f8d0f7c6。
原Webox附件未恢复，不宣称字节等价移植。1.0.4仅局部优化根选择器查询；其余数据/请求逻辑与1.0.3一致。 */
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
  var nodes=every();
  if(typeof sel==='string'&&nodes.length){
   var groups=parseSelector(sel);
   return new Collection(nodes.filter(function(n){return matchesGroups(n,groups);}));
  }
  return new Collection(nodes.filter(function(n){return matches(n,sel);}));
 }
 $.root=function(){return new Collection([root]);};
 $.html=function(){return serialize(root);};
 return $;
}
return {load:load,parse:parse,text:function(n){return textOf(n);}};
})();


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

var CX_NAV=[{"label":"首页","url":"https://www.cilixiong.cc/","section":"main"},{"label":"电影","url":"https://www.cilixiong.cc/movie/","section":"main"},{"label":"剧集","url":"https://www.cilixiong.cc/drama/","section":"main"},{"label":"豆瓣电影Top250","url":"https://www.cilixiong.cc/top250/","section":"subject"},{"label":"IMDB Top250","url":"https://www.cilixiong.cc/s/imdbtop250/","section":"subject"},{"label":"高分悬疑片","url":"https://www.cilixiong.cc/s/suspense/","section":"subject"},{"label":"高分喜剧片","url":"https://www.cilixiong.cc/s/comedy/","section":"subject"},{"label":"高分传记片","url":"https://www.cilixiong.cc/s/biopic/","section":"subject"},{"label":"高分爱情片","url":"https://www.cilixiong.cc/s/romance/","section":"subject"},{"label":"高分犯罪片","url":"https://www.cilixiong.cc/s/crime/","section":"subject"},{"label":"高分恐怖片","url":"https://www.cilixiong.cc/s/horror/","section":"subject"},{"label":"高分冒险片","url":"https://www.cilixiong.cc/s/adventure/","section":"subject"},{"label":"高分武侠片","url":"https://www.cilixiong.cc/s/martial/","section":"subject"},{"label":"高分奇幻片","url":"https://www.cilixiong.cc/s/fantasy/","section":"subject"},{"label":"高分历史片","url":"https://www.cilixiong.cc/s/history/","section":"subject"},{"label":"高分战争片","url":"https://www.cilixiong.cc/s/war/","section":"subject"},{"label":"高分歌舞片","url":"https://www.cilixiong.cc/s/musical/","section":"subject"},{"label":"高分灾难片","url":"https://www.cilixiong.cc/s/disaster/","section":"subject"},{"label":"高分情色片","url":"https://www.cilixiong.cc/s/erotic/","section":"subject"},{"label":"高分西部片","url":"https://www.cilixiong.cc/s/west/","section":"subject"},{"label":"高分音乐片","url":"https://www.cilixiong.cc/s/music/","section":"subject"},{"label":"高分科幻片","url":"https://www.cilixiong.cc/s/sci-fi/","section":"subject"},{"label":"高分动作片","url":"https://www.cilixiong.cc/s/action/","section":"subject"},{"label":"高分动画片","url":"https://www.cilixiong.cc/s/animation/","section":"subject"},{"label":"高分纪录片","url":"https://www.cilixiong.cc/s/documentary/","section":"subject"},{"label":"冷门佳片","url":"https://www.cilixiong.cc/s/unpopular/","section":"subject"}];
/* 磁力熊站方数据层。真实网页重建，不冒称恢复了已缺失 Webox 原稿。 */
var CX_VERSION='1.0.4',CX_SITE='https://www.cilixiong.cc';
function htFail(code,message,retryable){throw ExtensionError({code:code,message:message,retryable:!!retryable});}
function cxFail(code,message){htFail(code,message,code==='unavailable'||code==='rate_limited');}
/* 完整参考resolver保持原样；本站薄层只恢复相对目录末斜杠。 */
function cxResolve(value,base){
 var s=String(value||'').trim(),r=htResolve(s,base);
 if(r&&s&&!/^(?:[a-z][a-z0-9+.-]*:|\/|\?|#)/i.test(s)&&/\/$/.test(s.split(/[?#]/)[0])){
  var p=r.search(/[?#]/),head=p<0?r:r.slice(0,p),tail=p<0?'':r.slice(p);
  if(head.charAt(head.length-1)!=='/')r=head+'/'+tail;
 }
 return r;
}
function cxAllowed(u){var p=htUrl(u);return p&&p.origin===CX_SITE;}
function cxContext(ctx){
 if(!ctx||!ctx.http||typeof ctx.http.get!=='function')cxFail('unavailable','Conflux 未提供 HTTP 访问能力。');
 var timeout=Number(ctx.settings&&ctx.settings.timeout)||15;
 timeout=Math.min(Math.max(timeout,5),20)*1000;
 function request(method,u,body,o,hops){
  o=o||{};
  return Promise.resolve().then(function(){
   if(!cxAllowed(u)||hops>4)cxFail('unavailable','页面跳转到了未授权站点，已停止请求。');
   var h={};Object.keys(o.headers||{}).forEach(function(k){if(!/^(?:authorization|cookie|host|content-length)$/i.test(k))h[k]=o.headers[k];});
   if(!Object.keys(h).some(function(k){return k.toLowerCase()==='user-agent';}))h['User-Agent']='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
   var opts={headers:h,timeoutMs:timeout,followRedirects:false,cacheTtlSeconds:0};
   if(method==='POST'){
    if(typeof ctx.http.post!=='function')cxFail('unavailable','Conflux 未提供 POST 搜索能力。');
    return ctx.http.post(u,body,opts); /* 官方三参字符串形态；必须另做原生正文验收。 */
   }
   return ctx.http.get(u,opts);
  }).then(function(r){
   if(!r||typeof r.status!=='number')cxFail('unavailable','未收到有效的 HTTP 响应。');
   var location='',headers={};Object.keys(r.headers||{}).forEach(function(k){headers[k]=r.headers[k];if(k.toLowerCase()==='location')location=String(r.headers[k]);});
   if(r.status>=300&&r.status<400){
    if(!location)cxFail('unavailable','站点重定向缺少目标地址。');
    var next=cxResolve(location,u),nextMethod=method,nextBody=body;
    if(r.status===303||(method==='POST'&&(r.status===301||r.status===302))){nextMethod='GET';nextBody=null;}
    return request(nextMethod,next,nextBody,o,hops+1);
   }
   var text=htText(r.data);if(text.length>2000000)cxFail('unavailable','页面响应过大，已停止解析。');
   if(/__cf_chl_opt|_cf_chl_opt|cf-browser-verification|Just a moment|Attention Required|Sorry, you have been blocked/i.test(text))cxFail('unavailable','站点要求访问验证，当前请求未通过。');
   if(r.status===429)cxFail('rate_limited','站点请求过于频繁，请稍后重试。');
   if(r.status!==200&&!(o.allow404&&r.status===404))cxFail('unavailable','站点返回 HTTP '+r.status+'，未将故障当作空结果。');
   return {status:r.status,headers:headers,url:u,data:text};
  },function(e){if(e&&e.code)throw e;cxFail('unavailable','网络请求失败，请稍后重试。');});
 }
 var htmlLoad=(function(){
  if(ctx.html&&typeof ctx.html.load==='function')return function(s){return ctx.html.load(s);};
  var lastSrc=null,lastDom=null,lastLen=-1;
  return function(s){
   var str=String(s==null?'':s);
   if(lastDom&&str===lastSrc)return lastDom;
   if(lastSrc!==null&&str.length===lastLen&&str===lastSrc)return lastDom;
   lastDom=HT_DOM.load(str);lastSrc=str;lastLen=str.length;return lastDom;
  };
 })();
 return {get:function(u,o){return request('GET',u,null,o,0);},post:function(u,b,o){return request('POST',u,b,o,0);},html:{load:htmlLoad}};
}
function cxClean(s){return String(s==null?'':s).replace(/\s+/g,' ').trim();}
function cxRef(id,type,preview){return {source:'custom',id:(preview?'cx:preview:':'cx:detail:')+String(id),mediaType:type};}
function cxOwned(ref){
 if(!ref||ref.source!=='custom'||!['movie','tv'].includes(ref.mediaType))return null;
 var m=String(ref.id||'').match(/^cx:(detail|preview):(\d{1,8})$/);
 if(!m||m[1]==='preview'&&ref.mediaType!=='tv')return null;
 return {id:m[2],preview:m[1]==='preview',type:ref.mediaType,path:(ref.mediaType==='tv'?'/drama/':'/movie/')+m[2]+'.html'};
}
function cxImage(v,base){var u=cxResolve(v,base),p=htUrl(u);if(!p||!['i.nacloud.cc','www.cilixiong.cc'].includes(p.host))return '';return u;}
function cxItems($,url){
 var out=[],seen={};
 $('.card-cover').each(function(_,el){
  var node=$(el),a=node.find('a[href]').first(),u=cxResolve(a.attr('href'),url),m=u.match(/^https:\/\/www\.cilixiong\.cc\/(movie|drama)\/(\d{1,8})\.html$/);
  if(!m||seen[m[2]])return;
  var title=cxClean(node.find('h2,h3,h4').first().text());if(!title)return;
  var style=String(node.find('.card-img').first().attr('style')||''),im=style.match(/background-image\s*:\s*url\(\s*['"]?([^'"\)]+)['"]?\s*\)/i),poster=cxImage(im&&im[1]||node.find('img').first().attr('src'),url);
  var rating=Number(cxClean(node.find('.rank,.db_rank').first().text())),year=cxClean(node.find('li.small').first().text());
  var it={ref:cxRef(m[2],m[1]==='drama'?'tv':'movie'),title:title,intent:'detail'};
  if(poster)it.images={poster:poster,cover:poster};
  if(rating>0&&rating<=10)it.rating=rating;
  if(/^\d{4}$/.test(year))it.releaseDate=year;
  if(it.ref.mediaType==='tv')it.subtitle='剧集 · 仅首集在线播放预览';else if(year)it.subtitle=year;
  seen[m[2]]=true;out.push(it);
 });
 return out;
}
function cxListUrl(url){return CX_NAV.some(function(n){return n.url===url;});}
function cxPageUrl(u,base){
 if(!cxAllowed(u))return false;
 var p=u.slice(CX_SITE.length),b=base.slice(CX_SITE.length);
 if(base===CX_SITE+'/')return false;
 return p===b||p.indexOf(b)===0&&/^index_\d{1,5}\.html$/.test(p.slice(b.length));
}
function cxCursor(input,base,q){
 var page=input&&input.page;if(page==null)return null;
 if(!page||page.type!=='cursor'||typeof page.cursor!=='string'||page.cursor.length>1000)cxFail('invalid_params','分页标记格式不正确。');
 var o;try{o=JSON.parse(page.cursor);}catch(e){cxFail('invalid_params','分页标记无法解析。');}
 if(!o||o.base!==base||o.q!==(q||'')||typeof o.url!=='string')cxFail('invalid_params','分页标记不属于当前栏目或关键词。');
 if(q){if(!cxAllowed(o.url)||!/^\/e\/search\/result\/\?(?:[^#]+)$/.test(o.url.slice(CX_SITE.length)))cxFail('invalid_params','搜索分页目标不正确。');}
 else if(!cxPageUrl(o.url,base))cxFail('invalid_params','栏目分页目标不正确。');
 return o.url;
}
function cxNext($,url,base,q){
 var next='';$('.pagination a[href]').each(function(_,el){if(next)return;var a=$(el);if(/下一页|Next/i.test(cxClean(a.text())))next=cxResolve(a.attr('href'),url);});
 if(!next||next===url)return null;
 if(q){if(!cxAllowed(next)||next.indexOf(CX_SITE+'/e/search/result/?')!==0)return null;}else if(!cxPageUrl(next,base))return null;
 return {type:'cursor',cursor:JSON.stringify({url:next,base:base,q:q||''})};
}
async function cxBrowse(ctx,input,route){
 if(!cxListUrl(route))cxFail('invalid_params','请选择站点现有的栏目。');
 var c=cxContext(ctx),url=cxCursor(input,route,'')||route,r=await c.get(url),$=c.html.load(r.data),out={items:cxItems($,r.url)},next=cxNext($,r.url,route,'');
 if(next)out.next=next;return out;
}
async function cxList(ctx,input){
 var ref=input&&input.ref;if(!ref||ref.source!=='custom'||typeof ref.id!=='string'||ref.id.indexOf('cx:list:')!==0)return {items:[]};
 var route=ref.id.slice(8);if(!cxListUrl(route))return {items:[]};return cxBrowse(ctx,input,route);
}
async function cxSearch(ctx,input){
 var q=cxClean(input&&input.query);if(!q)return {items:[]};if(q.length>200)cxFail('invalid_params','搜索词不能超过200个字符。');
 var c=cxContext(ctx),base=CX_SITE+'/e/search/index.php',page=cxCursor(input,base,q),r;
 if(page)r=await c.get(page);
 else {var home=await c.get(CX_SITE+'/'),$=c.html.load(home.data),form=$('form#searchform').first(),action=cxResolve(form.attr('action'),home.url),fields=[];
  if(action!==base)cxFail('unavailable','站点搜索表单发生变化，请更新扩展。');
  form.find('input[name]').each(function(_,el){var x=$(el),name=String(x.attr('name')||''),value=name==='keyboard'?q:String(x.attr('value')||'');if(name)fields.push(encodeURIComponent(name)+'='+encodeURIComponent(value));});
  if(!fields.some(function(s){return s.indexOf('keyboard=')===0;}))cxFail('unavailable','站点搜索参数缺失。');
  r=await c.post(base,fields.join('&'),{headers:{'Content-Type':'application/x-www-form-urlencoded','Referer':home.url}});
 }
 var dom=c.html.load(r.data),out={items:cxItems(dom,r.url)},next=cxNext(dom,r.url,base,q);if(next)out.next=next;return out;
}
function cxDetailDocument($,url,owned){
 var title=cxClean($('.mv_detail h1').first().text());if(!title)return null;
 var poster=cxImage($('img[alt]').filter(function(){return String($(this).attr('alt')||'')===title;}).first().attr('src'),url);
 var metadata={},people=[],genres=[],runtime,release,rating=Number(cxClean($('.db_rank').first().text()));
 $('.mv_detail p').each(function(_,el){var s=cxClean($(el).text()),m=s.match(/^([^:：]+)[:：]\s*(.*)$/);if(m)metadata[cxClean(m[1])]=cxClean(m[2]);});
 String(metadata['类型']||'').split('|').filter(Boolean).forEach(function(t){genres.push({id:'cilixiong-genre:'+encodeURIComponent(cxClean(t)),title:t});});
 String(metadata['主演']||'').split(/\s*\/\s*/).filter(Boolean).forEach(function(t){people.push({id:'cilixiong-person:'+encodeURIComponent(cxClean(t)),title:t,role:'演员'});});
 var mins=String(metadata['片长']||metadata['单集片长']||'').match(/(\d+)\s*分钟/);if(mins)runtime=Number(mins[1])*60;
 var rd=String(metadata['上映日期']||'').match(/\d{4}(?:-\d{2}-\d{2})?/);if(rd)release=rd[0];
 var ref=cxRef(owned.id,owned.type),out={ref:ref,title:title,overview:cxClean($('.mv_card_box').first().text())};
 if(poster)out.images={poster:poster,detailPoster:poster,cover:poster,stills:[poster]};
 if(rating>0&&rating<=10)out.rating=rating;
 if(release)out.releaseDate=release;if(genres.length){out.genres=genres;out.genre=genres.map(function(g){return g.title;}).join(' / ');}if(people.length)out.people=people;if(runtime)out.runtimeSeconds=runtime;
 var iframe='';$('.embed_video iframe[src]').each(function(_,el){var u=cxResolve($(el).attr('src'),url);if(u===CX_SITE+'/e/extend/jx.php?id='+owned.id)iframe=u;});
 if(owned.type==='tv'){
  out.subtitle='仅第1集在线播放预览';
  if(iframe&&/剧集仅提供第一集在线播放预览/.test($.root().text()))out.episodes=[{season:1,episode:1,title:title+' · 第1集预览',overview:'站点仅提供本季第一集在线播放预览；不是整季在线播放。',ref:cxRef(owned.id,'tv',true),still:poster||undefined,badges:[{title:'预览',color:'#D9A441'}]}];
  else out.episodes=[];
 }
 return {item:out,iframe:iframe};
}
async function cxDetail(ctx,input){
 var owned=cxOwned(input&&input.ref);if(!owned||owned.preview)return null;
 var c=cxContext(ctx),r=await c.get(CX_SITE+owned.path,{allow404:true});if(r.status===404)return null;
 var d=cxDetailDocument(c.html.load(r.data),r.url,owned);if(!d)cxFail('unavailable','详情页面结构发生变化，未将解析失败伪装为空。');return d.item;
}
function cxRequestedEpisode(input){
 var ep=input&&input.episode,season=input&&input.season;
 if(ep&&typeof ep==='object'){season=ep.season;ep=ep.episode;}
 if(ep!=null&&Number(ep)!==1||season!=null&&Number(season)!==1)return false;return true;
}
async function cxPlayback(ctx,input){
 var owned=cxOwned(input&&input.ref);if(!owned||owned.type==='tv'&&!cxRequestedEpisode(input))return [];
 var c=cxContext(ctx),r=await c.get(CX_SITE+owned.path,{allow404:true});if(r.status===404)return [];
 var d=cxDetailDocument(c.html.load(r.data),r.url,owned);if(!d)cxFail('unavailable','详情页面结构发生变化，无法解析播放入口。');
 if(!d.iframe||owned.type==='tv'&&!(d.item.episodes&&d.item.episodes.length))return [];
 var player=await c.get(d.iframe),$=c.html.load(player.data),vurl='';
 $('script').each(function(_,el){if(vurl||$(el).attr('src'))return;var raw=$(el).text(),m=raw.match(/\bvar\s+vurl\s*=\s*(['"])([^'"\r\n]+)\1\s*;/);if(m)vurl=m[2];});
 if(!vurl)cxFail('unavailable','站点播放器未提供媒体地址，请稍后重试。');
 if(!/^https:\/\/(?:v\.gsuus\.com\/play\/[A-Za-z0-9_-]+|play\.phimgood\.com\/[0-9]{8}\/[A-Za-z0-9_-]+)\/index\.m3u8(?:\?[^\s]*)?$/.test(vurl))cxFail('unavailable','媒体地址发生变化，已停止返回未知线路。');
 return [{id:'cilixiong-'+owned.id,name:owned.type==='tv'?'原站HLS · 第1集预览':'原站HLS',url:vurl,headers:{Referer:d.iframe},player:'system',description:'标准HLS；公开AES-128由播放器处理。'+(owned.type==='tv'?'站方仅提供第一集预览。':'')}];
}
/* 独立原生诊断只输出公开站点/能力状态，不读取storage，不收集身份。 */
async function cxDiagnostic(ctx){
 var rows=[],n=0;
 function add(title,subtitle){rows.push({ref:{source:'custom',id:'cx:diagnostic:'+String(++n)},title:title,subtitle:subtitle});}
 add('运行能力','http.get='+(!!(ctx&&ctx.http&&ctx.http.get))+' / post='+(!!(ctx&&ctx.http&&ctx.http.post))+' / html='+(!!(ctx&&ctx.html&&ctx.html.load))+'；html无时使用内置解析器');
 try{var c=cxContext(ctx),home=await c.get(CX_SITE+'/'),dom=c.html.load(home.data),items=cxItems(dom,home.url);add('首页 HTTP '+home.status,'响应 '+home.data.length+' 字符，解析作品 '+items.length+' 条');}catch(e){add('首页失败',String(e.message||e));}
 try{var s=await cxSearch(ctx,{query:'乘船而去',params:{}});add('三参 POST 搜索','命中 '+s.items.length+' 条；真实标记：'+(s.items[0]&&s.items[0].title||'空结果'));}catch(e){add('搜索失败',String(e.message||e));}
 try{var d=await cxDetail(ctx,{ref:cxRef('4759','tv')});add('真实详情',d.title+' / 预览集数 '+d.episodes.length+' / still='+(!!(d.episodes[0]&&d.episodes[0].still)));}catch(e){add('详情失败',String(e.message||e));}
 try{var p=await cxPlayback(ctx,{ref:cxRef('4768','movie')});add('播放地址解析',p.length+' 条；'+(p[0]&&p[0].url||'没有线路'));}catch(e){add('取流失败',String(e.message||e));}
 add('验收边界','这些卡片不证明已原生起播/拖动/长播，请在正常扩展里播放测试。');return {items:rows};
}

definePackage({id:"conflux.cilixiong",title:"磁力熊",version:"1.0.4",engine:1,site:"https://www.cilixiong.cc",icon:"https://www.cilixiong.cc/favicon-32x32.png",description:"磁力熊原站直连：真实电影、剧集与23榜单主题，搜索、详情、标准HLS播放。剧集仅第一集预览；无需Worker，Conflux真机待验。",permissions:{network:["https://www.cilixiong.cc"]},settings:[{name:"timeout",title:"页面请求超时秒数",type:"number",default:15,description:"5–20秒；无账号或Cookie要求。"}],extensions:[
{type:"widget",id:"home",title:"磁力熊 · 首页",template:"backdrop-rail",families:["extraLarge"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"首页",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/");}},
{type:"widget",id:"movies",title:"磁力熊 · 电影",template:"poster-pager",families:["extraLarge"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/movie/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"电影",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/movie/");}},
{type:"widget",id:"dramas",title:"磁力熊 · 剧集",template:"poster-ranked",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/drama/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"剧集",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/drama/");}},
{type:"widget",id:"douban-top250",title:"磁力熊 · 豆瓣电影Top250",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/top250/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"豆瓣电影Top250",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/top250/");}},
{type:"widget",id:"imdb-top250",title:"磁力熊 · IMDB Top250",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/imdbtop250/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"IMDB Top250",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/imdbtop250/");}},
{type:"widget",id:"subject-suspense",title:"磁力熊 · 高分悬疑片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/suspense/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分悬疑片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/suspense/");}},
{type:"widget",id:"subject-comedy",title:"磁力熊 · 高分喜剧片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/comedy/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分喜剧片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/comedy/");}},
{type:"widget",id:"subject-biopic",title:"磁力熊 · 高分传记片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/biopic/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分传记片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/biopic/");}},
{type:"widget",id:"subject-romance",title:"磁力熊 · 高分爱情片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/romance/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分爱情片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/romance/");}},
{type:"widget",id:"subject-crime",title:"磁力熊 · 高分犯罪片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/crime/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分犯罪片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/crime/");}},
{type:"widget",id:"subject-horror",title:"磁力熊 · 高分恐怖片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/horror/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分恐怖片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/horror/");}},
{type:"widget",id:"subject-adventure",title:"磁力熊 · 高分冒险片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/adventure/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分冒险片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/adventure/");}},
{type:"widget",id:"subject-martial",title:"磁力熊 · 高分武侠片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/martial/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分武侠片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/martial/");}},
{type:"widget",id:"subject-fantasy",title:"磁力熊 · 高分奇幻片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/fantasy/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分奇幻片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/fantasy/");}},
{type:"widget",id:"subject-history",title:"磁力熊 · 高分历史片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/history/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分历史片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/history/");}},
{type:"widget",id:"subject-war",title:"磁力熊 · 高分战争片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/war/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分战争片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/war/");}},
{type:"widget",id:"subject-musical",title:"磁力熊 · 高分歌舞片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/musical/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分歌舞片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/musical/");}},
{type:"widget",id:"subject-disaster",title:"磁力熊 · 高分灾难片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/disaster/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分灾难片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/disaster/");}},
{type:"widget",id:"subject-erotic",title:"磁力熊 · 高分情色片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/erotic/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分情色片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/erotic/");}},
{type:"widget",id:"subject-west",title:"磁力熊 · 高分西部片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/west/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分西部片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/west/");}},
{type:"widget",id:"subject-music",title:"磁力熊 · 高分音乐片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/music/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分音乐片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/music/");}},
{type:"widget",id:"subject-sci-fi",title:"磁力熊 · 高分科幻片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/sci-fi/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分科幻片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/sci-fi/");}},
{type:"widget",id:"subject-action",title:"磁力熊 · 高分动作片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/action/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分动作片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/action/");}},
{type:"widget",id:"subject-animation",title:"磁力熊 · 高分动画片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/animation/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分动画片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/animation/");}},
{type:"widget",id:"subject-documentary",title:"磁力熊 · 高分纪录片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/documentary/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"高分纪录片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/documentary/");}},
{type:"widget",id:"subject-unpopular",title:"磁力熊 · 冷门佳片",template:"poster-grid",families:["medium","large"],headerIntent:"list",ref:{source:"custom",id:"cx:list:https://www.cilixiong.cc/s/unpopular/"},params:[],cache:{ttlSeconds:180},placeholderData:{items:[{ref:{source:"custom",id:"cx:detail:4768",mediaType:"movie"},title:"冷门佳片",subtitle:"站点直连，点击加载真实作品",images:{poster:"https://i.nacloud.cc/2025/06091.jpg",cover:"https://i.nacloud.cc/2025/06091.jpg"},intent:"detail"}]},load:function(ctx,input){return cxBrowse(ctx,input,"https://www.cilixiong.cc/s/unpopular/");}},
{type:"search",id:"search",title:"磁力熊搜索",params:[],cache:{ttlSeconds:60},search:cxSearch},
{type:"list",id:"list",title:"磁力熊列表",style:"grid",accepts:{sources:["custom"]},search:{id:"search"},cache:{ttlSeconds:180},load:cxList},
{type:"detail",id:"detail",title:"磁力熊详情",accepts:{sources:["custom"]},cache:{ttlSeconds:60},load:cxDetail},
{type:"playback",id:"playback",title:"磁力熊在线播放",accepts:{sources:["custom"]},cache:{ttlSeconds:0},sources:cxPlayback}
]});
