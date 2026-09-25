'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';

import { agendarColeta, buscarFontes } from './dados';

/**
 * Mandar o Radar trabalhar, pela tela.
 *
 * ===========================================================================
 * POR QUE ISTO NÃO EXISTIA, E POR QUE PRECISA EXISTIR
 * ===========================================================================
 * Agendar coleta era `ingest --agendar --fonte=<slug>` num terminal. O efeito
 * disso apareceu em 17/09/2026: a última coleta tinha 9 dias, a fila estava
 * zerada, e a tela dizia "o coletor está parado" — verdade que levava à
 * conclusão errada, porque o coletor parado era consequência, não causa. Não
 * havia o que coletar porque ninguém tinha mandado.
 *
 * ===========================================================================
 * AS TRÊS ESCOLHAS DESTA FOLHA
 * ===========================================================================
 * 1. **Só fonte ligada aparece na lista.** Fonte desligada não é opção a ser
 *    recusada depois do clique: ligar exige conferir robots.txt e termos
 *    (RF-RAD-01), e essa é outra conversa, na aba Fontes.
 * 2. **Páginas por categoria tem teto de 10, e o padrão é 1.** A página 1 de
 *    cada categoria é onde mora quem a fonte considera mais relevante; cinco
 *    páginas de cauda longa enchem a fila de revisão de gente que ninguém vai
 *    contatar. Quem quiser mais, escolhe — mas escolhe de propósito.
 * 3. **O aviso do que vai acontecer fica ANTES do botão**, não depois. Uma
 *    coleta visita o servidor de outra empresa com o nosso nome; quem aperta
 *    precisa saber disso enquanto decide, não enquanto espera.
 */
export function AgendarColeta({ className }: { className?: string }) {
  const [aberta, setAberta] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        className={cn('toque h-11 md:h-9', className)}
        onClick={() => setAberta(true)}
      >
        <Radio aria-hidden="true" />
        Coletar agora
      </Button>
      <Folha aberta={aberta} aoFechar={() => setAberta(false)} />
    </>
  );
}

/** Quantas páginas de listagem por categoria. O banco corta em 10 de todo jeito. */
const PAGINAS = [1, 2, 3, 5, 10] as const;

function Folha({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const clientes = useQueryClient();
  const [fonteId, setFonteId] = useState<string>('');
  const [paginas, setPaginas] = useState<string>('1');

  const fontes = useQuery({
    queryKey: ['radar', 'fontes'],
    queryFn: buscarFontes,
    staleTime: 60_000,
    enabled: aberta,
  });

  // Coletáveis são as fontes de site LIGADAS: as de origem humana (indicação,
  // contato pessoal, planilha) entram na base por outra porta e não têm o que
  // varrer.
  const coletaveis = (fontes.data ?? []).filter((f) => f.ligada && f.base_url !== null);

  const agendar = useMutation({
    mutationFn: () =>
      agendarColeta({ fonteId: Number(fonteId), maxPaginas: Number(paginas) }),
    onSuccess: (r) => {
      toast.success(`Coleta de ${r.fonte} na fila.`, {
        description: 'O coletor pega a ordem em segundos. Os candidatos aparecem na fila de revisão.',
      });
      void clientes.invalidateQueries({ queryKey: ['radar'] });
      aoFechar();
    },
    onError: (erro: Error) => {
      toast.error('A coleta não foi agendada.', { description: erro.message });
    },
  });

  const escolhida = coletaveis.find((f) => String(f.id) === fonteId) ?? null;

  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Coletar agora</SheetTitle>
          <SheetDescription>
            O robô varre a fonte e traz candidatos para a fila de revisão. Nada vira parceiro sem
            alguém decidir.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div className="space-y-1">
            <label htmlFor="fonte-da-coleta" className="text-xs text-muted-foreground">
              Fonte
            </label>
            <Select value={fonteId} onValueChange={setFonteId}>
              <SelectTrigger id="fonte-da-coleta" className="toque h-11 w-full md:h-9">
                <SelectValue placeholder={fontes.isPending ? 'Carregando...' : 'Escolha a fonte'} />
              </SelectTrigger>
              <SelectContent>
                {coletaveis.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fontes.data && coletaveis.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Nenhuma fonte de site está ligada. Ligue uma na aba Fontes — ligar exige conferir o
                robots.txt e os termos dela.
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label htmlFor="paginas-da-coleta" className="text-xs text-muted-foreground">
              Páginas por categoria
            </label>
            <Select value={paginas} onValueChange={setPaginas}>
              <SelectTrigger id="paginas-da-coleta" className="toque h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGINAS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 1 ? '1 página (só a primeira)' : `${n} páginas`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A primeira página traz quem a fonte considera mais relevante. Mais páginas trazem
              cauda longa — e enchem a fila de revisão.
            </p>
          </div>

          {escolhida ? (
            <p className="rounded-lg border border-hairline bg-card/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              A coleta respeita o robots.txt de {escolhida.nome} e espera{' '}
              <span className="numerico">{escolhida.intervalo_segundos}</span> s entre as páginas.
              Quando a fonte barra, o coletor para e registra o motivo em vez de tentar outro
              caminho.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
          <Button
            className="toque h-11 md:h-9"
            disabled={fonteId === '' || agendar.isPending}
            onClick={() => agendar.mutate()}
          >
            {agendar.isPending ? 'Agendando...' : 'Agendar a coleta'}
          </Button>
          <Button variant="ghost" className="toque h-11 md:h-9" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
