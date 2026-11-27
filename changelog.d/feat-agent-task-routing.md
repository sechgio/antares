### Added

- Los encargos del agente pueden dirigirse a otro agente: `task_schedule` y `agent_tasks_save` aceptan `agent` (id o nombre único de un agente guardado) en create, update y enqueue. El encargo lo crea y administra la sesión origen — lo lista, edita y cancela — pero se entrega a la conversación más reciente del agente destino y corre con sus reglas, herramientas y permisos; nada del perfil origen se hereda. Los triggers (`file_changed`, `task_completed`) también encadenan al destino: el encargo generado cae en su cola.
