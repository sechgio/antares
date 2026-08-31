# Presencia y sincronización Canvas en vivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Añadir colaboración Canvas de bajo riesgo: presencia de usuarios y aviso en vivo de documentos guardados, sin introducir CRDT ni cambiar el modelo local-first, el historial local o el LWW existente.

**Architecture:** Un canal Supabase Realtime privado por documento (`canvas-document:<documentId>`) transportará únicamente eventos efímeros. Broadcast anunciará un snapshot guardado y Presence anunciará quién está viendo/editando. El cliente validará el evento, volverá a leer el snapshot canónico mediante `canvasCloudSync`, persistirá primero la copia remota en disco local y solo después reemplazará el documento abierto si sigue limpio. La cola cloud publicará únicamente después de un push LWW aceptado.

**Tech Stack:** React, TypeScript, Vitest, Supabase JS `^2.108.2`, Supabase Realtime Broadcast/Presence, PostgreSQL RLS/migrations, backend IPC Canvas existente.

## Global Constraints

- Mantener el comportamiento local-first y el LWW actual; no reemplazar `canvas_push_document_lww`.
- No sincronizar capas, historial, imágenes, cursores ni movimientos de mouse por Realtime.
- No modificar `useCanvasHistory.ts`, `MAX_HISTORY`, `canvas_documents` ni el formato JSONB del documento.
- Un evento Realtime es solo una invalidación; el snapshot siempre se obtiene desde `canvas_documents`.
- Una actualización remota limpia debe guardarse en disco con `touch:false` antes de llamar a `replaceDocument`.
- Si la pestaña está sucia, mostrar el conflicto existente y no sobrescribir memoria ni disco local.
- Durante el bootstrap inicial `runCloudSync(true)`, ignorar eventos recibidos y no reproducirlos después; el bootstrap sigue siendo la autoridad inicial.
- Reutilizar los patrones de `frontend/src/components/espacios/api/realtime.ts` y no introducir otro cliente Supabase.
- Cada tarea debe dejar pruebas ejecutables y un commit pequeño, salvo que la verificación descubra un ajuste necesario en la misma tarea.

---

## Task 1: Autorizar canales privados de Canvas en Supabase

**Files:**

- Create: `supabase/migrations/20260831120000_canvas_realtime_authorization.sql`
- Create: `tests/test_canvas_realtime_sql.py`

### Step 1: Escribir la prueba estática de migración

Añadir una prueba que localice la migración por prefijo y compruebe que declara políticas `SELECT` e `INSERT` sobre `realtime.messages`, limita `extension` a `broadcast`/`presence`, restringe el topic a `canvas-document:` y exige `public.is_active_user()`. La prueba también debe exigir `DROP POLICY IF EXISTS` para que aplicar la migración repetidamente sea idempotente.

```python
from pathlib import Path


MIGRATIONS = Path(__file__).parents[1] / "supabase" / "migrations"


def _migration() -> str:
    matches = sorted(MIGRATIONS.glob("20260831120000_canvas_realtime_authorization.sql"))
    assert len(matches) == 1
    return matches[0].read_text(encoding="utf-8").lower()


def test_canvas_realtime_policies_are_private_and_idempotent() -> None:
    sql = _migration()
    assert "drop policy if exists" in sql
    assert "on realtime.messages" in sql
    assert "for select" in sql
    assert "for insert" in sql
    assert "extension in ('broadcast', 'presence')" in sql
    assert "realtime.topic() like 'canvas-document:%'" in sql
    assert "public.is_active_user()" in sql
```

### Step 2: Añadir las políticas RLS

Crear dos políticas para usuarios autenticados activos. La política de lectura permitirá recibir mensajes y la de inserción permitirá publicar mensajes únicamente en topics Canvas y para extensiones Broadcast/Presence. El modelo actual no tiene ACL por documento: cualquier usuario activo puede acceder a la biblioteca compartida, por lo que la condición de acceso correcta en esta iteración es `public.is_active_user()`.

