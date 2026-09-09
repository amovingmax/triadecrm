'use client';

import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

import {
  buscarNegociosDaCadencia,
  chaveDosNegociosDaCadencia,
  matricular,
  mensagemDoErro,
} from './consultas';
import {
  fraseDoPrimeiroToque,
  mensagemDaRecusaDeMatricula,
  recusaPedeCampo,
  type NegocioParaCadencia,
} from './tipos';

/**
 * O outro lado da porta: a pessoa já escolheu a régua e agora escolhe quem entra.
 *
 * A lista NÃO é o funil inteiro com um filtro por cima. Ela é o que
 * `public.negocios_para_cadencia` devolve — cada linha conferida por
 * `app.recusa_de_matricula`, o mesmo guarda da gravação. Quem está suprimido, quem já
 * está numa régua, quem tem toque pendente e quem está numa etapa de encerramento
 * simplesmente não chegam aqui, e não chegam porque o banco não os manda: a tela não
 * tem uma lista de exclusão própria para divergir da dele.
 *
 * A única recusa que sobrevive na lista é `gancho_obrigatorio`, e ela sobrevive de
 * propósito: não é um "não", é um "escreva o gancho primeiro" — e o campo está logo
 * abaixo. Esconder essas linhas esvaziaria a régua de reativação inteira sem dizer
 * por quê.
 */
