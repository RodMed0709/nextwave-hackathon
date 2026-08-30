# PITCH — Donald · 4 minutos

**NextWave Hackathon 2026 · CDMX · Challenge 3 — "The Interface That Builds Itself"**

Demo en local, desde grabaciones. Tres pestañas abiertas ANTES de empezar, en este orden:

1. `localhost:3000/runs/missing-invoice`
2. `localhost:3000/runs/replan`
3. `localhost:3000/runs/land-pickup`

Nunca dependas de red. Cada pestaña se recarga justo antes de su turno: recargar reinicia la
reproducción desde el principio.

---

## Tabla de tiempos

| Tiempo | En pantalla | Qué se dice (idea central) |
|---|---|---|
| 0:00–0:15 | Nada aún, o portada | Jorge paga un agente que actúa solo, 24/7 — y se entera por su cliente. Tres o cuatro llamadas de media hora por semana: cien horas al año entendiendo a su propio software. |
| 0:15–0:30 | Portada / primera pestaña | Un agente que solo alerta se audita leyendo la alerta. Uno que actúa necesita una ventana y un freno. Donald es las dos cosas. **"Nauta vende autonomía. Nosotros vendemos la razón por la que un cliente la firma."** |
| 0:30–0:45 | Pestaña 1 recién recargada. El pedido del operador en lenguaje natural; el plan aparece en gris | El operador escribe lo que quiere. El agente propone su plan. Gris = intención, todavía no hechos. |
| 0:45–1:05 | Los primeros pasos se encienden y narran: PO-44190, packing list | Cada paso cuenta qué buscó y qué encontró, con identificadores reales. |
| 1:05–1:20 | La factura no aparece. **Nace una tarjeta nueva hacia abajo**: contactar al proveedor | Nadie programó esa tarjeta. El agente la generó porque la necesitó. |
| 1:20–1:35 | Click en la tarjeta: el email al proveedor, visible entero. El nodo en ámbar | El email se lee ANTES de confiar en él. Ámbar = esperando, no colgado. |
| 1:35–1:50 | Compuerta humana: opciones con precio. El operador elige *"file with provisional value"*. **Tres pasos corren en paralelo** mientras el nodo del email sigue ámbar | La decisión no detiene el run: se declara el valor provisional y el trabajo sigue. Ámbar convive con progreso. |
| 1:50–2:00 | La factura llega al final; **el mismo nodo** se reanuda; las cifras se confirman; el run cierra en verde | La factura confirma las cifras: $180 de enmienda evitados. El mismo nodo, donde se quedó. Sin adivinar ningún valor. |
| 2:00–2:10 | Pestaña 2 recargada. Seis pasos en línea recta | Chequeo de llegada rutinario. Un plan aburrido, a propósito. |
| 2:10–2:35 | El BL revela el transbordo. **La línea se convierte en diamante en vivo**; un nodo queda gris con motivo | El plan cambiando no es un error: el agente aprendió algo. |
| 2:35–2:50 | La causa citada en pantalla: BL MSCUXM2213, Busan | El grafo trae su evidencia. Nadie programó esta forma. |
| 2:50–3:00 | Pestaña 3 recargada. Otro cliente: Berríos, San Juan, contenedor BERU-40022 | Otro cliente, otro país, otra falla. Cero código nuevo de frontend. |
| 3:00–3:15 | Checklist vivo dentro de una tarjeta; **una subtarea aparece a media faena, en rojo** | El mismo principio, un nivel más adentro: la tarjeta también se construye sola. El ítem rojo no es un fallo. |
| 3:15–3:30 | Compuerta humana: tres opciones con precio ($0 / $90 / $276–414). Cierre en verde | $276–414 evitados por $0. Un número que un distribuidor reconoce como dinero. |
| 3:30–3:45 | Cierre (pantalla del run terminado o portada) | Seis eventos estructurales finitos; árboles infinitos. Como HTML. De horas a 90 segundos para una decisión confiada. |
| 3:45–4:00 | Portada / contacto | El ask: el proveedor de agentes paga, por asiento supervisado. **"Nauta vende autonomía. Nosotros vendemos la razón por la que un cliente la firma."** |