```sql
drop policy if exists "canvas_realtime_receive" on realtime.messages;
drop policy if exists "canvas_realtime_send" on realtime.messages;

create policy "canvas_realtime_receive"
on realtime.messages
for select
to authenticated
using (
  public.is_active_user()
  and extension in ('broadcast', 'presence')
  and realtime.topic() like 'canvas-document:%'
);

create policy "canvas_realtime_send"
on realtime.messages
for insert
to authenticated
with check (
  public.is_active_user()
  and extension in ('broadcast', 'presence')
  and realtime.topic() like 'canvas-document:%'
);
```

### Step 3: Ejecutar la prueba y revisar el diff

Run: `pytest tests/test_canvas_realtime_sql.py -q`

Expected: la prueba nueva pasa y `git diff --check` no reporta whitespace.

### Step 4: Commit

```bash
git add supabase/migrations/20260831120000_canvas_realtime_authorization.sql tests/test_canvas_realtime_sql.py
git commit -m "feat: authorize canvas realtime channels"
```

## Task 2: Crear el transporte aislado Broadcast/Presence

**Files:**

- Create: `frontend/src/components/canvas/sync/canvasRealtime.ts`
- Create: `frontend/src/components/canvas/sync/canvasRealtime.test.ts`

### Step 1: Definir tipos y contrato público

Crear tipos explícitos para evitar que el resto de Canvas conozca detalles de Supabase:

```ts
export type CanvasDocumentSavedEvent = {
  type: 'document_saved';
  documentId: string;
  updatedAt: string;
  updatedBy: string;
};

export type CanvasPresence = {
  userId: string;
  displayName: string;
  mode: 'viewing' | 'editing';
};

export type CanvasCollaborator = CanvasPresence & { presenceKey: string };
export type CanvasRealtimeStatus = 'idle' | 'connecting' | 'live' | 'error' | 'offline';

export type CanvasRealtimeHandlers = {
  onSaved: (event: CanvasDocumentSavedEvent) => void;
  onPresence: (collaborators: CanvasCollaborator[]) => void;
  onStatus: (status: CanvasRealtimeStatus) => void;
};

export type CanvasRealtimeSubscription = {
  publishSaved: (event: CanvasDocumentSavedEvent) => Promise<boolean>;
  updatePresence: (presence: CanvasPresence) => Promise<boolean>;
  close: () => Promise<void>;
};

export function canvasDocumentTopic(documentId: string): string;
export function getCanvasPresenceIdentity(): Promise<CanvasPresence | null>;
export function subscribeCanvasDocument(
  documentId: string,
  presence: CanvasPresence,
  handlers: CanvasRealtimeHandlers,
): CanvasRealtimeSubscription | null;
export function broadcastCanvasDocumentSaved(event: CanvasDocumentSavedEvent): Promise<boolean>;
```

`getCanvasPresenceIdentity` usará `supabase.auth.getSession()`, el id de usuario y `user_metadata.display_name`; como fallback de nombre usará la parte anterior al `@` del email y finalmente `Usuario`. No se debe inventar una identidad si no hay sesión.

### Step 2: Escribir pruebas del transporte

Mockear `frontend/src/lib/supabase.ts` con un canal controlable y verificar:

- `canvasDocumentTopic('doc-1')` produce `canvas-document:doc-1`.
- La suscripción crea un canal con `{ config: { private: true, broadcast: { ack: true, self: false } } }`.
- Un payload válido `document_saved` llega a `onSaved`; payloads con topic, fecha, id o `updatedBy` inválidos se ignoran.
- `presence` `sync` se transforma a colaboradores y conserva la clave de presencia.
- `publishSaved` devuelve `true` con `send` exitoso y `false` sin canal o ante error.
- `updatePresence` usa `track` y `close` remueve el canal exactamente una vez.
- La ausencia de cliente Supabase produce estado `offline` sin lanzar.

```ts
it('ignora un evento guardado con documento inválido', async () => {
  const handlers = createHandlers();
  subscribeCanvasDocument('doc-1', presence, handlers);
  channel.emitBroadcast({ type: 'document_saved', documentId: '', updatedAt: 'bad', updatedBy: '' });
  expect(handlers.onSaved).not.toHaveBeenCalled();
});
```

