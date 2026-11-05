-- CreateEnum
CREATE TYPE "CondicaoFisica" AS ENUM ('NAO_AVALIADO', 'BOM', 'REGULAR', 'RUIM', 'INSERVIVEL');

-- AlterTable
ALTER TABLE "equipamentos" ADD COLUMN     "anoFabricacao" INTEGER,
ADD COLUMN     "condicaoFisica" "CondicaoFisica" NOT NULL DEFAULT 'NAO_AVALIADO',
ADD COLUMN     "dataAvaliacao" TIMESTAMP(3),
ADD COLUMN     "marca" TEXT,
ADD COLUMN     "modelo" TEXT;
