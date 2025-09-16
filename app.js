// ========== Константы и ключи хранилища ==========
const STORAGE_KEYS = {
  STATE: "quiz.state.v1",
};
const DATA_URL = "./data/questions.json";

// ========== Модели ==========
/**
 * @typedef {{ id: string; text: string; options: string[]; correctIndex: number; topic?: string }} QuestionDTO
 * @typedef {{ title: string; timeLimitSec: number; passThreshold: number; questions: QuestionDTO[] }} QuizDTO
 */

class Question {
  /** @param {QuestionDTO} dto */
  constructor(dto) {
    this.id = dto.id;
    this.text = dto.text;
    this.options = dto.options;
    this.correctIndex = dto.correctIndex;
    this.topic = dto.topic ?? null;
  }
}

// ========== Сервисы ==========
class StorageService {
  static saveState(state) {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
  }

  static loadState() {
    const raw = localStorage.getItem(STORAGE_KEYS.STATE);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  static clear() {
    localStorage.removeItem(STORAGE_KEYS.STATE);
  }
}


// ========== Движок теста ==========
class QuizEngine {
  /** @param {QuizDTO} quiz */
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec;
    this.passThreshold = quiz.passThreshold;
    this.questions = quiz.questions.map((q) => new Question(q));

    this.currentIndex = 0;
    this.answers = {}; // questionId -> selectedIndex
    this.remainingSec = quiz.timeLimitSec;
    this.isFinished = false;
  }

  get length() {
    return this.questions.length;
  }

  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  goTo(index) {
    if (index >= 0 && index < this.length) {
      this.currentIndex = index;
    }
  }

  next() {
    if (this.currentIndex < this.length - 1) {
      this.currentIndex++;
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
    }
  }

  select(optionIndex) {
    const q = this.currentQuestion;
    this.answers[q.id] = optionIndex;
  }

  getSelectedIndex() {
    const q = this.currentQuestion;
    return this.answers[q.id];
  }

  tick() {
    if (this.isFinished) return;
    this.remainingSec--;
    if (this.remainingSec <= 0) {
      this.finish();
    }
  }

  finish() {
    this.isFinished = true;
    let correct = 0;
    this.questions.forEach((q) => {
      if (this.answers[q.id] === q.correctIndex) {
        correct++;
      }
    });
    const total = this.length;
    const percent = correct / total;
    const passed = percent >= this.passThreshold;
    return { correct, total, percent, passed };
  }

  toState() {
    return {
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
    };
  }

  static fromState(quiz, state) {
    const engine = new QuizEngine(quiz);
    engine.currentIndex = state.currentIndex ?? 0;
    engine.answers = state.answers ?? {};
    engine.remainingSec =
      typeof state.remainingSec === "number"
        ? state.remainingSec
        : quiz.timeLimitSec;
    engine.isFinished = !!state.isFinished;
    return engine;
  }
}

// ========== DOM-утилиты ==========
const $ = (sel) => /** @type {HTMLElement} */(document.querySelector(sel));
const els = {
  title: $("#quiz-title"),
  progress: $("#progress"),
  timer: $("#timer"),
  qSection: $("#question-section"),
  qText: $("#question-text"),
  form: $("#options-form"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  btnFinish: $("#btn-finish"),
  result: $("#result-section"),
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart"),
};

let engine = /** @type {QuizEngine|null} */ (null);
let timerId = /** @type {number|undefined} */ (undefined);
let reviewMode = false;

// ========== Инициализация ==========
document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title;

  const saved = StorageService.loadState();
  if (saved) {
    engine = QuizEngine.fromState(quiz, saved);
  } else {
    engine = new QuizEngine(quiz);
  }

  bindEvents();

  renderAll();

  startTimer();
});

async function loadQuiz() {
  // Загружаем JSON с вопросами
  const res = await fetch(DATA_URL);
  /** @type {QuizDTO} */
  const data = await res.json();
  // Простейшая валидация формата (можно расширить)
  if (!data?.questions?.length) {
    throw new Error("Некорректные данные теста");
  }
  return data;
}

// ========== Таймер ==========
function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    try {
      engine.tick();
      persist();
      renderTimer();
    } catch (e) {
      // До реализации tick() попадём сюда — это нормально для шаблона.
      stopTimer();
    }
  }, 1000);
}
function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = undefined;
  }
}

