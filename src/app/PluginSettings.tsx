import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Puzzle, ShieldAlert, Trash2 } from "lucide-react";
import { Badge, Button, Tip } from "../components/ui";
import { DangerConfirmDialog, FormDialog, InlineError, notify } from "../components/feedback";
import {
  SettingsDescription,
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
} from "../components/settings";
import { Switch } from "../components/ui";
import { getRuntime } from "../runtime/use-runtime";
import { usePluginStore } from "../features/plugins/plugin-store";
import { usePluginContributionStore } from "../features/plugins/plugin-contributions";
import {
  effectivePermissions,
  permissionDiff,
  type PluginManifest,
  type PluginRecord,
} from "../features/plugins/plugin-types";

/**
 * Plugins settings (§43): install from a local folder, review declared
 * permissions before confirming, enable/disable (contributions update live),
 * per-plugin boolean settings, uninstall. No marketplace — nothing fake.
 */

interface PendingInstall {
  manifest: PluginManifest;
  sourcePath: string;
  newPermissions: string[];
}

export function PluginSettingsPanel() {
  const { t } = useTranslation();
  const isDesktop = getRuntime().target === "desktop";
  const plugins = usePluginStore((state) => state.plugins);
  const load = usePluginStore((state) => state.load);
  const readManifestFromFolder = usePluginStore((state) => state.readManifestFromFolder);
  const install = usePluginStore((state) => state.install);
  const uninstall = usePluginStore((state) => state.uninstall);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const getSetting = usePluginStore((state) => state.getSetting);
  const setSetting = usePluginStore((state) => state.setSetting);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PluginRecord | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const pickFolder = async () => {
    setBusy(true);
    setError(null);
    try {
      const { sourcePath, ...manifest } = await readManifestFromFolder();
      const existing = plugins.find((plugin) => plugin.id === manifest.id);
      const diff = existing
        ? permissionDiff(existing.permissions, effectivePermissions(manifest))
        : effectivePermissions(manifest);
      setPending({ manifest, sourcePath, newPermissions: diff });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message !== "plugins.cancelled") setError(message);
    } finally {
      setBusy(false);
    }
  };

  const confirmInstall = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const record = await install(pending.manifest, pending.sourcePath);
      setPending(null);
      notify.success(t("plugins.installed", { name: record.name }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("plugins.eyebrow")}
        description={t("plugins.pageDescription")}
      />

      <SettingsGroup>
        <SettingsRow
          label={t("plugins.installTitle")}
          description={isDesktop ? t("plugins.installDescription") : t("plugins.desktopOnly")}
          control={
            <Button
              variant="secondary"
              size="sm"
              disabled={!isDesktop || busy}
              onClick={() => void pickFolder()}
            >
              <FolderOpen size={13} />
              {t("plugins.installFromFolder")}
            </Button>
          }
        />
      </SettingsGroup>

      <SettingsGroup>
        <div className="flex flex-col gap-2 p-3">
          <strong className="px-1 text-[12px] font-semibold text-foreground">
            {t("plugins.installedTitle")}
          </strong>
          {plugins.length === 0 ? (
            <SettingsDescription className="px-1">{t("plugins.noneInstalled")}</SettingsDescription>
          ) : (
            plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onToggle={(enabled) =>
                  void setEnabled(plugin.id, enabled).catch(showError(setError))
                }
                onDelete={() => setDeleteTarget(plugin)}
                getSetting={getSetting}
                setSetting={setSetting}
              />
            ))
          )}
        </div>
      </SettingsGroup>

      {error && <InlineError message={error} />}

      <FormDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("plugins.confirmTitle", { name: pending?.manifest.name ?? "" })}
        description={t("plugins.confirmDescription")}
        submitLabel={t("plugins.confirmInstall")}
        busy={busy}
        onSubmit={() => void confirmInstall()}
      >
        <div className="flex flex-col gap-3 text-[12px]">
          <div className="flex items-center gap-2">
            <Puzzle size={14} aria-hidden="true" className="text-primary" />
            <strong>{pending?.manifest.name}</strong>
            <span className="text-muted">{pending?.manifest.version}</span>
            {pending?.manifest.author && (
              <span className="text-muted">· {pending.manifest.author}</span>
            )}
          </div>
          {pending?.manifest.description && (
            <p className="text-muted">{pending.manifest.description}</p>
          )}
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-subtle p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <ShieldAlert size={13} aria-hidden="true" className="text-warning" />
              {t("plugins.permissionsTitle")}
            </div>
            <ul className="ml-5 list-disc text-[11.5px] text-muted">
              {(pending?.newPermissions.length
                ? pending.newPermissions
                : effectivePermissions(
                    pending?.manifest ?? { schemaVersion: 1, id: "x", name: "x", version: "0.0.1" },
                  )
              ).map((permission) => (
                <li key={permission}>{t(`plugins.permission.${permission}`)}</li>
              ))}
            </ul>
            {pending && pending.newPermissions.length === 0 && (
              <p className="text-[11px] text-muted">{t("plugins.noNewPermissions")}</p>
            )}
            <p className="text-[11px] text-muted">{t("plugins.permissionsFootnote")}</p>
          </div>
          <div className="text-[11px] text-muted">
            {t("plugins.sourceLabel")}: <code>{pending?.sourcePath}</code>
          </div>
        </div>
      </FormDialog>

      <DangerConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("plugins.deleteTitle")}
        description={t("plugins.deleteDescription", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("plugins.deleteConfirm")}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await uninstall(deleteTarget.id);
            notify.success(t("plugins.uninstalled", { name: deleteTarget.name }));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setDeleteTarget(null);
          }
        }}
      />
    </SettingsPage>
  );
}

