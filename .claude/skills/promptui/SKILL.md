---
name: promptui
description: Show rich browser UI when the terminal isn't enough — visual pickers with images, side-by-side comparisons, multi-field forms, file browsers, drag-and-drop uploads, and review workflows.
argument-hint: "[what to prompt for]"
allowed-tools: Bash, Read, Glob, Grep
---

promptui opens a browser window. Only use it when the terminal can't do the job — images, complex forms, file browsing, side-by-side comparisons, batch review. For yes/no, short text choices, or simple messages, use the terminal.

## Quick reference

| Type | Use when | Key frontmatter |
|------|----------|-----------------|
| `choose` | Picking from image options or large lists | `filter: true` for 10+ items |
| `pick_many` | Multi-select with images or large lists | `filter: true` for 10+ items |
| `compare` | Side-by-side code, text, or content | `##` headings become panels |
| `form` | Mixed inputs: text + dropdowns + toggles | field syntax in bullets |
| `review` | Read rich content, then decide | `actions: [Accept, Reject, ...]` |
| `review_each` | Batch review items individually | `actions: [...]` + bullet items |
| `rank` | Drag-to-reorder prioritization | bullet items |
| `file` | Browse and pick files from a directory | `root:`, `extensions:`, `multi:` |
| `upload` | Drag-and-drop file upload | `dest:`, `extensions:`, `multi:` |
| `text` | Long-form input with rich context above | `placeholder:` |
| `range` | Numeric slider | `min:`, `max:`, `step:`, `value:` |

## How it works

Write a Markdown file, run `promptui <file>`, get the result on stdout.

```bash
cat > /tmp/prompt.md << 'PROMPT'
---
type: choose
---
# Pick the homepage hero image

- ![Ocean sunset](./images/sunset.png)
- ![Mountain peak](./images/mountain.png)
- ![City skyline](./images/city.png)
PROMPT

CHOICE=$(promptui /tmp/prompt.md)
```

Paths (images, `root`, `dest`) can be relative to the .md file — they're resolved automatically. If the user clicks "let's rather talk about this", the result is `dismissed`.

## Markdown format

Every prompt file has two parts:

1. **Frontmatter** (between `---` fences) — always include this. Set `type:` and any config.
2. **Body** — `#` title, body text, `- ` bullet items, `##` section headings.

```
---
type: choose
---
# Title here

Body text (markdown).

- Bullet items become options
```

Always set `type:` explicitly.

## Prompt type details

### choose / pick_many

```markdown
---
type: choose
---
# Which design direction?

- ![Minimal](minimal.png)
- ![Bold](bold.png)
- ![Playful](playful.png)
```

- Use `type: pick_many` for multi-select (checkboxes)
- Add `filter: true` for searchable lists (good for >10 items)
- Image syntax: `- ![Label](path.png)`

### compare

```markdown
---
type: compare
---
# Which implementation?

## Recursive

O(2^n) time, simple but blows the stack at n=40.

## Iterative with memo

O(n) time, O(n) space. Handles any input.
```

Each `##` heading becomes a panel. User picks one.

### form

```markdown
---
type: form
---
# Deploy configuration

- Environment: [dev, staging, canary, production]
- Version tag (text)
- Release notes (textarea)
- Run migrations (toggle) = false
- Notify Slack (toggle) = true
- Rollback strategy: [automatic, manual, disabled]
```

Field syntax: `Label (text)`, `Label (textarea)`, `Label (toggle)`, `Label: [A, B, C]`, `Label (type) = default`

### review

```markdown
---
type: review
actions: [Approve, Needs Changes, Reject]
---
# PR #247: Add rate limiting

**+89 / -12** across 4 files. Applies globally to /api/ — no per-user differentiation.
```

### review_each

```markdown
---
type: review_each
actions: [Approve, Reject, Skip]
---
# Review proposed changes

- Rename auth module to auth-v2
- Add rate limiting middleware
- Drop legacy /api/v1 endpoints
- Migrate session store to Redis
```

### rank

```markdown
---
type: rank
---
# Sprint priority

- Auth: SSO support for enterprise
- Perf: cold start under 1s
- UX: redesign settings (user complaints)
- Bug: PDF export drops images
- Debt: replace Moment.js with date-fns
```

### file

```markdown
---
type: file
root: ./src
extensions: [ts, js]
multi: true
---
# Select files to refactor
```

### upload

```markdown
---
type: upload
dest: /tmp/uploads
extensions: [png, jpg, svg]
multi: true
maxSize: 10485760
---
# Upload design assets
```

### text

```markdown
---
type: text
placeholder: Describe the changes you want...
---
# What should we change?

Here's the current implementation with the relevant context and constraints that inform what's possible.
```

### range

```markdown
---
type: range
min: 0
max: 100
step: 5
value: 50
---
# Confidence level
```

## When $ARGUMENTS is given

Use the argument as context for what to prompt. Examples:
- `/promptui photos in the photos folder` → find images, present as visual picker
- `/promptui review this draft` → show content with approve/reject actions
- `/promptui prioritize the backlog` → gather items, present as rank

Infer sensible options from context.

## Rules

- Add `filter: true` for lists longer than ~10 items
- Paths (images, `root`, `dest`) can be relative to the .md file
- If the result is `dismissed`, **stop and talk to the user**. They weren't happy with the choices or how they were presented. Ask what they'd prefer — don't just re-show the same prompt
