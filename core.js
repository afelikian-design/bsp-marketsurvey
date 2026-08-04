/* ===== ApartmentIQ Market Dashboard — shared engine ===================== */
const EPOCH = Date.UTC(2020,0,1);
const STATUS = ['Available','Applied','Leased'];
const DB = { props:[], fps:[], units:[], meta:{}, subject:null, asof:null, market:'', src:'' };
const S = {           // UI state
  win: 30, mode:'property', status:'avail', beds:'all',
  x:'sqft', y:'ask', trend:'both', props:new Set(), fp:'all'
};

/* ---------- load embedded payload ---------- */
function loadPayload(p){
  DB.props = p.props; DB.fps = p.fps; DB.meta = p.meta; DB.subject = p.subject;
  DB.asof = p.asof; DB.market = p.market||''; DB.src = p.src||'';
  DB.units = p.rows.map(r=>({
    prop:p.props[r[0]], fp:p.fps[r[1]], unit:r[2], beds:r[3], baths:r[4], sqft:r[5],
    status: typeof r[6]==='number' ? STATUS[r[6]] : r[6],
    dfa:r[7], lsd:r[8], dom:r[9], listed:r[10], ask:r[11], eff:r[12], conc:r[13]
  }));
  S.props=new Set(); DB.props.forEach(x=>S.props.add(x));
  S.fp='all';
}

/* Inverse of loadPayload — compact array-of-arrays for storage. Unknown status
   strings are kept verbatim rather than coerced to an index. */
function encodePayload(){
  const pi={}, fi={};
  DB.props.forEach((p,i)=>pi[p]=i); DB.fps.forEach((f,i)=>fi[f]=i);
  return { props:DB.props, fps:DB.fps, meta:DB.meta, subject:DB.subject, asof:DB.asof,
    market:DB.market, src:DB.src,
    rows: DB.units.map(u=>{ const si=STATUS.indexOf(u.status);
      return [pi[u.prop], fi[u.fp], u.unit, u.beds, u.baths, u.sqft, si>=0?si:u.status,
              u.dfa, u.lsd, u.dom, u.listed, u.ask, u.eff, u.conc]; }) };
}


