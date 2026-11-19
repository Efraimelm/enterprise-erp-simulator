// Parâmetros gerais iniciais. Não sobrescreve valores já alterados pelo administrador.

export async function seed(knex) {
  await knex('system_settings')
    .insert([
      { setting_key: 'default_language', value: 'pt-BR', description: 'Idioma usado quando o usuário não define outro' },
      { setting_key: 'default_timezone', value: 'America/Sao_Paulo', description: 'Fuso horário de exibição das datas' },
      { setting_key: 'default_currency', value: 'BRL', description: 'Moeda padrão de novos documentos' },
      { setting_key: 'date_format', value: 'dd/MM/yyyy', description: 'Formato de exibição das datas' },
      { setting_key: 'number_locale', value: 'pt-BR', description: 'Separador decimal e de milhar' },
      { setting_key: 'po_approval_limit', value: '1000.00', description: 'Pedidos de compra com total bruto até este valor são aprovados automaticamente' },
      { setting_key: 'so_approval_limit', value: '5000.00', description: 'Pedidos de venda com total bruto até este valor são confirmados sem aprovação' },
      { setting_key: 'sd_default_tax_code', value: 'I2', description: 'Código de imposto (simulado) sugerido nos itens de venda' },
    ])
    .onConflict('setting_key')
    .ignore();
}
