# Mira — Fase 0 y Fase 1

**Fecha:** 1 de septiembre de 2026
**Estado:** diseño aprobado, pendiente de plan de implementación
**Rama:** `feat/donald-new-structure`

---

## 1. Qué cambia y por qué

Donald se renombra **Mira** y cambia de comprador.

**Antes:** producto de observabilidad vendido a empresas que usan agentes.
**Ahora:** capa vendida a las empresas **que construyen y venden agentes**, para que el cliente
final de esas empresas entienda lo que compró y pueda aprobarlo.

El caso canónico: Nauta construye agentes para un cliente tipo Coca-Cola. El gerente de ese
cliente solo ve un muro de texto y no entiende qué hace el agente. Mira es la capa donde ese
gerente ve las acciones formarse una por una y firma antes de la acción irreversible.

### El posicionamiento, en una línea

> Los demás te dicen qué hizo tu agente. Mira te deja verlo hacerlo — y detenerlo antes de la
> acción que no se puede deshacer.

### Qué se vende realmente

No el visor. **El expediente.** Un modelo genera una interfaz bonita en una tarde; lo que no se
genera solo es un tercero independiente que certifique quién aprobó qué, cuándo y con qué
evidencia enfrente — append-only y sellado.

El activo defendible ya existe en el repo y es la tabla `intervention` más la secuencia
monótona de `agent_event`. Toda decisión de producto de aquí en adelante refuerza el
expediente, no el dibujo.

### Por qué AG-UI no lo hace redundante

Verificado contra la especificación oficial (`docs.ag-ui.com/concepts/events`, consultada el
1-sep-2026). AG-UI define ~30 tipos de evento de streaming conversacional y declara
explícitamente fuera de alcance las tres cosas que sostienen a Mira:

| Capacidad | AG-UI | Mira |
|---|---|---|
| Grafo de nodos y aristas | no existe (solo `StepStarted`/`StepFinished` lineal) | `node_*`, `edge_*` |
| Ciclo de aprobación humana | no existe (`interrupt` suspende, no aprueba) | `intervention_requested` → `delivered` → `resolved` |
| Persistencia y auditoría | fuera de alcance por diseño | `agent_event` append-only, `sequence` monótona |

**Decisión de arquitectura:** Mira **habla AG-UI de entrada**, no compite contra él. El vendor
conecta su agente con el estándar que ya usa y Mira lo convierte en grafo, gate y expediente.
Diez frameworks ya lo hablan (LangGraph, CrewAI, Microsoft Agent Framework, Google ADK, AWS
Strands, Claude Agent SDK, Pydantic AI, Mastra, LlamaIndex, Agno). Eso convierte "conecta tu
agente" en pegar una URL.

La adopción de AG-UI queda fuera de estas dos fases; se registra aquí para que ninguna decisión
de Fase 0 o 1 la contradiga.

---

## 2. Fase 0 — Identidad

**Objetivo:** un repositorio público que se pueda enseñar, sin deuda de terceros.
**Duración estimada:** un día.
**Criterio de aceptación:** `git log` y el README hablan de Mira; ninguna referencia a Donald
queda en superficie visible; el repo no contiene rastros operativos de colaboradores previos.

### 0.1 Dominio

Comprar `mira.ai`. Verificado sin nameservers al 1-sep-2026, probablemente disponible.

**Condición de corte:** si el registrador lo marca como premium por encima de ~500 USD, no se
compra. Se elige otro nombre del mismo molde (nombre de persona, dos sílabas, bilingüe, no
descriptivo) y se repite la verificación. El nombre no justifica una inversión de cuatro cifras
sin ingresos.

### 0.2 Renombrado en el código

Sustituir Donald por Mira en todo lo visible al usuario y al desarrollador:

- `readme.md`, `CLAUDE.md`, `AGENTS.md`, `frontend/AGENTS.md`
- Textos de interfaz, `<title>`, metadatos
- Nombres de paquete y variables de entorno de cara al público