/* ---------- parse an uploaded ApartmentIQ workbook ---------- */
function num(v){ if(v===''||v==null) return null; const n=+String(v).replace(/[$,%\s]/g,''); return isFinite(n)?n:null; }
function mdy(v){
  if(!v) return null;
  if(typeof v==='number'){ const d=new Date(Date.UTC(1899,11,30)+v*864e5); return Math.round((d-EPOCH)/864e5); }
  const m=String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m) return null;
  return Math.round((Date.UTC(+m[3],+m[1]-1,+m[2])-EPOCH)/864e5);
}
function findSheet(wb, want){
  const k = wb.SheetNames.find(n=>n.toLowerCase().trim()===want.toLowerCase());
  return k ? wb.Sheets[k] : null;
}
function parseWorkbook(wb){
  const uls = findSheet(wb,'Unit Level Data');
  if(!uls) throw new Error("This workbook has no “Unit Level Data” tab. Export the full market file from ApartmentIQ rather than a single-tab view.");

  // header sits on the 3rd row of every AIQ export
  const recs = XLSX.utils.sheet_to_json(uls,{range:2,defval:null});
  const col = (r,...names)=>{ for(const n of names){ for(const k in r){ if(k.replace(/\s+/g,' ').trim().toLowerCase()===n) return r[k]; } } return null; };
  const units=[];
  for(const r of recs){
    const prop = col(r,'property'); if(!prop) continue;
    units.push({
      prop:String(prop).trim(), fp:String(col(r,'floor plan')??'—').trim(), unit:String(col(r,'unit number')??'').trim(),
      beds:num(col(r,'bed count')), baths:num(col(r,'bath count')), sqft:num(col(r,'sq ft')),
      status:String(col(r,'unit status')??'').trim(),
      dfa:mdy(col(r,'date first available')), lsd:mdy(col(r,'leased date')),
      dom:num(col(r,'days on market')), listed:num(col(r,'times listed')),
      ask:num(col(r,'asking rent')), eff:num(col(r,'eff rent')),
      conc:num(col(r,'avg concession %'))
    });
  }
  if(!units.length) throw new Error('Found the Unit Level Data tab but no unit rows in it.');

  // property attributes — snapshot block only. AIQ stacks re-sorted ranking
  // blocks underneath it in the same columns, so stop at "Average".
  const meta={}; let subject=null;
  const vms = findSheet(wb,'Visual Market Survey');
  if(vms){
    for(const r of XLSX.utils.sheet_to_json(vms,{range:6,defval:null})){
      const n = r['Property Name']; if(!n || String(n).trim()==='Average') break;
      const d = num(r['Distance']);
      if(d===0) subject=String(n).trim();
      meta[String(n).trim()]={ dist:d, yr:num(r['Year Built']), tot:num(r['Total Units']),
        exp:num(r['Exposure %']), lsd:num(r['Leased %']), pre:num(r['Pre-Leased %']),
        conc:num(r['Concession %']), a7:num(r['Applications Last 7 Days']),
        a30:num(r['Applications Last 30 Days']), av:num(r['Total Avail. Units']), vac:num(r['Vacant Units']) };
    }
  }
  // concession language + reviews from the Market Survey grid (first occurrence wins)
  const msh = findSheet(wb,'Market Survey');
  if(msh){
    const grid = XLSX.utils.sheet_to_json(msh,{header:1,range:2,defval:null});
    const hdr=(grid[0]||[]).map(x=>x==null?'':String(x).trim()); const seen=new Set();
    for(const row of grid){
      const lbl=String(row[0]??'').trim();
      if(!['Concession Details','Reviews'].includes(lbl)||seen.has(lbl)) continue;
      seen.add(lbl);
      row.forEach((v,j)=>{ if(j<2||!hdr[j]||v==null||v==='') return;
        meta[hdr[j]] = meta[hdr[j]]||{};
        if(lbl==='Reviews') meta[hdr[j]].rev=num(v); else meta[hdr[j]].cd=String(v).trim(); });
    }
  }
  // street address per property (city/state are not in the export — user-supplied)
  const addrOf={};
  for(const r of recs){
    const p=col(r,'property'), a=col(r,'address');
    if(p && a && !addrOf[String(p).trim()]) addrOf[String(p).trim()]=String(a).trim();
  }
  for(const p in addrOf){ meta[p]=meta[p]||{}; if(!meta[p].addr) meta[p].addr=addrOf[p]; }

  const props=[...new Set(units.map(u=>u.prop))].sort();
  if(!subject){ // fall back to the smallest distance
    let best=Infinity; for(const p of props){ const d=meta[p]?.dist; if(d!=null&&d<best){best=d;subject=p;} }
    subject = subject || props[0];
  }
  const dates = units.map(u=>Math.max(u.dfa??-1,u.lsd??-1)).filter(d=>d>0);
  DB.props=props; DB.fps=[...new Set(units.map(u=>u.fp))].sort(); DB.units=units;
  DB.meta=meta; DB.subject=subject;
  DB.asof = new Date(EPOCH + Math.max(...dates)*864e5).toISOString().slice(0,10);
  DB.src  = 'Uploaded export';
  DB.market = DB.market || '';
  S.props=new Set(props); S.fp='all';
  return {units:units.length, props:props.length};
}

/* ---------- filtering ---------- */
function asofDay(){ return Math.round((Date.parse(DB.asof+'T00:00:00Z')-EPOCH)/864e5); }
/* The trailing window means different things by unit state, so each state gets
   its own date field. "On market" is a point-in-time state — a unit listed 200
   days ago is still available today — so the window does NOT narrow it. Use
   "Newly listed" when you want inventory that came to market inside the window. */
function activeUnits(){
  const cut = S.win==='all' ? -Infinity : asofDay()-S.win;
  return DB.units.filter(u=>{
    if(!S.props.has(u.prop)) return false;
    const leased = u.status==='Leased';
    switch(S.status){
      case 'avail':  if(leased) return false; break;
      case 'new':    if(leased || u.dfa==null || u.dfa<cut) return false; break;
      case 'leased': if(!leased || u.lsd==null || u.lsd<cut) return false; break;
      case 'all':    if(leased && (u.lsd==null || u.lsd<cut)) return false; break;
    }
    if(S.beds!=='all' && String(u.beds)!==S.beds) return false;
    if(S.mode==='floorplan' && S.fp!=='all' && !(u.prop===DB.subject && u.fp===S.fp)) return false;
    return true;
  });
}
/* what the window is actually doing right now — surfaced in the UI */
function windowHint(){
  if(S.win==='all') return 'No date limit.';
  switch(S.status){
    case 'avail':  return `Window inactive — every unit on the market today is shown. Switch to “Newly listed” to apply the ${S.win}-day window.`;
    case 'new':    return `Units that came to market in the last ${S.win} days.`;
    case 'leased': return `Units leased in the last ${S.win} days.`;
    case 'all':    return `All on-market units plus leases signed in the last ${S.win} days.`;
  }
  return '';
}

