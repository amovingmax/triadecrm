# Ligação pelo WhatsApp (Calling API da Meta)

Receber e fazer ligações pelo número de WhatsApp da empresa, de dentro do CRM. Hoje no navegador; o app entra depois, com o mesmo banco e a mesma ativação na Meta.

**Só na Imova.** A KOMUNE liga pela Twilio (`telefonia-twilio.md`), e as duas não se tocam. Há três travas: o módulo `ligacaoWhatsapp` em `packages/schema/src/empresas.ts`, a função `app.wa_ligacao_ligada()` (que só liga no banco da Imova, mesmo com a chave gravada à força) e a chave `app_settings['whatsapp.ligacao']`, que nasce desligada.

## Como funciona

**O cliente liga**

1. O cliente toca no ícone de telefone na conversa com a empresa.
2. A Meta avisa o `wa-webhook` (campo `calls`). O evento não passa pela fila `wa_inbound`: a Meta dá de 30 a 60 s para atender, então `public.wa_chamada_eventos` grava direto e o Realtime leva à tela.
3. Toca para todos que estão com o CRM aberto (`ligacao-whatsapp/provedor.tsx`). O primeiro que clicar em Atender fica com a ligação (`wa_chamada_atender`), e os outros param de tocar.
4. O navegador responde à oferta da Meta pela Edge Function `wa-chamada`: `pre_accept`, conexão de áudio, `accept`. O microfone só abre depois do 200 do `accept`.
5. **Ninguém atendeu** (03/11/2026): a ligação fica `perdida`. Quem viu tocar e não clicou em Ignorar recebe o aviso "Ligação perdida às 10:21" no alto da tela, com "Abrir conversa", e o aviso do sistema se a aba estiver escondida. Para todos, a conversa sobe para o topo de Conversas e da aba Clientes, entra em "Minhas" mesmo sem dono e leva o selo coral "Ligação perdida · 10:21" (`public.wa_ligacoes_perdidas`, `ligacao-whatsapp/perdidas.tsx`). O selo sai quando alguém do time escreve (mensagem que não falhou) ou liga de volta, ou quando o cliente liga de novo e alguém atende; depois de 30 dias, sai sozinho. A conversa concluída volta para a lista quando o cliente liga (`app.wa_chamadas_desarquiva`). Nada disso mexe em `messages`, em `last_message_at` (que faria a IA reler a conversa) ou na janela de 24 h.

**A empresa liga**

1. A pessoa pede permissão na conversa (`wa_permissao_pedir`). O pedido é uma mensagem na fila, enviada pelo worker como `call_permission_request`.
2. O cliente responde. A resposta chega como mensagem (`call_permission_reply`), mas não vira mensagem no CRM: atualiza `wa_permissoes_de_ligar`, e o botão vira "Ligar".
3. A oferta sai do navegador pela `wa-chamada` (`connect`). A resposta da Meta volta pelo webhook e chega ao navegador pelo Realtime.

O áudio vai direto entre o navegador e a Meta. Não há gravação.

O número do cliente nunca chega à tela: o SDR vê o telefone mascarado, então só `wa_chamada_para_meta`, que é do serviço, o entrega à `wa-chamada`.

## A ligação no app do iPhone (tela de chamada, 23/11/2026)

Pedido do usuário (23/11/2026): "o celular [precisa] receber ligações com o app fechado [...] uma interface para aceitar ou rejeitar chamada, assim como a do WhatsApp, e [...] um toque que seja audível".

A partir do app **1.1.0**, a ligação do cliente toca no iPhone de cada pessoa da equipe na **tela de chamada do próprio iPhone** (CallKit): em tela cheia com o celular bloqueado, ou no aviso de chamada no alto com ele desbloqueado, com **Atender** e **Recusar** e o **toque de ligação do iPhone**, no volume da campainha (no modo silencioso, vibra). Funciona com o app fechado. Atendendo, a conversa é no próprio iPhone; com o app aberto, aparece por cima do CRM uma tela com o nome, o tempo, Mudo, Alto-falante, Ver conversa e Desligar.

**Como funciona**

