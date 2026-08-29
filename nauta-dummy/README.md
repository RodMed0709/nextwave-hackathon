# Nauta dummy

**Es Nauta, fingido.** Emite eventos como los emitiría el pipeline real, con reloj, para que
haya algo que animar.

No tenemos acceso al agente de Nauta. Esto lo sustituye. El día que exista el acceso,
**se cambia una sola función por un cliente HTTP y nada más se toca.**

---

## Correrlo — 30 segundos

```bash
cd nauta-dummy
python -m nauta_dummy --scenario run-B --speed 4
```

Sin dependencias. Python 3.12. No hay que instalar nada.

`--speed 4` va 4 veces más rápido. En la demo se usa `--speed 1`.

Los dos escenarios:

```bash
python -m nauta_dummy --scenario run-B   # el problema  ← este es la demo
python -m nauta_dummy --scenario run-A   # el tranquilo ← el contraste
```

Los tests:

```bash
python -m unittest discover -s nauta_dummy/tests
```

---

## Usarlo desde código

Una sola función:

```python
from nauta_dummy import stream

for event in stream(scenario="run-B", speed=1.0):
    print(event.stage, event.agent, event.title)
    print(event.data)
```

`speed=0` no duerme — para tests.
`seed=23` fija el jitter — para reproducir un ensayo exacto.

---

## Qué te da

Seis eventos, en este orden, y termina:

```
INGEST → EXTRACT → RECONCILE → DETECT → IMPACT → PLAN
```

Cada evento (`PipelineEvent`) trae:

| Campo | Qué es |
|---|---|
| `stage` | una de las seis de arriba |
| `seq` | 1..6 |
| `ts` | reloj simulado |
| `agent` | el agente de Nauta responsable — `Nina`, `Theo` o `Marcus` |
| `title` | una línea, en español |
| `detail` | 1-3 frases, en español |
| `data` | el payload estructurado de esa etapa |
| `evidence` | ids de los correos que lo respaldan |

**Termina solo.** No hay `while True`. Importa para no quemar créditos de OpenAI de noche.

**El espaciado entre eventos es aleatorio, entre 0.8 y 3.5 segundos.** A propósito: un evento
cada 2.0s exactos parece falso en un proyector.

---

## Los agentes son los reales de Nauta

Nauta tiene agentes con nombre, cada uno con su especialidad. Usamos los suyos:

| Agente | Especialidad | Etapas que le tocan aquí |
|---|---|---|
| **Nina** | Shipment Watch | INGEST · EXTRACT · DETECT |
| **Theo** | Freight Anomaly | RECONCILE · IMPACT |
| **Marcus** | Inventory Watch | PLAN |

(Su roster completo también trae Lauren/Supplier Reliability, Vera/Price Drift y Alec/Contract
Compliance. Están definidos en `agents.py` por si hacemos un segundo caso.)

---

## Los dos escenarios y por qué son dos

**Es el mismo embarque** (OP-4471, Muebles del Sur, Vietnam → Manzanillo). Cambia lo que pasó.

| | `run-A` | `run-B` |
|---|---|---|
| Qué pasó | ETA +1 día por congestión | Transbordo no planeado, ETA +9 días |
| Días libres | quedan 7 | **quedan 2** |
| Documentos | todos ok | **falta el Bill of Lading** |
| Costo | **$0** | **$3,780 USD** |
| Reversible | sí | no |
| Compromiso del cliente | sin riesgo | **incumple por 4 días** |
| Opciones en PLAN | **1**, trivial | **3**, rankeadas con su razón |

**Para qué sirve tener dos.** Es la prueba del proyecto en 30 segundos:

> Mismo código, mismos prompts, **datos distintos → interfaz radicalmente distinta.**
> En A el agente no interrumpe a nadie y todo se colapsa en una línea.
> En B se detiene, expande, saca evidencia y pide una decisión.
>
> Nadie programó la segunda pantalla.

Si no tuviéramos los dos, el jurado diría que la UI está guionizada. Con los dos, no puede.

---

## Lo que el dummy NO hace, a propósito

- **No emite DECIDE ni ACT.** El pipeline real de Nauta tiene 12 etapas; nosotros usamos 6.
  Decidir si hay que molestar al humano es trabajo de **nuestro** agente, no del simulador.
  El stream termina en PLAN y ahí entramos nosotros.
- **No escribe en la base.** Solo emite. Quien escribe es el runner.
- **No habla con el frontend.** Ni lo conoce.

---

## Dónde encaja

```
nauta-dummy/          emite los 6 eventos con reloj        ← esto
      ↓
   runner             traduce a eventos de UI y escribe    ← falta
      ↓
   backend/           la base y la API (Nuzur)             ← Meykel
      ↓
   frontend/          hace polling y anima                 ← Mau
```

El contrato completo del agente, las tools y el vocabulario de `ui_spec` están en
[`CONTEXT.md`](../CONTEXT.md) en la raíz.

---

## Qué falta

- [ ] Que el dummy **ramifique** cuando Jorge hace `steer`. Hoy la cinta es fija; si el humano
      redirige, los eventos que siguen deberían cambiar. Se hace con `gen.send(decision)`.
      **Para el final**, no ahora.
- [ ] Un segundo caso de uso con otro agente de Nauta (Theo, sobrecobro de flete). Otro fixture,
      mismas seis etapas, mismos seis eventos, **cero código nuevo de frontend.** Son ~20 minutos
      y demuestra en vivo que el sistema es abierto.
