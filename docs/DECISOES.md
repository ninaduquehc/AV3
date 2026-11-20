# Justificativas de Decisões Arquiteturais & Trade-offs - GreenCode API

## 1. Fastify vs. Express
* **Opção Escolhida**: Fastify
* **Justificativa**: O Fastify oferece suporte nativo a schemas JSON e TypeScript, além de performance significativamente superior em requisições/segundo. Sua integração transparente com a biblioteca Zod através de `fastify-type-provider-zod` permite compilar schemas de entrada e saída simultaneamente para a OpenAPI (Swagger).
* **Alternativa Rejeitada**: Express (devido à falta de tipagem nativa rigorosa em rotas e suporte ultrapassado para rotas assíncronas).

## 2. Monólito Modular vs. Microsserviços
* **Opção Escolhida**: Monólito Modular (Layered Architecture)
* **Justificativa**: Para o escopo do projeto de logística reversa e rastreabilidade, o monólito modular reduz complexidade operacional e latência de rede, permitindo gerenciar transações atômicas `ACID` no banco de dados durante atualizações de Lotes e Movimentações em massa via `prisma.$transaction`.
* **Alternativa Rejeitada**: Microsserviços (traria complexidade desnecessária de consistência eventual e gerência de infraestrutura).

## 3. Autenticação via JWT (Stateless) vs. Sessão
* **Opção Escolhida**: JWT (JSON Web Token)
* **Justificativa**: Permite escalabilidade horizontal do backend sem a necessidade de manter estados de sessão em memória ou servidor de cache (ex: Redis). Permite incluir os perfis do RBAC (`ADMIN`, `OPERADOR`) na assinatura criptográfica do payload.
* **Alternativa Rejeitada**: Sessões com Cookies (exigiria um repositório centralizado de sessões).

## 4. Bloqueio Otimista (OCC) vs. Lock Pessimista
* **Opção Escolhida**: Optimistic Concurrency Control (OCC) via coluna `version`
* **Justificativa**: O OCC é a solução ideal para cenários de alta leitura e concorrência moderada de escrita. Evita que conexões do banco fiquem presas (*deadlocks* ou retenção de conexões) aguardando locks de linha. Caso dois operadores tentem atualizar o mesmo equipamento simultaneamente, a query atômica `UPDATE ... WHERE id = x AND version = v` rejeita a requisição defasada com `409 Conflict`.
* **Alternativa Rejeitada**: Locks Pessimistas (`SELECT ... FOR UPDATE`), rejeitado pelo risco de degradação da latência e degradação da esteira de triagem.

## 5. Scope do Bloqueio Otimista (Somente Equipamentos)
* **Opção Escolhida**: `version` concentrado na entidade `Equipamento`
* **Justificativa**: É no equipamento que ocorrem as escritas concorrentes reais na esteira de reciclagem e triagem em lote. Aplicar colunas de versão em entidades estáticas ou de baixíssima frequência de alteração (como Organizações e Contratos) adicionaria complexidade desnecessária sem ganho prático.

## 6. Cálculos Financeiros no Serviço de Contratos
* **Opção Escolhida**: Armazenamento flexível das cláusulas financeiras (Valor base, Tarifas por Kg de resíduo, Multa de SLA) via tipo `Json` do PostgreSQL e método de estimativa de custo no `ContratoService`.


## 7. Biblioteca Estatística: simple-statistics vs. mathjs vs. Implementação Própria
* **Opção Escolhida**: simple-statistics
* **Justificativa**: As análises precisam apenas de média, mediana, desvio padrão e regressão linear simples (OLS). A biblioteca cobre exatamente isso, é pequena, traz tipos TypeScript e expõe funções puras, fáceis de testar. As chamadas ficam isoladas em `utils/estatistica.ts`, com salvaguardas (mínimo de amostras, tendência negativa) e testes com resultado conhecido.
* **Alternativa Rejeitada**: mathjs (recursos de matrizes e expressões muito além da necessidade) e OLS manual (reimplementaria fórmulas já validadas, aumentando o risco sem ganho).

## 8. Persistência dos Resultados Analíticos: Snapshot JSON + Tabela Normalizada de Previsões
* **Opção Escolhida**: `relatorios_analiticos` (cabeçalho + resultado em JSON) e `previsoes_vida_util` (parâmetros do modelo em colunas).
* **Justificativa**: O resultado difere por categoria e evolui; o JSON mantém cada snapshot imutável e autossuficiente, sem migração a cada métrica. Os parâmetros da previsão são normalizados porque precisam ser consultados como série temporal para comparar previsão e realização.
* **Alternativa Rejeitada**: Uma tabela relacional por métrica (migração a cada mudança de relatório) e recalcular sob demanda sem persistir (perderia o histórico).

## 9. Fila e Agendamento: BullMQ + Redis (Job Recorrente) vs. node-cron
* **Opção Escolhida**: BullMQ com Redis para os relatórios assíncronos e para o agendamento (job scheduler com identificador fixo).
* **Justificativa**: O enunciado permite integrar os cálculos como jobs recorrentes quando já há fila. O agendamento fica no Redis: reiniciar o servidor ou subir várias instâncias não duplica a execução, e o retry com backoff é o mesmo dos relatórios.
* **Alternativa Rejeitada**: node-cron (agendamento em memória do processo: dispararia uma vez por instância e se perderia a cada reinício).

## 10. Chaves de API: Prefixo + Hash SHA-256, Escopos e Isolamento por Organização
* **Opção Escolhida**: Chave `gc_<prefixo>_<segredo>`, com segredo aleatório de 128 bits exibido uma única vez e apenas o hash SHA-256 armazenado.
* **Justificativa**: Com segredo de alta entropia, um hash rápido é suficiente e não pesa em cada requisição. O prefixo único permite localizar a chave sem varrer a tabela, e a comparação usa tempo constante. Cada chave pertence a uma organização, e todas as consultas filtram por ela.
* **Alternativa Rejeitada**: bcrypt para chaves (pensado para senhas de baixa entropia, tornaria cada requisição lenta) e JWT de longa duração como chave (revogação difícil).

## 11. Separação /api/v1/public e /api/v1/internal com Dois Swaggers
* **Opção Escolhida**: Dois contextos encapsulados do Fastify, cada um com seu Swagger (`/docs/internal` e `/docs/public`) e sua política de segurança.
* **Justificativa**: Permite políticas distintas (JWT e RBAC de um lado, chave de API, escopos e limite por chave do outro) e versionar o contrato público sem afetar o front-end.
* **Alternativa Rejeitada**: Um único Swagger com tags (expõe rotas administrativas aos parceiros).

## 12. Arquivo do Relatório no Banco (Coluna de Texto) vs. Disco
* **Opção Escolhida**: O conteúdo do relatório fica na coluna `resultado` de `relatorio_jobs`.
* **Justificativa**: Fica atômico com o status, não depende de caminhos de arquivo (portável entre Windows e Linux) e não exige volume compartilhado entre API e workers. Em escala, migra para object storage.
* **Alternativa Rejeitada**: Gravar em disco (caminhos dependentes de plataforma e volume compartilhado entre instâncias).