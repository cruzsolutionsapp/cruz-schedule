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
  get: async () => { const s = await getDocs(query(ref, ...cons)); return { docs: s.docs.map(wrap), size: s.size }; }
});
const dbw = {
  doc: p => { const r = doc(fs, p); return {
    set: d => setDoc(r, d),
    get: async () => wrap(await getDoc(r)),
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
  const isAdmin = m.data().role === 'admin';
  if (started) return;
  show('app');
  $('who').textContent = me + (isAdmin ? ' · administrador' : '');
  $('logout').onclick = () => { try { started && started.flushAll(); } catch (e) {} signOut(auth); };
  started = window.startApp(dbw, { email: me, isAdmin });
  setupMembers(isAdmin, me);
}
onAuthStateChanged(auth, route);

/* ----- gerenciar quem tem acesso (só administrador) ----- */
function setupMembers(isAdmin, me) {
  $('membersBox').hidden = !isAdmin;
  if (!isAdmin) return;
  onSnapshot(collection(fs, 'members'), s => {
    const rows = s.docs.map(d => d.data()).sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    $('members').innerHTML = rows.map(r => `<div class="lrow"><span class="wname">${esc(r.email)}</span>
      <span class="role">${r.role === 'admin' ? 'admin' : 'usuário'}</span>
      ${r.email === me ? '' : `<button class="x" data-mdel="${esc(r.email)}" aria-label="Tirar acesso de ${esc(r.email)}">×</button>`}</div>`).join('');
  }, () => {});
  $('members').onclick = async e => { const b = e.target.closest('[data-mdel]'); if (!b) return;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tirar?'; return; }
    await deleteDoc(doc(fs, 'members', b.dataset.mdel)).catch(err => alertMsg(err)); };
  const add = async () => {
    const em = $('newMember').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { $('memberMsg').textContent = 'Digite um e-mail válido.'; return; }
    try { await setDoc(doc(fs, 'members', em), { email: em, role: $('newRole').value, at: serverTimestamp() });
      $('newMember').value = ''; $('memberMsg').textContent = 'Liberado! Peça pra pessoa abrir o app e tocar em "Primeiro acesso".'; }
    catch (err) { alertMsg(err); }
  };
  const alertMsg = err => { $('memberMsg').textContent = 'Não consegui salvar (' + (err.code || 'erro') + ').'; };
  $('addMember').onclick = add;
  $('newMember').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
}

/* ----- service worker (offline + instalação) ----- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
