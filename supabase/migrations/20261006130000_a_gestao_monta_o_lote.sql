-- =====================================================================
-- A gestão monta o lote, e diz de quem ele é
--
-- Pivô de 06/10/2026: "na tela de Lotes (hoje se chama Ligar) vai ser onde nós
-- gestores e admin criaremos lotes para nós mesmos ou para os SDRs". O caminho
-- inteiro ficou: Revisão → aprovar → Prospectados → Lotes → montar o lote para
-- uma pessoa → ela liga → o dia dela aparece no relatório.
--
-- ===========================================================================
-- POR QUE UMA FUNÇÃO NOVA, E NÃO UM PARÂMETRO A MAIS EM `montar_lote`
-- ===========================================================================
-- `public.montar_lote` cria o lote no nome de quem chamou e reserva os contatos
-- — e é a função mais delicada do módulo de ligação, que está sendo mexido em
-- outra branch (telefonia pelo navegador). Dar a ela um parâmetro novo obrigaria
-- a redefini-la inteira aqui, e duas migrações redefinindo a mesma função não
-- conflitam no git: a de data mais nova apaga a outra em silêncio.
--
-- Então o lote nasce como sempre nasceu, no nome de quem montou, e esta função
-- muda UMA coluna: de quem ele é. A reserva dos contatos é do LOTE (os índices
-- únicos de `call_batch_items`), não da pessoa, e por isso acompanha.
--
-- ===========================================================================
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
-- ===========================================================================
-- Não impede o SDR de chamar `montar_lote`. A tela deixa de oferecer o botão a
-- ele; a trava no banco entra junto com as outras (o SDR ainda lê a base
-- inteira), numa migração só, combinada com a branch da telefonia.
--
-- RF-MET-01, RF-ADM-01
-- =====================================================================

create or replace function public.lote_atribuir(p_batch_id uuid, p_para uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b      public.call_batches%rowtype;
  v_nome text;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into b from public.call_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'lote_inexistente');
  end if;
  if b.status = 'encerrado'::app.call_batch_status then
    return jsonb_build_object('ok', false, 'motivo', 'lote_encerrado');
  end if;

  -- Quem pode receber um lote: gente ativa de um dos três papéis que existem.
  select p.full_name into v_nome
    from public.profiles p
   where p.id = p_para and p.is_active
     and p.role in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role);
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pessoa_invalida');
  end if;

  update public.call_batches set owner_id = p_para where id = p_batch_id and owner_id <> p_para;

  return jsonb_build_object('ok', true, 'lote_id', p_batch_id, 'para', p_para, 'nome', v_nome);
end $$;
comment on function public.lote_atribuir(uuid, uuid) is
  'Diz de quem é um lote de ligação (pivô de 06/10/2026): admin e gestor montam o lote e o passam para a pessoa que vai ligar — eles mesmos ou um SDR. Muda só call_batches.owner_id; a reserva dos contatos é do lote e acompanha. Lote encerrado não muda de mão. O rastro fica no audit_log do gatilho da tabela.';
revoke all on function public.lote_atribuir(uuid, uuid) from public, anon;
grant execute on function public.lote_atribuir(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
