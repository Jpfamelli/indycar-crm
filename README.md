# IndyCar CRM

Servidor Node puro e interface em `public/`. Produção: https://indycar-crm.onrender.com.

Execute `npm.cmd start` no Windows (ou `npm start`). O servidor exige Supabase Auth e perfil ativo para as rotas privadas. A configuração fica no ambiente; nunca publique `.env`.

Para testar sem clientes ou credenciais reais:

1. `npm.cmd test` executa funções puras e o servidor real com banco e autenticação simulados.
2. `npm.cmd run mock` abre a interface real em http://127.0.0.1:3101 com login fictício.
3. As alterações no mock ficam somente em memória e desaparecem quando o processo termina.

O mock não lê `.env`, não chama Supabase e não envia mensagens. Para conferir: pesquisar telefone com +55, ordenar/exportar leads, abrir ficha, salvar aniversário/preferência, movimentar etapa no funil e alternar tema; conferir desktop e 375 px.

Aniversário usa `clientes.nascimento`; 1904 representa ano desconhecido. A preferência usa `clientes.aceita_mensagens` e sua data de alteração. Nenhuma migração acompanha esta rodada.

O Render acompanha `main`. Após publicar, conferir a versão v3 de `/sw.js`, os módulos da interface e HTTP 401 de `/api/leads` e `/api/saude` sem autenticação.