### Step 3: Implementar el canal por documento

Mantener un `Map<string, RealtimeChannel>` de canales abiertos. La implementación debe:

1. Obtener el cliente Supabase existente; si falta, notificar `offline` y devolver `null`.
2. Crear el canal privado con Broadcast con `ack:true` y `self:false`.
3. Registrar `broadcast` para `document_saved` y `presence` para `sync`, validando todos los campos antes de llamar a los handlers.
4. En `SUBSCRIBED`, llamar a `track(presence)` y notificar `live`; si subscribe falla, notificar `error`.
5. `publishSaved` debe usar `channel.send({ type:'broadcast', event:'document_saved', payload:event })` y nunca leer/escribir la base de datos.
6. `updatePresence` debe llamar a `track` solo cuando cambia el modo.
7. `close` debe borrar el canal del mapa y ejecutar `supabase.removeChannel(channel)` de forma idempotente.

```ts
const realtimeChannels = new Map<string, RealtimeChannel>();

function isSavedEvent(value: unknown, documentId: string): value is CanvasDocumentSavedEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return event.type === 'document_saved'
    && event.documentId === documentId
    && typeof event.updatedAt === 'string'
    && !Number.isNaN(Date.parse(event.updatedAt))
    && typeof event.updatedBy === 'string'
    && event.updatedBy.length > 0;
}
```

### Step 4: Ejecutar las pruebas del transporte

Run: `npm --prefix frontend run test -- src/components/canvas/sync/canvasRealtime.test.ts`

Expected: todas las pruebas del nuevo módulo pasan y no hay importaciones a `canvasCloudSync` desde el transporte.

### Step 5: Commit

```bash
git add frontend/src/components/canvas/sync/canvasRealtime.ts frontend/src/components/canvas/sync/canvasRealtime.test.ts
git commit -m "feat: add canvas realtime transport"
```

## Task 3: Añadir pull dirigido y publicar solo pushes LWW aceptados

**Files:**

- Modify: `frontend/src/components/canvas/sync/canvasCloudSync.ts`
- Modify: `frontend/src/components/canvas/sync/canvasCloudSync.test.ts`

### Step 1: Escribir pruebas de resultado de push y pull dirigido

Añadir pruebas que cubran:

- un push LWW aceptado publica `document_saved` con id, `updatedAt` y usuario de sesión;
- un push rechazado por LWW no publica;
- ausencia de sesión, error o timeout no publica;
- un pull con remoto más nuevo y editor limpio guarda primero mediante `api.canvasSave(remote,{touch:false})` y devuelve `applied`;
- un pull con remoto más nuevo y editor sucio devuelve el conflicto existente sin escribir local;
- una eliminación remota devuelve conflicto aun cuando el editor esté limpio;
- un remoto igual o más antiguo devuelve `unchanged` sin reemplazar el documento.

```ts
it('persiste el remoto antes de devolver applied', async () => {
  const result = await pullCanvasDocument('doc-1', {
    localDocument,
    openDirty: false,
  });

  expect(result.kind).toBe('applied');
  expect(api.canvasSave).toHaveBeenCalledWith(remoteDocument, { touch: false });
});
```

### Step 2: Separar el resultado interno de push sin romper la API existente

Conservar `pushCanvasDocument(...): Promise<boolean>` para sus consumidores actuales y extraer un resultado interno/exportado para que la cola y el sync global conozcan el actor que puede formar el evento:

```ts
export type CanvasPushResult = {
  accepted: boolean;
  documentId: string;
  updatedAt: string;
  updatedBy: string;
};

export async function pushCanvasDocumentResult(
  document: CanvasDocument,
  options?: PushCanvasDocumentOptions,
): Promise<CanvasPushResult>;

export async function pushCanvasDocument(
  document: CanvasDocument,
  options?: PushCanvasDocumentOptions,
): Promise<boolean> {
  return (await pushCanvasDocumentResult(document, options)).accepted;
}
```

Todos los caminos de rechazo deben devolver `accepted:false` y no publicar. El resultado debe conservar el `updatedAt` del documento enviado y el `auth.uid()` usado por el push.