```
cliente liga no WhatsApp ──► Meta ──► wa-webhook ──► wa_chamadas (tocando)
                                                        │ gatilho wa_chamadas_cutucar_aparelhos (pg_net)
                                                        ▼
                         voip-push ── pergunta ao banco (voip_a_enviar): quem toca, um convite por aparelho
                             │
                             └──► Apple (aviso de VOZ, PushKit, topic app.triade.ios.voip)
                                        │
                     iPhone acorda o app ▼  CallKit: tela de chamada, toque
                     Atender ──► wa-chamada-app (convite): atender → oferta da Meta
                                 WebRTC nativo → pre_aceitar → aceitar → microfone liberado
                                 estado a cada 3 s (o cliente desligou?) · encerrar ao desligar
alguém atendeu / o cliente desistiu / ninguém atendeu ──► gatilho ──► voip-push ──► "parar" nos outros iPhones
```

- **Toca para quem atende** (admin, gestor e SDR ativos, a mesma lista do aviso "está ligando"), em todos os iPhones com o app 1.1.0 ou mais novo. Quem desligou "Cliente ligando" em Avisos no celular não recebe a chamada.
- **O primeiro que atender leva**, pelo celular ou pelo computador; os outros iPhones param de tocar ("atendida em outro aparelho").
- **Recusar só para de tocar no próprio iPhone.** A ligação continua tocando para o resto da equipe; se ninguém atender, vira perdida, como hoje. O app avisa o servidor (`recusar`), que não manda "parar" a esse aparelho. (Decisão de projeto: com a equipe inteira tocando, recusar não derruba a ligação para todos. Recusar para o cliente seria outra regra.)
- **Tocando, o iPhone confere sozinho:** a cada 3 s pergunta ao servidor, com o convite, se a ligação ainda toca, e desiste em 60 s. Um "parar" perdido não deixa o celular tocando.
- **Atender com o iPhone bloqueado funciona com o app fechado.** Por isso o áudio é todo nativo (`apps/app/modules/triade-chamada/ios`): no Expo 58 o React Native só sobe quando o app abre numa tela, e quem atende pela tela bloqueada não abre o app.
- **O microfone** é pedido ao entrar no CRM da Imova pelo app (com o iPhone bloqueado não há como perguntar). Sem ele, a ligação volta a tocar para quem está com o CRM aberto e a tela do app diz como liberar.
- **Sem telefone no aviso.** O aviso de voz leva o nome que a conversa mostra, a conversa e um **convite** de 32 bytes, de uso de um aparelho e de uma ligação (o banco guarda só o hash, `app.voip_convites`). É ele que deixa o app atender sem a sessão do site (`public.wa_chamada_app`, só para o serviço).
- **O aviso comum "está ligando"** não vai ao aparelho que já toca na tela de chamada. "Ligação perdida" continua igual.
- **Dentro do app 1.1.0 a página não toca a recebida** (ela se identifica com `TriadeChamada/1` no user-agent, `chamadaNoAparelho`); no navegador e no app antigo, nada muda.
- **Na KOMUNE nada muda:** `app.voip_ligado()` depende de `app.wa_ligacao_ligada()`, que só liga no banco da Imova.

**A chave de avisos da Apple** é a "Aurora push" (`Q2FD3T3CSC`, equipe `8GF4F9C98L`), a mesma que o Expo usa para os avisos comuns do app (`~/.komune-secrets/AuthKey_Q2FD3T3CSC.p8`). Uma chave de avisos serve a todos os apps da equipe e aos dois tipos de aviso. Conferido em 23/11/2026: a Apple aceitou o JWT dela e o tópico `app.triade.ios.voip`, nos servidores de produção e de teste (resposta `BadDeviceToken` para um endereço inventado; com chave ou tópico errados a resposta seria 403 ou `TopicDisallowed`).

### Como ligar, em ordem (só com pedido)

