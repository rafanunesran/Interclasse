// ============================================================
// FINANCEIRO → CUSTOS POR LOTE: impressão por METRO LINEAR
// ============================================================
// A impressão é cobrada por metro linear do rolo. Para chegar ao custo real
// de um lote (uma leva da aba Produção), o site junta TODAS as peças das
// camisetas do lote — os moldes de verdade de cada tamanho (aba Tamanhos),
// reforço de ombro e etiqueta — e encaixa tudo num rolo só, com a largura do
// rolo e o espaço entre as peças, igual ao que a folha EPS faz (EPS.empacotar).
// Daí saem:
//   - o comprimento do encaixe (metros lineares) e o aproveitamento;
//   - a área perdida (rolo usado − área das peças);
//   - o mínimo teórico (área das peças ÷ largura, 100% de aproveitamento).
// Como o arquivo final costuma ser reorganizado à mão para aproveitar melhor
// o espaço, dá para informar os METROS REAIS do arquivo final: o custo usa
// esses metros, e a simulação fica como referência.
//
// O custo de impressão de um lote é rateado pela ÁREA das peças de cada
// camiseta (um GG paga mais que um P, e a perda se divide na mesma
// proporção) — ver areaDaCamisetaMm2(), usada em custosDosLotes().
//
// Carregado depois de js/artes.js (pecasDoTime, timeDaLinha, moldesConfig,
// layoutConfig) e de js/movimentacoes.js.

const CI_PRECO_KEY = "interclasse.precoMetroImpressao";
const ciAreaCache = new WeakMap(); // molde -> área (mm²)

// Área de uma peça: a do contorno do molde (o formato de verdade); sem
// contorno lido, a do retângulo do molde.
function ciAreaMoldeMm2(molde) {
  if (!molde || !molde.bbox) return 0;
  if (ciAreaCache.has(molde)) return ciAreaCache.get(molde);
  const t = EPS.tamanhoMmDoBbox(molde.bbox);
  let area = t.w * t.h;
  if (molde.contorno) {
    const polis = EPS.poligonosDoContorno(EPS.comandosDoContorno(molde.contorno));
    let maior = 0;
    polis.forEach((p) => {
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
        a += x1 * y2 - x2 * y1;
      }
      maior = Math.max(maior, Math.abs(a) / 2);
    });
    if (maior > 0) area = maior;
  }
  ciAreaCache.set(molde, area);
  return area;
}

// Peças que uma camiseta da leva leva para a folha: [{ pecaId, molde }].
// null quando não dá para saber (sem time com esse modelo).
function ciPecasDaCamiseta(item, atual, cache) {
  if (typeof timeDaLinha !== "function" || typeof pecasDoTime !== "function") return null;
  const timeId = timeDaLinha(item);
  if (!timeId || !estadoTimes[timeId]) return null;
  const chave = timeId + (atual.goleiro ? "|g" : "");
  let ids = cache && cache.get(chave);
  if (!ids) {
    const time = typeof timeNaVariante === "function"
      ? timeNaVariante(estadoTimes[timeId].time, atual.goleiro) : estadoTimes[timeId].time;
    ids = pecasDoTime(time);
    if (cache) cache.set(chave, ids);
  }
  return ids.map((pecaId) => ({
    pecaId,
    molde: EPS.PECAS_VIRTUAIS[pecaId]
      ? EPS.moldeVirtual(moldesConfig, layoutConfig, pecaId, atual.tamanho)
      : ((moldesConfig.pecas || {})[pecaId] || {})[atual.tamanho] || null
  }));
}

// Área (mm²) das peças de uma camiseta da leva; 0 quando falta molde.
function areaDaCamisetaMm2(item, atual, cache) {
  const pecas = ciPecasDaCamiseta(item, atual, cache);
  if (!pecas || !pecas.length) return 0;
  let total = 0;
  for (const p of pecas) {
    const a = ciAreaMoldeMm2(p.molde);
    if (!(a > 0)) return 0;
    total += a;
  }
  return total;
}

