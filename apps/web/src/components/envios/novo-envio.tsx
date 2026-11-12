'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import { cumprimentoDaHora } from '@/components/conversas/envio-de-modelo';
import { excluirParceiro, recadoDaExclusao } from '@/components/exclusao/acoes';
import { formatarTelefone } from '@/components/parceiros/formatos';
import type { Catalogos } from '@/components/parceiros/tipos';

import type { Entrada } from './adicionar-pessoas';
import { BarraDeEnviar } from './barra-de-enviar';
import { Celular, type ContatoNoCelular } from './celular';
import {
  buscarCumprimentos,
  buscarJanelaDeEnvio,
  buscarModelos,
  buscarModelosEmAnalise,
  buscarPessoasDoDisparo,
  buscarPrevia,
  buscarTetoDeHoje,
  criarEnvio,
  ErroDoEnvio,
  type ConfigDoEnvio,
} from './dados';
import {
  acoesPara,
  avisoSemEmpresa,
  comecoDoEnvio,
  custoEstimado,
  detalheDoResumo,
  diaDaConversa,
  duracaoEstimada,
  formatarNumero,
  fraseDaRecusa,
  fraseDoMotivo,
  fraseDoResumo,
  horaCurta,
  nomeSugerido,
  pedacosDaMensagem,
  pedacosNaSaida,
  quandoPorExtenso,
  regraSugerida,
  regrasAoTrocar,
  regrasIncompletas,
  regrasPara,
  rotuloDaVariavel,
  saudacaoDoMomento,
  variaveisComRegra,
  type Pedaco,
} from './formatos';
import { MaisOpcoes, RITMO_PADRAO } from './mais-opcoes';
import { QualMensagem, type EscolhaDaMensagem } from './qual-mensagem';
import { nomeNaLista, primeiroNomeNaLista, QuemRecebe, type AvisoDaLista } from './quem-recebe';
import type { AcaoDoBotao, Assinatura, RegraDaVariavel } from './tipos';

/**
 * Montar um disparo numa página só, com o celular ao lado (protótipo B,
 * escolhido em 12/11/2026: "quero que na tela de disparo, eu consiga com mais
 * clareza, cadastrar contatos, ver a mensagem clara que vai ser enviada, ta
 * bastante confuso, simplifique mais").
 *
 * À esquerda, as duas perguntas: "1. Quem recebe" (a lista, sempre aberta, e
 * os três jeitos de pôr gente nela) e "2. Qual mensagem" (um cartão por
 * mensagem aprovada). À direita, fixo, o celular com o texto EXATO que cada
 * pessoa recebe, montado pelo banco. Embaixo, a barra com a frase do que vai
 * acontecer e o botão; o resto (quando, ritmo, quem assina, botões, campos)
 * mora em "Mais opções", já preenchido.
 *
 * A quantidade é a própria lista (12/11/2026: "eu não quero que a quantidade
 * seja determinada"): vai para quem está nela e pode receber. O limite do dia
 * é o da Meta, e a barra diz quanto ainda cabe.
 */
export function NovoEnvio({
  catalogos,
  criaModelo,
  aoCriar,
}: {
  catalogos: Catalogos;
  /** Admin e gestor criam mensagem nova; o SDR dispara com as que existem. */
  criaModelo: boolean;
  /** "Ver andamento": fecha a montagem e abre o disparo criado. */
  aoCriar: (id: string) => void;
}) {
  // "Fazer outro" começa do zero: a montagem renasce com outra chave.
  const [rodada, setRodada] = useState(0);
  return (
    <Montagem
      key={rodada}
      catalogos={catalogos}
      criaModelo={criaModelo}
      aoCriar={aoCriar}
      aoFazerOutro={() => setRodada((r) => r + 1)}
    />
  );
}

/**
 * Para onde vai quem toca no botão de link, se o disparo não disser outro lugar.
 * Na KOMUNE é o cadastro de parceiro; onde não há plataforma, a pessoa escreve.
 */
const DESTINO_PADRAO = EMPRESA.modulos.plataformaKomune
  ? 'https://admin.komune.app.br/seja-parceiro'
  : '';

/** O máximo de um disparo (`envio_em_massa_criar`) e da lista (`disparo_pessoas`). */
const MAXIMO_DA_LISTA = 2000;

/** O motivo que vai para Excluídos quando a ficha nascida no disparo é apagada. */
const MOTIVO_DE_APAGAR = 'Cadastrada por engano no disparo';

