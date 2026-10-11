import { useEffect, useRef, useState } from "react";
import {
  clearPersistedLogo,
  compressLogoForStorage,
  loadPersistedLogo,
  savePersistedLogo,
} from "./utils/persistedLogo";

const LOGO_LEFT_KEY = "antares_preview_logo_left";
const LOGO_RIGHT_KEY = "antares_preview_logo_right";

export function usePersistedLogos(onError: (message: string) => void) {
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);
  // El llamador pasa una flecha inline: sin ref el efecto correría en cada
  // render y reintentaría el guardado (y el toast) sin parar.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const l = loadPersistedLogo(LOGO_LEFT_KEY);
    if (l) setLogoLeft(l.dataUrl);
    const r = loadPersistedLogo(LOGO_RIGHT_KEY);
    if (r) setLogoRight(r.dataUrl);
  }, []);

  useEffect(() => {
    // El guardado anterior tragaba el error de cuota: el logo se mostraba
    // activo pero desaparecía al recargar.
    const failed: string[] = [];
    if (logoLeft) {
      if (!savePersistedLogo(LOGO_LEFT_KEY, logoLeft, "logo-left")) failed.push("izquierdo");
    } else clearPersistedLogo(LOGO_LEFT_KEY);
    if (logoRight) {
      if (!savePersistedLogo(LOGO_RIGHT_KEY, logoRight, "logo-right")) failed.push("derecho");
    } else clearPersistedLogo(LOGO_RIGHT_KEY);
    if (failed.length > 0) onErrorRef.current(`No se pudo guardar el logo ${failed.join(" y ")} (almacenamiento lleno)`);
  }, [logoLeft, logoRight]);

  const handleLogoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    side: "left" | "right",
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await compressLogoForStorage(file);
      if (side === "left") setLogoLeft(result);
      else setLogoRight(result);
    } catch {
      onError("No se pudo cargar el logo seleccionado");
    }
  };

  return { logoLeft, logoRight, handleLogoUpload };
}
