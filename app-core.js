
function startApp(db,ctx){
const P=Object.assign({escala:true,apagar:true,cadastro:true,telefones:true,backup:true,fotos:true},(ctx&&ctx.perms)||{});
const isAdmin=!!(ctx&&ctx.isAdmin);
['escala','apagar','cadastro','telefones','backup'].forEach(k=>document.body.classList.toggle('no-'+k,!P[k]));
const viewer=!P.escala&&!P.cadastro&&!P.apagar;   // só visualiza: mostra apenas a mensagem do dia
document.body.classList.toggle('viewer',viewer);
let PH={}, phonesLoaded=false;
const PHONES='config/phones';
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
// drivers: {jobId:[nomes com veículo]} — o banco usa pra conferir que só o motorista daquela obra marca presença/fotos
// Responsável pela obra = quem está marcado como Motorista no Cadastro, ou quem está com veículo da empresa
const isDriverName=n=>!!(S&&S.drivers||[]).find(x=>nkey(x)===nkey(n));
const jobDrivers=j=>j.crew.filter(c=>isCompanyVeh(c.v)||isDriverName(c.name)).sort((a,b)=>(isDriverName(b.name)?1:0)-(isDriverName(a.name)?1:0)).map(c=>c.name);
const driversMap=()=>{const m={};D.jobs.forEach(j=>{const n=jobDrivers(j);if(n.length)m[j.id]=n});return m};
const saveDay=()=>(P.escala||P.telefones)&&(lastDrivers=driversMap(),queue(dayPath(cur),{date:cur,jobs:D.jobs.map(({calc,...r})=>r),sent:D.sent||{},drivers:lastDrivers}));
const saveRoster=()=>(P.cadastro||P.escala)&&queue(ROSTER,S);
const savePhones=()=>P.telefones&&queue(PHONES,{phones:PH});
window.addEventListener('pagehide',flushAll);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushAll()});

function normRoster(d){return {workers:Array.isArray(d&&d.workers)?[...d.workers]:[],vehicles:Array.isArray(d&&d.vehicles)?clone(d.vehicles):[],companies:(()=>{const o={};if(d&&d.companies&&typeof d.companies==='object')Object.keys(d.companies).forEach(k=>{const v=d.companies[k];
    o[k]=Array.isArray(v)?v.filter(x=>typeof x==='string'):(typeof v==='string'&&v.trim()?[v]:[])});return o})(),
  base:(d&&typeof d.base==='string'&&d.base.trim())?d.base:'599 Concord St, Holliston, MA 01746',
  buffer:(d&&Number.isFinite(d.buffer))?d.buffer:30,
  travel:(d&&d.travel&&typeof d.travel==='object')?{...d.travel}:{},
  drivers:Array.isArray(d&&d.drivers)?d.drivers.filter(x=>typeof x==='string'):[],
  offices:(d&&d.offices&&typeof d.offices==='object')?{...d.offices}:{}}}
function normDay(d){const jobs=Array.isArray(d&&d.jobs)?clone(d.jobs):[];jobs.forEach(j=>{j.id=j.id||nid();j.need=+j.need||0;delete j.calc;j.travel=Number.isFinite(j.travel)?j.travel:null;j.autoShop=!!j.autoShop;j.early=Number.isFinite(j.early)?j.early:30;j.tk=j.tk||'';j.crew=Array.isArray(j.crew)?j.crew:[];['company','address','attire','shop','start','note'].forEach(k=>j[k]=j[k]||'');j.allWeek=!!j.allWeek;j.waiting=!!j.waiting;j.office=!!j.office;j.left=Number.isFinite(j.left)?j.left:0});return {date:cur,jobs,sent:(d&&d.sent&&typeof d.sent==='object')?{...d.sent}:{}}}

/* evita re-render enquanto a pessoa digita */
function typing(){const a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='SELECT')&&!a.id.startsWith('extra-')&&a.id!=='newWorker'}
function rerender(){if(typing()){deferred=true;return}renderJobs();renderRoster()}
document.addEventListener('focusout',()=>setTimeout(()=>{if(deferred&&!typing()){deferred=false;renderJobs();renderRoster()}},0));

function remoteRoster(snap){
  if(pend[ROSTER])return;
  if(rosterLoaded&&snap.metadata&&snap.metadata.hasPendingWrites)return;
  const d=snap.exists?snap.data():null;
  if(d&&stable(d)===lastSent[ROSTER]&&rosterLoaded)return;
  S=normRoster(d);rosterLoaded=true;
  if(d&&d.phones&&typeof d.phones==='object'&&Object.keys(d.phones).length&&isAdmin){
    // telefones antigos ficavam no cadastro: passa pra um documento separado (só quem pode ver telefones lê)
    const go=()=>{if(!phonesLoaded)return setTimeout(go,500);PH=Object.assign({},d.phones,PH);savePhones();saveRoster()};go();
  }
  rerender();
  if(P.escala&&dayLoaded&&D.jobs.length&&stable(lastDrivers||{})!==stable(driversMap()))saveDay();
}
let lastDrivers=null;
function remotePhones(snap){
  if(pend[PHONES])return;
  if(phonesLoaded&&snap.metadata&&snap.metadata.hasPendingWrites)return;
  const d=snap.exists?snap.data():null;
  if(d&&stable(d)===lastSent[PHONES]&&phonesLoaded)return;
  PH=(d&&d.phones&&typeof d.phones==='object')?{...d.phones}:{};phonesLoaded=true;rerender();
}
function watchDay(){
  if(unsubDay){unsubDay();unsubDay=null}
  dayLoaded=false;D={date:cur,jobs:[],sent:{}};
  const path=dayPath(cur);
  renderJobs();
  watchPhotos();
  watchAtt();
  unsubDay=db.doc(path).onSnapshot(snap=>{
    if(path!==dayPath(cur))return;
    if(pend[path])return;
    if(dayLoaded&&snap.metadata&&snap.metadata.hasPendingWrites)return;
    const d=snap.exists?snap.data():null;
    if(dayLoaded&&d&&stable(d)===lastSent[path])return;
    D=normDay(d);dayLoaded=true;rerender();renderTotem();
    lastDrivers=d&&d.drivers||{};
    if(P.escala&&d&&D.jobs.length&&stable(d.drivers||{})!==stable(driversMap()))saveDay();   // dias salvos antes de existir a lista de motoristas
  },e=>{console.error(e);setStatus('err')});
}

