# D1 — Presencia y sincronización Canvas en vivo

**Fecha:** 2026-08-31
**Estado:** diseño aprobado para revisión escrita
**Alcance:** colaboración tipo B: una persona edita y otras personas conectadas ven los snapshots guardados en vivo.

## 1. Resumen

Canvas añadirá presencia y avisos de guardado en tiempo real usando un canal privado de Supabase Realtime por documento. Realtime transportará únicamente invalidaciones pequeñas; el documento real seguirá viajando por el canal de datos existente y continuará protegido por LWW, snapshots de versiones y la barra de conflictos actual.

El resultado esperado es:

> Cuando una persona guarda, los espectadores conectados ven la nueva versión automáticamente después del autosave. Si un espectador también tiene cambios locales, su trabajo nunca se reemplaza de forma silenciosa.

La actualización en vivo significa sincronización por snapshot guardado, normalmente dentro de 1–3 segundos según el autosave actual. No significa replicación de cada tecla, movimiento del mouse ni edición carácter a carácter.

## 2. Contexto actual

La aplicación ya es local-first:

- El editor usa el documento en disco como fuente inmediata y puede trabajar sin conexión.
- `canvasCloudSync.ts` hace pull/push de documentos completos y aplica LWW mediante `updatedAt`.
- Existe un RPC atómico de push y una tabla de snapshots anteriores para conservar versiones que pierden una carrera LWW.
- `useCanvasHistory.ts` mantiene undo/redo local, limitado a 30 pasos y un presupuesto agregado de 64 MB.
- El autosave local ocurre aproximadamente a los 1.2, 1.8 o 2.5 segundos según el tamaño del documento.
- El sync global se dispara al recuperar foco; no existe aún un canal Canvas Realtime.
- `@supabase/supabase-js` ya está instalado y otros módulos ya usan canales Realtime.

El documento se almacena como `jsonb` en `canvas_documents` y puede contener imágenes serializadas. Por eso no se debe usar el cuerpo de esa fila como payload frecuente de Realtime.

## 3. Decisión de diseño

Se adopta **Supabase Broadcast + Presence por documento**.

### 3.1. Fuente de verdad

| Dato | Fuente canónica | Función de Realtime |
| --- | --- | --- |
| Documento abierto | Archivo local durante la edición; `canvas_documents` después del push | Ninguna; solo avisa que cambió |
| Orden y contenido remoto | `canvas_documents` + RPC LWW | Ninguna; el receptor siempre hace pull |
| Undo/redo | Historial local por dispositivo | No se replica |
| Versiones históricas | `canvas_document_versions` | No se replica |
| Usuarios conectados | Presence del canal | Estado efímero de colaboración |

Un mensaje Realtime nunca puede convertirse directamente en un `CanvasDocument` ni activar una escritura local por sí solo.

### 3.2. Canal

Cada documento activo usa un canal privado con el topic:

```text
canvas-document:<documentId>
```

Solo se mantiene el canal del documento activo y solo mientras Canvas esté activo. Al cambiar de documento, desmontar Canvas o cerrar sesión, el canal anterior se elimina.

### 3.3. Contratos

Evento Broadcast:

```ts
type CanvasDocumentSavedEvent = {
  type: 'document_saved';
  documentId: string;
  updatedAt: string;
  updatedBy: string;
};
```

El evento no contiene `document`, `layers`, imágenes, historial ni datos de formulario.

Presence:

```ts
type CanvasPresence = {
  userId: string;
  displayName: string;
  mode: 'viewing' | 'editing';
};
```

`mode` cambia solo en transiciones relevantes: al aparecer el primer dirty/baseline local pasa a `editing`; después de un guardado exitoso y al quedar limpio vuelve a `viewing`. No se publica una actualización por cada mutación.

## 4. Límites entre módulos

### `canvasCloudSync.ts`

Conserva la responsabilidad de persistencia remota: sesión, pull dirigido, push LWW, borrado, versiones y construcción de conflictos. Debe exponer una operación de pull dirigida a un único `documentId` para eventos Realtime.

El pull dirigido debe devolver uno de estos resultados semánticos:

