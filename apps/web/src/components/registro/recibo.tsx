'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, CloudOff, Loader2, NotebookPen, Undo2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChipTemperatura, definicaoTemperatura } from '@/components/temperatura';

import { doInputLocal, formatarQuando, formatarQuandoPorExtenso, paraInputLocal } from './formatos';
import {
  comQuemPadrao,
  ESPERA_DESFAZER_MS,
  perguntaComQuem,
  type AlvoDoRegistro,
  type ComQuem,
  type DesfechoCatalogo,
  type PrevisaoRegistro,
  type RegistroAceito,
} from './tipos';

/** Onde o registro está: a tela mostra a previsão antes de o servidor responder. */
export type EstadoDoEnvio =
  | { fase: 'segurando'; restaMs: number }
  | { fase: 'enviando' }
  | { fase: 'gravado'; resultado: RegistroAceito }
  | { fase: 'guardado'; frase: string }
  | { fase: 'recusado'; frase: string };

/**
 * Passo 3: o RECIBO. Zero toque, e é ele que faz o próximo registro acontecer.
 *
 * A tela pinta a PREVISÃO calculada no cliente antes de a rede responder: a barra
 * térmica cresce na cor nova e a frase diz "Registrado. Fulano agora está Morno".
 * É o pagamento pelo registro. Quando a resposta do banco chega, a previsão é
 * trocada pelo resultado — sem animação de correção, porque a autoridade é o banco e
 * uma segunda animação transformaria acerto em susto.
 *
 * A linha fina de "Desfazer" conta 5 segundos e só então o envio parte. A janela de
 * arrependimento existe porque `sdr` não tem `delete` em `activities` (a política
 * `activities_delete` é só admin): prometer um desfazer DEPOIS de gravado seria
 * mentira, então o desfazer acontece antes.
 *
 * As três coisas opcionais do recibo (próxima ação, com quem falou, anotação) não
 * bloqueiam nada e custam um toque cada.
 */
