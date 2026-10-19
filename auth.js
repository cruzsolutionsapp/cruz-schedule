/* ===== Firebase + login + controle de acesso ===== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence,
  reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, getDoc, getDocs,
  setDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, writeBatch, serverTimestamp, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyA-57toRP8Fwq3SyYcliJhYywu9CcnGCM4",
  authDomain: "cruz-schedule.firebaseapp.com",
  projectId: "cruz-schedule",
  storageBucket: "cruz-schedule.firebasestorage.app",
  messagingSenderId: "401249679832",
  appId: "1:401249679832:web:ec40d1d80537d7344d5aad"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
setPersistence(auth, browserLocalPersistence).catch(()=>{});
let fs;
try { fs = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { fs = initializeFirestore(fbApp, {}); }

/* adaptador com a mesma forma usada pelo app */
const wrap = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: s.metadata });
const qb = (ref, cons = []) => ({
  where: (f, op, v) => qb(ref, [...cons, where(f, op, v)]),
  orderBy: (f, d) => qb(ref, [...cons, orderBy(f, d)]),
  limit: n => qb(ref, [...cons, limit(n)]),
  get: async () => { const s = await getDocs(query(ref, ...cons)); return { docs: s.docs.map(wrap), size: s.size }; },
  onSnapshot: (n, e) => onSnapshot(query(ref, ...cons), s => n({ docs: s.docs.map(wrap), size: s.size }), e)
});
const dbw = {
  doc: p => { const r = doc(fs, p); return {
    set: d => setDoc(r, d),
    get: async () => wrap(await getDoc(r)),
    delete: () => deleteDoc(r),
    // lê a versão do servidor e grava o resultado de fn(atual) numa transação (ninguém grava no meio)
    tx: fn => runTransaction(fs, async t => { const s = await t.get(r); const nd = fn(s.exists() ? s.data() : null); if (nd) t.set(r, nd); return nd; }),
    onSnapshot: (n, e) => onSnapshot(r, s => n(wrap(s)), e)
  }; },
  collection: p => qb(collection(fs, p))
};

const $ = id => document.getElementById(id);
const show = id => { $('boot').hidden = true; ['auth', 'gate', 'app'].forEach(x => $(x).hidden = x !== id); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const msg = (t, bad) => { const el = $('authMsg'); el.textContent = t || ''; el.className = 'authmsg' + (bad ? ' bad' : ''); };
const errPT = e => ({
  'auth/invalid-credential': 'E-mail ou senha incorretos.', 'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Não existe conta com esse e-mail. Use "Primeiro acesso".', 'auth/email-already-in-use': 'Esse e-mail já tem conta. Use "Entrar" ou "Esqueci a senha".',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.', 'auth/invalid-email': 'E-mail inválido.',
  'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos.', 'auth/network-request-failed': 'Sem internet. Conecte e tente de novo.'
}[e && e.code] || 'Algo deu errado (' + (e && e.code || 'erro') + ').');

/* ----- tela de login ----- */
let mode = 'login';
function setMode(m) {
  mode = m; msg('');
  $('pw2Row').hidden = m !== 'signup'; $('pwRow').hidden = m === 'reset';
  $('authGo').textContent = { login: 'Entrar', signup: 'Criar minha senha', reset: 'Enviar link pra trocar a senha' }[m];
  $('authTitle').textContent = { login: 'Entrar', signup: 'Primeiro acesso', reset: 'Esqueci a senha' }[m];
  $('toSignup').hidden = m === 'signup'; $('toReset').hidden = m === 'reset'; $('toLogin').hidden = m === 'login';
  $('pw').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
}
$('toSignup').onclick = () => setMode('signup');
$('toReset').onclick = () => setMode('reset');
$('toLogin').onclick = () => setMode('login');
setMode('login');
$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim().toLowerCase(), pw = $('pw').value;
  const btn = $('authGo'); btn.disabled = true;
  try {
    if (mode === 'login') await signInWithEmailAndPassword(auth, email, pw);
    else if (mode === 'signup') {
      if (pw !== $('pw2').value) { msg('As senhas não são iguais.', true); return; }
      const c = await createUserWithEmailAndPassword(auth, email, pw);
      await sendEmailVerification(c.user).catch(() => {});
    } else { await sendPasswordResetEmail(auth, email); msg('Pronto! Veja seu e-mail (e o spam) pra criar uma senha nova.'); setTimeout(() => setMode('login'), 100); }
  } catch (err) { msg(errPT(err), true); }
  finally { btn.disabled = false; }
});

