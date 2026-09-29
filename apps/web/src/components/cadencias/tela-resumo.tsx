'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Moon, RotateCw, Sunrise } from 'lucide-react';

import { LEITURA } from '@/lib/larguras';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { buscarResumo, mensagemDoErro } from './consultas';
import { ErroDaTela, EsqueletoDoResumo } from './estados';
import { diaPorExtenso } from './formatos';
import { BlocoDaManha } from './resumo-manha';
import { BlocoDaNoite } from './resumo-noite';
import { MOMENTOS, type Momento } from './tipos';

/**
 * O resumo das 07:30 e das 18:00 (RF-AST-02; R07 §8.1 e §8.2).
 *
 * De manhã responde "quem te espera hoje, e por quê". À noite, "o que ficou". São
 * duas leituras do MESMO dia: o botão troca o recorte, não a fonte — os dois blocos
 * vêm de `public.resumo_do_dia`, que já recorta o dia civil de Fortaleza.
 *
 * Três decisões que valem estar escritas:
 *
 * 1. **A tela não finge que a mensagem saiu.** O resumo deveria chegar por WhatsApp
 *    às 07:30 e às 18:00; enquanto o número da Meta não existir, ele existe só aqui,
 *    e a primeira linha da tela diz isso. `entrega.envio_automatico` é dado do banco,
 *    não prosa: no dia em que o trabalhador subir, a frase muda sozinha.
 *
 * 2. **São duas pessoas, não um call center.** O R07 §4.2 é explícito: celebrar antes
 *    de cobrar, e distinguir "não fez" de "não registrou". Por isso a noite abre pelo
 *    que foi feito, e um dia sem nenhum registro não vira um zero acusatório — vira
 *    a pergunta de sempre, se teve coisa que não entrou.
 *
 * 3. **A ordem da fila não é reinventada aqui.** Ela sai de `public.meu_dia`, a mesma
 *    do "Meu dia" e do relatório de segunda. Duas ordenações de urgência no mesmo
 *    produto seriam duas verdades sobre o que é urgente.
 */