### Step 3: Implementar `pullCanvasDocument`

Añadir:

```ts
export type TargetedCanvasPullResult =
  | { kind: 'unchanged'; remoteUpdatedAt?: string }
  | { kind: 'applied'; document: CanvasDocument; remoteUpdatedAt: string }
  | { kind: 'conflict'; conflict: SyncConflict }
  | { kind: 'deleted'; conflict: SyncConflict };

export async function pullCanvasDocument(
  documentId: string,
  options: { localDocument: CanvasDocument; openDirty: boolean },
): Promise<TargetedCanvasPullResult>;
```

Debe leer una sola fila remota con timeout, normalizar el documento existente y comparar `updatedAt` con el snapshot local. Si hay remoto nuevo y `openDirty` es falso, debe ejecutar `api.canvasSave(remote,{touch:false})` antes de devolver `applied`. Si el remoto tiene `deleted_at`, debe devolver `deleted` con `remoteDoc:null`; no borrar el documento local automáticamente. Los errores de lectura o persistencia local deben propagarse al hook para conservar el documento actual.

### Step 4: Publicar tras la aceptación

Añadir un helper sin efectos de base de datos:

```ts
async function publishAcceptedPush(result: CanvasPushResult): Promise<void> {
  if (!result.accepted || !result.updatedBy) return;
  await broadcastCanvasDocumentSaved({
    type: 'document_saved',
    documentId: result.documentId,
    updatedAt: result.updatedAt,
    updatedBy: result.updatedBy,
  }).catch(() => undefined);
}
```

Usarlo en la cola `queueCanvasCloudPush` y en los pushes locales de `syncCanvasDocuments`. Un evento fallido no debe convertir un push ya aceptado en error de persistencia; el polling al recuperar foco seguirá siendo la recuperación.

### Step 5: Ejecutar pruebas de cloud sync

Run: `npm --prefix frontend run test -- src/components/canvas/sync/canvasCloudSync.test.ts`

Expected: las pruebas LWW, conflictos, assets y cola existentes siguen pasando, junto con las pruebas nuevas.

### Step 6: Commit

```bash
git add frontend/src/components/canvas/sync/canvasCloudSync.ts frontend/src/components/canvas/sync/canvasCloudSync.test.ts
git commit -m "feat: publish accepted canvas saves"
```

## Task 4: Conectar el pull dirigido y Presence al hook de sincronización

**Files:**

- Modify: `frontend/src/components/canvas/hooks/useCanvasSync.ts`
- Modify: `frontend/src/components/canvas/__tests__/useCanvasSync.test.ts`

### Step 1: Extender opciones y retorno

Conservar las opciones actuales y añadir:

```ts
type UseCanvasSyncOptions = {
  // opciones existentes
  documentId: string;
  documentReady: boolean;
  openDirty: boolean;
  initialGuarded?: boolean;
  onRemoteDocumentApplied?: (document: CanvasDocument) => void;
};

type UseCanvasSyncResult = {
  runCloudSync: (guardedOverride?: boolean) => Promise<void>;
  syncing: boolean;
  syncStatus: SyncStatus;
  realtimeStatus: CanvasRealtimeStatus;
  collaborators: CanvasCollaborator[];
};
```

`documentReady` evitará suscribirse al documento vacío de arranque. `initialGuarded:true` se usará desde `CanvasView`; los tests unitarios que no ejecutan bootstrap podrán usar el valor por defecto `false`.

### Step 2: Añadir pruebas del ciclo remoto

Mockear `subscribeCanvasDocument`, `getCanvasPresenceIdentity` y `pullCanvasDocument`, y verificar:

- no se crea canal antes de `documentReady` ni cuando `active` es falso;
- un `document_saved` del documento actual se coalescea durante aproximadamente 350 ms y produce un solo pull;
- eventos de otro documento, timestamps viejos y eventos recibidos durante `initialGuarded` se ignoran;
- remoto nuevo limpio llama a `replaceDocument` únicamente después del pull aplicado y ejecuta `onRemoteDocumentApplied`;
- remoto nuevo sucio llama a `onConflict` y no llama a `replaceDocument`;
- eliminación remota también crea conflicto;
- al cambiar `openDirty`, `updatePresence` cambia entre `viewing` y `editing` sin recrear el canal;
- el cleanup cierra el canal y cancela el debounce.

