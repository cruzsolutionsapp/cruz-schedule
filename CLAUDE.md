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
- `config/roster`: `{workers[], vehicles[{n,t}], companies{nome:[endereços]}, base, travel{endereçoNormalizado:min}, drivers[nomes marcados como Motorista], offices{companhia: endereço do office/shop dela}}`
- `config/phones`: `{phones{nome:tel}}` (separado pra só quem tem a permissão `telefones` ler)
- `days/YYYY-MM-DD`: `{date, drivers{jobId:[nomes com veículo]}, jobs[{id,company,address,waiting,office (ir pro office da companhia: address = offices[companhia]),attire,shop,start,early,travel,autoShop,tk,need,note,allWeek,left (ms de quando a turma saiu do shop; 0 = ainda não saiu — bolinha vermelha/verde no cartão, sem hora; zera ao copiar; obra All Week marcada como saiu é copiada sozinha pro dia seguinte),crew[{name,v (nº do veículo, 'own' = 🚗 carro próprio)}]}] — a ordem da equipe é a do escritório (não reordenar), sent{nome:iso}}`
- `members/<email>`: `{email, role:'admin'|'member', worker:'Nome do trabalhador', perms{escala,apagar,cadastro,telefones,backup,fotos}}` (perms ausente = tudo liberado; admin = tudo + aba Acesso) · `meta/owner`: primeiro administrador. · `requests/<email>`: `{email, name, at}` pedido de acesso criado quando alguém não liberado entra; admin aprova/recusa na aba Acesso (aviso no topo).
- Fotos: `photos/{id}` só dados `{date, jobId, site, company, address, driver, by, at, atMs, expireAt, w, h}` (fotos antigas podem ter `thumb` aqui); `photoThumb/{id}` `{thumb,…}`; `photoFull/{id}` `{data (jpeg ~1600px base64),…}`. Agrupadas por obra via `site` = companhia|endereço normalizados (todos os dias juntos). Aba Fotos lista as obras; galeria baixa .zip (JSZip do cdnjs). Versão de teste sem Storage; `expireAt` (1 ano): o app de um admin apaga as vencidas ao abrir (`cleanupOldPhotos`), sem depender de TTL no console. Responsável/motorista da obra = na equipe com veículo OU marcado como Motorista no Cadastro (`jobDrivers`), e ligado a um login via `worker`. A escala grava `drivers{jobId:[nomes]}` e as regras conferem isso.
- `attendance/{data_jobId}`: `{date, jobId, site, company, driver, by, people{nome:'in'|'out'}, times{nome:ms do check-in no totem}, at, atMs}` presença marcada pelo motorista (painel "Minha obra hoje"); escritório vê no cartão da obra e nos avisos.
- Modo Totem (tablet no shop): tela separada `#totem` (abre pelo botão em Cadastro → Acesso, pelo link `#totem`, ou sozinho no login com perm `totem`). Toca no nome → grava people='in' + times. Escritório vê a hora ao lado do nome; atrasado = depois do horário do shop. Perm `totem` é false por padrão.
- Link de demonstração: `…/cruz-schedule/#demo` abre sem login, com dados inventados num banco em memória (`memDb`/`demoSeed` em auth.js). Nada é salvo nem lê dados reais.
- Aba 🔍 Buscar: busca em `days` (e presença em `attendance`) por funcionário, companhia ou endereço, com período (7/30/90/365 dias ou datas). Sem acento/maiúscula. Clicar no resultado abre o dia e destaca a obra. Baixa .csv (perm backup).
- Aba 📅 Calendário: mês com as obras de cada dia (lê `days` do intervalo, ao vivo). "+ Agendamento" grava a obra direto em `days/AAAA-MM-DD` (equipe vazia, `need` = quantas pessoas; repetir até X pulando fim de semana; All Week). Cada dia mostra o nº de LIVRES = total de `workers` − soma de max(need, equipe) (verde/laranja ≥85%/vermelho acima).

## Formato da mensagem do WhatsApp (não mudar sem pedir)
```
Sexta-feira
10/09        (dia da semana + mês/dia, uma vez no topo)

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
