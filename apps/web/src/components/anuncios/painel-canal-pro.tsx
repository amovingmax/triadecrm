'use client';

import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Copy, KeyRound, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

import {
  ajustarCanalPro,
  ajustarPlanoDoCanalPro,
  carregarCanalPro,
  CHAVE_DO_CANAL_PRO,
  CHAVE_DOS_ANUNCIOS,
  publicarAnuncio,
  trocarChaveDoCanalPro,
  urlDeLeads,
  urlDoArquivo,
} from './dados';
import { formatarQuando } from './no-portal';
import { type AnuncioNaLista, fraseDaRecusa, lerInteiro, type SituacaoDoCanalPro } from './tipos';

/**
 * A integração com o Canal Pro, numa folha (04/11/2026).
 *
 * O Grupo OLX não tem API de anúncio: a imobiliária cola UMA URL no Canal Pro e
 * o robô deles baixa o arquivo a cada 12 horas. Esta folha tem o que é preciso
 * para isso — o contato que vai em cada anúncio (Name e Email são obrigatórios
 * no VRSync), a URL para copiar e o passo a passo — e diz quando foi a última
 * leitura.
 *
 * A URL tem a chave secreta do arquivo e só aparece para admin e gestor (o banco
 * nem a devolve para o SDR). Trocar a chave derruba a URL antiga na hora.
 *
 * ANTES DE COLAR (06/11/2026). Com o arquivo do CRM no Canal Pro, excluir ou
 * tirar do ar no CRM tira do portal na leitura seguinte — é a integração que o
 * usuário pediu. Mas o arquivo só leva o que está no ar NO CRM: o que está no
 * portal pelo sistema atual e é rascunho aqui sairia do ar na troca. A folha
 * lista esses e põe todos no ar pelo CRM com um clique, antes de colar.
 */
