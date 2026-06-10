const SESSION_KEY = "math-adventure-active-session";

let state = {
  session: loadLocalSession(),
  selectedImageDataUrl: "",
  selectedPlanDate: "",
  breakInterval: null,
  breakRemaining: 0,
  breakTotal: 0,
};

function loadLocalSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveLocalSession() {
  if (state.session) localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
  else localStorage.removeItem(SESSION_KEY);
}

function switchView(viewName) {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#${viewName}View`).classList.add("active");
}

async function saveDayPlan() {
  const status = document.querySelector("#dayPlanStatus");
  status.textContent = "Saving math plan...";

  const payload = {
    planDate: document.querySelector("#planDate").value,
    instructions: document.querySelector("#parentInstructions").value.trim(),
    samples: document.querySelector("#mathSamples").value.trim(),
    imageDataUrl: state.selectedImageDataUrl,
    breakMinutes: Number(document.querySelector("#breakMinutes").value || 5),
  };

  const response = await fetchJson("/api/day-plan", payload);
  status.textContent = response.ok
    ? `Plan saved for ${response.plan.planDate}.`
    : "Could not save the day plan.";
  await loadPlanList();
}

async function startSession() {
  setBusy("Generating batch 1 from parent instructions and saved history...");
  const response = await fetchJson("/api/start-math-session", { planDate: todayString() });
  if (!response.ok) {
    setBusy(`Could not start. Save a parent day plan for ${todayString()} first.`);
    return;
  }
  state.session = response.session;
  saveLocalSession();
  switchView("kid");
  render();
}

async function loadDayPlanForDate() {
  const planDate = document.querySelector("#planDate").value;
  if (!planDate) return;
  state.selectedPlanDate = planDate;
  const status = document.querySelector("#dayPlanStatus");
  status.textContent = `Loading plan for ${planDate}...`;
  const response = await fetch(`/api/day-plan?date=${encodeURIComponent(planDate)}`);
  if (!response.ok) {
    status.textContent = "Could not load plan.";
    return;
  }
  const data = await response.json();
  if (!data.plan) {
    document.querySelector("#parentInstructions").value = "";
    document.querySelector("#mathSamples").value = "";
    document.querySelector("#breakMinutes").value = "5";
    state.selectedImageDataUrl = "";
    document.querySelector("#imageStatus").textContent = "Optional. The image is sent to the server as context when generating.";
    status.textContent = `No plan yet for ${planDate}. Add instructions and save.`;
    setPlanReadOnly(isPastDate(planDate));
    highlightSelectedPlan();
    return;
  }
  document.querySelector("#parentInstructions").value = data.plan.instructions || "";
  document.querySelector("#mathSamples").value = data.plan.samples || "";
  document.querySelector("#breakMinutes").value = String(data.plan.breakMinutes || 5);
  state.selectedImageDataUrl = data.plan.imageDataUrl || "";
  document.querySelector("#imageStatus").textContent = data.plan.imageDataUrl ? "Existing image saved for this date. Upload a new one to replace it." : "Optional. The image is sent to the server as context when generating.";
  const locked = isPastDate(planDate);
  setPlanReadOnly(locked);
  status.textContent = locked ? `Loaded ${planDate}. Past plans are read-only.` : `Loaded existing plan for ${planDate}. Edits will update this date.`;
  highlightSelectedPlan();
}

async function loadPlanList() {
  const list = document.querySelector("#planList");
  if (!list) return;
  const response = await fetch("/api/day-plan");
  const data = response.ok ? await response.json() : { plans: [] };
  list.innerHTML = data.plans?.length
    ? data.plans
        .map((plan) => {
          const lockLabel = isPastDate(plan.planDate) ? "Locked" : "Editable";
          return `<button class="plan-date-button" type="button" data-plan-date="${plan.planDate}">
            <span>${plan.planDate}</span>
            <small>${lockLabel}</small>
          </button>`;
        })
        .join("")
    : `<p class="muted">No saved plans yet.</p>`;
  list.querySelectorAll("[data-plan-date]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#planDate").value = button.dataset.planDate;
      loadDayPlanForDate();
    });
  });
  highlightSelectedPlan();
}

