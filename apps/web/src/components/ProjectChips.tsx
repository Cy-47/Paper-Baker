import { useMemo } from "react";
import { Chip } from "@heroui/react";
import { useData } from "../hooks/useData";

/**
 * Renders a paper's project memberships as chips, resolving ids to names.
 * `showEmpty` renders a muted "No project" chip when the list is empty — used on
 * collection overviews (Home, Library) where "unfiled" is useful signal;
 * discovery surfaces (Find, AddToProject) leave it off to avoid noise.
 */
export default function ProjectChips({
  projectIds,
  showEmpty = false,
}: {
  projectIds: string[];
  showEmpty?: boolean;
}) {
  const { projects } = useData();
  const nameOf = useMemo(
    () => new Map(projects.map((p) => [p.stableId, p.name])),
    [projects]
  );

  if (projectIds.length === 0) {
    return showEmpty ? (
      <Chip size="sm" variant="soft">
        No project
      </Chip>
    ) : null;
  }

  return (
    <>
      {projectIds.map((id) => (
        <Chip key={id} size="sm" variant="soft">
          {nameOf.get(id) ?? "project"}
        </Chip>
      ))}
    </>
  );
}