/* ---------- mensagem / análise ---------- */
function fmt(t){if(!t)return'';let[h,m]=t.split(':').map(Number);const ap=h>=12?'pm':'am';h=h%12||12;return h+':'+pad(m)+ap}
const OWN='own';   // carro próprio (🚗): vai direto pra obra no carro dele
const isCompanyVeh=v=>!!v&&v!==OWN;
function vLabel(n){if(n===OWN)return '🚗';const v=S.vehicles.find(x=>x.n===n);return v?v.t+'('+v.n+')':'('+n+')'}
// Cabeçalho da mensagem: dia da semana + mês/dia (ex.: "Sexta-feira" / "10/09")
function msgHeader(){const[y,m,d]=cur.split('-');const wd=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(+y,m-1,+d).getDay()];return wd+'\n'+m+'/'+d}
function buildMsg(){
  if(!D.jobs.length)return '';
  return msgHeader()+'\n\n'+D.jobs.map(j=>{
    const L=['✅ '+(j.company.trim()||'(sem nome)')];
    L.push(j.waiting?'(Esperando)':(j.address.trim()||'(endereço?)'));
    if(j.attire.trim())L.push('🔴 '+j.attire.trim());
    if(j.shop)L.push('🔴 '+fmt(j.shop)+' no shopp');
    if(j.start)L.push('⏰ start '+fmt(j.start));
    if(j.note&&j.note.trim())L.push('('+j.note.trim().replace(/^\(|\)$/g,'')+')');
    if(j.allWeek)L.push('(All Week)');
    L.push('');
    j.crew.forEach(c=>L.push('\t✓ '+c.name+(c.v?' '+vLabel(c.v):'')));
    L.push('__');
    return L.join('\n');
  }).join('\n');
}
function analyze(){
  const byName={},byVeh={};
  D.jobs.forEach(j=>j.crew.forEach(c=>{
    const k=c.name.trim().toLowerCase();(byName[k]=byName[k]||[]).push(j.company||'?');
    if(isCompanyVeh(c.v))(byVeh[c.v]=byVeh[c.v]||[]).push(j.company||'?');
  }));
  const dupNames=Object.keys(byName).filter(k=>byName[k].length>1);
  const out=[];
  dupNames.forEach(k=>{const n=D.jobs.flatMap(j=>j.crew).find(c=>c.name.trim().toLowerCase()===k).name;out.push(['bad',`${n} está em ${byName[k].length} obras: ${byName[k].join(', ')}`])});
  Object.keys(byVeh).filter(v=>byVeh[v].length>1).forEach(v=>out.push(['bad',`Veículo ${v} está em ${byVeh[v].length} obras: ${byVeh[v].join(', ')}`]));
  D.jobs.forEach(j=>{
    const nm=j.company||'Obra sem nome';
    if(j.need&&j.crew.length<j.need){const f=j.need-j.crew.length;out.push(['bad',`${nm}: falta${f>1?'m':''} ${f} pessoa${f>1?'s':''} (${j.crew.length} de ${j.need})`])}
    const late=j.crew.filter(c=>isLate(j,c.name)).map(c=>c.name);if(late.length)out.push(['warn',`${nm}: chegou atrasado no shop: ${late.join(', ')}`]);
    const faltou=absentNames(j);if(faltou.length)out.push(['bad',`${nm}: ${faltou.join(', ')} ${faltou.length>1?'faltaram':'faltou'} (confirmado pelo motorista)`]);
    if(j.crew.length&&!j.crew.some(c=>isCompanyVeh(c.v)))out.push(['warn',`${nm}: ninguém com veículo`]);
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
/* ---------- arrumação automática do que é digitado ---------- */
const tidy=s=>String(s||'').replace(/\s+/g,' ').trim();
const cap=w=>w.charAt(0).toLocaleUpperCase('pt-BR')+w.slice(1).toLocaleLowerCase('pt-BR');
const isLow=w=>w===w.toLocaleLowerCase('pt-BR')&&/\p{L}/u.test(w);
const isUp=w=>w===w.toLocaleUpperCase('pt-BR')&&/\p{L}/u.test(w);
// Nomes: "pierre RAMOS" -> "Pierre Ramos" (mantém nomes já misturados, tipo McDonald)
const fmtName=s=>tidy(s).split(' ').map(w=>w.split('-').map(p=>(isLow(p)||isUp(p))?cap(p):p).join('-')).join(' ');
// Companhias: só arruma palavras todas minúsculas; siglas (JBD, ABC) ficam
const fmtCompany=s=>tidy(s).split(' ').map(w=>isLow(w)?cap(w):w).join(' ');
// Endereços: palavras minúsculas ganham maiúscula (menos in/of/at/and), estado em maiúsculo
const SMALL=new Set(['in','of','at','and','on','de','da','do']);
const fmtAddress=s=>{let w=tidy(s).split(' ').map((x,i)=>isLow(x)&&!(i>0&&SMALL.has(x))?cap(x):x).join(' ');
  return w.replace(/\b(ma|nh|ri|ct|ny|me|vt|nj|pa|fl)\b(?=[\s,.]*(\d{5}(-\d{4})?)?\s*$)/i,m=>m.toUpperCase())};

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
// Office/shop da companhia (quando ela pede pra turma ir pro shop dela)
function officeOf(name){const n=(name||'').trim().toLowerCase();if(!n)return '';const k=Object.keys(S.offices||{}).find(c=>c.toLowerCase()===n);return k?S.offices[k]:''}
function addrPickHTML(j){
  if(j.office)return '';
  const list=coAddrs(j.company);const curA=akey(j.address||'');
  const others=list.filter(a=>akey(a)!==curA);
  if(!others.length)return '';
  return `<span>Endereços salvos de ${esc(coKey(j.company))}:</span>`+others.map(a=>`<button class="chip" data-act="paddr" data-a="${esc(a)}">${esc(a)}</button>`).join('');
}
function rememberAddr(j){
  const name=j.company.trim();if(!name)return;
  if(j.office){const a=j.address.trim();if(!a)return;const k=coKey(name)||Object.keys(S.offices).find(c=>c.toLowerCase()===name.toLowerCase())||name;
    if(S.offices[k]!==a){S.offices[k]=a;if(!(k in S.companies))S.companies[k]=[];saveRoster();renderRoster();toast('Office da '+k+' salvo pras próximas vezes')}return}
  const k=coKey(name)||name;const list=S.companies[k]||[];const a=j.address.trim();
  let changed=!(k in S.companies);
  if(a&&!j.waiting&&!list.some(x=>akey(x)===akey(a))){list.unshift(a);changed=true}
  S.companies[k]=list;
  if(changed){saveRoster();renderRoster()}
}

/* ---------- avisar equipe (WhatsApp, um por um) ---------- */
const nkey=n=>n.trim().toLowerCase();
function phoneOf(name){const k=Object.keys(PH).find(p=>nkey(p)===nkey(name));return k?PH[k]:''}
function waDigits(p){let d=(p||'').replace(/\D/g,'');if(d.length===10)d='1'+d;return d.length>=11?d:''}
function dateBR(x){const[y,m,d]=(x||cur).split('-');const wd=['domingo','segunda','terça','quarta','quinta','sexta','sábado'][new Date(+y,m-1,+d).getDay()];return wd+' '+d+'/'+m}
function personalMsg(c,j){
  const L=[`Fala ${c.name.trim().split(/\s+/)[0]}! Seu schedule de ${dateBR()}:`,'','✅ '+(j.company.trim()||'Obra'),j.waiting?'(Endereço ainda não confirmado)':j.address.trim()];
  if(j.attire.trim())L.push('🔴 '+j.attire.trim());
  if(j.shop)L.push('🔴 '+fmt(j.shop)+' no shopp');
  if(j.start)L.push('⏰ start '+fmt(j.start));
  if(j.note&&j.note.trim())L.push('('+j.note.trim().replace(/^\(|\)$/g,'')+')');
  if(j.allWeek)L.push('(All Week)');
  if(c.v===OWN)L.push('','Você vai no seu carro direto pra obra 🚗');else if(c.v)L.push('','Você leva o '+vLabel(c.v));
  const mates=j.crew.filter(x=>x!==c).map(x=>x.name);
  if(mates.length)L.push('','Equipe: '+mates.join(', '));
  return L.filter((x,i,a)=>!(x===''&&a[i-1]==='')).join('\n');
}
function notifyList(){const out=[];D.jobs.forEach(j=>j.crew.forEach(c=>out.push({c,j})));return out}
function renderNotify(){
  if(!P.telefones)return;
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
  PH[n]=v;savePhones();renderNotify();renderRoster()});

const leftTime=j=>new Date(j.left).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase();
function needCls(j){if(!j.need)return'';return j.crew.length<j.need?'short':j.crew.length>j.need?'over':'full'}
function needText(j){const n=j.crew.length;if(!j.need)return n+(n===1?' pessoa':' pessoas');
  const d=j.need-n;return n+' de '+j.need+(d>0?' · falta '+d:d<0?' · sobra '+(-d):' ✓')}
function vehOptions(sel){return '<option value="">sem veículo</option><option value="own"'+(sel===OWN?' selected':'')+'>🚗 carro próprio</option>'+S.vehicles.filter(v=>v.n).map(v=>`<option value="${esc(v.n)}"${v.n===sel?' selected':''}>${esc(v.t)} ${esc(v.n)}</option>`).join('')}

/* ---------- render ---------- */
function renderJobs(){
  if(!dayLoaded||(mode==='cloud'&&!rosterLoaded)){$('jobs').innerHTML='<div class="panel empty">Carregando a escala…</div>';$('alerts').innerHTML='';$('preview').textContent='';$('stats').textContent='';return}
  const {dupNames}=analyze();
  const assigned=assignedSet();
  const jobs=D.jobs;
  $('jobs').innerHTML=jobs.length?jobs.map((j,i)=>{
    const crew=j.crew.map((c,ci)=>`<div class="member${dupNames.includes(c.name.trim().toLowerCase())?' dup':''}">
        <span class="nm">${attBadge(j,c)}${esc(c.name)}${isDriverName(c.name)?' <span class="drvmini" title="Motorista">🚗</span>':''}</span>
        ${P.escala?attMini(j,c):''}
        <select data-act="veh" data-ci="${ci}" aria-label="Veículo de ${esc(c.name)}" id="vs-${j.id}-${ci}">${vehOptions(c.v)}</select>
        <span class="mord"><button class="mv" data-act="mup" data-ci="${ci}" aria-label="Subir ${esc(c.name)}"${ci===0?' disabled':''}>↑</button><button class="mv" data-act="mdown" data-ci="${ci}" aria-label="Descer ${esc(c.name)}"${ci===j.crew.length-1?' disabled':''}>↓</button></span>
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
        <button class="leftdot${j.left?' on':''}" data-act="left" aria-pressed="${!!j.left}" title="${j.left?'Turma já saiu (toque pra desfazer)':'Turma ainda não saiu (toque quando sair)'}" aria-label="${j.left?'Turma já saiu':'Turma ainda não saiu'}"><span class="dot"></span></button>
        <input data-f="company" list="companyList" value="${esc(j.company)}" placeholder="Companhia" aria-label="Companhia" id="co-${j.id}">
        <span class="wkbadge" ${j.allWeek?'':'hidden'}>All Week</span>
        <button class="icon-btn" data-act="up" aria-label="Subir">↑</button>
        <button class="icon-btn" data-act="down" aria-label="Descer">↓</button>
      </div>
      <div class="job-body">
        <label class="f">Endereço<input data-f="address" value="${esc(j.address)}" ${j.waiting?'disabled':''} placeholder="${j.office?'Endereço do office/shop da companhia':'Rua, cidade, MA'}" id="ad-${j.id}"></label>
        <div class="apick" id="ap-${j.id}">${addrPickHTML(j)}</div>
        <div class="travel" id="tv-${j.id}">${travelHTML(j)}</div>
        <div class="checks"><label class="check"><input type="checkbox" data-f="waiting" ${j.waiting?'checked':''} id="wt-${j.id}"> Esperando endereço</label>
        <label class="check office"><input type="checkbox" data-f="office" ${j.office?'checked':''} id="of-${j.id}"> 🏢 Ir pro office da companhia</label></div>
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
          <div class="attsum" id="as-${j.id}">${attSummary(j)}</div>
          ${picker||`<button class="btn" data-act="pickopen">+ Adicionar pessoas</button>`}
        </div>
        ${P.fotos?`<button class="btn phcount" data-act="photos">📷 Fotos da obra <b id="pc-${j.id}">${photoCount(j)}</b></button>`:''}
        <div class="jobactions"><button class="btn" data-act="copynext">📋 Copiar pro dia seguinte</button>
        <button class="btn danger" data-act="del">${confirmDel===j.id?'Toque de novo pra apagar':'Apagar obra'}</button></div>
      </div></article>`;
  }).join('')+(P.escala?'<button class="btn addend" id="addJobEnd">+ Nova obra</button>':''):'<div class="panel empty">Nenhuma obra neste dia. Toque em "+ Nova obra" ou "Copiar último dia".</div>';
  if(!P.escala)$('jobs').querySelectorAll('input,select,button:not([data-act="photos"])').forEach(el=>el.disabled=true);
  $('jobs').insertAdjacentHTML('beforeend',`<datalist id="companyList">${Object.keys(S.companies).map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`);
  refresh(false);
}
function refresh(save=true){
  const {out}=analyze();
  $('alerts').innerHTML=(out.length?out:[['ok','Tudo certo: ninguém repetido e todas as obras com veículo.']]).map(([k,t])=>`<div class="alert ${k}">${esc(t)}</div>`).join('');
  $('preview').textContent=buildMsg()||(viewer?'Nenhuma escala lançada pra este dia ainda.':'(sem obras)');
  if(viewer)$('msgTitle').innerHTML='Escala <small>'+esc(dateBR())+'</small>';
  const a=assignedSet();const free=S.workers.filter(w=>!a.has(w.toLowerCase()));
  $('free').innerHTML=free.map(w=>`<span class="chip">${esc(w)}</span>`).join('')||'<span class="empty">Todos os fixos estão escalados.</span>';
  $('freeCount').textContent=free.length+' de '+S.workers.length;
  if(!(document.activeElement&&document.activeElement.classList.contains('ntphone')))renderNotify();
  renderPhotos();
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
  if(f==='waiting'){if(e.target.checked&&j.office){j.office=false;const o=card.querySelector('[data-f="office"]');if(o)o.checked=false}j.waiting=e.target.checked;card.querySelector('[data-f="address"]').disabled=j.waiting}
  else if(f==='office'){
    j.office=e.target.checked;const ad=card.querySelector('[data-f="address"]');
    if(j.office){j.prevAddr=j.address;j.waiting=false;card.querySelector('[data-f="waiting"]').checked=false;ad.disabled=false;
      const off=officeOf(j.company);j.address=off;ad.value=off;ad.placeholder='Endereço do office/shop da companhia';
      if(!off){toast('Digite o endereço do office'+(j.company?' da '+j.company:'')+'. Fica salvo pras próximas vezes');ad.focus()}}
    else{j.address=j.prevAddr||'';delete j.prevAddr;ad.value=j.address;ad.placeholder='Rua, cidade, MA'}
    const ap=$('ap-'+j.id);if(ap)ap.innerHTML=addrPickHTML(j)}
  else if(f==='allWeek'){j.allWeek=e.target.checked;const t=card.querySelector('.wkbadge');if(t)t.hidden=!j.allWeek}
  else if(f==='need'){j.need=Math.max(0,Math.min(99,parseInt(e.target.value,10)||0));const el=$('nd-'+j.id);el.className='need '+needCls(j);el.textContent=needText(j)}
  else if(f==='travel'){const v=parseInt(e.target.value,10);j.travel=Number.isFinite(v)&&v>=0?v:null;
    if(j.travel!=null&&j.address.trim()){S.travel[akey(j.address.trim())]=j.travel;j.tk=akey(j.address.trim());saveRoster()}
    recompute(j);syncShopUI(j)}
  else if(f==='shop'){j.shop=e.target.value;if(j.autoShop){j.autoShop=false;syncShopUI(j)}}
  else if(f==='start'){j.start=e.target.value;if(recompute(j))syncShopUI(j)}
  else j[f]=e.target.value;
  if(f==='company'&&j.office){const off=officeOf(j.company);if(off){j.address=off;card.querySelector('[data-f="address"]').value=off}}
  else if(f==='company'){const list=coAddrs(j.company);
    if(list.length===1&&!j.address.trim()&&!j.waiting){j.address=list[0];card.querySelector('[data-f="address"]').value=j.address}}
  if(f==='company'||f==='address'){const ap=$('ap-'+j.id);if(ap)ap.innerHTML=addrPickHTML(j)}
  refresh();
});
$('jobs').addEventListener('change',e=>{
  const card=e.target.closest('.job');if(!card)return;const j=findJob(card.dataset.id);if(!j)return;
  if(e.target.dataset.act==='veh'){j.crew[+e.target.dataset.ci].v=e.target.value;saveDay();e.target.blur();renderJobs();return}
  const f=e.target.dataset.f;
  if(f==='company'||f==='address'||f==='note'){
    const fx=f==='company'?fmtCompany:f==='address'?fmtAddress:tidy;const nv=fx(j[f]);
    if(nv!==j[f]){j[f]=nv;e.target.value=nv;saveDay();refresh(false)}}
  if(f==='company'||f==='address')rememberAddr(j);
  if(f==='office'&&j.office&&j.address.trim())rememberAddr(j);
  if(f==='address'||f==='company'||f==='waiting'||f==='office')lookupTravel(j);
});
$('jobs').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id&&e.target.id.startsWith('extra-')){e.preventDefault();e.target.nextElementSibling.click()}});
$('jobs').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b||b.tagName==='SELECT')return;
  const card=b.closest('.job');const j=findJob(card.dataset.id);if(!j)return;const jobs=D.jobs;const i=jobs.indexOf(j);
  const act=b.dataset.act;let changed=true;
  if(act==='photos'){openGallery(jobSite(j),(j.company||'Obra')+(j.waiting||!j.address?'':' · '+j.address));return}
  if(!P.escala)return;
  if(act==='del'&&!P.apagar)return;
  if(act!=='del')confirmDel=null;
  if(act==='rm')j.crew.splice(+b.dataset.ci,1);
  else if(act==='mup'||act==='mdown'){const a=+b.dataset.ci,t=act==='mup'?a-1:a+1;if(t<0||t>=j.crew.length)return;[j.crew[a],j.crew[t]]=[j.crew[t],j.crew[a]]}
  else if(act==='pickopen'){openPick=j.id;changed=false}
  else if(act==='pickclose'){openPick=null;changed=false}
  else if(act==='pick'){const n=b.dataset.name;if(!j.crew.some(c=>c.name.toLowerCase()===n.toLowerCase()))j.crew.push({name:n,v:''})}
  else if(act==='extra'){const inp=$('extra-'+j.id);const n=fmtName(inp.value);if(n&&!j.crew.some(c=>c.name.toLowerCase()===n.toLowerCase()))j.crew.push({name:n,v:''})}
  else if(act==='up'&&i>0){jobs.splice(i,1);jobs.splice(i-1,0,j)}
  else if(act==='down'&&i<jobs.length-1){jobs.splice(i,1);jobs.splice(i+1,0,j)}
  else if(act==='left'){j.left=j.left?0:Date.now();if(j.left&&j.allWeek){saveDay();copyJobToNext(j,b)}}   // All Week: ao confirmar a saída, já vai pro dia seguinte
  else if(act==='auto'){j.autoShop=true;recompute(j)}
  else if(act==='early'){j.early=+b.dataset.m;recompute(j)}
  else if(act==='calc'){lookupTravel(j);return}
  else if(act==='copynext'){copyJobToNext(j,b);return}
  else if(act==='paddr'){j.address=b.dataset.a;j.waiting=false;saveDay();renderJobs();lookupTravel(j);return}
  else if(act==='del'){if(confirmDel===j.id){jobs.splice(i,1);confirmDel=null}else{confirmDel=j.id;changed=false}}
  else changed=false;
  if(changed)saveDay();
  renderJobs();
  if(act==='extra'){const inp=$('extra-'+j.id);if(inp)inp.focus()}
});

