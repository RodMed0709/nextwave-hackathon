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

`--json` emite un objeto por línea para conectarlo a un runner. `speed=0` elimina las pausas;
`seed=23` fija el ritmo para ensayos. Todo stream es finito y termina en `run_finished`.

## 2. Entiende los cinco verbos

| Verbo | Lo que declara el proveedor | Eventos principales |
|---|---|---|
| DECLARE | Este es mi plan | `run_started`, `plan_declared`, `node_added`, `edge_added` |
| ADVANCE | Estoy aquí y esto encontré | `node_status_changed`, `node_updated`, `artifact_added` |
| REPLAN | El hallazgo cambió mi plan | `node_removed`, `edge_removed`, `node_added`, `edge_added`, `run_updated` |
| ASK | Necesito una decisión | `intervention_requested`, `intervention_resolved` |
| FINISH | Terminé y esto ocurrió | `run_finished` |

El plan viene completo en el fixture. Python no infiere etapas, nombres, agentes ni dominio.

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
  "provider": {
    "name": "Mi proveedor",
    "agents": [{"label": "Ana", "role": "Revisión"}]
  },
  "plan": {
    "graph_revision": 1,
    "summary": "Revisar y cerrar.",
    "steps": [
      {"node_key": "review", "agent_label": "Ana", "label": "Revisar"}
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

Para REPLAN agrega `remove_nodes`, `remove_edges`, `add_nodes`, `add_edges` y una revisión mayor.
Para ASK agrega `request` (`type`, `prompt`, `options`, `default_option_id`) y `branches`.
Los artefactos aceptan `file`, `image`, `video`, `audio`, `link`, `text` o `structured_data`, con
`name`, `content_type` y uno de `text_content` o `url`.

## 5. Verifica

```bash
python -m unittest discover -s nauta_dummy/tests
```

Los tres fixtures cubren un embarque tranquilo, uno con demora y una conciliación de pagos.
