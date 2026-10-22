
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
/* ---------- Escala: cada aparelho só manda o que ELE mudou ----------
   BASE[path] = versão de onde o aparelho partiu. Na hora de salvar, numa transação, pega a versão do servidor e aplica
   só as diferenças (aparelho × BASE) por obra e por campo. Aparelho com versão velha que não mexeu = não apaga nada. */
const BASE={};
const nJobs=d=>(Array.isArray(d&&d.jobs)?normDay(d).jobs:[]).map(({calc,...r})=>r);
function merge3(base,mine,srv){
  if(!srv)return mine;
  const bJ=nJobs(base),mJ=mine.jobs||[],sRaw=Array.isArray(srv.jobs)?srv.jobs:[],sJ=nJobs(srv);
  const bM={},sM={},sR={};bJ.forEach(j=>bM[j.id]=j);sJ.forEach(j=>sM[j.id]=j);sRaw.forEach(j=>{if(j&&j.id)sR[j.id]=j});
  const mIds=new Set(mJ.map(j=>j.id)),out=[];
  mJ.forEach(m=>{const b=bM[m.id],sv=sM[m.id];
    if(!b){out.push(m);return}                                   // obra que eu criei
    const changed=stable(m)!==stable(b);
    if(!sv){if(changed)out.push(m);return}                       // apagaram em outro aparelho: só volta se eu mexi nela
    if(!changed){out.push(sR[m.id]);return}                      // não mexi: fica como está no servidor
    const o=clone(sR[m.id]);new Set([...Object.keys(m),...Object.keys(b)]).forEach(k=>{if(stable(m[k])!==stable(b[k])){if(m[k]===undefined)delete o[k];else o[k]=clone(m[k])}});
    out.push(o)});
  sRaw.forEach(j=>{if(j&&j.id&&!mIds.has(j.id)&&!bM[j.id])out.push(j)});   // obra nova criada em outro aparelho
  const sent=Object.assign({},srv.sent||{}),bS=(base&&base.sent)||{},mS=mine.sent||{};
  new Set([...Object.keys(bS),...Object.keys(mS)]).forEach(k=>{if(stable(mS[k])!==stable(bS[k])){if(mS[k]===undefined)delete sent[k];else sent[k]=mS[k]}});
  let drivers=srv.drivers||{};
  if(stable(out)!==stable(sRaw)){drivers={};out.forEach(j=>{const n=jobDrivers({crew:j.crew||[]});if(n.length)drivers[j.id]=n})}
  return {date:mine.date||srv.date,jobs:out,sent,drivers};
}
function keepPend(path,data){try{localStorage.setItem('pend:'+path,JSON.stringify({data,base:BASE[path]||null,at:Date.now()}))}catch(e){}}
function dropPend(path){try{localStorage.removeItem('pend:'+path)}catch(e){}}
const dayTx={};   // gravações da escala ainda em andamento, por dia: enquanto tiver, ignora o que o servidor manda (é versão velha)
function flushDay(path,data){
  keepPend(path,data);
  // dayTx[path] fica >0 do começo da gravação até ela dar certo de vez (inclusive enquanto espera pra tentar de novo):
  // nesse tempo o app não aceita a versão do servidor, senão a mudança some da tela e a pessoa tem que fazer de novo
  dayTx[path]=(dayTx[path]||0)+1;
  const retry=ms=>setTimeout(()=>{dayTx[path]=Math.max(0,(dayTx[path]||1)-1);if(!pend[path]){pend[path]=data;flush(path)}else flush(path)},ms);
  if(!navigator.onLine){setStatus('offline');retry(8000);return}
  inflight++;const base=BASE[path]||null;
  db.doc(path).tx(srv=>{const m=merge3(base,data,srv);lastSent[path]=stable(m);return m}).then(m=>{
    inflight--;dayTx[path]=Math.max(0,(dayTx[path]||1)-1);BASE[path]=clone(m);dropPend(path);saveHist(m);
    if(!inflight&&!Object.keys(pend).length&&!dayTx[path])setStatus('ok');
    if(path===dayPath(cur)&&!pend[path]&&!dayTx[path]&&stable(m)!==stable(data)&&stable({date:cur,jobs:D.jobs.map(({calc,...r})=>r),sent:D.sent||{}})===stable({date:data.date,jobs:data.jobs,sent:data.sent})){
      D=normDay(m);if(typing())deferred=true;else{renderJobs();renderCentral()}}   // juntou com mudança de outro aparelho
  },e=>{inflight--;console.error(e);const c=(e&&e.code)||'';
    if(!navigator.onLine||/unavailable|failed-precondition|aborted|deadline-exceeded|internal|resource-exhausted|cancelled/.test(c)){setStatus(navigator.onLine?'saving':'offline');retry(navigator.onLine?3000:8000)}
    else{dayTx[path]=Math.max(0,(dayTx[path]||1)-1);setStatus('err');toast('Não consegui salvar: '+(c||'erro'))}});
}
window.addEventListener('online',()=>Object.keys(localStorage).filter(k=>k.startsWith('pend:days/')).forEach(k=>{const path=k.slice(5);if(pend[path])return;try{const o=JSON.parse(localStorage.getItem(k));if(o&&o.data&&path===dayPath(cur)){pend[path]=o.data;flush(path)}}catch(e){}}));
function flush(path){
  if(!pend[path])return;
  const data=pend[path];delete pend[path];
  if(path.startsWith('days/')&&db.doc(path).tx){flushDay(path,data);return}
  lastSent[path]=stable(data);
  if(path.startsWith('days/')&&data&&data.date)saveHist(data);
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

function normRoster(d){return {workers:Array.isArray(d&&d.workers)?[...d.workers]:[],vehicles:Array.isArray(d&&d.vehicles)?clone(d.vehicles).map(v=>v&&v.t==='🚚'?Object.assign(v,{t:'🚛'}):v):[],companies:(()=>{const o={};if(d&&d.companies&&typeof d.companies==='object')Object.keys(d.companies).forEach(k=>{const v=d.companies[k];
    o[k]=Array.isArray(v)?v.filter(x=>typeof x==='string'):(typeof v==='string'&&v.trim()?[v]:[])});return o})(),
  base:(d&&typeof d.base==='string'&&d.base.trim())?d.base:'599 Concord St, Holliston, MA 01746',
  buffer:(d&&Number.isFinite(d.buffer))?d.buffer:30,
  travel:(d&&d.travel&&typeof d.travel==='object')?{...d.travel}:{},
  drivers:Array.isArray(d&&d.drivers)?d.drivers.filter(x=>typeof x==='string'):[],
  offices:(d&&d.offices&&typeof d.offices==='object')?{...d.offices}:{},
  boss:(d&&typeof d.boss==='string')?d.boss:''}}
function normDay(d){const jobs=Array.isArray(d&&d.jobs)?clone(d.jobs):[];jobs.forEach(j=>{j.id=j.id||nid();j.need=+j.need||0;delete j.calc;j.travel=Number.isFinite(j.travel)?j.travel:null;j.autoShop=!!j.autoShop;j.early=Number.isFinite(j.early)?j.early:30;j.tk=j.tk||'';j.crew=Array.isArray(j.crew)?j.crew:[];['company','address','attire','shop','start','note'].forEach(k=>j[k]=j[k]||'');j.allWeek=!!j.allWeek;j.allWeekWk=!!(j.allWeek&&j.allWeekWk);j.waiting=!!j.waiting;j.office=!!j.office;j.left=Number.isFinite(j.left)?j.left:0});return {date:cur,jobs,sent:(d&&d.sent&&typeof d.sent==='object')?{...d.sent}:{}}}

/* evita re-render enquanto a pessoa digita */
function typing(){const a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='SELECT')&&!a.id.startsWith('extra-')&&a.id!=='newWorker'}
function rerender(){if(typing()){deferred=true;return}renderJobs();renderRoster();renderCentral()}
document.addEventListener('focusout',()=>setTimeout(()=>{if(deferred&&!typing()){deferred=false;renderJobs();renderRoster()}},0));

