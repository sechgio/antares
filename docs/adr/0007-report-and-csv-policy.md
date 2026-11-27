# 0007. Políticas compartidas de reportes y CSV

Fecha 2026-11-27 · Aceptada

Los modelos de Informe Técnico e Informes V2 delegan la conversión de cantidades por diámetro a `normalize_diameter_counts`. Cada formato conserva su lista ordenada y su lectura de filas antiguas. Los valores de estado y tipo de reservorio se derivan de los tipos literales de Python. Las pruebas de paridad vigilan el contrato con TypeScript.

Colocar la normalización dentro de uno de los informes habría hecho al otro depender de su modelo. Unificar las estructuras de ambos informes mezclaría plantillas, tamaños y convenciones distintas. Compartimos la coerción y las definiciones que tienen el mismo significado.

`text_decoding.py` posee el orden de codificaciones para el muestreo CSV y la decodificación completa. El handler de hojas y los tres consumidores del agente importan el muestreador desde ese módulo. Cada consumidor aplica sus propios límites y reglas de filas. Una guarda AST detecta imports directos, relativos y dentro de funciones desde core o utils hacia el handler.
