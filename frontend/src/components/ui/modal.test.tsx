import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Modal } from "./modal";

function Harness({ withField }: { withField: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Modal open={open} onOpenChange={setOpen} title="A dialog" footer={<button onClick={() => setOpen(false)}>Done</button>}>
        {withField && <label>Your note<textarea /></label>}
      </Modal>
    </>
  );
}

describe("Modal focus management", () => {
  it("moves focus to the first field, and gives it back to the opener on close", async () => {
    const user = userEvent.setup();
    render(<Harness withField />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByLabelText("Your note")).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("without a field, focus still lands inside the dialog and returns to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness withField={false} />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps focus trapped while open", async () => {
    const user = userEvent.setup();
    render(<Harness withField />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    const dialog = await screen.findByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
