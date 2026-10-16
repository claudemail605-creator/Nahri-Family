import { describe, expect, it } from 'vitest';
import { canEditPerson, type EditContext } from '../../src/core/permissions';

function ctx(overrides: Partial<EditContext> = {}): EditContext {
  return {
    isAdmin: false,
    isActiveEditor: false,
    branchAccess: [],
    personPath: [],
    ...overrides,
  };
}

describe('canEditPerson() — UI mirror of public.can_edit_person()', () => {
  it('lets an admin edit anyone', () => {
    expect(canEditPerson(ctx({ isAdmin: true }))).toBe(true);
    expect(canEditPerson(ctx({ isAdmin: true, personPath: null }))).toBe(true);
  });

  it('requires an active editor for everyone else', () => {
    expect(canEditPerson(ctx({ isActiveEditor: false, branchAccess: ['p1'], personPath: ['p1'] }))).toBe(false);
  });

  it('lets an editor edit when any branch anchor is in the ancestor-or-self chain', () => {
    const editor = ctx({ isActiveEditor: true, branchAccess: ['p1'] });
    expect(canEditPerson({ ...editor, personPath: ['p0', 'p1', 'p2'] })).toBe(true);
    expect(canEditPerson({ ...editor, personPath: ['p1'] })).toBe(true);
    expect(canEditPerson({ ...editor, personPath: ['p0', 'p2'] })).toBe(false);
  });

  it('refuses an empty or unknown path, whatever the branch list', () => {
    const editor = ctx({ isActiveEditor: true, branchAccess: ['p1', 'p2'] });
    expect(canEditPerson({ ...editor, personPath: [] })).toBe(false);
    expect(canEditPerson({ ...editor, personPath: null })).toBe(false);
    expect(canEditPerson({ ...editor, personPath: undefined })).toBe(false);
  });
});
