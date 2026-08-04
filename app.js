const TH={grid:'#E2E7ED',dim:'#71808F',mono:"'Inter',sans-serif",subject:'#0E2439',
  subjectRing:'#C4A45E',comp:'#8D9EB0',compOpacity:.7,
  palette:['#0E2439','#9C7C33','#4A6E92','#1B6B4F','#9C3328','#71808F','#5B7C99','#7A6A9C']};
const $=s=>document.querySelector(s);
let drill=null;


function seg(id,key,after){ const el=$(id);
  el.addEventListener('click',e=>{const b=e.target.closest('button'); if(!b)return;
    S[key]=b.dataset.v==='all'&&key==='win'?'all':(isNaN(b.dataset.v)?b.dataset.v:+b.dataset.v);
    [...el.children].forEach(x=>x.setAttribute('aria-pressed',x===b)); after&&after(); render();});
  [...el.children].forEach(x=>x.setAttribute('aria-pressed',String(S[key])===x.dataset.v));
}
seg('#segWin','win'); seg('#segStatus','status'); seg('#segTrend','trend');
seg('#segMode','mode',()=>{ $('#fpWrap').hidden=S.mode!=='floorplan'; if(S.mode!=='floorplan') S.fp='all'; drill=null; });
$('#selX').onchange=e=>{S.x=e.target.value;render()};
$('#selY').onchange=e=>{S.y=e.target.value;render()};
$('#selBeds').onchange=e=>{S.beds=e.target.value;render()};
$('#selFp').onchange=e=>{S.fp=e.target.value;render()};

