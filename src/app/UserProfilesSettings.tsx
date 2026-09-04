import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Check, Pencil, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { Button, Input, Tip } from "../components/ui";
import { DangerConfirmDialog, FormDialog, InlineError, notify } from "../components/feedback";
import {
  SettingsControl,
  SettingsDescription,
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
} from "../components/settings";
import { useChatStore } from "../features/chat/chat-store";
import { useProfileStore } from "../features/profiles/profile-service";
import type { UserProfile } from "../features/profiles/profile-types";
import { AvatarCropDialog } from "./AvatarCropDialog";
import { validateAvatarFile } from "./avatar-image";
import { useConfirmationDialog } from "./useConfirmationDialog";

/**
 * 用户 configuration (§50, §56-60): the settings page is the main entry for
 * user management. Each user is a local profile with fully separated storage
 * (conversations, providers/keys, memory, traces…). Switching stops the
 * current user's active work first and reloads into the target profile —
 * v1 has no cross-user background execution.
 */

function profileInitial(profile: UserProfile): string {
  return Array.from(profile.displayName.trim())[0]?.toLocaleUpperCase() ?? "•";
}

export function UserProfilesPanel() {
  const { t } = useTranslation();
  const snapshot = useProfileStore((state) => state.snapshot);
  const listProfiles = useProfileStore((state) => state.list);
  const createProfile = useProfileStore((state) => state.create);
  const updateProfile = useProfileStore((state) => state.update);
  const removeProfile = useProfileStore((state) => state.remove);
  const activateProfile = useProfileStore((state) => state.activate);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [switchAfterCreate, setSwitchAfterCreate] = useState(true);
  const [renameTarget, setRenameTarget] = useState<UserProfile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    void listProfiles().catch(() => setError("users.loadError"));
  }, [listProfiles]);

  useEffect(
    () => () => {
      if (cropSource) URL.revokeObjectURL(cropSource);
    },
    [cropSource],
  );

  const active =
    snapshot?.profiles.find((profile) => profile.id === snapshot.activeProfileId) ?? null;
  const others = (snapshot?.profiles ?? []).filter((profile) => profile.id !== active?.id);

  const countActiveWork = (): { running: number; approvals: number } => {
    const state = useChatStore.getState();
    return {
      running: Object.keys(state.streamSlots ?? {}).length,
      approvals: Object.keys(state.pendingApprovals ?? {}).length,
    };
  };

  const stopActiveWork = (): void => {
    const state = useChatStore.getState();
    // stopGeneration aborts one conversation's stream AND cancels its pending
    // approvals; union both indexes so waiting-on-approval tasks stop too.
    const conversations = new Set([
      ...Object.keys(state.streamSlots ?? {}),
      ...Object.keys(state.pendingApprovals ?? {}),
    ]);
    for (const conversationId of conversations) {
      state.stopGeneration(conversationId);
    }
  };

  const performSwitch = async (profileId: string) => {
    setSwitching(true);
    setError(null);
    try {
      stopActiveWork();
      await activateProfile(profileId);
      // Atomic by reload (§58): the host already swapped the DB connection;
      // a fresh frontend cannot carry any of the previous user's state.
      window.location.reload();
    } catch (cause) {
      setSwitching(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleSwitch = (profile: UserProfile) => {
    const { running, approvals } = countActiveWork();
    const busy = running > 0 || approvals > 0;
    if (!busy) {
      void performSwitch(profile.id);
      return;
    }
    requestConfirmation(
      {
        title: t("users.switchConfirmTitle"),
        description: t("users.switchConfirmDescription", {
          running,
          approvals,
          name: profile.displayName,
        }),
        confirmLabel: t("users.stopAndSwitch"),
        tone: "warning",
      },
      () => void performSwitch(profile.id),
    );
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const profile = await createProfile(newName);
      setAddOpen(false);
      setNewName("");
      if (switchAfterCreate) {
        await performSwitch(profile.id);
      } else {
        notify.success(t("users.created", { name: profile.displayName }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    try {
      await updateProfile(renameTarget.id, { displayName: renameValue });
      setRenameTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeProfile(deleteTarget.id);
      notify.success(t("users.deleted", { name: deleteTarget.displayName }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fileError = validateAvatarFile(file);
    if (fileError) {
      setAvatarError(
        t(
          fileError === "type"
            ? "personalization.avatarTypeError"
            : "personalization.avatarSizeError",
        ),
      );
      return;
    }
    setAvatarError(null);
    setCropSource(URL.createObjectURL(file));
  };

  const saveAvatar = async (avatarImage: string) => {
    setCropSource(null);
    if (!active) return;
    try {
      await updateProfile(active.id, { avatar: avatarImage });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <SettingsPage>
      <SettingsPageIntro eyebrow={t("users.eyebrow")} description={t("users.pageDescription")} />

      <SettingsGroup>
        <div className="flex flex-col gap-6 p-4 sm:flex-row sm:gap-8">
          <div className="flex flex-col items-center gap-2.5">
            <button
              className="identity-avatar-upload avatar-sage"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("personalization.uploadAvatar")}
            >
              {active?.avatar ? (
                <img src={active.avatar} alt="" />
              ) : (
                <span>{active ? profileInitial(active) : "•"}</span>
              )}
              <i aria-hidden="true">
                <Camera size={15} />
              </i>
            </button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarFile}
            />
            <SettingsControl className="flex-col items-center gap-1">
              {active?.avatar && (
                <Button
                  variant="ghost-destructive"
                  size="sm"
                  onClick={() =>
                    active &&
                    void updateProfile(active.id, { avatar: null }).catch(() =>
                      setError("users.saveError"),
                    )
                  }
                >
                  <Trash2 size={13} /> {t("personalization.removePhoto")}
                </Button>
              )}
            </SettingsControl>
            <SettingsDescription className="max-w-36 text-center">
              {t("personalization.avatarHint")}
            </SettingsDescription>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
            <div className="flex items-center gap-2">
              <UserRound size={14} aria-hidden="true" className="shrink-0 text-muted" />
              <strong className="truncate text-[13.5px] font-semibold text-foreground">
                {active?.displayName ?? "—"}
              </strong>
              <span className="rounded-md border border-success/40 bg-success/10 px-1.5 py-px text-[10px] font-medium text-success">
                {t("users.currentUser")}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!active}
                onClick={() => {
                  setRenameTarget(active);
                  setRenameValue(active?.displayName ?? "");
                }}
              >
                <Pencil size={13} />
                {t("users.rename")}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
                <Plus size={13} />
                {t("users.add")}
              </Button>
            </div>
            <SettingsDescription>{t("users.currentHint")}</SettingsDescription>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="flex flex-col gap-2 p-3">
          <strong className="px-1 text-[12px] font-semibold text-foreground">
            {t("users.allUsers")}
          </strong>
          {others.length === 0 ? (
            <SettingsDescription className="px-1">{t("users.noOtherUsers")}</SettingsDescription>
          ) : (
            others.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-hover text-[11.5px] font-semibold text-foreground">
                  {profile.avatar ? (
                    <img src={profile.avatar} alt="" className="size-full object-cover" />
                  ) : (
                    profileInitial(profile)
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {profile.displayName}
                </span>
                <Tip content={t("users.rename")}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("users.rename")}
                    onClick={() => {
                      setRenameTarget(profile);
                      setRenameValue(profile.displayName);
                    }}
                  >
                    <Pencil size={13} />
                  </Button>
                </Tip>
                <Tip content={t("users.delete")}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-danger"
                    aria-label={t("users.delete")}
                    onClick={() => setDeleteTarget(profile)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </Tip>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={switching}
                  onClick={() => handleSwitch(profile)}
                >
                  {switching ? <Check size={13} /> : null}
                  {t("users.switch")}
                </Button>
              </div>
            ))
          )}
        </div>
      </SettingsGroup>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-subtle p-4">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <strong className="block text-[12.5px] font-medium text-foreground">
            {t("users.isolationTitle")}
          </strong>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
            {t("users.isolationDescription")}
          </span>
        </div>
      </div>

      {(error || avatarError) && (
        <InlineError message={error ? displayError(error, t) : (avatarError ?? "")} />
      )}

      <FormDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setNewName("");
        }}
        title={t("users.addTitle")}
        description={t("users.addDescription")}
        submitLabel={t("users.create")}
        busy={creating}
        disabled={!newName.trim()}
        onSubmit={() => void handleCreate()}
      >
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            type="text"
            value={newName}
            maxLength={40}
            placeholder={t("users.namePlaceholder")}
            onChange={(event) => setNewName(event.target.value)}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              checked={switchAfterCreate}
              onChange={(event) => setSwitchAfterCreate(event.target.checked)}
            />
            {t("users.switchAfterCreate")}
          </label>
        </div>
      </FormDialog>

      <FormDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title={t("users.renameTitle")}
        submitLabel={t("users.save")}
        disabled={!renameValue.trim()}
        onSubmit={() => void handleRename()}
      >
        <Input
          autoFocus
          type="text"
          value={renameValue}
          maxLength={40}
          onChange={(event) => setRenameValue(event.target.value)}
        />
      </FormDialog>

      <DangerConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("users.deleteTitle")}
        description={t("users.deleteDescription", { name: deleteTarget?.displayName ?? "" })}
        confirmLabel={t("users.deleteConfirm")}
        onConfirm={() => void handleDelete()}
      />

      {cropSource && (
        <AvatarCropDialog
          imageUrl={cropSource}
          onCancel={() => setCropSource(null)}
          onSave={(avatarImage) => void saveAvatar(avatarImage)}
        />
      )}
      {confirmationDialog}
    </SettingsPage>
  );
}

function displayError(message: string, t: (key: string) => string): string {
  return message.startsWith("profile:") || message.startsWith("users.") ? t(message) : message;
}
