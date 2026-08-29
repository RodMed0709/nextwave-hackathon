# Donald — contexto del proyecto

> **NextWave Hackathon 2026 · CDMX · Reto 3: The Interface That Builds Itself**

---

## La frontera

```
NAUTA     ejecuta.  Manda el correo, reserva el camión, disputa la factura.
NOSOTROS  decidimos qué ve Jorge, y le damos el botón de STOP y de STEER.
JORGE     entiende en 90 segundos y decide.
```

Nauta lo dice en su propia página:

> *"Agentes que no mandan una alerta y esperan. **Actúan.**"*

Exacto — y ahí está el problema que resolvemos:

| | |
|---|---|
| Agente que solo **alerta** | El humano lee, decide, actúa. Manda el humano. |
| Agente que **actúa** | Las cosas pasan sin él. *¿Cómo confío en algo que ya lo hizo?* |

**La frase del pitch:**

> Un agente que solo alerta se audita leyendo la alerta.
> **Un agente que actúa necesita una ventana — y un freno.**

Y la prueba de que esto es el producto está en el propio esquema:
`intervention_type: stop | steer`. Esos dos verbos son todo.

---

## El operador

**Jorge, 52 años, director de operaciones de Muebles del Sur.** Importa muebles de Vietnam.
20 años en esto, no es técnico.

Tiene Nauta contratado. Los agentes de Nauta trabajan 24/7 y **actúan**. Jorge no ve nada de eso:
le llega un WhatsApp de que algo pasó, y sigue sin entender qué hizo el agente ni por qué.

> *"No quiero el putazo de texto. Quiero entender qué se hizo."*

**Métrica:** de la detección a la decisión con confianza. Hoy: horas, o nunca. Con esto: **90 segundos.**

---

## Cómo se abre a cualquier caso — la pregunta que va a hacer el jurado

*"¿No son pantallas predefinidas?"*

**No. El agente no construye animaciones: construye estructura. La animación es una propiedad
de la estructura.**

Solo pueden pasar **seis cosas** en un grafo:

| Evento estructural | Animación | Se escribe |
|---|---|---|
| Nace un nodo | entra en gris, escalonado, 80ms entre uno y otro | una vez |
| Cambia de estado | pulsa; la arista que llega se dibuja | una vez |
| Produce un artefacto | el documento entra volando al nodo | una vez |
| Se abre a decisión | **el nodo se expande** en panel | una vez |
| Se traza una arista | `stroke-dashoffset` animado | una vez |
| **Se replanea** | **el grafo se recablea en vivo** | una vez |

Cualquier caso de uso del mundo se reduce a esas seis. Retraso de embarque, factura con error,
proveedor que no contesta, precio fuera de contrato: cambia el **contenido**, no los **eventos
estructurales**.

> **HTML tiene ~110 etiquetas y puede renderizar cualquier página que existe.
> Las etiquetas son finitas. Los árboles son infinitos.**

Seis animaciones finitas. Estructura infinita.

---

## Las familias de casos — son las de Nauta

Cada agente nombrado de Nauta es una familia:

| Agente | Caso | Dato de Nauta |
|---|---|---|
| **Nina** · Shipment Watch | retraso, transbordo, ETA | ← el nuestro |
| **Theo** · Freight Anomaly | sobrecobro de flete | 39% de facturas traen errores |
| **Lauren** · Supplier Reliability | proveedor que no confirma | |
| **Vera** · Price Drift | precio fuera de contrato | |
| **Alec** · Contract Compliance | término violado | |
| **Marcus** · Inventory Watch | riesgo de quiebre | 7.4% de ventas perdidas |

**Jugada de pitch:** enseñar el caso de Nina completo, y luego correr el de Theo — otro dominio,
otros datos — **y que se renderice solo, sin código nuevo de frontend.** Son 20 minutos: otro
fixture, mismas seis etapas, mismos seis eventos.

---

# El skill del agente

Un archivo de texto. **No es código.** Agregar un paso en la prueba de fuego = editar esto.

## Prompt

