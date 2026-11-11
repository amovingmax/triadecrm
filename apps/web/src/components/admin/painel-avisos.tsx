'use client';

import { useQuery } from '@tanstack/react-query';
import { BellOff, RotateCw } from 'lucide-react';

import {
  resumoDaEquipe,
  situacaoDe,
  TEXTO_DA_SITUACAO,
  textoDoCelular,
  textoDoComputador,
  type NavegadorDaPessoa,
  type QuemRecebe,
  type TextoDaCelula,
} from '@/components/avisos/avisos-da-equipe';
import { Button } from '@/components/ui/button';
import { ROTULO_PAPEL, type AppRole } from '@/lib/auth/role';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

import {
  Aviso,
  CabecalhoDeSecao,
  Contagem,
  ErroDoPainel,
  EsqueletoLista,
  ListaAdmin,
  Vazio,
  type ColunaAdmin,
} from './estados';

/**
 * Ajustes → Avisos: "Quem recebe avisos" (11/11/2026, só na Imova).
 *
 * O gargalo era não saber: o app de celular só estava no iPhone do dono, e cada
 * computador só avisava se alguém tivesse ligado a notificação do navegador. A
 * tela responde, pessoa por pessoa, se ela fica sabendo na hora quando um cliente
 * escreve, e onde. Quem não recebe nada vem primeiro, em destaque.
 *
 * Os dados vêm de `public.avisos_quem_recebe` (migração 20261111202000), que só
 * abre para admin e gestor:
 *   - CELULAR: o app do Tríade registrado para a pessoa, com o aviso de mensagem
 *     nova ligado (e a chave geral dos avisos no celular), e a última vez que o
 *     app abriu;
 *   - COMPUTADOR: cada navegador em que ela abriu o CRM nos últimos 30 dias, que
 *     o próprio navegador conta ao abrir (`avisos-deste-computador.tsx`). Conta o
 *     que está com a notificação liberada e sem "Silenciar avisos".
 *
 * Só leitura: daqui não se liga o aviso de ninguém. Quem liga é a própria pessoa,
 * no aparelho dela, e o passo a passo está na nota do fim da tela.
 */
const CHAVE = ['admin', 'avisos', 'quem-recebe'] as const;

/** A linha como o banco devolve: `navegadores` é jsonb e `situacao`, texto. */
type LinhaDoBanco = Omit<QuemRecebe, 'navegadores' | 'situacao'> & {
  navegadores: unknown;
  situacao: string;
};

async function carregar(): Promise<QuemRecebe[]> {
  const { data, error } = await createClient().rpc('avisos_quem_recebe');
  if (error) throw new Error(error.message);
  return ((data ?? []) as LinhaDoBanco[]).map((linha) => ({
    ...linha,
    navegadores: Array.isArray(linha.navegadores) ? (linha.navegadores as NavegadorDaPessoa[]) : [],
    situacao: situacaoDe(linha.situacao),
  }));
}