function highlightSelectedPlan() {
  document.querySelectorAll("[data-plan-date]").forEach((button) => {
    button.classList.toggle("active", button.dataset.planDate === state.selectedPlanDate);
  });
}

function setPlanReadOnly(readOnly) {
  ["parentInstructions", "mathSamples", "problemImage", "breakMinutes", "saveDayPlan"].forEach((id) => {
    const element = document.querySelector(`#${id}`);
    if (!element) return;
    element.disabled = readOnly;
  });
}

function render() {
  renderSessionHeader();
  renderQuestionArea();
  renderHistory();
}

function renderSessionHeader() {
  const session = state.session;
  const activeBatch = getActiveBatch();
  const answered = activeBatch ? activeBatch.answers.filter(Boolean).length : 0;
  const batchNumber = activeBatch ? activeBatch.batchNumber : session?.currentBatchNumber || 0;
  const totalQuestions = activeBatch ? activeBatch.questions.length : 10;

  document.querySelector("#sessionStatus").textContent = session ? `${session.status} · batch ${batchNumber}/3` : "No active session";
  document.querySelector("#batchEyebrow").textContent = session ? `Batch ${batchNumber} of 3` : "Ready";
  document.querySelector("#batchTitle").textContent = session ? activeBatch?.title || "Math batch" : "Start today’s math session";
  document.querySelector("#batchPill").textContent = session ? `${batchNumber} / 3 batches` : "0 / 3 batches";
  document.querySelector("#scoreLabel").textContent = session ? `${answered} of ${totalQuestions} answered` : "0 answered";
  document.querySelector("#progressLabel").textContent = session ? `${getBatchCorrect(activeBatch)} correct so far` : "No batch active";
  document.querySelector("#progressFill").style.width = session ? `${Math.round((answered / totalQuestions) * 100)}%` : "0%";
}

