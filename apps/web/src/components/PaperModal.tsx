import { BookOpenText, ArrowUpRight, FolderPlus } from "lucide-react";
import { Button, Modal } from "@heroui/react";
import { useData } from "../hooks/useData";
import { useSavePanel } from "../hooks/useSavePanel";
import ProjectChips from "./ProjectChips";

/**
 * A read-only modal showing a saved paper's full metadata + abstract.
 * Opened from the Papers list in the sidebar; resolves the paper from the
 * library by id so it always reflects the latest project memberships.
 * "Add to project" hands off to the shared Save panel.
 */
export default function PaperModal({
  paperId,
  onClose,
}: {
  paperId: string;
  onClose: () => void;
}) {
  const { itemFor } = useData();
  const panel = useSavePanel();
  const item = itemFor(paperId);

  if (!item) {
    onClose();
    return null;
  }

  const year = item.publishedAt ? item.publishedAt.slice(0, 4) : "";

  const addToProject = () => {
    panel.open(item);
  };

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading className="text-base font-medium leading-snug text-[var(--foreground)]">
                {item.title}
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <p className="text-xs text-[var(--muted)]">
                {item.authors.map((a) => a.name).join(", ")}
                {year && ` · ${year}`}
                {item.categories[0] && ` · ${item.categories[0]}`}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <ProjectChips projectIds={item.projectIds ?? []} showEmpty />
              </div>

              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                {item.abstract || "No abstract available."}
              </p>
            </Modal.Body>

            <Modal.Footer>
              <Button variant="secondary" size="sm" onPress={addToProject}>
                <FolderPlus size={15} /> Add to project
              </Button>
              {item.links.abs && (
                <a
                  href={item.links.abs}
                  target="_blank"
                  rel="noreferrer"
                  className="no-underline"
                >
                  <Button variant="secondary" size="sm">
                    <ArrowUpRight size={15} /> arXiv
                  </Button>
                </a>
              )}
              {item.links.pdf && (
                <a
                  href={item.links.pdf}
                  target="_blank"
                  rel="noreferrer"
                  className="no-underline"
                >
                  <Button variant="primary" size="sm">
                    <BookOpenText size={15} /> PDF
                  </Button>
                </a>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
