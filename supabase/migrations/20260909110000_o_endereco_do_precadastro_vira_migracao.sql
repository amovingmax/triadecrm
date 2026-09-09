-- =====================================================================
-- 20260909110000 — O endereço do pré-cadastro vira migração
--
-- Defeito encontrado em 09/09/2026, rodando a suíte pgTAP inteira.
--
-- A migração 20260908120000 cria `app_settings['precadastro.link']` com
-- `modelo = null` DE PROPÓSITO: enquanto o endereço não estivesse decidido, a
-- emissão de link ficava recusada com `endereco_nao_configurado`, porque botão
-- que não funciona é melhor que link que não abre.
--
-- O endereço foi decidido no mesmo dia (`https://admin.komune.app.br/seja-parceiro?pre={token}`,
-- commit 5ffb656) e gravado em produção com um UPDATE à mão. **Só que esse
-- commit mexeu no CHANGELOG e em nada mais.** O valor passou a existir apenas
-- como estado solto do banco: não está em migração nenhuma, não sobrevive a um
-- `db reset`, e não chega ao `komune-dev`.
--
-- O sintoma que denunciou: o teste 36 passa no CI (banco novo, `modelo` nulo) e
-- falha na máquina onde o UPDATE foi rodado. Um teste que depende de onde ele
-- roda não está testando o produto.
--
-- O sintoma que viria depois, e é o que importa: qualquer restauração do banco a
-- partir das migrações DESLIGA a emissão de link em silêncio. A tela diria
-- "endereço não configurado" e ninguém saberia por quê.
--
-- ---------------------------------------------------------------------------
-- POR QUE O VALOR DE PRODUÇÃO PODE MORAR NUMA MIGRAÇÃO
-- ---------------------------------------------------------------------------
-- Já recusei fazer isso uma vez, com a URL e o segredo do cron do lado Komune, e
-- pelo motivo certo: a mesma migração roda em dev e em produção, e uma URL de
-- produção cravada apontaria o cron de dev para a produção.
--
-- Aqui é diferente por duas razões:
--
--   1. O destino não é ambiente nosso. `admin.komune.app.br` é o cadastro real
--      da Komune, e é para lá que o link do fornecedor aponta em qualquer
--      ambiente — não existe "admin de desenvolvimento" para onde mandar um
--      fornecedor de verdade.
--   2. `app_settings` É a tabela de configuração, e continua sendo. Quem quiser
--      outro destino num ambiente de teste dá um UPDATE, e este arquivo não
--      desfaz isso: o `where modelo is null` abaixo só preenche o buraco.
--
-- Idempotente e não destrutivo: só escreve onde o modelo está NULO. Rodar de novo
-- em produção não muda nada, e um ambiente que já apontava para outro lugar
-- continua apontando.
-- =====================================================================

update public.app_settings
   set value = jsonb_set(value, '{modelo}',
                         to_jsonb('https://admin.komune.app.br/seja-parceiro?pre={token}'::text)),
       description = 'Endereço para onde o link de reivindicação aponta. Use {token} onde o token entra. '
                     'O cadastro do negócio acontece em admin.komune.app.br; komune.app.br/parceiros é a '
                     'apresentação que vem antes, e quem recebe este link já foi convencido no telefone. '
                     'NULO faz a emissão ser recusada com "endereco_nao_configurado", de propósito.'
 where key = 'precadastro.link'
   and value ->> 'modelo' is null;
