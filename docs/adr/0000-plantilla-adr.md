# 0000. Plantilla de ADR

- Fecha: YYYY-MM-DD
- Estado: propuesto | aceptado | supersedido por NNNN
- Personas: quién decidió

## Contexto

Qué fuerza obliga a decidir ahora. Restricciones técnicas, de negocio o de
tiempo. Sin contexto, la decisión parece arbitraria y alguien la revertirá
sin saber que ya se discutió.

## Decisión

Qué se decide, en una frase y en voz activa: "Usamos X para Y".

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
|  |  |

## Consecuencias

Qué se gana, qué se paga y qué queda prohibido a partir de ahora. Si la
decisión crea una restricción que el código debe respetar, indicar aquí cómo
se verifica: test, regla de linter o script en `scripts/`.

---

## Cuándo escribir un ADR

Escribir uno cuando la decisión cumpla al menos dos de estas condiciones:

1. Es difícil de revertir (toca protocolo, esquema de datos o formato de archivo).
2. Alguien la volverá a preguntar en menos de seis meses.
3. Se descartó una alternativa que parecía razonable.
4. Restringe lo que se puede hacer después.

No escribir uno cuando: se pueda cambiar en un PR sin consecuencias, o cuando la
decisión ya esté expresada como un check automático — en ese caso el check es la
documentación.

## Nomenclatura

`NNNN-titulo-corto-en-minusculas.md`, numeración correlativa sin huecos. Un ADR
no se edita para cambiar de opinión: se marca como *supersedido por NNNN* y se
escribe el nuevo.
