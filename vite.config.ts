// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.VITE_BASE ?? "./";

function escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Injects canonical / social-image tags only when the private assets build sets them. */
function socialMetaPlugin(): Plugin {
    const url = process.env.VITE_OG_URL;
    const image = process.env.VITE_OG_IMAGE;
    return {
        name: "social-meta",
        transformIndexHtml(html) {
            let next = html;
            const ogTags = [
                url ? `        <meta property="og:url" content="${escapeAttr(url)}" />` : "",
                image ? `        <meta property="og:image" content="${escapeAttr(image)}" />` : "",
            ]
                .filter(Boolean)
                .join("\n");
            if (ogTags) {
                next = next.replace(
                    /(<meta property="og:description"[^>]*\/>)/,
                    `$1\n${ogTags}`,
                );
            }
            if (image) {
                next = next.replace(
                    /(<meta name="twitter:description"[^>]*\/>)/,
                    `$1\n        <meta name="twitter:image" content="${escapeAttr(image)}" />`,
                );
            }
            return next;
        },
    };
}

export default defineConfig({
    base,
    server: {
        port: 5173,
        open: false,
    },
    build: {
        target: "es2022",
        outDir: "dist",
        assetsInlineLimit: 0,
        sourcemap: false,
    },
    plugins: [
        socialMetaPlugin(),
        VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            includeAssets: ["favicons/**", "icons/**", "fonts/*.woff2"],
            devOptions: { enabled: false },
            workbox: {
                cleanupOutdatedCaches: true,
                globPatterns: ["**/*.{js,css,html,png,woff2,json,webmanifest,ico,m4a}"],
                globIgnores: ["**/*.map", "**/node_modules/**", "**/*happyelevator*.m4a"],
                runtimeCaching: [
                    {
                        urlPattern: /happyelevator.*\.m4a$/,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "elevator-ceo-music",
                            cacheableResponse: { statuses: [0, 200] },
                            expiration: {
                                maxEntries: 4,
                                maxAgeSeconds: 60 * 60 * 24 * 365,
                            },
                        },
                    },
                ],
            },
            manifest: {
                name: "Elevator CEO",
                short_name: "Elevator CEO",
                description: "An Ai-assisted rewrite of the iOS game, now playable in any browser.",
                display: "standalone",
                orientation: "portrait",
                theme_color: "#000000",
                background_color: "#000000",
                start_url: base,
                scope: base,
                icons: [
                    { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
                    { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
                ],
            },
        }),
    ],
});
