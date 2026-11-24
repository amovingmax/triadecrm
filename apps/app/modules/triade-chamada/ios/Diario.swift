import Foundation

/// O diário do app nas ligações (24/11/2026).
///
/// No primeiro teste de verdade a Meta atendeu e o cliente não ouviu nada, e com o app
/// fechado pelo usuário o iPhone não tocou. Sem um Mac com o iPhone no cabo, não há
/// como ver o que aconteceu dentro do app. Então ele anota cada passo (o app abriu pelo
/// aviso? a tela de chamada apareceu? o iPhone ligou o áudio? a conexão subiu? quantos
/// bytes foram e vieram?) e manda ao servidor com o convite da ligação seguinte
/// (`wa-chamada-app`, ação `diario`; tabela `app.voip_diarios`).
///
/// Fica no aparelho (`UserDefaults`), para sobreviver ao app fechado: o que aconteceu
/// numa abertura pelo aviso chega no envio seguinte. Só passos, estados e números: nada
/// de telefone nem de conversa.
enum Diario {
  private static let chave = "triade.chamada.diario"
  private static let maximo = 150

  private static let formato: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "America/Fortaleza")
    f.dateFormat = "dd HH:mm:ss.SSS"
    return f
  }()

  static func anotar(_ texto: String) {
    let linha = String("\(formato.string(from: Date())) \(texto)".prefix(280))
    let fazer = {
      var linhas = UserDefaults.standard.stringArray(forKey: chave) ?? []
      linhas.append(linha)
      if linhas.count > maximo { linhas.removeFirst(linhas.count - maximo) }
      UserDefaults.standard.set(linhas, forKey: chave)
    }
    if Thread.isMainThread { fazer() } else { DispatchQueue.main.async(execute: fazer) }
  }

  /// Manda o que está guardado com o convite de uma ligação e apaga só o que chegou.
  static func enviar(funcao: URL, convite: String) {
    let fazer = {
      let pendentes = UserDefaults.standard.stringArray(forKey: chave) ?? []
      if pendentes.isEmpty { return }
      LigacaoNativa.pedirAoServidor(funcao: funcao, convite: convite, acao: "diario", linhas: pendentes) { resultado in
        guard case .success = resultado else { return }
        let entregues = Set(pendentes)
        var atuais = UserDefaults.standard.stringArray(forKey: chave) ?? []
        atuais.removeAll { entregues.contains($0) }
        UserDefaults.standard.set(atuais, forKey: chave)
      }
    }
    if Thread.isMainThread { fazer() } else { DispatchQueue.main.async(execute: fazer) }
  }
}