function renderQuestionArea() {
  const stack = document.querySelector("#questionStack");
  const session = state.session;
  document.querySelector("#breakPanel").hidden = true;

  if (!session) {
    stack.innerHTML = `
      <article class="question-card single-question">
        <p class="eyebrow">No session</p>
        <h3>Ask the parent to save today’s math plan, then click Start Math.</h3>
      </article>
    `;
    return;
  }

  if (session.status === "complete") {
    stack.innerHTML = `
      <article class="question-card single-question">
        <p class="eyebrow">Done</p>
        <h3>Math session complete.</h3>
        <p class="muted">All 3 batches were saved to the database.</p>
      </article>
    `;
    document.querySelector("#coachTitle").textContent = "Finished";
    document.querySelector("#coachMessage").textContent = "Good work. Parent can review the saved answers in History.";
    return;
  }

  if (session.status === "break") {
    renderBreak();
    return;
  }

  const batch = getActiveBatch();
  const questionIndex = batch.answers.findIndex((answer) => !answer);
  if (questionIndex === -1) {
    renderBatchSubmit(batch);
    return;
  }

  const question = batch.questions[questionIndex];
  stack.innerHTML = `
    <div class="quiz-progress">
      <span>Question ${questionIndex + 1} of ${batch.questions.length}</span>
      <strong>Batch ${batch.batchNumber} of 3</strong>
    </div>
    <article class="question-card single-question">
      <p class="eyebrow">${question.visual ? "Visual math" : "Multiple choice"}</p>
      <h3>${escapeHtml(question.prompt)}</h3>
      ${renderVisual(question.visual)}
      <div class="choice-grid">
        ${question.choices.map((choice) => `<button class="choice-button" type="button" data-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join("")}
      </div>
      <div class="question-result" id="questionResult"></div>
    </article>
  `;
  stack.querySelectorAll(".choice-button").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(questionIndex, button.dataset.choice));
  });
  document.querySelector("#coachTitle").textContent = "Solve carefully";
  document.querySelector("#coachMessage").textContent = "One question at a time. Wrong answers show an explanation and are saved for the next LLM prompt.";
}

function renderBatchSubmit(batch) {
  document.querySelector("#questionStack").innerHTML = `
    <article class="question-card single-question">
      <p class="eyebrow">Batch complete</p>
      <h3>${getBatchCorrect(batch)} correct out of ${batch.questions.length}</h3>
      <p class="muted">Submit this batch to save the answers. Then the app starts a short break before the next generated batch.</p>
      <button class="primary-button" id="submitBatch" type="button">Submit Batch</button>
    </article>
  `;
  document.querySelector("#submitBatch").addEventListener("click", submitBatch);
}

function answerQuestion(questionIndex, choice) {
  const batch = getActiveBatch();
  const question = batch.questions[questionIndex];
  const isCorrect = normalize(choice) === normalize(question.answer);
  batch.answers[questionIndex] = {
    choice,
    isCorrect,
    answeredAt: new Date().toISOString(),
  };
  saveLocalSession();

  document.querySelectorAll(".choice-button").forEach((button) => {
    const isAnswer = normalize(button.dataset.choice) === normalize(question.answer);
    button.disabled = true;
    button.classList.toggle("correct", isAnswer);
    button.classList.toggle("wrong", button.dataset.choice === choice && !isCorrect);
  });
  const result = document.querySelector("#questionResult");
  result.className = `question-result ${isCorrect ? "correct" : "needs-work"}`;
  result.innerHTML = isCorrect
    ? "Correct."
    : `Not quite. ${escapeHtml(question.explanation)}<br><button class="primary-button continue-button" id="continueAfterWrong" type="button">Continue</button>`;

  if (isCorrect) {
    setTimeout(render, 650);
  } else {
    const continueButton = document.querySelector("#continueAfterWrong");
    continueButton.addEventListener("click", render);
    const continueOnEnter = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      document.removeEventListener("keydown", continueOnEnter);
      render();
    };
    document.addEventListener("keydown", continueOnEnter);
    continueButton.focus();
  }
}

async function submitBatch() {
  setBusy("Saving batch answers...");
  const batch = getActiveBatch();
  const response = await fetchJson("/api/submit-batch", {
    sessionId: state.session.id,
    batchNumber: batch.batchNumber,
    answers: batch.answers,
  });
  if (!response.ok) {
    setBusy("Could not save batch.");
    return;
  }
  state.session = response.session;
  saveLocalSession();
  render();
}

function renderBreak() {
  const panel = document.querySelector("#breakPanel");
  panel.hidden = false;
  document.querySelector("#questionStack").innerHTML = `
    <article class="question-card single-question">
      <p class="eyebrow">Break</p>
      <h3>Take a real break before the next batch.</h3>
      <p class="muted">When the timer finishes, the app sends the previous batch answers to generate the next 10 questions.</p>
    </article>
  `;
  const minutes = state.session.breakMinutes || 5;
  state.breakTotal = minutes * 60;
  state.breakRemaining = state.breakRemaining || state.breakTotal;
  updateBreakTimer();
}

function startBreakTimer() {
  clearInterval(state.breakInterval);
  state.breakInterval = setInterval(() => {
    state.breakRemaining = Math.max(0, state.breakRemaining - 1);
    updateBreakTimer();
    if (state.breakRemaining === 0) {
      clearInterval(state.breakInterval);
      state.breakInterval = null;
      state.breakRemaining = 0;
      generateNextBatch();
    }
  }, 1000);
}

function updateBreakTimer() {
  const minutes = Math.floor(state.breakRemaining / 60).toString().padStart(2, "0");
  const seconds = (state.breakRemaining % 60).toString().padStart(2, "0");
  const percent = state.breakTotal ? Math.round((state.breakRemaining / state.breakTotal) * 100) : 100;
  document.querySelector("#breakTimer").textContent = `${minutes}:${seconds}`;
  document.querySelector("#breakPercent").textContent = `${percent}%`;
  document.querySelector(".timer-ring").style.background = `conic-gradient(var(--green) ${percent * 3.6}deg, #edf1f4 0deg)`;
}

