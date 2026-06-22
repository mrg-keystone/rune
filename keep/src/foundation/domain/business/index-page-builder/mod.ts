import { renderSwaggerIndex } from "./template.ts";

export interface IndexPageBuilderOptions {
  prefix?: string;
  particleCount?: number;
}

/**
 * IndexPageBuilder generates an HTML index page with links to swagger documentation.
 * Takes a list of names and creates links to <prefix><name> pages.
 */
export class IndexPageBuilder {
  private prefix: string;
  private particleCount: number;

  constructor(options: IndexPageBuilderOptions = {}) {
    this.prefix = options.prefix ?? "/docs/";
    this.particleCount = options.particleCount ?? 9;
  }

  private cleanName(name: string): string {
    return name.replace(/Module$/i, "");
  }

  /**
   * Build HTML page with links to each named documentation page
   * @param names - List of documentation names (e.g., module names)
   * @param extras - Optional additions: `mapHref` renders a "system map" link to the
   *   whole-app process graph page. Omitted ⇒ the page is unchanged (backward compatible).
   * @returns HTML string for the index page
   */
  build(names: string[], extras: { mapHref?: string } = {}): string {
    const links = names.map((n) => {
      return {
        name: this.cleanName(n),
        href: `${this.prefix}${this.cleanName(n).toLowerCase()}`,
      };
    });

    // Generate particles with varied properties for visual interest
    const particles = Array.from({ length: this.particleCount }, (_, i) => {
      // Use deterministic pseudo-random values based on index
      const seed = (i * 7919) % 100; // Prime number for distribution
      return {
        left: Math.round(seed),
        delay: ((i * 1.7) % 15).toFixed(1),
        duration: (10 + (seed % 15)).toFixed(0),
        size: (3 + (seed % 6)).toFixed(0),
        opacity: (0.2 + (seed % 40) / 100).toFixed(2),
      };
    });

    return renderSwaggerIndex({
      title: "API Documentation",
      links,
      particles,
      mapHref: extras.mapHref,
    });
  }
}
