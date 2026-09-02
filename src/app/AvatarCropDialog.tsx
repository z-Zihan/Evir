import { useCallback, useEffect, useId, useRef, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { ImagePlus, Minus, Plus, X } from "lucide-react";
import { Button } from "../components/ui";
import { cropAvatarImage } from "./avatar-image";

interface AvatarCropDialogProps {
  imageUrl: string;
  onCancel: () => void;
  onSave: (imageData: string) => void;
}

export function AvatarCropDialog({ imageUrl, onCancel, onSave }: AvatarCropDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const savingRef = useRef(false);
  onCancelRef.current = onCancel;
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  savingRef.current = saving;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedArea(pixels);
  }, []);

  const handleSave = async () => {
    if (!croppedArea) return;
    setSaving(true);
    setError(false);
    try {
      onSave(await cropAvatarImage(imageUrl, croppedArea));
    } catch {
      setError(true);
      setSaving(false);
    }
  };

  return (
    <div className="avatar-crop-backdrop" onMouseDown={saving ? undefined : onCancel}>
      <section
        ref={dialogRef}
        className="avatar-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h4 id={titleId}>{t("personalization.cropTitle")}</h4>
            <p>{t("personalization.cropDescription")}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label={t("personalization.closeCrop")}
            data-tip={t("personalization.closeCrop")}
          >
            <X size={17} />
          </button>
        </header>
        <div className="avatar-crop-stage">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onCropComplete={handleCropComplete}
            onZoomChange={setZoom}
          />
        </div>
        <div className="avatar-crop-controls">
          <ImagePlus size={15} aria-hidden="true" />
          <label htmlFor="avatar-zoom">{t("personalization.zoom")}</label>
          <Minus size={13} aria-hidden="true" />
          <input
            id="avatar-zoom"
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <Plus size={13} aria-hidden="true" />
        </div>
        {error && (
          <p className="avatar-crop-error" role="alert">
            {t("personalization.cropError")}
          </p>
        )}
        <footer>
          <button type="button" onClick={onCancel} disabled={saving}>
            {t("personalization.cancelCrop")}
          </button>
          <Button
            variant="primary"
            size="lg"
            className="primary-button h-auto"
            onClick={() => void handleSave()}
            disabled={saving || !croppedArea}
          >
            {saving ? t("personalization.processing") : t("personalization.usePhoto")}
          </Button>
        </footer>
      </section>
    </div>
  );
}
