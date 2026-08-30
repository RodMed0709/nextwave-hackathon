# Nauta demo scenarios

Eight scenario briefs an agent enacts live, reporting through the `donald-flow` skill to
the Donald MCP server. The graph the audience watches is built from those reports.

| File | Ends | Shows |
|---|---|---|
| `nauta_agent_happy_path.md` | succeeded | Full 12-stage pipeline, parallel EXTRACT, a join, autonomous decision |
| `nauta_agent_blocked_on_data.md` | succeeded | `block_action` missing_data, run goes amber, resumes |
| `nauta_agent_waiting_on_user.md` | succeeded | Human gate, `check_instructions` → `resolve_instruction` |
| `nauta_agent_failed.md` | failed | `fail_action` with a usable reason, a failed retry, honest skip |
| `nauta_agent_replan_midflight.md` | succeeded | Plan revised mid-run with a stated cause; line becomes a diamond |
| `nauta_agent_parallel_sweep.md` | succeeded | Twelve concurrent lanes, one exception surfacing |
| `nauta_agent_edge_cases.md` | various | Stop mid-run, provider outage, context loss, duplicates, slow step, abandoned run |
| `nauta_agent_land_pickup_conflict.md` | succeeded | **Subtasks inside a card**, one discovered mid-step; a human gate with three priced options; a different customer |

**Suggested demo order:** happy path (what it is) → parallel sweep (what it is at scale) →
waiting on user (it is a control, not a dashboard) → replan (the plan changing is the
product) → land pickup conflict (the same thing inside one card) → failed (failure is
legible).

All timings are deliberate. **The duration is the intervention window** — a graph of
instant steps has a decorative stop button.

Pacing is real, not implied: the MCP server exposes a **`wait`** tool and every brief tells
the agent to use it. It is **on by default** while Donald is pre-production; set
`DONALD_DEMO_PACING=false` on the mcp deployment to remove it. If `wait` is missing from the
agent's tool list during a rehearsal, someone has disabled it.

Everything below documents the Python provider simulator, which is separate from these
briefs.

---

# Provider dummy

Simula cualquier proveedor de agentes que hable el protocolo de cinco verbos. No hay servicio,
servidor ni dependencias: son fixtures JSON reproducidos por una función de Python 3.12.

## 1. Córrelo

```bash
cd nauta-dummy
python -m nauta_dummy --list
python -m nauta_dummy --scenario nauta-shipment-delay --speed 4
python -m nauta_dummy --scenario payments-reconciliation --speed 0 --json
```

`--json` emite un objeto por línea para conectarlo a un runner. El ritmo sale de la duración
declarada por cada paso: `speed` la escala, `speed=0` omite las esperas y `seed=23` fija su
variación para ensayos. Todo stream es finito y termina en `run_finished`.

## 2. Entiende los cinco verbos

| Verbo | Lo que declara el proveedor | Eventos principales |
|---|---|---|
| DECLARE | Esta es mi propuesta actual | `run_started`, `plan_declared`, `node_added`, `edge_added` |
| ADVANCE | Estoy aquí y esto encontré | `node_status_changed`, `node_updated`, `artifact_added` |
| REPLAN | Aprendí algo y por eso replanteo | `node_removed`, `edge_removed`, `node_added`, `edge_added`, `run_updated` |
| ASK | Necesito una decisión | `intervention_requested`, `intervention_resolved` |
| FINISH | Terminé y esto ocurrió | `run_finished` |

### Propuesta, no compromiso

**Lo que le pedimos al proveedor es una PROPUESTA, no un compromiso.** *“Sabemos que tienes mucho trabajo. Solo danos una propuesta de tu plan — aunque cambie.”*

**Por qué propuesta y no plan.** Un agente real no conoce todos sus pasos de antemano: descubre sobre la marcha. Pedirle un compromiso sería pedirle que adivine.

**REPLAN no es una falla, es que el agente aprendió algo.** Si el plan nunca cambiara, la interfaz nunca se reconstruiría y no habría nada que demostrar. **El plan cambiando es el mejor momento del producto.**

**Por eso todo replan carga su causa.** `reason`, `triggered_by` y `evidence`. Sin eso, el cambio se lee como que alguien se equivocó; con eso, se lee como que el sistema aprendió. El simulador **rechaza** cualquier escenario cuyo replan no traiga causa.

```text
❌  "el plan cambió"
✅  "Nina replantea: el transbordo no planeado invalida el BL original"  ▸ MSG-3312
```

