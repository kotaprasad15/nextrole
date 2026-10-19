import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/outreach",
}));

import { apiRequest } from "@/lib/api/client";
import { AppShell } from "./app-shell";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell>
        <p>page content</p>
      </AppShell>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/outreach?tab=drafts"); // the page the user is on when the session expires
});

describe("AppShell", () => {
  it("renders the skip link, main landmark, navigation and the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ email: "priya.nair@example.com" })));
    renderShell();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveTextContent("page content");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("PN"));
  });

  it("marks the current section in the nav (aria-current)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ email: "a@b.co" })));
    renderShell();
    expect(screen.getByRole("link", { name: "Outreach" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("on a 401 it asks the SERVER to clear the HttpOnly cookie, then redirects to /login with the return path", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/auth/logout") return new Response(null, { status: 204 });
      return json({ detail: "not authenticated" }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderShell();
    await apiRequest("/outreach").catch(() => {}); // any API call that returns 401
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Foutreach%3Ftab%3Ddrafts"));
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/api/auth/logout"); // without this the route guard would loop
    // The cookie must be cleared BEFORE navigating, or the guard bounces /login straight back.
    const logoutOrder = fetchMock.mock.invocationCallOrder[urls.indexOf("/api/auth/logout")];
    expect(logoutOrder).toBeLessThan(replace.mock.invocationCallOrder[0]);
  });

  it("still redirects if the logout call itself fails (offline)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/auth/logout") throw new TypeError("offline");
      return json({ detail: "not authenticated" }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderShell();
    await apiRequest("/outreach").catch(() => {});
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Foutreach%3Ftab%3Ddrafts"));
  });
});
