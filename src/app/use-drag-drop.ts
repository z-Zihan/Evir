import { useState, type DragEvent } from "react";

export function useDragDrop(onFiles: (files: FileList) => void) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  return { dragOver, handleDrop, handleDragOver, handleDragLeave };
}