```ts
it('coalescea varios avisos del mismo documento', async () => {
  const { result } = renderHook(() => useCanvasSync(options));
  act(() => {
    savedHandler({ type: 'document_saved', documentId: 'doc-1', updatedAt: newer, updatedBy: 'u-2' });
    savedHandler({ type: 'document_saved', documentId: 'doc-1', updatedAt: newest, updatedBy: 'u-3' });
  });
  await act(async () => vi.advanceTimersByTime(350));
  expect(pullCanvasDocument).toHaveBeenCalledTimes(1);
  expect(pullCanvasDocument).toHaveBeenCalledWith('doc-1', expect.any(Object));
});
```

### Step 3: Implementar la suscripción estable

Crear refs para `documentId`, `historyDocRef`, `openDirtyRef`, callbacks y estado de bootstrap. El efecto debe:

1. salir si `active` es falso o `documentReady` es falso;
2. obtener la identidad de sesión y abrir el canal privado del documento actual;
3. guardar los colaboradores excluyendo el usuario actual;
4. ignorar eventos durante el guarded bootstrap, sin replay posterior;
5. filtrar el documento y timestamp, conservar el timestamp más nuevo pendiente y programar un único pull a 350 ms;
6. llamar a `pullCanvasDocument` con el documento/ref y `openDirtyRef.current`;
7. ante `applied`, reemplazar solo después de que el servicio haya persistido el remoto y llamar al callback de UI;
8. ante `conflict`/`deleted`, delegar al `onConflict` existente;
9. propagar estado `connecting`/`live`/`offline`/`error` sin romper `syncStatus` del cloud sync.

El `SUBSCRIBED` inicial no debe hacer un pull adicional: el bootstrap guarded ya cubre esa lectura. Una reconexión posterior sí puede notificar estado y ejecutar la ruta normal de invalidación si llega un Broadcast nuevo.

### Step 4: Ejecutar pruebas del hook

Run: `npm --prefix frontend run test -- src/components/canvas/__tests__/useCanvasSync.test.ts`

Expected: pasan los casos de focus/conflicto existentes y los casos nuevos de Realtime.

### Step 5: Commit

```bash
git add frontend/src/components/canvas/hooks/useCanvasSync.ts frontend/src/components/canvas/__tests__/useCanvasSync.test.ts
git commit -m "feat: connect canvas realtime sync"
```

## Task 5: Mostrar presencia y aplicar correctamente un remoto en CanvasView

**Files:**

- Create: `frontend/src/components/canvas/editor/CanvasPresenceBadge.tsx`
- Create: `frontend/src/components/canvas/__tests__/CanvasPresenceBadge.test.tsx`
- Modify: `frontend/src/components/canvas/CanvasView.tsx`

### Step 1: Crear prueba y componente de presencia

El componente debe ser pequeño, accesible y no mostrar ruido cuando no hay colaboradores ni conexión activa. Debe mostrar el número de colaboradores, nombres en `title`/`aria-label`, un estado `En vivo` cuando el canal está conectado y `Sin conexión` cuando el canal está offline con colaboradores todavía conocidos.

```tsx
type CanvasPresenceBadgeProps = {
  collaborators: CanvasCollaborator[];
  status: CanvasRealtimeStatus;
};

export function CanvasPresenceBadge({ collaborators, status }: CanvasPresenceBadgeProps) {
  if (status === 'offline' && collaborators.length === 0) return null;
  const label = collaborators.length === 0
    ? status === 'live' ? 'Canvas en vivo' : 'Canvas sin conexión'
    : `${collaborators.length} colaborador${collaborators.length === 1 ? '' : 'es'} conectado${collaborators.length === 1 ? '' : 's'}`;
  return <div role="status" aria-label={label} data-testid="canvas-presence-badge">...</div>;
}
```

