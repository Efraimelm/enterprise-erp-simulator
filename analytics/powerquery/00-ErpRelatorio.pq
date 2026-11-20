// Função Power Query (M): lê um relatório do Enterprise ERP Simulator pela API própria.
// Crie antes dois PARÂMETROS no Power BI (Página Inicial → Transformar dados → Gerenciar parâmetros):
//   ErpBase  (Texto) = http://localhost:3001/api
//   ErpChave (Texto) = erp_xxxxxxxx_...   ← chave da role INTEGRATION_READONLY (somente leitura)
// Em "Configurações da fonte de dados", use autenticação ANÔNIMA: a chave vai no cabeçalho.
// Nome desta consulta: ErpRelatorio
(relatorio as text, optional parametros as nullable record) as table =>
let
    Consulta = Record.Combine({ [ all = "true" ], if parametros = null then [] else parametros }),
    Resposta = Json.Document(
        Web.Contents(
            ErpBase,
            [
                RelativePath = "reports/" & relatorio,
                Query = Consulta,
                Headers = [ Authorization = "Bearer " & ErpChave, Accept = "application/json" ],
                Timeout = #duration(0, 0, 1, 0)
            ]
        )
    ),
    Linhas = Resposta[data],
    Tabela = if List.IsEmpty(Linhas) then #table({}, {}) else Table.FromRecords(Linhas, null, MissingField.UseNull)
in
    Tabela
