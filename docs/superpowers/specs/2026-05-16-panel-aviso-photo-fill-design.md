# Panel Aviso Photo Fill Design

## Goal

Hacer que cada foto del panel aviso de corte ocupe todo el recuadro asignado en el PDF, como en `panel-aviso.pdf`, sin provocar que una grilla de 4 imagenes se divida entre dos hojas.

## Current Behavior

La plantilla PDF usa `object-fit: contain` y limites de tamano maximo para cada imagen. Eso conserva la foto completa, pero deja espacio vacio dentro de la celda cuando la proporcion de la imagen no coincide con la proporcion del recuadro.

## Chosen Approach

1. Mantener las alturas actuales de tabla y filas para conservar un panel completo por pagina.
2. Hacer que cada imagen ocupe todo el ancho y alto disponible de su celda.
3. Usar `object-fit: cover` para preservar la proporcion original, rellenando el recuadro con un recorte controlado cuando sea necesario.
4. Mantener el cambio limitado al renderizado PDF; el DOCX conserva su comportamiento actual.

## Alternatives Considered

### 1. Estirar las imagenes hasta llenar el recuadro

Llena toda la celda, pero deforma las fotos. Se descarta porque empeora la fidelidad visual.

### 2. Ajustar la altura de las filas para cada imagen

Reduce recortes, pero cambia la geometria total del panel y aumenta el riesgo de que una grilla de 4 imagenes pase a una segunda hoja. Se descarta porque contradice la restriccion principal del usuario.

## Rendering Rules

- La celda de imagen mantiene el alto fijo actual.
- El contenedor interno ocupa todo el espacio disponible.
- La imagen usa `width: 100%`, `height: 100%` y `object-fit: cover`.
- El panel conserva una unica tabla por pagina cuando contiene 4 imagenes.

## Scope

Incluido:
- Ajuste visual del renderizado PDF.
- Cobertura automatizada para asegurar el nuevo contrato de llenado.
- Regresion que confirme que una grilla de 4 imagenes sigue quedando en una sola hoja.

Fuera de alcance:
- Cambiar la distribucion de filas o columnas.
- Alterar el renderizado DOCX.
- Agregar controles de recorte manual por imagen.

## Testing

- Verificar que la plantilla PDF use `object-fit: cover` con imagenes que ocupen todo el contenedor.
- Mantener la prueba que valida que el fixture con 4 imagenes produce una sola pagina por panel.
- Ejecutar las pruebas enfocadas de `panel_aviso_corte` despues del cambio.