---

## Guion hablado

Frases cortas. Se pueden decir tal cual. Las citas de pantalla van en inglés porque la UI está
en inglés.

### 1 · Gancho (0:00–0:30)

> Jorge dirige operaciones en un importador. Paga un agente de IA que trabaja
> veinticuatro siete y actúa solo: manda emails, reserva camiones, disputa facturas.
> Jorge no ve nada de eso. Se entera cuando su cliente lo llama.

> Tres o cuatro veces por semana, alguien le explica por teléfono qué hizo el agente.
> Media hora cada vez. Cien horas al año entendiendo a su propio software.

> Un agente que solo alerta se audita leyendo la alerta.
> Uno que actúa necesita dos cosas: una ventana para verlo trabajar, y un freno.
> Donald es las dos cosas.

> Nauta vende autonomía. Nosotros vendemos la razón por la que un cliente la firma.

> Tres casos reales, cuatro minutos.

*Nota para el presentador: las cien horas salen de `PROBLEM.md` — 3–4 llamadas por semana
× 30 minutos × 52 semanas ≈ 91–104 h/año. Redondeado a "cien horas".*

*(Recargar pestaña 1.)*

### 2 · Demo 1 — Missing invoice (0:30–2:00)

**[0:30 — el pedido y el plan gris]**

> Esto es lo que escribió el operador. Lenguaje natural, sin formularios.
> Y esto de aquí es la respuesta del agente: su plan, en gris.
> Gris significa intención. Todavía no ha pasado nada.

**[0:45 — los pasos se encienden y narran]**

> Ahora miren los pasos encenderse. No dicen "processing". Narran.
> *"Found PO-44190"* — orden de compra real. El packing list, verificado.
> Cada paso dice qué buscó y qué encontró. Eso es lo que audita Jorge, el operador.

**[1:05 — la factura falta; nace la tarjeta]**

> Y aquí se pone interesante. La factura comercial no aparece. En ningún lado.
> Un agente normal haría una de dos: fingir que sigue ocupado, o reventar el paso.
> Este hace otra cosa — miren abajo.

*(Señalar la tarjeta nueva apareciendo.)*

> Acaba de nacer una tarjeta que no estaba en el plan: contactar al proveedor.
> Nadie programó esa tarjeta. El agente la generó porque el trabajo la pidió.

**[1:20 — el email, un click; el nodo en ámbar]**

*(Click en la tarjeta.)*

> Y el email está aquí. Entero. Se lee antes de confiar en él, no después.
> El nodo se queda en ámbar. Ámbar no es "se colgó". Ámbar es: sé exactamente
> qué me falta, lo digo, y no he enviado nada a aduanas.

**[1:35 — la decisión humana; el run no se detiene]**

> Y cuando hay que decidir, la decisión llega así: opciones, cada una con su precio.

*(Leer las opciones tal cual aparecen en pantalla, con sus números.)*

> El operador elige *"file with provisional value"*. Y fíjense en lo que NO pasa:
> el run no se detiene a esperar al proveedor. Tres pasos arrancan en paralelo
> mientras el nodo del email sigue en ámbar. Ámbar no bloquea el trabajo que sí puede avanzar.

> En la corrida real esto tardó lo que tardó. La reproducción respeta los tiempos originales.

**[1:50 — la factura llega y el cierre]**

> Y al final llega la factura del proveedor — y miren: se reanuda el MISMO nodo.
> No un plan nuevo, no desde cero. El mismo paso, donde se quedó.
> La factura confirma las cifras: $180 de enmienda evitados.
> El run termina en verde sin haber adivinado un solo valor. Eso es el freno funcionando.

*(Recargar pestaña 2.)*

### 3 · Demo 2 — Replan (2:00–2:50)

**[2:00 — la línea recta]**

> Segundo caso. Un chequeo de llegada rutinario. Seis pasos, una línea recta.
> Un plan aburrido. A propósito.

**[2:10 — el descubrimiento y el rewire]**

