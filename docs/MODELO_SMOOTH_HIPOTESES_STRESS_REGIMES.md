# Modelo smooth (CAP15 / freeze V5): hipóteses, stress temporal e regimes

Este documento fixa **hipóteses de trabalho**, distingue **stress com janelas móveis** de **verdadeiro fora‑da‑amostra (OOS)**, e define **cenários de regime** (2008, 2022, juros altos) reproduzíveis no repositório.

**Fonte de dados analisada:** export em `freeze/DECIDE_MODEL_V5_V2_3_SMOOTH/model_outputs/` (curvas `model_equity_final_20y_*.csv` e `benchmark_equity_final_20y.csv`), alinhadas às datas comuns. Os números de regime e de janelas móveis abaixo foram gerados com `backend/scripts/smooth_stress_regimes_report.py` sobre esse freeze.

---

## 1. Hipóteses explícitas do modelo (o que se assume)

### 1.1 Dados e mercado

- Existe uma **matriz de preços ajustados** (dividendos/splits tratados conforme a fonte) com **séries longas** o suficiente para estimar momentum e volatilidade.
- Os retornos diários são **estacionários no sentido fraco** apenas no limite operacional: o modelo **não** assume i.i.d.; assume que **regras determinísticas** (ranking, caps, rebalanceamento) produzem uma carteira **viável** dia a dia.
- O **benchmark** (ex.: SPY na série exportada) é um **comparador de mercado**, não um passivo garantido a replicar.

### 1.2 Regra de investimento (produto)

- A carteira é **long only**, com **limite de peso por nome** (CAP) e **universo fixo** no tempo de backtest (salvo evoluções explícitas do universo no motor de investigação).
- O **rebalanceamento mensal** e os **custos** (bps de transação + slippage, etc., registados em `v5_kpis.json`) são **hipóteses de execução**: encaixam o backtest na **liquidez institucional**, não na micro‑estrutura de cada sessão.
- O **overlay** (ex.: tendência / vol target conforme configuração V5) é uma **hipótese de gestão de risco**: reduz exposição em certos regimes **à custa** de potencialmente perder retorno em bull markets prolongados.

### 1.3 O que **não** está garantido

- **Estabilidade de parâmetros** no futuro: `rank_in`, `rank_out`, buffers, custos e janelas de momentum são **escolhas de desenho**, não leis naturais.
- **Ausência de look‑ahead** no código de produção é uma **obrigação de engenharia**; a validação contínua é feita por revisão + testes + exports congelados (`freeze/`).
- O desempenho **fora do período** observado não é inferível só por extrapolação dos KPIs agregados.

---

## 2. Stress “fora da amostra” vs janelas móveis (definições honestas)

### 2.1 Verdadeiro fora‑da‑amostra (OOS estrito)

**Definição:** estimar **qualquer parâmetro** ou regra num conjunto de treino `[t0, T]` e medir desempenho **apenas** em `[T+1, t1]`, **sem** recalibrar com dados futuros.

**No contexto DECIDE smooth exportado:**

- O ficheiro do freeze é **um único caminho histórico** já gerado com a **regra final** do produto. **Não** existe, nesse artefacto, uma partição treino/teste de parâmetros.
- Para OOS estrito de **parâmetros** seria necessário, por exemplo: **walk‑forward** no motor de investigação (vários `T`, várias corridas), ou **dados live** após a data do freeze.

### 2.2 Janelas móveis (pseudo‑stress temporal — o que já fazemos)

**Definição:** aplicar **a mesma regra** e medir métricas em **sub‑períodos contíguos** que “deslizam” ao longo da série (ex.: 756 pregões ≈ 3 anos, passo 21 dias).

**Interpretação correta:**

- Mede **variabilidade do resultado da regra** ao longo do tempo (stress **intertemporal**).
- **Não** substitui OOS de parâmetros: os parâmetros do motor **não** mudam entre janelas no export congelado.
- É extremamente útil para **comunicação de risco** (“em 10% das janelas de 3 anos o retorno acumulado ficou abaixo de X”).

**Resultado ilustrativo (moderado overlay, janela 756d, passo 21d, 205 janelas):**

| Métrica (janela) | p10 | p50 | p90 |
|------------------|-----|-----|-----|
| Retorno acumulado modelo (%) | ~38 | ~102 | ~208 |
| Retorno acumulado benchmark (%) | ~-12 | ~31 | ~57 |
| Excesso modelo − bench (pontos %) | ~10 | ~73 | ~178 |
| Max drawdown **dentro** da janela (modelo, %) | ~-29 | ~-25 | ~-13 |

**Leitura:** mesmo com a mesma regra, há **dispersão forte** de resultados em janelas de 3 anos; o investidor deve ver o **p10** como “cenário de frustração” plausível no passado, não como pior caso extremo (para isso serviriam simulações adicionais).