1. **Banco da Imova:** `node scripts/publicar-banco.mjs imova migrar` (migração `20261124090000`). Nasce desligada: nada muda.
2. **Funções da Imova:** `supabase functions deploy voip-push wa-chamada-app --project-ref kkqadgxvmzulcamuakzk` (as duas com `verify_jwt = false` no `config.toml`).
3. **Segredos da Imova** (Supabase → Edge Functions → Secrets, ou `supabase secrets set --project-ref kkqadgxvmzulcamuakzk`): `APNS_CHAVE_P8` = o arquivo `.p8` em base64 numa linha (`base64 < AuthKey_Q2FD3T3CSC.p8 | tr -d '\n'`), `APNS_CHAVE_ID=Q2FD3T3CSC`, `APNS_EQUIPE_ID=8GF4F9C98L`. O `META_WA_ACCESS_TOKEN` e o `META_WA_PHONE_NUMBER_ID` já estão lá (a `wa-chamada` usa).
4. **Site da Imova:** publicar (rota `/api/aparelhos` com o endereço de chamada e a página que não toca dentro do app novo). A KOMUNE recebe o mesmo site, sem efeito.
5. **App 1.1.0 no TestFlight:** `eas build -p ios --profile producao --auto-submit` em `apps/app`. Não pede login na Apple: os modos de segundo plano (`voip`, `audio`) são do Info.plist, e o aviso de voz usa a mesma permissão de notificações que o perfil já tem.
6. **Cada pessoa** atualiza o Tríade pelo TestFlight, abre o app e entra na Imova (o app registra o endereço de chamada e pede o microfone).
7. **Ligar a chave:** `update public.app_settings set value = '{"ativa": true, "funcao_url": "https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1"}' where key = 'ligacao.app';`
8. **Teste entre celulares nossos:** com o app fechado e o iPhone bloqueado, ligar pelo WhatsApp para a Imova: toca, atende, fala, desliga. Repetir com dois iPhones da equipe: o segundo para de tocar quando o primeiro atende. Conferir em `app.voip_envios` (status 200 em cada aviso).

**Desligar:** `update public.app_settings set value = value || '{"ativa": false}' where key = 'ligacao.app';`. Volta na hora ao aviso comum "está ligando"; o app 1.1.0 não toca a recebida dentro da página, então, desligada a chave, o celular fica só com o aviso comum e o computador continua tocando.

**Onde olhar quando não toca:** `app.voip_envios` (um "tocar" por aparelho e ligação, com o status da Apple: 200 entregue; 400 `BadDeviceToken` = endereço do ambiente errado ou inventado; 410 = app apagado, o endereço é esquecido; 0 `sem_chave_da_apple` = faltam os segredos), `public.aparelhos_push.voip_token` (o iPhone entregou o endereço?) e os logs da função `voip-push`.

## Regras da Meta

| Regra | Valor |
| --- | --- |
| Limite de envio exigido para ativar | 2.000 destinatários por dia |
| Tempo para atender | de 30 a 60 s; depois o cliente vê "Não atendida" |
| Permissão temporária | 7 dias |
| Permissão permanente | até o cliente tirar |
| Pedidos de permissão | 1 por dia e 2 por semana por cliente; uma ligação completada zera a conta |
| Pedido sem resposta | vence em 7 dias |
| Sem resposta seguidas | com 2, o WhatsApp pergunta ao cliente; com 4, a permissão cai |
| Ligações completadas feitas pela empresa | 100 em 24 h |
| Baixa taxa de atendimento | e-mail e aviso, e a Meta pode esconder o botão; ele volta manualmente no Gerenciador |
| Muitos bloqueios e denúncias | restrição; a de chamadas recebidas dura 7 dias |
| Mudança de configuração | até 7 dias para aparecer no WhatsApp do cliente; o servidor da Meta já segue a nova |
| Custo | receber é grátis; ligar é cobrado em blocos de 6 s; o pedido segue a cobrança de mensagem |

Fontes: páginas `calling`, `user-initiated-calls`, `business-initiated-calls`, `user-call-permissions`, `call-settings`, `reference` e `troubleshooting` da documentação da Meta.

## Como ativar, em ordem

Passos de 1 a 5 feitos em 30/10/2026, e o passo 7 feito só para a empresa ligar. A chave segue desligada, e a chamada, `DISABLED` na Meta. Cada passo em produção só com pedido.