function remoteRoster(snap){
  if(pend[ROSTER])return;
  if(rosterLoaded&&snap.metadata&&snap.metadata.hasPendingWrites)return;
  const d=snap.exists?snap.data():null;
  if(d&&stable(d)===lastSent[ROSTER]&&rosterLoaded)return;
  S=normRoster(d);rosterLoaded=true;rosterFromServer=!(snap.metadata&&snap.metadata.fromCache);
  if(d&&d.phones&&typeof d.phones==='object'&&Object.keys(d.phones).length&&isAdmin){
    // telefones antigos ficavam no cadastro: passa pra um documento separado (só quem pode ver telefones lê)
    const go=()=>{if(!phonesLoaded)return setTimeout(go,500);PH=Object.assign({},d.phones,PH);savePhones();saveRoster()};go();
  }
  rerender();
  if(P.escala&&dayLoaded&&dayFromServer&&rosterFromServer&&D.jobs.length&&stable(lastDrivers||{})!==stable(driversMap()))saveDay();
}
let lastDrivers=null,dayFromServer=false,rosterFromServer=false;
// mudança feita sem internet (ou app fechado antes de enviar): quando chega a versão do servidor, junta e envia
function resumePend(path,snap){if(snap.metadata&&snap.metadata.fromCache)return;let o=null;try{o=JSON.parse(localStorage.getItem('pend:'+path)||'null')}catch(e){}
  if(!o||!o.data||Date.now()-o.at>2*86400000){dropPend(path);return}
  const base=o.base;inflight++;setStatus('saving');
  db.doc(path).tx(srv=>{const m=merge3(base,o.data,srv);lastSent[path]=stable(m);return m}).then(m=>{inflight--;dropPend(path);BASE[path]=clone(m);setStatus('ok');if(path===dayPath(cur)&&!pend[path]){D=normDay(m);rerender()}toast('✓ Mudanças feitas sem internet foram enviadas')},e=>{inflight--;console.error(e)})}
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
  tmKey='';
  unsubDay=db.doc(path).onSnapshot(snap=>{
    if(path!==dayPath(cur))return;
    if(pend[path])return;
    if(dayLoaded&&dayTx[path])return;   // ainda salvando: essa versão do servidor é de antes da minha mudança (fazia o nome/obra sumir e ter que pôr de novo)
    if(dayLoaded&&snap.metadata&&snap.metadata.hasPendingWrites)return;
    const d=snap.exists?snap.data():null;
    if(dayLoaded&&d&&stable(d)===lastSent[path])return;
    D=normDay(d);BASE[path]=d?clone(d):null;dayLoaded=true;rerender();renderTotem();watchTm();renderTmTab();
    resumePend(path,snap);
    lastDrivers=d&&d.drivers||{};
    dayFromServer=!(snap.metadata&&snap.metadata.fromCache);
    if(P.escala&&d&&D.jobs.length&&dayFromServer&&rosterFromServer&&stable(d.drivers||{})!==stable(driversMap()))saveDay();   // dias salvos antes de existir a lista de motoristas (só com dados confirmados do servidor)
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
        <div class="cotitle"><input data-f="company" list="companyList" value="${esc(j.company)}" placeholder="Companhia" aria-label="Companhia" id="co-${j.id}">
        ${(()=>{const dn=jobDrivers(j)[0];if(!dn)return j.crew.length?'<span class="drvline none">sem motorista</span>':'';const c=j.crew.find(x=>x.name===dn);
          return `<span class="drvline" title="Motorista do dia">${c&&c.v?esc(vLabel(c.v)):'🔑'} ${esc(dn)}</span>`})()}</div>
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
        <div class="wkrow"><label class="check wk"><input type="checkbox" data-f="allWeek" ${j.allWeek?'checked':''} id="aw-${j.id}"> Semana toda <span class="tag">(All Week)</span></label>
        <label class="check wk wkend"${j.allWeek?'':' hidden'}><input type="checkbox" data-f="allWeekWk" ${j.allWeekWk?'checked':''} id="awk-${j.id}"> incluir sábado e domingo</label></div>
        <div class="crew">
          <h3><span>Equipe</span><span class="need ${needCls(j)}" id="nd-${j.id}">${needText(j)}</span></h3>
          <label class="needrow">Preciso de <input type="number" min="0" max="99" inputmode="numeric" data-f="need" value="${j.need||''}" placeholder="–" id="nq-${j.id}"> pessoas</label>
          ${crew}
          <div class="attsum" id="as-${j.id}">${attSummary(j)}</div>
          ${picker||`<button class="btn" data-act="pickopen">+ Adicionar pessoas</button>`}
        </div>
        ${P.fotos?`<button class="btn phcount" data-act="photos">📷 Fotos da obra <b id="pc-${j.id}">${photoCount(j)}</b></button>`:''}
        <div class="jobactions"><button class="btn" data-act="copynext">📋 Copiar pra ${shortWD(nextDayFor(j))}</button>
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
  $('toolsBar').innerHTML=''    +(P.escala?`<div class="histlinks"><button class="linkbtn histlink" id="openHist">🕘 Versões anteriores do dia</button><button class="linkbtn histlink" id="openImp">📋 Colar mensagem do WhatsApp</button><button class="linkbtn histlink" id="openTv">📺 Ver a TV</button><button class="linkbtn histlink" id="pingTv">🔄 Atualizar a TV</button></div>`:'')
    +(D.jobs.length>1?`<div class="histlinks">${D.jobs.every(isCollapsed)?'<button class="linkbtn histlink" id="expandAll">▾ Abrir todas</button>':'<button class="linkbtn histlink" id="collapseAll">▸ Recolher todas</button>'}${P.escala&&D.jobs.some(j=>!j.left)?'<button class="linkbtn histlink" id="leftAll">✅ Despachar todas</button>':''}</div>`:'');
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
  else if(f==='allWeek'){j.allWeek=e.target.checked;if(!j.allWeek)j.allWeekWk=false;const t=card.querySelector('.wkbadge');if(t)t.hidden=!j.allWeek;const w=card.querySelector('.wkend');if(w){w.hidden=!j.allWeek;w.querySelector('input').checked=!!j.allWeekWk}}
  else if(f==='allWeekWk'){j.allWeekWk=e.target.checked}
  if(f==='allWeek'||f==='allWeekWk'){const cb=card.querySelector('[data-act="copynext"]');if(cb)cb.textContent='📋 Copiar pra '+shortWD(nextDayFor(j))}
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
// acrescenta uma obra em outro dia sem apagar nada do que já está lá (transação)
async function addJobTo(ds,nj){const path=dayPath(ds);
  if(ds===cur&&dayLoaded){D.jobs.push(nj);saveDay();renderJobs();return}
  const go=srv=>{const jobs=Array.isArray(srv&&srv.jobs)?srv.jobs.slice():[];if(jobs.some(x=>x.id===nj.id))return null;jobs.push(nj);
    const drivers={};jobs.forEach(x=>{const n=jobDrivers({crew:x.crew||[]});if(n.length)drivers[x.id]=n});
    return {date:ds,jobs,sent:(srv&&srv.sent)||{},drivers}};
  if(db.doc(path).tx)return db.doc(path).tx(go);
  const sn=await db.doc(path).get();const nd=go(sn.exists?sn.data():null);if(nd)await db.doc(path).set(nd)}
// src = id da obra original (a cópia guarda de onde veio), pra saber se é a MESMA turma ou outra turma no mesmo endereço
const srcOf=x=>x.src||x.id;
// próximo dia de trabalho da obra: pula sábado/domingo, a não ser que ela trabalhe no fim de semana
function nextDayFor(j,from){const [y,m,d]=(from||cur).split('-').map(Number);let dt=new Date(y,m-1,d+1);
  if(!j.allWeekWk)while(dt.getDay()===0||dt.getDay()===6)dt=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate()+1);return iso(dt)}
const shortWD=ds=>{const [y,m,d]=ds.split('-').map(Number);return ['domingo','segunda','terça','quarta','quinta','sexta','sábado'][new Date(y,m-1,d).getDay()]};
async function copyJobToNext(j,btn,auto){
  const next=nextDayFor(j);
  const nice=dateBR(next);btn.disabled=true;
  try{
    const snap=await db.doc(dayPath(next)).get();const day=snap.exists?snap.data():{date:next,jobs:[],sent:{}};
    const jobs=Array.isArray(day.jobs)?day.jobs.slice():[];
    const key=x=>akey((x.company||'')+'|'+(x.address||''));
    if(jobs.some(x=>srcOf(x)===srcOf(j))){toast(`Essa turma da ${j.company||'obra'} já está em ${nice}`);return}
    const same=jobs.filter(x=>key(x)===key(j));
    if(same.length){
      if(auto){if(same.some(x=>!x.src))return}   // All Week automático: cópia antiga (sem src) = mesma obra, não duplica
      else if(!confirm(`Já tem ${same.length>1?same.length+' obras':'uma obra'} da ${j.company||'companhia'} nesse endereço em ${nice}.\n\nÉ outra turma (outro setor)? Toque OK pra copiar mesmo assim.`))return;
    }
    const {calc,prevAddr,left,...rest}=clone(j);
    const nj=Object.assign(rest,{id:nid(),src:srcOf(j)});
    await addJobTo(next,nj);
    toast(`✓ ${j.company||'Obra'} copiada pra ${nice}`);
  }catch(e){console.error(e);toast('Não consegui copiar ('+(e.code||'erro')+')')}
  finally{btn.disabled=false}
}

/* ---------- barra de ferramentas ---------- */
$('addJob').onclick=()=>{if(!dayLoaded)return;const j={id:nid(),company:'',address:'',waiting:false,attire:ATTIRE,shop:'',start:'07:00',crew:[],need:0,travel:null,autoShop:true,tk:'',early:0};D.jobs.push(j);openPick=j.id;saveDay();renderJobs();const card=document.querySelector('.job[data-id="'+j.id+'"]');if(card)card.scrollIntoView({block:'start',behavior:'smooth'});const el=$('co-'+j.id);if(el)el.focus({preventScroll:true})};
$('addJob2').onclick=()=>$('addJob').click();
document.addEventListener('click',e=>{if(e.target.id==='addJobEnd')$('addJob').click()});
// "Copiar último dia": abre a lista das obras do último dia com escala (ex.: sexta, numa segunda) e copia só as marcadas
let CPV={date:null,jobs:[]};
$('copyPrev').onclick=async()=>{
  if(!dayLoaded)return;
  let prev=null,jobs=null;
  try{const q=await db.collection('days').where('date','<',cur).orderBy('date','desc').limit(20).get();
    const d=q.docs.find(x=>{const b=x.data();return b&&Array.isArray(b.jobs)&&b.jobs.length});if(d){prev=d.id;jobs=d.data().jobs}}
  catch(e){toast('Não consegui buscar o dia anterior');return}
  if(!prev){toast('Nenhum dia anterior salvo');return}
  CPV={date:prev,jobs};const have=new Set(D.jobs.map(srcOf));
  $('cpTitle').textContent='Copiar de '+WD[new Date(prev+'T12:00:00').getDay()].toLowerCase()+' '+prev.split('-').reverse().slice(0,2).join('/');
  $('cpList').innerHTML=jobs.map((j,i)=>{const already=have.has(srcOf(j));
    return `<label class="cprow${already?' dis':''}"><input type="checkbox" data-cp="${i}" ${already?'disabled':'checked'}>
      <span><b>${esc(j.company||'Obra')}</b>${j.allWeek?' <span class="wkbadge">All Week</span>':''}${already?' <span class="cpalready">já está neste dia</span>':''}
      <small>${esc(j.waiting||!j.address?'(Esperando)':j.address)} · ${(j.crew||[]).length} pessoa${(j.crew||[]).length===1?'':'s'}</small></span></label>`}).join('');
  $('copyDlg').hidden=false;document.body.classList.add('modal-open');
};
function closeCopy(){$('copyDlg').hidden=true;document.body.classList.remove('modal-open')}
$('copyDlg').addEventListener('click',e=>{
  if(e.target.id==='copyDlg'||e.target.id==='cpClose'){closeCopy();return}
  if(e.target.id==='cpAll'||e.target.id==='cpNone'){const on=e.target.id==='cpAll';$('cpList').querySelectorAll('input[data-cp]:not(:disabled)').forEach(c=>c.checked=on);return}
  if(e.target.id!=='cpGo')return;
  const pick=[...$('cpList').querySelectorAll('input[data-cp]:checked')].map(c=>CPV.jobs[+c.dataset.cp]).filter(Boolean);
  if(!pick.length){toast('Marque pelo menos uma obra');return}
  pick.forEach(j=>{const {calc,prevAddr,left,...rest}=clone(j);D.jobs.push(Object.assign(rest,{id:nid(),src:srcOf(j),left:0}))});
  saveDay();renderJobs();closeCopy();toast(`✓ ${pick.length} obra${pick.length>1?'s':''} copiada${pick.length>1?'s':''}`);
});
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
$('alerts').parentElement.addEventListener('click',e=>{
  if(e.target.id==='ackAlerts'){if(!confirm('Você já conferiu e corrigiu os avisos amarelos?\n\nEles somem e só voltam se aparecer algum aviso novo. Os vermelhos continuam até serem corrigidos.'))return;
    ackSet([...new Set([...ackGet(),...analyze().out.filter(o=>o[0]==='warn').map(o=>o[1])])]);refresh(false)}
  else if(e.target.id==='ackUndo'){ackSet([]);refresh(false)}
});
/* ---------- Histórico da escala: dayhist/{data}_{HHMM} (uma foto a cada 5 min de edição) → "Versões anteriores" ---------- */
function saveHist(data){try{const d=new Date(),b=pad(d.getHours())+pad(Math.floor(d.getMinutes()/5)*5);
  const jobs=data.jobs||[];db.doc('dayhist/'+data.date+'_'+b).set({date:data.date,at:Date.now(),by:(ctx&&ctx.email)||'',jobs,sent:data.sent||{},drivers:data.drivers||{},
    n:jobs.length,people:jobs.reduce((s,j)=>s+((j.crew||[]).length),0),left:jobs.filter(j=>j.left).length}).catch(e=>console.error('hist',e))}catch(e){}}
async function openHist(){$('histDlg').hidden=false;document.body.classList.add('modal-open');$('histList').innerHTML='<p class="empty">Carregando…</p>';
  try{const q=await db.collection('dayhist').where('date','==',cur).get();
    const rows=q.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>b.at-a.at);
    $('histTitle').textContent='Versões de '+dateBR(cur);
    $('histList').innerHTML=rows.length?rows.map((h,i)=>`<div class="histrow"><div><b>${esc(new Date(h.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase())}</b>${i===0?' <span class="wkbadge">mais recente</span>':''}
      <small>${h.n} obra${h.n===1?'':'s'} · ${h.people} pessoa${h.people===1?'':'s'} · ${h.left} despachada${h.left===1?'':'s'} · por ${esc((h.by||'').split('@')[0]||'?')}</small></div>
      ${i===0?'':`<button class="btn" data-hist="${esc(h.id)}">Voltar pra esta</button>`}</div>`).join(''):'<p class="empty">Ainda não tem versões guardadas deste dia. (O histórico começa a guardar a partir de agora.)</p>';
    HIST=rows}catch(e){console.error(e);$('histList').innerHTML='<p class="empty">Não consegui abrir o histórico ('+esc(e.code||'erro')+'). Atualize as regras do Firebase.</p>'}}
let HIST=[];
/* ---------- Recriar a escala a partir da mensagem do WhatsApp (a mesma que o app gera) ---------- */
function to24(t){const m=String(t||'').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);if(!m)return '';let h=+m[1];const mi=+(m[2]||0);
  if(m[3]==='pm'&&h<12)h+=12;if(m[3]==='am'&&h===12)h=0;return pad(h)+':'+pad(mi)}
function parseMsg(txt){
  const out=[];const blocks=String(txt||'').replace(/\r/g,'').split(/\n\s*_{2,}\s*(?=\n|$)/);
  blocks.forEach(b=>{const lines=b.split('\n');const i=lines.findIndex(l=>/^\s*✅/.test(l));if(i<0)return;
    const j={id:nid(),company:fmtCompany(lines[i].replace(/^\s*✅\s*/,'')),address:'',waiting:false,office:false,attire:'',shop:'',start:'',early:0,travel:null,autoShop:false,tk:'',need:0,note:'',allWeek:false,crew:[],left:0};
    let gotAddr=false;
    lines.slice(i+1).forEach(raw=>{const l=raw.trim();if(!l)return;
      if(/^✓/.test(l)){let r=l.replace(/^✓\s*/,'');let v='';
        const mv=r.match(/\s*(?:🛻|🚐|🚛|🚚|🚗)?\s*\((\w+)\)\s*$/u);
        if(mv){v=mv[1];r=r.slice(0,mv.index)}else if(/\s*🚗\s*$/u.test(r)){v=OWN;r=r.replace(/\s*🚗\s*$/u,'')}
        const name=fmtName(r.trim());if(name)j.crew.push({name,v});return}
      if(/^⏰/.test(l)){const m=l.match(/start\s+([\d:]+\s*[ap]m)/i);if(m)j.start=to24(m[1]);return}
      if(/^🔴/.test(l)){const r=l.replace(/^🔴\s*/,'');const m=r.match(/^([\d:]+\s*[ap]m)\s+no\s+shop/i);if(m)j.shop=to24(m[1]);else j.attire=r;return}
      if(/^\(\s*all\s*week\s*\)$/i.test(l)){j.allWeek=true;return}
      if(!gotAddr){gotAddr=true;if(/^\(\s*esperando\s*\)$/i.test(l)||/^\(endereço\?\)$/i.test(l))j.waiting=true;else j.address=fmtAddress(l);return}
      if(/^\(.*\)$/.test(l)){j.note=l.replace(/^\(|\)$/g,'').trim();return}
      j.note=(j.note?j.note+' ':'')+l});
    if(j.address){const k=akey(j.address);if(S.travel[k]!=null){j.travel=S.travel[k];j.tk=k}}
    j.need=j.crew.length;out.push(j)});
  return out}
