
function startApp(db,ctx){
const ATTIRE='Calca👖|Bota 🥾';
const LKEY='schedule-equipe-local:';
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const nid=()=>'j'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const $=id=>document.getElementById(id);

let mode='cloud';
let S;  // cadastro (definido por normRoster)
let D={date:'',jobs:[],sent:{}};                // dia atual
let cur=iso(new Date());
let rosterLoaded=false, dayLoaded=false;
let openPick=null, confirmDel=null, confirmClear=false, deferred=false;
let unsubDay=null;

/* ---------- salvamento ---------- */
const pend={}, timers={}, busy={}, lastSent={};
const dayPath=d=>'days/'+d, ROSTER='config/roster';
function setStatus(k){if(k==='ok'&&!navigator.onLine)k='offline';const el=$('sync');el.className='sync '+k;
  el.textContent={ok:'Sincronizado',saving:'Salvando…',err:'Erro ao salvar',loading:'Conectando…',offline:'Sem internet · salvo no aparelho'}[k]}
const stable=o=>JSON.stringify(o,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((a,x)=>(a[x]=v[x],a),{}):v);
let inflight=0;
window.addEventListener('online',()=>setStatus(inflight||Object.keys(pend).length?'saving':'ok'));
window.addEventListener('offline',()=>setStatus('offline'));
function queue(path,data){pend[path]=clone(data);setStatus('saving');clearTimeout(timers[path]);timers[path]=setTimeout(()=>flush(path),600)}
function flushAll(){Object.keys(pend).forEach(p=>{clearTimeout(timers[p]);flush(p)})}
function flush(path){
  if(!pend[path])return;
  const data=pend[path];delete pend[path];lastSent[path]=stable(data);
  inflight++;
  db.doc(path).set(data).then(()=>{inflight--;if(!inflight&&!Object.keys(pend).length)setStatus('ok')},
    e=>{inflight--;console.error(e);setStatus('err');toast('Não consegui salvar: '+(e&&e.code||'erro'))});
  if(!navigator.onLine)setStatus('offline');
}
const saveDay=()=>queue(dayPath(cur),{date:cur,jobs:D.jobs.map(({calc,...r})=>r),sent:D.sent||{}});
const saveRoster=()=>queue(ROSTER,S);
window.addEventListener('pagehide',flushAll);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushAll()});

function normRoster(d){return {workers:Array.isArray(d&&d.workers)?[...d.workers]:[],vehicles:Array.isArray(d&&d.vehicles)?clone(d.vehicles):[],companies:(()=>{const o={};if(d&&d.companies&&typeof d.companies==='object')Object.keys(d.companies).forEach(k=>{const v=d.companies[k];
    o[k]=Array.isArray(v)?v.filter(x=>typeof x==='string'):(typeof v==='string'&&v.trim()?[v]:[])});return o})(),
  base:(d&&typeof d.base==='string'&&d.base.trim())?d.base:'599 Concord St, Holliston, MA 01746',
  buffer:(d&&Number.isFinite(d.buffer))?d.buffer:30,
  travel:(d&&d.travel&&typeof d.travel==='object')?{...d.travel}:{},
  phones:(d&&d.phones&&typeof d.phones==='object')?{...d.phones}:{}}}
function normDay(d){const jobs=Array.isArray(d&&d.jobs)?clone(d.jobs):[];jobs.forEach(j=>{j.id=j.id||nid();j.need=+j.need||0;delete j.calc;j.travel=Number.isFinite(j.travel)?j.travel:null;j.autoShop=!!j.autoShop;j.early=Number.isFinite(j.early)?j.early:30;j.tk=j.tk||'';j.crew=Array.isArray(j.crew)?j.crew:[];['company','address','attire','shop','start','note'].forEach(k=>j[k]=j[k]||'');j.allWeek=!!j.allWeek;j.waiting=!!j.waiting});return {date:cur,jobs,sent:(d&&d.sent&&typeof d.sent==='object')?{...d.sent}:{}}}

/* evita re-render enquanto a pessoa digita */
function typing(){const a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='SELECT')&&!a.id.startsWith('extra-')&&a.id!=='newWorker'}
function rerender(){if(typing()){deferred=true;return}renderJobs();renderRoster()}
document.addEventListener('focusout',()=>setTimeout(()=>{if(deferred&&!typing()){deferred=false;renderJobs();renderRoster()}},0));

function remoteRoster(snap){
  if(pend[ROSTER])return;
  if(rosterLoaded&&snap.metadata&&snap.metadata.hasPendingWrites)return;
  const d=snap.exists?snap.data():null;
  if(d&&stable(d)===lastSent[ROSTER]&&rosterLoaded)return;
  S=normRoster(d);rosterLoaded=true;rerender();
}
function watchDay(){
  if(unsubDay){unsubDay();unsubDay=null}
  dayLoaded=false;D={date:cur,jobs:[],sent:{}};
  const path=dayPath(cur);
  renderJobs();
  unsubDay=db.doc(path).onSnapshot(snap=>{
    if(path!==dayPath(cur))return;
    if(pend[path])return;
    if(dayLoaded&&snap.metadata&&snap.metadata.hasPendingWrites)return;
    const d=snap.exists?snap.data():null;
    if(dayLoaded&&d&&stable(d)===lastSent[path])return;
    D=normDay(d);dayLoaded=true;rerender();
  },e=>{console.error(e);setStatus('err')});
}

