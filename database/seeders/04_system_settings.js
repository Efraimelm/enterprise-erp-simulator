// Parâmetros gerais iniciais. Não sobrescreve valores já alterados pelo administrador.

export async function seed(knex) {
  await knex('system_settings')
    .insert([
      { setting_key: 'default_language', value: 'pt-BR', description: 'Idioma usado quando o usuário não define outro' },
      { setting_key: 'default_timezone', value: 'America/Sao_Paulo', description: 'Fuso horário de exibição das datas' },
      { setting_key: 'default_currency', value: 'BRL', description: 'Moeda padrão de novos documentos' },
      { setting_key: 'date_format', value: 'dd/MM/yyyy', description: 'Formato de exibição das datas' },
      { setting_key: 'number_locale', value: 'pt-BR', description: 'Separador decimal e de milhar' },
    ])
    .onConflict('setting_key')
    .ignore();
}
