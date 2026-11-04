'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AudioLines,
  BadgeCheck,
  Ban,
  Bot,
  Download,
  FileText,
  Film,
  ImageIcon,
  Sparkles,
  Star,
} from 'lucide-react';

import { toast } from 'sonner';

import { SOBREVIVE_A_NAVEGACAO } from '@/components/consultas/provedor-consultas';
import { cn } from '@/lib/utils';

import { ErroDaConversa, reagirAMensagem, urlDaMidia } from './acoes';
import { AcoesDaMensagem, motivoParaNaoReagir, useToqueLongo } from './acoes-da-mensagem';
import { partesDestacadas } from './busca-no-fio';
import { fraseDoErroDaMeta, fraseDoNaoSuportado, PREFIXO_DA_CORRECAO } from './conteudo';
import { idDoBalao, useFio } from './contexto-do-fio';
import {
  CartaoDeContatos,
  CartaoDeLocalizacao,
  Citacao,
  Encaminhada,
  FaixaDoAnuncio,
  OpcaoEscolhida,
  OpcoesEnviadas,
  SelosDeReacao,
} from './partes-do-balao';
import { VirarTarefa } from './virar-tarefa';
import { dataHoraCompleta, hora } from './formatos';
import { entregaDaMensagem, separarAssinatura } from './mensagens';
import { avisoSemConteudo, ROTULO_DO_ROBO, type MensagemDoFio } from './tipos';
import { RabichoDoBalao, Tiques, type Tique } from './wpp';

/**
 * Uma mensagem dentro da conversa — um balão de verdade.
 *
 * ===========================================================================
 * O QUE MUDOU EM 23/09/2026, E POR QUÊ
 * ===========================================================================
 * "Tá muito ruim, muito feio... no mobile tá ficando muito pequeno e ruim de ver
 * a conversa" (Rafael). O desenho anterior punha os dois lados em cinza quase
 * igual, com um trilho de ícones de 44 px à esquerda, o nome de quem escreveu
 * dentro do balão e a hora, a entrega e o botão "Virar tarefa" também dentro.
 * Em 390 px sobrava meia tela para a conversa, e o olho não distinguia quem
 * falou sem ler o rótulo.
 *
 * Agora vale a gramática que todo mundo já conhece do WhatsApp:
 *   * **recebida** encosta à esquerda, no cartão (`bg-card`);
 *   * **enviada** encosta à direita, com um véu da cor da marca — o único uso de
 *     cromia fora da escala térmica, e ele não compete com ela: verde é a AÇÃO
 *     do produto (botão, link, foco), e "fui eu que falei" é ação;
 *   * hora e entrega saem do balão e viram uma linha miúda embaixo, só na
 *     ÚLTIMA mensagem de cada bloco do mesmo autor;
 *   * quem escreveu aparece uma vez por bloco, e só quando acrescenta (a IA, o
 *     robô, ou outra pessoa do time).
 *
 * ===========================================================================
 * O ÁUDIO
 * ===========================================================================
 * O fornecedor manda áudio mesmo quando a gente escreve — é o R13 inteiro. Então
 * o áudio recebido mostra as DUAS coisas: o player (para ouvir a voz, que é onde
 * está o tom) e a transcrição (para ler no ônibus, sem fone). E a transcrição vem
 * marcada como o que é: máquina. Quem decide se marca reunião a partir de uma
 * frase transcrita precisa saber que aquela frase pode estar errada.
 *
 * O player só aparece quando dá para assinar a URL do arquivo. Hoje, em geral,
 * não dá — o balde `mensagens` é privado e não tem política de leitura (ver
 * `BUCKET_MIDIA` em `acoes.ts`) —, e aí o balão diz isso com todas as letras em
 * vez de mostrar um controle de áudio que não toca.
 */
