import { Bookmark } from "lucide-react";
import { Button } from "@heroui/react";

/**
 * The library "Save" action. Once a paper is in the library it shows a filled
 * bookmark + "Saved" (secondary variant); otherwise an outline bookmark +
 * "Save" (primary). Centralised so the saved state can't diverge between the
 * surfaces that offer it (Find, AddToProject).
 */
export default function SaveButton({
  saved,
  onPress,
}: {
  saved: boolean;
  onPress: () => void;
}) {
  return (
    <Button variant={saved ? "secondary" : "primary"} size="sm" onPress={onPress}>
      <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
      {saved ? "Saved" : "Save"}
    </Button>
  );
}
