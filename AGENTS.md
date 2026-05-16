# AGENTS.md

## Proposito del proyecto

Collamdex es una extension de VS Code orientada a codificacion local-first. Su objetivo es permitir que un usuario converse con un modelo local de Ollama, inspeccione el contexto del workspace/editor y reciba cambios revisables antes de escribir en disco.

La logica de negocio principal es:

- Mantener todo el flujo de IA en la maquina del usuario.
- Usar modelos instalados en Ollama, sin depender de servicios externos.
- Enviar al modelo contexto acotado del editor, diagnosticos y archivos clave del workspace.
- Mostrar streaming de la respuesta en el panel lateral y en el canal de salida.
- Convertir propuestas del modelo en cambios aplicables solo con confirmacion del usuario.
- Proteger el workspace evitando escrituras o comandos automaticos sin accion explicita.

## Stack tecnologico

- TypeScript estricto con `moduleResolution: NodeNext`.
- VS Code Extension API.
- `WebviewViewProvider` para el panel lateral `collamdex.chatView`.
- VS Code Chat Participant API para `@collamdex`.
- Ollama REST API local.
- `fetch` nativo de Node/VS Code para HTTP.
- `esbuild` para empaquetar en `dist/extension.js`.
- `pnpm` como package manager.
- `vsce` para generar paquetes `.vsix`.

## Protocolos y APIs de comunicacion

### Extension <-> Ollama

Collamdex habla con Ollama mediante HTTP local. La URL base configurable por defecto es:

```text
http://localhost:11434/api
```

Endpoints usados:

- `GET /api/tags`: health check y listado de modelos locales.
- `GET /api/ps`: listado de modelos cargados en memoria.
- `POST /api/chat`: chat streaming en formato NDJSON.

El cliente principal vive en `src/ollama/ollama-client.ts`. El stream se lee linea a linea como NDJSON y cada `message.content` se envia al UI como token incremental.

### Extension <-> Webview

El panel lateral usa `webview.postMessage` y `webview.onDidReceiveMessage`.

Mensajes del webview hacia la extension:

- `ready`
- `refreshModels`
- `selectModel`
- `setModel`
- `testModels`
- `sendPrompt`
- `cancel`
- `applyPendingChanges`
- `discardPendingChanges`

Mensajes de la extension hacia el webview:

- `state`
- `busy`
- `user-message`
- `assistant-start`
- `assistant-token`
- `activity`
- `activity-complete`
- `patch-summary`
- `pending-changes`
- `patch-result`
- `model-test-result`
- `error`

El HTML, CSS y JavaScript embebido del webview estan en `src/webview/chat-view-html.ts`. El proveedor que orquesta el flujo esta en `src/webview/chat-view-provider.ts`.

### Extension <-> VS Code

La extension registra comandos en `src/commands/register-commands.ts`:

- Abrir chat/panel.
- Seleccionar y refrescar modelos.
- Probar modelos locales.
- Explicar seleccion.
- Proponer fix.
- Generar tests.
- Revisar archivo activo.
- Ejecutar una tarea del agente.
- Cancelar generacion.

Tambien registra el participante nativo `@collamdex` en `src/chat/native-chat-participant.ts`.

## Flujo del agente local

1. El usuario envia una tarea desde el webview o desde un comando.
2. `AgentRuntime` asegura que haya un modelo seleccionado.
3. Se comprueba que Ollama responda.
4. Se construye un prompt con:
   - tarea del usuario,
   - permisos declarados,
   - herramientas soportadas,
   - contexto del editor activo,
   - resumen del workspace,
   - diagnosticos visibles.
5. `OllamaClient.streamChat` envia la peticion a `/api/chat`.
6. Los tokens se muestran en tiempo real.
7. Si la respuesta contiene cambios aplicables, se abre preview y se espera confirmacion.
8. Solo tras confirmacion se escribe en el workspace.

## Formatos de cambios aplicables

El formato preferido es un diff unificado aplicable con `git apply`:

```diff
diff --git a/ruta/archivo.ts b/ruta/archivo.ts
--- a/ruta/archivo.ts
+++ b/ruta/archivo.ts
@@ -1,1 +1,1 @@
-valor anterior
+valor nuevo
```

Para operaciones de archivo completas, Collamdex tambien entiende bloques JSON estructurados:

```collamdex-files
[
  {
    "operation": "write",
    "path": "ruta/archivo.ts",
    "content": "contenido completo del archivo\n"
  },
  {
    "operation": "delete",
    "path": "ruta/archivo-obsoleto.ts"
  }
]
```

Operaciones soportadas:

- `write`, `create`, `edit`, `update`: escriben el contenido completo del archivo.
- `delete`, `remove`, `unlink`: eliminan un archivo.

Las rutas deben ser relativas al workspace. Rutas absolutas o con escape fuera del workspace deben rechazarse.

## Seguridad de escritura

- El modelo no debe escribir directamente sin confirmacion.
- El webview debe mostrar un resumen de archivos afectados y botones de aplicacion.
- Los patches se aplican con `git apply --check` antes de `git apply`.
- Las operaciones JSON validan que cada ruta permanezca dentro del workspace.
- No se deben ejecutar comandos destructivos generados por el modelo.
- Si una tarea requiere terminal, el agente debe proponer comandos revisables, no ejecutarlos sin una implementacion explicita de confirmacion.

## Estructura del codigo

```text
src/
  agent/      Runtime del agente, prompt, permisos y catalogo de herramientas.
  capacity/   Estimacion de memoria y politica de capacidad de modelos.
  chat/       Participante nativo de VS Code Chat.
  commands/   Registro de comandos de VS Code.
  config/     Lectura de settings `collamdex.*`.
  ollama/     Cliente REST y tipos de Ollama.
  status-bar/ Selector visible de modelo.
  webview/    Panel lateral Collamdex.
  workspace/  Contexto del editor, diagnosticos y preview/aplicacion de cambios.
```

## Comandos de desarrollo

```powershell
corepack pnpm install
corepack pnpm run check
corepack pnpm run vsce:package
```

`pnpm run check` ejecuta typecheck y bundle de produccion.

## Convenciones para agentes

- Mantener cambios pequenos y coherentes con la arquitectura existente.
- Preferir APIs de VS Code y helpers locales antes de introducir dependencias.
- No usar APIs, patrones ni codigo deprecado; si no hay alternativa razonable, documentar el motivo y acotar su uso.
- No ampliar permisos de escritura/terminal sin una confirmacion clara en UI.
- Actualizar prompts y documentacion cuando se anada un formato de accion nuevo.
- Validar con `pnpm run check` tras cambios de TypeScript.