// ========== События ==========
function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    safeCall(() => engine.prev());
    persist();
    renderAll();
  });

  els.btnNext.addEventListener("click", () => {
    safeCall(() => engine.next());
    persist();
    renderAll();
  });

  els.btnFinish.addEventListener("click", () => {
    const summary = safeCall(() => engine.finish());
    if (summary) {
      stopTimer();
      renderResult(summary);
      persist();
    }
  });

  els.btnReview.addEventListener("click", () => {
    reviewMode = true;
    renderAll();
  });

  els.btnRestart.addEventListener("click", () => {
    StorageService.clear?.();
    window.location.reload();
  });

  els.form.addEventListener("change", (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target?.name === "option") {
      const idx = Number(target.value);
      safeCall(() => engine.select(idx));
      persist();
      renderNav();
    }
  });
}

function safeCall(fn) {
  try {
    return fn?.();
  } catch {
    /* noop в шаблоне */
  }
}

// ========== Рендер ==========
function renderAll() {
  renderProgress();
  renderTimer();
  renderQuestion();
  renderNav();
}

function renderProgress() {
  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length
    }`;
}

function renderTimer() {
  const sec = engine.remainingSec ?? 0;
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  els.timer.textContent = `${m}:${s}`;
}

function renderQuestion() {
  const q = engine.currentQuestion;
  els.qText.textContent = q.text;

  els.form.innerHTML = "";
  els.form.setAttribute("aria-labelledby", "question-text");

  q.options.forEach((opt, i) => {
    const id = `opt-${q.id}-${i}`;
    const labelId = `${id}-label`;
    const wrapper = document.createElement("label");
    wrapper.className = "option";
    wrapper.setAttribute("role", "radio");
    wrapper.setAttribute("aria-checked", String(engine.getSelectedIndex?.() === i));
    wrapper.setAttribute("tabindex", "0");

    if (reviewMode) {
      const chosen = engine.answers[q.id];
      if (i === q.correctIndex) wrapper.classList.add("correct");
      if (chosen === i && i !== q.correctIndex) wrapper.classList.add("incorrect");
    }

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = String(i);
    input.id = id;
    input.checked = engine.getSelectedIndex?.() === i;
    input.setAttribute("aria-labelledby", labelId);

    const span = document.createElement("span");
    span.id = labelId;
    span.textContent = opt;

    wrapper.addEventListener("click", (ev) => {
      const id = i;
      safeCall(() => engine.select(id));
      persist();
      renderNav();
      Array.from(els.form.querySelectorAll("label.option")).forEach((lab, j) => {
        lab.setAttribute("aria-checked", String(engine.getSelectedIndex?.() === j));
      });
    });

    wrapper.addEventListener("keydown", (ev) => {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        wrapper.click();
      }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(span);
    els.form.appendChild(wrapper);
  });

  window.requestAnimationFrame(() => {
    const selected = els.form.querySelector('input[checked="checked"], input:checked');
    if (selected) {
      const lab = selected.closest("label.option");
      if (lab) lab.focus();
    } else {
      const first = els.form.querySelector("label.option");
      if (first) first.focus();
    }
  });
}



function renderNav() {
  const hasSelection = Number.isInteger(engine.getSelectedIndex?.());
  els.btnPrev.disabled = engine.currentIndex === 0;
  els.btnNext.disabled = !(
    engine.currentIndex < engine.length - 1 && hasSelection
  );
  els.btnFinish.disabled = !(
    engine.currentIndex === engine.length - 1 && hasSelection
  );
}

function renderResult(summary) {
  els.result.classList.remove("hidden");
  const pct = Math.round(summary.percent * 100);
  const status = summary.passed ? "Пройден" : "Не пройден";
  els.resultSummary.textContent = `${summary.correct} / ${summary.total} (${pct}%) — ${status}`;
}

// ========== Persist ==========
function persist() {
  try {
    const snapshot = engine.toState?.();
    if (snapshot) StorageService.saveState(snapshot);
  } catch {
    /* noop в шаблоне */
  }
}

// ========== Клавиатурная навигация для удобства и доступности ==========
document.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const isInputLike = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
  if (isInputLike) return;

  if (!engine || engine.isFinished) return;

  if (e.key === "ArrowRight") {
    const hasSelection = Number.isInteger(engine.getSelectedIndex?.());
    if (engine.currentIndex < engine.length - 1 && hasSelection) {
      safeCall(() => engine.next());
      persist();
      renderAll();
    }
  } else if (e.key === "ArrowLeft") {
    if (engine.currentIndex > 0) {
      safeCall(() => engine.prev());
      persist();
      renderAll();
    }
  } else if (e.key === "Enter" || e.key === " ") {
    if (active && active.classList && active.classList.contains("option")) {
      e.preventDefault();
      active.click();
    }
  }
});