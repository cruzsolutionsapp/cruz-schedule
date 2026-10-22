/* Idioma da tela (Português / English). Cada aparelho escolhe o seu (localStorage 'lang').
   Como funciona: o app continua escrito em português; com EN ligado, um observador troca na hora os textos da tela
   (texto, placeholder, title, aria-label, confirm/prompt) pela tradução do dicionário abaixo.
   NÃO traduz: o que a pessoa digita (inputs), a mensagem do WhatsApp (#preview) e o relatório do patrão (#rpPreview),
   nomes, companhias e endereços (não estão no dicionário). */
(function () {
  let L = 'pt';
  try { L = localStorage.getItem('lang') || 'pt'; } catch (e) {}
  window.LANG = L;
  window.setLang = l => { try { localStorage.setItem('lang', l); } catch (e) {} location.reload(); };

  // ---------- frases inteiras ----------
  const EN = {
    // login / acesso
    'Entrar': 'Sign in', 'E-mail': 'Email', 'Senha': 'Password', 'Repita a senha': 'Repeat the password',
    'Primeiro acesso': 'First access', 'Esqueci a senha': 'Forgot password', 'Voltar pro login': 'Back to sign in',
    'Carregando…': 'Loading…', 'Conectando…': 'Connecting…', 'Criar minha senha': 'Create my password',
    'Enviar link pra trocar a senha': 'Send password reset link', 'A senha precisa ter pelo menos 6 caracteres.': 'The password needs at least 6 characters.',
    'E-mail inválido.': 'Invalid email.', 'E-mail ou senha incorretos.': 'Wrong email or password.',
    'Esse e-mail já tem conta. Use "Entrar" ou "Esqueci a senha".': 'This email already has an account. Use "Sign in" or "Forgot password".',
    'Muitas tentativas. Espere alguns minutos.': 'Too many attempts. Wait a few minutes.',
    'Não existe conta com esse e-mail. Use "Primeiro acesso".': 'There is no account with this email. Use "First access".',
    'Sem internet. Conecte e tente de novo.': 'No internet. Connect and try again.',
    'As senhas não são iguais.': 'The passwords don\'t match.',
    'Pronto! Veja seu e-mail (e o spam) pra criar uma senha nova.': 'Done! Check your email (and spam) to create a new password.',
    'Confirme seu e-mail': 'Confirm your email', 'Mandamos um link de confirmação pra': 'We sent a confirmation link to',
    '. Abra o e-mail (veja também o spam), toque no link e depois volte aqui.': '. Open the email (also check spam), tap the link and then come back here.',
    'Já confirmei': 'I confirmed it', 'Reenviar e-mail': 'Resend email', 'Pedido de acesso enviado': 'Access request sent',
    'Sua conta (': 'Your account (', ') foi criada e o': ') was created and the', 'administrador já recebeu seu pedido': 'administrator already got your request',
    'no app. Assim que ele aprovar, toque em': 'in the app. As soon as they approve it, tap', '"Tentar de novo"': '"Try again"',
    'Seu nome (pra ele saber quem é)': 'Your name (so they know who you are)', 'Salvar nome': 'Save name', 'Tentar de novo': 'Try again',
    'Sem acesso': 'No access', 'Primeiro acesso do app': 'App first setup', 'Sou o administrador': 'I am the administrator',
    'Ninguém configurou o app ainda. Você (': 'Nobody has set up the app yet. You (', ') vai ser o': ') will be the', 'administrador': 'administrator',
    ': é quem libera o acesso dos outros.': ': the one who gives access to others.', 'Configurando…': 'Setting up…',
    'Modo demonstração': 'Demo mode', ': dados de exemplo, nada é salvo. Pode mexer à vontade.': ': sample data, nothing is saved. Feel free to try.',
    'Recomeçar': 'Start over', 'Demonstração (sem login)': 'Demo (no sign-in)', 'Sair': 'Sign out', '🚪 Sair': '🚪 Sign out',
    'Sair do app (deslogar)': 'Sign out of the app', 'Sincronizado': 'Synced', 'Sincronizando…': 'Syncing…', 'Salvando…': 'Saving…',
    'Sem internet': 'Offline', 'Sem internet (salvo no aparelho)': 'Offline (saved on this device)', 'Erro ao salvar': 'Error saving', 'Sem internet · salvo no aparelho': 'Offline · saved on this device',
    'Ver pedidos': 'See requests', 'Aprovar': 'Approve', 'Recusar': 'Decline', 'Aprovando…': 'Approving…', 'Ninguém liberado ainda.': 'Nobody has access yet.',
    'Admin (tudo + acesso)': 'Admin (everything + access)', 'É o trabalhador': 'Is the worker', '— ninguém (escritório) —': '— nobody (office) —', 'você': 'you',
    'Editar escala': 'Edit schedule', 'Apagar obras': 'Delete jobs', 'Editar cadastro': 'Edit records', 'Telefones e avisar equipe': 'Phones and notify crew',
    'Baixar backup': 'Download backup', 'Ver todas as fotos': 'See all photos', '🧾 Financeiro (T&M, horas)': '🧾 Finance (T&M, hours)',
    '🖥️ É o totem do shop (só check-in)': '🖥️ Is the shop kiosk (check-in only)',
    // abas e topo
    'Escala': 'Schedule', 'Calendário': 'Calendar', 'Fotos': 'Photos', 'Cadastro': 'Setup', 'Acesso': 'Access', '🔍 Buscar': '🔍 Search',
    '🧾 T&M': '🧾 T&M', 'Dia anterior': 'Previous day', 'Próximo dia': 'Next day', 'Data do schedule': 'Schedule date', 'hoje': 'today',
    '+ Nova obra': '+ New job', 'Copiar último dia': 'Copy last day', 'Trazer obras All Week': 'Pull in All Week jobs', 'Limpar dia': 'Clear day',
    'Mensagem': 'Message', 'como vai no WhatsApp': 'as it goes on WhatsApp', 'Use o botão laranja embaixo pra copiar e colar no grupo.': 'Use the orange button below to copy and paste it in the group.',
    'Relatório do dia': 'Daily report', 'Ver o relatório': 'See the report', '📊 Enviar pro patrão': '📊 Send to boss', 'Copiar': 'Copy',
    'Fora do schedule': 'Unassigned', 'Avisar equipe': 'Notify crew', 'Hoje': 'Today', '+ Obra': '+ Job', 'Copiar mensagem': 'Copy message',
    'Baixar': 'Download', 'Apagar': 'Delete', 'Fechar': 'Close', 'Cancelar': 'Cancel', 'Abrir': 'Open', 'Recolher': 'Collapse', 'Subir': 'Move up', 'Descer': 'Move down',
    // escala / obra
    'Minha obra hoje': 'My job today', 'você é o motorista': 'you are the driver', 'Nova obra': 'New job', 'Companhia': 'Company', 'Endereço': 'Address',
    'Despachada': 'Dispatched', 'Aguardando': 'Waiting', 'DESPACHADA': 'DISPATCHED', 'AGUARDANDO': 'WAITING', 'sem motorista': 'no driver', 'Motorista do dia': 'Driver of the day',
    'Turma já saiu (toque pra desfazer)': 'Crew already left (tap to undo)', 'Turma já saiu': 'Crew already left',
    'Turma ainda não saiu (toque quando sair)': 'Crew hasn\'t left yet (tap when they do)', 'Turma ainda não saiu': 'Crew hasn\'t left yet',
    'min de viagem': 'min drive', 'Minutos de viagem': 'Drive time (min)', 'Conferir no Google Maps ↗': 'Check on Google Maps ↗', 'Esperando endereço': 'Address TBD',
    '(Esperando)': '(Address TBD)', '(Esperando endereço)': '(Address TBD)', '🏢 Ir pro office da companhia': '🏢 Report to the company office', 'Vestimenta': 'Dress code',
    'No shop': 'Shop time', 'Chegar antes do start': 'Arrive early', 'Chegar na obra antes do start': 'Arrive on site before start', 'Na hora': 'On time',
    'Semana toda': 'All week', 'incluir sábado e domingo': 'include Saturday and Sunday', 'Equipe': 'Crew', 'Preciso de': 'Need', 'pessoas': 'people',
    'Presença:': 'Attendance:', '+ Adicionar pessoas': '+ Add people', '📷 Fotos da obra': '📷 Job photos', 'Apagar obra': 'Delete job', 'Toque de novo pra apagar': 'Tap again to delete',
    'Presença ainda não confirmada pelo motorista.': 'Driver hasn\'t confirmed attendance yet.', 'Rua, cidade, MA': 'Street, city, MA', 'Ex.: Levar Roupa': 'E.g.: Bring clothes',
    'Check-in no totem': 'Kiosk check-in', 'Veio': 'Here', 'Faltou': 'No-show', 'Telefone': 'Phone', 'Nome': 'Name', 'Observação': 'Note', 'Start': 'Start',
    'Pronto': 'Done', 'Adicionar': 'Add', 'Nome extra (não cadastrado)': 'Extra name (not registered)', 'Todos os fixos já estão escalados.': 'All regulars are already scheduled.',
    '🌴 Day off:': '🌴 Day off:', '✓ Já conferi os avisos amarelos': '✓ Mark yellow alerts as reviewed', 'mostrar de novo': 'show them again', 'Tudo certo': 'All good',
    '🕘 Versões anteriores do dia': '🕘 Version history', '📋 Colar mensagem do WhatsApp': '📋 Paste WhatsApp message', '📺 Ver a TV': '📺 Open TV view',
    '🔄 Atualizar a TV': '🔄 Refresh TV', '▸ Recolher todas': '▸ Collapse all', '▾ Abrir todas': '▾ Expand all', '✅ Despachar todas': '✅ Dispatch all',
    'obras ·': 'jobs ·', 'pessoas ·': 'people ·', 'fora do schedule': 'unassigned', 'avisos': 'alerts', '✓ todos encaixados': '✓ everyone assigned',
    'Enviar': 'Send', 'Motorista': 'Driver', '🔑 Motorista': '🔑 Driver', 'Motorista / responsável pela obra': 'Driver / in charge of the job',
    'Abre o WhatsApp com a mensagem pronta. Envie, volte aqui e toque de novo pro próximo.': 'Opens WhatsApp with the message ready. Send it, come back here and tap again for the next person.',
    'Dica: salve o WhatsApp do patrão em Cadastro → Relatório do dia, pra abrir direto no contato dele.': 'Tip: save the boss\'s WhatsApp in Setup → Daily report to open his contact directly.',
    // T&M
    '🧾 Time & Material': '🧾 Time & Material', '📄 Folhas do dia': '📄 Daily sheets', '⏱ Horas por funcionário': '⏱ Hours by worker', '🧾 Time & Material ·': '🧾 Time & Material ·',
    'Folha de horas digital de cada obra. O motorista preenche no celular (painel "Minha obra hoje"); aqui o escritório confere, completa e baixa o PDF. Troque o dia na data lá em cima.':
      'Digital timesheet for each job. The driver fills it on the phone ("My job today" panel); here the office checks it, completes it and downloads the PDF. Change the day in the date at the top.',
    '🗑 Ver T&M excluídas (quem, quando e por quê)': '🗑 See deleted T&Ms (who, when and why)', 'sem T&M': 'no T&M', 'Criar T&M': 'Create T&M', 'Continuar': 'Continue',
    'Rascunho': 'Draft', 'Enviando…': 'Sending…', 'Assinada': 'Signed', 'Faturada': 'Invoiced', 'número sai ao enviar': 'number assigned when sent',
    'opcional': 'optional', 'Horário da turma': 'Crew times', 'até': 'to', 'Aplicar pra todos': 'Apply to all', 'Depois é só mudar quem foi diferente.': 'Then just adjust anyone who was different.',
    'Entrada da turma': 'Crew time in', 'Saída da turma': 'Crew time out', 'Horas': 'Hours', 'Já descontado 30 min de almoço': '30 min lunch already deducted',
    'TMH (total da turma · já descontado 30 min de almoço de cada um)': 'TMH (crew total · 30 min lunch already deducted from each)',
    'Limpar assinatura': 'Clear signature', 'Salvar rascunho': 'Save draft', '✍️ Enviar T&M': '✍️ Send T&M', '📄 Baixar PDF': '📄 Download PDF',
    'Destrancar pra corrigir': 'Unlock to edit', '🗑 Excluir T&M': '🗑 Delete T&M', 'Excluir T&M': 'Delete T&M', 'Assinatura do cliente': 'Customer signature',
    'Sem assinatura do cliente.': 'No customer signature.', 'For office use only': 'For office use only', 'Salvar e marcar como faturada': 'Save and mark as invoiced', 'Salvar Invoice #': 'Save Invoice #',
    'T&M sem obra na escala deste dia': 'T&M without a job in this day\'s schedule', 'a obra não está mais na escala': 'the job is no longer in the schedule',
    'Motivo': 'Reason', 'Sua senha de administrador': 'Your administrator password', 'Excluir de vez': 'Delete permanently', '🗑 T&M excluídas': '🗑 Deleted T&Ms',
    'Fica registrado quem excluiu, quando e o motivo (com uma cópia da folha). O número dela não é usado de novo.': 'It records who deleted it, when and why (with a copy of the sheet). Its number is never reused.',
    'Ex.: feita em duplicidade': 'E.g.: duplicate', 'Nenhuma T&M excluída.': 'No deleted T&M.', 'Nome': 'Name',
    'Escreva o motivo.': 'Write the reason.', 'Digite sua senha.': 'Type your password.', 'Conferindo a senha…': 'Checking the password…', 'Conferindo…': 'Checking…', 'Senha errada.': 'Wrong password.',
    'Muitas tentativas. Espere uns minutos.': 'Too many attempts. Wait a few minutes.', 'Abrir folha': 'Open sheet', 'Preparando o PDF…': 'Preparing the PDF…',
    '⚠️ A presença ainda não foi marcada ("Quem veio hoje?"). Por enquanto veio a equipe toda da escala: marque quem veio e quem faltou que a lista se ajusta sozinha.':
      '⚠️ Attendance isn\'t marked yet ("Who showed up today?"). For now it lists the whole scheduled crew: mark who\'s here and who\'s a no-show and the list updates itself.',
    '✓ Nomes puxados da presença (quem veio).': '✓ Names pulled from attendance (who showed up).', 'Sem marcar:': 'Not marked:',
    // horas
    'De': 'From', 'Até': 'To', 'Esta semana': 'This week', 'Semana anterior': 'Previous week', 'Próxima semana': 'Next week', 'Filtrar por nome': 'Filter by name',
    'Contar rascunhos (ainda não enviadas)': 'Include drafts (not sent yet)', '⬇️ Baixar Excel': '⬇️ Download Excel', 'Nenhuma hora neste período.': 'No hours in this period.',
    'Horas já com os 30 min de almoço descontados. Toque no nome pra ver dia a dia, obra por obra.': 'Hours with the 30 min lunch already deducted. Tap a name to see day by day, job by job.',
    'Funcionário': 'Worker', 'Total': 'Total', 'Decimal': 'Decimal', 'Dias': 'Days', 'Valor/h': 'Rate/h', 'A pagar': 'To pay', 'sem valor': 'no rate', 'total —': 'total —',
    '🔒 Pra ver os valores em $:': '🔒 To see the $ amounts:', 'Mostrar valores': 'Show amounts', '🔒 Esconder valores': '🔒 Hide amounts', 'Sua senha': 'Your password',
    // valores
    '💲 Valores por hora 🔒': '💲 Hourly rates 🔒', '💲 Valor por hora': '💲 Hourly rate', '🔓 Abrir': '🔓 Open', 'Aberto até': 'Open until', '🔒 Trancar agora': '🔒 Lock now',
    'Quanto cada funcionário ganha por hora. Só admin e Financeiro. Pra ver ou mudar, confirme com a senha do seu login (fica aberto 10 min).': 'How much each worker earns per hour. Admin and Finance only. To see or change, confirm with your sign-in password (stays open 10 min).',
    'Aumento entra na': 'A raise starts', 'próxima semana': 'next week', 'Novo valor por hora (US$)': 'New hourly rate (US$)', 'Vale a partir de': 'Valid from', 'Salvar valor': 'Save rate',
    'Alterar': 'Change', 'Colocar valor': 'Set rate', 'Histórico': 'History', '🗑 Apagar': '🗑 Delete', 'Apagando todos, o funcionário volta a ficar sem valor.': 'Deleting all of them, the worker goes back to no rate.',
    '(segunda-feira), a não ser que você escolha outra data. As semanas que já passaram continuam com o valor antigo. Tudo fica registrado (quem mudou e quando).':
      '(Monday), unless you choose another date. Past weeks keep the old rate. Everything is recorded (who changed it and when).',
    // motorista
    'Quem veio hoje?': 'Who showed up today?', '✓ Veio': '✓ Here', '✗ Faltou': '✗ No-show', '📷 Tirar foto': '📷 Take photo', '🖼️ Da galeria': '🖼️ Choose from library',
    'Nenhuma foto hoje.': 'No photos today.', 'Ver todas as fotos desta obra →': 'See all photos of this job →', '🧾 Time & Material': '🧾 Time & Material',
    'Fotos das obras': 'Job photos', 'agrupadas por companhia + endereço': 'grouped by company + address', 'Ainda não tem nenhuma foto.': 'No photos yet.',
    // totem / central
    'Sair do totem': 'Exit kiosk', 'Toque no seu nome pra fazer o check-in': 'Tap your name to check in', 'Procurar meu nome': 'Find my name', 'Procurar nome': 'Find name',
    '🔓 Trancar': '🔓 Lock', '⛶ Tela cheia': '⛶ Full screen', 'Digite o PIN': 'Enter the PIN', '📺 Voltar pra Central': '📺 Back to TV view',
    'obras': 'jobs', 'despachadas': 'dispatched', 'presentes': 'present', 'falta': 'missing', 'faltas': 'no-shows', 'shop': 'shop', 'saiu': 'left', 'start': 'start',
    'Toque numa obra pra ver a equipe': 'Tap a job to see the crew', 'AMANHÃ →': 'TOMORROW →', 'sem equipe ainda': 'no crew yet', 'atrasada': 'late',
    'Despachar': 'Dispatch', 'Desfazer': 'Undo', 'Abrir editor': 'Open editor', 'vagas abertas': 'open spots', 'obras amanhã': 'jobs tomorrow',
    // calendário
    'Dia': 'Day', '+ Novo agendamento': '+ New booking', 'Quantas pessoas': 'How many people', 'Repetir até (opcional)': 'Repeat until (optional)',
    'Pular sábado e domingo': 'Skip Saturday and Sunday', 'Agendar': 'Book', 'sobra gente': 'extra crew', 'quase no limite': 'almost full', 'faltam': 'short',
    '· passe o mouse num dia': '· hover over a day', 'Mês anterior': 'Previous month', 'Próximo mês': 'Next month', '🌴 Day off': '🌴 Day off',
    'Toque num dia pra ver ou criar agendamentos. O agendamento já entra como obra na escala daquele dia; a equipe você monta depois.':
      'Tap a day to see or create bookings. The booking goes into that day\'s schedule as a job; you build the crew later.',
    'Dom': 'Sun', 'Seg': 'Mon', 'Ter': 'Tue', 'Qua': 'Wed', 'Qui': 'Thu', 'Sex': 'Fri', 'Sáb': 'Sat',
    // buscar
    'Buscar nas escalas': 'Search schedules', 'de': 'of', 'Digite um nome ou companhia. A busca ignora acentos e maiúsculas.': 'Type a name or company. The search ignores accents and capitals.',
    '⬇️ Baixar resultado (.csv)': '⬇️ Download result (.csv)', 'Nome do funcionário, companhia ou endereço': 'Worker name, company or address', 'O que buscar': 'What to search',
    'Buscar em': 'Search in', 'Período': 'Period', 'Buscar companhia ou endereço': 'Search company or address', 'Buscar obra': 'Search job',
    // cadastro / acesso
    'Pedidos de acesso': 'Access requests', 'Quem pode usar o app': 'Who can use the app', 'Liberar alguém novo': 'Add someone new', 'Liberar': 'Add',
    'Trabalhadores': 'Workers', 'Adicionar vários de uma vez': 'Add several at once', 'Adicionar todos': 'Add all', 'Veículos': 'Vehicles', '+ Veículo': '+ Vehicle',
    'Backup': 'Backup', 'Baixar escalas': 'Download schedules', 'Baixar cadastro': 'Download records', 'Backup completo (.json)': 'Full backup (.json)', 'Importar backup': 'Import backup',
    'Companhias': 'Companies', 'Saída do shop': 'Shop departure', 'Endereço da empresa': 'Company address', '🖥️ Abrir modo Totem (check-in)': '🖥️ Open kiosk mode (check-in)',
    '📺 Abrir Central (tela do escritório)': '📺 Open TV view (office screen)', 'Apagar o PIN da Central neste aparelho': 'Reset the TV view PIN on this device',
    'WhatsApp do patrão (quem recebe o relatório)': 'Boss\'s WhatsApp (who gets the report)', 'E-mail da pessoa': 'Person\'s email', 'Nome do trabalhador': 'Worker name',
    'Tipo': 'Type', 'Número': 'Number', 'Remover veículo': 'Remove vehicle', 'Remover endereço': 'Remove address', '+ endereço': '+ address', '🏢 Office': '🏢 Office',
    'Endereço do office/shop (se a companhia pedir)': 'Office/shop address (if the company asks)', 'Foto': 'Photo',
    'O endereço salvo aqui entra sozinho quando você escolhe a companhia na obra.': 'The address saved here fills in automatically when you choose the company on the job.',
    // janelas
    'Versões': 'Versions', 'Ver o que vai entrar': 'See what will come in', 'Copiar obras': 'Copy jobs', 'Marque as obras que vão se repetir neste dia.': 'Check the jobs that repeat on this day.',
    'Marcar todas': 'Check all', 'Desmarcar todas': 'Uncheck all', 'Copiar as marcadas': 'Copy the checked ones', 'Voltar pra esta': 'Go back to this one',
    '📋 Recriar a escala colando a mensagem do WhatsApp': '📋 Rebuild the schedule by pasting the WhatsApp message',
    'Cole aqui a mensagem do WhatsApp…': 'Paste the WhatsApp message here…', 'Ex.: 5': 'E.g.: 5', 'Ex.: Gate Code, levar roupa…': 'E.g.: Gate Code, bring clothes…',
    'Rua, cidade, MA (pode deixar vazio se ainda não souber)': 'Street, city, MA (leave empty if you don\'t know yet)', 'Ex.: 25.00': 'E.g.: 25.00',
    // toasts
    'Coloque a entrada e a saída da turma': 'Enter the crew\'s time in and time out', 'Coloque pelo menos um nome': 'Enter at least one name', 'Falta o Bill To (companhia)': 'Bill To (company) is missing',
    '✓ Rascunho salvo': '✓ Draft saved', 'Enviada. O número sai quando a internet firmar.': 'Sent. It\'ll get its number once the connection is stable.',
    'Sem internet: a T&M foi guardada e recebe o número quando a internet voltar.': 'No internet: the T&M is saved and will get its number once you\'re back online.',
    'Sem internet: guardado no aparelho, envia quando voltar': 'No internet: saved on this device, it\'ll send when you\'re back online', 'Lista ajustada pela presença marcada': 'List updated from attendance',
    'Esta T&M foi enviada em outro aparelho': 'This T&M was sent from another device', 'Destrancada: corrija e envie de novo': 'Unlocked: fix it and send again', 'Não achei essa T&M': 'I couldn\'t find this T&M',
    'O navegador bloqueou a janela do PDF. Libere pop-ups pra este site.': 'The browser blocked the PDF window. Allow pop-ups for this site.', 'Mensagem copiada': 'Message copied',
    'Mensagem copiada. Cole no WhatsApp': 'Message copied. Paste it in WhatsApp', 'Relatório copiado': 'Report copied', 'Foto apagada': 'Photo deleted', '✓ Excel baixado': '✓ Excel downloaded',
    'Nenhuma hora pra baixar neste período': 'No hours to download in this period', '✓ Valor salvo': '✓ Rate saved', 'Valor apagado': 'Rate deleted',
    'Tempo esgotado: abra os valores de novo': 'Time is up: open the rates again', 'Coloque um valor válido (ex.: 25.00)': 'Enter a valid amount (e.g.: 25.00)', 'Escolha a data': 'Choose the date',
    'PIN criado ✓': 'PIN created ✓', '✓ Mudanças feitas sem internet foram enviadas': '✓ Changes made offline were sent',
    'Esse login é só pra ver. Pra alterar, a TV precisa entrar com um login do escritório.': 'This sign-in is view-only. To make changes, the TV must sign in with an office account.',
    'Coloque o nome da companhia': 'Enter the company name', 'Marque pelo menos uma obra': 'Check at least one job', 'Não tem obra pra copiar': 'There is no job to copy',
    // textos longos (acesso / cadastro / janelas)
    'Essas pessoas criaram conta no app e estão esperando. Escolha o que cada uma pode fazer e toque em': 'These people created an account in the app and are waiting. Choose what each one can do and tap',
    'Marque o que cada pessoa pode fazer. Sem nada marcado, a pessoa só': 'Check what each person can do. With nothing checked, the person only',
    'vê': 'sees', 'a escala e copia a mensagem. As mudanças valem na hora (a pessoa só precisa reabrir o app).': 'the schedule and copies the message. Changes apply right away (the person just needs to reopen the app).',
    'Depois de liberar, a pessoa abre o app, toca em "Primeiro acesso" e cria a própria senha.': 'After giving access, the person opens the app, taps "First access" and creates their own password.',
    'Cole um por linha. O telefone é opcional, no final da linha. Exemplo:': 'Paste one per line. The phone is optional, at the end of the line. Example:',
    'Toque em': 'Tap', 'pra marcar quem é motorista/responsável: quando estiver escalado numa obra, ele vê o painel da obra dele (presença e fotos), mesmo indo de carro próprio. Gente extra do dia não precisa estar aqui: dá pra digitar o nome direto na obra.':
      'to mark who is a driver/in charge: when scheduled on a job, they see their job panel (attendance and photos), even going in their own car. Extra people of the day don\'t need to be here: you can type the name right on the job.',
    'O botão "📊 Enviar pro patrão", na escala, abre o WhatsApp já nesse contato com o resumo do dia.': 'The "📊 Send to the boss" button, in the schedule, opens WhatsApp on this contact with the day summary.',
    'Na obra, digite os minutos de viagem (use "Conferir no Google Maps"). O tempo fica salvo pra aquele endereço. Horário do shop = start − minutos antes (escolhidos em cada obra) − tempo de viagem, arredondado pra baixo de 5 em 5.':
      'On the job, type the travel minutes (use "Check on Google Maps"). The time is saved for that address. Shop time = start − minutes early (chosen on each job) − travel time, rounded down to 5 minutes.',
    'Salva planilhas (.csv) que abrem no Excel ou Google Sheets. "Escalas" traz todos os dias: data, obra, endereço, horários, pessoa e veículo. Guarde uma cópia toda semana. O backup completo (.json) serve pra restaurar tudo no app (cadastro, escalas e presença/faltas).':
      'Saves spreadsheets (.csv) that open in Excel or Google Sheets. "Schedules" has every day: date, job, address, times, person and vehicle. Keep a copy every week. The full backup (.json) restores everything in the app (records, schedules and attendance).',
    'O app guarda uma foto da escala a cada 5 minutos de edição. Toque em "Voltar pra esta" pra desfazer uma bagunça.': 'The app keeps a snapshot of the schedule every 5 minutes of editing. Tap "Go back to this one" to undo a mess.',
    'Cole a mensagem que foi pro grupo (do jeito que o app gerou). O app lê as obras, endereços, horários e equipes.': 'Paste the message that went to the group (the way the app made it). The app reads the jobs, addresses, times and crews.',
    '(Esperando endereço) ·': '(Address TBD) ·',
    // confirm (linhas)
    '⚠️ Está SEM assinatura do cliente.': '⚠️ There\'s NO customer signature.', 'Depois de enviada ela fica trancada.': 'Once it\'s sent, it gets locked.'
  };

  // ---------- frases com partes que mudam (nomes, números, dias) ----------
  const WD = { 'domingo': 'Sunday', 'segunda': 'Monday', 'terça': 'Tuesday', 'quarta': 'Wednesday', 'quinta': 'Thursday', 'sexta': 'Friday', 'sábado': 'Saturday' };
  const WDF = { 'Domingo': 'Sunday', 'Segunda-feira': 'Monday', 'Terça-feira': 'Tuesday', 'Quarta-feira': 'Wednesday', 'Quinta-feira': 'Thursday', 'Sexta-feira': 'Friday', 'Sábado': 'Saturday' };
  const WDS = { 'dom': 'Sun', 'seg': 'Mon', 'ter': 'Tue', 'qua': 'Wed', 'qui': 'Thu', 'sex': 'Fri', 'sáb': 'Sat' };
  const MON = { 'Janeiro': 'January', 'Fevereiro': 'February', 'Março': 'March', 'Abril': 'April', 'Maio': 'May', 'Junho': 'June', 'Julho': 'July', 'Agosto': 'August', 'Setembro': 'September', 'Outubro': 'October', 'Novembro': 'November', 'Dezembro': 'December' };
  const wdLow = s => s.replace(/\b(domingo|segunda|terça|quarta|quinta|sexta|sábado)\b/gi, m => WD[m.toLowerCase()] || m);
  const pl = (n, a, b) => (+n === 1 ? a : b);
  const RX = [
    [/^(\d+) obras? · (\d+) pessoas?$/, (m, a, b) => a + ' ' + pl(a, 'job', 'jobs') + ' · ' + b + ' ' + pl(b, 'person', 'people')],
    [/^(\d+) de (\d+)$/, '$1 of $2'], [/^(Subir|Descer|Tirar) (.+)$/, (m, a, n) => ({ 'Subir': 'Move up', 'Descer': 'Move down', 'Tirar': 'Remove' })[a] + ' ' + n],
    [/^✓ Nomes puxados da presença \(quem veio\)\.(?: Faltaram \(fora da folha\): (.+)\.)?$/, (m, f) => '✓ Names pulled from attendance (who showed up).' + (f ? ' No-shows (left off the sheet): ' + f + '.' : '')],
    [/^(\d+) de (\d+) ✓$/, '$1 of $2 ✓'], [/^(\d+) de (\d+) · falta (\d+)$/, '$1 of $2 · short $3'], [/^(\d+) de (\d+) · sobra (\d+)$/, '$1 of $2 · $3 extra'],
    [/^(\d+) de (\d+) vieram ·$/, '$1 of $2 here ·'], [/^faltou: (.+)$/, 'no-show: '], [/^· (\d+) sem marcar$/, '· $1 not marked'],
    [/^⏱ (.+) atrasada$/, '⏱ $1 late'], [/^(\d+) min$/, '$1 min'],
    [/^Shop automático: start − (\d+) min antes − (\d+) min de viagem · chegada na obra (.+)$/, 'Auto shop time: start − $1 min early − $2 min drive · on site $3'],
    [/^📋 Copiar pra (\S+)$/, (m, d) => '📋 Copy to ' + (WD[d] || d)],
    [/^(Domingo|Segunda-feira|Terça-feira|Quarta-feira|Quinta-feira|Sexta-feira|Sábado)( · hoje)?$/, (m, d, h) => WDF[d] + (h ? ' · today' : '')],
    [/^(Domingo|Segunda-feira|Terça-feira|Quarta-feira|Quinta-feira|Sexta-feira|Sábado), (\d\d)\/(\d\d)$/, (m, d, a, b) => WDF[d] + ', ' + b + '/' + a],
    [/^(DOMINGO|SEGUNDA-FEIRA|TERÇA-FEIRA|QUARTA-FEIRA|QUINTA-FEIRA|SEXTA-FEIRA|SÁBADO)( · HOJE)?$/i, (m, d, h) => (WDF[d.charAt(0) + d.slice(1).toLowerCase()] || d) + (h ? ' · today' : '')],
    [/^(domingo|segunda|terça|quarta|quinta|sexta|sábado) (\d\d)\/(\d\d)$/, (m, d, a, b) => WD[d] + ' ' + b + '/' + a],
    [/^(dom|seg|ter|qua|qui|sex|sáb)$/, (m, d) => WDS[d]], [/^(dom|seg|ter|qua|qui|sex|sáb) (\d\d\/\d\d)$/, (m, d, x) => WDS[d] + ' ' + x],
    [/^(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro) (\d{4})$/, (m, a, y) => MON[a] + ' ' + y],
    [/^(Veículo|Subir|Descer|Tirar|Telefone|Remover|Office|Endereço) de (.+)$/, (m, a, n) => ({ 'Veículo': 'Vehicle of', 'Subir': 'Move up', 'Descer': 'Move down', 'Tirar': 'Remove', 'Telefone': 'Phone of', 'Remover': 'Remove', 'Office': 'Office of', 'Endereço': 'Address of' })[a] + ' ' + n],
    [/^Remover (.+)$/, 'Remove $1'], [/^Motorista fixo do (.+)$/, 'Regular driver of $1'],
    [/^No total faltam (\d+) pessoas?\. Ainda tem (\d+) livres? no cadastro pra completar\.$/, (m, a, b) => 'Short ' + a + ' ' + pl(a, 'person', 'people') + ' overall. ' + b + ' ' + pl(b, 'worker is', 'workers are') + ' still available.'],
    [/^No total faltam (\d+) pessoas?\.(.*)$/, 'Short $1 overall.$2'],
    [/^(.+): chegou atrasado no shop: (.+)$/, '$1: arrived late at the shop: $2'], [/^(.+): chegaram atrasados no shop: (.+)$/, '$1: arrived late at the shop: $2'],
    [/^(.+): (.+) faltou \(confirmado pelo motorista\)$/, '$1: $2 no-show (confirmed by driver)'],
    [/^(.+): falta (\d+) pessoas? \((\d+) de (\d+)\)$/, '$1: short $2 ($3 of $4)'], [/^(.+): sem endereço$/, '$1: no address'],
    [/^(\d+) de (\d+) despachadas$/, '$1 of $2 dispatched'], [/^(\d+) de (\d+) avisados$/, '$1 of $2 notified'], [/^Enviar pra (.+) →$/, 'Send to $1 →'],
    [/^(\d+) sem telefone: complete abaixo\.$/, '$1 without phone: fill in below.'], [/^(\d+) fixos$/, '$1 regulars'], [/^(\d+) endereços?$/, (m, n) => n + ' ' + pl(n, 'address', 'addresses')],
    [/^(.*) · (\d+) pessoas?(.*)$/, (m, a, n, r) => a + ' · ' + n + ' ' + pl(n, 'person', 'people') + r],
    [/^(\d+) obras? · (\d+) pessoas?$/, (m, a, b) => a + ' ' + pl(a, 'job', 'jobs') + ' · ' + b + ' ' + pl(b, 'person', 'people')],
    [/^(.+) · falta (\d+) pessoas?$/, '$1 · short $2'], [/^hoje · página (\d+) de (\d+)$/, 'today · page $1 of $2'], [/^página (\d+) de (\d+)$/, 'page $1 of $2'],
    [/^(.+) · faltam (\d+)$/, '$1 · $2 missing'], [/^falta (\d+)$/, '$1 missing'],
    [/^(\d+) de (\d+) marcados · salvo às (.+)$/, '$1 of $2 marked · saved at $3'], [/^(\d+) de (\d+) marcados$/, '$1 of $2 marked'],
    [/^Faltaram \(fora da folha\): (.+)\.$/, 'No-shows (left off the sheet): $1.'], [/^(.+) — marque em "Quem veio hoje\?"\.$/, '$1 — mark them in "Who showed up today?".'],
    [/^Nome (\d+)$/, 'Name $1'], [/^Entrada (\d+)$/, 'Time in $1'], [/^Saída (\d+)$/, 'Time out $1'], [/^Almoço (\d+)$/, 'Lunch $1'],
    [/^(\d+) folhas? · (\d+) funcionários? ·$/, (m, a, b) => a + ' ' + pl(a, 'sheet', 'sheets') + ' · ' + b + ' ' + pl(b, 'worker', 'workers') + ' ·'],
    [/^⚠️ (\d+) rascunhos? ainda não enviados? \(fora da conta\)$/, (m, n) => '⚠️ ' + n + ' ' + pl(n, 'draft', 'drafts') + ' not sent yet (not counted)'],
    [/^total (.+)$/, 'total $1'], [/^Falta horário de: (.+)$/, 'Missing time for: $1'], [/^✓ T&M (.+) enviada$/, '✓ T&M $1 sent'],
    [/^T&M excluída · registrado: (.+)$/, 'T&M deleted · recorded: $1'], [/^Não consegui (.+) \((.+)\)\.?$/, 'Couldn\'t do it ($2)'],
    [/^Não consegui salvar: (.+)$/, 'Couldn\'t save: $1'], [/^Enviar a T&M de (.+)\?$/, 'Send the T&M of $1?'],
    [/^(\d+) pessoas? · TMH (.+)$/, (m, n, t) => n + ' ' + pl(n, 'person', 'people') + ' · TMH ' + t],
    [/^⚠️ Sem presença marcada e fora da folha: (.+)$/, '⚠️ Attendance not marked and left off the sheet: $1'],
    [/^Signature · enviada (.+)$/, 'Signature · sent $1'], [/^shop (.+)$/, 'shop $1'], [/^(.+) a partir de (.+)$/, '$1 starting $2'], [/^desde (.+)$/, 'since $1'],
    [/^(.+)\/h desde (.+)$/, '$1/h since $2'], [/^Valor atual: (.+)\/h\. O novo entra na próxima segunda \((.+)\), a não ser que você mude a data\.$/, 'Current rate: $1/h. The new one starts next Monday ($2), unless you change the date.'],
    [/^Primeiro valor: já vale desde a segunda desta semana \((.+)\)\. Mude a data se precisar\.$/, 'First rate: valid since this week\'s Monday ($1). Change the date if needed.'],
    [/^💲 Total a pagar: (.+)$/, '💲 Total to pay: $1'], [/^⚠️ sem valor cadastrado: (.+) \(fora do total\)$/, '⚠️ no rate set: $1 (not in the total)'],
    [/^(.+): (.+)\/h a partir de (.+)\?$/, '$1: $2/h starting $3?'], [/^Apagar o valor de (.+): (.+)\/h a partir de (.+)\?$/, 'Delete the rate of $1: $2/h starting $3?'],
    [/^Folha de (.+) · excluída (.+) por$/, 'Sheet of $1 · deleted $2 by'], [/^Motivo: (.+)$/, 'Reason: $1'],
    [/^(\d+) obras$/, '$1 jobs'], [/^🌴(\d+)$/, '🌴$1']
  ];

  function tr(s) {
    const k = s.replace(/\s+/g, ' ').trim(); if (!k) return null;
    let v = EN[k];
    if (v == null) for (const [r, rep] of RX) { if (r.test(k)) { v = k.replace(r, rep); break; } }
    if (v == null || v === k) return null;
    return s.replace(s.trim(), v);
  }
  window.t = s => (L === 'en' ? (tr(s) || s) : s);
  if (L !== 'en') return;
  document.documentElement.lang = 'en';

  const SKIP = '#preview,#rpPreview,textarea,script,style,option,datalist';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function doText(n) { const p = n.parentElement; if (!p || p.closest(SKIP)) return; const v = (n.nodeValue.trim() === 'de' && p.closest('label')) ? n.nodeValue.replace('de', 'from') : tr(n.nodeValue); if (v != null && v !== n.nodeValue) n.nodeValue = v; }
  function doEl(el) {
    if (el.closest && el.closest('#preview,#rpPreview')) return;
    ATTRS.forEach(a => { const o = el.getAttribute && el.getAttribute(a); if (o) { const v = tr(o); if (v != null && v !== o) el.setAttribute(a, v); } });
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(SKIP)) return;
    doEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
  }
  const mo = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doEl(m.target);
    }
  });
  const start = () => { walk(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // confirm / prompt / alert: traduz linha por linha
  const lines = s => String(s).split('\n').map(x => (x.trim() ? (tr(x) || x) : x)).join('\n');
  const oc = window.confirm.bind(window), op = window.prompt.bind(window), oa = window.alert.bind(window);
  window.confirm = m => oc(lines(m)); window.prompt = (m, d) => op(lines(m), d); window.alert = m => oa(lines(m));
})();

/* botão de idioma (no topo, ao lado do Sair, e na tela de login) */
(function () {
  const mk = () => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn langbtn';
    b.textContent = window.LANG === 'en' ? '🇧🇷 PT' : '🇺🇸 EN'; b.title = window.LANG === 'en' ? 'Mudar pra português' : 'Switch to English';
    b.onclick = () => window.setLang(window.LANG === 'en' ? 'pt' : 'en'); return b; };
  const place = () => {
    const out = document.getElementById('logout2'); if (out && !document.getElementById('langTop')) { const b = mk(); b.id = 'langTop'; out.after(b); }
    document.querySelectorAll('.authcard').forEach(c => { if (!c.querySelector('.langbtn')) { const b = mk(); b.classList.add('langauth'); c.appendChild(b); } });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
})();
