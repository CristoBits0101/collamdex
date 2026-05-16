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
- Cancelacion de generacion.
- Comandos de editor:
  - explicar seleccion,
  - proponer fix,
  - generar tests,
  - revisar archivo activo,
  - ejecutar tarea del agente.
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

## Arquitectura

```text
src/
  agent/      Runtime agente y permisos.
  capacity/   Estimacion de memoria y politica de capacidad.
  commands/   Registro de comandos VS Code.
  config/     Settings de la extension.
  ollama/     Cliente REST y modelos Ollama.
  webview/    Panel lateral Collamdex.
  workspace/  Contexto del editor, diagnosticos y preview.
```
