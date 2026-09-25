'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import {
  lerPesosDaTriagem,
  repontuarORadar,
  salvarPesosDaTriagem,
  type PesosDaTriagem,
} from './dados';
import type { CatalogosDoRadar } from './tipos';

/**
 * Os pesos da triagem, editáveis por quem vende.
 *
 * ===========================================================================
 * POR QUE ISTO É UMA TELA, E NÃO UMA CONSTANTE
 * ===========================================================================
 * A triagem ordena a fila de Revisão por nota, avaliações, categoria e cidade. O
 * quanto cada uma dessas coisas vale é pergunta de negócio, e a resposta muda:
 * num mês a KOMUNE precisa de espaço para festa grande, no outro precisa de
 * buffet barato. Quem sabe isso é quem vende, e ele não abre um editor de código
 * nem espera deploy.
 *
 * Por isso os números vivem em `app_settings` e esta folha os edita. O banco
 * obedece; o código não guarda nenhum deles.
 *
 * ===========================================================================
 * AS DUAS COISAS QUE ESTA FOLHA FAZ QUESTÃO DE MOSTRAR
 * ===========================================================================
 * 1. **O efeito, em número.** Salvar repontua a fila inteira e diz quantos
 *    candidatos mudaram de lugar. Mexer em peso sem ver o resultado é mexer no
 *    escuro, e a segunda vez que isso acontece a pessoa para de mexer.
 * 2. **Que nada é descartado.** A frase está na folha porque a dúvida aparece
 *    sozinha na cabeça de quem baixa um peso: "será que sumi com alguém?".
 *    Ninguém sai da fila (RF-RAD-08) — a triagem ordena, e a decisão continua
 *    humana.
 */
