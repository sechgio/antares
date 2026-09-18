import type { DragEvent } from "react";
import { FileImportInput } from "@/components/ui/FileImportInput";

interface LogoUploadBoxProps {
  value: string | null;
  label: string;
  alt: string;
  title?: string;
  onFiles: (files: FileList | null) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onDragOver: (event: DragEvent<HTMLLabelElement>) => void;
}

export default function LogoUploadBox({ value, label, alt, title, onFiles, onDrop, onDragOver }: LogoUploadBoxProps) {
  return (
    <label className="v-upload-box" onDragOver={onDragOver} onDrop={onDrop} title={title}>
      {value ? (
        <img src={value} alt={alt} className="v-upload-preview" />
      ) : (
        <>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{label}</span>
        </>
      )}
      <FileImportInput accept="image/*" onFiles={onFiles} hidden />
    </label>
  );
}