---

## 3. Cenários de regime (definição e resultados no freeze actual)

Os regimes são **recortes de calendário** na série **já simulada**. São **stress de período** (sub‑amostra), não novos mundos simulados.

| Regime | Período (inclusive) | Intuição económica |
|--------|---------------------|--------------------|
| `2008_crise_financeira` | 2008‑01‑01 → 2008‑12‑31 | Crise financeira global |
| `2022_inflacao_multiativo` | 2022‑01‑01 → 2022‑12‑31 | Inflação, juros a subir, ações e bonds sob pressão |
| `2022_2023_juros_altos_Fed` | 2022‑03‑01 → 2023‑10‑31 | Ciclo agressivo de subida de taxas (proxy “juros altos”) |

### 3.1 CAGR dentro do regime (valores do script sobre o freeze)

Valores em **% ao ano** (CAGR anualizado na sub‑série); *n_days* = pregões na intersecção.

#### 2008 — crise financeira

| Perfil | n_days | CAGR modelo | CAGR benchmark |
|--------|--------|---------------|------------------|
| moderado | 253 | **-14,7%** | **-37,7%** |
| conservador | 253 | **-19,0%** | **-37,7%** |
| dinâmico | 253 | **-18,9%** | **-37,7%** |

**Leitura:** em 2008 **todos** os overlays perdem em CAGR, mas **menos** que o benchmark exportado — o stress é “**perder menos num ano catastrófico**”, não ganhar.

#### 2022 — inflação / multiativo

| Perfil | n_days | CAGR modelo | CAGR benchmark |
|--------|--------|---------------|------------------|
| moderado | 251 | **-5,8%** | **-17,8%** |
| conservador | 251 | **-2,7%** | **-17,8%** |
| dinâmico | 251 | **-4,9%** | **-17,8%** |

**Leitura:** o **conservador** amortece mais o drawdown de mercado; o moderado ainda **bate o benchmark** em termos relativos.

#### 2022–2023 — juros altos (Fed)

| Perfil | n_days | CAGR modelo | CAGR benchmark |
|--------|--------|---------------|------------------|
| moderado | 421 | **~+0,07%** | **~-0,67%** |
| conservador | 421 | **~+1,75%** | **~-0,67%** |
| dinâmico | 421 | **~+1,05%** | **~-0,67%** |

**Leitura:** no recorte longo de “juros altos”, os três perfis ficam **próximos de flat a ligeiramente positivos**, com benchmark ainda **ligeiramente negativo** neste agregado — interpretação: **gestão de risco e rotação** ajudaram a atravessar o ciclo; **não** implica rendimento garantido em futuros ciclos idênticos.

---

## 4. Como reproduzir e onde evoluir

### 4.1 Comandos

```bash
cd backend
python scripts/smooth_stress_regimes_report.py
python scripts/smooth_stress_regimes_report.py --json ../tmp_diag/smooth_regimes.json
```

Para a bateria geral (perfis, margem, teórico, janelas full/5y/10y/3y):

```bash
python scripts/smooth_model_battery.py --csv ../tmp_diag/smooth_battery.csv
```

### 4.2 Evolução recomendada (OOS “de verdade”)

1. **Walk‑forward no motor V5** com grelha de datas de “congelamento” da regra (ex.: re‑estimar apenas thresholds de risco anualmente com dados até `31/12` do ano anterior).
2. **Holdout** explícito: reservar os últimos N anos **na calibração** e só reportar métricas finais nessa fatia.
3. **Live vs freeze**: comparar `as_of_date` do freeze com curvas **reconstruídas** em produção (KPI server / tmp_diag) — documentar divergências.

---

## 5. Conclusões operacionais (para comité / compliance)

- As **hipóteses** acima devem constar de **prospecto ou anexo técnico** resumido; qualquer alteração de custos, universo ou parâmetros de overlay **obriga** nova linha de freeze + novo relatório de regime.
- **Janelas móveis** respondem à pergunta: “**Como é que a mesma regra se comportou** em vários horizontes de 3 anos?” — útil para **risco de frustração** do cliente.
- **Regimes 2008 / 2022 / juros** respondem: “**Em anos emblemáticos**, o produto **protegeu** em relação ao benchmark exportado?” — neste freeze, **sim em sentido relativo** em 2008 e 2022; em 2022–23 **ligeiramente positivo vs benchmark ligeiramente negativo**.
- **Não confundir** estes resultados com **promessa** fora do período analisado: são **evidência histórica** sobre a regra e os dados usados naquele export.

---

*Documento gerado como parte do repositório decide-core; actualizar quando o `freeze/` ou o motor V5 mudarem de versão.*
