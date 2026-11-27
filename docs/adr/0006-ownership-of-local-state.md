# 0006. Dueños del estado local y adaptadores de entrada

Fecha 2026-11-27 · Aceptada

La cola de Canvas debe registrar la intención antes de descargar el módulo de sincronización. El sincronizador debe leer ese registro cuando reproduzca guardados y borrados. Compartían un archivo con responsabilidades de entrada y persistencia, lo que creaba una dependencia circular.

`pendingCloudOperations.ts` posee las dos claves de localStorage y el conjunto de borrados locales activos. `cloudQueue.ts` registra la intención y carga el runtime bajo demanda. `canvasCloudSync.ts` coordina las operaciones remotas y accede directamente al registro. Las claves, los formatos y el momento de persistencia conservan su semántica.

Importar el sincronizador de forma estática desplazaría la carga al montaje de Canvas. Inyectar callbacks exigiría registrar el runtime antes de poder escribir la intención. El módulo de persistencia compartido evita ambos costes.

Las pruebas de sincronización cubren la escritura previa a la carga, la reproducción de borrados offline y la restauración. La guarda de imports impide los enlaces directos que formaban el ciclo. El presupuesto del bundle protege el arranque diferido.

En tests de AutoIMG, el usuario activo también tiene un único propietario por proceso. Un probe de 15 pares concurrentes reprodujo 15 fallos con una ruta compartida y pasó 30 de 30 ejecuciones con directorios únicos. El helper de tests elimina su directorio en la salida normal o explícita.
