---
name: promptui
description: Show rich browser UI when the terminal isn't enough — visual pickers with images, side-by-side comparisons, multi-field forms, file browsers, drag-and-drop uploads, and review workflows.
argument-hint: "[what to prompt for]"
allowed-tools: Bash, Read, Glob, Grep
---

## When to use this (and when NOT to)

promptui opens a browser window. That's heavyweight. **Do not use it for things the terminal can do:**

- Yes/no confirmation → use the terminal
- Pick from 2-4 text options → use the terminal
- Show a short message → use the terminal

**Use promptui when you need what the terminal can't do:**

- Visual choices with images (pick a design, screenshot, icon)
- Side-by-side comparison of code, text, or content
- Multi-field forms (text + dropdowns + toggles together)
- Reviewing a batch of items with approve/reject/skip per item
- File browsing with directory navigation
- Drag-and-drop file uploads
- Ranked ordering via drag-and-drop
- Long filtered/searchable lists (50+ options)
- Rich markdown content the user needs to read and act on

## How it works

Write a Markdown file, run `promptui <file>`, get the result on stdout. A browser window opens, the user interacts, the result prints, done.

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

Paths (images, `root`, `dest`) can be relative to the .md file — they're resolved automatically. If the user clicks "let's rather talk about this" at the bottom of any prompt, the result is `dismissed`.

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

Always set `type:` explicitly. The available types and their frontmatter keys are listed below.

## Prompt types

### choose / pick_many — visual option picker

Best for: image grids, long searchable lists, multi-select with checkboxes.

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

### compare — side-by-side content

Best for: code diffs, text revisions, competing approaches.

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

### form — structured multi-field input

Best for: configuration with mixed input types, settings panels.

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

### review — read content and decide

Best for: drafts, generated content, diffs that need approval.

```markdown
---
type: review
actions: [Approve, Needs Changes, Reject]
---
# PR #247: Add rate limiting

**+89 / -12** across 4 files. Applies globally to /api/ — no per-user differentiation.
```

### review_each — batch review items one by one

Best for: reviewing a list of changes, files, or suggestions individually.

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

### rank — drag to reorder

Best for: prioritization, ordering tasks or features.

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

### file — browse and select files

Best for: picking files from a directory tree with navigation.

```markdown
---
type: file
root: ./src
extensions: [ts, js]
multi: true
---
# Select files to refactor
```

### upload — drag-and-drop file upload

Best for: getting images, documents, or assets from the user.

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

### text — free-text input

Best for: long-form input with rich markdown context above it.

```markdown
---
type: text
placeholder: Describe the changes you want...
---
# What should we change?

Here's the current implementation with the relevant context and constraints that inform what's possible.
```

### range — numeric slider

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

### rating — stars or thumbs

```markdown
---
type: rating
style: stars
max: 5
---
# Rate the generated output
```

Use `style: thumbs` for up/down instead of stars.

## When $ARGUMENTS is given

Use the argument as context for what to prompt. Examples:
- `/promptui photos in the photos folder` → find images, present as visual picker
- `/promptui review this draft` → show content with approve/reject actions
- `/promptui prioritize the backlog` → gather items, present as rank

Infer sensible options from context.

## Rules

- **Do not use promptui for simple choices** — if the terminal can handle it, use the terminal
- Use `choose` for single pick, `pick_many` for multiple
- Add `filter: true` for lists longer than ~10 items
- Paths (images, `root`, `dest`) can be relative to the .md file
- If the result is `dismissed`, the user wants to talk instead of picking — return to conversation
