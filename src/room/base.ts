/** `import.meta.env.BASE_URL` + a path (leading slash allowed): models, atlases and /api/* all go through this */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
