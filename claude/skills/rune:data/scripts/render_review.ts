#!/usr/bin/env -S deno run -A
// render_review.ts — turn a rune:data design into a data-structure view a human
// can actually read. Deterministic: same data.json in → same HTML out.
//
// It leads with the DESTINATION, not the decision machinery: a storage map
// (what lives in Firestore vs Deno KV vs a local SQLite file vs S3 for large
// files) and a concrete example record per entity
// — the literal shape of a stored document, with the append-only collection
// drawn out so "new objects, never edits" is visible at a glance. One plain
// sentence of why per record, and a notes box per entity for a second pass.
//
// Reads entity.document (an example stored record) when present; falls back to a
// shape built from key/dto/immutability when it isn't.
//
// Usage: deno run -A render_review.ts spec/misc/data.json [out.html]
//   (default out is data.review.html beside the input — i.e. spec/misc/data.review.html)

async function main() {
  const [dataPath, outArg] = Deno.args;
  if (!dataPath) { console.error("usage: render_review.ts spec/misc/data.json [out.html]"); Deno.exit(2); }
  const doc = JSON.parse(await Deno.readTextFile(dataPath));
  const out = outArg ?? dataPath.replace(/[^/]*$/, "") + "data.review.html";
  await Deno.writeTextFile(out, PAGE.replace("/*__DATA__*/", JSON.stringify(doc)));
  console.log(`✓ wrote ${out}`);
  console.log(`  open it:  open ${out}`);
}

const PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>rune:data — data structure</title>
<style>
:root{--bg:#0f1115;--panel:#161922;--p2:#1c2029;--ink:#e9edf3;--mut:#98a2b3;--line:#2a3040;
--fire:#ff9f1c;--fireb:#3a2c12;--kv:#36c46b;--kvb:#12301d;--acc:#6ea8fe;--warn:#ffd166;
--sql:#5ad1e0;--sqlb:#0e2a30;--s3:#ff7a85;--s3b:#371518;--fsj:#c08cff;--fsjb:#241634;
--key:#ffcd7b;--str:#7ee0a0;--num:#86b7ff;}
*{box-sizing:border-box}
body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto;background:var(--bg);color:var(--ink)}
header{padding:22px 30px;background:#0b0d11;border-bottom:1px solid var(--line)}
header h1{margin:0;font-size:18px;font-weight:700}
header .lede{margin:8px 0 0;color:var(--mut);font-size:14px;max-width:760px}
main{max-width:900px;margin:0 auto;padding:26px 22px 90px}
.sec{font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--mut);margin:26px 0 12px}
/* storage map */
.map{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.store{border-radius:13px;padding:16px;border:1px solid var(--line)}
.store.fs{background:linear-gradient(180deg,var(--fireb),transparent 70%);border-color:#5a4014}
.store.kv{background:linear-gradient(180deg,var(--kvb),transparent 70%);border-color:#1c4d30}
.store.sql{background:linear-gradient(180deg,var(--sqlb),transparent 70%);border-color:#1c4d52}
.store.s3{background:linear-gradient(180deg,var(--s3b),transparent 70%);border-color:#5a2228}
.store.fsj{background:linear-gradient(180deg,var(--fsjb),transparent 70%);border-color:#3d2a5c}
.store h3{margin:0 0 4px;font-size:14px;display:flex;align-items:center;gap:8px}
.store .sub{color:var(--mut);font-size:12px;margin-bottom:10px}
.store.fs h3 .d{color:var(--fire)} .store.kv h3 .d{color:var(--kv)} .store.sql h3 .d{color:var(--sql)} .store.s3 h3 .d{color:var(--s3)} .store.fsj h3 .d{color:var(--fsj)}
.path{font-family:ui-monospace,Menlo,monospace;font-size:13px;padding:6px 0;border-top:1px solid var(--line)}
.path:first-of-type{border-top:none}
.path .n{color:var(--ink)} .path .why{color:var(--mut);font-size:12px;font-family:system-ui}
.empty{color:var(--mut);font-size:13px;font-style:italic}
/* record card */
.rec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:0;margin-bottom:18px;overflow:hidden}
.rec .head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.rec .name{font-weight:700;font-size:16px}
.badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px}
.badge.fs{background:var(--fireb);color:var(--fire);border:1px solid #5a4014}
.badge.kv{background:var(--kvb);color:var(--kv);border:1px solid #1c4d30}
.badge.sql{background:var(--sqlb);color:var(--sql);border:1px solid #1c4d52}
.badge.s3{background:var(--s3b);color:var(--s3);border:1px solid #5a2228}
.badge.fsj{background:var(--fsjb);color:var(--fsj);border:1px solid #3d2a5c}
.badge.blob{background:var(--s3b);color:var(--s3);border:1px solid #5a2228}
.badge.localfile{background:var(--fsjb);color:var(--fsj);border:1px solid #3d2a5c}
.badge.mirror{background:#10243f;color:var(--acc);border:1px solid #234668}
.badge.perm{background:#10261a;color:#7ee0a0;border:1px solid #1c4d30}
.badge.ttl{background:#2c2410;color:var(--warn);border:1px solid #5a4a14}
.rec .purpose{padding:13px 18px 0;font-size:14.5px;color:var(--ink)}
.used{margin:12px 18px 2px}
.used .lbl{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--mut);margin-bottom:7px}
.urow{display:flex;align-items:baseline;gap:9px;padding:4px 0;font-size:13.5px}
.utag{flex:0 0 auto;font-size:11px;font-weight:700;font-family:ui-monospace,Menlo,monospace;padding:2px 8px;border-radius:6px}
.utag.endpoint{background:#10243f;color:var(--acc);border:1px solid #234668}
.utag.screen{background:#241033;color:#c79bff;border:1px solid #432068}
.urow .does{color:var(--mut)}
.rec .why{padding:6px 18px 0;color:var(--mut);font-size:13px}
.rec .why b{color:#b9c1d0;font-weight:600}
pre.doc{margin:14px 18px;background:#0c0e13;border:1px solid var(--line);border-radius:10px;
padding:14px 16px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:13px;line-height:1.7}
.k{color:var(--key)} .s{color:var(--str)} .nm{color:var(--num)} .p{color:#8a93a6}
.ann{color:var(--warn);font-style:italic}
.read{margin:0 18px 14px;font-size:13px;color:var(--mut)}
.read b{color:var(--ink);font-weight:600}
.imnote{margin:0 18px 16px;background:#0c0e13;border-left:3px solid var(--warn);border-radius:0 8px 8px 0;
padding:10px 14px;font-size:13px;color:#d6dbe6}
.imnote.ok{border-color:var(--kv)} .imnote b{color:var(--ink)}
.notes{margin:0 18px 18px}
.notes label{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--mut)}
.notes textarea{width:100%;min-height:46px;margin-top:6px;background:#0c0e13;border:1px solid var(--line);
color:var(--ink);border-radius:9px;padding:9px;font:13px system-ui;resize:vertical}
.assume{background:#161922;border:1px solid #5a4014;border-radius:11px;padding:12px 16px;margin-top:14px}
.assume b{color:var(--warn)} .assume div{color:var(--mut);font-size:13px;margin-top:3px}
.foot{position:fixed;left:0;right:0;bottom:0;background:#0b0d11;border-top:1px solid var(--line);
padding:12px 30px;display:flex;justify-content:space-between;align-items:center}
.foot button{background:var(--acc);border:none;color:#08111f;font-weight:700;padding:9px 18px;border-radius:9px;cursor:pointer}
.foot .m{color:var(--mut);font-size:13px}
</style></head><body>
<header><h1>rune:data — <span id="mod"></span> · data structure</h1>
<p class="lede" id="lede"></p></header>
<main id="root"></main>
<div class="foot"><span class="m">Jot what you'd change under any record, then save for a second pass.</span>
<button onclick="saveNotes()">⬇ Save notes</button></div>
<script>
const DOC = /*__DATA__*/;
const notes = {};
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function storeName(s){return s==='firestore'?'Firestore':s==='denokv'?'Deno KV':s==='sqlite'?'SQLite':s==='fs_json'?'JSON file':s==='s3'?'S3':s;}
function badgeCls(s){return s==='firestore'?'fs':s==='denokv'?'kv':s==='sqlite'?'sql':s==='fs_json'?'fsj':s==='s3'?'s3':'';}
// a compact header chip for an entity's retention: kept forever vs expires after N
function retBadge(ret){
  if(!ret||!ret.policy) return '';
  if(ret.policy==='permanent') return '<span class="badge perm">∞ kept forever</span>';
  const verb=ret.policy==='purge-after'?'purge after':'expires in';
  return '<span class="badge ttl">⏱ '+esc(verb+' '+(ret.ttl||'?'))+'</span>';
}

// pretty-print an example record as colored, indented lines; annotate the
// append-only collection's opening line with "appended — never edited".
function prettyDoc(val, appendKey){
  const lines=[];
  function walk(v,ind,key){
    const pad='  '.repeat(ind);
    if(Array.isArray(v)){
      const ann = key && key===appendKey ? '  <span class="ann">// append-only — old entries never change</span>' : '';
      lines.push(pad+'<span class="p">[</span>'+ann);
      v.forEach((it,i)=>{ walk(it,ind+1); if(i<v.length-1) lines[lines.length-1]+='<span class="p">,</span>'; });
      lines.push(pad+'<span class="p">]</span>');
    } else if(v&&typeof v==='object'){
      lines.push(pad+'<span class="p">{</span>');
      const ks=Object.keys(v);
      ks.forEach((k,i)=>{
        const before=lines.length;
        walkKV(k,v[k],ind+1);
        if(i<ks.length-1) lines[lines.length-1]+='<span class="p">,</span>';
        void before;
      });
      lines.push(pad+'<span class="p">}</span>');
    } else lines.push(pad+scalar(v));
  }
  function walkKV(k,v,ind){
    const pad='  '.repeat(ind);
    if(Array.isArray(v)){
      const ann = k===appendKey ? '  <span class="ann">// append-only — old entries never change</span>' : '';
      lines.push(pad+'<span class="k">'+esc(k)+'</span><span class="p">:</span> <span class="p">[</span>'+ann);
      v.forEach((it,i)=>{ walk(it,ind+1); if(i<v.length-1) lines[lines.length-1]+='<span class="p">,</span>'; });
      lines.push(pad+'<span class="p">]</span>');
    } else if(v&&typeof v==='object'){
      lines.push(pad+'<span class="k">'+esc(k)+'</span><span class="p">:</span> <span class="p">{</span>');
      const ks=Object.keys(v);
      ks.forEach((kk,i)=>{ walkKV(kk,v[kk],ind+1); if(i<ks.length-1) lines[lines.length-1]+='<span class="p">,</span>'; });
      lines.push(pad+'<span class="p">}</span>');
    } else lines.push(pad+'<span class="k">'+esc(k)+'</span><span class="p">:</span> '+scalar(v));
  }
  function scalar(v){
    if(typeof v==='string') return '<span class="s">"'+esc(v)+'"</span>';
    if(typeof v==='number'||typeof v==='boolean'||v===null) return '<span class="nm">'+esc(v)+'</span>';
    return esc(v);
  }
  walk(val,0);
  return lines.join('\n');
}

// fallback example doc when the design didn't include one
function fallbackDoc(e){
  const d={}; (e.key? d.id = (e.name||'rec')+'_001' : 0);
  const im=e.immutability||{};
  if(im.strategy==='append-child'&&im.collection){
    d[im.collection.name]=[Object.fromEntries((im.collection.childShape||['kind','at']).map(f=>[f, f==='at'?'2026-01-01T00:00:00Z':f==='kind'?(im.collection.appendTriggers||['created'])[0]:'…']))];
  }
  return d;
}

function render(){
  document.getElementById('mod').textContent=DOC.module||'(module)';
  const ents=DOC.entities||[];
  const fs=ents.filter(e=>e.store==='firestore'), kv=ents.filter(e=>e.store==='denokv'), sq=ents.filter(e=>e.store==='sqlite'), fsj=ents.filter(e=>e.store==='fs_json'), s3=ents.filter(e=>e.store==='s3');
  const proj=ents.flatMap(e=>(e.projections||[]).map(p=>({...p,owner:e.name})));
  const blobs=ents.flatMap(e=>(e.blobs||[]).map(b=>({...b,owner:e.name})));
  // a blob is local when store==='fs' (a file on disk via the native fs boundary); else S3 (incl. omitted, the default)
  const s3Blobs=blobs.filter(b=>b.store!=='fs'), localBlobs=blobs.filter(b=>b.store==='fs');
  const hasAppend=ents.some(e=>(e.immutability||{}).strategy==='append-child');
  // plain-language lede
  const parts=[];
  parts.push(ents.length+' record '+(ents.length===1?'type':'types')+'. ');
  const byStore=[];
  if(fs.length) byStore.push(fs.map(e=>e.name).join(' & ')+' '+(fs.length>1?'live':'lives')+' in Firestore (you list & query them)');
  if(kv.length) byStore.push(kv.map(e=>e.name).join(' & ')+' in Deno KV');
  if(sq.length) byStore.push(sq.map(e=>e.name).join(' & ')+' '+(sq.length>1?'live':'lives')+' in one local SQLite file (list & by-id from one engine)');
  if(fsj.length) byStore.push(fsj.map(e=>e.name).join(' & ')+' '+(fsj.length>1?'live':'lives')+' in one local JSON file (loaded, edited, written back — for a small project)');
  if(s3.length) byStore.push(s3.map(e=>e.name).join(' & ')+' '+(s3.length>1?'live':'lives')+' in S3 (large files)');
  if(byStore.length) parts.push(byStore.join('; ')+'.');
  if(proj.length) parts.push(' '+proj.length+' fast lookup '+(proj.length>1?'mirrors':'mirror')+' for by-id reads.');
  if(s3Blobs.length) parts.push(' '+s3Blobs.length+' file '+(s3Blobs.length>1?'fields are':'field is')+' offloaded to S3 (e.g. <b>'+esc(s3Blobs[0].field||'file')+'</b>) — bytes in a bucket, a reference in the record.');
  if(localBlobs.length) parts.push(' '+localBlobs.length+' large file '+(localBlobs.length>1?'fields are':'field is')+' kept as local sidecar files beside the store (e.g. <b>'+esc(localBlobs[0].field||'file')+'</b>) — bytes on disk, a path in the record.');
  const ttlN=ents.filter(e=>{const r=e.retention||{};return r.policy==='ttl'||r.policy==='purge-after';}).length;
  if(ttlN) parts.push(' '+ttlN+' '+(ttlN>1?'records expire':'record expires')+' on a <b>TTL</b>; the rest are kept permanently.');
  if(hasAppend) parts.push(' Changes are <b>appended as new entries</b>, never edited in place.');
  document.getElementById('lede').innerHTML=parts.join('');

  const root=document.getElementById('root');
  // STORAGE MAP — one column per store actually used (local-only => a single SQLite column)
  const STORE_DEFS={
    firestore:{cls:'fs',label:'Firestore',sub:'documents you list, filter & sort',dft:e=>e.name+'s/{id}'},
    denokv:{cls:'kv',label:'Deno KV',sub:'instant lookups by a known key',dft:e=>e.name+':{id}'},
    sqlite:{cls:'sql',label:'SQLite',sub:'one local file — relational queries & lookups',dft:e=>e.name},
    fs_json:{cls:'fsj',label:'JSON file',sub:'one flat file on disk — loaded, edited, saved (small projects)',dft:e=>e.name+'[]'},
    s3:{cls:'s3',label:'S3',sub:'large files & binary blobs (a reference lives in a record)',dft:e=>e.name+'/{id}'},
  };
  const usedStores=['firestore','denokv','sqlite','fs_json','s3'].filter(s=>ents.some(e=>e.store===s)||proj.some(p=>p.store===s)||(s==='s3'&&s3Blobs.length));
  const cols=usedStores.length?usedStores:['firestore','denokv'];
  let map='<div class="sec">Where it lives</div><div class="map" style="grid-template-columns:repeat('+cols.length+',1fr)">';
  for(const sid of cols){
    const def=STORE_DEFS[sid]||{cls:'',label:storeName(sid),sub:'',dft:e=>e.name};
    map+='<div class="store '+def.cls+'"><h3><span class="d">●</span> '+esc(def.label)+'</h3><div class="sub">'+esc(def.sub)+'</div>';
    const rows=[
      ...ents.filter(e=>e.store===sid).map(e=>({k:e.key||def.dft(e),why:''})),
      ...proj.filter(p=>p.store===sid).map(p=>({k:p.key||p.name,why:'mirror of '+p.owner})),
      ...(sid==='s3'?s3Blobs.map(b=>({k:b.key||(b.owner+'/'+(b.field||'file')+'/{id}'),why:b.owner+'.'+(b.field||'file')})):[]),
      ...localBlobs.filter(b=>(ents.find(e=>e.name===b.owner)||{}).store===sid).map(b=>({k:b.key||(b.owner+'/'+(b.field||'file')),why:b.owner+'.'+(b.field||'file')+' — local file'})),
    ];
    if(rows.length) rows.forEach(r=>map+='<div class="path"><span class="n">'+esc(r.k)+'</span>'+(r.why?' <span class="why">— '+esc(r.why)+'</span>':'')+'</div>');
    else map+='<div class="empty">nothing here</div>';
    map+='</div>';
  }
  map+='</div>';
  root.insertAdjacentHTML('beforeend',map);

  // RECORDS
  root.insertAdjacentHTML('beforeend','<div class="sec">What each record looks like</div>');
  ents.forEach(e=>{
    const im=e.immutability||{};
    const example = e.document || fallbackDoc(e);
    const appendKey = im.strategy==='append-child' ? (im.collection||{}).name : null;
    let h='<div class="rec"><div class="head"><span class="name">'+esc(e.name)+'</span>';
    h+='<span class="badge '+badgeCls(e.store)+'">'+storeName(e.store)+'</span>';
    (e.projections||[]).forEach(p=>h+='<span class="badge mirror">+ '+storeName(p.store)+' copy</span>');
    const eS3=(e.blobs||[]).filter(b=>b.store!=='fs'), eLocal=(e.blobs||[]).filter(b=>b.store==='fs');
    if(eS3.length) h+='<span class="badge blob">+ '+(eS3.length>1?eS3.length+' files in S3':'file in S3')+'</span>';
    if(eLocal.length) h+='<span class="badge localfile">+ '+(eLocal.length>1?eLocal.length+' local files':'local file')+'</span>';
    h+=retBadge(e.retention);
    h+='</div>';
    if(e.purpose)h+='<div class="purpose">'+esc(e.purpose)+'</div>';
    h+='<pre class="doc">'+prettyDoc(example,appendKey)+'</pre>';
    if(eS3.length)
      h+='<div class="read"><b>Files in S3:</b> '+eS3.map(b=>esc(b.field||'file')+' → <span class="p">'+esc(b.key||'(key)')+'</span>').join(', ')+' — bytes in a bucket, this record keeps only the reference.</div>';
    if(eLocal.length)
      h+='<div class="read"><b>Local files:</b> '+eLocal.map(b=>esc(b.field||'file')+' → <span class="p">'+esc(b.key||'(path)')+'</span>').join(', ')+' — bytes in a file on disk beside the store, this record keeps only the path.</div>';
    if(im.currentStateOnRead && appendKey)
      h+='<div class="read"><b>Reading it:</b> '+esc(im.currentStateOnRead)+'</div>';
    if((e.usedBy||[]).length){
      h+='<div class="used"><div class="lbl">Used by</div>';
      e.usedBy.forEach(u=>{const kind=u.kind==='screen'?'screen':'endpoint';
        h+='<div class="urow"><span class="utag '+kind+'">'+esc(u.by)+'</span><span class="does">'+esc(u.does||'')+'</span></div>';});
      h+='</div>';
    }
    if(e.rationale)h+='<div class="why"><b>Why '+storeName(e.store)+':</b> '+esc(e.rationale)+'</div>';
    // immutability one-liner, concrete
    if(im.strategy==='append-child'){
      const c=im.collection||{};const trig=(c.appendTriggers||[]);
      h+='<div class="imnote"><b>Immutable:</b> each change ('+esc(trig.join(', '))+') pushes a new '+
        esc(c.name)+' entry. Completing then reopening keeps the whole trail — naive code would overwrite the record and lose it.</div>';
    } else if(im.strategy==='already-immutable'){
      h+='<div class="imnote ok"><b>Immutable:</b> written once when created, never edited afterward.</div>';
    } else if(im.strategy==='aggregate'){
      h+='<div class="imnote ok"><b>Counter:</b> a derived number, updated atomically in place — no history kept (none needed).</div>';
    } else if(im.strategy==='overwrite-justified'){
      h+='<div class="imnote"><b>Overwrites in place:</b> '+esc(im.why||'(reason not given)')+'</div>';
    }
    // retention one-liner: how long it lives, and the mechanism that enforces it
    const ret=e.retention;
    if(ret&&ret.policy){
      const mech=ret.mechanism&&ret.mechanism!=='none'?' <span class="p">('+esc(ret.mechanism)+')</span>':'';
      if(ret.policy==='permanent')
        h+='<div class="imnote ok"><b>Kept forever:</b> no TTL — '+esc(ret.why||'permanent record')+'.</div>';
      else
        h+='<div class="imnote"><b>'+(ret.policy==='purge-after'?'Purged':'Expires')+' after '+esc(ret.ttl||'?')+':</b>'+mech+' '+esc(ret.why||'')+'</div>';
    }
    h+='<div class="notes"><label>Notes for a second pass</label>'+
       '<textarea data-e="'+esc(e.name)+'" placeholder="what would you change about how '+esc(e.name)+' is stored?"></textarea></div>';
    h+='</div>';
    root.insertAdjacentHTML('beforeend',h);
  });

  // ASSUMPTIONS / open questions
  const notesArr=(DOC.notes||[]).filter(n=>/assumption|inferred|prototype|implied|add /i.test(n));
  const gf=DOC.generatedFrom||{};
  if(!gf.prototype || notesArr.length){
    let h='<div class="assume"><b>⚠ Worth a look before building</b>';
    if(!gf.prototype) h+='<div>No UI prototype was provided, so read patterns (and a store choice or two) are inferred — confirm against the real screens.</div>';
    notesArr.forEach(n=>h+='<div>· '+esc(n)+'</div>');
    h+='</div>';
    root.insertAdjacentHTML('beforeend',h);
  }

  document.querySelectorAll('textarea[data-e]').forEach(t=>t.addEventListener('input',()=>notes[t.dataset.e]=t.value.trim()));
}
function saveNotes(){
  const out={module:DOC.module,notes:Object.fromEntries(Object.entries(notes).filter(([,v])=>v))};
  const b=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=(DOC.module||'data')+'.data.notes.json';a.click();
  alert('Saved '+(DOC.module||'data')+'.data.notes.json to Downloads — tell Claude it is ready.');
}
render();
</script></body></html>`;

if (import.meta.main) await main();
