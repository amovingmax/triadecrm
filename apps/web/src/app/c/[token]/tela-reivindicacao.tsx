'use client';

import { useActionState, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ImageOff, Lock, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CLAUSULAS, hashCurto, TERMO_VERSAO } from '@/components/precadastro/termo';

import { aceitar, recusar, type ResultadoDoAceite } from './acoes';
import { PerfilRecusado, PerfilReivindicado } from './estados';
import { Entrada, Palco } from './palco';

const INICIAL: ResultadoDoAceite = { estado: 'inicial' };

/** Alvo de toque mínimo em campo (44px), aplicado a tudo que é clicável aqui. */
const ALVO = 'min-h-11';

export type PreviaDoPerfil = {
  nome: string;
  /** Pares rótulo/valor do `prefilled`, prontos para a tela. */
  campos: { campo: string; valor: string }[];
  origem: string | null;
  fotosPublicas: number | null;
  /** Data (dd/mm/aaaa) em que o rascunho é apagado sozinho; `null` se o banco não disse. */
  apagaEm: string | null;
};

/**
 * A página que o dono do buffet abre depois da ligação (telas T1 e T3 do R10,
 * RF-PRE-08).
 *
 * Duas etapas numa página só, sem navegação: primeiro a PERGUNTA, com a prova do
 * que a Komune sabe e de onde tirou; depois o ACEITE, com o termo por inteiro.
 * Ninguém aceita nada antes de ver o que está aceitando, e ninguém precisa
 * carregar uma segunda página com 4G ruim para chegar até o botão.
 *
 * A saída ("não é meu / não quero aparecer") está visível nas duas etapas e não
 * pede nada de quem escolhe: nem nome, nem confirmação por e-mail, nem "tem
 * certeza?" com um botão maior do outro lado. A LGPD exige que ela exista e que
 * seja fácil; um funil que dificulta a saída é um funil que perde na ANPD.
 */
export function TelaReivindicacao({
  token,
  previa,
  termoHash,
}: {
  token: string;
  previa: PreviaDoPerfil;
  /** sha256 do texto do termo, calculado no servidor sobre o MESMO texto exibido aqui. */
  termoHash: string;
}) {
  const [etapa, setEtapa] = useState<'previa' | 'termos' | 'saida'>('previa');

  const [aceite, enviarAceite, aceitando] = useActionState(aceitar.bind(null, token), INICIAL);
  const [recusa, enviarRecusa, recusando] = useActionState(recusar.bind(null, token), INICIAL);

  if (aceite.estado === 'aceito') {
    return <PerfilReivindicado quem={aceite.quem} nome={previa.nome} />;
  }
  if (recusa.estado === 'recusado') return <PerfilRecusado />;

  return (
    <Palco>
      {etapa === 'previa' ? (
        <Previa
          previa={previa}
          aoContinuar={() => setEtapa('termos')}
          aoSair={() => setEtapa('saida')}
        />
      ) : null}

      {etapa === 'termos' ? (
        <Termos
          previa={previa}
          termoHash={termoHash}
          erro={aceite.estado === 'erro' ? aceite.mensagem : null}
          enviando={aceitando}
          acao={enviarAceite}
          aoVoltar={() => setEtapa('previa')}
          aoSair={() => setEtapa('saida')}
        />
      ) : null}

      {etapa === 'saida' ? (
        <Saida
          erro={recusa.estado === 'erro' ? recusa.mensagem : null}
          enviando={recusando}
          acao={enviarRecusa}
          aoVoltar={() => setEtapa('previa')}
        />
      ) : null}
    </Palco>
  );
}

// ---------------------------------------------------------------------------
// Etapa 1 — a pergunta
// ---------------------------------------------------------------------------

