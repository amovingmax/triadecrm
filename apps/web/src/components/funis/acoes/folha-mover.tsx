'use client';

/**
 * Mover o cartão de etapa (RF-FUN-01, RF-FUN-03, RF-FUN-04, RF-FUN-08).
 *
 * É a única porta por onde um negócio muda de etapa no CRM — tanto o arrastar do
 * desktop quanto o botão do celular passam por aqui. Entra por baixo no celular
 * (o polegar alcança; a Heloísa está de pé, na rua) e pela lateral no desktop.
 *
 * O que a folha exige, e por quê:
 *
 *  * **Próxima ação** (RF-FUN-03) para toda etapa de trabalho. Etapa de saída —
 *    ganho, perda, opt-out, nutrição — dispensa: ali a justificativa é a própria
 *    etapa. Se o negócio já tem uma próxima ação futura, a folha não pede de novo:
 *    oferece trocar. E se a etapa marca reunião, a data da reunião JÁ é a próxima
 *    ação (é o que o `move_deal` faz), então pedir as duas seria pedir duas vezes.
 *  * **Motivo de perda** da lista fechada (RF-FUN-04) para perder. A lista vem de
 *    `lost_reasons`, só os ativos: oferecer um motivo desligado seria oferecer um
 *    caminho que o banco fecha.
 *  * **Campos da etapa** (RF-FUN-04) a partir de `stages.required_fields`, sem
 *    `if` por nome de etapa.
 *
 * Recusa do banco NÃO vira texto do Postgres na tela: a que a pessoa corrige volta
 * para o campo, em vermelho; a que muda o mundo fora da folha (alguém moveu antes,
 * o cartão sumiu) vira aviso e recarrega o quadro.
 */
import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Controller, useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMovimento } from '@/components/movimento';

import {
  etapaEhDeSaida,
  ROTULOS_TIPO_PROXIMA_ACAO,
  type CartaoQuadro,
  type EtapaQuadro,
  type MotivoRecusaMover,
  type ResultadoMover,
  type TipoProximaAcao,
} from '../tipos';
import { AreaDeTexto, Campo, CampoDaEtapa } from './campos-obrigatorios';
import { carregarMotivosDePerda, CHAVE_MOTIVOS_DE_PERDA, moverNegocio } from './consultas';
import {
  formatarDataHora,
  minimoDoCampoDeData,
  paraEntradaDataHora,
  proximoDiaUtilAsNove,
} from './datas';
import { fraseDaFalha, mensagemDaRecusa, recusaEhDoFormulario } from './erros';
import {
  camposDaEtapa,
  CAMPO_MOTIVO_DE_PERDA,
  criarSchemaMover,
  etapaEscolhida,
  etapaMarcaReuniao,
  exigeProximaAcaoDigitada,
  jaTemProximaAcaoFutura,
  montarPedido,
  resumoDoMovimento,
  valoresIniciais,
  type FormularioMover,
} from './formulario-mover';
import { resolverEmPortugues } from './resolver-portugues';
import { useTelaPequena } from './usar-tela-pequena';

/** Movimento pedido: qual cartão, de onde, e (quando já se sabe) para onde. */
export type AlvoDeMovimento = {
  cartao: CartaoQuadro;
  /** Etapa em que o cartão está agora — vira `p_expected_stage_id`. */
  etapaAtualId: number;
  /** Etapa em que o cartão foi solto; `null` quando a pessoa ainda vai escolher. */
  etapaDestinoId: number | null;
};

/** O `move_deal` deu certo: o cartão já vem recalculado. */
export type MovimentoFeito = Extract<ResultadoMover, { ok: true }>;

