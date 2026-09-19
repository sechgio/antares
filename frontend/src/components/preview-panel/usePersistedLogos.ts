import { useEffect, useState } from "react";
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

  useEffect(() => {
    const l = loadPersistedLogo(LOGO_LEFT_KEY);
    if (l) setLogoLeft(l.dataUrl);
    const r = loadPersistedLogo(LOGO_RIGHT_KEY);
    if (r) setLogoRight(r.dataUrl);
  }, []);

  useEffect(() => {
    if (logoLeft) savePersistedLogo(LOGO_LEFT_KEY, logoLeft, "logo-left");
    else clearPersistedLogo(LOGO_LEFT_KEY);
    if (logoRight) savePersistedLogo(LOGO_RIGHT_KEY, logoRight, "logo-right");
    else clearPersistedLogo(LOGO_RIGHT_KEY);
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
