'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Camera, Layers, Pencil, TriangleAlert, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

import { copiaAtiva, type DoCanalPro, estadoDoCartao, fotosQueFaltam } from './aba-dos-anuncios';
import { BotaoDaNota, DialogoDaNota, EtiquetaDaSituacao } from './cartao-do-anuncio';
import { CarrosselDaFicha } from './carrossel-de-fotos';
import { carregarAnuncio, CHAVE_DOS_ANUNCIOS } from './dados';
import { formatarQuando } from './no-portal';
import { formatarDia, qualidadeDoAnuncio } from './regras-do-cartao';
import { type AnuncioNaLista, formatarPreco, precoDoAnuncio, tipoDeImovel } from './tipos';

/**
 * A ficha do anúncio (18/11/2026): abre por cima da lista ao clicar no cartão.
 * Junta o que saiu do cartão para ele ficar curto: as fotos, a situação explicada,
 * os números, a nota de qualidade, a ficha do imóvel, as cópias antigas do mesmo
 * imóvel no Canal Pro e "De onde veio". Editar continua no editor de sempre.
 */
export function FichaDoAnuncio({
  anuncio: a,
  doCanalPro,
  fotoInicial = 0,
  podePublicar,
  aoMudar,
  aoSincronizar,
}: {
  anuncio: AnuncioNaLista | null;
  doCanalPro: DoCanalPro | undefined;
  /** A foto em que o carrossel abre (a que estava à vista no cartão). */
  fotoInicial?: number;
  podePublicar: boolean;
  aoMudar: (aberto: boolean) => void;
  aoSincronizar: () => void;
}) {
  return (
    <Sheet open={a !== null} onOpenChange={aoMudar}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl"
      >
        {a ? (
          <Conteudo
            anuncio={a}
            doCanalPro={doCanalPro}
            fotoInicial={fotoInicial}
            podePublicar={podePublicar}
            aoSincronizar={aoSincronizar}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({
  anuncio: a,
  doCanalPro,
  fotoInicial,
  podePublicar,
  aoSincronizar,
}: {
  anuncio: AnuncioNaLista;
  doCanalPro: DoCanalPro | undefined;
  fotoInicial: number;
  podePublicar: boolean;
  aoSincronizar: () => void;
}) {
  const [notaAberta, setNotaAberta] = useState(false);
  const detalhe = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'um', a.id],
    queryFn: () => carregarAnuncio(a.id),
  });
  const estado = estadoDoCartao(a);
  const qualidade = useMemo(() => qualidadeDoAnuncio(a), [a]);
  const propria = doCanalPro?.propria ?? null;
  const copias = doCanalPro?.copias ?? [];
  const faltam = fotosQueFaltam(a, doCanalPro);
  const fotos = detalhe.data?.fotos ?? [];
  const visualizacoes = a.no_canal_pro_visualizacoes ?? propria?.visualizacoes ?? null;
  const contatos = a.no_canal_pro_contatos ?? propria?.contatos ?? null;
  const excluido = a.excluido_em !== null;

  const ficha: [string, string][] = [
    ['Tipo', tipoDeImovel(a.tipo).rotulo],
    [
      'Negócio',
      a.negocio === 'aluguel'
        ? 'Aluguel'
        : a.negocio === 'venda_aluguel'
          ? 'Venda e aluguel'
          : 'Venda',
    ],
    ['Área útil', a.area_util ? `${a.area_util.toLocaleString('pt-BR')} m²` : '—'],
    ['Área total', a.area_total ? `${a.area_total.toLocaleString('pt-BR')} m²` : '—'],
    ['Quartos', a.quartos !== null ? String(a.quartos) : '—'],
    ['Banheiros', a.banheiros !== null ? String(a.banheiros) : '—'],
    ['Vagas', a.vagas !== null ? String(a.vagas) : '—'],
    ['Bairro', a.bairro || '—'],
    ['Cidade', [a.cidade, a.estado].filter(Boolean).join(' · ') || '—'],
    ['Endereço', [a.endereco, a.numero].filter(Boolean).join(', ') || '—'],
    ['Proprietário', a.proprietario_nome || '—'],
    ['Fotos no CRM', String(a.fotos)],
  ];

  const historia: { quando: string; texto: string }[] = [];
  historia.push({
    quando: formatarDia(a.criado_em),
    texto: `${
      a.origem === 'sistema_atual'
        ? 'Entrou no CRM pelo arquivo da Arbo (o sistema atual)'
        : a.origem === 'relatorio_canal_pro'
          ? `Entrou no CRM pela lista do Canal Pro${a.codigo_no_canal_pro && a.codigo_no_canal_pro !== a.codigo ? ` (lá, ${a.codigo_no_canal_pro})` : ''}`
          : 'Cadastrado no CRM'
    }${a.criado_por_nome ? `, por ${a.criado_por_nome}` : ''}.`,
  });
  if (a.no_canal_pro_visto_em || propria?.visto_em) {
    const visto = (a.no_canal_pro_visto_em ?? propria?.visto_em)!;
    historia.push({
      quando: formatarDia(visto),
      texto: `Visto no Canal Pro: ${a.no_canal_pro_situacao ?? propria?.situacao ?? 'sem situação'}${propria?.fotos !== null && propria?.fotos !== undefined ? `, ${propria.fotos} fotos` : ''}.`,
    });
  }
  if (a.no_sistema_atual !== null && a.sistema_atual_em) {
    historia.push({
      quando: formatarDia(a.sistema_atual_em),
      texto: a.no_sistema_atual
        ? 'No arquivo da Arbo (o sistema atual) na última leitura.'
        : 'Saiu do arquivo da Arbo.',
    });
  }
  if (a.publicado_em)
    historia.push({ quando: formatarDia(a.publicado_em), texto: 'Posto no ar pelo CRM.' });
  if (a.excluido_em) {
    historia.push({
      quando: formatarDia(a.excluido_em),
      texto: `Excluído${a.motivo_exclusao ? `: “${a.motivo_exclusao}”` : '.'}`,
    });
  }
  historia.sort((x, y) =>
    y.quando.split('/').reverse().join('').localeCompare(x.quando.split('/').reverse().join('')),
  );

  return (
    <>
      <SheetHeader className="gap-1 border-b border-hairline p-5 pr-14">
        <SheetTitle className="text-lg leading-snug">{a.titulo.trim() || 'Sem título'}</SheetTitle>
        <SheetDescription>
          <span className="numerico">{a.codigo}</span> ·{' '}
          <span className="numerico">{precoDoAnuncio(a)}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 p-5">
        {detalhe.isPending ? (
          <Skeleton className="aspect-video w-full rounded-xl" />
        ) : fotos.length ? (
          <CarrosselDaFicha
            codigo={a.codigo}
            caminhos={fotos.map((f) => f.caminho)}
            inicial={fotoInicial}
          />
        ) : null}
        {faltam > 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl bg-morno-fundo p-3 text-sm text-morno-texto">
            <Camera className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="flex flex-col gap-2">
              <p>
                {a.fotos === 0
                  ? `Nenhuma foto no CRM. O Canal Pro tem ${propria?.fotos ?? faltam}.`
                  : `O CRM tem ${a.fotos} fotos e o Canal Pro, ${propria?.fotos}.`}{' '}
                A sincronização traz todas, mesmo com o anúncio não publicado.
              </p>
              {podePublicar ? (
                <Button size="sm" className="toque h-11 w-fit md:h-8" onClick={aoSincronizar}>
                  <Camera aria-hidden="true" />
                  Trazer do Canal Pro
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <EtiquetaDaSituacao estado={estado} />
          </div>
          <p className="text-sm text-muted-foreground">{estado.dica}</p>
          {a.ultima_leitura_do_portal ? (
            <p className="text-xs text-muted-foreground">
              Última leitura do Grupo OLX {formatarQuando(a.ultima_leitura_do_portal)}.
            </p>
          ) : null}
        </section>

        <section className="grid grid-cols-3 gap-2" aria-label="Números">
          <Numero
            valor={visualizacoes !== null ? visualizacoes.toLocaleString('pt-BR') : '—'}
            rotulo="visualizações"
          />
          <Numero
            valor={contatos !== null ? String(contatos) : '—'}
            rotulo="contatos no Canal Pro"
          />
          <Numero valor={String(a.leads)} rotulo="leads no CRM" />
        </section>

        {!excluido ? (
          <BotaoDaNota nota={qualidade.nota} aoAbrir={() => setNotaAberta(true)} />
        ) : null}

        <section className="flex flex-col gap-2.5">
          <h3 className="text-sm font-medium">Ficha</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            {ficha.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="break-words font-medium numerico">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {copias.length ? (
          <section className="flex flex-col gap-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
              Cópias antigas juntadas a este anúncio
            </h3>
            <p className="text-sm text-muted-foreground">
              O mesmo imóvel, com outro código no Canal Pro (mesma cidade, bairro e área). Elas não
              aparecem na lista como outro imóvel e não entram de novo pela sincronização.
            </p>
            <ul className="flex flex-col gap-2">
              {copias.map((c) => {
                const ativa = copiaAtiva(c);
                const precoDela = a.negocio === 'aluguel' ? c.preco_aluguel : c.preco_venda;
                const precoDaqui = a.negocio === 'aluguel' ? a.preco_aluguel : a.preco_venda;
                const outroPreco =
                  precoDela !== null && precoDaqui !== null && precoDela !== precoDaqui;
                return (
                  <li
                    key={c.id}
                    className="flex flex-col gap-1.5 rounded-xl border border-hairline p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-hairline px-2 py-0.5 text-xs font-medium numerico">
                        {c.codigo}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {c.situacao ?? 'Sem situação'} no Canal Pro
                        {c.excluido_em
                          ? ` · marcada como excluída ${formatarQuando(c.excluido_em)}`
                          : ''}
                      </span>
                    </div>
                    {c.titulo ? <p className="text-muted-foreground">{c.titulo}</p> : null}
                    <p className="text-xs text-muted-foreground numerico">
                      {[
                        c.fotos !== null ? `${c.fotos} fotos` : null,
                        c.visualizacoes !== null
                          ? `${c.visualizacoes.toLocaleString('pt-BR')} visualizações`
                          : null,
                        c.contatos !== null ? `${c.contatos} contatos` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {outroPreco ? (
                      <p className="flex items-start gap-1.5 rounded-lg bg-morno-fundo px-2.5 py-1.5 text-xs text-morno-texto">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        Preço diferente: {formatarPreco(precoDela)} na cópia,{' '}
                        {formatarPreco(precoDaqui)} aqui.
                      </p>
                    ) : null}
                    {ativa ? (
                      <p className="flex items-start gap-1.5 rounded-lg bg-morno-fundo px-2.5 py-1.5 text-xs text-morno-texto">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        Ativa no Canal Pro: ocupa uma vaga do plano. Exclua lá (Meus anúncios →{' '}
                        {c.codigo} → Excluir). Depois da troca, o Canal Pro fica só com o que o
                        arquivo do CRM manda.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">De onde veio</h3>
          <ul className="flex flex-col divide-y divide-hairline text-sm">
            {historia.map((h) => (
              <li
                key={`${h.quando}-${h.texto}`}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 py-2"
              >
                <span className="text-xs text-muted-foreground numerico">{h.quando}</span>
                <span>{h.texto}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <Button asChild className="toque h-11 md:h-9">
            <Link href={`/anuncios/${a.id}`}>
              <Pencil aria-hidden="true" />
              {excluido ? 'Abrir o anúncio' : 'Editar o anúncio'}
            </Link>
          </Button>
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href={`/anuncios/leads?anuncio=${encodeURIComponent(a.codigo)}`}>
              <UserRound aria-hidden="true" />
              Ver os leads
            </Link>
          </Button>
        </div>
      </div>

      <DialogoDaNota
        aberto={notaAberta}
        aoMudar={setNotaAberta}
        nota={qualidade.nota}
        itens={qualidade.itens}
        linkDoAnuncio={excluido ? null : `/anuncios/${a.id}`}
      />
    </>
  );
}

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="rounded-xl bg-muted px-3 py-2.5">
      <p className="text-lg leading-tight font-semibold numerico">{valor}</p>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
}