function showError(setError: (message: string | null) => void) {
  return (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
}

function PluginCard({
  plugin,
  onToggle,
  onDelete,
  getSetting,
  setSetting,
}: {
  plugin: PluginRecord;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  getSetting: (pluginId: string, key: string, fallback: boolean) => Promise<boolean>;
  setSetting: (pluginId: string, key: string, value: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const slashCommands = usePluginContributionStore((state) =>
    state.slashCommands.filter((command) => command.pluginId === plugin.id),
  );
  const settingsSchema = plugin.manifest.contributes?.settings ?? [];
  const [values, setValues] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;
    void Promise.all(
      settingsSchema.map(
        async (setting) =>
          [setting.key, await getSetting(plugin.id, setting.key, setting.default)] as const,
      ),
    ).then((entries) => {
      if (mounted) setValues(Object.fromEntries(entries));
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id]);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Puzzle size={14} aria-hidden="true" className="shrink-0 text-primary/80" />
        <strong className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">
          {plugin.name}
        </strong>
        <span className="shrink-0 text-[11px] text-muted">{plugin.version}</span>
        {plugin.author && (
          <span className="shrink-0 text-[11px] text-muted">· {plugin.author}</span>
        )}
        <Badge variant={plugin.enabled ? "success" : "secondary"}>
          {plugin.enabled ? t("plugins.statusEnabled") : t("plugins.statusDisabled")}
        </Badge>
        <Tip content={t("plugins.delete")}>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-danger"
            aria-label={t("plugins.delete")}
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </Button>
        </Tip>
        <Switch
          checked={plugin.enabled}
          onCheckedChange={onToggle}
          aria-label={t("plugins.toggleLabel", { name: plugin.name })}
        />
      </div>
      {plugin.description && (
        <p className="text-[11.5px] leading-relaxed text-muted">{plugin.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {plugin.permissions.map((permission) => (
          <span
            key={permission}
            className="rounded-md border border-border bg-surface px-1.5 py-px"
          >
            {t(`plugins.permission.${permission}`)}
          </span>
        ))}
        {slashCommands.length > 0 && (
          <span>· {slashCommands.map((command) => `/${command.id}`).join(" ")}</span>
        )}
      </div>
      {plugin.enabled && settingsSchema.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          {settingsSchema.map((setting) => (
            <div key={setting.key} className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-foreground">{setting.label}</span>
              <Switch
                checked={values[setting.key] ?? setting.default}
                onCheckedChange={(checked) => {
                  setValues((current) => ({ ...current, [setting.key]: checked }));
                  void setSetting(plugin.id, setting.key, checked);
                }}
                aria-label={setting.label}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
