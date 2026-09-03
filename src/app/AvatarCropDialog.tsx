import { useCallback, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { ImagePlus, Minus, Plus, X } from "lucide-react";
import { AppDialog } from "../components/feedback";
import { Button, Input, Tip } from "../components/ui";
import { cropAvatarImage } from "./avatar-image";

interface AvatarCropDialogProps {
  imageUrl: string;
  onCancel: () => void;
  onSave: (imageData: string) => void;
}

export function AvatarCropDialog({ imageUrl, onCancel, onSave }: AvatarCropDialogProps) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

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
    <AppDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onCancel();
      }}
      title={t("personalization.cropTitle")}
      description={t("personalization.cropDescription")}
      showCloseButton={false}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            {t("personalization.cancelCrop")}
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => void handleSave()}
            disabled={saving || !croppedArea}
          >
            {saving ? t("personalization.processing") : t("personalization.usePhoto")}
          </Button>
        </>
      }
    >
      <Tip content={t("personalization.closeCrop")}>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          aria-label={t("personalization.closeCrop")}
          className="absolute top-2.5 right-2.5 grid size-7 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <X size={17} />
        </button>
      </Tip>
      <div className="avatar-crop-stage overflow-hidden rounded-xl">
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
        <Input
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
    </AppDialog>
  );
}