// Encaixe de todas as peças do lote num rolo só.
// op: { larguraCm, espacoMm, rotacao: "0" | "90" }
function simularEncaixeLote(levaId, op) {
  const e = estadoLevas[levaId];
  const larguraMm = (Number(op.larguraCm) || 150) * 10;
  const comFaca = ((layoutConfig && layoutConfig.folha) || {}).molde !== "nenhum";
  const cache = new Map();
  const blocos = [];
  const porTamanho = {};
  const semMolde = new Set();
  let camisetas = 0;
  let areaPecas = 0;

  (e ? e.itens : []).forEach((item) => {
    const atual = itemAtual(item);
    const pecas = ciPecasDaCamiseta(item, atual, cache);
    if (!pecas || !pecas.length) {
      semMolde.add(`${atual.nomeCamiseta || atual.nome || "camiseta"} (${atual.tamanho || "sem tamanho"}): sem time/arte para saber as peças`);
      return;
    }
    camisetas++;
    const tam = atual.tamanho || "—";
    const pt = porTamanho[tam] || (porTamanho[tam] = { qtd: 0, area: 0 });
    pt.qtd++;
    pecas.forEach(({ pecaId, molde }) => {
      if (!molde || !molde.bbox) {
        semMolde.add(`Sem molde de ${typeof nomePecaProducao === "function" ? nomePecaProducao(pecaId) : pecaId} no tamanho ${tam}`);
        return;
      }
      const t = EPS.tamanhoMmDoBbox(molde.bbox);
      const area = ciAreaMoldeMm2(molde);
      areaPecas += area;
      pt.area += area;
      blocos.push({ w: t.w, h: t.h, borda: comFaca && molde.contorno ? 3 : 0, rotulo: `${pecaId} ${tam}` });
    });
  });

  const { folhas, avisos } = EPS.empacotar(blocos, {
    larguraMm, espacoMm: Math.max(0, Number(op.espacoMm) || 0), rotacao: op.rotacao
  });
  const comprimentoMm = folhas.reduce((s, f) => s + f.alturaMm, 0);
  const areaRolo = comprimentoMm * larguraMm;
  return {
    camisetas,
    pecas: blocos.length,
    larguraMm,
    comprimentoM: comprimentoMm / 1000,
    minimoM: larguraMm > 0 ? areaPecas / larguraMm / 1000 : 0,
    areaPecasM2: areaPecas / 1e6,
    areaRoloM2: areaRolo / 1e6,
    aproveitamento: areaRolo > 0 ? (areaPecas / areaRolo) * 100 : 0,
    porTamanho,
    avisos: [...semMolde, ...avisos]
  };
}

// Último preço por metro usado (neste navegador ou no último lançamento).
function ciPrecoPadrao() {
  try {
    const v = localStorage.getItem(CI_PRECO_KEY);
    if (v) return v;
  } catch (e) { /* sem localStorage */ }
  const ultimo = movimentacoes
    .filter((m) => Number(m.precoMetro) > 0)
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")))[0];
  return ultimo ? String(ultimo.precoMetro) : "";
}