/* ----- portão: e-mail confirmado + liberado ----- */
function gate(html) { $('gateBody').innerHTML = html; show('gate'); }
$('gate').addEventListener('click', async e => {
  const a = e.target.dataset.g; if (!a) return;
  const u = auth.currentUser;
  if (a === 'out') return signOut(auth);
  if (a === 'resend') { await sendEmailVerification(u).catch(() => {}); e.target.textContent = 'Enviado ✓'; return; }
  if (a === 'recheck') { await u.reload(); await u.getIdToken(true); return route(auth.currentUser); }
  if (a === 'reqname') {
    const name = ($('reqName').value || '').trim().slice(0, 60);
    try { await setDoc(doc(fs, 'requests', u.email.toLowerCase()), { email: u.email.toLowerCase(), name, at: serverTimestamp() }, { merge: true }); e.target.textContent = 'Nome salvo ✓'; }
    catch (err) { e.target.textContent = 'Não salvou'; }
    return;
  }
  if (a === 'owner') {
    e.target.disabled = true; e.target.textContent = 'Configurando…';
    try {
      const me = u.email.toLowerCase(), b = writeBatch(fs);
      b.set(doc(fs, 'meta', 'owner'), { email: me, at: serverTimestamp() });
      b.set(doc(fs, 'members', me), { email: me, role: 'admin', at: serverTimestamp() });
      await b.commit(); route(u);
    } catch (err) { gate(`<p class="authmsg bad">Não deu certo (${esc(err.code || err.message)}). Confira se as regras de segurança foram colocadas no Firebase.</p><button class="btn" data-g="out">Sair</button>`); }
  }
});

let started = null;
async function route(u) {
  if (!u) { if (started) location.reload(); show('auth'); return; }
  if (!u.emailVerified) {
    return gate(`<h2>Confirme seu e-mail</h2><p>Mandamos um link de confirmação pra <b>${esc(u.email)}</b>. Abra o e-mail (veja também o spam), toque no link e depois volte aqui.</p>
      <div class="gbtns"><button class="btn primary" data-g="recheck">Já confirmei</button><button class="btn" data-g="resend">Reenviar e-mail</button><button class="linkbtn" data-g="out">Sair</button></div>`);
  }
  const me = u.email.toLowerCase();
  let m;
  try { m = await getDoc(doc(fs, 'members', me)); }
  catch (err) { return gate(`<h2>Sem acesso</h2><p class="authmsg bad">Não consegui verificar seu acesso (${esc(err.code || 'erro')}). Se for a primeira vez, confira se as regras de segurança foram coladas no Firebase.</p><div class="gbtns"><button class="btn" data-g="recheck">Tentar de novo</button><button class="linkbtn" data-g="out">Sair</button></div>`); }
  if (!m.exists()) {
    let o = null; try { o = await getDoc(doc(fs, 'meta', 'owner')); } catch (e) {}
    if (o && !o.exists()) {
      return gate(`<h2>Primeiro acesso do app</h2><p>Ninguém configurou o app ainda. Você (<b>${esc(me)}</b>) vai ser o <b>administrador</b>: é quem libera o acesso dos outros.</p>
        <div class="gbtns"><button class="btn primary" data-g="owner">Sou o administrador</button><button class="linkbtn" data-g="out">Sair</button></div>`);
    }
    let req = null; try { req = await getDoc(doc(fs, 'requests', me)); } catch (e) {}
    const name = req && req.exists() ? (req.data().name || '') : '';
    if (!(req && req.exists())) { try { await setDoc(doc(fs, 'requests', me), { email: me, at: serverTimestamp() }, { merge: true }); } catch (e) { console.error(e); } }
    return gate(`<h2>Pedido de acesso enviado</h2>
      <p>Sua conta (<b>${esc(me)}</b>) foi criada e o <b>administrador já recebeu seu pedido</b> no app. Assim que ele aprovar, toque em <b>"Tentar de novo"</b>.</p>
      <label class="f">Seu nome (pra ele saber quem é)<input id="reqName" value="${esc(name)}" maxlength="60" placeholder="Ex.: Pierre Silva"></label>
      <div class="gbtns"><button class="btn" data-g="reqname">Salvar nome</button><button class="btn primary" data-g="recheck">Tentar de novo</button><button class="linkbtn" data-g="out">Sair</button></div>`);
  }
  const md = m.data(), isAdmin = md.role === 'admin';
  const perms = {}; PERMS.forEach(([k]) => perms[k] = isAdmin ? k !== 'totem' : (md.perms && k in md.perms ? !!md.perms[k] : !OFF_DEFAULT.includes(k)));
  const totemOnly = !isAdmin && !!perms.totem;
  if (started) return;
  show('app');
  $('who').textContent = me + (isAdmin ? ' · admin' : '');
  $('tab-access').hidden = !isAdmin;
  $('logout').onclick = () => { try { started && started.flushAll(); } catch (e) {} signOut(auth); };
  $('logout2').onclick = () => { if (confirm('Sair do app (deslogar) neste aparelho?\n\nPra entrar de novo vai precisar do e-mail e da senha.')) $('logout').onclick(); };
  // confere a senha de novo (pra excluir T&M etc.): só passa se a senha for a deste login
  const reauth = pwd => reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, pwd)).then(() => auth.currentUser.getIdToken(true)).then(() => true);
  started = window.startApp(dbw, { email: me, isAdmin, perms, worker: md.worker || '', totem: totemOnly, reauth });
  setupMembers(isAdmin, me);
}
/* ----- link de demonstração (#demo): dados inventados na memória, sem login, nada é salvo ----- */
const DEMO = location.hash === '#demo' || location.hash.startsWith('#demo-central');
if (DEMO) startDemo(); else onAuthStateChanged(auth, route);

