import * as vscode from "vscode";

export function getChatViewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const cspSource = webview.cspSource;
  const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "collamdex.svg"));

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Collamdex</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }

    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0;
      padding: 0;
    }

    .app {
      display: grid;
      gap: 12px;
      grid-template-rows: auto auto auto 1fr auto;
      height: 100vh;
      padding: 12px;
      box-sizing: border-box;
    }

    .header {
      align-items: center;
      display: flex;
      gap: 8px;
      min-width: 0;
    }

    .header img {
      height: 20px;
      width: 20px;
    }

    .title {
      font-weight: 700;
    }

    .status {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .controls {
      display: grid;
      gap: 8px;
    }

    select,
    textarea,
    button {
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      box-sizing: border-box;
      font-family: inherit;
      font-size: inherit;
      width: 100%;
    }

    select,
    textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 8px;
    }

    textarea {
      min-height: 82px;
      resize: vertical;
    }

    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      padding: 8px;
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    .actions {
      display: grid;
      gap: 8px;
      grid-template-columns: 1fr 1fr;
    }

    .actions.three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .activity {
      align-items: center;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      display: grid;
      gap: 10px;
      grid-template-columns: auto 1fr;
      min-height: 58px;
      padding: 8px;
    }

    .activity.is-hidden {
      display: none;
    }

    .activity-pulse {
      animation: pulse 1s ease-in-out infinite;
      background: var(--vscode-progressBar-background);
      border-radius: 999px;
      height: 10px;
      width: 10px;
    }

    .activity.complete .activity-pulse {
      animation: none;
      opacity: 0.7;
    }

    .activity-main {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .activity-top {
      align-items: baseline;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      min-width: 0;
    }

    .activity-phase {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .activity-detail {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .activity-meters {
      align-items: center;
      color: var(--vscode-descriptionForeground);
      display: flex;
      flex-wrap: wrap;
      font-size: 12px;
      gap: 8px;
    }

    .file-changes {
      display: grid;
      gap: 4px;
      max-height: 112px;
      overflow: hidden;
    }

    .file-changes:empty {
      display: none;
    }

    .file-change {
      align-items: center;
      animation: fileChangeIn 360ms ease both;
      border-left: 2px solid var(--vscode-textLink-foreground);
      display: grid;
      gap: 6px;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      min-height: 22px;
      padding: 2px 0 2px 6px;
    }

    .file-op {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .file-path {
      color: var(--vscode-textLink-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-count {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .file-count.added {
      color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
    }

    .file-count.removed {
      color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
    }

    .rolling-value {
      align-items: center;
      display: inline-flex;
      font-variant-numeric: tabular-nums;
      gap: 1px;
      line-height: 1;
      white-space: nowrap;
    }

    .digit-window {
      display: inline-block;
      height: 1.15em;
      overflow: hidden;
      width: 0.68em;
    }

    .digit-stack {
      display: grid;
      transform: translateY(calc(var(--digit, 0) * -1.15em));
      transition: transform 220ms ease;
    }

    .static-char {
      display: inline-block;
      min-width: 0.35em;
      text-align: center;
    }

    .progress-track {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 999px;
      height: 3px;
      overflow: hidden;
    }

    .progress-bar {
      background: var(--vscode-progressBar-background);
      height: 100%;
      transform-origin: left center;
      transition: width 260ms ease;
      width: 0%;
    }

    .activity.reverse .progress-bar {
      transform-origin: right center;
    }

    .messages {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: auto;
      padding: 8px;
    }

    .message {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 8px 0;
      white-space: pre-wrap;
    }

    .message:last-child {
      border-bottom: 0;
    }

    .role {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    @keyframes pulse {
      0% {
        opacity: 0.35;
        transform: scale(0.82);
      }

      50% {
        opacity: 1;
        transform: scale(1.2);
      }

      100% {
        opacity: 0.35;
        transform: scale(0.82);
      }
    }

    @keyframes fileChangeIn {
      0% {
        opacity: 0;
        transform: translateX(-8px);
      }

      100% {
        opacity: 1;
        transform: translateX(0);
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <section class="header">
      <img src="${iconUri.toString()}" alt="">
      <div>
        <div class="title">Collamdex</div>
        <div id="status" class="status">Inicializando...</div>
      </div>
    </section>

    <section class="controls">
      <select id="modelSelect" aria-label="Modelo Ollama"></select>
      <div class="actions three">
        <button id="refreshButton" class="secondary">Refrescar</button>
        <button id="selectButton" class="secondary">Quick Pick</button>
        <button id="testButton" class="secondary">Probar</button>
      </div>
    </section>

    <section id="activity" class="activity is-hidden" aria-live="polite">
      <div class="activity-pulse"></div>
      <div class="activity-main">
        <div class="activity-top">
          <div id="activityPhase" class="activity-phase">Pensando</div>
          <div id="activityClock" class="rolling-value" aria-label="Tiempo transcurrido"></div>
        </div>
        <div id="activityDetail" class="activity-detail">Preparando modelo...</div>
        <div class="activity-meters">
          <span>+</span><span id="addedCounter" class="rolling-value" aria-label="Lineas agregadas"></span>
          <span>-</span><span id="removedCounter" class="rolling-value" aria-label="Lineas eliminadas"></span>
          <span id="tokenCounter">0 caracteres</span>
        </div>
        <div id="fileChanges" class="file-changes" aria-label="Cambios por archivo"></div>
        <div class="progress-track">
          <div id="progressBar" class="progress-bar"></div>
        </div>
      </div>
    </section>

    <section id="messages" class="messages" aria-live="polite"></section>

    <section class="controls">
      <textarea id="promptInput" placeholder="Describe la tarea para el agente local..."></textarea>
      <div class="actions">
        <button id="sendButton">Enviar</button>
        <button id="cancelButton" class="secondary">Cancelar</button>
      </div>
    </section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const statusEl = document.getElementById("status");
    const modelSelect = document.getElementById("modelSelect");
    const messagesEl = document.getElementById("messages");
    const promptInput = document.getElementById("promptInput");
    const sendButton = document.getElementById("sendButton");
    const cancelButton = document.getElementById("cancelButton");
    const refreshButton = document.getElementById("refreshButton");
    const selectButton = document.getElementById("selectButton");
    const testButton = document.getElementById("testButton");
    const activityEl = document.getElementById("activity");
    const activityPhaseEl = document.getElementById("activityPhase");
    const activityClockEl = document.getElementById("activityClock");
    const activityDetailEl = document.getElementById("activityDetail");
    const addedCounterEl = document.getElementById("addedCounter");
    const removedCounterEl = document.getElementById("removedCounter");
    const fileChangesEl = document.getElementById("fileChanges");
    const tokenCounterEl = document.getElementById("tokenCounter");
    const progressBarEl = document.getElementById("progressBar");
    let assistantMessage;
    let assistantText = "";
    let activityStartedAt = 0;
    let activityTimer;
    let receivedChars = 0;

    function addMessage(role, text) {
      const wrapper = document.createElement("article");
      wrapper.className = "message";
      const roleEl = document.createElement("div");
      roleEl.className = "role";
      roleEl.textContent = role;
      const textEl = document.createElement("div");
      textEl.textContent = text;
      wrapper.append(roleEl, textEl);
      messagesEl.append(wrapper);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return textEl;
    }

    function setBusy(isBusy) {
      sendButton.disabled = isBusy;
      refreshButton.disabled = isBusy;
      selectButton.disabled = isBusy;
      testButton.disabled = isBusy;
      modelSelect.disabled = isBusy;
      cancelButton.disabled = !isBusy;

      if (isBusy) {
        startActivity("Pensando", "Esperando a Ollama...", "forward");
      }
    }

    function startActivity(phase, detail, direction) {
      activityEl.classList.remove("is-hidden", "complete", "reverse");

      if (direction === "reverse") {
        activityEl.classList.add("reverse");
      }

      activityStartedAt = Date.now();
      receivedChars = 0;
      assistantText = "";
      setActivity(phase, detail, direction);
      setRollingValue(activityClockEl, "00:00");
      setRollingValue(addedCounterEl, "000");
      setRollingValue(removedCounterEl, "000");
      fileChangesEl.replaceChildren();
      tokenCounterEl.textContent = "0 caracteres";
      progressBarEl.style.width = "2%";
      clearInterval(activityTimer);
      activityTimer = setInterval(updateActivityClock, 1000);
      updateActivityClock();
    }

    function setActivity(phase, detail, direction) {
      activityPhaseEl.textContent = phase || "Pensando";
      activityDetailEl.textContent = detail || "";

      activityEl.classList.toggle("reverse", direction === "reverse");
    }

    function completeActivity(detail) {
      clearInterval(activityTimer);
      activityTimer = undefined;
      activityEl.classList.add("complete");
      setActivity("Listo", detail || "Respuesta completada.", "forward");
      progressBarEl.style.width = "100%";
    }

    function updateActivityClock() {
      if (!activityStartedAt) {
        return;
      }

      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - activityStartedAt) / 1000));
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      setRollingValue(activityClockEl, padNumber(minutes, 2) + ":" + padNumber(seconds, 2));

      const cycle = elapsedSeconds % 24;
      const width = activityEl.classList.contains("reverse")
        ? 100 - Math.round((cycle / 24) * 92)
        : 8 + Math.round((cycle / 24) * 90);
      progressBarEl.style.width = Math.max(8, Math.min(98, width)) + "%";
    }

    function updateChangeStats(text) {
      let added = 0;
      let removed = 0;
      const lines = text.split("\\n");

      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          added += 1;
        }

        if (line.startsWith("-") && !line.startsWith("---")) {
          removed += 1;
        }
      }

      setRollingValue(addedCounterEl, padNumber(added, 3));
      setRollingValue(removedCounterEl, padNumber(removed, 3));
      tokenCounterEl.textContent = receivedChars + " caracteres";
    }

    function renderPatchSummary(changes) {
      fileChangesEl.replaceChildren();

      if (!Array.isArray(changes) || changes.length === 0) {
        return;
      }

      let added = 0;
      let removed = 0;

      changes.forEach((change, index) => {
        added += Number(change.addedLines) || 0;
        removed += Number(change.removedLines) || 0;

        const row = document.createElement("div");
        row.className = "file-change";
        row.style.animationDelay = String(index * 90) + "ms";

        const operationEl = document.createElement("span");
        operationEl.className = "file-op";
        operationEl.textContent = getOperationLabel(change.operation);

        const pathEl = document.createElement("span");
        pathEl.className = "file-path";
        pathEl.textContent = change.path || "[archivo]";
        pathEl.title = change.path || "";

        const addedEl = document.createElement("span");
        addedEl.className = "file-count added";
        addedEl.textContent = "+" + String(Number(change.addedLines) || 0);

        const removedEl = document.createElement("span");
        removedEl.className = "file-count removed";
        removedEl.textContent = "-" + String(Number(change.removedLines) || 0);

        row.append(operationEl, pathEl, addedEl, removedEl);
        fileChangesEl.append(row);
      });

      setRollingValue(addedCounterEl, padNumber(added, 3));
      setRollingValue(removedCounterEl, padNumber(removed, 3));
      tokenCounterEl.textContent = String(changes.length) + " archivo" + (changes.length === 1 ? "" : "s");
    }

    function getOperationLabel(operation) {
      if (operation === "create") {
        return "Creando";
      }

      if (operation === "delete") {
        return "Eliminando";
      }

      return "Editando";
    }

    function setRollingValue(container, value) {
      const text = String(value);

      if (container._rollingTextLength !== text.length) {
        const cells = [];
        container.replaceChildren();

        for (const char of text) {
          if (/\\d/.test(char)) {
            const windowEl = document.createElement("span");
            const stackEl = document.createElement("span");
            windowEl.className = "digit-window";
            stackEl.className = "digit-stack";

            for (let index = 0; index <= 9; index += 1) {
              const numberEl = document.createElement("span");
              numberEl.textContent = String(index);
              stackEl.append(numberEl);
            }

            windowEl.append(stackEl);
            container.append(windowEl);
            cells.push({ type: "digit", stackEl });
          } else {
            const staticEl = document.createElement("span");
            staticEl.className = "static-char";
            staticEl.textContent = char;
            container.append(staticEl);
            cells.push({ type: "static", staticEl });
          }
        }

        container._rollingCells = cells;
        container._rollingTextLength = text.length;
      }

      const cells = container._rollingCells || [];

      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const cell = cells[index];

        if (!cell) {
          continue;
        }

        if (cell.type === "digit") {
          cell.stackEl.style.setProperty("--digit", char);
        } else {
          cell.staticEl.textContent = char;
        }
      }
    }

    function padNumber(value, size) {
      return String(value).padStart(size, "0");
    }

    function renderState(state) {
      statusEl.textContent = state.statusText;
      modelSelect.innerHTML = "";

      for (const model of state.models) {
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = model.label;
        option.selected = model.name === state.selectedModel;
        modelSelect.append(option);
      }
    }

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "state") {
        renderState(message.state);
      }

      if (message.type === "user-message") {
        addMessage("Tu", message.prompt);
      }

      if (message.type === "busy") {
        setBusy(message.value);
      }

      if (message.type === "activity") {
        activityEl.classList.remove("complete");
        setActivity(message.phase, message.detail, message.direction);
      }

      if (message.type === "activity-complete") {
        completeActivity(message.detail);
      }

      if (message.type === "patch-summary") {
        activityEl.classList.remove("complete");
        setActivity("Aplicando patch", "Preparando cambios por archivo...", "forward");
        renderPatchSummary(message.changes);
      }

      if (message.type === "patch-result") {
        setActivity(
          message.status === "applied" ? "Cambios aplicados" : "Patch en preview",
          message.detail,
          "forward"
        );
      }

      if (message.type === "assistant-start") {
        assistantText = "";
        receivedChars = 0;
        assistantMessage = addMessage("Collamdex", "");
      }

      if (message.type === "assistant-token" && assistantMessage) {
        assistantText += message.token;
        receivedChars += message.token.length;
        assistantMessage.textContent += message.token;
        setActivity("Respondiendo", "Recibiendo tokens del modelo...", "forward");
        updateChangeStats(assistantText);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      if (message.type === "model-test-result") {
        addMessage("Prueba Ollama", message.summary);
      }

      if (message.type === "error") {
        addMessage("Error", message.message);
      }
    });

    sendButton.addEventListener("click", () => {
      const prompt = promptInput.value.trim();

      if (!prompt) {
        return;
      }

      addMessage("Tu", prompt);
      promptInput.value = "";
      vscode.postMessage({ type: "sendPrompt", prompt, model: modelSelect.value });
    });

    cancelButton.addEventListener("click", () => {
      vscode.postMessage({ type: "cancel" });
    });

    refreshButton.addEventListener("click", () => {
      vscode.postMessage({ type: "refreshModels" });
    });

    testButton.addEventListener("click", () => {
      vscode.postMessage({ type: "testModels" });
    });

    selectButton.addEventListener("click", () => {
      vscode.postMessage({ type: "selectModel" });
    });

    modelSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "setModel", model: modelSelect.value });
    });

    vscode.postMessage({ type: "ready" });
    cancelButton.disabled = true;
    setRollingValue(activityClockEl, "00:00");
    setRollingValue(addedCounterEl, "000");
    setRollingValue(removedCounterEl, "000");
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";

  for (let index = 0; index < 32; index += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return text;
}