**No se renombra en esta fase:** identificadores internos del backend generado
(`agent_run`, `agent_event`, tipos Go). Están en la zona generada por nuzur y no se pueden
regenerar. Se atienden cuando se sustituya el backend, no antes.

### 0.3 Limpieza de colaboradores

- Eliminar el remote `maykel` (`git remote remove maykel`) y las referencias remotas asociadas
- Quitar la mención en `HANDOFF.md`
- Sustituir el correo en `deploy/cluster-issuer.yaml` por uno propio
- README nuevo, de producto, no de hackathon

**Fuera de alcance:** reescribir el historial de commits. Los 26 commits de Maykel Farha y los 9
de Mau Lamas se quedan. Reescribir historia cambia todos los hashes, obliga a force-push y no
resuelve nada que importe: la marca se gana por uso en el comercio, no por autoría de commits.

**Acción no técnica, y es la que de verdad cierra el tema:** dejar por escrito con Mau Lamas
que el nombre y el producto son de Rodrigo. Un mensaje hoy vale más que un abogado en dos años.

### 0.4 Verificación de marca

Antes de invertir en la identidad: consultar "Mira" en USPTO/TESS (clases 9 y 42), EUIPO e IMPI.
Es palabra común; el registro puede estar saturado. Si aparece conflicto activo en software,
se vuelve a la lista corta de nombres.

---

## 3. Fase 1 — La landing que vende

**Objetivo:** un enlace que se pueda mandar en frío y que explique el producto sin una llamada.
**Duración estimada:** tres a cuatro días.
**Criterio de aceptación:** un desconocido entra a la raíz del sitio y en treinta segundos
entiende qué es, para quién es, y ve un agente trabajando.

### 3.1 El problema actual

`frontend/app/page.tsx` renderiza `DonaldAccess`: un formulario de 131 líneas que pide *Client
ID* y *Access Code*. Un visitante en frío llega y ve una petición de credenciales que no tiene.
No hay hero, no hay explicación, no hay caso, no hay llamada a la acción.

### 3.2 Estructura

| Ruta | Antes | Después |
|---|---|---|
| `/` | `DonaldAccess` (gate de login) | Landing de producto |
| `/access` | no existe | `DonaldAccess`, movido intacto |
| `/runs/[runKey]` | visor | sin cambios |

El componente de acceso se mueve sin modificarse. Cualquier enlace existente que dependa de la
raíz se redirige a `/access`.

### 3.3 Contenido de la landing

En orden de aparición:

1. **Hero** — el posicionamiento de la sección 1, con un run corriendo detrás del texto
2. **El problema, dicho desde el lado del vendor** — "tu cliente no entiende lo que le vendiste"
3. **Cómo funciona**, en tres pasos: conecta · el cliente mira · el cliente firma
4. **Tarjetas de demo** — arrancan solas, sin registro
5. **El expediente** — la sección que vende el foso: qué queda después del run
6. **Conecta tu agente** — MCP hoy, AG-UI como siguiente paso
7. **Lista de espera** — captura de correo

**Regla de contenido:** la landing habla del expediente auditable, no del visor bonito. El visor
es la prueba; el registro es el producto.

### 3.4 Hero con run en vivo

El hero lleva `berrios-op4471` corriendo en bucle detrás del texto, en modo ambiente: sin
controles, sin interacción, respetando `prefers-reduced-motion`.

**Fallback obligatorio:** si el modo ambiente pelea con el visor, la landing se entrega sin él.
El hero funciona con una captura estática. No se bloquea la fase por esto.

### 3.5 Dos demos fuera de logística

Hoy hay cinco grabaciones y las cinco son de barcos. Un producto que se vende como genérico no
se sostiene con eso: un prospecto de soporte o de finanzas no se ve reflejado.

Generar dos casos nuevos con el generador existente (`scripts/gen-berrios-op4471.py` como
molde), cada uno con un gate humano antes de una acción irreversible:

