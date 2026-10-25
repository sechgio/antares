# 0001. Esperas y eventos del agente

- Fecha: 2026-10-25
- Estado: aceptado
- Personas: sechgio

## Contexto

El agente necesitaba dormir dentro de un turno esperando un build, un despliegue, un correo o una delegación y reanudar exactamente donde estaba. `task_schedule` no sirve para eso: cierra el turno y reinyecta un mensaje nuevo, así que el modelo reconstruye el contexto. pi-durable ya mantiene herramientas seguras bloqueadas y las recupera tras reiniciar, y las aprobaciones demuestran que una llamada puede esperar sin romper el motor.

Además, la espera debía cubrir procesos largos sin abrir un listener entrante ni convertir al agente en un cliente HTTP arbitrario.

## Decisión

Usamos `wait_event` como herramienta meta de solo lectura, bloqueante y durable, con fuentes en allowlist: tiempo, archivo autorizado, operación de AutoIMG, delegación propia, job de shell, correo nuevo de Gmail o Microsoft, ejecución de GitHub Actions y estado HTTP de despliegue. El estado vive en `WaitsDoc`; el turno se reanuda en el mismo punto.

Los jobs de shell se inician con `shell_job_start` (aprobación obligatoria), viven como máximo 30 minutos, se limitan a 2 por conversación y 4 globales, escriben salida paginable y se matan con el árbol de procesos al cancelar o cerrar.

El correo es de solo lectura con los scopes `gmail.readonly` y `Mail.Read`: sin enviar, sin adjuntos y sin cuerpo en la espera. GitHub usa la conexión existente y solo hace GET. HTTP acepta únicamente HTTPS público o loopback local, sin credenciales, redirecciones ni cuerpo, y bloquea direcciones privadas por DNS.

Cada turno tiene un presupuesto de 30 minutos de espera. No hay listener HTTP entrante ni webhook.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Reutilizar `task_schedule` con condiciones | Termina el turno y pierde el punto exacto; la espera precisa exige una herramienta bloqueante. |
| Webhook o servidor HTTP local para eventos | Superficie de red nueva, autenticación, NAT y ciclo de vida; no hace falta para los casos pedidos. |
| Sondeo genérico de cualquier herramienta de lectura | Permitiría saltarse aprobaciones y repetir efectos; la allowlist mantiene los permisos existentes. |
| Un cliente HTTP arbitrario | SSRF, credenciales y redirecciones; el sondeo de estado con allowlist cubre salud de despliegue. |
| Solo Gmail o solo Microsoft | Ambas conexiones ya existen; el patrón es el mismo y el usuario puede tener cualquiera de las dos. |
| Guardar la salida de jobs solo en memoria | Se perdería al reiniciar; se reutiliza `shell_output` con archivos atómicos por sesión. |

## Consecuencias

- La espera usa sondeo (750 ms local, 1–5 s para fuentes remotas) más un notificador en proceso para delegaciones y AutoIMG; no es un bus de eventos.
- `gmail.readonly` es un scope restringido de Google: la app pública puede exigir verificación. Las conexiones existentes muestran permisos faltantes y piden reconectar.
- Las conexiones Microsoft y GitHub existentes requieren reautorización para `Mail.Read` y para leer Actions.
- Los jobs de shell mueren al cerrar Antares; no sobreviven a un cierre forzado del backend. La espera marca `interrupted` si el proceso ya no está.
- Una espera HTTP mantiene un riesgo residual de DNS rebinding entre la validación y la petición; se mitiga con allowlist, sin credenciales, sin redirecciones y sin cuerpo, y se documenta aquí.
- Los límites se verifican en `tests/test-agent-events.js`, `tests/test-agent-http.js`, `tests/test-agent-cloud-connectors.js`, `tests/test_agent_computer.py`, `tests/test-electron-agent-tray.js` y las pruebas de catálogo IPC.
