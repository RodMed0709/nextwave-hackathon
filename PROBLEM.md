# PROBLEM.md

**Reto 3 — The Interface That Builds Itself** · NextWave Hackathon 2026, CDMX

---

## La tesis

> **El agente no te cuenta lo que hizo. Te lo enseña mientras lo hace.**
> La interfaz generada no es una feature bonita. **Es la explicación.**

---

## El operador

**Jorge, 52 años. Director de operaciones de Muebles del Sur**, importadora de muebles de
Vietnam a México. Lleva 20 años en esto. No es técnico y no tiene por qué serlo.

**Su día:**
- Llega a las 8. Tiene 60 correos, tres de ellos importan y no sabe cuáles.
- Tiene contratado Nauta. El agente de Nauta trabaja todo el día: lee correos, extrae datos,
  reconcilia, vigila plazos, predice retrasos, detecta excepciones, calcula impacto, decide y actúa.
- **Jorge no ve nada de eso.** Le llega un resumen, o un correo, o nada.
- Cuando algo se rompe, se entera tarde — o peor: se entera porque **su cliente le habla**.
- Cuando tiene que decidir algo, le llama a alguien para que se lo explique. Esa llamada dura
  30 minutos y pasa tres o cuatro veces por semana.

**Lo que Jorge dice, textual:**

> *"No quiero el putazo de texto. Quiero entender qué se hizo."*

---

## El momento de dolor

**Un embarque se complica y hay que decidir algo hoy.**

Lo que pasa actualmente:

1. El agente de Nauta lo detecta a las 09:14 y actúa
2. Jorge se entera a las 14:00, o al día siguiente, o cuando su cliente reclama
3. Para entender qué pasó, alguien tiene que explicárselo: 30 minutos
4. Decide con información incompleta, o pospone

**Lo que cuesta:** entre la detección y la decisión con confianza pasan **horas**. En ese hueco
se acumula demurrage, se pierden ventanas de reacción, y el cliente final se entera antes que él.

En el caso que vamos a demostrar: **$3,780 USD** y un compromiso comercial incumplido por 4 días.

---

## La métrica

| | Hoy | Con esto |
|---|---|---|
| Detección → decisión con confianza | horas (o nunca) | **90 segundos** |
| Llamadas para que le expliquen | 3-4 por semana | 0 |
| Cosas que el agente hizo y Jorge no vio | casi todas | ninguna |

---

## La frontera con Nauta

**Nauta ya hace los 12 pasos completos**, de INGEST a ACT. No competimos con eso.

```
        NAUTA  ──  corre los 12 pasos, sola, por dentro
              │
              │  entrega lo que hizo y por qué
              ▼
        NOSOTROS  ──  lo volvemos visible y accionable
              │
              ▼
        JORGE  ──  entiende e interviene
```

> **Nauta decide qué hacer con el embarque.
> Nosotros decidimos qué ve Jorge y cuándo tiene que meter mano.**

Son dos decisiones distintas. La de Nauta es operativa. La nuestra es de interacción.

En este prototipo Nauta está simulado (ver `nauta-mock/`). La frontera es un contrato:
el día que exista el acceso, se cambia el archivo por una llamada HTTP y **nada más se toca**.

---

## Qué hace nuestro agente

**Interpreta máquina para humano, y construye la pantalla para hacerlo.**

| Decide | Ejemplo |
|---|---|
| ¿Esto amerita interrumpir a Jorge? | Run A: no. Run B: sí. |
| ¿Qué es lo importante de todo lo que pasó? | de 3 alertas, manda el compromiso con el cliente |
| ¿Cómo se lo digo a alguien de 52 años? | no *"eta_slip 9d"* sino *"llega 4 días tarde de lo que le prometiste a tu cliente"* |
| ¿Qué evidencia le enseño? | el correo de MSC + el del cliente, subrayados |
| ¿Qué le pregunto y con qué opciones? | las que salieron del PLAN de Nauta |
| ¿Qué pasa con lo que contestó? | rehacer la UI con la consecuencia |

---

## Por qué esto necesita IA

**Porque no puedes pre-programar la pantalla de cada situación.**

Las situaciones son ilimitadas: un transbordo no planeado, un documento invalidado, un proveedor
que no contesta, una combinación que nadie vio nunca. Hoy, cuando el agente pega con un caso raro,
**la pantalla no existe** — porque nadie la programó.

Si quitas el LLM y la demo sigue funcionando igual, no es AI-native y el jurado lo va a ver.
**La prueba está en los dos runs:** mismo código, mismos prompts, datos distintos → interfaz
distinta. Nadie programó la segunda pantalla.

---

## Anti-scope — lo que NO vamos a resolver

- **No construimos el pipeline de Nauta.** Lo recibimos. Está simulado.
- **No es un dashboard configurable.** No hay filtros, no hay vistas guardadas.
- **No hay multiusuario, login, ni móvil.** Un solo run, una sola pantalla.
- **No optimizamos rutas ni costos.** Eso es de Nauta.
- **No es un chatbot de preguntas y respuestas.** Si el humano solo pregunta y el sistema
  contesta texto, fracasamos en nuestra propia tesis.
- **No persistimos nada que no salga en la demo.**

---

## El momento que hay que ganar

Todo el pitch gira alrededor de un solo instante:

> Corremos el mismo flujo dos veces. En el primero el agente resuelve solo y no interrumpe.
> En el segundo — **mismo código, mismos prompts, solo cambiaron los datos** — el agente se
> detiene y **nace un panel de decisión que en el primero no existía**.

Todo lo demás existe para llegar ahí y para salir de ahí.
