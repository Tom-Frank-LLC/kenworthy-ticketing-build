import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

const SITE_URL = "https://kenworthy-ticketing.lovable.app";

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
}

export function SEO({ title, description, path, image, jsonLd, ogType = "website" }: SEOProps) {
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