1. **Prova de ativação**, com o botão escondido, e desligar em seguida: `POST /<PHONE_NUMBER_ID>/settings` com `{"calling":{"status":"ENABLED","call_icon_visibility":"DISABLE_ALL","callback_permission_status":"DISABLED"}}`. O erro 138018 quer dizer que faltam pré-requisitos, provavelmente a inscrição do passo 5.
2. **Banco da Imova:** aplicar `20261030120000_a_ligacao_pelo_whatsapp.sql`.
3. **Funções da Imova:** publicar `wa-webhook` e `wa-chamada`, e gravar os segredos `META_WA_ACCESS_TOKEN` e `META_WA_PHONE_NUMBER_ID` (hoje eles só existem no Fly).
4. **Worker e site da Imova:** publicar o `imova-worker-wa` (leva o pedido de permissão) e o site, só o da Imova.
5. **Inscrever o app** "Imova CRM" no campo `calls` do webhook.
6. **Ligar a chave:** `node scripts/ligacao-whatsapp.mjs ligar`, que liga a chamada na Meta (botão escondido) e a chave no CRM. A janela de teste de 30/10 usou `janela`, que desliga sozinha em 30 minutos.
7. **Teste real** em uma janela combinada, entre celulares nossos.
8. **Abrir para os clientes:** `node scripts/ligacao-whatsapp.mjs abrir`. Antes, `abrir --ver` mostra o que vai para a Meta, sem mudar nada. Liga a chave do CRM e depois a Meta, com o botão visível aos clientes (`DEFAULT`) e **sempre disponível** (decisão de 03/11/2026: "Eu preciso que esse botão do ligar fique sempre disponível"): o horário de atendimento vai desligado, que a Meta trata como 24 horas, todos os dias, e sem feriados. O pedido de retorno vai ligado (`callback_permission_status`: depois de ligar, o WhatsApp pergunta ao cliente se a empresa pode ligar de volta). `abrir --horario` limita a segunda a sexta, das 8h às 19h (`America/Fortaleza`; se a Meta recusar o fuso, tenta Recife e São Paulo, que estão na mesma hora), com os feriados de segunda a sexta da tabela `holidays` (nacionais, do RN e de Natal, com os pontos facultativos; a Meta guarda até 20) fechados o dia inteiro; fora do horário o WhatsApp não oferece a ligação, mostra o próximo horário e a opção de mandar mensagem. `fechar` volta a só a equipe ligar. Atenção: `ligar` e `janela` também escondem o botão dos clientes. Sempre disponível, a ligação de madrugada ou no fim de semana só toca se alguém estiver com o CRM aberto; a que ninguém atende vira perdida, no topo da lista, e muita ligação sem atender faz a Meta esconder o botão.
9. **Renovar os feriados** (só com `--horario`): a Meta não aceita data passada e guarda até 20, então a lista acaba. `estado` avisa quando faltam menos de 60 dias; rodar `abrir --horario` de novo. A tabela `holidays` vai até dezembro de 2027.

### O teste com celulares nossos, depois de abrir

Com o CRM aberto no Chrome de quem atende, e o microfone liberado:

1. No celular de teste, abrir a conversa com a Imova e tocar no nome dela (os dados da empresa): isso atualiza o botão na hora, sem esperar os até 7 dias da Meta.
2. **Atendida:** ligar pelo ícone de telefone; o CRM toca para todos; atender, falar alguns segundos, desligar. A ficha ou a conversa recebe a ligação, e o número do cliente não aparece na tela.
3. **Perdida:** ligar e deixar tocar sem atender. Conferir o aviso "Ligação perdida", a conversa no topo de "Minhas" com o selo coral, e a pergunta do WhatsApp no celular sobre ligar de volta. Respondendo "sim", o botão "Ligar" aparece na conversa; ligar de volta tira o selo.
4. **De noite ou no fim de semana:** o botão continua lá. Com o CRM aberto, toca; com tudo fechado, vira perdida e aparece no topo da lista na manhã seguinte.
5. **Só com `--horario`:** depois das 19h, no sábado ou num feriado de segunda a sexta (o primeiro é 20/11/2026), o WhatsApp deve mostrar o próximo horário em vez de ligar.

## Testar no local, com as próprias mãos

Sem a Meta. Precisa do Supabase local da Imova (`~/triadecrm-imova-local`) com a migração aplicada e a chave ligada.