export function Mensagem({
  mensagem,
  agrupada = false,
  fechaGrupo = true,
  nomeDoParceiro = null,
}: {
  mensagem: MensagemDoFio;
  /** Vem logo depois de outra do mesmo autor: sem nome em cima, colada na anterior. */
  agrupada?: boolean;
  /** É a última do bloco: só ela mostra os selos e o "Virar tarefa" embaixo. */
  fechaGrupo?: boolean;
  /** Como se chama quem está do outro lado — o nome na citação do que ele mandou. */
  nomeDoParceiro?: string | null;
}) {
  const entrega = entregaDaMensagem(mensagem);
  const entrada = mensagem.entrada;
  // O fio em volta (27/10/2026): o menu, a citação, a lupa e a estrela moram
  // nele. Sem ele, o balão é o de antes.
  const fio = useFio();
  const [folha, setFolha] = useState(false);
  const toque = useToqueLongo(() => setFolha(true), fio !== null);
  const [verApagada, setVerApagada] = useState(false);

  const termo = fio?.busca.aberta ? fio.busca.termo : '';
  const emFoco = fio?.busca.atual === mensagem.id;
  const favorita = fio?.favoritas.has(mensagem.id) ?? false;
  // APAGADA NO CRM, CANCELADA NA FILA, APAGADA PELO CONTATO (27/10/2026): três
  // coisas diferentes, e o balão diz qual. As duas primeiras escondem o
  // conteúdo atrás de um "ver"; a do contato o mostra apagado, porque o time
  // já o tinha lido e precisa saber o que sumiu do lado de lá.
  const escondida = mensagem.cancelada || mensagem.apagadaEm !== null;
  const doContatoApagada = mensagem.apagadaPeloContatoEm !== null;
  const figurinha = mensagem.tipo === 'image' && mensagem.tipoNaMeta === 'sticker';
  const extras =
    mensagem.encaminhada || mensagem.citada !== null || mensagem.conteudo.anuncio !== null;
  // A figurinha não tem balão no WhatsApp: ela é o balão.
  const semFundo = figurinha && !extras && !escondida;
  const nossa = !entrada;
  // A PONTINHA fica no PRIMEIRO balão de cada bloco, como no WhatsApp; os que
  // vêm colados embaixo têm os quatro cantos redondos.
  const comPontinha = !agrupada && !semFundo;
  // A HORA E O ✓✓ moram DENTRO do balão, no canto de baixo. Quando a última coisa
  // do balão é texto, eles dividem a última linha com ele (um espaço invisível no
  // fim do texto guarda o lugar); depois de foto, cartão ou botões, ganham a
  // linha deles.
  const metaNaLinha =
    !escondida &&
    !doContatoApagada &&
    mensagem.texto !== null &&
    !TIPOS_COM_ARQUIVO.has(mensagem.tipo) &&
    mensagem.tipo !== 'location' &&
    mensagem.tipo !== 'contacts' &&
    mensagem.tipo !== 'interactive' &&
    mensagem.conteudo.interativo === null &&
    mensagem.conteudo.resposta === null &&
    !mensagem.conteudo.naoSuportado &&
    !mensagem.conteudo.erro &&
    !favorita &&
    mensagem.corrigidaPor === null &&
    mensagem.editadaPeloContatoEm === null;
  const tique: Tique | null = entrada
    ? null
    : mensagem.cancelada
      ? null
      : mensagem.status === 'failed'
        ? 'falha'
        : mensagem.status === 'queued'
          ? 'espera'
          : mensagem.status === 'read' || mensagem.ouvidaEm
            ? 'lido'
            : mensagem.status === 'delivered'
              ? 'entregue'
              : 'enviado';
  const rotuloDaEntrega = mensagem.cancelada
    ? 'cancelada'
    : !entrada && mensagem.ouvidaEm
      ? 'ouvido'
      : entrega.rotulo;
  const selos = selosDa(mensagem);
  const temRodape =
    (entrega.detalhe !== null && !mensagem.cancelada) ||
    (fechaGrupo && (selos.length > 0 || entrada));

  return (
    <div
      // A âncora da citação, da lupa e da busca da lista (`irPara`).
      id={idDoBalao(mensagem.id)}
      className={cn(
        'group flex w-full scroll-mt-20 rounded-lg transition-colors data-[apontada]:bg-wpp-cita-barra/15',
        entrada ? 'justify-start' : 'justify-end',
        // Bloco novo descola do anterior; dentro do bloco os balões quase encostam.
        agrupada ? 'mt-0.5' : 'mt-2.5',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 max-w-[85%] flex-col gap-1 md:max-w-[65%]',
          entrada ? 'items-start' : 'items-end',
        )}
      >
        <div
          {...toque}
          className={cn(
            'group/balao relative max-w-full min-w-0 text-[15px] leading-[1.45] text-foreground',
            fio && 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]',
            semFundo
              ? 'p-0'
              : cn(
                  'rounded-lg pt-1.5 pr-[9px] pb-[7px] pl-2.5 shadow-wpp',
                  entrada ? 'bg-wpp-entra' : 'bg-wpp-sai',
                  comPontinha && (entrada ? 'rounded-tl-none' : 'rounded-tr-none'),
                  escondida && 'text-wpp-suave',
                ),
            emFoco && 'outline-2 outline-offset-3 outline-wpp-cita-barra',
          )}
        >
          {comPontinha ? <RabichoDoBalao lado={entrada ? 'entra' : 'sai'} /> : null}
          {fio ? (
            <AcoesDaMensagem
              mensagem={mensagem}
              folhaAberta={folha}
              aoMudarFolha={setFolha}
              className={cn(
                'absolute top-0.5 right-0.5 z-10 shadow-none ring-0',
                semFundo ? 'bg-wpp-painel' : entrada ? 'bg-wpp-entra' : 'bg-wpp-sai',
              )}
            />
          ) : null}

          {agrupada || semFundo ? null : <Quem mensagem={mensagem} />}

          {escondida ? (
            <AvisoDeEscondida
              mensagem={mensagem}
              vendo={verApagada}
              aoVer={() => setVerApagada((v) => !v)}
            />
          ) : null}

          {!escondida || verApagada ? (
            <div className={cn('space-y-1.5', (escondida || doContatoApagada) && 'opacity-60')}>
              {mensagem.encaminhada ? (
                <Encaminhada muito={mensagem.conteudo.muitoEncaminhada} />
              ) : null}
              {mensagem.conteudo.anuncio ? (
                <FaixaDoAnuncio anuncio={mensagem.conteudo.anuncio} nossa={nossa && !escondida} />
              ) : null}
              {mensagem.citada ? (
                <Citacao
                  citada={mensagem.citada}
                  nossa={nossa && !escondida}
                  nomeDoParceiro={nomeDoParceiro}
                  aoIr={fio?.irPara}
                />
              ) : null}
              {mensagem.corrigeA ? (
                <p className="text-xs font-semibold tracking-wide uppercase opacity-80">Correção</p>
              ) : null}
              <Conteudo
                mensagem={mensagem}
                termo={termo}
                espaco={metaNaLinha && !(escondida && verApagada)}
              />
            </div>
          ) : null}

          {doContatoApagada ? (
            <p className="flex items-center gap-1.5 text-xs italic opacity-80">
              <Ban className="size-3.5" aria-hidden="true" />O contato apagou esta mensagem
            </p>
          ) : null}
          <Marcas mensagem={mensagem} favorita={favorita} aoIr={fio?.irPara} />

          <span
            className={cn(
              'flex items-center gap-1 text-[11px] leading-none whitespace-nowrap',
              entrada ? 'text-wpp-meta-e' : 'text-wpp-meta-s',
              metaNaLinha
                ? 'absolute right-[9px] bottom-[7px]'
                : semFundo
                  ? 'mt-1 justify-end rounded-full bg-wpp-sis px-2 py-1 shadow-wpp'
                  : 'mt-1 justify-end',
            )}
            title={`${dataHoraCompleta(mensagem.em)} · ${rotuloDaEntrega}`}
          >
            <time dateTime={mensagem.em} className="numerico">
              {hora(mensagem.em)}
            </time>
            {tique ? <Tiques tique={tique} className="size-[15px]" /> : null}
            {mensagem.cancelada ? <span>cancelada</span> : null}
            <span className="sr-only">{rotuloDaEntrega}</span>
          </span>
        </div>

        <SelosDeReacao
          reacoes={mensagem.reacoes}
          entrada={entrada}
          aoTirarANossa={
            fio && motivoParaNaoReagir(mensagem, fio) === null
              ? () =>
                  void reagirAMensagem(mensagem.id, null)
                    .then(fio.atualizar)
                    .catch((e: unknown) =>
                      toast.error('Não tirou a reação.', {
                        description: e instanceof ErroDaConversa ? e.message : 'Tente de novo.',
                      }),
                    )
              : undefined
          }
        />

        {/* Fora do balão, só o que o WhatsApp não tem e o CRM precisa dizer: por que
            não saiu, os selos (modelo aprovado, primeiro contato) e o "Virar
            tarefa" do que o parceiro mandou — este aparece ao passar o mouse, e
            sempre no toque. */}
        {temRodape ? (
          <p
            className={cn(
              'flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-[11px] text-wpp-suave',
              entrada ? 'justify-start' : 'justify-end',
            )}
          >
            {entrega.detalhe && !mensagem.cancelada ? (
              <span
                className={cn(
                  'max-w-prose',
                  entrega.tom === 'falha' ? 'text-destructive-texto' : 'text-foreground',
                )}
              >
                {entrega.detalhe}
              </span>
            ) : null}
            {fechaGrupo
              ? selos.map((selo) => (
                  <span
                    key={selo}
                    className="rounded-full bg-wpp-sis px-2 py-0.5 text-[10.5px] text-wpp-sis-texto shadow-wpp"
                  >
                    {selo}
                  </span>
                ))
              : null}
            {entrada && fechaGrupo ? (
              <span className="rounded-full bg-wpp-sis shadow-wpp transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 pointer-coarse:opacity-100">
                <VirarTarefa mensagemId={mensagem.id} />
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * O miolo do balão, por tipo: o arquivo, o cartão, a pergunta, o texto e o que
 * a Meta disse não entregar.
 */
function Conteudo({
  mensagem,
  termo,
  espaco = false,
}: {
  mensagem: MensagemDoFio;
  termo: string;
  /** Guardar no fim do texto o lugar da hora e do ✓✓ (ver `metaNaLinha`). */
  espaco?: boolean;
}) {
  const { conteudo } = mensagem;
  const nossa = !mensagem.entrada && !mensagem.cancelada && mensagem.apagadaEm === null;
  // A opção que o contato tocou: a resposta do botão ou da lista. Sem o
  // `conteudo` (linha de antes de 27/10/2026), o corpo é o título da opção.
  const escolha = mensagem.entrada
    ? (conteudo.resposta ??
      (mensagem.tipo === 'interactive' && mensagem.texto
        ? { titulo: mensagem.texto, descricao: null }
        : null))
    : null;
  const local = mensagem.tipo === 'location' ? conteudo.localizacao : null;
  // O corpo da localização recebida é o nome (ou o endereço) do lugar, que o
  // cartão já mostra: repetir embaixo seria dizer duas vezes a mesma coisa.
  const textoRepeteOLocal =
    local !== null && (mensagem.texto === local.nome || mensagem.texto === local.endereco);
  const contatos = mensagem.tipo === 'contacts' ? conteudo.contatos : [];
  const temCartao = local !== null || contatos.length > 0;
  const aviso = conteudo.naoSuportado
    ? fraseDoNaoSuportado(conteudo.naoSuportado)
    : conteudo.erro
      ? fraseDoErroDaMeta(conteudo.erro)
      : null;
  const semCorpo =
    mensagem.texto === null &&
    !TIPOS_COM_ARQUIVO.has(mensagem.tipo) &&
    !temCartao &&
    escolha === null &&
    aviso === null;

  return (
    <>
      {mensagem.tipo === 'audio' ? <Audio mensagem={mensagem} /> : null}
      {mensagem.tipo === 'image' ? <Foto mensagem={mensagem} /> : null}
      {mensagem.tipo === 'video' ? <Video mensagem={mensagem} /> : null}
      {mensagem.tipo === 'document' ? <Documento mensagem={mensagem} /> : null}
      {local ? <CartaoDeLocalizacao local={local} nossa={nossa} /> : null}
      {contatos.length > 0 ? <CartaoDeContatos contatos={contatos} nossa={nossa} /> : null}

      {escolha ? (
        <OpcaoEscolhida titulo={escolha.titulo} descricao={escolha.descricao} />
      ) : mensagem.texto && !textoRepeteOLocal ? (
        <Texto
          texto={mensagem.texto}
          termo={termo}
          correcao={mensagem.corrigeA !== null}
          espaco={espaco ? (mensagem.entrada ? 'entra' : 'sai') : null}
        />
      ) : null}

      {!mensagem.entrada && conteudo.interativo ? (
        <OpcoesEnviadas interativo={conteudo.interativo} nossa={nossa} />
      ) : null}

      {aviso ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed opacity-80">
          <FileText className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{aviso}</span>
        </p>
      ) : null}
      {semCorpo ? <SemCorpo mensagem={mensagem} /> : null}
    </>
  );
}

/**
 * Apagada no CRM ou cancelada na fila: o que aconteceu, com quem e o que o
 * contato vê — e um "ver" para quem precisa conferir o que era.
 */
function AvisoDeEscondida({
  mensagem,
  vendo,
  aoVer,
}: {
  mensagem: MensagemDoFio;
  vendo: boolean;
  aoVer: () => void;
}) {
  const quem = mensagem.apagadaPor ? ` por ${mensagem.apagadaPor}` : '';
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pr-6 text-sm italic">
      <Ban className="size-4 shrink-0" aria-hidden="true" />
      <span>
        {mensagem.cancelada
          ? 'Envio cancelado: o contato não recebeu.'
          : mensagem.entrada
            ? `Apagada no CRM${quem}. O contato ainda tem a dele.`
            : `Apagada só no CRM${quem} — o contato ainda vê.`}
      </span>
      <button
        type="button"
        onClick={aoVer}
        className="not-italic underline underline-offset-2 hover:text-foreground"
      >
        {vendo ? 'esconder' : 'ver'}
      </button>
    </p>
  );
}

/**
 * As marcas miúdas do pé do balão: a estrela, "corrigida" (leva à correção) e
 * "editada" pelo contato (com o texto de antes, quando a Meta mandou).
 */
function Marcas({
  mensagem,
  favorita,
  aoIr,
}: {
  mensagem: MensagemDoFio;
  favorita: boolean;
  aoIr?: (id: string) => void;
}) {
  const [antes, setAntes] = useState(false);
  const corrigida = mensagem.corrigidaPor;
  const editada = mensagem.editadaPeloContatoEm !== null;
  if (!favorita && !corrigida && !editada) return null;
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 text-xs opacity-80">
        {favorita ? <Star className="size-3 fill-current" aria-label="Favorita" /> : null}
        {corrigida ? (
          aoIr ? (
            <button
              type="button"
              onClick={() => aoIr(corrigida)}
              className="underline underline-offset-2"
              title="Ir até a correção"
            >
              corrigida
            </button>
          ) : (
            <span>corrigida</span>
          )
        ) : null}
        {editada ? (
          mensagem.conteudo.versoes.length > 0 ? (
            <button
              type="button"
              onClick={() => setAntes((v) => !v)}
              className="underline underline-offset-2"
            >
              editada{antes ? '' : ' · ver antes'}
            </button>
          ) : (
            <span>editada</span>
          )
        ) : null}
      </p>
      {antes ? (
        <ol className="space-y-1 border-l-2 border-current/30 pl-2 text-[13px] opacity-75">
          {mensagem.conteudo.versoes.map((v, i) => (
            <li key={i} className="whitespace-pre-line line-through decoration-1">
              {separarAssinatura(v).resto}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * Quem escreveu, DENTRO do balão e no alto, como o nome nos grupos do WhatsApp.
 *
 * Só do nosso lado: a IA, o robô e o nome de quem do time escreveu — porque o
 * número é de todos e saber quem falou por último é a pergunta de quem entra na
 * conversa agora. O recebido não leva nome desde 03/11/2026: a conversa é com uma
 * pessoa só, o nome dela está no cabeçalho, e é assim no WhatsApp (de 28/09 a
 * 03/11 ele ia em cima do balão).
 */
function Quem({ mensagem }: { mensagem: MensagemDoFio }) {
  if (mensagem.entrada) return null;
  const daIa = mensagem.autorTipo === 'bot_ai';
  const doRobo = mensagem.autorTipo === 'bot_fixed';
  // `system` é o que o BANCO monta sozinho — hoje, a confirmação de opt-out
  // (`GEN-SYS-OPTOUT`). Ele caía em "Alguém do time", e isso é falso: não houve
  // alguém (28/09/2026).
  const doSistema = mensagem.autorTipo === 'system';
  const quem =
    mensagem.autorTipo === 'human'
      ? (mensagem.autor ?? 'Alguém do time')
      : ROTULO_DO_ROBO[mensagem.autorTipo];

  return (
    <p className="mb-px flex items-center gap-1 pr-6 text-[12.5px] font-semibold text-wpp-autor">
      {daIa ? (
        <Sparkles className="size-3" aria-hidden="true" />
      ) : doRobo || doSistema ? (
        <Bot className="size-3" aria-hidden="true" />
      ) : null}
      <span className="truncate">{quem}</span>
      {daIa && mensagem.aprovadoPor ? (
        <span className="inline-flex shrink-0 items-center gap-1 font-normal text-wpp-meta-s">
          <span aria-hidden="true">·</span>
          <BadgeCheck className="size-3" aria-hidden="true" />
          {mensagem.aprovadoPor} aprovou
        </span>
      ) : null}
    </p>
  );
}

/**
 * Os selos da regra: sob que permissão a mensagem saiu.
 *
 * Eles respondem a perguntas que alguém já fez em pé numa calçada — "isso gastou
 * o teto do dia?", "isso foi modelo aprovado?" —, mas são consulta, não leitura:
 * por isso vão em pílulas miúdas embaixo do balão, e não dentro dele.
 */
function selosDa(mensagem: MensagemDoFio): string[] {
  return [
    mensagem.porModelo ? 'modelo aprovado' : null,
    mensagem.primeiroContato ? 'primeiro contato' : null,
    mensagem.confirmacaoDeOptout ? 'confirmação de opt-out' : null,
    mensagem.iniciadaPelaEmpresa && !mensagem.entrada && !mensagem.confirmacaoDeOptout
      ? 'fora da janela'
      : null,
  ].filter((s): s is string => s !== null);
}

/**
 * Mensagem sem corpo — que não é o mesmo que mensagem vazia.
 *
 * A frase sai de `avisoSemConteudo`: retenção de 12 meses, mensagem que a Meta
 * não entrega à API, localização, cartão de contato. Mídia sem arquivo NÃO passa
 * por aqui: foto, vídeo, áudio e documento têm o aviso deles (`ArquivoAusente`).
 */
function SemCorpo({ mensagem }: { mensagem: MensagemDoFio }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <FileText className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>{avisoSemConteudo(mensagem)}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Áudio: o player e a transcrição de máquina
// ---------------------------------------------------------------------------

type EstadoDoArquivo = 'procurando' | 'pronto' | 'ausente';

/** Os tipos que trazem um arquivo para mostrar no balão (02/10/2026). */
const TIPOS_COM_ARQUIVO: ReadonlySet<string> = new Set(['audio', 'image', 'video', 'document']);

/**
 * A URL assinada do arquivo de uma mensagem.
 *
 * O que identifica o arquivo para o servidor é a MENSAGEM, não o caminho (ver
 * `urlDaMidia`). `midiaCaminho` continua valendo para saber se há arquivo
 * guardado: sem ele, nem vale a ida ao servidor.
 *
 * A URL vale cinco minutos (`/api/midia`). Quem fica mais tempo com a conversa
 * aberta e dá play num vídeo pega uma URL vencida — por isso `renovar()`, que o
 * player chama no erro, uma vez.
 *
 * A assinatura fica no cache de consultas por quatro minutos (20/10/2026): voltar
 * a uma conversa já aberta, ou o React montar o balão de novo, reaproveita a
 * mesma URL — e, com a mesma URL, o navegador também não baixa a foto outra vez.
 * Antes, cada montagem era um pedido ao servidor e um download. A chave leva a
 * mensagem, o caminho e a vez: nenhuma resposta serve a outro arquivo.
 */
const VALIDADE_DA_ASSINATURA_MS = 4 * 60_000;

function useArquivoDaMensagem(mensagem: MensagemDoFio): {
  estado: EstadoDoArquivo;
  url: string | null;
  renovar: () => void;
} {
  const caminho = mensagem.midiaCaminho;
  const messageId = mensagem.id;
  const [vez, setVez] = useState(0);
  const assinatura = useQuery({
    queryKey: ['conversas', 'midia', messageId, caminho, vez],
    queryFn: () => urlDaMidia(messageId),
    enabled: Boolean(caminho),
    // A URL vale cinco minutos; quatro deixam um de folga para quem der play.
    staleTime: VALIDADE_DA_ASSINATURA_MS,
    gcTime: VALIDADE_DA_ASSINATURA_MS,
    // `urlDaMidia` não lança: falha é `null`, e o balão mostra a transcrição.
    retry: false,
    // Uma URL assinada não é dado que envelhece com a troca de tela.
    meta: SOBREVIVE_A_NAVEGACAO,
  });

  const estado: EstadoDoArquivo = !caminho
    ? 'ausente'
    : assinatura.data === undefined
      ? 'procurando'
      : assinatura.data
        ? 'pronto'
        : 'ausente';
  return {
    estado,
    url: assinatura.data ?? null,
    renovar: () => setVez((v) => (v < 2 ? v + 1 : v)),
  };
}

/**
 * Abre o arquivo numa aba nova com uma URL RECÉM-ASSINADA. A do balão pode ter
 * vencido (cinco minutos); a aba é aberta antes do pedido para o navegador não
 * tratar como janela não solicitada.
 */
async function abrirArquivo(messageId: string): Promise<void> {
  const aba = window.open('', '_blank');
  const url = await urlDaMidia(messageId);
  if (aba === null) return;
  if (url) {
    aba.opener = null;
    aba.location.href = url;
  } else {
    aba.close();
  }
}

/** Baixa o documento com o nome que o contato vê (a URL assinada leva o nome). */
async function baixarArquivo(messageId: string): Promise<void> {
  const url = await urlDaMidia(messageId, true);
  if (!url) {
    toast.error('O arquivo não está disponível agora.');
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Sem arquivo guardado. Diz o que aconteceu e o que vai acontecer: o worker busca
 * na Meta, a cada 10 minutos, o que chegou sem arquivo (`midias-atrasadas.ts`), e
 * o balão troca sozinho quando ele chega — a tela escuta a mensagem.
 *
 * Até 07/10/2026 a frase falava dos 30 dias e de pedir para a pessoa mandar de
 * novo, e era isso que aparecia nos minutos entre a chegada de uma figurinha e a
 * passada seguinte: o Rafael viu e achou que ela não ia carregar nunca.
 */
function ArquivoAusente({ rotulo, icone }: { rotulo: string; icone: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icone}</span>
      <span>
        {rotulo} ainda sem arquivo no CRM. Ele busca na Meta a cada 10 minutos, e aparece aqui
        sozinho. Se continuar assim, a Meta não entregou o arquivo: peça para a pessoa mandar de
        novo.
      </span>
    </p>
  );
}

/**
 * A foto, no balão. Um toque abre em tamanho real numa aba nova.
 *
 * A FIGURINHA também é desenhada aqui (07/10/2026): é uma imagem webp, e a Meta
 * a manda como `sticker`, que o banco grava como `image` com `tipoNaMeta`. Ela
 * sai menor e sem corte, do jeito que aparece no WhatsApp.
 */
function Foto({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado, url, renovar } = useArquivoDaMensagem(mensagem);
  const figurinha = mensagem.tipoNaMeta === 'sticker';
  const nome = figurinha ? 'Figurinha' : 'Foto';
  if (estado === 'ausente') {
    return (
      <ArquivoAusente rotulo={nome} icone={<ImageIcon className="size-3.5" aria-hidden="true" />} />
    );
  }
  if (estado === 'procurando' || !url) {
    return (
      <div
        className={cn(
          'max-w-full animate-pulse rounded-xl bg-muted',
          figurinha ? 'size-32' : 'h-48 w-64',
        )}
        aria-label={`Carregando a ${nome.toLowerCase()}`}
      />
    );
  }
  if (figurinha) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage: o otimizador do Next guardaria uma cópia de algo que tem de expirar.
      <img
        src={url}
        alt={mensagem.entrada ? 'Figurinha recebida' : 'Figurinha enviada'}
        loading="lazy"
        onError={renovar}
        className="size-32 object-contain"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => void abrirArquivo(mensagem.id)}
      className="block overflow-hidden rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      title="Abrir a foto em tamanho real"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage: o otimizador do Next guardaria uma cópia de algo que tem de expirar. */}
      <img
        src={url}
        alt={mensagem.entrada ? 'Foto recebida' : 'Foto enviada'}
        loading="lazy"
        onError={renovar}
        className="max-h-80 w-auto max-w-full object-cover"
      />
    </button>
  );
}

/** O vídeo, com o player do navegador. `preload="metadata"`: só a capa e a duração. */
function Video({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado, url, renovar } = useArquivoDaMensagem(mensagem);
  if (estado === 'ausente') {
    return (
      <ArquivoAusente rotulo="Vídeo" icone={<Film className="size-3.5" aria-hidden="true" />} />
    );
  }
  if (estado === 'procurando' || !url) {
    return (
      <div
        className="h-48 w-72 max-w-full animate-pulse rounded-xl bg-muted"
        aria-label="Carregando o vídeo"
      />
    );
  }
  return (
    <video
      controls
      preload="metadata"
      playsInline
      src={url}
      onError={renovar}
      className="max-h-80 w-full max-w-md rounded-xl bg-black"
      aria-label={mensagem.entrada ? 'Vídeo recebido' : 'Vídeo enviado'}
    />
  );
}

/**
 * O documento: o nome do arquivo, que é o que o contato vê, e as duas saídas —
 * abrir numa aba nova (o PDF abre no navegador) e baixar com o nome certo.
 */
function Documento({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado } = useArquivoDaMensagem(mensagem);
  if (estado === 'ausente') {
    return (
      <ArquivoAusente
        rotulo="Documento"
        icone={<FileText className="size-3.5" aria-hidden="true" />}
      />
    );
  }
  const nome =
    mensagem.midiaNome ?? ((mensagem.midiaTipo ?? '').includes('pdf') ? 'PDF' : 'Documento');
  const botao = cn(
    'inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60',
    'border-wpp-linha-forte bg-wpp-painel/60 hover:bg-wpp-painel',
  );
  return (
    <div className="min-w-56 space-y-2 rounded-xl bg-wpp-cita p-3">
      <p className="flex items-center gap-2 pr-6">
        <FileText className="size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 text-sm font-medium break-words">{nome}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={estado === 'procurando'}
          onClick={() => void abrirArquivo(mensagem.id)}
          className={botao}
        >
          {estado === 'procurando' ? 'Procurando...' : 'Abrir'}
        </button>
        <button
          type="button"
          disabled={estado === 'procurando'}
          onClick={() => void baixarArquivo(mensagem.id)}
          className={botao}
        >
          <Download className="size-3.5" aria-hidden="true" />
          Baixar
        </button>
      </div>
    </div>
  );
}

function Audio({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado, url } = useArquivoDaMensagem(mensagem);

  return (
    <div className="space-y-2">
      {estado === 'pronto' && url ? (
        // `preload="none"`: a Heloísa abre esta tela no 4G da rua, e um áudio de
        // 30 s baixado sozinho a cada conversa aberta é dado dela indo embora.
        <audio
          controls
          preload="none"
          src={url}
          className="h-11 w-full"
          aria-label="Áudio recebido do parceiro"
        />
      ) : (
        <p className="flex items-start gap-1.5 rounded-lg border border-dashed border-hairline px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
          <AudioLines className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {estado === 'procurando'
              ? 'Procurando o arquivo do áudio...'
              : 'O arquivo deste áudio não está guardado no CRM — a URL da Meta expira em minutos, e ele chegou quando o motor estava parado. A transcrição abaixo é o que dá para ler.'}
          </span>
        </p>
      )}

      {mensagem.transcricao ? (
        <Transcricao texto={mensagem.transcricao} />
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sem transcrição — a transcrição automática está desligada. Toque no player para ouvir.
        </p>
      )}
    </div>
  );
}

/**
 * A transcrição, marcada como máquina.
 *
 * Não é rodapé pequeno: é o rótulo em cima do texto. Uma transcrição automática
 * lida como se fosse a fala da pessoa é como "quinta não dá" vira "quinta dá" e
 * alguém aparece na porta de um buffet num dia errado. O texto fica em itálico e
 * dentro de uma moldura tracejada pela mesma razão — é a única coisa nesta tela
 * que nenhuma pessoa conferiu.
 */
function Transcricao({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg border border-dashed border-hairline bg-background/40 px-2.5 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <AudioLines className="size-3" aria-hidden="true" />
        transcrição automática, ninguém conferiu
      </p>
      <p className="text-sm leading-relaxed whitespace-pre-line italic">{texto}</p>
    </div>
  );
}

/**
 * O corpo da mensagem.
 *
 * A assinatura ("*Rafael:*" na primeira linha, que é como o parceiro vê no
 * WhatsApp) SAI do balão: quem escreveu já está dito em cima dele, e ler o mesmo
 * nome duas vezes em toda mensagem nossa era a maior fonte de ruído da coluna.
 * O texto que saiu continua inteiro no banco — aqui muda só o que a tela mostra.
 */
function Texto({
  texto,
  termo = '',
  correcao = false,
  espaco = null,
}: {
  texto: string;
  /** O que a lupa do fio está procurando: as ocorrências saem marcadas. */
  termo?: string;
  /** Mensagem de correção: o prefixo "Correção:" sai do corpo e vira o rótulo. */
  correcao?: boolean;
  /**
   * O lugar da hora (e do ✓✓, do nosso lado) na última linha: um espaço
   * invisível do tamanho deles, que empurra a linha para baixo só quando ela
   * não tem onde caber.
   */
  espaco?: 'entra' | 'sai' | null;
}) {
  const { resto } = separarAssinatura(texto);
  const corpo = correcao ? resto.replace(PREFIXO_DA_CORRECAO, '') : resto;
  const lugar = espaco ? (
    <span
      aria-hidden="true"
      className={cn('inline-block h-px', espaco === 'sai' ? 'w-[4.25rem]' : 'w-[3rem]')}
    />
  ) : null;
  if (!termo)
    return (
      <p className="break-words whitespace-pre-wrap">
        {corpo}
        {lugar}
      </p>
    );
  return (
    <p className="break-words whitespace-pre-wrap">
      {partesDestacadas(corpo, termo).map((parte, i) =>
        parte.destaque ? (
          <mark key={i} className="rounded-sm bg-wpp-marca px-0.5 text-wpp-marca-texto">
            {parte.texto}
          </mark>
        ) : (
          <span key={i}>{parte.texto}</span>
        ),
      )}
      {lugar}
    </p>
  );
}
