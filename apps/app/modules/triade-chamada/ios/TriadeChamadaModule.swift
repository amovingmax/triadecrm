import ExpoModulesCore

/// O lado JS da tela de chamada (`modules/triade-chamada/index.ts`). A ligação em si é
/// toda nativa (`CentralDeChamadas`, `LigacaoNativa`); o JS desenha a tela do app
/// durante a ligação e entrega o endereço de chamada ao site.
public class TriadeChamadaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TriadeChamada")

    Events("onTokenDeVoz", "onTocando", "onRecusar", "onFim", "onEstado")

    // O Expo chama estes dois fora da fila principal; a central só mexe nela.
    OnStartObserving {
      DispatchQueue.main.async {
        CentralDeChamadas.shared.comecarAEntregar { [weak self] nome, corpo in
          self?.sendEvent(nome, corpo)
        }
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        CentralDeChamadas.shared.pararDeEntregar()
      }
    }

    // Tudo que mexe nas chamadas roda na fila principal, onde o PushKit e o CallKit
    // também falam com a `CentralDeChamadas`: nada de duas filas no mesmo estado.

    // O registro já nasce na abertura do app; isto só garante.
    AsyncFunction("iniciar") {
      CentralDeChamadas.shared.iniciar()
    }
    .runOnQueue(.main)

    AsyncFunction("tokenDeVoz") { () -> String? in
      CentralDeChamadas.shared.tokenDeVoz
    }
    .runOnQueue(.main)

    // O app montado para teste usa o servidor de teste da Apple; o TestFlight, o de produção.
    Function("servidorDeTeste") { () -> Bool in
      #if DEBUG
        return true
      #else
        return false
      #endif
    }

    AsyncFunction("ligacaoAtual") { () -> [String: Any]? in
      CentralDeChamadas.shared.ligacaoAtual()?.mapValues { valor -> Any in valor ?? NSNull() }
    }
    .runOnQueue(.main)

    AsyncFunction("encerrar") { (chamada: String) in
      CentralDeChamadas.shared.encerrar(chamada)
    }
    .runOnQueue(.main)

    AsyncFunction("silenciar") { (chamada: String, mudo: Bool) in
      CentralDeChamadas.shared.silenciar(chamada, mudo)
    }
    .runOnQueue(.main)

    AsyncFunction("altoFalante") { (ligado: Bool) in
      CentralDeChamadas.shared.altoFalante(ligado)
    }
    .runOnQueue(.main)

    AsyncFunction("pedirMicrofone") { (promise: Promise) in
      CentralDeChamadas.shared.pedirMicrofone { ok in promise.resolve(ok) }
    }
    .runOnQueue(.main)
  }
}