/* copiar uma obra só pro dia seguinte (não mexe nas outras) */
async function copyJobToNext(j,btn){
  const [y,m,d]=cur.split('-').map(Number);const next=iso(new Date(y,m-1,d+1));
  const nice=dateBR(next);btn.disabled=true;
  try{
    const snap=await db.doc(dayPath(next)).get();const day=snap.exists?snap.data():{date:next,jobs:[],sent:{}};
    const jobs=Array.isArray(day.jobs)?day.jobs:[];
    const key=x=>akey((x.company||'')+'|'+(x.address||''));
    if(jobs.some(x=>key(x)===key(j))){toast(`${j.company||'Essa obra'} já está em ${nice}`);return}
    const {calc,prevAddr,left,...rest}=clone(j);
    jobs.push(Object.assign(rest,{id:nid()}));
    const drivers={};jobs.forEach(x=>{const n=jobDrivers({crew:x.crew||[]});if(n.length)drivers[x.id]=n});
    await db.doc(dayPath(next)).set({date:next,jobs,sent:day.sent||{},drivers});
    toast(`✓ ${j.company||'Obra'} copiada pra ${nice}`);
  }catch(e){console.error(e);toast('Não consegui copiar ('+(e.code||'erro')+')')}
  finally{btn.disabled=false}
}

