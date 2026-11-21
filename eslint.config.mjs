import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  {
    ignores: [".next/**", ".open-next/**", "node_modules/**", "out/**"],
  },
  ...nextVitals,
  ...nextTs,
];

export default config;
