# Canvas: claridad progresiva sin alterar la funcionalidad

Status: accepted

La auditoría UX mostró que Canvas necesita mejorar principalmente la descubribilidad de herramientas, la jerarquía del inspector, la legibilidad del árbol de capas y el feedback de estados; su modelo de datos, operaciones de edición, persistencia, IPC y exportación deben permanecer intactos. Se decide aplicar una capa de claridad progresiva reutilizando los tokens y primitivas existentes: nombres visibles para acciones frecuentes, agrupación visual, inspector jerarquizado, requisitos de Generar más explícitos y estados más legibles. Se descarta una convergencia completa con Figma porque añadiría más riesgo y complejidad sin ser necesaria para resolver la fricción identificada.

Consecuencias: la mejora se limita a componentes de editor y estilos; los usuarios conservarán los mismos atajos, capacidades y contratos funcionales. La latencia del renderer con documentos medianos queda fuera de este cambio y seguirá requiriendo un trabajo de rendimiento separado.
