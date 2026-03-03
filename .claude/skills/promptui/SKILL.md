---
name: promptui
description: Show browser-based UI prompts for Claude Code — choose between options, confirm decisions, review drafts, collect text input, upload files, or pick from large filtered lists.
argument-hint: "[what to prompt for]"
allowed-tools: Bash, Read, Glob, Grep
---

Use this skill whenever you need the user to interact visually — choose between options, confirm a decision, review a draft, fill a form, rate something, upload files, or pick from a large filtered list.

## How it works

Write a Markdown file, run `promptui <file>`, get the result on stdout.

```bash
cat > /tmp/prompt.md << 'PROMPT'
# Pick the best layout

- Option A
- Option B
PROMPT

CHOICE=$(promptui /tmp/prompt.md)
# $CHOICE is now "Option A" or "Option B"
```

A browser window opens automatically, the user picks, the result prints to stdout, done. Paths in the markdown (images, `root`, `dest`) can be relative to the .md file — they're resolved automatically.

## Markdown format

Optional YAML frontmatter between `---` fences, then a standard Markdown body. Bullets become selectable items. `##` headings become compare sections.

### Auto-inference (skip frontmatter for common cases)

| Structure | Inferred type |
|-----------|---------------|
| Has bullet list | `choose` |
| `multi: true` | `pick_many` |
| `actions:` in frontmatter | `review` |
| `placeholder:` in frontmatter | `text` |
| Title + body text, no bullets | `confirm` |
| Title only, no body | `display` |

## Prompt types

### display — show content, no input

```markdown
# The redesign is complete
```
→ `ok`

### confirm — yes / no

```markdown
# Deploy to production?

This will affect live users.
```
→ `yes` or `no`

### choose — pick one option

```markdown
# Which approach?

- Simple but limited
- Complex but flexible
```
→ `Simple but limited`

With images: `- ![Sunset](sunset.png)`

### pick_many — pick multiple options

```markdown
---
multi: true
---
# Select tests to run

- Unit tests
- Integration tests
- E2E tests
```
→ `- Unit tests` / `- E2E tests`

Add `filter: true` for searchable lists (good for >10 items).

### text — free-text input

```markdown
---
placeholder: e.g. make the header larger
---
# What should we change?

Describe the modifications.
```
→ the user's typed response

### review — read content and decide

```markdown
---
actions: [Send, Rewrite, Skip]
---
# Draft email

Dear Client, thank you for your patience.
```
→ `Send`

### review_each — review items one by one

```markdown
---
actions: [Approve, Reject, Skip]
---
# Review changes

- Rename auth module
- Add rate limiting
- Drop legacy endpoint
```
→ `- Rename auth module: Approve` / `- Add rate limiting: Skip` / ...

### form — structured multi-field input

```markdown
---
type: form
---
# Project settings

- Name (text)
- Description (textarea)
- Notify on deploy (toggle) = true
- Environment: [dev, staging, production]
```
→ `Name: MyApp` / `Description: ...` / `Notify on deploy: true` / `Environment: staging`

Field syntax:
- `Label (text)` — text input
- `Label (textarea)` — multi-line
- `Label (toggle)` — on/off switch
- `Label: [A, B, C]` — dropdown select
- `Label (type) = default` — with default value

### compare — side-by-side, pick one

```markdown
---
type: compare
---
# Pick a version

## Original

The quick brown fox jumps over the lazy dog.

## Revised

A swift auburn fox leaps across the sleepy hound.
```
→ `Original` or `Revised`

### rank — drag to reorder

```markdown
---
type: rank
---
# Priority order

- Speed
- Quality
- Cost
```
→ `1. Quality` / `2. Speed` / `3. Cost`

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
→ `75`

### rating — stars or thumbs

```markdown
---
type: rating
style: stars
max: 5
---
# How was the output?
```
→ `4` (stars) or `up`/`down` (thumbs, use `style: thumbs`)

### file — browse and select existing files

```markdown
---
type: file
root: ./src
extensions: [json, yaml]
---
# Pick a config file
```
→ `/absolute/path/to/src/config.json`

Add `multi: true` for multiple selection.

### upload — drag-and-drop file upload

```markdown
---
type: upload
dest: /tmp/uploads
extensions: [png, jpg]
multi: true
maxSize: 10485760
---
# Upload assets

Drop your image files here.
```
→ `/tmp/uploads/photo.png` (single) or `- /tmp/uploads/a.png` / `- /tmp/uploads/b.png` (multi)

## When $ARGUMENTS is given

Use the argument as context for what to prompt. Examples:
- `/promptui photos in the photos folder` → find images, present as visual picker
- `/promptui which branch to merge` → list git branches as options
- `/promptui review this draft` → show content with approve/reject actions

Infer sensible options from context.

## Rules

- Use `choose` for single pick, `pick_many` for multiple
- Add `filter: true` for lists longer than ~10 items
- Keep titles short — they're headings
- Paths (images, `root`, `dest`) can be relative to the .md file