/* ---------- barra de ferramentas ---------- */
$('addJob').onclick=()=>{if(!dayLoaded)return;const j={id:nid(),company:'',address:'',waiting:false,attire:ATTIRE,shop:'',start:'07:00',crew:[],need:0,travel:null,autoShop:true,tk:'',early:30};D.jobs.push(j);openPick=j.id;saveDay();renderJobs();const card=document.querySelector('.job[data-id="'+j.id+'"]');if(card)card.scrollIntoView({block:'start',behavior:'smooth'});const el=$('co-'+j.id);if(el)el.focus({preventScroll:true})};
$('addJob2').onclick=()=>$('addJob').click();
document.addEventListener('click',e=>{if(e.target.id==='addJobEnd')$('addJob').click()});
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
  D.jobs=clone(jobs).map(j=>({...j,id:nid(),left:0}));D.sent={};saveDay();renderJobs();
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
  add.forEach(j=>D.jobs.push({...clone(j),id:nid(),left:0}));
  saveDay();renderJobs();toast(add.length+(add.length>1?' obras trazidas':' obra trazida'));
};
$('clearDay').onclick=()=>{if(!P.apagar)return;if(confirmClear){D.jobs=[];D.sent={};confirmClear=false;$('clearDay').textContent='Limpar dia';saveDay();renderJobs()}else{confirmClear=true;$('clearDay').textContent='Toque de novo pra limpar'}};

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
function tab(which){['day','roster','access','photos'].forEach(t=>{const b=$('tab-'+t),v=$('view-'+t);if(b)b.setAttribute('aria-selected',t===which);if(v)v.hidden=t!==which})}
$('tab-day').onclick=()=>{tab('day');renderJobs()};$('tab-roster').onclick=()=>{tab('roster');renderRoster()};if($('tab-access'))$('tab-access').onclick=()=>tab('access');

/* ---------- cadastro ---------- */
$('baseAddr').addEventListener('change',e=>{const v=fmtAddress(e.target.value);e.target.value=v;if(v&&v!==S.base){S.base=v;S.travel={};saveRoster();toast('Endereço da empresa salvo. Tempos serão recalculados nas próximas obras')}});
function renderRoster(){
  if(document.activeElement!==$('baseAddr'))$('baseAddr').value=S.base;
  $('wCount').textContent=S.workers.length+' fixos';
  $('workers').innerHTML=S.workers.map((w,i)=>`<div class="lrow"><input class="wname" data-wn="${i}" value="${esc(w)}" aria-label="Nome" id="wn-${i}">
    <button class="drvtag${isDriverName(w)?' on':''}" data-drv="${i}" aria-pressed="${isDriverName(w)}" title="Motorista / responsável pela obra">🚗<span> Motorista</span></button>
    ${P.telefones?'':'<!--'}<input class="wphone${phoneOf(w)&&!waDigits(phoneOf(w))?' bad':''}" data-wp="${esc(w)}" value="${esc(phoneOf(w))}" placeholder="Telefone" inputmode="tel" aria-label="Telefone de ${esc(w)}" id="wp-${i}">${P.telefones?'':'-->'}
    <button class="x" data-wi="${i}" aria-label="Remover ${esc(w)}">×</button></div>`).join('')||'<span class="empty">Nenhum trabalhador cadastrado ainda.</span>';
  $('vehicles').innerHTML=S.vehicles.map((v,i)=>`<div class="lrow">
    <select data-vi="${i}" data-k="t" aria-label="Tipo" id="vt-${i}"><option${v.t==='🛻'?' selected':''}>🛻</option><option${v.t==='🚐'?' selected':''}>🚐</option><option${v.t==='🚚'?' selected':''}>🚚</option></select>
    <input class="grow" data-vi="${i}" data-k="n" value="${esc(v.n)}" inputmode="numeric" aria-label="Número" id="veh-${i}">
    <button class="x" data-vdel="${i}" aria-label="Remover veículo">×</button></div>`).join('')||'<span class="empty">Nenhum veículo cadastrado.</span>';
  $('companies').innerHTML=Object.keys(S.companies).sort((a,b)=>a.localeCompare(b)).map((c,i)=>`<div class="coblock">
    <div class="cohead"><b>${esc(c)}</b><span class="cocount">${S.companies[c].length} endereço${S.companies[c].length===1?'':'s'}</span>
      <button class="linkbtn" data-cadd="${esc(c)}">+ endereço</button>
      <button class="x" data-cdel="${esc(c)}" aria-label="Remover ${esc(c)}">×</button></div>
    <div class="lrow offrow"><span class="offlbl">🏢 Office</span><input class="grow" data-off="${esc(c)}" value="${esc(S.offices[c]||'')}" placeholder="Endereço do office/shop (se a companhia pedir)" aria-label="Office de ${esc(c)}" id="off-${i}"></div>
    ${S.companies[c].map((a,ai)=>`<div class="lrow"><input class="grow" data-co="${esc(c)}" data-ai="${ai}" value="${esc(a)}" placeholder="Endereço" aria-label="Endereço de ${esc(c)}" id="cad-${i}-${ai}">
      <button class="x" data-adel="${esc(c)}" data-ai="${ai}" aria-label="Remover endereço">×</button></div>`).join('')}
  </div>`).join('')||'<span class="empty">As companhias aparecem aqui conforme você cria obras.</span>';
  if(!P.cadastro){document.querySelectorAll('#view-roster .wname,#workers [data-wi],#vehicles input,#vehicles select,#vehicles button,#companies input,#companies button,#workers [data-drv],#baseAddr,#newWorker,#addWorker,#addVehicle').forEach(el=>el.disabled=true)}
}
$('workers').addEventListener('change',e=>{const i=e.target.dataset.wn;if(i==null)return;
  const old=S.workers[+i];const nv=fmtName(e.target.value);
  if(!nv||nv===old){e.target.value=old;return}
  if(S.workers.some((w,k)=>k!==+i&&nkey(w)===nkey(nv))){toast('Já existe alguém com esse nome');e.target.value=old;return}
  S.workers[+i]=nv;
  S.drivers=S.drivers.map(x=>nkey(x)===nkey(old)?nv:x);
  const pk=Object.keys(PH).find(p=>nkey(p)===nkey(old));if(pk){PH[nv]=PH[pk];delete PH[pk];savePhones()}
  let touched=false;D.jobs.forEach(j=>j.crew.forEach(c=>{if(nkey(c.name)===nkey(old)){c.name=nv;touched=true}}));
  if(D.sent&&D.sent[nkey(old)]){D.sent[nkey(nv)]=D.sent[nkey(old)];delete D.sent[nkey(old)];touched=true}
  saveRoster();if(touched){saveDay();renderJobs()}else refresh(false);
  toast('Nome atualizado'+(touched?' (também na escala deste dia)':''));
});
$('workers').addEventListener('change',e=>{const n=e.target.dataset.wp;if(n==null)return;const v=e.target.value.trim();
  const k=Object.keys(PH).find(p=>nkey(p)===nkey(n))||n;
  if(v)PH[k]=v;else delete PH[k];
  e.target.classList.toggle('bad',!!v&&!waDigits(v));
  if(v&&!waDigits(v))toast('Número parece incompleto. Use o formato (508) 555-1234');
  savePhones();renderNotify()});
