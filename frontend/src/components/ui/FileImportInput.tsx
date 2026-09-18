import { forwardRef, type InputHTMLAttributes } from 'react';

export interface FileImportInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  onFiles: (files: FileList | null) => void;
}

export const FileImportInput = forwardRef<HTMLInputElement, FileImportInputProps>(
  function FileImportInput({ onFiles, className, ...rest }, ref) {
    return (
      <input
        {...rest}
        ref={ref}
        type="file"
        className={className}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = '';
        }}
      />
    );
  },
);
