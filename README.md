# GreenCode API - Logística Reversa de E-Lixo ♻️

API RESTful para gestão de logística reversa, rastreabilidade e reciclagem de resíduos eletrônicos, desenvolvida com foco em alta integridade de dados, controle de concorrência e arquitetura em camadas.

---

## 🚀 Tecnologias

- **Node.js** (v20+) e **TypeScript**
- **Fastify** (com `fastify-type-provider-zod`)
- **Prisma ORM** e **PostgreSQL 16**
- **Zod** (validação de schemas e OpenAPI)
- **Vitest** (testes de integração automatizados)
- **Swagger UI** (documentação interativa das rotas)
- **Docker Compose** (containerização do banco de dados)
- **BullMQ** e **Redis 7** (fila de relatórios assíncronos e agendamento das análises)
- **simple-statistics** (estatística e regressão linear das análises)

---

## 🎯 Principais Recursos e Regras de Negócio

- **Máquina de Estados Finita (FSM):** transições estritas e validadas para o ciclo de vida dos equipamentos, da recepção ao descarte ou reuso.
- **Controle de Concorrência Otimista (OCC):** prevenção de *race conditions* e edições simultâneas através do versionamento atômico (`version`).
- **Autenticação e RBAC:** controle de acesso baseado em perfis (`ADMIN`, `OPERADOR`, `CLIENTE`) via tokens JWT stateless.
- **Rastreabilidade e Auditoria:** histórico de movimentações por equipamento com proteção por chave estrangeira `Restrict`.
- **Cálculo Financeiro de Contratos:** estimativa de faturamento (valor base mensal + tarifa por kg + multa potencial) pela rota `GET /api/v1/internal/contratos/:id/faturamento?pesoTotalKg=100`, disponível para `ADMIN` e `OPERADOR`.
- **Resiliência:** tratamento centralizado de exceções, *rate limiting* contra ataques de força bruta e suporte a *Graceful Shutdown* (`SIGINT`/`SIGTERM`).
- **Camada Analítica:** eficiência operacional (tempo de triagem, gargalos, operadores e meses), rentabilidade por tipo, condição, marca e modelo, e previsão de vida útil por regressão linear, com histórico persistido. Endpoints em `/api/v1/internal/analytics`.
- **API Pública v1 (`/api/v1/public`):** autenticação por chave de API (`x-api-key`), permissões por escopo, isolamento por organização e limite de requisições por chave.
- **Relatórios Assíncronos:** o `POST` devolve um `jobId`; o worker (BullMQ + Redis) processa com retry e backoff exponencial; status por polling e download em CSV ou JSON.
- **Análises Agendadas:** recálculo diário automático das análises (job recorrente da fila).

---

## 📋 Pré-requisitos

- **Node.js** v20 ou superior
- **npm** v10 ou superior
- **Docker** e **Docker Compose**

---

## 📦 Como Rodar a Aplicação

### 1. Clone o repositório e configure as variáveis de ambiente

Clone o repositório e acesse a pasta do projeto:

```bash
git clone https://github.com/ninaduquehc/AV3.git
cd AV3
```

Copie o arquivo de exemplo das variáveis de ambiente.

**Linux / macOS (Bash):**

```bash
cp .env.example .env
```

**Windows (CMD):**

```cmd
copy .env.example .env
```

**Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
```

### 2. Inicie o PostgreSQL via Docker e instale as dependências

```bash
docker compose up -d
> O Docker sobe o PostgreSQL (porta 5435) e o Redis (porta 6380). O Redis é usado pela fila de relatórios.
> Em instalações antigas do Docker, o comando equivalente é `docker-compose up -d`.
npm install
```

### 3. Prepare o banco de dados

Execute as migrações e popule o banco com a massa de dados inicial (*seed*):

```bash
npm run migrate
npm run seed
```

### 4. Inicie o servidor em modo de desenvolvimento

```bash
npm run dev
```

---

## 📖 Documentação das Rotas (Swagger)

Com a aplicação em execução:

| Documentação | URL | Autenticação |
|---|---|---|
| **API interna** (front-end e equipe de gestão) | http://localhost:3000/docs/internal | Token JWT |
| **API pública v1** (parceiros) | http://localhost:3000/docs/public | Chave de API (`x-api-key`) |

`http://localhost:3000/docs` redireciona para a documentação interna.

---

## 🔐 Credenciais Padrão para Testes (Seed)

Após executar `npm run seed`, utilize as credenciais abaixo para autenticação na API ou no Swagger.