$('workers').onclick=e=>{
  const t=e.target.closest('[data-drv]');
  if(t){if(!P.cadastro)return;const w=S.workers[+t.dataset.drv];const on=isDriverName(w);
    S.drivers=on?S.drivers.filter(x=>nkey(x)!==nkey(w)):[...S.drivers,w];saveRoster();renderRoster();
    if(P.escala&&D.jobs.length)saveDay();renderJobs();toast(on?w+' não é mais motorista':w+' marcado como motorista');return}
  const b=e.target.closest('[data-wi]');if(b){const w=S.workers[+b.dataset.wi];S.workers.splice(+b.dataset.wi,1);S.drivers=S.drivers.filter(x=>nkey(x)!==nkey(w));saveRoster();renderRoster();refresh(false)}};
function addWorker(){const n=fmtName($('newWorker').value);if(n&&!S.workers.some(w=>w.toLowerCase()===n.toLowerCase())){S.workers.push(n);S.workers.sort((a,b)=>a.localeCompare(b,'pt'));saveRoster();renderRoster();refresh(false)}$('newWorker').value='';$('newWorker').focus()}
$('bulkAdd').onclick=()=>{
  if(!P.cadastro)return;
  const lines=$('bulkText').value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let added=0,phones=0,dup=0;
  lines.forEach(l=>{
    const m=l.match(/^(.*?)[\s,;:\-–]*((?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})\s*$/);
    const name=fmtName((m?m[1]:l).replace(/[,;:\-–]+$/,''));
    const ph=m?m[2].trim():'';
    if(!name)return;
    const ex=S.workers.find(w=>nkey(w)===nkey(name));
    if(ex)dup++;else{S.workers.push(name);added++}
    if(ph&&P.telefones){const k=Object.keys(PH).find(p=>nkey(p)===nkey(name))||ex||name;PH[k]=ph;phones++}
  });
  S.workers.sort((a,b)=>a.localeCompare(b,'pt'));
  if(added)saveRoster();if(phones)savePhones();
  renderRoster();refresh(false);
  $('bulkText').value='';
  toast(`${added} adicionado${added===1?'':'s'}`+(phones?`, ${phones} telefone${phones===1?'':'s'}`:'')+(dup?` · ${dup} já existia${dup===1?'':'m'}`:''));
};
$('addWorker').onclick=addWorker;$('newWorker').onkeydown=e=>{if(e.key==='Enter')addWorker()};
$('vehicles').addEventListener('input',e=>{const t=e.target;if(t.dataset.vi!=null){S.vehicles[+t.dataset.vi][t.dataset.k]=t.value.trim();saveRoster()}});
$('vehicles').onclick=e=>{const b=e.target.closest('[data-vdel]');if(b){S.vehicles.splice(+b.dataset.vdel,1);saveRoster();renderRoster()}};
$('addVehicle').onclick=()=>{S.vehicles.push({n:'',t:'🛻'});saveRoster();renderRoster();const el=$('veh-'+(S.vehicles.length-1));if(el)el.focus()};
$('companies').addEventListener('change',e=>{const c=e.target.dataset.off;if(c==null)return;const v=fmtAddress(e.target.value);e.target.value=v;if(v)S.offices[c]=v;else delete S.offices[c];saveRoster()});
$('companies').addEventListener('input',e=>{const c=e.target.dataset.off;if(c==null)return;const v=e.target.value.trim();if(v)S.offices[c]=v;else delete S.offices[c];saveRoster()});
$('companies').oninput=e=>{const c=e.target.dataset.co;if(c!=null&&S.companies[c]){S.companies[c][+e.target.dataset.ai]=e.target.value;saveRoster()}};
$('companies').addEventListener('change',e=>{const c=e.target.dataset.co;if(c!=null&&S.companies[c]){S.companies[c]=S.companies[c].map(fmtAddress).filter(Boolean);saveRoster();renderRoster()}});
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
const dl={save:async({filename,data})=>{const b=data instanceof Blob?data:new Blob([data],{type:filename.endsWith('.json')?'application/json':'text/csv;charset=utf-8'});
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
    (j.crew||[]).forEach(c=>rows.push([...base,c.name,c.v===OWN?'Carro próprio':(c.v||'')]));
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
  await offer('cruz-schedule-backup-'+iso(new Date())+'.json',JSON.stringify({app:'cruz-schedule',version:1,exportedAt:new Date().toISOString(),roster:Object.assign({},S,P.telefones?{phones:PH}:{}),days},null,1),btn)};
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
    if(P.telefones&&pendingImport.roster.phones){PH={...pendingImport.roster.phones};lastSent[PHONES]=stable({phones:PH});await db.doc(PHONES).set({phones:PH})}
    for(const d of pendingImport.days){if(d&&/^\d{4}-\d{2}-\d{2}$/.test(d.date))await db.doc(dayPath(d.date)).set({date:d.date,jobs:d.jobs||[],sent:d.sent||{}})}
    toast('Importação concluída');pendingImport=null;$('importInfo').hidden=true;renderRoster();watchDay();
  }catch(err){console.error(err);toast('Falhou a importação: '+(err&&err.code||'erro'))}
});

/* ---------- presença: o motorista confirma quem veio ----------
   attendance/{data_jobId}: {date, jobId, site, company, driver, by, people{nome:'in'|'out'}, at, atMs} */
