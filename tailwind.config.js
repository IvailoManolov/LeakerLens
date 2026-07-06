/**
 * Tailwind config for the LeakerLens findings panel webview.
 *
 * Every color maps to a VS Code theme CSS variable so the panel is automatically
 * correct in light, dark, and high-contrast themes — we never hardcode colors.
 * Content is scanned so the output CSS is purged to only the classes we use.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./src/webview/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        // Editor / panel surfaces.
        bg: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
        fg: 'var(--vscode-foreground)',
        muted: 'var(--vscode-descriptionForeground)',
        border: 'var(--vscode-panel-border, var(--vscode-editorWidget-border))',
        hover: 'var(--vscode-list-hoverBackground)',
        active: 'var(--vscode-list-activeSelectionBackground)',
        badge: 'var(--vscode-badge-background)',
        badgeFg: 'var(--vscode-badge-foreground)',
        link: 'var(--vscode-textLink-foreground)',
        // Severity accents — mapped to the editor's chart/error tokens.
        critical: 'var(--vscode-errorForeground, var(--vscode-charts-red))',
        high: 'var(--vscode-charts-orange, var(--vscode-editorWarning-foreground))',
        medium: 'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))',
        low: 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))',
        ok: 'var(--vscode-charts-green, var(--vscode-testing-iconPassed))',
        // `border-ok` uses the same token so safe findings get a matching green left border.
        // Tailwind auto-generates border/text/bg utilities from every color entry; this
        // comment keeps the relationship explicit for future readers.
        btn: 'var(--vscode-button-background)',
        btnFg: 'var(--vscode-button-foreground)',
        btnHover: 'var(--vscode-button-hoverBackground)',
        btnSecondary: 'var(--vscode-button-secondaryBackground)',
        btnSecondaryFg: 'var(--vscode-button-secondaryForeground)',
      },
      fontFamily: {
        sans: 'var(--vscode-font-family)',
        mono: 'var(--vscode-editor-font-family)',
      },
      fontSize: {
        base: 'var(--vscode-font-size, 13px)',
      },
    },
  },
  corePlugins: {
    // The webview inherits VS Code's base font/colors; we don't want Tailwind's
    // Preflight to fight the host. Keep it lean.
    preflight: true,
  },
  plugins: [],
};
