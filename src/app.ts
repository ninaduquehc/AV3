import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import {
  createJsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

import { prisma } from "./lib/prisma.js";
import { authRoutes } from "./routes/auth.routes.js";
import { usuarioRoutes } from "./routes/usuario.routes.js";
import { apiKeyRoutes } from "./routes/apikey.routes.js";
import { appRoutes } from "./routes/index.js";
import { publicRoutes } from "./routes/public.routes.js";
import { publicRelatoriosRoutes } from "./routes/public-relatorios.routes.js";
import { fecharFila } from "./queue/relatorio.queue.js";
import { tratadorDeErros } from "./utils/http.js";

const INTERNAL = "/api/v1/internal";
const PUBLIC = "/api/v1/public";

export async function buildApp() {
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "test") {
    throw new Error("FATAL: A variável de ambiente JWT_SECRET é obrigatória em ambiente de produção/dev.");
  }

  const jwtSecret = process.env.JWT_SECRET || "default_jwt_secret_for_tests_only";
  const urlServidor = `http://localhost:${process.env.PORT || 3000}`;

  const app = Fastify({ logger: process.env.NODE_ENV !== "test" }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(tratadorDeErros);
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: "Rota não encontrada." }));

  app.addHook("onClose", async () => {
    await fecharFila();
    await prisma.$disconnect();
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ? (process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN.split(",")) : true,
  });
  await app.register(jwt, { secret: jwtSecret });

  app.get("/docs", (_req, reply) => reply.redirect("/docs/internal"));

  // ---------------------------------------------------------------------------
  // Contexto INTERNO: front-end e equipe de gestão (JWT + RBAC).
  // O Swagger é registrado dentro do contexto e só documenta as rotas dele.
  // ---------------------------------------------------------------------------
  await app.register(async (interno) => {
    await interno.register(swagger, {
      openapi: {
        info: {
          title: "GreenCode API - Interna",
          description:
            "API RESTful interna para gestão de logística reversa, rastreabilidade de e-lixo e análises. " +
            "Uso restrito ao front-end e à equipe de gestão (autenticação JWT).",
          version: "1.0.0",
        },
        servers: [{ url: urlServidor, description: "Servidor Local de Desenvolvimento" }],
        tags: [
          { name: "Autenticação", description: "Endpoints para emissão e validação de tokens JWT" },
          { name: "Usuários", description: "Gestão de usuários do sistema" },
          { name: "API Keys", description: "Geração e revogação de chaves de API para parceiros externos" },
          { name: "Organizações", description: "Cadastro de empresas parceiras, geradoras e desmontadoras" },
          { name: "Contratos", description: "Acordos e metas vinculados às organizações" },
          { name: "Lotes", description: "Lotes de recolhimento de resíduos eletrônicos" },
          { name: "Equipamentos", description: "Itens individuais triados e acompanhados no fluxo" },
          { name: "Movimentações", description: "Rastreabilidade e histórico de alterações com bloqueio otimista" },
          { name: "Analytics", description: "Métricas agregadas e relatórios preditivos: eficiência operacional, rentabilidade e vida útil" },
          { name: "Health", description: "Verificação da saúde e funcionamento da API" },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description: "Informe o token JWT retornado no login",
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      transform: createJsonSchemaTransform({ skipList: [] }),
    });

    await interno.register(swaggerUi, {
      routePrefix: "/docs/internal",
      uiConfig: { docExpansion: "list", deepLinking: true, persistAuthorization: true },
    });

    // Limite global por IP (desativado em teste, como antes). Só vale para as rotas internas.
    if (process.env.NODE_ENV !== "test") {
      await interno.register(rateLimit, { max: 100, timeWindow: "1 minute" });
    }

    interno.get("/health", {
      schema: {
        tags: ["Health"],
        summary: "Verificar integridade da aplicação",
        security: [],
        response: {
          200: z.object({ status: z.string(), timestamp: z.string() }),
        },
      },
    }, async () => {
      return { status: "ok", timestamp: new Date().toISOString() };
    });

    await interno.register(authRoutes, { prefix: INTERNAL });
    await interno.register(usuarioRoutes, { prefix: INTERNAL });
    await interno.register(apiKeyRoutes, { prefix: INTERNAL });
    await interno.register(appRoutes, { prefix: INTERNAL });
  });

  // ---------------------------------------------------------------------------
  // Contexto PÚBLICO: parceiros externos (chave de API, escopos, limite por chave).
  // ---------------------------------------------------------------------------
  await app.register(async (publico) => {
    await publico.register(swagger, {
      openapi: {
        info: {
          title: "GreenCode API - Pública v1",
          description:
            "API pública para integração de parceiros ao ecossistema de logística reversa do GreenCode.\n\n" +
            "**Autenticação:** envie a chave de API no cabeçalho `x-api-key` em todas as requisições. " +
            "Clique em **Authorize** para testar os endpoints direto no navegador.\n\n" +
            "**Permissões (escopos):** cada chave tem escopos próprios (`RASTREABILIDADE_READ`, `LOTES_READ`, " +
            "`LOTES_WRITE`, `RELATORIOS_READ`). Sem o escopo exigido pela rota, a resposta é `403`.\n\n" +
            "**Isolamento:** cada chave acessa apenas os dados da organização à qual pertence.\n\n" +
            "**Limite de requisições:** definido por chave (padrão de 60 por minuto). Ao exceder, a resposta é `429`.\n\n" +
            "**Versionamento:** a versão fica na URL (`/api/v1/public`). Mudanças que quebrem o contrato só " +
            "entram em uma nova versão, e as versões antigas são descontinuadas gradualmente.\n\n" +
            "**Formato de erro:** `{ \"error\": \"mensagem\" }`; erros de validação trazem também `detalhes`.",
          version: "1.0.0",
        },
        servers: [{ url: urlServidor, description: "Servidor Local de Desenvolvimento" }],
        tags: [
          { name: "Rastreabilidade", description: "Consulta do histórico de movimentações de equipamentos" },
          { name: "Lotes", description: "Consulta e submissão de lotes com inventário" },
          { name: "Relatórios", description: "Geração assíncrona de relatórios analíticos (fila): solicitar, acompanhar e baixar" },
        ],
        components: {
          securitySchemes: {
            apiKeyAuth: {
              type: "apiKey",
              in: "header",
              name: "x-api-key",
              description: "Chave de API fornecida pelo GreenCode (formato gc_xxxxxxxx_...)",
            },
          },
        },
        security: [{ apiKeyAuth: [] }],
      },
      transform: createJsonSchemaTransform({ skipList: [] }),
    });

    await publico.register(swaggerUi, {
      routePrefix: "/docs/public",
      uiConfig: { docExpansion: "list", deepLinking: true, persistAuthorization: true },
    });

    // Limite por CHAVE (sempre ativo, inclusive em teste). A autenticação roda em onRequest,
    // então req.apiKey já existe quando este hook (preValidation) é executado.
    await publico.register(rateLimit, {
      max: (req) => req.apiKey?.limitePorMinuto ?? 60,
      timeWindow: "1 minute",
      keyGenerator: (req) => req.apiKey?.id ?? req.ip,
      hook: "preValidation",
    });

    await publico.register(publicRoutes, { prefix: PUBLIC });
    await publico.register(publicRelatoriosRoutes, { prefix: PUBLIC });
  });

  return app;
}