function memDb(seed) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const subs = new Set();
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const snapDoc = p => ({ id: p.split('/').pop(), exists: store.has(p), data: () => clone(store.get(p)), metadata: { hasPendingWrites: false, fromCache: false } });
  const notify = () => subs.forEach(f => setTimeout(f, 0));
  const num = x => x instanceof Date ? x.getTime() : (typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) ? Date.parse(x) : x);
  const cmp = (a, op, b) => { a = num(a); b = num(b); return op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : true; };
  const coll = (p, f = [], o = null, l = 0) => {
    const run = () => {
      const depth = p.split('/').length + 1;
      let docs = [...store.keys()].filter(k => k.startsWith(p + '/') && k.split('/').length === depth).map(snapDoc);
      docs = docs.filter(d => f.every(([k, op, v]) => cmp((d.data() || {})[k], op, v)));
      if (o) docs.sort((a, b) => { const x = num(a.data()[o[0]]), y = num(b.data()[o[0]]); return (x < y ? -1 : x > y ? 1 : 0) * (o[1] === 'desc' ? -1 : 1); });
      if (l) docs = docs.slice(0, l);
      return { docs, size: docs.length };
    };
    return { where: (k, op, v) => coll(p, [...f, [k, op, v]], o, l), orderBy: (k, d = 'asc') => coll(p, f, [k, d], l), limit: n => coll(p, f, o, n),
      get: () => Promise.resolve(run()),
      onSnapshot: n => { const fire = () => n(run()); subs.add(fire); setTimeout(fire, 0); return () => subs.delete(fire); } };
  };
  return {
    doc: p => ({ set: d => { store.set(p, clone(d)); notify(); return Promise.resolve(); }, get: () => Promise.resolve(snapDoc(p)),
      delete: () => { store.delete(p); notify(); return Promise.resolve(); },
      tx: fn => { const nd = fn(clone(store.get(p)) || null); if (nd) { store.set(p, clone(nd)); notify(); } return Promise.resolve(nd); },
      onSnapshot: n => { const fire = () => n(snapDoc(p)); subs.add(fire); setTimeout(fire, 0); return () => subs.delete(fire); } }),
    collection: p => coll(p)
  };
}
function demoSeed() {
  const pad = n => String(n).padStart(2, '0'), iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = iso(new Date()), y = new Date(); y.setDate(y.getDate() - 1); const yest = iso(y);
  const A = 'Calca👖|Bota 🥾';
  const job = (id, company, address, shop, start, travel, crew, extra) => Object.assign({ id, company, address, waiting: false, office: false, attire: A, shop, start, early: 30, travel, autoShop: true, tk: '', need: crew.length, note: '', allWeek: false, crew: crew.map(c => Array.isArray(c) ? { name: c[0], v: c[1] } : { name: c, v: '' }) }, extra || {});
  const jobs = [
    job('d1', 'ABC Restoration', '45 Elm Street, Framingham, MA', '06:15', '07:15', 30, [['Carlos Lima', '51'], 'João Pereira', 'Marcos Souza', 'Rafael Alves', 'Diego Santos'], { allWeek: true, note: 'Gate Code 1-2-3-4', left: new Date(today + 'T06:31:00').getTime() }),
    job('d2', 'Blue Line Builders', '210 Main Street, Worcester, MA', '06:00', '07:00', 30, [['André Costa', '52'], 'Felipe Rocha', 'Lucas Martins', ['Bruno Dias', 'own']], { need: 5 }),
    job('d3', 'Coastal Demo Co', '', '05:30', '07:30', null, [['Paulo Ribeiro', '54'], 'Thiago Gomes', 'Vitor Melo'], { waiting: true, autoShop: false, travel: null })
  ];
  if (location.hash === '#demo-central-cheio') {   // dia cheio de exemplo, pra testar o painel com muitas obras
    const cos = ['Harbor Homes', 'Metro Interiors', 'Summit Builders', 'Pioneer Restoration', 'Green Valley Co', 'North Shore Demo', 'Atlas Contractors', 'Bay State Renovations', 'Keystone Group', 'Liberty Builders', 'Granite Works', 'Riverside Homes', 'Evergreen Const.', 'Patriot Demo', 'Colonial Remodel', 'Beacon Hill Co', 'Charles River Inc'];
    const towns = ['Natick', 'Boston', 'Newton', 'Milford', 'Hopkinton', 'Quincy', 'Waltham', 'Marlborough', 'Ashland', 'Medway', 'Franklin', 'Dedham', 'Needham', 'Sudbury', 'Wellesley', 'Brookline', 'Cambridge'];
    const ppl = ['Gabriel Teixeira', 'Eduardo Nunes', 'Ana Paula', 'Ricardo Lopes', 'Sérgio Mota', 'Igor Freitas', 'Wesley Pinto'];
    cos.forEach((c, i) => { const h = 5 + Math.floor(i / 3), m = (i % 3) * 20; const shop = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      jobs.push(job('x' + i, c, (10 + i) + ' Main St, ' + towns[i] + ', MA', shop, String(h + 1).padStart(2, '0') + ':' + String(m).padStart(2, '0'), 30,
        ppl.slice(0, 2 + (i % 4)).map((n, k) => k ? n + ' ' + (i + 1) : [n + ' ' + (i + 1), String(60 + i)]), i % 3 === 0 ? { left: new Date(today + 'T' + shop + ':00').getTime() + 15 * 60000 } : (i % 5 === 1 ? { need: 6 } : {}))); });
  }
  const drivers = {}; jobs.forEach(j => { const n = j.crew.filter(c => c.v && c.v !== 'own').map(c => c.name); if (n.length) drivers[j.id] = n; });
  const t = h => new Date(today + 'T' + h + ':00').getTime();
  const nextDays = () => { const o = {}; [[1, [['Blue Line Builders', 6], ['Harbor Homes', 4]]], [2, [['ABC Restoration', 5], ['Blue Line Builders', 8]]], [3, [['Coastal Demo Co', 12], ['Harbor Homes', 3]]], [6, [['ABC Restoration', 4]]]].forEach(([n, js]) => {
    const d = new Date(); d.setDate(d.getDate() + n); const ds = iso(d);
    o['days/' + ds] = { date: ds, sent: {}, drivers: {}, jobs: js.map(([c, need], i) => job('n' + n + i, c, '', '', '07:00', null, [], { need, autoShop: false, travel: null })) }; }); return o; };
  return {
    'config/roster': {
      workers: ['André Costa', 'Bruno Dias', 'Carlos Lima', 'Diego Santos', 'Eduardo Nunes', 'Felipe Rocha', 'Gabriel Teixeira', 'João Pereira', 'Lucas Martins', 'Marcos Souza', 'Paulo Ribeiro', 'Rafael Alves', 'Thiago Gomes', 'Vitor Melo'],
      vehicles: [{ n: '51', t: '🛻' }, { n: '52', t: '🛻' }, { n: '54', t: '🚐' }],
      companies: { 'ABC Restoration': ['45 Elm Street, Framingham, MA'], 'Blue Line Builders': ['210 Main Street, Worcester, MA'], 'Coastal Demo Co': [] },
      offices: { 'Coastal Demo Co': '12 Harbor Road, Quincy, MA' },
      base: 'Shop da empresa, Holliston, MA', buffer: 30,
      travel: { '45 elm street framingham ma': 30, '210 main street worcester ma': 30 },
      drivers: ['Carlos Lima', 'André Costa', 'Paulo Ribeiro']
    },
    'config/phones': { phones: { 'Carlos Lima': '(508) 555-0101', 'João Pereira': '(508) 555-0102', 'André Costa': '(508) 555-0103', 'Paulo Ribeiro': '(508) 555-0104' } },
    ['days/' + today]: { date: today, jobs, sent: {}, drivers },
    ...nextDays(),
    ...(() => { const d = new Date(); d.setDate(d.getDate() + 1); const ds = iso(d); return { ['dayoff/' + ds]: { date: ds, people: { 'João Pereira': { by: 'demo', at: 0 } } } }; })(),
    ['days/' + yest]: { date: yest, jobs: [jobs[0]], sent: {}, drivers: { d1: ['Carlos Lima'] } },
    ['pay/rates']: (() => { const d = new Date(); d.setDate(d.getDate() - 60); const old = iso(d); return { names: {}, rates: { 'carlos lima': [{ from: old, rate: 32, by: 'demo', at: 0 }], 'joao pereira': [{ from: old, rate: 25, by: 'demo', at: 0 }], 'marcos souza': [{ from: old, rate: 24, by: 'demo', at: 0 }], 'andre costa': [{ from: old, rate: 30, by: 'demo', at: 0 }], 'felipe rocha': [{ from: old, rate: 23.5, by: 'demo', at: 0 }], 'lucas martins': [{ from: old, rate: 24, by: 'demo', at: 0 }] } }; })(),
    ['attendance/' + today + '_d1']: { date: today, jobId: 'd1', company: 'ABC Restoration', driver: 'Carlos Lima', by: 'demo', people: { 'Carlos Lima': 'in', 'João Pereira': 'in', 'Marcos Souza': 'in', 'Rafael Alves': 'out' }, times: { 'Carlos Lima': t('06:02'), 'João Pereira': t('06:09'), 'Marcos Souza': t('06:21') }, atMs: t('06:25') }
  };
}
function startDemo() {
  show('app');
  document.body.classList.add('demo');
  const bar = document.createElement('div'); bar.className = 'demobar';
  bar.innerHTML = '👀 <b>Modo demonstração</b>: dados de exemplo, nada é salvo. Pode mexer à vontade. <button class="linkbtn" id="demoReset">Recomeçar</button>';
  document.querySelector('#app .wrap').prepend(bar);
  $('demoReset').onclick = () => location.reload();
  $('who').textContent = 'Demonstração (sem login)';
  $('logout').textContent = 'Recomeçar'; $('logout').onclick = () => location.reload();
  $('logout2').onclick = () => location.reload();
  $('tab-access').hidden = true;
  started = window.startApp(memDb(demoSeed()), { email: 'demo@exemplo', isAdmin: true, perms: { escala: true, apagar: true, cadastro: true, telefones: true, backup: true, fotos: true, financeiro: true }, worker: '', reauth: pwd => pwd === 'demo' ? Promise.resolve(true) : Promise.reject({ code: 'auth/wrong-password' }) });
}

