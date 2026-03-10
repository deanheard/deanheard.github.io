export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
  safelist: [
    // Root state
    "data-checked:bg-primary",
    "data-unchecked:bg-input",
    "dark:data-unchecked:bg-input/80",
    "data-disabled:cursor-not-allowed",
    "data-disabled:opacity-50",

    // Thumb translations
    "group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)]",
    "group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)]",
    "group-data-[size=default]/switch:data-unchecked:translate-x-0",
    "group-data-[size=sm]/switch:data-unchecked:translate-x-0",

    // Thumb colors
    "dark:data-checked:bg-primary-foreground",
    "dark:data-unchecked:bg-foreground",
  ],
}