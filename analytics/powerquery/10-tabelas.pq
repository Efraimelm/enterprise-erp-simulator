// Uma consulta por tabela do modelo. Crie cada bloco como uma "Consulta nula" com o nome indicado.
// Todas usam a função ErpRelatorio (arquivo 00-ErpRelatorio.pq) e tipam as colunas.

// ───── Consulta: Estoque ─────
let
    Fonte = ErpRelatorio("stock-position"),
    Tipos = Table.TransformColumnTypes(Fonte, {
        {"material", type text}, {"descricao", type text}, {"categoria", type text}, {"centro", type text}, {"deposito", type text}, {"unidade", type text},
        {"fisico", type number}, {"reservado", type number}, {"disponivel", type number}, {"preco_referencia", Currency.Type}, {"valor", Currency.Type},
        {"ponto_reposicao", type number}, {"abaixo_do_ponto", type logical}
    })
in
    Tipos

// ───── Consulta: Giro (últimos 90 dias; mude as datas se quiser) ─────
let
    Hoje = Date.ToText(Date.From(DateTime.LocalNow()), "yyyy-MM-dd"),
    Inicio = Date.ToText(Date.AddDays(Date.From(DateTime.LocalNow()), -89), "yyyy-MM-dd"),
    Fonte = ErpRelatorio("stock-turnover", [ from = Inicio, to = Hoje ]),
    Tipos = Table.TransformColumnTypes(Fonte, {
        {"material", type text}, {"descricao", type text}, {"centro", type text}, {"estoque_inicial", type number}, {"entradas", type number},
        {"saidas", type number}, {"estoque_final", type number}, {"estoque_medio", type number}, {"giro", type number}, {"cobertura_dias", type number}
    })
in
    Tipos

// ───── Consulta: Compras (últimos 365 dias) ─────
let
    Hoje = Date.ToText(Date.From(DateTime.LocalNow()), "yyyy-MM-dd"),
    Inicio = Date.ToText(Date.AddDays(Date.From(DateTime.LocalNow()), -365), "yyyy-MM-dd"),
    Fonte = ErpRelatorio("purchases-by-supplier", [ from = Inicio, to = Hoje ]),
    Tipos = Table.TransformColumnTypes(Fonte, {
        {"fornecedor", type text}, {"pedidos", Int64.Type}, {"valor_bruto", Currency.Type}, {"valor_recebido", Currency.Type},
        {"percentual_recebido", type number}, {"pedidos_recebidos", Int64.Type}, {"no_prazo", Int64.Type}, {"pontualidade", type number}
    })
in
    Tipos

// ───── Consulta: ComprasPendentes ─────
let
    Fonte = ErpRelatorio("open-purchase-orders"),
    Tipos = Table.TransformColumnTypes(Fonte, {
        {"pedido", type text}, {"fornecedor", type text}, {"centro", type text}, {"status", type text}, {"entrega_prevista", type date},
        {"valor_pendente", Currency.Type}, {"dias_de_atraso", Int64.Type}, {"atrasado", type logical}
    })
in
    Tipos

// ───── Consulta: Vendas (por dia, últimos 365 dias) ─────
let
    Hoje = Date.ToText(Date.From(DateTime.LocalNow()), "yyyy-MM-dd"),
    Inicio = Date.ToText(Date.AddDays(Date.From(DateTime.LocalNow()), -365), "yyyy-MM-dd"),
    Fonte = ErpRelatorio("sales-by-period", [ from = Inicio, to = Hoje, group = "day" ]),
    Tipos = Table.TransformColumnTypes(Fonte, {
        {"periodo", type date}, {"categoria", type text}, {"faturas", Int64.Type}, {"quantidade", type number},
        {"liquido", Currency.Type}, {"imposto", Currency.Type}, {"bruto", Currency.Type}
    })
in
    Tipos

// ───── Consulta: VendasEmAberto ─────
let
    Fonte = ErpRelatorio("open-sales-orders"),
    Tipos = Table.TransformColumnTypes(Fonte, {
        {"pedido", type text}, {"cliente", type text}, {"centro", type text}, {"status", type text}, {"data_desejada", type date},
        {"quantidade_pendente", type number}, {"valor_pendente", Currency.Type}, {"entregas_sem_saida", Int64.Type}, {"dias_de_atraso", Int64.Type}
    })
in
    Tipos

// ───── Consulta: ContasAReceber ─────
let
    Fonte = ErpRelatorio("receivables-aging"),
    Tipos = Table.TransformColumnTypes(Fonte, {
        {"cliente", type text}, {"titulos", Int64.Type}, {"a_vencer", Currency.Type}, {"d1_30", Currency.Type}, {"d31_60", Currency.Type},
        {"d61_90", Currency.Type}, {"acima_90", Currency.Type}, {"total", Currency.Type}
    })
in
    Tipos

// ───── Consulta: Calendario (para a página de vendas) ─────
let
    Inicio = Date.AddDays(Date.From(DateTime.LocalNow()), -365),
    Dias = List.Dates(Inicio, 366, #duration(1, 0, 0, 0)),
    Tabela = Table.FromList(Dias, Splitter.SplitByNothing(), {"Data"}, null, ExtraValues.Error),
    Tipo = Table.TransformColumnTypes(Tabela, {{"Data", type date}}),
    Ano = Table.AddColumn(Tipo, "Ano", each Date.Year([Data]), Int64.Type),
    Mes = Table.AddColumn(Ano, "Mês", each Date.ToText([Data], "yyyy-MM"), type text)
in
    Mes
