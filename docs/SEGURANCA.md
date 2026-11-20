
# Políticas e Arquitetura de Segurança - GreenCode API

## 1. Proteção contra Timing Attacks e Brute Force no Login

- **Constant Time Lookup:** utilização de um hash fixo de 60 caracteres (`HASH_FALSO`) no `bcrypt.compare` quando o e-mail informado não está cadastrado, reduzindo diferenças no tempo de resposta e dificultando a enumeração de usuários.
- **Rate Limiting Estrito no Login:** o endpoint `/api/v1/internal/auth/login` é limitado a, no máximo, 5 requisições por minuto por endereço IP em ambientes de desenvolvimento e produção.
- **Ambiente de Testes:** o rate limiting do login é desativado automaticamente quando `NODE_ENV=test`.
- **Rate Limiting Global (rotas internas):** limite de 100 requisições por minuto por endereço IP para as demais rotas de `/api/v1/internal`. A API pública tem limite próprio por chave (seção 5).

## 2. Bloqueio Otimista (Optimistic Concurrency Control - OCC)

A API utiliza controle otimista de concorrência para prevenir conflitos de escrita e condições de corrida (*race conditions*) durante atualizações concorrentes de equipamentos.

- A coluna `version` identifica a versão atual do registro.
- As atualizações verificam a versão esperada antes de modificar o registro.
- A operação utiliza consultas atômicas com `updateMany({ where: { id, version } })`.
- Quando uma atualização não pode ser realizada devido a um conflito de concorrência, a API retorna `409 Conflict`.

## 3. Máquina de Estados Finita (FSM) e Validação de Transições

Os equipamentos seguem um fluxo controlado de estados para garantir a rastreabilidade durante o processo de logística reversa.

- As transições de status devem respeitar as regras definidas pela máquina de estados.
- Tentativas de transições inválidas, como alterar diretamente de `RECEBIDO` para `DESCARTE`, são rejeitadas com `422 Unprocessable Entity`.
- Lotes com status `CANCELADO` bloqueiam novas movimentações dos equipamentos vinculados.

## 4. Segurança de Cabeçalhos HTTP

A aplicação utiliza a biblioteca `@fastify/helmet` para configurar cabeçalhos HTTP de segurança e ajudar a mitigar vulnerabilidades web comuns, incluindo:

- **XSS:** Cross-Site Scripting.
- **Clickjacking:** tentativas de inserir a aplicação em páginas maliciosas.
- **MIME Sniffing:** interpretação indevida do tipo de conteúdo pelo navegador.

## 5. API Pública (`/api/v1/public`)

- **Chave de API:** formato `gc_<prefixo de 8 caracteres>_<segredo de 32 hex>`, com segredo de 128 bits gerado por `crypto.randomBytes`. Apenas o hash SHA-256 é armazenado, e a chave completa é exibida uma única vez, na criação.
- **Validação:** a comparação do hash usa `timingSafeEqual`. Chave inexistente, incorreta, revogada ou inativa recebe a mesma mensagem de erro (401).
- **Revogação:** `ativa = false` com `revogadaEm`, com efeito imediato, pois cada requisição consulta o banco.
- **Escopos:** `RASTREABILIDADE_READ`, `LOTES_READ`, `LOTES_WRITE` e `RELATORIOS_READ`. A falta do escopo exigido resulta em 403, informando qual escopo era necessário.
- **Isolamento por organização:** o `organizacaoId` vem da chave, nunca do cliente. Lotes, equipamentos e relatórios de outra organização respondem 404, para não revelar a existência do recurso.
- **Rate limit por chave:** `limitePorMinuto` de cada chave, com resposta 429. Contam as requisições autenticadas e autorizadas; as rejeitadas com 401 ou 403 não chegam ao limitador (limitação registrada em `docs/RELATORIO_TECNICO.md`).
- **Privacidade:** a API pública usa schemas próprios, sem IDs internos nem dados de usuários, e os relatórios de eficiência anonimizam os operadores ("Operador 1", "Operador 2", ...).
- **CSV seguro:** textos iniciados por `=`, `+`, `-`, `@`, tabulação ou retorno de carro são neutralizados contra injeção de fórmula em planilhas.
- **Erros:** o parceiro recebe apenas mensagens de negócio ou uma mensagem genérica; o detalhe do erro fica no log do servidor.
- **Chaves de demonstração:** existem apenas no seed (bloqueado em produção) e estão publicadas no README. Nunca devem ser usadas fora de desenvolvimento.

## 6. Considerações Finais

As medidas descritas devem corresponder às configurações efetivamente implementadas na aplicação. Alterações nos mecanismos de autenticação, controle de concorrência, transições de status ou cabeçalhos de segurança devem ser acompanhadas de testes automatizados.

