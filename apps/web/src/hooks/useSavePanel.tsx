import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Bookmark, BookmarkX, Plus } from "lucide-react";
import { Button, Checkbox, Drawer, Input } from "@heroui/react";
import type { PaperMetadata } from "@paper-baker/core";
import { useData } from "./useData";
import {
  createProject,
  removeFromLibrary,
  addPaperToProject,
  removePaperFromProject,
} from "../lib/library";

interface SavePanelCtx {
  open: (paper: PaperMetadata) => void;
  close: () => void;
}
const Ctx = createContext<SavePanelCtx | null>(null);

export function SavePanelProvider({ children }: { children: ReactNode }) {
  // Hold the paper's metadata, not just its id: a paper saved moments ago from
  // the Find page hasn't propagated through the Firestore snapshot + papers/
  // metadata fetch yet, so itemFor(id) is still undefined. Keeping the metadata
  // here lets the panel render immediately instead of flashing closed.
  const [paper, setPaper] = useState<PaperMetadata | null>(null);
  const open = useCallback((p: PaperMetadata) => setPaper(p), []);
  const close = useCallback(() => setPaper(null), []);
  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {paper && <Panel paper={paper} onClose={close} />}
    </Ctx.Provider>
  );
}

export function useSavePanel(): SavePanelCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSavePanel must be used within provider");
  return ctx;
}

function Panel({ paper, onClose }: { paper: PaperMetadata; onClose: () => void }) {
  const { projects, itemFor } = useData();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  // The live library item (if/once it has propagated) drives the project
  // checkboxes; the panel itself renders from `paper`, so it never depends on
  // the item being loaded.
  const item = itemFor(paper.paperId);
  const memberOf = new Set(item?.projectIds ?? []);

  const toggle = (stableId: string) => {
    if (memberOf.has(stableId)) removePaperFromProject(stableId, paper.paperId);
    else addPaperToProject(stableId, paper);
  };

  const addProject = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const project = await createProject(name);
      await addPaperToProject(project.stableId, paper);
      setNewName("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Drawer isOpen onOpenChange={(o) => !o && onClose()}>
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.Header>
              <Drawer.Heading>Save</Drawer.Heading>
            </Drawer.Header>

            <Drawer.Body>
              <p className="text-sm font-medium leading-snug text-[var(--foreground)]">
                {paper.title}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {paper.authors.slice(0, 4).map((a) => a.name).join(", ")}
                {paper.authors.length > 4 && " et al."}
              </p>

              <div className="mt-3 flex items-center gap-2 rounded-[var(--radius)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-soft-foreground)]">
                <Bookmark size={14} /> Saved to Library
              </div>

              <p className="mb-1 mt-4 text-[11px] text-[var(--muted)]">Add to projects</p>

              {projects.length === 0 && (
                <p className="px-1 py-2 text-xs text-[var(--muted)]">
                  No projects yet — create one below.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {projects.map((p) => (
                  <Checkbox
                    key={p.stableId}
                    className="w-full"
                    isSelected={memberOf.has(p.stableId)}
                    onChange={() => toggle(p.stableId)}
                  >
                    <Checkbox.Content className="w-full">
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      {p.name}
                    </Checkbox.Content>
                  </Checkbox>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Input
                  placeholder="New project…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addProject()}
                  fullWidth
                />
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label="Create project"
                  onPress={addProject}
                  isDisabled={adding}
                >
                  <Plus size={18} />
                </Button>
              </div>
            </Drawer.Body>

            <Drawer.Footer>
              <Button
                variant="ghost"
                onPress={() => {
                  removeFromLibrary(paper.paperId);
                  onClose();
                }}
              >
                <BookmarkX size={16} /> Unsave (remove from Library)
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