function boot(){
  drill=null;
  const m=DB.meta[DB.subject]||{};
  $('#mkt').textContent=DB.market||'—';
  $('#asof').textContent=new Date(DB.asof+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  const beds=[...new Set(DB.units.map(u=>u.beds))].filter(v=>v!=null).sort((a,b)=>a-b);
  $('#selBeds').innerHTML='<option value="all">All</option>'+beds.map(b=>`<option value="${b}">${b===0?'Studio':b+' bd'}</option>`).join('');
  const fps=[...new Set(DB.units.filter(u=>u.prop===DB.subject).map(u=>u.fp))].sort();
  $('#selFp').innerHTML='<option value="all">All plans</option>'+fps.map(f=>`<option value="${f}">${f}</option>`).join('');
  $('#foot').textContent=`Subject: ${DB.subject}${m.yr?', built '+m.yr:''}${m.tot?', '+m.tot+' units':''}. Source: ApartmentIQ unit-level export. Effective rent is net of advertised concessions as reported by ApartmentIQ; concession rate is a trailing thirty-day leasing average and may differ from the spread on current listings. Trend lines are ordinary least squares fits across units plotted. Prepared for internal use.`;
  render(); refreshAI();
}

function render(){
  $('#winHint').textContent=windowHint();
  const units=activeUnits(), st=propStats(units);
  const sub=st[DB.subject], comps=Object.entries(st).filter(([p])=>p!==DB.subject).map(([,v])=>v);
  const cavg=k=>{const a=comps.map(c=>c[k]).filter(v=>v!=null); return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};

  const met=(k,v,d,inv)=>{const cls=d==null?'flat':(inv?(d<0?'up':'down'):(d>0?'up':'down'));
    return `<div class="met"><div class="k">${k}</div><div class="v">${v}</div>
      <div class="d ${cls}">${d==null?'—':(d>0?'+':'')+d.toFixed(1)+'% vs comps'}</div></div>`;};
  $('#band').innerHTML = sub ? [
    met('Effective rent',F.$(sub.eff),delta(sub.eff,cavg('eff'))),
    met('Effective PSF',F.psf(sub.epsf),delta(sub.epsf,cavg('epsf'))),
    met('Asking rent',F.$(sub.ask),delta(sub.ask,cavg('ask'))),
    met('Concession',F.pct(sub.conc),delta(sub.conc,cavg('conc')),true),
    met('Median days',F.d(sub.dom),delta(sub.dom,cavg('dom')),true),
    met('Units listed',F.n(sub.n),null)
  ].join('') : '<div class="met"><div class="k">Subject</div><div class="v">—</div></div>';

  $('#exTitle').textContent=`${AX[S.y].label} × ${AX[S.x].label.toLowerCase()}`;
  const r=drawScatter($('#chart'),TH);
  $('#plotCount').textContent=r?`${r.n} units · ${r.nSub} subject`:'';
  $('#legend').innerHTML = S.mode==='floorplan'
    ? `<span><span class="dot" style="background:${TH.subject}"></span>${DB.subject} floor plans</span>`
    : `<span><span class="dot" style="background:${TH.subject};box-shadow:0 0 0 2px ${TH.subjectRing}"></span>${DB.subject}</span>
       <span><span class="dot" style="background:${TH.comp}"></span>Comp set</span>
       <span><span class="sw" style="background:${TH.subject}"></span>Subject fit</span>
       <span><span class="sw" style="height:0;border-top:2px dashed ${TH.comp}"></span>Comp fit</span>`;
  if(r){
    const unit=S.x==='sqft'?'per sq. ft.':'per day';
    const sl=f=>f?`${AX[S.y].fmt(Math.abs(f.m))} ${unit} (R² ${f.r2.toFixed(2)}, n=${f.n})`:'—';
    let c=`${S.status==='avail'?'Units presently on the market':S.status==='new'?'Units newly listed in the window':S.status==='leased'?'Units leased within the window':'All units'}${S.beds!=='all'?`, ${S.beds==='0'?'studios':S.beds+'-bedroom only'}`:''}. `;
    if(r.fitS&&r.fitC&&S.mode==='property'){
      const gap=r.fitS.m-r.fitC.m;
      c+=`Subject fit ${sl(r.fitS)} vs. ${sl(r.fitC)} for the set — ${gap>=0?'steeper':'flatter'}.`;
    } else if(r.fitS) c+=`Fitted slope ${sl(r.fitS)}.`;
    $('#caption').textContent=c;
  } else $('#caption').textContent='';

  renderTable(units,st); renderSpecials(units);
  drawMap();
}

function renderTable(units,st){
  const T=$('#tbl'), A=$('#tblAction');
  if(drill){
    const set=units.filter(u=>u.prop===drill).sort((a,b)=>(a.beds-b.beds)||((b.eff??0)-(a.eff??0)));
    const m=DB.meta[drill]||{};
    $('#tblTitle').textContent=drill;
    A.innerHTML=`${set.length} units${m.yr?' · '+m.yr:''} &nbsp;<button class="mini" id="back">← Comp set</button>`;
    $('#back').onclick=()=>{drill=null;render()};
    const badge=s=>`<span class="st ${s==='Available'?'a':s==='Applied'?'p':'l'}">${s}</span>`;
    T.innerHTML=`<thead><tr><th>Unit</th><th>Plan</th><th>Bd/Ba</th><th>SF</th><th>Status</th><th>Listed</th>
      <th>Days</th><th>Ask</th><th>Eff.</th><th>PSF</th><th>Conc.</th></tr></thead><tbody>`+
      (set.length?set.map(u=>`<tr class="${drill===DB.subject?'subj':''}">
        <td>${u.unit||'—'}</td><td>${u.fp}</td><td>${u.beds}/${u.baths??'—'}</td><td>${F.n(u.sqft)}</td>
        <td>${badge(u.status)}</td><td>${u.dfa!=null?dayLabel(u.dfa):'—'}</td><td>${F.d(u.dom)}</td>
        <td>${F.$(u.ask)}</td><td>${F.$(u.eff)}</td><td>${u.sqft&&u.eff?F.psf(u.eff/u.sqft):'—'}</td>
        <td>${u.conc!=null?F.pct(u.conc):'—'}</td></tr>`).join('')
       :'<tr><td colspan="11" class="muted" style="text-align:center;padding:22px">No units match the current filters.</td></tr>')+'</tbody>';
    return;
  }
  if(S.mode==='floorplan'){
    $('#tblTitle').textContent=`${DB.subject} — floor plans`; A.textContent='';
    const fs=fpStats(units,DB.subject);
    T.innerHTML=`<thead><tr><th>Floor plan</th><th>Bd</th><th>Avg SF</th><th>Listed</th><th>Ask</th><th>Eff.</th><th>PSF</th><th>Days</th></tr></thead><tbody>`+
      Object.entries(fs).sort((a,b)=>b[1].epsf-a[1].epsf).map(([k,v])=>
      `<tr><td class="pname">${k}</td><td>${v.beds}</td><td>${F.n(v.sqft)}</td><td>${v.n}</td><td>${F.$(v.ask)}</td><td>${F.$(v.eff)}</td><td>${F.psf(v.epsf)}</td><td>${F.d(v.dom)}</td></tr>`).join('')+'</tbody>';
    return;
  }
  $('#tblTitle').textContent='Competitive set';
  A.textContent='Row for units · name to exclude';
  T.innerHTML=`<thead><tr><th>Property</th><th>Mi</th><th>Built</th><th>Units</th><th>Listed</th><th>Ask</th>
    <th>Eff.</th><th>PSF</th><th>Conc.</th><th>Expo.</th><th>Days</th></tr></thead><tbody>`+
    Object.entries(st).sort((a,b)=>b[1].epsf-a[1].epsf).map(([p,v])=>
    `<tr class="clik ${p===DB.subject?'subj':''} ${S.props.has(p)?'':'off'}" data-p="${p}">
      <td><span class="pname">${p}</span><span class="chev">›</span></td><td>${v.dist??'—'}</td><td>${v.yr||'—'}</td>
      <td>${v.tot||'—'}</td><td>${v.n}</td><td>${F.$(v.ask)}</td><td>${F.$(v.eff)}</td><td>${F.psf(v.epsf)}</td>
      <td>${F.pct(v.conc)}</td><td>${F.pct(v.exp)}</td><td>${F.d(v.dom)}</td></tr>`).join('')+'</tbody>';
  T.querySelectorAll('tbody tr.clik').forEach(tr=>tr.onclick=e=>{
    const p=tr.dataset.p;
    if(e.target.closest('.pname')){ S.props.has(p)?S.props.delete(p):S.props.add(p);
      if(!S.props.size) DB.props.forEach(x=>S.props.add(x)); render(); }
    else { drill=p; render(); }});
}

function renderSpecials(units){
  const board=concessionBoard(units);
  $('#specCount').textContent=`${board.filter(b=>(b.conc||0)>0.005).length} of ${board.length} offering`;
  $('#specTbl').innerHTML=`<thead><tr><th>Property</th><th>Rate</th><th>Wks</th><th>Spread/mo</th><th>Annual</th><th>Advertised offer</th></tr></thead><tbody>`+
    (board.length?board.map(b=>{
      const live=b.gapMo!=null&&b.gapMo>=1, stale=!live&&(b.conc||0)>0.02;
      return `<tr class="${b.isSubject?'subj':''}"><td><span class="pname">${b.prop}</span></td>
        <td>${b.conc!=null?(b.conc*100).toFixed(1)+'%':'—'}</td><td>${b.weeks!=null?b.weeks.toFixed(1):'—'}</td>
        <td class="${stale?'warn':''}">${live?F.$(b.gapMo):stale?'Not listed':'—'}</td>
        <td>${live?F.$(b.annual):'—'}</td>
        <td class="offer"><div class="clamp">${b.offer||'<span class="muted">None</span>'}</div><div class="more"></div></td></tr>`;}).join('')
     :'<tr><td colspan="6" class="muted" style="text-align:center;padding:22px">No properties in filter.</td></tr>')+'</tbody>';
  markTruncated();
}

/* Rows are a fixed height with the offer clamped to two lines. Only cells whose
   text actually overflows become clickable, so there is no dead affordance. */
function markTruncated(){
  requestAnimationFrame(()=>{
    document.querySelectorAll('#specTbl td.offer').forEach(td=>{
      const c=td.querySelector('.clamp'); if(!c) return;
      td.classList.remove('open');
      if(c.scrollHeight>c.clientHeight+1) td.classList.add('can');
      else td.classList.remove('can');
    });
  });
}
document.addEventListener('click',e=>{
  const td=e.target.closest('#specTbl td.offer.can'); if(!td) return;
  td.classList.toggle('open');
});

function refreshAI(){
  $('#ai').innerHTML='<div class="bul muted">Reading the market…</div>'; $('#aiNote').textContent='';
  runAI(buildBrief(), arr=>{ $('#ai').innerHTML=arr.map(b=>
    `<div class="bul"><span class="tg">${b.tag||'Note'}</span>${b.text}</div>`).join(''); },
    m=>{ $('#aiNote').textContent=m; });
}
$('#rerun').onclick=refreshAI;

/* ================= location map ================= */
let MAP=null, MAPLAYER=null, MAPKEY=null;
const GEO_ENDPOINT='/api/geocode';

function coordsFor(){
  const out=[];
  for(const p of DB.props){
    const m=DB.meta[p]||{};
    if(isFinite(m.lat)&&isFinite(m.lng)) out.push({prop:p, lat:+m.lat, lng:+m.lng, addr:m.addr||''});
  }
  return out;
}
function missingAddrs(){
  return DB.props.filter(p=>{const m=DB.meta[p]||{}; return m.addr && !(isFinite(m.lat)&&isFinite(m.lng));})
                 .map(p=>({prop:p, address:DB.meta[p].addr}));
}

function mapMsg(html){ const el=$('#mapMsg'); if(!html){el.classList.remove('on');el.innerHTML='';return;}
  el.innerHTML='<div class="in">'+html+'</div>'; el.classList.add('on'); }

function promptCity(err){
  mapMsg(`<p>Property locations aren't in the ApartmentIQ export. Enter the city and state to place them.</p>
    <input id="cityIn" placeholder="Colorado Springs, CO" value="${(DB.market||'').replace(/"/g,'&quot;')}">
    <button class="mini" id="cityGo" style="width:100%">Locate properties</button>
    ${err?`<div class="err">${err}</div>`:''}`);
  const go=$('#cityGo'), inp=$('#cityIn');
  inp.focus();
  const run=()=>doGeocode(inp.value.trim());
  go.onclick=run;
  inp.onkeydown=e=>{ if(e.key==='Enter') run(); };
}

/* Browser-side fallback when /api/geocode isn't reachable. Census only — no
   Nominatim, whose usage policy rules out unattended calls from a page. */
async function clientGeocode(city, items){
  const out={};
  for(const it of items){
    try{
      const u='https://geocoding.geo.census.gov/geocoders/locations/onelineaddress'
        +'?address='+encodeURIComponent(it.address+', '+city)
        +'&benchmark=Public_AR_Current&format=json';
      const r=await fetch(u);
      if(!r.ok){ out[it.prop]=null; continue; }
      const m=(await r.json())?.result?.addressMatches?.[0];
      out[it.prop]= m&&m.coordinates ? {lat:+m.coordinates.y, lng:+m.coordinates.x} : null;
    }catch(e){ out[it.prop]=null; }
  }
  return out;
}

async function doGeocode(city){
  if(!city){ promptCity('Enter a city and state, e.g. Colorado Springs, CO'); return; }
  const items=missingAddrs();
  if(!items.length){ drawMap(); return; }
  mapMsg(`<p>Locating ${items.length} propert${items.length===1?'y':'ies'} in ${city}…</p>`);
  try{
    let coords, found, total;
    try{
      const res=await fetch(GEO_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({city, items})});
      if(!res.ok){ let m=''; try{ m=(await res.json()).error||''; }catch(_){}
        throw new Error(m||('HTTP '+res.status)); }
      ({coords, found, total}=await res.json());
    }catch(serverErr){
      // No geocode function (e.g. previewing this file outside the deployed site).
      // Fall back to calling the Census geocoder straight from the browser.
      coords=await clientGeocode(city, items);
      total=items.length; found=Object.values(coords).filter(Boolean).length;
      if(!found) throw serverErr;
    }
    let hit=0;
    for(const p in coords){ if(coords[p]){ DB.meta[p]=DB.meta[p]||{};
      DB.meta[p].lat=coords[p].lat; DB.meta[p].lng=coords[p].lng; hit++; } }
    DB.market=city;
    if(!hit){ promptCity('No addresses matched in that city. Check the spelling or try "City, ST".'); return; }
    $('#mkt').textContent=city;
    if(CURKEY!==SAMPLE && STORE.available()){ await STORE.save(); await refreshIndex(); paintPicker(); }
    drawMap();
    if(found<total) $('#mapNote').textContent=`${found} of ${total} located`;
  }catch(e){ promptCity('Could not reach the location service. ('+e.message+')'); }
}