```
Eres el supervisor entre Nauta y Jorge.

Nauta ya ejecutó, o está a punto de ejecutar. TÚ NO EJECUTAS.
Tu único trabajo es que Jorge entienda, y decidir cuándo hay que detener a Nauta.

Jorge tiene 52 años, dirige operaciones de una importadora, y no es técnico.
Nunca escribas párrafos. Emite bloques de UI.

Por cada evento del pipeline decide:
  · ¿esto se muestra completo, o se colapsa en una línea?
  · ¿amerita PARAR a Nauta y preguntarle a Jorge?
  · ¿qué evidencia le enseño?
  · ¿cómo se lo digo sin jerga?

REGLA DE INTERVENCIÓN:
  Detén a Nauta (stop) SOLO si la acción es irreversible o cuesta dinero.
  Si no lo es, deja que Nauta siga y solo muéstralo.

REGLA DE ATENCIÓN:
  Lo que no cuesta dinero ni bloquea nada, va colapsado en una línea.
  Cuanto más grave, más superficie de pantalla merece.
```

**Esa segunda regla es lo que hace al LLM imprescindible:** decide **estructura y saliencia**,
no palabras. Es la razón de que run A y run B se vean radicalmente distintos con el mismo código.

## Tools

| Tool | Qué hace | Evento que emite |
|---|---|---|
| `declare_plan(nodes)` | dibuja el plan completo en gris antes de ejecutar | `plan_declared` |
| `update_node(key, status, ui_spec)` | un nodo avanza y pinta su tarjeta | `node_status_changed` |
| `attach_artifact(key, artifact)` | el correo o el documento | `artifact_added` |
| `request_intervention(key, type, prompt, options)` | **stop** o **steer** | `intervention_requested` |
| `replan(remove, add, edges)` | **el grafo se recablea** | `node_removed` + `node_added` + `edge_*` |
| `finish_run(summary)` | cierra y colapsa | `run_finished` |

Seis tools. Cada una mapea a un `agent_event_type` del esquema.

---

# El `ui_spec` — siete primitivas, con `children`

Van en `agent_event.payload` (json). **Componibles: el agente arma árboles, no elige tarjetas.**

```
LAYOUT      row · column · group        ← llevan children
CONTENIDO   headline · metric · evidence · choice
```

```json
{"type":"column","children":[
  {"type":"headline","severity":"high","text":"Transbordo no planeado en Singapur"},
  {"type":"row","children":[
    {"type":"metric","label":"Demurrage","value":3780,"unit":"USD","delta":"+7 días facturables"},
    {"type":"metric","label":"ETA","value":"14-SEP","delta":"+9 días"}
  ]},
  {"type":"evidence","src":"MSG-3312","quote":"Cargo rolled to MSC LIVORNO via Singapore"}
]}
```

**Si el modelo emite algo fuera del enum, el runner lo baja a texto plano y sigue.**
Un payload malformado **nunca** puede dejar la pantalla en blanco.

---

# La demo

```
1. plan_declared     Nina traza 6 nodos en gris. "Esto es lo que voy a hacer."
2. Los nodos se encienden uno por uno. INGEST · EXTRACT · RECONCILE
3. DETECT            transbordo no planeado
4. IMPACT            $3,780 · BL invalidado · el cliente incumple con SU cliente
5. ⚡ Nauta va a notificar al cliente.
   El agente evalúa: irreversible + cuesta dinero → STOP
   El nodo SE ABRE en panel de decisión, con el borrador y la evidencia.
6. Jorge elige "primero busca alternativa" → STEER
7. ⚡ REPLAN: se borra el nodo de notificar, nacen tres de cotización,
   las aristas se recablean. EL GRAFO SE REDIBUJA SOLO.
```

**El paso 7 es el pitch entero.** Nadie programó ese grafo. Nació de la decisión de Jorge.

---

# Detalles que se ven en el proyector

- **Delta por `sequence`.** `GET /agent_events?run_uuid=X&sequence_gt=42`. Sin esto, cada poll
  reemplaza el estado, React reconcilia toda la lista, **las animaciones CSS se reinician cada
  segundo** y el scroll salta.
- **Jitter 0.8-3.5s** en el dummy. Un evento cada 2.0s exactos es un metrónomo y el jurado lo
  cacha al cuarto evento. *(Ya implementado.)*
- **Siempre algo en movimiento.** Tres segundos sin movimiento y el jurado cree que se colgó.
  Por eso el nodo activo pulsa aunque no pase nada.
- **Los números cuentan hacia arriba.** `$0 → $3,780` en 800ms pega diez veces más que aparecer.
- **Nunca botones que digan "Run A" y "Run B".** Nómbralos como dos embarques reales.
- **Un solo nodo activo a la vez.** La mirada tiene que saber dónde ir.
