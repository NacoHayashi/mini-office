// Wrangler bundles these as text (see [[rules]] in wrangler.toml).
declare module "*.html" {
  const text: string;
  export default text;
}
declare module "*.css" {
  const text: string;
  export default text;
}
declare module "*/panel.js" {
  const text: string;
  export default text;
}
