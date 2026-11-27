### Added

- Memoria del agente: los hechos y preferencias pueden fijarse como esenciales (`essential`), inyectándose en cada conversación aunque no mencionen el tema, sin consumir el cupo de recuerdos por relevancia. El usuario fija y desfija desde el menú de memoria (acciones `pin`/`unpin` con insignia «Fijado») y el agente puede proponerlo con el parámetro `essential` de `memory_remember`.

- Las tarjetas de pregunta del agente (`ask_user`) ganan encabezados cortos, opciones con descripción y selección múltiple (`multiSelect`): las respuestas múltiples se envían unidas en orden canónico de las opciones. Cambio de contrato aditivo; las opciones de texto plano siguen aceptándose. El techo del prompt base sube de 18100 a 18200 tokens: el esquema ampliado de `ask_user` cuesta ~45 tokens y no existe vía mínima sin recortar guía de uso de otras herramientas.

- Captura de memoria post-conversación: minutos después de que un turno termina en silencio, una pasada LLM separada y acotada en presupuesto extrae hechos y preferencias duraderos del tramo nuevo de la conversación (con evidencia literal obligatoria y deduplicación contra los recuerdos vigentes), en lugar de esperar a la consolidación nocturna. Los recuerdos capturados llegan como inferidos, confirmables o descartables desde el menú de memoria; una marca de agua por conversación evita reescanear tramos y se avanza aunque el modelo falle, sin bucles. Sesiones en incógnito, delegaciones y perfiles sin memoria quedan fuera.

### Changed

- La escritura de memoria (`memory_remember`, `procedure_learn`) ya no pide aprobación en caliente: cada cambio se muestra en la conversación como una tarjeta visible («Recuerdo guardado» / «Procedimiento aprendido») y el usuario conserva el control posterior (corregir, desactivar, borrar) desde el menú de memoria.
