import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Rune Studio — design your language</title>
        <meta
          name="description"
          content="A studio for designing the Rune spec language: edit keywords, see live syntax highlighting, and shape the code each keyword generates."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* Display: Fraunces (editorial variable serif). Mono: JetBrains Mono. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,400..700&family=JetBrains+Mono:ital,wght@0,400..700;1,400..600&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* f-client-nav + f-view-transition: cross-page swaps run as View Transitions */}
      <body f-client-nav f-view-transition>
        <Component />
      </body>
    </html>
  );
});