export function DialogoDeMatricula({
  cadencia,
  aoFechar,
}: {
  /** `null` fecha o diálogo. A régua vem do cartão que abriu. */
  cadencia: { slug: string; nome: string } | null;
  aoFechar: () => void;
}) {
  return (
    <Dialog open={cadencia !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sombra-base-forte sm:max-w-lg">
        {/* A `key` é o reset: trocar de régua monta a busca do zero, e o gancho
            escrito para uma não vaza para a outra. */}
        {cadencia ? <Conteudo key={cadencia.slug} cadencia={cadencia} aoFechar={aoFechar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({
  cadencia,
  aoFechar,
}: {
  cadencia: { slug: string; nome: string };
  aoFechar: () => void;
}) {
  const idBusca = useId();
  const idGancho = useId();
  const cliente = useQueryClient();
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [gancho, setGancho] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: chaveDosNegociosDaCadencia(cadencia.slug, busca),
    queryFn: () => buscarNegociosDaCadencia(cadencia.slug, busca),
    // A lista envelhece rápido: basta alguém matricular o mesmo parceiro em outra
    // aba para uma linha daqui virar uma recusa no envio.
    staleTime: 0,
    // Enquanto a busca nova não chega, a anterior continua na tela em vez de piscar
    // um esqueleto a cada tecla.
    placeholderData: (anterior) => anterior,
  });

  const dados = lista.data?.ok ? lista.data : null;
  // A RPC pode recusar a pergunta inteira (papel sem matrícula, régua desligada
  // entre a leitura da tela e este clique). O motivo é do banco, e é ele que a
  // pessoa lê — não um "não foi possível" nosso.
  const recusaDaLista = lista.data && !lista.data.ok ? lista.data.motivo : null;
  const negocios = dados?.negocios ?? [];
  const alvo = negocios.find((n) => n.deal_id === escolhido) ?? null;
  const precisaDeGancho = dados?.cadencia.exige_gancho ?? false;

  async function enviar() {
    if (!alvo) return;
    setSalvando(true);
    setFalha(null);
    try {
      const resposta = await matricular({
        organizationId: alvo.organization_id,
        slug: cadencia.slug,
        gancho: precisaDeGancho ? gancho : null,
        dealId: alvo.deal_id,
      });
      if (!resposta.ok) {
        setFalha(mensagemDaRecusaDeMatricula(resposta.motivo));
        void lista.refetch();
        return;
      }
      toast.success(`${alvo.organizacao} entrou em ${cadencia.nome}.`, {
        description: fraseDoPrimeiroToque(resposta.primeiro_toque),
      });
      void cliente.invalidateQueries({ queryKey: ['cadencias'] });
      aoFechar();
    } catch (erro) {
      setFalha(mensagemDoErro(erro));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-10">Matricular em {cadencia.nome}</DialogTitle>
        <DialogDescription>
          {dados?.cadencia.nota_de_entrada
            ? `Entra aqui quem: ${dados.cadencia.nota_de_entrada}`
            : 'A régua agenda as tarefas de acompanhamento; ela não envia nada sozinha.'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idBusca} className="sr-only">
            Buscar parceiro pelo nome
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={idBusca}
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar pelo nome do parceiro"
              className="h-11 pl-9 md:h-9"
            />
          </div>
        </div>

        {lista.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">Carregando quem pode entrar nesta régua.</span>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : lista.isError ? (
          <p role="alert" className="text-sm text-destructive-texto">
            {mensagemDoErro(lista.error)}
          </p>
        ) : recusaDaLista ? (
          <p role="alert" className="text-sm text-destructive-texto">
            {mensagemDaRecusaDeMatricula(recusaDaLista)}
          </p>
        ) : negocios.length === 0 ? (
          <p className="rounded-lg border border-hairline px-3 py-6 text-center text-sm text-muted-foreground">
            {busca.trim()
              ? 'Nenhum parceiro com esse nome pode entrar nesta régua agora.'
              : 'Ninguém pode entrar nesta régua agora. Quem está suprimido, já numa régua, com toque pendente ou numa etapa de encerramento fica de fora — é o banco que decide, e é assim que a régua não atropela ninguém.'}
          </p>
        ) : (
          <ul
            aria-label="Parceiros que podem entrar"
            className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-hairline"
          >
            {negocios.map((negocio) => (
              <LinhaDeNegocio
                key={negocio.deal_id}
                negocio={negocio}
                marcado={negocio.deal_id === escolhido}
                aoEscolher={() => {
                  setEscolhido(negocio.deal_id);
                  setFalha(null);
                }}
              />
            ))}
          </ul>
        )}

        {precisaDeGancho && alvo ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={idGancho} className="text-sm font-medium">
              Gancho do novo contato
            </label>
            <Input
              id={idGancho}
              value={gancho}
              onChange={(evento) => setGancho(evento.target.value)}
              placeholder="Ex.: lead real de casamento em dezembro no bairro dele"
              className="h-11 md:h-9"
            />
            <p className="text-xs text-muted-foreground">
              Sem gancho o banco recusa, e é de propósito: reativar sem motivo real é recomeçar do
              zero com quem já disse não uma vez.
            </p>
          </div>
        ) : null}

        {falha ? (
          <p role="alert" className="text-sm text-destructive-texto">
            {falha}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={aoFechar} className="toque h-11 md:h-9">
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={() => void enviar()}
          disabled={!alvo || salvando || (precisaDeGancho && gancho.trim().length === 0)}
          className="toque h-11 md:h-9"
        >
          {salvando ? (
            <>
              <Loader2 aria-hidden="true" className="animate-spin" />
              Matriculando...
            </>
          ) : (
            'Matricular'
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Um parceiro elegível: nome, onde ele está no funil e de quem ele é. */
function LinhaDeNegocio({
  negocio,
  marcado,
  aoEscolher,
}: {
  negocio: NegocioParaCadencia;
  marcado: boolean;
  aoEscolher: () => void;
}) {
  return (
    <li className="border-b border-hairline last:border-b-0">
      <label
        className={cn(
          'toque flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors',
          marcado ? 'bg-muted' : 'hover:bg-muted/50',
        )}
      >
        <input
          type="radio"
          name="negocio-da-cadencia"
          value={negocio.deal_id}
          checked={marcado}
          onChange={aoEscolher}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{negocio.organizacao}</span>
          <span className="text-xs text-muted-foreground">
            {negocio.etapa}
            {negocio.dono ? ` · ${negocio.dono}` : ' · sem responsável'}
          </span>
          {recusaPedeCampo(negocio.motivo) ? (
            <span className="text-xs text-muted-foreground">Falta o gancho, aqui embaixo.</span>
          ) : null}
        </span>
      </label>
    </li>
  );
}
