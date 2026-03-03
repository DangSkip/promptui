/**
 * validate.ts — Validate promptui payloads before sending to the server.
 *
 * Returns null if valid, or an actionable error string if not.
 */

import { Payload } from './types';

export function validatePayload(payload: Payload): string | null {
  if (!payload.type) {
    return 'missing "type" field — could not infer prompt type from markdown';
  }

  switch (payload.type) {
    case 'choose':
    case 'pick_many':
      if (!payload.options || payload.options.length === 0) {
        return `${payload.type} requires options.\n  Add bullet items to your markdown:\n    - Option A\n    - Option B`;
      }
      break;

    case 'review_each':
      if (!payload.options || payload.options.length === 0) {
        return 'review_each requires options (bullet items to review).\n  Add bullet items to your markdown:\n    - Item to review';
      }
      if (!payload.actions || payload.actions.length === 0) {
        return 'review_each requires actions.\n  Add to frontmatter: actions: [Approve, Reject, Skip]';
      }
      break;

    case 'review':
      if (!payload.actions || payload.actions.length === 0) {
        return 'review requires actions.\n  Add to frontmatter: actions: [Approve, Reject, Skip]';
      }
      break;

    case 'form':
      if (!payload.fields || payload.fields.length === 0) {
        return 'form requires fields.\n  Add bullet items with types:\n    - Name (text)\n    - Notes (textarea)';
      }
      break;

    case 'compare':
      if (!payload.sections || payload.sections.length === 0) {
        return 'compare requires sections.\n  Add ## headings to your markdown:\n    ## Option A\n    Content...\n    ## Option B\n    Content...';
      }
      break;

    case 'rank':
      if (!payload.options || payload.options.length === 0) {
        return 'rank requires options.\n  Add bullet items to your markdown:\n    - First item\n    - Second item';
      }
      break;

    case 'file':
      if (!payload.root) {
        return 'file picker requires a root directory.\n  Add to frontmatter: root: /path/to/directory';
      }
      break;

    case 'upload':
      if (!payload.dest) {
        return 'upload requires a destination directory.\n  Add to frontmatter: dest: /path/to/save';
      }
      break;
  }

  return null;
}
