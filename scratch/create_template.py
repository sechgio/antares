import pandas as pd

columns = [
    "CENTRO",
    "FECHA DE TRABAJO",
    "ESTADO",
    "COD INFRAESTRUCT",
    "DISTRITO",
    "ACTIVIDAD",
    "SGIO",
    "NIS"
]

df = pd.DataFrame(columns=columns)
output_path = r"c:\Users\HIDROAA\Desktop\antares\plantilla_reservorios_lurigancho_v2.xlsx"

# To make it look like a template, we can add a sample row
df.loc[0] = [
    "CS ATE", 
    "15/05/2026", 
    "FINALIZADO", 
    "INF-123", 
    "SJL", 
    "MANTENIMIENTO", 
    "SG-001", 
    "NIS-001"
]

df.to_excel(output_path, index=False)
print(f"Template created at {output_path}")
