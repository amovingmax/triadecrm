# @komune/prompts

Prompts versionados e evals dos fluxos de IA do CRM (ADR-10 do PRD). Entra em uso no **D6 (IA v0)**; até lá o pacote exporta apenas um módulo vazio.

## Por que um pacote

- Toda chamada ao modelo é registrada em `ai_runs` com `model`, `prompt_version`, tokens e custo. Para isso, cada prompt precisa de um identificador estável e uma versão explícita, e não um texto solto no código do worker.
- Mudar um prompt é mudar comportamento em produção: a mudança passa por PR, com evals rodando no CI, como qualquer outro código.

## Modelos (ADR-10)

| Uso                                                                                               | Modelo           | Observações                                       |
| ------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| Classificação de intenção (25 intenções do R08), extração estruturada, score                      | Claude Haiku 4.5 | Saídas estruturadas; Batch API nos lotes do Radar |
| Rascunhos de resposta, resumos de conversa, digests, Assistente de cobrança, relatório de segunda | Claude Sonnet 5  | Sempre com aprovação humana no MVP (ADR-05)       |

## Convenção proposta (fechar no D6)

```
src/
  <fluxo>/                 ex.: classificar-intencao, rascunho-resposta, resumo-conversa, digest, assistente
    v1.ts                  export const prompt = { id, version, model, system, schema (zod), examples }
    index.ts               reexporta a versão vigente
  index.ts                 catálogo de prompts por id
evals/
  <fluxo>.eval.test.ts     Vitest: casos dourados (entrada → saída esperada), limiares de acerto por intenção
  fixtures/                conversas pseudonimizadas (lead_id, sem telefone/e-mail)
```

## Guardrails que os prompts devem respeitar (CLAUDE.md)

- Pseudonimizar o que vai ao modelo: `lead_id` no lugar de telefone/e-mail sempre que possível.
- O robô nunca promete condição comercial fora da base de conhecimento; dúvida financeira sem resposta na FAQ → "vou confirmar com o financeiro". O validador de promessas roda sobre a saída.
- Pedido de autorização (dados/fotos, `consent_events`) é a segunda mensagem da conversa, nunca a primeira.
- Textos por segmento vêm do R08 §2; intenções e textos base do Apêndice C do PRD.