```bash
node supabase/functions/_dubles/meta-graph-duble.mjs servir 8790
node supabase/functions/_dubles/cliente-de-ligacao.mjs 3050
# em ~/triadecrm-imova-local, com as funções copiadas para supabase/functions:
supabase functions serve --no-verify-jwt --env-file <arquivo com META_WA_ACCESS_TOKEN=token-de-teste,
  META_WA_PHONE_NUMBER_ID=1234567890, META_WA_APP_SECRET=segredo-de-teste e
  META_WA_GRAPH_URL=http://host.docker.internal:8790>
# em apps/web, com o .env.local da Imova:
pnpm exec next dev -p 3040
```

O CRM fica em `http://localhost:3040/auth/dev?quem=gestor`, e o celular simulado do cliente em `http://127.0.0.1:3050`. O robô de entrada não roda aqui: a mensagem do cliente entra direto no banco, e o pedido de permissão é marcado como enviado quando o cliente responde.

## O que a Meta real já confirmou

Em 30/10/2026, antes de publicar, com um envio direto pela API para um WhatsApp nosso e a chamada ligada só durante o teste:

- o pedido, na forma que o worker monta, foi enviado, entregue e lido em segundos, e sem cobrança dentro das 24 h (`free_customer_service`, `billable: false`);
- a resposta real passou por `extrairDaMeta`: vira o evento `permissao` e nada entra na fila. Na permissão sem prazo, `expiration_timestamp` não vem;
- fora das 24 h a Meta aceita o envio e só depois recusa, por recibo com o erro 131047. Na tela isso não acontece, porque o botão fica desligado fora da janela.

Ainda em 30/10/2026, já com a versão publicada e a chave ligada por 30 minutos:

- o pedido saiu pelo CRM, foi aceito no celular e a resposta chegou ao CRM pelo `wa-webhook` novo; o botão virou "Ligar";
- duas ligações feitas pelo navegador foram atendidas e encerradas sem erro, de 12 s e de 130 s: a Meta aceitou o SDP do Chrome, e a conexão subiu na rede de quem testou;
- 34 entregas da Meta passaram pelo `wa-webhook` novo, com 9 mensagens recebidas.

Uma permissão que existe na Meta e o CRM não viu (a resposta veio antes desta versão, ou o aviso se perdeu): se ainda houver limite de pedidos, a Meta recusa com 138017, e `app.wa_permissoes_conferir_pedidos`, pelo pg_cron a cada minuto, passa a conversa para "aceita, sem prazo". Se o limite estiver gasto, a Meta responde 138009 antes, e o botão fica preso por 24 h. Qualquer outra falha do pedido devolve o botão. Não há gatilho em `messages`.

## O que não foi provado

- **O cliente ligar para a empresa, com a Meta real.** Só a empresa ligou: o botão segue escondido dos clientes. O caminho está provado só com o dublê (`_dubles/meta-graph-duble.mjs`) e, a ligação perdida, no Chrome real contra o banco local (03/11/2026).
- **O formato do horário na Meta.** `call_hours` foi montado pela documentação (`call-settings`): o fuso `America/Fortaleza` e os feriados com `start_time`/`end_time` só se confirmam quando `abrir` passar e `estado` mostrar o que a Meta guardou.
- **Outras redes.** A Meta diz que STUN e TURN não são obrigatórios, e `webrtc.ts` não usa nenhum; rede que bloqueie UDP pode exigir um servidor TURN.

## O que falta

- **Pedir permissão fora das 24 h:** exige um modelo aprovado pela Meta com `call_permission_request`. Hoje a tela diz que só dá para pedir dentro da janela.
- **Relatório do dia por pessoa:** a ligação pelo WhatsApp entra na linha do tempo da ficha, mas não em `ligacoes_do_dia`, que conta `call_attempts`.
- **Aviso de `USER_INITIATED_CALLS_LOW_PICKUP_RATE`:** o `account_update` já chega ao CRM, mas não vira alerta na tela.
- **App:** feito em 23/11/2026 no app 1.1.0 (ver "A ligação no app do iPhone"); falta publicar e o teste entre celulares. Android não tem tela de chamada (não há build do Android).
- **Chave em Ajustes:** hoje ela é ligada pelo Terminal, com `node scripts/ligacao-whatsapp.mjs estado | ligar | abrir | fechar | desligar | janela`, que mexe na Meta e no CRM juntos.
- **Tocar com o CRM fechado:** no computador, o toque depende de uma aba do CRM aberta. No iPhone, com o app 1.1.0, toca com tudo fechado.
