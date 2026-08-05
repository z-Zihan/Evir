export interface HelpTopic {
  id: string;
  titleKey: string;
  route: string;
  desktopOnly?: boolean;
}

export const HELP_TOPICS = [
  { id: "quick-start", titleKey: "help.quickStart", route: "/help/quick-start" },
  { id: "providers", titleKey: "help.providers", route: "/help/providers" },
  { id: "modes", titleKey: "help.modes", route: "/help/modes" },
  { id: "personalization", titleKey: "help.personalization", route: "/help/personalization" },
  { id: "skills", titleKey: "help.skills", route: "/help/skills" },
  { id: "mcp", titleKey: "help.mcp", route: "/help/mcp", desktopOnly: true },
  {
    id: "permissions",
    titleKey: "help.permissions",
    route: "/help/permissions",
    desktopOnly: true,
  },
  { id: "shortcuts", titleKey: "help.shortcuts", route: "/help/shortcuts" },
  { id: "usage", titleKey: "help.usage", route: "/help/usage" },
  { id: "privacy", titleKey: "help.privacy", route: "/help/privacy" },
  { id: "troubleshooting", titleKey: "help.troubleshooting", route: "/help/troubleshooting" },
] as const satisfies readonly HelpTopic[];
