// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Input,
  Item,
  ItemDescription,
  ItemTitle,
  Kbd,
  Separator,
  Spinner,
  Switch,
  Tabs,
  TabsList,
  TabsTab,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../";

vi.mock("../../../features/settings/theme-store", () => ({
  useThemeStore: () => "light",
}));

describe("ui primitives", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders a button with variant and size classes", () => {
    render(
      <Button variant="primary" size="lg">
        Send
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toHaveAttribute("data-variant", "primary");
    expect(button.className).toContain("bg-primary");
  });

  it("renders badge, kbd, separator, and spinner", () => {
    render(
      <>
        <Badge data-testid="badge">待审批</Badge>
        <Kbd>⌘K</Kbd>
        <Separator orientation="horizontal" />
        <Spinner />
      </>,
    );
    expect(screen.getByTestId("badge").className).toContain("rounded-full");
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("renders form controls", () => {
    render(
      <>
        <Input placeholder="search" />
        <Textarea />
        <Switch />
      </>,
    );
    expect(screen.getByPlaceholderText("search")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("renders tabs structure", () => {
    render(
      <Tabs defaultValue="outputs">
        <TabsList>
          <TabsTab value="outputs">Outputs</TabsTab>
          <TabsTab value="changes">Changes</TabsTab>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Outputs");
  });

  it("renders empty-state composition", () => {
    render(
      <Empty>
        <EmptyTitle>Nothing here</EmptyTitle>
        <EmptyDescription>Create a project to begin.</EmptyDescription>
      </Empty>,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders item rows", () => {
    render(
      <Item>
        <ItemTitle>report.pdf</ItemTitle>
        <ItemDescription>2.1 MB</ItemDescription>
      </Item>,
    );
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("opens a dialog and a dropdown menu through Base UI behavior", () => {
    render(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Confirm</DialogTitle>
          </DialogContent>
        </Dialog>
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Rename</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent>Hint</TooltipContent>
        </Tooltip>
      </>,
    );
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("separator", { hidden: true })).toBeInTheDocument();
  });
});