export function PainelAvisos() {
  const consulta = useQuery({ queryKey: CHAVE, queryFn: carregar, staleTime: 60_000 });

  if (consulta.isPending) return <EsqueletoLista linhas={5} colunas={4} />;
  if (consulta.isError) {
    return (
      <ErroDoPainel
        causa="Não deu para ler quem recebe os avisos."
        aoTentar={() => void consulta.refetch()}
      />
    );
  }

  const linhas = consulta.data;
  const agora = new Date(consulta.dataUpdatedAt);
  const resumo = resumoDaEquipe(linhas);
  const pushDesligado = linhas.length > 0 && linhas.every((l) => !l.celular_push_ligado);

  const colunas: ColunaAdmin<QuemRecebe>[] = [
    {
      id: 'pessoa',
      rotulo: 'Pessoa',
      principal: true,
      largura: 'w-[22%]',
      celula: (l) => (
        <span className="flex flex-col">
          <span className="truncate font-medium">{l.nome}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {ROTULO_PAPEL[l.papel as AppRole] ?? l.papel}
          </span>
        </span>
      ),
    },
    {
      id: 'celular',
      rotulo: 'Celular',
      largura: 'w-[26%]',
      celula: (l) => <Celula {...textoDoCelular(l, agora)} />,
    },
    {
      id: 'computador',
      rotulo: 'Computador',
      largura: 'w-[30%]',
      celula: (l) => <Celula {...textoDoComputador(l, agora)} />,
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      celula: (l) =>
        l.situacao === 'nenhum' ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-destructive-texto">
            <BellOff className="size-4 shrink-0" aria-hidden="true" />
            {TEXTO_DA_SITUACAO.nenhum}
          </span>
        ) : (
          <span>{TEXTO_DA_SITUACAO[l.situacao]}</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <CabecalhoDeSecao
        titulo="Quem recebe avisos"
        descricao="Uma linha por pessoa que atende (admin, gestor e SDR). O celular conta o app do Tríade; o computador conta cada navegador em que a pessoa abriu o CRM nos últimos 30 dias."
        contagem={
          linhas.length > 0 ? (
            <>
              <Contagem n={resumo.total} rotulo={resumo.total === 1 ? 'pessoa' : 'pessoas'} />
              {' · '}
              <Contagem n={resumo.nenhum} rotulo="sem aviso nenhum" />
            </>
          ) : undefined
        }
        acao={
          <Button
            variant="outline"
            size="sm"
            className="toque h-11 md:h-9"
            onClick={() => void consulta.refetch()}
            disabled={consulta.isFetching}
          >
            <RotateCw className={cn(consulta.isFetching && 'animate-spin')} aria-hidden="true" />
            Atualizar
          </Button>
        }
      />

      {pushDesligado ? (
        <Aviso tom="atencao" titulo="Os avisos no celular estão desligados para todos">
          A chave geral <strong>avisos.push</strong> está desligada: o app não recebe aviso nenhum,
          de ninguém, até ela voltar.
        </Aviso>
      ) : null}

      {linhas.length === 0 ? (
        <Vazio
          titulo="Ninguém atendendo"
          texto="Não há pessoa ativa com papel de admin, gestor ou SDR. Quem atende aparece aqui."
        />
      ) : (
        <ListaAdmin
          colunas={colunas}
          linhas={linhas}
          chave={(l) => l.pessoa_id}
          rotuloDaLista="Quem recebe avisos"
        />
      )}

      <Aviso titulo="Como cada pessoa passa a receber">
        <p>
          <strong>No celular:</strong> o dono convida a pessoa no TestFlight (App Store Connect →
          TestFlight → testadores), ela instala o TestFlight, aceita o convite, abre o Tríade, entra
          com o login dela e permite as notificações. O passo a passo está em{' '}
          <strong>docs/operacao/app-celular.md</strong>.
        </p>
        <p className="mt-2">
          <strong>No computador:</strong> a pessoa clica em <strong>Ligar avisos</strong>, na faixa
          do alto do CRM (ou no menu com o nome dela, em “Ativar avisos neste navegador”), e diz
          Permitir ao navegador. Depois confere em <strong>Testar aviso deste computador</strong>,
          no mesmo menu.
        </p>
        <p className="mt-2">
          O último sinal do celular é a última vez que o app abriu; o do computador, a última vez
          que o CRM foi aberto ali (conferido no máximo de hora em hora). Cada computador aparece
          depois que a pessoa abre o CRM nele.
        </p>
      </Aviso>
    </div>
  );
}

function Celula({ texto, sinal, notas, apagado }: TextoDaCelula) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className={cn(apagado && 'text-muted-foreground')}>{texto}</span>
      {sinal ? <span className="text-xs text-muted-foreground">{sinal}</span> : null}
      {/* Dois navegadores iguais na mesma situação dão a mesma frase: a chave leva a posição. */}
      {notas.map((nota, i) => (
        <span key={`${i}:${nota}`} className="text-xs leading-snug text-muted-foreground">
          {nota}
        </span>
      ))}
    </span>
  );
}