let ATT={},attUnsub=null;
function watchAtt(){
  if(attUnsub){attUnsub();attUnsub=null}
  ATT={};
  attUnsub=db.collection('attendance').where('date','==',cur).onSnapshot(s=>{
    ATT={};s.docs.forEach(d=>{const x=d.data();if(x&&x.jobId)ATT[x.jobId]=x});
    renderPhotos();renderTotem();
    if(dayLoaded){if(typing())deferred=true;else renderJobs()}
  },e=>console.error(e));
}
const attOf=(j,name)=>{const a=ATT[j.id];if(!a||!a.people)return '';const k=Object.keys(a.people).find(n=>nkey(n)===nkey(name));return k?a.people[k]:''};
const absentNames=j=>j.crew.filter(c=>attOf(j,c.name)==='out').map(c=>c.name);
// hora do check-in (totem): times{nome: ms}
const timeOf=(j,name)=>{const a=ATT[j.id];if(!a||!a.times)return 0;const k=Object.keys(a.times).find(n=>nkey(n)===nkey(name));return k?a.times[k]:0};
const shopMs=j=>j.shop?new Date(cur+'T'+j.shop+':00').getTime():0;
const isLate=(j,name)=>{const t=timeOf(j,name),s=shopMs(j);return !!(t&&s&&t>s+59999)};
const timeTag=(j,c)=>{const t=timeOf(j,c.name);if(!t)return '';return `<span class="ttime${isLate(j,c.name)?' late':''}" title="Check-in no totem">${esc(new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase().replace(' ',''))}</span>`};
function attMini(j,c){const s=attOf(j,c.name);
  return `${timeTag(j,c)}<span class="attmini"><button class="attb yes sm${s==='in'?' on':''}" data-att="${j.id}" data-n="${esc(c.name)}" data-s="in" aria-pressed="${s==='in'}" title="Veio">✓</button><button class="attb no sm${s==='out'?' on':''}" data-att="${j.id}" data-n="${esc(c.name)}" data-s="out" aria-pressed="${s==='out'}" title="Faltou">✗</button></span>`}
function attBadge(j,c){if(P.escala)return '';const s=attOf(j,c.name);return s==='in'?'<span class="attmark in" title="Veio">✓</span>'+timeTag(j,c):s==='out'?'<span class="attmark out" title="Faltou">✗</span>':''}
function attSummary(j){
  const a=ATT[j.id];if(!a||!j.crew.length)return j.crew.length?'<span class="hint">Presença ainda não confirmada pelo motorista.</span>':'';
  const vieram=j.crew.filter(c=>attOf(j,c.name)==='in').length,falt=absentNames(j),sem=j.crew.length-vieram-falt.length;
  const t=a.atMs?new Date(a.atMs).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
  return `<b>Presença:</b> ${vieram} de ${j.crew.length} vieram${falt.length?` · <span class="attout">faltou: ${esc(falt.join(', '))}</span>`:''}${sem?` · ${sem} sem marcar`:''}${t?` <span class="hint">(${esc(a.driver||'')} ${t})</span>`:''}`;
}
function attBlock(j){
  const a=ATT[j.id];const marked=j.crew.filter(c=>attOf(j,c.name)).length;
  return `<div class="att"><h4 class="phsub">Quem veio hoje?</h4>
    ${j.crew.map(c=>{const s=attOf(j,c.name);return `<div class="attrow"><span class="attname">${esc(c.name)}</span>
      <button class="attb yes${s==='in'?' on':''}" data-att="${j.id}" data-n="${esc(c.name)}" data-s="in" aria-pressed="${s==='in'}">✓ Veio</button>
      <button class="attb no${s==='out'?' on':''}" data-att="${j.id}" data-n="${esc(c.name)}" data-s="out" aria-pressed="${s==='out'}">✗ Faltou</button></div>`}).join('')}
    <small class="hint">${marked} de ${j.crew.length} marcados${a&&a.atMs?' · salvo às '+new Date(a.atMs).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}</small></div>`;
}
function setAtt(j,name,status){
  const prev=ATT[j.id]||{};const people=Object.assign({},prev.people||{});
  const k=Object.keys(people).find(n=>nkey(n)===nkey(name))||name;
  if(people[k]===status)delete people[k];else people[k]=status;
  const times=Object.assign({},prev.times||{});if(people[k]!=='in')Object.keys(times).forEach(n=>{if(nkey(n)===nkey(name))delete times[n]});
  const now=new Date();
  const driver=P.escala?(prev.driver||jobDrivers(j)[0]||ME||''):ME;
  const docData={date:cur,jobId:j.id,site:jobSite(j),company:j.company||'',driver,by:(ctx&&ctx.email)||'',people,times,at:now,atMs:now.getTime()};
  ATT[j.id]=docData;renderPhotos();if(!typing())renderJobs();
  db.doc('attendance/'+cur+'_'+j.id).set(docData).catch(e=>{console.error(e);toast('Não consegui salvar a presença ('+(e.code||'erro')+')')});
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-att]');if(!b)return;const j=findJob(b.dataset.att);if(j)setAtt(j,b.dataset.n,b.dataset.s)});

/* ---------- fotos da obra (versão de teste: fotos guardadas no banco) ----------
   photos/{id}: só os dados (leve, pra listar)  ·  photoThumb/{id}: miniatura  ·  photoFull/{id}: foto grande
   Agrupadas por obra = companhia + endereço (site), juntando todos os dias. */
const ME=(ctx&&ctx.worker)||'';
const siteKey=(c,a)=>(akey(c||'')+'|'+akey(a||'')).slice(0,400);
const jobSite=j=>siteKey(j.company,j.waiting?'':j.address);
let photosUnsub=null,PHOTOS=[],photoQueue=0,galSite=null,galTitle='',galUnsub=null,GAL=[],viewing=null;
const THUMB={};
function myJobs(){if(!ME)return [];return D.jobs.filter(j=>jobDrivers(j).some(n=>nkey(n)===nkey(ME)))}
function photoCount(j){const k=jobSite(j);const n=PHOTOS.filter(p=>p.site?p.site===k:p.jobId===j.id).length;return n?n+' hoje':''}
function watchPhotos(){
  if(photosUnsub){photosUnsub();photosUnsub=null}
  PHOTOS=[];
  if(!P.fotos&&!ME){renderPhotos();return}
  let q=db.collection('photos').where('date','==',cur);
  if(!P.fotos)q=q.where('driver','==',ME);
  photosUnsub=q.onSnapshot(s=>{
    PHOTOS=s.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>(a.atMs||0)-(b.atMs||0));
    renderPhotos();D.jobs.forEach(j=>{const el=$('pc-'+j.id);if(el)el.textContent=photoCount(j)});
  },e=>console.error(e));
}
function needThumbs(list,redraw){
  list.forEach(p=>{
    if(p.thumb){THUMB[p.id]=p.thumb;return}
    if(p.id in THUMB)return;
    THUMB[p.id]=null;
    db.doc('photoThumb/'+p.id).get().then(s=>{THUMB[p.id]=s.exists?s.data().thumb:'';redraw()}).catch(()=>{THUMB[p.id]=''});
  });
}
async function shrink(file,max,q,limit){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});
    let w=img.naturalWidth,h=img.naturalHeight;const s=Math.min(1,max/Math.max(w,h));w=Math.round(w*s);h=Math.round(h*s);
    const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
    let qq=q,out=c.toDataURL('image/jpeg',qq);
    while(out.length>limit&&qq>0.3){qq-=0.1;out=c.toDataURL('image/jpeg',qq)}
    return {data:out,w,h};
  }finally{URL.revokeObjectURL(url)}
}
async function uploadPhotos(j,files){
  let ok=0;
  for(const f of files){
    if(!f.type||!f.type.startsWith('image/'))continue;
    photoQueue++;redrawPhotos();
    try{
      const full=await shrink(f,1600,0.72,850000),th=await shrink(f,320,0.6,55000);
      const id='p'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      const now=new Date(),exp=new Date(now.getTime()+365*864e5);
      const driver=P.fotos?(jobDrivers(j)[0]||ME||''):ME;
      const base={date:cur,jobId:j.id,driver,by:(ctx&&ctx.email)||''};
      const meta=Object.assign({},base,{site:jobSite(j),company:j.company||'',address:j.waiting?'':(j.address||''),at:now,atMs:now.getTime(),expireAt:exp,w:full.w,h:full.h});
      const fail=e=>{console.error(e);toast('A foto não foi salva ('+(e&&e.code||'erro')+')')};
      THUMB[id]=th.data;
      db.doc('photoFull/'+id).set(Object.assign({},base,{data:full.data,expireAt:exp})).catch(fail);
      db.doc('photoThumb/'+id).set(Object.assign({},base,{thumb:th.data,expireAt:exp})).catch(fail);
      db.doc('photos/'+id).set(meta).catch(fail);
      ok++;
    }catch(e){console.error(e);toast('Não consegui ler uma das fotos')}
    photoQueue--;redrawPhotos();
  }
  if(ok)toast(navigator.onLine?(ok>1?ok+' fotos enviadas':'Foto enviada'):'Sem internet: as fotos sobem quando a conexão voltar');
}
function redrawPhotos(){renderPhotos();if(galSite)renderGallery()}
const hhmm=ms=>new Date(ms).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const camBtns=jid=>`<div class="phbtns"><label class="btn primary phbtn">📷 Tirar foto<input type="file" accept="image/*" capture="environment" hidden data-upjob="${jid}"></label>
  <label class="btn phbtn2">🖼️ Da galeria<input type="file" accept="image/*" multiple hidden data-upjob="${jid}"></label></div>`;
