-- =====================================================================
-- O cumprimento automático reconhece o Google Maps pelo que ele É
--
-- Rafael, 29/09/2026: "cade? eu aprovei alguns agora em revisão, cade as
-- mensagens automaticas?". Não saiu nenhuma, e o defeito é da migração de
-- ontem (20261002200000).
--
-- ===========================================================================
-- O QUE EU ERREI
-- ===========================================================================
-- O gatilho perguntava se a ficha nasceu com a ORIGEM `google_maps_raspado`.
-- Só que o CSV do Google Maps entra pela importação de planilha desde
-- 20260924130000 ("o csv do maps entra pela importacao"), e a ficha aprovada
-- sai com `source_id` da **planilha**. As seis fichas que o Rafael aprovou hoje
-- ao meio-dia tinham, todas, `place_id` do Google preenchido e origem 8.
--
-- Eu conferi a etiqueta em vez do fato. A etiqueta depende de por qual porta a
-- linha entrou; o fato não: `place_id` é o identificador que o próprio Google
-- dá ao lugar, e nada além de coleta do Google o preenche. É por ele que se
-- pergunta agora — e a origem continua valendo, para o dia em que o scraper
-- gravar direto sem passar pela importação.
--
-- ===========================================================================
-- E AS SEIS QUE FICARAM PARA TRÁS
-- ===========================================================================
-- Elas foram aprovadas com o interruptor JÁ LIGADO (a chave virou em
-- 28/09/2026 17:21). O Rafael aprovou esperando que o cumprimento saísse; ele
-- não saiu por defeito meu. Então elas entram na fila agora — e só elas: o
-- recorte é `created_at >= o instante em que a chave foi ligada`. O que foi
-- aprovado ANTES disso nunca teve promessa nenhuma, e enfileirar seria mandar
-- mensagem para quem ninguém decidiu mandar.
--
-- Entram na FILA, não no ar: quem decide se cada uma sai continua sendo a
-- porteira (supressão, horário, teto do dia) e o ritmo do lote, hoje em 2 por
-- hora.
--
-- RF-CON-02, RF-CON-11 · ADR-12
-- =====================================================================

create or replace function app.organizations_cumprimento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote uuid;
begin
  if not app.atendimento_liga('cumprimento_automatico') then
    return new;
  end if;
  if new.deleted_at is not null or new.do_not_contact then
    return new;
  end if;

  -- VEIO DO GOOGLE? Duas maneiras de saber, e a primeira é a que vale no dia a
  -- dia: `place_id` é do Google e só coleta do Google o preenche. A segunda
  -- cobre a gravação direta pelo scraper, que não passa pela importação.
  if new.place_id is null
     and not exists (select 1 from public.sources s
                      where s.id = new.source_id and s.slug = 'google_maps_raspado') then
    return new;
  end if;

  v_lote := app.cumprimento_lote();
  if v_lote is null then
    return new;
  end if;

  insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id)
  select v_lote,
         coalesce((select max(i.posicao) from public.envios_em_massa_itens i
                    where i.envio_id = v_lote), 0) + 1,
         new.id, null
  on conflict (envio_id, organization_id) do nothing;

  return new;
end $$;
comment on function app.organizations_cumprimento() is
  'Aprovou um candidato vindo do Google (place_id preenchido, ou origem google_maps_raspado) → a ficha entra na fila do cumprimento automático. Pergunta pelo place_id e não só pela origem porque o CSV do Maps entra pela importação de planilha (20260924130000) e a ficha sai com a origem da planilha — foi esse o defeito de 29/09/2026. Desligado por padrão em app_settings.atendimento.cumprimento_automatico.';

-- ---------------------------------------------------------------------
-- As que ficaram para trás
-- ---------------------------------------------------------------------
do $recuperar$
declare
  v_lote  uuid;
  v_desde timestamptz;
  v_n     int := 0;
begin
  if not app.atendimento_liga('cumprimento_automatico') then
    raise notice 'cumprimento automático desligado: nada a recuperar';
    return;
  end if;

  -- O instante em que a chave foi ligada é o limite honesto do recorte.
  select s.updated_at into v_desde from public.app_settings s where s.key = 'atendimento';
  if v_desde is null then
    return;
  end if;

  v_lote := app.cumprimento_lote();
  if v_lote is null then
    raise notice 'sem lote contínuo disponível: nada a recuperar';
    return;
  end if;

  insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id)
  select v_lote,
         coalesce((select max(i.posicao) from public.envios_em_massa_itens i
                    where i.envio_id = v_lote), 0)
           + row_number() over (order by o.created_at),
         o.id, null
    from public.organizations o
   where o.place_id is not null
     and o.deleted_at is null
     and not o.do_not_contact
     and o.created_at >= v_desde
  on conflict (envio_id, organization_id) do nothing;

  get diagnostics v_n = row_count;
  raise notice 'cumprimento automático: % ficha(s) recuperada(s) para a fila', v_n;
end $recuperar$;
