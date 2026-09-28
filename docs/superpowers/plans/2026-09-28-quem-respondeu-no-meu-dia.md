# Quem respondeu entra no Meu dia, no topo — plano corrigido

## O buraco

Rafael, 28/09/2026: *"como o atendente saberá que é pra alguém assumir a conversa?"*

O fluxo novo: a campanha manda "Bom dia!", o lead responde, e 8 a 14 segundos depois sai a
introdução automática (`GEN-SYS-INTRO`, sem nome de atendente). A partir daí quem fala tem de ser
gente. O que acontece hoje, medido no banco:

- `app.wa_resposta_no_funil` leva o negócio para **Respondeu** e registra a interação. Funciona.
- A conversa aparece na aba **Responderam** (`filaDeQuemRespondeu`), com badge de não lida.
- E acabou. A conversa fica **sem dono** de propósito (é ela sem dono que deixa a introdução sair:
  a recusa `a_conversa_ja_tem_dono` de `app.wa_introduzir`), nenhuma tarefa nasce, e `public.meu_dia`
  **não lê conversa nenhuma** — ela é feita de negócio e tarefa.

Se ninguém abrir a tela de Conversas por conta própria, o lead que respondeu fica esperando.

**A escolha do Rafael:** a conversa que respondeu e está sem dono entra no Meu dia, no topo. Sem
precisar de dono. Distribuir/criar tarefa e notificação no navegador ficam para depois.

---

## Os 12 defeitos do plano anterior, todos medidos nos arquivos

**Nomes e SQL que não existem**

1. **`select like_(...)` não existe.** pgTAP tem `alike` (LIKE) e `matches` (regex). O repositório
   usa `alike` (`supabase/tests/25_confirmacao_de_optout_estreita.sql:408`,
   `32_recontato_e_miudezas.sql:406`). `like_` derruba o arquivo inteiro.
2. **`returns setof public.meu_dia` é inválido.** `public.meu_dia` é uma **função** com
   `returns table(...)`; isso não cria tipo composto nenhum. Falha com *type "public.meu_dia" does
   not exist*. Zero ocorrências de `returns setof` em `supabase/tests`.
3. **`pg_temp.sdr()` e `pg_temp.gestor()`** são usados em cinco asserções e nunca definidos.
4. **`plan(18)` não bate.** As asserções descritas passam de 22.
5. **A asserção 18 não prova nada.** Compara `pg_temp.retrato(...)` com `pg_temp.retrato(...)`, os
   dois lados lidos no mesmo instante, depois da leitura. Prova precisa de retrato **antes**.

**Guardrail furado**

6. **Quem pediu SAIR e não tem ficha ENTRA na fila.** `app.is_suppressed_target(org, contato)` só
   olha `organizations` e `contacts`. A conversa fora da base tem os dois nulos — devolve `false` e
   a linha passa. Quem enxerga o telefone é `app.wa_motivo_de_recusa(org, contato, telefone)`, com o
   ramo `numero_suprimido`. É o guardrail do CLAUDE.md.

**Desempenho e vazamento**

7. **`app.conversas_esperando_gente()` sem parâmetro varre a base inteira.** `security definer`
   impede o inline de função SQL set-returning, então o `where e.de_quem = v_alvo` de `meu_dia` roda
   **depois** de avaliar `is_suppressed_target`, `setor_quem_recebe` e `wa_negocio_da_ficha` para
   toda conversa da base. E o índice `(assignee_id, last_inbound_at)` nunca seria usado.
8. **`grant execute ... to authenticated` vaza o que a RLS esconde.** `conversations_select` só deixa
   o sdr ver a conversa em que ele é `assignee_id`.

**Tela**

9. **Pôr `conversa_esperando` em `explicar` apaga a etiqueta de etapa.** Em `item-da-fila.tsx` a
   mesma variável faz duas coisas.
10. **A `NotaDoQueFalta` vira mentira** e o plano não a toca (`tela-meu-dia.tsx:298`).
11. **`chaveDoItem` continua colidindo.** Duas conversas da mesma ficha devolvem o mesmo `deal_id`.
12. **Prioridade 0 sem teto afoga a fila inteira.** `LIMITE_DA_FILA = 60`; 200 respostas viram 60
    conversas e some toda reunião, tarefa vencida e negócio parado.

**Mais três, menores e reais**

13. **Introdução presa na fila esconde o lead para sempre.** A linha nasce `queued` e
    `app.messages_after_write` já grava `last_outbound_at`.
14. **Teste refém do relógio.** A introdução exige `app.janela_do_canal` aberta (regra 0b).
15. **`pnpm db:types` é necessário:** gera `--schema public,app`, e funções de `app` estão no arquivo.

Acertos confirmados: `conversations.status` não é mantido (`messages_after_write` só sai de
`'resolvida'`; a conversa de campanha nasce `'aguardando_parceiro'`), então a aba "Responderam" está
vazia justo para o caso do Rafael; `status = 'robo'` é estado morto; `wa_bot_dizer` grava
`template_id`; `app.wa_bot_freiar` já cria tarefa e por isso não duplica.

---

## As decisões

### (a) Quem entra

A pergunta não é sobre `status`, é sobre **mensagem**: *a última palavra é do lead?* Mais três
recortes: supressão pelo `wa_motivo_de_recusa` (o único que vê o telefone); saída presa em `queued`
há mais de 15 min não conta como resposta; a ausência (`GEN-SYS-AUSENCIA`) não conta como resposta.

- **Conversa com dono entra?** Entra. `assignee_id` é NOT NULL e sempre preenchido; o
  `a_conversa_ja_tem_dono` de `wa_introduzir` é outra coisa (`app.wa_so_o_cumprimento_saiu`).