**Cómo se dice en pantalla.** “Nina propone 6 pasos”, nunca “va a hacer”. Y en el replan, “Nina replantea: `<reason>`”, nunca “el plan falló”.

**No le cambiamos nada al proveedor.** Sus etapas, su lógica y sus acciones quedan intactas; solo le pedimos que exponga su intención actual y avise cuando cambia.

La propuesta viene completa en el fixture. Python no infiere etapas, nombres, agentes ni dominio.

### La duración es la ventana de intervención

**La duración es la ventana de intervención.** Solo puedes detener algo que todavía está pasando.
Si los pasos brincan instantáneos, el botón de stop es decorativo.

Cada paso declara `estimated_seconds`: cuánto cree que va a tardar. `plan_declared` lleva esos
estimados y `total_estimated_seconds`, para mostrar desde el inicio “Nina propone 5 pasos · ~40s”.
El `node_status_changed` que inicia la acción lleva el estimado y `started_at`; el simulador de
verdad espera y emite `node_updated.progress_percent` aproximadamente cada 15%.

Al completar, el nodo reporta `actual_seconds`. Si tarda más de 50% sobre su estimado, emite
`agent_message` con el estimado y el tiempo transcurrido: “se está tardando” es una razón legítima
para que el humano intervenga.

Estimados, variación, frecuencia de progreso y umbral de lentitud son datos del escenario, no código.

El enum exacto del contrato `agent_event` es:

```text
run_started · plan_declared · node_added · node_updated · node_status_changed
node_removed · edge_added · edge_updated · edge_removed · artifact_added
intervention_requested · intervention_resolved · run_updated · run_finished · agent_message
```

Cada `ProviderEvent` copia directo a una fila:

```text
sequence · event_type · occurred_at · agent_label · node_key · idempotency_key · payload
```

## 3. Responde a ASK

El generator queda suspendido después de `intervention_requested`. `send()` elige la rama;
un `for` normal envía `None` al pedir el siguiente evento y usa `default_option_id`.

```python
from nauta_dummy import stream

gen = stream("nauta-shipment-delay", speed=0)
for event in gen:
    print(event.event_type, event.node_key)
    if event.event_type == "intervention_requested":
        gen.send({"option_id": "quote-alternatives"})
```

`send()` devuelve el `intervention_resolved`; si el runner necesita guardarlo, debe capturar ese
valor antes de continuar. Opciones distintas pueden apuntar a ramas distintas en el JSON.

## 4. Agrega un caso sin tocar Python

Copia un JSON dentro de `nauta_dummy/fixtures/`. El CLI lo descubre por su campo `name`.

```json
{
  "name": "mi-caso",
  "display_order": 4,
  "started_at": "2026-08-29T12:00:00Z",
  "timing": {
    "duration_jitter_percent": 25,
    "progress_interval_percent": 15,
    "slow_threshold_percent": 50
  },
  "provider": {
    "name": "Mi proveedor",
    "agents": [{"label": "Ana", "role": "Revisión"}]
  },
  "plan": {
    "graph_revision": 1,
    "basis": "pipeline conocido del proveedor",
    "summary": "Revisar y cerrar.",
    "steps": [
      {"node_key": "review", "agent_label": "Ana", "label": "Revisar", "estimated_seconds": 45}
    ],
    "edges": []
  },
  "timeline": [
    {
      "verb": "advance",
      "node_key": "review",
      "update": {"headline": "Revisión completa", "finding": "Todo coincide."}
    },
    {
      "verb": "finish",
      "summary": {"headline": "Listo", "detail": "Sin excepciones."}
    }
  ]
}
```

Para REPLAN agrega `reason`, `triggered_by`, `evidence`, `remove_nodes`, `remove_edges`,
`add_nodes`, `add_edges` y una revisión mayor. Todo nodo agregado también requiere
`estimated_seconds`; el loader rechaza estimados o causas incompletas.
Para ASK agrega `request` (`type`, `prompt`, `options`, `default_option_id`) y `branches`.
Los artefactos aceptan `file`, `image`, `video`, `audio`, `link`, `text` o `structured_data`, con
`name`, `content_type` y uno de `text_content` o `url`.

## 5. Verifica

```bash
python -m unittest discover -s nauta_dummy/tests
```

Los tres fixtures cubren un embarque tranquilo, uno con demora y una conciliación de pagos.