/* ---------- accessors + stats ---------- */
const AX = {
  sqft:{k:u=>u.sqft, label:'Square feet', fmt:v=>Math.round(v).toLocaleString()},
  dom :{k:u=>u.dom,  label:'Days on market', fmt:v=>Math.round(v)},
  date:{k:u=>u.status==='Leased'?u.lsd:u.dfa, label:'Date listed', fmt:v=>dayLabel(v)},
  ask :{k:u=>u.ask,  label:'Asking rent', fmt:v=>'$'+Math.round(v).toLocaleString()},
  eff :{k:u=>u.eff,  label:'Effective rent', fmt:v=>'$'+Math.round(v).toLocaleString()},
  apsf:{k:u=>u.sqft?u.ask/u.sqft:null, label:'Asking rent PSF', fmt:v=>'$'+v.toFixed(2)},
  epsf:{k:u=>u.sqft?u.eff/u.sqft:null, label:'Effective rent PSF', fmt:v=>'$'+v.toFixed(2)}
};
function dayLabel(d){ const dt=new Date(EPOCH+d*864e5); return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}); }
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const med  = a => { if(!a.length) return null; const s=[...a].sort((x,y)=>x-y),m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };

function ols(pts){
  const n=pts.length; if(n<3) return null;
  const mx=mean(pts.map(p=>p[0])), my=mean(pts.map(p=>p[1]));
  let sxy=0,sxx=0,syy=0;
  for(const [x,y] of pts){ sxy+=(x-mx)*(y-my); sxx+=(x-mx)**2; syy+=(y-my)**2; }
  if(!sxx) return null;
  const m=sxy/sxx, b=my-m*mx;
  return {m, b, r2: syy? (sxy*sxy)/(sxx*syy) : 0, n};
}

function propStats(units){
  const out={};
  for(const p of DB.props){
    const set = units.filter(u=>u.prop===p); if(!set.length) continue;
    const psf = set.filter(u=>u.sqft&&u.eff).map(u=>u.eff/u.sqft);
    out[p]={ n:set.length, ask:mean(set.map(u=>u.ask).filter(Boolean)),
      eff:mean(set.map(u=>u.eff).filter(Boolean)), sqft:mean(set.map(u=>u.sqft).filter(Boolean)),
      epsf:mean(psf), dom:med(set.map(u=>u.dom).filter(v=>v!=null)),
      conc:mean(set.map(u=>u.conc).filter(v=>v!=null)), ...(DB.meta[p]||{}) };
  }
  return out;
}
function fpStats(units, prop){
  const out={};
  for(const u of units.filter(x=>x.prop===prop)){
    (out[u.fp] = out[u.fp]||[]).push(u);
  }
  return Object.fromEntries(Object.entries(out).map(([k,set])=>[k,{
    n:set.length, beds:set[0].beds, sqft:mean(set.map(u=>u.sqft).filter(Boolean)),
    ask:mean(set.map(u=>u.ask).filter(Boolean)), eff:mean(set.map(u=>u.eff).filter(Boolean)),
    epsf:mean(set.filter(u=>u.sqft&&u.eff).map(u=>u.eff/u.sqft)),
    dom:med(set.map(u=>u.dom).filter(v=>v!=null))
  }]));
}

