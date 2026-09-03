import type { ComponentProps, ReactNode } from "react";
import { cn } from "../ui/utils";
import { Separator } from "../ui";

/**
 * Shared Settings layout system (§9). Every settings panel composes these
 * instead of painting its own form: they standardize section spacing, label,
 * description, control alignment, dividers and the danger zone. Styling is
 * utilities + semantic tokens only — no per-panel CSS families.
 */

/** Page root: one settings tab's content. */
export function SettingsPage({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-6", className)} {...props} />;
}

/** Intro header: eyebrow + optional title + description, optional trailing action. */
export function SettingsPageIntro({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-5", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <span className="mb-1 block text-[9px] font-bold tracking-[0.1em] text-primary uppercase">
            {eyebrow}
          </span>
        )}
        {title && (
          <h3 className="m-0 text-[17px] font-semibold tracking-tight text-foreground">{title}</h3>
        )}
        {description && (
          <p className="mt-1.5 max-w-[520px] text-[11.5px] leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** Titled section inside a page. */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      {(title || description || action) && (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {title && <h4 className="m-0 text-[12.5px] font-semibold text-foreground">{title}</h4>}
            {description && (
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{description}</p>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Card-like group that visually bundles related rows. */
export function SettingsGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-subtle",
        className,
      )}
      {...props}
    />
  );
}

/**
 * One label/description + control row. Control aligns right on wide layout
 * and stacks under the label on narrow widths.
 */
export function SettingsRow({
  label,
  description,
  control,
  htmlFor,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-4 py-3.5 max-md:flex-col max-md:items-start sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-foreground">
            {label}
          </label>
        ) : (
          <span className="block text-[12.5px] font-medium text-foreground">{label}</span>
        )}
        {description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
        {control}
      </div>
    </div>
  );
}

/** Alias for explicit control slot styling when not using SettingsRow. */
export function SettingsControl({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2", className)} {...props} />;
}

export function SettingsLabel({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("text-[12.5px] font-medium text-foreground", className)} {...props} />;
}

export function SettingsDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[11px] leading-relaxed text-muted", className)} {...props} />;
}

/** Destructive-action zone: tinted border + heading, rows inside. */
export function SettingsDangerZone({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/[0.04] p-4",
        className,
      )}
    >
      <div>
        <h4 className="m-0 text-[12.5px] font-semibold text-danger">{title}</h4>
        {description && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** Horizontal divider matching SettingsGroup row rhythm, for open layouts. */
export function SettingsDivider() {
  return <Separator>{null}</Separator>;
}

/**
 * Radio-card grid for enum choices (theme, language, …). Selection is
 * aria-pressed on each card; the active card shows the check affordance.
 */
export function SettingsOptionCardGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-3", className)} {...props} />;
}

export interface SettingsOptionCardProps extends Omit<
  ComponentProps<"button">,
  "title" | "children"
> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  selected: boolean;
  /** Optional trailing meta line under the description. */
  meta?: ReactNode;
}

export function SettingsOptionCard({
  icon,
  title,
  description,
  selected,
  meta,
  className,
  ...props
}: SettingsOptionCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "relative flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/[0.05]"
          : "border-border bg-surface-subtle hover:border-border-strong hover:bg-surface-hover",
        className,
      )}
      {...props}
    >
      <span className="flex w-full items-center gap-2">
        {icon && <span className="text-muted [&_svg]:size-4">{icon}</span>}
        <span className="text-[12.5px] font-medium text-foreground">{title}</span>
        {selected && (
          <svg
            viewBox="0 0 16 16"
            className="ml-auto size-4 shrink-0 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {description && <span className="text-[11px] leading-relaxed text-muted">{description}</span>}
      {meta}
    </button>
  );
}
