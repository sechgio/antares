import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileTokenCleanup: vi.fn(),
  spreadsheetGetRows: vi.fn(),
  spreadsheetParse: vi.fn(),
  stageFileForIpc: vi.fn(),
}));

vi.mock("../../../api", () => ({ api: mocks }));
vi.mock("../../../utils/stageFile", () => ({ stageFileForIpc: mocks.stageFileForIpc }));

import { importSpreadsheet } from "./import";

describe("importSpreadsheet", () => {
  it("paginates spilled workbooks and releases the result token", async () => {
    mocks.stageFileForIpc.mockResolvedValue("antares-read_input");
    mocks.spreadsheetParse.mockResolvedValue({
      workbookName: "volantes.xlsx",
      sheets: [],
      warnings: [],
      result_file_token: "antares-read_result",
      sheet_meta: [{ name: "Hoja1", rowCount: 4 }],
    });
    mocks.spreadsheetGetRows
      .mockResolvedValueOnce({
        name: "Hoja1",
        rows: [
          ["distrito", "fecha", "hora_inicio", "hora_fin", "reservorio", "sector"],
          ["ATE", "2026-08-26", "08:00", "16:00", "R-01", "S-01"],
          ["COMAS", "2026-08-27", "09:00", "17:00", "R-02", "S-02"],
        ],
        offset: 0,
        limit: 2000,
        total: 4,
        has_more: true,
      })
      .mockResolvedValueOnce({
        name: "Hoja1",
        rows: [["LOS OLIVOS", "2026-08-28", "10:00", "18:00", "R-03", "S-03"]],
        offset: 3,
        limit: 2000,
        total: 4,
        has_more: false,
      });
    mocks.fileTokenCleanup.mockResolvedValue({ cleaned: true });

    const result = await importSpreadsheet(new File(["xlsx"], "volantes.xlsx"));

    expect(mocks.spreadsheetParse).toHaveBeenCalledWith(
      { file_token: "antares-read_input", format_hint: "xlsx" },
      { hydrate: false },
    );
    expect(mocks.spreadsheetGetRows.mock.calls.map(([params]) => params.offset)).toEqual([0, 3]);
    expect(result.records.map((record) => record.reservorio)).toEqual(["R-01", "R-02", "R-03"]);
    expect(mocks.fileTokenCleanup).toHaveBeenCalledWith("antares-read_result");
  });
});
