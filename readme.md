# Donald

**Una superficie de supervisión para agentes que actúan.**

NextWave Hackathon 2026 · CDMX · Reto 3 — *The Interface That Builds Itself*

---

## El problema

Empresas como **Nauta** venden agentes de IA que no solo avisan: **ejecutan**. Mandan correos,
reservan camiones, disputan facturas, 24/7. Su propia página lo dice:

> *"Agentes que no mandan una alerta y esperan. **Actúan.**"*

Y ahí está el hueco:

| | |
|---|---|
| Un agente que solo **alerta** | El humano lee, decide, actúa. Manda el humano. |
| Un agente que **actúa** | Las cosas pasan sin él. *¿Cómo confío en algo que ya lo hizo?* |

> **Un agente que solo alerta se audita leyendo la alerta.
> Un agente que actúa necesita una ventana — y un freno.**

Donald es esa ventana y ese freno. El operador ve el razonamiento del agente **construirse en
pantalla mientras ocurre**, y puede **detenerlo** o **redirigirlo**.

**No le cambiamos nada al proveedor.** Sus etapas, su lógica y sus acciones quedan intactas.
Solo le pedimos que exponga su intención y avise cuando cambia.

---

## Cómo funciona — el protocolo de cinco verbos

Cualquier agente que hable estos cinco verbos se vuelve supervisable:

| Verbo | El agente dice | Donald pinta |
|---|---|---|
| **DECLARE** | *"propongo estos N pasos"* | los nodos grises, escalonados |
| **ADVANCE** | *"voy en el 3, esto encontré"* | el nodo pulsa, la arista se dibuja |
| **REPLAN** | *"cambió el plan: quito esto, agrego aquello"* | **el grafo se recablea** |
| **ASK** | *"necesito que decidas"* | el nodo se expande en panel |
| **FINISH** | *"terminé, esto pasó"* | se colapsa en resumen |

Lo que le pedimos es una **propuesta, no un compromiso**:

> *"Sabemos que tienes mucho trabajo. Solo danos una propuesta de tu plan — aunque cambie."*

**Y que el plan cambie no es una falla: es que el agente aprendió algo.** Si el plan nunca
cambiara, la interfaz nunca se reconstruiría y no habría nada que demostrar. Por eso todo replan
carga su causa (`reason`, `triggered_by`, `evidence`) — sin ella se lee como que alguien se
equivocó; con ella, como que el sistema aprendió.

---

## Las piezas

```
  CUALQUIER AGENTE            nauta-dummy/        ← simulador, para la demo ensayada
  (Claude Code, Nauta, …)     skill/              ← el skill que le enseña a reportar
            │
            │  MCP · 5 verbos · https://mcp.donald.todes.mx/v1/mcp
            ▼
  backend/donald/             ← Go generado por nuzur + servidor MCP
            │                    entidades: agent_run · agent_node · agent_edge
            │                    agent_event · intervention · artifact
            ▼
  https://api.donald.todes.mx/    ← REST
            │
            ▼
  frontend/                   ← Next + React Flow. Polling por sequence.
```

| Carpeta | Qué es | Dueño |
|---|---|---|
| [`backend/donald/`](backend/) | Backend Go generado por nuzur desde el modelo `v2-run-graph-events`, más el servidor MCP en `app/mcp/`. **Los archivos generados no se editan** — ver `backend/donald/AI.md`. Lo tuyo va en `app/`. | Meykel |
| [`frontend/`](frontend/) | Next 16 + React Flow. El grafo se dibuja desde los datos: posiciones calculadas, nunca escritas a mano. | Mau |
| [`nauta-dummy/`](nauta-dummy/) | Simulador de un proveedor. Tres escenarios como datos, cero dominio en el código. | Rodrigo |
| [`skill/`](skill/) | El skill `donald-flow` que conecta cualquier agente al MCP, y cómo cablearlo. | Meykel |
| [`deploy/`](deploy/) | Helm charts. Ya desplegado. | Meykel |

---

## Arranca en 5 minutos

**El simulador** — sin dependencias, no necesita nada más:

```bash
cd nauta-dummy
python -m nauta_dummy --list
python -m nauta_dummy --scenario nauta-shipment-delay --speed 4
```

**El frontend:**

```bash
cd frontend
npx pnpm@10 install
npx pnpm@10 dev          # http://localhost:3000
```

Arranca **en blanco** y se llena con los eventos. Nada existe hasta que un evento lo crea.
Para apuntarlo a datos reales en vez de la grabación local:

```bash
NEXT_PUBLIC_DONALD_API=https://api.donald.todes.mx
```

**Conectar un agente de verdad** — ver [`skill/README.md`](skill/README.md). Transporte HTTP,
sin auth (demo):

```json
{ "mcpServers": { "donald": { "type": "http", "url": "https://mcp.donald.todes.mx/v1/mcp" } } }
```

---

## Los tres casos que demuestran el producto

Cada uno tiene una **forma distinta en pantalla** — eso es lo que prueba que la interfaz nace de
los datos y no de un guion.

| Caso | Escenario | Forma |
|---|---|---|
| **Se calla** | `nauta-shipment-quiet` | Todo colapsado en una línea. Cero interrupciones. Un sistema que siempre grita es tan inútil como uno ciego. |
| **Replantea y pregunta** | `nauta-shipment-delay` | Transbordo no planeado · $3,780 de demurrage · BL invalidado. **El grafo se recablea** y nace el panel de decisión. |
| **Otro dominio** | `payments-reconciliation` | Otra empresa, otros pasos, otro vocabulario. **Cero código nuevo.** |

El tercero es la prueba de apertura: se agregó escribiendo un JSON, sin tocar Python.

---

## Por qué el tiempo importa

Los pasos declaran cuánto creen que van a tardar, y el simulador **de verdad espera**, reportando
progreso mientras tanto. No es relleno:

> **La duración es la ventana de intervención.** Solo puedes detener algo que todavía está
> pasando. Si los pasos brincan instantáneos, el botón de stop es decorativo.

Un run completo dura ~60 segundos reales. Y si un paso se pasa 50% de su estimado, emite
`agent_message` — *"se está tardando"* es una razón legítima para que el humano intervenga.

---

## Documentos

| | |
|---|---|
| [`PROBLEM.md`](PROBLEM.md) | El operador (Jorge, 52 años), la tesis, la métrica, el anti-scope |
| [`CONTEXT.md`](CONTEXT.md) | La frontera con Nauta, el skill, el vocabulario de `ui_spec` |
| [`nauta-dummy/README.md`](nauta-dummy/README.md) | El protocolo, cómo agregar un caso sin tocar Python |
| [`skill/README.md`](skill/README.md) | Cómo conectar un agente al MCP |
| [`backend/donald/AI.md`](backend/donald/) | Qué se puede editar del backend generado y qué no |

---

## Estado

```
✅  backend + API + MCP desplegados
✅  simulador: 3 escenarios · 26 tests · duraciones reales · branching
✅  skill donald-flow
🔨  frontend conectado a la API en vivo
❌  el simulador todavía no llama al MCP — habla por su cuenta
```

**Lo que falta para cerrar el circuito:** que `nauta-dummy` llame las tools del MCP en vez de
emitir eventos por su lado, y que el frontend consuma `/agent_events?sequence_gt=N`.

Todo lo demás ya corre.
