# O resumo da passagem (só na Imova)

Quando a IA que atende passa a conversa para a equipe, o worker de IA escreve um resumo para o corretor: o que o cliente procura, o orçamento e o pagamento, a objeção principal, a temperatura (frio, morno ou quente), por que passou e o próximo passo. Ele aparece na conversa, no ponto da passagem e no topo enquanto ninguém da equipe respondeu, e no título da tarefa "A IA passou o cliente para você".

- Banco: migração `20261125190000_o_resumo_da_passagem.sql` (pgTAP 146).
- Prompt: `resumo-da-passagem@v1` (Haiku 5.5, propósito `summarize_deal`).
- Worker: o trabalho `resumir_passagem` da fila `ai_jobs` (`apps/workers/src/ia/resumo-da-passagem.ts`).
- Tela: `apps/web/src/components/ia-que-atende/resumo-da-passagem.tsx`.

## Ordem de publicação: o worker primeiro

1. **O worker de IA da Imova**, com o código que conhece `resumir_passagem`. Um worker antigo trata o trabalho como propósito desconhecido: conclui o item da fila e queima a chave, e o resumo daquela passagem não sai mais por conta própria.
2. **A migração** no banco da Imova (`node scripts/publicar-banco.mjs imova migrar`). A partir daqui toda passagem pede o resumo.
3. **O site.** Antes da migração a tela não acha `public.ia_passagens_da_conversa` e simplesmente não mostra nada.
4. **Se alguma passagem aconteceu com o worker antigo no ar**, ponha de novo na fila, com chave nova, o que ficou pedido e não andou nas últimas 48 horas:

   ```sql
   select public.ia_resumos_reenfileirar(48);
   ```

   Ela devolve quantas passagens voltaram para a fila. Falha gravada (dado pessoal, orçamento, modelo, suprimido, desligado) não volta.

## Ligar e desligar

Ligado por padrão. Para desligar sem deploy:

```sql
insert into public.app_settings (key, value, description)
values ('ia.resumo_da_passagem', '{"ligado": false}', 'Resumo da passagem desligado')
on conflict (key) do update set value = excluded.value;
```

Desligado, a passagem acontece igual, nada vai para a fila e a tela diz "Sem resumo: o resumo da passagem está desligado".

## O que a tela diz quando não há resumo

| Situação | Quando |
|---|---|
| A IA está escrevendo o resumo | Pedido há menos de 15 minutos. |
| O resumo não chegou | Pedido há mais de 15 minutos, sem resposta do worker (worker parado, fila morta ou worker antigo). `ia_resumos_reenfileirar` resolve. |
| Sem resumo: o motivo | O worker registrou por que não saiu (`ia_resumos_da_passagem.motivo_sem_resumo`). |
| Esta passagem é de antes do resumo | A passagem é de antes da migração. |
