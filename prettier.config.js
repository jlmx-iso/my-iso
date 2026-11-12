/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
const config = {
  endOfLine: "auto",
  plugins: ["prettier-plugin-tailwindcss"],
  trailingComma: "es5",
};

export default config;
