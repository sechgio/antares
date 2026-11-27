### Added

- Memoria del agente: los hechos y preferencias pueden fijarse como esenciales (`essential`), inyectándose en cada conversación aunque no mencionen el tema, sin consumir el cupo de recuerdos por relevancia. El usuario fija y desfija desde el menú de memoria (acciones `pin`/`unpin` con insignia «Fijado») y el agente puede proponerlo con el parámetro `essential` de `memory_remember`.

### Changed

- La escritura de memoria (`memory_remember`, `procedure_learn`) ya no pide aprobación en caliente: cada cambio se muestra en la conversación como una tarjeta visible («Recuerdo guardado» / «Procedimiento aprendido») y el usuario conserva el control posterior (corregir, desactivar, borrar) desde el menú de memoria.
