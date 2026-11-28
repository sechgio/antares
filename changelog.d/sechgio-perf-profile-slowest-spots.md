### Changed

- El lienzo responde con menos trabajo por frame al arrastrar y redimensionar selecciones grandes: las guías de alineación y los estilos visuales del gesto reutilizan tablas planas y handles resueltos una sola vez por gesto.
- Guardar el historial del lienzo ya no re-procesa las entradas que no cambiaron; los guardados repetidos sin cambios son prácticamente inmediatos.
### Fixed

- El arranque del backend valida los datos de cada ejecución mucho más rápido al compilar las validaciones una sola vez en lugar de interpretar los esquemas en cada guardado.
