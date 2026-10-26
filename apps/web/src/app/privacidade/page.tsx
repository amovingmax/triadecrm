import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { EMPRESA } from '@/lib/empresa';

/**
 * Política de privacidade pública da empresa (`/privacidade`), aberta sem login
 * (`ehRotaPublica`). Existe porque a Meta só publica o app do WhatsApp, e o Google
 * só publica o login, com o link de uma política, e porque a LGPD (art. 9º) manda
 * dizer a quem conversa com a empresa o que é feito com os dados dela.
 *
 * O texto é um só; o que muda de uma empresa para outra vem de
 * `EMPRESA.privacidade` (`packages/schema/src/empresas.ts`). Empresa sem política
 * no CRM (a KOMUNE, que publica a dela no próprio site) recebe 404.
 *
 * O texto promete o que o CRM faz hoje, e nada além: as palavras de parada são as
 * de `app.wa_parece_optout`, a lista de serviços é a do deploy da empresa, e a IA
 * só aparece quando o módulo está ligado. Mudou o texto, muda `versao`.
 */

export const metadata: Metadata = {
  title: 'Política de privacidade',
  description: `Como ${EMPRESA.nome} trata os dados pessoais de quem conversa com ela.`,
};

export default function Privacidade() {
  const p = EMPRESA.privacidade;
  if (!p) notFound();

  const servicos: { nome: string; para: string }[] = [
    { nome: 'Meta (WhatsApp Business)', para: 'entrega e recebimento das mensagens do WhatsApp' },
    { nome: 'Supabase', para: 'banco de dados e arquivos do sistema, em servidores em São Paulo' },
    {
      nome: 'Fly.io',
      para: 'o serviço que envia e organiza as mensagens do WhatsApp, em São Paulo',
    },
    { nome: 'Vercel', para: 'hospedagem das telas do sistema' },
    { nome: 'Google', para: 'login da equipe no sistema' },
    ...(EMPRESA.modulos.ia
      ? [{ nome: 'Anthropic', para: 'leitura das conversas por IA, sem telefone nem e-mail' }]
      : []),
  ];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <header className="border-b pb-6">
        <p className="text-sm font-medium text-muted-foreground">{p.controlador}</p>
        <h1 className="mt-1 font-heading text-2xl font-semibold sm:text-3xl">
          Política de privacidade
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Versão de {p.versao}</p>
      </header>

      <div className="mt-6 space-y-4 text-[15px] leading-7">
        <p>
          Esta página explica como a {p.controlador} trata os dados pessoais de quem conversa com
          ela, principalmente pelo WhatsApp {p.whatsapp}, e de quem da equipe usa o sistema de
          atendimento. Ela segue a Lei Geral de Proteção de Dados Pessoais (Lei 13.709/2018, a
          LGPD).
        </p>
      </div>

      <Secao id="quem-somos" titulo="1. Quem somos">
        <p>
          A responsável pelos seus dados (a &ldquo;controladora&rdquo;, na linguagem da LGPD) é a{' '}
          {p.controlador}, {p.registro}, com endereço na {p.endereco}.
        </p>
        <p>
          Pedidos e dúvidas sobre privacidade vão para <Email endereco={p.email} />. Esse e-mail
          também é o canal do encarregado pelo tratamento de dados (LGPD, art. 41).
        </p>
      </Secao>

      <Secao id="dados" titulo="2. Quais dados tratamos">
        <p>De quem conversa com a {p.controlador}:</p>
        <Lista
          itens={[
            'nome, telefone e WhatsApp, e e-mail quando você o informa;',
            'as mensagens e os arquivos que você envia ou recebe (texto, áudio, fotos e documentos);',
            'os imóveis do seu interesse ou que você oferece (tipo, região e valor);',
            'visitas e retornos combinados, e o histórico do atendimento (quem atendeu e quando).',
          ]}
        />
        <p>
          Da equipe: o nome e o e-mail da conta Google usada para entrar no sistema, e o registro do
          que cada pessoa fez nele.
        </p>
        <p>O sistema de atendimento não guarda CPF nem dados bancários.</p>
      </Secao>

      <Secao id="finalidades" titulo="3. Para que usamos e com que base legal">
        <Lista
          itens={[
            <>
              <strong>Responder quem nos procura</strong> e atender o interesse em comprar, vender
              ou alugar um imóvel. Base: procedimentos que antecedem um contrato, a seu pedido
              (LGPD, art. 7º, V).
            </>,
            <>
              <strong>Organizar o atendimento</strong>: saber quem atendeu, retomar uma conversa e
              combinar visitas. Base: legítimo interesse (art. 7º, IX).
            </>,
            <>
              <strong>Enviar mensagens sobre imóveis</strong> a quem já é contato da {p.controlador}
              . Base: legítimo interesse, e você pode pedir para parar quando quiser (item 8).
            </>,
            <>
              <strong>Cumprir a lei e defender direitos</strong> em processo, quando for o caso
              (art. 7º, II e VI).
            </>,
          ]}
        />
        {!EMPRESA.modulos.ia && <p>Nenhuma decisão sobre você é tomada de forma automatizada.</p>}
      </Secao>

      <Secao id="compartilhamento" titulo="4. Com quem compartilhamos">
        <p>Só com os serviços que fazem o atendimento funcionar, e só para isso:</p>
        <Lista
          itens={servicos.map((s) => (
            <>
              <strong>{s.nome}</strong>: {s.para}.
            </>
          ))}
        />
        <p>
          Não vendemos nem alugamos dados pessoais. Podemos informar dados a autoridades quando a
          lei ou uma ordem judicial obrigar.
        </p>
      </Secao>

      <Secao id="transferencia" titulo="5. Dados fora do Brasil">
        <p>
          Parte desses serviços pode tratar dados fora do Brasil, principalmente nos Estados Unidos.
          Isso acontece nos casos do art. 33 da LGPD, com as cláusulas contratuais e as garantias
          que esses serviços oferecem.
        </p>
      </Secao>

      <Secao id="guarda" titulo="6. Por quanto tempo guardamos">
        <p>
          Contatos, conversas e histórico de atendimento ficam guardados enquanto houver
          relacionamento e por até {p.guarda} depois do último contato. Depois disso, são apagados
          ou anonimizados, a não ser que a lei obrigue a guardar por mais tempo ou que sejam
          necessários para defender direitos em processo.
        </p>
      </Secao>

      <Secao id="direitos" titulo="7. Seus direitos">
        <p>Pela LGPD (art. 18), você pode pedir, a qualquer momento:</p>
        <Lista
          itens={[
            'a confirmação de que tratamos seus dados e o acesso a eles;',
            'a correção de dados incompletos, errados ou desatualizados;',
            'a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados fora da lei;',
            'a portabilidade dos dados a outro fornecedor;',
            'a informação de com quem compartilhamos seus dados;',
            'a revogação do consentimento, quando ele for a base do tratamento;',
            'a oposição a um tratamento feito com base em legítimo interesse.',
          ]}
        />
        <p>
          Para pedir, escreva para <Email endereco={p.email} /> ou mande mensagem no WhatsApp{' '}
          {p.whatsapp}. Respondemos em até 15 dias e podemos pedir uma confirmação de que o pedido é
          mesmo seu. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em{' '}
          <a className="underline underline-offset-4" href="https://www.gov.br/anpd">
            gov.br/anpd
          </a>
          .
        </p>
      </Secao>

      <Secao id="parar" titulo="8. Como parar de receber mensagens">
        <p>
          Responda <strong>SAIR</strong>, <strong>PARAR</strong>, <strong>NÃO QUERO</strong> ou{' '}
          <strong>REMOVER</strong> no WhatsApp. O sistema marca o seu número na hora, e nenhuma
          mensagem nova da {p.controlador} sai para ele.
        </p>
      </Secao>

      <Secao id="exclusao" titulo="9. Como pedir a exclusão dos seus dados">
        <Lista
          ordenada
          itens={[
            <>
              Escreva para <Email endereco={p.email} /> com o assunto &ldquo;Excluir meus
              dados&rdquo;, ou mande a mesma frase no WhatsApp {p.whatsapp}, informando o número de
              telefone que usou com a gente.
            </>,
            'Confirmamos que o pedido é seu.',
            'Em até 15 dias, apagamos ou anonimizamos seus contatos, conversas e arquivos, e avisamos você.',
          ]}
        />
        <p>
          Guardamos apenas o que a lei obrigar e o seu número numa lista de bloqueio, para garantir
          que você não receba mais mensagens.
        </p>
      </Secao>

      <Secao id="seguranca" titulo="10. Segurança">
        <p>
          Só a equipe liberada por um administrador entra no sistema, com login do Google, e cada
          pessoa vê o que o seu papel permite. A conexão é criptografada, e o sistema registra quem
          revelou um telefone ou exportou dados.
        </p>
      </Secao>

      <Secao id="cookies" titulo="11. Cookies">
        <p>
          Esta página não usa cookies de rastreamento nem de publicidade. O sistema da equipe usa
          apenas o cookie da sessão de login.
        </p>
      </Secao>

      <Secao id="mudancas" titulo="12. Mudanças nesta política">
        <p>Quando esta política mudar, a data da versão, no topo da página, muda junto.</p>
      </Secao>
    </main>
  );
}

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-6">
      <h2 className="font-heading text-lg font-semibold">{titulo}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7">{children}</div>
    </section>
  );
}

function Lista({ itens, ordenada = false }: { itens: ReactNode[]; ordenada?: boolean }) {
  const Tag = ordenada ? 'ol' : 'ul';
  return (
    <Tag className={`space-y-2 pl-5 ${ordenada ? 'list-decimal' : 'list-disc'}`}>
      {itens.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
  );
}

function Email({ endereco }: { endereco: string }) {
  return (
    <a className="underline underline-offset-4" href={`mailto:${endereco}`}>
      {endereco}
    </a>
  );
}
