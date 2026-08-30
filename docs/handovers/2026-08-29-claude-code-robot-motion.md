# Handoff para Claude Code — Donald Robot Motion

Este documento permite abrir Claude Code en una sesión nueva y continuar sin reconstruir el contexto. La especificación y el plan enlazados son la autoridad; este archivo es el mapa de entrada.

## Cómo abrir la sesión correcta

En PowerShell:

```powershell
Set-Location 'C:\Users\medro\Documents\_PERSONAL_PROJECTS\donald-robot-motion'
git status --short --branch
claude --model opus --effort high --permission-mode acceptEdits --name donald-robot-motion
```

Después pega el prompt completo de la última sección.

No hace falta crear otro worktree: este ya es el worktree aislado correcto.

## Estado exacto del repositorio

- Repositorio principal: `C:\Users\medro\Documents\_PERSONAL_PROJECTS\nextwave-donald`
- Worktree de implementación: `C:\Users\medro\Documents\_PERSONAL_PROJECTS\donald-robot-motion`
- Rama: `feat/donald-robot-motion`
- Base: `origin/main` en `79a3f55`
- Spec: commit `b48f3ea` — `docs: define Donald robot motion stage`
- Plan: commit `0834b36` — `docs: plan Donald robot motion implementation`
- No existe todavía implementación del motion system.
- `main` no fue modificado y no debe tocarse, mergearse ni recibir push.
- Las dependencias del frontend ya están instaladas en este worktree con lockfile congelado.

Documentos obligatorios:

1. `docs/superpowers/specs/2026-08-29-donald-robot-motion-design.md`
2. `docs/superpowers/plans/2026-08-29-donald-robot-motion.md`
3. `frontend/AGENTS.md` antes de modificar Next.js.

## Verificación de línea base

Resultados reales antes de implementar:

- `frontend`: `npx.cmd pnpm@10 test` → 31 pruebas aprobadas, 0 fallidas.
- `backend/donald`: `go test ./...` → suite completa aprobada.
- `git diff --check` → sin errores.

En Windows usa `npx.cmd`, no `npx`, porque PowerShell bloquea `npx.ps1` por execution policy.

## Objetivo aprobado por Rodrigo

Donald debe dejar de sentirse como un tablero de cajitas técnicas y convertirse en una historia visual que venda:

- Un solo robot Donald representa toda la corrida.
- El robot viaja por conexiones reales del grafo.
- Cuando lee un archivo, aparece un documento y se escanea.
- Cuando prepara un correo, aparece un sobre; solo sale cuando el runtime confirma éxito.
- Cuando recibe información, entra un sobre y entrega el documento.
- Cuando espera información, Donald se estaciona y el escenario pasa a ámbar.
- Cuando se reanuda el mismo nodo, Donald se reactiva sin viaje falso ni trabajo repetido.
- El dinero aparece grande una sola vez y únicamente desde una métrica tipada real.
- El robot de Mau conserva cara y personalidad, con movimiento premium y controlado.
- Todo texto visible al cliente debe estar en inglés.

No usar confeti, rebotes permanentes, caritas tristes, emojis, sonido, wobble excesivo ni varios robots.

## Arquitectura aprobada

```text
SSE events -> existing reducer -> RunState + event_log
                                  |
                                  v
                           MotionCueAdapter
                                  |
                    +-------------+-------------+
                    v                           v
              RobotStage                 ActivityOverlay
        React Flow graph space           browser screen space
```

Decisiones importantes:

- `RunState` y `event_log` siguen siendo la única verdad del runtime.
- `RobotStage` vive una sola vez dentro de `ViewportPortal`.
- La locomoción comparte la geometría real `getSmoothStepPath` con `runtime-edge`.
- Texto importante y dinero viven en screen space para sobrevivir al zoom.
- El adaptador de movimiento es puro y se prueba sin React.
- Los eventos de negocio nunca se frenan para que una animación alcance a terminar.
- La presentación puede mantener como máximo un cue activo y uno pendiente.
- Sin ruta real: fade en el destino; jamás inventar una conexión.
- Reduced motion muestra los mismos estados finales sin recorrido, scan, loop ni conteo.