/* ---------- scatter (hand-rolled SVG) ---------- */
function drawScatter(el, theme){
  const units = activeUnits();
  const xa=AX[S.x], ya=AX[S.y];
  const pts = units.map(u=>({u, x:xa.k(u), y:ya.k(u)})).filter(p=>p.x!=null&&p.y!=null&&isFinite(p.x)&&isFinite(p.y));
  el.innerHTML='';
  if(pts.length<2){ el.innerHTML=`<div class="empty">No units match these filters. Widen the window or clear a filter.</div>`; return; }

  const W=el.clientWidth||900, H=el.clientHeight||460;
  const M={t:16,r:18,b:44,l:64};
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  let x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
  const padx=(x1-x0)*.06||1, pady=(y1-y0)*.10||1;
  x0-=padx; x1+=padx; y0-=pady; y1+=pady;
  const X=v=>M.l+(v-x0)/(x1-x0)*(W-M.l-M.r);
  const Y=v=>H-M.b-(v-y0)/(y1-y0)*(H-M.t-M.b);

  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.setAttribute('width','100%'); svg.setAttribute('height','100%');
  const add=(t,a,parent)=>{ const e=document.createElementNS(ns,t); for(const k in a) e.setAttribute(k,a[k]); (parent||svg).appendChild(e); return e; };

  const ticks=(lo,hi,n)=>{ const raw=(hi-lo)/n, mag=Math.pow(10,Math.floor(Math.log10(raw)));
    const step=[1,2,2.5,5,10].map(s=>s*mag).find(s=>s>=raw)||mag*10;
    const out=[]; for(let v=Math.ceil(lo/step)*step; v<=hi; v+=step) out.push(v); return out; };

  ticks(y0,y1,5).forEach(v=>{
    add('line',{x1:M.l,x2:W-M.r,y1:Y(v),y2:Y(v),stroke:theme.grid,'stroke-width':1});
    add('text',{x:M.l-10,y:Y(v)+4,'text-anchor':'end',fill:theme.dim,'font-size':11,'font-family':theme.mono}).textContent=ya.fmt(v);
  });
  ticks(x0,x1,6).forEach(v=>{
    add('line',{x1:X(v),x2:X(v),y1:M.t,y2:H-M.b,stroke:theme.grid,'stroke-width':1});
    add('text',{x:X(v),y:H-M.b+20,'text-anchor':'middle',fill:theme.dim,'font-size':11,'font-family':theme.mono}).textContent=xa.fmt(v);
  });
  add('text',{x:(M.l+W-M.r)/2,y:H-6,'text-anchor':'middle',fill:theme.dim,'font-size':11,'letter-spacing':'.08em'}).textContent=xa.label.toUpperCase();
  const yl=add('text',{x:14,y:(M.t+H-M.b)/2,'text-anchor':'middle',fill:theme.dim,'font-size':11,'letter-spacing':'.08em'});
  yl.setAttribute('transform',`rotate(-90 14 ${(M.t+H-M.b)/2})`); yl.textContent=ya.label.toUpperCase();

  // trend lines
  const line=(set,color,dash)=>{
    const f=ols(set.map(p=>[p.x,p.y])); if(!f) return null;
    const a=Math.max(x0,Math.min(...set.map(p=>p.x))), b=Math.min(x1,Math.max(...set.map(p=>p.x)));
    add('line',{x1:X(a),y1:Y(f.m*a+f.b),x2:X(b),y2:Y(f.m*b+f.b),stroke:color,'stroke-width':2,
      'stroke-dasharray':dash||'','stroke-linecap':'round',opacity:.9});
    return f;
  };
  const subPts=pts.filter(p=>p.u.prop===DB.subject), cmpPts=pts.filter(p=>p.u.prop!==DB.subject);
  let fitC=null, fitS=null;
  if(S.mode==='property'){
    if(S.trend!=='subject') fitC=line(cmpPts,theme.comp,'6 5');
    if(S.trend!=='comps')   fitS=line(subPts,theme.subject);
  } else {
    if(S.trend!=='none') fitS=line(pts,theme.subject);
  }

  // dots
  const fpColors={}; let ci=0;
  if(S.mode==='floorplan') [...new Set(pts.map(p=>p.u.fp))].forEach(f=>fpColors[f]=theme.palette[ci++%theme.palette.length]);
  const tip=el.querySelector('.tip')||Object.assign(document.createElement('div'),{className:'tip'});
  tip.style.display='none'; el.appendChild(tip);

  const order=[...cmpPts,...subPts];       // subject drawn last, on top
  for(const p of order){
    const isSub = p.u.prop===DB.subject;
    const fill = S.mode==='floorplan' ? fpColors[p.u.fp] : (isSub?theme.subject:theme.comp);
    const c=add('circle',{cx:X(p.x),cy:Y(p.y),r:isSub&&S.mode==='property'?5.5:4,
      fill, opacity:isSub||S.mode==='floorplan'?.95:(theme.compOpacity??.42),
      stroke:isSub&&S.mode==='property'?theme.subjectRing:'none','stroke-width':1.5});
    c.style.cursor='crosshair';
    c.addEventListener('mouseenter',ev=>{
      c.setAttribute('r',7);
      tip.innerHTML=`<b>${p.u.prop}</b><span>${p.u.fp} · ${p.u.unit||'—'}</span>
        <span>${p.u.beds}bd/${p.u.baths}ba · ${p.u.sqft?p.u.sqft.toLocaleString()+' sf':'—'}</span>
        <span>Ask ${p.u.ask?'$'+p.u.ask.toLocaleString():'—'} · Eff ${p.u.eff?'$'+p.u.eff.toLocaleString():'—'}</span>
        <span>${p.u.status} · ${p.u.dom!=null?p.u.dom+' DOM':'—'}${p.u.conc?' · '+(p.u.conc*100).toFixed(1)+'% conc':''}</span>`;
      tip.style.display='block';
      const r=el.getBoundingClientRect();
      tip.style.left=Math.min(X(p.x)+14, r.width-210)+'px';
      tip.style.top=Math.max(Y(p.y)-10,4)+'px';
    });
    c.addEventListener('mouseleave',()=>{ c.setAttribute('r',isSub&&S.mode==='property'?5.5:4); tip.style.display='none'; });
  }
  el.insertBefore(svg, tip);
  return {fitC, fitS, n:pts.length, nSub:subPts.length};
}

