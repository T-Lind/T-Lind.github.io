# Tiernan Lindauer’s website

The live GitHub Pages site serves the static HTML and assets at the repository root. Project detail pages live in their own directories. The separate Next.js app below is a legacy experiment and is not part of the Pages deployment.

## Static site and search

- `npm run preview:site` serves the site at `http://127.0.0.1:8088` using Node’s standard library; no install is needed.
- `npm run search:index` regenerates `search-index.json` from public static pages and project cards. Run it after editing content and commit the updated index alongside those edits.
- `npm run test:site` checks search relevance, aliases, typos, category filters, project images, links, and language tags.

Search is available from the navigation on every page, with Ctrl/⌘ K or `/` shortcuts, and at `/search/`. It runs in the browser, loads the index on first use, and sends no queries to a server. Titles, aliases, languages, and descriptions are ranked above body text. Multiword searches require each meaningful word to match; spelling tolerance applies to project names and summaries.

Project image sources and demo labels are recorded in `public/projects/README.md`.

## Legacy Next.js app

This separate app was bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
