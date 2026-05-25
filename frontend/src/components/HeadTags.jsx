import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function HeadTags({ title, description, url, image, extraMeta = [], children }) {
  const defaultTitle = 'Drip Street | Minimal Streetwear';
  const defaultDesc = 'Premium minimal streetwear built for confidence.';
  const defaultUrl = 'https://dripstreetshop.com';
  const defaultImage = 'https://dripstreetshop.com/brand/generated/og-image.png';

  const safeTitle = title || defaultTitle;
  const safeDesc = description || defaultDesc;
  const safeUrl = url || defaultUrl;
  const safeImage = image || defaultImage;

  // Make sure image URL is absolute
  const absoluteImage = safeImage.startsWith('http')
    ? safeImage
    : `https://dripstreetshop.com${safeImage.startsWith('/') ? '' : '/'}${safeImage}`;

  return (
    <Helmet>
      {/* Basic Meta Tags */}
      <title>{safeTitle}</title>
      <meta name="description" content={safeDesc} />

      {/* OpenGraph / Facebook */}
      <meta property="og:title" content={safeTitle} />
      <meta property="og:description" content={safeDesc} />
      <meta property="og:url" content={safeUrl} />
      <meta property="og:type" content="website" />
      <meta property="og:image" content={absoluteImage} />

      {/* Twitter Cards */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={safeTitle} />
      <meta name="twitter:description" content={safeDesc} />
      <meta name="twitter:image" content={absoluteImage} />

      {/* Extra Meta Tags */}
      {extraMeta.map((metaProps, index) => (
        <meta key={`extra-meta-${index}`} {...metaProps} />
      ))}

      {/* Custom Children (like JSON-LD scripts) */}
      {children}
    </Helmet>
  );
}