/* Concession economics per property. AIQ gives concession as a % of annual
   rent, so 8.33% ≈ one month free; ×52 converts to a weeks-free equivalent
   that leasing teams actually quote. */
function concessionBoard(units){
  const st=propStats(units), out=[];
  for(const [p,v] of Object.entries(st)){
    const gap = (v.ask!=null&&v.eff!=null) ? v.ask-v.eff : null;
    out.push({ prop:p, isSubject:p===DB.subject, conc:v.conc, gapMo:gap,
      weeks: v.conc!=null ? v.conc*52 : null,
      annual: gap!=null ? gap*12 : null,
      offer: v.cd || null, ask:v.ask, eff:v.eff, n:v.n });
  }
  return out.sort((a,b)=>(b.conc??-1)-(a.conc??-1));
}
function buildBrief(){
  const units=activeUnits(), st=propStats(units), sub=st[DB.subject];
  const comps=Object.entries(st).filter(([p])=>p!==DB.subject).map(([,v])=>v);
  if(!sub||!comps.length) return null;
  const avg=k=>mean(comps.map(c=>c[k]).filter(v=>v!=null));
  const rank=k=>{ const all=Object.entries(st).map(([p,v])=>[p,v[k]]).filter(x=>x[1]!=null)
      .sort((a,b)=>b[1]-a[1]); return [all.findIndex(x=>x[0]===DB.subject)+1, all.length]; };
  return {
    market:DB.market, asof:DB.asof, subject:DB.subject, window:S.win, beds:S.beds, statusFilter:S.status,
    subjectProfile:{ yearBuilt:sub.yr, units:sub.tot, distanceMi:0, reviews:sub.rev,
      exposurePct:sub.exp, leasedPct:sub.lsd, preLeasedPct:sub.pre, apps7:sub.a7, apps30:sub.a30,
      concessionOffer:sub.cd },
    subjectPricing:{ n:sub.n, avgAsking:Math.round(sub.ask), avgEffective:Math.round(sub.eff),
      avgSqft:Math.round(sub.sqft), effPSF:+sub.epsf?.toFixed(2), medianDOM:sub.dom,
      concessionPct:+(sub.conc*100).toFixed(1) },
    compSet:{ n:comps.length, avgAsking:Math.round(avg('ask')), avgEffective:Math.round(avg('eff')),
      avgSqft:Math.round(avg('sqft')), effPSF:+avg('epsf')?.toFixed(2), medianDOM:med(comps.map(c=>c.dom).filter(v=>v!=null)),
      concessionPct:+(avg('conc')*100).toFixed(1), avgYearBuilt:Math.round(avg('yr')), avgExposure:avg('exp') },
    ranks:{ effectiveRent:rank('eff'), effPSF:rank('epsf'), concession:rank('conc'), exposure:rank('exp') },
    byProperty:Object.entries(st).map(([p,v])=>({property:p, isSubject:p===DB.subject, distanceMi:v.dist,
      yearBuilt:v.yr, totalUnits:v.tot, listings:v.n, avgAsking:Math.round(v.ask), avgEffective:Math.round(v.eff),
      effPSF:+v.epsf?.toFixed(2), medianDOM:v.dom, concessionPct:+(v.conc*100).toFixed(1),
      exposurePct:v.exp!=null?+(v.exp*100).toFixed(1):null, concessionOffer:v.cd}))
      .sort((a,b)=>b.effPSF-a.effPSF)
  };
}
function localRead(b){
  if(!b) return [{tag:'No data',text:'Not enough data in the current filter to form a read.'}];
  const d=(a,c)=>((a-c)/c*100), o=[];
  const eff=d(b.subjectPricing.avgEffective,b.compSet.avgEffective);
  const ask=d(b.subjectPricing.avgAsking,b.compSet.avgAsking);
  const psf=d(b.subjectPricing.effPSF,b.compSet.effPSF);
  o.push({tag:'Pricing gap',text:`Asking ${Math.abs(ask).toFixed(1)}% ${ask>=0?'over':'under'} comps; effective ${Math.abs(eff).toFixed(1)}% ${eff>=0?'over':'under'}. Concessions absorb it.`});
  o.push({tag:'Concessions',text:`${b.subjectPricing.concessionPct}% vs ${b.compSet.concessionPct}% comp avg. Rank ${b.ranks.concession[0]}/${b.ranks.concession[1]}.`});
  o.push({tag:'Net PSF',text:`$${b.subjectPricing.effPSF} vs $${b.compSet.effPSF}, ${Math.abs(psf).toFixed(1)}% ${psf>=0?'over':'under'}. Rank ${b.ranks.effPSF[0]}/${b.ranks.effPSF[1]}.`});
  if(b.subjectProfile.yearBuilt&&b.compSet.avgYearBuilt)
    o.push({tag:'Vintage',text:`${b.subjectProfile.yearBuilt} vs ${b.compSet.avgYearBuilt} avg. Part of the PSF gap is product, not price.`});
  if(b.subjectProfile.apps7!=null)
    o.push({tag:'Velocity',text:`${b.subjectProfile.apps7} apps in 7d, ${b.subjectProfile.apps30} in 30d, at ${(b.subjectProfile.exposurePct*100).toFixed(1)}% exposure.`});
  return o;
}