export function TelaResumo({ nome }: { nome: string }) {
  const clienteDeConsultas = useQueryClient();
  // `null` = o momento que o relógio disser. Só vira 'manha'/'noite' quando a pessoa
  // escolhe, e aí a tela avisa que está olhando o outro recorte.
  const [escolhido, setEscolhido] = useState<Momento | null>(null);

  const resumo = useQuery({
    queryKey: ['cadencias', 'resumo', escolhido],
    queryFn: () => buscarResumo(escolhido),
  });

  const atualizar = useCallback(() => {
    void clienteDeConsultas.invalidateQueries({ queryKey: ['cadencias', 'resumo'] });
  }, [clienteDeConsultas]);

  const dados = resumo.data;
  const momento = dados?.momento ?? escolhido ?? 'manha';

  return (
    <div className={cn(LEITURA, 'flex flex-col gap-5')}>
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">Resumo do dia</h1>
            <p className="text-sm text-muted-foreground">
              {dados ? (
                <>
                  {diaPorExtenso(dados.dia)}
                  {dados.pessoa.eu_mesmo ? '' : ` · ${dados.pessoa.nome ?? 'outra pessoa'}`}
                  {dados.dia_de_operacao ? '' : ' · domingo ou feriado: o time não sai a campo'}
                </>
              ) : resumo.isError ? (
                'não deu para ler o resumo'
              ) : (
                'carregando o dia...'
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button asChild variant="outline" className="toque h-11 md:h-9">
              <Link href="/cadencias">
                <span className="hidden sm:inline">Cadências</span>
                <span className="sm:hidden">Réguas</span>
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={atualizar}
              disabled={resumo.isFetching}
              aria-label="Atualizar o resumo"
              className="toque h-11 md:h-9"
            >
              <RotateCw className={cn(resumo.isFetching && 'animate-spin')} aria-hidden="true" />
              <span className="sr-only">Atualizar</span>
            </Button>
          </div>
        </div>

        <SeletorDeMomento
          momento={momento}
          doRelogio={dados?.momento_do_relogio ?? null}
          aoEscolher={setEscolhido}
        />
      </header>

      {resumo.isPending ? (
        <EsqueletoDoResumo />
      ) : resumo.isError || !dados ? (
        <ErroDaTela
          titulo="Não deu para carregar o resumo"
          causa={mensagemDoErro(resumo.error)}
          aoTentar={atualizar}
        />
      ) : (
        <>
          <AvisoDaEntrega resumo={dados} />
          {dados.momento === 'manha' ? (
            <BlocoDaManha resumo={dados} nome={nome} />
          ) : (
            <BlocoDaNoite resumo={dados} nome={nome} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Manhã ou noite.
 *
 * Não é um filtro qualquer: o resumo das 07:30 e o das 18:00 são duas mensagens
 * diferentes do R07, e ver a de fim de dia às nove da manhã é legítimo (a Heloísa
 * quer saber o que sobrou de ontem à noite). O que a tela não pode fazer é esconder
 * qual dos dois o relógio pediria — daí a marca no botão.
 */
function SeletorDeMomento({
  momento,
  doRelogio,
  aoEscolher,
}: {
  momento: Momento;
  doRelogio: Momento | null;
  aoEscolher: (m: Momento) => void;
}) {
  const rotulos: Record<Momento, { texto: string; hora: string; icone: React.ReactNode }> = {
    manha: {
      texto: 'Quem te espera hoje',
      hora: '07:30',
      icone: <Sunrise className="size-4" aria-hidden="true" />,
    },
    noite: {
      texto: 'O que ficou',
      hora: '18:00',
      icone: <Moon className="size-4" aria-hidden="true" />,
    },
  };

  return (
    <div
      role="group"
      aria-label="Momento do resumo"
      // O mesmo desenho do `SeletorDeAba` (pílula branca, a escolha em menta):
      // era o último seletor do CRM com a escolha em tinta preta, que é a cor
      // do botão de ação — e escolher manhã ou noite não é uma ação.
      className="sombra-base flex w-full gap-1 rounded-full bg-card p-1 sm:w-fit"
    >
      {MOMENTOS.map((m) => {
        const ativo = m === momento;
        return (
          <button
            key={m}
            type="button"
            onClick={() => aoEscolher(m)}
            aria-pressed={ativo}
            className={cn(
              'toque flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors sm:min-h-8 sm:flex-none',
              ativo
                ? 'bg-menta text-menta-tinta'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {rotulos[m].icone}
            <span className="numerico">{rotulos[m].hora}</span>
            <span className="hidden sm:inline">{rotulos[m].texto}</span>
            {doRelogio === m ? <span className="sr-only">(o horário de agora)</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Se este resumo saiu por WhatsApp ou existe só aqui.
 *
 * UMA LINHA, SEM CAIXA (29/09/2026). Era uma faixa branca com borda e duas
 * orações ("não é enviado... enquanto o número aprovado na Meta não estiver
 * ligado... abra a tela para vê-lo") logo abaixo do seletor: a mesma altura de
 * um cartão para uma informação de rodapé.
 */
function AvisoDaEntrega({ resumo }: { resumo: { entrega: { horario_manha: string; horario_noite: string; envio_automatico: boolean; worker_whatsapp_ativo: boolean } } }) {
  const sai = resumo.entrega.envio_automatico && resumo.entrega.worker_whatsapp_ativo;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" aria-hidden="true" />
      {sai ? (
        <span>
          Sai por WhatsApp às <span className="numerico">{resumo.entrega.horario_manha}</span> e às{' '}
          <span className="numerico">{resumo.entrega.horario_noite}</span>.
        </span>
      ) : (
        <span>Ainda não sai por WhatsApp: por enquanto, o resumo existe só nesta tela.</span>
      )}
    </p>
  );
}