## Contrato semántico

El frontend no puede decidir animaciones buscando palabras como `invoice`, `email`, `USD` o nombres de capabilities.

`report_progress` se ampliará de forma compatible con metadata opcional:

```json
{
  "activity": {
    "kind": "document.read",
    "phase": "started",
    "object": { "kind": "document", "label": "Commercial invoice" },
    "copy": "Reading the commercial invoice"
  },
  "metric": {
    "kind": "currency",
    "value": 15765,
    "currency": "USD",
    "label": "Duties and fees"
  }
}
```

Kinds soportados:

- `document.read`
- `message.send`
- `message.receive`
- `data.check`
- `calculate`
- `submit`

Sin cue explícito: `work.generic`. Sin métrica tipada: no hay animación monetaria.

El backend debe transportar estos datos usando el `detail` JSON existente. No editar archivos generados bajo `backend/donald/entity/agent_event_payload/`.

## Robot de Mau

Fuente autorizada:

- Commit: `91eb8ca`
- Importar solamente: `frontend/public/donald-pet/donald-default.webp`
- Asset: WebP 168×260 con transparencia.

No cherry-pickear el commit completo. No importar:

- la página estática de Mau;
- `capabilityPetAssets`;
- `action-impact.ts`;
- benchmarks o ROI hardcodeado;
- `ingest.webp`, porque es un duplicado byte por byte;
- timers o handoffs del prototipo.

El prototipo de Mau no contiene locomoción real: `isMoving` solo cambia glow. La nueva implementación debe construir el recorrido real sobre el grafo.

## Nauta Use Case 02

Caso principal: `nauta-dummy/nauta_agent_blocked_on_data.md`.

Historia para pitch:

1. Donald recibe el aviso del embarque.
2. Lee shipment notice y packing list.
3. Busca la commercial invoice y no la encuentra.
4. Pide el documento al proveedor.
5. Espera de forma segura en ámbar.
6. Llega la factura.
7. Reanuda exactamente el mismo nodo.
8. Verifica valores y calcula duties.
9. Muestra la cifra tipada en USD.
10. Envía el customs entry y termina.

La versión pitch debe durar aproximadamente 60–90 segundos. El escenario largo se conserva como regresión. Cada demo inicia con un run key nuevo y un grafo vacío; jamás se reusa una corrida previa.

## Orden obligatorio de implementación

Seguir el plan commiteado sin saltarse tareas:

1. Preservar estados blocked/resumed verdaderos.
2. Transportar semantic cues por MCP.
3. Derivar el motion model puro.
4. Renderizar un robot en graph space.
5. Agregar props de documento, correo, espera, dinero y finalización.
6. Mejorar jerarquía visual para pitch/proyector.
7. Convertir Nauta 02 en el demo local pulido.
8. Verificación end-to-end.
9. Dos revisiones adversariales y hardening.

Cada tarea usa red-green-refactor:

1. escribir la prueba que falla;
2. ejecutarla y confirmar el fallo esperado;
3. implementar lo mínimo;
4. ejecutar suite completa relevante;
5. hacer review de spec y calidad;
6. commit convencional atómico en inglés.

Claude puede usar subagentes, pero cada uno recibe ownership de archivos no traslapados y debe saber que no está solo en el repo. El integrador revisa cada diff y ejecuta las suites; nunca confía únicamente en el reporte del subagente.

## Gates finales

```powershell
Set-Location 'C:\Users\medro\Documents\_PERSONAL_PROJECTS\donald-robot-motion\frontend'
npx.cmd pnpm@10 test
npx.cmd tsc --noEmit
npx.cmd pnpm@10 build

Set-Location 'C:\Users\medro\Documents\_PERSONAL_PROJECTS\donald-robot-motion\backend\donald'
go test ./...

Set-Location 'C:\Users\medro\Documents\_PERSONAL_PROJECTS\donald-robot-motion'
git diff --check
git status --short --branch
git log --oneline origin/main..HEAD
```

Después verificar en navegador a 1366×768 y con reduced motion.

Las revisiones adversariales finales son independientes:

