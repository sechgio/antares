import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FlyerCard from "../components/FlyerCard";
import SheetPreview from "../components/SheetPreview";
import { DEFAULT_BRAND, DEFAULT_FOOTER } from "../constants";
import type { FlyerRecord } from "../types";

const mockRecord: FlyerRecord = {
  id: "rec-1",
  distrito: "LOS OLIVOS",
  fecha: "2026-08-25",
  horaInicio: "09:00",
  horaFin: "17:00",
  reservorio: "R-01",
  sector: "Sector 100",
  zonasAfectadas: "Urb. Pro, Av. Alfredo Mendiola",
};

describe("FlyerCard - Footer Images", () => {
  it("renders default footer logos when no custom footer is passed", () => {
    render(<FlyerCard record={mockRecord} brand={DEFAULT_BRAND} />);

    const logoOperativo = screen.getByAltText("Logo operativo") as HTMLImageElement;
    const servicioAgua = screen.getByAltText("Servicio de agua") as HTMLImageElement;

    expect(logoOperativo).toBeInTheDocument();
    expect(logoOperativo.src).toContain(DEFAULT_FOOTER.logoOperativo);

    expect(servicioAgua).toBeInTheDocument();
    expect(servicioAgua.src).toContain(DEFAULT_FOOTER.servicioAgua);
  });

  it("renders custom footer logos when custom footer config is passed", () => {
    const customFooter = {
      logoOperativo: "data:image/png;base64,customOperativoLogo",
      servicioAgua: "data:image/png;base64,customServicioAgua",
    };

    render(
      <FlyerCard
        record={mockRecord}
        brand={DEFAULT_BRAND}
        footer={customFooter}
      />
    );

    const logoOperativo = screen.getByAltText("Logo operativo") as HTMLImageElement;
    const servicioAgua = screen.getByAltText("Servicio de agua") as HTMLImageElement;

    expect(logoOperativo.src).toBe(customFooter.logoOperativo);
    expect(servicioAgua.src).toBe(customFooter.servicioAgua);
  });

  it("propagates custom footer configuration through SheetPreview", () => {
    const customFooter = {
      logoOperativo: "data:image/png;base64,customOperativoSheet",
      servicioAgua: "data:image/png;base64,customServicioSheet",
    };

    render(
      <SheetPreview
        brand={DEFAULT_BRAND}
        footer={customFooter}
        heading={{ titulo: "Título Test", subtitulo: "Subtítulo Test" }}
        encabezados={{
          limpiezaReservorios: "LIMPIEZA:",
          zonasAfectadas: "Zonas:",
          detalleZonas: "Detalle:",
        }}
        layoutMode="2-up"
        records={[mockRecord]}
      />
    );

    const logosOperativos = screen.getAllByAltText("Logo operativo") as HTMLImageElement[];
    const serviciosAgua = screen.getAllByAltText("Servicio de agua") as HTMLImageElement[];

    expect(logosOperativos.length).toBe(2);
    expect(logosOperativos[0].src).toBe(customFooter.logoOperativo);
    expect(serviciosAgua[0].src).toBe(customFooter.servicioAgua);
  });
});

describe("FlyerCard - Bullet Styles", () => {
  const multiLineRecord: FlyerRecord = {
    ...mockRecord,
    zonasAfectadas: "Urb. Los Olivos\nAv. Marañón\nJr. Las Palmeras",
  };

  it("renders plain text when bulletStyle is none or undefined", () => {
    render(<FlyerCard record={multiLineRecord} brand={DEFAULT_BRAND} />);
    const container = screen.getByText(/Urb\. Los Olivos/);
    expect(container.textContent).toBe("Urb. Los Olivos\nAv. Marañón\nJr. Las Palmeras");
  });

  it("renders disc bullets (•) when bulletStyle is disc", () => {
    render(
      <FlyerCard
        record={{ ...multiLineRecord, bulletStyle: "disc" }}
        brand={DEFAULT_BRAND}
      />
    );
    const container = screen.getByText(/• Urb\. Los Olivos/);
    expect(container.textContent).toBe("• Urb. Los Olivos\n• Av. Marañón\n• Jr. Las Palmeras");
  });

  it("renders dash bullets (–) when bulletStyle is dash", () => {
    render(
      <FlyerCard
        record={{ ...multiLineRecord, bulletStyle: "dash" }}
        brand={DEFAULT_BRAND}
      />
    );
    const container = screen.getByText(/– Urb\. Los Olivos/);
    expect(container.textContent).toBe("– Urb. Los Olivos\n– Av. Marañón\n– Jr. Las Palmeras");
  });

  it("renders arrow bullets (▸) when bulletStyle is arrow", () => {
    render(
      <FlyerCard
        record={{ ...multiLineRecord, bulletStyle: "arrow" }}
        brand={DEFAULT_BRAND}
      />
    );
    const container = screen.getByText(/▸ Urb\. Los Olivos/);
    expect(container.textContent).toBe("▸ Urb. Los Olivos\n▸ Av. Marañón\n▸ Jr. Las Palmeras");
  });

  it("renders check bullets (✓) when bulletStyle is check", () => {
    render(
      <FlyerCard
        record={{ ...multiLineRecord, bulletStyle: "check" }}
        brand={DEFAULT_BRAND}
      />
    );
    const container = screen.getByText(/✓ Urb\. Los Olivos/);
    expect(container.textContent).toBe("✓ Urb. Los Olivos\n✓ Av. Marañón\n✓ Jr. Las Palmeras");
  });

  it("renders numbered bullets (1., 2., 3.) when bulletStyle is number", () => {
    render(
      <FlyerCard
        record={{ ...multiLineRecord, bulletStyle: "number" }}
        brand={DEFAULT_BRAND}
      />
    );
    const container = screen.getByText(/1\. Urb\. Los Olivos/);
    expect(container.textContent).toBe("1. Urb. Los Olivos\n2. Av. Marañón\n3. Jr. Las Palmeras");
  });
});

describe("FlyerCard - Date line", () => {
  const renderSheet = (exportMode = false, record = mockRecord) =>
    render(
      <SheetPreview
        brand={DEFAULT_BRAND}
        heading={{ titulo: "Título Test", subtitulo: "Subtítulo Test" }}
        encabezados={{
          limpiezaReservorios: "LIMPIEZA:",
          zonasAfectadas: "Zonas:",
          detalleZonas: "Detalle:",
        }}
        exportMode={exportMode}
        layoutMode="2-up"
        records={[record]}
      />,
    );

  it("omits the year in the preview date line", () => {
    renderSheet();

    const dateLines = screen.getAllByText(/25 de agosto/);
    expect(dateLines).toHaveLength(2);
    expect(dateLines.every((line) => !line.textContent?.includes("2026"))).toBe(true);
  });

  it("uses septiembre for the ninth month", () => {
    renderSheet(false, { ...mockRecord, fecha: "2026-09-03" });

    const dateLines = screen.getAllByText(/3 de septiembre/);
    expect(dateLines).toHaveLength(2);
    expect(dateLines.every((line) => !line.textContent?.includes("setiembre"))).toBe(true);
  });

  it("omits the year in the export date line", () => {
    renderSheet(true);

    const dateLines = screen.getAllByText(/25 de agosto/);
    expect(dateLines).toHaveLength(2);
    expect(dateLines.every((line) => !line.textContent?.includes("2026"))).toBe(true);
  });
});