// Pop-up da calculadora (botão "Calcular por metro" na visão Custos por lote).
function abrirCalculadoraMetro(levaId) {
  const e = estadoLevas[levaId];
  if (!e) return;
  const f = (layoutConfig && layoutConfig.folha) || {};
  const nomeLote = e.leva.nome || "Leva sem nome";
  let sim = null;

  const fundo = document.createElement("div");
  fundo.className = "modal-pix modal-eps";
  fundo.innerHTML = `
    <div class="modal-pix-conteudo modal-form-conteudo ci-modal">
      <button type="button" class="modal-pix-fechar" aria-label="Fechar">×</button>
      <h3>Impressão por metro linear — ${escapeHtmlAdmin(nomeLote)}</h3>
      <p class="pix-ajuda">Encaixa num rolo só as peças de todas as ${e.itens.length} camiseta(s) do lote (moldes reais de cada tamanho + espaço entre peças), como na folha EPS.</p>
      <form novalidate>
        <div class="grade-2">
          <label>Largura útil do rolo (cm)<input type="number" name="larguraCm" min="10" step="0.5" value="${escAttr(f.larguraCm || 150)}" /></label>
          <label>Espaço entre peças (mm)<input type="number" name="espacoMm" min="0" step="0.5" value="${escAttr(f.espacoMm == null ? 10 : f.espacoMm)}" /></label>
        </div>
        <label>Girar as peças?
          <select name="rotacao">
            <option value="0">Não girar</option>
            <option value="90">Girar 90° quando aproveitar melhor</option>
          </select></label>
        <button type="button" class="secundario" data-ci="simular">Simular encaixe</button>
        <div class="ci-resultado"></div>
        <div class="grade-2">
          <label>Preço por metro linear (R$)<input type="number" name="precoMetro" min="0" step="0.01" inputmode="decimal" value="${escAttr(ciPrecoPadrao())}" /></label>
          <label>Metros do arquivo final (opcional)<input type="number" name="metrosReais" min="0" step="0.01" inputmode="decimal" placeholder="usa a simulação" /></label>
        </div>
        <p class="pix-ajuda">Reorganizou o arquivo para aproveitar melhor o espaço? Informe o comprimento final: o custo usa ele, e a perda é recalculada.</p>
        <div class="ci-custo"></div>
        <div class="grade-2">
          <label>Data<input type="date" name="data" value="${escAttr(movHojeIso())}" /></label>
          <label>Situação<select name="situacao">
            <option value="pago">Pago (sai do caixa)</option>
            <option value="apagar">A pagar (conta em aberto)</option>
          </select></label>
        </div>
        <label>Forma<select name="forma">${Object.entries(MOV_FORMAS).map(([id, n]) => `<option value="${id}">${n}</option>`).join("")}</select></label>
        <button type="submit" class="primario">Lançar como custo de impressão do lote</button>
        <p class="msg-mov oculto"></p>
      </form>
    </div>`;
  const form = fundo.querySelector("form");
  form.rotacao.value = f.rotacao || "0";
  // Metragem das folhas já geradas (aba Produção) como "metros do arquivo final".
  if (typeof metragemTotalDaLeva === "function" && typeof agruparPorModelo === "function") {
    const r = metragemTotalDaLeva(e.leva, agruparPorModelo(e.itens));
    if (r.total > 0 && !r.faltam) form.metrosReais.value = (Math.round(r.total * 100) / 100).toFixed(2);
  }
  const elRes = fundo.querySelector(".ci-resultado");
  const elCusto = fundo.querySelector(".ci-custo");
  const fechar = () => fundo.remove();
  fundo.querySelector(".modal-pix-fechar").onclick = fechar;
  fundo.addEventListener("click", (ev) => { if (ev.target === fundo) fechar(); });

  const num = (v) => Number(String(v || "").replace(",", ".")) || 0;
  const fmtM = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
  const metrosUsados = () => num(form.metrosReais.value) || (sim ? sim.comprimentoM : 0);
  const custoTotal = () => Math.round(metrosUsados() * num(form.precoMetro.value) * 100) / 100;

  const simular = () => {
    elRes.innerHTML = '<p class="pix-ajuda">Encaixando…</p>';
    // Deixa a tela mostrar o "Encaixando…" antes da conta (lotes grandes demoram).
    setTimeout(() => {
      try {
        sim = simularEncaixeLote(levaId, {
          larguraCm: num(form.larguraCm.value), espacoMm: num(form.espacoMm.value), rotacao: form.rotacao.value
        });
      } catch (erro) {
        console.error(erro);
        sim = null;
        elRes.innerHTML = '<p class="erro">Não foi possível simular o encaixe.</p>';
        return;
      }
      elRes.innerHTML = sim.pecas === 0
        ? '<p class="erro">Nenhuma peça com molde neste lote. Confira os moldes (aba Tamanhos) e as artes dos times.</p>'
        : `<div class="fin-destaques fin-destaques-4">
            <div class="fin-card"><span class="fin-rotulo">Encaixe simulado</span><span class="fin-valor fin-valor-md">${fmtM(sim.comprimentoM)}</span><span class="fin-sub">${sim.pecas} peça(s) de ${sim.camisetas} camiseta(s)</span></div>
            <div class="fin-card"><span class="fin-rotulo">Aproveitamento</span><span class="fin-valor fin-valor-md">${sim.aproveitamento.toFixed(0)}%</span><span class="fin-sub">peças ${sim.areaPecasM2.toFixed(2)} m² de ${sim.areaRoloM2.toFixed(2)} m²</span></div>
            <div class="fin-card"><span class="fin-rotulo">Mínimo teórico</span><span class="fin-valor fin-valor-md">${fmtM(sim.minimoM)}</span><span class="fin-sub">100% de aproveitamento (só a área das peças)</span></div>
          </div>
          ${sim.avisos.length ? `<p class="aviso">${sim.avisos.slice(0, 6).map(escapeHtmlAdmin).join("<br>")}${sim.avisos.length > 6 ? `<br>… e mais ${sim.avisos.length - 6}` : ""}</p>` : ""}`;
      atualizarCusto();
    }, 20);
  };

  const atualizarCusto = () => {
    if (!sim || sim.pecas === 0) {
      elCusto.innerHTML = "";
      return;
    }
    const metros = metrosUsados();
    const total = custoTotal();
    const areaRolo = metros * sim.larguraMm / 1000; // m²
    const perda = Math.max(0, areaRolo - sim.areaPecasM2);
    const linhas = Object.entries(sim.porTamanho)
      .sort((a, b) => a[1].area / a[1].qtd - b[1].area / b[1].qtd)
      .map(([tam, d]) => {
        const un = sim.areaPecasM2 > 0 ? total * (d.area / 1e6 / sim.areaPecasM2) / d.qtd : 0;
        return `<tr><td>${escapeHtmlAdmin(tam)}</td><td>${d.qtd}</td><td>${(d.area / d.qtd / 100).toFixed(0)} cm²</td><td><strong>${formatarReais(un)}</strong></td></tr>`;
      }).join("");
    elCusto.innerHTML = `
      <p><strong>${fmtM(metros)}</strong> × ${formatarReais(num(form.precoMetro.value))}/m = <strong>${formatarReais(total)}</strong>
        · área perdida ${perda.toFixed(2)} m² (${areaRolo > 0 ? ((perda / areaRolo) * 100).toFixed(0) : 0}%)</p>
      <div class="fin-tabela-wrap"><table class="fin-tabela">
        <thead><tr><th>Tamanho</th><th>Qtd</th><th>Área / un.</th><th>Impressão / un.</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
      <p class="pix-ajuda">Cada camiseta paga pela área das suas peças; o espaço entre elas e a sobra do rolo se dividem na mesma proporção.</p>`;
  };

  fundo.querySelector('[data-ci="simular"]').onclick = simular;
  [form.precoMetro, form.metrosReais].forEach((el) => el.addEventListener("input", atualizarCusto));

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const msg = form.querySelector(".msg-mov");
    const total = custoTotal();
    if (!sim) return mostrarMensagem(msg, "Simule o encaixe primeiro.", "erro");
    if (!(total > 0)) return mostrarMensagem(msg, "Informe o preço por metro.", "erro");
    const metros = Math.round(metrosUsados() * 100) / 100;
    const preco = num(form.precoMetro.value);
    try { localStorage.setItem(CI_PRECO_KEY, String(preco)); } catch (e) { /* sem localStorage */ }
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await db.collection(COL_MOVIMENTACOES).add({
        tipo: "pagamento",
        valor: total,
        data: form.data.value || movHojeIso(),
        descricao: `Impressão — ${metros.toLocaleString("pt-BR")} m × ${formatarReais(preco)}/m`,
        forma: MOV_FORMAS[form.forma.value] ? form.forma.value : "pix",
        categoria: "Impressão",
        timeId: "",
        timeNome: "",
        clienteId: clienteFiltro && clienteFiltro !== SEM_CLIENTE ? clienteFiltro : "",
        levaId,
        levaNome: nomeLote,
        aPagar: form.situacao.value === "apagar",
        // Memória do cálculo (para conferir depois).
        metrosLineares: metros,
        metrosSimulados: Math.round(sim.comprimentoM * 100) / 100,
        precoMetro: preco,
        larguraRoloCm: sim.larguraMm / 10,
        aproveitamento: Math.round(sim.aproveitamento),
        cancelado: false,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
      fechar();
    } catch (erro) {
      console.error(erro);
      botao.disabled = false;
      mostrarMensagem(msg, "Erro ao lançar. Confira se o firestore.rules atualizado foi publicado no Firebase.", "erro");
    }
  };

  document.body.appendChild(fundo);
  simular();
}