- remoto igual o anterior: ignorar;
- remoto nuevo y documento local limpio: persistir snapshot en disco con `touch: false` y aplicarlo;
- remoto nuevo y documento local sucio: devolver `SyncConflict`;
- documento borrado remotamente: devolver conflicto de borrado;
- error de red, RLS, timeout o hidratación: conservar el estado local y devolver error.

El pull dirigido debe persistir el snapshot remoto en el store local antes de pedir al editor que lo reemplace. Si esa escritura local falla, no se aplica el snapshot en memoria: el documento local actual sigue siendo la fuente segura.

No debe ejecutar el sync global de toda la biblioteca ante cada evento de documento.

### `canvasRealtime.ts`

Nuevo adaptador aislado de Supabase Realtime. Sus responsabilidades son:

- abrir/cerrar el canal privado;
- publicar y actualizar Presence;
- publicar `document_saved`;
- normalizar estados `connecting`, `live`, `error` y `offline`;
- validar la forma mínima de los mensajes entrantes.

Este módulo no lee ni escribe `canvas_documents`.

### `useCanvasSync.ts`

Coordina los disparadores de sincronización:

- conserva el sync global por foco y arranque;
- conecta el canal del documento activo;
- coalesce avisos Realtime durante 300–500 ms;
- permite como máximo un pull dirigido en vuelo;
- conserva el timestamp más nuevo si llegan eventos durante ese pull;
- entrega al editor el resultado de aplicar snapshot o conflicto.

### `cloudQueue.ts`

El push en cola debe publicar el evento únicamente después de que el push remoto haya sido aceptado. Un push rechazado por LWW, fallido o sin sesión no publica nada. El mismo requisito aplica al push aceptado durante el sync de arranque/foco.

### `CanvasView.tsx`

Proporciona el documento activo, `openDirtyRef`, estado de actividad, selección y callbacks de reemplazo/conflicto. Tras aplicar un snapshot remoto debe:

- hidratar imágenes;
- reemplazar el documento mediante `history.replaceDocument`;
- filtrar selecciones cuyos layers ya no existan;
- ajustar la página activa si dejó de existir;
- dejar que la persistencia existente escriba el historial vacío del nuevo snapshot.

## 5. Flujo principal

```text
Canvas activo
    ↓
Suscribir canvas-document:<id>
    ↓
Presence: viewing/editing
    ↓
Push LWW aceptado por Supabase
    ↓
Broadcast { documentId, updatedAt, updatedBy }
    ↓
Espectadores coalescen eventos
    ↓
Pull dirigido del snapshot remoto
    ├── remoto igual/anterior → ignorar
    ├── local limpio → hidratar y reemplazar
    └── local sucio → conservar local y mostrar conflicto
```

Cuando el canal pasa a `SUBSCRIBED`, se hace un único pull dirigido para cerrar la ventana entre la carga del documento y la suscripción, pero solo después de que termine el bootstrap inicial protegido. Durante ese bootstrap se puede abrir el canal y mostrar Presence, pero los eventos recibidos no se aplican ni se reproducen posteriormente; el `guarded` sync inicial sigue siendo la autoridad local-first. Al reconectar después de un error, cuando el documento ya está fuera del bootstrap, también se hace un pull dirigido.

El reemplazo remoto no genera un nuevo push: `replaceDocument` deja el documento limpio y rompe cualquier ciclo de eco. Una resolución de conflicto con “Mantener mi versión” sí hace un push forzado y, si es aceptado, genera un nuevo evento.

## 6. Comportamiento de estados

### Espectador limpio

Recibe el evento, obtiene la versión más nueva y la aplica sin intervención. El estado de UI indica una actualización breve, pero no bloquea el editor.

### Usuario con cambios locales

El pull obtiene el snapshot remoto para construir el conflicto, pero no modifica el documento abierto. Se reutiliza `SyncConflictBar` con las acciones existentes:

- mantener la versión local y volver a publicarla;
- usar la versión remota y reiniciar el historial local.

### Gesto, panel o renombrado en curso

Se considera sucio mediante `openDirtyRef`, aunque todavía no exista un autosave. No se reemplaza el documento durante esa interacción.

### Documento borrado remotamente

Se conserva el flujo de conflicto de borrado existente. El documento abierto nunca se elimina automáticamente por un evento Realtime.