const thumbBtn=(p,label)=>`<button class="phthumb${THUMB[p.id]?'':' loading'}" data-ph="${p.id}" aria-label="Abrir foto">${THUMB[p.id]?`<img src="${THUMB[p.id]}" alt="">`:''}<span>${esc(label)}</span></button>`;
function renderPhotos(){
  const box=$('photosPanel');if(!box)return;
  const jobs=myJobs();
  if(!ME||!jobs.length){box.hidden=true;return}
  box.hidden=false;
  const list=PHOTOS.filter(p=>p.driver===ME);needThumbs(list,renderPhotos);
  $('photosBody').innerHTML=jobs.map(j=>{const mine=list.filter(p=>p.site?p.site===jobSite(j):p.jobId===j.id);
    return `<div class="phjob"><div class="phhead"><b>${esc(j.company||'Obra')}</b><small>${esc(j.waiting?'Endereço a confirmar':j.address)}</small></div>
    ${attBlock(j)}
    <h4 class="phsub">Fotos</h4>
    ${camBtns(j.id)}
    ${mine.length?`<div class="phgrid">${mine.map(p=>thumbBtn(p,hhmm(p.atMs))).join('')}</div>`:'<span class="empty">Nenhuma foto hoje.</span>'}
    <button class="linkbtn" data-site="${esc(jobSite(j))}" data-title="${esc((j.company||'Obra')+(j.waiting||!j.address?'':' · '+j.address))}">Ver todas as fotos desta obra →</button></div>`}).join('')
    +(photoQueue?`<p class="hint">Preparando ${photoQueue} foto(s)…</p>`:'');
}
function openGallery(site,title){
  galSite=site;galTitle=title||'Fotos';GAL=[];
  if(galUnsub){galUnsub();galUnsub=null}
  let q=db.collection('photos').where('site','==',site);
  if(!P.fotos)q=q.where('driver','==',ME);
  galUnsub=q.onSnapshot(s=>{GAL=s.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>(b.atMs||0)-(a.atMs||0));renderGallery()},e=>{console.error(e);$('galBody').innerHTML='<p class="authmsg bad">Não consegui carregar as fotos ('+esc(e.code||'erro')+').</p>'});
  $('gallery').hidden=false;document.body.classList.add('modal-open');renderGallery();
}
function closeGallery(){galSite=null;if(galUnsub){galUnsub();galUnsub=null}$('gallery').hidden=true;if(!viewing)document.body.classList.remove('modal-open')}
function renderGallery(){
  if(!galSite)return;
  $('galTitle').textContent=galTitle;
  needThumbs(GAL,renderGallery);
  const today=D.jobs.find(j=>jobSite(j)===galSite&&(P.fotos||myJobs().includes(j)));
  const days=[];GAL.forEach(p=>{let g=days.find(x=>x.date===p.date);if(!g)days.push(g={date:p.date,list:[]});g.list.push(p)});
  $('galBody').innerHTML=(today?camBtns(today.id):'')+(photoQueue?`<p class="hint">Preparando ${photoQueue} foto(s)…</p>`:'')
    +(GAL.length?`<div class="galtools"><span>${GAL.length} foto${GAL.length>1?'s':''} em ${days.length} dia${days.length>1?'s':''}</span><button class="btn" id="zipAll">⬇️ Baixar todas (.zip)</button></div>`:'')
    +(days.length?days.map(g=>`<h3 class="galday">${esc(dateBR(g.date))}</h3><div class="phgrid big">${g.list.map(p=>thumbBtn(p,(p.driver?p.driver+' · ':'')+hhmm(p.atMs))).join('')}</div>`).join('')
      :'<p class="empty">Nenhuma foto desta obra ainda.</p>');
}
async function zipAll(btn){
  const list=GAL.slice();if(!list.length)return;
  btn.disabled=true;const label=btn.textContent;
  try{
    if(!window.JSZip)await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)});
    const zip=new JSZip();let n=0;
    for(const p of list){
      n++;btn.textContent=`Juntando ${n} de ${list.length}…`;
      const s=await db.doc('photoFull/'+p.id).get();if(!s.exists)continue;
      const t=new Date(p.atMs);
      zip.file(`${p.date}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}_${(p.driver||'foto').replace(/[^\w-]+/g,'-')}.jpg`,s.data().data.split(',')[1],{base64:true});
    }
    btn.textContent='Gerando arquivo…';
    const blob=await zip.generateAsync({type:'blob'});
    await dl.save({filename:'fotos_'+galTitle.replace(/[^\w-]+/g,'-').replace(/-+/g,'-').slice(0,60)+'.zip',data:blob});
  }catch(e){console.error(e);toast('Não consegui gerar o .zip. Confira a internet e tente de novo.')}
  finally{btn.disabled=false;btn.textContent=label}
}
async function openViewer(id){
  const p=GAL.find(x=>x.id===id)||PHOTOS.find(x=>x.id===id)||ALLPH.find(x=>x.id===id);if(!p)return;
  viewing=p;$('phview').hidden=false;document.body.classList.add('modal-open');
  $('pvImg').src=THUMB[id]||'';$('pvInfo').textContent=`${p.company||''} · ${p.driver||''} · ${new Date(p.atMs).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`;
  $('pvDel').hidden=!(P.fotos||p.by===(ctx&&ctx.email));$('pvDel').textContent='Apagar';delete $('pvDel').dataset.confirm;
  try{const s=await db.doc('photoFull/'+id).get();if(viewing===p&&s.exists)$('pvImg').src=s.data().data}catch(e){console.error(e)}
}
function closeViewer(){viewing=null;$('phview').hidden=true;$('pvImg').src='';if(!galSite)document.body.classList.remove('modal-open')}
async function deletePhoto(id){for(const c of ['photos','photoThumb','photoFull']){try{await db.doc(c+'/'+id).delete()}catch(e){if(c==='photos')throw e}}}

/* aba Fotos: todas as obras com fotos (só pra quem tem "Ver todas as fotos") */
let ALLPH=[];
async function loadAllPhotos(){
  if(!P.fotos)return;
  $('siteList').innerHTML='<p class="hint">Carregando…</p>';
  try{const s=await db.collection('photos').orderBy('atMs','desc').limit(2000).get();ALLPH=s.docs.map(d=>Object.assign({id:d.id},d.data()));renderSites()}
  catch(e){console.error(e);$('siteList').innerHTML='<p class="authmsg bad">Não consegui carregar ('+esc(e.code||'erro')+').</p>'}
}
function renderSites(){
  const q=akey($('siteSearch').value||'');
  const map=new Map();
  ALLPH.forEach(p=>{const k=p.site||siteKey(p.company,p.address);let g=map.get(k);if(!g)map.set(k,g={site:k,company:p.company||'Obra',address:p.address||'',n:0,last:p.date,cover:p,days:new Set()});g.n++;g.days.add(p.date)});
  const list=[...map.values()].filter(g=>!q||akey(g.company+' '+g.address).includes(q));
  needThumbs(list.map(g=>g.cover),renderSites);
  $('siteList').innerHTML=list.length?list.map(g=>`<button class="sitecard" data-site="${esc(g.site)}" data-title="${esc(g.company+(g.address?' · '+g.address:''))}">
      <span class="sitecover">${THUMB[g.cover.id]?`<img src="${THUMB[g.cover.id]}" alt="">`:''}</span>
      <span class="siteinfo"><b>${esc(g.company)}</b><small>${esc(g.address||'Sem endereço')}</small><small>${g.n} foto${g.n>1?'s':''} · ${g.days.size} dia${g.days.size>1?'s':''} · última ${esc(dateBR(g.last))}</small></span></button>`).join('')
    :`<p class="empty">${ALLPH.length?'Nenhuma obra encontrada com esse nome.':'Ainda não tem nenhuma foto.'}</p>`;
}
if($('tab-photos')){$('tab-photos').hidden=!P.fotos||viewer;$('tab-photos').onclick=()=>{tab('photos');loadAllPhotos()}}
$('siteSearch').addEventListener('input',renderSites);

