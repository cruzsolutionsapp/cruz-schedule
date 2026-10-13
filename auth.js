/* ===== Firebase + login + controle de acesso ===== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, getDoc, getDocs,
  setDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
    return gate(`<h2>Aguardando liberação</h2><p>Seu e-mail <b>${esc(me)}</b> ainda não foi liberado. Peça pro administrador adicionar você em <b>Cadastro → Acesso</b> e depois toque em "Tentar de novo".</p>
      <div class="gbtns"><button class="btn primary" data-g="recheck">Tentar de novo</button><button class="linkbtn" data-g="out">Sair</button></div>`);
  }
  const md = m.data(), isAdmin = md.role === 'admin';
  const perms = {}; PERMS.forEach(([k]) => perms[k] = isAdmin ? true : (md.perms && k in md.perms ? !!md.perms[k] : true));
  if (started) return;
  show('app');
  $('who').textContent = me + (isAdmin ? ' · admin' : '');
  $('tab-access').hidden = !isAdmin;
  $('logout').onclick = () => { try { started && started.flushAll(); } catch (e) {} signOut(auth); };
  $('logout2').onclick = $('logout').onclick;
  started = window.startApp(dbw, { email: me, isAdmin, perms, worker: md.worker || '' });
  setupMembers(isAdmin, me);
}
onAuthStateChanged(auth, route);

/* ----- gerenciar quem tem acesso (só administrador) ----- */
const PERMS = [['escala', 'Editar escala'], ['apagar', 'Apagar obras'], ['cadastro', 'Editar cadastro'], ['telefones', 'Telefones e avisar equipe'], ['backup', 'Baixar backup'], ['fotos', 'Ver todas as fotos']];
const NEW_DEFAULT = { escala: true, apagar: false, cadastro: false, telefones: true, backup: false, fotos: false };
const permBoxes = (p, isAdm, prefix, lockAll) =>
  `<label class="perm admin"><input type="checkbox" data-adm="1" ${isAdm ? 'checked' : ''} ${lockAll ? 'disabled' : ''} id="${prefix}-admin"> Admin (tudo + acesso)</label>` +
  PERMS.map(([k, t]) => `<label class="perm"><input type="checkbox" data-perm="${k}" ${isAdm || p[k] ? 'checked' : ''} ${isAdm || lockAll ? 'disabled' : ''} id="${prefix}-${k}"> ${t}</label>`).join('');
let WORKERS = [];
const workerSel = (cur, id) => `<label class="wlink">É o trabalhador <select data-worker="1" id="${id}"><option value="">— ninguém (escritório) —</option>${
  [...new Set([...WORKERS, ...(cur ? [cur] : [])])].sort((a, b) => a.localeCompare(b, 'pt')).map(w => `<option${w === cur ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select></label>`;
const fullPerms = r => { const o = {}; PERMS.forEach(([k]) => o[k] = r.perms && k in r.perms ? !!r.perms[k] : true); return o; };

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
      $('newMember').value = ''; $('newPerms').innerHTML = permBoxes(NEW_DEFAULT, false, 'np', false);
      msgEl.textContent = 'Liberado! Peça pra pessoa abrir o app e tocar em "Primeiro acesso".';
    } catch (err) { fail(err); }
  };
  $('addMember').onclick = add;
  $('newMember').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
}

/* ----- service worker (offline + instalação) ----- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