function drawMap(){
  const pts=coordsFor();
  if(!pts.length){
    if(missingAddrs().length) promptCity();
    else mapMsg('<p>No street addresses in this export, so the properties cannot be placed on a map.</p>');
    return;
  }
  if(typeof L==='undefined'){ mapMsg('<p>Map library unavailable.</p>'); return; }
  mapMsg('');
  if(!MAP){
    MAP=L.map('map',{scrollWheelZoom:false, attributionControl:true});
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO'}).addTo(MAP);
    MAP.on('click',()=>{});
  }
  if(MAPLAYER) MAPLAYER.remove();
  MAPLAYER=L.layerGroup().addTo(MAP);

  const st=propStats(activeUnits());
  for(const pt of pts){
    const isSub = pt.prop===DB.subject;
    const on = S.props.has(pt.prop);
    const icon = isSub
      ? L.divIcon({className:'', html:'<div class="pin-sub">&#9733;</div>', iconSize:[23,23], iconAnchor:[11,11]})
      : L.divIcon({className:'', html:`<div class="pin-cmp${on?'':' dim'}"></div>`, iconSize:[11,11], iconAnchor:[6,6]});
    const v=st[pt.prop]||{};
    const row=(k,val)=>`<div class="pop-r"><span>${k}</span><span>${val}</span></div>`;
    const m=L.marker([pt.lat,pt.lng],{icon, zIndexOffset:isSub?1000:0}).addTo(MAPLAYER);
    m.bindPopup(`<span class="pop-n ${isSub?'sub':''}">${pt.prop}</span>
      <span class="pop-a">${pt.addr}${v.dist!=null?' · '+v.dist+' mi':''}${v.yr?' · built '+v.yr:''}</span>
      ${row('Effective', F.$(v.eff))}${row('Eff. PSF', F.psf(v.epsf))}
      ${row('Concession', F.pct(v.conc))}${row('Listed', v.n??'—')}
      <button class="pop-b" data-drill="${encodeURIComponent(pt.prop)}">Unit detail</button>`);
  }
  MAP.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lng])),{padding:[26,26], maxZoom:14});
  setTimeout(()=>MAP.invalidateSize(),60);
  $('#mapNote').textContent=`${pts.length} located`;
}