let IMP=[];
function impPreview(){IMP=parseMsg($('impMsg').value);
  $('impOut').innerHTML=IMP.length?`<div class="alert ok">Achei <b>${IMP.length}</b> obra${IMP.length>1?'s':''} e <b>${IMP.reduce((s,j)=>s+j.crew.length,0)}</b> pessoas:</div>
    <div class="cdjobs">${IMP.map(j=>`<div class="cdj"><div><b>${esc(j.company||'Obra')}</b>${j.allWeek?' <span class="wkbadge">All Week</span>':''}<small>${esc(j.waiting?'(Esperando)':j.address)} · shop ${esc(fmt(j.shop)||'—')} · start ${esc(fmt(j.start)||'—')}</small>
      <small>${j.crew.map(c=>esc(c.name)+(c.v?' '+esc(vLabel(c.v)):'')).join(', ')||'sem equipe'}</small></div></div>`).join('')}</div>
    <div class="impbtns"><button class="btn primary" id="impAdd">Adicionar só as obras que faltam</button><button class="btn" id="impReplace">Substituir a escala do dia por esta</button></div>`
    :'<div class="alert warn">Não achei nenhuma obra. Cole a mensagem inteira, do jeito que foi pro grupo (cada obra começa com ✅).</div>'}
function impApply(mode){if(!P.escala||!IMP.length)return;const key=x=>akey((x.company||'')+'|'+(x.waiting?'':x.address||''));
  if(mode==='add'){const add=[],fill=[];IMP.forEach(j=>{const ex=D.jobs.find(x=>key(x)===key(j));if(!ex)add.push(j);else if(!ex.crew.length&&j.crew.length)fill.push([ex,j])});
    if(!add.length&&!fill.length){toast('Todas as obras da mensagem já estão na escala');return}
    if(!confirm(`Adicionar ${add.length} obra${add.length===1?'':'s'} que falta${add.length===1?'':'m'}${fill.length?` e completar a equipe de ${fill.length}`:''}?`))return;
    add.forEach(j=>D.jobs.push(j));fill.forEach(([ex,j])=>{ex.crew=j.crew;ex.need=Math.max(ex.need||0,j.crew.length)});
    saveDay();renderJobs();closeHist();toast(`✓ ${add.length} obra${add.length===1?'':'s'} adicionada${add.length===1?'':'s'}`);return}
  if(!confirm(`Substituir a escala de ${dateBR(cur)} pelas ${IMP.length} obras da mensagem?\n\nObras que já estavam marcadas como despachadas continuam despachadas. A versão de agora fica guardada no histórico.`))return;
  const old=D.jobs;D.jobs=IMP.map(j=>{const ex=old.find(x=>key(x)===key(j));return ex?Object.assign(j,{id:ex.id,left:ex.left||0,src:ex.src,travel:ex.travel!=null?ex.travel:j.travel,tk:ex.tk||j.tk}):j});
  saveDay();renderJobs();closeHist();toast(`✓ Escala recriada com ${IMP.length} obras`)}