function Previa({
  previa,
  aoContinuar,
  aoSair,
}: {
  previa: PreviaDoPerfil;
  aoContinuar: () => void;
  aoSair: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <Entrada indice={0}>
        <span className="pilula inline-flex items-center gap-2 py-1.5 pr-3.5 pl-3.5 text-xs text-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          Rascunho privado · não publicado
        </span>
      </Entrada>

      <Entrada indice={1}>
        <h1 className="titulo-gradiente text-4xl leading-[1.05] font-medium sm:text-5xl">
          Este perfil é seu?
        </h1>
      </Entrada>

      <Entrada indice={2}>
        <p className="max-w-[42ch] text-base text-balance text-grafite-600 sm:text-lg dark:text-grafite-400">
          A Komune montou um rascunho de perfil para{' '}
          <span className="font-medium text-foreground">{previa.nome}</span>. Ele está fora do ar, e
          só você, com este link, consegue ver.
        </p>
      </Entrada>

      {/* --------------------------------------------------------- a prova */}
      <Entrada indice={3}>
        <div className="rounded-xl border border-hairline bg-card p-5">
          <p className="text-sm font-medium">O que a Komune anotou</p>

          {previa.campos.length > 0 ? (
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {previa.campos.map((linha) => (
                <div key={linha.campo} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-grafite-500 dark:text-grafite-450">{linha.campo}</dt>
                  <dd className="text-sm break-words">{linha.valor}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-grafite-600 dark:text-grafite-400">
              Nada além do nome do seu negócio. Você preenche o resto do jeito que quiser.
            </p>
          )}

          <p className="mt-4 flex items-start gap-2 border-t border-hairline pt-4 text-sm text-grafite-600 dark:text-grafite-400">
            <ImageOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {previa.fotosPublicas && previa.fotosPublicas > 0 ? (
                <>
                  A Komune viu <span className="numerico">{previa.fotosPublicas}</span> fotos
                  públicas do seu negócio e não copiou nenhuma.
                </>
              ) : (
                'Nenhuma foto sua foi copiada, e nenhum texto de descrição.'
              )}{' '}
              As fotos do perfil serão as que você mesmo enviar.
            </span>
          </p>

          {/* A origem sai em frase própria, e nunca entre parênteses: o nome da
              fonte já costuma vir com parênteses ("Planilha (importação)"), e o
              aninhamento deixava a linha ilegível justamente onde ela precisa
              ser crível. */}
          <p className="mt-2 text-sm text-grafite-500 dark:text-grafite-450">
            Tudo isso veio de informação pública do seu negócio.{' '}
            {previa.origem ? `Origem: ${previa.origem}. ` : ''}
            {previa.apagaEm ? (
              <>
                Se você não fizer nada, este rascunho é apagado em{' '}
                <span className="numerico">{previa.apagaEm}</span>.
              </>
            ) : (
              'Se você não fizer nada, este rascunho é apagado dentro de 30 dias.'
            )}
          </p>
        </div>
      </Entrada>

      {/* ---------------------------------------------------------- a ação */}
      <Entrada indice={4} className="flex flex-col gap-3">
        <Button
          onClick={aoContinuar}
          className={cn('toque w-full text-base sm:w-fit sm:px-6', ALVO)}
          size="lg"
        >
          Sim, é meu. Continuar
          <ArrowRight aria-hidden="true" />
        </Button>

        <button
          type="button"
          onClick={aoSair}
          className={cn(
            'toque flex w-fit items-center text-sm text-grafite-500 underline underline-offset-4 dark:text-grafite-450',
            ALVO,
          )}
        >
          Não é meu, ou não quero aparecer
        </button>
      </Entrada>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 2 — o aceite
// ---------------------------------------------------------------------------

function Termos({
  previa,
  termoHash,
  erro,
  enviando,
  acao,
  aoVoltar,
  aoSair,
}: {
  previa: PreviaDoPerfil;
  termoHash: string;
  erro: string | null;
  enviando: boolean;
  acao: (formulario: FormData) => void;
  aoVoltar: () => void;
  aoSair: () => void;
}) {
  const destaque = CLAUSULAS.filter((c) => c.destaque);
  const resto = CLAUSULAS.filter((c) => !c.destaque);

  /**
   * O nome é CONTROLADO porque o React limpa o formulário depois de cada envio
   * de Server Action. Sem isto, um erro de rede apagava o nome que a pessoa
   * acabou de digitar no celular — e ela tinha de digitar de novo para descobrir
   * se o erro se repetia.
   *
   * As caixas continuam de fora: elas voltam desmarcadas a cada tentativa, de
   * propósito. Guardar "marcado" entre envios é a porta de entrada de uma caixa
   * pré-marcada, e o R06 PRE-06 não abre exceção. Marcar duas caixas de novo
   * custa dois toques; um aceite que a pessoa não deu de novo custa a prova.
   */
  const [quem, setQuem] = useState('');

  return (
    <div className="flex flex-col gap-6">
      <Entrada indice={0}>
        <button
          type="button"
          onClick={aoVoltar}
          className={cn(
            'toque -ml-1 flex w-fit items-center gap-1.5 text-sm text-grafite-500 dark:text-grafite-450',
            ALVO,
          )}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar para o rascunho
        </button>
      </Entrada>

      <Entrada indice={1} className="flex flex-col gap-3">
        <h1 className="titulo-gradiente text-3xl leading-[1.1] font-medium sm:text-4xl">
          Falta você autorizar
        </h1>
        <p className="max-w-[46ch] text-base text-grafite-600 dark:text-grafite-400">
          Leia as duas primeiras partes com atenção: são elas que dizem o que a Komune pode e não
          pode fazer com os dados de {previa.nome}.
        </p>
      </Entrada>

      {/* As cláusulas de dados e de fotos em moldura própria (R06 PRE-06: elas não
          podem ficar diluídas no meio do bloco corrido). */}
      {destaque.map((c, i) => (
        <Entrada key={c.id} indice={2 + i}>
          <section className="rounded-xl border border-hairline bg-card p-5">
            <h2 className="text-sm font-medium">{c.titulo}</h2>
            {c.paragrafos.map((p) => (
              <p key={p} className="mt-2 text-sm text-grafite-600 dark:text-grafite-400">
                {p}
              </p>
            ))}
          </section>
        </Entrada>
      ))}

      <Entrada indice={4} className="flex flex-col gap-4">
        {resto.map((c) => (
          <section key={c.id}>
            <h2 className="text-sm font-medium">{c.titulo}</h2>
            {c.paragrafos.map((p) => (
              <p key={p} className="mt-1.5 text-sm text-grafite-600 dark:text-grafite-400">
                {p}
              </p>
            ))}
          </section>
        ))}

        {/* Versão e hash do termo à vista (R06 PRE-06). Não é decoração: é o que
            permite a qualquer um conferir, depois, que o texto aceito é este. */}
        <p className="text-xs text-grafite-500 dark:text-grafite-450">
          Termo <span className="numerico">{TERMO_VERSAO}</span> · verificação{' '}
          <span className="numerico">{hashCurto(termoHash)}</span>
        </p>
      </Entrada>

      {/* -------------------------------------------------------- o formulário */}
      <Entrada indice={5}>
        <form action={acao} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1" disabled={enviando}>
            <legend className="sr-only">Autorizações</legend>

            <Caixa
              nome="termos"
              obrigatoria
              texto="Li e aceito os Termos de Uso e o Contrato de Prestação de Serviços da Komune."
            />
            <Caixa
              nome="dados"
              obrigatoria
              texto="Autorizo a Komune a usar as informações públicas do meu negócio, listadas acima, para montar o meu perfil."
            />
            <Caixa
              nome="novidades"
              texto="Quero receber novidades e oportunidades da Komune pelo WhatsApp. (Opcional, e dá para cancelar a qualquer momento.)"
            />

            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-sm font-medium">Quem está autorizando</span>
              <input
                type="text"
                name="quem"
                value={quem}
                onChange={(e) => setQuem(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
                placeholder="Nome completo"
                // `text-base` no celular de propósito: abaixo de 16px o iOS dá
                // zoom no campo ao focar e a pessoa perde a página de vista.
                className={cn(
                  'w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                  ALVO,
                )}
              />
              <span className="text-xs text-grafite-500 dark:text-grafite-450">
                Fica registrado junto com a data, a hora e a versão do termo.
              </span>
            </label>
          </fieldset>

          {erro ? (
            <div
              role="alert"
              className="rounded-xl border border-transparent bg-quente-fundo p-4 text-sm text-quente-texto"
            >
              <p>{erro}</p>
              <p className="mt-1.5 text-grafite-700 dark:text-grafite-300">
                As caixas voltam desmarcadas a cada tentativa. Marque de novo antes de enviar.
              </p>
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={enviando}
            size="lg"
            className={cn('toque w-full text-base sm:w-fit sm:px-6', ALVO)}
          >
            <Check aria-hidden="true" />
            {enviando ? 'Registrando...' : 'Autorizar e reivindicar o perfil'}
          </Button>

          <button
            type="button"
            onClick={aoSair}
            className={cn(
              'toque flex w-fit items-center text-sm text-grafite-500 underline underline-offset-4 dark:text-grafite-450',
              ALVO,
            )}
          >
            Pensando bem, não quero aparecer
          </button>
        </form>
      </Entrada>
    </div>
  );
}

/**
 * Caixa de aceite. NASCE DESMARCADA, sempre (R06 PRE-06) — não há `defaultChecked`
 * neste arquivo, e nem pode haver.
 */
function Caixa({
  nome,
  texto,
  obrigatoria = false,
}: {
  nome: string;
  texto: string;
  obrigatoria?: boolean;
}) {
  return (
    <label
      className={cn(
        'toque flex cursor-pointer items-start gap-3 rounded-lg py-2 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
        ALVO,
      )}
    >
      <input
        type="checkbox"
        name={nome}
        required={obrigatoria}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <span className="text-grafite-700 dark:text-grafite-300">
        {texto}
        {obrigatoria ? (
          <span className="ml-1 text-grafite-500 dark:text-grafite-450">(obrigatório)</span>
        ) : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// A saída
// ---------------------------------------------------------------------------

function Saida({
  erro,
  enviando,
  acao,
  aoVoltar,
}: {
  erro: string | null;
  enviando: boolean;
  acao: (formulario: FormData) => void;
  aoVoltar: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <Entrada indice={0}>
        <button
          type="button"
          onClick={aoVoltar}
          className={cn(
            'toque -ml-1 flex w-fit items-center gap-1.5 text-sm text-grafite-500 dark:text-grafite-450',
            ALVO,
          )}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar
        </button>
      </Entrada>

      <Entrada indice={1} className="flex flex-col gap-3">
        <h1 className="titulo-gradiente text-3xl leading-[1.1] font-medium sm:text-4xl">
          Sem problema
        </h1>
        <p className="max-w-[46ch] text-base text-grafite-600 dark:text-grafite-400">
          Escolha o motivo e o rascunho é apagado em até 48 horas. Não vamos insistir, nem pedir
          nada em troca.
        </p>
      </Entrada>

      <Entrada indice={2}>
        <form action={acao} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1" disabled={enviando}>
            <legend className="text-sm font-medium">Motivo</legend>
            <Opcao
              valor="nao_e_meu"
              texto="Este negócio não é meu: não tenho nada a ver com ele."
            />
            <Opcao
              valor="nao_quero"
              texto="É meu, mas eu não quero um perfil na Komune, e não quero ser procurado de novo."
            />
          </fieldset>

          {erro ? (
            <p
              role="alert"
              className="rounded-xl border border-transparent bg-quente-fundo p-4 text-sm text-quente-texto"
            >
              {erro}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="outline"
            disabled={enviando}
            size="lg"
            className={cn('toque w-full sm:w-fit sm:px-6', ALVO)}
          >
            <Trash2 aria-hidden="true" />
            {enviando ? 'Registrando...' : 'Apagar este rascunho'}
          </Button>
        </form>
      </Entrada>
    </div>
  );
}

/** Uma escolha de motivo. Também nasce desmarcada: nenhum motivo é sugerido. */
function Opcao({ valor, texto }: { valor: string; texto: string }) {
  return (
    <label
      className={cn(
        'toque flex cursor-pointer items-start gap-3 rounded-lg py-2 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
        ALVO,
      )}
    >
      <input
        type="radio"
        name="motivo"
        value={valor}
        required
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <span className="text-grafite-700 dark:text-grafite-300">{texto}</span>
    </label>
  );
}
