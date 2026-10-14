
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
// Carro fixo (Cadastro → Veículos): vehicles[].d = motorista fixo daquele carro (ex.: Thiesny → 47)
const fixedVeh=n=>{const v=(S&&S.vehicles||[]).find(x=>x.d&&x.n&&nkey(x.d)===nkey(n));return v?v.n:''};
const isDriverName=n=>!!((S&&S.drivers||[]).find(x=>nkey(x)===nkey(n))||fixedVeh(n));
// ao escalar alguém com carro fixo, o carro já entra (se não estiver em outra obra no mesmo dia); dá pra trocar na lista
function autoVeh(n,j){const fv=fixedVeh(n);if(!fv)return '';const other=D.jobs.find(x=>x!==j&&x.crew.some(c=>c.v===fv))||(j.crew.some(c=>c.v===fv)?j:null);
  if(other){toast(`O ${fv} do ${n} já está em ${other===j?'outra pessoa desta obra':other.company||'outra obra'}`);return ''}return fv}
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
  offices:(d&&d.offices&&typeof d.offices==='object')?{...d.offices}:{},
  boss:(d&&typeof d.boss==='string')?d.boss:''}}
function normDay(d){const jobs=Array.isArray(d&&d.jobs)?clone(d.jobs):[];jobs.forEach(j=>{j.id=j.id||nid();j.need=+j.need||0;delete j.calc;j.travel=Number.isFinite(j.travel)?j.travel:null;j.autoShop=!!j.autoShop;j.early=Number.isFinite(j.early)?j.early:30;j.tk=j.tk||'';j.crew=Array.isArray(j.crew)?j.crew:[];['company','address','attire','shop','start','note'].forEach(k=>j[k]=j[k]||'');j.allWeek=!!j.allWeek;j.waiting=!!j.waiting;j.office=!!j.office;j.left=Number.isFinite(j.left)?j.left:0});return {date:cur,jobs,sent:(d&&d.sent&&typeof d.sent==='object')?{...d.sent}:{}}}

/* evita re-render enquanto a pessoa digita */
function typing(){const a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='SELECT')&&!a.id.startsWith('extra-')&&a.id!=='newWorker'}
function rerender(){if(typing()){deferred=true;return}renderJobs();renderRoster();renderCentral()}
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
  watchOff();
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
// Mensagem: obras da mesma companhia ficam juntas (na ordem em que a 1ª aparece na escala); o resto não muda
function msgOrder(jobs){const out=[],done=new Set();
  jobs.forEach(j=>{if(done.has(j))return;const k=nkey(j.company||'');
    const grp=k?jobs.filter(x=>!done.has(x)&&nkey(x.company||'')===k):[j];grp.forEach(x=>{done.add(x);out.push(x)})});
  return out}