/* ----- gerenciar quem tem acesso (só administrador) ----- */
const PERMS = [['escala', 'Editar escala'], ['apagar', 'Apagar obras'], ['cadastro', 'Editar cadastro'], ['telefones', 'Telefones e avisar equipe'], ['backup', 'Baixar backup'], ['fotos', 'Ver todas as fotos'], ['financeiro', '🧾 Financeiro (T&M, horas)'], ['totem', '🖥️ É o totem do shop (só check-in)']];
const NEW_DEFAULT = { escala: true, apagar: false, cadastro: false, telefones: true, backup: false, fotos: false, financeiro: false, totem: false };
const OFF_DEFAULT = ['totem', 'financeiro'];  // permissões que começam DESLIGADAS quando não estão gravadas
const permBoxes = (p, isAdm, prefix, lockAll) =>
  `<label class="perm admin"><input type="checkbox" data-adm="1" ${isAdm ? 'checked' : ''} ${lockAll ? 'disabled' : ''} id="${prefix}-admin"> Admin (tudo + acesso)</label>` +
  PERMS.map(([k, t]) => `<label class="perm"><input type="checkbox" data-perm="${k}" ${isAdm || p[k] ? 'checked' : ''} ${isAdm || lockAll ? 'disabled' : ''} id="${prefix}-${k}"> ${t}</label>`).join('');
