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
      grid-template-rows: auto auto 1fr auto;
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
      <div class="actions">
        <button id="refreshButton" class="secondary">Refrescar</button>
        <button id="selectButton" class="secondary">Quick Pick</button>
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
    let assistantMessage;

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
      modelSelect.disabled = isBusy;
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

      if (message.type === "busy") {
        setBusy(message.value);
      }

      if (message.type === "assistant-start") {
        assistantMessage = addMessage("Collamdex", "");
      }

      if (message.type === "assistant-token" && assistantMessage) {
        assistantMessage.textContent += message.token;
        messagesEl.scrollTop = messagesEl.scrollHeight;
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

    selectButton.addEventListener("click", () => {
      vscode.postMessage({ type: "selectModel" });
    });

    modelSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "setModel", model: modelSelect.value });
    });

    vscode.postMessage({ type: "ready" });
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
