# Nauta dummy

Simulador finito del pipeline de Nauta para la demo de supervisión.
Existe porque el equipo aún no tiene acceso a la API real de Nauta.

Emite seis eventos: `INGEST`, `EXTRACT`, `RECONCILE`, `DETECT`, `IMPACT` y `PLAN`.
Los escenarios `run-A` y `run-B` leen los fixtures incluidos y terminan después de `PLAN`.

Desde `backend/`:

```powershell
python -m nauta_dummy --scenario run-B
python -m nauta_dummy --scenario run-A --speed 8
```

`--speed 0` elimina las pausas y `--seed 23` hace reproducible el ritmo.

Desde la raíz, ejecuta las pruebas con:

```powershell
python -m unittest discover -s backend/nauta_dummy/tests
```

Este módulo es la seam que se sustituirá por el cliente de la API real de Nauta.
