<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## UI architecture
- Keep shareable screens in dedicated TanStack file routes and render shared workspace navigation through a common wrapper, so direct URLs and metadata work independently.
- Keep demo sample data browser-safe and changes in React context for the frontend-only preview; real analysis, accounts, storage, and APIs must not be implied as connected.
- Define all visual tokens and motion centrally in the global stylesheet and use the shared Button component for controls, so the editorial design remains consistent.
