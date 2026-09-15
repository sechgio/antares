import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import type { ImageAsset } from '../types/imageAssets';

interface UseImageUploaderStateOptions<TImage extends ImageAsset> {
  images: TImage[];
  onAdd: (files: File[]) => string[] | Promise<string[]>;
  acceptFile?: (file: File) => boolean;
  visibleLimit?: number;
}

export function useImageUploaderState<TImage extends ImageAsset>({
  images,
  onAdd,
  acceptFile,
  visibleLimit = 10,
}: UseImageUploaderStateOptions<TImage>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  const handleFiles = useCallback(async (files: FileList | null) => {
    // Snapshot the live FileList before resetting the native file input.
    const selectedFiles = files ? Array.from(files) : [];
    if (inputRef.current) inputRef.current.value = '';
    if (!files) return;
    const fileList = acceptFile ? selectedFiles.filter(acceptFile) : selectedFiles;
    const nextErrors = await onAdd(fileList);
    setErrors(nextErrors);
  }, [acceptFile, onAdd]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFiles(event.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);
  const clearErrors = useCallback(() => setErrors([]), []);
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);
  const hasMore = images.length > visibleLimit;
  const visibleImages = useMemo(
    () => (expanded || !hasMore ? images : images.slice(0, visibleLimit)),
    [expanded, hasMore, images, visibleLimit],
  );

  return {
    inputRef,
    isDragging,
    errors,
    expanded,
    hasMore,
    hiddenCount: Math.max(0, images.length - visibleLimit),
    visibleImages,
    handleFiles,
    onDrop,
    onDragOver,
    onDragLeave,
    clearErrors,
    toggleExpanded,
  };
}
