# Telefonia — ligação pelo navegador (Twilio)

Como ligar, configurar, testar e desligar a ligação feita de dentro do CRM. A pessoa clica em
**Ligar**, fala pelo microfone do computador, e o telefone do parceiro toca como uma ligação comum.

Estado em 06/10/2026: código pronto e testado contra um dublê do Twilio. **Ainda não foi feita
nenhuma chamada real**, porque não existe conta. A telefonia nasce **desligada**; aplicar as
migrações não muda nada na tela.

## Como funciona

```
CRM (botão Ligar da ficha)
  └─ montar_lote_avulso → lote de um contato; abre a tela de ligar, com o roteiro
CRM (tela de ligar: fila do lote ou ligação da ficha)
  └─ iniciar_chamada    → abre a tentativa (reserva, janela, supressão)
  └─ voz_abrir_ligacao  → o banco disca o número reservado para a tentativa
  └─ voz-token          → credencial de 1 h, só de saída
navegador (SDK de voz, WebRTC) ──► Twilio
                                     └─ voz-twiml  → o banco confirma e entrega o número
                                     └─ liga para o telefone do parceiro
                                     └─ voz-status → tocou / atendeu / terminou
CRM lê o estado em voice_calls; o resultado é dado na tela de ligar (tabular_chamada)
```

- **Um padrão só.** A ligação da ficha e a do lote usam a mesma tela: a fala do roteiro, as
  respostas do parceiro como botões, a próxima pergunta e o resultado no fim. O botão **Ligar**
  da ficha monta um lote de um contato e abre essa tela; a chamada começa sozinha.
- **O número a discar nunca vem da tela.** A tela manda a tentativa; o banco entrega ao Twilio o
  número reservado para ela. (A tela de ligar mostra o número, como já mostrava, com o acesso
  registrado.)
- **A reserva vale.** Parceiro que está no lote de outra pessoa não é ligado pela ficha; se está
  num lote de turno de quem clicou, o aviso aponta o lote.
- **As travas são as do módulo de ligação**, aplicadas no banco: papel que escreve, janela de
  horário (seg–sex 9h–20h, sáb 10h–13h, nunca domingo ou feriado), parceiro que pediu para não
  ser procurado, e uma ligação por pessoa de cada vez. Só números do Brasil (+55).
- **O resultado é o de sempre**, dado na tela de ligar. Entra na linha do tempo e nas metas como
  qualquer ligação. Quando a chamada sai pelo navegador, a duração gravada é a da conversa (do
  atendimento ao fim), medida pelo provedor.
- **O painel da ligação** fica no alto da tela, em qualquer página: nome do parceiro, estado
  (Preparando chamada, Chamando, Tocando, Em ligação), tempo de conversa, Silenciar e Desligar.
- **Falhas têm título e frase**: Microfone bloqueado, Telefone inválido, Sem conexão, Fora do
  horário, Telefonia não configurada, entre outras. O código técnico fica só no banco.
- **Sem gravação.** Nada grava voz. Ligar a gravação depende de decisão do Dennis (base legal,
  aviso, retenção, quem ouve).

## O que criar no Twilio

1. **Conta** e, nela, um **número brasileiro com voz**. O Twilio pede documentação da empresa
   para número do Brasil (regulatory bundle); a aprovação leva dias.
2. **API Key** (Account → API keys → Create, tipo Standard). Guarde o SID (`SK…`) e o segredo,
   que só aparece uma vez.
3. **TwiML App** (Voice → TwiML Apps → Create):
   - Voice Request URL: `https://<ref-do-projeto>.supabase.co/functions/v1/voz-twiml`, método `POST`.
   - Guarde o SID (`AP…`).
   - O aviso de estado não é configurado aqui: o CRM manda a URL em cada chamada.
4. **Voice → Settings → Geo permissions**: deixe marcado só **Brasil**.
5. Recomendado: em Billing, um alerta de gasto e recarga automática desligada no começo.

## O que configurar no Supabase

Em **Edge Functions → Secrets** do projeto `komune-crm` (nunca na Vercel):

| Variável | Valor |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Account SID (`AC…`) |
| `TWILIO_API_KEY_SID` | SID da API Key (`SK…`) |
| `TWILIO_API_KEY_SECRET` | segredo da API Key |
| `TWILIO_AUTH_TOKEN` | Auth Token da conta |
| `TWILIO_TWIML_APP_SID` | SID do TwiML App (`AP…`) |
| `TWILIO_PHONE_NUMBER` | número de origem, em E.164 (`+5584…`) |
| `TWILIO_TWIML_URL` | opcional; a mesma URL cadastrada no TwiML App |
| `TWILIO_STATUS_CALLBACK_URL` | opcional; `…/functions/v1/voz-status` |