export function PainelCanalPro({
  aberto,
  aoMudar,
  podeAjustar,
  aAssumir,
  soNoCanalProNoAr,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  podeAjustar: boolean;
  /** No portal por fora do CRM e não no ar no CRM: sairiam do ar na troca. */
  aAssumir: AnuncioNaLista[];
  /** Ativos no Canal Pro sem anúncio no CRM (cadastrados lá): o CRM não os tira. */
  soNoCanalProNoAr: number;
}) {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_DO_CANAL_PRO,
    queryFn: carregarCanalPro,
    enabled: aberto,
  });
  const [trocando, setTrocando] = useState(false);
  const [confirmarTroca, setConfirmarTroca] = useState(false);
  const dados = consulta.data;

  async function trocarChave() {
    setTrocando(true);
    const r = await trocarChaveDoCanalPro();
    setTrocando(false);
    setConfirmarTroca(false);
    if (!r.ok) {
      toast.error('Não deu para trocar o endereço.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success('Endereço novo criado. Cole o novo no Canal Pro: o antigo já não funciona.');
    void cliente.invalidateQueries({ queryKey: CHAVE_DO_CANAL_PRO });
  }

  const chave = dados?.chave ?? null;

  return (
    <Sheet open={aberto} onOpenChange={aoMudar}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg"
        // A folha abre para ler; o cursor no primeiro campo, com o nome
        // selecionado, parecia pedir para preencher (06/11/2026).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Ajustes do Canal Pro</SheetTitle>
          <SheetDescription>
            O CRM publica um arquivo com os anúncios no ar, e o Grupo OLX o lê a cada 12 horas. O
            plano do Canal Pro continua o mesmo: os destaques gastam a cota contratada.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
          {consulta.isPending ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : consulta.isError || !dados ? (
            <p className="text-sm text-muted-foreground">Não deu para carregar a integração.</p>
          ) : (
            <>
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">Leituras</h3>
                <p className="text-sm text-muted-foreground">
                  {dados.ultimaLeitura
                    ? `Última leitura do Grupo OLX ${formatarQuando(dados.ultimaLeitura.em)}, com ${dados.ultimaLeitura.anuncios} ${dados.ultimaLeitura.anuncios === 1 ? 'anúncio' : 'anúncios'}. ${dados.leiturasSeteDias} ${dados.leiturasSeteDias === 1 ? 'leitura' : 'leituras'} nos últimos 7 dias.`
                    : 'O Grupo OLX ainda não leu o arquivo.'}
                </p>
              </section>

              <Contato
                // Nasce de novo quando o banco muda: o formulário parte do que está gravado.
                key={[dados.nome, dados.email, dados.telefone, dados.site].join('|')}
                dados={dados}
                podeAjustar={podeAjustar}
              />

              <Plano
                key={[dados.plano.anuncios, dados.plano.destaques].join('|')}
                plano={dados.plano}
                podeAjustar={podeAjustar}
              />

              {podeAjustar && chave ? (
                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium">O endereço do arquivo</h3>
                  <EnderecoDoArquivo chave={chave} />
                  <AntesDeColar aAssumir={aAssumir} soNoCanalProNoAr={soNoCanalProNoAr} />
                  <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                    <li>Salve o contato e resolva o quadro &ldquo;Antes de colar&rdquo;.</li>
                    <li>
                      Entre no Canal Pro com o login da imobiliária e abra Integração de anúncios.
                    </li>
                    <li>
                      Escolha o integrador (se a lista pedir, Desenvolvedor próprio) e cole este
                      endereço no campo do XML.
                    </li>
                    <li>Espere a primeira leitura: até 12 horas. Ela aparece aqui em cima.</li>
                    <li>
                      Confira o Relatório de integração do Canal Pro: é lá que o Grupo OLX diz se
                      recusou algum anúncio.
                    </li>
                  </ol>
                  <p className="text-sm">
                    Daí em diante, excluir ou tirar do ar no CRM tira do ZAP, do Viva Real e da OLX
                    na leitura seguinte do Grupo OLX (até 12 horas).
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Os anúncios que já estão no Canal Pro continuam lá. Um anúncio do CRM igual a um
                    que já existe lá é recusado por duplicidade: apague o antigo no Canal Pro antes.
                  </p>
                  {confirmarTroca ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
                      <p className="text-sm">
                        O endereço atual para de funcionar na hora, e o Grupo OLX não lê mais nada
                        até o novo ser colado no Canal Pro. Use só se o endereço vazou.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={trocando}
                          className="toque h-11 md:h-9"
                          onClick={() => void trocarChave()}
                        >
                          {trocando ? 'Trocando...' : 'Trocar o endereço'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="toque h-11 md:h-9"
                          onClick={() => setConfirmarTroca(false)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      className="toque h-11 w-fit md:h-9"
                      onClick={() => setConfirmarTroca(true)}
                    >
                      <KeyRound aria-hidden="true" />
                      Trocar o endereço
                    </Button>
                  )}
                </section>
              ) : !podeAjustar ? (
                <p className="text-sm text-muted-foreground">
                  O endereço do arquivo é colado no Canal Pro por um admin ou gestor.
                </p>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * O contato que vai em cada anúncio. Nasce do que está no banco; sem nada lá,
 * da política de privacidade da empresa, que já tem o e-mail e o WhatsApp
 * oficiais.
 */
function Contato({ dados, podeAjustar }: { dados: SituacaoDoCanalPro; podeAjustar: boolean }) {
  const id = useId();
  const cliente = useQueryClient();
  const [contato, setContato] = useState(() => ({
    nome: dados.nome ?? EMPRESA.nome,
    email: dados.email ?? EMPRESA.privacidade?.email ?? '',
    telefone: dados.telefone ?? EMPRESA.privacidade?.whatsapp ?? '',
    site: dados.site ?? '',
  }));
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const r = await ajustarCanalPro(contato);
    setSalvando(false);
    if (!r.ok) {
      toast.error('Não deu para salvar o contato.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success('Contato salvo. Ele vai em todos os anúncios.');
    void cliente.invalidateQueries({ queryKey: ['anuncios'] });
  }

  return (
    <form onSubmit={salvar} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">O contato que vai em cada anúncio</h3>
      <fieldset disabled={!podeAjustar || salvando} className="flex flex-col gap-3">
        <Campo id={`${id}-nome`} rotulo="Nome da imobiliária">
          <Input
            id={`${id}-nome`}
            className="h-11 md:h-9"
            value={contato.nome}
            onChange={(e) => setContato({ ...contato, nome: e.target.value })}
          />
        </Campo>
        <Campo
          id={`${id}-email`}
          rotulo="E-mail"
          dica="Obrigatório no portal. Recebe os avisos do Grupo OLX."
        >
          <Input
            id={`${id}-email`}
            type="email"
            autoCapitalize="none"
            className="h-11 md:h-9"
            value={contato.email}
            onChange={(e) => setContato({ ...contato, email: e.target.value })}
          />
        </Campo>
        <Campo id={`${id}-tel`} rotulo="Telefone">
          <Input
            id={`${id}-tel`}
            inputMode="tel"
            className="h-11 md:h-9"
            value={contato.telefone}
            onChange={(e) => setContato({ ...contato, telefone: e.target.value })}
          />
        </Campo>
        <Campo id={`${id}-site`} rotulo="Site" dica="Opcional.">
          <Input
            id={`${id}-site`}
            inputMode="url"
            autoCapitalize="none"
            className="h-11 md:h-9"
            value={contato.site}
            onChange={(e) => setContato({ ...contato, site: e.target.value })}
          />
        </Campo>
      </fieldset>
      {podeAjustar ? (
        <Button type="submit" disabled={salvando} className="toque h-11 w-fit md:h-9">
          {salvando ? 'Salvando...' : 'Salvar o contato'}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Só admin e gestor mudam o contato.</p>
      )}
    </form>
  );
}

/**
 * O plano do Canal Pro (migração 20261104180000): quantos anúncios e destaques
 * ele publica. O banco não deixa pôr no ar além disso; vazio, não confere.
 */
function Plano({
  plano,
  podeAjustar,
}: {
  plano: SituacaoDoCanalPro['plano'];
  podeAjustar: boolean;
}) {
  const id = useId();
  const cliente = useQueryClient();
  const [valores, setValores] = useState(() => ({
    anuncios: plano.anuncios?.toString() ?? '',
    destaques: plano.destaques?.toString() ?? '',
  }));
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const r = await ajustarPlanoDoCanalPro({
      anuncios: lerInteiro(valores.anuncios),
      destaques: lerInteiro(valores.destaques),
    });
    setSalvando(false);
    if (!r.ok) {
      toast.error('Não deu para salvar o plano.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success('Plano salvo.');
    void cliente.invalidateQueries({ queryKey: ['anuncios'] });
  }

  return (
    <form onSubmit={salvar} className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">O plano do Canal Pro</h3>
        <p className="text-sm text-muted-foreground">
          Em uso agora: <span className="numerico">{plano.anunciosEmUso}</span>{' '}
          {plano.anunciosEmUso === 1 ? 'anúncio' : 'anúncios'} e{' '}
          <span className="numerico">{plano.destaquesEmUso}</span>{' '}
          {plano.destaquesEmUso === 1 ? 'destaque' : 'destaques'}, contando os cadastrados direto no
          Canal Pro.
        </p>
      </div>
      <fieldset disabled={!podeAjustar || salvando} className="grid grid-cols-2 gap-3">
        <Campo id={`${id}-anuncios`} rotulo="Anúncios no plano">
          <Input
            id={`${id}-anuncios`}
            inputMode="numeric"
            className="h-11 md:h-9"
            value={valores.anuncios}
            onChange={(e) => setValores({ ...valores, anuncios: e.target.value })}
          />
        </Campo>
        <Campo id={`${id}-destaques`} rotulo="Com destaque">
          <Input
            id={`${id}-destaques`}
            inputMode="numeric"
            className="h-11 md:h-9"
            value={valores.destaques}
            onChange={(e) => setValores({ ...valores, destaques: e.target.value })}
          />
        </Campo>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        O CRM não deixa pôr no ar além disso. Deixe vazio para o CRM não conferir.
      </p>
      {podeAjustar ? (
        <Button type="submit" disabled={salvando} className="toque h-11 w-fit md:h-9">
          {salvando ? 'Salvando...' : 'Salvar o plano'}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Só admin e gestor mudam o plano.</p>
      )}
    </form>
  );
}

function Campo({
  id,
  rotulo,
  dica,
  children,
}: {
  id: string;
  rotulo: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {dica ? <p className="text-xs text-muted-foreground">{dica}</p> : null}
    </div>
  );
}

/**
 * O que confere antes de colar o endereço do CRM no Canal Pro: os anúncios que
 * estão no portal por fora do CRM e não estão no ar aqui (sairiam na troca) e
 * os cadastrados direto no Canal Pro (o arquivo do CRM não os tira).
 */
function AntesDeColar({
  aAssumir,
  soNoCanalProNoAr,
}: {
  aAssumir: AnuncioNaLista[];
  soNoCanalProNoAr: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3 text-sm">
      <h4 className="font-medium">Antes de colar o endereço no Canal Pro</h4>
      {aAssumir.length > 0 ? (
        <>
          <p className="text-muted-foreground">
            O arquivo do CRM só leva o que está no ar no CRM.{' '}
            <span className="text-foreground">
              {aAssumir.length === 1
                ? '1 anúncio está no portal pelo sistema atual e é rascunho aqui'
                : `${aAssumir.length} anúncios estão no portal pelo sistema atual e são rascunho aqui`}
            </span>
            : se o Canal Pro passar a ler o arquivo do CRM agora, o Grupo OLX{' '}
            {aAssumir.length === 1 ? 'o tira' : 'os tira'} do ar.
          </p>
          <p className="numerico text-xs text-muted-foreground">
            {aAssumir.map((a) => a.codigo).join(' · ')}
          </p>
          <BotaoPorNoAr
            anuncios={aAssumir}
            aoPorTodos="O arquivo do CRM agora tem o que está no portal hoje. Pode colar o endereço."
          />
          <p className="text-xs text-muted-foreground">
            Faça isso na hora de colar: até o Canal Pro ler o arquivo do CRM, quem publica continua
            sendo o sistema atual.
          </p>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />O arquivo do CRM tem todos
          os anúncios que estão no portal hoje.
        </p>
      )}
      {soNoCanalProNoAr > 0 ? (
        <p className="text-muted-foreground">
          {soNoCanalProNoAr === 1
            ? '1 anúncio no ar foi cadastrado direto no Canal Pro'
            : `${soNoCanalProNoAr} anúncios no ar foram cadastrados direto no Canal Pro`}
          : o arquivo do CRM não {soNoCanalProNoAr === 1 ? 'o tira' : 'os tira'}. Os repetidos têm o
          botão Excluir duplicado na lista.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A URL do arquivo do CRM, com o botão de copiar: é ela que se cola no Canal Pro
 * (Configurações da conta → Integração de anúncios). A chave é credencial: só
 * admin e gestor a recebem do banco. Também usada no caminho até o primeiro lead.
 */
export function EnderecoDoArquivo({ chave }: { chave: string }) {
  return <EnderecoParaCopiar url={urlDoArquivo(chave)} nome="Endereço do arquivo de anúncios" />;
}

/**
 * A URL de leads, com o botão de copiar (12/11/2026): vai no Canal Pro em
 * Integrações → aba Leads → "Receber leads no CRM", um campo separado do
 * arquivo de anúncios. Usada no primeiro passo do caminho até o primeiro lead.
 */
export function EnderecoDeLeads() {
  return <EnderecoParaCopiar url={urlDeLeads()} nome="URL de leads" />;
}

/** Uma URL só de leitura (selecionada ao focar) e o botão "Copiar". */
function EnderecoParaCopiar({ url, nome }: { url: string; nome: string }) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Endereço copiado.');
    } catch {
      toast.error('Não consegui copiar. Selecione o endereço e copie à mão.');
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={url}
        aria-label={nome}
        className="h-11 min-w-0 font-mono text-xs md:h-9"
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        type="button"
        variant="outline"
        className="toque h-11 shrink-0 md:h-9"
        onClick={() => void copiar()}
      >
        <Copy aria-hidden="true" />
        Copiar
      </Button>
    </div>
  );
}

/**
 * "Pôr no ar pelo CRM" para uma lista de anúncios (06/11/2026): um de cada vez,
 * porque cada um confere o limite do plano contando os anteriores, e no fim diz
 * quem ficou de fora e por quê. Com um anúncio só, é o "Pôr no ar" dele. Usado no
 * "Antes de colar" e no caminho até o primeiro lead.
 */
export function BotaoPorNoAr({
  anuncios,
  aoPorTodos,
  variante = 'default',
  rotulo,
}: {
  anuncios: readonly { id: string; codigo: string }[];
  /** A descrição do aviso quando todos foram ao ar. */
  aoPorTodos?: string;
  variante?: 'default' | 'outline';
  /** O texto do botão parado; sem ele, "Pôr os N no ar pelo CRM". */
  rotulo?: string;
}) {
  const cliente = useQueryClient();
  const [pondo, setPondo] = useState<{ feitos: number; total: number } | null>(null);

  async function porTodosNoAr() {
    const lista = [...anuncios];
    const falhas: string[] = [];
    setPondo({ feitos: 0, total: lista.length });
    // Um de cada vez: cada um confere o limite do plano contando os anteriores.
    for (const [i, a] of lista.entries()) {
      const r = await publicarAnuncio(a.id);
      if (!r.ok) {
        falhas.push(
          `${a.codigo}: ${r.pendencias?.length ? `falta ${r.pendencias.join(', ')}` : fraseDaRecusa(r.motivo)}`,
        );
      }
      setPondo({ feitos: i + 1, total: lista.length });
    }
    setPondo(null);
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    const certos = lista.length - falhas.length;
    if (falhas.length === 0) {
      toast.success(`${certos} ${certos === 1 ? 'anúncio no ar' : 'anúncios no ar'} pelo CRM.`, {
        description: aoPorTodos,
      });
    } else {
      toast.error(
        `${certos} no ar; ${falhas.length} ${falhas.length === 1 ? 'ficou' : 'ficaram'} de fora.`,
        { description: falhas.join(' · ') },
      );
    }
  }

  return (
    <Button
      type="button"
      variant={variante}
      className="toque h-11 w-fit md:h-9"
      disabled={pondo !== null || anuncios.length === 0}
      onClick={() => void porTodosNoAr()}
    >
      <Upload aria-hidden="true" />
      {pondo
        ? pondo.total === 1
          ? 'Pondo no ar...'
          : `Pondo no ar... ${pondo.feitos} de ${pondo.total}`
        : (rotulo ??
          (anuncios.length === 1
            ? 'Pôr no ar pelo CRM'
            : `Pôr os ${anuncios.length} no ar pelo CRM`))}
    </Button>
  );
}