/* popup button -> drill-down (popups are outside the table's listeners) */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-drill]'); if(!b) return;
  drill=decodeURIComponent(b.dataset.drill); if(MAP) MAP.closePopup(); render();
  document.getElementById('tbl').scrollIntoView({behavior:'smooth',block:'center'});
});

/* ================= saved surveys: picker, persistence, manage ================= */
const SAMPLE='__sample__';
let INDEX=[], CURKEY=SAMPLE;
const dayFmt=d=>new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

async function refreshIndex(){ INDEX = STORE.available() ? await STORE.getIndex() : []; }

/* The bundled sample is a first-run demo only. Once any survey is saved it is
   dropped from the list — otherwise loading an export for the sample property
   would show that name twice, once as demo and once as saved. */
function paintPicker(){
  const sel=$('#selSubject'), flag=$('#saveFlag');
  const saved=INDEX.some(e=>e.key===CURKEY);
  const showSample = !INDEX.length && !!DB.subject;
  const opts=INDEX.map(e=>`<option value="${e.key}">${e.subject}</option>`);
  if(showSample) opts.unshift(`<option value="${SAMPLE}">${DB.subject} (sample)</option>`);
  sel.innerHTML=opts.join('');
  sel.value = saved ? CURKEY : (showSample ? SAMPLE : (INDEX.length ? INDEX[0].key : ''));
  if(!STORE.available())      flag.textContent='Session only — storage unavailable';
  else if(!saved)             flag.textContent='Sample — not saved';
  else { const e=INDEX.find(x=>x.key===CURKEY);
         flag.textContent = e ? 'Saved '+dayFmt(e.savedAt) : ''; }
}

