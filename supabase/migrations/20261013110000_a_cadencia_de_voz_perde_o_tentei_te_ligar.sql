-- =====================================================================
-- A cadência "Primeiro contato por voz" perde o passo "tentei te ligar"
--
-- Decisão de 13/10/2026: "Tirar o passo 3 da sequência. O que deve acontecer
-- é ser possível mandar uma mensagem automática, caso o parceiro ou cliente
-- não atenda a ligação." A mensagem automática é o aviso de
-- 20261013090000: sai na hora, depois de CADA ligação não atendida. O passo 3
-- pedia ao operador, três dias depois da 2ª ligação, uma segunda mensagem
-- (GEN-FUP-LIG-V1) para a mesma ligação perdida — tarefa repetida e modelo
-- pago a mais.
--
-- Antes:  1 Ligar · 2 Ligar de novo · 3 WhatsApp "tentei te ligar" · 4 DM no Instagram · 5 Visita
-- Depois: 1 Ligar · 2 Ligar de novo · 3 DM no Instagram · 4 Visita
--
-- O motor (`app.abrir_proximo_toque`) anda de posição em posição e encerra a
-- matrícula na primeira que falta; por isso os passos seguintes SOBEM uma
-- posição, em vez de deixar um buraco. O Instagram e a visita contam o prazo
-- desde a matrícula (D+7), então não dependem do passo que sai.
--
-- Quem está no meio da cadência:
--   * toque pendente do passo 3 → a tarefa é cancelada, e o gatilho
--     `zz_cadence_on_task` marca o toque como pulado ("tarefa_cancelada");
--   * matrícula que já passou do 2 desce uma posição, para o próximo toque
--     ser o Instagram e não pular para a visita.
-- O passo 3 é apagado quando ninguém o usou. Se já tem histórico (toques
-- feitos ou pulados), a linha FICA, na posição 12 e marcada "Fora de uso":
-- o histórico não perde a referência, e o motor nunca chega lá (encerra na
-- posição 5, que não existe mais).
--
-- Num banco novo esta migração não acha a cadência (ela nasce no seed, que
-- roda depois) e não faz nada; o seed já traz os quatro passos.
--
-- RF-CON-13, RF-CON-18 · R13 §7
-- =====================================================================

do $$
declare
  v_cad   int;
  v_passo int;
  v_n     int;
begin
  select id into v_cad from public.cadences where slug = 'voz_primeiro';
  if v_cad is null then
    return;
  end if;
  select id into v_passo from public.cadence_steps
   where cadence_id = v_cad and template_code = 'GEN-FUP-LIG-V1' and "position" = 3;
  if v_passo is null then
    return;  -- já aplicada
  end if;

  -- 1. O que estava esperando gente neste passo sai da fila.
  update public.tasks t
     set status = 'cancelled'::app.task_status
    from public.cadence_touches x
   where x.task_id = t.id and x.step_id = v_passo
     and x.status = 'pendente'::app.touch_status
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status);
  update public.cadence_touches
     set status = 'cancelado'::app.touch_status, done_at = now(),
         skip_reason = 'passo_removido'
   where step_id = v_passo and status = 'pendente'::app.touch_status;

  -- 2. Quem já passou do 2 desce uma posição.
  update public.cadence_enrollments
     set current_position = current_position - 1
   where cadence_id = v_cad and current_position >= 3;

  -- 3. O passo sai do caminho: apagado, ou guardado fora de uso.
  select count(*) into v_n from public.cadence_touches where step_id = v_passo;
  if v_n = 0 then
    delete from public.cadence_steps where id = v_passo;
  else
    update public.cadence_steps
       set "position" = 12,
           title = 'Fora de uso — Mandar "tentei te ligar" (assistido)',
           window_hint = 'Removido em 13/10/2026: o aviso automático de ligação não atendida faz este papel'
     where id = v_passo;
  end if;

  -- 4. Os seguintes sobem.
  update public.cadence_steps set "position" = 3
   where cadence_id = v_cad and "position" = 4;
  update public.cadence_steps set "position" = 4
   where cadence_id = v_cad and "position" = 5;

  update public.cadences
     set max_touches = 4,
         description = 'A cadência-padrão da operação depois da virada de 04/09: ligação primeiro (R13). Desde 13/10/2026 o WhatsApp não é passo da cadência: quem não atende recebe o aviso automático de ligação não atendida, logo depois de cada ligação.'
   where id = v_cad;
end $$;
