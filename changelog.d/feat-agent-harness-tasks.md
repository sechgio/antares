### Fixed

- Los encargos programados ya no se marcan como entregados al encolar la entrada: la entrega se completa cuando el turno termina de verdad, los fallos quedan registrados como inciertos y los encadenamientos `task_completed` se disparan solo tras completarse.
- Las tareas en cola y programadas reanudan solas un turno interrumpido por límite de pasos (hasta tres continuaciones) en lugar de quedar pausadas esperando intervención.
- Al reanudar un turno pausado, el agente recibe el checkpoint registrado (pasos pendientes y lo ya verificado) en lugar de depender solo de su memoria del historial.
- Un paso del plan marcado como fallado ya cuenta como trabajo sin resolver: el agente debe corregirlo o replantearlo antes de cerrar el encargo.
- Antes de cerrar un encargo con efectos, el motor exige una observación que verifique el resultado si el modelo no la hizo por sí mismo.
- La evidencia de los pasos del plan admite `evidence_ref` estructurada (tool_call, archivo, artefacto o url) validada contra las herramientas ejecutadas en el turno.
- La evaluación conductual (`scripts/agent-eval.js`) puntúa aserciones de comportamiento: planificar encargos multi-paso, evidenciar los pasos cerrados y no repetir llamadas idénticas.

### Changed

- La delegación filtra las herramientas del agente delegado por la capacidad explícita `delegable` en lugar de la ubicación de implementación de la herramienta.