async function generateNextBatch() {
  setBusy("Generating the next batch from saved answers...");
  const response = await fetchJson("/api/next-batch", { sessionId: state.session.id });
  if (!response.ok) {
    setBusy("Could not generate next batch.");
    return;
  }
  state.session = response.session;
  state.breakRemaining = 0;
  saveLocalSession();
  render();
}

function getActiveBatch() {
  if (!state.session?.batches?.length) return null;
  return state.session.batches[state.session.batches.length - 1];
}

function getBatchCorrect(batch) {
  if (!batch) return 0;
  return batch.answers.filter((answer) => answer?.isCorrect).length;
}

async function renderHistory() {
  const list = document.querySelector("#historyList");
  if (!list || list.dataset.loading === "true") return;
  list.dataset.loading = "true";
  const response = await fetch("/api/history");
  const data = response.ok ? await response.json() : { sessions: [] };
  list.innerHTML = data.sessions.length
    ? data.sessions
        .map((session) => {
          const answered = session.batches.reduce((sum, batch) => sum + batch.answers.filter(Boolean).length, 0);
          const correct = session.batches.reduce((sum, batch) => sum + batch.answers.filter((answer) => answer?.isCorrect).length, 0);
          return `<article class="history-item"><strong>${new Date(session.createdAt).toLocaleString()}</strong><span>${session.status} · ${correct}/${answered || 0} correct · ${session.batches.length} batches</span></article>`;
        })
        .join("")
    : `<p class="muted">No saved sessions yet.</p>`;
  list.dataset.loading = "false";
}

function renderVisual(visual) {
  if (!visual || visual.type !== "triangles") return "";
  const count = Number(visual.count || 3);
  const shapes = Array.from({ length: count })
    .map((_, index) => {
      const x = 18 + (index % 5) * 58;
      const y = 18 + Math.floor(index / 5) * 52;
      return `<polygon points="${x},${y + 38} ${x + 24},${y} ${x + 48},${y + 38}" />`;
    })
    .join("");
  return `<svg class="visual-question" viewBox="0 0 320 130" role="img" aria-label="Triangle counting picture">${shapes}</svg>`;
}

function setBusy(message) {
  document.querySelector("#coachTitle").textContent = "Working";
  document.querySelector("#coachMessage").textContent = message;
}

async function fetchJson(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok ? { ok: true, ...(await response.json()) } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function tomorrowString() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function isPastDate(dateString) {
  return String(dateString) < todayString();
}

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector("#saveDayPlan").addEventListener("click", saveDayPlan);
document.querySelector("#planDate").addEventListener("change", loadDayPlanForDate);
document.querySelector("#startSession").addEventListener("click", startSession);
document.querySelector("#startBreak").addEventListener("click", startBreakTimer);
document.querySelector("#skipBreak").addEventListener("click", generateNextBatch);
document.querySelector("#refreshHistory").addEventListener("click", renderHistory);
document.querySelector("#resetSession").addEventListener("click", () => {
  state.session = null;
  state.breakRemaining = 0;
  clearInterval(state.breakInterval);
  saveLocalSession();
  render();
});
document.querySelector("#problemImage").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.selectedImageDataUrl = String(reader.result || "");
    document.querySelector("#imageStatus").textContent = `Loaded ${file.name}.`;
  };
  reader.readAsDataURL(file);
});

document.querySelector("#planDate").value = tomorrowString();
loadDayPlanForDate();
loadPlanList();
render();