| Perfil | E-mail | Senha | Permissões |
|---|---|---|---|
| **ADMIN** | `admin@greencode.com` | `admin123` | Acesso total: usuários, contratos, lotes, equipamentos e organizações |
| **OPERADOR** | `operador@greencode.com` | `operador123` | Gestão operacional: lotes, equipamentos e movimentações |
| **OPERADOR** | `operador2@greencode.com` | `operador123` | Mesmo perfil, usado para comparar desempenho entre operadores |
| **OPERADOR** | `operador3@greencode.com` | `operador123` | Mesmo perfil, usado para comparar desempenho entre operadores |

### Chaves de API de demonstração (Seed)

Para testar a API pública em `/docs/public` (botão **Authorize**) ou via `curl`, use o cabeçalho `x-api-key`:

| Parceiro | Chave | Escopos | Limite |
|---|---|---|---|
| Tech Solutions | `gc_demo0001_3f9a1c5e7b2d4a6c8e0f1b3d5a7c9e2f` | Rastreabilidade, leitura e escrita de lotes, relatórios | 60/min |
| Verde Corp | `gc_demo0002_8b4d6f0a2c4e6a8c0e2a4c6e8a0c2e4f` | Somente rastreabilidade | 60/min |
| Banco Digital | `gc_demo0003_c1e3a5d7f9b1c3e5a7d9f1b3c5e7a9d1` | Somente leitura de lotes | 3/min |

> Essas chaves existem apenas no seed de desenvolvimento (o seed é bloqueado em produção). Em produção, as chaves são geradas por um ADMIN em `POST /api/v1/internal/api-keys`.

---

## ⏰ Análises Agendadas

O sistema recalcula as três análises (eficiência operacional, rentabilidade e vida útil) automaticamente, todo dia às 02:00 (fuso `America/Sao_Paulo`), como um job recorrente da fila (BullMQ). Cada execução grava um novo registro histórico em `relatorios_analiticos` com `origem = AGENDADO`, consultável em `GET /api/v1/internal/analytics/historico`.

| Variável | Padrão | Função |
|---|---|---|
| `ANALYTICS_CRON` | `0 2 * * *` | Horário da execução (cron de 5 campos) |
| `ANALYTICS_TZ` | `America/Sao_Paulo` | Fuso do agendamento |
| `ENABLE_SCHEDULER` | `true` | `false` desativa o registro do agendamento |
| `ENABLE_WORKER` | `true` | `false` impede os workers de subirem junto da API (rode `npm run worker`) |

Para ver funcionando sem esperar até as 02:00, ponha `ANALYTICS_CRON="* * * * *"` no `.env` (executa a cada minuto), rode `npm run dev` e consulte o histórico após um minuto.

---

## 🧪 Testes Automatizados

```bash
npm run seed
npm test
```

São testes de integração (Vitest + `app.inject`) que usam os dados do seed e o **Redis** (`docker compose up -d` sobe o banco e o Redis). Rode `npm run seed` antes, porque os testes criam registros e dependem dos dados do seed (rodar o seed de novo também devolve o banco ao estado limpo).

| Arquivo | O que cobre |
|---|---|
| `api.test.ts` | Autenticação (401), RBAC (403), validações Zod (400), FSM (422), regras de negócio, concorrência otimista (409), movimentação em massa, faturamento e campos de avaliação do equipamento |
| `analytics.test.ts` | Funções estatísticas puras (regressão, resumo, eficiência) e endpoints de analytics, com persistência e histórico |
| `public-api.test.ts` | Chaves de API (401/403), escopos, isolamento por organização, rate limit por chave (429), ciclo de vida da chave e Swagger público e interno |
| `relatorios.test.ts` | Relatório assíncrono completo (202, status, download), CSV, anonimização, retry e falha definitiva |
| `agendamento.test.ts` | Registro idempotente do job recorrente e execução do recálculo |

---

## 📚 Documentação Complementar

- 🔒 **Segurança:** políticas de *rate limiting*, *timing attacks* e proteções web em [`docs/SEGURANCA.md`](docs/SEGURANCA.md).
- 📐 **Arquitetura e FSM:** diagrama de classes UML e fluxo de estados dos equipamentos em [`docs/UML.md`](docs/UML.md).
- 💡 **Decisões Técnicas:** justificativas de tecnologia, *trade-offs* e escolhas de design em [`docs/DECISOES.md`](docs/DECISOES.md).
- 📝 **Relatório Técnico (AV3):** biblioteca estatística, modelagem das tabelas analíticas, política de retry e evolução da arquitetura em [`docs/RELATORIO_TECNICO.md`](docs/RELATORIO_TECNICO.md).

---

## ✅ Validação Final e Execução dos Testes

Execute os comandos abaixo para popular o banco com os dados iniciais e executar os testes automatizados:

```bash
npm run seed
npm test
```