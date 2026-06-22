/** Data consumed by {@linkcode renderSwaggerIndex}. */
export interface SwaggerIndexData {
  title: string;
  links: Array<{ name: string; href: string }>;
  particles: Array<{
    left: number;
    delay: string;
    duration: string;
    size: string;
    opacity: string;
  }>;
  /** When set, a "system map" link to the whole-app process graph renders below the cards. */
  mapHref?: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (
      ch,
    ) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]!),
  );
}

const DOC_ICON_SVG =
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 17h8v-2H8v2zm0-4h8v-2H8v2z"
                    />
                  </svg>`;

/**
 * Renders the swagger docs index page. Plain template literals — no template engine, so the
 * module stays loadable under bundlers (Vite SSR) that choke on CommonJS like handlebars.
 */
export function renderSwaggerIndex(data: SwaggerIndexData): string {
  const particles = data.particles
    .map(
      (p) =>
        `<div
          class="particle"
          style="left: ${p.left}%; animation-delay: ${p.delay}s; animation-duration: ${p.duration}s; width: ${p.size}px; height: ${p.size}px; opacity: ${p.opacity};"
        ></div>`,
    )
    .join("\n        ");

  const docsList = data.links.length > 0
    ? data.links
      .map(
        (link) =>
          `<a href="${escapeHtml(link.href)}" class="doc-link">
                <span class="icon">
                  ${DOC_ICON_SVG}
                </span>
                <span>${escapeHtml(link.name)}</span>
                <span class="arrow">→</span>
              </a>`,
      )
      .join("\n              ")
    : `<p class="no-docs">No documentation available yet</p>`;

  const mapLink = data.mapHref
    ? `<div class="map-link-wrap">
            <a href="${
      escapeHtml(data.mapHref)
    }" class="map-link">System map — every module's process in one graph →</a>
          </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(data.title)}</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap"
      rel="stylesheet"
    />
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: "Lato", sans-serif;
        background: linear-gradient(
          135deg,
          #1a1a2e 0%,
          #16213e 50%,
          #0f3460 100%
        );
        min-height: 100vh;
        padding: 2rem;
        color: #ffffff;
        line-height: 1.65;
        overflow-x: hidden;
      }

      /* Animated background particles */
      .bg-particles {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        z-index: 0;
      }

      .particle {
        position: absolute;
        top: 100%;
        background: #49a53d;
        border-radius: 50%;
        animation: float 15s infinite ease-out;
        animation-fill-mode: backwards;
        box-shadow: 0 0 6px rgba(73, 165, 61, 0.5);
      }

      @keyframes float {
        0% {
          transform: translateY(0) scale(0.5);
          filter: brightness(0.5);
        }
        50% {
          transform: translateY(-50vh) scale(1);
          filter: brightness(1.2);
        }
        100% {
          transform: translateY(-120vh) scale(0.5);
          filter: brightness(0.5);
        }
      }

      .content-wrapper {
        position: relative;
        z-index: 1;
      }

      .header {
        text-align: center;
        padding: 3rem 0 4rem;
        animation: fadeInDown 0.8s ease-out;
      }

      @keyframes fadeInDown {
        from {
          opacity: 0;
          transform: translateY(-30px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .logo {
        font-size: 2.5rem;
        font-weight: 900;
        background: linear-gradient(
          135deg,
          #49a53d 0%,
          #7ed56f 50%,
          #49a53d 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 0.5rem;
      }

      .tagline {
        color: rgba(255, 255, 255, 0.6);
        font-size: 1rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }

      .container {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        padding: 3rem;
        max-width: 1000px;
        margin: 0 auto;
        animation: fadeInUp 0.8s ease-out 0.2s both;
      }

      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(30px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .title-wrapper {
        text-align: center;
        margin-bottom: 2.5rem;
      }

      h1 {
        color: #ffffff;
        margin-bottom: 0.75rem;
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      h1 .highlight {
        color: #49a53d;
      }

      .subtitle {
        color: rgba(255, 255, 255, 0.6);
        font-size: 1.1rem;
      }

      .docs-list {
        display: flex;
        flex-wrap: wrap;
        gap: 1.25rem;
        margin-top: 2rem;
        justify-content: center;
      }

      .doc-link {
        flex: 1 1 280px;
        max-width: 350px;
        position: relative;
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1.5rem 1.75rem;
        background: linear-gradient(
          135deg,
          rgba(73, 165, 61, 0.2) 0%,
          rgba(73, 165, 61, 0.1) 100%
        );
        border: 1px solid rgba(73, 165, 61, 0.3);
        color: #ffffff;
        text-decoration: none;
        border-radius: 12px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        font-size: 1.1rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        overflow: hidden;
      }

      .doc-link::before {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.1),
          transparent
        );
        transition: left 0.5s;
      }

      .doc-link:hover::before {
        left: 100%;
      }

      .doc-link:hover {
        background: linear-gradient(135deg, #49a53d 0%, #34762f 100%);
        border-color: #49a53d;
        transform: translateY(-4px) scale(1.02);
        box-shadow: 0 20px 40px rgba(73, 165, 61, 0.3);
      }

      .doc-link:active {
        transform: translateY(-2px) scale(1.01);
      }

      .doc-link .icon {
        width: 40px;
        height: 40px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.3s;
      }

      .doc-link:hover .icon {
        background: rgba(255, 255, 255, 0.2);
        transform: rotate(5deg);
      }

      .doc-link .icon svg {
        width: 20px;
        height: 20px;
        fill: #49a53d;
        transition: fill 0.3s;
      }

      .doc-link:hover .icon svg {
        fill: #ffffff;
      }

      .doc-link .arrow {
        margin-left: auto;
        opacity: 0;
        transform: translateX(-10px);
        transition: all 0.3s;
      }

      .doc-link:hover .arrow {
        opacity: 1;
        transform: translateX(0);
      }

      .map-link-wrap {
        text-align: center;
        margin-top: 2rem;
      }

      .map-link {
        display: inline-block;
        color: #7ed56f;
        text-decoration: none;
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        padding: 0.6rem 1.25rem;
        border: 1px dashed rgba(73, 165, 61, 0.4);
        border-radius: 10px;
        transition: all 0.3s;
      }

      .map-link:hover {
        border-color: #49a53d;
        background: rgba(73, 165, 61, 0.12);
        color: #ffffff;
      }

      .no-docs {
        text-align: center;
        color: rgba(255, 255, 255, 0.5);
        font-size: 1.1rem;
        padding: 3rem;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 12px;
        border: 1px dashed rgba(255, 255, 255, 0.1);
      }

      .footer {
        text-align: center;
        padding: 3rem 0 1rem;
        animation: fadeInUp 0.8s ease-out 0.4s both;
      }

      .footer a {
        color: #49a53d;
        text-decoration: none;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        font-size: 0.875rem;
        transition: all 0.3s;
        position: relative;
      }

      .footer a::after {
        content: "";
        position: absolute;
        bottom: -4px;
        left: 0;
        width: 0;
        height: 2px;
        background: #49a53d;
        transition: width 0.3s;
      }

      .footer a:hover::after {
        width: 100%;
      }

      .footer a:hover {
        color: #7ed56f;
      }

      .version-badge {
        display: inline-block;
        background: rgba(73, 165, 61, 0.2);
        border: 1px solid rgba(73, 165, 61, 0.3);
        color: #49a53d;
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 700;
        margin-top: 1rem;
        letter-spacing: 0.05em;
      }

      @media (max-width: 600px) {
        .container {
          padding: 1.5rem;
          border-radius: 16px;
        }

        .logo {
          font-size: 1.75rem;
        }

        h1 {
          font-size: 1.5rem;
        }

        .doc-link {
          max-width: 100%;
          padding: 1.25rem;
        }
      }
    </style>
  </head>
  <body>
    <div class="bg-particles">
      ${particles}
    </div>

    <div class="content-wrapper">
      <div class="header">
        <div class="logo">Monster Reservations Group</div>
        <div class="tagline">Developer Portal</div>
      </div>

      <div class="container">
        <div class="title-wrapper">
          <h1>${escapeHtml(data.title)}</h1>
          <p class="subtitle">Select a module to explore its endpoints</p>
        </div>

        <div class="docs-list">
          ${docsList}
        </div>
        ${mapLink}
      </div>

      <div class="footer">
        <a href="https://monsterrg.com">monsterrg.com</a>
        <div class="version-badge">API v1.0</div>
      </div>
    </div>
  </body>
</html>
`;
}
