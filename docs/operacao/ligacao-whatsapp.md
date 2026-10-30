# Ligação pelo WhatsApp (Calling API da Meta)

Receber e fazer ligações pelo número de WhatsApp da empresa, de dentro do CRM. Hoje no navegador; o app entra depois, com o mesmo banco e a mesma ativação na Meta.

**Só na Imova.** A KOMUNE liga pela Twilio (`telefonia-twilio.md`), e as duas não se tocam. Há três travas: o módulo `ligacaoWhatsapp` em `packages/schema/src/empresas.ts`, a função `app.wa_ligacao_ligada()` (que só liga no banco da Imova, mesmo com a chave gravada à força) e a chave `app_settings['whatsapp.ligacao']`, que nasce desligada.

## Como funciona

**O cliente liga**

1. O cliente toca no ícone de telefone na conversa com a empresa.
2. A Meta avisa o `wa-webhook` (campo `calls`). O evento não passa pela fila `wa_inbound`: a Meta dá de 30 a 60 s para atender, então `public.wa_chamada_eventos` grava direto e o Realtime leva à tela.
3. Toca para todos que estão com o CRM aberto (`ligacao-whatsapp/provedor.tsx`). O primeiro que clicar em Atender fica com a ligação (`wa_chamada_atender`), e os outros param de tocar.
4. O navegador responde à oferta da Meta pela Edge Function `wa-chamada`: `pre_accept`, conexão de áudio, `accept`. O microfone só abre depois do 200 do `accept`.

**A empresa liga**

1. A pessoa pede permissão na conversa (`wa_permissao_pedir`). O pedido é uma mensagem na fila, enviada pelo worker como `call_permission_request`.
2. O cliente responde. A resposta chega como mensagem (`call_permission_reply`), mas não vira mensagem no CRM: atualiza `wa_permissoes_de_ligar`, e o botão vira "Ligar".
3. A oferta sai do navegador pela `wa-chamada` (`connect`). A resposta da Meta volta pelo webhook e chega ao navegador pelo Realtime.

O áudio vai direto entre o navegador e a Meta. Não há gravação.

O número do cliente nunca chega à tela: o SDR vê o telefone mascarado, então só `wa_chamada_para_meta`, que é do serviço, o entrega à `wa-chamada`.

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

Passos de 1 a 5 feitos em 30/10/2026; a chave segue desligada, e a chamada, `DISABLED` na Meta. Cada passo em produção só com pedido.

1. **Prova de ativação**, com o botão escondido, e desligar em seguida: `POST /<PHONE_NUMBER_ID>/settings` com `{"calling":{"status":"ENABLED","call_icon_visibility":"DISABLE_ALL","callback_permission_status":"DISABLED"}}`. O erro 138018 quer dizer que faltam pré-requisitos, provavelmente a inscrição do passo 5.
2. **Banco da Imova:** aplicar `20261030120000_a_ligacao_pelo_whatsapp.sql`.
3. **Funções da Imova:** publicar `wa-webhook` e `wa-chamada`, e gravar os segredos `META_WA_ACCESS_TOKEN` e `META_WA_PHONE_NUMBER_ID` (hoje eles só existem no Fly).
4. **Worker e site da Imova:** publicar o `imova-worker-wa` (leva o pedido de permissão) e o site, só o da Imova.
5. **Inscrever o app** "Imova CRM" no campo `calls` do webhook.
6. **Ligar a chave:** `update public.app_settings set value = '{"ativa": true}' where key = 'whatsapp.ligacao';`
7. **Teste real** em uma janela combinada, entre celulares nossos.
8. **Ativação definitiva**, no Gerenciador do WhatsApp (Ferramentas da conta > Números de telefone > engrenagem > Chamadas) ou pela API, com o horário de atendimento. Enquanto só houver o navegador, usar horário comercial: de madrugada ninguém está com o CRM aberto, e chamadas sem atender podem esconder o botão.

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

Uma permissão que existe na Meta e o CRM não viu (a resposta veio antes desta versão, ou o aviso se perdeu) se resolve no primeiro pedido: a Meta recusa com 138017, e `app.wa_permissoes_conferir_pedidos`, pelo pg_cron a cada minuto, passa a conversa para "aceita, sem prazo". Qualquer outra falha do pedido devolve o botão. Não há gatilho em `messages`.

## O que não foi provado

O ensaio local usa o dublê no lugar da Meta (`_dubles/meta-graph-duble.mjs`). Ele prova o caminho inteiro, com WebRTC e áudio de verdade no Chrome, mas o outro lado é outro navegador, e não o servidor de mídia da Meta. Só o teste real (passo 7) prova:

- que o SDP do Chrome é aceito pela Meta;
- que a conexão sobe nas redes de quem usa o CRM. A Meta diz que STUN e TURN não são obrigatórios, e `webrtc.ts` não usa nenhum; rede que bloqueie UDP pode exigir um servidor TURN;
- o texto e o desenho reais que o cliente vê, que a Meta não publica.

## O que falta

- **Pedir permissão fora das 24 h:** exige um modelo aprovado pela Meta com `call_permission_request`. Hoje a tela diz que só dá para pedir dentro da janela.
- **Relatório do dia por pessoa:** a ligação pelo WhatsApp entra na linha do tempo da ficha, mas não em `ligacoes_do_dia`, que conta `call_attempts`.
- **Aviso de `USER_INITIATED_CALLS_LOW_PICKUP_RATE`:** o `account_update` já chega ao CRM, mas não vira alerta na tela.
- **App:** tocar com o app fechado e a tela bloqueada exige aviso de chamada da Apple, CallKit e áudio nativo, porque o WKWebView perde o microfone em segundo plano (`app-celular.md`).
- **Chave em Ajustes:** hoje ela é ligada por SQL.