async function openSurvey(key){
  if(key===SAMPLE){ if(!PAYLOAD) return; loadPayload(PAYLOAD); CURKEY=SAMPLE; boot(); paintPicker(); return; }
  const p=await STORE.load(key);
  if(!p){ $('#aiNote').textContent='That saved survey could not be read. It may have been cleared.';
          await refreshIndex(); paintPicker(); return; }
  loadPayload(p); CURKEY=key; await STORE.remember(key); boot(); paintPicker();
}
$('#selSubject').onchange=e=>openSurvey(e.target.value);

/* manage panel */
const modal=$('#modal');
$('#btnManage').onclick=()=>{ paintManage(); modal.classList.add('on'); };
$('#mClose').onclick=()=>modal.classList.remove('on');
modal.onclick=e=>{ if(e.target===modal) modal.classList.remove('on'); };

function paintManage(){
  const L=$('#mList'), Ft=$('#mFoot');
  if(!STORE.available()){
    L.innerHTML='<div class="mempty">Saved surveys are unavailable in this view. Exports you load will apply to this session only.</div>';
    Ft.textContent=''; return;
  }
  if(!INDEX.length){
    L.innerHTML='<div class="mempty">No saved surveys yet. Load an ApartmentIQ export and it will be stored here under its subject property.</div>';
  } else {
    L.innerHTML=INDEX.map(e=>`<div class="mrow ${e.key===CURKEY?'cur':''}">
      <div class="i"><div class="n">${e.subject}</div>
        <div class="s">${e.market||'—'} · ${e.props} properties · ${e.units.toLocaleString()} units · data as of ${e.asof} · saved ${dayFmt(e.savedAt)}</div></div>
      <div class="act"><button class="mini" data-open="${e.key}">Open</button>
        <button class="mini" data-del="${e.key}">Delete</button></div></div>`).join('');
  }
  Ft.textContent=`${INDEX.length} survey${INDEX.length===1?'':'s'} stored. Re-loading an export for the same property replaces its saved copy, so a weekly refresh overwrites rather than duplicates.`;
  L.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{
    modal.classList.remove('on'); await openSurvey(b.dataset.open); });
  L.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    if(b.dataset.armed!=='1'){ b.dataset.armed='1'; b.textContent='Confirm'; b.style.color='#9C3328'; b.style.borderColor='#9C3328';
      setTimeout(()=>{ if(b.isConnected&&b.dataset.armed==='1'){b.dataset.armed='0';b.textContent='Delete';b.style.color='';b.style.borderColor='';} },3500);
      return; }
    const k=b.dataset.del;
    await STORE.remove(k); await refreshIndex();
    if(CURKEY===k){                       // fall through to the next saved survey, not the demo
      if(INDEX.length) await openSurvey(INDEX[0].key);
      else if(PAYLOAD){ loadPayload(PAYLOAD); CURKEY=SAMPLE; boot(); }
    }
    paintPicker(); paintManage(); });
}