/** A prévia vem do banco de 50 em 50 pessoas, em volta de quem está no celular. */
const PREVIA_POR_VEZ = 50;

function temAtendente(corpo: string): boolean {
  return /\{\{\s*atendente\s*\}\}/.test(corpo);
}

/** O relógio da tela: a hora do balão e o cumprimento do momento andam sozinhos. */
function useAgora(): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(relogio);
  }, []);
  return agora;
}

type AvisoComDesfazer = { texto: string; tom: 'ok' | 'neutro'; desfazer: string[] | null };

function Montagem({
  catalogos,
  criaModelo,
  aoCriar,
  aoFazerOutro,
}: {
  catalogos: Catalogos;
  criaModelo: boolean;
  aoCriar: (id: string) => void;
  aoFazerOutro: () => void;
}) {
  const clientes = useQueryClient();
  const agora = useAgora();

  // ------------------------------ quem recebe ------------------------------
  // A lista guarda só os ids, na ordem em que entraram; o resto vem do banco.
  const [ids, setIds] = useState<string[]>([]);
  const [novas, setNovas] = useState<ReadonlySet<string>>(new Set());
  const [vendoId, setVendoId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<AvisoComDesfazer | null>(null);
  const idsNaLista = useMemo(() => new Set(ids), [ids]);

  const pessoasQ = useQuery({
    queryKey: ['envios', 'disparo', 'pessoas', ids],
    queryFn: () => buscarPessoasDoDisparo(ids),
    enabled: ids.length > 0,
    // Pôr ou tirar alguém não esvazia a lista: a anterior fica até a nova chegar.
    placeholderData: (anterior) => anterior,
    staleTime: 30_000,
  });
  // Quem acabou de sair some na hora, sem esperar o banco.
  const lista = useMemo(
    () => (pessoasQ.data ?? []).filter((p) => idsNaLista.has(p.organization_id)),
    [pessoasQ.data, idsNaLista],
  );
  // A lista que está na tela é a dos ids de AGORA? Enquanto a busca de quem
  // acabou de entrar não volta, a tela mostra a anterior, e enviar seria mandar
  // para menos gente do que a lista diz. (Tirar alguém não espera: a anterior
  // já tem todo mundo que ficou.)
  const idsQueVieram = useMemo(
    () => new Set((pessoasQ.data ?? []).map((p) => p.organization_id)),
    [pessoasQ.data],
  );
  const listaEmDia =
    ids.length === 0 ||
    (pessoasQ.isSuccess &&
      (!pessoasQ.isPlaceholderData || ids.every((id) => idsQueVieram.has(id))));
  const esperando = listaEmDia || pessoasQ.isError ? 0 : Math.max(ids.length - lista.length, 0);
  const destinatarios = lista.filter((p) => p.bloqueio === null && p.aviso === null);

  const idxVendo = Math.max(
    0,
    lista.findIndex((p) => p.organization_id === vendoId),
  );
  const vendo = lista[idxVendo] ?? null;

  function entrar(e: Entrada) {
    const caber = (atual: readonly string[]) => {
      const ja = new Set(atual);
      const fim = [...atual];
      let cortadas = 0;
      for (const id of e.ids) {
        if (ja.has(id)) continue;
        if (fim.length >= MAXIMO_DA_LISTA) {
          cortadas += 1;
          continue;
        }
        ja.add(id);
        fim.push(id);
      }
      return { fim, cortadas };
    };
    setIds((atual) => caber(atual).fim);
    if (e.novas.length > 0) setNovas((n) => new Set([...n, ...e.novas]));
    const ultimo = e.ids[e.ids.length - 1];
    if (ultimo) setVendoId(ultimo);
    const { cortadas } = caber(ids);
    const texto =
      cortadas > 0
        ? `${e.aviso ? `${e.aviso} ` : ''}A lista chegou a ${formatarNumero(MAXIMO_DA_LISTA)}, o máximo de um disparo: ${formatarNumero(cortadas)} ${cortadas === 1 ? 'ficou' : 'ficaram'} de fora.`
        : e.aviso;
    setAviso(texto ? { texto, tom: cortadas > 0 ? 'neutro' : 'ok', desfazer: null } : null);
  }

  function semEles(tirados: ReadonlySet<string>) {
    const resto = ids.filter((id) => !tirados.has(id));
    if (vendoId && tirados.has(vendoId)) {
      // No celular fica quem vinha logo depois (ou antes, se era o último).
      const pos = ids.indexOf(vendoId);
      setVendoId(resto[Math.min(pos, resto.length - 1)] ?? null);
    }
    setIds(resto);
  }

  function tirar(tirados: string[], texto: string) {
    if (tirados.length === 0) return;
    const antes = ids;
    semEles(new Set(tirados));
    setAviso({ texto, tom: 'neutro', desfazer: antes });
  }

  function tirarUma(id: string) {
    const p = lista.find((x) => x.organization_id === id);
    tirar([id], `${p ? nomeNaLista(p) : 'A pessoa'} saiu da lista.`);
  }

  function tirarVarias(tirados: string[]) {
    if (tirados.length === 1 && tirados[0]) {
      tirarUma(tirados[0]);
      return;
    }
    tirar(tirados, `${formatarNumero(tirados.length)} saíram da lista.`);
  }

  function desfazer() {
    if (!aviso?.desfazer) return;
    setIds(aviso.desfazer);
    setAviso({ texto: 'Voltou tudo como estava.', tom: 'ok', desfazer: null });
  }

  /** No celular (aparelho), tocar numa pessoa leva até a prévia, que fica embaixo. */
  function ver(id: string) {
    setVendoId(id);
    if (typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches) return;
    const calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById('celular-do-disparo')
      ?.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'start' });
  }

  // Ficha nascida neste disparo, por engano: tira da lista e apaga
  // (`parceiro_excluir`, que não apaga linha: vai para Excluídos, com motivo).
  const apagar = useMutation({
    mutationFn: (pedido: { id: string; aoTerminar: () => void }) =>
      excluirParceiro(pedido.id, MOTIVO_DE_APAGAR),
    onSuccess: (r, pedido) => {
      if (!r.ok) {
        toast.error('A ficha não foi apagada.', { description: recadoDaExclusao(r.motivo) });
        return;
      }
      pedido.aoTerminar();
      semEles(new Set([pedido.id]));
      setNovas((n) => new Set([...n].filter((x) => x !== pedido.id)));
      setAviso({
        texto: `A ficha de ${r.recibo.nome} foi apagada e saiu da lista. Se precisar, ela está em Excluídos.`,
        tom: 'neutro',
        desfazer: null,
      });
    },
    onError: () => toast.error('A ficha não foi apagada.', { description: recadoDaExclusao('') }),
  });

  // ------------------------------- mais opções -------------------------------
  const [assinatura, setAssinatura] = useState<Assinatura>('marca');
  // A tela trocou "quem assina" sozinha (mensagem com o nome de quem envia)?
  // Então ela também desfaz a troca quando a mensagem deixa de pedir.
  const [assinaturaAutomatica, setAssinaturaAutomatica] = useState(false);
  const [atendentes, setAtendentes] = useState<string[]>([]);
  const [porHora, setPorHora] = useState<number>(RITMO_PADRAO);
  const [agendar, setAgendar] = useState(false);
  const [inicio, setInicio] = useState('');
  const [nomeEscrito, setNomeEscrito] = useState<string | null>(null);

  const inicioEscolhido = agendar && inicio ? new Date(inicio) : null;
  const inicioValido =
    inicioEscolhido && !Number.isNaN(inicioEscolhido.getTime()) ? inicioEscolhido : null;

  // ------------------- quando o disparo começa de verdade -------------------
  // Fora da janela de envio (depois das 17h45, fim de semana, feriado) nada sai
  // até a próxima abertura — e lá o cumprimento é "Bom dia!". A frase, o
  // celular e o cartão do cumprimento falam dessa hora, não da de agora.
  const teto = useQuery({
    queryKey: ['envios', 'teto'],
    queryFn: buscarTetoDeHoje,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const janela = useQuery({
    queryKey: ['envios', 'janela-de-envio'],
    queryFn: buscarJanelaDeEnvio,
    staleTime: 10 * 60_000,
  });
  const feriados = useMemo(() => new Set(janela.data?.feriados ?? []), [janela.data]);
  const comeco = comecoDoEnvio({
    agora,
    inicio: inicioValido,
    janelaAberta: teto.data?.janelaAberta ?? null,
    abreEm: teto.data?.abreEm ? new Date(teto.data.abreEm) : null,
    faixas: janela.data?.faixas ?? null,
    feriados,
  });
  const momentoDoEnvio = comeco.quando;
  const comecaHoje = diaDaConversa(momentoDoEnvio, agora) === 'Hoje';

  // -------------------------------- mensagem --------------------------------
  const [escolha, setEscolha] = useState<EscolhaDaMensagem>('cumprimento');
  const [regras, setRegras] = useState<Record<string, RegraDaVariavel>>({});
  const [acoesEditadas, setAcoesEditadas] = useState<Record<string, AcaoDoBotao>>({});
  const [linkDestino, setLinkDestino] = useState(DESTINO_PADRAO);
  const [avisoDaMensagem, setAvisoDaMensagem] = useState<string | null>(null);

  // Os três cumprimentos viram uma opção só: o banco troca pelo do período na
  // hora de cada envio (`app.modelo_da_hora`), então qualquer um serve de id.
  // O que a tela mostra é o do período em que o disparo começa.
  const cumprimentos = useQuery({
    queryKey: ['envios', 'cumprimentos'],
    queryFn: buscarCumprimentos,
    staleTime: 60_000,
  });
  const modelos = useQuery({
    queryKey: ['envios', 'modelos'],
    queryFn: buscarModelos,
    staleTime: 60_000,
  });
  const emAnalise = useQuery({
    queryKey: ['envios', 'modelos-em-analise'],
    queryFn: buscarModelosEmAnalise,
    staleTime: 60_000,
  });
  const cumprimentoNaSaida =
    cumprimentos.data?.find((m) => m.template_code === cumprimentoDaHora(momentoDoEnvio)) ??
    cumprimentos.data?.[0] ??
    null;
  const modelo =
    escolha === 'cumprimento'
      ? cumprimentoNaSaida
      : (modelos.data?.find((m) => m.id === escolha) ?? null);
  const corpo = modelo?.body ?? '';
  const variaveis = variaveisComRegra(corpo);
  const regrasDoCorpo = regrasPara(corpo, regras);
  const incompletas = regrasIncompletas(regrasDoCorpo);
  // Texto fixo é o que só a pessoa sabe: fica à vista, debaixo do cartão. O que
  // vem da ficha já tem regra e reserva: fica em "Mais opções".
  const fixas = variaveis.filter((v) => 'fixo' in (regrasDoCorpo[v] ?? { fixo: '' }));
  const daFicha = variaveis.filter((v) => !fixas.includes(v));
  // A mensagem fala da empresa? Quem não tem empresa na ficha ganha um aviso.
  const usaEmpresa = daFicha.some((v) => {
    const r = regrasDoCorpo[v];
    return r !== undefined && 'campo' in r && r.campo === 'empresa';
  });
  const botoes = modelo?.botoes ?? [];
  const acoes = acoesPara(botoes, acoesEditadas);
  const precisaDeLink =
    botoes.some((b) => b.tipo === 'link') || Object.values(acoes).some((a) => a.acao === 'link');
  const acoesIncompletas = Object.values(acoes).some(
    (a) => a.acao === 'link' && (a.texto.trim() === '' || a.botao.trim() === ''),
  );
  const conflitoDeAssinatura = assinatura === 'marca' && temAtendente(corpo);
  const nome =
    nomeEscrito ??
    nomeSugerido(escolha === 'cumprimento' ? 'Cumprimento' : (modelo?.name ?? null), agora);

  function escolherMensagem(nova: EscolhaDaMensagem) {
    setEscolha(nova);
    const novoCorpo =
      (nova === 'cumprimento' ? cumprimentoNaSaida : modelos.data?.find((m) => m.id === nova))
        ?.body ?? '';
    // Trocar de mensagem não herda o "texto fixo" que um campo da ficha ganhou
    // na anterior: volta a puxar da ficha.
    setRegras((r) => regrasAoTrocar(novoCorpo, r));
    // Mensagem que diz "aqui é {{atendente}}" não sai em nome da marca: em vez
    // de esconder o cartão, a tela troca quem assina e conta que trocou — e
    // destroca quando a mensagem deixa de pedir, se a troca foi dela.
    if (temAtendente(novoCorpo)) {
      if (assinatura === 'marca') {
        setAssinatura('eu');
        setAssinaturaAutomatica(true);
        setAvisoDaMensagem(
          'Esta mensagem diz o nome de quem envia, então sai assinada por você. Dá para trocar em “Mais opções”.',
        );
      } else {
        setAvisoDaMensagem(null);
      }
    } else if (assinaturaAutomatica) {
      setAssinatura('marca');
      setAssinaturaAutomatica(false);
      setAvisoDaMensagem(
        `Esta mensagem não diz quem envia: voltou a sair em nome da ${EMPRESA.nome}.`,
      );
    } else {
      setAvisoDaMensagem(null);
    }
  }

  // ---------------------------------- contas ----------------------------------
  const comJanela = destinatarios.filter((p) => p.janela_aberta).length;
  // Quem ABRE conversa gasta o limite do dia; quem está com a janela aberta, não.
  const abrem = destinatarios.length - comJanela;
  const custo =
    modelo && destinatarios.length > 0
      ? custoEstimado(modelo.category, destinatarios.length, comJanela)
      : null;

  const config: ConfigDoEnvio = {
    nome,
    tipo: 'modelo',
    modeloId: modelo?.id ?? null,
    texto: '',
    variaveis: regrasDoCorpo,
    assinatura,
    atendentes,
    porHora,
    inicio: inicioValido ? inicioValido.toISOString() : null,
    // A lista é escolhida a dedo: não há filtro para guardar.
    filtro: {},
    linkDestino: precisaDeLink ? linkDestino : '',
    acoes,
  };

  // ---------------------------------- prévia ----------------------------------
  // O cumprimento não tem variável: o texto é o próprio modelo do período. Os
  // outros vêm do banco, pessoa por pessoa, exatamente como vão sair.
  const ehCumprimento = escolha === 'cumprimento';
  const mensagemPronta = modelo !== null && incompletas.length === 0;
  const regrasJson = JSON.stringify(regrasDoCorpo);
  const regrasAdiadas = useDeferredValue(regrasJson);
  const comecoDaPagina = Math.floor(idxVendo / PREVIA_POR_VEZ) * PREVIA_POR_VEZ;
  const idsDaPagina = lista
    .slice(comecoDaPagina, comecoDaPagina + PREVIA_POR_VEZ)
    .map((p) => p.organization_id);
  const previa = useQuery({
    queryKey: [
      'envios',
      'previa',
      modelo?.id ?? null,
      regrasAdiadas,
      assinatura,
      atendentes,
      idsDaPagina,
    ],
    queryFn: () =>
      buscarPrevia(
        { ...config, variaveis: JSON.parse(regrasAdiadas) as Record<string, RegraDaVariavel> },
        idsDaPagina,
      ),
    enabled: mensagemPronta && !ehCumprimento && idsDaPagina.length > 0,
    placeholderData: (anterior) => anterior,
  });
  // Prévia de antes (de outra página, ou do texto fixo antes da última letra)
  // não é "exatamente isto": espera a de agora.
  const itemDaPrevia =
    vendo && !previa.isPlaceholderData && regrasAdiadas === regrasJson
      ? previa.data?.itens?.find((i) => i.organization_id === vendo.organization_id)
      : undefined;

  // Muda por pessoa: o que vem da ficha e, quando o disparo se divide, quem envia.
  const marcadas = [
    ...daFicha,
    ...(assinatura === 'responsavel' || assinatura === 'revezar' ? ['atendente'] : []),
  ];
  const valoresFixos: Record<string, string> = {};
  for (const v of fixas) {
    const r = regrasDoCorpo[v];
    if (r && 'fixo' in r) valoresFixos[v] = r.fixo;
  }

  let pedacos: Pedaco[] = [];
  let exato = false;
  if (modelo && ehCumprimento) {
    pedacos = [{ tipo: 'texto', texto: modelo.body }];
    exato = true;
  } else if (modelo && itemDaPrevia?.ok && itemDaPrevia.corpo !== undefined) {
    // O banco monta com a saudação de agora; a tela mostra a da hora em que sai.
    pedacos = pedacosNaSaida({
      corpo,
      valores: {
        ...valoresFixos,
        ...(itemDaPrevia.parametros ?? {}),
        atendente: itemDaPrevia.assinante ?? undefined,
      },
      marcadas,
      corpoDoBanco: itemDaPrevia.corpo,
      saudacaoAgora: saudacaoDoMomento(agora),
      saudacaoNaSaida: saudacaoDoMomento(momentoDoEnvio),
    });
    exato = true;
  } else if (modelo) {
    // Sem pessoa (ou montando): o modelo, com o texto fixo já escrito e os
    // campos da ficha como etiqueta.
    pedacos = pedacosDaMensagem(corpo, valoresFixos, []);
  }

  const primeiro = vendo ? primeiroNomeNaLista(vendo) : '';
  const naoRecebe = vendo ? (vendo.bloqueio ?? vendo.aviso) : null;
  const semEmpresaDeQuemVejo = vendo ? avisoSemEmpresa(vendo, usaEmpresa) : null;
  const contato: ContatoNoCelular | null = vendo
    ? {
        nome: nomeNaLista(vendo),
        sub:
          vendo.nome && vendo.empresa !== vendo.nome
            ? vendo.empresa
            : vendo.telefone
              ? formatarTelefone(vendo.telefone)
              : 'sem WhatsApp',
        inicial: (primeiro.charAt(0) || '?').toUpperCase(),
      }
    : null;

  let frase: React.ReactNode;
  let nota: { texto: string; tom: 'erro' | 'neutro' } | null = null;
  // O balão esmaece enquanto o texto da pessoa não chega, e para quem não recebe.
  let apagado = false;
  if (!modelo) {
    frase = 'Escolha a mensagem para ver como ela chega';
  } else if (!vendo) {
    frase = 'Escolha quem recebe para ver a mensagem com o nome de cada pessoa';
  } else if (naoRecebe) {
    frase = (
      <>
        <strong className="font-semibold">{primeiro}</strong>{' '}
        {vendo.bloqueio ? 'não vai receber esta mensagem' : 'vai ser pulada neste disparo'}
      </>
    );
    nota = { texto: fraseDoMotivo(naoRecebe), tom: vendo.bloqueio ? 'erro' : 'neutro' };
    apagado = true;
  } else if (incompletas.length > 0) {
    frase = `Preencha ${incompletas.map((v) => `[${rotuloDaVariavel(v)}]`).join(', ')} para ver o texto final`;
  } else if (exato) {
    frase = (
      <>
        É exatamente isto que <strong className="font-semibold">{primeiro}</strong> vai receber
      </>
    );
    if (semEmpresaDeQuemVejo) nota = { texto: semEmpresaDeQuemVejo, tom: 'neutro' };
  } else if (
    previa.isError ||
    previa.data?.ok === false ||
    (itemDaPrevia !== undefined && !itemDaPrevia.ok)
  ) {
    frase = (
      <>
        Para <strong className="font-semibold">{primeiro}</strong>, esta mensagem não sai
      </>
    );
    nota = {
      texto: itemDaPrevia
        ? `${fraseDoMotivo(itemDaPrevia.motivo)}${itemDaPrevia.variavel ? ` ([${rotuloDaVariavel(itemDaPrevia.variavel)}])` : ''}`
        : previa.data?.ok === false
          ? fraseDaRecusa(previa.data.motivo)
          : previa.error instanceof ErroDoEnvio
            ? fraseDaRecusa(previa.error.motivo)
            : 'Não deu para montar a prévia.',
      tom: 'erro',
    };
  } else {
    frase = (
      <>
        Montando a mensagem de <strong className="font-semibold">{primeiro}</strong>…
      </>
    );
    apagado = true;
  }

  const legenda = ehCumprimento
    ? 'O cumprimento muda sozinho pela hora em que cada mensagem sai.'
    : pedacos.some((p) => p.tipo === 'valor')
      ? 'O que está sublinhado muda para cada pessoa.'
      : pedacos.some((p) => p.tipo === 'campo')
        ? 'O que está entre colchetes é preenchido com os dados de cada pessoa.'
        : 'Esta mensagem é igual para todos.';

  const quandoSai =
    comeco.tipo === 'agora'
      ? 'Começa a sair assim que você enviar.'
      : comeco.tipo === 'agendado'
        ? `Começa a sair ${quandoPorExtenso(comeco.quando, agora)}.`
        : `${agendar ? 'Esse horário' : 'Agora'} está fora do horário de envio: começa a sair ${quandoPorExtenso(comeco.quando, agora)}.`;

  // ---------------------------------- enviar ----------------------------------
  const [criado, setCriado] = useState<{ id: string; texto: string } | null>(null);
  const criar = useMutation({
    mutationFn: (pedido: { organizacoes: string[]; quando: string }) =>
      criarEnvio(config, pedido.organizacoes),
    onSuccess: (r, pedido) => {
      setCriado({
        id: r.id,
        texto: `${formatarNumero(r.itens)} ${r.itens === 1 ? 'mensagem começa' : 'mensagens começam'} a sair ${pedido.quando}, ${porHora} por hora. Quem responder aparece em Conversas.`,
      });
      void clientes.invalidateQueries({ queryKey: ['envios'] });
    },
    onError: (erro: Error) => {
      toast.error('O disparo não foi criado.', {
        description:
          erro instanceof ErroDoEnvio ? fraseDaRecusa(erro.motivo, erro.variavel) : erro.message,
      });
    },
  });

  /** O primeiro motivo de o botão estar apagado, dito ao lado dele. */
  function oQueFalta(): string | null {
    if (ids.length === 0) return 'Ponha alguém em “Quem recebe”.';
    if (pessoasQ.isError) return 'Não deu para ler a lista: tente de novo.';
    if (!listaEmDia) return 'Carregando quem entrou na lista…';
    if (destinatarios.length === 0) {
      return 'Ninguém da lista pode receber agora: o motivo está em cada nome.';
    }
    if (ehCumprimento && cumprimentos.isPending) return 'Carregando as mensagens…';
    if (ehCumprimento && !modelo) {
      return 'O cumprimento ainda não foi aprovado pela Meta. Escolha outra mensagem.';
    }
    if (!ehCumprimento && modelos.isPending) return 'Carregando as mensagens…';
    if (!modelo) return 'Escolha a mensagem em “Qual mensagem”.';
    if (incompletas.length > 0) {
      return `Preencha ${incompletas.map((v) => `[${rotuloDaVariavel(v)}]`).join(', ')} em “Qual mensagem”.`;
    }
    if (conflitoDeAssinatura) {
      return 'A mensagem diz o nome de quem envia: em “Mais opções”, escolha quem assina.';
    }
    if (assinatura === 'revezar' && atendentes.length === 0) {
      return 'Em “Mais opções”, escolha entre quem o disparo se divide.';
    }
    if (acoesIncompletas) return 'Em “Mais opções”, confira o que acontece em cada botão.';
    if (precisaDeLink && !linkDestino.startsWith('https://')) {
      return 'Em “Mais opções”, o destino do link precisa começar com https://.';
    }
    if (agendar && !inicioValido) return 'Em “Mais opções”, escolha o dia e a hora do começo.';
    if (nome.trim() === '') return 'Em “Mais opções”, dê um nome ao disparo.';
    return null;
  }
  const falta = oQueFalta();
  const podeEnviar = falta === null && destinatarios.length > 0 && criado === null;
  const quantos = `${formatarNumero(destinatarios.length)} ${destinatarios.length === 1 ? 'pessoa' : 'pessoas'}`;
  const rotuloDoBotao = criar.isPending
    ? agendar
      ? 'Agendando…'
      : 'Enviando…'
    : destinatarios.length === 0
      ? 'Enviar'
      : agendar
        ? `Agendar para ${quantos}`
        : `Enviar para ${quantos}`;

  const erroDaLista = pessoasQ.isError
    ? pessoasQ.error instanceof ErroDoEnvio
      ? fraseDaRecusa(pessoasQ.error.motivo)
      : 'Não deu para ler a lista.'
    : null;

  const avisoDaLista: AvisoDaLista | null = aviso
    ? { texto: aviso.texto, tom: aviso.tom, podeDesfazer: aviso.desfazer !== null }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-col gap-5">
          <QuemRecebe
            pessoas={lista}
            esperando={esperando}
            carregando={pessoasQ.isPending && ids.length > 0}
            erro={erroDaLista}
            novas={novas}
            vendoId={vendo?.organization_id ?? null}
            idsNaLista={idsNaLista}
            aviso={avisoDaLista}
            categorias={catalogos.categorias}
            aoVer={ver}
            aoTirar={tirarUma}
            aoTirarVarias={tirarVarias}
            aoLimpar={() =>
              tirar(
                ids,
                `${formatarNumero(ids.length)} ${ids.length === 1 ? 'saiu' : 'saíram'} da lista.`,
              )
            }
            aoDesfazer={desfazer}
            aoEntrar={entrar}
            vagas={MAXIMO_DA_LISTA - ids.length}
            maximo={MAXIMO_DA_LISTA}
            usaEmpresa={usaEmpresa}
            apagando={apagar.isPending ? (apagar.variables?.id ?? null) : null}
            aoApagarFicha={(id, aoTerminar) => apagar.mutate({ id, aoTerminar })}
            aoTentarDeNovo={() => void pessoasQ.refetch()}
          />
          <QualMensagem
            escolha={escolha}
            aoEscolher={escolherMensagem}
            cumprimento={cumprimentoNaSaida}
            carregandoCumprimento={cumprimentos.isPending}
            modelos={modelos.data ?? []}
            carregandoModelos={modelos.isPending}
            emAnalise={emAnalise.data ?? []}
            fixas={fixas}
            regras={regrasDoCorpo}
            aoMudarFixo={(v, texto) => setRegras((atual) => ({ ...atual, [v]: { fixo: texto } }))}
            aoPuxarDaFicha={(v) => setRegras((atual) => ({ ...atual, [v]: regraSugerida(v) }))}
            criaModelo={criaModelo}
            aviso={avisoDaMensagem}
          />
        </div>

        <Celular
          frase={frase}
          navegacao={
            lista.length > 0
              ? {
                  rotulo: `${primeiro} · ${formatarNumero(idxVendo + 1)} de ${formatarNumero(lista.length)}`,
                  desligada: lista.length < 2,
                  aoVoltar: () =>
                    setVendoId(
                      lista[(idxVendo - 1 + lista.length) % lista.length]?.organization_id ?? null,
                    ),
                  aoAvancar: () =>
                    setVendoId(lista[(idxVendo + 1) % lista.length]?.organization_id ?? null),
                }
              : null
          }
          contato={contato}
          pedacos={pedacos}
          apagado={apagado}
          botoes={botoes}
          hora={horaCurta(momentoDoEnvio)}
          dia={diaDaConversa(momentoDoEnvio, agora)}
          horaDoRelogio={horaCurta(agora)}
          vazio={
            modelos.isPending || cumprimentos.isPending
              ? 'Carregando…'
              : 'Escolha a mensagem em “Qual mensagem”.'
          }
          nota={nota}
          legenda={legenda}
        />
      </div>

      <BarraDeEnviar
        frase={fraseDoResumo({ pessoas: destinatarios.length, comeco, assinatura, agora })}
        detalhe={detalheDoResumo({
          custo,
          duracao:
            destinatarios.length > 0
              ? duracaoEstimada(
                  destinatarios.length,
                  porHora,
                  abrem > 0 ? (teto.data?.teto ?? null) : null,
                )
              : null,
          limite: teto.data
            ? { teto: teto.data.teto, sobra: teto.data.sobra, naFila: teto.data.naFila }
            : null,
          abrem,
          comecaHoje,
          deFora: lista.length - destinatarios.length,
        })}
        rotuloDoBotao={rotuloDoBotao}
        podeEnviar={podeEnviar}
        enviando={criar.isPending}
        falta={falta}
        aoEnviar={() =>
          criar.mutate({
            organizacoes: destinatarios.map((p) => p.organization_id),
            quando: comeco.tipo === 'agora' ? 'agora' : quandoPorExtenso(comeco.quando, agora),
          })
        }
        criado={criado?.texto ?? null}
        aoVerAndamento={() => criado && aoCriar(criado.id)}
        aoFazerOutro={aoFazerOutro}
        maisOpcoes={
          <MaisOpcoes
            agendar={agendar}
            aoAgendar={setAgendar}
            inicio={inicio}
            aoMudarInicio={setInicio}
            quandoSai={quandoSai}
            porHora={porHora}
            aoMudarRitmo={setPorHora}
            assinatura={assinatura}
            aoMudarAssinatura={(a) => {
              setAssinatura(a);
              setAssinaturaAutomatica(false);
              setAvisoDaMensagem(null);
            }}
            atendentes={atendentes}
            aoMudarAtendentes={setAtendentes}
            pessoas={catalogos.pessoas}
            conflitoDeAssinatura={conflitoDeAssinatura}
            nome={nome}
            aoMudarNome={setNomeEscrito}
            acoes={acoes}
            aoMudarAcao={(botao, a) => setAcoesEditadas((atual) => ({ ...atual, [botao]: a }))}
            precisaDeLink={precisaDeLink}
            linkDestino={linkDestino}
            aoMudarLink={setLinkDestino}
            daFicha={daFicha}
            regras={regrasDoCorpo}
            aoMudarRegra={(v, r) => setRegras((atual) => ({ ...atual, [v]: r }))}
          />
        }
      />
    </div>
  );
}
