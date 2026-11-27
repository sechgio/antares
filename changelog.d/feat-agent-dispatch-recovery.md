### Fixed

- Los despachos del agente que quedan en vuelo al reiniciar la app se reconcilian al arranque y dejan de quedar «running» eternamente. El sondeo de resultados reintenta los fallos transitorios del bridge con espera acotada y declara el resultado incierto solo ante evidencia, en vez de colgar el turno o interrumpirlo al primer error.