/* ---------- mensagem / análise ---------- */
function fmt(t){if(!t)return'';let[h,m]=t.split(':').map(Number);const ap=h>=12?'pm':'am';h=h%12||12;return h+':'+pad(m)+ap}
function vLabel(n){const v=S.vehicles.find(x=>x.n===n);return v?v.t+'('+v.n+')':'('+n+')'}
function buildMsg(){
  return D.jobs.map(j=>{
    const L=['✅ '+(j.company.trim()||'(sem nome)')];
    L.push(j.waiting?'(Esperando)':(j.address.trim()||'(endereço?)'));
    if(j.attire.trim())L.push('🔴 '+j.attire.trim());
    if(j.shop)L.push('🔴 '+fmt(j.shop)+' no shopp');
    if(j.start)L.push('⏰ start '+fmt(j.start));
    if(j.note&&j.note.trim())L.push('('+j.note.trim().replace(/^\(|\)$/g,'')+')');
    if(j.allWeek)L.push('(All Week)');
    L.push('');
    [...j.crew].sort((a,b)=>(b.v?1:0)-(a.v?1:0)).forEach(c=>L.push('\t✓ '+c.name+(c.v?' '+vLabel(c.v):'')));
    L.push('__');
    return L.join('\n');
  }).join('\n');
}
function analyze(){
  const byName={},byVeh={};
  D.jobs.forEach(j=>j.crew.forEach(c=>{
    const k=c.name.trim().toLowerCase();(byName[k]=byName[k]||[]).push(j.company||'?');
    if(c.v)(byVeh[c.v]=byVeh[c.v]||[]).push(j.company||'?');
  }));
  const dupNames=Object.keys(byName).filter(k=>byName[k].length>1);
  const out=[];
  dupNames.forEach(k=>{const n=D.jobs.flatMap(j=>j.crew).find(c=>c.name.trim().toLowerCase()===k).name;out.push(['bad',`${n} está em ${byName[k].length} obras: ${byName[k].join(', ')}`])});
  Object.keys(byVeh).filter(v=>byVeh[v].length>1).forEach(v=>out.push(['bad',`Veículo ${v} está em ${byVeh[v].length} obras: ${byVeh[v].join(', ')}`]));
  D.jobs.forEach(j=>{
    const nm=j.company||'Obra sem nome';
    if(j.need&&j.crew.length<j.need){const f=j.need-j.crew.length;out.push(['bad',`${nm}: falta${f>1?'m':''} ${f} pessoa${f>1?'s':''} (${j.crew.length} de ${j.need})`])}
    if(j.crew.length&&!j.crew.some(c=>c.v))out.push(['warn',`${nm}: ninguém com veículo`]);
    if(!j.crew.length&&!j.need)out.push(['warn',`${nm}: sem equipe`]);
    if(!j.waiting&&!j.address.trim())out.push(['warn',`${nm}: falta endereço (ou marque "Esperando")`]);
  });
  const miss=D.jobs.reduce((s,j)=>s+Math.max(0,(j.need||0)-j.crew.length),0);
  if(miss){const a=assignedSet();const free=S.workers.filter(w=>!a.has(w.toLowerCase())).length;
    const p=n=>n+(n===1?' pessoa':' pessoas');
    out.unshift(free>=miss?['warn',`No total faltam ${p(miss)}. Ainda tem ${free} livre${free===1?'':'s'} no cadastro pra completar.`]
      :['bad',`No total faltam ${p(miss)} e só ${free===0?'ninguém está livre':free+(free===1?' está livre':' estão livres')} no cadastro. Precisa de ${p(miss-free)} extra.`]);}
  return {out,dupNames};
}
function assignedSet(){const s=new Set();D.jobs.forEach(j=>j.crew.forEach(c=>s.add(c.name.trim().toLowerCase())));return s}
const findJob=id=>D.jobs.find(j=>j.id===id);
/* ---------- viagem / horário do shop ---------- */
const DEFAULT_BASE='599 Concord St, Holliston, MA 01746';
let sampler=null;
const akey=a=>a.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const toMin=t=>{const[h,m]=t.split(':').map(Number);return h*60+m};
const toHHMM=x=>{x=((x%1440)+1440)%1440;return pad(Math.floor(x/60))+':'+pad(x%60)};
function recompute(j){
  if(j.autoShop&&j.travel!=null&&j.start){j.shop=toHHMM(Math.floor((toMin(j.start)-(j.early||0)-j.travel)/5)*5);return true}
  return false;
}
function mapsURL(addr){return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin='+encodeURIComponent(S.base)+'&destination='+encodeURIComponent(addr)}
function travelHTML(j){
  if(j.waiting||!j.address.trim())return '';
  if(j.calc)return '<span class="tv-msg">🚗 Calculando tempo de viagem…</span>';
  const link=`<a href="${esc(mapsURL(j.address.trim()))}" target="_blank" rel="noopener">Conferir no Google Maps ↗</a>`;
  if(!j.tk&&j.travel==null&&sampler)return `<button class="linkbtn" data-act="calc" style="font-size:14px">🚗 Calcular viagem e horário do shop</button>${link}`;
  const err=j.travel==null?`<span class="tv-msg">${sampler?'Não consegui calcular. Digite os minutos:':'Digite os minutos de viagem:'}</span>`:'';
  return `${err}<label class="tv-in">🚗 <input type="number" min="0" max="300" inputmode="numeric" data-f="travel" value="${j.travel??''}" id="tm-${j.id}" aria-label="Minutos de viagem"> min de viagem</label>${link}`;
}
function shopNote(j){
  if(j.waiting||!j.address.trim()||j.travel==null)return '';
  if(j.autoShop){const arr=j.start?` · chegada na obra ${fmt(toHHMM(toMin(j.start)-(j.early||0)))}`:'';
    return `Shop automático: start − ${j.early?j.early+' min antes − ':''}${j.travel} min de viagem${arr}`}
  return `Shop definido à mão. <button class="linkbtn" data-act="auto">Calcular automático</button>`;
}
async function lookupTravel(j){
  const addr=j.address.trim();
  if(j.waiting||!addr){j.tk='';return}
  const k=akey(addr);if(j.tk===k&&j.travel!=null)return;
  j.tk=k;j.autoShop=true;
  if(S.travel[k]!=null){j.travel=S.travel[k];recompute(j);saveDay();rerender();return}
  j.travel=null;
  if(!sampler){saveDay();rerender();return}
  j.calc=true;rerender();
  let mins=null;
  try{
    const r=await sampler.json(`Estimate the car driving time in minutes between two addresses in New England, USA, for an early-morning departure (around 5-6 am, light traffic), the way Google Maps would.
Origin: ${S.base}
Destination: ${addr}
Reply with JSON only, no prose: {"minutes": integer, "miles": number}. If you cannot identify the destination town, reply {"minutes": null, "miles": null}.`,{modelTier:'default'});
    if(r&&Number.isFinite(+r.minutes)&&+r.minutes>0&&+r.minutes<400)mins=Math.round(+r.minutes);
  }catch(e){}
  if(mins!=null){S.travel[k]=mins;saveRoster()}
  const jj=findJob(j.id);if(!jj)return;
  delete jj.calc;
  if(jj.tk&&jj.tk!==k){rerender();return}   // endereço mudou enquanto calculava
  jj.tk=k;jj.travel=mins;jj.autoShop=true;
  recompute(jj);saveDay();rerender();
}
function syncShopUI(j){const sh=$('sh-'+j.id);if(sh&&sh!==document.activeElement)sh.value=j.shop;const sn=$('sn-'+j.id);if(sn)sn.innerHTML=shopNote(j)}

function coKey(name){const n=(name||'').trim().toLowerCase();return n?Object.keys(S.companies).find(c=>c.toLowerCase()===n):undefined}
function coAddrs(name){const k=coKey(name);return k?S.companies[k]:[]}
function addrPickHTML(j){
  const list=coAddrs(j.company);const curA=akey(j.address||'');
  const others=list.filter(a=>akey(a)!==curA);
  if(!others.length)return '';
  return `<span>Endereços salvos de ${esc(coKey(j.company))}:</span>`+others.map(a=>`<button class="chip" data-act="paddr" data-a="${esc(a)}">${esc(a)}</button>`).join('');
}
function rememberAddr(j){
  const name=j.company.trim();if(!name)return;
  const k=coKey(name)||name;const list=S.companies[k]||[];const a=j.address.trim();
  let changed=!(k in S.companies);
  if(a&&!j.waiting&&!list.some(x=>akey(x)===akey(a))){list.unshift(a);changed=true}
  S.companies[k]=list;
  if(changed){saveRoster();renderRoster()}
}

/* ---------- avisar equipe (WhatsApp, um por um) ---------- */
const nkey=n=>n.trim().toLowerCase();
function phoneOf(name){const k=Object.keys(S.phones).find(p=>nkey(p)===nkey(name));return k?S.phones[k]:''}
function waDigits(p){let d=(p||'').replace(/\D/g,'');if(d.length===10)d='1'+d;return d.length>=11?d:''}
function dateBR(){const[y,m,d]=cur.split('-');const wd=['domingo','segunda','terça','quarta','quinta','sexta','sábado'][new Date(+y,m-1,+d).getDay()];return wd+' '+d+'/'+m}
function personalMsg(c,j){
  const L=[`Fala ${c.name.trim().split(/\s+/)[0]}! Seu schedule de ${dateBR()}:`,'','✅ '+(j.company.trim()||'Obra'),j.waiting?'(Endereço ainda não confirmado)':j.address.trim()];
  if(j.attire.trim())L.push('🔴 '+j.attire.trim());
  if(j.shop)L.push('🔴 '+fmt(j.shop)+' no shopp');
  if(j.start)L.push('⏰ start '+fmt(j.start));
  if(j.note&&j.note.trim())L.push('('+j.note.trim().replace(/^\(|\)$/g,'')+')');
  if(j.allWeek)L.push('(All Week)');
  if(c.v)L.push('','Você leva o '+vLabel(c.v));
  const mates=j.crew.filter(x=>x!==c).map(x=>x.name);
  if(mates.length)L.push('','Equipe: '+mates.join(', '));
  return L.filter((x,i,a)=>!(x===''&&a[i-1]==='')).join('\n');
}
function notifyList(){const out=[];D.jobs.forEach(j=>j.crew.forEach(c=>out.push({c,j})));return out}
function renderNotify(){
  const list=notifyList();const sent=D.sent||{};
  const done=list.filter(x=>sent[nkey(x.c.name)]).length;
  $('ntCount').textContent=list.length?done+' de '+list.length+' avisados':'';
  if(!list.length){$('notify').innerHTML='<span class="empty">Quando tiver gente escalada, os avisos aparecem aqui.</span>';return}
  const next=list.find(x=>!sent[nkey(x.c.name)]&&waDigits(phoneOf(x.c.name)));
  const missing=list.filter(x=>!waDigits(phoneOf(x.c.name))).length;
  let top='';
  if(next){const url='https://api.whatsapp.com/send?phone='+waDigits(phoneOf(next.c.name))+'&text='+encodeURIComponent(personalMsg(next.c,next.j));
    top=`<a class="btn primary nextbtn" href="${esc(url)}" target="_blank" rel="noopener" data-sent="${esc(next.c.name)}" data-ix="${list.indexOf(next)}">Enviar pra ${esc(next.c.name)} →</a>
      <p class="hint">Abre o WhatsApp com a mensagem pronta. Envie, volte aqui e toque de novo pro próximo.</p>`}
  else if(done===list.length)top='<div class="alert ok">Todo mundo foi avisado ✓</div>';
  else top='<div class="alert warn">Faltam telefones pra avisar o resto. Coloque abaixo.</div>';
  if(missing&&next)top+=`<div class="alert warn" style="margin-top:6px">${missing} sem telefone: complete abaixo.</div>`;
  $('notify').innerHTML=top+`<div class="ntlist">${list.map(({c,j})=>{const k=nkey(c.name);const ph=waDigits(phoneOf(c.name));
    const url=ph?'https://api.whatsapp.com/send?phone='+ph+'&text='+encodeURIComponent(personalMsg(c,j)):'';
    const ix=list.findIndex(x=>x.c===c);return `<div class="ntrow${sent[k]?' sent':''}"><span class="ntname">${sent[k]?'✓ ':''}${esc(c.name)}<small>${esc(j.company||'')}</small></span>
      ${ph?`<a class="chip" href="${esc(url)}" target="_blank" rel="noopener" data-sent="${esc(c.name)}" data-ix="${ix}">${sent[k]?'Reenviar':'Enviar'}</a>`
          :`<input class="ntphone" data-phone="${esc(c.name)}" placeholder="Telefone" inputmode="tel" aria-label="Telefone de ${esc(c.name)}">`}</div>`}).join('')}</div>
    ${done?'<button class="linkbtn" id="ntReset" style="margin-top:8px">Desmarcar todos</button>':''}`;
}
$('notify').addEventListener('click',e=>{
  const a=e.target.closest('[data-sent]');
  if(a){const it=notifyList()[+a.dataset.ix];
    if(it){try{navigator.clipboard.writeText(personalMsg(it.c,it.j)).then(()=>toast('Mensagem também copiada: se sair estranha, apague e cole'),()=>{})}catch(err){}}
    (D.sent=D.sent||{})[nkey(a.dataset.sent)]=new Date().toISOString();saveDay();setTimeout(renderNotify,300);return}
  if(e.target.id==='ntReset'){D.sent={};saveDay();renderNotify()}
});
$('notify').addEventListener('change',e=>{const n=e.target.dataset.phone;if(n==null)return;const v=e.target.value.trim();
  if(!waDigits(v)){toast('Número inválido. Use o formato (508) 555-1234');return}
  S.phones[n]=v;saveRoster();renderNotify();renderRoster()});

function needCls(j){if(!j.need)return'';return j.crew.length<j.need?'short':j.crew.length>j.need?'over':'full'}
function needText(j){const n=j.crew.length;if(!j.need)return n+(n===1?' pessoa':' pessoas');
  const d=j.need-n;return n+' de '+j.need+(d>0?' · falta '+d:d<0?' · sobra '+(-d):' ✓')}
function vehOptions(sel){return '<option value="">sem veículo</option>'+S.vehicles.filter(v=>v.n).map(v=>`<option value="${esc(v.n)}"${v.n===sel?' selected':''}>${esc(v.t)} ${esc(v.n)}</option>`).join('')}

/* ---------- render ---------- */
function renderJobs(){
  if(!dayLoaded||(mode==='cloud'&&!rosterLoaded)){$('jobs').innerHTML='<div class="panel empty">Carregando a escala…</div>';$('alerts').innerHTML='';$('preview').textContent='';$('stats').textContent='';return}
  const {dupNames}=analyze();
  const assigned=assignedSet();
  const jobs=D.jobs;
  $('jobs').innerHTML=jobs.length?jobs.map((j,i)=>{
    const crew=j.crew.map((c,ci)=>`<div class="member${dupNames.includes(c.name.trim().toLowerCase())?' dup':''}">
        <span class="nm">${esc(c.name)}</span>
        <select data-act="veh" data-ci="${ci}" aria-label="Veículo de ${esc(c.name)}" id="vs-${j.id}-${ci}">${vehOptions(c.v)}</select>
        <button class="x" data-act="rm" data-ci="${ci}" aria-label="Tirar ${esc(c.name)}">×</button></div>`).join('')||'<div class="empty">Ninguém escalado ainda.</div>';
    let picker='';
    if(openPick===j.id){
      const free=S.workers.filter(w=>!assigned.has(w.toLowerCase()));
      const busyW=S.workers.filter(w=>assigned.has(w.toLowerCase())&&!j.crew.some(c=>c.name.toLowerCase()===w.toLowerCase()));
      picker=`<div class="picker">
        <div class="chips">${free.map(w=>`<button class="chip" data-act="pick" data-name="${esc(w)}">${esc(w)}</button>`).join('')||'<span class="empty">Todos os fixos já estão escalados.</span>'}</div>
        ${busyW.length?`<details><summary class="hint">Já escalados em outra obra (${busyW.length})</summary><div class="chips" style="margin-top:6px">${busyW.map(w=>`<button class="chip busy" data-act="pick" data-name="${esc(w)}">${esc(w)}</button>`).join('')}</div></details>`:''}
        <div class="extra"><input id="extra-${j.id}" placeholder="Nome extra (não cadastrado)"><button class="btn" data-act="extra">Adicionar</button></div>
        <button class="btn" data-act="pickclose">Pronto</button></div>`;
    }
    return `<article class="job" data-id="${j.id}">
      <div class="job-head">
        <span class="num">${i+1}</span>
        <input data-f="company" list="companyList" value="${esc(j.company)}" placeholder="Companhia" aria-label="Companhia" id="co-${j.id}">
        <span class="wkbadge" ${j.allWeek?'':'hidden'}>All Week</span>
        <button class="icon-btn" data-act="up" aria-label="Subir">↑</button>
        <button class="icon-btn" data-act="down" aria-label="Descer">↓</button>
      </div>
      <div class="job-body">
        <label class="f">Endereço<input data-f="address" value="${esc(j.address)}" ${j.waiting?'disabled':''} placeholder="Rua, cidade, MA" id="ad-${j.id}"></label>
        <div class="apick" id="ap-${j.id}">${addrPickHTML(j)}</div>
        <div class="travel" id="tv-${j.id}">${travelHTML(j)}</div>
        <label class="check"><input type="checkbox" data-f="waiting" ${j.waiting?'checked':''} id="wt-${j.id}"> Esperando endereço</label>
        <label class="f">Vestimenta<input data-f="attire" value="${esc(j.attire)}" id="at-${j.id}"></label>
        <div class="row">
          <label class="f">No shop<input type="time" data-f="shop" value="${esc(j.shop)}" id="sh-${j.id}"></label>
          <label class="f">Start<input type="time" data-f="start" value="${esc(j.start)}" id="st-${j.id}"></label>
        </div>
        <div class="early" role="group" aria-label="Chegar na obra antes do start">
          <span>Chegar antes do start</span>
          ${[0,10,20,30].map(m=>`<button class="ebtn" data-act="early" data-m="${m}" aria-pressed="${j.early===m}">${m?m+' min':'Na hora'}</button>`).join('')}
        </div>
        <div class="shopnote" id="sn-${j.id}">${shopNote(j)}</div>
        <label class="f">Observação<input data-f="note" value="${esc(j.note)}" placeholder="Ex.: Levar Roupa" id="nt-${j.id}"></label>
        <label class="check wk"><input type="checkbox" data-f="allWeek" ${j.allWeek?'checked':''} id="aw-${j.id}"> Semana toda <span class="tag">(All Week)</span></label>
        <div class="crew">
          <h3><span>Equipe</span><span class="need ${needCls(j)}" id="nd-${j.id}">${needText(j)}</span></h3>
          <label class="needrow">Preciso de <input type="number" min="0" max="99" inputmode="numeric" data-f="need" value="${j.need||''}" placeholder="–" id="nq-${j.id}"> pessoas</label>
          ${crew}
          ${picker||`<button class="btn" data-act="pickopen">+ Adicionar pessoas</button>`}
        </div>
        <div><button class="btn danger" data-act="del">${confirmDel===j.id?'Toque de novo pra apagar':'Apagar obra'}</button></div>
      </div></article>`;
  }).join(''):'<div class="panel empty">Nenhuma obra neste dia. Toque em "+ Nova obra" ou "Copiar último dia".</div>';
  $('jobs').insertAdjacentHTML('beforeend',`<datalist id="companyList">${Object.keys(S.companies).map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`);
  refresh(false);
}
function refresh(save=true){
  const {out}=analyze();
  $('alerts').innerHTML=(out.length?out:[['ok','Tudo certo: ninguém repetido e todas as obras com veículo.']]).map(([k,t])=>`<div class="alert ${k}">${esc(t)}</div>`).join('');
  $('preview').textContent=buildMsg()||'(sem obras)';
  const a=assignedSet();const free=S.workers.filter(w=>!a.has(w.toLowerCase()));
  $('free').innerHTML=free.map(w=>`<span class="chip">${esc(w)}</span>`).join('')||'<span class="empty">Todos os fixos estão escalados.</span>';
  $('freeCount').textContent=free.length+' de '+S.workers.length;
  if(!(document.activeElement&&document.activeElement.classList.contains('ntphone')))renderNotify();
  const people=D.jobs.reduce((s,j)=>s+j.crew.length,0);
  const bad=out.filter(o=>o[0]!=='ok').length;
  const needed=D.jobs.reduce((s,j)=>s+Math.max(j.need||0,j.crew.length),0);
  $('stats').innerHTML=`<b>${D.jobs.length}</b> obras · <b>${people}</b>${needed>people?' de <b>'+needed+'</b>':''} pessoas${bad?` · <b style="color:var(--bad)">${bad} aviso${bad>1?'s':''}</b>`:''}`;
  if(save)saveDay();
}

/* ---------- eventos das obras ---------- */
$('jobs').addEventListener('input',e=>{
  const card=e.target.closest('.job');if(!card)return;const j=findJob(card.dataset.id);const f=e.target.dataset.f;
  if(!j||!f)return;
  if(f==='waiting'){j.waiting=e.target.checked;card.querySelector('[data-f="address"]').disabled=j.waiting}
  else if(f==='allWeek'){j.allWeek=e.target.checked;const t=card.querySelector('.wkbadge');if(t)t.hidden=!j.allWeek}
  else if(f==='need'){j.need=Math.max(0,Math.min(99,parseInt(e.target.value,10)||0));const el=$('nd-'+j.id);el.className='need '+needCls(j);el.textContent=needText(j)}
  else if(f==='travel'){const v=parseInt(e.target.value,10);j.travel=Number.isFinite(v)&&v>=0?v:null;
    if(j.travel!=null&&j.address.trim()){S.travel[akey(j.address.trim())]=j.travel;j.tk=akey(j.address.trim());saveRoster()}
    recompute(j);syncShopUI(j)}
  else if(f==='shop'){j.shop=e.target.value;if(j.autoShop){j.autoShop=false;syncShopUI(j)}}
  else if(f==='start'){j.start=e.target.value;if(recompute(j))syncShopUI(j)}
  else j[f]=e.target.value;
  if(f==='company'){const list=coAddrs(j.company);
    if(list.length===1&&!j.address.trim()&&!j.waiting){j.address=list[0];card.querySelector('[data-f="address"]').value=j.address}}
  if(f==='company'||f==='address'){const ap=$('ap-'+j.id);if(ap)ap.innerHTML=addrPickHTML(j)}
  refresh();
});
$('jobs').addEventListener('change',e=>{
  const card=e.target.closest('.job');if(!card)return;const j=findJob(card.dataset.id);if(!j)return;
  if(e.target.dataset.act==='veh'){j.crew[+e.target.dataset.ci].v=e.target.value;saveDay();e.target.blur();renderJobs();return}
  const f=e.target.dataset.f;
  if(f==='company'||f==='address')rememberAddr(j);
  if(f==='address'||f==='company'||f==='waiting')lookupTravel(j);
});
$('jobs').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id&&e.target.id.startsWith('extra-')){e.preventDefault();e.target.nextElementSibling.click()}});
$('jobs').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b||b.tagName==='SELECT')return;
  const card=b.closest('.job');const j=findJob(card.dataset.id);if(!j)return;const jobs=D.jobs;const i=jobs.indexOf(j);
  const act=b.dataset.act;let changed=true;
  if(act!=='del')confirmDel=null;
  if(act==='rm')j.crew.splice(+b.dataset.ci,1);
  else if(act==='pickopen'){openPick=j.id;changed=false}
  else if(act==='pickclose'){openPick=null;changed=false}
  else if(act==='pick'){const n=b.dataset.name;if(!j.crew.some(c=>c.name.toLowerCase()===n.toLowerCase()))j.crew.push({name:n,v:''})}
  else if(act==='extra'){const inp=$('extra-'+j.id);const n=inp.value.trim();if(n&&!j.crew.some(c=>c.name.toLowerCase()===n.toLowerCase()))j.crew.push({name:n,v:''})}
  else if(act==='up'&&i>0){jobs.splice(i,1);jobs.splice(i-1,0,j)}
  else if(act==='down'&&i<jobs.length-1){jobs.splice(i,1);jobs.splice(i+1,0,j)}
  else if(act==='auto'){j.autoShop=true;recompute(j)}
  else if(act==='early'){j.early=+b.dataset.m;recompute(j)}
  else if(act==='calc'){lookupTravel(j);return}
  else if(act==='paddr'){j.address=b.dataset.a;j.waiting=false;saveDay();renderJobs();lookupTravel(j);return}
  else if(act==='del'){if(confirmDel===j.id){jobs.splice(i,1);confirmDel=null}else{confirmDel=j.id;changed=false}}
  else changed=false;
  if(changed)saveDay();
  renderJobs();
  if(act==='extra'){const inp=$('extra-'+j.id);if(inp)inp.focus()}
});