function closeHist(){$('histDlg').hidden=true;document.body.classList.remove('modal-open')}
$('histDlg').addEventListener('click',e=>{
  if(e.target.id==='histDlg'||e.target.id==='histClose'){closeHist();return}
  const b=e.target.closest('[data-hist]');if(!b||!P.escala)return;const h=HIST.find(x=>x.id===b.dataset.hist);if(!h)return;
  if(!confirm(`Voltar a escala de ${dateBR(cur)} para como estava às ${new Date(h.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase()}?\n\n(${h.n} obras · ${h.people} pessoas · ${h.left} despachadas)\n\nA versão de agora também fica guardada no histórico.`))return;
  D=normDay({date:cur,jobs:h.jobs||[],sent:h.sent||{}});saveDay();renderJobs();closeHist();toast('✓ Escala voltou pra versão das '+new Date(h.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase());
});
$('alerts').parentElement.addEventListener('click',e=>{if(e.target.id==='openTv'){const w=window.open(location.pathname+location.search+(ctx&&ctx.email==='demo@exemplo'?'#demo-central':'#central'),'_blank');if(!w)openCentral();return}
  if(e.target.id==='pingTv'){db.doc('config/tvping').set({at:Date.now(),by:(ctx&&ctx.email)||''}).then(()=>toast('✓ Pedido enviado: a TV recarrega em alguns segundos'),err=>{console.error(err);toast('Não consegui avisar a TV ('+(err.code||'erro')+'). Atualize as regras do Firebase.')});return}
  if(e.target.id==='leftAll'&&P.escala){const pend=D.jobs.filter(j=>!j.left);if(!pend.length)return;
    const n=new Date(),def=n.getHours()+':'+pad(n.getMinutes());const t=prompt(`Marcar ${pend.length} obra${pend.length>1?'s':''} que ainda ${pend.length>1?'estão':'está'} aguardando como DESPACHADA${pend.length>1?'S':''}.\n\nQue horas saíram? (ex.: 6:00 ou 6:30am)`,def);if(t===null)return;
    const hh=to24(/[ap]m/i.test(t)?t:(+t.split(':')[0]<12&&+t.split(':')[0]>=5?t+'am':t))||to24(t);if(!hh){toast('Horário não entendido. Use por exemplo 6:00');return}
    const ms=new Date(cur+'T'+hh+':00').getTime();pend.forEach(j=>{j.left=ms;openLeft.delete(j.id)});saveDay();pend.filter(j=>j.allWeek).forEach(j=>copyJobToNext(j,{},true));renderJobs();renderCentral();toast(`✓ ${pend.length} obra${pend.length>1?'s':''} despachada${pend.length>1?'s':''} às ${fmt(hh)}`);return}
  if(e.target.id==='collapseAll'||e.target.id==='expandAll'){const open=e.target.id==='expandAll';D.jobs.forEach(j=>openLeft.set(j.id,open));renderJobs();return}if(e.target.id==='openHist')openHist();if(e.target.id==='openImp'){openHist();const d=$('impBox');d.open=true;setTimeout(()=>$('impMsg').focus(),100)}});
$('histDlg').addEventListener('click',e=>{if(e.target.id==='impPrev')impPreview();else if(e.target.id==='impAdd')impApply('add');else if(e.target.id==='impReplace')impApply('replace')});
// Horário vazio: abre o relógio já em AM (6:00 no shop, 7:00 no start) em vez da hora atual (à tarde = PM)
const amFill=e=>{const t=e.target;if(!t||t.type!=='time'||t.value||!t.dataset.f||t.closest('#tmDlg'))return;   // só nos horários da obra (shop/start), nunca na T&M
  t.value=t.dataset.f==='shop'?'06:00':'07:00';t.dataset.prefill='1'};
['pointerdown','touchstart','mousedown','focusin'].forEach(ev=>document.addEventListener(ev,amFill,{capture:true,passive:true}));   // antes do celular abrir o relógio
document.addEventListener('input',e=>{const t=e.target;if(t&&t.type==='time')delete t.dataset.prefill},true);
document.addEventListener('change',e=>{const t=e.target;if(t&&t.type==='time')delete t.dataset.prefill},true);
document.addEventListener('focusout',e=>{const t=e.target;if(t&&t.type==='time'&&t.dataset.prefill){const v=t.value;   // espera: no iPhone o 'change' chega depois do focusout
  setTimeout(()=>{if(t.dataset.prefill&&t.value===v&&document.activeElement!==t){t.value='';delete t.dataset.prefill}},500)}},true);
/* ---------- data ---------- */
const WD=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
function showWeekday(){const el=$('dateWeek');if(!el)return;const[y,m,d]=cur.split('-').map(Number);el.textContent=WD[new Date(y,m-1,d).getDay()]+(cur===iso(new Date())?' · hoje':'')}
function setDate(d){flushAll();cur=d;$('date').value=d;showWeekday();openPick=null;confirmDel=null;confirmClear=false;$('clearDay').textContent='Limpar dia';watchDay()}
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
function tab(which){['day','roster','access','photos','search','cal','tm'].forEach(t=>{const b=$('tab-'+t),v=$('view-'+t);if(b)b.setAttribute('aria-selected',t===which);if(v)v.hidden=t!==which})}
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
    <select data-vi="${i}" data-k="t" aria-label="Tipo" id="vt-${i}"><option${v.t==='🛻'?' selected':''}>🛻</option><option${v.t==='🚐'?' selected':''}>🚐</option><option${v.t==='🚛'?' selected':''}>🚛</option><option${v.t==='🚗'?' selected':''}>🚗</option></select>
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
  S.vehicles.forEach(v=>rows.push(['Veículo',v.n,v.t==='🚐'?'Van':v.t==='🚛'?'Caminhão':v.t==='🚗'?'Carro':'Pickup']));
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
    // T&M aberta (rascunho deste dia): acompanha a presença na hora
    try{if(tmCur&&tmCur.data.status==='draft'&&tmCur.data.date===cur){const jj=D.jobs.find(x=>x.id===tmCur.data.jobId);if(jj&&tmSyncAtt(tmCur.data,jj)){tmRender();tmSoon();toast('Lista ajustada pela presença marcada')}}}catch(e){}
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
    <div class="tmdrv"><button class="btn primary" data-tmopen="${j.id}">🧾 Time &amp; Material</button>${tmBadge(j)}</div>
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
let centralOn=false,cTimer=null,cUnsub=null,cLock=null,cWake=null;
const hm12=ms=>new Date(ms).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase().replace(' ','');
async function keepAwake(){try{if(centralOn&&navigator.wakeLock&&document.visibilityState==='visible')cLock=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',keepAwake);
// "🔄 Atualizar a TV": grava config/tvping {at}; a TV (aberta pelo link #central) recarrega a tela quando o valor muda
let tvUnsub=null,tvSeen=null;
function watchTvPing(){if(tvUnsub)return;tvSeen=null;
  try{tvUnsub=db.doc('config/tvping').onSnapshot(sn=>{const at=sn.exists?(sn.data()||{}).at||0:0;
    if(tvSeen===null){tvSeen=at;return}if(at!==tvSeen&&/central/.test(location.hash)&&!cUnlocked&&!cDetail&&$('cPin').hidden)location.reload();tvSeen=at},e=>console.error(e))}catch(e){}}
function openCentral(){
  centralOn=true;document.body.classList.add('totem-on');$('central').hidden=false;
  if(cur!==todayISO())setDate(todayISO());
  watchNextDays();watchTvPing();renderCentral();keepAwake();
  const openedOn=todayISO();let lastBeat=Date.now(),lastFull=Date.now();
  // batida a cada 1s: relógio sempre certo; se a TV "dormiu" (página parada > 1 min) ou virou o dia, atualiza na hora que acorda
  const beat=()=>{if(!centralOn)return;const now=Date.now(),slept=now-lastBeat>60000;lastBeat=now;
    if(todayISO()!==openedOn&&!cUnlocked&&!cDetail&&$('cPin').hidden){location.reload();return}
    $('cClock').textContent=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase();
    if(slept){checkUpdate()}
    if(slept||now-lastFull>=20000){lastFull=now;if(cur!==todayISO())setDate(todayISO());renderCentral()}};
  clearInterval(cTimer);cTimer=setInterval(beat,1000);
  cWake=()=>{lastBeat=0;beat()};
  if(!openCentral.hooked){openCentral.hooked=1;['visibilitychange','focus','pageshow','online'].forEach(ev=>window.addEventListener(ev,()=>{if(centralOn&&cWake)cWake()}))}
}
function closeCentral(){
  centralOn=false;clearInterval(cTimer);if(cUnsub){cUnsub();cUnsub=null}if(tvUnsub){tvUnsub();tvUnsub=null}
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
async function checkUpdate(){const v=await swVersion();if(!v)return;if(!appVer){appVer=v;return}if(v===appVer)return;
  if(centralOn){if(!cUnlocked&&!cDetail&&$('cPin').hidden)location.reload();return}
  if(!$('updBar')){const b=document.createElement('button');b.id='updBar';b.className='updbar';b.textContent='🔄 Saiu uma versão nova do app · toque aqui pra atualizar';b.onclick=()=>{flushAll();location.reload()};document.body.appendChild(b)}}
setInterval(()=>{if(centralOn)checkUpdate()},300000);          // Central: a cada 5 min
setInterval(()=>{if(!centralOn)checkUpdate()},120000);         // app normal: a cada 2 min mostra o aviso
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkUpdate()});
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
  let nd=null;for(let i=1;i<=4&&!nd;i++){const d=new Date();d.setDate(d.getDate()+i);const ds=iso(d);const js=((CNEXT[ds]||{}).jobs||[]).filter(j=>j.company||(j.crew||[]).length);if(js.length)nd={ds,i,js}}
  const onlyT=!!nd&&new Date().getHours()>=15;   // depois das 3 da tarde: só o próximo dia
  const pill=(n,k,c)=>`<div class="cpill${c?' '+c:''}"><b>${n}</b><span>${k}</span></div>`;
  if(onlyT){const tj=nd.js,need=tj.reduce((n,j)=>n+Math.max(+j.need||0,(j.crew||[]).length),0),has=tj.reduce((n,j)=>n+(j.crew||[]).length,0),vag=tj.reduce((n,j)=>n+Math.max(0,(+j.need||0)-(j.crew||[]).length),0);
    $('cStats').innerHTML=pill(tj.length,(nd.i===1?'obras amanhã':'obras no próximo dia'))+pill(has+'/'+need,'pessoas escaladas',vag?'':'ok')+(vag?pill(vag,vag===1?'vaga aberta':'vagas abertas','bad'):'')}
  else $('cStats').innerHTML=pill(jobs.length,jobs.length===1?'obra':'obras')+pill(desp+'/'+jobs.length,'despachadas',jobs.length&&desp===jobs.length?'ok':'')
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
  const showT=!!nd&&(onlyT||new Date().getHours()>=12||!jobs.length||desp===jobs.length);
  const w=body.clientWidth,cols=w>=1300?3:w>=720?2:1,gap=12;
  const tile=j=>{const st=stOf(j);return `<div class="ctile2 ${st}" data-cd="${j.id}"><div class="t2h"><span class="cdot2"></span><b>${name(j)}</b><span class="t2p">${people(j)} 👷</span></div>
    <div class="t2s">${badge(j)}<span class="t2w">${when(j)}</span></div><div class="t2m">${subOf(j)||'&nbsp;'}</div></div>`};
  const grid=arr=>`<div class="cgrid" style="--cols:${cols}">${arr.join('')}</div>`;
  const pages=[];let th=0;
  const measure=html=>{body.innerHTML=html;const t=body.querySelector('.ctile2');return t?t.offsetHeight:0};
  if(list.length&&!onlyT){
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
$('cExit').onclick=closeCentral;
$('cFull').onclick=()=>{try{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}catch(e){}};
if($('openCentral')){$('openCentral').hidden=!!(ctx&&ctx.totem);$('openCentral').onclick=openCentral}
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
  {const asg=new Set();jobs.forEach(j=>j.crew.forEach(c=>asg.add(nkey(c.name))));
    const offs=Object.keys(OFF).map(tidy).filter(Boolean),fora=S.workers.filter(w=>!asg.has(nkey(w))&&!isOff(w)).map(tidy);
    if(fora.length||offs.length){L.push('');
      if(fora.length)L.push(`👷 *Fora do schedule* (${fora.length})`,fora.join(', '));
      if(offs.length){if(fora.length)L.push('');L.push(`🌴 *Day off*: ${offs.join(', ')}`)}}}
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
  const key=addr?akey(addr):'',travel=key&&S.travel[key]!=null?S.travel[key]:null,early=0;
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
      await addJobTo(ds,j);
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
/* ===================== TIME & MATERIAL digital (folha de ponto) =====================
   tm/{data}_{jobId}: {date, jobId, site, company, location, jobNo, rows[{name,in,out,lunch}], materials,
     status:'draft'|'pending'|'signed'|'invoiced', no:'D-0001', sign{name,title,img}, tmh(min), driver, by, atMs, sentAt, invoice, log[]}
   Número: counters/tm {next} (transação, nunca repete). Horas: (saída−entrada) − 30 min de almoço (todos tiram, sempre desconta);
   arredonda pra hora cheia só quando faltam menos de 5 min (7h56 → 8h00). */
const FIN=!!(P.financeiro||isAdmin);
const TMS={};let tmUnsub=null,tmDocUnsubs=[],tmCur=null,tmDirty=false,tmSaveT=null,tmSign=null;
const tmId=(date,jobId)=>date+'_'+jobId;
const tmMin=t=>{if(!t||!/^\d{1,2}:\d{2}$/.test(t))return null;const[h,m]=t.split(':').map(Number);return h*60+m};
function rowMinutes(r){const a=tmMin(r.in),b=tmMin(r.out);if(a==null||b==null)return 0;let m=b-a;if(m<0)m+=1440;if(m>30)m-=30;
  const rem=m%60;if(rem>=56)m+=60-rem;return m}
const hmTxt=m=>m?Math.floor(m/60)+'h'+String(m%60).padStart(2,'0'):'—';
const hDec=m=>(m/60).toFixed(2);
const tmTotal=t=>(t.rows||[]).filter(r=>tidy(r.name)).reduce((s,r)=>s+rowMinutes(r),0);
const tmStatusTxt={draft:'Rascunho',pending:'Enviando…',signed:'Assinada',invoiced:'Faturada'};
const tmCanEdit=t=>(!t||t.status==='draft')&&(P.escala||myJobs().some(j=>j.id===(t&&t.jobId)));
function tmNew(j){return {date:cur,jobId:j.id,site:jobSite(j),company:tidy(j.company),location:j.waiting?'':tidy(j.address),jobNo:'',
  rows:tmPeople(j).map(n=>({name:n,in:'',out:'',lunch:true})),materials:'',status:'draft',no:'',sign:null,tmh:0,
  driver:(myJobs().some(x=>x.id===j.id)&&ME)||jobDrivers(j)[0]||'',by:(ctx&&ctx.email)||'',atMs:Date.now(),invoice:'',log:[]}}
let tmKey='';
function watchTm(){const key=(P.escala||FIN)?'all:'+cur:cur+':'+myJobs().map(j=>j.id).join(',');if(key===tmKey)return;tmKey=key;
  tmDocUnsubs.forEach(u=>u());tmDocUnsubs=[];if(tmUnsub){tmUnsub();tmUnsub=null}Object.keys(TMS).forEach(k=>delete TMS[k]);
  const redraw=()=>{renderTmTab();renderPhotos();if(!tmCur||!TMS[tmCur.id])return;const srv=TMS[tmCur.id];
    // enquanto alguém está preenchendo, não redesenha (perderia o que está digitando); só quando mudou o status (enviada/destrancada/faturada)
    if(srv.status!==tmCur.data.status||srv.no!==tmCur.data.no||srv.invoice!==tmCur.data.invoice||!tmCanEdit(tmCur.data)){if(tmDirty&&tmCanEdit(tmCur.data)&&srv.status!=='draft')toast('Esta T&M foi enviada em outro aparelho');tmCur.data=clone(srv);tmDirty=false;tmRender()}};
  if(P.escala||FIN){tmUnsub=db.collection('tm').where('date','==',cur).onSnapshot(s=>{Object.keys(TMS).forEach(k=>delete TMS[k]);s.docs.forEach(d=>TMS[d.id]=d.data());redraw()},e=>console.error('tm',e))}
  else myJobs().forEach(j=>{tmDocUnsubs.push(db.doc('tm/'+tmId(cur,j.id)).onSnapshot(d=>{const x=d.exists?d.data():null;if(x)TMS[d.id]=x;else delete TMS[d.id];redraw()},e=>console.error('tm',e)))})}
function tmBadge(j){const t=TMS[tmId(cur,j.id)];if(!t)return '<span class="tmb none">sem T&M</span>';
  return `<span class="tmb ${t.status}">${t.no?esc(t.no)+' · ':''}${tmStatusTxt[t.status]||''}</span>`}
/* nomes da T&M = quem o motorista marcou que VEIO (Quem veio hoje?). Sem presença marcada: a equipe toda. */
function tmPeople(j){const a=ATT[j.id];const ppl=(a&&a.people)||{};const marked=Object.keys(ppl).length>0;
  const out=j.crew.filter(c=>marked?attOf(j,c.name)==='in':true).map(c=>tidy(c.name));
  if(marked)Object.keys(ppl).forEach(n=>{if(ppl[n]==='in'&&!out.some(x=>nkey(x)===nkey(n)))out.push(tidy(n))});return out}
function tmAttNote(j){const a=ATT[j.id];const ppl=(a&&a.people)||{};
  if(!Object.keys(ppl).length)return '<p class="alert warn tmatt">⚠️ A presença ainda não foi marcada ("Quem veio hoje?"). Por enquanto veio a equipe toda da escala: marque quem veio e quem faltou que a lista se ajusta sozinha.</p>';
  const falt=Object.keys(ppl).filter(n=>ppl[n]==='out'),sem=j.crew.filter(c=>!attOf(j,c.name)).map(c=>c.name);
  return `<p class="alert ok tmatt">✓ Nomes puxados da presença (quem veio).${falt.length?' Faltaram (fora da folha): '+esc(falt.join(', '))+'.':''}${sem.length?' <b>Sem marcar:</b> '+esc(sem.join(', '))+' — marque em "Quem veio hoje?".':''}</p>`}
/* rascunho aberto de novo: tira quem foi marcado que faltou (se não tem horário) e põe quem veio e não está */
function tmSyncAtt(t,j){if(!j||t.status!=='draft')return false;const a=ATT[j.id];const ppl=(a&&a.people)||{};if(!Object.keys(ppl).length)return false;let ch=false;
  // sai da folha: quem foi marcado Faltou, e quem é da equipe mas ainda não foi marcado (mesmo que já tenha horário do "Aplicar pra todos")
  t.rows=t.rows.filter(r=>{if(!tidy(r.name))return true;const k=Object.keys(ppl).find(n=>nkey(n)===nkey(r.name));
    const crew=j.crew.some(c=>nkey(c.name)===nkey(r.name));if((k&&ppl[k]==='out')||(!k&&crew)){ch=true;return false}return true});
  tmPeople(j).forEach(n=>{if(!t.rows.some(r=>nkey(r.name||'')===nkey(n))){const i=t.rows.findIndex(r=>!tidy(r.name));const row={name:n,in:'',out:'',lunch:true};if(i>=0)t.rows.splice(i,0,row);else t.rows.push(row);ch=true}});
  return ch}
/* ---- editor ---- */
// acha a T&M salva: a do dia aberto (TMS) ou uma que veio do resumo de horas (outro dia)
function tmFind(id){if(TMS[id])return TMS[id];const h=(typeof hrsData!=='undefined'?hrsData:[]).find(x=>x._id===id);if(!h)return null;const o=Object.assign({},h);delete o._id;return o}
function tmOpen(jobId,date){const d=date||cur,id=tmId(d,jobId);const j=d===cur?D.jobs.find(x=>x.id===jobId):null;const saved=tmFind(id);
  const base=saved?clone(saved):(j?tmNew(j):null);if(!base){toast('Não achei essa T&M');return}
  if(saved&&j&&tmSyncAtt(base,j)){tmCur={id,data:base};tmDirty=true;$('tmDlg').hidden=false;document.body.classList.add('modal-open');tmRender();tmSoon();toast('Lista ajustada pela presença marcada');return}
  tmCur={id,data:base};tmDirty=false;$('tmDlg').hidden=false;document.body.classList.add('modal-open');tmRender()}
function tmClose(){if(tmDirty&&tmCanEdit(tmCur.data))tmSave(true);tmCur=null;$('tmDlg').hidden=true;document.body.classList.remove('modal-open')}
function tmRender(){if(!tmCur)return;const t=tmCur.data,ed=tmCanEdit(t);
  // sempre uma linha vazia no fim (abre mais uma quando preenche a última)
  if(ed){if(!t.rows.length||tidy(t.rows[t.rows.length-1].name))t.rows.push({name:'',in:'',out:'',lunch:true})}
  const rows=t.rows.map((r,i)=>{const m=rowMinutes(r);return `<tr data-ri="${i}"><td class="tmn">${i+1}</td>
    <td>${ed?`<input data-tf="name" value="${esc(r.name)}" list="tmWorkers" placeholder="Nome" aria-label="Nome ${i+1}">`:esc(r.name)}</td>
    <td>${ed?`<input type="time" data-tf="in" value="${esc(r.in)}" aria-label="Entrada ${i+1}">`:esc(fmt(r.in)||'—')}</td>
    <td>${ed?`<input type="time" data-tf="out" value="${esc(r.out)}" aria-label="Saída ${i+1}">`:esc(fmt(r.out)||'—')}</td>
    <td class="tmh" id="tmh-${i}">${tidy(r.name)?hmTxt(m):''}</td></tr>`}).join('');
  const sg=t.sign||{};
  $('tmBody').innerHTML=`<div class="tmhead"><div class="tmlogo"><div class="logo" role="img" aria-label="Cruz Solutions"></div><small>599 Concord St · Holliston, MA 01746<br>(508) 246-3219</small></div>
      <div class="tmtitle"><b>Time &amp; Material</b><span class="tmno">${t.no?esc(t.no):'<i>número sai ao enviar</i>'}</span><span class="tmst ${t.status}">${tmStatusTxt[t.status]||''}</span></div></div>
    <div class="tmgrid">
      <label class="f">Bill To<input data-tk="company" value="${esc(t.company)}" ${ed?'':'disabled'}></label>
      <label class="f">Date<input value="${esc(t.date.split('-').reverse().join('/'))}" disabled></label>
      <label class="f">Location<input data-tk="location" value="${esc(t.location)}" ${ed?'':'disabled'}></label>
      <label class="f">Job #<input data-tk="jobNo" value="${esc(t.jobNo)}" placeholder="opcional" ${ed?'':'disabled'}></label>
    </div>
    ${ed&&t.date===cur&&D.jobs.find(x=>x.id===t.jobId)?tmAttNote(D.jobs.find(x=>x.id===t.jobId)):''}
    ${ed?`<div class="tmteam"><b>Horário da turma</b><input type="time" id="tmTin" aria-label="Entrada da turma"><span>até</span><input type="time" id="tmTout" aria-label="Saída da turma">
      <button class="btn" id="tmApply">Aplicar pra todos</button><small>Depois é só mudar quem foi diferente.</small></div>`:''}
    <div class="tmtablewrap"><table class="tmtable"><thead><tr><th>#</th><th>Names</th><th>Time In</th><th>Time Out</th><th title="Já descontado 30 min de almoço">Horas</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td></td><td colspan="3" class="tmtotl">TMH (total da turma · já descontado 30 min de almoço de cada um)</td><td class="tmh" id="tmTot">${hmTxt(tmTotal(t))}</td></tr></tfoot></table></div>
    <label class="f">Materials &amp; Equipment<textarea data-tk="materials" rows="3" ${ed?'':'disabled'}>${esc(t.materials)}</textarea></label>
    <div class="tmsign"><p class="tmlegal">By signing below, you are acknowledging receipt of the above Time and Material description and that the work described therein was completed in a professional and satisfactory manner. You are also warranting that you have the legal authority to execute this contract on behalf of the above named company and <u>that your company is responsible for the amount due.</u></p>
      <div class="tmgrid"><label class="f">Print Name<input data-sk="name" value="${esc(sg.name||'')}" ${ed?'':'disabled'}></label><label class="f">Title<input data-sk="title" value="${esc(sg.title||'')}" ${ed?'':'disabled'}></label></div>
      ${ed?`<div class="tmpadwrap"><canvas id="tmPad" width="600" height="180" aria-label="Assinatura do cliente"></canvas><button class="linkbtn" id="tmPadClear">Limpar assinatura</button></div>`
          :(sg.img?`<img class="tmsigimg" src="${esc(sg.img)}" alt="Assinatura">`:'<p class="hint">Sem assinatura do cliente.</p>')}
      <small class="hint">Signature${t.sentAt?' · enviada '+esc(new Date(t.sentAt).toLocaleString('en-US',{month:'2-digit',day:'2-digit',hour:'numeric',minute:'2-digit'})):''}</small></div>
    ${FIN&&t.status!=='draft'?`<div class="tmoffice"><b>For office use only</b><label class="f">Invoice #<input id="tmInv" value="${esc(t.invoice||'')}"></label>
      <button class="btn" id="tmInvSave">${t.status==='invoiced'?'Salvar Invoice #':'Salvar e marcar como faturada'}</button></div>`:''}
    <div class="tmbtns">${ed?`<button class="btn" id="tmSaveBtn">Salvar rascunho</button><button class="btn primary" id="tmSend">✍️ Enviar T&amp;M</button>`:''}
      ${t.status!=='draft'?`<button class="btn" id="tmPdf">📄 Baixar PDF</button>`:''}
      ${isAdmin&&t.status!=='draft'?`<button class="linkbtn" id="tmUnlock">Destrancar pra corrigir</button>`:''}
      ${isAdmin&&tmFind(tmCur.id)?`<button class="linkbtn tmdel" id="tmDel">🗑 Excluir T&amp;M</button>`:''}</div>
    <datalist id="tmWorkers">${S.workers.map(w=>`<option value="${esc(w)}">`).join('')}</datalist>`;
  if(ed){tmPadInit(sg.img||null)}
}
function tmRecalc(){const t=tmCur.data;t.rows.forEach((r,i)=>{const el=$('tmh-'+i);if(el)el.textContent=tidy(r.name)?hmTxt(rowMinutes(r)):''});$('tmTot').textContent=hmTxt(tmTotal(t))}
function tmPadInit(img){const c=$('tmPad');if(!c)return;const g=c.getContext('2d');g.lineWidth=2.5;g.lineCap='round';g.strokeStyle='#111';
  tmSign={c,g,drawn:!!img,img};if(img){const im=new Image();im.onload=()=>g.drawImage(im,0,0,c.width,c.height);im.src=img}
  let down=false,last=null;const pos=e=>{const r=c.getBoundingClientRect();return [(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]};
  c.onpointerdown=e=>{down=true;last=pos(e);c.setPointerCapture(e.pointerId);e.preventDefault()};
  c.onpointermove=e=>{if(!down)return;const p=pos(e);g.beginPath();g.moveTo(last[0],last[1]);g.lineTo(p[0],p[1]);g.stroke();last=p;tmSign.drawn=true;tmDirty=true};
  c.onpointerup=c.onpointercancel=()=>{if(down){down=false;tmSign.img=c.toDataURL('image/png');tmCur.data.sign=Object.assign({},tmCur.data.sign||{},{img:tmSign.img});tmSoon()}}}
function tmSoon(){tmDirty=true;clearTimeout(tmSaveT);tmSaveT=setTimeout(()=>tmSave(true),1500)}
function tmClean(t){const o=clone(t);o.rows=(o.rows||[]).filter(r=>tidy(r.name)).map(r=>({name:fmtName(r.name),in:r.in||'',out:r.out||'',lunch:true}));
  o.tmh=tmTotal(o);o.atMs=Date.now();o.by=(ctx&&ctx.email)||o.by||'';return o}
async function tmSave(quiet){if(!tmCur||!tmCanEdit(tmCur.data))return;clearTimeout(tmSaveT);const id=tmCur.id,o=tmClean(tmCur.data);
  tmDirty=false;const pr=db.doc('tm/'+id).set(o);if(!navigator.onLine){pr.catch(e=>console.error(e));if(!quiet)toast('Sem internet: guardado no aparelho, envia quando voltar');return}
  try{await pr;if(!quiet)toast('✓ Rascunho salvo')}catch(e){console.error(e);if(tmCur&&tmCur.id===id)tmDirty=true;toast('Não consegui salvar a T&M ('+(e.code||'erro')+')')}}
async function tmNumber(id){   // pega o próximo número (transação) e tranca a T&M
  const res=await db.doc('counters/tm').tx(c=>({next:((c&&c.next)||1)+1}));const n=(res.next||2)-1;const no='D-'+String(n).padStart(4,'0');
  const cur0=(await db.doc('tm/'+id).get()).data()||{};
  await db.doc('tm/'+id).set(Object.assign(cur0,{no,status:'signed',sentAt:cur0.sentAt||Date.now(),log:(cur0.log||[]).concat([{at:Date.now(),by:(ctx&&ctx.email)||'',what:'enviada '+no}])}));return no}
async function tmSend(){const t=tmCur.data,o=tmClean(t);
  if(!o.rows.length){toast('Coloque pelo menos um nome');return}
  const miss=o.rows.filter(r=>!r.in||!r.out).map(r=>r.name);if(miss.length){toast('Falta horário de: '+miss.join(', '),5000);return}
  if(!o.company){toast('Falta o Bill To (companhia)');return}
  const hasSig=!!(t.sign&&t.sign.img);const jj=t.date===cur&&D.jobs.find(x=>x.id===t.jobId);const semMarca=jj&&ATT[jj.id]&&ATT[jj.id].people?jj.crew.filter(c=>!attOf(jj,c.name)&&!o.rows.some(r=>nkey(r.name)===nkey(c.name))).map(c=>c.name):[];
  if(!confirm(`Enviar a T&M de ${o.company}?\n\n${o.rows.length} pessoa${o.rows.length>1?'s':''} · TMH ${hmTxt(o.tmh)}${hasSig?'':'\n\n⚠️ Está SEM assinatura do cliente.'}${semMarca.length?'\n\n⚠️ Sem presença marcada e fora da folha: '+semMarca.join(', '):''}\n\nDepois de enviada ela fica trancada.`))return;
  o.status='pending';o.sentAt=Date.now();o.log=(o.log||[]).concat([{at:Date.now(),by:o.by,what:'enviada pelo app'+(hasSig?'':' (sem assinatura)')}]);
  const id=tmCur.id;const pr=db.doc('tm/'+id).set(o);if(navigator.onLine){try{await pr}catch(e){console.error(e);toast('Não consegui enviar ('+(e.code||'erro')+')');return}}else pr.catch(e=>console.error(e));
  tmDirty=false;tmCur.data=o;
  if(navigator.onLine){try{const no=await tmNumber(id);toast('✓ T&M '+no+' enviada');tmCur.data=Object.assign(o,{no,status:'signed'})}catch(e){console.error(e);toast('Enviada. O número sai quando a internet firmar.')}}
  else toast('Sem internet: a T&M foi guardada e recebe o número quando a internet voltar.',5000);
  tmRender()}
async function tmFinishPending(){if(!navigator.onLine)return;try{const by=(ctx&&ctx.email)||'';if(!by)return;
  const q=await db.collection('tm').where('status','==','pending').where('by','==',by).get();for(const d of q.docs){try{await tmNumber(d.id)}catch(e){console.error(e)}}}catch(e){}}
window.addEventListener('online',tmFinishPending);setTimeout(tmFinishPending,4000);
/* ---- PDF (abre a folha pronta pra imprimir / salvar em PDF) ---- */
let tmLogo='';function tmLogoData(){if(tmLogo)return Promise.resolve(tmLogo);return new Promise(res=>{const im=new Image();im.onload=()=>{try{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);tmLogo=c.toDataURL('image/png')}catch(e){}res(tmLogo)};im.onerror=()=>res('');im.src='img/logo-mask.png'})}
async function tmPdf(t){const rows=t.rows.slice();while(rows.length<15)rows.push({name:''});
  const w=window.open('','_blank');if(!w){toast('O navegador bloqueou a janela do PDF. Libere pop-ups pra este site.');return}
  w.document.write('<p style="font-family:sans-serif">Preparando o PDF…</p>');const logo=await tmLogoData();w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>T&M ${esc(t.no||'')} - ${esc(t.company)}</title><style>
  @page{size:letter;margin:9mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{width:748px;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{border:1.5px solid #222;padding:12px 14px;break-inside:avoid;page-break-inside:avoid}.top{display:flex;justify-content:space-between;gap:16px}.co{text-align:center;width:52%}
  .lg{display:block;width:130px;height:84px;margin:0 auto;object-fit:contain}
  .co p{margin:2px 0;font-weight:700}.ti{width:44%}.ti h1{font-size:22px;margin:0;text-align:center}.ti .no{text-align:center;font-size:18px;margin:2px 0 8px;font-family:"Courier New",monospace}
  .ln{display:flex;gap:6px;margin:5px 0}.ln span{white-space:nowrap}.ln b{flex:1;border-bottom:1px solid #333;font-weight:400;min-height:15px;padding-left:4px}
  .box{border:1px solid #333;padding:4px 8px;margin-top:6px}.box h4{margin:0;text-align:center;font-size:10px}
  table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #333;padding:2px 6px;height:19px}th{font-weight:400}td.c{text-align:center}
  .mat{border:1px solid #333;border-top:0;min-height:70px;padding:4px 8px;white-space:pre-wrap}.legal{font-size:10.5px;margin:10px 0}
  .sig{display:flex;justify-content:space-between;gap:20px;margin-top:10px}.sig div{flex:1;text-align:center}.sig .v{border-bottom:1px solid #333;min-height:44px;display:flex;align-items:flex-end;justify-content:center}
  .sig img{max-height:60px}.tot td{font-weight:700}small{color:#555}</style></head><body><div class="sheet">
  <div class="top"><div class="co">${logo?`<img class="lg" src="${logo}" alt="Cruz Solutions">`:'<h2>CRUZ SOLUTIONS</h2>'}<p>599 Concord St, • Holliston, MA 01746</p><p>Phone: (508) 246-3219</p><p>info@cruzsolutionsinc.com</p>
    <div class="ln" style="text-align:left"><span>Bill To:</span><b>${esc(t.company)}</b></div></div>
   <div class="ti"><h1>Time &amp; Material</h1><div class="no">${esc(t.no||'')}</div>
    <div class="ln"><span>Job #:</span><b>${esc(t.jobNo||'')}</b></div><div class="ln"><span>Location:</span><b>${esc(t.location||'')}</b></div>
    <div class="box"><h4>FOR OFFICE USE ONLY:</h4><div class="ln"><span>TMH:</span><b>${esc(hmTxt(t.tmh||tmTotal(t)))} (${hDec(t.tmh||tmTotal(t))} h)</b></div><div class="ln"><span>Invoice #:</span><b>${esc(t.invoice||'')}</b></div></div></div></div>
  <table><thead><tr><th style="width:16%">Date</th><th>Names</th><th style="width:13%">Time In</th><th style="width:13%">Time Out</th><th style="width:11%">Hours</th></tr></thead><tbody>
  ${rows.map((r,i)=>`<tr><td class="c">${r.name?esc(t.date.slice(5).replace('-','/')+'/'+t.date.slice(2,4)):''}</td><td>${i+1}. ${esc(r.name||'')}</td><td class="c">${esc(fmt(r.in)||'')}</td><td class="c">${esc(fmt(r.out)||'')}</td><td class="c">${r.name?esc(hmTxt(rowMinutes(r))):''}</td></tr>`).join('')}
  <tr class="tot"><td></td><td style="text-align:right">TMH (lunch 30 min deducted)</td><td></td><td></td><td class="c">${esc(hmTxt(t.tmh||tmTotal(t)))}</td></tr></tbody></table>
  <div class="mat"><b>Materials &amp; Equipment:</b>\n${esc(t.materials||'')}</div>
  <p class="legal">By signing below, you are acknowledging receipt of the above Time and Material description and that the work described therein was completed in a professional and satisfactory manner. You are also warranting that you have the legal authority to execute this contract on behalf of the above named company and <b><u>that your company is responsible for the amount due.</u></b></p>
  <div class="sig"><div><div class="v">${esc((t.sign&&t.sign.title)||'')}</div>Title</div><div style="max-width:30%"><div class="v">${t.sentAt?esc(new Date(t.sentAt).toLocaleDateString('en-US')):''}</div>Date</div></div>
  <div class="sig"><div><div class="v">${esc((t.sign&&t.sign.name)||'')}</div>Print Name</div><div style="max-width:40%"><div class="v">${t.sign&&t.sign.img?`<img src="${esc(t.sign.img)}">`:''}</div>Signature</div></div>
  </div><small>Digital T&amp;M · Cruz Solutions Schedule</small></body></html>`);
  w.document.close();
  // cabe numa folha só: mede a folha e, se passar da altura da página Letter, diminui tudo na proporção
  const fit=()=>{try{const sh=w.document.querySelector('.sheet'),ft=w.document.querySelector('body>small');sh.style.zoom='';const hgt=sh.offsetHeight+(ft?ft.offsetHeight:0)+4;
    const maxH=950;if(hgt>maxH){const z=Math.max(.5,maxH/hgt);w.document.body.style.zoom=z}}catch(e){}};
  setTimeout(()=>{fit();try{w.focus();w.print()}catch(e){}},700)}
/* ---- eventos do editor ---- */
$('tmDlg').addEventListener('input',e=>{if(!tmCur)return;const t=tmCur.data,el=e.target;
  const tr=el.closest('tr[data-ri]');if(tr&&el.dataset.tf){const r=t.rows[+tr.dataset.ri];if(!r)return;r[el.dataset.tf]=el.value;
    if(el.dataset.tf==='name'&&+tr.dataset.ri===t.rows.length-1&&tidy(el.value)){t.rows.push({name:'',in:'',out:'',lunch:true});const tb=$('tmBody').querySelector('tbody');const i=t.rows.length-1;
      tb.insertAdjacentHTML('beforeend',`<tr data-ri="${i}"><td class="tmn">${i+1}</td><td><input data-tf="name" list="tmWorkers" placeholder="Nome" aria-label="Nome ${i+1}"></td><td><input type="time" data-tf="in" aria-label="Entrada ${i+1}"></td><td><input type="time" data-tf="out" aria-label="Saída ${i+1}"></td><td class="tmh" id="tmh-${i}"></td></tr>`)}
    tmRecalc();tmSoon();return}
  if(el.dataset.tk){t[el.dataset.tk]=el.value;tmSoon();return}
  if(el.dataset.sk){t.sign=Object.assign({},t.sign||{},{[el.dataset.sk]:el.value});tmSoon()}});
$('tmDlg').addEventListener('click',async e=>{const id=e.target.id;if(!tmCur&&id!=='tmDlg')return;
  if(id==='tmDlg'||id==='tmClose'){tmClose();return}
  if(id==='tmApply'){const a=$('tmTin').value,b=$('tmTout').value;if(!a||!b){toast('Coloque a entrada e a saída da turma');return}
    tmCur.data.rows.forEach(r=>{if(tidy(r.name)){r.in=a;r.out=b}});tmDirty=true;tmRender();tmSoon();return}
  if(id==='tmPadClear'){if(tmSign){tmSign.g.clearRect(0,0,tmSign.c.width,tmSign.c.height);tmSign.img=null;tmSign.drawn=false}tmCur.data.sign=Object.assign({},tmCur.data.sign||{},{img:null});tmSoon();return}
  if(id==='tmSaveBtn'){tmSave(false);return}
  if(id==='tmSend'){tmSend();return}
  if(id==='tmPdf'){tmPdf(tmCur.data);return}
  if(id==='tmInvSave'&&FIN){const inv=tidy($('tmInv').value);const t=TMS[tmCur.id]||tmCur.data;const o=Object.assign(clone(t),{invoice:inv,status:inv?'invoiced':'signed',log:(t.log||[]).concat([{at:Date.now(),by:(ctx&&ctx.email)||'',what:inv?'faturada · invoice '+inv:'invoice apagado'}])});
    try{await db.doc('tm/'+tmCur.id).set(o);tmCur.data=o;tmRender();toast(inv?'✓ Marcada como faturada':'Invoice # apagado')}catch(err){console.error(err);toast('Não consegui salvar ('+(err.code||'erro')+')')}return}
  if(id==='tmDel'&&isAdmin){tmDelOpen(tmCur.id);return}
  if(id==='tmUnlock'&&isAdmin){if(!confirm('Destrancar esta T&M pra corrigir? Fica registrado no histórico dela.'))return;const t=tmCur.data;
    const o=Object.assign(clone(t),{status:'draft',log:(t.log||[]).concat([{at:Date.now(),by:(ctx&&ctx.email)||'',what:'destrancada pra correção (número '+(t.no||'-')+' mantido)'}])});
    try{await db.doc('tm/'+tmCur.id).set(o);tmCur.data=o;tmRender();toast('Destrancada: corrija e envie de novo')}catch(err){toast('Não consegui ('+(err.code||'erro')+')')}}});
/* ---- aba T&M (escritório / financeiro) ---- */
function renderTmTab(){const box=$('tmList');if(!box||$('view-tm').hidden||$('tmPaneDay').hidden)return;
  const jobs=D.jobs.filter(j=>j.company||j.crew.length);
  $('tmDay').textContent=dateBR(cur);
  box.innerHTML=jobs.length?jobs.map(j=>{const t=TMS[tmId(cur,j.id)];
    return `<div class="tmrow"><div><b>${esc(tidy(j.company)||'Obra')}</b> ${tmBadge(j)}<small>${esc(j.waiting?'(Esperando)':j.address)} · ${j.crew.length} pessoas${t?' · TMH '+hmTxt(t.tmh||tmTotal(t)):''}${t&&t.invoice?' · Invoice '+esc(t.invoice):''}</small></div>
      <div class="tmrowbtn"><button class="btn" data-tmopen="${j.id}">${t?(t.status==='draft'?'Continuar':'Abrir'):'Criar T&M'}</button>${t&&t.status!=='draft'?`<button class="btn" data-tmpdf="${j.id}">PDF</button>`:''}${t&&isAdmin?`<button class="btn danger" data-tmdel="${j.id}" aria-label="Excluir T&M" title="Excluir T&M">🗑</button>`:''}</div></div>`}).join('')
    :'<p class="empty">Nenhuma obra neste dia.</p>';
  // T&M deste dia cuja obra não está mais na escala (apagada/mudada): aparece também, pra dar pra abrir/excluir
  const orf=Object.keys(TMS).filter(id=>TMS[id].date===cur&&!jobs.some(j=>tmId(cur,j.id)===id));
  if(orf.length)box.innerHTML+='<h4 class="phsub">T&amp;M sem obra na escala deste dia</h4>'+orf.map(id=>{const t=TMS[id];
    return `<div class="tmrow"><div><b>${esc(t.company||'Obra')}</b> <span class="tmb ${t.status}">${t.no?esc(t.no)+' · ':''}${tmStatusTxt[t.status]||''}</span><small>${esc(t.location||'')} · ${(t.rows||[]).length} pessoas · TMH ${hmTxt(t.tmh||tmTotal(t))} · <i>a obra não está mais na escala</i></small></div>
      <div class="tmrowbtn"><button class="btn" data-tmopen="${esc(t.jobId)}">Abrir</button>${t.status!=='draft'?`<button class="btn" data-tmpdf="${esc(t.jobId)}">PDF</button>`:''}${isAdmin?`<button class="btn danger" data-tmdel="${esc(t.jobId)}" aria-label="Excluir T&M" title="Excluir T&M">🗑</button>`:''}</div></div>`}).join('')}
$('view-tm').addEventListener('click',e=>{const o=e.target.closest('[data-tmopen]');if(o){tmOpen(o.dataset.tmopen);return}
  const dl=e.target.closest('[data-tmdel]');if(dl){tmDelOpen(tmId(cur,dl.dataset.tmdel));return}
  const p=e.target.closest('[data-tmpdf]');if(p){const t=TMS[tmId(cur,p.dataset.tmpdf)];if(t)tmPdf(t)}});
if($('tab-tm')){$('tab-tm').hidden=!(P.escala||FIN);$('tab-tm').onclick=()=>{tab('tm');renderTmTab()}}
if($('photosPanel'))$('photosPanel').addEventListener('click',e=>{const o=e.target.closest('[data-tmopen]');if(o){e.stopPropagation();tmOpen(o.dataset.tmopen)}});
/* ---- excluir T&M (só admin, pedindo a senha de novo; guarda cópia em tmdeleted) ---- */
let tmDelId=null;
function tmDelOpen(id){const t=tmFind(id);if(!t||!isAdmin)return;tmDelId=id;
  $('tmDelInfo').innerHTML=`<b>${esc(t.company||'Obra')}</b> · ${esc(t.date.split('-').reverse().join('/'))}${t.no?' · '+esc(t.no):''} · ${(t.rows||[]).length} pessoas · TMH ${hmTxt(t.tmh||tmTotal(t))}`;
  $('tmDelWhy').value='';$('tmDelPwd').value='';$('tmDelMsg').textContent='';$('tmDelGo').disabled=false;$('tmDelDlg').hidden=false;setTimeout(()=>$('tmDelWhy').focus(),50)}
function tmDelClose(){tmDelId=null;$('tmDelPwd').value='';$('tmDelDlg').hidden=true}
async function tmDelGo(){const id=tmDelId,t=tmFind(id);if(!t)return;const why=tidy($('tmDelWhy').value),pwd=$('tmDelPwd').value;
  if(!why){$('tmDelMsg').textContent='Escreva o motivo.';return}
  if(!pwd){$('tmDelMsg').textContent='Digite sua senha.';return}
  if(!(ctx&&ctx.reauth)){$('tmDelMsg').textContent='Não consegui conferir a senha neste aparelho.';return}
  $('tmDelGo').disabled=true;$('tmDelMsg').textContent='Conferindo a senha…';
  try{await ctx.reauth(pwd)}catch(e){$('tmDelGo').disabled=false;
    const c=(e&&e.code)||'';$('tmDelMsg').textContent=/wrong-password|invalid-credential|invalid-login/.test(c)?'Senha errada.':/too-many/.test(c)?'Muitas tentativas. Espere uns minutos.':'Não consegui conferir a senha ('+(c||'erro')+'). Precisa de internet.';return}
  const now=Date.now(),by=(ctx&&ctx.email)||'';
  try{await db.doc('tmdeleted/'+id+'_'+now).set({tmId:id,date:t.date,company:t.company||'',no:t.no||'',deletedBy:by,deletedAt:now,reason:why,data:t});
    await db.doc('tm/'+id).delete();
    tmDelClose();if(tmCur&&tmCur.id===id){tmCur=null;$('tmDlg').hidden=true;document.body.classList.remove('modal-open')}
    delete TMS[id];hrsData=hrsData.filter(x=>x._id!==id);renderTmTab();renderPhotos();if(!$('tmPaneHrs').hidden)hrsRender();toast('T&M excluída · registrado: '+by)}
  catch(e){console.error(e);$('tmDelGo').disabled=false;$('tmDelMsg').textContent='Não consegui excluir ('+(e.code||'erro')+'). As regras novas do Firebase foram publicadas?'}}
$('tmDelClose').onclick=tmDelClose;$('tmDelGo').onclick=tmDelGo;$('tmDelDlg').addEventListener('click',e=>{if(e.target.id==='tmDelDlg')tmDelClose()});
$('tmDelPwd').addEventListener('keydown',e=>{if(e.key==='Enter')tmDelGo()});
async function tmGoneOpen(){$('tmGoneDlg').hidden=false;document.body.classList.add('modal-open');$('tmGoneList').innerHTML='<p class="empty">Carregando…</p>';
  try{const q=await db.collection('tmdeleted').orderBy('deletedAt','desc').limit(100).get();
    $('tmGoneList').innerHTML=q.docs.length?q.docs.map(d=>{const x=d.data();return `<div class="tmrow"><div><b>${esc(x.company||'Obra')}</b> <span class="tmb">${esc(x.no||'sem número')}</span>
      <small>Folha de ${esc((x.date||'').split('-').reverse().join('/'))} · excluída ${esc(new Date(x.deletedAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}))} por <b>${esc(x.deletedBy)}</b><br>Motivo: ${esc(x.reason||'—')}</small></div>
      <div class="tmrowbtn"><button class="btn" data-gonepdf="${esc(d.id)}">PDF</button></div></div>`}).join(''):'<p class="empty">Nenhuma T&M excluída.</p>';
    $('tmGoneList').onclick=e=>{const b=e.target.closest('[data-gonepdf]');if(!b)return;const d=q.docs.find(x=>x.id===b.dataset.gonepdf);if(d&&d.data().data)tmPdf(d.data().data)}}
  catch(e){console.error(e);$('tmGoneList').innerHTML='<p class="empty">Não consegui carregar ('+esc(e.code||'erro')+').</p>'}}
function tmGoneClose(){$('tmGoneDlg').hidden=true;if($('tmDlg').hidden)document.body.classList.remove('modal-open')}
$('tmGoneClose').onclick=tmGoneClose;$('tmGoneDlg').addEventListener('click',e=>{if(e.target.id==='tmGoneDlg')tmGoneClose()});
if($('tmGoneBtn')){$('tmGoneBtn').hidden=!(isAdmin||FIN);$('tmGoneBtn').onclick=tmGoneOpen}
/* ---- ⏱ Horas por funcionário (financeiro): junta as T&M do período ---- */
let hrsData=[],hrsOpen={},hrsBusy=0;
const hKey=s=>tidy(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const dAdd=(ds,n)=>{const[y,m,d]=ds.split('-').map(Number);const x=new Date(y,m-1,d+n);return iso(x)};
const monOf=ds=>{const[y,m,d]=ds.split('-').map(Number);const x=new Date(y,m-1,d);return dAdd(ds,-((x.getDay()+6)%7))};
const WDS=['dom','seg','ter','qua','qui','sex','sáb'];
const wdOf=ds=>{const[y,m,d]=ds.split('-').map(Number);return WDS[new Date(y,m-1,d).getDay()]};
const dmy=ds=>ds.slice(8,10)+'/'+ds.slice(5,7);
function hrsSetWeek(mon){$('hrsFrom').value=mon;$('hrsTo').value=dAdd(mon,6);hrsLoad()}
function tmSub(which){const hrs=which==='hrs'&&FIN;$('tmPaneDay').hidden=hrs;$('tmPaneHrs').hidden=!hrs;
  $('tmSubDay').setAttribute('aria-selected',!hrs);$('tmSubHrs').setAttribute('aria-selected',hrs);
  if(hrs){if(!$('hrsFrom').value)hrsSetWeek(monOf(iso(new Date())));else hrsLoad()}else renderTmTab()}
async function hrsLoad(){let a=$('hrsFrom').value,b=$('hrsTo').value;if(!a||!b)return;if(a>b){[a,b]=[b,a];$('hrsFrom').value=a;$('hrsTo').value=b}
  const my=++hrsBusy;$('hrsInfo').textContent='Carregando…';
  try{const q=await db.collection('tm').where('date','>=',a).where('date','<=',b).get();if(my!==hrsBusy)return;
    hrsData=q.docs.map(d=>Object.assign({_id:d.id},d.data()));hrsRender()}
  catch(e){console.error(e);$('hrsInfo').textContent='Não consegui carregar ('+(e.code||'erro')+').'}}
function hrsRows(){const a=$('hrsFrom').value,b=$('hrsTo').value,drafts=$('hrsDrafts').checked;const out=[];
  hrsData.forEach(t=>{if(t.date<a||t.date>b)return;if(t.status==='draft'&&!drafts)return;
    (t.rows||[]).forEach(r=>{if(!tidy(r.name))return;out.push({tmid:t._id,date:t.date,name:fmtName(r.name),key:hKey(r.name),company:t.company||'',location:t.location||'',jobNo:t.jobNo||'',no:t.no||'',
      status:t.status,invoice:t.invoice||'',in:r.in||'',out:r.out||'',min:rowMinutes(r)})})});
  return out.sort((x,y)=>x.date<y.date?-1:x.date>y.date?1:x.name.localeCompare(y.name,'pt'))}
function hrsGroup(rows){const g={};rows.forEach(r=>{const w=g[r.key]||(g[r.key]={name:r.name,key:r.key,days:{},min:0,sheets:new Set(),rows:[]});
  w.days[r.date]=(w.days[r.date]||0)+r.min;w.min+=r.min;w.sheets.add(r.date+r.company);w.rows.push(r)});
  return Object.values(g).sort((x,y)=>x.name.localeCompare(y.name,'pt'))}
function hrsDays(){const a=$('hrsFrom').value,b=$('hrsTo').value,o=[];let d=a;while(d<=b&&o.length<62){o.push(d);d=dAdd(d,1)}return o}
function hrsRender(){const rows=hrsRows(),qq=hKey($('hrsQ').value||''),all=hrsGroup(rows),ws=all.filter(w=>!qq||w.key.includes(qq));
  const days=hrsDays(),showDays=days.length<=7,drafts=hrsData.filter(t=>t.status==='draft').length,sheets=hrsData.filter(t=>t.status!=='draft'||$('hrsDrafts').checked).length;
  const tot=ws.reduce((s,w)=>s+w.min,0);
  // valores: só com os valores abertos (senha)
  const pay=!!PAY;let payTot=0,miss=[];
  if(pay)ws.forEach(w=>{let v=0,rs=new Set(),m=false;w.rows.forEach(r=>{const rt=rateOn(w.key,r.date);if(rt==null){m=true;return}rs.add(rt);v+=r.min/60*rt});
    w.pay=Math.round(v*100)/100;w.rates=[...rs];w.miss=m;if(m)miss.push(w.name);payTot+=w.pay});
  payTot=Math.round(payTot*100)/100;
  $('hrsPayLine').innerHTML=!FIN?'':pay?`💲 <b>Total a pagar: ${money(payTot)}</b>${miss.length?' · <span class="hrswarn">⚠️ sem valor cadastrado: '+esc(miss.join(', '))+' (fora do total)</span>':''} · <button class="linkbtn" id="hrsPayLock">🔒 Esconder valores</button>`
    :`<span class="payunlock inl">🔒 Pra ver os valores em $: <input type="password" id="hrsPwd" placeholder="Sua senha" autocomplete="current-password" aria-label="Sua senha"><button class="btn" id="hrsPayOpen">Mostrar valores</button><span id="hrsPayMsg" class="hrswarn"></span></span>`;
  $('hrsInfo').innerHTML=`${sheets} folha${sheets===1?'':'s'} · ${ws.length} funcionário${ws.length===1?'':'s'} · <b>total ${hmTxt(tot)}</b> (${hDec(tot)} h)`+
    (drafts&&!$('hrsDrafts').checked?` · <span class="hrswarn">⚠️ ${drafts} rascunho${drafts>1?'s':''} ainda não enviado${drafts>1?'s':''} (fora da conta)</span>`:'');
  if(!ws.length){$('hrsTable').innerHTML='<tbody><tr><td class="empty">Nenhuma hora neste período.</td></tr></tbody>';return}
  const head=`<thead><tr><th>Funcionário</th>${showDays?days.map(d=>`<th class="hd">${wdOf(d)}<br><small>${dmy(d)}</small></th>`).join(''):'<th class="hd">Dias</th>'}<th class="hd">Total</th><th class="hd">Decimal</th>${pay?'<th class="hd">Valor/h</th><th class="hd">A pagar</th>':''}</tr></thead>`;
  const body=ws.map(w=>{const open=hrsOpen[w.key];
    const main=`<tr class="hrsw${open?' open':''}" data-hk="${esc(w.key)}"><td><button class="linkbtn hrsname" aria-expanded="${!!open}">${open?'▾':'▸'} ${esc(w.name)}</button></td>${showDays?days.map(d=>`<td class="hd">${w.days[d]?hmTxt(w.days[d]):'<span class="hrs0">—</span>'}</td>`).join(''):`<td class="hd">${Object.keys(w.days).length}</td>`}<td class="hd"><b>${hmTxt(w.min)}</b></td><td class="hd">${hDec(w.min)}</td>${pay?`<td class="hd">${w.rates.length?w.rates.map(money).join(' / '):''}${w.miss?' <span class="paymiss">sem valor</span>':''}</td><td class="hd"><b>${w.rates.length?money(w.pay):'—'}</b></td>`:''}</tr>`;
    const det=open?`<tr class="hrsdet"><td colspan="${(showDays?days.length:1)+3+(pay?2:0)}">${w.rows.map(r=>`<div class="hrsline"><span>${wdOf(r.date)} ${dmy(r.date)}</span><span><b>${esc(r.company)}</b>${r.location?' · '+esc(r.location):''}</span><span>${esc(fmt(r.in))}–${esc(fmt(r.out))}</span><span><b>${hmTxt(r.min)}</b>${pay&&rateOn(w.key,r.date)!=null?' · '+money(r.min/60*rateOn(w.key,r.date)):''}</span><span class="tmb ${r.status}">${r.no?esc(r.no):tmStatusTxt[r.status]||''}</span><button class="linkbtn" data-hrsopen="${esc(r.tmid)}">Abrir folha</button></div>`).join('')}</td></tr>`:'';
    return main+det}).join('');
  const foot=`<tfoot><tr><td><b>Total</b></td>${showDays?days.map(d=>{const m=ws.reduce((s,w)=>s+(w.days[d]||0),0);return `<td class="hd">${m?hmTxt(m):''}</td>`}).join(''):'<td></td>'}<td class="hd"><b>${hmTxt(tot)}</b></td><td class="hd">${hDec(tot)}</td>${pay?`<td></td><td class="hd"><b>${money(payTot)}</b></td>`:''}</tr></tfoot>`;
  $('hrsTable').innerHTML=head+'<tbody>'+body+'</tbody>'+foot}
async function hrsXls(){const rows=hrsRows(),qq=hKey($('hrsQ').value||'');const ws=hrsGroup(rows).filter(w=>!qq||w.key.includes(qq));
  if(!ws.length){toast('Nenhuma hora pra baixar neste período');return}
  const days=hrsDays(),a=$('hrsFrom').value,b=$('hrsTo').value;
  const r2=m=>Math.round(m/60*100)/100;
  const res=[['Horas por funcionário · '+dmy(a)+'/'+a.slice(0,4)+' a '+dmy(b)+'/'+b.slice(0,4)+' (30 min de almoço já descontados)'],[],
    ['Funcionário',...days.map(d=>wdOf(d)+' '+dmy(d)),'Total (horas)','Total (h:mm)','Dias trabalhados']];
  const pay=!!PAY;if(pay){res[2].push('Valor/h (US$)','A pagar (US$)');ws.forEach(w=>{let v=0,rs=new Set();w.rows.forEach(r=>{const rt=rateOn(w.key,r.date);if(rt!=null){rs.add(rt);v+=r.min/60*rt}});w.pay=Math.round(v*100)/100;w.rates=[...rs]})}
  ws.forEach(w=>res.push([w.name,...days.map(d=>w.days[d]?r2(w.days[d]):''),r2(w.min),hmTxt(w.min),Object.keys(w.days).length,...(pay?[w.rates.length===1?w.rates[0]:w.rates.length?w.rates.join(' / '):'sem valor',w.pay]:[])]));
  const tot=ws.reduce((s,w)=>s+w.min,0);res.push(['TOTAL',...days.map(d=>{const m=ws.reduce((s,w)=>s+(w.days[d]||0),0);return m?r2(m):''}),r2(tot),hmTxt(tot),'',...(pay?['',Math.round(ws.reduce((s,w)=>s+w.pay,0)*100)/100]:[])]);
  const det=[['Data','Dia','Funcionário','Companhia (Bill To)','Local','Job #','T&M nº','Entrada','Saída','Almoço (min)','Horas','Horas (h:mm)','Status','Invoice #',...(pay?['Valor/h (US$)','Valor (US$)']:[])]];
  ws.forEach(w=>w.rows.forEach(r=>det.push([r.date.split('-').reverse().join('/'),wdOf(r.date),r.name,r.company,r.location,r.jobNo,r.no,fmt(r.in),fmt(r.out),30,r2(r.min),hmTxt(r.min),tmStatusTxt[r.status]||r.status,r.invoice,...(pay?(()=>{const rt=rateOn(w.key,r.date);return rt==null?['sem valor','']:[rt,Math.round(r.min/60*rt*100)/100]})():[])])));
  const blob=makeXlsx([{name:'Resumo',rows:res,bold:[0,2,res.length-1],cols:[26,...days.map(()=>10),13,12,15,14,14]},
    {name:'Detalhe',rows:det,bold:[0],cols:[11,5,24,26,30,9,9,9,9,12,8,12,10,12,13,12]}]);
  const u=URL.createObjectURL(blob),el=document.createElement('a');el.href=u;el.download='horas_'+a+'_a_'+b+'.xlsx';document.body.appendChild(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);
  toast('✓ Excel baixado')}
/* gerador de .xlsx próprio (sem biblioteca de fora): zip sem compressão + XML da planilha */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u){let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=CRC[(c^u[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function zipStore(files){const enc=new TextEncoder(),parts=[],cen=[];let off=0;
  files.forEach(([name,txt])=>{const nb=enc.encode(name),db=enc.encode(txt),crc=crc32(db);
    const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);h.setUint32(14,crc,true);h.setUint32(18,db.length,true);h.setUint32(22,db.length,true);h.setUint16(26,nb.length,true);
    parts.push(h.buffer,nb,db);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint32(16,crc,true);c.setUint32(20,db.length,true);c.setUint32(24,db.length,true);c.setUint16(28,nb.length,true);c.setUint32(42,off,true);
    cen.push(c.buffer,nb);off+=30+nb.length+db.length});
  const cs=cen.reduce((s,x)=>s+(x.byteLength||x.length),0),e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cs,true);e.setUint32(16,off,true);
  return new Blob([...parts,...cen,e.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}
function makeXlsx(sheets){const x=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
  const col=i=>{let s='';i++;while(i){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s};
  const sheetXml=sh=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
    (sh.cols?`<cols>${sh.cols.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`:'')+
    `<sheetData>${sh.rows.map((r,ri)=>`<row r="${ri+1}">${r.map((v,ci)=>{if(v===''||v==null)return '';const ref=col(ci)+(ri+1),st=(sh.bold||[]).includes(ri)?' s="1"':'';
      return typeof v==='number'&&isFinite(v)?`<c r="${ref}"${st}><v>${v}</v></c>`:`<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`}).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files=[['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${x(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(s)])];
  return zipStore(files)}
if($('tmSubs')){$('tmSubs').hidden=!FIN;$('tmSubDay').onclick=()=>tmSub('day');$('tmSubHrs').onclick=()=>tmSub('hrs');
  $('hrsPrev').onclick=()=>hrsSetWeek(dAdd(monOf($('hrsFrom').value||iso(new Date())),-7));
  $('hrsNext').onclick=()=>hrsSetWeek(dAdd(monOf($('hrsFrom').value||iso(new Date())),7));
  $('hrsThis').onclick=()=>hrsSetWeek(monOf(iso(new Date())));
  $('hrsFrom').onchange=$('hrsTo').onchange=hrsLoad;$('hrsDrafts').onchange=hrsRender;$('hrsQ').oninput=hrsRender;$('hrsXls').onclick=hrsXls;
  $('hrsPayLine').addEventListener('click',e=>{if(e.target.id==='hrsPayOpen')payUnlock($('hrsPwd').value,$('hrsPayMsg'));if(e.target.id==='hrsPayLock')payLockNow()});
  $('hrsPayLine').addEventListener('keydown',e=>{if(e.target.id==='hrsPwd'&&e.key==='Enter')payUnlock($('hrsPwd').value,$('hrsPayMsg'))});
  $('hrsTable').addEventListener('click',e=>{const ho=e.target.closest('[data-hrsopen]');if(ho){const t=tmFind(ho.dataset.hrsopen);if(t)tmOpen(t.jobId,t.date);return}const tr=e.target.closest('tr[data-hk]');if(!tr)return;hrsOpen[tr.dataset.hk]=!hrsOpen[tr.dataset.hk];hrsRender()})}
/* ---- 💲 Valores por hora (Cadastro, trancado com a senha do login; só admin/Financeiro) ----
   pay/rates: {rates:{chave:[{from:'AAAA-MM-DD',rate,by,at}]}, names:{chave:'Nome'}} · paylog/{auto}: quem abriu/mudou */
let PAY=null,payUntil=0,payT=null,payEdit=null;
const money=v=>'$'+(Math.round(v*100)/100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
function rateOn(key,ds){const L=(PAY&&PAY.rates&&PAY.rates[key])||[];let r=null;L.slice().sort((a,b)=>a.from<b.from?-1:1).forEach(e=>{if(e.from<=ds)r=e.rate});return r}
function payNextOf(key,ds){const L=((PAY&&PAY.rates&&PAY.rates[key])||[]).filter(e=>e.from>ds).sort((a,b)=>a.from<b.from?-1:1);return L[0]||null}
function paySince(key,ds){const L=((PAY&&PAY.rates&&PAY.rates[key])||[]).filter(e=>e.from<=ds).sort((a,b)=>a.from<b.from?-1:1);return L.length?L[L.length-1]:null}
function payLog(what,extra){try{db.doc('paylog/'+Date.now()+'_'+Math.random().toString(36).slice(2,7)).set(Object.assign({by:(ctx&&ctx.email)||'',at:Date.now(),what},extra||{})).catch(()=>{})}catch(e){}}
async function payUnlock(pwd,msgEl){if(!FIN)return false;if(!pwd){msgEl.textContent='Digite sua senha.';return false}
  if(!(ctx&&ctx.reauth)){msgEl.textContent='Não consegui conferir a senha neste aparelho.';return false}
  msgEl.textContent='Conferindo…';
  try{await ctx.reauth(pwd)}catch(e){const c=(e&&e.code)||'';msgEl.textContent=/wrong-password|invalid-credential|invalid-login/.test(c)?'Senha errada.':/too-many/.test(c)?'Muitas tentativas. Espere uns minutos.':'Não consegui conferir a senha ('+(c||'erro')+'). Precisa de internet.';return false}
  try{const d=await db.doc('pay/rates').get();PAY=(d.exists&&d.data())||{rates:{},names:{}};PAY.rates=PAY.rates||{};PAY.names=PAY.names||{}}
  catch(e){console.error(e);msgEl.textContent='Não consegui abrir os valores ('+(e.code||'erro')+'). As regras novas do Firebase foram publicadas?';return false}
  msgEl.textContent='';payUntil=Date.now()+10*60000;clearTimeout(payT);payT=setTimeout(payLockNow,10*60000);payLog('abriu os valores');
  payRender();if(!$('tmPaneHrs').hidden)hrsRender();return true}
function payLockNow(){PAY=null;payUntil=0;clearTimeout(payT);$('payPwd').value='';if($('hrsPwd'))$('hrsPwd').value='';payDlgClose();payRender();if($('tmPaneHrs')&&!$('tmPaneHrs').hidden)hrsRender()}
function payRender(){const pn=$('payPanel');if(!pn)return;pn.hidden=!FIN;if(!FIN)return;const open=!!PAY;$('payLocked').hidden=open;$('payBody').hidden=!open;if(!open)return;
  $('payUntil').textContent=new Date(payUntil).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  const today=iso(new Date()),q=hKey($('payQ').value||'');
  const keys=new Map();S.workers.forEach(w=>keys.set(hKey(w),fmtName(w)));Object.keys(PAY.rates).forEach(k=>{if(!keys.has(k))keys.set(k,(PAY.names&&PAY.names[k])||k)});
  const list=[...keys.entries()].filter(([k,n])=>!q||k.includes(q)).sort((a,b)=>a[1].localeCompare(b[1],'pt'));
  $('payList').innerHTML=list.length?list.map(([k,n])=>{const cur=paySince(k,today),nx=payNextOf(k,today);
    return `<div class="payrow"><div><b>${esc(n)}</b><small>${cur?money(cur.rate)+'/h <span class="paysince">desde '+esc(cur.from.split('-').reverse().join('/'))+'</span>':'<span class="paymiss">sem valor</span>'}${nx?' · <span class="paynext">'+money(nx.rate)+'/h a partir de '+esc(nx.from.split('-').reverse().join('/'))+'</span>':''}</small></div>
      <button class="btn" data-payk="${esc(k)}" data-payn="${esc(n)}">${cur||nx?'Alterar':'Colocar valor'}</button></div>`}).join(''):'<p class="empty">Nenhum funcionário.</p>'}
function payDlgOpen(k,n){if(!PAY)return;payEdit={k,n};const today=iso(new Date());$('payDlgName').textContent=n;
  const cur=paySince(k,today);$('payRate').value='';$('payFrom').value=cur?dAdd(monOf(today),7):monOf(today);
  $('payDlgHint').textContent=cur?'Valor atual: '+money(cur.rate)+'/h. O novo entra na próxima segunda ('+dmy($('payFrom').value)+'), a não ser que você mude a data.':'Primeiro valor: já vale desde a segunda desta semana ('+dmy($('payFrom').value)+'). Mude a data se precisar.';
  const L=((PAY.rates[k])||[]).slice().sort((a,b)=>a.from<b.from?1:-1);
  $('payHist').innerHTML=L.length?'<h4 class="phsub">Histórico</h4>'+L.map(e=>`<div class="payh"><span>${esc(e.from.split('-').reverse().join('/'))}</span><b>${money(e.rate)}/h</b><small>${esc(e.by||'')} · ${e.at?esc(new Date(e.at).toLocaleDateString('pt-BR')):''}</small><button class="linkbtn paydel" data-paydel="${esc(e.from)}" aria-label="Apagar este valor">🗑 Apagar</button></div>`).join('')+'<p class="hint">Apagando todos, o funcionário volta a ficar sem valor.</p>':'';
  $('payDlg').hidden=false;setTimeout(()=>$('payRate').focus(),50)}
function payDlgClose(){payEdit=null;$('payDlg').hidden=true}
async function payDel(from){if(!payEdit||!PAY)return;const k=payEdit.k,n=payEdit.n;const e=((PAY.rates[k])||[]).find(x=>x.from===from);if(!e)return;
  if(Date.now()>payUntil){toast('Tempo esgotado: abra os valores de novo');payLockNow();return}
  if(!confirm(`Apagar o valor de ${n}: ${money(e.rate)}/h a partir de ${from.split('-').reverse().join('/')}?`))return;
  try{const res=await db.doc('pay/rates').tx(d=>{const o=d||{rates:{},names:{}};o.rates=o.rates||{};const L=(o.rates[k]||[]).filter(x=>x.from!==from);if(L.length)o.rates[k]=L;else delete o.rates[k];return o});
    PAY=res;PAY.rates=PAY.rates||{};payLog('apagou valor',{name:n,rate:e.rate,from});payDlgOpen(k,n);payRender();if(!$('tmPaneHrs').hidden)hrsRender();toast('Valor apagado')}
  catch(err){console.error(err);toast('Não consegui apagar ('+(err.code||'erro')+')')}}
async function paySave(){if(!payEdit||!PAY)return;const rate=Math.round(parseFloat(String($('payRate').value).replace(',','.'))*100)/100,from=$('payFrom').value;
  if(!(rate>0)||rate>1000){toast('Coloque um valor válido (ex.: 25.00)');return}if(!/^\d{4}-\d\d-\d\d$/.test(from)){toast('Escolha a data');return}
  if(Date.now()>payUntil){toast('Tempo esgotado: abra os valores de novo');payLockNow();return}
  const k=payEdit.k,n=payEdit.n,by=(ctx&&ctx.email)||'',at=Date.now();
  if(!confirm(`${n}: ${money(rate)}/h a partir de ${from.split('-').reverse().join('/')}?`))return;
  try{const res=await db.doc('pay/rates').tx(d=>{const o=d||{rates:{},names:{}};o.rates=o.rates||{};o.names=o.names||{};
      const L=(o.rates[k]||[]).filter(e=>e.from!==from);L.push({from,rate,by,at});o.rates[k]=L.sort((a,b)=>a.from<b.from?-1:1);o.names[k]=n;return o});
    PAY=res;payLog('mudou valor',{name:n,rate,from});payDlgClose();payRender();if(!$('tmPaneHrs').hidden)hrsRender();toast('✓ Valor salvo')}
  catch(e){console.error(e);toast('Não consegui salvar ('+(e.code||'erro')+')')}}
if($('payPanel')){payRender();$('payOpen').onclick=()=>payUnlock($('payPwd').value,$('payMsg'));$('payPwd').addEventListener('keydown',e=>{if(e.key==='Enter')$('payOpen').click()});
  $('payLock').onclick=payLockNow;$('payQ').oninput=payRender;$('payList').addEventListener('click',e=>{const b=e.target.closest('[data-payk]');if(b)payDlgOpen(b.dataset.payk,b.dataset.payn)});
  $('payDlgClose').onclick=payDlgClose;$('payHist').addEventListener('click',e=>{const b=e.target.closest('[data-paydel]');if(b)payDel(b.dataset.paydel)});$('paySave').onclick=paySave;$('payDlg').addEventListener('click',e=>{if(e.target.id==='payDlg')payDlgClose()})}
if(viewer)tab('day');
$('date').value=cur;showWeekday();
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