> El agente lee el bill of lading y descubre algo que no estaba en el booking:
> un transbordo en Busan. Ese solo hecho invalida medio plan.
> Y ahora miren el grafo.

*(Silencio de 3–4 segundos mientras la línea se convierte en diamante.)*

> El plan cambiando no es un error. Significa que el agente aprendió algo.
> Un paso se retira — en gris, con su motivo escrito, no desaparece en silencio.
> Entran cuatro pasos nuevos y las dependencias se recablean. Una línea se volvió un diamante.

**[2:35 — la causa citada]**

> Y la causa está citada ahí, en pantalla, con su evidencia: *BL MSCUXM2213*, Busan.
> Sin la causa, un replan parece que el agente se equivocó.
> Con la causa, es un sistema que aprende delante de ti.

> Este es el momento clave de todo el pitch: **nadie programó ese grafo.**
> No existe un archivo con esa forma. Salió del trabajo.

*(Recargar pestaña 3.)*

### 4 · Demo 3 — Berríos (2:50–3:30)

**[2:50 — otro mundo]**

> Tercer caso, y cambiamos de mundo. Berríos, un distribuidor en San Juan, Puerto Rico.
> Transporte terrestre, no marítimo. El contenedor BERU-40022 se queda sin camión
> y el tiempo libre del puerto vence antes del siguiente hueco del transportista.
> Otro cliente, otro país, otra falla — y cero código nuevo de frontend.
> Esta pantalla nunca se diseñó. Se está construyendo sola, otra vez.

**[3:00 — el checklist vivo]**

> Y el mismo principio funciona un nivel más adentro. Miren dentro de esta tarjeta:
> un checklist que el agente declaró al entrar al paso, resolviéndose ítem por ítem.

*(Señalar la subtarea nueva, en rojo.)*

> Ese cuarto ítem no existía hace treinta segundos. El agente descubrió un feriado
> local en San Juan y añadió la verificación a media faena. La tarjeta creció para contarlo.
> Y el ítem rojo no es un fallo. Es el agente diciendo: es la primera vez que esto
> pasa en esta ruta en noventa días.

**[3:15 — la compuerta y el dinero]**

> Y termina donde debe: una compuerta humana. Tres opciones, cada una con su precio.
> Transportista alterno el miércoles: cero dólares. Extensión de puerto: noventa.
> Aceptar el retraso: doscientos setenta y seis a cuatrocientos catorce.
> El operador elige la primera. Resultado: $276 a $414 de exposición evitados, por $0.
> Ese es un número que un distribuidor reconoce como dinero.

### 5 · Cierre (3:30–4:00)

> ¿Y esto no son tres pantallas prefabricadas? No. En un grafo solo pueden pasar
> seis cosas: aparece un nodo, cambia de estado, produce evidencia, se abre a una
> decisión, se dibuja una arista, o el plan cambia. Seis eventos. Los escribimos una vez.

> Es la misma idea de HTML: *"HTML has about 110 tags and can render any page that exists.
> Tags are finite. Trees are infinite."*
> Seis eventos finitos. Estructuras infinitas. Por eso la interfaz se construye sola.

> La métrica: hoy, entre que el agente detecta un problema y Jorge decide con confianza,
> pasan horas. Con Donald, noventa segundos. Y las tres o cuatro llamadas semanales
> de "explícame qué pasó" desaparecen.

> Lo que pedimos no es un piloto genérico. Es un comprador concreto: el proveedor de
> agentes que actúan. Él paga, por asiento supervisado, porque Donald le quita su
> objeción de venta más cara: "¿cómo confío en algo que ya actuó?".
> El protocolo son cinco verbos sobre MCP. Cualquier agente que los hable se vuelve
> supervisable, sin tocar su lógica.

> Nauta vende autonomía. Nosotros vendemos la razón por la que un cliente la firma.
> Gracias.

---

## Riesgos y plan B