let WORKERS = [];
const workerSel = (cur, id) => `<label class="wlink">É o trabalhador <select data-worker="1" id="${id}"><option value="">— ninguém (escritório) —</option>${
  [...new Set([...WORKERS, ...(cur ? [cur] : [])])].sort((a, b) => a.localeCompare(b, 'pt')).map(w => `<option${w === cur ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select></label>`;
const fullPerms = r => { const o = {}; PERMS.forEach(([k]) => o[k] = r.perms && k in r.perms ? !!r.perms[k] : !OFF_DEFAULT.includes(k)); return o; };

function setupMembers(isAdmin, me) {
  if (!isAdmin) return;
  const msgEl = $('memberMsg');
  const fail = err => { msgEl.textContent = 'Não consegui salvar (' + (err.code || 'erro') + '). Confira se as regras novas foram publicadas no Firebase.'; };
  let rows = [];
  const draw = () => {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#members')) return;
    $('members').innerHTML = rows.map((r, i) => `<div class="mcard" data-email="${esc(r.email)}">
      <div class="mhead"><b>${esc(r.email)}</b>${r.email === me ? '<span class="youtag">você</span>' : `<button class="x" data-mdel="1" aria-label="Tirar acesso de ${esc(r.email)}">×</button>`}</div>
      ${workerSel(r.worker || '', 'mw' + i)}
      <div class="perms">${permBoxes(fullPerms(r), r.role === 'admin', 'm' + i, r.email === me)}</div></div>`).join('') || '<span class="empty">Ninguém liberado ainda.</span>';
  };
  onSnapshot(collection(fs, 'members'), s => {
    rows = s.docs.map(d => d.data()).sort((a, b) => (a.email === me ? -1 : b.email === me ? 1 : (a.email || '').localeCompare(b.email || '')));
    draw();
  }, () => {});
  onSnapshot(doc(fs, 'config', 'roster'), s => {
    WORKERS = (s.exists() && Array.isArray(s.data().workers)) ? s.data().workers : [];
    draw();
    const cur = $('newWorkerLink') ? $('newWorkerLink').value : '';
    $('newLink').innerHTML = workerSel(cur, 'newWorkerLink');
  }, () => {});
  $('members').addEventListener('change', async e => {
    const card = e.target.closest('.mcard'); if (!card) return;
    const email = card.dataset.email;
    const role = card.querySelector('[data-adm]').checked ? 'admin' : 'member';
    const perms = {}; card.querySelectorAll('[data-perm]').forEach(c => perms[c.dataset.perm] = c.checked);
    const worker = card.querySelector('[data-worker]').value;
    if (role === 'admin') card.querySelectorAll('[data-perm]').forEach(c => { c.checked = true; c.disabled = true; });
    try { await setDoc(doc(fs, 'members', email), { email, role, perms, worker, at: serverTimestamp() }); msgEl.textContent = 'Permissões de ' + email + ' salvas.'; e.target.blur(); }
    catch (err) { fail(err); }
  });
  $('members').addEventListener('click', async e => {
    const b = e.target.closest('[data-mdel]'); if (!b) return;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tirar acesso?'; b.style.fontSize = '13px'; return; }
    try { await deleteDoc(doc(fs, 'members', b.closest('.mcard').dataset.email)); } catch (err) { fail(err); }
  });
  $('newPerms').innerHTML = permBoxes(NEW_DEFAULT, false, 'np', false);
  $('newPerms').addEventListener('change', e => { if (e.target.dataset.adm) $('newPerms').querySelectorAll('[data-perm]').forEach(c => { if (e.target.checked) c.checked = true; c.disabled = e.target.checked; }); });
  const add = async () => {
    const em = $('newMember').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { msgEl.textContent = 'Digite um e-mail válido.'; return; }
    const role = $('newPerms').querySelector('[data-adm]').checked ? 'admin' : 'member';
    const perms = {}; $('newPerms').querySelectorAll('[data-perm]').forEach(c => perms[c.dataset.perm] = c.checked);
    try {
      const worker = $('newWorkerLink') ? $('newWorkerLink').value : '';
      await setDoc(doc(fs, 'members', em), { email: em, role, perms, worker, at: serverTimestamp() });
      deleteDoc(doc(fs, 'requests', em)).catch(() => {});
      $('newMember').value = ''; $('newPerms').innerHTML = permBoxes(NEW_DEFAULT, false, 'np', false);
      msgEl.textContent = 'Liberado! Peça pra pessoa abrir o app e tocar em "Primeiro acesso".';
    } catch (err) { fail(err); }
  };
  $('addMember').onclick = add;

  /* pedidos de acesso: quem criou conta e ainda não foi liberado */
  let reqs = [];
  const drawReqs = () => {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#requests')) return;
    const n = reqs.length;
    $('tab-access').textContent = n ? `Acesso (${n})` : 'Acesso';
    $('reqBanner').hidden = !n;
    $('reqBanner').innerHTML = n ? `🔔 <b>${n} ${n > 1 ? 'pessoas pedindo' : 'pessoa pedindo'} acesso</b> ao app. <button class="linkbtn" id="reqGo">Ver pedidos</button>` : '';
    $('reqPanel').hidden = !n;
    $('requests').innerHTML = reqs.map((r, i) => `<div class="mcard req" data-email="${esc(r.email)}">
      <div class="mhead"><b>${esc(r.name || r.email)}</b><span class="youtag">${r.at && r.at.toDate ? esc(r.at.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : ''}</span></div>
      ${r.name ? `<small class="hint">${esc(r.email)}</small>` : ''}
      ${workerSel('', 'rw' + i)}
      <div class="perms">${permBoxes(NEW_DEFAULT, false, 'r' + i, false)}</div>
      <div class="gbtns" style="margin-top:0"><button class="btn primary" data-rok="1">Aprovar</button><button class="btn danger" data-rno="1">Recusar</button></div></div>`).join('');
  };
  onSnapshot(collection(fs, 'requests'), s => {
    const members = new Set(rows.map(r => r.email));
    reqs = s.docs.map(d => d.data()).filter(r => r.email && !members.has(r.email)).sort((a, b) => ((b.at && b.at.seconds) || 0) - ((a.at && a.at.seconds) || 0));
    drawReqs();
  }, () => {});
  document.addEventListener('click', e => { if (e.target.id === 'reqGo') { $('tab-access').click(); setTimeout(() => $('reqPanel').scrollIntoView({ block: 'start' }), 50); } });
  $('requests').addEventListener('change', e => { if (e.target.dataset.adm) { const c = e.target.closest('.mcard'); c.querySelectorAll('[data-perm]').forEach(x => { if (e.target.checked) x.checked = true; x.disabled = e.target.checked; }); } });
  $('requests').addEventListener('click', async e => {
    const card = e.target.closest('.mcard'); if (!card) return;
    const email = card.dataset.email;
    if (e.target.dataset.rok) {
      const role = card.querySelector('[data-adm]').checked ? 'admin' : 'member';
      const perms = {}; card.querySelectorAll('[data-perm]').forEach(c => perms[c.dataset.perm] = c.checked);
      const worker = card.querySelector('[data-worker]').value;
      e.target.disabled = true; e.target.textContent = 'Aprovando…';
      try {
        await setDoc(doc(fs, 'members', email), { email, role, perms, worker, at: serverTimestamp() });
        await deleteDoc(doc(fs, 'requests', email)).catch(() => {});
        msgEl.textContent = email + ' aprovado! Avise a pessoa pra tocar em "Tentar de novo".';
      } catch (err) { fail(err); e.target.disabled = false; e.target.textContent = 'Aprovar'; }
    }
    if (e.target.dataset.rno) {
      if (e.target.dataset.confirm !== '1') { e.target.dataset.confirm = '1'; e.target.textContent = 'Toque de novo pra recusar'; return; }
      try { await deleteDoc(doc(fs, 'requests', email)); } catch (err) { fail(err); }
    }
  });
  $('newMember').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
}

/* ----- service worker (offline + instalação) ----- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
