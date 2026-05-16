# Collamdex

## Autores

- Cristo Suárez

Agente de codificacion local-first para VS Code con Ollama.

Collamdex es una extension de VS Code independiente. Usa la API local de Ollama para conversar con modelos instalados en tu maquina, inspeccionar el contexto del editor y proponer cambios con preview antes de escribir.

## Stack

- TypeScript
- VS Code Extension API
- WebviewViewProvider
- Ollama REST API
- esbuild
- pnpm
- vsce

## Requisitos

- Node.js 20 o superior.
- pnpm 9.15.4 via Corepack.
- VS Code 1.90 o superior.
- Ollama instalado y ejecutandose localmente.
- Al menos un modelo local instalado, por ejemplo:

```powershell
ollama pull qwen2.5-coder:7b
```

## Desarrollo

```powershell
corepack pnpm install
corepack pnpm run check
```

Para ejecutar en Extension Development Host:

1. Abre `C:\Workspace\collamdex\collamdex.code-workspace`.
2. Ejecuta la tarea `Run Collamdex Extension` desde Debug.

## Empaquetado

```powershell
corepack pnpm run vsce:package
```

Esto genera un `.vsix` instalable en VS Code.

## Funciones MVP

- Activity Bar propia: Collamdex.
- Panel lateral con chat local.
- Participante nativo en VS Code Chat: `@collamdex`.
- Selector de modelos Ollama instalados.
- Selector visible en la barra de estado: `Collamdex: <modelo>`.
- Health check de Ollama.
- Streaming de respuestas.
- Indicador animado de pensamiento/respuesta con reloj y contadores de lineas `+`/`-`.
- Ejecucion de tareas del agente desde el panel lateral con estado visible mientras trabaja.
- Preview de patches detectados y aplicacion con confirmacion mediante `git apply`.
- Animacion por archivo para patches: creando, editando o eliminando con ruta azul y contadores verdes/rojos.
- Prueba de modelos Ollama contra el contexto real del proyecto con medicion de primer token, total y tokens/segundo.
- Cancelacion de generacion.
- Comandos de editor:
  - explicar seleccion,
  - proponer fix,
  - generar tests,
  - revisar archivo activo,
  - ejecutar tarea del agente.
- Comando de diagnostico:
  - probar modelos de Ollama.
- Control conservador de capacidad segun RAM y tamano real del modelo.

## Ubicacion del chat

VS Code permite que una extension contribuya vistas a la Activity Bar/Sidebar o al Panel. La Secondary Sidebar no es un destino directo de contribucion en `package.json`, pero el usuario puede arrastrar el contenedor Collamdex a la barra lateral derecha.

Para trabajar en una ventana tipo Chat:

1. Abre el panel nativo Chat de VS Code.
2. Escribe `@collamdex` y la tarea.
3. Selecciona el modelo desde `Collamdex: Seleccionar modelo` o desde el panel Collamdex.

Tambien puedes hacer clic en la barra de estado, donde aparece `Collamdex: <modelo>` o `Collamdex: elegir modelo`.

Si ves "Preguntar a Codex", estas en la vista de otra extension o en el placeholder por defecto de VS Code. Collamdex no reemplaza ese texto. Para usar Collamdex en esa vista, invocalo explicitamente con `@collamdex`.

## Modelos Ollama

Collamdex lista todos los modelos instalados localmente mediante la API `/api/tags`, equivalente a `ollama list`.

Ejemplo en esta maquina:

```text
qwen3-vl:30b
qwen2.5vl:3b
nomic-embed-text:latest
qwen2.5:7b
llama3.2:3b
```

La libreria online de Ollama no se descarga ni se lista entera dentro de la extension. Para usar un modelo nuevo:

```powershell
ollama pull qwen2.5-coder:7b
```

Despues ejecuta `Collamdex: Refrescar modelos de Ollama`.

## Configuracion

```json
{
  "collamdex.ollama.baseUrl": "http://localhost:11434/api",
  "collamdex.generation.keepAlive": "30s",
  "collamdex.generation.numCtx": 4096,
  "collamdex.generation.temperature": 0.2,
  "collamdex.hardware.maxSystemRamRatio": 0.65,
  "collamdex.safety.maxPromptChars": 60000
}
```

## Estructura del proyecto

```text
src/
  agent/
    agent-loop.ts
    agent-permissions.ts
    agent-state.ts
    tool-call-parser.ts
    tool-registry.ts
  capacity/
    capacity-policy.ts
    hardware-profiler.ts
    model-capacity-estimator.ts
  chat/
    native-chat-participant.ts
  commands/
    register-commands.ts
  config/
    extension-config.ts
  ollama/
    ollama-client.ts
    ollama-model-service.ts
    ollama-types.ts
  status-bar/
    model-status-bar.ts
  webview/
    chat-view-html.ts
    chat-view-provider.ts
  workspace/
    active-editor-context.ts
    diagnostics-context.ts
    patch-preview-service.ts
  extension.ts
```

### Responsabilidad de cada archivo