/* ---------- barra de ferramentas ---------- */
$('addJob').onclick=()=>{if(!dayLoaded)return;const j={id:nid(),company:'',address:'',waiting:false,attire:ATTIRE,shop:'',start:'07:00',crew:[],need:0,travel:null,autoShop:true,tk:'',early:30};D.jobs.push(j);openPick=j.id;saveDay();renderJobs();const el=$('co-'+j.id);if(el){el.focus();el.scrollIntoView({block:'center'})}};
$('copyPrev').onclick=async()=>{
  if(!dayLoaded)return;
  let prev=null,jobs=null;
  try{
    if(db){const q=await db.collection('days').where('date','<',cur).orderBy('date','desc').limit(20).get();
      const d=q.docs.find(x=>{const b=x.data();return b&&Array.isArray(b.jobs)&&b.jobs.length});if(d){prev=d.id;jobs=d.data().jobs}}
    else{const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(LKEY+'days/'))keys.push(k.slice((LKEY+'days/').length))}
      keys.filter(k=>k<cur).sort().reverse().some(k=>{const b=JSON.parse(localStorage.getItem(LKEY+'days/'+k));if(b&&b.jobs&&b.jobs.length){prev=k;jobs=b.jobs;return true}})}
  }catch(e){toast('Não consegui buscar o dia anterior');return}
  if(!prev){toast('Nenhum dia anterior salvo');return}
  D.jobs=clone(jobs).map(j=>({...j,id:nid()}));D.sent={};saveDay();renderJobs();
  toast('Copiado de '+prev.split('-').reverse().join('/'));
};
$('bringWeek').onclick=async()=>{
  if(!dayLoaded)return;
  const [y,m,d]=cur.split('-').map(Number);const dt=new Date(y,m-1,d);const dow=(dt.getDay()+6)%7; // segunda = 0
  const mon=iso(new Date(y,m-1,d-dow));
  if(mon===cur){toast('Hoje é segunda: não há dias anteriores nesta semana');return}
  let days=[];
  try{
    if(db){const q=await db.collection('days').where('date','>=',mon).orderBy('date','asc').limit(14).get();days=q.docs.map(x=>x.data()).filter(b=>b&&b.date<cur)}
    else{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(LKEY+'days/')){const dd=k.slice((LKEY+'days/').length);if(dd>=mon&&dd<cur)days.push(JSON.parse(localStorage.getItem(k)))}}
      days.sort((a,b)=>a.date.localeCompare(b.date))}
  }catch(e){toast('Não consegui buscar os dias da semana');return}
  const key=j=>akey((j.company||'')+'|'+(j.address||''));
  const found=new Map();days.forEach(b=>(b.jobs||[]).forEach(j=>{if(j.allWeek)found.set(key(j),j)}));
  const have=new Set(D.jobs.map(key));
  const add=[...found.values()].filter(j=>!have.has(key(j)));
  if(!found.size){toast('Nenhuma obra marcada como All Week nesta semana');return}
  if(!add.length){toast('As obras All Week já estão neste dia');return}
  add.forEach(j=>D.jobs.push({...clone(j),id:nid()}));
  saveDay();renderJobs();toast(add.length+(add.length>1?' obras trazidas':' obra trazida'));
};
$('clearDay').onclick=()=>{if(confirmClear){D.jobs=[];D.sent={};confirmClear=false;$('clearDay').textContent='Limpar dia';saveDay();renderJobs()}else{confirmClear=true;$('clearDay').textContent='Toque de novo pra limpar'}};