- Pitch/product: intenta demostrar que no se entiende en cinco segundos o que no vende.
- Runtime/accessibility: intenta demostrar que inventa estado, repite eventos, rompe rutas, falla con bursts o reduced motion.

Todo hallazgo blocking/high requiere prueba de regresión antes del fix y re-review posterior.

## Donald live graph

- Run key: `donald-robot-motion-design-20260829`
- Watch URL: `https://donald.todes.mx/runs/donald-robot-motion-design-20260829`

Si el MCP Donald está disponible, reanuda esa misma corrida, llama `get_graph` antes de reportar y continúa desde el nodo existente. No llames `start_run` con otra key ni redeclares el plan.

---

# PROMPT PARA PEGAR EN CLAUDE CODE

```text
Trabaja como integrador principal del Donald Robot Motion Stage.

Estás en el worktree C:\Users\medro\Documents\_PERSONAL_PROJECTS\donald-robot-motion, rama feat/donald-robot-motion, creada desde origin/main. No cambies de rama, no modifiques main, no hagas merge, rebase ni push. Preserva cualquier cambio del usuario y nunca uses reset --hard. Código, UI y commits en inglés; habla con Rodrigo en español.

Antes de editar:
1. Lee completamente los AGENTS.md aplicables.
2. Lee docs/superpowers/specs/2026-08-29-donald-robot-motion-design.md.
3. Lee docs/superpowers/plans/2026-08-29-donald-robot-motion.md.
4. Inspecciona git status, git log --oneline origin/main..HEAD y confirma que existen b48f3ea y 0834b36.
5. Verifica la línea base con npx.cmd pnpm@10 test en frontend y go test ./... en backend/donald.

La dirección de producto ya está aprobada; no abras otro brainstorming ni rediseñes el alcance. Construye un solo robot Donald dentro de React Flow ViewportPortal. Debe recorrer únicamente conexiones reales, usar el asset de Mau desde commit 91eb8ca, mostrar props de documento/correo/espera/dinero/finalización, mantener waiting en ámbar y reservar rojo para fallas. No importes la página estática, capability maps, action-impact, benchmarks, ROI hardcodeado ni el asset ingest duplicado.

Las animaciones de actividad y dinero deben provenir exclusivamente de cues estructurados. Nunca infieras actividad desde texto, node_key, labels, artifacts o regex de USD. Eventos sin cue usan work.generic. El reducer sigue recibiendo eventos inmediatamente; ninguna animación controla negocio ni inventa progreso. Respeta reduced motion.

Ejecuta docs/superpowers/plans/2026-08-29-donald-robot-motion.md tarea por tarea empezando por Task 1, la primera incompleta. Usa TDD estricto: prueba roja, fallo observado, implementación mínima, suite verde, review y commit atómico. No escribas toda la feature en un commit gigante. Usa subagentes para trabajo independiente con ownership explícito y revisa personalmente cada diff. No permitas que dos agentes editen los mismos archivos.

Antes de cambiar App Router o Route Handlers, lee la documentación instalada de Next.js 16 bajo frontend/node_modules/next/dist/docs/. No añadas dependencias. No edites archivos generados de agent_event_payload; transporta activity/metric mediante el detail JSON existente como especifica el plan.

Después de cada tarea reporta: archivos cambiados, prueba que falló primero, comandos verdes reales, commit hash y riesgos. Continúa mientras sea seguro y el plan tenga trabajo ejecutable. Al final ejecuta test, typecheck, build, Go suite, git diff --check y browser QA a 1366×768 más reduced motion. Lanza dos revisores adversariales independientes —pitch/product y runtime/accessibility—, corrige findings blocking/high con prueba de regresión y pide re-review.

Si Donald MCP está disponible, retoma run_key donald-robot-motion-design-20260829, llama get_graph y continúa los nodos existentes sin reiniciar ni redeclarar el plan.

Empieza ahora: valida el repo y ejecuta Task 1. No me pidas repetir contexto que ya está en la spec o el plan. Solo detente si descubres una decisión que cambie materialmente el diseño aprobado o requiera autoridad nueva.
```
