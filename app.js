/* K&S Emulator — app.js */

const LINES = 32;
const MAX_STEPS = 2000;

// ── DOM helpers ─────────────────────────────────────────────────
function getOrCrash(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado.`);
  return el;
}

const els = {
  gutter: getOrCrash("line-numbers"),
  input: getOrCrash("input"),
  pc: getOrCrash("val-pc"),
  alu: getOrCrash("val-alu"),
  r0: getOrCrash("val-r0"),
  r1: getOrCrash("val-r1"),
  r2: getOrCrash("val-r2"),
  r3: getOrCrash("val-r3"),
  play: getOrCrash("play_button"),
  execAll: getOrCrash("exec_button"),
  next: getOrCrash("next_button"),
  reset: getOrCrash("reset_button"),
  save: getOrCrash("save_button"),
  load: getOrCrash("load_file_input"),
  speed: getOrCrash("speed"),
  status: getOrCrash("exec-status"),
  themeToggle: document.getElementById("theme_toggle"),
};

// Gutter
els.gutter.innerHTML = Array.from({ length: LINES }, (_, i) => `<span>${String(i).padStart(2, "0")}</span>`).join("");
const gutterLines = els.gutter.children;

// ── CPU state ───────────────────────────────────────────────────
let PC = 0;
let ALU = 0;
const Regs = { R0: 0, R1: 0, R2: 0, R3: 0 };
let executing = false;
let timerId = null;
const delayUpper = 2000;

// ── Status line ─────────────────────────────────────────────────
function setStatus(msg, isError) {
  els.status.textContent = msg || "";
  els.status.classList.toggle("is-error", !!isError);
}

// ── Display ─────────────────────────────────────────────────────
function setPC(v) { PC = v; }
function setALU(v) { ALU = v; }
function getReg(k) { return Regs[k]; }
function setReg(k, v) { Regs[k] = v; }

function lines() {
  const arr = els.input.value.split("\n");
  while (arr.length < LINES) arr.push("");
  return arr;
}

function updateDOMValue(el, value) {
  const s = String(value);
  if (el.textContent !== s) {
    el.textContent = s;
    el.classList.remove("is-updated");
    void el.offsetWidth;
    el.classList.add("is-updated");
    window.setTimeout(() => el.classList.remove("is-updated"), 260);
  }
}

function updateDisplay() {
  if (PC >= 0 && PC < LINES) {
    updateDOMValue(els.pc, String(PC).padStart(2, "0"));
    updateDOMValue(els.alu, ALU);
    updateDOMValue(els.r0, Regs.R0);
    updateDOMValue(els.r1, Regs.R1);
    updateDOMValue(els.r2, Regs.R2);
    updateDOMValue(els.r3, Regs.R3);
    for (const n of gutterLines) n.classList.remove("is-active");
    gutterLines[PC].classList.add("is-active");
  }
}

function clearGutterState() {
  for (const n of gutterLines) n.classList.remove("is-active", "is-error");
}

// ── Control ─────────────────────────────────────────────────────
function stopExec() {
  executing = false;
  if (timerId !== null) { clearTimeout(timerId); timerId = null; }
  setPlayLabel(false);
}

function setPlayLabel(running) {
  // keep icon + text in sync without stringly HTML
  els.play.innerHTML = running
    ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="3" y="2.5" width="2.8" height="9" rx="0.7" fill="currentColor"/><rect x="8.2" y="2.5" width="2.8" height="9" rx="0.7" fill="currentColor"/></svg><span>Pausar</span>'
    : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 2.2L11 7L3 11.8V2.2Z" fill="currentColor"/></svg><span>Executar</span>';
}

function playLoop() {
  if (!executing) return;
  executeOne();
  if (!executing) return;
  const delay = delayUpper - Number.parseInt(els.speed.value, 10);
  timerId = window.setTimeout(playLoop, Math.max(16, delay));
}

function reset() {
  stopExec();
  setPC(0);
  clearGutterState();
  for (const k of Object.keys(Regs)) setReg(k, 0);
  setALU(0);
  setStatus("");
  updateDisplay();
}

// ── Validation ──────────────────────────────────────────────────
function validateReg(...regs) {
  for (const r of regs) {
    if (!r || r[0] !== "R" || !/^[0-3]$/.test(r[1]) || r.length !== 2) {
      throw new Error(`Registrador inválido "${r}" na linha ${String(PC).padStart(2, "0")}`);
    }
  }
}

function validateMem(...mems) {
  for (const m of mems) {
    const n = Number.parseInt(m, 10);
    if (Number.isNaN(n) || n < 0 || n > 31) {
      throw new Error(`Endereço de memória inválido "${m}" na linha ${String(PC).padStart(2, "0")}`);
    }
  }
}

// ── ISA ─────────────────────────────────────────────────────────
function HALT() {
  stopExec();
}

function NOP() {}

function LOAD([reg, mem]) {
  validateReg(reg);
  validateMem(mem);
  const raw = lines()[Number.parseInt(mem, 10)];
  // Célula vazia vale 0 (comportamento original). Só é erro se houver texto não numérico.
  const text = String(raw ?? "").trim();
  if (text === "") { setReg(reg, 0); return; }
  const n = Number.parseInt(text, 10);
  if (Number.isNaN(n)) throw new Error(`Valor não numérico "${text}" em [${mem}] na linha ${String(PC).padStart(2, "0")}`);
  setReg(reg, n);
}

function MOVE([a, b]) {
  validateReg(a, b);
  const tmp = getReg(a);
  setReg(a, getReg(b) ?? 0);
  setReg(b, tmp ?? 0);
}

function STORE([mem, reg]) {
  validateReg(reg);
  validateMem(mem);
  const arr = lines();
  arr[Number.parseInt(mem, 10)] = String(getReg(reg));
  els.input.value = arr.join("\n");
}

function ADD([d, a, b]) {
  validateReg(d, a, b);
  const v = getReg(a) + getReg(b);
  if (Number.isNaN(v)) throw new Error(`ADD inválido na linha ${String(PC).padStart(2, "0")}`);
  setReg(d, v);
  setALU(v);
}

function SUB([d, a, b]) {
  validateReg(d, a, b);
  const v = getReg(a) - getReg(b);
  if (Number.isNaN(v)) throw new Error(`SUB inválido na linha ${String(PC).padStart(2, "0")}`);
  setReg(d, v);
  setALU(v);
}

function AND([d, a, b]) {
  validateReg(d, a, b);
  const result = getReg(a) & getReg(b);
  setReg(d, result);
  setALU(result);
}

function OR([d, a, b]) {
  validateReg(d, a, b);
  const result = getReg(a) | getReg(b);
  setReg(d, result);
  setALU(result);
}

function BRANCH([mem]) {
  validateMem(mem);
  setPC(Number.parseInt(mem, 10) - 1);
}

function BZERO([mem]) {
  validateMem(mem);
  if (ALU === 0) setPC(Number.parseInt(mem, 10) - 1);
}

function BNEG([mem]) {
  validateMem(mem);
  if (ALU < 0) setPC(Number.parseInt(mem, 10) - 1);
}

const ISA = { SUB, STORE, OR, NOP, MOVE, LOAD, HALT, BZERO, BRANCH, BNEG, AND, ADD };

// ── Execute ─────────────────────────────────────────────────────
function executeOne() {
  if (PC >= LINES || PC < 0) { stopExec(); return; }

  for (const n of gutterLines) n.classList.remove("is-error");

  const raw = lines()[PC];
  if (!raw || raw.trim() === "") { setPC(PC + 1); updateDisplay(); return; }

  try {
    const parts = raw.trim().split(/\s+/);
    const op = parts[0].toUpperCase();
    const params = parts.slice(1).map((p) => p.toUpperCase());
    const fn = ISA[op];
    if (!fn) throw new Error(`Instrução desconhecida "${parts[0]}" na linha ${String(PC).padStart(2, "0")}`);
    fn(params);
    setPC(PC + 1);
    setStatus("");
  } catch (err) {
    for (const n of gutterLines) n.classList.remove("is-active");
    if (gutterLines[PC]) gutterLines[PC].classList.add("is-error");
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg, true);
    stopExec();
  }
  updateDisplay();
}

// ── Events ──────────────────────────────────────────────────────
els.play.addEventListener("click", () => {
  if (executing) {
    stopExec();
  } else {
    executing = true;
    setPlayLabel(true);
    setStatus("");
    playLoop();
  }
});

els.execAll.addEventListener("click", () => {
  stopExec();
  executing = true;
  let steps = 0;
  while (executing) {
    if (steps++ > MAX_STEPS) {
      setStatus(`Limite de ${MAX_STEPS} passos atingido — possível loop infinito.`, true);
      stopExec();
      break;
    }
    executeOne();
  }
});

els.next.addEventListener("click", () => {
  stopExec();
  executeOne();
});

els.reset.addEventListener("click", reset);

els.save.addEventListener("click", () => {
  const blob = new Blob([els.input.value], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "programa_assembly.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

els.load.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    els.input.value = String(ev.target.result || "");
    reset();
  };
  reader.readAsText(file);
  e.target.value = "";
});

// Keyboard: keep gutter aligned on scroll/edit
els.input.addEventListener("scroll", () => {
  els.gutter.scrollTop = els.input.scrollTop;
});

// ── Theme ───────────────────────────────────────────────────────
(function initTheme() {
  const btn = els.themeToggle;
  if (!btn) return;
  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ks-theme", theme); } catch (e) {}
  }
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    apply(cur === "dark" ? "light" : "dark");
  });
})();

// Boot
updateDisplay();