/* ---------- data ---------- */
function setDate(d){flushAll();cur=d;$('date').value=d;openPick=null;confirmDel=null;confirmClear=false;$('clearDay').textContent='Limpar dia';watchDay()}
$('date').onchange=e=>{if(e.target.value)setDate(e.target.value)};
const shift=n=>{const[y,m,d]=cur.split('-').map(Number);setDate(iso(new Date(y,m-1,d+n)))};
$('prevDay').onclick=()=>shift(-1);$('nextDay').onclick=()=>shift(1);

/* ---------- copiar ---------- */
function toast(t){const el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2200)}
$('copyMsg').onclick=()=>{
  const txt=buildMsg();if(!txt){toast('Não tem obra pra copiar');return}
  const fb=()=>{const ta=$('fallback');ta.value=txt;ta.select();try{document.execCommand('copy');toast('Mensagem copiada')}catch(e){toast('Selecione o texto da prévia e copie')}};
  try{navigator.clipboard.writeText(txt).then(()=>toast('Mensagem copiada. Cole no WhatsApp'),fb)}catch(e){fb()}
};

/* ---------- abas ---------- */
function tab(which){const d=which==='day';$('tab-day').setAttribute('aria-selected',d);$('tab-roster').setAttribute('aria-selected',!d);$('view-day').hidden=!d;$('view-roster').hidden=d}
$('tab-day').onclick=()=>{tab('day');renderJobs()};$('tab-roster').onclick=()=>{tab('roster');renderRoster()};

