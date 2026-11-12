'use client';

import { ShieldCheck } from 'lucide-react';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OpcaoPessoa } from '@/components/parceiros/tipos';

import { EscolhaMultipla } from './escolha-multipla';
import { rotuloDaVariavel } from './formatos';
import { CAMPOS_DA_FICHA, type AcaoDoBotao, type Assinatura, type RegraDaVariavel } from './tipos';

/** Por hora. Acima de 60 o relógio manda mais de uma por minuto (20261112100000). */
export const RITMOS = [10, 20, 30, 60, 120, 240] as const;
export const RITMO_PADRAO = 60;

/**
 * "Mais opções" da barra de enviar: tudo o que tem um padrão bom e por isso
 * fica fechado — quando sai, o ritmo, quem assina, o nome do disparo, o que
 * cada botão faz e de onde vem cada campo. Quem não abre envia do jeito certo.
 */
export function MaisOpcoes({
  agendar,
  aoAgendar,
  inicio,
  aoMudarInicio,
  quandoSai,
  porHora,
  aoMudarRitmo,
  assinatura,
  aoMudarAssinatura,
  atendentes,
  aoMudarAtendentes,
  pessoas,
  conflitoDeAssinatura,
  nome,
  aoMudarNome,
  acoes,
  aoMudarAcao,
  precisaDeLink,
  linkDestino,
  aoMudarLink,
  daFicha,
  regras,
  aoMudarRegra,
}: {
  agendar: boolean;
  aoAgendar: (v: boolean) => void;
  /** `datetime-local`, no relógio do navegador. */
  inicio: string;
  aoMudarInicio: (v: string) => void;
  /** Quando o disparo começa de verdade, já contando o horário de envio. */
  quandoSai: string;
  porHora: number;
  aoMudarRitmo: (v: number) => void;
  assinatura: Assinatura;
  aoMudarAssinatura: (v: Assinatura) => void;
  atendentes: string[];
  aoMudarAtendentes: (v: string[]) => void;
  pessoas: readonly OpcaoPessoa[];
  conflitoDeAssinatura: boolean;
  nome: string;
  aoMudarNome: (v: string) => void;
  acoes: Record<string, AcaoDoBotao>;
  aoMudarAcao: (botao: string, a: AcaoDoBotao) => void;
  precisaDeLink: boolean;
  linkDestino: string;
  aoMudarLink: (v: string) => void;
  daFicha: readonly string[];
  regras: Record<string, RegraDaVariavel>;
  aoMudarRegra: (variavel: string, r: RegraDaVariavel) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-3">
        <div role="group" aria-labelledby="op-quando" className="min-w-0 space-y-2">
          <h3 id="op-quando" className="text-xs font-semibold text-muted-foreground">
            Quando sai
          </h3>
          <div className="flex flex-wrap gap-2">
            <Pilula ativa={!agendar} aoClicar={() => aoAgendar(false)}>
              Agora
            </Pilula>
            <Pilula ativa={agendar} aoClicar={() => aoAgendar(true)}>
              Agendar
            </Pilula>
          </div>
          {agendar ? (
            <label className="block space-y-1 text-xs text-muted-foreground">
              Dia e hora do começo
              <Input
                type="datetime-local"
                value={inicio}
                onChange={(e) => aoMudarInicio(e.target.value)}
                className="numerico h-11 md:h-9"
              />
            </label>
          ) : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {quandoSai}
            {agendar ? ' Até 30 dias à frente.' : ''}
          </p>
        </div>

        <div className="min-w-0 space-y-2">
          <label htmlFor="op-ritmo" className="block text-xs font-semibold text-muted-foreground">
            Ritmo
          </label>
          <Select value={String(porHora)} onValueChange={(v) => aoMudarRitmo(Number(v))}>
            <SelectTrigger id="op-ritmo" className="toque h-11 w-full md:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RITMOS.map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r} por hora{r === 60 ? ' (1 por minuto)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Mais devagar dá tempo de o time responder quem responder. Quem segura o total do dia é o
            limite da Meta.
          </p>
        </div>

        <div className="min-w-0 space-y-2">
          <label htmlFor="op-assina" className="block text-xs font-semibold text-muted-foreground">
            Quem assina
          </label>
          <Select value={assinatura} onValueChange={(v) => aoMudarAssinatura(v as Assinatura)}>
            <SelectTrigger id="op-assina" className="toque h-11 w-full md:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="marca">Em nome da {EMPRESA.nome}</SelectItem>
              <SelectItem value="eu">Eu</SelectItem>
              <SelectItem value="responsavel">O responsável de cada parceiro</SelectItem>
              <SelectItem value="revezar">Dividir entre atendentes</SelectItem>
            </SelectContent>
          </Select>
          {assinatura === 'revezar' ? (
            <EscolhaMultipla
              rotulo="Atendentes"
              opcoes={pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
              valor={atendentes}
              aoMudar={aoMudarAtendentes}
            />
          ) : null}
          <p
            className={cn(
              'text-xs leading-relaxed',
              conflitoDeAssinatura ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {conflitoDeAssinatura
              ? `A mensagem escolhida diz o nome de quem envia: em nome da ${EMPRESA.nome}, sem nome, ela não sai.`
              : assinatura === 'marca'
                ? 'As respostas caem nas Conversas do responsável de cada parceiro (ou de quem montou o disparo).'
                : 'As respostas caem nas Conversas de quem assinou.'}
          </p>
        </div>
      </div>

      <div className="max-w-md space-y-1">
        <label htmlFor="op-nome" className="block text-xs font-semibold text-muted-foreground">
          Nome do disparo (só o time vê)
        </label>
        <Input
          id="op-nome"
          value={nome}
          maxLength={120}
          onChange={(e) => aoMudarNome(e.target.value)}
          placeholder="Ex.: Convite buffets — novembro"
          className="h-11 md:h-9"
        />
      </div>

      {Object.keys(acoes).length > 0 || precisaDeLink ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            O que acontece em cada botão
          </h3>
          {Object.entries(acoes).map(([rotulo, acao]) => (
            <EditorDeAcao
              key={rotulo}
              rotulo={rotulo}
              acao={acao}
              aoMudar={(a) => aoMudarAcao(rotulo, a)}
            />
          ))}
          {precisaDeLink ? (
            <div className="space-y-1">
              <label htmlFor="op-destino" className="block text-xs text-muted-foreground">
                Para onde o link leva
              </label>
              <Input
                id="op-destino"
                type="url"
                inputMode="url"
                value={linkDestino}
                onChange={(e) => aoMudarLink(e.target.value)}
                placeholder="https://"
                className="h-11 md:h-9"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                O link passa pelo CRM, que conta o clique antes de levar a pessoa para lá.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {daFicha.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">De onde vem cada campo</h3>
          {daFicha.map((v) => (
            <EditorDeRegra
              key={v}
              variavel={v}
              regra={regras[v] ?? { fixo: '' }}
              aoMudar={(r) => aoMudarRegra(v, r)}
            />
          ))}
        </div>
      ) : null}

      <div className="flex gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Sempre ligadas: só de 8h às 17h45 em dia útil; ninguém que pediu para sair; ninguém que
          recebeu mensagem nossa sem responder nas últimas 72 h; o limite de conversas por dia que a
          Meta dá ao número (toda conversa que a gente começa conta, e a nota amarela corta pela
          metade); e o disparo para sozinho se 3 pessoas ou mais (acima de 2%) pedirem para sair.
        </p>
      </div>
    </div>
  );
}

/** Pílula de "um destes", no desenho das pílulas de seção do CRM. */
function Pilula({
  ativa,
  aoClicar,
  children,
}: {
  ativa: boolean;
  aoClicar: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoClicar}
      className={cn(
        'toque flex h-11 items-center rounded-full border px-4 text-sm transition-colors md:h-8',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        ativa
          ? 'border-transparent bg-foreground text-background'
          : 'border-hairline text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function EditorDeRegra({
  variavel,
  regra,
  aoMudar,
}: {
  variavel: string;
  regra: RegraDaVariavel;
  aoMudar: (r: RegraDaVariavel) => void;
}) {
  const fonte = 'fixo' in regra ? 'fixo' : regra.campo;
  const valor = 'fixo' in regra ? regra.fixo : regra.reserva;
  const rotulo = `[${rotuloDaVariavel(variavel)}]`;
  return (
    <div className="grid gap-2 rounded-lg border border-hairline p-2 sm:grid-cols-[8rem_12rem_minmax(0,1fr)] sm:items-center">
      <span className="text-sm font-medium">{rotulo}</span>
      <Select
        value={fonte}
        onValueChange={(v) =>
          aoMudar(
            v === 'fixo'
              ? { fixo: valor }
              : { campo: v as (typeof CAMPOS_DA_FICHA)[number]['valor'], reserva: valor },
          )
        }
      >
        <SelectTrigger className="toque h-11 md:h-8" aria-label={`De onde vem ${rotulo}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CAMPOS_DA_FICHA.map((c) => (
            <SelectItem key={c.valor} value={c.valor}>
              {c.rotulo}
            </SelectItem>
          ))}
          <SelectItem value="fixo">Texto fixo (igual para todos)</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={valor}
        maxLength={200}
        onChange={(e) =>
          aoMudar(
            'fixo' in regra ? { fixo: e.target.value } : { ...regra, reserva: e.target.value },
          )
        }
        placeholder={'fixo' in regra ? 'O texto' : 'Se a ficha não tiver, usar…'}
        aria-label={'fixo' in regra ? `Texto de ${rotulo}` : `Se a ficha não tiver ${rotulo}, usar`}
        className="h-11 md:h-8"
      />
    </div>
  );
}

/** O texto que vai com o link quando alguém toca num botão de resposta. */
const TEXTO_DO_LINK = 'Que bom! O cadastro leva 5 minutos e é grátis. É só tocar no botão abaixo.';

function EditorDeAcao({
  rotulo,
  acao,
  aoMudar,
}: {
  rotulo: string;
  acao: AcaoDoBotao;
  aoMudar: (a: AcaoDoBotao) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-hairline p-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
        <span className="text-sm">
          Quem tocar em <span className="font-medium">“{rotulo}”</span>
        </span>
        <Select
          value={acao.acao}
          onValueChange={(v) =>
            aoMudar(
              v === 'link'
                ? { acao: 'link', texto: TEXTO_DO_LINK, botao: 'Criar meu perfil' }
                : { acao: v as 'sair' | 'nada' },
            )
          }
        >
          <SelectTrigger className="toque h-11 md:h-8" aria-label={`O que acontece em “${rotulo}”`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="link">recebe o link na hora</SelectItem>
            <SelectItem value="sair">sai da lista (não recebe mais)</SelectItem>
            <SelectItem value="nada">fica na caixa para o time responder</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {acao.acao === 'link' ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <textarea
            value={acao.texto}
            maxLength={900}
            rows={2}
            onChange={(e) => aoMudar({ ...acao, texto: e.target.value })}
            aria-label={`Texto que vai com o link em “${rotulo}”`}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
          />
          <Input
            value={acao.botao}
            maxLength={20}
            onChange={(e) => aoMudar({ ...acao, botao: e.target.value })}
            aria-label={`Rótulo do botão do link em “${rotulo}”`}
            className="h-11 md:h-9"
          />
        </div>
      ) : null}
    </div>
  );
}
