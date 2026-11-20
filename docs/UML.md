
# Diagrama de Classes e Arquitetura - GreenCode API

## 1. Diagrama de Classes

```mermaid
classDiagram
    class Usuario {
        +UUID id
        +String nome
        +String email
        +String senha
        +Role role
    }

    class Organizacao {
        +UUID id
        +String nome
        +String cnpj
        +TipoOrganizacao tipo
    }

    class Contrato {
        +UUID id
        +String numeroContrato
        +Json clausulas
        +DateTime vigenciaInicio
        +DateTime vigenciaFim
    }

    class Lote {
        +UUID id
        +String codigo
        +StatusLote status
        +DateTime dataRecebimento
    }

    class Equipamento {
        +UUID id
        +String codigoBarrasInterno
        +String tipo
        +String marca
        +String modelo
        +CondicaoFisica condicaoFisica
        +Int anoFabricacao
        +DateTime dataAvaliacao
        +Decimal valorRecuperacao
        +StatusEquipamento status
        +Int version
    }

    class Movimentacao {
        +UUID id
        +DateTime dataHora
        +StatusEquipamento statusAnterior
        +StatusEquipamento statusNovo
        +String observacao
    }

    class ApiKey {
        +UUID id
        +String nome
        +String prefixo
        +String hash
        +List~ApiScope~ scopes
        +Int limitePorMinuto
        +Boolean ativa
        +DateTime revogadaEm
    }

    class RelatorioJob {
        +UUID id
        +CategoriaAnalise categoria
        +FormatoRelatorio formato
        +StatusRelatorioJob status
        +Int tentativas
        +String erro
        +String resultado
    }

    class RelatorioAnalitico {
        +UUID id
        +CategoriaAnalise categoria
        +OrigemAnalise origem
        +Json resultado
        +DateTime geradoEm
    }

    class PrevisaoVidaUtil {
        +UUID id
        +String tipoEquipamento
        +Int amostras
        +Float inclinacao
        +Float intercepto
        +Float r2
        +Float vidaUtilEstimadaAnos
        +Float idadeInservivelObservadaAnos
    }

    Organizacao "1" -- "0..1" Contrato : possui
    Organizacao "1" -- "0..*" Lote : recebe
    Organizacao "1" -- "0..*" ApiKey : possui
    Lote "1" -- "1..*" Equipamento : contem
    Equipamento "1" -- "0..*" Movimentacao : rastreado
    Usuario "1" -- "0..*" Movimentacao : registra
    ApiKey "1" -- "0..*" RelatorioJob : solicita
    RelatorioAnalitico "1" -- "0..*" PrevisaoVidaUtil : gera
```

## 2. Fluxo da Máquina de Estados Finita (FSM) dos Equipamentos

```mermaid
flowchart TD
    A[RECEBIDO] --> B[EM_TRIAGEM]
    B --> C[EM_DESMONTAGEM]
    B --> D[PRONTO_REUSO]
    C --> E[TESTE_COMPONENTES]
    E --> D
    E --> F[PRONTO_DESCARTE]
    D --> G[REUSO]
    F --> H[DESCARTE]
```

## 3. Regras da Máquina de Estados

- Os equipamentos devem seguir as transições de status permitidas pela máquina de estados.
- Transições inválidas devem ser rejeitadas pela API.
- O status do equipamento deve refletir seu estágio no processo de logística reversa.
- O histórico de movimentações registra as alterações de status para permitir a rastreabilidade.