/* ---------- cadastro ---------- */
$('baseAddr').addEventListener('change',e=>{const v=e.target.value.trim();if(v&&v!==S.base){S.base=v;S.travel={};saveRoster();toast('Endereço da empresa salvo. Tempos serão recalculados nas próximas obras')}});
function renderRoster(){
  if(document.activeElement!==$('baseAddr'))$('baseAddr').value=S.base;
  $('wCount').textContent=S.workers.length+' fixos';
  $('workers').innerHTML=S.workers.map((w,i)=>`<div class="lrow"><input class="wname" data-wn="${i}" value="${esc(w)}" aria-label="Nome" id="wn-${i}">
    <input class="wphone${phoneOf(w)&&!waDigits(phoneOf(w))?' bad':''}" data-wp="${esc(w)}" value="${esc(phoneOf(w))}" placeholder="Telefone" inputmode="tel" aria-label="Telefone de ${esc(w)}" id="wp-${i}">
    <button class="x" data-wi="${i}" aria-label="Remover ${esc(w)}">×</button></div>`).join('')||'<span class="empty">Nenhum trabalhador cadastrado ainda.</span>';
  $('vehicles').innerHTML=S.vehicles.map((v,i)=>`<div class="lrow">
    <select data-vi="${i}" data-k="t" aria-label="Tipo" id="vt-${i}"><option${v.t==='🛻'?' selected':''}>🛻</option><option${v.t==='🚐'?' selected':''}>🚐</option><option${v.t==='🚚'?' selected':''}>🚚</option></select>
    <input class="grow" data-vi="${i}" data-k="n" value="${esc(v.n)}" inputmode="numeric" aria-label="Número" id="veh-${i}">
    <button class="x" data-vdel="${i}" aria-label="Remover veículo">×</button></div>`).join('')||'<span class="empty">Nenhum veículo cadastrado.</span>';
  $('companies').innerHTML=Object.keys(S.companies).sort((a,b)=>a.localeCompare(b)).map((c,i)=>`<div class="coblock">
    <div class="cohead"><b>${esc(c)}</b><span class="cocount">${S.companies[c].length} endereço${S.companies[c].length===1?'':'s'}</span>
      <button class="linkbtn" data-cadd="${esc(c)}">+ endereço</button>
      <button class="x" data-cdel="${esc(c)}" aria-label="Remover ${esc(c)}">×</button></div>
    ${S.companies[c].map((a,ai)=>`<div class="lrow"><input class="grow" data-co="${esc(c)}" data-ai="${ai}" value="${esc(a)}" placeholder="Endereço" aria-label="Endereço de ${esc(c)}" id="cad-${i}-${ai}">
      <button class="x" data-adel="${esc(c)}" data-ai="${ai}" aria-label="Remover endereço">×</button></div>`).join('')}
  </div>`).join('')||'<span class="empty">As companhias aparecem aqui conforme você cria obras.</span>';
}
$('workers').addEventListener('change',e=>{const i=e.target.dataset.wn;if(i==null)return;
  const old=S.workers[+i];const nv=e.target.value.trim().replace(/\s+/g,' ');
  if(!nv||nv===old){e.target.value=old;return}
  if(S.workers.some((w,k)=>k!==+i&&nkey(w)===nkey(nv))){toast('Já existe alguém com esse nome');e.target.value=old;return}
  S.workers[+i]=nv;
  const pk=Object.keys(S.phones).find(p=>nkey(p)===nkey(old));if(pk){S.phones[nv]=S.phones[pk];delete S.phones[pk]}
  let touched=false;D.jobs.forEach(j=>j.crew.forEach(c=>{if(nkey(c.name)===nkey(old)){c.name=nv;touched=true}}));
  if(D.sent&&D.sent[nkey(old)]){D.sent[nkey(nv)]=D.sent[nkey(old)];delete D.sent[nkey(old)];touched=true}
  saveRoster();if(touched){saveDay();renderJobs()}else refresh(false);
  toast('Nome atualizado'+(touched?' (também na escala deste dia)':''));
});
$('workers').addEventListener('change',e=>{const n=e.target.dataset.wp;if(n==null)return;const v=e.target.value.trim();
  const k=Object.keys(S.phones).find(p=>nkey(p)===nkey(n))||n;
  if(v)S.phones[k]=v;else delete S.phones[k];
  e.target.classList.toggle('bad',!!v&&!waDigits(v));
  if(v&&!waDigits(v))toast('Número parece incompleto. Use o formato (508) 555-1234');
  saveRoster();renderNotify()});