export function Recibo({
  alvo,
  desfecho,
  previsao,
  estado,
  comQuem,
  observacao,
  aoDesfazer,
  aoCorrigirComQuem,
  aoAnotar,
  aoRemarcar,
  aoRegistrarOutro,
}: {
  alvo: AlvoDoRegistro;
  desfecho: DesfechoCatalogo;
  previsao: PrevisaoRegistro;
  estado: EstadoDoEnvio;
  comQuem: ComQuem;
  observacao: string;
  aoDesfazer: () => void;
  aoCorrigirComQuem: (valor: ComQuem) => void;
  aoAnotar: (texto: string) => void;
  aoRemarcar: (iso: string) => void;
  aoRegistrarOutro: () => void;
}) {
  const movimentoReduzido = useReducedMotion();
  const [anotando, setAnotando] = useState(false);
  const [remarcando, setRemarcando] = useState(false);

  const resultado = estado.fase === 'gravado' ? estado.resultado : null;
  const temperatura = resultado?.temperatura_depois ?? previsao.temperatura;
  const temperaturaAntes = resultado?.temperatura_antes ?? alvo.temperatura;
  const mudou = temperatura !== temperaturaAntes;
  const definicao = definicaoTemperatura(temperatura);

  const proximaEm = resultado ? resultado.proxima_acao_em : previsao.proximaAcaoEm;
  const proximaTitulo = resultado ? resultado.proxima_acao_titulo : previsao.proximaAcaoTitulo;

  return (
    <div className="flex flex-col gap-5 pt-2">
      {/* A barra cresce da esquerda, na cor nova. Sem interpolação de cor: as cinco
          cores da escala são variáveis de CSS, e animar entre elas exigiria hex na
          mão — justamente o que `escala-termica.ts` existe para impedir. */}
      <motion.div
        aria-hidden="true"
        initial={movimentoReduzido ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
        style={{ backgroundColor: definicao.cor, transformOrigin: 'left center' }}
        className="h-1.5 w-full"
      />

      <div className="flex flex-col gap-2">
        <p className="text-xl leading-snug font-medium">
          {estado.fase === 'recusado' ? 'Não deu para registrar.' : 'Registrado.'}{' '}
          {estado.fase !== 'recusado' ? (
            <span className="text-muted-foreground">
              {alvo.nome} agora está <span className="text-foreground">{definicao.rotulo}</span>.
            </span>
          ) : null}
        </p>

        {estado.fase === 'recusado' || estado.fase === 'guardado' ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            {estado.fase === 'guardado' ? (
              <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : null}
            {estado.frase}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{desfecho.name}</span>
            {mudou ? (
              <span className="inline-flex items-center gap-1.5">
                <ChipTemperatura temperatura={temperaturaAntes} comDescricao={false} />
                <ArrowRight className="size-3" aria-hidden="true" />
                <ChipTemperatura temperatura={temperatura} comDescricao={false} />
              </span>
            ) : (
              <ChipTemperatura temperatura={temperatura} comDescricao={false} />
            )}
          </p>
        )}

        {resultado && !resultado.etapa_aplicada && resultado.etapa_recusa ? (
          <p className="text-sm text-muted-foreground">{fraseDaEtapa(resultado.etapa_recusa)}</p>
        ) : null}
        {resultado?.etapa_aplicada && resultado.etapa_depois ? (
          <p className="text-sm text-muted-foreground">
            Etapa: {resultado.etapa_antes}{' '}
            <ArrowRight className="inline size-3" aria-hidden="true" />{' '}
            <span className="text-foreground">{resultado.etapa_depois}</span>
            {resultado.assumiu_negocio ? ' · o negócio agora é seu' : ''}
          </p>
        ) : null}
      </div>

      {estado.fase === 'segurando' ? (
        <ContagemParaDesfazer restaMs={estado.restaMs} aoDesfazer={aoDesfazer} />
      ) : null}
      {estado.fase === 'enviando' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Gravando…
        </p>
      ) : null}

      {estado.fase !== 'recusado' ? (
        <div className="flex flex-col divide-y divide-hairline border-y border-hairline">
          {proximaTitulo ? (
            <div className="flex min-h-14 items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  Próxima: <span className="font-medium">{proximaTitulo}</span>
                </p>
                <p
                  className="text-xs text-muted-foreground"
                  title={formatarQuandoPorExtenso(proximaEm) ?? undefined}
                >
                  {formatarQuando(proximaEm) ?? 'sem data combinada'}
                </p>
              </div>
              {resultado?.task_id || estado.fase === 'segurando' ? (
                <button
                  type="button"
                  onClick={() => setRemarcando((v) => !v)}
                  className="toque h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  mudar
                </button>
              ) : null}
            </div>
          ) : null}

          {remarcando ? (
            <div className="flex items-center gap-2 py-2">
              <Input
                type="datetime-local"
                className="h-11"
                defaultValue={paraInputLocal(proximaEm)}
                onChange={(e) => {
                  const iso = doInputLocal(e.target.value);
                  if (iso) aoRemarcar(iso);
                }}
              />
            </div>
          ) : null}

          {/* Só nos 10 desfechos em que o nome não afirma o interlocutor: é essa
              resposta que separa porta batida de porta aberta (RF-MET-01), e por
              isso a consequência fica ao lado da pergunta, não no rodapé da tela.
              Pergunta em cima e botões embaixo porque, em 390px, os três numa linha
              só quebravam com um dos botões sozinho na segunda. */}
          {perguntaComQuem(desfecho) ? (
            <div className="flex flex-col gap-2 py-3">
              <p className="text-sm">Falou com quem decide?</p>
              <div className="flex gap-2">
                {(['decisor', 'funcionario'] as const).map((valor) => (
                  <button
                    key={valor}
                    type="button"
                    aria-pressed={comQuem === valor}
                    onClick={() => aoCorrigirComQuem(valor)}
                    className={cn(
                      'toque inline-flex h-11 flex-1 items-center justify-center rounded-lg border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      comQuem === valor
                        ? 'border-input bg-muted font-medium'
                        : 'border-hairline text-muted-foreground',
                    )}
                  >
                    {valor === 'decisor' ? 'Sim' : 'Outra pessoa'}
                  </button>
                ))}
              </div>
              {comQuem === comQuemPadrao(desfecho) ? (
                <p className="text-xs text-muted-foreground">
                  Sem essa resposta o contato conta como porta batida, não como porta aberta.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="py-2">
            {anotando ? (
              <textarea
                autoFocus
                rows={3}
                defaultValue={observacao}
                onBlur={(e) => aoAnotar(e.target.value)}
                placeholder="O que ficou combinado, com as palavras dele."
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAnotando(true)}
                className="toque flex min-h-12 w-full items-center gap-2 text-left text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <NotebookPen className="size-4" aria-hidden="true" />
                {observacao ? observacao : 'Anotar'}
              </button>
            )}
          </div>
        </div>
      ) : null}

      <Button type="button" className="h-12 w-full text-base" onClick={aoRegistrarOutro}>
        {estado.fase === 'recusado' ? 'Voltar' : 'Registrar outro'}
      </Button>
    </div>
  );
}

/** A linha fina que conta os 5 segundos. É o botão de salvar, ao contrário. */
function ContagemParaDesfazer({
  restaMs,
  aoDesfazer,
}: {
  restaMs: number;
  aoDesfazer: () => void;
}) {
  const fracao = Math.max(0, Math.min(1, restaMs / ESPERA_DESFAZER_MS));
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={aoDesfazer}
        className="toque inline-flex h-11 items-center gap-2 rounded-lg border border-hairline px-3.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Undo2 className="size-4" aria-hidden="true" />
        Desfazer
      </button>
      <span className="relative h-px flex-1 bg-hairline" aria-hidden="true">
        <span
          className="absolute inset-y-0 left-0 bg-foreground transition-[width] duration-200 ease-linear"
          style={{ width: `${fracao * 100}%` }}
        />
      </span>
      <span className="numerico w-6 text-right text-sm text-muted-foreground" aria-live="off">
        {Math.ceil(restaMs / 1000)}
      </span>
    </div>
  );
}

/** As recusas do lado do negócio, em português e sem susto: a atividade está gravada. */
function fraseDaEtapa(recusa: NonNullable<RegistroAceito['etapa_recusa']>): string {
  switch (recusa) {
    case 'etapa_fora_do_funil':
      return 'O contato ficou registrado. A etapa deste funil não muda por este resultado.';
    case 'contato_suprimido':
      return 'O contato ficou registrado, e só. Este parceiro pediu para não ser contatado: nada de etapa, tarefa ou fila.';
    case 'etapa_igual':
      return 'O contato ficou registrado. O parceiro já estava nessa etapa.';
    case 'etapa_mudou':
      return 'O contato ficou registrado. Alguém mudou a etapa antes; confira no funil.';
    case 'campos_obrigatorios':
      return 'O contato ficou registrado. A etapa pede campos que não vieram.';
    case 'motivo_de_perda_invalido':
      return 'O contato ficou registrado. O motivo da perda não foi aceito.';
    case 'proxima_acao_obrigatoria':
      return 'O contato ficou registrado. Essa etapa exige uma próxima ação marcada.';
    case 'proxima_acao_no_passado':
      return 'O contato ficou registrado. A data da próxima ação já passou.';
    case 'sem_permissao':
      return 'O contato ficou registrado. Este negócio é de outra pessoa.';
    default:
      return 'O contato ficou registrado.';
  }
}
