import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { SITE_URL } from "@/lib/site";

interface SEOProps {
  title: string;
  description: string;
  /** Path override. Defaults to the current location. */
  path?: string;
  /** OG image URL. Defaults to the favicon. */
  image?: string;
  /** Optional JSON-LD blob to attach. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Optional og:type override (default "website"). */
  ogType?: string;
  /**
   * Keep the page out of search results.
   *
   * For a page that is *unlisted* rather than private: reachable by anyone who
   * has the URL, but not something to be found by searching. Without this a
   * secret door linked from the home page is crawled like any other link and
   * turns into a search result, which is the whole thing it was not supposed
   * to be. Matches the `noindex, nofollow` already on public/colorlab.html.
   */
  noindex?: boolean;
}

export function SEO({ title, description, path, image, jsonLd, ogType = "website", noindex = false }: SEOProps) {
  const location = useLocation();
  const url = `${SITE_URL}${path ?? location.pathname}`;
  const trimmedTitle = title.length > 60 ? title.slice(0, 57) + "…" : title;
  const trimmedDesc = description.length > 160 ? description.slice(0, 157) + "…" : description;
  const ogImage = image ?? `${SITE_URL}/favicon.svg`;
  const ldArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{trimmedTitle}</title>
      <meta name="description" content={trimmedDesc} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <link rel="canonical" href={url} />
      <meta property="og:title" content={trimmedTitle} />
      <meta property="og:description" content={trimmedDesc} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={trimmedTitle} />
      <meta name="twitter:description" content={trimmedDesc} />
      <meta name="twitter:image" content={ogImage} />
      {ldArray.map((blob, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(blob)}</script>
      ))}
    </Helmet>
  );
}