export const ESPACIOS_VIRTUALIZE_THRESHOLD = 50;

export const LIST_ROW_HEIGHT = 72;
export const TABLE_ROW_HEIGHT = 56;
// Piso medido de la tarjeta real (TaskCard: padding+borde 26 + fila de título
// con grip 26 + selector de estado 34 + 2-3 filas meta 40-52 + descripción de
// 2 líneas 40 + pb-2 del wrapper 8 ≈ 174-186). Un valor menor pinta cada tarjeta
// sobre la siguiente y la deja parcialmente inclicable justo cuando hay más
// tareas, que es el caso para el que existe la virtualización.
export const BOARD_CARD_ROW_HEIGHT = 188;
