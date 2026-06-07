@AGENTS.md

## Fork: BaddAssApp rebrand (do not undo in either direction)

This repo is the user's **BaddAssApp** fork of FerroxLabs/wayland (branch `rebrand/baddassapp`, base commit fcaaaa1).

- **User-facing = BaddAssApp**: window title, i18n strings, About page, agent labels ("BaddAssApp Core"), productName/appId, links → baddassapp.com.
- **Internals = wayland, on purpose**: service/file/identifier names, `wayland://` scheme, `~/.wayland/` paths, `@wayland/*` scopes stay upstream-named so near-daily upstream merges stay clean. Do NOT "finish" the rename.
- **i18n rule**: rebrand locale JSON *values only* — never keys (they're lookup keys).
- **Icons**: BAA icon is live in `resources/app.icns|app.png|app_dev.png`; upstream originals kept as `resources/*-wayland-original.*`; `app.ico` (Windows) is still upstream's. After an upstream merge, re-check these files weren't overwritten.
- **Upstream merges**: `git fetch origin && git merge origin/main` on the branch; expect conflicts only in the 153 rebranded files (mostly locales).

<!-- IJFW-MEMORY-START (managed -- do not edit manually) -->
<ijfw-memory>
Project memory at .ijfw/memory/. Call `ijfw_memory_prelude` for full context.
</ijfw-memory>

<ijfw-routing>
IJFW is installed alongside a peer brainstorming skill. For project-level tasks (build, create, design, plan, brainstorm, landing page, app, website, dashboard, campaign, book, launch), prefer the ijfw:ijfw-workflow skill -- the user opted into IJFW via install, and ijfw-workflow is its configured workflow entry point. IJFW orchestrates think-build-ship end to end and dispatches peer specialist skills (frontend-design, TDD, code-review) as subagent tools when the workflow needs them.
</ijfw-routing>
<!-- IJFW-MEMORY-END -->