export function PesosDaTriagem({
  catalogos,
  className,
}: {
  catalogos: CatalogosDoRadar;
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        className={cn('toque h-11 md:h-9', className)}
        onClick={() => setAberta(true)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Pesos da triagem
      </Button>
      {aberta ? (
        <Folha catalogos={catalogos} aberta={aberta} aoFechar={() => setAberta(false)} />
      ) : null}
    </>
  );
}

function Folha({
  catalogos,
  aberta,
  aoFechar,
}: {
  catalogos: CatalogosDoRadar;
  aberta: boolean;
  aoFechar: () => void;
}) {
  const clientes = useQueryClient();
  const atuais = useQuery({ queryKey: ['radar', 'pesos'], queryFn: lerPesosDaTriagem });

  // O formulário só nasce quando os pesos chegam, e nasce COM eles.
  //
  // A versão anterior copiava a resposta para o estado dentro de um efeito, e o
  // lint do React reclamou com razão: além do render a mais, o efeito precisava
  // de um "só na primeira vez" para não apagar o que a pessoa acabou de digitar
  // quando a consulta revalidasse. Nascer pronto não tem esse problema.
  if (atuais.data === undefined) {
    return (
      <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Pesos da triagem</SheetTitle>
            <SheetDescription>
              O que faz um candidato valer o trabalho de achar o telefone.
            </SheetDescription>
          </SheetHeader>
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {atuais.isError ? 'Não deu para ler os pesos.' : 'Carregando...'}
          </p>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Formulario
      catalogos={catalogos}
      iniciais={atuais.data}
      aberta={aberta}
      aoFechar={aoFechar}
      clientes={clientes}
    />
  );
}

function Formulario({
  catalogos,
  iniciais,
  aberta,
  aoFechar,
  clientes,
}: {
  catalogos: CatalogosDoRadar;
  iniciais: PesosDaTriagem;
  aberta: boolean;
  aoFechar: () => void;
  clientes: ReturnType<typeof useQueryClient>;
}) {
  const [rascunho, setRascunho] = useState<PesosDaTriagem>(iniciais);

  const salvar = useMutation({
    mutationFn: async (p: PesosDaTriagem) => {
      await salvarPesosDaTriagem(p);
      return repontuarORadar();
    },
    onSuccess: (r) => {
      toast.success('Pesos salvos.', {
        description: `A fila foi reordenada: ${r.candidatos} ${r.candidatos === 1 ? 'candidato repontuado' : 'candidatos repontuados'}.`,
      });
      void clientes.invalidateQueries({ queryKey: ['radar'] });
      aoFechar();
    },
    onError: (erro: Error) => {
      toast.error('Os pesos não foram salvos.', { description: erro.message });
    },
  });

  const p = rascunho;
  const somaDosPesos = p.pesoNota + p.pesoAvaliacoes + p.pesoCategoria + p.pesoCidade;

  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Pesos da triagem</SheetTitle>
          <SheetDescription>
            O que faz um candidato valer o trabalho de achar o telefone. A fila é ordenada por
            isto — ninguém é descartado.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <section className="space-y-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Quanto vale cada sinal
              </h3>
              <Numero
                rotulo="Nota na fonte"
                dica="A nota que o site dá ao fornecedor."
                valor={p.pesoNota}
                aoMudar={(v) => setRascunho({ ...p, pesoNota: v })}
              />
              <Numero
                rotulo="Quantidade de avaliações"
                dica="Quem tem muita avaliação é um negócio que já atende."
                valor={p.pesoAvaliacoes}
                aoMudar={(v) => setRascunho({ ...p, pesoAvaliacoes: v })}
              />
              <Numero
                rotulo="Categoria prioritária"
                dica={
                  p.categoriasPrioritarias.length === 0
                    ? 'Sem categoria escolhida abaixo, este peso não conta para ninguém.'
                    : `Vale para ${p.categoriasPrioritarias.length} categoria(s).`
                }
                valor={p.pesoCategoria}
                aoMudar={(v) => setRascunho({ ...p, pesoCategoria: v })}
              />
              <Numero
                rotulo="Cidade-alvo"
                dica={`Vale para ${p.cidadesAlvo.length} cidade(s).`}
                valor={p.pesoCidade}
                aoMudar={(v) => setRascunho({ ...p, pesoCidade: v })}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Os pesos são relativos: o que importa é a proporção entre eles, não a soma (hoje{' '}
                <span className="numerico">{somaDosPesos}</span>). A pontuação final é sempre de 0 a
                100.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                A partir de quando conta
              </h3>
              <Numero
                rotulo="Nota mínima"
                dica="Abaixo disso, a nota não rende ponto nenhum."
                valor={p.notaMinima}
                passo={0.1}
                max={5}
                aoMudar={(v) => setRascunho({ ...p, notaMinima: v })}
              />
              <Numero
                rotulo="Avaliações para valer o ponto cheio"
                dica="Quem tiver esta quantidade já leva o peso inteiro."
                valor={p.avaliacoesParaValer}
                max={500}
                aoMudar={(v) => setRascunho({ ...p, avaliacoesParaValer: v })}
              />
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Onde ficam as faixas
              </h3>
              <Numero
                rotulo="A+ a partir de"
                valor={p.corteAMais}
                aoMudar={(v) => setRascunho({ ...p, corteAMais: v })}
              />
              <Numero
                rotulo="A a partir de"
                valor={p.corteA}
                aoMudar={(v) => setRascunho({ ...p, corteA: v })}
              />
              <Numero
                rotulo="B a partir de"
                dica="Abaixo disso é C. Ninguém sai da fila por ser C."
                valor={p.corteB}
                aoMudar={(v) => setRascunho({ ...p, corteB: v })}
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Categorias prioritárias
              </h3>
              <Marcadores
                opcoes={catalogos.categorias.map((c) => ({ chave: c.id, rotulo: c.nome }))}
                escolhidas={p.categoriasPrioritarias}
                aoAlternar={(id) =>
                  setRascunho({
                    ...p,
                    categoriasPrioritarias: alternar(p.categoriasPrioritarias, id),
                  })
                }
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Cidades-alvo
              </h3>
              <Marcadores
                opcoes={catalogos.cidades.map((c) => ({ chave: c.nome, rotulo: c.nome }))}
                escolhidas={p.cidadesAlvo}
                aoAlternar={(nome) =>
                  setRascunho({ ...p, cidadesAlvo: alternar(p.cidadesAlvo, nome) })
                }
              />
            </section>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
          <Button
            className="toque h-11 md:h-9"
            disabled={salvar.isPending}
            onClick={() => salvar.mutate(p)}
          >
            {salvar.isPending ? 'Salvando e reordenando...' : 'Salvar e reordenar a fila'}
          </Button>
          <Button variant="ghost" className="toque h-11 md:h-9" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function alternar<T>(lista: readonly T[], item: T): T[] {
  return lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item];
}

function Numero({
  rotulo,
  dica,
  valor,
  aoMudar,
  passo = 1,
  max = 100,
}: {
  rotulo: string;
  dica?: string;
  valor: number;
  aoMudar: (v: number) => void;
  passo?: number;
  max?: number;
}) {
  const id = `peso-${rotulo.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm">
          {rotulo}
        </label>
        {dica ? <p className="text-[11px] leading-relaxed text-muted-foreground">{dica}</p> : null}
      </div>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={passo}
        value={String(valor)}
        onChange={(e) => aoMudar(Number(e.target.value))}
        className="numerico h-11 w-20 shrink-0 text-right md:h-9"
      />
    </div>
  );
}

function Marcadores<T extends string | number>({
  opcoes,
  escolhidas,
  aoAlternar,
}: {
  opcoes: { chave: T; rotulo: string }[];
  escolhidas: readonly T[];
  aoAlternar: (chave: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const ligada = escolhidas.includes(o.chave);
        return (
          <button
            key={String(o.chave)}
            type="button"
            aria-pressed={ligada}
            onClick={() => aoAlternar(o.chave)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              ligada
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-hairline text-muted-foreground hover:border-input',
            )}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