export function FolhaMover({
  alvo,
  etapas,
  aoFechar,
  aoMover,
  aoDesencontro,
}: {
  alvo: AlvoDeMovimento | null;
  /** Todas as etapas do funil, na ordem do quadro. */
  etapas: EtapaQuadro[];
  aoFechar: () => void;
  /** Movimento aceito: a tela reconcilia o quadro com o cartão devolvido. */
  aoMover: (feito: MovimentoFeito) => void;
  /** O mundo mudou por baixo (outra pessoa moveu, o cartão sumiu): recarregue tudo. */
  aoDesencontro: () => void;
}) {
  const pequena = useTelaPequena();

  return (
    <Sheet open={alvo !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent
        side={pequena ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        {alvo ? (
          <>
            <SheetHeader>
              {/* `pr-10`: nome de parceiro é longo ("Bar Service Coquetéis /
                  Caipifrutas") e sem a folga ele passa por baixo do botão de fechar. */}
              <SheetTitle className="pr-10">Mover {alvo.cartao.organization_name}</SheetTitle>
              <SheetDescription>
                O movimento fica registrado no histórico do negócio, com quem moveu e quando.
              </SheetDescription>
            </SheetHeader>

            {/* A chave por negócio zera o formulário quando a folha troca de cartão:
                campos obrigatórios de uma etapa não podem vazar para outro parceiro. */}
            <Formulario
              key={alvo.cartao.deal_id}
              alvo={alvo}
              etapas={etapas}
              aoFechar={aoFechar}
              aoMover={aoMover}
              aoDesencontro={aoDesencontro}
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Formulario({
  alvo,
  etapas,
  aoFechar,
  aoMover,
  aoDesencontro,
}: {
  alvo: AlvoDeMovimento;
  etapas: EtapaQuadro[];
  aoFechar: () => void;
  aoMover: (feito: MovimentoFeito) => void;
  aoDesencontro: () => void;
}) {
  const { mola } = useMovimento();
  const idBase = useId();
  const [falha, setFalha] = useState<string | null>(null);
  // Aberta quando ninguém escolheu ainda (botão do cartão); fechada quando a etapa já
  // veio decidida (cartão solto numa coluna) ou logo depois de a pessoa escolher.
  const [listaAberta, setListaAberta] = useState(alvo.etapaDestinoId === null);
  const cartao = alvo.cartao;

  const schema = useMemo(() => criarSchemaMover(etapas, cartao), [etapas, cartao]);
  const iniciais = useMemo(
    () => valoresIniciais(cartao, alvo.etapaDestinoId, paraEntradaDataHora(proximoDiaUtilAsNove())),
    [cartao, alvo.etapaDestinoId],
  );

  const form = useForm<FormularioMover, unknown, FormularioMover>({
    // `resolverEmPortugues` e não `zodResolver` direto: nenhuma mensagem de biblioteca
    // (em inglês) pode chegar a quem está na rua com o celular na mão.
    resolver: resolverEmPortugues(schema),
    defaultValues: iniciais,
  });

  const registroDaEtapa = form.register('etapaDestinoId', {
    onChange: () => setListaAberta(false),
  });
  const destinoId = useWatch({ control: form.control, name: 'etapaDestinoId' });
  const atualizarProxima = useWatch({ control: form.control, name: 'atualizarProximaAcao' });
  const destino = etapaEscolhida(etapas, destinoId);

  // Só busca a lista de motivos quando a etapa escolhida é de perda: são 9 linhas,
  // mas não há por que pedi-las em todo movimento de cartão.
  const precisaDeMotivo = Boolean(destino && destino.is_lost && !destino.is_optout);
  const motivos = useQuery({
    queryKey: CHAVE_MOTIVOS_DE_PERDA,
    queryFn: carregarMotivosDePerda,
    enabled: precisaDeMotivo,
    staleTime: 10 * 60_000,
  });

  const exigeProxima = destino ? exigeProximaAcaoDigitada(destino, cartao) : false;
  const mostraProxima = destino ? !etapaEhDeSaida(destino) : false;
  const jaTemProxima = jaTemProximaAcaoFutura(cartao);
  const marcaReuniao = destino ? etapaMarcaReuniao(destino) : false;

  async function enviar(valores: FormularioMover) {
    const etapaDestino = etapaEscolhida(etapas, valores.etapaDestinoId);
    if (!etapaDestino) return;

    setFalha(null);

    let resultado: ResultadoMover;
    try {
      resultado = await moverNegocio(
        montarPedido(valores, etapaDestino, cartao, alvo.etapaAtualId),
      );
    } catch (erro) {
      setFalha(fraseDaFalha(erro));
      return;
    }

    if (resultado.ok) {
      toast.success(`Movido para ${etapaDestino.name}.`, {
        description: resultado.claimed
          ? `${cartao.organization_name} agora está na sua carteira.`
          : cartao.organization_name,
      });
      aoMover(resultado);
      aoFechar();
      return;
    }

    aplicarRecusa(resultado.reason, resultado);
  }

  /** A recusa nomeada vira erro no campo certo ou aviso, nunca texto do Postgres. */
  function aplicarRecusa(
    motivo: MotivoRecusaMover,
    resultado: Extract<ResultadoMover, { ok: false }>,
  ) {
    if (!recusaEhDoFormulario(motivo)) {
      toast.error(mensagemDaRecusa(motivo));
      if (motivo === 'etapa_mudou' || motivo === 'negocio_nao_encontrado') {
        aoDesencontro();
        aoFechar();
      } else {
        setFalha(mensagemDaRecusa(motivo));
      }
      return;
    }

    if (motivo === 'motivo_de_perda_invalido') {
      form.setError(`campos.${CAMPO_MOTIVO_DE_PERDA}`, {
        message: mensagemDaRecusa(motivo),
      });
      return;
    }

    if (motivo === 'proxima_acao_obrigatoria') {
      form.setValue('atualizarProximaAcao', true);
      form.setError('proximaAcao.label', { message: mensagemDaRecusa(motivo) });
      return;
    }

    if (motivo === 'proxima_acao_no_passado') {
      form.setError('proximaAcao.at', { message: mensagemDaRecusa(motivo) });
      return;
    }

    // campos_obrigatorios: o banco diz exatamente o que faltou.
    for (const campo of resultado.missing ?? []) {
      form.setError(`campos.${campo.field}`, {
        message: `Preencha: ${campo.label.toLowerCase()}.`,
      });
    }
    setFalha(mensagemDaRecusa(motivo));
  }

  /** O envio parou na validação: a folha diz isso em uma frase, além do vermelho nos campos. */
  function aoBarrarEnvio() {
    setFalha('Faltou alguma coisa para entrar nesta etapa. Confira o que está em vermelho.');
  }

  return (
    <motion.form
      onSubmit={form.handleSubmit(enviar, aoBarrarEnvio)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={mola}
      className="flex flex-col gap-5 px-4 pb-4"
      noValidate
    >
      {/* ---------- destino ---------- */}
      {/* Escolhida a etapa, a lista de doze (ou catorze) opções se recolhe numa linha
          só. Sem isso, os campos que a etapa exige nascem abaixo da dobra — e no
          celular a pessoa toca em "Mover cartão" sem nunca ter visto o que faltava. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Para qual etapa?</legend>

        {listaAberta || !destino ? (
          <div className="flex flex-col overflow-hidden rounded-xl border border-hairline">
            {etapas.map((etapa) => (
              <OpcaoDeEtapa
                key={etapa.id}
                etapa={etapa}
                atual={etapa.id === alvo.etapaAtualId}
                registro={registroDaEtapa}
                marcada={destinoId === String(etapa.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-hairline px-3 py-2">
            <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{destino.name}</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setListaAberta(true)}
              className="toque h-9 shrink-0 md:h-7 md:text-xs"
            >
              Trocar
            </Button>
          </div>
        )}

        {form.formState.errors.etapaDestinoId?.message ? (
          <p role="alert" className="text-sm text-destructive-texto">
            {form.formState.errors.etapaDestinoId.message}
          </p>
        ) : null}
      </fieldset>

      {destino ? (
        <p className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
          <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {resumoDoMovimento(destino)}
        </p>
      ) : null}

      {/* ---------- motivo de perda (RF-FUN-04) ---------- */}
      {precisaDeMotivo ? (
        <Campo
          id={`${idBase}-motivo-perda`}
          rotulo="Motivo da perda"
          erro={erroDeCampo(form.formState.errors, CAMPO_MOTIVO_DE_PERDA)}
          dica="A lista é fechada: é dela que sai o relatório de por que a gente perde."
        >
          <Controller
            control={form.control}
            name={`campos.${CAMPO_MOTIVO_DE_PERDA}`}
            defaultValue=""
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
                disabled={motivos.isPending || motivos.isError}
              >
                <SelectTrigger
                  id={`${idBase}-motivo-perda`}
                  aria-invalid={Boolean(erroDeCampo(form.formState.errors, CAMPO_MOTIVO_DE_PERDA))}
                  className="h-11 w-full md:h-9"
                >
                  <SelectValue
                    placeholder={
                      motivos.isPending
                        ? 'Carregando os motivos...'
                        : motivos.isError
                          ? 'Não deu para carregar os motivos'
                          : 'Escolha o motivo'
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(motivos.data ?? []).map((motivo) => (
                    <SelectItem key={motivo.id} value={String(motivo.id)}>
                      {motivo.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Campo>
      ) : null}

      {/* ---------- campos exigidos pela etapa (RF-FUN-04) ---------- */}
      {destino
        ? camposDaEtapa(destino).map((campo) => (
            <Controller
              key={campo.field}
              control={form.control}
              name={`campos.${campo.field}`}
              defaultValue=""
              render={({ field }) => (
                <CampoDaEtapa
                  campo={campo}
                  id={`${idBase}-${campo.field}`}
                  valor={field.value ?? ''}
                  aoMudar={field.onChange}
                  erro={erroDeCampo(form.formState.errors, campo.field)}
                />
              )}
            />
          ))
        : null}

      {/* ---------- próxima ação (RF-FUN-03) ---------- */}
      {mostraProxima ? (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-hairline p-3">
          <legend className="px-1 text-sm font-medium">
            Próxima ação{exigeProxima ? ' (obrigatória)' : ''}
          </legend>

          {marcaReuniao ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <CalendarClock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />A data que
              você marcou acima já entra como a próxima ação e vira tarefa na agenda.
            </p>
          ) : null}

          {!exigeProxima && !marcaReuniao && jaTemProxima ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--primary)]"
                {...form.register('atualizarProximaAcao')}
              />
              <span>
                Já existe: <span className="font-medium text-foreground">{cartao.next_action}</span>{' '}
                para <span className="numerico">{formatarDataHora(cartao.next_action_at)}</span>.
                Marque para trocar por outra.
              </span>
            </label>
          ) : null}

          {exigeProxima || atualizarProxima ? (
            <div className="flex flex-col gap-3">
              <Campo id={`${idBase}-acao-tipo`} rotulo="O que você vai fazer">
                <Controller
                  control={form.control}
                  name="proximaAcao.kind"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as TipoProximaAcao)}
                    >
                      <SelectTrigger id={`${idBase}-acao-tipo`} className="h-11 w-full md:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROTULOS_TIPO_PROXIMA_ACAO).map(([valor, rotulo]) => (
                          <SelectItem key={valor} value={valor}>
                            {rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Campo>

              <Campo
                id={`${idBase}-acao-texto`}
                rotulo="Descrição"
                erro={form.formState.errors.proximaAcao?.label?.message}
                dica="Uma frase curta, do jeito que você diria no grupo."
              >
                <Input
                  id={`${idBase}-acao-texto`}
                  placeholder="Ex.: confirmar o orçamento do buffet"
                  aria-invalid={Boolean(form.formState.errors.proximaAcao?.label)}
                  className="h-11 md:h-9"
                  {...form.register('proximaAcao.label')}
                />
              </Campo>

              <Campo
                id={`${idBase}-acao-data`}
                rotulo="Quando"
                erro={form.formState.errors.proximaAcao?.at?.message}
              >
                <Input
                  id={`${idBase}-acao-data`}
                  type="datetime-local"
                  min={minimoDoCampoDeData()}
                  aria-invalid={Boolean(form.formState.errors.proximaAcao?.at)}
                  className="numerico h-11 md:h-9"
                  {...form.register('proximaAcao.at')}
                />
              </Campo>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {/* ---------- motivo livre (RF-FUN-08) ---------- */}
      <Campo
        id={`${idBase}-motivo`}
        rotulo="Por que está mudando? (opcional)"
        erro={form.formState.errors.motivo?.message}
        dica={
          destino?.is_optout
            ? 'Este texto fica guardado como a evidência do opt-out.'
            : 'Fica no histórico do negócio, para quem pegar a conversa depois.'
        }
      >
        <AreaDeTexto
          id={`${idBase}-motivo`}
          invalido={Boolean(form.formState.errors.motivo)}
          placeholder="Ex.: falou que o preço não fecha para o pacote dela."
          {...form.register('motivo')}
        />
      </Campo>

      {falha ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive-texto"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {falha}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="ghost" onClick={aoFechar} className="toque h-11 md:h-9">
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !destino}
          className="toque h-11 md:h-9"
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 aria-hidden="true" className="animate-spin" />
              Movendo...
            </>
          ) : (
            'Mover cartão'
          )}
        </Button>
      </div>
    </motion.form>
  );
}

/** Uma etapa na lista de destinos: nome, contagem e o que ela significa. */
function OpcaoDeEtapa({
  etapa,
  atual,
  marcada,
  registro,
}: {
  etapa: EtapaQuadro;
  atual: boolean;
  marcada: boolean;
  registro: ReturnType<ReturnType<typeof useForm<FormularioMover>>['register']>;
}) {
  return (
    <label
      className={cn(
        'toque flex cursor-pointer items-center gap-3 border-b border-hairline px-3 py-2.5 last:border-b-0 transition-colors',
        marcada ? 'bg-muted' : 'hover:bg-muted/50',
        atual && 'cursor-not-allowed opacity-45',
      )}
    >
      <input
        type="radio"
        value={String(etapa.id)}
        disabled={atual}
        className="size-4 shrink-0 accent-[var(--primary)]"
        {...registro}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{etapa.name}</span>
        <span className="text-xs text-muted-foreground">
          {atual
            ? 'É a etapa em que o cartão já está'
            : etapaEhDeSaida(etapa)
              ? 'Encerra o negócio'
              : 'Continua aberto'}
        </span>
      </span>
      <span className="numerico shrink-0 text-xs text-muted-foreground">{etapa.total}</span>
    </label>
  );
}

/**
 * Erro de um campo dinâmico. `campos` é um dicionário, e o `FieldErrors` do
 * react-hook-form não sabe as chaves em tempo de compilação — a leitura passa por
 * aqui em vez de espalhar asserção por toda a folha.
 */
function erroDeCampo(erros: FieldErrors<FormularioMover>, chave: string): string | undefined {
  const mapa = erros.campos as Record<string, { message?: string } | undefined> | undefined;
  return mapa?.[chave]?.message;
}