$('workers').onclick=e=>{const b=e.target.closest('[data-wi]');if(b){S.workers.splice(+b.dataset.wi,1);saveRoster();renderRoster();refresh(false)}};
function addWorker(){const n=$('newWorker').value.trim();if(n&&!S.workers.some(w=>w.toLowerCase()===n.toLowerCase())){S.workers.push(n);S.workers.sort((a,b)=>a.localeCompare(b,'pt'));saveRoster();renderRoster();refresh(false)}$('newWorker').value='';$('newWorker').focus()}
$('addWorker').onclick=addWorker;$('newWorker').onkeydown=e=>{if(e.key==='Enter')addWorker()};
$('vehicles').addEventListener('input',e=>{const t=e.target;if(t.dataset.vi!=null){S.vehicles[+t.dataset.vi][t.dataset.k]=t.value.trim();saveRoster()}});
$('vehicles').onclick=e=>{const b=e.target.closest('[data-vdel]');if(b){S.vehicles.splice(+b.dataset.vdel,1);saveRoster();renderRoster()}};
$('addVehicle').onclick=()=>{S.vehicles.push({n:'',t:'🛻'});saveRoster();renderRoster();const el=$('veh-'+(S.vehicles.length-1));if(el)el.focus()};
$('companies').oninput=e=>{const c=e.target.dataset.co;if(c!=null&&S.companies[c]){S.companies[c][+e.target.dataset.ai]=e.target.value;saveRoster()}};
$('companies').addEventListener('change',e=>{const c=e.target.dataset.co;if(c!=null&&S.companies[c]){S.companies[c]=S.companies[c].map(a=>a.trim()).filter(Boolean);saveRoster();renderRoster()}});
$('companies').onclick=e=>{
  const d=e.target.closest('[data-cdel]'),ad=e.target.closest('[data-adel]'),add=e.target.closest('[data-cadd]');
  if(d){delete S.companies[d.dataset.cdel];saveRoster();renderRoster()}
  else if(ad){S.companies[ad.dataset.adel].splice(+ad.dataset.ai,1);saveRoster();renderRoster()}
  else if(add){const c=add.dataset.cadd;S.companies[c].push('');renderRoster();const i=Object.keys(S.companies).sort((a,b)=>a.localeCompare(b)).indexOf(c);const el=$('cad-'+i+'-'+(S.companies[c].length-1));if(el)el.focus()}
};