- **Reembolso** — agente de soporte va a emitir un reembolso de 4,200 USD; humano firma
- **Rollback** — agente de devops va a revertir un despliegue en producción; humano firma

Registrar ambos en el allowlist de `frontend/app/api/donald-recording/route.ts` y en
`RECORDED_RUNS` de `run-viewer.tsx`. No se toca `events.recorded.jsonl` (lo leen las pruebas).

**Restricción:** las grabaciones se generan por script, nunca se editan a mano.

### 3.6 Qué NO entra en Fase 1

- El SDK embebible (`<MiraPanel />`) — es Fase 3 y es donde está el negocio; no se construye sin
  señal de compra
- Autenticación y multi-tenant — Fase 4
- Migración del backend — Fase 2
- Interfaz generada al vuelo — Fase 5

---

## 4. Fases posteriores

Se registran para dar contexto. No se diseñan aquí.

**Fase 2 — Infraestructura.** El backend sale de la PC de Rodrigo. Decisión tomada: en vez de
mudar el Go generado, **reescribir las siete tablas más el SSE en FastAPI + Supabase**, el
stack que Rodrigo ya domina de Cualli. Mismo esfuerzo de migración, y sale con un solo stack
para ambos productos y cero dependencia de nuzur. Frontend a Vercel.

**Fase 3 — SDK embebible.** `<MiraPanel />` con AG-UI de entrada. Es lo que se cobra.

**Fase 4 — Cuentas.** Gateway de autenticación **delante** de la API, no dentro. Tres niveles:
Mira → el vendor → los clientes del vendor.

**Fase 5 — Interfaz declarada por el agente.** El agente compone desde un catálogo de
componentes; no dibuja libre. `action-presentation.ts` pasa de archivo propio a contrato.

---

## 5. La validación corre en paralelo

Fase 0 y Fase 1 son baratas y sirven pase lo que pase. **Fase 3 en adelante no se construye sin
señal de compra.**

Cinco conversaciones, dos semanas, en paralelo a la construcción:

1. **Nauta** — ya expresó interés. Convertirlo en socio de diseño, no en encuesta.
2. **Roma AI** — construyó su propia capa de gobernanza en casa. La pregunta es *por qué*. Es la
   entrevista más valiosa disponible: o valida el hueco o lo cierra.
3. **Tres agencias o consultoras** que construyan agentes para clientes empresariales.

Pregunta única: *¿pagarías por un registro auditable de aprobaciones que tú no emites?*

- **Dos o más dicen que sí** → se construye Fase 3.
- **Ninguno dice que sí** → el mercado habló; se revisa la tesis antes de gastar semanas.

---

## 6. Riesgos aceptados

| Riesgo | Estado |
|---|---|
| AgentKit de OpenAI trae UI embebible gratis | real; se compite por expediente, no por UI |
| Categoría consolidándose por adquisición (8 casos en 14 meses) | real; techo de salida bajo sin capital |
| Precio anclado por CopilotKit en 39 USD/mes | real; obliga a vender auditoría, no visor |
| Un vendor con frontend developers se construye el grafo | real; Roma AI ya lo hizo |
| Costo marginal de escribir código tendiendo a cero | real; refuerza que el foso sea el registro |
| Backend generado por nuzur, sin acceso al generador | mitigado en Fase 2 |

Las cifras de adquisiciones y precios provienen de investigación con agentes y **deben
verificarse antes de citarse en una venta**.

---

## 7. Verificación

Antes de dar por terminada cualquier fase:

```sh
cd frontend
npx pnpm@10 exec tsc --noEmit
npx pnpm@10 test
npx pnpm@10 build
```

En Windows PowerShell, `npx.cmd`.

Y la comprobación de la casa, sobre los archivos tocados:

```sh
git diff --name-only | xargs grep -n -i "localhost\|127\.0\.0\.1" --
```
