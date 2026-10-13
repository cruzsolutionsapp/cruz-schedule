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
- `config/roster`: `{workers[], vehicles[{n,t}], companies{nome:[endereços]}, base, travel{endereçoNormalizado:min}}`
- `config/phones`: `{phones{nome:tel}}` (separado pra só quem tem a permissão `telefones` ler)
- `days/YYYY-MM-DD`: `{date, drivers{jobId:[nomes com veículo]}, jobs[{id,company,address,waiting,attire,shop,start,early,travel,autoShop,tk,need,note,allWeek,crew[{name,v}]}], sent{nome:iso}}`
- `members/<email>`: `{email, role:'admin'|'member', worker:'Nome do trabalhador', perms{escala,apagar,cadastro,telefones,backup,fotos}}` (perms ausente = tudo liberado; admin = tudo + aba Acesso) · `meta/owner`: primeiro administrador. · `requests/<email>`: `{email, name, at}` pedido de acesso criado quando alguém não liberado entra; admin aprova/recusa na aba Acesso (aviso no topo).
- Fotos: `photos/{id}` só dados `{date, jobId, site, company, address, driver, by, at, atMs, expireAt, w, h}` (fotos antigas podem ter `thumb` aqui); `photoThumb/{id}` `{thumb,…}`; `photoFull/{id}` `{data (jpeg ~1600px base64),…}`. Agrupadas por obra via `site` = companhia|endereço normalizados (todos os dias juntos). Aba Fotos lista as obras; galeria baixa .zip (JSZip do cdnjs). Versão de teste sem Storage; `expireAt` (1 ano): o app de um admin apaga as vencidas ao abrir (`cleanupOldPhotos`), sem depender de TTL no console. Motorista = quem tem veículo na equipe e está ligado a um login via `worker`.
- `attendance/{data_jobId}`: `{date, jobId, site, company, driver, by, people{nome:'in'|'out'}, at, atMs}` presença marcada pelo motorista (painel "Minha obra hoje"); escritório vê no cartão da obra e nos avisos.

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
