import { useEffect, useRef } from "react";
import { CheckCircle, FileSpreadsheet, Upload, X } from "lucide-react";
import type React from "react";
import Button from "@/components/ui/Button";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import ThemedSelect from "../../ui/ThemedSelect";
import type { ExcelRecord } from "../data";

interface ExcelImportModalProps {
  isImporting: boolean;
  importedFileName: string;
  importStatus: string;
  excelRecords: ExcelRecord[];
  selectedRecordId: string;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRecordSelect: (id: string) => void;
  onClose: () => void;
}

export default function ExcelImportModal({
  isImporting,
  importedFileName,
  importStatus,
  excelRecords,
  selectedRecordId,
  onUpload,
  onRecordSelect,
  onClose,
}: ExcelImportModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="vpad-excel-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="vpad-excel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vpad-excel-modal-title"
      >
        <div className="vpad-excel-modal-header">
          <h3 className="vpad-excel-modal-title" id="vpad-excel-modal-title">
            <FileSpreadsheet
              size={18}
              style={{ color: "var(--vpad-accent)" }}
            />
            Importar Excel
          </h3>
          <Button
            variant="none"
            size="none"
            className="vpad-excel-modal-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={18} />
          </Button>
        </div>
        <div className="vpad-excel-modal-body">
          <label
            className={`vpad-upload-zone vpad-btn-import${isImporting ? " active" : ""}${importedFileName ? " loaded" : ""}`}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onUpload}
              disabled={isImporting}
            />
            {importedFileName ? (
              <>
                <div className="vpad-upload-icon vpad-upload-icon-loaded">
                  <CheckCircle size={20} />
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <span className="vpad-upload-text">
                    {importedFileName}
                  </span>
                  <span className="vpad-upload-hint">{importStatus}</span>
                </div>
              </>
            ) : (
              <>
                <div className="vpad-upload-icon">
                  <Upload size={20} />
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <span className="vpad-upload-text">
                    {isImporting
                      ? "Procesando archivo..."
                      : "Selecciona o arrastra el archivo"}
                  </span>
                  <span className="vpad-upload-hint">
                    Soporte para .xlsx, .xls, .csv
                  </span>
                </div>
              </>
            )}
          </label>

          {excelRecords.length > 1 && (
            <div className="vpad-field">
              <span>Seleccionar registro</span>
              <ThemedSelect
                value={selectedRecordId}
                onChange={onRecordSelect}
                options={excelRecords.map((r) => ({
                  value: r.id,
                  label: r.label,
                }))}
                aria-label="Seleccionar registro"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
