import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            globals: {
                console: "readonly",
                process: "readonly",
                fetch: "readonly",
                Buffer: "readonly"
            }
        }
    },
    {
        files: ["ui/**/*.js"],
        languageOptions: {
            globals: {
                document: "readonly",
                window: "readonly"
            }
        }
    },
    eslintConfigPrettier, // Must be last to override conflicting rules
    {
        ignores: ["dist/", ".cache/", "src-tauri/", "node_modules/"]
    }
);