- **Conversa que o robô ainda vai introduzir entra?** Não, e sem regra própria: a linha da introdução
  nasce na mesma transação da entrada e `messages_after_write` grava `last_outbound_at` junto. A
  comparação é **estrita** (`<`).
- **`status = 'robo'`?** Não é caso: nenhuma linha escreve esse valor.

Assimetrias com `esperandoResposta` (TypeScript), declaradas:

| | Meu dia (SQL) | Conversas (TS) | Por quê |
|---|---|---|---|
| supressão | `wa_motivo_de_recusa` | só `naoContatar` | Meu dia **manda agir**; tem de ser o mais restrito. |
| ausência e `queued` | não contam como resposta | contam | O navegador não tem as mensagens em mão. A diferença deixa a lista do Meu dia **maior**. |
| adiada (`snoozed_until`) | fica de fora | entra | `FioDaConversa` não carrega `snoozed_until`. |

### (b) De quem é o item

**De uma pessoa só: a que a conversa já aponta** (`conversations.assignee_id`, com queda para
`app.setor_quem_recebe(setor_id)` quando o perfil está inativo). Nada é escrito.

Não é "todo mundo" porque cinco pessoas abrindo a mesma conversa é a caixa compartilhada que
`assignee_id` já resolveu. Não é "o setor" porque setor é endereço para rotear, não para cobrar.

`public.meu_dia` passa a ter **dois conceitos de posse** convivendo de propósito:
`app.deal_cards.owner_id` ("Responsável") e `conversations.assignee_id` ("Atendendo").

**O que isso torna visível:** como quase toda ficha do Radar está sem `owner_id`, a conversa de
campanha aponta para quem disparou. 200 respostas viram 200 itens do Rafael. É a medição que falta
para escolher a segunda opção com um número em vez de um palpite.

### (c) Tipo, rótulo, ícone, texto

| | |
|---|---|
| `tipo` | `conversa_esperando` |
| bloco | **"Responderam e estão esperando"** — *"Escreveram no WhatsApp e ninguém falou com eles desde então. A janela de 24 h corre."* |
| `titulo` | **"Responder no WhatsApp"** · **"Responder quem escreveu de fora da base"** |
| `motivo` | "A janela de 24 h fecha em 21 h" · "A janela de 24 h fechou: daqui só sai modelo aprovado" |
| ícone | `MessageCircle` — `iconeDoItem` já casa `/^responder/` → `escrever` |
| prazo | "há 12 min" em vermelho, de `atraso_horas` |

Destino: `/conversas?aba=responderam&org=<id>`.

### (d) Prioridade 0, no topo — com teto de 15

**Por que no topo:** todo o resto do Meu dia é trabalho que **nós** agendamos. A conversa que
respondeu é o único item cujo relógio é de **outra pessoa**: a janela de 24 h (RF-CON-18) e alguém
com o telefone na mão agora. Acima até da reunião em 3 h, que tem hora reservada dos dois lados.

**Por que com teto de 15:** `LIMITE_DA_FILA = 60`. Sem teto, 200 respostas empurram para fora toda
reunião e toda tarefa vencida.

### (e) Testes

pgTAP novo `supabase/tests/87_quem_respondeu_no_meu_dia.sql`, **25 asserções**. Vitest em
`meu-dia/tipos.test.ts`, `meu-dia/icones` e `conversas/montagem.test.ts`.

---

## As tarefas

1. **O vermelho de partida** — `87_quem_respondeu_no_meu_dia.sql` com fixtures escritas e as duas
   asserções que medem o defeito (`status` parado, não lido que ninguém olha).
2. **A pergunta, em SQL, num lugar só** — `20261002150000_quem_respondeu_entra_no_meu_dia.sql`:
   `app.wa_modelo_ausencia()`, `app.conversas_esperando_gente(p_de_quem uuid)` e o índice
   `conversations_esperando_idx`.
3. **Os testes da definição** — asserções 3 a 17.
4. **O bloco 0 em `public.meu_dia`** — `v_teto_conversas int := 15`, o CTE `conversas` e o ramo novo
   como primeiro do `union all`, com as mesmas 16 colunas. Comentário reescrito.
5. **Fechar o pgTAP** — asserções 18 a 25, inclusive a de "ler não escreve" com retrato antes.
6. **A tela conhece o item** — `TIPOS_DE_ITEM`, `IdDoBloco`, `BLOCOS`, `ehAvisoDoSistema`,
   `destinoDoItem`, `ICONE_DO_ITEM`.
7. **A linha, a etapa e a chave** — separar `motivoNomeiaEtapa` de `mostrarMotivo`; `chaveDoItem` com
   o tipo sempre; `NotaDoQueFalta` reescrita.
8. **A aba "Responderam" para de perguntar pela coluna errada** — `ultimaSaidaEm` no `FioDaConversa`
   e `esperandoResposta` pela última mensagem.
9. **Fechar o dia** — suíte inteira, `db:types`, CHANGELOG.

---

## O que este plano não faz, de propósito

- **Não distribui conversa e não cria tarefa.** Segunda opção, adiada; este item produz o número que
  falta para essa decisão.
- **Não notifica no navegador.** Terceira opção, adiada.
- **Não dá dono a conversa nenhuma.** `public.meu_dia` continua só leitura, e a asserção 25 trava
  isso — porque é a conversa sem saída nossa que deixa a introdução automática sair.
- **Não mexe em `app.messages_after_write`.** Consertar o `status` é mudança de comportamento no
  caminho quente da entrada, com efeito em `conversations_inbox_idx`, nas abas de Conversas e em
  `app.envio_publico`. Vale sozinha, com os seus próprios testes. Fica no CHANGELOG como pendência.