## 7. Seguridad y recuperación

El canal será privado. La autorización debe comprobar autenticación, usuario activo y acceso al documento, alineándose con las políticas RLS de `canvas_documents`. No se usarán topics públicos para documentos.

El cliente debe tratar todo evento Broadcast como no confiable:

- comprobar que el `documentId` coincide con el topic;
- comprobar que `updatedAt` es una fecha válida;
- no aceptar campos fuera del contrato;
- volver a consultar Supabase antes de aplicar cualquier cambio.

Fallos y respuesta:

| Fallo | Respuesta |
| --- | --- |
| Supabase no configurado | edición local sin presencia ni avisos |
| canal en timeout/error | indicador de error y fallback por foco |
| evento perdido | pull al reconectar, enfocar o abrir documento |
| evento atrasado | ignorar mediante `isNewer` |
| pull remoto fallido | conservar documento local y reintentar después |
| documento o imagen remota inválida | no reemplazar; conservar local y marcar error |
| usuario deshabilitado/cierre de sesión | cerrar canales y retirar Presence |

Realtime puede perder avisos; nunca puede ser el único mecanismo de consistencia ni de recuperación de datos.

## 8. Rendimiento y límites

- No se transmite el `jsonb` del documento por Broadcast.
- Un evento no ejecuta `canvasList()` ni sincroniza documentos ajenos.
- Los eventos de una ráfaga se coalescen durante 300–500 ms.
- Solo hay un pull dirigido en vuelo por documento activo.
- Se conserva el evento más nuevo recibido durante un pull para no retroceder.
- La cadencia visible queda limitada por el autosave actual, no por una nueva frecuencia de red.
- El historial, las imágenes y las versiones remotas no se introducen en el canal Realtime.

## 9. Pruebas de aceptación

### Unitarias

1. Se publica `document_saved` solo tras un push aceptado.
2. Un push rechazado por LWW no publica ningún evento.
3. Ningún payload Broadcast contiene documento, layers, imágenes o historial.
4. El canal se crea con topic por documento y se elimina en cleanup.
5. Se ignoran mensajes de otro documento o con timestamp inválido.
6. Un evento atrasado no reemplaza una versión aplicada más nueva.
7. Una ráfaga genera un único pull dirigido.
8. Un documento limpio se reemplaza una sola vez y reinicia undo/redo.
9. Un documento sucio genera conflicto y no llama `replaceDocument`.
10. Un error de Realtime o de pull conserva el documento local.
11. Una reconexión dispara un pull dirigido.
12. Presence cambia entre `viewing` y `editing` sin publicar por cada edición.

### Integración

Dos clientes abren el mismo documento. El cliente A edita y guarda; el cliente B, limpio, recibe y visualiza el nuevo snapshot. Después B edita localmente; A guarda otra vez; B conserva sus cambios y muestra el conflicto. Al seleccionar la versión remota, B reemplaza el documento y limpia su historial local.

### Criterios de éxito

- Un espectador limpio ve el cambio después de un autosave, normalmente en 1–3 segundos.
- La edición local, el autosave a disco y el historial siguen funcionando sin conexión.
- Ningún usuario con cambios locales pierde su contenido por un evento remoto.
- Al cambiar de documento no quedan listeners ni Presence del documento anterior.
- La reconexión recupera el snapshot actual incluso si se perdió el Broadcast.

## 10. Observabilidad

Registrar, sin incluir contenido del documento:

- transición de estado del canal;
- cantidad de colaboradores Presence;
- latencia evento → pull → aplicación;
- eventos ignorados por ser atrasados;
- cantidad de conflictos;
- fallos de autorización, pull e hidratación;
- reconexiones.

## 11. Fuera de alcance y evolución

D1 no fusiona dos snapshots sucios, no replica undo/redo y no implementa Yjs/CRDT.

Una futura D2 puede reutilizar `CanvasDiff` como base para operaciones remotas, pero necesitaría una revisión separada de granularidad, revisiones de servidor, idempotencia y conflictos por layer/campo. El historial local debe seguir siendo un modelo independiente del log colaborativo; no se debe convertir automáticamente uno en el otro.
