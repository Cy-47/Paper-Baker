import { Button, Modal } from "@heroui/react";

/**
 * A small confirmation dialog for destructive or irreversible actions.
 * Mirrors the Modal structure used across the app (see PaperModal) so the
 * confirm step feels native rather than bolted on.
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Remove",
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const confirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading className="text-base font-medium leading-snug text-[var(--foreground)]">
                {title}
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <p className="text-sm leading-relaxed text-[var(--muted)]">{message}</p>
            </Modal.Body>

            <Modal.Footer>
              <Button variant="secondary" size="sm" onPress={onClose}>
                {cancelLabel}
              </Button>
              <Button variant="danger" size="sm" onPress={confirm}>
                {confirmLabel}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
