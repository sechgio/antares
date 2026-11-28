### Security

- Antares pide confirmación nativa al activar Acceso completo o aprobar una acción del agente. Los adjuntos arrastrados requieren un archivo autorizado.
- La exportación HTML a PDF y la plantilla Excel comprueban el destino efectivo antes de sobrescribir. Los PDF de Ubicaciones conservan la versión previa si falla la escritura.
- Las conexiones conservan las credenciales dentro del origen o registro autorizado. El IPC limita las solicitudes simultáneas y descarta las respuestas de procesos anteriores.
