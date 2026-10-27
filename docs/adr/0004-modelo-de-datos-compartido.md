# 0004. Modelo de datos compartido en Supabase

- Fecha: 2026-10-27
- Estado: aceptado
- Personas: sechgio

## Contexto

La auditoría de seguridad de 2026-10-27 señala que la capa cloud de Antares
(Supabase) comparte todos los datos productivos entre cuentas: las políticas
RLS usan `FOR ALL USING (public.is_active_user())`, así que cualquier usuario
autenticado y activo lee, crea y edita todas las filas de `canvas_documents`,
`canvas_document_versions` y tablas vecinas. Otro hallazgo del mismo bloque
(F2): el INSERT directo permitía fijar `created_by`/`updated_by` con cualquier
UUID, de modo que la atribución de autoría era mentible por el cliente.

Antes de endurecer nada hay que decidir si el modelo compartido es un fallo o
un diseño: sin esa decisión, cualquier cambio posterior de RLS parece arbitrario
y alguien lo revertirá sin saber que ya se discutió.

Restricciones: Antares se despliega con un puñado de cuentas conocidas (uso
personal y de confianza), no existe UI ni producto de espacios/equipos, y el
sync del Canvas (LWW global) asume un único espacio de datos.

## Decisión

El modelo de datos cloud es compartido a propósito: cualquier cuenta activa
accede a todo el contenido, y la atribución (`created_by`/`updated_by`) es
informativa, no un control de acceso. La verdad de la atribución se fuerza del
lado del servidor (trigger `canvas_documents_force_attribution` en INSERT,
`canvas_documents_preserve_created_by` en UPDATE; los RPC LWW usan
`auth.uid()`), nunca se confía en el cliente.

El modelo de membresías por espacio —cada documento visible solo para su
propietario o miembros de su espacio— es un feature de producto: se adoptará
con su UI, su migración de backfill y su política de datos, no como arreglo de
seguridad de paso.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| RLS por propietario o membresía por espacio | Es un feature de producto (gestión de espacios, invitaciones, backfill de datos existentes); el despliegue actual no lo necesita y no hay UI para administrarlo. |
| Cifrar cada documento para su autor en el cliente | Rompe el sync compartido y el versionado LWW; el acceso compartido seguiría existiendo para las claves. |
| Confiar en el cliente para `created_by`/`updated_by` | El cliente puede mentir; la atribución se fuerza en triggers y RPC del servidor. |
| Cerrar el acceso cloud (solo local) | Elimina el valor del sync entre equipos del mismo usuario. |

## Consecuencias

Se gana: sync sencillo (un espacio LWW global), sin gestión de permisos por
documento ni superficie de administración.

Se paga: cualquier cuenta activa es un *insider* con acceso total al contenido;
la mitigación operativa es mantener la superficie de cuentas mínima y que
`is_active_user()` decida quién cuenta como activa. Si el producto crece a
multiusuario real, este ADR queda supersedido por el del modelo de espacios.

Queda prohibido a partir de ahora: tratar `created_by`/`updated_by` como
control de acceso o mostrarlos como autoría verificable frente a terceros;
añadir tablas productivas sin RLS `is_active_user()`; confiar en atribución
enviada por el cliente sin forzarla en servidor.

Verificación: `tests/test_supabase_schema_audit.py` (RLS en todas las tablas
`public.*`, superficie RPC exacta por rol, `SECURITY DEFINER` con
`search_path`, set mínimo de triggers de guarda, sin DELETE de cliente en
`canvas_documents`), y `EXPECTED_CANVAS_DOCUMENT_TRIGGERS` incluye
`canvas_documents_force_attribution` para que la atribución forzada no se
retire sin levantar el test.