/* ---------- backup ---------- */
const csvCell=v=>{v=String(v??'');return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
const toCSV=rows=>'﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
const BK='schedule-equipe-lastbackup';
function showLastBackup(){try{const v=localStorage.getItem(BK);$('lastBackup').textContent=v?'último neste aparelho: '+v:''}catch(e){}}
const dl={save:async({filename,data})=>{const b=new Blob([data],{type:filename.endsWith('.json')?'application/json':'text/csv;charset=utf-8'});
  const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000);return {status:'saved'}}};
async function allDays(){
  if(!db){const out=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(LKEY+'days/')){try{out.push(JSON.parse(localStorage.getItem(k)))}catch(e){}}}return out}
  const out=[];let after='';
  for(;;){
    let q=db.collection('days');if(after)q=q.where('date','>',after);
    const snap=await q.orderBy('date','asc').limit(500).get();
    snap.docs.forEach(d=>out.push(d.data()));
    if(snap.size<500)break;after=snap.docs[snap.size-1].data().date;
  }
  return out;
}
async function offer(filename,text,btn){
  if(!dl){toast('Download não disponível nesta tela');return}
  const label=btn.textContent;btn.disabled=true;btn.textContent='Preparando…';
  try{
    await dl.save({filename,data:text});
    const now=new Date();const stamp=pad(now.getDate())+'/'+pad(now.getMonth()+1)+' '+pad(now.getHours())+':'+pad(now.getMinutes());
    try{localStorage.setItem(BK,stamp)}catch(e){}
    showLastBackup();toast('Backup salvo');
  }catch(e){
    const c=e&&e.code;
    if(c==='declined'){}else if(c==='rate_limited')toast('Já tem um download aberto. Tente de novo em instantes');
    else toast('Não foi possível baixar agora');
  }finally{btn.disabled=false;btn.textContent=label}
}
$('bkDays').onclick=async e=>{
  const btn=e.currentTarget;flushAll();
  let days;try{days=await allDays()}catch(err){toast('Não consegui ler as escalas');return}
  days.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const rows=[['Data','Ordem','Companhia','Endereço','Vestimenta','No shop','Start','Trabalhador','Veículo']];
  days.forEach(d=>(d.jobs||[]).forEach((j,i)=>{
    const base=[d.date,i+1,j.company,j.waiting?'(Esperando)':j.address,j.attire,fmt(j.shop),fmt(j.start)];
    if(!(j.crew||[]).length)rows.push([...base,'','']);
    (j.crew||[]).forEach(c=>rows.push([...base,c.name,c.v||'']));
  }));
  await offer('escalas-backup-'+iso(new Date())+'.csv',toCSV(rows),btn);
};
$('bkRoster').onclick=async e=>{
  const rows=[['Tipo','Nome / Número','Detalhe']];
  S.workers.forEach(w=>rows.push(['Trabalhador',w,phoneOf(w)]));
  S.vehicles.forEach(v=>rows.push(['Veículo',v.n,v.t==='🚐'?'Van':v.t==='🚚'?'Caminhão':'Pickup']));
  Object.keys(S.companies).sort().forEach(c=>{const l=S.companies[c].filter(Boolean);(l.length?l:['']).forEach(a=>rows.push(['Companhia',c,a]))});
  await offer('cadastro-backup-'+iso(new Date())+'.csv',toCSV(rows),e.currentTarget);
};
showLastBackup();
$('bkFull').onclick=async e=>{const btn=e.currentTarget;flushAll();let days;try{days=await allDays()}catch(err){toast('Não consegui ler as escalas');return}
  await offer('cruz-schedule-backup-'+iso(new Date())+'.json',JSON.stringify({app:'cruz-schedule',version:1,exportedAt:new Date().toISOString(),roster:S,days},null,1),btn)};
