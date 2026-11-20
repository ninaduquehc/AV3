-- CreateEnum
CREATE TYPE "ApiScope" AS ENUM ('RASTREABILIDADE_READ', 'LOTES_READ', 'LOTES_WRITE', 'RELATORIOS_READ');

-- CreateEnum
CREATE TYPE "CategoriaAnalise" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL');

-- CreateEnum
CREATE TYPE "OrigemAnalise" AS ENUM ('AGENDADO', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatusRelatorioJob" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHA');

-- CreateEnum
CREATE TYPE "FormatoRelatorio" AS ENUM ('CSV', 'JSON');

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" "ApiScope"[],
    "limitePorMinuto" INTEGER NOT NULL DEFAULT 60,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "organizacaoId" TEXT NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relatorios_analiticos" (
    "id" TEXT NOT NULL,
    "categoria" "CategoriaAnalise" NOT NULL,
    "origem" "OrigemAnalise" NOT NULL,
    "parametros" JSONB,
    "resultado" JSONB NOT NULL,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relatorios_analiticos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "previsoes_vida_util" (
    "id" TEXT NOT NULL,
    "relatorioId" TEXT NOT NULL,
    "tipoEquipamento" TEXT NOT NULL,
    "amostras" INTEGER NOT NULL,
    "inclinacao" DOUBLE PRECISION,
    "intercepto" DOUBLE PRECISION,
    "r2" DOUBLE PRECISION,
    "vidaUtilEstimadaAnos" DOUBLE PRECISION,
    "idadeInservivelObservadaAnos" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "previsoes_vida_util_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relatorio_jobs" (
    "id" TEXT NOT NULL,
    "categoria" "CategoriaAnalise" NOT NULL,
    "formato" "FormatoRelatorio" NOT NULL,
    "status" "StatusRelatorioJob" NOT NULL DEFAULT 'PENDENTE',
    "parametros" JSONB,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "resultado" TEXT,
    "apiKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relatorio_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefixo_key" ON "api_keys"("prefixo");

-- CreateIndex
CREATE INDEX "relatorios_analiticos_categoria_geradoEm_idx" ON "relatorios_analiticos"("categoria", "geradoEm");

-- CreateIndex
CREATE INDEX "previsoes_vida_util_tipoEquipamento_createdAt_idx" ON "previsoes_vida_util"("tipoEquipamento", "createdAt");

-- CreateIndex
CREATE INDEX "relatorio_jobs_apiKeyId_createdAt_idx" ON "relatorio_jobs"("apiKeyId", "createdAt");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previsoes_vida_util" ADD CONSTRAINT "previsoes_vida_util_relatorioId_fkey" FOREIGN KEY ("relatorioId") REFERENCES "relatorios_analiticos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relatorio_jobs" ADD CONSTRAINT "relatorio_jobs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
