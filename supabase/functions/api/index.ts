// =============================================================================
// TRIADE — `api`: a API externa do CRM (17/11/2026), nas duas empresas
//
//   https://<projeto>.supabase.co/functions/v1/api/v1/<rota>
//   Authorization: Bearer trd_<empresa>_<48 hexadecimais>
//
// A chave é criada em Ajustes → Integrações e aparece uma vez só. Cada empresa
// tem o próprio endereço (o projeto Supabase dela) e as próprias chaves: uma
// chave da Imova não abre a KOMUNE, e o começo dela diz de qual é.
//
// Esta função é a porta e nada mais (ADR-03): a resposta a cada chamada mora
// em `atender.ts` e a leitura do pedido em `pedido.ts`, os dois testados sem
// rede e sem banco; o trabalho inteiro é de `public.api_atender`, no Postgres
// (migração 20261117200000), chamado com a service_role.
//
// Rotas, permissões, erros e os avisos para fora (webhooks):
// docs/operacao/api-externa.md.
//
// `verify_jwt = false` em supabase/config.toml: a chave da API não é um JWT do
// Supabase, e com `true` o gateway recusaria toda chamada antes de chegar aqui.
// =============================================================================

import { registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { criarAtendente, type Pedido, type RespostaDoBanco } from './atender.ts';

Deno.serve(
  criarAtendente({
    atender: (pedido: Pedido) => rpcServico<RespostaDoBanco>('api_atender', pedido),
    registrar,
  }),
);