| Archivo | Funcion |
| --- | --- |
| `src/extension.ts` | Punto de entrada de la extension. Crea servicios compartidos, registra el webview, comandos, participante de chat y health check inicial de Ollama. |
| `src/agent/agent-loop.ts` | Runtime principal del agente. Selecciona modelo, prepara contexto, llama a Ollama en streaming, emite progreso y gestiona previews/aplicacion de cambios. |
| `src/agent/agent-permissions.ts` | Define permisos conservadores del agente: lectura permitida, escritura y terminal sin confirmacion desactivadas. |
| `src/agent/agent-state.ts` | Tipos compartidos para acciones, eventos de progreso, opciones de ejecucion y resultado de una tarea. |
| `src/agent/tool-call-parser.ts` | Parser de bloques `collamdex-tool` en JSON para detectar llamadas estructuradas propuestas por el modelo. |
| `src/agent/tool-registry.ts` | Catalogo declarativo de herramientas que se anuncian al modelo y si requieren confirmacion. |
| `src/capacity/capacity-policy.ts` | Politica que decide si un modelo es recomendado, aviso o bloqueado segun RAM disponible configurada. |
| `src/capacity/hardware-profiler.ts` | Lee RAM total/libre del sistema y la normaliza a GB. |
| `src/capacity/model-capacity-estimator.ts` | Estima huella de memoria de un modelo a partir de tamano en disco, parametros y reserva de contexto. |
| `src/chat/native-chat-participant.ts` | Registra el participante nativo `@collamdex` en VS Code Chat y conecta sus respuestas con `AgentRuntime`. |
| `src/commands/register-commands.ts` | Registra comandos de VS Code para abrir el panel, seleccionar/probar modelos y lanzar acciones del editor. |
| `src/config/extension-config.ts` | Lee y normaliza los settings `collamdex.*` desde la configuracion de VS Code. |
| `src/ollama/ollama-client.ts` | Cliente HTTP de Ollama. Ejecuta `/tags`, `/ps`, `/chat`, lee NDJSON y calcula metricas de streaming. |
| `src/ollama/ollama-model-service.ts` | Gestiona modelo seleccionado, persistencia en `globalState`, listado de modelos y Quick Pick de seleccion. |
| `src/ollama/ollama-types.ts` | Tipos TypeScript de modelos, respuestas y chunks de la API de Ollama. |
| `src/status-bar/model-status-bar.ts` | Muestra el selector de modelo en la barra de estado y lo actualiza al cambiar la seleccion. |
| `src/webview/chat-view-html.ts` | HTML, CSS y JavaScript embebido del panel lateral, incluida UI de chat, actividad y confirmacion de cambios. |
| `src/webview/chat-view-provider.ts` | Orquesta mensajes entre webview y extension: modelos, prompts, cancelacion, pruebas y cambios pendientes. |
| `src/workspace/active-editor-context.ts` | Extrae ruta, lenguaje, seleccion y contenido acotado del editor activo. |
| `src/workspace/diagnostics-context.ts` | Resume diagnosticos visibles de VS Code para incluirlos en el prompt. |
| `src/workspace/patch-preview-service.ts` | Detecta diffs y bloques `collamdex-files`, abre previews y aplica cambios confirmados con `git apply` o escrituras validadas. |

## Costes, licencias y servicios externos

Collamdex no requiere GitHub Copilot, tokens de OpenAI ni APIs cloud de Microsoft. En ejecucion normal usa APIs locales de VS Code y Ollama local.

### Gratis dentro de VS Code

| Comunicacion o accion | Coste para Collamdex | Notas |
| --- | --- | --- |
| Registrar comandos, Activity Bar, Sidebar/Webview, Status Bar y Output Channel | Sin coste adicional | Forma parte de la VS Code Extension API. |
| Mensajes extension-webview con `postMessage` | Sin coste adicional | Comunicacion local dentro de la ventana de VS Code. |
| Leer editor activo, seleccion, archivos del workspace y diagnosticos | Sin coste adicional | Usa APIs locales de VS Code; Collamdex limita el contexto enviado al modelo. |
| Participante nativo `@collamdex` en VS Code Chat | Sin coste adicional de Copilot | El participante llama al runtime propio de Collamdex y a Ollama local, no a GitHub Copilot. |
| Abrir previews Markdown/diff y mostrar confirmaciones | Sin coste adicional | No escribe hasta que el usuario confirma. |
| Aplicar diffs con `git apply` o escrituras `collamdex-files` | Sin coste adicional de VS Code | Requiere Git disponible y confirmacion del usuario; las rutas se validan dentro del workspace. |
| Empaquetar `.vsix` con `vsce package` | Sin coste adicional de VS Code | Las herramientas de desarrollo tienen sus propias licencias open source. |

### Puede requerir cuenta, pago o revisar licencia

| Elemento | Cuando aplica | Condicion |
| --- | --- | --- |
| Visual Studio Code | Siempre que se use VS Code | VS Code se puede usar gratis, pero esta bajo los terminos de licencia de Microsoft. Code - OSS es MIT, el producto VS Code tiene licencia propia. |
| Marketplace de VS Code | Solo si se publica la extension | Publicar requiere cuenta Microsoft/Azure DevOps, Personal Access Token, crear publisher y aceptar los terminos del Marketplace. |
| Extensiones de terceros | Solo si el usuario instala otras extensiones | Cada extension tiene su propia licencia; Collamdex no las incorpora. |
| GitHub Copilot o servicios de IA de VS Code | Solo si el usuario los usa aparte | Collamdex no depende de Copilot. Cualquier coste o licencia de Copilot es externo a este proyecto. |
| Ollama local | Para ejecutar modelos en la maquina del usuario | No hay coste por token en local, pero consume CPU/GPU/RAM, disco y electricidad del usuario. |
| Modelos descargados con Ollama | Cada vez que se instala o usa un modelo | Cada modelo puede tener licencia propia, incluidas restricciones comerciales o de redistribucion. Hay que revisar la ficha/licencia del modelo concreto. |
| Ollama Cloud | Solo si se usan modelos cloud de Ollama | Requiere cuenta de Ollama y esta sujeto a limites o planes de pago. Collamdex esta pensado para `http://localhost:11434/api`. |
| Entornos remotos como Codespaces, SSH remoto o maquinas cloud | Solo si el usuario decide ejecutarlo alli | El coste depende del proveedor o infraestructura elegida; no es requisito de Collamdex. |