Las pruebas deben cubrir render vacío, un colaborador, varios colaboradores y estados live/offline/error.

### Step 2: Integrar el hook en CanvasView

Pasar a `useCanvasSync`:

```tsx
const {
  runCloudSync,
  syncing: cloudSyncing,
  syncStatus,
  realtimeStatus,
  collaborators,
} = useCanvasSync({
  // opciones existentes
  documentId: history.document.id,
  documentReady: !loading,
  openDirty: openDirtyRef.current,
  initialGuarded: true,
  onRemoteDocumentApplied: handleRemoteDocumentApplied,
});
```

`handleRemoteDocumentApplied` debe hidratar imágenes, llamar `history.replaceDocument`, eliminar de la selección ids que ya no existan y limitar el índice de página al número de páginas del documento remoto. No debe ejecutar `queueCanvasCloudPush`, porque el remoto ya es canónico y el servicio ya lo guardó localmente.

### Step 3: Integrar el badge sin alterar el conflicto existente

En el `syncConflictSlot` del TopBar, mostrar el `SyncConflictBar` cuando exista conflicto y, en caso contrario, componer el badge de presencia junto al `SyncStatusBadge`. No cambiar la prioridad visual ni las acciones de resolución actuales.

```tsx
const syncConflictSlot = syncConflict ? (
  <SyncConflictBar ... />
) : (
  <>
    <CanvasPresenceBadge collaborators={collaborators} status={realtimeStatus} />
    <SyncStatusBadge status={syncStatus} />
  </>
);
```

### Step 4: Ejecutar pruebas de Canvas y presencia

Run: `npm --prefix frontend run test -- src/components/canvas/__tests__/CanvasPresenceBadge.test.tsx src/components/canvas/__tests__/canvasViewLifecycle.test.tsx`

Expected: las pruebas de ciclo de vida y conflictos existentes pasan sin mostrar un badge vacío en modo offline.

### Step 5: Commit

```bash
git add frontend/src/components/canvas/editor/CanvasPresenceBadge.tsx frontend/src/components/canvas/__tests__/CanvasPresenceBadge.test.tsx frontend/src/components/canvas/CanvasView.tsx
git commit -m "feat: show canvas collaborators"
```

## Task 6: Verificación completa y cierre

**Files:**

- Modify only if a test or type check identifies an issue in the files above.

### Step 1: Ejecutar la suite estática y frontend

Run:

```bash
pytest tests/test_canvas_realtime_sql.py -q
npm --prefix frontend run test -- src/components/canvas/sync/canvasRealtime.test.ts src/components/canvas/sync/canvasCloudSync.test.ts src/components/canvas/__tests__/useCanvasSync.test.ts src/components/canvas/__tests__/CanvasPresenceBadge.test.tsx src/components/canvas/__tests__/canvasViewLifecycle.test.tsx
npm --prefix frontend run build
```

Expected: SQL tests, pruebas focalizadas y build TypeScript/Vite pasan. Si el proyecto no tiene dependencias instaladas, ejecutar `npm --prefix frontend ci` y repetir los comandos; no versionar `node_modules`.

### Step 2: Revisar invariantes y diff

Comprobar con `rg` que no existen Broadcasts con documentos completos, escrituras remotas desde `canvasRealtime.ts`, llamadas a `queueCanvasCloudPush` desde la ruta de aplicación remota ni cambios en `useCanvasHistory.ts`. Ejecutar `git diff --check` y revisar `git status --short` para confirmar que solo quedan los archivos de esta feature y los commits planificados.

### Step 3: Commit de ajustes de verificación

Si la verificación requiere cambios, crear un commit separado:

```bash
git add frontend supabase tests
git commit -m "fix: harden canvas realtime verification"
```

### Step 4: Resultado esperado

La feature queda lista para probar con dos sesiones autenticadas: ambas ven Presence por documento; guardar en una sesión anuncia la invalidez; una sesión limpia trae y persiste el snapshot remoto antes de aplicarlo; una sesión sucia conserva el conflicto existente; al desconectar, el foco y el sync global siguen siendo la recuperación.