let pendingImport=null;
$('importFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const o=JSON.parse(await f.text());if(!o||o.app!=='cruz-schedule'||!o.roster||!Array.isArray(o.days))throw 0;
    pendingImport=o;const r=normRoster(o.roster);
    $('importInfo').innerHTML=`Arquivo com <b>${r.workers.length}</b> trabalhadores, <b>${Object.keys(r.companies).length}</b> companhias e <b>${o.days.length}</b> dia(s) de escala. <button class="btn primary" id="importGo">Importar agora</button> <button class="linkbtn" id="importCancel">Cancelar</button><br><small>O cadastro atual será substituído pelo do arquivo. Dias com a mesma data também.</small>`;
    $('importInfo').hidden=false}
  catch(err){toast('Esse arquivo não é um backup do Cruz Schedule')}};
$('importInfo').addEventListener('click',async e=>{
  if(e.target.id==='importCancel'){pendingImport=null;$('importInfo').hidden=true;return}
  if(e.target.id!=='importGo'||!pendingImport)return;
  e.target.disabled=true;e.target.textContent='Importando…';
  try{S=normRoster(pendingImport.roster);lastSent[ROSTER]=stable(S);await db.doc(ROSTER).set(clone(S));
    for(const d of pendingImport.days){if(d&&/^\d{4}-\d{2}-\d{2}$/.test(d.date))await db.doc(dayPath(d.date)).set({date:d.date,jobs:d.jobs||[],sent:d.sent||{}})}
    toast('Importação concluída');pendingImport=null;$('importInfo').hidden=true;renderRoster();watchDay();
  }catch(err){console.error(err);toast('Falhou a importação: '+(err&&err.code||'erro'))}
});

/* ---------- início ---------- */
$('date').value=cur;
S=normRoster(null);
setStatus('loading');renderJobs();renderRoster();
db.doc(ROSTER).onSnapshot(remoteRoster,e=>{console.error(e);setStatus('err')});
setStatus('ok');
watchDay();
return {flushAll};
}