| Riesgo | Plan B |
|---|---|
| Una grabación no carga o se ve congelada | Recargar la página: la reproducción se reinicia desde el principio. Las tres pestañas están abiertas de antemano; recargar la siguiente mientras se habla del cierre de la anterior. |
| "¿Esto es un video?" | No. Es la app real reproduciendo el log de eventos real de un run que ocurrió. Mismo reducer, mismos componentes, misma capa de presentación que el modo en vivo — solo cambia el transporte. Se puede abrir el drawer en vivo delante del jurado y hacer zoom. |
| "¿Y el backend?" | Existe y está desplegable: Go + MCP + MySQL, la misma UI corre contra la API en vivo cuando está arriba — es una sola variable de entorno (`NEXT_PUBLIC_DONALD_API`). El frontend no distingue una cosa de la otra. |
| "¿No son pantallas predefinidas?" | El agente no construye animaciones; construye estructura. Seis eventos estructurales escritos una vez; el contenido y el árbol vienen del agente en runtime. La prueba son las tres formas distintas que acaban de ver con el mismo código. |
| Se acaba el tiempo a mitad de la demo 2 | El momento irrenunciable es el rewire (línea → diamante). Si hay que cortar, se corta la demo 3 y se salta al cierre con una frase: "el tercer caso — otro cliente, otro país, cero código nuevo — está corriendo en esta pestaña; lo enseño en preguntas." |
| Pregunta técnica profunda (esquema, eventos) | `agent_event` es la fuente de verdad, append-only, con `sequence` monotónico por run; nodos y aristas son snapshots materializados. La forma del grafo se calcula de las aristas, nunca se dibuja a mano. |

## Preguntas hostiles — respuestas de 15 segundos

| Pregunta hostil | Respuesta |
|---|---|
| "¿Esto no es LangSmith / observabilidad?" | LangSmith enseña trazas a quien escribió el agente. Donald enseña el trabajo a quien paga las consecuencias — que no es técnico. Y no solo mira: hay freno y volante, opciones con precio a media corrida. |
| "¿Por qué Nauta no lo hace en un sprint?" | Pueden — para SU agente. Esto son cinco verbos sobre MCP: cualquier agente los habla. Con tres proveedores, Jorge no quiere tres ventanas. Y Nauta vende más con nuestra ventana que construyendo la suya. |
| "¿Quién paga y cuánto?" | El proveedor de agentes, por asiento supervisado. Somos la respuesta a su objeción de compra más cara: "¿cómo confío en algo que ya actuó?". |
| "El freno es advisory. No frena nada." | Correcto, y lo decimos así: el freno se escribe como evento y el agente lo honra en su siguiente `check_instructions`. Lo garantizado es otra cosa: cuando falta un dato, no adivina — se pone en ámbar, dice qué falta, y reanuda el mismo nodo. |
| "¿$78 de ahorro? Eso es un café." | $78 es solo el trabajo de oficina. El número de negocio es $414 de exposición evitados por $0, decidido en 90 segundos. Y corre 4,812 veces en este cliente. |

## NO decir

- **No prometer features congeladas.** Ni el robot animado (`feat/donald-robot-motion`) ni
  los subtasks-en-nuzur (`feat/node-subtasks` como feature de producto futuro). Lo que se ve
  en las grabaciones es lo que se afirma.
- **No citar cifras que no estén en las grabaciones.** Si un número no aparece en pantalla,
  no sale de tu boca. Ante la duda, leer el número de la pantalla, no de memoria.
- **No decir "kill switch".** Las intervenciones son advisory: el agente las recibe en su
  siguiente `check_instructions` y las honra si puede. Decir "freno" y, si preguntan,
  explicarlo honestamente — eso es supervisión honesta, no control remoto.
- **No decir que competimos con Nauta ni que hacemos su pipeline.** Nauta decide qué hacer
  con el embarque; Donald decide qué ve Jorge y cuándo interviene. Dos decisiones distintas.
- **No decir "demo en vivo contra producción"** si el endpoint no ha vuelto. La frase segura:
  "corre igual contra la API en vivo cuando está arriba, misma UI".
- **No decir "dashboard".** No hay filtros ni vistas guardadas y eso es deliberado. Es una
  superficie de supervisión: un run, una pantalla.