document.addEventListener('change',e=>{const jid=e.target.dataset&&e.target.dataset.upjob;if(!jid)return;const j=findJob(jid);const files=[...e.target.files];e.target.value='';if(j&&files.length)uploadPhotos(j,files)});
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-ph]');if(t){openViewer(t.dataset.ph);return}
  const s=e.target.closest('[data-site]');if(s){openGallery(s.dataset.site,s.dataset.title);return}
  if(e.target.id==='zipAll')zipAll(e.target);
});
$('galClose').onclick=closeGallery;$('gallery').addEventListener('click',e=>{if(e.target.id==='gallery')closeGallery()});
$('pvClose').onclick=closeViewer;$('phview').addEventListener('click',e=>{if(e.target.id==='phview')closeViewer()});
$('pvSave').onclick=async()=>{if(!viewing)return;const p=viewing;
  const blob=await (await fetch($('pvImg').src)).blob();const t=new Date(p.atMs);
  await dl.save({filename:`${p.date}_${(p.company||'obra').replace(/[^\w-]+/g,'-')}_${pad(t.getHours())}${pad(t.getMinutes())}.jpg`,data:blob})};
$('pvDel').onclick=async()=>{if(!viewing)return;const b=$('pvDel');
  if(b.dataset.confirm!=='1'){b.dataset.confirm='1';b.textContent='Toque de novo pra apagar';return}
  const id=viewing.id;closeViewer();
  try{await deletePhoto(id);ALLPH=ALLPH.filter(x=>x.id!==id);toast('Foto apagada')}catch(e){toast('Não consegui apagar ('+(e.code||'erro')+')')}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(viewing)closeViewer();else if(galSite)closeGallery()}});

// Limpeza automática: quem tem "Ver todas as fotos" apaga, ao abrir o app, as fotos com mais de 1 ano
async function cleanupOldPhotos(){
  if(!P.fotos||!isAdmin)return;
  try{
    const old=await db.collection('photos').where('expireAt','<',new Date()).limit(100).get();
    for(const d of old.docs)await deletePhoto(d.id);
    if(old.size)console.log('Fotos antigas apagadas:',old.size);
  }catch(e){console.error(e)}
}
setTimeout(cleanupOldPhotos,8000);

/* ---------- modo Totem (tablet no shop: cada um toca no nome e faz check-in) ----------
   Grava em attendance/{data_jobId}: people[nome]='in' e times[nome]=hora. Não mexe na escala. */
const todayISO=()=>iso(new Date());
let totemOn=false,tPick=null,tTimer=null;
function openTotem(){
  totemOn=true;document.body.classList.add('totem-on');$('totem').hidden=false;
  if(cur!==todayISO())setDate(todayISO());
  $('tSearch').value='';renderTotem();clockTick();
  clearInterval(tTimer);tTimer=setInterval(()=>{clockTick();if(cur!==todayISO())setDate(todayISO())},15000);
}
function closeTotem(){if(ctx&&ctx.totem)return;totemOn=false;clearInterval(tTimer);document.body.classList.remove('totem-on');$('totem').hidden=true;tCancel()}
function clockTick(){const d=new Date();$('tClock').textContent=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase();$('tDate').textContent=dateBR(todayISO())}
function renderTotem(){
  if(!totemOn)return;
  const q=nkey($('tSearch').value||'');
  const jobs=D.jobs.filter(j=>j.crew.length);
  const html=jobs.map(j=>{
    const crew=j.crew.filter(c=>!q||nkey(c.name).includes(q));if(!crew.length)return '';
    return `<section class="tjob"><div class="tjh"><b>${esc(j.company||'Obra')}</b><span>shop ${esc(fmt(j.shop)||'—')}</span></div>
      <div class="tnames">${crew.map(c=>{const t=timeOf(j,c.name),done=attOf(j,c.name)==='in';
        return `<button class="tname${done?' done':''}${isLate(j,c.name)?' late':''}" data-tin="${j.id}" data-n="${esc(c.name)}">${esc(c.name)}${done?`<small>✓ ${t?esc(new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase()):'presente'}</small>`:''}</button>`}).join('')}</div></section>`}).join('');
  $('tBody').innerHTML=dayLoaded?(html||`<p class="tempty">${jobs.length?'Nenhum nome encontrado.':'Ainda não tem escala lançada pra hoje.'}</p>`):'<p class="tempty">Carregando…</p>';
}
function tAsk(j,name){
  if(attOf(j,name)==='in'){const t=timeOf(j,name);tShow(`<div class="tok">✓</div><h2>${esc(name)}</h2><p>Você já fez check-in${t?' às '+esc(new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase()):''}.</p>`,3000);return}
  tPick={jid:j.id,name};
  $('tModal').hidden=false;
  $('tModalBody').innerHTML=`<p class="tq">Você é</p><h2>${esc(name)}</h2><p class="tjobname">${esc(j.company||'')}</p>
    <div class="tbtns"><button class="btn primary tyes" id="tYes">Sim, fazer check-in</button><button class="btn tno" id="tNo">Não sou eu</button></div>`;
}
function tCancel(){tPick=null;$('tModal').hidden=true}
function tShow(html,ms){$('tModal').hidden=false;$('tModalBody').innerHTML=html;clearTimeout(tShow.t);tShow.t=setTimeout(tCancel,ms||2500)}
function tCheckin(){
  if(!tPick)return;const j=findJob(tPick.jid),name=tPick.name;tPick=null;if(!j)return tCancel();
  const prev=ATT[j.id]||{};const people=Object.assign({},prev.people||{}),times=Object.assign({},prev.times||{});
  const k=Object.keys(people).find(n=>nkey(n)===nkey(name))||name;people[k]='in';
  const now=new Date();times[k]=now.getTime();
  const docData={date:cur,jobId:j.id,site:jobSite(j),company:j.company||'',driver:prev.driver||jobDrivers(j)[0]||'',by:(ctx&&ctx.email)||'',people,times,at:now,atMs:now.getTime()};
  ATT[j.id]=docData;renderTotem();
  db.doc('attendance/'+cur+'_'+j.id).set(docData).catch(e=>{console.error(e);tShow('<div class="tbad">!</div><h2>Não salvou</h2><p>Chame o escritório ('+esc(e.code||'erro')+').</p>',5000)});
  const late=isLate(j,name);
  tShow(`<div class="tok">✓</div><h2>Bom dia, ${esc(name.split(' ')[0])}!</h2><p>Check-in às <b>${esc(now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase())}</b>${late?'<br><span class="tlate">depois do horário do shop</span>':''}</p><p class="tjobname">${esc(j.company||'')}</p>`,3000);
}
$('tBody').addEventListener('click',e=>{const b=e.target.closest('[data-tin]');if(!b)return;const j=findJob(b.dataset.tin);if(j)tAsk(j,b.dataset.n)});
$('tModal').addEventListener('click',e=>{if(e.target.id==='tYes')tCheckin();else if(e.target.id==='tNo'||e.target.id==='tModal')tCancel()});
$('tSearch').addEventListener('input',renderTotem);
$('tExit').onclick=closeTotem;
if($('openTotem')){$('openTotem').hidden=!P.escala||!!(ctx&&ctx.totem);$('openTotem').onclick=openTotem}

/* ---------- início ---------- */
(()=>{const tb=$('topbar');if(!tb)return;const set=()=>document.documentElement.style.setProperty('--topH',tb.offsetHeight+'px');set();
  try{new ResizeObserver(set).observe(tb)}catch(e){window.addEventListener('resize',set)}})();
if(viewer)tab('day');
$('date').value=cur;
S=normRoster(null);
setStatus('loading');renderJobs();renderRoster();
db.doc(ROSTER).onSnapshot(remoteRoster,e=>{console.error(e);setStatus('err')});
if(P.telefones)db.doc(PHONES).onSnapshot(remotePhones,e=>{console.error(e)});else phonesLoaded=true;
setStatus('ok');
watchDay();
if((ctx&&ctx.totem)||(location.hash==='#totem'&&P.escala))openTotem();
return {flushAll};
}
