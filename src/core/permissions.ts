/**
 * UI-side mirror of the database's `can_edit_person()`. This only decides
 * which buttons are shown — the real enforcement is Row Level Security.
 */

export interface EditContext {
  isAdmin: boolean;
  isActiveEditor: boolean;
  /** Anchor people assigned to the editor (branch_access.person_id). */
  branchAccess: readonly string[];
  /** Ancestor-or-self chain of the person being edited (people.path). */
  personPath: readonly string[] | null | undefined;
}

export function canEditPerson(ctx: EditContext): boolean {
  if (ctx.isAdmin) return true;
  if (!ctx.isActiveEditor) return false;
  if (!ctx.personPath || ctx.personPath.length === 0) return false;
  const anchors = new Set(ctx.branchAccess);
  return ctx.personPath.some((id) => anchors.has(id));
}

/**
 * Live permission view handed to the tree workspace — the `AuthController`
 * satisfies it, so the workspace asks per call instead of snapshotting roles
 * at build time (a role or branch change re-renders straight away).
 */
export interface WorkspacePermissions {
  isAdmin(): boolean;
  isActiveEditor(): boolean;
  /** Anchor people assigned to the current editor (`branch_access`). */
  branchAccess(): readonly string[];
  canEditPerson(personId: string, personPath: readonly string[] | null | undefined): boolean;
}