function buildMsg(){
  if(!D.jobs.length)return '';
  return msgHeader()+'\n\n'+msgOrder(D.jobs).map(j=>{
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
/* ---------- Day off (marcado no Calendário, só admin): dayoff/AAAA-MM-DD {date, people{nome:{by,at}}} ---------- */
let OFF={},offUnsub=null,CALOFF={},calOffUnsub=null;
function watchOff(){if(offUnsub){offUnsub();offUnsub=null}OFF={};
  offUnsub=db.doc('dayoff/'+cur).onSnapshot(sn=>{const d=sn.exists?sn.data():null;OFF=(d&&d.people)||{};if(dayLoaded){if(typing())deferred=true;else renderJobs()}},e=>console.error(e))}
const offOf=(map,name)=>Object.keys(map||{}).some(n=>nkey(n)===nkey(name));
const isOff=name=>offOf(OFF,name);
const offMsg=name=>`🌴 ${tidy(name)} está de day off neste dia. Pra escalar, tire o day off no Calendário.`;
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
  {const seen={};D.jobs.forEach(j=>{if(j.waiting||!j.address.trim())return;const k=akey((j.company||'')+'|'+j.address);(seen[k]=seen[k]||[]).push(j)});
    Object.values(seen).filter(a=>a.length>1).forEach(a=>out.push(['warn',`${a.length} obras da ${a[0].company||'mesma companhia'} no mesmo endereço (${a[0].address}). Se são turmas de setores diferentes, tudo certo; se não, pode ser obra duplicada.`]))}
  D.jobs.forEach(j=>j.crew.filter(c=>isOff(c.name)).forEach(c=>out.push(['bad',`🌴 ${c.name} está de day off neste dia, mas está em ${j.company||'uma obra'}. Tire ele da obra (ou tire o day off no Calendário).`])));
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
  if(miss){const a=assignedSet();const free=S.workers.filter(w=>!a.has(w.toLowerCase())&&!isOff(w)).length;
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
  if(j.calc)return '<span class="tv-msg">⏰ Calculando tempo de viagem…</span>';
  const link=`<a href="${esc(mapsURL(j.address.trim()))}" target="_blank" rel="noopener">Conferir no Google Maps ↗</a>`;
  if(!j.tk&&j.travel==null&&sampler)return `<button class="linkbtn" data-act="calc" style="font-size:14px">⏰ Calcular viagem e horário do shop</button>${link}`;
  const err=j.travel==null?`<span class="tv-msg">${sampler?'Não consegui calcular. Digite os minutos:':'Digite os minutos de viagem:'}</span>`:'';
  return `${err}<label class="tv-in">⏰ <input type="number" min="0" max="300" inputmode="numeric" data-f="travel" value="${j.travel??''}" id="tm-${j.id}" aria-label="Minutos de viagem"> min de viagem</label>${link}`;
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
// recolher/abrir obra: qualquer obra recolhe ao tocar no cabeçalho; despachada já começa recolhida
const openLeft=new Map();
// ⏱ atraso: obra de hoje, ainda aguardando, depois do horário do shop (conta até despachar)
function lateMin(j){if(j.left||!j.shop||cur!==iso(new Date()))return 0;const s=new Date(cur+'T'+j.shop+':00').getTime();const m=Math.floor((Date.now()-s)/60000);return m>0?m:0}
function lateText(j){const m=lateMin(j);if(!m)return '';return '⏱ '+(m<60?m+' min':Math.floor(m/60)+'h'+String(m%60).padStart(2,'0'))+' atrasada'}
setInterval(()=>{document.querySelectorAll('[data-late]').forEach(el=>{const j=findJob(el.dataset.late);const t=j?lateText(j):'';if(el.textContent!==t)el.textContent=t})},20000);   // jobId -> true (aberta) / false (recolhida), escolha feita na tela
const isCollapsed=j=>openLeft.has(j.id)?!openLeft.get(j.id):!!j.left;
function renderJobs(){
  if(!dayLoaded||(mode==='cloud'&&!rosterLoaded)){$('jobs').innerHTML='<div class="panel empty">Carregando a escala…</div>';$('alerts').innerHTML='';$('preview').textContent='';$('stats').textContent='';return}
  const {dupNames}=analyze();
  const assigned=assignedSet();
  const jobs=D.jobs;
  $('jobs').innerHTML=jobs.length?jobs.map((j,i)=>{
    const crew=j.crew.map((c,ci)=>`<div class="member${dupNames.includes(c.name.trim().toLowerCase())?' dup':''}">
        <span class="nm">${attBadge(j,c)}${isOff(c.name)?'<span class="offtag" title="Day off">🌴</span>':''}${esc(c.name)}${isDriverName(c.name)?' <span class="drvmini" title="Motorista">🔑</span>':''}</span>
        ${P.escala?attMini(j,c):''}
        <select data-act="veh" data-ci="${ci}" aria-label="Veículo de ${esc(c.name)}" id="vs-${j.id}-${ci}">${vehOptions(c.v)}</select>
        <span class="mord"><button class="mv" data-act="mup" data-ci="${ci}" aria-label="Subir ${esc(c.name)}"${ci===0?' disabled':''}>↑</button><button class="mv" data-act="mdown" data-ci="${ci}" aria-label="Descer ${esc(c.name)}"${ci===j.crew.length-1?' disabled':''}>↓</button></span>
        <button class="x" data-act="rm" data-ci="${ci}" aria-label="Tirar ${esc(c.name)}">×</button></div>`).join('')||'<div class="empty">Ninguém escalado ainda.</div>';
    let picker='';
    if(openPick===j.id){
      const free=S.workers.filter(w=>!assigned.has(w.toLowerCase())&&!isOff(w));
      const offW=S.workers.filter(w=>isOff(w)&&!j.crew.some(c=>c.name.toLowerCase()===w.toLowerCase()));
      const busyW=S.workers.filter(w=>assigned.has(w.toLowerCase())&&!isOff(w)&&!j.crew.some(c=>c.name.toLowerCase()===w.toLowerCase()));
      picker=`<div class="picker">
        <div class="chips">${free.map(w=>`<button class="chip" data-act="pick" data-name="${esc(w)}">${esc(w)}</button>`).join('')||'<span class="empty">Todos os fixos já estão escalados.</span>'}</div>
        ${offW.length?`<div class="offrow"><span class="hint">🌴 Day off:</span> ${offW.map(w=>`<button class="chip off" data-act="pickoff" data-name="${esc(w)}">🌴 ${esc(w)}</button>`).join('')}</div>`:''}
        ${busyW.length?`<details><summary class="hint">Já escalados em outra obra (${busyW.length})</summary><div class="chips" style="margin-top:6px">${busyW.map(w=>`<button class="chip busy" data-act="pick" data-name="${esc(w)}">${esc(w)}</button>`).join('')}</div></details>`:''}
        <div class="extra"><input id="extra-${j.id}" placeholder="Nome extra (não cadastrado)"><button class="btn" data-act="extra">Adicionar</button></div>
        <button class="btn" data-act="pickclose">Pronto</button></div>`;
    }
    const collapsed=isCollapsed(j);
    return `<article class="job${collapsed?' collapsed':''}" data-id="${j.id}">
      <div class="job-head">
        <span class="num">${i+1}</span><span class="chev" title="${collapsed?'Abrir':'Recolher'}" aria-hidden="true">${collapsed?'▸':'▾'}</span>
        <input data-f="company" list="companyList" value="${esc(j.company)}" placeholder="Companhia" aria-label="Companhia" id="co-${j.id}">
        <button class="leftdot${j.left?' on':''}" data-act="left" aria-pressed="${!!j.left}" title="${j.left?'Turma já saiu (toque pra desfazer)':'Turma ainda não saiu (toque quando sair)'}" aria-label="${j.left?'Turma já saiu':'Turma ainda não saiu'}"><span class="dot"></span></button>${j.left?'<span class="wkbadge sentbadge">Despachada</span>':'<span class="wkbadge waitbadge">Aguardando</span>'}
        <span class="wkbadge" ${j.allWeek?'':'hidden'}>All Week</span>
        <span class="latetimer" data-late="${j.id}">${lateText(j)}</span>
        <button class="icon-btn" data-act="up" aria-label="Subir">↑</button>
        <button class="icon-btn" data-act="down" aria-label="Descer">↓</button>
      </div>
      <div class="job-body"${collapsed?' hidden':''}>
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
  if(!$('view-cal').hidden){renderCal();if(calSel)renderCalDay()}
  const {out:all}=analyze();
  // avisos amarelos conferidos (guardado neste aparelho, por dia): somem até aparecer um aviso novo
  const ack=ackGet(),out=all.filter(o=>!(o[0]==='warn'&&ack.includes(o[1]))),nAck=all.length-out.length,nWarn=out.filter(o=>o[0]==='warn').length;
  $('alerts').innerHTML=(out.length?out:[['ok','Tudo certo: ninguém repetido e todas as obras com veículo.']]).map(([k,t])=>`<div class="alert ${k}">${esc(t)}</div>`).join('')
    +(nWarn&&!viewer?`<button class="linkbtn ackbtn" id="ackAlerts">✓ Já conferi os avisos amarelos</button>`:'')
    +(nAck?`<small class="ackinfo">${nAck} aviso${nAck>1?'s':''} já conferido${nAck>1?'s':''} · <button class="linkbtn" id="ackUndo">mostrar de novo</button></small>`:'');
  $('preview').textContent=buildMsg()||(viewer?'Nenhuma escala lançada pra este dia ainda.':'(sem obras)');
  if(viewer)$('msgTitle').innerHTML='Escala <small>'+esc(dateBR())+'</small>';
  const a=assignedSet();const free=S.workers.filter(w=>!a.has(w.toLowerCase())&&!isOff(w));const offs=Object.keys(OFF);
  $('free').innerHTML=(free.map(w=>`<span class="chip">${esc(w)}</span>`).join('')||'<span class="empty">Todos os fixos estão escalados.</span>')+offs.map(w=>`<span class="chip" title="Day off">❌ ${esc(w)}</span>`).join('');
  $('freeCount').textContent=free.length+' de '+S.workers.length;
  if(!(document.activeElement&&document.activeElement.classList.contains('ntphone')))renderNotify();
  renderPhotos();
  renderReport();
  const people=D.jobs.reduce((s,j)=>s+j.crew.length,0);
  const bad=out.filter(o=>o[0]!=='ok').length;
  const needed=D.jobs.reduce((s,j)=>s+Math.max(j.need||0,j.crew.length),0);
  const asg=assignedSet(),semObra=S.workers.filter(w=>!asg.has(w.toLowerCase())&&!isOff(w)).length;
  $('stats').innerHTML=`<b>${D.jobs.length}</b> obras · <b>${people}</b>${needed>people?' de <b>'+needed+'</b>':''} pessoas`
    +(S.workers.length&&D.jobs.length?(semObra?` · <button class="statlink warn" data-go="free">👷 <b>${semObra}</b> fora do schedule</button>`:` · <span style="color:var(--ok)">✓ todos encaixados</span>`):'')
    +(bad?` · <button class="statlink bad" data-go="alerts"><b>${bad}</b> aviso${bad>1?'s':''}</button>`:'');
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
$('jobs').addEventListener('click',e=>{
  if(e.target.closest('[data-act]'))return;
  const head=e.target.closest('.job-head');if(!head)return;
  const card=head.closest('.job');const j=findJob(card.dataset.id);if(!j)return;
  if(e.target.tagName==='INPUT'&&!card.classList.contains('collapsed'))return;   // aberto: clicar no nome é pra editar
  openLeft.set(j.id,isCollapsed(j));
  e.preventDefault();if(document.activeElement)document.activeElement.blur();renderJobs();
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
  else if(act==='pickoff'){toast(offMsg(b.dataset.name));return}
  else if(act==='pick'){const n=b.dataset.name;if(isOff(n)){toast(offMsg(n));return}if(!j.crew.some(c=>c.name.toLowerCase()===n.toLowerCase()))j.crew.push({name:n,v:autoVeh(n,j)})}
  else if(act==='extra'){const inp=$('extra-'+j.id);const n=fmtName(inp.value);if(n&&isOff(n)){toast(offMsg(n));return}if(n&&!j.crew.some(c=>c.name.toLowerCase()===n.toLowerCase()))j.crew.push({name:n,v:autoVeh(n,j)})}
  else if(act==='up'&&i>0){jobs.splice(i,1);jobs.splice(i-1,0,j)}
  else if(act==='down'&&i<jobs.length-1){jobs.splice(i,1);jobs.splice(i+1,0,j)}
  else if(act==='left'){j.left=j.left?0:Date.now();openLeft.delete(j.id);if(j.left&&j.allWeek){saveDay();copyJobToNext(j,b,true)}}   // All Week: ao confirmar a saída, já vai pro dia seguinte
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
// src = id da obra original (a cópia guarda de onde veio), pra saber se é a MESMA turma ou outra turma no mesmo endereço
const srcOf=x=>x.src||x.id;
async function copyJobToNext(j,btn,auto){
  const [y,m,d]=cur.split('-').map(Number);const next=iso(new Date(y,m-1,d+1));
  const nice=dateBR(next);btn.disabled=true;
  try{
    const snap=await db.doc(dayPath(next)).get();const day=snap.exists?snap.data():{date:next,jobs:[],sent:{}};
    const jobs=Array.isArray(day.jobs)?day.jobs:[];
    const key=x=>akey((x.company||'')+'|'+(x.address||''));
    if(jobs.some(x=>srcOf(x)===srcOf(j))){toast(`Essa turma da ${j.company||'obra'} já está em ${nice}`);return}
    const same=jobs.filter(x=>key(x)===key(j));
    if(same.length){
      if(auto){if(same.some(x=>!x.src))return}   // All Week automático: cópia antiga (sem src) = mesma obra, não duplica
      else if(!confirm(`Já tem ${same.length>1?same.length+' obras':'uma obra'} da ${j.company||'companhia'} nesse endereço em ${nice}.\n\nÉ outra turma (outro setor)? Toque OK pra copiar mesmo assim.`))return;
    }
    const {calc,prevAddr,left,...rest}=clone(j);
    jobs.push(Object.assign(rest,{id:nid(),src:srcOf(j)}));
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
  // cada turma = src (id da obra original). Obras antigas sem src: mesma companhia+endereço em dias diferentes = mesma obra.
  const found=new Map();days.forEach(b=>(b.jobs||[]).forEach(j=>{if(!j.allWeek)return;
    let k='S:'+srcOf(j);
    if(!j.src&&!found.has(k)){const old=[...found.entries()].find(([,v])=>key(v.j)===key(j)&&v.date!==b.date&&!v.j.src);if(old)k=old[0]}
    found.set(k,{j,date:b.date})}));
  const haveSrc=new Set(D.jobs.map(srcOf)),haveKey=new Set(D.jobs.filter(x=>!x.src).map(key));
  const add=[...found.values()].map(v=>v.j).filter(j=>!haveSrc.has(srcOf(j))&&!(haveKey.has(key(j))&&!j.src));
  if(!found.size){toast('Nenhuma obra marcada como All Week nesta semana');return}
  if(!add.length){toast('As obras All Week já estão neste dia');return}
  add.forEach(j=>D.jobs.push({...clone(j),id:nid(),src:srcOf(j),left:0}));
  saveDay();renderJobs();toast(add.length+(add.length>1?' obras trazidas':' obra trazida'));
};
$('clearDay').onclick=()=>{if(!P.apagar)return;if(confirmClear){D.jobs=[];D.sent={};confirmClear=false;$('clearDay').textContent='Limpar dia';saveDay();renderJobs()}else{confirmClear=true;$('clearDay').textContent='Toque de novo pra limpar'}};

$('stats').addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(!b)return;if(b.dataset.go==='free'){const asg=assignedSet();const n=S.workers.filter(w=>!asg.has(w.toLowerCase())&&!isOff(w));toast('👷 Fora do schedule: '+n.join(', '),6000);if(innerWidth<900)return}const el0=$(b.dataset.go),el=el0&&(el0.closest('.panel')||el0);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});const p=el.closest('.panel')||el;p.classList.remove('flash');void p.offsetWidth;p.classList.add('flash')}});
const ackKey=()=>'ackAlerts-'+cur;
function ackGet(){try{return JSON.parse(localStorage.getItem(ackKey())||'[]')}catch(e){return []}}
function ackSet(a){try{a.length?localStorage.setItem(ackKey(),JSON.stringify(a)):localStorage.removeItem(ackKey())}catch(e){}}
$('alerts').addEventListener('click',e=>{
  if(e.target.id==='ackAlerts'){if(!confirm('Você já conferiu e corrigiu os avisos amarelos?\n\nEles somem e só voltam se aparecer algum aviso novo. Os vermelhos continuam até serem corrigidos.'))return;
    ackSet([...new Set([...ackGet(),...analyze().out.filter(o=>o[0]==='warn').map(o=>o[1])])]);refresh(false)}
  else if(e.target.id==='ackUndo'){ackSet([]);refresh(false)}
});
/* ---------- data ---------- */
function setDate(d){flushAll();cur=d;$('date').value=d;openPick=null;confirmDel=null;confirmClear=false;$('clearDay').textContent='Limpar dia';watchDay()}
$('date').onchange=e=>{if(e.target.value)setDate(e.target.value)};
const shift=n=>{const[y,m,d]=cur.split('-').map(Number);setDate(iso(new Date(y,m-1,d+n)))};
$('prevDay').onclick=()=>shift(-1);$('nextDay').onclick=()=>shift(1);

/* ---------- copiar ---------- */
function toast(t,ms){const el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,ms||2200)}
$('copyMsg').onclick=()=>{
  const txt=buildMsg();if(!txt){toast('Não tem obra pra copiar');return}
  const fb=()=>{const ta=$('fallback');ta.value=txt;ta.select();try{document.execCommand('copy');toast('Mensagem copiada')}catch(e){toast('Selecione o texto da prévia e copie')}};
  try{navigator.clipboard.writeText(txt).then(()=>toast('Mensagem copiada. Cole no WhatsApp'),fb)}catch(e){fb()}
};

/* ---------- abas ---------- */
function tab(which){['day','roster','access','photos','search','cal'].forEach(t=>{const b=$('tab-'+t),v=$('view-'+t);if(b)b.setAttribute('aria-selected',t===which);if(v)v.hidden=t!==which})}
$('tab-day').onclick=()=>{tab('day');renderJobs()};$('tab-roster').onclick=()=>{tab('roster');renderRoster()};if($('tab-access'))$('tab-access').onclick=()=>tab('access');

/* ---------- cadastro ---------- */
$('baseAddr').addEventListener('change',e=>{const v=fmtAddress(e.target.value);e.target.value=v;if(v&&v!==S.base){S.base=v;S.travel={};saveRoster();toast('Endereço da empresa salvo. Tempos serão recalculados nas próximas obras')}});
function renderRoster(){
  if(document.activeElement!==$('baseAddr'))$('baseAddr').value=S.base;
  if($('bossPhone')&&document.activeElement!==$('bossPhone')){$('bossPhone').value=S.boss||'';$('bossPhone').disabled=!P.cadastro}
  $('wCount').textContent=S.workers.length+' fixos';
  $('workers').innerHTML=S.workers.map((w,i)=>`<div class="lrow"><input class="wname" data-wn="${i}" value="${esc(w)}" aria-label="Nome" id="wn-${i}">
    <button class="drvtag${isDriverName(w)?' on':''}" data-drv="${i}" aria-pressed="${isDriverName(w)}" title="Motorista / responsável pela obra">🔑<span> Motorista</span></button>
    ${P.telefones?'':'<!--'}<input class="wphone${phoneOf(w)&&!waDigits(phoneOf(w))?' bad':''}" data-wp="${esc(w)}" value="${esc(phoneOf(w))}" placeholder="Telefone" inputmode="tel" aria-label="Telefone de ${esc(w)}" id="wp-${i}">${P.telefones?'':'-->'}
    <button class="x" data-wi="${i}" aria-label="Remover ${esc(w)}">×</button></div>`).join('')||'<span class="empty">Nenhum trabalhador cadastrado ainda.</span>';
  $('vehicles').innerHTML=S.vehicles.map((v,i)=>`<div class="lrow">
    <select data-vi="${i}" data-k="t" aria-label="Tipo" id="vt-${i}"><option${v.t==='🛻'?' selected':''}>🛻</option><option${v.t==='🚐'?' selected':''}>🚐</option><option${v.t==='🚚'?' selected':''}>🚚</option></select>
    <input class="vnum" data-vi="${i}" data-k="n" value="${esc(v.n)}" inputmode="numeric" aria-label="Número" id="veh-${i}">
    <select class="grow vdsel" data-vi="${i}" data-k="d" aria-label="Motorista fixo do ${esc(v.n)}" id="vd-${i}"><option value="">Sem motorista fixo</option>${
      [...new Set([...S.workers,...(v.d?[v.d]:[])])].map(w=>`<option${v.d===w?' selected':''}>${esc(w)}</option>`).join('')}</select>
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
  S.vehicles.forEach(v=>{if(v.d&&nkey(v.d)===nkey(old))v.d=nv});
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
    if(on&&fixedVeh(w)){toast(w+' é motorista fixo do '+fixedVeh(w)+'. Pra desmarcar, tire ele do carro em Veículos.');return}
    S.drivers=on?S.drivers.filter(x=>nkey(x)!==nkey(w)):[...S.drivers,w];saveRoster();renderRoster();
    if(P.escala&&D.jobs.length)saveDay();renderJobs();toast(on?w+' não é mais motorista':w+' marcado como motorista');return}
  const b=e.target.closest('[data-wi]');if(b){const w=S.workers[+b.dataset.wi];S.workers.splice(+b.dataset.wi,1);S.drivers=S.drivers.filter(x=>nkey(x)!==nkey(w));S.vehicles.forEach(v=>{if(v.d&&nkey(v.d)===nkey(w))delete v.d});saveRoster();renderRoster();refresh(false)}};
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
$('vehicles').addEventListener('input',e=>{const t=e.target;if(t.dataset.vi!=null){
  const k=t.dataset.k,val=t.value.trim(),veh=S.vehicles[+t.dataset.vi];
  if(k==='d'){if(val){const dup=S.vehicles.find(x=>x!==veh&&x.d===val);if(dup){delete dup.d;toast(val+' saiu do '+dup.n+' e agora é motorista fixo do '+(veh.n||'carro'))}veh.d=val}else delete veh.d;
    saveRoster();renderRoster();if(P.escala&&D.jobs.length)saveDay();renderJobs();return}
  veh[k]=val;saveRoster()}});
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
async function allAttendance(){const out=[];let after='';
  for(;;){let q=db.collection('attendance');if(after)q=q.where('date','>',after);const s=await q.orderBy('date','asc').limit(500).get();
    s.docs.forEach(d=>{const x=d.data();if(x){const {at,...r}=x;out.push(Object.assign({_id:d.id},r))}});if(s.size<500)break;after=s.docs[s.size-1].data().date}
  return out}
$('bkFull').onclick=async e=>{const btn=e.currentTarget;flushAll();let days,attendance=[],dayoff=[];try{days=await allDays()}catch(err){toast('Não consegui ler as escalas');return}
  try{attendance=await allAttendance()}catch(err){console.error(err)}
  try{dayoff=(await db.collection('dayoff').get()).docs.map(d=>d.data())}catch(err){console.error(err)}
  await offer('cruz-schedule-backup-'+iso(new Date())+'.json',JSON.stringify({app:'cruz-schedule',version:2,exportedAt:new Date().toISOString(),roster:Object.assign({},S,P.telefones?{phones:PH}:{}),days,attendance,dayoff},null,1),btn)};
let pendingImport=null;
$('importFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const o=JSON.parse(await f.text());if(!o||o.app!=='cruz-schedule'||!o.roster||!Array.isArray(o.days))throw 0;
    pendingImport=o;const r=normRoster(o.roster);
    $('importInfo').innerHTML=`Arquivo com <b>${r.workers.length}</b> trabalhadores, <b>${Object.keys(r.companies).length}</b> companhias, <b>${o.days.length}</b> dia(s) de escala e <b>${(o.attendance||[]).length}</b> registro(s) de presença. <button class="btn primary" id="importGo">Importar agora</button> <button class="linkbtn" id="importCancel">Cancelar</button><br><small>O cadastro atual será substituído pelo do arquivo. Dias com a mesma data também.</small>`;
    $('importInfo').hidden=false}
  catch(err){toast('Esse arquivo não é um backup do Cruz Schedule')}};
$('importInfo').addEventListener('click',async e=>{
  if(e.target.id==='importCancel'){pendingImport=null;$('importInfo').hidden=true;return}
  if(e.target.id!=='importGo'||!pendingImport)return;
  e.target.disabled=true;e.target.textContent='Importando…';
  try{S=normRoster(pendingImport.roster);lastSent[ROSTER]=stable(S);await db.doc(ROSTER).set(clone(S));
    if(P.telefones&&pendingImport.roster.phones){PH={...pendingImport.roster.phones};lastSent[PHONES]=stable({phones:PH});await db.doc(PHONES).set({phones:PH})}
    for(const d of pendingImport.days){if(d&&/^\d{4}-\d{2}-\d{2}$/.test(d.date))await db.doc(dayPath(d.date)).set({date:d.date,jobs:d.jobs||[],sent:d.sent||{},drivers:d.drivers||{}})}
    for(const a of (pendingImport.attendance||[])){if(a&&a._id&&a.date&&a.jobId){const {_id,...r}=a;await db.doc('attendance/'+_id).set(r)}}
    for(const o of (pendingImport.dayoff||[])){if(o&&/^\d{4}-\d{2}-\d{2}$/.test(o.date)&&o.people)await db.doc('dayoff/'+o.date).set({date:o.date,people:o.people})}
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
    renderPhotos();renderTotem();renderCentral();
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

/* ---------- Central (tela do escritório: TV/tablet, só pra ver) ----------
   Abre por #central (com login) ou #demo-central (dados de exemplo). Mostra sempre o dia de hoje, ao vivo. */
let centralOn=false,cTimer=null,cUnsub=null,cLock=null;
const hm12=ms=>new Date(ms).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase().replace(' ','');
async function keepAwake(){try{if(centralOn&&navigator.wakeLock&&document.visibilityState==='visible')cLock=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',keepAwake);
function openCentral(){
  centralOn=true;document.body.classList.add('totem-on');$('central').hidden=false;
  if(cur!==todayISO())setDate(todayISO());
  watchNextDays();renderCentral();keepAwake();
  const openedOn=todayISO();
  clearInterval(cTimer);cTimer=setInterval(()=>{if(todayISO()!==openedOn&&!cUnlocked&&!cDetail&&$('cPin').hidden){location.reload();return}if(cur!==todayISO())setDate(todayISO());renderCentral()},20000);   // virou o dia: recarrega (pega a versão nova do app)
}
function closeCentral(){
  centralOn=false;clearInterval(cTimer);if(cUnsub){cUnsub();cUnsub=null}
  try{cLock&&cLock.release()}catch(e){}cLock=null;
  try{document.fullscreenElement&&document.exitFullscreen()}catch(e){}
  document.body.classList.remove('totem-on');$('central').hidden=true;
  if(/central/.test(location.hash))history.replaceState(null,'',location.pathname+location.search+(location.hash.startsWith('#demo-central')?'#demo':''));
}
function watchNextDays(){
  if(cUnsub){cUnsub();cUnsub=null}
  const a=new Date();a.setDate(a.getDate()+1);const b=new Date();b.setDate(b.getDate()+4);
  cUnsub=db.collection('days').where('date','>=',iso(a)).where('date','<=',iso(b)).onSnapshot(s=>{CNEXT={};s.docs.forEach(d=>{const x=d.data();if(x&&x.date)CNEXT[x.date]=x});renderCentral()},e=>console.error(e));
}
/* Central: a cada 5 min confere se saiu versão nova do app (VERSION do sw.js); se saiu e ninguém está mexendo, recarrega sozinha */
let appVer=null;
async function swVersion(){try{const r=await fetch('sw.js?v='+Date.now(),{cache:'no-store'});const m=(await r.text()).match(/VERSION\s*=\s*'([^']+)'/);return m?m[1]:null}catch(e){return null}}
swVersion().then(v=>{appVer=v});
setInterval(async()=>{if(!centralOn)return;const v=await swVersion();if(!v)return;if(!appVer){appVer=v;return}
  if(v!==appVer&&!cUnlocked&&!cDetail&&$('cPin').hidden)location.reload()},300000);
/* Central: um PIN (guardado só neste aparelho) destrava despachar, presença e abrir o editor. Tranca sozinha após 1 min parado. */
const cOpen=new Set();let cPage=0,cPages=1,cDetail=null,cKinds=[],CNEXT={};let cUnlocked=false,cIdle=null,pinBuf='',pinStage='enter',pinFirst='',cBackIdle=null;
const PINKEY='centralPin'+(ctx&&ctx.email==='demo@exemplo'?'-demo':'');
const getPin=()=>{try{return localStorage.getItem(PINKEY)||''}catch(e){return ''}};
const setPin=v=>{try{v?localStorage.setItem(PINKEY,v):localStorage.removeItem(PINKEY)}catch(e){}};
function cRelock(){cUnlocked=false;clearTimeout(cIdle);renderCentral()}
function cTouch(){if(!cUnlocked)return;clearTimeout(cIdle);cIdle=setTimeout(cRelock,60000)}
function renderCentral(){
  if(!centralOn)return;
  $('cClock').textContent=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase();
  const [yy,mm,dd]=todayISO().split('-');
  $('cDate').textContent=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(+yy,mm-1,+dd).getDay()]+', '+dd+'/'+mm;
  $('cLockBtn').hidden=!cUnlocked;
  if(!dayLoaded){$('cBody').innerHTML='<p class="tempty">Carregando…</p>';$('cStats').innerHTML='';return}
  const jobs=D.jobs.filter(j=>j.company||j.crew.length);
  let esc_=0,pres=0,falt=0;
  jobs.forEach(j=>{esc_+=j.crew.length;j.crew.forEach(c=>{const st=attOf(j,c.name);if(st==='in')pres++;else if(st==='out')falt++})});
  const desp=jobs.filter(j=>j.left).length;
  const pill=(n,k,c)=>`<div class="cpill${c?' '+c:''}"><b>${n}</b><span>${k}</span></div>`;
  $('cStats').innerHTML=pill(jobs.length,jobs.length===1?'obra':'obras')+pill(desp+'/'+jobs.length,'despachadas',jobs.length&&desp===jobs.length?'ok':'')
    +((pres||falt)?pill(pres+'/'+esc_,'presentes','ok'):'')+pill(falt,falt===1?'falta':'faltas',falt?'bad':'');
  const name=j=>esc(tidy(j.company)||'Obra');
  const city=j=>{if(j.waiting||!j.address)return '(Esperando endereço)';const p=fmtAddress(j.address).split(',');return esc((p[1]||p[0]||'').trim())};
  const lateTxt=j=>{const m=lateMin(j);return m<60?m+' min':Math.floor(m/60)+'h'+String(m%60).padStart(2,'0')};
  const stOf=j=>j.left?'done':lateMin(j)?'late':'wait';
  const shortTxt=j=>{const n=Math.max(0,(+j.need||0)-j.crew.length);return n?(n>1?'faltam '+n+' pessoas':'falta 1 pessoa'):''};
  const marked=j=>j.crew.filter(c=>attOf(j,c.name)==='in').length;
  const people=j=>{const m=marked(j);return j.left&&m?m+'/'+j.crew.length:String(j.crew.length)};
  const crewList=j=>j.crew.length?`<ul class="ccrew${cUnlocked?' edit':''}">${j.crew.map(c=>{const a=attOf(j,c.name),v=c.v?vLabel(c.v):'';
    const btns=cUnlocked?`<span class="cab2"><button class="cyes${a==='in'?' on':''}" data-catt="${j.id}" data-n="${esc(c.name)}" data-s="in" aria-label="Veio">✓</button><button class="cno${a==='out'?' on':''}" data-catt="${j.id}" data-n="${esc(c.name)}" data-s="out" aria-label="Faltou">✗</button></span>`:'';
    return `<li class="${a}">${cUnlocked?'':`<i>${a==='in'?'✓':a==='out'?'✗':'·'}</i>`}<span>${esc(tidy(c.name))}</span>${v?`<em>${esc(v)}</em>`:''}${btns}</li>`}).join('')}</ul>`:'<p class="cnone">Sem equipe ainda</p>';
  const actions=j=>cUnlocked
    ?`<div class="cacts"><button class="btn ${j.left?'':'primary '}cbig2" data-cact="left" data-cj2="${j.id}">${j.left?'↩ Desfazer despacho':'🚚 Despachar'}</button><button class="btn cbig2" data-cact="edit" data-cj2="${j.id}">✏️ Abrir editor</button></div>`
    :`<div class="cacts"><button class="btn cbig2" data-cact="unlock">🔒 Alterar</button></div>`;
  const order=j=>j.left?2:lateMin(j)?0:1;
  const list=[...jobs].sort((a,b)=>order(a)-order(b)||String(a.shop||'').localeCompare(String(b.shop||'')));
  const badge=j=>{const st=stOf(j);return `<span class="cst ${st}">${st==='done'?'DESPACHADA':st==='late'?'⏱ '+lateTxt(j)+' atrasada':'AGUARDANDO'}</span>`};
  const when=j=>j.left?'saiu <b>'+esc(hm12(j.left))+'</b>':'shop <b>'+esc(fmt(j.shop)||'—')+'</b>';
  const subOf=j=>[city(j),shortTxt(j)].filter(Boolean).join(' · ');
  const hint=`<p class="chint">${cUnlocked?'🔓 Destravado · tranca sozinho depois de 1 minuto parado':'Toque numa obra pra ver a equipe'}</p>`;
  // detalhe (quadradinhos): janela com a equipe e os botões
  if(cDetail){const j=list.find(x=>x.id===cDetail);
    if(!j){cDetail=null;$('cDet').hidden=true}
    else{$('cDet').hidden=false;$('cDetBody').innerHTML=`<div class="cdh"><div class="cn">${name(j)}<small>${subOf(j)}</small></div><button class="icon-btn" data-cdclose aria-label="Fechar">×</button></div>
      <div class="cdm">${when(j)} ${badge(j)} <span class="cc3">${people(j)} pessoas</span></div>${crewList(j)}${actions(j)}`}}
  else $('cDet').hidden=true;
  const body=$('cBody');
  // próximo dia de trabalho (amanhã; se o fim de semana estiver vazio, pula pra segunda)
  let nd=null;for(let i=1;i<=4&&!nd;i++){const d=new Date();d.setDate(d.getDate()+i);const ds=iso(d);const js=((CNEXT[ds]||{}).jobs||[]).filter(j=>j.company||(j.crew||[]).length);if(js.length)nd={ds,i,js}}
  const showT=!!nd&&(new Date().getHours()>=12||!jobs.length||desp===jobs.length);
  const w=body.clientWidth,cols=w>=1300?3:w>=720?2:1,gap=12;
  const tile=j=>{const st=stOf(j);return `<div class="ctile2 ${st}" data-cd="${j.id}"><div class="t2h"><span class="cdot2"></span><b>${name(j)}</b><span class="t2p">${people(j)} 👷</span></div>
    <div class="t2s">${badge(j)}<span class="t2w">${when(j)}</span></div><div class="t2m">${subOf(j)||'&nbsp;'}</div></div>`};
  const grid=arr=>`<div class="cgrid" style="--cols:${cols}">${arr.join('')}</div>`;
  const pages=[];let th=0;
  const measure=html=>{body.innerHTML=html;const t=body.querySelector('.ctile2');return t?t.offsetHeight:0};
  if(list.length){
    body.innerHTML='<div class="crows">'+list.map(j=>{const st=stOf(j),open=cOpen.has(j.id);
      return `<div class="crow ${st}${open?' open':''}"><div class="crl" data-cj="${j.id}"><span class="cdot2"></span><div class="cn">${name(j)}<small>${subOf(j)}</small></div>
        <div class="ct">${when(j)}</div>${badge(j)}<div class="cc">${people(j)}<small>pessoas</small></div></div>${open?crewList(j)+actions(j):''}</div>`}).join('')+'</div>'+hint;
    if(cOpen.size||body.scrollHeight<=body.clientHeight+2)pages.push({html:body.innerHTML});
    else{cOpen.clear();th=measure(grid([tile(list[0])]));
      const per=cols*Math.max(1,Math.floor((body.clientHeight+gap)/(th+gap)));
      for(let i=0;i<list.length;i+=per)pages.push({html:grid(list.slice(i,i+per).map(tile))})}
  }
  if(showT){
    const [y,m,d]=nd.ds.split('-');const wd=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(+y,m-1,+d).getDay()];
    const tj=[...nd.js].sort((a,b)=>String(a.shop||a.start||'').localeCompare(String(b.shop||b.start||'')));
    const tot=tj.reduce((n,j)=>n+Math.max(+j.need||0,(j.crew||[]).length),0);
    const banner=`<div class="ctmr"><b>${nd.i===1?'AMANHÃ':'PRÓXIMO DIA'} →</b><span class="ctd">${wd}, ${d}/${m}</span><span class="ctn">${tj.length} obra${tj.length>1?'s':''} · ${tot} pessoa${tot===1?'':'s'}</span></div>`;
    const tTile=j=>{const n=(j.crew||[]).length,need=+j.need||0;const warn=!n?'sem equipe ainda':need>n?(need-n>1?'faltam '+(need-n)+' pessoas':'falta 1 pessoa'):'';
      const c=j.waiting||!j.address?'(Esperando endereço)':esc((fmtAddress(j.address).split(',')[1]||fmtAddress(j.address).split(',')[0]||'').trim());
      return `<div class="ctile2 tmr"><div class="t2h"><b>${esc(tidy(j.company)||'Obra')}</b><span class="t2p">${need>n?n+'/'+need:n} 👷</span></div>
        <div class="t2s"><span class="t2w">${j.shop?'shop <b>'+esc(fmt(j.shop))+'</b> · ':''}start <b>${esc(fmt(j.start)||'—')}</b></span></div>
        <div class="t2m">${c}${warn?` · <span class="t2warn">${warn}</span>`:''}</div></div>`};
    body.innerHTML=banner+grid([tTile(tj[0])]);
    const bh=body.querySelector('.ctmr').offsetHeight+gap,tth=body.querySelector('.ctile2').offsetHeight;
    const per=cols*Math.max(1,Math.floor((body.clientHeight-bh+gap)/(tth+gap)));
    for(let i=0;i<tj.length;i+=per)pages.push({html:banner+grid(tj.slice(i,i+per).map(tTile)),t:true});
  }
  if(!pages.length){body.innerHTML='<p class="tempty">Ainda não tem escala lançada pra hoje.</p>';cPages=1;cKinds=[];$('cDots').innerHTML='';return}
  cPages=pages.length;if(cPage>=cPages)cPage=0;cKinds=pages.map(p=>!!p.t);
  body.innerHTML=pages.map((p,i)=>`<div class="cpage" data-page="${i}"${i===cPage?'':' hidden'}>${p.html}</div>`).join('');
  cDotsDraw();
}
function cDotsDraw(){$('cDots').innerHTML=cPages>1?Array.from({length:cPages},(_,i)=>`<i class="${i===cPage?'on':''}${cKinds[i]?' t':''}"></i>`).join('')+`<span>${cKinds[cPage]?'próximo dia':'hoje'} · página ${cPage+1} de ${cPages}</span>`:''}
function cNextPage(){if(!centralOn||cPages<2||cDetail||cOpen.size||!$('cPin').hidden)return;cPage=(cPage+1)%cPages;
  document.querySelectorAll('#cBody [data-page]').forEach(g=>g.hidden=+g.dataset.page!==cPage);cDotsDraw()}
setInterval(cNextPage,10000);
window.addEventListener('resize',()=>{if(centralOn)renderCentral()});
/* teclado do PIN */
function pinOpen(){if(!P.escala){toast('Esse login é só pra ver. Pra alterar, a TV precisa entrar com um login do escritório.');return}
  pinBuf='';pinFirst='';pinStage=getPin()?'enter':'new';$('cPin').hidden=false;pinDraw()}
function pinClose(){$('cPin').hidden=true;pinBuf=''}
function pinDraw(msg,bad){
  $('cPinTitle').textContent=pinStage==='enter'?'Digite o PIN':pinStage==='new'?'Crie um PIN de 4 números':'Digite o PIN de novo';
  $('cPinMsg').textContent=msg||(pinStage==='new'?'Fica guardado só neste aparelho':'');$('cPinMsg').classList.toggle('bad',!!bad);
  $('cPinDots').innerHTML=[0,1,2,3].map(i=>`<i class="${i<pinBuf.length?'on':''}"></i>`).join('');
  $('cPinDots').classList.toggle('shake',!!bad);
}
function pinKey(k){
  if(k==='x'){pinClose();return}
  if(k==='<'){pinBuf=pinBuf.slice(0,-1);pinDraw();return}
  if(pinBuf.length>=4)return;pinBuf+=k;pinDraw();if(pinBuf.length<4)return;
  setTimeout(()=>{
    if(pinStage==='enter'){if(pinBuf===getPin()){pinClose();cUnlocked=true;cTouch();renderCentral()}else{pinBuf='';pinDraw('PIN errado',true)}}
    else if(pinStage==='new'){pinFirst=pinBuf;pinBuf='';pinStage='confirm';pinDraw()}
    else{if(pinBuf===pinFirst){setPin(pinBuf);pinClose();cUnlocked=true;cTouch();renderCentral();toast('PIN criado ✓')}else{pinBuf='';pinFirst='';pinStage='new';pinDraw('Não bateu. Crie de novo.',true)}}
  },150);
}
$('cPin').addEventListener('click',e=>{const b=e.target.closest('[data-pk]');if(b)pinKey(b.dataset.pk);else if(e.target.id==='cPin')pinClose()});
/* toques na Central */
$('central').addEventListener('pointerdown',cTouch);
$('central').addEventListener('click',e=>{
  if(e.target.closest('[data-cdclose]')||e.target.id==='cDet'){cDetail=null;renderCentral();return}
  const td=e.target.closest('[data-cd]');if(td){cDetail=td.dataset.cd;renderCentral();return}
  const at=e.target.closest('[data-catt]');
  if(at){if(!cUnlocked)return;const j=findJob(at.dataset.catt);if(j)setAtt(j,at.dataset.n,at.dataset.s);renderCentral();return}
  const act=e.target.closest('[data-cact]');
  if(act){const k=act.dataset.cact;
    if(k==='unlock'){pinOpen();return}
    if(!cUnlocked)return;const j=findJob(act.dataset.cj2);if(!j)return;
    if(k==='left'){j.left=j.left?0:Date.now();openLeft.delete(j.id);saveDay();if(j.left&&j.allWeek)copyJobToNext(j,{},true);renderJobs();renderCentral();toast(j.left?'✓ '+(tidy(j.company)||'Obra')+' despachada':'Despacho desfeito')}
    else if(k==='edit'){const id=j.id;cUnlocked=false;cDetail=null;clearTimeout(cIdle);closeCentral();tab('day');$('cBack').hidden=false;backIdle();
      openLeft.set(id,true);renderJobs();setTimeout(()=>{const card=document.querySelector('.job[data-id="'+id+'"]');if(card)card.scrollIntoView({block:'start',behavior:'smooth'})},50)}
    return}
  const r=e.target.closest('#cBody [data-cj]');if(!r)return;const id=r.dataset.cj;cOpen.has(id)?cOpen.delete(id):cOpen.add(id);renderCentral();
});
$("cLockBtn").onclick=cRelock;
/* voltar pra Central (depois de abrir o editor por ela): botão e volta sozinho após 3 min parado */
function backIdle(){clearTimeout(cBackIdle);if($('cBack').hidden)return;cBackIdle=setTimeout(()=>{if(!$('cBack').hidden&&!typing())backToCentral();else backIdle()},180000)}
function backToCentral(){$('cBack').hidden=true;clearTimeout(cBackIdle);openCentral()}
$('cBack').onclick=backToCentral;
['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,()=>{if(!centralOn)backIdle()},true));
if($('cPinReset'))$('cPinReset').onclick=()=>{setPin('');toast('PIN da Central apagado neste aparelho. Na próxima vez, crie outro.')};
/* ---------- Relatório do dia (pro patrão) ---------- */
const hm=ms=>new Date(ms).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase().replace(' ','');
function buildReport(){
  const jobs=D.jobs.filter(j=>j.company||j.crew.length);
  const [y,m,d]=cur.split('-');const wd=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(+y,m-1,+d).getDay()];
  const name=j=>tidy(j.company)||'Obra';
  const dupe=n=>jobs.filter(x=>nkey(name(x))===nkey(n)).length>1;
  const label=j=>{const n=name(j);if(!dupe(n))return n;const a=tidy(j.address).split(',')[0];return a?`${n} (${a})`:n};
  const late=mins=>mins>=60?`+${Math.floor(mins/60)}h${String(mins%60).padStart(2,'0')}`:`+${mins} min`;
  let esc_=0,pres=0;const falt=[],semConf=[];
  jobs.forEach(j=>{esc_+=j.crew.length;let marked=0;j.crew.forEach(c=>{const s=attOf(j,c.name);if(s==='in'){pres++;marked++}else if(s==='out'){falt.push(`${tidy(c.name)} (${label(j)})`);marked++}});
    if(j.crew.length&&!marked)semConf.push(label(j))});
  const desp=jobs.filter(j=>j.left).length;
  const L=['📊 *Relatório do dia*',`${wd} ${m}/${d}`,''];
  L.push(`🏗️ Obras: ${jobs.length}${desp===jobs.length?' (todas despachadas)':` · despachadas ${desp} de ${jobs.length}`}`);
  L.push(`👷 Escalados: ${esc_}`);
  if(pres+falt.length)L.push(`✅ Presentes: ${pres} · ❌ Faltas: ${falt.length}`);
  else L.push('📋 Presença: não marcada');
  if(falt.length)L.push('','❌ *Faltaram*',...falt.map(x=>'• '+x));
  L.push('','🚚 *Saídas*');
  jobs.forEach(j=>{let t;
    if(j.left)t='saiu '+hm(j.left);
    else t='aguardando';
    L.push(`${j.left?'✅':'⏳'} ${label(j)} · ${j.crew.length} pessoa${j.crew.length===1?'':'s'} · ${t}`)});
  if(semConf.length&&(pres+falt.length))L.push('','⚠️ Presença não confirmada: '+semConf.join(', '));
  return L.join('\n');
}
function renderReport(){
  const box=$('reportPanel');if(!box)return;
  box.hidden=!(P.escala||P.telefones)||viewer||!D.jobs.length;if(box.hidden)return;
  const txt=buildReport();$('rpPreview').textContent=txt;
  const desp=D.jobs.filter(j=>j.left).length;
  $('rpStatus').textContent=desp===D.jobs.length?'tudo despachado ✓':desp+' de '+D.jobs.length+' despachadas';
  const ph=waDigits(S.boss||'');
  $('rpSend').href='https://api.whatsapp.com/send?'+(ph?'phone='+ph+'&':'')+'text='+encodeURIComponent(txt);
  $('rpHint').textContent=ph?'':'Dica: salve o WhatsApp do patrão em Cadastro → Relatório do dia, pra abrir direto no contato dele.';
}
$('rpSend').addEventListener('click',()=>{const txt=buildReport();try{navigator.clipboard.writeText(txt).catch(()=>{})}catch(e){}});
$('rpCopy').onclick=()=>{const txt=buildReport();const fb=()=>{const ta=$('fallback');ta.value=txt;ta.select();try{document.execCommand('copy');toast('Relatório copiado')}catch(e){}};
  try{navigator.clipboard.writeText(txt).then(()=>toast('Relatório copiado'),fb)}catch(e){fb()}};
$('bossPhone').addEventListener('change',e=>{if(!P.cadastro)return;const v=tidy(e.target.value);if(v&&!waDigits(v)){toast('Número parece incompleto. Use o formato (508) 555-1234');return}S.boss=v;saveRoster();renderReport();toast(v?'WhatsApp do patrão salvo':'WhatsApp do patrão removido')});

/* ---------- Calendário de agendamentos ----------
   O agendamento é gravado direto como obra em days/AAAA-MM-DD (equipe vazia, "need" = quantas pessoas).
   Contador do dia = soma do "need" (ou da equipe, o que for maior) de todas as obras × funcionários do cadastro. */
const MESES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
let calMonth=(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)})(),CALDAYS={},calSel=null,calUnsub=null;
const reserved=jobs=>(jobs||[]).reduce((s,j)=>s+Math.max(+j.need||0,(j.crew||[]).length),0);
const levelOf=n=>{const tot=S.workers.length||0;if(!n)return '';if(!tot)return 'ok';return n>tot?'bad':n>=tot*0.85?'warn':'ok'};
function calRange(){const f=new Date(calMonth);f.setDate(1-f.getDay());const l=new Date(f);l.setDate(f.getDate()+41);return [f,l]}
function loadCal(){
  if(calUnsub){calUnsub();calUnsub=null}
  const [f,l]=calRange();CALDAYS={};renderCal();
  if(calOffUnsub){calOffUnsub();calOffUnsub=null}CALOFF={};
  calOffUnsub=db.collection('dayoff').where('date','>=',iso(f)).where('date','<=',iso(l)).onSnapshot(s=>{CALOFF={};s.docs.forEach(d=>{const x=d.data();if(x&&x.date)CALOFF[x.date]=x.people||{}});renderCal();if(calSel)renderCalDay()},e=>console.error(e));
  calUnsub=db.collection('days').where('date','>=',iso(f)).where('date','<=',iso(l)).onSnapshot(s=>{CALDAYS={};s.docs.forEach(d=>{const x=d.data();if(x&&x.date)CALDAYS[x.date]=x});renderCal();if(calSel)renderCalDay()},e=>console.error(e));
}
const dayOff=date=>Object.keys((date===cur?OFF:CALOFF[date])||{});
function dayJobs(date){if(date===cur&&dayLoaded)return D.jobs;return (CALDAYS[date]&&CALDAYS[date].jobs)||[]}
function renderCal(){
  $('calTitle').textContent=MESES[calMonth.getMonth()]+' '+calMonth.getFullYear();
  const [f]=calRange();const today=iso(new Date());const tot=S.workers.length;
  let html=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<div class="calwd">${d}</div>`).join('');
  for(let i=0;i<42;i++){const d=new Date(f);d.setDate(f.getDate()+i);const ds=iso(d);const jobs=dayJobs(ds);const n=reserved(jobs);const lv=levelOf(n);
    html+=`<button class="calday${d.getMonth()!==calMonth.getMonth()?' out':''}${ds===today?' today':''}${ds===cur?' cur':''}" data-cal="${ds}" aria-label="${esc(dateBR(ds))}">
      <span class="cdtop"><span class="cdnum">${d.getDate()}</span>${dayOff(ds).length?`<span class="cdoff" title="Day off">🌴${dayOff(ds).length}</span>`:''}${n?`<i class="cddot ${lv}"></i>`:''}</span>
      ${jobs.slice(0,3).map(j=>`<span class="cdjob">${esc(j.company||'Obra')}</span>`).join('')}${jobs.length>3?`<span class="cdmore">+${jobs.length-3}</span>`:''}
      </button>`}
  $('calGrid').innerHTML=html;
  if($('calInfo')&&!$('calInfo').classList.contains('info'))calInfo(null);
}
function openCalDay(ds){calSel=ds;$('calDay').hidden=false;document.body.classList.add('modal-open');
  $('cdForm').reset();$('cdStart').value='07:00';$('cdSkipWknd').checked=true;$('cdAllWeek').checked=false;$('cdWarn').hidden=true;
  $('cdCoList').innerHTML=Object.keys(S.companies).sort((a,b)=>a.localeCompare(b,'pt')).map(c=>`<option value="${esc(c)}">`).join('');
  $('cdForm').hidden=!P.escala;renderCalDay();}
function closeCalDay(){calSel=null;$('calDay').hidden=true;document.body.classList.remove('modal-open')}
function renderCalDay(){
  if(!calSel)return;const jobs=dayJobs(calSel);const n=reserved(jobs),tot=S.workers.length,lv=levelOf(n);
  $('cdTitle').textContent=dateBR(calSel);
  const inCrew=new Set();jobs.forEach(j=>(j.crew||[]).forEach(c=>inCrew.add(nkey(c.name))));
  const offs=dayOff(calSel);const freeNames=S.workers.filter(w=>!inCrew.has(nkey(w))&&!offOf((calSel===cur?OFF:CALOFF[calSel]),w));
  const pend=jobs.reduce((s,j)=>s+Math.max(0,(+j.need||0)-(j.crew||[]).length),0);
  const freeHTML=S.workers.length?`<div class="cdfreenames"><b>Sem escala neste dia (${freeNames.length})</b>${pend?`<small> · ainda faltam ${pend} vaga${pend===1?'':'s'} pra preencher nas obras</small>`:''}
    <div class="chips">${freeNames.map(w=>`<span class="chip">${esc(w)}</span>`).join('')||'<span class="empty">Todo mundo está escalado.</span>'}</div></div>`:'';
  const offHTML=(offs.length||isAdmin)?`<div class="cdoffbox"><b>🌴 Day off</b>${isAdmin?'':' <small>(só o administrador marca)</small>'}
    <div class="chips">${offs.map(w=>`<span class="chip off">🌴 ${esc(w)}${isAdmin?` <button class="offx" data-offrm="${esc(w)}" aria-label="Tirar day off de ${esc(w)}">×</button>`:''}</span>`).join('')||'<span class="empty">Ninguém de day off.</span>'}</div>
    ${isAdmin?`<div class="offform"><select id="offWho" aria-label="Funcionário"><option value="">Escolha o funcionário…</option>${S.workers.filter(w=>!offs.some(o=>nkey(o)===nkey(w))).map(w=>`<option>${esc(w)}</option>`).join('')}</select>
      <label class="offuntil">até <input type="date" id="offUntil" min="${calSel}" aria-label="Até que dia (opcional)"></label><button class="btn primary" id="offAdd">Marcar day off</button></div>`:''}</div>`:'';
  $('cdCount').innerHTML=offHTML+`<div class="cdtotal ${lv||'ok'}">👷 <b>${n}</b> pessoa${n===1?'':'s'} reservada${n===1?'':'s'} de <b>${tot}</b> no cadastro${n>tot?` · <b>faltam ${n-tot}</b>`:tot-n>0?` · sobram ${tot-n}`:''}</div>`+freeHTML;
  $('cdList').innerHTML=jobs.length?`<div class="cdjobs">${jobs.map(j=>`<div class="cdj"><div><b>${esc(j.company||'Obra')}</b>${j.allWeek?' <span class="wkbadge">All Week</span>':''}<small>${esc(j.waiting||!j.address?'Endereço a confirmar':j.address)}</small></div>
      <span class="cdjn">${esc(fmt(j.start)||'')} · ${(j.crew||[]).length}${j.need?' de '+j.need:''} pessoas</span></div>`).join('')}</div>
      <button class="btn" id="cdOpen">Abrir na escala do dia →</button>`:'<p class="empty">Nada agendado neste dia.</p>';
  cdCheck();
}
function cdDates(){
  const start=calSel,until=$('cdUntil').value;if(!until||until<=start)return [start];
  const out=[];const [y,m,d]=start.split('-').map(Number);for(let i=0;i<60;i++){const dt=new Date(y,m-1,d+i);const ds=iso(dt);if(ds>until)break;
    if($('cdSkipWknd').checked&&(dt.getDay()===0||dt.getDay()===6))continue;out.push(ds)}
  return out;
}
function cdCheck(){
  const need=+$('cdNeed').value||0,tot=S.workers.length;const ds=cdDates();
  if(ds.length>1&&!$('cdAllWeek').dataset.touched)$('cdAllWeek').checked=true;
  const over=need?ds.map(x=>({x,n:reserved(dayJobs(x))+need})).filter(o=>tot&&o.n>tot):[];
  const w=$('cdWarn');
  if(over.length){w.hidden=false;w.innerHTML=`⚠️ Vai passar do que vocês têm (${tot}) em: `+over.map(o=>`<b>${esc(dateBR(o.x))}</b> (${o.n})`).join(', ')+'. Dá pra agendar mesmo assim.'}
  else if(ds.length>1){w.hidden=false;w.className='alert ok';w.textContent=`Vai criar a obra em ${ds.length} dias: ${ds.map(x=>x.slice(5).split('-').join('/')).join(', ')}`;return}
  else w.hidden=true;
  w.className='alert warn';
}
function newBooking(date){
  const co=fmtCompany($('cdCo').value),addr=fmtAddress($('cdAddr').value),start=$('cdStart').value||'07:00',need=Math.max(0,Math.min(99,parseInt($('cdNeed').value,10)||0));
  const key=addr?akey(addr):'',travel=key&&S.travel[key]!=null?S.travel[key]:null,early=30;
  const j={id:nid(),company:co,address:addr,waiting:!addr,office:false,attire:ATTIRE,shop:'',start,early,travel,autoShop:true,tk:travel!=null?key:'',need,note:tidy($('cdNote').value),allWeek:$('cdAllWeek').checked,crew:[],left:0};
  if(travel!=null)j.shop=toHHMM(Math.floor((toMin(start)-early-travel)/5)*5);
  return j;
}
$('cdForm').addEventListener('submit',async e=>{e.preventDefault();if(!P.escala)return;
  if(!fmtCompany($('cdCo').value)){toast('Coloque o nome da companhia');$('cdCo').focus();return}
  const dates=cdDates();const btn=$('cdSave');btn.disabled=true;btn.textContent='Agendando…';
  try{
    for(const ds of dates){const j=newBooking(ds);
      if(ds===cur&&dayLoaded){D.jobs.push(j);saveDay();renderJobs();continue}
      const snap=await db.doc(dayPath(ds)).get();const day=snap.exists?snap.data():{date:ds,jobs:[],sent:{}};
      const jobs=Array.isArray(day.jobs)?day.jobs:[];jobs.push(j);
      await db.doc(dayPath(ds)).set({date:ds,jobs,sent:day.sent||{},drivers:day.drivers||{}});
    }
    const first=newBooking(dates[0]);if(first.address)rememberAddr(first);
    toast(dates.length>1?`✓ Agendado em ${dates.length} dias`:'✓ Agendado');
    $('cdForm').reset();$('cdStart').value='07:00';$('cdSkipWknd').checked=true;delete $('cdAllWeek').dataset.touched;$('cdAllWeek').checked=false;$('cdWarn').hidden=true;
  }catch(err){console.error(err);toast('Não consegui agendar ('+(err.code||'erro')+')')}
  finally{btn.disabled=false;btn.textContent='Agendar'}
});
['cdNeed','cdUntil','cdSkipWknd'].forEach(id=>$(id).addEventListener('input',cdCheck));
$('cdAllWeek').addEventListener('change',e=>{e.target.dataset.touched='1'});
$('cdCo').addEventListener('change',()=>{const list=coAddrs($('cdCo').value);$('cdAddrList').innerHTML=list.map(a=>`<option value="${esc(a)}">`).join('');if(list.length===1&&!$('cdAddr').value)$('cdAddr').value=list[0]});
// Day off: só o admin marca/tira (regras do banco conferem)
$('calDay').addEventListener('click',async e=>{
  if(!isAdmin||!calSel)return;
  const rm=e.target.closest('[data-offrm]');
  if(rm){const name=rm.dataset.offrm,ds=calSel;try{const sn=await db.doc('dayoff/'+ds).get();const people=Object.assign({},(sn.exists&&sn.data().people)||{});
      Object.keys(people).forEach(n=>{if(nkey(n)===nkey(name))delete people[n]});
      if(Object.keys(people).length)await db.doc('dayoff/'+ds).set({date:ds,people});else await db.doc('dayoff/'+ds).delete();
      toast('Day off de '+tidy(name)+' retirado')}catch(err){console.error(err);toast('Não consegui tirar ('+(err.code||'erro')+')')}return}
  if(e.target.id!=='offAdd')return;
  const who=$('offWho').value;if(!who){toast('Escolha o funcionário');return}
  const until=$('offUntil').value;const dates=[];const [y,m,d]=calSel.split('-').map(Number);
  for(let i=0;i<62;i++){const ds=iso(new Date(y,m-1,d+i));if(i&&(!until||ds>until))break;dates.push(ds)}
  const btn=e.target;btn.disabled=true;
  try{const busy=[];
    for(const ds of dates){const sn=await db.doc('dayoff/'+ds).get();const people=Object.assign({},(sn.exists&&sn.data().people)||{});
      people[who]={by:(ctx&&ctx.email)||'',at:Date.now()};await db.doc('dayoff/'+ds).set({date:ds,people});
      const jobs=ds===cur&&dayLoaded?D.jobs:((await db.doc(dayPath(ds)).get()).data()||{}).jobs||[];
      const j=jobs.find(x=>(x.crew||[]).some(c=>nkey(c.name)===nkey(who)));if(j)busy.push(dateBR(ds)+' ('+(j.company||'obra')+')')}
    toast(`🌴 Day off marcado: ${who}${dates.length>1?' · '+dates.length+' dias':''}`);
    if(busy.length)setTimeout(()=>toast(`⚠️ ${who} já estava escalado: ${busy.join(', ')}. Tire ele da obra.`),2600);
  }catch(err){console.error(err);toast('Não consegui marcar ('+(err.code||'erro')+')')}
  finally{btn.disabled=false}
});
// passar o mouse no dia: mostra pessoas lá em cima, no lugar da legenda
const LEGEND=()=>`<i class="cl ok"></i>sobra gente <i class="cl warn"></i>quase no limite <i class="cl bad"></i>faltam <span class="hint">· passe o mouse num dia</span>`;
function calInfo(ds){const el=$('calInfo');if(!ds){el.innerHTML=LEGEND();el.className='callegend';return}
  const n=reserved(dayJobs(ds)),tot=S.workers.length,offN=dayOff(ds).length,free=tot-n-offN,lv=levelOf(n+offN)||'ok';
  el.className='callegend info '+lv;
  el.innerHTML=`<b>${esc(dateBR(ds))}</b> · ${tot} funcionários · ${n} reservado${n===1?'':'s'}${offN?` · 🌴 ${offN} day off`:''} · <b>${free>=0?free+' livre'+(free===1?'':'s'):'faltam '+(-free)}</b>`}
$('calGrid').addEventListener('mouseover',e=>{const b=e.target.closest('[data-cal]');calInfo(b&&b.dataset.cal)});
$('calGrid').addEventListener('mouseleave',()=>calInfo(null));
$('calGrid').addEventListener('click',e=>{const b=e.target.closest('[data-cal]');if(b)openCalDay(b.dataset.cal)});
$('calDay').addEventListener('click',e=>{if(e.target.id==='calDay')closeCalDay();if(e.target.id==='cdOpen'){const ds=calSel;closeCalDay();setDate(ds);tab('day')}});
$('cdClose').onclick=closeCalDay;
$('calPrev').onclick=()=>{calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()-1,1);loadCal()};
$('calNext').onclick=()=>{calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()+1,1);loadCal()};
$('calToday').onclick=()=>{const d=new Date();calMonth=new Date(d.getFullYear(),d.getMonth(),1);loadCal()};
$('tab-cal').onclick=()=>{tab('cal');loadCal()};
if(viewer)$('tab-cal').hidden=true;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&calSel)closeCalDay()});

/* ---------- aba Buscar: onde cada um trabalhou / quem foi em cada companhia ---------- */
const fold=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
let SDAYS=null,SATT={},sKey='',sRows=[];
function sRange(){
  const p=$('sPeriod').value,today=new Date();
  if(p==='custom'){const f=$('sFrom').value,t=$('sTo').value;return [f||iso(new Date(today.getFullYear(),today.getMonth(),today.getDate()-30)),t||iso(today)]}
  const from=new Date(today.getFullYear(),today.getMonth(),today.getDate()-(+p));
  const to=new Date(today.getFullYear(),today.getMonth(),today.getDate()+14);   // inclui escalas já lançadas pros próximos dias
  return [iso(from),iso(to)];
}
async function sLoad(){
  const [from,to]=sRange();const k=from+'|'+to;
  if(SDAYS&&sKey===k)return;
  sKey=k;SDAYS=null;$('sResults').innerHTML='<p class="hint">Carregando escalas…</p>';
  try{
    const q=await db.collection('days').where('date','>=',from).where('date','<=',to).orderBy('date','desc').limit(500).get();
    SDAYS=q.docs.map(d=>d.data()).filter(d=>d&&Array.isArray(d.jobs));
    SATT={};
    try{const a=await db.collection('attendance').where('date','>=',from).where('date','<=',to).limit(2000).get();a.docs.forEach(d=>{const x=d.data();if(x&&x.jobId)SATT[x.date+'_'+x.jobId]=x})}catch(e){}
  }catch(e){console.error(e);SDAYS=[];$('sResults').innerHTML='<p class="authmsg bad">Não consegui carregar ('+esc(e.code||'erro')+').</p>';return}
}
function sAtt(date,j,name){const a=SATT[date+'_'+j.id];if(!a||!a.people)return '';const k=Object.keys(a.people).find(n=>nkey(n)===nkey(name));return k?a.people[k]:''}
async function runSearch(){
  const q=fold($('sQ').value),type=$('sType').value;
  $('sCustom').hidden=$('sPeriod').value!=='custom';
  if(!q){$('sResults').innerHTML='';$('sSummary').innerHTML='';$('sCsv').hidden=true;$('sInfo').textContent='Digite um nome ou companhia. A busca ignora acentos e maiúsculas.';return}
  await sLoad();if(!SDAYS)return;
  sRows=[];
  SDAYS.forEach(d=>(d.jobs||[]).forEach(j=>{
    const coHit=type!=='person'&&(fold(j.company).includes(q)||fold(j.address).includes(q));
    const people=type==='company'?[]:(j.crew||[]).filter(c=>fold(c.name).includes(q));
    if(!coHit&&!people.length)return;
    sRows.push({date:d.date,j,people,coHit});
  }));
  const [from,to]=sRange();
  $('sInfo').textContent=`Período: ${from.split('-').reverse().join('/')} até ${to.split('-').reverse().join('/')} · ${SDAYS.length} dia(s) com escala`;
  // resumo
  const names=new Map(),cos=new Map();
  sRows.forEach(r=>{r.people.forEach(c=>names.set(c.name,(names.get(c.name)||new Set()).add(r.date)));
    const k=r.j.company||'Obra';cos.set(k,(cos.get(k)||0)+1)});
  let sum='';
  if(names.size===1){const [n,ds]=[...names][0];const byCo=new Map();sRows.forEach(r=>{if(r.people.length){const k=r.j.company||'Obra';byCo.set(k,(byCo.get(k)||0)+1)}});
    const falt=sRows.filter(r=>r.people.length&&sAtt(r.date,r.j,r.people[0].name)==='out').length;
    sum=`<div class="ssum"><b>${esc(n)}</b> foi escalado em <b>${ds.size} dia${ds.size>1?'s':''}</b>${falt?` · <span class="attout">faltou ${falt}</span>`:''}<div class="schips">${[...byCo].sort((a,b)=>b[1]-a[1]).map(([c,k])=>`<span class="chip">${esc(c)} <b>${k}</b></span>`).join('')}</div></div>`}
  else if(sRows.length){sum=`<div class="ssum"><b>${sRows.length}</b> resultado${sRows.length>1?'s':''}${names.size?` · ${names.size} pessoa${names.size>1?'s':''}`:''} · ${cos.size} companhia${cos.size>1?'s':''}</div>`}
  $('sSummary').innerHTML=sum;
  $('sResults').innerHTML=sRows.length?sRows.map(r=>{
    const who=r.people.length?r.people:(r.coHit?r.j.crew||[]:[]);
    return `<button class="srow" data-sgo="${esc(r.date)}" data-sjob="${esc(r.j.id)}">
      <span class="sdate">${esc(dateBR(r.date))}</span>
      <span class="smain"><b>${esc(r.j.company||'Obra')}</b><small>${esc(r.j.waiting?'(Esperando endereço)':r.j.address||'')}</small>
      <span class="swho">${who.map(c=>{const s=sAtt(r.date,r.j,c.name);const hit=r.people.includes(c);
        return `<span class="${hit?'shit':''}">${s==='in'?'<i class="attmark in">✓</i>':s==='out'?'<i class="attmark out">✗</i>':''}${esc(c.name)}${c.v?' '+esc(vLabel(c.v)):''}</span>`}).join(', ')}</span></span></button>`}).join('')
    :'<p class="empty">Nada encontrado nesse período. Tente outro nome ou aumente o período.</p>';
  $('sCsv').hidden=!sRows.length||!P.backup;
}
let sT=null;
$('sQ').addEventListener('input',()=>{clearTimeout(sT);sT=setTimeout(runSearch,250)});
['sType','sPeriod','sFrom','sTo'].forEach(id=>$(id).addEventListener('change',runSearch));
$('sResults').addEventListener('click',e=>{const b=e.target.closest('[data-sgo]');if(!b)return;const jid=b.dataset.sjob;
  setDate(b.dataset.sgo);tab('day');let n=0;const go=()=>{const c=document.querySelector('.job[data-id="'+jid+'"]');if(c){c.scrollIntoView({block:'start',behavior:'smooth'});c.classList.add('flash');setTimeout(()=>c.classList.remove('flash'),1600)}else if(n++<20)setTimeout(go,150)};go()});
$('sCsv').onclick=async e=>{const rows=[['Data','Companhia','Endereço','Trabalhador','Veículo','Presença']];
  sRows.forEach(r=>(r.people.length?r.people:(r.j.crew||[])).forEach(c=>{const s=sAtt(r.date,r.j,c.name);rows.push([r.date,r.j.company,r.j.waiting?'(Esperando)':r.j.address,c.name,c.v==='own'?'Carro próprio':(c.v||''),s==='in'?'Veio':s==='out'?'Faltou':''])}));
  await offer('busca_'+fold($('sQ').value).replace(/[^\w]+/g,'-').slice(0,40)+'.csv',toCSV(rows),e.currentTarget)};
$('tab-search').onclick=()=>{tab('search');
  $('sList').innerHTML=[...new Set([...S.workers,...Object.keys(S.companies)])].sort((a,b)=>a.localeCompare(b,'pt')).map(x=>`<option value="${esc(x)}">`).join('');
  SDAYS=null;sKey='';if($('sQ').value)runSearch();setTimeout(()=>$('sQ').focus(),50)};
if(viewer)$('tab-search').hidden=true;

/* ---------- início ---------- */
(()=>{const tb=$('topbar');if(!tb)return;const set=()=>document.documentElement.style.setProperty('--topH',tb.offsetHeight+'px');set();
  try{new ResizeObserver(set).observe(tb)}catch(e){window.addEventListener('resize',set)}})();
// Botão Buscar centralizado embaixo do quadradinho da data
(()=>{const b=$('tab-search'),d=$('date');if(!b||!d)return;const row=b.parentElement;
  const align=()=>{b.style.marginRight='0px';if(b.hidden||!d.offsetWidth)return;
    const dr=d.getBoundingClientRect(),rr=row.getBoundingClientRect(),bw=b.offsetWidth;
    let prevRight=rr.left;[...row.children].forEach(x=>{if(x!==b&&!x.hidden&&x.offsetWidth){prevRight=Math.max(prevRight,x.getBoundingClientRect().right)}});
    let mr=rr.right-(dr.left+dr.width/2+bw/2);mr=Math.min(mr,rr.right-prevRight-8-bw);b.style.marginRight=Math.max(0,Math.round(mr))+'px'};
  window.addEventListener('resize',align);try{new ResizeObserver(align).observe($('topbar'))}catch(e){}
  try{new MutationObserver(align).observe(row,{attributes:true,subtree:true,attributeFilter:['hidden']})}catch(e){}
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(align);setTimeout(align,300);align()})();
if(viewer)tab('day');
$('date').value=cur;
S=normRoster(null);
setStatus('loading');renderJobs();renderRoster();
db.doc(ROSTER).onSnapshot(remoteRoster,e=>{console.error(e);setStatus('err')});
if(P.telefones)db.doc(PHONES).onSnapshot(remotePhones,e=>{console.error(e)});else phonesLoaded=true;
setStatus('ok');
watchDay();
if((ctx&&ctx.totem)||(location.hash==='#totem'&&P.escala))openTotem();
else if(location.hash==='#central'||location.hash.startsWith('#demo-central'))openCentral();
return {flushAll};
}
