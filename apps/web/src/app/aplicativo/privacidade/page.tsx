import type { Metadata } from 'next';

import { Email, Link, Lista, Secao } from '@/components/pagina-publica';
import { APLICATIVO } from '@/lib/aplicativo';

/**
 * Política de privacidade do app de celular (`/aplicativo/privacidade`), aberta sem
 * login (`ehRotaPublica`). É o link que a ficha da App Store pede, e fala de quem USA
 * o app: a equipe. Os dados dos clientes atendidos seguem a política de cada empresa
 * (`/privacidade` na Imova, o site da KOMUNE), linkadas no item 1.
 *
 * O texto promete o que o app faz hoje, e nada além: as permissões são as do
 * `apps/app/app.config.ts` (avisos, microfone, câmera e fotos; sem localização), o
 * endereço de avisos é `public.aparelhos_push`, e a guarda do registro de atividades é
 * a da retenção (`audit_log` e `pii_access_log`, 12 meses). Mudou o texto, muda
 * `APLICATIVO.versaoDaPolitica`.
 */

export const metadata: Metadata = {
  title: 'Política de privacidade do app Tríade',
  description: 'Como o app Tríade trata os dados de quem o usa.',
};

export default function PrivacidadeDoAplicativo() {
  const a = APLICATIVO;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <header className="border-b pb-6">
        <p className="text-sm font-medium text-muted-foreground">{a.desenvolvedora}</p>
        <h1 className="mt-1 font-heading text-2xl font-semibold sm:text-3xl">
          Política de privacidade do app {a.nome}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Versão de {a.versaoDaPolitica}</p>
      </header>

      <div className="mt-6 space-y-4 text-[15px] leading-7">
        <p>
          O {a.nome} é o sistema de atendimento usado pelas equipes da KOMUNE e da Imova
          Imobiliária. O app para iPhone e Android abre o mesmo sistema do navegador e acrescenta os
          avisos no celular. Ele é só para quem faz parte dessas equipes: não tem cadastro aberto, e
          só entra quem um administrador liberou.
        </p>
        <p>
          Esta página explica o que o app faz com os dados de quem o usa. Ela segue a Lei Geral de
          Proteção de Dados Pessoais (Lei 13.709/2018, a LGPD).
        </p>
      </div>

      <Secao id="quem-somos" titulo="1. Quem é responsável">
        <p>
          O app é feito pela {a.desenvolvedora}. A empresa de cada equipe, KOMUNE ou Imova, decide
          sobre os dados da equipe dela e dos clientes que ela atende (é a &ldquo;controladora&rdquo;,
          na linguagem da LGPD).
        </p>
        <p>
          Os dados dos clientes atendidos pelo {a.nome} seguem a política de privacidade de cada
          empresa:{' '}
          {a.politicasDasEmpresas.map((p, i) => (
            <span key={p.url}>
              {i > 0 && ' e '}
              <Link href={p.url}>{p.empresa}</Link>
            </span>
          ))}
          .
        </p>
        <p>
          Pedidos e dúvidas sobre privacidade vão para <Email endereco={a.email} />.
        </p>
      </Secao>

      <Secao id="dados" titulo="2. Quais dados o app trata">
        <Lista
          itens={[
            'o nome, o e-mail e a foto da conta Google usada para entrar;',
            'o registro do que cada pessoa faz no sistema, com data e hora: mensagens enviadas, ligações, mudanças de etapa, telefones revelados e exportações;',
            'o que a pessoa envia nas conversas: textos, áudios, fotos e documentos;',
            'o endereço de avisos do aparelho (fornecido pela Apple ou pelo Google), se é iPhone ou Android, e de qual empresa vêm os avisos.',
          ]}
        />
        <p>
          O app não lê a agenda de contatos do celular, não pede a localização do aparelho, não
          mostra publicidade e não usa ferramentas de rastreamento ou de análise de uso.
        </p>
      </Secao>

      <Secao id="permissoes" titulo="3. Permissões do aparelho">
        <Lista
          itens={[
            <>
              <strong>Notificações</strong>: para avisar de mensagem nova, conversa transferida,
              compromisso, lembrete e ligação. Dá para desligar nos Ajustes do celular.
            </>,
            <>
              <strong>Microfone</strong>: só enquanto a pessoa grava um áudio ou está numa ligação.
              O app não grava as ligações.
            </>,
            <>
              <strong>Câmera e fotos</strong>: só quando a pessoa escolhe anexar uma foto numa
              conversa.
            </>,
          ]}
        />
      </Secao>

      <Secao id="finalidades" titulo="4. Para que usamos">
        <p>Só para o sistema funcionar:</p>
        <Lista
          itens={[
            'deixar entrar quem a empresa liberou e mostrar a cada pessoa o que o papel dela permite;',
            'entregar os avisos no celular certo;',
            'mostrar à gestão o que cada pessoa fez no dia, nos relatórios do sistema;',
            'proteger os dados dos clientes, registrando quem revelou um telefone ou exportou uma lista.',
          ]}
        />
        <p>
          A base legal é a execução do contrato de trabalho ou de prestação de serviço com a empresa
          da equipe e o legítimo interesse dela em organizar o atendimento (LGPD, art. 7º, V e IX).
          Não vendemos nem alugamos dados pessoais.
        </p>
      </Secao>

      <Secao id="compartilhamento" titulo="5. Com quem compartilhamos">
        <p>Só com os serviços que fazem o sistema funcionar, e só para isso:</p>
        <Lista
          itens={[
            <>
              <strong>Supabase</strong>: banco de dados e arquivos, em servidores em São Paulo.
            </>,
            <>
              <strong>Vercel</strong>: hospedagem das telas do sistema.
            </>,
            <>
              <strong>Google</strong>: login da equipe.
            </>,
            <>
              <strong>Expo, Apple e Google</strong>: entrega dos avisos no celular.
            </>,
            <>
              <strong>Meta (WhatsApp Business) e Twilio</strong>: mensagens e ligações com os
              clientes.
            </>,
            <>
              <strong>Fly.io</strong>: o serviço que envia e organiza as mensagens do WhatsApp, em
              São Paulo.
            </>,
            <>
              <strong>Anthropic</strong>: leitura das conversas por IA, quando a empresa liga esse
              recurso, sem telefone nem e-mail.
            </>,
          ]}
        />
        <p>
          Podemos informar dados a autoridades quando a lei ou uma ordem judicial obrigar. Parte
          desses serviços pode tratar dados fora do Brasil, principalmente nos Estados Unidos, nos
          casos do art. 33 da LGPD.
        </p>
      </Secao>

      <Secao id="guarda" titulo="6. Por quanto tempo guardamos">
        <Lista
          itens={[
            'A conta fica enquanto a pessoa fizer parte da equipe.',
            'O registro de atividades e o de telefones revelados e exportações ficam 12 meses.',
            'O endereço de avisos é apagado quando a pessoa sai da conta no app, ou quando a Apple ou o Google avisam que ele deixou de valer (por exemplo, depois de apagar o app).',
            'As conversas seguem a política da empresa da equipe (item 1).',
          ]}
        />
      </Secao>

      <Secao id="direitos" titulo="7. Seus direitos e a exclusão dos dados">
        <p>
          Pela LGPD (art. 18), você pode pedir a confirmação e o acesso aos seus dados, a correção, a
          anonimização ou a eliminação do que for desnecessário, a portabilidade e a informação de
          com quem compartilhamos.
        </p>
        <p>
          A conta é criada pela empresa, não pelo app. Para encerrar o acesso ou pedir a exclusão dos
          seus dados, fale com o administrador da sua equipe ou escreva para{' '}
          <Email endereco={a.email} /> com o assunto &ldquo;Excluir meus dados&rdquo;. Respondemos em
          até 15 dias. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD),
          em <Link href="https://www.gov.br/anpd">gov.br/anpd</Link>.
        </p>
      </Secao>

      <Secao id="seguranca" titulo="8. Segurança">
        <p>
          Só a equipe liberada por um administrador entra, com login do Google, e cada pessoa vê o
          que o seu papel permite. A conexão é criptografada, e o app só abre os endereços do próprio
          sistema.
        </p>
      </Secao>

      <Secao id="mudancas" titulo="9. Mudanças nesta política">
        <p>Quando esta política mudar, a data da versão, no topo da página, muda junto.</p>
      </Secao>
    </main>
  );
}