As duas URLs só precisam ser preenchidas se o endereço público for diferente de
`https://<ref>.supabase.co/functions/v1/…`. Elas entram na assinatura dos webhooks, então têm
de ser idênticas às que o Twilio chama.

Depois:

1. Aplicar as migrações `20261006090000`, `20261006090100` e `20261006090200`.
2. Publicar as funções `voz-token`, `voz-twiml` e `voz-status` (as duas últimas com
   `verify_jwt = false`, já declarado em `supabase/config.toml`).
3. Ligar a chave (gestor ou admin, pelo SQL Editor):

   ```sql
   update public.app_settings set value = '{"ativa": true}' where key = 'voz.telefonia';
   ```

   Para desligar, o mesmo comando com `false`. O botão **Ligar** some e o CRM volta ao modo
   manual (`tel:`); nenhum dado é perdido.

## Como testar uma chamada real

1. Abra a ficha de um parceiro de teste cujo telefone seja o seu celular, dentro do horário
   permitido.
2. Clique em **Ligar** e autorize o microfone. Abre a tela de ligar, com o roteiro.
3. O painel no alto mostra *Preparando chamada → Chamando → Tocando*; o celular toca.
4. Atenda: o painel passa a *Em ligação* e o tempo corre (`03:27`). Teste **Silenciar** e
   **Desligar**, e troque de tela no meio da conversa: a ligação continua.
5. Siga o roteiro tocando nas respostas e dê o resultado. A tela volta para a ficha, e a ligação
   aparece na linha do tempo, com quem ligou e a duração.
6. Repita sem atender (vira *Não atendida*) e recusando a chamada.

Na fila (`/ligar`), o botão **Ligar pelo navegador** faz o mesmo para o contato da vez.
**Ligar do aparelho** continua disponível nas duas.

## Como validar os webhooks

- No Twilio: Monitor → Logs → Calls mostra cada chamada e as requisições feitas a `voz-twiml` e
  `voz-status`, com o status HTTP. O esperado é `200` e `204`.
- No banco:

  ```sql
  select status, iniciada_em, tocou_em, atendida_em, encerrada_em, duracao_seg, error_code
    from public.voice_calls order by created_at desc limit 5;
  select event, event_at, error_code
    from public.voice_call_events order by id desc limit 10;
  ```

- Webhook falso: qualquer `POST` sem a assinatura do Twilio recebe `403` e fica no log da função.

## Como testar sem conta (desenvolvimento)

Com `supabase start` rodando e valores de teste em `supabase/functions/.env`:

```bash
# assinatura, credencial e TwiML (sem rede, sem banco)
docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
  deno test _compartilhado/twilio.test.ts

# banco: travas, idempotência, RLS
supabase test db --local supabase/tests/96_a_ligacao_sai_pelo_navegador.sql
supabase test db --local supabase/tests/97_ligar_da_ficha_com_roteiro.sql

# as duas portas do Twilio, com assinatura de verdade
export TWILIO_AUTH_TOKEN=<o mesmo valor de teste do .env das funções>
node supabase/functions/_dubles/twilio-duble.mjs twiml  <id da ligação> <id do usuário>
node supabase/functions/_dubles/twilio-duble.mjs estado <id da ligação> <perna-mãe> ringing
node supabase/functions/_dubles/twilio-duble.mjs estado <id da ligação> <perna-mãe> completed 42
node supabase/functions/_dubles/twilio-duble.mjs falso  <id da ligação> <perna-mãe> failed   # → 403
```

Para o Twilio de verdade alcançar a máquina local é preciso um túnel HTTPS para a porta 54321 e
as duas URLs `TWILIO_*_URL` apontando para ele.

## Onde está cada parte

| Parte | Arquivo |
| --- | --- |
| Tabelas, travas e funções | `supabase/migrations/20261006090100_a_ligacao_sai_pelo_navegador.sql` |
| Lote de um contato da ficha | `supabase/migrations/20261006090200_ligar_da_ficha_com_roteiro.sql` |
| Credencial do softphone | `supabase/functions/voz-token` |
| Para quem discar | `supabase/functions/voz-twiml` |
| Avisos de estado | `supabase/functions/voz-status` |
| Assinatura, credencial e TwiML | `supabase/functions/_compartilhado/twilio.ts` |
| Adaptador do SDK | `apps/web/src/components/ligacao/voz-softphone.ts` |
| Painel e estado da ligação | `apps/web/src/components/ligacao/voz-provedor.tsx` |
| Botão Ligar da ficha | `apps/web/src/components/ligacao/voz-botao-ligar.tsx` |
| Roteiro e resultado | `apps/web/src/components/ligacao/tela-chamada.tsx` (a tela que já existia) |

Trocar de provedor é trocar `voz-softphone.ts`, `_compartilhado/twilio.ts` e as três funções; o
banco e o resto da tela não conhecem o Twilio.
