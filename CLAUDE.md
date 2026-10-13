# Cruz Schedule

App interno (PWA) da Cruz Solutions Services Corporation para montar a escala diária das equipes ("schedule") e gerar a mensagem do WhatsApp. O usuário (Bruno) fala português; responda em português, em linguagem simples (ele não é programador).

## Como funciona
- Site estático no GitHub Pages: https://cruzsolutionsapp.github.io/cruz-schedule/ (branch `main`, pasta raiz). Cada push em `main` publica sozinho.
- Login e banco de dados: Firebase (projeto `cruz-schedule`), Auth e-mail/senha + Firestore (edição Standard).
- `index.html` — telas (login, portão de acesso, app). `style.css` — estilos (tokens de cor no topo, tema claro/escuro).
- `app-core.js` — toda a lógica do schedule (script clássico; expõe `window.startApp(db, ctx)`). Usa um adaptador `db.doc(path).set/get/onSnapshot` e `db.collection(path).where/orderBy/limit/get`.
- `auth.js` — módulo ES: Firebase, login, verificação de e-mail, lista de acesso (`members`), adaptador do banco, registro do service worker.
- `sw.js` — offline. **Ao mudar arquivos do app, aumente `VERSION` em `sw.js`.**
- `firestore.rules` — regras de segurança. Não são publicadas automaticamente: o usuário cola no Console do Firebase → Firestore → Regras.

## Dados (Firestore)
- `config/roster`: `{workers[], vehicles[{n,t}], companies{nome:[endereços]}, base, travel{endereçoNormalizado:min}, phones{nome:tel}}`
- `days/YYYY-MM-DD`: `{date, jobs[{id,company,address,waiting,attire,shop,start,early,travel,autoShop,tk,need,note,allWeek,crew[{name,v}]}], sent{nome:iso}}`
- `members/<email>`: `{email, role:'admin'|'member'}` · `meta/owner`: primeiro administrador.

## Formato da mensagem do WhatsApp (não mudar sem pedir)
```
✅ Companhia
Endereço   (ou "(Esperando)")
🔴 Calca👖|Bota 🥾
🔴 6:30am no shopp
⏰ start 7:30am
(Observação)
(All Week)

	✓ Motorista 🛻(51)
	✓ Nome
__
```