/* ---------- AI insights ---------- */
/* The prompt lives server-side in netlify/functions/insights.js so this endpoint
   can't be reused as a general-purpose proxy for the API key. */
const AI_ENDPOINT = (typeof window!=='undefined' && window.AI_ENDPOINT) || '/api/insights';
async function runAI(brief, render, note){
  if(!brief){ render(localRead(null)); return; }
  try{
    const res = await fetch(AI_ENDPOINT,{ method:'POST',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brief }) });
    if(!res.ok){
      let d=''; try{ d=(await res.json()).error||''; }catch(_){}
      throw new Error(d||('HTTP '+res.status));
    }
    let arr=(await res.json()).bullets;
    if(!Array.isArray(arr)||!arr.length) throw new Error('empty response');
    arr = arr.map(x=>typeof x==='string'?{tag:'',text:x}:{tag:x.tag||'',text:x.text||''}).filter(x=>x.text);
    if(!arr.length) throw new Error('empty response');
    render(arr);
  }catch(e){
    render(localRead(brief));
    if(note) note('Showing the built-in read — the insights service did not return. ('+e.message+')');
  }
}

/* ---------- shared formatters ---------- */
const F = {
  $:v=>v==null?'—':'$'+Math.round(v).toLocaleString(),
  psf:v=>v==null?'—':'$'+v.toFixed(2),
  pct:v=>v==null?'—':(v*100).toFixed(1)+'%',
  p1:v=>v==null?'—':v.toFixed(1)+'%',
  n:v=>v==null?'—':Math.round(v).toLocaleString(),
  d:v=>v==null?'—':Math.round(v)
};
function delta(a,c){ if(a==null||c==null||!c) return null; return (a-c)/c*100; }
