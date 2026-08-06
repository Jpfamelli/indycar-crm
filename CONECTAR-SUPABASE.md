# Ligar o CRM ao banco na nuvem (Supabase)

> **Não precisa de `setx` nem de mexer no Registro do Windows.**
> Se você tentou `setx` e recebeu *"acesso ao caminho do Registro negado"*,
> ignore aquele caminho — use o arquivo `.env` abaixo.

O CRM funciona dos dois jeitos e escolhe sozinho:

| Sem a chave preenchida | Com a chave preenchida |
|---|---|
| SQLite local (`crm.db`) — isolado | **Supabase** — compartilhado com a Agenda |

Ao iniciar, ele imprime qual banco está usando. Não tem como confundir.

---

## Passo 1 — pegar a chave

1. Abra: https://supabase.com/dashboard/project/nppfqhavqahapmugnyng/settings/api-keys
2. Na linha **`service_role`**, clique em **Reveal**
3. Copie o valor

> ⚠️ A `service_role` **ignora todas as travas de segurança** do banco.
> Ela fica só neste computador. Nunca coloque num site, num app de celular,
> nem mande por WhatsApp.

## Passo 2 — colar no arquivo `.env`

Na pasta `indycar-crm` já existe um arquivo chamado **`.env`**.
Abra ele no Bloco de Notas e cole a chave depois do `=`:

```
SUPABASE_URL=https://nppfqhavqahapmugnyng.supabase.co
SUPABASE_SERVICE_ROLE_KEY=cole-a-chave-aqui
ANTHROPIC_API_KEY=
```

Salve e feche.

> Se o arquivo não aparecer no Explorador, ative
> **Exibir → Mostrar → Extensões de nome de arquivo** e
> **Itens ocultos** (nomes que começam com ponto ficam escondidos).
> Alternativa: abra o Bloco de Notas e use *Abrir* apontando para a pasta,
> mudando o filtro para *Todos os arquivos*.

## Passo 3 — rodar

```bash
node server.js
```

Deve aparecer:

```
📄 Configuração lida de .env

🏁 IndyCar CRM rodando em http://localhost:3100
   🗄️  Banco: SUPABASE (compartilhado com a Agenda)
```

Se aparecer *"Falta a chave"*, é porque a linha `SUPABASE_SERVICE_ROLE_KEY=`
ficou vazia ou com espaço sobrando.

---

## Voltar para o banco local

Para rodar offline ou testar sem mexer na nuvem, acrescente no `.env`:

```
CRM_DB=sqlite
```

## O que muda estando no Supabase

- Um lead cadastrado no CRM **já vira cliente** para a Agenda usar
- Quando a Agenda conclui um serviço, **o lead fecha sozinho** com o valor real cobrado
- O mesmo cliente é reconhecido pelo telefone, mesmo escrito de formas diferentes
  (`(12) 99999-8888`, `+55 12 99999-8888` e `5512999998888` são a mesma pessoa)

## Resumo semanal com IA

Preencha também no `.env`, quando quiser usar:

```
ANTHROPIC_API_KEY=sua-chave-da-claude
```

Pegue em: https://console.anthropic.com/settings/keys

---

## Por que o `.env` é melhor que o `setx`

| | `setx` | `.env` |
|---|---|---|
| Precisa de permissão no Registro | sim (deu erro no seu PC) | não |
| Precisa reabrir o terminal | sim | não |
| A chave fica visível para outros programas | sim (variável global) | não (só o CRM lê) |
| Fácil de trocar/remover | difícil | é só editar o arquivo |

O `.env` está no `.gitignore`, então nunca vai parar no GitHub por acidente.