/* upload */
$('#btnUp').onclick=()=>$('#file').click();
$('#file').onchange=e=>{const f=e.target.files[0]; if(f) ingest(f); e.target.value='';};
const dz=$('#drop'); let dc=0;
addEventListener('dragenter',e=>{e.preventDefault();dc++;dz.classList.add('on')});
addEventListener('dragleave',e=>{e.preventDefault();if(--dc<=0)dz.classList.remove('on')});
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',e=>{e.preventDefault();dc=0;dz.classList.remove('on');const f=e.dataTransfer.files[0]; if(f) ingest(f);});
function ingest(file){
  dz.textContent='Reading '+file.name+'…'; dz.classList.add('on');
  const rd=new FileReader();
  rd.onload=async ev=>{
    try{
      const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'});
      const r=parseWorkbook(wb);
      dz.classList.remove('on');
      const res=await STORE.save();
      await refreshIndex();
      CURKEY = res.ok ? res.key : SAMPLE;
      boot(); paintPicker();
      $('#aiNote').textContent = res.ok
        ? `Loaded ${r.units.toLocaleString()} units across ${r.props} properties. Saved as “${DB.subject}” — ${res.count} survey${res.count===1?'':'s'} stored.`
        : `Loaded ${r.units.toLocaleString()} units across ${r.props} properties. ${res.reason} This session only.`;
    }catch(err){ dz.textContent=err.message; setTimeout(()=>dz.classList.remove('on'),4200); }
  };
  rd.readAsArrayBuffer(file);
}
addEventListener('keydown',e=>{ if(e.key==='Escape'){ if(modal.classList.contains('on')) modal.classList.remove('on');
  else if(drill){drill=null;render();} } });
addEventListener('resize',()=>render());

/* boot: render the sample instantly, then restore the last survey if one exists */
let PAYLOAD=null;

async function loadSample(){
  try{ const r=await fetch('assets/sample.json',{cache:'no-cache'});
       if(!r.ok) throw new Error('HTTP '+r.status);
       PAYLOAD=await r.json(); return true; }
  catch(e){ return false; }
}

function emptyState(msg){
  document.querySelector('.grid').innerHTML=
    `<div class="g12" style="padding:60px 0;text-align:center">
       <div style="font:400 19px var(--serif);color:var(--ink2)">${msg}</div>
       <div style="font:400 13px var(--sans);color:var(--dim);margin-top:9px">
         Use <strong>Load export</strong> above, or drag an ApartmentIQ .xlsx anywhere onto this page.</div></div>`;
  document.getElementById('band').innerHTML='';
}

(async function init(){
  await STORE.probe();
  await refreshIndex();
  const last=await STORE.lastKey();
  if(last && INDEX.some(e=>e.key===last)){ await openSurvey(last); await loadSample(); paintPicker(); return; }
  if(INDEX.length){ await openSurvey(INDEX[0].key); await loadSample(); paintPicker(); return; }
  if(await loadSample()){ loadPayload(PAYLOAD); CURKEY=SAMPLE; boot(); }
  else emptyState('No survey loaded yet.');
  paintPicker();
})();
